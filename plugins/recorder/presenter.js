class Presenter {
    constructor(id, params) {
        this.id = id;
        this._toolsMenuId = "presenter-tools-menu";
        this.PLUGIN = `plugin('${id}')`;

        //todo document option, get via getOption instead
        this.playOnEnter = params.playEnterDelay ?? -1;
    }

    pluginReady() {
        this.snapshots = OpenSeadragon.Snapshots.instance(VIEWER);

        USER_INTERFACE.MainMenu.append("Recorder", `<span style='float:right;' class="btn-pointer" onclick="if (!confirm('You cannot show the recorder again - only by re-loading the page. Continue?')) return; $('#auto-recorder').css('display', 'none');">Hide <span class="material-icons">hide_source</span></span>
    <span onclick="this.nextSibling.click();" title="Import Recording" style="float: right;"><span class="material-icons btn-pointer">file_upload</span></span><input type='file' style="visibility:hidden; width: 0; height: 0;" onchange="${this.PLUGIN}.import(event);" />
    <span onclick="${this.PLUGIN}.export();" title="Export Recording" style="float: right;"><span class="material-icons btn-pointer">file_download</span></span>`, `
${UIComponents.Elements.checkBox({
            label: "Capture visualization",
            onchange: this.PLUGIN + ".snapshots.capturesVisualization = this.checked && this.checked !== 'false';",
            default: this.snapshots.capturesVisualization
        })}&emsp;
${UIComponents.Elements.checkBox({
            label: "Capture Viewport",
            onchange: this.PLUGIN + ".snapshots.capturesViewport = this.checked && this.checked !== 'false';",
            default: this.snapshots.capturesViewport
        })}<br><br>
<button class='btn btn-pointer' onclick="${this.PLUGIN}.addRecord();"><span class="material-icons timeline-play">radio_button_checked</span></button>
<button class='btn btn-pointer' onclick="${this.PLUGIN}.snapshots.play();"><span id='presenter-play-icon' class="material-icons">play_arrow</span></button>
<button class='btn btn-pointer' onclick="${this.PLUGIN}.snapshots.stop();"><span id='presenter-play-icon' class="material-icons">stop</span></button>
<button class='btn btn-pointer' onclick="${this.PLUGIN}.snapshots.playFromIndex(0);"><span class="material-icons">replay</span></button>
<button class='btn btn-pointer' onclick="${this.PLUGIN}.removeHighlightedRecord();"><span class="material-icons">delete</span></button><br>

<br><br>`,"auto-recorder", this.id);

        USER_INTERFACE.Tools.setMenu(this.id, this._toolsMenuId, "Timeline",
            `<div class="d-flex">
<span class="material-icons timeline-play-small btn-pointer" onclick="${this.PLUGIN}.addRecord();">radio_button_checked</span>
<div class='d-inline-block timeline-path'>
<div class="d-inline-block"><span style="font-size: xx-small">Delay</span><br>
<input class='form-control input-sm' id="point-delay" type='number' min='0' value='2' step="0.1" title='Delay' onchange="${this.PLUGIN}.setValue('delay', parseFloat($(this).val()));"> s</div><div class='timeline-point' style='cursor:pointer' '>
</div><div class="d-inline-block"><span style="font-size: xx-small">Duration</span><br>
<input class='form-control input-sm' id="point-duration" type='number' min='0' value='1.4' step='0.1' title='Animation Duration' onchange="${this.PLUGIN}.setValue('duration', parseFloat($(this).val()));"> s<br>
</div>&emsp;<div class="d-inline-block"><span style="font-size: xx-small">Linear / Ease</span><br>
<input class='form-control input-sm' id="point-spring" type='range' min='1' value='6.5' step='0.2' max="10" style="width: 40px;" title='Fade in out' onchange="${this.PLUGIN}.setValue('transition', parseFloat($(this).val()));"> 
</div></div>
<div id='playback-timeline' style="white-space: nowrap; overflow-x: auto; overflow-y: hidden; height: 48px" class="d-inline-block v-align-top position-relative flex-1 ml-3"></div>


</div>`, 'play_circle_outline');

        this._container = $("#playback-timeline");

        const _this = this;
        this.snapshots.addHandler('play', function () {
            $("#presenter-play-icon").addClass("timeline-play");
            USER_INTERFACE.Tools.notify(this._toolsMenuId, '➤');
        });

        this.snapshots.addHandler('stop', function () {
            $("#presenter-play-icon").removeClass("timeline-play");
        });

        this.snapshots.addHandler('enter', function (e) {
            _this._highlight(e.step, e.index);
        });

        this.snapshots.addHandler('create', function (e) {
            USER_INTERFACE.Tools.notify(_this._toolsMenuId);

            //todo create WRT current position
            _this._addUIStepFrom(e.step);
        });

        console.log(this.snapshots._steps);
        //todo create event fired during instantiation possibly --> now hotfix add them here
        for (let step of this.snapshots._steps) {
            _this._addUIStepFrom(step);
        }

        VIEWER.addHandler('keydown', function(e) {
            //if (e.ctrlKey) {
            if (e.code === "KeyN") {
                _this.snapshots.goToIndex(_this.snapshots.currentStep + 1);
            } else if (e.code === "KeyS") {
                _this.snapshots.goToIndex(0);
            }
            //}
        });

        if (Number.isInteger(this.playOnEnter) && this.playOnEnter >= 0) {
            setTimeout(function() {
                _this.snapshots.playFromIndex(0);
            }, this.playOnEnter);
        }
    }

    addRecord() {
        this.snapshots.create(
            parseFloat($("#point-delay").val()),
            parseFloat($("#point-duration").val()),
            parseFloat($("#point-spring").val())
        );
    }

    selectPoint(node) {
        let index = Array.prototype.indexOf.call(node.parentNode.children, node);
        this.snapshots.goToIndex(index);
    }

    setValue(key, value) {
        if (this.snapshots.snapshotCount < 1) return;

        let index = this.snapshots.currentStepIndex;

        let node = this._container.children()[index];
        if (node) {
            this.snapshots.currentStep[key] = value;
            node.style[this._getStyleFor(key)] = this._convertValue(key, value);
        }
    }

    removeHighlightedRecord() {
        let index = this.snapshots.currentStepIndex;
        let child = this._container.children()[index];
        if (child) {
            this.snapshots.remove(index);
            $(child).remove();
        }
    }

    export() {
        UTILITIES.downloadAsFile("visualisation-recording.json", this.snapshots.exportJSON());
    }

    import(event) {
        let file = event.target.files[0];
        if (!file) return;
        let fileReader = new FileReader();
        const _this = this;
        fileReader.onload = e => _this.snapshots.importJSON(JSON.parse(e.target.result));
        fileReader.readAsText(file);
    }

    _highlight(step, index) {
        if (this._oldHighlight) {
            this._oldHighlight.removeClass("selected");
        }
        this._oldHighlight = $(this._container.children()[index]); //todo just keep no-jquery node?
        this._oldHighlight.addClass("selected");
        $("#point-delay").val(step.delay);
        $("#point-duration").val(step.duration);
        $("#point-spring").val(step.transition);
    }

    _addUIStepFrom(step) {
        let color = "#000";
        if (this.snapshots.stepCapturesVisualization(step)) {
            color = this.snapshots.stepCapturesViewport(step) ? "#ff8800" : "#9dff00";
        } else if (this.snapshots.stepCapturesViewport(step)) {
            color = "#00d0ff";
        }

        let height = Math.max(7, Math.log(step.zoomLevel ?? 1) /
            Math.log(VIEWER.viewport.getMaxZoom()) * 18 + 14);

        this._container.append(`<span onclick="${this.PLUGIN}.selectPoint(this);" style="
background: ${color};
border-color: ${color};
border-bottom-left-radius: ${this._convertValue('transition', step.transition)};
width: ${this._convertValue('duration', step.duration)}; 
height: ${height}px; 
margin-left: ${this._convertValue('delay', step.delay)};"></span>`);
        this.snapshots.goToIndex(this.snapshots.snapshotCount-1);
    }

    _convertValue(key, value) {
        switch (key) {
            case 'delay': return `${value * 2}px`;
            case 'duration': return `${value * 4 + 6}px`;
            case 'transition': return `${value}px`;
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
}

addPlugin("recorder", Presenter);
