/**
 * Magic wand: press and drag over the image to add what the wand detects to an annotation,
 * right-drag (or Alt + drag) to remove it.
 *
 * Nothing is detected while merely hovering. Detection used to re-run on every pointer move
 * from the single raw pixel under the cursor, which made the result jump with each pixel of
 * mouse travel and left a "growth" threshold as the only control. Now:
 *
 *  - the viewport is read ONCE per viewport state (core `visualization` API), at CSS-pixel
 *    resolution, and a stroke works on that frozen frame;
 *  - every seed compares against the AVERAGE colour of its 5x5 neighbourhood, not one pixel;
 *  - a stroke only ever grows its region: seeds along the drag are flood-filled and unioned;
 *  - the region is merged into / cut out of the annotation by the brush engine
 *    (`FreeFormTool.applyMask`), so holes, multipolygons, undo and annotations reaching
 *    outside the viewport behave exactly like the brush tools.
 */
OSDAnnotations.MagicWand = class extends OSDAnnotations.StateFreeFormTool {
    constructor(context) {
        super(context, "magic-wand", "ph-magic-wand", "🆃  automatic selection wand");
        this.MagicWand = OSDAnnotations.makeMagicWand();

        // Per-channel tolerance on the 0-255 scale.
        this.threshold = 24;
        this.minThreshold = 1;
        this.maxThreshold = 100;
        // single mouse scroll is +- 100 value
        this.thStep = 3 / 100;

        this._selectedShader = null;
        this.disabled = true;

        this._snapshot = null;
        this._snapshotPromise = null;
        this._invalid = true;
        // Bumped by every invalidation, so a read that was in flight when the pixels changed
        // cannot mark itself valid on arrival.
        this._invalidSeq = 0;
        this._stroke = null;
        this._pumping = false;
        this._pumpAgain = false;

        this._watchedViewer = null;
        this._watchedRenderer = null;
        this._onViewChanged = () => {
            this._invalidate();
            // Re-read eagerly, so the next press usually finds the frame ready.
            if (!this._stroke && this._watchedViewer) this._requestSnapshot();
        };

        VIEWER_MANAGER.broadcastHandler('visualization-used', () => this._invalidate());
    }

    _invalidate() {
        this._invalid = true;
        this._invalidSeq++;
    }

    get log() {
        if (!this._log) this._log = APPLICATION_CONTEXT.log("module.annotations:magic-wand");
        return this._log;
    }

    /********************* PURE HELPERS (unit tested) *********************/

    /**
     * Mean colour of the (2r+1)^2 neighbourhood of a pixel, ignoring fully transparent pixels.
     * @param {{data: ArrayLike<number>, width: number, height: number}} image RGBA
     * @param {number} px
     * @param {number} py
     * @param {number} [radius=2]
     * @return {number[]|null} [R, G, B, A], null if the pixel itself is outside or transparent
     */
    static averageColor(image, px, py, radius = 2) {
        const { data, width: w, height: h } = image;
        if (!(px >= 0 && py >= 0 && px < w && py < h)) return null;
        if (data[(py * w + px) * 4 + 3] === 0) return null;

        let r = 0, g = 0, b = 0, a = 0, n = 0;
        const y1 = Math.min(h - 1, py + radius), x1 = Math.min(w - 1, px + radius);
        for (let y = Math.max(0, py - radius); y <= y1; y++) {
            for (let x = Math.max(0, px - radius); x <= x1; x++) {
                const i = (y * w + x) * 4;
                if (data[i + 3] === 0) continue;
                r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3];
                n++;
            }
        }
        return [r / n, g / n, b / n, a / n];
    }

    /**
     * Points every `step` pixels on the segment from -> to, `from` excluded and `to` included.
     * @return {{x: number, y: number}[]}
     */
    static seedsAlong(from, to, step) {
        const dx = to.x - from.x, dy = to.y - from.y;
        const count = Math.max(1, Math.ceil(Math.hypot(dx, dy) / step));
        const out = [];
        for (let i = 1; i <= count; i++) {
            out.push({ x: Math.round(from.x + dx * i / count), y: Math.round(from.y + dy * i / count) });
        }
        return out;
    }

    /**
     * Fill enclosed holes of at most `maxArea` pixels, in place. Tissue texture leaves a
     * colour-based fill full of specks; each would otherwise become a hole of a multipolygon.
     * @param {{data: Uint8Array, width: number, bounds: object}} mask
     * @param {number} maxArea
     */
    static fillSmallHoles(mask, maxArea) {
        const { data, width: w, bounds: b } = mask;
        const bw = b.maxX - b.minX + 1, bh = b.maxY - b.minY + 1;
        if (bw < 3 || bh < 3) return;

        const seen = new Uint8Array(bw * bh);
        const stack = new Int32Array(bw * bh);
        for (let sy = 0; sy < bh; sy++) {
            for (let sx = 0; sx < bw; sx++) {
                const start = sy * bw + sx;
                if (seen[start] || data[(sy + b.minY) * w + sx + b.minX]) continue;

                // Collect one 4-connected component of empty pixels. It is a hole only if it
                // never reaches the edge of the bounds - beyond them everything is empty.
                let top = 0, size = 0, open = false;
                stack[top++] = start;
                seen[start] = 1;
                while (top > 0) {
                    const k = stack[--top];
                    stack[bw * bh - 1 - size] = k; // members are kept from the other end
                    size++;
                    const x = k % bw, y = (k - x) / bw;
                    if (x === 0 || y === 0 || x === bw - 1 || y === bh - 1) open = true;
                    for (let d = 0; d < 4; d++) {
                        const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
                        const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
                        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
                        const nk = ny * bw + nx;
                        if (seen[nk] || data[(ny + b.minY) * w + nx + b.minX]) continue;
                        seen[nk] = 1;
                        stack[top++] = nk;
                    }
                }
                if (open || size > maxArea) continue;
                for (let m = 0; m < size; m++) {
                    const k = stack[bw * bh - 1 - m];
                    const x = k % bw;
                    data[((k - x) / bw + b.minY) * w + x + b.minX] = 1;
                }
            }
        }
    }

    /**
     * Nearest pixel around (px, py), itself first, that is within tolerance of the sample
     * and not selected yet.
     * @return {{x: number, y: number}|null}
     */
    static _matchingStart(image, selected, px, py, sample, tolerance, radius = 2) {
        const { data, width: w, height: h } = image;
        let best = null, bestDistance = Infinity;
        for (let y = Math.max(0, py - radius), y1 = Math.min(h - 1, py + radius); y <= y1; y++) {
            for (let x = Math.max(0, px - radius), x1 = Math.min(w - 1, px + radius); x <= x1; x++) {
                const distance = (x - px) * (x - px) + (y - py) * (y - py);
                if (distance >= bestDistance || selected[y * w + x]) continue;
                const i = (y * w + x) * 4;
                if (data[i + 3] === 0
                    || Math.abs(data[i] - sample[0]) > tolerance
                    || Math.abs(data[i + 1] - sample[1]) > tolerance
                    || Math.abs(data[i + 2] - sample[2]) > tolerance
                    || Math.abs(data[i + 3] - sample[3]) > tolerance) continue;
                best = { x, y };
                bestDistance = distance;
            }
        }
        return best;
    }

    /**
     * Flood-fill from one seed against the averaged colour around it and union the result
     * into the accumulated mask.
     * @param {object} lib magic wand library (OSDAnnotations.makeMagicWand())
     * @param {{data: ArrayLike<number>, width: number, height: number, bytes: number}} image
     * @param {{data: Uint8Array, bounds: object|null}} region accumulated mask, modified
     * @param {number} px
     * @param {number} py
     * @param {number} tolerance
     * @param {number} maxArea a fill larger than this is a leak and is discarded
     * @return {"added"|"none"|"leak"}
     */
    static growRegion(lib, image, region, px, py, tolerance, maxArea) {
        const w = image.width;
        if (!(px >= 0 && py >= 0 && px < w && py < image.height)) return "none";
        if (region.data[py * w + px]) return "none";

        const sample = OSDAnnotations.MagicWand.averageColor(image, px, py);
        if (!sample) return "none";

        // The fill starts by testing its own start pixel, and an outlier under the cursor fails
        // the test against the mean of its surroundings. Start from the nearest pixel of the
        // sampled window that does belong to that mean instead.
        const start = OSDAnnotations.MagicWand._matchingStart(image, region.data, px, py, sample, tolerance);
        if (!start) return "none";
        px = start.x;
        py = start.y;

        const fill = lib.floodFill(image, px, py, tolerance, tolerance, region.data, false, sample);
        if (!fill || fill.bounds.maxX < fill.bounds.minX || fill.bounds.maxY < fill.bounds.minY) return "none";

        const f = fill.bounds, src = fill.data;
        let area = 0;
        for (let y = f.minY; y <= f.maxY; y++) {
            for (let k = y * w + f.minX, end = y * w + f.maxX; k <= end; k++) area += src[k];
        }
        if (area === 0) return "none";
        if (area > maxArea) return "leak";

        const dst = region.data;
        for (let y = f.minY; y <= f.maxY; y++) {
            for (let k = y * w + f.minX, end = y * w + f.maxX; k <= end; k++) {
                if (src[k]) dst[k] = 1;
            }
        }
        const b = region.bounds;
        region.bounds = b ? {
            minX: Math.min(b.minX, f.minX), minY: Math.min(b.minY, f.minY),
            maxX: Math.max(b.maxX, f.maxX), maxY: Math.max(b.maxY, f.maxY)
        } : { ...f };
        return "added";
    }

    /********************* SNAPSHOT *********************/

    _refreshLayers(viewer = this.context.viewer) {
        // Re-read the layer stack every time: the constructor runs before the first slide
        // is open, so a snapshot of the order taken there says "nothing to annotate" forever.
        const order = viewer?.drawer?.renderer?.getShaderLayerOrder?.() || [];
        this.disabled = !order.length;
        if (!order.includes(this._selectedShader)) this._selectedShader = order[0];
    }

    _viewportKey() {
        const viewport = this.context.viewer.viewport;
        const b = viewport.getBoundsNoRotateWithMargins(true);
        const size = viewport.getContainerSize();
        return [
            b.x, b.y, b.width, b.height, size.x, size.y,
            viewport.getRotation(true), viewport.getFlip(), this._selectedShader
        ].join(",");
    }

    async _takeSnapshot() {
        const viewer = this.context.viewer;
        // One frame, so the live first pass this read re-uses is the one for the current view.
        await new Promise(r => requestAnimationFrame(r));

        const key = this._viewportKey();
        const size = viewer.viewport.getContainerSize();
        // CSS-pixel resolution, capped: averages out per-pixel noise, makes the result
        // independent of the device pixel ratio and bounds the cost of a fill.
        const scale = Math.min(1, OSDAnnotations.MagicWand.MAX_SIDE / Math.max(size.x, size.y));
        const width = Math.max(1, Math.round(size.x * scale));
        const height = Math.max(1, Math.round(size.y * scale));

        const out = await this.readViewportLayers({
            layers: { shaderIds: [this._selectedShader] },
            transparent: true,
            width, height,
            maxPixels: width * height,
        });
        return {
            data: out.data, width: out.width, height: out.height, bytes: 4,
            cssWidth: size.x, cssHeight: size.y,
            key, viewer, isComplete: out.isComplete !== false,
        };
    }

    /**
     * Single-flight: the read is serialized per viewer in core anyway, and two passes for
     * the same view would only race each other for `this._snapshot`.
     * @return {Promise<object|null>} the snapshot, or null when it failed
     */
    _requestSnapshot() {
        if (!this._snapshotPromise) {
            const seq = this._invalidSeq;
            this._snapshotPromise = this._takeSnapshot().then(snapshot => {
                this._snapshot = snapshot;
                // A frame read while tiles were streaming is usable, not trustworthy: keep
                // it for the stroke that asked, read again for the next one.
                this._invalid = !snapshot.isComplete || seq !== this._invalidSeq;
                return snapshot;
            }).catch(e => {
                this.log.warn("viewport snapshot failed", e);
                this._snapshot = null;
                return null;
            }).finally(() => {
                this._snapshotPromise = null;
            });
        }
        return this._snapshotPromise;
    }

    async _ensureSnapshot() {
        const viewer = this.context.viewer;
        for (let attempt = 0; attempt < 2; attempt++) {
            const snapshot = this._snapshot;
            if (snapshot && !this._invalid && !this._snapshotPromise
                && snapshot.viewer === viewer && snapshot.key === this._viewportKey()) {
                return snapshot;
            }
            const fresh = await this._requestSnapshot();
            // Joined a read started for another view (or viewer): go once more.
            if (fresh && fresh.viewer === viewer && fresh.key === this._viewportKey()) return fresh;
        }
        return null;
    }

    _bindWatchers(viewer) {
        if (!viewer || this._watchedViewer === viewer) return;
        this._unbindWatchers();
        viewer.addHandler('animation-finish', this._onViewChanged);
        this._watchedViewer = viewer;
        // Control edits (slider, colour, channel mapping) change the pixels without moving
        // the view.
        const renderer = viewer.drawer && viewer.drawer.renderer;
        if (renderer && typeof renderer.addHandler === 'function') {
            renderer.addHandler('visualization-change', this._onViewChanged);
            this._watchedRenderer = renderer;
        }
    }

    _unbindWatchers() {
        if (this._watchedViewer) {
            this._watchedViewer.removeHandler('animation-finish', this._onViewChanged);
            this._watchedViewer = null;
        }
        if (this._watchedRenderer && typeof this._watchedRenderer.removeHandler === 'function') {
            this._watchedRenderer.removeHandler('visualization-change', this._onViewChanged);
        }
        this._watchedRenderer = null;
    }

    /********************* STROKE *********************/

    handleClickDown(o, point, isLeftClick, objectFactory) {
        this._refreshLayers();
        const add = isLeftClick && !o.altKey;
        // Removing needs no preset: it only ever edits what is already there.
        if (this.disabled || (add && !objectFactory)) {
            this.abortClick(isLeftClick);
            Dialogs.show($.t(this.disabled ? 'autoSelect.noData' : 'autoSelect.noPreset', { ns: 'annotations' }));
            return;
        }

        // A press that lands before the previous stroke was flushed (its snapshot was still
        // being read) closes that one with whatever it has.
        if (this._stroke) this._endStroke(this._stroke);
        this.context.fabric.clearAnnotationSelection(true);

        this._stroke = {
            add,
            viewer: this.context.viewer,
            points: [point],
            seeds: [],
            last: null,
            target: this._findTarget(point),
            region: null,
            started: false,
            released: false,
            leaked: false,
            grown: false,
            canvas: null, ctx: null, image: null,
        };
        this._schedule();
    }

    handleMouseMove(e, point) {
        const stroke = this._stroke;
        if (!stroke || stroke.released) return;
        stroke.points.push(point);
        this._schedule();
    }

    handleClickUp(o, point, isLeftClick, objectFactory) {
        const stroke = this._stroke;
        if (stroke && !stroke.released) {
            stroke.released = true;
            this._schedule();
        }
        // Always consumed, right button included: a wand release is never a selection
        // click, nor a request for the context menu.
        return true;
    }

    handleMouseHover(event, point) {
        // Deliberately nothing: the wand acts on a press, never on a hover.
    }

    /**
     * The editable annotation under an image point, if any.
     */
    _findTarget(point) {
        const ffTool = this.context.freeFormTool;
        // About two screen pixels around the point, in image pixels.
        const r = 2 / (this.context.viewer.scalebar.imagePixelSizeOnScreen() || 1);
        const probe = [
            { x: point.x - r, y: point.y - r }, { x: point.x + r, y: point.y - r },
            { x: point.x + r, y: point.y + r }, { x: point.x - r, y: point.y + r },
        ];
        const found = this.fftFindTarget(point, ffTool, probe, 0, r);
        return this.fftFoundIntersection(found) ? found : null;
    }

    _schedule() {
        if (this._pumping) {
            this._pumpAgain = true;
            return;
        }
        this._pumping = true;
        requestAnimationFrame(() => {
            this._pump().catch(e => {
                this.log.warn("magic wand stroke failed", e);
                if (this._stroke) this._endStroke(this._stroke);
            }).finally(() => {
                this._pumping = false;
                if (this._pumpAgain) {
                    this._pumpAgain = false;
                    this._schedule();
                }
            });
        });
    }

    async _pump() {
        const stroke = this._stroke;
        if (!stroke) return;

        // The frame is frozen for the whole stroke: OSD navigation is off in this mode.
        const snapshot = stroke.snapshot || await this._ensureSnapshot();
        if (stroke !== this._stroke) return;
        if (!snapshot || stroke.viewer !== this.context.viewer) {
            this._endStroke(stroke);
            return;
        }
        stroke.snapshot = snapshot;

        const moved = stroke.points.length > 0;
        const grown = this._grow(stroke, snapshot);
        // A removing stroke that began on empty space has a region but no annotation yet:
        // keep looking for one as the pointer travels, even when nothing new was detected.
        const seeking = !stroke.started && !stroke.add && moved && !!stroke.region.bounds;
        if (grown || seeking) this._apply(stroke, snapshot);

        if (stroke.seeds.length || stroke.points.length) this._pumpAgain = true;
        else if (stroke.released) this._endStroke(stroke);
    }

    /**
     * Turn the queued pointer positions into seeds and fill from a bounded number of them.
     * @return {boolean} true if the stroke region grew
     */
    _grow(stroke, snapshot) {
        const Wand = OSDAnnotations.MagicWand;
        const w = snapshot.width, h = snapshot.height;
        const ref = stroke.viewer.scalebar.getReferencedTiledImage();
        const sx = w / snapshot.cssWidth, sy = h / snapshot.cssHeight;

        for (const point of stroke.points) {
            const el = ref.imageToViewerElementCoordinates(new OpenSeadragon.Point(point.x, point.y));
            const next = { x: Math.floor(el.x * sx), y: Math.floor(el.y * sy) };
            if (stroke.last) stroke.seeds.push(...Wand.seedsAlong(stroke.last, next, Wand.SEED_STEP));
            else stroke.seeds.push(next);
            stroke.last = next;
            stroke.lastPoint = point;
        }
        stroke.points.length = 0;

        if (!stroke.region) stroke.region = { data: new Uint8Array(w * h), bounds: null };

        const maxArea = w * h * Wand.LEAK_RATIO;
        let fills = 0, grown = false;
        while (stroke.seeds.length && fills < Wand.MAX_FILLS_PER_FRAME) {
            const seed = stroke.seeds.shift();
            const outcome = Wand.growRegion(this.MagicWand, snapshot, stroke.region,
                seed.x, seed.y, this.threshold, maxArea);
            if (outcome === "none") continue;
            fills++;
            if (outcome === "leak") stroke.leaked = true;
            else grown = true;
        }
        return grown;
    }

    /**
     * Hand the accumulated region to the brush engine.
     */
    _apply(stroke, snapshot) {
        const Wand = OSDAnnotations.MagicWand;
        const ffTool = this.context.freeFormTool;
        const w = snapshot.width, h = snapshot.height;

        let mask = { data: stroke.region.data, width: w, height: h, bounds: { ...stroke.region.bounds } };
        // Returns a copy: the raw region stays the "visited" set of the fills to come.
        mask = this.MagicWand.gaussBlurOnlyBorder(mask, Wand.BLUR_RADIUS);
        Wand.fillSmallHoles(mask, Wand.MAX_HOLE_AREA);

        if (!stroke.started && !this._start(stroke, snapshot, mask)) return;
        if (!ffTool.isRunning()) return;

        if (!stroke.canvas) {
            stroke.canvas = document.createElement('canvas');
            stroke.canvas.width = w;
            stroke.canvas.height = h;
            stroke.ctx = stroke.canvas.getContext('2d');
            stroke.image = stroke.ctx.createImageData(w, h);
        }
        // White adds, black removes, transparent leaves alone (FreeFormTool.applyMask).
        const b = mask.bounds, px = stroke.image.data, src = mask.data, color = stroke.add ? 255 : 0;
        for (let y = b.minY; y <= b.maxY; y++) {
            for (let x = b.minX; x <= b.maxX; x++) {
                const k = y * w + x, i = k * 4;
                if (src[k]) {
                    px[i] = px[i + 1] = px[i + 2] = color;
                    px[i + 3] = 255;
                } else {
                    px[i + 3] = 0;
                }
            }
        }
        stroke.ctx.putImageData(stroke.image, 0, 0, b.minX, b.minY, b.maxX - b.minX + 1, b.maxY - b.minY + 1);

        if (ffTool.applyMask(stroke.canvas)) stroke.grown = true;
    }

    /**
     * Bind the stroke to the annotation it edits: the one found under the press, the first
     * one a removing stroke reaches, or a new polygon made from the detected region.
     * @return {boolean} true once the brush engine holds an object
     */
    _start(stroke, snapshot, mask) {
        const ffTool = this.context.freeFormTool;
        ffTool.zoom = this.context.fabric.canvas.getZoom();

        if (!stroke.target && !stroke.add && stroke.lastPoint) {
            stroke.target = this._findTarget(stroke.lastPoint);
        }

        if (stroke.target) {
            ffTool.init(stroke.target, false);
        } else if (stroke.add) {
            const polygon = this._polygonFromMask(stroke, snapshot, mask);
            if (!polygon) return false;
            ffTool.init(polygon, true);
        } else {
            return false;
        }

        // init() refuses objects that cannot be turned into a polygon (and says so).
        stroke.started = true;
        return ffTool.isRunning();
    }

    _polygonFromMask(stroke, snapshot, mask) {
        let outer = null;
        for (const contour of this.MagicWand.traceContours(mask)) {
            if (!contour.inner && (!outer || contour.points.length > outer.length)) outer = contour.points;
        }
        if (!outer || outer.length < 3) return null;

        const ref = stroke.viewer.scalebar.getReferencedTiledImage();
        const sx = snapshot.cssWidth / snapshot.width, sy = snapshot.cssHeight / snapshot.height;
        const points = outer.map(p => ref.viewerElementToImageCoordinates(
            new OpenSeadragon.Point((p.x + 0.5) * sx, (p.y + 0.5) * sy)));
        return this.context.polygonFactory.create(points, this.context.presets.getAnnotationOptions(true));
    }

    _endStroke(stroke) {
        if (this._stroke === stroke) this._stroke = null;

        const ffTool = this.context.freeFormTool;
        if (stroke.started && ffTool.isRunning()) {
            ffTool.finish();
            this.context.fabric.rerender();
        }
        // The only refusal worth a message: every fill of the stroke ran away, so from the
        // user's side the press did nothing at all.
        if (stroke.leaked && !stroke.grown) {
            Dialogs.show($.t('autoSelect.coversViewport', { ns: 'annotations' }), 4000, Dialogs.MSG_INFO);
        }
    }

    /********************* MODE *********************/

    locksViewer(oldViewerRef, newViewerRef) {
        const willKeepViewer = super.locksViewer(oldViewerRef, newViewerRef);
        if (!willKeepViewer) {
            if (this._stroke) this._endStroke(this._stroke);
            this._snapshot = null;
            this._invalidate();
            this._unbindWatchers();
            if (newViewerRef) {
                this._refreshLayers(newViewerRef);
                // The owner switches only after this returns, so `context.viewer`
                // is still the viewer being left.
                this._bindWatchers(newViewerRef);
            }
        }
        return willKeepViewer;
    }

    scroll(event, delta) {
        this.threshold = Math.min(this.maxThreshold,
            Math.max(this.minThreshold, this.threshold - Math.round(delta * this.thStep)));
        if (this._thresholdInput) this._thresholdInput.value = this.threshold;
    }

    scrollZooming(event, delta) {
        this._invalidate();
    }

    setFromAuto() {
        this._refreshLayers();
        if (this.disabled) {
            Dialogs.show($.t('autoSelect.noData', { ns: 'annotations' }));
            return false;
        }

        this._bindWatchers(this.context.viewer);
        this._invalidate();
        this._requestSnapshot();

        this.context.setOSDTracking(false);
        this.context.setCursors("crosshair");
        return true;
    }

    setToAuto(temporary) {
        if (this._stroke) this._endStroke(this._stroke);
        this._unbindWatchers();
        this._snapshot = null;
        this._invalidate();

        if (temporary) return false;
        this.context.setOSDTracking(true);
        this.context.fabric.rerender();
        return true;
    }

    get defaultKeyCombo() {
        return "KeyT";
    }

    setThreshold(value) {
        const parsed = Number.parseInt(value);
        if (!Number.isFinite(parsed)) return;
        this.threshold = Math.min(this.maxThreshold, Math.max(this.minThreshold, parsed));
    }

    setShaderToDetectFrom(value) {
        this._selectedShader = value;
        this._refreshLayers();
        this._invalidate();
    }

    /**
     * Mode-options panel content (the `customControls()` contract): real nodes
     * with listeners bound to this mode. Layer names come from the session
     * visualization and are rendered as text.
     *
     * The panel is a narrow vertical column, not the old horizontal toolbar:
     * lay the controls out as label-over-control rows. Widths are inline
     * because the purged `tailwind.min.css` drops many utility classes.
     */
    customControls() {
        const { div, label, input } = globalThis.van.tags;
        this._refreshLayers();
        const renderer = this.context.viewer.drawer.renderer;
        const layers = renderer.getShaderLayerOrder().map(shaderId => ({
            value: shaderId,
            text: renderer.getShaderLayerConfig(shaderId)?.name ?? shaderId,
        }));

        const t = key => $.t(`modeOptions.magicWand.${key}`, { ns: 'annotations' });
        const mode = this;
        const row = "display:flex;flex-direction:column;gap:0.25rem;";
        const caption = "text-xs font-medium opacity-70";

        // Kept so scroll() can mirror a wheel-driven change into the slider.
        this._thresholdInput = input({
            type: "range", id: "a-magic-wand-threshold", title: t('toleranceHint'),
            class: "range range-xs range-primary", style: "width:100%;",
            min: this.minThreshold, max: this.maxThreshold, value: this.threshold,
            oninput: function () { mode.setThreshold(this.value); },
        });

        const layerSelect = new UI.Select({
            id: "a-magic-wand-layer",
            selected: this._selectedShader,
            onchange: function () { mode.setShaderToDetectFrom(this.value); },
            extraProperties: { style: "width:100%; margin:0;" },
        }, ...layers);

        return div(
            { style: "display:flex;flex-direction:column;gap:0.75rem;width:14rem;max-width:100%;padding:0.25rem;" },
            div({ class: "text-xs opacity-70" }, t('hint')),
            div({ style: row },
                label({ class: caption, for: "a-magic-wand-threshold" }, t('tolerance')),
                this._thresholdInput),
            div({ style: row },
                label({ class: caption, for: "a-magic-wand-layer" }, t('layer')),
                layerSelect.create()),
        );
    }
};

/** Longest side of the analysed frame, in pixels. */
OSDAnnotations.MagicWand.MAX_SIDE = 1400;
/** Distance between two seeds along a drag, in analysed pixels. */
OSDAnnotations.MagicWand.SEED_STEP = 4;
/** Fills per animation frame; the rest of a fast drag is caught up on the next frames. */
OSDAnnotations.MagicWand.MAX_FILLS_PER_FRAME = 8;
/** A single fill covering more of the frame than this ran away and is dropped. */
OSDAnnotations.MagicWand.LEAK_RATIO = 0.6;
/** Border smoothing of the region, in analysed pixels. */
OSDAnnotations.MagicWand.BLUR_RADIUS = 3;
/** Enclosed specks up to this many analysed pixels are filled instead of becoming holes. */
OSDAnnotations.MagicWand.MAX_HOLE_AREA = 400;
