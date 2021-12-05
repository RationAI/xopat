class Presenter {
    static identifier = "automatic_presentation";

    constructor() {
        this.id = Presenter.identifier;
        this._idx = 0;
        this._maxIdx = 0;
        this._steps = [];
        this._currentStep = null;

        //controlPanelId is incomming parameter, defines where to add HTML
        PLUGINS.appendToMainMenuExtended("Recorder", `<span style='cursor:pointer;float:right;' onclick="if (!confirm('You cannot show the recorder again - only by re-loading the page. Continue?')) return; $('#auto-recorder').css('display', 'none');">Hide <span class="material-icons">hide_source</span></span>
    <span class="material-icons" onclick="$('#presenter-help').css('display', 'block');" title="Help" style="cursor: pointer;float: right;">help</span>
    <span onclick="this.nextSibling.click();" title="Import Recording" style="cursor: pointer; float: right;"><span class="material-icons">file_upload</span></span><input type='file' style="visibility:hidden; width: 0; height: 0;" onchange="automatic_presentation.import(event);" />
    <span onclick="automatic_presentation.export();" title="Export Recording" style="cursor: pointer;float: right;"><span class="material-icons">file_download</span></span><a style="display:none;" id="export-recording"></a>`, `
<button class='btn' onclick="automatic_presentation.addRecord();"><span class="material-icons timeline-play">radio_button_checked</span></button>
<button class='btn' onclick="automatic_presentation.play();"><span id='presenter-play-icon' class="material-icons">play_arrow</span></button>
<button class='btn' onclick="automatic_presentation.stop();"><span id='presenter-play-icon' class="material-icons">stop</span></button>
<button class='btn' onclick="automatic_presentation.playFromIndex(0);"><span class="material-icons">replay</span></button>
<button class='btn' onclick="automatic_presentation.removeHighlightedRecord();"><span class="material-icons">delete</span></button><br>

<br><br>`, `<div class='' id='playback-timeline'></div>`, "auto-recorder", this.id);

        $("body").append(`
    <div id="presenter-help" class="position-fixed" style="z-index:99999; display:none; left: 50%;top: 50%;transform: translate(-50%,-50%);">
    <details-dialog class="Box Box--overlay d-flex flex-column anim-fade-in fast" style=" max-width:700px; max-height: 600px;">
        <div class="Box-header">
        <button class="Box-btn-octicon btn-octicon float-right" type="button" aria-label="Close help" onclick="$('#presenter-help').css('display', 'none');">
            <svg class="octicon octicon-x" viewBox="0 0 12 16" version="1.1" width="12" height="16" aria-hidden="true"><path fill-rule="evenodd" d="M7.48 8l3.75 3.75-1.48 1.48L6 9.48l-3.75 3.75-1.48-1.48L4.52 8 .77 4.25l1.48-1.48L6 6.52l3.75-3.75 1.48 1.48L7.48 8z"></path></svg>
        </button>
        <h3 class="Box-title">Recorder help</h3>
        </div>
        <div class="overflow-auto">
        <div class="Box-body overflow-auto">
                
        <h4 class="mt-2"><span class="material-icons">radio_button_checked</span>Recording</h3>
        <p>Hitting a <b>record</b> button will create a keyframe with the current zoom level and window position. A keyframe can be deleted simply by using  <span class="material-icons">delete</span> delete button. 
        You can <span class="material-icons">play_arrow</span> play keyframes from the current selected one (the red one) or play all keyframes from the very start using <span class="material-icons">replay</span> replay button.</p>
        <h4 class="mt-2"><span class="material-icons">tune</span>Tune keyframes</h3>
        <p>You can adjust three values within a single keyframe:<br>
        &emsp; &times; delay time (miliseconds) - the time before this keyframe is being played; this value is ignored by manual controls<br>
        &emsp; &times; animation time (seconds) - the duration of the transition from the previous frame to the current frame<br>
        &emsp; &times; fade in out - the style of the transition: values close to 1 mean linear transition, default 6.5 value is the default transition of the visualiser when navigating<br>
        </p>

        <h4 class="mt-2"><span class="material-icons">control_camera</span>Manual controls</h3>
        <p>Instead of playing the keyframes out, you can manually select a keyframe by clicking the keyframe body (not the delay). It is useful also for keyframe duplication - select any keyframe and hit <span class="material-icons">radio_button_checked</span> record to repeat the exact position.</p>
        <p>Moreover, you can use <b>n</b> key to go to the next keyframe (next to the red selected one) and <b>s</b> to go to the first keyframe. Useful feature for playing out the recording when hidden.</p>

        <h4 class="mt-2"><span class="material-icons">hide_source</span>Hide plugin</h3>
        <p>For the recording purposes, the plugin can be hidden. You cannot make it visible again, and the plugin can be controlled only using manual controls. Think twice before hiding it, and always export your keyframes beforehand to avoid any loss.</p>
        </div>
        </div>
    </details-dialog>
    </div>
    `);

        this._container = $("#playback-timeline");
        this._playBtn = $("#presenter-play-icon");

        let _this = this;
        document.addEventListener("keydown", function(e) {
            if (e.code === "KeyN") {
                _this._idx++;
                if (_this._idx >= _this._steps.length) _this._idx = 0;
                _this._jumpAt(_this._idx);
            } else if (e.code === "KeyS") {
                _this._idx = 0;
                _this._jumpAt(_this._idx);
            }
        });
    }

    addRecord() {
        if (this._playing) {
            return;
        }
        let view = PLUGINS.osd.viewport;
        this._addRecord({
            zoomLevel: view.getZoom(),
            point: view.getCenter(),
            bounds: view.getBounds(),
            delay: 2000,
            animationTime: 1.4,
            springStiffness: 6.5
        });
    }

    _addRecord(record, timeoutValue=2000, animationDuration=1.4, fadeStyle=6.5) {
        this._steps.push(record);
        this._container.append(`<div class='d-inline-block'><div class='timeline-path'><input class='form-control input-sm' type='number' min='0' value='${timeoutValue}' title='Delay' onchange="automatic_presentation._steps[${this._maxIdx}].delay = parseFloat($(this).val());"> ms&nbsp;</div><div class='timeline-point' style='cursor:pointer' onclick='automatic_presentation.selectPoint(${this._maxIdx});'>
        <input class='form-control' type='number' min='0' value='${animationDuration}' step='0.1' title='Animation Duration' onchange="automatic_presentation._steps[${this._maxIdx}].animationTime = parseFloat($(this).val());"> sec <br>
        <input class='form-control' type='number' min='0' value='${fadeStyle}' step='0.1' title='Fade in out' onchange="automatic_presentation._steps[${this._maxIdx}].springStiffness = parseFloat($(this).val());"> (1=linear)
        </div></div>`);
        this._highlight(this._container.children().eq(this._maxIdx));
        this._maxIdx++;
    }

    removeHighlightedRecord() {
        if (!this._currentHighlight) {
            return;
        }
        this._currentHighlight.html("");
        this._currentHighlight = null;
        this._steps[this._idx] = null;
    }

    selectPoint(atIndex) {
        if (this._playing || this._steps.length <= atIndex) {
            return;
        }
        this._idx = atIndex;
        this._jumpAt(atIndex);
    }

    _jumpAt(index, direct=true) {
        if (!this._steps[index] || this._steps.length <= index) {
            return;
        }
        let state = this._steps[index],
            view = PLUGINS.osd.viewport;

        this._centerSpringXAnimationTime = view.centerSpringX.animationTime;
        this._centerSpringYAnimationTime = view.centerSpringY.animationTime;
        this._zoomSpringAnimationTime = view.zoomSpring.animationTime;

        view.centerSpringX.animationTime =
            view.centerSpringY.animationTime =
                view.zoomSpring.animationTime =
                    state.animationTime;

        view.centerSpringX.springStiffness =
            view.centerSpringY.springStiffness =
                view.zoomSpring.springStiffness =
                    state.springStiffness;

        if (direct) {
            view.fitBoundsWithConstraints(state.bounds);
        } else {
            view.panTo(state.point);
            view.zoomTo(state.zoomLevel);
        }
        view.applyConstraints();

        view.centerSpringX.animationTime = this._centerSpringXAnimationTime;
        view.centerSpringY.animationTime = this._centerSpringYAnimationTime;
        view.zoomSpring.animationTime = this._zoomSpringAnimationTime;
        this._highlight(this._container.children().eq(index));
    }

    play() {
        if (this._playing || this._idx === this._steps.length) return;

        this._playBtn.addClass("timeline-play");
        this.playStep(this._idx);
        let view = PLUGINS.osd.viewport;
        this._playing = true;

        // this._centerSpringXStiffness = view.centerSpringX.springStiffness;
        // this._centerSpringYStiffness = view.centerSpringY.springStiffness;
        // this._zoomSpringStiffness = view.zoomSpring.springStiffness;
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
        let previousDuration = prevIdx >= 0 && this._steps[prevIdx] ? this._steps[prevIdx].animationTime * 1000 : 0;
        this._currentStep = this._setDelayed(this._steps[index].delay + previousDuration, index);
        this._currentStep.promise.then(atIndex => {
            let _this = automatic_presentation;
            _this._jumpAt(atIndex);
            _this._idx  = atIndex + 1;
            _this.playStep(_this._idx);
        });
    }

    stop() {
        if (!this._playing) {
            return;
        }

        if (this._currentStep) {
            this._currentStep.cancel();
            this._currentStep = null;
        }
        this._playBtn.removeClass("timeline-play");
        this._playing = false;

        // let view = PLUGINS.osd.viewport;
        // view.centerSpringX.springStiffness = this._centerSpringXStiffness;
        // view.centerSpringY.springStiffness = this._centerSpringYStiffness;
        // view.zoomSpring.springStiffness = this._zoomSpringStiffness;
    }

    export() {
        let output = new Blob([JSON.stringify(this._steps)], { type: 'text/plain' });
        let downloadURL = window.URL.createObjectURL(output);
        var downloader = document.getElementById("export-recording");
        downloader.href = downloadURL;
        downloader.download = "visualisation-recording.json";
        downloader.click();
    }

    import(event) {
        let file = event.target.files[0];
        if (!file) return;
        let fileReader = new FileReader();
        let _this = this;
        fileReader.onload = function(e) {

            let json = JSON.parse(e.target.result);
            _this._idx = 0;
            _this._maxIdx = 0;
            _this._steps = [];
            _this._currentStep = null;
            _this._container.html("");

            for (let i = 0; i < json.length; i++) {
                if (!json[i]) continue;
                //recreate 'classes'
                json[i].bounds = new OpenSeadragon.Rect(json[i].bounds.x, json[i].bounds.y, json[i].bounds.width, json[i].bounds.height);
                json[i].point = new OpenSeadragon.Point(json[i].point.x, json[i].point.y);

                _this._addRecord(json[i], json[i].delay, json[i].animationTime, json[i].springStiffness);
            }
        }
        fileReader.readAsText(file);
    }

    _setDelayed(ms, index) {
        var timeout;
        var p = new Promise(function(resolve, reject) {
            timeout = setTimeout(function() {
                resolve(index);
            }, ms);
        });

        return {
            promise: p,
            cancel: function() {
                clearTimeout(timeout);
            }
        };
    }

    _highlight(node, index) {
        if (this._oldHighlight) {
            this._oldHighlight.removeClass("selected");
        }
        node.addClass("selected");
        this._oldHighlight = node;
        this._currentHighlight = node;
    }


}

registerPlugin(Presenter);
