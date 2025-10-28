
//todo implement as composition of line and text
OSDAnnotations.Ruler = class extends OSDAnnotations.AnnotationObjectFactory {
    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "ruler", "group");
        this._current = null;
    }

    getIcon() {
        return "straighten";
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
     *
     * @param instance
     * @param options
     */
    configure(instance, options) {
        if (instance.type === "group") {
            this._configureParts(instance.item(0), instance.item(1), options);
            this._configureWrapper(instance, instance.item(0), instance.item(1), options);
        }
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
            originX: 'left',
            originY: 'top'
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
            originX: 'left',
            originY: 'top'
        }], {
            presetID: ofObject.presetID,
            measure: ofObject.measure,
            meta: ofObject.meta,
            factoryID: ofObject.factoryID,
            isLeftClick: ofObject.isLeftClick,
            type: ofObject.type,
            layerID: ofObject.layerID,
            color: ofObject.color,
            zoomAtCreation: ofObject.zoomAtCreation,
            selectable: true,
            hasControls: true,
            hasBorders: false
        });
    }

    edit(theObject) {
        //not allowed
    }

    recalculate(theObject) {
        //not supported error?
    }

    updateRendering(ofObject, preset, visualProperties, defaultVisualProperties) {
        visualProperties.modeOutline = true; // we are always transparent
        ofObject.set({ opacity: 1 });

        if (ofObject._objects) {
            const lineFactory = this._context.getAnnotationObjectFactory('line');
            const textFactory = this._context.getAnnotationObjectFactory('text');

            lineFactory.updateRendering(ofObject._objects[0], preset, visualProperties, defaultVisualProperties);
            textFactory.updateRendering(ofObject._objects[1], preset, visualProperties, defaultVisualProperties);
        }
    }

    applySelectionStyle(ofObject) {
        ofObject._objects[0].set({
            stroke: 'rgba(251, 184, 2, 0.75)',
        });
    }

    onZoom(ofObject, graphicZoom, realZoom) {
        if (ofObject._objects) {
            ofObject._objects[1].set({
                //todo add geometric zoom, do not change opacity
                scaleX: 1/realZoom,
                scaleY: 1/realZoom,
            });
            super.onZoom(ofObject._objects[0], graphicZoom, realZoom);
        }
    }

    instantCreate(screenPoint, isLeftClick = true) {
        let bounds = this._auto.approximateBounds(screenPoint, false);
        if (bounds) {
            //todo bugged
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

    discardCreate() {
        if (this._current) {
            this._context.deleteHelperAnnotation(this._current[0]);
            this._context.deleteHelperAnnotation(this._current[1]);
            this._current = undefined;
        }
    }

    finishDirect() {
        let obj = this.getCurrentObject();
        if (!obj) return true;
        this._context.deleteHelperAnnotation(obj[0]);
        this._context.deleteHelperAnnotation(obj[1]);

        const line = obj[0],
            text = obj[1],
            pid = line.presetID;

        if (Math.abs(line.x1 - line.x2) < 0.1 && Math.abs(line.y1 - line.y2) < 0.1) {
            return true;
        }

        const props = { ...this._presets.getCommonProperties()};
        obj = this._createWrap(obj, props);
        obj.presetID = pid;
        this._context.addAnnotation(obj);
        this._current = undefined;
        return true;
    }

    finishIndirect() {
        this.finishDirect();
    }

    title() {
        return "Ruler";
    }

    supportsBrush() {
        return false;
    }

    getLength(theObject) {
        return theObject._objects[1]?.text;
    }


    _round(value) {
        return Math.round(value * 100) / 100;
    }

    _updateText(line, text) {
        const d = Math.sqrt(Math.pow(line.x1 - line.x2, 2) + Math.pow(line.y1 - line.y2, 2));
        const strText = VIEWER.scalebar.imageLengthToGivenUnits(d);
        //todo update text should not recompute the text value on zoom, does not change
        text.set({text: strText, left: (line.x1 + line.x2) / 2, top: (line.y1 + line.y2) / 2});
        return strText;
    }

    /**
     * Force properties for correct rendering, ensure consitency on
     * the imported objects, e.g. you can use this function in create(...) to avoid implementing stuff twice
     * @param object given object type for the factory type
     */
    import(object) {
    }

    exportsGeometry() {
        return ["x1", "x2", "y1", "y2", "text"];
    }

    selected(theObject) {
        const factory = this._context.getAnnotationObjectFactory('line');
        const absGroupPos = theObject.getPointByOrigin('center', 'center');

        const originalLine = theObject.item(0);
        const copyLine = factory.copy(originalLine);
    
        copyLine.factoryID = factory.factoryID;
        copyLine.type = factory.type;

        copyLine.left = absGroupPos.x + originalLine.left;
        copyLine.top = absGroupPos.y + originalLine.top;

        return super.selected(copyLine);
    }

    toPointArray(obj, converter, digits=undefined, quality=1) {
        const line = obj._objects ? obj._objects[0] : [];

        let x1 = line.x1;
        let y1 = line.y1;
        let x2 = line.x2;
        let y2 = line.y2;

        if (digits !== undefined) {
            x1 = parseFloat(x1.toFixed(digits));
            y1 = parseFloat(y1.toFixed(digits));
            x2 = parseFloat(x2.toFixed(digits));
            y2 = parseFloat(y2.toFixed(digits));
        }
        return [converter(x1, y1), converter(x2, y2)];
    }

    fromPointArray(points, deconvertor) {
        if (!points || points.length < 2) {
            throw new Error("At least two points required");
        }

        const p1 = deconvertor(points[0]);
        const p2 = deconvertor(points[1]);
        return [p1.x, p1.y, p2.x, p2.y];
    }

    _configureLine(line, options) {
        options.stroke = options.color;

        $.extend(line, {
            scaleX: 1,
            scaleY: 1,
            selectable: false,
            factoryID: this.factoryID,
            hasControls: false,
            originX: 'left',
            originY: 'top'
        }, options);
    }

    _configureText(text, options) {
        $.extend(text, {
            fontSize: 18,
            selectable: false,
            hasControls: false,
            lockUniScaling: true,
            stroke: 'white',
            factoryID: this.factoryID,
            fill: 'black',
            paintFirst: 'stroke',
            strokeWidth: 2,
            scaleX: 1/options.zoomAtCreation,
            scaleY: 1/options.zoomAtCreation,
            originX: 'left',
            originY: 'top'
        });
    }

    _configureParts(line, text, options) {
        this._configureText(text, options);
        this._configureLine(line, options);
    }

    _configureWrapper(wrapper, line, text, options) {
        $.extend(wrapper, options, {
            factoryID: this.factoryID,
            type: this.type,
            presetID: options.presetID,
            measure: text.text,
            hasBorders: false,
        });
    }

    _createParts(parameters, options) {
        const line = new fabric.Line(parameters),
            text = new fabric.Text('');
        this._configureParts(line, text, options);
        this._updateText(line, text);
        return [line, text];
    }

    _createWrap(parts, options) {
        options.hasBorders = false;
        const wrap = new fabric.Group(parts);
        this._configureWrapper(wrap, wrap.item(0), wrap.item(1), options);
        return wrap;
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
// exports() {
//     return ["measure"];
// }

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
//             factoryID: ofObject.factoryID,
//             isLeftClick: ofObject.isLeftClick,
//             type: ofObject.type,
//             layerID: ofObject.layerID,
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
//         if (!obj) return true;
//         this._context.deleteHelperAnnotation(obj[0]);
//         this._context.deleteHelperAnnotation(obj[1]);
//
//         obj = this._createWrap(obj, this._presets.getCommonProperties());
//         this._context.addAnnotation(obj);
//         this._current = undefined;
//         return true;
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
//             factoryID: this.factoryID,
//             type: this.type,
//             measure: 0,
//         }, options));
//     }
// };

// OSDAnnotations.Image = class extends OSDAnnotations.AnnotationObjectFactory {
//     constructor(context, autoCreationStrategy, presetManager) {
//         super(context, autoCreationStrategy, presetManager, "image", "image");
//         this._origX = null;
//         this._origY = null;
//         this._current = null;
//     }
//
//     getIcon() {
//         return "image";
//     }
//
//     fabricStructure() {
//         return "image";
//     }
//
//     getDescription(ofObject) {
//         return `Image [${Math.round(ofObject.left)}, ${Math.round(ofObject.top)}]`;
//     }
//
//     getCurrentObject() {
//         return this._current;
//     }
//
//     /**
//      * @param {Object} parameters object of the following properties:
//      *              - img: <img> element.
//      *              - left: offset in the image dimension
//      *              - top: offset in the image dimension
//      *              - width: optional image width
//      *              - height: optional image height
//      *              - opacity: opacity
//      * @param {Object} options see parent class
//      */
//     create(parameters, options) {
//         const img = parameters.img;
//         delete parameters.img;
//         const instance = new fabric.Image(img, parameters);
//         return this.configure(instance, options);
//     }
//
//     configure(object, options) {
//         $.extend(object, options, {
//             strokeWidth: 1,
//             originalStrokeWidth: 1,
//             type: this.type,
//             factoryID: this.factoryID,
//         });
//         return object;
//     }
//
//     /**
//      * @param {Object} ofObject fabricjs.Rect object that is being copied
//      * @param {Object} parameters object of the following properties:
//      *              - left: offset in the image dimension
//      *              - top: offset in the image dimension
//      *              - width: rect width
//      *              - height: rect height
//      */
//     copy(ofObject, parameters=undefined) {
//         //to do defalt implementation like this?
//         return $.extend(fabric.util.object.clone(ofObject), parameters);
//     }
//
//     /**
//      * A list of extra properties to export upon export event
//      * @return {string[]}
//      */
//     exports() {
//        to do: with these all objects now export (in native format), iterate to remove from other
//         return ["scaleX", "scaleY"]; //"left", "top", "width", "height", "opacity",
//     }
//
//     edit(theObject) {
//         this._left = theObject.left;
//         this._top = theObject.top;
//         theObject.set({
//             hasControls: true,
//             lockMovementX: false,
//             lockMovementY: false
//         });
//     }
//
//     recalculate(theObject) {
//         let left = theObject.left,
//             top = theObject.top;
//         theObject.set({ left: this._left, top: this._top, hasControls: false,
//             lockMovementX: true, lockMovementY: true});
//         let newObject = this.copy(theObject, {left: left, top: top});
//         delete newObject.incrementId; //todo make this nicer, avoid always copy of this attr
//         theObject.calcACoords();
//         this._context.replaceAnnotation(theObject, newObject);
//     }
//
//     instantCreate(screenPoint, isLeftClick = true) {
//         return false;
//     }
//
//     initCreate(x, y, isLeftClick) {
//         this._origX = x;
//         this._origY = y;
//         this._current = new fabric.Rect($.extend({
//             left: x,
//             top: y,
//             width: 1,
//             height: 1
//         }, this._presets.getAnnotationOptions(isLeftClick)));
//         this._context.addHelperAnnotation(this._current);
//     }
//
//     updateCreate(x, y) {
//         if (!this._current) return;
//         if (this._origX > x) this._current.set({ left: x });
//         if (this._origY > y) this._current.set({ top: y });
//
//         let width = Math.abs(x - this._origX);
//         let height = Math.abs(y - this._origY);
//         this._current.set({ width: width, height: height });
//     }
//
//     onZoom(ofObject, graphicZoom, realZoom) {
//         //nothing
//     }
//
//     finishDirect() {
//         let obj = this.getCurrentObject();
//         if (!obj) return true;
//
//         const self = this;
//         UTILITIES.uploadFile(url => {
//             const image = document.createElement('img');
//             image.onload = () => {
//                 self._context.deleteHelperAnnotation(obj);
//                 self._context.addAnnotation(self.create({
//                         top: obj.top,
//                         left: obj.left,
//                         scaleX: obj.width / image.width,
//                         scaleY: obj.height / image.height,
//                         img: image
//                 }, this._presets.getAnnotationOptions(obj.isLeftClick)));
//             };
//             image.onerror = () => {
//                 self._context.deleteHelperAnnotation(obj);
//             };
//             image.onabort = () => {
//                 self._context.deleteHelperAnnotation(obj);
//             }
//             image.setAttribute('src', url);
//         }, "image/*", "url");
//         this._current = undefined;
//         return true;
//     }
//
//     finishIndirect() {
//         this.finishDirect();
//     }
//
//     title() {
//         return "Image";
//     }
// };
