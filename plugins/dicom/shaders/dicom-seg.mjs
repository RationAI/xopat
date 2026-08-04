/**
 * `dicom-seg` shader layer — renders a DICOM Segmentation object as a coloured
 * overlay above its source slide.
 *
 * The tile source packs one segment per channel (see derived-tile-source.mjs),
 * so this layer is a fixed unrolled loop over `params.segments`: sample the
 * segment's channel, gate it by a shared threshold, tint it with the segment's
 * own colour, and composite in segment order.
 *
 * Controls are built per instance through `getControlDefinitions()` — the number
 * of segments is a property of the DICOM object, not of the shader class, so a
 * static declaration could not express it.
 *
 * Defaults come from the object itself: `RecommendedDisplayCIELabValue` when the
 * segment declares one, otherwise a deterministic hue. That means a pathologist
 * sees the colours the segmentation's author intended, without configuring
 * anything.
 */
/**
 * @param {object} $ the OpenSeadragon namespace (NOT jQuery — the translator
 *   therefore has to be passed in rather than reached through `$`).
 * @param {(key: string, options?: object) => string} t namespace-aware
 *   translator. Called per use, never cached: the loader installs a stub `$.t`
 *   before i18next initializes, and control definitions are built later.
 */
export function defineDicomSegShader($, t) {

    return class DicomSegShaderLayer extends $.FlexRenderer.ShaderLayer {

        static type() { return "dicom-seg"; }

        static name() { return "DICOM Segmentation"; }

        static description() { return "per-segment coloured overlay from a DICOM SEG object"; }

        static intent() {
            return "Render a DICOM Segmentation object over its source slide. " +
                "Each segment gets its own colour, visibility toggle and opacity.";
        }

        static expects() {
            return { dataKind: "mask", channels: "1..n", requiresThreshold: false };
        }

        static exampleParams() {
            return {
                segments: [
                    { number: 1, label: "Tumor", color: [255, 0, 0] },
                    { number: 2, label: "Stroma", color: [0, 128, 255] },
                ],
                threshold: 0.5,
            };
        }

        static docs() {
            return {
                summary: "DICOM Segmentation overlay.",
                description:
                    "Consumes a tile source that packs one segment mask per channel. Each segment is " +
                    "gated by a shared threshold (meaningful for FRACTIONAL segmentations; a BINARY " +
                    "segmentation is already 0 or 1) and tinted with its own colour. Segments composite " +
                    "in ascending segment number, so later segments paint over earlier ones where they overlap.",
                kind: "shader",
                inputs: [{
                    index: 0,
                    acceptedChannelCounts: "any",
                    description: "Segment masks, one per channel, in ascending segment number",
                }],
                controls: [
                    { name: "threshold", ui: "range", valueType: "float", default: 0.5, min: 0, max: 1, step: 0.01 },
                    { name: "segColor<i>", ui: "color", valueType: "vec3" },
                    { name: "segShow<i>", ui: "bool", valueType: "bool", default: true },
                ],
            };
        }

        static sources() {
            return [{
                acceptsChannelCount: (x) => x >= 1,
                description: "Segment masks packed one per channel",
            }];
        }

        static get defaultControls() {
            return {
                // Each segment is read as a single scalar channel; the base
                // channel is chosen per segment at sampling time.
                use_channel0: { default: "r" },   // eslint-disable-line camelcase
                // DO NOT set `use_mode` here. The renderer default is "show",
                // which is premultiplied source-over — exactly what an overlay
                // needs. Setting "blend" routes compositing through `use_blend`,
                // which defaults to 'mask' — a function that never reads the
                // foreground's RGB, so every segment renders colourless and no
                // colour/opacity/visibility edit has any visible effect.
                threshold: {
                    default: { type: "range", default: 0.5, min: 0, max: 1, step: 0.01, title: t('overlay.threshold') },
                    accepts: (type) => type === "float",
                },
            };
        }

        /** Segments declared by the DICOM object, in the channel order the tile source used. */
        _segments() {
            const segments = this._params?.segments;
            return Array.isArray(segments) ? segments : [];
        }

        /** SegmentLabel when the object carries one, else a numbered fallback. */
        static _labelOf(seg, index) {
            return seg?.label || t('overlay.segmentFallback', { number: seg?.number ?? index + 1 });
        }

        static _hex(color) {
            if (typeof color === "string") return color;
            if (!Array.isArray(color) || color.length < 3) return "#ff0000";
            return "#" + color.slice(0, 3)
                .map(c => Math.max(0, Math.min(255, Math.round(Number(c) || 0))).toString(16).padStart(2, "0"))
                .join("");
        }

        getControlDefinitions() {
            const base = $.extend(true, {}, this.constructor.defaultControls);
            const Self = this.constructor;

            base.segColor = {
                array: {
                    count: (layer) => layer._segments().length,
                    name: (index) => `segColor${index}`,
                    item: (index, layer) => {
                        const seg = layer._segments()[index] || {};
                        return {
                            default: {
                                type: "color",
                                default: Self._hex(seg.color),
                                // The label is the segment's own SegmentLabel, so the
                                // controls panel reads like the segmentation's legend.
                                title: t('overlay.segmentColor', { label: Self._labelOf(seg, index) }),
                            },
                            accepts: (type) => type === "vec3",
                        };
                    },
                },
            };

            base.segShow = {
                array: {
                    count: (layer) => layer._segments().length,
                    name: (index) => `segShow${index}`,
                    item: (index, layer) => {
                        const seg = layer._segments()[index] || {};
                        return {
                            default: {
                                type: "bool",
                                default: true,
                                title: t('overlay.segmentVisible', { label: Self._labelOf(seg, index) }),
                            },
                            accepts: (type) => type === "bool",
                        };
                    },
                },
            };

            return base;
        }

        getFragmentShaderExecution() {
            const segments = this._segments();
            if (!segments.length) {
                // A SEG with no segments cannot be rendered; emitting nothing is
                // better than emitting a shader that fails to compile.
                return `return vec4(.0);`;
            }

            const lines = [
                `vec3 segRgb = vec3(0.0);`,
                `float segA = 0.0;`,
                `float segThr = ${this.threshold.sample()};`,
            ];

            for (let i = 0; i < segments.length; i++) {
                const colorControl = this[`segColor${i}`];
                const showControl = this[`segShow${i}`];
                if (!colorControl || !showControl) continue;

                const mask = this.sampleChannel('v_texture_coords', 0, { baseChannel: i, raw: true });
                lines.push(
                    `if (${showControl.sample()}) {`,
                    `    float m${i} = ${mask};`,
                    // step() gates on the threshold; multiplying by the mask keeps
                    // FRACTIONAL segmentations proportional rather than flattening
                    // every above-threshold pixel to full strength.
                    `    float w${i} = step(segThr, m${i}) * m${i};`,
                    `    segRgb = mix(segRgb, ${colorControl.sample()}, w${i});`,
                    `    segA = max(segA, w${i});`,
                    `}`,
                );
            }

            lines.push(`return vec4(segRgb, segA);`);
            return lines.join("\n");
        }
    };
}
