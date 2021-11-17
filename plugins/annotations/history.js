History = function (selfName, context, presetManager) {
    this._globalSelf = `${context.id}['${selfName}']`;
    this._buffer = [];
    this._buffidx = 0;
    this.BUFFER_LENGTH = null;
    this._lastValidIndex = -1;
    this._autoIncrement = 0;
    this._boardSelected = null;
    this._context = context;
    this._presets = presetManager;
}

History.prototype = {

    init: function (historySize = 30) {
        PLUGINS.appendToMainMenu("Board",
            `<span id="history-undo" class="material-icons" style="color: var(--color-icon-tertiary); cursor: pointer;" 
onclick="${this._globalSelf}.back()" id="history-undo">undo</span>
<span id="history-redo" class="material-icons" style="color: var(--color-icon-tertiary); cursor: pointer;" 
onclick="${this._globalSelf}.redo()" id="history-redo">redo</span>
<span id="history-refresh" class="material-icons" style="cursor: pointer;" onclick="${this._globalSelf}.refresh()" 
id="history-refresh" title="Refresh board (fix inconsistencies).">refresh</span>
<span id="history-sync" class="material-icons" style="cursor: pointer;" onclick="${this._globalSelf}.sync()" 
id="history-sync" title="Apply changes on presets to existing objects.">leak_add</span>
<button class="btn btn-danger mr-2 position-absolute right-2 top-0" type="button" aria-pressed="false" 
onclick="${this._context.id}.deleteAllAnnotations()" id="delete-all-annotations">Delete All</button>`,
            `<div id="annotation-logger" class="inner-panel px-0 py-2" style="flex-grow: 3;">
<div id="annotation-logs" class="height-full" style="cursor:pointer;overflow-y: overlay;"></div></div></div>`,
            'annotation-board',
            this._context.id);

        this.board = $("#annotation-logs");
        this.undoBtn = $("#history-undo");
        this.redoBtn = $("#history-redo");

        this.BUFFER_LENGTH = historySize;

        this._context.canvasObjects().forEach(object => {
            this._addToBoard(object);
        });
    },

    back: function () {
        if (this._buffer[this._buffidx]) {
            this._performSwap(this._context.canvas(),
                this._buffer[this._buffidx].back, this._buffer[this._buffidx].forward)

            //this._bufferLastRemoved = this._buffer[this._buffidx];
            //this._buffer[this._buffidx] = null;

            this._buffidx--;
            if (this._buffidx < 0) this._buffidx = this.BUFFER_LENGTH - 1;
            //if we went around and finished where we once were, stop
            if (this._lastValidIndex === this._buffidx) {
                //lose one object to prevent from cycling
                this._buffer[this._lastValidIndex] = null;

                this._lastValidIndex--;
                if (this._lastValidIndex < 0) this._lastValidIndex = this.BUFFER_LENGTH - 1;
            }

            if (this.redoBtn) this.redoBtn.css("color", "var(--color-icon-primary)");
        }

        if (this.undoBtn) {
            let color = this._buffer[this._buffidx] ? "var(--color-icon-primary)" : "var(--color-icon-tertiary)";
            this.undoBtn.css("color", color);
        }
    },

    redo: function () {
        if (this._lastValidIndex >= 0 && this._buffidx !== this._lastValidIndex) {
            this._buffidx = (this._buffidx + 1) % this.BUFFER_LENGTH;

            this._performSwap(this._context.canvas(),
                this._buffer[this._buffidx].forward, this._buffer[this._buffidx].back);

            if (this.redoBtn) {
                let color = this._lastValidIndex >= 0 && this._buffidx !== this._lastValidIndex ?
                    "var(--color-icon-primary)" : "var(--color-icon-tertiary)";
                this.redoBtn.css("color", color);
            }
            if (this.undoBtn) this.undoBtn.css("color", "var(--color-icon-primary)");
        }
    },

    refresh: function() {
        this.board.html("");
        let _this = this;
        this._context.canvasObjects().some(o => {
            if (!isNaN(o.incrementId)) {
                _this._addToBoard(o);
            }
            return false;
        });
    },

    sync: function() {
        if (!confirm("This will overwrite all properties of all existing annotations - " +
            "even those manually modified. Do you want to proceed?")) return;
        this.board.html("");
        let _this = this;
        this._context.canvasObjects().some(o => {
            if (!isNaN(o.incrementId) && o.presetID) {
                let preset = this._presets.getPreset(o.presetID);
                if (preset) {
                    o.fill = preset.fill;
                    o.comment = preset.comment;
                }
                _this._addToBoard(o);
            }
            return false;
        });
        //todo change in color not propagated, set dirty?
        this._context.canvas().renderAll();
    },

    push: function (newObject, previous = null) {
        if (newObject) {
            this._addToBoard(newObject);
        }

        if (previous) {
            //todo not necessarily ID present
            this._removeFromBoard(previous);
        }

        //console.log("PREV", previous, "NEXT", newObject);

        this._buffidx = (this._buffidx + 1) % this.BUFFER_LENGTH;
        this._buffer[this._buffidx] = { forward: newObject, back: previous };
        this._lastValidIndex = this._buffidx; //new object creation overiddes history

        if (this.undoBtn && this.redoBtn) {
            this.undoBtn.css("color", "var(--color-icon-primary)");
            this.redoBtn.css("color", "var(--color-icon-tertiary)");
        }
    },

    highlight: function (object) {
        if (!object.incrementId) return;

        if (this._boardSelected) {
            this.board.find(`#log-object-${this._boardSelected.incrementId}`).css("background", "none");
        }
        if (object) {
            this.board.find(`#log-object-${object.incrementId}`).css("background", "#ffffff1f");
        }
        this._boardSelected = object;
    },

    isOngoingEdit: function(ofObject) {
        return this._editSelection && this._editSelection.incrementId === ofObject.incrementId;
    },

    _focus: function (cx, cy, objectId = null) {
        let target = PLUGINS.imageLayer.imageToViewportCoordinates(new OpenSeadragon.Point(cx, cy));
        if (objectId !== null) {
            let targetObj = this._findObjectOnCanvasById(objectId);
            if (targetObj) {
                this._context.canvas().setActiveObject(targetObj);
            }
        }
        PLUGINS.osd.viewport.panTo(target);
        PLUGINS.osd.viewport.applyConstraints();
    },

    _updateBoardText: function (object, text) {
        //console.log(text);
        if (!text || text.length < 0) text = this._getObjectDefaultDescription(object);
        this.board.find(`#log-object-${object.incrementId} span.desc`).html(text);
    },

    _removeFromBoard: function (object) {
        this.board.children(`#log-object-${object.incrementId}`).remove();
    },

    _addToBoard: function (object) {
        let desc, icon;
        if (!object.comment) {
            desc = this._getObjectDefaultDescription(object);
            icon = this._getObjectDefaultIcon(object);
        } else {
            desc = object.comment;
            if (desc === this._context.leftClickLabel || desc === this._context.rightClickLabel) {
                //auto labelling - append coords to distinguish
                desc += ` [${Math.round(object.left)}, ${Math.round(object.top)}]`;
            }
            icon = this._getObjectDefaultIcon(object);
        }

        if (!object.incrementId) {
            object.incrementId = this._autoIncrement;
            this._autoIncrement++;
        }

        let center = object.getCenterPoint();
        this.board.prepend(`<div id="log-object-${object.incrementId}" 
onclick="${this._globalSelf}._focus(${center.x}, ${center.y}, ${object.incrementId});">
<span class="material-icons" style="color: ${object.fill}">${icon}</span> 
<input type="text" class="form-control border-0" disabled="true" class="desc" 
style="width: calc(100% - 80px); background:transparent;" value="${desc}">
<span class="material-icons" onclick="let self = $(this); if (self.html() === 'edit') {
${this._globalSelf}._boardItemEdit(self, ${object.incrementId}); } else { ${this._globalSelf}._boardItemSave(); }">edit</span></div>`);
    },

    _boardItemEdit(self, objectId) {
        if (this._editSelection) {
            this._boardItemSave(true);
        } else {
            $('#annotation-board').css('background', 'var(--color-merge-box-error-indicator-bg)');
            this._context.setMouseOSDInteractive(false);
        }

        self.prev().prop('disabled', false);
        self.html('save');

        //todo possible problem with storing dynamic html node
        this._editSelection = {
            incrementId: objectId,
            self: self
        }
    } ,

    _boardItemSave(switches=false) {
        if (!this._editSelection) return;
        let self = this._editSelection.self;
        self.html('edit');
        self.prev().prop('disabled', true);
        let obj = this._findObjectOnCanvasById(this._editSelection.incrementId);
        if (obj) obj.set({comment: self.prev().val()});

        if (!switches) {
            $('#annotation-board').css('background', 'none');
            this._context.setMouseOSDInteractive(true);
        }
        this._editSelection = undefined;
    } ,

    _getObjectDefaultDescription: function (object) {
        let factory = this._context.getAnnotationObjectFactory(object.type);
        if (factory !== undefined) {
            return factory.getDescription(object);
        }
        return undefined;
    },

    _getObjectDefaultIcon: function (object) {
        let factory = this._context.getAnnotationObjectFactory(object.type);
        if (factory !== undefined) {
            return factory.getIcon();
        }
        return undefined;
    },

    _performSwap: async function (canvas, toAdd, toRemove) {
        if (toRemove) {
            let center = toRemove.getCenterPoint();
            this._focus(center.x, center.y);
            await sleep(150); //let user to orient where canvas moved before deleting the element
            canvas.remove(toRemove);
            this._removeFromBoard(toRemove);

            if (toAdd) {
                canvas.add(toAdd);
                this._context.canvas().setActiveObject(toAdd);
                this._addToBoard(toAdd);
            }
            canvas.renderAll();

        } else if (toAdd) {
            let center = toAdd.getCenterPoint();
            this._focus(center.x, center.y);
            await sleep(150); //let user to orient where canvas moved before deleting the element
            canvas.add(toAdd);
            this._context.canvas().setActiveObject(toAdd);
            canvas.renderAll();
            this._addToBoard(toAdd);
        }
    },

    _findObjectOnCanvasById: function (id) {
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
}