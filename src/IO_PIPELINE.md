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

Coalesced-out ops resolve their `.settled` to `{ ok: true, payload: { coalesced: true } }` so awaiting callers don't hang. `clientOpId` is preserved on the surviving op (servers dedup retries via that id alone).

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

`rollbackOnAsyncRefuse: true` works via the queue too: on terminal refusal of op N (after retries exhausted), the pipeline drives `APPLICATION_CONTEXT.history.undo()`. The undo callback enqueues an inverse op through the same outbox — so it tails any N+1, N+2 already pending and runs in order. If the original create was still unstarted at the time of refusal, the inverse delete coalesces it out.

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

1. **Per-resource entry cap** (`persistMaxEntries`, default 5000). Pre-flight check before persisting. On overflow: refuse the new op with `code: "W_IO_OUTBOX_FULL"`, emit `io:outbox-full` (`{ ownerUid, resourceName, pending }`), and if the caller passed `rollbackOnAsyncRefuse: true` the local apply is reverted via `history.undo()`. **Never silently drops user work.**
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
4. New user actions enqueue normally and tail any replayed ops. Strict causal order: server sees pre-reload ops before post-reload ops.
5. Emits `io:outbox-replayed` (`{ ownerUid, resourceName, count }`) when boot replay finishes.

#### Online / offline

The pipeline subscribes to `window.online` / `window.offline` once at construction. While offline, the worker pauses (no `withRetry` budget burned on doomed fetches); ops pile up in the queue. `io:queue-stalled` fires immediately on first enqueue offline. On `online`, the worker resumes from the head; `io:queue-resumed` fires.

#### Failure modes

| Failure | Behavior |
|---|---|
| IndexedDB unavailable (private mode, very old browser) | Resource degrades to in-memory queue (Phase 9 behavior). Emit `io:outbox-unavailable` once. App still works in-session; reload loses pending ops. |
| IDB quota exceeded mid-write | Op refused with `code: "W_IO_OUTBOX_WRITE"`; auto-rollback if `rollbackOnAsyncRefuse: true`. |
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
- **`rollbackOnAsyncRefuse: true`** (per-call opt-in): if the queued dispatch resolves to refusal after retries are exhausted, the pipeline drives `APPLICATION_CONTEXT.history.undo()` so the auto-history entry is popped AND `inverseApply` runs exactly once. Default off — local input stays visible; user is informed via `io:refused` (`phase: 'post-commit'`) toast; manual rollback is the caller's choice. Annotations opts in for `create` and `delete`.

### Sync guards only

`registerGuard` handlers must return `IOResult` synchronously. Async checks (server permission round-trips, "are you sure?" dialogs that need user input) have two recommended patterns:

1. **Resolve at the call site**: the caller `await Dialogs.confirm(...)` BEFORE calling `resource.delete(...)`. Keeps UX patterns out of the pipeline.
2. **Server-side via sink**: the sink itself runs the round-trip during dispatch; refusal surfaces post-commit via `io:refused` and (if opted in) `rollbackOnAsyncRefuse` reverts.

### Auto-history (undo/redo for free)

Every `IOResource.create / update / delete` call that includes both an `apply` and an `inverseApply` callback automatically pushes a history entry through `APPLICATION_CONTEXT.history` synchronously, immediately after `apply()` succeeds. Authors get undo/redo without writing a single `pushExecuted` call.

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
//      ↳ guards run, sinks run, but skipHistory=true so no recursive push
//
// Cmd-Shift-Z (redo):
//   1. apply()                              (local re-commit)
//   2. annotationResource.create(item, { meta: { fromRedo: true, … } })
//      ↳ same skipHistory=true semantics
```

**Inverse direction table** (the pipeline's only domain knowledge):

| Original direction | Inverse on undo |
|---|---|
| `create` | `delete` |
| `delete` | `create` |
| `update` | `update` (the `inverseApply` closure carries the rollback patch) |

**Reserved `ctx.meta` keys** the pipeline writes (sinks / guards may read):

| Key | Set when |
|---|---|
| `meta.clientOpId` | Stable per-call UUID for sink-side dedup on retry. |
| `meta.fromUndo: true` | This dispatch is the undo replay of a previously-recorded entry. |
| `meta.fromRedo: true` | This dispatch is the redo replay. |
| `meta.phase: 'post-commit'` | Set on the queued dispatch context (so sinks / `io:refused` listeners can distinguish sync local commit from async server outcome). |

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
  handler: async (ctx, payload) => {
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
const veto = await ann.canDelete(itemId);
if (!veto.ok) return;                       // guard refused — toast already shown
removeFromCanvas(itemId);                   // local commit
await ann.delete(itemId, { skipGuards: true });  // persist; don't re-run guards
```

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
    const url = `${opts.baseURL}/${ctx.resourceName}?` + new URLSearchParams({
      backgroundId: String(params.backgroundId),
      bbox: JSON.stringify(params.bbox),
      zoom: String(params.zoom),
    });
    const signal = (ctx.meta as any).signal as AbortSignal | undefined;
    const res = await fetch(url, { signal });
    if (!res.ok) return;
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line) yield JSON.parse(line);
    }
    if (buffer) yield JSON.parse(buffer);
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
  "bindings": {
    "annotations": {
      "bundle-export": ["file-download", "http-rest:annotations-bundles"],
      "crud:annotation": ["http-rest:annotations-live"],
      "crud:preset": []
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

1. `ENV.client.io.disabled` includes the owner → IO inert.
2. `ENV.client.io.bindings[owner][capability]` defined → that exact list.
3. include.json `io.defaultBindings[capability]` defined → that list.
4. capability `kind === "bundle"` → fallback to `["post-data"]` (legacy session export).
5. capability `kind === "crud"` → `[]` (inert).

Use `IO_PIPELINE.isEnabled(ownerUid, capabilityId)` (or `this.io.isEnabled(...)`) to introspect.

---

## Built-in sinks

| id | Supports | Purpose |
|----|----------|---------|
| `post-data` | `bundle` | Writes into the global `POST_DATA` dict. Preserves the legacy HTML-form session export emitted by `serializeApp()`. Default fallback for unbound bundle capabilities. |
| `file-download` | `bundle` | Triggers `UTILITIES.downloadAsFile` with the payload. Owners can hint `ctx.meta.fileName` / `ctx.meta.fileExt`. |
| `file-upload` | `bundle` | Pops a file picker, reads the file, returns the contents. Used as the readable side of session restore from disk. |
| `http-rest` | `bundle`, `crud` | Generic `HttpClient`-backed sink. Per-deployment overrides in `ENV.client.io.sinkOverrides[<id>]` (see above). |

### Round-trip contract

A transport sink **must round-trip payloads byte-equivalent**. The sink may decode wire encodings (base64, gzip, …) so the owner gets back the same logical payload it produced, but it **must not interpret the payload's semantics** — no `JSON.parse`, no schema-aware reshaping, no whitespace stripping. Decoding bundle contents (string → object, array → typed model, etc.) belongs in the owner's `importBundle`, because only the owner knows the payload's format. Sinks that violate this contract silently break any owner that round-trips a JSON string the owner expects to parse itself.

Custom sinks are registered with `IO_PIPELINE.registerSink(mySink)` — they're plain objects implementing the `IOSink` ambient interface. Distinct ids let the admin route different owners to different `http-rest` instances; the owning module composes its own defaults with the admin override slot:

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

## Refusal & conflict semantics

Any hook (validator, sink, or owner method) may return:

```ts
{ ok: false, refused: true, reason: "...", userMessage?: "...", code?: "..." }
```

- For **CRUD**: the first refusal short-circuits and is returned to the caller. The pipeline emits `io:refused` on `VIEWER_MANAGER` and shows `Dialogs.show(userMessage ?? reason, 5000, MSG_WARN)` automatically. The caller can use the result to roll back local state.
- For **bundle**: refusals from one sink don't stop sibling sinks for the same owner. Each refusal still emits `io:refused`.
- **Errors thrown** from any hook are caught, converted to `{ ok: false, refused: true, reason: e.message, code: 'W_IO_*_THREW' }`, and surfaced the same way as refusals.

### Three distinct refusal events

| Event | When |
|-------|------|
| `io:refused`              | A sink tried (`writeBundle` / `readBundle` / `create` / …) and returned `{ refused: true }`, or threw. Toast shown automatically. |
| `io:rejected-by-accepts`  | A bound sink's `accepts(ctx)` returned `false` — it opted out before attempting. Informational; pairs with a `console.info`. Payload field: `sinkId`. |
| `io:fully-refused`        | Every bound sink for one dispatch ended in refusal/error/accept-rejection — the call wrote nothing. Always a sign of a misconfigured binding. Pairs with a `console.warn`. |

These three events let monitoring code distinguish between "sink said no, but other sinks may have succeeded" (`io:refused`), "this sink was the wrong one for this ctx" (`io:rejected-by-accepts`), and "nothing wrote anywhere" (`io:fully-refused`).

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
IO_PIPELINE.registerKVDriver({
  id: "redis-bridge",
  mode: "async",
  shared: true,
  async getItem(k) { return await fetch(`/kv/${k}`).then(r => r.text()); },
  async setItem(k, v) { await fetch(`/kv/${k}`, { method: "PUT", body: v }); },
  async removeItem(k) { await fetch(`/kv/${k}`, { method: "DELETE" }); },
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

### Bootstrap exception

The app's session-recovery payload (`__xopat_session__` in `sessionStorage`) is the **one storage flow not routed through the pipeline**. It must be readable before `initXOpatLoader` runs (it carries the boot config the pipeline depends on). The paired write therefore also stays on raw `sessionStorage`. Plugins/modules wanting admin-routable session-scoped storage should use `IO_PIPELINE.kv(uid, "kv:session")`.

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
