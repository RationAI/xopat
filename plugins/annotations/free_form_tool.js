//tool for object modification: draw on canvas to add (add=true) or remove (add=false) parts of fabric.js object
//any object is first converted to polygon
FreeFormTool = function (context) {
    this.polygon = null;
    this.radius = 15;
    this.mousePos = null;
    this.SQRT2DIV2 = 0.707106781187;
    this._context = context;
    this._update = null;
}

FreeFormTool.prototype = {

    //initialize any object for cursor-drawing modification
    init: function (object, atPosition, add=true) {
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
                let reversed = object.rx < object.ry, //since I am using sqrt, need rx > ry
                    rx = reversed ? object.ry : object.rx,
                    ry = reversed ? object.rx : object.ry,
                    pow2e = 1 - (ry * ry) / (rx * rx),
                    pow3e = pow2e * Math.sqrt(pow2e),
                    pow4e = pow2e * pow2e,
                    pow6e = pow3e * pow3e;

                let step = Math.PI / 16, points = [];

                for (let t = 0; t < 2 * Math.PI; t += step) {
                    let param = t - (pow2e / 8 + pow4e / 16 + 71 * pow6e / 2048) * Math.sin(2 * t)
                        + ((5 * pow4e + 5 * pow6e) / 256) * Math.sin(4 * t)
                        + (29 * pow6e / 6144) * Math.sin(6 * t);
                    if (reversed) {
                        points.push({ y: rx * Math.cos(param) + object.top + rx, x: ry * Math.sin(param) + object.left + ry });
                    } else {
                        points.push({ x: rx * Math.cos(param) + object.left + rx, y: ry * Math.sin(param) + object.top + ry });
                    }
                }
                this._createPolygonAndSetupFrom(points, object);
                break;
            case 'polygon':
                this._setupPolygon(object);
                break;
            default:
                this.polygon = null;
                PLUGINS.dialog.show("Modification with <i>shift</i> allowed only with annotation objects.", 5000, PLUGINS.dialog.MSG_WARN);
                return;
        }

        this._update = add ? this._union : this._subtract;
        this.mousePos = atPosition;
        this.simplifier = this._context.polygon.simplify.bind(this._context.polygon);
    },

    brushSizeControls: function() {
        return `<span class="d-inline-block" style="width:46%" title="Size of a brush used to modify annotations areas.">Free form tool size:</span>
        <input style="width:50%" class="form-control" title="Size of a brush used to modify annotations areas." type="number" min="1" max="100" name="freeFormToolSize" id="fft-size" autocomplete="off" value="${this.radius}" 
        onchange="openseadragon_image_annotations.modifyTool.setRadius(this.value);" style="height: 22px;">`;
    },

    setRadius: function (radius) {
        this.radius = Math.round(Math.sqrt(this._context.getRelativePixelDiffDistSquared(radius*2)));
    },

    //update step meant to be executed on mouse move event
    update: function(point) {
        if (!this.polygon) {
            console.warn("FreeFormTool:invalid state.");
            return;
        }

        try {
            let result = this._update(point);

            //result must exist and new no. of points must be at least 10% of the previous
            if (result && this.polygon.points.length * 0.1 <= result.points.length) {
                this._context.overlay.fabricCanvas().remove(this.polygon);

                this.polygon = result;
                
                this._context.overlay.fabricCanvas().add(result);
                this._context.overlay.fabricCanvas().renderAll();
            }
        } catch (e) {
            console.warn("FreeFormTool: something went wrong, ignoring...", e);
        }
    },

    //final step
    finish: function () {
        if (this.polygon) {
            delete this.initial.moveCursor;
            delete this.polygon.moveCursor;
            if (this.polygon.incrementId != this.initial.incrementId) {
                //incrementID is used by history - if ID equal, no changes were made -> no record
                this._context.history.push(this.polygon, this.initial);
            }
            this._cachedSelection = this.polygon;
            let outcome = this.polygon;
            this.polygon = null;
            this.initial = null;
            this.mousePos = null;
            return outcome;
        }
        return null;
    },

    //TODO sometimes the greinerHormann takes too long to finish (it is cycling, verticaes are NaN values), do some measurement and kill after it takes too long (2+s ?)
    _union: function (nextMousePos) {
        if (!this.polygon || this._context.toDistanceObj(this.mousePos, nextMousePos) < this.radius / 3) return;

        let radPoints = this.getCircleShape(nextMousePos);
        //console.log(radPoints);
        var polypoints = this.polygon.get("points");
        //avoid 'Leaflet issue' - expecting a polygon that is not 'closed' on points (first != last)
        if (this._context.toDistanceObj(polypoints[0], polypoints[polypoints.length - 1]) < this.radius) polypoints.pop();
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
                // var polygon = this._context.polygon.copy(this.polygon, this.simplifier(union));
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

                var polygon = this._context.polygon.copy(this.polygon, this.simplifier(union[maxIdx]));
                polygon.objectCaching = false;
            }
            return polygon;
        } 
          
        console.log("NO UNION FOUND");
        return null;
    },

    _subtract: function (nextMousePos) {
        if (!this.polygon || this._context.toDistanceObj(this.mousePos, nextMousePos) < this.radius / 3) return;

        let radPoints = this.getCircleShape(nextMousePos);
        var polypoints = this.polygon.get("points");
        this.mousePos = nextMousePos;

        var difference = greinerHormann.diff(polypoints, radPoints);
        if (difference) {
            if (typeof difference[0][0] === 'number') { // single linear ring
                var polygon = this._context.polygon.create(this.simplifier(difference), this._context.objectOptions(this.polygon.isLeftClick));
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
                    this._context.overlay.fabricCanvas().remove(this.polygon);
                    this._context.history.push(null, this.initial);

                    this.polygon = null;
                    this.initial = null;
                    this.mousePos = null;
                    return null;
                }

                var polygon = this._context.polygon.copy(this.polygon, this.simplifier(difference[maxIdx]));
                polygon.objectCaching = false;               
            }
            return polygon;
        } 
        console.log("NO DIFFERENCE FOUND");
        return null;
    },

    getScreenToolRadius: function () {
        return this._context.toScreenCoords(0, 0).distanceTo(this._context.toScreenCoords(0, this.radius));
    },

    //initialize object so that it is ready to be modified
    _setupPolygon: function (polyObject) {
        this.polygon = polyObject;
        this.initial = polyObject;

        polyObject.moveCursor = 'crosshair';
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
            if (j == primary.length - 1) secondary.push(primary[j]);
            primary = secondary;
            secondary = [];
        }
        return primary;
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
