OSDAnnotations.MagicWand = class extends OSDAnnotations.AnnotationState {
    constructor(context) {
        super(context, "magic-wand", "blur_on", "Automatic selection wand");
        this.MagicWand = OSDAnnotations.makeMagicWand();

        this.threshold=10;
        this.minThreshold=-1;
        this.maxThreshold=200;
        this.startThreshold=10;
        // this._readingKey = "";
        // this._currentTile = null;
        // const _this = this;
        // this._renderEngine = new WebGLModule({
        //     uniqueId: "annot",
        //     onError: function(error) {
        //         //potentially able to cope with it
        //         context.raiseEvent('warn-system', {
        //             originType: "module",
        //             originId: "annotations",
        //             code: "E_AUTO_OUTLINE_ENGINE_ERROR",
        //             message: "Error in the webgl module.",
        //             trace: error
        //         });
        //     },
        //     onFatalError: function (error) {
        //         console.error("Error with automatic detection: this feature wil be disabled.");
        //         VIEWER.raiseEvent('error-user', {
        //             originType: "module",
        //             originId: "annotations",
        //             code: "E_AUTO_OUTLINE_ENGINE_ERROR",
        //             message: "Error with automatic detection: this feature wil be disabled.",
        //             trace: error
        //         });
        //         _this._running = false;
        //     }
        // });
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
        }
        return true;
    }

    handleClickDown(o, point, isLeftClick, objectFactory) {
        // const vis = VIEWER.bridge.visualization();
        // const targetVis = {
        //     shaders: {
        //         target: {}
        //     }
        // };
        // let toAppend = targetVis.shaders.target;
        //
        // for (let key in vis.shaders) {
        //     if (vis.shaders.hasOwnProperty(key)) {
        //         let otherLayer = vis.shaders[key];
        //         if (key === this._readingKey) {
        //             if (!otherLayer.visible || otherLayer.visible === "false" || otherLayer.visible === "0") {
        //
        //                 VIEWER.raiseEvent('warn-user', {
        //                     originType: "module",
        //                     originId: "annotations",
        //                     code: "E_AUTO_OUTLINE_INVISIBLE_LAYER",
        //                     message: "Creating annotation in an invisible layer.",
        //                 });
        //                 return false;
        //             }
        //
        //             this.comparator = function(pixel) {
        //                 return pixel[3] > 0;
        //             };
        //             toAppend[key] = {
        //                 ...otherLayer
        //             }
        //         } else {
        //             toAppend[key] = {
        //                 type: "none",
        //                 visible: false,
        //                 cache: {},
        //                 dataReferences: [-1],
        //                 params: {},
        //                 _index: otherLayer._index
        //             }
        //         }
        //     }
        // }
        // this._renderEngine.reset();
        // this._renderEngine.addVisualisation(targetVis);
        //
        // this._renderEngine.prepareAndInit(VIEWER.bridge.dataImageSources(),
        //     VIEWER.drawer.canvas.width, VIEWER.drawer.canvas.height);

        //this._currentPixelSize = VIEWER.scalebar.imagePixelSizeOnScreen();
        // let tiles = VIEWER.bridge.getTiledImage().lastDrawn;
        // for (let i = 0; i < tiles.length; i++) {
        //     let tile = tiles[i];
        //     if (!tile.hasOwnProperty("annotationCanvas")) {
        //         tile.annotationCanvas = document.createElement("canvas");
        //         tile.annotationCanvasCtx = tile.annotationCanvas.getContext("2d");
        //     }
        //     this._renderEngine.setDimensions(tile.sourceBounds.width, tile.sourceBounds.height);
        //     let canvas = this._renderEngine.processImage(
        //         tile.cacheImageRecord?.getData() || tile.__data, tile.sourceBounds, 0, this._currentPixelSize
        //     );
        //     tile.annotationCanvas.width = tile.sourceBounds.width;
        //     tile.annotationCanvas.height = tile.sourceBounds.height;
        //     tile.annotationCanvasCtx.drawImage(canvas, 0, 0, tile.sourceBounds.width, tile.sourceBounds.height);
        // }
        // return true;

        // We must now render the whole data
        // this._currentTile = "";
        // this._readingIndex = 0;
        // this._readingKey = "";
        this.getStupidImageData();
        this._isLeft = isLeftClick;
        this._process(o);
    }

    getStupidImageData(x, y, w, h){
        x = x || 0;
        y = y || 0;
        w = w == undefined ? VIEWER.drawer.canvas.width : w;
        h = h == undefined ? VIEWER.drawer.canvas.height : h;
        const data = VIEWER.drawer.canvas.getContext('2d',{willReadFrequently:true}).getImageData(x, y, w, h);
        this.data = {
            width: data.width,
            height: data.height,
            data: data.data,
            bytes:4,
            //colorMask:cm,
            binaryMask: new Uint8ClampedArray(data.width * data.height)
        }
        return this.data;
    }

    _process(o) {
        if (!this.data) return;
        this.startThreshold=this.threshold;
        //todo other modes
        let magicWandOutput = this.MagicWand.floodFill(this.data, Math.round(o.x), Math.round(o.y), this.threshold,
            undefined, false);

        // let morph = new OSDAnnotations.Morph(magicWandOutput);
        // let mask = morph.addBorder();
        // //todo if dilate
        // morph.dilate();

        let mask = magicWandOutput;
        mask.bounds={
            minX:0,
            minY:0,
            maxX:mask.width,
            maxY:mask.height,
        }
        let contours = this.MagicWand.traceContours(mask);
        const ref = VIEWER.scalebar.getReferencedTiledImage();
        //trick: find the largest polygon and render it
        let largest, count = 0;
        for (let line of contours) {
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
            largest = OSDAnnotations.PolygonUtilities.simplify(largest);
            this.result = factory.create(largest, this.context.presets.getAnnotationOptions(this._isLeft));
            this.context.addHelperAnnotation(this.result);
        } else {
            this.result = null;
        }
    }

    scroll(event, delta) {
        this.threshold = Math.min(this.maxThreshold, Math.max(this.minThreshold, this.threshold - Math.round(delta/10)));
        $("#a-magic-wand-threshold").val(this.threshold);
        this._process(event);
    }

    handleMouseMove(event, point) {
        this._process(event);
    }

    objectDeselected(event, object) {
        return this.allowDeselection;
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

    setAutoTargetLayer(self) {
        let key = $(self).val(),
            layer = VIEWER.bridge.visualization().shaders[key];
        this.setLayer(layer._index, key);
    }

    accepts(e) {
        return e.key === "t" && !e.ctrlKey && !e.shiftKey && !e.altKey;
    }

    rejects(e) {
        return e.key === "t";
    }

    customHtml() {
        return `
<span class="d-inline-block">
<span class="position-absolute top-1" style="font-size: xx-small">Growth:</span>
<input type="range" id="a-magic-wand-threshold" style="width: 150px;" 
max="${this.maxThreshold}" min="${this.minThreshold}" value="${this.threshold}" 
onchange="OSDAnnotations.instance().Modes['MAGIC_WAND'].threshold = Number.parseInt(this.value) || 0;"/>
</span>`

//         let html = "";
//         let index = -1;
//         let layer = null;
//         let key = "";
//         if (!VIEWER.bridge) return "";
//         const visualisation = VIEWER.bridge.visualization();
//
//         for (key in visualisation.shaders) {
//             if (!visualisation.shaders.hasOwnProperty(key)) continue;
//             layer = visualisation.shaders[key];
//             if (isNaN(layer._index)) continue;
//
//             let selected = "";
//
//             if (layer._index === this._readingIndex) {
//                 index = layer._index;
//                 this.setLayer(index, key);
//                 selected = "selected";
//             }
//             html += `<option value='${key}' ${selected}>${layer.name}</option>`;
//         }
//
//         if (index < 0) {
//             if (!layer) return;
//             this.setLayer(layer._index, key);
//             html = "<option selected " + html.substring(8);
//         }
//
//         return `<span class="d-inline-block position-absolute top-0" style="font-size: xx-small;" title="What layer is used to create automatic
// annotations."> Automatic annotations detected in: </span><select title="Double click creates automatic annotation - in which layer?" style="min-width: 180px; max-width: 250px;"
// type="number" id="sensitivity-auto-outline" class="form-select select-sm" onchange="OSDAnnotations.instance().Modes['MAGIC_WAND'].setAutoTargetLayer(this);">
// ${html}</select>`;
    }
};
