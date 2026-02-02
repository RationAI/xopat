class ICCProfile extends window.XOpatModuleSingleton {

    constructor() {
        super("icc-profiles");

        this.profileState = new Map();
        this.getCtx = (contextId) => {
            let ctx = this.profileState.get(contextId);
            if (!ctx) {
                ctx = { status: 'loading', queue: [] };
                this.profileState.set(contextId, ctx);
            }
            return ctx;
        };

        this.worker = new Worker(
            new URL('./icc.worker.mjs', import.meta.url),
            { type: 'module' }
        );

        this.ready = new Promise((resolve, reject) => {
            let settled = false;

            const cleanup = () => {
                this.worker.removeEventListener('message', onMessage);
                this.worker.removeEventListener('error', onError);
                this.worker.removeEventListener('messageerror', onMessageError);
            };

            const onMessage = (e) => {
                const msg = e.data;
                if (!msg) return;

                if (msg.type === 'ready') {
                    if (!settled) {
                        settled = true;
                        if (!msg.threads) {
                            console.warn('[ICC] Threads disabled (no cross-origin isolation). Running single-thread.');
                        }
                        cleanup();
                        resolve();
                    }
                } else if (msg.type === 'error') {
                    if (!settled) {
                        settled = true;
                        cleanup();
                        reject(new Error(msg.message ?? msg.reason ?? 'Worker init failed'));
                    } else {
                        // still log later worker errors
                        console.error('[ICC worker error after ready]', msg);
                    }
                }
            };

            const onError = (e) => {
                console.error('Worker script error:', e.message, 'at', e.filename, 'line', e.lineno, 'col', e.colno);
                if (!settled) {
                    settled = true;
                    cleanup();
                    reject(e.error ?? new Error(e.message || 'Worker script error'));
                    this.earlyQueue = null;
                }
            };

            const onMessageError = (e) => {
                console.error('Worker messageerror', e);
                if (!settled) {
                    // treat as non-fatal unless you want to reject here
                    this.earlyQueue = null;
                }
            };

            this.worker.addEventListener('message', onMessage);
            this.worker.addEventListener('error', onError);
            this.worker.addEventListener('messageerror', onMessageError);
        });

        this.loaded = false;
        this.pendingTiles = {};
        this.debugMode = this.getStaticMeta("debugMode", false);

        this.earlyQueue = []; // { ref: WeakRef<Tile>, key, bmp, before?, token }
        this.finalizer = (typeof FinalizationRegistry !== 'undefined')
            ? new FinalizationRegistry((token) => {
                // GC’ed tile → drop its entry
                this.earlyQueue = this.earlyQueue.filter(x => x.token !== token);
            })
            : null;

        VIEWER_MANAGER.addHandler("before-first-open", this.init.bind(this));
    }

    async init() {
        await this.ready;

        VIEWER_MANAGER.broadcastHandler("open", (e) => this.initEvents(e.eventSource));

        this.debug = this.debug || makeDebugPanel();

        this.worker.onmessage = async (e) => {
            const { type, image, bitmap, contextId } = e.data;

            if (type === "profileSet") {
                const ctx = this.getCtx(contextId);
                ctx.status = "ready";

                const q = ctx.queue;
                ctx.queue = [];

                for (const item of q) {
                    // item has: tile, bmp, before?, jobId
                    this.pendingTiles[item.jobId] = this.debugMode
                        ? { tile: item.tile, before: item.before }
                        : { tile: item.tile };

                    this.worker.postMessage(
                        { type: "processBitmap", bitmap: item.bmp, contextId: item.jobId },
                        [item.bmp]
                    );
                }
                return;
            }

            if (type === 'done') {
                const tile = this.pendingTiles[contextId];
                if (!tile) return;

                // Convert raw RGB back to RGBA
                const rgb = new Uint8Array(image);
                const rgba = new Uint8ClampedArray((rgb.length/3) * 4);
                for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
                    rgba[j]   = rgb[i];
                    rgba[j+1] = rgb[i+1];
                    rgba[j+2] = rgb[i+2];
                    rgba[j+3] = 255;
                }

                const canvas = document.createElement('canvas');
                canvas.width = tile.source.bounds.width;   // or tile.source.dimensions?
                canvas.height = tile.source.bounds.height;
                const ctx = canvas.getContext('2d');
                ctx.putImageData(new ImageData(rgba, canvas.width, canvas.height), 0, 0);

                // Update tile’s image (this will be drawn by OSD)
                tile.getCanvasContext = () => ctx;
                tile.context2D = ctx;
                tile.hasTransparencyChannel = false;

                delete this.pendingTiles[contextId];
                window.VIEWER.forceRedraw();

            } else if (type === 'doneBitmap') {
                const rec = this.pendingTiles[contextId];
                if (!rec) return;
                const { tile, before } = rec;
                delete this.pendingTiles[contextId];

                if (this.debugMode && before) {
                    this.debug = this.debug || makeDebugPanel();
                    await drawBitmapToCanvas(before, this.debug.before);
                    await drawBitmapToCanvas(bitmap, this.debug.after);
                    drawDelta(this.debug.before, this.debug.after, this.debug.delta);
                    // free the extra bitmap we created just for debug
                    if (before.close) before.close();
                }

                // patch the tile (always)
                if (tile.context2D) delete tile.context2D;
                const cache = tile.cacheImageRecord;
                if (cache._renderedContext) delete cache._renderedContext;
                cache._data = bitmap;

                window.VIEWER.forceRedraw();
            }
        };
    }

    initEvents(viewer) {
        viewer.world.addHandler("add-item", (e) => {
            const source = e.item.source;
            if (!source?.downloadICCProfile) return;

            const contextId = source.url;          // stable per slide/source
            const ctx = this.getCtx(contextId);

            // Only fetch once per context
            if (ctx.status === "ready" || ctx.status === "none" || ctx.status === "error") return;
            if (ctx.status === "loading" && ctx._started) return;
            ctx._started = true;

            source.downloadICCProfile()
                .then((data) => {
                    if (data == null) {
                        ctx.status = "none";            // no profile -> process without conversion
                        // optionally: drain queued tiles without conversion (or just drop queue)
                        ctx.queue.length = 0;
                        return;
                    }
                    if (!(data instanceof ArrayBuffer)) {
                        ctx.status = "error";
                        ctx.queue.length = 0;
                        throw new Error("Invalid ICC profile data (expected ArrayBuffer)");
                    }

                    // Ask worker to install the profile for THIS contextId
                    this.worker.postMessage({ type: "setProfile", profile: data, contextId }, [data]);
                    // status flips to "ready" when worker replies profileSet for this contextId
                })
                .catch((err) => {
                    console.warn("[ICC] Failed to load profile; continuing without conversion", err);
                    ctx.status = "error";
                    ctx.queue.length = 0;
                });
        });
        // window.VIEWER.world.addHandler("remove-item", (e) => {
        //     remove unused profiles
        // });

        viewer.addHandler("tile-loaded", async (e) => {
            if (!e.data) return;
            const source = e.tiledImage?.source;
            if (!source?.downloadICCProfile) return;

            const contextId = source.url;
            const ctx = this.getCtx(contextId);

            const jobId = e.tile.cacheKey;
            const data = e.data;

            let bmpForWorker;
            let beforeForDebug = null;

            if (data instanceof HTMLImageElement) {
                bmpForWorker = await createImageBitmap(data);
                if (this.debugMode) beforeForDebug = await createImageBitmap(data);
            } else if (data instanceof CanvasRenderingContext2D) {
                bmpForWorker = data.canvas.transferToImageBitmap();
                if (this.debugMode) beforeForDebug = data.canvas.transferToImageBitmap();
            } else if (data instanceof HTMLCanvasElement) {
                bmpForWorker = data.transferToImageBitmap();
                if (this.debugMode) beforeForDebug = data.transferToImageBitmap();
            } else {
                console.warn("tile-loaded: unsupported data type", data);
                return;
            }

            // If profile isn't ready, queue for this context
            if (ctx.status === "loading") {
                ctx.queue.push({ tile: e.tile, bmp: bmpForWorker, before: beforeForDebug, jobId });
                return;
            }

            // If no profile (or failed), you can either:
            // (a) do nothing (no conversion), OR
            // (b) still processBitmap with an identity transform in worker
            if (ctx.status !== "ready") return;

            this.pendingTiles[jobId] = this.debugMode
                ? { tile: e.tile, before: beforeForDebug }
                : { tile: e.tile };

            this.worker.postMessage(
                { type: "processBitmap", bitmap: bmpForWorker, contextId: jobId },
                [bmpForWorker]
            );
        }, null, Infinity);
    }

    attachIccToViewer(viewer, iccClient) {
        // Run early in the invalidation pipeline (priority < 0 tends to run earlier than default 0)
        viewer.addHandler(
            "tile-invalidated",
            async (e) => {
                const tile = e.tile;
                const tiledImage = e.tiledImage;

                // 1) Decide whether this tile should be color-managed
                //    (you likely key off the TileSource or item metadata)
                const source = tiledImage?.source;
                const ctxId = source?.url || source?.id || tiledImage?.id;
                if (!ctxId) return;

                // If profile not ready yet, do nothing (tile draws uncorrected for now).
                // Optionally you can trigger download here, then requestInvalidate later.
                if (!iccClient.hasProfileFor(ctxId)) return;

                // 2) Get the cache record that is about to become the drawable "main cache".
                //    In this prerelease, the mutation point is the cache record, NOT tile.image/context2D.
                //
                //    Different builds pass different properties; prefer e.cache if present, else tile.getCache().
                const cache =
                    e.cache || e.cacheRecord || tile.getCache?.(tile.cacheKey) || tile.getCache?.();
                if (!cache) return;

                // 3) Get an ImageBitmap from the cache (copy=true by default; safe for transfer)
                //    If your cache already *is* an ImageBitmap, this stays cheap.
                const bmp = await cache.getDataAs("imageBitmap"); // CacheRecord.getDataAs(...) :contentReference[oaicite:8]{index=8}
                if (!bmp) return;

                // 4) Process in worker and write back into THE cache record.
                const corrected = await iccClient.processBitmapForContext(ctxId, bmp);

                // 5) Replace cached data so future draws/viewport changes reuse corrected pixels.
                //    This is the “put it into the original cache” step you want.
                await cache.setDataAs(corrected, "imageBitmap"); // CacheRecord.setDataAs(...) :contentReference[oaicite:9]{index=9}
            },
            null,
            -10
        );
    }
}

function makeDebugPanel() {
    const host = document.createElement('div');
    host.style.cssText = `
    position:fixed; right:12px; bottom:12px; z-index:99999;
    background:#111a; backdrop-filter:saturate(1.2) blur(4px);
    padding:8px; border-radius:10px; color:#fff; font:12px/1.4 system-ui;
    display:flex; gap:8px; align-items:flex-start;
  `;
    host.innerHTML = `
    <div style="display:flex;gap:8px;">
      <div><div>Before</div><canvas id="dbgBefore" width="1" height="1" style="border:1px solid #444;"></canvas></div>
      <div><div>After</div><canvas id="dbgAfter"  width="1" height="1" style="border:1px solid #444;"></canvas></div>
      <div><div>Δ</div><canvas id="dbgDelta"  width="1" height="1" style="border:1px solid #444;"></canvas></div>
    </div>
    <button id="dbgClose" style="margin-left:6px;">✕</button>
  `;
    host.querySelector('#dbgClose').onclick = () => host.remove();
    document.body.appendChild(host);
    return {
        root: host,
        before: host.querySelector('#dbgBefore'),
        after:  host.querySelector('#dbgAfter'),
        delta:  host.querySelector('#dbgDelta'),
    };
}
async function drawBitmapToCanvas(bmp, canvas) {
    canvas.width  = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true /* and optionally: colorSpace: 'srgb' */ });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bmp, 0, 0);
}

// Make a quick visual difference map (absolute per-channel, averaged)
function drawDelta(beforeCanvas, afterCanvas, deltaCanvas) {
    const w = Math.min(beforeCanvas.width, afterCanvas.width);
    const h = Math.min(beforeCanvas.height, afterCanvas.height);
    deltaCanvas.width = w; deltaCanvas.height = h;

    const bctx = beforeCanvas.getContext('2d', { willReadFrequently: true });
    const actx = afterCanvas.getContext('2d',  { willReadFrequently: true });
    const dctx = deltaCanvas.getContext('2d');

    const b = bctx.getImageData(0, 0, w, h).data;
    const a = actx.getImageData(0, 0, w, h).data;
    const out = new Uint8ClampedArray(w*h*4);

    for (let i=0, j=0; i<b.length && i<a.length; i+=4, j+=4) {
        const dr = Math.abs(a[i]   - b[i]);
        const dg = Math.abs(a[i+1] - b[i+1]);
        const db = Math.abs(a[i+2] - b[i+2]);
        const d  = Math.min(255, (dr + dg + db) / 3 * 2); // amplify a bit
        out[j]   = d; out[j+1] = d; out[j+2] = d; out[j+3] = 255;
    }
    dctx.putImageData(new ImageData(out, w, h), 0, 0);
}
ICCProfile.instance();

