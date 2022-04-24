class Presenter {
    constructor(id, params) {
        this.id = id;
        this._idx = 0;
        this._steps = [];
        this._currentStep = null;
        this._toolsMenuId = "presenter-tools-menu";
        this.engine = new OpenSeadragon.Tools(VIEWER);
    }

    pluginReady() {
        USER_INTERFACE.MainMenu.append("Recorder", `<span style='cursor:pointer;float:right;' onclick="if (!confirm('You cannot show the recorder again - only by re-loading the page. Continue?')) return; $('#auto-recorder').css('display', 'none');">Hide <span class="material-icons">hide_source</span></span>
    <span onclick="this.nextSibling.click();" title="Import Recording" style="float: right;"><span class="material-icons pointer">file_upload</span></span><input type='file' style="visibility:hidden; width: 0; height: 0;" onchange="${this.id}.import(event);" />
    <span onclick="${this.id}.export();" title="Export Recording" style="float: right;"><span class="material-icons pointer">file_download</span></span><a style="display:none;" id="export-recording"></a>`, `
<button class='btn' onclick="${this.id}.addRecord();"><span class="material-icons timeline-play">radio_button_checked</span></button>
<button class='btn' onclick="${this.id}.play();"><span id='presenter-play-icon' class="material-icons">play_arrow</span></button>
<button class='btn' onclick="${this.id}.stop();"><span id='presenter-play-icon' class="material-icons">stop</span></button>
<button class='btn' onclick="${this.id}.playFromIndex(0);"><span class="material-icons">replay</span></button>
<button class='btn' onclick="${this.id}.removeHighlightedRecord();"><span class="material-icons">delete</span></button><br>

<br><br>`,"auto-recorder", this.id);

        USER_INTERFACE.Tools.setMenu(this.id, this._toolsMenuId, "Timeline",
            `<div class="d-flex">
<span class="material-icons timeline-play-small pointer" onclick="${this.id}.addRecord();">radio_button_checked</span>
<div class='d-inline-block timeline-path'>
<div class="d-inline-block"><span style="font-size: xx-small">Delay</span><br>
<input class='form-control input-sm' id="point-delay" type='number' min='0' value='2' step="0.1" title='Delay' onchange="${this.id}.setValue('delay', parseFloat($(this).val()));"> s</div><div class='timeline-point' style='cursor:pointer' '>
</div><div class="d-inline-block"><span style="font-size: xx-small">Duration</span><br>
<input class='form-control input-sm' id="point-duration" type='number' min='0' value='1.4' step='0.1' title='Animation Duration' onchange="${this.id}.setValue('duration', parseFloat($(this).val()));"> s<br>
</div>&emsp;<div class="d-inline-block"><span style="font-size: xx-small">Linear / Ease</span><br>
<input class='form-control input-sm' id="point-spring" type='range' min='1' value='6.5' step='0.2' max="10" style="width: 40px;" title='Fade in out' onchange="${this.id}.setValue('transition', parseFloat($(this).val()));"> 
</div></div>
<div id='playback-timeline' style="white-space: nowrap; overflow-x: auto; overflow-y: hidden; height: 48px" class="d-inline-block v-align-top position-relative flex-1 ml-3"></div>


</div>`, 'play_circle_outline');

        this._container = $("#playback-timeline");

        UTILITIES.addPostExport("presentation-keyframes", this.exportJSON.bind(this), this.id);
        let importedJson = APPLICATION_CONTEXT.postData["presentation-keyframes"];
        if (importedJson) {
            try {
                this.importJSON(JSON.parse(importedJson));
            } catch (e) {
                console.warn(e);
                Dialogs.show("Failed to load keyframes: try to load them manually if you have (or extract from the exported file).", 20000, Dialogs.MSG_ERR);
            }
        }

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
        let view = VIEWER.viewport;
        this._addRecord({
            zoomLevel: view.getZoom(),
            point: view.getCenter(),
            delay: parseFloat($("#point-delay").val()),
            duration: parseFloat($("#point-duration").val()),
            transition: parseFloat($("#point-spring").val())
        });
        USER_INTERFACE.Tools.notify(this._toolsMenuId);
    }

    _addRecord(record) {
        this._steps.push(record);
        this._container.append(`<span onclick="${this.id}.selectPoint(this);" style="
filter: ${this._convertValue('transition', record.transition)};
width: ${this._convertValue('duration', record.duration)}; 
height: ${Math.log(record.zoomLevel) / Math.log(VIEWER.viewport.getMaxZoom()) * 20 + 12}px; 
margin-left: ${this._convertValue('delay', record.delay)};"></span>`);
        this._highlight(this._steps.length-1);
    }

    setValue(key, value) {
        if (this._steps.length === 0) return;
        this._steps[this._idx][key] = value;
        let node = this._container.children()[this._idx];
        node.style[this._getStyleFor(key)] = this._convertValue(key, value);
    }

    _convertValue(key, value) {
        switch (key) {
            case 'delay': return `${value * 2}px`;
            case 'duration': return `${value * 4 + 6}px`;
            case 'transition': return `brightness(${(value - 1) / 9})`;
            default: return value;
        }
    }

    _getStyleFor(key) {
        switch (key) {
            case 'delay': return "margin-left";
            case 'duration': return "width";
            case 'transition': return "filter";
            default: return value;
        }
    }

    removeHighlightedRecord() {
        let child = this._container.children()[this._idx];
        if (child) {
            this._steps.splice(this._idx, 1);
            $(child).remove();
            if (this._steps.length === 0) return;
            this._highlight(this._idx++ % this._steps.length);
        }
    }

    _findSelfIndex(node) {
       return Array.prototype.indexOf.call(node.parentNode.children, node);
    }

    selectPoint(node) {
        let atIndex = this._findSelfIndex(node);
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
        this.engine.focus(this._steps[index]);
        this._highlight(index);
    }

    play() {
        if (this._playing || this._idx === this._steps.length) return;

        $("#presenter-play-icon").addClass("timeline-play");
        USER_INTERFACE.Tools.notify(this._toolsMenuId, '➤');
        this.playStep(this._idx);
        let view = VIEWER.viewport;
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

        const _this = this;
        this._currentStep.promise.then(atIndex => {
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
        $("#presenter-play-icon").removeClass("timeline-play");
        this._playing = false;
    }

    exportJSON() {
        return JSON.stringify(this._steps);
    }

    importJSON(json) {
        this._idx = 0;
        this._steps = [];
        this._currentStep = null;
        this._container.html("");

        for (let i = 0; i < json.length; i++) {
            if (!json[i]) continue;
            //recreate 'classes'
            json[i].bounds = new OpenSeadragon.Rect(json[i].bounds.x, json[i].bounds.y, json[i].bounds.width, json[i].bounds.height);
            json[i].point = new OpenSeadragon.Point(json[i].point.x, json[i].point.y);

            this._addRecord(json[i]);
        }
    }

    export() {
        let output = new Blob([this.exportJSON()], { type: 'text/plain' });
        let downloadURL = window.URL.createObjectURL(output);
        var downloader = document.getElementById("export-recording");
        downloader.href = downloadURL;
        downloader.download = "visualisation-recording.json";
        downloader.click();
        URL.revokeObjectURL(downloadURL);
    }

    import(event) {
        let file = event.target.files[0];
        if (!file) return;
        let fileReader = new FileReader();
        const _this = this;
        fileReader.onload = e => _this.importJSON(JSON.parse(e.target.result));
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

    _highlight(index) {
        if (this._oldHighlight) {
            this._oldHighlight.removeClass("selected");
        }
        this._idx = index;
        this._oldHighlight = $(this._container.children()[index]);
        this._oldHighlight.addClass("selected");
        let data = this._steps[index];
        $("#point-delay").val(data.delay);
        $("#point-duration").val(data.duration);
        $("#point-spring").val(data.transition);
    }
}

addPlugin("automatic_presentation", Presenter);
