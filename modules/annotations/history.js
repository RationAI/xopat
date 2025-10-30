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
        this._context.addHandler('layer-objects-changed', e => {
            if (!e?.layerId) return;
            this._updateAnnotationCount(e.layerId);
            this._updateLayerArea(e.layerId);
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

    _clearDomSelection(root) {
        if (!root) return;
        root.querySelectorAll('.history-selected').forEach(el => {
            el.classList.remove('history-selected');
            try { if (Sortable?.utils?.deselect) Sortable.utils.deselect(el); } catch(e) {}
        });
    }

    /**
     * Reopen the history window in the other context, open if not opened
     */
    swapHistoryWindowLocation() {
        const boardEl = this._getNode("layer-logs");
        this._clearDomSelection(boardEl);

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

    /**
     * Clear all items from the board
     */
    clearBoard() {
        this._boardItems = [];
        this.refresh();
    }

    /**
     * Refreshes window content (fix inconsistencies)
     */
    refresh() {
        if (this._context.disabledInteraction) return;

        const boardEl = this._getNode("layer-logs");
        this._clearDomSelection(boardEl);

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

        const selectedAnnots = this._context.getSelectedAnnotationIds();
        const selectedLayers = this._context.getSelectedLayerIds();
        const activeLayer = this._context.getActiveLayer();

        this._syncSortableSelection(selectedAnnots, 'annotation');
        this._syncSortableSelection(selectedLayers, 'layer');

        this._updateSelectedLayersVisual(selectedLayers, true);
        this._updateSelectedAnnotationsVisual(selectedAnnots, true);
        this._updateActiveLayerVisual(activeLayer?.id);
    }

    _refreshAnnotationInBoard(annotation) {
        if (this._context.isAnnotation(annotation) && this._context.updateSingleAnnotationVisuals(annotation)) {
            this.addAnnotationToBoard(annotation);
        }
    }

    _syncSortableSelection(ids, type) {
        const container = this._getNode(this.getLayerContainerId());
        if (!container || !Sortable.get(container) || ids === null || ids === undefined) return;

        const list = Array.isArray(ids) ? ids : [ids];

        for (const id of list) {
            const el = container.querySelector(`[data-type="${type}"][data-id="${String(id)}"]`);
            if (el && !el.classList.contains('history-selected')) {
                Sortable.utils.select(el);
            }
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
     * Check whether edit operation for the given object is in progress
     * @param {fabric.Object} ofObject fabricjs object
     * @return {boolean} true if the given object is currently being edited
     */
    isOngoingEditOf(ofObject) {
        return this._editSelection && this._editSelection.incrementId === ofObject.incrementId;
    }

    /**
     * Check whether an edit operation is in progress
     * @return {boolean} true if currently editing
     */
    isOngoingEdit() {
        return this._editSelection && String(this._editSelection.incrementId) !== undefined && String(this._editSelection.incrementId) !== null;
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
        this.initBoardSortable();
        this.refresh();

        let active = this._context.canvas.getActiveObject();
        if (active) {
            this.highlight(active);
        }
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
                this._handleSelect(evt);
            },
            onDeselect: (evt) => {
                this._handleDeselect(evt);
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
            onMove: (evt) => {
                this._toggleDropHover(this._lastDropHover, false);
                this._lastDropHover = evt?.to;
                this._toggleDropHover(this._lastDropHover, true);
            },
            onAdd: (evt) => {
                this._normalizeSortableEventPayload(evt);
                if (this._shouldCancelDrag(evt)) return false;

                this._handleDrop(evt, boardEl, true, true);
                this._toggleDropHover(this._lastDropHover, false);
            },
            onUpdate: (evt) => {
                this._normalizeSortableEventPayload(evt);
                if (this._shouldCancelDrag(evt)) return false;

                this._handleDrop(evt, boardEl, true, true);
                this._toggleDropHover(this._lastDropHover, false);
            }
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

        const checkForLayerSelection = (evt) => {
            const hasLayer = Array.isArray(evt.items) && evt.items.some(item => item.getAttribute('data-type') === 'layer');
            if (hasLayer) {
                Dialogs.show(
                    "Cannot drop a layer into another layer. Nested layers are not supported.",
                    3500,
                    Dialogs.MSG_WARN
                );
                this.refresh();
                this._toggleDropHover(this._lastDropHover, false);
                return true;
            }
            return false;
        };

        container._sortableInstance = new Sortable(container, {
            group: {
                name: 'layer',
                pull: true,
                put: (to, from, dragEl) => {
                    const type = dragEl.getAttribute('data-type');
                    return type === 'layer' || type === 'annotation';
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
                this._handleSelect(evt);
            },
            onDeselect: (evt) => {
                this._handleDeselect(evt);
            },
            onMove: (evt) => {
                this._toggleDropHover(this._lastDropHover, false);
                this._lastDropHover = evt?.to;
                this._toggleDropHover(this._lastDropHover, true);
            },
            onAdd: (evt) => {
                this._normalizeSortableEventPayload(evt);
                if (checkForLayerSelection(evt) || this._shouldCancelDrag(evt)) return false;

                this._handleDrop(evt, container, false, true);
                this._toggleDropHover(this._lastDropHover, false);
            },
            onUpdate: (evt) => {
                this._normalizeSortableEventPayload(evt);
                if (checkForLayerSelection(evt) || this._shouldCancelDrag(evt)) return false;

                this._handleDrop(evt, container, false, true);
                this._toggleDropHover(this._lastDropHover, false);
            }
        });

        const s = Sortable.get(container);
        if (s.multiDrag && s.multiDrag._deselectMultiDrag) {
            s.multiDrag._deselectMultiDrag = function() {};
        }
    }

    _normalizeSortableEventPayload(evt) {
        const validItems = evt.items.filter(item => item.classList.contains('history-selected'));
        evt.items.length = 0;
        evt.items.push(...validItems);

        const item = evt.item;
        const items = Array.isArray(evt.items) ? evt.items : [];

        if (item && !items.length) {
            evt.items.push(item);
            evt.oldIndicies.push({multiDragElement: evt.item, index: evt.oldIndex});
            evt.newIndicies.push({multiDragElement: evt.item, index: evt.newIndex});
        }
    }

    _shouldCancelDrag(evt) {
        if (evt?.item && Array.isArray(evt.items) && !evt.items.includes(evt.item)) {
            this.refresh();
            this._toggleDropHover(this._lastDropHover, false);
            return true;
        }

        const items = Array.isArray(evt?.items) ? evt.items : (evt?.item ? [evt.item] : []);
        if (!items.length) return false;

        const selectedLayerIds = new Set();
        const selectedAnnotationIds = [];

        for (const el of items) {
            const type = el?.getAttribute?.('data-type');
            const idStr = el?.getAttribute?.('data-id');
            if (!type || idStr == null) continue;

            const id = Number(idStr);
            if (type === 'layer') selectedLayerIds.add(id);
            else if (type === 'annotation') selectedAnnotationIds.push(id);
        }

        if (selectedLayerIds.size === 0 || selectedAnnotationIds.length === 0) return false;

        for (const annId of selectedAnnotationIds) {
            const obj = this._context.findObjectOnCanvasByIncrementId(Number(annId));
            if (obj?.layerID != null && selectedLayerIds.has(Number(obj.layerID))) {
                Dialogs.show(
                    "Cannot move annotations together with their selected parent layer. Deselect either the layer or those annotations.",
                    3500,
                    Dialogs.MSG_WARN
                );
                this.refresh();
                this._toggleDropHover(this._lastDropHover, false);
                return true;
            }
        }
        return false;
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

    _handleSelect(evt) {
        const item = evt.item;
        const type = item?.getAttribute('data-type');
        const id = item?.getAttribute('data-id');
        const boardEl = this._getNode("layer-logs");
        if (!type || !id) return;

        const oe = evt.originalEvent;
        const isModifier = oe && (oe.ctrlKey || oe.shiftKey || oe.metaKey);

        if (!isModifier) {
            boardEl.querySelectorAll('.history-selected').forEach(el => {
                if (el !== item) Sortable.utils.deselect(el);
            });
            this._handleBoardAction(null, null, 'clear');
            if (type === 'annotation') this._context.unsetActiveLayer();
        }

        this._handleBoardAction(type, Number(id), 'select');
    }

    _handleDeselect(evt) {
        const item = evt.item;
        const type = item?.getAttribute('data-type');
        const id = item?.getAttribute('data-id');
        const boardEl = this._getNode("layer-logs");
        if (!type || !id) return;

        const oe = evt.originalEvent;
        if (oe?.ctrlKey || oe?.metaKey) {
            this._handleBoardAction(type, Number(id), 'deselect');
            return;
        } else if (oe?.shiftKey) {
            return; // do nothing
        }

        boardEl.querySelectorAll('.history-selected').forEach(el => {
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
            const boardEl = this._getNode("layer-logs");

            boardEl?.querySelectorAll('.history-selected').forEach(el => {
                Sortable.utils.deselect(el);
                el.classList.remove('history-selected');
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

    _handleDrop(evt, targetContainer, isBoardTarget = false, sortableAction = true) {
        const items = evt.items || [];
        if (!Array.isArray(items) || items.length === 0) return;

        const newIndicies = evt.newIndicies || [];
        const oldIndicies = evt.oldIndicies || [];
        const targetLayerId = isBoardTarget ? undefined : this._getLayerIdFromContainer(targetContainer);

        const movedItems = oldIndicies
            .map(({ multiDragElement, index }) => this._resolveMovedItem(multiDragElement, index))
            .filter(Boolean);
        if (movedItems.length === 0) return;

        this._context.history.push(
            () => {
                this._applyMove(
                    movedItems,
                    targetLayerId,
                    isBoardTarget,
                    newIndicies,
                    sortableAction
                );
                sortableAction = false;
            },
            () => this._undoMove(
                movedItems,
                targetLayerId,
                isBoardTarget,
                items,
                sortableAction
            )
        );
    }

    _resolveMovedItem(el, oldIndex) {
        const type = el?.getAttribute?.('data-type');
        const id = el?.getAttribute?.('data-id');
        if (!type || !id) return null;

        const object = type === 'layer'
            ? this._context.getLayer(Number(id))
            : this._context.findObjectOnCanvasByIncrementId(Number(id));

        if (!object) return null;

        const sourceLayerId = object.layerID || undefined;
        const sourceIsBoard = !sourceLayerId;
        const sourceContainerId = sourceIsBoard
            ? this.getLayerContainerId()
            : this.getAnnotationContainerId(sourceLayerId);

        return {
            el,
            type,
            id,
            oldIndex,
            sourceLayerId,
            sourceIsBoard,
            sourceContainerId
        };
    }

    _applyMove(movedItems, targetLayerId, isBoardTarget, newIndicies, sortableAction) {
        const targetContainer = targetLayerId ? this._getNode(`annotation-log-layer-${targetLayerId}`) : this._getNode("layer-logs");
        const affectedLayers = new Set();
        const addedItems = [];
        const addedDom = [];

        for (const item of movedItems) {
            const { removedItem, removedDomItem } = this._removeItemFromSource(item, isBoardTarget, sortableAction);

            if (removedItem) addedItems.push(removedItem);
            if (removedDomItem) addedDom.push(removedDomItem);
            if (!item.sourceIsBoard) affectedLayers.add(String(item.sourceLayerId));
        }

        this._addItemsToTarget(
            targetLayerId,
            isBoardTarget,
            addedItems,
            newIndicies,
            targetContainer,
            addedDom,
            sortableAction
        );

        if (!isBoardTarget) affectedLayers.add(String(targetLayerId));
        affectedLayers.forEach(id => this._emitLayerObjectsChanged(id));
    }

    _removeItemFromSource(item, isBoardTarget, sortableAction) {
        const removeFn = item.sourceIsBoard
            ? this._removeFromListBoard
            : this._removeFromListLayer;

        const sourceList = item.sourceIsBoard
            ? this._boardItems
            : this._context.getLayer(String(item.sourceLayerId)).getObjects();

        const containerEl = this._getNode(item.sourceContainerId);

        const { newList, removed, removedDom } = removeFn.call(
            this,
            sourceList,
            [item.el],
            containerEl,
            !sortableAction
        );

        if (item.sourceIsBoard) {
            this._boardItems = newList;
        } else {
            this._context.getLayer(String(item.sourceLayerId)).setObjects(newList, true);
        }

        let removedItem = null;
        if (removed.length) {
            removedItem = removed[0];
            if (isBoardTarget && !item.sourceIsBoard) {
                removedItem.layerID = undefined;
                removedItem = this._convertItemToBoardFormat(removedItem);
            } else if (!isBoardTarget && item.sourceIsBoard) {
                removedItem = this._convertItemToLayerFormat(removedItem);
            }
        }

        return { removedItem, removedDomItem: removedDom[0] };
    }

    _addItemsToTarget(targetLayerId, isBoardTarget, items, indicies, container, dom, sortableAction) {
        const list = isBoardTarget
            ? this._boardItems
            : this._context.getLayer(String(targetLayerId)).getObjects();

        const newList = this._addToListByIndicies(
            list,
            items,
            indicies,
            container,
            !sortableAction,
            dom
        );

        if (isBoardTarget) {
            this._boardItems = newList;
        } else {
            this._context.getLayer(String(targetLayerId)).setObjects(newList, true);
        }

        return newList;
    }

    _undoMove(movedItems, targetLayerId, isBoardTarget, items, sortableAction) {
        const targetContainer = targetLayerId ? this._getNode(`annotation-log-layer-${targetLayerId}`) : this._getNode("layer-logs");
        const affectedLayers = new Set();

        const removedResult = this._removeFromTarget(
            targetLayerId,
            isBoardTarget,
            items,
            targetContainer,
            sortableAction
        );

        const removedItems = removedResult.removed;
        const removedDom = removedResult.removedDom;
        if (!isBoardTarget) affectedLayers.add(String(targetLayerId));

        removedItems.forEach((removed, i) => {
            const m = movedItems[i];
            const restored = this._restoreSourceItem(m, removed, isBoardTarget);
            const restoredDom = removedDom[i];
            this._addBackToSource(m, restored, restoredDom, sortableAction);

            if (!m.sourceIsBoard) affectedLayers.add(String(m.sourceLayerId));
        });

        affectedLayers.forEach(id => this._emitLayerObjectsChanged(id));
    }

    _removeFromTarget(targetLayerId, isBoardTarget, items, container, sortableAction) {
        const removeFn = isBoardTarget
            ? this._removeFromListBoard
            : this._removeFromListLayer;

        const list = isBoardTarget
            ? this._boardItems
            : this._context.getLayer(String(targetLayerId)).getObjects();

        const result = removeFn.call(this, list, items, container, !sortableAction);

        if (isBoardTarget) {
            this._boardItems = result.newList;
        } else {
            this._context.getLayer(String(targetLayerId)).setObjects(result.newList, true);
        }

        return result;
    }

    _restoreSourceItem(m, removedItem, isBoardTarget) {
        if (!m.sourceIsBoard && isBoardTarget) {
            return this._convertItemToLayerFormat(removedItem);
        }

        if (m.sourceIsBoard && !isBoardTarget) {
            removedItem.layerID = undefined;
            return this._convertItemToBoardFormat(removedItem);
        }

        return removedItem;
    }

    _addBackToSource(m, item, dom, sortableAction) {
        const list = m.sourceIsBoard
            ? this._boardItems
            : this._context.getLayer(String(m.sourceLayerId)).getObjects();
        const containerEl = this._getNode(m.sourceContainerId);

        const newList = this._addToListByIndicies(
            list,
            [item],
            [{ index: m.oldIndex }],
            containerEl,
            !sortableAction,
            [dom]
        );

        if (m.sourceIsBoard) {
            this._boardItems = newList;
        } else {
            this._context.getLayer(String(m.sourceLayerId)).setObjects(newList, true);
        }
    }

    _convertItemToBoardFormat(annotation) {
        if (!annotation) return null;

        return {
            type: "annotation",
            id: annotation.incrementId
        };
    }

    _convertItemToLayerFormat(obj) {
        if (!obj || !String(obj.id)) return null;
        let annotation = this._context.findObjectOnCanvasByIncrementId(obj.id);
        if (!annotation) return null;

        return annotation;
    }

    _getLayerIdFromContainer(container) {
        const id = container?.id || "";
        const m = id.match(/^annotation-log-layer-(.+)$/);
        return m ? m[1] : undefined;
    }

    _removeFromListLayer(list, items, container, updateDom = false) {
        return this._removeFromListGeneric(
            list,
            items,
            container,
            updateDom,
            (it, _type, idStr) => String(it.incrementId) === idStr
        );
    }

    _removeFromListBoard(list, items, container, updateDom = false) {
        return this._removeFromListGeneric(
            list,
            items,
            container,
            updateDom,
            (it, type, idStr) => it && it.type === type && String(it.id) === idStr
        );
    }

    _removeFromListGeneric(list, items, container, updateDom = false, matchFn) {
        if (!Array.isArray(list) || !Array.isArray(items) || items.length === 0)
            return { list, removed: [], removedDom: [] };

        const newList = [...list];
        const removed = [];
        const removedDom = [];

        for (const el of items) {
            const type = el?.getAttribute?.('data-type');
            const idAttr = el?.getAttribute?.('data-id');
            if (!type || idAttr == null) continue;

            const idStr = String(idAttr);
            const idx = newList.findIndex(item => matchFn(item, type, idStr));
            if (idx !== -1) {
                const [entry] = newList.splice(idx, 1);
                if (entry !== undefined) removed.push(entry);
            }

            let node = el;
            if (!node || node.parentNode !== container) {
                node = container.querySelector(`[data-type="${type}"][data-id="${idStr}"]`);
            }
            if (node) removedDom.push(node);
        }

        if (updateDom && container) {
            removedDom.forEach(node => {
                if (node?.parentNode === container) {
                    container.removeChild(node);
                }
            });
        }

        return { newList, removed, removedDom };
    }

    _addToListByIndicies(list, itemsToAdd, indicies, container, updateDom = false, removedDom = []) {
        if (!Array.isArray(list)) list = [];
        if (!Array.isArray(indicies) || indicies.length === 0) return list;
        if (!Array.isArray(itemsToAdd) || itemsToAdd.length === 0) return list;

        const result = [...list];
        const sorted = [...indicies].sort((a, b) => a.index - b.index);

        sorted.forEach(({ index }, i) => {
            const item = itemsToAdd[i];
            const pos = Math.min(index, result.length);
            result.splice(pos, 0, item);

            if (updateDom && container) {
                const el = removedDom[i];
                const refNode = container.children[pos] || null;
                if (el) container.insertBefore(el, refNode);
            }
        });

        return result;
    }

    moveAnnotationInBoard(annotationId, direction) {
        const annotation = this._context.findObjectOnCanvasByIncrementId(annotationId);
        if (!annotation) return;

        const pos = this._findAnnotationPosition(annotation);
        if (!pos) return;

        const boardEl = this._getNode("layer-logs");
        const el = boardEl?.querySelectorAll(`[data-type="annotation"][data-id="${String(annotation.incrementId)}"]`)[0];
        if (!el) return;

        const movedItem = { multiDragElement: el, index: pos.idx };

        if (pos.type === "board") {
            this._moveBoardCase(pos, movedItem, direction);
        } else {
            this._moveLayerCase(pos, movedItem, direction);
        }
    }

    _moveBoardCase(pos, movedItem, direction) {
        const currentIdx = pos.idx;
        const newIdx = direction === "up" ? currentIdx - 1 : currentIdx + 1;
        if (newIdx < 0 || newIdx >= this._boardItems.length) return;

        const target = this._boardItems[newIdx];

        if (target.type === "annotation") {
            return this._delegateToAddItems(movedItem, newIdx, true);
        }

        const targetLayer = this._context.getLayer(target.id);
        if (!targetLayer) return;

        const targetIdxInsideLayer = direction === "up"
            ? targetLayer.getObjects().length
            : 0;

        return this._delegateToAddItems(movedItem, targetIdxInsideLayer, false, targetLayer.id);
    }

    _moveLayerCase(pos, movedItem, direction) {
        const { layer, layerIdx } = pos;
        const objs = layer.getObjects();
        const cur = movedItem.index;
        const newIdx = direction === "up" ? cur - 1 : cur + 1;

        if (newIdx >= 0 && newIdx < objs.length) {
            return this._delegateToAddItems(movedItem, newIdx, false, layer.id);
        }

        const newBoardIdx = direction === "up"
            ? layerIdx
            : layerIdx + 1;

        return this._delegateToAddItems(movedItem, newBoardIdx, true);
    }


    _delegateToAddItems(movedItem, newIndex, isBoardTarget, layerId) {
        const targetContainer = isBoardTarget
            ? this._getNode(this.getLayerContainerId())
            : this._getNode(this.getAnnotationContainerId(layerId));

        const evt = {
            items: [movedItem.multiDragElement],
            oldIndicies: [movedItem],
            newIndicies: [{multiDragElement: movedItem.multiDragElement, index: newIndex }]
        };

        this._handleDrop(evt, targetContainer, isBoardTarget, false);
    }

    _findAnnotationPosition(annotation) {
        if (!annotation.layerID) {
            const idx = this.getBoardIndex('annotation', annotation.incrementId);
            return { type: "board", idx };

        } else {
            const layerIdx = this.getBoardIndex('layer', annotation.layerID);
            const layer = this._context.getLayer(annotation.layerID);
            const idx = layer.getAnnotationIndex(annotation);
            if (!layer) return null;

            return { type: "layer", layer, layerIdx, idx };
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

                if (!Number.isFinite(bbox.left) || !Number.isFinite(bbox.top)) {
                    console.warn("Annotation focus BBOX undefined: try to recompute.");
                    bbox = targetObj.getBoundingRect(true, true);
                }
            }
        }

        if (!this._focusWithScreen || !Number.isFinite(bbox.left) || !Number.isFinite(bbox.top)) {
            return targetObj;
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
        let container = this._getNode(this.getLayerContainerId());
        if (!container || !ids || !Sortable.get(container)) return;

        if (!Array.isArray(ids)) ids = [ids];

        for (const id of ids) {
            let obj = this._context.findObjectOnCanvasByIncrementId(Number(id));
            container = obj.hasOwnProperty("layerID") && obj.layerID ? this._getNode(this.getAnnotationContainerId(obj.layerID)) : container;

            if (!container || !Sortable.get(container)) continue;
            const el = container.querySelector(`[data-type="annotation"][data-id="${id}"]`);
            if (!el) continue;

            if (isSelected) {
                Sortable.utils.select(el);
            } else {
                Sortable.utils.deselect(el);
            }
        }
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

        const totalAreaValue = this._computeLayerArea(object);
        const totalAreaText = VIEWER?.scalebar?.imageAreaToGivenUnits
            ? VIEWER.scalebar.imageAreaToGivenUnits(totalAreaValue || 0)
            : String(totalAreaValue || 0);

        const visibilityIcon = object.visible ? 'visibility' : 'visibility_off';

        const html = `
        <div id="log-layer-${layerID}" class="rounded-2" data-type="layer" data-id="${layerID}">
            <div class="d-flex align-items-center" style="cursor: pointer; padding: 2px 0 2px 0; min-width:0; margin:0;">
                <span class="material-icons btn-pointer no-select" id="toggle-arrow-${layerID}"
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
                    <span class="layer-area-total" id="layer-area-${layerID}" 
                        title="Sum of areas"
                        style="font-size:0.95em; font-weight:400; color:gray; margin-right: 10px;">
                        Σ ${totalAreaText}
                    </span>
                    <span class="material-icons btn-pointer no-select" id="toggle-visibility-${layerID}" 
                        onclick="${this._globalSelf}.toggleLayerVisibility('${layerID}'); event.stopPropagation();"
                        onpointerdown="event.stopPropagation()"
                        title="Toggle Visibility" style="margin-right: 4px;">
                        ${visibilityIcon}
                    </span>
                </div>
            </div>
            <div id="annotation-log-layer-${layerID}" class="rounded-2" style="display: block;">
            <!-- Annotations for this layer will be added here -->
            </div>
        </div>`;
        return html;
    }

    _computeLayerArea(layer) {
        if (!layer) return 0;
        const objects = layer.getObjects?.() || [];
        let sum = 0;
        for (const obj of objects) {
            const factory = this._context.getAnnotationObjectFactory(obj.factoryID);
            if (!factory) continue;
            const area = factory.getArea(obj);
            if (Number.isFinite(area) && area > 0) sum += area;
        }
        return sum;
    }

    _updateLayerArea(layerId) {
        const layer = this._context.getLayer(layerId);
        if (!layer) return;
        const sum = this._computeLayerArea(layer);
        const text = VIEWER?.scalebar?.imageAreaToGivenUnits
            ? VIEWER.scalebar.imageAreaToGivenUnits(sum || 0)
            : String(sum || 0);
        const el = this._getNode(`layer-area-${layerId}`);
        if (el) el.textContent = `Σ ${text}`;
    }

    _getAnnotationHtml(object) {
        let inputs = [];

        let factory = this._context.getAnnotationObjectFactory(object.factoryID);
        let icon = factory ? factory.getIcon() : "question_mark";

        if (!object.hasOwnProperty("incrementId") || isNaN(object.incrementId) || object.incrementId === null || object.incrementId === undefined) {
            object.incrementId = this._autoIncrement++;
        }

        if (!object.hasOwnProperty("label") || isNaN(object.label) || object.label === null || object.label === undefined) {
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
        let color = this._context.getAnnotationColor(object);
        let categoryDesc = this._context.getAnnotationDescription(object, "category", true, false);
        let name = new Date(object.created).toLocaleString();
        let mainRowContent;

        if (factory && factory.factoryID === "text") {
            let objmeta = object.meta || {};
            let objCategory = objmeta.category || categoryDesc;

            mainRowContent = `
                <label class="show-hint d-block py-1" style="white-space: nowrap; padding-left:0;">
                    <input type="text"
                        class="form-control border-0"
                        readonly
                        style="background:transparent;color: inherit; display:inline-block; padding-left:0"
                        value="${objCategory} ${object.label}"
                        name="category">
                </label>`;
        } else {
            mainRowContent = categoryDesc ? (categoryDesc + " " + object.label) : '';
        }

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
        const editable = factory.isEditable();
        const editIcon = editable ? `<span class="material-icons btn-pointer v-align-top mt-1 no-select" id="edit-log-object-${object.label}"
title="Edit annotation (disables navigation)" onclick="if (this.innerText === 'edit') {
${_this._globalSelf}._boardItemEdit(this, ${focusBox}, ${object.incrementId}); } 
else { ${_this._globalSelf}._boardItemSave(); } return false;">edit</span>` : '';
        const privateIcon = object.private ? `<span class="material-symbols-outlined" style="vertical-align:sub;">visibility_lock</span>` : '';
        // todo dataset-order defined instead of dataset-id
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
            ${privateIcon}
            <div style="width: calc(100% - 80px);" class="d-inline-block">${inputs.join("")}</div>
            ${editIcon}
        </div>`;

        return html;
    }

    _boardItemEdit(self, focusBBox, object) {
        // todo docs, return bool if allowed
        let cancelAction = false;
		try {
			if (object) this._context.raiseEvent('annotation-before-edit', {
				object,
				isCancelled: () => cancelAction,
				setCancelled: (cancelled) => {cancelAction = cancelled},
			});
		} catch {}
		if (cancelAction) return;

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
            object = this._focus(focusBBox, incrementId) || this._context.findObjectOnCanvasByIncrementId(incrementId);
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
            this._emitLayerObjectsChanged(obj.layerID);
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
        this._setSortableEnabled(true);
    }

    _disableForEdit() {
        $('#history-board-for-annotations .Box-header').css('background', 'var(--color-merge-box-error-indicator-bg)');
        this._context.setMouseOSDInteractive(false);
        this._context.enableInteraction(false);
        this._setSortableEnabled(false);
    }

    _setSortableEnabled(enabled) {
        this._sortablesDisabled = !enabled;
        const toggle = (el) => {
            try {
                const inst = el && Sortable.get(el);
                if (inst) inst.option('disabled', !enabled);
            } catch(e) {}
        };
        const boardEl = this._getNode("layer-logs");
        toggle(boardEl);

        const ctx = this.winContext();
        if (!ctx) return;
        const layerLists = ctx.document.querySelectorAll("[id^='annotation-log-layer-']");
        layerLists.forEach(toggle);
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
                        layer.addObject(annotation);
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
        if (annotation.layerID) this._emitLayerObjectsChanged(annotation.layerID);
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
            if (layer) this._emitLayerObjectsChanged(annotation.layerID);
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

    _emitLayerObjectsChanged(layerId) {
        if (!layerId) return;
        this._context.raiseEvent('layer-objects-changed', { layerId: String(layerId) });
    }
};
