const { div, style } = globalThis.van.tags;

function sanitizeId(value) {
    return String(value ?? 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

const FA_ICON_MAP = {
    chevron_right: 'fa-chevron-right',
    expand_more: 'fa-chevron-down',
    visibility: 'fa-eye',
    visibility_off: 'fa-eye-slash',
    arrow_upward: 'fa-arrow-up',
    arrow_downward: 'fa-arrow-down',
    edit: 'fa-pen-to-square',
    question_mark: 'fa-circle-question',
    visibility_lock: 'fa-user-lock',
};

function faIcon(name, extraClasses = '') {
    const el = document.createElement('i');
    const key = String(name ?? '').trim();
    const mapped = FA_ICON_MAP[key] || (key.startsWith('fa-') ? key : 'fa-tag');
    el.className = `fa-solid ${mapped} ${extraClasses}`.trim();
    el.setAttribute('aria-hidden', 'true');
    return el;
}

function factoryIcon(icon, extraClasses = '') {
    const el = document.createElement('i');
    const tokens = String(icon ?? 'fa-tag')
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    const hasStyleClass = tokens.some(token =>
        ['fa-solid', 'fa-regular', 'fa-light', 'fa-thin', 'fa-duotone', 'fa-brands'].includes(token)
    );

    const hasIconClass = tokens.some(token => token.startsWith('fa-') && !token.startsWith('fa-rotate'));

    if (!hasStyleClass) tokens.unshift('fa-solid');
    if (!hasIconClass) tokens.push('fa-tag');

    el.className = [...tokens, extraClasses].filter(Boolean).join(' ').trim();
    el.setAttribute('aria-hidden', 'true');
    return el;
}

export class AnnotationBoardPanel {
    constructor(plugin, viewer) {
        this.plugin = plugin;
        this.context = plugin.context;
        this.viewer = viewer;
        this.viewerId = viewer.uniqueId;
        this.uid = sanitizeId(this.viewerId);

        this.containerId = `history-board-for-annotations-${this.uid}`;
        this.bodyId = `${this.containerId}-body`;
        this.headerId = `${this.containerId}-header`;
        this.layerLogsId = `${this.containerId}-layers`;

        this._mounted = false;
        this._sortablesReady = false;
        this._sortablesDisabled = false;
        this._editSelection = undefined;
        this._collapsedLayers = new Set();
        this._renderQueued = false;
        this._lastDropHover = null;
        this._selectionSyncPaused = false;
        this._isSorting = false;
        this._pendingRender = false;
        this._pendingImmediateRender = false;
        this._editUiActive = false;

        this.root = null;
        this.rootComponent = null;
        this.bodyEl = null;
        this.layerLogsEl = null;
        this.deleteButton = null;
    }

    get fabric() {
        return this.context.getFabric(this.viewerId);
    }

    getLayerElementId(layerId) {
        return `log-layer-${this.uid}-${layerId}`;
    }

    getAnnotationContainerId(layerId) {
        return `annotation-log-layer-${this.uid}-${layerId}`;
    }

    getAnnotationElementId(label) {
        return `log-object-${this.uid}-${label}`;
    }

    create() {
        if (this.root) return this.root;

        const UI = globalThis.UI;

        this.deleteButton = new UI.Button({
            id: `${this.containerId}-delete-selection`,
            type: UI.Button.TYPE.NONE,
            extraClasses: 'btn btn-ghost btn-xs',
            extraProperties: { title: this.plugin.t('annotations.board.deleteSelection') },
            onClick: () => this.fabric?.deleteSelection()
        }, new UI.FAIcon('fa-trash'));

        this.rootComponent = new UI.Div({
                id: this.containerId,
                extraClasses: 'relative flex flex-col h-full min-h-0 annotation-board-panel'
            },
            new UI.Div({
                    id: this.headerId,
                    extraClasses: 'flex items-center gap-2 px-2 py-2 border-b border-base-300 sticky top-0 bg-base-100 z-10'
                },
                new UI.Div({ extraClasses: 'font-medium text-sm flex-1 min-w-0 truncate' }, this.plugin.t('annotations.board.title')),
                new UI.Div({ extraClasses: 'flex items-center gap-1' },
                    new UI.Button({
                        id: `${this.containerId}-create-layer`,
                        type: UI.Button.TYPE.NONE,
                        extraClasses: 'btn btn-ghost btn-xs',
                        extraProperties: { title: this.plugin.t('annotations.board.createLayer') },
                        onClick: () => this.fabric?.createLayer()
                    }, this.plugin.t('annotations.board.layer'),new UI.FAIcon('fa-circle-plus')),
                    this.deleteButton,
                    new UI.Button({
                        id: `${this.containerId}-refresh`,
                        type: UI.Button.TYPE.NONE,
                        extraClasses: 'btn btn-ghost btn-xs',
                        extraProperties: { title: this.plugin.t('annotations.board.refresh') },
                        onClick: () => this.requestRender(true)
                    }, new UI.FAIcon('fa-rotate'))
                )
            ),
            new UI.Div({
                id: this.bodyId,
                extraClasses: 'flex-1 overflow-y-auto px-0 py-2 min-h-0'
            }, div({ id: this.layerLogsId, class: 'h-full cursor-pointer pb-4' }))
        );

        this.root = this.rootComponent.create();
        return this.root;
    }

    mount() {
        const root = this.root || this.create();
        if (!root) return;

        this._mounted = true;
        this.layerLogsEl = root.querySelector(`#${CSS.escape(this.layerLogsId)}`);
        this.bodyEl = root.querySelector(`#${CSS.escape(this.bodyId)}`);

        if (!this._sortablesReady) {
            this.initBoardSortable();
            this._setupContainerClearSelection(root);
            this._sortablesReady = true;
        }

        this.requestRender(true);
    }

    destroy() {
        this.commitEdit(true);
        this._mounted = false;
    }

    requestRender(immediate = false) {
        if (!this._mounted || !this.root) return;

        if (this._isSorting) {
            this._pendingRender = true;
            this._pendingImmediateRender = this._pendingImmediateRender || !!immediate;
            return;
        }

        if (immediate) {
            this._renderQueued = false;
            this.render();
            return;
        }
        if (this._renderQueued) return;
        this._renderQueued = true;
        requestAnimationFrame(() => {
            this._renderQueued = false;
            this.render();
        });
    }

    _withSelectionSyncPaused(fn) {
        if (this._selectionSyncPaused) return fn?.();
        this._selectionSyncPaused = true;
        try {
            return fn?.();
        } finally {
            this._selectionSyncPaused = false;
        }
    }

    _clearDomSelection(root = this.layerLogsEl) {
        if (!root) return;
        root.querySelectorAll('.history-selected').forEach(el => {
            el.classList.remove('history-selected');
        });
    }

    _syncSortableSelection(objects, type) {
        if (!this.root) return;
        const list = Array.isArray(objects) ? objects : (objects ? [objects] : []);
        for (const obj of list) {
            const id = type === 'annotation' ? obj?.incrementId : obj?.id;
            if (id === undefined || id === null) continue;
            const el = this.root.querySelector(`[data-type="${type}"][data-id="${String(id)}"]`);
            if (!el) continue;
            el.classList.add('history-selected');
        }
    }

    _clearBoardSelectionDomExcept(item) {
        const boardEl = this.layerLogsEl;
        if (!boardEl) return;
        boardEl.querySelectorAll('.history-selected').forEach(el => {
            if (el === item) return;
            el.classList.remove('history-selected');
        });
    }

    _flushPendingRender() {
        const shouldRender = this._pendingRender;
        const immediate = this._pendingImmediateRender;
        this._pendingRender = false;
        this._pendingImmediateRender = false;
        if (shouldRender) this.requestRender(immediate);
    }

    _onSortStart() {
        this._isSorting = true;
        this._toggleDropHover(this._lastDropHover, false);
    }

    _onSortEnd() {
        this._isSorting = false;
        this._toggleDropHover(this._lastDropHover, false);
        this._lastDropHover = null;
        this._flushPendingRender();
    }

    _isModifierEvent(event) {
        return !!(event && (event.ctrlKey || event.metaKey || event.shiftKey));
    }

    _selectSingleBoardItem(type, id, item) {
        this._clearBoardSelectionDomExcept(item);
        this.fabric.clearLayerSelection?.();
        this.fabric.clearAnnotationSelection?.(true);
        this.fabric.unsetActiveLayer?.();

        if (type === 'layer') {
            const layer = this.fabric.getLayer(id);
            if (!layer) return;
            this.fabric.selectLayer?.(layer);
            this.fabric.setActiveLayer?.(layer);
        } else {
            const object = this.fabric.findObjectOnCanvasByIncrementId(Number(id));
            if (!object) return;
            this.fabric.selectAnnotation?.(object, true, true);
        }
    }

    _updateDeleteSelectionHeaderButton(disable = false) {
        const btn = document.getElementById(`${this.containerId}-delete-selection`);
        if (!btn) return;

        if (disable) {
            btn.style.opacity = '0.5';
            btn.style.pointerEvents = 'none';
            btn.ariaDisabled = 'true';
            return;
        }

        const hasSelection =
            (this.fabric.getSelectedLayerIds?.().length || 0) > 0 ||
            (this.fabric.getSelectedAnnotations?.().length || 0) > 0;

        btn.style.opacity = hasSelection ? '' : '0.6';
        btn.style.pointerEvents = hasSelection ? 'auto' : 'none';
        btn.ariaDisabled = hasSelection ? 'false' : 'true';
    }

    commitEdit(cancelOnly = false) {
        this._boardItemSave(cancelOnly);
    }

    render() {
        const fabric = this.fabric;
        if (!this.layerLogsEl || !fabric) return;

        const isEditing = !!(fabric.isEditing?.() || fabric.isOngoingEdit?.());
        if (this._editUiActive !== isEditing) {
            this._editUiActive = isEditing;
            if (isEditing) {
                this._disableForEdit();
            } else {
                this._enableAfterEdit();
            }
        }

        const previousScroll = this.bodyEl?.scrollTop ?? 0;
        this.layerLogsEl.replaceChildren();

        for (const entry of this._getBoardEntries()) {
            if (entry.type === 'layer') {
                const layer = fabric.getLayer(entry.id);
                if (!layer) continue;
                this.layerLogsEl.appendChild(this._renderLayer(layer));
            } else if (entry.type === 'annotation') {
                const object = fabric.findObjectOnCanvasByIncrementId(Number(entry.id));
                if (this._isRootAnnotation(object)) {
                    this.layerLogsEl.appendChild(this._renderAnnotation(object));
                }
            }
        }

        this.root.querySelectorAll('[data-layer-container="true"]').forEach(el => this.initLayerSortable(el));

        this._withSelectionSyncPaused(() => {
            this._clearDomSelection(this.layerLogsEl);
            this._syncSortableSelection(fabric.getSelectedLayers?.() || [], 'layer');
            this._syncSortableSelection(fabric.getSelectedAnnotations?.() || [], 'annotation');
        });

        this._updateDeleteSelectionHeaderButton();
        this._updateActiveLayerVisual(fabric.getActiveLayer?.());

        if (this.bodyEl) this.bodyEl.scrollTop = previousScroll;
        this._setSortableEnabled(!this._sortablesDisabled);
    }

    _getBoardEntries() {
        const explicit = Array.isArray(this.fabric?.getBoardOrder?.())
            ? this.fabric.getBoardOrder()
            : [];

        const actualLayers = (this.fabric?.getAllLayers?.() || [])
            .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
            .map(layer => ({ type: 'layer', id: String(layer.id) }));

        const actualRootAnnotations = (this.fabric?.canvas?.getObjects?.() || [])
            .filter(object => this.fabric.isAnnotation?.(object) && this._isRootAnnotation(object))
            .map(object => ({ type: 'annotation', id: String(object.incrementId) }));

        if (!explicit.length) {
            return [...actualLayers, ...actualRootAnnotations];
        }

        const result = [];
        const seen = new Set();

        const pushIfValid = (entry) => {
            if (!entry?.type || entry.id === undefined || entry.id === null) return;

            const normalized = { type: entry.type, id: String(entry.id) };
            const key = `${normalized.type}:${normalized.id}`;
            if (seen.has(key)) return;

            if (normalized.type === 'layer') {
                const layer = this.fabric.getLayer?.(normalized.id);
                if (!layer) return;
            } else if (normalized.type === 'annotation') {
                const object = this.fabric.findObjectOnCanvasByIncrementId?.(Number(normalized.id));
                if (!this._isRootAnnotation(object)) return;
            } else {
                return;
            }

            seen.add(key);
            result.push(normalized);
        };

        explicit.forEach(pushIfValid);
        actualLayers.forEach(pushIfValid);
        actualRootAnnotations.forEach(pushIfValid);

        return result;
    }

    _renderLayer(layer) {
        const layerId = String(layer.id);
        const wrapper = document.createElement('div');
        wrapper.id = this.getLayerElementId(layerId);
        wrapper.dataset.type = 'layer';
        wrapper.dataset.id = layerId;
        wrapper.className = 'group flex flex-col border-b border-base-300 last:border-none mb-1';

        const collapsed = this._collapsedLayers.has(layerId);
        const annCount = Number(layer.getAnnotationCount?.() ?? layer.getObjects?.().length ?? 0);

        const row = document.createElement('div');
        row.className = 'flex items-center gap-2 px-2 py-2 hover:bg-base-200 cursor-pointer transition-colors';

        // Toggle Arrow
        const toggleBtn = document.createElement('div');
        toggleBtn.className = `px-1 transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`;
        toggleBtn.appendChild(faIcon('chevron_right', 'text-xs opacity-50'));
        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            if (collapsed) this._collapsedLayers.delete(layerId);
            else this._collapsedLayers.add(layerId);
            this.requestRender(true);
        };

        const info = document.createElement('div');
        info.className = 'flex-1 min-w-0 flex items-center gap-2';

        const name = document.createElement('span');
        name.className = 'text-sm font-bold truncate';
        layer.name = layer.name || this.plugin.t('annotations.board.layerName', {name: layer.label || ''});
        name.textContent = layer.name;

        const badge = document.createElement('span');
        badge.className = 'badge badge-ghost badge-sm opacity-70 font-mono';
        badge.textContent = annCount;

        const area = document.createElement('span');
        area.className = 'text-[10px] opacity-40 ml-auto font-mono uppercase tracking-tighter';
        area.textContent = `Σ ${this._formatArea(this._computeLayerArea(layer))}`;

        info.append(name, badge, area);

        const actions = document.createElement('div');
        actions.className = 'flex items-center opacity-0 group-hover:opacity-100 transition-opacity';

        const visBtn = document.createElement('button');
        visBtn.className = 'btn btn-ghost btn-xs btn-square';
        visBtn.appendChild(faIcon(layer.visible ? 'visibility' : 'visibility_off'));
        visBtn.onclick = (e) => { e.stopPropagation(); this.toggleLayerVisibility(layerId); };

        actions.appendChild(visBtn);
        row.append(toggleBtn, info, actions);
        wrapper.appendChild(row);

        const annotationContainer = document.createElement('div');
        annotationContainer.id = this.getAnnotationContainerId(layerId);
        annotationContainer.className = 'bg-base-100/50 ml-2'; // Slight indentation feel
        annotationContainer.dataset.layerContainer = 'true';
        annotationContainer.style.display = collapsed ? 'none' : 'block';

        for (const object of layer.getObjects?.() || []) {
            annotationContainer.appendChild(this._renderAnnotation(object));
        }
        wrapper.appendChild(annotationContainer);

        return wrapper;
    }

    _renderAnnotation(object) {
        const factory = this.context.getAnnotationObjectFactory(object.factoryID);
        const isFiltered = !!this.context.isAnnotationFilteredOut?.(object);
        const row = document.createElement('div');
        row.id = this.getAnnotationElementId(object.label);
        row.dataset.type = 'annotation';
        row.dataset.id = String(object.incrementId);
        row.className = `group/ann flex items-center gap-3 px-2 py-1 border-l-4 border-transparent history-item-row transition-all ${isFiltered ? 'opacity-45 saturate-50 cursor-not-allowed' : 'hover:bg-base-300/50 cursor-pointer'}`.trim();
        if (isFiltered) row.setAttribute('aria-disabled', 'true');

        const color = this.fabric.getAnnotationColor?.(object) || 'var(--fallback-bc,black)';
        row.style.borderLeftColor = color;

        const dragHandle = document.createElement('div');
        dragHandle.className = 'opacity-0 group-hover/ann:opacity-30 cursor-grab active:cursor-grabbing';
        dragHandle.appendChild(faIcon('fa-grip-vertical', 'text-xs'));

        const iconBox = document.createElement('div');
        iconBox.className = 'flex-shrink-0 flex items-center justify-center w-5';
        const objectIcon = factoryIcon(factory?.getIcon?.() || 'fa-tag');
        objectIcon.style.color = color;
        iconBox.appendChild(objectIcon);

        const content = document.createElement('div');
        content.className = 'flex-1 min-w-0 leading-tight';

        const title = document.createElement('div');
        title.className = 'text-sm font-medium truncate';
        title.textContent = this._getAnnotationDisplayText(object);
        if (isFiltered) title.classList.add('line-through');

        const subText = document.createElement('div');
        subText.className = 'text-[10px] opacity-50 flex gap-2 items-center';
        const area = factory?.getArea?.(object);
        const time = new Date(object.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const timeNode = document.createElement('span');
        timeNode.textContent = time;
        const areaNode = document.createElement('span');
        areaNode.textContent = area ? this._formatArea(area) : 'No area';
        subText.append(timeNode, document.createTextNode(' • '), areaNode);
        if (isFiltered) {
            const badge = document.createElement('span');
            badge.className = 'badge badge-ghost badge-xs';
            badge.textContent = 'filtered';
            subText.appendChild(badge);
        }

        content.append(title, subText);

        const actions = document.createElement('div');
        actions.className = `flex gap-0.5 ${isFiltered ? 'opacity-30' : 'opacity-0 group-hover/ann:opacity-100'}`.trim();

        if (!isFiltered && factory?.isEditable?.()) {
            const editBtn = document.createElement('button');
            const isEditingThis = !!(
                this.context.isEditSelectionModeActive?.() &&
                (this.fabric.isEditingObject?.(object) || this.fabric.isOngoingEditOf?.(object))
            );

            editBtn.className = 'btn btn-ghost btn-xs btn-square';
            editBtn.appendChild(faIcon(isEditingThis ? 'fa-floppy-disk' : 'edit'));
            editBtn.dataset.role = 'annotation-edit';
            editBtn.dataset.mode = isEditingThis ? 'save' : 'edit';
            if (isEditingThis) editBtn.style.color = '#d32f2f';

            editBtn.onclick = (e) => {
                e.stopPropagation();

                if (this.context.isEditSelectionModeActive?.() &&
                    (this.fabric.isEditingObject?.(object) || this.fabric.isOngoingEditOf?.(object))) {
                    this.plugin.switchModeActive?.(this.context.Modes.AUTO.getId());
                    this.context.setMode(this.context.Modes.AUTO);
                    return;
                }

                this._boardItemEdit(editBtn, this._getFocusBBox(object, factory), object);
            };
            actions.appendChild(editBtn);
        }

        row.append(dragHandle, iconBox, content, actions);

        const focus = this._getFocusBBox(object, factory);
        if (!isFiltered) {
            row.addEventListener('click', (e) => this._clickBoardElement(focus, object.incrementId, e));
        }

        return row;
    }

    _getAnnotationDisplayText(object) {
        const categoryDesc = this.fabric.getAnnotationDescription?.(object, 'category', true, false)
            || this.fabric.getDefaultAnnotationName?.(object, false)
            || 'Annotation';
        return `${categoryDesc} ${object.label}`.trim();
    }

    _getFocusBBox(object, factory = undefined) {
        factory = factory || this.context.getAnnotationObjectFactory(object.factoryID);
        if (factory?.getObjectFocusZone) return factory.getObjectFocusZone(object);
        const center = object.getCenterPoint();
        return { left: center.x, top: center.y, width: 0, height: 0 };
    }

    _clickBoardElement(bbox, incrementId, event) {
        const object = this.fabric.findObjectOnCanvasByIncrementId(Number(incrementId));
        if (!object) return;

        if (event?.isPrimary || event?.button === 0) {
            if (this.fabric.focusObjectOrArea) this.fabric.focusObjectOrArea(object, incrementId);
        }

        this.context.raiseEvent('history-select', { incrementId, originalEvent: event });
    }

    _isRootAnnotation(object) {
        return !!object && (
            object.layerID === undefined ||
            object.layerID === null ||
            String(object.layerID) === ''
        );
    }

    toggleLayerVisibility(layerID) {
        this.fabric?.toggleLayerVisibility?.(layerID);
    }

    _updateActiveLayerVisual(activeLayer) {
        if (!this.root) return;
        this.root.querySelectorAll('.history-layer-current').forEach(el => el.classList.remove('history-layer-current'));
        if (!activeLayer) return;
        const el = this.root.querySelector(`[data-type="layer"][data-id="${String(activeLayer.id)}"]`);
        if (el) el.classList.add('history-layer-current');
    }

    _updateSelectionVisuals(selected, deselected, type) {
        if (!this.root) return;
        const norm = v => Array.isArray(v) ? v : (v ? [v] : []);
        for (const obj of norm(selected)) {
            const id = type === 'annotation' ? obj.incrementId : obj.id;
            const el = this.root.querySelector(`[data-type="${type}"][data-id="${String(id)}"]`);
            if (el) el.classList.add('history-selected');
        }
        for (const obj of norm(deselected)) {
            const id = type === 'annotation' ? obj.incrementId : obj.id;
            const el = this.root.querySelector(`[data-type="${type}"][data-id="${String(id)}"]`);
            if (el) el.classList.remove('history-selected');
        }
    }

    _stripLabelSuffix(value, label) {
        if (typeof value !== 'string') return value;
        const suffix = ` ${String(label)}`;
        return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
    }

    _boardItemEdit(self, focusBBox, object) {
        if (!object) return;

        if (this._editSelection) this._boardItemSave(true);

        const factory = this.context.getAnnotationObjectFactory(object.factoryID);
        if (!factory?.isEditable?.()) return;

        this.plugin.switchModeActive?.(this.context._ensureEditSelectionMode().getId());
        if (!this.context.startEditModeForObject(object, this.viewer)) return;

        this._disableForEdit();

        const row = self.closest('[data-type="annotation"]');
        const input = row?.querySelector('input[name="category"]');
        if (input) {
            input.readOnly = false;
            input.value = this._stripLabelSuffix(input.value, object.label);
            input.focus();
            input.select();
            input.addEventListener('keydown', this._editKeyHandler = (e) => {
                if (e.key === 'Enter') this._boardItemSave(false);
                if (e.key === 'Escape') this.context.setMode(this.context.Modes.AUTO);
            });
        }

        self.dataset.mode = 'save';
        self.textContent = 'save';
        self.style.color = '#d32f2f';
        this._editSelection = { self, target: object, incrementId: object.incrementId, input };
    }

    _boardItemSave(cancelOnly = false) {
        if (!this._editSelection) return;

        const { self, target: obj, input } = this._editSelection;
        try {
            if (input) {
                input.readOnly = true;
                if (!cancelOnly && obj) {
                    const defaultName = this.fabric.getDefaultAnnotationName?.(obj, false) || '';
                    let value = this._stripLabelSuffix(input.value, obj.label);
                    if (value === defaultName) value = '';
                    obj.meta = obj.meta || {};
                    obj.meta.category = value;
                }
                if (this._editKeyHandler) input.removeEventListener('keydown', this._editKeyHandler);
            }
        } catch (error) {
            console.warn(error);
        }

        if (self) {
            self.dataset.mode = 'edit';
            self.textContent = 'edit';
            self.style.color = '';
        }

        this.context.finishSelectionEdit?.(this.viewer, cancelOnly);
        this._editSelection = undefined;
        this._enableAfterEdit();
        this.requestRender(true);
    }

    _enableAfterEdit() {
        this._setSortableEnabled(true);
        this._updateDeleteSelectionHeaderButton(false);
    }

    _disableForEdit() {
        this._setSortableEnabled(false);
        this._updateDeleteSelectionHeaderButton(true);
    }

    _setSortableEnabled(enabled) {
        this._sortablesDisabled = !enabled;
        const toggle = (el) => {
            try {
                const inst = el && Sortable.get(el);
                if (inst) inst.option('disabled', !enabled);
            } catch {}
        };
        toggle(this.layerLogsEl);
        this.root?.querySelectorAll('[data-layer-container="true"]').forEach(toggle);
    }

    initBoardSortable() {
        if (!this.layerLogsEl || this.layerLogsEl._sortableInstance) return;
        this.layerLogsEl._sortableInstance = new Sortable(this.layerLogsEl, {
            group: { name: `annotation-board-${this.uid}`, pull: true, put: (to, from, dragEl) => ['layer', 'annotation'].includes(dragEl.getAttribute('data-type')) },
            draggable: "[data-type='layer'], [data-type='annotation']",
            animation: 120,
            multiDrag: true,
            avoidImplicitDeselect: true,
            selectedClass: 'history-selected',
            filter: '.no-select',
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
            onStart: () => this._onSortStart(),
            onEnd: () => this._onSortEnd(),
            onSelect: (evt) => this._handleSelect(evt),
            onDeselect: (evt) => this._handleDeselect(evt),
            onMove: (evt) => {
                this._toggleDropHover(this._lastDropHover, false);
                this._lastDropHover = evt?.to;
                this._toggleDropHover(this._lastDropHover, true);
            },
            onAdd: (evt) => this._onSortUpdate(evt, true),
            onUpdate: (evt) => this._onSortUpdate(evt, true)
        });
    }

    initLayerSortable(container) {
        if (!container || container._sortableInstance) return;
        container._sortableInstance = new Sortable(container, {
            group: { name: `annotation-board-${this.uid}`, pull: true, put: (to, from, dragEl) => dragEl.getAttribute('data-type') === 'annotation' },
            draggable: "[data-type='annotation']",
            animation: 120,
            multiDrag: true,
            avoidImplicitDeselect: true,
            selectedClass: 'history-selected',
            filter: '.no-select',
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
            onStart: () => this._onSortStart(),
            onEnd: () => this._onSortEnd(),
            onSelect: (evt) => this._handleSelect(evt),
            onDeselect: (evt) => this._handleDeselect(evt),
            onMove: (evt) => {
                this._toggleDropHover(this._lastDropHover, false);
                this._lastDropHover = evt?.to;
                this._toggleDropHover(this._lastDropHover, true);
            },
            onAdd: (evt) => this._onSortUpdate(evt, false),
            onUpdate: (evt) => this._onSortUpdate(evt, false)
        });
    }

    _onSortUpdate(evt, isBoardTarget) {
        this._normalizeSortableEventPayload(evt);
        if (this._shouldCancelDrag(evt, isBoardTarget)) return false;
        this._handleDrop(evt, evt.to, isBoardTarget);
        this._toggleDropHover(this._lastDropHover, false);
        return true;
    }

    _normalizeSortableEventPayload(evt) {
        const items = Array.isArray(evt.items) ? evt.items : [];
        const validItems = items.filter(item => item.classList.contains('history-selected'));
        evt.items = validItems.length ? validItems : (evt.item ? [evt.item] : []);
        evt.oldIndicies = Array.isArray(evt.oldIndicies) ? evt.oldIndicies : (evt.item ? [{ multiDragElement: evt.item, index: evt.oldIndex }] : []);
        evt.newIndicies = Array.isArray(evt.newIndicies) ? evt.newIndicies : (evt.item ? [{ multiDragElement: evt.item, index: evt.newIndex }] : []);
    }

    _shouldCancelDrag(evt, isBoardTarget) {
        const items = Array.isArray(evt.items) ? evt.items : (evt.item ? [evt.item] : []);
        if (!items.length) return false;
        if (!isBoardTarget && items.some(el => el.getAttribute('data-type') === 'layer')) {
            Dialogs.show(this.plugin.t('annotations.board.noNestedLayers'), 3500, Dialogs.MSG_WARN);
            this.requestRender(true);
            return true;
        }
        return false;
    }

    _captureSnapshot() {
        const fabric = this.fabric;

        return {
            boardOrder: (fabric.getBoardOrder?.() || this._getBoardEntries()).map(entry => ({
                type: entry.type,
                id: String(entry.id),
            })),
            layers: (fabric.getAllLayers?.() || []).map(layer => ({
                id: String(layer.id),
                name: layer.name,
                visible: layer.visible,
                objectIds: (layer.getObjects?.() || [])
                    .filter(obj => fabric.isAnnotation?.(obj))
                    .map(obj => String(obj.internalID ?? obj.incrementId))
            }))
        };
    }

    _resolveSnapshotObjects(objectIds = []) {
        const fabric = this.fabric;
        const allObjects = fabric.canvas?.getObjects?.() || [];
        const byId = new Map();

        for (const object of allObjects) {
            if (!fabric.isAnnotation?.(object)) continue;
            byId.set(String(object.internalID ?? object.incrementId), object);
        }

        return objectIds.map(id => byId.get(String(id))).filter(Boolean);
    }

    _readDomSnapshot() {
        const boardOrder = [];
        const layerObjects = new Map();
        const topChildren = [...this.layerLogsEl.children].filter(el => ['layer', 'annotation'].includes(el.dataset.type));

        for (const child of topChildren) {
            if (child.dataset.type === 'layer') {
                const layerId = String(child.dataset.id);
                boardOrder.push({ type: 'layer', id: layerId });
                const container = child.querySelector(`#${CSS.escape(this.getAnnotationContainerId(layerId))}`);
                const objects = [];
                if (container) {
                    for (const annEl of [...container.children].filter(el => el.dataset.type === 'annotation')) {
                        const obj = this.fabric.findObjectOnCanvasByIncrementId(Number(annEl.dataset.id));
                        if (obj) objects.push(obj);
                    }
                }
                layerObjects.set(layerId, objects);
            } else if (child.dataset.type === 'annotation') {
                boardOrder.push({ type: 'annotation', id: String(child.dataset.id) });
            }
        }

        return { boardOrder, layerObjects };
    }

    _applySnapshot(snapshot) {
        const fabric = this.fabric;

        if (fabric.clearBoardOrder) fabric.clearBoardOrder();
        (snapshot.boardOrder || []).forEach((entry, index) => {
            fabric.upsertBoardItem?.(entry.type, entry.id, index);
        });

        const idsInLayers = new Set();

        for (const layerState of snapshot.layers || []) {
            const layer = fabric.getLayer(layerState.id);
            if (!layer) continue;

            const objects = this._resolveSnapshotObjects(layerState.objectIds);
            layer.name = layerState.name;
            layer.visible = layerState.visible;

            for (const object of objects) {
                if (!fabric.isAnnotation?.(object)) continue;

                if (object.layerID && String(object.layerID) !== String(layer.id)) {
                    fabric.removeAnnotationFromLayer?.(object);
                }

                object.layerID = String(layer.id);
                idsInLayers.add(String(object.internalID ?? object.incrementId));
            }

            layer.setObjects(objects, true);
            fabric.raiseEvent?.('layer-objects-changed', { layerId: String(layer.id) });
        }

        const allObjects = fabric.canvas?.getObjects?.() || [];
        for (const object of allObjects) {
            if (!fabric.isAnnotation?.(object)) continue;

            const objectKey = String(object.internalID ?? object.incrementId);
            if (!idsInLayers.has(objectKey)) {
                if (object.layerID) fabric.removeAnnotationFromLayer?.(object);
                object.layerID = undefined;
            }
        }

        this.requestRender(true);
    }

    async _handleDrop() {
        const before = this._captureSnapshot();
        const after = this._applyDomOrder();

        await APPLICATION_CONTEXT.history.pushExecuted(
            () => this._applySnapshot(after),
            () => this._applySnapshot(before),
            {
                kind: 'annotations.board-drop',
                viewerId: this.viewerId
            }
        );
    }

    _applyDomOrder() {
        const fabric = this.fabric;
        const dom = this._readDomSnapshot();

        if (fabric.clearBoardOrder) fabric.clearBoardOrder();
        dom.boardOrder.forEach((entry, index) => {
            fabric.upsertBoardItem?.(entry.type, entry.id, index);
        });

        const layeredIds = new Set();
        for (const [layerId, objects] of dom.layerObjects.entries()) {
            const layer = fabric.getLayer(layerId);
            if (!layer) continue;

            const normalizedObjects = (objects || []).filter(Boolean);

            for (const object of normalizedObjects) {
                if (!fabric.isAnnotation?.(object)) continue;

                if (object.layerID && String(object.layerID) !== String(layerId)) {
                    fabric.removeAnnotationFromLayer?.(object);
                }

                object.layerID = String(layerId);
                layeredIds.add(String(object.internalID));
            }

            layer.setObjects(normalizedObjects, true);
            fabric.raiseEvent?.('layer-objects-changed', { layerId: String(layerId) });
        }

        const allObjects = fabric.canvas?.getObjects?.() || [];
        for (const object of allObjects) {
            if (!fabric.isAnnotation?.(object)) continue;

            if (!layeredIds.has(String(object.internalID))) {
                if (object.layerID) fabric.removeAnnotationFromLayer?.(object);
                object.layerID = undefined;
            }
        }

        this.requestRender(true);
        return this._captureSnapshot();
    }

    _handleSelect(evt) {
        if (this._selectionSyncPaused) return;

        const item = evt?.item || evt?.target;
        if (!item) return;

        const type = item.getAttribute('data-type');
        const id = item.getAttribute('data-id');
        if (!type || !id) return;

        const oe = evt?.originalEvent;
        const isModifier = this._isModifierEvent(oe);

        if (!isModifier) {
            this._selectSingleBoardItem(type, id, item);
            return;
        }

        if (type === 'layer') {
            const layer = this.fabric.getLayer(id);
            if (!layer) return;
            if (!this.fabric.getSelectedLayerIds?.().includes(String(layer.id))) {
                this.fabric.selectLayer?.(layer);
            }
            this.fabric.setActiveLayer?.(layer);
            return;
        }

        const object = this.fabric.findObjectOnCanvasByIncrementId(Number(id));
        if (!object) return;
        if (!this.fabric.isAnnotationSelected?.(object)) {
            this.fabric.selectAnnotation?.(object, true, false);
        }
    }

    _handleDeselect(evt) {
        if (this._selectionSyncPaused) return;

        const item = evt?.item || evt?.target;
        if (!item) return;

        const type = item.getAttribute('data-type');
        const id = item.getAttribute('data-id');
        if (!type || !id) return;

        const oe = evt?.originalEvent;
        if (oe?.ctrlKey || oe?.metaKey) {
            if (type === 'layer') {
                const layer = this.fabric.getLayer(id);
                if (layer) this.fabric.deselectLayer?.(layer);
            } else {
                const object = this.fabric.findObjectOnCanvasByIncrementId(Number(id));
                if (object) this.fabric.deselectAnnotation?.(object, true);
            }
            return;
        }

        if (oe?.shiftKey) {
            item.classList.add('history-selected');
            return;
        }

        item.classList.add('history-selected');
        this._selectSingleBoardItem(type, id, item);
    }

    _setupContainerClearSelection(container) {
        if (!container || container._clearSelHandler) return;

        const shouldIgnore = (target) => {
            return !!target?.closest?.('.no-select, input, textarea, select, button, [contenteditable="true"]');
        };

        const handler = (e) => {
            if (this._editSelection || this.fabric.isEditing?.() || this.fabric.isOngoingEdit?.()) return;

            const target = e.target;
            const item = target?.closest?.('[data-type="annotation"],[data-type="layer"]');
            if (item || shouldIgnore(target)) return;

            this._withSelectionSyncPaused(() => this._clearDomSelection(this.layerLogsEl));
            this.fabric.clearAnnotationSelection?.(true);
            this.fabric.clearLayerSelection?.();
            this.fabric.unsetActiveLayer?.();
        };
        container._clearSelHandler = handler;
        container.addEventListener('pointerdown', handler);
    }

    _toggleDropHover(el, on) {
        if (!el) return;
        el.classList.toggle('drop-hover', !!on);
    }

    _formatArea(area) {
        return this.viewer?.scalebar?.imageAreaToGivenUnits ? this.viewer.scalebar.imageAreaToGivenUnits(area || 0) : String(area || 0);
    }

    _computeLayerArea(layer) {
        const objects = layer?.getObjects?.() || [];
        let sum = 0;
        for (const object of objects) {
            const factory = this.context.getAnnotationObjectFactory(object.factoryID);
            const area = factory?.getArea?.(object);
            if (Number.isFinite(area) && area > 0) sum += area;
        }
        return sum;
    }
}
