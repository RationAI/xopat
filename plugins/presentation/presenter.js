Presenter = function () {
    //comply to the documentation:
	this.id = "automatic_presentation";
    this._idx = 0;
    this._maxIdx = 0;
    this._steps = [];
    this._currentStep = null;
	PLUGINS.each[this.id].instance = this;

    //controlPanelId is incomming parameter, defines where to add HTML
    PLUGINS.appendToMainMenu("Recorder", "", `
<button class='btn' onclick="automatic_presentation.addRecord();"><span class="material-icons timeline-play">radio_button_checked</span></button>
<button class='btn' onclick="automatic_presentation.play();"><span id='presenter-play-icon' class="material-icons">play_arrow</span></button>
<button class='btn' onclick="automatic_presentation.stop();"><span id='presenter-play-icon' class="material-icons">stop</span></button>
<button class='btn' onclick="automatic_presentation.playFromIndex(0);"><span class="material-icons">replay</span></button>
<br><br>
<div class='' id='playback-timeline'>
</div>
    
    `, "auto-recorder");

    this._container = $("#playback-timeline");
    this._playBtn = $("#presenter-play-icon");
}

Presenter.prototype = {

    addRecord: function() {
        let view = PLUGINS.osd.viewport;

        this._steps.push({
            zoomLevel: view.getZoom(),
            point: view.getCenter(),
            bounds: view.getBounds(),
            delay: 2000,
            animationTime: 1.4,
            springStiffness: 6.5
        });

        this._container.append(`<div class='d-inline-block'><div class='timeline-path'><input class='form-control input-sm' type='number' min='0' value='2000' title='Delay' onchange="automatic_presentation._steps[${this._maxIdx}].delay = $(this).val();"> ms&nbsp;</div><div class='timeline-point' onclick='automatic_presentation.selectPoint(${this._maxIdx});'>
        <input class='form-control' type='number' min='0' value='1.4' step='0.1' title='Animation Duration' onchange="automatic_presentation._steps[${this._maxIdx}].animationTime = $(this).val();"> sec <br>
        <input class='form-control' type='number' min='0' value='6.5' step='0.1' title='Fade in out' onchange="automatic_presentation._steps[${this._maxIdx}].springStiffness = $(this).val();"> (1=linear)
        </div></div>`);
        this._highlight(this._container.children().eq(this._maxIdx));
        this._maxIdx++;
    },

    selectPoint: function(atIndex) {
        if (this._steps.length <= atIndex) {
            return;
        }
        this._idx = atIndex;
        this._jumpAt(atIndex);
    },

    _jumpAt: function(index, direct=true) {
        if (this._steps.length <= index) {
            this.stop();
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
            state.springStiffness

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
        this._playBtn.addClass("timeline-play");
        this.playStep(this._idx);
        let view = PLUGINS.osd.viewport;

        this._centerSpringXStiffness = view.centerSpringX.springStiffness;
        this._centerSpringYStiffness = view.centerSpringY.springStiffness;
        this._zoomSpringStiffness = view.zoomSpring.springStiffness;
    },

    playFromIndex: function(index) {
        this._idx = index;
        this.play();
    },

    playStep(index) {
        if (this._steps.length <= index) {
            this._currentStep = null;
            this.stop();
            return;
        }

        this._currentStep = this._setDelayed(this._steps[index].delay, index);

        this._currentStep.promise.then(atIndex => {
                let _this = automatic_presentation;
                _this._jumpAt(atIndex);
                _this._idx++;
                _this.playStep(_this._idx);
            });
    },

    stop: function() {
        if (this._currentStep) {
            this._currentStep.cancel();
            this._currentStep = null;
        }
        this._playBtn.removeClass("timeline-play");
        let view = PLUGINS.osd.viewport;
        view.centerSpringX.springStiffness = this._centerSpringXStiffness;
        view.centerSpringY.springStiffness = this._centerSpringYStiffness;
        view.zoomSpring.springStiffness = this._zoomSpringStiffness;
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

    _highlight: function(node) {
        if (this._oldHighlight) {
            this._oldHighlight.removeClass("selected");
        }
        node.addClass("selected");
        this._oldHighlight = node;
    }
}

//comply to documentation
var automatic_presentation = new Presenter();
