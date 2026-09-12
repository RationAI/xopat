/**
 * What the intensity metrics actually sample.
 *
 * The annotation being measured is drawn with a translucent fill. It lives on a
 * fabric 2D overlay, not in the flex renderer, so `renderedConfig` — which builds
 * its layer set from `renderer.getShaderLayerOrder()` — cannot pick it up. That
 * is correct, and completely invisible.
 *
 * If it ever regressed, a red-filled polygon would contribute its own colour to
 * its own measurement: `V = max(RGB)` would run toward 255, mean would climb and
 * % positive would approach 100 — and every number would still look like a
 * plausible reading of a stained region. There is no downstream assertion that
 * would catch it, so it is pinned here.
 *
 * The GL sampling itself (`sampleRegion` → `gl.readPixels`) is not covered: no
 * test in this repo drives a WebGL context, and `test/harness/shims.mjs`
 * deliberately returns `null` from `getContext`.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
await import("../../raster-sampler.js");

const sampler = globalThis.AnnotationMeasurements.sampler;

/** A viewer whose renderer exposes a known layer set. No GL involved. */
function viewerWith(layers, order = Object.keys(layers)) {
    return {
        drawer: {
            renderer: {
                getShaderLayerOrder: () => order,
                getShaderLayerConfig: (id) => layers[id],
            },
        },
    };
}

test("the rendered source is exactly the renderer's visible shader layers @unit", () => {
    const layers = {
        background: { id: "background", visible: 1 },
        overlay: { id: "overlay", visible: 1 },
    };
    const cfg = sampler.renderedConfig(viewerWith(layers));

    expect(Object.keys(cfg).sort()).toEqual(["background", "overlay"]);
});

test("an annotation overlay can never enter the sampled composite @unit", () => {
    // The fabric canvas is not a shader layer, so it is not in the order list.
    // Assert the set is bounded by that list rather than by a name blocklist:
    // a blocklist would pass while silently admitting anything newly added.
    const layers = { background: { id: "background", visible: 1 } };
    const order = ["background"];
    const cfg = sampler.renderedConfig(viewerWith(layers, order));

    for (const id of Object.keys(cfg)) expect(order).toContain(id);
    expect(Object.keys(cfg)).not.toContain("annotations");
});

test("hidden and failed layers are excluded — we sample what is shown @unit", () => {
    const layers = {
        background: { id: "background", visible: 1 },
        hiddenBool: { id: "hiddenBool", visible: false },
        hiddenZero: { id: "hiddenZero", visible: 0 },
        broken: { id: "broken", visible: 1, error: "shader failed" },
    };
    const cfg = sampler.renderedConfig(viewerWith(layers));

    expect(Object.keys(cfg)).toEqual(["background"]);
});

test("no usable layer yields null rather than an empty measurement @unit", () => {
    // null makes the sampler report `no-visualization`; an empty object would
    // render a black frame and be measured as a legitimate all-zero region.
    expect(sampler.renderedConfig(viewerWith({ a: { id: "a", visible: false } }))).toBe(null);
    expect(sampler.renderedConfig({})).toBe(null);
    expect(sampler.renderedConfig(viewerWith({}, []))).toBe(null);
});

test("a config reports the channel it actually measured @unit", async () => {
    // The three call sites disagreed: the projection fell back to 'L', the
    // result was labelled 'V' and the cache slot keyed on 'L' again. From the
    // panel a channel is always passed so it never showed; `measurements.measure()`
    // from scripting passes none, and got luminance labelled as Value.
    await import("../../statistics.js");
    await import("../../polygon-rasterizer.js");
    await import("../../connected-components.js");
    await import("../../geometry-metrics.js");
    await import("../../measurement-engine.js");

    const NS = globalThis.AnnotationMeasurements;
    const engine = new NS.MeasurementEngine({ annotations: {} });

    // Two configs differing only in the channel must not collide in the cache,
    // and a config with no channel must key the same as its resolved default.
    const withDefault = NS.slotKey({ source: "rendered" });
    const withValue = NS.slotKey({ source: "rendered", channel: "V" });
    const withLuminance = NS.slotKey({ source: "rendered", channel: "L" });

    expect(withDefault).toBe(withValue);
    expect(withDefault).not.toBe(withLuminance);
    expect(engine.lastConfig.channel).toBe("V");
});

test("the layer config is copied, not aliased into the renderer's state @unit", () => {
    // The sampler hands this config to a standalone drawer; mutating it must not
    // reach back into the live renderer and change what the user sees.
    const live = { id: "background", visible: 1 };
    const cfg = sampler.renderedConfig(viewerWith({ background: live }));

    cfg.background.visible = 0;
    expect(live.visible).toBe(1);
});
