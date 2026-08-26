/**
 * Shared VOI (window/level) plumbing for the DICOM shader layers.
 *
 * `dicom-parametric` and `dicom-window` both denormalize a sample into an
 * object's declared real-world range and window it per fragment. That is one
 * behaviour with two call sites, and the parts that are easy to get subtly wrong
 * — the GLSL float literal rule, the slider bounds derived from the data, the
 * step size — are exactly the parts that would drift if each layer kept its own
 * copy. So they live here once.
 *
 * What does NOT live here is the compositing decision: an overlay may return
 * `vec4(0)` to stay transparent, a background never may. Each layer keeps its
 * own `getFragmentShaderExecution`.
 */

/**
 * A GLSL float literal. `1` alone is an `int` in GLSL and will not compile
 * where a `float` is expected, so integral values must carry the `.0`.
 */
export const glslFloat = (value) => {
    const n = Number.isFinite(value) ? value : 0;
    return Number.isInteger(n) ? `${n}.0` : String(n);
};

/**
 * The real-world interval the tile samples were normalized against.
 *
 * Objects that declare no range are normalized by the tile source against this
 * same `0..1` default, so the two ends must agree.
 */
export function resolveValueRange(params) {
    const r = params?.valueRange;
    if (r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.max > r.min) return r;
    return { min: 0, max: 1 };
}

/** The object's own window, which is the right thing to open with. */
export function initialWindow(params) {
    const { min, max } = resolveValueRange(params);
    const preset = Array.isArray(params?.voiPresets) ? params.voiPresets[0] : null;
    if (preset && Number.isFinite(preset.center) && preset.width > 0) {
        return { center: preset.center, width: preset.width };
    }
    return { center: (min + max) / 2, width: max - min };
}

/**
 * The `windowCenter` / `windowWidth` control pair, with bounds that follow the
 * data.
 *
 * A fixed `0..1` range would make Hounsfield units unusable, and a fixed
 * Hounsfield range would make probabilities unusable — so both come from
 * `params.valueRange`, and every control reads in the object's own units.
 *
 * @param {(key: string, options?: object) => string} t namespace-aware translator.
 *   Called here, never cached in a static: the loader installs a stub `$.t`
 *   before i18next initializes, so a static would capture the stub's output.
 * @param {object} params the layer's emitted shader params
 */
export function windowControlDefinitions(t, params) {
    const { min, max } = resolveValueRange(params);
    const span = max - min;
    const initial = initialWindow(params);
    const units = params?.units ? ` [${params.units}]` : "";
    const step = span / 1000;

    return {
        windowCenter: {
            default: {
                type: "range_input",
                default: initial.center,
                min: min - span,
                max: max + span,
                step,
                title: t('overlay.windowCenter') + units,
            },
            accepts: (type) => type === "float",
        },
        windowWidth: {
            default: {
                type: "range_input",
                default: initial.width,
                // A zero width divides by zero in the VOI transform.
                min: step,
                max: span * 2,
                step,
                title: t('overlay.windowWidth') + units,
            },
            accepts: (type) => type === "float",
        },
    };
}

/**
 * GLSL that denormalizes `sampleExpr` back into real-world units.
 *
 * Tiles carry the sample normalized to `[0,1]` over the declared range, so every
 * window control below can work in the units the DICOM object itself declares.
 */
export function denormalizeGlsl(sampleExpr, range) {
    return `${glslFloat(range.min)} + ${sampleExpr} * ${glslFloat(range.max - range.min)}`;
}

/**
 * GLSL for the DICOM VOI transform, LINEAR_EXACT arithmetic (PS3.3 C.11.2.1.3).
 *
 * The plain LINEAR formula's `-0.5` and `(w-1)` terms count *distinct integer
 * stored values*; they are meaningless for continuous samples. Applied literally
 * to a `0..1` map with width 1 they collapse it to a binary mask.
 */
export function voiTransformGlsl(realExpr, centerExpr, widthExpr) {
    return `clamp((${realExpr} - ${centerExpr}) / max(${widthExpr}, 1e-6) + 0.5, 0.0, 1.0)`;
}
