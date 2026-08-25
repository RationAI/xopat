const van = globalThis.van;
const { div, span, button, i, h3, table, thead, tbody, tr, th, td } = van.tags;

/**
 * Values an analysis produced for each region it was given.
 *
 * The reading an app like Tutorial App 02 exists to deliver: not "44, 12, 7"
 * but *which rectangle* had 44 tumour cells in it. The scalar table below cannot
 * express that — its rows are named values, and a collection's items carry no
 * name, so they arrived as a column of blanks.
 *
 * Returns undefined when the analysis declared no per-item output, so a
 * single-region app's detail pane is exactly as it was.
 *
 * @param results the resolved `JobResults` (needs `inputCollections` + `outputs`)
 * @param onFocusRegion called with the region's EMPAIA id
 */
export function createRegionResultsSection(plugin, results, { onFocusRegion } = {}) {
    const t = (key, args) => plugin.t(key, args);
    const { columns, rows } = plugin.regionResults(results);
    if (!columns.length || !rows.length) return undefined;

    return div({ class: "flex flex-col gap-1" },
        h3({ class: "text-xs font-semibold opacity-70" }, t("results.region.header")),
        div({ class: "overflow-x-auto max-h-64 overflow-y-auto" },
            table({ class: "table table-xs" },
                thead(tr(
                    th(t("results.region.header")),
                    ...columns.map(column => th({ title: column.description }, column.label)),
                )),
                tbody(...rows.map(row => regionRow(row))),
            )),
    );

    function regionRow(row) {
        return tr({ class: "cursor-pointer hover", onclick: () => onFocusRegion?.(row.regionId) },
            td({ class: "truncate", title: row.regionId },
                row.label ?? t("results.region.nth", { index: row.index })),
            ...columns.map(column => td({ class: "font-mono" },
                column.key in row.values ? formatCell(row.values[column.key]) : "—")),
        );
    }

    function formatCell(value) {
        if (typeof value === "boolean") return value ? t("results.true") : t("results.false");
        if (typeof value === "number") {
            return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
        }
        return String(value ?? "");
    }
}

/**
 * Scalar results of one analysis.
 *
 * Annotation results are not listed here — they are imported into the
 * annotation module and shown on the slide, where the board, filters and
 * measurements already handle them. This section covers what has nowhere else
 * to go: primitives (integer / float / bool / string).
 *
 * Scoped to a single job on purpose. Merged across every shown analysis, as it
 * used to be, a value could not be attributed to the run that produced it —
 * which is exactly the question a second opinion is being asked.
 */
export function createResultsSection(plugin, primitives) {
    const t = (key, args) => plugin.t(key, args);

    // No empty state: the chip row above already says an analysis produced no
    // values, and a heading plus a sentence saying so is two lines earning none.
    if (!primitives?.length) return undefined;

    return div({ class: "overflow-x-auto max-h-64 overflow-y-auto" },
        table({ class: "table table-xs" },
            thead(tr(
                th(t("results.name")),
                th(t("results.value")),
            )),
            tbody(...primitives.map(primitiveRow)),
        ));

    function primitiveRow(primitive) {
        return tr(
            td({ class: "truncate", title: primitive.description || primitive.name },
                primitive.name || "—"),
            td({ class: "font-mono" }, formatValue(primitive)),
        );
    }

    function formatValue(primitive) {
        const value = primitive.value;
        if (typeof value === "boolean") return value ? t("results.true") : t("results.false");
        if (typeof value === "number") {
            // Floats get a readable precision; integers stay exact.
            return primitive.type === "float" ? String(Number(value.toFixed(4))) : String(value);
        }
        return String(value ?? "");
    }
}

/**
 * What an analysis produced, as one row of chips.
 *
 * Chips rather than stacked lines: three of the four things worth knowing about
 * a run are a single number each, and giving each its own paragraph is what made
 * the detail pane mostly whitespace.
 *
 * The annotations chip is a *button* whenever that output is on the slide — the
 * count is the natural place to ask "where is it?", and framing the result is
 * the one navigation step the window otherwise cannot offer. It stays a plain
 * chip while the analysis is hidden: there would be nothing on screen to go to.
 */
export function outputChips(plugin, outputs,
    { annotationCount, visible, onFocus, onFocusInputs, declaredCount, inputsVisible, onLoadAnyway }) {
    const t = (key, args) => plugin.t(key, args);
    const chip = "badge badge-ghost badge-sm gap-1 font-normal";
    const actionChip = `${chip} cursor-pointer hover:badge-primary`;

    const chips = [];
    // A query that failed is NOT an analysis that produced nothing, and saying
    // the latter is how a transient 4xx read as a finished, empty run. The retry
    // is the same button the size gate uses.
    if (outputs.failed?.length) {
        chips.push(button({
            type: "button",
            class: `${actionChip} badge-error`,
            title: t("results.outputs.unreadableHint", { queries: outputs.failed.join(", ") }),
            onclick: () => onLoadAnyway?.(),
        },
            i({ class: "ph-light ph-warning-octagon" }),
            t("results.outputs.unreadable")));
    }
    // Counted, deliberately not fetched. Saying the size and offering the choice
    // beats a multi-megabyte response the user never asked for — and beats the
    // timeout it used to become, which read as "this analysis produced nothing".
    if (outputs.annotationsWithheld) {
        chips.push(button({
            type: "button",
            class: `${actionChip} badge-warning`,
            title: t("results.outputs.largeHint"),
            onclick: () => onLoadAnyway?.(),
        },
            i({ class: "ph-light ph-warning-circle" }),
            t("results.outputs.large", { count: outputs.annotationCount ?? 0 })));
    }
    if (annotationCount) {
        const label = [
            i({ class: "ph-light ph-shapes" }),
            t("results.outputs.annotations", { count: annotationCount }),
        ];
        chips.push(visible
            ? button({
                type: "button",
                class: actionChip,
                title: t("results.outputs.focusHint"),
                onclick: () => onFocus(),
            }, ...label, i({ class: "ph-light ph-crosshair-simple opacity-60" }))
            : span({ class: chip, title: t("results.outputs.focusHidden") }, ...label));
    }
    if (outputs.pixelmaps?.length) {
        chips.push(span({ class: chip },
            i({ class: "ph-light ph-grid-nine" }),
            t("results.outputs.pixelmaps", { count: outputs.pixelmaps.length })));
    }
    if (outputs.primitives?.length) {
        chips.push(span({ class: chip },
            i({ class: "ph-light ph-hash" }),
            t("results.outputs.primitives", { count: outputs.primitives.length })));
    }
    // Outputs the app declared that have no table of their own — shapes and class
    // labels, which live on the slide. Named rather than tabulated: asking the
    // collection route for a `value` they do not have is what produced a column of
    // blank cells and one wasted request per output per job.
    for (const output of outputs.outputs ?? []) {
        if (output.kind !== "annotation" && output.kind !== "class") continue;
        const label = output.spec?.name ?? output.spec?.key;
        chips.push(span({ class: chip, title: output.spec?.description },
            i({ class: output.kind === "class" ? "ph-light ph-tag" : "ph-light ph-shapes" }),
            output.annotationCount !== undefined
                ? t("results.outputs.namedCount", { name: label, count: output.annotationCount })
                : String(label)));
    }
    // A completed analysis that names outputs none of which came back is a
    // failure the user has to see — silence there reads as "produced nothing".
    const promised = declaredCount ?? 0;
    const delivered = (outputs.primitives?.length ?? 0)
        + (outputs.pixelmaps?.length ?? 0) + (annotationCount ?? 0);
    if (!chips.length) {
        chips.push(promised && !delivered
            ? span({ class: "text-xs text-warning" }, t("results.outputs.unresolved", { count: promised }))
            : span({ class: "text-xs opacity-60" }, t("results.outputs.none")));
    }

    // The regions the analysis consumed. Shown last, and visually apart from
    // what it produced: they are the user's own work, they are not governed by
    // the eye, and this is the one place that explains why they are locked.
    const inputs = outputs.lockedInputs ?? [];
    if (inputs.length) {
        const label = [
            i({ class: "ph-light ph-selection" }),
            t("results.inputs.regions", { count: inputs.length }),
        ];
        // Those regions are on the slide only while this analysis is shown —
        // they follow its eye. Offering "go to" while they are hidden would pan
        // the view to nothing.
        chips.push(inputsVisible
            ? button({
                type: "button",
                class: `${actionChip} badge-outline`,
                title: t("results.inputs.focusHint"),
                onclick: () => onFocusInputs?.(inputs.map(input => input.id)),
            }, ...label, i({ class: "ph-light ph-crosshair-simple opacity-60" }))
            : span({ class: `${chip} badge-outline`, title: t("results.inputs.hidden") }, ...label));
    }

    return div({ class: "flex flex-wrap items-center gap-1" }, ...chips);
}
