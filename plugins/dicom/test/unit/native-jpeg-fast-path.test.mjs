/**
 * The native-JPEG fast path hands the stored bitstream straight to the renderer
 * instead of decoding it through cornerstone. That is only pixel-identical
 * because the guard reproduces cornerstone's own dispatch for
 * 1.2.840.10008.1.2.4.50 exactly — every frame it would have sent to the worker
 * pool, or run the Modality/VOI/palette chain over, must still go the long way.
 *
 * Drifting from that dispatch does not fail loudly: it renders raw stored values
 * as if they were display values. Hence these boundary cases.
 */
import { test, expect } from "@xopat/test-harness";

// `tile-source.mjs` extends OpenSeadragon.TileSource at class-evaluation time.
globalThis.OpenSeadragon = globalThis.OpenSeadragon || { TileSource: class {} };

const { DICOMWebTileSource, stripItemTag } = await import("../../tile-source.mjs");
const DicomQuery = (await import("../../dicom-query.mjs")).default;

const BASELINE = "1.2.840.10008.1.2.4.50";
const J2K = "1.2.840.10008.1.2.4.90";

/** A minimal well-formed baseline JPEG header — enough for the SOI guard. */
const jpeg = (...extra) => new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, ...extra]);

const rgb8 = {
    samplesPerPixel: 3,
    photometricInterpretation: "RGB",
    planarConfiguration: 0,
    bitsAllocated: 8,
    bitsStored: 8,
};

// The guard reads no instance state, so exercise it directly rather than
// standing up a whole tile source with a live DICOMweb endpoint behind it.
const canDecodeNatively = (ts, pixel, frame) =>
    DICOMWebTileSource.prototype._canDecodeNatively.call(null, ts, pixel, frame);

test("takes the fast path for 8-bit colour baseline JPEG", { tag: ["@unit"] }, () => {
    expect(canDecodeNatively(BASELINE, rgb8, jpeg())).toBe(true);
    expect(canDecodeNatively(BASELINE, { ...rgb8, samplesPerPixel: 4 }, jpeg())).toBe(true);
    // YBR is what most WSI encoders actually declare; the codec emits RGB and
    // cornerstone's baseline branch does nothing further with it either.
    expect(canDecodeNatively(BASELINE, { ...rgb8, photometricInterpretation: "YBR_FULL_422" }, jpeg())).toBe(true);
    // Quoting and whitespace survive the multipart part headers.
    expect(canDecodeNatively(` ${BASELINE} `, rgb8, jpeg())).toBe(true);
});

test("leaves every other transfer syntax to the decoder", { tag: ["@unit"] }, () => {
    for (const ts of [J2K, "1.2.840.10008.1.2.4.91", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.5", "", null]) {
        expect(canDecodeNatively(ts, rgb8, jpeg())).toBe(false);
    }
});

test("matches cornerstone's dispatch on bit depth and sample count", { tag: ["@unit"] }, () => {
    // bitsAllocated 16 and samplesPerPixel 5 both route to the worker pool.
    expect(canDecodeNatively(BASELINE, { ...rgb8, bitsAllocated: 16 }, jpeg())).toBe(false);
    expect(canDecodeNatively(BASELINE, { ...rgb8, samplesPerPixel: 5 }, jpeg())).toBe(false);
    expect(canDecodeNatively(BASELINE, { ...rgb8, samplesPerPixel: 2 }, jpeg())).toBe(false);
});

test("never shortcuts a frame that needs the display chain", { tag: ["@unit"] }, () => {
    const mono = { ...rgb8, samplesPerPixel: 1, photometricInterpretation: "MONOCHROME2" };
    expect(canDecodeNatively(BASELINE, mono, jpeg())).toBe(false);
    expect(canDecodeNatively(BASELINE, { ...mono, photometricInterpretation: "MONOCHROME1" }, jpeg())).toBe(false);
    // samplesPerPixel 1 with no photometric interpretation is still intensity data.
    expect(canDecodeNatively(BASELINE, { ...rgb8, samplesPerPixel: 1 }, jpeg())).toBe(false);
    expect(canDecodeNatively(BASELINE, { ...rgb8, samplesPerPixel: 1, photometricInterpretation: "PALETTE COLOR" }, jpeg())).toBe(false);
});

test("rejects a frame that is not a JPEG bitstream", { tag: ["@unit"] }, () => {
    // A truncated or mislabelled frame must fail the tile job here, where the
    // retry and faulty-source accounting live, not silently inside the renderer.
    expect(canDecodeNatively(BASELINE, rgb8, new Uint8Array([0x00, 0x00, 0x00, 0x00]))).toBe(false);
    expect(canDecodeNatively(BASELINE, rgb8, new Uint8Array([0xFF, 0xD8]))).toBe(false);
    // An un-stripped encapsulation item header is not an SOI marker either.
    expect(canDecodeNatively(BASELINE, rgb8, new Uint8Array([0xFE, 0xFF, 0x00, 0xE0, 0, 0, 0, 4, 0xFF, 0xD8]))).toBe(false);
});

test("strips the encapsulation item header, and only that", { tag: ["@unit"] }, () => {
    const wrapped = new Uint8Array([0xFE, 0xFF, 0x00, 0xE0, 0x04, 0x00, 0x00, 0x00, 0xFF, 0xD8, 0xFF, 0xE0]);
    expect(Array.from(stripItemTag(wrapped))).toEqual([0xFF, 0xD8, 0xFF, 0xE0]);
    expect(canDecodeNatively(BASELINE, rgb8, stripItemTag(wrapped))).toBe(true);

    // A bare bitstream is returned untouched...
    const bare = jpeg(0x00, 0x10);
    expect(stripItemTag(bare)).toBe(bare);
    // ...and a payload too short to carry the header is never sliced into.
    const stub = new Uint8Array([0xFE, 0xFF, 0x00, 0xE0]);
    expect(stripItemTag(stub)).toBe(stub);
});

test("indexOfBytes finds multipart boundaries", { tag: ["@unit"] }, () => {
    const hay = new Uint8Array([0, 1, 2, 3, 1, 2, 3, 4]);
    expect(DicomQuery.indexOfBytes(hay, new Uint8Array([1, 2, 3]))).toBe(1);
    expect(DicomQuery.indexOfBytes(hay, new Uint8Array([1, 2, 3]), 2)).toBe(4);
    expect(DicomQuery.indexOfBytes(hay, new Uint8Array([3, 4]))).toBe(6);
    // A needle that only matches past the end of the haystack is not a match.
    expect(DicomQuery.indexOfBytes(hay, new Uint8Array([4, 5]))).toBe(-1);
    expect(DicomQuery.indexOfBytes(hay, new Uint8Array([9]))).toBe(-1);
    expect(DicomQuery.indexOfBytes(hay, new Uint8Array([1, 2, 3]), 99)).toBe(-1);
});
