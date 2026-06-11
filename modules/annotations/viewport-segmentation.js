OSDAnnotations.ViewportSegmentation = class extends OSDAnnotations.AnnotationState {
    constructor(context) {
        super(context, "viewport-segmentation", "ph-bounding-box", "🆄  viewport segmentation");
        this.MagicWand = OSDAnnotations.makeMagicWand();

        this.annotations = [];
        this._lastAlpha = null;
        this.ratio = OpenSeadragon.pixelDensityRatio;
        this._tiRef = null;

        VIEWER_MANAGER.broadcastHandler('visualization-used', () => {
            this.prepareShaderConfig();
            this._invalidData = Date.now();
        });

        this.disabled = APPLICATION_CONTEXT.config.visualizations.length < 1;
        this.tiledImageIndex = APPLICATION_CONTEXT.config.background.length;

        this._invalidate = () => { this._invalidData = Date.now(); };
        this._framewatchViewer = null;
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
            this._lastAlpha = null;
        } else {
            this.context.setMode(this.context.Modes.AUTO);
        }

        return true;
    }

    handleClickDown(o, point, isLeftClick, objectFactory) {
        const noViz = !this._renderConfig || Object.keys(this._renderConfig).length === 0;
        if (!objectFactory || this.disabled || noViz) {
            this.abortClick(isLeftClick);
            let msg;
            if (this.disabled) msg = 'There are no overlays to segment!';
            else if (noViz) msg = 'No visualization layer to segment from. Toggle one on, or load a visualization.';
            else msg = 'Select a preset to annotate!';
            Dialogs.show(msg);
            return;
        }

        this._allowCreation = true;
        this.context.fabric.clearAnnotationSelection(true);
        this._isLeft = isLeftClick;
    }

    locksViewer(oldViewerRef, newViewerRef) {
        const willKeepViewer = super.locksViewer(oldViewerRef, newViewerRef);
        if (!willKeepViewer) {
            this._cleanState();
            this._unbindFrameWatchers();
        }
        return willKeepViewer;
    }

    async handleMouseHover(event, point) {
        if (!this.context.presets.left || this.isZooming) {
            this._invalidData = Date.now();
            return;
        }
        if (!this._renderConfig || Object.keys(this._renderConfig).length === 0) {
            this._invalidData = Date.now();
            return;
        }

        this._isLeft = true;

        const viewer = this.context.viewer;
        const b = viewer.viewport.getBoundsNoRotateWithMargins(true);
        const key = [
            b.x, b.y, b.width, b.height,
            viewer.viewport.getRotation(true),
            viewer.viewport.getZoom(true)
        ].join(",");

        const needsNewScreenshot =
            !this.data ||
            this._invalidData ||
            this._lastViewportKey !== key;

        if (needsNewScreenshot) {
            // Yield one frame so the main viewer's first-pass for the current
            // viewport has a chance to render before we steal its textures.
            await new Promise(r => requestAnimationFrame(r));
            await this.prepareViewportScreenshot();
            this._lastViewportKey = key;
            // Snapshot changed — drop the alpha short-circuit so the recompute
            // below runs even if currentAlpha matches the previous hover.
            this._lastAlpha = null;
        }

        if (!this.data) return;

        const currentAlpha = this._getPixelAlpha(point);
        if (!currentAlpha) {
            // Cursor is over background — _getBinaryMask would invert and trace the
            // whole non-visualization area, which the user perceives as "the
            // polygon doesn't shrink, it grows huge". Clear any stale helper
            // polygon and wait for the cursor to come back over the heatmap.
            if (this.annotations && this.annotations.length) this._cleanState();
            this._lastAlpha = currentAlpha;
            return;
        }
        if (this._lastAlpha === currentAlpha) {
            return;
        }

        this.data.binaryMask = this._getBinaryMask(this.data.data, this.data.width, this.data.height, currentAlpha);
        if (!this.data.binaryMask.bounds) return;

        this.data.binaryMask = this.MagicWand.gaussBlurOnlyBorder(this.data.binaryMask, 5);

        let contours = this.MagicWand.traceContours(this.data.binaryMask);
        contours = this.MagicWand.simplifyContours(contours, 0, 30);

        let { outerContours, innerContours } = this._categorizeContours(contours);
        let annotationsPoints = this._processContours(outerContours, innerContours);

        this._createAnnotations(annotationsPoints);
        this._lastAlpha = currentAlpha;
    }

    scrollZooming(event, delta) {
        this._invalidData = Date.now();
    }

    setFromAuto() {
        this._tiRef = this.context.viewer.scalebar.getReferencedTiledImage();
        this.prepareShaderConfig();
        this._bindFrameWatchers(this.context.viewer);
        this.prepareViewportScreenshot();

        this.context.setOSDTracking(false);
        this.context.setCursors("crosshair");
        return true;
    }

    setToAuto(temporary) {
        this._cleanState();
        this._unbindFrameWatchers();

        this.data = null;
        if (temporary) return false;
        this.context.setOSDTracking(true);
        return true;
    }

    accepts(e) {
        return e.code === "KeyU" && !e.ctrlKey && !e.shiftKey && !e.altKey;
    }

    rejects(e) {
        return e.code === "KeyU";
    }

    prepareShaderConfig() {
        // for some reason change in drawer completely wrongs the logics
        // of reading the texture, so the drawer must be recreated

        if (!this.drawer || this.drawer.viewer !== this.context.viewer) {
            this.drawer = OpenSeadragon.makeStandaloneFlexDrawer(this.context.viewer);
        }

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
        const bgIds = this._collectBackgroundShaderIds();
        const out = {};
        for (const id of order) {
            if (bgIds.has(id)) continue;
            const cfg = renderer.getShaderLayerConfig(id);
            if (!cfg || cfg.error) continue;
            if (cfg.visible === 0 || cfg.visible === false) continue;
            // Pass the live config through. User-edited values live on cfg.cache;
            // the standalone shader's controls read them via loadProperty() during
            // construct(). Do not spread cache into params — slider controls need
            // their full {default, min, max, step, …} definition from the shader
            // type's defaultControls, which a scalar in params would collapse.
            out[id] = { ...cfg };
        }
        return out;
    }

    // Subtracts background shaders from the renderer's shader stack so the
    // segmentation pass only sees visualization layers. Renderer ids are
    // sanitized via $.FlexRenderer.sanitizeKey, so the raw bg.id derived from
    // canonical-scene must be sanitized to match the order returned by
    // renderer.getShaderLayerOrder().
    _collectBackgroundShaderIds() {
        const out = new Set();
        const sanitize = (k) => OpenSeadragon.FlexRenderer.sanitizeKey(k);
        const scene = window.__SCENE;
        const bgArr = APPLICATION_CONTEXT.config.background || [];
        for (const bg of bgArr) {
            if (!bg || !bg.id) continue;
            const ids = (scene && typeof scene.backgroundShaderRendererIds === "function")
                ? scene.backgroundShaderRendererIds(bg)
                : ((Array.isArray(bg.shaders) ? bg.shaders : [null]).map((_, i) => i === 0 ? bg.id : `${bg.id}-${i}`));
            for (const id of ids) out.add(sanitize(id));
        }
        return out;
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
        const gl = this.drawer.renderer.gl;
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

    _getBinaryMask(data, width, height, alpha) {
        let mask = new Uint8ClampedArray(width * height);
        let maxX = -1, minX = width, maxY = -1, minY = height, bounds;

        let compareAlpha;
        if (!alpha) {
            compareAlpha = (a) => a <= 10;
        } else {
            compareAlpha = (a) => a > 10;
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = (y * width + x) * 4;
                const a = data[index + 3];

                if (compareAlpha(a)) {
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
        const windowPoint = this._tiRef.imageToViewerElementCoordinates(new OpenSeadragon.Point(point.x, point.y));

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

        outerContours.forEach(outer => {
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
        return points.map(point =>
            // we must call viewerElementToImageCoordinates since we don't want to strip the offset of the viewer
            this._tiRef.viewerElementToImageCoordinates(new OpenSeadragon.Point(point.x / this.ratio, point.y / this.ratio))
        );
    }
}
