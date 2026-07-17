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
This module is intentionally disabled unless the server reports dev mode.

The current implementation treats server-reported dev mode as the main source of truth:
- `window.XOPAT_DEV_MODE === true`
- `CORE.server.devMode === true`

If dev mode is not enabled, the tester panel stays disabled and `xopat-host-script` execution is refused.

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
