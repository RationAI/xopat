OSDAnnotations.MagicWand = class extends OSDAnnotations.AnnotationState {
    constructor(context) {
        super(context, "magic-wand", "lasso_select", "🆃  automatic selection wand");
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

        this._scrollZoom = this.scrollZooming.bind(this);

        this.tiledImageIndex = APPLICATION_CONTEXT.config.background.length < 1 ||
        APPLICATION_CONTEXT.config.visualizations.length < 1 ? 0 : 1;

        // TODO works with OSD 5.0+
        // const drawerType = "canvas"; //VIEWER.drawer.getType();
        // const Drawer = OpenSeadragon.determineDrawer(drawerType);
        // this.drawer = new Drawer({
        //     viewer:             VIEWER,
        //     viewport:           VIEWER.viewport,
        //     element:            VIEWER.drawer.container,
        //     debugGridColor:     VIEWER.debugGridColor,
        //     options:            VIEWER.drawerOptions[drawerType]
        // });
        this.drawer = new OpenSeadragon.Drawer({
            viewer:             VIEWER,
            viewport:           VIEWER.viewport,
            element:            VIEWER.canvas,
            debugGridColor:     VIEWER.debugGridColor
        });
        this.drawer.canvas.style.setProperty('z-index', '-999');
        this.drawer.canvas.style.setProperty('visibility', 'hidden');
        this.drawer.canvas.style.setProperty('display', 'none');
    }

    setLayer(index, key) {
        this._readingIndex = index;
        this._readingKey = key;
    }

    handleClickUp(o, point, isLeftClick, objectFactory) {
        if (this._allowCreation && this.result) {
            delete this.result.strokeDashArray;
            this.context.promoteHelperAnnotation(this.result);
            this.result = null;
            this._allowCreation = false;
        } else {
            this.context.setMode(this.context.Modes.AUTO);
        }
        return true;
    }

    handleClickDown(o, point, isLeftClick, objectFactory) {
        if (!objectFactory) return; // no preset - no op

        this._allowCreation = true;
        this.context.canvas.discardActiveObject();
        this._isLeft = isLeftClick;
    }

    prepareViewportScreenshot(x, y, w, h) {
        x = x || 0;
        y = y || 0;
        w = w || Math.round(VIEWER.drawer.canvas.width);
        h = h || Math.round(VIEWER.drawer.canvas.height);

        //TODO single line works with OSD 5.0+
        //this.drawer.draw([VIEWER.world.getItemAt(this.tiledImageIndex)]);
        this.drawer.clear();
        const targetImage = VIEWER.world.getItemAt(this.tiledImageIndex),
            oldDrawer = targetImage._drawer;
        targetImage._drawer = this.drawer;
        targetImage.draw();
        targetImage._drawer = oldDrawer;
        // end
        const data = this.drawer.canvas.getContext('2d',{willReadFrequently:true}).getImageData(x, y, w, h);
        this.data = {
            width: data.width,
            height: data.height,
            data: data.data,
            bytes:4,
            rawData: data,
            binaryMask: new Uint8ClampedArray(data.width * data.height)
        }
        this._invalidData = false;
        return this.data;
    }

    _process(o) {
        if (!this.data) return;

        if (this._invalidData) {
            this.prepareViewportScreenshot();
        }

        if (this.addMode && !this.oldMask) {
            this.oldMask = this.mask;
        }
        const ref = VIEWER.scalebar.getReferencedTiledImage();
        const oldMask = this.oldMask && this.oldMask.data;
        const ratio = OpenSeadragon.pixelDensityRatio;

        this.mask = this.MagicWand.floodFill(this.data, Math.round(o.x*ratio), Math.round(o.y*ratio), this.threshold,
            this.threshold, oldMask, true);

        if (this.mask) this.mask = this.MagicWand.gaussBlurOnlyBorder(this.mask, 5, oldMask);
        if (this.addMode && oldMask) {
            this.mask = this.mask ? this._concatMasks(this.mask, oldMask) : oldMask;
        }
        this.mask.bounds.minX = this.mask.bounds.minY = 0;
        var cs = this.MagicWand.traceContours(this.mask);
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
            this.context.deleteHelperAnnotation(this.result);
        }

        if (largest && factory) {
            largest = largest.map(pt => ref.windowToImageCoordinates(new OpenSeadragon.Point(pt.x / ratio, pt.y / ratio)));
            const visualProps = this.context.presets.getAnnotationOptions(this._isLeft);
            visualProps.strokeDashArray = [15, 15];
            this.result = factory.create(largest, visualProps);
            this.context.addHelperAnnotation(this.result);
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
        this._process(event);
    }

    setFromAuto() {
        this.drawer.canvas.style.setProperty('display', 'block');
        this.prepareViewportScreenshot();

        VIEWER.addHandler('animation-finish', this._scrollZoom);
        this.context.setOSDTracking(false);
        this.context.canvas.hoverCursor = "crosshair";
        this.context.canvas.defaultCursor = "crosshair";
        return true;
    }

    setToAuto(temporary) {
        if (this.result) {
            this.context.deleteHelperAnnotation(this.result);
            this.result = null;
        }
        this.data = null;
        this.drawer.canvas.style.setProperty('display', 'none');

        VIEWER.removeHandler('animation-finish', this._scrollZoom);
        if (temporary) return false;
        this.context.setOSDTracking(true);
        this.context.canvas.renderAll();
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

    setTiledImageIndex(value) {
        this._invalidData = Date.now();
        this.tiledImageIndex = Number.parseInt(value);
    }

    customHtml() {
        let options;
        if (APPLICATION_CONTEXT.config.background.length < 1) {
            options = "<option selected value='0'>Overlay</option>";
        } else if (APPLICATION_CONTEXT.config.visualizations.length < 1) {
            options = "<option selected value='0'>Tissue</option>";
        } else {
            options = "<option value='0'>Tissue</option>" + "<option selected value='1'>Overlay</option>";;
        }

        return `
<span class="d-inline-block">
<span class="position-absolute top-1" style="font-size: xx-small">Growth:</span>
<input type="range" id="a-magic-wand-threshold" style="width: 150px;" 
max="${this.maxThreshold}" min="${this.minThreshold}" value="${this.threshold}" 
onchange="OSDAnnotations.instance().Modes['MAGIC_WAND'].threshold = Number.parseInt(this.value) || 0;"/>
</span><select class="ml-2 form-control text-small"
onchange="OSDAnnotations.instance().Modes['MAGIC_WAND'].setTiledImageIndex(Number.parseInt(this.value));">${options}</select>`;
    }
};
