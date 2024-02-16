OSDAnnotations.MagicWand = class extends OSDAnnotations.AnnotationState {
    constructor(context) {
        super(context, "magic-wand", "blur_on", "Automatic selection wand");
        this.MagicWand = OSDAnnotations.makeMagicWand();

        this.threshold = 10;
        this.minThreshold = 0;
        this.maxThreshold = 200;
        // single mouse scroll is +- 100 value
        this.thStep = 5 / 100;

        this.addMode = false; //todo not tested yet
        this.oldMask = null;
        this.mask = null;

        this.tiledImageIndex = APPLICATION_CONTEXT.config.background.length < 1 ||
            APPLICATION_CONTEXT.config.visualizations.length < 1 ? 0 : 1;

        const drawerType = "canvas"; //VIEWER.drawer.getType();
        const Drawer = OpenSeadragon.determineDrawer(drawerType);
        this.drawer = new Drawer({
            viewer:             VIEWER,
            viewport:           VIEWER.viewport,
            element:            VIEWER.drawer.container,
            debugGridColor:     VIEWER.debugGridColor,
            options:            VIEWER.drawerOptions[drawerType]
        });
        this.drawer.canvas.style.setProperty('visibility', 'hidden');
        this.drawer.canvas.style.setProperty('display', 'none');
    }

    setLayer(index, key) {
        this._readingIndex = index;
        this._readingKey = key;
    }

    handleClickUp(o, point, isLeftClick, objectFactory) {
        if (this.result) {
            this.context.promoteHelperAnnotation(this.result);
            this.result = null;
            this.data = null;
            this.drawer.canvas.style.setProperty('display', 'none');
        }
        return true;
    }

    handleClickDown(o, point, isLeftClick, objectFactory) {
        if (!objectFactory) return; // no preset - no op

        this.context.canvas.discardActiveObject();
        this.drawer.canvas.style.setProperty('display', 'block');
        this.prepareViewportScreenshot();
        this._isLeft = isLeftClick;
        this._process(o);
    }

    prepareViewportScreenshot(x, y, w, h) {
        this.drawer.draw([VIEWER.world.getItemAt(this.tiledImageIndex)]);
        x = x || 0;
        y = y || 0;
        w = w || VIEWER.drawer.canvas.width;
        h = h || VIEWER.drawer.canvas.height;
        const data = this.drawer.canvas.getContext('2d',{willReadFrequently:true}).getImageData(x, y, w, h);
        this.data = {
            width: data.width,
            height: data.height,
            data: data.data,
            bytes:4,
            binaryMask: new Uint8ClampedArray(data.width * data.height)
        }
        return this.data;
    }

    _process(o) {
        if (!this.data) return;

        if (this.addMode && !this.oldMask) {
            this.oldMask = mask;
        }
        const ref = VIEWER.scalebar.getReferencedTiledImage();
        const oldMask = this.oldMask && this.oldMask.data;

        //todo other modes
        this.mask = this.MagicWand.floodFill(this.data, Math.round(o.x), Math.round(o.y), this.threshold,
            this.threshold, oldMask, false);

        // let morph = new OSDAnnotations.Morph(this.mask);
        // this.mask = morph.addBorder();
        // //todo if dilate
        // morph.dilate();

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
            largest = largest.map(pt => ref.windowToImageCoordinates(new OpenSeadragon.Point(pt.x, pt.y)));
            this.result = factory.create(largest, this.context.presets.getAnnotationOptions(this._isLeft));
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

    handleMouseMove(event, point) {
        this._process(event);
    }

    setFromAuto() {
        this.context.setOSDTracking(false);
        this.context.canvas.hoverCursor = "crosshair";
        this.context.canvas.defaultCursor = "crosshair";
        return true;
    }

    setToAuto(temporary) {
        if (temporary) return false;
        this.context.setOSDTracking(true);
        this.context.canvas.renderAll();
        return true;
    }

    accepts(e) {
        return e.key === "t" && !e.ctrlKey && !e.shiftKey && !e.altKey;
    }

    rejects(e) {
        return e.key === "t";
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
</span><select class="form-control"
onchange="OSDAnnotations.instance().Modes['MAGIC_WAND'].tiledImageIndex = Number.parseInt(this.value);">${options}</select>`;
    }
};
