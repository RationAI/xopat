OSDAnnotations.MagicWand = class extends OSDAnnotations.AnnotationState {
    constructor(context) {
        super(context, "magic-wand", "fa-wand-sparkles", "🆃  automatic selection wand");
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

        const debug = document.createElement('canvas')
        this.ddeb = debug.getContext('2d');
        debug.style.width = "300px";
        debug.style.height = "300px";
        debug.style.position = "absolute";
        window.document.body.appendChild(debug);
    }

    prepareShaderConfig() {
        // for some reason change in drawer completely wrongs the logics
        // of reading the texture, so the drawer must be recreated

        if (!this.drawer || this.drawer.viewer !== this.context.viewer) {
            this.drawer = OpenSeadragon.makeStandaloneFlexDrawer(this.context.viewer);
        }

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
        if (this._allowCreation && this.result) {
            delete this.result.strokeDashArray;
            this.context.fabric.promoteHelperAnnotation(this.result);
            this.result = null;
            this._allowCreation = false;
        } else {
            this.context.setMode(this.context.Modes.AUTO);
        }
        return true;
    }

    handleClickDown(o, point, isLeftClick, objectFactory) {
        if (!objectFactory || this.disabled) {
            this.abortClick(isLeftClick);
            Dialogs.show(this.disabled ? 'There is no data to annotate!' : 'Select a preset to annotate!');
            return;
        }

        this._allowCreation = true;
        this.context.fabric.clearAnnotationSelection(true);
        this._isLeft = isLeftClick;
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

        // debug canvas
        this.ddeb.canvas.width  = w;
        this.ddeb.canvas.height = h;
        const imgData = new ImageData(new Uint8ClampedArray(data.buffer), w, h);
        this.ddeb.drawImage(this.drawer.renderer.canvas, 0, 0, w, h);

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

        if (needsNewScreenshot) {
            await this.prepareViewportScreenshot();
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
            Math.round(o.x * ratio),
            Math.round(o.y * ratio),
            this.threshold,
            this.threshold,
            oldMask,
            true
        );

        if (this.mask) this.mask = this.MagicWand.gaussBlurOnlyBorder(this.mask, 5, oldMask);
        if (this.addMode && oldMask) {
            this.mask = this.mask ? this._concatMasks(this.mask, oldMask) : oldMask;
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

        const factory = this.context.getAnnotationObjectFactory("polygon");
        if (this.result) {
            this.context.fabric.deleteHelperAnnotation(this.result);
        }

        if (largest && factory) {
            largest = largest.map(pt =>
                ref.windowToImageCoordinates(
                    new OpenSeadragon.Point(pt.x / ratio, pt.y / ratio)
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
        $("#a-magic-wand-threshold").val(this.threshold);
        this._process(event);
    }

    scrollZooming(event, delta) {
        this._invalidData = Date.now();
    }

    handleMouseHover(event, point) {
        if (!this.context.presets.left) return;
        this._isLeft = true;
        this._process(event, true);
    }

    setFromAuto() {
        this.prepareShaderConfig();
        this.prepareViewportScreenshot();

        this.context.viewer.addHandler('animation-finish', this._scrollZoom);
        this.context.setOSDTracking(false);
        this.context.fabric.canvas.hoverCursor = "crosshair";
        this.context.fabric.canvas.defaultCursor = "crosshair";
        return true;
    }

    setToAuto(temporary) {
        if (this.result) {
            this.context.fabric.deleteHelperAnnotation(this.result);
            this.result = null;
        }
        this.data = null;

        this.context.viewer.removeHandler('animation-finish', this._scrollZoom);
        if (temporary) return false;
        this.context.setOSDTracking(true);
        return true;
    }

    accepts(e) {
        const accepts = e.code === "KeyT" && !e.ctrlKey && !e.shiftKey && !e.altKey;
        // if (accepts) {
        //     this._buttonActive = !this._buttonActive;
        //     if (!this._buttonActive) {
        //         this.context.setMode(this.context.Modes.AUTO);
        //         return false;
        //     }
        // }
        return accepts;
    }

    rejects(e) {
        return e.code === "KeyT";
    }

    setShaderToDetectFrom(value) {
        this._selectedShader = value;
        this.prepareShaderConfig();
        this._invalidData = Date.now();
    }

    customHtml() {
        let options;
        for (let shaderId of this.context.viewer.drawer.renderer.getShaderLayerOrder()) {
            const config = this.context.viewer.drawer.renderer.getShaderLayerConfig(shaderId);
            if (this._selectedShader === shaderId) {
                options += `<option value='${shaderId}' selected>${config.name}</option>`;
            } else {
                options += `<option value='${shaderId}'>${config.name}</option>`;
            }
        }

        return `
<span class="d-inline-block">
<span class="position-absolute top-1" style="font-size: xx-small">Growth:</span>
<input type="range" id="a-magic-wand-threshold" style="width: 150px;" 
max="${this.maxThreshold}" min="${this.minThreshold}" value="${this.threshold}" 
onchange="OSDAnnotations.instance().Modes['MAGIC_WAND'].threshold = Number.parseInt(this.value) || 0;"/>
</span><select class="ml-2 form-control text-small"
onchange="OSDAnnotations.instance().Modes['MAGIC_WAND'].setShaderToDetectFrom(this.value);">${options}</select>`;
    }
};
