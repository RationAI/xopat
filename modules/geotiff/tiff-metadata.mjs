/**
 * Where a TIFF's channel layout comes from.
 *
 * TIFF pixels reach xOpat by more than one route and each knows a different
 * amount up front, so this is a chain rather than a single lookup:
 *
 *  1. `source.getTiffDescriptor()` — the decoder describing itself. This is the
 *     normal path for a GeoTIFF source, and the only one that reports the
 *     resolved image/data interpretation.
 *  2. the GeoTIFF source's raw `fileDirectory` — a fallback for a build that
 *     predates (1), or for a source whose header is readable but whose
 *     descriptor throws.
 *  3. `source.getSampleEncoding()` — the narrower contract, for a source that
 *     never sees a TIFF header client-side and can only report what its `/info`
 *     said about the slide.
 *  4. the first decoded tile — the last resort, and the only option for a
 *     server-tiled TIFF whose `/info` says nothing about bit depth.
 *
 * Everything here is read-only probing: no fetches, no decoding.
 *
 * None of it decides *whether* this module may act on a slide — answering one of
 * these questions does not make a source ours. Ownership is settled before any of
 * this runs, by the protocol serving the slide (`ownsBackground` / `ownsSource` in
 * `index.mjs`).
 */

/**
 * @typedef {object} TiffDescriptor
 * @property {number[]} bitsPerSample
 * @property {number[]} [sampleFormat] TIFF SampleFormat per sample (1 uint, 2 int, 3 float)
 * @property {number} samplesPerPixel
 * @property {number} [photometricInterpretation]
 * @property {boolean} [hasColorMap]
 * @property {"image"|"data"} [interpretation] how the decoder will pack this file
 * @property {TiffSampleEncoding} [encoding] declared per-channel scale/offset
 * @property {string[]} [channelNames]
 * @property {string[]} [channelColors]
 * @property {string} origin which chain step produced this
 */

// geotiff.js hands back TIFF tag arrays as TypedArrays (`BitsPerSample` is a
// Uint16Array), which `Array.isArray` rejects — treating one as a scalar yields
// `[NaN]` and silently turns every bit depth into "unknown".
const asArray = (value, fallback) => {
    if (Array.isArray(value)) return value.slice();
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return Array.from(value);
    if (value === undefined || value === null) return fallback;
    return [value];
};

/**
 * Normalize the decoder's own descriptor (chain step 1) into the shape this
 * module uses. Only the field names differ.
 * @param {object} described return value of `getTiffDescriptor()`
 * @return {TiffDescriptor}
 */
export function describeFromDecoder(described) {
    return {
        bitsPerSample: asArray(described.bitsPerSample, [8]).map(Number),
        sampleFormat: asArray(described.sampleFormat, undefined)?.map(Number),
        samplesPerPixel: Number(described.samplesPerPixel)
            || asArray(described.bitsPerSample, [8]).length,
        photometricInterpretation: described.photometricInterpretation !== undefined
            ? Number(described.photometricInterpretation) : undefined,
        hasColorMap: !!described.hasColorMap,
        interpretation: described.interpretationResolved,
        encoding: described.encoding,
        channelNames: described.channelNames?.length ? described.channelNames : undefined,
        channelColors: described.channelColors?.length ? described.channelColors : undefined,
        origin: "tileSource:getTiffDescriptor",
    };
}

/**
 * Descriptor from a geotiff.js `fileDirectory` (chain step 2). Carries no
 * interpretation: only the decoder knows how it will pack the file.
 * @param {object} fd
 * @param {string} [origin]
 * @return {TiffDescriptor|undefined}
 */
export function describeFromFileDirectory(fd, origin = "geotiff:fileDirectory") {
    if (!fd) return undefined;

    const bitsPerSample = asArray(fd.BitsPerSample, undefined);
    if (!bitsPerSample) return undefined;

    return {
        bitsPerSample: bitsPerSample.map(Number),
        sampleFormat: asArray(fd.SampleFormat, undefined)?.map(Number),
        samplesPerPixel: Number(fd.SamplesPerPixel) || bitsPerSample.length,
        photometricInterpretation: fd.PhotometricInterpretation !== undefined
            ? Number(fd.PhotometricInterpretation) : undefined,
        hasColorMap: !!fd.ColorMap,
        origin,
    };
}

/**
 * Descriptor from a decoded `tiffRaster` (chain step 4). Authoritative — just
 * late, since it only exists once a tile has come back.
 * @param {object} raster
 * @return {TiffDescriptor|undefined}
 */
export function describeFromTiffRaster(raster) {
    if (!raster || !raster.bitsPerSample) return undefined;

    const bitsPerSample = asArray(raster.bitsPerSample, [8]).map(Number);
    return {
        bitsPerSample,
        sampleFormat: asArray(raster.sampleFormat, undefined)?.map(Number),
        samplesPerPixel: Number(raster.samplesPerPixel) || bitsPerSample.length,
        photometricInterpretation: raster.photometricInterpretation !== undefined
            ? Number(raster.photometricInterpretation) : undefined,
        hasColorMap: !!raster.colorMap,
        origin: "tile:tiffRaster",
    };
}

/**
 * Descriptor from a {@link TiffSampleEncoding} (chain step 3) — how WSI-Service
 * sources report what their `/info` knew.
 * @param {TiffSampleEncoding} encoding
 * @return {TiffDescriptor|undefined}
 */
export function describeFromSampleEncoding(encoding) {
    if (!encoding || !Array.isArray(encoding.channels) || !encoding.channels.length) return undefined;

    const channels = encoding.channels;
    return {
        bitsPerSample: channels.map(c => Number(c.bits) || 8),
        sampleFormat: channels.map(c => Number(c.sampleFormat) || 1),
        samplesPerPixel: channels.length,
        // `/info` reports channels, never a photometric tag; let the channel
        // count speak instead of inventing an interpretation.
        photometricInterpretation: undefined,
        interpretation: encoding.interpretation,
        encoding,
        channelNames: channels.some(c => c.name) ? channels.map(c => c.name) : undefined,
        channelColors: channels.some(c => c.color) ? channels.map(c => c.color) : undefined,
        origin: encoding.origin || "tileSource:getSampleEncoding",
    };
}

/**
 * Walk the resolution chain for a tile source.
 * @param {object} source an OpenSeadragon TileSource
 * @return {TiffDescriptor|undefined} undefined when nothing knows yet
 */
export function describeTileSource(source) {
    if (!source) return undefined;

    // 1) the decoder describing itself. It throws while the header is unread
    // rather than returning a guess — treat that as "not known yet".
    if (typeof source.getTiffDescriptor === "function") {
        try {
            const described = source.getTiffDescriptor();
            if (described) return describeFromDecoder(described);
        } catch (e) {
            console.debug("[geotiff] descriptor not available yet:", e?.message || e);
        }
    }

    // 2) raw header tags
    const level = Array.isArray(source.levels) && source.levels.length
        ? source.levels[source.levels.length - 1] : undefined;
    const image = level && level.image;
    if (image) {
        const fd = typeof image.getFileDirectory === "function"
            ? image.getFileDirectory() : image.fileDirectory;
        const described = describeFromFileDirectory(fd);
        if (described) {
            // QPTIFF-style sources are split one channel per source and carry
            // their own name/colour; surface it so the fan-out can tint them.
            if (source.channel && source.channel.name) {
                described.channelNames = [source.channel.name];
                if (source.channel.color) described.channelColors = [source.channel.color];
            }
            return described;
        }
    }

    // 3) whatever the server said about the slide
    if (typeof source.getSampleEncoding === "function") {
        try {
            const described = describeFromSampleEncoding(source.getSampleEncoding());
            if (described) return described;
        } catch (e) {
            console.debug("[geotiff] sample encoding not available yet:", e?.message || e);
        }
    }

    // 4) caller falls back to the observed-tile path
    return undefined;
}

/**
 * Whether two descriptors would produce a different shader choice. Ignores
 * cosmetic fields like channel names.
 * @param {TiffDescriptor} [a]
 * @param {TiffDescriptor} [b]
 * @return {boolean}
 */
export function descriptorsDiffer(a, b) {
    if (!a || !b) return a !== b;
    const key = d => JSON.stringify([
        d.samplesPerPixel,
        // Decides which packing rules apply, so it decides the render.
        d.interpretation || null,
    ]);
    return key(a) !== key(b);
}
