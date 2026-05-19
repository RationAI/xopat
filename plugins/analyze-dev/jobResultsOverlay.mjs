const COLOR_PALETTE = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];

class JobResultsOverlay {
    constructor() {
        this._jobStore = new Map();    // jobId → {color, viewerId, fabricObjects}
        this._viewerState = new Map(); // viewerId → {canvas, ctx, objects, viewer, handler, resizeObserver}
        this._colorMap = new Map();    // fabricObj → color
        this._colorIndex = 0;
    }

    addJobResults(jobId, shapes, viewerId) {
        if (!shapes || !shapes.length) {
            console.log('[job-overlay] no shapes to render for job', jobId);
            return;
        }

        const color = COLOR_PALETTE[this._colorIndex % COLOR_PALETTE.length];
        this._colorIndex++;

        const fabricObjects = [];
        for (const shape of shapes) {
            if (!shape || !shape.factoryID) continue;
            try {
                shape.setCoords();
                fabricObjects.push(shape);
                this._colorMap.set(shape, color);
            } catch (e) {
                console.warn('[job-overlay] failed to prepare shape', shape.factoryID, e);
            }
        }

        if (!fabricObjects.length) {
            console.warn('[job-overlay] no renderable objects for job', jobId);
            return;
        }

        this._jobStore.set(jobId, { color, viewerId: String(viewerId), fabricObjects });
        console.log('[job-overlay] stored', fabricObjects.length, 'objects for job', jobId, 'color', color);

        this._ensureViewerState(String(viewerId));
        this._syncObjects(String(viewerId));
        this._redraw(String(viewerId));
    }

    destroy(viewerId) {
        const state = this._viewerState.get(viewerId);
        if (!state) return;
        state.viewer.removeHandler('update-viewport', state.handler);
        state.resizeObserver.disconnect();
        state.canvas.remove();
        this._viewerState.delete(viewerId);
    }

    _ensureViewerState(viewerId) {
        if (this._viewerState.has(viewerId)) return;

        const viewer = VIEWER_MANAGER.viewers.find(v => v && String(v.id) === String(viewerId));
        if (!viewer) {
            console.warn('[job-overlay] viewer not found for id', viewerId);
            return;
        }

        const container = viewer.element;
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:10;';
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        container.appendChild(canvas);
        const ctx = canvas.getContext('2d');

        const handler = () => this._redraw(viewerId);
        viewer.addHandler('update-viewport', handler);

        const resizeObserver = new ResizeObserver(() => {
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;
            this._redraw(viewerId);
        });

        this._viewerState.set(viewerId, { canvas, ctx, objects: [], viewer, handler, resizeObserver });
        console.log('[job-overlay] viewer state initialised for', viewerId);
        resizeObserver.observe(container);
    }

    _syncObjects(viewerId) {
        const state = this._viewerState.get(viewerId);
        if (!state) return;
        state.objects = [];
        for (const [, job] of this._jobStore) {
            if (String(job.viewerId) !== String(viewerId)) continue;
            for (const obj of job.fabricObjects) state.objects.push(obj);
        }
    }

    _redraw(viewerId) {
        const state = this._viewerState.get(viewerId);
        if (!state) return;
        const { canvas, ctx, objects, viewer } = state;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!objects.length) return;

        const tiledImage = viewer.scalebar?.getReferencedTiledImage?.() || viewer.world?.getItemAt?.(0);
        if (!tiledImage) return;

        for (const obj of objects) {
            this._drawShape(ctx, obj, this._colorMap.get(obj), tiledImage);
        }
    }

_toScreen(tiledImage, x, y) {
        return tiledImage.imageToViewerElementCoordinates(new OpenSeadragon.Point(x, y));
    }

    _drawShape(ctx, decoded, color, tiledImage) {
        const { factoryID } = decoded;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;

        if (factoryID === 'rect') {
            const tl = this._toScreen(tiledImage, decoded.left, decoded.top);
            const br = this._toScreen(tiledImage, decoded.left + decoded.width, decoded.top + decoded.height);
            ctx.beginPath();
            ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.2;
            ctx.fill();

        } else if (factoryID === 'ellipse') {
            const center = this._toScreen(tiledImage, decoded.left + decoded.rx, decoded.top + decoded.ry);
            const edgeX = this._toScreen(tiledImage, decoded.left + decoded.rx * 2, decoded.top + decoded.ry);
            const edgeY = this._toScreen(tiledImage, decoded.left + decoded.rx, decoded.top + decoded.ry * 2);
            const rx = Math.abs(edgeX.x - center.x);
            const ry = Math.abs(edgeY.y - center.y);
            ctx.beginPath();
            ctx.ellipse(center.x, center.y, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.2;
            ctx.fill();

        } else if (factoryID === 'polygon' || factoryID === 'multipolygon') {
            const pts = decoded.points;
            if (!pts || pts.length < 2) { ctx.restore(); return; }
            ctx.beginPath();
            const first = this._toScreen(tiledImage, pts[0].x, pts[0].y);
            ctx.moveTo(first.x, first.y);
            for (let i = 1; i < pts.length; i++) {
                if (pts[i].x >= 1e8 && pts[i].y >= 1e8) {
                    ctx.closePath();
                    if (i + 1 < pts.length) {
                        const next = this._toScreen(tiledImage, pts[i + 1].x, pts[i + 1].y);
                        ctx.moveTo(next.x, next.y);
                    }
                    continue;
                }
                const s = this._toScreen(tiledImage, pts[i].x, pts[i].y);
                ctx.lineTo(s.x, s.y);
            }
            ctx.closePath();
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.2;
            ctx.fill();

        } else if (factoryID === 'polyline' || factoryID === 'ruler' || factoryID === 'line') {
            const pts = decoded.points;
            if (!pts || pts.length < 2) { ctx.restore(); return; }
            ctx.beginPath();
            const first = this._toScreen(tiledImage, pts[0].x, pts[0].y);
            ctx.moveTo(first.x, first.y);
            for (let i = 1; i < pts.length; i++) {
                const s = this._toScreen(tiledImage, pts[i].x, pts[i].y);
                ctx.lineTo(s.x, s.y);
            }
            ctx.stroke();

        } else if (factoryID === 'point') {
            const s = this._toScreen(tiledImage, decoded.left, decoded.top);
            ctx.beginPath();
            ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.globalAlpha = 1;
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();
    }

}

window.JobResultsOverlay = JobResultsOverlay;
