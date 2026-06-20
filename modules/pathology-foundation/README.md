# Pathology Foundation Models Module

A generic broker that lets the chat agent (and any scripting consumer) send a **slide snapshot + a text
prompt** to a configurable **pathology foundation model** and turn the result into either **polygon
annotations** (segmentation masks) or **text findings** (classification / description).

It replaces "guessing" — e.g. computing a viewport bounding box — with a real model call. The agent reaches
it through the `pathology` scripting namespace; the model behind it is pluggable, so an admin can wire
MedGemma, a SAM-style segmentation server, or any other model without touching this code.

---

## Table of Contents

* [Architecture](#architecture)
* [The normalized contract](#the-normalized-contract)
* [Drivers](#drivers)
    * [`http` (default)](#http-default)
    * [`vercel` (optional)](#vercel-optional)
    * [Custom drivers (runtime registration)](#custom-drivers-runtime-registration)
* [Configuration](#configuration)
* [The `pathology` scripting namespace](#the-pathology-scripting-namespace)
* [Public module API](#public-module-api)
* [SAM integration](#sam-integration)
* [Security](#security)

---

## Architecture

```
agent (any chat provider) ──emits xopat-script──▶  pathology.segmentRegion() / analyzeRegion()   [namespace]
                                                            │
                                  PathologyFoundation.analyze(viewer, { prompt, task, driver })
                                                            │  capture snapshot → driver → (masks → polygons)
                          ┌─────────────────────────────────┼─────────────────────────────────┐
                   driver: http (default)             driver: sam-local (optional)       driver: vercel (optional)
                   HttpClient → endpoint               transformers.js, in-browser        isolated one-shot generate
                   (segment | openai-chat)             [registered by the SAM plugin]     [text only, separate provider]
```

`PathologyFoundation` is an `XOpatModuleSingleton` (id `pathology-foundation`). It owns:

- shared **viewport capture** + **mask→polygon** tracing (factored out of the SAM module so every model
  shares one implementation), multi-viewport-safe — the viewer is always passed explicitly;
- a **driver registry** — built-in drivers come from configuration, others register at runtime;
- the **`analyze` orchestration** — capture → driver → commit masks as polygon annotations on the calling
  viewer → return findings + a summary;
- the **`pathology` scripting namespace** that the LLM/agent calls.

It `requires` the `annotations` module (to draw masks). Globals are used across boundaries (no cross-module
ES imports); the module is reached with `singletonModule('pathology-foundation')`.

---

## The normalized contract

Every transport adapts its wire protocol to one contract, so swapping models never changes the
agent-facing namespace:

```ts
interface FmDriver {
    id: string;
    label?: string;
    capabilities: { masks?: boolean; text?: boolean };
    config?: Record<string, unknown>;
    analyze(input: {
        imageBlob: Blob;                 // PNG of the captured viewport (device pixels)
        prompt: string;                  // user/agent text
        task: "segment" | "analyze";
        config: Record<string, unknown>; // the driver's own config
    }): Promise<{
        masks?: Array<{ binaryMask: Uint8Array; width: number; height: number; label?: string; score?: number }>;
        findings?: string | Record<string, unknown>;
    }>;
}
```

`analyze()` then traces each returned mask into a polygon annotation on the active viewer and returns:

```ts
{ driver: string; annotationIds: Array<string|number>; findings: string|object|null; summary: string }
```

---

## Drivers

### `http` (default)

Calls a configured endpoint through `window.HttpClient` (auth/proxy/secureMode aware). Two modes:

* **`mode: "segment"`** — `POST { image, prompt, model }` to a custom image→mask endpoint and decodes a
  `{ binary_mask (base64), width, height }` response (SAM `/segment`-compatible).
* **`mode: "chat"`** — `POST` an OpenAI-compatible `/v1/chat/completions` request with the snapshot as an
  `image_url` part and returns the assistant text (e.g. MedGemma served via vLLM/TGI).

Use `proxyAlias` to keep upstream credentials on the server (`server.secure.proxies.<alias>`), or `baseURL`
for an absolute endpoint.

### `vercel` (optional)

Text/analysis only. Calls the `vercel-ai-chat-sdk` module's **stateless** `runVisionInference` RPC, which
resolves a model and runs a single `generateText` in a context **fully isolated** from the chat agent — no
session, history, or personality. It must be bound to a **dedicated pathology provider instance**
(`providerId`) so the model + secrets are separate from whatever drives the agent above. The pathology
module never hard-depends on the chat module; the driver throws a clear error if it is absent.

### Custom drivers (runtime registration)

Any module/plugin can add a driver — this is how the SAM plugin contributes its in-browser engine:

```js
const pathology = singletonModule('pathology-foundation');
pathology.registerDriver({
    id: "my-model",
    label: "My segmentation model",
    capabilities: { masks: true },
    analyze: async ({ imageBlob, prompt, task, config }) => {
        const masks = await runMyModel(imageBlob, prompt);
        return { masks };           // or { findings: "..." }
    },
});
```

---

## Configuration

Built-in `http` / `vercel` drivers are declared in `include.json` (comments allowed). All entries are
optional — with none configured, the only driver is whatever a plugin registers at runtime (e.g.
`sam-local`).

```jsonc
{
  "id": "pathology-foundation",
  "requires": ["annotations"],
  "defaultDriver": "",            // id of the driver used when a call omits `driver`
  "drivers": {
    // Vision/analysis (OpenAI-compatible chat, e.g. MedGemma via vLLM/TGI):
    "medgemma": {
      "type": "http", "mode": "chat",
      "proxyAlias": "pathology", "path": "v1/chat/completions",
      "model": "medgemma-4b-it", "label": "MedGemma"
    },
    // Segmentation (custom image->mask endpoint, SAM /segment-compatible):
    "tissue-seg": {
      "type": "http", "mode": "segment",
      "proxyAlias": "pathology-seg", "path": "segment", "label": "Tissue segmentation"
    },
    // Vision/analysis through the Vercel AI SDK (isolated from the chat agent;
    // providerId MUST be a dedicated pathology provider, not the agent's):
    "vlm-sdk": {
      "type": "vercel",
      "providerId": "<dedicated-pathology-provider-id>",
      "model": "medgemma-4b-it", "label": "MedGemma (SDK)"
    }
  }
}
```

---

## The `pathology` scripting namespace

Injected into the agent's system prompt automatically (with its inline type declarations). It steers the
agent toward real model calls instead of bounding boxes. Select the viewer first
(`application.setActiveViewer(...)`); both analysis methods ask the user for permission, since a slide
snapshot leaves the viewer.

```ts
// list configured drivers + capabilities
pathology.listDrivers(): PathologyDriverInfo[];

// snapshot + prompt → segmentation model → polygon annotation(s)
pathology.segmentRegion(prompt?: string, driver?: string): Promise<PathologyAnalysis>;

// snapshot + prompt → vision/analysis model → text findings
pathology.analyzeRegion(prompt: string, driver?: string): Promise<PathologyAnalysis>;

// PathologyAnalysis = { driver, annotationIds, findings, summary }
```

Example (what the agent emits):

```xopat-script
await application.setActiveViewer(contextId);
return await pathology.segmentRegion("outline the tumour epithelium");
```

---

## Public module API

For code (not scripts) — `const pf = singletonModule('pathology-foundation')`:

| Method | Purpose |
| --- | --- |
| `registerDriver(driver)` | Add/replace a transport. |
| `unregisterDriver(id)` | Remove a transport. |
| `getDriver(id?)` | Resolve a driver (or the default). |
| `listDrivers()` | `{ id, label, capabilities, isDefault }[]`. |
| `analyze(viewer, { prompt, task, driver? })` | Capture → driver → commit masks → `{ annotationIds, findings, summary }`. |
| `captureViewportImage(viewer)` | `{ blob, width, height }` PNG capture (shared infra). |
| `maskToPolygon(mask, ref, w, h, ratio, viewer)` | Trace a binary mask to image-space points (shared infra). |

Events: `analysis-started`, `analysis-finished`, `drivers-changed`.

---

## Security

- All upstream HTTP goes through `window.HttpClient`; remote secrets stay server-side via `proxyAlias`.
- Snapshot-leaving-the-viewer calls are **consent-gated** in the namespace (medical data leaves the client).
- The `vercel` driver runs in an isolated, stateless context bound to a dedicated provider — the chat agent
  and the pathology model never share session/credentials.
- Mask deserialization is range-checked (empty / >90%-coverage masks are rejected as invalid).
