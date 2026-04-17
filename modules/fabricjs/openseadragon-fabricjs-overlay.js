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

    fabric.Path.prototype.toObject = function(propertiesToInclude) {
        propertiesToInclude = propertiesToInclude || [];
        if (!propertiesToInclude.includes('points')) propertiesToInclude.push('points');

        const data = this.callSuper('toObject', propertiesToInclude);
        return data;
    };

    // Fabric Controls rendering was mibehaving when replacing objects
    const _origDrawControls = fabric.Object.prototype.drawControls;
    fabric.Object.prototype.drawControls = function(ctx, styleOverride) {
        if (!this.canvas)  return;
        return _origDrawControls.call(this, ctx, styleOverride);
    };

    /**
     * Find object under mouse by iterating
     * @param pointer image coords
     * @param objectToAvoid (usually active) object to avoid
     * @return {number}
     * @memberOf fabric.Canvas
     */
    fabric.Canvas.prototype.findNextObjectUnderMouse = function(pointer, objectToAvoid) {
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
     * @param zoom zoom value, if undefined it gets the current zoom
     * @return {number}
     */
    fabric.Canvas.prototype.computeGraphicZoom = function(zoom = undefined) {
        let effectiveZoom = zoom;
        if (this.__osdViewportScale !== undefined) {
            effectiveZoom = this.__osdViewportScale;
        } else if (effectiveZoom === undefined) {
            const vpt = this.viewportTransform;
            if (Array.isArray(vpt) && vpt.length >= 2) {
                effectiveZoom = Math.sqrt((vpt[0] * vpt[0]) + (vpt[1] * vpt[1]));
            } else {
                effectiveZoom = this.getZoom();
            }
        }
        return Math.sqrt(effectiveZoom) / 2;
    };

    // Force Fabric visibility checks to recalculate object coords when needed.
// This helps with zoom-driven / stroke-width-driven false negatives.
    const _origIsOnScreen = fabric.Object.prototype.isOnScreen;
    fabric.Object.prototype.isOnScreen = function(calculate = true) {
        return _origIsOnScreen.call(this, calculate);
    };

    if (fabric.Object.prototype.isPartiallyOnScreen) {
        const _origIsPartiallyOnScreen = fabric.Object.prototype.isPartiallyOnScreen;
        fabric.Object.prototype.isPartiallyOnScreen = function(calculate = true) {
            return _origIsPartiallyOnScreen.call(this, calculate);
        };
    }

// Fabric's default calcViewportBoundaries assumes a non-rotated viewport.
// For rotated OSD->Fabric viewportTransform, compute all 4 inverse-mapped corners
// and store an axis-aligned bounding box that fully contains the rotated viewport.
// This is conservative: it may render a few extra objects, but it should not hide visible ones.
    fabric.StaticCanvas.prototype.calcViewportBoundaries = function() {
        const width = this.width;
        const height = this.height;
        const invVpt = fabric.util.invertTransform(this.viewportTransform);

        const pTL = fabric.util.transformPoint(new fabric.Point(0, 0), invVpt);
        const pTR = fabric.util.transformPoint(new fabric.Point(width, 0), invVpt);
        const pBL = fabric.util.transformPoint(new fabric.Point(0, height), invVpt);
        const pBR = fabric.util.transformPoint(new fabric.Point(width, height), invVpt);

        const minX = Math.min(pTL.x, pTR.x, pBL.x, pBR.x);
        const minY = Math.min(pTL.y, pTR.y, pBL.y, pBR.y);
        const maxX = Math.max(pTL.x, pTR.x, pBL.x, pBR.x);
        const maxY = Math.max(pTL.y, pTR.y, pBL.y, pBR.y);

        this.vptCoords = {
            tl: new fabric.Point(minX, minY),
            tr: new fabric.Point(maxX, minY),
            bl: new fabric.Point(minX, maxY),
            br: new fabric.Point(maxX, maxY),

            // keep the real rotated corners too, in case you want them later
            corners: {
                tl: pTL,
                tr: pTR,
                bl: pBL,
                br: pBR,
            }
        };

        return this.vptCoords;
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
                fireRightClick: true,
            });
            // disable fabric selection because default click is tracked by OSD
            this._fabricCanvas.selection = false;
            this._fabricCanvas.__osdViewportScale = 1;

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

        _getReferencedTiledImage() {
            return this._viewer.scalebar?.getReferencedTiledImage?.() || this._viewer.world?.getItemAt?.(0);
        }

        _imageToViewerElementCoordinates(tiledImage, imagePoint) {
            if (!tiledImage) return null;

            // image pixel coords -> viewport coords -> viewer element pixel coords
            const viewportPoint = tiledImage.imageToViewportCoordinates(imagePoint);
            return this._viewer.viewport.pixelFromPoint(viewportPoint, true);
        }

        _computeFabricViewportTransform() {
            const tiledImage = this._getReferencedTiledImage();
            if (!tiledImage) return null;

            // derive full affine transform from three image-space basis points
            const origin = this._imageToViewerElementCoordinates(
                tiledImage,
                new OpenSeadragon.Point(0, 0)
            );
            const basisX = this._imageToViewerElementCoordinates(
                tiledImage,
                new OpenSeadragon.Point(1, 0)
            );
            const basisY = this._imageToViewerElementCoordinates(
                tiledImage,
                new OpenSeadragon.Point(0, 1)
            );

            if (!origin || !basisX || !basisY) return null;

            const a = basisX.x - origin.x;
            const b = basisX.y - origin.y;
            const c = basisY.x - origin.x;
            const d = basisY.y - origin.y;
            const e = origin.x;
            const f = origin.y;
            const uniformScale = Math.sqrt((a * a) + (b * b));

            return {
                matrix: [a, b, c, d, e, f],
                zoom: uniformScale,
            };
        }

        resizecanvas(updateObjects = true) {
            this._fabricCanvas.setDimensions({
                width: this._containerWidth,
                height: this._containerHeight
            });
            this._fabricCanvas.calcOffset();

            const transform = this._computeFabricViewportTransform();
            if (!transform) {
                this._fabricCanvas.renderAll();
                return 1;
            }

            const zoom = transform.zoom;
            this._fabricCanvas.__osdViewportScale = zoom;
            this._fabricCanvas.setViewportTransform(transform.matrix);

            // square root will make closer zoom a bit larger -> nicer
            const smallZoom = Math.sqrt(zoom) / 2;
            if (updateObjects !== false) {
                this._fabricCanvas._objects.forEach(x => {
                    x.zooming?.(smallZoom, zoom);
                });
            }
            this._lastZoomUpdate = zoom;

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
