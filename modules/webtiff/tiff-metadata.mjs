/**
 * Where a TIFF's channel layout comes from.
 *
 * The decoder answers this itself, so the chain is short — but it is still a
 * chain, because a source can be asked before its header is parsed and because
 * other tile sources can carry TIFF-encoded samples they only know about from a
 * server's `/info`:
 *
 *  1. `source.getTiffDescriptor()` — the decoder describing itself. Throws until
 *     the header is parsed, which is treated as "not known yet".
 *  2. a directory record from the decoder's own metadata — the same information
 *     one step lower, for a source whose descriptor getter is unavailable.
 *  3. `source.getSampleEncoding()` — the narrower `TiffSampleEncoding` contract,
 *     which WSI-Service sources implement when they negotiated
 *     `image_format=tiff`.
 *
 * Everything here is read-only probing: no fetches, no decoding.
 *
 * None of it decides *whether* this module may act on a slide. Answering one of
 * these questions does not make a source ours — ownership is settled before any
 * of this runs, by the protocol serving the slide (`ownsBackground` /
 * `ownsSource` in `index.mjs`).
 *
 * @module webtiff/tiff-metadata
 */

/**
 * @typedef {object} TiffDescriptor
 * @property {number[]} bitsPerSample
 * @property {number[]} [sampleFormat] TIFF SampleFormat per sample (1 uint, 2 int, 3 float)
 * @property {number} samplesPerPixel
 * @property {number} [photometricInterpretation]
 * @property {boolean} [hasColorMap]
 * @property {"image"|"data"} [interpretation] how the decoder packs this file
 * @property {TiffSampleEncoding} [encoding] declared per-channel scale/offset
 * @property {string[]} [channelNames]
 * @property {string[]} [channelColors]
 * @property {string} origin which chain step produced this
 */

// Tag arrays reach us as arrays, typed arrays or bare scalars depending on how
// many samples the file declares; treating a typed array as a scalar yields
// `[NaN]` and silently turns every bit depth into "unknown".
const asArray = (value, fallback) => {
    if (Array.isArray(value)) return value.slice();
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return Array.from(value);
    if (value === undefined || value === null) return fallback;
    return [value];
};

/**
 * Normalize the decoder's own descriptor (chain step 1).
 * @param {object} described return value of `getTiffDescriptor()`
 * @param {string} [origin]
 * @return {TiffDescriptor}
 */
export function describeFromDecoder(described, origin = "tileSource:getTiffDescriptor") {
    // The decoder reports channel identity per channel, on the encoding, where a
    // stacked plane carries the OME-XML `Name=`/`Color=` of the plane it came
    // from. Flattened here because that is the shape every consumer reads
    // (`auto-config.mjs` names and tints a layer from it) and the shape the
    // other two chain steps already produce.
    const channels = Array.isArray(described.encoding?.channels)
        ? described.encoding.channels : [];
    const names = described.channelNames?.length ? described.channelNames
        : (channels.some(c => c.name) ? channels.map(c => c.name) : undefined);
    const colors = described.channelColors?.length ? described.channelColors
        : (channels.some(c => c.color) ? channels.map(c => c.color) : undefined);

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
        channelNames: names,
        channelColors: colors,
        origin,
    };
}

/**
 * Descriptor from a decoder directory record (chain step 2).
 *
 * Same fields as step 1 minus the resolved interpretation, which only the
 * decoder's own descriptor reports.
 *
 * @param {object} directory an entry of `file.meta.directories`
 * @return {TiffDescriptor|undefined}
 */
export function describeFromDirectory(directory) {
    if (!directory) return undefined;
    const bitsPerSample = asArray(directory.bitsPerSample, undefined);
    if (!bitsPerSample) return undefined;

    return {
        bitsPerSample: bitsPerSample.map(Number),
        sampleFormat: asArray(directory.sampleFormat, undefined)?.map(Number),
        samplesPerPixel: Number(directory.samplesPerPixel) || bitsPerSample.length,
        photometricInterpretation: directory.photometricInterpretation !== undefined
            ? Number(directory.photometricInterpretation) : undefined,
        hasColorMap: !!directory.hasColorMap,
        interpretation: directory.interpretationAuto,
        encoding: directory.encoding,
        origin: "decoder:directory",
    };
}

/**
 * Descriptor from a {@link TiffSampleEncoding} (chain step 3) — how a
 * WSI-Service source reports what its `/info` knew.
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

    // 1) the decoder describing itself
    if (typeof source.getTiffDescriptor === "function") {
        try {
            const described = source.getTiffDescriptor();
            if (described) return describeFromDecoder(described);
        } catch (e) {
            console.debug("[webtiff] descriptor not available yet:", e?.message || e);
        }
    }

    // 2) the directory the full-resolution level came from
    const file = typeof source.getTiffFile === "function" ? source.getTiffFile() : undefined;
    const levels = file?.levels;
    const directory = levels?.length ? levels[levels.length - 1].directory : undefined;
    const described = describeFromDirectory(directory);
    if (described) return described;

    // 3) whatever the server said about the slide
    if (typeof source.getSampleEncoding === "function") {
        try {
            const encoded = describeFromSampleEncoding(source.getSampleEncoding());
            if (encoded) return encoded;
        } catch (e) {
            console.debug("[webtiff] sample encoding not available yet:", e?.message || e);
        }
    }

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
