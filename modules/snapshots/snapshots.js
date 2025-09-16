// snapshots.js — multi-viewer storage via getViewerContext + viewer-destroy warning

window.OpenSeadragon.Snapshots = class extends XOpatModuleSingleton {
    constructor() {
        super("snapshots");
        this.registerAsEventSource();
        this.initPostIO();

        // expose a small helper for the export link above
        window.OpenSeadragon.Snapshots.__exportViewer = async (vid) => {
            try {
                const viewer = VIEWER_MANAGER.getViewer(vid);
                const data = await this.exportViewerData(viewer, "", vid);
                UTILITIES.downloadAsFile(`snapshots-${vid}.json`, data);
            } catch (e) {
                console.error(e);
                Dialogs.show("Failed to export snapshots.", 2500, Dialogs.MSG_ERR);
            }
        };

        this._snapshotsState = {
            idx: 0,
            steps: [],
            currentStep: null,
            playing: false,
            captureVisualization: false,
            captureViewport: true,
            captureScreen: false,
        };
    }

    async exportData(key) {
        return JSON.stringify(this._snapshotsState.steps);
    }

    async importData(key, data) {
        this._importJSON(data);
    }

    // ---------- Core ops (viewer-scoped) ----------
    create(viewerId, delay=0, duration=0.5, transition=1.6, atIndex=undefined) {
        const st = this._snapshotsState;
        if (st.playing) return;

        const v = VIEWER_MANAGER.getViewer(viewerId) || VIEWER;
        const view = v.viewport;
        const utils = v.tools;

        const step = {
            id: `${Date.now()}`,
            zoomLevel: st.captureViewport ? view.getZoom() : undefined,
            point:       st.captureViewport ? view.getCenter() : undefined,
            bounds:      st.captureViewport ? view.getBounds() : undefined,
            preferSameZoom: true,
            delay, duration, transition,
            visualization: this._getVisualizationSnapshot(v, st.captureVisualization),
            viewerId,
            screenShot: st.captureScreen ? utils?.screenshot(true, {width:120, height:120}) : undefined
        };

        this._add(step, atIndex);
    }

    remove(index=undefined) {
        const st = this._snapshotsState;
        if (st.playing) return;
        index = index ?? st.idx;

        const step = st.steps[index];
        st.steps.splice(index, 1);
        st.idx = st.steps.length ? st.idx % st.steps.length : 0;

        this.raiseEvent("remove", { viewerId: step.viewerId, index, step });
    }

    getSteps() {
        return this._snapshotsState.steps.filter(s => this._isValidStep(s));
    }

    getStep(index) {
        return this._snapshotsState.steps[index];
    }

    snapshotCount() { return this._snapshotsState.steps.length; }
    currentStep()   { const st = this._snapshotsState; return st.steps[st.idx]; }
    currentStepIndex()  { return this._snapshotsState.idx; }
    isPlaying()     { return this._snapshotsState.playing; }

    play() {
        const st = this._snapshotsState;
        if (st.playing) return;
        if (st.idx >= st.steps.length) st.idx = Math.max(0, st.steps.length - 1);
        this.raiseEvent("play");
        this.playStep(st.idx);
        st.playing = true;
    }

    previous() {
        const st = this._snapshotsState;
        if (st.playing) this.playStep(st.idx - 2, true);
        else this.goToIndex(st.idx - 1);
    }

    next() {
        const st = this._snapshotsState;
        if (st.playing) this.playStep(st.idx, true);
        else this.goToIndex( st.idx + 1);
    }

    playFromIndex(index) {
        const st = this._snapshotsState;
        if (st.playing) return;
        st.idx = index;
        this.play();
    }

    stop() {
        const st = this._snapshotsState;
        if (!st.playing) return;
        if (st.currentStep) { st.currentStep.cancel(); st.currentStep = null; }
        st.playing = false;
        this.raiseEvent("stop");
    }

    goToIndex(atIndex) {
        const st = this._snapshotsState;
        if (st.playing || !st.steps.length) return;
        st.idx = ((atIndex % st.steps.length) + st.steps.length) % st.steps.length;
        return this._jumpAt(st.idx);
    }

    capturesVisualization(value) {
        const st = this._snapshotsState;
        st.captureVisualization = !!value;
    }
    capturesViewport(value) { this._snapshotsState.captureViewport = !!value; }
    capturesScreen(value)   { this._snapshotsState.captureScreen   = !!value; }

    capturesVisualization() { return !!this._snapshotsState.captureVisualization; }
    capturesViewport()      { return !!this._snapshotsState.captureViewport; }
    capturesScreen()        { return !!this._snapshotsState.captureScreen; }

    exportJSON(serialize=true) {
        const st = this._snapshotsState;
        return serialize ? JSON.stringify(st.steps) : [...st.steps];
    }

    _importJSON(json) {
        const st = this._snapshotsState;
        if (typeof json === "string") json = JSON.parse(json);
        st.idx = 0;
        st.steps = [];
        st.currentStep = null;
        if (Array.isArray(json)) {
            for (let i = 0; i < json.length; i++) {
                const s = json[i];
                if (!s) continue;
                if (s.point) s.point = new OpenSeadragon.Point(s.point.x, s.point.y);
                this._add(s);
            }
        }
        st.idx = 0;
    }

    stepCapturesVisualization(step) { return step.visualization && step.visualization.cache; }
    stepCapturesViewport(step)      { return step.point && step.zoomLevel; }

    sortWithIdList(ids, removeMissing=false) {
        const st = this._snapshotsState;
        if (removeMissing) st.steps = st.steps.filter(s => ids.includes(s.id));
        st.steps.sort((a, b) => {
            let i = ids.indexOf(a.id), j = ids.indexOf(b.id);
            if (i < 0) return 1;
            if (j < 0) return -1;
            return i - j;
        });
    }

    _isValidStep(indexOrStep) {
        const step = typeof indexOrStep === "object" ? indexOrStep : this._snapshotsState.steps[indexOrStep];
        return step && VIEWER_MANAGER.getViewer(step.viewerId);
    }

    // ---------- internals ----------
    playStep(index, jumps=false) {
        const st = this._snapshotsState;
        while (st.steps.length > index && !st.steps[index]) index++;
        if (st.steps.length <= index) {
            st.currentStep = null;
            this.stop();
            return;
        }

        let withDelay = 1, prevIdx = -1;
        if (jumps) {
            if (st.currentStep) { st.currentStep.cancel(); st.currentStep = null; }
            withDelay = 0;
            prevIdx = st.idx > 0 ? st.idx - 1 : 0;
        } else {
            prevIdx = index > 0 ? index - 1 : 0;
        }
        while (prevIdx > 0 && !this._isValidStep(prevIdx)) prevIdx--;

        const previousDuration = prevIdx >= 0 && st.steps[prevIdx] ? st.steps[prevIdx].duration * 1000 : 0;
        st.currentStep = this._setDelayed(withDelay * (st.steps[index].delay * 1000 + previousDuration), index);

        st.currentStep.promise.then(atIndex => {
            this._jumpAt(atIndex, prevIdx);
            st.idx = atIndex + 1;
            this.playStep(st.idx);
        });
    }

    _getVisualizationSnapshot(v, captureVisualization) {
        if (!captureVisualization || !v?.bridge) return undefined;
        const vis = v.bridge.visualization();
        const shadersCache = {};
        for (let key of vis.order) {
            if (vis.shaders.hasOwnProperty(key) && vis.shaders[key].rendering) {
                shadersCache[key] = $.extend(true, {}, vis.shaders[key].cache);
            }
        }
        return {
            index: v.bridge.currentVisualizationIndex(),
            cache: shadersCache,
            order: [...vis.order]
        };
    }

    _setDelayed(ms, index) {
        if (ms <= 0) return { promise: Promise.resolve(index), cancel() {} };
        let timeout;
        const p = new Promise(resolve => { timeout = setTimeout(() => resolve(index), ms); });
        return { promise: p, cancel() { clearTimeout(timeout); } };
    }

    _add(step, index=undefined) {
        if (!this._isValidStep(step)) return;

        const st = this._snapshotsState;
        if (typeof index === "number" && index >= 0 && index < st.steps.length) {
            st.steps.splice(index, 0, step);
        } else {
            index = st.steps.length;
            st.steps.push(step);
        }
        this.raiseEvent("create", { viewerId: step.viewerId, index, step });
    }

    _jumpAt(index, fromIndex=undefined) {
        const st = this._snapshotsState;
        const step = st.steps[index];
        if (!step || st.steps.length <= index) return;
        const v = VIEWER_MANAGER.getViewer(step.viewerId);
        if (!v) return;

        const capturesViewport = step.point && !isNaN(step.zoomLevel);
        if (step.visualization) this._setVisualization(v, step, capturesViewport ? step.duration : 0);
        if (capturesViewport) v.tools.focus(step);
        else if (v.bridge) v.bridge.redraw();

        this.raiseEvent("enter", {
            index,
            prevIndex: isNaN(fromIndex) ? undefined : fromIndex,
            prevStep: isNaN(fromIndex) ? undefined : st.steps[fromIndex],
            step
        });
        return step;
    }

    _setVisualization(viewer, step, duration) {
        const bridge = viewer.bridge;
        const from = step.visualization;
        const curIdx = bridge.currentVisualizationIndex();
        const curVis = bridge.visualization(from.index);
        let needsRefresh = !this._equalOrder(curVis.order, from.order);

        for (let key in curVis.shaders) {
            const shaderSetup = curVis.shaders[key];
            const isVisible = shaderSetup.visible;
            const willBeVisible = from.cache.hasOwnProperty(key);
            if (willBeVisible !== isVisible) needsRefresh = true;
            shaderSetup.visible = willBeVisible;
            if (shaderSetup.visible) {
                const cachedCache = from.cache[key];
                if (!needsRefresh && !this._equalCache(shaderSetup.cache, cachedCache)) {
                    needsRefresh = true;
                }
                if (needsRefresh) shaderSetup.cache = $.extend(true, {}, cachedCache);
            }
        }

        if (curIdx !== from.index) {
            curVis.order = from.order;
            bridge.switchVisualization(from.index);
        } else if (needsRefresh) {
            bridge.webGLEngine.rebuildVisualization(from.order);
            bridge.redraw(duration * 900);
        }
    }

    _equalCache(a, b) {
        if ((!a || !b) && a !== b) return false;
        if (Object.keys(a).length !== Object.keys(b).length) return false;
        for (const key in a) {
            const av = a[key], bv = b[key];
            if ((av instanceof Object && !this._equalCache(av, bv)) || (!(av instanceof Object) && av !== bv)) {
                return false;
            }
        }
        return true;
    }

    _equalOrder(arrA, arrB) {
        if (!arrA || !arrB || arrA.length !== arrB.length) return false;
        for (let i = 0; i < arrA.length; i++) if (arrA[i] !== arrB[i]) return false;
        return true;
    }
};