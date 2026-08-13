class ICCProfile extends window.XOpatModuleSingleton {

    constructor() {
        super();

        this.profileState = new Map();
        /** Sources already reported as carrying uncorrectable tile data. */
        this._warnedUncorrectable = new Set();
        this.getCtx = (contextId) => {
            let ctx = this.profileState.get(contextId);
            if (!ctx) {
                ctx = { status: 'loading', queue: [] };
                this.profileState.set(contextId, ctx);
            }
            return ctx;
        };

        // A pool, not a single worker: correction is per tile, and one worker made
        // every tile of an opening slide queue behind every other one.
        const poolSize = Math.max(1, Math.min(navigator?.hardwareConcurrency || 2, ICC_MAX_WORKERS));
        this._workers = Array.from({ length: poolSize }, () => new Worker(
            new URL('./icc.worker.mjs', import.meta.url),
            { type: 'module' }
        ));
        this._nextWorker = 0;
        /** contextId -> outstanding `profileSet` acknowledgements. */
        this._profileAcks = new Map();

        this.ready = Promise.all(this._workers.map(worker => new Promise((resolve, reject) => {
            let settled = false;

            const cleanup = () => {
                worker.removeEventListener('message', onMessage);
                worker.removeEventListener('error', onError);
                worker.removeEventListener('messageerror', onMessageError);
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
                }
            };

            const onMessageError = (e) => {
                // treat as non-fatal; init failures surface via onError
                console.error('Worker messageerror', e);
            };

            worker.addEventListener('message', onMessage);
            worker.addEventListener('error', onError);
            worker.addEventListener('messageerror', onMessageError);
        })));

        this.loaded = false;
        this._seq = 0;
        this._jobs = new Map(); // requestId -> { resolve, reject, before? }
        this.debugMode = this.getStaticMeta("debugMode", false);

        this.init();
    }

    async init() {
        // Handler registration MUST happen synchronously (before the first
        // `await`): the open pipeline raises `tile-source-created` awaited
        // before `addTiledImage`, long before the ~230 KB WASM finishes
        // loading on a cold cache. Registering only after `this.ready` left
        // the first-opened slide permanently uncorrected (no handler → no
        // profile fetch → `hasProfileFor` false forever). Handlers gate
        // worker use themselves: `_onTileSourceCreated` awaits `this.ready`
        // before posting to the worker, `_onTileInvalidated` waits on
        // `ctx.readyPromise`.
        //
        // Use `broadcastHandler` so the two per-viewer events are attached
        // by `VIEWER_MANAGER.add()` at viewer-construction time (loader.ts
        // ~3495) — i.e. BEFORE the open pipeline calls `addTiledImage` and
        // OSD synchronously fires the first `tile-source-created`. Going
        // through `viewer-create` (only raised inside OSD's `open` with
        // `firstLoad=true`) loses the race for every newly-added viewer.
        //
        // broadcastHandler is also structurally idempotent (a handler is
        // stored at most once in its Map, attached at most once per viewer).
        VIEWER_MANAGER.broadcastHandler("tile-source-created", this._onTileSourceCreated);
        VIEWER_MANAGER.broadcastHandler("tile-invalidated", this._onTileInvalidated, null, -10);
        VIEWER_MANAGER.addHandler("viewer-reset", () => this._evictUnreferencedProfiles());

        const onWorkerMessage = async (e) => {
            const msg = e.data || {};
            const { type, contextId } = msg;

            if (type === "profileSet") {
                // Every worker holds its own lcms handles, so a profile is only
                // usable once all of them have armed it.
                const ack = this._profileAcks.get(contextId);
                if (ack) {
                    ack.remaining--;
                    ack.ok = ack.ok && msg.ok !== false;
                    if (ack.remaining > 0) return;
                    this._profileAcks.delete(contextId);
                    msg.ok = ack.ok;
                }

                const ctx = this.getCtx(contextId);
                // lcms refuses profiles it cannot use (a non-RGB input space, a
                // malformed blob). Treating that as ready would make every tile
                // of the source post a job the worker has no transform for.
                const loaded = msg.ok !== false;
                if (!loaded) {
                    console.warn(`[ICC] "${contextId}" supplied a profile that could not be loaded ` +
                        `(not an RGB input profile?) — rendering uncorrected.`);
                }
                ctx.status = loaded ? "ready" : "none";

                const job = this._jobs.get(contextId);
                if (job) {
                    this._jobs.delete(contextId);
                    job.resolve(loaded);
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

            if (type === "donePixels") {
                const job = this._jobs.get(contextId);
                if (!job) return;
                this._jobs.delete(contextId);
                job.resolve(msg.buffer);
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
        for (const worker of this._workers) worker.onmessage = onWorkerMessage;

        // Async tail: wait for the worker, then catch up on any source that
        // was opened before this module registered (or slipped through for
        // any other reason) — fetch its profile and re-process the tiles it
        // already drew via the invalidation pipeline.
        await this.ready;
        if (this.debugMode) this.debug = this.debug || makeDebugPanel();

        for (const viewer of (window.VIEWER_MANAGER?.viewers || [])) {
            const items = viewer?.world?._items || [];
            for (const item of items) {
                const source = item?.source;
                if (!source?.downloadICCProfile) continue;
                const contextId = source.tileSourceId || source.url;
                if (this.profileState.get(contextId)?._started) continue;
                try {
                    // The awaited form on purpose: this pass exists to re-process
                    // tiles that were already drawn, so it has to know whether a
                    // profile actually arrived before asking for an invalidation.
                    await this.loadProfileFor(source);
                    if (this.hasProfileFor(contextId)) {
                        item.requestInvalidate?.(true);
                    }
                } catch (err) {
                    console.warn("[ICC] catch-up profile load failed for", contextId, err);
                }
            }
        }
    }

    // Registered via VIEWER_MANAGER.broadcastHandler — attached to every
    // viewer at construction (loader.ts ~3495), BEFORE addTiledImage. Body
    // is viewer-agnostic (operates on e.tileSource + shared module state),
    // so a single handler reference covers every viewer in the manager.
    _onTileSourceCreated = (e) => {
        this.loadProfileFor(e.tileSource);
        // Deliberately returns nothing.
        //
        // `tile-source-created` is raised with `raiseEventAwaiting` and awaited by
        // the open pipeline, and `addTiledImage` runs only afterwards — so
        // returning the download promise here made the whole slide open block on
        // it. On a remote store that was seconds of dead time with a single
        // request on the wire and not one tile requested yet.
        //
        // Nothing is lost by not waiting: `correctTile` awaits `ctx.readyPromise`
        // before it touches a tile, so a tile still never reaches the screen
        // uncorrected. Only the *downloads* now overlap.
    };

    /**
     * Begin loading a source's ICC profile. Idempotent per source.
     * @returns {Promise<boolean>|undefined} resolves true once the profile is
     *   armed in the worker; undefined if the source has no profile support.
     */
    loadProfileFor(source) {
        if (!source?.downloadICCProfile) return undefined;

        // `source.url` is the server base URL and is shared across slides
        // from the same DICOMweb endpoint — keying on it would apply
        // slide A's profile to slide B. Tile sources that scope state to
        // their own identity expose `tileSourceId`; fall back to `url` for
        // sources that haven't adopted the convention yet.
        const contextId = source.tileSourceId || source.url;
        const ctx = this.getCtx(contextId);

        // Prevent duplicate loading. A second event for the same context —
        // including while the first fetch is still in flight — must NOT
        // restart the download (it would clobber `readyPromise` and the
        // pending `_jobs` entry); just hand back the existing promise.
        if (ctx._started) return ctx.readyPromise;
        ctx._started = true;

        // 1. Create a promise that resolves ONLY when the Worker is fully ready
        ctx.readyPromise = new Promise((resolve, reject) => {
            source.downloadICCProfile()
                .then(async (data) => {
                    if (data == null) {
                        ctx.status = "none";
                        resolve(false); // No profile needed
                        return;
                    }
                    if (!(data instanceof ArrayBuffer)) {
                        throw new Error("Invalid ICC profile data");
                    }

                    // Handlers register before the worker/WASM finish booting
                    // (see init()) — gate the postMessage, not the handler.
                    await this.ready;

                    // We hijack the existing job system to wait for the worker's reply
                    this._jobs.set(contextId, {
                        resolve: (loaded) => {
                            ctx.status = loaded ? "ready" : "none";
                            resolve(loaded);
                        },
                        reject: (err) => {
                            ctx.status = "error";
                            reject(err);
                        }
                    });

                    // Send to worker
                    this._broadcast(contextId, worker => {
                        // A fresh copy per worker: an ArrayBuffer can only be
                        // transferred to one of them, and they each need their own
                        // lcms handle.
                        const copy = data.slice(0);
                        worker.postMessage({ type: "setProfile", profile: copy, contextId }, [copy]);
                    });
                })
                .catch((err) => {
                    console.warn("[ICC] Failed to load profile", err);
                    ctx.status = "error";
                    resolve(false); // Graceful degradation
                });
        });

        return ctx.readyPromise;
    }

    // Bound field so one reference can be attached to (and detached from) every
    // viewer; the work itself lives on the prototype, where it is reachable.
    _onTileInvalidated = (e) => this.correctTile(e);

    /**
     * Apply this source's ICC profile to one invalidated tile, in whatever
     * representation the tile actually holds.
     */
    async correctTile(e) {
        const tile = e.tile;
        const tiledImage = e.tiledImage;
        const source = tiledImage?.source;
        const ctxId = source?.tileSourceId || source?.url || source?.id || tiledImage?.id;

        if (!ctxId) return;

        // [FIX] Access the raw context to check for the promise
        const ctx = this.profileState.get(ctxId);

        // 4. BLOCKING WAIT: If we are loading, pause this tile until ready
        if (ctx && ctx.status === 'loading' && ctx.readyPromise) {
            await ctx.readyPromise;
        }

        // 5. Now check if we actually have a profile (ready)
        if (!this.hasProfileFor(ctxId)) return;

        // The invalidation event's working cache, NOT `tile.getCache()`. It is
        // cloned from `tile.originalCacheKey`, so every invalidation starts from
        // uncorrected pixels — mutating the main cache instead meant a second
        // `requestInvalidate` (shader config change, z-plane change, our own
        // catch-up pass) re-applied the transform on top of itself. It also lets
        // the result flow through `prepareForRendering` and the atomic swap like
        // every other handler's output.
        //
        // With no argument this yields the record's NATIVE type, which is what
        // decides how the data can be corrected at all.
        const data = await e.getData();
        if (!data) return;

        // The declared cache type, not a guess: a `rawTiff` payload is a plain
        // Blob or typed array, so its shape says nothing about what it is.
        const nativeType = tile.getCache()?.type;

        try {
            // Packed GPU textures are a sink in the converter graph — there is
            // deliberately no edge to a raster type (see modules/webtiff/
            // tile-source.mjs), so they must be corrected in their own layout
            // and written back as themselves. Matched on shape rather than on
            // the label: an earlier handler in the chain may have replaced the
            // working cache, and the packs are what we actually operate on.
            if (Array.isArray(data.packs)) {
                const corrected = await this._correctTextureSet(ctxId, data);
                if (corrected) await e.setData(corrected, "gpuTextureSet");
                return;
            }

            // `rawTiff` is decoded to that same shape rather than to a raster
            // type: packed textures are what the drawer wants anyway, and going
            // through a raster type would collapse the bit depth these sources
            // exist to preserve.
            if (nativeType === "rawTiff") {
                const set = await e.getData("gpuTextureSet");
                if (!set) return;
                const corrected = await this._correctTextureSet(ctxId, set);
                if (corrected) await e.setData(corrected, "gpuTextureSet");
                return;
            }

            if (RASTER_TYPES.has(nativeType)) {
                const before = this.debugMode ? await e.getData("imageBitmap") : null;

                // A still-compressed tile goes to the worker as-is: it decodes
                // straight to RGBA there, so the main thread never builds a
                // bitmap and (given `ImageDecoder`) no canvas is involved at all.
                // This is the common case — the DICOM and preview-level paths
                // both publish `rasterBlob`.
                if (nativeType === "rasterBlob" && data instanceof Blob) {
                    const corrected = await this.processBlobForContext(ctxId, data, before);
                    await e.setData(corrected, "imageBitmap");
                    return;
                }

                const bmp = await e.getData("imageBitmap");
                if (!bmp) return;
                const corrected = await this.processBitmapForContext(ctxId, bmp, before);
                await e.setData(corrected, "imageBitmap");
                return;
            }

            this._warnUncorrectable(ctxId, nativeType || "unknown type");
        } catch (err) {
            // A failed correction must not fail the whole invalidation chain —
            // the tile still renders, just uncorrected.
            console.warn("[ICC] correction failed for", ctxId, err);
        }
    }

    /**
     * Correct every colour pack of a `gpuTextureSet`, returning a NEW payload.
     *
     * The object identity matters: `CacheRecord._overwriteData` short-circuits
     * when handed back the same object, skipping the internal-cache refresh — so
     * an in-place edit would never reach the already-uploaded GPU texture.
     *
     * @returns {Promise<object|null>} null when nothing in the set is correctable
     */
    async _correctTextureSet(ctxId, set) {
        const packs = set.packs;
        if (!Array.isArray(packs) || !packs.length) {
            this._warnUncorrectable(ctxId, "gpuTextureSet (no packs)");
            return null;
        }

        // Beyond four channels the extra packs are separate data layers, not
        // colour — a multiplexed measurement stack, not an RGB image.
        const channelCount = set.channelCount ?? packs.length * 4;
        if (channelCount > 4) {
            this._warnUncorrectable(ctxId, `gpuTextureSet with ${channelCount} channels`);
            return null;
        }

        const corrected = [];
        let touched = false;
        for (const pack of packs) {
            const format = PACK_FORMATS[pack.format];
            if (!format || !pack.data) {
                // Float packs are quantitative samples (parametric maps), never
                // colour. Leaving them alone is correct, not a shortcoming.
                corrected.push(pack);
                continue;
            }
            const buffer = await this.processPixelsForContext(ctxId, pack.data, format.wire);
            corrected.push({ ...pack, data: new format.View(buffer) });
            touched = true;
        }

        if (!touched) {
            this._warnUncorrectable(ctxId, `gpuTextureSet (${packs.map(p => p.format).join(", ")})`);
            return null;
        }
        return { ...set, packs: corrected };
    }

    /** One line per source, not per tile — a silent skip is how this went unnoticed before. */
    _warnUncorrectable(ctxId, what) {
        if (this._warnedUncorrectable.has(ctxId)) return;
        this._warnedUncorrectable.add(ctxId);
        console.warn(`[ICC] "${ctxId}" has an ICC profile, but its tile data (${what}) ` +
            `carries no correctable colour channels — rendering uncorrected.`);
    }

    hasProfileFor(contextId) {
        const ctx = this.profileState.get(contextId);
        return ctx?.status === "ready";
    }

    /**
     * Drop profileState entries whose tile sources are no longer mounted in
     * any viewer's world. Called on `viewer-reset`. Without this, switching
     * between many slides over a long session accumulates dead entries and
     * (more importantly) lets a freshly-reopened slide skip the re-fetch path
     * even if the backend has since published a new profile.
     */
    _evictUnreferencedProfiles() {
        const live = new Set();
        for (const viewer of (window.VIEWER_MANAGER?.viewers || [])) {
            const items = viewer?.world?._items;
            if (!items) continue;
            for (const item of items) {
                const src = item?.source;
                const id = src?.tileSourceId || src?.url;
                if (id) live.add(id);
            }
        }
        for (const key of [...this.profileState.keys()]) {
            if (!live.has(key)) {
                this.profileState.delete(key);
                this._warnedUncorrectable.delete(key);
                // Release the worker's lcms transforms for this source. The
                // handle table is small and bounded, so leaking entries would
                // eventually refuse new profiles outright.
                try {
                    for (const worker of this._workers) {
                        worker.postMessage({ type: "unsetProfile", contextId: key });
                    }
                } catch (_) { /* worker may be torn down */ }
            }
        }
    }

    /**
     * Correct a compressed raster tile. Preferred over `processBitmapForContext`:
     * the worker decodes it itself, so no bitmap is created on the main thread and
     * (where `ImageDecoder` exists) no canvas is involved at all.
     */
    processBlobForContext(profileContextId, blob, beforeForDebug = null) {
        const requestId = `${profileContextId}::${++this._seq}`;
        return new Promise((resolve, reject) => {
            this._jobs.set(requestId, { resolve, reject, before: beforeForDebug });
            this._post({ type: "processBlob", blob, contextId: requestId, profileContextId });
        });
    }

    processBitmapForContext(profileContextId, bmp, beforeForDebug = null) {
        // requestId is just for correlating the response
        const requestId = `${profileContextId}::${++this._seq}`;

        return new Promise((resolve, reject) => {
            this._jobs.set(requestId, { resolve, reject, before: beforeForDebug });

            this._post(
                {
                    type: "processBitmap",
                    bitmap: bmp,
                    contextId: requestId,
                    // Selects which loaded profile's transform to use; the
                    // worker keeps one lcms handle per source.
                    profileContextId,
                },
                [bmp]
            );
        });
    }

    /** Hand a job to the next worker in the pool. */
    _post(message, transfer = undefined) {
        const worker = this._workers[this._nextWorker];
        this._nextWorker = (this._nextWorker + 1) % this._workers.length;
        worker.postMessage(message, transfer);
    }

    /**
     * Send to every worker and expect an acknowledgement from each before the
     * context counts as ready.
     */
    _broadcast(contextId, send) {
        this._profileAcks.set(contextId, { remaining: this._workers.length, ok: true });
        for (const worker of this._workers) send(worker);
    }

    /**
     * Correct an interleaved RGBA sample buffer.
     * @param {Uint8Array|Uint16Array} view
     * @param {"rgba8"|"rgba16"} format
     * @returns {Promise<ArrayBuffer>} the corrected samples
     */
    processPixelsForContext(profileContextId, view, format) {
        const requestId = `${profileContextId}::${++this._seq}`;

        // Copy rather than transfer: the buffer belongs to the cache record we
        // were handed, and detaching it would blank the tile we are correcting.
        const buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);

        return new Promise((resolve, reject) => {
            this._jobs.set(requestId, { resolve, reject });
            this._post(
                { type: "processPixels", buffer, format, contextId: requestId, profileContextId },
                [buffer]
            );
        });
    }
}

/**
 * Upper bound on correction workers. Each carries its own lcms instance and
 * profile handles; past a handful they compete with tile decoding for cores
 * rather than helping.
 */
const ICC_MAX_WORKERS = 4;

/** Cache types that are ordinary 8-bit rasters and interconvert freely. */
const RASTER_TYPES = new Set(["imageBitmap", "image", "context2d", "rasterBlob"]);

/** `gpuTextureSet` pack formats lcms can transform, and how to read them back. */
const PACK_FORMATS = {
    RGBA8: { wire: "rgba8", View: Uint8Array },
    RGBA16: { wire: "rgba16", View: Uint16Array },
};

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
addModule('icc-profiles', ICCProfile, true);

// Exported for tests only — everything in the app reaches this through
// `singletonModule('icc-profiles')`, never through an import.
export { ICCProfile };
