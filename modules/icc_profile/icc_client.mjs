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
        this._seq = 0;
        this._jobs = new Map(); // requestId -> { resolve, reject, before? }
        this.debugMode = this.getStaticMeta("debugMode", false);

        this.earlyQueue = []; // { ref: WeakRef<Tile>, key, bmp, before?, token }
        this.finalizer = (typeof FinalizationRegistry !== 'undefined')
            ? new FinalizationRegistry((token) => {
                // GC’ed tile → drop its entry
                this.earlyQueue = this.earlyQueue.filter(x => x.token !== token);
            })
            : null;

        // todo possible race condition: viewer created before worker ready?
        this.init();
    }

    async init() {
        await this.ready;
        this.debug = this.debug || makeDebugPanel();

        VIEWER_MANAGER.addHandler("viewer-create", (e) => this.initEvents(e.viewer));

        this.worker.onmessage = async (e) => {
            const msg = e.data || {};
            const { type, contextId } = msg;

            if (type === "profileSet") {
                const ctx = this.getCtx(contextId);
                ctx.status = "ready";

                const job = this._jobs.get(contextId);
                if (job) {
                    this._jobs.delete(contextId);
                    job.resolve(true);
                }
                return;
            }

            if (type === "doneBitmap") {
                const job = this._jobs.get(contextId);
                if (!job) return;
                this._jobs.delete(contextId);

                const { bitmap } = msg;

                if (this.debugMode && job.before) {
                    this.debug = this.debug || makeDebugPanel();
                    await drawBitmapToCanvas(job.before, this.debug.before);
                    await drawBitmapToCanvas(bitmap, this.debug.after);
                    drawDelta(this.debug.before, this.debug.after, this.debug.delta);
                    if (job.before.close) job.before.close();
                }

                job.resolve(bitmap);
                return;
            }

            // Keep legacy "done" support (optional), but resolve via jobs too.
            if (type === "done") {
                const job = this._jobs.get(contextId);
                if (!job) return;
                this._jobs.delete(contextId);

                const { image } = msg; // raw RGB ArrayBuffer
                job.resolve(image);
                return;
            }

            if (type === "error") {
                const job = this._jobs.get(contextId);
                if (job) {
                    this._jobs.delete(contextId);
                    job.reject(new Error(msg.message ?? msg.reason ?? "ICC worker error"));
                } else {
                    console.error("[ICC worker error]", msg);
                }
            }
        };
    }

    initEvents(viewer) {
        viewer.addHandler("tile-source-created", async (e) => {
            const source = e.tileSource;
            if (!source?.downloadICCProfile) return;

            const contextId = source.url;
            const ctx = this.getCtx(contextId);

            // Prevent duplicate loading
            if (ctx.status !== "loading" && ctx._started) return;
            ctx._started = true;

            // 1. Create a promise that resolves ONLY when the Worker is fully ready
            ctx.readyPromise = new Promise((resolve, reject) => {
                source.downloadICCProfile()
                    .then((data) => {
                        if (data == null) {
                            ctx.status = "none";
                            resolve(false); // No profile needed
                            return;
                        }
                        if (!(data instanceof ArrayBuffer)) {
                            throw new Error("Invalid ICC profile data");
                        }

                        // We hijack the existing job system to wait for the worker's reply
                        this._jobs.set(contextId, {
                            resolve: () => {
                                ctx.status = "ready";
                                resolve(true); // Profile ready!
                            },
                            reject: (err) => {
                                ctx.status = "error";
                                reject(err);
                            }
                        });

                        // Send to worker
                        this.worker.postMessage({ type: "setProfile", profile: data, contextId }, [data]);
                    })
                    .catch((err) => {
                        console.warn("[ICC] Failed to load profile", err);
                        ctx.status = "error";
                        resolve(false); // Graceful degradation
                    });
            });

            // 3. Return the promise so the event emitter waits (if it supports it)
            return ctx.readyPromise;
        });

        viewer.addHandler(
            "tile-invalidated",
            async (e) => {
                const tile = e.tile;
                const tiledImage = e.tiledImage;
                const source = tiledImage?.source;
                const ctxId = source?.url || source?.id || tiledImage?.id;

                if (!ctxId) return;

                // [FIX] Access the raw context to check for the promise
                const ctx = this.profileState.get(ctxId);

                // 4. BLOCKING WAIT: If we are loading, pause this tile until ready
                if (ctx && ctx.status === 'loading' && ctx.readyPromise) {
                    await ctx.readyPromise;
                }

                // 5. Now check if we actually have a profile (ready)
                if (!this.hasProfileFor(ctxId)) return;

                const cache = tile.getCache();
                if (!cache) return;
                if (cache.withTileReference) cache.withTileReference(tile);

                const bmp = await cache.getDataAs("imageBitmap");
                if (!bmp) return;

                const before = this.debugMode ? await cache.getDataAs("imageBitmap") : null;

                // Since we awaited above, the worker is guaranteed ready now
                const corrected = await this.processBitmapForContext(ctxId, bmp, before);
                await cache.setDataAs(corrected, "imageBitmap");
            },
            null,
            -10
        );
    }

    hasProfileFor(contextId) {
        const ctx = this.profileState.get(contextId);
        return ctx?.status === "ready";
    }

    processBitmapForContext(profileContextId, bmp, beforeForDebug = null) {
        // requestId is just for correlating the response
        const requestId = `${profileContextId}::${++this._seq}`;

        return new Promise((resolve, reject) => {
            this._jobs.set(requestId, { resolve, reject, before: beforeForDebug });

            this.worker.postMessage(
                {
                    type: "processBitmap",
                    bitmap: bmp,
                    contextId: requestId,
                    // if you later support multiple profiles concurrently, you can add:
                    // profileContextId
                },
                [bmp]
            );
        });
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

