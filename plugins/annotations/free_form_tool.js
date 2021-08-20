//tool for object modification: draw on canvas to add (add=true) or remove (add=false) parts of fabric.js object
//any object is first converted to polygon
FreeFormTool = function (context) {
    this.polygon = null;
    this.radius = 50;
    this.mousePos = null;
    this.SQRT2DIV2 = 0.707106781187;
    this._context = context;
}

FreeFormTool.prototype = {
    //initialize any object for cursor-drawing modification
    init: function (object, atPosition, radius, add = true) {
        switch (object.type) {
            case 'rect':
                let w = object.width, h = object.height;
                this._createPolygonAndSetupFrom([{ x: object.left, y: object.top },
                { x: object.left + w, y: object.top },
                { x: object.left + w, y: object.top + h },
                { x: object.left, y: object.top + h }
                ], object);
                break;
            case 'ellipse':
                //see https://math.stackexchange.com/questions/2093569/points-on-an-ellipse
                //formula author https://math.stackexchange.com/users/299599/ng-chung-tak
                let pow2e = 1 - (object.ry * object.ry) / (object.rx * object.rx),
                    pow3e = pow2e * Math.sqrt(pow2e),
                    pow4e = pow2e * pow2e,
                    pow6e = pow3e * pow3e;

                let step = Math.PI / 16, points = [];

                for (let t = 0; t < 2 * Math.PI; t += step) {
                    let param = t - (pow2e / 8 + pow4e / 16 + 71 * pow6e / 2048) * Math.sin(2 * t)
                        + ((5 * pow4e + 5 * pow6e) / 256) * Math.sin(4 * t)
                        + (29 * pow6e / 6144) * Math.sin(6 * t);
                    points.push({ x: object.rx * Math.cos(param) + object.left + object.rx, y: object.ry * Math.sin(param) + object.top + object.ry });
                }
                this._createPolygonAndSetupFrom(points, object);
                break;
            case 'polygon':
                this._setupPolygon(object);
                break;
            default:
                this.polygon = null;
                this._context.messenger.show("Modification with <i>shift</i> allowed only with annotation objects.", 5000, this._context.messenger.MSG_WARN);
                return;
        }

        if (add) this.update = this.union;
        else this.update = this.subtract;

        this.setRadius(radius);

        this.mousePos = atPosition;
    },

    setRadius: function (radius) {
        var zoom = this._context.overlay.fabricCanvas().getZoom();
        if (zoom < 0.01) { this.radius = 50 * radius; }
        else if (zoom < 0.03) { this.radius = 25 * radius; }
        else if (zoom < 0.1) { this.radius = 5 * radius; }
        else if (zoom < 0.3) { this.radius = 2 * radius; }
        else { this.radius = radius; };
    },

    //update step meant to be executed on mouse move event
    update: null,

    //final step
    finish: function () {
        if (this.polygon) {
            this.polygon.lockMovementX = false;
            this.polygon.lockMovementY = false;

            if (this.polygon.incrementId != this.initial.incrementId) {
                //incrementID is used by history - if ID equal, no changes were made -> no record
                this._context.history.push(this.polygon, this.initial);
            }
            let outcome = this.polygon;
            this.polygon = null;
            this.initial = null;
            this.mousePos = null;
            return outcome;
        }
        return null;
    },

    //TODO sometimes the greinerHormann takes too long to finish (it is cycling, verticaes are NaN values), do some measurement and kill after it takes too long (2+s ?)
    union: function (nextMousePos) {
        if (!this.polygon || this._context.toDistanceObj(this.mousePos, nextMousePos) < this.radius / 3) return;

        let radPoints = this.getCircleShape(nextMousePos);
        var polypoints = this.polygon.get("points");
        //avoid 'Leaflet issue' - expecting a polygon that is not 'closed' on points (first != last)
        if (this._context.toDistanceObj(polypoints[0], polypoints[polypoints.length - 1]) < this.radius) polypoints.pop();
        this.mousePos = nextMousePos;

        //compute union
        var union = greinerHormann.union(polypoints, radPoints);

        if (union) {
            this._context.overlay.fabricCanvas().remove(this.polygon);

            if (typeof union[0][0] === 'number') { // single linear ring
                var polygon = this._context.polygon.copy(this.polygon, this._simplifyPolygon(union, this.radius / 5));
                this._context.overlay.fabricCanvas().add(polygon);
                this.polygon = polygon;
            } else {
                if (union.length > 1) union = this._unify(union);

                var polygon = this._context.polygon.copy(this.polygon, this._simplifyPolygon(union[0], this.radius / 5));
                this._context.overlay.fabricCanvas().add(polygon);
                this.polygon = polygon;
            }
            this.polygon.objectCaching = false;
            this.polygon.lockMovementX = false;
            this.polygon.lockMovementY = false;
            this._context.overlay.fabricCanvas().renderAll();

        } else {
            console.log("NO UNION FOUND");
        }
    },

    subtract: function (nextMousePos) {
        if (!this.polygon || this._context.toDistanceObj(this.mousePos, nextMousePos) < this.radius / 3) return;

        let radPoints = this.getCircleShape(nextMousePos);
        var polypoints = this.polygon.get("points");
        this.mousePos = nextMousePos;

        var difference = greinerHormann.diff(polypoints, radPoints);
        if (difference) {
            this._context.overlay.fabricCanvas().remove(this.polygon);
            if (typeof difference[0][0] === 'number') { // single linear ring

                var polygon = this._context.polygon.create(this._simplifyPolygon(difference, this.radius / 5), this._context.objectOptions(this.polygon.isLeftClick));
                this._context.overlay.fabricCanvas().add(polygon);
                this.polygon = polygon;
            } else {
                if (difference.length > 1) difference = this._unify(difference);

                let maxIdx = 0, maxArea = 0;
                for (let j = 0; j < difference.length; j++) {
                    let measure = this._findApproxBoundBoxSize(difference[j]);
                    if (measure.diffX < this.radius || measure.diffY < this.radius) continue;
                    let area = measure.diffX * measure.diffY;
                    if (area > maxArea) {
                        maxArea = area;
                        maxIdx = j;
                    }
                }

                if (maxArea < this.radius * this.radius / 2) {  //largest area ceased to exist: finish
                    //this.polygon.comment = this.initial.comment; //for some reason not preserved
                    this._context.history.push(null, this.initial);
                    this.polygon = null;
                    this.initial = null;
                    this.mousePos = null;
                    return;
                }

                var polygon = this._context.polygon.copy(this.polygon, this._simplifyPolygon(difference[maxIdx], this.radius / 5));
                this._context.overlay.fabricCanvas().add(polygon);
                this.polygon = polygon;
            }
            this.polygon.objectCaching = false;
            this.polygon.lockMovementX = false;
            this.polygon.lockMovementY = false;
            this._context.overlay.fabricCanvas().renderAll();
        } else {
            console.log("NO DIFFERENCE FOUND");
        }
    },

    getScreenToolRadius: function () {
        return this._context.toScreenCoords(0, 0).distanceTo(this._context.toScreenCoords(0, this.radius));
    },

    //initialize object so that it is ready to be modified
    _setupPolygon: function (polyObject) {
        this._context.currentAnnotationObject = polyObject;

        polyObject.lockMovementX = true;
        polyObject.lockMovementY = true;

        this.polygon = polyObject;
        this.initial = polyObject;
    },

    //create polygon from points and initialize so that it is ready to be modified
    _createPolygonAndSetupFrom: function (points, object) {
        //TODO //FIXME history redo of this step incorrectly places the object at canvas (shifts)
        let polygon = this._context.polygon.copy(object, points);
        polygon.type = "polygon";

        //TODO also remove from (rather replace in)  history, or maybe use straightforward 'delete' from API, will be able to convert back 'rasterization'
        this._context.overlay.fabricCanvas().remove(object);

        this._context.overlay.fabricCanvas().add(polygon);
        this._context.history.push(polygon, object);

        this._setupPolygon(polygon);
    },

    //try to merge polygon list into one polygons using 'greinerHormann.union' repeated call and simplyfiing the polygon
    _unify: function (unions) {
        let i = 0, len = unions.length ** 2 + 10, primary = [], secondary = [];

        unions.forEach(u => {
            primary.push(this._simplifyPolygon(u, this.radius / 5));
        });
        while (i < len) {
            i++;
            let j = 0;
            for (; j < primary.length - 1; j += 2) {
                let ress = greinerHormann.union(primary[j], primary[j + 1]);

                if (typeof ress[0][0] === 'number') {
                    secondary = [ress].concat(secondary); //reverse order for different union call in the next loop
                } else {
                    secondary = ress.concat(secondary); //reverse order for different union call
                }
            }
            if (j == primary.length - 1) secondary.push(primary[j]);
            primary = secondary;
            secondary = [];
        }
        return primary;
    },

    //remove on-line (horizontal/vertical only) points or points that are too close
    _simplifyPolygon: function (points, threshold) {
        if (points.length < 20) return points;
        let p1 = points[0], p2 = points[1];
        let result = [p1];

        for (var i = 2; i < points.length; i++) {
            if (this._context.toDistanceObj(p1, p2) < threshold
                || (Math.abs(p1[0] - p2[0]) < 2 && Math.abs(points[i][0] - p2[0]) < 2)
                || (Math.abs(p1[1] - p2[1]) < 2 && Math.abs(points[i][1] - p2[1]) < 2)) {
                p2 = points[i];
                continue;
            }

            p1 = p2;
            p2 = points[i];
            result.push(p1);
        }
        result.push(p2);
        return result;
    },

    //when removing parts of polygon, decide which one has smaller area and will be removed
    _findApproxBoundBoxSize: function (points) {
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

    //create approximated polygon of drawing tool
    getCircleShape: function (fromPoint) {
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
}