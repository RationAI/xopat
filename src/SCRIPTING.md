# ScriptManager API Documentation

A secure, singleton-based Web Worker Sandbox designed to run untrusted third-party scripts. It uses MessageChannel and Blob wrapping to ensure scripts remain isolated, preventing them from accessing the host's global scope or hijacking the communication bridge.

---

## 🚀 Quick Start

### 1. Initialization
The ScriptManager is a singleton. Initialize it with your host-side implementation functions.

```javascript
// Actual functions that run on the Main Thread
const hostActions = {
zoomIn: () => console.log("Main Thread: Zooming in..."),
navigateToSlide: (index) => console.log("Main Thread: Moving to slide", index)
};

// Access the singleton
const manager = ScriptManager.instance(hostActions);
```

### 2. Registering Custom Namespaces
Extend the manager dynamically to support new features (like Annotations or Chat).

```javascript
manager.registerNamespace(
'annotations',
{ add: false, remove: false }, // Security Schema (Default: Locked)
{
// Implementations
add: (content) => console.log("Host saved annotation:", content),
remove: (id) => console.log("Host deleted annotation:", id)
}
);
```

### 3. Granting Permissions
Scripts cannot call methods until you explicitly grant consent on the host side.

```javascript
// Grant specific method
manager.setConsent('annotations', 'add', true);

// Grant entire namespace
manager.grantNamespaceConsent('viewer', true);
```

### 4. Creating a Worker
Pass a raw JavaScript string to the manager. It will be wrapped in a secure IIFE sandbox.

```javascript
const pluginCode = `
console.log("Worker started!");

    // Access allowed methods via the 'api' global
    api.viewer.zoomIn();
    api.annotations.add("Hello from the sandbox!");
`;

manager.createWorker(pluginCode, 'plugin-01');
```

## 🛡️ Security Architecture



The manager implements several layers of protection to prevent "Escapes":

1. Closure Isolation: The MessagePort is stored in a private variable inside an IIFE. The plugin script has no lexical access to the port.
2. Listener Lockdown: self.onmessage is frozen as null. Even if the script tries to attach its own onmessage, the host is not listening to the main worker thread.
3. Object Sealing: The api object is defined via Object.defineProperty with configurable: false and writable: false, then frozen.
4. Host-Side Verification: Every incoming message is re-verified against the host's consent map before the function is executed.

---

## 📖 API Reference

### Static Methods
- ScriptManager.instance(actions): Returns the singleton instance.
- ScriptManager.instantiated(): Returns true if the manager is already running.

### Instance Methods
- registerNamespace(ns, schema, impl): Registers a new API group and its functions.
- setConsent(ns, method, bool): Toggles a specific capability for the sandbox.
- grantNamespaceConsent(ns, bool): Toggles all capabilities in a namespace.
- createWorker(script, id): Spawns a new isolated worker from a code string.

---

## ⚡ Performance: warm worker pool & reuse

Spawning an OS Worker per script used to sit on the critical path of every execution.
Execution now draws from a **pre-warmed pool of pristine, one-shot workers**:

- **Default (`executeScript(script)`):** a warm worker runs your script and is then
  **terminated** — a fresh realm per script, exactly the old isolation guarantee, minus
  the spawn latency. The pool refills itself in the background. Namespaces are delivered
  to the worker as **data** (not generated code), so there is no per-call codegen either.
- **Opt-in reuse (`executeScript(script, { reuseWorker: true, workerId })`):** keeps one
  living worker and runs subsequent scripts (same `workerId`) on it, skipping even the
  compile-time setup. Runs are serialized per worker.

> **Security caveat for `reuseWorker`.** A Worker realm cannot be reset without
> terminating it, so a reused worker runs later scripts in the **same, already-hardened
> realm**. Prototype pollution / residue from an earlier script therefore persists into
> the next one. Use it only for sequential scripts of the **same trust level in the same
> context** (e.g. a scripted batch you authored). The default one-shot mode does *not*
> share realms. Namespaces/consent granted *after* a reusable worker's first run **are**
> picked up on its next run (the manifest is re-sent every run and new namespaces are
> installed; already-installed ones stay frozen); host-side consent checks still block
> revoked methods on every call regardless.
>
> One consequence of the shared realm you cannot fully close: an async callback a
> finished script leaked (a `setTimeout`/pending promise that calls an API method) will
> fire **during the next run** and be attributed to *that* run's execution — the
> worker only tracks a single active exec, so it cannot tell the stray call apart from a
> legitimate one. The one-shot default is immune (its realm is torn down between scripts);
> prefer it whenever scripts might leak timers.

> A reused worker's already-installed namespace stubs are **frozen** — a namespace can
> never gain methods after its first install on that worker. Consumers that must pick
> up per-method changes (the chat does) compare `manager.manifestGeneration` and
> recycle the worker (terminate + lazy re-acquire) when it moved.

## Partial results from long-running scripts

A script realm exposes one global besides the namespaces: **`progress(value)`** (synchronous,
not a promise). It publishes an intermediate payload for the current run:

```js
for (let i = 0; i < items.length; i++) {
    findings.push(await pathology.analyzeRegion(items[i]));
    progress({ scanned: i + 1, of: items.length, findings });  // survives a stop
}
return findings;
```

- Callers subscribe with `executeScript(script, { onProgress(value) { … } })`.
- Payloads must be structured-cloneable and **replace** each other — only the last one is kept.
- If the run never produces a result (aborted, timed out, worker died), the rejection is a
  `ScriptRunError` carrying `partialResult` = the last payload. This is what lets the chat
  hand the model partial work instead of nothing.

A run always settles: a result that cannot be structured-cloned (returning a function, a class
instance, a Proxy) now rejects with an explicit "could not be transferred" error instead of
stranding the caller until the timeout.

## Stored results & method-level docs

Two helpers for consumers that relay script results to a context-limited channel
(e.g. the LLM chat) — see `src/classes/scripting/README.md` for details:

- `context.storeResult(value)` parks a large value under a **context-scoped handle**
  (bounded LRU, runtime-only, never serialized); scripts read bounded slices back via
  `application.readScriptResult(handle, { path, offset, maxChars })`.
- `manager.getMethodManifest(refs)` returns consent-filtered docs for specific
  `namespace.method` pairs; pair with `ScriptingManager.extractApiReferences(script,
  namespaces)` (static text scan) to attach exact signatures to failure feedback.

## ⚠️ Limitations
- URLs not supported: `createWorker`/`executeScript` only accept serialized strings for security. I.e., scripts you 'have at hand'.
- One-Way Communication: Host-side calls are currently fire-and-forget.
- `createWorker` is now **async** (`Promise<Worker | null>`) because workers come from the
  warm pool; prefer `executeScript`, which resolves to the script's result.