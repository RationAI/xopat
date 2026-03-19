addPlugin("nav-tracker", class extends XOpatPlugin {
    constructor(id) {
        super(id);
        this.records = {};
        this.canvasWidth = 250;
        this.animates = this.getStaticMeta("animate", true);
        this.maxOpacity = this.getStaticMeta("maxOpacity", 0.6);
        this._overlayAdded = false;
        this._activeVisit = null;
        this._data = {};
    }

    getCanvas(key = this.key) {
        return this.getContext(key)?.canvas;
    }

    getContext(key = this.key) {
        let context = this.records[key];
        if (!context) {
            const canvas = document.createElement("canvas");
            context = canvas.getContext("2d", { alpha: true });
            canvas.style.width = "100%";
            canvas.style.height = "100%";
            canvas.style.opacity = "1.0";
            this.records[key] = context;
        }
        return context;
    }

    getData(key = this.key) {
        if (!this._data[key]) this._data[key] = [];
        return this._data[key];
    }

    refresh() {
        this.key = APPLICATION_CONTEXT.sessionName;
        this.recordCtx = this.getContext();
        this.record = this.recordCtx.canvas;
        const bounds = this.refreshCanvas();
        this.recordCtx.clearRect(0, 0, this.record.width, this.record.height);
        this.recordCtx.globalCompositeOperation = "source-over";
        return bounds;
    }

    refreshCanvas(canvas = this.record) {
        // todo support BG swaps, IO
        const homeBounds = VIEWER.viewport.getHomeBounds();
        homeBounds.width += 2 * homeBounds.x;
        homeBounds.height += 2 * homeBounds.y;
        homeBounds.x = 0;
        homeBounds.y = 0;
        canvas.width = Math.max(1, Math.round(this.canvasWidth * homeBounds.width));
        canvas.height = Math.max(1, Math.round(this.canvasWidth * homeBounds.height));
        return homeBounds;
    }

    exportToFile() {
        this.flushActiveVisit(Date.now());
        UTILITIES.downloadAsFile("navigator.json", JSON.stringify(this.getData()));
    }

    clamp(value, min = 0, max = 1) {
        return Math.min(max, Math.max(min, value));
    }

    sameBounds(a, b, eps = 1e-4) {
        return Math.abs(a.x - b.x) < eps &&
            Math.abs(a.y - b.y) < eps &&
            Math.abs(a.width - b.width) < eps &&
            Math.abs(a.height - b.height) < eps;
    }

    getNormalizedZoom(viewport = VIEWER.viewport) {
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

    getViewportSnapshot(now = Date.now()) {
        const viewport = VIEWER.viewport;
        if (!viewport) return null;

        const bounds = viewport.getBoundsNoRotate(true);
        const size = this.canvasWidth;
        return {
            bounds: {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height
            },
            rect: {
                x: size * bounds.x,
                y: size * bounds.y,
                width: size * bounds.width,
                height: size * bounds.height
            },
            startedAt: now,
            endedAt: now,
            duration: 0,
            zoom: viewport.getZoom(true),
            zoomOpacity: this.getNormalizedZoom(viewport)
        };
    }

    finalizeVisit(visit, endedAt = Date.now()) {
        if (!visit) return null;
        return {
            ...visit,
            endedAt,
            duration: Math.max(0, endedAt - visit.startedAt)
        };
    }

    flushActiveVisit(endedAt = Date.now()) {
        if (!this._activeVisit) return null;
        const visit = this.finalizeVisit(this._activeVisit, endedAt);
        this.getData().push(visit);
        this._activeVisit = null;
        return visit;
    }

    getSequentialColor(value, maxValue) {
        const stops = [
            [255, 245, 235],
            [253, 190, 133],
            [239, 101, 72],
            [153, 52, 4]
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

    redraw(now = Date.now()) {
        if (!this.recordCtx || !this.record) return;

        const visits = this.getData();
        const activeVisit = this._activeVisit ? this.finalizeVisit(this._activeVisit, now) : null;
        const maxDuration = Math.max(
            1,
            ...visits.map(visit => visit.duration || 0),
            activeVisit?.duration || 0
        );

        this.recordCtx.clearRect(0, 0, this.record.width, this.record.height);
        this.recordCtx.globalCompositeOperation = "source-over";

        for (const visit of visits) {
            this.recordCtx.fillStyle = this.getVisitFillStyle(visit, maxDuration);
            this.recordCtx.fillRect(visit.rect.x, visit.rect.y, visit.rect.width, visit.rect.height);
        }

        if (activeVisit) {
            this.recordCtx.fillStyle = this.getVisitFillStyle(activeVisit, maxDuration);
            this.recordCtx.fillRect(activeVisit.rect.x, activeVisit.rect.y, activeVisit.rect.width, activeVisit.rect.height);
        }
    }

    handleViewportUpdate() {
        const now = Date.now();
        const snapshot = this.getViewportSnapshot(now);
        if (!snapshot) return;

        if (!this._activeVisit) {
            this._activeVisit = snapshot;
        } else if (this.sameBounds(this._activeVisit.bounds, snapshot.bounds)) {
            this._activeVisit.zoom = snapshot.zoom;
            this._activeVisit.zoomOpacity = snapshot.zoomOpacity;
            this._activeVisit.endedAt = now;
        } else {
            this.flushActiveVisit(now);
            this._activeVisit = snapshot;
        }

        if (this.getOption("animate", this.animates)) {
            this.redraw(now);
        }
    }

    pluginReady() {
        const bounds = this.refresh();
        if (!bounds) return;

        this.data = this.getData();
        const animate = this.getOption("animate", this.animates);

        if (animate) {
            const outputCanvas = this.record;

            new OpenSeadragon.MouseTracker({
                element: outputCanvas,
                enterHandler: e => e.originalEvent.target.style.opacity = "0.35",
                leaveHandler: e => e.originalEvent.target.style.opacity = "1.0",
            });

            if (!this._overlayAdded) {
                VIEWER.navigator.addOverlay({
                    element: outputCanvas,
                    location: bounds,
                });
                this._overlayAdded = true;
            }
        } else {
            USER_INTERFACE.AppBar.Plugins.setMenu(this.id, "navigator-export", "Export/Import",
                `<h3 class="f2-light">Navigator tracking IO </h3>
        <button id="downloadAnnotation" onclick="${this.THIS}.exportToFile();return false;" class="btn">Download as a file.</button>`);
        }

        VIEWER.addHandler("update-viewport", () => {
            this.handleViewportUpdate();
        });

        VIEWER.addHandler("animation-finish", () => {
            if (this._activeVisit && animate) {
                this.redraw(Date.now());
            }
        });

        this.handleViewportUpdate();
    }
});
