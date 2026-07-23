// `virtual-region` slide protocol + CroppedTileSource.
//
// Turns a virtual child's `DataOverride` ({ dataID: <parent>, protocol:
// "virtual-region", croppingContext }) into an OpenSeadragon TileSource that
// exposes ONLY a cropped sub-region of the parent, with its own local origin
// and a distinct `tileSourceId`.
//
// DESIGN — same-level compositing. A cropped tile at level L maps to the
// parent's pixels at the SAME pyramid level L (identical scale), composited
// from the parent tiles that overlap it. This is exact at EVERY zoom level —
// unlike tile-offset wrapping, which collapses at coarse zoom when the region
// is smaller than one tile. The parent tiles are fetched via the parent's OWN
// `getTileUrl` (the parent is the tile source that defines its API — we never
// guess URLs); the cropped source's own `getTileUrl` returns an opaque token
// whose (level,x,y) is recorded in a map for `downloadTileStart` (no URL parsing).
//
// The crop is expressed in RELATIVE fractions (0..1) of the source's own
// full-resolution dimensions — NOT absolute pixels — so co-registered sources
// of different resolution (e.g. a low-res explainability overlay vs the H&E
// background) but the same aspect ratio crop to the same proportional region
// and overlap. Each CroppedTileSource converts the fractions to pixels against
// ITS OWN parent.
//
// Flip / rotation / translation alignment for overlaid mode is applied at the
// `addTiledImage` placement level, not inside the source. Raster parents are
// supported in this first version; vector (MVT) / multi-channel-TIFF parents
// should be a follow-up (they can't be composited as plain images).

interface ParentTileGeometry {
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
    overlap: number;
    minLevel: number;
    maxLevel: number;
}

/**
 * Define (once) and return `OpenSeadragon.CroppedTileSource`. Lazy so the class
 * — which extends `OpenSeadragon.TileSource` — is built only after OSD is
 * loaded (i.e. at bootstrap, not at module-eval time).
 */
function ensureCroppedTileSource(): any {
    const OSD: any = (window as any).OpenSeadragon;
    if (OSD.CroppedTileSource) return OSD.CroppedTileSource;

    // Parent geometry cache, keyed by parentId (the DataID). Once the first
    // cropped source for a parent has loaded it, EVERY sibling region and every
    // re-render becomes synchronously-ready with correct dimensions — removing
    // the async window that causes the navigator/osd_tools/flex render races.
    const parentGeomCache = new Map<string, ParentTileGeometry>();

    OSD.CroppedTileSource = class CroppedTileSource extends OSD.TileSource {
        constructor(options: any) {
            // Placeholder geometry; ready:false so OSD doesn't auto-fire 'ready'
            // or request tiles before we know the real dimensions. Set
            // `_tileWidth`/`_tileHeight` (not just `tileSize`) so early
            // getTileWidth()/getTileHeight() calls don't fall back to the
            // deprecated getTileSize() before _applyGeometry runs.
            super({ width: 256, height: 256, tileSize: 256, _tileWidth: 256, _tileHeight: 256, minLevel: 0, maxLevel: 0, ready: false });
            this.ready = false;
            // Fractional crop (0..1) of the parent's own full-res dimensions.
            this._fractions = (options.croppingContext && options.croppingContext.region) || { x: 0, y: 0, w: 1, h: 1 };
            this._parentResolved = options.parentResolved;
            this._parentId = options.parentId;
            this._ajaxHeaders = options.ajaxHeaders || {};
            this._crossOriginPolicy = options.crossOriginPolicy;
            this.metadata = options.metadata || {};
            // (level,x,y) recorded by getTileUrl, consumed by downloadTileStart —
            // so tile identity stays fully in our control (no URL parsing).
            this._tileCoords = new Map();

            // Distinct identity so per-source state (faulty registry, IO, caches)
            // never collides with the parent or sibling regions.
            const f = this._fractions;
            this.tileSourceId = `${this._parentId || "virtual"}#${f.x},${f.y},${f.w},${f.h}`;

            let cachedGeom = this._parentId ? parentGeomCache.get(this._parentId) : undefined;
            if (!cachedGeom && this._parentId) {
                // Persisted parent dims (written into params at mode-switch time)
                // make a DIRECT reload into the split synchronously-ready too —
                // no async window, so the flex first-pass texture is allocated
                // tall from the start.
                const persisted = ((window as any).APPLICATION_CONTEXT?.config?.params?.virtualSourceDims || {})[this._parentId];
                if (persisted && Number.isFinite(persisted.width) && Number.isFinite(persisted.height)) {
                    cachedGeom = persisted as ParentTileGeometry;
                    parentGeomCache.set(this._parentId, cachedGeom);
                }
            }
            if (cachedGeom) {
                // FAST PATH: geometry is known synchronously — set correct dims,
                // become ready now (no square placeholder ever reaches OSD). The
                // parent SOURCE still loads lazily, but only for tile compositing.
                this._applyGeometry(cachedGeom);
                this._ready = this._instantiateParent()
                    .then((parent: any) => { this._parent = parent; })
                    .catch((e: any) => {
                        this.metadata = { ...(this.metadata || {}), error: (e && (e.message || String(e))) || "Failed to load parent slide." };
                    });
            } else {
                // SLOW PATH: load the parent, learn its geometry, cache it, then
                // become ready. Resolves even on failure (consumers check `_parent`).
                this._ready = this._initParent().catch((e: any) => {
                    this.metadata = { ...(this.metadata || {}), error: (e && (e.message || String(e))) || "Failed to load parent slide." };
                    this.raiseEvent("open-failed", { message: e, source: this._parentResolved, postData: null });
                });
            }
        }

        async _initParent(): Promise<void> {
            const parent = await this._instantiateParent();
            this._parent = parent;
            const geom = this._readParentGeometry(parent);
            if (this._parentId) parentGeomCache.set(this._parentId, geom);
            this._applyGeometry(geom);
            this._scheduleAspectFix();
        }

        /** Compute region pixels from fractions × parent geometry, set the
         *  source's dimensions/pyramid, and become ready. Used by both the sync
         *  (cached) and async (first-load) paths. */
        _applyGeometry(geom: ParentTileGeometry): void {
            this._parentGeometry = geom;
            // Fractions → exact parent pixels (NOT snapped — compositing handles
            // partial tiles, so the crop is pixel-exact and aligns proportionally
            // with co-registered sources of any resolution).
            const f = this._fractions;
            const rx = Math.max(0, Math.min(f.x * geom.width, geom.width));
            const ry = Math.max(0, Math.min(f.y * geom.height, geom.height));
            const rw = Math.max(1, Math.min(f.w * geom.width, geom.width - rx));
            const rh = Math.max(1, Math.min(f.h * geom.height, geom.height - ry));
            this._regionPx = { x: rx, y: ry, w: rw, h: rh };

            OSD.extend(this, {
                width: Math.round(rw),
                height: Math.round(rh),
                dimensions: new OSD.Point(Math.round(rw), Math.round(rh)),
                aspectRatio: rw / rh,
                tileOverlap: 0,
                minLevel: geom.minLevel,
                maxLevel: geom.maxLevel,
                metadata: { ...(this.metadata || {}) },
                ready: true,
            });
            // Raise 'ready' so OSD finalises the source. Its internal handler
            // recomputes _tileWidth/_tileHeight from the deprecated `tileSize`
            // accessor (and can ZERO them), so we set the real tile size
            // AUTHORITATIVELY afterwards — never relying on getTileSize().
            this.raiseEvent("ready", { tileSource: this });
            this._tileWidth = geom.tileWidth;
            this._tileHeight = geom.tileHeight;
            this.tileOverlap = 0;
        }

        _scheduleAspectFix(tries = 16): void {
            const dims = this.dimensions;
            if (!dims || !dims.x || !dims.y) return;
            const norm = dims.y / dims.x;
            const OSD: any = (window as any).OpenSeadragon;

            // Backstop only: with the open pipeline's eager parent-geometry
            // preload, cropped sources are tall from construction and this finds
            // nothing to fix. It exists for edge paths (e.g. osd_tools previews)
            // that build a TiledImage before the source is ready. Returns true
            // ONLY when it actually corrected a stale normHeight, so we don't
            // force needless flex rebuilds (which can disturb the 2nd-pass shader
            // controls mid-render).
            const fixWorld = (world: any): boolean => {
                if (!world || typeof world.getItemCount !== "function") return false;
                let found = false;
                for (let i = 0; i < world.getItemCount(); i++) {
                    const item = world.getItemAt(i);
                    if (item && item.source === this) {
                        found = true;
                        if (Math.abs((item.normHeight || 0) - norm) > 1e-6) {
                            item.normHeight = norm;
                            try {
                                item.setWidth(item.getBounds(true).width, true);
                            } catch (_) { /* item not fully initialised yet */ }
                        }
                    }
                }
                return found;
            };

            const rebuiltViewers = new Set<any>();
            const run = (remaining: number) => {
                const vm: any = (window as any).VIEWER_MANAGER;
                if (vm && Array.isArray(vm.viewers)) {
                    for (const viewer of vm.viewers) {
                        const inMain = fixWorld(viewer?.world);
                        fixWorld(viewer?.navigator?.world);
                        // Force a flex rebuild once per viewer showing this source.
                        // Besides reallocating a corrected first-pass texture, it
                        // re-registers tiled images so the renderer's
                        // _tiledImageCount isn't left at 0 (which blanks the
                        // second pass). NOTE: a real fix belongs in flex-renderer's
                        // multi-viewer second-pass setup — see report.
                        if (inMain && !rebuiltViewers.has(viewer)) {
                            rebuiltViewers.add(viewer);
                            try {
                                const drawer: any = viewer.drawer;
                                if (drawer && typeof drawer._requestRebuild === "function") {
                                    drawer._requestRebuild(0, true);
                                } else {
                                    viewer.forceRedraw?.();
                                }
                            } catch (_) { /* ignore */ }
                        }
                    }
                }
                if (remaining > 0 && OSD?.requestAnimationFrame) {
                    OSD.requestAnimationFrame(() => run(remaining - 1));
                }
            };
            run(tries);
        }

        /**
         * Build the parent TileSource from the resolved descriptor. URL strings
         * go through OSD's autodetecting `new TileSource({url})` — its
         * getImageInfo fires 'ready' with the proper SUBCLASS instance via
         * `e.tileSource`; a pre-built TileSource instance is used directly.
         */
        _instantiateParent(): Promise<any> {
            const resolved = this._parentResolved;
            return new Promise((resolve, reject) => {
                const waitReady = (ts: any) => {
                    if (ts.ready) return resolve(ts);
                    ts.addHandler("ready", (e: any) => resolve(e.tileSource || ts));
                    ts.addHandler("open-failed", (e: any) => reject(e.message || e));
                };

                if (resolved && resolved.kind === "url" && typeof resolved.url === "string") {
                    const parent = new OSD.TileSource({
                        url: resolved.url,
                        ajaxHeaders: this._ajaxHeaders,
                        crossOriginPolicy: this._crossOriginPolicy,
                    });
                    if (resolved.client) parent.__xopatHttpClient = resolved.client;
                    waitReady(parent);
                    return;
                }

                const ts = resolved && resolved.tileSource;
                if (ts && typeof ts === "object") {
                    if (resolved.client && !ts.__xopatHttpClient) ts.__xopatHttpClient = resolved.client;
                    waitReady(ts);
                    return;
                }

                reject("virtual-region: unsupported parent source descriptor");
            });
        }

        _readParentGeometry(parent: any): ParentTileGeometry {
            const width = parent.width ?? parent.dimensions?.x;
            const height = parent.height ?? parent.dimensions?.y;
            if (!Number.isFinite(width) || !Number.isFinite(height)) {
                throw new Error("virtual-region: parent has no usable dimensions");
            }
            const tileWidth = parent._tileWidth ?? parent.tileSize ?? 256;
            const tileHeight = parent._tileHeight ?? parent.tileSize ?? tileWidth;
            return {
                width,
                height,
                tileWidth,
                tileHeight,
                overlap: parent.tileOverlap || 0,
                minLevel: parent.minLevel || 0,
                maxLevel: parent.maxLevel || 0,
            };
        }

        /** Per-level scale fraction (≤1). Delegate to the parent so custom
         *  pyramids (non-power-of-two downsample factors) stay correct. Falls
         *  back to a power-of-two scale before the parent is ready. */
        getLevelScale(level: number): number {
            if (this._parent && typeof this._parent.getLevelScale === "function") {
                return this._parent.getLevelScale(level);
            }
            return Math.pow(0.5, (this.maxLevel || 0) - level);
        }

        /** Authoritative tile size. OSD's 'ready' handler recomputes
         *  `_tileWidth`/`_tileHeight` from the deprecated `tileSize` accessor and
         *  can zero them; the parent geometry is the source of truth. Overriding
         *  getTileWidth/getTileHeight also stops the getTileSize() deprecation. */
        _tw(): number { return (this._parentGeometry && this._parentGeometry.tileWidth) || this._tileWidth || 256; }
        _th(): number { return (this._parentGeometry && this._parentGeometry.tileHeight) || this._tileHeight || 256; }
        getTileWidth(_level?: number): number { return this._tw(); }
        getTileHeight(_level?: number): number { return this._th(); }

        getNumTiles(level: number): any {
            if (level < this.minLevel || level > this.maxLevel) return new OSD.Point(0, 0);
            const scale = this.getLevelScale(level);
            const w = Math.ceil((this.width * scale) / this._tw());
            const h = Math.ceil((this.height * scale) / this._th());
            return new OSD.Point(Math.max(1, w), Math.max(1, h));
        }

        /**
         * If a cropped tile maps 1:1 onto a FULL parent tile (interior, grid-
         * aligned at this level), return that parent tile's coords so we can pass
         * it straight through — reusing the parent's tile (shared OSD cache,
         * parent's own download, NO compositing). Returns null for border /
         * straddling / edge tiles, which must be cropped via _composeTile.
         */
        _passThroughTile(level: number, cx: number, cy: number): { px: number; py: number } | null {
            const parent = this._parent;
            if (!parent || typeof parent.getTileUrl !== "function") return null;
            const scale = this.getLevelScale(level);
            const tw = this._tw();
            const th = this._th();
            // Edge tiles (last partial column/row) are smaller than a full tile.
            const croppedLevelW = Math.ceil(this.width * scale);
            const croppedLevelH = Math.ceil(this.height * scale);
            if (croppedLevelW - cx * tw < tw || croppedLevelH - cy * th < th) return null;
            // The cropped tile's top-left in parent level-pixel space.
            const px0 = this._regionPx.x * scale + cx * tw;
            const py0 = this._regionPx.y * scale + cy * th;
            // Only a clean pass-through when that lands exactly on a parent tile
            // boundary (otherwise the cropped tile straddles parent tiles).
            const ax = px0 / tw;
            const ay = py0 / th;
            if (Math.abs(ax - Math.round(ax)) > 1e-6 || Math.abs(ay - Math.round(ay)) > 1e-6) return null;
            const px = Math.round(ax);
            const py = Math.round(ay);
            const pn = typeof parent.getNumTiles === "function" ? parent.getNumTiles(level) : null;
            if (pn && (px < 0 || py < 0 || px >= pn.x || py >= pn.y)) return null;
            return { px, py };
        }

        // Interior aligned tiles return the PARENT's real tile URL (pass-through,
        // shared cache). Border/straddling tiles return an opaque token whose
        // coords are recorded for _composeTile (cropping).
        getTileUrl(level: number, x: number, y: number): string {
            const pt = this._passThroughTile(level, x, y);
            if (pt) return this._parent.getTileUrl(level, pt.px, pt.py);
            const key = `virtual-region:${this.tileSourceId}|${level}|${x}|${y}`;
            this._tileCoords.set(key, { level, x, y });
            return key;
        }

        getTileHashKey(level: number, x: number, y: number, url?: string, ajaxHeaders?: any, postData?: any): string {
            const pt = this._passThroughTile(level, x, y);
            if (pt && typeof this._parent.getTileHashKey === "function") {
                // Share the parent's cache entry (and sibling regions' boundary tiles).
                return this._parent.getTileHashKey(level, pt.px, pt.py, url, ajaxHeaders, postData);
            }
            return `${this.tileSourceId}|${level}|${x}|${y}`;
        }

        tileExists(level: number, x: number, y: number): boolean {
            const n = this.getNumTiles(level);
            return level >= this.minLevel && level <= this.maxLevel && x >= 0 && y >= 0 && x < n.x && y < n.y;
        }

        getMetadata(): any { return this.metadata; }

        // --- Region ↔ parent coordinate mapping -------------------------------
        // A crop is an axis-aligned sub-rect of the parent at the SAME pyramid
        // resolution, so region-local ↔ parent-global is a pure TRANSLATION by
        // the region's parent-pixel origin (`_regionPx.{x,y}`). These let
        // consumers (annotations IO, scripting coord API) persist/expose
        // PARENT-GLOBAL pixel coordinates instead of region-local ones, so the
        // split is transparent to position-dependent plugins/modules. Before
        // `_applyGeometry` runs `_regionPx` is unset — degrade to identity /
        // not-contained so early callers never crash.

        /** The DataID of the parent slide this region was cropped from. */
        getParentId(): string | undefined { return this._parentId; }

        /** Crop origin + size in parent full-res pixels, or undefined if not ready. */
        getRegionPx(): { x: number; y: number; w: number; h: number } | undefined { return this._regionPx; }

        /** Parent slide full-res dimensions (so consumers can report PARENT size), or undefined. */
        getParentDimensions(): any {
            const g = this._parentGeometry;
            return g ? new OSD.Point(g.width, g.height) : undefined;
        }

        /** Region-local image pixel → parent-global image pixel. */
        toParentImageCoordinates(point: any): any {
            const r = this._regionPx;
            if (!r) return new OSD.Point(point.x, point.y);
            return new OSD.Point(point.x + r.x, point.y + r.y);
        }

        /** Parent-global image pixel → region-local image pixel. */
        fromParentImageCoordinates(point: any): any {
            const r = this._regionPx;
            if (!r) return new OSD.Point(point.x, point.y);
            return new OSD.Point(point.x - r.x, point.y - r.y);
        }

        /** Whether a parent-global image point falls inside this region's crop rect. */
        containsParentImagePoint(point: any): boolean {
            const r = this._regionPx;
            if (!r) return false;
            return point.x >= r.x && point.y >= r.y && point.x <= r.x + r.w && point.y <= r.y + r.h;
        }

        setSourceOptions(options: any): void { this._parent?.setSourceOptions?.(options); }
        getThumbnail(opts?: any): any { return this._parent?.getThumbnail?.(opts); }
        getLabel(opts?: any): any { return this._parent?.getLabel?.(opts); }

        downloadTileStart(context: any): void {
            const run = () => {
                if (!this._parent) {
                    context.fail("virtual-region: parent unavailable", null);
                    return;
                }
                const coords = this._tileCoords.get(context.src);
                if (!coords) {
                    // PASS-THROUGH: context.src is a real parent tile URL — let the
                    // parent fetch + decode it (its own auth/format), no compositing.
                    this._parent.downloadTileStart(context);
                    return;
                }
                // BORDER tile: crop the region out of the overlapping parent tiles.
                const aborted = { value: false };
                context.userData.abort = () => { aborted.value = true; };
                this._composeTile(coords.level, coords.x, coords.y, aborted)
                    .then((canvasCtx) => { if (!aborted.value) context.finish(canvasCtx, null, "context2d"); })
                    .catch((e) => { if (!aborted.value) context.fail("virtual-region: tile compose failed: " + (e?.message || e), null); });
            };
            if (this._parent) run(); else this._ready.then(run);
        }

        downloadTileAbort(context: any): void {
            if (typeof context.userData?.abort === "function") {
                context.userData.abort(); // composite tile
            } else {
                this._parent?.downloadTileAbort?.(context); // pass-through tile
            }
        }

        /**
         * Composite the parent tiles overlapping one cropped tile onto a canvas.
         * Same pyramid level ⇒ same pixel scale, so this is a pure copy (no resample).
         */
        async _composeTile(level: number, tx: number, ty: number, aborted: { value: boolean }): Promise<CanvasRenderingContext2D> {
            const geom = this._parentGeometry as ParentTileGeometry;
            const scale = this.getLevelScale(level);
            const cropTW = this._tw();
            const cropTH = this._th();

            // Region origin in this level's pixel space.
            const originX = this._regionPx.x * scale;
            const originY = this._regionPx.y * scale;

            // Cropped-level dimensions (clamp the edge tile to the real extent).
            const croppedLevelW = Math.ceil(this.width * scale);
            const croppedLevelH = Math.ceil(this.height * scale);
            const destW = Math.min(cropTW, croppedLevelW - tx * cropTW);
            const destH = Math.min(cropTH, croppedLevelH - ty * cropTH);

            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, destW);
            canvas.height = Math.max(1, destH);
            const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
            if (destW <= 0 || destH <= 0) return ctx;

            // Cropped tile's footprint in PARENT level-pixel space.
            const parentX0 = originX + tx * cropTW;
            const parentY0 = originY + ty * cropTH;
            const parentX1 = parentX0 + destW;
            const parentY1 = parentY0 + destH;

            const parentLevelW = Math.ceil(geom.width * scale);
            const parentLevelH = Math.ceil(geom.height * scale);
            const ptw = geom.tileWidth;
            const pth = geom.tileHeight;
            const overlap = geom.overlap;

            const pxStart = Math.max(0, Math.floor(parentX0 / ptw));
            const pxEnd = Math.floor((parentX1 - 1) / ptw);
            const pyStart = Math.max(0, Math.floor(parentY0 / pth));
            const pyEnd = Math.floor((parentY1 - 1) / pth);

            const jobs: Promise<void>[] = [];
            for (let py = pyStart; py <= pyEnd; py++) {
                for (let px = pxStart; px <= pxEnd; px++) {
                    // Parent tile image footprint in level pixels, with overlap.
                    const contentX = px * ptw;
                    const contentY = py * pth;
                    const imgX0 = Math.max(0, contentX - (px > 0 ? overlap : 0));
                    const imgY0 = Math.max(0, contentY - (py > 0 ? overlap : 0));
                    const imgX1 = Math.min(parentLevelW, contentX + ptw + overlap);
                    const imgY1 = Math.min(parentLevelH, contentY + pth + overlap);

                    // Intersection with the cropped tile's footprint.
                    const ix0 = Math.max(parentX0, imgX0);
                    const iy0 = Math.max(parentY0, imgY0);
                    const ix1 = Math.min(parentX1, imgX1);
                    const iy1 = Math.min(parentY1, imgY1);
                    if (ix0 >= ix1 || iy0 >= iy1) continue;

                    const srcX = Math.round(ix0 - imgX0);
                    const srcY = Math.round(iy0 - imgY0);
                    const w = Math.round(ix1 - ix0);
                    const h = Math.round(iy1 - iy0);
                    const destX = Math.round(ix0 - parentX0);
                    const destY = Math.round(iy0 - parentY0);
                    if (w <= 0 || h <= 0) continue;

                    jobs.push(
                        this._loadParentTile(level, px, py).then((img) => {
                            if (aborted.value || !img) return;
                            ctx.drawImage(img as any, srcX, srcY, w, h, destX, destY, w, h);
                        })
                    );
                }
            }

            await Promise.all(jobs);
            return ctx;
        }

        /** Load one parent tile as a drawable image. The URL comes from the
         *  parent's own getTileUrl (its API), routed through the parent's
         *  HttpClient when present (proxy/auth), else a cross-origin image load. */
        async _loadParentTile(level: number, px: number, py: number): Promise<ImageBitmap | HTMLImageElement | null> {
            const url = this._parent.getTileUrl(level, px, py);
            const client =
                this._parent.__xopatHttpClient ||
                (window as any).SLIDE_PROTOCOLS?.getActiveClientForUrl?.(url);

            if (client && typeof client.fetchRaw === "function") {
                const res = await client.fetchRaw(url, { headers: this._ajaxHeaders });
                const blob = await res.blob();
                if (!blob || blob.size === 0) return null;
                return await createImageBitmap(blob);
            }

            return await new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = this._crossOriginPolicy || "Anonymous";
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error("parent tile load failed: " + url));
                img.src = url;
            });
        }

        getDisplayMetadata(): any {
            const fields: any[] = [];
            if (this.width != null && this.height != null) {
                fields.push({ label: "Region", value: `${this.width} × ${this.height} px` });
            }
            const m = this.metadata || {};
            if (Number.isFinite(m.micronsX) && Number.isFinite(m.micronsY)) {
                fields.push({ label: "Pixel size", value: `${Number(m.micronsX).toFixed(3)} × ${Number(m.micronsY).toFixed(3)} µm` });
            }
            return fields.length ? [{ title: "Virtual region", fields }] : [];
        }
    };

    // Seed the parent-geometry cache from an already-ready source (e.g. the
    // parent slide still open in another viewer when switching render mode), so
    // the initial cropped open is synchronously-ready with no async render race.
    OSD.CroppedTileSource.seedParentGeometry = function (parentId: string, source: any): ParentTileGeometry | undefined {
        if (!parentId) return undefined;
        if (parentGeomCache.has(parentId)) return parentGeomCache.get(parentId);
        if (!source || !source.ready) return undefined;
        const width = source.width ?? source.dimensions?.x;
        const height = source.height ?? source.dimensions?.y;
        if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
        const tileWidth = source._tileWidth ?? source.tileSize ?? 256;
        const geom: ParentTileGeometry = {
            width,
            height,
            tileWidth,
            tileHeight: source._tileHeight ?? source.tileSize ?? tileWidth,
            overlap: source.tileOverlap || 0,
            minLevel: source.minLevel || 0,
            maxLevel: source.maxLevel || 0,
        };
        parentGeomCache.set(parentId, geom);
        return geom;
    };

    return OSD.CroppedTileSource;
}

/**
 * Register the `virtual-region` factory protocol. Idempotent — safe to call
 * once at bootstrap. The factory resolves the PARENT source via the default
 * protocol (from `ctx.dataID`) and wraps it in a CroppedTileSource using the
 * crop carried on the spec's `croppingContext`.
 */
export function registerVirtualRegionProtocol(): void {
    const SP: any = (window as any).SLIDE_PROTOCOLS;
    if (!SP || SP.has("virtual-region")) return;

    const CroppedTileSource = ensureCroppedTileSource();

    SP.register({
        id: "virtual-region",
        label: "Virtual region (cropped)",
        createTileSource: (ctx: any) => {
            const spec = ctx.spec || {};
            const croppingContext = spec.croppingContext;
            if (!croppingContext || !croppingContext.region) {
                throw new Error("[virtual-region] missing croppingContext on data spec");
            }

            // Resolve the PARENT via the default background protocol. ctx.dataID
            // is a plain DataID, so this never recurses into virtual-region.
            const isSecureMode = !!(window as any).APPLICATION_CONTEXT?.secureMode;
            const parentResolved = SP.resolveBackground({ spec: ctx.dataID, isSecureMode });

            // Carry the parent protocol's HttpClient (if any) onto the resolved
            // descriptor so tile/metadata fetches keep proxy/auth.
            if (parentResolved.kind === "tileSource") {
                parentResolved.client = parentResolved.tileSource?.__xopatHttpClient;
            } else {
                parentResolved.client = SP.getActiveClientForUrl?.(parentResolved.url);
            }

            const microns = spec.microns;
            const metadata: any = {};
            if (spec.micronsX != null && spec.micronsY != null) {
                metadata.micronsX = spec.micronsX;
                metadata.micronsY = spec.micronsY;
            } else if (microns != null) {
                metadata.micronsX = microns;
                metadata.micronsY = microns;
            }

            return new CroppedTileSource({
                parentResolved,
                parentId: typeof ctx.dataID === "string" ? ctx.dataID : JSON.stringify(ctx.dataID),
                croppingContext,
                metadata,
            });
        },
        supports: (ctx: any) => !!(ctx.spec && (ctx.spec as any).croppingContext),
    });
}
