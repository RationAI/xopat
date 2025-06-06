//TODO consider snapshots as ID-based instance, this way multiple sequences can be supported
window.OpenSeadragon.Snapshots = class extends XOpatModuleSingleton {
    constructor() {
        super("snaphots");
        this.viewer = VIEWER;

        this.registerAsEventSource();

        this._idx = 0;
        this._steps = [];
        this._currentStep = null;
        this.initPostIO(); //todo consider delegation to plugins that use snapshots
        this._deprecated_IO_API();
        this._utils = VIEWER.tools;

        this._captureVisualization = false;
        this._captureViewport = true;
        this._captureScreen = false;

        this.captureVisualization = false;
    }

    /**
     * Create a snapshot
     * @event create
     * @param {number} delay delay before the current snapshot is run when played, in seconds
     * @param {number} duration transition duration, in seconds
     * @param {number} transition transition style, 1 - linear; >1 - ease-out default 1.6
     * @param {number} atIndex index where to put the step, default undefined places at the end
     */
    create(delay=0, duration=0.5, transition=1.6, atIndex=undefined) {
        if (this._playing) {
            return;
        }
        let view = this.viewer.viewport;
        this._add({
            id: `${Date.now()}`,
            zoomLevel: this._captureViewport ? view.getZoom() : undefined,
            point: this._captureViewport ? view.getCenter() : undefined,
            bounds: this._captureViewport ? view.getBounds() : undefined,
            preferSameZoom: true, //possible param?
            delay: delay,
            duration: duration,
            transition: transition,
            visualization: this._getVisualizationSnapshot(),
            screenShot: this._captureScreen ?
                this._utils.screenshot(true, {width: 120, height: 120}) : undefined
        }, atIndex);
    }

    /**
     * Delete snapshot
     * @event remove
     * @param {number} index optional, deleted current if unspecified
     */
    remove(index=undefined) {
        if (this._playing) {
            return;
        }
        index = index ?? this._idx;

        let step = this._steps[index];
        this._steps.splice(index, 1);
        this._idx = this._idx % this._steps.length;
        this.raiseEvent("remove", {
            index: index,
            step: step
        });
    }

    /**
     * Get number of snapshots
     * @return {number}
     */
    get snapshotCount() {
        return this._steps.length;
    }

    /**
     * Get current step/snapshot
     * @return {object} current step with its data
     */
    get currentStep() {
        return this._steps[this._idx];
    }

    /**
     * Get current step/snapshot index
     * @return {number}
     */
    get currentStepIndex() {
        return this._idx;
    }

    /**
     * Check whether playback is running
     * @return {boolean} true if playing
     */
    get playing() {
        return this._playing;
    }

    /**
     * Play the sequence. Does nothing when already playing.
     * @event start raised when playing has begun
     * @event enter called after the delay waiting is done and the step executes
     */
    play() {
        if (this._playing) return;
        if (this._idx >= this._steps.length) {
            this._idx = this._steps.length-1;
        }
        this.raiseEvent("play");
        this._playStep(this._idx);
        this._playing = true;
    }

    /**
     * Play previous step once more or go the previous keyframe
     */
    previous() {
        if (this._playing) this._playStep(this._idx - 2, true);
        else this.goToIndex(this.currentStepIndex - 1);
    }

    /**
     * Play next step once more or go to the next keyframe
     */
    next() {
        if (this._playing) this._playStep(this._idx, true);
        else this.goToIndex(this.currentStepIndex + 1);
    }

    /**
     * Play from index.
     * @event start raised when playing has begun
     * @event enter called after the delay waiting is done and the step executes
     * @param {number} index to start from snapshot
     */
    playFromIndex(index) {
        if (this._playing) {
            return;
        }
        this._idx = index;
        this.play();
    }

    /**
     * Stop current playback.
     * @event stop called when playing was stopped
     */
    stop() {
        if (!this._playing) return;

        if (this._currentStep) {
            this._currentStep.cancel();
            this._currentStep = null;
        }

        this._playing = false;
        this.raiseEvent("stop");
    }

    /**
     * Set snapshot as active, apply its settings
     * @event enter called once the animation begun
     * @param {number} atIndex step index
     */
    goToIndex(atIndex) {
        if (this._playing) {
            return;
        }
        this._idx = atIndex % this._steps.length;
        this._jumpAt(this._idx);
    }

    /**
     * Toggle capturing of the current visualization
     * @param {boolean} value
     */
    set capturesVisualization(value) {
        this._captureVisualization = value && this.viewer.hasOwnProperty("bridge");
    }

    /**
     * Toggle capturing of the current viewport position
     * @param {boolean} value
     */
    set capturesViewport(value) {
        this._captureViewport = value;
    }

    /**
     * Save screen as image on capture
     * @param {boolean} value
     */
    set capturesScreen(value) {
        this._captureScreen = value;
    }

    /**
     * @return {boolean}
     */
    get capturesVisualization() {
        return this._captureVisualization;
    }

    /**
     * @return {boolean} value
     */
    get capturesViewport() {
        return this._captureViewport;
    }

    /**
     * @return {boolean}
     */
    get capturesScreen() {
        return this._captureScreen;
    }

    /**
     * Serialize current state
     * @return {string}
     */
    exportJSON(serialize=true) {
        return serialize ? JSON.stringify(this._steps) : [...this._steps];
    }

    async exportData() {
        return this.exportJSON();
    }

    async importData(data) {
        this.importJSON(data);
    }

    /**
     * Import state (deletes existing one)
     * @param {object[]|string} json
     */
    importJSON(json) {
        if (typeof json === "string") json = JSON.parse(json);
        this._idx = 0;
        this._steps = [];
        this._currentStep = null;
        for (let i = 0; i < json.length; i++) {
            if (!json[i]) continue;
            //recreate 'classes'
            json[i].point = new OpenSeadragon.Point(json[i].point.x, json[i].point.y);
            this._add(json[i]);
        }
        this._idx = 0;
    }

    /**
     * Check whether step contains visualization capture
     * @param {object} step
     * @return {boolean}
     */
    stepCapturesVisualization(step) {
        return step.visualization && step.visualization.cache;
    }

    /**
     * Check whether step contains viewport capture
     * @param {object} step
     * @return {boolean}
     */
    stepCapturesViewport(step) {
        return step.point && step.zoomLevel;
    }

    /**
     * Sorts the steps by given array of step IDs
     * @param {string[]} ids
     * @param {boolean} removeMissing
     */
    sortWithIdList(ids, removeMissing=false) {
        if (removeMissing) this._steps = this._steps.filter(s => ids.includes(s.id));
        this._steps.sort((a, b) => {
            let i = ids.indexOf(a.id), j = ids.indexOf(b.id); //n^2, could extract to make O(n)
            if (i < 0) return 1; //a not in list, push to end
            if (j < 0) return -1; //b not in list, push to end
            return i - j;
        });
    }

    _playStep(index, jumps=false) {
        while (this._steps.length > index && !this._steps[index]) {
            index++;
        }

        if (this._steps.length <= index) {
            this._currentStep = null;
            this.stop();
            return;
        }

        let withDelay = 1;
        let prevIdx = -1;

        if (jumps) {
            if (this._currentStep) {
                this._currentStep.cancel();
                this._currentStep = null;
            }
            withDelay = 0;
            prevIdx = this._idx-1; //'current' step when animating
        } else {
            prevIdx = index > 0 ? index-1 : 0;
            while (prevIdx > 0 && !this._steps[prevIdx]) prevIdx--;
        }

        let previousDuration = prevIdx >= 0 && this._steps[prevIdx] ? this._steps[prevIdx].duration * 1000 : 0;
        this._currentStep = this._setDelayed(withDelay * (this._steps[index].delay * 1000 + previousDuration), index);

        const _this = this;
        this._currentStep.promise.then(atIndex => {
            _this._jumpAt(atIndex, prevIdx);
            _this._idx  = atIndex + 1;
            _this._playStep(_this._idx);
        });
    }

    _getVisualizationSnapshot() {
        if (!this._captureVisualization) return undefined;
        let vis = this.viewer.bridge.visualization(),
            shadersCache = {};
        for (let key of vis.order) {
            if (vis.shaders.hasOwnProperty(key) && vis.shaders[key].rendering) {
                //maybe somehow change on active snapshot change... active node overrides cache setup here ... :O
                shadersCache[key] = $.extend(true, {}, vis.shaders[key].cache);
            }
        }
        return {
            index: this.viewer.bridge.currentVisualizationIndex(),
            cache: shadersCache,
            order: [...vis.order]
        }
    }

    _deprecated_IO_API() {
        let importedJson = this.POSTStore.get("snapshot-keyframes");
        if (importedJson) {
            try {
                this.importJSON(JSON.parse(importedJson));
            } catch (e) {
                console.warn(e);
                Dialogs.show("Failed to load keyframes: try to load them manually if you have (or extract from the exported file).", 20000, Dialogs.MSG_ERR);
            }
        }
    }

    _setDelayed(ms, index) {
        if (ms <= 0) {
            return {
                promise: new Promise(resolve => resolve(index)),
                cancel: function () {}
            };
        }

        let timeout;
        let p = new Promise(function(resolve, reject) {
            timeout = setTimeout(_ => resolve(index), ms);
        });

        return {
            promise: p,
            cancel: function() {
                clearTimeout(timeout);
            }
        };
    }

    _add(step, index=undefined) {
        if (typeof index === "number" && index >= 0 && index < this._steps.length) {
            this._steps.splice(index, 0, step);
        } else {
            index = this._steps.length;
            this._steps.push(step);
        }
        this.raiseEvent("create", {
            index: index,
            step: step
        });
    }

    _jumpAt(index, fromIndex=undefined) {
        let step = this._steps[index];
        if (!step || this._steps.length <= index) {
            return;
        }

        let capturesViewport = step.point && !isNaN(step.zoomLevel);
        if (step.visualization) this._setVisualization(step, capturesViewport ? step.duration : 0);
        if (capturesViewport) this._utils.focus(step);
        else if (this.viewer.bridge) this.viewer.bridge.redraw();

        this.raiseEvent("enter", {
            index: index,
            prevIndex: fromIndex,
            prevStep: isNaN(fromIndex) ? undefined : this._steps[fromIndex],
            step: step
        });
    }

    _setVisualization(step, duration) {
        let bridge = this.viewer.bridge,
            from = step.visualization,
            curIdx = bridge.currentVisualizationIndex(),
            curVis = bridge.visualization(from.index),
            needsRefresh = !this._equalOrder(curVis.order, from.order);

        for (let key in curVis.shaders) {
            let shaderSetup = curVis.shaders[key];
            //we stored only cache of visible elements
            let isVisible = shaderSetup.visible;
            let willBeVisible = from.cache.hasOwnProperty(key);
            if (willBeVisible !== isVisible) needsRefresh = true;
            shaderSetup.visible = willBeVisible;
            if (shaderSetup.visible) {
                let cachedCache = from.cache[key];
                if (!needsRefresh && !this._equalCache(shaderSetup.cache, cachedCache)) {
                    needsRefresh = true;
                }

                if (needsRefresh) shaderSetup.cache = $.extend(true, {}, cachedCache);
            }
        }

        if (curIdx !== from.index) {
            //refetch (todo update select)
            curVis.order = from.order;
            bridge.switchVisualization(from.index);
        } else if (needsRefresh) {
            bridge.webGLEngine.rebuildVisualization(from.order);
            bridge.redraw(duration * 900); //50% od the duration allowed to be constantly updated
        }
    }

    /**
     * https://raphacmartin.medium.com/deep-equality-in-javascript-objects-1eea8abb3649
     * @param a Object
     * @param b Object
     * @returns {boolean}
     */
    _equalCache(a, b) {
        if ((!a || !b) && a !== b) return false;

        if (Object.keys(a).length !== Object.keys(b).length) {
            return false
        }

        for (const key in a) {
            const a_value = a[key];
            const b_value = b[key];
            if ((a_value instanceof Object && !this._equalCache(a_value, b_value))
                || (!(a_value instanceof Object) && a_value !== b_value)) {
                return false
            }
        }
        return true
    }

    _equalOrder(arrA, arrB) {
        if (arrA.length !== arrB.length) return false;
        for (let i = 0; i < arrA.length; i++) {
            if (arrA[i] !== arrB[i]) return false;
        }
        return true;
    }
};
