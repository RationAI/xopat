/// <reference path="../../src/types/globals.d.ts" />

/**
 * Colour maps for EMPAIA pixelmap overlays.
 *
 * Continuous / discrete pixelmaps carry raw scalar values; the reference AppUI
 * maps them client-side through a `(t: number) => string` colour function
 * (`libs/pixelmap-rendering-collection`). We do the same, but resolve to packed
 * RGBA integers instead of CSS strings so a whole tile can be written in one
 * `ImageData` pass rather than one `fillRect` per run.
 *
 * Each map is defined by a handful of control points and linearly interpolated
 * into a 256-entry lookup table, built once per map on first use.
 */

export type Rgb = [number, number, number];

/** Control points at evenly spaced positions across `t ∈ [0,1]`. */
const CONTROL_POINTS: Record<string, Rgb[]> = {
    // Perceptually uniform, the sensible default for quantitative overlays.
    viridis: [
        [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142],
        [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89],
        [180, 222, 44], [253, 231, 37],
    ],
    magma: [
        [0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129],
        [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135],
        [252, 253, 191],
    ],
    inferno: [
        [0, 0, 4], [31, 12, 72], [85, 15, 109], [136, 34, 106],
        [186, 54, 85], [227, 89, 51], [249, 140, 10], [249, 201, 50],
        [252, 255, 164],
    ],
    // Classic rainbow. Poor perceptual uniformity, but pathologists ask for it.
    jet: [
        [0, 0, 131], [0, 60, 170], [5, 255, 255], [255, 255, 0],
        [250, 0, 0], [128, 0, 0],
    ],
    hot: [[0, 0, 0], [230, 0, 0], [255, 210, 0], [255, 255, 255]],
    cool: [[0, 255, 255], [255, 0, 255]],
    grayscale: [[0, 0, 0], [255, 255, 255]],
    // Diverging — pair with a neutral value in the middle of the range.
    redblue: [[5, 48, 97], [146, 197, 222], [247, 247, 247], [244, 165, 130], [103, 0, 31]],
};

export const COLOR_MAP_IDS = Object.keys(CONTROL_POINTS);
export const DEFAULT_COLOR_MAP = "viridis";

const LUT_SIZE = 256;
const _lutCache = new Map<string, Uint8Array>();

/**
 * 256×3 lookup table for a named map. Unknown names fall back to the default
 * rather than throwing — the name can reach us from a persisted UI preference.
 */
export function colorMapLut(name: string): Uint8Array {
    const id = CONTROL_POINTS[name] ? name : DEFAULT_COLOR_MAP;
    const cached = _lutCache.get(id);
    if (cached) return cached;

    const points = CONTROL_POINTS[id];
    const lut = new Uint8Array(LUT_SIZE * 3);
    const segments = points.length - 1;
    for (let i = 0; i < LUT_SIZE; i++) {
        const t = segments === 0 ? 0 : (i / (LUT_SIZE - 1)) * segments;
        const lower = Math.min(Math.floor(t), segments);
        const upper = Math.min(lower + 1, segments);
        const frac = t - lower;
        const a = points[lower];
        const b = points[upper];
        lut[i * 3] = Math.round(a[0] + (b[0] - a[0]) * frac);
        lut[i * 3 + 1] = Math.round(a[1] + (b[1] - a[1]) * frac);
        lut[i * 3 + 2] = Math.round(a[2] + (b[2] - a[2]) * frac);
    }
    _lutCache.set(id, lut);
    return lut;
}

/**
 * Stable categorical palette for nominal pixelmaps and class values the EAD
 * gives no rendering hint for. Deterministic in the index, so the same class
 * keeps the same colour between reloads.
 */
const CATEGORICAL: Rgb[] = [
    [31, 119, 180], [255, 127, 14], [44, 160, 44], [214, 39, 40],
    [148, 103, 189], [140, 86, 75], [227, 119, 194], [127, 127, 127],
    [188, 189, 34], [23, 190, 207],
];

export function categoricalColor(index: number): Rgb {
    const i = ((index % CATEGORICAL.length) + CATEGORICAL.length) % CATEGORICAL.length;
    return CATEGORICAL[i];
}

/**
 * Parse a CSS colour to RGB. Accepts `#rgb`, `#rrggbb`, `rgb(r,g,b)` and
 * `rgba(r,g,b,a)` — the forms EMPAIA rendering hints actually use. Returns
 * undefined for anything else rather than guessing, so the caller can fall
 * back to the categorical palette.
 */
export function parseCssColor(value: unknown): Rgb | undefined {
    if (typeof value !== "string") return undefined;
    const v = value.trim();

    const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
        const h = hex[1];
        if (h.length === 3) {
            return [
                parseInt(h[0] + h[0], 16),
                parseInt(h[1] + h[1], 16),
                parseInt(h[2] + h[2], 16),
            ];
        }
        return [
            parseInt(h.slice(0, 2), 16),
            parseInt(h.slice(2, 4), 16),
            parseInt(h.slice(4, 6), 16),
        ];
    }

    const rgb = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*[\d.]+\s*)?\)$/i);
    if (rgb) {
        const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
        return [clamp(parseFloat(rgb[1])), clamp(parseFloat(rgb[2])), clamp(parseFloat(rgb[3]))];
    }
    return undefined;
}

export function rgbToCss([r, g, b]: Rgb): string {
    return `rgb(${r}, ${g}, ${b})`;
}
