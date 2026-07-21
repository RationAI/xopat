import { AnnotationBoardPanel } from '../board/annotationBoardPanel.mjs';

const { div, button, span, h3 } = globalThis.van.tags;

function iconButton(icon, title, onClick, active = false) {
    const isPh = String(icon ?? '').trim().startsWith('ph-');
    const iconCls = isPh ? `ph-light ${icon}` : `fa-auto ${icon}`;
    return button({
        type: 'button',
        class: `btn btn-ghost btn-sm btn-square ${active ? 'btn-active' : ''}`.trim(),
        title,
        onclick: onClick,
    }, span({ class: iconCls }));
}

export const viewerMenuMethods = {
    setDrawOutline(enable) {
        // todo no way to change this for a single viewer for now -> presets are global
        this.context.setAnnotationCommonVisualProperty('modeOutline', enable);
        this._updateViewerControls();
    },

    _resolveViewerId(viewerOrId = undefined) {
        // Per-viewer UI/runtime state is keyed by the collision-free slot id
        // (viewer.id, e.g. "osd-0"), NOT the data-derived viewer.uniqueId. Two
        // viewports sharing the same background id share a uniqueId, so keying
        // UI by it collapses them onto one context store and duplicates DOM ids.
        // IO/persistence keeps using uniqueId (see io.mjs) — that is intentional.
        if (!viewerOrId) return VIEWER?.id;
        return typeof viewerOrId === 'object' ? viewerOrId.id : viewerOrId;
    },

    _getViewerUI(viewerOrId = undefined) {
        const viewerId = this._resolveViewerId(viewerOrId);
        if (!viewerId) return undefined;
        return this.getViewerContext(viewerId);
    },

    _toggleStrokeStyling(enable) {
        // The dedicated "Authors" tab was removed in the board redesign (the
        // panel no longer swaps between Classes/Annotations/Authors cards).
        // Author-stroke styling state is still tracked on the context; there is
        // simply no per-tab UI to toggle here anymore.
    },

    _refreshAnnotationFilterBadges(viewerOrId = undefined) {
        // Filter badges now live in the board panel's search/filter sub-panel.
        this._getViewerUI(viewerOrId)?.boardPanel?.renderFilterBadges?.();
    },

    _openAnnotationFilterModal(viewerOrId = undefined) {
        const viewerId = this._resolveViewerId(viewerOrId);
        const available = this.context.getAvailableAnnotationFilterValues?.(viewerId) || {};
        const active = this.context.getAnnotationFilters?.() || [];
        const activeByType = new Map(active.map(filter => [filter.type, filter]));

        const body = document.createElement('div');
        body.className = 'flex flex-col gap-4';

        const createSelectionSection = (type, title) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'flex flex-col gap-2';

            const header = document.createElement('div');
            header.className = 'text-sm font-medium';
            header.textContent = title;
            wrapper.appendChild(header);

            const select = new UI.TagSelect({
                placeholder: this.t('annotations.filters.selectPlaceholder'),
                searchPlaceholder: this.t('annotations.filters.searchPlaceholder'),
                emptyText: this.t('annotations.filters.noneAvailable'),
                options: available[type] || [],
                selected: activeByType.get(type)?.values || [],
                maxVisible: 20
            });
            wrapper.appendChild(select.create());
            return { wrapper, select };
        };

        const instanceSection = createSelectionSection('instanceId', this.t('annotations.filters.fields.instanceId'));
        const authorSection = createSelectionSection('author', this.t('annotations.filters.fields.author'));
        const presetSection = createSelectionSection('presetName', this.t('annotations.filters.fields.presetName'));
        const factorySection = createSelectionSection('factoryType', this.t('annotations.filters.fields.factoryType'));

        const rectFilter = activeByType.get('boundingRect')?.rect || {};
        const rectWrapper = document.createElement('div');
        rectWrapper.className = 'flex flex-col gap-2';
        const rectTitle = document.createElement('div');
        rectTitle.className = 'text-sm font-medium';
        rectTitle.textContent = this.t('annotations.filters.fields.boundingRect');
        rectWrapper.appendChild(rectTitle);

        const rectGrid = document.createElement('div');
        rectGrid.className = 'grid grid-cols-2 gap-2';
        const rectInputs = {};
        for (const key of ['x', 'y', 'width', 'height']) {
            const inputWrap = document.createElement('label');
            inputWrap.className = 'form-control';
            const caption = document.createElement('span');
            caption.className = 'label-text text-xs opacity-60';
            caption.textContent = key;
            const field = document.createElement('input');
            field.type = 'number';
            field.step = '1';
            field.className = 'input input-bordered input-sm w-full';
            field.value = rectFilter[key] ?? '';
            rectInputs[key] = field;
            inputWrap.append(caption, field);
            rectGrid.appendChild(inputWrap);
        }
        rectWrapper.appendChild(rectGrid);

        body.append(
            instanceSection.wrapper,
            authorSection.wrapper,
            presetSection.wrapper,
            factorySection.wrapper,
            rectWrapper
        );

        const modal = new UI.Modal({
            id: `${this.id}-annotation-filter-modal`,
            header: this.t('annotations.filters.modalTitle'),
            body,
            footer: (() => {
                const footer = document.createElement('div');
                footer.className = 'flex w-full justify-between gap-2';

                const clearBtn = document.createElement('button');
                clearBtn.type = 'button';
                clearBtn.className = 'btn btn-ghost';
                clearBtn.textContent = this.t('annotations.filters.clear');
                clearBtn.onclick = () => {
                    this.context.clearAnnotationFilters?.();
                    modal.close();
                };

                const actions = document.createElement('div');
                actions.className = 'flex gap-2';

                const cancelBtn = document.createElement('button');
                cancelBtn.type = 'button';
                cancelBtn.className = 'btn btn-ghost';
                cancelBtn.textContent = this.t('common.cancel');
                cancelBtn.onclick = () => modal.close();

                const saveBtn = document.createElement('button');
                saveBtn.type = 'button';
                saveBtn.className = 'btn btn-primary';
                saveBtn.textContent = this.t('annotations.filters.apply');
                saveBtn.onclick = () => {
                    const filters = [];
                    const collect = (type, control) => {
                        const values = control.getValue();
                        if (values.length) filters.push({ type, values });
                    };

                    collect('instanceId', instanceSection.select);
                    collect('author', authorSection.select);
                    collect('presetName', presetSection.select);
                    collect('factoryType', factorySection.select);

                    const rectValues = Object.fromEntries(
                        Object.entries(rectInputs).map(([key, field]) => [key, field.value.trim()])
                    );
                    const rectTouched = Object.values(rectValues).some(Boolean);
                    const rect = {
                        x: Number(rectValues.x),
                        y: Number(rectValues.y),
                        width: Number(rectValues.width),
                        height: Number(rectValues.height)
                    };
                    if (
                        rectTouched &&
                        Object.values(rect).every(Number.isFinite) &&
                        rect.width > 0 &&
                        rect.height > 0
                    ) {
                        filters.push({ type: 'boundingRect', rect });
                    }

                    this.context.setAnnotationFilters?.(filters);
                    modal.close();
                };

                actions.append(cancelBtn, saveBtn);
                footer.append(clearBtn, actions);
                return footer;
            })()
        }).mount();

        modal.open();
    },

    initViewerMenu() {
        this.registerViewerMenu((viewer) => {
            // Key per-viewer UI by the slot id (viewer.id, e.g. "osd-0"), which is
            // unique per viewport even when two viewports share a background id /
            // uniqueId. The guard stays defensive against a half-constructed viewer.
            const viewerId = viewer.id;
            if (!viewerId) return null;
            const state = this.getViewerContext(viewerId);
            if (!state) return null;
            state.viewer = viewer;

            const fabric = this.context.getFabric(viewerId);
            if (fabric) fabric.focusWithScreen = this._focusWithZoom;

            this._unbindViewerFabricEvents(viewerId);
            state.boardPanel?.destroy?.();
            state.boardPanel = new AnnotationBoardPanel(this, viewer);
            this._bindViewerFabricEvents(viewerId);

            state.enableButton = iconButton('ph-eye', this.t('annotations.viewerMenu.toggleVisibility'), (e) => this._toggleEnabled(e.currentTarget));
            // Stable per-viewer ids so EnjoyHint tutorials can target the
            // button via `[id$="-annotations-enable-toggle"]` (matches the
            // active viewer's instance in multi-viewer sessions).
            state.enableButton.id = `${viewerId}-annotations-enable-toggle`;
            // The single cog opens all annotation settings (the shared
            // fullscreen menu). The shared visual properties (outline / border /
            // opacity) and measurement labels now live there under "Display" —
            // they are global, so a per-viewer inline panel was the wrong home.
            state.settingsButton = iconButton('ph-gear', this.t('annotations.viewerMenu.settings'), () => {
                USER_INTERFACE.AppBar.Plugins.openSubmenu(this.id, 'annotations-shared');
            });
            state.settingsButton.id = `${viewerId}-annotations-settings`;

            // Classes: a compact, height-limited grid of preset chips (icon +
            // name) that wraps so several fit per row. Always visible — no tab
            // swapping — with the annotation board rendered directly below.
            state.presetInner = div({ class: 'flex flex-wrap gap-1 content-start' });
            state.presetClasses = div({ class: 'px-2 mt-1' },
                div({ class: 'flex items-center justify-between mb-1' },
                    span({ class: 'text-[10px] uppercase font-bold opacity-50' }, this.t('annotations.viewerMenu.tabs.classes')),
                    button({ type: 'button', class: 'btn btn-ghost btn-xs', title: this.t('annotations.viewerMenu.editPresets'), onclick: () => this.showPresets() },
                        span({ class: 'ph-light ph-note-pencil text-xs' })
                    )
                ),
                div({ class: 'max-h-[120px] overflow-y-auto pr-1' }, state.presetInner)
            );

            state.annotationList = div({ class: 'flex-1 min-h-0 mt-2' }, state.boardPanel.create());

            // Workspace selector (virtual/overlaid only). Hidden unless this
            // viewer hosts >1 region workspace; switching one active workspace
            // shows only its annotations and constrains new ones to its area.
            state.workspaceSelector = div({ id: `${viewerId}-annotations-workspaces`, class: 'px-2 mt-1 hidden' });

            const body = div({ class: 'flex flex-col w-full h-full' },
                div({ class: 'flex flex-row items-center justify-between w-full mb-2 px-1' },
                    state.enableButton,
                    h3({ class: 'text-lg font-bold' }, this.t('annotations.viewerMenu.title')),
                    div({ class: 'flex items-center gap-1' },
                        state.settingsButton
                    )
                ),
                state.workspaceSelector,
                state.presetClasses,
                state.annotationList
            );

            requestAnimationFrame(() => {
                // The menu builder fires before the slide-open pipeline finishes
                // wiring the new viewer. If the viewer this menu was built for
                // has already been retired (slide-switch, viewer-reset), bail
                // silently — a fresh menu will be rebuilt for the new viewer.
                if (!window.VIEWER_MANAGER?.getViewer(viewerId)) return;

                this._renderPresetList(viewerId);
                // Board is always visible now (no tab swapping) — mount it
                // unconditionally so its rows render on first open.
                state.boardPanel.mount();
                this._refreshAnnotationFilterBadges(viewerId);
                this._refreshWorkspaceSelector(viewerId);
                this._updateViewerControls(viewerId);
            });

            return {
                id: this.id,
                title: this.t('annotations.viewerMenu.title'),
                icon: 'ph-question',
                body
            };
        });
    },

    /**
     * Build the unified action list shown by the canvas right-click menu and
     * the annotation board's "..." popover. Both surfaces converge on the same
     * structure so users see one mental model.
     *
     * @param {fabric.Object|null} active currently-targeted annotation; null when there is none
     * @param {OSDAnnotations.FabricWrapper} fabric wrapper that owns `active` (or the active viewer's wrapper when there's no target)
     * @param {Object} opts
     * @param {Event}   opts.originalEvent original DOM event (for paste-position math)
     * @param {boolean} [opts.includePresetSelection=true]
     * @param {boolean} [opts.includeMarkAsPrivate=true]
     * @param {boolean} [opts.includeMoveToLayer=true]
     */
    _buildAnnotationContextActions(active, fabric, opts = {}) {
        const {
            originalEvent,
            source,
            includePresetSelection = true,
            includeMarkAsPrivate = true,
            includeMoveToLayer = true,
        } = opts;
        const wrapped = { originalEvent };
        const fromBoard = source === 'board';

        // Cascading flyouts are only rendered when `window.ContextMenu` is
        // available (van.js component bundled into ui/index.js). When it
        // isn't, fall back to a flat list with header rows so the legacy
        // `window.DropDown` fallback still shows the items.
        const supportsFlyouts = typeof window !== 'undefined' && !!window.ContextMenu?.open;

        // ── Build the building-block child arrays ───────────────────────
        // Each block is computed up front so we can either nest them under
        // the "Annotation" parent (modern flyout path) or flatten them with
        // headers (legacy DropDown fallback) using the same data.

        let presetItems = null;
        let presetTitle = null;
        if (includePresetSelection) {
            const handler = active
                ? this._clickAnnotationChangePreset.bind(this, active)
                : this._clickPresetSelect.bind(this, true);
            presetTitle = active ? 'Change preset' : 'Select preset for left click';
            presetItems = [];
            this.context.presets.foreach((preset) => {
                const category = preset.getMetaValue('category') || 'unknown';
                const icon = preset.objectFactory.getIcon();
                const containerCss = this.isUnpreferredPreset(preset.presetID) && 'opacity-50';
                presetItems.push({
                    icon,
                    iconCss: `color: ${preset.color};`,
                    containerCss,
                    title: category,
                    action: () => {
                        this._presetSelection = preset.presetID;
                        handler();
                    }
                });
            });
            if (!presetItems.length) presetItems = null;
        }

        const mousePos = this._getMousePosition(wrapped);
        const handlerCopy = this._copyAnnotation.bind(this, mousePos, active);
        const handlerCut = this._cutAnnotation.bind(this, mousePos, active);
        // From the board panel there is no real cursor position over the
        // slide, so Paste-at-mouse cannot anchor sensibly — force-disable it.
        // _canPasteAnnotation's bounds check would also reject most board
        // origins, but the explicit gate makes the intent unambiguous.
        const canPaste = !fromBoard && this._canPasteAnnotation(wrapped);
        const handlerPaste = this._pasteAnnotation.bind(this, wrapped);
        const handlerDelete = this._deleteAnnotation.bind(this, active);
        const cudActions = [
            { title: 'Copy',   icon: 'ph-copy',           containerCss: !active && 'opacity-50',  action: () => active && handlerCopy() },
            { title: 'Cut',    icon: 'ph-scissors',       containerCss: !active && 'opacity-50',  action: () => active && handlerCut() },
            { title: 'Paste',  icon: 'ph-clipboard-text', containerCss: !canPaste && 'opacity-50', action: () => canPaste && handlerPaste() },
            { title: 'Delete', icon: 'ph-trash',          containerCss: !active && 'opacity-50',  action: () => active && handlerDelete() },
        ];

        let layerItems = null;
        if (active && includeMoveToLayer && typeof fabric?.setAnnotationLayer === 'function') {
            const layers = fabric.getAllLayers?.() || [];
            layerItems = [{
                title: '(no layer)',
                icon: 'ph-stack',
                action: () => fabric.setAnnotationLayer(active, null),
            }];
            for (const layer of layers) {
                layerItems.push({
                    title: layer.name || `Layer ${layer.id}`,
                    icon: 'ph-stack',
                    action: () => fabric.setAnnotationLayer(active, layer.id),
                });
            }
        }

        let zOrderItems = null;
        if (active && typeof fabric?.canvas?.sendToBack === 'function') {
            zOrderItems = [{
                title: 'Send to back',
                icon: 'ph-caret-double-down',
                action: () => {
                    // Fabric draws the active object on top regardless of
                    // its canvas._objects position (default
                    // preserveObjectStacking=false), so drop the selection
                    // for the new order to take effect immediately.
                    fabric.canvas.discardActiveObject();
                    fabric.canvas.sendToBack(active);
                    fabric.canvas.requestRenderAll();
                },
            }];
        }

        let privateItem = null;
        if (active && includeMarkAsPrivate) {
            const props = this._getAnnotationProps(active);
            const handlerMarkPrivate = this._clickAnnotationMarkPrivate.bind(this, active);
            privateItem = {
                title: props.private ? 'Unmark as private' : 'Mark as private',
                icon: props.private ? 'visibility' : 'visibility_lock',
                action: () => handlerMarkPrivate(),
            };
        }

        let measurementsItem = null;
        if (active && typeof this.showMeasurementsPopover === 'function') {
            measurementsItem = {
                title: 'View measurements',
                icon: 'ph-chart-bar-horizontal',
                action: () => this.showMeasurementsPopover(active),
            };
        }

        // Group — "From selection (N)" plus criterion-based grouping that
        // used to live on the board panel's right-click menu. Both paths
        // funnel into layer-based grouping (annotations move into a layer;
        // there is no fabric.Group annotation here).
        let groupParent = null;
        let groupItemsFlat = null;
        if (typeof fabric?.groupAnnotationsIntoLayer === 'function') {
            const selection = fabric.getSelectionSnapshot?.() || [];
            const selectionCount = selection.length;
            const fromSelectionEnabled = selectionCount >= 2;

            const layersFor = (excludeLayerId) => {
                const all = fabric.getAllLayers?.() || [];
                return excludeLayerId
                    ? all.filter(l => String(l.id) !== String(excludeLayerId))
                    : all;
            };

            const targetChildren = (apply, excludeLayerId) => {
                const items = [{
                    title: '(new collapsed layer)',
                    icon: 'ph-stack',
                    action: () => apply({ kind: 'new' }),
                }];
                for (const l of layersFor(excludeLayerId)) {
                    items.push({
                        title: l.name || `Layer ${l.id}`,
                        icon: 'ph-stack',
                        action: () => apply({ kind: 'layer', layerId: l.id }),
                    });
                }
                return items;
            };

            const groupItems = [];
            groupItems.push({
                title: `From selection (${selectionCount})`,
                icon: 'ph-bounding-box',
                containerCss: !fromSelectionEnabled && 'opacity-50',
                children: fromSelectionEnabled
                    ? targetChildren(t => fabric.groupAnnotationsIntoLayer(selection, t))
                    : undefined,
                action: fromSelectionEnabled ? undefined : () => {},
            });

            if (active && typeof fabric?.groupSiblingsByCriterion === 'function') {
                groupItems.push({ title: '' }); // separator
                const categoryRaw = active.meta?.category;
                const categoryValue = (categoryRaw && typeof categoryRaw === 'object')
                    ? categoryRaw.value : categoryRaw;
                const criteria = [
                    { id: 'factory',  label: 'Same shape type',   value: active.factoryID },
                    { id: 'preset',   label: 'Same preset',       value: active.presetID },
                    { id: 'author',   label: 'Same author',       value: active.author ?? active.sessionID },
                    { id: 'category', label: 'Same category text', value: categoryValue },
                ];
                const excludeId = active.layerID ?? '';
                for (const c of criteria) {
                    const hasValue = c.value !== undefined && c.value !== null && c.value !== '';
                    groupItems.push({
                        title: c.label,
                        icon: 'ph-bounding-box',
                        containerCss: !hasValue && 'opacity-50',
                        children: hasValue
                            ? targetChildren(t => fabric.groupSiblingsByCriterion(active, c.id, t), excludeId)
                            : undefined,
                        action: hasValue ? undefined : () => {},
                    });
                }
            }

            if (groupItems.length) {
                groupParent = { title: 'Group', icon: 'ph-bounding-box', children: groupItems };
                // For the legacy flat path, drop separator placeholders.
                groupItemsFlat = groupItems.filter(it => it.title !== '');
            }
        }

        // ── Assemble ────────────────────────────────────────────────────
        // Modern path: one "Annotation" parent with the children in the
        // user-specified order. Inserts an empty-title row between the
        // preset section and the Copy/Cut/Paste/Delete group as a visual
        // separator (no header label, just breathing room).
        if (supportsFlyouts) {
            const children = [];
            if (presetItems) {
                children.push({ title: presetTitle, icon: 'ph-tag', children: presetItems });
                children.push({ title: '' }); // visual separator
            }
            children.push(...cudActions);
            if (layerItems) {
                children.push({ title: 'Move to layer', icon: 'ph-stack', children: layerItems });
            }
            if (groupParent) children.push(groupParent);
            if (zOrderItems) children.push(...zOrderItems);
            if (privateItem) children.push(privateItem);
            if (measurementsItem) children.push(measurementsItem);
            return [{ title: 'Annotation', icon: 'ph-shapes', children }];
        }

        // Legacy `window.DropDown` fallback — flat list with header rows.
        // Order matches the modern submenu so users see the same mental
        // model regardless of which renderer is active.
        const actions = [];
        if (presetItems) {
            actions.push({ title: `${presetTitle}:` });
            actions.push(...presetItems);
        }
        actions.push({ title: 'Actions:' });
        actions.push(...cudActions);
        if (layerItems) {
            actions.push({ title: 'Move to layer:' });
            actions.push(...layerItems);
        }
        if (groupItemsFlat) {
            actions.push({ title: 'Group:' });
            actions.push(...groupItemsFlat);
        }
        if (zOrderItems) actions.push(...zOrderItems);
        if (privateItem) {
            actions.push({ title: 'Modify annotation:' });
            actions.push(privateItem);
        }
        if (measurementsItem) actions.push(measurementsItem);
        return actions;
    },

    _bindViewerFabricEvents(viewerOrId) {
        const viewerId = this._resolveViewerId(viewerOrId);
        if (!viewerId) return;

        const state = this.getViewerContext(viewerId);
        const fabric = this.context.getFabric(viewerId);
        if (!state || !fabric) return;

        this._unbindViewerFabricEvents(viewerId);

        const annotationSelectionChanged = (e) => {
            const selected = Array.isArray(e?.selected) ? e.selected : (e?.selected ? [e.selected] : []);
            const deselected = Array.isArray(e?.deselected) ? e.deselected : (e?.deselected ? [e.deselected] : []);

            const lastSelected = selected.length ? selected[selected.length - 1] : null;

            if (lastSelected) {
                this._annotationSelected(lastSelected, fabric);
            } else if (deselected.length) {
                this._annotationDeselected(deselected[deselected.length - 1], fabric);
            }

            const panel = this._getViewerUI(viewerId)?.boardPanel;
            if (panel?.root) {
                panel._updateSelectionVisuals?.(selected, deselected, 'annotation');
                panel._updateDeleteSelectionHeaderButton?.();
            }
        };

        const layerSelectionChanged = (e) => {
            const panel = this._getViewerUI(viewerId)?.boardPanel;
            if (!panel?.root) return;
            panel._updateSelectionVisuals?.(e?.selected, e?.deselected, 'layer');
            panel._updateDeleteSelectionHeaderButton?.();
        };

        const activeLayerChanged = (e) => {
            const panel = this._getViewerUI(viewerId)?.boardPanel;
            if (!panel?.root) return;
            panel._updateActiveLayerVisual?.(e?.layer);
            panel._updateDeleteSelectionHeaderButton?.();
        };

        // TODO: this is too costly, we should update items incrementally, not rerender everything
        const sideRefresh = () => {
            this._getViewerUI(viewerId)?.boardPanel?.requestRender();
            this._refreshAllPresetLists();
            this._refreshAllAuthorLists();
        };

        // Canvas right-click menu provider. Registered with the global
        // CanvasContextMenu registry so all providers (annotations, playground,
        // future plugins) aggregate into a single DropDown opened by loader.ts.
        // Returns null to opt out (wrong viewer in a multi-viewport layout,
        // interaction disabled) and false to VETO the whole menu — the
        // right-click was consumed by an annotation interaction, so no other
        // provider (e.g. playground) may open the menu either.
        const contextMenuProviderId = `annotations-${viewerId}`;
        const contextMenuProvider = (ctx) => {
            if (ctx.viewer?.id !== viewerId) return null;
            if (this.context.disabledInteraction) return null;
            // Right-click drawing/drag suppressions only apply when the menu
            // was actually opened by a right-click. Callers that supply
            // `ctx.active` (e.g. the annotation row's "..." button) invoked
            // the menu explicitly and must not be silenced by these rules.
            if (!ctx.active) {
                const cursor = this.context.cursor;
                // Primary gate: a mode consumed this right-release (drawing,
                // editing, control interaction) — the click was "handled", so
                // the menu must NOT open. Set by handleRightClickUp in
                // annotations-canvas.js (parity with the legacy
                // nonprimary-release-not-handled behavior).
                if (cursor?.rightClickHandled) return false;
                // Right button is bound to drawing — right-clicks annotate.
                // In auto (navigation) mode the binding is inert (right-click
                // does not draw), so the menu may still open there.
                if (this.context.presets.right && !this.context.isModeAuto()) return false;
                // Suppress on right-click drag: cursor.mouseTime is set on press by
                // annotations-canvas.js handleRightClickDown and not reset on the
                // typical release path, so press-duration is still measurable here.
                if (cursor && cursor.mouseTime > 0 && (Date.now() - cursor.mouseTime) > 250) return false;
            }

            // Prefer a pre-resolved target (set by callers that open the menu
            // from a non-canvas surface, e.g. the annotation row's "..." button)
            // before falling back to hit-testing the right-click event.
            const active = ctx.active ?? fabric.canvas.findTarget(ctx.event);
            if (active && fabric.canvas.getActiveObject?.() !== active) {
                fabric.canvas.setActiveObject(active);
                fabric.canvas.renderAll();
            }
            return this._buildAnnotationContextActions(active, fabric, {
                originalEvent: ctx.event,
                source: ctx.source,
                includeMarkAsPrivate: true,
                includeMoveToLayer: true,
                includePresetSelection: true,
            });
        };

        const workspaceChanged = () => this._refreshWorkspaceSelector(viewerId);

        state._fabricEventBindings = {
            fabric,
            annotationSelectionChanged,
            layerSelectionChanged,
            activeLayerChanged,
            sideRefresh,
            workspaceChanged,
            contextMenuProviderId
        };

        fabric.addHandler('annotation-selection-changed', annotationSelectionChanged);
        fabric.addHandler('layer-selection-changed', layerSelectionChanged);
        fabric.addHandler('active-layer-changed', activeLayerChanged);

        fabric.addHandler('layer-visibility-changed', sideRefresh);

        fabric.addHandler('layer-objects-changed', sideRefresh);
        fabric.addHandler('annotation-create', sideRefresh);
        fabric.addHandler('annotation-delete', sideRefresh);
        fabric.addHandler('annotation-replace', sideRefresh);
        fabric.addHandler('layer-added', sideRefresh);
        fabric.addHandler('layer-removed', sideRefresh);

        fabric.addHandler('workspace-added', workspaceChanged);
        fabric.addHandler('workspace-removed', workspaceChanged);
        fabric.addHandler('workspace-changed', workspaceChanged);

        // Higher priority than the playground (10) so annotation entries appear first.
        window.CanvasContextMenu?.register(contextMenuProviderId, contextMenuProvider, 20);
    },

    _unbindViewerFabricEvents(viewerOrId) {
        const viewerId = this._resolveViewerId(viewerOrId);
        if (!viewerId) return;

        const state = this.getViewerContext(viewerId);
        const bindings = state?._fabricEventBindings;
        if (!bindings?.fabric) return;

        const {
            fabric,
            annotationSelectionChanged,
            layerSelectionChanged,
            activeLayerChanged,
            sideRefresh,
            workspaceChanged,
            contextMenuProviderId
        } = bindings;

        fabric.removeHandler('annotation-selection-changed', annotationSelectionChanged);
        fabric.removeHandler('layer-selection-changed', layerSelectionChanged);
        fabric.removeHandler('active-layer-changed', activeLayerChanged);

        fabric.removeHandler('layer-objects-changed', sideRefresh);
        fabric.removeHandler('annotation-create', sideRefresh);
        fabric.removeHandler('annotation-delete', sideRefresh);
        fabric.removeHandler('annotation-replace', sideRefresh);
        fabric.removeHandler('layer-added', sideRefresh);
        fabric.removeHandler('layer-removed', sideRefresh);

        if (workspaceChanged) {
            fabric.removeHandler('workspace-added', workspaceChanged);
            fabric.removeHandler('workspace-removed', workspaceChanged);
            fabric.removeHandler('workspace-changed', workspaceChanged);
        }

        if (contextMenuProviderId) window.CanvasContextMenu?.unregister(contextMenuProviderId);

        delete state._fabricEventBindings;
    },

    _refreshWorkspaceSelector(viewerOrId = undefined) {
        const state = this._getViewerUI(viewerOrId);
        if (!state?.workspaceSelector) return;
        const viewerId = this._resolveViewerId(viewerOrId);
        const fabric = this.context.getFabric(viewerId);
        const root = state.workspaceSelector;

        const list = fabric?.listWorkspaces?.() || [];
        // Hidden for none/sidebyside (≤1 workspace); only overlaid has several.
        if (list.length <= 1) {
            root.classList.add('hidden');
            root.replaceChildren();
            return;
        }
        root.classList.remove('hidden');

        const active = fabric.getActiveWorkspace?.();
        const buttons = list.map(ws => button({
            type: 'button',
            class: `btn btn-xs join-item ${active && active.id === ws.id ? 'btn-active btn-primary' : 'btn-ghost'}`.trim(),
            title: ws.name,
            onclick: () => {
                this.context.setActiveWorkspace(viewerId, ws.id);
                this._refreshWorkspaceSelector(viewerId);
            },
        }, span({ class: 'truncate max-w-[90px]' }, ws.name)));

        root.replaceChildren(
            div({ class: 'text-[10px] uppercase font-bold opacity-50 mb-1' }, this.t('annotations.workspace.label')),
            div({ class: 'join flex flex-wrap' }, ...buttons)
        );
    },

    _renderPresetList(viewerOrId = undefined) {
        const state = this._getViewerUI(viewerOrId);
        if (!state?.presetInner) return;

        const leftId = this.context.getPreset(true)?.presetID;
        const rightId = this.context.getPreset(false)?.presetID;

        const nodes = [];
        let pushed = false;
        this.context.presets.foreach((preset) => {
            const isLeft = preset.presetID === leftId;
            const isRight = preset.presetID === rightId;
            // Distinct, meaningful per-button indicators: a left/right mouse
            // glyph (and matching ring colour) shows which mouse button paints
            // with this class. Replaces the ambiguous, clipping "L"/"R" badges.
            const activeStyle = (isLeft || isRight)
                ? `bg-base-300 ${isLeft ? 'ring-1 ring-primary' : 'ring-1 ring-secondary'}`
                : 'border-transparent';

            const containerCss = this.isUnpreferredPreset(preset.presetID) ? 'opacity-50' : '';
            const category = preset.meta?.category?.value || this.t('annotations.viewerMenu.unknownPreset');

            nodes.push(button({
                    type: 'button',
                    title: category,
                    class: `btn btn-ghost btn-xs px-1 gap-1 flex-nowrap justify-start border max-w-[45%] overflow-hidden ${containerCss} ${activeStyle}`.trim(),
                    onclick: () => this._clickPresetSelect(true, preset.presetID),
                    oncontextmenu: (e) => {
                        e.preventDefault();
                        this._clickPresetSelect(false, preset.presetID);
                        return false;
                    }
                },
                (() => {
                    const ico = preset.objectFactory.getIcon();
                    const isPh = String(ico ?? '').trim().startsWith('ph-');
                    return span({ class: `shrink-0 ${isPh ? `ph-light ${ico}` : `fa-auto ${ico}`}`, style: `color:${preset.color};` });
                })(),
                span({ class: 'truncate min-w-0 text-left' }, category),
                isLeft ? span({ class: 'ph-light ph-mouse-left-click shrink-0 text-primary text-sm', title: this.t('annotations.viewerMenu.leftClickPreset') }) : null,
                isRight ? span({ class: 'ph-light ph-mouse-right-click shrink-0 text-secondary text-sm', title: this.t('annotations.viewerMenu.rightClickPreset') }) : null
            ));
            pushed = true;
        });

        if (!pushed) {
            nodes.push(div({ class: 'text-sm opacity-70' },
                this.t('annotations.viewerMenu.noPresetsPrefix'), ' ',
                button({ type: 'button', class: 'link link-primary', onclick: () => this.showPresets() }, this.t('annotations.viewerMenu.createPresetLink')),
                '.'
            ));
        }

        state.presetInner.replaceChildren(...nodes);
    },

    _toggleEnabled(btnElement) {
        const currentlyEnabled = !this.context.disabledInteraction;
        const nextEnabled = !currentlyEnabled;

        if (!nextEnabled) {
            for (const viewer of VIEWER_MANAGER.viewers || []) {
                this._getViewerUI(viewer)?.boardPanel?.commitEdit?.();
            }
        }

        APPLICATION_CONTEXT.history.push(
            () => {
                this.context.enableAnnotations(nextEnabled);
                this._updateViewerControls();
                this._refreshAllBoardPanels();

                USER_INTERFACE.Tools.setMenuEnabled?.(this.id, nextEnabled);
            },
            () => {
                this.context.enableAnnotations(currentlyEnabled);
                this._updateViewerControls();
                this._refreshAllBoardPanels();

                USER_INTERFACE.Tools.setMenuEnabled?.(this.id, currentlyEnabled);
            }
        );
    },

    _populateAuthorsList(viewerOrId = undefined) {
        const state = this._getViewerUI(viewerOrId);
        if (!state?.authorInner) return;

        const viewerId = this._resolveViewerId(viewerOrId);
        const fabric = this.context.getFabric(viewerId);
        if (!fabric) return;

        const map = new Map();
        for (const object of fabric.canvas?.getObjects?.() || []) {
            if (!fabric.isAnnotation?.(object)) continue;
            const author = object.author || this.t('annotations.viewerMenu.unknownAuthor');
            map.set(author, (map.get(author) || 0) + 1);
        }

        const rows = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) =>
            div({ class: 'flex items-center justify-between py-1 px-2 rounded hover:bg-base-200' },
                span({ class: 'truncate mr-2' }, name),
                span({ class: 'badge badge-ghost badge-sm' }, String(count))
            )
        );

        if (!rows.length) rows.push(div({ class: 'text-sm opacity-70 px-2' }, this.t('annotations.viewerMenu.noAuthors')));
        state.authorInner.replaceChildren(...rows);
    },

    _refreshAllBoardPanels() {
        for (const viewer of VIEWER_MANAGER.viewers || []) {
            this._getViewerUI(viewer)?.boardPanel?.requestRender();
        }
    },

    _refreshAllAnnotationFilterBadges() {
        for (const viewer of VIEWER_MANAGER.viewers || []) this._refreshAnnotationFilterBadges(viewer);
    },

    _refreshAllPresetLists() {
        for (const viewer of VIEWER_MANAGER.viewers || []) this._renderPresetList(viewer);
    },

    _refreshAllAuthorLists() {
        for (const viewer of VIEWER_MANAGER.viewers || []) this._populateAuthorsList(viewer);
    },

    _updateViewerControls(viewerOrId = undefined) {
        const apply = (state) => {
            if (!state) return;

            const enabled = !this.context.disabledInteraction;

            state.enableButton?.classList.toggle('btn-active', enabled);

            const disableTargets = [
                state.presetClasses,
                state.annotationList
            ];

            for (const el of disableTargets) {
                if (!el) continue;
                if ('disabled' in el) el.disabled = !enabled;
                el.style.pointerEvents = enabled ? 'auto' : 'none';
                el.style.opacity = enabled ? '1' : '0.45';
                el.setAttribute?.('aria-disabled', enabled ? 'false' : 'true');
            }

            state.boardPanel?._setSortableEnabled?.(enabled);
        };

        if (viewerOrId) return apply(this._getViewerUI(viewerOrId));
        for (const viewer of VIEWER_MANAGER.viewers || []) apply(this._getViewerUI(viewer));
    },
};
