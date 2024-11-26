// OpenSeadragon canvas Overlay plugin 0.0.1 based on svg overlay plugin

(function() {

    // fabric.Object.prototype.ignoreZoom = false;
    // const originalTransform = fabric.Object.prototype.transform;
    // fabric.Object.prototype.transform = function(ctx, fromLeft) {
    //     if (this instanceof fabric.IText) {
    //         console.log("Is text!");
    //
    //         if (this.group && !this.group._transformDone && this.group === this.canvas._activeGroup) {
    //             this.group.transform(ctx);
    //         }
    //         // ADDED CODE FOR THE ANSWER
    //         if (this.ignoreZoom && !this.group && this.canvas) {
    //             var zoom = 1 / this.canvas.getZoom();
    //             ctx.scale(zoom, zoom);
    //         }
    //         // END OF ADDED CODE FOR THE ANSWER
    //         var center = fromLeft ? this._getLeftTopCoords() : this.getCenterPoint();
    //         ctx.translate(center.x, center.y);
    //         this.angle && ctx.rotate(degreesToRadians(this.angle));
    //         ctx.scale(
    //             this.scaleX * (this.flipX ? -1 : 1),
    //             this.scaleY * (this.flipY ? -1 : 1)
    //         );
    //         this.skewX && ctx.transform(1, 0, Math.tan(degreesToRadians(this.skewX)), 1, 0, 0);
    //         this.skewY && ctx.transform(1, Math.tan(degreesToRadians(this.skewY)), 0, 1, 0, 0);
    //     } else {
    //         console.log(this.borderScaleFactor);
    //         originalTransform.apply(this, [ctx]);
    //     }
    // };



    fabric.Object.prototype.objectCaching = false;
    fabric.Object.NUM_FRACTION_DIGITS = 2;
    fabric.Group.prototype.objectCaching = false;
    //fabric cannot minify points in IO, replace
    fabric.Polygon.prototype.toObject =
        fabric.Polyline.prototype.toObject = function(propertiesToInclude) {
        const digits = fabric.Object.NUM_FRACTION_DIGITS;
        const data = this.callSuper('toObject', propertiesToInclude);
        data.points = this.points.concat().map(p => ({
            x: parseFloat(Number(p.x).toFixed(digits)),
            y: parseFloat(Number(p.y).toFixed(digits))
        }));
        return data;
    };
    /**
     * Find object under mouse by iterating
     * @param e mouse event
     * @param objectToAvoid (usually active) object to avoid
     * @return {number}
     * @memberOf fabric.Canvas
     */
    fabric.Canvas.prototype.findNextObjectUnderMouse = function(e, objectToAvoid) {
        const pointer = this.getPointer(e, true);
        //necessary only for groups
            // normalizedPointer = this._normalizePointer(this, pointer);
        let i = this._objects.length;
        while (i--) {
            const object = this._objects[i];

            if (object !== objectToAvoid && this._checkTarget(pointer, object)) {
                return object;
            }
        }
        return null;
    };

    /**
     * Compute more visually-pleasing zoom value for rendering.
     * @memberOf fabric.Canvas
     * @param zoom
     * @return {number}
     */
    fabric.Canvas.prototype.computeGraphicZoom = function (zoom) {
        return Math.sqrt(zoom) / 2;
    };

    if (!window.OpenSeadragon) {
        console.error('[openseadragon-canvas-overlay] requires OpenSeadragon');
        return;
    }

    /**
     * @param {Object} options
     *      Allows configurable properties to be entirely specified by passing
     *      an options object to the constructor.
     * @param {Number} options.scale
     *      Fabric 'virtual' canvas size, for creating objects
     **/
    OpenSeadragon.Viewer.prototype.fabricjsOverlay = function(options) {
        this._fabricjsOverlayInfo = new FabricOverlay(this, options.scale);
        return this._fabricjsOverlayInfo;
    };

    class FabricOverlay {
        constructor(viewer, scale) {
            var self = this;

            this._viewer = viewer;
            this._scale = scale;
            this._containerWidth = 0;
            this._containerHeight = 0;
            this._canvasdiv = document.createElement('div');
            this._canvasdiv.style.position = 'absolute';
            this._canvasdiv.style.left = "0";
            this._canvasdiv.style.top = "0";
            this._canvasdiv.style.width = '100%';
            this._canvasdiv.style.height = '100%';
            this._viewer.canvas.appendChild(this._canvasdiv);
            this._canvas = document.createElement('canvas');


            this._id = 'osd-overlaycanvas-' + counter();
            this._canvas.setAttribute('id', this._id);
            this._canvasdiv.appendChild(this._canvas);
            this._lastZoomUpdate = -99999;
            this.resize();
            this._fabricCanvas = new fabric.Canvas(this._canvas, {
                imageSmoothingEnabled: false,
            });
            // disable fabric selection because default click is tracked by OSD
            this._fabricCanvas.selection = false;

            this._viewer.addHandler('update-viewport', function () {
                self.resize();
                self.resizecanvas();
            });

            this._viewer.addHandler('open', function () {
                self.resize();
                self.resizecanvas(false);
            });
        }

        get canvas() {
            return this._canvas;
        }

        get fabric() {
            return this._fabricCanvas;
        }

        clear() {
            this._fabricCanvas.clearAll();
        }

        resize() {
            if (this._containerWidth !== this._viewer.container.clientWidth) {
                this._containerWidth = this._viewer.container.clientWidth;
                this._canvasdiv.setAttribute('width', this._containerWidth);
                this._canvas.setAttribute('width', this._containerWidth);
            }

            if (this._containerHeight !== this._viewer.container.clientHeight) {
                this._containerHeight = this._viewer.container.clientHeight;
                this._canvasdiv.setAttribute('height', this._containerHeight);
                this._canvas.setAttribute('height', this._containerHeight);
            }
        }

        resizecanvas(updateObjects=true) {
            this._fabricCanvas.setDimensions({width: this._containerWidth, height: this._containerHeight});
            const zoom = this._viewer.viewport._containerInnerSize.x * this._viewer.viewport.getZoom(true) / this._scale;
            this._fabricCanvas.setZoom(zoom);

            //square root will make closer zoom a bit larger (wrt linear scale) -> nicer
            const smallZoom = Math.sqrt(zoom) / 2;
            this._fabricCanvas._objects.forEach(x => {
                x.zooming?.(smallZoom, zoom);
            });
            this._lastZoomUpdate = zoom;

            var viewportOrigin = this._viewer.viewport.viewportToWindowCoordinates(new OpenSeadragon.Point(0, 0));
            var canvasOffset = this._canvasdiv.getBoundingClientRect();
            var pageScroll = OpenSeadragon.getPageScroll();
            this._fabricCanvas.absolutePan(new fabric.Point(
                    canvasOffset.left - viewportOrigin.x + pageScroll.x, //Math.round(viewportOrigin.x);
                    canvasOffset.top - viewportOrigin.y + pageScroll.y
                )
            );

            // Potential rotation logics implementaiton, together with fabric Layers could work....
            // {
            //     var p = this._viewer.viewport.pixelFromPoint(new $.Point(0, 0), true);
            //     let zoom = this._viewer.viewport.getZoom(true);
            //     var rotation = this._viewer.viewport.getRotation();
            //     var flipped = this._viewer.viewport.getFlip();
            //     var containerSizeX = this._viewer.viewport._containerInnerSize.x
            //     var scaleX = containerSizeX * zoom;
            //     var scaleY = scaleX;
            //
            //     if(flipped){
            //         // Makes the x component of the scale negative to flip the svg
            //         scaleX = -scaleX;
            //         // Translates svg back into the correct coordinates when the x scale is made negative.
            //         p.x = -p.x + containerSizeX;
            //     }
            //
            //     this._node.setAttribute('transform',
            //         'translate(' + p.x + ',' + p.y + ') scale(' + scaleX + ',' + scaleY + ') rotate(' + rotation + ')');
            // }

            this._fabricCanvas.renderAll();
            return zoom;
        }
    }

    // static counter for multiple overlays differentiation
    var counter = (function () {
        var i = 1;

        return function () {
            return i++;
        }
    })();
})();
