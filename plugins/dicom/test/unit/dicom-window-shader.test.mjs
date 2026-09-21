/**
 * A shader layer fails late and loudly nowhere: a bad GLSL literal is a compile
 * error the user sees as a blank viewport, and a background layer that returns
 * `vec4(0)` anywhere shows the empty canvas rather than the image. Both are
 * cheap to pin without a GPU, because the layer's whole contract is the string
 * it emits and the control definitions it declares.
 *
 * `dicom-parametric` is exercised alongside it: the two now share
 * `voi-controls.mjs`, and the point of sharing was that they cannot drift.
 */
import { test, expect } from "@xopat/test-harness";

/**
 * Stand-in for a bound control, modelling `UIControls.IControl` and nothing else
 * — the layers must not reach past that interface, and a fake that offered more
 * would let them.
 *
 * `sample()` yields the uniform name, which is what the GLSL assertions read.
 * `set(encoded)` stores the encoded value, normalizes to `raw` the way a `range`
 * control does, and fires the single `"default"` handler — so a programmatic
 * write is indistinguishable from a user edit, which is exactly the condition
 * the layer's re-entrancy guard exists for. `writes` records the encoded values
 * so a test can assert one user action costs one write.
 */
const control = (name) => ({
    name,
    id: `id-${name}`,
    encodedValue: undefined,
    params: {},
    writes: [],
    sample: (...args) => (args.length ? `${name}(${args[0]})` : name),
    get encoded() { return this.encodedValue; },
    get raw() {
        const value = Number(this.encodedValue);
        const { min, max } = this.params;
        // `range`/`number` normalize; `select`/`bool` are the identity.
        return Number.isFinite(min) && Number.isFinite(max) && max > min
            ? (value - min) / (max - min) : value;
    },
    on(event, handler) { this._handlers = { ...this._handlers, [event]: handler }; },
    set(encoded) {
        this.encodedValue = encoded;
        this.writes.push(encoded);
        this._handlers?.default?.(this.raw, encoded, this);
    },
});

/**
 * Give the fake controls the bounds their definitions declare, the way
 * `ShaderLayer._buildControls` does. `controlRealGlsl` reads `control.params` to
 * undo the renderer's 0..1 normalization, so without this the emitted GLSL would
 * be tested against bounds no control actually has.
 */
const bindControls = (layer) => {
    const defs = layer.getControlDefinitions();
    for (const [name, def] of Object.entries(defs)) {
        if (layer[name] && def?.default) layer[name].params = def.default;
    }
    return layer;
};

/**
 * A fake `$.FlexRenderer.ShaderLayer` plus the OpenSeadragon bits the layers
 * reach for. `$.extend(true, {}, x)` is the only namespace function they use.
 */
const $ = {
    extend(deep, target, source) { return JSON.parse(JSON.stringify(source ?? target ?? {})); },
    FlexRenderer: {
        ShaderLayer: class {
            constructor(params) {
                this._params = params || {};
                this.invalidations = 0;
                // Bind the controls the layers reference by name.
                for (const key of ["cutoff", "preset", "invert", "useColormap", "color",
                                   "windowCenter", "windowWidth"]) {
                    this[key] = control(key);
                }
            }
            sampleChannel() { return "SAMPLE"; }
            init() { /* the real one initializes each control */ }
            invalidate() { this.invalidations++; }
        },
    },
};

/** Echo the key so a missing translation is visible rather than silently "". */
const t = (key, opts) => (opts ? `${key}:${JSON.stringify(opts)}` : key);

const { defineDicomWindowShader } = await import("../../shaders/dicom-window.mjs");
const { defineDicomParametricShader } = await import("../../shaders/dicom-parametric.mjs");

const WindowLayer = defineDicomWindowShader($, t);
const ParametricLayer = defineDicomParametricShader($, t);

const CT_PARAMS = {
    valueRange: { min: -1024, max: 3071 },
    voiPresets: [{ center: 40, width: 400, explanation: "SOFT TISSUE" }],
    units: "HU",
    modality: "CT",
    invert: false,
};

const make = (Layer, params) => bindControls(new Layer(params));

/**
 * Every number the layer interpolates into the shader must carry a decimal
 * point: `1` alone is an `int` in GLSL and will not compile where a `float` is
 * expected. Array sizes (`vec2[7]`, `dwPresets[7]`) are genuinely ints and are
 * therefore not checked — only `vec2(...)` constructor arguments and the
 * denormalize expression, which are the two places a value from the DICOM object
 * reaches the shader.
 */
function assertFloatLiterals(glsl) {
    const offenders = [];

    for (const [, args] of glsl.matchAll(/vec2\(([^)]*)\)/g)) {
        for (const arg of args.split(",").map(s => s.trim())) {
            if (/^-?\d+$/.test(arg)) offenders.push(`vec2 arg ${arg}`);
        }
    }

    // `<min> + SAMPLE * <span>` — the denormalize form both layers emit.
    for (const [, lo, hi] of glsl.matchAll(/(-?[\d.]+) \+ SAMPLE \* (-?[\d.]+)/g)) {
        for (const n of [lo, hi]) if (!n.includes(".")) offenders.push(`denormalize literal ${n}`);
    }

    // `(<uniform> * <span> + <min>)` — the control denormalize form.
    for (const [, span, min] of glsl.matchAll(/\(\w+ \* (-?[\d.]+) \+ (-?[\d.]+)\)/g)) {
        for (const n of [span, min]) if (!n.includes(".")) offenders.push(`control literal ${n}`);
    }

    expect(offenders).toEqual([]);
}

/* ------------------------------------------------------------------ */
/* dicom-window                                                        */
/* ------------------------------------------------------------------ */

test("declares itself as an opaque scalar background layer", { tag: ["@unit"] }, () => {
    expect(WindowLayer.type()).toBe("dicom-window");
    // Windowing an already-quantized sample is meaningless.
    expect(WindowLayer.supportsHighPrecision()).toBe(true);
    // A background is not a mask.
    expect(WindowLayer.expects()).toEqual({ dataKind: "scalar", channels: 1, requiresThreshold: false });
    // `use_mode` must stay unset — "blend" selects the 'mask' blend function,
    // which never reads the foreground's RGB.
    expect(WindowLayer.defaultControls.use_mode).toBe(undefined);
    expect(WindowLayer.defaultControls.use_channel0.default).toBe("r");
});

test("is opaque everywhere — never returns a transparent fragment", { tag: ["@unit"] }, () => {
    const glsl = make(WindowLayer, CT_PARAMS).getFragmentShaderExecution();
    expect(glsl).toContain("return vec4(dwRgb, 1.0);");
    // The parametric layer's cutoff-to-transparent must not have been copied.
    expect(glsl).not.toContain("vec4(.0)");
    expect(glsl).not.toContain("cutoff");
    // Exactly one return: a background with an early-out would show the canvas.
    expect(glsl.match(/return /g)).toHaveLength(1);
});

test("the shader reads the sliders unconditionally", { tag: ["@unit"] }, () => {
    const layer = make(WindowLayer, CT_PARAMS);
    const controls = layer.getControlDefinitions();
    const glsl = layer.getFragmentShaderExecution();

    const options = controls.preset.default.options;
    // The object's own preset first, then the standard Hounsfield windows.
    expect(options[0].label).toBe("SOFT TISSUE");
    expect(options.at(-1)).toEqual({ value: -1, label: "window.preset.custom" });

    // The preset used to be resolved in GLSL, which made the sliders dead for as
    // long as any preset was selected — i.e. by default, since the select opens
    // on index 0 whenever the modality offers a window.
    expect(glsl).not.toContain("dwPresets");
    expect(glsl).not.toMatch(/\bint dwP\b/);
    expect(glsl).toContain("vec2 dwCW = vec2(" +
        "(windowCenter * 4095.0 + -1024.0), (windowWidth * 8185.905 + 4.095));");
});

test("the window controls are read in real units, not as the 0..1 uniform", { tag: ["@unit"] }, () => {
    // A range control uploads (value - min) / (max - min). Feeding that straight
    // into Hounsfield arithmetic mixes a ratio with an attenuation value and
    // clips the image to a mask, so the shader undoes it with the control's own
    // bounds as literals.
    for (const Layer of [WindowLayer, ParametricLayer]) {
        const layer = make(Layer, CT_PARAMS);
        const bounds = layer.getControlDefinitions().windowCenter.default;
        const glsl = layer.getFragmentShaderExecution();

        expect(bounds.min).toBe(-1024);
        expect(glsl).toContain(`(windowCenter * ${(bounds.max - bounds.min).toFixed(1)} + -1024.0)`);
        assertFloatLiterals(glsl);
    }

    // A control already bounded 0..1 needs no correction, and must not pay for
    // one — that is every built-in layer's case.
    const unit = make(WindowLayer, { valueRange: { min: 0, max: 1 }, modality: "MR" });
    expect(unit.windowCenter.params).toEqual(expect.objectContaining({ min: 0, max: 1 }));
    expect(unit.getFragmentShaderExecution()).toContain("vec2 dwCW = vec2(windowCenter,");
});

test("choosing a preset writes both sliders, and Custom writes neither", { tag: ["@unit"] }, () => {
    const layer = make(WindowLayer, CT_PARAMS);
    layer.init();

    const presets = layer.getControlDefinitions().preset.default.options;
    const lung = presets.findIndex(o => o.label === "window.preset.lung");
    expect(lung).toBeGreaterThan(-1);

    layer.preset.set(String(lung));
    // `encoded`, not `raw`: the encoded value is what the widget shows and what
    // the control was set to; `raw` is the normalized ratio.
    expect(layer.windowCenter.encoded).toBe("-600");
    expect(layer.windowWidth.encoded).toBe("1500");
    // Exactly one write each: a second would mean the guard let the slider
    // handler bounce back through the preset handler.
    expect(layer.windowCenter.writes).toEqual(["-600"]);
    expect(layer.windowWidth.writes).toEqual(["1500"]);
    expect(layer.invalidations).toBe(1);

    // Custom hands control back to the sliders, so it must leave them alone.
    layer.preset.set("-1");
    expect(layer.windowCenter.writes).toEqual(["-600"]);
    expect(layer.windowWidth.writes).toEqual(["1500"]);
});

test("moving a slider flips the select to Custom, once", { tag: ["@unit"] }, () => {
    const layer = make(WindowLayer, CT_PARAMS);
    layer.init();
    layer.preset.set("0");
    const centerWrites = layer.windowCenter.writes.length;

    // A user edit reaches the layer exactly as a programmatic write does — the
    // control fires "default" either way — which is what the guard is for.
    layer.windowCenter.set("120");
    expect(layer.preset.encoded).toBe("-1");
    // The flip must not write the sliders back — that would fight the drag.
    expect(layer.windowCenter.writes).toHaveLength(centerWrites + 1);
    expect(layer.windowWidth.writes).toHaveLength(1);

    // Already on Custom: a drag fires per step and must not cost a redraw each.
    const presetWrites = layer.preset.writes.length;
    layer.windowCenter.set("130");
    expect(layer.preset.writes).toHaveLength(presetWrites);
});

test("does not offer Hounsfield presets for a non-CT modality", { tag: ["@unit"] }, () => {
    const mr = make(WindowLayer, { ...CT_PARAMS, modality: "MR", units: null });
    const options = mr.getControlDefinitions().preset.default.options;
    // Only the object's own window plus Custom — HU windows are meaningless for
    // MR signal intensity.
    expect(options).toHaveLength(2);
    expect(options[0].label).toBe("SOFT TISSUE");
});

test("does not list a standard window the object already declares", { tag: ["@unit"] }, () => {
    const layer = make(WindowLayer, {
        ...CT_PARAMS,
        voiPresets: [{ center: 40, width: 400, explanation: "SOFT TISSUE" }, { center: -600, width: 1500, explanation: "LUNG" }],
    });
    const labels = layer.getControlDefinitions().preset.default.options.map(o => o.label);
    expect(labels).toContain("SOFT TISSUE");
    expect(labels).toContain("LUNG");
    // ...and not our translated duplicates of the same numbers.
    expect(labels).not.toContain("window.preset.softTissue");
    expect(labels).not.toContain("window.preset.lung");
});

test("falls back to the sliders when the object declares no window", { tag: ["@unit"] }, () => {
    const layer = make(WindowLayer, { valueRange: { min: 0, max: 100 } });
    const controls = layer.getControlDefinitions();
    expect(controls.preset.default.default).toBe(-1);
    expect(controls.preset.default.options).toEqual([{ value: -1, label: "window.preset.custom" }]);

    // Nothing to seed from, so the sliders keep the whole-range default.
    expect(controls.windowCenter.default.default).toBe(50);
    expect(controls.windowWidth.default.default).toBe(100);
    expect(layer.getFragmentShaderExecution()).toContain("vec2 dwCW = vec2((windowCenter *");
});

test("the select and the sliders open on the same window", { tag: ["@unit"] }, () => {
    // A CT that declares no WindowCenter/WindowWidth still gets the standard
    // Hounsfield windows, and the select opens on the first of them. The sliders
    // used to open on the whole declared range instead — the select said "soft
    // tissue" while the image showed air-to-bone.
    const controls = make(WindowLayer, {
        valueRange: { min: -1024, max: 3071 }, modality: "CT", units: "HU",
    }).getControlDefinitions();

    expect(controls.preset.default.default).toBe(0);
    expect(controls.preset.default.options[0].label).toBe("window.preset.softTissue");
    expect(controls.windowCenter.default.default).toBe(40);
    expect(controls.windowWidth.default.default).toBe(400);
});

test("grayscale by default; colour by default only where it is the convention", { tag: ["@unit"] }, () => {
    const ct = make(WindowLayer, CT_PARAMS).getControlDefinitions();
    expect(ct.useColormap.default.default).toBe(false);

    const pet = make(WindowLayer, { ...CT_PARAMS, modality: "PT" }).getControlDefinitions();
    expect(pet.useColormap.default.default).toBe(true);
    expect(pet.color.default.default).toBe("Hot");

    // The `Greys` colormap runs light-to-dark with at most nine steps, so the
    // grayscale branch is the direct ramp rather than any colormap lookup.
    const glsl = make(WindowLayer, CT_PARAMS).getFragmentShaderExecution();
    expect(glsl).toContain("useColormap ? color(dwT) : vec3(dwT)");
});

test("inversion is applied after windowing, defaulted from MONOCHROME1", { tag: ["@unit"] }, () => {
    const layer = make(WindowLayer, { ...CT_PARAMS, invert: true });
    expect(layer.getControlDefinitions().invert.default.default).toBe(true);

    const glsl = layer.getFragmentShaderExecution();
    const windowAt = glsl.indexOf("float dwT =");
    const invertAt = glsl.indexOf("dwT = 1.0 - dwT");
    // Inverting the stored value instead would stop it being quantitative.
    expect(windowAt).toBeGreaterThan(-1);
    expect(invertAt).toBeGreaterThan(windowAt);
});

test("emits compilable float literals and denormalizes into real units", { tag: ["@unit"] }, () => {
    const glsl = make(WindowLayer, CT_PARAMS).getFragmentShaderExecution();
    assertFloatLiterals(glsl);
    // min + sample * span, with the span as a literal.
    expect(glsl).toContain("-1024.0 + SAMPLE * 4095.0");

    // An integral range must still emit `.0`.
    const integral = make(WindowLayer, { valueRange: { min: 0, max: 1 }, modality: "MR" }).getFragmentShaderExecution();
    expect(integral).toContain("0.0 + SAMPLE * 1.0");
    assertFloatLiterals(integral);
});

/* ------------------------------------------------------------------ */
/* Shared controls / dicom-parametric                                  */
/* ------------------------------------------------------------------ */

test("both layers derive window slider bounds from the same data", { tag: ["@unit"] }, () => {
    const windowControls = make(WindowLayer, CT_PARAMS).getControlDefinitions();
    const paramControls = make(ParametricLayer, CT_PARAMS).getControlDefinitions();

    for (const controls of [windowControls, paramControls]) {
        expect(controls.windowCenter.default.default).toBe(40);
        expect(controls.windowWidth.default.default).toBe(400);
        // Bounds follow the data: a fixed 0..1 range would make HU unusable.
        // The centre travels the DECLARED range — it used to be padded by a full
        // span on each side, which put two thirds of a CT slider off-scale.
        expect(controls.windowCenter.default.min).toBe(-1024);
        expect(controls.windowCenter.default.max).toBe(3071);
        // A zero width divides by zero in the VOI transform.
        expect(controls.windowWidth.default.min).toBeGreaterThan(0);
        expect(controls.windowCenter.default.title).toContain("[HU]");
    }
});

test("a preset centre outside the declared range still fits on the slider", { tag: ["@unit"] }, () => {
    // A window the select can choose but the slider cannot reach is a window the
    // user cannot then adjust.
    const controls = make(WindowLayer, {
        valueRange: { min: 0, max: 200 },
        voiPresets: [{ center: 500, width: 100, explanation: "ODD" }],
        modality: "MR",
    }).getControlDefinitions();

    expect(controls.windowCenter.default.max).toBeGreaterThanOrEqual(500);
    expect(controls.windowCenter.default.min).toBe(0);
});

test("dicom-parametric keeps its overlay behaviour after the refactor", { tag: ["@unit"] }, () => {
    const glsl = make(ParametricLayer, CT_PARAMS).getFragmentShaderExecution();
    // Still LINEAR_EXACT, still transparent below the cutoff. The window control
    // is read in real units; `cutoff` is a genuine 0..1 ratio and stays bare.
    expect(glsl).toContain("float pmT = clamp((pmReal - (windowCenter *");
    expect(glsl).toContain("if (pmT <= cutoff) return vec4(.0);");
    expect(glsl).toContain("-1024.0 + SAMPLE * 4095.0");
    assertFloatLiterals(glsl);
});

test("an object with no declared range normalizes against the same default at both ends", { tag: ["@unit"] }, () => {
    // The tile source normalizes against 0..1 when the object declares nothing;
    // the shader must undo exactly that, not something else.
    for (const Layer of [WindowLayer, ParametricLayer]) {
        const glsl = make(Layer, {}).getFragmentShaderExecution();
        expect(glsl).toContain("0.0 + SAMPLE * 1.0");
    }
});

/* ------------------------------------------------------------------ */
/* Params read outside a control must be declared                      */
/* ------------------------------------------------------------------ */

const { defineDicomSegShader } = await import("../../shaders/dicom-seg.mjs");
const SegLayer = defineDicomSegShader($, t);

/**
 * A layer reads these straight off `params`, so the renderer only knows they are
 * intentional if `customParams` says so. Undeclared is not cosmetic: the renderer
 * warns that it ignored them, and `_sanitizeShaderParams` DROPS them on a
 * shader-type change — a `dicom-seg` layer that loses `segments` renders
 * `vec4(0)`, i.e. nothing, with no error anywhere.
 */
test("every shader declares the params it reads outside a control", { tag: ["@unit"] }, () => {
    const declared = (Layer) => new Set([
        ...Object.keys(Layer.customParams || {}),
        ...Object.keys(Layer.defaultControls || {}),
    ]);

    // What each layer actually reaches for, read off the source of truth: its own
    // example params, which are the published schema's illustration of a valid
    // config for it.
    for (const Layer of [SegLayer, WindowLayer, ParametricLayer]) {
        const undeclared = Object.keys(Layer.exampleParams() || {})
            .filter(key => !key.startsWith("use_") && !declared(Layer).has(key));
        expect({ type: Layer.type(), undeclared }).toEqual({ type: Layer.type(), undeclared: [] });
    }
});

test("the VOI keys are declared once and shared, not copied", { tag: ["@unit"] }, () => {
    // `dicom-parametric` and `dicom-window` read valueRange/voiPresets/units
    // through voi-controls.mjs; declaring them separately is how they drift.
    for (const key of ["valueRange", "voiPresets", "units"]) {
        expect(WindowLayer.customParams[key]).toEqual(ParametricLayer.customParams[key]);
    }
    // ...and the two keys only the background layer reads stay only there.
    expect(Object.keys(ParametricLayer.customParams)).not.toContain("modality");
    expect(Object.keys(ParametricLayer.customParams)).not.toContain("invert");
});

test("a segmentation declares segments and nothing quantitative", { tag: ["@unit"] }, () => {
    // The VOI trio means nothing to a mask, and writing it onto a SEG layer is
    // what produced the renderer's "declared by no control or custom param" warning.
    expect(Object.keys(SegLayer.customParams)).toEqual(["segments"]);
});
