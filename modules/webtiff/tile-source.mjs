/**
 * The xOpat tile source over the vendored web-tiff decoder.
 *
 * The bundle ships a tile source of its own, and it is the wrong one for xOpat:
 * it decodes every tile to 8-bit RGBA and hands OSD an `ImageBitmap`. That is
 * correct for a colour slide and lossy for everything this module exists for —
 * a 16-bit scalar plane, a float parametric map, a six-channel fluorescence
 * stack. The renderer wants those as a `gpuTextureSet`: packed RGBA16F layers
 * that carry their own normalization, which is exactly what the decoder can
 * produce natively.
 *
 * So this subclass keeps the bundle's level/geometry/lifecycle logic and
 * replaces one method — the tile download — with a per-drawer decision:
 *
 * | drawer accepts | decoder output | handed to OSD as |
 * |---|---|---|
 * | `gpuTextureSet` (FlexDrawer) | `gpuTextureSet` | `gpuTextureSet` |
 * | anything else (canvas fallback) | `rgba8` | `imageBitmap` |
 *
 * The decision is per tile because a viewer's drawer is not knowable at open
 * time; `textureSetToImageData` below is the shared flattening step, used by the
 * `rawTiff` fallback edge in `raw-tiff.mjs`.
 *
 * @module webtiff/tile-source
 */

import { makeTileSource } from "./dist/web-tiff.mjs";

/**
 * A decoded tile in the renderer's packed-texture form.
 *
 * Structural, not nominal: `FlexDrawer` validates the fields and only uses
 * `getType()` as a hint, so this stays a plain carrier. Field names are the
 * renderer's (`GpuTextureSetTileData`), not the decoder's.
 */
export class WebTiffTextureSet {
    constructor(properties) {
        Object.assign(this, properties);
    }

    getType() {
        return "gpuTextureSet";
    }
}

/*
 * The decoder declares what it presents.
 *
 * `header.channelCount` for an image-mode read is the number of lanes actually
 * emitted (four), not the source band count, as of web-tiff 0.1.0. Before that
 * it reported three for a colour slide while the packer filled the fourth lane
 * with `padAlpha`, and since the renderer bounds channel reads by that number —
 * `osd_channel` returns `0.0` for `channelIndex >= osd_channel_count(source)` —
 * the implicit `identity` layer sampled `vec4(r, g, b, 0.0)` and the slide
 * rendered fully transparent. This module carried a 3 -> 4 correction for it;
 * the decoder is the right place to state it, so the correction is gone.
 *
 * `textureSetToImageData` still fills pad lanes itself: that is a different
 * question (which lanes of a pack carry a channel at all), answered per lane
 * from `pack.channels`.
 */

/**
 * `readRegion` takes the resampler as the decoder's own enum, not by name.
 * 3 = box, the right filter for a downscale.
 */
const RESAMPLE_BOX = 3;

/**
 * Above this, the coarsest level is not an overview but the slide itself (a file
 * with no pyramid), and rendering a thumbnail from it means decoding everything.
 */
const MAX_THUMBNAIL_SOURCE_PIXELS = 32 * 1024 * 1024;

/**
 * Encode pixels as a PNG blob, off the DOM where the platform allows it.
 * @param {ImageData} image
 * @return {Promise<Blob>}
 */
async function imageDataToBlob(image) {
    if (typeof OffscreenCanvas === "function") {
        const canvas = new OffscreenCanvas(image.width, image.height);
        canvas.getContext("2d").putImageData(image, 0, 0);
        return canvas.convertToBlob({ type: "image/png" });
    }
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d").putImageData(image, 0, 0);
    return new Promise((resolve, reject) => canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error("[webtiff] thumbnail encoding failed"))),
        "image/png"));
}

/** IEEE half-float bits to a float. Only needed on the canvas fallback path. */
function halfToFloat(bits) {
    const sign = (bits & 0x8000) ? -1 : 1;
    const exponent = (bits >> 10) & 0x1f;
    const fraction = bits & 0x03ff;
    if (exponent === 0) return sign * Math.pow(2, -14) * (fraction / 1024);
    if (exponent === 0x1f) return fraction ? NaN : sign * Infinity;
    return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
}

/**
 * Flatten a packed texture set into 8-bit RGBA.
 *
 * Only the first pack is used: a drawer that cannot take a texture set cannot
 * composite several of them either, so beyond four channels this is a preview,
 * not a rendering. Values are already normalized to `[0,1]` by the decoder.
 *
 * @param {WebTiffTextureSet|object} data
 * @return {ImageData}
 */
export function textureSetToImageData(data) {
    const pack = data?.packs?.[0];
    if (!pack) throw new Error("[webtiff] texture set has no packs to flatten");

    const { width, height } = data;
    const pixels = width * height;
    const out = new Uint8ClampedArray(pixels * 4);

    if (pack.format === "RGBA8") {
        out.set(pack.data.subarray(0, pixels * 4));
    } else {
        for (let i = 0; i < pixels * 4; i++) {
            out[i] = Math.round(Math.min(1, Math.max(0, halfToFloat(pack.data[i]))) * 255);
        }
    }

    // A pack lane that carries no channel (`-1`) is padding, not black — most
    // visibly the alpha lane of a three-channel slide, which would render the
    // whole tile invisible.
    for (let lane = 0; lane < 4; lane++) {
        if (pack.channels?.[lane] >= 0) continue;
        const fill = lane === 3 ? 255 : 0;
        for (let i = 0; i < pixels; i++) out[i * 4 + lane] = fill;
    }

    // In `data` mode lane 3 is a measurement like any other — a stacked slide
    // packs channels 0…3 into one pack — and a canvas would draw the fourth
    // channel as opacity, making a dim channel erase the tile. Nothing here can
    // composite four channels anyway (only pack 0 is used), so the fourth is
    // dropped from the preview rather than allowed to control transparency.
    if (data.mode === "data" && pack.channels?.[3] >= 0) {
        for (let i = 0; i < pixels; i++) out[i * 4 + 3] = 255;
    }
    return new ImageData(out, width, height);
}

/*
 * No conversion edge *leaves* `gpuTextureSet`, deliberately.
 *
 * It is tempting to add `gpuTextureSet → imageBitmap` so a drawer that cannot
 * take packed textures still shows something. It backfires: OSD's `_convert`
 * rewrites the **shared managed cache record** in place (`this._type = …`) and
 * calls `converter.destroy` on the old payload, so one consumer asking for a
 * bitmap silently takes the packs away from the WebGL drawer that is still
 * drawing them — and nothing registers a `learnDestroy` for the GPU side, so the
 * textures are merely orphaned. The predecessor module kept `gpuTextureSet` a
 * graph sink for the same reason.
 *
 * Nothing needs those edges here: `FlexDrawer` accepts `gpuTextureSet` natively
 * and the navigator is a `FlexDrawer` too, while a canvas-only deployment never
 * receives one — `_outputFor` asks the drawer first and decodes to `rgba8` for
 * it (see below).
 */

/** Interpretations the decoder accepts, as an allowlist. */
const INTERPRETATIONS = ["auto", "image", "data"];

/** How the pyramid may be resolved. Same three values the decoder declares. */
const PYRAMID_STRATEGIES = ["auto", "ifd", "subifd"];

/** A channel list longer than this is not a selection, it is an attack. */
const MAX_CHANNEL_SELECTION = 64;

/**
 * A channel or plane index, or `undefined` for anything that is not one.
 *
 * Deliberately not `Number(value)`: that maps `null`, `[]` and `""` to `0`, which
 * is a *valid* index — so junk in a session would not be rejected, it would
 * silently select plane 0. Numeric strings are accepted because a session is
 * JSON-shaped and hand-authored.
 *
 * @param {unknown} value
 * @return {number|undefined}
 */
function indexOrUndefined(value) {
    if (typeof value === "string") {
        if (value.trim() === "") return undefined;
    } else if (typeof value !== "number") {
        return undefined;
    }
    const index = Number(value);
    return Number.isInteger(index) && index >= 0 ? index : undefined;
}

/**
 * Translate a slide's `options` block into the decoder's own option shape.
 *
 * The session supplies this (`data[i].options`, or the background entry's), so it
 * is untrusted by §7 and every value is validated against an allowlist rather
 * than forwarded. Anything unrecognised is dropped, not passed through: the
 * decoder's option object is also where the transport and packing preferences
 * live, and a session must not be able to reach those.
 *
 * Two of the four keys can only be honoured at construction time, because the
 * layout is resolved once when the header is parsed:
 *
 * | key | value | decoder | when |
 * |---|---|---|---|
 * | `planeIndex` | integer ≥ 0 | `layout.planeIndex` | construction |
 * | `pyramid` | `"auto"` \| `"ifd"` \| `"subifd"` | `layout.pyramid` | construction |
 * | `channels` | `number[]` \| `"all"` | `format.channels` | per read |
 * | `interpretation` | `"auto"` \| `"image"` \| `"data"` | `format.interpretation` | per read |
 *
 * `planeIndex` is how a slide opts *out* of channel stacking: unset, every
 * same-size directory is read as a channel of one tile; set, that one plane is
 * read and the rest are dropped. So `planeIndex: 0` is not a no-op — on a
 * five-channel OME-TIFF it is the difference between five channels and one.
 * (The decoder's older `layout.prefer` is gone: a pyramid and a plane stack are
 * no longer alternatives, so a `layout` key in a session is dropped like any
 * other unknown.)
 *
 * `channels: "all"` maps to *no* selection, which is already the default. It is
 * accepted because that is WSI-Service's spelling of it (`image_channels=all`),
 * and a session that says so should mean the same thing whichever protocol ends
 * up serving the slide — not be silently inert on one of them.
 *
 * @param {object} [options] the slide's `SlideSourceOptions`
 * @return {{layout?: object, format?: object}} empty when nothing applies
 */
export function decoderOptionsFrom(options) {
    if (!options || typeof options !== "object") return {};

    const layout = {};
    const format = {};

    const plane = indexOrUndefined(options.planeIndex);
    if (plane !== undefined) layout.planeIndex = plane;
    if (PYRAMID_STRATEGIES.includes(options.pyramid)) layout.pyramid = options.pyramid;

    if (INTERPRETATIONS.includes(options.interpretation)) {
        format.interpretation = options.interpretation;
    }
    if (Array.isArray(options.channels)) {
        const channels = options.channels
            .map(indexOrUndefined)
            .filter(c => c !== undefined)
            .slice(0, MAX_CHANNEL_SELECTION);
        if (channels.length) format.channels = channels;
    }

    const result = {};
    if (Object.keys(layout).length) result.layout = layout;
    if (Object.keys(format).length) result.format = format;
    return result;
}

/**
 * The subset of {@link decoderOptionsFrom} that a tile read can still honour
 * once the file is open. `undefined` when there is nothing to override.
 *
 * @param {{format?: object}} decoderOptions
 * @return {object|undefined}
 */
function readOverridesFrom(decoderOptions) {
    const format = decoderOptions.format;
    if (!format) return undefined;
    const overrides = {};
    if (format.channels) overrides.channels = format.channels;
    if (format.interpretation) overrides.interpretation = format.interpretation;
    return Object.keys(overrides).length ? overrides : undefined;
}

/**
 * Build the xOpat tile-source class.
 *
 * @param {object} OpenSeadragon
 * @param {object} defaults options every instance starts from — notably the
 *      `pool` that routes reads through `HttpClient` (see `decode-pool.mjs`)
 * @return {function} the tile-source constructor, also installed as
 *      `OpenSeadragon.WebTiffTileSource`
 */
export function installWebTiffTileSource(OpenSeadragon, defaults = {}) {
    if (OpenSeadragon.WebTiffTileSource?.xopatWebTiff) {
        return OpenSeadragon.WebTiffTileSource;
    }

    // `makeTileSource`, not `enableWebTiff`: the latter memoizes its result on
    // the namespace, so a second call would hand back *our* class and subclass it
    // again on the next module load.
    const Base = makeTileSource(OpenSeadragon, defaults);

    class WebTiffTileSource extends Base {
        /**
         * The registry may construct this class directly (`tileSourceClass`),
         * which is only safe because the base never re-enters `determineType`:
         * its `getImageInfo` is a no-op and the header read is its own.
         */
        static xopatSelfConfiguring = true;

        /** Marks the class as already wrapped; see the guard above. */
        static xopatWebTiff = true;

        // Deliberately no `_dataFormat`: which OSD data type a tile arrives as
        // depends on the drawer that asked for it (see `_outputFor`), and the
        // core reads that field as a single, fixed answer.

        // `_decoderLevel` is the base class's own (web-tiff >= 0.1.0): every site
        // that indexes the decoder's level array measures from the finest end, so
        // a synthetic preview level inserted by `src/classes/preview-level.ts`
        // cannot silently change which level is read. This module only calls it,
        // from its own `downloadTileStart` override below.

        /**
         * The decoder's own description of the file.
         *
         * Throws before the header is parsed rather than guessing, which is the
         * contract `tiff-metadata.mjs` reads it under: a throw means "not known
         * yet", never "an 8-bit RGB slide".
         *
         * @return {object} width, height, channel layout and sample encoding
         */
        getTiffDescriptor() {
            if (!this._file) {
                throw new Error("[webtiff] getTiffDescriptor() is unavailable until the header is " +
                    "parsed; await tileSource.promises.ready.promise first.");
            }
            return this._file.descriptor;
        }

        /**
         * The narrower contract other TIFF-carrying sources implement too
         * (`TiffSampleEncoding`), so a consumer can read sample semantics
         * without knowing which decoder produced them.
         * @return {object|undefined}
         */
        getSampleEncoding() {
            return this._file?.descriptor?.encoding;
        }

        /** @return {object|undefined} the underlying `TiffFile`, once ready. */
        getTiffFile() {
            return this._file || undefined;
        }

        /**
         * Whether 8 bits per channel carry this file without loss. The renderer
         * only acts on it when the deployment allows a half-float target
         * (`webGlPrecision: "auto"`), but the answer is the file's either way.
         * @return {"unorm8"|"float16"|undefined}
         */
        getPrecision() {
            try {
                return this._file?.precision();
            } catch (e) {
                return undefined;
            }
        }

        /**
         * The same answer under the core tile-source contract name
         * (`src/tile-source.ts`), so generic consumers do not have to know that
         * a TIFF decoder produced it. The synthetic preview level reads this:
         * its tile is an 8-bit raster and must not stand in for half-float packs.
         * @return {"unorm8"|"float16"|undefined}
         */
        getTilePrecision() {
            return this.getPrecision();
        }

        /** @return {string[]} whatever the layout resolution complained about. */
        getWarnings() {
            return (this._file?.warnings || []).concat(this._optionWarnings || []);
        }

        /**
         * The per-slide `options` block, applied after the fact.
         *
         * The core calls this twice for a source it built through the registry —
         * once before the metadata request and once after the open
         * (`slide-protocols.ts:615`, `viewer-open-pipeline.ts:1172`), deliberately
         * with the same object, so that a selection needing metadata can expand on
         * the second pass. This source is not on that schedule: its header read
         * starts in its own constructor, so by the time the first call arrives the
         * layout is usually already resolved.
         *
         * That splits the options in two. `channels` and `interpretation` are read
         * parameters and are honoured from the next tile on. `planeIndex` and
         * `pyramid` chose the level pyramid and cannot be re-decided
         * without re-reading the header — so those are passed at construction
         * (`index.mjs` resolves them through the same {@link decoderOptionsFrom}
         * and keys its source cache by them), and arriving late is reported rather
         * than quietly ignored.
         *
         * @param {object} [options] the slide's `SlideSourceOptions`
         */
        setSourceOptions(options) {
            const decoderOptions = decoderOptionsFrom(options);
            this._readOverrides = readOverridesFrom(decoderOptions);

            const layout = decoderOptions.layout;
            if (!layout) return;

            // Compare against what the file was actually built with, not against
            // the defaults: the common case by far is the core re-applying the very
            // options `index.mjs` already constructed this source from, and that
            // must stay silent.
            const applied = this._options?.layout || {};
            const late = Object.keys(layout).filter(key => layout[key] !== applied[key]);
            if (!late.length || !this._file) return;

            const message = `[webtiff] ${late.join(", ")} arrived after the header was read and ` +
                "cannot change the level pyramid; set it on the slide's data entry so it applies " +
                "when the source is built";
            this._optionWarnings = (this._optionWarnings || []).concat(message);
            console.warn(message);
        }

        /**
         * A whole-slide preview, rendered from the coarsest pyramid level.
         *
         * The core only uses it where a flat RGB picture is the right answer —
         * `osd_tools` takes it for a slide-list card *unless* the background
         * resolves to a channel-aware shader configuration, in which case the
         * real pyramid is previewed instead. So this may flatten a multi-channel
         * slide without lying to anyone.
         *
         * @param {object} [options]
         * @param {number} [options.targetWidth=512] longest edge to aim for
         * @return {Promise<Blob|undefined>}
         */
        async getThumbnail({ targetWidth = 512 } = {}) {
            const level = this._file?.levels?.[0];
            if (!level) return undefined;
            // A file with no pyramid has the slide itself as its coarsest level;
            // decoding gigapixels for a card is not a preview, it is an outage.
            if (level.width * level.height > MAX_THUMBNAIL_SOURCE_PIXELS) return undefined;

            const scale = Math.min(1, targetWidth / Math.max(level.width, level.height));
            const { header, packs } = await this._file.readRegion({
                dir: level.dir,
                subifd: level.subifd,
                // Without this the card is plane 0 of a plane stack — a grey
                // DAPI frame for a five-channel slide. With it, `rgba8` answers
                // the first three channels with an opaque alpha lane, which is
                // the flat picture this method is for.
                planes: level.planes,
                x0: 0,
                y0: 0,
                x1: level.width,
                y1: level.height,
                outWidth: Math.max(1, Math.round(level.width * scale)),
                outHeight: Math.max(1, Math.round(level.height * scale)),
                output: "rgba8",
                resample: RESAMPLE_BOX,
            });

            // Through the shared flattener rather than wrapping `packs[0]`: the
            // lane rules (padding is not black, a data lane is not opacity) then
            // live in one place for every canvas-bound path.
            return imageDataToBlob(textureSetToImageData({
                width: header.width,
                height: header.height,
                mode: header.mode,
                packs,
            }));
        }

        /**
         * Rows for the slide-info panel. Read from the decoder rather than from
         * the tags, so what is shown is what will be rendered.
         * @return {object[]}
         */
        getDisplayMetadata() {
            if (!this._file) return [];
            // Keys live in this module's own locale bundle, loaded under the
            // module id (`index.mjs` → `loadElementLocale`). No English literals:
            // `$.t` always returns a string, so a fallback would be dead code and
            // a missing key is fixed in `locales/en.json`, not here.
            const t = (key) => $.t(`webtiff.${key}`);
            const descriptor = this._file.descriptor;
            const fields = [
                { label: t("dimensions"), value: `${this.width} × ${this.height} px` },
                { label: t("tileSize"), value: `${this.getTileWidth(this.maxLevel)} × ${this.getTileHeight(this.maxLevel)} px` },
                { label: t("levels"), value: String(this.levels?.length ?? 1) },
                { label: t("channels"), value: String(descriptor.samplesPerPixel) },
                { label: t("bitDepth"), value: `${[].concat(descriptor.bitsPerSample ?? 8).join(", ")} bit` },
                { label: t("interpretation"), value: String(descriptor.interpretationResolved) },
                { label: t("layout"), value: String(this._file.layout ?? "single") },
            ];
            return [{ title: t("title"), fields }];
        }

        /**
         * Which decoder output this tile should be asked for.
         *
         * The drawer answers it: a packed texture set is worth nothing to a
         * drawer that cannot upload one, and 8-bit RGBA throws away precision
         * for one that can.
         *
         * @param {object} tile
         * @return {"gpuTextureSet"|"rgba8"}
         */
        _outputFor(tile) {
            try {
                const formats = tile?.tiledImage?.getDrawer?.()?.getSupportedDataFormats?.();
                if (Array.isArray(formats)) {
                    return formats.includes("gpuTextureSet") ? "gpuTextureSet" : "rgba8";
                }
            } catch (e) {
                // A tile with no tiled image yet — fall through to the safe answer.
            }
            return "rgba8";
        }

        downloadTileStart(context) {
            if (!this._file) {
                // The owning cache closed this slide (see `closeFile`) while
                // something still held the source. Fail the tile rather than
                // throwing out of the loader, where nothing reports it.
                context.fail("[webtiff] the slide handle was closed", null);
                return;
            }

            const controller = new AbortController();
            context.userData.abortController = controller;

            const tile = context.tile;
            const output = this._outputFor(tile);
            const started = this._options?.logLatency ? performance.now() : 0;

            this._file.readTile(this._decoderLevel(tile.level), tile.x, tile.y, {
                // Channel selection and interpretation, when the slide asked for
                // either; the decoder falls back to the file's own options for
                // whatever is absent (see `setSourceOptions`).
                ...this._readOverrides,
                output,
                signal: controller.signal,
            }).then(async ({ header, packs }) => {
                if (controller.signal.aborted) return;
                if (this._options?.logLatency) {
                    this._options.logLatency("tile", performance.now() - started);
                }

                if (output === "gpuTextureSet") {
                    context.finish(new WebTiffTextureSet({
                        width: header.width,
                        height: header.height,
                        mode: header.mode,
                        channelCount: header.channelCount,
                        encodingVersion: header.encodingVersion,
                        encoding: this._file.descriptor.encoding,
                        packs,
                    }), `${context.src}`, "gpuTextureSet");
                    return;
                }

                // Wrapped, not flattened: an `rgba8` read is always resolved as
                // an image by the decoder — three channels and a padded alpha
                // lane even over a plane stack — so there is no lane to correct
                // here, and a tile is too hot a path to copy for nothing.
                const image = new ImageData(
                    new Uint8ClampedArray(packs[0].data.buffer), header.width, header.height);
                context.finish(await createImageBitmap(image), `${context.src}`, "imageBitmap");
            }).catch((e) => {
                if (e?.name === "AbortError" || controller.signal.aborted) return;
                context.fail(e?.message || String(e), e);
            });
        }

        /**
         * Deliberately not closing the file.
         *
         * `TiledImage.destroy()` calls this on every slide close, and the module
         * reuses one source per URL across opens — closing here would throw away
         * the parsed header, the level pyramid and every cached block, making a
         * return to a slide as expensive as the first open. The module's own LRU
         * owns the decoder handle and calls {@link closeFile}.
         */
        destroy() {
        }

        /** Release the decoder handle for real. Only the owning cache calls this. */
        closeFile() {
            this._file?.close();
            this._file = null;
            this._ready = false;
            this.ready = false;
        }
    }

    OpenSeadragon.WebTiffTileSource = WebTiffTileSource;
    return WebTiffTileSource;
}
