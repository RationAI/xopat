# Virtual-region slide split

A single slide (one `background`) often carries **multiple distinct tissue areas** on one glass
mount. xOpat can treat those areas as **virtual sub-sources** — cropped sub-regions of the
parent slide, each with its own local origin — and render them in one of three modes. This lets
you view the pieces side by side, or stack them in one viewer.

> **Authoring rule:** only **one** background may carry a `virtualization` split per session.
> Mixing several splittable backgrounds makes child indices and the active selection ambiguous;
> `expandVirtualBackgrounds` logs a console warning if it finds more than one.

---

## Model

A **parent** background carries a `virtualization` decomposition. At config-parse time
(`BackgroundConfig.expandVirtualBackgrounds`, `src/classes/background-config.ts`) it is expanded
into one **child** background per region, **appended** to `config.background[]` in region order:

```jsonc
"background": [
  { "id": "slide", "dataReference": 0, "visualizationIndex": 0, "microns": 0.5,
    "virtualizationMode": "overlaid",                 // none | sidebyside | overlaid
    "virtualization": {
      "detectorId": "manual",
      "regions": [
        // region/transform are RELATIVE FRACTIONS (0..1) of the source's own dimensions,
        // so co-registered sources of different resolution crop proportionally.
        { "id": "r0", "region": {"x":0,   "y":0,"w":0.5,"h":1}, "transform": {"dx":0,"dy":0,"rotation":0,"flip":false} },
        { "id": "r1", "region": {"x":0.5, "y":0,"w":0.5,"h":1}, "transform": {"dx":0,"dy":0,"rotation":0,"flip":false} }
      ] } }
  // ↓ appended by expansion (do not author these by hand):
  // { "id": "slide::r0", "virtualOf": "slide", "croppingContext": {...},
  //   "dataReference": { "dataID": <parent>, "protocol": "virtual-region", "croppingContext": {...} } },
  // { "id": "slide::r1", ... }
]
```

- **`region`** is a fraction (0..1) of each source's own full-resolution dimensions — not pixels.
- **`croppingContext`** ( `{ region, transform }` ) is carried on each child and threads through
  every co-registered data source it renders (background image **and** every visualization data
  layer), so the whole stack crops together.
- Each child gets a distinct **`id`** (`<parent>::<region>`) and a **`virtualOf`** link.
- A child's tiles render via the **`virtual-region`** slide protocol + `CroppedTileSource`
  (`src/classes/virtual-region-protocol.ts`): interior tiles **pass through** to the parent's
  real tile (shared OSD cache, no recompositing); only **border** tiles are cropped/composited.

---

## Render modes & their identity / IO semantics

Switch at runtime with `APPLICATION_CONTEXT.setVirtualizationMode(parentId, mode)`.

| mode | viewers | viewer identity (`uniqueId`) | IO / annotations | notes |
|---|---|---|---|---|
| **`none`** | 1 (parent, whole) | parent | parent | the un-split slide |
| **`sidebyside`** | N (one per region) | **parent** | **parent** (global coords) ✓ | data demuxed per region — see below |
| **`overlaid`** | 1 (regions stacked) | **parent** | **parent** (global coords, via workspaces) ✓ | per-region workspaces — see below |

> **One slide, one identity, global coordinates.** A virtual child resolves its identity to the
> **parent** in every mode: `explicitSlotBackgroundId`/`findViewerUniqueId` and
> `UTILITIES.currentBackgroundIdFor` (`src/loader.ts`) return the child's `virtualOf` parent when the
> shown tiled image is a `CroppedTileSource`. So all IO keys by the **parent** (`parent::parent`) and
> binds to the parent's sinks/capabilities regardless of split. Position-dependent consumers see the
> **un-split parent's GLOBAL pixel coordinates** — a crop is an axis-aligned sub-rect at the same
> resolution, so region-local ↔ parent-global is a pure translation by the region's parent-pixel
> origin, exposed by the `CroppedTileSource` coordinate API
> (`getParentId`/`getRegionPx`/`getParentDimensions`/`toParentImageCoordinates`/
> `fromParentImageCoordinates`/`containsParentImagePoint`, `src/classes/virtual-region-protocol.ts`).
> The scripting coordinate API (`src/classes/scripting/viewer-api.ts`) reports parent-global too.

### `overlaid` (recommended)
All region chunks render **co-resident in one viewer**, each its full cropped stack (background +
visualization). The viewer's selection stays the **parent** (`activeBackgroundIndex` points at
it), so `viewer.uniqueId`, `UTILITIES.currentBackgroundIdFor`, and the IO pipeline all key by the
**parent** — annotations and saved state behave **exactly like the un-split slide**. Only the
*rendering* changes; the *identity* does not.

Because the cuts come from the **same** slide, every cut is placed at **`width = region.w`** (its
fraction of the parent) so they all render at the **identical pixel scale** — a pixel in one cut
is the same on-screen size as in another (NOT OSD's default fit-each-to-the-viewport). Position
comes from each region's **`transform`** (`dx`/`dy` viewport offset, `rotation` degrees, `flip`):
the **identity transform stacks all cuts at the common origin**. A future image-registration step
just writes each region's `transform` to align the tissue pieces; the open pipeline already
consumes it. Per-region opacity (the identity-shader opacity control) lets you compare overlapping
cuts.

### `sidebyside`
Each region opens as a **separate viewer**, but all of them resolve identity to the **parent**
(above), so IO keys by `parent::parent` and binds to the parent's sinks — exactly like the un-split
slide. **Annotations** are persisted in **parent-global** coordinates and demuxed per region
(`modules/annotations/annotations.js`):
- **Export** aggregates every region viewer's fabric, lifting each object local→global
  (`source.toParentImageCoordinates`), into ONE native payload (shape-identical to a normal native
  export — reopening the parent in `none` loads it straight through).
- **Import** demuxes that payload: each region viewer gets only the objects whose global centre falls
  in its crop (`source.containsParentImagePoint`, **frame attribution**), translated back to
  region-local. A seam-straddling object lands by its centre, not duplicated.

The slide-switcher shows children in `sidebyside`, the parent otherwise — never both.
`setVirtualizationMode(_, "sidebyside")` still surfaces a one-time informational warning.

> **Known limitations.** Annotation **layers** and non-`native` formats (e.g. DICOM SR) are not
> split across regions — the native object list is the supported virtual wire format. The per-item
> CRUD/live-sync path (`defineResource("annotation")`) is **not** yet coordinate-translated;
> live-collaboration writes would carry region-local coords. Both are follow-ups.

### `overlaid` — annotations via WORKSPACES
Overlaid stacks N regions on **one** fabric canvas, so "which region does this annotation belong to"
is otherwise ambiguous. A **workspace** (`modules/annotations/workspace.js`) resolves it: a spatial
container with one *active* selection. The annotation module **auto-creates one LOCKED workspace per
region** (`FabricWrapper.rebuildOverlaidWorkspaces`, bound to that region's `CroppedTileSource` via
`regionRef`); the user must **select** one (no create/escape) — the selector appears in the
annotations panel. New annotations are constrained to the active workspace (a draw starting outside
is rejected with a `W_OUTSIDE_WORKSPACE` warning; drags are clamped to its area) and tagged at
runtime with `_workspaceID`. Only the active workspace's annotations are shown.

Workspaces are **never persisted** (`_workspaceID` is absent from
`AnnotationObjectFactory.copiedProperties`). On **export**, each annotation is translated
fabric→parent-global through its workspace's region (`Workspace.fabricToParentGlobal`) into ONE
native global payload — identical in shape to side-by-side, so reopening in `none` loads it straight.
On **import**, workspaces are rebuilt and each annotation is assigned to a region by **greedy
bounding-box overlap** (`_bestOverlapWorkspace` vs `source.getRegionPx()`), translated
parent-global→fabric, placed and re-tagged. The fabric↔parent-global round-trip routes through the
shared viewport using the overlay's referenced tiled image (`Workspace.fabricToParentGlobal` /
`parentGlobalToFabric`), so it holds under registration `transform`s too.

Workspaces are a generic primitive; this phase wires the virtual/overlaid (auto, locked) case fully.
User-created/escapable workspaces for ordinary slides are a follow-up.

---

## Session authoring

`setVirtualizationMode` is the runtime entry point. To open *already split* from a session,
author `params.activeBackgroundIndex` against the **post-expansion** indices (children are
appended after the authored backgrounds, in region order). With a single authored splittable
background `slide` at index 0, its children land at indices 1 (`r0`) and 2 (`r1`):

- `"activeBackgroundIndex": [0]` → `none` (parent whole).
- `"activeBackgroundIndex": [1, 2]` → `sidebyside` (two viewers, one per region).
- For `overlaid`, select the parent (`[0]`) and set `background[0].virtualizationMode = "overlaid"`.

`background[i].virtualizationMode` is consumed by the runtime toggle and (for `overlaid`) by the
open pipeline; on a fresh load `activeBackgroundIndex` is the source of truth for which viewers open.
