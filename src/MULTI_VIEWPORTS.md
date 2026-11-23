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
- **Alignment** — `ViewportSyncAPI` (`src/classes/osd/scalebar/viewport-sync-api.ts`, reachable as `viewer.scalebar.ViewportSyncAPI`): keeps a class-static session `{leaderId, leaderPts, transforms, flipParity, points, epoch}`. The first joined viewer's image space is the reference space; every other viewer stores a similarity transform `p_viewer = A · p_reference + b`, and the mapper converts viewport centres through it (zoom is converted through *image* pixels, so slides of different pixel size/placement stay at matching magnification).

**One viewer, one alignment, one mode.** Each transform records how it was made (`source`: `reference` | `auto` | `manual` | `adjusted`), and the session is the only place sync state lives — there are no per-instance copies to drift. Whatever replaces or removes a viewer's alignment goes through `_invalidateViewer(id)`: it unlinks the viewer, takes the applied pose back out, deletes transform + mirror parity + stored points, evicts the memoized registration and bumps `epoch[id]`. Every asynchronous path remembers the session object and its epoch and checks both before writing, so a registration or a pick that finishes after a clear is dropped instead of being stored against a reference that no longer exists.

`enable({mode})` decides where that transform comes from:

| mode | behaviour |
|---|---|
| `"auto"` (default) | `OpenSeadragon.ViewportRegistration.estimate(ref, target)` — no clicks. Falls back to the three-point picker if nothing is confident enough (`allowManual: false` disables that fallback for batch callers). |
| `"manual"` | straight to the three-point picker (`Shift`/`Alt`-click the scalebar SYNC button). |

A viewer that already holds an alignment is just linked again. `replace: true` recomputes it — that is what the menu's *Link automatically* (`autoCalibrate()`, which also forces past the memoized registration) and *Calibrate manually* do, so an explicit request in one mode never reuses a result of the other. Replacement is **transactional**: the old alignment is suspended (unlinked, so navigating to landmarks does not drag the peers) and only discarded once the new one exists. Cancel, timeout or failure puts it back exactly as it was. Re-calibrating the *reference* first hands that role to an open peer (a re-base, see *Clearing*), because the reference has nothing to be measured against.

One operation per viewer: a second `enable()` while one is in flight returns the same promise. `cancelCalibration()` aborts whichever is running — the picker, or the registration through its `AbortSignal` — and the SYNC button calls it while busy. `isBusy()` / `getProgress()` / `isAdjusting()` live on the API instance, not in the scalebar chrome: the chrome is rebuilt on every open-pipeline pass and re-reads them.

`enable()` upgrades `"auto"` to `"manual"` on its own for any viewer flagged in `ViewportSyncAPI._manualPending` — see *Clearing* below. The flag is class-static, not a session field, because clearing is the very act that destroys the session; it is transient UI intent and never enters the canonical scene. `allowManual: false` suppresses the upgrade, keeping batch callers (`autoSyncAll`, scene restore) non-interactive; a successful calibration or an explicit `autoCalibrate()` clears it.

The picker keeps mouse navigation enabled, because the three landmarks are rarely all on screen at once. It distinguishes intent by **motion, not duration**: a press that moves more than 5 px pans as usual and places nothing; a stationary click marks a point. (OSD's own `event.quick` is not used — it additionally demands the 300 ms `clickTimeThreshold`, which would reject a slow, careful click.) A **double-click places one point, not two**: the picker listens to OSD's `canvas-double-click`, which is raised right after the second `canvas-click` of the pair within the same pointer release, and takes that second point back (finishing on the third point is deferred by a microtask for exactly this reason). `Backspace` removes the last point, `Esc` cancels (neither is taken while a text field has focus).

Two point pairs would determine the similarity exactly; the third averages click error and leaves a **residual** (`_similarityFrom3` → RMS misfit relative to the spread of the points). Above `POOR_FIT_RESIDUAL` (5 %) `enable()` reports `poorFit: true` and the viewport shows a warning — the viewer is still linked, so the user can see the result and re-calibrate or pause to adjust. The instruction is a sticky toast at the top of the viewport being picked on (`Dialogs.forViewer`), with **Undo point** and **Cancel** buttons.

Markers are numbered 24 px dots — the reference viewer's in the primary colour, the aligned viewer's in the error colour — drawn as a child of a zero-size OSD overlay (OSD rewrites the overlay element's own `display`/`transform` on every draw, so nothing that centres the dot may live on it). They stay up after the third click until the result is applied, are put back if the viewer re-opens mid-pick, and each follower's three points are kept in `points[id]` to be shown again when that viewer is re-calibrated or adjusted.

### Pause to adjust

*Pause to adjust…* (`beginAdjust()`) unlinks one viewer without discarding anything, shows the points its alignment was made from, and turns the badge into `ADJ`. The user moves, zooms or rotates that viewport alone. Resuming (`commitAdjust()` — the badge, the toast's **Resume**, or the menu) re-derives the viewer's transform from where it and a linked peer are looking right now, by inverting the mapper's own three equations, so the pose it was left in *is* the synced pose; the existing matrix is turned and scaled rather than rebuilt, so a mirrored registration stays mirrored. The result is stored as `source: "adjusted"`, and the viewer's points and memoized registration are dropped since they no longer describe it. **Discard** (`cancelAdjust()`) links it again and snaps it back. A plain SYNC click is unchanged: unlink, and linking again snaps back.

### Clearing

- **Per-viewport eraser** (joined to the SYNC button in the scalebar chrome) → `resetViewer()`: drops *that* viewer's transform, unlinks it, flags it manual-pending, and evicts the matching entries from `ViewportRegistration._pairCache` (`clearCacheFor(viewer)`). Everything else stays synced. Clearing the **reference** viewer no longer destroys the session — `_reelectLeader` promotes a still-calibrated peer `Y` and re-bases every transform into `Y`'s image space (`A' = A · invA_Y`, `b' = b − A'·b_Y`, flip parity XOR-ed, leader points carried across), so the remaining viewports keep their relative alignment and the `REF` badge simply moves.
- **Tools → Clear sync session** → `resetSession()`: unlinks *every* viewer (iterating a copy — `Tools.unlink` splices the live `subscribed` array), nulls the session, calls `ViewportRegistration.clearCache()`, and flags every viewer manual-pending.

Both also **release the pose**: sync turns a follower by its registration angle (and mirrors it on odd flip parity), and `_releasePose` takes exactly that back out — after unlinking, before the transform is deleted — so the viewport returns to the reference's orientation while anything the user turned by hand survives. Unlinking alone (`disable()`) keeps the pose. For the same reason the per-slide viewport cache (`viewer-state-binding-controller.ts`) stores rotation minus `getRotationOffset()`: the session is memory-only, and a cached angle would reopen the slide tilted with no session left to explain it. The canonical scene keeps the true rotation, because it carries `sync` alongside.

Both first abort any calibration in flight — point pick or automatic registration — on every viewer — the picker and the reference markers shown for it are measured against state the clear is about to remove. Both arm a manual re-align, on the principle that a user who discards an alignment is rejecting the automatic estimate — recomputing the same answer on the next LINK would be useless. Both repaint the chrome of all viewers, not only the linked ones.

### Layout changes and late joiners

The session is keyed by `viewer.uniqueId` and outlives the viewers it was built with, so reopening a slide gets its alignment back. Two things keep it honest against the viewers that are actually open:

- **Reference reconciliation.** `enable()` first runs `_reconcileReference()`: if `leaderId` names a viewer that is no longer open, `_reelectLeader(id, {openOnly: true})` promotes an *open* calibrated viewer and re-bases every transform (the closed ones included — they stay remembered). With no open calibrated viewer the session is dropped.
- **Slide change and close.** The session is keyed by the slide, so a viewer that opens a *different* slide is a different viewer to it. One class-wide `open` / `viewer-destroy` subscription unlinks such a viewer (and aborts what was running on it) instead of leaving a `SYNC` badge on a viewport the mapper silently skips; it is linked again only if the session already holds an alignment for the new slide. The alignment of the slide that left stays remembered.
- **Manual join.** The three points a joining viewer picks only mean something against the reference's own three. If the session has them (`leaderPts`), the reference viewer shows them as numbered markers and zooms to fit while the joiner picks (`_showReferencePoints`). If it does not — it was built by automatic registration — the order flips: the joining viewer (the one the user acted on) picks first, then the reference marks the same three with the joiner's markers as the guide, and those become `leaderPts`. Only the joiner's transform changes in either case: every transform maps reference image space to one viewer, so the other viewers' alignment, automatic or manual, is untouched. Cancelling either pick changes nothing — from either viewer's button: while the reference is picking it is busy too.

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

UI entry points: per-viewer SYNC/REF button on the scalebar (right-click it, or use the caret beside it, for *link automatically* / *calibrate manually* / *pause to adjust* / *clear alignment*); two remappable shortcuts on the focused viewport — `Alt+L` link / unlink (`core.sync.toggle`) and `Alt+P` pause to adjust / resume (`core.sync.adjust`), both pinnable as quick actions and both routed through the button's own logic; session-wide *Auto-align all viewports* / *Calibrate all viewports manually* / *Clear sync session* in the app-bar **Tools** menu. The scalebar entries act on that one viewport only; the Tools entries act on all. *Calibrate all* (`manualSyncAll`) resets the session, activates the first viewport for its three reference points, then walks the others in viewport order. *Auto-align all* (`autoSyncAll`) calls `resetSession()` first: it recomputes every alignment, hand-picked ones included, instead of skipping viewers that already hold one. The session is serialized into the canonical scene (`CanonicalScene.sync`, including `leaderPts`, the followers' `points` and each transform's `source`), so exported sessions restore their alignment. Restoring replaces the live session outright — viewers following the old one are unlinked first — rather than merging into it.

---

## Checklist

- [ ] Never read slide metadata from global `VIEWER` in multi-viewport flows
- [ ] Always get the viewer from the event (`e.eventSource`) or pass it explicitly
- [ ] Load annotations on `VIEWER_MANAGER.broadcastHandler("open", ...)` per viewport
- [ ] Save annotations with `module.getFabric(viewer)` (viewer-scoped export)
- [ ] Clear per viewport before loading: `loadObjects(imported, true)`
