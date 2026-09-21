// @ts-nocheck -- mechanical port of the former `src/external/scalebar.js`.
// Split out of the single 3388-line IIFE and moved into the core TS build so
// esbuild inlines it into `dist/app.js` instead of shipping it as a separate
// startup <script>. Bodies are unchanged JS; typing them is deliberate
// follow-up work and must not be mixed into a behaviour-identical move.

class ViewportSyncAPI {

    constructor(viewer) {
        this.master = viewer;
        this.enabled = false;
        this.points = new Map(); // viewer.uniqueId -> [{x,y}*3]
        this.transforms = new Map(); // target.uniqueId -> {A,b,scale,rotDeg}
        this.context = 0;
    }

    isEnabled() { return this.enabled; }

    /**
     * `viewerId -> true` for viewers whose alignment the user explicitly
     * cleared. The next `enable()` on such a viewer opens the three-point
     * picker instead of resurrecting an automatic registration.
     *
     * Deliberately class-static rather than a session field: clearing is
     * exactly the act that destroys the session, so the intent has to
     * outlive it. It is transient UI state and never enters the scene.
     */
    _pendingManual() {
        return (ViewportSyncAPI._manualPending ||= {});
    }

    _getSession() {
        if (!ViewportSyncAPI._session) {
            ViewportSyncAPI._session = {
                context: this.context || 0,
                leaderId: null,     // first calibrated viewer; used only as reference space
                leaderPts: null,
                transforms: {},     // viewerId -> { A, b, invA, scale, rotDeg }
                flipParity: {}      // viewerId -> boolean, relative to reference viewer
            };
        }

        const S = ViewportSyncAPI._session;
        S.transforms ||= {};
        S.flipParity ||= {};
        if (typeof S.context !== "number") S.context = this.context || 0;
        return S;
    }

    _findViewerById(viewerId) {
        return (window.VIEWER_MANAGER?.viewers || []).find(v => v?.uniqueId === viewerId) || null;
    }

    /**
     * Viewers currently subscribed to the link context. Returns a *copy*:
     * `Tools.unlink()` splices the live `subscribed` array, so iterating it
     * while unlinking would skip every other viewer.
     */
    _getLinkedPeers() {
        const S = this._getSession();
        return [...(OpenSeadragon.Tools?._linkContexts?.[S.context]?.subscribed || [])];
    }

    /** Every open viewer that owns a sync API, linked or not. */
    _allSyncViewers() {
        return (window.VIEWER_MANAGER?.viewers || []).filter(v => v?.scalebar?.ViewportSyncAPI);
    }

    /** Repaint the SYNC/REF badge and ✕ visibility everywhere. */
    _refreshAllChrome() {
        for (const v of this._allSyncViewers()) v.__syncToolChanged?.();
    }

    _identityTransform() {
        return {
            A: [1, 0, 0, 1],
            b: { x: 0, y: 0 },
            invA: [1, 0, 0, 1],
            scale: 1,
            rotDeg: 0
        };
    }

    _normalizeTransform(t) {
        if (!t) return null;
        const invA = t.invA || this._invert2x2(t.A);
        if (!invA) return null;
        return {
            A: t.A,
            b: { x: t.b.x, y: t.b.y },
            invA,
            scale: t.scale || 1,
            rotDeg: t.rotDeg || 0
        };
    }

    _storeViewerTransform(viewerId, t) {
        const S = this._getSession();
        const normalized = this._normalizeTransform(t);
        if (!normalized) throw new Error("Invalid calibration transform");
        S.transforms[viewerId] = normalized;
        this.transforms.set(viewerId, normalized);
        return normalized;
    }

    _getViewerTransform(viewerId) {
        const S = this._getSession();
        const t = S.transforms?.[viewerId];
        return this._normalizeTransform(t);
    }

    _setFlipParity(viewerId, parity) {
        this._getSession().flipParity[viewerId] = !!parity;
    }

    _getFlipParity(viewerId) {
        return !!this._getSession().flipParity?.[viewerId];
    }

    _xorBool(...vals) {
        return vals.reduce((acc, v) => acc !== !!v, false);
    }

    /**
     * Join the sync session.
     *
     * `mode: "auto"` (default) derives the alignment from
     * `OpenSeadragon.ViewportRegistration` — no user interaction — and only
     * falls back to the three-point picker when no provider is confident
     * enough. `mode: "manual"` goes straight to the picker.
     *
     * A viewer the user explicitly cleared (`resetViewer`) is upgraded to
     * `"manual"` regardless of the requested mode: the point of clearing is
     * to re-align by hand. Batch callers opt out with `allowManual: false`.
     *
     * @param {object} [opts]
     * @param {"auto"|"manual"} [opts.mode="auto"]
     * @param {boolean} [opts.force=false] ignore memoized registrations
     * @param {AbortSignal} [opts.signal]
     * @return {Promise<{mode: string, approximate: boolean}>}
     */
    async enable(opts = {}) {
        if (this.enabled) return { mode: "already-enabled", approximate: false };

        const S = this._getSession();
        const selfId = this.master.uniqueId;
        let mode = opts.mode === "manual" ? "manual" : "auto";
        if (this._pendingManual()[selfId] && opts.allowManual !== false) mode = "manual";
        let usedMode = mode;
        let approximate = false;

        if (!S.leaderId) {
            if (mode === "auto") {
                // Auto mode needs no points at all: the first viewer's image
                // space simply *is* the reference space.
                S.leaderId = selfId;
                S.leaderPts = null;
                this._storeViewerTransform(selfId, this._identityTransform());
                this._setFlipParity(selfId, false);
            } else {
                // First calibrated viewer defines the reference image space only.
                this.__ui?.setProgress?.("0/3");
                const refPts = await this.calibrateViewer(this.master);

                S.leaderId = selfId;
                S.leaderPts = refPts;
                this.points.set(selfId, refPts);
                this._storeViewerTransform(selfId, this._identityTransform());
                this._setFlipParity(selfId, false);
            }
        } else if (!this._getViewerTransform(selfId)) {
            let auto = null;
            if (mode === "auto") {
                auto = await this._autoCalibrate(opts);
            }
            if (auto) {
                approximate = !!auto.approximate;
            } else if (opts.allowManual === false) {
                // Batch callers must not chain interactive pickers.
                throw new Error("Automatic alignment failed");
            } else {
                usedMode = "manual";
                await this._manualCalibrate();
            }
        }

        // Calibration succeeded — the pending re-align has been honoured.
        delete this._pendingManual()[selfId];

        // The reference viewer also uses the generic mapper so it can follow
        // any other viewer via the inverse registration.
        this.master.tools.link(S.context, (sourceViewer, sourceState) => {
            return this._mapStateBetweenViewers(sourceViewer, this.master, sourceState);
        });

        this.enabled = true;

        // Make the newly joined viewer snap to the current synced pose using
        // whichever linked viewer is already active in the session.
        const peers = this._getLinkedPeers().filter(v => v && v !== this.master);
        const sourceViewer = peers[0] || this._findViewerById(S.leaderId);
        if (sourceViewer && sourceViewer !== this.master) {
            this._alignTargetToSourceNow(sourceViewer, this.master);
            // Registration is asynchronous: the user may well be mid-drag or
            // mid-kinetic-zoom when it lands, and OSD's springs would then
            // overwrite the jump we just made. Re-apply once the source
            // viewer settles, so navigating during the computation can never
            // leave the pair silently unaligned.
            this._realignWhenSettled(sourceViewer);
        }

        this._refreshAllChrome();
        return { mode: usedMode, approximate };
    }

    /**
     * Ask the registration chain for this viewer's transform against the
     * session reference. Returns null when nothing could be estimated, so
     * the caller can fall back to manual picking.
     * @return {Promise<?{approximate: boolean, providerId: string, confidence: number}>}
     */
    async _autoCalibrate(opts = {}) {
        const registration = OpenSeadragon.ViewportRegistration;
        if (!registration) return null;

        const S = this._getSession();
        const refViewer = this._findViewerById(S.leaderId);
        if (!refViewer || refViewer === this.master) return null;

        this.__ui?.setProgress?.(window.$.t('sync.autoProgress'));
        let result;
        try {
            result = await registration.estimate(refViewer, this.master, {
                force: !!opts.force,
                signal: opts.signal,
            });
        } catch (e) {
            console.warn("[sync-auto] registration error", this.master.uniqueId, e);
            return null;
        } finally {
            this.__ui?.setProgress?.("");
        }
        if (!result) {
            console.warn("[sync-auto] no provider could register",
                refViewer.uniqueId, "->", this.master.uniqueId);
            return null;
        }
        console.debug("[sync-auto] registered", refViewer.uniqueId, "->", this.master.uniqueId,
            result.providerId, "confidence", result.confidence);

        const t = this._transformFromMatrix(result.A, result.b);
        if (!t) return null;
        this._storeViewerTransform(this.master.uniqueId, t);
        this._setFlipParity(
            this.master.uniqueId,
            this._xorBool(!!result.flip, this._getFlipParity(S.leaderId))
        );

        return {
            approximate: !!result.approximate,
            providerId: result.providerId,
            confidence: result.confidence,
        };
    }

    /**
     * Public entry point for "align this viewer automatically", also used to
     * re-run a registration that was cached or previously approximate.
     */
    async autoCalibrate(opts = {}) {
        const S = this._getSession();
        const selfId = this.master.uniqueId;
        if (S.leaderId === selfId) return { mode: "reference", approximate: false };

        if (opts.force) {
            delete S.transforms?.[selfId];
            this.transforms.delete(selfId);
        }
        // An explicit "align automatically" overrides a pending manual clear.
        delete this._pendingManual()[selfId];
        if (this.enabled) {
            this.master.tools?.unlink?.(S.context);
            this.enabled = false;
        }
        return this.enable({ ...opts, mode: "auto" });
    }

    /**
     * Three-point picker path. When the session reference was established
     * automatically it has no points yet, so the reference viewer is
     * calibrated first (on its own canvas) and only then this one.
     */
    async _manualCalibrate() {
        const S = this._getSession();
        const selfId = this.master.uniqueId;

        if (!S.leaderPts) {
            const refViewer = this._findViewerById(S.leaderId);
            const refApi = refViewer?.scalebar?.ViewportSyncAPI;
            if (!refViewer || !refApi) throw new Error("Sync reference viewer unavailable");

            refApi.__ui?.setProgress?.("0/3");
            const refPts = await refApi.calibrateViewer(refViewer);
            S.leaderPts = refPts;
            refApi.points.set(S.leaderId, refPts);
            this._storeViewerTransform(S.leaderId, this._identityTransform());
            this._setFlipParity(S.leaderId, false);
        }

        this.__ui?.setProgress?.("0/3");
        const tgtPts = await this.calibrateViewer(this.master);
        this.points.set(selfId, tgtPts);

        const t = this._similarityFrom3(S.leaderPts, tgtPts);
        if (!t) throw new Error("Calibration invalid");
        this._storeViewerTransform(selfId, t);

        const refViewer = this._findViewerById(S.leaderId);
        const refFlip = refViewer?.viewport?.getFlip?.() ?? false;
        const selfFlip = this.master?.viewport?.getFlip?.() ?? false;
        this._setFlipParity(selfId, this._xorBool(selfFlip, refFlip));
    }

    /**
     * Wrap a raw 2×2 + offset (as produced by the registration providers)
     * into the session transform shape. A negative determinant means the
     * fit is mirrored — the reflection stays inside `A` (the mapper does a
     * generic matrix multiply), while `scale`/`rotDeg` describe the
     * rotation part only, which is what the zoom/rotation deltas need.
     */
    _transformFromMatrix(A, b) {
        if (!Array.isArray(A) || A.length !== 4 || !A.every(isFinite)) return null;
        if (!b || !isFinite(b.x) || !isFinite(b.y)) return null;

        const det = A[0] * A[3] - A[1] * A[2];
        if (!isFinite(det) || Math.abs(det) < 1e-12) return null;

        const scale = Math.sqrt(Math.abs(det));
        const rot = det < 0 ? [-A[0], A[1], -A[2], A[3]] : A;
        const rotDeg = Math.atan2(rot[2], rot[0]) * 180 / Math.PI;

        const invA = this._invert2x2(A);
        if (!invA) return null;
        return { A: [...A], b: { x: b.x, y: b.y }, invA, scale, rotDeg };
    }

    /**
     * Align every open viewer automatically against one reference (the
     * active viewer by default). Used by the Tools menu.
     * @return {Promise<{aligned:number, failed:number, approximate:number}>}
     */
    static async autoSyncAll(referenceViewer = null) {
        const viewers = (window.VIEWER_MANAGER?.viewers || []).filter(v => v?.scalebar?.ViewportSyncAPI);
        const result = { aligned: 0, failed: 0, approximate: 0 };
        if (viewers.length < 2) return result;

        const reference = referenceViewer && viewers.includes(referenceViewer)
            ? referenceViewer
            : (window.VIEWER_MANAGER?.get?.() || viewers[0]);

        // Reference first so the session's reference space is its image space.
        const ordered = [reference, ...viewers.filter(v => v !== reference)];

        const joinOne = async (viewer, retry) => {
            const api = viewer.scalebar.ViewportSyncAPI;
            if (api.isEnabled()) return { status: "ok", approximate: false };
            try {
                const r = await api.enable({ mode: "auto", allowManual: false, force: retry });
                console.debug("[sync-auto] joined", viewer.uniqueId, r);
                return { status: "ok", approximate: !!r?.approximate };
            } catch (e) {
                console.warn("[sync-auto] failed", viewer.uniqueId, retry ? "(retry)" : "", e);
                return { status: "failed" };
            }
        };

        // Every viewer is attempted, and one failure never aborts the rest:
        // registration can lose a race against user navigation, so failures
        // get a second pass once thumbnails are warm.
        const failed = [];
        for (const viewer of ordered) {
            const r = await joinOne(viewer, false);
            if (r.status === "failed") failed.push(viewer);
            else {
                result.aligned++;
                if (r.approximate) result.approximate++;
            }
        }
        for (const viewer of failed) {
            const r = await joinOne(viewer, true);
            if (r.status === "failed") result.failed++;
            else {
                result.aligned++;
                if (r.approximate) result.approximate++;
            }
        }
        return result;
    }

    /** @see OpenSeadragon.ViewportRegistration.registerProvider */
    static registerProvider(id, provider) {
        return OpenSeadragon.ViewportRegistration?.registerProvider(id, provider);
    }

    disable() {
        if (!this.enabled) return;
        const S = this._getSession();

        this.master.tools?.unlink?.(S.context);
        this.enabled = false;
        this.master.__syncToolChanged?.();
    }

    /**
     * Drop *one* viewer's calibration and unlink it. The rest of the session
     * survives — clearing the reference viewer re-bases every remaining
     * transform onto a new leader rather than throwing the session away.
     *
     * The cleared viewer is flagged `manualPending`, so the next `LINK`
     * opens the three-point picker instead of resurrecting the memoized
     * automatic registration the user just rejected.
     */
    resetViewer(viewerId = this.master.uniqueId) {
        const S = this._getSession();
        const peerApis = this._allSyncViewers().map(v => v.scalebar.ViewportSyncAPI);

        delete S.transforms?.[viewerId];
        delete S.flipParity?.[viewerId];
        // The per-instance Maps are shadow copies of the shared session.
        for (const api of peerApis) {
            api.transforms.delete(viewerId);
            api.points.delete(viewerId);
        }
        this._pendingManual()[viewerId] = true;

        const viewer = this._findViewerById(viewerId) || this.master;
        const api = viewer?.scalebar?.ViewportSyncAPI;
        if (api?.enabled) {
            viewer.tools?.unlink?.(S.context);
            api.enabled = false;
        }

        if (S.leaderId === viewerId) this._reelectLeader(viewerId);

        // A memoized registration would otherwise reinstate exactly the
        // alignment that was just discarded.
        OpenSeadragon.ViewportRegistration?.clearCacheFor?.(viewer);

        this._refreshAllChrome();
    }

    /**
     * The reference viewer left the session. Its image space was the shared
     * reference frame, so promote a still-calibrated peer `Y` and rewrite
     * every transform into `Y`'s image space.
     *
     * Transforms read `img_V = A_V · ref + b_V`, so substituting
     * `ref = invA_Y · (img_Y - b_Y)` gives
     *   `A'_V = A_V · invA_Y`, `b'_V = b_V - A'_V · b_Y`,
     * with `Y` itself collapsing to the identity.
     */
    _reelectLeader(oldLeaderId) {
        const S = this._getSession();
        const newLeaderId = Object.keys(S.transforms || {}).find(id => id !== oldLeaderId);
        if (!newLeaderId) {
            // Nobody left to reference — nothing to re-base onto.
            for (const v of this._allSyncViewers()) {
                v.tools?.unlink?.(S.context);
                const api = v.scalebar.ViewportSyncAPI;
                api.enabled = false;
                api.transforms.clear();
                api.points.clear();
            }
            ViewportSyncAPI._session = null;
            return;
        }

        const tY = this._normalizeTransform(S.transforms[newLeaderId]);
        if (!tY) {
            console.warn("[sync] cannot re-base onto", newLeaderId, "- resetting session");
            this.resetSession();
            return;
        }

        const parityY = this._getFlipParity(newLeaderId);
        const rebased = {};
        const parity = {};
        for (const [id, raw] of Object.entries(S.transforms)) {
            if (id === newLeaderId) {
                rebased[id] = this._identityTransform();
                parity[id] = false;
                continue;
            }
            const t = this._normalizeTransform(raw);
            if (!t) continue;
            const A = this._mul2x2(t.A, tY.invA);
            const shift = this._mul2x2_vec(A, tY.b);
            rebased[id] = {
                A,
                b: { x: t.b.x - shift.x, y: t.b.y - shift.y },
                scale: (t.scale || 1) / (tY.scale || 1),
                rotDeg: (t.rotDeg || 0) - (tY.rotDeg || 0),
            };
            parity[id] = this._xorBool(this._getFlipParity(id), parityY);
        }

        // Leader points live in the old reference space; carry them across so
        // a later manual calibration need not re-pick the reference viewer.
        const leaderPts = Array.isArray(S.leaderPts)
            ? S.leaderPts.map(p => this._mapImagePointFromReference(p, tY)).filter(Boolean)
            : null;

        S.transforms = {};
        S.flipParity = parity;
        S.leaderId = newLeaderId;
        S.leaderPts = leaderPts?.length === 3 ? leaderPts : null;
        for (const api of this._allSyncViewers().map(v => v.scalebar.ViewportSyncAPI)) {
            api.transforms.clear();
        }
        for (const [id, t] of Object.entries(rebased)) {
            try {
                this._storeViewerTransform(id, t);
            } catch (e) {
                console.warn("[sync] dropping degenerate re-based transform", id, e);
            }
        }
    }

    /**
     * Wipe the shared sync session entirely: leader, leader points, all
     * per-viewer transforms and flip parity. Every viewer is unlinked
     * and reverts to LINK state.
     *
     * Like the per-viewer clear, this arms a manual re-align on every
     * viewer: a user who throws the whole alignment away is telling us the
     * automatic estimate was wrong, so the next LINK must ask for points
     * rather than recompute the same answer.
     */
    resetSession() {
        const S = this._getSession();
        const pending = this._pendingManual();
        for (const v of this._allSyncViewers()) {
            v.tools?.unlink?.(S.context);
            const peerApi = v.scalebar.ViewportSyncAPI;
            peerApi.enabled = false;
            peerApi.transforms.clear();
            peerApi.points.clear();
            pending[v.uniqueId] = true;
        }
        ViewportSyncAPI._session = null;
        this.transforms.clear();
        this.points.clear();
        this.enabled = false;
        // A full reset means "forget everything", memoized registrations included.
        OpenSeadragon.ViewportRegistration?.clearCache?.();
        this._refreshAllChrome();
    }

    async calibrateViewer(viewer) {
        return new Promise((resolve, reject) => {
            const settle = (fn, arg) => {
                this._activeCalibrationCancel = null;
                fn(arg);
            };

            const cleanupPick = this.pickThreePoints(
                (pts) => {
                    Dialogs.show(window.$.t('sync.calibrationSaved'), 1200, Dialogs.MSG_SUCCESS);
                    this.__ui?.setProgress?.("");
                    settle(resolve, pts);
                },
                () => {
                    this.__ui?.setProgress?.("");
                    settle(reject, new Error("Calibration cancelled"));
                },
                (current, total) => {
                    this.__ui?.setProgress?.(`${current}/${total}`);
                },
                { timeoutMs: 15000 }
            );
            // Handle so the UI can abort an in-flight point pick (clicking
            // SYNC again while busy).
            this._activeCalibrationCancel = cleanupPick;
        });
    }

    /**
     * Abort an in-flight 3-point calibration, if any. Triggers the picker's
     * cancel path, which rejects the pending `calibrateViewer` promise.
     * @return {boolean} true if a calibration was actually aborted
     */
    cancelCalibration() {
        const cancel = this._activeCalibrationCancel;
        if (typeof cancel === "function") {
            this._activeCalibrationCancel = null;
            cancel();
            return true;
        }
        return false;
    }

    /**
     * Ask user to pick three points. The scalebar then stores the navigation sync data for it
     *
     * Mouse navigation stays enabled throughout: the landmarks a user wants
     * are rarely all in the current view, so panning and zooming must keep
     * working. A drag therefore ends in an OSD `canvas-click` like any other
     * release, and only a click that did not move the viewport marks a point.
     *
     * @param onDone
     * @param onCancel
     * @return {(function(): void)|*}
     */
    pickThreePoints(onDone, onCancel, onProgress, opts = {}) {
        const viewer = this.master;
        const pts = [];
        const overlays = [];
        const total = 3;

        const timeoutMs = Math.max(1000, opts.timeoutMs ?? 30000); // “reasonable time”
        let timeoutRef = null;

        // Distance, not duration: OSD's own `event.quick` also demands the
        // 300 ms `clickTimeThreshold`, which would reject the slow, careful
        // click a user places on a small landmark.
        const DRAG_TOLERANCE_PX = 5;
        let pressPos = null;
        let dragged = false;

        const prevCursor = viewer.container?.style.cursor ?? "";

        const removeAll = () => {
            for (const o of overlays) {
                try { viewer.removeOverlay(o.el); } catch {}
            }
            overlays.length = 0;
        };

        const detach = () => {
            viewer.removeHandler("canvas-click", handler);
            viewer.removeHandler("canvas-press", pressHandler);
            viewer.removeHandler("canvas-drag", dragHandler);
            window.removeEventListener("keydown", keyHandler, true);
            if (viewer.container) viewer.container.style.cursor = prevCursor;
            if (timeoutRef) clearTimeout(timeoutRef);
            removeAll();
        };

        const cancel = () => {
            detach();
            onCancel?.();
        };

        const finish = () => {
            detach();
            onDone?.(pts);
        };

        const restartTimeout = () => {
            if (timeoutRef) clearTimeout(timeoutRef);
            timeoutRef = setTimeout(() => {
                Dialogs?.show?.(window.$.t('sync.calibrationTimeout'), 1600, Dialogs.MSG_WARN);
                cancel();
            }, timeoutMs);
        };

        const addMarker = (imgPt, item) => {
            // Convert IMAGE coords -> VIEWPORT coords for overlays
            const vpPt = item.imageToViewportCoordinates(
                new OpenSeadragon.Point(imgPt.x, imgPt.y)
            );

            const el = document.createElement("div");
            el.className =
                "w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full " +
                "bg-error ring-2 ring-base-100 shadow pointer-events-none";
            el.style.display = "grid";
            el.style.placeItems = "center";
            el.style.fontSize = "10px";
            el.style.fontWeight = "700";
            el.style.color = "white";
            el.textContent = String(pts.length);

            viewer.addOverlay({
                element: el,
                location: vpPt, // <-- viewport coords
                placement: OpenSeadragon.Placement.CENTER
            });

            overlays.push({ el, img: imgPt });
        };

        const removeLast = () => {
            if (!pts.length) return;
            pts.pop();
            const o = overlays.pop();
            if (o?.el) {
                try { viewer.removeOverlay(o.el); } catch {}
            }
            onProgress?.(pts.length, total);
            restartTimeout();
        };

        const keyHandler = (ev) => {
            if (ev.key === "Escape") {
                ev.preventDefault();
                cancel();
            } else if (ev.key === "Backspace") {
                ev.preventDefault();
                removeLast();
            }
        };

        const pressHandler = (e) => {
            pressPos = e?.position || null;
            dragged = false;
        };

        const dragHandler = (e) => {
            if (dragged) return;
            if (!pressPos || !e?.position) {
                dragged = true;
                return;
            }
            const dx = e.position.x - pressPos.x;
            const dy = e.position.y - pressPos.y;
            if (dx * dx + dy * dy > DRAG_TOLERANCE_PX * DRAG_TOLERANCE_PX) dragged = true;
        };

        const handler = (e) => {
            if (dragged) {
                // The user navigated. Leave `preventDefaultAction` alone so
                // the gesture keeps its ordinary meaning.
                dragged = false;
                return;
            }
            if (!e?.position) return;

            const item = viewer.world.getItemAt(0);
            if (!item) return;

            const vp = viewer.viewport.pointFromPixel(e.position);
            const img = item.viewportToImageCoordinates(vp);
            if (!isFinite(img.x) || !isFinite(img.y)) return;

            pts.push({ x: img.x, y: img.y });
            onProgress?.(pts.length, total);

            addMarker(img, item);
            restartTimeout();

            if (pts.length >= total) finish();
            e.preventDefaultAction = true;
        };

        // single instruction toast once (you already do this pattern)
        Dialogs?.show?.(window.$.t('sync.pickPoints'), 5000, Dialogs.MSG_INFO);
        onProgress?.(0, total);

        viewer.addHandler("canvas-click", handler);
        viewer.addHandler("canvas-press", pressHandler);
        viewer.addHandler("canvas-drag", dragHandler);
        window.addEventListener("keydown", keyHandler, true);
        if (viewer.container) viewer.container.style.cursor = "crosshair";
        restartTimeout();

        // return cleanup for callers (calibrateViewer uses this)
        return cancel;
    }

    _mapImagePointToReference(imgPt, t) {
        if (!t) return null;
        const shifted = { x: imgPt.x - t.b.x, y: imgPt.y - t.b.y };
        return this._mul2x2_vec(t.invA, shifted);
    }

    _mapImagePointFromReference(refPt, t) {
        if (!t) return null;
        const mapped = this._mul2x2_vec(t.A, refPt);
        return { x: mapped.x + t.b.x, y: mapped.y + t.b.y };
    }

    _mapStateBetweenViewers(sourceViewer, targetViewer, sourceState) {
        if (!sourceViewer || !targetViewer || !sourceState) return null;
        if (sourceViewer === targetViewer) return sourceState;

        const sourceItem = sourceViewer.world.getItemAt(0);
        const targetItem = targetViewer.world.getItemAt(0);
        if (!sourceItem || !targetItem) return null;

        const sourceT = this._getViewerTransform(sourceViewer.uniqueId);
        const targetT = this._getViewerTransform(targetViewer.uniqueId);
        if (!sourceT || !targetT) return null;

        const sourceCenterImg = sourceItem.viewportToImageCoordinates(sourceState.center);
        if (!isFinite(sourceCenterImg.x) || !isFinite(sourceCenterImg.y)) return null;

        const refCenterImg =
            sourceViewer.uniqueId === this._getSession().leaderId
                ? { x: sourceCenterImg.x, y: sourceCenterImg.y }
                : this._mapImagePointToReference(sourceCenterImg, sourceT);
        if (!refCenterImg || !isFinite(refCenterImg.x) || !isFinite(refCenterImg.y)) return null;

        const targetCenterImg =
            targetViewer.uniqueId === this._getSession().leaderId
                ? refCenterImg
                : this._mapImagePointFromReference(refCenterImg, targetT);
        if (!targetCenterImg || !isFinite(targetCenterImg.x) || !isFinite(targetCenterImg.y)) return null;

        const targetCenterVp = targetItem.imageToViewportCoordinates(
            new OpenSeadragon.Point(targetCenterImg.x, targetCenterImg.y)
        );
        if (!isFinite(targetCenterVp.x) || !isFinite(targetCenterVp.y)) return null;

        // Zoom must be converted through IMAGE pixels, not viewport units:
        // two viewers showing differently sized slides (or a placed virtual
        // region) have different "viewport units per image pixel", so a raw
        // zoom copy would leave the magnifications mismatched. Equate
        // screen-pixels-per-image-pixel on both sides, then divide by the
        // registration scale from source to target.
        const vpUnitsPerImagePx = (item) => {
            const origin = item.imageToViewportCoordinates(new OpenSeadragon.Point(0, 0));
            const unit = item.imageToViewportCoordinates(new OpenSeadragon.Point(1, 0));
            return Math.abs(unit.x - origin.x) || 1;
        };
        const containerWidth = (v) => v.viewport?.getContainerSize?.().x || 1;
        const relativeScale = (targetT.scale || 1) / (sourceT.scale || 1);
        const zoom = sourceState.zoom
            * (containerWidth(sourceViewer) / containerWidth(targetViewer))
            * (vpUnitsPerImagePx(sourceItem) / vpUnitsPerImagePx(targetItem))
            / relativeScale;
        const rotation = sourceState.rotation + (sourceT.rotDeg || 0) - (targetT.rotDeg || 0);
        const flip = this._xorBool(
            !!sourceState.flip,
            this._getFlipParity(sourceViewer.uniqueId),
            this._getFlipParity(targetViewer.uniqueId)
        );

        return {
            center: targetCenterVp,
            zoom,
            rotation,
            flip,
            // Focal plane passes through untouched — registration aligns X/Y,
            // not depth. The target's depth controller maps the index from
            // `depthStack` onto its own axis.
            depth: sourceState.depth,
            depthStack: sourceState.depthStack
        };
    }

    /**
     * Re-run the alignment the next time `sourceViewer` stops animating
     * (bounded, so a viewer left spinning does not keep a handler alive).
     */
    _realignWhenSettled(sourceViewer, timeoutMs = 8000) {
        if (!sourceViewer?.addHandler) return;
        const onSettled = () => {
            clearTimeout(timeoutRef);
            sourceViewer.removeHandler("animation-finish", onSettled);
            if (this.enabled) this._alignTargetToSourceNow(sourceViewer, this.master);
        };
        const timeoutRef = setTimeout(
            () => sourceViewer.removeHandler("animation-finish", onSettled), timeoutMs);
        sourceViewer.addHandler("animation-finish", onSettled);
    }

    _alignTargetToSourceNow(sourceViewer, targetViewer) {
        const sourceState = sourceViewer?.tools?.readViewportState?.();
        const mappedState = this._mapStateBetweenViewers(sourceViewer, targetViewer, sourceState);
        if (mappedState) {
            targetViewer.tools.applyViewportState(mappedState);
        }
    }

    _invert2x2(m) {
        const [a,b,c,d] = m; // [a b; c d]
        const det = a*d - b*c;
        if (!isFinite(det) || Math.abs(det) < 1e-12) return null;
        const invDet = 1 / det;
        return [ d*invDet, -b*invDet, -c*invDet, a*invDet ];
    }

    _mul2x2(a, b) {
        // a,b are [a b c d]
        return [
            a[0]*b[0] + a[1]*b[2],
            a[0]*b[1] + a[1]*b[3],
            a[2]*b[0] + a[3]*b[2],
            a[2]*b[1] + a[3]*b[3],
        ];
    }

    _mul2x2_vec(m, v) {
        return { x: m[0]*v.x + m[1]*v.y, y: m[2]*v.x + m[3]*v.y };
    }

    _similarityFrom3(refPts, tgtPts) {
        const rc = {
            x: (refPts[0].x + refPts[1].x + refPts[2].x) / 3,
            y: (refPts[0].y + refPts[1].y + refPts[2].y) / 3
        };
        const tc = {
            x: (tgtPts[0].x + tgtPts[1].x + tgtPts[2].x) / 3,
            y: (tgtPts[0].y + tgtPts[1].y + tgtPts[2].y) / 3
        };

        let a = 0, b = 0, denom = 0;

        for (let i = 0; i < 3; i++) {
            const rx = refPts[i].x - rc.x;
            const ry = refPts[i].y - rc.y;
            const tx = tgtPts[i].x - tc.x;
            const ty = tgtPts[i].y - tc.y;

            a += rx * tx + ry * ty;
            b += rx * ty - ry * tx;
            denom += rx * rx + ry * ry;
        }

        if (!isFinite(denom) || denom < 1e-12) return null;

        const norm = Math.hypot(a, b);
        if (!isFinite(norm) || norm < 1e-12) return null;

        const scale = norm / denom;
        const cos = a / norm;
        const sin = b / norm;

        const A = [
            scale * cos, -scale * sin,
            scale * sin,  scale * cos
        ];

        const Arc = {
            x: A[0] * rc.x + A[1] * rc.y,
            y: A[2] * rc.x + A[3] * rc.y
        };

        const t = {
            x: tc.x - Arc.x,
            y: tc.y - Arc.y
        };

        const rotDeg = Math.atan2(A[2], A[0]) * 180 / Math.PI;
        const invA = this._invert2x2(A);
        if (!invA) return null;

        return { A, b: t, invA, scale, rotDeg };
    }
}

export { ViewportSyncAPI };
