/**
 * Vector layers for the visualization-flexibility demo.
 *
 * Registers ONE slide protocol, `demo-mvt`, which opens a Mapbox-Vector-Tile
 * pyramid over a pathology slide's own pixel space.
 *
 * ## Why this module exists at all
 *
 * `flex-renderer` already ships both vector tile sources — `$.MVTTileSource` and
 * `$.GeoJSONTileSource` — and both are reachable by OpenSeadragon's ordinary
 * autodetection, because `TileSource.determineType` calls `supports` on the
 * *prototype* and never instantiates a candidate. So a plain URL protocol
 * pointing at a descriptor is enough for GeoJSON, and this module deliberately
 * does not wrap it: `$.GeoJSONTileSource.configure` already passes an explicit
 * `width`/`height` through, so the layer lands on the slide with no help.
 *
 * MVT needs one thing TileJSON cannot say: which tiles exist. The geometry is
 * no longer the problem — `MVTTileSource.configure` honours a declared
 * `width`/`height` (the demo slide is 105185 x 221772, not square) and the TMS
 * row flip uses the level's real row count — and this source reuses that
 * `configure` for everything it reads from the descriptor.
 *
 * The generator (`test/harness/data/derive.mjs`) writes only tiles that carry
 * geometry — 1981 of the ~119 000 the zoom range implies. TileJSON assumes a
 * dense pyramid, so every other tile is requested and 404s. That is not "empty
 * here": the client cannot distinguish a missing tile from a broken server, and
 * `ViewerFaultySourceRegistry` rightly marks a source faulty once enough of its
 * tiles fail. Rather than teach the client to swallow 404s, the descriptor
 * *declares* the sparse layout in `tileIndex` and this source turns it into a
 * `tileExists` predicate, so the absent tiles are never asked for and a 404
 * stays an error.
 *
 * A generic `tileIndex` option on the library's MVT source is requested in
 * `UPSTREAM.md`; this module goes away when it lands.
 *
 * @module demo-vector-layers
 */

const MODULE_ID = "demo-vector-layers";
const meta = (key, fallback) => {
    const value = window.moduleMeta?.(MODULE_ID, key);
    return value === undefined ? fallback : value;
};

window.loadElementLocale?.("modules", MODULE_ID);

const PROTOCOL_ID = meta("protocolId", "demo-mvt");
const BASE_URL = meta("protocolBaseUrl", "");

/**
 * Join a data id onto the configured base. An absolute id is used as-is, so a
 * session can point at another origin without a second protocol entry.
 */
function descriptorUrlFor(dataID) {
    const id = String(dataID ?? "");
    if (/^https?:\/\//i.test(id) || !BASE_URL) return id;
    return `${BASE_URL.replace(/\/+$/, "")}/${id.replace(/^\/+/, "")}`;
}

/**
 * A TileJSON-ish descriptor extended with the two fields TileJSON cannot carry.
 *
 * @typedef {object} DemoMvtDescriptor
 * @property {string[]} tiles      tile URL templates, resolved against the descriptor
 * @property {number} width        world width in slide pixels
 * @property {number} height       world height in slide pixels
 * @property {number} [tileSize=512]
 * @property {number} [extent=4096] tile-internal coordinate extent
 * @property {number} [minzoom=0]
 * @property {number} [maxzoom]
 * @property {string} [scheme="xyz"]
 * @property {object} [style]      flex-renderer layer style map
 * @property {DemoMvtTileIndex} [tileIndex] which tiles exist, for a sparse pyramid
 */

/**
 * Sparse-pyramid declaration. TileJSON has no equivalent — it assumes every tile
 * in the zoom range exists — so a pyramid that only stores tiles carrying
 * geometry can otherwise be discovered only by requesting one and getting a 404.
 * That is a real failure (the client cannot tell "nothing here" from "server
 * broke"), and enough of them mark the whole source faulty. Declaring the layout
 * means the absent tiles are never requested.
 *
 * @typedef {object} DemoMvtTileIndex
 * @property {"bitmask-base64-rowmajor"} encoding
 * @property {{across: number, down: number, bits: string}[]} levels indexed by zoom
 */

/**
 * Decode `tileIndex` into per-level byte arrays, or `null` if it is absent or
 * malformed. Treated as untrusted input: a descriptor is remote data, and a bad
 * index must degrade to "ask the server" rather than hide real tiles.
 *
 * @param {DemoMvtTileIndex} [tileIndex]
 * @returns {?Array<{across: number, down: number, bits: Uint8Array}>}
 */
export function decodeTileIndex(tileIndex) {
    if (!tileIndex || tileIndex.encoding !== "bitmask-base64-rowmajor") return null;
    if (!Array.isArray(tileIndex.levels) || !tileIndex.levels.length) return null;

    const levels = [];
    for (const level of tileIndex.levels) {
        const across = Number(level?.across);
        const down = Number(level?.down);
        if (!Number.isInteger(across) || !Number.isInteger(down) || across <= 0 || down <= 0) {
            return null;
        }

        let bytes;
        try {
            const raw = atob(String(level.bits ?? ""));
            bytes = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        } catch (e) {
            return null;
        }
        if (bytes.length < Math.ceil((across * down) / 8)) return null;

        levels.push({ across, down, bits: bytes });
    }
    return levels;
}

/**
 * Test one tile against a decoded index. A level the index does not describe is
 * treated as dense — an index that stops short must not hide tiles it says
 * nothing about.
 *
 * @param {?Array<{across: number, down: number, bits: Uint8Array}>} levels
 * @param {number} level
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function tileIndexHas(levels, level, x, y) {
    if (!levels) return true;

    const meta = levels[level];
    if (!meta) return true;
    if (x < 0 || y < 0 || x >= meta.across || y >= meta.down) return false;

    const bit = y * meta.across + x;
    return (meta.bits[bit >> 3] & (1 << (7 - (bit & 7)))) !== 0;
}

/**
 * MVT source that honours the descriptor's sparse-tile declaration.
 *
 * Self-configuring in the sense of `src/tile-source.ts`: it fetches its own
 * descriptor from `getImageInfo` and configures `this` in place, rather than
 * going through OpenSeadragon's autodetect. It has to — `getImageInfo`'s
 * autodetect path builds the class that `determineType` picked and calls *that*
 * class's `configure`, so a subclass override would simply be bypassed.
 */
function defineTileSource(OpenSeadragon) {
    return class DemoMvtTileSource extends OpenSeadragon.MVTTileSource {
        /**
         * @param {object} options
         * @param {string} options.url descriptor URL
         * @param {object} [options.httpClient] xOpat `HttpClient` for the fetch
         */
        constructor(options) {
            // `_isVector: false` suppresses the base class's worker spin-up: the
            // pipeline needs a tile template, which only the descriptor knows.
            // `ready: false` with a `url` sends the base constructor down the
            // `getImageInfo` branch, i.e. into the override below.
            super({ ...options, _isVector: false, ready: false });
            this.__httpClient = options.httpClient || null;
            this._pipelineReady = false;
            // Vector meshes are not an 8-bit raster and there is no thumbnail to
            // stand in for one. Already true by omission — no `getThumbnail()`
            // means the synthetic preview level declines (`preview-level.ts`) —
            // but stated so a future reader does not add one by accident.
            this.__noPreviewLevel = true;
        }

        /**
         * Fetch the descriptor and configure in place.
         *
         * Overrides OpenSeadragon's version wholesale rather than supplying a
         * `configure()`: the base implementation re-runs `determineType` on the
         * response and would build a stock `MVTTileSource`, losing `tileExists`.
         */
        async getImageInfo(url) {
            try {
                const descriptor = await this.__fetchDescriptor(url);

                const width = Number(descriptor.width);
                const height = Number(descriptor.height);
                if (!(width > 0) || !(height > 0)) {
                    throw new Error(`descriptor at ${url} declares no usable width/height ` +
                        "— without them the world would fall back to a square, which is the " +
                        "whole reason this protocol exists");
                }

                // The library's TileJSON reading: template resolution, tile size,
                // zoom range, and the declared (non-square) world.
                const geometry = OpenSeadragon.MVTTileSource.prototype.configure.call(this, descriptor, url);

                this.width = geometry.width;
                this.height = geometry.height;
                this.tileSize = geometry.tileSize;
                this.minLevel = geometry.minLevel;
                this.maxLevel = geometry.maxLevel;
                this.tileOverlap = 0;
                this.tileSourceId = url;
                this.__tileIndex = decodeTileIndex(descriptor.tileIndex);

                this._initVectorPipeline({
                    template: geometry.template,
                    scheme: geometry.scheme,
                    extent: geometry.extent,
                    style: geometry.style,
                    useNativeLines: geometry.useNativeLines,
                    httpAdapter: null,
                });
                this._pipelineReady = true;

                // The base `ready` handler (registered first, at priority
                // Infinity) derives `_tileWidth`/`aspectRatio`/`dimensions` from
                // the fields just set and flips `ready`.
                this.raiseEvent("ready", { tileSource: this });
            } catch (e) {
                this.raiseEvent("open-failed", {
                    message: `[${MODULE_ID}] ${e?.message || e}`,
                    source: url,
                });
            }
        }

        /**
         * Descriptor fetch. Routed through the per-source `HttpClient` the slide
         * protocol handed us, so proxy aliases, CSRF and auth apply exactly as
         * they do to every other upstream read.
         */
        async __fetchDescriptor(url) {
            // `SLIDE_PROTOCOLS._clientFor` only builds a client when the protocol
            // entry declares `proxy` or `baseURL`; this one declares neither, so
            // `ctx.httpClient` is normally undefined and the core singleton is
            // the right transport (same `options.httpClient || APPLICATION_CONTEXT.httpClient`
            // idiom the core uses). Never a bare `fetch` — that would bypass
            // CSRF, auth and proxy policy (AGENTS.md s0.3).
            const client = this.__httpClient
                || this.__xopatHttpClient
                || window.APPLICATION_CONTEXT?.httpClient;
            if (!client) {
                throw new Error("no HttpClient available for the descriptor fetch");
            }
            // `request()` accepts an absolute URL, applies the client's auth and
            // proxy policy, and returns the parsed body — not a Response wrapper.
            const body = await client.request(url, { method: "GET", expect: "json" });
            return typeof body === "string" ? JSON.parse(body) : body;
        }

        /**
         * Honour the descriptor's sparse-tile declaration.
         *
         * OpenSeadragon consults this in `TiledImage._getTile` before a tile is
         * ever scheduled, so a declared-absent tile costs no request and cannot
         * fail. Without it the 404s are counted by `ViewerFaultySourceRegistry`
         * and the source is eventually flagged faulty — correctly, because a 404
         * *is* an error; the descriptor is what makes the absence expected.
         *
         * No index means the pyramid is dense and the server is authoritative.
         */
        tileExists(level, x, y) {
            return super.tileExists(level, x, y) && tileIndexHas(this.__tileIndex, level, x, y);
        }

        /**
         * The base class assumes its constructor already stood the worker up.
         * Here the descriptor decides the template, so the first tile is the
         * earliest point at which the pipeline can exist.
         */
        downloadTileStart(context) {
            if (!this._pipelineReady) {
                context.fail(`[${MODULE_ID}] vector pipeline is not initialised yet`, null);
                return;
            }
            return super.downloadTileStart(context);
        }
    };
}

if (meta("registerSlideProtocol", true) && window.SLIDE_PROTOCOLS && window.OpenSeadragon) {
    if (!window.OpenSeadragon.MVTTileSource) {
        console.warn(`[${MODULE_ID}] OpenSeadragon.MVTTileSource is missing — flex-renderer is not ` +
            "loaded, so the `" + PROTOCOL_ID + "` protocol is not registered.");
    } else {
        const DemoMvtTileSource = defineTileSource(window.OpenSeadragon);
        try {
            window.SLIDE_PROTOCOLS.register({
                id: PROTOCOL_ID,
                label: "Vector tiles (MVT, demo)",
                createTileSource: (ctx) => new DemoMvtTileSource({
                    url: descriptorUrlFor(ctx.dataID),
                    httpClient: ctx.httpClient,
                }),
            });
        } catch (e) {
            console.warn(`[${MODULE_ID}] could not register the "${PROTOCOL_ID}" slide protocol: `,
                e?.message || e);
        }
    }
}
