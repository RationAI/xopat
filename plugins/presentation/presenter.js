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
<button class='btn' onclick="automatic_presentation.playFromIndex(0);"><span class="material-icons">replay</span></button>
<br><br>
<div class='' id='playback-timeline' style='display: table-row;'>
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
            delay: 2000,
            animationTime: 1.4
        });

        this._container.append(`<div class='d-inline-block'><div class='timeline-path'><input class='form-control input-sm' type='number' min='0' value='2000' title='Delay' onchange="automatic_presentation._steps[${this._maxIdx}].delay = $(this).val();"> ms &nbsp;</div>
        <div class='timeline-point' onclick='automatic_presentation.selectPoint(${this._maxIdx});'>
        <input class='form-control' type='number' min='0' value='1.4' step='0.1' title='Animation Duration' onchange="automatic_presentation._steps[${this._maxIdx}].animationTime = $(this).val();"> s <br>

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

    _jumpAt: function(index) {
        if (this._steps.length <= index) {
            this.stop();
            return;
        }
        let state = this._steps[index],
            view = PLUGINS.osd.viewport;
        
        view.centerSpringX.animationTime =
        view.centerSpringY.animationTime =
        view.zoomSpring.animationTime =
        state.animationTime;

        view.panTo(state.point);
        view.zoomTo(state.zoomLevel);
        view.applyConstraints();

        this._highlight(this._container.children().eq(index));
    },

    play: function() {
        this._playBtn.addClass("timeline-play");
        this.playStep(this._idx);
        this._defaultAnimationTime = PLUGINS.osd.viewport.animationTime;

        this._centerSpringXAnimationTime = PLUGINS.osd.viewport.centerSpringX.animationTime;
        this._centerSpringYAnimationTime = PLUGINS.osd.viewport.centerSpringY.animationTime;
        this._zoomSpringAnimationTime = PLUGINS.osd.viewport.zoomSpring.animationTime;
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

        this._currentStep = this._setDelayed(this._steps[index].delay, index)
            .then(atIndex => {
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

        PLUGINS.osd.viewport.centerSpringX.animationTime = this._centerSpringXAnimationTime;
        PLUGINS.osd.viewport.centerSpringY.animationTime = this._centerSpringYAnimationTime;
        PLUGINS.osd.viewport.zoomSpring.animationTime = this._zoomSpringAnimationTime;
    },

    _setDelayed: function(ms, index) {
        var p = new Promise(function(resolve, reject) {
            this._timeout = setTimeout(function() {
                resolve(index);
            }, ms);
            this.cancel = function() {
                reject(new Error("Timeout"));
                clearTimeout(this._timeout);
            };
        });
        return p;
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
