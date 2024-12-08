OSDAnnotations.FreeFormTool = class {
    /**
     * Create manager for object modification: draw on canvas to add (add=true) or remove (add=false)
     *   parts of fabric.js object, non-vertex-lie objects implement 'toPointArray' to convert them to polygon
     *   (or can return null, in that case it is not possible to use it)
     * @param {string} selfName name of the (self) element property inside parent (not used)
     * @param {OSDAnnotations} context
     */
    constructor(selfName, context) {
        this.polygon = null;
        this.modeAdd = true;
        this.screenRadius = 20;
        this.radius = 20;
        this.mousePos = null;
        this.SQRT3DIV2 = 0.866025403784;
        this.zoom = null;
        this._context = context;
        this._update = null;
        this._created = false;
        this._node = null;

        USER_INTERFACE.addHtml(`<div id="annotation-cursor" class="${this._context.id}-plugin-root" style="border: 2px solid black;border-radius: 50%;position: absolute;transform: translate(-50%, -50%);pointer-events: none;display:none;"></div>`,
            this._context.id);
        this._node = document.getElementById("annotation-cursor");

        this._offscreenCanvas = document.createElement('canvas');
        this._offscreenCanvas.width = this._context.overlay._containerWidth;
        this._offscreenCanvas.height = this._context.overlay._containerHeight;
        this._ctx2d = this._offscreenCanvas.getContext('2d', { willReadFrequently: true });

        this.MagicWand = OSDAnnotations.makeMagicWand();
        this.ref = VIEWER.scalebar.getReferencedTiledImage();
    }

    /**
     * Initialize object for modification
     * @param {object} object fabricjs object
     * @param {boolean|Array<object>} created true if the object has been just created, e.g.
     *    the object is yet not on the canvas, the given object is appended to the canvas and modified directly,
     *    not copied (unless it is an implicit object)
     *    can be also an array of points: in this case fft will consider the created as a polygonized
     *    object data and re-use these to construct first iteration, this means you can explicitly
     *    provide also polygon version of the target object if its factory does not support supportsBrush
     */
    init(object, created=false) {
        let objectFactory = this._context.getAnnotationObjectFactory(object.factoryID);
        this._created = created;

        this._ctx2d.clearRect(0, 0, this._ctx2d.canvas.width, this._ctx2d.canvas.height);
        this._ctx2d.fillStyle = 'white';

        if (objectFactory !== undefined) {
            if (objectFactory.factoryID !== "polygon" && objectFactory.factoryID !== "multipolygon") {  //object can be used immedietaly
                let points = Array.isArray(created) ? points : (
                    objectFactory.supportsBrush() ?
                        objectFactory.toPointArray(object,
                            OSDAnnotations.AnnotationObjectFactory.withObjectPoint, 1) : undefined
                );

                if (points) {
                    this._createPolygonAndSetupFrom(points, object);
                } else {
                    Dialogs.show("This object cannot be modified.", 5000, Dialogs.MSG_WARN);
                    return;
                }
            } else {
                const factory = objectFactory.factoryID === "polygon" ? this._context.polygonFactory : this._context.objectFactories.multipolygon;
                let newPolygon = created ? object : factory.copy(object, null);
                this._setupPolygon(newPolygon, object);

            }
        } else {
            this.polygon = null;
            //todo rather throw error
            Dialogs.show("Error: invalid usage.", 5000, Dialogs.MSG_WARN);
            return;
        }
        this.mousePos = {x: -99999, y: -9999}; //first click can also update
        this.simplifier = OSDAnnotations.PolygonUtilities.simplify.bind(OSDAnnotations.PolygonUtilities);
        this._updatePerformed = false;
    }

    /**
     * Update cursor indicator radius
     */
    updateCursorRadius() {
        let screenRadius = this.radius * VIEWER.scalebar.imagePixelSizeOnScreen() * 2;
        if (this._node) {
            this._node.style.width = screenRadius + "px";
            this._node.style.height = screenRadius + "px";
        }
    }

    /**
     * Show cursor radius indicator
     */
    showCursor() {
        if (this._listener) return;
        this._node.style.display = "block";
        this.updateCursorRadius();
        this._node.style.top = "0px";
        this._node.style.left = "0px";

        const c = this._node;
        this._listener = e => {
            c.style.top = e.pageY + "px";
            c.style.left = e.pageX + "px";
        };
        window.addEventListener("mousemove", this._listener);
    }

    /**
     * Hide cursor radius indicator
     */
    hideCursor() {
        if (!this._listener) return;
        this._node.style.display = "none";
        window.removeEventListener("mousemove", this._listener);
        this._listener = null;
    }

    /**
     * Get current mode
     * @return {boolean} true if mode 'add' is active
     */
    get isModeAdd() {
        return this._update === this._subtract;
    }

    /**
     * Set the mode to add/subtract
     * @param {boolean} isModeAdd true if the mode is adding
     * @event free-form-tool-mode-add
     */
    setModeAdd(isModeAdd) {
        this.modeAdd = isModeAdd;
        if (isModeAdd) this._update = this._union;
        else this._update = this._subtract;
        this._context.raiseEvent('free-form-tool-mode-add', {isModeAdd: isModeAdd});
    }

    /**
     * Refresh radius computation.
     */
    recomputeRadius() {
        this.setSafeRadius(this.screenRadius);
    }

    /**
     * Set radius with bounds checking
     * @param {number} radius radius to set, in screen space
     * @param {number} max maximum value allowed, default 100
     */
    setSafeRadius(radius, max=100) {
        this.setRadius(Math.min(Math.max(radius, 3), max));
    }

    /**
     * Set the tool radius, in screen coordinates
     * @param {number} radius in screen pixels
     */
    setRadius (radius) {
        let imageTileSource = VIEWER.scalebar.getReferencedTiledImage();
        let pointA = imageTileSource.windowToImageCoordinates(new OpenSeadragon.Point(0, 0));
        let pointB = imageTileSource.windowToImageCoordinates(new OpenSeadragon.Point(radius*2, 0));
        //no need for euclidean distance, vector is horizontal
        this.radius = Math.round(Math.abs(pointB.x - pointA.x));
        if (this.screenRadius !== radius) this.updateCursorRadius();
        this.screenRadius = radius;
        this._context.raiseEvent('free-form-tool-radius', {radius: radius});
    }

    /**
     * Get a polygon points approximating current tool radius
     * @param {object} fromPoint center in image space
     * @param {number} fromPoint.x
     * @param {number} fromPoint.y
     * @return {{x: number, y: number}[]} points
     */
    getCircleShape(fromPoint) {
        let diagonal1 = this.radius * 0.5;
        let diagonal2 = this.radius * this.SQRT3DIV2;
        return [
            { x: fromPoint.x - this.radius, y: fromPoint.y },
            { x: fromPoint.x - diagonal2, y: fromPoint.y + diagonal1 },
            { x: fromPoint.x - diagonal1, y: fromPoint.y + diagonal2 },
            { x: fromPoint.x, y: fromPoint.y + this.radius },
            { x: fromPoint.x + diagonal1, y: fromPoint.y + diagonal2 },
            { x: fromPoint.x + diagonal2, y: fromPoint.y + diagonal1 },
            { x: fromPoint.x + this.radius, y: fromPoint.y },
            { x: fromPoint.x + diagonal2, y: fromPoint.y - diagonal1 },
            { x: fromPoint.x + diagonal1, y: fromPoint.y - diagonal2 },
            { x: fromPoint.x, y: fromPoint.y - this.radius },
            { x: fromPoint.x - diagonal1, y: fromPoint.y - diagonal2 },
            { x: fromPoint.x - diagonal2, y: fromPoint.y - diagonal1 },
        ]
    }

    /**
     * Update polygon adjustment by current mouse position, a radius
     * is measured and the circle added to / removed from the current volume
     * @param {object} point point in image space (absolute pixels)
     * @param {number} point.x
     * @param {number} point.y
     */
    update(point) {
        //todo check if contains NaN values and exit if so abort
        if (!this.polygon) {
            return;
        }

        try {
            this._updatePerformed = this._update(point) || this._updatePerformed;
            this._context.canvas.renderAll();
        } catch (e) {
            console.warn("FreeFormTool: something went wrong, ignoring...", e);
        }
    }

    /**
     * Check if free form tool is in active mode
     * @return {boolean}
     */
    isRunning() {
        return !!this.polygon;
    }

    /**
     * Finalize the object modification
     * @return {fabric.Polygon | null} polygon if successfully updated
     */
    finish (_withDeletion=false) {
        if (this.polygon) {
            delete this.initial.moveCursor;
            delete this.polygon.moveCursor;

            //fixme still small problem - updated annotaion gets replaced in the board, changing its position!
            if (_withDeletion) {
                //revert annotation replacement and delete the initial (annotation was erased by modification)
                this._context.replaceAnnotation(this.polygon, this.initial, true);
                this._context.deleteAnnotation(this.initial);
            } else if (!this._created) {
                //revert annotation replacement and when updated, really swap
                this._context.replaceAnnotation(this.polygon, this.initial, true);
                if (this._updatePerformed) {
                    this._context.replaceAnnotation(this.initial, this.polygon);
                }
            } else {
                this._context.deleteHelperAnnotation(this.polygon);
                this._context.addAnnotation(this.polygon);
            }
            this._created = false;
            let outcome = this.polygon;
            this.polygon = null;
            this.initial = null;
            this.mousePos = null;
            this._updatePerformed = false;
            return outcome;
        }
        return null;
    }

    _drawPolygon(polygon) {
        this._ctx2d.moveTo(polygon[0].x, polygon[0].y);

        for (let i = 1; i < polygon.length; i++) {
            this._ctx2d.lineTo(polygon[i].x, polygon[i].y);
        }
        this._ctx2d.lineTo(polygon[0].x, polygon[0].y);
        this._ctx2d.closePath();
    }

    _rasterizePolygons(originalPoints, isPolygon) {
        let points = [];
        let firstPolygon;

        if (isPolygon) {
            points = originalPoints.map(point => this.ref.imageToWindowCoordinates(new OpenSeadragon.Point(point.x, point.y)));
            firstPolygon = points;
        } else {
            points = originalPoints.map(subPolygonPoints => {
                return subPolygonPoints.map(point => 
                    this.ref.imageToWindowCoordinates(new OpenSeadragon.Point(point.x, point.y))
                );
            });

            firstPolygon = points[0];
        }

        this._ctx2d.beginPath();
        this._drawPolygon(firstPolygon);

        if (!isPolygon) {
            for (let i = 1; i < points.length; i++) { 
                this._drawPolygon(points[i]);
            }
        }

        this._ctx2d.fill("evenodd");
    }

    //initialize object so that it is ready to be modified
    _setupPolygon(polyObject, original) {
        this.polygon = polyObject;
        this.initial = original;

        if (!this._created) {
            this._context.replaceAnnotation(original, polyObject, true);
        } else {
            this._context.addHelperAnnotation(polyObject);
        }

        const isPolygon = polyObject.factoryID === "polygon";
        this._rasterizePolygons(polyObject.points, isPolygon);

        polyObject.moveCursor = 'crosshair';
    }

    //create polygon from points and initialize so that it is ready to be modified
    _createPolygonAndSetupFrom(points, object) {
        let polygon = this._context.polygonFactory.copy(object, points);
        polygon.factoryID = this._context.polygonFactory.factoryID;
        this._setupPolygon(polygon, object);
    }

    _changeFactory(factory, contourPoints) {
        let newObject = factory.copy(this.polygon, contourPoints);
        newObject.factoryID = factory.factoryID;

        if (!this._created) {
            this._context.replaceAnnotation(this.polygon, this.initial, true);
            this.polygon = newObject;
            this._context.replaceAnnotation(this.initial, this.polygon, true);
        } else {
            this._context.deleteHelperAnnotation(this.polygon);
            this.polygon = newObject;
            this._context.addHelperAnnotation(this.polygon);
        }
    }

    _getValidContours(contours) {
        const polygonUtils = OSDAnnotations.PolygonUtilities;
        let innerContours = [];
        let falseOuterContours = [];
        let maxArea = -1;
        let outerContour = null;

        for (let i = 0; i < contours.length; i++) {
            const size = polygonUtils.approximatePolygonArea(contours[i].points);
            const area = size.diffX * size.diffY;

            if (contours[i].inner) {
                //if (area < this.zoom ) continue; // deleting too small holes
                innerContours.push(contours[i]);

            } else if (area > maxArea) {
                if (outerContour) falseOuterContours.push(outerContour);
                maxArea = area;
                outerContour = contours[i];

            } else {
                falseOuterContours.push(contours[i]);
            }
        }

        if (!outerContour) return innerContours;

        if (falseOuterContours.length !== 0) {
            innerContours = innerContours.filter(inner => {
                return falseOuterContours.some(outer => {
                    if (polygonUtils.intersectAABB(polygonUtils.getBoundingBox(outer.points), polygonUtils.getBoundingBox(inner.points))) {
                        const intersections = OSDAnnotations.checkPolygonIntersect(inner.points, outer.points);
                        return intersections.length === 0 || JSON.stringify(intersections) === JSON.stringify(outer.points);
                    }
                    return true;
                });
            });
        } 

        return [outerContour, ...innerContours];
    }

    _processContours(nextMousePos, fillColor) {
        if (!this.polygon || this._toDistancePointsAsObjects(this.mousePos, nextMousePos) < this.radius / 3) return false;
    
        this.mousePos = nextMousePos;
        this._ctx2d.fillStyle = fillColor;
    
        let contours = this._getContours();
        contours = this._getValidContours(contours);
    
        if (contours.length >= 1 && contours[0].inner) return false;
    
        if (contours.length === 0) return this.finish(true); // deletion in subtract mode
    
        if (contours.length === 1) { // polygon
            if (this.initial.factoryID !== "multipolygon") {
                this.polygon.set({ points: contours[0].points });
                this.polygon._setPositionDimensions({});
            } else {
                this._changeFactory(this._context.polygonFactory, contours[0].points);
            }
            return true;
        }

        // multipolygon
        let contourPoints = contours.map(contour => contour.points);

        if (this.initial.factoryID === "multipolygon") {
            this.polygon = this._context.objectFactories.multipolygon.setPoints(this.polygon, contourPoints);
        } else {
            this._changeFactory(this._context.objectFactories.multipolygon, contourPoints);
        }
    
        return true;
    }

    _union (nextMousePos) {
        return this._processContours(nextMousePos, 'white');
    }

    _subtract (nextMousePos) {
        return this._processContours(nextMousePos, 'black');
    }

    _getContours() {
        this._rasterizePolygons(this.getCircleShape(this.mousePos), true);

        const imageData = this._ctx2d.getImageData(0, 0, this._ctx2d.canvas.width, this._ctx2d.canvas.height);
        const mask = this._getBinaryMask(imageData.data, imageData.width, imageData.height);
        if (!mask.bounds) return [];

        let contours = this.MagicWand.traceContours(mask);
        contours = this.MagicWand.simplifyContours(contours, 0, 30);

        const imageContours = contours.map(contour => ({
            ...contour,
            points: contour.points.map(point => 
                this.ref.windowToImageCoordinates(new OpenSeadragon.Point(point.x, point.y))
            )
        }));

        return imageContours;
    }

    _getBinaryMask(data, width, height) {
        let mask = new Uint8ClampedArray(width * height);
        let maxX = -1, minX = width, maxY = -1, minY = height, bounds;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = (y * width + x) * 4;
                const r = data[index];
    
                if (r === 255) {
                    mask[y * width + x] = 1;
    
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
            bounds = {
                minX: minX,
                minY: minY,
                maxX: maxX,
                maxY: maxY
            }
        }

        return {
            data: mask,
            width: width,
            height: height,
            bounds: bounds,
        }
    }

    _toDistancePointsAsObjects(pointA, pointB) {
        return Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
    }
};
