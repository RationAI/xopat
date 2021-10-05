//All objects implement these functions (no native interface support):
//  - create(..., options) - will create object of the type, and add all options passed in the object
//  - copy(...) - will make copy with its properties
//  - instantCreate(...) - will create an object on-click: approximation of underlying visualisation area
//  - initCreate(...) - wil init manual creation
//  - updateCreate(...) - update manual creation
//  - initEdit(...) - init manual edit
//  - updateEdit(...) - update manual edit
//  - finishDirect(...) - finish any ongoing changes directly (mouse release)
//  - finishIndirect(...) - finish any ongoing changes indirectly (state change)

Rect = function(context) {
    this._context = context;
    this._origX = null;
    this._origY = null;
    this.type = "rect";
}
Rect.prototype = {
    getIcon: function () {
      return "crop_5_4";  
    },

    getCurrentObject: function() {
        return this._current;
    },

    create: function (left, top, width, height, options) {
		return new fabric.Rect($.extend({
            left: left,
			top: top,
            width: width,
			height: height,
            scaleX: 1,
			scaleY: 1,
			type: 'rect'			
		}, options));
	},

    //todo unify parameters - where is scale?
	copy: function (ofObject, left, top, width, height) {
        return new fabric.Rect({
            left: left,
            top: top,
            fill: ofObject.fill,
            isLeftClick: ofObject.isLeftClick,
            opacity: ofObject.opacity,
            strokeWidth: ofObject.strokeWidth,
            stroke: ofObject.stroke,
            width: width,
            height: height,
            scaleX: ofObject.scaleX,
            scaleY: ofObject.scaleY,
            type: ofObject.type,
            hasRotatingPoint: ofObject.hasRotatingPoint,
            borderColor: ofObject.borderColor,
            cornerColor: ofObject.cornerColor,
            borderScaleFactor: ofObject.borderScaleFactor,
            hasControls: ofObject.hasControls,
            lockMovementX: ofObject.lockMovementX,
            lockMovementY: ofObject.lockMovementY,
            comment: ofObject.comment,
            presetID: ofObject.presetID
        });    
	},

    instantCreate: function(point, isLeftClick=true) {
        let bounds = this._context._getSimpleApproxObjectBounds(point);
		let obj = this.create(bounds.left.x, bounds.top.y, bounds.right.x - bounds.left.x, bounds.bottom.y - bounds.top.y, this._context.objectOptions(isLeftClick));
		//this._context.currentAnnotationObjectUpdater = this.rectangle;
		this._context.overlay.fabricCanvas().add(obj);
		this._context.history.push(obj);
		this._context.overlay.fabricCanvas().setActiveObject(obj);
		this._context.overlay.fabricCanvas().renderAll();
    },

    isValidShortCreationClick() {
        return false;
    },

    initCreate: function (x, y, isLeftClick=true) {
        this._origX = x;
        this._origY = y;
        this._current = this.create(x, y, 1, 1, this._context.objectOptions(isLeftClick));
        this._context.overlay.fabricCanvas().add(this._current);
    },

    updateCreate: function (x, y) {
        if (!this._current) return;
        if (this._origX > x) {
            this._current.set({ left: Math.abs(x) });
        };
        if (this._origY > y) {
            this._current.set({ top: Math.abs(y) });
        };
        var width = Math.abs(x - this._origX);
        var height = Math.abs(y - this._origY);
        this._current.set({ width: width, height: height });    
    },

    initEdit: function(p) {
        //do nothing
    },
 
    updateEdit: function (p) {
         //do nothing
    },
 
    finishDirect: function () {
        let obj = this.getCurrentObject();
        if (!obj) return;
        this._context.history.push(obj);
        this._context.overlay.fabricCanvas().setActiveObject(obj);
        this._context.overlay.fabricCanvas().renderAll();
        this._context.overlay.fabricCanvas().setActiveObject(obj);
        this._current = undefined;
    },

    finishIndirect: function () {
        //do nothing
    }
}

Ellipse = function(context) {
    this._context = context;
    this._origX = null;
    this._origY = null;
    this.type = "ellipse";
}

Ellipse.prototype = {
    getIcon: function () {
        return "lens";  
    },

    getCurrentObject: function() {
        return this._current;
    },

    create: function (left, top, rx, ry, options) {
		return new fabric.Ellipse($.extend({
            left: left,
			top: top,
            originX: 'left',
            originY: 'top',
            rx: rx,
            ry: ry,
            angle: 0,
            scaleX: 1,
			scaleY: 1,
			type: 'ellipse'			
		}, options));
	},

	copy: function (ofObject, left, top, rx, ry) {
        return new fabric.Ellipse({
            left: left,
            top: top,
            originX: ofObject.originX,
            originY: ofObject.originY,
            rx: rx,
            ry: ry,
            angle: ofObject.angle,
            fill: ofObject.fill,
            stroke: ofObject.stroke,
            strokeWidth: ofObject.strokeWidth,
            opacity: ofObject.opacity,
            type: ofObject.type,
            isLeftClick: ofObject.isLeftClick,
            selectable: ofObject.selectable,
            hasRotatingPoint: ofObject.hasRotatingPoint,
            borderColor: ofObject.borderColor,
            cornerColor: ofObject.cornerColor,
            borderScaleFactor: ofObject.borderScaleFactor,
            hasControls: ofObject.hasControls,
            lockMovementX: ofObject.lockMovementX,
            lockMovementY: ofObject.lockMovementY,
            comment: ofObject.comment,
            presetID: ofObject.presetID
        });     
	},

    instantCreate: function(point, isLeftClick=true) {
        let bounds = this._context._getSimpleApproxObjectBounds(point);
		let obj = this.create(bounds.left.x, bounds.top.y, (bounds.right.x - bounds.left.x) / 2, (bounds.bottom.y - bounds.top.y) / 2, this._context.objectOptions(isLeftClick));
		//this._context.currentAnnotationObjectUpdater = this.rectangle;
		this._context.overlay.fabricCanvas().add(obj);
		this._context.history.push(obj);
		this._context.overlay.fabricCanvas().setActiveObject(obj);
		this._context.overlay.fabricCanvas().renderAll();
    },

    isValidShortCreationClick() {
        return false;
    },

    // initialize attributes, prepare for new drawing
    initCreate: function (x, y, isLeftClick=true) {
        this._origX = x;
        this._origY = y;
        this._current = this.create(x, y, 1, 1, this._context.objectOptions(isLeftClick));
        this._context.overlay.fabricCanvas().add(this._current);
    },

    updateCreate: function (x, y) {
        if (!this._current) return;

		if (this._origX > x) {
			this._current.set({ left: Math.abs(x) });
		};
		if (this._origY > y) {
			this._current.set({ top: Math.abs(y) });
		};
		var width = Math.abs(x - this._origX) / 2;
		var height = Math.abs(y - this._origY) / 2;
		this._current.set({ rx: width, ry: height });
    },

    initEdit: function(p) {
       //do nothing
    },

    updateEdit: function (p) {
		//do nothing
	},

    finishDirect: function () {
        let obj = this.getCurrentObject();
        if (!obj) return;
        this._context.history.push(obj);
        this._context.overlay.fabricCanvas().setActiveObject(obj);
        this._context.overlay.fabricCanvas().renderAll();
        this._context.overlay.fabricCanvas().setActiveObject(obj);
        this._current = undefined;
    },

    finishIndirect: function () {
        //do nothing
    }
}

// name space for polygon manupulation
//todo rename to underscore if private
Polygon = function (context) {
    // min: 99,
    // max: 999999,
    this.polygonBeingCreated = false; // is polygon being drawn/edited
    this.pointArray = null;
    this.lineArray = null;
    this.activeLine = null;
    this._current = null;
    this.currentlyEddited = null;
    this.originallyEddited = null;
    this.input_attributes = {};
    this._context = context;
    this.type = "polygon";
}

Polygon.prototype = {
    getIcon: function () {
        return "share";  
    },

    getCurrentObject: function() {
        return this._current;
    },

   	create: function (points, options) {
		return new fabric.Polygon(points, $.extend({
			type: 'polygon'			
		}, options));
	},

    //todo unify parameters - where is evented?
	copy: function (ofObject, newPoints, evented = true) {
		return new fabric.Polygon(newPoints, {
			hasRotatingPoint: ofObject.hasRotatingPoint,
			fill: ofObject.fill,
			stroke: ofObject.stroke,
			strokeWidth: ofObject.strokeWidth,
			isLeftClick: ofObject.isLeftClick,
			opacity: ofObject.opacity,
			type: ofObject.type,
			selectable: ofObject.selectable,
			borderColor: ofObject.borderColor,
			cornerColor: ofObject.cornerColor,
			borderScaleFactor: ofObject.borderScaleFactor,
			comment: ofObject.comment,
			selectable: evented,
			hasControls: ofObject.hasControls,
            lockMovementX: ofObject.lockMovementX,
            lockMovementY: ofObject.lockMovementY,
			evented: evented,
            presetID: ofObject.presetID
		});
	},

    instantCreate: function(point, isLeftClick=true) {
		var viewportPos = PLUGINS.osd.viewport.pointFromPixel(point);
		this._context.changeTile(viewportPos);

		let points = [];
		this.comparator = function (pix) {
			return (pix[3] > this._context.alphaSensitivity && (pix[0] > 200 || pix[1] > 200));
		}

		var x = point.x;
		var y = point.y;

		let origPixel = this._context.getPixelData(point);
		if (!this.comparator(origPixel)) {
			this._context.messenger.show("Outside a region - decrease sensitivity to select.", 2000, this._context.messenger.MSG_INFO);
			return
		};

                //todo ugly, move all this stuff here? 

		if (origPixel[0] > 200) {
			this._context.comparator = function (pix) {
				return pix[3] > this.alphaSensitivity && pix[0] > 200;
			}
		} else {
			this._context.comparator = function (pix) {
				return pix[3] > this.alphaSensitivity && pix[1] > 200;
			}
		}
 

		//speed based on ZOOM level (detailed tiles can go with rougher step)
		let maxLevel = PLUGINS.dataLayer.source.maxLevel;
		let level = this._context._currentTile.level;
		let maxSpeed = 24;
		let speed = Math.round(maxSpeed / Math.max(1, 2 * (maxLevel - level)));

		//	After each step approximate max distance and abort if too small

		//todo same points evaluated multiple times seems to be more stable, BUT ON LARGE CANVAS!!!...

		var maxX = 0, maxY = 0;
		this._context._growRegionInDirections(x - 1, y, [-1, 0], [[0, -1], [0, 1]], points, speed, this._context.isValidPixel.bind(this._context));
		maxX = Math.max(maxX, Math.abs(x - points[points.length - 1].x));
		maxY = Math.max(maxY, Math.abs(y - points[points.length - 1].y));
		this._context._growRegionInDirections(x + 1, y, [1, 0], [[0, -1], [0, 1]], points, speed, this._context.isValidPixel.bind(this._context));
		maxX = Math.max(maxX, Math.abs(x - points[points.length - 1].x));
		maxY = Math.max(maxY, Math.abs(y - points[points.length - 1].y));
		this._context._growRegionInDirections(x, y + 1, [0, -1], [[-1, 0], [1, 0]], points, speed, this._context.isValidPixel.bind(this._context));
		maxX = Math.max(maxX, Math.abs(x - points[points.length - 1].x));
		maxY = Math.max(maxY, Math.abs(y - points[points.length - 1].y));
		this._context._growRegionInDirections(x, y - 1, [0, 1], [[-1, 0], [1, 0]], points, speed, this._context.isValidPixel.bind(this._context));
		maxX = Math.max(maxX, Math.abs(x - points[points.length - 1].x));
		maxY = Math.max(maxY, Math.abs(y - points[points.length - 1].y));

		if (maxX < 10 || maxY < 10) {
			this._context.messenger.show("Failed to create region.", 3000, this._context.messenger.MSG_WARN);
			return;
		}

		points = hull(points, 2 * speed);
		let p1 = points[0]; p2 = points[1];
		let result = [this._context.toGlobalPointXY(p1[0], p1[1])];

		for (var i = 2; i < points.length; i++) {
			//three consecutive points on a line, discard
			if ((Math.abs(p1[0] - p2[0]) < 2 && Math.abs(points[i][0] - p2[0]) < 2)
				|| (Math.abs(p1[1] - p2[1]) < 2 && Math.abs(points[i][1] - p2[1]) < 2)) {
				p2 = points[i];
				continue;
			}

			p1 = p2;
			p2 = points[i];
			result.push(this._context.toGlobalPointXY(p1[0], p1[1]));
		}

		let obj = this.create(result, this._context.objectOptions(isLeftClick));
		this._context.overlay.fabricCanvas().add(obj);

		this._context.history.push(obj);
		this._context.overlay.fabricCanvas().setActiveObject(obj);
		this._context.overlay.fabricCanvas().renderAll();
    },

    isValidShortCreationClick() {
        return true;
    },

    initCreate: function (x, y, isLeftClick=true) {
        if (!this.polygonBeingCreated) {
			this._initialize();
		}
        this.isLeftClick = isLeftClick;

        // get name of point
        // var random = Math.floor(Math.random() * (this.max - this.min + 1)) + this.min;
        // var id = new Date().getTime() + random;
        // calcute size of the point(1000px - 20px) based on zoom (0-1.1)
        var zoom = this._context.overlay.fabricCanvas().getZoom();
        var circle_size = 0;
        if (zoom < 0.01) { circle_size = 1000 }
        else if (zoom < 0.03) { circle_size = 500 }
        else if (zoom < 0.1) { circle_size = 100 }
        else if (zoom < 0.3) { circle_size = 50 }
        else { circle_size = 20 };
        //create circle representation of the point
        var circle = new fabric.Circle({
            radius: circle_size,
            fill: '#F58B8B',
            stroke: '#333333',
            strokeWidth: 0.5,
            left: x,
            top: y,
            selectable: false,
            hasBorders: false,
            hasControls: false,
            originX: 'center',
            originY: 'center',
            //id: id,
            objectCaching: false,
            type: "_polygon.controls.circle"
        });
        if (this.pointArray.length == 0) {
            circle.set({
                fill: 'red'
            })
        }
        circle.lockMovementX = circle.lockMovementY = true;

        var points = [x, y, x, y],
            line = new fabric.Line(points, {
            strokeWidth: 4,
            fill: '#red',
            stroke: '#999999',
            class: 'line',
            originX: 'center',
            originY: 'center',
            selectable: false,
            hasBorders: false,
            hasControls: false,
            evented: false,
            objectCaching: false
        });

        if (this._current) {
            var points = this._current.get("points");
            points.push({
                x: x,
                y: y
            });
            var polygon = this.create(points, this._context.objectOptions(isLeftClick))
            polygon.selectable = false;
            polygon.hasBorders = false;
            polygon.hasControls = false;
            polygon.evented = false;
            polygon.objectCaching = false;

            this._context.overlay.fabricCanvas().remove(this._current);
            this._context.overlay.fabricCanvas().add(polygon);
            this._current = polygon;
            this._context.overlay.fabricCanvas().renderAll();
        }
        else {
            var polyPoint = [{ x: x, y: y }];
            var polygon = this.create(polyPoint, this._context.objectOptions(isLeftClick));
            polygon.selectable = false;
            polygon.hasBorders = false;
            polygon.hasControls = false;
            polygon.evented = false;
            polygon.objectCaching = false;
            this._current = polygon;
            this._context.overlay.fabricCanvas().add(polygon);
        }
        this.activeLine = line;

        this.pointArray.push(circle);
        this.lineArray.push(line);

        this._context.overlay.fabricCanvas().add(line);
        this._context.overlay.fabricCanvas().add(circle);
        this._context.overlay.fabricCanvas().selection = false;
    },

    updateCreate: function (x, y) {
        if (!this.polygonBeingCreated) return;
        
        let last = this.pointArray[this.pointArray.length-1],
            dy = last.top - y,
            dx = last.left - x;

        var zoom = this._context.overlay.fabricCanvas().getZoom();
        var powRad = 20;
        if (zoom < 0.01) { powRad = 50*powRad; }
        else if (zoom < 0.03) { powRad = 20*powRad; }
        else if (zoom < 0.1) { powRad = 5*powRad; }
        else if (zoom < 0.3) { powRad = 2.5*powRad; }
        powRad = powRad * powRad;
        if (dx*dx + dy*dy > powRad) {
            this.initCreate(x, y, this.isLeftClick);
        }    
    },

    initEdit: function(p) {
        this._initialize(false);
		this.input_attributes = {
			comment: p.comment,
			a_group: p.a_group,
			threshold: p.threshold,
		};
		var points = p.get("points");
		var zoom = this._context.overlay.fabricCanvas().getZoom();
		var circle_size = 0;
		if (zoom < 0.01) { circle_size = 1000 }
		else if (zoom < 0.03) { circle_size = 500 }
		else if (zoom < 0.1) { circle_size = 100 }
		else if (zoom < 0.3) { circle_size = 50 }
		else { circle_size = 20 };

        var _this = this;

		points.forEach(function (point, index) {
			var circle = new fabric.Circle({
				radius: circle_size,
				fill: 'red',
				left: point.x,
				top: point.y,
				originX: 'center',
				originY: 'center',
				hasControls: false,
				hasBorders: false,
				name: index,
				type: "_polygon.controls.circle"
			});
			_this.pointArray.push(circle);
			_this._context.overlay.fabricCanvas().add(circle);
		});
		this._context.overlay.fabricCanvas().renderAll();


		this.originallyEddited = p;
		this.currentlyEddited = this.copy(p, points, false);
		this._context.overlay.fabricCanvas().remove(p);
		this._context.overlay.fabricCanvas().add(this.currentlyEddited);
		this._context.overlay.fabricCanvas().sendToBack(this.currentlyEddited);
    },

    updateEdit: function (p) {
		let curr = this.currentlyEddited;
		curr.points[p.name] = { x: p.getCenterPoint().x, y: p.getCenterPoint().y };
		this._context.overlay.fabricCanvas().remove(curr);
		//todo do not create copy, just keep the same polygon
		this.currentlyEddited = this.copy(curr, curr.points, false);
		this._context.overlay.fabricCanvas().add(this.currentlyEddited);
		this._context.overlay.fabricCanvas().sendToBack(this.currentlyEddited);
	},

    finishDirect: function () {
        //do nothing
    },

    // generate finished polygon
    finishIndirect: function () {
        if (!this._current && !this.currentlyEddited) return;

        var points = new Array(), _this=this;
        $.each(this.pointArray, function (index, point) {
            points.push({
                x: point.left,
                y: point.top
            });
            _this._context.overlay.fabricCanvas().remove(point);
        });

        let left = true;

        if (!this.currentlyEddited) {
            $.each(this.lineArray, function (index, line) {
                _this._context.overlay.fabricCanvas().remove(line);
            });
            this._context.overlay.fabricCanvas().remove(this._current).remove(this.activeLine);
            left = this._current.isLeftClick;
        } else {
            this._context.overlay.fabricCanvas().remove(this.currentlyEddited);
            left = this.originallyEddited.isLeftClick;
        };

        if (this.pointArray.length < 3) {
            this._initialize(false); //clear
            return;
        }

        points = this.simplify(points);

        this._current = this.create(points, this._context.objectOptions(left));
        //todo callback with deletion completion of active polygon/currently modified one? need to delete also all the circles!!
        //if polygon is being drawn, delete it
        // if (this._context.polygon.polygonBeingCreated == true) {
        // 	this._context.polygon._current.remove();
        // 	this._context.polygon.pointArray.forEach(function (point) {
        // 		this._context.overlay.fabricCanvas().remove(point)
        // 	});
        // 	this._context.polygon.lineArray.forEach(function (line) {
        // 		this._context.overlay.fabricCanvas().remove(line)
        // 	});
        // 	this._context.polygon.polygonBeingCreated = false;}



        // add polygon to canvas, switxh to edit mode, select it, set input form and show the input form
        this._context.overlay.fabricCanvas().add(this._current);
        this._context.overlay.fabricCanvas().setActiveObject(this._current);
        //originallyEdited is null if new polygon, else history can redo
        this._context.history.push(this._current, this.originallyEddited);

        this._initialize(false); //clear
    },

    _initialize: function(isNew=true) {
        this.polygonBeingCreated = isNew;
        this.pointArray = new Array();
        this.lineArray = new Array();
        this.activeLine = null;
        this._current = null;
        this.currentlyEddited = null;
        this.input_attributes = {};
        this.originallyEddited = null;
    },


    /*
    THE FOLOWING CODE HAS BEEN COPIED OUT FROM A LIBRARY
    (c) 2017, Vladimir Agafonkin
    Simplify.js, a high-performance JS polyline simplification library
    mourner.github.io/simplify-js
    */

    _getSqDist: function(p1, p2) {
        var dx = p1.x - p2.x,
            dy = p1.y - p2.y;
        return dx * dx + dy * dy;
    },

    _getSqSegDist: function(p, p1, p2) {
        var x = p1.x,
            y = p1.y,
            dx = p2.x - x,
            dy = p2.y - y;
        if (dx !== 0 || dy !== 0) {
            var t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
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

    _simplifyRadialDist: function(points, sqTolerance) {

        var prevPoint = points[0],
            newPoints = [prevPoint],
            point;

        for (var i = 1, len = points.length; i < len; i++) {
            point = points[i];

            if (this._getSqDist(point, prevPoint) > sqTolerance) {
                newPoints.push(point);
                prevPoint = point;
            }
        }

        if (prevPoint !== point) newPoints.push(point);

        return newPoints;
    },

    _simplifyDPStep: function(points, first, last, sqTolerance, simplified) {
        var maxSqDist = sqTolerance,
            index;

        for (var i = first + 1; i < last; i++) {
            var sqDist = this._getSqSegDist(points[i], points[first], points[last]);

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

    // simplification using Ramer-Douglas-Peucker algorithm
    _simplifyDouglasPeucker: function(points, sqTolerance) {
        var last = points.length - 1;

        var simplified = [points[0]];
        this._simplifyDPStep(points, 0, last, sqTolerance, simplified);
        simplified.push(points[last]);

        return simplified;
    },

    // both algorithms combined for awesome performance
    simplify: function(points, highestQuality=false) {

        if (points.length <= 2) return points;

        let tolerance = this._context.getRelativePixelDiffDistSquared(3);
        points = highestQuality ? points : this._simplifyRadialDist(points, tolerance);
        points = this._simplifyDouglasPeucker(points, tolerance);

        return points;
    }
}