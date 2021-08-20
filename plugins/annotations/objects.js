//All objects implement these functions:
//  - create(..., options) - will create object of the type, and add all options passed in the object
//  - copy(...) - will make copy with its properties
//  - initCreate(...)
//  - updateCreate(...)
//  - initEdit(...)
//  - updateEdit(...)
//  - finish(...)
Rect = function(context) {
    this._context = context;
    this._origX = null;
    this._origY = null;
}

Rect.prototype = {
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
            hasControls: false,
            comment: ofObject.comment
        });    
	},


    // initialize attributes, prepare for new drawing
    initCreate: function (x, y, isLeftClick=true) {
        this._origX = x;
        this._origY = y;
        this._context.currentAnnotationObject = this.create(x, y, 1, 1, this._context.objectOptions(isLeftClick));
        this._context.currentAnnotationObjectUpdater = this;
        this._context.overlay.fabricCanvas().add(this._context.currentAnnotationObject);
    },


    updateCreate: function (x, y) {
        if (this._origX > x) {
            this._context.currentAnnotationObject.set({ left: Math.abs(x) });
        };
        if (this._origY > y) {
            this._context.currentAnnotationObject.set({ top: Math.abs(y) });
        };
        var width = Math.abs(x - this._origX);
        var height = Math.abs(y - this._origY);
        this._context.currentAnnotationObject.set({ width: width, height: height });    
    },

    initEdit: function(p) {
        //do nothing
     },
 
     updateEdit: function (p) {
         //do nothing
     },
 
     finish: function () {
         //do nothing
     }
}

Ellipse = function(context) {
    this._context = context;
    this._origX = null;
    this._origY = null;
}

Ellipse.prototype = {
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
            comment: ofObject.comment,
        });     
	},


    // initialize attributes, prepare for new drawing
    initCreate: function (x, y, isLeftClick=true) {
        this._origX = x;
        this._origY = y;
        this._context.currentAnnotationObject = this.create(x, y, 1, 1, this._context.objectOptions(isLeftClick));
        this._context.currentAnnotationObjectUpdater = this;
        this._context.overlay.fabricCanvas().add(this._context.currentAnnotationObject);
    },

    updateCreate: function (x, y) {
		if (this._origX > x) {
			this._context.currentAnnotationObject.set({ left: Math.abs(x) });
		};
		if (this._origY > y) {
			this._context.currentAnnotationObject.set({ top: Math.abs(y) });
		};
		var width = Math.abs(x - this._origX) / 2;
		var height = Math.abs(y - this._origY) / 2;
		this._context.currentAnnotationObject.set({ rx: width, ry: height });
    },

    initEdit: function(p) {
       //do nothing
    },

    updateEdit: function (p) {
		//do nothing
	},

    finish: function () {
        //do nothing
    }
}

// name space for polygon manupulation
Polygon = function (context) {
    // min: 99,
    // max: 999999,
    this.polygonBeingCreated = false; // is polygon being drawn/edited
    this.pointArray = null;
    this.lineArray = null;
    this.activeLine = null;
    this.activeShape = false;
    this.currentlyEddited = null;
    this.originallyEddited = null;
    this.input_attributes = {};
    this._context = context;
}

Polygon.prototype = {
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
			evented: evented,
		});
	},


    // initialize attributes, prepare for new drawing
    initCreate: function (isNew=true) {
        this.polygonBeingCreated = isNew;
        this.pointArray = new Array();
        this.lineArray = new Array();
        this.activeLine = null;
        this.activeShape = false;
        this.currentlyEddited = null;
        this.input_attributes = {};
        this.originallyEddited = null;
    },


    updateCreate: function (x, y, isLeftClick=true) {

        if (!this.polygonBeingCreated) {
			this.initCreate();
		}

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

        if (this.activeShape) {
            var points = this.activeShape.get("points");
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

            this._context.overlay.fabricCanvas().remove(this.activeShape);
            this._context.overlay.fabricCanvas().add(polygon);
            this.activeShape = polygon;
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
            this.activeShape = polygon;
            this._context.overlay.fabricCanvas().add(polygon);
        }
        this.activeLine = line;

        this.pointArray.push(circle);
        this.lineArray.push(line);

        this._context.overlay.fabricCanvas().add(line);
        this._context.overlay.fabricCanvas().add(circle);
        this._context.overlay.fabricCanvas().selection = false;
    },

    initEdit: function(p) {
        this.initCreate(false);
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

    // generate finished polygon
    finish: function () {
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
            this._context.overlay.fabricCanvas().remove(this.activeShape).remove(this.activeLine);
            left = this.activeShape.isLeftClick;
        } else {
            this._context.overlay.fabricCanvas().remove(this.currentlyEddited);
            left = this.originallyEddited.isLeftClick;
        };


        if (this.pointArray.length < 3) {
            this.init(false); //clear
            return;
        }

        this._context.currentAnnotationObject = this.create(points, this._context.objectOptions(left));
        //todo callback with deletion completion of active polygon/currently modified one? need to delete also all the circles!!
        //if polygon is being drawn, delete it
        // if (this._context.polygon.polygonBeingCreated == true) {
        // 	this._context.polygon.activeShape.remove();
        // 	this._context.polygon.pointArray.forEach(function (point) {
        // 		this._context.overlay.fabricCanvas().remove(point)
        // 	});
        // 	this._context.polygon.lineArray.forEach(function (line) {
        // 		this._context.overlay.fabricCanvas().remove(line)
        // 	});
        // 	this._context.polygon.polygonBeingCreated = false;}



        // add polygon to canvas, switxh to edit mode, select it, set input form and show the input form
        this._context.overlay.fabricCanvas().add(this._context.currentAnnotationObject);
        //originallyEdited is null if new polygon, else history can redo
        this._context.history.push(this._context.currentAnnotationObject, this.originallyEddited);


        //TODO open by default edit mode or not?
        // if (this._context.mouseMode != "editAnnotation" && this._context.mouseMode != "OSD") {
        // 	document.getElementById("editAnnotation").click();
        // };
        // 		open... TODO .setActive(this.currentAnnotationObject);
        // this._context.currentAnnotationObject.set(this.input_attributes);
        // this._context.set_input_form(this._context.currentAnnotationObject);
        // $("#input_form").show();
        // document.getElementById('edit').disabled = false;

        this.initCreate(false); //clear
    }
}