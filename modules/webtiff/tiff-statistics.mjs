/**
 * What a TIFF's samples actually look like, as opposed to what its header claims.
 *
 * The decoder normalizes every channel against the range the file *declares* —
 * its bit depth, or `SMinSampleValue`/`SMaxSampleValue` when present. That is the
 * only honest thing a decoder can do: a scale derived from pixels would depend on
 * which tiles decoded first and would be baked into the tile cache, so the same
 * normalized value would stop meaning the same thing across the pyramid.
 *
 * The cost of that honesty is that a file which under-uses its declared range is
 * decoded correctly and displayed as a black frame — 12-bit data written into a
 * `BitsPerSample=16` container with no range tags peaks at `4095/65535`, and no
 * header distinguishes it from a genuinely dim 16-bit scene. Only the samples do.
 *
 * So the measurement lives here, on the display side, where being data-dependent
 * is safe: it seeds a shader's window controls, stays adjustable, and never
 * touches the pixels handed to the renderer.
 *
 * Cost is one read of the smallest pyramid level, through the same worker and the
 * same range-request stack as any tile.
 *
 * @module webtiff/tiff-statistics
 */

/**
 * @typedef {object} ChannelRange
 * @property {number} low  low percentile, in the decoder's normalized units
 * @property {number} high high percentile, in the decoder's normalized units
 */

/** Percentiles rather than min/max: a single hot or dead pixel must not set the window. */
const LOW_PERCENTILE = 0.001;
const HIGH_PERCENTILE = 0.999;

/** Enough for a stable percentile; beyond this the sort costs more than it informs. */
const MAX_SAMPLES = 65536;

/**
 * Above this the "overview" is not an overview.
 *
 * A file with no pyramid has exactly one level, and reading it means decoding the
 * whole slide — minutes of worker time and hundreds of megabytes of range
 * requests, to seed a control the user can drag. Refuse instead, and say so.
 */
const MAX_MEASURED_PIXELS = 32 * 1024 * 1024;

/**
 * Percentile of an unsorted typed array, ignoring non-finite samples.
 * @param {ArrayLike<number>} values
 * @param {number} lowQuantile
 * @param {number} highQuantile
 * @return {{low: number, high: number}|undefined}
 */
function percentiles(values, lowQuantile, highQuantile) {
    const total = values.length;
    if (!total) return undefined;

    // Regular stride rather than random sampling: reproducible across opens, and
    // on an overview level a gradient is as well covered either way.
    const stride = Math.max(1, Math.ceil(total / MAX_SAMPLES));
    const sample = [];
    for (let i = 0; i < total; i += stride) {
        const value = Number(values[i]);
        if (Number.isFinite(value)) sample.push(value);
    }
    if (!sample.length) return undefined;

    sample.sort((a, b) => a - b);
    const at = (quantile) => sample[Math.min(sample.length - 1,
        Math.max(0, Math.round(quantile * (sample.length - 1))))];
    return { low: at(lowQuantile), high: at(highQuantile) };
}

/**
 * Measure each channel's occupied range, expressed in the units the shader sees.
 *
 * Read as `tiffRaster`, not as packed textures: the bands are the file's own
 * sample values, which is what the encoding's `scale`/`offset` are defined
 * against. Packs are already normalized and would answer a different question.
 *
 * @param {object} file a ready `TiffFile`
 * @param {object} descriptor from `tiff-metadata.mjs`
 * @return {Promise<ChannelRange[]|undefined>} one entry per channel, or undefined
 *      when the slide cannot be measured (no overview, read failure, too large)
 */
export async function measureChannelRanges(file, descriptor) {
    // `levels` is ascending by width, so [0] is the overview.
    const level = file?.levels?.[0];
    if (!level || typeof file.readRegion !== "function") return undefined;

    const pixels = level.width * level.height;
    if (pixels > MAX_MEASURED_PIXELS) {
        console.debug(`[webtiff] smallest level is ${level.width}×${level.height}; ` +
            "skipping the range measurement (no usable overview — is the file pyramidal?)");
        return undefined;
    }

    let bands;
    try {
        ({ bands } = await file.readRegion({
            dir: level.dir,
            subifd: level.subifd,
            // Every directory the level's channels live in. Without it a plane
            // stack measures plane 0 alone, `buildAutoShaders` gets one range for
            // an N-channel descriptor, and every channel but the first opens with
            // no window — the exact slides `autoWindow: "rescue"` exists for.
            planes: level.planes,
            x0: 0,
            y0: 0,
            x1: level.width,
            y1: level.height,
            output: "tiffRaster",
        }));
    } catch (e) {
        console.debug("[webtiff] could not read the overview level for statistics:", e?.message || e);
        return undefined;
    }
    if (!bands || !bands.length) return undefined;

    const channels = descriptor?.encoding?.channels;
    const ranges = [];
    for (let i = 0; i < bands.length; i++) {
        const measured = percentiles(bands[i].data, LOW_PERCENTILE, HIGH_PERCENTILE);
        if (!measured) return undefined;

        // Raw samples -> the decoder's normalized units, so the numbers are
        // directly comparable with what the shader receives. The band reports
        // which logical channel it carries; without an encoding the raw values
        // are already what reaches the shader.
        const encoding = channels?.[bands[i].channel >= 0 ? bands[i].channel : i] || channels?.[0];
        const scale = Number(encoding?.scale) || 1;
        const offset = Number(encoding?.offset) || 0;
        ranges.push({
            low: (measured.low - offset) / scale,
            high: (measured.high - offset) / scale,
        });
    }
    return ranges;
}
