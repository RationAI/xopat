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
        // `chrome: "plain"` — body renders its own `fs.card`s; skip the outer
        // rounded card so we don't double-border.
        USER_INTERFACE.AppBar.Plugins.setMenu(
            this.id,
            'annotations-shared',
            this.t('annotations.export.menuTitle'),
            menuContainer,
            'fa-fw',
            { chrome: 'plain' }
        );
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
     * Aggregates items from the same `CanvasContextMenu` providers that feed
     * the canvas right-click menu (annotations, measurements, playground, ...)
     * so the two surfaces stay in lock-step. "Mark as private" is filtered
     * out here because the annotation row already exposes that toggle inline
     * via its own control.
     */
    _openAnnotationMoreMenu(object, clientX, clientY) {
        const wrapper = this._wrapperForAnnotation(object);
        if (!wrapper) return;

        // Make the active selection match the annotation the user clicked on
        // so handlers (Copy/Cut/Delete/preset change) operate on it.
        if (wrapper.canvas?.setActiveObject) {
            wrapper.canvas.setActiveObject(object);
            wrapper.canvas.renderAll?.();
        }

        const px = clientX ?? 100;
        const py = clientY ?? 100;
        const syntheticEvent = {
            preventDefault: () => {},
            pageX: px, pageY: py,
            clientX: px, clientY: py,
            x: px, y: py,
        };

        const ctx = {
            viewer: wrapper.viewer,
            event: syntheticEvent,
            osdPosition: { x: 0, y: 0 },
            pixelPosition: { x: 0, y: 0 },
            active: object,
        };

        const registry = window.CanvasContextMenu;
        const items = registry?.collect ? registry.collect(ctx) : [];
        const filtered = items.filter((item) => {
            const t = item?.title;
            return t !== 'Mark as private' && t !== 'Unmark as private' && t !== 'Modify annotation:';
        });
        if (!filtered.length) return;

        // Prefer the van.js-based `ContextMenu` (cascading flyouts for items
        // with `children`); fall back to the legacy `window.DropDown` until
        // the UI bundle has been rebuilt to expose the new component.
        // The setTimeout(0) defers past the document-level click listener
        // that `window.DropDown` installs at init: the native click on the
        // canvas (which became this fabric onClick via OSD's mouseup → click
        // sequence) would otherwise bubble to that listener and close the
        // menu the moment it opened. The new ContextMenu uses
        // FloatingManager which registers its outside-click listener in a
        // microtask, so the deferral is harmless either way.
        setTimeout(() => {
            const ctxMenu = window.ContextMenu;
            if (ctxMenu?.open) ctxMenu.open(syntheticEvent, filtered);
            else window.DropDown?.open(syntheticEvent, filtered);
        }, 0);
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

        // Common visual properties (border width, opacity, outline mode) are
        // global — changing them in one viewer's settings updates every fabric
        // instance. Re-sync ALL viewer-menu controls so each window's sliders /
        // checkboxes reflect the new shared value, not just the one touched.
        this.context.addFabricHandler('visual-property-changed', () => this._updateViewerControls());

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
            // Resolve by the viewer object (→ slot id). Using e.uniqueId would
            // collide when two viewports share a background id and tear down the
            // wrong viewport's board.
            this._unbindViewerFabricEvents(e.viewer);
            const state = this._getViewerUI(e.viewer);
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
                    icon: 'ph-arrow-counter-clockwise',
                    label: this.t('annotations.toolbar.undo'),
                    onClick: () => APPLICATION_CONTEXT.history.undo()
                }),
                new ui.ToolbarItem({
                    id: 'toolbar-history-redo',
                    icon: 'ph-arrow-clockwise',
                    label: this.t('annotations.toolbar.redo'),
                    onClick: () => APPLICATION_CONTEXT.history.redo()
                })
            );

            // Measurements is a utility window, not a drawing control — it lives
            // in the app-bar Tools category, not the annotation toolbar.
            USER_INTERFACE.AppBar.Tools.register('annotations.measurements', {
                section: 'annotations',
                sectionTitle: this.t('annotations.toolbar.title'),
                icon: 'ph-chart-bar-horizontal',
                label: this.t('annotations.toolbar.measurements'),
                onClick: () => this.showMeasurementsWindow()
            });

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

            // Initial selection must reflect the *active preset's* factory,
            // not factories[0] — otherwise the toolbar lies about state on
            // page load, and a "first click" that happens to match the lying
            // header gets short-circuited by updatePresetWith (same-value
            // early-out).
            const activeFactoryID = this.context.presets.getActivePreset(true)?.objectFactory?.factoryID;

            this._shapeChoice = new ui.ToolbarChoiceGroup({
                headerMode: 'selectOrExpand',
                itemID: 'cg-shapes',
                defaultSelected: activeFactoryID || factories[0]?.factoryID || 'none',
                onChange: (factoryId) => {
                    this.switchModeActive(modes.CUSTOM.getId(), factoryId, true);
                }
            }, ...factories.map((factory) => new ui.ToolbarItem({
                itemID: factory.factoryID,
                icon: factory.getIcon(),
                label: factory.title(),
                tooltip: `${modes.CUSTOM.getDescription()}: ${factory.title()}`
            }))).attachTo(gModes);

            // Keep the toolbar in sync when the preset's factory changes from
            // elsewhere (initial async preset selection, preset modal, etc.).
            // fireOnChange=false avoids a recursive switchModeActive loop.
            const syncShapeChoice = () => {
                const f = this.context.presets.getActivePreset(true)?.objectFactory;
                if (f?.factoryID) this._shapeChoice?.setSelected(f.factoryID, false);
            };
            this.context.addHandler('preset-select', syncShapeChoice);
            this.context.addHandler('preset-update', syncShapeChoice);

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
            }),
            new ui.ToolbarItem({
                itemID: modes.FIXED_AREA.getId(),
                icon: modes.FIXED_AREA.getIcon(),
                label: modes.FIXED_AREA.getDescription()
            })).attachTo(gModes);

            // Edit-selection is NOT a creation mode, so it lives with the
            // mouse-preset swatch and mode settings in the g-tools group below,
            // not among the drawing modes.
            this._editItem = new ui.ToolbarItem({
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
            });

            this._gModes = gModes;

            // Built-in modes are placed into the dedicated groups above. Any
            // *other* registered mode (e.g. a third-party plugin's custom mode
            // such as SAM segmentation) gets a plain toolbar button auto-added
            // here — so external modes need no toolbar code of their own, they
            // only call context.setCustomModeUsed(...).
            this._builtInModeIds = new Set([
                modes.AUTO.getId(), modes.CUSTOM.getId(),
                modes.FREE_FORM_TOOL_ADD.getId(), modes.FREE_FORM_TOOL_REMOVE.getId(),
                modes.MAGIC_WAND.getId(), modes.FREE_FORM_TOOL_CORRECT.getId(),
                modes.VIEWPORT_SEGMENTATION.getId(), modes.FIXED_AREA.getId(),
                modes.EDIT_SELECTION.getId(),
            ]);
            this._customModeButtons = this._customModeButtons || new Set();
            const addCustomModeButton = (mode) => {
                if (!mode) return;
                const modeId = mode.getId();
                if (this._builtInModeIds.has(modeId) || this._customModeButtons.has(modeId)) return;
                this._customModeButtons.add(modeId);
                new ui.ToolbarItem({
                    itemID: modeId,
                    icon: mode.getIcon(),
                    label: mode.getDescription(),
                    onClick: () => this.switchModeActive(modeId),
                }).attachTo(this._gModes);
            };
            // Modes registered before the toolbar was built (this runs after a
            // 2s delay, so most custom modes are already present)...
            Object.values(this.context.Modes).forEach(addCustomModeButton);
            // ...and modes registered afterwards.
            this.context.addHandler('custom-mode-added', (e) => addCustomModeButton(e.mode));

            this._htmlWrap = new UI.RawHtml({
                id: `${this.id}-mode-options-html`,
                extraClasses: { base: 'w-full h-full text-sm' }
            }, this.context.mode.customHtml() || '');

            this._modeOptionsPanel = new UI.ToolbarPanelButton({
                id: 'mode-options',
                itemID: 'mode-options',
                icon: 'ph-sliders',
                label: this.t('annotations.toolbar.modeOptions'),
                panelClass: 'w-80 max-h-[60vh] overflow-y-auto space-y-2',
            }, this._htmlWrap);

            const presetSwatch = this.buildPresetSwatchToolbarButton();

            // Edit (selection), mouse-preset swatch and mode settings share one
            // group. Selectable so the edit item highlights when active; the two
            // panel buttons aren't ToolbarItems, so they never claim the slot.
            const gTools = new ui.ToolbarGroup({ id: 'g-tools', itemID: 'g-tools', selectable: true },
                this._editItem, presetSwatch, this._modeOptionsPanel);
            this._gTools = gTools;

            USER_INTERFACE.Tools.setMenu(this.id, 'annotations-tool-bar', this.t('annotations.toolbar.title'),
                [gHistory, new UI.ToolbarSeparator(), gModes, new UI.ToolbarSeparator(), gTools],
                'draw'
            );
            // The toolbar builds lazily (this runs in a setTimeout), after the
            // initial updatePresetsHTML — so paint the swatch once its DOM exists.
            this._refreshPresetSwatch();

            const modeChangeHandler = (e) => {
                const mode = e.mode;
                const modes = this.context.Modes;
                const modeId = mode.getId();

                if (this._htmlWrap && this._modeOptionsPanel) {
                    // Read from `e.mode`, not `this.context.mode`: the
                    // _setModeToAuto path in annotations.js fires the event
                    // BEFORE assigning `this.mode`, so the global would still
                    // point at the previous (now-stale) mode and the panel
                    // would never hide when switching to navigation.
                    const rawHtml = (mode.customHtml && mode.customHtml()) || '';
                    const hasHtml = !!rawHtml && rawHtml.trim().length > 0;

                    if (hasHtml) {
                        this._htmlWrap.setHtml(rawHtml);
                        this._modeOptionsPanel.setVisible(true);
                        // Auto-open on every tool switch where options exist.
                        // Manual close within a tool stays closed until the
                        // next mode-changed fires — this re-opens by design.
                        if (!this._modeOptionsPanel.isOpen()) {
                            this._modeOptionsPanel.open();
                        }
                    } else {
                        this._htmlWrap.setHtml('');
                        this._modeOptionsPanel.setVisible(false);
                    }
                }

                // Edit-selection lives in g-tools; every other mode in g-modes.
                // Keep the two groups mutually exclusive so only one shows active.
                const isEdit = modeId === modes.EDIT_SELECTION.getId();
                this._gTools?.setSelected(isEdit ? modes.EDIT_SELECTION.getId() : null);
                if (isEdit) {
                    this._gModes.setSelected(null);
                } else if (modeId === modes.AUTO.getId()) {
                    this._gModes.setSelected(modes.AUTO.getId(), false);
                } else if (
                    modeId === modes.MAGIC_WAND.getId() ||
                    modeId === modes.FREE_FORM_TOOL_CORRECT.getId() ||
                    modeId === modes.VIEWPORT_SEGMENTATION.getId() ||
                    modeId === modes.FIXED_AREA.getId()
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
            // Apply the current mode once at startup: no 'mode-changed' has
            // fired yet, so without this the mode-options panel shows for the
            // default (auto/navigate) mode, which has no options.
            if (this.context.mode) modeChangeHandler({ mode: this.context.mode });
        }, 2000);
    },

    updateSelectedFormat(format) {
        this.exportOptions.format = format;
        this.context.setIOOption('format', format);
        this.cache.set('defaultIOFormat', format);
    },
};
