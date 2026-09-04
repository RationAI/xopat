/**
 * `decoderOptionsFrom` — the boundary between a session and the decoder.
 *
 * A slide's `options` block reaches this from `data[i].options` or the background
 * entry, which means it can come from POST_DATA, a URL parameter or an imported
 * peer session — untrusted by §7. On the other side of it is the decoder's own
 * option object, which also carries the transport (`pool`, `fetch`) and the
 * packing preferences. So this function is an allowlist, and these tests exist to
 * keep it one: the interesting cases are all the ones where something is dropped.
 */
import { test, expect } from "@xopat/test-harness";

// `tile-source.mjs` is a browser script; `makeTileSource` needs a namespace to
// subclass from at import time even though these tests never build a source.
globalThis.window = globalThis.window ?? globalThis;
globalThis.window.OpenSeadragon = globalThis.window.OpenSeadragon ?? {
    TileSource: class {},
    version: { major: 6, versionStr: "6.0.0" },
    Point: class { constructor(x, y) { this.x = x; this.y = y; } },
};

const { decoderOptionsFrom } = await import("../../tile-source.mjs");

test("no options is no options", () => {
    expect(decoderOptionsFrom(undefined)).toEqual({});
    expect(decoderOptionsFrom(null)).toEqual({});
    expect(decoderOptionsFrom({})).toEqual({});
    // Not an object: a session may put anything here.
    expect(decoderOptionsFrom("all")).toEqual({});
    expect(decoderOptionsFrom(42)).toEqual({});
});

test("layout keys reach the decoder's layout block", () => {
    expect(decoderOptionsFrom({ planeIndex: 3 })).toEqual({ layout: { planeIndex: 3 } });
    expect(decoderOptionsFrom({ pyramid: "subifd" })).toEqual({ layout: { pyramid: "subifd" } });
    // `planeIndex: 0` is a selection, not a default: it pins plane 0 and drops
    // the rest of a stack, so it must survive the allowlist like any other index.
    expect(decoderOptionsFrom({ planeIndex: 0, pyramid: "auto" }))
        .toEqual({ layout: { planeIndex: 0, pyramid: "auto" } });
});

test("the removed layout preference is dropped", () => {
    // A pyramid and a plane stack stopped being alternatives when the decoder
    // learned to read every same-size plane as a channel, and `layout.prefer`
    // went with them. A session still carrying it must not reach the decoder,
    // which would only answer with a deprecation warning per slide.
    for (const layout of ["stack", "pyramid"]) {
        expect(decoderOptionsFrom({ layout })).toEqual({});
        expect(decoderOptionsFrom({ layout, planeIndex: 2 }))
            .toEqual({ layout: { planeIndex: 2 } });
    }
});

test("a plane index that is not one is dropped, not coerced", () => {
    // `-1` is the decoder's "the directory itself" sentinel in a different field;
    // letting it through here would be a plane selection that means something else.
    for (const planeIndex of [-1, 1.5, NaN, Infinity, "2nd", null, {}, []]) {
        expect(decoderOptionsFrom({ planeIndex })).toEqual({});
    }
    // A numeric string is still an integer plane, and sessions are JSON-shaped.
    expect(decoderOptionsFrom({ planeIndex: "2" })).toEqual({ layout: { planeIndex: 2 } });
});

test("pyramid is an allowlist, not a pass-through", () => {
    expect(decoderOptionsFrom({ pyramid: "stack" })).toEqual({});
    expect(decoderOptionsFrom({ pyramid: "__proto__" })).toEqual({});
});

test("channels are filtered to a bounded list of real indices", () => {
    expect(decoderOptionsFrom({ channels: [0, 2, 4] }))
        .toEqual({ format: { channels: [0, 2, 4] } });
    // Junk entries are removed rather than failing the whole selection.
    expect(decoderOptionsFrom({ channels: [0, -1, "1", 2.5, null] }))
        .toEqual({ format: { channels: [0, 1] } });
    // Nothing survivable left: no selection at all, which is "every channel".
    expect(decoderOptionsFrom({ channels: [-1, "x"] })).toEqual({});
    expect(decoderOptionsFrom({ channels: [] })).toEqual({});

    const huge = decoderOptionsFrom({ channels: Array.from({ length: 500 }, (_, i) => i) });
    expect(huge.format.channels).toHaveLength(64);
});

test('WSI-Service\'s "all" is accepted and means no selection', () => {
    // Sessions in `docs/data/sessions/` carry `{format: "tiff", channels: "all"}`
    // because that is what the WSI-Service sources take. It must mean the same
    // thing here — every channel — rather than being an unrecognised value that
    // happens to produce the same result by accident.
    expect(decoderOptionsFrom({ format: "tiff", channels: "all" })).toEqual({});
});

test("interpretation is an allowlist", () => {
    expect(decoderOptionsFrom({ interpretation: "data" }))
        .toEqual({ format: { interpretation: "data" } });
    expect(decoderOptionsFrom({ interpretation: "image" }))
        .toEqual({ format: { interpretation: "image" } });
    expect(decoderOptionsFrom({ interpretation: "raw" })).toEqual({});
});

test("decoder internals are unreachable from a session", () => {
    // The keys that matter: `pool` and `fetch` are the transport, `gpu` is the
    // packing decision, and `logLatency` is a function the module owns.
    const result = decoderOptionsFrom({
        pool: { evil: true },
        fetch: () => {},
        logLatency: () => {},
        format: { gpu: { forceRGBA16F: true }, channels: [7] },
        layout: { planeIndex: 9 },      // object form, not the string the map takes
        planeIndex: 1,
    });
    expect(result).toEqual({ layout: { planeIndex: 1 } });
});
