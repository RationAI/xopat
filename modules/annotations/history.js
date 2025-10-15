//todo move some func up if could be used (e.g. annotation name extraction etc.)
OSDAnnotations.AnnotationHistoryManager = class {
    /**
     * Create a history annotation manager
     * @param {string} selfName name of the property 'self' in parent
     * @param {OSDAnnotations} context
     * @param {OSDAnnotations.PresetManager} presetManager
     */
    constructor(selfName, context, presetManager) {
        //js code strings to execute on html node events
        this._globalContext = 'OSDAnnotations.instance()';
        this._ctx = this._globalContext;
        this.__self = `${this._globalContext}.${selfName}`;
        this._globalSelf = this.__self;
        this._globalHistory = `${this._globalContext}.history`;
        this._canvasFocus = '';

        this._autoIncrement = 0;
        this._labelIncrement = 0;
        this._layerLabelIncrement = 0;
        this._context = context;
        this._presets = presetManager;
        this.containerId = "history-board-for-annotations";
        this._focusWithScreen = true;
        this._autoDomRenderer = null;
        this._lastOpenedInDetachedWindow = false;
        this._boardItems = [];

        this._context.addHandler('layer-selection-changed', e => {
            this._updateSelectedLayersVisual(e.ids, e.isSelected);
        });
        this._context.addHandler('active-layer-changed', e => {
            this._updateActiveLayerVisual(e.id);
        });
        this._context.addHandler('annotation-selection-changed', e => {
            if (e.fromCanvas) this._syncSelectionFromCanvas(e.ids, e.isSelected);
            this._updateSelectedAnnotationsVisual(e.ids, e.isSelected);
        });
        this._context.addHandler('annotation-preset-change', e => {
            this._refreshBoardItem(e.object);
        });
    }

    set focusWithZoom(value) {
        this._focusWithScreen = value;
    }

    setHistoryState(canUndo, canRedo) {
        this._performAtJQNode("history-undo", node =>
            node.css("color", canUndo ? "var(--color-icon-primary)" : "var(--color-icon-tertiary)")
        );
        this._performAtJQNode("history-redo", node =>
            node.css("color", canRedo ? "var(--color-icon-primary)" : "var(--color-icon-tertiary)")
        );
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

    getLayerContainerId() {
        return `layer-logs`;
    }

    getLayerElementId(layerId) {
        return `log-layer-${layerId}`;
    }

    getAnnotationContainerId(layerId) {
        return `annotation-log-layer-${layerId}`;
    }

    getAnnotationElementId(label) {
        return `log-object-${label}`;
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
            this._globalHistory = `${this._globalContext}.history`;
            this._ctx = this._globalContext;
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
            this._globalHistory = `opener.${this._globalContext}.history`;
            this._ctx = `opener.${this._globalContext}`;
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
        return this._autoDomRenderer ? `<span id="history-swap-display" class="material-icons btn-pointer no-select
position-absolute right-${rightOffsetIndex} top-0 text-small" style="width: 22px; z-index: 99;"
onclick="${this._globalSelf}.swapHistoryWindowLocation()" id="history-refresh" 
title="Refresh board (fix inconsistencies).">${this._lastOpenedInDetachedWindow ? "open_in_new_off" : "open_in_new_down"}</span>` : "";
    }

    getHistoryWindowBodyHtml() {
        return `<div id="history-board-for-annotations-body" class="inner-panel px-0 py-2" style="flex-grow: 3;
${this._lastOpenedInDetachedWindow ? '' : 'overflow-y: auto; max-height: ' + this._maxHeight}">
<div id="layer-logs" class="height-full" style="cursor:pointer; padding-bottom:16px;"></div></div>`;
    }

    getHistoryWindowHeadHtml() {
        return `
        <style>
          .history-head-sep {
            display:inline-block;
            width:1px;
            height:18px;
            background: var(--color-border-muted,#ccc);
            margin:0 8px;
            vertical-align:middle;
          }
          .history-layer-menu {
            display:inline-flex;
            gap:6px;
            align-items:center;
            vertical-align:middle;
          }
          .history-layer-menu input {
            height:22px;
            padding:2px 4px;
            font-size:11px;
            width:80px;
          }
          .history-layer-menu .material-icons {
            font-size:20px;
          }
        
          /* Disable rounded corners in board (overrides .rounded-2) */
          #history-board-for-annotations-body .rounded-2,
          #history-board-for-annotations-body [data-type="layer"],
          #history-board-for-annotations-body [data-type="annotation"],
          #history-board-for-annotations-body [data-type="layer"] > .d-flex,
          #history-board-for-annotations-body [data-type="annotation"] > .d-flex {
            border-radius: 0 !important;
          }
        
          /* Layers */
          .history-selected[data-type="layer"] > .d-flex {
            background: rgba(60,180,90,0.18);
          }
          .history-selected[data-type="layer"] {
            border: 1px solid rgba(60,180,90,0.55);
            border-radius: 0; /* was 4px */
          }
          .history-layer-current {
            box-shadow: inset 0 0 0 1px rgba(60,180,90,0.85);
          }

          /* Annotations */
          .history-selected[data-type="annotation"] {
            background: rgba(60,180,90,0.18) !important;
            border: none;
            border-radius: 0; /* was 4px */
          }
         .annotation-arrows { opacity: 0; transition: opacity 0.15s; pointer-events: none; }
          #history-board-for-annotations-body [data-type="annotation"]:hover .annotation-arrows {
            opacity: 1; pointer-events: auto;
          }

          /* Indentation: indent items inside layer containers, not board-level */
          #history-board-for-annotations-body [id^="annotation-log-layer-"] {
            padding-left: 16px;
            min-height: 10px; /* enables drop into empty layer */
            border-left: 1px dashed transparent;
          }

          /* Hover targets for drop */
          #history-board-for-annotations-body [id^="annotation-log-layer-"].drop-hover {
            background: rgba(60,180,90,0.08);
            border-left-color: rgba(60,180,90,0.65);
          }
          #history-board-for-annotations-body #layer-logs.drop-hover {
            outline: 2px dashed rgba(60,180,90,0.5);
            outline-offset: -2px;
          }

          /* Drag visuals */
          .drag-ghost { opacity: 0.6; background: rgba(60,180,90,0.12); border: 1px dashed rgba(60,180,90,0.6); }
          .drag-chosen { box-shadow: inset 0 0 0 1px rgba(60,180,90,0.7); }
          .annotation-arrows { opacity: 0; transition: opacity 0.15s; pointer-events: none; }
          #history-board-for-annotations-body [data-type="annotation"]:hover .annotation-arrows {
            opacity: 1; pointer-events: auto;
          }
        </style>
        <span class="f3 mr-2" style="line-height:16px; vertical-align:middle;">Annotation List</span>

        <span class="history-head-sep"></span>

        <span class="history-layer-menu" title="Layer Menu">
          <span style="font-weight:600;">Layers:</span>
          <span class="material-icons btn-pointer no-select" id="history-create-layer" title="Create Layer"
                onclick="${this._ctx}.createLayer();">add_circle</span>
          <span class="material-icons btn-pointer no-select" id="history-delete-selection" title="Delete Selection"
                style="color: var(--color-icon-tertiary);"
                onclick="${this._ctx}.deleteSelection();">delete</span>
        </span>

        <span class="history-head-sep"></span>

        <span id="history-undo" class="material-icons btn-pointer no-select" style="color: var(--color-icon-tertiary);" onclick="${this._globalHistory}.undo()">undo</span>
        <span id="history-redo" class="material-icons btn-pointer no-select" style="color: var(--color-icon-tertiary);" onclick="${this._globalHistory}.redo()">redo</span>
        <span id="history-refresh" class="material-icons btn-pointer no-select" onclick="${this._globalSelf}.refresh()" 
              title="Refresh board (fix inconsistencies).">refresh</span>
        ${this.getWindowSwapButtonHtml()}
        `;
    }

    /**
     * Get current board window context reference
     * @return {(Window|undefined|null)} current window if opened, or undefined/null otherwise
     */
    winContext() {
        return this._lastOpenedInDetachedWindow ? this._getDetachedWindow() : window;
    }

    //_annotationVisible(object) {  // TODO: might not be needed anymore - need to check
    //    if (!object) return false;
    //    let image = VIEWER.scalebar.getReferencedTiledImage(),
    //        tl = image.imageToWindowCoordinates(new OpenSeadragon.Point(object.left, object.top)),
    //        br = image.imageToWindowCoordinates(new OpenSeadragon.Point(object.left + object.width,
    //            object.top + object.height));
    //    let windowHeight = window.innerHeight || document.documentElement.clientHeight;
    //    let windowWidth  = window.innerWidth || document.documentElement.clientWidth;
    //    return (tl.x >= 0 && br.x <= windowWidth) && (tl.y >= 0 && br.y <= windowHeight);
    //}

    /**
     * Refreshes window content (fix inconsistencies)
     */
    refresh() {
        if (this._context.disabledInteraction) return;

        this._performAtJQNode("layer-logs", node => node.html(""));

        for (const item of this._boardItems) {
            if (item.type === "layer") {
                const layer = this._context.getLayer(item.id);
                this.addLayerToBoard(layer);

                const layerObjects = layer.getObjects();
                for (const obj of layerObjects) {
                    this._refreshAnnotationInBoard(obj);
                }

            } else {
                const annotation = this._context.findObjectOnCanvasByIncrementId(item.id);
                if (annotation) this._refreshAnnotationInBoard(annotation);
            }
        }
    }

    _refreshAnnotationInBoard(annotation) {
        if (this._context.isAnnotation(annotation) && this._context.updateSingleAnnotationVisuals(annotation)) {
            this.addAnnotationToBoard(annotation);
        }
    }

    /**
    * Ensures the log entry for the given annotation is visible by scrolling
    * the annotation board if necessary. If an active selection is passed, the
    * first selected object is used as the scroll target.
    * @param {fabric.Object | fabric.ActiveSelection} object - Object or selection to bring into view.
    */
    highlight(object) {
        let ctx = this.winContext();
        if (!ctx || !object) return;
        let board = $(ctx.document.getElementById("layer-logs"));

        if (object.type === "activeSelection" && object._objects?.length) {
            object = object._objects[object._objects.length - 1];
        }
        if (!object || !object.hasOwnProperty("incrementId") || !object.hasOwnProperty("label")) return;

        if (object && board) {
            let node = board.find(`#log-object-${object.label}`);
            if (!node) {
                this.addAnnotationToBoard(object);
                node = board.find(`#log-object-${object.label}`);
            }

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
        let node = this._getNode(`edit-log-object-${object.label}`);
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
            
            if (!object.hasOwnProperty("label")) {
                object.label = this._labelIncrement++;
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
        this.refresh();

        let active = this._context.canvas.getActiveObject();
        if (active) {
            this.highlight(active);
        }

       this.initBoardSortable();
    }

    initBoardSortable() {
        const boardEl = this._getNode("layer-logs");
        if (!boardEl) return;
        if (boardEl._sortableInstance) boardEl._sortableInstance.destroy();

        boardEl._sortableInstance = new Sortable(boardEl, {
            group: {
                name: 'board',
                pull: true,
                put: (to, from, dragEl) => {
                    const type = dragEl.getAttribute('data-type');
                    return type === 'layer' || type === 'annotation';
                }
            },
            draggable: "[data-type='layer'], [data-type='annotation']",
            animation: 120,
            multiDrag: true,
            avoidImplicitDeselect: true,
            selectedClass: 'history-selected',
            filter: ".no-select",
            preventOnFilter: true,
            direction: 'vertical',
            emptyInsertThreshold: 8,
            scroll: true,
            bubbleScroll: true,
            scrollSensitivity: 30,
            scrollSpeed: 10,
            ghostClass: 'drag-ghost',
            chosenClass: 'drag-chosen',
            onFilter: (evt) => { evt?.preventDefault?.(); evt?.stopPropagation?.(); },
            onSelect: (evt) => {
                if (this._isSyncing) return;
                this._handleSelect(evt, boardEl);
            },
            onDeselect: (evt) => {
                if (this._isSyncing) return;
                this._handleDeselect(evt, boardEl);
            },
            onChoose: (evt) => {
                const item = evt.item;
                const type = item?.getAttribute('data-type');
                const id = item?.getAttribute('data-id');
                if (!type || !id || (type === 'annotation')) return;

                let layer = this._context.getLayer(Number(id));
                if (this._context.getSelectedLayerIds().includes(layer.id)) return;
                this._context.setActiveLayer(layer);
            },
            onStart: (evt) => {
                const item = evt.item;
                if (item?.getAttribute('data-type') === 'layer') {
                    const lid = item.getAttribute('data-id');
                    const content = this._getNode(`annotation-log-layer-${lid}`);
                    item._dndPrevExpanded = content ? (content.style.display !== 'none') : false;
                    this._setLayerCollapsed(lid, true);
                }
            },
            onMove: (evt) => {
                this._toggleDropHover(this._lastDropHover, false);
                this._lastDropHover = evt?.to;
                this._toggleDropHover(this._lastDropHover, true);
            },
            onAdd: (evt) => {},            
            onEnd: (evt) => {}
        });

        const s = Sortable.get(boardEl);
        if (s.multiDrag && s.multiDrag._deselectMultiDrag) {
            s.multiDrag._deselectMultiDrag = function() {};
        }
        this._setupContainerClearSelection(this._getNode("history-board-for-annotations"));
    }

    initLayerSortable(container) {
        if (!container) return;
        if (container._sortableInstance) container._sortableInstance.destroy();

        container._sortableInstance = new Sortable(container, {
            group: {
                name: 'layer',
                pull: true,
                put: (to, from, dragEl) => {
                    return dragEl.getAttribute('data-type') === 'annotation';
                }
            },
            draggable: "[data-type='annotation']",
            animation: 120,
            multiDrag: true,
            avoidImplicitDeselect: true,
            selectedClass: 'history-selected',
            filter: ".no-select",
            preventOnFilter: true,
            direction: 'vertical',
            emptyInsertThreshold: 8,
            scroll: true,
            bubbleScroll: true,
            scrollSensitivity: 30,
            scrollSpeed: 10,
            ghostClass: 'drag-ghost',
            chosenClass: 'drag-chosen',
            onFilter: (evt) => { evt?.preventDefault?.(); evt?.stopPropagation?.(); },
            onSelect: (evt) => {
                if (this._isSyncing) return;
                this._handleSelect(evt, container);
            },
            onDeselect: (evt) => {
                if (this._isSyncing) return;
                this._handleDeselect(evt, container);
            },
            onMove: (evt) => {
                this._toggleDropHover(this._lastDropHover, false);
                this._lastDropHover = evt?.to;
                this._toggleDropHover(this._lastDropHover, true);
            },
            onAdd: (evt) => {},
            onUpdate: (evt) => {},
            onEnd: (evt) => {}
        });

        const s = Sortable.get(container);
        if (s.multiDrag && s.multiDrag._deselectMultiDrag) {
            s.multiDrag._deselectMultiDrag = function() {};
        }
    }

    _handleBoardAction(type, id, action) {
        switch (action) {
            case 'select':
                if (type === 'layer') this._context.selectLayer(id);
                else if (type === 'annotation') this._context.selectAnnotation(id);
                break;

            case 'deselect':
                if (type === 'layer') this._context.deselectLayer(id);
                else if (type === 'annotation') this._context.deselectAnnotation(id);
                break;

            case 'clear':
                this._context.clearLayerSelection();
                this._context.clearAnnotationSelection();
                break;
        }
    }

    _handleSelect(evt, container) {
        const item = evt.item;
        const type = item?.getAttribute('data-type');
        const id = item?.getAttribute('data-id');
        if (!type || !id) return;

        const oe = evt.originalEvent;
        const isModifier = oe && (oe.ctrlKey || oe.shiftKey || oe.metaKey);

        if (!isModifier) {
            container.querySelectorAll('.history-selected').forEach(el => {
                if (el !== item) Sortable.utils.deselect(el);
            });
            this._handleBoardAction(null, null, 'clear');
            if (type === 'annotation') this._context.unsetActiveLayer();
        }

        this._handleBoardAction(type, Number(id), 'select');
    }

    _handleDeselect(evt, container) {
        const item = evt.item;
        const type = item?.getAttribute('data-type');
        const id = item?.getAttribute('data-id');
        if (!type || !id) return;

        const oe = evt.originalEvent;
        if (oe?.ctrlKey || oe?.metaKey) {
            this._handleBoardAction(type, Number(id), 'deselect');
            return;
        } else if (oe?.shiftKey) {
            return; // do nothing
        }

        container.querySelectorAll('.history-selected').forEach(el => {
            if (el !== item) Sortable.utils.deselect(el);
        });
        this._handleBoardAction(null, null, 'clear');
        this._context.unsetActiveLayer();
        Sortable.utils.select(item);
        if (type === 'layer') this._context.setActiveLayer(Number(id));

        this._handleBoardAction(type, Number(id), 'select');
    }

     _setupContainerClearSelection(container) {
        if (!container) return;
        if (container._clearSelHandler) {
            container.removeEventListener('pointerdown', container._clearSelHandler);
        }

        const shouldIgnore = (t) => {
            return !!t.closest('.no-select, input, textarea, select, button, [contenteditable="true"]');
        };

        const handler = (e) => {
            const t = e.target;
            const item = t.closest('[data-type="layer"], [data-type="annotation"]');
            if (item || shouldIgnore(t)) return;

            container.querySelectorAll('.history-selected').forEach(el => {
                Sortable.utils.deselect(el);
            });
            this._handleBoardAction(null, null, 'clear');
            this._context.unsetActiveLayer();
        };

        container._clearSelHandler = handler;
        container.addEventListener('pointerdown', handler);
    }

    _toggleDropHover(el, on) {
        if (!el) return;
        el.classList.toggle('drop-hover', !!on);
    }

    _setLayerCollapsed(layerID, collapsed) {
        const content = this._getNode(`annotation-log-layer-${layerID}`);
        const arrow = this._getNode(`toggle-arrow-${layerID}`);
        if (content) content.style.display = collapsed ? 'none' : 'block';
        if (arrow) arrow.innerText = collapsed ? 'chevron_right' : 'expand_more';
    }

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    moveAnnotationInBoard(annotationId, direction) {
        const oppositeDirection = direction === "up" ? "down" : "up";

        this._context.history.push(
			() => this._moveAnnotationInBoard(annotationId, direction),
			() => this._moveAnnotationInBoard(annotationId, oppositeDirection)
		);
    }

    _findAnnotationPosition(annotation) {
        if (!annotation.layerID) {
            const idx = this.getBoardIndex('annotation', annotation.incrementId);
            return { type: "board", idx };

        } else {
            const layerIdx = this.getBoardIndex('layer', annotation.layerID);
            const layer = this._context.getLayer(annotation.layerID);
            if (!layer) return null;

            return { type: "layer", layer, layerIdx };
        }
    }

    _moveAnnotationInBoard(annotationId, direction) {
        const annotation = this._context.findObjectOnCanvasByIncrementId(annotationId);
        if (!annotation) return;
        const pos = this._findAnnotationPosition(annotation);
        if (!pos) return;

        if (pos.type === 'board') {
            this._moveBoardAnnotation(annotation, pos, direction);
        } else {
            this._moveLayerAnnotation(annotation, pos, direction);
        }
    }

    _moveBoardAnnotation(annotation, pos, direction) {
        const newIdx = direction === "up" ? pos.idx - 1 : pos.idx + 1;
        if (newIdx < 0 || newIdx >= this._boardItems.length) return;

        const target = this._boardItems[newIdx];

        if (target.type === "layer") {
            const layer = this._context.getLayer(target.id);
            if (!layer) return;

            this.removeAnnotationFromBoard(annotation);
            annotation.layerID = layer.id;
            layer.addObject(annotation, direction === "up" ? undefined : 0);
            this._updateLayerHtml(layer.id);

        } else {
            [this._boardItems[pos.idx], this._boardItems[newIdx]] = [this._boardItems[newIdx], this._boardItems[pos.idx]];
            this.refresh();  // TODO - optimize later
        }
    }

    _moveLayerAnnotation(annotation, pos, direction) {
        const { layer, layerIdx } = pos;

        if (layer.swapAnnotation(annotation, direction)) {
            this._updateLayerHtml(layer.id);
            return;
        }

        layer.removeObject(annotation);
        this.removeAnnotationFromBoard(annotation);
        annotation.layerID = undefined;

        const insertAt = direction === "up" ? layerIdx : layerIdx + 1;
        this._boardItems.splice(insertAt, 0, { type: "annotation", id: annotation.incrementId });
        this.refresh();  //TODO - optimize later
    }

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    _focus(bbox, incrementId = undefined, adjustZoom=true) {
        bbox.left = Number.parseFloat(bbox.left || bbox.x);
        bbox.top = Number.parseFloat(bbox.top || bbox.y);

        let targetObj = undefined;
        if (incrementId !== undefined) {
            targetObj = this._context.findObjectOnCanvasByIncrementId(incrementId);
            if (targetObj) {
                this.highlight(targetObj);

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
        this._performAtJQNode("layer-logs", node =>
            node.find(`#log-object-${object.label} span.desc`).html(text));
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _removeFromBoard(containerId, objectSelector) {
        this._performAtJQNode(containerId, node => {
            node.find(objectSelector).remove()
        });      
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
        this.addAnnotationToBoard(object, object);
        this.highlight(object);
    }

    toggleLayerVisibility(layerID) {
        const layer = this._context.getLayer(layerID);
        if (!layer) {
            console.warn(`Layer with ID ${layerID} not found.`);
            return;
        }
    
        const isVisible = layer.visible;
        layer.toggleVisibility();

        const ctx = this.winContext();
        const iconElement = ctx.document.getElementById(`toggle-visibility-${layerID}`);
        if (iconElement) {
            iconElement.innerText = isVisible ? "visibility_off" : "visibility";
        }

        //this._context.removeHighlight();
        this._context.canvas.renderAll();
    }

    _updateAnnotationCount(layerId) {
        let layer = this._context.getLayer(layerId);
        if (!layer) return;

        const layerEl = this._getNode(this.getLayerElementId(layer.id));
        if (!layerEl) return

        const counterEl = layerEl.querySelector('.annotation-count');
        if (!counterEl) return;

        const count = layer.getAnnotationCount();
        counterEl.textContent = `${count} item${count === 1 ? '' : 's'}`;
    }

    _updateLayerHtml(layerId) {
        let layer = this._context.getLayer(layerId);
        if (!layer) return;
        
        this._performAtJQNode(this.getAnnotationContainerId(layer.id), node => node.html(""));
        let layerObjects = layer.getObjects();
        for (const obj of layerObjects) {
            this.addAnnotationToBoard(obj);
        }

        this._updateAnnotationCount(layerId);
    }

    renameLayerInline(layerID, evt) {
        if (evt) evt.stopPropagation();
        const layer = this._context.getLayer(layerID);
        if (!layer) return;

        const wrapper = this._getNode(this.getLayerElementId(layerID));
        if (!wrapper) return;
        const nameSpan = wrapper.querySelector('.layer-name-text');
        if (!nameSpan || nameSpan.getAttribute('data-editing') === '1') return;

        const current = layer.name || `Layer ${layer.label}`;
        nameSpan.setAttribute('data-editing', '1');
        nameSpan.innerHTML = `<input type="text" class="history-layer-rename-input" value="${current.replace(/"/g, '&quot;')}">`;
        const input = nameSpan.querySelector('input');

        input.style.width = '90px';
        input.style.maxWidth = '90px';
        input.style.fontSize = '11px';
        input.style.padding = '0 2px';
        input.style.boxSizing = 'border-box';
        input.style.display = 'inline-block';
        input.style.verticalAlign = 'middle';

        const commit = (save = true) => {
            if (!layer) return;
            const val = input.value.trim();
            if (!save || val.length === 0) {
                layer.name = undefined;
            } else {
                layer.name = val;
            }
            nameSpan.removeAttribute('data-editing');
            nameSpan.textContent = layer.name || `Layer ${layer.label}`;
        };

        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                commit(true);
            } else if (e.key === 'Escape') {
                commit(false);
            }
        });
        input.addEventListener('blur', () => commit(true));

        input.focus();
        input.select();
    }

    _syncSelectionFromCanvas(ids, isSelected) {
        if (this._isSyncing) return;
        this._isSyncing = true;

        let container = this._getNode(this.getLayerContainerId());
        if (!container || !ids || !Sortable.get(container)) return;

        if (!Array.isArray(ids)) ids = [ids];

        for (const id of ids) {
            let obj = this._context.findObjectOnCanvasByIncrementId(Number(id));
            container = obj.layerID ? this._getNode(this.getAnnotationContainerId(obj.layerID)) : container;

            if (!container || !Sortable.get(container)) continue;
            const el = container.querySelector(`[data-type="annotation"][data-id="${id}"]`);
            if (!el) continue;
            
            if (isSelected) {
                Sortable.utils.select(el);
            } else {
                Sortable.utils.deselect(el);
            }
        }

        setTimeout(() => { this._isSyncing = false; }, 0);
    }

    _clearAllSelectionVisuals() {
        const container = this._getNode(this.getLayerContainerId());
        if (!container) return;

        container.querySelectorAll('[data-type="layer"], [data-type="annotation"]').forEach(el => {
            el.classList.remove('history-selected', 'history-layer-current');
        });
        this._updateDeleteLayerHeaderButton();
    }

    _updateActiveLayerVisual(activeLayerId) {
        const container = this._getNode(this.getLayerContainerId());
        if (!container) return;

        container.querySelectorAll('.history-layer-current')
            .forEach(el => el.classList.remove('history-layer-current'));
        if(!activeLayerId) return;

        const el = container.querySelector(`[data-type="layer"][data-id="${String(activeLayerId)}"]`);
        if (el) el.classList.add('history-layer-current');
    }

    _updateSelectedLayersVisual(layerIds, isSelected) {
        const container = this._getNode(this.getLayerContainerId());
        if (!container || !layerIds) return;
        if (!Array.isArray(layerIds)) layerIds = [layerIds];

        for (const id of layerIds) {
            const el = container.querySelector(`[data-type="layer"][data-id="${id}"]`);
            if (el) el.classList.toggle('history-selected', isSelected);
        }
        this._updateDeleteLayerHeaderButton();
    }

    _updateSelectedAnnotationsVisual(annotationIds, isSelected) {
        const container = this._getNode(this.getLayerContainerId());
        if (!container || !annotationIds) return;
        if (!Array.isArray(annotationIds)) annotationIds = [annotationIds];

        for (const id of annotationIds) {
            const el = container.querySelector(`[data-type="annotation"][data-id="${id}"]`);
            if (el) el.classList.toggle('history-selected', isSelected);
        }
        this._updateDeleteLayerHeaderButton();
    }

    _updateDeleteLayerHeaderButton() {
        const ctx = this.winContext();
        if (!ctx) return;
        const btn = ctx.document.getElementById('history-delete-selection');
        if (!btn) return;

        const hasAnySelection =
            (this._context.getSelectedLayerIds()?.length || 0) > 0 ||
            (this._context.getSelectedAnnotationIds()?.length || 0) > 0;

        btn.style.color = hasAnySelection ? 'var(--color-icon-primary)' : 'var(--color-icon-tertiary)';
        btn.style.pointerEvents = hasAnySelection ? 'auto' : 'none';
        btn.title = 'Delete Selection';
    }

    _getLayerHtml(object) {
        let layerID = object.id;
        if (!object.hasOwnProperty("label") || object.label === null) {
            object.label = this._layerLabelIncrement++;
        }

        const displayName = object.name || `Layer ${object.label}`;
        const annCount = Number(object.getAnnotationCount()) || 0;
        const annCountText = `${annCount} item${annCount === 1 ? '' : 's'}`;

        const html = `
        <div id="log-layer-${layerID}" class="rounded-2" data-type="layer" data-id="${layerID}">
            <div class="d-flex align-items-center" style="cursor: pointer; padding: 2px 0 2px 0; min-width:0; margin:0;">
                <span class="material-icons btn-pointer no-drag no-select" id="toggle-arrow-${layerID}"
                    onclick="
                        const layerContent = document.getElementById('annotation-log-layer-${layerID}');
                        const arrow = document.getElementById('toggle-arrow-${layerID}');
                        const isHidden = layerContent.style.display === 'none';
                        layerContent.style.display = isHidden ? 'block' : 'none';
                        arrow.innerText = isHidden ? 'expand_more' : 'chevron_right';
                        event.stopPropagation();
                    "
                    onpointerdown="event.stopPropagation()"
                    title="Show/Hide Annotations"
                    style="user-select:none; margin:0;">expand_more</span>
                <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">
                    <span class="layer-name-text no-select"
                        onpointerdown="event.stopPropagation()"
                        ondblclick="${this._globalSelf}.renameLayerInline('${layerID}', event);">${displayName}</span>
                    <span class="annotation-count" style="font-size:0.95em; font-weight:400; color:gray; margin-left:10px;">
                        ${annCountText}
                    </span>
                </div>
                <div class="d-flex align-items-center" style="flex-shrink:0;">
                    <span class="material-icons btn-pointer no-select" id="toggle-visibility-${layerID}" 
                        onclick="${this._globalSelf}.toggleLayerVisibility('${layerID}'); event.stopPropagation();"
                        onpointerdown="event.stopPropagation()"
                        title="Toggle Visibility" style="margin-right: 4px;">
                        visibility
                    </span>
                </div>
            </div>
            <div id="annotation-log-layer-${layerID}" class="rounded-2" style="display: block;">
            <!-- Annotations for this layer will be added here -->
            </div>
        </div>`;
        return html;
    }

    _getAnnotationHtml(object) {
        let inputs = [];

        let factory = this._context.getAnnotationObjectFactory(object.factoryID);
        let icon = factory ? factory.getIcon() : "question_mark";

        if (!object.hasOwnProperty("incrementId") || isNaN(object.incrementId) || object.incrementId === null) {
            object.incrementId = this._autoIncrement++;
        }

        if (!object.hasOwnProperty("label") || isNaN(object.incrementId) || object.label === null) {
            object.label = this._labelIncrement++;
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
            mainRowContent = this._context.getAnnotationDescription(object, "category", true, false),
            name = new Date(object.created).toLocaleString();

        mainRowContent = mainRowContent ? (mainRowContent + " " + object.label) : '';

        let area = factory.getArea(object);
        let length = factory.getLength(object);

        if (area) {
            mainRowContent += `<span class="float-right">Area ${VIEWER.scalebar.imageAreaToGivenUnits(area)}</span>`;
        } else if (length) {
            mainRowContent += `<span class="float-right">Length ${length}</span>`;
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
        const editIcon = editable ? `<span class="material-icons btn-pointer v-align-top mt-1" id="edit-log-object-${object.label}"
title="Edit annotation (disables navigation)" onclick="if (this.innerText === 'edit') {
${_this._globalSelf}._boardItemEdit(this, ${focusBox}, ${object.incrementId}); } 
else { ${_this._globalSelf}._boardItemSave(); } return false;">edit</span>` : '';

        const html = `
        <div id="log-object-${object.label}" class="rounded-2 d-flex align-items-center"
            data-type="annotation" data-id="${object.incrementId}"
            style="box-sizing: border-box;"
            onclick="${_this._globalSelf}._clickBoardElement(${focusBox}, ${object.incrementId}, event);"
            oncontextmenu="${_this._globalSelf}._clickBoardElement(${focusBox}, ${object.incrementId}, event); return false;">
            <div class="d-flex flex-column align-items-center annotation-arrows no-select" style="margin-right:0;">
                <span class="material-icons btn-pointer" style="font-size: 12px;" title="Move Up"
                    onclick="${_this._globalSelf}.moveAnnotationInBoard(${object.incrementId}, 'up'); event.stopPropagation();"
                    onpointerdown="event.stopPropagation()">
                    arrow_upward
                </span>
                <span class="material-icons btn-pointer" style="font-size: 12px;" title="Move Down"
                    onclick="${_this._globalSelf}.moveAnnotationInBoard(${object.incrementId}, 'down'); event.stopPropagation();"
                    onpointerdown="event.stopPropagation()">
                    arrow_downward
                </span>
            </div>
            <span class="material-icons" style="vertical-align:sub;color: ${color};margin:0;padding:0;">${icon}</span> 
            <div style="width: calc(100% - 80px);" class="d-inline-block">${inputs.join("")}</div>
            ${editIcon}
        </div>`;

        return html;
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

                const $self = (self && self.jquery) ? self : $(self);
                $self.parent().find("input").each((e, t) => {
                    $(t).removeAttr('readonly');
                });
                $self.html('save');

                this._editSelection = {
                    incrementId: incrementId,
                    self: $self,
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
        $('#history-board-for-annotations .Box-header').css('background', 'none');
        this._context.setMouseOSDInteractive(true);
        this._context.enableInteraction(true);
    }

    _disableForEdit() {
        $('#history-board-for-annotations .Box-header').css('background', 'var(--color-merge-box-error-indicator-bg)');
        this._context.setMouseOSDInteractive(false);
        this._context.enableInteraction(false);
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
 
    /**
     * Get the index of a board item by type and id.
     * @param {'layer'|'annotation'} type Board item type.
     * @param {number|string} id Item identifier.
     * @returns {number} index, or -1 if not found.
     */
    getBoardIndex(type, id) {
        return this._boardItems.findIndex(it => it.type === type && it.id === id);
    }

    _insertItemToBoard({ type, id, index, html }) {
        const containerId = this.getLayerContainerId();
        if (!containerId || !type || !String(id) || !html) return;

        const clamp = (i, len) => Math.min(Math.max(i, 0), len);
        let cur = this.getBoardIndex(type, id);
        if (cur === -1) {
            const target = Number.isInteger(index) ? clamp(index, this._boardItems.length) : this._boardItems.length;
            this._boardItems.splice(target, 0, { type, id });
            cur = target;
        } else if (Number.isInteger(index) && index !== cur) {  //TODO: check if this is needed at all, might need for drag&drop
            const [entry] = this._boardItems.splice(cur, 1);
            const target = clamp(index, this._boardItems.length);
            this._boardItems.splice(target, 0, entry);
            cur = target;
        }

        this._performAtJQNode(containerId, node => {
            const children = node.children("[data-type='layer'], [data-type='annotation']");
            if (cur < children.length) {
                children.eq(cur).before(html);
            } else {
                node.append(html);
            }
        });
    }

    /**
     * Add or update an annotation entry in the board UI.
     * - If 'replaced' is provided, replaces that entry's DOM.
     * - Inserts under the layer container, or at board root if no layer.
     * @param {fabric.Object} annotation Annotation to render.
     * @param {fabric.Object} [replaced] Existing annotation to replace.
     * @param {number} [boardIndex] Insert index when adding to board root.
     * @returns {void}
     */
    addAnnotationToBoard(annotation, replaced = undefined, boardIndex = undefined) {
        let annotContainerId;
        let didDirectReplace = false;
        const html = this._getAnnotationHtml(annotation);

        if (typeof replaced === "object" && !isNaN(replaced?.label)) {
            annotContainerId = annotation.layerID ? this.getAnnotationContainerId(annotation.layerID) : this.getLayerContainerId();

            this._performAtJQNode(this.getAnnotationElementId(replaced.label), node => {
                if (node.length) {
                    node.replaceWith(html);
                    didDirectReplace = true;

                    if (!annotation.layerID) {
                        const oldPos = this.getBoardIndex('annotation', replaced.incrementId);
                        this._boardItems[oldPos] = { type: 'annotation', id: annotation.incrementId };
                    }
                }
            });

            if (didDirectReplace) {
                this.highlight(annotation);
                return;
            }
        }

        if (annotation.layerID) {
            annotContainerId = this.getAnnotationContainerId(annotation.layerID);
            const layer = this._context.getLayer(annotation.layerID);

            this._performAtJQNode(this.getLayerElementId(annotation.layerID), node => {
                if (!node.length) this.addLayerToBoard(layer);
            });

            const idx = layer.getAnnotationIndex(annotation);
            this._performAtJQNode(annotContainerId, node => {
                if (idx === 0) {
                    node.prepend(html);
                } else {
                    const children = node.children("[data-type='annotation']");
                    if (idx >= children.length || idx === -1) {
                        node.append(html);
                    } else {
                        children.eq(idx - 1).after(html);
                    }
                }
            });
        } else {
            this._insertItemToBoard({
                type: 'annotation',
                id: annotation.incrementId,
                index: boardIndex,
                html: html
            });
        }

        this.highlight(annotation);
        if (annotation.layerID) this._updateAnnotationCount(annotation.layerID);
    }

    /**
     * Remove an annotation entry from the board UI.
     * Updates the layer's count if applicable.
     * @param {fabric.Object} annotation Annotation to remove.
     * @returns {void}
     */
    removeAnnotationFromBoard(annotation) {
        let annotContainerId;

        if (!annotation.layerID) {
            this._boardItems = this._boardItems.filter(item => !(item.type === "annotation" && item.id === annotation.incrementId));
            annotContainerId = this.getLayerContainerId();
        } else {
            annotContainerId = this.getAnnotationContainerId(annotation.layerID);
            const layer = this._context.getLayer(annotation.layerID);
            if (layer) this._updateAnnotationCount(annotation.layerID);
        }

        this._removeFromBoard(annotContainerId, `#${this.getAnnotationElementId(annotation.label)}`);
    }

    /**
     * Add a layer entry to the board UI at the given index.
     * @param {OSDAnnotations.Layer} layer Layer to add.
     * @param {number} [boardIndex] Optional insert index.
     * @returns {void}
     */
    addLayerToBoard(layer, boardIndex = undefined) {
        if (!layer) return;

        const html = this._getLayerHtml(layer);
        this._insertItemToBoard({
            type: 'layer',
            id: layer.id,
            index: boardIndex,
            html: html
        });
        
        this.initLayerSortable(this._getNode(this.getAnnotationContainerId(layer.id)));
    }

    /**
     * Remove a layer entry (and its annotations) from the board UI.
     * @param {OSDAnnotations.Layer} layer Layer to remove.
     * @returns {void}
     */
    removeLayerFromBoard(layer) {
        if (!layer) return;

        if (this._context.getSelectedLayerIds().includes(layer.id)) {
            this._context.deselectLayer(layer.id);
        }
        
        this._boardItems = this._boardItems.filter(item => !(item.type === "layer" && item.id === layer.id));
        this._removeFromBoard(this.getLayerContainerId(), `#${this.getLayerElementId(layer.id)}`);
    }
};
