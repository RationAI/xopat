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
        this.maxRadius = 100;
        this.mousePos = null;
        this.SQRT3DIV2 = 0.866025403784;
        this.zoom = null;
        this._context = context;
        this._update = null;
        this._created = false;
        this._node = null;
        this._offset = {x: 2 * this.maxRadius, y: 2 * this.maxRadius};
        this._scale = {x: 0, y: 0, factor: 1};
        this._windowSize = {width: 0, height: 0};

        USER_INTERFACE.addHtml(`<div id="annotation-cursor" class="${this._context.id}-plugin-root" style="border: 2px solid black;border-radius: 50%;position: absolute;transform: translate(-50%, -50%);pointer-events: none;display:none;"></div>`,
            this._context.id);
        this._node = document.getElementById("annotation-cursor");

        this._windowCanvas = document.createElement('canvas');
        this._windowCanvas.width = this._windowSize.width + 4 * this.maxRadius;
        this._windowCanvas.height = this._windowSize.height + 4 * this.maxRadius;
        this._ctxWindow = this._windowCanvas.getContext('2d', { willReadFrequently: true });

        this._annotationCanvas = document.createElement('canvas');
        this._annotationCanvas.width = this._windowSize.width * 3;
        this._annotationCanvas.height = this._windowSize.height * 3;
        this._ctxAnnotationFull =  this._annotationCanvas.getContext('2d', { willReadFrequently: true });

        this.MagicWand = OSDAnnotations.makeMagicWand();
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
        this.ref = this._context.viewer.scalebar.getReferencedTiledImage();

        this._updateCanvasSize();
        this._initializeDefaults();

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
                const factory = objectFactory.factoryID === "polygon" ? this._context.polygonFactory : this._context.multiPolygonFactory;
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
        this._updatePerformed = false;
    }

    _updateCanvasSize() {
        if (this._isWindowSizeUpdated()) {

            this._windowCanvas.width = this._windowSize.width + 4 * this.maxRadius;
            this._windowCanvas.height = this._windowSize.height + 4 * this.maxRadius;
            this._ctxWindow = this._windowCanvas.getContext('2d', { willReadFrequently: true });

            this._annotationCanvas.width = this._windowSize.width * 3;
            this._annotationCanvas.height = this._windowSize.height * 3;
            this._ctxAnnotationFull = this._annotationCanvas.getContext('2d', { willReadFrequently: true });
            return;
        }

        this._ctxWindow.clearRect(0, 0, this._windowCanvas.width, this._windowCanvas.height);
        this._ctxAnnotationFull.clearRect(0, 0, this._annotationCanvas.width, this._annotationCanvas.height);
    }

    _initializeDefaults() {
        this._ctxWindow.fillStyle = 'white';
        this._ctxAnnotationFull.fillStyle = 'white';
        this._hasAnnotationCanvas = false;

        this._offset = { x: 2 * this.maxRadius, y: 2 * this.maxRadius };
        this._scale = { x: 0, y: 0, factor: 1 };
        this._convert = this._convertOSD;
        this._annotationBoundsScaled = [];
    }

    _isWindowSizeUpdated() {
        const { containerWidth, containerHeight } = this._context.fabric.overlay;

        if (this._windowSize.width === containerWidth && this._windowSize.height === containerHeight) {
            return false;
        }

        this._windowSize.width = this._context.fabric.overlay._containerWidth;
        this._windowSize.height = this._context.fabric.overlay._containerHeight;
        return true;
    }

    /**
     * Update cursor indicator radius
     */
    updateCursorRadius() {
        let screenRadius = this.radius * this._context.viewer.scalebar.imagePixelSizeOnScreen() * 2;
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
        return this._update === this._union;
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
    setSafeRadius(radius, max=this.maxRadius) {
        this.setRadius(Math.min(Math.max(radius, 3), max));
    }

    /**
     * Set the tool radius, in screen coordinates
     * @param {number} radius in screen pixels
     */
    setRadius (radius) {
        let imageTileSource = this._context.viewer.scalebar.getReferencedTiledImage();
        let pointA = imageTileSource.viewerElementToImageCoordinates(new OpenSeadragon.Point(0, 0));
        let pointB = imageTileSource.viewerElementToImageCoordinates(new OpenSeadragon.Point(radius*2, 0));
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
            const cursorPolygon = this.getCircleShape(point);
            const polygon = this.polygon.factoryID === "multipolygon" ? this.polygon.points[0] : this.polygon.points;

            if (!OSDAnnotations.checkPolygonIntersect(cursorPolygon, polygon).length) return;

            if (this.polygon.factoryID === "multipolygon") {
                for (let i = 1; i < this.polygon.points.length; i++) {
                    const intersections = OSDAnnotations.checkPolygonIntersect(cursorPolygon, this.polygon.points[i]);
                    if (JSON.stringify(intersections) === JSON.stringify(cursorPolygon)) return;
                }
            }

            this._updatePerformed = this._update(point) || this._updatePerformed;
            this._context.fabric.rerender();

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
    finish(_withDeletion=false) {
        this.ref = null;
        if (this.polygon) {
            delete this.initial.moveCursor;
            delete this.polygon.moveCursor;

            //fixme still small problem - updated annotaion gets replaced in the board, changing its position!
            if (_withDeletion) {
                //revert annotation replacement and delete the initial (annotation was erased by modification)
                this._context.fabric.replaceAnnotation(this.polygon, this.initial, true);
                this._context.fabric.deleteAnnotation(this.initial);
            } else if (!this._created) {
                //revert annotation replacement and when updated, really swap
                this._context.fabric.replaceAnnotation(this.polygon, this.initial, true);
                if (this._updatePerformed) {
                    this._context.fabric.replaceAnnotation(this.initial, this.polygon);
                }
            } else {
                this._context.fabric.deleteHelperAnnotation(this.polygon);
                this._context.fabric.addAnnotation(this.polygon);
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

    _drawPolygon(ctx, polygon) {
        ctx.moveTo(polygon[0].x, polygon[0].y);

        for (let i = 1; i < polygon.length; i++) {
            ctx.lineTo(polygon[i].x, polygon[i].y);
        }
        ctx.lineTo(polygon[0].x, polygon[0].y);
        ctx.closePath();
    }

    _convertOSD = (point) => {
        let newPoint = this.ref.imageToViewerElementCoordinates(new OpenSeadragon.Point(point.x, point.y));
        newPoint.x += this._offset.x;
        newPoint.y += this._offset.y;

        return newPoint;
    }

    _convertOSDBack = (point) => {
        point.x -= this._offset.x;
        point.y -= this._offset.y;

        return this.ref.viewerElementToImageCoordinates(new OpenSeadragon.Point(point.x, point.y));
    }

    _convertScaling = (point) => {
        return {
            x: (point.x - this._scale.x) * this._scale.factor + this._offset.x,
            y: (point.y - this._scale.y) * this._scale.factor + this._offset.y
        };
    }

    _convertScalingBack = (point) => {
        return {
            x: (point.x - this._offset.x) / this._scale.factor + this._scale.x,
            y: (point.y - this._offset.y) / this._scale.factor + this._scale.y
        };
    }

    _rasterizePolygons(ctx, originalPoints, isPolygon, needsConversion=true) {
        const convertPoints = points => points.map(this._convert);

        if (needsConversion) {
            originalPoints = isPolygon
                ? convertPoints(originalPoints)
                : originalPoints.map(convertPoints);
        }

        const points = originalPoints;
        const firstPolygon = isPolygon ? points : points[0];

        ctx.beginPath();
        this._drawPolygon(ctx, firstPolygon);

        if (!isPolygon) {
            for (let i = 1; i < points.length; i++) {
                this._drawPolygon(ctx, points[i]);
            }
        }

        ctx.fill("evenodd");
    }

    //initialize object so that it is ready to be modified
    _setupPolygon(polyObject, original) {
        this.polygon = polyObject;
        this.initial = original;

        if (!this._created) {
            this._context.fabric.replaceAnnotation(original, polyObject, true);
        } else {
            this._context.fabric.addHelperAnnotation(polyObject);
        }

        const isPolygon = polyObject.factoryID === "polygon";
        this._rasterizePolygons(this._ctxWindow, polyObject.points, isPolygon);

        polyObject.moveCursor = 'crosshair';
    }

    //create polygon from points and initialize so that it is ready to be modified
    _createPolygonAndSetupFrom(points, object) {
        let polygon = this._context.polygonFactory.copy(object, points);
        polygon.factoryID = this._context.polygonFactory.factoryID;
        polygon.type = this._context.polygonFactory.type;
        this._setupPolygon(polygon, object);
    }

    _changeFactory(factory, contourPoints) {
        let newObject = factory.copy(this.polygon, contourPoints);
        newObject.factoryID = factory.factoryID;
        newObject.type = factory.type;

        if (!this._created) {
            this._context.fabric.replaceAnnotation(this.polygon, this.initial, true);
            this.polygon = newObject;
            this._context.fabric.replaceAnnotation(this.initial, this.polygon, true);
        } else {
            this._context.fabric.deleteHelperAnnotation(this.polygon);
            this.polygon = newObject;
            this._context.fabric.addHelperAnnotation(this.polygon);
        }
    }

    _getValidContours(contours, ctx, shift, zoomed) {
        const polygonUtils = OSDAnnotations.PolygonUtilities;
        let innerContours = [];
        let falseOuterContours = [];
        let maxArea = 0;
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

        // deleting inner contours (holes) which are found inside deleted outer contours
        if (falseOuterContours.length !== 0) {
            innerContours = innerContours.filter(inner => {
                return falseOuterContours.some(outer => {

                    const innerBbox = polygonUtils.getBoundingBox(inner.points);
                    const outerBbox = polygonUtils.getBoundingBox(outer.points);

                    if (polygonUtils.intersectAABB(innerBbox, outerBbox)) {
                        const intersections = OSDAnnotations.checkPolygonIntersect(inner.points, outer.points);
                        return intersections.length === 0 || JSON.stringify(intersections) === JSON.stringify(outer.points);
                    }
                    return true;
                });
            });

            ctx.fillStyle = 'white';
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

            const newContours = [outerContour, ...innerContours].map(contour =>
                contour.points.map(point => ({ x: point.x + shift.x + 0.5, y: point.y + shift.y + 0.5}))
            );
            this._rasterizePolygons(ctx, newContours, false, false);

            if (zoomed) {
                this._ctxWindow.clearRect(0, 0, this._ctxWindow.canvas.width, this._ctxWindow.canvas.height);

                this._ctxWindow.drawImage(
                    this._ctxAnnotationFull.canvas,
                    this._canvasDims.left, this._canvasDims.top, this._canvasDims.width, this._canvasDims.height,
                    0, 0, this._ctxWindow.canvas.width, this._ctxWindow.canvas.height
                );
            }
        }

        return [outerContour, ...innerContours];
    }

    _isPartiallyOutside(bounds, region) {
        const isFullyInside =
            region.top >= bounds.top &&
            region.left >= bounds.left &&
            region.right <= bounds.right &&
            region.bottom <= bounds.bottom;

        return !isFullyInside;
    }

    _calculateBounds() {
        const polygonPoints = this.polygon.factoryID === "polygon" ? this.polygon.points : this.polygon.points[0];
        const bbox = OSDAnnotations.PolygonUtilities.getBoundingBox(polygonPoints);
        const annotationBounds = { left: bbox.x, top: bbox.y, right: bbox.x + bbox.width, bottom: bbox.y + bbox.height };

        const topLeft = this.ref.viewerElementToImageCoordinates(
            new OpenSeadragon.Point(-this._offset.x, -this._offset.y)
        );
        const bottomRight = this.ref.viewerElementToImageCoordinates(
            new OpenSeadragon.Point(
                this._ctxWindow.canvas.width - this._offset.x,
                this._ctxWindow.canvas.height - this._offset.y
            )
        );

        const screenBounds = { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };

        const zoomed = this._isPartiallyOutside(screenBounds, annotationBounds);
        return { screenBounds, annotationBounds, zoomed };
    }

    _prepareFullAnnotationCanvas(screenBounds, annotationBounds) {
        this._offset = { x: this._windowSize.width, y: this._windowSize.height };

        if (!this._hasAnnotationCanvas) {
            this._convert = this._convertScaling;
            this._scale.x = annotationBounds.left;
            this._scale.y = annotationBounds.top;

            const scaleWidth = this._windowSize.width / (annotationBounds.right - annotationBounds.left);
            const scaleHeight = this._windowSize.height / (annotationBounds.bottom - annotationBounds.top);

            this._scale.factor = Math.min(scaleWidth, scaleHeight);
            this._rasterizePolygons(this._ctxAnnotationFull, this.polygon.points, this.polygon.factoryID === "polygon");

            this._hasAnnotationCanvas = true;
            this._annotationBoundsScaled = [
                this._convertScaling({ x: annotationBounds.left, y: annotationBounds.top }),
                this._convertScaling({ x: annotationBounds.right, y: annotationBounds.top }),
                this._convertScaling({ x: annotationBounds.right, y: annotationBounds.bottom }),
                this._convertScaling({ x: annotationBounds.left, y: annotationBounds.bottom })
            ];
        }

        const { x: left, y: top } = this._convertScaling({ x: screenBounds.left, y: screenBounds.top });
        const { x: right, y: bottom } = this._convertScaling({ x: screenBounds.right, y: screenBounds.bottom });

        const width = right - left;
        const height = bottom - top;

        this._canvasDims = { left, top, width, height };
        this._ctxAnnotationFull.drawImage(this._ctxWindow.canvas, left, top, width, height);

        const points = [
            {x: left, y: top},
            {x: right, y: top},
            {x: right, y: bottom},
            {x: left, y: bottom},
            ...this._annotationBoundsScaled
        ];

        return OSDAnnotations.PolygonUtilities.getBoundingBox(points);
    }

    _processContours(nextMousePos, fillColor) {
        if (!this.polygon || this._toDistancePointsAsObjects(this.mousePos, nextMousePos) < this.radius / 3) return false;
        this._offset = {x: 2 * this.maxRadius, y: 2 * this.maxRadius};
        this._convert = this._convertOSD;

        this.mousePos = nextMousePos;
        this._ctxWindow.fillStyle = fillColor;
        this._rasterizePolygons(this._ctxWindow, this.getCircleShape(this.mousePos), true);

        let bbox = {x: 0, y: 0, width: this._ctxWindow.canvas.width, height: this._ctxWindow.canvas.height};
        let ctx = this._ctxWindow;

        this._convert = this._convertOSDBack;

        const { screenBounds, annotationBounds, zoomed } = this._calculateBounds();

        if (zoomed) {
            bbox = this._prepareFullAnnotationCanvas(screenBounds, annotationBounds);
            ctx = this._ctxAnnotationFull;

            this._convert = this._convertScalingBack;
        }

        let contours = this._getContours(ctx, bbox, zoomed);

        if (contours.length >= 1 && contours[0].inner) return false;

        if (contours.length === 0) return this.finish(true); // deletion in subtract mode

        if (contours.length === 1) { // polygon
            if (this.polygon.factoryID !== "multipolygon") {
                this.polygon.set({ points: contours[0].points });
            } else {
                this._changeFactory(this._context.polygonFactory, contours[0].points);
            }

            this.polygon._setPositionDimensions({});
            return true;
        }

        // multipolygon
        let contourPoints = contours.map(contour => contour.points);

        if (this.polygon.factoryID === "multipolygon") {
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

    _getContours(ctx, bbox, zoomed) {
        const imageData = ctx.getImageData(bbox.x, bbox.y, bbox.width, bbox.height);
        const mask = this._getBinaryMask(imageData.data, imageData.width, imageData.height);
        if (!mask.bounds) return [];

        let contours = this.MagicWand.traceContours(mask);
        contours = this._getValidContours(contours, ctx, {x: bbox.x, y: bbox.y}, zoomed);
        contours = this.MagicWand.simplifyContours(contours, 0, 30);

        const imageContours = contours.map(contour => ({
            ...contour,
            points: contour.points.map(point => {
                point.x += bbox.x + 0.5;
                point.y += bbox.y + 0.5;
                return this._convert(point);
            })
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
