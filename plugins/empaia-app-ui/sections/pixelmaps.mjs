const van = globalThis.van;
const { div, span, p, h3, select, option, input, label, i } = van.tags;

/** Colour maps offered for continuous / discrete pixel maps. Mirrors `colormaps.ts`. */
const COLOR_MAPS = ["viridis", "magma", "inferno", "jet", "hot", "cool", "grayscale", "redblue"];

/**
 * Pixel-map overlays produced by one analysis.
 *
 * The layers themselves are ordinary xOpat shader layers, so *opacity* and
 * layer order stay in the shader panel where every other layer is controlled.
 * Visibility, however, follows the analysis: a map is painted when the run that
 * produced it is shown, which is why there is no per-map eye here.
 *
 * What belongs here is what only a pixel map has: which channel to read, and
 * how to colour it — nominal maps get their colours from the app description
 * and are shown as a legend instead.
 */
export function createPixelmapsSection(plugin, pixelmaps) {
    const t = (key, args) => plugin.t(key, args);
    if (!pixelmaps?.length) return div();

    return div({ class: "flex flex-col gap-1" },
        h3({ class: "font-semibold text-xs" }, t("pixelmaps.title")),
        p({ class: "text-xs opacity-60" }, t("pixelmaps.hint")),
        ...pixelmaps.map(pixelmap => pixelmapCard(plugin, pixelmap)),
    );
}

function pixelmapCard(plugin, pixelmap) {
    const t = (key, args) => plugin.t(key, args);
    const id = String(pixelmap.id);
    const nominal = pixelmap.type === "nominal_pixelmap";

    return div({ class: "rounded bg-base-200 p-2 flex flex-col gap-1" },
        div({ class: "flex items-center gap-2" },
            i({ class: "ph-light ph-grid-nine" }),
            span({ class: "flex-1 truncate", title: pixelmap.description || id }, pixelmap.name || id),
            span({ class: "badge badge-ghost badge-xs" }, t(`pixelmaps.type.${pixelmap.type}`)),
        ),

        pixelmap.channel_count > 1
            ? labelled(t("pixelmaps.channel"), select({
                class: "select select-bordered select-xs flex-1",
                onchange: (e) => plugin.setPixelmapChannel(id, e.target.value),
            }, ...channelOptions(pixelmap)))
            : span(),

        nominal ? legend(plugin, id) : colorMapControls(plugin, id),
    );

    function channelOptions(map) {
        const names = new Map((map.channel_class_mapping ?? [])
            .map(entry => [entry.number_value, entry.class_value]));
        return Array.from({ length: map.channel_count }, (_, index) =>
            option({ value: String(index) }, names.get(index) ?? t("pixelmaps.channelN", { index })));
    }
}

function colorMapControls(plugin, pixelmapId) {
    const t = (key, args) => plugin.t(key, args);
    return div({ class: "flex flex-col gap-1" },
        labelled(t("pixelmaps.colorMap"), select({
            class: "select select-bordered select-xs flex-1",
            onchange: (e) => plugin.setPixelmapColorMap(pixelmapId, e.target.value),
        }, ...COLOR_MAPS.map(name => option({ value: name }, t(`pixelmaps.colorMaps.${name}`))))),

        label({ class: "flex items-center gap-2 cursor-pointer" },
            input({
                type: "checkbox",
                class: "checkbox checkbox-xs",
                onchange: (e) => plugin.setPixelmapInverted(pixelmapId, e.target.checked),
            }),
            span({ class: "text-xs" }, t("pixelmaps.invert")),
        ),
    );
}

function legend(plugin, pixelmapId) {
    const t = (key, args) => plugin.t(key, args);
    return () => {
        const source = plugin.workbench.getPixelmapSource(pixelmapId);
        const entries = source?.getLegend?.() ?? [];
        if (!entries.length) return span({ class: "text-xs opacity-60" }, t("pixelmaps.noLegend"));

        return div({ class: "flex flex-wrap gap-2" }, ...entries.map(entry =>
            div({ class: "flex items-center gap-1" },
                span({
                    class: "inline-block w-3 h-3 rounded-sm border border-base-300",
                    // A colour swatch is the one place a computed style is the
                    // content; the value comes from our own LUT, never from input.
                    style: `background: rgb(${entry.color[0]}, ${entry.color[1]}, ${entry.color[2]})`,
                }),
                span({ class: "text-xs truncate", title: entry.classValue }, entry.classValue),
            )));
    };
}

function labelled(text, control) {
    return div({ class: "flex items-center gap-2" },
        span({ class: "text-xs opacity-60 shrink-0" }, text),
        control,
    );
}
