class ICCProfile extends window.XOpatModuleSingleton {

    constructor() {
        super("icc-profiles");

//         // In the module on the main thread (where you create the worker)
//         const workerEntry = new URL('./icc.worker.mjs', import.meta.url); // absolute URL to your real worker
//
//         const bootstrapSrc = `
// self.addEventListener('error', e => {
//   self.postMessage({type:'bootstrap-error', message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno, stack: e.error?.stack });
// });
// self.addEventListener('unhandledrejection', e => {
//   self.postMessage({type:'bootstrap-error', message: String(e.reason), stack: e.reason?.stack });
// });
//
// (async () => {
//   try {
//     // IMPORTANT: use absolute URL injected from main thread
//     await import(${JSON.stringify(workerEntry.href)});
//   } catch (err) {
//     self.postMessage({ type: 'bootstrap-error', message: String(err), stack: err?.stack });
//   }
// })();
// `;
//
//         const blob = new Blob([bootstrapSrc], { type: 'application/javascript' });
//         const bootstrapURL = URL.createObjectURL(blob);
//         const worker = new Worker(bootstrapURL, { type: 'module' });
//
// // optional: clean up once ready
// // worker.addEventListener('message', (e) => { if (e.data?.type === 'ready') URL.revokeObjectURL(bootstrapURL); });
//
//         worker.addEventListener('message', (e) => {
//             if (e.data?.type === 'bootstrap-error') {
//                 console.error('Bootstrap caught worker init error:', e.data.message, e.data.stack);
//             } else {
//                 console.log('Worker bootstrap complete:', e.data?.type, e.data?.message, e.data?.stack);
//             }
//         });


        this.worker = new Worker(
            new URL('./icc.worker.mjs', import.meta.url),
            { type: 'module' }
        );

        this.ready = new Promise((res, rej) => {
            this.worker.addEventListener('message', (e) => {
                const msg = e.data;
                if (!msg) return;

                if (msg.type === 'ready') {
                    // Optional: warn if threads disabled
                    if (!msg.threads) {
                        console.warn('[ICC] Threads disabled (no cross-origin isolation). Running single-thread.');
                    }
                    res();
                } else if (msg.type === 'error') {
                    rej(new Error(msg.message ?? msg.reason ?? 'Worker init failed'));
                }
            });

            this.worker.addEventListener('error', (e) => {
                // Default is "Worker script error"
                console.error('Worker script error:', e.message, 'at', e.filename, 'line', e.lineno, 'col', e.colno);
                rej(e.error ?? new Error(e.message));
            });

            this.worker.addEventListener('messageerror', (e) => {
                console.error('Worker messageerror', e);
            });
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


        VIEWER.addHandler("before-first-open", this.init.bind(this));
    }

    async init() {
        await this.ready;

        this.debug = this.debug || makeDebugPanel();

        this.worker.onmessage = async (e) => {
            const { type, image, bitmap, tileId } = e.data;

            if (type === 'profileSet') {
                this.loaded = true;
                const q = this.earlyQueue;
                this.earlyQueue = []; // drain (we’ll re-queue any that are null)
                for (const item of q) {
                    const tile = item.ref.deref?.() ?? null;
                    if (!tile) { continue; } // tile no longer alive
                    // remember tile for the response
                    this.pendingTiles[item.key] = this.debugMode
                        ? { tile, before: item.before }
                        : { tile };

                    // ship the bitmap we saved
                    this.worker.postMessage(
                        { type: 'processBitmap', bitmap: item.bmp, tileId: item.key },
                        [item.bmp]
                    );
                }

                return;
            }

            if (type === 'done') {
                const tile = this.pendingTiles[tileId];
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

                delete this.pendingTiles[tileId];
                window.VIEWER.forceRedraw();

            } else if (type === 'doneBitmap') {
                const rec = this.pendingTiles[tileId];
                if (!rec) return;
                const { tile, before } = rec;
                delete this.pendingTiles[tileId];

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

        window.VIEWER.world.addHandler("add-item", e => {
            const source = e.item.source;

            // todo support more than one profile
            if (!this.loaded && source.downloadICCProfile) {
                source.downloadICCProfile().then(data => {
                    if (data instanceof ArrayBuffer) {
                        this.worker.postMessage({ type: 'setProfile', profile: data }, [data]);
                    } else {
                        throw new Error("Invalid profile data!");
                    }
                }).catch(console.error);
            }
        });

        // window.VIEWER.world.addHandler("remove-item", (e) => {
        //     remove unused profiles
        // });

        window.VIEWER.addHandler('tile-loaded', async e => {
            if (!e.data) return;
            const source = e.tiledImage?.source;
            if (!source?.downloadICCProfile) return;

            const jobId = e.tile.cacheKey;
            const data = e.data;

            let bmpForWorker;
            let beforeForDebug = null; // only created in debug mode

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
                console.warn('tile-loaded: unsupported data type', data);
                return;
            }

            if (!this.loaded) {
                // --- profile not ready yet → queue weakly ---
                const token = Symbol(jobId);
                const rec = { ref: new WeakRef(e.tile), key: jobId, bmp: bmpForWorker, before: beforeForDebug, token };
                this.earlyQueue.push(rec);
                if (this.finalizer) this.finalizer.register(e.tile, token, rec);

                // Do NOT store strong refs in pendingTiles yet.
                return;
            }

            // store only what we need
            this.pendingTiles[jobId] = this.debugMode
                ? { tile: e.tile, before: beforeForDebug }
                : { tile: e.tile };

            this.worker.postMessage(
                { type: 'processBitmap', bitmap: bmpForWorker, tileId: jobId },
                [bmpForWorker] // transfer
            );
        }, null, Infinity);
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

