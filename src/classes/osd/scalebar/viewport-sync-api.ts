// @ts-nocheck -- mechanical port of the former `src/external/scalebar.js`.
// Split out of the single 3388-line IIFE and moved into the core TS build so
// esbuild inlines it into `dist/app.js` instead of shipping it as a separate
// startup <script>. Bodies are unchanged JS; typing them is deliberate
// follow-up work and must not be mixed into a behaviour-identical move.

const CANCELLED = "Calibration cancelled";

/**
 * How far, relative to the spread of the picked points, the fitted transform
 * may leave them apart before the fit is reported as poor. Serial sections
 * deform a little, so a few percent is normal; points picked in a different
 * order, or one click on the wrong landmark, land far above this.
 */
const POOR_FIT_RESIDUAL = 0.05;

/**
 * Cross-viewport alignment. See `src/MULTI_VIEWPORTS.md` → *Viewport sync*.
 *
 * State lives in ONE place, the class-static session:
 *   transforms[viewerId]  p_viewer = A · p_reference + b, plus `source`
 *                         ("reference" | "auto" | "manual" | "adjusted")
 *   flipParity[viewerId]  display mirror relative to the reference
 *   leaderPts             the reference viewer's three calibration points
 *   points[viewerId]      a follower's own three points (display only)
 *   epoch[viewerId]       bumped whenever that viewer's entry is discarded
 *
 * A viewer has exactly one transform, made by exactly one mode. Whatever
 * replaces it goes through `_invalidateViewer`, and every asynchronous path
 * checks the session identity and its epoch before it writes, so a result
 * computed against state that has since been cleared is dropped, never stored.
 */
class ViewportSyncAPI {

    constructor(viewer) {
        this.master = viewer;
        this.enabled = false;
        this.context = 0;
        // UI state lives here, not in the scalebar chrome: the chrome is
        // rebuilt on every open-pipeline pass, this instance is not.
        this._busy = false;
        this._progress = "";
        this._adjusting = null;
        this._op = null;
        this._activeCalibrationCancel = null;
        ViewportSyncAPI._installLifecycle();
    }

    isEnabled() { return this.enabled; }
    /** A calibration (automatic or point pick) is running on this viewer. */
    isBusy() { return !!this._busy; }
    /** Paused for a manual nudge, see {@link beginAdjust}. */
    isAdjusting() { return !!this._adjusting; }
    /** Short progress text for the SYNC button ("1/3", "auto…"). */
    getProgress() { return this._progress || ""; }

    _notifyUi() {
        try { this.master.__syncToolChanged?.(); } catch (e) { console.warn(e); }
    }

    _setBusy(busy) {
        this._busy = !!busy;
        this._notifyUi();
    }

    _setProgress(text) {
        this._progress = text || "";
        this._notifyUi();
    }

    /**
     * `viewerId -> true` for viewers whose alignment the user explicitly
     * cleared. The next plain `enable()` on such a viewer opens the
     * three-point picker instead of resurrecting an automatic registration.
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
            };
        }

        const S = ViewportSyncAPI._session;
        S.transforms ||= {};        // viewerId -> { A, b, invA, scale, rotDeg, source }
        S.flipParity ||= {};        // viewerId -> boolean, relative to reference viewer
        S.points ||= {};            // viewerId -> the follower's own three points
        S.epoch ||= {};             // viewerId -> number
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

    /** Repaint the SYNC/REF badge everywhere. */
    _refreshAllChrome() {
        for (const v of this._allSyncViewers()) v.__syncToolChanged?.();
    }

    _identityTransform() {
        return {
            A: [1, 0, 0, 1],
            b: { x: 0, y: 0 },
            invA: [1, 0, 0, 1],
            scale: 1,
            rotDeg: 0,
            source: "reference"
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
            rotDeg: t.rotDeg || 0,
            // How the transform was made. Unknown for sessions restored from
            // a scene that predates the field.
            source: typeof t.source === "string" ? t.source : undefined
        };
    }

    _storeViewerTransform(viewerId, t) {
        const S = this._getSession();
        const normalized = this._normalizeTransform(t);
        if (!normalized) throw new Error("Invalid calibration transform");
        S.transforms[viewerId] = normalized;
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

    /** A viewer's own calibration points (image pixels), if it has any. */
    _pointsOf(S, viewerId) {
        const pts = viewerId === S.leaderId ? S.leaderPts : S.points?.[viewerId];
        return Array.isArray(pts) && pts.length ? pts : null;
    }

    _xorBool(...vals) {
        return vals.reduce((acc, v) => acc !== !!v, false);
    }

    /**
     * Degrees the sync session adds to this viewer's rotation relative to
     * the reference viewer (`0` for the reference itself and for a viewer
     * the session never posed). Persisted viewport state subtracts it: the
     * session lives in memory only, so a stored rotation that includes the
     * registration angle would outlive its cause and reopen the slide tilted.
     *
     * Reads the session directly — `_getSession()` would create one.
     */
    getRotationOffset() {
        if (!this._poseApplied) return 0;
        const t = ViewportSyncAPI._session?.transforms?.[this.master.uniqueId];
        return t?.rotDeg ? -t.rotDeg : 0;
    }

    /**
     * Take the registration's rotation / mirror back out of `viewer`, leaving
     * it at the reference viewer's orientation (plus whatever the user turned
     * by hand). Must run while the viewer's transform still exists and after
     * it was unlinked — a linked viewer would push the correction to its peers.
     */
    _releasePose(viewer) {
        const api = viewer?.scalebar?.ViewportSyncAPI;
        if (!api?._poseApplied) return;
        api._poseApplied = false;

        const S = ViewportSyncAPI._session;
        const id = viewer.uniqueId;
        const t = S?.transforms?.[id];
        const vp = viewer.viewport;
        if (!t || !vp) return;

        const rotDeg = t.rotDeg || 0;
        if (rotDeg && isFinite(rotDeg)) vp.setRotation(vp.getRotation() + rotDeg, true);
        if (S.flipParity?.[id] && typeof vp.setFlip === "function") vp.setFlip(!vp.getFlip());
    }

    /** Subscribe this viewer to the session's link context. */
    _link(S) {
        // The reference viewer also uses the generic mapper so it can follow
        // any other viewer via the inverse registration.
        this.master.tools.link(S.context, (sourceViewer, sourceState) => {
            return this._mapStateBetweenViewers(sourceViewer, this.master, sourceState);
        });
        this.enabled = true;
        this._poseApplied = true;
        this._linkedId = this.master.uniqueId;
    }

    _unlink() {
        const context = ViewportSyncAPI._session?.context ?? this.context ?? 0;
        this.master.tools?.unlink?.(context);
        this.enabled = false;
    }

    /**
     * Snap this viewer onto the pose the session currently shows, using
     * whichever linked viewer is already active in it.
     */
    _snapToPeers(S) {
        const peers = this._getLinkedPeers().filter(v => v && v !== this.master);
        const sourceViewer = peers[0] || this._findViewerById(S.leaderId);
        if (!sourceViewer || sourceViewer === this.master) return;
        this._alignTargetToSourceNow(sourceViewer, this.master);
        // Registration is asynchronous: the user may well be mid-drag or
        // mid-kinetic-zoom when it lands, and OSD's springs would then
        // overwrite the jump we just made. Re-apply once the source viewer
        // settles, so navigating during the computation can never leave the
        // pair silently unaligned.
        this._realignWhenSettled(sourceViewer);
    }

    /**
     * THE way a viewer's alignment is discarded. Every action that replaces
     * or removes it — clear, re-calibration in either mode, adjustment, slide
     * change — goes through here, so nothing of the previous mode survives
     * into the next: transform, mirror parity, points, the pose applied to the
     * viewport, and (unless told otherwise) the memoized registration.
     *
     * Bumping the epoch is what invalidates work still in flight for the
     * viewer. It does not abort that work itself: the caller decides, since a
     * running calibration replaces its own previous result through here.
     */
    _invalidateViewer(viewerId, { evictCache = true } = {}) {
        const S = this._getSession();
        const viewer = this._findViewerById(viewerId);
        const api = viewer?.scalebar?.ViewportSyncAPI;
        if (api) {
            api._clearAdjust();
            if (api.enabled) api._unlink();
            // While its transform is still known: give the viewer its own
            // orientation back, or the registration angle stays baked in.
            this._releasePose(viewer);
            api._linkedId = null;
        }

        delete S.transforms[viewerId];
        delete S.flipParity[viewerId];
        delete S.points[viewerId];
        S.epoch[viewerId] = (S.epoch[viewerId] || 0) + 1;

        // A memoized registration would otherwise reinstate exactly the
        // alignment that was just discarded.
        if (evictCache && viewer) OpenSeadragon.ViewportRegistration?.clearCacheFor?.(viewer);
    }

    /**
     * Run one exclusive operation on this viewer. A second request while one
     * is in flight gets the same promise instead of a second picker, and the
     * operation's `AbortSignal` is what {@link cancelCalibration} trips.
     */
    _runOp(fn) {
        const controller = new AbortController();
        const op = { controller, promise: null, viewerId: this.master.uniqueId };
        this._op = op;
        this._setBusy(true);
        op.promise = (async () => {
            try {
                return await fn(controller.signal);
            } finally {
                if (this._op === op) this._op = null;
                this._progress = "";
                this._setBusy(false);
            }
        })();
        return op.promise;
    }

    /** Reject as soon as `signal` aborts, whether or not `promise` honours it. */
    _abortable(promise, signal) {
        if (!signal) return promise;
        return new Promise((resolve, reject) => {
            const onAbort = () => reject(new Error(CANCELLED));
            if (signal.aborted) return onAbort();
            signal.addEventListener("abort", onAbort, { once: true });
            Promise.resolve(promise)
                .then(resolve, reject)
                .finally(() => signal.removeEventListener("abort", onAbort));
        });
    }

    /**
     * Join the sync session.
     *
     * `mode: "auto"` (default) derives the alignment from
     * `OpenSeadragon.ViewportRegistration` — no user interaction — and only
     * falls back to the three-point picker when no provider is confident
     * enough. `mode: "manual"` goes straight to the picker.
     *
     * A viewer that already holds an alignment is simply linked again;
     * `replace: true` recomputes it instead. Replacement is transactional:
     * the old alignment is suspended (unlinked, so navigating to landmarks
     * does not drag the peers) and only discarded once the new one exists.
     * Cancelling, a timeout or a failure puts it back exactly as it was.
     *
     * A viewer the user explicitly cleared (`resetViewer`) is upgraded to
     * `"manual"` regardless of the requested mode: the point of clearing is
     * to re-align by hand. Batch callers opt out with `allowManual: false`,
     * an explicit `autoCalibrate()` drops the flag.
     *
     * @param {object} [opts]
     * @param {"auto"|"manual"} [opts.mode="auto"]
     * @param {boolean} [opts.replace=false] recompute an existing alignment
     * @param {boolean} [opts.force=false] ignore memoized registrations
     * @param {boolean} [opts.allowManual=true] may fall back to the picker
     * @return {Promise<{mode: string, approximate: boolean, poorFit: boolean}>}
     *   `approximate`: no registration provider was confident; `poorFit`: the
     *   hand-picked points do not agree with each other (see `_similarityFrom3`)
     */
    enable(opts = {}) {
        if (this._op) return this._op.promise;
        // Any other action on a paused viewer ends the pause first.
        if (this._adjusting) this.cancelAdjust();
        if (this.enabled && !opts.replace) {
            return Promise.resolve({ mode: "already-enabled", approximate: false, poorFit: false });
        }
        return this._runOp((signal) => this._enable(opts, signal));
    }

    async _enable(opts, signal) {
        // The session outlives layout changes; its reference viewer may not.
        this._reconcileReference();

        let S = this._getSession();
        const selfId = this.master.uniqueId;
        let mode = opts.mode === "manual" ? "manual" : "auto";
        if (this._pendingManual()[selfId] && opts.allowManual !== false) mode = "manual";
        let usedMode = mode;
        let approximate = false;
        let poorFit = false;

        // Re-calibrating the reference: its image space IS the reference
        // space, so there is nothing to recompute it against. Hand the role to
        // an open peer first — a re-base, the relative alignment of everybody
        // is unchanged — and calibrate this viewer like any other follower.
        if (opts.replace && S.leaderId === selfId) {
            const hasOpenPeer = Object.keys(S.transforms)
                .some(id => id !== selfId && this._findViewerById(id));
            if (hasOpenPeer) this._reelectLeader(selfId, { openOnly: true });
            S = this._getSession();
        }

        const epoch = S.epoch[selfId] || 0;
        const sameState = () =>
            ViewportSyncAPI._session === S && (S.epoch[selfId] || 0) === epoch;
        const assertCurrent = () => {
            if (signal.aborted || !sameState()) throw new Error(CANCELLED);
        };

        if (!S.leaderId) {
            // First viewer in: its image space simply *is* the reference
            // space. Manual mode additionally records three landmarks for the
            // viewers that join later.
            let refPts = null;
            if (mode === "manual") {
                refPts = await this._pickOwnPoints(opts.messageKey);
                assertCurrent();
                // Somebody else became the reference while this one picked.
                if (S.leaderId) throw new Error(CANCELLED);
            }
            S.leaderId = selfId;
            S.leaderPts = refPts;
            this._storeViewerTransform(selfId, this._identityTransform());
            this._setFlipParity(selfId, false);
        } else if (S.leaderId === selfId) {
            if (opts.replace && mode === "manual") {
                // The only calibrated viewer open: re-pick its landmarks.
                const refPts = await this._pickOwnPoints(opts.messageKey);
                assertCurrent();
                S.leaderPts = refPts;
                // Followers' stored points were matched to the old three.
                S.points = {};
            }
        } else if (!S.transforms[selfId] || opts.replace) {
            const hadTransform = !!S.transforms[selfId];
            const wasEnabled = this.enabled;
            if (wasEnabled) this._unlink(); // suspended: pose and transform stay

            let candidate = null;
            try {
                if (mode === "auto") {
                    candidate = await this._autoCandidate(S, opts, signal);
                    assertCurrent();
                }
                if (candidate) {
                    approximate = !!candidate.approximate;
                    poorFit = !!candidate.poorFit;
                } else if (opts.allowManual === false) {
                    // Batch callers must not chain interactive pickers.
                    throw new Error("Automatic alignment failed");
                } else {
                    usedMode = "manual";
                    candidate = await this._manualCandidate(S);
                    assertCurrent();
                    poorFit = !!candidate.poorFit;
                }
            } catch (e) {
                // Nothing was touched yet: put the previous alignment back,
                // unless a clear in the meantime made it somebody else's call.
                if (wasEnabled && sameState() && S.transforms[selfId]) {
                    this._link(S);
                    this._snapToPeers(S);
                    this._refreshAllChrome();
                }
                throw e;
            }

            // Commit. A hand-made alignment also evicts the memoized
            // registration, so a later automatic run starts from scratch.
            const manual = candidate.source !== "auto";
            if (hadTransform) this._invalidateViewer(selfId, { evictCache: manual });
            else if (manual) OpenSeadragon.ViewportRegistration?.clearCacheFor?.(this.master);

            this._storeViewerTransform(selfId, { ...candidate.t, source: candidate.source });
            this._setFlipParity(selfId, candidate.parity);
            if (candidate.points) S.points[selfId] = candidate.points;
            if (candidate.leaderPts) S.leaderPts = candidate.leaderPts;
        }

        // Calibration succeeded — the pending re-align has been honoured.
        delete this._pendingManual()[selfId];

        this._link(S);
        // Make the newly joined viewer snap to the current synced pose.
        this._snapToPeers(S);

        this._refreshAllChrome();
        return { mode: usedMode, approximate, poorFit };
    }

    /**
     * Three points on this viewer with nothing to match them against (it is,
     * or is about to be, the reference). The markers outlive the third click
     * for a moment, so the pick visibly lands.
     */
    async _pickOwnPoints(messageKey) {
        const markers = this._markerSet(this.master, "reference");
        let done = false;
        try {
            const pts = await this.calibrateViewer(this.master, { messageKey, markers });
            done = true;
            return pts;
        } finally {
            markers.clear(done ? 1500 : 0);
        }
    }

    /**
     * Ask the registration chain for this viewer's transform against the
     * session reference. Returns null when nothing could be estimated, so
     * the caller can fall back to manual picking. Stores nothing.
     * @return {Promise<?{t, parity: boolean, source: "auto", approximate: boolean}>}
     */
    async _autoCandidate(S, opts = {}, signal) {
        const registration = OpenSeadragon.ViewportRegistration;
        if (!registration) return null;

        const refViewer = this._findViewerById(S.leaderId);
        if (!refViewer || refViewer === this.master) return null;

        this._setProgress(window.$.t('sync.autoProgress'));
        let result;
        try {
            result = await this._abortable(registration.estimate(refViewer, this.master, {
                force: !!opts.force,
                signal,
            }), signal);
        } catch (e) {
            if (signal?.aborted) throw new Error(CANCELLED);
            console.warn("[sync-auto] registration error", this.master.uniqueId, e);
            return null;
        } finally {
            this._setProgress("");
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
        return {
            t,
            parity: this._xorBool(!!result.flip, !!S.flipParity?.[S.leaderId]),
            source: "auto",
            approximate: !!result.approximate,
        };
    }

    /**
     * "Align this viewer automatically" as an explicit request: recompute,
     * whatever alignment — hand-made included — the viewer holds now. An
     * explicit automatic run also overrides a pending manual clear.
     */
    autoCalibrate(opts = {}) {
        if (this._op) return this._op.promise;
        delete this._pendingManual()[this.master.uniqueId];

        const S = ViewportSyncAPI._session;
        // The reference has nothing to register against; just link it.
        if (!S?.leaderId || S.leaderId === this.master.uniqueId) {
            return this.enable({ ...opts, mode: "auto" });
        }
        return this.enable({ force: true, ...opts, mode: "auto", replace: true });
    }

    /**
     * The reference viewer may have been closed since the session was built
     * (grid layout change, slide switch). Promote an open, still-calibrated
     * viewer so the remembered alignment keeps working; with none open there
     * is nothing to align against and the session is dropped.
     */
    _reconcileReference() {
        const S = ViewportSyncAPI._session;
        if (!S?.leaderId || this._findViewerById(S.leaderId)) return;
        this._reelectLeader(S.leaderId, { openOnly: true });
    }

    /**
     * Three-point picker path. Stores nothing — returns the candidate.
     *
     * The picked points only mean something against the reference viewer's
     * own three, so those are shown (numbered, zoomed to) while this viewer
     * picks. A session without them — built by automatic registration, or
     * restored from a scene that predates stored points — has nothing to
     * show, so the order flips: this viewer, the one the user acted on,
     * picks first, and the reference then marks the same three with this
     * viewer's markers as the guide. Those become the session's reference
     * points for later joiners.
     *
     * Either way only this viewer's transform changes. Every transform maps
     * the reference image space to one viewer, so the alignment of the other
     * viewers — automatic or manual — is untouched by how this one was made.
     *
     * Markers of both viewers stay up until the result is known, and a little
     * longer on success: the third click must not make them vanish.
     * @return {Promise<{t, parity: boolean, source: "manual", points, leaderPts, poorFit: boolean}>}
     */
    async _manualCandidate(S) {
        const refViewer = this._findViewerById(S.leaderId);
        const refApi = refViewer?.scalebar?.ViewportSyncAPI;
        if (!refViewer || !refApi) throw new Error("Sync reference viewer unavailable");

        const ownMarkers = this._markerSet(this.master, "own");
        const refMarkers = this._markerSet(refViewer, "reference");
        let done = false;
        try {
            let tgtPts;
            let refPts = S.leaderPts;
            let leaderPts = null;

            if (refPts) {
                refMarkers.show(refPts);
                this._fitToPoints(refViewer, refPts);
                tgtPts = await this.calibrateViewer(this.master, {
                    messageKey: 'sync.pickMatchingPoints', markers: ownMarkers,
                });
            } else {
                if (refApi._op) throw new Error("Sync reference viewer busy");
                tgtPts = await this.calibrateViewer(this.master, {
                    messageKey: 'sync.pickPointsThenReference', markers: ownMarkers,
                });
                this._fitToPoints(this.master, tgtPts);

                // The pick now runs on the reference viewer, but this is still
                // this viewer's calibration: either viewer's button cancels it.
                refApi._setBusy(true);
                this._activeCalibrationCancel = () => refApi.cancelCalibration();
                try {
                    refPts = await refApi.calibrateViewer(refViewer, {
                        messageKey: 'sync.pickMatchingOnReference', markers: refMarkers,
                    });
                } finally {
                    this._activeCalibrationCancel = null;
                    refApi._progress = "";
                    refApi._setBusy(false);
                }
                leaderPts = refPts;
            }

            const t = this._similarityFrom3(refPts, tgtPts);
            if (!t) throw new Error("Calibration invalid");

            const refFlip = refViewer?.viewport?.getFlip?.() ?? false;
            const selfFlip = this.master?.viewport?.getFlip?.() ?? false;
            done = true;
            return {
                t,
                parity: this._xorBool(selfFlip, refFlip),
                source: "manual",
                points: tgtPts,
                leaderPts,
                // Three points over-determine the fit; what is left over is
                // the only evidence that a click (or the order) was wrong.
                poorFit: t.residual > POOR_FIT_RESIDUAL,
            };
        } finally {
            const lingerMs = done ? 1500 : 0;
            ownMarkers.clear(lingerMs);
            refMarkers.clear(lingerMs);
        }
    }

    /**
     * One numbered calibration marker at an IMAGE-space point.
     *
     * The overlay element itself is a zero-size anchor: OSD owns its
     * `display` and `transform` and rewrites both on every draw, so anything
     * that centres or lays out the dot has to live on a child.
     * @return {?HTMLElement} the overlay element, for `viewer.removeOverlay`
     */
    _addPointMarker(viewer, imgPt, label, variant = "own") {
        const item = viewer?.world?.getItemAt(0);
        if (!item) return null;
        // Overlays live in VIEWPORT coordinates.
        const vpPt = item.imageToViewportCoordinates(
            new OpenSeadragon.Point(imgPt.x, imgPt.y)
        );

        const el = document.createElement("div");
        el.style.width = "0";
        el.style.height = "0";
        el.style.overflow = "visible";
        el.style.pointerEvents = "none";

        const dot = document.createElement("div");
        // Colour tells whose points these are: the reference viewer's, or the
        // ones of the viewer being aligned. Sizes are inline — the shipped
        // Tailwind build is purged.
        dot.className = "rounded-full ring-2 ring-base-100 shadow " +
            (variant === "reference" ? "bg-primary" : "bg-error");
        dot.style.cssText =
            "position:absolute;left:0;top:0;width:24px;height:24px;" +
            "transform:translate(-50%,-50%);display:flex;align-items:center;" +
            "justify-content:center;font-size:12px;font-weight:700;line-height:1;" +
            "color:white;pointer-events:none";
        dot.textContent = String(label);
        el.appendChild(dot);

        viewer.addOverlay({
            element: el,
            location: vpPt,
            placement: OpenSeadragon.Placement.CENTER
        });
        return el;
    }

    /**
     * A group of numbered markers on one viewer. Registered class-wide so
     * they can be put back after the viewer re-opens (OSD drops every overlay
     * on `open`), and so a destroyed viewer takes its markers with it.
     */
    _markerSet(viewer, variant = "own") {
        const registry = (ViewportSyncAPI._markerSets ||= new Set());
        const api = this;
        const removeEl = (el) => {
            if (!el) return;
            try { viewer.removeOverlay(el); } catch {}
        };
        const set = {
            viewer,
            pts: [],
            els: [],
            timer: null,
            add(pt) {
                this.pts.push(pt);
                this.els.push(api._addPointMarker(viewer, pt, this.pts.length, variant));
            },
            show(pts) {
                for (const pt of pts || []) this.add(pt);
            },
            pop() {
                this.pts.pop();
                removeEl(this.els.pop());
            },
            redraw() {
                this.els.forEach(removeEl);
                this.els = this.pts.map((pt, i) => api._addPointMarker(viewer, pt, i + 1, variant));
            },
            clear(lingerMs = 0) {
                if (this.timer) clearTimeout(this.timer);
                this.timer = null;
                if (lingerMs > 0) {
                    this.timer = setTimeout(() => this.clear(), lingerMs);
                    return;
                }
                this.els.forEach(removeEl);
                this.els = [];
                this.pts = [];
                registry.delete(this);
            },
        };
        registry.add(set);
        return set;
    }

    /**
     * Bring calibration points into view, with room around them: a marker
     * on the very edge of the view is as good as hidden.
     */
    _fitToPoints(viewer, pts) {
        const item = viewer?.world?.getItemAt(0);
        if (!item || !Array.isArray(pts) || !pts.length) return;

        const vps = pts.map(p => item.imageToViewportCoordinates(new OpenSeadragon.Point(p.x, p.y)));
        const minX = Math.min(...vps.map(p => p.x)), maxX = Math.max(...vps.map(p => p.x));
        const minY = Math.min(...vps.map(p => p.y)), maxY = Math.max(...vps.map(p => p.y));
        const w = maxX - minX, h = maxY - minY;
        if (![minX, minY, w, h].every(isFinite)) return;

        if (w > 0 || h > 0) {
            const pad = Math.max(w, h) * 0.35;
            viewer.viewport.fitBounds(
                new OpenSeadragon.Rect(minX - pad, minY - pad, w + 2 * pad, h + 2 * pad));
        } else {
            viewer.viewport.panTo(new OpenSeadragon.Point(minX, minY));
        }
    }

    /**
     * Show a message on the viewport it concerns — at its top, clear of the
     * scalebar dock — rather than in the global toast.
     * @return {function(): void} hides it again (a no-op for the global toast,
     *   whose current message may be somebody else's)
     */
    _notify(viewer, text, delayMS, importance, props = {}) {
        const dialogs = window.Dialogs;
        if (!dialogs?.show) return () => {};
        const local = dialogs.forViewer?.(viewer, { position: "top" });
        if (!local) {
            dialogs.show(text, delayMS >= 1000 ? delayMS : 5000, importance, props);
            return () => {};
        }
        local.show(text, delayMS, importance, props);
        return () => local.hide(false);
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
     *
     * Starts from a clean session: "align everything" is a request to
     * recompute, so an existing alignment — hand-picked points included —
     * is replaced rather than kept wherever one happens to exist. Joining
     * on top of it would also mix automatic transforms with a reference
     * space defined by somebody's three clicks.
     * @return {Promise<{aligned:number, failed:number, approximate:number}>}
     */
    static async autoSyncAll(referenceViewer = null) {
        const viewers = (window.VIEWER_MANAGER?.viewers || []).filter(v => v?.scalebar?.ViewportSyncAPI);
        const result = { aligned: 0, failed: 0, approximate: 0 };
        if (viewers.length < 2) return result;

        const reference = referenceViewer && viewers.includes(referenceViewer)
            ? referenceViewer
            : (window.VIEWER_MANAGER?.get?.() || viewers[0]);

        // Also unlinks everyone and hands each viewer its own rotation back,
        // so registration below starts from unposed viewers. It arms a manual
        // re-align on every viewer; `allowManual: false` below overrides that
        // for the batch, and it stays armed only where automation failed.
        reference.scalebar.ViewportSyncAPI.resetSession();

        // Reference first so the session's reference space is its image space.
        const ordered = [reference, ...viewers.filter(v => v !== reference)];

        // The session this batch is building. Once it is replaced — the user
        // cleared it mid-run — carrying on would link viewers into a session
        // nobody asked for.
        let session = null;
        const abandoned = () => !!session && ViewportSyncAPI._session !== session;

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
            if (abandoned()) return result;
            const r = await joinOne(viewer, false);
            session ||= ViewportSyncAPI._session;
            if (r.status === "failed") failed.push(viewer);
            else {
                result.aligned++;
                if (r.approximate) result.approximate++;
            }
        }
        for (const viewer of failed) {
            if (abandoned()) return result;
            const r = await joinOne(viewer, true);
            if (r.status === "failed") result.failed++;
            else {
                result.aligned++;
                if (r.approximate) result.approximate++;
            }
        }
        return result;
    }

    /**
     * Calibrate every open viewer by hand, in viewport order: the first one
     * defines the reference points, each further one marks the same three.
     * Used by the Tools menu; the per-viewer control calibrates one viewer.
     *
     * Replaces the session, like `autoSyncAll`. A cancelled pick rejects with
     * the picker's "cancelled" error; viewers calibrated before it stay linked.
     * @return {Promise<{aligned:number, total:number}>}
     */
    static async manualSyncAll() {
        const viewers = (window.VIEWER_MANAGER?.viewers || []).filter(v => v?.scalebar?.ViewportSyncAPI);
        const result = { aligned: 0, total: viewers.length };
        if (viewers.length < 2) return result;

        viewers[0].scalebar.ViewportSyncAPI.resetSession();

        let session = null;
        for (const [index, viewer] of viewers.entries()) {
            if (session && ViewportSyncAPI._session !== session) throw new Error(CANCELLED);
            const api = viewer.scalebar.ViewportSyncAPI;
            // Point the user at the viewport that is waiting for clicks.
            window.VIEWER_MANAGER?.setActive?.(viewer, 'manual');
            await api.enable({
                mode: "manual",
                messageKey: index === 0 ? 'sync.pickPointsFirst' : undefined,
            });
            session ||= ViewportSyncAPI._session;
            result.aligned++;
        }
        return result;
    }

    /** @see OpenSeadragon.ViewportRegistration.registerProvider */
    static registerProvider(id, provider) {
        return OpenSeadragon.ViewportRegistration?.registerProvider(id, provider);
    }

    /** Unlink, keeping the alignment and the pose: linking again snaps back. */
    disable() {
        if (!this.enabled) return;
        this._unlink();
        this._notifyUi();
    }

    // ------------------------------------------------------------------ adjust

    /** A calibrated, open viewer to measure an adjustment against. */
    _adjustPeer() {
        const S = ViewportSyncAPI._session;
        if (!S) return null;
        const selfId = this.master.uniqueId;
        const candidates = this._allSyncViewers().filter(v =>
            v !== this.master && v.uniqueId !== selfId && S.transforms?.[v.uniqueId]);
        // A linked peer shows the pose the session agrees on.
        return candidates.find(v => v.scalebar.ViewportSyncAPI.enabled) || candidates[0] || null;
    }

    /**
     * Pause this viewer's sync so it can be moved on its own. Nothing is
     * discarded: {@link commitAdjust} turns wherever the viewer was left into
     * its new alignment, {@link cancelAdjust} puts it back.
     * @return {boolean} false when there is nothing to adjust
     */
    beginAdjust() {
        if (this._op || this._adjusting) return false;
        const S = ViewportSyncAPI._session;
        const selfId = this.master.uniqueId;
        const peer = this._adjustPeer();
        if (!S?.transforms?.[selfId] || !peer) return false;

        const wasEnabled = this.enabled;
        if (wasEnabled) this._unlink(); // the pose stays

        // The points the current alignment was made from, as a guide.
        const sets = [];
        const show = (viewer, pts, variant) => {
            if (!pts) return;
            const set = this._markerSet(viewer, variant);
            set.show(pts);
            sets.push(set);
        };
        show(this.master, this._pointsOf(S, selfId), "own");
        show(peer, this._pointsOf(S, peer.uniqueId), "reference");

        const hide = this._notify(this.master, window.$.t('sync.adjustHint'), 0, window.Dialogs?.MSG_INFO, {
            mode: "replace",
            buttons: [
                {
                    label: window.$.t('sync.adjustResume'),
                    onClick: () => {
                        try {
                            this.commitAdjust();
                        } catch (e) {
                            console.warn("[sync] adjustment failed", e);
                            this.cancelAdjust();
                        }
                    },
                },
                { label: window.$.t('sync.adjustDiscard'), onClick: () => this.cancelAdjust() },
            ],
        });

        this._adjusting = { sets, hide, wasEnabled };
        this._notifyUi();
        return true;
    }

    /** Tear the adjust UI down without deciding what happens to the viewer. */
    _clearAdjust() {
        const adjusting = this._adjusting;
        if (!adjusting) return null;
        this._adjusting = null;
        for (const set of adjusting.sets) set.clear();
        try { adjusting.hide(); } catch {}
        this._notifyUi();
        return adjusting;
    }

    /** Leave adjust mode and return to the alignment the viewer had. */
    cancelAdjust() {
        const adjusting = this._clearAdjust();
        if (!adjusting) return false;
        const S = ViewportSyncAPI._session;
        if (adjusting.wasEnabled && S?.transforms?.[this.master.uniqueId]) {
            this._link(S);
            this._snapToPeers(S);
        }
        this._refreshAllChrome();
        return true;
    }

    /**
     * Leave adjust mode keeping the viewer where it is: its transform is
     * re-derived so that the pose it shows now is the synced one.
     *
     * Solved from the mapper's own equations (`_mapStateBetweenViewers`), so
     * mapping the peer's current state through the new transform lands on
     * exactly this viewer's current centre, zoom and rotation.
     */
    commitAdjust() {
        if (!this._adjusting) return false;
        const selfId = this.master.uniqueId;
        const peer = this._adjustPeer();
        let S = ViewportSyncAPI._session;
        if (!S?.transforms?.[selfId] || !peer) {
            this.cancelAdjust();
            throw new Error("Sync adjustment unavailable");
        }

        // The reference's transform is the identity by definition; move the
        // role to a peer so this viewer can carry a real one.
        if (S.leaderId === selfId) this._reelectLeader(selfId, { openOnly: true });
        S = ViewportSyncAPI._session;
        const adjusted = S?.transforms?.[selfId] && this._transformFromPoses(peer);
        if (!adjusted) {
            this.cancelAdjust();
            throw new Error("Sync adjustment unavailable");
        }

        this._clearAdjust();
        this._storeViewerTransform(selfId, { ...adjusted.t, source: "adjusted" });
        this._setFlipParity(selfId, adjusted.parity);
        // Neither the picked points nor a memoized registration describe the
        // alignment any more.
        delete S.points[selfId];
        S.epoch[selfId] = (S.epoch[selfId] || 0) + 1;
        OpenSeadragon.ViewportRegistration?.clearCacheFor?.(this.master);

        // No snap: the viewer already is where the new transform puts it.
        this._link(S);
        this._refreshAllChrome();
        return true;
    }

    /**
     * This viewer's transform, re-derived from where it and `peer` are
     * looking right now. The existing matrix is turned and scaled rather
     * than rebuilt, so a mirrored registration stays mirrored.
     */
    _transformFromPoses(peer) {
        const selfId = this.master.uniqueId;
        const peerItem = peer.world?.getItemAt(0);
        const selfItem = this.master.world?.getItemAt(0);
        const peerState = peer.tools?.readViewportState?.();
        const selfState = this.master.tools?.readViewportState?.();
        const peerT = this._getViewerTransform(peer.uniqueId);
        const old = this._getViewerTransform(selfId);
        if (!peerItem || !selfItem || !peerState || !selfState || !peerT || !old) return null;

        const rotDeg = peerState.rotation + (peerT.rotDeg || 0) - selfState.rotation;
        const scale = (peerT.scale || 1) * peerState.zoom
            * this._zoomRatio(peer, peerItem, this.master, selfItem) / selfState.zoom;
        if (!isFinite(rotDeg) || !isFinite(scale) || scale <= 0) return null;

        const turn = (rotDeg - (old.rotDeg || 0)) * Math.PI / 180;
        const k = scale / (old.scale || 1);
        const A = this._mul2x2(
            [k * Math.cos(turn), -k * Math.sin(turn), k * Math.sin(turn), k * Math.cos(turn)],
            old.A
        );
        const invA = this._invert2x2(A);
        if (!invA) return null;

        const peerCenter = peerItem.viewportToImageCoordinates(peerState.center);
        const selfCenter = selfItem.viewportToImageCoordinates(selfState.center);
        const refCenter = this._mapImagePointToReference(peerCenter, peerT);
        const mapped = this._mul2x2_vec(A, refCenter);
        const b = { x: selfCenter.x - mapped.x, y: selfCenter.y - mapped.y };
        if (!isFinite(b.x) || !isFinite(b.y)) return null;

        return {
            t: { A, b, invA, scale, rotDeg },
            parity: this._xorBool(
                !!peerState.flip, this._getFlipParity(peer.uniqueId), !!selfState.flip),
        };
    }

    // ------------------------------------------------------------------- clear

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
        this._cancelActiveCalibrations();
        const S = this._getSession();

        this._invalidateViewer(viewerId);
        this._pendingManual()[viewerId] = true;

        if (S.leaderId === viewerId) this._reelectLeader(viewerId);

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
     *
     * @param {string} oldLeaderId
     * @param {object} [opts]
     * @param {boolean} [opts.openOnly=false] promote open viewers only
     */
    _reelectLeader(oldLeaderId, opts = {}) {
        const S = this._getSession();
        // `openOnly`: the old reference is gone rather than cleared, so only
        // a viewer that is actually open can stand in for it. Transforms of
        // closed viewers (the old reference included) are kept and re-based.
        const newLeaderId = Object.keys(S.transforms || {}).find(id =>
            id !== oldLeaderId && (!opts.openOnly || this._findViewerById(id)));
        if (!newLeaderId) {
            // Nobody left to reference — nothing to re-base onto.
            for (const v of this._allSyncViewers()) {
                const api = v.scalebar.ViewportSyncAPI;
                api._clearAdjust();
                v.tools?.unlink?.(S.context);
                this._releasePose(v);
                api.enabled = false;
                api._linkedId = null;
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
                // The old reference's alignment is now whatever the promoted
                // viewer's was; everyone else keeps their own provenance.
                source: id === oldLeaderId ? tY.source : t.source,
            };
            parity[id] = this._xorBool(this._getFlipParity(id), parityY);
        }

        // Leader points live in the old reference space; carry them across so
        // a later manual calibration need not re-pick the reference viewer.
        // In its own image space they remain the old reference's own points.
        const oldLeaderPts = Array.isArray(S.leaderPts) ? S.leaderPts : null;
        const leaderPts = oldLeaderPts
            ? oldLeaderPts.map(p => this._mapImagePointFromReference(p, tY)).filter(Boolean)
            : null;
        if (oldLeaderPts && S.transforms[oldLeaderId]) S.points[oldLeaderId] = oldLeaderPts;
        delete S.points[newLeaderId];

        S.transforms = {};
        S.flipParity = parity;
        S.leaderId = newLeaderId;
        S.leaderPts = leaderPts?.length === 3 ? leaderPts : null;
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
     * Each viewer also gets its own orientation back: the registration
     * angle a follower was turned by has no meaning without the session.
     *
     * Like the per-viewer clear, this arms a manual re-align on every
     * viewer: a user who throws the whole alignment away is telling us the
     * automatic estimate was wrong, so the next LINK must ask for points
     * rather than recompute the same answer.
     */
    resetSession() {
        this._cancelActiveCalibrations();
        const S = this._getSession();
        const pending = this._pendingManual();
        for (const v of this._allSyncViewers()) {
            const peerApi = v.scalebar.ViewportSyncAPI;
            peerApi._clearAdjust();
            v.tools?.unlink?.(S.context);
            // Unlinked first, so the correction stays on this viewer.
            this._releasePose(v);
            peerApi.enabled = false;
            peerApi._linkedId = null;
            pending[v.uniqueId] = true;
        }
        // Dropping the session object is what invalidates everything still in
        // flight: results are only stored into the session they started in.
        ViewportSyncAPI._session = null;
        this.enabled = false;
        // A full reset means "forget everything", memoized registrations included.
        OpenSeadragon.ViewportRegistration?.clearCache?.();
        this._refreshAllChrome();
    }

    // ------------------------------------------------------------------ picker

    /**
     * Pick three points on this viewer.
     * @param {OpenSeadragon.Viewer} viewer
     * @param {object} [pickOpts]
     * @param {string} [pickOpts.messageKey] i18n key of the instruction
     * @param {object} [pickOpts.markers] marker set to draw into; the caller
     *   then owns its lifetime (it survives the pick)
     * @return {Promise<Array<{x:number,y:number}>>} image-space points
     */
    async calibrateViewer(viewer, pickOpts = {}) {
        return new Promise((resolve, reject) => {
            const settle = (fn, arg) => {
                this._activeCalibrationCancel = null;
                this._setProgress("");
                fn(arg);
            };

            const cleanupPick = this.pickThreePoints(
                (pts) => settle(resolve, pts),
                () => settle(reject, new Error(CANCELLED)),
                (current, total) => this._setProgress(`${current}/${total}`),
                { messageKey: pickOpts.messageKey, markers: pickOpts.markers }
            );
            // Handle so the UI can abort an in-flight point pick (clicking
            // SYNC again while busy).
            this._activeCalibrationCancel = cleanupPick;
        });
    }

    /**
     * Abort every in-flight calibration, on any viewer. A clear invalidates
     * what a running calibration is being measured against: left alone, the
     * picker — and the reference markers shown for it — would linger until
     * its idle timeout.
     */
    _cancelActiveCalibrations() {
        for (const v of this._allSyncViewers()) v.scalebar.ViewportSyncAPI.cancelCalibration?.();
        this.cancelCalibration();
    }

    /**
     * Abort whatever calibration is in flight on this viewer — a point pick
     * or an automatic registration. The pending `enable()` rejects with a
     * "cancelled" error and the previous alignment, if any, is put back.
     * @return {boolean} true if something was actually aborted
     */
    cancelCalibration() {
        let aborted = false;
        const cancel = this._activeCalibrationCancel;
        if (typeof cancel === "function") {
            this._activeCalibrationCancel = null;
            cancel();
            aborted = true;
        }
        const controller = this._op?.controller;
        if (controller && !controller.signal.aborted) {
            controller.abort();
            aborted = true;
        }
        return aborted;
    }

    /**
     * Ask user to pick three points. The scalebar then stores the navigation sync data for it
     *
     * Mouse navigation stays enabled throughout: the landmarks a user wants
     * are rarely all in the current view, so panning and zooming must keep
     * working. A drag therefore ends in an OSD `canvas-click` like any other
     * release, and only a click that did not move the viewport marks a point.
     *
     * A double-click is one intent, not two points on the same spot. It is
     * recognised by OSD's own `canvas-double-click` — the single definition of
     * "double" (time and distance thresholds, per pointer type) the viewer
     * has — never by timing clicks here or by a raw DOM `dblclick` listener.
     *
     * The instruction stays on the viewport for the whole pick and carries
     * the Undo / Cancel buttons — keyboard is a shortcut, not the only way.
     *
     * @param onDone
     * @param onCancel
     * @param onProgress
     * @param {object} [opts]
     * @return {function(): void} cancels the pick
     */
    pickThreePoints(onDone, onCancel, onProgress, opts = {}) {
        const viewer = this.master;
        const pts = [];
        const total = 3;
        // Markers handed in by the caller outlive the pick; our own do not.
        const ownsMarkers = !opts.markers;
        const markers = opts.markers || this._markerSet(viewer, "own");

        // Idle limit, not a deadline: every click and every viewport movement
        // restarts it (see `restartTimeout`), so it only fires on a picker the
        // user walked away from. Finding a landmark that matches a numbered
        // point on the reference slide takes far longer than a few seconds.
        const timeoutMs = Math.max(1000, opts.timeoutMs ?? 120000);
        let timeoutRef = null;
        let settled = false;
        let hideInstruction = () => {};

        // Distance, not duration: OSD's own `event.quick` also demands the
        // 300 ms `clickTimeThreshold`, which would reject the slow, careful
        // click a user places on a small landmark.
        const DRAG_TOLERANCE_PX = 5;
        let pressPos = null;
        let dragged = false;
        // Whether the most recent click placed a point (it may have been a
        // drag) — what a double-click arriving right after it has to undo.
        let lastClickPlaced = false;

        const prevCursor = viewer.container?.style.cursor ?? "";

        const detach = () => {
            viewer.removeHandler("canvas-click", handler);
            viewer.removeHandler("canvas-double-click", doubleClickHandler);
            viewer.removeHandler("canvas-press", pressHandler);
            viewer.removeHandler("canvas-drag", dragHandler);
            viewer.removeHandler("animation", restartTimeout);
            window.removeEventListener("keydown", keyHandler, true);
            if (viewer.container) viewer.container.style.cursor = prevCursor;
            if (timeoutRef) clearTimeout(timeoutRef);
            hideInstruction();
            if (ownsMarkers) markers.clear();
        };

        const cancel = () => {
            if (settled) return;
            settled = true;
            detach();
            onCancel?.();
        };

        const finish = () => {
            if (settled) return;
            settled = true;
            detach();
            onDone?.(pts);
        };

        const restartTimeout = () => {
            if (timeoutRef) clearTimeout(timeoutRef);
            timeoutRef = setTimeout(() => {
                cancel();
                this._notify(viewer, window.$.t('sync.calibrationTimeout'), 2500, window.Dialogs?.MSG_WARN);
            }, timeoutMs);
        };

        const removeLast = () => {
            if (settled || !pts.length) return;
            pts.pop();
            markers.pop();
            onProgress?.(pts.length, total);
            restartTimeout();
        };

        const keyHandler = (ev) => {
            if (ev.key !== "Escape" && ev.key !== "Backspace") return;
            // Typing elsewhere is not about the pick.
            const target = ev.target;
            if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "")) return;
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.key === "Escape") cancel();
            else removeLast();
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
            lastClickPlaced = false;
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

            const point = { x: img.x, y: img.y };
            pts.push(point);
            markers.add(point);
            lastClickPlaced = true;
            onProgress?.(pts.length, total);
            restartTimeout();

            e.preventDefaultAction = true;
            // Not yet finished: OSD raises `canvas-double-click` right after
            // this handler, within the same pointer release, and a double
            // click takes this point back. Decide once the dispatch is over.
            if (pts.length >= total) {
                queueMicrotask(() => { if (pts.length >= total) finish(); });
            }
        };

        const doubleClickHandler = (e) => {
            // The second click of the pair already placed a point on top of
            // the first one; keep the first only. No zoom-on-double-click
            // either — the user is placing landmarks, not navigating.
            if (e) e.preventDefaultAction = true;
            if (!lastClickPlaced) return;
            lastClickPlaced = false;
            removeLast();
        };

        hideInstruction = this._notify(
            viewer, window.$.t(opts.messageKey || 'sync.pickPoints'), 0, window.Dialogs?.MSG_INFO, {
                mode: "replace",
                buttons: [
                    { label: window.$.t('sync.undoPoint'), onClick: removeLast },
                    { label: window.$.t('common.cancel'), onClick: cancel },
                ],
            });
        onProgress?.(0, total);

        viewer.addHandler("canvas-click", handler);
        viewer.addHandler("canvas-double-click", doubleClickHandler);
        viewer.addHandler("canvas-press", pressHandler);
        viewer.addHandler("canvas-drag", dragHandler);
        // Panning/zooming towards a landmark counts as activity.
        viewer.addHandler("animation", restartTimeout);
        window.addEventListener("keydown", keyHandler, true);
        if (viewer.container) viewer.container.style.cursor = "crosshair";
        restartTimeout();

        // return cleanup for callers (calibrateViewer uses this)
        return cancel;
    }

    // --------------------------------------------------------------- lifecycle

    /**
     * One subscription for the whole app. The session is keyed by
     * `viewer.uniqueId`, which is derived from the slide: a viewer that opens
     * another slide is, to the session, a different viewer.
     */
    static _installLifecycle() {
        if (ViewportSyncAPI._lifecycleInstalled) return;
        const manager = window.VIEWER_MANAGER;
        if (!manager?.broadcastHandler || !manager?.addHandler) return;
        ViewportSyncAPI._lifecycleInstalled = true;

        manager.broadcastHandler("open", (e) => {
            const viewer = e?.eventSource;
            // OSD dropped every overlay when the viewer re-opened.
            for (const set of ViewportSyncAPI._markerSets || []) {
                if (set.viewer === viewer) set.redraw();
            }
            viewer?.scalebar?.ViewportSyncAPI?._onSlideOpened?.();
        });
        manager.addHandler("viewer-destroy", (e) => {
            const viewer = e?.viewer;
            viewer?.scalebar?.ViewportSyncAPI?._onViewerDestroyed?.();
            for (const set of [...(ViewportSyncAPI._markerSets || [])]) {
                if (set.viewer === viewer) set.clear();
            }
        });
    }

    /**
     * The viewer shows a slide again. If it is a *different* slide than the
     * one that was linked, the link is void: without this the badge would
     * keep saying SYNC while the mapper silently skipped the viewer.
     */
    _onSlideOpened() {
        const id = this.master.uniqueId;
        const startedOn = this._linkedId || this._op?.viewerId;
        if (!startedOn || startedOn === id) return;

        const wasEnabled = this.enabled;
        this.cancelCalibration();
        this._clearAdjust();
        if (wasEnabled) this._unlink();
        // The pose belonged to the previous slide's transform; the new slide
        // opened with its own viewport.
        this._poseApplied = false;
        this._linkedId = null;

        // The session remembers alignments of slides it has seen before.
        if (wasEnabled && ViewportSyncAPI._session?.transforms?.[id]) {
            this.enable({ mode: "auto", allowManual: false })
                .catch((e) => console.warn("[sync] re-link after slide change failed", e));
        }
        this._refreshAllChrome();
    }

    _onViewerDestroyed() {
        this.cancelCalibration();
        this._clearAdjust();
        if (this.enabled) this._unlink();
        this._linkedId = null;
    }

    // ------------------------------------------------------------------ mapper

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

    /**
     * Zoom must be converted through IMAGE pixels, not viewport units: two
     * viewers showing differently sized slides (or a placed virtual region)
     * have different "viewport units per image pixel", so a raw zoom copy
     * would leave the magnifications mismatched. This is the factor that
     * equates screen-pixels-per-image-pixel on both sides.
     */
    _zoomRatio(sourceViewer, sourceItem, targetViewer, targetItem) {
        const vpUnitsPerImagePx = (item) => {
            const origin = item.imageToViewportCoordinates(new OpenSeadragon.Point(0, 0));
            const unit = item.imageToViewportCoordinates(new OpenSeadragon.Point(1, 0));
            return Math.abs(unit.x - origin.x) || 1;
        };
        const containerWidth = (v) => v.viewport?.getContainerSize?.().x || 1;
        return (containerWidth(sourceViewer) / containerWidth(targetViewer))
            * (vpUnitsPerImagePx(sourceItem) / vpUnitsPerImagePx(targetItem));
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

        // Equate screen-pixels-per-image-pixel on both sides, then divide by
        // the registration scale from source to target. `_transformFromPoses`
        // inverts exactly these three equations — keep them in step.
        const relativeScale = (targetT.scale || 1) / (sourceT.scale || 1);
        const zoom = sourceState.zoom
            * this._zoomRatio(sourceViewer, sourceItem, targetViewer, targetItem)
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

    /**
     * Least-squares similarity (rotation, uniform scale, translation) taking
     * `refPts` onto `tgtPts`. Two pairs would determine it exactly; the third
     * averages click error and leaves a `residual`: the RMS distance between
     * where the fit puts the reference points and where the user clicked,
     * relative to the RMS spread of the clicked points (0 = perfect).
     */
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

        let error = 0, spread = 0;
        for (let i = 0; i < 3; i++) {
            const fx = A[0] * refPts[i].x + A[1] * refPts[i].y + t.x;
            const fy = A[2] * refPts[i].x + A[3] * refPts[i].y + t.y;
            error += (fx - tgtPts[i].x) ** 2 + (fy - tgtPts[i].y) ** 2;
            spread += (tgtPts[i].x - tc.x) ** 2 + (tgtPts[i].y - tc.y) ** 2;
        }
        const residual = spread > 0 ? Math.sqrt(error / spread) : 0;

        return { A, b: t, invA, scale, rotDeg, residual };
    }
}

export { ViewportSyncAPI };
