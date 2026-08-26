/**
 * `dicom-window` shader layer — renders a DICOM radiology plane (CT / MR / PT /
 * CR / DX / NM) as a windowed intensity image.
 *
 * ## How it differs from `dicom-parametric`
 *
 * Both denormalize a sample into the object's declared real-world range and
 * apply the DICOM VOI transform per fragment; that arithmetic is shared through
 * `voi-controls.mjs`. The differences are all consequences of this being a
 * **background** layer rather than an overlay:
 *
 * - It is **always opaque**. `dicom-parametric` returns `vec4(0)` below a cutoff
 *   so the slide underneath stays visible; a background that did that would
 *   render the empty canvas. There is no cutoff control at all.
 * - It is **grayscale by default**. The `Greys` colormap runs light-to-dark and
 *   tops out at nine steps, which is not a radiology grayscale — the default
 *   path emits `vec3(t)` directly and the colormap is opt-in (and opted *in* by
 *   default for PT/NM, where a colour scale is the reading convention).
 * - It offers **window presets**, because a radiologist switches between a small
 *   set of named windows far more often than they drag a slider.
 *
 * ## Where the DICOM display chain runs
 *
 * The Modality LUT (rescale / RealWorldValueMapping) is applied in the tile
 * source, per plane, because it is a fixed property of the data. The VOI LUT is
 * applied **here**, per fragment, so window centre and width are real sliders
 * rather than a re-decode of every visible slice.
 *
 * That requires the renderer's first-pass colour target to keep float precision.
 * Precision is negotiated from the *data* — the tiles are RGBA16F packs, which
 * the drawer reports — reinforced by `precision: "float16"` on the emitted
 * shader config, and honoured only while the application option `webGlPrecision`
 * is `"auto"`. Under the `"unorm8"` default the sample is quantized to 8 bits
 * before this layer ever sees it, and a narrow window bands visibly; the tile
 * source says so once at init.
 */

import { denormalizeGlsl, glslFloat, resolveValueRange, voiTransformGlsl, windowControlDefinitions } from './voi-controls.mjs';

/**
 * Standard CT windows, in Hounsfield units.
 *
 * Gated to `modality === "CT"` on purpose: these are HU, and offering them for
 * MR signal intensity or PET activity would be offering nonsense presets. The
 * names are UI copy and therefore translated; the *object's own* preset names
 * come from `WindowCenterWidthExplanation` and are data, rendered verbatim.
 */
const CT_PRESETS = [
    { key: 'window.preset.softTissue', center: 40, width: 400 },
    { key: 'window.preset.lung', center: -600, width: 1500 },
    { key: 'window.preset.bone', center: 300, width: 1500 },
    { key: 'window.preset.brain', center: 40, width: 80 },
    { key: 'window.preset.liver', center: 60, width: 160 },
    { key: 'window.preset.mediastinum', center: 50, width: 350 },
    { key: 'window.preset.angio', center: 300, width: 600 },
];

/** Modalities whose reading convention is a colour scale rather than grey. */
const COLOUR_BY_DEFAULT = new Set(["PT", "NM"]);

/**
 * @param {object} $ the OpenSeadragon namespace (NOT jQuery — the translator
 *   therefore has to be passed in rather than reached through `$`).
 * @param {(key: string, options?: object) => string} t namespace-aware
 *   translator. Called per use, never cached: the loader installs a stub `$.t`
 *   before i18next initializes, and control definitions are built later.
 */
export function defineDicomWindowShader($, t) {

    return class DicomWindowShaderLayer extends $.FlexRenderer.ShaderLayer {

        static type() { return "dicom-window"; }

        static name() { return "DICOM Window/Level"; }

        static description() { return "radiology plane with interactive window/level"; }

        static intent() {
            return "Render a DICOM CT / MR / PET / X-ray plane as a windowed intensity image " +
                "with interactive window centre and width in the object's own units.";
        }

        /**
         * Quantitative data: the samples must survive the first pass unquantized
         * and unclamped for windowing to mean anything. Inherited `true` from
         * `ShaderLayer` — stated here because it is load-bearing rather than
         * incidental, and must not be flipped by a future edit.
         */
        static supportsHighPrecision() { return true; }

        static expects() {
            // A background is not a mask: unlike `dicom-parametric` there is no
            // threshold below which this layer stops drawing.
            return { dataKind: "scalar", channels: 1, requiresThreshold: false };
        }

        static exampleParams() {
            return {
                valueRange: { min: -1024, max: 3071 },
                voiPresets: [{ center: 40, width: 400, explanation: "SOFT TISSUE" }],
                units: "HU",
                modality: "CT",
                invert: false,
            };
        }

        static docs() {
            return {
                summary: "DICOM radiology plane with interactive window/level.",
                description:
                    "Samples one quantitative channel, denormalizes it into the object's declared " +
                    "real-world range, and applies the DICOM VOI transform. Renders grayscale by " +
                    "default, opaque everywhere. Window presets come from the object's own " +
                    "WindowCenter/WindowWidth pairs, plus the standard Hounsfield windows for CT.",
                kind: "shader",
                inputs: [{
                    index: 0,
                    acceptedChannelCounts: [1],
                    description: "Quantitative value, normalized to params.valueRange",
                }],
                controls: [
                    { name: "preset", ui: "select", valueType: "int", default: 0 },
                    { name: "windowCenter", ui: "range_input", valueType: "float" },
                    { name: "windowWidth", ui: "range_input", valueType: "float" },
                    { name: "invert", ui: "bool", valueType: "bool", default: false },
                    { name: "useColormap", ui: "bool", valueType: "bool", default: false },
                    { name: "color", ui: "colormap", valueType: "vec3", default: "Hot" },
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
                // renders the layer colourless.
            };
        }

        _modality() { return this._params?.modality ?? null; }

        /**
         * Every selectable window, in control order.
         *
         * The object's own presets come first — they are what the scanner or the
         * reading protocol chose for *this* acquisition and outrank a generic
         * table. Index `-1` is "Custom", which hands control back to the sliders.
         */
        _presets() {
            const own = (Array.isArray(this._params?.voiPresets) ? this._params.voiPresets : [])
                .filter(p => Number.isFinite(p?.center) && p?.width > 0)
                .map(p => ({
                    center: p.center,
                    width: p.width,
                    // WindowCenterWidthExplanation is DATA, like SegmentLabel —
                    // rendered verbatim, never translated. Only the fallback,
                    // which is our own text, carries a key.
                    label: p.explanation || t('window.presetFallback', { center: p.center, width: p.width }),
                }));

            if (this._modality() !== "CT") return own;

            // Skip a standard window the object already declares, so the list
            // does not show "SOFT TISSUE" twice under two different names.
            const declared = new Set(own.map(p => `${p.center}/${p.width}`));
            const standard = CT_PRESETS
                .filter(p => !declared.has(`${p.center}/${p.width}`))
                .map(p => ({ center: p.center, width: p.width, label: t(p.key) }));

            return own.concat(standard);
        }

        getControlDefinitions() {
            const base = $.extend(true, {}, this.constructor.defaultControls);
            Object.assign(base, windowControlDefinitions(t, this._params));

            const presets = this._presets();
            base.preset = {
                default: {
                    type: "select",
                    // Open on the object's own first window when it has one;
                    // otherwise there is nothing to prefer over the sliders.
                    default: presets.length ? 0 : -1,
                    title: t('window.presetTitle'),
                    options: [
                        ...presets.map((p, i) => ({ value: i, label: p.label })),
                        // -1 hands control back to the sliders below.
                        { value: -1, label: t('window.preset.custom') },
                    ],
                },
                accepts: (type) => type === "int",
            };

            base.invert = {
                default: {
                    type: "bool",
                    // MONOCHROME1 means "higher value renders darker". The tile
                    // source deliberately does NOT bake that in — inversion is
                    // presentation, and the samples must stay quantitative.
                    default: !!this._params?.invert,
                    title: t('window.invert'),
                },
                accepts: (type) => type === "bool",
            };

            base.useColormap = {
                default: {
                    type: "bool",
                    default: COLOUR_BY_DEFAULT.has(this._modality()),
                    title: t('window.useColormap'),
                },
                accepts: (type) => type === "bool",
            };

            base.color = {
                default: {
                    type: "colormap",
                    steps: 8,
                    default: COLOUR_BY_DEFAULT.has(this._modality()) ? "Hot" : "Viridis",
                    mode: "sequential",
                    continuous: true,
                    title: t('window.colormap'),
                },
                accepts: (type) => type === "vec3",
            };

            return base;
        }

        getFragmentShaderExecution() {
            const range = resolveValueRange(this._params);
            const sample = this.sampleChannel('v_texture_coords', 0, { baseChannel: 0, raw: true });
            const presets = this._presets();

            // Presets are resolved in GLSL rather than by writing the other
            // controls: a control that mutates its siblings is not something the
            // renderer's control system offers, and faking it would desynchronize
            // the sliders from what is actually drawn.
            const presetTable = presets.length
                ? `const vec2 dwPresets[${presets.length}] = vec2[${presets.length}](` +
                  presets.map(p => `vec2(${glslFloat(p.center)}, ${glslFloat(p.width)})`).join(", ") + `);`
                : "";

            const chooseWindow = presets.length
                ? `int dwP = ${this.preset.sample()};
vec2 dwCW = (dwP < 0 || dwP >= ${presets.length})
    ? vec2(${this.windowCenter.sample()}, ${this.windowWidth.sample()})
    : dwPresets[dwP];`
                : `vec2 dwCW = vec2(${this.windowCenter.sample()}, ${this.windowWidth.sample()});`;

            return `
${presetTable}
${chooseWindow}

// Tiles carry the sample normalized to [0,1] over the object's declared range;
// undo that so the window above works in real-world units.
float dwReal = ${denormalizeGlsl(sample, range)};
float dwT = ${voiTransformGlsl('dwReal', 'dwCW.x', 'dwCW.y')};

// MONOCHROME1 inversion is applied AFTER windowing: it is a presentation
// property, so the stored value stays quantitative all the way to here.
if (${this.invert.sample()}) dwT = 1.0 - dwT;

// The 'Greys' colormap runs light-to-dark and has at most nine steps, so it is
// not a radiology grayscale — emit the ramp directly.
vec3 dwRgb = ${this.useColormap.sample()} ? ${this.color.sample('dwT', 'float')} : vec3(dwT);

// A background is opaque everywhere. Returning vec4(0) anywhere would show the
// empty canvas, not the slide underneath.
return vec4(dwRgb, 1.0);
`;
        }
    };
}
