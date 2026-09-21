/**
 * Ambient types owned by the `webtiff` module.
 *
 * TIFF sample semantics are this module's business, not the core's: the core only
 * knows that a tile source may declare `_dataFormat` (which OSD data type its
 * tile responses are). Everything about bit depths, sample formats and how a
 * stored texel maps back to a measured value lives here, next to the decoder and
 * the shaders that consume it.
 *
 * Any tile source that can deliver TIFF pixels — this module's, or a WSI-Service
 * source asked for `image_format=tiff` — may implement
 * `getSampleEncoding(): TiffSampleEncoding | undefined` to describe what it
 * delivers. That is a convention this module consumes; sources implement it
 * without depending on this module.
 *
 * The names are shared with the (deprecated) `geotiff` module on purpose: the
 * contract is the same one, so a source written against either keeps working.
 */

/**
 * Per-channel encoding of the samples a tile source delivers.
 *
 * The producer hands the GPU normalized samples, so `real = stored * scale +
 * offset` turns a texel back into the value in the file's own units. Nothing in
 * the render path needs that inverse — it is for quantitative readout.
 */
interface TiffSampleEncodingChannel {
    /** Bits per sample as declared by the format (8, 12, 16, 32, …). */
    bits: number;
    /** TIFF SampleFormat semantics: 1 = unsigned int, 2 = signed int, 3 = IEEE float. */
    sampleFormat: 1 | 2 | 3;
    scale: number;
    offset: number;
    signed?: boolean;
    /** Human label, when the format names its channels (fluorescence, QPTIFF). */
    name?: string;
    /** Suggested display color as `#rrggbb`, when the format declares one. */
    color?: string;
}

/**
 * What a tile source returns from `getSampleEncoding()`.
 *
 * `version` is the producer contract: `1` means every channel reaches the GPU
 * normalized to `[0,1]` (`[-1,1]` when `signed`), which is what lets ordinary
 * shaders render TIFF data with no format knowledge. `0` is the pre-contract
 * shape — samples in the file's own range, consumer normalizes.
 */
interface TiffSampleEncoding {
    version: 0 | 1;
    channels: TiffSampleEncodingChannel[];
    /** TIFF PhotometricInterpretation when known (0 WhiteIsZero, 1 BlackIsZero, 2 RGB, 3 Palette, …). */
    photometricInterpretation?: number;
    /** `"image"` = display-ready colour, `"data"` = quantitative channels. */
    interpretation?: "image" | "data";
    /** Which producer built this — the first thing to check when a render looks wrong. */
    origin?: string;
}

/**
 * One packed texture layer. Four lanes of one texture-array layer; `channels`
 * says which logical channel each lane carries, `-1` for padding.
 */
interface WebTiffPack {
    format: "RGBA8" | "RGBA16F";
    data: Uint8Array | Uint16Array;
    channels: number[];
    normalized: boolean;
    scale: number[];
    offset: number[];
}

/**
 * What the decoder reports about the file behind a tile source. Returned by
 * `WebTiffTileSource.getTiffDescriptor()`, which throws until the header is read.
 */
interface WebTiffDescriptor {
    width: number;
    height: number;
    samplesPerPixel: number;
    bitsPerSample: number[] | number;
    sampleFormat?: number[] | number;
    photometricInterpretation?: number;
    hasColorMap?: boolean;
    channels: number[];
    /** How the decoder will pack this file, resolved from the tags. */
    interpretationResolved: "image" | "data";
    encoding: TiffSampleEncoding;
}

/**
 * One thing the decoder wants to say about a file it is reading.
 *
 * Not every entry is a problem: `severity` distinguishes a decision that is
 * correct and worth naming (a plane stack read as channels — `info`) from
 * something that went wrong (`warn`). Reporting the first class as warnings is
 * what makes the second class unreadable, so consumers must branch on it.
 *
 * `file` is the decoder's own handle id, stable for the lifetime of one open
 * file and shared with the read path; `label` is the human name for it (the last
 * path segment, unless the open supplied one). Both exist so a message can say
 * *which* slide it is about when several are open.
 *
 * Stringifies to `message`, so joining or interpolating a list of these reads
 * exactly as it did when they were plain strings.
 */
interface WebTiffDiagnostic {
    /** Stable identifier for the condition, e.g. `layout_stack`. Dedupe on this. */
    code: string;
    message: string;
    severity: "info" | "warn";
    /** Decoder handle id for the file, or `null` when it is not file-scoped. */
    file: number | null;
    /** Human name for that file, when one is known. */
    label: string | null;
    toString(): string;
}

/**
 * Channel selection as the decoder accepts it.
 *
 * `null` / omitted means every channel. `"all"` is the same thing spelled the
 * way WSI-Service spells it. The swizzle form names lanes explicitly (`"r g b a"`,
 * with `x` for a padding lane). An array selects by index. Anything else is an
 * error rather than a silent truncation, and a selection longer than
 * `MAX_CHANNELS` throws — per read, so it fails on every tile rather than once.
 */
type WebTiffChannelSelection = number[] | "all" | string | null;
