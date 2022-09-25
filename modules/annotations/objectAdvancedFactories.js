
OSDAnnotations.Ruler = class extends OSDAnnotations.AnnotationObjectFactory {
    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "ruler", "group");
        this._current = null;
    }

    getIcon() {
        return "square_foot";
    }

    getDescription(ofObject) {
        return `Length ${ofObject.measure}`;
    }

    fabricStructure() {
        return ["line", "text"];
    }

    getCurrentObject() {
        return this._current;
    }

    isEditable() {
        return false;
    }

    /**
     * @param {array} parameters array of line points [x, y, x, y ..]
     * @param {Object} options see parent class
     */
    create(parameters, options) {
        let parts = this._createParts(parameters, options);
        return this._createWrap(parts, options);
    }

    /**
     * @param {Object} ofObject fabricjs.Line object that is being copied
     * @param {array} parameters array of line points [x, y, x, y ..]
     */
    copy(ofObject, parameters=undefined) {
        let line = ofObject.item(0),
            text = ofObject.item(1);
        if (!parameters) parameters = [line.x1, line.y1, line.x2, line.y2];
        return new fabric.Group([fabric.Line(parameters, {
            fill: line.fill,
            opacity: line.opacity,
            strokeWidth: line.strokeWidth,
            stroke: line.stroke,
            scaleX: line.scaleX,
            scaleY: line.scaleY,
            hasRotatingPoint: line.hasRotatingPoint,
            borderColor: line.borderColor,
            cornerColor: line.cornerColor,
            borderScaleFactor: line.borderScaleFactor,
            hasControls: line.hasControls,
            lockMovementX: line.lockMovementX,
            lockMovementY: line.lockMovementY,
            originalStrokeWidth: line.originalStrokeWidth,
            selectable: false,
        }), new fabric.Text(text.text), {
            textBackgroundColor: text.textBackgroundColor,
            fontSize: text.fontSize,
            lockUniScaling: true,
            scaleY: text.scaleY,
            scaleX: text.scaleX,
            selectable: false,
            hasControls: false,
            stroke: text.stroke,
            fill: text.fill,
            paintFirst: 'stroke',
            strokeWidth: text.strokeWidth,
        }], {
            presetID: ofObject.presetID,
            measure: ofObject.measure,
            meta: ofObject.meta,
            factoryId: ofObject.factoryId,
            isLeftClick: ofObject.isLeftClick,
            type: ofObject.type,
            layerId: ofObject.layerId,
            color: ofObject.color,
            zoomAtCreation: ofObject.zoomAtCreation,
            selectable: false,
            hasControls: false
        });
    }

    edit(theObject) {
        //not allowed
    }

    recalculate(theObject) {
        //not supported error?
    }

    updateRendering(isTransparentFill, ofObject, withPreset, defaultStroke) {
        //do nothing - always same 'transparent'
    }

    onZoom(ofObject, zoom) {
        ofObject._objects[1].set({
            scaleX: 1/zoom,
            scaleY: 1/zoom
        });
        super.onZoom( ofObject._objects[0], zoom);
    }

    instantCreate(screenPoint, isLeftClick = true) {
        let bounds = this._auto.approximateBounds(screenPoint, false);
        if (bounds) {
            let opts = this._presets.getAnnotationOptions(isLeftClick);
            let object = this.create([bounds.left.x, bounds.top.y, bounds.right.x, bounds.bottom.y], opts);
            this._context.addAnnotation(object);
            return true;
        }
        return false;
    }

    initCreate(x, y, isLeftClick) {
        let opts = this._presets.getAnnotationOptions(isLeftClick);
        let parts = this._createParts([x, y, x, y], opts);
        this._updateText(parts[0], parts[1]);
        this._current = parts;
        this._context.addHelperAnnotation(this._current[0]);
        this._context.addHelperAnnotation(this._current[1]);

    }

    updateCreate(x, y) {
        if (!this._current) return;
        let line = this._current[0],
            text = this._current[1];
        line.set({ x2: x, y2: y });
        this._updateText(line, text);
    }

    finishDirect() {
        let obj = this.getCurrentObject();
        if (!obj) return;
        this._context.deleteHelperAnnotation(obj[0]);
        this._context.deleteHelperAnnotation(obj[1]);

        const pid = obj[0].presetID;

        obj = this._createWrap(obj, this._presets.getCommonProperties());
        obj.presetID = pid;
        this._context.addAnnotation(obj);
        this._current = undefined;
    }

    /**
     * Create array of points - approximation of the object shape
     * @return {undefined} not supported, ruler cannot be turned to polygon
     */
    toPointArray(obj, converter, quality=1) {
        return undefined;
    }

    title() {
        return "Ruler";
    }

    exportsProperties() {
        return ["measure"];
    }

    _getWithUnit(value, unitSuffix) {
        if (value < 0.000001) {
            return value * 1000000000 + " n" + unitSuffix;
        }
        if (value < 0.001) {
            return value * 1000000 + " μ" + unitSuffix;
        }
        if (value < 1) {
            return value * 1000 + " m" + unitSuffix;
        }
        if (value >= 1000) {
            return value / 1000 + " k" + unitSuffix;
        }
        return value + " " + unitSuffix;
    }

    _updateText(line, text) {
        let microns = APPLICATION_CONTEXT.getOption("microns") ?? -1;
        let d = Math.sqrt(Math.pow(line.x1 - line.x2, 2) + Math.pow(line.y1 - line.y2, 2)),
            strText;
        if (microns > 0) {
            strText = this._getWithUnit(
                Math.round(d * microns / 10000000) / 100, "m"
            );
        } else {
            strText = Math.round(d) + " px";
        }
        text.set({text: strText, left: (line.x1 + line.x2) / 2, top: (line.y1 + line.y2) / 2});
        return strText;
    }

    _createParts(parameters, options) {
        options.stroke = options.color;
        return [new fabric.Line(parameters, $.extend({
            scaleX: 1,
            scaleY: 1,
            selectable: false,
            factoryId: this.factoryId,
            hasControls: false,
        }, options)), new fabric.Text('', {
            fontSize: 16,
            selectable: false,
            hasControls: false,
            lockUniScaling: true,
            stroke: 'white',
            factoryId: this.factoryId,

            fill: 'black',
            paintFirst: 'stroke',
            strokeWidth: 2,
            scaleX: 1/options.zoomAtCreation,
            scaleY: 1/options.zoomAtCreation
        })];
    }

    _createWrap(parts, options) {
        return new fabric.Group(parts, $.extend({
            factoryId: this.factoryId,
            type: this.type,
            presetID: options.presetID,
            measure: this._updateText(parts[0], parts[1]),
        }, options));
    }
};



// OSDAnnotations.Ruler = class extends OSDAnnotations.AnnotationObjectFactory {
//     constructor(context, autoCreationStrategy, presetManager) {
//         super(context, autoCreationStrategy, presetManager, "ruler", "group");
//         this._current = null;
//
//         //reuse
//         this._textFactory = new OSDAnnotations.Text(context, autoCreationStrategy, presetManager);
//         this._lineFactory = new OSDAnnotations.Line(context, autoCreationStrategy, presetManager);
//     }
//
//     getIcon() {
//         return "square_foot";
//     }
//
//     getDescription(ofObject) {
//         return `Length ${Math.round(ofObject.measure)} mm`;
//     }
//
//     fabricStructure() {
//         return ["line", "text"];
//     }
//
//     getCurrentObject() {
//         return this._current;
//     }
//
//     isEditable() {
//         return false;
//     }
//
//     /**
//      * @param {array} parameters array of a single line points [x1, y1, x2, y2]
//      * @param {Object} options see parent class
//      */
//     create(parameters, options) {
//         let parts = this._createParts(parameters, options);
//         return this._createWrap(parts, options);
//     }
//
//     /**
//      * @param {Object} ofObject fabricjs.Line object that is being copied
//      * @param {array} parameters array of line points [x, y, x, y ..]
//      */
//     copy(ofObject, parameters=undefined) {
//         let line = ofObject.item(0),
//             text = ofObject.item(1);
//         if (!parameters) parameters = [line.x1, line.y1, line.x2, line.y2];
//         return new fabric.Group([fabric.Line(parameters, {
//             fill: line.fill,
//             opacity: line.opacity,
//             strokeWidth: line.strokeWidth,
//             stroke: line.stroke,
//             scaleX: line.scaleX,
//             scaleY: line.scaleY,
//             hasRotatingPoint: line.hasRotatingPoint,
//             borderColor: line.borderColor,
//             cornerColor: line.cornerColor,
//             borderScaleFactor: line.borderScaleFactor,
//             hasControls: line.hasControls,
//             lockMovementX: line.lockMovementX,
//             lockMovementY: line.lockMovementY,
//             originalStrokeWidth: line.originalStrokeWidth,
//             selectable: false,
//         }), new fabric.Text(text.text), {
//             textBackgroundColor: text.textBackgroundColor,
//             fontSize: text.fontSize,
//             lockUniScaling: true,
//             scaleY: text.scaleY,
//             scaleX: text.scaleX,
//             selectable: false,
//             hasControls: false,
//             stroke: text.stroke,
//             fill: text.fill,
//             paintFirst: 'stroke',
//             strokeWidth: text.strokeWidth,
//         }], {
//             presetID: ofObject.presetID,
//             measure: ofObject.measure,
//             meta: ofObject.meta,
//             factoryId: ofObject.factoryId,
//             isLeftClick: ofObject.isLeftClick,
//             type: ofObject.type,
//             layerId: ofObject.layerId,
//             color: ofObject.color,
//             zoomAtCreation: ofObject.zoomAtCreation,
//             selectable: false,
//             hasControls: false
//         });
//     }
//
//     edit(theObject) {
//         //not allowed
//     }
//
//     recalculate(theObject) {
//         //not supported error?
//     }
//
//     instantCreate(screenPoint, isLeftClick = true) {
//         let bounds = this._auto.approximateBounds(screenPoint, false);
//         if (bounds) {
//             let opts = this._presets.getAnnotationOptions(isLeftClick);
//             let object = this.create([bounds.left.x, bounds.top.y, bounds.right.x, bounds.bottom.y], opts);
//             this._context.addAnnotation(object);
//             return true;
//         }
//         return false;
//     }
//
//     initCreate(x, y, isLeftClick) {
//         let opts = this._presets.getAnnotationOptions(isLeftClick);
//         let parts = this._createParts([x, y, x, y], opts);
//         this._updateText(parts[0], parts[1]);
//         this._current = parts;
//         this._context.addHelperAnnotation(this._current[0]);
//         this._context.addHelperAnnotation(this._current[1]);
//
//     }
//
//     updateCreate(x, y) {
//         if (!this._current) return;
//         let line = this._current[0],
//             text = this._current[1];
//         line.set({ x2: x, y2: y });
//         this._updateText(line, text);
//     }
//
//     finishDirect() {
//         let obj = this.getCurrentObject();
//         if (!obj) return;
//         this._context.deleteHelperAnnotation(obj[0]);
//         this._context.deleteHelperAnnotation(obj[1]);
//
//         obj = this._createWrap(obj, this._presets.getCommonProperties());
//         this._context.addAnnotation(obj);
//         this._current = undefined;
//     }
//
//     /**
//      * Create array of points - approximation of the object shape
//      * @return {undefined} not supported, ruler cannot be turned to polygon
//      */
//     toPointArray(obj, converter, quality=1) {
//         return undefined;
//     }
//
//     title() {
//         return "Ruler";
//     }
//
//     exportsProperties() {
//         return ["measure"];
//     }
//
//     _getWithUnit(value, unitSuffix) {
//         if (value < 0.000001) {
//             return value * 1000000000 + " n" + unitSuffix;
//         }
//         if (value < 0.001) {
//             return value * 1000000 + " μ" + unitSuffix;
//         }
//         if (value < 1) {
//             return value * 1000 + " m" + unitSuffix;
//         }
//         if (value >= 1000) {
//             return value / 1000 + " k" + unitSuffix;
//         }
//         return value + " " + unitSuffix;
//     }
//
//     _updateText(line, text) {
//         let microns = APPLICATION_CONTEXT.getOption("microns") ?? -1;
//         let d = Math.sqrt(Math.pow(line.x1 - line.x2, 2) + Math.pow(line.y1 - line.y2, 2)),
//             strText;
//         if (microns > 0) {
//             strText = this._getWithUnit(
//                 Math.round(d * microns / 10000000) / 100, "m"
//             );
//         } else {
//             strText = Math.round(d) + " px";
//         }
//         text.set({text: strText, left: (line.x1 + line.x2) / 2, top: (line.y1 + line.y2) / 2});
//     }
//
//     _createParts(parameters, options) {
//         options.stroke = options.color;
//         return [
//             this._lineFactory.create(parameters, options),
//             this._textFactory.create()
//         ];
//
//
//         return [new fabric.Line(parameters, $.extend({
//             scaleX: 1,
//             scaleY: 1,
//             selectable: false,
//             hasControls: false,
//         }, options)), new fabric.Text('', {
//             fontSize: 16,
//             selectable: false,
//             hasControls: false,
//             lockUniScaling: true,
//             stroke: 'white',
//             fill: 'black',
//             paintFirst: 'stroke',
//             strokeWidth: 2,
//             scaleX: 1/options.zoomAtCreation,
//             scaleY: 1/options.zoomAtCreation
//         })];
//     }
//
//     _createWrap(parts, options) {
//         this._updateText(parts[0], parts[1]);
//         return new fabric.Group(parts, $.extend({
//             factoryId: this.factoryId,
//             type: this.type,
//             measure: 0,
//         }, options));
//     }
// };