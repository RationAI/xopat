/**
 * Pixel-level image work: encoding, decoding, and the built-in tissue detector.
 *
 * Free of viewer and driver references. The canvas-backed helpers need a DOM, but
 * nothing here needs a slide, a renderer or a model, so the statistical parts
 * (`otsuThreshold`, `builtinTissueMask`) are testable on synthetic pixel buffers.
 */

import type { MaskResult } from "./types";

/** PNG blob → base64 (no data-URL prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/** Decode a `{ binary_mask (base64), width, height }` segmentation response. */
export function decodeBase64Mask(data: any): MaskResult {
    const binaryStr = atob(data.binary_mask);
    const binaryMask = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        binaryMask[i] = binaryStr.charCodeAt(i);
    }
    return { binaryMask, width: data.width, height: data.height, label: data.label, score: data.score };
}

/**
 * An `ImageData` holding `pixels`, allocated by the context rather than constructed.
 *
 * `new ImageData(buffer, w, h)` does not type-check against a `Uint8ClampedArray` whose
 * buffer is `ArrayBufferLike` (it may be a `SharedArrayBuffer`, which the DOM signature
 * excludes) — and the rasters here come from a renderer that makes no such promise.
 * `createImageData` + `set` copies into a buffer the context owns, which is both correct
 * and honest about the copy.
 */
export function toImageData(
    ctx: CanvasRenderingContext2D,
    pixels: Uint8ClampedArray | number[],
    width: number,
    height: number
): ImageData {
    const image = ctx.createImageData(width, height);
    image.data.set(pixels instanceof Uint8ClampedArray ? pixels : new Uint8ClampedArray(pixels));
    return image;
}

/** RGBA pixels → PNG blob. */
export function pixelsToPngBlob(pixels: Uint8ClampedArray | number[], width: number, height: number): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.putImageData(toImageData(ctx, pixels, width, height), 0, 0);
    return new Promise((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Failed to encode the background image."))), "image/png")
    );
}

/** Otsu's method: the between-class-variance-maximizing threshold of a 0..255 histogram. */
export function otsuThreshold(values: Uint8Array): number {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < values.length; i++) hist[values[i]]++;
    const total = values.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, maxVar = 0, threshold = 0;
    for (let th = 0; th < 256; th++) {
        wB += hist[th];
        if (wB === 0) continue;
        const wF = total - wB;
        if (wF === 0) break;
        sumB += th * hist[th];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > maxVar) { maxVar = between; threshold = th; }
    }
    return threshold;
}

/**
 * Dependency-free tissue detector over RGBA pixels. On a brightfield (e.g. H&E)
 * slide the glass background is bright and unsaturated while stained tissue is
 * coloured; so we threshold the HSV **saturation** channel with an adaptive Otsu
 * cut and drop near-white pixels. A statistical approximation — good enough to
 * bootstrap masks/coverage, overridable by a real `tissue-mask` driver.
 */
export function builtinTissueMask(pixels: Uint8ClampedArray | number[], width: number, height: number): MaskResult {
    const n = width * height;
    const sat = saturationChannel(pixels, n);
    const satCut = otsuThreshold(sat);
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        if (sat[i] > satCut && luma < 240) mask[i] = 1;
    }
    return { binaryMask: mask, width, height, label: "tissue" };
}

/**
 * HSV saturation per pixel, 0..255.
 *
 * Split out of {@link builtinTissueMask} because it is also the fallback intensity
 * signal wherever colour deconvolution is meaningless (fluorescence, unstained).
 */
export function saturationChannel(pixels: Uint8ClampedArray | number[], count: number): Uint8Array {
    const sat = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
        const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        sat[i] = max === 0 ? 0 : Math.round(((max - min) / max) * 255);
    }
    return sat;
}

// ---- montage ---------------------------------------------------------------

/** One cell of a montage: a rendered field plus the name it will be labelled with. */
export interface MontageCell {
    width: number;
    height: number;
    pixels: Uint8ClampedArray | number[];
    /** Grid label drawn on the cell (`A1`, `B3`, …). Coordinates, not translatable prose. */
    cellLabel: string;
}

export interface MontageLayout {
    cols: number;
    rows: number;
    /** Side of each cell's image area, in composite pixels. */
    cellPixels: number;
    /** Height of the label strip above each cell. */
    labelBand: number;
    gutter: number;
}

/** `A1`, `B2`, … — row letter, column number, both 1-based as a reader counts. */
export function montageCellLabel(index: number, cols: number): string {
    const row = Math.floor(index / cols);
    const col = index % cols;
    return `${String.fromCharCode(65 + (row % 26))}${col + 1}`;
}

/**
 * Choose a grid and a cell size that fit `count` fields inside a pixel budget.
 *
 * Pure, so the sizing is testable without a canvas. Cells shrink rather than the
 * montage growing: the composite has to stay inside one request body, and a model
 * downsamples whatever it is sent anyway.
 */
export function planMontageLayout(
    count: number,
    opts?: { cols?: number; cellPixels?: number; labelBand?: number; gutter?: number; maxPixels?: number }
): MontageLayout {
    const n = Math.max(1, count);
    const cols = Math.max(1, opts?.cols ?? Math.ceil(Math.sqrt(n)));
    const rows = Math.ceil(n / cols);
    const labelBand = opts?.labelBand ?? 24;
    const gutter = opts?.gutter ?? 2;
    const maxPixels = opts?.maxPixels ?? 4_000_000;

    let cellPixels = Math.max(128, Math.min(768, opts?.cellPixels ?? 512));
    // Shrink until the whole composite fits. Solved by iteration rather than algebra
    // because the label band and gutters make the relationship awkward, and this runs
    // a handful of times at most.
    while (cellPixels > 128) {
        const width = cols * (cellPixels + gutter);
        const height = rows * (cellPixels + labelBand + gutter);
        if (width * height <= maxPixels) break;
        cellPixels = Math.floor(cellPixels * 0.8);
    }
    return { cols, rows, cellPixels: Math.max(128, cellPixels), labelBand, gutter };
}

/**
 * Composite several separately-rendered fields into ONE image for a single vision call.
 *
 * The point is the ratio: N renders, one model call. Triaging a dozen candidate regions
 * individually costs a dozen calls out of a budget of twenty-eight; as a montage it costs
 * one, and the model additionally sees the fields side by side, which is the only way it
 * can say "this one is unlike the others" at all.
 *
 * Three composition choices exist to stop the model reading the montage as a scene:
 *
 * - **Cells are letterboxed, never stretched.** A distorted field invites shape-based
 *   claims about tissue that is not that shape.
 * - **A flat gutter separates them,** so "do not read structures across cell borders" is
 *   visually true and not merely asserted in the prompt.
 * - **Every cell carries its grid label in the image**, so the model's answer can be tied
 *   back to a region rather than to a position it might have miscounted.
 */
export async function composeMontage(
    cells: MontageCell[],
    layout: MontageLayout,
    style?: { background?: string; gutterColor?: string; labelColor?: string; font?: string }
): Promise<{ blob: Blob; width: number; height: number }> {
    if (!cells.length) throw new Error("composeMontage requires at least one cell.");

    const { cols, rows, cellPixels, labelBand, gutter } = layout;
    const width = cols * (cellPixels + gutter) + gutter;
    const height = rows * (cellPixels + labelBand + gutter) + gutter;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

    ctx.fillStyle = style?.gutterColor ?? "#2b2b2b";
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = gutter + col * (cellPixels + gutter);
        const y = gutter + row * (cellPixels + labelBand + gutter);

        ctx.fillStyle = style?.labelColor ?? "#ffffff";
        ctx.font = style?.font ?? `${Math.round(labelBand * 0.7)}px sans-serif`;
        ctx.textBaseline = "middle";
        ctx.fillText(cell.cellLabel, x + 4, y + labelBand / 2);

        const imageY = y + labelBand;
        ctx.fillStyle = style?.background ?? "#000000";
        ctx.fillRect(x, imageY, cellPixels, cellPixels);

        const bitmap = await createImageBitmap(toImageData(ctx, cell.pixels, cell.width, cell.height));
        try {
            // Fit inside the cell, preserving aspect — the letterbox is deliberate.
            const scale = Math.min(cellPixels / cell.width, cellPixels / cell.height);
            const w = Math.max(1, Math.round(cell.width * scale));
            const h = Math.max(1, Math.round(cell.height * scale));
            ctx.drawImage(bitmap, x + (cellPixels - w) / 2, imageY + (cellPixels - h) / 2, w, h);
        } finally {
            bitmap.close?.();
        }
    }

    const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Failed to encode the montage."))), "image/png")
    );
    return { blob, width, height };
}

// ---- colour deconvolution --------------------------------------------------
//
// Where the tissue is DENSE IN NUCLEI is the single best free prior for where a
// vision budget should be spent, and it is obtainable without a model: the nuclear
// counterstain has its own colour, so unmixing the image by stain recovers roughly
// how much of it is present per pixel.
//
// This is a deliberately generic mechanism. The vectors below are a COLOUR BASIS,
// not a clinical vocabulary — a deployment whose stain is not in this basis overrides
// them rather than patching the module, and a stain class where unmixing is
// meaningless (fluorescence, unstained) falls back to saturation instead.

/** Absorbance vectors of a stain basis, in RGB. Rows are normalized before use. */
export interface StainVectors {
    /** The nuclear counterstain — the channel {@link stainConcentration} returns. */
    nuclear: [number, number, number];
    /** The counter-stain. */
    counter: [number, number, number];
    /** A third vector completing the basis; the residual when omitted. */
    third?: [number, number, number];
}

/**
 * Ruifrok–Johnston H&E–DAB basis, the standard reference values.
 *
 * `nuclear` is haematoxylin. Overridable per deployment via the module's
 * `stainVectors` static meta so a non-H&E slide is a configuration change, not a fork.
 */
export const DEFAULT_STAIN_VECTORS: StainVectors = {
    nuclear: [0.650, 0.704, 0.286],
    counter: [0.072, 0.990, 0.105],
    third: [0.268, 0.570, 0.776],
};

/** `-log10((i + 1) / 256)` for every byte value — the optical density of one channel. */
const OD_LUT = (() => {
    const lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) lut[i] = -Math.log10((i + 1) / 256);
    return lut;
})();

/**
 * Per-pixel concentration of the NUCLEAR stain, via Beer–Lambert unmixing.
 *
 * Optical density is linear in stain concentration, and the observed OD of a pixel is
 * the sum of each stain's OD vector scaled by how much of it is there. Inverting the
 * basis therefore recovers the concentrations. Projecting onto the haematoxylin vector
 * instead — the tempting one-liner — does not: eosin has a large component along it, so
 * the "nuclear" signal would rise with any densely stained tissue, which is the opposite
 * of a discriminating prior.
 *
 * Returns raw concentrations (unbounded, typically 0..2); {@link densityGrid} normalizes.
 */
export function stainConcentration(
    pixels: Uint8ClampedArray | number[],
    count: number,
    vectors: StainVectors = DEFAULT_STAIN_VECTORS
): Float32Array {
    const inv = invertStainBasis(vectors);
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const od0 = OD_LUT[pixels[i * 4] & 255];
        const od1 = OD_LUT[pixels[i * 4 + 1] & 255];
        const od2 = OD_LUT[pixels[i * 4 + 2] & 255];
        // Only the nuclear row of the inverse is needed — the other concentrations are
        // computed by nobody and would be two more multiply-adds per pixel over 2 MP.
        out[i] = Math.max(0, od0 * inv[0] + od1 * inv[1] + od2 * inv[2]);
    }
    return out;
}

/**
 * Reduce a per-pixel signal to a coarse grid of block means, normalized 0..1.
 *
 * Normalization is against the 95th percentile rather than the maximum: a few saturated
 * blocks (a fold, an ink mark, a dust particle) would otherwise compress the whole slide
 * into the bottom of the range and flatten exactly the contrast this prior exists to
 * provide. `mask`, when given, restricts each block's mean to tissue pixels, so a block
 * that is mostly glass is not scored down for the glass.
 */
export function densityGrid(
    signal: Float32Array,
    width: number,
    height: number,
    cell: number,
    mask?: Uint8Array
): { values: Float32Array; width: number; height: number } {
    const size = Math.max(1, Math.floor(cell));
    const gw = Math.max(1, Math.ceil(width / size));
    const gh = Math.max(1, Math.ceil(height / size));
    const values = new Float32Array(gw * gh);

    for (let gy = 0; gy < gh; gy++) {
        const y0 = gy * size, y1 = Math.min(height, y0 + size);
        for (let gx = 0; gx < gw; gx++) {
            const x0 = gx * size, x1 = Math.min(width, x0 + size);
            let sum = 0, n = 0;
            for (let y = y0; y < y1; y++) {
                const row = y * width;
                for (let x = x0; x < x1; x++) {
                    if (mask && !mask[row + x]) continue;
                    sum += signal[row + x];
                    n++;
                }
            }
            values[gy * gw + gx] = n ? sum / n : 0;
        }
    }

    const p95 = percentile(values, 0.95);
    if (p95 > 0) {
        for (let i = 0; i < values.length; i++) values[i] = Math.min(1, values[i] / p95);
    } else {
        values.fill(0);
    }
    return { values, width: gw, height: gh };
}

/** The `q`-quantile of `values` (0..1), ignoring zeros so empty blocks cannot set the scale. */
function percentile(values: Float32Array, q: number): number {
    const nonZero: number[] = [];
    for (let i = 0; i < values.length; i++) if (values[i] > 0) nonZero.push(values[i]);
    if (!nonZero.length) return 0;
    nonZero.sort((a, b) => a - b);
    return nonZero[Math.min(nonZero.length - 1, Math.floor(q * nonZero.length))];
}

/** The nuclear row of the inverted stain basis. */
function invertStainBasis(vectors: StainVectors): [number, number, number] {
    const n = normalize(vectors.nuclear);
    const c = normalize(vectors.counter);
    // Without a third vector the basis is rank-deficient and cannot be inverted. The
    // standard completion is the residual direction: whatever is orthogonal to both.
    const third = vectors.third ? normalize(vectors.third) : normalize(cross(n, c));

    const m: number[][] = [n, c, third];
    const det =
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
        m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
        m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) {
        // A degenerate basis (two parallel vectors) is a configuration error. Fall back to
        // the projection: worse as a prior, but a number rather than a NaN raster.
        return [n[0], n[1], n[2]];
    }
    // First COLUMN of the inverse — concentrations are `OD · M⁻¹`, so the nuclear
    // concentration is the dot product of OD with that column.
    return [
        (m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det,
        (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / det,
        (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det,
    ];
}

function normalize(v: [number, number, number] | number[]): [number, number, number] {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: number[], b: number[]): [number, number, number] {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}
