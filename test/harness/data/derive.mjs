#!/usr/bin/env node
/**
 * Generate the derived data for the visualization-flexibility demo.
 *
 *     npm run fixtures:derive
 *     node test/harness/data/derive.mjs [--only vector,mvt,grid,pyramids] [--force]
 *
 * Everything here is DERIVED from the real prediction masks already in
 * `test/fixtures/data/slides/` — no synthetic shapes, no invented geometry. The point of
 * the demo is that six structurally different kinds of layer describe the same
 * real inference over the same real slide, so the figures have to come from that
 * inference.
 *
 * What comes out, and which demo capability each artifact serves:
 *
 *   vector/masks.geojson(.json)  GeoJSON polygons rendered as a vector layer
 *   mvt/{z}/{x}/{y}.pbf + tiles.json   the same polygons as vector tiles, sparse
 *                                (only tiles with geometry exist; `tiles.json`
 *                                carries a `tileIndex` saying which those are)
 *   grid/mask-grid.png(.json)    one pixel per prediction square, NEAREST-sampled
 *   pyramid/mask-a.tif           truncated pyramid: coarse storage, no preview injection
 *   pyramid/mask-b.tif           large coarsest level: preview injection fires
 *
 * The prediction grid is not a parameter we chose. Measured off the source
 * masks, nonzero runs are multiples of 4 at pyramid level 7 (scale 128.1) and
 * of 32 at level 4 (scale 16) — both 512 full-resolution pixels. So the model
 * emitted 512x512 squares, and `CELL_PX` below records that fact rather than
 * imposing one.
 *
 * Output goes to `test/fixtures/data/generated/`, which is gitignored: it is
 * reproducible from tracked code plus the fetched source slides. A content stamp
 * makes re-running free, following `test/harness/slides/make-synthetic.mjs`.
 * The stamp keys on each source's manifest checksum rather than its mtime, so
 * moving or re-fetching an identical file does not force a rebuild.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { openTiff } from "./lib/tiff-read.mjs";
import { polygonsForBand } from "./lib/contour.mjs";
import { encodeTile, clipRing } from "./lib/mvt-write.mjs";
import { encodeTiff, boxResample } from "./lib/tiff-write.mjs";
// Reused rather than re-written: both are Node-side dev tooling, so the
// no-cross-boundary-imports rule (AGENTS.md s0.5), which is about runtime
// plugins/modules/src code, does not apply here.
import { encodePng } from "../slides/png.mjs";
import { DATA_DIR, SLIDES_DIR, loadManifest } from "./fetch.mjs";

const OUT_DIR = path.join(DATA_DIR, "generated");
const STAMP = path.join(OUT_DIR, ".stamp.json");

/** Bumped when the generator's output layout changes, invalidating every stamp. */
const FORMAT = 2;

/** Full-resolution pixels per prediction square — measured, see the header. */
const CELL_PX = 512;

/** Long edge to aim for when picking which pyramid level to read. */
const WORKING_LONG_EDGE = 1500;

/**
 * Score bands, read off the actual distribution rather than guessed.
 * `cancer-inference.tif` is strongly bimodal (6048 cells in 1-63, a thin middle,
 * 5008 in 192-255 at level 7), so a two-class split is what the data supports.
 * `detection.tiff` is graded and contributes a third class.
 */
const CLASSES = [
    { id: "tumor", source: "cancer-inference.tif", lo: 128, hi: 255, color: "#e5484d" },
    { id: "suspect", source: "cancer-inference.tif", lo: 32, hi: 127, color: "#f5a524" },
    { id: "detection", source: "detection.tiff", lo: 96, hi: 255, color: "#3e63dd" },
];

/** Rings smaller than this many prediction cells are dropped as speckle. */
const MIN_CELL_AREA = 2;

const MVT_TILE_SIZE = 512;
const MVT_EXTENT = 4096;
/** Tile-internal units of slack, so a polygon edge on a tile seam has no gap. */
const MVT_CLIP_BUFFER = 32;

/**
 * `getThumbnail()` in `modules/webtiff` refuses a coarsest level above this
 * (`MAX_THUMBNAIL_SOURCE_PIXELS`). Exceeding it does not disable preview
 * injection — injection lands, the thumbnail comes back undefined, the tile
 * fails and the slide is remembered as a preview failure. The demo would then
 * be exercising the failure path while claiming to show the success path, so
 * the generator asserts instead.
 */
const MAX_THUMBNAIL_PIXELS = 32 * 1024 * 1024;
/** `PREVIEW_LEVEL_MIN_COARSEST_PX` in `src/classes/preview-level.ts`. */
const PREVIEW_MIN_COARSEST_PX = 2048;

/**
 * Where the generated data will be SERVED from.
 *
 * Only one artifact needs it — the grid mask's descriptor, whose level url
 * cannot be relative (see `writeGridMask`). Everything else is resolved either
 * against the descriptor's own url by the tile source, or by the slide protocol
 * at open time, and stays host-independent.
 */
const DEFAULT_BASE_URL = process.env.TIFF_FILESERVER || "http://127.0.0.1:9100/files";
let BASE_URL = DEFAULT_BASE_URL;

function parseArgs(argv) {
    const opts = { only: null, force: false, baseUrl: DEFAULT_BASE_URL };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--only") opts.only = new Set(argv[++i].split(","));
        else if (argv[i] === "--force") opts.force = true;
        else if (argv[i] === "--base-url") opts.baseUrl = argv[++i];
        else throw new Error(`[demo-data] unknown argument "${argv[i]}"`);
    }
    opts.baseUrl = String(opts.baseUrl).replace(/\/+$/, "");
    return opts;
}

const log = (...args) => console.log("[demo-data]", ...args);

/**
 * Resample one source mask onto the prediction-cell grid.
 *
 * Reads a coarse pyramid level (1-2 Mpx, well under a second) and averages it
 * into cells that map exactly onto the full-resolution 512-pixel grid — so cell
 * (i,j) is the slide rectangle `[i*512, (i+1)*512) x [j*512, (j+1)*512)`,
 * clipped at the slide edge.
 */
function readCellGrid(filePath, cellsX, cellsY, slideW, slideH) {
    const tiff = openTiff(filePath);
    try {
        let chosen = tiff.levels[0];
        for (const level of tiff.levels) {
            if (Math.max(level.width, level.height) >= WORKING_LONG_EDGE) chosen = level;
        }
        const raster = tiff.readLevelRegion(chosen.index, 0, 0, chosen.width, chosen.height);
        const scaleX = chosen.width / slideW;
        const scaleY = chosen.height / slideH;

        const cells = new Uint8Array(cellsX * cellsY);
        for (let j = 0; j < cellsY; j++) {
            const y0 = Math.floor(j * CELL_PX * scaleY);
            const y1 = Math.max(y0 + 1, Math.min(chosen.height, Math.ceil((j + 1) * CELL_PX * scaleY)));
            for (let i = 0; i < cellsX; i++) {
                const x0 = Math.floor(i * CELL_PX * scaleX);
                const x1 = Math.max(x0 + 1, Math.min(chosen.width, Math.ceil((i + 1) * CELL_PX * scaleX)));
                let sum = 0;
                let n = 0;
                for (let y = y0; y < y1; y++) {
                    const row = y * chosen.width;
                    for (let x = x0; x < x1; x++) { sum += raster[row + x]; n++; }
                }
                cells[j * cellsX + i] = n ? Math.round(sum / n) : 0;
            }
        }
        return { cells, level: chosen };
    } finally {
        tiff.close();
    }
}

/**
 * Mean score of the cells a ring encloses, as a 0-1 number. Used as the
 * `score` property, so the vector layers can be coloured by a real value
 * rather than by class alone.
 */
function meanScoreInRing(cells, cellsX, ring) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    let sum = 0;
    let n = 0;
    for (let y = minY; y < maxY; y++) {
        for (let x = minX; x < maxX; x++) {
            const v = cells[y * cellsX + x];
            if (v) { sum += v; n++; }
        }
    }
    return n ? Number((sum / n / 255).toFixed(4)) : 0;
}

/** Build the class polygons once; every vector artifact is derived from these. */
function buildFeatures(grids, cellsX, cellsY) {
    const features = [];
    let id = 1;

    for (const klass of CLASSES) {
        const cells = grids.get(klass.source);
        const polygons = polygonsForBand(cells, cellsX, cellsY, klass.lo, klass.hi, MIN_CELL_AREA);
        for (const polygon of polygons) {
            features.push({
                id: id++,
                class: klass.id,
                score: meanScoreInRing(cells, cellsX, polygon[0]),
                // Rings stay in CELL coordinates here; each writer scales them
                // into the space it needs (slide pixels, or tile units).
                rings: polygon,
            });
        }
        log(`  ${klass.id}: ${polygons.length} polygons from ${klass.source} [${klass.lo}..${klass.hi}]`);
    }
    return features;
}

const cellRingToSlide = (ring) => ring.map(([x, y]) => [x * CELL_PX, y * CELL_PX]);

async function writeGeoJson(features, slideW, slideH) {
    const dir = path.join(OUT_DIR, "vector");
    await fsp.mkdir(dir, { recursive: true });

    const collection = {
        type: "FeatureCollection",
        // Slide pixel coordinates, top-left origin — the same space the viewer
        // uses. The descriptor below states width/height so the tile source maps
        // them onto the image without guessing.
        bbox: [0, 0, slideW, slideH],
        features: features.map(f => ({
            type: "Feature",
            id: f.id,
            properties: { class: f.class, score: f.score },
            geometry: { type: "Polygon", coordinates: f.rings.map(cellRingToSlide) },
        })),
    };
    await fsp.writeFile(path.join(dir, "masks.geojson"), JSON.stringify(collection));

    const descriptor = {
        // `$.GeoJSONTileSource.supports` (flex-renderer) matches on this.
        type: "geojson",
        // Resolved relative to this descriptor's own URL by `configure()`.
        url: "masks.geojson",
        width: slideW,
        height: slideH,
        tileSize: 512,
        minLevel: 0,
        // Pinned rather than left to the default `ceil(log2(max(w,h)))`, so the
        // number does not move if the slide is ever swapped.
        maxLevel: Math.ceil(Math.log2(Math.max(slideW, slideH))),
        style: {
            classProperty: "class",
            classes: Object.fromEntries(CLASSES.map(c => [c.id, c.color])),
            lineWidth: 1.5,
        },
        aggregation: { enabled: true, threshold: 50 },
    };
    await fsp.writeFile(path.join(dir, "masks.geojson.json"), JSON.stringify(descriptor, null, 2));
    log(`  geojson: ${features.length} features -> vector/masks.geojson`);
}

async function writeMvt(features, slideW, slideH) {
    const dir = path.join(OUT_DIR, "mvt");
    await fsp.mkdir(dir, { recursive: true });

    // A NON-SQUARE tile pyramid over the slide's own pixel space. TileJSON has
    // no way to say that and `MVTTileSource.configure` would derive a square
    // world from `2^maxLevel * tileSize`; `modules/demo-vector-layers`
    // constructs the source directly from the descriptor below instead. See the
    // flex-renderer entry in UPSTREAM.md.
    const maxLevel = Math.ceil(Math.log2(Math.max(slideW, slideH) / MVT_TILE_SIZE));
    const slideRings = features.map(f => ({ ...f, rings: f.rings.map(cellRingToSlide) }));

    let written = 0;
    const index = [];
    for (let z = 0; z <= maxLevel; z++) {
        const scale = Math.pow(2, maxLevel - z);
        const levelW = Math.ceil(slideW / scale);
        const levelH = Math.ceil(slideH / scale);
        const across = Math.ceil(levelW / MVT_TILE_SIZE);
        const down = Math.ceil(levelH / MVT_TILE_SIZE);
        // One bit per tile of this level, row-major, MSB first. Tiles carrying no
        // geometry are not written (see below), and a client that requests one
        // gets a 404 — which is a genuine error, not "empty here". The index is
        // how the sparseness gets *declared* instead of discovered by failing.
        const bits = new Uint8Array(Math.ceil((across * down) / 8));

        for (let ty = 0; ty < down; ty++) {
            for (let tx = 0; tx < across; tx++) {
                // Tile bounds in SLIDE pixels, and the transform into the tile's
                // own 0..extent space.
                const originX = tx * MVT_TILE_SIZE * scale;
                const originY = ty * MVT_TILE_SIZE * scale;
                const span = MVT_TILE_SIZE * scale;
                const k = MVT_EXTENT / span;

                const tileFeatures = [];
                for (const feature of slideRings) {
                    const rings = [];
                    for (const ring of feature.rings) {
                        const local = ring.map(([x, y]) => [(x - originX) * k, (y - originY) * k]);
                        const clipped = clipRing(local, -MVT_CLIP_BUFFER, -MVT_CLIP_BUFFER,
                            MVT_EXTENT + MVT_CLIP_BUFFER, MVT_EXTENT + MVT_CLIP_BUFFER);
                        if (clipped) rings.push(clipped.map(([x, y]) => [Math.round(x), Math.round(y)]));
                    }
                    // A polygon whose exterior clipped away takes its holes with
                    // it; `rings[0]` being absent means nothing to draw.
                    if (rings.length) {
                        tileFeatures.push({
                            id: feature.id,
                            properties: { class: feature.class, score: feature.score },
                            rings,
                        });
                    }
                }
                if (!tileFeatures.length) continue;

                const body = encodeTile([{ name: "predictions", extent: MVT_EXTENT, features: tileFeatures }]);
                const tileDir = path.join(dir, String(z), String(tx));
                await fsp.mkdir(tileDir, { recursive: true });
                await fsp.writeFile(path.join(tileDir, `${ty}.pbf`), body);
                const bit = ty * across + tx;
                bits[bit >> 3] |= 1 << (7 - (bit & 7));
                written++;
            }
        }

        index.push({ across, down, bits: Buffer.from(bits).toString("base64") });
    }

    const descriptor = {
        tilejson: "2.2.0",
        name: "predictions",
        format: "pbf",
        scheme: "xyz",
        tiles: ["{z}/{x}/{y}.pbf"],
        minzoom: 0,
        maxzoom: maxLevel,
        tileSize: MVT_TILE_SIZE,
        extent: MVT_EXTENT,
        // Not part of TileJSON — read by `modules/demo-vector-layers` so the
        // source can be built with a non-square world.
        width: slideW,
        height: slideH,
        // Also not TileJSON: which tiles exist. TileJSON assumes a dense pyramid
        // and has no way to say otherwise, so a sparse layout is only knowable by
        // requesting a tile and getting a 404 — which the client rightly treats as
        // a failure, and enough of them mark the whole source faulty. The module
        // turns this into a `tileExists` predicate so absent tiles are never asked
        // for. `levels[z]` is z's grid plus a base64 row-major MSB-first bitmask.
        tileIndex: { encoding: "bitmask-base64-rowmajor", levels: index },
        vector_layers: [{ id: "predictions", fields: { class: "String", score: "Number" } }],
        style: {
            layers: {
                predictions: { type: "fill", color: [0.9, 0.28, 0.30, 0.55] },
            },
        },
    };
    await fsp.writeFile(path.join(dir, "tiles.json"), JSON.stringify(descriptor, null, 2));
    log(`  mvt: ${written} tiles over z0..z${maxLevel} -> mvt/tiles.json`);
}

async function writeGridMask(grids, cellsX, cellsY, slideW, slideH) {
    const dir = path.join(OUT_DIR, "grid");
    await fsp.mkdir(dir, { recursive: true });

    // One PNG pixel per prediction square. The whole point: a model that
    // predicts on a 512-pixel grid has no reason to ship a gigapixel raster, and
    // the viewer stretches this over the slide with `imageSmoothingEnabled:
    // false` so the squares stay squares.
    const tumor = grids.get("cancer-inference.tif");
    const detection = grids.get("detection.tiff");
    const rgba = new Uint8Array(cellsX * cellsY * 4);
    for (let i = 0; i < cellsX * cellsY; i++) {
        const t = tumor[i];
        const d = detection[i];
        // R = inference score, G = detection score, A = present at all. Any
        // shader can pick a channel; `colormap` on R is what the demo session uses.
        rgba[i * 4 + 0] = t;
        rgba[i * 4 + 1] = d;
        rgba[i * 4 + 2] = 0;
        rgba[i * 4 + 3] = t || d ? 255 : 0;
    }
    await fsp.writeFile(path.join(dir, "mask-grid.png"), encodePng(cellsX, cellsY, rgba));

    const descriptor = {
        // OSD's `LegacyTileSource` shape: a list of levels, here exactly one.
        // More faithful than a one-level DZI, which would still imply a pyramid.
        type: "legacy-image-pyramid",
        // ABSOLUTE, and it has to be. `LegacyTileSource`'s `configureFromObject`
        // is `return configuration.levels;` — it never resolves a level url
        // against the descriptor's own url, unlike the GeoJSON source next door.
        // A relative "mask-grid.png" is therefore handed to the browser as-is and
        // resolves against the VIEWER's origin, 404ing on a host that never had
        // it. Hence `--base-url`.
        levels: [{ url: `${BASE_URL}/generated/grid/mask-grid.png`, width: cellsX, height: cellsY }],
        // Not read by OSD — recorded so the `pixelScale` in the session can be
        // traced back to the generator rather than looking like a magic number.
        xopatPixelScale: CELL_PX,
    };
    await fsp.writeFile(path.join(dir, "mask-grid.json"), JSON.stringify(descriptor, null, 2));

    // The grid covers a WHOLE number of prediction squares, so it is slightly
    // larger than the slide — the edge square is clipped by the slide, not by
    // the model. The session must therefore declare `pixelScale: CELL_PX`, or
    // OpenSeadragon normalizes the overlay to the slide's width and every cell
    // comes out ~1.4 px small, drifting by most of a cell at the far corner.
    const covered = { x: cellsX * CELL_PX, y: cellsY * CELL_PX };
    log(`  grid: ${cellsX}x${cellsY} px (1 px = ${CELL_PX} slide px) ` +
        `covering ${covered.x}x${covered.y} of a ${slideW}x${slideH} slide ` +
        `(overhang ${covered.x - slideW}x${covered.y - slideH} px)`);
    log(`  grid: the session MUST declare "pixelScale": ${CELL_PX} on this data entry — ` +
        `without it the overlay is squeezed to ${(slideW / cellsX).toFixed(2)} px/cell`);
}

/**
 * The two prediction-mask pyramids that demonstrate the preview-level machinery
 * from both sides. Both carry the same data at different storage costs.
 */
async function writeMaskPyramids(grids, cellsX, cellsY, slideW, slideH) {
    const dir = path.join(OUT_DIR, "pyramid");
    await fsp.mkdir(dir, { recursive: true });

    const source = grids.get("cancer-inference.tif");
    const aspect = slideH / slideW;

    /** Build a pyramid whose finest level has the given LONG edge. */
    const pyramid = (longEdge, levelCount) => {
        const levels = [];
        for (let i = 0; i < levelCount; i++) {
            const h = Math.round(longEdge / Math.pow(2, i));
            const w = Math.max(1, Math.round(h / aspect));
            levels.push({ width: w, height: h, pixels: boxResample(source, cellsX, cellsY, w, h) });
        }
        return levels;
    };

    // Mask A — coarsest long edge 1025, i.e. below PREVIEW_MIN_COARSEST_PX.
    // Injection declines, correctly: the pyramid is already cheap.
    const maskA = pyramid(4100, 3);
    // Mask B — coarsest long edge 4100, above the threshold, so injection fires.
    // Sized by the LONG edge deliberately: 4096 px WIDE would be 4096x8635 =
    // 35.4 Mpx, over the thumbnail budget, and the demo would show the failure
    // path instead.
    const maskB = pyramid(8200, 2);

    for (const [name, levels] of [["mask-a", maskA], ["mask-b", maskB]]) {
        const coarsest = levels[levels.length - 1];
        const longEdge = Math.max(coarsest.width, coarsest.height);
        const pixels = coarsest.width * coarsest.height;
        if (pixels > MAX_THUMBNAIL_PIXELS) {
            throw new Error(`[demo-data] ${name}: coarsest level ${coarsest.width}x${coarsest.height} ` +
                `= ${(pixels / 1024 / 1024).toFixed(1)} Mpx exceeds webtiff's ${MAX_THUMBNAIL_PIXELS / 1024 / 1024} Mpx ` +
                `thumbnail budget; getThumbnail() would return undefined and preview injection would fail rather than decline`);
        }
        const buf = encodeTiff(levels, 256);
        await fsp.writeFile(path.join(dir, `${name}.tif`), buf);
        log(`  ${name}: ${levels.map(l => `${l.width}x${l.height}`).join(" -> ")}, ` +
            `coarsest long edge ${longEdge} ${longEdge > PREVIEW_MIN_COARSEST_PX ? ">" : "<="} ${PREVIEW_MIN_COARSEST_PX} ` +
            `(preview injection ${longEdge > PREVIEW_MIN_COARSEST_PX ? "FIRES" : "declines"}), ` +
            `${(buf.length / 1024).toFixed(0)} KB`);
    }
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    BASE_URL = opts.baseUrl;
    const wants = (name) => !opts.only || opts.only.has(name);

    const sources = ["cancer-inference.tif", "detection.tiff"];
    const manifest = loadManifest();
    const inputs = [];
    for (const name of sources) {
        const file = path.join(SLIDES_DIR, name);
        if (!fs.existsSync(file)) {
            console.error(`[demo-data] missing source: ${file}\n` +
                `            The demo derives everything from the real prediction masks.\n` +
                `            Run \`npm run fixtures:fetch\` — see test/fixtures/data/README.md.`);
            process.exit(1);
        }
        const stat = fs.statSync(file);
        // Identity comes from the manifest checksum, not the mtime: re-fetching
        // or relocating a byte-identical file must not invalidate the stamp.
        const sha256 = manifest.items.find(i => i.name === name)?.sha256;
        inputs.push(sha256 ? { name, sha256 } : { name, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) });
    }

    const signature = JSON.stringify({
        format: FORMAT,
        cellPx: CELL_PX,
        classes: CLASSES,
        minCellArea: MIN_CELL_AREA,
        mvt: { tileSize: MVT_TILE_SIZE, extent: MVT_EXTENT, buffer: MVT_CLIP_BUFFER },
        only: opts.only ? [...opts.only].sort() : null,
        // Baked into the grid descriptor, so a different host must rebuild.
        baseUrl: opts.baseUrl,
        inputs,
    });

    if (!opts.force && fs.existsSync(STAMP)) {
        try {
            if (fs.readFileSync(STAMP, "utf8") === signature) {
                log(`up to date (${OUT_DIR}); pass --force to rebuild`);
                return;
            }
        } catch { /* unreadable stamp: rebuild */ }
    }

    await fsp.mkdir(OUT_DIR, { recursive: true });

    // Slide geometry comes from the mask itself: `cancer-inference.tif` is
    // pixel-for-pixel the same size as `slide.tif` (both 105185x221772), which
    // is what makes every derived layer align without a registration step.
    const probe = openTiff(path.join(SLIDES_DIR, "cancer-inference.tif"));
    const slideW = probe.levels[0].width;
    const slideH = probe.levels[0].height;
    probe.close();

    const cellsX = Math.ceil(slideW / CELL_PX);
    const cellsY = Math.ceil(slideH / CELL_PX);
    log(`slide ${slideW}x${slideH}, prediction grid ${cellsX}x${cellsY} cells of ${CELL_PX} px`);

    const grids = new Map();
    for (const name of sources) {
        const started = Date.now();
        const { cells, level } = readCellGrid(path.join(SLIDES_DIR, name), cellsX, cellsY, slideW, slideH);
        grids.set(name, cells);
        let nonZero = 0;
        for (const v of cells) if (v) nonZero++;
        log(`  read ${name} at level ${level.index} (${level.width}x${level.height}), ` +
            `${nonZero}/${cells.length} cells populated, ${Date.now() - started} ms`);
    }

    const needsVector = wants("vector") || wants("mvt");
    const features = needsVector ? buildFeatures(grids, cellsX, cellsY) : [];

    if (wants("vector")) await writeGeoJson(features, slideW, slideH);
    if (wants("mvt")) await writeMvt(features, slideW, slideH);
    if (wants("grid")) await writeGridMask(grids, cellsX, cellsY, slideW, slideH);
    if (wants("pyramids")) await writeMaskPyramids(grids, cellsX, cellsY, slideW, slideH);

    await fsp.writeFile(STAMP, signature);
    log(`done -> ${OUT_DIR}`);
    log(`serve it with:  npm run fixtures:serve`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
