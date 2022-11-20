//todo move some func up if could be used (e.g. annotation name extraction etc.)
OSDAnnotations.History = class {
    /**
     * Create a history annotation manager
     * @param {string} selfName name of the property 'self' in parent
     * @param {OSDAnnotations} context
     * @param {OSDAnnotations.PresetManager} presetManager
     */
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
        this._focusWithScreen = true;
    }

    /**
     * Set the number of steps possible to go in the past
     * @param {number} value size of the history
     */
    set size(value) {
        this.BUFFER_LENGTH = Math.max(2, value);
    }

    set focusWithZoom(value) {
        this._focusWithScreen = value;
    }

    /**
     * Open external menu window with the history toolbox
     * focuses window if already opened.
     */
    openHistoryWindow() {
        let ctx = this.winContext();
        if (ctx) {
            ctx.window.focus();
            return;
        }

        let undoCss = this._context.canvas.getObjects().length > 0 ?
            "color: var(--color-icon-primary);" : "color: var(--color-icon-tertiary);";

        Dialogs.showCustomModal(this.containerId, "Annotations Board",
            `<span class="f3 mr-2" style="line-height: 16px; vertical-align: text-bottom;">Board</span> 
<span id="history-undo" class="material-icons btn-pointer" style="${undoCss}" 
onclick="opener.${this._globalSelf}.back()" id="history-undo">undo</span>
<span id="history-redo" class="material-icons btn-pointer" style="color: var(--color-icon-tertiary);" 
onclick="opener.${this._globalSelf}.redo()" id="history-redo">redo</span>
<span id="history-refresh" class="material-icons btn-pointer" onclick="opener.${this._globalSelf}.refresh()" 
id="history-refresh" title="Refresh board (fix inconsistencies).">refresh</span>
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
    e.focusCanvas = true; //fake focus
    parentContext._keyDownHandler(e);
});

document.addEventListener('keyup', (e) => {
    const parentContext = opener.${this._context.id};  
    e.focusCanvas = true; //fake focus
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

    /**
     * Get current window context reference
     * @return {window || undefined || null} current window if opened, or undefined/null otherwise
     */
    winContext() {
        return Dialogs.getModalContext(this.containerId);
    }

    /**
     * Go step back in the history. Focuses the undo operation, updates window if opened.
     */
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

    /**
     * Go step forward in the history. Focuses the redo operation, updates window if opened.
     */
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

    /**
     * Refreshes window content (fix inconsistencies)
     */
    refresh() {
        if (this._context.disabledInteraction) return;

        this._performAtJQNode("annotation-logs", node => node.html(""));
        let _this = this;
        this._context.canvas.getObjects().forEach(o => {
            if (!isNaN(o.incrementId)) {
                let preset = this._presets.get(o.presetID);
                if (preset) this._presets.updateObjectVisuals(o, preset);
                _this._addToBoard(o);
            }
        });
    }

    /**
     * Add new event to the history, at least one object should be specified
     * @param {object || undefined} newObject, if undefined it is deletion (no new object)
     * @param {object || undefined} previous, if undefined it is creation (no old object)
     */
    push(newObject, previous = undefined) {
        UTILITIES.setDirty();
        if (newObject) {
            this._addToBoard(newObject, previous);
            this.highlight(newObject);
        } else if (previous) {
            this._removeFromBoard(previous);
        }

        this._buffidx = (this._buffidx + 1) % this.BUFFER_LENGTH;
        this._buffer[this._buffidx] = { forward: newObject, back: previous };
        this._lastValidIndex = this._buffidx; //new object creation overiddes history

        this._performAtJQNode("history-undo", node => node.css("color", "var(--color-icon-primary)"));
        this._performAtJQNode("history-redo", node => node.css("color", "var(--color-icon-tertiary)"));
    }

    /**
     * Focus object - updates viewport and UI highlight
     * @param {object} object fabricjs object to highlight
     */
    highlight(object) {
        let ctx = this.winContext();
        if (!ctx) return;
        let board = $(ctx.document.getElementById("annotation-logs"));

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
            if (node[0]) {
                let bounds = node[0].getBoundingClientRect();
                let ctx = this.winContext();
                if (bounds.top < 0 || bounds.bottom > (ctx.innerHeight || ctx.document.documentElement.clientHeight)) {
                    board.parents("#window-content").scrollTo(node, 150, {offset: -20});
                }
            }
        }
        this._boardSelected = object;
    }

    /**
     * Check whether an edit operation is in progress
     * @param {fabric.Object} ofObject fabricjs object
     * @return {boolean} true if currently editing
     */
    isOngoingEditOf(ofObject) {
        return this._editSelection && this._editSelection.incrementId === ofObject.incrementId;
    }

    /**
     * Start edit object, a bit unsafe (maybe remove) - no save action
     * is available (UI takes care of it), however, it could happen
     * that the window is closed and the client gets stuck...
     * @param {object} object fabricjs object
     */
    itemEdit(object) {
        let node = this._getNode(`edit-log-object-${object.incrementId}`);
        if (node) {
            let bbox = this._getFocusBBox(object);
            this._boardItemEdit(node, bbox, object);
        }
    }

    assignIDs(objects) {
        for (let object of objects) {
            if (!object.hasOwnProperty("incrementId")) {
                object.incrementId = this._autoIncrement++;
            }
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

    _syncLoad() {
        let _this = this;
        //todo sort by incrementId?
        this._context.canvas.getObjects().some(o => {
            if (o.presetID && o.factoryID) {
                if (!o.incrementId || isNaN(o.incrementId)) {
                    o.incrementId = _this._autoIncrement++;
                }
                _this._addToBoard(o);
            } else if (o.incrementId && !isNaN(o.incrementId)) {
                _this._addToBoard(o);
            }
            return false;
        });
    }

    _focus(bbox, objectId = undefined, adjustZoom=true) {
        bbox.left = Number.parseFloat(bbox.left || bbox.x);
        bbox.top = Number.parseFloat(bbox.top || bbox.y);

        let targetObj = undefined;
        if (objectId !== undefined) {
            targetObj = this._findObjectOnCanvasById(objectId);
            if (targetObj) {
                this.highlight(targetObj);
                this._context.canvas.setActiveObject(targetObj);

                if (!Number.isFinite(bbox.left) || !Number.isFinite(bbox.top)) {
                    console.warn("Annotation focus BBOX undefined: try to recompute.");
                    bbox = targetObj.getBoundingRect(true, true);
                }
            }
        }

        if (!this._focusWithScreen || !Number.isFinite(bbox.left) || !Number.isFinite(bbox.top)) {
            return;
        }

        if (adjustZoom && bbox.width > 0 && bbox.height > 0) {
            //show such that the annotation would fit on the screen three times
            let offX = bbox.width,
                offY = bbox.height;
            let target = VIEWER.tools.referencedTiledImage().imageToViewportRectangle(bbox.left-offX*1.5,
                bbox.top-offY*1.5, bbox.width+offX*3, bbox.height+offY*3);

            VIEWER.tools.focus({bounds: target});
        } else {
            let cx = bbox.left + bbox.width / 2, cy = bbox.top + bbox.height / 2;
            let target = VIEWER.tools.referencedTiledImage().imageToViewportCoordinates(new OpenSeadragon.Point(cx, cy));
            VIEWER.viewport.panTo(target, false);
            VIEWER.viewport.applyConstraints();
        }

        return targetObj;
    }

    _updateBoardText(object, text) {
        if (!text || text.length < 0) text = this._context.getDefaultAnnotationName(object);
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
            let header = ctx.document.getElementById("window-header");
            if (enabled) {
                ctx.document.body.style.background = "transparent";
                header.readonly = false; this._context.canvas.renderAll()
                header.style.filter = "none";
            } else {
                ctx.document.body.style.background = "#eb7777";
                header.readonly = true;
                header.style.filter = "contrast(0.5)";
            }
        }
    }

    _addToBoard(object, replaced=undefined) {
        let desc, inputs = [];
        let factory = this._context.getAnnotationObjectFactory(object.factoryID);
        let icon = factory ? factory.getIcon() : "question_mark";

        if (!object.hasOwnProperty("incrementId")) {
            object.incrementId = this._autoIncrement++;
        }

        // let preset = this._context.presets.get(object.presetID), color = 'black';
        // if (preset) {
        //     color = preset.color;
        //     for (let key in preset.meta) {
        //         let metaElement = preset.meta[key];
        //         if (key === "category") {
        //             inputs.unshift('<span class="show-hint d-block p-2" data-hint="', metaElement.name,
        //                 '">', metaElement.value || this._context.getDefaultAnnotationName(object), '</span>');
        //         } else {
        //             // from user-testing: disabled change of properties in the board...
        //
        //             //let objmeta = object.meta || {};
        //             // inputs.push('<label class="show-hint d-block" data-hint="', metaElement.name,
        //             //     '"><input type="text" class="form-control border-0 width-full" readonly ',
        //             //     'style="background:transparent;color: inherit;" value="', objmeta[key] ?? metaElement.value,
        //             //     '" name="', key, '"></label>');
        //         }
        //     }
        // }
        let color = this._context.getAnnotationColor(object);
        let name = this._context.getAnnotationDescription(object, "category", true);
        // if (name) {
        //     inputs.push('<span class="show-hint d-block p-2" data-hint="Category">',
        //         name || this._context.getDefaultAnnotationName(object), '</span>');
        // } else {
            //with no meta name, object will receive 'category' on edit
            inputs.push('<label class="show-hint d-block" data-hint="Category">',
                '<input type="text" class="form-control border-0 width-full" readonly ',
                'style="background:transparent;color: inherit;" value="',
                this._context.getDefaultAnnotationName(object), '" name="category"></label>');
        // }

        const _this = this;
        const focusBox = this._getFocusBBoxAsString(object, factory);
        const editIcon = factory.isEditable() ? `<span class="material-icons btn-pointer v-align-top mt-1" id="edit-log-object-${object.incrementId}"
title="Edit annotation (disables navigation)" onclick="let self = $(this); if (self.html() === 'edit') {
opener.${_this._globalSelf}._boardItemEdit(self, ${focusBox}, ${object.incrementId}); } 
else { opener.${_this._globalSelf}._boardItemSave(); } return false;">edit</span>` : '';
        const html = `
<div id="log-object-${object.incrementId}" class="rounded-2"
onclick="opener.${_this._globalSelf}._focus(${focusBox}, ${object.incrementId});">
<span class="material-icons" style="vertical-align:sub;color: ${color}">${icon}</span> 
<div style="width: calc(100% - 80px); " class="d-inline-block">${inputs.join("")}</div>
${editIcon}
</div>`;

        if (typeof replaced === "object" && replaced?.incrementId) {
            this._performAtJQNode(`log-object-${replaced.incrementId}`, node => {
                if (node.length) {
                    node.replaceWith(html);
                } else {
                    _this._performAtJQNode("annotation-logs", node => node.prepend(html));
                }
            });
        } else {
            this._performAtJQNode("annotation-logs", node => node.prepend(html));
        }
    }

    _boardItemEdit(self, focusBBox, object) {
        let updateUI = false;
        if (this._editSelection) {
            this._boardItemSave(true);
        } else {
            updateUI = true;
        }

        let objectId;
        if (typeof object !== "object") {
            objectId = object;
            object = this._focus(focusBBox, objectId) || this._context.canvas.getActiveObject();
        } else {
            objectId = object.incrementId;
        }

        if (object) {
            let factory = this._context.getAnnotationObjectFactory(object.factoryID);

            if (factory && factory.isEditable()) {
                factory.edit(object);
                if (updateUI) this._disableForEdit();

                self.parent().find("input").each((e, t) => {
                    $(t).removeAttr('readonly');
                });
                self.html('save');

                this._editSelection = {
                    incrementId: objectId,
                    self: self,
                    target: object
                };
            } else {
                //if no update needed we are in blocked state, unblock since no edit
                if (!updateUI) this._enableAfterEdit();
            }

        } else {
            VIEWER.raiseEvent('warn-system', {
                originType: "module",
                originId: "annotations",
                code: "E_NO_OBJECT_ON_EDIT",
                message: "Attempt to edit undefined object.",
            });
        }
    }

    _boardItemSave(switches=false) {
        if (!this._editSelection) return;

        try {
            let obj = this._editSelection.target || this._findObjectOnCanvasById(this._editSelection.incrementId);
            let self = this._editSelection.self,
            //from user testing: disable modification of meta?
                inputs = self.parent().find("input"),
                preset = this._context.presets.get(obj.presetID),
                metadata = preset ? preset.meta : {};
            if (obj) {
                if (!obj.meta) obj.meta = {};
                inputs.each((e, t) => {
                    if (!metadata[t.name] || metadata[t.name].value != t.value) {
                        obj.meta[t.name] = t.value;
                    }
                    $(t).attr('readonly', "true");
                });

                //if target was set, object could have been edited, update
                let factory = this._context.getAnnotationObjectFactory(obj.factoryID);
                factory.recalculate(obj);
            } else {
                console.warn("Failed to update object: could not find object with id "
                    + this._editSelection.incrementId);
                inputs.each((e, t) => t.readonly = true);
            }
            self.html('edit');

            if (!switches) this._enableAfterEdit();
        } catch (e) {
            console.warn(e);
        }
        this._editSelection = undefined;
    }

    _enableAfterEdit() {
        $('#bord-for-annotations .Box-header').css('background', 'none');
        this._context.setMouseOSDInteractive(true);
        this._context.enableInteraction(true);
    }

    _disableForEdit() {
        $('#bord-for-annotations .Box-header').css('background', 'var(--color-merge-box-error-indicator-bg)');
        this._context.setMouseOSDInteractive(false);
        this._context.enableInteraction(false);
    }

    async _performSwap(canvas, toAdd, toRemove) {
        if (toAdd) {
            this._focus(this._getFocusBBox(toAdd));
            await this._sleep(150); //let user to orient where canvas moved before deleting the element
            canvas.add(toAdd);
            this._addToBoard(toAdd, toRemove);

            // if (toRemove) {
            //     canvas.remove(toRemove);
            //     this._removeFromBoard(toRemove);
            // }
            this._context.canvas.setActiveObject(toAdd);
        } else if (toRemove) {
            this._focus(this._getFocusBBox(toRemove));
            await this._sleep(150); //let user to orient where canvas moved before deleting the element
            canvas.remove(toRemove);
            this._removeFromBoard(toRemove);
        }
        canvas.renderAll();
    }

    _getFocusBBox(of, factory) {
        factory = factory || this._context.getAnnotationObjectFactory(of.factoryID);
        let bbox;
        if (factory) {
            bbox = factory.getObjectFocusZone(of);
        } else {
            let center = of.getCenterPoint();
            bbox = {left: center.x, top: center.y, width: 0, height: 0};
        }
        return bbox;
    }

    _getFocusBBoxAsString(of, factory) {
        let box = this._getFocusBBox(of, factory);
        return `{left: ${box.left},top: ${box.top},width: ${box.width},height: ${box.height}}`;
    }

    _findObjectOnCanvasById(id) {
        //todo fabric.js should have some way how to avoid linear iteration over all objects...
        let target = null;
        this._context.canvas.getObjects().some(o => {
            if (o.incrementId === id) {
                target = o;
                return true;
            }
            return false;
        });
        return target;
    }
};
