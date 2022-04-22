OSDAnnotations.History = class {
    constructor(selfName, context, presetManager) {
        this._globalSelf = `${context.id}['${selfName}']`;
        this._buffer = [];
        this._buffidx = 0;
        this.BUFFER_LENGTH = null;
        this._lastValidIndex = -1;
        this._autoIncrement = 0;
        this._boardSelected = null;
        this._context = context;
        this._presets = presetManager;
        this.containerId = "bord-for-annotations";
    }

    init(historySize = 30) {
        this.BUFFER_LENGTH = historySize;
    }

    openHistoryWindow() {
        let ctx = this.winContext(true);
        if (ctx) {
            ctx.window.focus();
            return;
        }

        let undoCss = this._context.canvasObjects().length > 0 ?
            "color: var(--color-icon-primary);" : "color: var(--color-icon-tertiary);";

        Dialogs.showCustomModal(this.containerId, "Annotations Board",
            `<span class="f3 mr-2" style="line-height: 16px; vertical-align: text-bottom;">Board</span> 
<span id="history-undo" class="material-icons pointer" style="${undoCss}" 
onclick="opener.${this._globalSelf}.back()" id="history-undo">undo</span>
<span id="history-redo" class="material-icons pointer" style="color: var(--color-icon-tertiary);" 
onclick="opener.${this._globalSelf}.redo()" id="history-redo">redo</span>
<span id="history-refresh" class="material-icons pointer" onclick="opener.${this._globalSelf}.refresh()" 
id="history-refresh" title="Refresh board (fix inconsistencies).">refresh</span>
<span id="history-sync" class="material-icons pointer" onclick="opener.${this._globalSelf}.sync()" 
id="history-sync" title="Apply changes on presets to existing objects.">leak_add</span>
<button class="btn btn-danger mr-2 position-absolute right-2 top-2" type="button" aria-pressed="false" 
onclick="if (opener.${this._context.id}.disabledInteraction) return; window.opener.focus(); opener.${this._context.id}.deleteAllAnnotations()" id="delete-all-annotations">Delete All</button>`,
            `<div id="annotation-logger" class="inner-panel px-0 py-2" style="flex-grow: 3;">
<div id="annotation-logs" class="height-full" style="cursor:pointer;"></div></div></div>
<script>

window.addEventListener('load', (e) => {
    opener.${this._globalSelf}._syncLoad();
});

document.addEventListener('keydown', (e) => {
    const parentContext = opener.${this._context.id};  
    opener.focus();
    parentContext._keyDownHandler(e);
});

document.addEventListener('keyup', (e) => {
    const parentContext = opener.${this._context.id};   
    parentContext._keyUpHandler(e);
});

//refresh/close: reset mode
window.addEventListener("beforeunload", (e) => {
    const parentContext = opener.${this._globalSelf}; 
    if (parentContext._editSelection) {
        parentContext._boardItemSave();
    }
}, false);

</script>`);

        let active = this._context.canvas.getActiveObject();
        if (active) this.highlight(active);
    }

    winContext(required=false) {
        return Dialogs.getModalContext(this.containerId);
    }

    back() {
        if (this._context.disabledInteraction) return;

        const _this = this;
        if (this._buffer[this._buffidx]) {
            this._performSwap(this._context.canvas,
                this._buffer[this._buffidx].back, this._buffer[this._buffidx].forward);

            this._buffidx--;
            if (this._buffidx < 0) this._buffidx = this.BUFFER_LENGTH - 1;
            //if we went around and finished where we once were, stop
            if (this._lastValidIndex === this._buffidx) {
                //lose one object to prevent from cycling
                this._buffer[this._lastValidIndex] = null;

                this._lastValidIndex--;
                if (this._lastValidIndex < 0) this._lastValidIndex = this.BUFFER_LENGTH - 1;
            }

            this._performAtJQNode("history-redo", node => node.css("color", "var(--color-icon-primary)"));
        }

        this._performAtJQNode("history-undo", node => node.css("color",
            _this._buffer[_this._buffidx] ? "var(--color-icon-primary)" : "var(--color-icon-tertiary)")
        );
    }

    redo() {
        if (this._context.disabledInteraction) return;

        if (this._lastValidIndex >= 0 && this._buffidx !== this._lastValidIndex) {
            this._buffidx = (this._buffidx + 1) % this.BUFFER_LENGTH;

            this._performSwap(this._context.canvas,
                this._buffer[this._buffidx].forward, this._buffer[this._buffidx].back);

            const _this = this;
            this._performAtJQNode("history-redo", node => node.css("color",
                _this._lastValidIndex >= 0 && _this._buffidx !== _this._lastValidIndex ?
                    "var(--color-icon-primary)" : "var(--color-icon-tertiary)")
            );

            this._performAtJQNode("history-undo", node => node.css("color", "var(--color-icon-primary)"));
        }
    }

    _performAtJQNode(id, callback) {
        let ctx = this.winContext();
        if (ctx) {
            callback($(ctx.document.getElementById(id)));
        }
    }

    _getJQNode(id) {
        let ctx = this.winContext();
        if (!ctx) return undefined;
        return $(ctx.document.getElementById(id));
    }

    _getNode(id) {
        let ctx = this.winContext();
        if (!ctx) return undefined;
        return ctx.document.getElementById(id);
    }

    refresh() {
        if (this._context.disabledInteraction) return;

        this._performAtJQNode("annotation-logs", node => node.html(""));
        let _this = this;
        this._context.canvasObjects().some(o => {
            if (!isNaN(o.incrementId)) {
                _this._addToBoard(o);
            }
            return false;
        });
    }

    sync() {
        if (this._context.disabledInteraction) return;

        if (!window.opener.confirm("This will overwrite all properties of all existing annotations - " +
            "even those manually modified. Do you want to proceed?")) return;
        this._performAtJQNode("annotation-logs", node => node.html(""));
        this._syncLoad();
        //todo change in color not propagated, set dirty?
        this._context.canvas.renderAll();
    }

    _syncLoad() {
        let _this = this;
        this._context.canvasObjects().some(o => {
            if (o.presetID) {
                if (!o.incrementId || isNaN(o.incrementId)) {
                    o.incrementId = _this._autoIncrement++;
                }
                let preset = this._presets.get(o.presetID);
                if (preset) {
                    if (typeof o.fill === 'string') {
                        o.fill = preset.color;
                    }
                    o.color = preset.color;
                }
                _this._addToBoard(o);
            } else if (o.incrementId && !isNaN(o.incrementId)) {
                _this._addToBoard(o);
            }
            return false;
        });
    }

    push(newObject, previous = null) {
        PLUGINS.setDirty();
        if (newObject) {
            this._addToBoard(newObject);
            this.highlight(newObject);
        }

        if (previous) {
            this._removeFromBoard(previous);
        }
        //console.log("PREV", previous, "NEXT", newObject);

        this._buffidx = (this._buffidx + 1) % this.BUFFER_LENGTH;
        this._buffer[this._buffidx] = { forward: newObject, back: previous };
        this._lastValidIndex = this._buffidx; //new object creation overiddes history

        this._performAtJQNode("history-undo", node => node.css("color", "var(--color-icon-primary)"));
        this._performAtJQNode("history-redo", node => node.css("color", "var(--color-icon-tertiary)"));
    }

    pushWithoutUpdate(newObject, previous = null) {
        this._buffer[this._buffidx].forward = newObject;
        if (previous) this._buffer[this._buffidx].back = previous;
    }

    highlight(object) {
        let board = this._getJQNode("annotation-logs");
        if (this._boardSelected && board) {
            board.find(`#log-object-${this._boardSelected.incrementId}`).css("background", "none");
        }

        if (!object || !object.hasOwnProperty("incrementId")) return;

        if (object && board) {
            let node = board.find(`#log-object-${object.incrementId}`);
            if (!node) {
                this._addToBoard(object);
                node = board.find(`#log-object-${object.incrementId}`);
            }
            node.css("background", "var(--color-bg-success)");
        }
        this._boardSelected = object;
    }

    isOngoingEditOf(ofObject) {
        return this._editSelection && this._editSelection.incrementId === ofObject.incrementId;
    }

    _focus(cx, cy, objectId = null) {
        cx = Number.parseFloat(cx);
        cy = Number.parseFloat(cy);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

        let target = VIEWER.tools.referencedTiledImage().imageToViewportCoordinates(new OpenSeadragon.Point(cx, cy)),
            targetObj = undefined;
        if (objectId !== null) {
            targetObj = this._findObjectOnCanvasById(objectId);
            if (targetObj) {
                this.highlight(targetObj);
                this._context.canvas.setActiveObject(targetObj);
            }
        }
        VIEWER.viewport.panTo(target, false);
        VIEWER.viewport.applyConstraints();
        return targetObj;
    }

    _updateBoardText(object, text) {
        //console.log(text);
        if (!text || text.length < 0) text = this._getObjectDefaultDescription(object);
        this._performAtJQNode("annotation-logs", node =>
            node.find(`#log-object-${object.incrementId} span.desc`).html(text));
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _removeFromBoard(object) {
        this._performAtJQNode("annotation-logs", node =>
            node.children(`#log-object-${object.incrementId}`).remove());
    }

    _setControlsVisuallyEnabled(enabled) {
        let ctx = this.winContext();
        if (ctx) {
            let header = ctx.document.getElementById(this.containerId + "-header");
            if (enabled) {
                ctx.document.body.style.background = "transparent";
                header.readonly = false;
                header.style.filter = "none";
            } else {
                ctx.document.body.style.background = "#eb7777";
                header.readonly = true;
                header.style.filter = "contrast(0.5)";
            }
        }
    }

    _addToBoard(object) {
        let desc;
        let icon = this._getObjectDefaultIcon(object), inputs = [];

        if (!object.hasOwnProperty("incrementId")) {
            object.incrementId = this._autoIncrement++;
        }

        if (object.hasOwnProperty("meta")) {
            for (let key in object.meta) {
                let fn = key === "comment" ? inputs.unshift : inputs.push;
                fn.apply(inputs, ['<input type="text" class="form-control border-0" readonly class="desc" ',
                    'style="width: calc(100% - 80px); background:transparent;color: inherit;" value="',
                    object.meta[key].value, '" name="', key, '">']);
            }
        }

        //with no metadata, object will receive 'comment' on edit
        if (inputs.length  < 1) {
            inputs.push('<input type="text" class="form-control border-0" readonly class="desc" ',
                'style="width: calc(100% - 80px); background:transparent;color: inherit;" value="',
                this._getObjectDefaultDescription(object), '" name="comment">');
        }

        const _this = this;
        let center = object.getCenterPoint();
        this._performAtJQNode("annotation-logs", node => node.prepend(`
<div id="log-object-${object.incrementId}" class="rounded-2"
onclick="opener.${_this._globalSelf}._focus(${center.x}, ${center.y}, ${object.incrementId});">
<span class="material-icons" style="color: ${object.color}">${icon}</span> 
${inputs.join("")}
<span class="material-icons pointer" id="edit-log-object-${object.incrementId}" onclick="let self = $(this); if (self.html() === 'edit') {
opener.${_this._globalSelf}._boardItemEdit(self, ${center.x}, ${center.y}, ${object.incrementId}); } 
else { opener.${_this._globalSelf}._boardItemSave(); } return false;">edit</span></div>`));
    }

    itemEdit(object) {
        let node = this._getNode(`edit-log-object-${object.incrementId}`);
        if (node) {
            this._boardItemEdit(node, object.x, object.y);
        }
    }

    _boardItemEdit(self, cx, cy, object) {
        if (this._editSelection) {
            this._boardItemSave(true);
        } else {
            $('#bord-for-annotations .Box-header').css('background', 'var(--color-merge-box-error-indicator-bg)');
            this._context.setMouseOSDInteractive(false);
            this._context.enableInteraction(false);
        }

        self.parent().find("input").each((e, t) => {
            //todo does not work
            t.readonly = false;
        });
        self.html('save');

        let objectId = -1;
        if (typeof object !== "object") {
            objectId = object;
            object = this._focus(cx, cy, objectId) || this._context.canvas.getActiveObject();
        } else {
            objectId = object.incrementId;
        }

        this._editSelection = {
            incrementId: objectId,
            self: self,
            target: object
        };

        if (object) {
            let factory = this._context.getAnnotationObjectFactory(object.factoryId);
            if (factory) factory.edit(object);
        } else console.warn("Object edit: no active object.");
    }

    _boardItemSave(switches=false) {
        if (!this._editSelection) return;

        try {
            let obj = this._editSelection.target;
            if (obj) {
                //if target was set, object could have been edited, update
                let factory = this._context.getAnnotationObjectFactory(obj.factoryId);
                let newObject = factory.recalculate(obj);
                if (newObject) {
                    this._context.replaceAnnotation(obj, newObject, true);
                    obj = newObject;
                }
            } else {
                obj = this._findObjectOnCanvasById(this._editSelection.incrementId);
            }

            let self = this._editSelection.self,
                inputs = self.parent().find("input");
            if (obj) {
                if (!obj.meta) obj.meta = {};
                inputs.each((e, t) => {
                    obj.meta[t.name] = t.value;
                    t.readonly = true;
                });
                console.log(obj.meta);
            } else {
                console.warn("Failed to update object: could not find object with id "
                    + this._editSelection.incrementId);
                inputs.each((e, t) => t.readonly = true);
            }
            self.html('edit');

            if (!switches) {
                $('#bord-for-annotations .Box-header').css('background', 'none');
                this._context.setMouseOSDInteractive(true);
                this._context.enableInteraction(true);
            }
        } catch (e) {
            console.warn(e);
        }
        this._editSelection = undefined;
    }

    _getObjectDefaultDescription(object) {
        let factory = this._context.getAnnotationObjectFactory(object.factoryId);
        if (factory !== undefined) {
            return factory.getDescription(object);
        }
        return undefined;
    }

    _getObjectDefaultIcon(object) {
        let factory = this._context.getAnnotationObjectFactory(object.factoryId);
        if (factory !== undefined) {
            return factory.getIcon();
        }
        return "question_mark";
    }

    async _performSwap(canvas, toAdd, toRemove) {
        if (toAdd) {
            let center = toAdd.getCenterPoint();
            this._focus(center.x, center.y);
            await this._sleep(150); //let user to orient where canvas moved before deleting the element
            canvas.add(toAdd);
            this._addToBoard(toAdd);

            if (toRemove) {
                canvas.remove(toRemove);
                this._removeFromBoard(toRemove);
            }
            this._context.canvas.setActiveObject(toAdd);
        } else if (toRemove) {
            let center = toRemove.getCenterPoint();
            this._focus(center.x, center.y);
            await this._sleep(150); //let user to orient where canvas moved before deleting the element
            canvas.remove(toRemove);
            this._removeFromBoard(toRemove);
        }
        canvas.renderAll();
    }

    _findObjectOnCanvasById(id) {
        //todo fabric.js should have some way how to avoid linear iteration over all objects...
        let target = null;
        this._context.canvasObjects().some(o => {
            if (o.incrementId === id) {
                target = o;
                return true;
            }
            return false;
        });
        return target;
    }
};
