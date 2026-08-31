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
        * [The result is an evidence table](#the-result-is-an-evidence-table)
        * [Costing a walk first (`planOverview` / `runPlan`)](#costing-a-walk-first-planoverview--runplan)
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
  },
  // When two region boxes stop being two regions (see "The same tissue is not read twice").
  // Either test merges. Set to false to keep every traced contour box as its own region.
  "regionMerge": { "iou": 0.4, "containment": 0.9 },
  // How regions are NUMBERED: "reading" (default, slide layout) or "area" (legacy size rank).
  "regionOrder": "reading",
  // Render budgets in ms (see "Render budgets" below). Clamped to 500..300000.
  "fieldLoadTimeoutMs": 6000,
  "surveyLoadTimeoutMs": 15000,
  "renderQueueTimeoutMs": 20000
}
```

`scheduler`, `regionMerge`, `regionOrder` and the three render budgets are **deployment** knobs, read through
static meta rather than per-call options: each decides something the cached survey and the whole traversal are
shaped by — or how long the viewer waits on a backend — so a session bundle must not be able to change them
(AGENTS.md §7).

### Render budgets

Every field the module reads is an off-screen render, and off-screen renders wait on two different things.
The defaults assume a tile server on the same network; a WAN-hosted store usually wants all three raised.

| Key | Bounds | Default |
| --- | --- | --- |
| `fieldLoadTimeoutMs` | tile loading for ONE field, once its render is running | 6000 |
| `surveyLoadTimeoutMs` | tile loading for the whole-slide survey — one render whose coverage decides the entire walk, hence generous | 15000 |
| `renderQueueTimeoutMs` | the wait for a TURN at rendering: off-screen passes are serialized per viewer and admitted through the background request scheduler | 20000 |

Spending a load budget is not a failure: the render returns the tiles it got, marked `isComplete: false`, and
the field is analyzed and reported as the partial read it is. Spending the queue budget *is* a failure — the
pass never started — and is reported as such rather than as an unreadable region.

A field whose render fails is retried up to three times: twice at the planned resolution (the second attempt
runs over the tile cache the first one warmed, which is usually enough), then once one pyramid level coarser,
which reports its real `deliveredMpp` so features that need finer detail come back as
`reason: "resolution"` rather than as answers formed on pixels that could not carry them. When every attempt
fails the field is `reason: "unread"` and the result carries a `warnings` entry saying so — a rendering
failure, explicitly not a resolution limit, because the two need opposite advice.

---

## The `pathology` scripting namespace

Injected into the agent's system prompt automatically (with its inline type declarations). It steers the
agent toward concrete jobs instead of guessing. Select the viewer first (`application.setActiveViewer(...)`).
Consent is requested **only when the resolved driver is remote** (a snapshot would leave the viewer); the
built-in tissue jobs run silently.

```ts
pathology.listDrivers(): PathologyDriverInfo[];                       // { id, label, local, features[] }

// orientation — call FIRST; regions are tissue islands with navigable bounds, in slide order
// scope: "slide" (default) | "viewport" | {x,y,width,height} — restricts the whole survey
pathology.exploreSlide(options?): Promise<SlideExploration>;          // { slideCoverage, coverageScope, scopeBounds, isComplete, regions[], slide }
pathology.reviewRegions(options?): Promise<RegionReviewResult[]>;     // frame each region + run a job (analyze | tissue-mask)

// THE exploration call — describe + score + drill, over the whole slide or one region via `scope`
// "explore" / "deep scan" / "go through" / "review X and report" all mean this, not exploreSlide
pathology.buildOverview(options?): Promise<OverviewResult>;          // { root[], evidence[], budget, summary? } — needs an analyze driver
pathology.refineOverview(options?): Promise<OverviewResult>;         // CONTINUE a budgeted walk: no re-survey, nothing re-read
pathology.getOverview(): OverviewResult | null;                      // the cached tree for the current slide (cheap, local)
pathology.clearOverview(): void;                                     // drop the cache (force a rebuild)

// what an unqualified request is about — set by the last region-scoped call
pathology.getFocusRegion(): { label?, bounds } | null;               // free, local
pathology.setFocusRegion(bounds | null, label?): void;               // point it, or clear it

// tissue jobs — built-in, local, read the raw background, no server needed
pathology.annotateTissue(driver?): Promise<TissueAnnotationResult>;  // outline ALL tissue as annotation(s)
pathology.tissueCoverage(annotationId?, driver?): Promise<TissueCoverageResult>;  // { annotationTissueFraction: 0..1, fractionOfViewTissue: 0..1, ... }

// point-driven segmentation (asks the user to click) + text analysis
pathology.segmentAtPoint(prompt?, driver?): Promise<SegmentResult>;  // segment the clicked spot → annotation
// ONE vision call. `mpp` is the preferred resolution knob — it is delivered, where
// `magnification`/`targetPixels` are requests the render may clamp. A bare driver string
// is still accepted for back-compat.
pathology.analyzeRegion(prompt, options?: string | {
    region?, mpp?, magnification?, targetPixels?, source?, raw?, driver?
}): Promise<AnalysisResult>;                                         // vision → text findings (remote)

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
row. Without a query — or when derivation fails — the run falls back to a deliberately vocabulary-free generic
checklist and says so via `checklist.source: "fallback"` plus a warning; the schema downstream is identical
either way. `checklist.fallbackReason` says *which* of the four it was (`no-query`, `no-model`, `unparseable`,
`error`), because only the first is the caller's to fix and the warning used to send them to rephrase a
perfectly good question.

**A fallback checklist does not set the ladder.** Its `requiredMpp` values are placeholders, not requirements,
and reading them as requirements produced a two-rung ladder capped at 1 µm/px — coarser and shorter than the
`[1.0, 0.5, 0.25]` default used when there is no checklist at all, so a failed derivation made the run strictly
worse than asking nothing while every field truthfully reported that it could not see cell detail. Rung
selection lives in [`lib/ladder.ts`](lib/ladder.ts) and is unit-tested against those numbers.

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

**The same tissue is not read twice.** A region is the bounding box of a traced tissue contour, and tissue is
not rectangular: on a curved biopsy strip, a folded core or a ribbon of mucosa, neighbouring contours produce
boxes that are largely each other while the contours themselves do not touch. Nothing used to notice — each box
was rendered, sent to a vision model and reported as a separate finding, so the user watched a stack of
examination markers pile up over one piece of tissue while the budget paid for the same cells several times.
Two guards, both pure and unit-tested:

- **Boxes that *are* the same box are merged** before anything is planned, by IoU or by containment
  (`mergeOverlappingBounds`, [`lib/geometry.ts`](lib/geometry.ts)), at both places regions are constructed —
  the survey's contour list and `_subdivideRegion`'s islands. Merging is on the *boxes* because the box is what
  gets rendered: two contours sharing a rectangle cannot be read separately, so keeping them apart is a
  distinction the pipeline cannot honour. Numbering is applied once to whatever survives, since `label` is the
  only identity a region has for the user and for a region link and a merge changes what the regions are.
  Retune or disable per deployment with `regionMerge`.
- **A box already read as closely is not read again** (`isRedundantRead`, [`lib/scheduler.ts`](lib/scheduler.ts)):
  a planned child covered ≥ 70 % by fields read at its rung *or finer* is dropped and counted in
  `budget.skippedRedundant`. Only same-or-finer reads count — a parent contains its children completely, so
  counting coarser reads would suppress every drill the walk exists to make. Coverage is measured over the
  *union* of those reads, by rasterizing the candidate into a coarse lattice; summing pairwise intersections
  would double-count exactly the overlaps that prompted the question. `skippedRedundant` is budget saved, not
  coverage lost, and is deliberately **not** a warning.

**Where it looks is a decision, not a constant.** `scope` restricts the whole run — survey, islands and every
drill — to `"slide"` (default), `"viewport"`, or an explicit parent-global rectangle. That is not a cheaper
whole-slide walk but a *closer* one: the survey raster budget spread over a viewport instead of a 100 000 px
slide is a mask one to two orders of magnitude finer per unit tissue, and the coarse rung follows it (see
`surveyMpp` below). The result then says what it covered — `coverageScope`, `scopeBounds`, and a warning — so a
scoped run can never be read as a slide-wide negative. Scoped surveys are cached alongside the whole-slide one,
keyed by (`tileSourceId`, rectangle, budget) and bounded LRU per slide; every free measurement afterwards
(tissue fill, density, subdivision masks) automatically picks *the finest cached survey that covers the box*.

**Resolution is delivered, not requested.** A field is a window of fixed physical size at an exact µm/px
([`lib/fields.ts`](lib/fields.ts)); a region too large for one call at that resolution is *tiled*, never
squashed into a pixel budget. `planFields` is the only place that decides tiling and is pure, so "a 60 000 px
region at 1.0 µm/px never comes back at 4.3 µm/px" is a unit test rather than a hope. The prompt quotes
`deliveredMpp` and only `deliveredMpp`. Where the walk must still trade resolution for coverage — a node's own
look at its whole box — it does so explicitly, states the shortfall, and **that shortfall is what sends the
node back to be read at its rung**: `_tileChildren` lays the lattice over the same box, the cached survey mask
drops the glass cells with no render at all, and the survivors are read as fields that each carry the
resolution the checklist asked for. Coverage first, then resolution, on the same tissue.

**A drill gate answers one question: tissue or glass.** Whether a box is worth another call is decided on the
absolute tissue it holds (`OverviewNode.tissueArea`, µm²) against a *readable fraction* of one vision call at
the finest rung — `fieldPixels × finestMpp² × TILE_MIN_FILL`, derived from the run's own numbers, never a
constant. The factor is load-bearing, and this gate has now been wrong twice by taking on a second job:

- as a bbox FILL floor at 0.1 — a statement about tissue SHAPE. A prostate core measures 0.066-0.107, so it
  closed on every slide whose tissue is not rectangular;
- then as a whole-field AREA floor (the same expression without `TILE_MIN_FILL`) — a statement about tissue
  SIZE, and an unreachable one: one field's area of *solid* tissue is impossible for any box smaller than a
  field or with fill below 1. At 2 MP and 1 µm/px it demanded 2 mm², so a 3.4 × 1.5 mm core holding 1.4 mm²
  was refused.

Both produced the identical failure — one call spent in twenty-eight, `truncated: false`, every feature
"not-assessable" — because a walk that expands nothing is indistinguishable from a walk that found nothing.
Anything else a box's size or shape should influence belongs in RANKING (`fillWeight`, `areaWeight`), where a
sparse box loses to a dense one instead of being removed from consideration, and how much of a box is worth
RENDERING belongs to the tiler, which drops glass cells against the survey mask before anything is fetched.
There is deliberately no `minDrillFill` knob any more, not even defaulted to off: while it existed a caller
could re-arm the exact veto that made a prostate core unreadable.

**One rung costs one depth level, so `maxDepth` follows the ladder.** A node reads its box at the resolution
that box affords and `_tileChildren` reads the same box *at the next rung* as its children — which means a run
walked less deep than its ladder is long stops above the resolution it declared, and every field then answers
"too coarse to tell". `maxDepth` therefore defaults to the number of rungs (minimum 2) rather than to a
constant. `resolutionShortfall` is the matching correction: it compares delivered against target µm/px, not
"did the lattice have more than one cell" — a box that fits a single raster *finer* than its rung was being
flagged as short of it, which both warned about unresolved leaves and routed its children to a lattice re-read
of tissue that wanted separating instead.

**The model's own "I cannot see this" is a drill signal in its own right.** A checklist gap closes once a field
is at or below a feature's `requiredMpp`, so a field read at the stated requirement has no gaps *even when the
model answered `not-assessable` to every feature*. That is exactly what a generic checklist produces, and the
branch died at architecture resolution while the run reported itself complete. `shouldExpand` now also expands
on `verdict.resolvable === false`, terminated by the ladder — keep going while a finer rung exists — so it
cannot loop on a model that says "too coarse" at every resolution, and it stays closed on an uncalibrated slide
where there is no resolution to compare (the gap rule already drills there).

**A scope is not automatically one object.** Cores inside a scope are separated by a few mask pixels of glass,
outer contours are traced 8-connected, and one diagonal touch merges them into a single contour whose bounding
box is the whole scope — so `exploreSlide` reported one region and everything downstream reasoned about "a
single core" on a four-core biopsy. A scoped survey that outlines its own rectangle while the rectangle is
mostly glass (`shouldResegmentScope` in [`lib/scope.ts`](lib/scope.ts)) is re-split against the mask already in
hand, at no extra render. Two contributing defects went with it: `_traceOuterContours` was passing *exclusive*
bounds to magic-wand's *inclusive* API, so `prepareMask` read the next row's first pixel into the border column
the tracer requires to be empty and bridged unrelated components down the right edge; and `_subdivideRegion`
vetoed an island split on the largest island's share when the question is about the second — a big core beside
a small one is two cores.

**A run that stops is not a run that finished — but a run that finishes early usually has.** `maxAnalyzeCalls`
and `maxNodes` are ceilings, not targets: every gate in `_expandFrontier` drops its node *without re-queueing*,
so the frontier strictly drains and most walks end with budget in hand because there was nothing left worth
reading. `budget.converged` says exactly that, and it is the good outcome — nothing to apologize for, nothing
to continue. Without it a walk that spent 12 of 28 calls was reported as partial, which is how "it always uses
all 36 regions" and "it stopped too early" ended up being the same complaint.

The failure it has to be told apart from: `budget.focusUnspent` above 0 with `converged: false`, alongside any
`underResolved` evidence row, means the walk ran out of things it was *willing* to look at — the opposite of
`truncated` and indistinguishable from success in a result object until you look for it. It carries its own
warning, as does `budget.plannedNotRead` (fields planned and never read, so coverage a reader would otherwise
assume).

**And the top of the result has to say so too.** Warnings are read after a reader has already formed a view
from `status` and `isComplete`, so those two fields must not be the optimistic half of a contradiction:

- `status` is `"incomplete"` when NOTHING was settled — the coarser question, and the first key in the
  object: *report the limitation, do not write findings*. A run that answered some questions and not others
  stays `"ok"`, because suppressing the answers it did reach would be its own kind of dishonesty.
- `isComplete` answers "was the tissue examined?" — false while any evidence row is `underResolved`. It used
  to answer "did the survey raster finish loading?", a different question with a different answer; that
  reading is now `surveyComplete`.
- `summary` leads with the same statement when nothing was read closely, because a table of "not assessable"
  rows summarizes into what looks like a set of negative findings.

**A survey that ran on a half-loaded slide is not a reading of the slide.** The off-screen render now waits
for the tiles it schedules and reports whether it got them; before it did, a cold whole-slide survey came
back showing only the area the user was last viewing — 0.1 % coverage and one island on a slide holding four
cores, cached for the session because the raster claimed to be complete. The survey gets a deliberately
generous budget (`SURVEY_LOAD_TIMEOUT_MS`, against `FIELD_LOAD_TIMEOUT_MS` for the many smaller field renders),
an incomplete raster is still never cached, and `buildOverview` **refuses to walk** a survey that is
incomplete or implausible (near-zero coverage with at most one island on a whole-slide scope) rather than
spending a vision budget describing an artefact.

The renderer's own "fully loaded" flag is not sufficient on its own: a permanently missing tile is dropped
from OSD's load candidates, so the wait ends *satisfied* over a hole. `RasterRead.isComplete` is therefore
`fullyLoaded && !stalled`, folded in at the one place a raster is produced — so every consumer degrades
closed without each of them remembering to, and `stalled` stays available for the only decision it actually
informs (`!isComplete && !stalled` means a longer budget may help; `stalled` means it will not).

**A budget is a checkpoint, not a verdict.** A walk that stops has described real tissue and left a plan for
the rest, so `refineOverview({ addCalls, region?, maxDepth?, query? })` **continues** it: Phase A is skipped,
the frontier is rebuilt from the cached tree (`pendingTiles` first — those fields are already planned), and a
fresh budget is spent entirely on depth. It returns the *same* tree, extended and re-ranked, with cumulative
figures and `budget.refinements`. Rebuilding instead re-surveys the slide and pays a second time for every
region already described. `region` concentrates the continuation, `maxDepth` allows another rung, and `query`
re-derives the checklist — which re-scores the whole frontier, because the checklist is what `shouldExpand`
and `priority` read. Both the first walk and every refinement go through one `_expandFrontier`, so the two
cannot diverge.

**The focus region: what an unqualified request is about.** A conversation settles on a region and then stops
naming it — "review core 3", "and the findings?", "do a deep scan". The last of those carries its target in
the conversation, not the sentence. So any region-scoped call (`analyzeRegion({region})`, `interrogateRegion`,
a scoped `exploreSlide`/`buildOverview`) records its region per slide, and a later call that names no `scope`
inherits it. Set in the **engine**, so a plugin calling directly behaves the same way. It is not a hidden
narrowing: such a run reports `coverageScope: "region"`, `scopeBounds` and the scoped-coverage warning, the
same three signals an explicit scope produces. `scope: "slide"` is the opt-out and the only thing that clears
it, alongside `clearOverview` and opening a different slide. Read it with `getFocusRegion()`.

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

**It is the basis for an answer, not the answer.** The table is a data structure for a caller to write prose
from, and printing it verbatim is a reporting bug rather than thoroughness: `counts` is internal bookkeeping
("28 yes / 0 no" is not something a reader can act on), and a **fallback** checklist's rows are the three
generic run-quality gates — does this match the question, how much of the field is involved, is the image good
enough — which say whether the run could see anything at all, not what the tissue shows. Laid out as a results
table they read as a clinical report about nothing. The consuming contract lives in the `.d.ts` the assistant
reads ([`scripting/api.ts`](scripting/api.ts)) and in the chat SDK's pathology guidance
(`modules/vercel-ai-chat-sdk/server/chat.server.ts`): answer in prose, cite regions rather than tallies,
table only a derived checklist and only when a structured report was asked for, and fold `warnings` into one
closing `Limitations:` line — except the run-invalidating ones (partial render, nothing examined, scoped
coverage, a stalled walk), which lead.

The tree is **cached per slide** (keyed by `tileSourceId`, in memory for the session), alongside the tissue
survey and its density map. The chat SDK surfaces a compact `pathologyOverview` marker in its live viewer-state
block whenever a cache exists — including `checklistSource` and `featuresUnderResolved`, so the agent can tell
whether the cached run answers the question now being asked or whether a new one is worth paying for. Counts
only: the feature labels are clinical payload and stay out of the every-turn context.

```xopat-script
await application.setActiveViewer(contextId);
let ov = await pathology.getOverview();
if (!ov) {
  // One consent for the whole run. The query is load-bearing: it becomes the checklist.
  // `scope` omitted follows the focus region when one is set — pass "slide" to demand the slide.
  ov = await pathology.buildOverview({ query: "is there carcinoma, and is it invasive?" });
} else if (ov.budget.truncated || ov.budget.plannedNotRead) {
  // It stopped, it did not fail. Continue it rather than paying for the same regions again.
  ov = await pathology.refineOverview({ addCalls: 20 });
}
// Answer from the evidence table, and cite the regions each row rests on.
return ov.evidence.map(row => ({
  feature: row.label,
  verdict: row.verdict,               // "not-assessable" is NOT "no"
  underResolved: row.underResolved,   // never report these as negative findings
  regions: row.citedBy.map(c => ({ label: c.label, bounds: c.bounds })),
}));
```

#### Costing a walk first (`planOverview` / `runPlan`)

The expensive half of an overview is the vision walk — minutes of slow model calls. The half before it (one
survey render, the tissue mask, the density prior, the checklist, the ladder) is cheap and already cached per
(slide, scope, budget). `planOverview` runs only that half and stops:

```xopat-script
const plan = await pathology.planOverview({ query: "is there invasive carcinoma?" });
// plan.regions   — what will be read, in slide order, each with `fill` and `cellularity`
// plan.checklist — the questions it will ask ("fallback" here is worth fixing before running)
// plan.overlapPairs, plan.regionsOmitted, plan.surveyComplete — the things worth a decision
return await pathology.runPlan(plan.planId, { drop: ["region 3"] });
```

`runPlan` executes *that* plan — the plan's own survey, not a fresh one, because re-surveying would pay for the
render again and could return a different region list, so the boxes the caller approved would not be the boxes
examined. Regions are addressed by `label`, never by position. Plans are bounded per slide like the surveys;
an evicted or stale one answers `{status: "plan-expired"}` and costs nothing, rather than silently re-planning
and charging for a survey the caller believes they already paid for.

The split exists so an assistant can *see* what a scan covers before committing a pathologist to minutes of it
— not so every scan becomes a confirmation dialogue. The guidance shipped to the model says to plan, and then
run immediately unless there is a real decision in the result.

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
(`"region 2"`, `"region 2.1"`). `index` and `depth` are 0-based internals and must never reach the user or an
assistant's answer; `label` is what the progress dialog, the evidence table, the warnings and the chat all speak
in. Drill depth is likewise rendered as a level counted from 1.

**A region number says where it is, not how big it is.** The numbers follow the slide: rows top to bottom, left
to right within a row (`readingOrder`, [`lib/geometry.ts`](lib/geometry.ts)) — so `region 3` is the third
fragment on the glass. They used to be the tissue-**size** rank, because the survey sorted contours largest-first
and numbered them by array position. No reviewer counts fragments that way, so the numbers in a report agreed
with nothing on the slide: "region 1" was routinely the third core along, and following a reply's links meant
jumping back and forth across the slide instead of walking down it. Ordering is a naming concern and only that —
the arrays stay in priority order, so what gets rendered, read and expanded is still decided by area, fill and
cellularity (`_byTissueFirst` is where a caller says it means size). Set `regionOrder: "area"` to get the old
numbering back.

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
| `exploreSlide(viewer, { scope?, surveyMpp?, surveyPixels?, driver?, annotate?, hint?, minAreaFraction? })` | Orientation ONLY, rendered OFF-SCREEN (never moves the user's viewport) → `{ slideCoverage, coverageScope, scopeBounds, isComplete, regions[], slide }`. It finds *where* the tissue is and does not examine it — "explore this" means `buildOverview`. `scope` is `"slide"` (default), `"viewport"`, or a parent-global rectangle, and restricts the survey to it; `isComplete: false` marks a provisional (partially-loaded) survey. |
| `refineOverview(viewer, { addCalls?, region?, maxDepth?, query?, features?, checklist?, progress?, signal?, driver? })` | Continue the cached walk with a fresh budget spent entirely on depth → the same `OverviewResult`, extended and re-ranked, with cumulative `budget` and `budget.refinements`. Throws when nothing has been built on this slide. |
| `getFocusRegion(viewer)` / `setFocusRegion(viewer, bounds \| null, label?)` | The region an unqualified `scope` will follow. Set automatically by every region-scoped call; cleared by `scope: "slide"` and `clearOverview`. |
| `reviewRegions(viewer, { regions?, max?, magnification?, feature?, prompt?, driver? })` | Render each tissue region off-screen and run a per-region job → `RegionReviewResult[]`. |
| `buildOverview(viewer, { query?, scope?, surveyMpp?, surveyPixels?, maxRoots?, framePadding?, fieldPixels?, features?, checklist?, maxDepth?, breadth?, scheduler?, surveyFraction?, concurrency?, interestThreshold?, minDrillTissue?, maxAnalyzeCalls?, maxNodes?, annotate?, synthesize?, reuse?, driver? })` | Expert overview over `scope` (whole slide by default): survey every tissue island out of a reserved budget, then expand the globally best regions → `OverviewResult` with an **evidence table**; cached per slide (by `tileSourceId`). Needs an `analyze` driver. |
| `interrogateRegion(viewer, { region, features? \| questions?, mpp?, maxFields?, driver? })` | Ask specific questions about ONE region at a resolution that can answer them; tiles the region itself → `InterrogationResult` with typed answers and `coveredFraction`. |
| `montageRegions(viewer, { regions, prompt? \| features?, cols?, cellPixels?, mpp?, driver? })` | Composite several regions into one labelled image and answer about all of them in a **single** vision call → `MontageResult`. |
| `buildDensityMap(viewer, { cell?, refresh?, driver? })` | FREE local nuclear-density grid over the slide (no model call) → `DensityMap` with `sample(bounds)` and `top(n)`. Over the scripting bridge those methods do not exist: a script result is structure-cloned, so `pathology.buildDensityMap()` returns plain data with `topSpots` precomputed. |
| `getOverview(viewer)` / `clearOverview(viewer)` | Read / drop the cached overview for the slide open in `viewer`. `clearOverview` also drops the remembered slide context. |
| `getSlideContext(viewer)` / `setSlideContext(viewer, ctx)` | Read / remember what the slide is (stain, class, site), keyed by `tileSourceId`. Every analyze call is grounded in it; asked once per slide, never persisted. |
| `computeTissueMask(viewer, { driver? })` | `{ coverage, tissuePixels, totalPixels, ... }` (no annotation). |
| `annotateTissue(viewer, { driver? })` | Detect tissue → polygon annotation(s) → `{ annotationIds, viewCoverage }`. |
| `tissueCoverage(viewer, annotationId, { driver? })` | `{ annotationTissueFraction, fractionOfViewTissue, ... }` for one annotation. |
| `segmentAtPoint(viewer, { prompt?, driver?, point? })` | Point mask → `{ status, annotationIds }` (`point` in image coords; `status` separates empty vs rejected masks). |
| `analyzeRegion(viewer, { prompt, driver?, source?, region?, mpp?, magnification?, targetPixels? })` | Vision → `{ findings, isComplete?, coveredFraction? }`. `mpp` is DELIVERED (the region is sampled rather than squashed); `magnification`/`targetPixels` are requests the render may clamp. Without `region`: the current view (composite incl. overlays, or raw background). With `region` (parent-global px): rendered off-screen at the requested size — the user's viewport is untouched. |
| `pickViewportPoint(viewer, { message?, timeoutMs? })` | Await a user click → `{x,y}` image coords (or null). |
| `getSelectedAnnotationId(viewer)` / `awaitAnnotationSelection(viewer, ...)` | Current / awaited annotation selection. |
| `captureViewportImage(viewer, label?)` | `{ blob, width, height, isComplete }` on-screen composite PNG (used by `analyze` / SAM). Settles the view, then waits (bounded) for the pyramid; `isComplete: false` means the blob holds partially streamed tiles. |
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
- `exploreSlide`'s orientation pass reads the whole slide by default; that marker (and any capture
  covering ≥80% of it) only flashes and is never trailed — a full-frame rectangle says nothing about
  which part was analyzed and would just sit over the viewer. A `scope`d survey reads a smaller
  rectangle and is trailed like any other region read.
- Controlled by `setup.captureIndicator` (`"off" | "flash" | "trail"`, default `"trail"`) and the
  **View** menu toggle in the app bar. It is a display preference — turning it off does not change
  what is captured or sent.
- `APPLICATION_CONTEXT.captureIndicator.getLog(viewer)` returns the history as data
  (`{ region, label, kind, ok, t, hits }`) and **outlives the markers**, for auditing or for a plugin
  that wants its own view of it. It is reset when the slide changes.
- Repeat reads of the same region (a re-ask, a deeper pass over the same box) reuse one marker and
  bump its `hits` rather than stacking rectangles.

### Keeping it after the session

The indicator and its log live in the browser and die with the tab. For a record that survives — a
pilot run, an audit — a **remote** analyze call also logs the image it sent, server-side, on
`module.vercel-ai-chat-sdk:vision`: one record naming the slide (`tileSourceId`), the box, the
delivered µm/px, the prompt and the findings, plus the reviewed PNG as a file beside the transcript.

That works because every remote analyze driver funnels through one function (`runVisionInference`),
which is where the pixels are. `AnalyzeInput.context` is what makes the record meaningful — the
broker fills in which slide and box the image is, and the driver passes it through to be **logged
only**. A driver must never put it in the prompt: an operator's logging configuration must not
change what the model is asked.

**Local** drivers (the built-in tissue mask, the in-browser segmenter) send nothing anywhere, so
there is no image to keep. They appear in the client's `session` channel as `analysis started` with
their region — the honest record that the analysis happened and never left the browser.

Configuration, and the volume it implies (a 28-call overview is 28 PNGs):
[`server/LOGGING.md`](../../server/LOGGING.md) → *reconstruct a pilot session*.

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
