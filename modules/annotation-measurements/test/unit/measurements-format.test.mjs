/**
 * `ui/format.js` is the single source of every string the measurements panel and
 * the popover show. It used to be two hand-rolled row builders that drifted: the
 * popover printed `mean.toFixed(2)` while the table printed `toFixed(1)`, and a
 * missing metric was an em-dash in one place and an empty cell in the other.
 *
 * These are pure functions with an injected translator, so they pin the contract
 * with no browser, no engine and no slide.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
await import("../../ui/format.js");

const fmt = globalThis.AnnotationMeasurements.ui.format;
const EMPTY = fmt.EMPTY;

/** Identity translator: the key comes back, so assertions read as key names. */
const t = (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

/** Minimal stand-ins — only the surface `format` actually touches. */
function makeAnnotations(presets = {}) {
    return {
        presets: {
            get: (id) => presets[id] || undefined,
        },
    };
}

function makeEngine({ geometric = {}, cached = null } = {}) {
    return {
        getGeometric: (_viewer, object) => geometric[object?.incrementId] ?? {},
        getCached: () => cached,
    };
}

test("presetName falls back category -> factory title -> id -> noPreset", () => {
    const annotations = makeAnnotations({
        1: { getMetaValue: () => "Tumor" },
        2: { getMetaValue: () => "", objectFactory: { title: () => "Polygon" } },
        3: { getMetaValue: () => "" },
    });
    expect(fmt.presetName(annotations, 1, t)).toBe("Tumor");
    expect(fmt.presetName(annotations, 2, t)).toBe("Polygon");
    // Preset exists but names itself nothing: the id is still a better handle
    // than a generic word, because it matches what the canvas shows.
    expect(fmt.presetName(annotations, 3, t)).toBe("3");
    // No preset at all — the only case that is genuinely "unclassified".
    expect(fmt.presetName(annotations, null, t)).toBe("noPreset");
});

test("annotationLabel pairs the class with the increment id", () => {
    const annotations = makeAnnotations({ 7: { getMetaValue: () => "Stroma" } });
    expect(fmt.annotationLabel(annotations, { presetID: 7, incrementId: 12 }, t))
        .toBe("Stroma #12");
    expect(fmt.annotationLabel(annotations, { presetID: 7 }, t)).toBe("Stroma #?");
});

test("statRows always yields geometry and marks unsampled pixel metrics as not computed", () => {
    const object = { incrementId: 1 };
    const engine = makeEngine({ geometric: { 1: { areaLabel: "1.42 mm²" } } });
    const rows = fmt.statRows(engine, null, object, {}, t);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

    expect(byKey.area.value).toBe("1.42 mm²");
    expect(byKey.area.computed).toBe(true);
    // No perimeter row at all when the factory reports no length — an empty row
    // is worse than an absent one.
    expect(byKey.length).toBe(undefined);

    for (const key of ["mean", "percentPositive", "components", "density"]) {
        expect(byKey[key].value).toBe(EMPTY);
        expect(byKey[key].computed).toBe(false);
    }
});

test("statRows formats cached pixel metrics", () => {
    const object = { incrementId: 1 };
    const engine = makeEngine({
        geometric: { 1: { areaLabel: "1.42 mm²", lengthLabel: "4.8 mm" } },
        cached: { mean: 137.26, percentPositive: 0.4237, components: { count: 88, densityPerMm2: 61.95 } },
    });
    const byKey = Object.fromEntries(fmt.statRows(engine, null, object, {}, t).map((r) => [r.key, r]));

    expect(byKey.length.value).toBe("4.8 mm");
    expect(byKey.mean.value).toBe("137.3");
    expect(byKey.percentPositive.value).toBe("42.4%");
    expect(byKey.components.value).toBe("88");
    expect(byKey.density.value).toBe("62.0 /mm²");
    expect(byKey.density.computed).toBe(true);
});

test("a zero component count is a result, not a missing value", () => {
    const object = { incrementId: 1 };
    const engine = makeEngine({ geometric: { 1: {} }, cached: { components: { count: 0 } } });
    const byKey = Object.fromEntries(fmt.statRows(engine, null, object, {}, t).map((r) => [r.key, r]));
    expect(byKey.components.value).toBe("0");
    expect(byKey.components.computed).toBe(true);
});

test("aggregateStats sums areas and formats through the viewer converter", () => {
    globalThis.AnnotationMeasurements.geometry = {
        unitConverter: () => ({ formatArea: (px) => `${px} px²` }),
    };
    const engine = makeEngine({
        geometric: { 1: { areaImagePx: 100 }, 2: { areaImagePx: 300 } },
    });
    const agg = fmt.aggregateStats(engine, null, [{ incrementId: 1 }, { incrementId: 2 }]);
    expect(agg.count).toBe(2);
    expect(agg.totalAreaLabel).toBe("400 px²");
    expect(agg.meanAreaLabel).toBe("200 px²");
});

test("aggregateStats degrades to EMPTY rather than printing NaN", () => {
    const engine = makeEngine({ geometric: { 1: { areaImagePx: NaN } } });
    const agg = fmt.aggregateStats(engine, null, [{ incrementId: 1 }]);
    expect(agg.count).toBe(1);
    expect(agg.totalAreaLabel).toBe(EMPTY);
    expect(agg.meanAreaLabel).toBe(EMPTY);
    expect(fmt.aggregateStats(engine, null, []).count).toBe(0);
});

test("rowsToCsv quotes every cell so commas and quotes in labels survive", () => {
    const rows = [{
        label: 'Tumor, grade "3" #4',
        area: "1.42 mm²",
        mean: EMPTY,
        percentPositive: "42.4%",
        components: "88",
        density: "62.0",
    }];
    const csv = fmt.rowsToCsv(rows, t);
    const [header, line] = csv.split("\n");

    expect(header).toBe('"col.label","col.area","col.mean","col.percentPositive","col.components","col.density"');
    // The embedded quote is doubled and the comma stays inside the field, so the
    // row still parses as exactly six columns.
    expect(line.startsWith('"Tumor, grade ""3"" #4",')).toBe(true);
    expect(line.split('","').length).toBe(6);
});

test("rowsToCsv writes a header even with no rows", () => {
    expect(fmt.rowsToCsv([], t).split("\n").length).toBe(1);
});

test("statRows groups rows and carries a help line per metric, so a surface can explain itself", () => {
    const object = { incrementId: 1 };
    const engine = makeEngine({ geometric: { 1: { areaLabel: "1 px²", lengthLabel: "4 px" } } });
    const rows = fmt.statRows(engine, null, object, {}, t);
    const groups = Object.fromEntries(rows.map((r) => [r.key, r.group]));
    expect(groups).toEqual({ area: "geometry", length: "geometry", mean: "pixels", percentPositive: "pixels", components: "pixels", density: "pixels" });
    for (const r of rows) expect(r.help).toBe(`metricHelp.${r.key === "length" ? "perimeter" : r.key}`);
});

test("samplingSummary names what the cached numbers were sampled from, or nothing", () => {
    const object = { incrementId: 1 };
    const tt = (k, v) => (v ? `${k}|${v.source}|${v.channel}|${v.threshold}` : k);

    expect(fmt.samplingSummary(makeEngine({ geometric: { 1: {} } }), object, {}, tt)).toBe("");

    const auto = makeEngine({ geometric: { 1: {} }, cached: { mean: 1, source: "rendered", channel: "R", threshold: 142.6, thresholdAuto: true } });
    expect(fmt.samplingSummary(auto, object, {}, tt)).toBe("sampledWithAuto|channelSource.rendered|channels.R|143");

    const fixed = makeEngine({ geometric: { 1: {} }, cached: { mean: 1, source: "background-raw", channel: "L", threshold: 128, thresholdAuto: false } });
    expect(fmt.samplingSummary(fixed, object, {}, tt)).toBe("sampledWith|channelSource.background-raw|channels.L|128");
});

test("reasonText maps kebab-case engine reasons to locale keys and falls back to the generic line", () => {
    const known = new Set(["reason.notFullyLoaded", "reason.generic"]);
    const tt = (k, v) => (known.has(k) ? `${k}(${v.count},${v.reason})` : k);
    expect(fmt.reasonText(tt, "not-fully-loaded", 2)).toBe("reason.notFullyLoaded(2,not-fully-loaded)");
    expect(fmt.reasonText(tt, "something-odd", 1)).toBe("reason.generic(1,something-odd)");
    expect(fmt.reasonText(tt, null)).toBe("");
});
