OSDAnnotations.ViewportSegmentation = class extends OSDAnnotations.AnnotationState {
    constructor(context) {
        super(context, "viewport-segmentation", "ph-bounding-box", "🆄  viewport segmentation");
        this.MagicWand = OSDAnnotations.makeMagicWand();

        this.annotations = [];
        // Cache key for the last computed pass. The mask is NOT seeded from the
        // cursor - _getBinaryMask marks every pixel above the alpha threshold -
        // so the result depends only on (snapshot identity, is the sample over
        // the overlay). Keying on that pair is what makes the short-circuit
        // safe; the old boolean `_lastAlpha` could not tell two snapshots apart
        // and wedged the mode permanently once a pass produced nothing.
        this._lastSampleKey = null;
        // Why the last pass produced no annotation, so a click can explain it.
        // One of: null | 'ok' | 'covers-viewport' | 'empty' | 'snapshot-failed'.
        this._lastResult = null;
        // Hover runs async at pointer rate; only the newest pass may mutate state.
        this._hoverSeq = 0;
        this.ratio = OpenSeadragon.pixelDensityRatio;
        this._tiRef = null;

        VIEWER_MANAGER.broadcastHandler('visualization-used', () => {
            this.prepareShaderConfig();
            this._invalidData = Date.now();
        });

        // Seed only. The constructor runs before the first slide is open, so this
        // snapshot of the config would say "nothing to segment" for the whole
        // session; prepareShaderConfig() re-reads the live shader stack, the same
        // way magic-wand.js does.
        this.disabled = APPLICATION_CONTEXT.config.visualizations.length < 1;

        this._invalidate = () => { this._invalidData = Date.now(); };
        this._framewatchViewer = null;
    }

    get log() {
        if (!this._log) this._log = APPLICATION_CONTEXT.log("module.annotations:viewport-segmentation");
        return this._log;
    }

    /**
     * The tiled image every screen<->image coordinate mapping goes through.
     * Resolved lazily and re-resolved after a viewer switch: it used to be
     * assigned only in setFromAuto(), so in a multi-viewport grid the mode kept
     * mapping through the viewer it was activated in (AGENTS.md section 6).
     */
    _referenceTiledImage() {
        const viewer = this.context.viewer;
        if (!viewer || !viewer.scalebar) return null;
        if (!this._tiRef || this._tiRefViewer !== viewer) {
            this._tiRef = viewer.scalebar.getReferencedTiledImage();
            this._tiRefViewer = viewer;
        }
        return this._tiRef;
    }

    /**
     * Invalidate every cached derivation of the current snapshot. Called
     * wherever the snapshot itself stops being authoritative, so a stale
     * short-circuit can never outlive the pixels it was computed from.
     */
    _resetPassCache() {
        this._lastSampleKey = null;
        this._lastResult = null;
    }

    _bindFrameWatchers(viewer) {
        if (!viewer || this._framewatchViewer === viewer) return;
        this._unbindFrameWatchers();
        // Settle-only invalidation. `update-viewport` fires every draw frame and
        // would re-stamp _invalidData on each background tile-load, forcing a
        // shader recompile on every hover. The handler's viewport-key check
        // (handleMouseHover) catches genuine pan/zoom changes — we only need a
        // signal for state that the key can't see (control edits → below).
        viewer.addHandler('animation-finish', this._invalidate);
        this._framewatchViewer = viewer;

        // 'visualization-change' fires on control edits (slider, color, inverse,
        // visibility, channel mapping) with reason: "control-change". Without
        // this the cached snapshot keeps stale control values.
        const renderer = viewer.drawer && viewer.drawer.renderer;
        if (renderer && typeof renderer.addHandler === 'function') {
            renderer.addHandler('visualization-change', this._invalidate);
            this._framewatchRenderer = renderer;
        }
    }

    _unbindFrameWatchers() {
        const viewer = this._framewatchViewer;
        if (viewer) {
            viewer.removeHandler('animation-finish', this._invalidate);
            this._framewatchViewer = null;
        }
        const renderer = this._framewatchRenderer;
        if (renderer && typeof renderer.removeHandler === 'function') {
            renderer.removeHandler('visualization-change', this._invalidate);
            this._framewatchRenderer = null;
        }
    }

    handleClickUp(o, point, isLeftClick, objectFactory) {
        if (this._allowCreation && this.annotations) {
            for (let i = 0; i < this.annotations.length; i++) {
                const annot = this.annotations[i];
                // Strip the preview/highlight markers so the committed
                // annotation looks like every other annotation of the preset.
                // The factory's onZoom path will rescale strokeWidth on the
                // next zoom event.
                delete annot.strokeDashArray;
                delete annot.isHighlight;
                delete annot.strokeLineCap;
                if (annot.originalStrokeWidth) annot.strokeWidth = annot.originalStrokeWidth;
                this.context.fabric.deleteHelperAnnotation(annot);
                this.context.fabric.addAnnotation(annot);
            }

            this.annotations = [];
            this._allowCreation = false;
            this._resetPassCache();
        }
        // A click with nothing detected is a no-op: the tool stays active so
        // the user can keep hovering. Leaving is done through the toolbar,
        // another mode shortcut, or Escape.

        return true;
    }

    handleClickDown(o, point, isLeftClick, objectFactory) {
        const noViz = !this._renderConfig || Object.keys(this._renderConfig).length === 0;
        if (!objectFactory || this.disabled || noViz) {
            this.abortClick(isLeftClick);
            let key;
            if (this.disabled) key = 'autoSelect.noOverlays';
            else if (noViz) key = 'autoSelect.noVisualizationLayer';
            else key = 'autoSelect.noPreset';
            Dialogs.show($.t(key, { ns: 'annotations' }));
            return;
        }

        // Hovering is deliberately silent - a mode that detects on every pointer
        // move cannot talk. The click is where the user asks for a result, so it
        // is also the only place a refusal is worth explaining, and it explains
        // the ACTUAL cause: "refused because it would have covered everything"
        // and "the offscreen read failed" used to look identical (both nothing).
        if (!this.annotations || this.annotations.length === 0) {
            const reason = this._refusalLocaleKey();
            if (reason) Dialogs.show($.t(reason, { ns: 'annotations' }), 4000, Dialogs.MSG_INFO);
        }

        this._allowCreation = true;
        this.context.fabric.clearAnnotationSelection(true);
        this._isLeft = isLeftClick;
    }

    /**
     * Locale key explaining why the last pass produced nothing, or null when
     * there is nothing to explain (a result exists, or the user never hovered).
     * @return {string|null}
     */
    _refusalLocaleKey() {
        switch (this._lastResult) {
            case 'covers-viewport': return 'autoSelect.coversViewport';
            case 'snapshot-failed': return 'autoSelect.snapshotFailed';
            case 'empty':           return 'autoSelect.nothingHere';
            default:                return null;
        }
    }

    locksViewer(oldViewerRef, newViewerRef) {
        const willKeepViewer = super.locksViewer(oldViewerRef, newViewerRef);
        if (!willKeepViewer) {
            this._cleanState();
            this._unbindFrameWatchers();
            // The snapshot, the coordinate reference and every cached derivation
            // belong to the viewer we are leaving. Re-bind against the new one so
            // the mode keeps working instead of mapping through the old slide.
            this.data = null;
            this._tiRef = null;
            this._tiRefViewer = null;
            this._lastViewportKey = null;
            this._resetPassCache();
            this._invalidData = Date.now();
            if (newViewerRef) this._bindFrameWatchers(this.context.viewer);
        }
        return willKeepViewer;
    }

    /**
     * Hover is dispatched un-awaited from annotations-canvas.js, so it must never
     * reject: an unhandled rejection is invisible to the user and leaves the mode
     * looking dead. Everything is funnelled through _hover() and any throw is
     * recorded as a refusal the next click can explain.
     */
    handleMouseHover(event, point) {
        const seq = ++this._hoverSeq;
        return this._hover(point, seq).catch(e => {
            if (seq !== this._hoverSeq) return;
            this.log.warn("viewport segmentation hover failed", e);
            this._lastResult = 'snapshot-failed';
            this._cleanState();
        });
    }

    async _hover(point, seq) {
        // Bind a preset on hover, not only on click-down: this mode detects
        // while hovering, so waiting for annotations-canvas' click-down
        // fallback left the very first activation of the tool completely dead.
        if (!this.context.presets.ensureActivePreset(true) || this.isZooming) {
            this._invalidData = Date.now();
            return;
        }
        if (!this._renderConfig || Object.keys(this._renderConfig).length === 0) {
            this._invalidData = Date.now();
            return;
        }

        this._isLeft = true;

        const key = this._viewportKey();

        // `|| this._snapshotPromise` mirrors magic-wand.js: while a snapshot is in
        // flight the cached pixels still describe the PREVIOUS viewport, so a hover
        // arriving mid-flight must join that pass rather than trust `this.data`.
        const needsNewScreenshot =
            !this.data ||
            this._invalidData ||
            this._snapshotPromise ||
            this._lastViewportKey !== key;

        if (needsNewScreenshot) {
            // Yield one frame so the main viewer's first-pass for the current
            // viewport has a chance to render before we steal its textures.
            await new Promise(r => requestAnimationFrame(r));
            const snapshot = await this._requestSnapshot();
            // A newer hover took over while we waited - it owns the state now.
            if (seq !== this._hoverSeq) return;

            // Only claim the key when the viewport still matches what was
            // captured. _requestSnapshot joins an in-flight pass, which may have
            // been started for a different viewport; stamping the key regardless
            // is what used to freeze the mode on a stale frame until the next
            // pan/zoom.
            const settledKey = this._viewportKey();
            this._lastViewportKey = (snapshot && settledKey === key) ? key : null;
            this._resetPassCache();
            if (!snapshot) {
                this._lastResult = 'snapshot-failed';
                this._cleanState();
                return;
            }
        }

        if (!this.data) return;

        const overOverlay = this._getPixelAlpha(point);
        // The mask is not seeded from the cursor, so the only thing the sample
        // contributes is whether we are over the overlay at all. Key the cache on
        // that plus the snapshot identity - never on the sample alone, which
        // cannot distinguish two different snapshots and used to wedge the mode.
        const sampleKey = `${this._lastViewportKey}|${overOverlay ? 1 : 0}`;

        if (!overOverlay) {
            // Cursor is over background. There is nothing to trace: tracing the
            // complement would select the entire non-visualization area, which is
            // exactly the "it grows huge" behaviour the coverage guard exists to
            // prevent. Clear any stale preview and wait.
            if (this.annotations && this.annotations.length) this._cleanState();
            this._lastSampleKey = sampleKey;
            this._lastResult = 'empty';
            return;
        }
        if (this._lastSampleKey === sampleKey) {
            return;
        }
        this._lastSampleKey = sampleKey;

        this.data.binaryMask = this._getBinaryMask(this.data.data, this.data.width, this.data.height);
        if (!this.data.binaryMask.bounds) {
            this._lastResult = 'empty';
            this._cleanState();
            return;
        }

        this.data.binaryMask = this.MagicWand.gaussBlurOnlyBorder(this.data.binaryMask, 5);

        let contours = this.MagicWand.traceContours(this.data.binaryMask);
        contours = this.MagicWand.simplifyContours(contours, 0, 30);

        let { outerContours, innerContours } = this._categorizeContours(contours);
        let annotationsPoints = this._processContours(outerContours, innerContours);
        if (seq !== this._hoverSeq) return;

        this._createAnnotations(annotationsPoints);

        if (this.annotations.length > 0) this._lastResult = 'ok';
        else if (this._droppedCovering > 0) this._lastResult = 'covers-viewport';
        else this._lastResult = 'empty';
    }

    _viewportKey() {
        const viewport = this.context.viewer.viewport;
        const b = viewport.getBoundsNoRotateWithMargins(true);
        return [
            b.x, b.y, b.width, b.height,
            viewport.getRotation(true),
            viewport.getZoom(true)
        ].join(",");
    }

    scrollZooming(event, delta) {
        this._invalidData = Date.now();
    }

    setFromAuto() {
        // Detection is hover-driven, so a mode that cannot detect anything is
        // simply dead: refuse to enter it and say why, instead of waiting for
        // a click to surface the same message.
        if (!this.context.presets.ensureActivePreset(true)) {
            Dialogs.show($.t('autoSelect.noPreset', { ns: 'annotations' }));
            return false;
        }

        // Resolve the coordinate reference and the shader stack BEFORE testing
        // `disabled`: it is only seeded in the constructor, which runs before the
        // first slide opens, and prepareShaderConfig() is what makes it describe
        // the live renderer.
        this._tiRef = null;
        this._tiRefViewer = null;
        this._referenceTiledImage();
        this.prepareShaderConfig();
        if (this.disabled) {
            Dialogs.show($.t('autoSelect.noOverlays', { ns: 'annotations' }));
            return false;
        }
        if (!this._renderConfig || Object.keys(this._renderConfig).length === 0) {
            Dialogs.show($.t('autoSelect.noVisualizationLayer', { ns: 'annotations' }));
            return false;
        }

        this._bindFrameWatchers(this.context.viewer);
        this._resetPassCache();
        this._requestSnapshot();

        this.context.setOSDTracking(false);
        this.context.setCursors("crosshair");
        return true;
    }

    setToAuto(temporary) {
        this._cleanState();
        this._unbindFrameWatchers();

        this.data = null;
        // Any snapshot still in flight belongs to the session we are leaving.
        this._lastViewportKey = null;
        this._resetPassCache();
        this._hoverSeq++;
        this._invalidData = Date.now();
        if (temporary) return false;
        this.context.setOSDTracking(true);
        return true;
    }

    get defaultKeyCombo() {
        return "KeyU";
    }

    prepareShaderConfig() {
        // Fired from a global 'visualization-used' broadcast too, which can land
        // before this viewer has a drawer at all.
        const viewer = this.context.viewer;
        if (!viewer || !viewer.drawer || !viewer.drawer.renderer) return;

        // for some reason change in drawer completely wrongs the logics
        // of reading the texture, so the drawer must be recreated

        if (!this.drawer || this.drawer.viewer !== this.context.viewer) {
            // Dev-only render capture; no-op unless the debug window is open.
            APPLICATION_CONTEXT.renderDebug?.unregisterDrawer?.(this.drawer);
            this.drawer = OpenSeadragon.makeStandaloneFlexDrawer(this.context.viewer, {
                // The segmentation mask IS the alpha channel, so this pass has to
                // composite onto transparency instead of the viewer's backdrop.
                // Without it a deployment with an opaque `setup.backgroundColor`
                // (white, the common case) returns alpha 255 for every pixel, the
                // mask becomes the whole viewport and the coverage guard rejects
                // it - "the detected region fills the whole viewport" on a heatmap
                // that plainly does not.
                //
                // Both are construction-time only: presentationClearColor has no
                // setter, and backgroundColor (the shader-stack seed) is inert
                // until the next shader compile.
                presentationClearColor: [0, 0, 0, 0],
                backgroundColor: "#00000000",
                // Pin a private WebGL context: in shared-context mode the default
                // framebuffer behind `renderer.gl` is the shared scratch canvas,
                // not this drawer's output, and prepareViewportScreenshot's
                // readPixels would sample a blank surface.
                sharedContextKey: null,
            });
            APPLICATION_CONTEXT.renderDebug?.registerDrawer?.(this.drawer, {
                label: "viewport-segmentation", viewer: this.context.viewer, kind: "offscreen"
            });
        }

        // Re-read the layer stack every time. `disabled` is seeded in the
        // constructor, which runs before the first slide is open, so without this
        // it would report "nothing to segment" for the whole session - the same
        // reason magic-wand.js recomputes it here.
        this.disabled = this.context.viewer.drawer.renderer.getShaderLayerOrder().length < 1;

        this._renderConfig = this._buildEffectiveConfig();
        if (Object.keys(this._renderConfig).length === 0) {
            this.data = null;
        }
    }

    // Build the shader config map handed to drawWithConfiguration from the
    // live renderer state. Each entry is a shallow top-level copy of the live
    // config; cache (opacity, threshold, color, inverse, use_channelX, …) is
    // preserved on cfg.cache and read by the standalone shader's controls via
    // loadProperty() during construct().
    _buildEffectiveConfig() {
        const renderer = this.context.viewer.drawer.renderer;
        const order = renderer.getShaderLayerOrder() || [];
        const out = {};
        for (const id of this._visualizationShaderIds(order)) {
            const cfg = renderer.getShaderLayerConfig(id);
            if (!cfg || cfg.error) continue;
            if (cfg.visible === 0 || cfg.visible === false) continue;
            // Pass the live config through. User-edited values live on cfg.cache;
            // the standalone shader's controls read them via loadProperty() during
            // construct(). Do not spread cache into params — slider controls need
            // their full {default, min, max, step, …} definition from the shader
            // type's defaultControls, which a scalar in params would collapse.
            //
            // ...but force compositing to "show". Every other use_mode blends
            // against the layer UNDERNEATH: the 'mask' blend function is
            // literally `if (fg.a == 0) return vec4(0); return bg;`. This pass
            // deliberately omits the background layers, so "underneath" is the
            // transparent seed colour and a heatmap configured as a mask
            // composites to fully transparent — the readback comes back empty
            // and the tool detects nothing at all. We only care where each layer
            // paints, not what it looks like over the slide.
            //
            // The cache is COPIED, never mutated: it is the same object the live
            // renderer reads, and use_mode is resolved from it whenever the
            // config value is not forced (flex-renderer loadProperty).
            out[id] = {
                ...cfg,
                use_mode: "show",
                cache: { ...(cfg.cache || {}), use_mode: "show" }
            };
        }
        return out;
    }

    /**
     * The visualization slice of the renderer's shader-layer order, i.e. the
     * overlays with the slide subtracted.
     *
     * Reuses the same signal the visualization inspector uses to tell the two
     * apart: `assembleRenderOutput` emits backgrounds first, so the boundary is
     * a POSITION, not an id. Matching ids does not work - a live viewer
     * namespaces every renderer id with `v<viewer.id>_` and sanitizes it, so
     * comparing against config background ids matches nothing and the opaque
     * slide silently stays in the pass, painting every pixel and making the
     * coverage guard reject the whole viewport.
     */
    _visualizationShaderIds(order) {
        const getSplit = UTILITIES && UTILITIES.getBackgroundShaderSplitIndex;
        if (typeof getSplit !== "function") {
            this.log.warn("UTILITIES.getBackgroundShaderSplitIndex missing; cannot subtract the slide");
            return [];
        }
        const split = getSplit(this.context.viewer);
        return order.slice(Number.isInteger(split) && split > 0 ? split : 0);
    }

    /**
     * Serialized, failure-tolerant entry point to prepareViewportScreenshot.
     * The offscreen drawer clears and re-reads a single GL surface, so two
     * overlapping passes corrupt each other's pixels; and a rejection here
     * (e.g. the standalone extraction finding no tiles) must not escape as an
     * unhandled rejection - the mode has to stay usable and retry on the next
     * hover, which _invalidData already arranges.
     * @return {Promise<object|null>} the snapshot, or null when it failed
     */
    _requestSnapshot() {
        if (!this._snapshotPromise) {
            this._snapshotPromise = this.prepareViewportScreenshot().catch(e => {
                this.log.warn("viewport snapshot failed", e);
                this.data = null;
                return null;
            }).finally(() => {
                this._snapshotPromise = null;
            });
        }
        return this._snapshotPromise;
    }

    async prepareViewportScreenshot(x, y, w, h) {
        // Refresh from the live renderer every snapshot — picks up control
        // edits (cache mutations) and any wholesale config.cache reassignments
        // from session-import paths.
        const effective = this._buildEffectiveConfig();
        this._renderConfig = effective;
        if (Object.keys(effective).length === 0) {
            this.data = null;
            this._invalidData = false;
            return null;
        }
        const viewer = this.context.viewer;
        x = x || 0;
        y = y || 0;
        w = w || Math.round(viewer.drawer.canvas.width);
        h = h || Math.round(viewer.drawer.canvas.height);

        this.contentSize = {x, y, w, h};
        this._invalidData = true;

        // Drop the cached first-pass refs so flex-renderer re-steals the
        // main viewer's current first-pass textures (handles texture
        // reallocations after resize/layer-count changes).
        if (this.drawer && this.drawer.renderer) {
            this.drawer.renderer.__firstPassResult = null;
        }

        // The standalone offscreen WebGL canvas does not auto-clear between
        // draws. Without this clear, transparent areas of the new frame would
        // leak the previous frame's pixels — making it impossible for the
        // traced polygon to shrink when the heatmap shrinks. Mirrors the same
        // pattern in modules/annotations/magic-wand.js:100.
        // clearColor is sticky GL state, so a bare clear() would inherit whatever
        // the previous pass left bound. State it explicitly: this surface must
        // start fully transparent for the alpha mask to mean anything.
        const gl = this.drawer.renderer.gl;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        await this.drawer.drawWithConfiguration(
            viewer.world._items,
            effective,
            viewer.drawer,
            { x: w, y: h }
        );

        const data = new Uint8Array(w * h * 4); // RGBA8
        gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
        gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);

        // todo make this available on ALL events! viewer relative position
        this.offset = viewer.drawer.canvas.getBoundingClientRect();

        // vertical flip
        const row = w * 4;
        const tmp = new Uint8Array(row);
        for (let t = 0, b = (h - 1) * row; t < b; t += row, b -= row) {
            tmp.set(data.subarray(t, t + row));
            data.copyWithin(t, b, b + row);
            data.set(tmp, b);
        }

        this.data = {
            width:  w,
            height: h,
            data:   data,
            bytes:  4,
            rawData: data,
            binaryMask: new Uint8ClampedArray(w * h)
        };
        this._invalidData = false;
        return this.data;
    }

    /**
     * Mark every pixel carrying visualization coverage. Deliberately has no
     * "invert" mode: tracing the complement selects the whole non-visualization
     * area, which is the exact misdetection coversViewport() exists to reject.
     * Callers must therefore only reach this once the sample is known to sit on
     * the overlay.
     */
    _getBinaryMask(data, width, height) {
        let mask = new Uint8ClampedArray(width * height);
        let maxX = -1, minX = width, maxY = -1, minY = height, bounds;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = (y * width + x) * 4;
                const a = data[index + 3];

                if (a > 10) {
                    const idx = y * width + x;
                    mask[idx] = 1;

                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (maxX === -1 || maxY === -1) {
            bounds = null;
        } else {
            bounds = { minX, minY, maxX, maxY };
        }

        return { data: mask, width, height, bounds };
    }

    _getPixelAlpha(point) {
        // imageToViewerElementCoordinates returns CSS px (viewer-element space);
        // this.data is sized in device px (viewer.drawer.canvas.width/height). Scale
        // to device px before indexing — without this, Hi-DPI displays sample the
        // upper-fraction of the buffer for a cursor at the visual middle (the bug
        // that caused hovers over the heatmap to read as transparent).
        const tiRef = this._referenceTiledImage();
        if (!tiRef || !this.contentSize) return 0;

        const windowPoint = tiRef.imageToViewerElementCoordinates(new OpenSeadragon.Point(point.x, point.y));

        const cx = (windowPoint.x - this.contentSize.x) * this.ratio;
        const cy = (windowPoint.y - this.contentSize.y) * this.ratio;

        if (cx < 0 || cy < 0 || cx >= this.data.width || cy >= this.data.height) return 0;

        const canvasX = Math.floor(cx);
        const canvasY = Math.floor(cy);
        const pixelIndex = (canvasY * this.data.width + canvasX) * 4;

        return this.data.data[pixelIndex + 3] > 10;
    }

    _categorizeContours(contours) {
        const offsetX = this.contentSize.x;
        const offsetY = this.contentSize.y;

        let outerContours = contours
            .filter(contour => !contour.inner)
            .map(contour => contour.points.map(point => ({
                x: point.x + offsetX,
                y: point.y + offsetY
            })));

        let innerContours = contours
            .filter(contour => contour.inner)
            .map(contour => contour.points.map(point => ({
                x: point.x + offsetX,
                y: point.y + offsetY
            })));

        return { outerContours, innerContours };
    }

    _processContours(outerContours, innerContours) {
        const polygonUtils = OSDAnnotations.PolygonUtilities;
        const polygonFactory = this.context.getAnnotationObjectFactory("polygon");

        let annotationsPoints = [];
        // Counted so a click can tell "refused, it covered everything" apart from
        // "found nothing at all" - on screen both are simply no polygon.
        this._droppedCovering = 0;

        outerContours.forEach(outer => {
            // A blob that saturates the viewport is a misdetection, not a
            // selection: it hides the image behind an opaque near-rectangle
            // and nobody would ever commit it. Drop it - silently on screen,
            // but traceably in the log and explained if the user clicks.
            if (polygonUtils.coversViewport(outer, this.data.width, this.data.height, this.contentSize)) {
                this._droppedCovering++;
                this.log.debug("dropped a contour covering the viewport", {
                    width: this.data.width, height: this.data.height, points: outer.length
                });
                return;
            }

            const bboxOuter = polygonUtils.getBoundingBox(outer);

            let containedInners = innerContours.filter(inner => {
                const polygon = polygonFactory.create(inner, {});
                if (polygonFactory.getArea(polygon) <= 0) return false;

                const bboxInner = polygonUtils.getBoundingBox(inner);
                return polygonUtils.intersectAABB(bboxOuter, bboxInner) &&
                    OSDAnnotations.checkPolygonIntersect(inner, outer).length > 0;
            });

            outer = this._convertToImageCoordinates(outer);
            containedInners = containedInners.map(inner => this._convertToImageCoordinates(inner));

            annotationsPoints.push(containedInners.length > 0 ? [outer, ...containedInners] : [outer]);
        });

        return annotationsPoints;
    }

    _createAnnotations(annotationsPoints) {
        const polygonFactory = this.context.getAnnotationObjectFactory("polygon");
        const multipolygonFactory = this.context.getAnnotationObjectFactory("multipolygon");

        this._cleanState();

        const visualProps = this.context.presets.getAnnotationOptions(this._isLeft);
        const baseStrokeWidth = visualProps.originalStrokeWidth ?? 3;
        // Zoom value the fabric.Object.prototype.zooming hook (annotations.js:1333)
        // consumes — same value used by other helper/highlight visuals.
        const zoom = this.context.fabric.canvas.getZoom();

        annotationsPoints.forEach(points => {
            if (points.length === 1) {
                const polygon = polygonFactory.create(points[0], visualProps);
                if (polygonFactory.getArea(polygon) > 0) this.annotations.push(polygon);
            } else {
                const multipolygon = multipolygonFactory.create(points, visualProps);
                if (multipolygonFactory.getArea(multipolygon) > 0) this.annotations.push(multipolygon);
            }
        });

        // Mark each preview as a highlight so the zoom hook keeps its stroke
        // and dash pattern screen-relative across zooms; apply the scaled
        // values immediately for the first render.
        this.annotations.forEach(annotation => {
            annotation.isHighlight = true;
            annotation.originalStrokeWidth = baseStrokeWidth;
            annotation.strokeLineCap = 'round';
            if (typeof annotation.zooming === 'function') annotation.zooming(zoom);
            this.context.fabric.addHelperAnnotation(annotation);
        });
    }

    _cleanState() {
        if (this.annotations) {
            this.annotations.forEach(annotation => this.context.fabric.deleteHelperAnnotation(annotation));
            this.annotations = [];
        }
    }

    _convertToImageCoordinates(points) {
        const tiRef = this._referenceTiledImage();
        return points.map(point =>
            // we must call viewerElementToImageCoordinates since we don't want to strip the offset of the viewer
            tiRef.viewerElementToImageCoordinates(new OpenSeadragon.Point(point.x / this.ratio, point.y / this.ratio))
        );
    }
}
