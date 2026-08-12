# XOpat — Managing the Viewer Storage

xOpat exposes one unified IO pipeline (`window.IO_PIPELINE`, also at `APPLICATION_CONTEXT.io`) that subsumes:

- bundle export/import (whole-set serialize/deserialize),
- per-element CRUD (Create/Read/Update/Delete),
- key/value storage (sync `cache` & `cookies`, async `data`).

For the full architecture and admin-side guide see [`IO_PIPELINE.md`](IO_PIPELINE.md). This file is the storage-focused quick reference.

## Out of the box

By default, the viewer allows sharing data via:

- **URL exports** — carry over only the explicit session storage; cached storages (cache, cookies) are turned off when viewed.
- **FILE / HTML exports** — contain the full viewer data as-is, driven by `IO_PIPELINE.flushBundleExport()`. Owners that declared a `bundle-export` capability and have no admin override land in the legacy `post-data` sink (the HTML form), so the existing session-share semantics are preserved.

## Sync key-value storage (`kv:cache`, `kv:cookies`)

Plugins and modules get sync per-element accessors automatically:

```ts
this.cache.set("autoOpen", true);
const value = this.cache.get("autoOpen", false);

this.cookies.set("token", "...");
this.cookies.with({ expires: 7 }).set("session", "...");   // builder for cookie attrs
```

Both delegate to `IO_PIPELINE.kv(this.uid, "kv:cache")` (or `"kv:cookies"`). Default drivers are `local-storage` and `cookies`. The empty-string `id` of legacy `XOpatStorage.Cache({ id: "" })` is now the conventional `"core"` owner.

## Async key-value storage (`kv:data`)

```ts
await this.data.set("draft", largePayload);
const draft = await this.data.get("draft");
```

Default driver: `post-data` (writes into the legacy `POST_DATA` bucket so the session HTML export still picks it up). Admins can rebind to `http-rest` (HttpClient-backed) for server persistence.

## Custom namespaces

Declare a custom KV namespace in `include.json` and use it directly:

```jsonc
"io": {
  "capabilities": [{ "id": "kv:drafts", "kind": "kv" }]
}
```

```ts
const drafts = IO_PIPELINE.kv(this.uid, "kv:drafts");
drafts.set("page-1", payload);
```

## Drivers

A KV driver is **any object satisfying the `localStorage` interface** (`getItem/setItem/removeItem/key/length/clear`). Drivers self-describe sync vs. async, shared vs. owned (shared drivers get auto-prefixed keys to prevent collisions across owners), and optional context-aware mode.

Built-in drivers (registered at boot):

- `local-storage` (sync)   — `window.localStorage`
- `session-storage` (sync) — `window.sessionStorage`
- `cookies` (sync)         — `js-cookie` wrapper, with memory fallback
- `memory` (sync)          — in-process Map
- `post-data` (async)      — `POST_DATA` bucket (preserves legacy session export shape)
- `http-rest` (async)      — `HttpClient`-backed; per-deployment overrides in `ENV.client.io.sinkOverrides`

### Browser storage may not exist

The three browser-backed drivers are **probed**, never assumed. In a sandboxed iframe without `allow-same-origin` (opaque origin) even reading the `window.localStorage` property throws `SecurityError`. When a probe fails, a memory driver is registered **under the same id** (so namespace fallbacks and existing bindings keep resolving) and one `console.warn` names the substitutions. A store that fails *later* (quota, ITP eviction) degrades in place, inside the driver object.

So: `this.cache` / `this.cookies` / `this.data` and `IO_PIPELINE.kv(...)` **never throw** because storage is unavailable — reads return the default, writes live for the session. Correspondingly, **never touch `localStorage` / `sessionStorage` / `document.cookie` / `indexedDB` directly**; `npm run storage-audit` fails the build on it. The full contract, the `XOpatStorageAvailability` probe API, and the operator opt-out are in [`IO_PIPELINE.md`](IO_PIPELINE.md#sandboxed--opaque-origin-operation).

### Owners are registered on first use

A namespace belongs to an **owner uid** — `core`, or `<module|plugin>.<id>` exactly as
`XOpatElement` builds it. Elements register themselves in their constructor, but you do **not** need
to be an element: `IO_PIPELINE.kv(uid, cap)` registers an unknown uid on first call (deriving
`ownerId`/`xoType` from its shape) so a core service or a plain-script module gets a working
namespace with no ceremony. An implicitly-registered owner behaves like a declared one — the
`bindings` keys below apply to it, and if the real element is constructed later the record is
upserted, not replaced.

This matters because the failure mode is otherwise invisible: an unresolved owner produced a handle
over *zero* drivers, so every write was dropped and every read returned `null`, with no throw and no
warning. If a namespace still resolves to no driver after registration — an admin bound it to
nothing, or to an unknown driver id — `kv()` warns once naming `<ownerUid>::<capability>`.

Register a custom driver:

```ts
IO_PIPELINE.registerKVDriver({
  id: "indexeddb",
  mode: "async",
  shared: true,
  async getItem(k) { /* … */ },
  async setItem(k, v) { /* … */ },
  // … rest of localStorage interface
});
```

## Admin redirection

Bindings live in `ENV.client.io`:

```jsonc
{
  "bindings": {
    "core": {
      "kv:cache":   ["local-storage"],          // also the default
      "kv:cookies": ["cookies"]
    },
    "plugin.playground": {
      "kv:cache":   ["http-rest:playground"]    // route this plugin's drafts elsewhere
    }
  },
  "sinkOverrides": {
    "http-rest:playground": { "proxy": "cerit", "baseURL": "/api/v1/drafts" }
  }
}
```

Resolution order for `kv:*`:

1. Admin disabled → no-op.
2. `bindings[ownerId][capabilityId]` → that exact list.
3. include.json `io.defaultBindings[capabilityId]` → that list.
4. **Inherit from `core`** if the admin set one (the "redirect everything" knob).
5. Built-in fallback per namespace.

A capability bound to multiple drivers mirror-writes; reads consult them in order.

## Sync ↔ async safety

`this.cache` and `this.cookies` are sync. If an admin binds them to an async driver, handle construction throws `IOError` listing the offending drivers. Use `kv:data` (async by contract) for asynchronous backends.

## Direct driver inheritance — base classes

Custom drivers may extend the base classes for type compatibility, but it is not required (any localStorage-shaped object works):

```ts
import { XOpatStorage } from "./store";
class MyDriver extends XOpatStorage.Storage { /* sync */ }
class MyAsyncDriver extends XOpatStorage.AsyncStorage { /* async */ }
class MyCookieDriver extends XOpatStorage.CookieStorage { /* with .with(opts) */ }
```

## Bootstrap exception

The app's session-recovery payload (`__xopat_session__` in `sessionStorage`) and the boot session cache (`xoSessionCache`) are the **storage flows not routed through the pipeline** — they must be readable before `initXOpatLoader` runs. Both are probe-gated and `try/catch`-wrapped. Plugins/modules wanting admin-routable session-scoped storage should use `IO_PIPELINE.kv(uid, "kv:session")` or the `XOpatStorage.Session` façade instead.

## Known wart

`XOpatStorage.Cookies.with(options)` reaches for the driver registered under the literal id `cookies`, not the driver(s) actually bound to `kv:cookies`. If an admin rebinds `kv:cookies` elsewhere, the per-call cookie attributes never reach the real backend. The memory substitute keeps the id and carries a no-op `with()`, so the sandboxed case stays harmless.
