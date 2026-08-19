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
    * [Slide-wide expert overview (`buildOverview`)](#slide-wide-expert-overview-buildoverview)
    * [Going deeper, and comparing](#going-deeper-and-comparing)
* [Public module API](#public-module-api)
* [Seeing what was analyzed](#seeing-what-was-analyzed)
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
| `cellularity` | `{ width, height, pixels, toBlob, mask?, cell?, stainClass? }` | `DensityGrid` | no — where the nuclei are |

`cellularity` is what makes "spend the budget where the cells are" possible before any budget is spent. The
built-in implementation unmixes the nuclear stain locally (no model, no server); a deployment with a real
nuclei detector registers a driver for the same feature and every consumer picks it up unchanged.

```ts
type PathologyFeature = "tissue-mask" | "segment" | "analyze" | "cellularity";

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
        "cellularity"?: (input: PixelSource & { mask?: MaskResult; cell?: number; stainClass?: string })
                            => Promise<{ values: Float32Array | number[]; width: number; height: number }>;
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

// hierarchical "expert overview" — describe + score + drill; cached per slide for broad queries
pathology.buildOverview(options?): Promise<OverviewResult>;          // { root[], slideCoverage, budget, summary? } — needs an analyze driver
pathology.getOverview(): OverviewResult | null;                      // the cached tree for the current slide (cheap, local)
pathology.clearOverview(): void;                                     // drop the cache (force a rebuild)

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

### Slide-wide expert overview (`buildOverview`)

Broad questions ("where are the regions with X?", "is there cancer, and is it invasive?", "report the
findings") are hard for an agent with no map of the slide. `buildOverview` builds one — and four properties
decide whether that map is worth anything.

**The query is the schema.** A checklist of named features is derived from `query` (by the scripting adapter,
using the assistant's own model — see [`scripting/api.ts`](scripting/api.ts)), each feature carrying the µm/px
needed to judge it. That checklist then drives *everything*: what every field is asked, which ladder rungs are
rendered, when the walk drills deeper, how nodes rank, and what the report rows are. One number, one path —
`requiredMpp` → ladder rung → field → delivered resolution → "assessable here?" → drill decision → evidence
row. Without a query the run falls back to a deliberately vocabulary-free generic checklist and says so via
`checklist.source: "fallback"` plus a warning; the schema downstream is identical either way.

The checklist is **sanitized twice** — once where it is derived and again in the engine on anything a caller
passes. It is model-written text bound for another model's prompt, so bounding it is a security control
(AGENTS.md §0.2/§7), not tidiness: capped count and lengths, slugged ids, no control characters or template
punctuation, `requiredMpp` clamped into a range a real slide can satisfy.

**Answers are typed, and `not-assessable` is not `no`.** Each field returns one `FeatureAnswer` per feature
(`present`, `confidence`, a short statement). A feature the field's resolution cannot carry is recorded
`{present: "not-assessable", reason: "resolution"}` with **no model call at all** — both the honest answer and
the signal that sends the walk deeper. Conflating that with a negative is how a feature gets reported as absent
when the image could never have shown it, so every degraded parse path in [`lib/answers.ts`](lib/answers.ts)
resolves to `not-assessable` rather than to `no`.

**Coverage is paid for first.** The budget splits into a *reserved* survey account and a focus account
(`surveyFraction`, default 0.35 of `maxAnalyzeCalls`). Phase A reads every tissue island once at the coarsest
rung; focus expansion cannot draw on that account, and unspent survey budget rolls over only *after* the survey
completes. Phase B then pops from a single **global** priority queue, so the next call goes to the globally
most promising region rather than to the most promising child of wherever a recursion happens to be. A
`noveltyWeight` of `1/(1 + expansionsUnderThisRoot)` makes a branch worth progressively less as it is mined,
which is what stops one island consuming the budget while later ones are never visited at all.
`budget.surveyIncomplete` reports it when the floor could not be met. Vision calls run at `concurrency`
(default 4, matching the inference RPC's own ceiling); renders stay serialized by the core, by design.

**Resolution is delivered, not requested.** A field is a window of fixed physical size at an exact µm/px
([`lib/fields.ts`](lib/fields.ts)); a region too large for one call at that resolution is *tiled*, never
squashed into a pixel budget. `planFields` is the only place that decides tiling and is pure, so "a 60 000 px
region at 1.0 µm/px never comes back at 4.3 µm/px" is a unit test rather than a hope. The prompt quotes
`deliveredMpp` and only `deliveredMpp`. Where the walk must still trade resolution for coverage — the survey
rung over a whole island — it does so explicitly and states the shortfall rather than hiding it.

Every analyze call — the walk's own, `interrogateRegion`, `reviewRegions`, ad-hoc `analyzeRegion` — is wrapped
in the same grounding preamble (stain licence, site, measured scale and resolution) built from the slide
context, remembered per `tileSourceId` (`getSlideContext` / `setSlideContext`). Two calls on the same tissue
therefore share one frame of reference; an ungrounded drill is what lets one call report a feature *absent* and
the next report it *present and intact* with equal confidence. Parent/child findings that disagree that way are
detected and surfaced in `result.warnings` rather than silently resolved.

#### The result is an evidence table

`result.evidence` is the primary output: one row per question, with an aggregate verdict, per-outcome counts,
the regions that evidence it, and `underResolved` when nothing ever got close enough. Aggregation is
deliberately asymmetric — any `yes` wins, then `uncertain`, then `no` — because the walk samples *part* of the
slide, so one field showing a feature is evidence it exists while many not showing it is not proof it does not.

This replaces a `summary` that was the *first sentence* of the top five nodes glued together locally, which
discarded the rest of every node's text — routinely including the detail the reviewer had asked about.
`summary` still exists as a one-line-per-row rendering for callers that want a string, but it is not the source
of truth.

The tree is **cached per slide** (keyed by `tileSourceId`, in memory for the session), alongside the tissue
survey and its density map. The chat SDK surfaces a compact `pathologyOverview` marker in its live viewer-state
block whenever a cache exists — including `checklistSource` and `featuresUnderResolved`, so the agent can tell
whether the cached run answers the question now being asked or whether a new one is worth paying for. Counts
only: the feature labels are clinical payload and stay out of the every-turn context.

```xopat-script
await application.setActiveViewer(contextId);
let ov = await pathology.getOverview();
if (!ov || ov.checklist?.source === "fallback" || ov.budget.truncated) {
  // One consent for the whole run. The query is load-bearing: it becomes the checklist.
  ov = await pathology.buildOverview({ query: "is there carcinoma, and is it invasive?" });
}
// Answer from the evidence table, and cite the regions each row rests on.
return ov.evidence.map(row => ({
  feature: row.label,
  verdict: row.verdict,               // "not-assessable" is NOT "no"
  underResolved: row.underResolved,   // never report these as negative findings
  regions: row.citedBy.map(c => ({ label: c.label, bounds: c.bounds })),
}));
```

### Going deeper, and comparing

`buildOverview` is breadth. Three calls cover the rest:

- **`interrogateRegion(bounds, {questions | features})`** asks specific questions about one place at a
  resolution that can answer them, tiling the region itself and reporting `coveredFraction` when it had to
  sample. This is the call for *"check X in region N"*; a caller should never hand-split a region for it.
- **`montageRegions([...])`** composites several fields into one labelled image and answers about all of them
  in a **single** vision call — the difference between triaging a dozen candidates for one call and for twelve.
  Cells are letterboxed (never stretched), separated by gutters, and labelled in the image, so "do not read
  structures across cell borders" is visually true and every answer maps back to a region.
- **`buildDensityMap()`** is **free**: local Beer–Lambert unmixing of the nuclear stain, run on the survey
  raster that has already been rendered. It says where the cells are *before* any budget is spent, which
  "largest tissue island first" cannot — a large bland island and a small dense one are not equally worth a
  call. A deployment with a real nuclei detector registers a `cellularity` driver and the walk uses it instead
  with no other change; `stainVectors` in `include.json` overrides the colour basis for non-H&E slides.

Every region carries a **`label`** — its name for humans, counted from 1 and carrying the ancestry path
(`"region 2"`, `"region 2.1"`). `index` (rank among siblings) and `depth` are 0-based array internals and must
never reach the user or an assistant's answer; `label` is what the progress dialog, the evidence table, the
warnings and the chat all speak in. Drill depth is likewise rendered as a level counted from 1.

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
| `exploreSlide(viewer, { driver?, annotate?, hint?, minAreaFraction? })` | Whole-slide orientation rendered OFF-SCREEN (never moves the user's viewport) → `{ slideCoverage, isComplete, regions[], slide }`; `isComplete: false` marks a provisional (partially-loaded) overview. |
| `reviewRegions(viewer, { regions?, max?, magnification?, feature?, prompt?, driver? })` | Render each tissue region off-screen and run a per-region job → `RegionReviewResult[]`. |
| `buildOverview(viewer, { query?, features?, checklist?, maxDepth?, breadth?, scheduler?, surveyFraction?, concurrency?, interestThreshold?, minDrillFill?, maxAnalyzeCalls?, maxNodes?, annotate?, synthesize?, reuse?, driver? })` | Slide-wide expert overview: survey every tissue island out of a reserved budget, then expand the globally best regions → `OverviewResult` with an **evidence table**; cached per slide (by `tileSourceId`). Needs an `analyze` driver. |
| `interrogateRegion(viewer, { region, features? \| questions?, mpp?, maxFields?, driver? })` | Ask specific questions about ONE region at a resolution that can answer them; tiles the region itself → `InterrogationResult` with typed answers and `coveredFraction`. |
| `montageRegions(viewer, { regions, prompt? \| features?, cols?, cellPixels?, mpp?, driver? })` | Composite several regions into one labelled image and answer about all of them in a **single** vision call → `MontageResult`. |
| `buildDensityMap(viewer, { cell?, refresh?, driver? })` | FREE local nuclear-density grid over the slide (no model call) → `DensityMap` with `sample(bounds)` and `top(n)`. |
| `getOverview(viewer)` / `clearOverview(viewer)` | Read / drop the cached overview for the slide open in `viewer`. `clearOverview` also drops the remembered slide context. |
| `getSlideContext(viewer)` / `setSlideContext(viewer, ctx)` | Read / remember what the slide is (stain, class, site), keyed by `tileSourceId`. Every analyze call is grounded in it; asked once per slide, never persisted. |
| `computeTissueMask(viewer, { driver? })` | `{ coverage, tissuePixels, totalPixels, ... }` (no annotation). |
| `annotateTissue(viewer, { driver? })` | Detect tissue → polygon annotation(s) → `{ annotationIds, viewCoverage }`. |
| `tissueCoverage(viewer, annotationId, { driver? })` | `{ annotationTissueFraction, fractionOfViewTissue, ... }` for one annotation. |
| `segmentAtPoint(viewer, { prompt?, driver?, point? })` | Point mask → `{ status, annotationIds }` (`point` in image coords; `status` separates empty vs rejected masks). |
| `analyzeRegion(viewer, { prompt, driver?, source?, region?, mpp?, magnification?, targetPixels? })` | Vision → `{ findings, isComplete?, coveredFraction? }`. `mpp` is DELIVERED (the region is sampled rather than squashed); `magnification`/`targetPixels` are requests the render may clamp. Without `region`: the current view (composite incl. overlays, or raw background). With `region` (parent-global px): rendered off-screen at the requested size — the user's viewport is untouched. |
| `pickViewportPoint(viewer, { message?, timeoutMs? })` | Await a user click → `{x,y}` image coords (or null). |
| `getSelectedAnnotationId(viewer)` / `awaitAnnotationSelection(viewer, ...)` | Current / awaited annotation selection. |
| `captureViewportImage(viewer, label?)` | `{ blob, width, height }` on-screen composite PNG (used by `analyze` / SAM). |
| `maskToPolygon(mask, ref, w, h, ratio, viewer)` | Trace a mask's largest region to image-space points (shared infra). |

Feature ids: `tissue-mask`, `segment`, `analyze`, `cellularity`.

Events: `analysis-started`, `analysis-finished` (both carry `{ driver, feature }`; the `analyze`
feature also carries `region` — the analyzed bbox, or `null` for a whole-view read), `drivers-changed`,
and `overview-progress` while a walk runs.

---

## Seeing what was analyzed

Every read this module performs is **off-screen**: the user's viewport never moves, so nothing on
screen would otherwise reveal that a region was rendered and sent to a model. Each capture therefore
carries a translated `label` (`pathology.capture*` keys) down into the core
[`region-capture`](../../src/EVENTS.md) event, and `APPLICATION_CONTEXT.captureIndicator` draws it on
the viewer that was read: a bright rectangle while the pass runs, fading to a faint outline that
stays for the rest of the run, so the analyzed parts of the slide accumulate visibly.

- The markers follow the *run*, not the slide: once nothing has been captured for
  `setup.captureIndicatorIdleMs` (default 6 s), they fade out and the viewer is clean again.
- `exploreSlide`'s orientation pass reads the **whole slide**; that marker (and any capture covering
  ≥80% of it) only flashes and is never trailed — a full-frame rectangle says nothing about which
  part was analyzed and would just sit over the viewer.
- Controlled by `setup.captureIndicator` (`"off" | "flash" | "trail"`, default `"trail"`) and the
  **View** menu toggle in the app bar. It is a display preference — turning it off does not change
  what is captured or sent.
- `APPLICATION_CONTEXT.captureIndicator.getLog(viewer)` returns the history as data
  (`{ region, label, kind, ok, t, hits }`) and **outlives the markers**, for auditing or for a plugin
  that wants its own view of it. It is reset when the slide changes.
- Repeat reads of the same region (a re-ask, a deeper pass over the same box) reuse one marker and
  bump its `hits` rather than stacking rectangles.

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
