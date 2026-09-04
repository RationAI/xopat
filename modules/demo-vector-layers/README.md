# `demo-vector-layers`

Vector layers for the [visualization-flexibility demo](../../docs/site/docs/visualization-flexibility.mdx).

Registers one slide protocol, `demo-mvt`, which opens a Mapbox-Vector-Tile
pyramid over a slide's own pixel space.

## Why it exists

`flex-renderer` already ships both vector tile sources, and both are reachable
without any module code: OpenSeadragon's `TileSource.determineType` calls
`supports` on the **prototype** and never instantiates a candidate, so a plain
URL protocol pointing at a descriptor is enough to autodetect either one.

For GeoJSON that is the whole story, and this module deliberately does not wrap
it. `$.GeoJSONTileSource.configure` passes an explicit `width`/`height` from the
descriptor straight through, so a descriptor like

```json
{
  "type": "geojson",
  "url": "masks.geojson",
  "width": 105185,
  "height": 221772,
  "tileSize": 512,
  "style": { "classProperty": "class", "classes": { "tumor": "#e5484d" } }
}
```

lands on the slide correctly through any ordinary URL-template protocol.

MVT is the exception, and the reason is geometry. `MVTTileSource.configure`
derives the world as `width = height = 2^maxLevel * tileSize` — square, because
web-map tiling is square. A slide is not: the demo's is 105185 x 221772, an
aspect of 1:2.108. OpenSeadragon normalizes every tiled image to viewport width
1, so:

- aligning the square world 1:1 with the slide covers only its **top 47%** —
  there are no tiles below;
- rescaling so the square covers the slide's height instead puts the vector layer
  at **2.108x** the slide's scale, which looks plausible and is completely wrong.

No choice of `tileSize` or `maxzoom` fixes it, and there is no session-authorable
placement to compensate with.

A factory protocol sidesteps it entirely. `AbstractMVTTileSource` passes its
options straight to `super()`, so constructing the source with an explicit
`width`/`height` bypasses `configure()` and its square derivation. The tiles are
generated on that same non-square grid by
`docs/data/tools/make-visualization-demo.mjs`, so alignment is exact at every
level.

The request for TileJSON to be able to describe a non-square world is filed in
[`UPSTREAM.md`](../../UPSTREAM.md). **This module goes away when it lands.**

## Configuration

Deployment knobs in `include.json`, overridable under
`ENV.modules.demo-vector-layers`:

| key | default | meaning |
|---|---|---|
| `enabled` | `false` | off unless a deployment asks; `demo/visualization-flexibility` turns it on |
| `registerSlideProtocol` | `true` | register the protocol at load |
| `protocolId` | `"demo-mvt"` | id a session references via `protocol` |
| `protocolBaseUrl` | `""` | prefix for relative data ids; absolute ids are used as-is |

## Usage

```json
{
  "data": [
    "slides/slide.tif",
    { "dataID": "generated/mvt/tiles.json", "protocol": "demo-mvt" }
  ]
}
```

The descriptor is TileJSON plus two fields TileJSON cannot carry:

| field | meaning |
|---|---|
| `width`, `height` | the world in slide pixels — **required**, and the reason for this module |
| `tiles[0]` | tile template, resolved relative to the descriptor URL |
| `tileSize` | 512 by default |
| `extent` | tile-internal coordinate extent, 4096 by default |
| `minzoom` / `maxzoom` | level range |
| `style` | flex-renderer layer style map |
| `tileIndex` | which tiles exist, for a sparse pyramid — see below |

`scheme: "tms"` is **refused**: `getTileUrl` flips rows against `1 << z`, which
only holds for a square world. Use `xyz` (what the generator emits).

### Sparse pyramids

TileJSON assumes every tile in the zoom range exists. The generator writes only
tiles that carry geometry — 1981 of the ~119 000 the demo's range implies — so
every other tile 404s.

A 404 is a **real error** and stays one: a client cannot tell a missing tile from
a broken server, which is why `ViewerFaultySourceRegistry` flags a source whose
tiles keep failing. Teaching the client to swallow 404s would trade a loud
correct error for a silent wrong one.

So the layout is *declared*. `tileIndex` names which tiles exist and the source
turns it into a `tileExists(level, x, y)` predicate — OpenSeadragon consults that
in `TiledImage._getTile`, before a tile is ever scheduled, so the absent ones are
never requested.

```json
"tileIndex": {
  "encoding": "bitmask-base64-rowmajor",
  "levels": [ { "across": 1, "down": 1, "bits": "gA==" }, ... ]
}
```

`levels[z]` is that zoom's tile grid plus a base64 bitmask, row-major, MSB first,
bit `y * across + x`. Absent, or malformed in any way, the source falls back to
asking the server — an index can declare a tile missing, never hide one.

## Implementation note

The source overrides `getImageInfo` rather than supplying a `configure()`.
OpenSeadragon's `getImageInfo` re-runs `determineType` on the response and builds
*that* class, calling *its* `configure` — so a subclass override would simply be
bypassed. Fetching the descriptor and configuring `this` in place is the
contract described in `src/tile-source.ts`, and it is what lets the descriptor
fetch go through the protocol's own `HttpClient`.
