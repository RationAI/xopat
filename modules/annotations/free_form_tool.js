//tool for object modification: draw on canvas to add (add=true) or remove (add=false) parts of fabric.js object
//any object is first converted to polygon
OSDAnnotations.FreeFormTool = class {
    constructor(selfName, context) {
        this.polygon = null;
        this.modeAdd = true;
        this.screenRadius = 20;
        this.radius = 20;
        this.mousePos = null;
        this.SQRT2DIV2 = 0.707106781187;
        this._context = context;
        this._update = null;
        this._created = false;
        this._node = null;

        PLUGINS.addHtml("annotation-cursor",
            `<div id="annotation-cursor" class="${this._context.id}-plugin-root" style="border: 2px solid black;border-radius: 50%;position: absolute;transform: translate(-50%, -50%);pointer-events: none;display:none;"></div>`,
            this._context.id);
        this._node = document.getElementById("annotation-cursor");
    }
    //initialize any object for cursor-drawing modification
    init(object, atPosition, created=false) {

        let objectFactory = this._context.getAnnotationObjectFactory(object.factoryId);
        if (objectFactory !== undefined) {
            if (!objectFactory.isImplicit()) {
                //object can be used immedietaly
                this._setupPolygon(object, object);
            } else {
                let points = objectFactory.toPointArray(object, OSDAnnotations.AnnotationObjectFactory.withObjectPoint, 1);
                if (points) {
                    this._createPolygonAndSetupFrom(points, object);
                } else {
                    Dialogs.show("This object cannot be modified.", 5000, Dialogs.MSG_WARN);
                    return;
                }
            }
        } else {
            this.polygon = null;
            Dialogs.show("Modification with <i>shift</i> allowed only with annotation objects.", 5000, Dialogs.MSG_WARN);
            return;
        }
        this.mousePos = {x: -99999, y: -9999}; //first click can also update
        this.simplifier = this._context.polygonFactory.simplify.bind(this._context.polygonFactory);
        this._created = created;
    }

    updateCursorRadius() {
        let screenRadius = this.radius * VIEWER.tools.imagePixelSizeOnScreen() * 2;
        if (this._node) {
            this._node.style.width = screenRadius + "px";
            this._node.style.height = screenRadius + "px";
        }
    }

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

    hideCursor() {
        if (!this._listener) return;
        this._node.style.display = "none";
        window.removeEventListener("mousemove", this._listener);
        this._listener = null;
    }

    get isModeAdd() {
        return this._update === this._subtract;
    }

    setModeAdd(isModeAdd) {
        this.modeAdd = isModeAdd;
        if (isModeAdd) this._update = this._union;
        else this._update = this._subtract;
        this._context.raiseEvent('free-form-tool-mode-add', {isModeAdd: isModeAdd});
    }

    recomputeRadius() {
        this.setSafeRadius(this.screenRadius);
    }

    setSafeRadius(radius) {
        this.setRadius(Math.min(Math.max(radius, 3), 100));
    }

    setRadius (radius) {
        let imageTileSource = VIEWER.tools.referencedTileSource();
        let pointA = imageTileSource.windowToImageCoordinates(new OpenSeadragon.Point(0, 0));
        let pointB = imageTileSource.windowToImageCoordinates(new OpenSeadragon.Point(radius*2, 0));
        //no need for euclidean distance, vector is horizontal
        this.radius = Math.round(Math.abs(pointB.x - pointA.x));
        if (this.screenRadius !== radius) this.updateCursorRadius();
        this.screenRadius = radius;
        this._context.raiseEvent('free-form-tool-radius', {radius: radius});
    }

    //update step meant to be executed on mouse move event
    update(point) {
        //todo check if contains NaN values and exit if so abort
        if (!this.polygon) {
            return;
        }

        try {
            let result = this._update(point);

            //result must exist and new no. of points must be at least 10% of the previous
            if (result && this.polygon.points.length * 0.1 <= result.points.length) {
                this._context.replaceAnnotation(this.polygon, result, false);
                this.polygon = result;
            }
        } catch (e) {
            console.warn("FreeFormTool: something went wrong, ignoring...", e);
        }
    }

    //final step
    finish () {
        if (this.polygon) {
            delete this.initial.moveCursor;
            delete this.polygon.moveCursor;
            if (this.polygon.incrementId !== this.initial.incrementId) {
                //incrementID is used by history - if ID equal, no changes were made -> no record
                this._context.history.push(this.polygon, this.initial);
            } else if (this._created) {
                //new objects do not have incrementID as they should be instantiated without registering in history
                this._context.promoteHelperAnnotation(this.polygon);
            }
            this._cachedSelection = this.polygon;
            this._created = false;
            let outcome = this.polygon;
            this.polygon = null;
            this.initial = null;
            this.mousePos = null;
            return outcome;
        }
        return null;
    }

    //TODO sometimes the greinerHormann cycling, vertices are NaN values, do some measurement and kill after it takes too long (2+s ?)
    _union (nextMousePos) {
        if (!this.polygon || this.toDistancePointsAsObjects(this.mousePos, nextMousePos) < this.radius / 3) return;

        let radPoints = this.getCircleShape(nextMousePos);
        //console.log(radPoints);
        var polypoints = this.polygon.get("points");
        //avoid 'Leaflet issue' - expecting a polygon that is not 'closed' on points (first != last)
        if (this.toDistancePointsAsObjects(polypoints[0], polypoints[polypoints.length - 1]) < this.radius) polypoints.pop();
        this.mousePos = nextMousePos;

        //compute union
        try {
            var union = greinerHormann.union(polypoints, radPoints);
        } catch (e) {
            console.warn("Unable to unify polygon with tool.", this.polygon, radPoints, e);
            return null;
        }

        if (union) {
            if (typeof union[0][0] === 'number') { // single linear ring
                // var polygon = this._context.polygonFactory.copy(this.polygon, this.simplifier(union));
            } else {
                if (union.length > 1) union = this._unify(union);

                let maxIdx = 0,maxScore = 0;
                for (let j = 0; j < union.length; j++) {
                    let measure = this._findApproxBoundBoxSize(union[j]);
                    if (measure.diffX < this.radius || measure.diffY < this.radius) continue;
                    let area = measure.diffX * measure.diffY;
                    let score = 2*area + union[j].length;
                    if (score > maxScore) {
                        maxScore = score;
                        maxIdx = j;
                    }
                }

                var polygon = this._context.polygonFactory.copy(this.polygon, this.simplifier(union[maxIdx]));
                polygon.objectCaching = false;
            }
            return polygon;
        }

        console.log("NO UNION FOUND");
        return null;
    }

    _subtract (nextMousePos) {
        if (!this.polygon || this.toDistancePointsAsObjects(this.mousePos, nextMousePos) < this.radius / 3) return;

        let radPoints = this.getCircleShape(nextMousePos);
        var polypoints = this.polygon.get("points");
        this.mousePos = nextMousePos;

        let difference = greinerHormann.diff(polypoints, radPoints);
        if (difference) {
            let polygon;
            if (typeof difference[0][0] === 'number') { // single linear ring
                polygon = this._context.polygon.create(this.simplifier(difference), this._context.presets.getAnnotationOptions(this.polygon.isLeftClick));
            } else {
                if (difference.length > 1) difference = this._unify(difference);

                let maxIdx = 0, maxArea = 0, maxScore = 0;
                for (let j = 0; j < difference.length; j++) {
                    let measure = this._findApproxBoundBoxSize(difference[j]);
                    if (measure.diffX < this.radius || measure.diffY < this.radius) continue;
                    let area = measure.diffX * measure.diffY;
                    let score = 2*area + difference[j].length;
                    if (score > maxScore) {
                        maxArea = area;
                        maxScore = score;
                        maxIdx = j;
                    }
                }

                if (maxArea < this.radius * this.radius / 2) {  //largest area ceased to exist: finish
                    //this.polygon.comment = this.initial.comment; //for some reason not preserved
                    delete this.initial.moveCursor;
                    delete this.polygon.moveCursor;
                    //todo avoid touching history/overlay
                    this._context.deleteHelperAnnotation(this.polygon);
                    this._context.history.push(null, this.initial);

                    this.polygon = null;
                    this.initial = null;
                    this.mousePos = null;
                    return null;
                }

                polygon = this._context.polygonFactory.copy(this.polygon, this.simplifier(difference[maxIdx]));
                polygon.objectCaching = false;
            }
            return polygon;
        }
        return null;
    }

    //initialize object so that it is ready to be modified
    _setupPolygon(polyObject, original) {
        this.polygon = polyObject;
        this.initial = original;

        polyObject.moveCursor = 'crosshair';
    }

    //create polygon from points and initialize so that it is ready to be modified
    _createPolygonAndSetupFrom(points, object) {
        let polygon = this._context.polygonFactory.copy(object, points);
        polygon.factoryId = this._context.polygonFactory.factoryId;

        this._context.replaceAnnotation(object, polygon);
        this._setupPolygon(polygon, object);
    }

    //try to merge polygon list into one polygons using 'greinerHormann.union' repeated call and simplyfiing the polygon
    _unify(unions) {
        let i = 0, len = unions.length ** 2 + 10, primary = [], secondary = [];

        unions.forEach(u => {
            primary.push(this.simplifier(u));
        });
        while (i < len) {
            if (primary.length < 2) break;

            i++;
            let j = 0;
            for (; j < primary.length - 1; j += 2) {
                let ress = greinerHormann.union(primary[j], primary[j + 1]);

                if (typeof ress[0][0] === 'number') {
                    ress = [ress];
                }
                secondary = ress.concat(secondary); //reverse order for different union call in the next loop
            }
            if (j === primary.length - 1) secondary.push(primary[j]);
            primary = secondary;
            secondary = [];
        }
        return primary;
    }

    //when removing parts of polygon, decide which one has smaller area and will be removed
    _findApproxBoundBoxSize (points) {
        if (points.length < 3) return { diffX: 0, diffY: 0 };
        let maxX = points[0].x, minX = points[0].x, maxY = points[0].y, minY = points[0].y;
        for (let i = 1; i < points.length; i++) {
            maxX = Math.max(maxX, points[i].x);
            maxY = Math.max(maxY, points[i].y);
            minX = Math.min(minX, points[i].x);
            minY = Math.min(minY, points[i].y);
        }
        return { diffX: maxX - minX, diffY: maxY - minY };
    }

    toDistancePointsAsObjects(pointA, pointB) {
        return Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
    }

    //create approximated polygon of drawing tool
    getCircleShape(fromPoint) {
        let diagonal = this.radius * this.SQRT2DIV2;
        return [
            { x: fromPoint.x - this.radius, y: fromPoint.y },
            { x: fromPoint.x - diagonal, y: fromPoint.y + diagonal },
            { x: fromPoint.x, y: fromPoint.y + this.radius },
            { x: fromPoint.x + diagonal, y: fromPoint.y + diagonal },
            { x: fromPoint.x + this.radius, y: fromPoint.y },
            { x: fromPoint.x + diagonal, y: fromPoint.y - diagonal },
            { x: fromPoint.x, y: fromPoint.y - this.radius },
            { x: fromPoint.x - diagonal, y: fromPoint.y - diagonal }
        ]
    }
};
