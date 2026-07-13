# Pathology Foundation Models Module

A broker that runs **named pathology jobs** on the active viewport for the chat agent (and any scripting
consumer). Instead of one vague "analyze" call, it exposes a small set of **features** a model can implement
— and lets each driver register only the features it actually supports. The foundation resolves a capable
driver per requested feature, runs it on the captured viewport, and materializes the result (masks → polygon
annotations, coverage → a ratio, analysis → text).

Crucially, it **works out of the box**: a built-in, dependency-free tissue detector runs entirely in the
browser, so tissue jobs need no server and no data ever leaves the viewer. Admins can later plug in stronger
models (a segmentation endpoint, a vision-LLM via the Vercel SDK, the SAM plugin, …) without touching this
code.

---

## Table of Contents

* [Architecture](#architecture)
* [Features (the normalized contract)](#features-the-normalized-contract)
* [Drivers](#drivers)
    * [`builtin` (always present)](#builtin-always-present)
    * [`http`](#http)
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
agent (any chat provider) ──emits xopat-script──▶  pathology.annotateTissue() / tissueCoverage(id)
                                                   pathology.segmentRegion()  / analyzeRegion()      [namespace]
                                                            │
                          PathologyFoundation resolves a driver FOR THE REQUESTED FEATURE, captures the
                          viewport, runs it, and commits the result on the calling viewer.
             ┌──────────────────────────┬──────────────────────────┬──────────────────────────┐
       feature: tissue-mask       feature: segment            feature: analyze
       driver "builtin" (local)   driver "sam-local" (local)  driver "vlm-sdk" (vercel)
       Otsu-on-saturation,        transformers.js SAM         isolated one-shot generate
       in-browser, no deps        [SAM plugin]                [text only, separate provider]
       (or a server override)     (or an http endpoint)
```

`PathologyFoundation` is an `XOpatModuleSingleton` (id `pathology-foundation`). It owns:

- shared **viewport capture** + **mask→polygon** tracing, multi-viewport-safe — the viewer is always passed
  explicitly, never `window.VIEWER`;
- a **feature-indexed driver registry** — the built-in tissue detector plus any drivers from configuration or
  runtime registration; per-feature default resolution;
- the concrete **tissue jobs** (`annotateTissue`, `tissueCoverage`, `computeTissueMask`), point-driven
  `segmentAtPoint`, and `analyzeRegion`;
- interactive **pick-a-point** / **select-an-annotation** helpers;
- the **`pathology` scripting namespace** that the LLM/agent calls.

**Reads the raw background image, not the overlay.** Tissue/segment pixels come from the core `visualization`
scripting API's `renderCurrentBackgroundPixels` (reached via `ScriptingManager.getApi('visualization')` bound to
the target viewer), which renders only the background image group of the live viewport — no data/visualization
overlay, no hand-rolled capture. Only `analyzeRegion` uses the on-screen composite.

It `requires` the `annotations` module (to draw masks and read annotation geometry). Globals are used across
boundaries (no cross-module ES imports); the module is reached with `singletonModule('pathology-foundation')`.

---

## Features (the normalized contract)

A **feature** is a named job with a fixed input/output shape. A driver declares the features it can perform
by providing a handler per feature; the foundation only routes a feature to a driver that implements it.

The `tissue-mask` / `segment` inputs carry the **background** RGBA pixels of the live viewport plus a lazy
`toBlob()` (so a remote driver can POST the same raw slide); `analyze` gets the on-screen composite blob.

| Feature | Input | Output | Prompt? |
| --- | --- | --- | --- |
| `tissue-mask` | `{ width, height, pixels, toBlob }` | `MaskResult` | no — automatic foreground detection |
| `segment` | `{ width, height, pixels, toBlob, prompt, point? }` | `MaskResult \| null` | yes — point-driven region |
| `analyze` | `{ imageBlob, prompt }` | `{ text }` | yes — vision → text findings |

```ts
type PathologyFeature = "tissue-mask" | "segment" | "analyze";

interface MaskResult { binaryMask: Uint8Array; width: number; height: number; label?: string; score?: number }

// tissue-mask/segment inputs: background pixels + lazy PNG encoder
interface PixelSource { width: number; height: number; pixels: Uint8ClampedArray | number[]; toBlob: () => Promise<Blob> }

interface FmDriver {
    id: string;
    label?: string;
    local?: boolean;                 // true => runs in-browser, no snapshot leaves the viewer
    config?: Record<string, unknown>;
    features: {
        "tissue-mask"?: (input: PixelSource) => Promise<MaskResult>;
        "segment"?:     (input: PixelSource & { prompt: string; point?: {x:number;y:number} }) => Promise<MaskResult | null>;
        "analyze"?:     (input: { imageBlob: Blob; prompt: string }) => Promise<{ text: string }>;
    };
}
```

Adding a new job later means adding a feature id + contract here — existing drivers keep working, and only
drivers that opt into the new feature implement it.

---

## Drivers

### `builtin` (always present)

A dependency-free tissue detector, registered first so it is the default for `tissue-mask`. On a brightfield
(e.g. H&E) slide the glass background is bright and unsaturated while stained tissue is coloured, so it
thresholds the HSV **saturation** channel with an adaptive **Otsu** cut and drops near-white pixels. It is a
statistical approximation — good enough to bootstrap masks/coverage offline, and fully overridable by
registering a real `tissue-mask` driver (via config or `defaultDrivers`). `local: true` → nothing leaves the
viewer.

### `http`

Calls a configured image→mask endpoint through `window.HttpClient` (auth/proxy/secureMode aware):
`POST { image, prompt, point, model }` → `{ binary_mask (base64), width, height, label?, score? }`
(SAM `/segment`-compatible). Its `feature` config picks the job it serves — `"segment"` (default) or
`"tissue-mask"` (to override the built-in detector with a server model). Use `proxyAlias` to keep upstream
credentials on the server (`server.secure.proxies.<alias>`), or `baseURL` for an absolute endpoint.

> Vision→text is intentionally **not** an http mode: rather than hardcode one provider's chat wire format,
> analysis is routed through the `vercel` driver, which adapts every provider the SDK supports.

### `vercel` (optional)

Implements the `analyze` feature. Calls the `vercel-ai-chat-sdk` module's **stateless** `runVisionInference`
RPC, which resolves a model and runs a single `generateText` in a context **fully isolated** from the chat
agent — no session, history, or personality. It must be bound to a **dedicated pathology provider instance**
(`providerId`) so the model + secrets are separate from whatever drives the agent above. The pathology module
never hard-depends on the chat module; the driver throws a clear error if it is absent.

### Custom drivers (runtime registration)

Any module/plugin can add a driver — this is how the SAM plugin contributes its in-browser engine:

```js
const pathology = singletonModule('pathology-foundation');
pathology.registerDriver({
    id: "my-model",
    label: "My segmentation model",
    local: true,                                // or omit for a remote driver
    features: {
        "segment": async ({ imageBlob, prompt, point }) => {
            return await runMyModel(imageBlob, prompt, point);   // MaskResult | null
        },
    },
});
```

---

## Configuration

The built-in tissue driver is always available. Additional `http` / `vercel` drivers are declared in
`include.json` (comments allowed); all are optional.

```jsonc
{
  "id": "pathology-foundation",
  "requires": ["annotations"],
  "defaultDrivers": {
    // optional per-feature default overrides, e.g.:
    "analyze": "vlm-sdk"
    // (a feature with no override uses the first registered capable driver;
    //  tissue-mask defaults to "builtin" unless you register a replacement)
  },
  "drivers": {
    // Server tissue detector, overriding the built-in one:
    "tissue-seg": {
      "type": "http", "feature": "tissue-mask",
      "proxyAlias": "pathology-seg", "path": "segment", "label": "Tissue segmentation (server)"
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
agent toward concrete jobs instead of guessing. Select the viewer first (`application.setActiveViewer(...)`).
Consent is requested **only when the resolved driver is remote** (a snapshot would leave the viewer); the
built-in tissue jobs run silently.

```ts
pathology.listDrivers(): PathologyDriverInfo[];                       // { id, label, local, features[] }

// whole-slide orientation — call FIRST; regions are ranked tissue islands with navigable bounds
pathology.exploreSlide(options?): Promise<SlideExploration>;          // { slideCoverage, isComplete, regions[], slide }
pathology.reviewRegions(options?): Promise<RegionReviewResult[]>;     // frame each region + run a job (analyze | tissue-mask)

// tissue jobs — built-in, local, read the raw background, no server needed
pathology.annotateTissue(driver?): Promise<TissueAnnotationResult>;  // outline ALL tissue as annotation(s)
pathology.tissueCoverage(annotationId?, driver?): Promise<TissueCoverageResult>;  // { annotationTissueFraction: 0..1, fractionOfViewTissue: 0..1, ... }

// point-driven segmentation (asks the user to click) + text analysis
pathology.segmentAtPoint(prompt?, driver?): Promise<SegmentResult>;  // segment the clicked spot → annotation
pathology.analyzeRegion(prompt, driver?): Promise<AnalysisResult>;   // vision → text findings (remote)

// interactive helpers (local, prompt-only)
pathology.pickPoint(message?): Promise<{x,y} | null>;                // ask the user to click a point
pathology.getSelectedAnnotation(): { id } | null;                    // the currently selected annotation
pathology.requestAnnotationSelection(message?): Promise<id | null>;  // await a user selection
```

`tissueCoverage()` with no id, and `segmentAtPoint()`, drive the user interactively (select an annotation /
click a point). Example (measure tissue in a region the user picks):

```xopat-script
await application.setActiveViewer(contextId);
return await pathology.tissueCoverage();   // user is asked to select the region
```

---

## Public module API

For code (not scripts) — `const pf = singletonModule('pathology-foundation')`. Every viewer-bound method
takes the viewer explicitly (multi-viewport-safe).

| Method | Purpose |
| --- | --- |
| `registerDriver(driver)` / `unregisterDriver(id)` | Add/replace / remove a transport. |
| `listDrivers()` | `{ id, label, local, features }[]`. |
| `getDriverForFeature(feature, id?)` | Resolve a capable driver (throws if none). |
| `describeDriverForFeature(feature, id?)` | `{ id, label, local }` — for consent decisions. |
| `exploreSlide(viewer, { driver?, annotate?, hint?, minAreaFraction? })` | Whole-slide orientation → `{ slideCoverage, isComplete, regions[], slide }`; `isComplete: false` marks a provisional (partially-loaded) overview. |
| `reviewRegions(viewer, { regions?, max?, magnification?, feature?, prompt?, driver? })` | Frame each tissue region and run a per-region job → `RegionReviewResult[]`. |
| `computeTissueMask(viewer, { driver? })` | `{ coverage, tissuePixels, totalPixels, ... }` (no annotation). |
| `annotateTissue(viewer, { driver? })` | Detect tissue → polygon annotation(s) → `{ annotationIds, viewCoverage }`. |
| `tissueCoverage(viewer, annotationId, { driver? })` | `{ annotationTissueFraction, fractionOfViewTissue, ... }` for one annotation. |
| `segmentAtPoint(viewer, { prompt?, driver?, point? })` | Point mask → `{ status, annotationIds }` (`point` in image coords; `status` separates empty vs rejected masks). |
| `analyzeRegion(viewer, { prompt, driver? })` | Vision → `{ findings }`. |
| `pickViewportPoint(viewer, { message?, timeoutMs? })` | Await a user click → `{x,y}` image coords (or null). |
| `getSelectedAnnotationId(viewer)` / `awaitAnnotationSelection(viewer, ...)` | Current / awaited annotation selection. |
| `captureViewportImage(viewer)` | `{ blob, width, height }` on-screen composite PNG (used by `analyze` / SAM). |
| `maskToPolygon(mask, ref, w, h, ratio, viewer)` | Trace a mask's largest region to image-space points (shared infra). |

Events: `analysis-started`, `analysis-finished` (both carry `{ driver, feature }`), `drivers-changed`.

---

## SAM integration

The `sam-segment-tool-experimental` plugin depends on this module. It registers a `sam-local` driver
implementing the **`segment`** feature (point-prompted); the foundation hands it the background pixels + a lazy
PNG blob and a seed point (from the user's click, defaulting to the view centre). So an agent can request a SAM
mask through `pathology.segmentAtPoint(...)` without any SAM-specific scripting.

---

## Security

- All upstream HTTP goes through `window.HttpClient`; remote secrets stay server-side via `proxyAlias`.
- Snapshot-leaving-the-viewer calls are **consent-gated** in the namespace, and only when the resolved driver
  is remote — the built-in tissue detector is local, so tissue jobs never prompt or transmit.
- The `vercel` driver runs in an isolated, stateless context bound to a dedicated provider — the chat agent
  and the pathology model never share session/credentials.
- Mask geometry is range-checked (empty / >90%-coverage masks are rejected for single-region segmentation).
