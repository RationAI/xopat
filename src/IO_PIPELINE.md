# Generic IO/persistence pipeline

xOpat's generic IO pipeline lets any plugin, module, or core component declare *what* kinds of persistence it supports (bundle-level export/import, per-element CRUD), and lets administrators bind those declarations to *where* the data goes (file download, HTTP, custom sink, or several at once).

**Vocabulary**: a *sink* is the runtime object that performs IO. Modules/plugins register their own sinks programmatically (`IO_PIPELINE.registerSink(...)`); the admin only routes capabilities to sinks via `ENV.client.io.bindings` and supplies per-deployment overrides via `ENV.client.io.sinkOverrides`. The module composes its full sink config from its own defaults + the admin override slot — the pipeline never composes options on the module's behalf.

The pipeline is exposed at runtime as **`window.IO_PIPELINE`** and aliased on **`APPLICATION_CONTEXT.io`**. Public types are ambient (`src/types/io.d.ts`); the implementation lives in `src/classes/io/`.

---

## Mental model

```
              ┌────────────────────────┐
   modules/   │    Capability          │   • bundle-export / bundle-import
   plugins ──►│    Registry            │   • crud:<resourceName>
   declare    │  (what an owner CAN do)│   • kv:<namespace>  (cache, cookies, data, …)
              └────────────┬───────────┘
                           │
                           ▼          ┌────────────────────────────┐
                ┌──────────────────┐  │  Admin app config          │
                │   IO Pipeline    │◄─│  ENV.client.io.bindings:   │
                │  (orchestrator)  │  │   ownerId →                │
                └──────────────────┘  │     capabilityId → [s1,s2] │
                  ▲                ▲  └────────────────────────────┘
                  │                │
   sinks ─────────┘                └──── KV drivers
   (bundle/crud destinations)            (storage engines)
   • file-download                       • local-storage
   • file-upload                         • session-storage
   • post-data                           • cookies
   • http-rest                           • memory
                                         • post-data (async)
                                         • http-rest (async)
                                         + custom (any localStorage-shape)
```

Three concepts:

- **Capability** — what an owner advertises. `{ id: 'bundle-export', kind: 'bundle' }`, `{ id: 'crud:annotation', kind: 'crud' }`, `{ id: 'kv:cache', kind: 'kv' }`.
- **Sink / KV driver** — what a module/plugin offers. Bundle/CRUD sinks implement `writeBundle/readBundle/create/read/update/delete`; KV drivers implement the localStorage interface (`getItem/setItem/removeItem/key/length/clear`) — `window.localStorage` plugs in directly. Modules register sinks at runtime via `IO_PIPELINE.registerSink(...)`; the pipeline ships four built-in sinks (`post-data`, `file-download`, `file-upload`, `http-rest`).
- **Binding** — the admin's choice of which sinks/drivers serve a given (owner, capability) pair. Multiple sinks can serve the same capability (e.g. file download AND a remote upload; localStorage AND a server mirror).
- **Owner** — who the namespace belongs to: `core`, or `<module|plugin>.<id>` exactly as `XOpatElement` builds its uid. Elements register in their constructor; everyone else is registered by `IO_PIPELINE.kv(uid, cap)` on first call, deriving `ownerId`/`xoType` from the uid shape. So a core service (`src/classes/playground`) or a plain-script module with no `XOpatModule` subclass (`modules/oidc-client-ts`) gets a working namespace without declaring anything, and `ENV.client.io.bindings["<uid>"]` applies to it either way. An owner registered implicitly is upserted — not replaced — if the real element appears later.

  Why this is not merely convenient: an *unregistered* owner used to resolve to zero drivers, and the handle it produced dropped every write and returned `null` on every read without throwing or warning. Auth state and editor drafts were being written into nothing. If a namespace resolves to no driver even *after* registration (bound to nothing, or to an unknown driver id) `kv()` now warns once, naming `<ownerUid>::<capability>`.

---

## Authoring side: declaring IO

### `include.json`

```jsonc
{
  "id": "annotations",
  "io": {
    "capabilities": [
      { "id": "bundle-export", "kind": "bundle" },
      { "id": "bundle-import", "kind": "bundle" },
      { "id": "crud:annotation", "kind": "crud" },
      { "id": "crud:preset", "kind": "crud" }
    ],
    // Optional plugin-author defaults; the admin always wins.
    "defaultBindings": {
      "bundle-export": ["post-data"]
    }
  }
}
```

`io: false` hard-disables IO for this owner regardless of admin config.

#### Rights integration (auto-derived)

For every entry in `io.capabilities[]`, the roles & capabilities system (`src/USER_ROLES.md`) automatically derives matching rights-capabilities and — for CRUD — installs `pre-create` / `pre-update` / `pre-delete` guards that refuse with `code: "W_PERM_DENIED"` when the current user lacks the corresponding role. Naming convention: `<ownerId>.<ioCapId>` (bundle) or `<ownerId>.<ioCapId>.<direction>` (crud). KV capabilities are never auto-derived.

Opt out on a per-capability basis:

```jsonc
{ "id": "crud:annotation", "kind": "crud", "rights": false }   // skip entirely
{ "id": "crud:annotation", "kind": "crud",
  "rights": { "default": "deny", "directions": ["create", "delete"], "label": "Annotation write" } }
```

See `src/USER_ROLES.md` for the full model.

### Bundle-level export/import

Inside the element's constructor or `pluginReady()`/`_init()`:

```ts
await this.initIO({
  bundleScope: "per-viewer",  // see scope table below
  exportBundle: async (ctx) => {
    if (!ctx.viewerId) return undefined;
    return this.serializeFor(ctx.viewerId);
  },
  importBundle: async (ctx, data) => {
    if (!ctx.viewerId) return;
    await this.applyTo(ctx.viewerId, data);
  },
});
```

`initIO` does three things:

1. registers your bundle hooks with the pipeline
2. adds any extra capabilities you pass via `options.capabilities`
3. immediately calls `IO_PIPELINE.tryRestoreImport({ ownerUid })` so any preexisting global payload is rehydrated. Per-viewer rehydration happens automatically via `forceDataImportInitialization` whenever a viewer opens.

#### `bundleScope` values

| Scope                     | When `exportBundle` / `importBundle` runs                                     | `ctx.viewerId` | `ctx.backgroundId` | Lives across slide change? |
| ------------------------- | ----------------------------------------------------------------------------- | -------------- | ------------------ | -------------------------- |
| `global` (default)        | Once per owner.                                                               | —              | —                  | Yes                        |
| `per-viewer`              | Once per open viewer at boot / catch-up.                                      | set            | —                  | Yes (viewer-scoped state stays loaded). |
| `per-viewer-background`   | Once per **(open viewer, current background)** pair, plus on slide change.    | set            | set                | **No — bound to the slide.** |
| `both`                    | `global` + `per-viewer` (legacy combo).                                       | varies         | —                  | Yes                        |
| `all`                     | `global` + `per-viewer` + `per-viewer-background`.                            | varies         | varies             | Per-viewer-background slot is slide-bound; the others stay loaded. |

**Slide-aware semantics** (`per-viewer-background` / `all`): `src/classes/app/viewer-open-pipeline.ts` invokes the pipeline as part of its slide-change choreography for any viewer whose displayed background changes:

- Just before `_resetViewer(viewerIndex)` (i.e. before the world is cleared for the new content), the pipeline dispatches `flushBundleExport({ viewerId, backgroundId: previousBackgroundId })`. Slide-aware owners receive `exportBundle(ctx)` with both ids set and the **previous** slide as `ctx.backgroundId`, so they can snapshot whatever state they want keyed by the leaving slide.
- After the new content finishes opening (post `applyRendererConfiguration`), the pipeline dispatches `tryRestoreImport({ viewerId, backgroundId: nextBackgroundId })`. Owners receive `importBundle(ctx, data)` with the **new** slide as `ctx.backgroundId` and either the stored payload or `undefined` when nothing is saved for this slide.

Owners that opt OUT (everything other than `per-viewer-background` / `all`) are NOT touched on slide change — their state stays loaded for the viewer's lifetime. This is the default; declaring `per-viewer-background` is the explicit opt-in.

**`ctx.key`** is composed by the pipeline so sinks that key blob storage by it get a deterministic slot:

| Dispatch                              | `ctx.key`                       |
| ------------------------------------- | ------------------------------- |
| Global                                | `""` (empty)                    |
| Per-viewer (no background)            | the viewer id                   |
| Per-viewer-background                 | `"<viewerId>::<backgroundId>"`  |

**`importBundle` clear-on-empty.** For slide-aware owners, restore is fired on every slide change — including when the new slide has no stored payload. Owners must treat the `undefined` payload as "this slide is empty, wipe local state for this (viewer, background)", otherwise the previous slide's state leaks. See `modules/annotations/annotations.js:_initIOPipeline` for the canonical pattern.

**Default sink for slide-aware bundles.** When no admin binding is configured, slide-aware owners fall back to the built-in `session-memory` sink (in-memory Map keyed by `ctx.key`, cleared on page reload). This makes the "switch back to slide A → state returns" behaviour self-sufficient out of the box. The legacy `post-data` fallback is reserved for non-slide-aware scopes (it's a single global slot and would silently collapse every slide's payload into one if used for `per-viewer-background`).

### Per-element CRUD

```ts
this.annotationResource = this.defineResource({
  name: "annotation",
  validate: (item) => item.factoryID
    ? { ok: true }
    : { ok: false, refused: true,
        reason: "missing factoryID",
        userMessage: "Cannot save annotation: unknown shape." },
  serialize: (item, ctx) => Convertor.encodeOne(item, ctx.meta.format ?? "native"),
  deserialize: (raw, ctx) => Convertor.decodeOne(raw, ctx.meta.format ?? "native"),
});

// Later, when the user creates an annotation:
const result = await this.annotationResource.create(item, {
  apply: () => fabric.add(item),    // local commit between guards and dispatch
});
if (!result.ok) return;             // guards refused or apply threw — toast already shown
```

Resources stay inert at the *sink* layer until an admin binds `crud:<name>` to a sink: `create/read/update/delete` skip serialization and dispatch when nothing is bound. Validation and **guards** still run, so external veto handlers work even when there is no remote backend.

### Operation ordering & coalescing (per-resource outbox)

Each `IOResource` owns a **per-resource FIFO outbox queue**. Every sink dispatch enqueues at the tail; the worker pulls one entry at a time and only starts op N+1 after op N has settled (success, refusal, or coalesced-out). This guarantees the server sees ops in the order the user issued them, even when individual sink calls have variable latency.

The sync core (validate → guards → apply → history push) still runs in the caller's frame; only the sink dispatch goes through the queue.

#### Coalescing

When the user spams operations on the same item — undo/redo/undo/redo, multiple consecutive updates — the queue collapses redundant work *before it reaches the wire*. Coalescing only applies to entries that have **not yet started** their sink call (in-flight ops never coalesce, so the server always observes a consistent prefix of the user's timeline).

Enabled per resource via:

```ts
this.annotationResource = this.defineResource({
    name: "annotation",
    identityOf: (item) => String(item.incrementId),   // required for coalesce
    coalesce: true,
    merge: (prev, next) => ({ ...prev, ...next }),    // for create+update rule
    validate, serialize, deserialize,
});
```

Rules (applied pairwise: latest pending entry of same identity vs new op):

| Pending (unstarted) | New op | Rewrite |
|---|---|---|
| `create X`              | `delete X` | both removed (cancels out) |
| `delete X`              | `create X` | both removed |
| `update X`              | `update X` | keep new (last-write-wins; old `.settled` resolves with `{ coalesced: true }`) |
| `update X`              | `delete X` | drop the update; keep delete |
| `create X`              | `update X` | merge update's patch into create's payload via `def.merge` (only if `merge` provided); new is folded in |

Concretely, `create A; undo; redo; undo` collapses on the wire to `create A; delete A` (the middle pair cancels). The local timeline is fully expressed in `APPLICATION_CONTEXT.history`; the server only sees the net effect.

Coalesced-out ops resolve their `.settled` to `{ ok: true, payload: { coalesced: true } }` so awaiting callers don't hang — for every rule, including the two that cancel a pair outright. `clientOpId` is preserved on the surviving op (servers dedup retries via that id alone).

**Ordering is never disturbed.** The surviving op of a `keep-latest` / `drop-update` rewrite takes over the superseded entry's *queue slot* rather than being appended, so `update A; update B; update A` still reaches the wire as `A, B` — the coalescing pass only ever removes work, never reorders it.

**Coalescing depends on stable identity.** `identityOf` is read off the payload for creates and off `itemId` otherwise; when neither yields a key the entry gets a synthetic one and silently stops coalescing forever. That is why history replays must carry a real body (see [`inversePayload`](#inversepayload--the-inverse-op-needs-its-own-body)) — an undo that dispatches an empty `create` cannot be cancelled by the redo's `delete`, and both hit the wire.

#### Queue events

The pipeline emits these on `VIEWER_MANAGER` so the UI can show a status badge:

| Event | When |
|---|---|
| `io:queue-stalled`  | A `withRetry`-exhausted refusal (network/5xx) hit the queue; fires once per stall episode. Carries `{ ownerUid, resourceName, pending }`. |
| `io:queue-resumed`  | The next op succeeded after a stall. |
| `io:queue-empty`    | The queue drained — last pending op resolved. Pair this with `io:queue-stalled` / `io:queue-resumed` to drive a "syncing… / offline / all changes saved" indicator. |

#### Lifecycle helpers

- `await resource.flush()` — waits for the queue to drain; resolves with the aggregate `IOResult[]`. Use before navigating away or closing the page.
- `resource.drop()` — abandons unstarted ops; their `.settled` resolves with `{ refused: true, code: "W_IO_QUEUE_DROPPED" }`. Started ops are not interrupted.

#### Rollback through the queue

Revert-on-refusal works through the queue too. On terminal refusal of op N (after retries exhausted), the resource runs **that call's** `inverseApply` and invalidates the history entry it pushed. It does not enqueue an inverse op: the forward op never reached the sink, so the destination has nothing to undo.

It deliberately does *not* call `APPLICATION_CONTEXT.history.undo()`. Dispatch is queued, so by the time op N is refused the top of the undo stack is rarely op N — and `undo()` is offered to every `XOpatHistoryProvider` first, any of which may consume it instead. Reverting through the entry's own handle hits the right item and cannot be intercepted. An entry the user already undid is skipped, so a revert never double-applies.

### Persistent outbox (durability across reloads)

Per-resource opt-in. When a resource declares `persistOutbox: true`, every queued op is mirrored into IndexedDB before sink dispatch and removed after settle. Pending ops survive page reloads, network outages, and tab crashes; they replay automatically on the next `initIO()`.

```ts
this.annotationResource = this.defineResource({
    name: "annotation",
    identityOf: item => String(item.incrementId),
    coalesce: true,
    merge: (prev, next) => ({ ...prev, ...next }),
    persistOutbox: true,                              // <-- enables IDB persistence
    persistMaxEntries: 5000,                           // refuse new ops past this cap
    persistMaxAgeMs: 7 * 24 * 60 * 60 * 1000,          // prune entries older than this on boot/sweep
    serialize, deserialize, validate,
});
```

#### Why IndexedDB

- localStorage is ~5 MB total, shared with everything; annotation ops (1–10 KB each) overflow it after a few hundred. IndexedDB has 50 MB+ generous quotas in practice and is the standard primitive for offline outboxes.
- Async API; doesn't block the main thread on big writes.
- xOpat ships a small `OutboxStore` wrapper at `src/classes/io/outbox-store.ts` (~150 LOC) — single DB `xopat-io-outbox`, single object store keyed by `clientOpId`, indexed by `[ownerUid, resourceName]` and `createdAt`.

#### Bounded by design

Three layers prevent runaway storage:

1. **Per-resource entry cap** (`persistMaxEntries`, default 5000). Pre-flight check before persisting. On overflow: refuse the new op with `code: "W_IO_OUTBOX_FULL"`, emit `io:outbox-full` (`{ ownerUid, resourceName, pending }`), and unless the caller set `rollbackOnAsyncRefuse: false` the local apply is reverted through the call's own `inverseApply`. **Never silently drops user work.**
2. **Age-based eviction** (`persistMaxAgeMs`, default 7 days). Sweep runs on boot. Stale ops are unlikely to be acceptable to the server anyway; emits `io:outbox-pruned` with the count.
3. **Quota awareness** via `navigator.storage.estimate()`. At 80% of available storage, emit `io:outbox-quota-warn` so the UI can surface a "your sync queue is filling up" banner.

In addition, **boot-time coalescing** is a free win: persisted ops for the same `identity` collapse pairwise as they re-enqueue (a queue of 1000 `create A; undo; redo; …` collapses to a handful of net-effect ops before any of them dispatch).

#### Replay semantics

On boot the resource:
1. Loads `OutboxStore` once (singleton across resources).
2. Prunes entries older than `persistMaxAgeMs` and emits `io:outbox-pruned`.
3. Lists remaining entries for `(ownerUid, resourceName)` ordered by `createdAt` and re-enqueues each in replay mode:
   - **Skips `apply()`** — the local state is whatever the bundle/cache restored it to; the persisted ops only need to sync the server.
   - **Skips history push** — the entry is just for sink-side catch-up.
   - Sets `meta.fromReplay: true` so sinks / guards can react if they want (most don't need to).
4. New user actions enqueue normally and tail any replayed ops. Strict causal order: server sees pre-reload ops before post-reload ops. This is enforced, not merely expected — the worker does not start until replay has finished re-enqueueing, so an op the user issues *during* boot cannot overtake ops that happened before it.
5. Emits `io:outbox-replayed` (`{ ownerUid, resourceName, count }`) when boot replay finishes — **including** when there was nothing to replay because IndexedDB is unavailable. A consumer waiting on it to learn that boot sync settled must not hang in the deployments where durability is missing.

#### Online / offline

The pipeline subscribes to `window.online` / `window.offline` once at construction. While offline, the worker pauses (no `withRetry` budget burned on doomed fetches); ops pile up in the queue. `io:queue-stalled` fires immediately on first enqueue offline. On `online`, the worker resumes from the head; `io:queue-resumed` fires.

#### A bound sink that has not registered yet

A sink is allowed to appear late. A module that must complete a handshake before it can serve anything registers seconds after boot, while the operator's `ENV.client.io.bindings` entry naming it exists from the first frame. That window is **not** a misconfiguration, and treating it as one is how a correct deployment ended up telling its users "data is being discarded" at every launch.

- `bindingsPending(ownerUid, capabilityId)` distinguishes the two situations an empty `bindingsFor` cannot: *nothing bound* (inert by design — normal, silent) versus *bound, but the sink is not here*.
- The worker **holds** on it, exactly as it holds when offline: the entry stays at the head of the outbox, `io:queue-stalled` fires once, and nothing is dispatched or rolled back. `registerSink` emits `io:sink-registered`, and every resource resumes on it.
- `dispatch` refuses with `W_IO_SINK_NOT_READY` rather than the `{ok: true}` it answers for a genuinely unbound capability — that `{ok: true}` was a write reported as stored and lost.
- `flush()` does **not** await a held queue. `flushAllResources()` sits behind the user's Save button with a spinner, and an entry waiting for a sink that may never register would spin forever; it answers `W_IO_SINK_NOT_READY` (or `W_IO_OFFLINE`) with a user-facing message and leaves the work queued.
- **A sink that never registers** therefore shows as a permanently stalled queue plus one operator-level `io:invalid-binding` — not as silent loss. There is deliberately no grace timer: any timeout would be wrong for somebody, and the stall event plus the outbox cap already bound the failure.
- Reporting is operator-facing only (console + event, never a toast), and the missing-sink case is keyed under the sentinel sink id `*` so it can never alias a real sink's key. It used to pass the joined id list, which for the common single-entry binding produced exactly the key the real sink would later use — so a genuine `supports` mismatch discovered after registration was dropped as "already reported".

A missing **kv driver** keeps the old loud treatment: KV has no queue to wait in, its handle would accept every write and return null forever, and the built-in drivers are all registered at bootstrap — so a name that is missing there is a typo, not a race.

#### Failure modes

| Failure | Behavior |
|---|---|
| IndexedDB unavailable (private mode, very old browser, opaque origin) | Resource degrades to in-memory queue (Phase 9 behavior). Emits `io:outbox-unavailable` (`{ ownerUid, resourceName, reason }`) once per persisted resource, and records the verdict on `XOpatStorageAvailability` so nothing else rediscovers it. Logged at `info`: a sandboxed iframe is a supported deployment, not a fault. App still works in-session; reload loses pending ops. |
| `def.serialize` throws | Op refused with `code: "W_IO_SERIALIZE_THREW"`, logged as an error, rolled back like any post-commit refusal. Deliberately **not** a stall signal — it is a local defect, not the network. (Before this, the throw escaped the worker: the entry was never settled and never removed, so every later write for that resource queued behind it forever.) |
| IDB quota exceeded mid-write | Op refused with `code: "W_IO_OUTBOX_WRITE"`; local commit reverted unless `rollbackOnAsyncRefuse: false`. |
| Per-resource cap reached | Op refused with `code: "W_IO_OUTBOX_FULL"`; `io:outbox-full` fires; auto-rollback if opted in. |
| Stale persisted op (server returns 4xx because the entity changed elsewhere) | Existing post-commit `io:refused` flow handles it; entry removed from IDB; rollback fires if opted in. |
| User navigates away mid-flush | Persisted entries remain; they replay on next boot. `await resource.flush()` resolves only when IDB is fully drained — call it from `beforeunload` if you need certainty. |

#### Cross-tab coordination (deferred)

Two tabs both have the same outbox in IndexedDB. Today both will replay on their boots — the server dedups via `clientOpId` so it's correct, just wasteful (each op runs twice). A future enhancement uses the Web Locks API + `BroadcastChannel` (the live-collab module already uses BroadcastChannel) so only one tab drains at a time. Not blocking; the at-least-once guarantee with idempotent `clientOpId` covers correctness.

### Session-aware sinks

When a resource is part of a live-collab session (host + guests via WebRTC), every peer's IO pipeline locally observes the same mutation: the originating peer applies the user's input directly; receiving peers apply the DELTA broadcast over the session channel. **Without filtering, every peer would also fire its own upstream `crud:*` dispatch — the server would see N copies of one logical action.**

The pipeline does not need special-case logic for this. The integration uses two existing primitives plus one reserved `ctx.meta.session` key.

**Convention**: when a session-aware owner calls `resource.create / update / delete` from a remote-DELTA-applied path, it sets `meta.session` with the origin info:

```ts
// inside the (future) annotations SessionSyncProvider's applyDelta(...) handler:
this.module.annotationResource.create(item, {
    apply:        () => fabric.add(item),
    inverseApply: () => fabric.remove(item),
    meta: {
        session: {
            isLocal:      false,                       // received from a remote peer
            sourceUserId: delta.sourceUserId,
            sessionId:    SESSION.getSessionId() ?? undefined,
        },
    },
});

// for local user actions, the same module annotates `isLocal: true`:
this.module.annotationResource.create(item, {
    apply, inverseApply,
    meta: { session: { isLocal: true, sourceUserId: SESSION.getLocalPeer()?.userId } },
});
```

**Sinks** that should only fire on locally-initiated ops add an `accepts` filter:

```ts
IO_PIPELINE.registerSink({
    id: "http-rest:annotations",
    supports: ["crud"],
    accepts: (ctx) =>
        // No session info → treat as local (single-user mode).
        // Session info present → fire only when this peer initiated it.
        !ctx.meta.session || ctx.meta.session.isLocal === true,
    async create(ctx, item) { /* … POST to server … */ },
    // … etc
});
```

Net result: only the originating peer fires upstream; the server sees ONE op per logical action; `clientOpId` dedup still covers retries from that single peer. No pipeline change required.

**Per-capability disable** (admin-controlled escape hatch): for blanket policies — e.g. "all guests have annotation CRUD silenced for the duration of the session" — add a tuple to `ENV.client.io.disabledCapabilities`:

```jsonc
"io": {
  "disabledCapabilities": [
    ["plugin.annotations", "crud:annotation"],
    ["plugin.annotations", "crud:preset"]
  ]
}
```

A future session controller can mutate this list on `session-started` / `session-ended` and call `IO_PIPELINE.invalidateAll()`. Heavier-handed than the `accepts` pattern (it disables the binding entirely, including legitimate local creates) so prefer the `accepts` pattern for normal session sync. The `disabledCapabilities` slot is here for scenarios where you want a hard guarantee that a guest cannot fire upstream at all.

**What lives where**:

| Concern | Where it's solved |
|---|---|
| Origin-tagging on local vs remote ops | The owner (annotations module's session provider). Pipeline-agnostic. |
| Single-peer upstream dispatch | Sink `accepts(ctx) => isLocal`. No pipeline change. |
| Cross-peer dedup of any leak through (e.g. misconfigured sink) | `clientOpId` (Phase 8) — server dedups across retries from the same peer. For cross-peer dedup, the future session DELTA should carry the originating peer's `clientOpId` so all peers reuse it; the server sees ONE id. |
| Blanket admin override during sessions | `ENV.client.io.disabledCapabilities`. |
| Multi-master conflict resolution (CRDT/OT) | Out of scope for the IO pipeline. Lives in the session sync layer.|

### Sync core, queued dispatch

`IOResource.create / update / delete` are **synchronous**: validate → sync guards → owner's `apply()` → history push all happen in the caller's frame. The sink dispatch is queued and runs as a microtask; the returned object carries a `.settled: Promise<IOResult>` for callers that want server confirmation.

```ts
const result = resource.create(item, { apply, inverseApply });
//   sync now:
//     result.ok            ← outcome of validate + sync guards + apply + history push
//     result.settled       ← Promise<IOResult> for the bound sinks' eventual outcome
//
// Fire-and-forget: just return; the queued dispatch runs in the background.
// Want server confirmation: `await result.settled`.
```

This restores the legacy mouse-move ergonomics — no microtask yield between user input and canvas paint when no guards or sinks are bound. Server validation becomes optimistic-with-rollback (see below).

#### Reliability hardening

Three additions make the sync-core design strictly safer than blocking on dispatch:

- **`clientOpId`**: every `create/update/delete` mints a UUID and writes it to `ctx.meta.clientOpId`. Sinks include it with the server request. Servers dedup on this id when the pipeline retries.
- **`withRetry(sink, options)`**: a small helper that wraps any sink with bounded retry + exponential backoff. Network blips become invisible to the user. Default: 3 attempts, exponential 200/400/800 ms, retry on `*_THREW` and 5xx codes.
  ```ts
  IO_PIPELINE.registerSink(withRetry(httpSink, {
      attempts: 3, backoff: n => 200 * 2 ** n,
      retryOn: r => r.code === 'W_IO_HTTP_NETWORK',
  }));
  ```
- **`rollbackOnAsyncRefuse`** (**default `true`**): if the queued dispatch resolves to refusal after retries are exhausted, the resource runs *that call's* `inverseApply` and invalidates the history entry it pushed, then emits `io:reverted`. The destination is authoritative, so a change it refused does not stay on screen. Reverting needs `inverseApply` — without it the resource warns once and leaves local state alone. Set `false` only where flicker is genuinely worse than divergence; the user is then informed by the `io:refused` (`phase: 'post-commit'`) toast and the owner reacts manually. **Know what that costs against a remote sink**: the refused change stays on screen and the destination keeps the old one, permanently, until something re-reads. It is a defensible trade for a local sink and a bad one for a networked destination — a sink author cannot see this flag from their side, so an owner choosing it should say why in a comment. `replaceAnnotation` used to opt out, on exactly the flicker argument, and no longer does: the refusals it can predict (a read-only annotation, an object another scope owns, an input a running analysis holds) are all caught at `pre-update` before anything is committed, so nothing snaps back for them, and what is left post-commit is a destination that really rejected the write — the case where divergence is least acceptable.

### Sync guards only

`registerGuard` handlers must return `IOResult` synchronously. Async checks (server permission round-trips, "are you sure?" dialogs that need user input) have two recommended patterns:

1. **Resolve at the call site**: the caller `await Dialogs.confirm(...)` BEFORE calling `resource.delete(...)`. Keeps UX patterns out of the pipeline.
2. **Server-side via sink**: the sink itself runs the round-trip during dispatch; refusal surfaces post-commit via `io:refused`, and `rollbackOnAsyncRefuse` (on by default) reverts the local commit.

There is no async-guard registry, and adding one would not help: a guard runs *before* the local commit, so awaiting there would either block the UI or let it commit anyway. The two patterns above are the whole story.

`runGuards` enforces this: a handler that returns a thenable is refused with `code: "W_IO_GUARD_ASYNC"` and its `ownerId` is logged. (Before that check existed, an `async` handler refused *every* operation it saw with `reason: undefined` — a Promise is truthy and has no `ok` — which read as a silent no-op with an empty toast.)

### Auto-history (undo/redo for free)

Every `IOResource.create / update / delete` call that includes both an `apply` and an `inverseApply` callback automatically pushes a history entry through `APPLICATION_CONTEXT.history`, in the caller's frame, right after `apply()` succeeds. (The push is queued on the history's internal promise chain, so the entry *commits* on the next tick — `await history.whenIdle()` if you need to observe it.) Authors get undo/redo without writing a single `pushExecuted` call.

Pass `apply` **without** `inverseApply` when an outer `history.push` already owns undo for a whole gesture. If you still want per-item revert-on-refusal there, pass `inverseApply` **and** `skipHistory: true` — otherwise each item records a second, redundant entry.

```ts
// inside the owner module
await this.annotationResource.create(item, {
  apply:        () => fabric.add(item),                  // local commit on first run + redo
  inverseApply: () => fabric.remove(item),               // local rollback on undo
  meta: { kind: "create", object: item },
});

// User presses Cmd-Z later → APPLICATION_CONTEXT.history.undo() runs:
//   1. inverseApply()                       (local rollback)
//   2. annotationResource.delete(id, { meta: { fromUndo: true, … } })
//      ↳ sinks run; skipGuards=true (the forward op was already vetted) and
//        skipHistory=true so there is no recursive push
//
// Cmd-Shift-Z (redo):
//   1. apply()                              (local re-commit)
//   2. annotationResource.create(item, { meta: { fromRedo: true, … } })
//      ↳ same skipGuards / skipHistory semantics
```

**Inverse direction table** (the pipeline's only domain knowledge):

| Original direction | Inverse on undo | Wire body the inverse carries |
|---|---|---|
| `create` | `delete` | none — addressed by the id derived from the created item via `identityOf` |
| `delete` | `create` | `inversePayload` — the full item snapshot |
| `update` | `update` | `inversePayload` — the *reverting* patch |

#### `inversePayload` — the inverse op needs its own body

`inverseApply` repairs **local** state. It says nothing about what the sink
receives, and the inverse op's body is *not* the forward op's: undoing a
`delete` means re-creating the whole item, undoing an `update` means sending
the patch that reverts it. Supply it whenever you pass `apply` + `inverseApply`
on a `delete` or an `update`:

```ts
const restoreClone = factory.copy(annotation);           // snapshot before removal
this.annotationResource.delete(annotation.incrementId, {
  apply:          () => this._deleteAnnotation(annotation),
  inverseApply:   () => this._addAnnotation(restoreClone),
  inversePayload: restoreClone,        // ← what the sink re-creates on undo
});
```

A thunk (`inversePayload: () => snapshot()`) defers the capture to undo time.
Omitting it where required is not fatal — the resource logs one warning per
resource+direction and dispatches the inverse without a body, so a sink that
undeletes by id still works — but the server will otherwise resurrect an empty
record. Creates need nothing: the inverse `delete` is addressed by the id
`identityOf` reads off the created item.

This matters most **with coalescing on**: `create A; delete A` cancels out
before either reaches the wire, so the `create` emitted by the subsequent undo
is the only one the server ever sees. Without `inversePayload` it is empty.

**Reserved `ctx.meta` keys** the pipeline writes (sinks / guards may read):

| Key | Set when |
|---|---|
| `meta.clientOpId` | Stable per-call UUID for sink-side dedup on retry. |
| `meta.fromUndo: true` | This dispatch is the undo replay of a previously-recorded entry. |
| `meta.fromRedo: true` | This dispatch is the redo replay. |
| `meta.phase: 'post-commit'` | Set on the queued dispatch context (so sinks / `io:refused` listeners can distinguish sync local commit from async server outcome). |
| `meta.localId` | The owner's own stable identity for the item (`def.identityOf`), on **every** direction — including `create`, where `ctx.itemId` is absent by design (the id is the destination's to assign, and a REST sink would otherwise `POST /resource/<id>`). A sink that stores remotely uses it to correlate the id it gets back with the object the caller is looking at; without it, `create` gives a sink nothing to key on. Absent only when the owner declares no `identityOf` (the pipeline's synthetic coalescing key is a uniqueness device, not an identity, and is never published). |

**Sinks do not need to know about history.** They keep implementing `create / update / delete` exactly as they would for user-driven calls. If they want to opt out of replays, they read `ctx.meta`:

```ts
// e.g. a telemetry sink that only counts user actions:
{
  id: "user-action-counter",
  supports: ["crud"],
  accepts: (ctx) => !ctx.meta.fromUndo && !ctx.meta.fromRedo,
  async create(ctx, item) { incrementCounter(ctx.resourceName); return { ok: true }; },
  // … etc
}

// e.g. a live-sync sink that doesn't want to re-create on redo
// (because the server still has the original record):
{
  id: "live-sync",
  supports: ["crud"],
  accepts: (ctx) => !ctx.meta.fromRedo,
  // … create/update/delete still receive fromUndo replays so the server
  //    stays in lockstep with the user's perceived undo timeline
}
```

Default (no `accepts` filter) is the safe choice for most server-backed sinks: undoing a delete re-creates on the server; redoing a delete re-deletes; the server stays in lockstep with what the user sees on screen.

**Escape hatches** (in `IOResourceMutateOptions`):

- Omit `inverseApply` → no history entry pushed; the call is fire-and-forget.
- Set `skipHistory: true` → suppresses the push for one call. Used internally by replay closures to prevent recursion; bulk-import paths can also use it.
- Set `skipGuards: true` → bypasses the guard phase. Replay closures use it because the guards already passed when the original call ran.

**Coexistence with the existing `XOpatHistoryProvider` registry** (`src/classes/history.ts`): the Provider chain keeps gating "can we undo right now?" via `canUndo / canRedo` (annotations' free-form tool, e.g., uses this to handle micro-undo of a brush stroke without unwinding a full IO entry). IO-pushed entries live in the same stack the providers fall back to. No change to the public history API.

### Abortable CRUD via guards

A **guard** is a registered handler that runs in the `pre-create` / `pre-update` / `pre-delete` phase. It can abort the operation before any local commit or sink call. Any code may register a guard against any resource — including resources owned by other modules. This is the duplication-killer: plugin authors declare a resource and get external-vetoable CRUD for free, instead of inventing their own `*-before-*` event protocol.

```ts
// e.g. inside a permission-check plugin:
const dispose = IO_PIPELINE.registerGuard({
  ownerId: "permission-check",
  resource: "annotation",          // matches ctx.resourceName, "*" = any
  direction: "pre-delete",          // "pre-create" | "pre-update" | "pre-delete" | "*"
  priority: 100,                    // higher runs first; default 0
  // SYNC. A handler that returns a Promise is refused with `W_IO_GUARD_ASYNC`
  // and named in the console — see "Sync guards only" above.
  handler: (ctx, payload) => {
    if (currentUser.role !== "admin") {
      return {
        ok: false, refused: true,
        reason: "non-admin attempted delete",
        userMessage: "Only admins can delete annotations.",
        code: "W_PERM_DENIED",
      };
    }
    return { ok: true };
  },
});
// dispose() to unregister
```

**Order of operations** for `await resource.create(item, { apply })`:

```
1. resource def's validate(item, ctx)             ← owner's first-line check
2. matching guards in priority order              ← Phase 4 (third-party vetoes)
3. apply()                                        ← Phase 4 (owner's local commit)
4. resource def's serialize(item, ctx)
5. IO_PIPELINE.dispatch(ctx)                      ← bound sink(s) for crud:<name>
```

If any of 1, 2, 3 refuses, steps 4–5 are skipped. The refusal is returned to the caller AND surfaced as a toast (via `userMessage`) AND emitted on `VIEWER_MANAGER` as `io:refused` — same channel as sink refusals; observers distinguish phases by inspecting `ctx.direction` (`pre-create` vs `create`).

**Two-step idiom** for callers that want to gate a local commit and run persistence in a separate step:

```ts
// `surface: true` — this aborts a user gesture, so the user must hear why.
const veto = ann.canDelete(itemId, meta, { surface: true });
if (!veto.ok) return;                       // guard refused — toast shown
removeFromCanvas(itemId);                   // local commit
ann.delete(itemId, { skipGuards: true });   // persist; don't re-run guards
```

**The probes are silent by default.** `canCreate / canUpdate / canDelete` are *questions* — UI
that greys out a control by asking "may I delete this?" would otherwise emit a user-facing error
toast on every render. Pass `{ surface: true }` only from the place that aborts an actual gesture
on the answer; a probe whose "no" merely disables a button should stay quiet and put the reason in
the control's tooltip.

This is also how you vet a *group* all-or-nothing: `canDelete` every item first, bail on the first veto, then run the real calls with `skipGuards: true`, so a mid-loop refusal cannot leave half a gesture applied (`annotations-canvas.js` `deleteObject` / `deleteSelection`).

Per-viewer logic lives inside the guard handler (read `ctx.viewerId`); the spec has no `viewerId` field so authors can express any condition.

**Admin disable**: a guard's `ownerId` listed in `ENV.client.io.disabled` silences all guards from that owner, consistent with how sinks/capabilities/kv are silenced.

### On-the-fly hydration via streamed query

Bundle import is a one-shot whole-set restore. For collections too large to fetch up front (tens of thousands of annotations per slide), use the streamed `query` direction: the owner subscribes to viewport / background events, dispatches a query with the relevant params, and receives matching items as they arrive from the bound sink.

```ts
// Owner side (e.g. inside annotations module)
private _hydrateCtrl?: AbortController;

private async _hydrateFor(viewer) {
  this._hydrateCtrl?.abort();
  this._hydrateCtrl = new AbortController();
  const params = {
    viewerId:     viewer.uniqueId,
    backgroundId: currentBackgroundId(viewer),
    bbox:         viewer.viewport.getBounds(true),
    zoom:         viewer.viewport.getZoom(true),
  };
  try {
    for await (const ann of this.annotationResource.query(params, { signal: this._hydrateCtrl.signal })) {
      if (this._byIncrementId.has(ann.id)) continue;   // dedup
      this._addToCanvas(ann);                          // render incrementally
    }
  } catch (e) {
    if ((e as any)?.name !== "AbortError") console.warn(e);
  }
}

// Wire to the events that already exist in xOpat / OSD:
VIEWER_MANAGER.broadcastHandler("open", e => this._hydrateFor(e.eventSource));
VIEWER_MANAGER.broadcastHandler("zoom", debounce(e => this._hydrateFor(e.eventSource), 200));
VIEWER_MANAGER.broadcastHandler("pan",  debounce(e => this._hydrateFor(e.eventSource), 200));
```

Sink author side (server-backed, NDJSON streaming). The sink module composes its own options (defaults + `IO_PIPELINE.sinkOverrides("live-sync")`) and hands them to the factory's `getOptions`:

```ts
IO_PIPELINE.registerSink({
  id: "live-sync",
  supports: ["crud"],
  async *query(ctx, params) {
    // The owning module is responsible for assembling baseURL etc.; this
    // is just the runtime read.
    const opts = composeLiveSyncOptions();   // defaults + IO_PIPELINE.sinkOverrides("live-sync")
    const signal = (ctx.meta as any).signal as AbortSignal | undefined;
    // HttpClient — never native fetch: it carries JWT/CSRF, proxy aliases and
    // secureMode policy, and `stream()` parses NDJSON line by line for us.
    const client = new HttpClient({ baseURL: opts.baseURL });
    const stream = await client.stream(ctx.resourceName, {
      method: "POST",
      body: {
        backgroundId: params.backgroundId,
        bbox: params.bbox,
        zoom: params.zoom,
      },
      signal,
    });
    for await (const item of stream.lines()) yield item;
  },
  // + create / read / update / delete for live per-item sync.
});
```

**What the pipeline does**: routes the call to the **first** bound CRUD sink whose `query` method exists and whose `accepts(ctx)` (if defined) returns true; subsequent sinks are not consulted. Sinks declined via `accepts` emit `io:rejected-by-accepts`; if no sink could serve the query, `io:fully-refused` fires and the consumer iterator yields nothing.

**What the pipeline does not do**: dedup, eviction, caching, params-shape interpretation. All of that stays in the owner — domain decisions don't belong in shared infrastructure. Per-item `deserialize` and `validate` from the resource def DO run; a single bad item is logged and skipped so the stream keeps flowing.

**Cancellation**: pass `meta.signal` from the owner; the sink reads `ctx.meta.signal` and forwards to `fetch`. Breaking out of the consumer's `for await` loop also closes the AsyncGenerator and gives sinks written with `async function*` a natural cleanup point.

### Triggering a programmatic flush

```ts
await this.io.flush();                              // export this owner now
await this.io.flush({ viewerId: someViewer });      // for one viewer
await this.io.flush({ capabilityId: 'bundle-export' });
```

`UTILITIES.export()` (the user-facing "Export" action) calls `IO_PIPELINE.flushBundleExport()` for every owner in one go.

### `Save` vs `Export` (user-facing distinction)

The app bar exposes two distinct verbs:

| Verb | Implementation | When to use |
|---|---|---|
| **Save** (`UTILITIES.save()`) | Drains every CRUD outbox via `IO_PIPELINE.flushAllResources()`, then calls `flushBundleExport({ skipFileFallback: true })`. Reports outcome via toast. Falls through to **Export** when `IO_PIPELINE.hasRemoteBundleSinks()` returns `false` — i.e. only **user-recoverable** sinks count (`http-rest`, `github`, `dicom-sink`, custom remote sinks). The in-memory Rule-5 fallbacks (`post-data`, `session-memory`), `file-download`, and import-only `file-upload` are **not** counted: a deployment with only those bound for bundle-export degrades to Export instead of pretending to save. | The everyday "persist my work" button. Honours the admin's sink bindings strictly — a refusal surfaces as an error, never a silent file download. |
| **Export** (`UTILITIES.export()`) | Calls `flushBundleExport()` with the default fallback enabled, then **always** triggers `file-download` for the serialized HTML form. | The explicit "give me a file" escape hatch. Useful for archival, debugging, or when remote persistence is unavailable. |

The pipeline's hardcoded **`file-download` last-resort fallback** (inside `runOneBundleExport`) is gated by `flushBundleExport`'s new `skipFileFallback` option:

- `skipFileFallback: false` (default) — when every bound sink refuses, the pipeline silently hands the payload to `file-download` so the user always walks away with their data. Used by **Export**.
- `skipFileFallback: true` — refusals stay refusals; the caller surfaces them. Used by **Save** so a misconfigured deployment never produces a confusing local file.

Programmatic equivalent:

```js
if (IO_PIPELINE.hasRemoteBundleSinks()) {
  await IO_PIPELINE.flushAllResources();
  const results = await IO_PIPELINE.flushBundleExport({ skipFileFallback: true });
  // Inspect `results` for refusals.
} else {
  await UTILITIES.export();   // degrade to file-download
}
```

`IO_PIPELINE.flushAllResources()` iterates every resource registered through `XOpatElement.defineResource(...)`. Resources self-register with the pipeline on construction so callers don't have to track them.

---

## Admin side: binding capabilities to sinks

The IO admin block lives in **`src/config.json`** under the active `client.<key>.io` entry — server-side only, never URL-modifiable. The xOpat loader reads it (closure-captured `ENV.client.io`) at pipeline bootstrap; plugins/modules don't access it directly. They get the configured behavior through the `IO_PIPELINE` API.

```jsonc
// src/config.json
{
  "active_client": "prod",
  "client": {
    "prod": {
      "domain": "...",
      "image_group_server": "...",
      // ... other XOpatClientConfig fields ...
      "io": {                                      // admin IO block
        "disabled": ["some-plugin-id"],
        "bindings": {
          "annotations": {
            "bundle-export": ["file-download", "http-rest:annotations-bundles"]
          }
        },
        "sinkOverrides": {
          "http-rest:annotations-bundles": {
            "proxy": "cerit",
            "baseURL": "/api/v1/bundles",
            "auth": { "contextId": "core", "types": ["jwt"], "required": true }
          }
        }
      }
    }
  }
}
```

The shape of `client.<key>.io`:

```jsonc
{
  // Hard-disable IO for these owners (highest precedence).
  "disabled": ["some-plugin-id"],

  // Bindings keyed by ownerId (the include.json id) and capabilityId.
  // An entry is a sink id, OR `{ "sink": id, "config": {...} }` to configure
  // that sink for THIS (owner, capability) only — see "Per-binding config".
  "bindings": {
    "annotations": {
      "bundle-export": ["file-download", "http-rest:annotations-bundles"],
      "crud:annotation": ["http-rest:annotations-live"],
      "crud:preset": []
    },
    "recorder": {
      "bundle-export": [
        { "sink": "github", "config": { "pathTemplate": "cases/{backgroundId}/rec/{viewerId}.json" } }
      ]
    },
    "core": {
      "bundle-export": ["post-data"]
    }
  },

  // Per-deployment overrides keyed by sink id. Each sink's owning module
  // composes these with its own defaults inside the sink factory's
  // `getOptions` callback. The pipeline does NOT compose options for the
  // module — it only exposes this slot via `IO_PIPELINE.sinkOverrides(id)`.
  "sinkOverrides": {
    "http-rest:annotations-bundles": {
      "proxy": "cerit",
      "baseURL": "/api/v1/bundles",
      "auth": { "contextId": "core", "types": ["jwt"], "required": true }
    }
  }
}
```

### Resolution order (highest to lowest)

1. `ENV.client.io.disabled` includes the owner (or `disabledCapabilities` names the pair) → IO inert.
2. `ENV.client.io.bindings[owner][capability]` defined → that exact list.
2.5. a **runtime binding claim** for that pair → the claimed list (see below).
3. include.json `io.defaultBindings[capability]` defined → that list.
4. capability `kind === "bundle"` → fallback to `["post-data"]` (legacy session export).
5. capability `kind === "crud"` → `[]` (inert).

Use `IO_PIPELINE.isEnabled(ownerUid, capabilityId)` (or `this.io.isEnabled(...)`) to introspect.

### Runtime binding claims

`registerSink` lets a module *offer* a destination; it does not let it *become*
one. Only the operator (rule 2) or the capability's own author (rule 3) can route
anything to it. That is the right default for a sink that competes with others —
and the wrong one for a module that **is** the backend the deployment runs
against. An embedded host (EMPAIA Workbench, a LIS shell) registers a sink that
is the only correct destination for the session it created, and if an operator
forgets a binding line the feature is not degraded, it is silently inert. That is
how integrations end up persisting *beside* the pipeline instead of through it.

```ts
this._claims = [
    IO_PIPELINE.claimBinding("annotations", "crud:annotation", ["my-sink"], this.uid),
];
// dispose on teardown
```

- The claim is **below** `ENV.client.io.bindings`: an operator who writes a
  binding still decides, and `disabled` / `disabledCapabilities` still silences
  everything. The claim only fills a hole; it never overrides a decision.
- `owner` is the **capability owner** (`"annotations"`, or its uid), not the
  claimant. `claimantUid` is yours, and is what conflict reports name.
- Several claimants for one pair are merged and de-duplicated, with one warning
  and an `io:binding-claimed` event. For CRUD (`until-refusal`) two claimants
  means two destinations, which is nearly always a packaging mistake.
- Trust-wise a claim is code, at the same level as `registerSink` — anything that
  can claim could already have registered the sink. It cannot read or widen
  anything the operator closed.

`IO_PIPELINE.listBindingClaims()` shows what claimed what, including claims an
explicit binding is currently overriding.

Claim only what you genuinely own. A sink that is *an* option among several
(a storage backend, an export target) belongs in the operator's config, not in
a claim.

### Per-binding config — one sink, many differentiated outputs

`sinkOverrides` is keyed by **sink id alone**, so every owner routed to `github`
shared one `pathTemplate`. And an admin cannot register a second instance:
sink ids are hardcoded by the module that registers them (`github`, `mlflow`),
so the "distinct ids" pattern below is available to *module authors*, not to
someone editing `ENV.client.io`.

A binding entry may therefore carry its own config:

```jsonc
"bindings": {
  "annotations": {
    "bundle-export": [
      { "sink": "github", "config": { "pathTemplate": "cases/{backgroundId}/annotations.json" } }
    ]
  },
  "recorder": {
    "bundle-export": [
      { "sink": "github", "config": { "repo": "org/media",
                                      "pathTemplate": "cases/{backgroundId}/rec/{viewerId}.json" } }
    ]
  }
}
```

Precedence inside the sink's own option composition (highest first):

```
binding.config  →  sinkOverrides[sink]  →  include.json block  →  module defaults
```

Bare strings keep working and are equivalent to `{ sink: id }`. The pipeline
never interprets `config` — it normalizes, freezes it, and hands it back
through `IO_PIPELINE.bindingConfig(ownerUid, capabilityId, sinkId)`, which the
sink calls from its own `getOptions(ctx)`. Nothing is threaded through the
dispatch sites, so runtime `.mjs` sinks work unchanged.

**Trust.** `ENV.client.io` is server-delivered and is *not* reachable from URL
params or an imported session bundle, so `config` sits at exactly the same
trust level as `sinkOverrides` — `proxy` / `baseURL` / `auth` / `repo` are
legitimate here. If bindings ever become contributable by a less trusted
source, that invariant must be re-litigated first.

### Path templating & sanitization

Sinks address storage by interpolating context fields into an operator
template. Use `IO_PIPELINE.formatPath(template, ctx, options)` — never a
hand-rolled interpolator.

| token | value |
|-------|-------|
| `{ownerId}` `{ownerUid}` `{xoType}` `{direction}` `{capabilityId}` | verbatim |
| `{capabilityGroup}` | `bundle-*`→`bundle`, `crud:x`→`crud`, `kv:x`→`kv` |
| `{viewerId}` | `_global` when the dispatch is global-scope |
| `{backgroundId}` | `_any` when the owner is not slide-scoped |
| `{key}` | the bundle key (`<viewerId>::<backgroundId>`), `_default` when empty |
| `{resourceName}` `{itemId}` | CRUD only |

Two rules that bite:

- **`{capabilityId}` is not round-trip safe.** Export dispatches carry
  `bundle-export`, restores carry `bundle-import`, so a template using it
  reads back from a different location than it wrote. Use
  `{capabilityGroup}`.
- **Substituted values are untrusted.** `viewerId` / `backgroundId` come from
  the session config, `itemId` from the CRUD caller (a remote peer in live
  collaboration). `formatPath` reduces every value to a single segment
  matching `[A-Za-z0-9._-]`, never `.`/`..`, never empty, ≤128 chars. The
  *template* is trusted and keeps its `/`. `mode: "raw"` (commit messages and
  other non-addressing text) only strips control characters.

Regression suite: `test/legacy/io/path-template.mjs` (`npm test -- --grep "legacy: io/"`).

---

## Built-in sinks

| id | Supports | Purpose |
|----|----------|---------|
| `post-data` | `bundle` | Writes into the global `POST_DATA` dict. Preserves the legacy HTML-form session export emitted by `serializeApp()`. Default fallback for unbound bundle capabilities. |
| `file-download` | `bundle` | Triggers `UTILITIES.downloadAsFile` with the payload. Owners can hint `ctx.meta.fileName` / `ctx.meta.fileExt`. |
| `file-upload` | `bundle` | Pops a file picker, reads the file, returns the contents. Used as the readable side of session restore from disk. |
| `http-rest` | `bundle`, `crud` | Generic `HttpClient`-backed sink. Per-deployment overrides in `ENV.client.io.sinkOverrides[<id>]` (see above). |

## Module-provided sinks

Shipped as modules rather than built in: they register a sink at load time and are inert unless an admin binds a capability to them. Enable the module, then bind. Each holds its upstream credential **server-side** in a `server.secure.proxies.<alias>` block — never on the client.

| id | Provided by | Supports | Purpose |
|----|-------------|----------|---------|
| `github` | `modules/io-github-sink` | `bundle` | One file per bundle in a git repo; every export is a commit. ≤ 1 MB per file. See its [README](../modules/io-github-sink/README.md). |
| `mlflow` | `modules/io-mlflow-sink` | `bundle`, `crud` | Records become MLflow experiments/runs/metrics/tags. The record layout is chosen by a named template or a registered mapper, so the same owner data can take different shapes per deployment. See its [README](../modules/io-mlflow-sink/README.md). |
| `dicom-sr-annotations` | `plugins/dicom` | `bundle`, owners `["annotations"]` | Annotations as DICOM SR, STOW'd to the configured DICOMweb store. Declares its owner restriction, so binding anything else to it is reported at boot. |

Both `github` and `mlflow` count as **remote** bundle sinks — `NON_REMOTE_BUNDLE_SINKS` is an explicit deny-list (`file-download`, `post-data`, `session-memory`, `file-upload`), so anything else drives the Save-vs-Export decision via `hasRemoteBundleSinks()`.

### Round-trip contract

A transport sink **must round-trip payloads byte-equivalent**. The sink may decode wire encodings (base64, gzip, …) so the owner gets back the same logical payload it produced, but it **must not interpret the payload's semantics** — no `JSON.parse`, no schema-aware reshaping, no whitespace stripping. Decoding bundle contents (string → object, array → typed model, etc.) belongs in the owner's `importBundle`, because only the owner knows the payload's format. Sinks that violate this contract silently break any owner that round-trips a JSON string the owner expects to parse itself.

### Sink support contract

`IOSink.supports` is the sink's declaration of what it can serve, and the
pipeline reads it:

```ts
supports: ["bundle"]                                        // legacy short form
supports: { kinds: ["bundle"], owners: ["annotations"] }    // full descriptor
```

`owners` / `capabilities` / `resources` are anchored globs (`*` = any run of
characters); an absent field means "any". Declare statically-known limits here
rather than in `accepts` — the pipeline then validates every resolved binding
at registration time and reports `io:invalid-binding` (console error + event)
for each mismatch, *before* any data is at risk. `accepts` remains the right place for
genuinely runtime conditions (missing config, wrong viewer state) and may
return `{ accept: false, reason, userMessage }` instead of a bare `false` so
its reason reaches the user when nothing else takes the dispatch.

**Declining is quiet only while another bound sink succeeds.** Bind
`["dicom-sr-annotations", "post-data"]` for several owners and each takes what
it serves, silently. But if *every* bound sink declines, the dispatch resolves
to a `W_IO_NO_SINK_ACCEPTED` refusal quoting the collected reasons — it does
**not** resolve to `{ok:true}`. (It used to: the CRUD full-refusal check was
gated on `attempted`, which sinks that declined never incremented, so an
all-declined write returned success and `IOResource` committed an item that no
destination ever stored.)

Custom sinks are registered with `IO_PIPELINE.registerSink(mySink)` — they're plain objects implementing the `IOSink` ambient interface. Distinct ids let a module author route different owners to different `http-rest` instances (for an admin, prefer per-binding config above); the owning module composes its own defaults with the admin override slot:

```ts
IO_PIPELINE.registerSink(makeHttpRestSink({
  id: "http-rest:annotations-live",
  getOptions: () => ({
    // module's defaults (baseURL fallback, etc.) ...
    ...IO_PIPELINE.sinkOverrides("http-rest:annotations-live"),
  }),
}));
```

---

## Refusal semantics

Any hook (validator, sink, or owner method) may return:

```ts
{ ok: false, refused: true, reason: "...", userMessage?: "...", code?: "..." }
```

### How many sinks run

A binding list can name several sinks. There are exactly two iteration policies, plus one selection rule for streams — every path funnels through the same gate (`selectGatedSinks`) and the same outcome classifier (`runSinkPass`), so declines, throws and `io:*` events look identical whichever applies.

| Policy | Used by | Meaning |
|---|---|---|
| **all** | bundle export, restore | Every gated sink runs. One refusing does not stop the rest — a local file copy is still worth having when the remote refused. |
| **until-refusal** | CRUD dispatch | Sinks run in binding order until one refuses; that refusal is the result. A sink that *cannot perform the op* (`W_IO_UNSUPPORTED`) is a misrouted binding, not a verdict on the data, so it does not stop the others. |
| **first-match** *(selection, not a pass)* | streamed `query` | One stream, one sink: the first gated sink implementing `query`. |

Restore additionally applies **last non-empty payload wins** — every readable sink is read, and each non-empty payload is handed to `importBundle` in binding order.

- **Errors thrown** from any hook are caught, converted to `{ ok: false, refused: true, reason: e.message, code: 'W_IO_*_THREW' }`, and surfaced the same way as refusals. A throwing sink never short-circuits its siblings.
- A refusal emits `io:refused` on `VIEWER_MANAGER` and shows `Dialogs.show(userMessage ?? reason, …)` automatically. For CRUD the caller also gets it back via `.settled`, and the resource reverts the local commit by default (see [`rollbackOnAsyncRefuse`](#sync-core-queued-dispatch)).

### Three distinct refusal events

| Event | When |
|-------|------|
| `io:refused`              | A sink tried (`writeBundle` / `readBundle` / `create` / …) and returned `{ refused: true }`, or threw. Toast shown automatically. |
| `io:rejected-by-accepts`  | A bound sink opted out before attempting — either its declared `supports` does not cover this context, or `accepts(ctx)` declined. Informational; pairs with a `console.info`. Payload fields: `sinkId`, `reason`. |
| `io:fully-refused`        | Every bound sink for one dispatch ended in refusal/error/decline — the call wrote nothing. Always a sign of a misconfigured binding. Carries the synthesized `W_IO_NO_SINK_ACCEPTED` result in `result`, plus `declines`. Surfaced to the user unless an individual sink already showed its own `userMessage`. |
| `io:invalid-binding`      | Config-time, not dispatch-time: a resolved binding names a sink whose `supports` cannot serve it (wrong kind/owner/capability/resource), or names only unregistered sinks/drivers. Reported once per (owner, capability, sink) as a `console.error` + this event — operator-facing, so no toast (it fires during boot and the end user cannot act on it). |

These events let monitoring code distinguish between "sink said no, but other sinks may have succeeded" (`io:refused`), "this sink was the wrong one for this ctx" (`io:rejected-by-accepts`), "nothing wrote anywhere" (`io:fully-refused`), and "this binding was never going to work" (`io:invalid-binding`).

For Use case B from the verification plan — admin binds `module.some-other.bundle-export = ["remote-anno"]` by mistake, and `remote-anno` only handles annotations — the user sees:

- a toast with the sink's `userMessage` (from `surfaceRefusal`),
- `io:refused` mirrored on `VIEWER_MANAGER`,
- `io:fully-refused` mirrored on `VIEWER_MANAGER` (no other sink ran).

Admin then either fixes the binding, or chooses graceful fallback by writing `["remote-anno", "post-data"]` (mirror semantics — post-data only runs because remote-anno refused; legitimate annotations dispatches still go to **both** because both succeed).

---

## Key/value storage (`kv` capability)

Beyond bundle export/import and per-element CRUD, every owner — including a synthetic `core` owner the loader registers at boot — has access to **namespaced key/value storage** through the same pipeline. This subsumes the old `XOpatStorage.Cache/Cookies/Data` layer: those classes still exist, but they're now thin façades over `IO_PIPELINE.kv(ownerUid, "kv:<namespace>")`.

### Conventional namespaces

| Capability id | Default driver | Mode | Replaces |
|---|---|---|---|
| `kv:cache`    | `local-storage`   | sync  | `XOpatStorage.Cache`    |
| `kv:cookies`  | `cookies`         | sync  | `XOpatStorage.Cookies`  |
| `kv:session`  | `session-storage` | sync  | direct `sessionStorage` (where applicable) |
| `kv:data`     | `post-data`       | async | `XOpatStorage.Data` |
| `kv:<custom>` | none — declare in include.json `io.defaultBindings` or via app config |

### Drivers

A KV driver is **any object satisfying the localStorage interface** (`getItem/setItem/removeItem/key/length/clear`). `window.localStorage` plugs in unchanged; the host registers it at pipeline bootstrap. Drivers self-describe sync vs. async, "shared" vs. "owned" (shared drivers get automatic `<ownerUid>::<sanitizedKey>` prefixing to prevent collisions), and optional `contextAware` mode where the driver receives the active `IOContext` to route per-context itself.

```ts
// Remote-backed drivers talk through HttpClient, never native fetch.
const kvApi = new HttpClient({ baseURL: "/kv" });

IO_PIPELINE.registerKVDriver({
  id: "redis-bridge",
  mode: "async",
  shared: true,
  async getItem(k) { return await kvApi.request(encodeURIComponent(k), { expect: "text" }); },
  async setItem(k, v) { await kvApi.request(encodeURIComponent(k), { method: "PUT", body: v }); },
  async removeItem(k) { await kvApi.request(encodeURIComponent(k), { method: "DELETE" }); },
  // … key, length, clear
});
```

### Per-owner usage

Plugins/modules already get sync per-element accessors automatically:

```ts
this.cache.set("autoOpen", true);            // kv:cache  (sync)
this.cookies.set("token", "...");            // kv:cookies (sync)
await this.data.set("draft", largeBlob);     // kv:data   (async)
```

For custom namespaces, call the pipeline directly:

```ts
const drafts = IO_PIPELINE.kv(this.uid, "kv:drafts");
drafts.set("page-1", payload);
```

### Binding resolution for `kv:*`

In addition to the bundle/crud rules:

1. `ENV.client.io.disabled[ownerId]` → empty (storage no-ops; reads return `defaultValue`).
2. `ENV.client.io.bindings[ownerId]["kv:foo"]` → that exact list (per-owner override).
3. include.json `io.defaultBindings["kv:foo"]` → that list (plugin-author default).
4. **Inherit from `core`** — `ENV.client.io.bindings.core["kv:foo"]` if set. The "redirect everything" knob: change once, all plugin/module caches follow.
5. Built-in namespace fallback (`local-storage` for `kv:cache`, `cookies` for `kv:cookies`, `session-storage` for `kv:session`, `post-data` for `kv:data`).

A `kv` capability bound to **multiple drivers** mirror-writes to all of them on `setItem` (useful for "save locally + async ship to server"); reads consult them in order until one returns non-null.

### Sync ↔ async safety

`XOpatStorage.Cache/Cookies` (and any caller using `IO_PIPELINE.kv(uid, ...)` without `{ sync: false }`) are sync. If an admin binds a sync namespace to an async driver, handle construction throws `IOError` (`code: "W_IO_KV_SYNC_ASYNC_MISMATCH"`) listing the offending drivers. Servers and other async backends must use `kv:data` (or another async namespace).

### Key sanitization

User keys pass through `IO_PIPELINE.sanitizeKey(s)` — anything outside `[A-Za-z0-9._-]` is replaced with `_`. On shared drivers the result is then prefixed with `<ownerUid>::` to avoid cross-owner collisions. Owners with `shared: false` drivers see the raw sanitized key.

Owner is the **only** namespace axis. KV keys are deliberately *not* scoped by the deployment cache key (`src/classes/app/deployment-key.ts`) — that key scopes the boot session caches and the plugin-autoload cookie only. Two deployments on one origin therefore share `AppCache` / `AppCookies` entries; a deployment that must not share them binds `kv:*` to the `memory` driver in `ENV.client.io.bindings.core`.

### Value encoding

Drivers are string-only (`localStorage`, `document.cookie`), so `handle.set(key, value)` encodes:

| Value | Stored as |
| --- | --- |
| `string` | verbatim — every pre-existing entry keeps its exact bytes |
| `number` / `boolean` | `String(value)`; `get` coerces `"true"`/`"false"` back to booleans |
| anything else | `"json:" + JSON.stringify(value)`, decoded by `get` |
| `undefined` | nothing — the key is deleted |

The envelope is an explicit U+0001 sentinel rather than a `{`/`[` heuristic, so a user string that happens to look like JSON stays a string. `getItem`/`setItem` are the raw, unencoded pair — that is what `XOpatStorage.*.getStore()` hands to libraries requiring a real `Storage` (oidc-client-ts).

Before the envelope existed, `set` did `String(value)`, which wrote the literal `"[object Object]"` for every object and silently destroyed it. Such values are unrecoverable: `get` reports them as absent and removes the key.

### Bootstrap exception

The app's session-recovery payload (`__xopat_session__` in `sessionStorage`) and the boot session cache (`xoSessionCache`, `src/parse-input.js`) are the **storage flows not routed through the pipeline**. They stay on raw `sessionStorage`/`localStorage`, and every access is **probe-gated** (see below) and wrapped in `try/catch`.

This is a structural exception, not an oversight. Three reasons, in the order they bite:

1. **`__xopat_session__` carries the ENV that configures the pipeline.** It is read at `app.ts:80` and replaces `ENV` / `PLUGINS` / `MODULES` / `POST_DATA` wholesale. Anything ENV-configured must run after it, so it can never be one of its own consumers.
2. **The pipeline needs the FINAL `POST_DATA` object.** `makePostDataKVDriver` captures it by reference (`io/kv-drivers.ts`), as do the `post-data` bundle sink and the pipeline itself — and `xOpatParseConfiguration` *replaces POST_DATA's identity* when it restores a cached session (`parse-input.js`, `postData = data`). A pipeline built before parsing would hold a detached bucket for every `kv:data` read/write and for bundle export. That is why `bootstrapIOPipeline` sits **after** the parse call in `app.ts`, and why the boot cache cannot wait for it.
3. The cookie policy is snapshotted eagerly at bootstrap (`io/bootstrap.ts`), so the pipeline must also come after the `__ORIGIN__` domain resolution.

What the boot path reproduces by hand instead: probe-gating (`XOpatStorageAvailability`), per-access `try/catch`, a mirror of the `bypassCache` semantics from `store.ts`, and deployment scoping via the key in `src/classes/app/deployment-key.ts`.

**The transports that bypass storage entirely.** The address-bar hash
(`UTILITIES.syncSessionToUrl`, written on every shader edit) and a self-POST body live in the
*history entry*, so they survive an ENV swap, a server restart and any cache eviction — and
`parse-input.js` reads them **before** the boot cache. `serializeAppConfig` therefore stamps
`__envKey` on every session the viewer serializes: a foreign-stamped session still loads (with
a warning), but is refused entry to `xoSessionCache`. That refusal is the load-bearing part —
otherwise one stale hash is laundered into the cache under the *new* deployment's key and
restored legitimately forever. An unstamped session (embedder, demo link) is accepted as before.

**Invariant — `bypassCache` gates restore and save, never eviction.** A boot that opts out of the cache still drops an entry belonging to a *different* deployment. The flag is a preference about using one's own cache; it is not permission for another deployment's session to sit in this origin's storage waiting for the flag to flip. Folding the two together is what let a stale session survive an `XOPAT_ENV` switch untouched.

**Known gap.** `ENV.client.io.bindings.core["kv:cache"]` does **not** reach these flows — bind `kv:cache` to `memory` and the boot path still writes localStorage. Nothing outside the pipeline instance can resolve a binding (`resolveBindings` is the only reader), and duplicating that into the boot path would be a second policy engine. The switch that does reach the boot cache is `setup.bypassCache: true`.

**Adding boot-time state?** If it must be readable before `initXOpatLoader`, it belongs here — stamp it with the deployment key, honour `bypassCache`, probe-gate it, and add a `storage-audit` allowlist entry stating the reason. Everything else — including anything a plugin or module wants — uses `IO_PIPELINE.kv(uid, "kv:session")` (or the `XOpatStorage.Session` façade).

### Sandboxed / opaque-origin operation

xOpat can be embedded in an iframe with a `sandbox` attribute that omits `allow-same-origin` — the EMPAIA Workbench does exactly this. The document then has an **opaque origin**, and:

- reading the `window.localStorage` / `window.sessionStorage` **property** throws `SecurityError` — `if (window.localStorage)` is a *throw site*, not a feature detection;
- `document.cookie` throws on write;
- the bare `indexedDB` identifier throws on read.

Three mechanisms keep the viewer alive there.

**1. One canonical probe.** `XOpatStorageAvailability` (`src/store.ts`, installed by `dist/store.js` — the first app script, so it is reachable from `parse-input.js` onwards):

```js
XOpatStorageAvailability.localStorage    // boolean, memoized
XOpatStorageAvailability.check("cookies")
XOpatStorageAvailability.opaqueOrigin    // sandboxed iframe without allow-same-origin
XOpatStorageAvailability.degraded        // any of local/session/cookies unusable
XOpatStorageAvailability.report()        // per-API verdict + failure reason
```

Each probe does a real round-trip write, so it also catches Safari private mode and partitioned/blocked third-party storage — cases where the object exists but writes are rejected or silently dropped.

**2. Memory substitution under the same driver id.** `createIOPipeline` probes before registering `local-storage` / `session-storage` / `cookies`; when a probe fails it registers a memory driver **under the original id**, labelled `"<name> (unavailable — in-memory)"`. Keeping the id matters: the built-in namespace fallback (rule 5 above) only applies when the fallback driver id is registered, so an absent `local-storage` would make `kv:cache` resolve to `[]` — silently inert. Keeping the ids also means existing `ENV.client.io.bindings` referring to them keep resolving. Each substitute gets its own map: the three stores are independent in the browser, and `this.cookies` must not be readable through `this.cache`.

One `console.warn` is emitted, listing exactly which drivers were substituted. There is no toast — an embedded viewer degrading as designed is not an error the user can act on.

**3. In-driver degradation for late failures.** A `Storage` can also fail *after* boot: `QuotaExceededError` on a full disk, Safari ITP eviction, a partitioning policy that flips mid-session. On the first throw, `makeStorageDriver`/`makeCookiesDriver` swap their own backing store to an in-memory `Map`, warn once, and keep serving. The swap happens **inside the driver object** on purpose — `IOPipeline.kv()` resolves ids to concrete objects and handles keep that array, and `AppCache`/`AppCookies` memoize their handle forever, so re-registering a replacement would reach none of them.

**The server session is a separate problem with a separate fix.** Client storage degrading to memory keeps the *viewer* alive; it does nothing for the *session*, because the browser will not send an `xopat_session` cookie from an opaque origin (or from any frame whose third-party cookies are blocked), so `/proxy/` and `/__rpc/` answer 401. That is handled server-side by `core.server.security.cookielessSessions`, which publishes the id into the framed document and accepts it back as `X-XOPAT-Session` — see [Embedding the viewer in a third-party page](../server/README.md#embedding-the-viewer-in-a-third-party-page). Do not confuse the two: memory drivers are why *preferences* do not persist, the cookieless session is why *requests* work at all.

**Consequence for plugin authors:** `this.cache` / `this.cookies` / `this.data` and `IO_PIPELINE.kv(...)` **never throw** because of storage availability. Reads return the default, writes are kept in memory for the session. Never touch `localStorage` / `sessionStorage` / `document.cookie` / `indexedDB` directly — `npm run storage-audit` fails the build on it.

**Forcing memory storage without relying on detection.** A deployment that is *always* embedded can opt out up front — no new config key, just the existing bindings block:

```jsonc
"client": { "<active>": { "io": { "bindings": { "core": {
    "kv:cache":   ["memory"],
    "kv:cookies": ["memory"],
    "kv:session": ["memory"]
} } } } }
```

Rule 4 (inherit from `core`) propagates this to every plugin and module owner. This is operator policy and therefore lives in the server-only `ENV.client.io` block — deliberately *not* a `setup.*` flag, since `setup` is readable and overridable through `getOption` (session / POST_DATA / URL). The pre-existing `setup.bypassCache` / `bypassCookies` flags stay where they are: those are genuine user preferences about persistence.

---

## Compatibility notes

Persistence is implemented exclusively through `initIO` + `defineResource`. Plugins and modules that previously relied on the older POST-IO override API have been migrated; see each subsystem's `MIGRATION.md` (e.g. [`modules/annotations`](../../modules/annotations/), [`modules/recorder/MIGRATION.md`](../../modules/recorder/MIGRATION.md), [`plugins/recorder/MIGRATION.md`](../../plugins/recorder/MIGRATION.md), [`plugins/questionaire-new/MIGRATION.md`](../../plugins/questionaire-new/MIGRATION.md)).

`serializeApp` now calls `IO_PIPELINE.flushBundleExport()` directly; subscribe to `io:refused` and `io:conflict` (see `EVENTS.md`) for visibility into individual sink outcomes.

---

## Verification

End-to-end test bed is the `annotations` module:

1. Without any binding in `ENV.client.io`, drawing/deleting annotations triggers no sink calls (CRUD inert). Session export still emits the legacy HTML form via the `post-data` fallback.
2. Bind `annotations.crud:annotation` to a fake sink → drawing dispatches `create` once with the serialized payload.
3. Make `validate` return refusal for malformed items → toast appears, `io:refused` fires, in-canvas state can be rolled back.
4. Set `ENV.client.io.disabled: ["annotations"]` → all of the above goes silent. `IO_PIPELINE.isEnabled('module.annotations', 'bundle-export')` returns `false`.
5. Bind `annotations.bundle-export` to `["file-download", "http-rest:annotations"]` → one `UTILITIES.export()` produces both a download and a POST.
