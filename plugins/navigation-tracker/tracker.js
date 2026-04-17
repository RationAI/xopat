addPlugin("nav-tracker", class extends XOpatPlugin {
    constructor(id) {
        super(id);

        this.canvasWidth = 250;
        this.animates = this.getStaticMeta("animate", true);
        this.maxOpacity = this.getStaticMeta("maxOpacity", 0.6);

        this._states = Object.create(null);
        this._globalKey = null;
    }

    getViewerId(viewer) {
        return viewer?.uniqueId || viewer?.id || "default";
    }

    getStateKey(viewer) {
        return `${this._globalKey}::${this.getViewerId(viewer)}`;
    }

    getState(viewer) {
        if (!viewer || !this._globalKey) return null;

        const key = this.getStateKey(viewer);
        let state = this._states[key];
        if (state) return state;

        const canvas = document.createElement("canvas");
        const recordCtx = canvas.getContext("2d", { alpha: true });
        if (!recordCtx) return null;

        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.opacity = "0.45";

        state = this._states[key] = {
            key,
            viewerId: this.getViewerId(viewer),
            viewer,
            canvas,
            recordCtx,
            data: [],
            activeVisit: null,
            overlayAdded: false,
            trackerAttached: false,
            navigatorBounds: null,
        };

        return state;
    }

    getData(viewer) {
        return this.getState(viewer)?.data || [];
    }

    clamp(value, min = 0, max = 1) {
        return Math.min(max, Math.max(min, value));
    }

    sameBounds(a, b, eps = 1e-4) {
        return Math.abs(a.x - b.x) < eps &&
            Math.abs(a.y - b.y) < eps &&
            Math.abs(a.width - b.width) < eps &&
            Math.abs(a.height - b.height) < eps &&
            Math.abs((a.rotation || 0) - (b.rotation || 0)) < eps;
    }

    refreshCanvas(viewer, canvas) {
        if (!viewer?.viewport || !canvas) return null;

        const homeBounds = viewer.viewport.getHomeBounds();
        homeBounds.width += 2 * homeBounds.x;
        homeBounds.height += 2 * homeBounds.y;
        homeBounds.x = 0;
        homeBounds.y = 0;

        canvas.width = Math.max(1, Math.round(this.canvasWidth * homeBounds.width));
        canvas.height = Math.max(1, Math.round(this.canvasWidth * homeBounds.height));
        return homeBounds;
    }

    refreshViewer(viewer) {
        const state = this.getState(viewer);
        if (!state) return null;

        state.viewer = viewer;
        state.navigatorBounds = this.refreshCanvas(viewer, state.canvas);
        state.recordCtx.clearRect(0, 0, state.canvas.width, state.canvas.height);
        state.recordCtx.globalCompositeOperation = "source-over";
        return state.navigatorBounds;
    }

    ensureOverlay(viewer) {
        const state = this.getState(viewer);
        if (!state?.navigatorBounds || state.overlayAdded || !viewer?.navigator) return;

        viewer.navigator.addOverlay({
            element: state.canvas,
            location: state.navigatorBounds,
        });
        state.overlayAdded = true;

        if (!state.trackerAttached) {
            new OpenSeadragon.MouseTracker({
                element: state.canvas,
                enterHandler: e => {
                    if (e?.originalEvent?.target?.style) {
                        e.originalEvent.target.style.opacity = "0.15";
                    }
                },
                leaveHandler: e => {
                    if (e?.originalEvent?.target?.style) {
                        e.originalEvent.target.style.opacity = "0.45";
                    }
                },
            });
            state.trackerAttached = true;
        }
    }

    getNormalizedZoom(viewport) {
        if (!viewport) return 0;

        const zoom = viewport.getZoom(true);
        const maxZoom = viewport.getMaxZoom();
        const zoomLog = Math.log2(Math.max(zoom, 1));
        const maxZoomLog = Math.log2(Math.max(maxZoom, 1));

        if (!Number.isFinite(zoomLog) || !Number.isFinite(maxZoomLog) || maxZoomLog <= 0) {
            return 0;
        }

        return this.clamp(zoomLog / maxZoomLog);
    }

    getViewportSnapshot(viewer, now = Date.now()) {
        const viewport = viewer?.viewport;
        if (!viewport) return null;

        const bounds = viewport.getBoundsNoRotate(true);
        const rotation = viewport.getRotation ? viewport.getRotation() : 0;
        const size = this.canvasWidth;

        return {
            viewerId: this.getViewerId(viewer),
            bounds: {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
                rotation,
            },
            rect: {
                x: size * bounds.x,
                y: size * bounds.y,
                width: size * bounds.width,
                height: size * bounds.height,
            },
            rotation,
            startedAt: now,
            endedAt: now,
            duration: 0,
            zoom: viewport.getZoom(true),
            zoomOpacity: this.getNormalizedZoom(viewport),
        };
    }

    finalizeVisit(visit, endedAt = Date.now()) {
        if (!visit) return null;
        return {
            ...visit,
            endedAt,
            duration: Math.max(0, endedAt - visit.startedAt),
        };
    }

    getSequentialColor(value, maxValue) {
        const stops = [
            [255, 245, 235],
            [253, 190, 133],
            [239, 101, 72],
            [153, 52, 4],
        ];

        const safeMax = Math.max(1, maxValue);
        const t = this.clamp(Math.log1p(Math.max(0, value)) / Math.log1p(safeMax));
        const scaled = t * (stops.length - 1);
        const idx = Math.min(stops.length - 2, Math.floor(scaled));
        const frac = scaled - idx;
        const start = stops[idx];
        const end = stops[idx + 1];
        const color = start.map((channel, i) => Math.round(channel + (end[i] - channel) * frac));
        return { r: color[0], g: color[1], b: color[2] };
    }

    getVisitOpacity(visit) {
        const configuredMaxOpacity = this.clamp(this.getOption("maxOpacity", this.maxOpacity));
        return configuredMaxOpacity * this.clamp(visit?.zoomOpacity ?? 0);
    }

    getVisitFillStyle(visit, maxDuration) {
        const { r, g, b } = this.getSequentialColor(visit?.duration || 0, maxDuration);
        const alpha = this.getVisitOpacity(visit);
        return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
    }

    drawCommittedVisit(viewer, visit, maxDuration = visit.duration || 1) {
        const state = this.getState(viewer);
        if (!state?.recordCtx || !visit?.rect) return;

        const ctx = state.recordCtx;
        const { x, y, width, height } = visit.rect;

        const currentRotation = viewer?.viewport?.getRotation ? viewer.viewport.getRotation() : 0;
        const visitRotation = visit.rotation || 0;
        const delta = ((visitRotation - currentRotation) * Math.PI) / 180;

        ctx.save();
        ctx.translate(x + width / 2, y + height / 2);
        ctx.rotate(delta);
        ctx.fillStyle = this.getVisitFillStyle(visit, maxDuration);
        ctx.fillRect(-width / 2, -height / 2, width, height);
        ctx.restore();
    }

    flushActiveVisit(viewer, endedAt = Date.now()) {
        const state = this.getState(viewer);
        if (!state?.activeVisit) return null;

        const visit = this.finalizeVisit(state.activeVisit, endedAt);
        state.data.push(visit);
        state.activeVisit = null;

        this.drawCommittedVisit(viewer, visit, visit.duration || 1);
        return visit;
    }

    handleViewportUpdate(viewer) {
        const state = this.getState(viewer);
        if (!state) return;

        const now = Date.now();
        const snapshot = this.getViewportSnapshot(viewer, now);
        if (!snapshot) return;

        if (!state.activeVisit) {
            state.activeVisit = snapshot;
            return;
        }

        if (this.sameBounds(state.activeVisit.bounds, snapshot.bounds)) {
            state.activeVisit.zoom = snapshot.zoom;
            state.activeVisit.zoomOpacity = snapshot.zoomOpacity;
            state.activeVisit.endedAt = now;
            return;
        }

        this.flushActiveVisit(viewer, now);
        state.activeVisit = snapshot;
    }

    drawVisit(recordCtx, visit, maxDuration, currentRotation = 0) {
        if (!recordCtx || !visit?.rect) return;

        const { x, y, width, height } = visit.rect;
        const visitRotation = visit.rotation || 0;
        const delta = (visitRotation * Math.PI) / 180;

        recordCtx.save();
        recordCtx.translate(x + width / 2, y + height / 2);
        recordCtx.rotate(delta);
        recordCtx.fillStyle = this.getVisitFillStyle(visit, maxDuration);
        recordCtx.fillRect(-width / 2, -height / 2, width, height);
        recordCtx.restore();
    }

    redraw(viewer, now = Date.now()) {
        const state = this.getState(viewer);
        if (!state?.recordCtx || !state.canvas) return;

        const visits = state.data;
        const activeVisit = state.activeVisit ? this.finalizeVisit(state.activeVisit, now) : null;
        const maxDuration = Math.max(
            1,
            ...visits.map(visit => visit.duration || 0),
            activeVisit?.duration || 0,
        );

        const ctx = state.recordCtx;
        const currentRotation = viewer?.viewport?.getRotation ? viewer.viewport.getRotation() : 0;

        ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
        ctx.globalCompositeOperation = "source-over";

        for (const visit of visits) {
            this.drawVisit(ctx, visit, maxDuration, currentRotation);
        }

        if (activeVisit) {
            this.drawVisit(ctx, activeVisit, maxDuration, currentRotation);
        }
    }

    attachViewer(viewer) {
        if (!viewer?.viewport) return;

        const state = this.getState(viewer);
        if (!state) return;

        this.refreshViewer(viewer);

        if (this.getOption("animate", this.animates)) {
            this.ensureOverlay(viewer);
        }

        this.handleViewportUpdate(viewer);
    }

    destroyViewerState(viewer) {
        const state = this.getState(viewer);
        if (!state) return;

        this.flushActiveVisit(viewer, Date.now());

        try {
            if (state.overlayAdded) {
                viewer.navigator?.removeOverlay?.(state.canvas);
            }
        } catch (e) {
            console.warn("nav-tracker: failed to remove navigator overlay", e);
        }

        delete this._states[state.key];
    }

    exportToFile() {
        const exportedAt = Date.now();
        const payload = {};

        for (const viewer of (VIEWER_MANAGER?.viewers || []).filter(Boolean)) {
            const state = this.getState(viewer);
            if (!state) continue;
            this.flushActiveVisit(viewer, exportedAt);
            payload[state.viewerId] = state.data;
        }

        UTILITIES.downloadAsFile("navigator.json", JSON.stringify(payload, null, 2));
    }

    pluginReady() {
        this._globalKey = APPLICATION_CONTEXT.sessionName;

        const animate = this.getOption("animate", this.animates);
        if (!animate) {
            USER_INTERFACE.AppBar.Plugins.setMenu(this.id, "navigator-export", "Export/Import",
                `<h3 class="f2-light">Navigator tracking IO </h3>
        <button id="downloadAnnotation" onclick="${this.THIS}.exportToFile();return false;" class="btn">Download as a file.</button>`);
        } else {
            VIEWER_MANAGER.broadcastHandler("animation-finish", (e) => {
                this.handleViewportUpdate(e.eventSource);
            });
        }

        VIEWER_MANAGER.broadcastHandler("open", (e) => {
            this.attachViewer(e.eventSource);
        });

        VIEWER_MANAGER.broadcastHandler("destroy", (e) => {
            this.destroyViewerState(e.eventSource);
        });

        VIEWER_MANAGER.broadcastHandler("update-viewport", (e) => {
            const viewer = e.eventSource;
            const state = this.getState(viewer);
            if (!state) return;

            this.handleViewportUpdate(viewer);

            if (state.activeVisit && animate) {
                this.redraw(viewer, Date.now());
            }
        });

        for (const viewer of (VIEWER_MANAGER?.viewers).filter(Boolean)) {
            this.attachViewer(viewer);
        }
    }
});
