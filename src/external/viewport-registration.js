/**
 * Automatic viewport registration.
 *
 * Produces the same transform the manual three-point calibration produces
 * (`ViewportSyncAPI._similarityFrom3`), but without asking the user to click:
 *
 *     p_target_image = A * p_reference_image + b
 *
 * Estimation is a chain of pluggable providers, highest priority first. The
 * first result at or above `MIN_CONFIDENCE` wins; otherwise the best
 * lower-confidence result is returned flagged `approximate` so the caller can
 * warn instead of silently locking viewers onto a wrong alignment.
 *
 * Built-in providers:
 *   `metadata`  (100) exact — identical slide, virtual regions of one parent,
 *                     or a physical-scale (µm/px) seed alignment.
 *   `thumbnail` (50)  tissue-silhouette similarity search on low-res
 *                     thumbnails, refined in a worker.
 *
 * Third parties (server-side registration, feature matching …) register their
 * own with `OpenSeadragon.ViewportRegistration.registerProvider(id, {...})`.
 */
(function ($) {

    const THUMB_MAX_PX = 384;
    const WORKER_IDLE_MS = 60000;

    /** Scale a bitmap into a canvas whose longest edge is `maxPx`. */
    function drawScaled(image, maxPx) {
        const w = image.naturalWidth || image.width;
        const h = image.naturalHeight || image.height;
        if (!w || !h) return null;
        const k = Math.min(1, maxPx / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * k));
        canvas.height = Math.max(1, Math.round(h * k));
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas;
    }

    /** Canvas → 8-bit luminance plane; fully transparent pixels read as background. */
    function toGray(canvas) {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const gray = new Uint8Array(width * height);
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            gray[p] = data[i + 3] < 8
                ? 255
                : (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
        }
        return { w: width, h: height, gray };
    }

    const Registration = {

        /** Minimum silhouette agreement accepted as a real alignment. */
        MIN_CONFIDENCE: 0.7,

        _providers: new Map(),
        _pairCache: new Map(),
        _thumbCache: new Map(),
        _worker: null,
        _workerIdleRef: null,
        _msgSeq: 0,

        /**
         * @param {string} id
         * @param {object} provider {priority:number, estimate:(ctx)=>Promise<?result>}
         *   `ctx` = {refViewer, targetViewer, refSource, targetSource, seed, signal}
         *   result = {A:[a,b,c,d], b:{x,y}, flip?:boolean, confidence:number}
         */
        registerProvider(id, provider) {
            if (!id || typeof provider?.estimate !== "function") {
                throw new Error("ViewportRegistration.registerProvider: id and estimate() required");
            }
            this._providers.set(id, { id, priority: provider.priority ?? 0, estimate: provider.estimate });
            return id;
        },

        unregisterProvider(id) {
            return this._providers.delete(id);
        },

        /** Drop memoized pair transforms (e.g. after a slide is replaced). */
        clearCache() {
            this._pairCache.clear();
            this._thumbCache.clear();
        },

        /**
         * Drop only the memoized pairs that involve `viewer`'s slide. Used when
         * the user explicitly clears one viewer's alignment: the next attempt
         * must recompute rather than resurrect the transform that was thrown
         * away. The thumbnail cache is deliberately kept — the slide did not
         * change and re-rendering it is expensive.
         */
        clearCacheFor(viewer) {
            const key = this._sourceKey(viewer);
            if (!key) return;
            for (const k of [...this._pairCache.keys()]) {
                const [a, b] = this._splitPairKey(k);
                if (a === key || b === key) this._pairCache.delete(k);
            }
        },

        /**
         * `_pairCache` key for an ordered (reference, target) source pair.
         * Length-prefixed instead of delimiter-joined: source ids are opaque
         * strings (URLs, DICOM UIDs) so no character can be assumed absent from
         * them, yet `clearCacheFor` has to recover both halves.
         */
        _pairKey(refKey, tgtKey) {
            return `${refKey.length}|${refKey}${tgtKey}`;
        },

        _splitPairKey(key) {
            const bar = key.indexOf("|");
            const n = bar < 0 ? NaN : Number(key.slice(0, bar));
            if (!Number.isFinite(n)) return [null, null];
            return [key.slice(bar + 1, bar + 1 + n), key.slice(bar + 1 + n)];
        },

        _sourceOf(viewer) {
            const item = viewer?.scalebar?.getReferencedTiledImage?.() || viewer?.world?.getItemAt?.(0);
            return item?.source || null;
        },

        _sourceKey(viewer) {
            const source = this._sourceOf(viewer);
            // Key by tileSourceId: DICOMweb and friends share `url` across slides.
            return source?.tileSourceId || source?.__xopatLoadKey || viewer?.uniqueId || null;
        },

        /**
         * Estimate the transform mapping `refViewer` image coordinates onto
         * `targetViewer` image coordinates.
         * @return {Promise<?{A, b, flip, confidence, providerId, approximate}>}
         */
        async estimate(refViewer, targetViewer, opts = {}) {
            if (!refViewer || !targetViewer || refViewer === targetViewer) return null;

            const refKey = this._sourceKey(refViewer);
            const tgtKey = this._sourceKey(targetViewer);
            const cacheKey = refKey && tgtKey ? this._pairKey(refKey, tgtKey) : null;
            if (cacheKey && !opts.force && this._pairCache.has(cacheKey)) {
                return this._pairCache.get(cacheKey);
            }

            const ctx = {
                refViewer, targetViewer,
                refSource: this._sourceOf(refViewer),
                targetSource: this._sourceOf(targetViewer),
                signal: opts.signal,
                seed: null,
            };

            const ordered = [...this._providers.values()].sort((a, b) => b.priority - a.priority);
            let best = null;

            for (const provider of ordered) {
                if (opts.signal?.aborted) throw new Error("Registration cancelled");
                let result;
                try {
                    result = await provider.estimate(ctx);
                } catch (e) {
                    console.warn(`[registration] provider "${provider.id}" failed`, e);
                    continue;
                }
                if (!result || !Array.isArray(result.A)) continue;

                result = { ...result, providerId: provider.id };
                if (!best || (result.confidence ?? 0) > (best.confidence ?? 0)) best = result;
                if ((result.confidence ?? 0) >= this.MIN_CONFIDENCE) break;
                // A weak result is still a useful starting point for the next
                // (usually image-based) provider.
                ctx.seed = result;
            }

            if (!best) return null;
            best.approximate = (best.confidence ?? 0) < this.MIN_CONFIDENCE;
            // Only a confident registration is worth remembering. Caching an
            // approximate one would freeze a bad alignment in place for the rest
            // of the session, even after the condition that caused it is gone.
            if (cacheKey && !best.approximate) this._pairCache.set(cacheKey, best);
            return best;
        },

        // ---------------------------------------------------------------- thumbnails

        /**
         * Grayscale whole-slide thumbnail for a viewer, plus the factor that
         * converts thumbnail pixels back to level-0 image pixels.
         * @return {Promise<?{w,h,gray,k}>}
         */
        async thumbnailOf(viewer, maxPx = THUMB_MAX_PX) {
            const key = this._sourceKey(viewer);
            if (key && this._thumbCache.has(key)) return this._thumbCache.get(key);

            const promise = (async () => {
                const item = viewer?.scalebar?.getReferencedTiledImage?.() || viewer?.world?.getItemAt?.(0);
                const source = item?.source;
                if (!source) return null;

                let canvas = null;
                // Virtual-region sources forward getThumbnail() to their parent,
                // which would register the wrong extent — those pairs are handled
                // exactly by the metadata provider instead.
                if (typeof source.getThumbnail === "function" && typeof source.getParentId !== "function") {
                    try {
                        const raw = await source.getThumbnail();
                        if (raw) {
                            const image = await window.UTILITIES.imageLikeToImage(raw);
                            if (image) canvas = drawScaled(image, maxPx);
                        }
                    } catch (e) {
                        console.debug("[registration] getThumbnail failed, falling back", e);
                    }
                }

                if (!canvas) {
                    // The offscreen render competes with the tiles the user is
                    // actively panning through, so a single attempt can come back
                    // empty. Retry rather than declare the slide unregistrable.
                    const bg = item?.getConfig?.("background");
                    if (!bg?.id || !viewer.tools) return null;
                    for (let attempt = 0; attempt < 2 && !canvas; attempt++) {
                        if (attempt) await new Promise(r => setTimeout(r, 400));
                        try {
                            const ctx = await viewer.tools.navigatorThumbnail(
                                bg, { x: maxPx, y: maxPx }, attempt ? 20000 : 10000);
                            canvas = ctx?.canvas || null;
                        } catch (e) {
                            console.debug("[registration] navigatorThumbnail attempt failed", attempt, e);
                        }
                    }
                }
                if (!canvas || !canvas.width || !canvas.height) return null;

                const gray = toGray(canvas);
                const fullWidth = source.width || item?.getContentSize?.().x || gray.w;
                return { ...gray, k: fullWidth / gray.w };
            })();

            // Cache the in-flight promise so concurrent viewers share one render,
            // but NEVER cache a failure: a thumbnail that lost a race against
            // user navigation must be retried, not remembered as impossible.
            if (key) this._thumbCache.set(key, promise);
            let value = null;
            try {
                value = await promise;
            } finally {
                if (key) {
                    if (value) this._thumbCache.set(key, value);
                    else this._thumbCache.delete(key);
                }
            }
            return value;
        },

        // ---------------------------------------------------------------- worker

        _ensureWorker() {
            if (!this._worker) {
                const base = window.APPLICATION_CONTEXT?.url || "";
                // Handlers close over `worker`, not `this._worker`: after a crash the
                // field is cleared, and a late message must not read it back as null.
                const worker = new Worker(`${base}src/external/registration-worker.js`);
                worker.__pending = new Map();
                worker.onmessage = (e) => {
                    const msg = e.data;
                    const entry = worker.__pending.get(msg?.id);
                    if (!entry) return;
                    worker.__pending.delete(msg.id);
                    msg.ok ? entry.resolve(msg.result) : entry.reject(new Error(msg.error));
                };
                worker.onerror = (e) => {
                    for (const entry of worker.__pending.values()) entry.reject(new Error(e.message));
                    worker.__pending.clear();
                    // Drop the dead instance. Leaving it in place wedged registration
                    // permanently: _ensureWorker() handed the crashed worker back, its
                    // new pendings never settled, and _disposeWorker() then refused to
                    // clean up because it early-returns while __pending is non-empty.
                    worker.terminate();
                    if (this._worker === worker) {
                        this._worker = null;
                        clearTimeout(this._workerIdleRef);
                        this._workerIdleRef = null;
                    }
                };
                this._worker = worker;
            }
            clearTimeout(this._workerIdleRef);
            this._workerIdleRef = setTimeout(() => this._disposeWorker(), WORKER_IDLE_MS);
            return this._worker;
        },

        _disposeWorker() {
            if (this._worker?.__pending?.size) return; // still busy, try again on next idle tick
            this._worker?.terminate();
            this._worker = null;
        },

        _runWorker(payload, signal) {
            const worker = this._ensureWorker();
            const id = ++this._msgSeq;
            return new Promise((resolve, reject) => {
                worker.__pending.set(id, { resolve, reject });
                signal?.addEventListener("abort", () => {
                    if (worker.__pending.delete(id)) reject(new Error("Registration cancelled"));
                }, { once: true });
                worker.postMessage({ type: "estimate", id, ...payload });
            });
        },
    };

    // ------------------------------------------------------------------ built-ins

    function identity(confidence) {
        return { A: [1, 0, 0, 1], b: { x: 0, y: 0 }, flip: false, confidence };
    }

    /** Region origin in parent image pixels, for virtual-region sources. */
    function regionOrigin(source) {
        const region = source.getRegionPx?.();
        if (!region) return null;
        return { x: region.x, y: region.y };
    }

    Registration.registerProvider("metadata", {
        priority: 100,
        estimate({ refViewer, targetViewer, refSource, targetSource }) {
            if (!refSource || !targetSource) return null;

            // Same slide (different z-plane, channel set, derived overlay …).
            if (refSource === targetSource
                || (refSource.tileSourceId && refSource.tileSourceId === targetSource.tileSourceId)) {
                return identity(1);
            }

            // Two virtual regions cut from one parent: exact translation.
            if (typeof refSource.getParentId === "function" && typeof targetSource.getParentId === "function"
                && refSource.getParentId() && refSource.getParentId() === targetSource.getParentId()) {
                const a = regionOrigin(refSource);
                const b = regionOrigin(targetSource);
                if (a && b) {
                    return { A: [1, 0, 0, 1], b: { x: a.x - b.x, y: a.y - b.y }, flip: false, confidence: 1 };
                }
            }

            // Different scans with known physical calibration: align image
            // centres at matching physical scale. Not an alignment of the tissue
            // itself — deliberately below MIN_CONFIDENCE so it is only used as a
            // seed, or as an explicitly approximate fallback.
            const refMpp = refViewer?.scalebar?.micronsPerPixel?.();
            const tgtMpp = targetViewer?.scalebar?.micronsPerPixel?.();
            if (refMpp && tgtMpp && isFinite(refMpp) && isFinite(tgtMpp)) {
                const s = refMpp / tgtMpp;
                const rc = { x: (refSource.width || 0) / 2, y: (refSource.height || 0) / 2 };
                const tc = { x: (targetSource.width || 0) / 2, y: (targetSource.height || 0) / 2 };
                return {
                    A: [s, 0, 0, s],
                    b: { x: tc.x - s * rc.x, y: tc.y - s * rc.y },
                    flip: false,
                    confidence: 0.5,
                };
            }
            return null;
        },
    });

    Registration.registerProvider("thumbnail", {
        priority: 50,
        async estimate(ctx) {
            const [ref, tgt] = await Promise.all([
                Registration.thumbnailOf(ctx.refViewer),
                Registration.thumbnailOf(ctx.targetViewer),
            ]);
            if (!ref || !tgt) return null;

            const raw = await Registration._runWorker({
                ref: { w: ref.w, h: ref.h, gray: ref.gray },
                tgt: { w: tgt.w, h: tgt.h, gray: tgt.gray },
                opts: {},
            }, ctx.signal);
            if (!raw) return null;

            // Thumbnail pixels → level-0 image pixels (isotropic on both sides).
            const kRatio = tgt.k / ref.k;
            return {
                A: raw.A.map(v => v * kRatio),
                b: { x: raw.b.x * tgt.k, y: raw.b.y * tgt.k },
                flip: !!raw.flip,
                confidence: raw.confidence,
            };
        },
    });

    $.ViewportRegistration = Registration;

}(OpenSeadragon));
