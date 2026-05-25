export const navigationMethods = {
    switchModeActive(id, factory = undefined, isLeftClick) {
        const currentId = this.context.mode.getId();
        const sameMode = currentId === id;

        // Apply the factory swap upfront so both cross-mode and same-mode
        // paths converge through the same update. Previously, the cross-mode
        // branch silently no-op'd when no preset existed yet (early-load
        // race), leaving the canvas drawing with the prior factory.
        if (id === 'custom' && factory) {
            let preset = this.context.presets.getActivePreset(isLeftClick);
            const otherPreset = this.context.presets.getActivePreset(!isLeftClick);

            // Ensure at least one active preset exists when entering CUSTOM.
            if (!preset && !otherPreset) {
                const fallback = this.context.presets.get();
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
            // internal state picks up the new factory cleanly.
            if (id === 'custom') {
                this.context.setModeById('auto');
                this.context.setModeById('custom');
            }
            return;
        }

        this.context.setModeById(id);
    }
};
