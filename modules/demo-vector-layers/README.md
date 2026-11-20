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

MVT geometry no longer needs help either: since the 2026-11-06 flex-renderer
build `MVTTileSource.configure` honours a declared `width`/`height` (the demo
slide is 105185 x 221772, not square), and this source reuses that `configure`
for everything it reads from the descriptor. What it adds is the one thing
TileJSON cannot say — which tiles exist (see *Sparse pyramids* below).

A generic `tileIndex` option on the library's MVT source is requested in
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
| `width`, `height` | the world in slide pixels — **required**; without them the library falls back to a square world |
| `tiles[0]` | tile template, resolved relative to the descriptor URL |
| `tileSize` | 512 by default |
| `extent` | tile-internal coordinate extent, 4096 by default |
| `minzoom` / `maxzoom` | level range |
| `style` | flex-renderer layer style map |
| `tileIndex` | which tiles exist, for a sparse pyramid — see below |

`scheme` may be `xyz` (what the generator emits) or `tms`; the TMS row flip uses
the level's real row count.

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
