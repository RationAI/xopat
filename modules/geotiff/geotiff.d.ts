/**
 * Ambient types owned by the `geotiff` module.
 *
 * TIFF sample semantics are this module's business, not the core's: the core
 * only knows that a tile source may declare `_dataFormat` (which OSD data type
 * its tile responses are). Everything about bit depths, sample formats and how a
 * stored texel maps back to a measured value lives here, next to the decoder and
 * the shaders that consume it.
 *
 * Any tile source that can deliver TIFF pixels — the GeoTIFF source, or a
 * WSI-Service source asked for `image_format=tiff` — may implement
 * `getSampleEncoding(): TiffSampleEncoding | undefined` to describe what it
 * delivers. That is a convention this module consumes; sources implement it
 * without depending on this module.
 */

/**
 * Per-channel encoding of the samples a tile source delivers. Mirrors the shape
 * the vendored decoder returns from `getSampleEncoding()`.
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
