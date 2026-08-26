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

/** Minimal stand-in for a bound control: `sample()` yields its uniform name. */
const control = (name) => ({ sample: (...args) => (args.length ? `${name}(${args[0]})` : name) });

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
                // Bind the controls the layers reference by name.
                for (const key of ["windowCenter", "windowWidth", "cutoff", "preset", "invert", "useColormap", "color"]) {
                    this[key] = control(key);
                }
            }
            sampleChannel() { return "SAMPLE"; }
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

const make = (Layer, params) => new Layer(params);

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

test("the preset table matches the control's options, minus Custom", { tag: ["@unit"] }, () => {
    const layer = make(WindowLayer, CT_PARAMS);
    const controls = layer.getControlDefinitions();
    const glsl = layer.getFragmentShaderExecution();

    const options = controls.preset.default.options;
    // The object's own preset first, then the standard Hounsfield windows.
    expect(options[0].label).toBe("SOFT TISSUE");
    expect(options.at(-1)).toEqual({ value: -1, label: "window.preset.custom" });

    const declared = Number(glsl.match(/const vec2 dwPresets\[(\d+)\]/)[1]);
    // A mismatch here indexes past the end of the array — undefined behaviour
    // in GLSL, and a black or garbage image on screen.
    expect(declared).toBe(options.length - 1);
    expect(glsl).toContain("vec2(40.0, 400.0)");
    expect(glsl).toContain("vec2(-600.0, 1500.0)");
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

    const glsl = layer.getFragmentShaderExecution();
    // No array to index, so no array is declared.
    expect(glsl).not.toContain("dwPresets");
    expect(glsl).toContain("vec2(windowCenter, windowWidth)");
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
        expect(controls.windowCenter.default.min).toBe(-1024 - 4095);
        expect(controls.windowCenter.default.max).toBe(3071 + 4095);
        // A zero width divides by zero in the VOI transform.
        expect(controls.windowWidth.default.min).toBeGreaterThan(0);
        expect(controls.windowCenter.default.title).toContain("[HU]");
    }
});

test("dicom-parametric keeps its overlay behaviour after the refactor", { tag: ["@unit"] }, () => {
    const glsl = make(ParametricLayer, CT_PARAMS).getFragmentShaderExecution();
    // Still LINEAR_EXACT, still transparent below the cutoff.
    expect(glsl).toContain("float pmT = clamp((pmReal - windowCenter)");
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
