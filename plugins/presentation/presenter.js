Presenter = function () {
    //comply to the documentation:
	this.id = "automatic_presentation";
    this._idx = 0;
    this._maxIdx = 0;
    this._steps = [];
    this._currentStep = null;
	PLUGINS.each[this.id].instance = this;

    //controlPanelId is incomming parameter, defines where to add HTML
    PLUGINS.appendToMainMenuExtended("Recorder", `<span onclick="this.nextSibling.click();" title="Import Recording" style="cursor: pointer;">Import <span class="material-icons">file_upload</span></span><input type='file' style="visibility:hidden; width: 0; height: 0;" onchange="automatic_presentation.import(event);" />
    <span onclick="automatic_presentation.export();" title="Export Recording" style="cursor: pointer;">Export <span class="material-icons">file_download</span></span><a style="display:none;" id="export-recording"></a>`, `
<button class='btn' onclick="automatic_presentation.addRecord();"><span class="material-icons timeline-play">radio_button_checked</span></button>
<button class='btn' onclick="automatic_presentation.play();"><span id='presenter-play-icon' class="material-icons">play_arrow</span></button>
<button class='btn' onclick="automatic_presentation.stop();"><span id='presenter-play-icon' class="material-icons">stop</span></button>
<button class='btn' onclick="automatic_presentation.playFromIndex(0);"><span class="material-icons">replay</span></button>
<button class='btn' onclick="automatic_presentation.removeHighlightedRecord();"><span class="material-icons">delete</span></button>
<br><br>`, `<div class='' id='playback-timeline'></div>`, "auto-recorder");

    this._container = $("#playback-timeline");
    this._playBtn = $("#presenter-play-icon");
}

Presenter.prototype = {

    addRecord: function() {
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
    },

    _addRecord: function(record) {
        this._steps.push(record);
        this._container.append(`<div class='d-inline-block'><div class='timeline-path'><input class='form-control input-sm' type='number' min='0' value='2000' title='Delay' onchange="automatic_presentation._steps[${this._maxIdx}].delay = parseFloat($(this).val());"> ms&nbsp;</div><div class='timeline-point' onclick='automatic_presentation.selectPoint(${this._maxIdx});'>
        <input class='form-control' type='number' min='0' value='1.4' step='0.1' title='Animation Duration' onchange="automatic_presentation._steps[${this._maxIdx}].animationTime = parseFloat($(this).val());"> sec <br>
        <input class='form-control' type='number' min='0' value='6.5' step='0.1' title='Fade in out' onchange="automatic_presentation._steps[${this._maxIdx}].springStiffness = parseFloat($(this).val());"> (1=linear)
        </div></div>`);
        this._highlight(this._container.children().eq(this._maxIdx));
        this._maxIdx++;
    },

    removeHighlightedRecord: function() {
        if (!this._currentHighlight) {
           return;
        }
        this._currentHighlight.html("");
        this._currentHighlight = null;
        this._steps[this._idx] = null;
    },

    selectPoint: function(atIndex) {
        if (this._playing || this._steps.length <= atIndex) {
            return;
        }
        this._idx = atIndex;
        this._jumpAt(atIndex);
    },

    _jumpAt: function(index, direct=true) {
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
    },

    play: function() {
        if (this._playing || this._idx+1 === this._steps.length) return;

        this._playBtn.addClass("timeline-play");
        this.playStep(this._idx);
        let view = PLUGINS.osd.viewport;
        this._playing = true;

        // this._centerSpringXStiffness = view.centerSpringX.springStiffness;
        // this._centerSpringYStiffness = view.centerSpringY.springStiffness;
        // this._zoomSpringStiffness = view.zoomSpring.springStiffness;
    },

    playFromIndex: function(index) {
        if (this._playing) {
            return;
        }
        this._idx = index;
        this.play();
    },

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
    },

    stop: function() {
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
    },

    export: function() {
        let output = new Blob([JSON.stringify(this._steps)], { type: 'text/plain' });
        let downloadURL = window.URL.createObjectURL(output);
        var downloader = document.getElementById("export-recording");
                downloader.href = downloadURL;
        downloader.download = "visualisation-recording.json";
        downloader.click();
    },

    import: function(event) {
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
            //recreate 'classes'
            json[i].bounds = new OpenSeadragon.Rect(json[i].bounds.x, json[i].bounds.y, json[i].bounds.width, json[i].bounds.height);
            json[i].point = new OpenSeadragon.Point(json[i].point.x, json[i].point.y);

            _this._addRecord(json[i]);
          }
        }
        fileReader.readAsText(file);
    },

    _setDelayed: function(ms, index) {
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
    },

    _highlight: function(node, index) {
        if (this._oldHighlight) {
            this._oldHighlight.removeClass("selected");
        }
        node.addClass("selected");
        this._oldHighlight = node;
        this._currentHighlight = node;
    }
}

//comply to documentation
var automatic_presentation = new Presenter();
