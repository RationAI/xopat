/**
 * `dicom-window` shader layer — renders a monochrome DICOM image as a windowed
 * intensity image.
 *
 * Two kinds of source reach it. A radiology plane (CT / MR / PT / CR / DX / NM)
 * arrives as half-float packs from `RadiologySeriesTileSource`. A monochrome
 * **slide** — a fluorescence or multiplex-IHC optical path — arrives as ordinary
 * 8-bit RGBA tiles, and only when `DICOMWebTileSource` has established that the
 * byte IS the stored value (`canDeferVoiToShader`); the precision note below
 * therefore does not apply to it, because there is nothing wider to preserve.
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
 *   set of named windows far more often than they drag a slider. A preset is a
 *   shortcut that *writes* the centre/width sliders (`_bindWindowControls`); the
 *   sliders remain the only thing the shader reads. Selecting the window in GLSL
 *   instead — the original design — made the sliders inert for as long as a
 *   preset was selected, which was the default state.
 *
 * ## Where the DICOM display chain runs
 *
 * The Modality LUT (rescale / RealWorldValueMapping) is applied in the tile
 * source, per plane, because it is a fixed property of the data. The VOI LUT is
 * applied **here**, per fragment, so window centre and width are real sliders
 * rather than a re-decode of every visible slice.
 *
 * That requires the renderer's first-pass colour target to keep float precision.
 * Precision is negotiated from the *data* — the tiles are half-float packs, which
 * the drawer reports — reinforced by `precision: "float16"` on the emitted
 * shader config, and honoured only while the application option `webGlPrecision`
 * is `"auto"`. Under the `"unorm8"` default the sample is quantized to 8 bits
 * before this layer ever sees it, and a narrow window bands visibly; the tile
 * source says so once at init.
 */

import { controlRealGlsl, denormalizeGlsl, resolveValueRange, voiTransformGlsl, windowControlDefinitions, VOI_CUSTOM_PARAMS } from './voi-controls.mjs';

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

        static description() { return "DICOM intensity image with interactive window/level"; }

        static intent() {
            return "Render a monochrome DICOM image — a CT / MR / PET / X-ray plane, or a " +
                "fluorescence / multiplex-IHC slide optical path — as a windowed intensity " +
                "image with interactive window centre and width in the object's own units.";
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

        /**
         * The shared VOI keys, plus the two only this layer reads: `modality`
         * decides whether Hounsfield presets are offered at all, and `invert`
         * seeds the MONOCHROME1 flip.
         */
        static get customParams() {
            return {
                ...VOI_CUSTOM_PARAMS,
                modality: {
                    usage: "DICOM Modality of the series (CT, MR, PT, …). Selects the " +
                        "modality-specific window presets; anything else gets none.",
                    // Nullable, so the union form — see the note on `units`.
                    type: "string|null",
                    default: null,
                },
                invert: {
                    usage: "Open inverted — MONOCHROME1, where the stored maximum is black.",
                    // "boolean", not "bool": the latter is not in the renderer's type
                    // table and silently compiles to "anything goes".
                    type: "boolean",
                    default: false,
                },
            };
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
         * table. Index `-1` is "Custom": not a window of its own, just the state
         * the select falls to once the sliders no longer match a named one.
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
            const presets = this._presets();

            Object.assign(base, windowControlDefinitions(
                t, this._params, presets.map(p => p.center)));

            // The select and the sliders must open on the SAME window. They did
            // not: `initialWindow` falls back to the whole declared range when
            // the object carries no WindowCenter/WindowWidth, while the select
            // opens on `_presets()[0]` — which for such a CT is the standard
            // soft-tissue window. The select said "Soft tissue" and the image
            // showed the full Hounsfield span.
            const opening = presets[0];
            if (opening) {
                base.windowCenter.default.default = opening.center;
                base.windowWidth.default.default = opening.width;
            }

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

        /**
         * The preset select is a shortcut that WRITES the sliders; the sliders
         * are what the shader reads.
         *
         * Controls are only bound and initialized by `super.init()`, so this
         * cannot move into the constructor. `IControl.on` keeps one handler per
         * event and the layer is re-created on every rebuild, so registering
         * here is idempotent by construction — and the compound `range_input`'s
         * own `"default"` slot is free: `SliderWithInput.init` registers on its
         * two halves, never on itself.
         */
        init() {
            super.init();
            this._bindWindowControls();
        }

        _bindWindowControls() {
            if (!this.preset || !this.windowCenter || !this.windowWidth) return;

            // Every programmatic write re-enters through the control's own
            // `changed()`, so without this the two handlers below would call
            // each other indefinitely.
            const sync = (apply) => {
                if (this._syncingWindow) return;
                this._syncingWindow = true;
                try {
                    apply();
                } finally {
                    this._syncingWindow = false;
                }
                this.invalidate();
            };

            this.preset.on("default", (raw) => {
                // Out of range is "Custom" (-1): it hands control back to the
                // sliders and must therefore leave them exactly as they are.
                const chosen = this._presets()[Number.parseInt(raw, 10)];
                if (!chosen) return;
                // `IControl.set` takes the ENCODED value — what the widget shows,
                // in the control's own units — and owns the widget and the
                // uniform from there. The caller owns the redraw, hence `sync`.
                sync(() => {
                    this.windowCenter.set(String(chosen.center));
                    this.windowWidth.set(String(chosen.width));
                });
            });

            // A slider moved by hand no longer matches the named window, and a
            // select that keeps claiming otherwise is the same lie as the dead
            // sliders were, in the other direction.
            // Already on Custom is the common case — a drag fires this per step,
            // and rewriting an unchanged select would cost a redraw each time.
            const toCustom = () => {
                // `select` normalizes to the identity, so `raw` is the option's int.
                if (Number.parseInt(this.preset.raw, 10) === -1) return;
                sync(() => this.preset.set("-1"));
            };
            this.windowCenter.on("default", toCustom);
            this.windowWidth.on("default", toCustom);
        }

        getFragmentShaderExecution() {
            const range = resolveValueRange(this._params);
            const sample = this.sampleChannel('v_texture_coords', 0, { baseChannel: 0, raw: true });

            return `
// The two sliders are the ONLY source of the window. A preset is applied by
// writing them (see _bindWindowControls), so there is nothing to select here.
// Resolving the preset in GLSL instead — as this did — made the sliders dead
// for as long as any preset was selected, which is the default whenever the
// object or the modality offers one.
//
// The preset control still declares an int uniform it no longer reads; GLSL
// drops the unused declaration, getUniformLocation then answers null, and
// uploading to a null location is a documented no-op.
//
// controlRealGlsl rather than a bare sample: a float control uploads a 0..1
// ratio over its own bounds, not the number on its slider.
vec2 dwCW = vec2(${controlRealGlsl(this.windowCenter)}, ${controlRealGlsl(this.windowWidth)});

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
