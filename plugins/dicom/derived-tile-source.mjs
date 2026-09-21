import DicomQuery from './dicom-query.mjs';
import { DICOMWebTileSource, UNCOMPRESSED_TS } from './tile-source.mjs';
import {
    unpackBits,
    makeContinuousVoiMapper,
    applyModality,
    storedValueRange,
    writeHalfChannel,
    warnHalfFloatPrecisionOnce,
} from './pixel-pipeline.mjs';

/**
 * Tile source for DICOM derived objects rendered as an overlay layer:
 * Segmentation (1.2.840.10008.5.1.4.1.1.66.4) and Parametric Map
 * (1.2.840.10008.5.1.4.1.1.30).
 *
 * ## How this differs from the slide source
 *
 * A slide tile is one frame. A segmentation tile is *one frame per segment* at
 * the same position, and they must arrive together so the shader can address
 * segments as channels. DICOMweb allows a comma-separated frame list in a single
 * WADO-RS request, so one tile is still one HTTP round trip — the response is
 * just multipart with N parts instead of one.
 *
 * ## Alignment with the slide
 *
 * There is deliberately no level-index correspondence with the source pyramid.
 * A SEG series routinely ships at a single, downsampled resolution, so aligning
 * by level would misplace it. OSD places both tiled images with default bounds
 * (x=0, width=1, height=1/aspect), which means overlays line up exactly when
 * their TotalPixelMatrix *ratio* matches the slide's — which it does by
 * construction, since a segmentation covers the same physical area.
 *
 * ## Channel packing
 *
 * Every tile is emitted as a `gpuTextureSet`: packs uploaded as typed arrays,
 * which reach the texture with no premultiplication and no canvas round trip. Up
 * to three segments ride in R/G/B of a single `RGBA8` pack with alpha pinned to
 * 255 — a segment mask must never live in alpha, or a premultiplying upload path
 * would silently scale the other three — and beyond three segments the object
 * simply gets as many packs as it needs.
 *
 * A quantitative Parametric Map is different: it carries one channel, so it uses
 * the narrowest half-float format that holds it (`R16F`, or `RG16F` at two
 * channels) rather than paying for four components and wasting three.
 */
export class DICOMDerivedTileSource extends DICOMWebTileSource {

    constructor(options) {
        super(options);
        this.kind = options.kind === "pmap" ? "pmap" : "seg";
        this.sourceSeriesUID = options.sourceSeriesUID || null;

        // There is no `/rendered` thumbnail for a derived object, and the
        // synthetic preview level would fetch one. Opt out explicitly.
        this.__noPreviewLevel = true;
    }

    /**
     * Identity must include the role: a SEG series and the slide it overlays are
     * different sources, and several caches (ICC, preview level, z-planes) key
     * off this string.
     */
    get tileSourceId() {
        if (!this.studyUID || !this.seriesUID) return null;
        return `dicom-${this.kind}:${this.baseUrl}#${this.studyUID}/${this.seriesUID}`;
    }

    supports(data) { return data && data.type === "dicomweb-derived"; }

    /**
     * Derived objects are stored uncompressed or RLE far more often than J2K,
     * and `/rendered` is meaningless for a segment mask — always ask for the
     * original bitstream.
     */
    _acceptHeader() {
        return [
            'multipart/related; type="application/octet-stream"; transfer-syntax=1.2.840.10008.1.2.1',
            'multipart/related; type="application/octet-stream"; transfer-syntax=1.2.840.10008.1.2.5',
            'multipart/related; type="application/octet-stream"; transfer-syntax=*',
        ].join(', ');
    }

    async _initializeFromServer() {
        if (!this.seriesUID || !this.studyUID) {
            throw new Error('DICOM derived TileSource needs seriesUID and studyUID before initialization!');
        }
        if (!this.client) {
            throw new Error('DICOM derived TileSource needs an HttpClient (options.client) to initialize.');
        }

        const item = await DicomQuery.findDerivedItem(this.client, this.studyUID, this.seriesUID, this.kind);
        if (!item) {
            throw new Error(`No renderable ${this.kind.toUpperCase()} geometry in series ${this.seriesUID}`);
        }

        // The base class's level helpers (getLevelScale, getTileWidth/Height,
        // _levelInfoFor) all read `this.wsi.levels`; reusing the field keeps one
        // implementation of the pyramid maths rather than two that can drift.
        this.wsi = item;
        this.segments = item.segments;

        // A derived object shares its slide's frame of reference, so it must be
        // PLACED the same way — otherwise the overlay and the slide it annotates
        // sit differently, which on a whole-slide extent reads as a point
        // reflection rather than as an obvious rotation. The ingest already
        // stamps `level.slide` for derived instances (see DicomQuery), and the
        // base resolver is generic over `this.wsi.levels[].slide`, so it applies
        // here verbatim.
        //
        // One fetch, two answers: the slide's orientation (below) and its pixel
        // spacing (`_narrowCollapsedTileToCoverage`), both memoized per client and
        // both free once the slide itself is open.
        //
        // The expected matrix is this object's own declared TotalPixelMatrix: a
        // derived object shares its slide's frame of reference and declares the same
        // total matrix, so it names the slide's BASE level. Without it the lookup
        // took whichever instance the store listed first — on the measured store a
        // level 16x too coarse, which is what shrank a 92.7%-wide overlay to 5.8%.
        const top = item.levels[0];
        const parent = this.sourceSeriesUID
            ? await DicomQuery.slideDescriptorForSeries(this.client, this.studyUID, this.sourceSeriesUID,
                { width: top?.width, height: top?.height })
            : null;

        this._slidePlacement = this._applySlideOrientation();
        if (!this.wsi.slide) this._inheritSlideOrientation(parent);
        // After the orientation: the placement folds the resolved angle in.
        this._applyCoverageToCollapsedLevel(parent);

        this.minLevel = 0;
        this.maxLevel = item.levels.length - 1;

        this.width = top.width;
        this.height = top.height;
        this.tileWidth = top.tileWidth || 512;
        this.tileHeight = top.tileHeight || 512;

        this.photometricInterpretation = item.pixel?.photometricInterpretation || "MONOCHROME2";
        this.samplesPerPixel = item.pixel?.samplesPerPixel ?? 1;

        // Channel order is fixed here and handed to the shader layer, so segment
        // N always lands in the same channel across every tile of the session.
        this._channelOrder = this.kind === "pmap"
            ? [null]
            : item.segments.map(s => s.number);
    }

    /**
     * Adopt the parent slide's orientation when this object declares none.
     *
     * Precedence is own tag > parent's tag > unrotated, and it matters in that
     * order: a store that legitimately writes a different orientation on the
     * derived object stays honest, while the common case — an object that simply
     * does not carry (0048,0102), which is every IDC SEG and Parametric Map
     * measured — stops being drawn unrotated under a rotated slide.
     *
     * Reuses `_applySlideOrientation`, so `ignoreSlideOrientation` suppresses an
     * inherited rotation exactly as it suppresses an own one. Suppressing on one
     * side only would desynchronise the pair.
     */
    _inheritSlideOrientation(parent) {
        if (!this.sourceSeriesUID) {
            console.warn(
                `[dicom] ${this.kind.toUpperCase()} series ${this.seriesUID} declares no ` +
                `ImageOrientationSlide (0048,0102) and names no slide to inherit one from; ` +
                `it will not follow a rotated slide.`);
            return;
        }
        // The parent record may carry spacing without an orientation — the two are
        // parsed independently. Only an orientation is inheritable here.
        if (!parent?.orientation) {
            console.warn(
                `[dicom] neither ${this.kind.toUpperCase()} series ${this.seriesUID} nor the slide ` +
                `it annotates (${this.sourceSeriesUID}) declares ImageOrientationSlide (0048,0102); ` +
                `the overlay is drawn as stored.`);
            return;
        }

        const descriptor = {
            orientation: parent.orientation,
            originX: parent.originX || 0,
            originY: parent.originY || 0,
        };
        // Onto the levels, not just `this.wsi.slide`: the resolver reads
        // `levels[].slide` and is the one place that decides what a descriptor
        // means for the renderer.
        for (const level of this.wsi.levels || []) {
            if (!level.slide) level.slide = descriptor;
        }
        this._slidePlacement = this._applySlideOrientation();
        console.info(
            `[dicom] ${this.kind.toUpperCase()} series ${this.seriesUID} inherits the slide ` +
            `orientation of series ${this.sourceSeriesUID}.`);
    }

    /**
     * A collapsed object whose raster covers only part of the slide: shrink the
     * IMAGE to what it covers, and say where to put it.
     *
     * The collapse (see DicomQuery) models a one-frame object as a single logical
     * tile spanning the whole TotalPixelMatrix, assuming the raster is that matrix
     * downsampled. A Parametric Map whose scoring stops short of the slide edge
     * breaks that assumption and is stretched across the full width anyway —
     * nothing compares the raster's extent to the matrix's. The measured case: a
     * 618x349 raster at 111 slide-pixels per map-pixel covers 68598x38739 of a
     * 74003x38857 matrix, and rendered 7.9% too wide.
     *
     * The fix is placement, not the tile grid. An earlier attempt shrank
     * `tileWidth` below `width`, which silently violates OSD's core tiling
     * invariant: `getTileAtPoint` divides by `getTileWidth` while this source pins
     * `getNumTiles` to the stored grid, so points past the tile mapped to indices
     * that do not exist. Coverage could never complete, corner tiles inverted, no
     * tile was drawn, and `setDrawn()` then re-armed `_needsDraw` every frame — a
     * blank overlay and a permanently hot render loop, from one line.
     *
     * So the image becomes exactly the extent it covers (a consistent 1x1 grid,
     * `ceil(width/tileWidth) === 1`), and `getIntrinsicPlacement` reports where
     * that image belongs in the slide's normalized frame.
     */
    _applyCoverageToCollapsedLevel(parent) {
        const slideX = Number(parent?.micronsX), slideY = Number(parent?.micronsY);
        if (!(slideX > 0) || !(slideY > 0)) return;

        const levels = this.wsi.levels || [];
        // Single-level objects only. A multi-level derived object aligns through its
        // pyramid and its coarse levels legitimately look like the collapse — one
        // tile spanning the level — so this used to run on a SEG's 1024x537 level and
        // compare a base-resolution coverage against that level's own size. Only when
        // there is one level are "the level" and "the image" the same thing, which is
        // what the arithmetic below assumes.
        if (levels.length !== 1) return;

        // The spacing has to come from the slide's BASE level or the ratio is
        // meaningless. `slideDescriptorForSeries` reports which level it read, so
        // this is checkable rather than assumed.
        const level = levels[0];
        const baseW = Number(parent?.matrixWidth), baseH = Number(parent?.matrixHeight);
        if (Number.isFinite(baseW) && Number.isFinite(baseH)
            && (baseW !== level.width || baseH !== level.height)) {
            console.warn(
                `[dicom] ${this.kind.toUpperCase()} series ${this.seriesUID}: the slide instance ` +
                `carrying the spacing declares ${baseW}x${baseH} but this object declares ` +
                `${level.width}x${level.height}; cannot resolve the downsample, leaving it ` +
                `stretched to the matrix.`);
            return;
        }

        // The collapse, and only it: one logical tile spanning the whole declared
        // matrix, with a raster of its own behind it.
        if (level.tilesX !== 1 || level.tilesY !== 1) return;
        if (level.tileWidth !== level.width || level.tileHeight !== level.height) return;
        if (!(level.frameWidth > 0) || !(level.frameHeight > 0)) return;
        if (!(level.micronsX > 0) || !(level.micronsY > 0)) return;

        const matrixW = level.width, matrixH = level.height;
        const coveredW = Math.round(level.frameWidth * (level.micronsX / slideX));
        const coveredH = Math.round(level.frameHeight * (level.micronsY / slideY));
        if (!(coveredW > 0) || !(coveredH > 0)) return;

        // Declared coverage beyond the declared matrix is the file contradicting
        // itself. Cropping on that basis would look plausible and be wrong.
        if (coveredW > matrixW || coveredH > matrixH) {
            console.warn(
                `[dicom] ${this.kind.toUpperCase()} series ${this.seriesUID}: raster covers ` +
                `${coveredW}x${coveredH} at the declared spacing but TotalPixelMatrix is ` +
                `${matrixW}x${matrixH}; leaving it stretched to the matrix.`);
            return;
        }

        // Within a pixel of the full matrix is the ordinary case — the raster IS the
        // whole slide, rounded. Re-placing it then would move it for nothing.
        const tolX = Math.ceil(level.micronsX / slideX), tolY = Math.ceil(level.micronsY / slideY);
        if ((matrixW - coveredW) <= tolX && (matrixH - coveredH) <= tolY) return;

        level.width = coveredW;
        level.height = coveredH;
        level.tileWidth = coveredW;
        level.tileHeight = coveredH;
        this._coveragePlacement = this._placementFor(level, matrixW, matrixH, slideX, slideY);

        console.info(
            `[dicom] ${this.kind.toUpperCase()} series ${this.seriesUID}: ${level.frameWidth}x` +
            `${level.frameHeight} raster covers ${coveredW}x${coveredH} of ` +
            `${matrixW}x${matrixH} — placed, remainder of the slide left empty.`);
    }

    /**
     * Where the covered rect belongs, in the slide's normalized frame.
     *
     * OSD normalizes by WIDTH, so every term divides by the matrix width — the
     * frame in which the slide itself is `(0, 0, 1, matrixH/matrixW)`.
     *
     * The pivot is the subtle part. OSD rotates each tiled image about **its own**
     * bounds centre (`_getRotationPoint` = `getBoundsNoRotate().getCenter()`), not
     * about a shared origin. The slide and this overlay resolve the same angle but
     * no longer have the same bounds, so placing the rect where the content
     * literally sits would leave the two diverging by `(R - I)*dc`. Rotating the
     * rect's centre about the slide's centre first cancels that exactly: at 180
     * degrees, content occupying the left 92.7% correctly renders in the right
     * 92.7%. Reduces to the identity when there is no rotation.
     */
    _placementFor(level, matrixW, matrixH, slideX, slideY) {
        // TotalPixelMatrixOrigin is millimetres in the slide frame; the slide's own
        // spacing turns it into matrix pixels. Zero for every object measured so
        // far, but an object that declares one is placed by it rather than ignored.
        const originMm = this.wsi?.slide || {};
        const originPxX = (Number(originMm.originX) || 0) * 1000 / slideX;
        const originPxY = (Number(originMm.originY) || 0) * 1000 / slideY;

        const w = level.width / matrixW;
        const h = level.height / matrixW;
        const x = originPxX / matrixW;
        const y = originPxY / matrixW;

        const degrees = Number(this._slidePlacement?.degrees) || 0;
        const rad = degrees * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);

        const cx = x + w / 2, cy = y + h / 2;
        const bx = 0.5, by = 0.5 * (matrixH / matrixW);
        const dx = cx - bx, dy = cy - by;

        return {
            x: (bx + dx * cos - dy * sin) - w / 2,
            y: (by + dx * sin + dy * cos) - h / 2,
            width: w,
            degrees,
        };
    }

    /**
     * Rotation from the file, plus the sub-region this object covers when it does
     * not cover the whole slide. `_placementFor` already folded the rotation in.
     */
    getIntrinsicPlacement() {
        return this._coveragePlacement || this._slidePlacement;
    }

    getMetadata() {
        if (!this.wsi?.levels?.length) return { error: "Metadata missing", imageInfo: {} };
        return {
            imageInfo: {
                studyUID: this.studyUID,
                seriesUID: this.seriesUID,
                sourceSeriesUID: this.sourceSeriesUID,
                kind: this.kind,
                segments: this.segments,
                segmentationType: this.wsi.segmentationType,
                levels: this.wsi.levels,
                tileWidth: this.tileWidth,
                tileHeight: this.tileHeight,
                channelOrder: this._channelOrder,
            },
        };
    }

    /**
     * Describe the overlay for the shader layer: channel index, label and
     * colour per segment. Consumed when the plugin assembles the visualization
     * config, so the shader's defaults already match the DICOM object.
     */
    getOverlayDescriptor() {
        if (this.kind === "pmap") {
            return {
                kind: "pmap",
                channels: [{ index: 0, label: this.wsi?.modalityLut?.explanation || null }],
                units: this.wsi?.modalityLut?.units || null,
                voiPresets: this.wsi?.voiLut?.presets || [],
                // Samples are normalized against this range; the shader needs it
                // to read them back in real-world units.
                valueRange: this.getValueRange(),
                highPrecision: this._usesHighPrecision(),
                // The object supplies its own colour map; the user-selectable
                // one does not apply.
                hasPalette: !!this._paletteLut(),
            };
        }
        return {
            kind: "seg",
            segmentationType: this.wsi?.segmentationType || null,
            channels: (this.segments || []).map((s, i) => ({
                index: i,
                number: s.number,
                label: s.label,
                color: s.color,
                category: s.category,
                type: s.type,
            })),
        };
    }

    /**
     * One URL per tile, listing every frame that tile needs. The frame list is
     * also the cache key, which is exactly right: two tiles that need different
     * frames must not share a cache entry.
     */
    getTileUrl(level, x, y) {
        const L = this.wsi.levels[this.maxLevel - level];
        const frames = this._framesForTile(L, x, y);
        const base = `${this.baseUrl}/studies/${this.studyUID}/series/${this.seriesUID}` +
            `/instances/${L?.instanceUID}/frames`;
        // No frames at this position — a legitimate, common state for a sparse
        // segmentation. The URL is never fetched (see downloadTileStart), it only
        // has to be stable and unique.
        if (!frames.length) return `${base}/none#${x}_${y}`;
        return `${base}/${frames.map(f => f.frame).join(',')}`;
    }

    /**
     * @returns {Array<{channel:number, segNumber:?number, frame:number}>} in
     *   ascending frame order, which is the order the server returns the parts.
     */
    _framesForTile(level, x, y) {
        const cell = level?.frames?.[`${x}_${y}`];
        if (!cell) return [];

        const out = [];
        const order = this._channelOrder || [];
        for (let channel = 0; channel < order.length; channel++) {
            const segNumber = order[channel];
            // A parametric map has a single unnamed plane; the cell then holds
            // exactly one entry whose key we do not care about.
            const frame = segNumber == null ? Object.values(cell)[0] : cell[segNumber];
            if (Number.isFinite(frame) && frame > 0) out.push({ channel, segNumber, frame });
        }
        // WADO-RS returns parts in the order the frames were requested; sorting
        // here keeps the request canonical so equivalent tiles share a URL.
        out.sort((a, b) => a.frame - b.frame);
        return out;
    }

    /**
     * No frame batching here. A derived tile is ALREADY a multi-frame request —
     * `getTileUrl` packs this cell's segment/channel frames into one
     * `…/frames/1,2,3` URL — and `_getDerivedTile` composes those parts into a
     * single texture set. The base class's batcher groups whole tiles by frame
     * number and decodes each part as an independent WSI tile, which is the
     * wrong shape entirely; inheriting it would route every overlay tile through
     * the slide decoder.
     */
    batchEnabled() { return false; }

    downloadTileStart(context) { this._getDerivedTile(context); }

    async _getDerivedTile(context) {
        const level = context.tile?.level;
        const L = this._levelInfoFor(level);

        // The raster size, not the logical tile size. For a whole-slide
        // Parametric Map the logical tile spans the entire matrix while the
        // frame itself is a few hundred pixels across — allocating a canvas at
        // the logical size would try to make a 52002×35748 bitmap.
        const tileW = L?.frameWidth || (level != null ? this.getTileWidth(level) : this.tileWidth) || 256;
        const tileH = L?.frameHeight || (level != null ? this.getTileHeight(level) : this.tileHeight) || 256;

        const requests = this._framesForTile(L, context.tile?.x, context.tile?.y);

        // Nothing segmented here. Emit a transparent tile instead of a request:
        // sparse segmentations would otherwise generate a storm of 404s.
        if (!requests.length) {
            return context.finish(this._transparentTextureSet(tileW, tileH), null, "gpuTextureSet");
        }

        let res;
        try {
            res = await this.client.fetchRaw(context.src, { headers: { Accept: this._acceptHeader() } });
        } catch (e) {
            return context.fail(`Failed to fetch ${this.kind.toUpperCase()} frames: ${e?.message ?? e}`, null);
        }

        let parts;
        try {
            parts = await this.parseMultipartRelated(res);
        } catch (e) {
            return context.fail(`Malformed ${this.kind.toUpperCase()} frame response: ${e?.message ?? e}`, res);
        }
        if (parts.length !== requests.length) {
            // Partial responses would silently shift every segment by one
            // channel, painting segment B in segment A's colour.
            return context.fail(
                `Expected ${requests.length} frame part(s), server returned ${parts.length}`, res);
        }

        // An object with its own Palette Color LUT is rendered exactly as its
        // author specified: the full DICOM chain is baked here and the tile
        // arrives display-ready.
        const palette = this._paletteLut();
        if (palette && this.kind === "pmap") {
            try {
                return context.finish(
                    this._composePaletteTile(await this._decodePlanePalette(parts[0], tileW, tileH, L, palette),
                        tileW, tileH),
                    res, "gpuTextureSet");
            } catch (e) {
                return context.fail(`Failed to decode palette frame: ${e?.message ?? e}`, res);
            }
        }

        // Parametric maps keep their real values: the samples are normalized to
        // the object's declared range and uploaded as half-floats, and the VOI
        // window is applied in the shader. That is what makes window/level a
        // live slider instead of a tile-cache invalidation.
        if (this._usesHighPrecision()) {
            try {
                const planes = await Promise.all(parts.map(part =>
                    this._decodePlaneNormalized(part, tileW, tileH, L)));
                return context.finish(
                    this._composeHalfFloatSet(planes, requests, tileW, tileH,
                        (this._channelOrder || []).length),
                    res, "gpuTextureSet");
            } catch (e) {
                return context.fail(`Failed to decode ${this.kind.toUpperCase()} frame: ${e?.message ?? e}`, res);
            }
        }

        let planes;
        try {
            planes = await Promise.all(parts.map((part, i) =>
                this._decodePlane(part, tileW, tileH, L)));
        } catch (e) {
            return context.fail(`Failed to decode ${this.kind.toUpperCase()} frame: ${e?.message ?? e}`, res);
        }

        const channelCount = (this._channelOrder || []).length;
        try {
            if (channelCount <= 3) {
                return context.finish(
                    this._composeRgbTextureSet(planes, requests, tileW, tileH),
                    res, "gpuTextureSet");
            }
            return context.finish(
                this._composeTextureSet(planes, requests, tileW, tileH, channelCount),
                res, "gpuTextureSet");
        } catch (e) {
            return context.fail(`Failed to compose ${this.kind.toUpperCase()} tile: ${e?.message ?? e}`, res);
        }
    }

    /**
     * Decode one frame part into a `Uint8Array` of `w*h` display values (0..255).
     *
     * BINARY segmentations are 1 bit per pixel and are unpacked here rather than
     * handed to cornerstone, which has no 1-bit path. FRACTIONAL segmentations
     * are rescaled by MaximumFractionalValue — assuming 255 would darken a
     * probability map encoded against a maximum of, say, 100.
     */
    async _decodePlane(part, w, h, level) {
        const pixel = level?.pixel || this.wsi?.pixel;
        const bytes = part.bytes;
        const count = w * h;
        const ts = (part.headers['transfer-syntax'] || '').replace(/['"]/g, '').trim();
        // No declared transfer syntax means the server returned the frame as
        // stored; for a derived object that is native little endian in practice.
        const uncompressed = !ts || UNCOMPRESSED_TS.has(ts);

        if (pixel?.bitsAllocated === 1) {
            if (!uncompressed) {
                throw new Error(`1-bit segmentation in unsupported transfer syntax ${ts}`);
            }
            const bits = unpackBits(bytes, count);
            const out = new Uint8Array(count);
            for (let i = 0; i < count; i++) out[i] = bits[i] ? 255 : 0;
            return out;
        }

        if (this.kind === "seg" && uncompressed && pixel?.bitsAllocated === 8) {
            // FRACTIONAL: values run 0..MaximumFractionalValue, which is NOT
            // always 255 — a probability map declared against 100 would render
            // 2.5× too dark if the maximum were assumed.
            const max = this.wsi?.maximumFractionalValue || 255;
            const out = new Uint8Array(count);
            const scale = 255 / max;
            for (let i = 0; i < count; i++) {
                const v = bytes[i] ?? 0;
                out[i] = v >= max ? 255 : Math.round(v * scale);
            }
            return out;
        }

        // Float Pixel Data (7FE0,0008) / Double Float Pixel Data (7FE0,0009):
        // the Parametric Map form. No integer decoder handles these, and there
        // is no stored range to normalize by — the window comes from the object's
        // own VOI, or from the Real World Value first/last mapped pair.
        if (pixel?.floatPixelData || pixel?.doubleFloatPixelData) {
            if (!uncompressed) {
                throw new Error(`float parametric map in unsupported transfer syntax ${ts}`);
            }
            const map = this._continuousMapper(level);
            const out = new Uint8Array(count);
            const aligned = bytes.byteOffset % 8 === 0
                ? bytes
                : new Uint8Array(bytes.slice().buffer);   // typed-array views need alignment
            const samples = pixel.doubleFloatPixelData
                ? new Float64Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / 8))
                : new Float32Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / 4));
            const n = Math.min(count, samples.length);
            for (let i = 0; i < n; i++) out[i] = map(samples[i]);
            return out;
        }

        // Everything else (RLE, JPEG-LS, 16-bit parametric maps) goes through the
        // ordinary decoder, then the Modality+VOI chain. Note this bakes the
        // window into the tile: until the renderer carries high-precision
        // samples through its first pass, changing window/level means dropping
        // the tile cache (see DICOMWebTileSource#setVoiWindow).
        const decoded = await this._decodeWithCornerstone(bytes, ts, w, h, level, true);
        return this._planeFromDecoded(decoded, w, h);
    }

    /**
     * Whether this object's samples are quantitative and must reach the shader
     * unquantized. True for parametric maps; segmentation masks are inherently
     * 0..1 coverage values and gain nothing from a float target — keeping them
     * on the 8-bit path avoids doubling the renderer's offscreen memory for no
     * benefit.
     */
    _usesHighPrecision() {
        // An object carrying its own Palette Color LUT has already decided how
        // its values map to colour, so there is nothing quantitative left for
        // the shader to do — and the float-target upgrade costs the WHOLE renderer
        // double offscreen memory. Bake that one on the CPU instead.
        return this.kind === "pmap" && !this._paletteLut();
    }

    /** The object's own Palette Color LUT, if it declares one. */
    _paletteLut() {
        return this.wsi?.paletteLut ?? null;
    }

    /**
     * The real-world value interval samples are normalized against.
     *
     * Normalizing (rather than uploading raw values) does two things: it spends
     * half-float's ~11 mantissa bits across the range that actually occurs, and
     * it degrades sensibly if the renderer has to fall back to RGBA8 — the tile
     * ends up banded rather than clamped to white, which raw Hounsfield units
     * would be.
     */
    getValueRange() {
        const r = this.wsi?.valueRange;
        if (r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.max > r.min) return r;

        // No RealWorldValueMapping. The stored range put through the Modality LUT
        // is still a real answer — it is what the radiology path uses — and it beats
        // the 0..1 assumption, which normalizes a 16-bit map into its bottom
        // 1/65535 and then clamps everything above 1 flat. Only integer pixels have
        // a bit-depth-derived range; float pixel data genuinely has none.
        const pixel = this.wsi?.pixel;
        if (pixel && !pixel.floatPixelData && !pixel.doubleFloatPixelData) {
            const stored = storedValueRange(pixel, this.wsi?.modalityLut ?? null);
            if (Number.isFinite(stored?.min) && Number.isFinite(stored?.max) && stored.max > stored.min) {
                return stored;
            }
        }
        return { min: 0, max: 1 };
    }

    /**
     * Decode one frame into normalized [0,1] floats: stored value -> Modality
     * LUT -> real-world value -> position within the declared range.
     */
    async _decodePlaneNormalized(part, w, h, level) {
        const pixel = level?.pixel || this.wsi?.pixel;
        const bytes = part.bytes;
        const count = w * h;
        const ts = (part.headers['transfer-syntax'] || '').replace(/['"]/g, '').trim();
        if (ts && !UNCOMPRESSED_TS.has(ts)) {
            throw new Error(`quantitative frame in unsupported transfer syntax ${ts}`);
        }

        const { min, max } = this.getValueRange();
        const span = max - min;
        const modality = this.wsi?.modalityLut ?? null;
        const out = new Float32Array(count);

        let samples;
        if (pixel?.doubleFloatPixelData) {
            const a = this._align(bytes, 8);
            samples = new Float64Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 8));
        } else if (pixel?.floatPixelData) {
            const a = this._align(bytes, 4);
            samples = new Float32Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 4));
        } else if ((pixel?.bitsAllocated ?? 8) > 8) {
            const a = this._align(bytes, 2);
            samples = pixel?.pixelRepresentation === 1
                ? new Int16Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 2))
                : new Uint16Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 2));
        } else {
            samples = bytes;
        }

        const n = Math.min(count, samples.length);
        let outsideLo = Infinity, outsideHi = -Infinity, outside = 0;
        for (let i = 0; i < n; i++) {
            const real = applyModality(samples[i], modality);
            const t = (real - min) / span;
            if (t < 0 || t > 1) {
                outside++;
                if (real < outsideLo) outsideLo = real;
                if (real > outsideHi) outsideHi = real;
            }
            out[i] = t < 0 ? 0 : (t > 1 ? 1 : t);
        }
        // The clamp is necessary — the half-float pack is a normalized 0..1 channel
        // — but it is destructive: everything past the declared range becomes one
        // flat saturated plateau in the tile cache, and no window setting can undo
        // it. Silence made that indistinguishable from real data. If this fires, the
        // declared range is wrong, not the pixels.
        if (outside) {
            this._warnedOutOfRange = this._warnedOutOfRange || new Set();
            const key = `${outsideLo}:${outsideHi}`;
            if (!this._warnedOutOfRange.has(key)) {
                this._warnedOutOfRange.add(key);
                console.warn(
                    `[dicom] ${this.kind.toUpperCase()} series ${this.seriesUID}: ${outside} of ${n} ` +
                    `samples fall outside the declared range [${min}, ${max}] (seen ` +
                    `[${outsideLo}, ${outsideHi}]) and were clamped. Check ` +
                    `RealWorldValueMapping (0040,9096) on this object.`);
            }
        }
        return out;
    }

    /**
     * Decode one frame through the FULL DICOM display chain, ending in the
     * object's own Palette Color LUT: stored value -> Modality LUT -> VOI ->
     * palette index -> RGB.
     *
     * The palette is applied at full fidelity (up to 65536 entries) — the same
     * treatment `DICOMWebTileSource#_decodedToImageData` gives a PALETTE COLOR
     * slide. Nothing is subsampled.
     *
     * @returns {{rgb: Uint8Array, alpha: Uint8Array}} per-pixel colour, plus the
     *   windowed value as coverage so low values stay transparent.
     */
    async _decodePlanePalette(part, w, h, level, palette) {
        const pixel = level?.pixel || this.wsi?.pixel;
        const count = w * h;
        const ts = (part.headers['transfer-syntax'] || '').replace(/['"]/g, '').trim();
        if (ts && !UNCOMPRESSED_TS.has(ts)) {
            throw new Error(`palette frame in unsupported transfer syntax ${ts}`);
        }

        const bytes = part.bytes;
        let samples;
        if (pixel?.doubleFloatPixelData) {
            const a = this._align(bytes, 8);
            samples = new Float64Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 8));
        } else if (pixel?.floatPixelData) {
            const a = this._align(bytes, 4);
            samples = new Float32Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 4));
        } else if ((pixel?.bitsAllocated ?? 8) > 8) {
            const a = this._align(bytes, 2);
            samples = pixel?.pixelRepresentation === 1
                ? new Int16Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 2))
                : new Uint16Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 2));
        } else {
            samples = bytes;
        }

        // Modality LUT + VOI, in real-world units — same mapper the float path
        // uses, so both routes window identically.
        const map = this._continuousMapper(level);
        const last = palette.size - 1;
        const rgb = new Uint8Array(count * 3);
        const alpha = new Uint8Array(count);

        const n = Math.min(count, samples.length);
        for (let i = 0; i < n; i++) {
            const windowed = map(samples[i]);              // 0..255
            // The palette is indexed by the *stored* value offset by the
            // descriptor's first-mapped entry (PS3.3 C.7.9.2), not by the
            // windowed display value.
            let idx = Math.round(samples[i]) - palette.firstMapped;
            if (idx < 0) idx = 0; else if (idx > last) idx = last;

            const o = i * 3;
            rgb[o] = palette.r[idx];
            rgb[o + 1] = palette.g[idx];
            rgb[o + 2] = palette.b[idx];
            alpha[i] = windowed;
        }
        return { rgb, alpha };
    }

    /**
     * Pack palette-mapped colour into one RGBA8 texture pack.
     *
     * A `gpuTextureSet` rather than an ImageBitmap because the alpha channel
     * carries data: typed-array uploads never premultiply, whereas
     * `createImageBitmap` may hand back a premultiplied surface and scale the
     * RGB by it — the same reason `_composeRgbTextureSet` keeps masks out of alpha.
     */
    _composePaletteTile({ rgb, alpha }, w, h) {
        const data = new Uint8Array(w * h * 4);
        for (let i = 0, o = 0, s = 0; i < alpha.length; i++, o += 4, s += 3) {
            data[o] = rgb[s];
            data[o + 1] = rgb[s + 1];
            data[o + 2] = rgb[s + 2];
            data[o + 3] = alpha[i];
        }
        return { width: w, height: h, channelCount: 4, packs: [{ format: "RGBA8", data }] };
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
     * Pack normalized planes into half-float texture packs, in the narrowest
     * format that holds them.
     *
     * A Parametric Map is always ONE channel (`_channelOrder` is `[null]`), so
     * the RGBA16F pack this used to emit unconditionally was three quarters
     * zeroes. `R16F` / `RG16F` are core WebGL2 sized formats, filterable, and
     * need no capability gate — only rendering *into* half-float does, which
     * never happens for an input texture.
     *
     * Alpha is usable here (unlike the ImageBitmap path) because typed-array
     * uploads never premultiply — which is why the ≥3-channel case still fills
     * all four components.
     */
    _composeHalfFloatSet(planes, requests, w, h, channelCount) {
        warnHalfFloatPrecisionOnce(`DICOM ${this.kind}`);

        const channels = Math.max(channelCount, 1);
        const componentsPerPack = channels === 1 ? 1 : (channels === 2 ? 2 : 4);
        const format = componentsPerPack === 1 ? "R16F"
            : (componentsPerPack === 2 ? "RG16F" : "RGBA16F");

        const packCount = Math.ceil(channels / componentsPerPack);
        const packs = [];
        for (let p = 0; p < packCount; p++) {
            packs.push({ format, data: new Uint16Array(w * h * componentsPerPack) });
        }

        for (let i = 0; i < planes.length; i++) {
            const channel = requests[i].channel;
            // Division rather than `>> 2` / `& 3`: identical at four components,
            // correct at one and two.
            writeHalfChannel(
                packs[Math.floor(channel / componentsPerPack)].data,
                planes[i],
                channel % componentsPerPack,
                componentsPerPack);
        }

        return { width: w, height: h, channelCount: channels, packs };
    }

    /**
     * Window/level mapper for float samples, cached on the level. Rebuilt only
     * when the window changes, which `setVoiWindow` signals by clearing it.
     */
    _continuousMapper(level) {
        const host = level || this.wsi;
        if (host?.__voiMapper) return host.__voiMapper;

        const mapper = makeContinuousVoiMapper({
            modalityLut: this.wsi?.modalityLut ?? null,
            voiLut: this.wsi?.voiLut ?? null,
            valueRange: this.wsi?.valueRange ?? null,
            window: this._voiWindowOverride || null,
            presetIndex: this._voiPresetIndex ?? 0,
        });
        if (host) host.__voiMapper = mapper;
        return mapper;
    }

    setVoiWindow(spec = {}) {
        super.setVoiWindow(spec);
        for (const level of (this.wsi?.levels || [])) level.__voiMapper = undefined;
        if (this.wsi) this.wsi.__voiMapper = undefined;
    }

    /**
     * Pull a single intensity channel out of the decoder's RGBA output.
     *
     * The decoder is asked for `ImageData` rather than an `ImageBitmap`
     * precisely so this stays a buffer walk: reading a bitmap back would mean
     * drawing it into a canvas and calling `getImageData`, which blocks on a GPU
     * readback for every plane of every tile.
     */
    _planeFromDecoded(imageData, w, h) {
        const rgba = imageData.data;
        const out = new Uint8Array(w * h);
        // The decoder already applied the grayscale display chain for monochrome
        // frames, so the red channel carries the mapped intensity.
        for (let i = 0, o = 0; i < out.length; i++, o += 4) out[i] = rgba[o];
        return out;
    }

    /**
     * Pack up to three planes into R/G/B of a single RGBA8 pack. Alpha stays
     * opaque — see the class comment for why a mask must never live in the alpha
     * channel here.
     *
     * The layout is what an RGBA bitmap of the same tile would have contained,
     * so the renderer sees identical pack metadata (one pack, four channels,
     * unorm8) either way. Emitting the buffer directly skips a canvas,
     * `putImageData`, `createImageBitmap`, and the renderer's conversion back.
     */
    _composeRgbTextureSet(planes, requests, w, h) {
        const data = new Uint8Array(w * h * 4);

        for (let i = 0, o = 3; i < w * h; i++, o += 4) data[o] = 255;

        for (let p = 0; p < planes.length; p++) {
            const channel = requests[p].channel;
            if (channel > 2) continue;
            const plane = planes[p];
            for (let i = 0, o = channel; i < plane.length; i++, o += 4) data[o] = plane[i];
        }

        return { width: w, height: h, channelCount: 4, packs: [{ format: "RGBA8", data }] };
    }

    /**
     * Emit a `gpuTextureSet` for objects with more than three segments: packs of
     * four channels each, uploaded as typed arrays with no premultiplication.
     */
    _composeTextureSet(planes, requests, w, h, channelCount) {
        const packCount = Math.ceil(channelCount / 4);
        const packs = [];
        for (let p = 0; p < packCount; p++) {
            packs.push({ format: "RGBA8", data: new Uint8Array(w * h * 4) });
        }

        for (let i = 0; i < planes.length; i++) {
            const channel = requests[i].channel;
            const pack = packs[channel >> 2];
            const offset = channel & 3;
            const plane = planes[i];
            const data = pack.data;
            for (let px = 0, o = offset; px < plane.length; px++, o += 4) data[o] = plane[px];
        }

        return { width: w, height: h, channelCount, packs };
    }

    /**
     * A fully-transparent tile, in the same shape as every other tile this
     * source emits. The buffer is allocated per tile rather than shared: the
     * renderer owns what it is handed, and a cache eviction must not reach a
     * buffer another live tile is still uploading from.
     */
    _transparentTextureSet(w, h) {
        // Dispatched exactly like a real tile, with no planes to write. Emitting a
        // fixed RGBA8 pack here was right only for the ≤3-channel case: a sparse
        // tile of a high-precision Parametric Map handed the renderer an RGBA8
        // pack while every sibling tile of the same layer is R16F, and a >4-segment
        // SEG got one pack where its siblings have several. Zero-filled means
        // "nothing here" in every one of those encodings.
        const channelCount = (this._channelOrder || []).length;
        if (this._usesHighPrecision()) {
            return this._composeHalfFloatSet([], [], w, h, channelCount);
        }
        if (channelCount <= 3) {
            return this._composeRgbTextureSet([], [], w, h);
        }
        return this._composeTextureSet([], [], w, h, channelCount);
    }

    /** Derived objects have no label/overview instances. */
    async getThumbnail() { return null; }
    async getLabel() { return null; }
    async downloadMacroImage() { return null; }
    async downloadICCProfile() { return null; }
}
