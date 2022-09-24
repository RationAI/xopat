/**
 * It is more an interface rather than actual class.
 * Any annotation object should extend this class and implement
 * necessary methods for its creation.
 *
 * TODO: unify group behaviour, introduce general recursive object for objects and group
 */
OSDAnnotations.AnnotationObjectFactory = class {

    /**
     * Constructor
     * @param {OSDAnnotations} context Annotation Plugin Context
     * @param {AutoObjectCreationStrategy} autoCreationStrategy or an object of similar interface
     * @param {PresetManager} presetManager manager of presets or an object of similar interface
     * @param {string} identifier unique annotation identifier, start with '_' to avoid exporting
     *   - note that for now the export avoidance woks only for XML exports, JSON will include all
     * @param {string} objectType which shape type it maps to inside fabricJS
     */
    constructor(context, autoCreationStrategy, presetManager, identifier, objectType) {
        this._context = context;
        this._presets = presetManager;
        this._auto = autoCreationStrategy;
        this.factoryId = identifier;
        this.type = objectType;
        this._copiedProperties = [
            "left",
            "top",
            "width",
            "height",
            "fill",
            "isLeftClick",
            "opacity",
            "strokeWidth",
            "stroke",
            "scaleX",
            "scaleY",
            "color",
            "zoomAtCreation",
            "originalStrokeWidth",
            "type",
            "factoryId",
            "scaleX,",
            "scaleY,",
            "hasRotatingPoint",
            "borderColor",
            "cornerColor",
            "borderScaleFactor",
            "hasControls",
            "lockMovementX",
            "lockMovementY",
            "meta",
            "presetID",
            "layerId",
        ];
    }

    /**
     * Human-readable annotation title
     * @returns {string}
     */
    title() {
        return "Generic Object";
    }

    /**
     * What internal structure is kept by this annotation
     * @returns {string|[string]|[[string]]} (possibly nested) list of types
     */
    fabricStructure() {
        return "object";
    }

    /**
     * Get icon for the object
     * @returns {string} pluggable to current icon system (see https://fonts.google.com/icons?selected=Material+Icons)
     */
    getIcon() {
        return "yard";
    }

    /**
     * Some annotation objects might not allow to be edited (e.g. images), specify here
     * @return {boolean}
     */
    isEditable() {
        return true;
    }

    /**
     * Get icon for the object
     * @param {fabric.Object} ofObject object to describe
     * @returns {string} pluggable to current icon system (see https://fonts.google.com/icons?selected=Material+Icons)
     */
    getDescription(ofObject) {
        return "Generic object.";
    }

    /**
     * Get currently eddited object
     * @returns
     */
    getCurrentObject() {
        return null;
    }

    /**
     * Create an annotation object from given parameters, used mostly privately
     * @param {*} parameters geometry, depends on the object type
     * @param {object} options FbaricJS and custom options to set
     * @returns
     */
    create(parameters, options) {
        return null;
    }

    /**
     * Create copy of an object
     * @param {fabric.Object} ofObject object to copy
     * @param {*} parameters internal variable, should not be used
     * @returns
     */
    copy(ofObject, parameters=undefined) {
        return null;
    }

    copyProperties(ofObject, ...withAdditional) {
        const copy = {...ofObject};
        delete copy.incrementId;
        return copy;

        // const result = {};
        // for (let prop of this._copiedProperties) {
        //     result[prop] = ofObject[prop];
        // }
        // for (let prop of withAdditional) {
        //     result[prop] = ofObject[prop];
        // }
        // return result;
    }


    /**
     * Create an object at given point with a given strategy
     * @param {OpenSeadragon.Point} screenPoint mouse coordinates (X|Y) in SCREEN coordinates
     *  that this is an exception, other methods work with image coord system
     * @param {boolean} isLeftClick true if the object was created using left mouse button
     * @return {boolean} true if creation succeeded
     */
    instantCreate(screenPoint, isLeftClick) {
        return false;
    }

    /**
     * Objects created by smaller than x MS click-drag might be invalid, define how long drag event must last
     * @returns {number} time in MS how long (at least) the drag event should last for object to be created
     */
    getCreationRequiredMouseDragDurationMS() {
        return 100;
    }

    /**
     * Get bounding box of an object - used to focus the screen on.
     */
    getObjectFocusZone(ofObject) {
       return ofObject.getBoundingRect(true, true);
    }

    /**
     * Initialize the object manual creation
     * @param {Number} x x-coordinate of the action origin, in image space
     * @param {Number} y y-coordinate of the action origin, in image space
     * @param {boolean} isLeftClick true if the object was created using left mouse button
     */
    initCreate(x, y, isLeftClick = true) {
    }

    /**
     * Update the object during manual creation
     * @param {Number} x x-coordinate of the action origin, in image space
     * @param {Number} y y-coordinate of the action origin, in image space
     */
    updateCreate(x, y) {
    }


    /**
     * Update the object coordinates by user interaction
     * @param {fabric.Object} theObject recalculate the object that has been modified
     */
    edit(theObject) {
    }

    /**
     * Update the object coordinates by finishing edit() call (this is guaranteed to happen at least once before)
     * @param {fabric.Object} theObject recalculate the object that has been modified
     */
    recalculate(theObject) {
    }

    /**
     * Finish object creation, if in progress. Can be called also if no object
     * is being created. This action was performed directly by the user.
     */
    finishDirect() {
    }

    /**
     * Finish object creation, if in progress. Can be called also if no object
     * is being created. This action was enforced by the environment (i.e.
     * performed by the user indirectly).
     */
    finishIndirect() {
    }

    /**
     * Called when object is selected
     * @param {fabric.Object} theObject selected fabricjs object
     */
    selected(theObject) {
    }

    /**
     * If the object is defined implicitly (e.g. control points + formula)
     * if returns false, a 'points' property of the object should exist where its shape is stored
     * @returns {boolean} true if the shape is not an explicit point array
     */
    isImplicit() {
        return true;
    }

    /**
     * Update object rendering based on rendering mode
     * @param {boolean} isTransparentFill
     * @param {object} ofObject
     * @param {string} color
     * @param defaultStroke
     */
    updateRendering(isTransparentFill, ofObject, color, defaultStroke) {
        if (typeof ofObject.color === 'string') {
            if (isTransparentFill) {
                ofObject.set({
                    fill: "",
                    stroke: color
                });
            } else {
                ofObject.set({
                    fill: color,
                    stroke: defaultStroke
                });
            }
        }
    }

    /**
     * Create array of points - approximation of the object shape
     * @param {fabric.Object} obj object that is being approximated
     * @param {function} converter take two elements and convert and return item, see
     *  withObjectPoint, withArrayPoint
     * @param {Number} quality between 0 and 1, of the approximation in percentage (1 = 100%)
     * @return {Array} array of items returned by the converter - points
     */
    toPointArray(obj, converter, quality=1) {
    }

    /**
     * Which properties should be kept on objects apart from default ones
     * @return {[string]} a list of properties to keep on native exports,
     *   geometry-related properties are usually exported automatically
     */
    exportsProperties() {
        return [];
    }

    /**
     * Strategy convertor, passed to toPointArray method, creates points as objects
     */
    static withObjectPoint(x, y) {
        return {x: x, y: y};
    }
    /**
     * Strategy convertor, passed to toPointArray method, creates points as 2d arrays
     */
    static withArrayPoint(x, y) {
        return [x, y];
    }
};

OSDAnnotations.Ruler = class extends OSDAnnotations.AnnotationObjectFactory {
    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "ruler", "group");
        this._current = null;
    }

    getIcon() {
        return "square_foot";
    }

    getDescription(ofObject) {
        return `Length ${Math.round(ofObject.measure)} mm`;
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

        obj = this._createWrap(obj, this._presets.getCommonProperties());
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
    }

    _createParts(parameters, options) {
        options.stroke = options.color;
        return [new fabric.Line(parameters, $.extend({
            scaleX: 1,
            scaleY: 1,
            selectable: false,
            hasControls: false,
        }, options)), new fabric.Text('', {
            fontSize: 16,
            selectable: false,
            hasControls: false,
            lockUniScaling: true,
            stroke: 'white',
            fill: 'black',
            paintFirst: 'stroke',
            strokeWidth: 2,
            scaleX: 1/options.zoomAtCreation,
            scaleY: 1/options.zoomAtCreation
        })];
    }

    _createWrap(parts, options) {
        this._updateText(parts[0], parts[1]);
        return new fabric.Group(parts, $.extend({
            factoryId: this.factoryId,
            type: this.type,
            measure: 0,
        }, options));
    }
};

/**
 * Polygon Utilities that can help with points array simplification and more
 * todo move here more utils
 */
OSDAnnotations.PolygonUtilities = {

    simplify: function (points, highestQuality = false) {
        // both algorithms combined for performance, simplifies the object based on zoom level
        if (points.length <= 2) return points;

        let tolerance = 7 / VIEWER.tools.imagePixelSizeOnScreen();
        points = highestQuality ? points : this._simplifyRadialDist(points, Math.pow(tolerance, 2));
        points = this._simplifyDouglasPeucker(points, tolerance);

        return points;
    },

    simplifyQuality: function (points, quality) {
        if (points.length <= 2) return points;

        //todo decide empirically on the constant value (quality = 0 means how big relative distance?)
        let tolerance = Math.pow((10 - 9*quality) / VIEWER.tools.imagePixelSizeOnScreen(), 2);
        return this._simplifyDouglasPeucker(this._simplifyRadialDist(points, tolerance), tolerance);
    },

    approximatePolygonArea: function (points) {
        if (points.length < 3) return { diffX: 0, diffY: 0 };
        let maxX = points[0].x, minX = points[0].x, maxY = points[0].y, minY = points[0].y;
        for (let i = 1; i < points.length; i++) {
            maxX = Math.max(maxX, points[i].x);
            maxY = Math.max(maxY, points[i].y);
            minX = Math.min(minX, points[i].x);
            minY = Math.min(minY, points[i].y);
        }
        return { diffX: maxX - minX, diffY: maxY - minY };
    },

    /**
     * THE FOLLOWING PRIVATE CODE: POLY SIMPLIFICATION CODE HAS BEEN COPIED OUT FROM A LIBRARY
     * (c) 2017, Vladimir Agafonkin
     * Simplify.js, a high-performance JS polyline simplification library
     * mourner.github.io/simplify-js
     */
    _getSqDist: function (p1, p2) {
        let dx = p1.x - p2.x,
            dy = p1.y - p2.y;
        return dx * dx + dy * dy;
    },

    _getSqSegDist: function (p, p1, p2) {
        let x = p1.x,
            y = p1.y,
            dx = p2.x - x,
            dy = p2.y - y;
        if (dx !== 0 || dy !== 0) {
            let t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
            if (t > 1) {
                x = p2.x;
                y = p2.y;
            } else if (t > 0) {
                x += dx * t;
                y += dy * t;
            }
        }
        dx = p.x - x;
        dy = p.y - y;
        return dx * dx + dy * dy;
    },

    _simplifyRadialDist: function (points, sqTolerance) {

        let prevPoint = points[0],
            newPoints = [prevPoint],
            point;

        for (let i = 1, len = points.length; i < len; i++) {
            point = points[i];

            if (this._getSqDist(point, prevPoint) > sqTolerance) {
                newPoints.push(point);
                prevPoint = point;
            }
        }
        if (prevPoint !== point) newPoints.push(point);
        return newPoints;
    },

    _simplifyDPStep: function (points, first, last, sqTolerance, simplified) {
        let maxSqDist = sqTolerance,
            index;

        for (let i = first + 1; i < last; i++) {
            let sqDist = this._getSqSegDist(points[i], points[first], points[last]);

            if (sqDist > maxSqDist) {
                index = i;
                maxSqDist = sqDist;
            }
        }

        if (maxSqDist > sqTolerance) {
            if (index - first > 1) this._simplifyDPStep(points, first, index, sqTolerance, simplified);
            simplified.push(points[index]);
            if (last - index > 1) this._simplifyDPStep(points, index, last, sqTolerance, simplified);
        }
    },

    _simplifyDouglasPeucker: function (points, sqTolerance) {
        let last = points.length - 1;

        let simplified = [points[0]];
        this._simplifyDPStep(points, 0, last, sqTolerance, simplified);
        simplified.push(points[last]);

        return simplified;
    }
};

OSDAnnotations.AutoObjectCreationStrategy = class {
    constructor(selfName, context) {
        this._globalSelf = `${context.id}['${selfName}']`;
        this.compatibleShaders = ["heatmap", "bipolar-heatmap", "edge", "identity"];
    }

    approximateBounds(point, growY=true) {
        //todo default object?
        return null;
    }

    /*async*/ createOutline(eventPosition) {
        //todo default object?
        return null;
    }
};

/**
 * Class that contains all logic for automatic annotation creation.
 * Imported only if WebGL Module is present from the very beginning
 */
OSDAnnotations.RenderAutoObjectCreationStrategy = class extends OSDAnnotations.AutoObjectCreationStrategy {

    constructor(selfName, context) {
        super(selfName, context);

        this._currentTile = null;
        const _this = this;
        this._renderEngine = new WebGLModule({
            uniqueId: "annot",
            onError: function(error) {
                //potentially able to cope with it
                VIEWER.raiseEvent('warn-system', {
                    originType: "module",
                    originId: "annotations",
                    code: "E_AUTO_OUTLINE_ENGINE_ERROR",
                    message: "Error in the webgl module.",
                    trace: error
                });
            },
            onFatalError: function (error) {
                console.error("Error with automatic detection: this feature wil be disabled.");
                VIEWER.raiseEvent('error-user', {
                    originType: "module",
                    originId: "annotations",
                    code: "E_AUTO_OUTLINE_ENGINE_ERROR",
                    message: "Error with automatic detection: this feature wil be disabled.",
                    trace: error
                });
                _this._running = false;
            }
        });
        this._running = true;
        this._renderEngine.addVisualisation({
            shaders: {
                _ : {
                    type: "heatmap",
                    dataReferences: [0],
                    params: {}
                }
            }
        });
        this._renderEngine.prepareAndInit(VIEWER.bridge.dataImageSources());
        this._currentTile = "";
        this._readingIndex = 0;
        this._readingKey = "";
    }

    get running() {
        return this._running;
    }

    getLayerIndex() {
        return this._readingIndex;
    }

    setLayer(index, key) {
        this._readingIndex = index;
        this._readingKey = key;
    }

    _beforeAutoMethod() {
        let vis = VIEWER.bridge.visualization();
        this._renderEngine._visualisations[0] = {
            shaders: {}
        };
        let toAppend = this._renderEngine._visualisations[0].shaders;

        for (let key in vis.shaders) {
            if (vis.shaders.hasOwnProperty(key)) {
                let otherLayer = vis.shaders[key];
                let type;
                if (key === this._readingKey) {
                    //todo clipping mask and custom rendering will maybe not work here

                    if (!otherLayer.visible || otherLayer.visible === "false" || otherLayer.visible === "0") {

                        VIEWER.raiseEvent('warn-user', {
                            originType: "module",
                            originId: "annotations",
                            code: "E_AUTO_OUTLINE_INVISIBLE_LAYER",
                            message: "The <a class='pointer' onclick=\"USER_INTERFACE.highlight('sensitivity-auto-outline')\">chosen layer</a> is not visible: auto outline method will not work.",
                        });
                        return false;
                    }

                    if (otherLayer.type === "bipolar-heatmap") {
                        this.comparator = function(pixel) {
                            return Math.abs(pixel[0] - this.origPixel[0]) < 10 &&
                                Math.abs(pixel[1] - this.origPixel[1]) < 10 &&
                                Math.abs(pixel[2] - this.origPixel[2]) < 10 &&
                                pixel[3] > 0;
                        };
                        type = otherLayer.type;
                    } else {
                        this.comparator = function(pixel) {
                            return pixel[3] > 0;
                        };
                        type = "heatmap";
                    }
                } else {
                    type = 'none';
                }

                toAppend[key] = {
                    type: type,
                    visible: otherLayer.visible,
                    cache: otherLayer.cache,
                    dataReferences: otherLayer.dataReferences,
                    params: otherLayer.params,
                    index: otherLayer.index
                }
            }
        }
        this._renderEngine.rebuildVisualisation(Object.keys(vis.shaders));

        this._currentPixelSize = VIEWER.tools.imagePixelSizeOnScreen();

        let tiles = VIEWER.bridge.getTiledImage().lastDrawn;
        for (let i = 0; i < tiles.length; i++) {
            let tile = tiles[i];
            if (!tile.hasOwnProperty("annotationCanvas")) {
                tile.annotationCanvas = document.createElement("canvas");
                tile.annotationCanvasCtx = tile.annotationCanvas.getContext("2d");
            }
            this._renderEngine.setDimensions(tile.sourceBounds.width, tile.sourceBounds.height);
            let canvas = this._renderEngine.processImage(
                tile.getImage(), tile.sourceBounds, 0, this._currentPixelSize
            );
            tile.annotationCanvas.width = tile.sourceBounds.width;
            tile.annotationCanvas.height = tile.sourceBounds.height;
            tile.annotationCanvasCtx.drawImage(canvas, 0, 0, tile.sourceBounds.width, tile.sourceBounds.height);
        }
        return true;
    }

    _afterAutoMethod() {
        delete this._renderEngine._visualisations[0];
    }

    approximateBounds(point, growY=true) {
		if (!this._beforeAutoMethod() || !this.changeTile(point) || !this._running) {
            this._afterAutoMethod();
            return null;
        }

        this.origPixel = this.getPixelData(point);
        let dimensionSize = Math.max(screen.width, screen.height);

		let p = {x: point.x, y: point.y};
		if (!this.comparator(this.origPixel)) {
			//default object of width 40
			return { top: this.toGlobalPointXY(p.x, p.y - 20), left: this.toGlobalPointXY(p.x - 20, p.y),
                bottom: this.toGlobalPointXY(p.x, p.y + 20), right: this.toGlobalPointXY(p.x + 20, p.y) }
		}

        let counter = 0;
		const _this = this;
        function progress(variable, stepSize) {
            while (_this.getAreaStamp(p.x, p.y) === 15 && counter < dimensionSize) {
                p[variable] += stepSize;
                counter++;
            }
            let ok = counter < dimensionSize;
            counter = 0;
            return ok;
        }

		if (!progress("x", 2)) return null;
		let right = this.toGlobalPointXY(p.x, p.y);
		p.x = point.x;

        if (!progress("x", -2)) return null;
        let left = this.toGlobalPointXY(p.x, p.y);
		p.x = point.x;

		let top, bottom;
		if (growY) {
            if (!progress("y", 2)) return null;
            bottom = this.toGlobalPointXY(p.x, p.y);
            p.y = point.y;

            if (!progress("y", -2)) return null;
            top = this.toGlobalPointXY(p.x, p.y);
        } else {
            bottom = top = this.toGlobalPointXY(p.x, p.y);
        }

		//if too small, discard
		if (Math.abs(right-left) < 15 && Math.abs(bottom - top) < 15) return null;
        return { top: top, left: left, bottom: bottom, right: right };
    }

    /*async*/ createOutline(eventPosition) {
        if (!this._beforeAutoMethod() || !this.changeTile(eventPosition) || !this._running) {
            this._afterAutoMethod();
            return null;
        }

        this.origPixel = this.getPixelData(eventPosition);
        let dimensionSize = Math.max(screen.width, screen.height);

        let points = [];

        let x = eventPosition.x;  // current x position
        let y = eventPosition.y;  // current y position

        if (!this.comparator(this.origPixel)) {
            console.warn("Outline algorithm exited: outside region.");
            this._afterAutoMethod();
            return null;
        }

        let counter = 0;
        while (this.getAreaStamp(x, y) === 15 && counter < dimensionSize) {
            x += 2; //all neightbours inside, skip by two
            counter++;
            //$("#osd").append(`<span style="position:absolute; top:${y}px; left:${x}px; width:5px;height:5px; background:blue;" class="to-delete"></span>`);
        }
        if (counter >= dimensionSize) {
            this._afterAutoMethod();
            return null;
        }
        //$("#osd").append(`<span style="position:absolute; top:${y}px; left:${x}px; width:5px;height:5px; background:blue;" class="to-delete"></span>`);

        const first_point = new OpenSeadragon.Point(x, y);
        let time = Date.now();
        let direction = 1;

        let turns = [
            [0, -1, 0],
            [1, 0, 1],
            [0, 1, 2],
            [-1, 0, 3]
        ];
        // 0 -> up, 1 -> right, 2 -> down, 3-> left
        let rightDirMapping = [1, 2, 3, 0];
        let leftDirMapping = [3, 0, 1, 2];

        let inside = this.isValidPixel(first_point);

        RUN: for (let i = 3; i >= 0; i--) {
            let dir = turns[i];
            let xx = first_point.x;
            let yy = first_point.y;
            for (let j = 1; j < 6; j++) {
                direction = dir[2];
                first_point.x += dir[0];
                first_point.y += dir[1];

                if (this.isValidPixel(first_point) !== inside) {
                    break RUN;
                }
            }
            first_point.x = xx;
            first_point.y = yy;
        }

        let oldDirection = direction;
        counter = 0;
        while (Math.abs(first_point.x - x) > 6 || Math.abs(first_point.y - y) > 6 || counter < 40) {
            if (this.isValidPixel(first_point)) {
                let left = turns[leftDirMapping[direction]];
                first_point.x += left[0]*2;
                first_point.y += left[1]*2;
                oldDirection = direction;
                direction = left[2];

            } else {
                let right = turns[rightDirMapping[direction]];
                first_point.x += right[0]*2;
                first_point.y += right[1]*2;
                oldDirection = direction;
                direction = right[2];
            }

            if (oldDirection !== direction && counter % 4 === 0) {
                points.push(this.toGlobalPoint(first_point));
            }

            //$("#osd").append(`<span style="position:absolute; top:${first_point.y}px; left:${first_point.x}px; width:5px;height:5px; background:blue;" class="to-delete"></span>`);
            //if (counter % 200 === 0) await OSDAnnotations.sleep(2);

            if (counter % 100 === 0 && Date.now() - time > 1500) {
                console.warn("Outline algorithm exited: iteration steps exceeded.");
                this._afterAutoMethod();
                return;
            }
            counter++;
        }
        this._afterAutoMethod();

        let area = OSDAnnotations.PolygonUtilities.approximatePolygonArea(points);
        if (area.diffX < 5*this._currentPixelSize && area.diffY < 5*this._currentPixelSize) return null;
        return points;
    }

    toGlobalPointXY (x, y) {
		return VIEWER.tools.referencedTiledImage().windowToImageCoordinates(new OpenSeadragon.Point(x, y));
	}

	toGlobalPoint (point) {
		return VIEWER.tools.referencedTiledImage().windowToImageCoordinates(point);
	}

	isValidPixel(eventPosition) {
		return this.comparator(this.getPixelData(eventPosition));
	}

	comparator(pixel) {
        return pixel[0] == this.origPixel[0] &&
            pixel[1] == this.origPixel[1] &&
            pixel[2] == this.origPixel[2] &&
            pixel[3] > 0;
    }

    /**
     * Find tile that contains the event point
     * @param {OpenSeadragon.Point} eventPosition point
     */
    changeTile(eventPosition) {
        let viewportPos = VIEWER.viewport.pointFromPixel(eventPosition);
        let tiles = VIEWER.bridge.getTiledImage().lastDrawn;
        for (let i = 0; i < tiles.length; i++) {
            if (tiles[i].bounds.containsPoint(viewportPos)) {
                this._currentTile = tiles[i];
                return true;
            }
        }
        return false;
    }

	getPixelData(eventPosition) {
		//change only if outside
		if (!this._currentTile.bounds.containsPoint(eventPosition)) {
			this.changeTile(eventPosition);
		}

		// get position on a current tile
		let x = eventPosition.x - this._currentTile.position.x;
		let y = eventPosition.y - this._currentTile.position.y;

		// get position on DZI tile (usually 257*257)
        let canvasCtx = this._currentTile.getCanvasContext();
		let relative_x = Math.round((x / this._currentTile.size.x) * canvasCtx.canvas.width);
		let relative_y = Math.round((y / this._currentTile.size.y) * canvasCtx.canvas.height);

        // let pixel = new Uint8Array(4);
        // let gl = this._renderEngine.gl;
        // gl.readPixels(relative_x, relative_y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        // return pixel;
        return this._currentTile.annotationCanvasCtx.getImageData(relative_x, relative_y, 1, 1).data;
    }

	// CHECKS 4 neightbouring pixels and returns which ones are inside the specified region
	//  |_|_|_|   --> topRight: first (biggest), bottomRight: second, bottomLeft: third, topLeft: fourth bit
	//  |x|x|x|   --> returns  0011 -> 0*8 + 1*4 + 1*2 + 0*1 = 6, bottom right & left pixel inside
	//  |x|x|x|
	getAreaStamp(x, y) {
		let result = 0;
		if (this.isValidPixel(new OpenSeadragon.Point(x + 1, y - 1))) {
			result += 8;
		}
		if (this.isValidPixel(new OpenSeadragon.Point(x + 1, y + 1))) {
			result += 4;
		}
		if (this.isValidPixel(new OpenSeadragon.Point(x - 1, y + 1))) {
			result += 2;
		}
		if (this.isValidPixel(new OpenSeadragon.Point(x - 1, y - 1))) {
			result += 1;
		}
		return result;
	}
};
