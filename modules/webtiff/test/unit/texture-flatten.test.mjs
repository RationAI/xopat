/**
 * `textureSetToImageData` — the one place packed lanes become a canvas.
 *
 * A pack lane says which logical channel it carries, or `-1` for padding, and
 * the two cases have opposite alpha rules. Padding must be opaque or a
 * three-channel slide renders invisible; a *data* lane 3 must also be opaque,
 * because a stacked slide packs channels 0…3 into one pack and a canvas would
 * otherwise draw the fourth measurement as opacity — a dim channel erasing the
 * tile. Both rules only ever showed up as "the picture is blank", so they are
 * pinned here.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.window.OpenSeadragon = globalThis.window.OpenSeadragon ?? {
    TileSource: class {},
    version: { major: 6, versionStr: "6.0.0" },
    Point: class { constructor(x, y) { this.x = x; this.y = y; } },
};
// Node has no canvas; the flattener only needs the constructor's shape.
globalThis.ImageData = globalThis.ImageData ?? class {
    constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
    }
};

const { textureSetToImageData } = await import("../../tile-source.mjs");

const PIXELS = 4;

/** One RGBA8 pack whose every pixel is `[10, 20, 30, 40]`. */
function packedSet(mode, channels) {
    const data = new Uint8Array(PIXELS * 4);
    for (let i = 0; i < PIXELS; i++) data.set([10, 20, 30, 40], i * 4);
    return { width: 2, height: 2, mode, packs: [{ format: "RGBA8", data, channels }] };
}

const lane = (image, index) => Array.from({ length: PIXELS }, (_, i) => image.data[i * 4 + index]);

test("a data-mode lane 3 is drawn opaque, not as opacity", () => {
    const image = textureSetToImageData(packedSet("data", [0, 1, 2, 3]));
    expect(lane(image, 0)).toEqual([10, 10, 10, 10]);
    expect(lane(image, 2)).toEqual([30, 30, 30, 30]);
    expect(lane(image, 3)).toEqual([255, 255, 255, 255]);
});

test("an image-mode lane 3 is a real alpha channel and passes through", () => {
    const image = textureSetToImageData(packedSet("image", [0, 1, 2, 3]));
    expect(lane(image, 3)).toEqual([40, 40, 40, 40]);
});

test("padding is opaque in either mode, and unused colour lanes are black", () => {
    for (const mode of ["image", "data"]) {
        const image = textureSetToImageData(packedSet(mode, [0, -1, -1, -1]));
        expect(lane(image, 0)).toEqual([10, 10, 10, 10]);
        expect(lane(image, 1)).toEqual([0, 0, 0, 0]);
        expect(lane(image, 3)).toEqual([255, 255, 255, 255]);
    }
});
