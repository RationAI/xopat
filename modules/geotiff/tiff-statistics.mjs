/**
 * What a TIFF's samples actually look like, as opposed to what its header claims.
 *
 * The decoder normalizes every channel against the range the file *declares* —
 * its bit depth, or `SMinSampleValue`/`SMaxSampleValue` when present. That is the
 * only honest thing a decoder can do: a guess derived from pixels would change
 * with which tiles happened to decode first and would be baked into the tile
 * cache, so the same normalized value would stop meaning the same thing across
 * the pyramid.
 *
 * The cost of that honesty is that a file which under-uses its declared range is
 * decoded correctly and displayed as a black frame — 12-bit data written into a
 * `BitsPerSample=16` container with no range tags peaks at `4095/65535`, and no
 * header distinguishes it from a genuinely dim 16-bit scene. Only the samples do.
 *
 * So the measurement lives here, on the display side, where it is allowed to be
 * data-dependent: it seeds a shader's window controls, stays adjustable, and
 * never touches the pixels handed to the renderer.
 *
 * Cost is one read of the smallest pyramid level — for a typical pyramid a single
 * tile, fetched through the same range-request stack as everything else and then
 * cached by geotiff.js.
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
 * Percentile of an unsorted typed array, ignoring non-finite samples.
 * @param {ArrayLike<number>} values
 * @param {number} lowQuantile
 * @param {number} highQuantile
 * @return {{low: number, high: number}|undefined}
 */
function percentiles(values, lowQuantile, highQuantile) {
    const total = values.length;
    if (!total) return undefined;

    // Regular stride rather than random sampling: reproducible across opens, and on
    // an overview level a gradient is as well covered either way.
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
 * @param {object} source a ready `GeoTIFFTileSource`
 * @param {object} descriptor from `tiff-metadata.mjs`
 * @return {Promise<ChannelRange[]|undefined>} one entry per channel, or undefined
 *      when the source cannot be measured (no overview level, read failure, a
 *      server-tiled source with no client-side header)
 */
export async function measureChannelRanges(source, descriptor) {
    const image = source?.levels?.[0]?.image;
    // `levels` is sorted ascending by width (`setupLevels`), so [0] is the overview.
    if (!image || typeof image.readRasters !== "function") return undefined;

    let rasters;
    try {
        rasters = await image.readRasters();
    } catch (e) {
        console.debug("[geotiff] could not read the overview level for statistics:", e?.message || e);
        return undefined;
    }
    if (!rasters || !rasters.length) return undefined;

    const channels = descriptor?.encoding?.channels;
    const ranges = [];
    for (let i = 0; i < rasters.length; i++) {
        const measured = percentiles(rasters[i], LOW_PERCENTILE, HIGH_PERCENTILE);
        if (!measured) return undefined;

        // Raw samples -> the decoder's normalized units, so the numbers are directly
        // comparable with what the shader receives. Without an encoding the raw values
        // are already what reaches it.
        const encoding = channels?.[i] || channels?.[0];
        const scale = Number(encoding?.scale) || 1;
        const offset = Number(encoding?.offset) || 0;
        ranges.push({
            low: (measured.low - offset) / scale,
            high: (measured.high - offset) / scale,
        });
    }
    return ranges;
}
