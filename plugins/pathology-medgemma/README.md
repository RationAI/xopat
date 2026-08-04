# MedGemma pathology plugin

Wires a **self-hosted MedGemma** vision-language model into the
`pathology-foundation` module as its **`analyze`** driver, so the chat agent and
the `pathology` scripting namespace can run image→text findings on the active
viewport (`pathology.analyzeRegion("…")` /
`PathologyFoundation.instance().analyzeRegion(viewer, { prompt })`).

> **MedGemma is internal-only — not a chat provider.** It is a specialized 4B vision
> model, not a general agent, so it is registered `hidden` and does **not** appear in the
> chat provider picker. A capable chat agent (e.g. Cerit/Anthropic) does the reasoning and
> calls MedGemma for the vision step via `pathology.analyzeRegion`, which captures the
> viewport and routes the image through the isolated `runVisionInference` RPC. See the
> `vercel-ai-chat-sdk` README ("Internal (hidden) providers") for the general pattern.

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

A ready-to-run MedGemma deployment lives in the sibling repo
`../xopat-medgemma-ollama`.

## Security notes

- **SSRF guard:** self-hosted MedGemma usually runs on a private/loopback host,
  which xOpat's SSRF guard (`validateUpstreamUrl`) rejects by design. Reach it by
  adding the host to the **operator allowlist** —
  `XOPAT_SSRF_ALLOWED_HOSTS` / `XOPAT_SSRF_ALLOWED_CIDRS`, see
  [`server/README.md`](../../server/README.md) — which relaxes only the private-IP
  verdict and keeps redirect and DNS-rebinding protection.

  There is deliberately **no per-provider bypass flag**. A `validateUpstream:
  false` option used to skip the check, justified by "`baseUrl` is operator-only
  config, never user-supplied". That was not true: provider config accepted keys
  absent from the schema, so a caller could set the endpoint *and* the switch that
  disabled the check — full SSRF into loopback, link-local and cloud-metadata
  addresses, with the operator's key attached.
- **Login:** `runVisionInference` requires a logged-in session. On anonymous
  deployments the `analyze` call will be rejected upstream.
- **Consent:** the driver is `local: false`, so the scripting layer asks the
  user before a snapshot leaves the viewer.

## Performance / timeouts

Vision inference is slow on CPU-only backends (self-hosted Ollama without a GPU can take
minutes). Two timeouts must both be long enough, or the call aborts mid-request:

- **Server:** `runVisionInference` policy timeout — env `XOPAT_PATHOLOGY_VISION_TIMEOUT_MS`
  (default 300000 ms = 5 min). Requires a server restart.
- **Client:** this plugin's RPC timeout — `inferenceTimeoutMs` in the plugin config
  (default 315000 ms, ~5 min + margin). Keep it **≥** the server value so the server's
  result/timeout ends the call, not the browser giving up.

For faster responses, use a GPU backend (see the deployment repo) and/or frame a smaller region
before calling `analyzeRegion`.

## Requirements

Depends on the `vercel-ai-chat-sdk` and `pathology-foundation` modules (declared
in `include.json`). If `pathology-foundation` is not loaded the plugin is a
no-op.
