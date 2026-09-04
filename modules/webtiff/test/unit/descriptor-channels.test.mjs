/**
 * Channel identity survives the descriptor chain.
 *
 * The decoder reports a channel's name and colour on `encoding.channels[i]` —
 * for an OME-TIFF plane stack those are the file's own `Name=`/`Color=`. Every
 * consumer reads the flat `channelNames`/`channelColors` arrays instead
 * (`auto-config.mjs` names and tints a layer from them), and step 1 of the chain
 * always wins for a webtiff source, so a descriptor that fails to flatten them
 * does not fall back — it silently produces unnamed layers in fallback tints.
 */
import { test, expect } from "@xopat/test-harness";

const { describeFromDecoder, describeTileSource } =
    await import("../../tiff-metadata.mjs");

const FLUORESCENCE = {
    width: 8, height: 8,
    samplesPerPixel: 3,
    bitsPerSample: [8],
    interpretationResolved: "data",
    encoding: {
        version: 1,
        channels: [
            { scale: 255, offset: 0, bits: 8, sampleFormat: 1, name: "DAPI", color: "#0000ff" },
            { scale: 255, offset: 0, bits: 8, sampleFormat: 1, name: "FITC", color: "#00ff00" },
            { scale: 255, offset: 0, bits: 8, sampleFormat: 1, name: "CY3", color: "#ffff00" },
        ],
    },
};

test("names and colours are lifted off the encoding", () => {
    const described = describeFromDecoder(FLUORESCENCE);
    expect(described.channelNames).toEqual(["DAPI", "FITC", "CY3"]);
    expect(described.channelColors).toEqual(["#0000ff", "#00ff00", "#ffff00"]);
    expect(described.samplesPerPixel).toBe(3);
    expect(described.interpretation).toBe("data");
});

test("a file that names nothing reports nothing, rather than a list of holes", () => {
    const anonymous = {
        ...FLUORESCENCE,
        encoding: { version: 1, channels: [{ scale: 255, offset: 0, bits: 8, sampleFormat: 1 }] },
    };
    expect(describeFromDecoder(anonymous).channelNames).toBeUndefined();
    expect(describeFromDecoder(anonymous).channelColors).toBeUndefined();
    // No encoding at all is the pre-header case, not a crash.
    expect(describeFromDecoder({ bitsPerSample: [8] }).channelNames).toBeUndefined();
});

test("explicit top-level arrays still win over the encoding", () => {
    const described = describeFromDecoder({
        ...FLUORESCENCE,
        channelNames: ["one", "two", "three"],
    });
    expect(described.channelNames).toEqual(["one", "two", "three"]);
    expect(described.channelColors).toEqual(["#0000ff", "#00ff00", "#ffff00"]);
});

test("the chain carries them through a tile source", () => {
    const described = describeTileSource({ getTiffDescriptor: () => FLUORESCENCE });
    expect(described.origin).toBe("tileSource:getTiffDescriptor");
    expect(described.channelNames).toEqual(["DAPI", "FITC", "CY3"]);
});
