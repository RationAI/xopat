const van = globalThis.van;
const { div, span, p, h3, button, i } = van.tags;

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
        // switch. A mode that asks for no regions — preprocessing, or an app this
        // viewer cannot drive — gets no drawing affordance at all: a "Draw region"
        // button that silently does nothing is worse than no button.
        void s.mode.val;
        const types = plugin.workbench.getRoiTypes();
        if (!types.length) return div();
        return roiBody(plugin, types);
    };
}

function roiBody(plugin, types) {
    const t = (key, args) => plugin.t(key, args);
    const s = plugin.state;

    return div({ class: "flex flex-col gap-1" },
        div({ class: "flex items-center gap-2" },
            h3({ class: "font-semibold flex-1" }, t("roi.title")),
            span({ class: "badge badge-ghost badge-xs" }, t(`roi.type.${types[0]}`)),
        ),

        p({ class: "text-xs opacity-60" },
            plugin.workbench.getRoiMode() === "multiple" ? t("roi.multiHint") : t("roi.singleHint")),

        button({
            class: "btn btn-sm btn-outline",
            onclick: () => plugin.startDrawing(),
        }, i({ class: "ph-light ph-selection-plus mr-1" }), t("roi.draw")),

        () => {
            const rois = s.rois.val;
            if (!rois.length) return p({ class: "text-xs opacity-60" }, t("roi.empty"));
            return div({ class: "flex flex-col gap-1 max-h-48 overflow-y-auto" },
                ...rois.map(roi => roiRow(plugin, roi)));
        },
    );
}

/**
 * One region that exists on this slide.
 *
 * Clicking selects it on the canvas rather than only panning to it: selection is
 * what the analysis acts on, so the list has to be able to build one.
 */
function roiRow(plugin, roi) {
    const t = (key, args) => plugin.t(key, args);
    const s = plugin.state;

    return () => {
        const selected = s.selection.val.some(r => r.incrementId === roi.incrementId);
        return div({
            class: `flex items-center gap-2 rounded px-2 py-1 cursor-pointer ${
                selected ? "bg-primary/20 ring-1 ring-primary" : "bg-base-200"}`,
            title: roi.empaiaId || t("roi.notSaved"),
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
                    : i({ class: "ph-light ph-cloud-slash text-error", title: roi.error || t("roi.notSaved") }),
        );
    };
}
