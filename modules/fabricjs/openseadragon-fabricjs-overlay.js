// OpenSeadragon canvas Overlay plugin 0.0.1 based on svg overlay plugin

(function() {

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
        this._fabricjsOverlayInfo = new FabricOverlay(this);
        this._fabricjsOverlayInfo._scale = options.scale;

        return this._fabricjsOverlayInfo;
    };

    // ----------
    class FabricOverlay {
        constructor(viewer) {
            var self = this;
            this._viewer = viewer;
            this._containerWidth = 0;
            this._containerHeight = 0;
            this._canvasdiv = document.createElement('div');
            this._canvasdiv.style.position = 'absolute';
            this._canvasdiv.style.left = 0;
            this._canvasdiv.style.top = 0;
            this._canvasdiv.style.width = '100%';
            this._canvasdiv.style.height = '100%';
            this._viewer.canvas.appendChild(this._canvasdiv);
            this._canvas = document.createElement('canvas');
            this._id = 'osd-overlaycanvas-' + counter();
            this._canvas.setAttribute('id', this._id);
            this._canvasdiv.appendChild(this._canvas);
            this.resize();
            this._fabricCanvas = new fabric.Canvas(this._canvas);
            // disable fabric selection because default click is tracked by OSD
            this._fabricCanvas.selection = false;
            // prevent OSD click elements on fabric objects
            this._fabricCanvas.on('mouse:down', function (options) {
                if (options.target) {
                    options.e.preventDefaultAction = true;
                    options.e.preventDefault();
                    options.e.stopPropagation();
                }
            });

            this._viewer.addHandler('update-viewport', function () {
                self.resize();
                self.resizecanvas();
            });

            this._viewer.addHandler('open', function () {
                self.resize();
                self.resizecanvas();
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

        resizecanvas() {
            this._fabricCanvas.setDimensions({width: this._containerWidth, height: this._containerHeight});
            this._fabricCanvas.setZoom(
                this._viewer.viewport._containerInnerSize.x * this._viewer.viewport.getZoom(true) / this._scale
            );
            var viewportOrigin = this._viewer.viewport.viewportToWindowCoordinates(new OpenSeadragon.Point(0, 0));
            var canvasOffset = this._canvasdiv.getBoundingClientRect();
            var pageScroll = OpenSeadragon.getPageScroll();
            this._fabricCanvas.absolutePan(new fabric.Point(
                    canvasOffset.left - viewportOrigin.x + pageScroll.x, //Math.round(viewportOrigin.x);
                    canvasOffset.top - viewportOrigin.y + pageScroll.y
                )
            );
            this._fabricCanvas.renderAll();
        }

        set interactive(value) {
            this.disabledInteraction = !value;
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
