# Server-side storage & caching

How server code — core, `*.server.ts` in a plugin, `register.server.mjs` in a
module — is expected to keep state. This is the server counterpart of
[`src/IO_PIPELINE.md`](../src/IO_PIPELINE.md) and follows the same
capability → binding → driver model, so an operator who understands one
understands the other.

> **The rule.** Server-side state does not live in a module-level `Map`. It goes
> through `XOPAT_SERVER.cache` or `XOPAT_SERVER.storage`. A bare `Map` has no
> bound, no sweeper, no introspection, and no way for an operator to move it.

---

## Which one do I want?

One question decides it: **can the value be serialized?**

| | `XOPAT_SERVER.cache` | `XOPAT_SERVER.storage` |
|---|---|---|
| Holds | any JS value — promises, `KeyObject`s, SDK clients, decoded buffers | JSON values, records, bytes |
| Survives a restart | no, by design | yes, when bound to a persistent driver |
| Visible to a sibling cluster worker | no | yes, when bound to a shared driver |
| Operator-routable | no (bounds only) | yes — bindings, retention, custom drivers |
| Use for | derived data that is cheap to rebuild | data whose loss the user would notice |

If losing it would cost the user something, it is storage. If it is a cached
verdict, a compiled factory, or an in-flight promise, it is cache.

---

## `XOPAT_SERVER.cache`

```js
const verdicts = XOPAT_SERVER.cache.create({
  name: "mymodule:auth-verdicts",   // shown in stats(); make it greppable
  maxEntries: 5000,
  ttlMs: 30_000,                    // IDLE ttl: refreshed on get/set/touch
  maxBytes: 64 << 20,               // optional byte budget
  sizeOf: (v) => v.byteLength,      // optional; a rough estimate is used otherwise
  onEvict: (key, value, reason) => releaseSomething(key),
});

verdicts.set(key, value, { ttlMs: 5_000 });  // per-entry TTL override
verdicts.get(key);      // read + LRU touch + TTL refresh
verdicts.peek(key);     // read without touching either
```

Things worth knowing:

- **TTL is idle, not absolute.** `get`/`set`/`touch` push the expiry out;
  `peek`, `has` and iteration do not. Browsing a cache must never immortalize its
  contents.
- **A per-entry `ttlMs` survives touches**, so "anonymous sessions expire faster
  than authenticated ones" is one argument rather than a second cache.
- **`onEvict` reports store-initiated removals only** — `"ttl"`, `"lru"`,
  `"bytes"`. Your own `delete()` / `clear()` do not fire it, because you already
  know about those. Notify at the call site instead.
- Sweep timers are `.unref()`ed, so a live cache never keeps the process alive.
- **`maxBytes` without `sizeOf` is an estimate**, from a depth- and node-capped
  walk of the value. It is proportional to the value rather than exact — good
  enough for a safety rail, and far better than the flat 256-bytes-per-object it
  used to charge, which made the tiered front tier's byte budget decorative
  (every cached record is a `{value, version}` envelope, i.e. an object). Pass
  `sizeOf` when you want the budget to be accurate.
- **Never log a cached value.** These hold API keys, tokens and
  patient-adjacent payloads. `stats()` deliberately exposes names and counts only.

---

## `XOPAT_SERVER.storage`

### Three shapes

Collapsing these into one KV is what produced the memory profile this subsystem
exists to fix — the growth patterns are genuinely different.

| Shape | Capability id | For | Why not KV |
|---|---|---|---|
| **KV** | `kv:<ns>` | records, metadata, secrets | — |
| **Log** | `log:<ns>` | transcripts, event streams | append + tail-read + FIFO trim. As KV, every append is read-whole-array → mutate → write-whole-array. |
| **Blob** | `blob:<ns>` | attachments, audio, rendered regions | streamed, never resident. A KV value is by definition materialized. |

### Opening a handle

```js
const OWNER = "module.my-module";     // "core" | "module.<id>" | "plugin.<id>"

const sessions = XOPAT_SERVER.storage.kv(OWNER, "sessions", {
  ttlMs: 72 * 3600_000,
  maxEntries: 2000,
  sensitivity: "normal",             // "secret" refuses persistent drivers
  defaultBindings: ["memory"],       // used when the operator configured none
  onEvict: (id) => cascadeCleanup(id),
});

const messages = XOPAT_SERVER.storage.log(OWNER, "messages", { maxEntries: 500 });
const blobs    = XOPAT_SERVER.storage.blob(OWNER, "attachments");
```

Everything is async — a synchronous API would rule out every interesting
backend.

```
KVHandle    get · set · delete · has · touch · stat · keys · scan · clear · scoped
LogHandle   append · tail · range · length · trim · delete · keys · scoped
BlobHandle  put · get · stream · stat · delete · keys · clear · scoped
```

### `scoped(principal)` — per-caller isolation

```js
const mine = sessions.scoped(XOPAT_SERVER.resolvePrincipal(ctx));
await mine.set("draft", value);
await mine.clear();          // purge exactly this caller, nothing else
```

A scoped handle prefixes every key and **cannot address anything outside its
scope**. This makes per-user isolation a property of the broker instead of ACL
code repeated in each module, and it makes the session-eviction purge exact.

Always pass `XOPAT_SERVER.resolvePrincipal(ctx)` — never an id from the request
body. See the "The principal" section of [`server/README.md`](README.md).

### Return-value semantics

The `memory` driver hands back the **stored reference**; a persistent driver
necessarily returns a fresh copy. **Do not rely on mutating a returned value to
persist it** — write it back explicitly. Code that follows this rule stays
correct when an operator re-binds the namespace, and code that does not will
work in dev and silently lose writes in production. (`server/node/index.js` shows
the pattern: the core session store snapshots at resolve and writes back at
response end.)

---

## Drivers

| id | Persistent | Shared | Notes |
|---|---|---|---|
| `memory` | no | no | The bounded-cache engine. |
| `file` | yes | yes | Atomic writes (temp + rename), sharded directories, per-record TTL. |
| `tiered` | yes | yes | **Default.** Bounded `memory` front over `file`. |

**What `shared: true` does and does not promise.** Single-file writes are atomic
(temp + rename), keys cannot collide, and temp names carry the pid — so two
processes never corrupt one record. It is **not** a transactional store: there is
no compare-and-set, so two processes writing the *same* key still race
last-writer-wins. `touch` mitigates this with an mtime version check and retry
(it runs on every authenticated request, so the naive read-modify-write was
resurrecting values a concurrent `set` had just replaced), and a blob's meta
sidecar is written last and treated as the commit record — a blob whose meta is
missing reads as absent rather than as half-written bytes. Design around
last-writer-wins per key, and keep independent state in independent keys.

### Why `tiered` is the default

- **Bounded RAM** — the front tier evicts by entries, bytes and TTL.
- **Eviction is not deletion** — the back tier still answers, so a record that
  falls out of RAM mid-request costs one read instead of becoming an error.
- **Cluster-correct** — `server/node/cluster-index.js` forks `XOPAT_WORKERS`
  processes. In `shared` coherency mode every front-tier hit is validated against
  the back tier's version stamp (`fs.stat`, microseconds — far cheaper than the
  JSON parse it avoids), so a write in worker A is visible in worker B. The mode
  is auto-detected from cluster state and can be pinned per namespace.

Blobs are never cached in the front tier. Logs cache only a tail window.

### Custom drivers

Register from a module's `register.server.*`; the driver stays inert until an
operator binds something to it.

```js
XOPAT_SERVER.storage.registerDriver({
  id: "redis", supports: ["kv"], persistent: true, shared: true,
  async get(ns, key) { … },
  async set(ns, key, value, meta) { … },
  async delete(ns, key) { … },
  async *scan(ns, { prefix }) { … },
  async keys(ns, opts) { … },
  async clear(ns, opts) { … },
  async stat(ns, key) { … },
  async sweep(ns, policy) { … },   // optional: backend-native TTL/LRU
  dispose() { … },
});
```

**Implementing `kv` is enough.** Generic `LogOverKV` / `BlobOverKV` adapters fill
in the other two shapes (blobs are chunked, since most KV backends cap a single
value). Declare `log`/`blob` in `supports` only when the backend can do better
natively.

---

## Configuration

Lives at `core.server.secure.storage` — the `secure` subtree is the only part
stripped from the browser-bound page payload, and driver options carry
`<% VAR %>` credentials. It is read through a lazy closure, so a live config
reload moves bindings and retention without a restart.

```jsonc
"secure": {
  "storage": {
    "root": "<cacheDir>/storage",
    "defaultDriver": "tiered",
    "allowPersistentSecrets": false,
    "sweepIntervalMs": 60000,

    "drivers": {
      "tiered": { "front": "memory", "back": "file",
                  "memory": { "maxBytes": 268435456 },
                  "coherency": "shared" },
      "file":   { "root": "/var/lib/xopat-storage", "fsync": false }
    },

    // ownerId (or ownerUid) -> capabilityId -> driver ids
    "bindings": {
      "core":               { "kv:sessions": ["memory"] },
      "vercel-ai-chat-sdk": { "kv:sessions": ["tiered"], "log:messages": ["file"],
                              "blob:attachments": ["file"] }
    },

    "retention": {
      "vercel-ai-chat-sdk": {
        "kv:sessions":      { "ttlMs": 259200000, "maxEntries": 2000 },
        "log:messages":     { "maxEntries": 500 }
      }
    },

    // Force these owners to memory-only. Announced in the log.
    "noPersist": []
  }
}
```

### Binding resolution (highest precedence first)

1. `noPersist` lists the owner → forced to `memory`, logged once.
2. `bindings[ownerId][capabilityId]`
3. `bindings.core[capabilityId]` — the "redirect everything" knob.
4. The owner's own `defaultBindings` (code) / `server.json` default.
5. `defaultDriver` (`tiered`).

Two deliberate differences from the client pipeline, both because the server is
not a browser:

- **There is no inert state.** The client makes an unbound capability a no-op;
  silently discarding a *server* write is data loss. `noPersist` is the
  equivalent knob and it still stores, just not durably.
- **A binding list is a read-fallback chain, not a mirror.** Writes go to the
  first driver; reads fall through the rest on miss. That is the migration path —
  `["redis", "file"]`, drain, then drop the tail — without doubling every write.

### Retention precedence

shape default → code default (handle options) → author `server.json` → deployer
`retention` block.

### The sensitivity gate

A namespace declared `sensitivity: "secret"` (BYOK keys, OIDC tokens) **refuses
to bind to a persistent driver** unless the operator sets
`allowPersistentSecrets: true`. The refusal is a throw at handle construction —
loud, at boot, naming owner/namespace/driver — so a well-meant "let's put chat
state on disk" change cannot quietly start writing API keys to the cache
directory.

If you do enable it, the storage root needs restrictive permissions and an
at-rest encryption story. The broker warns once when it is on.

### Environment variables

Per-deployment values belong in the config, not `process.env` (see
[`server/ENVIRONMENT.md`](ENVIRONMENT.md)). These exist for process-scoped
overrides:

| Variable | Purpose | Default |
|---|---|---|
| `XOPAT_STORAGE_ROOT` | Storage root directory | `<XOPAT_CACHE_DIR>/storage` |
| `XOPAT_STORAGE_SWEEP_INTERVAL_MS` | Shared sweeper period | `60000` |
| `XOPAT_STORAGE_MEMORY_MAX_BYTES` | Default memory-driver byte budget | unset |

---

## Making state survive a restart

Nothing persists out of the box: every namespace ships bound to `memory`, so a
restart is a clean slate. That is deliberate — a viewer handling pathology data
should not start writing conversations to disk because someone upgraded. Turning
it on is one config block, plus **one prerequisite that is easy to miss and
silently defeats the whole thing**.

```jsonc
// env.json → core.server.secure.storage
{
  "bindings": {
    // REQUIRED — see "The prerequisite" below. Without this an anonymous caller
    // gets a NEW principal after the restart and cannot see their own data.
    "core": { "kv:sessions": ["tiered"] },

    "vercel-ai-chat-sdk": {
      "kv:sessions":          ["tiered"],
      "log:messages":         ["tiered"],
      "log:attachment-index": ["tiered"],
      "blob:attachments":     ["file"]     // bytes — a memory tier buys nothing
    }
  },
  "retention": {
    "vercel-ai-chat-sdk": {
      "kv:sessions": { "ttlMs": 2592000000, "maxEntries": 20000 }   // 30 days
    }
  }
}
```

A runnable example lives at [`env/env.storage-persistent.json`](../env/env.storage-persistent.json):

```
XOPAT_ENV=env/env.storage-persistent.json npm run s-node
```

### The prerequisite

A record is reachable only by its **owner principal**, and for a user who has not
logged in that principal is `sess:<browser-session-id>` — derived from the
browser-session record in `core / kv:sessions`, which is memory-bound by default.

Persist the chat namespaces alone and you get the worst of both worlds:

1. the transcript is written to disk and survives;
2. after the restart the browser still sends its `xopat_session` cookie, but the
   server has no record under that id, so it mints a **new** session and a new
   `sess:` principal;
3. `listSessions({ownerPrincipal})` matches nothing.

The data is intact and permanently invisible. Binding `core / kv:sessions` is
what keeps the principal stable across the restart.

This costs nothing in secrecy terms: the session store is split in two, and only
the **identity half** (`kv:sessions` — id, CSRF token, timestamps,
`sensitivity: "normal"`) is involved here. Module-attached credentials live in
`kv:sessions-secure` (`sensitivity: "secret"`) and stay put.

### What deliberately does not survive

| State | Namespace | Why | What the user sees |
|---|---|---|---|
| BYOK API keys | `vercel-ai-chat-sdk / kv:secrets` | `sensitivity: "secret"` | re-enters their key |
| OIDC PKCE / SAML session state | `core / kv:sessions-secure` | `sensitivity: "secret"` — refresh tokens | a silent re-login |
| Everything in `XOPAT_SERVER.cache` | — | ephemeral by design | first request re-warms it |

Persisting the first two means writing credentials to disk and requires
`allowPersistentSecrets: true` — an explicit decision, with restrictive
permissions on the storage root and an at-rest encryption story behind it.

### Three interactions worth knowing

- **The browser-session TTL still applies.** `XOPAT_SESSION_TTL_SEC` (24 h idle)
  bounds how long an anonymous owner stays reachable, regardless of how long the
  chat namespace retains the data. Raise it, or require login.
- **A logged-in principal is the robust answer.** `user:<id>` does not depend on
  the browser session at all, so transcripts stay reachable across restarts *and*
  across browsers. If long-lived history matters, require login rather than
  stretching the session TTL.
- **Disk retention is a data-retention decision.** Once transcripts are on disk
  they are subject to whatever policy governs the deployment. Set `retention`
  deliberately instead of inheriting the 72 h default, and restrict the storage
  root.

### Verifying persistence

Automated — the suite that asserts all of the above, including negative controls
that must lose the data:

```
npm run test:storage-persistence
```

By hand:

```bash
# 1. boot with persistence on, using a scratch cache dir you can inspect
XOPAT_ENV=env/env.storage-persistent.json XOPAT_CACHE_DIR=/tmp/xo npm run s-node

# 2. open the viewer, hold a short conversation

# 3. the transcripts are on disk
ls -R /tmp/xo/storage/module.vercel-ai-chat-sdk/

# 4. restart the server, reload the page — the conversation is still listed.
#    If it is NOT, check step 5 before assuming data loss.

# 5. confirm the bindings actually took effect (dev mode)
curl -s -X POST -H 'Content-Type: application/json' \
     -H "Cookie: xopat_session=$SID" -H "x-xopat-csrf: $CSRF" -d '{}' \
     http://localhost:9000/__rpc/server/core/getStorageStats
```

In that last response every chat namespace should read `"driver": "tiered"` (or
`"file"`), not `"memory"`, and `core/kv:sessions` likewise. A namespace still
showing `memory` means the binding did not apply — a typo in the owner id is the
usual cause, and the storage root will be empty.

---

## The sweeper

**One** `.unref()`ed timer for the whole process walks every registered namespace
and asks its driver to sweep — not one interval per cache.

Every process always sweeps its own in-process tier. The shared persistent tier
is swept by whichever process holds a **lease** on `<root>/.sweep.lock`
(`{holder, at}`, stale after 5 minutes, released on clean shutdown). Acquisition
is an `O_EXCL` create plus read-back verification, so simultaneous starters
cannot all conclude they won. If the lock cannot be written at all the sweep runs
anyway: duplicated work is survivable, a store that never reclaims is not.

> The lease replaced `cluster.worker.id === 1`, which was a latent
> stop-reclaiming bug: cluster ids are monotonic and never reused, and
> `cluster-index.js` re-forks on exit — so once worker 1 died, *no* worker ever
> satisfied the test again and the persistent tier went unswept for the lifetime
> of the primary. The lease also covers topologies `cluster.isWorker` never saw
> (k8s replicas, PM2 fork mode), which share a filesystem while each believing it
> is alone.

---

## Introspection

```
POST /__rpc/server/core/getStorageStats     # dev mode only
```

Returns every registered namespace (driver, persistence, sensitivity, resolved
policy) and every live cache with hit / miss / eviction counters.

Read it as follows: `evicted` stuck at zero while `size` climbs to the cap means
the retention policy is too tight or too loose; a namespace **missing** from the
list is state that is not going through the broker at all.

---

## Anti-patterns

- **A module-level `Map` with no bound.** The thing this replaces.
- **A hand-rolled sweeper.** `size > N → drop oldest` on write is a *sweep
  trigger*, not a bound: a burst of live entries pushes past the threshold and
  stays there.
- **A TTL checked only on read.** Entries nobody looks up again are never
  reclaimed — precisely the ones you wanted gone.
- **Keying a cache by request input** (a query param, a `Host` header, a
  client-chosen id) without validating it first. The bound stops the memory
  exhaustion; it does not stop a caller reading another caller's entry. Validate,
  then `scoped()`.
- **Storing large payloads inside a KV record.** Use `blob:`; that is the whole
  reason the shape exists.
- **Mutating a value you read back and expecting it to persist.** True on
  `memory` only. Write it back.

---

## The core log namespace

The logging broker's optional durable sink is an ordinary storage namespace:
`core/log:logs`, one entry per record, keyed by UTC day and FIFO-trimmed. It only
exists once an operator enables `core.server.logging.sinks.store`. Bind it like
any other namespace — `file` for local retention, `tiered` (or a module-provided
driver) to share it across cluster workers:

```jsonc
"storage": { "bindings": { "core/log:logs": ["file"] } }
```

Records hold redacted diagnostics, never cached values or secrets. See
[`server/LOGGING.md`](LOGGING.md).

---

## See also

- [`server/README.md`](README.md) — server architecture, the principal, SSRF
- [`server/LOGGING.md`](LOGGING.md) — the logging broker, channels, the log sink
- [`server/ENVIRONMENT.md`](ENVIRONMENT.md) — process-launch variables
- [`src/IO_PIPELINE.md`](../src/IO_PIPELINE.md) — the client-side counterpart
- [`src/AUTH.md`](../src/AUTH.md) — auth contexts and the session lifecycle
