export const navigationMethods = {
    switchModeActive(id, factory = undefined, isLeftClick) {
        const currentId = this.context.mode.getId();
        const sameMode = currentId === id;

        // Drain any in-flight creation BEFORE the factory swap. Without
        // this, the AUTO-bounce below would call finishIndirect on the
        // NEW factory (a no-op) and leave the previous factory's helpers
        // (e.g. polygon's _initPoint / _followPoint / partial polygon)
        // orphaned on the canvas.
        // Prefer COMMITTING the in-flight shape over discarding it — switching
        // tool / AUTO should save a valid polyline/polygon, not delete it.
        // finishIndirect() drops degenerate shapes (below the min vertex count)
        // and always clears the helper points, so no orphans are left behind;
        // fall back to discardCreate for factories without an indirect finish.
        const inFlightFactory = this.context.mode?._lastUsed;
        if (inFlightFactory?.getCurrentObject?.()) {
            if (typeof inFlightFactory.finishIndirect === 'function') {
                inFlightFactory.finishIndirect();
            } else {
                inFlightFactory.discardCreate?.();
            }
        }
        if (this.context.mode) this.context.mode._lastUsed = null;

        // Apply the factory swap upfront so both cross-mode and same-mode
        // paths converge through the same update. Previously, the cross-mode
        // branch silently no-op'd when no preset existed yet (early-load
        // race), leaving the canvas drawing with the prior factory.
        if (id === 'custom' && factory) {
            let preset = this.context.presets.getActivePreset(isLeftClick);
            const otherPreset = this.context.presets.getActivePreset(!isLeftClick);

            // Ensure at least one active preset exists when entering CUSTOM.
            // If none exists yet, create one bound to the user-picked factory
            // — otherwise the canvas-click lazy fallback in annotations-canvas
            // would create a polygon-bound preset and snap the toolbar back
            // to polygon after the first annotation.
            if (!preset && !otherPreset) {
                let fallback = this.context.presets.get();
                if (!fallback) {
                    const factoryInstance = this.context.getAnnotationObjectFactory(factory);
                    fallback = this.context.presets.addPreset(undefined, '', undefined, factoryInstance);
                }
                if (fallback) {
                    this.context.setPreset(fallback, isLeftClick);
                    preset = fallback;
                }
            }

            if (preset)      this.updatePresetWith(preset.presetID,      'objectFactory', factory);
            if (otherPreset) this.updatePresetWith(otherPreset.presetID, 'objectFactory', factory);
        }

        if (sameMode) {
            // Same-mode click on CUSTOM: bounce through AUTO so the mode's
            // internal state picks up the new factory cleanly. The OLD
            // factory's helpers were already discarded above, so this
            // transition is safe.
            if (id === 'custom') {
                this.context.setModeById('auto');
                this.context.setModeById('custom');
            }
            return;
        }

        this.context.setModeById(id);
    }
};
