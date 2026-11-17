const COLOR_PALETTE = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];

class JobResultsOverlay {
    constructor() {
        this._jobStore = new Map(); // jobId → { layerIds: string[], viewerId, visible }
        this._colorIndex = 0;
    }

    /**
     * Render a job's output annotations, one layer and one coloured preset per output.
     * @param {string} jobId
     * @param {Array<{key: string, shapes: Array}>} groups output key and its decoded shapes
     * @param {string} viewerId
     */
    async addJobResults(jobId, groups, viewerId) {
        const nonEmpty = (groups || [])
            .map(g => ({ key: g.key, shapes: (g.shapes || []).filter(Boolean) }))
            .filter(g => g.shapes.length);
        if (!nonEmpty.length) {
            return;
        }

        // Clear any existing layers/presets for this job before creating new ones.
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

        const shortId = String(jobId).slice(0, 8);
        const entry = { layerIds: [], viewerId: String(viewerId), visible: true };
        // Registered before the layers exist so clearJob can remove a partially added job.
        this._jobStore.set(jobId, entry);

        for (const { key, shapes } of nonEmpty) {
            const color = COLOR_PALETTE[this._colorIndex++ % COLOR_PALETTE.length];
            const layerId = `job-${jobId}-${key}`;
            const layerName = `${key} (job ${shortId})`;

            try {
                // createLayer() returns Promise<undefined>; retrieve via getLayer() after awaiting.
                await fabric.createLayer(layerId);
                entry.layerIds.push(layerId);
                const layer = fabric.getLayer(layerId);
                if (layer) layer.name = layerName;

                // Create a local preset so updateSingleAnnotationVisuals can apply the output colour.
                const preset = annot.presets.addPreset(layerId, layerName, color);

                for (const shape of shapes) {
                    shape.layerID = layerId;
                    shape.presetID = preset.presetID;
                    // color must be set explicitly: commonAnnotationVisuals has no 'color' property,
                    // so updateRendering's typeof check would skip preset colour application otherwise.
                    shape.color = color;
                }

                await fabric.addAnnotationsBulk(shapes, {
                    historyName: 'Load job results',
                    progress: true,
                    viewer: viewer,
                });
            } catch (e) {
                console.error('[job-overlay] failed to add job results for job', jobId, 'output', key, e);
            }
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
        const ids = new Set(entry.layerIds.map(String));
        for (const layerId of entry.layerIds) {
            fabric.setLayerVisibility(layerId, visible);
        }
        // Belt-and-suspenders: sweep all canvas objects matching this job.
        // Some annotations may have layerID reset to undefined during bulk-add
        // if the layer lookup failed mid-batch; presetID is set independently
        // and never cleared, so it reliably identifies every annotation.
        for (const obj of fabric.canvas._objects || []) {
            if (ids.has(String(obj.layerID)) || ids.has(String(obj.presetID))) {
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
            for (const layerId of entry.layerIds) {
                if (fabric) {
                    try {
                        await fabric.deleteLayer(layerId);
                    } catch (e) {
                        console.warn('[job-overlay] failed to delete layer', layerId, e);
                    }
                }
                if (annot) {
                    try {
                        annot.presets.removePreset(layerId);
                    } catch (e) {
                        console.warn('[job-overlay] failed to remove preset', layerId, e);
                    }
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
