OSDAnnotations.MagicWand = class extends OSDAnnotations.AnnotationState {
    constructor(context) {
        super(context, "magic-wand", "ph-magic-wand", "🆃  automatic selection wand");
        this.MagicWand = OSDAnnotations.makeMagicWand();

        this.threshold = 10;
        this.minThreshold = 0;
        this.maxThreshold = 100;
        // single mouse scroll is +- 100 value
        this.thStep = 3 / 100;

        this.addMode = false; //todo not tested yet
        this.oldMask = null;
        this.mask = null;
        //this._buttonActive = false;
        this._lastViewportKey = null;
        this._scrollZoom = this.scrollZooming.bind(this);

        const shaders = this.context.viewer.drawer.renderer.getShaderLayerOrder();
        this._selectedShader = shaders[0];
        this.disabled = !shaders.length;

        VIEWER_MANAGER.broadcastHandler('visualization-used', () => {
            this.prepareShaderConfig();
            this._invalidData = Date.now();
        });
    }

    prepareShaderConfig() {
        // for some reason change in drawer completely wrongs the logics
        // of reading the texture, so the drawer must be recreated

        if (!this.drawer || this.drawer.viewer !== this.context.viewer) {
            // Dev-only render capture; no-op unless the debug window is open.
            APPLICATION_CONTEXT.renderDebug?.unregisterDrawer?.(this.drawer);
            this.drawer = OpenSeadragon.makeStandaloneFlexDrawer(this.context.viewer);
            APPLICATION_CONTEXT.renderDebug?.registerDrawer?.(this.drawer, {
                label: "magic-wand", viewer: this.context.viewer, kind: "offscreen"
            });
        }

        // Re-read the layer stack every time: the constructor runs before the
        // first slide is open, so its snapshot of the shader order says
        // "nothing to annotate" for the whole session otherwise.
        const order = this.context.viewer.drawer.renderer.getShaderLayerOrder();
        this.disabled = !order.length;
        if (!order.includes(this._selectedShader)) this._selectedShader = order[0];

        const shaders = this.context.viewer.drawer.renderer.getAllShaders();
        const result = {};

        const selectedShader = shaders[this._selectedShader];
        for (let id in shaders) {
            // If selection, keep the same amount of shaders, but except the target one make them vanish
            // todo masks are not accounted for! make some flex drawer utility that solves this
            result[id] = !selectedShader || id === this._selectedShader ? shaders[id].getConfig() : { type: 'identity', visible: 0, dataReferences: [0]};
        }
        this._renderConfig = result;
    }

    setLayer(index, key) {
        this._readingIndex = index;
        this._readingKey = key;
    }

    handleClickUp(o, point, isLeftClick, objectFactory) {
        // A click with nothing detected is a no-op: the tool stays active so
        // the user can keep hovering. Leaving is done through the toolbar,
        // another mode shortcut, or Escape.
        if (this._allowCreation && this.result) {
            delete this.result.strokeDashArray;
            this.context.fabric.deleteHelperAnnotation(this.result);
            this.context.fabric.addAnnotation(this.result);
            this.result = null;
            this._allowCreation = false;
        }
        return true;
    }

    handleClickDown(o, point, isLeftClick, objectFactory) {
        if (!objectFactory || this.disabled) {
            this.abortClick(isLeftClick);
            Dialogs.show($.t(this.disabled ? 'autoSelect.noData' : 'autoSelect.noPreset', { ns: 'annotations' }));
            return;
        }

        this._allowCreation = true;
        this.context.fabric.clearAnnotationSelection(true);
        this._isLeft = isLeftClick;
    }

    locksViewer(oldViewerRef, newViewerRef) {
        const willKeepViewer = super.locksViewer(oldViewerRef, newViewerRef);
        if (!willKeepViewer) {
            this.oldMask = null;
            if (this.result) {
                this.context.fabric.deleteHelperAnnotation(this.result);
            }
        }
        return willKeepViewer;
    }

    async prepareViewportScreenshot(x, y, w, h) {
        const viewer = this.context.viewer;
        x = x || 0;
        y = y || 0;
        w = w || Math.round(viewer.drawer.canvas.width);
        h = h || Math.round(viewer.drawer.canvas.height);

        this._invalidData = true;

        // todo this call needs to go to the renderer
        this.drawer.renderer.gl.clear(this.drawer.renderer.gl.COLOR_BUFFER_BIT);
        await this.drawer.drawWithConfiguration(
            viewer.world._items,
            this._renderConfig,
            viewer.drawer,
            { x: w, y: h }
        );

        const data = new Uint8Array(w * h * 4); // RGBA8
        const gl   = this.drawer.renderer.gl;
        gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
        gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);

        // vertical flip
        const row = w * 4;
        const tmp = new Uint8Array(row);
        for (let t = 0, b = (h - 1) * row; t < b; t += row, b -= row) {
            tmp.set(data.subarray(t, t + row));
            data.copyWithin(t, b, b + row);
            data.set(tmp, b);
        }

        // todo make this available on ALL events! viewer relative position
        this.offset = viewer.drawer.canvas.getBoundingClientRect();

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
                console.warn("Magic wand: viewport snapshot failed.", e);
                this.data = null;
                return null;
            }).finally(() => {
                this._snapshotPromise = null;
            });
        }
        return this._snapshotPromise;
    }

    async _process(o) {
        const viewer = this.context.viewer;

        // Build a simple key from current viewport
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

        if (needsNewScreenshot || this._snapshotPromise) {
            await this._requestSnapshot();
            this._lastViewportKey = key;
        }

        if (!this.data) return; // still nothing? bail out

        if (this.addMode && !this.oldMask) {
            this.oldMask = this.mask;
        }
        const ref    = viewer.scalebar.getReferencedTiledImage();
        const oldMask = this.oldMask && this.oldMask.data;
        const ratio  = OpenSeadragon.pixelDensityRatio;

        this.mask = this.MagicWand.floodFill(
            this.data,
            Math.round((o.x - this.offset.x) * ratio),
            Math.round((o.y - this.offset.y) * ratio),
            this.threshold,
            this.threshold,
            oldMask,
            true
        );

        if (this.mask) this.mask = this.MagicWand.gaussBlurOnlyBorder(this.mask, 5, oldMask);
        if (this.addMode && oldMask) {
            this.mask = this.mask ? this._concatMasks(this.mask, oldMask) : oldMask;
        }
        if (!this.mask || !this.mask.bounds) {
            // floodFill returns null when the seed pixel is already part of the
            // previous mask - nothing new was selected.
            if (this.result) {
                this.context.fabric.deleteHelperAnnotation(this.result);
                this.result = null;
            }
            return;
        }
        this.mask.bounds.minX = this.mask.bounds.minY = 0;
        let cs = this.MagicWand.traceContours(this.mask);
        cs = this.MagicWand.simplifyContours(cs, 0, 30);

        let largest, count = 0;
        for (let line of cs) {
            if (!line.inner && line.points.length > count) {
                largest = line.points;
                count = largest.length;
            }
        }

        // A fill that saturates the viewport is a misdetection, not a
        // selection: it hides the image behind an opaque near-rectangle and
        // nobody would ever commit it. Drop it silently - the user reacts by
        // lowering the growth threshold or zooming in.
        if (largest && OSDAnnotations.PolygonUtilities.coversViewport(
            largest, this.data.width, this.data.height)) {
            largest = null;
        }

        const factory = this.context.getAnnotationObjectFactory("polygon");
        if (this.result) {
            this.context.fabric.deleteHelperAnnotation(this.result);
        }

        if (largest && factory) {
            largest = largest.map(pt =>
                // we must call viewerElementToImageCoordinates since we don't want to strip the offset of the viewer
                ref.viewerElementToImageCoordinates(
                    new OpenSeadragon.Point((pt.x) / ratio, (pt.y) / ratio)
                )
            );
            const visualProps = this.context.presets.getAnnotationOptions(this._isLeft);
            visualProps.strokeDashArray = [15, 15];
            this.result = factory.create(largest, visualProps);
            this.context.fabric.addHelperAnnotation(this.result);
        } else {
            this.result = null;
        }
    }

    _concatMasks(mask, old) {
        let
            data1 = old.data,
            data2 = mask.data,
            w1 = old.width,
            w2 = mask.width,
            b1 = old.bounds,
            b2 = mask.bounds,
            b = { // bounds for new mask
                minX: Math.min(b1.minX, b2.minX),
                minY: Math.min(b1.minY, b2.minY),
                maxX: Math.max(b1.maxX, b2.maxX),
                maxY: Math.max(b1.maxY, b2.maxY)
            },
            w = old.width, // size for new mask
            h = old.height,
            i, j, k, k1, k2, len;

        let result = new Uint8Array(w * h);

        // copy all old mask
        len = b1.maxX - b1.minX + 1;
        i = b1.minY * w + b1.minX;
        k1 = b1.minY * w1 + b1.minX;
        k2 = b1.maxY * w1 + b1.minX + 1;
        // walk through rows (Y)
        for (k = k1; k < k2; k += w1) {
            result.set(data1.subarray(k, k + len), i); // copy row
            i += w;
        }

        // copy new mask (only "black" pixels)
        len = b2.maxX - b2.minX + 1;
        i = b2.minY * w + b2.minX;
        k1 = b2.minY * w2 + b2.minX;
        k2 = b2.maxY * w2 + b2.minX + 1;
        // walk through rows (Y)
        for (k = k1; k < k2; k += w2) {
            // walk through cols (X)
            for (j = 0; j < len; j++) {
                if (data2[k + j] === 1) result[i + j] = 1;
            }
            i += w;
        }

        return {
            data: result,
            width: w,
            height: h,
            bounds: b
        };
    }

    scroll(event, delta) {
        this.threshold = Math.min(this.maxThreshold,
            Math.max(this.minThreshold, this.threshold - Math.round(delta * this.thStep)));
        const thresholdInput = document.getElementById("a-magic-wand-threshold");
        if (thresholdInput) thresholdInput.value = this.threshold;
        this._process(event).catch(e => console.warn("Magic wand: detection failed.", e));
    }

    scrollZooming(event, delta) {
        this._invalidData = Date.now();
    }

    handleMouseHover(event, point) {
        // Bind a preset on hover, not only on click-down: this mode detects
        // while hovering, so waiting for annotations-canvas' click-down
        // fallback left the very first activation of the tool completely dead.
        if (!this.context.presets.ensureActivePreset(true)) return;
        this._isLeft = true;
        this._process(event, true).catch(e => console.warn("Magic wand: detection failed.", e));
    }

    setFromAuto() {
        // Detection is hover-driven, so a mode that cannot detect anything is
        // simply dead: refuse to enter it and say why, instead of waiting for
        // a click to surface the same message.
        this.prepareShaderConfig();
        if (this.disabled) {
            Dialogs.show($.t('autoSelect.noData', { ns: 'annotations' }));
            return false;
        }
        if (!this.context.presets.ensureActivePreset(true)) {
            Dialogs.show($.t('autoSelect.noPreset', { ns: 'annotations' }));
            return false;
        }

        this._requestSnapshot();

        this.context.viewer.addHandler('animation-finish', this._scrollZoom);
        this.context.setOSDTracking(false);
        this.context.setCursors("crosshair");
        return true;
    }

    setToAuto(temporary) {
        if (this.result) {
            this.context.fabric.deleteHelperAnnotation(this.result);
            this.result = null;
        }
        this.data = null;
        // Any snapshot still in flight belongs to the session we are leaving.
        this._lastViewportKey = null;
        this._invalidData = Date.now();

        this.context.viewer.removeHandler('animation-finish', this._scrollZoom);
        if (temporary) return false;
        this.context.setOSDTracking(true);
        return true;
    }

    get defaultKeyCombo() {
        return "KeyT";
    }

    setShaderToDetectFrom(value) {
        this._selectedShader = value;
        this.prepareShaderConfig();
        this._invalidData = Date.now();
    }

    /**
     * Mode-options panel content. Returned as a raw HTML string (the
     * `customHtml()` contract) and injected via `UI.RawHtml` -> innerHTML, so
     * every interpolated value must be escaped.
     *
     * The panel is a narrow vertical column, not the old horizontal toolbar:
     * lay the controls out as label-over-control rows. Widths are inline
     * because the purged `tailwind.min.css` drops many utility classes.
     */
    customHtml() {
        const escape = OSDAnnotations.MagicWand._escapeHtml;
        let options = "";
        for (let shaderId of this.context.viewer.drawer.renderer.getShaderLayerOrder()) {
            const config = this.context.viewer.drawer.renderer.getShaderLayerConfig(shaderId);
            const selected = this._selectedShader === shaderId ? " selected" : "";
            options += `<option value="${escape(shaderId)}"${selected}>${escape(config.name)}</option>`;
        }

        const growthLabel = escape($.t('modeOptions.magicWand.growth', { ns: 'annotations' }));
        const growthHint = escape($.t('modeOptions.magicWand.growthHint', { ns: 'annotations' }));
        const layerLabel = escape($.t('modeOptions.magicWand.layer', { ns: 'annotations' }));

        return `
<div style="display:flex;flex-direction:column;gap:0.75rem;width:14rem;max-width:100%;padding:0.25rem;">
    <div style="display:flex;flex-direction:column;gap:0.25rem;">
        <label class="text-xs font-medium opacity-70" for="a-magic-wand-threshold">${growthLabel}</label>
        <input type="range" id="a-magic-wand-threshold" title="${growthHint}" style="width:100%;"
            max="${this.maxThreshold}" min="${this.minThreshold}" value="${this.threshold}"
            onchange="OSDAnnotations.instance().Modes['MAGIC_WAND'].threshold = Number.parseInt(this.value) || 0;"/>
    </div>
    <div style="display:flex;flex-direction:column;gap:0.25rem;">
        <label class="text-xs font-medium opacity-70" for="a-magic-wand-layer">${layerLabel}</label>
        <select id="a-magic-wand-layer" class="select select-sm select-bordered" style="width:100%;"
            onchange="OSDAnnotations.instance().Modes['MAGIC_WAND'].setShaderToDetectFrom(this.value);">${options}</select>
    </div>
</div>`;
    }

    static _escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, c => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[c]);
    }
};
