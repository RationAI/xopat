//todo move some func up if could be used (e.g. annotation name extraction etc.)
OSDAnnotations.History = class {
    /**
     * Create a history annotation manager
     * @param {string} selfName name of the property 'self' in parent
     * @param {OSDAnnotations} context
     * @param {OSDAnnotations.PresetManager} presetManager
     */
    constructor(selfName, context, presetManager) {
        //js code strings to execute on html node events
        this._globalContext = 'OSDAnnotations.instance()';
        this.__self = `${this._globalContext}.${selfName}`;
        this._globalSelf = this.__self;
        this._canvasFocus = '';

        this._buffer = [];
        // points to the current state in the redo/undo index in circular buffer
        this._buffidx = -1;
        // points to the most recent object in cache, when undo action comes full loop to _lastValidIndex
        // it means the redo action went full circle on the buffer, and we cannot further undo,
        // if we set this index to buffindex, we throw away ability to redo (diverging future)
        this._lastValidIndex = -1;

        this.BUFFER_LENGTH = null;
        this._autoIncrement = 0;
        this._boardSelected = null;
        this._context = context;
        this._presets = presetManager;
        this.containerId = "history-board-for-annotations";
        this._focusWithScreen = true;
        this._autoDomRenderer = null;
        this._lastOpenedInDetachedWindow = false;

        this._context.addHandler('annotation-preset-change', e => {
            this._refreshBoardItem(e.object);
        });
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
     * Set ability to auto-change the history ui position (detached / contained)
     * @param {function} renderer function that acts like an event - receives history reference
     *      and should attach the history HTML where desired
     * @param maxHeight maxHeight css property
     */
    setAutoOpenDOMRenderer(renderer, maxHeight="auto") {
        this._autoDomRenderer = renderer;
        this._maxHeight = maxHeight;
    }

    /**
     * Open external menu window with the history toolbox
     * focuses window if already opened.
     * @param {function} renderer function that acts like an event - receives history reference
     *      and should attach the history HTML where desired
     */
    openHistoryWindow(renderer=undefined) {

        if (renderer) {
            //preventive
            this.destroyHistoryWindow();
            this._lastOpenedInDetachedWindow = false;
            this._globalSelf = this.__self;
            this._canvasFocus = '';
            renderer(this, this.containerId);
            this._syncLoad();
        } else {
            let ctx = this._getDetachedWindow();
            if (ctx) {
                ctx.window.focus();
                return;
            }

            this.destroyHistoryWindow();
            this._lastOpenedInDetachedWindow = true;
            this._globalSelf = `opener.${this.__self}`;
            this._canvasFocus = 'window.opener.focus();';

            Dialogs.showCustomModal(this.containerId, "Annotations Board", this.getHistoryWindowHeadHtml(),
                `${this.getHistoryWindowBodyHtml()}
<script>
window.addEventListener('load', (e) => {
    ${this._globalSelf}._syncLoad();
});

document.addEventListener('keydown', (e) => {
    const parentContext = opener.${this._globalContext};  
    opener.focus();
    e.focusCanvas = true; //fake focus
    parentContext._keyDownHandler(e);
});

document.addEventListener('keyup', (e) => {
    const parentContext = opener.${this._globalContext};  
    e.focusCanvas = true; //fake focus
    parentContext._keyUpHandler(e);
});

//refresh/close: reset mode
window.addEventListener("beforeunload", (e) => {
    const parentContext = ${this._globalSelf}; 
    if (parentContext._editSelection) {
        parentContext._boardItemSave();
    }
}, false);
</script>`);
        }

        let active = this._context.canvas.getActiveObject();
        if (active && renderer) {  // do not call highlight inside detached window, handled by _syncLoad
            this.highlight(active);
        }
        this._context.raiseEvent('history-open', {
            inNewWindow: !renderer,
            containerId: this.containerId,
        });
    }

    /**
     * Reopen the history window in the other context, open if not opened
     */
    swapHistoryWindowLocation() {
        const willOpenNewWindow = !this._lastOpenedInDetachedWindow;
        if (willOpenNewWindow) {
            this._context.raiseEvent('before-history-swap', {
                inNewWindow: true,
            });
            this.openHistoryWindow(undefined);
        } else {
            if (!this._autoDomRenderer) {
                console.error("History window cannot be swapped when auto target ID has not been set or is invalid!");
                return;
            }
            this._context.raiseEvent('before-history-swap', {
                inNewWindow: false,
            });
            this.openHistoryWindow(this._autoDomRenderer);
        }
        this._context.raiseEvent('history-swap', {
            inNewWindow: willOpenNewWindow,
        });
    }

    /**
     * Programmatically close the board window
     */
    destroyHistoryWindow() {
        if (this._lastOpenedInDetachedWindow) {
            if (!Dialogs.closeWindow(this.containerId)) {
                return;
            }
        } else {
            let node = document.getElementById(this.containerId);
            if (node) {
                if (this._editSelection) this._boardItemSave();
                node.remove();
            } else {
                return;
            }
        }
        this._context.raiseEvent('history-close', {
            inNewWindow: this._lastOpenedInDetachedWindow,
        });
    }

    getWindowSwapButtonHtml(rightOffsetIndex=0) {
        return this._autoDomRenderer ? `<span id="history-swap-display" class="material-icons btn-pointer 
position-absolute right-${rightOffsetIndex} top-0 text-small" style="width: 22px; z-index: 99;"
onclick="${this._globalSelf}.swapHistoryWindowLocation()" id="history-refresh" 
title="Refresh board (fix inconsistencies).">${this._lastOpenedInDetachedWindow ? "open_in_new_off" : "open_in_new_down"}</span>` : "";
    }

    getHistoryWindowBodyHtml() {
        return `<div id="history-board-for-annotations-body" class="inner-panel px-0 py-2" style="flex-grow: 3; 
${this._lastOpenedInDetachedWindow ? '' : 'overflow-y: auto; max-height: ' + this._maxHeight}">
<div id="annotation-logs" class="height-full" style="cursor:pointer;"></div></div></div>`;
    }

    getHistoryWindowHeadHtml() {
        let redoCss = this.canRedo() ?
            "color: var(--color-icon-primary);" : "color: var(--color-icon-tertiary);";
        let undoCss = this.canUndo() ?
            "color: var(--color-icon-primary);" : "color: var(--color-icon-tertiary);";

        return `<span class="f3 mr-2" style="line-height: 16px; vertical-align: text-bottom;">Annotation List</span> 
<span id="history-undo" class="material-icons btn-pointer" style="${undoCss}" onclick="${this._globalSelf}.back()">undo</span>
<span id="history-redo" class="material-icons btn-pointer" style="${redoCss}" onclick="${this._globalSelf}.redo()">redo</span>
<span id="history-refresh" class="material-icons btn-pointer" onclick="${this._globalSelf}.refresh()" 
title="Refresh board (fix inconsistencies).">refresh</span>
${this.getWindowSwapButtonHtml()}
<!--todo does not work<button class="btn btn-danger mr-2 position-absolute right-2 top-2" type="button" aria-pressed="false" 
onclick="if (${this._globalSelf}._context.disabledInteraction || !window.confirm('Do you really want to delete all annotations?')) return; ${this._canvasFocus} 
${this._globalSelf}._context.deleteAllAnnotations()" id="delete-all-annotations">Delete All</button>-->
`;
    }

    /**
     * Get current board window context reference
     * @return {(Window|undefined|null)} current window if opened, or undefined/null otherwise
     */
    winContext() {
        return this._lastOpenedInDetachedWindow ? this._getDetachedWindow() : window;
    }

    /**
     * Check if undo is possible
     * @return {boolean}
     */
    canUndo() {
        return !! this._buffer[this._buffidx];
    }

    /**
     * Check if redo is possible
     * @return {boolean}
     */
    canRedo() {
        return this._lastValidIndex >= 0 && this._buffidx !== this._lastValidIndex;
    }

    /**
     * Iterate over cached objects, not necessarily visible
     * @param callback
     * @param nonActiveOnly if true, only non-visible annotations in cache are iterated
     */
    forEachHistoryCacheObject(callback, nonActiveOnly=false) {
        //TODO possibly optimize by leaving out annotations not on canvas & also implement timeout
        for (let cache of this._buffer) {
            if (!cache) continue;
            cache.forward && callback(cache.forward);
            cache.back && callback(cache.back);
        }
    }

    /**
     * Go step back in the history. Focuses the undo operation, updates window if opened.
     */
    back() {
        if (this._context.disabledInteraction) return;

        if (this.canUndo()) {
            this._performSwap(this._context.canvas, this._buffer[this._buffidx].back,
                this._buffer[this._buffidx].forward, true, true);

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
            this._context.raiseEvent('history-change');
        }

        this._performAtJQNode("history-undo", node => node.css("color",
            this.canUndo() ? "var(--color-icon-primary)" : "var(--color-icon-tertiary)")
        );
    }

    /**
     * Go step forward in the history. Focuses the redo operation, updates window if opened.
     */
    redo() {
        if (this._context.disabledInteraction) return;

        if (this.canRedo()) {
            this._buffidx = (this._buffidx + 1) % this.BUFFER_LENGTH;

            this._performSwap(this._context.canvas, this._buffer[this._buffidx].forward,
                this._buffer[this._buffidx].back, true, true);

            this._performAtJQNode("history-redo", node => node.css("color",
                this.canRedo() ? "var(--color-icon-primary)" : "var(--color-icon-tertiary)")
            );
            this._performAtJQNode("history-undo", node => node.css("color", "var(--color-icon-primary)"));
            this._context.raiseEvent('history-change');
        }
    }

    _annotationVisible(object) {
        if (!object) return false;
        let image = VIEWER.scalebar.getReferencedTiledImage(),
            tl = image.imageToWindowCoordinates(new OpenSeadragon.Point(object.left, object.top)),
            br = image.imageToWindowCoordinates(new OpenSeadragon.Point(object.left + object.width,
                object.top + object.height));
        let windowHeight = window.innerHeight || document.documentElement.clientHeight;
        let windowWidth  = window.innerWidth || document.documentElement.clientWidth;
        return (tl.x >= 0 && br.x <= windowWidth) && (tl.y >= 0 && br.y <= windowHeight);
    }

    /**
     * Refreshes window content (fix inconsistencies)
     */
    refresh() {
        if (this._context.disabledInteraction) return;

        this._performAtJQNode("annotation-logs", node => node.html(""));
        this._context.canvas.getObjects().forEach(o => {
            if (this._context.isAnnotation(o) && this._context.updateSingleAnnotationVisuals(o)) {
                this._addToBoard(o);
            }
        });
    }

    /**
     * Add new event to the history, at least one object should be specified
     * @param {object|undefined} newObject, if undefined it is deletion (no new object)
     * @param {object|undefined} previous, if undefined it is creation (no old object)
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
        this._context.raiseEvent('history-change');
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
                let ctx = this.winContext()
                if (this._lastOpenedInDetachedWindow) {
                    if (bounds.top < 0 || bounds.bottom > (ctx.innerHeight || ctx.document.documentElement.clientHeight)) {
                        board.parents("#window-content").scrollTo(node, 150, {offset: -20});
                    }
                } else {
                    let parent = ctx && ctx.document && ctx.document.getElementById(this.containerId + "-body");
                    if (parent) {
                        let parentBounds = parent.getBoundingClientRect();
                        if (bounds.top < parentBounds.top || bounds.bottom > parentBounds.bottom) {
                            $(parent).scrollTo(node, 150, {offset: -20});
                        }
                    }
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

    /**
     * Get modal window context reference
     * @return {(Window|undefined|null)} current window if opened, or undefined/null otherwise
     */
    _getDetachedWindow() {
        return Dialogs.getModalContext(this.containerId);
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

        let active = this._context.canvas.getActiveObject();
        if (active) {
            this.highlight(active);
        }
    }

    _focus(bbox, incrementId = undefined, adjustZoom=true) {
        bbox.left = Number.parseFloat(bbox.left || bbox.x);
        bbox.top = Number.parseFloat(bbox.top || bbox.y);

        let targetObj = undefined;
        if (incrementId !== undefined) {
            targetObj = this._context.findObjectOnCanvasByIncrementId(incrementId);
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
            //show such that the annotation would fit on the screen 4 times
            let offX = bbox.width,
                offY = bbox.height;
            let target = VIEWER.scalebar.getReferencedTiledImage().imageToViewportRectangle(bbox.left-offX*2,
                bbox.top-offY*2, bbox.width+offX*4, bbox.height+offY*4);

            VIEWER.tools.focus({bounds: target});
        } else {
            let cx = bbox.left + bbox.width / 4, cy = bbox.top + bbox.height / 4;
            let target = VIEWER.scalebar.getReferencedTiledImage().imageToViewportCoordinates(new OpenSeadragon.Point(cx, cy));
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
            if (!header) return; //todo test window mode hidden why it gets here ctx should be null
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

    _clickBoardElement(bbox, incrementId, pointerEvent) {
        if (pointerEvent.isPrimary || pointerEvent.button === 0) this._focus(bbox, incrementId);
        this._context.raiseEvent('history-select', {incrementId: incrementId, originalEvent: pointerEvent});
    }

    _refreshBoardItem(object) {
        this._addToBoard(object, object);
        this.highlight(object);
    }

    _addToBoard(object, replaced=undefined) {
        let desc, inputs = [];
        let factory = this._context.getAnnotationObjectFactory(object.factoryID);
        let icon = factory ? factory.getIcon() : "question_mark";

        if (!object.hasOwnProperty("incrementId")) {
            object.incrementId = this._autoIncrement++;
        }

        // Commented ability to edit
        // let preset = this._context.presets.get(object.presetID), color = 'black';
        // if (preset) {
        //     color = preset.color;
        //     for (let key in preset.meta) {
        //         let metaElement = preset.meta[key];
        //         if (key === "category") {
        //             inputs.unshift('<span class="show-hint d-block px-2 py-1" data-hint="', metaElement.name,
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
        let color = this._context.getAnnotationColor(object),
            mainRowContent = this._context.getDefaultAnnotationName(object, false),
            name = this._context.getAnnotationDescription(object, "category", true);

        mainRowContent = mainRowContent ? (mainRowContent + " " + object.incrementId) : '';

        let area = factory.getArea(object);
        if (area) {
            mainRowContent += `<span class="float-right">Area ${VIEWER.scalebar.imageAreaToGivenUnits(area)}</span>`;
        }
        inputs.push(`<span class="show-hint d-block px-2 py-1" data-hint="${name||'unknown'}">${mainRowContent}</span>`);
        // else {  //never happens: description shows at least default description
        //     //with no meta name, object will receive 'category' on edit
        //     inputs.push('<label class="show-hint d-block" data-hint="Name">',
        //         '<input type="text" class="form-control border-0 width-full" readonly ',
        //         'style="background:transparent;color: inherit;" value="',
        //         this._context.getDefaultAnnotationName(object), '" name="category"></label>');
        // }

        const _this = this;
        const focusBox = this._getFocusBBoxAsString(object, factory);
        const editable = false; //todo: temporarily disabled factory.isEditable();
        const editIcon = editable ? `<span class="material-icons btn-pointer v-align-top mt-1" id="edit-log-object-${object.incrementId}"
title="Edit annotation (disables navigation)" onclick="if (this.innerText === 'edit') {
${_this._globalSelf}._boardItemEdit(this, ${focusBox}, ${object.incrementId}); } 
else { ${_this._globalSelf}._boardItemSave(); } return false;">edit</span>` : '';
        const html = `
<div id="log-object-${object.incrementId}" class="rounded-2" data-order="${object.internalID}"
onclick="${_this._globalSelf}._clickBoardElement(${focusBox}, ${object.incrementId}, event);"
oncontextmenu="${_this._globalSelf}._clickBoardElement(${focusBox}, ${object.incrementId}, event); return false;">
<span class="material-icons" style="vertical-align:sub;color: ${color}">${icon}</span> 
<div style="width: calc(100% - 80px); " class="d-inline-block">${inputs.join("")}</div>
${editIcon}
</div>`;


        const newPosition = object.internalID;
        function insertAt(containerRef, newObjectRef) {
            let inserted = false;
            containerRef.children('.item').each(function() {
                const current = $(this);
                const currentOrder = current.data('order');

                if (newPosition < currentOrder) {
                    // Insert before the current element
                    newObjectRef.insertBefore(current);
                    inserted = true;
                    return false; // Exit the loop
                }
            });
            if (!inserted) {
                containerRef.prepend(newObjectRef);
            }
        }

        if (typeof replaced === "object" && !isNaN(replaced?.incrementId)) {
            this._performAtJQNode(`log-object-${replaced.incrementId}`, node => {
                if (node.length) {
                    node.replaceWith(html);
                } else {
                    _this._performAtJQNode("annotation-logs", node => insertAt(node, $(html)));
                }
            });
        } else {
            this._performAtJQNode("annotation-logs", node => insertAt(node, $(html)));
        }
    }

    _boardItemEdit(self, focusBBox, object) {
        let updateUI = false;
        if (this._editSelection) {
            this._boardItemSave(true);
        } else {
            updateUI = true;
        }
        this._focusWithScreen = false;

        let incrementId;
        if (typeof object !== "object") {
            incrementId = object;
            object = this._focus(focusBBox, incrementId) || this._context.canvas.getActiveObject();
        } else {
            incrementId = object.incrementId;
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
                    incrementId: incrementId,
                    self: self,
                    target: object
                };

                this._context.raiseEvent('annotation-edit', {object});

            } else {
                //if no update needed we are in blocked state, unblock since no edit
                if (!updateUI) this._enableAfterEdit();
            }

        } else {
            this._context.raiseEvent('warn-system', {
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
            let obj = this._editSelection.target || this._context.findObjectOnCanvasByIncrementId(this._editSelection.incrementId);
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
        this._focusWithScreen = true;
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

    async _performSwap(canvas, toAdd, toRemove, withFocus=true, focusOnlyIfNecessary=false) {
        if (toAdd) {
            canvas.add(toAdd);
            this._addToBoard(toAdd, toRemove);
            if (withFocus) {
                if (focusOnlyIfNecessary && this._annotationVisible(toAdd)) {
                    this.highlight(toAdd);
                } else {
                    this._focus(this._getFocusBBox(toAdd), undefined, !focusOnlyIfNecessary);
                    await this._sleep(150); //let user to orient where canvas moved before deleting the element
                }
            }
            if (toRemove) {
                canvas.remove(toRemove);
                this._context.raiseEvent('annotation-delete', {object: toRemove});
            }
            canvas.setActiveObject(toAdd);
            this._context.raiseEvent('annotation-create', {object: toAdd});
        } else if (toRemove) {
            if (withFocus && (!focusOnlyIfNecessary || !this._annotationVisible(toRemove))) {
                this._focus(this._getFocusBBox(toRemove), undefined, !focusOnlyIfNecessary);
                await this._sleep(150); //let user to orient where canvas moved before deleting the element
            }
            canvas.remove(toRemove);
            this._removeFromBoard(toRemove);
            this._context.raiseEvent('annotation-delete', {object: toRemove});
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
};
