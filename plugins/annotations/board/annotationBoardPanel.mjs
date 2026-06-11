const { div, style, input, span, button } = globalThis.van.tags;

// Auto-grouping replaces row-virtualization. When a single preset has
// ≥ THRESHOLD annotations on the same level (root or one specific layer),
// those annotations collapse into a single group row showing icon + count.
// The user's structurally-distinct annotations (those without high-volume
// peers) still render as individual rows. When members of a group are
// selected on canvas, the group exposes up to CHILDREN_VISIBLE child rows
// directly under itself so the user can manipulate the active selection
// per-row; on full deselect, the tail vanishes.
const BOARD_PRESET_GROUP_THRESHOLD = 50;
const BOARD_GROUP_CHILDREN_VISIBLE = 10;
// Hard cap on the number of annotation rows returned by free-text search.
// Beyond this we emit a "+N more matches" tail so the user knows their query
// is broader than the panel can usefully display — they should refine the
// query rather than scroll a huge match list.
const BOARD_SEARCH_RESULT_LIMIT = 20;

function sanitizeId(value) {
    return String(value ?? 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

const FA_ICON_MAP = {
    chevron_right: 'ph-caret-right',
    expand_more: 'ph-caret-down',
    visibility: 'ph-eye',
    visibility_off: 'ph-eye-slash',
    arrow_upward: 'ph-arrow-up',
    arrow_downward: 'ph-arrow-down',
    edit: 'ph-note-pencil',
    question_mark: 'ph-question',
    visibility_lock: 'ph-user-circle-gear',
};

function faIcon(name, extraClasses = '') {
    const el = document.createElement('i');
    const key = String(name ?? '').trim();
    if (key.startsWith('ph-')) {
        el.className = `ph-light ${key} ${extraClasses}`.trim();
    } else {
        const mapped = FA_ICON_MAP[key] || (key.startsWith('fa-') ? key : 'fa-tag');
        // FA_ICON_MAP values are Phosphor glyphs — they need the `ph-light`
        // font family, not `fa-solid`, or the codepoint renders blank.
        const family = mapped.startsWith('ph-') ? 'ph-light' : 'fa-solid';
        el.className = `${family} ${mapped} ${extraClasses}`.trim();
    }
    el.setAttribute('aria-hidden', 'true');
    return el;
}

function factoryIcon(icon, extraClasses = '') {
    const el = document.createElement('i');
    const tokens = String(icon ?? 'fa-tag').trim().split(/\s+/).filter(Boolean);

    if (tokens.some(t => t.startsWith('ph-'))) {
        const phName = tokens.find(t => t.startsWith('ph-') && t !== 'ph-light') || 'ph-tag';
        el.className = ['ph-light', phName, extraClasses].filter(Boolean).join(' ');
    } else {
        const hasStyleClass = tokens.some(token =>
            ['fa-solid', 'fa-regular', 'fa-light', 'fa-thin', 'fa-duotone', 'fa-brands'].includes(token)
        );
        const hasIconClass = tokens.some(token => token.startsWith('fa-') && !token.startsWith('fa-rotate'));

        if (!hasStyleClass) tokens.unshift('fa-solid');
        if (!hasIconClass) tokens.push('fa-tag');

        el.className = [...tokens, extraClasses].filter(Boolean).join(' ').trim();
    }
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
        this._editUiActive = false;
        this._delegatedClickInstalled = false;

        this.root = null;
        this.rootComponent = null;
        this.bodyEl = null;
        this.layerLogsEl = null;
        this.deleteButton = null;

        // Free-text filter applied during _buildRows; empty string disables.
        this._searchQuery = '';

        // Data-version + last-built cursor. We always rebuild on render now
        // (the row count is bounded by auto-grouping), but we keep the version
        // as a cheap "did anything change since last paint" guard for callers
        // that want to skip a redundant repaint.
        this._dataVersion = 0;
        this._lastBuiltVersion = -1;
        this._wrapperHandlers = null;       // [{event, fn}] for unsubscribe in destroy()

        // Lazy-built row templates (cached after first use).
        this._annotationRowTemplate = null;
        this._layerRowTemplate = null;

        // Result of the last _buildRows() call. Plain array of row descriptors
        // (kind: 'layer' | 'ann' | 'group' | 'group-overflow'); rebuilt when
        // _dataVersion changes or selection changes. The row count is bounded
        // by O(unique-presets-per-level + selected-children) so we render every
        // row with plain DOM flow — no virtualization.
        this._rows = null;

        // Last row touched by a non-shift click. Shift+click selects the
        // contiguous range between this anchor and the clicked row.
        // Stored as the row's incrementId.
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

        // Toggled search + filter panel (hidden by default), opened by the
        // header search button — same inline-expand idiom as the viewer-menu
        // settings cog. Hosts the free-text search box and the annotation
        // filter controls (button + active-filter badges).
        this.filterBadgesEl = div({ class: 'flex flex-wrap gap-1 mt-2 min-h-6' });
        this.searchPanelEl = div({
                id: `${this.containerId}-search-panel`,
                class: 'hidden px-2 py-2 border-b border-base-300 bg-base-100/40'
            },
            input({
                type: 'search',
                placeholder: this.plugin.t?.('annotations.board.searchPlaceholder') || 'Search annotations…',
                class: 'input input-xs input-bordered w-full',
                oninput: (e) => this._onSearchInput(e.target.value)
            }),
            div({ class: 'flex items-center justify-between gap-2 mt-2' },
                span({ class: 'text-[10px] uppercase font-bold opacity-50' }, this.plugin.t('annotations.filters.title')),
                button({
                    type: 'button',
                    class: 'btn btn-ghost btn-xs',
                    onclick: () => this.plugin._openAnnotationFilterModal?.(this.viewerId)
                },
                    span({ class: 'ph-light ph-funnel mr-1 text-xs' }),
                    this.plugin.t('annotations.filters.button')
                )
            ),
            this.filterBadgesEl
        );

        this.rootComponent = new UI.Div({
                id: this.containerId,
                extraClasses: 'relative flex flex-col h-full min-h-0 annotation-board-panel'
            },
            new UI.Div({
                    id: this.headerId,
                    extraClasses: 'flex items-center gap-2 px-2 py-2 border-b border-base-300 sticky top-0 bg-base-100 z-10'
                },
                new UI.Div({ extraClasses: 'text-sm flex-1 min-w-0 truncate uppercase font-bold opacity-50' }, this.plugin.t('annotations.board.title')),
                new UI.Div({ extraClasses: 'flex items-center gap-1' },
                    new UI.Button({
                        id: `${this.containerId}-create-layer`,
                        type: UI.Button.TYPE.NONE,
                        extraClasses: 'btn btn-ghost btn-xs btn-square',
                        extraProperties: { title: this.plugin.t('annotations.board.createLayer') },
                        onClick: () => this.fabric?.createLayer()
                    }, new UI.PhIcon({ name: 'ph-stack-plus' })),
                    new UI.Button({
                        id: `${this.containerId}-refresh`,
                        type: UI.Button.TYPE.NONE,
                        extraClasses: 'btn btn-ghost btn-xs btn-square',
                        extraProperties: { title: this.plugin.t('annotations.board.refresh') },
                        onClick: () => this.requestRender(true)
                    }, new UI.PhIcon({ name: 'ph-arrows-clockwise' })),
                    new UI.Button({
                        id: `${this.containerId}-collapse-all`,
                        type: UI.Button.TYPE.NONE,
                        extraClasses: 'btn btn-ghost btn-xs btn-square',
                        extraProperties: { title: this.plugin.t('annotations.board.collapseAllLayers') },
                        onClick: () => this._toggleAllLayersCollapse()
                    }, new UI.PhIcon({ name: 'ph-arrows-in-line-vertical' })),
                    new UI.Button({
                        id: `${this.containerId}-search-toggle`,
                        type: UI.Button.TYPE.NONE,
                        extraClasses: 'btn btn-ghost btn-xs btn-square',
                        extraProperties: { title: this.plugin.t('annotations.board.search') },
                        onClick: () => this._toggleSearchPanel()
                    }, new UI.PhIcon({ name: 'ph-magnifying-glass' }))
                )
            ),
            this.searchPanelEl,
            new UI.Div({
                id: this.bodyId,
                extraClasses: 'flex-1 overflow-y-auto px-0 py-2 min-h-0'
            }, div({ id: this.layerLogsId, class: 'h-full overflow-auto cursor-pointer pb-4' }))
        );

        this.root = this.rootComponent.create();
        return this.root;
    }

    /**
     * Collapse every layer if any is currently expanded; otherwise expand all.
     * Acts on the same `_collapsedLayers` set the per-layer caret toggles, so
     * the two stay in sync. The header button's icon/tooltip flips to advertise
     * the next action.
     */
    _toggleAllLayersCollapse() {
        const layers = this.fabric?.getAllLayers?.() || [];
        const ids = layers.map(l => String(l.id)).filter(Boolean);
        if (!ids.length) return;

        const allCollapsed = ids.every(id => this._collapsedLayers.has(id));
        if (allCollapsed) {
            for (const id of ids) this._collapsedLayers.delete(id);
        } else {
            for (const id of ids) this._collapsedLayers.add(id);
        }
        this._syncCollapseAllButton(!allCollapsed);

        this._dataVersion++;
        this.requestRender(true);
    }

    /** Reflect collapsed/expanded-all state on the header toggle button. */
    _syncCollapseAllButton(nowCollapsed) {
        const btn = this.root?.querySelector(`#${CSS.escape(`${this.containerId}-collapse-all`)}`);
        const icon = btn?.querySelector('i');
        if (icon) {
            icon.classList.toggle('ph-arrows-in-line-vertical', !nowCollapsed);
            icon.classList.toggle('ph-arrows-out-line-vertical', nowCollapsed);
        }
        if (btn) {
            btn.title = this.plugin.t(nowCollapsed
                ? 'annotations.board.expandAllLayers'
                : 'annotations.board.collapseAllLayers');
        }
    }

    /** Toggle the inline search + filter panel; refresh filter badges on open. */
    _toggleSearchPanel() {
        if (!this.searchPanelEl) return;
        const opening = this.searchPanelEl.classList.contains('hidden');
        this.searchPanelEl.classList.toggle('hidden', !opening);
        if (opening) {
            this.renderFilterBadges();
            this.searchPanelEl.querySelector('input[type="search"]')?.focus();
        }
    }

    /**
     * Render active annotation-filter badges into the search panel. Called by
     * the plugin's `_refreshAnnotationFilterBadges` and on panel open. Each
     * badge carries an inline remove (×) that drops that filter.
     */
    renderFilterBadges() {
        const host = this.filterBadgesEl;
        if (!host) return;

        const filters = this.context.getAnnotationFilters?.() || [];
        const badges = filters.map(filter => {
            const description = this.context.describeAnnotationFilter?.(filter);
            const node = document.createElement('span');
            node.className = 'badge badge-outline badge-sm gap-1';
            node.textContent = description?.text || filter.id;

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn btn-ghost btn-xs btn-square min-h-0 h-4 w-4 ml-1';
            remove.title = this.plugin.t('annotations.filters.remove');
            remove.appendChild(document.createTextNode('×'));
            remove.onclick = (e) => {
                e.stopPropagation();
                this.context.removeAnnotationFilter?.(filter.id);
            };
            node.appendChild(remove);
            return node;
        });

        if (!badges.length) {
            const empty = document.createElement('div');
            empty.className = 'text-xs opacity-50';
            empty.textContent = this.plugin.t('annotations.filters.empty');
            host.replaceChildren(empty);
            return;
        }
        host.replaceChildren(...badges);
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
            this._installDelegatedHandlers();
            this._mountSetupDone = true;
        }

        this._subscribeToWrapperEvents();

        this.requestRender(true);
    }

    destroy() {
        this.commitEdit(true);
        this._unsubscribeFromWrapperEvents();
        this._mounted = false;
    }

    /**
     * One delegated click handler on layerLogsEl, routing to the per-kind
     * dispatcher based on the closest row's `data-type`. Per-button handlers
     * (▲ / ▼ / 📁 / chevron) keep their own onclick and stopPropagation so
     * they don't trigger the row click.
     */
    _installDelegatedHandlers() {
        if (!this.layerLogsEl || this._delegatedClickInstalled) return;
        this.layerLogsEl.addEventListener('click', (e) => {
            // Group rows are intentionally not clickable on left-click. Bulk-
            // selecting 50+ annotations cascades through selectAnnotation /
            // annotation-selection-changed and freezes the viewer; bulk
            // operations live behind the right-click context menu instead.
            if (e.target.closest('[data-type="annotation-group"]')) return;
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
        // Right-click on annotation / group rows opens the same menu the
        // canvas does, with the row's annotation pre-resolved as the active
        // target and `source: 'board'` so providers can disable spatially-
        // invalid actions (e.g. Paste-at-mouse).
        this.layerLogsEl.addEventListener('contextmenu', (e) => {
            let active = null;
            const groupRow = e.target.closest('[data-type="annotation-group"]');
            if (groupRow) {
                const key = String(groupRow.dataset.id || '');
                const group = this._findGroupRow(key);
                active = group?.members?.[0] ?? null;
            } else {
                const annRow = e.target.closest('[data-type="annotation"]');
                if (annRow) {
                    const id = Number(annRow.dataset.id);
                    if (Number.isFinite(id)) {
                        active = this.fabric?.findObjectOnCanvasByIncrementId?.(id) ?? null;
                    }
                }
            }

            if (!active) return; // layer rows / empty gutters fall through

            e.preventDefault();
            const viewer = this.fabric?.viewer ?? this.viewer ?? null;
            window.CanvasContextMenu?.open?.({
                event: e,
                viewer,
                active,
                source: 'board',
            });
        });
        this._delegatedClickInstalled = true;
    }

    /**
     * Subscribe to FabricWrapper events that mutate the row composition.
     * Each handler bumps _dataVersion so the next render rebuilds _rows.
     * Selection changes are included because group rows expose a tail of
     * selected children and the underlying selection set drives that tail.
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
            'annotation-selection-changed',
            'layer-selection-changed',
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
        }

        // Row count is bounded (auto-grouping collapses high-volume presets),
        // so we always rebuild on render. Cheap relative to scrolling 1000s of
        // virtualized DOM rows.
        this._buildRows();
        this._lastBuiltVersion = this._dataVersion;
        this._renderRows();
        this._updateDeleteSelectionHeaderButton();
        this._updateActiveLayerVisual(fabric.getActiveLayer?.());
    }

    /**
     * Build the panel's row list from current fabric state.
     *
     * For each level (root, or one specific layer) we tally annotations by
     * `presetID` (falling back to `factoryID` so untyped annotations still
     * group sensibly). When the count for a single preset on a single level
     * reaches BOARD_PRESET_GROUP_THRESHOLD, the panel emits one group row
     * instead of N annotation rows. Selection state then drives a tail of
     * up-to-CHILDREN_VISIBLE individual rows for any selected members of
     * that group, plus an overflow indicator if the cap is exceeded.
     *
     * Groups are always collapsed: there's no expand affordance. Members
     * surface only via canvas selection (the children tail) or via search.
     */
    _buildRows() {
        const fabric = this.fabric;
        const rows = [];
        if (!fabric) { this._rows = rows; return; }

        const matches = this._buildSearchMatcher();
        const selectedSet = new Set((fabric.getSelectedAnnotations?.() || []).map(o => o?.incrementId));
        const isFiltered = (o) => !!this.context.isAnnotationFilteredOut?.(o);

        // Search-scope cap: emit at most BOARD_SEARCH_RESULT_LIMIT matches
        // across all levels. The remaining matches feed a "+N more matches"
        // tail row appended once at the end of _buildRows.
        let searchEmitted = 0;
        let searchHidden = 0;

        const emitLevel = (levelKey, sourceObjects, opts = {}) => {
            const { layerId = null } = opts;
            // Apply search at the level: if search active, we render only matches
            // and skip grouping (so users can find what they typed).
            if (matches) {
                for (const o of sourceObjects) {
                    if (!matches(this._annotationHaystack(o))) continue;
                    if (searchEmitted >= BOARD_SEARCH_RESULT_LIMIT) {
                        searchHidden++;
                        continue;
                    }
                    rows.push({ kind: 'ann', obj: o, id: String(o.incrementId), layerId });
                    searchEmitted++;
                }
                return;
            }

            // Tally by preset (presetID, fallback to factoryID).
            const buckets = new Map();
            const order = [];
            for (const o of sourceObjects) {
                const key = this._presetKeyOf(o);
                let bucket = buckets.get(key);
                if (!bucket) {
                    bucket = { key, members: [] };
                    buckets.set(key, bucket);
                    order.push(key);
                }
                bucket.members.push(o);
            }

            for (const key of order) {
                const bucket = buckets.get(key);
                const overThreshold = bucket.members.length >= BOARD_PRESET_GROUP_THRESHOLD;

                if (!overThreshold) {
                    // Below the threshold → render individually.
                    for (const o of bucket.members) {
                        rows.push({ kind: 'ann', obj: o, id: String(o.incrementId), layerId });
                    }
                    continue;
                }

                // Auto-grouped. The group row is always collapsed; selected
                // members surface as a children tail directly underneath.
                const groupKey = `${levelKey}|${key}`;
                const selectedMembers = bucket.members.filter(o => selectedSet.has(o.incrementId));
                rows.push({
                    kind: 'group',
                    groupKey,
                    levelKey,
                    layerId,
                    presetKey: key,
                    members: bucket.members,
                    selectedMembers,
                });
                const visible = selectedMembers.slice(0, BOARD_GROUP_CHILDREN_VISIBLE);
                for (const o of visible) {
                    if (isFiltered(o)) continue;
                    rows.push({ kind: 'ann', obj: o, id: String(o.incrementId), layerId, parentGroupKey: groupKey });
                }
                if (selectedMembers.length > visible.length) {
                    rows.push({
                        kind: 'group-overflow',
                        groupKey,
                        layerId,
                        hidden: selectedMembers.length - visible.length,
                    });
                }
            }
        };

        for (const entry of this._getBoardEntries()) {
            if (entry.type === 'layer') {
                const layer = entry.layer;
                if (!layer) continue;
                const layerId = String(layer.id);
                const layerObjects = layer.getObjects?.() || [];

                // With an active search, skip a layer entirely unless its
                // name matches OR at least one member matches.
                if (matches) {
                    const layerNameHit = matches(this._layerHaystack(layer));
                    const hasMemberHit = layerNameHit
                        || layerObjects.some(o => matches(this._annotationHaystack(o)));
                    if (!layerNameHit && !hasMemberHit) continue;
                }

                rows.push({ kind: 'layer', layer, id: layerId });
                if (this._collapsedLayers.has(layerId)) continue;
                emitLevel(`layer:${layerId}`, layerObjects, { layerId });
            }
            // Root annotations are emitted in one batch below so emitLevel can
            // tally them as a single level for grouping.
        }

        // Root annotations: assembled in _boardOrder sequence so per-row
        // Move up/down at the root level visibly reorders the panel.
        // _boardOrder is the canonical root-level sequence maintained by the
        // wrapper (moveAnnotation, upsertBoardItem, etc.); canvas order is
        // unrelated. Single pass over _boardOrder + one pass over canvas
        // objects to catch any annotation that exists on canvas but is
        // missing from _boardOrder (defensive — recovery paths).
        const isAnn = fabric.isAnnotation?.bind(fabric);
        const boardOrder = fabric.getBoardOrder?.() || [];
        const rootById = new Map();
        for (const o of fabric.canvas?.getObjects?.() || []) {
            if (isAnn?.(o) && this._isRootAnnotation(o)
                && o.incrementId !== undefined && o.incrementId !== null) {
                rootById.set(String(o.incrementId), o);
            }
        }
        const rootAnnotations = [];
        const seenRoot = new Set();
        for (const e of boardOrder) {
            if (e.type !== 'annotation') continue;
            const id = String(e.id);
            const obj = rootById.get(id);
            if (!obj) continue;
            rootAnnotations.push(obj);
            seenRoot.add(id);
        }
        for (const [id, obj] of rootById) {
            if (!seenRoot.has(id)) rootAnnotations.push(obj);
        }
        if (rootAnnotations.length) {
            emitLevel('root', rootAnnotations, { layerId: null });
        }

        if (matches && searchHidden > 0) {
            rows.push({ kind: 'search-overflow', hidden: searchHidden });
        }

        this._rows = rows;
    }

    /** Resolve a stable "preset bucket" key for an annotation. */
    _presetKeyOf(o) {
        if (!o) return 'unknown';
        if (o.presetID !== undefined && o.presetID !== null && String(o.presetID) !== '') {
            return `p:${String(o.presetID)}`;
        }
        if (o.factoryID !== undefined && o.factoryID !== null && String(o.factoryID) !== '') {
            return `f:${String(o.factoryID)}`;
        }
        return 'unknown';
    }

    /** Lookup helper for the delegated context-menu handler. */
    _findGroupRow(groupKey) {
        if (!this._rows) return null;
        for (const r of this._rows) {
            if (r.kind === 'group' && r.groupKey === groupKey) return r;
        }
        return null;
    }

    _renderRows() {
        if (!this.layerLogsEl) return;
        const frag = document.createDocumentFragment();
        const rows = this._rows || [];

        // Layer-children rows (annotations + groups carrying a `layerId`) are
        // wrapped in a single sub-container per layer so the whole block gets
        // ONE tree line on the left, instead of each row drawing its own and
        // clashing with the per-row preset colour stripe. The container opens
        // when a layer header is rendered and closes when we hit any non-
        // layer-child row.
        let layerChildContainer = null;
        let openLayerId = null;

        const closeLayerContainer = () => {
            if (layerChildContainer && layerChildContainer.children.length === 0) {
                // empty layer (collapsed or no children) — drop the container
                layerChildContainer.remove?.();
            }
            layerChildContainer = null;
            openLayerId = null;
        };

        const renderRow = (row) => {
            if (row.kind === 'ann') {
                return this._renderAnnotation(row.obj, { parentGroupKey: row.parentGroupKey, layerId: row.layerId });
            }
            if (row.kind === 'group') return this._renderPresetGroup(row);
            if (row.kind === 'group-overflow') return this._renderGroupOverflow(row);
            return null;
        };

        for (const row of rows) {
            if (row.kind === 'layer') {
                closeLayerContainer();
                const layerEl = this._renderLayer(row.layer);
                if (layerEl) frag.appendChild(layerEl);
                const layerId = String(row.layer?.id ?? '');
                if (layerId && !this._collapsedLayers.has(layerId)) {
                    layerChildContainer = document.createElement('div');
                    layerChildContainer.dataset.role = 'layer-children';
                    layerChildContainer.className = 'ml-3 border-l border-base-content/15 bg-base-200/30 mb-1';
                    openLayerId = layerId;
                    frag.appendChild(layerChildContainer);
                }
                continue;
            }

            if (row.kind === 'search-overflow') {
                closeLayerContainer();
                const el = this._renderSearchOverflow(row);
                if (el) frag.appendChild(el);
                continue;
            }

            const rowLayerId = row.layerId ? String(row.layerId) : null;
            if (rowLayerId && rowLayerId === openLayerId) {
                const el = renderRow(row);
                if (el) layerChildContainer.appendChild(el);
            } else {
                closeLayerContainer();
                const el = renderRow(row);
                if (el) frag.appendChild(el);
            }
        }
        closeLayerContainer();

        this.layerLogsEl.replaceChildren(frag);
    }

    /**
     * Open the annotation actions dropdown anchored to the row's "more"
     * button. Sources items from `_buildAnnotationContextActions` directly
     * (NOT through `CanvasContextMenu.open`, which aggregates the recorder /
     * playground / etc. providers) so the dropdown only shows annotation
     * actions — preset / copy-cut-paste-delete / move-to-layer / group /
     * z-order / mark-private / view-measurements.
     */
    _openAnnotationActionsMenu(anchorBtn, object, originalEvent) {
        const fabric = this.fabric;
        if (!fabric || !object) return;

        const tree = this.plugin._buildAnnotationContextActions(object, fabric, {
            originalEvent,
            source: 'board',
            includePresetSelection: true,
            includeMarkAsPrivate: true,
            includeMoveToLayer: true,
        });

        // _buildAnnotationContextActions wraps everything under a single
        // "Annotation" parent on the flyout path; unwrap so the dropdown
        // opens directly to the action list.
        const items = (Array.isArray(tree) && tree.length === 1 && Array.isArray(tree[0].children))
            ? tree[0].children
            : tree;
        if (!Array.isArray(items) || !items.length) return;

        const ctxMenu = window.ContextMenu;
        if (ctxMenu?.open) ctxMenu.open(originalEvent, items);
        else window.DropDown?.open?.(originalEvent, items);
    }

    /**
     * Bulk variant of the layer-pick menu: lists destination layers and
     * reparents the entire `members` array atomically via
     * `fabric.setAnnotationsLayer`. Members are guaranteed to share a level
     * (groups are per-level), so we sample the first member's `layerID` to
     * decide whether the "(no layer)" choice applies and which layers to
     * exclude as the source.
     */
    _openMoveToLayerMenuForGroup(anchorBtn, members) {
        const fabric = this.fabric;
        if (!fabric || !members?.length) return;

        const existing = document.body.querySelector('[data-role="board-move-to-layer-menu"]');
        if (existing) { existing.remove(); }

        const sourceLayerId = members[0]?.layerID ? String(members[0].layerID) : '';
        const layers = (fabric.getAllLayers?.() || [])
            .filter(l => String(l.id) !== sourceLayerId);

        const menu = document.createElement('div');
        menu.dataset.role = 'board-move-to-layer-menu';
        menu.className = 'absolute z-50 menu menu-sm bg-base-200 rounded-box shadow border border-base-300';
        menu.style.minWidth = '180px';

        const apply = (targetLayerId) => {
            fabric.setAnnotationsLayer?.(members, targetLayerId);
        };

        const addItem = (label, onClick) => {
            const item = document.createElement('button');
            item.className = 'btn btn-ghost btn-xs justify-start w-full';
            item.textContent = label;
            item.onclick = (e) => { e.stopPropagation(); onClick(); menu.remove(); };
            menu.appendChild(item);
        };

        if (sourceLayerId) addItem('(no layer)', () => apply(null));
        for (const l of layers) {
            addItem(l.name || `Layer ${l.id}`, () => apply(l.id));
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
        const isSelected = !!this.fabric?.getSelectedLayers?.()
            ?.some(l => String(l?.id) === layerId);

        const wrapper = this._getLayerTemplate().cloneNode(true);
        wrapper.id = this.getLayerElementId(layerId);
        wrapper.dataset.id = layerId;
        if (isSelected) wrapper.classList.add('history-selected');

        const row = wrapper.querySelector('[data-tpl-role="row"]');
        const toggleBtn = wrapper.querySelector('[data-tpl-role="toggle"]');
        const nameEl = wrapper.querySelector('[data-tpl-role="name"]');
        const badgeEl = wrapper.querySelector('[data-tpl-role="badge"]');
        const areaEl = wrapper.querySelector('[data-tpl-role="area"]');
        const actions = wrapper.querySelector('[data-tpl-role="actions"]');

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
            upBtn.appendChild(faIcon('ph-arrow-up', 'text-xs'));
            upBtn.onclick = (e) => {
                e.stopPropagation();
                this.fabric?.moveLayer?.(targetForRow(upBtn) || layer, 'up');
            };

            const downBtn = document.createElement('button');
            downBtn.className = 'btn btn-ghost btn-xs btn-square';
            downBtn.title = 'Move layer down';
            downBtn.appendChild(faIcon('ph-arrow-down', 'text-xs'));
            downBtn.onclick = (e) => {
                e.stopPropagation();
                this.fabric?.moveLayer?.(targetForRow(downBtn) || layer, 'down');
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

    _renderAnnotation(object, opts = {}) {
        const factory = this.context.getAnnotationObjectFactory(object.factoryID);
        const isFiltered = !!this.context.isAnnotationFilteredOut?.(object);
        const isSelected = !!this.fabric?.getSelectedAnnotations?.()
            ?.some(o => o?.incrementId === object.incrementId);
        const isChild = !!opts.parentGroupKey;

        // Clone the static skeleton, then write per-row data.
        const row = this._getAnnotationTemplate().cloneNode(true);
        row.id = this.getAnnotationElementId(object.label);
        row.dataset.id = String(object.incrementId);
        if (opts.parentGroupKey) row.dataset.parentGroup = opts.parentGroupKey;
        if (opts.layerId) row.dataset.layerId = String(opts.layerId);
        row.className = [
            'group/ann flex items-center gap-3 px-2 py-1 border-l-4 border-transparent history-item-row transition-all',
            isFiltered ? 'opacity-45 saturate-50 cursor-not-allowed' : 'hover:bg-base-300/50 cursor-pointer',
            isChild ? 'pl-7' : '',
            isSelected ? 'history-selected' : '',
        ].filter(Boolean).join(' ').trim();
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

        const objectIcon = factoryIcon(factory?.getIcon?.() || 'ph-tag');
        objectIcon.style.color = color;
        iconBox.appendChild(objectIcon);

        titleEl.textContent = this._getAnnotationDisplayText(object);
        if (isFiltered) titleEl.classList.add('line-through');

        timeEl.textContent = new Date(object.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        areaEl.replaceChildren();
        const area = factory?.getArea?.(object);
        if (Number.isFinite(area) && area > 0) {
            // ph-bounding-box = area metric (square units).
            areaEl.append(
                faIcon('ph-bounding-box', 'text-[9px] mr-0.5 align-middle'),
                this._formatArea(area)
            );
        } else {
            // Fall back to length for 1-D shapes (ruler, line, angle) where
            // `getArea` is unimplemented or returns 0. `_formatLength` uses
            // `imageLengthToGivenUnits` which formats with linear units
            // (µm, mm, …) — never ². ph-ruler marks the value as length.
            const length = factory?.getLength?.(object);
            if (Number.isFinite(length) && length > 0) {
                areaEl.append(
                    faIcon('ph-ruler', 'text-[9px] mr-0.5 align-middle'),
                    this._formatLength(length)
                );
            } else {
                areaEl.textContent = '—';
            }
        }
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

            // Stack up/down into a single column-shaped cell so the row
            // saves a button slot. Each half-height button still resolves
            // its target via `targetForRow` (data-id) at click time.
            const reorderCell = document.createElement('div');
            reorderCell.className = 'flex flex-col w-6';

            const upBtn = document.createElement('button');
            upBtn.className = 'btn btn-ghost btn-square min-h-0 w-6 px-0 py-0';
            upBtn.style.minHeight = '17px';
            upBtn.style.height = '17px';
            upBtn.title = 'Move up';
            upBtn.appendChild(faIcon('ph-caret-up', 'text-[10px]'));
            upBtn.onclick = (e) => {
                e.stopPropagation();
                const obj = targetForRow(upBtn) || object;
                this.fabric?.moveAnnotation?.(obj, 'up');
            };

            const downBtn = document.createElement('button');
            downBtn.className = 'btn btn-ghost btn-square min-h-0 h-4 w-6 px-0 py-0';
            downBtn.title = 'Move down';
            downBtn.style.minHeight = '17px';
            downBtn.style.height = '17px';
            downBtn.appendChild(faIcon('ph-caret-down', 'text-[10px]'));
            downBtn.onclick = (e) => {
                e.stopPropagation();
                const obj = targetForRow(downBtn) || object;
                this.fabric?.moveAnnotation?.(obj, 'down');
            };

            reorderCell.append(upBtn, downBtn);

            // Annotation-only actions dropdown — replaces the standalone
            // layer button. Builds items from `_buildAnnotationContextActions`
            // directly so the menu shows only annotation actions (no
            // recorder / playground / other providers).
            const menuBtn = document.createElement('button');
            menuBtn.className = 'btn btn-ghost btn-xs btn-square';
            menuBtn.title = 'Annotation actions';
            menuBtn.appendChild(faIcon('ph-dots-three-vertical', 'text-xs'));
            menuBtn.onclick = (e) => {
                e.stopPropagation();
                const obj = targetForRow(menuBtn) || object;
                this._openAnnotationActionsMenu(menuBtn, obj, e);
            };

            actionsEl.append(reorderCell, menuBtn);
        }

        // Per-row click handler is NOT attached: the delegated handler on
        // layerLogsEl (installed once in mount()) handles annotation clicks
        // and computes _getFocusBBox lazily there.

        return row;
    }

    /**
     * Render a "preset group" header row that stands in for N annotations
     * (N ≥ BOARD_PRESET_GROUP_THRESHOLD) sharing one preset on one level.
     * Plain click selects all members; ctrl-click toggles add/remove; right
     * click forwards to _openGroupContextMenu against the first member.
     * The group row is always collapsed — members surface only via canvas
     * selection, exposed as a children tail directly underneath.
     */
    _renderPresetGroup(groupRow) {
        const { groupKey, members, selectedMembers } = groupRow;
        const sample = members[0];
        const factory = sample
            ? this.context.getAnnotationObjectFactory?.(sample.factoryID)
            : null;
        const color = sample ? (this.fabric?.getAnnotationColor?.(sample) || 'var(--fallback-bc,black)') : 'var(--fallback-bc,black)';

        // Title prefers preset category; falls back to factory name.
        const presetMeta = sample?.presetID != null
            ? this.context?.presets?.get?.(sample.presetID)
            : null;
        const title = presetMeta?.getMetaValue?.('category')
            || presetMeta?.meta?.category?.value
            || factory?.title?.()
            || (sample?.factoryID ? String(sample.factoryID) : 'Group');

        const allSelected = selectedMembers.length === members.length;
        const someSelected = selectedMembers.length > 0;

        const row = document.createElement('div');
        row.dataset.type = 'annotation-group';
        row.dataset.id = groupKey;
        // Not left-clickable (bulk select would freeze the viewer); right-click
        // surfaces bulk actions instead. cursor-default + context-menu hint.
        row.className = [
            'group/grp flex items-center gap-3 px-2 py-1 border-l-4 history-item-row transition-all hover:bg-base-300/50 cursor-context-menu',
            allSelected ? 'history-selected' : '',
        ].filter(Boolean).join(' ').trim();
        row.title = 'Right-click for bulk actions';
        row.style.borderLeftColor = color;

        const iconBox = document.createElement('div');
        iconBox.className = 'flex-shrink-0 flex items-center justify-center w-5';
        iconBox.style.pointerEvents = 'none';
        iconBox.appendChild(factoryIcon(factory?.getIcon?.() || 'ph-tag'));
        iconBox.firstChild.style.color = color;

        const content = document.createElement('div');
        content.className = 'flex-1 min-w-0 leading-tight';
        content.style.pointerEvents = 'none';

        const titleEl = document.createElement('div');
        titleEl.className = 'text-sm font-semibold truncate';
        titleEl.textContent = title;

        const subText = document.createElement('div');
        subText.className = 'text-[10px] opacity-60 flex gap-2 items-center';
        const countEl = document.createElement('span');
        countEl.textContent = `${members.length} annotations`;
        subText.appendChild(countEl);
        if (someSelected) {
            const sep = document.createTextNode(' • ');
            const selEl = document.createElement('span');
            selEl.className = 'text-primary';
            selEl.textContent = `${selectedMembers.length} selected`;
            subText.append(sep, selEl);
        }
        content.append(titleEl, subText);

        row.append(iconBox, content);

        // Hover-actions: same affordances as per-annotation rows, but
        // operating on the whole `members` array. Wrapper APIs do this in
        // O(N) regardless of group size — no per-member loops on the panel
        // side, so a 5000-member group's button click stays instant.
        const actionsEl = document.createElement('div');
        actionsEl.dataset.tplRole = 'actions';
        actionsEl.className = 'flex gap-0.5 opacity-0 group-hover/grp:opacity-100';

        const reorderCell = document.createElement('div');
        reorderCell.className = 'flex flex-col w-6';

        const upBtn = document.createElement('button');
        upBtn.className = 'btn btn-ghost btn-square min-h-0 h-4 w-6 px-0 py-0';
        upBtn.title = 'Move group up';
        upBtn.appendChild(faIcon('ph-caret-up', 'text-[10px]'));
        upBtn.onclick = (e) => {
            e.stopPropagation();
            this.fabric?.moveAnnotationBlock?.(members, 'up');
        };

        const downBtn = document.createElement('button');
        downBtn.className = 'btn btn-ghost btn-square min-h-0 h-4 w-6 px-0 py-0';
        downBtn.title = 'Move group down';
        downBtn.appendChild(faIcon('ph-caret-down', 'text-[10px]'));
        downBtn.onclick = (e) => {
            e.stopPropagation();
            this.fabric?.moveAnnotationBlock?.(members, 'down');
        };

        reorderCell.append(upBtn, downBtn);

        const layerBtn = document.createElement('button');
        layerBtn.className = 'btn btn-ghost btn-xs btn-square';
        layerBtn.title = 'Move group to layer';
        layerBtn.appendChild(faIcon('ph-stack', 'text-xs'));
        layerBtn.onclick = (e) => {
            e.stopPropagation();
            this._openMoveToLayerMenuForGroup(layerBtn, members);
        };

        actionsEl.append(reorderCell, layerBtn);
        row.appendChild(actionsEl);

        return row;
    }

    /** Dimmed tail row indicating "+N more selected" beyond the visible cap. */
    _renderGroupOverflow(row) {
        const el = document.createElement('div');
        el.className = 'flex items-center gap-3 px-2 py-1 pl-7 text-xs opacity-50 italic';
        el.textContent = `+${row.hidden} more selected`;
        return el;
    }

    /** Dimmed tail row indicating search results truncated past the cap. */
    _renderSearchOverflow(row) {
        const el = document.createElement('div');
        el.className = 'flex items-center justify-center gap-2 px-2 py-2 mt-1 text-xs opacity-60 italic border-t border-base-300';
        el.textContent = `+${row.hidden} more matches — refine your search`;
        return el;
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
        const rows = this._rows;
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

    _formatLength(length) {
        return this.viewer?.scalebar?.imageLengthToGivenUnits ? this.viewer.scalebar.imageLengthToGivenUnits(length || 0) : String(length || 0);
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
