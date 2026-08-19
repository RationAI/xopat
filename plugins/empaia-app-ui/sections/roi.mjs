const van = globalThis.van;
const { div, span, p, h3, button, i, input } = van.tags;

/**
 * Regions of interest.
 *
 * Drawing is delegated wholesale to the annotation module: the button switches
 * the active preset + mode and nothing more. Rows here mirror annotations that
 * already exist on the canvas — this section never creates or edits geometry.
 */
export function createRoiSection(plugin) {
    const t = (key, args) => plugin.t(key, args);
    const s = plugin.state;

    return div({ class: "flex flex-col gap-1" },
        div({ class: "flex items-center gap-2" },
            h3({ class: "font-semibold flex-1" }, t("roi.title")),
            () => {
                // The declared ROI type is derived from the EAD *and the active
                // mode*, so read the mode state to make this recompute on switch.
                void s.mode.val;
                const types = plugin.workbench.getRoiTypes();
                return types.length
                    ? span({ class: "badge badge-ghost badge-xs" },
                        t(`roi.type.${types[0]}`))
                    : span();
            },
        ),

        () => {
            void s.mode.val;
            return p({ class: "text-xs opacity-60" },
                plugin.workbench.getRoiMode() === "multiple" ? t("roi.multiHint") : t("roi.singleHint"));
        },

        div({ class: "flex gap-2" },
            button({
                class: "btn btn-sm btn-outline flex-1",
                onclick: () => plugin.startDrawing(),
            }, i({ class: "ph-light ph-selection-plus mr-1" }), t("roi.draw")),

            () => button({
                class: "btn btn-sm btn-primary flex-1",
                disabled: (s.busy.val || !s.selectedRoiIds.val.length) ? "disabled" : undefined,
                onclick: () => plugin.runAnalysis(),
            },
                s.busy.val
                    ? span({ class: "loading loading-spinner loading-xs mr-1" })
                    : i({ class: "ph-light ph-play mr-1" }),
                t("roi.run")),
        ),

        () => {
            const rois = s.rois.val;
            if (!rois.length) return p({ class: "text-xs opacity-60" }, t("roi.empty"));
            return div({ class: "flex flex-col gap-1 max-h-48 overflow-y-auto" },
                ...rois.map(roi => roiRow(plugin, roi)));
        },
    );
}

function roiRow(plugin, roi) {
    const t = (key, args) => plugin.t(key, args);
    const s = plugin.state;

    return () => {
        const selected = s.selectedRoiIds.val.includes(roi.incrementId);
        return div({ class: "flex items-center gap-2 rounded bg-base-200 px-2 py-1" },
            input({
                type: "checkbox",
                class: "checkbox checkbox-xs",
                checked: selected ? "checked" : undefined,
                onchange: () => plugin.toggleRoiSelection(roi.incrementId),
            }),
            span({
                class: "flex-1 truncate cursor-pointer",
                title: roi.empaiaId || t("roi.notSaved"),
                onclick: () => plugin.focusRoi(roi.incrementId),
            }, roi.label),
            roi.pending
                ? span({ class: "loading loading-spinner loading-xs", title: t("roi.saving") })
                : roi.empaiaId
                    ? i({ class: "ph-light ph-cloud-check text-success", title: t("roi.saved") })
                    : i({ class: "ph-light ph-cloud-slash text-error", title: roi.error || t("roi.notSaved") }),
        );
    };
}
