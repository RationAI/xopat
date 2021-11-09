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

        let objectFactory = this._context.getAnnotationObjectFactory(object.type);
        if (objectFactory !== undefined) {
            if (objectFactory.isImplicit()) {
                //object can be used immedietaly
                this._setupPolygon(object);
            } else {
                let points = objectFactory.toPointArray(object, AnnotationObjectFactory.withObjectPoint, 1);
                this._createPolygonAndSetupFrom(points, object);
            }
        } else {
            this.polygon = null;
            PLUGINS.dialog.show("Modification with <i>shift</i> allowed only with annotation objects.", 5000, PLUGINS.dialog.MSG_WARN);
            return;
        }

        this._update = add ? this._union : this._subtract;
        this.mousePos = atPosition;
        this.simplifier = this._context.polygonFactory.simplify.bind(this._context.polygonFactory);
    },

    brushSizeControls: function() {
        return `<span class="d-inline-block" style="width:46%" title="Size of a brush used to modify annotations areas.">Free form tool size:</span>
        <input style="width:50%" class="form-control" title="Size of a brush used to modify annotations areas." type="number" min="1" max="100" name="freeFormToolSize" id="fft-size" autocomplete="off" value="${this.radius}" 
        onchange="openseadragon_image_annotations.modifyTool.setRadius(this.value);" style="height: 22px;">`;
    },

    setRadius: function (radius) {
        let pointA = PLUGINS.dataLayer.windowToImageCoordinates(new OpenSeadragon.Point(0, 0));
        let pointB = PLUGINS.dataLayer.windowToImageCoordinates(new OpenSeadragon.Point(radius*2, 0));
        this.radius = Math.round(Math.sqrt(Math.pow(pointB.x - pointA.x, 2) + Math.pow(pointB.y - pointA.y, 2)));
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
            if (this.polygon.incrementId !== this.initial.incrementId) {
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
    },

    _subtract: function (nextMousePos) {
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
                    this._context.overlay.fabricCanvas().remove(this.polygon);
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
        console.log("NO DIFFERENCE FOUND");
        return null;
    },

    getScreenToolRadius: function () {
        return PLUGINS.dataLayer.imageToWindowCoordinates(new OpenSeadragon.Point(0, 0))
            .distanceTo(
                PLUGINS.dataLayer.imageToWindowCoordinates(new OpenSeadragon.Point(0, this.radius))
            );
    },


    //initialize object so that it is ready to be modified
    _setupPolygon: function (polyObject) {
        this.polygon = polyObject;
        this.initial = polyObject;

        polyObject.moveCursor = 'crosshair';
    },

    //create polygon from points and initialize so that it is ready to be modified
    _createPolygonAndSetupFrom: function (points, object) {
        //TODO avoid re-creation of polygon, if it already was polygon

        //TODO //FIXME history redo of this step incorrectly places the object at canvas (shifts)
        let polygon = this._context.polygonFactory.copy(object, points);
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
            if (j === primary.length - 1) secondary.push(primary[j]);
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

    toDistancePointsAsObjects: function (pointA, pointB) {
        return Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
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
