/**
 * AnnotationSpatialIndex
 *
 * R-tree-backed spatial index for the annotations module.
 *
 * Responsibilities:
 *   - O(log n) viewport queries instead of O(n) iteration over canvas._objects.
 *   - Render-only cluster placeholders when many small annotations crowd a screen cell.
 *   - Lazy per-object refresh of visuals / zoom-driven props / filter state, driven by
 *     monotonic version counters bumped from FabricWrapper.
 *
 * Dependency: a global `RBush` constructor (the user wires it in separately). The
 * fabric prototype patches that consume this index live in
 * modules/fabricjs/openseadragon-fabricjs-overlay.js — they read
 * `canvas.__spatialIndex` and no-op when absent.
 */
(function () {
    if (typeof window.RBush !== 'function') {
        console.error('[annotations/spatial-index] RBush global is missing — annotations spatial index disabled.');
        return;
    }
    const RBush = window.RBush;

    const DEFAULTS = {
        clusterMinCellPx: 100,        // smallest screen cell at which a cluster emits
        clusterMaxItemFactor: 1.5,    // items up to this many cells in either dimension are still cluster-eligible; items truly oversized (>= factor * cell) always render individually
        clusterMinThreshold: 20,      // a cell with > this many cluster-eligible members becomes a pill
        clusterMaxDepth: 8,           // safety cap on recursion depth (image bbox halved 8 times = 256x256 grid)
        oversizedAreaRatio: 0.5,      // bbox area > this * slide area => oversized bucket
        moveEpsilonPx: 1,             // bbox shift threshold below which update() no-ops
        maxRenderedReal: 800          // hard cap: if the would-be unclustered set exceeds this even at max zoom, keep clustering on. Bounds Skia per-frame work so dense scenes can't crash the renderer.
    };

    class AnnotationSpatialIndex {
        constructor(wrapper, options = {}) {
            this.wrapper = wrapper;
            this.options = Object.assign({}, DEFAULTS, options);

            this._tree = new RBush();
            this._oversized = [];
            this._dirty = new Set();          // objects mid-drag, treated as always visible
            this._oversizedThreshold = 0;     // computed at first add when slide size known
            this._size = 0;                   // O(1) member count

            // monotonic version counters; objects carry their own snapshot
            this.visualsVersion = 1;
            this.zoomVersion = 1;
            this.filtersVersion = 1;
            this.setCoordsVersion = 1;        // bumped whenever fabric viewport transform changes
            this.selectionVersion = 1;        // bumped whenever the canvas active object changes

            // cached visible-set, invalidated when transform or membership changes
            this._cache = null;

            // Set during ensureFresh's `setCoords` resync so the setCoords
            // prototype patch can skip our index update (image-space bbox
            // doesn't change with viewport transform).
            this._silentSetCoords = false;
        }

        attachTo(canvas) {
            this.canvas = canvas;
            canvas.__spatialIndex = this;
            return this;
        }

        // ---------- mutations ----------

        _bbox(obj) {
            const r = obj.getBoundingRect(true, true);
            return {
                minX: r.left,
                minY: r.top,
                maxX: r.left + r.width,
                maxY: r.top + r.height,
                _obj: obj
            };
        }

        _isOversized(box) {
            if (!this._oversizedThreshold) return false;
            const area = (box.maxX - box.minX) * (box.maxY - box.minY);
            return area >= this._oversizedThreshold;
        }

        _ensureSlideThreshold() {
            if (this._oversizedThreshold) return;
            const wrapper = this.wrapper;
            const tiledImage = wrapper?.viewer?.scalebar?.getReferencedTiledImage?.()
                || wrapper?.viewer?.world?.getItemAt?.(0);
            const w = tiledImage?.source?.dimensions?.x
                || tiledImage?.source?.Image?.Size?.Width
                || 0;
            const h = tiledImage?.source?.dimensions?.y
                || tiledImage?.source?.Image?.Size?.Height
                || 0;
            if (w > 0 && h > 0) {
                this._oversizedThreshold = w * h * this.options.oversizedAreaRatio;
                this._slideBox = { minX: 0, minY: 0, maxX: w, maxY: h };
            }
        }

        /**
         * Image-space root rect for the cluster recursion. Prefers the slide bbox
         * (anchors cells to the actual canvas regardless of currently-loaded items);
         * falls back to the rbush extent when the slide can't be resolved.
         */
        _getClusterRoot() {
            this._ensureSlideThreshold();
            if (this._slideBox) return this._slideBox;
            // fallback: rbush root extent
            const root = this._tree?.toJSON?.();
            if (root && Number.isFinite(root.minX) && Number.isFinite(root.maxX)) {
                return {
                    minX: root.minX, minY: root.minY,
                    maxX: root.maxX, maxY: root.maxY
                };
            }
            return null;
        }

        add(obj) {
            if (!obj || obj._idxBox) return;
            this._ensureSlideThreshold();
            const box = this._bbox(obj);
            obj._idxBox = box;
            if (obj.coversAll === true || this._isOversized(box)) {
                obj._idxOversized = true;
                this._oversized.push(obj);
            } else {
                obj._idxOversized = false;
                this._tree.insert(box);
            }
            this._size++;
            this._cache = null;
        }

        remove(obj) {
            if (!obj || !obj._idxBox) return;
            if (obj._idxOversized) {
                const i = this._oversized.indexOf(obj);
                if (i >= 0) this._oversized.splice(i, 1);
            } else {
                this._tree.remove(obj._idxBox);
            }
            obj._idxBox = null;
            obj._idxOversized = false;
            this._dirty.delete(obj);
            if (this._size > 0) this._size--;
            this._cache = null;
        }

        update(obj) {
            if (!obj) return;
            if (!obj._idxBox) {
                this.add(obj);
                return;
            }
            const next = this._bbox(obj);
            const prev = obj._idxBox;
            const eps = this.options.moveEpsilonPx;
            if (Math.abs(prev.minX - next.minX) < eps &&
                Math.abs(prev.minY - next.minY) < eps &&
                Math.abs(prev.maxX - next.maxX) < eps &&
                Math.abs(prev.maxY - next.maxY) < eps) {
                return;
            }
            // remove + reinsert (oversized bucket may flip)
            this.remove(obj);
            this.add(obj);
        }

        markDirty(obj) {
            if (obj) this._dirty.add(obj);
        }

        clearDirty() {
            this._dirty.clear();
            this._cache = null;
        }

        clear() {
            this._tree.clear();
            this._oversized.length = 0;
            this._dirty.clear();
            this._size = 0;
            this._cache = null;
        }

        size() {
            return this._size;
        }

        // ---------- queries ----------

        invalidateVisibleCache() {
            this._cache = null;
        }

        /**
         * Returns objects intersecting the viewport bbox, in canvas z-order.
         * @param {object} vptCoords fabric.Canvas#vptCoords (axis-aligned tl/br points in image space)
         * @param {fabric.Canvas} canvas needed to recover z-order from canvas._objects
         */
        visibleObjects(vptCoords, canvas) {
            if (!vptCoords || !canvas) return canvas ? canvas._objects.slice() : [];

            const cacheKey = this._cacheKeyFor(vptCoords);
            if (this._cache && this._cache.key === cacheKey) {
                return this._cache.objects;
            }

            const minX = vptCoords.tl.x;
            const minY = vptCoords.tl.y;
            const maxX = vptCoords.br.x;
            const maxY = vptCoords.br.y;

            const hits = this._tree.search({minX, minY, maxX, maxY});
            const set = new Set();
            for (let i = 0; i < hits.length; i++) set.add(hits[i]._obj);
            for (let i = 0; i < this._oversized.length; i++) set.add(this._oversized[i]);
            for (const obj of this._dirty) set.add(obj);

            // preserve z-order using canvas._objects
            const all = canvas._objects;
            const ordered = new Array(set.size);
            let w = 0;
            for (let i = 0; i < all.length; i++) {
                const o = all[i];
                if (set.has(o)) ordered[w++] = o;
            }
            ordered.length = w;

            this._cache = { key: cacheKey, objects: ordered, clusters: null };
            return ordered;
        }

        _cacheKeyFor(vptCoords) {
            // include viewport coords + zoom + members count + version of mutations
            // + selection version so cluster results invalidate when the active
            // object changes (active is exempt from clustering — see clusters()).
            const c = this.canvas;
            const vt = c.viewportTransform;
            return vptCoords.tl.x + ',' + vptCoords.tl.y + ',' + vptCoords.br.x + ',' + vptCoords.br.y +
                '|' + vt[0] + ',' + vt[3] + ',' + vt[4] + ',' + vt[5] +
                '|' + this.size() + '|' + this.selectionVersion;
        }

        /**
         * Objects exempt from cluster suppression. They always render
         * individually so the user never loses sight of what they're
         * selecting / editing / creating.
         *
         * Members:
         *  - canvas._activeObject (single selection)
         *  - canvas._activeObject._objects (active selection members)
         *  - any object flagged `isHighlight` (selection halo helpers)
         *  - any object explicitly opted-out via `__excludeFromCluster`
         */
        _exemptSet(canvas) {
            const out = new Set();
            const active = canvas && canvas._activeObject;
            if (active) {
                out.add(active);
                if (Array.isArray(active._objects)) {
                    for (let i = 0; i < active._objects.length; i++) out.add(active._objects[i]);
                }
            }
            return out;
        }

        /**
         * Adaptive quadtree clustering, image-space anchored.
         *
         * Cells are defined by recursively halving an image-space root rect (the
         * slide bbox). This keeps cells stable under pan: a given annotation always
         * lives in the same cell, so pills never re-emit at new positions when the
         * user drags the viewport — only their *screen* projection translates.
         *
         * Threshold is adaptive: the per-cell trigger is derived from the total
         * count of small visible annotations, scaled to land at roughly
         * `clusterTargetRendered` painted dots across the viewport. A floor of
         * `clusterMinThreshold` prevents over-clustering naturally sparse views.
         *
         * Returns { rects: [{ screen:{x,y,w,h}, image:{x,y,w,h}, count, members }],
         *           suppressed: Set<obj> }.
         */
        clusters(vptCoords, canvas) {
            if (!vptCoords || !canvas) return { rects: [], suppressed: null };
            if (this._cache && this._cache.clusters) return this._cache.clusters;

            // Soft escape at OSD max zoom: at the closest zoom the user can
            // reach, prefer to show real annotations rather than pills — but
            // only when the visible count is small enough that Skia can
            // rasterize them all without crashing the renderer. Above the
            // safety cap, keep clustering on regardless of zoom.
            const viewport = this.wrapper?.viewer?.viewport;
            if (viewport && typeof viewport.getMaxZoom === 'function'
                && typeof viewport.getZoom === 'function') {
                const zoom = viewport.getZoom();
                const maxZoom = viewport.getMaxZoom();
                if (Number.isFinite(zoom) && Number.isFinite(maxZoom)
                    && zoom >= maxZoom - 1e-3) {
                    const visible = this.visibleObjects(vptCoords, canvas);
                    if (visible.length <= this.options.maxRenderedReal) {
                        const empty = { rects: [], suppressed: null };
                        if (this._cache) this._cache.clusters = empty;
                        return empty;
                    }
                    // Too many visible — fall through to normal clustering.
                }
            }

            const opts = this.options;
            const vt = canvas.viewportTransform;
            const root = this._getClusterRoot();
            if (!root) return { rects: [], suppressed: null };

            // viewport AABB in image space (already provided by the canvas)
            const vpt = {
                minX: vptCoords.tl.x, minY: vptCoords.tl.y,
                maxX: vptCoords.br.x, maxY: vptCoords.br.y
            };

            // Eligibility: an annotation participates in clustering when its bbox
            // is within `clusterMaxItemFactor` cells in each dimension. Items
            // truly oversized are kept individual — replacing a clearly visible
            // shape with a small pill would lose meaningful detail. The factor
            // defaults slightly above 1.0 so items right at the cell boundary
            // (which already overlap pill regions in dense scenes) join the
            // cluster instead of dragging Skia.
            const screenZoom = Math.sqrt(vt[0] * vt[0] + vt[1] * vt[1]) || 1;
            const itemCapPx = opts.clusterMinCellPx * opts.clusterMaxItemFactor;
            const itemCapImg = itemCapPx / screenZoom;
            // Selection / highlight / explicit-exempt objects always render
            // individually — the user is interacting with them and must see them
            // even when the surrounding region clusters into a pill.
            const exempt = this._exemptSet(canvas);
            const isClusterable = (o) => {
                if (o._idxOversized || o.__cluster) return false;
                if (o.isHighlight || o.__excludeFromCluster) return false;
                if (exempt.has(o)) return false;
                const b = o._idxBox;
                if (!b) return false;
                const w = b.maxX - b.minX;
                const h = b.maxY - b.minY;
                return w <= itemCapImg && h <= itemCapImg;
            };

            // Flat per-cell threshold. Adaptive scaling by total count was
            // mathematically broken (didn't account for cell count). With image-space
            // anchoring + a low fixed threshold, dense viewports produce many pills
            // and sparse ones produce none — which matches the user's mental model.
            const threshold = opts.clusterMinThreshold;

            // forward-project image rect → screen rect using vt (no rotation in our
            // pipeline; uniform-ish affine works as a 4-corner transform anyway).
            const projectImgRect = (rect) => {
                const x0 = vt[0] * rect.minX + vt[2] * rect.minY + vt[4];
                const y0 = vt[1] * rect.minX + vt[3] * rect.minY + vt[5];
                const x1 = vt[0] * rect.maxX + vt[2] * rect.maxY + vt[4];
                const y1 = vt[1] * rect.maxX + vt[3] * rect.maxY + vt[5];
                const sx = Math.min(x0, x1);
                const sy = Math.min(y0, y1);
                return { x: sx, y: sy, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
            };

            const rects = [];
            const suppressed = new Set();

            const rec = (minX, minY, maxX, maxY, depth) => {
                // cull cells that don't intersect the viewport
                if (maxX <= vpt.minX || minX >= vpt.maxX
                    || maxY <= vpt.minY || minY >= vpt.maxY) return;

                // query intersected with viewport so off-screen items don't count
                const qMinX = Math.max(minX, vpt.minX);
                const qMinY = Math.max(minY, vpt.minY);
                const qMaxX = Math.min(maxX, vpt.maxX);
                const qMaxY = Math.min(maxY, vpt.maxY);
                const hits = this._tree.search({
                    minX: qMinX, minY: qMinY, maxX: qMaxX, maxY: qMaxY
                });
                let clusterMembers = null;
                for (let i = 0; i < hits.length; i++) {
                    const o = hits[i]._obj;
                    if (!isClusterable(o)) continue;
                    if (!clusterMembers) clusterMembers = [];
                    clusterMembers.push(o);
                }
                const count = clusterMembers ? clusterMembers.length : 0;
                if (count <= threshold) return; // render normally

                const screenRect = projectImgRect({ minX, minY, maxX, maxY });
                const minSide = Math.min(screenRect.w, screenRect.h);
                if (minSide <= opts.clusterMinCellPx || depth >= opts.clusterMaxDepth) {
                    rects.push({
                        screen: screenRect,
                        image: { x: qMinX, y: qMinY, w: qMaxX - qMinX, h: qMaxY - qMinY },
                        count,
                        members: clusterMembers
                    });
                    for (let i = 0; i < clusterMembers.length; i++) suppressed.add(clusterMembers[i]);
                    return;
                }

                // image-space midpoint split
                const mx = (minX + maxX) * 0.5;
                const my = (minY + maxY) * 0.5;
                rec(minX, minY, mx,   my,   depth + 1);
                rec(mx,   minY, maxX, my,   depth + 1);
                rec(minX, my,   mx,   maxY, depth + 1);
                rec(mx,   my,   maxX, maxY, depth + 1);
            };

            rec(root.minX, root.minY, root.maxX, root.maxY, 0);

            const result = { rects, suppressed };
            if (this._cache) this._cache.clusters = result;
            return result;
        }

        /**
         * Visible objects minus cluster-suppressed ones. The list both the
         * render path (`_renderObjects`) and the hit-test path
         * (`_searchPossibleTargets`) actually act on. Cached on `_cache` so
         * we allocate this once per frame rather than per call site.
         */
        realCandidates(vptCoords, canvas) {
            const cache = this._cache;
            if (cache && cache.realCandidates) return cache.realCandidates;
            const visible = this.visibleObjects(vptCoords, canvas);
            const { suppressed } = this.clusters(vptCoords, canvas);
            const out = (suppressed && suppressed.size)
                ? visible.filter(o => !suppressed.has(o))
                : visible;
            if (this._cache) this._cache.realCandidates = out;
            return out;
        }

        // ---------- lazy refresh ----------

        /**
         * Brings a single annotation up to date with current visuals/zoom/filter
         * versions before render or hit-test. Cheap when nothing changed.
         */
        ensureFresh(obj) {
            if (!obj || obj.__cluster) return;
            const wrapper = this.wrapper;
            if (!wrapper) return;

            if (obj._visualsVersion !== this.visualsVersion) {
                wrapper.updateSingleAnnotationVisuals?.(obj);
                obj._visualsVersion = this.visualsVersion;
            }
            if (obj._filtersVersion !== this.filtersVersion) {
                wrapper._applyAnnotationVisibilityState?.(obj);
                obj._filtersVersion = this.filtersVersion;
            }
            if (obj._zoomVersion !== this.zoomVersion) {
                const c = this.canvas;
                if (c && typeof obj.zooming === 'function') {
                    obj.zooming(c.__lastSmallZoom || 1, c.__lastRealZoom || 1);
                }
                obj._zoomVersion = this.zoomVersion;
            }
            // Lazy oCoords resync: fabric needs current screen-space coords for
            // hit-testing, but our setViewportTransform override skips the
            // global setCoords storm. Refresh only this object now. The
            // _silentSetCoords gate keeps our own update() from firing —
            // image-space bbox is a function of object geometry, not the
            // viewport, so the rbush entry is unaffected.
            if (obj._setCoordsVersion !== this.setCoordsVersion) {
                this._silentSetCoords = true;
                try { obj.setCoords(true); } finally { this._silentSetCoords = false; }
                obj._setCoordsVersion = this.setCoordsVersion;
            }
        }

        /**
         * Walks every indexed object (including oversized + dirty), running ensureFresh.
         * Used by toObject / screenshot before serialization or capture.
         */
        flushAll() {
            const all = this.canvas?._objects;
            if (!all) return;
            for (let i = 0; i < all.length; i++) this.ensureFresh(all[i]);
        }

        forEachAll(cb) {
            const all = this.canvas?._objects;
            if (!all) return;
            for (let i = 0; i < all.length; i++) cb(all[i]);
        }

        // ---------- counter bumps ----------

        bumpVisuals()    { this.visualsVersion++;    this._cache = null; }
        bumpFilters()    { this.filtersVersion++;    this._cache = null; }
        bumpZoom()       { this.zoomVersion++;       this._cache = null; }
        // Bumped by the setViewportTransform override; ensureFresh resyncs
        // each visible object's oCoords on demand.
        bumpSetCoords()  { this.setCoordsVersion++;  this._cache = null; }
        // Bumped by the active-object hooks in the fabric overlay so
        // clusters() recomputes with the new exempt set on the next render.
        bumpSelection()  { this.selectionVersion++;  this._cache = null; }
    }

    OSDAnnotations.SpatialIndex = AnnotationSpatialIndex;
})();
