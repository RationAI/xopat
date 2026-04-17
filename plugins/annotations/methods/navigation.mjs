export const navigationMethods = {
    switchModeActive(id, factory = undefined, isLeftClick) {
        const currentId = this.context.mode.getId();
        if (currentId === id) {
            if (id === 'custom') {
                const preset = this.context.presets.getActivePreset(isLeftClick);
                const otherPreset = this.context.presets.getActivePreset(!isLeftClick);
                if (!preset && !otherPreset) return;

                this.context.setModeById('auto');
                if (preset) this.updatePresetWith(preset.presetID, 'objectFactory', factory);
                if (otherPreset) this.updatePresetWith(otherPreset.presetID, 'objectFactory', factory);
                this.context.setModeById('custom');
            }
            return;
        }

        if (id === 'custom' && factory) {
            const preset = this.context.presets.getActivePreset(isLeftClick);
            const otherPreset = this.context.presets.getActivePreset(!isLeftClick);
            if (preset || otherPreset) {
                if (preset) this.updatePresetWith(preset.presetID, 'objectFactory', factory);
                if (otherPreset) this.updatePresetWith(otherPreset.presetID, 'objectFactory', factory);
            }
        }

        this.context.setModeById(id);
    }
};
