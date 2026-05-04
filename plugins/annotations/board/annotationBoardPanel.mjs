const { div, style, input } = globalThis.van.tags;

// The board panel always virtualizes: only rows in the scroll viewport
// (+ overscan) are realized as DOM, regardless of total annotation /
// layer / collapse-state count. SortableJS drag-reorder was removed in
// favor of explicit ▲/▼/📁 controls per row + the right-click context
// menu's "group siblings by criterion" action.
const BOARD_LAYER_ROW_PX = 44;
const BOARD_ANNOTATION_ROW_PX = 40;
const BOARD_VIRTUAL_OVERSCAN = 5;

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
        this._mountSetupDone = false;
        this._editSelection = undefined;
        this._collapsedLayers = new Set();
        this._renderQueued = false;
        this._selectionSyncPaused = false;
        this._editUiActive = false;
        this._delegatedClickInstalled = false;

        this.root = null;
        this.rootComponent = null;
        this.bodyEl = null;
        this.layerLogsEl = null;
        this.deleteButton = null;

        // Free-text filter applied during _buildVirtualRows; empty string disables.
        this._searchQuery = '';

        // Data-version cache. _virtualRows is rebuilt only when _dataVersion
        // changes (data mutation, search query toggle, layer collapse).
        // Renders triggered by selection sync, scroll, focus updates, etc.
        // do not pay the rebuild cost.
        this._dataVersion = 0;
        this._lastBuiltVersion = -1;
        this._wrapperHandlers = null;       // [{event, fn}] for unsubscribe in destroy()

        // Lazy-built row templates (cached after first use).
        this._annotationRowTemplate = null;
        this._layerRowTemplate = null;

        // Virtualization state. Always-on; ~30 rows materialized at any time.
        this._virtualRows = null;          // [{kind:'layer'|'ann', layer/obj, id, height}]
        this._virtualRowOffsets = null;    // cumulative pixel offsets, length === rows.length
        this._virtualTotalHeight = 0;
        this._virtualSpacerEl = null;
        this._virtualScrollHandler = null;
        this._virtualPaintQueued = false;
        this._virtualLastRange = null;     // {first,last} of last paint, for cheap diff

        // Last row touched by a non-shift click. Shift+click selects the
        // contiguous range between this anchor and the clicked row in
        // _virtualRows order. Stored as the row's incrementId.
        this._selectionAnchorId = null;
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
                    extraClasses: 'px-2 py-1 border-b border-base-300 bg-base-100 sticky top-[42px] z-10'
                },
                input({
                    type: 'search',
                    placeholder: this.plugin.t?.('annotations.board.searchPlaceholder') || 'Search annotations…',
                    class: 'input input-xs input-bordered w-full',
                    oninput: (e) => this._onSearchInput(e.target.value)
                })
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

        // CSS containment: limit style/layout/paint propagation to inside the
        // panel so changes here don't trigger global recalcs.
        root.style.contain = 'layout style paint';
        if (this.bodyEl) this.bodyEl.style.contain = 'layout style paint';
        if (this.layerLogsEl) this.layerLogsEl.style.contain = 'layout style paint';

        if (!this._mountSetupDone) {
            this._setupContainerClearSelection(root);
            this._setupVirtualSpacer();
            this._attachVirtualScroll();
            this._installDelegatedHandlers();
            this._mountSetupDone = true;
        }

        this._subscribeToWrapperEvents();

        this.requestRender(true);
    }

    destroy() {
        this.commitEdit(true);
        this._unsubscribeFromWrapperEvents();
        this._detachVirtualScroll();
        this._mounted = false;
    }

    /** Lazy-create the spacer element inside layerLogsEl. */
    _setupVirtualSpacer() {
        if (this._virtualSpacerEl || !this.layerLogsEl) return;
        const spacer = document.createElement('div');
        spacer.dataset.role = 'virt-spacer';
        spacer.style.position = 'relative';
        spacer.style.width = '100%';
        // CSS containment: layout/style/paint stay inside the spacer subtree.
        spacer.style.contain = 'layout style paint';
        this.layerLogsEl.replaceChildren(spacer);
        this._virtualSpacerEl = spacer;
    }

    /**
     * One delegated click handler on layerLogsEl. Per-row click handlers are
     * not attached anymore — they routed through here.
     * Per-button handlers (edit / ▲ / ▼ / 📁) keep their own onclick and
     * stopPropagation so they don't fire the row click.
     */
    _installDelegatedHandlers() {
        if (!this.layerLogsEl || this._delegatedClickInstalled) return;
        this.layerLogsEl.addEventListener('click', (e) => {
            const annRow = e.target.closest('[data-type="annotation"]');
            if (!annRow) return;
            const id = Number(annRow.dataset.id);
            if (!Number.isFinite(id)) return;
            const obj = this.fabric?.findObjectOnCanvasByIncrementId?.(id);
            if (!obj) return;
            if (this.context.isAnnotationFilteredOut?.(obj)) return;
            const factory = this.context.getAnnotationObjectFactory?.(obj.factoryID);
            const focus = this._getFocusBBox(obj, factory);
            this._clickBoardElement(focus, id, e);
        });
        this.layerLogsEl.addEventListener('contextmenu', (e) => {
            const annRow = e.target.closest('[data-type="annotation"]');
            if (!annRow) return;
            const id = Number(annRow.dataset.id);
            if (!Number.isFinite(id)) return;
            const obj = this.fabric?.findObjectOnCanvasByIncrementId?.(id);
            if (!obj) return;
            e.preventDefault();
            this._openGroupContextMenu(e, obj);
        });
        this._delegatedClickInstalled = true;
    }

    /**
     * Subscribe to FabricWrapper events that mutate the row composition. Each
     * handler bumps _dataVersion so the next render rebuilds _virtualRows;
     * non-data renders (selection sync, scroll, focus) reuse the cache.
     */
    _subscribeToWrapperEvents() {
        if (this._wrapperHandlers || !this.fabric) return;
        const events = [
            'annotation-create',
            'annotation-delete',
            'annotation-replace',
            'annotation-loaded',
            'annotation-filter-change',
            'layer-removed',
            'layer-objects-changed',
        ];
        const handlers = [];
        const bump = () => {
            this._dataVersion++;
            this.requestRender();
        };
        for (const ev of events) {
            this.fabric.addHandler?.(ev, bump);
            handlers.push({ event: ev, fn: bump });
        }
        // layer-added: consume collapsedLayerHints (set by
        // wrapper.groupSiblingsByCriterion when the user picks
        // "(new collapsed layer)").
        const onLayerAdded = (e) => {
            const id = String(e?.layer?.id ?? '');
            const hints = this.fabric?.collapsedLayerHints;
            if (id && hints && hints.has(id)) {
                this._collapsedLayers.add(id);
                hints.delete(id);
            }
            this._dataVersion++;
            this.requestRender();
        };
        this.fabric.addHandler?.('layer-added', onLayerAdded);
        handlers.push({ event: 'layer-added', fn: onLayerAdded });
        this._wrapperHandlers = handlers;
    }

    _unsubscribeFromWrapperEvents() {
        if (!this._wrapperHandlers || !this.fabric) {
            this._wrapperHandlers = null;
            return;
        }
        for (const h of this._wrapperHandlers) {
            try { this.fabric.removeHandler?.(h.event, h.fn); } catch { /* non-fatal */ }
        }
        this._wrapperHandlers = null;
    }

    requestRender(immediate = false) {
        if (!this._mounted || !this.root) return;

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
            // edit-mode UI flip used to also toggle Sortable; with always-virtualize
            // there is no Sortable to toggle, but we still want to rebuild deferred
            // edit affordances on the row template.
        }

        // Reuse cached _virtualRows when no data has changed since last build.
        // Renders triggered by selection sync / scroll / edit-mode flip / focus
        // updates fall into this fast path and pay no rebuild cost.
        if (this._virtualRows == null || this._dataVersion !== this._lastBuiltVersion) {
            this._buildVirtualRows();
            this._lastBuiltVersion = this._dataVersion;
            // a fresh build invalidates the visible-range cache so paint repaints
            this._virtualLastRange = null;
        }
        // Always virtualized — DOM is bounded at ~30 rows + spacer regardless
        // of total annotation / layer / collapse-state count.
        this._renderVirtualized();
    }

    // -------------- virtualization ------------------------------------------

    /**
     * Walks _getBoardEntries() and produces a flat list of row descriptors
     * + a cumulative pixel-offset table. No DOM is created. Called from render()
     * so the row count drives the legacy-vs-virtualized dispatch.
     */
    _buildVirtualRows() {
        const fabric = this.fabric;
        const rows = [];
        const offsets = [];
        let y = 0;

        const push = (row) => {
            rows.push(row);
            offsets.push(y);
            y += row.height;
        };

        if (fabric) {
            const matches = this._buildSearchMatcher();
            for (const entry of this._getBoardEntries()) {
                if (entry.type === 'layer') {
                    const layer = entry.layer;
                    if (!layer) continue;
                    const layerId = String(layer.id);
                    const layerObjects = layer.getObjects?.() || [];
                    if (matches) {
                        const layerNameHit = matches(this._layerHaystack(layer));
                        const matchingObjects = layerNameHit
                            ? layerObjects
                            : layerObjects.filter(o => matches(this._annotationHaystack(o)));
                        if (!layerNameHit && matchingObjects.length === 0) continue;
                        push({ kind: 'layer', layer, id: layerId, height: BOARD_LAYER_ROW_PX });
                        if (this._collapsedLayers.has(layerId)) continue;
                        for (const object of matchingObjects) {
                            push({ kind: 'ann', obj: object, id: String(object.incrementId), layerId, height: BOARD_ANNOTATION_ROW_PX });
                        }
                    } else {
                        push({ kind: 'layer', layer, id: layerId, height: BOARD_LAYER_ROW_PX });
                        if (this._collapsedLayers.has(layerId)) continue;
                        for (const object of layerObjects) {
                            push({ kind: 'ann', obj: object, id: String(object.incrementId), layerId, height: BOARD_ANNOTATION_ROW_PX });
                        }
                    }
                } else if (entry.type === 'annotation') {
                    const object = entry.obj;
                    if (!this._isRootAnnotation(object)) continue;
                    if (matches && !matches(this._annotationHaystack(object))) continue;
                    push({ kind: 'ann', obj: object, id: String(object.incrementId), layerId: null, height: BOARD_ANNOTATION_ROW_PX });
                }
            }
        }

        this._virtualRows = rows;
        this._virtualRowOffsets = offsets;
        this._virtualTotalHeight = y;
    }

    /**
     * Lightweight ad-hoc menu listing available layers (+ "(no layer)") to
     * re-parent the given annotation. Placed below the anchor button; first
     * outside-click dismisses.
     */
    _openMoveToLayerMenu(anchorBtn, object) {
        const fabric = this.fabric;
        if (!fabric) return;

        const existing = document.body.querySelector('[data-role="board-move-to-layer-menu"]');
        if (existing) { existing.remove(); }

        const layers = (fabric.getAllLayers?.() || [])
            .filter(l => String(l.id) !== String(object.layerID ?? ''));

        const menu = document.createElement('div');
        menu.dataset.role = 'board-move-to-layer-menu';
        menu.className = 'absolute z-50 menu menu-sm bg-base-200 rounded-box shadow border border-base-300';
        menu.style.minWidth = '160px';

        const addItem = (label, onClick) => {
            const item = document.createElement('button');
            item.className = 'btn btn-ghost btn-xs justify-start w-full';
            item.textContent = label;
            item.onclick = (e) => { e.stopPropagation(); onClick(); menu.remove(); };
            menu.appendChild(item);
        };

        if (object.layerID) addItem('(no layer)', () => {
            fabric.setAnnotationLayer?.(object, null);
            this._dataVersion++;
            this.requestRender(true);
        });
        for (const l of layers) {
            addItem(l.name || `Layer ${l.id}`, () => {
                fabric.setAnnotationLayer?.(object, l.id);
                this._dataVersion++;
                this.requestRender(true);
            });
        }
        if (!menu.children.length) {
            addItem('(no other layers)', () => {});
        }

        document.body.appendChild(menu);
        const rect = anchorBtn.getBoundingClientRect();
        menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
        menu.style.left = `${rect.left + window.scrollX - 120}px`;

        const onDocClick = (ev) => {
            if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener('mousedown', onDocClick, true);
            }
        };
        // defer one frame so the click that opened the menu doesn't immediately close it
        requestAnimationFrame(() => document.addEventListener('mousedown', onDocClick, true));
    }

    /**
     * Cascading right-click menu: pick a criterion (factory / preset / author /
     * meta.category) → pick a destination ("(new collapsed layer)" or an
     * existing layer) → wrapper.groupSiblingsByCriterion runs the bulk move.
     */
    _openGroupContextMenu(pointerEvent, object) {
        const fabric = this.fabric;
        if (!fabric || !object) return;

        document.body.querySelector('[data-role="board-group-menu"]')?.remove();

        const menu = document.createElement('div');
        menu.dataset.role = 'board-group-menu';
        menu.className = 'absolute z-50 menu menu-sm bg-base-200 rounded-box shadow border border-base-300';
        menu.style.minWidth = '220px';

        const dismiss = () => menu.remove();

        const valueOf = (criterion) => {
            switch (criterion) {
                case 'factory':  return object.factoryID;
                case 'preset':   return object.presetID;
                case 'author':   return object.author ?? object.sessionID;
                case 'category': return object.meta?.category;
                default:         return undefined;
            }
        };

        const criteria = [
            { id: 'factory',  label: 'Group same shape type' },
            { id: 'preset',   label: 'Group same preset' },
            { id: 'author',   label: 'Group same author' },
            { id: 'category', label: 'Group same category text' },
        ];

        const layers = (fabric.getAllLayers?.() || [])
            .filter(l => String(l.id) !== String(object.layerID ?? ''));

        for (const c of criteria) {
            const value = valueOf(c.id);
            const item = document.createElement('button');
            item.className = 'btn btn-ghost btn-xs justify-between w-full';
            const left = document.createElement('span');
            left.textContent = c.label;
            const right = document.createElement('span');
            right.className = 'text-[10px] opacity-60 ml-2 truncate';
            right.textContent = value === undefined || value === null || value === ''
                ? '—' : String(value);
            item.append(left, right);

            if (value === undefined || value === null || value === '') {
                item.disabled = true;
                menu.appendChild(item);
                continue;
            }

            item.onclick = (e) => {
                e.stopPropagation();
                this._openGroupTargetMenu(item, object, c.id, layers, dismiss);
            };
            menu.appendChild(item);
        }

        document.body.appendChild(menu);
        const x = pointerEvent.clientX || 0;
        const y = pointerEvent.clientY || 0;
        menu.style.top = `${y + window.scrollY}px`;
        menu.style.left = `${x + window.scrollX}px`;

        const onDocClick = (ev) => {
            if (!menu.contains(ev.target)) {
                dismiss();
                document.removeEventListener('mousedown', onDocClick, true);
            }
        };
        requestAnimationFrame(() => document.addEventListener('mousedown', onDocClick, true));
    }

    /** Second-stage menu after the user picked a criterion. */
    _openGroupTargetMenu(anchorBtn, object, criterion, layers, dismissParent) {
        const fabric = this.fabric;
        document.body.querySelector('[data-role="board-group-target-menu"]')?.remove();

        const sub = document.createElement('div');
        sub.dataset.role = 'board-group-target-menu';
        sub.className = 'absolute z-50 menu menu-sm bg-base-200 rounded-box shadow border border-base-300';
        sub.style.minWidth = '180px';

        const apply = (target) => {
            const result = fabric.groupSiblingsByCriterion?.(object, criterion, target);
            if (result && result.targetLayerId) {
                this._collapsedLayers.add(String(result.targetLayerId));
            }
            this._dataVersion++;
            this.requestRender(true);
            dismissParent?.();
            sub.remove();
        };

        const addItem = (label, target) => {
            const item = document.createElement('button');
            item.className = 'btn btn-ghost btn-xs justify-start w-full';
            item.textContent = label;
            item.onclick = (e) => { e.stopPropagation(); apply(target); };
            sub.appendChild(item);
        };

        addItem('(new collapsed layer)', { kind: 'new' });
        for (const l of layers) {
            addItem(l.name || `Layer ${l.id}`, { kind: 'layer', layerId: l.id });
        }

        document.body.appendChild(sub);
        const rect = anchorBtn.getBoundingClientRect();
        sub.style.top = `${rect.top + window.scrollY}px`;
        sub.style.left = `${rect.right + window.scrollX + 4}px`;

        const onDocClick = (ev) => {
            if (!sub.contains(ev.target)) {
                sub.remove();
                document.removeEventListener('mousedown', onDocClick, true);
            }
        };
        requestAnimationFrame(() => document.addEventListener('mousedown', onDocClick, true));
    }

    _onSearchInput(value) {
        const next = String(value || '');
        if (next === this._searchQuery) return;
        this._searchQuery = next;
        this._dataVersion++;
        if (this._searchRequestQueued) return;
        this._searchRequestQueued = true;
        requestAnimationFrame(() => {
            this._searchRequestQueued = false;
            this.requestRender(true);
        });
    }

    /** Returns a substring matcher fn(haystack)→boolean, or null when no query. */
    _buildSearchMatcher() {
        const q = (this._searchQuery || '').trim().toLowerCase();
        if (!q) return null;
        return (haystack) => haystack.indexOf(q) !== -1;
    }

    /** Lowercase concatenation of an annotation's display tokens for substring search. */
    _annotationHaystack(object) {
        if (!object) return '';
        const display = this._getAnnotationDisplayText(object) || '';
        const id = object.incrementId != null ? String(object.incrementId) : '';
        const factory = this.context.getAnnotationObjectFactory?.(object.factoryID);
        const presetName = factory?.title?.() || '';
        return (display + ' ' + id + ' ' + presetName).toLowerCase();
    }

    _layerHaystack(layer) {
        return ((layer?.name || '') + ' ' + (layer?.label || '') + ' ' + (layer?.id || '')).toLowerCase();
    }

    _renderVirtualized() {
        if (!this.layerLogsEl) return;

        // Spacer is created once in mount(); just keep its height in sync.
        if (this._virtualSpacerEl) {
            this._virtualSpacerEl.style.height = this._virtualTotalHeight + 'px';
        }
        this._paintVirtualWindow();
    }

    _attachVirtualScroll() {
        if (!this.bodyEl || this._virtualScrollHandler) return;
        const handler = () => {
            if (this._virtualPaintQueued) return;
            this._virtualPaintQueued = true;
            requestAnimationFrame(() => {
                this._virtualPaintQueued = false;
                this._paintVirtualWindow();
            });
        };
        this._virtualScrollHandler = handler;
        this.bodyEl.addEventListener('scroll', handler, { passive: true });
    }

    _detachVirtualScroll() {
        if (this.bodyEl && this._virtualScrollHandler) {
            this.bodyEl.removeEventListener('scroll', this._virtualScrollHandler);
        }
        this._virtualScrollHandler = null;
        this._virtualPaintQueued = false;
    }

    /**
     * Binary-search the cumulative offset table for the first row whose offset
     * is > scrollTop. The row before it is the first visible row.
     */
    _firstRowAtY(y) {
        const offsets = this._virtualRowOffsets;
        if (!offsets || !offsets.length) return 0;
        let lo = 0, hi = offsets.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >>> 1;
            if (offsets[mid] <= y) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    _paintVirtualWindow() {
        const fabric = this.fabric;
        const spacer = this._virtualSpacerEl;
        if (!spacer || !fabric) return;

        const rows = this._virtualRows;
        const offsets = this._virtualRowOffsets;
        if (!rows || !rows.length) {
            spacer.replaceChildren();
            this._virtualLastRange = { first: 0, last: -1 };
            return;
        }

        const scrollTop = this.bodyEl?.scrollTop || 0;
        const viewportH = this.bodyEl?.clientHeight || 0;
        let first = this._firstRowAtY(scrollTop);
        let last = this._firstRowAtY(scrollTop + viewportH);
        first = Math.max(0, first - BOARD_VIRTUAL_OVERSCAN);
        last = Math.min(rows.length - 1, last + BOARD_VIRTUAL_OVERSCAN);

        const lastRange = this._virtualLastRange;
        if (lastRange && lastRange.first === first && lastRange.last === last) return;
        this._virtualLastRange = { first, last };

        // v1: rebuild the window slice. Window size is small (~viewport rows + 2*overscan)
        // so allocation cost is bounded regardless of total row count.
        spacer.replaceChildren();
        for (let i = first; i <= last; i++) {
            const row = rows[i];
            let el;
            if (row.kind === 'layer') {
                if (!row.layer) continue;
                el = this._renderLayer(row.layer);
            } else {
                if (!row.obj) continue;
                el = this._renderAnnotation(row.obj);
            }
            el.style.position = 'absolute';
            el.style.top = offsets[i] + 'px';
            el.style.left = '0';
            el.style.right = '0';
            el.style.height = row.height + 'px';
            // Skip render/layout for rows currently outside the scroll viewport
            // even within the realized window — the browser respects this.
            el.style.contentVisibility = 'auto';
            el.style.containIntrinsicSize = row.height + 'px';
            spacer.appendChild(el);
        }

        // selection visuals + active-layer highlight on the rows that just materialized
        this._withSelectionSyncPaused(() => {
            this._syncSortableSelection(fabric.getSelectedLayers?.() || [], 'layer');
            this._syncSortableSelection(fabric.getSelectedAnnotations?.() || [], 'annotation');
        });
        this._updateDeleteSelectionHeaderButton();
        this._updateActiveLayerVisual(fabric.getActiveLayer?.());
    }

    _getBoardEntries() {
        const fabric = this.fabric;
        if (!fabric) return [];

        const explicit = Array.isArray(fabric.getBoardOrder?.())
            ? fabric.getBoardOrder()
            : [];

        // Default fast path: walk source iterators directly, no id-keyed
        // lookups. Each entry carries the resolved layer / object reference.
        const actualLayers = (fabric.getAllLayers?.() || [])
            .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
            .map(layer => ({ type: 'layer', layer, id: String(layer.id) }));

        const actualRootAnnotations = (fabric.canvas?.getObjects?.() || [])
            .filter(object => fabric.isAnnotation?.(object) && this._isRootAnnotation(object))
            .map(object => ({ type: 'annotation', obj: object, id: String(object.incrementId) }));

        if (!explicit.length) {
            return [...actualLayers, ...actualRootAnnotations];
        }

        // Explicit-order branch: build a one-shot local Map for validation —
        // O(N) once, then GC'd. (The wrapper now provides O(1)
        // findObjectOnCanvasByIncrementId, but the local map keeps this
        // tight inner loop allocation-free of the wrapper-side fallback.)
        const annById = new Map();
        for (const o of fabric.canvas?.getObjects?.() || []) {
            if (fabric.isAnnotation?.(o) && o.incrementId !== undefined && o.incrementId !== null) {
                annById.set(String(o.incrementId), o);
            }
        }

        const result = [];
        const seen = new Set();

        const pushIfValid = (entry) => {
            if (!entry?.type || entry.id === undefined || entry.id === null) return;

            const id = String(entry.id);
            const key = `${entry.type}:${id}`;
            if (seen.has(key)) return;

            if (entry.type === 'layer') {
                const layer = entry.layer || fabric.getLayer?.(id);
                if (!layer) return;
                seen.add(key);
                result.push({ type: 'layer', layer, id });
            } else if (entry.type === 'annotation') {
                const obj = entry.obj || annById.get(id);
                if (!this._isRootAnnotation(obj)) return;
                seen.add(key);
                result.push({ type: 'annotation', obj, id });
            }
        };

        explicit.forEach(pushIfValid);
        actualLayers.forEach(pushIfValid);
        actualRootAnnotations.forEach(pushIfValid);

        return result;
    }

    /**
     * Lazy-build the layer header skeleton. Mirrors _getAnnotationTemplate.
     * The inner annotation container (legacy mode only) is built per-layer
     * outside the template, since its children depend on the layer + filter.
     */
    _getLayerTemplate() {
        if (this._layerRowTemplate) return this._layerRowTemplate;

        const wrapper = document.createElement('div');
        wrapper.dataset.tplRole = 'wrapper';
        wrapper.dataset.type = 'layer';
        wrapper.className = 'group flex flex-col border-b border-base-300 last:border-none mb-1';

        const row = document.createElement('div');
        row.dataset.tplRole = 'row';
        row.className = 'flex items-center gap-2 px-2 py-2 hover:bg-base-200 cursor-pointer transition-colors';

        const toggleBtn = document.createElement('div');
        toggleBtn.dataset.tplRole = 'toggle';
        toggleBtn.appendChild(faIcon('chevron_right', 'text-xs opacity-50'));

        const info = document.createElement('div');
        info.className = 'flex-1 min-w-0 flex items-center gap-2';

        const name = document.createElement('span');
        name.dataset.tplRole = 'name';
        name.className = 'text-sm font-bold truncate';

        const badge = document.createElement('span');
        badge.dataset.tplRole = 'badge';
        badge.className = 'badge badge-ghost badge-sm opacity-70 font-mono';

        const area = document.createElement('span');
        area.dataset.tplRole = 'area';
        area.className = 'text-[10px] opacity-40 ml-auto font-mono uppercase tracking-tighter';

        info.append(name, badge, area);

        const actions = document.createElement('div');
        actions.dataset.tplRole = 'actions';
        actions.className = 'flex items-center opacity-0 group-hover:opacity-100 transition-opacity';

        row.append(toggleBtn, info, actions);
        wrapper.appendChild(row);

        this._layerRowTemplate = wrapper;
        return wrapper;
    }

    _renderLayer(layer) {
        const layerId = String(layer.id);
        const collapsed = this._collapsedLayers.has(layerId);
        const annCount = Number(layer.getAnnotationCount?.() ?? layer.getObjects?.().length ?? 0);

        const wrapper = this._getLayerTemplate().cloneNode(true);
        wrapper.id = this.getLayerElementId(layerId);
        wrapper.dataset.id = layerId;

        const row = wrapper.querySelector('[data-tpl-role="row"]');
        const toggleBtn = wrapper.querySelector('[data-tpl-role="toggle"]');
        const nameEl = wrapper.querySelector('[data-tpl-role="name"]');
        const badgeEl = wrapper.querySelector('[data-tpl-role="badge"]');
        const areaEl = wrapper.querySelector('[data-tpl-role="area"]');
        const actions = wrapper.querySelector('[data-tpl-role="actions"]');

        row.style.height = BOARD_LAYER_ROW_PX + 'px';

        toggleBtn.className = `px-1 transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`;
        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            if (collapsed) this._collapsedLayers.delete(layerId);
            else this._collapsedLayers.add(layerId);
            this._dataVersion++;
            this.requestRender(true);
        };

        layer.name = layer.name || this.plugin.t('annotations.board.layerName', {name: layer.label || ''});
        nameEl.textContent = layer.name;
        badgeEl.textContent = annCount;
        areaEl.textContent = `Σ ${this._formatArea(this._computeLayerArea(layer))}`;

        const visBtn = document.createElement('button');
        visBtn.className = 'btn btn-ghost btn-xs btn-square';
        visBtn.appendChild(faIcon(layer.visible ? 'visibility' : 'visibility_off'));
        visBtn.onclick = (e) => { e.stopPropagation(); this.toggleLayerVisibility(layerId); };
        actions.appendChild(visBtn);

        // Layer reorder controls (always present — no Sortable to fall back to).
        // Re-resolve the target layer from the row's data-id at click time so
        // the action is always tied to the row the user actually clicked.
        {
            const targetForRow = (btn) => {
                const owner = btn.closest('[data-type="layer"]');
                const id = owner?.dataset?.id;
                if (!id) return null;
                return this.fabric?.getLayer?.(id) || layer;
            };

            const upBtn = document.createElement('button');
            upBtn.className = 'btn btn-ghost btn-xs btn-square';
            upBtn.title = 'Move layer up';
            upBtn.appendChild(faIcon('fa-arrow-up', 'text-xs'));
            upBtn.onclick = (e) => {
                e.stopPropagation();
                this.fabric?.moveLayer?.(targetForRow(upBtn) || layer, 'up');
                this._dataVersion++; this.requestRender(true);
            };

            const downBtn = document.createElement('button');
            downBtn.className = 'btn btn-ghost btn-xs btn-square';
            downBtn.title = 'Move layer down';
            downBtn.appendChild(faIcon('fa-arrow-down', 'text-xs'));
            downBtn.onclick = (e) => {
                e.stopPropagation();
                this.fabric?.moveLayer?.(targetForRow(downBtn) || layer, 'down');
                this._dataVersion++; this.requestRender(true);
            };

            actions.append(upBtn, downBtn);
        }

        // Annotations under this layer render as separate sibling rows on the
        // spacer; the windowing path positions them by absolute offset. The
        // header row is the only DOM the layer template emits.

        return wrapper;
    }

    /**
     * Lazy-build a static skeleton for annotation rows. Cloned per row to skip
     * ~12 createElement+className+setAttribute calls per render. Only the
     * dynamic bits (text, color, classes, dataset, factory icon, action
     * buttons) are written after clone.
     */
    _getAnnotationTemplate() {
        if (this._annotationRowTemplate) return this._annotationRowTemplate;

        const root = document.createElement('div');
        root.dataset.tplRole = 'row';
        root.dataset.type = 'annotation';

        // Drag handle was a Sortable affordance — no longer functional. Hide
        // entirely (kept in the template only for class continuity if any
        // external CSS depends on it).
        const dragHandle = document.createElement('div');
        dragHandle.dataset.tplRole = 'dragHandle';
        dragHandle.className = 'hidden';

        const iconBox = document.createElement('div');
        iconBox.dataset.tplRole = 'iconBox';
        iconBox.className = 'flex-shrink-0 flex items-center justify-center w-5';
        iconBox.style.pointerEvents = 'none';

        const content = document.createElement('div');
        content.className = 'flex-1 min-w-0 leading-tight';
        content.style.pointerEvents = 'none';

        const title = document.createElement('div');
        title.dataset.tplRole = 'title';
        title.className = 'text-sm font-medium truncate';

        const subText = document.createElement('div');
        subText.className = 'text-[10px] opacity-50 flex gap-2 items-center';

        const time = document.createElement('span');
        time.dataset.tplRole = 'time';

        const sep = document.createTextNode(' • ');

        const area = document.createElement('span');
        area.dataset.tplRole = 'area';

        const filteredBadge = document.createElement('span');
        filteredBadge.dataset.tplRole = 'filteredBadge';
        filteredBadge.className = 'badge badge-ghost badge-xs hidden';
        filteredBadge.textContent = 'filtered';

        subText.append(time, sep, area, filteredBadge);
        content.append(title, subText);

        const actions = document.createElement('div');
        actions.dataset.tplRole = 'actions';

        root.append(dragHandle, iconBox, content, actions);

        this._annotationRowTemplate = root;
        return root;
    }

    _renderAnnotation(object) {
        const factory = this.context.getAnnotationObjectFactory(object.factoryID);
        const isFiltered = !!this.context.isAnnotationFilteredOut?.(object);

        // Clone the static skeleton, then write per-row data.
        const row = this._getAnnotationTemplate().cloneNode(true);
        row.id = this.getAnnotationElementId(object.label);
        row.dataset.id = String(object.incrementId);
        row.className = `group/ann flex items-center gap-3 px-2 py-1 border-l-4 border-transparent history-item-row transition-all ${isFiltered ? 'opacity-45 saturate-50 cursor-not-allowed' : 'hover:bg-base-300/50 cursor-pointer'}`.trim();
        if (isFiltered) row.setAttribute('aria-disabled', 'true');

        const color = this.fabric.getAnnotationColor?.(object) || 'var(--fallback-bc,black)';
        row.style.borderLeftColor = color;

        // Role lookups on the small clone subtree are cheap (constant DOM).
        const iconBox = row.querySelector('[data-tpl-role="iconBox"]');
        const titleEl = row.querySelector('[data-tpl-role="title"]');
        const timeEl = row.querySelector('[data-tpl-role="time"]');
        const areaEl = row.querySelector('[data-tpl-role="area"]');
        const filteredBadgeEl = row.querySelector('[data-tpl-role="filteredBadge"]');
        const actionsEl = row.querySelector('[data-tpl-role="actions"]');

        const objectIcon = factoryIcon(factory?.getIcon?.() || 'fa-tag');
        objectIcon.style.color = color;
        iconBox.appendChild(objectIcon);

        titleEl.textContent = this._getAnnotationDisplayText(object);
        if (isFiltered) titleEl.classList.add('line-through');

        timeEl.textContent = new Date(object.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const area = factory?.getArea?.(object);
        areaEl.textContent = area ? this._formatArea(area) : 'No area';
        if (isFiltered) filteredBadgeEl.classList.remove('hidden');

        actionsEl.className = `flex gap-0.5 ${isFiltered ? 'opacity-30' : 'opacity-0 group-hover/ann:opacity-100'}`.trim();

        // Explicit reorder + move-to-layer affordances replace the old
        // SortableJS drag-reorder.
        if (!isFiltered) {
            // Re-resolve via the row's data-id at click time. The closure's
            // `object` is correct in all paths I can trace, but resolving from
            // the visible row's id makes the action provably tied to the row
            // the user actually clicked, regardless of selection state on the
            // canvas.
            const targetForRow = (btn) => {
                const owner = btn.closest('[data-type="annotation"]');
                const id = Number(owner?.dataset?.id);
                return Number.isFinite(id)
                    ? this.fabric?.findObjectOnCanvasByIncrementId?.(id)
                    : null;
            };

            const upBtn = document.createElement('button');
            upBtn.className = 'btn btn-ghost btn-xs btn-square';
            upBtn.title = 'Move up';
            upBtn.appendChild(faIcon('fa-arrow-up', 'text-xs'));
            upBtn.onclick = (e) => {
                e.stopPropagation();
                const obj = targetForRow(upBtn) || object;
                this.fabric?.moveAnnotation?.(obj, 'up');
                this._dataVersion++; this.requestRender(true);
            };

            const downBtn = document.createElement('button');
            downBtn.className = 'btn btn-ghost btn-xs btn-square';
            downBtn.title = 'Move down';
            downBtn.appendChild(faIcon('fa-arrow-down', 'text-xs'));
            downBtn.onclick = (e) => {
                e.stopPropagation();
                const obj = targetForRow(downBtn) || object;
                this.fabric?.moveAnnotation?.(obj, 'down');
                this._dataVersion++; this.requestRender(true);
            };

            const layerBtn = document.createElement('button');
            layerBtn.className = 'btn btn-ghost btn-xs btn-square';
            layerBtn.title = 'Move to layer';
            layerBtn.appendChild(faIcon('fa-layer-group', 'text-xs'));
            layerBtn.onclick = (e) => {
                e.stopPropagation();
                const obj = targetForRow(layerBtn) || object;
                this._openMoveToLayerMenu(layerBtn, obj);
            };

            actionsEl.append(upBtn, downBtn, layerBtn);
        }

        // Per-row click handler is NOT attached: the delegated handler on
        // layerLogsEl (installed once in mount()) handles annotation clicks
        // and computes _getFocusBBox lazily there.

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
        const fabric = this.fabric;
        const object = fabric?.findObjectOnCanvasByIncrementId?.(Number(incrementId));
        if (!object) return;

        const additive = !!(event?.ctrlKey || event?.metaKey);
        const range = !!event?.shiftKey;

        if (range) {
            this._selectRangeTo(Number(incrementId));
        } else if (additive) {
            const selected = fabric.getSelectedAnnotations?.() || [];
            const isSelected = selected.some(o => o?.incrementId === object.incrementId);
            if (isSelected) fabric.deselectAnnotation?.(object, false);
            else fabric.selectAnnotation?.(object, false, false);
            this._selectionAnchorId = object.incrementId;
        } else {
            fabric.selectAnnotation?.(object, false, true);
            this._selectionAnchorId = object.incrementId;
            // Plain click → pan/zoom the OSD viewport to the row's bbox.
            // Skipped for additive/range so multi-select doesn't yank the view.
            this._focusViewportOn(bbox);
        }

        // Kept for any external listeners — historically emitted on every row click.
        this.context.raiseEvent('history-select', { incrementId, originalEvent: event });
    }

    _selectRangeTo(toIncrementId) {
        const fabric = this.fabric;
        const rows = this._virtualRows;
        if (!fabric || !Array.isArray(rows) || !rows.length) return;

        const toIdx = rows.findIndex(r => r.kind === 'ann' && r.obj?.incrementId === toIncrementId);
        if (toIdx === -1) return;

        // No anchor → degrade to a plain single-row select on the clicked row.
        let fromIdx = -1;
        if (this._selectionAnchorId !== null) {
            fromIdx = rows.findIndex(r => r.kind === 'ann' && r.obj?.incrementId === this._selectionAnchorId);
        }
        if (fromIdx === -1) {
            fabric.selectAnnotation?.(rows[toIdx].obj, false, true);
            this._selectionAnchorId = toIncrementId;
            return;
        }

        const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        // Reset selection then add each annotation in range. Anchor stays put
        // so the user can refine the range with another shift+click.
        fabric.selectAnnotation?.(rows[lo].obj, false, true);
        for (let i = lo + 1; i <= hi; i++) {
            const r = rows[i];
            if (r.kind !== 'ann' || !r.obj) continue;
            if (this.context.isAnnotationFilteredOut?.(r.obj)) continue;
            fabric.selectAnnotation?.(r.obj, false, false);
        }
    }

    _focusViewportOn(bbox) {
        const viewer = this.viewer;
        if (!viewer || !bbox || !window.OpenSeadragon) return;

        const tImage = viewer.scalebar?.getReferencedTiledImage?.()
            || viewer.world?.getItemAt?.(0);
        if (!tImage?.imageToViewportRectangle) return;

        const left = Number(bbox.left ?? 0);
        const top = Number(bbox.top ?? 0);
        const width = Number(bbox.width ?? 0);
        const height = Number(bbox.height ?? 0);

        // Zero-size focus zones (point annotations or fallback center) → just
        // pan to the point and keep the user's current zoom.
        if (width <= 0 || height <= 0) {
            const vpPt = tImage.imageToViewportCoordinates(new OpenSeadragon.Point(left, top));
            viewer.viewport.panTo(vpPt, false);
            return;
        }

        // Inflate the bbox around its center so the annotation occupies the
        // middle ~33% of the viewport with breathing room around it.
        // Without padding fitBounds would push the annotation edge-to-edge,
        // which is disorienting for small features.
        const padFactor = 5;
        const cx = left + width / 2;
        const cy = top + height / 2;
        const padW = width * padFactor;
        const padH = height * padFactor;
        const rect = new OpenSeadragon.Rect(cx - padW / 2, cy - padH / 2, padW, padH);
        const bounds = tImage.imageToViewportRectangle(rect);
        if (viewer.tools?.focus) {
            viewer.tools.focus({ bounds });
        } else {
            viewer.viewport.fitBoundsWithConstraints(bounds, false);
        }
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
        this._updateDeleteSelectionHeaderButton(false);
    }

    _disableForEdit() {
        this._updateDeleteSelectionHeaderButton(true);
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
