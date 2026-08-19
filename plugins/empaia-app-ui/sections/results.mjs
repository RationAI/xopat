const van = globalThis.van;
const { div, span, button, i, table, thead, tbody, tr, th, td } = van.tags;

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
    { annotationCount, visible, onFocus, onFocusInputs, declaredCount, inputsVisible }) {
    const t = (key, args) => plugin.t(key, args);
    const chip = "badge badge-ghost badge-sm gap-1 font-normal";
    const actionChip = `${chip} cursor-pointer hover:badge-primary`;

    const chips = [];
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
