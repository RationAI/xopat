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
 * `ZPlanePrefetcher`) is parked under `z://<plane>/<originalCacheKey>` as a raw
 * blob, and the plane active at download time lives forever in the tile's
 * original record. Revisiting a plane is therefore served from memory — no
 * network round-trip — while a controller-owned LRU (`zPlaneCacheMaxItems`)
 * keeps the z-records from crowding OSD's `maxImageCacheCount` budget.
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
            originPlane: t => this.originPlane(t),
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
     * Plane baked into the tile's own URL (fixed at tile creation) — the plane
     * held by the tile's ORIGINAL cache record, which OSD preserves across all
     * in-place swaps. Revisiting this plane never needs a z-record.
     */
    private originPlane(tile: any): number {
        let p = tile.__zOrigin;
        if (p === undefined) {
            const plane = /[?&]z=(\d+)/.exec(String(tile.getUrl?.() ?? ""))?.[1];
            p = plane ? parseInt(plane, 10) : 0;
            tile.__zOrigin = p;
        }
        return p;
    }

    /**
     * Move the active focal plane to `index` (clamped). Applies to every
     * z-capable item in the world so layered z-stacks stay in sync.
     * @param index target plane
     * @param opts.force re-apply even if the index is unchanged
     * @returns true if a z-stack image was present
     */
    setDepth(index: number, opts: { force?: boolean } = {}): boolean {
        const items = this.zItems();
        if (!items.length) return false;

        const range = this.getRange();
        const count = range?.count ?? items[0].source.zStack.count;
        const clamped = Math.max(0, Math.min(count - 1, Math.round(index)));
        const current = range?.index ?? items[0].source.zStack.index;
        if (clamped === current && !opts.force) return true;

        // Flip the active plane on every z-capable source, then repaint via the
        // invalidation pipeline (below) rather than reloading — keeps the current
        // plane visible until the new tiles arrive.
        for (const item of items) {
            item.source?.setZDepth?.(clamped);
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
            .filter(s => s && !s._isVector && !s.multifetch)
            .map(s => s.fileId)
            .filter(Boolean);
        if (!ids.length) return;
        for (const v of [this.viewer, this.viewer?.navigator]) {
            const tc = v?.tileCache;
            if (!tc?._zombiesLoaded) continue;
            for (const key of Object.keys(tc._zombiesLoaded)) {
                // Hash keys end with `/<fileId>`; `mod://` and `z://` variants wrap them.
                if (ids.some(id => key.endsWith(`/${id}`))) {
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
            // Generic in-place swap resolves ONE tile blob per tile. Multifetch
            // (a zip of stacked images → "image[]") and vector (MVT) sources need
            // their own decode path, so skip them here — their newly-loaded tiles
            // still pick up the plane via getTileUrl; only already-visible tiles
            // lag until repaint. TODO: route those through a source-provided
            // per-plane tile loader when z-stacks for those formats are needed.
            if (src._isVector || src.multifetch) return;
            const tile = e.tile;
            try {
                if (await isOutdated(e)) return;
                const p = src.zStack.index;             // live target plane
                const origin = this.originPlane(tile);
                const current = tile.__zPlane ?? origin;

                if (p === origin) {
                    // The original download record holds this plane forever.
                    const oc = tile.getCache?.(tile.originalCacheKey);
                    if (oc) {
                        if (current === p) return;      // main cache already shows it
                        // copy=true is mandatory: the record may hold a
                        // destructor-managed type (e.g. "image").
                        const data = await oc.getDataAs(oc.type, true);
                        if (data !== undefined && data !== null) {
                            await e.setData(data, oc.type);
                            tile.__zPlane = (await isOutdated(e)) ? undefined : p;
                            return;
                        }
                    }
                    // No usable original record — fall through to network.
                } else if (cacheOn) {
                    const zk = this.zCacheKey(p, tile);
                    const zc = tile.getCache?.(zk);
                    if (zc) {
                        this.planeCache.touch(tile, zk);
                        if (current === p) return;      // main cache already shows it
                        const data = await zc.getDataAs(zc.type, true); // identity for blobs
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

                // getTileUrl already reflects the current plane (setZDepth applied).
                const url = src.getTileUrl(tile.level, tile.x, tile.y);
                const client = src.__xopatHttpClient;
                const res = client?.fetchRaw ? await client.fetchRaw(url) : await fetch(url);
                if (res?.ok === false) throw new Error(`plane tile ${res.status}`);
                const blob = await res.blob();
                if (!blob || blob.size === 0) throw new Error("empty plane tile");
                // `_dataFormat` is the source's registered convertible type
                // ("rasterBlob" / "rawTiff"); "image" is a safe fallback for
                // plain image tile sources.
                const fmt = src._dataFormat || "image";
                if (cacheOn && p !== origin && fmt === "rasterBlob") {
                    // Park the fetched plane as a z-record for instant revisits.
                    // Gated to rasterBlob (immutable, destructor-free, shareable);
                    // other formats keep the pre-cache fetch-only behavior.
                    const zk = this.zCacheKey(p, tile);
                    if (tile.addCache?.(zk, blob, fmt, false)) {
                        this.planeCache.register(tile, zk);
                    }
                }
                await e.setData(blob, fmt);
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
