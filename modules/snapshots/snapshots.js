OpenSeadragon.Snapshots = class extends OpenSeadragon.EventSource {

    static __self = undefined;

    constructor(viewer) {
        super();
        if (this.constructor.__self) {
            throw "Snaphots are not instantiable. Instead, use OpenSeadragon.Snapshots::instance().";
        }

        this.id = "snaphots";
        this.viewer = viewer;
        this.constructor.__self = this;

        this._idx = 0;
        this._steps = [];
        this._currentStep = null;
        this._init();
        this._utils = new OpenSeadragon.Tools(VIEWER); //todo maybe shared?

        this.captureVisualization = false;
    }

    /**
     * Singleton getter.
     * @return {OpenSeadragon.Snapshots}
     */
    static instance() {
        if (this.__self) {
            return this.__self;
        }
        return new OpenSeadragon.Snapshots(VIEWER);
    }

    create(delay=0, duration=0.5, transition=1.6) {
        if (this._playing) {
            return;
        }
        let view = this.viewer.viewport;
        this._add({
            zoomLevel: view.getZoom(),
            point: view.getCenter(),
            delay: delay,
            duration: duration,
            transition: transition,
            visualization: this._getVisualizationSnapshot()
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
            index: this.viewer.bridge.currentVisualisationIndex(),
            cache: shadersCache,
            order: [...vis.order],
            screenshot: this._utils.screenshot(true, {width: 120, height: 120})
        }
    }

    remove(index=undefined) {
        index = index ?? this._idx;

        let step = this._steps[index];
        this._steps.splice(index, 1);
        this._idx = this._idx % this._steps.length;
        this.raiseEvent("remove", {
            index: index,
            step: step
        });
    }

    set captureVisualization(value) {
        this._captureVisualization = value && this.viewer.hasOwnProperty("bridge");
    }

    exportJSON() {
        return JSON.stringify(this._steps);
    }

    importJSON(json) {
        this._idx = 0;
        this._steps = [];
        this._currentStep = null;
        for (let i = 0; i < json.length; i++) {
            if (!json[i]) continue;
            //recreate 'classes'
            json[i].point = new OpenSeadragon.Point(json[i].point.x, json[i].point.y);
            this._add(json[i]);
        }
    }

    _init() {
        UTILITIES.addPostExport("snapshot-keyframes", this.exportJSON.bind(this), this.id);
        let importedJson = APPLICATION_CONTEXT.postData["snapshot-keyframes"];
        if (importedJson) {
            try {
                this.importJSON(JSON.parse(importedJson));
            } catch (e) {
                console.warn(e);
                //todo message to plugin since plugin has export controls
                //or add option to download file - extracted keframes from post
                Dialogs.show("Failed to load keyframes: try to load them manually if you have (or extract from the exported file).", 20000, Dialogs.MSG_ERR);
            }
        }
    }

    _setDelayed(ms, index) {
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

    goToIndex(atIndex) {
        if (this._playing) {
            return;
        }
        this._idx = atIndex % this._steps.length;
        this._jumpAt(this._idx);
    }

    _add(step) {
        let index = this._steps.length;
        this._steps.push(step);
        this.raiseEvent("create", {
            index: index,
            step: step
        });
    }

    _jumpAt(index, direct=true) {
        let step = this._steps[index];
        if (!step || this._steps.length <= index) {
            return;
        }
        if (step.visualization) this._setVisualization(step);
        this._utils.focus(step);
        this.raiseEvent("enter", {
            index: index,
            immediate: direct,
            step: step
        });
    }

    _setVisualization(step) {
        let bridge = this.viewer.bridge,
            from = step.visualization,
            curIdx = bridge.currentVisualisationIndex(),
            curVis = bridge.visualization(from.index),
            needsRefresh = !this._equalOrder(curVis.order, from.order);

        for (let key in curVis.shaders) {
            let shaderSetup = curVis.shaders[key];
            //we stored only cache of visible elements
            shaderSetup.visible = from.cache.hasOwnProperty(key);
            if (shaderSetup.visible) {
                let cachedCache = from.cache[key];
                if (!needsRefresh && !this._equalCache(shaderSetup.cache, cachedCache)) {
                    needsRefresh = true;
                }
                shaderSetup.cache = cachedCache;
            }
        }

        if (curIdx !== from.index) {
            //refetch (todo update select)
            curVis.order = from.order;
            bridge.switchVisualisation(from.index);
        } else if (needsRefresh) {
            bridge.webGLEngine.rebuildVisualisation(from.order);
            bridge.invalidate(step.duration * 900); //50% od the duration allowed to be constantly updated
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

    get snapshotCount() {
        return this._steps.length;
    }

    get currentStep() {
        return this._steps[this._idx];
    }

    get currentStepIndex() {
        return this._idx;
    }

    get playing() {
        return this._playing;
    }

    play() {
        if (this._playing) return;
        if (this._idx >= this._steps.length) {
            this._idx = this._steps.length-1;
        }
        this.raiseEvent("play");
        this.playStep(this._idx);
        this._playing = true;
    }

    playFromIndex(index) {
        if (this._playing) {
            return;
        }
        this._idx = index;
        this.play();
    }

    playStep(index) {
        while (this._steps.length > index && !this._steps[index]) {
            index++;
        }

        if (this._steps.length <= index) {
            this._currentStep = null;
            this.stop();
            return;
        }

        let prevIdx = index > 0 ? index-1 : 0;
        while (prevIdx > 0 && !this._steps[prevIdx]) prevIdx--;
        let previousDuration = prevIdx >= 0 && this._steps[prevIdx] ? this._steps[prevIdx].duration * 1000 : 0;
        this._currentStep = this._setDelayed(this._steps[index].delay * 1000 + previousDuration, index);

        this.raiseEvent("before-enter", {
            index: index,
            step: this._currentStep
        });

        const _this = this;
        this._currentStep.promise.then(atIndex => {
            _this._jumpAt(atIndex);
            _this._idx  = atIndex + 1;
            _this.playStep(_this._idx);
        });
    }

    stop() {
        if (!this._playing) return;

        if (this._currentStep) {
            this._currentStep.cancel();
            this._currentStep = null;
        }

        this._playing = false;
        this.raiseEvent("stop");
    }
};
