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
        this._toggleStrokeStyling(this.context.strokeStyling);
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

                USER_INTERFACE.Status.show(mode.getDescription());
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
