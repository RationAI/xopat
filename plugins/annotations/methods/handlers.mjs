export function createErrorHandlers(plugin) {
    // Toast messages carry links, but inline onclick="" is stripped by the toast
    // sanitizer. Wire behaviour through the toast `actions` map instead: the
    // message markup uses `data-action="<key>"` and the handler binds the key
    // to a function. Keeps the links working without any executable HTML.
    const highlight = (...args) => window.USER_INTERFACE?.highlight?.(...args);
    const highlightAutoOutline = () => highlight('Tools', 'annotations-tool-bar', 'sensitivity-auto-outline');

    return {
        W_NO_PRESET: (e) => {
            Dialogs.show(
                plugin.t('annotations.errors.noPresetSelect'),
                3000, Dialogs.MSG_WARN,
                { actions: { selectPreset: () => highlight('RightSideMenu', 'annotations-panel',
                    e.isLeftClick ? 'annotations-left-click' : 'annotations-right-click') } }
            );
            return false;
        },
        W_OUTSIDE_WORKSPACE: () => {
            Dialogs.show(plugin.t('annotations.workspace.outsideWarning'), 3000, Dialogs.MSG_WARN);
            return false;
        },
        W_AUTO_CREATION_FAIL: () => {
            Dialogs.show(
                plugin.t('annotations.errors.autoCreateFail'),
                5000, Dialogs.MSG_WARN,
                { actions: { highlightAutoOutline } }
            );
            return false;
        },
        E_AUTO_OUTLINE_INVISIBLE_LAYER: () => {
            Dialogs.show(
                plugin.t('annotations.errors.autoOutlineInvisibleLayer'),
                5000, Dialogs.MSG_WARN,
                { actions: { highlightAutoOutline } }
            );
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
        this.context.addHandler('preset-select', () => {
            this._refreshAllPresetLists?.();
            this.updatePresetsMouseButtons?.();
        });

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

        // A vocabulary arriving (or going away) changes what the editor may offer
        // at all — free-text creation becomes a picker and existing classified
        // presets become read-only — so the whole preset UI is rebuilt, not just
        // its list.
        this.context.addHandler('preset-vocabulary-changed', () => {
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
            const fftSize = document.getElementById('fft-size');
            if (fftSize) fftSize.value = e.radius;
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

    /**
     * Mode-options panel content for the three brush modes. Raw HTML string
     * (the `customHtml()` contract), injected via `UI.RawHtml`; laid out as a
     * label-over-control column because the panel is narrow and vertical.
     * Widths are inline — the purged `tailwind.min.css` drops many utilities.
     */
    freeFormToolControls() {
        const label = this.t('annotations.modeOptions.brushRadius');
        const hint = this.t('annotations.modeOptions.brushRadiusHint');
        return `
<div style="display:flex;flex-direction:column;gap:0.25rem;width:14rem;max-width:100%;padding:0.25rem;">
    <label class="text-xs font-medium opacity-70" for="fft-size" title="${hint}">${label}</label>
    <input class="input input-sm input-bordered" style="width:100%;" title="${hint}"
        type="number" min="5" max="100" step="1" name="freeFormToolSize" id="fft-size" autocomplete="off"
        value="${this.context.freeFormTool.screenRadius}"
        onchange="${this.THIS}.context.freeFormTool.setSafeRadius(Number.parseInt(this.value));">
</div>`;
    }
};
