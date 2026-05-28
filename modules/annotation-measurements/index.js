(function (global) {
    'use strict';

    // Module entry. Exposes a singleton MeasurementEngine via XOpatModuleSingleton
    // so plugins / scripting consumers can reach it through `singletonModule(id)`.
    class AnnotationMeasurementsModule extends XOpatModuleSingleton {
        constructor() {
            super();
        }

        /**
         * Lazy: created on first use because module load order may precede
         * OSDAnnotations.instance() being available.
         */
        getEngine() {
            if (!this._engine) {
                this._engine = new global.AnnotationMeasurements.MeasurementEngine({});
            }
            return this._engine;
        }

        /**
         * Resets the cached engine so it picks up a freshly-bound annotations
         * singleton on the next access. Mostly useful for tests.
         */
        resetEngine() {
            this._engine = null;
        }
    }

    addModule('annotation-measurements', AnnotationMeasurementsModule);

    // Convenience: also expose the namespace on globalThis so non-module code
    // (the annotations plugin, scripting tools) can reach the helpers without
    // having to resolve the module first.
    global.AnnotationMeasurements = global.AnnotationMeasurements || {};
    global.AnnotationMeasurements.Module = AnnotationMeasurementsModule;
})(typeof window !== 'undefined' ? window : globalThis);
