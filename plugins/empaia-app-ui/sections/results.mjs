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
    { annotationCount, visible, onFocus, onFocusInputs, declaredCount, inputsVisible, onLoadAnyway,
        awaiting, validating, onRetry }) {
    const t = (key, args) => plugin.t(key, args);
    const chip = "badge badge-ghost badge-sm gap-1 font-normal";
    const actionChip = `${chip} cursor-pointer hover:badge-primary`;

    const chips = [];
    // "The output has not appeared yet" is neither a failure nor a result, and
    // it explains the whole pane — so it leads. The alternative, which shipped,
    // was a confident "my_cells: 0" about a run that had in fact written 24 690
    // points the workbench was not yet serving.
    if (validating) {
        chips.push(span({ class: `${chip} badge-info`, title: t("results.outputs.validatingHint") },
            i({ class: "ph-light ph-hourglass-medium" }),
            t("results.outputs.validating")));
    } else if (awaiting) {
        chips.push(button({
            type: "button",
            class: `${actionChip} badge-info`,
            title: t("results.outputs.pendingHint"),
            onclick: () => onRetry?.(),
        },
            span({ class: "loading loading-spinner loading-xs" }),
            t("results.outputs.pending")));
    }
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
        // `missing` with no count is "we asked and got nothing back". Whether
        // that is a fact or a race is exactly what `awaiting` answers — and
        // rendering it as a count of zero asserted the fact either way.
        const text = output.annotationCount !== undefined
            ? t("results.outputs.namedCount", { name: label, count: output.annotationCount })
            : output.kind === "annotation" && output.missing
                ? t(awaiting ? "results.outputs.namedPending" : "results.outputs.namedNone",
                    { name: label })
                : String(label);
        chips.push(span({ class: chip, title: output.spec?.description },
            i({ class: output.kind === "class" ? "ph-light ph-tag" : "ph-light ph-shapes" }),
            text));
    }
    // A completed analysis that names outputs none of which came back is a
    // failure the user has to see — silence there reads as "produced nothing".
    //
    // The claim needs `outputs.outputs` to exist: that array IS the resolved
    // declaration. On the fallback path (no job record, so nothing resolved) it
    // is absent, and asserting "none could be read back" there blames the
    // workbench for a read this side never attempted.
    const promised = outputs.outputs ? (declaredCount ?? 0) : 0;
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

/**
 * Values an analysis produced about individual annotations.
 *
 * TA04 and TA10 are the shape: one confidence per detected object. Those do not
 * belong in the scalar table — a row reading "confidence score 0.9" ten times
 * names neither the object it describes nor anything the reader can act on —
 * and they do not belong *only* on the annotation label either, because a label
 * cannot be scanned, compared or navigated.
 *
 * So: the summary is always shown, and it leads. It is one line per value name
 * and it answers the questions a list is usually skimmed for — how many, what
 * range, are they all the same. The per-object rows come after, each focusing
 * its annotation on click.
 *
 * **Above the cap nothing is listed.** A real detector produces one value per
 * nucleus; rendering fifty thousand rows is not a long list, it is a dead tab,
 * and a *truncated* list is worse than none because it answers "what is the
 * range?" with whatever sorted first. The summary already covers the whole set.
 *
 * @param plugin the app-ui plugin (for `t` and the value cap)
 * @param results the resolved `JobResults`
 * @param onFocus called with one EMPAIA annotation id
 * @param canFocus false while the analysis is hidden — there is nothing to go to
 */
export function createAnnotationValuesSection(plugin, results, { onFocus, canFocus } = {}) {
    const t = (key, args) => plugin.t(key, args);
    const { rows, summary, total, truncated } =
        plugin.summarizeAnnotationValues(results?.primitives);
    if (!total) return undefined;

    const objects = new Set(rows.map(row => row.annotationId)).size;

    return div({ class: "flex flex-col gap-1" },
        div({ class: "flex items-baseline gap-2" },
            h3({ class: "text-xs font-semibold opacity-70" }, t("results.perAnnotation.header")),
            span({ class: "text-[10px] opacity-50" },
                truncated
                    ? t("results.outputs.primitives", { count: total })
                    : t("results.perAnnotation.count", { count: total, objects })),
        ),
        div({ class: "flex flex-col gap-0.5" }, ...summary.map(summaryRow)),
        truncated
            ? span({ class: "text-xs opacity-60" }, t("results.perAnnotation.tooMany", { count: total }))
            : div({ class: "overflow-x-auto max-h-64 overflow-y-auto" },
                table({ class: "table table-xs" },
                    thead(tr(th(t("results.name")), th(t("results.value")))),
                    tbody(...rows.map(valueRow)),
                )),
    );

    /** One line per value name: the whole set reduced to something scannable. */
    function summaryRow(entry) {
        const detail = entry.uniform
            ? t("results.perAnnotation.uniform", { count: entry.count })
            : entry.tally
                ? entry.tally.slice(0, 4)
                    .map(x => t("results.perAnnotation.tallyEntry", { value: x.value, count: x.count }))
                    .join(" · ")
                : t("results.perAnnotation.range", {
                    min: num(entry.min), max: num(entry.max), mean: num(entry.mean),
                });
        return div({ class: "flex items-baseline gap-2 text-xs" },
            span({ class: "opacity-70 truncate" }, entry.name),
            span({ class: "font-mono opacity-90" }, detail),
        );
    }

    function valueRow(row) {
        // The row is only a button when the annotation is actually on the slide.
        const focusable = canFocus !== false;
        return tr({
            class: focusable ? "cursor-pointer hover" : undefined,
            title: focusable
                ? t("results.perAnnotation.focusHint")
                : t("results.perAnnotation.hidden"),
            onclick: focusable ? () => onFocus?.(row.annotationId) : undefined,
        },
            td({ class: "truncate", title: row.description || row.name }, row.name),
            td({ class: "font-mono" }, format(row.value)),
        );
    }

    function format(value) {
        if (typeof value === "boolean") return value ? t("results.true") : t("results.false");
        if (typeof value === "number") return num(value);
        return String(value ?? "");
    }

    function num(value) {
        if (typeof value !== "number" || !Number.isFinite(value)) return "—";
        return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
    }
}
