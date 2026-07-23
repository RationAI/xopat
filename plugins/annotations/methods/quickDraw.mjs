/**
 * Quick-draw shortcuts.
 *
 * A quick-draw shortcut collapses "pick a shape", "pick a preset" and "enter
 * manual drawing mode" into a single key press. Every shortcut ships UNBOUND
 * (`defaultCombos: []`) — a deployment (or the user, via the Keymap panel)
 * assigns the actual combo. The combos themselves are owned by the central
 * ShortcutManager (`APPLICATION_CONTEXT.shortcuts`, remappable + persisted per
 * browser); this module only owns what a stroke DOES.
 *
 * Two families of definitions are registered:
 *   1. Auto per-shape — one entry per allowed factory (rect/ellipse/…). Sets
 *      the active preset's shape and enters the manual `custom` mode.
 *   2. Composite — declared by the operator (`ENV plugins.annotations.quickDraw`,
 *      via getStaticMeta = trusted/deployable) and/or the session
 *      (`getOption('quickDraw')` = travels with an exported session). A composite
 *      entry may set a shape, a preset, or both in one stroke. Session entries
 *      override deploy entries that share an `id`.
 *
 * Preset linking resolves at FIRE time (not registration), so a shortcut stays
 * valid across configs whose preset sets differ. A ref is `{ id?, index? }`
 * (or a bare string id / bare number index): the stable preset id wins; if that
 * preset is absent, we fall back to the Nth preset in insertion order; if still
 * nothing resolves, the stroke degrades closed (toast, no draw).
 *
 * @typedef {(string|number|{id?: string, index?: number})} QuickDrawPresetRef
 * @typedef {{
 *   id: string,                    // stable, unique per plugin instance
 *   factory?: string,              // factoryID: "rect" | "ellipse" | "polygon" | "line" | …
 *   preset?: QuickDrawPresetRef,   // which preset to activate + draw with
 *   side?: "left" | "right",       // mouse button the preset/shape binds to (default left)
 *   combo?: string,                // default combo (canonical, see SHORTCUTS.md); omit = unbound
 *   titleKey?: string,             // i18n key for the Keymap panel row
 *   descriptionKey?: string
 * }} QuickDrawDef
 */
export const quickDrawMethods = {
    /**
     * Register the quick-draw shortcut family. Idempotent by shortcut id
     * (re-running replaces specs; user combo overrides survive), so it is safe
     * to call again if the definition source changes.
     */
    setupQuickDrawShortcuts() {
        const shortcuts = APPLICATION_CONTEXT?.shortcuts;
        if (!shortcuts) return;

        for (const def of this._collectQuickDrawDefs()) {
            shortcuts.register({
                id: `annotations.quickdraw.${def.id}`,
                titleKey: def.titleKey,
                titleArgs: def.titleArgs,
                descriptionKey: def.descriptionKey,
                categoryPath: ['keymap.cat.annotations', 'keymap.cat.annotationQuickDraw'],
                defaultCombos: def.combo ? [def.combo] : [],
                owner: this.id,
                // Sticky press: enter manual mode and stay there (unlike the
                // hold-to-draw mode keys). One tap selects shape+preset+mode.
                type: 'press',
                trigger: 'down',
                scope: { requiresCanvasFocus: true, allowInInputs: false },
                handler: () => this._fireQuickDraw(def.action),
            });
        }
    },

    /** Localized human name of a shape factory, for a quick-draw title. */
    _shapeName(factoryID) {
        const factory = this.context.getAnnotationObjectFactory(factoryID);
        return factory?.title?.() || factoryID;
    },

    /** @return {Array<{id: string, titleKey: string, titleArgs?: object, descriptionKey?: string, combo?: string, action: object}>} */
    _collectQuickDrawDefs() {
        const defs = [];

        // (1) Auto per-shape. `quickDrawShapes: false` in ENV opts a deployment
        // out of the shape family entirely. One translatable key
        // (`quickDraw.shape` = "Quick-draw: {{shape}}") is interpolated with the
        // factory's own localized name — no per-shape locale entries to maintain.
        if (this.getStaticMeta('quickDrawShapes', true)) {
            for (const factoryID of (this._allowedFactories || [])) {
                if (typeof factoryID !== 'string') continue;
                defs.push({
                    id: `shape.${factoryID}`,
                    titleKey: 'annotations:keymap.quickDraw.shape',
                    titleArgs: { shape: this._shapeName(factoryID) },
                    action: { factory: factoryID, side: 'left' },
                });
            }
        }

        // (2) Composite: deploy (trusted static meta) + session (option),
        // merged by id so a session entry overrides its deploy twin.
        const deploy = this.getStaticMeta('quickDraw', []);
        const session = this.getOption('quickDraw', [], false);
        const byId = new Map();
        for (const raw of [...(Array.isArray(deploy) ? deploy : []),
                           ...(Array.isArray(session) ? session : [])]) {
            if (raw && typeof raw === 'object' && raw.id != null) {
                byId.set(String(raw.id), raw);
            }
        }
        for (const raw of byId.values()) {
            const def = this._normalizeQuickDrawDef(raw);
            if (def) defs.push(def);
        }
        return defs;
    },

    /** Validate + normalise an operator/session composite entry. */
    _normalizeQuickDrawDef(raw) {
        const action = { side: raw.side === 'right' ? 'right' : 'left' };
        if (typeof raw.factory === 'string') action.factory = raw.factory;
        if (raw.preset !== undefined && raw.preset !== null) action.preset = raw.preset;

        // A stroke that neither sets a shape nor a preset would be a no-op.
        if (!action.factory && action.preset === undefined) {
            console.warn('[annotations] ignoring quick-draw def with no factory or preset:', raw.id);
            return null;
        }

        // Operator-supplied titleKey wins; otherwise derive a sensible default:
        // shape-bearing entries reuse the interpolated shape title, preset-only
        // entries use the generic preset title.
        let titleKey, titleArgs;
        if (typeof raw.titleKey === 'string' && raw.titleKey) {
            titleKey = raw.titleKey;
            titleArgs = (raw.titleArgs && typeof raw.titleArgs === 'object') ? raw.titleArgs : undefined;
        } else if (action.factory) {
            titleKey = 'annotations:keymap.quickDraw.shape';
            titleArgs = { shape: this._shapeName(action.factory) };
        } else {
            titleKey = 'annotations:keymap.quickDraw.preset';
        }

        return {
            id: `custom.${raw.id}`,
            titleKey,
            titleArgs,
            descriptionKey: typeof raw.descriptionKey === 'string' ? raw.descriptionKey : undefined,
            combo: typeof raw.combo === 'string' ? raw.combo : undefined,
            action,
        };
    },

    /**
     * Resolve a preset ref at fire time. Stable id wins; falls back to the Nth
     * preset in insertion order. Returns the Preset instance or null.
     * @param {QuickDrawPresetRef} ref
     */
    _resolvePresetRef(ref) {
        let id, index;
        if (typeof ref === 'number') {
            index = ref;
        } else if (typeof ref === 'string') {
            id = ref;
        } else if (ref && typeof ref === 'object') {
            id = ref.id;
            index = ref.index;
        }

        const presets = this.context.presets;
        if (id != null && presets.exists(id)) return presets.get(id);

        if (Number.isInteger(index) && index >= 0) {
            const ids = Array.from(presets.getExistingIds());
            const targetId = ids[index];
            if (targetId != null) return presets.get(targetId);
        }
        return null;
    },

    /**
     * Perform a quick-draw action: (optionally) select a preset, (optionally)
     * set the shape, then enter the manual `custom` drawing mode. Degrades
     * closed on any missing target.
     * @param {{factory?: string, preset?: QuickDrawPresetRef, side?: "left"|"right"}} action
     */
    _fireQuickDraw(action) {
        if (!this.context || this.context.disabledInteraction) return;
        const isLeft = action.side !== 'right';

        // (a) Preset selection — activate the referenced preset for this side.
        if (action.preset !== undefined) {
            const preset = this._resolvePresetRef(action.preset);
            if (!preset) {
                Dialogs.show(this.t('annotations.quickDraw.presetUnavailable'), 3000, Dialogs.MSG_WARN);
                return;
            }
            this.context.setPreset(preset, isLeft);
        }

        // (b) Shape + manual mode. switchModeActive swaps the active preset's
        // objectFactory to `factory` and enters `custom` — same code path the
        // toolbar shape picker uses.
        if (action.factory) {
            if (!(this._allowedFactories || []).includes(action.factory)) {
                Dialogs.show(this.t('annotations.quickDraw.shapeUnavailable'), 3000, Dialogs.MSG_WARN);
                return;
            }
            this._armQuickDrawAutoReturn();
            this.switchModeActive('custom', action.factory, isLeft);
            return;
        }

        // (c) Preset-only (or bare): just enter manual mode with whatever preset
        // is active. Ensure at least one active preset exists first.
        if (!this.context.getPreset(isLeft) && !this.context.presets.ensureActivePreset(isLeft)) {
            Dialogs.show(this.t('annotations.quickDraw.noPreset'), 3000, Dialogs.MSG_WARN);
            return;
        }
        this._armQuickDrawAutoReturn();
        this.context.setModeById('custom');
    },

    /**
     * Quick-draw is a one-shot gesture: a single key press draws one shape and
     * should then hand the canvas straight back to navigation (AUTO), rather
     * than leaving the user stuck in manual mode. Arm a one-shot return that
     * fires when the drawn shape is committed (`annotation-create`, raised on
     * final promotion — so multi-click polygons return only once completed).
     *
     * The arming is self-cancelling: if the mode leaves `custom` by any other
     * route before a shape is finished (user picks another tool/mode), we
     * disarm without forcing AUTO, so we never fight an explicit user choice.
     */
    _armQuickDrawAutoReturn() {
        // Re-firing quick-draw before finishing the previous shape: drop the
        // stale arming so we never leave a dangling one-shot listener.
        this._disarmQuickDrawAutoReturn?.();

        const onCreate = () => {
            this._disarmQuickDrawAutoReturn?.();
            this.context.setMode(this.context.Modes.AUTO);
        };
        const onModeChanged = (e) => {
            if (e.mode !== this.context.Modes.CUSTOM) this._disarmQuickDrawAutoReturn?.();
        };

        this._disarmQuickDrawAutoReturn = () => {
            this._disarmQuickDrawAutoReturn = null;
            this.context.removeFabricHandler('annotation-create', onCreate);
            this.context.removeHandler('mode-changed', onModeChanged);
        };

        this.context.addFabricHandler('annotation-create', onCreate);
        this.context.addHandler('mode-changed', onModeChanged);
    }
};
