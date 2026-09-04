import DicomQuery from './dicom-query.mjs';
import {
    buildGrayscaleLut,
    buildIdentityLut,
    canDeferVoiToShader,
    findTagDeep,
    isMonochrome,
} from './pixel-pipeline.mjs';
import { loadVendorScript } from './lazy-lib.mjs';
import { displayRotation } from './slide-orientation.mjs';

/**
 * Descriptor used when an instance's Image Pixel module could not be read at
 * all (a server that refuses WADO metadata). 8-bit RGB is the only assumption
 * that degrades gracefully for slide microscopy; it is applied explicitly and
 * logged, never silently.
 */
/**
 * Transfer syntaxes whose decoder performs the YCbCr -> RGB transform itself and
 * hands back RGB samples: baseline / extended / lossless JPEG and JPEG 2000.
 *
 * This distinction is load-bearing. The dataset still declares `YBR_*` for these
 * frames, so forwarding that value to the loader would make it convert a second
 * time and shift every colour. RLE and native uncompressed frames are absent
 * from the list on purpose — those really do arrive in the stored colour space.
 */
/** JPEG Baseline (8-bit) — the only codec every browser decodes natively. */
const JPEG_BASELINE_TS = "1.2.840.10008.1.2.4.50";

/* ----------------------------- Frame batching ----------------------------- */

/**
 * Rough size a batched multipart response aims for. Batches are sized by dividing
 * this by the observed mean frame size, so a pyramid of small frames batches wide
 * and one of large frames stays narrow. Not a hard limit — one frame can exceed it.
 */
const DICOM_BATCH_TARGET_BYTES = 1 << 20;   // ~1 MB

/** Batch width before any frame has been measured. */
const DICOM_BATCH_DEFAULT_JOBS = 8;
/** Below this a batch is not worth the coupling; above it, one failure costs too much. */
const DICOM_BATCH_MIN_JOBS = 2;
const DICOM_BATCH_MAX_JOBS = 16;

/**
 * How long a bucket accumulates tile jobs before it is flushed (OSD default 5).
 * Wide enough for the draw loop — which contributes `maxTilesPerFrame` (4) tiles
 * per frame — to fill a batch across a couple of frames; short enough to stay
 * under a frame budget and invisible to the user.
 */
const DICOM_BATCH_TIMEOUT_MS = 12;

/**
 * Deadline for a frame request. Matches OpenSeadragon's own `timeout` default so
 * a tile behaves the same batched or not; it exists because supplying an abort
 * signal to `HttpClient.fetchRaw` opts out of the client's timeout.
 */
const DICOM_FRAME_TIMEOUT_MS = 30000;

/**
 * Drop an encapsulated pixel-data item header, `(FFFE,E000)` plus its 4-byte
 * length, so what remains is the bare codec bitstream. Servers differ on whether
 * they include it; both decoders below need it gone.
 */
/**
 * Scratch canvas handed to `decodeImageFrame`. Only its main-thread baseline-JPEG
 * branch ever draws into it, and that branch is now unreachable (see
 * `_canDecodeNatively`) — but the argument is not optional, so one shared element
 * stands in for the per-tile allocation this used to make.
 */
let _decodeCanvas = null;
function decodeCanvas() {
    if (!_decodeCanvas) _decodeCanvas = document.createElement("canvas");
    return _decodeCanvas;
}

export function stripItemTag(bytes) {
    const hasItemTag = bytes.length > 8 &&
        bytes[0] === 0xFE && bytes[1] === 0xFF && bytes[2] === 0x00 && bytes[3] === 0xE0;
    return hasItemTag ? bytes.subarray(8) : bytes;
}

const CODEC_CONVERTS_COLOUR = new Set([
    JPEG_BASELINE_TS,           // JPEG Baseline (8-bit)
    "1.2.840.10008.1.2.4.51",   // JPEG Extended
    "1.2.840.10008.1.2.4.57",   // JPEG Lossless, non-hierarchical
    "1.2.840.10008.1.2.4.70",   // JPEG Lossless, first-order prediction
    "1.2.840.10008.1.2.4.90",   // JPEG 2000 lossless
    "1.2.840.10008.1.2.4.91",   // JPEG 2000 lossy
]);

/** Native (unencapsulated) transfer syntaxes. */
export const UNCOMPRESSED_TS = new Set([
    "1.2.840.10008.1.2",        // Implicit VR Little Endian
    "1.2.840.10008.1.2.1",      // Explicit VR Little Endian
    "1.2.840.10008.1.2.1.99",   // Deflated Explicit VR Little Endian
    "1.2.840.10008.1.2.2",      // Explicit VR Big Endian
]);

const FALLBACK_PIXEL = Object.freeze({
    samplesPerPixel: 3,
    photometricInterpretation: "RGB",
    planarConfiguration: 0,
    bitsAllocated: 8,
    bitsStored: 8,
    highBit: 7,
    pixelRepresentation: 0,
    numberOfFrames: 1,
});

// tileSource.mjs — dynamic multi‑instance DICOMweb TileSource for xOpat/OSD
// - Builds on the working shared implementation, adding:
//   • dynamic instance resolution (no hardcoded SOPInstanceUID)
//   • merges multi‑instance pyramids (levels may live in different instances)
//   • detects preview/overview (thumbnail) and label/macro images
//   • keeps per‑level instance ownership + per‑tile frame mapping
//   • adds downloadPreviewImage() and downloadMacroImage() helpers
// - Tested against Google Cloud Healthcare + Orthanc DICOMweb
// - Still honors partial, not‑yet‑published OSD TileSource init flow in v3
export class DICOMWebTileSource extends OpenSeadragon.TileSource {
    constructor(options) {
        // OSD expects a URL and will call getImageInfo; we proxy to _initializeFromServer.
        options.url = options.baseUrl || "localhost";
        options.baseUrl = options.baseUrl?.replace(/\/+$/, "");
        options.ready = !!options.wsi;
        super(options);

        // HttpClient owns auth (JWT injection, 401-refresh, CSRF, proxy routing).
        // The slide-protocol registry stamps the same client on `__xopatHttpClient`
        // for OSD's metadata-fetch path. When `options.client` is absent (e.g. a
        // standalone construction without going through SLIDE_PROTOCOLS), the
        // legacy bare-fetch branches below preserve today's behavior.
        this.client = options.client || null;
        this.ajaxHeaders = this.ajaxHeaders || {};

        this.frameOrder = options.frameOrder || null;
        this.frameOrderBySeries = options.frameOrderBySeries || null;
        this.frameOrderByInstance = options.frameOrderByInstance || null;
        this._hasWarnedFrameMismatch = false;

        // Cornerstone is NOT initialized here. It is loaded and configured by
        // `_ensureCornerstone()` on the first frame the browser cannot decode
        // itself — see `_decodeFrameRaw`. Constructing a tile source must not
        // cost 1.36 MB of vendored decoder for a pyramid that may never need it.
    }

    /**
     * Stable identifier scoped to this slide's DICOM identity. Used by
     * subsystems (e.g. the ICC profile module) that need to cache per-source
     * state. `options.url` is the DICOMweb base URL and is shared across all
     * slides served by the same endpoint, so it cannot be used as an identity
     * key — it produces silent collisions where slide A's cached state is
     * served to slide B.
     */
    get tileSourceId() {
        if (!this.studyUID || !this.seriesUID) return null;
        return `dicom:${this.baseUrl}#${this.studyUID}/${this.seriesUID}`;
    }

    /**
     * Fetch + configure the Cornerstone WADO loader, once, on first use.
     *
     * It used to be an eager `includes` entry: 1.36 MB parsed at boot in every
     * session, DICOM or not, plus a 1.24 MB worker bundle loaded into the page
     * that only the worker ever needed (it fetches its own URL). Neither is on
     * the path to a first tile — and for a baseline-JPEG pyramid neither is on
     * any path at all.
     */
    static _ensureCornerstone() {
        if (DICOMWebTileSource._cwilInitialized) return Promise.resolve();

        DICOMWebTileSource._cwilReady ??= loadVendorScript(
            "cornerstoneWADOImageLoader",
            new URL('./dist/cornerstoneWADOImageLoader.bundle.min.js', import.meta.url).href,
        ).then(() => {
            DICOMWebTileSource._initializeCornerstoneLoader();
        }).catch((e) => {
            // Let the next tile retry rather than latching the codec off.
            DICOMWebTileSource._cwilReady = null;
            throw e;
        });

        return DICOMWebTileSource._cwilReady;
    }

    /** Static: configures the library, reads no instance state. */
    static _initializeCornerstoneLoader() {
        if (typeof cornerstoneWADOImageLoader === 'undefined' || DICOMWebTileSource._cwilInitialized) return;

        // 1. Manually link a dummy/core object if 'cornerstone' isn't global
        // WADO Loader 1.4.x often checks 'cornerstone.enabled' or internal config
        if (typeof cornerstone !== 'undefined') {
            cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
        }

        // 2. Force the internal config to have an 'enabled' state
        cornerstoneWADOImageLoader.configure({
            useWebWorkers: true,
            decodeConfig: {
                usePDFJS: false,
            }
        });

        // 3. Worker path. `new Worker()` resolves a bare relative specifier against
        // the *document* URL, not this module — which used to point at a
        // non-existent `/dist/...` at the site root and left the whole worker pool
        // dead. Everything that is not baseline-JPEG colour (J2K 4.90/4.91,
        // JPEG-LS, RLE, lossless JPEG) is decoded there, so this must resolve
        // against the plugin folder. The WASM codecs are loaded by the worker via
        // `locateFile` relative to its own URL, hence they live next to it in
        // `dist/` (openjpegwasm_decode.wasm, charlswasm_decode.wasm,
        // libjpegturbowasm_decode.wasm).
        const workerPath = new URL('./dist/index.worker.bundle.min.worker.js', import.meta.url).href;
        cornerstoneWADOImageLoader.webWorkerManager.initialize({
            // Each worker pulls a ~1.2 MB bundle plus its WASM codecs; one per
            // hardware thread is a large fixed cost for no extra throughput.
            maxWebWorkers: Math.min(navigator.hardwareConcurrency || 4, 4),
            startWebWorkersOnDemand: true,
            webWorkerPath: workerPath,
            taskConfiguration: {
                'decodeTask': {
                    loadCodecsOnStartup: true,
                    // Instantiate a codec when a frame actually needs it, rather
                    // than compiling every WASM module in every worker up front.
                    initializeCodecsOnStartup: false,
                    usePDFJS: false,
                    strict: false
                }
            }
        });

        DICOMWebTileSource._cwilInitialized = true;
    }

    supports(data) { return data && data.type === "dicomweb"; }

    _acceptHeader(useRendered = this.useRendered, preferPng = false) {
        if (useRendered) {
            // The /rendered endpoint on standards-conformant DICOMweb servers
            // (including Google Cloud Healthcare) returns a single-part image
            // and rejects `multipart/related` with HTTP 406. Send a simple
            // image accept header; _downloadImage handles the response as
            // either a raw image blob or a multipart envelope, so either
            // server contract continues to work.
            return preferPng
                ? 'image/png, image/jpeg;q=0.9'
                : 'image/jpeg, image/png;q=0.9';
        }

        // Baseline JPEG is the one codec the browser decodes itself, off the main
        // thread and with no pixel readback (see `_canDecodeNatively`). J2K has to
        // go through a WASM worker. Fidelity wins by default — 4.90 is lossless,
        // and asking for baseline invites the server to transcode — but a
        // deployment that would rather have the speed can flip the preference.
        const codecs = this.preferBaselineJpeg
            ? ['1.2.840.10008.1.2.4.50', '1.2.840.10008.1.2.4.90', '1.2.840.10008.1.2.4.91']
            : ['1.2.840.10008.1.2.4.90', '1.2.840.10008.1.2.4.91'];

        return [
            ...codecs.map(ts => `multipart/related; type="application/octet-stream"; transfer-syntax=${ts}`),
            'multipart/related; type="application/octet-stream"; transfer-syntax=*'
        ].join(', ');
    }

    // Multipart parsing lives in DicomTools (shared with the listing
    // thumbnail path); these instance methods are kept as thin delegates.
    indexOfBytes(hay, needle, from = 0) {
        return DicomQuery.indexOfBytes(hay, needle, from);
    }

    async parseMultipartRelated(res) {
        return DicomQuery.parseMultipartRelated(res);
    }

    /* -------------------------- OSD integration -------------------------- */
    getImageInfo(url) {
        this._initializeFromServer()
            .then(() => {
                this.dimensions = new OpenSeadragon.Point(this.width, this.height);
                this.aspectRatio = this.width / this.height;
                this.ready = true;
                this.raiseEvent("ready", { tileSource: this });
            })
            .catch((e) => {
                console.error("Failed to initialize DICOM Web TileSource!", e);
                this.raiseEvent("open-failed", { message: e, source: url, postData: null });
            });
    }

    async _initializeFromServer() {
        if (!this.seriesUID || !this.studyUID) {
            throw new Error('DICOM TileSource needs seriesUID and studyUID to be set before initialization!');
        }
        if (!this.client) {
            throw new Error('DICOM TileSource needs an HttpClient (options.client) to initialize.');
        }

        const wsiList = await DicomQuery.findWSIItems(
            this.client,
            this.studyUID,
            this.seriesUID,
            {
                frameOrder: this.frameOrder,
                frameOrderBySeries: this.frameOrderBySeries,
                frameOrderByInstance: this.frameOrderByInstance,
                // Only one group survives the ranking below, so only one group's
                // metadata is worth a round trip. Without this, a series holding
                // several WSI items walked every item's pyramid — serially —
                // before the slide could open, and then threw all but one away.
                only: "best",
            }
        );

        // `only: "best"` already ranked the groups (by pyramid depth, then
        // width) before spending requests on them, so this is a single-element
        // list. The sort is kept because the ranking there is pre-metadata and
        // this one is authoritative: it reads the levels that were actually
        // ingested, and it must stay the definition of "the winner".
        this.wsi = (wsiList || [])
            .slice()
            .sort((a, b) => {
                const aLevels = a?.levels?.length ?? 0;
                const bLevels = b?.levels?.length ?? 0;
                if (bLevels !== aLevels) return bLevels - aLevels;

                const maxW = (w) => Math.max(0, ...((w?.levels || []).map(L => Number(L?.width) || 0)));
                return maxW(b) - maxW(a);
            })[0];

        // Validate we have at least one pyramid level
        if (!this.wsi?.levels?.length) {
            throw new Error("No pyramid levels discovered in series (missing Per-Frame FG or TILED_FULL fallback)");
        }

        this._slidePlacement = this._applySlideOrientation();

        const normalized = this._normalizeLevels(this.wsi.levels);

        if (!normalized.length) {
            throw new Error(
                "WSI levels exist but none are usable (missing width/height/tile sizes/instanceUID, " +
                "or no frame could be mapped to any tile position)."
            );
        }

        this.wsi.levels = normalized;

        this.minLevel = 0;
        this.maxLevel = this.wsi.levels.length - 1;

// width/height/tile size — always from highest-res level (levels[0])
        const topLevel = this.wsi.levels[0];
        this.width  = topLevel.width;
        this.height = topLevel.height;

// Tile sizes: use highest-res tile size as canonical for OSD
        this.tileWidth  = topLevel.tileWidth  || 512;
        this.tileHeight = topLevel.tileHeight || 512;

        // The Image Pixel module is read per instance during metadata ingestion
        // (DicomTools.parsePixelChain) and lives on each level as `level.pixel`,
        // with the finest level's copy promoted onto `wsi`. Levels may legally
        // differ, so decoding reads the level's own descriptor — this field is
        // only the series-wide summary for metadata consumers.
        this.photometricInterpretation =
            this.wsi.levels[0]?.pixel?.photometricInterpretation ||
            this.wsi.photometricInterpretation ||
            FALLBACK_PIXEL.photometricInterpretation;
        this.samplesPerPixel = this.wsi.levels[0]?.pixel?.samplesPerPixel ?? null;
    }

    /**
     * Drop level records that cannot render, and order the rest highest-res first.
     *
     * A level needs geometry, an instance to fetch from, and at least one frame
     * position. The last requirement is the one that used to be missing: an
     * unmapped level keeps its dimensions, so it passed the filter, occupied a
     * pyramid slot, skewed `getLevelScale`, and — since `levels[0]` is what
     * `this.width` / `this.tileWidth` are read from — could silently redefine what
     * "level 0" means, all while rendering nothing. A sparse level is the opposite
     * case and is kept: it has real tiles, just not everywhere.
     *
     * @param {object[]} levels
     * @returns {object[]} a new, sorted array
     */
    _normalizeLevels(levels) {
        return (levels || [])
            .filter(l =>
                l &&
                Number.isFinite(l.width) &&
                Number.isFinite(l.height) &&
                Number.isFinite(l.tileWidth) &&
                Number.isFinite(l.tileHeight) &&
                l.instanceUID &&
                l.frames && Object.keys(l.frames).length > 0
            )
            .slice()
            .sort((a, b) => {
                // biggest first
                if (b.width !== a.width) return b.width - a.width;
                return (b.height ?? 0) - (a.height ?? 0);
            });
    }

    /**
     * Resolve what `ImageOrientationSlide` asks of the RENDERER, which is less
     * than it says.
     *
     * The tag is taken whole for coordinates (`getMetadata().slideTransform` →
     * the SR converter). For pixels it is honoured only when it is a proper
     * rotation, because a reflection cannot be drawn without a flip and OSD does
     * not honour a flip in coordinate conversion — and because no other viewer
     * applies it to layout either.
     *
     * The rotation, when there is one, goes to OSD via
     * {@link getIntrinsicPlacement}, which honours it in rendering *and* in
     * coordinate conversion — so annotations, masks and measurements follow with
     * nothing to translate.
     *
     * One answer for the whole series: a level whose instance declared no
     * orientation must not be placed differently from its siblings.
     *
     * @returns {{degrees: number}|undefined}
     */
    _applySlideOrientation() {
        const levels = this.wsi?.levels || [];
        const descriptor = levels.find(l => l?.slide?.orientation)?.slide || null;
        if (!descriptor) return undefined;
        this.wsi.slide = this.wsi.slide || descriptor;
        if (this.ignoreSlideOrientation) {
            // Still report it. The override is about pixels, and two sources that
            // both suppress the same rotation stay consistent — a disagreement in
            // what they suppressed is exactly what the comparison is for.
            this._reportOrientation(0);
            return undefined;
        }

        const rotation = displayRotation(descriptor.orientation);
        this._reportOrientation(rotation?.degrees || 0);
        if (!rotation) return undefined;

        console.info(`[DICOM] slide orientation [${descriptor.orientation.join(", ")}] ` +
            `→ rotate ${rotation.degrees}°`);
        return rotation;
    }

    /**
     * Tell the owner what this series resolved to.
     *
     * A slide and the SEG / Parametric Map drawn over it are separate sources,
     * constructed independently and in no fixed order, so neither can see the
     * other's answer. Reporting to a shared owner is what lets a disagreement be
     * NAMED rather than merely looked at — and it stays optional, so a source
     * built without a reporter (tests, direct use) behaves exactly as before.
     */
    _reportOrientation(degrees) {
        if (typeof this.reportOrientation !== "function") return;
        try {
            this.reportOrientation({
                studyUID: this.studyUID,
                seriesUID: this.seriesUID,
                sourceSeriesUID: this.sourceSeriesUID || null,
                degrees,
            });
        } catch (e) {
            // A diagnostic must never be able to break an open.
            console.warn("[dicom] orientation report failed:", e?.message ?? e);
        }
    }

    /**
     * The placement this image asks for because of what its FILE says, rather
     * than anything the session chose — here, `ImageOrientationSlide`.
     *
     * Never returns `flipped`: OSD draws a flip but does not convert coordinates
     * through it, so a mirrored image would carry unmirrored annotations.
     */
    getIntrinsicPlacement() {
        return this._slidePlacement;
    }

    configure() { }

    /* -------------------------- Metadata -> Pyramid -------------------------- */
    getMetadata() {
        // todo if error return error data
        // {
        //   error: ....
        //  }

        if (!this.wsi || !this.wsi.levels) {
            return { error: "Metadata missing", imageInfo: {} };
        }

        const level0 = this.wsi.levels[0] || {};

        // --- DEFAULTS --- todo show warning if used
        const safeFrameOfRef = this.wsi.frameOfReferenceUID || `${this.seriesUID}.999`;
        // Micrometres. The 0.25 default is one 40x pixel — the same assumption the
        // level scan makes when a store declares no spacing at all.
        const safeMicronsX = level0.micronsX || 0.25;
        const safeMicronsY = level0.micronsY || 0.25;

        return {
            // TOP-LEVEL, not only under `imageInfo`: this is where the core reads
            // physical calibration from (viewer-state-binding-controller.ts ->
            // UTILITIES.setImageMeasurements), matching every other tile source.
            // While these lived only in `imageInfo`, every DICOM slide measured in
            // pixels no matter what spacing the store declared.
            micronsX: safeMicronsX,
            micronsY: safeMicronsY,
            // How this raster sits on the glass, for the SR converter: `pixel ->
            // slide millimetre` is one affine built from these (see
            // `slide-orientation.mjs`). The FULL orientation, reflection included
            // — unlike the display, which honours only a proper rotation. Absent
            // when the file declared none, which is what keeps the old pure-scale
            // behaviour for stores that never carried the tag.
            slideTransform: this.wsi?.slide ? {
                orientation: this.wsi.slide.orientation,
                originX: this.wsi.slide.originX || 0,
                originY: this.wsi.slide.originY || 0,
            } : null,
            imageInfo: {
                studyUID: this.studyUID,
                seriesUID: this.seriesUID,
                frameOfReferenceUID: safeFrameOfRef,
                previewInstanceUID: this.wsi?.previewInstanceUID,
                macroInstanceUID: this.wsi?.macroInstanceUID,
                levels: this.wsi.levels,
                tileWidth: this.tileWidth,
                tileHeight: this.tileHeight,
                micronsX: safeMicronsX,
                micronsY: safeMicronsY,
            },
        }
    }

    /**
     * Identifying / patient-sensitive metadata, kept strictly separate from
     * getMetadata() (which stays technical). Reachable only through the isolated
     * `patient` scripting namespace. `patientDetails` is the plugin's live
     * activePatientDetails ({ patientID, name, sex, birthDate }), supplied on
     * the source options either as a plain object or — the normal case — as a
     * zero-arg accessor. The accessor form exists because the study-details
     * query is no longer awaited before the source is constructed, so a
     * snapshot taken at construction would be null; resolving at call time
     * picks the details up whenever they land. The protocol UIDs are opaque PHI
     * identifiers surfaced here for the sensitive-classification boundary (they
     * also remain in getMetadata for the internal DICOM/SR pipeline).
     */
    getSensitiveMetadata() {
        const raw = typeof this.patientDetails === "function"
            ? this.patientDetails() : this.patientDetails;
        const p = raw || {};
        return {
            patient: {
                patientID: p.patientID ?? null,
                name: p.name ?? null,
                sex: p.sex ?? null,
                birthDate: p.birthDate ?? null,
            },
            studyUID: this.studyUID ?? null,
            seriesUID: this.seriesUID ?? null,
            frameOfReferenceUID: this.wsi?.frameOfReferenceUID ?? null,
        };
    }

    /* ------------------------------ OSD hooks ------------------------------ */
    getLevelScale(level) {
        level = this.maxLevel-level;
        const levels = this.wsi.levels;
        return levels[level].width / levels[0].width;
    }

    // Per-level tile dimensions. DICOMweb pyramids may have different tile
    // sizes per level (e.g. 512×512 high-res + 256×256 thumb). OSD calls these
    // from getNumTiles(level) / getTileAtPoint(level), so overriding them is
    // sufficient to make the grid math correct end-to-end.
    getTileWidth(level) {
        const L = this.wsi?.levels?.[this.maxLevel - level];
        return L?.tileWidth || this._tileWidth || this.tileWidth || 256;
    }

    getTileHeight(level) {
        const L = this.wsi?.levels?.[this.maxLevel - level];
        return L?.tileHeight || this._tileHeight || this.tileHeight || 256;
    }

    /**
     * How many tiles a level really has.
     *
     * OSD's own answer is derived, not asked for: `getNumTiles` scales the BASE
     * image dimensions by `getLevelScale(level)` and divides by the tile size.
     * `getLevelScale` is a single scalar and this source computes it from width
     * (`levels[i].width / levels[0].width`), while a DICOM pyramid rounds each
     * level's width and height independently. The implied height and the real
     * one therefore disagree by a fraction of a pixel, and where the level is a
     * single tile row — `tileHeight === level.height`, normal for the bottom of
     * a pyramid — that fraction becomes a whole extra row of tiles that no frame
     * maps to. Measured on IDC: a 1089×555 level with a 1024×555 tile implies
     * 555.85 rows of image, so OSD asks for 2 tile rows where the instance has
     * 1, and every cell of the phantom row used to cost a 404.
     *
     * So the ingest states the grid (`level.tilesX/tilesY`) and this reports it
     * verbatim. Do not "simplify" this back into OSD's formula, and do not
     * re-derive it from `width / tileWidth` either: the derived (SEG/PMAP)
     * ingest deliberately collapses a whole-slide raster to one logical tile,
     * and only the stored value knows that.
     *
     * Falls back to the level's own geometry, then to OSD, for sources that
     * hand-build levels (radiology) and never went through WSI ingest.
     */
    getNumTiles(level) {
        const L = this.wsi?.levels?.[this.maxLevel - level];
        if (L) {
            if (Number.isFinite(L.tilesX) && Number.isFinite(L.tilesY)) {
                return new OpenSeadragon.Point(L.tilesX, L.tilesY);
            }
            if (L.width > 0 && L.height > 0 && L.tileWidth > 0 && L.tileHeight > 0) {
                return new OpenSeadragon.Point(
                    Math.ceil(L.width / L.tileWidth),
                    Math.ceil(L.height / L.tileHeight)
                );
            }
        }
        // Reachable for a level index outside the pyramid, which OSD does ask for.
        // Called through the prototype so a stripped TileSource (unit tests)
        // degrades to a single tile instead of throwing.
        if (super.getNumTiles) return super.getNumTiles(level);
        return new OpenSeadragon.Point(1, 1);
    }

    /**
     * Whether a tile position exists at all.
     *
     * PS3.3 lets a pyramid level be sparse — "any number of tiles may be absent" —
     * and OSD has a contract for exactly that: a tile that does not exist is never
     * requested, never cached, never drawn, and crucially never marked as covering
     * its cell, so the coarser level shows through. That is the correct rendering
     * for a hole in a slide, and it costs zero requests where the previous
     * fail-fast URL cost one 404 per absent tile per pan.
     *
     * Gated on `level.sparse`, which only the WSI ingest sets, so the derived and
     * radiology sources keep the base behaviour.
     *
     * This is strictly about HOLES. A cell outside the level's grid entirely is
     * not this method's problem — `getNumTiles` reports the real grid, and the
     * inherited bounds check above rejects anything past it. Conflating the two
     * is what made a dense level's out-of-grid cell report itself as sparse.
     */
    tileExists(level, x, y) {
        // `super.tileExists` is the base bounds check. Called through the
        // prototype so a stripped TileSource (unit tests) degrades to "in range".
        if (super.tileExists && !super.tileExists(level, x, y)) return false;
        const L = this.wsi?.levels?.[this.maxLevel - level];
        if (!L?.sparse) return true;
        return Number.isFinite(L.frames?.[`${x}_${y}`]);
    }

    getTileUrl(level, x, y) {
        const L = this.wsi?.levels?.[this.maxLevel - level];
        const base = `${this.baseUrl}/studies/${this.studyUID}/series/${this.seriesUID}/instances`;
        // `frames` is numbered over the level's LOGICAL frame space, which for a
        // concatenated level spans several instances — the resolver owns that
        // arithmetic (see DicomQuery.resolveFrameRef).
        const ref = DicomQuery.resolveFrameRef(L, L?.frames?.[`${x}_${y}`]);

        if (!ref) {
            // No frame here. OSD asks for the URL of a tile even when `tileExists`
            // said no (it builds the url before consulting `exists`), so this must
            // be a stable, per-cell string and not a request: the URL is the
            // default cache key, and this shape deliberately does not match
            // `_frameRefFromSrc`, so batching hands it to the solo path instead.
            return `${base}/${L?.instanceUID}/frames/none#${x}_${y}`;
        }

        const tail = this.useRendered ? `frames/${ref.frame}/rendered` : `frames/${ref.frame}`;
        return `${base}/${ref.instanceUID}/${tail}`;
    }

    async _getTile(context) {
        // A cell with no frame behind it. `tileExists` normally stops OSD long
        // before here, but the solo path settles whatever src it is handed, and a
        // sentinel must never become a request. States the cell, not a cause: the
        // reachable case is a hole in a sparse level, but a hand-built level whose
        // map is short would arrive the same way.
        if (typeof context?.src === "string" && context.src.includes("/frames/none#")) {
            return this._settle(context, "fail", "No frame is mapped to this tile position.", null);
        }

        let res;
        try {
            res = await this._fetchFrames(context.src, context);
        } catch (e) {
            if (this._isAbort(e)) return;   // the abort path already failed the job
            // Through `_settle`, not `context.fail`: a degraded batch re-enters
            // here, and a job that was already settled must not be settled twice.
            return this._settle(context, "fail", `Failed to fetch DICOM frame: ${e?.message ?? e}`, null);
        }
        if (res === null) return;   // non-ok response already reported

        // 1. Check for native browser formats (Rendered JPEG/PNG)
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.startsWith('image/jpeg') || ct.startsWith('image/png')) {
            const blob = await res.blob();
            return this._settle(context, "finish", blob, res, "rasterBlob");
        }

        // 2. Extract frame from Multipart response
        const parts = await this.parseMultipartRelated(res);
        if (!parts.length) return this._settle(context, "fail", "DICOM response carries no frames!", res);

        return this._finishFrame(context, parts[0], res);
    }

    /**
     * One frame of a multipart response -> a finished tile.
     *
     * Split out of `_getTile` so the batched path (`downloadTileBatchStart`)
     * runs the identical decode dispatch on every part of a multi-frame
     * response. There must be exactly one implementation of this: the choice
     * between the native-JPEG passthrough and the Cornerstone worker is what
     * decides whether a tile costs 0 ms or a decode, and a second copy of it
     * would drift.
     *
     * @param {object} context the ImageJob for THIS frame
     * @param {{headers: object, bytes: Uint8Array}} part
     * @param {Response} res the response the part came from (shared in a batch)
     */
    async _finishFrame(context, part, res) {
        // Tile dimensions for this specific level — DICOM pyramids can have
        // different tile sizes per level, so use the tile's own level rather
        // than the source's top-level dimensions.
        const level = context.tile?.level;
        const tileW = level != null ? this.getTileWidth(level) : (this.tileWidth || 256);
        const tileH = level != null ? this.getTileHeight(level) : (this.tileHeight || 256);

        const { headers, bytes } = part;
        // Every frame feeds the batch-width estimate, batched or not — otherwise
        // a source that never degrades would size its batches off nothing.
        this._observeFrameBytes(bytes?.length);

        let transferSyntax = (headers['transfer-syntax'] || '').trim();

        if (!transferSyntax) {
            const ct = headers['content-type'] || "";
            if (ct.includes('image/jp2')) transferSyntax = "1.2.840.10008.1.2.4.91"; // Assume J2K Lossy
            else if (ct.includes('image/jpeg')) transferSyntax = "1.2.840.10008.1.2.4.50"; // Assume Baseline
        }

        const levelInfo = this._levelInfoFor(level);
        const frame = stripItemTag(bytes);

        // 3. Baseline JPEG colour frames go straight to the renderer as a Blob.
        // Cornerstone's own decoder for this case is a browser JPEG decode too,
        // only it routes through FileReader -> btoa -> a base64 data: URL -> an
        // <img> -> drawImage -> getImageData, all on the main thread, purely to
        // hand back pixels we immediately re-wrap as an ImageBitmap. Handing the
        // bitstream over untouched gets the identical pixels from the identical
        // decoder, off-thread, with no readback.
        if (this._canDecodeNatively(transferSyntax, this._pixelFor(levelInfo), frame)) {
            return this._settle(context, "finish", new Blob([frame], { type: 'image/jpeg' }), res, "rasterBlob");
        }

        // 4. Use Cornerstone WADO Loader for J2K or Uncompressed bitstreams
        try {
            const bmp = await this._decodeWithCornerstone(frame, transferSyntax, tileW, tileH, levelInfo);
            return this._settle(context, "finish", bmp, res, "imageBitmap");
        } catch (err) {
            const blob = await this._renderedFallback(context.src);
            if (blob) return this._settle(context, "finish", blob, res, "rasterBlob");

            console.error("[DICOM] Cornerstone decoding failed", err);
            return this._settle(context, "fail", "Cornerstone Decode failure", res);
        }
    }

    /**
     * Ask the server to transcode the frame for us. Used when the local codec
     * cannot handle the stored transfer syntax — a store whose J2K we cannot
     * decode then still renders instead of showing a grid of failed tiles.
     *
     * The verdict is remembered per source: once the fallback is known to work
     * (or to be unavailable) we do not re-probe it on every tile.
     */
    async _renderedFallback(src) {
        if (this.useRendered || this._renderedFallbackFailed) return null;

        try {
            const url = `${src}/rendered`;
            const headers = { Accept: this._acceptHeader(true) };
            const res = this.client
                ? await this.client.fetchRaw(url, { headers })
                : await fetch(url, { headers: { ...this.ajaxHeaders, ...headers }, mode: 'cors', cache: 'no-store' });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const ct = (res.headers.get('content-type') || '').toLowerCase();
            if (!ct.startsWith('image/')) throw new Error(`unexpected content-type ${ct}`);

            if (!this._warnedRenderedFallback) {
                this._warnedRenderedFallback = true;
                console.warn("[DICOM] local decoding failed for this series; falling back to " +
                    "server-side /rendered frames. Set `useRendered: true` to skip the failed attempt.");
            }
            return await res.blob();
        } catch (e) {
            this._renderedFallbackFailed = true;
            console.warn("[DICOM] /rendered fallback unavailable", e);
            return null;
        }
    }

    /**
     * The Image Pixel module governing a level, with the one-shot warning that
     * we are guessing. Levels carry their own chain (`dicom-query` assigns it
     * per level), so a series may mix an 8-bit RGB thumbnail level over a 16-bit
     * monochrome base — never read `wsi.pixel` alone.
     */
    _pixelFor(levelInfo) {
        const pixel = levelInfo?.pixel || this.wsi?.pixel || FALLBACK_PIXEL;
        if (pixel === FALLBACK_PIXEL && !this._warnedFallbackPixel) {
            this._warnedFallbackPixel = true;
            console.warn("[DICOM] no Image Pixel module available for this series — " +
                "decoding as 8-bit RGB. Monochrome/palette/16-bit frames will be wrong.");
        }
        return pixel;
    }

    /**
     * True when the browser can decode this frame on its own and the result is
     * display-ready without the Modality/VOI/palette chain.
     *
     * The conditions mirror cornerstone's own dispatch for 1.2.840.10008.1.2.4.50
     * exactly — it sends everything else to the worker pool, and diverging here
     * would mean decoding frames it deliberately does not decode this way.
     */
    _canDecodeNatively(transferSyntax, pixel, frame) {
        if ((transferSyntax || "").trim() !== JPEG_BASELINE_TS) return false;
        if (pixel.bitsAllocated !== 8) return false;

        // Not `>= 3`: cornerstone routes samplesPerPixel 5 to the worker.
        const spp = pixel.samplesPerPixel || 3;
        if (spp !== 3 && spp !== 4) return false;

        // Same predicate as `needsDisplayChain` below — a monochrome or palette
        // frame still needs its display chain applied and must not shortcut.
        if (isMonochrome(pixel)) return false;
        if ((pixel.photometricInterpretation || "RGB").toUpperCase().startsWith("PALETTE")) return false;

        // A truncated or mislabelled frame must fail the job here (retry and
        // faulty-source accounting) rather than surface later as an undiagnosable
        // blank tile inside the renderer.
        return frame.length > 3 && frame[0] === 0xFF && frame[1] === 0xD8;
    }

    /**
     * Resolve the pyramid level record (which carries the Image Pixel module
     * and the display chain) for an OSD level index. OSD level 0 is the
     * coarsest; `wsi.levels[0]` is the finest, hence the inversion.
     */
    _levelInfoFor(osdLevel) {
        if (osdLevel == null) return this.wsi?.levels?.[0] || null;
        return this.wsi?.levels?.[this.maxLevel - osdLevel] || null;
    }

    /**
     * Decode one frame through the cornerstone loader and apply the DICOM
     * display chain.
     *
     * @param {boolean} [asImageData] return the RGBA `ImageData` instead of an
     *        `ImageBitmap`. Callers that only want the samples (the derived-object
     *        plane extractor) take this to avoid a bitmap -> canvas -> getImageData
     *        readback, which stalls on a GPU sync.
     */
    async _decodeWithCornerstone(pixelData, transferSyntax, tileWidth, tileHeight, levelInfo = null,
                                 asImageData = false) {
        const pixel = this._pixelFor(levelInfo);
        const { decodedFrame, pi, w, h } =
            await this._decodeFrameRaw(pixelData, transferSyntax, tileWidth, tileHeight, pixel);

        // Fast path: the decoder already produced display-ready RGBA. Only valid
        // for true colour frames — a monochrome or palette frame still needs the
        // Modality/VOI/palette chain applied, and taking this shortcut for those
        // is what made 16-bit data render as noise.
        const needsDisplayChain = isMonochrome(pixel) || pi.startsWith("PALETTE");
        if (!needsDisplayChain && decodedFrame.imageData && decodedFrame.imageData.data?.length === w * h * 4) {
            return asImageData ? decodedFrame.imageData : await createImageBitmap(decodedFrame.imageData);
        }

        const imgData = this._decodedToImageData(decodedFrame, levelInfo, pixel);
        return asImageData ? imgData : await createImageBitmap(imgData);
    }

    /**
     * Decode a compressed frame to its **stored** samples, stopping short of the
     * display chain.
     *
     * Split out of `_decodeWithCornerstone` because quantitative consumers must
     * not go through it: `_decodedToImageData` bakes the Modality LUT, the VOI
     * window and MONOCHROME1 inversion into 8-bit display bytes, which is
     * exactly right for a slide and exactly wrong for a CT that windows in the
     * shader. Colour-space normalization (YBR -> RGB) stays here because it is a
     * property of the *codec output*, not of the display.
     *
     * @param {Uint8Array} pixelData raw (possibly encapsulated) frame bytes
     * @param {string} transferSyntax
     * @param {number} tileWidth
     * @param {number} tileHeight
     * @param {ImagePixelDescriptor} pixel
     * @returns {Promise<{decodedFrame:object, ts:string, pi:string, w:number, h:number}>}
     */
    async _decodeFrameRaw(pixelData, transferSyntax, tileWidth, tileHeight, pixel) {
        // The single point where cornerstone is first touched, and therefore
        // where it is loaded. A baseline-JPEG colour pyramid — the common WSI
        // case — takes the native path in `_finishFrame` and never arrives here,
        // so its 1.36 MB is never fetched at all.
        await DICOMWebTileSource._ensureCornerstone();

        const ts = (transferSyntax || "").replace(/['"]/g, "").trim();
        const data = stripItemTag(pixelData);

        const rows = tileHeight || this.tileHeight || 256;
        const cols = tileWidth || this.tileWidth || 256;

        const rawPi = (pixel.photometricInterpretation || "RGB").toUpperCase();
        const isColour = (pixel.samplesPerPixel || 3) >= 3;

        // For a colour frame whose codec already produced RGB, report RGB — see
        // CODEC_CONVERTS_COLOUR. Monochrome and palette frames always keep their
        // declared interpretation, because that is what drives the display chain.
        const pi0 = (isColour && CODEC_CONVERTS_COLOUR.has(ts)) ? "RGB" : rawPi;

        // YBR_FULL_422 is chroma-subsampled: *uncompressed* frames carry two
        // bytes per pixel (one luma each, chroma shared between pairs), so the
        // decoder must be told 2 samples even though the dataset declares 3. A
        // compressed 422 frame is full-resolution once decoded.
        const spp0 = (pi0 === "YBR_FULL_422" && UNCOMPRESSED_TS.has(ts))
            ? 2
            : (pixel.samplesPerPixel || 3);

        const metadata = {
            rows,
            columns: cols,
            bitsAllocated: pixel.bitsAllocated,
            bitsStored: pixel.bitsStored,
            highBit: pixel.highBit,
            pixelRepresentation: pixel.pixelRepresentation,
            planarConfiguration: pixel.planarConfiguration,
            samplesPerPixel: spp0,
            photometricInterpretation: pi0,
        };

        const options = {
            preScale: { enabled: false },
            decodeConfig: { isJP2: false },
        };

        const decodedFrame = await cornerstoneWADOImageLoader.decodeImageFrame(
            metadata, ts, data, decodeCanvas(), options
        );
        const w = decodedFrame.columns || cols;
        const h = decodedFrame.rows || rows;
        const pi = (decodedFrame.photometricInterpretation || metadata.photometricInterpretation || "").toUpperCase();

        if (pi.startsWith("YBR")) {
            if (ts === "1.2.840.10008.1.2.4.50") {
                // Baseline JPEG – browser always returns RGB - nothing to do
                decodedFrame.samplesPerPixel = 3;
            } else {
                // Output buffer: RGBA
                const rgba = new Uint8ClampedArray(w * h * 4);
                // Correct signature: (imageFrame, outputBuffer, useAlpha)
                cornerstoneWADOImageLoader.convertColorSpace(decodedFrame, rgba, true);
                decodedFrame.pixelData = rgba;
                decodedFrame.samplesPerPixel = 4;     // matches RGBA buffer
            }

            decodedFrame.photometricInterpretation = "RGB";
            decodedFrame.planarConfiguration = 0; // interleaved
        }

        decodedFrame.width = decodedFrame.width || decodedFrame.columns || cols;
        decodedFrame.height = decodedFrame.height || decodedFrame.rows || rows;

        if (!decodedFrame.width || !decodedFrame.height) {
            throw new Error(`Invalid dimensions: ${decodedFrame.width}x${decodedFrame.height}`);
        }

        return { decodedFrame, ts, pi, w, h };
    }

    /**
     * Modality LUT + VOI LUT + MONOCHROME1 inversion, collapsed into one lookup
     * table and cached on the level record. Rebuilding it per tile would be a
     * 65536-iteration loop on every frame.
     */
    _grayscaleLutFor(levelInfo, pixel) {
        const host = levelInfo || this.wsi || this;
        const modalityLut = levelInfo?.modalityLut ?? this.wsi?.modalityLut ?? null;
        const voiLut = levelInfo?.voiLut ?? this.wsi?.voiLut ?? null;

        // An explicit window (setVoiWindow) is a request to bake THAT window, and
        // outranks the deferral: the caller asked for a picture, not for stored
        // values. Without an override, an eligible level passes its stored bytes
        // through untouched so the `dicom-window` layer can window them per
        // fragment — see `canDeferVoiToShader`.
        const defer = !this._voiWindowOverride && canDeferVoiToShader(pixel, { modalityLut, voiLut });
        const key = defer ? "identity" : (this._voiPresetIndex ?? 0);
        if (host.__grayLut && host.__grayLutKey === key) return host.__grayLut;

        host.__grayLut = defer ? buildIdentityLut() : buildGrayscaleLut(pixel, {
            modalityLut,
            voiLut,
            presetIndex: key,
            window: this._voiWindowOverride || null,
        });
        host.__grayLutKey = key;
        return host.__grayLut;
    }

    /**
     * True when this series' tiles carry stored values rather than a baked
     * window, and a `dicom-window` layer is therefore both meaningful and
     * necessary to render them the way the DICOM display chain says.
     *
     * Read off the finest level, which is what `wsi.pixel` summarizes; a level
     * whose descriptor differs answers for itself inside `_grayscaleLutFor`.
     */
    voiDeferredToShader() {
        const level = this.wsi?.levels?.[0] ?? null;
        const pixel = level?.pixel ?? this.wsi?.pixel ?? null;
        if (!pixel || this._voiWindowOverride) return false;
        return canDeferVoiToShader(pixel, {
            modalityLut: level?.modalityLut ?? this.wsi?.modalityLut ?? null,
            voiLut: level?.voiLut ?? this.wsi?.voiLut ?? null,
        });
    }

    /**
     * Choose the VOI preset (or an explicit window) used for monochrome frames
     * and drop the cached lookup tables so subsequent tiles re-map.
     *
     * Until the renderer can carry high-precision samples through its first
     * pass, window/level is applied here at decode time — changing it therefore
     * requires the tile cache to be dropped by the caller.
     *
     * @param {{presetIndex?: number, center?: number, width?: number}} spec
     */
    setVoiWindow(spec = {}) {
        this._voiPresetIndex = spec.presetIndex ?? 0;
        this._voiWindowOverride = (Number.isFinite(spec.center) && Number.isFinite(spec.width))
            ? { center: spec.center, width: spec.width }
            : null;
        for (const level of (this.wsi?.levels || [])) {
            level.__grayLut = undefined;
            level.__grayLutKey = undefined;
        }
        if (this.wsi) { this.wsi.__grayLut = undefined; this.wsi.__grayLutKey = undefined; }
    }

    /** The VOI presets this series declares, for UI population. */
    getVoiPresets() {
        const voi = this.wsi?.levels?.[0]?.voiLut ?? this.wsi?.voiLut ?? null;
        return voi?.presets ? voi.presets.slice() : [];
    }

    // todo move this to webassembly or a worker
    _decodedToImageData(decodedData, levelInfo = null, pixelOverride = null) {
        const w = decodedData.width;
        const h = decodedData.height;

        // `new ImageData` rather than a scratch canvas + `putImageData`: the
        // buffer is the only thing anyone downstream wants, and every consumer
        // (createImageBitmap, the derived-object plane extractor) takes it
        // directly. Going through a canvas only bought a full-frame blit.
        const imgData = new ImageData(w, h);

        // ---- normalize pixelData to a TypedArray ----
        let pixels = decodedData.pixelData;
        if (!pixels) throw new Error("Decoder result is missing pixelData.");

        const pixel = pixelOverride || levelInfo?.pixel || this.wsi?.pixel || FALLBACK_PIXEL;

        // Some CWIL paths return ArrayBuffer instead of TypedArray -> length is undefined -> black tiles
        const bits = decodedData.bitsAllocated || decodedData.bitsPerSample || pixel.bitsAllocated || 8;

        if (pixels instanceof ArrayBuffer) {
            pixels = (bits > 8) ? new Uint16Array(pixels) : new Uint8Array(pixels);
        } else if (pixels.buffer instanceof ArrayBuffer && typeof pixels.length !== "number") {
            // very defensive: if something array-buffer-like without length
            pixels = (bits > 8)
                ? new Uint16Array(pixels.buffer, pixels.byteOffset || 0, (pixels.byteLength || pixels.buffer.byteLength) / 2)
                : new Uint8Array(pixels.buffer, pixels.byteOffset || 0, pixels.byteLength || pixels.buffer.byteLength);
        }

        const numPx = w * h;
        const spp = decodedData.samplesPerPixel ?? pixel.samplesPerPixel ?? 1;
        const planar = decodedData.planarConfiguration ?? pixel.planarConfiguration ?? 0;

        // Colour samples wider than 8 bits are normalized by the *stored* range,
        // not by a blind `>> 8`: a 12-bit-in-16 frame (bitsStored 12) would come
        // out 16× too dark under the naive shift.
        const colourShift = Math.max(0, (pixel.bitsStored || bits) - 8);
        const to8 = (v) => (colourShift ? ((v >>> colourShift) & 0xff) : (v & 0xff));

        const palette = levelInfo?.paletteLut ?? this.wsi?.paletteLut ?? null;

        // ---- map to RGBA ----
        if (palette && spp === 1) {
            // PALETTE COLOR: the stored value is an index into the LUT, offset by
            // the descriptor's first-mapped value.
            const last = palette.size - 1;
            for (let i = 0; i < numPx; i++) {
                let idx = (pixels[i] ?? 0) - palette.firstMapped;
                if (idx < 0) idx = 0; else if (idx > last) idx = last;
                const o = i * 4;
                imgData.data[o]     = palette.r[idx];
                imgData.data[o + 1] = palette.g[idx];
                imgData.data[o + 2] = palette.b[idx];
                imgData.data[o + 3] = 255;
            }
        } else if (spp === 1) {
            // Monochrome: one lookup per pixel through the pre-built
            // Modality+VOI table (which also handles MONOCHROME1 inversion).
            const lut = this._grayscaleLutFor(levelInfo, pixel);
            const lutMask = lut.length - 1;
            for (let i = 0; i < numPx; i++) {
                const v = lut[(pixels[i] ?? 0) & lutMask];
                const o = i * 4;
                imgData.data[o] = v;
                imgData.data[o + 1] = v;
                imgData.data[o + 2] = v;
                imgData.data[o + 3] = 255;
            }
        } else if (spp >= 3) {
            if (planar === 1) {
                // planar: R plane, then G, then B
                const planeSize = numPx;
                const rOff = 0;
                const gOff = planeSize;
                const bOff = planeSize * 2;

                for (let i = 0; i < numPx; i++) {
                    const o = i * 4;
                    imgData.data[o]     = to8(pixels[rOff + i] ?? 0);
                    imgData.data[o + 1] = to8(pixels[gOff + i] ?? 0);
                    imgData.data[o + 2] = to8(pixels[bOff + i] ?? 0);
                    imgData.data[o + 3] = 255;
                }
            } else {
                // interleaved: RGBRGB...
                for (let i = 0; i < numPx; i++) {
                    const s = i * spp; // supports spp=3 or spp=4
                    const o = i * 4;
                    imgData.data[o]     = to8(pixels[s] ?? 0);
                    imgData.data[o + 1] = to8(pixels[s + 1] ?? 0);
                    imgData.data[o + 2] = to8(pixels[s + 2] ?? 0);
                    imgData.data[o + 3] = 255;
                }
            }
        }

        return imgData;
    }


    async getLabel() {
        if (!this.wsi?.macroInstanceUID) return null;
        return this._downloadWholeInstanceImage(this.wsi.macroInstanceUID);
    }

    downloadTileStart(context) { this._getTile(context); }

    /* --------------------------- Batched tile IO --------------------------- */
    /*
     * WADO-RS can return many frames in one multipart response
     * (`…/frames/1,2,3`), and OpenSeadragon can hand a TileSource a group of
     * tile jobs to satisfy together. Neither half was being used: every tile was
     * its own request.
     *
     * That is the dominant cost against a remote store. Measured against Google
     * Healthcare: 63 tiles took 80 s at 67 KB/s aggregate, each request averaging
     * 5.9 s of which ~0.65 s was a CORS preflight — and the preflight cache is
     * keyed per URL, so one request per tile means one preflight per tile.
     * Batching divides both counts by the batch size.
     *
     * It is also the concurrency lever. `ImageLoader` counts a whole batch as ONE
     * job against `imageLoaderLimit` (6), so the tiles actually in flight become
     * `6 × batchMaxJobs` — reached without opening a single extra connection.
     */

    /** True once we have seen enough frames to size batches by real payload. */
    _observeFrameBytes(n) {
        if (!(n > 0)) return;
        // Plain EMA. The point is to react to a pyramid whose frames are 6 KB
        // versus one whose frames are 150 KB, not to track fine variation.
        this._avgFrameBytes = this._avgFrameBytes
            ? (this._avgFrameBytes * 0.8 + n * 0.2) : n;
    }

    batchEnabled() {
        // `useRendered` addresses frames as `…/frames/{n}/rendered`, which has no
        // multi-frame form — batching it would fabricate URLs the store cannot
        // answer. The clientless path is left alone for the same reason it
        // exists: it is the plain-`fetch` fallback, not the supported route.
        return !!this.client && !this.useRendered;
    }

    /**
     * Only ever batch a source with itself. A bucket is keyed by source, but a
     * bucket's jobs can still span several pyramid levels — and a level is a
     * distinct DICOM instance — so `downloadTileBatchStart` groups by instance
     * before issuing anything.
     */
    batchCompatible(other) { return other === this; }

    batchMaxJobs() {
        const avg = this._avgFrameBytes;
        if (!avg) return DICOM_BATCH_DEFAULT_JOBS;
        // Hold the response near a target size: a pyramid of 6 KB frames batches
        // wide, one of 150 KB frames stays narrow so a single failure or abort
        // does not discard a large download.
        return Math.max(DICOM_BATCH_MIN_JOBS,
            Math.min(DICOM_BATCH_MAX_JOBS, Math.round(DICOM_BATCH_TARGET_BYTES / avg)));
    }

    batchTimeout() { return DICOM_BATCH_TIMEOUT_MS; }

    downloadTileBatchStart(batchJob) { this._getTileBatch(batchJob); }

    /**
     * Split a batch by DICOM instance and fetch each group as one multi-frame
     * request.
     *
     * Every child job must be settled exactly once or the batch hangs until its
     * timeout — `BatchImageJob.start` completes only when its finish/fail count
     * reaches `jobs.length`. So every path here ends in `_settle`, and anything
     * unroutable is handed to the single-tile path rather than dropped.
     */
    async _getTileBatch(batchJob) {
        const jobs = batchJob?.jobs || [];
        if (!jobs.length) return;

        /** instanceUID -> { frame -> jobs[] } */
        const groups = new Map();
        const solo = [];

        for (const job of jobs) {
            const ref = this._frameRefFromSrc(job?.src);
            if (!ref) { solo.push(job); continue; }
            let byFrame = groups.get(ref.instanceUID);
            if (!byFrame) groups.set(ref.instanceUID, byFrame = new Map());
            // Two jobs for one frame is not expected, but a shared frame must
            // not silently drop one of them: both wait on the same part.
            const bucket = byFrame.get(ref.frame);
            if (bucket) bucket.push(job); else byFrame.set(ref.frame, [job]);
        }

        // Anything that is not a plain single-frame URL goes back through the
        // PUBLIC single-tile entry point — `downloadTileStart`, not `_getTile`.
        // That distinction is load-bearing: the synthetic preview level
        // (src/classes/preview-level.ts) serves its level-0 tile by PATCHING
        // `downloadTileStart` on the source instance and matching a
        // `xopat-preview://` src. Batching bypasses that patch, so a preview
        // tile reaching `_getTile` directly would be fetched as if the scheme
        // were a URL. Going through the patched method keeps it working, and
        // costs nothing for ordinary frames.
        for (const job of solo) this.downloadTileStart(job);

        await Promise.all(Array.from(groups, ([instanceUID, byFrame]) =>
            this._fetchFrameGroup(instanceUID, byFrame)));
    }

    /**
     * One multi-frame request for one instance.
     *
     * On any failure the group falls back to individual requests instead of
     * failing the tiles. xOpat runs OpenSeadragon with `tileRetryMax: 0`, so the
     * library's documented "failed batch jobs are retried in non-batched mode"
     * never fires here — the fallback has to be ours.
     */
    async _fetchFrameGroup(instanceUID, byFrame) {
        const frames = Array.from(byFrame.keys());
        const url = `${this.baseUrl}/studies/${this.studyUID}/series/${this.seriesUID}` +
            `/instances/${instanceUID}/frames/${frames.join(',')}`;

        const degrade = (why) => {
            if (why) console.debug(`[DICOM] frame batch degraded to single requests: ${why}`);
            for (const bucket of byFrame.values()) {
                // A job the loader abandoned mid-batch is already settled;
                // re-requesting it would spend a connection on a tile nobody
                // is waiting for.
                for (const job of bucket) if (!job.__dicomSettled) this.downloadTileStart(job);
            }
        };

        // Every job in the group shares one request, so it shares one abort:
        // the request is only torn down once ALL of them have been abandoned.
        const members = Array.from(byFrame.values()).flat();

        let res, parts;
        try {
            res = await this._fetchFrames(url, members);
            if (res === null) return degrade("non-ok response");
            parts = await this.parseMultipartRelated(res);
        } catch (e) {
            if (this._isAbort(e)) {
                // Someone aborted the group. Jobs the loader still cares about
                // are re-issued singly; the aborted ones are already settled.
                return degrade(null);
            }
            return degrade(e?.message ?? String(e));
        }

        // A store is entitled to return fewer parts than requested. Serve the
        // ones that did arrive positionally (multipart order follows the
        // requested frame list) and re-request the remainder singly, rather
        // than failing tiles that are simply further down the response.
        if (parts.length !== frames.length) {
            console.debug(`[DICOM] frame batch returned ${parts.length}/${frames.length} parts`);
        }

        for (let i = 0; i < frames.length; i++) {
            const bucket = byFrame.get(frames[i]);
            const part = parts[i];
            if (!part) {
                for (const job of bucket) if (!job.__dicomSettled) this.downloadTileStart(job);
                continue;
            }
            for (const job of bucket) this._finishFrame(job, part, res);
        }
    }

    /**
     * `…/instances/<uid>/frames/<n>` -> `{instanceUID, frame}`.
     *
     * Read back off the URL rather than threaded through the job, because OSD
     * builds the job from `getTileUrl`'s return value and offers no hook in
     * between. Frame 0 is `getTileUrl`'s deliberate fail-fast placeholder for a
     * missing frame mapping and must never be batched into a real request.
     */
    _frameRefFromSrc(src) {
        if (typeof src !== "string") return null;
        const m = src.match(/\/instances\/([^/?#]+)\/frames\/(\d+)$/);
        if (!m) return null;
        const frame = Number(m[2]);
        if (!Number.isFinite(frame) || frame <= 0) return null;
        return { instanceUID: m[1], frame };
    }

    /* --------------------- Request lifecycle (fetch/abort) --------------------- */

    /**
     * Fetch one frame URL (single or comma-separated) with an abort handle
     * shared by every job it serves.
     *
     * Aborts used to be a no-op: nothing overrode `downloadTileAbort` and
     * `_getTile` never recorded a request, so OSD's base implementation had
     * nothing to cancel. Panning away from a screenful therefore left six ~6 s
     * requests running to completion, still holding the whole connection budget
     * while the tiles they would produce were already off-screen.
     *
     * @returns {Promise<?Response>} null when a non-ok response was already reported
     */
    async _fetchFrames(url, contexts) {
        const jobs = (Array.isArray(contexts) ? contexts : [contexts]).filter(Boolean);
        const controller = typeof AbortController === "function" ? new AbortController() : null;

        if (controller && jobs.length) {
            const record = { controller, remaining: new Set(jobs) };
            for (const job of jobs) {
                job.userData = job.userData || {};
                job.userData.__dicomRequest = record;
            }
        }

        // Supplying a signal to `fetchRaw` opts out of ITS timeout, and OSD's
        // batch timeout only fails the jobs — it never reaches the request. So
        // the deadline has to be composed here, or a stalled store holds a
        // connection open indefinitely.
        const deadline = controller
            ? setTimeout(() => { try { controller.abort(); } catch (_) { /* gone */ } }, DICOM_FRAME_TIMEOUT_MS)
            : null;

        const accept = this._acceptHeader(this.useRendered);
        try {
            if (this.client) {
                return await this.client.fetchRaw(url, {
                    headers: { Accept: accept },
                    signal: controller?.signal,
                    // A tile is worth one attempt. `fetchRaw` otherwise retries
                    // three times with 1s/2s/4s backoff on any non-HTTPError
                    // throw, so one unreachable tile can hold a connection slot
                    // for 7 s+ — and the draw loop has moved on by then.
                    maxRetries: 0,
                });
            }

            const res = await fetch(url, {
                headers: { ...this.ajaxHeaders, Accept: accept },
                mode: 'cors', cache: 'no-store', signal: controller?.signal,
            });
            if (!res.ok) {
                for (const job of jobs) {
                    this._settle(job, "fail", `Failed to fetch DICOM frame (HTTP ${res.status}).`, res);
                }
                return null;
            }
            return res;
        } finally {
            if (deadline !== null) clearTimeout(deadline);
        }
    }

    /** Whether a thrown error is an abort rather than a real failure. */
    _isAbort(e) {
        return e?.name === "AbortError" || e?.code === 20 ||
            /abort/i.test(String(e?.message ?? ""));
    }

    /**
     * Complete a tile job at most once.
     *
     * `BatchImageJob` finishes when its children's finish/fail count reaches
     * `jobs.length`, so settling one child twice completes the batch early and
     * strands the rest as permanently "loading". Aborts settle a job too (OSD
     * fails it on the way out), which is exactly the race this closes.
     */
    _settle(context, how, ...args) {
        if (!context || context.__dicomSettled) return;
        context.__dicomSettled = true;
        return context[how](...args);
    }


    /**
     * Tear down the request behind a tile job.
     *
     * The request is shared with the rest of its batch, so it is only aborted
     * once every job that wanted it has given up — otherwise abandoning one tile
     * would discard frames its neighbours are still waiting for.
     */
    downloadTileAbort(context) {
        // OSD calls `fail` right after this; let it, and keep our own paths from
        // settling the same job a second time.
        if (context) context.__dicomSettled = true;

        const record = context?.userData?.__dicomRequest;
        if (!record) return;
        record.remaining.delete(context);
        if (record.remaining.size === 0) {
            try { record.controller.abort(); } catch (_) { /* already gone */ }
        }
    }

    /* ------------------------- Preview/Macro fetch ------------------------- */
    async _downloadWholeInstanceImage(instanceUID) {
        if (!instanceUID) throw new Error("No instance selected");
        const path = `/studies/${this.studyUID}/series/${this.seriesUID}/instances/${instanceUID}/rendered`;
        return this._downloadImage(path);
    }

    async _downloadImage(pathOrUrl) {
        let res;
        if (this.client) {
            res = await this.client.fetchRaw(pathOrUrl, {
                headers: { Accept: this._acceptHeader(true, false) }
            });
        } else {
            res = await fetch(pathOrUrl, {
                headers: { ...this.ajaxHeaders, Accept: this._acceptHeader(true, false) },
                mode: 'cors', cache: 'no-store'
            });
            if (!res.ok) throw new Error(`Failed to download rendered image (${res.status})`);
        }

        const ct = (res.headers.get('content-type') || '').toLowerCase();
        // Many servers return a single-part image for /rendered
        if (ct.startsWith('image/jpeg') || ct.startsWith('image/png')) {
            return await res.blob();
        }

        const parts = await this.parseMultipartRelated(res);
        if (!parts.length) throw new Error("Rendered response missing");
        const { headers, bytes } = parts[0];
        const type = (headers['content-type'] || '').toLowerCase();
        const mime = type.includes('image/png') ? 'image/png' : (type.includes('image/jpeg') ? 'image/jpeg' : 'application/octet-stream');
        return new Blob([bytes], { type: mime });
    }

    /** Download preview/overview (thumbnail) image as a Blob (PNG or JPEG). */
    async getThumbnail({ targetWidth = 512 } = {}) {
        // Always route via the OVERVIEW/THUMBNAIL instance's `/rendered`
        // endpoint — works on GCS Healthcare and standards-conformant
        // servers alike. The `previewInstanceUID` is populated by
        // groupSeriesInstances when a LABEL/OVERVIEW instance exists.
        try {
            if (this.wsi?.previewInstanceUID) {
                return await this._downloadWholeInstanceImage(this.wsi.previewInstanceUID);
            }
        } catch (e) {
            console.debug("[DICOM] thumbnail unavailable:", e?.message ?? e);
        }
        return null;
    }

    /** Download label/macro image as a Blob (PNG or JPEG). */
    async downloadMacroImage() { return this._downloadWholeInstanceImage(this.wsi.macroInstanceUID); }


    _iccProfileCache = undefined;

    /**
     * Download ICC profile from DICOM instance metadata.
     * The ICC module expects this method to exist and return an ArrayBuffer. :contentReference[oaicite:3]{index=3}
     */
    async downloadICCProfile() {
        if (this.useRendered) return null;
        if (this._iccProfileCache === null) return null;
        if (this._iccProfileCache instanceof ArrayBuffer) return this._iccProfileCache;
        if (!this.client) return null; // HttpClient required for ICC bulk fetch

        const studyUID = this.studyUID;
        const seriesUID = this.seriesUID;

        // Candidate instances to probe
        const candidates = [];
        if (this.wsi?.levels?.[0]?.instanceUID) candidates.push(this.wsi.levels[0].instanceUID);
        if (this.wsi?.previewInstanceUID) candidates.push(this.wsi.previewInstanceUID);
        if (this.wsi?.macroInstanceUID) candidates.push(this.wsi.macroInstanceUID);
        for (const lvl of (this.wsi?.levels || [])) if (lvl?.instanceUID) candidates.push(lvl.instanceUID);

        const uniq = Array.from(new Set(candidates));
        if (!uniq.length) {
            this._iccProfileCache = null;
            return null;
        }

        const metaPathFor = (instanceUID) =>
            `/studies/${encodeURIComponent(studyUID)}` +
            `/series/${encodeURIComponent(seriesUID)}` +
            `/instances/${encodeURIComponent(instanceUID)}/metadata`;

        // Resolve all candidates' metadata up front. Every pyramid level was
        // already fetched when the source initialized and `wadoMetadata` memoizes
        // per client, so in practice this costs at most the preview and macro
        // instances — and those two overlap instead of being probed one after the
        // other. Evaluation below stays in candidate order, so which instance
        // supplies the profile is unchanged.
        const metas = await DicomQuery.mapConcurrent(uniq, uniq.length, async (instanceUID) => {
            try {
                return await DicomQuery.wadoMetadata(this.client, metaPathFor(instanceUID));
            } catch (e) {
                console.warn("[ICC] metadata fetch failed",
                    { instanceUID, metaPath: metaPathFor(instanceUID), error: String(e?.message || e) });
                return null;
            }
        });

        for (let i = 0; i < uniq.length; i++) {
            const instanceUID = uniq[i];
            const metaPath = metaPathFor(instanceUID);
            const meta = metas[i];
            if (!meta) continue;

            const ds = meta?.[0];
            if (!ds) continue;

            // Deep search for the ICC tag anywhere in the dataset tree
            const tag = findTagDeep(ds, "00282000");
            if (!tag) continue;

            // Handle common shapes:
            //  - tag.InlineBinary / tag.BulkDataURI
            //  - tag.Value[0].InlineBinary / tag.Value[0].BulkDataURI
            const inline = tag.InlineBinary ?? tag?.Value?.[0]?.InlineBinary;
            const bulk   = tag.BulkDataURI  ?? tag?.Value?.[0]?.BulkDataURI;

            if (inline) {
                const buf = this._base64ToArrayBuffer(inline);
                this._iccProfileCache = buf;
                return buf;
            }

            if (bulk) {
                // Resolve the BulkDataURI against the absolute metadata URL.
                // BulkDataURI may itself be absolute, in which case fetchRaw
                // passes it through unchanged.
                const metaAbs = this.client.resolveUrl(metaPath);
                const bulkUrl = new URL(bulk, metaAbs).toString();
                try {
                    const res = await this.client.fetchRaw(bulkUrl, {
                        headers: { Accept: "application/octet-stream" }
                    });
                    const buf = await res.arrayBuffer();
                    this._iccProfileCache = buf;
                    return buf;
                } catch (e) {
                    console.warn("[ICC] bulk fetch failed", { bulkUrl, error: String(e?.message || e) });
                    continue;
                }
            }

            // Tag exists but has no bytes — treat as missing and stop scanning
            console.warn("[ICC] ICC tag found but contains no InlineBinary/BulkDataURI", { instanceUID, metaPath, tag });
            break;
        }

        this._iccProfileCache = null;
        return null;
    }

    _base64ToArrayBuffer(b64) {
        const binStr = atob(b64);
        const len = binStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
        return bytes.buffer;
    }
}