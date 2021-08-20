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
    // initialize attributes, prepare for new drawing
    init: function (isNew=true) {
        this.polygonBeingCreated = isNew;
        this.pointArray = new Array();
        this.lineArray = new Array();
        this.activeLine = null;
        this.activeShape = false;
        this.currentlyEddited = null;
        this.input_attributes = {};
        this.originallyEddited = null;
    },
    addPoint: function (x, y) {
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

        var points = [x, y, x, y];
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
            var polygon = this._context.createPolygon(points);
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
            var polygon = this._context.createPolygon(polyPoint);
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

    // generate finished polygon
    generatePolygon: function (pointArray) {
        var points = new Array(), _this=this;
        $.each(pointArray, function (index, point) {
            points.push({
                x: point.left,
                y: point.top
            });
            _this._context.overlay.fabricCanvas().remove(point);
        });

        if (!this.currentlyEddited) {
            $.each(this.lineArray, function (index, line) {
                _this._context.overlay.fabricCanvas().remove(line);
            });
            this._context.overlay.fabricCanvas().remove(this.activeShape).remove(this.activeLine);
        } else {
            this._context.overlay.fabricCanvas().remove(this.currentlyEddited);
        };


        if (pointArray.length < 3) {
            this.init(false); //clear
            return;
        }

        this._context.currentAnnotationObject = this._context.createPolygon(points);
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

        this.init(false); //clear
    }
}