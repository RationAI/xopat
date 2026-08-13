import { ZPlanePrefetcher } from "./z-plane-prefetcher";

/**
 * Per-viewer focal-plane (z-stack) navigator. Installed as
 * `viewer.__depthController` next to `__shaderSourceController` /
 * `__faultySources`.
 *
 * A z-stack is a single logical slide parameterized by a focal-plane index —
 * NOT a time-series shader (which swaps between N distinct data entries at the
 * shader-slot level). The plane lives on the tile source: a source opts in by
 * exposing a duck-typed `zStack = { count, index, spacingUm?, labels? }` plus
 * `setZDepth(i)`, and by baking `_activeZ` into `getTileUrl` (the hash key stays
 * z-independent, see below).
 *
 * Depth scrubs bypass the open pipeline entirely. To avoid a white flash they do
 * NOT drop and reload tiles (which would blank the view until the new plane
 * arrives); instead they swap each tile's pixels IN PLACE through OSD's
 * invalidation pipeline, which keeps the current plane drawn until the new data
 * resolves:
 *   1. `source.setZDepth(i)`             → getTileUrl now returns the plane-i URL
 *   2. add a scoped `tile-invalidated` handler that, per loaded tile, resolves
 *      the plane-i pixels and `e.setData(...)`. `tile-invalidated` is raised via
 *      `raiseEventAwaiting`, so the OLD pixels stay on screen the whole time.
 *   3. `item.requestInvalidate(false, viewportOnly)` drives the handler — first a
 *      viewport-only pass for instant feedback, then a full pass over all loaded
 *      tiles (`restoreTiles=false` so skipped tiles keep their current pixels)
 *   4. remove the handler; `viewer.forceRedraw()`
 *
 * The tile cache key is z-INDEPENDENT (see the source's getTileHashKey) — a tile
 * has one MAIN identity and OSD's 2D cache holds only the current plane per tile.
 * The z dimension is layered on top of that via extra per-tile CacheRecords:
 * every plane fetched by the swap handler (and every plane prefetched by
 * `ZPlanePrefetcher`) is parked under `z://<plane>/<originalCacheKey>` in the
 * SOURCE'S OWN data type, and the plane active at download time lives forever in
 * the tile's original record. Revisiting a plane is therefore served from memory
 * — no network round-trip — while a controller-owned LRU (`zPlaneCacheMaxItems`)
 * keeps the z-records from crowding OSD's `maxImageCacheCount` budget.
 *
 * Nothing here knows how a source encodes its planes. Three existing mechanisms
 * cover it, so the tile-source contract needs no z-specific members beyond
 * `zStack` / `setZDepth`:
 *   - an ARBITRARY plane's URL comes from `setZDepth(q)` → `getTileUrl` → restore
 *     (`withPlane`), which is sound because `setZDepth` is synchronous and
 *     identity-only;
 *   - "does the tile's ORIGINAL record already hold plane p?" is answered by
 *     comparing that URL with `tile.getUrl()` — no plane number needs parsing;
 *   - fetching AND decoding one plane is the source's own `downloadTileStart`,
 *     driven through a plain `OpenSeadragon.ImageJob`, so the plane data arrives
 *     in the source's native type (blob, imageBitmap, gpuTextureSet, …) with the
 *     usual timeout/abort semantics and xOpat's HttpClient routing.
 * Copyability and shareability of a cached plane are read off OSD's converter
 * (`copyings` / `destructors`), not declared by the source.
 *
 * Off-viewport tiles follow the `zRepaintOffViewport` policy: `"cached-only"`
 * (default) swaps them only when the plane is already cached and UNLOADS the
 * cache-miss ones after the pass (destroy=true, so no plane-ambiguous zombies;
 * panning back reloads them at the live plane URL), `"fetch"` refetches all of
 * them over the network (full fidelity, heavy — the pre-cache behavior).
 */

export interface ZStackDescriptor {
    count: number;
    index: number;
    spacingUm?: number;
    labels?: string[];
}

export interface ZStackRange {
    count: number;
    index: number;
    spacingUm?: number;
    labels?: string[];
}

function opt<T>(key: string, def: T): T {
    return (window as any).APPLICATION_CONTEXT?.getOption?.(key, def) ?? def;
}

function osd(): any {
    return (window as any).OpenSeadragon;
}

/**
 * Whether OSD knows how to duplicate a data item of `type` — i.e. a self-copy
 * edge was taught via `converter.learn(type, type, ...)`. Without one,
 * `getDataAs(type, copy = true)` warns and resolves `undefined`, so asking for a
 * copy of e.g. a `gpuTextureSet` would silently kill the plane cache.
 */
export function canCopyDataType(type: string): boolean {
    return !!osd()?.converter?.copyings?.[type];
}

/**
 * Whether a data item of `type` may live in two CacheRecords at once. A type
 * with a registered destructor is owned (an `image` freed by the HTML drawer, a
 * GPU handle, …) and must never be shared; anything else is inert (blobs, typed
 * arrays) and is safe to hand out by reference.
 */
export function canShareDataType(type: string): boolean {
    return !osd()?.converter?.destructors?.[type];
}

/**
 * Run `fn` with `src` temporarily switched to `plane`, then restore. Sound
 * because `setZDepth` is contractually synchronous and identity-only (no fetch,
 * no cache work) — nothing can observe the flip from straight-line JS. This is
 * how the core asks a source for a plane it is not currently showing, instead of
 * pattern-matching its URLs.
 */
export function withPlane<T>(src: any, plane: number, fn: () => T): T {
    const zs = src?.zStack;
    if (!zs || zs.index === plane || typeof src.setZDepth !== "function") return fn();
    const prev = zs.index;
    src.setZDepth(plane);
    try {
        return fn();
    } finally {
        src.setZDepth(prev);
    }
}

/**
 * Index on `to`'s axis that corresponds to `index` on `from`'s axis — how one
 * scrub reaches every z-capable source in the viewer when their stacks are not
 * identical (a background sampled at 40 planes with a 3-plane overlay on top).
 * Pushing the same integer everywhere would silently pin the shorter stack at
 * its last plane.
 *
 * Three rules, in this order:
 *  1. PHYSICAL — both declare `spacingUm`: keep the same depth in micrometers.
 *     Equal spacings degenerate to identity, so this subsumes the common case,
 *     and an overlay covering only part of the depth range correctly stops at
 *     its own end instead of being stretched over it.
 *  2. EXACT — equal plane counts: identity. Byte-for-byte today's behaviour.
 *  3. PROPORTIONAL — otherwise: scale the normalized position.
 * Always clamped to `to`'s range.
 */
export function mapPlaneIndex(from: ZStackDescriptor, to: ZStackDescriptor, index: number): number {
    const clamp = (i: number) => Math.max(0, Math.min((to?.count ?? 1) - 1, Math.round(i)));
    if (!from || !to || to.count <= 1) return 0;
    if (from === to || from.count <= 1) return clamp(index);

    const fromSpacing = from.spacingUm;
    const toSpacing = to.spacingUm;
    if (typeof fromSpacing === "number" && fromSpacing > 0
        && typeof toSpacing === "number" && toSpacing > 0) {
        return clamp(index * fromSpacing / toSpacing);
    }
    if (from.count === to.count) return clamp(index);
    return clamp(index * (to.count - 1) / (from.count - 1));
}

/**
 * Insertion-ordered LRU bookkeeping of the z-plane CacheRecords this controller
 * (and its prefetcher) created. OSD counts these records toward
 * `maxImageCacheCount` but evicts at whole-tile granularity, so without a
 * dedicated budget the z-records would crowd out regular 2D tiles. Entries whose
 * tile was unloaded die with the tile inside OSD; here they are dropped lazily
 * when they reach the eviction end of the map.
 */
class PlaneCacheRegistry {
    private lru = new Map<string, { tile: any; key: string }>();
    private nextId = 1;

    private idOf(tile: any): number {
        return tile.__zRegId ?? (tile.__zRegId = this.nextId++);
    }

    /** Refresh recency of an existing entry (cache hit). */
    touch(tile: any, key: string): void {
        const k = `${this.idOf(tile)}|${key}`;
        const entry = this.lru.get(k);
        if (entry) {
            this.lru.delete(k);
            this.lru.set(k, entry);
        }
    }

    /** Track a freshly created z-record and enforce the budget. */
    register(tile: any, key: string): void {
        const k = `${this.idOf(tile)}|${key}`;
        if (this.lru.has(k)) {
            this.touch(tile, key);
        } else {
            this.lru.set(k, { tile, key });
        }
        const max = Math.max(0, opt("zPlaneCacheMaxItems", 400));
        while (this.lru.size > max) {
            const first = this.lru.entries().next().value;
            if (!first) break;
            const [oldKey, entry] = first;
            this.lru.delete(oldKey);
            try {
                // Stale entries (tile unloaded, record already freed) just drop.
                if (entry.tile.loaded && entry.tile.tiledImage && entry.tile.getCache?.(entry.key)) {
                    entry.tile.removeCache(entry.key, true);
                }
            } catch (e) {
                // Record already gone with its tile — bookkeeping only.
            }
        }
    }
}

export class ViewerDepthController {
    private readonly viewer: any;
    private readonly planeCache = new PlaneCacheRegistry();
    private readonly prefetcher: ZPlanePrefetcher;
    /** True while an invalidation drive is in flight. */
    private swapping = false;
    /** Set when a plane change arrives mid-swap; triggers one more repaint pass. */
    private pendingRepaint = false;
    /** Off-viewport policy of the CURRENT invalidation pass (phases run sequentially). */
    private passPolicy: "fetch" | "cached-only" = "fetch";
    /** Cache-miss off-viewport tiles collected during a "cached-only" pass. */
    private missedTiles: any[] = [];

    constructor(viewer: any) {
        this.viewer = viewer;
        this.prefetcher = new ZPlanePrefetcher(viewer, {
            zItems: () => this.zItems(),
            getRange: () => this.getRange(),
            zCacheKey: (p, t) => this.zCacheKey(p, t),
            mapPlane: (s, p) => this.mapPlane(s, p),
            tilePlaneUrl: (s, t, p) => this.tilePlaneUrl(s, t, p),
            loadPlaneTile: (s, t, url, o) => this.loadPlaneTile(s, t, url, o),
            canParkPlane: type => canShareDataType(type),
            registerPlaneCache: (t, k) => this.planeCache.register(t, k),
        });
    }

    /** z-capable (`zStack.count > 1`) items in a given OSD world. */
    private zItemsIn(world: any): any[] {
        if (!world) return [];
        const count = world.getItemCount?.() ?? 0;
        const out: any[] = [];
        for (let i = 0; i < count; i++) {
            const item = world.getItemAt?.(i);
            const zs = item?.source?.zStack;
            if (zs && zs.count > 1) out.push(item);
        }
        return out;
    }

    /** Main-world z-items (source of range / reference / setDepth targets). */
    private zItems(): any[] {
        return this.zItemsIn(this.viewer?.world);
    }

    /**
     * The tiled image the depth range is read from. Prefer the scalebar's
     * referenced image (the app-wide "measurements refer to this" hook) when it
     * is z-capable; otherwise the first z-capable item in the world.
     */
    private referenceItem(): any | null {
        const ref = this.viewer?.scalebar?.getReferencedTiledImage?.();
        if (ref?.source?.zStack?.count > 1) return ref;
        return this.zItems()[0] || null;
    }

    /** Whether this viewer currently shows any focal-plane-capable slide. */
    hasZStack(): boolean {
        return !!this.referenceItem();
    }

    /** Current `{count, index, ...}` for the reference image, or null. */
    getRange(): ZStackRange | null {
        const zs: ZStackDescriptor | undefined = this.referenceItem()?.source?.zStack;
        if (!zs || zs.count <= 1) return null;
        return { count: zs.count, index: zs.index, spacingUm: zs.spacingUm, labels: zs.labels };
    }

    /** Cache key of the z-record holding plane `plane` of `tile`. */
    private zCacheKey(plane: number, tile: any): string {
        return `z://${plane}/${tile.originalCacheKey}`;
    }

    /**
     * URL of `tile` at an arbitrary `plane`, leaving the source's active plane
     * untouched. Null when the source cannot address the tile by URL (e.g. a
     * multifetch source returning a non-string) — such tiles are skipped.
     */
    private tilePlaneUrl(src: any, tile: any, plane: number): string | null {
        try {
            const url = withPlane(src, plane, () => src.getTileUrl(tile.level, tile.x, tile.y));
            return typeof url === "string" && url ? url : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Whether the tile's ORIGINAL cache record — the one OSD preserves across
     * every in-place swap — already holds `plane`. The record holds whatever
     * `tile.getUrl()` addressed at download time, so the plane number never has
     * to be recovered from the URL: the source is simply asked for the same
     * tile at `plane` and the two URLs are compared.
     */
    private holdsOriginPlane(src: any, tile: any, plane: number): boolean {
        const own = tile.getUrl?.();
        if (typeof own !== "string") return false;
        return this.tilePlaneUrl(src, tile, plane) === own;
    }

    /**
     * Read a cache record's data in a way that is safe for its type: copy when
     * OSD knows how, otherwise share only inert (destructor-free) payloads.
     * Returns null when neither is allowed — the caller then refetches.
     */
    private async readRecord(record: any): Promise<any> {
        const type = record.type;
        if (canCopyDataType(type)) return record.getDataAs(type, true);
        if (canShareDataType(type)) return record.getDataAs(type, false);
        return null;
    }

    /**
     * Fetch AND decode one tile at one plane through the SOURCE'S OWN
     * `downloadTileStart`, driven by a stock `OpenSeadragon.ImageJob`. The data
     * arrives in the source's native type (`rasterBlob`, `imageBitmap`,
     * `gpuTextureSet`, …) with the same timeout / abort / HttpClient routing a
     * regular tile load gets — the core neither fetches nor decodes anything
     * itself, which is what makes non-blob z-stacks work at all.
     */
    private loadPlaneTile(src: any, tile: any, url: string,
                          opts: { signal?: AbortSignal } = {}): Promise<{ data: any; type: string }> {
        return new Promise((resolve, reject) => {
            const signal = opts.signal;
            if (signal?.aborted) {
                reject(new Error("plane load aborted"));
                return;
            }
            let job: any = null;
            let settled = false;
            const onAbort = () => {
                try { job?.abort(); } catch (e) { /* already finished */ }
            };
            const done = (fn: () => void) => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener("abort", onAbort);
                fn();
            };
            job = new (osd().ImageJob)({
                src: url,
                tile,
                source: src,
                userData: {},
                loadWithAjax: tile.loadWithAjax,
                ajaxHeaders: tile.ajaxHeaders,
                postData: tile.postData,
                crossOriginPolicy: src.crossOriginPolicy,
                ajaxWithCredentials: src.ajaxWithCredentials,
                callback: (j: any) => done(() => {
                    if (j.errorMsg) reject(new Error(String(j.errorMsg)));
                    else resolve({ data: j.data, type: j.dataType || src._dataFormat || "rasterBlob" });
                }),
            });
            signal?.addEventListener("abort", onAbort, { once: true });
            job.start();
        });
    }

    /**
     * One-shot dev warning for a source that opts into z-stacks while leaving
     * `getTileHashKey` at OSD's default — which returns the tile URL, i.e. a
     * PLANE-DEPENDENT identity. Such a source gets a fresh tile per plane and
     * none of the in-place machinery below applies to it.
     */
    private warnOnPlaneDependentKey(src: any): void {
        if (!opt("debugMode", false) || src.__zKeyChecked) return;
        src.__zKeyChecked = true;
        if (src.getTileHashKey === osd()?.TileSource?.prototype?.getTileHashKey) {
            console.warn("[depth] source exposes zStack but keeps the default (URL-based, " +
                "plane-dependent) getTileHashKey — override it with a z-independent key " +
                "containing the source identity. See src/ZSTACK.md.", src);
        }
    }

    /**
     * The reference axis every public index of this controller is expressed on
     * (`getRange`, `setDepth`, `step`, `z-depth-changed`, the session overlay).
     * Other sources receive their own mapped index — see `mapPlaneIndex`.
     */
    private referenceStack(): ZStackDescriptor | null {
        return this.referenceItem()?.source?.zStack ?? null;
    }

    /** Plane on `src`'s own axis for a plane on the reference axis. */
    mapPlane(src: any, referencePlane: number): number {
        const ref = this.referenceStack();
        const own = src?.zStack;
        if (!ref || !own) return referencePlane;
        return mapPlaneIndex(ref, own, referencePlane);
    }

    /**
     * Move the active focal plane to `index` on the REFERENCE axis (clamped).
     * Applies to every z-capable item in the world — background layers and
     * visualization layers alike — each receiving the index that corresponds to
     * the same depth on its own axis, so a stack whose plane count or spacing
     * differs stays aligned instead of pinning at its last plane.
     * @param index target plane, on this viewer's reference axis unless
     *   `opts.from` names the axis it was measured on
     * @param opts.force re-apply even if the index is unchanged
     * @param opts.from the foreign axis `index` is expressed on (another
     *   viewer's stack, when a linked viewport propagates its plane); translated
     *   onto this viewer's reference axis first
     * @returns true if a z-stack image was present
     */
    setDepth(index: number, opts: { force?: boolean; from?: ZStackDescriptor } = {}): boolean {
        const items = this.zItems();
        if (!items.length) return false;

        const range = this.getRange();
        const count = range?.count ?? items[0].source.zStack.count;
        const local = opts.from && range ? mapPlaneIndex(opts.from, range, index) : index;
        const clamped = Math.max(0, Math.min(count - 1, Math.round(local)));
        const current = range?.index ?? items[0].source.zStack.index;
        if (clamped === current && !opts.force) return true;

        // Flip the active plane on every z-capable source, then repaint via the
        // invalidation pipeline (below) rather than reloading — keeps the current
        // plane visible until the new tiles arrive.
        for (const item of items) {
            if (item.source) this.warnOnPlaneDependentKey(item.source);
            item.source?.setZDepth?.(this.mapPlane(item.source, clamped));
        }
        this.purgeZombiePlanes();
        this.raiseChanged(clamped, count);
        void this.repaintActivePlane();
        return true;
    }

    /**
     * Destroy zombie cache records of z-capable sources. The z-INDEPENDENT hash
     * key makes plane zombies ambiguous: `viewer.requestInvalidate()` zombifies
     * not-recently-touched tiles, and OSD's zombie revival DISCARDS freshly
     * downloaded data in favor of the zombie — which may hold a stale plane.
     * Purging on every plane change closes that resurrect-wrong-plane path.
     */
    private purgeZombiePlanes(): void {
        const ids = this.zItems()
            .map(i => i?.source)
            .filter(Boolean)
            // `fileId` is the WSI-source convention, `tileSourceId` the app-wide
            // one; a source lacking both cannot be matched and is left alone.
            // BOTH are collected, not the first available: a virtual region keys
            // its own border tiles by `tileSourceId` while its pass-through tiles
            // land under the parent's `fileId`.
            .flatMap(s => [s.fileId, s.tileSourceId])
            .filter(Boolean);
        if (!ids.length) return;
        for (const v of [this.viewer, this.viewer?.navigator]) {
            const tc = v?.tileCache;
            if (!tc?._zombiesLoaded) continue;
            for (const key of Object.keys(tc._zombiesLoaded)) {
                // The hash key carries the source identity (see ZSTACK.md);
                // `mod://` and `z://` variants wrap it.
                if (ids.some(id => key.includes(id))) {
                    try {
                        tc._zombiesLoaded[key].destroy();
                    } catch (e) {
                        // Best effort — a broken zombie is dropped from the index anyway.
                    }
                    delete tc._zombiesLoaded[key];
                    tc._zombiesLoadedCount--;
                }
            }
        }
    }

    /**
     * Repaint every z-item at its (already-updated) active plane by swapping each
     * loaded tile's data in place. A single scoped `tile-invalidated` handler
     * resolves the new-plane pixels — original record / z-record / network, in
     * that order — and hands them to `e.setData`; because the event is awaited,
     * the old pixels stay drawn until the data resolves — no white flash.
     *
     * Two sequential phases per pass: viewport-only first (instant feedback),
     * then the full loaded set under the `zRepaintOffViewport` policy. The
     * navigator world joins only the viewport phase — its `_lastDrawn` is
     * effectively its whole world, and its fetches share URLs with the main
     * world so the browser HTTP cache absorbs them.
     *
     * Coalesces rapid plane changes: a change arriving mid-swap sets
     * `pendingRepaint`, and the loop runs one more pass. Each pass reads the LIVE
     * plane via `zStack.index`, so the final pass always paints the latest plane.
     */
    private async repaintActivePlane(): Promise<void> {
        const viewer = this.viewer;
        if (!viewer) return;
        if (this.swapping) { this.pendingRepaint = true; return; }
        this.swapping = true;

        const cacheOn = opt("zPlaneCacheEnabled", true);
        const isOutdated = async (e: any) =>
            typeof e.outdated === "function" && await e.outdated();

        const handler = async (e: any) => {
            const src = e?.tile?.tiledImage?.source;
            if (!(src?.zStack?.count > 1)) return;      // scope to z-stack tiles only
            const tile = e.tile;
            try {
                if (await isOutdated(e)) return;
                const p = src.zStack.index;             // live target plane
                if (tile.__zPlane === p) return;        // main cache already shows it

                // The source addresses this plane by URL or not at all; a source
                // that cannot (getTileUrl not returning a string) is left alone —
                // its newly-loaded tiles still pick up the plane naturally.
                const url = this.tilePlaneUrl(src, tile, p);
                if (!url) return;
                const isOrigin = url === tile.getUrl?.();

                if (isOrigin) {
                    // Untouched tile: its main cache IS the original record, which
                    // holds exactly this plane. Record that and stop.
                    if (tile.__zPlane === undefined) {
                        tile.__zPlane = p;
                        return;
                    }
                    // The original download record holds this plane forever.
                    const oc = tile.getCache?.(tile.originalCacheKey);
                    const data = oc ? await this.readRecord(oc) : null;
                    if (data !== undefined && data !== null) {
                        await e.setData(data, oc.type);
                        tile.__zPlane = (await isOutdated(e)) ? undefined : p;
                        return;
                    }
                    // No usable original record — fall through to network.
                } else if (cacheOn) {
                    const zk = this.zCacheKey(p, tile);
                    const zc = tile.getCache?.(zk);
                    if (zc) {
                        this.planeCache.touch(tile, zk);
                        const data = await this.readRecord(zc);
                        if (data !== undefined && data !== null) {
                            await e.setData(data, zc.type);
                            tile.__zPlane = (await isOutdated(e)) ? undefined : p;
                            return;
                        }
                    }
                }

                if (this.passPolicy === "cached-only") {
                    // Off-viewport miss: keep the old pixels for now; the tile is
                    // unloaded after the pass so panning back reloads it at the
                    // live plane URL instead of showing a stale plane.
                    this.missedTiles.push(tile);
                    return;
                }

                // The source downloads and decodes its own plane — we only route it.
                const { data: planeData, type: fmt } = await this.loadPlaneTile(src, tile, url);
                if (cacheOn && !isOrigin && canShareDataType(fmt)) {
                    // Park the fetched plane as a z-record for instant revisits.
                    // Only inert (destructor-free) payloads may live in two
                    // records at once; owned types keep the fetch-only behavior.
                    const zk = this.zCacheKey(p, tile);
                    if (tile.addCache?.(zk, planeData, fmt, false)) {
                        this.planeCache.register(tile, zk);
                    }
                }
                await e.setData(planeData, fmt);
                // __zPlane tracks what the MAIN cache shows. If this run turned
                // out outdated, the pipeline discards the swap — leave the marker
                // unset so the reprocess pass does not skip the tile.
                tile.__zPlane = (await isOutdated(e)) ? undefined : p;
            } catch (err) {
                // Leave the current plane's pixels in place on failure.
                console.warn("[depth] plane tile swap failed", err);
            }
        };

        viewer.addHandler?.("tile-invalidated", handler);
        try {
            do {
                this.pendingRepaint = false;
                // Main world + navigator world (shared source, separate cache).
                const mainItems = this.zItems();
                if (!mainItems.length) break;
                const navItems = this.zItemsIn(viewer?.navigator?.world);

                // Phase 1 — viewport tiles only, always full fidelity. The user
                // sees the new plane after viewport-sized work, not after the
                // whole loaded set resolves.
                this.passPolicy = "fetch";
                await Promise.all([...mainItems, ...navItems].map(item => {
                    try { return item.requestInvalidate?.(false, true); } catch (e) { return null; }
                }));
                viewer.forceRedraw?.();
                viewer.navigator?.forceRedraw?.();
                if (this.pendingRepaint) continue;   // newer plane queued — skip the heavy phase

                // Phase 2 — remaining loaded tiles, main world only, sequential
                // (concurrent passes would discard phase-1 swaps as outdated).
                // Viewport tiles re-enter but skip cheaply via __zPlane + cache.
                this.passPolicy = opt<string>("zRepaintOffViewport", "cached-only") === "fetch"
                    ? "fetch" : "cached-only";
                this.missedTiles = [];
                await Promise.all(mainItems.map(item => {
                    try { return item.requestInvalidate?.(false, false); } catch (e) { return null; }
                }));
                this.unloadMissedTiles();
            } while (this.pendingRepaint);
        } catch (e) {
            console.warn("[depth] requestInvalidate failed", e);
        } finally {
            viewer.removeHandler?.("tile-invalidated", handler);
            this.passPolicy = "fetch";
            this.missedTiles = [];
            viewer.forceRedraw?.();
            viewer.navigator?.forceRedraw?.();
            this.swapping = false;
        }
    }

    /**
     * Drop the off-viewport tiles whose target plane was not cached during a
     * "cached-only" pass. destroy=true — a zombie would carry plane-ambiguous
     * pixels under the z-independent hash key. Skips tiles the pipeline still
     * owns (`processing`) or that are on screen.
     */
    private unloadMissedTiles(): void {
        const missed = this.missedTiles;
        this.missedTiles = [];
        for (const tile of missed) {
            try {
                if (tile.loaded && !tile.loading && !tile.beingDrawn && !tile.processing && tile.tiledImage) {
                    tile.unload(true);
                }
            } catch (e) {
                // Keep the tile as-is; it stays on the old plane until reloaded.
            }
        }
    }

    /** Step the active plane by `delta` (e.g. +1 / -1), clamped. */
    step(delta: number): boolean {
        const range = this.getRange();
        if (!range) return false;
        return this.setDepth(range.index + delta);
    }

    private raiseChanged(index: number, count: number): void {
        try {
            this.viewer?.raiseEvent?.("z-depth-changed", { index, count, viewer: this.viewer });
        } catch (e) {
            console.warn("[depth] failed to raise z-depth-changed", e);
        }
    }
}
