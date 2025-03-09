OSDAnnotations.Rect = class extends OSDAnnotations.AnnotationObjectFactory {
    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "rect", "rect");
        this._origX = null;
        this._origY = null;
        this._current = null;
    }

    getIcon() {
        return "crop_5_4";
    }

    fabricStructure() {
        return "rect";
    }

    getDescription(ofObject) {
        return `Rect [${Math.round(ofObject.left)}, ${Math.round(ofObject.top)}]`;
    }

    getCurrentObject() {
        return this._current;
    }

    /**
     * @param {Object} parameters object of the following properties:
     *              - left: offset in the image dimension
     *              - top: offset in the image dimension
     *              - width: rect width
     *              - height: rect height
     * @param {Object} options see parent class
     */
    create(parameters, options) {
        const instance = new fabric.Rect(parameters);
        return this.configure(instance, options);
    }

    /**
     * Force properties for correct rendering, ensure consitency on
     * the imported objects, e.g. you can use this function in create(...) to avoid implementing stuff twice
     * @param object given object type for the factory type
     * @param options
     */
    configure(object, options) {
        $.extend(object, {
            type: this.type,
            factoryID: this.factoryID,
        }, options);
        return object;
    }

    /**
     * @param {Object} ofObject fabricjs.Rect object that is being copied
     * @param {Object} parameters object of the following properties:
     *              - left: offset in the image dimension
     *              - top: offset in the image dimension
     *              - width: rect width
     *              - height: rect height
     */
    copy(ofObject, parameters=undefined) {
        if (!parameters) parameters = ofObject;
        const copy = this.copyProperties(ofObject);
        copy.left = parameters.left;
        copy.top = parameters.top;
        copy.width = parameters.width;
        copy.height = parameters.height;
        return new fabric.Rect(copy);
    }

    getArea(theObject) {
        return theObject.width * theObject.height;
    }

    exportsGeometry() {
        return ["left", "top", "width", "height"];
    }

    edit(theObject) {
        this._left = theObject.left;
        this._top = theObject.top;
        theObject.set({
            hasControls: true,
            lockMovementX: false,
            lockMovementY: false
        });
    }

    recalculate(theObject) {
        let height = theObject.getScaledHeight(),
            width = theObject.getScaledWidth(),
            left = theObject.left,
            top = theObject.top;
        theObject.set({ left: this._left, top: this._top, scaleX: 1, scaleY: 1,
            hasControls: false, lockMovementX: true, lockMovementY: true});
        let newObject = this.copy(theObject, {
            left: left, top: top, width: width, height: height
        });
        theObject.calcACoords();
        this._context.replaceAnnotation(theObject, newObject);
    }

    instantCreate(screenPoint, isLeftClick = true) {
        let bounds = this._auto.approximateBounds(screenPoint);
        if (bounds) {
            this._context.addAnnotation(this.create({
                left: bounds.left.x,
                top: bounds.top.y,
                width: bounds.right.x - bounds.left.x,
                height: bounds.bottom.y - bounds.top.y
            }, this._presets.getAnnotationOptions(isLeftClick)));
            return true;
        }
        return false;
    }

    initCreate(x, y, isLeftClick) {
        this._origX = x;
        this._origY = y;
        this._current = this.create({
            left: x,
            top: y,
            width: 1,
            height: 1
        }, this._presets.getAnnotationOptions(isLeftClick));
        this._context.addHelperAnnotation(this._current);
    }

    updateCreate(x, y) {
        if (!this._current) return;
        if (this._origX > x) this._current.set({ left: x });
        if (this._origY > y) this._current.set({ top: y });

        let width = Math.abs(x - this._origX);
        let height = Math.abs(y - this._origY);
        this._current.set({ width: width, height: height });
    }

    finishDirect() {
        let obj = this.getCurrentObject();
        if (!obj) return true;
        //todo fix? just promote did not let me to select the object this._context.promoteHelperAnnotation(obj);
        this._context.deleteHelperAnnotation(obj);
        this._context.addAnnotation(obj);
        this._current = undefined;
        return true;
    }

    /**
     * Create array of points - approximation of the object shape
     * @param {Object} obj fabricJS.Rect obj object that is being approximated
     * @param {function} converter take two elements and convert and return item
     * @param {number} digits
     * @param {number} quality between 0 and 1, of the approximation in percentage (1 = 100%)
     * @return {Array} array of items returned by the converter - points
     */
    toPointArray(obj, converter, digits=undefined, quality=1) {
        let w = obj.width, h = obj.height;
        if (digits !== undefined) {
            return [
                converter(parseFloat(Number(obj.left).toFixed(digits)), parseFloat(Number(obj.top).toFixed(digits))),
                converter(parseFloat(Number(obj.left + w).toFixed(digits)), parseFloat(Number(obj.top).toFixed(digits))),
                converter(parseFloat(Number(obj.left + w).toFixed(digits)), parseFloat(Number(obj.top + h).toFixed(digits))),
                converter(parseFloat(Number(obj.left).toFixed(digits)), parseFloat(Number(obj.top + h).toFixed(digits)))
            ];
        }
        return [
            converter(obj.left, obj.top),
            converter(obj.left + w, obj.top),
            converter(obj.left + w, obj.top + h),
            converter(obj.left, obj.top + h)
        ];
    }

    title() {
        return "Rectangle";
    }
};

OSDAnnotations.Ellipse = class extends OSDAnnotations.AnnotationObjectFactory {
    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "ellipse", "ellipse");
        this._origX = null;
        this._origY = null;
        this._current = null;
    }

    getIcon() {
        return "brightness_1";
    }

    fabricStructure() {
        return "ellipse";
    }

    getDescription(ofObject) {
        return `Ellipse [${Math.round(ofObject.left)}, ${Math.round(ofObject.top)}]`;
    }

    getCurrentObject() {
        return this._current;
    }

    /**
     *
     * @param {Object} parameters object of the following properties:
     *              - left: offset in the image dimension
     *              - top: offset in the image dimension
     *              - rx: major axis radius
     *              - ry: minor axis radius
     * @param {Object} options see parent class
     */
    create(parameters, options) {
        const instance = new fabric.Ellipse(parameters);
        return this.configure(instance, options);
    }

    /**
     * Force properties for correct rendering, ensure consitency on
     * the imported objects, e.g. you can use this function in create(...) to avoid implementing stuff twice
     * @param object given object type for the factory type
     * @param options
     */
    configure(object, options) {
        $.extend(object, {
            angle: 0,
            type: this.type,
            factoryID: this.factoryID
        }, options);
        return object;
    }

    exportsGeometry() {
        return ["left", "top", "rx", "ry"];
    }

    /**
     * @param {Object} ofObject fabricjs.Ellipse object that is being copied
     * @param {Object} parameters object of the following properties:
     *              - left: offset in the image dimension
     *              - top: offset in the image dimension
     *              - rx: major axis radius
     *              - ry: minor axis radius
     */
    copy(ofObject, parameters=undefined) {
        if (!parameters) parameters = ofObject;
        const copy = this.copyProperties(ofObject);
        copy.left = parameters.left;
        copy.top = parameters.top;
        copy.rx = parameters.rx;
        copy.ry = parameters.ry;
        return new fabric.Ellipse(copy);
    }

    getArea(theObject) {
        return Math.PI * theObject.rx * theObject.ry;
    }

    edit(theObject) {
        this._left = theObject.left;
        this._top = theObject.top;
        theObject.set({
            hasControls: true,
            lockMovementX: false,
            lockMovementY: false
        });
    }

    recalculate(theObject) {
        let rx = theObject.rx * theObject.scaleX,
            ry = theObject.ry * theObject.scaleY,
            left = theObject.left,
            top = theObject.top;
        theObject.set({ left: this._left, top: this._top, scaleX: 1, scaleY: 1,
            hasControls: false, lockMovementX: true, lockMovementY: true});
        let newObject = this.copy(theObject, {
            left: left, top: top, rx: rx, ry: ry
        });
        theObject.calcACoords();
        this._context.replaceAnnotation(theObject, newObject);
    }

    instantCreate(screenPoint, isLeftClick = true) {
        let bounds = this._auto.approximateBounds(screenPoint);
        if (bounds) {
            this._context.addAnnotation(this.create({
                left: bounds.left.x,
                top: bounds.top.y,
                rx: (bounds.right.x - bounds.left.x) / 2,
                ry: (bounds.bottom.y - bounds.top.y) / 2
            }, this._presets.getAnnotationOptions(isLeftClick)));
            return true;
        }
        return false;
    }

    initCreate(x, y, isLeftClick = true) {
        this._origX = x-1;
        this._origY = y-1;
        this._current = this.create({
            left: x-1,
            top: y-1,
            rx: 1,
            ry: 1
        }, this._presets.getAnnotationOptions(isLeftClick));
        this._context.addHelperAnnotation(this._current);
    }

    updateCreate(x, y) {
        if (!this._current) return;
        let width = Math.abs(x - this._origX);
        let height = Math.abs(y - this._origY);
        this._current.set({
            left:this._origX - width,
            top:this._origY - height,
            rx: width, ry: height
        });
    }

    finishDirect() {
        let obj = this.getCurrentObject();
        if (!obj) return true;
        //todo fix? just promote did not let me to select the object this._context.promoteHelperAnnotation(obj);
        this._context.deleteHelperAnnotation(obj);
        this._context.addAnnotation(obj);
        this._current = undefined;
        return true;
    }

    /**
     * Create array of points - approximation of the object shape
     * @param {fabric.Ellipse} obj object that is being approximated
     * @param {function} converter take two elements and convert and return item
     * @param {number} digits
     * @param {number} quality between 0 and 1, of the approximation in percentage (1 = 100%)
     * @return {Array} array of items returned by the converter - points
     */
    toPointArray(obj, converter, digits=undefined, quality=1) {
        //see https://math.stackexchange.com/questions/2093569/points-on-an-ellipse
        //formula author https://math.stackexchange.com/users/299599/ng-chung-tak
        let reversed = obj.rx < obj.ry, //since I am using sqrt, need rx > ry
            rx = reversed ? obj.ry : obj.rx,
            ry = reversed ? obj.rx : obj.ry,
            pow2e = 1 - (ry * ry) / (rx * rx),
            pow3e = pow2e * Math.sqrt(pow2e),
            pow4e = pow2e * pow2e,
            pow6e = pow3e * pow3e;

        //lets interpret the quality of approximation by number of points generated, 100% = 30 points
        let step = Math.PI / (30*quality), points = [];

        for (let t = 0; t < 2 * Math.PI; t += step) {
            let param = t - (pow2e / 8 + pow4e / 16 + 71 * pow6e / 2048) * Math.sin(2 * t)
                + ((5 * pow4e + 5 * pow6e) / 256) * Math.sin(4 * t)
                + (29 * pow6e / 6144) * Math.sin(6 * t),
                x,y;
            if (reversed) {
                x = ry * Math.sin(param) + obj.left + ry;
                y = rx * Math.cos(param) + obj.top + rx;
            } else {
                x = rx * Math.cos(param) + obj.left + rx;
                y = ry * Math.sin(param) + obj.top + ry;
            }

            points.push(digits === undefined ? converter(x, y) :
                converter(parseFloat(Number(x).toFixed(digits)), parseFloat(Number(y).toFixed(digits))));
        }
        return points;
    }

    title() {
        return "Ellipse";
    }
};


OSDAnnotations.Text = class extends OSDAnnotations.AnnotationObjectFactory {

    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "text", "text");
    }

    getIcon() {
        return "language_japanese_kana";
    }

    fabricStructure() {
        return "text";
    }

    getDescription(ofObject) {
        return ofObject.text;
    }

    getCurrentObject() {
        return this._current;
    }

    /**
     * @param {object} parameters
     * @param {string} parameters.text text to display
     * @param {number} parameters.left
     * @param {number} parameters.top
     * @param {number} parameters.fontSize  optional
     * @param {number} parameters.autoScale optional default false
     * @param {Object} options see parent class
     */
    create(parameters, options) {
        const instance = new fabric.Text(parameters.text);
        return this.configure(instance, $.extend(options, parameters));
    }


    /**
     * Force properties for correct rendering, ensure consitency on
     * the imported objects, e.g. you can use this function in create(...) to avoid implementing stuff twice
     * @param object given object type for the factory type
     * @param options
     */
    configure(object, options) {
        options.autoScale = object.autoScale || options.autoScale || false;
        if (options.autoScale) {
            $.extend(object, options, {
                fontSize: options.fontSize || 16,
                type: this.type,
                factoryID: this.factoryID,
                selectable: false,
                hasControls: false,
                lockUniScaling: true,
                stroke: 'white',
                fill: 'black',
                paintFirst: 'stroke',
                strokeWidth: 4 / options.zoomAtCreation,
                fontFamily: 'Helvetica Nue, Helvetica, Sans-Serif, Arial, Trebuchet MS',
                scaleX: 1/options.zoomAtCreation,
                scaleY: 1/options.zoomAtCreation,
                fontWeight: 'bold',
            });
        } else {
            $.extend(object, options, {
                fontSize: (options.fontSize || 16) / options.zoomAtCreation,
                type: this.type,
                factoryID: this.factoryID,
                selectable: false,
                hasControls: false,
                lockUniScaling: true,
                stroke: 'white',
                fill: 'black',
                paintFirst: 'stroke',
                strokeWidth: 4 / options.zoomAtCreation,
                fontFamily: 'Helvetica Nue, Helvetica, Sans-Serif, Arial, Trebuchet MS',
                scaleX: 1,
                scaleY: 1,
                fontWeight: 'bold'
            });
        }
        return object;
    }

    updateRendering(ofObject, preset, visualProperties, defaultVisualProperties) {
        // ensure necessary properties are not modified!
        delete visualProperties["stroke"];
        delete visualProperties["fill"];
        delete visualProperties["strokeWidth"];
        delete visualProperties["originalStrokeWidth"];
        // no support for internal logics, text driven its own scaling, just set the rest
        ofObject.set(visualProperties);
    }

    onZoom(ofObject, graphicZoom, realZoom) {
        if (ofObject.autoScale) {
            ofObject.set({
                scaleX: 1/realZoom,
                scaleY: 1/realZoom
            });
        }
        ofObject.isAtZoom = realZoom;
    }

    // /**
    //  * Force properties for correct rendering, ensure consitency on
    //  * the imported objects, e.g. you can use this function in create(...) to avoid implementing stuff twice
    //  *
    //  * todo removal did not break stuff?
    //  * @param object given object type for the factory type
    //  */
    // import(object, atZoom) {
    //     object.lockUniScaling = true;
    //     object.stroke = 'white';
    //     object.fill = 'black';
    //     object.paintFirst = 'stroke';
    //     object.strokeWidth = 2;
    //     object.fontFamily = 'Helvetica Nue, Helvetica, Sans-Serif, Arial, Trebuchet MS';
    // }

    /**
     * A list of extra properties to export upon export event
     * @return {string[]}
     */
    exports() {
        return ["autoScale"]; //"text", "left", "top", "fontSize"
    }

    exportsGeometry() {
        return ["text", "left", "top", "fontSize"];
    }

    supportsBrush() {
        return false;
    }

    /**
     * @param {Object} ofObject fabricjs.Polygon object that is being copied
     * @param {object} parameters
     * @param {string} parameters.text text to display
     * @param {number} parameters.left
     * @param {number} parameters.top
     * @param {number} parameters.fontSize  optional
     */
    copy(ofObject, parameters) {
        parameters = parameters || {text: ofObject.text, left: ofObject.left, top: ofObject.top};
        let props = this.copyProperties(ofObject,
            "paintFirst", "lockUniScaling", "fontSize", "fontFamily", "textAlign", "autoScale");
        $.extend(props, parameters);
        props.paintFirst = 'stroke';
        return new fabric.Text(parameters.text, props);
    }

    edit(theObject) {
        this._left = theObject.left;
        this._top = theObject.top;
        theObject.set({
            lockMovementX: false,
            lockMovementY: false
        });
    }

    getCreationRequiredMouseDragDurationMS() {
        return -1; //always allow
    }

    recalculate(theObject) {
        let left = theObject.left,
            top = theObject.top,
            text = this._context.getAnnotationDescription(theObject, "category", false) || theObject.text;

        theObject.set({ left: this._left, top: this._top, scaleX: 1, scaleY: 1,
            hasControls: false, lockMovementX: true, lockMovementY: true});
        let newObject = this.copy(theObject, {left: left, top: top, text: text});
        theObject.calcACoords();
        this._context.replaceAnnotation(theObject, newObject);
    }

    instantCreate(screenPoint, isLeftClick = true) {
        //todo initCreate?
        return undefined;
    }

    initCreate(x, y, isLeftClick = true) {
        this._origX = x;
        this._origY = y;
        const text = this._context.presets.getActivePreset(isLeftClick).meta?.category.value || 'Text';
        this._current = this.create({
            text: text,
            top: y,
            left: x,
        }, this._presets.getAnnotationOptions(isLeftClick));
        this._context.addAnnotation(this._current);
        this._context.canvas.renderAll();
    }

    isImplicit() {
        //text is implicitly drawn (using fonts)
        return true;
    }

    title() {
        return "Text";
    }

    toPointArray(obj, converter, digits=undefined, quality=1) {
        if (digits !== undefined) {
            return [converter(parseFloat(Number(obj.left).toFixed(digits)), parseFloat(Number(obj.top).toFixed(digits)))];
        }
        return [converter(obj.left, obj.top)];
    }
};


/**
 * A point
 * @type {OSDAnnotations.Point}
 */
OSDAnnotations.Point = class extends OSDAnnotations.Ellipse {
    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager);
        this.factoryID = "point";
    }

    getIcon() {
        return "radio_button_checked";
    }

    getDescription(ofObject) {
        return `Point [${Math.round(ofObject.top)}, ${Math.round(ofObject.left)}]`;
    }

    /**
     * todo necessary? we use ellipse
     * @param {object} parameters
     * @param {number} parameters.x
     * @param {number} parameters.y
     * @param options see parent class
     */
    create(parameters, options) {
        const instance = new fabric.Ellipse({left: parameters.x, top: parameters.y});
        return this.configure(instance, options);
    }

    /**
     * @param {Object} ofObject fabricjs.Ellipse point object that is being copied
     * @param {object} parameters
     * @param {number} parameters.x
     * @param {number} parameters.y
     */
    copy(ofObject, parameters=undefined) {
        if (!parameters) parameters = ofObject;
        const copy = this.copyProperties(ofObject);
        copy.left = parameters.x;
        copy.top = parameters.y;
        return new fabric.Ellipse(copy);
    }

    /**
     * Force properties for correct rendering, ensure consitency on
     * the imported objects, e.g. you can use this function in create(...) to avoid implementing stuff twice
     * @param object given object type for the factory type
     * @param options
     */
    configure(object, options) {
        $.extend(object, options, {
            angle: 0,
            rx: 10,
            ry: 10,
            strokeWidth: 1,
            originalStrokeWidth: 1,
            originX: 'center',
            originY: 'center',
            type: this.type,
            factoryID: this.factoryID,
            fill: options.color,
        });
        //todo not directly draggable some error there -> update force bounds
        return object;
    }

    onZoom(ofObject, graphicZoom, realZoom) {
        ofObject.scaleX = 1/graphicZoom;
        ofObject.scaleY = 1/graphicZoom;
    }

    updateRendering(ofObject, preset, visualProperties, defaultVisualProperties) {
        visualProperties.modeOutline = false;
        visualProperties.stroke = preset.color;
        delete visualProperties.originalStrokeWidth;
        super.updateRendering(ofObject, preset, visualProperties, defaultVisualProperties);
    }

    edit(theObject) {
        this._left = theObject.left;
        this._top = theObject.top;
        theObject.set({
            lockMovementX: false,
            lockMovementY: false
        });
    }

    recalculate(theObject) {
        let left = theObject.left,
            top = theObject.top;
        theObject.set({ left: this._left, top: this._top,
            hasControls: false, lockMovementX: true, lockMovementY: true});
        let newObject = this.copy(theObject, {x: left, y: top});
        theObject.calcACoords();
        this._context.replaceAnnotation(theObject, newObject);
    }

    instantCreate(screenPoint, isLeftClick = true) {
        return undefined;
    }

    initCreate(x, y, isLeftClick = true) {
        const instance = this.create({
            x: x,
            y: y
        }, this._presets.getAnnotationOptions(isLeftClick));
        instance.scaleX = 1/instance.zoomAtCreation;
        instance.scaleY = 1/instance.zoomAtCreation;
        this._context.addAnnotation(instance);
        return true;
    }

    supportsBrush() {
        return false;
    }

    toPointArray(obj, converter, digits=undefined, quality=1) {
        if (digits !== undefined) {
            return [converter(parseFloat(Number(obj.left).toFixed(digits)), parseFloat(Number(obj.top).toFixed(digits)))];
        }
        return [converter(obj.left, obj.top)];
    }

    title() {
        return "Point";
    }
};

OSDAnnotations.ExplicitPointsObjectFactory = class extends OSDAnnotations.AnnotationObjectFactory {

    constructor(context, autoCreationStrategy, presetManager, factoryID, type, fabricClass, withHelperPoints=true) {
        super(context, autoCreationStrategy, presetManager, factoryID, type);
        this._initialize(false);
        this.Class = fabricClass;
        this.withHelperPoints = withHelperPoints;
    }

    getCurrentObject() {
        return this._current;
    }

    /**
     * @param {Array} parameters array of objects with {x, y} properties (points)
     * @param {Object} options see parent class
     */
    create(parameters, options) {
        const instance = new this.Class(parameters);
        return this.configure(instance, options);
    }

    discardCreate() {
        if (this._current) {
            this._current.set({points: []});
            this.finishIndirect();
        }
    }

    undoCreate() {
        if (!this.canUndoCreate()) return;

        if (this._current?.points.length < 2) {
            this.finishIndirect();
        } else {
            const polygon = this._current;
            polygon.points.pop();
            if (this._followPoint) {
                const currentPoint = polygon.points[polygon.points.length - 1];
                this._followPoint.set({left: currentPoint.x, top: currentPoint.y});
            }
            polygon.setCoords();
            this._context.canvas.renderAll();
        }
    }

    canUndoCreate() {
        if (this._polygonBeingCreated && this._current?.points) return true;
        return undefined; // allow super execution
    }

    canRedoCreate() {
        if (this._polygonBeingCreated && this._current?.points) return false; //not implemented
        return undefined; // allow super execution
    }

    exportsGeometry() {
        return ["points"];
    }

    /**
     * @param {Object} ofObject fabricjs.Polygon object that is being copied
     * @param {Array} parameters array of points: {x, y} objects
     */
    copy(ofObject, parameters) {
        if (!parameters) parameters = [...ofObject.points];
        const props = this.copyProperties(ofObject);
        delete props.points;
        return new this.Class(parameters, props);
    }

    getArea(theObject) {
        let total = 0;
        const points = theObject.points;
        for (let i = 0; i < points.length; i++) {
            const addX = points[i].x;
            const addY = points[i === points.length - 1 ? 0 : i + 1].y;
            const subX = points[i === points.length - 1 ? 0 : i + 1].x;
            const subY = points[i].y;
            total += (addX * addY * 0.5) - (subX * subY * 0.5);
        }
        return Math.abs(total);
    }

    edit(theObject) {
        this._origPoints = [...theObject.points];
        this._context.canvas.setActiveObject(theObject);

        var lastControl = theObject.points.length - 1;
        const _this = this;
        theObject.cornerStyle = 'circle';
        theObject.cornerColor = '#fbb802';
        theObject.hasControls = true;
        theObject.objectCaching = false;
        theObject.transparentCorners = false;
        theObject.controls = theObject.points.reduce(function(acc, point, index) {
            acc['p' + index] = new fabric.Control({
                positionHandler: _this._polygonPositionHandler,
                actionHandler: _this._anchorWrapper(index > 0 ? index - 1 : lastControl, _this._actionHandler),
                actionName: 'modifyPolygon',
                pointIndex: index
            });
            return acc;
        }, { });
        this._context.canvas.renderAll();
    }

    _polygonPositionHandler(dim, finalMatrix, fabricObject) {
        var x = (fabricObject.points[this.pointIndex].x - fabricObject.pathOffset.x),
            y = (fabricObject.points[this.pointIndex].y - fabricObject.pathOffset.y);
        return fabric.util.transformPoint(
            { x: x, y: y },
            fabric.util.multiplyTransformMatrices(
                fabricObject.canvas.viewportTransform,
                fabricObject.calcTransformMatrix()
            )
        );
    }

    _actionHandler(eventData, transform, x, y) {
        var polygon = transform.target,
            mouseLocalPosition = polygon.toLocalPoint(new fabric.Point(x, y), 'center', 'center'),
            polygonBaseSize = polygon._getNonTransformedDimensions(),
            size = polygon._getTransformedDimensions(0, 0);
        polygon.points[polygon.controls[polygon.__corner].pointIndex] = {
            x: mouseLocalPosition.x * polygonBaseSize.x / size.x + polygon.pathOffset.x,
            y: mouseLocalPosition.y * polygonBaseSize.y / size.y + polygon.pathOffset.y
        };
        return true;
    }

    _anchorWrapper(anchorIndex, fn) {
        return function(eventData, transform, x, y) {
            let fabricObject = transform.target,
                absolutePoint = fabric.util.transformPoint({
                    x: (fabricObject.points[anchorIndex].x - fabricObject.pathOffset.x),
                    y: (fabricObject.points[anchorIndex].y - fabricObject.pathOffset.y),
                }, fabricObject.calcTransformMatrix()),
                actionPerformed = fn(eventData, transform, x, y);
            fabricObject._setPositionDimensions({});
            let polygonBaseSize = fabricObject._getNonTransformedDimensions(),
                newX = (fabricObject.points[anchorIndex].x - fabricObject.pathOffset.x) / polygonBaseSize.x,
                newY = (fabricObject.points[anchorIndex].y - fabricObject.pathOffset.y) / polygonBaseSize.y;
            fabricObject.setPositionByOrigin(absolutePoint, newX + 0.5, newY + 0.5);
            return actionPerformed;
        }
    }

    recalculate(theObject) {
        theObject.controls = fabric.Object.prototype.controls;
        theObject.hasControls = false;
        theObject.strokeWidth = this._presets.getCommonProperties().strokeWidth;

        if (!theObject.points.every(
            (value, index) => value === this._origPoints[index])) {
            let newObject = this.copy(theObject, theObject.points);
            theObject.points = this._origPoints;
            this._context.replaceAnnotation(theObject, newObject);
            this._context.canvas.renderAll();
        }
        this._origPoints = null;
        this._initialize(false);
    }

    instantCreate(screenPoint, isLeftClick = true) {
        const _this = this;
        //(async function _() {
        let result = /*await*/ _this._auto.createOutline(screenPoint);

        if (!result || result.length < 3) return false;
        result = OSDAnnotations.PolygonUtilities.simplify(result);
        _this._context.addAnnotation(
            _this.create(result, _this._presets.getAnnotationOptions(isLeftClick))
        );
        return true;
        //})();
    }

    getCreationRequiredMouseDragDurationMS() {
        return -1; //always allow
    }

    _getCommonHelperProps() {
        return  {
            selectable: false,
            hasControls: false,
            evented: false,
            objectCaching: false,
            hasBorders: false,
            lockMovementX: true,
            lockMovementY: true
        };
    }

    initCreate(x, y, isLeftClick = true) {
        if (!this._polygonBeingCreated) {
            this._initialize();
        }

        const properties = this._getCommonHelperProps();

        //create circle representation of the point
        let polygon = this._current,
            index = polygon && polygon.points ? polygon.points.length : -1;

        if (this.withHelperPoints) {
            if (index < 1) {
                this._initPoint = this._createControlPoint(x, y, properties);
                this._initPoint.set({fill: '#d93442', radius: this._initPoint.radius*2});
                this._context.addHelperAnnotation(this._initPoint);
            } else {
                if (Math.sqrt(Math.pow(this._initPoint.left - x, 2) +
                    Math.pow(this._initPoint.top - y, 2)) < 20 / VIEWER.scalebar.imagePixelSizeOnScreen()) {
                    this.finishIndirect();
                    return;
                }
            }
        }

        if (!polygon) {
            polygon = this.create([{ x: x, y: y }],
                $.extend(properties, this._presets.getAnnotationOptions(isLeftClick))
            );
            this._context.addHelperAnnotation(polygon);
            this._current = polygon;
        } else {
            if (this.withHelperPoints) {
                if (!this._followPoint) {
                    this._followPoint = this._createControlPoint(x, y, properties);
                    this._context.addHelperAnnotation(this._followPoint);
                } else {
                    this._followPoint.set({left: x, top: y});
                }
            }
            polygon.points.push({x: x, y: y});
            polygon.setCoords();
        }
        this._context.canvas.renderAll();
    }

    updateCreate(x, y) {
        if (!this._polygonBeingCreated) return;

        let lastIdx = this._current.points.length - 1,
            last = this._current.points[lastIdx],
            dy = last.y - y,
            dx = last.x - x;

        let powRad = this._getRelativePixelDiffDistSquared(10);
        //startPoint is twice the radius of distance with relativeDiff 10, if smaller
        //the drag could end inside finish zone
        if ((lastIdx === 0 && dx * dx + dy * dy > powRad * 4) || (lastIdx > 0 && dx * dx + dy * dy > powRad * 2)) {
            this.initCreate(x, y);
        }
    }

    isImplicit() {
        return false;
    }

    finishIndirect() {
        if (!this._current) return;

        let points = this._current.points;
        this._context.deleteHelperAnnotation(this._initPoint);
        if (this._followPoint) this._context.deleteHelperAnnotation(this._followPoint);
        this._context.deleteHelperAnnotation(this._current);
        if (points.length < 3) {
            this._initialize(false);
            return;
        }

        this._current = this.create(OSDAnnotations.PolygonUtilities.simplify(points),
            this._presets.getAnnotationOptions(this._current.isLeftClick));
        this._context.addAnnotation(this._current);
        this._initialize(false);
    }

    /**
     * Create array of points - approximation of the object shape
     * @param {Object} obj fabricjs.Polygon object that is being approximated
     * @param {function} converter take two elements and convert and return item
     * @param {number} digits
     * @param {number} quality between 0 and 1, of the approximation in percentage (1 = 100%)
     * @return {Array} array of items returned by the converter - points
     */
    toPointArray(obj, converter, digits=undefined, quality=1) {
        let points = obj.points;
        if (quality < 1) points = OSDAnnotations.PolygonUtilities.simplifyQuality(points, quality);

        //we already have object points, convert only if necessary
        if (converter !== OSDAnnotations.AnnotationObjectFactory.withObjectPoint) {
            if (digits !== undefined) {
                return points.map(p => converter(parseFloat(Number(p.x).toFixed(digits)),
                    parseFloat(Number(p.y).toFixed(digits))));
            }
            return points.map(p => converter(p.x, p.y));
        } else if (digits !== undefined) {
            return points.map(p => converter(parseFloat(Number(p.x).toFixed(digits)),
                parseFloat(Number(p.y).toFixed(digits))));
        }
        return points;
    }

    _initialize(isNew = true) {
        this._polygonBeingCreated = isNew;
        this._initPoint = null;
        this._current = null;
        this._followPoint = null;
    }

    //todo replace with the control API (as with edit)
    _createControlPoint(x, y, commonProperties) {
        return new fabric.Circle($.extend(commonProperties, {
            radius: 5 / VIEWER.scalebar.imagePixelSizeOnScreen(),
            fill: '#fbb802',
            left: x,
            top: y,
            originX: 'center',
            originY: 'center',
            factory: "__private",
        }));
    }

    //todo add to factory as some general functions
    _getRelativePixelDiffDistSquared(relativeDiff) {
        return Math.pow(1 / VIEWER.scalebar.imagePixelSizeOnScreen() * relativeDiff, 2);
    }
};


OSDAnnotations.Line = class extends OSDAnnotations.AnnotationObjectFactory {

    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "line", "line");
    }

    getIcon() {
        return "horizontal_rule";
    }

    fabricStructure() {
        return "line";
    }

    getDescription(ofObject) {
        return `Line [${Math.round(ofObject.left)}, ${Math.round(ofObject.top)}]`;
    }

    getCurrentObject() {
        return this._current;
    }

    /**
     * @param {Array} parameters array of objects with {x, y} properties (points)
     * @param {Object} options see parent class
     */
    create(parameters, options) {
        const instance = new fabric.Line(parameters);
        return this.configure(instance, options);
    }

    /**
     * Force properties for correct rendering, ensure consitency on
     * the imported objects, e.g. you can use this function in create(...) to avoid implementing stuff twice
     * @param object given object type for the factory type
     * @param options
     */
    configure(object, options) {
        $.extend(object, options, {
            fill: "",
            stroke: options.color,
            type: this.type,
            factoryID: this.factoryID,
        });
        return object;
    }

    exportsGeometry() {
        return ["x1", "x2", "y1", "y2"];
    }

    updateRendering(ofObject, preset, visualProperties, defaultVisualProperties) {
        visualProperties.modeOutline = true;
        super.updateRendering(ofObject, preset, visualProperties, defaultVisualProperties);
    }

    /**
     * @param {fabric.Line} ofObject object that is being copied
     * @param {{}} parameters array of 4 values, two point vertices x1 y1 x2 y1 //todo use array of objects instead?
     */
    copy(ofObject, parameters) {
        parameters = parameters || [ofObject.x1, ofObject.y1, ofObject.x2, ofObject.y2];
        return new fabric.Line(parameters, this.copyProperties(ofObject));
    }

    edit(theObject) {
        this._origPoints = [theObject.x1, theObject.y1, theObject.x2, theObject.y2];
        this._context.canvas.setActiveObject(theObject);

        const _this = this,
            rightSkew = theObject.x1 > theObject.x2;
        theObject.cornerStyle = 'circle';
        theObject.cornerColor = '#fbb802';
        theObject.hasControls = true;
        theObject.objectCaching = false;
        theObject.transparentCorners = false;

        theObject._origX = theObject.left

        theObject._origY = theObject.top
        theObject.controls = {
            p0: new fabric.Control({
                x:rightSkew ? 0.5 : -0.5,
                y: -0.5,
                actionHandler:_this._actionHandler,
                actionName: 'modifyLine',
                pointIndex: 0,
                rightDiagonal: rightSkew,
            }),
            p1: new fabric.Control({
                x:rightSkew ? -0.5 : 0.5,
                y:0.5,
                actionHandler:  _this._actionHandler,
                actionName: 'modifyLine',
                pointIndex: 1,
                rightDiagonal: rightSkew,
            })
        };
        this._context.canvas.renderAll();
    }

    _actionHandler(eventData, transform,x, y) {

        const line =  transform.target,
            coords = line.oCoords;
        // ,

        const controls = [line.oCoords.p0, line.oCoords.p1].map(c => fabric.util.transformPoint(c, line.calcTransformMatrix())
        );
        //const controls = Object.values(line.aCoords);
        let
            left = controls.reduce((a, b) => a < b.x ? a : b.x, Infinity),
            top = controls.reduce((a, b) => a < b.y ? a : b.y, Infinity),
            width = controls.reduce((a, b) => a > b.x ? a : b.x, -Infinity) - left,
            height = controls.reduce((a, b) => a > b.y ? a : b.y, -Infinity) - top;


        // x = absolutePoint.x;
        // y = absolutePoint.y;
        // if (transform.target._origX > x) transform.target.set({ left: x });
        // if (transform.target._origY > y) transform.target.set({ top: y });
        //
        //  width = Math.abs(x - transform.target._origX);
        //  height = Math.abs(y - transform.target._origY);
        transform.target.set({ width: width, height: height, left: left, top: top,
            x1:left,  x2:left+width, y1:top, y2:top+height
        });
        console.log({ width: width, height: height, left: left, top: top,
            x1:left,  x2:left+width, y1:top, y2:top+height
        })
        return true;


        // var
        //     mouseLocalPosition = line.toLocalPoint(new fabric.Point(x, y), 'center', 'center'),
        //     polygonBaseSize = line._getNonTransformedDimensions(),
        //     size = line._getTransformedDimensions(0, 0);
        //
        // const pointIndex = line.controls[line.__corner].pointIndex+1;
        // line['x'+pointIndex] = mouseLocalPosition.x;
        // line['y'+pointIndex] = mouseLocalPosition.y;
        // console.log("NEW PTS",line['x'+pointIndex], line['y'+pointIndex] )
        // return true;
    }


    recalculate(theObject) {
        theObject.controls = fabric.Object.prototype.controls;
        theObject.hasControls = false;
        theObject.strokeWidth = this._presets.getCommonProperties().strokeWidth;

        if (!theObject.x1 != this._origPoints[0] || theObject.y1 != this._origPoints[1] ||
            theObject.x2 != this._origPoints[2] || theObject.y2 != this._origPoints[3]) {
            let newObject = this.copy(theObject);
            theObject.x1 = this._origPoints[0];
            theObject.y1 = this._origPoints[1];
            theObject.x2 = this._origPoints[2];
            theObject.y2 = this._origPoints[3];

            this._context.replaceAnnotation(theObject, newObject);
            this._context.canvas.renderAll();
        }
        this._origPoints = null;
    }

    instantCreate(screenPoint, isLeftClick = true) {
        let bounds = this._auto.approximateBounds(screenPoint, false);
        if (bounds) {
            let object = this.create(
                [bounds.left.x, bounds.top.y, bounds.right.x, bounds.bottom.y],
                this._presets.getAnnotationOptions(isLeftClick)
            );
            this._context.addAnnotation(object);
            return true;
        }
        return false;
    }

    initCreate(x, y, isLeftClick = true) {
        if (!this._isOngoingCreate || this._isDragging) {
            this._initialize();
        }

        let properties = {
            selectable: false,
            hasControls: false,
            evented: false,
            objectCaching: false,
            hasBorders: false,
            lockMovementX: true,
            lockMovementY: true
        };

        this._initPoint = this._createControlPoint(x, y, properties);
        this._context.addHelperAnnotation(this._initPoint);

        if (!this._current) {
            this._current = this.create([x, y, x, y],
                $.extend(properties, this._presets.getAnnotationOptions(isLeftClick))
            );
            this._context.addHelperAnnotation(this._current);
        } else {
            this._current.set({x2: x, y2: y});
            this.finishIndirect();
            return;
        }
        this._context.canvas.renderAll();
    }

    updateCreate(x, y) {
        if (!this._current || !this._isOngoingCreate) return;
        this._isDragging = true;
        this._current.set({x2: x, y2: y});
    }

    isImplicit() {
        //line is implicit since the points are not defined as generic array
        return true;
    }

    finishIndirect() {
        if (!this._current) return;

        this._context.deleteHelperAnnotation(this._initPoint);
        this._context.deleteHelperAnnotation(this._current);

        const dy = this._current.y1 - this._current.y2,
            dx = this._current.x1 - this._current.x2;

        let powRad = this._getRelativePixelDiffDistSquared(10);
        if ((dx * dx + dy * dy > powRad) || (dx * dx + dy * dy > powRad)) {
            this._current = this.create(
                [this._current.x1, this._current.y1, this._current.x2, this._current.y2],
                this._presets.getAnnotationOptions(this._current.isLeftClick)
            );
            this._context.addAnnotation(this._current);
        }
        this._initialize(false);
    }

    _getRelativePixelDiffDistSquared(relativeDiff) {
        return Math.pow(1 / VIEWER.scalebar.imagePixelSizeOnScreen() * relativeDiff, 2);
    }


    /**
     * Create array of points - approximation of the object shape
     * @param {Object} obj fabricjs.Polygon object that is being approximated
     * @param {function} converter take two elements and convert and return item
     * @param {number} digits
     * @param {number} quality between 0 and 1, of the approximation in percentage (1 = 100%)
     * @return {Array} array of items returned by the converter - points
     */
    toPointArray(obj, converter, digits=undefined, quality=1) {
        if (digits !== undefined) {
            return [
                converter(parseFloat(Number(obj.x1).toFixed(digits)), parseFloat(Number(obj.y1).toFixed(digits))),
                converter(parseFloat(Number(obj.x2).toFixed(digits)), parseFloat(Number(obj.y2).toFixed(digits))),
            ];
        }
        return [
            converter(obj.x1, obj.y1),
            converter(obj.x2, obj.y2),
        ];
    }

    title() {
        return "Line";
    }

    _initialize(isNew = true) {
        this._isOngoingCreate = isNew;
        this._initPoint = null;
        this._current = null;
        this._followPoint = null;
        this._isDragging = false;
    }

    _createControlPoint(x, y, commonProperties) {
        return new fabric.Circle($.extend(commonProperties, {
            radius: 10 / VIEWER.scalebar.imagePixelSizeOnScreen(),
            fill: '#fbb802',
            left: x,
            top: y,
            originX: 'center',
            originY: 'center',
            factory: "__private",
        }));
    }
};

OSDAnnotations.Polygon = class extends OSDAnnotations.ExplicitPointsObjectFactory {
    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "polygon", "polygon", fabric.Polygon, true);
    }

    getIcon() {
        return "pentagon";
    }

    fabricStructure() {
        return "polygon";
    }

    getDescription(ofObject) {
        return `Polygon [${Math.round(ofObject.left)}, ${Math.round(ofObject.top)}]`;
    }

    title() {
        return "Polygon";
    }
}

OSDAnnotations.Polyline = class extends OSDAnnotations.ExplicitPointsObjectFactory {
    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "polyline", "polyline", fabric.Polyline, false);
    }

    getIcon() {
        return "timeline";
    }

    fabricStructure() {
        return "polyline";
    }

    configure(object, options) {
        const instance = super.configure(object, options);
        instance.fill = "";
        instance.stroke = instance.color;
        return instance;
    }

    updateRendering(ofObject, preset, visualProperties, defaultVisualProperties) {
        visualProperties.modeOutline = true;
        super.updateRendering(ofObject, preset, visualProperties, defaultVisualProperties);
    }

    getDescription(ofObject) {
        return `Polyline [${Math.round(ofObject.left)}, ${Math.round(ofObject.top)}]`;
    }

    title() {
        return "Polyline";
    }
}

OSDAnnotations.Group = class extends OSDAnnotations.AnnotationObjectFactory {

    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "group", "group");
    }

    getIcon() {
        return "shape_line";
    }

    fabricStructure() {
        //todo the nesting needs to be estimated from the given object
        return "group";
    }

    getDescription(ofObject) {
        return `[${this._eachChildAndFactory(ofObject, (o, f) => f.title()).join(", ")}]`;
    }

    getCurrentObject() {
        return this._current;
    }

    /**
     * @param {Array} parameters array of objects
     * @param {Object} options see parent class
     */
    create(parameters, options) {
        return this.configure(new fabric.Group(parameters), options);
    }

    configure(object, options) {
        super.configure(object, options);

        //todo use factory instead
        object.forEachObject(o => {
            o.fill = options.fill;
            o.stroke = options.stroke;
            o.color = options.color;
            o.originalStrokeWidth = options.originalStrokeWidth;
        });
    }

    _eachChildAndFactory(ofObject, executor, method="map") {
        const self = this;
        return ofObject._objects[method](o => {
            const factory = self._context.getAnnotationObjectFactory(o.factoryID);
            if (!factory) {
                console.warn("Group annotation foreach routine error: ", o.factoryID, "unknown factory.");
                return undefined;
            }
            return executor(o, factory);
        });
    }

    /**
     * @param {Object} ofObject fabricjs.Polygon object that is being copied
     * @param {Array} parameters array of points: {x, y} objects
     */
    copy(ofObject, parameters) {
        const from = Array.isArray(parameters) || this._eachChildAndFactory(ofObject, (o, f) => f.copy(o));
        const props = this.copyProperties(ofObject);
        return new fabric.Group(from, props);

        // const from = Array.isArray(parameters) || this._eachChildAndFactory(ofObject, (o, f) => f.copy(o));
        // return new fabric.Group(from, {
        //     hasRotatingPoint: ofObject.hasRotatingPoint,
        //     isLeftClick: ofObject.isLeftClick,
        //     opacity: ofObject.opacity,
        //     type: ofObject.type,
        //     scaleX: ofObject.scaleX,
        //     color: ofObject.color,
        //     scaleY: ofObject.scaleY,
        //     zoomAtCreation: ofObject.zoomAtCreation,
        //     originalStrokeWidth: ofObject.originalStrokeWidth,
        //     factoryID: ofObject.factoryID,
        //     selectable: ofObject.selectable,
        //     borderColor: ofObject.borderColor,
        //     cornerColor: ofObject.cornerColor,
        //     borderScaleFactor: ofObject.borderScaleFactor,
        //     meta: ofObject.meta,
        //     hasControls: ofObject.hasControls,
        //     lockMovementX: ofObject.lockMovementX,
        //     lockMovementY: ofObject.lockMovementY,
        //     presetID: ofObject.presetID,
        //     layerID: ofObject.layerID
        // });
    }

    isEditable() {
        return false;
    }

    // edit(theObject) {
    //     //todo
    // }
    //
    // recalculate(theObject) {
    //    //todo
    //    //  let rx = theObject.rx * theObject.scaleX,
    //    //      ry = theObject.ry * theObject.scaleY,
    //    //      left = theObject.left,
    //    //      top = theObject.top;
    //    //  theObject.set({ left: this._left, top: this._top, scaleX: 1, scaleY: 1,
    //    //      hasControls: false, lockMovementX: true, lockMovementY: true});
    //    //  let newObject = this.copy(theObject, {
    //    //      left: left, top: top, rx: rx, ry: ry
    //    //  });
    //    //  theObject.calcACoords();
    //    //  this._context.replaceAnnotation(theObject, newObject);
    // }

    instantCreate(screenPoint, isLeftClick = true) {
        return false;
    }

    getCreationRequiredMouseDragDurationMS() {
        return Infinity; //never allow
    }

    initCreate(x, y, isLeftClick = true) {
        // let active = this._context.canvas.getActiveObject();
        // console.log(active)
        // active = active ? [active] : [];
        // this._current = this.create(active, {});
        return undefined;
    }

    updateCreate(x, y) {
        // if (!this._current) return;
        //
        // let active = this._context.canvas.getActiveObject();
        // console.log(active)
        //
        // if (!this._current._objects.includes(active)) {
        //     this._current.add(active);
        // }
    }

    onZoom(ofObject, graphicZoom, realZoom) {
        //todo try to use iterate method :D
        ofObject.forEachObject(o => {
            o.set({strokeWidth: ofObject.originalStrokeWidth/graphicZoom});
        });
    }

    updateRendering(ofObject, preset, visualProperties, defaultVisualProperties) {
        ofObject.forEachObject(o => {
            const factory = ofObject._factory();
            factory && factory.updateRendering(ofObject, preset, visualProperties, defaultVisualProperties);
        });
    }

    isImplicit() {
        return false;
    }

    finishIndirect() {
        // if (!this._current) return;
        // this._context.addAnnotation(this._current);
        // this._current = null;
    }

    /**
     * Create array of points - approximation of the object shape
     * @param {Object} obj fabricjs.Polygon object that is being approximated
     * @param {function} converter take two elements and convert and return item
     * @param {number} digits
     * @param {number} quality between 0 and 1, of the approximation in percentage (1 = 100%)
     * @return {Array} array of items returned by the converter - points
     */
    toPointArray(obj, converter, digits=undefined, quality=1) {
        //todo
        return undefined;
        // let result = this._eachChildAndFactory(
        //     obj,
        //     (o, f) => f.toPointArray(o, converter, quality)
        // );
        // if (result.some(r => Array.isArray(r))) return undefined;
        // return result;
    }

    title() {
        return "Complex Annotation";
    }
};

OSDAnnotations.Multipolygon = class extends OSDAnnotations.AnnotationObjectFactory {

    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "multipolygon", "path");
        this._polygonFactory = new OSDAnnotations.Polygon(context, autoCreationStrategy, presetManager);
    }

    getIcon() {
        return "view_timeline"; 
    }

    fabricStructure() {
        return "path";
    }

    getDescription(ofObject) {
        return `Multipolygon [${Math.round(ofObject.left)}, ${Math.round(ofObject.top)}]`;
    }

    title() {
        return "Multipolygon";
    }

    exportsGeometry() {
        return ["path"];
    }

    exports() {
        return ["points"];
    }

    isImplicit() {
        return false;
    }

    create(parameters, options) {
        const path = this._createPathFromPoints(parameters);
        let multipolygon = new fabric.Path(path);

        this.configure(multipolygon, options);
        multipolygon.points = parameters;
        return multipolygon;
    }

    configure(object, options) {
        super.configure(object, options);
        object.fillRule = "evenodd";
    }

    _createPathFromPoints(multiPoints) {
        if (multiPoints.length === 0) return;
        let pathString = '';

        for (let i = 0; i < multiPoints.length; i++) {
            const points = multiPoints[i];

            if (i !== 0) pathString += ' ';
            pathString += `M ${points[0].x} ${points[0].y}`;

            points.forEach(point => {
                pathString += ` L ${point.x} ${point.y}`;
            });

            pathString += ' z';
            if (i !== multiPoints.length) pathString += ' ';
        }

        return pathString;
    }

    copy(ofObject, parameters=undefined) {
        const props = this.copyProperties(ofObject);
        delete props.left;
        delete props.top;
        delete props.width;
        delete props.height;
        delete props.points;

        if (!parameters) parameters = ofObject.points;
        props.points = parameters;
        
        return new fabric.Path(this._createPathFromPoints(parameters), props);
    }

    setPoints(object, points) {
        object.points = points;
        const newPathString = this._createPathFromPoints(points);

        object._setPath(fabric.util.parsePath(newPathString));
        object.setCoords();
        return object;
    }
    
    getArea(theObject) {
        let area = this._polygonFactory.getArea({points: theObject.points[0]});

        for (let i = 1; i < theObject.points.length; i++) {
            area -= this._polygonFactory.getArea({points: theObject.points[i]});
        }
        return area;
    }
};
