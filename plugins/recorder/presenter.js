class Presenter extends XOpatPlugin {
    constructor(id) {
        super(id);
        this._toolsMenuId = "presenter-tools-menu";

        //todo document option, get via getOption instead
        this.playOnEnter = this.getOption('playEnterDelay', -1);
        this._delay = true;
        this._annotationRefs = {}; //consider WeakMap
    }

    pluginReady() {
        this.snapshots = OpenSeadragon.Snapshots.instance(VIEWER);

        USER_INTERFACE.MainMenu.appendExtended("Recorder", `<span style='float:right;' class="btn-pointer" onclick="if (!confirm('You cannot show the recorder again - only by re-loading the page. Continue?')) return; $('#auto-recorder').css('display', 'none');">Hide <span class="material-icons">hide_source</span></span>
<span onclick="this.nextElementSibling.click();" title="Import Recording" style="float: right;"><span class="material-icons btn-pointer">file_upload</span></span>
<input type='file' style="visibility:hidden; width: 0; height: 0;" onchange="${this.THIS}.importFromFile(event);$(this).val('');" />
<span onclick="${this.THIS}.export();" title="Export Recording" style="float: right;"><span class="material-icons btn-pointer">file_download</span></span>`, `
<button class='btn btn-pointer' id='presenter-record-icon' onclick="${this.THIS}.addRecord();"><span class="material-icons timeline-play">radio_button_checked</span></button>
<button class='btn btn-pointer' id='presenter-play-icon' onclick="${this.THIS}.snapshots.play();"><span class="material-icons">play_arrow</span></button>
<button class='btn btn-pointer' id='presenter-stop-icon' onclick="${this.THIS}.snapshots.stop();"><span class="material-icons">stop</span></button>
<button class='btn btn-pointer' id='presenter-replay-icon' onclick="${this.THIS}.fourthButton();"><span class="material-icons">replay</span></button>
<button class='btn btn-pointer' id='presenter-delete-icon' onclick="${this.THIS}.fifthButton();"><span class="material-icons">delete</span></button>`, `
<br>
${UIComponents.Elements.checkBox({
            label: "Capture visuals",
            onchange: this.THIS + ".snapshots.capturesVisualization = this.checked && this.checked !== 'false';",
            default: this.snapshots.capturesVisualization
        })}&emsp;
${UIComponents.Elements.checkBox({
            label: "Capture viewport",
            onchange: this.THIS + ".snapshots.capturesViewport = this.checked && this.checked !== 'false';",
            default: this.snapshots.capturesViewport
        })}
<br><br>
<h5 class="d-inline-block">Annotations in keyframes</h5>&emsp;
<button class="btn btn-sm" id="snapshot-capture-annotation" onclick="${this.THIS}.captureAnnotation()">Capture</button>
<button class="btn btn-sm" id="snapshot-capture-annotation" onclick="${this.THIS}.releaseAnnotation()">Release</button>
`, "auto-recorder", this.id);

        USER_INTERFACE.Tools.setMenu(this.id, this._toolsMenuId, "Timeline",
            `<div class="d-flex">
<span class="material-icons timeline-play-small btn-pointer" onclick="${this.THIS}.addRecord();">radio_button_checked</span>
<div class='d-inline-block timeline-path'>
<div class="d-inline-block"><span style="font-size: xx-small">Delay</span><br>
<input class='form-control input-sm' id="point-delay" type='number' min='0' value='2' step="0.1" title='Delay' onchange="${this.THIS}.setValue('delay', parseFloat($(this).val()));"> s</div><div class='timeline-point' style='cursor:pointer' '>
</div><div class="d-inline-block"><span style="font-size: xx-small">Duration</span><br>
<input class='form-control input-sm' id="point-duration" type='number' min='0' value='1.4' step='0.1' title='Animation Duration' onchange="${this.THIS}.setValue('duration', parseFloat($(this).val()));"> s<br>
</div>&emsp;<div class="d-inline-block"><span style="font-size: xx-small">Linear / Ease</span><br>
<input class='form-control input-sm' id="point-spring" type='range' min='1' value='6.5' step='0.2' max="10" style="width: 40px;" title='Fade in out' onchange="${this.THIS}.setValue('transition', parseFloat($(this).val()));"> 
</div></div>
<div id='playback-timeline' style="white-space: nowrap; overflow-x: auto; overflow-y: hidden; height: 48px" class="d-inline-block v-align-top position-relative flex-1 ml-3"></div>


</div>`, 'play_circle_outline');

        const _this = this;
        this.setDraggable = UIComponents.Actions.draggable("playback-timeline",
            undefined,
            e => !_this.isPlaying,
            e => {
                const listItems = e.target.parentNode.children;
                _this.snapshots.sortWithIdList(Array.prototype.map.call(listItems, child => child.dataset.id));
                _this.selectPoint(e.target);
            }
        );

        this._handleInitIO();
        this._initEvents();

        if (Number.isInteger(this.playOnEnter) && this.playOnEnter >= 0) {
            const _this = this;
            setTimeout(function() {
                _this.snapshots.playFromIndex(0);
            }, this.playOnEnter);
        }
    }

    captureAnnotation() {
        const engine = this.annotations;
        if (!engine) {
            Dialogs.show('Annotations are not available. You can <a onclick="UTILITIES.loadPlugin(\'gui_annotations\')">import the annotations plugin.</a> to create some.', 3000, Dialogs.MSG_WARN);
        } else {
            const annotation = engine.canvas.getActiveObject();
            if (annotation) {
                let sid = this.snapshots.currentStep.id;
                //todo listener remove prevent removal of binded annotations? or remove them...

                this._recordAnnotationRef(annotation, sid); //note which annotations
                this._recordAnnotationSid(annotation, sid); //keep record on annotations too
                Dialogs.show('Animated with step ' + sid, 1000, Dialogs.MSG_INFO);
            } else {
                Dialogs.show('Select an annotation to animate.', 3000, Dialogs.MSG_WARN);
            }
        }
    }

    releaseAnnotation() {
        const engine = this.annotations;
        if (!engine) {
            Dialogs.show('Annotations are not available. You can <a onclick="UTILITIES.loadPlugin(\'gui_annotations\')">import the annotations plugin.</a> to create some.', 3000, Dialogs.MSG_WARN);
        } else {
            const annotation = engine.canvas.getActiveObject();
            if (annotation) {
                let sid = this.snapshots.currentStep.id;

                if (this._removeAnnotationRef(annotation, sid)) {
                    this._arrRemove(annotation.presenterSids, sid);
                    Dialogs.show('Removed from step ' + sid, 1000, Dialogs.MSG_INFO);
                } else {
                    Dialogs.show('This annotation is not animated with any key frame.', 1000, Dialogs.MSG_INFO);
                }
            } else {
                Dialogs.show('You have to select an annotation for keyframe removal.', 3000, Dialogs.MSG_WARN);
            }
        }
    }

    addRecord() {
        this.snapshots.create(
            parseFloat($("#point-delay").val()),
            parseFloat($("#point-duration").val()),
            parseFloat($("#point-spring").val()),
            this.snapshots.currentStepIndex+1
        );
    }

    selectPoint(node) {
        let index = Array.prototype.indexOf.call(node.parentNode.children, node);
        this.snapshots.goToIndex(index);
    }

    setValue(key, value) {
        if (this.snapshots.snapshotCount < 1) return;

        let index = this.snapshots.currentStepIndex;

        let node = $("#playback-timeline").children()[index];
        if (node) {
            this.snapshots.currentStep[key] = value;
            node.style[this._getStyleFor(key)] = this._convertValue(key, value);
        }
    }

    fourthButton() {
        if (this.isPlaying) {
            this.snapshots.previous();
        } else {
            this.snapshots.playFromIndex(0);
        }
    }

    fifthButton() {
        if (this.isPlaying) {
            this.snapshots.next();
        } else {
            this.removeHighlightedRecord();
        }
    }

    removeHighlightedRecord() {
        let index = this.snapshots.currentStepIndex;
        let child = $("#playback-timeline").children()[index];
        if (child) {
            this.snapshots.remove(index);
            $(child).remove();
        }
    }

    /****** IO FOR MANUAL USE *****/

    exportAnnotations(serialize=true) {
        const module = this.annotations;
        if (!module) return serialize ? "{}" : {};

        let result = {};
        for (let sid in this._annotationRefs) {
            let data = this._annotationRefs[sid].map(o => o.toObject('presenterSids'));
            //todo does not work with groups --> exported prop names differ!!!
            result[sid] = module.trimExportJSON(data, 'presenterSids');
        }
        return serialize ? JSON.stringify(result) : result;
    }

    importAnnotations(content) {
        if (!content || !Object.keys(content)?.length) return false;

        if (!this.annotations) {
            const _this = this;
            UTILITIES.loadModules(() => {
                _this._handleInitAnnotationsModule();
                _this._importAnnotations(content);
            }, 'annotations');
            return true;
        }
        this._importAnnotations(content);
        return true;
    }

    export() {
        UTILITIES.downloadAsFile("visualization-recording.json", JSON.stringify({
            "snapshots": this.snapshots.exportJSON(false),
            "annotations": this.exportAnnotations(false)
        }));
    }

    importFromFile(e) {
        const _this = this;
        UTILITIES.readFileUploadEvent(e).then(data => {
            data = JSON.parse(data);
            _this.snapshots.importJSON(data?.snapshots || []);
            if (!_this.importAnnotations(data?.annotations)) {
                //will not handle message - no data loaded
                Dialogs.show("Loaded.", 1500, Dialogs.MSG_INFO);
            }
        }).catch(e => {
            console.log(e);
            Dialogs.show("Failed to load the file.", 2500, Dialogs.MSG_ERR);
        });
    }

    /****** PRIVATE *****/

    _highlight(step, index) {
        if (this._oldHighlight) {
            this._oldHighlight.removeClass("selected");
        }
        this._oldHighlight = $($("#playback-timeline").children()[index]); //todo just keep no-jquery node?
        this._oldHighlight.addClass("selected");
        $("#point-delay").val(step.delay);
        $("#point-duration").val(step.duration);
        $("#point-spring").val(step.transition);
    }

    _addUIStepFrom(step, withNav=true, atIndex=undefined) {
        let color = "#000";
        if (this.snapshots.stepCapturesVisualization(step)) {
            color = this.snapshots.stepCapturesViewport(step) ? "#ffd500" : "#9dff00";
        } else if (this.snapshots.stepCapturesViewport(step)) {
            color = "#00d0ff";
        }

        const height = Math.max(7, Math.log(step.zoomLevel ?? 1) /
                Math.log(VIEWER.viewport.getMaxZoom()) * 18 + 14),
            parent = $("#playback-timeline"),
            html = `<span id="step-timeline-${step.id}" data-id="${step.id}"
onclick="${this.THIS}.selectPoint(this);" style="background: ${color}; border-color: ${color};
border-bottom-left-radius: ${this._convertValue('transition', step.transition)};
width: ${this._convertValue('duration', step.duration)}; height: ${height}px; 
margin-left: ${this._convertValue('delay', step.delay)};"></span>`;

        if (parent[0].childElementCount > atIndex) {
            parent.children().eq(atIndex).before(html);
        } else {
            //appends as last
            parent.append(html);
        }
        if (withNav) this.snapshots.goToIndex(atIndex);
        this.setDraggable(document.getElementById(`step-timeline-${step.id}`));
    }

    _convertValue(key, value) {
        return `${this._getValueFor(key, value)}px`;
    }

    _getValueFor(key, value) {
        switch (key) {
            case 'delay': return value * 2;
            case 'duration': return value * 4 + 6;
            case 'transition':
            default: return value;
        }
    }

    _getStyleFor(key) {
        switch (key) {
            case 'delay': return "margin-left";
            case 'duration': return "width";
            case 'transition': return "border-bottom-left-radius";
            default: return value;
        }
    }

    _recordAnnotationSid(annotation, sid) {
        let sids = annotation.presenterSids || [];
        if (!sids.includes(sid)) {
            sids.push(sid);
            annotation.set({ presenterSids: sids });
        }
    }

    _recordAnnotationRef(annotation, sid) {
        if (!annotation) return;
        let refs = this._annotationRefs[sid] || [];
        refs.push(annotation);
        this._annotationRefs[sid] = refs;
    }

    _removeAnnotationRef(annotation, sid=undefined) {
        if (annotation?.presenterSids) {
            for (let id of (sid ? [sid] : annotation.presenterSids)) {
                this._arrRemove(this._annotationRefs[id], annotation);
            }
            return true;
        }
        return false;
    }

    _bindAnnotations() {
        const update = this._recordAnnotationRef.bind(this);
        this.annotations.canvas.forEachObject(o => (o.presenterSids || []).forEach(sid => update(o, sid)));
    }

    _handleInitIO() {
        this._handleInitAnnotationsModule();
        let step = this.snapshots.currentStep;
        if (step) {
            const _this = this;
            this.snapshots._steps.forEach(s => _this._addUIStepFrom(s, false));
            this._highlight(step, this.snapshots.currentStepIndex);
        }
    }

    _arrRemove(array, item) {
        if (!array) return;
        const index = array.indexOf(item);
        if (index > -1) array.splice(index, 1);
    };

    _handleInitAnnotationsModule() {
        //todo had to enable the module from the beginning since we dont know if annnotations are present :/
        //todo remove all if module logics
        if (window.OSDAnnotations && !this.annotations) {
            this.annotations = OSDAnnotations.instance();
            this.annotations.forceExportsProp = "presenterSids";
            this.annotations?.initPostIO(); //enable IO export so we can work with annotations if any
            this._bindAnnotations();

            const _this = this;

            const addSidRecord = (o) => {
                if (o.presenterSids) {
                    o.presenterSids.forEach(sid => _this._recordAnnotationRef(o, sid));
                }
            }

            this.annotations.addHandler('annotation-create', e => addSidRecord(e.object));
            this.annotations.addHandler('annotation-delete', e => _this._removeAnnotationRef(e.object));
            this.annotations.addHandler('annotation-replace', e => {
                _this._removeAnnotationRef(e.previous);
                e.next.presenterSids = e.previous.presenterSids;
                addSidRecord(e.next);
            });
        }
    }

    async _importAnnotations(content) {
        try {
            const _this = this;
            //todo imports annotations twice if exported together with the annotations plugin -> made invisible, still show in the list, they get exported in the module etc...
            let data = typeof content === "string" ? JSON.parse(content) : content;
            for (let sid in data) {
                let step = data[sid];
                if (step[0]?.presenterSids) break; //no need for manual re-attaching, already present in the data

                //note what if annotations were already there? probably not an issue - the user initiated the load himself
                step.forEach(o => {
                    let sids = o.presenterSids || [];
                    if (!sids.includes(sid)) {
                        sids.push(sid);
                    }
                    o.presenterSids = sids;
                });
            }
            this.annotations.loadObjects({objects: Object.values(data).flat(1)})
                .then(() => _this._bindAnnotations());
            Dialogs.show("Loaded.", 1500, Dialogs.MSG_INFO);
        } catch(e) {
            Dialogs.show("Load finished. Failed to setup annotations: these will be unavailable.", 3000, Dialogs.MSG_WARN);
        }
    }

    _initEvents() {
        const _this = this;
        this.snapshots.addHandler('play', function () {
            if (_this._loopMeasure) {
                clearInterval(_this._loopMeasure);
                delete _this._loopMeasure;
                delete _this._measureNode;
            }

            $("#presenter-play-icon span").addClass("timeline-play");
            $("#presenter-replay-icon span").text("fast_rewind");
            $("#presenter-delete-icon span").text("fast_forward");
            USER_INTERFACE.Tools.notify(_this._toolsMenuId, '➤');

            _this._referenceStamp = Date.now();
            _this._absoluteOffset = 0;
            _this._realtimeOffset = 0;
            $("#playback-timeline").append('<span id="playback-timeline-measure" data-offset="0"></span>');
            _this._measureNode = document.getElementById('playback-timeline-measure');

            const engine = _this.annotations;
            if (engine) engine.enableAnnotations(false);
            _this.isPlaying = true;
        });

        this.snapshots.addHandler('stop', function () {
            _this.isPlaying = false;
            $("#presenter-play-icon span").removeClass("timeline-play");
            $("#presenter-replay-icon span").text("replay");
            $("#presenter-delete-icon span").text("delete");
            if (_this._loopMeasure) {
                clearInterval(_this._loopMeasure);
                delete _this._loopMeasure;
                delete _this._measureNode;
            }
            $("#playback-timeline-measure").remove();

            const engine = _this.annotations;
            if (engine) engine.enableAnnotations(true);
        });

        this.snapshots.addHandler('enter', function (e) {
            _this._highlight(e.step, e.index);

            if (_this._measureNode) {
                if (!_this._loopMeasure) {
                    const measure = $("#playback-timeline-measure");
                    _this._loopMeasure = setInterval(function() {
                        const d = (Date.now() - _this._referenceStamp) / 1000;
                        const animationEnds = !_this._delay && _this._duration < d;
                        _this._realtimeOffset = _this._absoluteOffset + _this._getValueFor(_this._delay ? 'delay' : 'duration', d);
                        _this._measureNode.style.left = `${_this._realtimeOffset}px`;

                        if (animationEnds) {
                            _this._delay = true;
                            _this._referenceStamp = Date.now();
                            _this._absoluteOffset = _this._realtimeOffset;
                        }
                    }, 200);
                }

                //todo forced updates not working
                let updates = false;
                if (e.prevStep) {
                    let annotations = _this._annotationRefs[e.prevStep.id];
                    if (annotations) {
                        annotations.forEach(a => {
                            a.visible = false;
                            a.dirty = true;
                        });
                        updates = true;
                    }
                }

                let annotations = _this._annotationRefs[e.step.id];
                if (annotations) {
                    annotations.forEach(a => {
                        a.visible = true;
                        a.dirty = true;
                    });
                    updates = true;
                }
                if (updates) _this.annotations.canvas.renderAll();

                let container = $("#playback-timeline");
                _this._delay = false;
                _this._duration = e.step.duration + 2.5;
                _this._referenceStamp = Date.now();
                _this._absoluteOffset = container.children().eq(e.index)[0].getBoundingClientRect().left
                    - container[0].getBoundingClientRect().left - 7;
            }
        });

        this.snapshots.addHandler('create', e => {
            USER_INTERFACE.Tools.notify(_this._toolsMenuId);
            _this._addUIStepFrom(e.step, true, e.index);
        });

        this.snapshots.addHandler('remove', e => {
            const sid = e.step.id,
                refs = _this._annotationRefs[sid];
            if (refs) {
                refs.forEach(o => {
                    if (o.presenterSids) {
                        let index = o.presenterSids.indexOf(sid);
                        if (index !== -1) o.presenterSids.splice(index, 1);
                    }
                })
            }
        });

        VIEWER.addHandler('module-loaded', e => {
            if (e.id === "annotations") {
                _this._handleInitAnnotationsModule();
            }
        });

        VIEWER.addHandler('key-down', (e) => {
            if (!e.focusCanvas) return;
            //if (e.ctrlKey) {
            if (e.code === "KeyN") {
                _this.snapshots.goToIndex(_this.snapshots.currentStepIndex + 1);
            } else if (e.code === "KeyS") {
                _this.snapshots.goToIndex(0);
            }
            //}
        });
    }
}

addPlugin("recorder", Presenter);
