const COLOR_PALETTE = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];

class JobResultsOverlay {
    constructor() {
        this._jobStore = new Map(); // jobId → { layerId, viewerId }
        this._colorIndex = 0;
    }

    async addJobResults(jobId, shapes, viewerId) {
        if (!shapes || !shapes.length) {
            console.log('[job-overlay] no shapes to render for job', jobId);
            return;
        }

        // Clear any existing layer/preset for this job before creating new ones.
        if (this._jobStore.has(jobId)) {
            await this.clearJob(jobId);
        }

        const annot = OSDAnnotations.instance();
        if (!annot) {
            console.warn('[job-overlay] OSDAnnotations not available');
            return;
        }

        const viewer = VIEWER_MANAGER.viewers.find(v => v && String(v.uniqueId) === String(viewerId));
        if (!viewer) {
            console.warn('[job-overlay] viewer not found for id', viewerId);
            return;
        }

        const fabric = annot.getFabric(viewer);
        if (!fabric) {
            console.warn('[job-overlay] fabric not available for viewer', viewerId);
            return;
        }

        const color = COLOR_PALETTE[this._colorIndex % COLOR_PALETTE.length];

        const layerId = `job-${jobId}`;
        const layerName = `Job ${String(jobId).slice(0, 8)}`;

        try {
            // createLayer() returns Promise<undefined>; retrieve via getLayer() after awaiting.
            await fabric.createLayer(layerId);
            const layer = fabric.getLayer(layerId);
            if (layer) layer.name = layerName;

            // Create a local preset so updateSingleAnnotationVisuals can apply the job colour.
            const preset = annot.presets.addPreset(layerId, layerName, color);

            const valid = shapes.filter(Boolean);
            for (const shape of valid) {
                shape.layerID = layerId;
                shape.presetID = preset.presetID;
                // color must be set explicitly: commonAnnotationVisuals has no 'color' property,
                // so updateRendering's typeof check would skip preset colour application otherwise.
                shape.color = color;
            }

            await fabric.addAnnotationsBulk(valid, {
                historyName: 'Load job results',
                progress: true,
                viewer: viewer,
            });

            this._jobStore.set(jobId, { layerId, viewerId: String(viewerId) });
            this._colorIndex++;
            console.log('[job-overlay] added', valid.length, 'annotations for job', jobId);

        } catch (e) {
            console.error('[job-overlay] failed to add job results for job', jobId, e);
        }
    }

    setJobVisible(jobId, visible) {
        const entry = this._jobStore.get(jobId);
        if (!entry) return;
        const viewer = VIEWER_MANAGER.viewers.find(v => v && String(v.uniqueId) === String(entry.viewerId));
        if (!viewer) return;
        const annot = OSDAnnotations.instance();
        const fabric = annot?.getFabric(viewer);
        if (!fabric) return;
        fabric.setLayerVisibility(entry.layerId, visible);
        // Belt-and-suspenders: sweep all canvas objects matching this job.
        // Some annotations may have layerID reset to undefined during bulk-add
        // if the layer lookup failed mid-batch; presetID is set independently
        // and never cleared, so it reliably identifies every annotation.
        for (const obj of fabric.canvas._objects || []) {
            if (String(obj.layerID) === String(entry.layerId) ||
                String(obj.presetID) === String(entry.layerId)) {
                obj.visible = !!visible;
                obj.evented = !!visible;
                obj.selectable = !!visible;
            }
        }
        fabric.canvas.requestRenderAll?.();
        entry.visible = visible;
    }

    async clearJob(jobId) {
        const entry = this._jobStore.get(jobId);
        if (!entry) return;

        const viewer = VIEWER_MANAGER.viewers.find(v => v && String(v.uniqueId) === String(entry.viewerId));
        if (viewer) {
            const annot = OSDAnnotations.instance();
            const fabric = annot?.getFabric(viewer);
            if (fabric) {
                try {
                    await fabric.deleteLayer(entry.layerId);
                } catch (e) {
                    console.warn('[job-overlay] failed to delete layer', entry.layerId, e);
                }
            }
            if (annot) {
                try {
                    annot.presets.removePreset(entry.layerId);
                } catch (e) {
                    console.warn('[job-overlay] failed to remove preset', entry.layerId, e);
                }
            }
        }

        this._jobStore.delete(jobId);
    }

    async destroy(viewerId) {
        const toRemove = [...this._jobStore.keys()]
            .filter(id => String(this._jobStore.get(id).viewerId) === String(viewerId));
        await Promise.all(toRemove.map(id => this.clearJob(id)));
    }
}

window.JobResultsOverlay = JobResultsOverlay;
