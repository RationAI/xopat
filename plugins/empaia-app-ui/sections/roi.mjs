const van = globalThis.van;
const { div, span, p, h3, button, i } = van.tags;

/**
 * How many region rows are ever put in the DOM at once.
 *
 * The list lives in a `max-h-48` scroller that shows about four rows, but an
 * examination can carry tens of thousands of objects on the region preset — a
 * profiled session had 24,692, which is 24,692 rows, ~150k nodes and ~50k
 * listeners for four visible ones. The annotation board solves the same problem
 * by collapsing (`BOARD_PRESET_GROUP_THRESHOLD`); this list is scrolled rather
 * than grouped, so it caps instead and says what it left out. Either way the
 * panel's cost has to be bounded by the viewport, not by the slide.
 */
const ROI_ROW_RENDER_CAP = 200;

/**
 * Regions of interest.
 *
 * Drawing is delegated wholesale to the annotation module: the button switches
 * the active preset + mode and nothing more. This section never creates or edits
 * geometry, and it no longer owns a selection either — what is selected lives on
 * the canvas (see `batch.mjs`), because a tick set only this panel could see is
 * how "select two regions and analyse them" ended up reporting that nothing was
 * selected.
 */
export function createRoiSection(plugin) {
    const s = plugin.state;

    return () => {
        // Everything here is per-mode, so read the mode first to recompute on a
        // switch.
        //
        // The section is always here. It used to disappear whenever the app
        // declared no region input it could use, which is how a user of an app
        // this viewer cannot drive (TA09) was left drawing an ordinary annotation
        // and finding out only at the run button. Regions are storable whatever
        // the app declares — nothing app-specific is written into one — so the
        // affordance stays and the *limit* is what gets stated.
        void s.mode.val;
        void s.incompatibility.val;
        return roiBody(plugin, plugin.workbench.getRoiTypes());
    };
}

function roiBody(plugin, types) {
    const t = (key, args) => plugin.t(key, args);
    const s = plugin.state;

    // One membership set per selection value, shared by every row.
    //
    // Each row still *reads* `s.selection.val` so van registers the dependency,
    // but the set is derived once: `_syncSelection` assigns a fresh array, so
    // identity is a sound cache key. Without this each row ran `.some()` over
    // the whole selection — O(rows x selection) per flush.
    let selSource = null;
    let selIds = null;
    const selectedIds = (selection) => {
        if (selSource !== selection) {
            selSource = selection;
            selIds = new Set(selection.map(r => r.incrementId));
        }
        return selIds;
    };

    // What the button will actually draw, which is a rectangle when the app
    // names nothing usable — the badge has to say that rather than the app's
    // unusable declaration.
    const usable = types.length > 0;
    const drawnType = plugin.workbench.roiTypeForDrawing();

    return div({ class: "flex flex-col gap-1" },
        div({ class: "flex items-center gap-2" },
            h3({ class: "font-semibold flex-1" }, t("roi.title")),
            span({ class: "badge badge-ghost badge-xs" }, t(`roi.type.${drawnType}`)),
        ),

        // The limit, not a refusal: the region is still drawn and still stored,
        // it is this analysis that will not take it.
        usable
            ? p({ class: "text-xs opacity-60" },
                plugin.workbench.getRoiMode() === "multiple" ? t("roi.multiHint") : t("roi.singleHint"))
            : p({ class: "text-xs text-warning" }, t("roi.notAccepted")),

        button({
            class: "btn btn-sm btn-outline",
            onclick: () => plugin.startDrawing(),
        }, i({ class: "ph-light ph-selection-plus mr-1" }), t("roi.createJobRoi")),

        () => {
            const rois = s.rois.val;
            if (!rois.length) return p({ class: "text-xs opacity-60" }, t("roi.empty"));

            const shown = rois.length > ROI_ROW_RENDER_CAP
                ? rois.slice(0, ROI_ROW_RENDER_CAP)
                : rois;
            const hidden = rois.length - shown.length;

            return div({ class: "flex flex-col gap-1 max-h-48 overflow-y-auto" },
                ...shown.map(roi => roiRow(plugin, roi, selectedIds)),
                hidden > 0
                    ? p({ class: "text-xs opacity-60 px-2 py-1" },
                        t("roi.andMore", { count: hidden }))
                    : null,
            );
        },
    );
}

/**
 * One region that exists on this slide.
 *
 * Clicking selects it on the canvas rather than only panning to it: selection is
 * what the analysis acts on, so the list has to be able to build one.
 *
 * The row is built once. Selection is the only thing about it that changes, and
 * it changes only the container's class, so that is the sole reactive binding —
 * van then patches `className` and leaves the node in place. Returning a whole
 * new subtree from a derivation instead made van `replaceWith` every row on
 * every canvas click, and re-run every `t()` in it.
 */
function roiRow(plugin, roi, selectedIds) {
    const t = (key, args) => plugin.t(key, args);
    const s = plugin.state;

    const notSaved = roi.empaiaId ? "" : t("roi.notSaved");

    return div({
        class: () => {
            const selected = selectedIds(s.selection.val).has(roi.incrementId);
            return `flex items-center gap-2 rounded px-2 py-1 cursor-pointer ${
                selected ? "bg-primary/20 ring-1 ring-primary" : "bg-base-200"}`;
        },
        title: roi.empaiaId || notSaved,
        onclick: (e) => plugin.selectRegion(roi.incrementId, { additive: e.ctrlKey || e.shiftKey }),
    },
        span({ class: "flex-1 truncate" }, roi.label),
        button({
            type: "button",
            class: "btn btn-ghost btn-xs px-1",
            title: t("results.outputs.focusHint"),
            onclick: (e) => { e.stopPropagation(); plugin.focusRegion(roi.incrementId); },
        }, i({ class: "ph-light ph-crosshair-simple" })),
        roi.pending
            ? span({ class: "loading loading-spinner loading-xs", title: t("roi.saving") })
            : roi.empaiaId
                ? i({ class: "ph-light ph-cloud-check text-success", title: t("roi.saved") })
                : i({ class: "ph-light ph-cloud-slash text-error", title: roi.error || notSaved }),
    );
}
