const van = globalThis.van;
const { div, span, p, h3, button, i } = van.tags;

/**
 * What is selected on the canvas, and the staged run being assembled from it.
 *
 * Two sections rather than one because they answer different questions. The
 * selection is volatile and is the user's *current* gesture; the batch is
 * durable server state and is the *commitment*. Merging them is what made a
 * ticked checkbox look like a staged region when the workbench had never heard
 * of it.
 */

/** Regions currently selected on the slide, with what can be done to them. */
export function createSelectionSection(plugin) {
    const t = (key, args) => plugin.t(key, args);
    const s = plugin.state;

    return () => {
        const selection = s.selection.val;
        if (!selection.length) {
            return div({ class: "flex flex-col gap-1" },
                h3({ class: "font-semibold" }, t("selection.title")),
                p({ class: "text-xs opacity-60" }, t("selection.empty")));
        }

        const usable = selection.filter(r => r.analysable);
        const convertible = selection.filter(r => r.convertible);
        const skipped = selection.filter(r => !r.analysable && !r.convertible);
        const multi = plugin.workbench.getRoiMode() === "multiple";

        return div({ class: "flex flex-col gap-1" },
            div({ class: "flex items-center gap-2" },
                h3({ class: "font-semibold flex-1" }, t("selection.title")),
                span({ class: "badge badge-ghost badge-xs" },
                    t("selection.count", { count: selection.length })),
            ),

            div({ class: "flex flex-col gap-1 max-h-40 overflow-y-auto" },
                ...selection.map(region => selectionRow(plugin, region))),

            div({ class: "flex flex-wrap gap-2" },
                convertible.length
                    ? button({
                        class: "btn btn-sm btn-outline flex-1",
                        onclick: () => plugin.markSelectionAsRoi(convertible),
                    },
                        i({ class: "ph-light ph-selection-foreground mr-1" }),
                        t("roi.useAsRoi", { count: convertible.length }))
                    : null,

                multi
                    ? button({
                        class: "btn btn-sm btn-primary flex-1",
                        disabled: (s.busy.val || !usable.length) ? "disabled" : undefined,
                        // A disabled button with no title was the panel's version
                        // of the menu's silence.
                        title: usable.length ? undefined : t("roi.noneUsable"),
                        onclick: () => plugin.addSelectionToBatch(),
                    },
                        i({ class: "ph-light ph-stack-plus mr-1" }),
                        usable.length && usable.length !== selection.length
                            ? t("roi.addToBatchPartial",
                                { count: usable.length, total: selection.length })
                            : t("roi.addToBatch", { count: usable.length }))
                    : button({
                        class: "btn btn-sm btn-primary flex-1",
                        disabled: (s.busy.val || usable.length !== 1) ? "disabled" : undefined,
                        title: usable.length > 1 ? t("roi.singleOnlyOne")
                            : usable.length ? undefined : t("roi.noneUsable"),
                        onclick: () => plugin.runAnalysis(),
                    },
                        s.busy.val
                            ? span({ class: "loading loading-spinner loading-xs mr-1" })
                            : i({ class: "ph-light ph-play mr-1" }),
                        t("roi.run")),
            ),

            // What the buttons above will not touch. Spelled out rather than left
            // to the arithmetic of "3 selected / Add 2".
            skipped.length
                ? div({ class: "flex items-start gap-1 text-xs text-warning" },
                    i({ class: "ph-light ph-prohibit-inset mt-0.5 shrink-0" }),
                    span(`${t("selection.skipped", { count: skipped.length })} `
                        + plugin.describeRefusals(skipped)))
                : null,
        );
    };
}

/**
 * One selected region.
 *
 * The reason is visible text, not a hover title: a warning triangle the user has
 * to find and hover over is indistinguishable from no explanation at all, which
 * is the complaint this section exists to answer.
 */
function selectionRow(plugin, region) {
    const t = (key, args) => plugin.t(key, args);
    const locked = region.analysable && region.lockedBy !== undefined;

    return div({
        class: "flex flex-col rounded bg-base-200 px-2 py-1 cursor-pointer",
        onclick: () => plugin.focusRegion(region.incrementId),
    },
        div({ class: "flex items-center gap-2" },
            span({ class: "flex-1 truncate" }, region.label),
            region.analysable
                ? i({
                    class: `ph-light ${locked ? "ph-lock-simple opacity-60" : "ph-cloud-check text-success"}`,
                    title: locked ? undefined : t("roi.saved"),
                })
                : i({ class: "ph-light ph-warning-circle text-warning" }),
        ),
        // A locked region IS usable — it just cannot be edited. Saying so is the
        // whole answer to "why can I not add this?", which it turns out you can.
        locked
            ? span({ class: "text-[11px] opacity-60" },
                t("roi.lockedStillUsable", { job: String(region.lockedBy || "").slice(0, 8) }))
            : null,
        !region.analysable && region.reasonKey
            ? span({ class: "text-[11px] text-warning" },
                t(region.reasonKey, { count: 1, job: String(region.lockedBy || "").slice(0, 8) }))
            : null,
    );
}

/**
 * The staged run.
 *
 * Rendered only for an app that collects several regions into one job — a
 * single-ROI app has nothing to stage, and an empty section reading "0 staged"
 * is a question the user never asked.
 */
export function createBatchSection(plugin) {
    const t = (key, args) => plugin.t(key, args);
    const s = plugin.state;

    return () => {
        // Read the mode first so this recomputes when the user switches it.
        void s.mode.val;
        if (plugin.workbench.getRoiMode() !== "multiple") return div();

        const batch = plugin.batch();
        const staged = plugin.batchCount();
        const orphans = plugin.orphanBatches();

        if (!batch && !orphans.length) {
            return div({ class: "flex flex-col gap-1" },
                h3({ class: "font-semibold" }, t("batch.title")),
                p({ class: "text-xs opacity-60" }, t("batch.empty")));
        }

        return div({ class: "flex flex-col gap-1.5" },
            div({ class: "flex items-center gap-2" },
                h3({ class: "font-semibold flex-1" }, t("batch.title")),
                batch
                    ? span({ class: "badge badge-primary badge-xs" },
                        t("batch.staged", { count: staged }))
                    : span(),
            ),

            batch
                ? span({ class: "text-[10px] opacity-40 font-mono break-all select-all" }, batch.jobId)
                : null,

            // Append-only is a backend fact, not a UI choice: there is no route
            // that removes an item from a collection. Saying so once is cheaper
            // than a remove button that has to explain itself per row.
            batch ? p({ class: "text-xs opacity-60" }, t("batch.appendOnly")) : null,

            batch ? stagedRegions(plugin, batch) : null,

            // The permanent-lock warning. A line rather than a confirm dialog:
            // this is a standing property of the action, and a modal on every run
            // is trained away in a week.
            staged
                ? div({ class: "flex items-start gap-1 text-xs text-warning" },
                    i({ class: "ph-light ph-lock-simple mt-0.5 shrink-0" }),
                    span(t("batch.lockWarning")))
                : null,

            batch
                ? div({ class: "flex gap-2" },
                    button({
                        class: "btn btn-sm btn-primary flex-1",
                        disabled: (s.busy.val || !staged) ? "disabled" : undefined,
                        onclick: () => plugin.runBatch(),
                    },
                        s.busy.val
                            ? span({ class: "loading loading-spinner loading-xs mr-1" })
                            : i({ class: "ph-light ph-play mr-1" }),
                        t("roi.runBatch", { count: staged })),
                    button({
                        class: "btn btn-sm btn-ghost",
                        onclick: () => plugin.discardBatch(),
                    }, i({ class: "ph-light ph-trash mr-1" }), t("roi.discardBatch")),
                )
                : null,

            orphans.length
                ? div({ class: "flex items-start gap-1 text-xs text-warning" },
                    i({ class: "ph-light ph-warning-circle mt-0.5 shrink-0" }),
                    span(t("batch.orphans", { count: orphans.length })),
                    button({
                        type: "button",
                        class: "btn btn-ghost btn-xs",
                        onclick: () => plugin.showJobsWindow(),
                    }, t("jobs.openManager")),
                )
                : null,
        );
    };
}

/**
 * The regions already in the collection.
 *
 * Labelled from the region list when the annotation is resident, so a staged
 * region reads the same here as it does everywhere else; a member whose
 * annotation is not on this canvas falls back to its id.
 */
function stagedRegions(plugin, batch) {
    const t = (key, args) => plugin.t(key, args);
    const members = Object.values(batch.collections ?? {}).flatMap(c => c.members ?? []);
    if (!members.length) return null;

    const byEmpaiaId = new Map(
        plugin.state.rois.val.filter(r => r.empaiaId).map(r => [r.empaiaId, r]));

    return div({ class: "flex flex-col gap-1 max-h-40 overflow-y-auto" },
        ...members.map((empaiaId, index) => {
            const row = byEmpaiaId.get(empaiaId);
            return div({
                class: "flex items-center gap-2 rounded bg-base-200 px-2 py-1",
                title: empaiaId,
            },
                span({ class: "opacity-40 text-xs w-5 shrink-0" }, String(index + 1)),
                span({ class: "flex-1 truncate" },
                    row?.label ?? t("results.region.nth", { index: index + 1 })),
                row
                    ? button({
                        type: "button",
                        class: "btn btn-ghost btn-xs px-1",
                        title: t("results.outputs.focusHint"),
                        onclick: () => plugin.focusRegion(row.incrementId),
                    }, i({ class: "ph-light ph-crosshair-simple" }))
                    : span(),
            );
        }));
}
