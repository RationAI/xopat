addPlugin("recorder", class extends XOpatPlugin {
    constructor(id) {
        super(id);
        this._toolsMenuId = "presenter-tools-menu";

        //todo document option, get via getOption instead
        this.playOnEnter = this.getOption('playEnterDelay', -1);
        this._delay = true;
        this._annotationRefs = {}; //consider WeakMap
        this._captureParams = {
            delay: 2,
            duration: 1.4,
            transition: 6.5
        };
    }

    // ===== BaseComponent helpers (VanJS-powered) =====
    // Right side header (Hide / Import / Export)
    _RightHeaderComponent() {
        const _this = this;
        class RightHeader extends UI.BaseComponent {
            create() {
                const {span, input} = van.tags;
                const fileInput = input({
                    type: "file",
                    class: "hidden w-0 h-0",
                    onchange: e => { _this.importFromFile(e); e.target.value = ""; }
                });

                const hideBtn = span(
                    {class: "float-right btn-pointer", onclick: () => {
                            if (!confirm("You cannot show the recorder again - only by re-loading the page. Continue?")) return;
                            const node = document.getElementById("auto-recorder");
                            if (node) node.style.display = "none";
                        }},
                    "Hide ", span({class: "material-icons"}, "hide_source")
                );

                const importBtn = span(
                    {class: "float-right", title: "Import Recording", onclick: () => fileInput.click()},
                    span({class: "material-icons btn-pointer"}, "file_upload")
                );

                const exportBtn = span(
                    {class: "float-right", title: "Export Recording", onclick: () => _this.export()},
                    span({class: "material-icons btn-pointer"}, "file_download")
                );

                return span(hideBtn, importBtn, fileInput, exportBtn);
            }
        }
        return new RightHeader();
    }

    // Right side controls (record / play / stop / etc)
    _RightControlsComponent() {
        const _this = this;

        class RightControls extends UI.BaseComponent {
            create() {
                const {button, span, div} = van.tags;
                const mk = (id, title, icon, onclick, extra="") =>
                    button(
                        { id, onclick, class: `btn btn-ghost btn-square btn-sm ${extra}`, title },
                        span({class:"material-icons"}, icon)
                    );

                return div(
                    {class:"flex gap-2"},
                    span(
                        {class:"material-icons timeline-play-small btn-pointer", onclick: () => _this.addRecord()},
                        "radio_button_checked"
                    ),
                    mk("presenter-play-icon",  "Play", "play_arrow",  () => _this.snapshots.play(), "text-success"),
                    mk("presenter-stop-icon",  "Stop", "stop",   () => _this.snapshots.stop()),
                    mk("presenter-replay-icon", "Replay","replay", () => _this.fourthButton()),
                    mk("presenter-delete-icon", "Delete","delete",  () => _this.fifthButton(), "text-warning")
                );
            }
        }
        return new RightControls();
    }

    // Right side body (checkboxes + annotation actions)
    _RightBodyComponent() {
        const _this = this;
        class RightBody extends UI.BaseComponent {
            create() {
                const {div, h5, span} = van.tags;

                const chkVisuals = new UI.Checkbox({
                    label: "Capture visuals",
                    checked: !!_this.snapshots.capturesVisualization,
                    onChange(checked) {
                        _this.snapshots.capturesVisualization = !!checked && checked !== "false";
                    },
                    class: "checkbox-primary"
                });

                const chkViewport = new UI.Checkbox({
                    label: "Capture viewport",
                    checked: !!_this.snapshots.capturesViewport,
                    onChange(checked) {
                        _this.snapshots.capturesViewport = !!checked && checked !== "false";
                    },
                    class: "checkbox-primary"
                });

                // Buttons here remain native (see note); styled with DaisyUI.
                const captureBtn = van.tags.button(
                    {class:"btn btn-sm btn-outline", id:"snapshot-capture-annotation", onclick: () => _this.captureAnnotation()},
                    "Capture"
                );
                const releaseBtn = van.tags.button(
                    {class:"btn btn-sm btn-outline", id:"snapshot-capture-annotation", onclick: () => _this.releaseAnnotation()},
                    "Release"
                );

                return div(
                    {class:"mt-2"},
                    // checkboxes row
                    div({class:"flex items-center gap-6"},
                        chkVisuals.create(),
                        chkViewport.create()
                    ),
                    // annotations controls
                    div({class:"mt-4 flex items-center gap-3"},
                        h5({class:"inline-block font-semibold"}, "Annotations in keyframes"),
                        span({class:"opacity-50"}, "•"),
                        captureBtn,
                        releaseBtn
                    )
                );
            }
        }
        return new RightBody();
    }

    // Tools timeline panel (inputs + timeline track)
    _TimelineComponent() {
        const _this = this;
        class TimelinePanel extends UI.BaseComponent {
            create() {
                const {div} = van.tags;

                const controls = div(
                    {class:"inline-block timeline-path flex flex-row"},
                    _this._RightControlsComponent().create(),
                    div(
                        {class: "flex flex-row mr-4 ml-3"},
                        new UI.Input({
                            legend: "Delay",
                            suffix: "s",
                            onChange: e => _this.setValue('delay', parseFloat(e.target.value)),
                            id: "point-delay",
                            size: UI.Input.SIZE.SMALL,
                            extraProperties: {
                                type:"number", min:"0", value:_this._captureParams["delay"].toString(), step:"0.1", title:"Frame Delay",style: "width: 3rem;"
                            },
                            extraClasses: "mr-1",
                        }).create(),
                        new UI.Input({
                            legend: "Duration",
                            suffix: "s",
                            onChange: e => _this.setValue('duration', parseFloat(e.target.value)),
                            id: "point-duration",
                            size: UI.Input.SIZE.SMALL,
                            extraProperties: {
                                type:"number", min:"0", value:_this._captureParams["duration"].toString(), step:"0.1", title:"Animation Duration",style: "width: 3rem; margin-right: 0.5rem;"
                            }
                        }).create(),
                        // Transition
                        new UI.Input({
                            legend: "Linear / Ease",
                            onChange: e => _this.setValue('transition', parseFloat(e.target.value)),
                            id: "point-spring",
                            size: UI.Input.SIZE.SMALL,
                            extraProperties: {
                                type:"range", min:"1", value:_this._captureParams["transition"].toString(), step:"0.2", max:"10", style: "width: 3rem;"
                            }
                        }).create()
                    ),
                );

                _this.track = div({
                    id: "presenter-timeline-track",
                    class:"inline-block align-top relative flex-1 flex items-start px-3 bg-base-200 rounded-sm w-full overflow-y-scroll",
                    style:"white-space:nowrap; overflow-x:auto; overflow-y:hidden; height:48px; min-width:100px; max-height: 96px;"
                });

                return div({class:"flex items-start flex-column"}, _this.track, controls);
            }
        }
        return new TimelinePanel();
    }

    get snapshots() {
        return OpenSeadragon.Snapshots.viewerInstance(VIEWER);
    }

    // ===== Lifecycle =====
    pluginReady() {
        // Right menu (pass BaseComponent instances)
        USER_INTERFACE.RightSideMenu.appendExtended(
            "Recorder",
            this._RightHeaderComponent(),
            this._RightBodyComponent(),
            undefined,
            "auto-recorder",
            this.id
        );

        // Tools menu (pass BaseComponent instance)
        USER_INTERFACE.Tools.setMenu(
            this.id,
            this._toolsMenuId,
            "Timeline",
            this._TimelineComponent(),
            "play_circle",
            true
        );

        // Enable sortable timeline (vanilla HTML5 DnD)
        this._initSortableTimeline();
        this._handleInitIO();
        this._initEvents();

        if (Number.isInteger(this.playOnEnter) && this.playOnEnter >= 0) {
            const _this = this;
            setTimeout(function() {
                _this.snapshots.playFromIndex(0);
            }, this.playOnEnter);
        }
    }

    // ===== DnD reordering for timeline =====
    _initSortableTimeline() {
        const timeline = this.track;
        let dragSrcId = null;
        timeline.addEventListener("dragstart", (e) => {
            const el = e.target.closest("[data-id]");
            if (!el) return;
            if (this.isPlaying) { e.preventDefault(); return; }
            dragSrcId = el.dataset.id;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", dragSrcId);
            el.classList.add("dragging");
        });

        timeline.addEventListener("dragend", (e) => {
            const el = e.target.closest("[data-id]");
            if (el) el.classList.remove("dragging");
            dragSrcId = null;
        });

        timeline.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const after = this._getDragAfterElement(timeline, e.clientX);
            const dragging = timeline.querySelector(".dragging");
            if (!dragging) return;
            if (after == null) {
                timeline.appendChild(dragging);
            } else {
                timeline.insertBefore(dragging, after);
            }
        });

        timeline.addEventListener("drop", (e) => {
            e.preventDefault();
            const newOrder = Array.from(timeline.children).map((n) => n.dataset.id);
            this.snapshots.sortWithIdList(newOrder);
            const el = timeline.querySelector(`[data-id="${dragSrcId}"]`);
            if (el) this.selectPoint(el);
        });
    }

    _getDragAfterElement(container, x) {
        const els = [...container.querySelectorAll("[data-id]:not(.dragging)")];
        return els.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = x - box.left - box.width / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element || null;
    }

    // ===== Original logic unchanged below =====

    captureAnnotation() {
        const engine = this.annotations;
        if (!engine) {
            Dialogs.show('Annotations are not available. You can <a onclick="UTILITIES.loadPlugin(\'gui_annotations\')">import the annotations plugin.</a> to create some.', 3000, Dialogs.MSG_WARN);
        } else {
            const annotation = engine.canvas.getActiveObject();
            if (annotation) {
                let sid = this.snapshots.currentStep.id;
                this._recordAnnotationRef(annotation, sid);
                this._recordAnnotationSid(annotation, sid);
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
            this._captureParams["delay"],
            this._captureParams["duration"],
            this._captureParams["transition"],
            this.snapshots.currentStepIndex+1
        );
    }

    selectPoint(node) {
        let index = Array.prototype.indexOf.call(node.parentNode.children, node);
        this.snapshots.goToIndex(index);
        this._highlight(this.snapshots.currentStep, index);
    }

    setValue(key, value) {
        this._captureParams[key] = value;

        if (this.snapshots.snapshotCount < 1) return;

        let index = this.snapshots.currentStepIndex;

        let node = this.track.children[index];
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
        let child = this.track.children[index];
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
            this._oldHighlight.classList.remove("border-red-700");
        }
        this._oldHighlight = this.track.children[index];
        this._oldHighlight.classList.add("border-red-700");
        $("#point-delay").val(step.delay);
        $("#point-duration").val(step.duration);
        $("#point-spring").val(step.transition);
    }

    _addUIStepFrom(viewerId, step, withNav=true, atIndex=undefined) {
        let color = "#000";
        if (this.snapshots.stepCapturesVisualization(step)) {
            color = this.snapshots.stepCapturesViewport(step) ? "#ffd500" : "#9dff00";
        } else if (this.snapshots.stepCapturesViewport(step)) {
            color = "#00d0ff";
        }

        const height = Math.max(7, Math.log(step.zoomLevel ?? 1) /
                Math.log(VIEWER.viewport.getMaxZoom() + 1) * 18 + 14),
            parent = $(this.track),
            html = `<span id="step-timeline-${step.id}" data-id="${step.id}" data-group="${viewerId}"
style="background: ${color}; border-color: ${color};
border-bottom-left-radius: ${this._convertValue('transition', step.transition)};
width: ${this._convertValue('duration', step.duration)}; height: ${height}px; 
margin-left: ${this._convertValue('delay', step.delay)}; margin-top: ${48 * VIEWER_MANAGER.getViewerIndex(viewerId)}px"
draggable="true"></span>`;

        if (parent.childElementCount > atIndex) {
            parent.children().eq(atIndex).before(html);
        } else {
            parent.append(html);
        }
        if (withNav) this.snapshots.goToIndex(atIndex);
        // no external draggable helper; HTML5 DnD handlers are bound on the container
        document.getElementById(`step-timeline-${step.id}`)
            ?.addEventListener("click", e => this.selectPoint(e.currentTarget));
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
            this.snapshots._steps.forEach(s => _this._addUIStepFrom(s.viewerId, s, false));
            this._highlight(step, this.snapshots.currentStepIndex);
        }
    }

    _timelineId(viewerId=undefined, hash=true) {
        if (hash) return `#${viewerId || VIEWER.id}-playback-timeline`;
        return `${viewerId || VIEWER.id}-playback-timeline`;
    }

    _arrRemove(array, item) {
        if (!array) return;
        const index = array.indexOf(item);
        if (index > -1) array.splice(index, 1);
    };

    _handleInitAnnotationsModule() {
        try {
            if (window.OSDAnnotations && !this.annotations) {
                this.annotations = OSDAnnotations.instance();
                this.annotations.forceExportsProp = "presenterSids";
                this.annotations?.initPostIO();
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
        } catch (e) {
            console.error(e);
        }
    }

    async _importAnnotations(content) {
        try {
            const _this = this;
            let data = typeof content === "string" ? JSON.parse(content) : content;
            for (let sid in data) {
                let step = data[sid];
                if (step[0]?.presenterSids) break;

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
            _this.track.insertAdjacentHTML('beforeend', '<span id="playback-timeline-measure" data-offset="0"></span>');
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

                _this._delay = false;
                _this._duration = e.step.duration + 2.5;
                _this._referenceStamp = Date.now();
                _this._absoluteOffset = _this.track.children[e.index].getBoundingClientRect().left
                    - _this.track.getBoundingClientRect().left - 7;
            }
        });

        this.snapshots.addHandler('create', e => {
            USER_INTERFACE.Tools.notify(_this._toolsMenuId);
            _this._addUIStepFrom(e.viewerId, e.step, true, e.index);
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

        VIEWER_MANAGER.addHandler('viewer-create', e => {
           this.track.style.height = `${48*VIEWER_MANAGER.viewers.length}px`;
        });

        // todo use integrate with singletons module instead
        VIEWER_MANAGER.addHandler('module-loaded', e => {
            if (e.id === "annotations") {
                _this._handleInitAnnotationsModule();
            }
        });

        VIEWER.addHandler('key-down', (e) => {
            if (!e.focusCanvas) return;
            if (e.code === "KeyN") {
                _this.snapshots.goToIndex(_this.snapshots.currentStepIndex + 1);
            } else if (e.code === "KeyS") {
                _this.snapshots.goToIndex(0);
            }
        });
    }
});
