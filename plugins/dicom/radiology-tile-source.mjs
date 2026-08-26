import DicomQuery from './dicom-query.mjs';
import { DICOMWebTileSource, UNCOMPRESSED_TS, stripItemTag } from './tile-source.mjs';
import { applyModality, signExtendStored, writeHalfChannel } from './pixel-pipeline.mjs';

/**
 * Namespace-aware translator for the Slide Information card below.
 *
 * A TileSource has no plugin instance to borrow `this.t` from, and prefixing
 * the namespace into the key resolves in no namespace and silently renders the
 * raw key. So the namespace is expressed here exactly once — the same shape
 * `shaders/index.mjs` uses for the same reason. Called per use, never cached:
 * the loader installs a stub `$.t` before i18next initializes.
 */
const t = (key, options = {}) => window.$.t(key, { ...options, ns: "dicom" });

/**
 * `RadiologySeriesTileSource` — a CT/MR/PT/CR/DX/NM series as one xOpat
 * background with a focal-plane (z-stack) depth axis.
 *
 * ## Why this is not the slide source with a flag
 *
 * `DICOMWebTileSource` reads a series as *one image whose instances are pyramid
 * levels and whose frames are tile positions*. A radiology series is the
 * opposite on both axes: its instances (or the frames of one enhanced instance)
 * are the *same raster at different depths*, and there is no pyramid at all. So
 * `_initializeFromServer` is replaced wholesale and none of
 * `groupSeriesInstances` / `_ingestInstanceMetadata` / the frame-order
 * strategies runs.
 *
 * What is inherited is everything that is genuinely about *talking DICOMweb*:
 * the cornerstone worker pool and its WASM codec paths, the Accept-header
 * negotiation, multipart parsing, the `getImageInfo` -> `ready` / `open-failed`
 * bootstrap, and `getSensitiveMetadata`. Reimplementing those would be two
 * copies that drift — the same reasoning `DICOMDerivedTileSource` records.
 *
 * ## One tile per plane
 *
 * WADO-RS `/frames/{n}` has no sub-region form. Tiling a 512x512 CT would fetch
 * the whole frame once per tile and discard most of it, so the source declares a
 * single level whose tile *is* the image.
 *
 * ## Where the display chain runs
 *
 * The Modality LUT (rescale / RealWorldValueMapping) is applied here, per plane,
 * because it is a fixed property of the data. The VOI window is **not**: samples
 * are normalized into the series' declared `valueRange` and uploaded as RGBA16F,
 * and the `dicom-window` shader layer denormalizes and windows them per
 * fragment. That is what makes window/level a slider rather than a re-decode of
 * every visible slice — the same split `dicom-parametric.mjs` documents.
 *
 * Consequence worth knowing: the renderer's first-pass colour target must keep
 * float precision, which it only does while `webGlPrecision` is `"auto"`. Under
 * the default `"unorm8"` the sample is quantized to 8 bits *before* the shader
 * sees it and a narrow window bands visibly. The source says so once, at init.
 *
 * ## Annotations
 *
 * Annotations carry no z coordinate (`src/ZSTACK.md`), so one drawn on a slice
 * renders on every slice. Harmless for an optical focal stack; wrong-looking
 * here. Out of scope by design, stated in the plugin README.
 */
export class RadiologySeriesTileSource extends DICOMWebTileSource {

    constructor(options) {
        super(options);

        /** Interleaved-volume selection from the session, if any. */
        this.subVolume = options.subVolume || null;

        /** Ordered plane records; the depth axis. */
        this._planes = [];
        /** url -> plane record. See `downloadTileStart`. */
        this._planeByUrl = new Map();
        this._activeZ = 0;

        // A radiology series has no OVERVIEW instance, and the synthetic preview
        // level would fetch a `/rendered` thumbnail whose window is the server's
        // rather than the one the shader is about to apply.
        this.__noPreviewLevel = true;
    }

    supports(data) { return data && data.type === "dicomweb-radiology"; }

    /**
     * Identity must carry the role. A DICOMweb `baseUrl` is shared by every
     * series on the endpoint, and several caches key off this string — the
     * z-plane records among them, whose purge matches on it by substring
     * (`viewer-depth-controller.ts`).
     */
    get tileSourceId() {
        if (!this.studyUID || !this.seriesUID) return null;
        return `dicom-rad:${this.baseUrl}#${this.studyUID}/${this.seriesUID}`;
    }

    /* -------------------------- Initialization -------------------------- */

    async _initializeFromServer() {
        if (!this.seriesUID || !this.studyUID) {
            throw new Error('DICOM radiology TileSource needs seriesUID and studyUID to be set before initialization!');
        }
        if (!this.client) {
            throw new Error('DICOM radiology TileSource needs an HttpClient (options.client) to initialize.');
        }

        const descriptor = await DicomQuery.describeRadiologySeries(
            this.client, this.studyUID, this.seriesUID, { subVolume: this.subVolume });

        if (!descriptor) throw new Error("Series holds no renderable radiology instances.");
        if (descriptor.error) throw new Error(descriptor.error);

        this.descriptor = descriptor;

        this._planes = descriptor.planes.map(plane => ({
            ...plane,
            url: this._planeUrl(plane),
        }));
        // Deduplicated upstream by (instanceUID, frame), which is what makes the
        // z-stack contract's "distinct planes yield distinct URLs" hold. Assert
        // it rather than trust it: a collision would make the controller believe
        // a tile already holds a plane it does not, and silently show the wrong
        // slice.
        this._planeByUrl = new Map(this._planes.map(p => [p.url, p]));
        if (this._planeByUrl.size !== this._planes.length) {
            throw new Error("Radiology planes do not have distinct frame URLs; the depth axis would be ambiguous.");
        }

        this.width = descriptor.width;
        this.height = descriptor.height;
        this.tileWidth = descriptor.width;
        this.tileHeight = descriptor.height;
        this.minLevel = 0;
        this.maxLevel = 0;

        // `wsi` is the shape the inherited helpers read (`getLevelScale`,
        // `getTileWidth/Height`, `_levelInfoFor`, `_pixelFor`). Exactly one level.
        this.wsi = {
            studyUID: this.studyUID,
            seriesUID: this.seriesUID,
            frameOfReferenceUID: descriptor.frameOfReferenceUID,
            pixel: descriptor.pixel,
            modalityLut: descriptor.modalityLut,
            voiLut: descriptor.voiLut,
            valueRange: descriptor.valueRange,
            levels: [{
                width: descriptor.width,
                height: descriptor.height,
                tileWidth: descriptor.width,
                tileHeight: descriptor.height,
                instanceUID: this._planes[0]?.instanceUID,
                micronsX: descriptor.micronsX,
                micronsY: descriptor.micronsY,
                pixel: descriptor.pixel,
                modalityLut: descriptor.modalityLut,
                voiLut: descriptor.voiLut,
            }],
        };

        this.photometricInterpretation = descriptor.photometricInterpretation;
        this.samplesPerPixel = descriptor.pixel?.samplesPerPixel ?? 1;

        // `count: 1` (a CR/DX projection) is a valid descriptor: it keeps the
        // navigator's focal-plane row hidden and the URL byte-stable.
        this.zStack = {
            count: this._planes.length,
            index: 0,
            spacingUm: descriptor.spacingUm,
            labels: this._planes.map(p => p.label),
        };
        this._activeZ = 0;

        for (const warning of descriptor.warnings || []) {
            console.warn(`[DICOM radiology] ${this.seriesUID}: ${warning}`);
        }
        this._warnPrecisionOnce();
    }

    _planeUrl(plane) {
        return `${this.baseUrl}/studies/${encodeURIComponent(this.studyUID)}` +
            `/series/${encodeURIComponent(this.seriesUID)}` +
            `/instances/${encodeURIComponent(plane.instanceUID)}/frames/${plane.frame}`;
    }

    /**
     * Windowing in the shader only means anything while the renderer's first
     * pass keeps float precision. Say so once per source rather than letting the
     * user wonder why a soft-tissue CT window has visible steps.
     */
    _warnPrecisionOnce() {
        const precision = globalThis.APPLICATION_CONTEXT?.getOption?.("webGlPrecision", "unorm8");
        if (precision === "auto") return;
        console.warn(
            `[DICOM radiology] webGlPrecision is "${precision}"; the renderer's first pass will quantize ` +
            `samples to 8 bits before the dicom-window shader reads them, so a narrow window will band. ` +
            `Set "webGlPrecision": "auto" in the session params (or the deployment setup) for full fidelity.`
        );
    }

    /* --------------------------- Depth axis --------------------------- */

    /**
     * Identity state only, synchronously — no fetching, no cache work. The
     * controller performs the repaint, and it also flips the plane briefly
     * around a `getTileUrl` call to learn the URL of a plane it is not showing.
     */
    setZDepth(index) {
        if (!this.zStack || this.zStack.count <= 1) return;
        const i = Math.max(0, Math.min(this.zStack.count - 1, parseInt(index, 10) || 0));
        this._activeZ = i;
        this.zStack.index = i;
    }

    /** The active plane's frame. There is one tile, so the grid arguments are unused. */
    getTileUrl(/* level, x, y */) {
        return (this._planes[this._activeZ] || this._planes[0])?.url ?? null;
    }

    /**
     * Deliberately z-INDEPENDENT — one tile identity across all planes, which is
     * what lets the controller layer per-plane pixels on top of a single record.
     * It must also contain the source identity, because that is how the
     * plane-change zombie purge finds this source's cache entries. OSD's default
     * returns the tile URL and is therefore plane-dependent; overriding it is
     * mandatory, not optional.
     */
    getTileHashKey(level, x, y) {
        return `${x}_${y}/${level}/${this.tileSourceId}`;
    }

    /* ----------------------------- Tiles ----------------------------- */

    /**
     * No frame batching here (yet). The URLs would group correctly — one plane
     * is one `…/frames/{n}` — but `_getRadiologyTile` resolves the plane from
     * `context.src` and decodes into the z-stack's own representation, none of
     * which the base class's per-part WSI decode knows about. Batching this
     * means teaching the batcher to delegate the per-part step, not inheriting
     * it; until then a radiology tile stays one request.
     */
    batchEnabled() { return false; }

    downloadTileStart(context) { this._getRadiologyTile(context); }

    /**
     * Fetch and decode one plane.
     *
     * The plane is resolved from `context.src` and NEVER from `this._activeZ`.
     * The depth controller and the prefetcher drive this exact method through a
     * stock `OpenSeadragon.ImageJob` with `src` set to *another* plane's URL
     * while the active index still points somewhere else — that is how the core
     * loads planes it is not currently showing. Reading `_activeZ` here would
     * apply the wrong per-plane rescale to every prefetched PET plane, which is
     * a wrong quantitative number rendered as a perfectly plausible image.
     *
     * `_planeByUrl` is the inverse of a map this source built, not a plane index
     * parsed back out of a URL — the contract forbids the latter for good reason
     * and this is not it.
     */
    async _getRadiologyTile(context) {
        const plane = this._planeByUrl.get(context.src);
        if (!plane) {
            return context.fail(`Unknown radiology plane URL: ${context.src}`, null);
        }

        let res;
        try {
            res = await this.client.fetchRaw(context.src, {
                // Never `/rendered`: the server would bake its own window into
                // 8 bits and the shader would then window that a second time.
                headers: { Accept: this._acceptHeader(false) },
            });
        } catch (e) {
            return context.fail(`Failed to fetch DICOM frame: ${e?.message ?? e}`, null);
        }

        const parts = await this.parseMultipartRelated(res);
        if (!parts.length) return context.fail("DICOM response carries no frames!", res);

        try {
            const samples = await this._decodePlaneSamples(parts[0]);
            const data = this._packNormalized(samples, plane);
            return context.finish(
                { width: this.width, height: this.height, channelCount: 1, packs: [{ format: "RGBA16F", data }] },
                res, "gpuTextureSet");
        } catch (err) {
            // No `/rendered` fallback here — see `_renderedFallback`.
            console.error("[DICOM radiology] plane decode failed", err);
            return context.fail(`Radiology plane decode failure: ${err?.message ?? err}`, res);
        }
    }

    /**
     * One multipart part -> the frame's **stored** samples.
     *
     * Compressed frames go through `_decodeFrameRaw`, which stops short of the
     * display chain. `_decodeWithCornerstone` / `_decodedToImageData` must never
     * be used here: they bake the Modality LUT, the VOI window and MONOCHROME1
     * inversion into 8-bit display bytes, which is exactly right for a slide and
     * exactly wrong for data the shader is about to window.
     */
    async _decodePlaneSamples(part) {
        const pixel = this.wsi.pixel;
        const ts = (part.headers['transfer-syntax'] || '').replace(/['"]/g, '').trim();
        const bytes = stripItemTag(part.bytes);

        if (!ts || UNCOMPRESSED_TS.has(ts)) return this._viewStoredSamples(bytes, pixel);

        const { decodedFrame } = await this._decodeFrameRaw(bytes, ts, this.width, this.height, pixel);
        const decoded = decodedFrame?.pixelData;
        if (!decoded) throw new Error(`decoder returned no samples for transfer syntax ${ts}`);
        return decoded;
    }

    /** Typed-array view over an uncompressed frame, at the declared bit depth. */
    _viewStoredSamples(bytes, pixel) {
        if (pixel?.doubleFloatPixelData) {
            const a = this._align(bytes, 8);
            return new Float64Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 8));
        }
        if (pixel?.floatPixelData) {
            const a = this._align(bytes, 4);
            return new Float32Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 4));
        }
        if ((pixel?.bitsAllocated ?? 8) > 8) {
            const a = this._align(bytes, 2);
            return pixel?.pixelRepresentation === 1
                ? new Int16Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 2))
                : new Uint16Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 2));
        }
        return bytes;
    }

    /**
     * Typed-array views need their byte offset aligned to the element size;
     * multipart parts are subarrays of one big buffer and rarely are.
     */
    _align(bytes, elementSize) {
        return (bytes.byteOffset % elementSize === 0)
            ? bytes
            : new Uint8Array(bytes.slice().buffer);
    }

    /**
     * Stored samples -> real-world values -> position within the declared range
     * -> one RGBA16F pack.
     *
     * Raw values are not uploaded. Half-float spends ~11 mantissa bits wherever
     * the numbers happen to sit, so raw Hounsfield units lose sub-unit precision
     * above 2048 and, if the context has to fall back to RGBA8, clamp to white
     * instead of banding. Normalizing spends the precision on the range that
     * actually occurs; the shader undoes it with GLSL literals so every control
     * stays in the object's own units.
     */
    _packNormalized(samples, plane) {
        const pixel = this.wsi.pixel;
        const { min, max } = this.wsi.valueRange;
        const span = (max - min) || 1;
        const lut = plane.modalityLut ?? this.wsi.modalityLut ?? null;
        const isFloat = !!(pixel?.floatPixelData || pixel?.doubleFloatPixelData);

        const count = this.width * this.height;
        const normalized = new Float32Array(count);
        const n = Math.min(count, samples.length);
        for (let i = 0; i < n; i++) {
            // Float pixel data carries real-world values already; integers are
            // stored samples that need masking + sign extension first, because
            // nothing in DICOM constrains the bits above HighBit.
            const stored = isFloat ? samples[i] : signExtendStored(samples[i], pixel);
            const t = (applyModality(stored, lut) - min) / span;
            normalized[i] = t < 0 ? 0 : (t > 1 ? 1 : t);
        }

        // One channel of an RGBA16F pack. The renderer has no R16F/RG16F format,
        // so three quarters of this is padding — recorded in UPSTREAM.md.
        const data = new Uint16Array(count * 4);
        writeHalfChannel(data, normalized, 0);
        return data;
    }

    /* --------------------- Slide-only paths, disabled --------------------- */

    /**
     * A server-rendered frame carries the server's window baked into 8 bits.
     * Substituting it for a failed decode would silently swap quantitative data
     * for a picture, and the shader would then window it a second time. Fail the
     * tile instead.
     */
    async _renderedFallback() { return null; }

    async getThumbnail() { return null; }
    async getLabel() { return null; }
    async downloadMacroImage() { return null; }
    /** Colour management is meaningless for a monochrome quantitative frame. */
    async downloadICCProfile() { return null; }

    /* ---------------------------- Metadata ---------------------------- */

    getMetadata() {
        const d = this.descriptor;
        if (!d) return { error: "Metadata missing", imageInfo: {} };

        return {
            imageInfo: {
                studyUID: this.studyUID,
                seriesUID: this.seriesUID,
                frameOfReferenceUID: d.frameOfReferenceUID,
                modality: d.modality,
                sopClass: d.sopClass,
                geometry: d.geometry,
                multiframe: d.multiframe,
                width: d.width,
                height: d.height,
                planeCount: this._planes.length,
                spacingUm: d.spacingUm,
                spacingSource: d.spacingSource,
                irregular: d.irregular,
                orderStrategy: d.orderStrategy,
                subVolumes: d.subVolumes,
                activeSubVolume: d.activeSubVolume,
                rejected: d.rejected,
                units: d.units,
                valueRange: d.valueRange,
                voiPresets: d.voiPresets,
                invert: d.invert,
                levels: this.wsi.levels,
                tileWidth: this.tileWidth,
                tileHeight: this.tileHeight,
            },
            // Micrometres, as the field is documented. DICOM PixelSpacing is in
            // millimetres and `describeRadiologySeries` already converted.
            micronsX: d.micronsX,
            micronsY: d.micronsY,
        };
    }

    /**
     * The parameters the `dicom-window` shader layer needs, in one object — the
     * analogue of `DICOMDerivedTileSource#getOverlayDescriptor`. Read by the
     * plugin's `before-open` handler so a session can declare
     * `shaders: [{type: "dicom-window"}]` with no hand-authored params.
     */
    getRadiologyDescriptor() {
        const d = this.descriptor;
        if (!d) return null;
        return {
            valueRange: d.valueRange,
            voiPresets: d.voiPresets,
            units: d.units,
            modality: d.modality,
            invert: d.invert,
            spacingUm: d.spacingUm,
            planeCount: this._planes.length,
        };
    }

    getDisplayMetadata() {
        const d = this.descriptor;
        if (!d) return [{ title: t('radiology.unavailable'), description: t('radiology.metadataMissing') }];

        const fields = [
            { label: t('radiology.modality'), value: d.modality ?? t('radiology.unknown') },
            { label: t('radiology.dimensions'), value: `${d.width} × ${d.height} px` },
        ];

        if (this._planes.length > 1) {
            fields.push({ label: t('radiology.slices'), value: this._planes.length });
            if (Number.isFinite(d.spacingUm)) {
                const mm = (d.spacingUm / 1000).toFixed(2);
                fields.push({
                    label: t('radiology.sliceSpacing'),
                    value: d.irregular ? t('radiology.spacingIrregular', { mm }) : `${mm} mm`,
                });
            }
        }

        if (Number.isFinite(d.micronsX) && Number.isFinite(d.micronsY)) {
            fields.push({
                label: t('radiology.pixelSize'),
                value: `${(d.micronsX / 1000).toFixed(3)} × ${(d.micronsY / 1000).toFixed(3)} mm`,
            });
        }

        fields.push({
            label: t('radiology.valueRange'),
            value: `${d.valueRange.min.toFixed(1)} … ${d.valueRange.max.toFixed(1)}${d.units ? ` ${d.units}` : ""}`,
        });

        if (d.voiPresets?.length) {
            const p = d.voiPresets[0];
            // The explanation is the object's own WindowCenterWidthExplanation —
            // data, rendered verbatim.
            fields.push({
                label: t('radiology.window'),
                value: `C ${p.center} / W ${p.width}${p.explanation ? ` (${p.explanation})` : ""}`,
            });
        }

        // Ordering and what was dropped are the two things a clinician needs to
        // be able to check when a stack looks wrong.
        fields.push({ label: t('radiology.planeOrdering'), value: d.orderStrategy });
        for (const r of d.rejected || []) {
            fields.push({ label: t('radiology.excluded'), value: `${r.count} × ${r.reason}` });
        }

        const sections = [{ title: d.seriesMeta?.description || t('radiology.series'), fields }];
        if (d.subVolumes?.length > 1) {
            sections.push({
                title: t('radiology.interleaved'),
                description: t('radiology.interleavedHint', {
                    count: d.subVolumes.length,
                    key: d.activeSubVolume,
                }),
            });
        }
        return sections;
    }
}
