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

    // Fabric Controls rendering was mibehaving when replacing objects.
    // Also: selection visuals (controls + borders + selection background)
    // should follow the annotation's opacity — at opacity 0 they must
    // disappear together with the shape they belong to.
    const _origDrawControls = fabric.Object.prototype.drawControls;
    fabric.Object.prototype.drawControls = function(ctx, styleOverride) {
        if (!this.canvas) return;
        if (this.opacity === 0) return;
        return _origDrawControls.call(this, ctx, styleOverride);
    };
    const _origDrawBorders = fabric.Object.prototype.drawBorders;
    if (typeof _origDrawBorders === 'function') {
        fabric.Object.prototype.drawBorders = function(ctx, styleOverride) {
            if (this.opacity === 0) return this;
            return _origDrawBorders.call(this, ctx, styleOverride);
        };
    }
    const _origDrawSelectionBackground = fabric.Object.prototype.drawSelectionBackground;
    if (typeof _origDrawSelectionBackground === 'function') {
        fabric.Object.prototype.drawSelectionBackground = function(ctx) {
            if (this.opacity === 0) return this;
            return _origDrawSelectionBackground.call(this, ctx);
        };
    }

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

        // Always-on measurement labels: one area/length pill above every
        // individually-rendered annotation (clustered ones are already dropped
        // from `filtered`). Opt-in via the annotations module, and skipped
        // entirely once the visible count exceeds the deployment threshold —
        // that ceiling bounds the per-frame fillText cost. Pure screen-space
        // draw: no fabric object, no group, shapes untouched.
        const mod = idx.wrapper && idx.wrapper.module;
        if (mod && mod._measurementLabelsEnabled
            && filtered.length <= (mod.measurementLabelMaxCount ?? 200)) {
            _drawMeasurementLabels(ctx, this, filtered, mod);
        }
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
        // Cluster pills follow the global annotation opacity, with the same
        // 2× boost (capped at 1.0) used by the per-annotation toolbar pill in
        // modules/annotations/objects.js. At opacity 0 the pills disappear
        // along with the annotations they represent.
        const idx = canvas.__spatialIndex;
        const annOpacity = idx?.wrapper?.module?.presets?.commonAnnotationVisuals?.opacity ?? 1;
        if (annOpacity <= 0) return;
        const pillAlpha = Math.min(1, annOpacity * 2);

        // Reset transform to retina-only; pills are drawn in CSS pixel space
        // so their size stays constant regardless of canvas zoom.
        const retina = (canvas.getRetinaScaling && canvas.getRetinaScaling()) || 1;
        ctx.save();
        ctx.setTransform(retina, 0, 0, retina, 0, 0);
        ctx.globalAlpha *= pillAlpha;

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

    // ── Always-on measurement labels ──────────────────────────────────────
    // A read-only area/length pill centred on each visible annotation when
    // the annotations module has the overlay enabled. Draws in screen space
    // (retina-only transform) like the cluster pills, so the pill size stays
    // constant across zoom and no fabric object is added to the canvas.
    // The selected object is skipped: its metric floats ABOVE the shape via the
    // toolbar pill, keeping the geometry being edited clear.
    const ML_FONT = '600 11px Arial';
    const ML_PAD_X = 6;
    const ML_HEIGHT = 17;
    const ML_RADIUS = ML_HEIGHT / 2;
    const ML_BG = 'rgba(255,255,255,0.92)';
    const ML_FG = '#333';
    const ML_STROKE = 'rgba(0,0,0,0.55)';
    const ML_OPACITY_FACTOR = 2;   // matches the toolbar pill's alpha boost

    /**
     * Label string for one object with a cheap per-object cache. Recomputed only
     * when a lightweight geometry token changes (bbox + point/path count), so a
     * static polygon does not re-run its area math every frame; an edited shape
     * refreshes because its bbox changes. Always-fresh while an object is being
     * actively transformed (its bbox moves each frame).
     */
    function _measurementLabelFor(mod, obj) {
        const token = obj.factoryID + '|'
            + Math.round((obj.width || 0) * (obj.scaleX || 1)) + '|'
            + Math.round((obj.height || 0) * (obj.scaleY || 1)) + '|'
            + (obj.points ? obj.points.length : 0) + '|'
            + (obj.path ? obj.path.length : 0);
        const cached = obj.__mLabel;
        if (cached && cached.token === token) return cached.text;
        const text = mod.getMeasurementLabel(obj) || '';
        obj.__mLabel = { token, text };
        return text;
    }

    /**
     * Tint for one object with a per-object cache keyed by its colour: the tint
     * is a string parse + arithmetic, and this runs for every labelled object on
     * every frame. Invalidates when the preset colour changes.
     */
    function _labelTintFor(mod, obj) {
        if (!mod.getLabelTint) return null;
        const cached = obj.__mTint;
        if (cached && cached.color === obj.color) return cached.tint;
        const tint = mod.getLabelTint(obj);
        obj.__mTint = { color: obj.color, tint };
        return tint;
    }

    function _drawMeasurementLabels(ctx, canvas, objects, mod) {
        const idx = canvas.__spatialIndex;
        const annOpacity = idx?.wrapper?.module?.presets?.commonAnnotationVisuals?.opacity ?? 1;
        if (annOpacity <= 0) return;
        const alpha = Math.min(1, annOpacity * ML_OPACITY_FACTOR);

        const active = canvas.getActiveObject && canvas.getActiveObject();

        const retina = (canvas.getRetinaScaling && canvas.getRetinaScaling()) || 1;
        ctx.save();
        ctx.setTransform(retina, 0, 0, retina, 0, 0);
        ctx.globalAlpha *= alpha;
        ctx.font = ML_FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        for (let i = 0; i < objects.length; i++) {
            const obj = objects[i];
            // Selected object already shows its metric in the toolbar pill.
            // Types that carry their own on-canvas text or whose extent is
            // meaningless opt out via the factory's supportsMeasurements(),
            // which getMeasurementLabel already honours (empty text below).
            if (obj === active) continue;

            const text = _measurementLabelFor(mod, obj);
            if (!text) continue;

            // Centred on the OBB: rotation-invariant, and unambiguous about
            // which shape the metric belongs to.
            const c = obj.calcLineCoords();
            const cx = (c.tl.x + c.br.x) / 2;
            const cy = (c.tl.y + c.br.y) / 2;

            const textW = ctx.measureText(text).width;
            const w = textW + ML_PAD_X * 2;
            const x = cx - w / 2;
            const y = cy - ML_HEIGHT / 2;
            const r = ML_RADIUS;

            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.arcTo(x + w, y, x + w, y + r, r);
            ctx.lineTo(x + w, y + ML_HEIGHT - r);
            ctx.arcTo(x + w, y + ML_HEIGHT, x + w - r, y + ML_HEIGHT, r);
            ctx.lineTo(x + r, y + ML_HEIGHT);
            ctx.arcTo(x, y + ML_HEIGHT, x, y + ML_HEIGHT - r, r);
            ctx.lineTo(x, y + r);
            ctx.arcTo(x, y, x + r, y, r);
            ctx.closePath();
            // Same preset-colour wash the toolbar pill uses, so a label reads as
            // belonging to its shape. Falls back to the neutral chrome when the
            // object has no resolvable colour.
            const tint = _labelTintFor(mod, obj);
            ctx.fillStyle = tint ? tint.fill : ML_BG;
            ctx.fill();
            ctx.strokeStyle = tint ? tint.stroke : ML_STROKE;
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = ML_FG;
            ctx.fillText(text, x + ML_PAD_X, cy);
        }

        ctx.restore();
    }

    // ── Precise geometric hit-test (narrow phase) ─────────────────────────
    // The rbush spatial index gives us a viewport-pruned, bbox-passing
    // candidate set in O(log n). Fabric's stock _checkTarget then runs an
    // oriented-bounding-box test (`Canvas.containsPoint` → `_normalizePointer`
    // → `Object.containsPoint` against oCoords). That's enough for rectangles
    // and text, but overlapping polygons / ellipses get mis-selected whenever
    // the click lands inside one shape's bbox yet outside its actual outline.
    //
    // The narrow phase below adds a pure-JS geometry test (`__preciseContains`)
    // and WRAPS `_checkTarget` to call it AFTER fabric's bbox check passes.
    // Crucial design point: we do NOT replace `_searchPossibleTargets` (an
    // earlier version did, but bypassed fabric's `_normalizePointer` and
    // therefore broke coord-space alignment → no clicks selected anything).
    // Letting fabric's per-object loop run first means we inherit its
    // visible/evented/group-composition/vpt handling for free; we only refine
    // its acceptance decision on geometry.
    //
    // No offscreen render (fabric's `perPixelTargetFind` would do that);
    // typical cost at one click is a few µs across tens of candidates, well
    // under one frame even at 10k+ annotations on the canvas.

    function _rayCastInPolygon(px, py, points) {
        // Odd-even rule. Points are in object-local coords; pre-adjusted by
        // caller for fabric's pathOffset so they match obj.points layout.
        let inside = false;
        const n = points.length;
        if (n < 3) return false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = points[i].x, yi = points[i].y;
            const xj = points[j].x, yj = points[j].y;
            const intersects = ((yi > py) !== (yj > py))
                && (px < (xj - xi) * (py - yi) / (yj - yi || 1e-12) + xi);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    fabric.Canvas.prototype.__preciseContains = function (obj, pointer) {
        if (!obj) return true;
        // Opt-out hatch for shapes that want bbox semantics (no factory uses
        // it today; documented for future per-factory tuning).
        if (obj.__skipPreciseHit) return true;

        // `_normalizePointer` composes: invertTransform(vpt) → invertTransform(
        //   obj.calcTransformMatrix()). The returned point is in the object's
        //   local coord system with origin at the object's CENTER — the same
        //   space fabric renders into. We do NOT roll our own inverse-matrix
        //   math here: the prior round did, and bypassing _normalizePointer
        //   skipped the VPT inversion, which broke every hit-test under any
        //   non-identity viewport transform.
        let local;
        try {
            local = this._normalizePointer(obj, pointer);
        } catch (e) {
            return true; // can't normalize → defer to bbox decision fabric already made
        }
        const type = obj.type;

        try {
            // Polygon / polyline — odd-even ray-cast on obj.points.
            // Rendered points sit at (p.x - pathOffset.x, p.y - pathOffset.y)
            // in the centered local space, so equivalently we test the local
            // pointer plus pathOffset against the raw obj.points array.
            if ((type === 'polygon' || type === 'polyline') && Array.isArray(obj.points)) {
                const offX = obj.pathOffset ? obj.pathOffset.x : 0;
                const offY = obj.pathOffset ? obj.pathOffset.y : 0;
                return _rayCastInPolygon(local.x + offX, local.y + offY, obj.points);
            }
            // Ellipse — closed-form, centered.
            if (type === 'ellipse') {
                const rx = obj.rx || 0, ry = obj.ry || 0;
                if (rx <= 0 || ry <= 0) return true;
                const dx = local.x / rx, dy = local.y / ry;
                return dx * dx + dy * dy <= 1;
            }
            // Circle — closed-form, centered.
            if (type === 'circle') {
                const r = obj.radius || 0;
                if (r <= 0) return true;
                return local.x * local.x + local.y * local.y <= r * r;
            }
            // Rect — AABB centered at local (0,0).
            if (type === 'rect') {
                const w = (obj.width || 0) / 2, h = (obj.height || 0) / 2;
                return Math.abs(local.x) <= w && Math.abs(local.y) <= h;
            }
            // Group / activeSelection — bbox already passed; keep current
            // "group hit = group selected" behavior. (Fabric's own sub-target
            // discovery handles inner-child selection when subTargetCheck is
            // enabled — we don't pre-empt that.)
            if ((type === 'group' || type === 'activeSelection') && Array.isArray(obj._objects)) {
                return true;
            }
        } catch (e) {
            // Defensive: if any geometry test trips, fall back to the bbox
            // pass we already had. Better to select-by-bbox than to silently
            // swallow every click on a buggy shape type.
            console.warn('[precise hit-test] geometry test threw; falling back to bbox.', e);
            return true;
        }
        // Unknown / non-geometric (text, image, path, …) — bbox was already
        // accepted by fabric; keep that decision.
        return true;
    };

    // Wrap `_checkTarget` to add the geometric narrow-phase AFTER fabric's
    // bbox-based bbox/visible/evented gate. This way our code never has to
    // touch the visible/evented/group/vpt coord-space conversions — fabric
    // already did them — we just refine the boolean it would have returned.
    const _origCheckTarget = fabric.Canvas.prototype._checkTarget;
    fabric.Canvas.prototype._checkTarget = function (pointer, obj) {
        const passedBbox = _origCheckTarget.call(this, pointer, obj);
        if (!passedBbox) return passedBbox;
        if (!this.__spatialIndex) return passedBbox;
        return this.__preciseContains(obj, pointer);
    };

    const _origSearchPossibleTargets = fabric.Canvas.prototype._searchPossibleTargets;
    fabric.Canvas.prototype._searchPossibleTargets = function (objects, pointer) {
        const idx = this.__spatialIndex;
        if (!idx) return _origSearchPossibleTargets.call(this, objects, pointer);

        const realCandidates = idx.realCandidates(this.vptCoords, this);

        // refresh per-object: only the candidates that can actually be hit.
        // ensureFresh also handles the lazy oCoords resync (F2) so the
        // wrapped _checkTarget above sees current screen-space coords.
        for (let i = 0; i < realCandidates.length; i++) idx.ensureFresh(realCandidates[i]);

        // Hand off to fabric's original loop, which iterates in reverse
        // z-order, calls our wrapped _checkTarget on each, and stops at the
        // first hit. Cluster pills are render-only; clicks pass through to
        // whatever fabric finds beneath them (or to OSD when nothing hits).
        return _origSearchPossibleTargets.call(this, realCandidates, pointer);
    };

    // Precise companion to `findNextObjectUnderMouse` — drives Alt+click
    // and double-click cycling through stacks of overlapping annotations.
    // Pulls from the spatial index when present so cycle cost stays at
    // O(visible) rather than O(total). Uses _checkTarget (which now embeds
    // the precise test) so each candidate is checked the same way the
    // single-click path checks it.
    fabric.Canvas.prototype.findNextObjectUnderMousePrecise = function (pointer, objectToAvoid) {
        const idx = this.__spatialIndex;
        const pool = idx ? idx.realCandidates(this.vptCoords, this) : this._objects;
        for (let i = pool.length - 1; i >= 0; i--) {
            const obj = pool[i];
            if (obj !== objectToAvoid && this._checkTarget(pointer, obj)) return obj;
        }
        return null;
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
