export function createErrorHandlers(plugin) {
    return {
        W_NO_PRESET: (e) => {
            Dialogs.show(plugin.t('errors.noPresetAction', {
                selfId: plugin.id,
                action: `USER_INTERFACE.highlight('RightSideMenu', 'annotations-panel', '${e.isLeftClick ? 'annotations-left-click' : 'annotations-right-click'}');`
            }), 3000, Dialogs.MSG_WARN, false);
            return false;
        },
        W_AUTO_CREATION_FAIL: () => {
            Dialogs.show(`Could not create automatic annotation. Make sure you are <a class='pointer' onclick="USER_INTERFACE.highlight('Tools', 'annotations-tool-bar', 'sensitivity-auto-outline')">detecting in the correct layer</a> and selecting coloured area. Also, adjusting threshold can help.`, 5000, Dialogs.MSG_WARN, false);
            return false;
        },
        E_AUTO_OUTLINE_INVISIBLE_LAYER: () => {
            Dialogs.show(`The <a class='pointer' onclick="USER_INTERFACE.highlight('Tools', 'annotations-tool-bar', 'sensitivity-auto-outline')">chosen layer</a> is not visible: auto outline method will not work.`, 5000, Dialogs.MSG_WARN, false);
            return false;
        }
    };
}

export const handlerMethods = {
    initHandlers() {
        VIEWER.addHandler('background-image-swap', () => this.setupActiveTissue());
        VIEWER_MANAGER.broadcastHandler('warn-user', (e) => this._errorHandlers[e.code]?.apply(this, [e]));

        this.context.addHandler('import', () => {
            this._refreshAllPresetLists?.();
            this._refreshAllAuthorLists?.();
            this._refreshAllAnnotationFilterBadges?.();
            this._refreshAllBoardPanels?.();
        });
        this.context.addHandler('annotation-filter-change', () => {
            this._refreshAllAnnotationFilterBadges?.();
            this._refreshAllBoardPanels?.();
        });
        this.context.addHandler('enabled', this.annotationsEnabledHandler.bind(this));
        this.context.addHandler('preset-select', () => this._refreshAllPresetLists?.());

        this.context.addHandler('preset-create', () => {
            this.updatePresetEvent?.();
            this._refreshAllPresetLists?.();
        });

        this.context.addHandler('preset-update', () => {
            this.updatePresetEvent?.();
            this._refreshAllPresetLists?.();
        });

        this.context.addHandler('preset-delete', () => {
            this.updatePresetEvent?.();
            this._refreshAllPresetLists?.();
        });

        this.context.addHandler('preset-meta-add', () => {
            this.updatePresetEvent?.();
            this._refreshAllPresetLists?.();
        });

        this.context.addHandler('preset-meta-remove', () => {
            this.updatePresetEvent?.();
            this._refreshAllPresetLists?.();
        });

        this.context.addFabricHandler('annotation-set-private', () => {
            this.context.fabric.rerender();
            this._refreshAllBoardPanels?.();
        });

        this.context.Modes.FREE_FORM_TOOL_ADD.customHtml =
            this.context.Modes.FREE_FORM_TOOL_REMOVE.customHtml =
                this.context.Modes.FREE_FORM_TOOL_CORRECT.customHtml =
                    this.freeFormToolControls.bind(this);

        this.context.addHandler('free-form-tool-radius', (e) => {
            $('#fft-size').val(e.radius);
        });
    },

    setupTutorials() {
        // Plugin-locale lookups must go through `this.t(...)` so i18next picks
        // the correct namespace (the plugin id, set by XOpatElement.t). The
        // selectors use the `[id$="-…"]` viewer-agnostic pattern documented
        // in src/TUTORIALS.md; per-viewer ids (`${viewerId}-annotations-*`)
        // are emitted by methods/viewerMenu.mjs.
        USER_INTERFACE.Tutorials.add(
            this.id,
            this.t('annotations.tutorial.title'),
            this.t('annotations.tutorial.description'),
            'ph-pencil-simple-line',
            [
                { 'click [id$="-right-menu-menu-b-opened-gui_annotations"]': this.t('annotations.tutorial.openPanel') },
                { 'next [id$="-annotations-enable-toggle"]': this.t('annotations.tutorial.enable') },
                { 'next [id$="-annotations-settings"]': this.t('annotations.tutorial.settings') },
                { 'next #viewer-container': this.t('annotations.tutorial.canvas') },
            ]
        );
    },

    annotationsEnabledHandler() {
        this._updateViewerControls?.();
        const toolBar = document.getElementById('annotations-tool-bar');
        const enabled = !this.context.disabledInteraction;
        if (toolBar) toolBar.classList.toggle('disabled', !enabled);
    },

    freeFormToolControls() {
        return `<span class="position-absolute top-0" style="font-size: xx-small" title="Size of a brush (scroll to change).">Brush radius:</span>
<input class="form-control" title="Size of a brush (scroll to change)." type="number" min="5" max="100" step="1" name="freeFormToolSize" id="fft-size" autocomplete="off" value="${this.context.freeFormTool.screenRadius}" style="height: 22px; width: 60px; margin-top: 6px;" onchange="${this.THIS}.context.freeFormTool.setSafeRadius(Number.parseInt(this.value));">`;
    }
};
