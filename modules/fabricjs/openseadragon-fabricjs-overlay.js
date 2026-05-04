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
    // ---------- spatial index hooks ----------------------------------------------------------
    // The annotations module attaches an AnnotationSpatialIndex instance as
    // `canvas.__spatialIndex`. The patches below detour fabric's hot paths through that index
    // when present, and fall through to the original implementation otherwise. This keeps
    // unrelated fabric canvases (other modules) untouched.

    const _origOnObjectAdded = fabric.Canvas.prototype._onObjectAdded;
    fabric.Canvas.prototype._onObjectAdded = function (obj) {
        const r = _origOnObjectAdded.call(this, obj);
        const idx = this.__spatialIndex;
        if (idx) idx.add(obj);
        return r;
    };

    const _origOnObjectRemoved = fabric.Canvas.prototype._onObjectRemoved;
    fabric.Canvas.prototype._onObjectRemoved = function (obj) {
        const r = _origOnObjectRemoved.call(this, obj);
        const idx = this.__spatialIndex;
        if (idx) idx.remove(obj);
        return r;
    };

    const _origSetCoords = fabric.Object.prototype.setCoords;
    fabric.Object.prototype.setCoords = function (skipCorners) {
        const r = _origSetCoords.call(this, skipCorners);
        const idx = this.canvas && this.canvas.__spatialIndex;
        // Skip our index update when this setCoords is the lazy resync from
        // ensureFresh (see spatial-index.js). Image-space bbox is a function
        // of object geometry only — viewport transform changes don't affect
        // the rbush entry.
        if (idx && this._idxBox && !idx._silentSetCoords) idx.update(this);
        return r;
    };

    // ----- F1: bypass per-object setCoords loop in setViewportTransform -------
    // fabric's own setViewportTransform iterates _objects and calls
    // setCoords(true) on every one. With 50k annotations that's the dominant
    // per-frame cost. The expensive aCoords/lineCoords are image-space — they
    // don't change when only the viewport moves. We do everything fabric does
    // EXCEPT the per-object loop, then bump idx.setCoordsVersion so the
    // lazy resync in ensureFresh refreshes oCoords for visible items only.
    const _origSetVptTransform = fabric.Canvas.prototype.setViewportTransform;
    fabric.Canvas.prototype.setViewportTransform = function (vpt) {
        const idx = this.__spatialIndex;
        if (!idx) return _origSetVptTransform.call(this, vpt);

        this.viewportTransform = vpt;
        if (this._activeObject) this._activeObject.setCoords();
        if (this.backgroundImage) this.backgroundImage.setCoords(true);
        if (this.overlayImage) this.overlayImage.setCoords(true);
        this.calcViewportBoundaries();
        idx.bumpSetCoords();
        if (this.renderOnAddRemove) this.requestRenderAll();
        return this;
    };

    const _origRenderObjects = fabric.Canvas.prototype._renderObjects;
    fabric.Canvas.prototype._renderObjects = function (ctx, objects) {
        const idx = this.__spatialIndex;
        if (!idx) return _origRenderObjects.call(this, ctx, objects);

        // Always cluster. Consume fabric's `objects` in the order it provided
        // (preserves active-object reordering from _chooseObjectsToRender),
        // dropping anything our cluster computation wants to render as a pill
        // instead. Falls back to our own visible set when fabric passed none.
        const realCandidates = idx.realCandidates(this.vptCoords, this);
        let filtered;
        if (objects) {
            const realSet = new Set(realCandidates);
            filtered = objects.filter(o => realSet.has(o));
        } else {
            filtered = realCandidates;
        }
        const { rects } = idx.clusters(this.vptCoords, this);

        // lazy-refresh per-object before draw (cheap when nothing changed)
        for (let i = 0; i < filtered.length; i++) idx.ensureFresh(filtered[i]);

        _origRenderObjects.call(this, ctx, filtered);

        if (rects && rects.length) _drawClusters(ctx, this, rects);
    };

    // Cluster pill style (all values in CSS pixels — drawn in screen space).
    const PILL_PAD_X = 8;
    const PILL_PAD_Y = 4;
    const PILL_RADIUS = 8;
    const PILL_FONT_COUNT = '600 12px system-ui, -apple-system, Segoe UI, sans-serif';
    const PILL_FONT_SUFFIX = '500 9px system-ui, -apple-system, Segoe UI, sans-serif';
    const PILL_BG = 'rgba(30, 41, 59, 0.92)';
    const PILL_FG = '#fff';
    const PILL_SHADOW = 'rgba(0,0,0,0.4)';
    const PILL_GAP_AFTER_ICON = 5;
    const PILL_ROW_GAP = 1;
    const PILL_ICON_W = 12;
    const PILL_ICON_H = 11;
    const PILL_TOP_ROW_H = 14;
    const PILL_BOTTOM_ROW_H = 11;
    const PILL_SUFFIX_TEXT = 'annot.';

    function _formatClusterCount(n) {
        if (n > 9999) return '9.9k+';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
        return String(n);
    }

    /**
     * Draws an irregular pentagon outline (suggestive of a hand-drawn polygon
     * annotation) inside a 12x11 box anchored at (x, y) top-left.
     */
    function _drawClusterPolygonIcon(ctx, x, y) {
        // 5 vertices in a 12x11 grid; offsets chosen to look hand-drawn rather than regular
        const pts = [
            [x +  3, y +  1],
            [x + 11, y +  3],
            [x +  9, y + 10],
            [x +  3, y +  9],
            [x +  1, y +  4],
        ];
        ctx.save();
        ctx.lineWidth = 1.4;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = PILL_FG;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }

    // Per-frame cluster pill rendering used to dominate Skia: each pill
    // re-rasterized a shadow-blurred rounded rect + 2 fillText calls + a
    // stroked polygon icon. With many pills × every frame this filled the
    // GPU pipe and could hang the renderer process.
    //
    // Mitigation: render each unique pill once into an offscreen canvas
    // keyed by the displayed label, then drawImage on every frame. Cache
    // size is bounded — only ~30 distinct labels exist
    // (count buckets + "9.9k+" cap).
    const _pillCache = new Map();   // label -> {bitmap, w, h}
    const _PILL_CACHE_MAX = 64;

    function _renderPillBitmap(label) {
        // Measure on a temp ctx to know the final pill size.
        const measureCanvas = document.createElement('canvas');
        const m = measureCanvas.getContext('2d');
        m.font = PILL_FONT_COUNT;
        const labelW = m.measureText(label).width;
        m.font = PILL_FONT_SUFFIX;
        const suffixW = m.measureText(PILL_SUFFIX_TEXT).width;

        const topRowW = PILL_ICON_W + PILL_GAP_AFTER_ICON + labelW;
        const contentW = Math.max(topRowW, suffixW);
        const contentH = PILL_TOP_ROW_H + PILL_ROW_GAP + PILL_BOTTOM_ROW_H;

        const pillW = contentW + PILL_PAD_X * 2;
        const pillH = contentH + PILL_PAD_Y * 2;

        // Pad bitmap to accommodate the shadow.
        const SHADOW_PAD = 12;
        const bw = Math.ceil(pillW + SHADOW_PAD * 2);
        const bh = Math.ceil(pillH + SHADOW_PAD * 2);

        const bmp = document.createElement('canvas');
        bmp.width = bw;
        bmp.height = bh;
        const bctx = bmp.getContext('2d');

        const x = SHADOW_PAD;
        const y = SHADOW_PAD;

        // Shadowed background
        bctx.save();
        bctx.shadowColor = PILL_SHADOW;
        bctx.shadowBlur = 6;
        bctx.shadowOffsetY = 1;
        bctx.fillStyle = PILL_BG;
        bctx.beginPath();
        const r = Math.min(PILL_RADIUS, pillH * 0.5);
        bctx.moveTo(x + r, y);
        bctx.arcTo(x + pillW, y,         x + pillW, y + pillH, r);
        bctx.arcTo(x + pillW, y + pillH, x,         y + pillH, r);
        bctx.arcTo(x,         y + pillH, x,         y,         r);
        bctx.arcTo(x,         y,         x + pillW, y,         r);
        bctx.closePath();
        bctx.fill();
        bctx.restore();

        const topRowX = x + Math.round((pillW - topRowW) * 0.5);
        const topRowMidY = y + PILL_PAD_Y + PILL_TOP_ROW_H * 0.5;
        const iconY = Math.round(topRowMidY - PILL_ICON_H * 0.5);
        _drawClusterPolygonIcon(bctx, topRowX, iconY);

        bctx.fillStyle = PILL_FG;
        bctx.textBaseline = 'middle';
        bctx.textAlign = 'left';
        bctx.font = PILL_FONT_COUNT;
        bctx.fillText(label, topRowX + PILL_ICON_W + PILL_GAP_AFTER_ICON, topRowMidY);

        const bottomMidY = y + PILL_PAD_Y + PILL_TOP_ROW_H + PILL_ROW_GAP + PILL_BOTTOM_ROW_H * 0.5;
        bctx.font = PILL_FONT_SUFFIX;
        bctx.textAlign = 'center';
        bctx.fillStyle = 'rgba(255,255,255,0.85)';
        bctx.fillText(PILL_SUFFIX_TEXT, x + pillW * 0.5, bottomMidY);

        return { bitmap: bmp, w: bw, h: bh, anchorX: bw * 0.5, anchorY: bh * 0.5 };
    }

    function _getPillBitmap(label) {
        let entry = _pillCache.get(label);
        if (entry) return entry;
        entry = _renderPillBitmap(label);
        if (_pillCache.size >= _PILL_CACHE_MAX) {
            // simple FIFO eviction
            const firstKey = _pillCache.keys().next().value;
            _pillCache.delete(firstKey);
        }
        _pillCache.set(label, entry);
        return entry;
    }

    function _drawClusters(ctx, canvas, rects) {
        // Reset transform to retina-only; pills are drawn in CSS pixel space
        // so their size stays constant regardless of canvas zoom.
        const retina = (canvas.getRetinaScaling && canvas.getRetinaScaling()) || 1;
        ctx.save();
        ctx.setTransform(retina, 0, 0, retina, 0, 0);

        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            const s = r.screen;
            if (!s) continue;
            const label = _formatClusterCount(r.count);
            const pill = _getPillBitmap(label);
            const cx = s.x + s.w * 0.5;
            const cy = s.y + s.h * 0.5;
            ctx.drawImage(pill.bitmap, Math.round(cx - pill.anchorX), Math.round(cy - pill.anchorY));
        }

        ctx.restore();
    }

    const _origSearchPossibleTargets = fabric.Canvas.prototype._searchPossibleTargets;
    fabric.Canvas.prototype._searchPossibleTargets = function (objects, pointer) {
        const idx = this.__spatialIndex;
        if (!idx) return _origSearchPossibleTargets.call(this, objects, pointer);

        const realCandidates = idx.realCandidates(this.vptCoords, this);

        // refresh per-object: only the candidates that can actually be hit.
        // ensureFresh also handles the lazy oCoords resync (F2) so fabric's
        // containsPoint check below sees current screen-space coords.
        for (let i = 0; i < realCandidates.length; i++) idx.ensureFresh(realCandidates[i]);

        return _origSearchPossibleTargets.call(this, realCandidates, pointer);
        // Cluster pills are render-only; clicks pass through to whatever fabric
        // finds beneath them (or to OSD viewport when nothing is hit).
    };

    fabric.Canvas.prototype._visibleObjects = function () {
        const idx = this.__spatialIndex;
        return idx ? idx.visibleObjects(this.vptCoords, this) : this._objects;
    };

    // ----- selection-aware cluster invalidation ------------------------------
    // The spatial index's clusters() call exempts canvas._activeObject (and
    // active-selection members + isHighlight helpers) so the user never loses
    // sight of what they're selecting / editing / creating. Cluster results
    // are cached per (vpt, members, selection) — bump selectionVersion at the
    // two low-level fabric hooks that mutate _activeObject so the next render
    // recomputes with the new exempt set.
    const _origSetActiveObject = fabric.Canvas.prototype._setActiveObject;
    fabric.Canvas.prototype._setActiveObject = function (t, e) {
        const r = _origSetActiveObject.call(this, t, e);
        const idx = this.__spatialIndex;
        if (idx) idx.bumpSelection();
        return r;
    };

    const _origDiscardActiveObject = fabric.Canvas.prototype._discardActiveObject;
    fabric.Canvas.prototype._discardActiveObject = function (e, t) {
        const r = _origDiscardActiveObject.call(this, e, t);
        const idx = this.__spatialIndex;
        if (idx) idx.bumpSelection();
        return r;
    };

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
            const canvas = this._fabricCanvas;
            canvas.__osdViewportScale = zoom;
            canvas.setViewportTransform(transform.matrix);

            // square root will make closer zoom a bit larger -> nicer
            const smallZoom = Math.sqrt(zoom) / 2;
            canvas.__lastSmallZoom = smallZoom;
            canvas.__lastRealZoom = zoom;

            const idx = canvas.__spatialIndex;
            const zoomChanged = zoom !== this._lastZoomUpdate;
            if (zoomChanged && idx) idx.bumpZoom();

            if (updateObjects !== false && zoomChanged) {
                // only iterate the visible set; off-screen objects refresh lazily on entry
                const list = idx ? idx.visibleObjects(canvas.vptCoords, canvas) : canvas._objects;
                for (let i = 0; i < list.length; i++) list[i].zooming?.(smallZoom, zoom);
            }
            this._lastZoomUpdate = zoom;

            canvas.renderAll();
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
