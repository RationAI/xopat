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
            this._lastUpdatedZoom = 0; //we usually start zoomed out close to 0
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
            // this._fabricCanvas.setHeight(this._containerHeight);
            // this._fabricCanvas.setWidth(this._containerWidth);
            let zoom = this._viewer.viewport._containerInnerSize.x * this._viewer.viewport.getZoom(true) / this._scale;
            this._fabricCanvas.setZoom(zoom);

            // Update object properties to reflect zoom
            let ratio = 0.01 / this._viewer.tools.imagePixelSizeOnScreen();
            var updater = function(x) {
                if (x.type == "text") {
                    x.set({
                        scaleX: 1/zoom,
                        scaleY: 1/zoom
                    });
                } else {
                    x.set({
                        strokeWidth: x.originalStrokeWidth/zoom
                    });
                }
            }
            this._fabricCanvas._objects.forEach(x => {
                if (x.type === "group") {
                    x._objects.forEach(updater);
                } else {
                    updater(x);
                }
            });

            var viewportOrigin = this._viewer.viewport.viewportToWindowCoordinates(new OpenSeadragon.Point(0, 0));
            var canvasOffset = this._canvasdiv.getBoundingClientRect();
            var pageScroll = OpenSeadragon.getPageScroll();
            this._fabricCanvas.absolutePan(new fabric.Point(
                    canvasOffset.left - viewportOrigin.x + pageScroll.x, //Math.round(viewportOrigin.x);
                    canvasOffset.top - viewportOrigin.y + pageScroll.y
                )
            );

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
