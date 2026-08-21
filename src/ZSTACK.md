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
| `setZDepth(index)` | Mutate **identity state only** (active plane, `zStack.index`), **synchronously**. No fetching, no cache work — the controller performs the repaint, and it also flips the plane briefly to ask `getTileUrl` about planes you are not showing. |
| `getTileUrl` | Must bake the active plane into the URL (e.g. append `&z=<n>`, or address a different DICOM instance). Emit nothing when `count <= 1` so plain-slide URLs stay byte-stable. Distinct planes must yield distinct URLs. |
| `getTileHashKey` | Must stay **z-independent** — one tile identity across planes — and must **contain the source identity** (`fileId` or `tileSourceId`), which is how the plane-change zombie purge finds this source's records. The OSD default returns the tile URL and is therefore *plane-dependent*: overriding it is mandatory (a `debugMode` warning fires if you don't). The controller layers plane pixels on top via extra `z://<plane>/<key>` cache records. |
| `downloadTileStart` | Nothing z-specific — but it is also the **plane loader**: the controller and the prefetcher fetch other planes by running your own downloader through a stock `OpenSeadragon.ImageJob` with `src` set to the plane URL. Honour `context.src` (OSD already requires this) and the plane data arrives in your native type. |

That is the whole contract. There are no z-only tile-source methods: an arbitrary
plane's URL is obtained by flipping `setZDepth` around a `getTileUrl` call, and
"does the tile's original record already hold plane p?" is answered by comparing
that URL with `tile.getUrl()` — no plane number is ever parsed out of a URL.

**Non-blob sources.** Any data type works. The plane record stores whatever your
`downloadTileStart` finished with (`rasterBlob`, `rawTiff`, `imageBitmap`,
`gpuTextureSet`, …); the controller decides how to handle it by asking OSD's
converter, not the source — a type with a registered self-copy edge
(`converter.copyings`) is copied out of the cache, a type without a registered
destructor (`converter.destructors`) is shared by reference, and a type with
neither is refetched instead of cached. `_isVector` / `multifetch` sources are no
longer excluded: they participate as soon as their `getTileUrl` returns a
per-plane string.

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

1. calls `setZDepth(...)` on every z-capable world item, each with **its own**
   index for that depth (see *Heterogeneous stacks* below),
2. swaps loaded tiles **in place** through OSD's invalidation pipeline
   (scoped `tile-invalidated` handler + `requestInvalidate`) — old pixels stay
   on screen until new-plane data resolves, so there is no white flash;
   viewport tiles first, then the off-viewport set,
3. raises `z-depth-changed` (see [`EVENTS.md`](EVENTS.md)).

Every plane fetched or prefetched is parked as a `z://<plane>/<originalCacheKey>`
cache record (in the source's own data type), budget-managed by a
controller-owned LRU — revisiting a plane is served from memory.
`ZPlanePrefetcher` prefetches `z±radius` planes for drawn tiles during idle time,
through the same `downloadTileStart` path, bounded by the shared background
request lane.

## Heterogeneous stacks (background + visualization layers)

A visualization data layer is an ordinary TiledImage in `viewer.world` and
resolves through the same tile-source classes as a background, so **a viz layer
that declares `zStack` scrubs together with its background automatically** — it
needs no registration and no per-layer wiring.

Their stacks rarely match, though, so the core does not push one integer
everywhere. Every public index (`getRange`, `setDepth`, `step`,
`z-depth-changed`, `overlay.zStack`) is on the **reference axis** — the
scalebar's referenced image, else the first z-capable item — and each other
source receives `mapPlaneIndex(reference, its own stack, index)`:

1. **Physical** — both declare `spacingUm`: same depth in micrometers. Equal
   spacings degenerate to identity, and an overlay covering only part of the
   depth range correctly stops at its own end instead of being stretched over it.
2. **Exact** — equal plane counts: identity.
3. **Proportional** — otherwise: the normalized position is scaled.

Always clamped to the target's range. So a 40-plane background at 1 µm, an
overlay sampled every 4 µm and a 3-plane mask land on planes 20 / 5 / 1 from a
single scrub to 20.

**Cross-viewport propagation is opt-in and never automatic.** Scrubbing one
viewport moves only that viewport unless the viewports are linked through the
sync routine (the per-viewer SYNC button / `core.sync.*`), which carries the
plane alongside pan/zoom/rotation/flip and translates it through the same
mapping — the two viewers show different slides, so their axes differ. Live
collaboration mirrors the plane per viewer through the `core:viewport` session
provider.

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
- Virtual regions keep their parent's planes: `CroppedTileSource`
  (`src/classes/virtual-region-protocol.ts`) delegates `zStack` / `setZDepth`,
  stamps the plane into its border-tile token (so distinct planes stay distinct
  identities), and resolves the parent's URLs *at that tile's plane* rather than
  at the live one — compositing and prefetch are asynchronous. Interior
  pass-through tiles need nothing: they already carry the parent's real URL.

## Known limitation

**Annotations carry no z coordinate.** An annotation drawn while one plane is
active renders on *every* plane. That is harmless for optical focal stacks (the
planes are microns apart and depict the same field) but wrong-looking for any
slice-like stack, where each plane is different content. Adding a plane
coordinate would touch the annotation model, its renderer, existing-data
migration and the DICOM SR round-trip; it is deliberately out of scope here.
