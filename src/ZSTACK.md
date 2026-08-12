# Z-Stack (Focal-Plane) Navigation

A z-stack is **one logical slide parameterized by a focal-plane index** — not a
time-series shader (which swaps between N distinct data entries at the
shader-slot level). The plane lives on the tile source; the core drives plane
switches with an in-place tile swap, so scrubbing depth never blanks the view.

Runtime pieces:

- `src/classes/app/viewer-depth-controller.ts` — per-viewer `ViewerDepthController`,
  installed as `viewer.__depthController` (its file header is the detailed design doc).
- `src/classes/app/z-plane-prefetcher.ts` — idle-time prefetch of neighboring planes.
- `src/tile-source.ts` — the typed contract surface (`zStack` / `setZDepth`).

## Tile-source contract (opt-in)

The contract is duck-typed; any `OpenSeadragon.TileSource` opts in by providing:

| Member | Requirement |
|---|---|
| `zStack` | `{ count, index, spacingUm?, labels? }`. `count > 1` is the opt-in signal; absent or `count: 1` keeps the slide single-plane. |
| `setZDepth(index)` | Mutate **identity state only** (active plane, `zStack.index`). No fetching, no cache work — the controller performs the repaint. |
| `getTileUrl` | Must bake the active plane into the URL (e.g. append `&z=<n>`). Emit nothing when `count <= 1` so plain-slide URLs stay byte-stable. |
| `getTileHashKey` | Must stay **z-independent** — one tile identity across planes. The controller layers plane pixels on top via extra `z://<plane>/<key>` cache records. |

Optional flags the controller respects: `_isVector` / `multifetch` sources are
skipped from the in-place swap; `_dataFormat` (`"rasterBlob"` / `"rawTiff"`)
gates z-record caching.

**Static `configure()` gotcha:** OSD calls `configure()` with `this` bound to a
generic autodetect `TileSource`, not your subclass — any helper that builds the
`zStack` descriptor inside `configure()` must be `static` and merged into the
returned config object.

**Reference implementation:** `modules/rationai-wsi-tile-source/tile-source.js`
(`RationaiStandaloneV3TileSource`): `static _buildZStack(...)` builds the
descriptor from server extent, `setZDepth` clamps + stores `_activeZ`,
`_zQuery()` appends `&z=<n>` in `getUrl`, and `getTileHashKey` keys by
`x_y/level/fileId` only.

## What the core does

`ViewerDepthController` public API: `hasZStack()`, `getRange()`,
`setDepth(index, {force?})`, `step(delta)`.

Depth scrubs **bypass the open pipeline entirely**. `setDepth`:

1. calls `setZDepth(i)` on every z-capable world item,
2. swaps loaded tiles **in place** through OSD's invalidation pipeline
   (scoped `tile-invalidated` handler + `requestInvalidate`) — old pixels stay
   on screen until new-plane data resolves, so there is no white flash;
   viewport tiles first, then the off-viewport set,
3. raises `z-depth-changed` (see [`EVENTS.md`](EVENTS.md)).

Every plane fetched or prefetched is parked as a `z://<plane>/<originalCacheKey>`
cache record, budget-managed by a controller-owned LRU — revisiting a plane is
served from memory. `ZPlanePrefetcher` prefetches `z±radius` planes for drawn
tiles during idle time.

## Configuration

All read via `APPLICATION_CONTEXT.getOption(...)`, defaults + inline docs in
`src/config.json`:

- `zPlaneCacheEnabled` (`true`) — keep visited/prefetched planes as z-records.
- `zPlaneCacheMaxItems` (`400`) — LRU budget for those records (they also count
  toward OSD's `maxImageCacheCount`).
- `zPrefetchRadius` (`1`) — idle prefetch distance; `0` disables prefetch.
- `zPrefetchConcurrency` (`4`) — **deprecated / no-op.** Prefetch concurrency is now
  bounded globally by `APPLICATION_CONTEXT.requestScheduler` (background lane, per tile
  origin — shared across all viewers), not per-viewer here. Tune
  `requestSchedulerBgIdle` / `requestSchedulerBgBusy` instead.
- `zRepaintOffViewport` (`"cached-only"`) — off-viewport tiles on a plane
  change: `"cached-only"` swaps only already-cached planes and unloads the rest
  (reloaded on pan), `"fetch"` refetches all of them (full fidelity, heavy).

## UI, input, scripting, persistence

- **Navigator slider** (`ui/classes/components/navigatorSideMenu.mjs`): a
  focal-plane row at the bottom of the navigator, auto-shown when
  `__depthController.getRange()` is non-null.
- **Input**: Alt + mouse wheel over the canvas; keyboard shortcuts
  `core.viewport.zDepthNext` / `zDepthPrev` (defaults `]` / `[`, remappable via
  the Keymap panel).
- **Scripting API** (`src/classes/scripting/viewer-api.ts`):
  `viewer.getZStack()`, `viewer.setZDepth(index)`, `viewer.stepZDepth(delta)`.
- **Persistence**: the active plane round-trips through the canonical scene
  (session/URL) as `overlay.zStack` (`src/classes/app/canonical-scene.ts`),
  written only when the index is non-zero.

## Interplay

- Compatible with the synthetic preview level (`src/classes/preview-level.ts`) —
  the in-place swap preserves the level count.
- Not wired for virtual-region (`CroppedTileSource`) parents; vector and
  `multifetch` sources are excluded from the swap.
