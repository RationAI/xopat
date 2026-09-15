/**
 * "Draw and analyse" annotation mode.
 *
 * Drawing a region and submitting it are two separate gestures in two separate
 * surfaces (canvas, then the panel behind the plugins menu). For the common case
 * — one region, analyse it now — this mode collapses them: the region is drawn
 * exactly as with the manual tool, and the plugin submits it as soon as the
 * workbench hands back a server id.
 *
 * It extends the built-in manual-create state rather than reimplementing an
 * `AnnotationState`: drawing behaviour, undo, snapping and the discard semantics
 * must stay identical to the normal tool — only entering and leaving the mode
 * differ. The submission itself deliberately lives in the plugin's
 * `annotation-create` handler, which already awaits persistence; the mode only
 * declares *that* it is the quick one, so ordinary drawing never auto-submits.
 *
 * Registration follows the pattern the SAM plugin uses: the annotations toolbar
 * discovers custom modes through `custom-mode-added`, so no toolbar code is
 * needed here.
 */

/** Mode id — the plugin compares against it to decide whether to auto-submit. */
export const QUICK_ROI_MODE_ID = "empaia-quick-roi";

/** Key in `OSDAnnotations.Modes` (distinct from the mode's own id). */
const MODE_REGISTRY_KEY = "EMPAIA_QUICK_ROI";

/**
 * Register the mode once, if the annotations module is present.
 * @param {object} plugin the empaia-app-ui plugin instance
 */
export function registerQuickRoiMode(plugin) {
    const annotations = plugin.workbench.getAnnotations();
    const base = globalThis.OSDAnnotations;
    if (!annotations || !base?.StateCustomCreate) return undefined;
    if (annotations.Modes?.[MODE_REGISTRY_KEY]) return annotations.Modes[MODE_REGISTRY_KEY];

    class EmpaiaQuickRoiState extends base.StateCustomCreate {
        constructor(context) {
            super(context);
            this._id = QUICK_ROI_MODE_ID;
            this.icon = "ph-lightning";
            this.description = plugin.t("roi.quickModeName");
        }

        /**
         * Refuse rather than mislead. The mode promises "one region, one
         * analysis", which only holds when the session is up and the app takes a
         * single region per job — an app that collects several would otherwise
         * get a stream of one-item collections nobody asked for.
         */
        setFromAuto() {
            const reason = this._refusalReason();
            if (reason) {
                Dialogs.show(reason, 6000, Dialogs.MSG_WARN);
                return false;
            }
            // Preset only — `activateRoiTool` would switch to CUSTOM and so
            // switch this mode straight back off.
            plugin.workbench.selectRoiPreset();
            return super.setFromAuto();
        }

        _refusalReason() {
            // The RUN verdict, not the draw one: this mode submits a job on
            // release, so it must refuse everything a run would — plus its own
            // clause, since "draw one region, get one analysis" does not survive
            // an app that collects several.
            return plugin.runRefusal({ singleOnly: true });
        }
    }

    annotations.setCustomModeUsed(MODE_REGISTRY_KEY, EmpaiaQuickRoiState);
    return annotations.Modes[MODE_REGISTRY_KEY];
}
