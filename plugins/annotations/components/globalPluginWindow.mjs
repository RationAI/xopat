import { createCommentsWindow, finalizeCommentsWindowMount } from '../components/commentsWindow.mjs';
import {createAnnotationSettingsMenu} from "./annotationSettingsMenu.mjs";

export const globalPluginWindowMethods = {
    initHTML() {
        USER_INTERFACE.addHtml(createCommentsWindow(this), this.id);
        finalizeCommentsWindowMount(this);

        this._initGlobalPluginWindow();
        this.initViewerMenu();
        this._initAnnotationsToolbar();

        const menuContainer = div({ id: 'annotations-shared-settings-container' });
        USER_INTERFACE.AppBar.Plugins.setMenu(this.id, 'annotations-shared', this.t('annotations.export.menuTitle'), menuContainer);
        van.add(menuContainer, createAnnotationSettingsMenu(this));

        this.updateSelectedFormat(this.exportOptions.format);
        this.updatePresetsHTML();

        this.context.addHandler('author-annotation-styling-toggle', (e) => this._toggleStrokeStyling(e.enable));
        this.context.addHandler('comments-control-clicked', () => this.commentsToggleWindow());
        this.context.addHandler('annotation-updated-comment', () => this._renderComments());
        this.context.addHandler('annotation-more-clicked', (e) => {
            if (!e?.object) return;
            this._openAnnotationMoreMenu(e.object, e.clientX, e.clientY);
        });
        this._toggleStrokeStyling(this.context.strokeStyling);
    },

    /**
     * Resolve the FabricWrapper instance that owns a given annotation object,
     * or null when none does (e.g. the object was just deleted).
     */
    _wrapperForAnnotation(object) {
        if (!object || !OSDAnnotations.FabricWrapper?.instances) return null;
        for (const wrapper of OSDAnnotations.FabricWrapper.instances()) {
            if (wrapper?.canvas?._objects?.indexOf(object) !== -1) return wrapper;
        }
        return null;
    },

    /**
     * Popover menu opened from the annotation toolbar's "..." control.
     * Items dispatch to the wrapper that owns the clicked annotation.
     */
    _openAnnotationMoreMenu(object, clientX, clientY) {
        document.body.querySelector('[data-role="annotation-more-menu"]')?.remove();

        const wrapper = this._wrapperForAnnotation(object);
        if (!wrapper) return;

        const menu = document.createElement('div');
        menu.dataset.role = 'annotation-more-menu';
        menu.className = 'absolute z-50 menu menu-sm bg-base-200 rounded-box shadow border border-base-300';
        menu.style.minWidth = '180px';

        const dismiss = () => menu.remove();

        const addItem = (label, onClick, opts = {}) => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-ghost btn-xs justify-start w-full';
            btn.textContent = label;
            if (opts.disabled) btn.disabled = true;
            btn.onclick = (ev) => {
                ev.stopPropagation();
                try { onClick(); } catch (err) { console.error(err); }
                dismiss();
            };
            menu.appendChild(btn);
        };

        // Delete
        addItem('Delete', () => {
            wrapper.deleteObject?.(object);
        });

        // Move to layer ▶
        const layers = wrapper.getAllLayers?.() || [];
        if (typeof wrapper.setAnnotationLayer === 'function') {
            const moveBtn = document.createElement('div');
            moveBtn.className = 'dropdown dropdown-right';
            const trigger = document.createElement('button');
            trigger.className = 'btn btn-ghost btn-xs justify-between w-full';
            trigger.innerHTML = '<span>Move to layer</span><span class="opacity-60">▶</span>';
            trigger.onclick = (ev) => {
                ev.stopPropagation();
                document.body.querySelector('[data-role="annotation-more-submenu"]')?.remove();
                const sub = document.createElement('div');
                sub.dataset.role = 'annotation-more-submenu';
                sub.className = 'absolute z-50 menu menu-sm bg-base-200 rounded-box shadow border border-base-300';
                sub.style.minWidth = '180px';
                const rect = trigger.getBoundingClientRect();
                sub.style.top = `${rect.top + window.scrollY}px`;
                sub.style.left = `${rect.right + window.scrollX + 4}px`;

                const sAdd = (label, layerId) => {
                    const b = document.createElement('button');
                    b.className = 'btn btn-ghost btn-xs justify-start w-full';
                    b.textContent = label;
                    b.onclick = (e) => {
                        e.stopPropagation();
                        wrapper.setAnnotationLayer(object, layerId);
                        sub.remove();
                        dismiss();
                    };
                    sub.appendChild(b);
                };
                sAdd('(no layer)', null);
                for (const l of layers) sAdd(l.name || `Layer ${l.id}`, l.id);

                document.body.appendChild(sub);
                const onDoc = (ev) => {
                    if (!sub.contains(ev.target)) {
                        sub.remove();
                        document.removeEventListener('mousedown', onDoc, true);
                    }
                };
                requestAnimationFrame(() => document.addEventListener('mousedown', onDoc, true));
            };
            moveBtn.appendChild(trigger);
            menu.appendChild(moveBtn);
        }

        // Group siblings by ▶
        if (typeof wrapper.groupSiblingsByCriterion === 'function') {
            const trigger = document.createElement('button');
            trigger.className = 'btn btn-ghost btn-xs justify-between w-full';
            trigger.innerHTML = '<span>Group siblings by</span><span class="opacity-60">▶</span>';
            trigger.onclick = (ev) => {
                ev.stopPropagation();
                document.body.querySelector('[data-role="annotation-more-submenu"]')?.remove();
                const sub = document.createElement('div');
                sub.dataset.role = 'annotation-more-submenu';
                sub.className = 'absolute z-50 menu menu-sm bg-base-200 rounded-box shadow border border-base-300';
                sub.style.minWidth = '180px';
                const rect = trigger.getBoundingClientRect();
                sub.style.top = `${rect.top + window.scrollY}px`;
                sub.style.left = `${rect.right + window.scrollX + 4}px`;

                const sAdd = (label, criterion) => {
                    const b = document.createElement('button');
                    b.className = 'btn btn-ghost btn-xs justify-start w-full';
                    b.textContent = label;
                    b.onclick = (e) => {
                        e.stopPropagation();
                        wrapper.groupSiblingsByCriterion(object, criterion, { kind: 'new' });
                        sub.remove();
                        dismiss();
                    };
                    sub.appendChild(b);
                };
                sAdd('Same shape type', 'factory');
                sAdd('Same preset', 'preset');
                sAdd('Same author', 'author');
                sAdd('Same category', 'category');

                document.body.appendChild(sub);
                const onDoc = (ev) => {
                    if (!sub.contains(ev.target)) {
                        sub.remove();
                        document.removeEventListener('mousedown', onDoc, true);
                    }
                };
                requestAnimationFrame(() => document.addEventListener('mousedown', onDoc, true));
            };
            menu.appendChild(trigger);
        }

        // Copy ID
        if (object.incrementId !== undefined) {
            addItem('Copy ID', () => {
                try { navigator.clipboard?.writeText?.(String(object.incrementId)); } catch {}
            });
        }

        document.body.appendChild(menu);
        menu.style.top = `${(clientY ?? 100) + window.scrollY}px`;
        menu.style.left = `${(clientX ?? 100) + window.scrollX}px`;

        const onDoc = (ev) => {
            if (!menu.contains(ev.target)) {
                dismiss();
                document.body.querySelector('[data-role="annotation-more-submenu"]')?.remove();
                document.removeEventListener('mousedown', onDoc, true);
            }
        };
        requestAnimationFrame(() => document.addEventListener('mousedown', onDoc, true));
    },

    _initGlobalPluginWindow() {
        this.context.addHandler('enabled', () => {
            this._updateViewerControls();
            this._refreshAllBoardPanels();
        });

        this.context.addHandler('annotation-loaded', (e) => {
            const viewerId = e?.viewer ? this._resolveViewerId(e.viewer) : undefined;
            if (viewerId) {
                this._getViewerUI(viewerId)?.boardPanel?.requestRender();
            } else {
                this._refreshAllBoardPanels();
            }
        });

        const refreshBoardForViewer = (e) => {
            const viewerId = e?.viewer ? this._resolveViewerId(e.viewer) : undefined;
            if (viewerId) {
                this._getViewerUI(viewerId)?.boardPanel?.requestRender();
            } else {
                this._refreshAllBoardPanels();
            }
        };

        this.context.addFabricHandler('annotation-edit', refreshBoardForViewer);
        this.context.addFabricHandler('annotation-edit-end', refreshBoardForViewer);

        const globalSideRefresh = () => {
            this._refreshAllBoardPanels();
            this._refreshAllPresetLists();
            this._refreshAllAuthorLists();
        };

        this.context.addHandler('annotation-preset-change', globalSideRefresh);
        this.context.addHandler('import', globalSideRefresh);

        this.context.addHandler('save-annotations', async (e) => {
            await this.exportToFile();
            e.setHandled(this.t('annotations.export.downloadFallbackHandled'));
        }, null, -Infinity);

        VIEWER_MANAGER.addHandler('viewer-destroy', (e) => {
            this._unbindViewerFabricEvents(e.uniqueId);
            const state = this._getViewerUI(e.uniqueId);
            state?.boardPanel?.destroy?.();
        });
    },

    _initAnnotationsToolbar() {
        setTimeout(() => {
            const ui = window.UI;
            const modes = this.context.Modes;

            const gHistory = new ui.ToolbarGroup({ id: 'g-history' },
                new ui.ToolbarItem({
                    id: 'toolbar-history-undo',
                    icon: 'fa-rotate-left',
                    label: this.t('annotations.toolbar.undo'),
                    onClick: () => APPLICATION_CONTEXT.history.undo()
                }),
                new ui.ToolbarItem({
                    id: 'toolbar-history-redo',
                    icon: 'fa-rotate-right',
                    label: this.t('annotations.toolbar.redo'),
                    onClick: () => APPLICATION_CONTEXT.history.redo()
                }),
                new ui.ToolbarItem({
                    id: 'toolbar-history-metrics',
                    icon: 'fa-square-poll-horizontal',
                    label: this.t('annotations.toolbar.measurements'),
                    onClick: () => this.showMeasurementsWindow()
                })
            );

            const factories = this._allowedFactories
                .map((factoryId) => this.context.getAnnotationObjectFactory(factoryId))
                .filter(Boolean);

            const gModes = new ui.ToolbarGroup({
                itemID: 'g-modes',
                selectable: true,
                defaultSelected: modes.AUTO.getId(),
                extraClasses: { padding: 'mx-2' }
            });

            new ui.ToolbarItem({
                itemID: modes.AUTO.getId(),
                icon: modes.AUTO.getIcon(),
                label: modes.AUTO.getDescription(),
                onClick: () => {
                    this.switchModeActive(modes.AUTO.getId());
                }
            }).attachTo(gModes);

            this._shapeChoice = new ui.ToolbarChoiceGroup({
                headerMode: 'selectOrExpand',
                itemID: 'cg-shapes',
                defaultSelected: factories[0]?.id || 'none',
                onChange: (factoryId) => {
                    this.switchModeActive(modes.CUSTOM.getId(), factoryId, true);
                }
            }, ...factories.map((factory) => new ui.ToolbarItem({
                itemID: factory.factoryID,
                icon: factory.getIcon(),
                label: `${modes.CUSTOM.getDescription()}: ${factory.title()}`
            }))).attachTo(gModes);

            this._gBrush = new ui.ToolbarGroup({ id: 'g-brush', itemID: 'g-brush', selectable: true },
                new ui.ToolbarItem({
                    itemID: modes.FREE_FORM_TOOL_ADD.getId(),
                    icon: modes.FREE_FORM_TOOL_ADD.getIcon(),
                    label: modes.FREE_FORM_TOOL_ADD.getDescription(),
                    onClick: () => {
                        this.switchModeActive(modes.FREE_FORM_TOOL_ADD.getId());
                    },
                    extraClasses: { icon: 'thumb-add' }
                }),
                new ui.ToolbarItem({
                    itemID: modes.FREE_FORM_TOOL_REMOVE.getId(),
                    icon: modes.FREE_FORM_TOOL_REMOVE.getIcon(),
                    label: modes.FREE_FORM_TOOL_REMOVE.getDescription(),
                    onClick: () => {
                        this.switchModeActive(modes.FREE_FORM_TOOL_REMOVE.getId());
                    },
                    extraClasses: { icon: 'thumb-remove' }
                })
            ).attachTo(gModes);

            this._autoChoice = new ui.ToolbarChoiceGroup({
                itemID: 'cg-auto',
                defaultSelected: modes.MAGIC_WAND.getId(),
                onChange: (id) => {
                    this.switchModeActive(id);
                }
            },
            new ui.ToolbarItem({
                itemID: modes.MAGIC_WAND.getId(),
                icon: modes.MAGIC_WAND.getIcon(),
                label: modes.MAGIC_WAND.getDescription()
            }),
            new ui.ToolbarItem({
                itemID: modes.FREE_FORM_TOOL_CORRECT.getId(),
                icon: modes.FREE_FORM_TOOL_CORRECT.getIcon(),
                label: modes.FREE_FORM_TOOL_CORRECT.getDescription()
            }),
            new ui.ToolbarItem({
                itemID: modes.VIEWPORT_SEGMENTATION.getId(),
                icon: modes.VIEWPORT_SEGMENTATION.getIcon(),
                label: modes.VIEWPORT_SEGMENTATION.getDescription()
            })).attachTo(gModes);

            new ui.ToolbarItem({
                itemID: modes.EDIT_SELECTION.getId(),
                icon: modes.EDIT_SELECTION.getIcon(),
                label: modes.EDIT_SELECTION.getDescription(),
                onClick: () => {
                    if (this.context.mode === modes.EDIT_SELECTION) {
                        this.switchModeActive(modes.AUTO.getId());
                        return;
                    }
                    this.switchModeActive(modes.EDIT_SELECTION.getId());
                }
            }).attachTo(gModes);

            this._gModes = gModes;

            this._htmlWrap = new UI.RawHtml({
                id: `${this.id}-mode-options-html`,
                extraClasses: { base: 'w-full h-full text-sm' }
            }, this.context.mode.customHtml() || '');

            this._modeOptionsPanel = new UI.ToolbarPanelButton({
                id: 'mode-options',
                itemID: 'mode-options',
                icon: 'fa-sliders',
                label: this.t('annotations.toolbar.modeOptions'),
                panelClass: 'w-80 max-h-[60vh] overflow-y-auto space-y-2',
                onToggle: (open) => {
                    if (!open) this._forceCloseModeOptions = true;
                }
            }, this._htmlWrap);

            USER_INTERFACE.Tools.setMenu(this.id, 'annotations-tool-bar', this.t('annotations.toolbar.title'),
                [gHistory, new UI.ToolbarSeparator(), gModes, new UI.ToolbarSeparator(), this._modeOptionsPanel],
                'draw'
            );

            const modeChangeHandler = (e) => {
                const mode = e.mode;
                const modes = this.context.Modes;
                const modeId = mode.getId();

                if (this._htmlWrap && this._modeOptionsPanel) {
                    const rawHtml = (this.context.mode.customHtml && this.context.mode.customHtml()) || '';
                    const hasHtml = !!rawHtml && rawHtml.trim().length > 0;

                    if (hasHtml) {
                        this._htmlWrap.setHtml(rawHtml);
                        this._modeOptionsPanel.setEnabled(true);
                        if (!this._forceCloseModeOptions && !this._modeOptionsPanel.isOpen()) {
                            this._modeOptionsPanel.open();
                        }
                    } else {
                        this._htmlWrap.setHtml('');
                        this._modeOptionsPanel.close();
                        this._modeOptionsPanel.setEnabled(false);
                        this._forceCloseModeOptions = true;
                    }
                }

                if (modeId === modes.AUTO.getId()) {
                    this._gModes.setSelected(modes.AUTO.getId(), false);
                } else if (
                    modeId === modes.MAGIC_WAND.getId() ||
                    modeId === modes.FREE_FORM_TOOL_CORRECT.getId() ||
                    modeId === modes.VIEWPORT_SEGMENTATION.getId()
                ) {
                    this._gModes.setSelected('cg-auto', false);
                    this._autoChoice.setSelected(modeId, false, false);
                } else if (
                    modeId === modes.FREE_FORM_TOOL_ADD.getId() ||
                    modeId === modes.FREE_FORM_TOOL_REMOVE.getId()
                ) {
                    this._gModes.setSelected('g-brush', false);
                    this._gBrush.setSelected(modeId, false);
                } else if (modeId === modes.CUSTOM.getId()) {
                    const pl = this.context.presets.left;
                    if (pl && pl.objectFactory && pl.objectFactory.factoryID) {
                        this._gModes.setSelected('cg-shapes', false);
                        this._shapeChoice.setSelected(pl.objectFactory.factoryID, false, false);
                    }
                } else {
                    this._gModes.setSelected(`${modeId}`, false);
                }
            };

            this.context.addHandler('mode-changed', modeChangeHandler);
        }, 2000);
    },

    updateSelectedFormat(format) {
        this.exportOptions.format = format;
        this.context.setIOOption('format', format);
        this.cache.set('defaultIOFormat', format);
    },
};
