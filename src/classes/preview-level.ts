/**
 * Synthetic preview level — a generic `OpenSeadragon.TileSource` extension.
 *
 * Problem: some pyramids (DICOMweb notably) start with a coarsest level that is
 * already large (several tiles). OSD must cover the viewport with that level on
 * open, so the first paint waits for many tile requests. Meanwhile most such
 * sources expose a cheap whole-slide preview via the `getThumbnail()` extension
 * (see `src/tile-source.ts`).
 *
 * `tryInjectPreviewLevel()` patches the *instance* in place: pyramid levels
 * shift up by one and a synthetic single-tile level 0 is added whose tile
 * content is the slide preview. The preview is fetched lazily inside OSD's
 * normal async tile-job pipeline (never blocking the open) and cached across
 * open/close cycles keyed by `tileSourceId`, so reopening a slide costs zero
 * preview requests.
 *
 * Any protocol implementing `getThumbnail()` benefits automatically — no
 * per-protocol code. Opt out by setting `__noPreviewLevel = true` on the
 * source (e.g. sources whose thumbnail does not depict the full extent, or
 * sources that swap to a different level *count* in place — an in-place swap
 * that preserves the level count, like z-stack focal planes, is fine).
 *
 * Level-numbering contract of the patch:
 *  - OSD (and anything holding tile/context objects) lives in the NEW
 *    numbering: synthetic level 0, old level L at L+1, `maxLevel = old + 1`.
 *  - Captured protocol originals live in the OLD numbering and may read
 *    `this.maxLevel` dynamically (DICOM does). Level-argument methods are
 *    therefore delegated with `level - 1` against a Proxy shim that exposes
 *    the OLD `maxLevel` and the OLD method set.
 *  - `downloadTileStart`/`downloadTileAbort` receive context objects carrying
 *    NEW-numbered `tile.level`, so they are delegated with `this = source`
 *    (the patched, NEW-numbered world) — protocol code like DICOM's
 *    `_getTile` that calls `this.getTileWidth(context.tile.level)` then
 *    resolves through the patched translators and stays correct.
 */

type AnyTileSource = any;

/** Inject only when the coarsest level exceeds this pixel dimension. */
const PREVIEW_LEVEL_MIN_COARSEST_PX = 2048;
/** Target max pixel dimension of the synthetic level (halved from the coarsest scale). */
const PREVIEW_LEVEL_TARGET_PX = 1024;
const PREVIEW_URL_SCHEME = "xopat-preview://";
const PREVIEW_CACHE_LIMIT = 32;
/** Relative aspect-ratio deviation above which the preview is center-cropped to the slide aspect. */
const PREVIEW_ASPECT_TOLERANCE = 0.02;

// LRU preview cache. Keyed by `tileSourceId` (never by URL — DICOMweb shares
// its baseUrl across slides). Stores the in-flight/settled promise so
// concurrent tile jobs and reopen cycles all share one download.
const _previewCache = new Map<string, Promise<Blob | null>>();
// Sources without a `tileSourceId` cache per-instance only.
const _instancePreviewCache = new WeakMap<object, Promise<Blob | null>>();
let _anonPreviewCounter = 0;

function _getPreviewBlob(source: AnyTileSource): Promise<Blob | null> {
    const key: string | undefined = source.tileSourceId;
    if (key) {
        const hit = _previewCache.get(key);
        if (hit) {
            // refresh LRU position
            _previewCache.delete(key);
            _previewCache.set(key, hit);
            return hit;
        }
    } else {
        const hit = _instancePreviewCache.get(source);
        if (hit) return hit;
    }

    const promise = _fetchAndNormalizePreview(source).catch((e: any) => {
        console.debug("[preview-level] preview fetch failed:", e?.message ?? e);
        return null;
    });

    if (key) {
        _previewCache.set(key, promise);
        while (_previewCache.size > PREVIEW_CACHE_LIMIT) {
            const oldest = _previewCache.keys().next().value;
            if (oldest === undefined) break;
            _previewCache.delete(oldest);
        }
        // A failed fetch must not poison the cache — retry on next request.
        promise.then(blob => {
            if (blob === null && _previewCache.get(key) === promise) _previewCache.delete(key);
        });
    } else {
        _instancePreviewCache.set(source, promise);
        promise.then(blob => {
            if (blob === null && _instancePreviewCache.get(source) === promise) _instancePreviewCache.delete(source);
        });
    }
    return promise;
}

/**
 * Fetch the preview via `getThumbnail()` and normalize it to a Blob of
 * EXACTLY the synthetic level's pixel dimensions (`__previewLevelDims`,
 * stamped at injection). This is a hard requirement, not an optimization
 * concern: OSD's drawers crop the texture by
 * `getTileBounds(level, x, y, isSource: true)` — the synthetic tile size —
 * so a preview whose raw pixel dimensions differ would be sampled past its
 * edge and render cut/misaligned. Aspect deviations (e.g. padded DICOM
 * OVERVIEW frames) are center-cropped (cover) before scaling.
 */
async function _fetchAndNormalizePreview(source: AnyTileSource): Promise<Blob | null> {
    const raw = await source.getThumbnail();
    if (!raw) return null;

    const dims = source.__previewLevelDims;
    const outW: number = dims?.w;
    const outH: number = dims?.h;
    if (!(outW > 0) || !(outH > 0)) return null;
    const dstAspect = outW / outH;

    let drawable: ImageBitmap | HTMLImageElement | HTMLCanvasElement | null = null;
    try {
        const UTILITIES = (window as any).UTILITIES;
        if (raw instanceof Blob) {
            try {
                drawable = await createImageBitmap(raw);
            } catch {
                drawable = await UTILITIES.imageLikeToImage(raw);
            }
        } else {
            drawable = await UTILITIES.imageLikeToImage(raw);
        }
        if (!drawable) return null;

        const w = (drawable as any).naturalWidth || drawable.width;
        const h = (drawable as any).naturalHeight || drawable.height;
        if (!(w > 0) || !(h > 0)) return null;

        // Center-crop (cover) to the synthetic level aspect when deviating.
        const srcAspect = w / h;
        let cropW = w, cropH = h;
        if (Math.abs(srcAspect - dstAspect) / dstAspect > PREVIEW_ASPECT_TOLERANCE) {
            if (srcAspect > dstAspect) cropW = h * dstAspect;
            else cropH = w / dstAspect;
        }
        const sx = (w - cropW) / 2;
        const sy = (h - cropH) / 2;

        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(drawable, sx, sy, cropW, cropH, 0, 0, outW, outH);

        return await new Promise<Blob | null>(resolve =>
            canvas.toBlob(b => resolve(b), "image/jpeg", 0.9));
    } finally {
        (drawable as any)?.close?.();
    }
}

function _servePreviewTile(source: AnyTileSource, context: any): void {
    const controller = new AbortController();
    context.userData.abortController = controller;

    _getPreviewBlob(source).then(blob => {
        if (controller.signal.aborted) return;
        if (!blob) {
            // Tile fails once (`tile.exists = false`, retries capped by
            // `viewer.tileRetryMax`) and OSD degrades to the real levels.
            context.fail("Slide preview unavailable.", null);
        } else {
            context.finish(blob, null, "rasterBlob");
        }
    }).catch((e: any) => {
        if (controller.signal.aborted) return;
        context.fail(e?.message ?? String(e), null);
    });
}

/**
 * Methods delegated in the OLD numbering (first argument is a level) — patched
 * only when the protocol overrides the base implementation; the base versions
 * self-derive from the patched primitives and stay correct untouched.
 */
const CONDITIONAL_LEVEL_METHODS = [
    "getNumTiles", "getTilePostData", "getTileAjaxHeaders", "getTileHashKey",
    "tileExists", "getPixelRatio", "getTileBounds", "getTileAtPoint",
] as const;

function _injectPreviewLevel(source: AnyTileSource): boolean {
    const OpenSeadragon = (window as any).OpenSeadragon;
    const baseProto = OpenSeadragon.TileSource.prototype;

    const fullW = source.width ?? source.dimensions?.x;
    const fullH = source.height ?? source.dimensions?.y;
    // NOTE: this gate call also forces the base lazy `getLevelScale`
    // memoization to run *before* we capture originals — the memoizer would
    // otherwise overwrite the patched method on first delegated call.
    const coarsestScale = source.getLevelScale(source.minLevel);
    if (!(fullW > 0) || !(fullH > 0) || !(coarsestScale > 0)) return false;
    if (Math.max(fullW, fullH) * coarsestScale <= PREVIEW_LEVEL_MIN_COARSEST_PX) return false;

    // Synthetic geometry: exact halvings of the coarsest scale keep OSD's
    // `_getLevelsInterval` log2 heuristic an over-bound (the safe direction —
    // per-level actual-ratio checks clamp the rest).
    let scale0 = coarsestScale;
    while (Math.max(fullW, fullH) * scale0 > PREVIEW_LEVEL_TARGET_PX) scale0 /= 2;
    const synthW = Math.max(1, Math.ceil(fullW * scale0));
    const synthH = Math.max(1, Math.ceil(fullH * scale0));

    const oldMax: number = source.maxLevel;
    const origs: Record<string, (...args: any[]) => any> = {};
    const patchedKeys = new Set<string>();

    // OLD-numbering world for the captured originals: exposes the pre-patch
    // `maxLevel` and the pre-patch method set, so protocol-internal math
    // (e.g. DICOM's `this.maxLevel - level`) stays consistent. Other function
    // properties bind to the shim too, so base helpers reached from an
    // original (e.g. base `getNumTiles` → `this.getLevelScale`) also resolve
    // into the OLD world.
    const shim: any = new Proxy(source, {
        get(target, key) {
            if (key === "maxLevel") return oldMax;
            const orig = typeof key === "string" ? origs[key] : undefined;
            if (orig) return (...args: any[]) => orig.apply(shim, args);
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(shim) : value;
        },
        set(target, key, value) {
            // Never let a delegated original clobber a patched method on the
            // real instance (e.g. base `_memoizeLevelScale` reinstalling
            // `getLevelScale` — pre-empted by the gate call above, but guard
            // regardless).
            if (typeof key === "string" && patchedKeys.has(key)) return true;
            return Reflect.set(target, key, value);
        },
    });

    const capture = (name: string) => {
        const fn = source[name];
        if (typeof fn === "function") origs[name] = fn;
        return origs[name];
    };
    // Patches are collected first and applied atomically at the end — a throw
    // while computing them must not leave a half-shifted source.
    const pending: Array<[string, (...args: any[]) => any]> = [];
    const patch = (name: string, fn: (...args: any[]) => any) => {
        capture(name);
        patchedKeys.add(name);
        pending.push([name, fn]);
    };

    // ── Always-patched primitives ──────────────────────────────────────────
    const origLevelScale = capture("getLevelScale")!;
    patch("getLevelScale", function (level: number) {
        return level === 0 ? scale0 : origLevelScale.apply(shim, [level - 1]);
    });
    const origTileWidth = capture("getTileWidth")!;
    patch("getTileWidth", function (level: number) {
        return level === 0 ? synthW : origTileWidth.apply(shim, [level - 1]);
    });
    const origTileHeight = capture("getTileHeight")!;
    patch("getTileHeight", function (level: number) {
        return level === 0 ? synthH : origTileHeight.apply(shim, [level - 1]);
    });
    // The URL doubles as OSD's default tile-cache hash key — it must be unique
    // per slide, or two previews could alias in the cache.
    const previewUrl = PREVIEW_URL_SCHEME
        + (source.tileSourceId || source._uniqueIdentifier || `anonymous-${++_anonPreviewCounter}`);
    const origTileUrl = capture("getTileUrl")!;
    patch("getTileUrl", function (level: number, x: number, y: number) {
        return level === 0 ? previewUrl : origTileUrl.apply(shim, [level - 1, x, y]);
    });
    const origDownloadStart = capture("downloadTileStart")!;
    patch("downloadTileStart", function (this: AnyTileSource, context: any) {
        if (typeof context?.src === "string" && context.src.startsWith(PREVIEW_URL_SCHEME)) {
            _servePreviewTile(source, context);
        } else {
            // NEW-numbered world on purpose: the context carries NEW `tile.level`.
            origDownloadStart.call(source, context);
        }
    });
    const origAbort = capture("downloadTileAbort");
    patch("downloadTileAbort", function (context: any) {
        if (typeof context?.src === "string" && context.src.startsWith(PREVIEW_URL_SCHEME)) {
            context.userData?.abortController?.abort?.();
            if (context.userData) context.userData.abortController = null;
        } else if (origAbort) {
            origAbort.call(source, context);
        }
    });

    // ── Protocol overrides of derived methods: translate levels ────────────
    for (const name of CONDITIONAL_LEVEL_METHODS) {
        if (typeof source[name] !== "function" || source[name] === baseProto[name]) continue;
        const orig = capture(name)!;
        patch(name, function (level: number, ...rest: any[]) {
            if (level === 0) return baseProto[name].call(source, 0, ...rest);
            return orig.apply(shim, [level - 1, ...rest]);
        });
    }
    // `getClosestLevel` takes no level argument but *returns* one.
    if (typeof source.getClosestLevel === "function" && source.getClosestLevel !== baseProto.getClosestLevel) {
        const origClosest = capture("getClosestLevel")!;
        patch("getClosestLevel", function () {
            return origClosest.apply(shim, []) + 1;
        });
    }

    for (const [name, fn] of pending) source[name] = fn;
    // Direct assignment — `setMaxLevel()` would re-memoize `getLevelScale`
    // over the patch. `minLevel` stays 0 (guaranteed by the caller's gate).
    source.maxLevel = oldMax + 1;
    // The normalizer MUST render the preview at exactly these dimensions —
    // OSD crops the texture by the synthetic tile's source bounds.
    source.__previewLevelDims = { w: synthW, h: synthH };
    source.__previewLevelInjected = true;

    // Warm start: begin (or reuse) the preview download right away, in
    // parallel with `addTiledImage` — the synthetic tile job just awaits the
    // same shared promise, so the UI never blocks on it.
    _getPreviewBlob(source);
    return true;
}

/**
 * Extension of OpenSeadragon: inject a synthetic single-tile coarsest level
 * backed by `getThumbnail()`. No-op (returns false) unless all of:
 *  - the `syntheticPreviewLevel` option is enabled,
 *  - the source is ready, has `minLevel === 0` and known dimensions,
 *  - the protocol implements `getThumbnail()` (base default is a no-op),
 *  - the coarsest level exceeds {@link PREVIEW_LEVEL_MIN_COARSEST_PX},
 *  - the source did not opt out via `__noPreviewLevel = true`.
 * Idempotent; safe to call from any consumer that instantiates tile sources.
 * @memberOf OpenSeadragon.TileSource
 * @function tryInjectPreviewLevel
 * @return {boolean} true when the level was injected
 */
(window as any).OpenSeadragon.TileSource.prototype.tryInjectPreviewLevel = function (): boolean {
    const source: AnyTileSource = this;
    if (source.__previewLevelInjected) return true;
    if (source.__noPreviewLevel === true) return false;

    const ctx = (window as any).APPLICATION_CONTEXT;
    if (ctx && !ctx.getOption("syntheticPreviewLevel", true)) return false;

    if (!source.ready) return false;
    if (source.minLevel !== 0) return false;

    const baseProto = (window as any).OpenSeadragon.TileSource.prototype;
    if (typeof source.getThumbnail !== "function" || source.getThumbnail === baseProto.getThumbnail) return false;

    try {
        return _injectPreviewLevel(source);
    } catch (e) {
        console.warn("[preview-level] injection failed, source left untouched:", e);
        return false;
    }
};

export {};
