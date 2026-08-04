/**
 * `dicom-parametric` shader layer — renders a DICOM Parametric Map (or any
 * single-channel quantitative derived object) as a colour-mapped overlay with
 * live window/level.
 *
 * ## Where the DICOM display chain runs
 *
 * The Modality LUT (rescale / RealWorldValueMapping) is applied in the tile
 * source, because it is a fixed property of the object. The **VOI LUT is applied
 * here**, per fragment, so window centre and width are real sliders rather than
 * a tile-cache invalidation.
 *
 * That requires the renderer's first-pass colour target to keep float precision,
 * hence `requiresHighPrecision()`. Without it the first pass would quantize
 * samples to 8 bits and clamp them to [0,1] before this layer ever saw them, and
 * windowing would be meaningless. The renderer warns loudly and falls back to
 * RGBA8 when the WebGL context lacks `EXT_color_buffer_half_float`.
 *
 * ## Sample encoding
 *
 * Tiles carry the sample **normalized to the object's declared real-world
 * range** (`params.valueRange`), not the raw value. Normalizing spends
 * half-float's ~11 mantissa bits across the range that actually occurs, and
 * keeps the fallback path sane: under RGBA8 the tile bands rather than clamping
 * to white, which raw Hounsfield units would do. The range is emitted into the
 * GLSL as literals and undone here, so every control below is in real-world
 * units — the same units the DICOM object declares.
 */

/** GLSL float literal; `1` alone is an int in GLSL and will not compile. */
const glslFloat = (value) => {
    const n = Number.isFinite(value) ? value : 0;
    return Number.isInteger(n) ? `${n}.0` : String(n);
};

/**
 * @param {object} $ the OpenSeadragon namespace (NOT jQuery — the translator
 *   therefore has to be passed in rather than reached through `$`).
 * @param {(key: string, options?: object) => string} t namespace-aware
 *   translator. Called per use, never cached: the loader installs a stub `$.t`
 *   before i18next initializes, and control definitions are built later.
 */
export function defineDicomParametricShader($, t) {

    return class DicomParametricShaderLayer extends $.FlexRenderer.ShaderLayer {

        static type() { return "dicom-parametric"; }

        static name() { return "DICOM Parametric Map"; }

        static description() { return "colour-mapped quantitative overlay with live window/level"; }

        static intent() {
            return "Render a DICOM Parametric Map or other quantitative single-channel object " +
                "with a colour map and interactive window centre/width in real-world units.";
        }

        /**
         * Quantitative data: the samples must survive the first pass unquantized
         * and unclamped for windowing to mean anything.
         */
        static requiresHighPrecision() { return true; }

        static expects() {
            return { dataKind: "scalar", channels: 1, requiresThreshold: true };
        }

        static exampleParams() {
            return {
                valueRange: { min: 0, max: 1 },
                voiPresets: [{ center: 0.5, width: 1 }],
                units: "range: 0:1",
                color: "Viridis",
            };
        }

        static docs() {
            return {
                summary: "DICOM Parametric Map overlay with live window/level.",
                description:
                    "Samples one quantitative channel, denormalizes it into the object's declared " +
                    "real-world range, applies the DICOM VOI transform with interactive centre and " +
                    "width, and colours the result. Values at or below the cutoff render fully " +
                    "transparent so the underlying slide stays visible.",
                kind: "shader",
                inputs: [{
                    index: 0,
                    acceptedChannelCounts: [1],
                    description: "Quantitative value, normalized to params.valueRange",
                }],
                controls: [
                    { name: "color", ui: "colormap", valueType: "vec3", default: "Viridis" },
                    { name: "windowCenter", ui: "range_input", valueType: "float" },
                    { name: "windowWidth", ui: "range_input", valueType: "float" },
                    { name: "cutoff", ui: "range", valueType: "float", default: 0.02, min: 0, max: 1, step: 0.01 },
                ],
            };
        }

        static sources() {
            return [{
                acceptsChannelCount: (x) => x >= 1,
                description: "Quantitative value, normalized to the declared range",
            }];
        }

        static get defaultControls() {
            return {
                use_channel0: { default: "r" },   // eslint-disable-line camelcase
                // DO NOT set `use_mode` here — see the note in dicom-seg.mjs.
                // "blend" without an explicit `use_blend` selects the 'mask'
                // blend function, which never reads the foreground's RGB and
                // renders the overlay colourless.
                color: {
                    default: {
                        type: "colormap",
                        steps: 8,
                        default: "Viridis",
                        mode: "sequential",
                        continuous: true,
                        title: t('overlay.colormap'),
                    },
                    accepts: (type) => type === "vec3",
                },
                cutoff: {
                    default: { type: "range", default: 0.02, min: 0, max: 1, step: 0.01, title: t('overlay.transparentBelow') },
                    accepts: (type) => type === "float",
                },
            };
        }

        /** Real-world interval the tile samples were normalized against. */
        _valueRange() {
            const r = this._params?.valueRange;
            if (r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.max > r.min) return r;
            // Objects that declare no Real World Value range are already
            // normalized by the tile source against this same default.
            return { min: 0, max: 1 };
        }

        /** The object's own window, which is the right thing to open with. */
        _initialWindow() {
            const { min, max } = this._valueRange();
            const preset = Array.isArray(this._params?.voiPresets) ? this._params.voiPresets[0] : null;
            if (preset && Number.isFinite(preset.center) && preset.width > 0) {
                return { center: preset.center, width: preset.width };
            }
            return { center: (min + max) / 2, width: max - min };
        }

        getControlDefinitions() {
            const base = $.extend(true, {}, this.constructor.defaultControls);
            const { min, max } = this._valueRange();
            const span = max - min;
            const initial = this._initialWindow();
            const units = this._params?.units ? ` [${this._params.units}]` : "";

            // Slider bounds follow the data, so the control is usable whether the
            // object measures probabilities in 0..1 or attenuation in Hounsfield
            // units. A fixed 0..1 range would make the latter unusable.
            const step = span / 1000;

            base.windowCenter = {
                default: {
                    type: "range_input",
                    default: initial.center,
                    min: min - span,
                    max: max + span,
                    step,
                    title: t('overlay.windowCenter') + units,
                },
                accepts: (type) => type === "float",
            };

            base.windowWidth = {
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
            };

            return base;
        }

        getFragmentShaderExecution() {
            const { min, max } = this._valueRange();
            const sample = this.sampleChannel('v_texture_coords', 0, { baseChannel: 0, raw: true });

            return `
// Tiles carry the sample normalized to [0,1] over the object's declared range;
// undo that so the window controls below work in real-world units.
float pmReal = ${glslFloat(min)} + ${sample} * ${glslFloat(max - min)};

float pmC = ${this.windowCenter.sample()};
float pmW = max(${this.windowWidth.sample()}, 1e-6);

// LINEAR_EXACT arithmetic (PS3.3 C.11.2.1.3). The plain LINEAR formula's
// -0.5 / (w-1) terms count distinct integer stored values and are meaningless
// for continuous samples — applied literally to a 0..1 map with width 1 they
// collapse it to a binary mask.
float pmT = clamp((pmReal - pmC) / pmW + 0.5, 0.0, 1.0);

if (pmT <= ${this.cutoff.sample()}) return vec4(.0);
return vec4(${this.color.sample('pmT', 'float')}, 1.0);
`;
        }
    };
}
