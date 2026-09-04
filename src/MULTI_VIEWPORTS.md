# Multi-viewport integration guide (Annotations use-case)

This app can run **multiple inner OpenSeadragon viewers (viewports)** at the same time. A correct integration must **never assume `window.VIEWER` is “the viewer”**. Instead, always scope your logic to a specific viewer instance.

This README shows the recommended interfaces + event patterns using the **annotations plugin** as the example, with a **generic annotations API** (no DICOM).

---

## Viewer identity vs slot identity

`viewer.uniqueId` is **data-derived** (from `BackgroundConfig.id`, ultimately the `dataReference`). When two viewports are opened against the same slide — for example via `params.activeBackgroundIndex: [0, 1]` with `background[0]` and `background[1]` both pointing at `dataReference: 0` — they intentionally share the same `uniqueId`. This is the contract: data caches, IO sinks, and history entries keyed by `uniqueId` then naturally treat the two viewports as one piece of data.

Because of that, **do not use `uniqueId` to ask "which viewer slot am I"**. Multiple viewers can match, and `VIEWER_MANAGER.getViewerIndex(uniqueId)` / `getViewer(uniqueId)` will return the first one only.

For per-viewer-instance routing — replay markers, per-viewer cursors, anything that has to distinguish "left viewer of the same slide" from "right viewer of the same slide" — use:

```js
const slot = VIEWER_MANAGER.getViewerSlotIndex(viewer);  // viewers.indexOf(viewer)
```

For per-viewer state, prefer `viewerSingletonModule(class, viewer)`; it keys on the viewer reference and is collision-free by construction.

## Viz selection lives on the background entry

Each background entry carries its own `visualizationIndex` (`config.background[i].visualizationIndex`). Slot k's currently rendered visualization is

```
config.visualizations[ config.background[ activeBackgroundIndex[k] ].visualizationIndex ]
```

There is **no separate per-slot `activeVisualizationIndex`** array — it was removed; the binding rides with the bg entry, so slot reordering / insertion / deletion preserves it. To read viz for a viewer, use `ViewerSelectionState.getViewerVisualizationIndex(viewer, appContext)`. To change viz from UI, call `APPLICATION_CONTEXT.updateViewerSelection(slot, { visualizationIndex })` — it mutates the slot's bg entry and reopens.

Legacy params/sessions/snapshots that still carry top-level `activeVisualizationIndex` or `background[i].goalIndex` are folded into `visualizationIndex` at config-parse time (with a one-time console warning).

---

## Core primitives you should use

### 1) Global and Viewer-aware singleton access

The reference to the annotations module is not something that has to do with multi-viewports. But we will need it - 
we can either use the global helper, or better, a callback that gets fired when the module is active:

```js

this.integrateWithSingletonModule('annotations', async (module) => {
    //...
});

// OR
const mod = singletonModule("annotations"); // only works if module is available - make a requirement dependency in include.json if you must
```

- `singletonModule(id)` -> global singleton instance



```js

this.integrateWithViewerSingletonModule('OSDAnnotationsFabricWrapper', viewerRef, async (module) => {
    //...
});

// OR
const mod = viewerSingletonModule('OSDAnnotationsFabricWrapper', viewerRef); // only works if module is available - make a requirement dependency in include.json if you must
```
- `viewerSingletonModule(className, viewer)` -> viewer-context instance (for viewer-singletons, we need the global annotation reference)

---

### 2) Broadcasted viewer events

Use `VIEWER_MANAGER.broadcastHandler(...)` for events that happen per viewer (OSD events like `open`):

```js
VIEWER_MANAGER.broadcastHandler("open", (e) => {
  const viewer = e.eventSource; // <-- the viewer that triggered the event
  // do viewer-scoped work here
});
```

Also useful:
- `VIEWER_MANAGER.addHandler("viewer-reset", ...)` for lifecycle cleanup (ViewerManager event)

---

### 3) Viewer-bound APIs in the annotations module

The annotations module for example exposes a deterministic viewer binding. Moreover, it has it's own 'active viewer'
logic, which is necessary if, for example, user annotates and drags mouse on a different viewport, while we need
the drag to stay on the origin.

```js
const annotations = singletonModule("annotations"); // global module singleton
const fabric = annotations.getFabric(viewer);       // viewer-bound fabric wrapper (deterministic)
```

Avoid relying on `annotations.viewer` (which tracks an “active viewer”) for correctness. Prefer passing the viewer explicitly.
Better yet, keep internal viewer reference that resolves to the correct viewer instance (e.g. you can lock viewer ref update,
when users annotate, to avoid problems), and offer a getter:

```js
const fabric = annotations.fabric;
```
That always resolves to the correct viewer singleton that implements the annotations logics for the desired viewer.

---

## The multi-viewport pitfall

If you write:

```js
const tiledImage = VIEWER.scalebar.getReferencedTiledImage();
```

…you’re reading metadata from the **currently active** global viewer, which can differ from:
- the viewport where the user clicked “Save”, or
- the viewport that just opened a slide

Multi-viewport integrations must always use:
- the **viewer instance from the event** (`e.eventSource`), OR
- an explicit viewer parameter you already have

---

## Recommended integration pattern (Annotations + Generic API)

> **Persistence belongs to the IO pipeline — not to hand-written event wiring.**
> Annotation state is exactly what the pipeline is for: declare `io.capabilities`
> in `include.json` and either `await this.initIO({exportBundle, importBundle,
> bundleScope: "per-viewer-background"})` for whole-bundle state, or
> `this.defineResource({...})` for per-item `create`/`update`/`delete`. The
> pipeline already keys state by `(viewerId, backgroundId)`, flushes on
> slide-out, restores on slide-in, runs the capability guards, and routes to
> whichever sink the deployment binds — so you get the multi-viewport scoping
> below **for free**. See [`IO_PIPELINE.md`](IO_PIPELINE.md).
>
> The event-driven pattern in this section is the **advanced / fallback** route.
> Reach for it when you bridge an existing backend that has no sink yet, or when
> you must react to a user-triggered action such as `save-annotations`. It is
> shown here because it is the case where picking the *wrong viewer* is easiest
> — the viewer-scoping rules are the point of the example, not the transport.

### Generic API (example)

Assume a minimal REST API:

- `GET  /api/annotations?slideId=...` -> `{ objects: [...] }`
- `POST /api/annotations?slideId=...` with body `{ objects: [...] }`

Where `slideId` comes from the viewer’s opened content metadata.

All upstream calls go through `HttpClient` — never native `fetch` (it bypasses
JWT/CSRF injection, proxy aliases and secureMode policy). One client per
integration, created once at module scope:

```js
const api = new HttpClient({ baseURL: "/api" });
```

---

## A) Load annotations when *that viewport* opens content

```js
VIEWER_MANAGER.broadcastHandler("open", async (e) => {
  const viewer = e.eventSource;

  const annotations = singletonModule("annotations");
  const fabric = annotations.getFabric(viewer);

  // 1) Read slide metadata from THIS viewer
  const tiledImage = viewer?.scalebar?.getReferencedTiledImage?.();
  if (!tiledImage?.source?.getMetadata) return;

  const meta = tiledImage.source.getMetadata().imageInfo;
  const slideId = meta?.slideId || meta?.seriesUID || meta?.id; // pick your app’s identifier
  if (!slideId) return;

  // 2) Clear this viewport’s canvas before loading
  await fabric.loadObjects({ objects: [] }, true);

  // 3) Fetch and load objects into THIS viewport only
  let imported;                              // { objects: [...] }
  try {
    imported = await api.request("annotations", { query: { slideId } });
  } catch (e) {
    return;                                  // HttpClient throws HTTPError on failure
  }

  if (imported?.objects?.length) {
    await fabric.loadObjects(imported, true); // clear=true is safe on slide switch
  }
});
```

**Why this works**
- Runs once per viewport open
- Uses `e.eventSource` so the correct viewer is always targeted
- Uses a viewer-bound fabric wrapper so objects cannot leak across viewports

---

## B) Save annotations for the viewport that triggered the action

### Best practice: pass the viewer explicitly in the save event payload

This part is simplified. Per-element persistence is **not** something you should
hand-wire to `annotation-created` & co.: declare `crud:annotation` in
`io.capabilities` and dispatch through `this.defineResource({...})`, which gives
you guards, the offline outbox, undo/redo and viewer scoping (see
[`IO_PIPELINE.md`](IO_PIPELINE.md)). Bind to raw annotation events only when the
pipeline genuinely cannot express your backend.

The `save-annotations` handler below is a different thing — a **user-triggered
action**, not the storage path. If nothing handles it while the annotations
**plugin** is active, the annotations are downloaded as a file, so even with
per-element saving in place you likely want to handle it to save on user demand
instead.

```js
annotations.raiseEvent("save-annotations", { viewer });
```

Handle it:

```js
module.addHandler("save-annotations", async (e) => {
  const viewer = e.viewer;                 // REQUIRED: viewport to save
  const fabric = module.getFabric(viewer); // viewer-bound wrapper

  const tiledImage = viewer?.scalebar?.getReferencedTiledImage?.();
  if (!tiledImage?.source?.getMetadata) throw new Error("No slide open in this viewport");

  const meta = tiledImage.source.getMetadata().imageInfo;
  const slideId = meta?.slideId || meta?.seriesUID || meta?.id;
  if (!slideId) throw new Error("Missing slideId in metadata");

  // Export objects from this viewport only
  const exported = await fabric.exportObjects(); // { objects: [...] } (example API)
  if (!exported?.objects?.length) return;

  // Throws HTTPError on failure — let it propagate, the caller reports it.
  await api.request("annotations", {
    method: "POST",
    query: { slideId },
    body: exported,
  });
  e.setHandled?.("Annotations saved.");
});
```

### Fallback (less reliable): use a tracked “active viewer”

If you cannot pass `viewer` through the event payload, you may fallback to:

```js
const viewer = module.viewer; // fallback only
const fabric = module.getFabric(viewer);
```

This can be wrong if focus/hover changes “active viewer” between click and handler execution.

---

## Minimal interface contract for multi-viewport-safe modules

A module that supports multi-viewports effectively should provide:

1) Deterministic viewer binding
```js
module.getFabric(viewer)
```

2) Viewer-aware events
```js
module.addHandler("save-annotations", (e) => {
  // expects e.viewer (preferred) OR otherwise uses explicit viewer binding
});
```

3) Hooks bound to viewer lifecycle
```js
VIEWER_MANAGER.broadcastHandler("open", (e) => loadFor(e.eventSource));
VIEWER_MANAGER.addHandler("viewer-reset", (e) => cleanupFor(e.viewer));
```

---

## Viewport sync & automatic registration

Cross-viewport navigation sync is a two-layer stack:

- **Transport** — `OpenSeadragon.Tools.link(context, mapper)` (`src/classes/osd/tools.ts`): the first viewer to move becomes the leader for that frame and pushes its `{zoom, center, rotation, flip}` through every other subscriber's mapper.
- **Alignment** — `ViewportSyncAPI` (`src/classes/osd/scalebar/viewport-sync-api.ts`, reachable as `viewer.scalebar.ViewportSyncAPI`): keeps a class-static session `{leaderId, transforms, flipParity}`. The first joined viewer's image space is the reference space; every other viewer stores a similarity transform `p_viewer = A · p_reference + b`, and the mapper converts viewport centres through it (zoom is converted through *image* pixels, so slides of different pixel size/placement stay at matching magnification).

`enable({mode})` decides where that transform comes from:

| mode | behaviour |
|---|---|
| `"auto"` (default) | `OpenSeadragon.ViewportRegistration.estimate(ref, target)` — no clicks. Falls back to the three-point picker if nothing is confident enough (`allowManual: false` disables that fallback for batch callers). |
| `"manual"` | straight to the three-point picker (`Shift`/`Alt`-click the scalebar SYNC button). |

`enable()` upgrades `"auto"` to `"manual"` on its own for any viewer flagged in `ViewportSyncAPI._manualPending` — see *Clearing* below. The flag is class-static, not a session field, because clearing is the very act that destroys the session; it is transient UI intent and never enters the canonical scene. `allowManual: false` suppresses the upgrade, keeping batch callers (`autoSyncAll`, scene restore) non-interactive; a successful calibration or an explicit `autoCalibrate()` clears it.

The picker keeps mouse navigation enabled, because the three landmarks are rarely all on screen at once. It distinguishes intent by **motion, not duration**: a press that moves more than 5 px pans as usual and places nothing; a stationary click marks a point. (OSD's own `event.quick` is not used — it additionally demands the 300 ms `clickTimeThreshold`, which would reject a slow, careful click.) `Backspace` removes the last point, `Esc` cancels.

### Clearing

- **Per-viewport eraser** (joined to the SYNC button in the scalebar chrome) → `resetViewer()`: drops *that* viewer's transform, unlinks it, flags it manual-pending, and evicts the matching entries from `ViewportRegistration._pairCache` (`clearCacheFor(viewer)`). Everything else stays synced. Clearing the **reference** viewer no longer destroys the session — `_reelectLeader` promotes a still-calibrated peer `Y` and re-bases every transform into `Y`'s image space (`A' = A · invA_Y`, `b' = b − A'·b_Y`, flip parity XOR-ed, leader points carried across), so the remaining viewports keep their relative alignment and the `REF` badge simply moves.
- **Tools → Clear sync session** → `resetSession()`: unlinks *every* viewer (iterating a copy — `Tools.unlink` splices the live `subscribed` array), nulls the session, calls `ViewportRegistration.clearCache()`, and flags every viewer manual-pending.

Both arm a manual re-align, on the principle that a user who discards an alignment is rejecting the automatic estimate — recomputing the same answer on the next LINK would be useless. Both repaint the chrome of all viewers, not only the linked ones.

### Registration providers

`src/classes/osd/viewport-registration.ts` runs a priority chain and returns the first result at or above `MIN_CONFIDENCE`; a weaker result is passed to the next provider as `ctx.seed` and, if nothing better appears, returned flagged `approximate` (the UI warns instead of pretending it is aligned).

Built-ins: `metadata` (100) — identical `tileSourceId`, virtual regions of one parent (exact, via `virtual-region-protocol`), or a µm/px seed; `thumbnail` (50) — tissue-silhouette similarity search over ≤384 px thumbnails, refined in `src/workers/registration-worker.js` (off the main thread; similarity only — rotation, uniform scale, translation, optional mirror).

Add your own (server-side registration, feature matching, …):

```js
OpenSeadragon.ViewportRegistration.registerProvider("my-registrar", {
    priority: 200,
    async estimate({ refViewer, targetViewer, refSource, targetSource, seed, signal }) {
        // null = not applicable
        return { A: [a, b, c, d], b: { x, y }, flip: false, confidence: 0.9 };
    },
});
```

UI entry points: per-viewer SYNC/REF button on the scalebar; session-wide *Auto-align all viewports* / *Calibrate sync manually* / *Clear sync session* in the app-bar **Tools** menu. The session is serialized into the canonical scene (`CanonicalScene.sync`), so exported sessions restore their alignment.

---

## Checklist

- [ ] Never read slide metadata from global `VIEWER` in multi-viewport flows
- [ ] Always get the viewer from the event (`e.eventSource`) or pass it explicitly
- [ ] Load annotations on `VIEWER_MANAGER.broadcastHandler("open", ...)` per viewport
- [ ] Save annotations with `module.getFabric(viewer)` (viewer-scoped export)
- [ ] Clear per viewport before loading: `loadObjects(imported, true)`
