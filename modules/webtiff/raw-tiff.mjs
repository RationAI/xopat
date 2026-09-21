/**
 * Tiles that arrive as TIFF bytes — the `rawTiff` cache type.
 *
 * Not every TIFF in xOpat is a file this module opens. A WSI-Service source
 * asked for `image_format=tiff` (`rationai-wsi-tile-source`,
 * `empaia-wsi-tile-source`) finishes each *tile* as a TIFF blob typed
 * `rawTiff`, and something has to turn that into pixels. Until now that
 * something was the `geotiff` module's bundled converter chain, which means a
 * deployment replacing `geotiff` with this module would keep its high-bit-depth
 * WSI-Service slides — and lose the ability to draw them.
 *
 * So the same edges are provided here, decoded by the same libtiff worker pool
 * that serves ordinary slides. This is a *converter*, not an ownership claim:
 * whoever produced the tile still owns the slide, its shaders and its metadata
 * (see `index.mjs`, "Which slides this module touches").
 *
 * The cost arguments on those edges are load-bearing and counter-intuitive —
 * see the note on {@link registerRawTiffConverters}.
 *
 * @module webtiff/raw-tiff
 */

import { WebTiffTextureSet, textureSetToImageData } from "./tile-source.mjs";

/**
 * Whatever a `rawTiff` cache entry turned out to be, as bytes.
 *
 * The producers disagree: the WSI-Service sources finish a `Blob`, the geotiff
 * plugin's own wrapper carries `{source}`, and a caller with the buffer in hand
 * passes it directly. All three are one TIFF.
 *
 * @param {Blob|ArrayBuffer|ArrayBufferView|{source: *}} payload
 * @return {Promise<Uint8Array>}
 */
async function rawTiffBytes(payload) {
    const value = payload && typeof payload === "object" && "source" in payload
        ? payload.source : payload;

    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof Blob !== "undefined" && value instanceof Blob) {
        return new Uint8Array(await value.arrayBuffer());
    }
    if (value && typeof value.arrayBuffer === "function") {
        return new Uint8Array(await value.arrayBuffer());
    }
    throw new Error("[webtiff] unsupported rawTiff payload; expected a Blob, an ArrayBuffer or a typed array");
}

/**
 * Decode a `rawTiff` payload into a packed texture set.
 *
 * @param {object} pool the decode pool
 * @param {object} packing `{packFlags, padAlpha}`
 * @param {*} payload the cache entry
 * @return {Promise<WebTiffTextureSet>}
 */
async function rawTiffToTextureSet(pool, packing, payload) {
    const bytes = await rawTiffBytes(payload);
    // Transferred into the worker, so hand over a copy rather than detaching a
    // buffer the tile cache may still be holding.
    const owned = new Uint8Array(bytes.byteLength);
    owned.set(bytes);

    const { header, packs } = await pool.decodeBuffer(owned, {
        output: "gpuTextureSet",
        ...packing,
    });
    return new WebTiffTextureSet({
        width: header.width,
        height: header.height,
        mode: header.mode,
        channelCount: header.channelCount,
        encodingVersion: header.encodingVersion,
        packs,
    });
}

/**
 * Register the `rawTiff` conversion edges.
 *
 * ### Read this before touching the cost arguments
 *
 * `converter.learn(from, to, fn, costPower, costMultiplier)` documents those two
 * numbers as an O() class and a multiplier, and computes the edge weight as
 *
 * ```js
 * costMultiplier = Math.min(Math.max(costMultiplier, 1), 10 ^ 5);   // clamp is 15, not 100000
 * graph.addEdge(from, to, costPower * 10 ^ 5 + costMultiplier, cb); // ((p+1)*10) ^ (5+m)
 * ```
 *
 * `^` is XOR, not exponentiation, and it binds looser than `+`. So the weight is
 * neither monotonic in either argument nor bounded the way the docs say, and a
 * plausible "make this expensive" value lands on **zero** — the cheapest edge in
 * the graph. `(1, 24)` weighs 0; that is what routed every WSI-Service TIFF tile
 * into an 8-bit canvas instead of a packed texture.
 *
 * The two weights below are measured, not reasoned:
 *
 * | edge | args | weight |
 * |---|---|---|
 * | `rawTiff → gpuTextureSet` | `(1, 8)` | 25 |
 * | `rawTiff → context2d` | `(3, 1)` | 46 |
 *
 * Dijkstra picks the cheapest *supported* target, and `FlexDrawer` supports both,
 * so the packed path must be the smaller number. Before changing either, compute
 * `((costPower + 1) * 10) ^ (5 + Math.min(costMultiplier, 15))` and check the
 * ordering — do not reason from the parameter names. (Reported upstream; when
 * OSD's arithmetic is fixed these become ordinary costs.)
 *
 * No `rawTiff → imageBitmap` edge: no drawer in this app lists `imageBitmap`
 * (`FlexDrawer` takes `gpuTextureSet`/`context2d`/…, `CanvasDrawer` only
 * `context2d`), so it would be an unreachable target and one more chance to
 * register a zero-weight shortcut by accident.
 *
 * @param {object} OpenSeadragon
 * @param {object} pool the decode pool from `decode-pool.mjs`
 * @param {object} [packing] `{packFlags, padAlpha}` for the decoder
 */
export function registerRawTiffConverters(OpenSeadragon, pool, packing = {}) {
    const converter = OpenSeadragon.converter;
    if (!converter) {
        console.warn("[webtiff] OpenSeadragon.converter is missing; load OSD v6+. " +
            "Tiles that arrive as TIFF bytes cannot be decoded.");
        return;
    }
    if (converter.__webtiffRawTiff) return;
    converter.__webtiffRawTiff = true;

    // Weight 25 — the path a WebGL drawer must take.
    converter.learn("rawTiff", "gpuTextureSet",
        (tile, data) => rawTiffToTextureSet(pool, packing, data), 1, 8);

    // Weight 46 — only for a drawer that cannot take packed textures at all.
    converter.learn("rawTiff", "context2d", async (tile, data) => {
        const set = await rawTiffToTextureSet(pool, packing, data);
        const image = textureSetToImageData(set);
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.putImageData(image, 0, 0);
        return context;
    }, 3, 1);
}
