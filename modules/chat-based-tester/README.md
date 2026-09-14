# chat-based-tester

Dev-only tester module built on top of `vercel-ai-chat-sdk`.

## What it does
- reuses the existing chat provider/session stack
- lets you choose between `Host App` testing and `Scripting API` testing per session
- seeds each new test session with xOpat coding guidelines, READMEs, and selected source files
- reads dev server status from `window.xserver.server.core.getStatus()`
- reads recent dev server logs from `window.xserver.server.core.getLogs()`
- reads recent browser console logs from the shared `console.appTrace` export buffer (see below)
- exposes workspace file reads through `window.xserver.module["chat-based-tester"]`
- executes constrained `xopat-script` blocks through the normal scripting API
- also allows `xopat-host-script` unsafe host JS execution, but only when the server reports dev mode

## Browser console logs
xOpat's page template installs `window.console.appTrace` — the export buffer that captures
`console.warn`, `console.error`, `window.onerror`, and `unhandledrejection` (see
`server/templates/index.html`). This module reuses that buffer as the single console-log source:

- In dev mode it additionally wraps `console.log` / `console.info` / `console.debug` to push
  `LOG` / `INFO` / `DEBUG` entries into the **same** `console.appTrace` (double-install guarded via
  `console.__xopatChatDevConsoleCapture`), so the loader's error export sees the same data.
- Buffer growth is bounded by the `consoleLogBufferSize` static-meta (element count, default 5000);
  trimmed elements accumulate in `console.__appTraceShift` so absolute cursors stay valid.
- Host helper: `getConsoleLogs({afterIndex?, limit?, search?, maxChars?})` returns
  `{ lines, text, truncated, hasMore, nextAfterIndex, totalBuffered }`. Pass the previous
  `nextAfterIndex` as `afterIndex` to read only new entries (same cursor idea as server `getLogs`).
- Per-turn injection: the "Include recent console logs" checkbox (default from
  `defaultIncludeConsoleLogs`) prepends new-since-last-turn console lines to every run, in both
  host and scripting mode.

## Dev-only gating
This module is intentionally disabled unless the server reports dev mode. Three walls, in
the order they are hit:

1. **`"devOnly": true` in `include.json`** — the loader refuses to register the module when
   `APPLICATION_CONTEXT.env.server.devMode !== true` (`src/loader.ts`,
   `incompatibilityReason`). A plugin that `requires` it refuses up front for the same
   reason. Nothing session-supplied can clear the marker.
2. **The constructor** — a console/test instantiation that bypasses the loader still exits
   immediately, mounting no tab, patching no console and registering no personality.
3. **`xopat-host-script` execution** — refused by `isUnsafeHostExecutionAllowed()`.

Server-reported dev mode is the source of truth throughout:
- `window.XOPAT_DEV_MODE === true`
- `CORE.server.devMode === true`

The server side agrees independently: every RPC in `server/chat-dev.server.js` calls
`requireDevMode(ctx)`, and `vercel-ai-chat-sdk` honours `executionMode: 'host'` only when
`XOPAT_SERVER.isDevMode(ctx)` is true — so a harness session replayed against a production
server gets the ordinary chat prompt, not the host-execution one.

## Scripting consent is borrowed, not taken
In `Scripting API` mode the harness needs a wider grant than the user's posture. It takes
one through `chatModule.beginTemporaryScriptConsent()` and restores it in a `finally`.

This matters because consent lives on the single `vercel-ai-chat-sdk` instance and is
remembered: `setScriptNamespaceConsent` flips the mode to `custom`, persists the grant with
an expiry, and a cached posture outranks the operator's `defaultScriptConsentMode` on the
next construction. The harness must never leave a grant behind for the normal Chat tab.
`sensitive` namespaces (`patient`) are **not** added by the temporary grant; a grant the user
made themselves is preserved.

## RPC routes
Built-in dev core RPC:
- `window.xserver.server.core.getStatus(payload?)`
- `window.xserver.server.core.getLogs(payload?)`

Tester module RPC:
- `window.xserver.module["chat-based-tester"].getDevSessionBootstrap(payload?)`
- `window.xserver.module["chat-based-tester"].readWorkspaceFiles({ paths, maxFileChars? })` — per-path failures are
  reported in the result `errors` array; valid paths still return content
- `window.xserver.module["chat-based-tester"].listWorkspaceDir({ path, maxEntries? })` — directory discovery, limited
  to `src`, `modules`, `plugins`, `server`, `ui`, `docs` plus `*.md`/`*.json` at the repo root

## Unsafe host execution
When dev mode is enabled, the assistant may emit:

```text
```xopat-host-script
// unrestricted host-side JS
```
```

This runs directly in the viewer page and can access globals, DOM, RPC helpers, and viewer state. It must never be enabled for production usage.

Injected host helpers (also available as direct globals inside `xopat-host-script`):
`getServerStatus()`, `getServerLogs()`, `getConsoleLogs()`, `listWorkspaceDir(path)`,
`readWorkspaceFiles(paths)`, `getDevSessionBootstrap()`, `captureViewerScreenshotDataUrl()`,
`capturePageScreenshotDataUrl()`, `inspectRuntime()`, `inspectDom()`.

In host mode, generic ` ```js `/` ```ts ` fenced blocks in the assistant reply are executed as host
code as well (the sandboxed scripting worker would reject them — no scripting manifest is granted
in host mode).

## Modes
- `Host App`: the harness does not send the scripting manifest, so the chat is free to use `xopat-host-script` as the primary execution path.
- `Scripting API`: the harness sends the allowed scripting manifest and expects `xopat-script` to be the primary execution path.

## Run
Start the node server in dev mode:

```bash
node server/node/index.js --dev
```

or

```bash
XOPAT_DEV_MODE=1 node server/node/index.js
```
