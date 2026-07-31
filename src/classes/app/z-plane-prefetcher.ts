/**
 * Idle-time prefetcher for adjacent focal planes of a z-stack, owned by
 * `ViewerDepthController`. After a plane change settles (debounced), it fetches
 * the `z±1..radius` variants of the tiles currently drawn in the main world and
 * parks them as extra per-tile OSD CacheRecords (`z://<plane>/<originalCacheKey>`,
 * raw `rasterBlob`), so the next scrub step is served without a network
 * round-trip by the controller's cache-aware swap handler.
 *
 * Deliberately does NOT go through `viewer.imageLoader` — that queue is plain
 * FIFO with no priority, so prefetch jobs would head-of-line-block real tile
 * loads. Concurrency is bounded by the shared `APPLICATION_CONTEXT.requestScheduler`
 * (background lane, keyed by the tile origin): a single global per-origin budget
 * shared across every viewer's prefetcher, so N viewers can never multiply the
 * speculative request count, and main tiles (ungated) always keep the reserve.
 * Every depth change / viewport animation / viewer close aborts the in-flight
 * generation, which also drops any of this prefetcher's still-queued slots.
 */

/** Narrow view of ViewerDepthController the prefetcher needs. */
export interface ZPlanePrefetchHost {
    /** Main-world z-capable tiled images. */
    zItems(): any[];
    /** Current `{count, index}` of the reference z-stack, or null. */
    getRange(): { count: number; index: number } | null;
    /** Cache key for plane `p` of `tile` (z-record namespace). */
    zCacheKey(plane: number, tile: any): string;
    /** Plane baked into the tile's own URL (covered by the original record). */
    originPlane(tile: any): number;
    /** Budget-LRU registration for a z-record this prefetcher created. */
    registerPlaneCache(tile: any, key: string): void;
}

function opt<T>(key: string, def: T): T {
    return (window as any).APPLICATION_CONTEXT?.getOption?.(key, def) ?? def;
}

/** Origin of a tile URL, for keying the request scheduler. Relative → page origin. */
function originOf(url: string): string {
    try {
        return new URL(url, typeof location !== "undefined" ? location.href : undefined).origin;
    } catch (_) {
        return "*";
    }
}

export class ZPlanePrefetcher {
    private readonly viewer: any;
    private readonly host: ZPlanePrefetchHost;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    /** Monotonic run id — a stale worker loop exits when it no longer matches. */
    private generation = 0;
    private abortController: AbortController | null = null;
    /** +1 / -1, biases plane order toward where the user is scrubbing. */
    private lastDirection = 1;
    private lastIndex: number | null = null;

    constructor(viewer: any, host: ZPlanePrefetchHost) {
        this.viewer = viewer;
        this.host = host;
        viewer.addHandler?.("z-depth-changed", (e: any) => this.onDepthChanged(e));
        // Viewport in motion → drawn-tile targets are stale; retarget when it settles.
        viewer.addHandler?.("animation-start", () => this.cancel());
        viewer.addHandler?.("animation-finish", () => {
            if (this.host.getRange()) this.schedule();
        });
        viewer.addHandler?.("close", () => this.cancel());
    }

    private onDepthChanged(e: any): void {
        const index = e?.index;
        if (typeof index === "number" && this.lastIndex !== null && index !== this.lastIndex) {
            this.lastDirection = index > this.lastIndex ? 1 : -1;
        }
        if (typeof index === "number") this.lastIndex = index;
        this.cancel();
        this.schedule();
    }

    /** Abort the in-flight generation and any pending debounce. */
    cancel(): void {
        this.generation++;
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.abortController?.abort();
        this.abortController = null;
    }

    private schedule(): void {
        if (!opt("zPlaneCacheEnabled", true) || opt("zPrefetchRadius", 1) <= 0) return;
        if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            void this.run();
        }, 200);
    }

    private async run(): Promise<void> {
        const range = this.host.getRange();
        if (!range || range.count <= 1) return;
        const radius = opt("zPrefetchRadius", 1);
        if (radius <= 0) return;

        // Bump the generation and drive staleness off `signal` (a newer generation
        // aborts this controller), so no separate `gen` check is needed per task.
        ++this.generation;
        const controller = new AbortController();
        this.abortController = controller;
        const signal = controller.signal;

        // Planes p±1..radius, nearest first, last scrub direction leading.
        const p = range.index;
        const planes: number[] = [];
        for (let d = 1; d <= radius; d++) {
            for (const q of [p + d * this.lastDirection, p - d * this.lastDirection]) {
                if (q >= 0 && q < range.count && q !== p && !planes.includes(q)) planes.push(q);
            }
        }
        if (!planes.length) return;

        const tasks: Array<() => Promise<void>> = [];
        for (const item of this.host.zItems()) {
            const src = item?.source;
            // Same scope as the swap handler; z-records are gated to rasterBlob.
            if (!src || src._isVector || src.multifetch) continue;
            if ((src._dataFormat || "image") !== "rasterBlob") continue;
            const tiles = (item._lastDrawn || [])
                .map((x: any) => x?.tile)
                .filter((t: any) => t?.loaded);
            for (const q of planes) {
                for (const tile of tiles) {
                    if (q === this.host.originPlane(tile)) continue; // original record covers it
                    const key = this.host.zCacheKey(q, tile);
                    if (tile.getCache?.(key)) continue;
                    tasks.push(() => this.fetchPlaneTile(src, tile, q, key, signal));
                }
            }
        }
        if (!tasks.length) return;

        // Fire every task; concurrency is bounded by the shared request scheduler
        // (background lane, per tile-origin), not a private per-viewer pool. Tasks
        // are launched in nearest-first order, so they enter the scheduler's FIFO
        // queue in that order. `gen`-staleness is covered by `signal` (a new
        // generation aborts this controller). Each task swallows its own error.
        await Promise.all(tasks.map((task) => task().catch(() => {
            // Aborted or failed prefetch — never cached, just dropped.
        })));
    }

    private async fetchPlaneTile(src: any, tile: any, plane: number, key: string, signal: AbortSignal): Promise<void> {
        if (signal.aborted) return;
        const url = this.tileUrlForPlane(src, tile, plane);
        if (!url) return;

        // Bound speculative prefetch through the shared scheduler so it never
        // starves interactive tile loading — one global per-origin budget across
        // all viewers. If `signal` already aborted, acquire rejects → skip.
        const scheduler = (window as any).APPLICATION_CONTEXT?.requestScheduler;
        let release: (() => void) | null = null;
        if (scheduler) {
            release = await scheduler.acquire(originOf(url), { signal }).catch(() => null);
            if (!release) return;   // queued wait aborted (navigation)
        }
        try {
            if (signal.aborted) return;
            const client = src.__xopatHttpClient;
            const res = client?.fetchRaw ? await client.fetchRaw(url, { signal }) : await fetch(url, { signal });
            if (res?.ok === false) throw new Error(`plane prefetch ${res.status}`);
            const blob = await res.blob();
            if (!blob || blob.size === 0 || signal.aborted) return;
            // Tile may have been unloaded during the fetch; addCache also null-guards.
            if (!tile.loaded || !tile.tiledImage) return;
            if (tile.addCache?.(key, blob, "rasterBlob", false)) {
                this.host.registerPlaneCache(tile, key);
            }
        } finally {
            if (release) release();
        }
    }

    /**
     * URL of `tile` at plane `q`. The source's `getTileUrl` reflects the ACTIVE
     * plane, so rewrite its `z` query parameter instead of mutating source state.
     */
    private tileUrlForPlane(src: any, tile: any, q: number): string | null {
        let activeUrl: string;
        try {
            activeUrl = src.getTileUrl(tile.level, tile.x, tile.y);
        } catch (e) {
            return null;
        }
        if (typeof activeUrl !== "string" || !/[?&]z=\d+/.test(activeUrl)) return null;
        return activeUrl.replace(/([?&]z=)\d+/, `$1${q}`);
    }
}
