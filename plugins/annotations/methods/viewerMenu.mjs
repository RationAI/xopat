import { AnnotationBoardPanel } from '../board/annotationBoardPanel.mjs';

const { div, button, input, span, h3 } = globalThis.van.tags;

function iconButton(icon, title, onClick, active = false) {
    return button({
        type: 'button',
        class: `btn btn-ghost btn-sm btn-square ${active ? 'btn-active' : ''}`.trim(),
        title,
        onclick: onClick,
    }, span({ class: `fa-auto ${icon}` }));
}

function tabButton(label, onClick, active = false, hidden = false) {
    return button({
        type: 'button',
        class: `btn btn-sm rounded-none border-b-0 flex-1 ${active ? 'btn-active' : ''}`.trim(),
        onclick: onClick,
        style: hidden ? 'display:none;' : ''
    }, label);
}

export const viewerMenuMethods = {
    setDrawOutline(enable) {
        // todo no way to change this for a single viewer for now -> presets are global
        this.context.setAnnotationCommonVisualProperty('modeOutline', enable);
        this._updateViewerControls();
    },

    setEdgeCursorNavigate(enable, viewerId) {
        enable = this.context.getFabric(viewerId)?.setCloseEdgeMouseNavigation(enable) || false;
        this.setOption('edgeCursorNavigate', enable);
        this._updateViewerControls(viewerId);
        return enable;
    },

    _resolveViewerId(viewerOrId = undefined) {
        if (!viewerOrId) return VIEWER?.uniqueId;
        return typeof viewerOrId === 'object' ? viewerOrId.uniqueId : viewerOrId;
    },

    _getViewerUI(viewerOrId = undefined) {
        const viewerId = this._resolveViewerId(viewerOrId);
        if (!viewerId) return undefined;
        return this.getViewerContext(viewerId);
    },

    _toggleStrokeStyling(enable) {
        Object.values(VIEWER_MANAGER?.viewers || []).forEach(viewer => {
            const state = this._getViewerUI(viewer.uniqueId);
            if (!state?.authorTabButton) return;
            state.authorTabButton.style.display = enable ? '' : 'none';
            if (!enable && state.currentTab === 'authors') {
                this.switchMenuList('preset', viewer.uniqueId);
            }
        });
    },

    _refreshAnnotationFilterBadges(viewerOrId = undefined) {
        const state = this._getViewerUI(viewerOrId);
        if (!state?.filterBadges) return;

        const filters = this.context.getAnnotationFilters?.() || [];
        const badges = filters.map(filter => {
            const description = this.context.describeAnnotationFilter?.(filter);
            const node = document.createElement('span');
            node.className = 'badge badge-outline badge-sm gap-1';
            node.textContent = description?.text || filter.id;

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn btn-ghost btn-xs btn-square min-h-0 h-4 w-4 ml-1';
            remove.title = this.t('annotations.filters.remove');
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
            empty.textContent = this.t('annotations.filters.empty');
            state.filterBadges.replaceChildren(empty);
            return;
        }

        state.filterBadges.replaceChildren(...badges);
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
            const viewerId = viewer.uniqueId;
            // viewer-reset fires with the world momentarily empty; uniqueId is
            // documented to be transiently undefined in that window. Same bail
            // pattern as _getViewerUI above.
            if (!viewerId) return null;
            const state = this.getViewerContext(viewerId);
            if (!state) return null;
            state.viewer = viewer;
            state.currentTab = state.currentTab || 'preset';

            const fabric = this.context.getFabric(viewerId);
            if (fabric) fabric.focusWithScreen = this._focusWithZoom;

            this._unbindViewerFabricEvents(viewerId);
            state.boardPanel?.destroy?.();
            state.boardPanel = new AnnotationBoardPanel(this, viewer);
            this._bindViewerFabricEvents(viewerId);

            state.enableButton = iconButton('fa-eye', this.t('annotations.viewerMenu.toggleVisibility'), (e) => this._toggleEnabled(e.currentTarget));
            state.outlineButton = iconButton('fa-vector-square', this.t('annotations.viewerMenu.outlineOnly'), () => {
                const next = !this.context.getAnnotationCommonVisualProperty('modeOutline');
                this.setDrawOutline(next);
            }, this.context.getAnnotationCommonVisualProperty('modeOutline'));
            state.edgeButton = iconButton('fa-up-down-left-right', this.t('annotations.viewerMenu.edgeNavigation'), () => {
                const active = !(state.edgeButton.classList.contains('btn-active'));
                this.setEdgeCursorNavigate(active, viewerId);
            }, this.getOption('edgeCursorNavigate', true));
            state.saveButton = iconButton('fa-floppy-disk', this.t('annotations.viewerMenu.save'), () => {
                this.context.requestExport()
                    .then((msg) => Dialogs.show(msg))
                    .catch((e) => Dialogs.show(`${this.t('annotations.export.saveFailed')} ${e.message}`, 5000, Dialogs.MSG_ERR));
            });
            state.moreButton = iconButton('fa-ellipsis-vertical', this.t('annotations.viewerMenu.moreOptions'), () => {
                USER_INTERFACE.AppBar.Plugins.openSubmenu(this.id, 'annotations-shared');
            });

            state.borderInput = input({
                type: 'range', min: '1', max: '10', step: '1',
                class: 'range range-xs range-primary w-full',
                value: String(this.context.getAnnotationCommonVisualProperty('originalStrokeWidth')),
                oninput: (e) => {
                    if (this.context.disabledInteraction) return;
                    this.context.setAnnotationCommonVisualProperty('originalStrokeWidth', Number.parseFloat(e.currentTarget.value));
                }
            });

            state.opacityInput = input({
                type: 'range', min: '0', max: '1', step: '0.1',
                class: 'range range-xs range-primary w-full',
                value: String(this.context.getAnnotationCommonVisualProperty('opacity')),
                oninput: (e) => {
                    if (this.context.disabledInteraction) return;
                    this.context.setAnnotationCommonVisualProperty('opacity', Number.parseFloat(e.currentTarget.value));
                }
            });

            state.presetTabButton = tabButton(this.t('annotations.viewerMenu.tabs.classes'), () => this.switchMenuList('preset', viewerId), state.currentTab === 'preset');
            state.annotationTabButton = tabButton(this.t('annotations.viewerMenu.tabs.annotations'), () => this.switchMenuList('annot', viewerId), state.currentTab === 'annot');
            state.authorTabButton = tabButton(this.t('annotations.viewerMenu.tabs.authors'), () => this.switchMenuList('authors', viewerId), state.currentTab === 'authors', !this.context.strokeStyling);

            state.presetInner = div({ class: 'space-y-1' });
            state.presetList = div({ class: `flex-1 pl-2 pr-1 mt-2 relative ${state.currentTab === 'preset' ? '' : 'hidden'}`.trim() },
                button({ type: 'button', class: 'btn btn-xs absolute top-0 right-4 z-10', onclick: () => this.showPresets() },
                    span({ class: 'fa-auto fa-pen-to-square mr-1 text-xs' }),
                    this.t('annotations.viewerMenu.editPresets')
                ),
                div({ class: 'pt-4' }, state.presetInner)
            );

            state.filterBadges = div({ class: 'flex flex-wrap gap-1 mt-2 mb-2 min-h-6' });
            state.annotationList = div({ class: `mx-2 mt-2 flex-1 min-h-0 ${state.currentTab === 'annot' ? '' : 'hidden'}`.trim() },
                div({ class: 'flex items-center justify-between gap-2 mb-2' },
                    span({ class: 'text-[10px] uppercase font-bold opacity-50' }, this.t('annotations.filters.title')),
                    button({
                        type: 'button',
                        class: 'btn btn-ghost btn-xs',
                        onclick: () => this._openAnnotationFilterModal(viewerId)
                    },
                        span({ class: 'fa-auto fa-filter mr-1 text-xs' }),
                        this.t('annotations.filters.button')
                    )
                ),
                state.filterBadges,
                state.boardPanel.create()
            );

            state.authorInner = div({ class: 'space-y-1' });
            state.authorList = div({ class: `mx-2 mt-2 ${state.currentTab === 'authors' ? '' : 'hidden'}`.trim() }, state.authorInner);

            const body = div({ class: 'flex flex-col w-full h-full' },
                div({ class: 'flex flex-row items-center justify-between w-full mb-2 px-1' },
                    state.enableButton,
                    h3({ class: 'text-lg font-bold' }, this.t('annotations.viewerMenu.title')),
                    state.outlineButton,
                    state.edgeButton,
                    state.saveButton,
                    state.moreButton
                ),
                div({ class: 'grid grid-cols-2 gap-4 mb-4 px-2' },
                    div({ class: 'flex flex-col gap-1' },
                        div({ class: 'flex justify-between items-center px-1' },
                            span({ class: 'text-[10px] uppercase font-bold opacity-50' }, this.t('annotations.viewerMenu.border')),
                            span({ class: 'text-[10px] font-mono' }, state.borderInput.value)
                        ),
                        state.borderInput
                    ),
                    div({ class: 'flex flex-col gap-1' },
                        div({ class: 'flex justify-between items-center px-1' },
                            span({ class: 'text-[10px] uppercase font-bold opacity-50' }, this.t('annotations.viewerMenu.opacity')),
                            span({ class: 'text-[10px] font-mono' }, Math.round(state.opacityInput.value * 100) + '%')
                        ),
                        state.opacityInput
                    )
                ),
                div({ class: 'join join-horizontal w-full border-b border-base-300' },
                    state.presetTabButton,
                    state.annotationTabButton,
                    state.authorTabButton
                ),
                state.presetList,
                state.annotationList,
                state.authorList
            );

            requestAnimationFrame(() => {
                // The menu builder fires before the slide-open pipeline finishes
                // wiring the new viewer. If the viewer this menu was built for
                // has already been retired (slide-switch, viewer-reset), bail
                // silently — a fresh menu will be rebuilt for the new viewer.
                if (!window.VIEWER_MANAGER?.getViewer(viewerId)) return;

                this._renderPresetList(viewerId);
                this._refreshAnnotationFilterBadges(viewerId);
                // todo race condition, accesses canvas instance, still, this update is too slow and fired too often, fix it
                //this._populateAuthorsList(viewerId);
                if (state.currentTab === 'annot') state.boardPanel.mount();
                this._updateViewerControls(viewerId);
            });

            return {
                id: this.id,
                title: this.t('annotations.viewerMenu.title'),
                icon: 'fa-question-circle',
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
            includePresetSelection = true,
            includeMarkAsPrivate = true,
            includeMoveToLayer = true,
        } = opts;
        const wrapped = { originalEvent };

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
        const canPaste = this._canPasteAnnotation(wrapped);
        const handlerPaste = this._pasteAnnotation.bind(this, wrapped);
        const handlerDelete = this._deleteAnnotation.bind(this, active);
        const cudActions = [
            { title: 'Copy',   icon: 'fa-copy',     containerCss: !active && 'opacity-50',  action: () => active && handlerCopy() },
            { title: 'Cut',    icon: 'fa-scissors', containerCss: !active && 'opacity-50',  action: () => active && handlerCut() },
            { title: 'Paste',  icon: 'fa-paste',    containerCss: !canPaste && 'opacity-50', action: () => canPaste && handlerPaste() },
            { title: 'Delete', icon: 'fa-trash',    containerCss: !active && 'opacity-50',  action: () => active && handlerDelete() },
        ];

        let layerItems = null;
        if (active && includeMoveToLayer && typeof fabric?.setAnnotationLayer === 'function') {
            const layers = fabric.getAllLayers?.() || [];
            layerItems = [{
                title: '(no layer)',
                icon: 'fa-layer-group',
                action: () => fabric.setAnnotationLayer(active, null),
            }];
            for (const layer of layers) {
                layerItems.push({
                    title: layer.name || `Layer ${layer.id}`,
                    icon: 'fa-layer-group',
                    action: () => fabric.setAnnotationLayer(active, layer.id),
                });
            }
        }

        let zOrderItems = null;
        if (active
            && typeof fabric?.bringAnnotationToFront === 'function'
            && typeof fabric?.sendAnnotationToBack === 'function'
            && typeof fabric?.moveAnnotation === 'function'
        ) {
            zOrderItems = [
                { title: 'Bring to Front', icon: 'fa-angles-up',   action: () => fabric.bringAnnotationToFront(active) },
                { title: 'Bring Forward',  icon: 'fa-angle-up',    action: () => fabric.moveAnnotation(active, 'up') },
                { title: 'Send Backward',  icon: 'fa-angle-down',  action: () => fabric.moveAnnotation(active, 'down') },
                { title: 'Send to Back',   icon: 'fa-angles-down', action: () => fabric.sendAnnotationToBack(active) },
            ];
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
                icon: 'fa-square-poll-horizontal',
                action: () => this.showMeasurementsPopover(active),
            };
        }

        // ── Assemble ────────────────────────────────────────────────────
        // Modern path: one "Annotation" parent with the children in the
        // user-specified order. Inserts an empty-title row between the
        // preset section and the Copy/Cut/Paste/Delete group as a visual
        // separator (no header label, just breathing room).
        if (supportsFlyouts) {
            const children = [];
            if (presetItems) {
                children.push({ title: presetTitle, icon: 'fa-tag', children: presetItems });
                children.push({ title: '' }); // visual separator
            }
            children.push(...cudActions);
            if (layerItems) {
                children.push({ title: 'Move to layer', icon: 'fa-layer-group', children: layerItems });
            }
            if (zOrderItems) {
                children.push({ title: 'Visibility order', icon: 'fa-arrows-up-down', children: zOrderItems });
            }
            if (privateItem) children.push(privateItem);
            if (measurementsItem) children.push(measurementsItem);
            return [{ title: 'Annotation', icon: 'fa-shapes', children }];
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
        if (zOrderItems) {
            actions.push({ title: 'Visibility order:' });
            actions.push(...zOrderItems);
        }
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
                this._annotationSelected(lastSelected);
            } else if (deselected.length) {
                this._annotationDeselected(deselected[deselected.length - 1]);
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
        // Returns null to opt out (drawing-with-right-click mode, long-press drag,
        // or wrong viewer in a multi-viewport layout).
        const contextMenuProviderId = `annotations-${viewerId}`;
        const contextMenuProvider = (ctx) => {
            if (ctx.viewer?.uniqueId !== viewerId) return null;
            if (this.context.disabledInteraction) return null;
            // Right-click drawing/drag suppressions only apply when the menu
            // was actually opened by a right-click. Callers that supply
            // `ctx.active` (e.g. the annotation row's "..." button) invoked
            // the menu explicitly and must not be silenced by these rules.
            if (!ctx.active) {
                if (this.context.presets.right) return null;
                // Suppress on right-click drag: cursor.mouseTime is set on press by
                // annotations-canvas.js handleRightClickDown and not reset on the
                // typical release path, so press-duration is still measurable here.
                const cursor = this.context.cursor;
                if (cursor && cursor.mouseTime > 0 && (Date.now() - cursor.mouseTime) > 250) return null;
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
                includeMarkAsPrivate: true,
                includeMoveToLayer: true,
                includePresetSelection: true,
            });
        };

        state._fabricEventBindings = {
            fabric,
            annotationSelectionChanged,
            layerSelectionChanged,
            activeLayerChanged,
            sideRefresh,
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

        if (contextMenuProviderId) window.CanvasContextMenu?.unregister(contextMenuProviderId);

        delete state._fabricEventBindings;
    },

    switchMenuList(type, viewerOrId = undefined) {
        const viewerId = this._resolveViewerId(viewerOrId);
        const state = this._getViewerUI(viewerId);
        if (!state) return;

        state.currentTab = type;
        state.presetTabButton.classList.toggle('btn-active', type === 'preset');
        state.annotationTabButton.classList.toggle('btn-active', type === 'annot');
        state.authorTabButton.classList.toggle('btn-active', type === 'authors');

        state.presetList.classList.toggle('hidden', type !== 'preset');
        state.annotationList.classList.toggle('hidden', type !== 'annot');
        state.authorList.classList.toggle('hidden', type !== 'authors');

        if (type === 'preset') this._renderPresetList(viewerId);
        else if (type === 'authors') this._populateAuthorsList(viewerId);
        else {
            this._refreshAnnotationFilterBadges(viewerId);
            state.boardPanel?.mount();
        }
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
            const activeStyle = (isLeft || isRight) ? 'bg-base-200 border-base-300' : 'border-transparent';

            const containerCss = this.isUnpreferredPreset(preset.presetID) ? 'opacity-50' : '';
            const category = preset.meta?.category?.value || this.t('annotations.viewerMenu.unknownPreset');

            nodes.push(button({
                    type: 'button',
                    class: `btn btn-ghost btn-sm justify-start w-full gap-2 border ${containerCss} ${activeStyle}`.trim(),
                    onclick: () => this._clickPresetSelect(true, preset.presetID),
                    oncontextmenu: (e) => {
                        e.preventDefault();
                        this._clickPresetSelect(false, preset.presetID);
                        return false;
                    }
                },
                span({ class: `fa-auto ${preset.objectFactory.getIcon()}`, style: `color:${preset.color};` }),
                span({ class: 'truncate flex-1 text-left' }, category),
                isLeft ? span({ class: 'badge badge-primary badge-xs h-4 min-h-0 w-4 p-0 font-bold' }, 'L') : null,
                isRight ? span({ class: 'badge badge-outline badge-xs h-4 min-h-0 w-4 p-0 font-bold' }, 'R') : null
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
                this._getViewerUI(viewer.uniqueId)?.boardPanel?.commitEdit?.();
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
            this._getViewerUI(viewer.uniqueId)?.boardPanel?.requestRender();
        }
    },

    _refreshAllAnnotationFilterBadges() {
        for (const viewer of VIEWER_MANAGER.viewers || []) this._refreshAnnotationFilterBadges(viewer.uniqueId);
    },

    _refreshAllPresetLists() {
        for (const viewer of VIEWER_MANAGER.viewers || []) this._renderPresetList(viewer.uniqueId);
    },

    _refreshAllAuthorLists() {
        for (const viewer of VIEWER_MANAGER.viewers || []) this._populateAuthorsList(viewer.uniqueId);
    },

    _updateViewerControls(viewerOrId = undefined) {
        const apply = (state) => {
            if (!state) return;

            const enabled = !this.context.disabledInteraction;

            state.enableButton?.classList.toggle('btn-active', enabled);
            state.outlineButton?.classList.toggle('btn-active', !!this.context.getAnnotationCommonVisualProperty('modeOutline'));
            state.edgeButton?.classList.toggle('btn-active', !!this.getOption('edgeCursorNavigate', true));

            if (state.borderInput) state.borderInput.value = String(this.context.getAnnotationCommonVisualProperty('originalStrokeWidth'));
            if (state.opacityInput) state.opacityInput.value = String(this.context.getAnnotationCommonVisualProperty('opacity'));

            const disableTargets = [
                state.outlineButton,
                state.edgeButton,
                state.borderInput,
                state.opacityInput,
                state.presetTabButton,
                state.annotationTabButton,
                state.authorTabButton,
                state.presetList,
                state.annotationList,
                state.authorList
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
        for (const viewer of VIEWER_MANAGER.viewers || []) apply(this._getViewerUI(viewer.uniqueId));
    },
};
