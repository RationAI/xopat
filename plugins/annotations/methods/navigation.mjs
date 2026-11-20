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

        // Apply the tool swap upfront so both cross-mode and same-mode paths
        // converge through the same update. The shape is the module's active
        // factory - a tool choice, never written into a preset (class).
        if (id === 'custom' && factory) {
            this.context.setActiveFactory(factory);

            // Ensure at least one active preset exists when entering CUSTOM:
            // the canvas only hands a factory to the mode when a class is bound.
            if (!this.context.presets.getActivePreset(isLeftClick)
                && !this.context.presets.getActivePreset(!isLeftClick)) {
                const fallback = this.context.presets.get() || this.context.presets.addPreset();
                if (fallback) this.context.setPreset(fallback, isLeftClick);
            }
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
