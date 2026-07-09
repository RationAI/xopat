# MedGemma pathology plugin

Wires a **self-hosted MedGemma** vision-language model into the
`pathology-foundation` module as its **`analyze`** driver, so the chat agent and
the `pathology` scripting namespace can run image→text findings on the active
viewport (`pathology.analyzeRegion("…")` /
`PathologyFoundation.instance().analyzeRegion(viewer, { prompt })`).

## How it works

MedGemma is served over the **OpenAI-compatible** wire format (Ollama, vLLM,
TGI), so there is nothing MedGemma/Ollama-specific to implement:

1. `medgemma-host.server.ts` registers a **dedicated pathology provider** in the
   chat SDK registry via `vercel-ai-chat-sdk`'s `ensureManagedPluginProvider`,
   using an inline OpenAI-compatible adapter. The endpoint (`baseUrl`, `apiKey`,
   `defaultModelId`) comes from **server-only** secure config and never reaches
   the browser. This provider is deliberately separate from any chat-agent
   provider — pathology inference never shares model/secrets/context with chat.
2. `index.workspace.js` learns that provider's id and calls
   `pathology-foundation.registerDriver({ id: "medgemma", features: { analyze } })`.
   The `analyze` handler forwards the viewport snapshot to the chat SDK's
   **stateless** `runVisionInference` RPC (no session/history), which resolves
   the model and runs one isolated generation.

Because it is the only `analyze` driver, MedGemma becomes the default for that
feature automatically.

## Configuration

Endpoint config lives in `server.json` (author defaults) and can be overridden
by the deployer under `core.server.secure.plugins.pathology-medgemma`:

```json
"plugins": { "pathology-medgemma": { "permaLoad": true, "authMode": "jwt" } },
"server": { "secure": { "plugins": { "pathology-medgemma": {
  "providerDefaults": {
    "baseUrl": "http://xopat-medgemma-ollama:11434/v1",
    "defaultModelId": "medgemma-4b-it",
    "apiKey": ""
  }
}}}}
```

- `baseUrl` — the OpenAI-compatible endpoint the **server** reaches (server→model,
  not browser→model). For a docker companion use its service name; the endpoint
  is never exposed to clients.
- `defaultModelId` — the model name as the endpoint reports it (see the
  deployment repo for creating a `medgemma-4b-it` alias in Ollama).
- `apiKey` — server-only; Ollama needs none.
- `validateUpstream` (default `false`) — see security note below.

A ready-to-run MedGemma deployment lives in the sibling repo
`../xopat-medgemma-ollama`.

## Security notes

- **SSRF guard:** self-hosted MedGemma usually runs on a private/loopback host,
  which xOpat's SSRF guard (`validateUpstreamUrl`) rejects by design. The
  `baseUrl` here is **operator-only** secure config (never user-supplied), so it
  is trusted and the private-IP check is skipped. Set
  `"validateUpstream": true` only when pointing at a **public, untrusted**
  endpoint that should be vetted.
- **Login:** `runVisionInference` requires a logged-in session. On anonymous
  deployments the `analyze` call will be rejected upstream.
- **Consent:** the driver is `local: false`, so the scripting layer asks the
  user before a snapshot leaves the viewer.

## Requirements

Depends on the `vercel-ai-chat-sdk` and `pathology-foundation` modules (declared
in `include.json`). If `pathology-foundation` is not loaded the plugin is a
no-op.
