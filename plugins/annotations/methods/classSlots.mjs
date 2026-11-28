/**
 * Class slot shortcuts.
 *
 * Nine positional slots address the annotation classes (presets) by their
 * order in the class list: slot N is the Nth preset, resolved at PRESS time.
 * Positional on purpose — preset ids are frequently generated per session, so
 * a shortcut per preset id would churn the Keymap panel and orphan the user's
 * persisted combo overrides.
 *
 * Two independent families are registered per slot:
 *   - select: make the class active for the left mouse button. Does not touch
 *     the mode, so it composes with hold-to-draw mode keys and quick-draw.
 *   - assign: give the class to the annotations selected in the viewer the
 *     stroke came from. Does not change the active class.
 *
 * `classSlots: false` in the deployment config (static meta) opts out.
 */
const SLOT_COUNT = 9;

const selectId = (n) => `annotations.class.select.${n}`;
const assignId = (n) => `annotations.class.assign.${n}`;

export const classSlotMethods = {
    /** Register both slot families. Idempotent by shortcut id. */
    setupClassSlotShortcuts() {
        const shortcuts = APPLICATION_CONTEXT?.shortcuts;
        if (!shortcuts || !this.getStaticMeta('classSlots', true)) return;

        const common = {
            categoryPath: ['keymap.cat.annotations', 'keymap.cat.annotationClasses'],
            owner: this.id,
            type: 'press',
            trigger: 'down',
            scope: { requiresCanvasFocus: true, allowInInputs: false },
        };

        for (let n = 1; n <= SLOT_COUNT; n++) {
            shortcuts.register({
                ...common,
                id: selectId(n),
                titleKey: 'annotations:keymap.classSlots.select',
                titleArgs: { n },
                defaultCombos: [`Digit${n}`],
                handler: () => this._selectClassSlot(n - 1),
            });
            shortcuts.register({
                ...common,
                id: assignId(n),
                titleKey: 'annotations:keymap.classSlots.assign',
                titleArgs: { n },
                defaultCombos: [`Shift+Digit${n}`],
                handler: (ctx) => this._assignClassSlot(n - 1, ctx?.viewer),
            });
        }
    },

    /**
     * Select every visible annotation of the viewer the stroke came from.
     * Registered apart from the class slots: it is not theirs to opt out of.
     */
    setupSelectionShortcuts() {
        const shortcuts = APPLICATION_CONTEXT?.shortcuts;
        if (!shortcuts) return;
        shortcuts.register({
            id: 'annotations.selectAll',
            titleKey: 'annotations:keymap.selectAll',
            categoryPath: ['keymap.cat.annotations'],
            owner: this.id,
            type: 'press',
            // "down": the combo must beat the browser's own select-all.
            trigger: 'down',
            scope: { requiresCanvasFocus: true, allowInInputs: false },
            defaultCombos: ['Primary+KeyA'],
            handler: (ctx) => {
                if (!this.context || this.context.disabledInteraction || !ctx?.viewer) return;
                this.context.getFabric(ctx.viewer)?.selectAllAnnotations?.();
            },
        });
    },

    /**
     * Preset occupying a slot, or null when the slot is empty.
     * @param {number} index zero-based slot
     */
    _classSlotPreset(index) {
        if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) return null;
        const presets = this.context.presets;
        let position = 0;
        for (const id of presets.getExistingIds()) {
            if (position++ === index) return presets.get(id) || null;
        }
        return null;
    },

    /** Activate the slot's class for the left mouse button. Empty slot: no-op. */
    _selectClassSlot(index) {
        if (!this.context || this.context.disabledInteraction) return;
        const preset = this._classSlotPreset(index);
        if (preset) this.context.setPreset(preset, true);
    },

    /**
     * Give the slot's class to the annotations selected in `viewer`.
     * @param {number} index zero-based slot
     * @param {OpenSeadragon.Viewer} viewer viewer the stroke was made in
     * @return {number} how many annotations changed class
     */
    _assignClassSlot(index, viewer) {
        if (!this.context || this.context.disabledInteraction || !viewer) return 0;
        const preset = this._classSlotPreset(index);
        const fabric = preset && this.context.getFabric(viewer);
        if (!fabric) return 0;

        let changed = 0;
        for (const annotation of (fabric.getSelectedAnnotations?.() || [])) {
            if (annotation.presetID === preset.presetID) continue;
            if (fabric.changeAnnotationPreset(annotation, preset.presetID)) changed++;
        }
        return changed;
    },

    /**
     * Display form of the key currently bound to "select" for a slot, following
     * user remaps. Null when the slot has no binding or lies past the last slot.
     * @param {number} index zero-based slot
     * @return {string|null}
     */
    _classSlotLabel(index) {
        if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) return null;
        const shortcuts = APPLICATION_CONTEXT?.shortcuts;
        const combo = shortcuts?.getBinding(selectId(index + 1))?.combos?.[0];
        return combo ? shortcuts.comboDisplayParts(combo).join('+') : null;
    },
};
