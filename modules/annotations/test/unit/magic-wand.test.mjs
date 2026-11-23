/**
 * Detection core of the magic wand.
 *
 * The wand used to flood-fill from the single raw pixel under the cursor on every pointer
 * move, so one noisy pixel changed the whole selection. These assertions pin what replaced
 * it: an averaged reference colour, a fill that refuses seeds outside the frame, a stroke
 * region that only ever grows, a guard against a fill that ran away, and specks that are
 * filled rather than turned into holes. Pure functions over hand-built RGBA buffers - no
 * canvas, no viewer.
 */
import { test, expect, fromRoot, installBrowserGlobals, loadBrowserScript } from "@xopat/test-harness";

let shim;
let A;
let Wand;
let lib;

/** RGBA image of one colour, with optional per-pixel overrides `{x, y, color}`. */
function image(width, height, color, overrides = []) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set(color, i * 4);
    for (const o of overrides) data.set(o.color, (o.y * width + o.x) * 4);
    return { data, width, height, bytes: 4 };
}

/** Left half one colour, right half another. */
function halves(width, height, left, right) {
    const img = image(width, height, left);
    for (let y = 0; y < height; y++) {
        for (let x = width / 2; x < width; x++) img.data.set(right, (y * width + x) * 4);
    }
    return img;
}

const region = (img) => ({ data: new Uint8Array(img.width * img.height), bounds: null });
const count = (data) => data.reduce((sum, v) => sum + v, 0);

test.beforeAll(async () => {
    shim = installBrowserGlobals({
        extra: {
            XOpatModuleSingleton: class {},
            XOpatHistory: { XOpatHistoryProvider: class {} },
            addModule: () => {},
            VIEWER_MANAGER: { broadcastHandler: () => {} },
        },
    });
    A = await loadBrowserScript(fromRoot("modules", "annotations", "annotations.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "ext", "magic-wand.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "magic-wand.js"), "OSDAnnotations");
    Wand = A.MagicWand;
    lib = A.makeMagicWand();
});

test.afterAll(() => shim?.restore());

test("floodFill refuses a seed outside the image", { tag: ["@unit"] }, () => {
    const img = image(8, 8, [200, 100, 100, 255]);
    for (const [x, y] of [[-1, 3], [8, 3], [3, -1], [3, 8], [NaN, 0]]) {
        expect(lib.floodFill(img, x, y, 10, 10, null, false), `seed ${x},${y}`).toBe(null);
    }
    expect(count(lib.floodFill(img, 3, 3, 10, 10, null, false).data)).toBe(64);
});

test("floodFill compares against an explicit reference colour", { tag: ["@unit"] }, () => {
    // The seed pixel is an outlier. Seeded from its own colour, nothing around it matches.
    const img = image(8, 8, [200, 100, 100, 255], [{ x: 4, y: 4, color: [90, 90, 90, 255] }]);
    expect(count(lib.floodFill(img, 4, 4, 10, 10, null, false).data)).toBe(1);

    // Seeded from the surrounding colour, the neighbourhood is selected (the outlier is not).
    const fill = lib.floodFill(img, 3, 4, 10, 10, null, false, [200, 100, 100, 255]);
    expect(count(fill.data)).toBe(63);
});

test("averageColor is the neighbourhood mean and ignores transparent pixels", { tag: ["@unit"] }, () => {
    const img = image(9, 9, [100, 100, 100, 255], [
        { x: 4, y: 4, color: [0, 0, 0, 255] },      // noisy seed pixel
        { x: 5, y: 4, color: [255, 255, 255, 0] },  // transparent: not part of the mean
    ]);
    const [r, g, b, a] = Wand.averageColor(img, 4, 4);
    // 25 pixels, one transparent and skipped, one black: 23 * 100 / 24
    expect(r).toBeCloseTo(2300 / 24, 5);
    expect(g).toBeCloseTo(r, 5);
    expect(b).toBeCloseTo(r, 5);
    expect(a).toBe(255);

    expect(Wand.averageColor(img, 5, 4), "transparent seed").toBe(null);
    expect(Wand.averageColor(img, 9, 4), "outside").toBe(null);
    // clamped at the corner: still a mean, never NaN
    expect(Wand.averageColor(img, 0, 0)).toEqual([100, 100, 100, 255]);
});

test("a noisy seed pixel does not change what is selected", { tag: ["@unit"] }, () => {
    const clean = halves(20, 10, [200, 120, 120, 255], [60, 60, 160, 255]);
    const noisy = halves(20, 10, [200, 120, 120, 255], [60, 60, 160, 255]);
    noisy.data.set([150, 170, 80, 255], (5 * 20 + 4) * 4);

    const a = region(clean), b = region(noisy);
    expect(Wand.growRegion(lib, clean, a, 4, 5, 24, Infinity)).toBe("added");
    expect(Wand.growRegion(lib, noisy, b, 4, 5, 24, Infinity)).toBe("added");

    // Left half in both; the noisy pixel itself is the only difference.
    expect(count(a.data)).toBe(100);
    expect(count(b.data)).toBe(99);
    expect(a.bounds).toEqual({ minX: 0, minY: 0, maxX: 9, maxY: 9 });
});

test("a stroke region only grows, and seeds already inside it are skipped", { tag: ["@unit"] }, () => {
    const img = halves(20, 10, [200, 120, 120, 255], [60, 60, 160, 255]);
    const acc = region(img);

    expect(Wand.growRegion(lib, img, acc, 2, 2, 24, Infinity)).toBe("added");
    const afterFirst = Uint8Array.from(acc.data);
    expect(Wand.growRegion(lib, img, acc, 7, 7, 24, Infinity), "same area again").toBe("none");
    expect(acc.data).toEqual(afterFirst);

    expect(Wand.growRegion(lib, img, acc, 15, 5, 24, Infinity)).toBe("added");
    expect(count(acc.data)).toBe(200);
    for (let i = 0; i < afterFirst.length; i++) {
        if (afterFirst[i]) expect(acc.data[i]).toBe(1);
    }
    expect(acc.bounds).toEqual({ minX: 0, minY: 0, maxX: 19, maxY: 9 });

    expect(Wand.growRegion(lib, img, acc, -3, 5, 24, Infinity), "outside the frame").toBe("none");
});

test("a fill that runs away is dropped without touching the region", { tag: ["@unit"] }, () => {
    const img = image(20, 10, [200, 120, 120, 255]);
    const acc = region(img);
    expect(Wand.growRegion(lib, img, acc, 5, 5, 24, 20 * 10 * 0.6)).toBe("leak");
    expect(count(acc.data)).toBe(0);
    expect(acc.bounds).toBe(null);
});

test("nothing is selected off the slide", { tag: ["@unit"] }, () => {
    const img = halves(20, 10, [200, 120, 120, 255], [0, 0, 0, 0]);
    const acc = region(img);
    expect(Wand.growRegion(lib, img, acc, 15, 5, 24, Infinity), "transparent seed").toBe("none");
    expect(Wand.growRegion(lib, img, acc, 5, 5, 24, Infinity)).toBe("added");
    expect(count(acc.data), "the fill stops at the slide edge").toBe(100);
});

test("seedsAlong covers a fast drag without gaps", { tag: ["@unit"] }, () => {
    const seeds = Wand.seedsAlong({ x: 0, y: 0 }, { x: 20, y: 0 }, 4);
    expect(seeds).toEqual([{ x: 4, y: 0 }, { x: 8, y: 0 }, { x: 12, y: 0 }, { x: 16, y: 0 }, { x: 20, y: 0 }]);
    expect(Wand.seedsAlong({ x: 3, y: 3 }, { x: 3, y: 3 }, 4), "no movement").toEqual([{ x: 3, y: 3 }]);
    expect(Wand.seedsAlong({ x: 0, y: 0 }, { x: 1, y: 1 }, 4)).toEqual([{ x: 1, y: 1 }]);
});

test("fillSmallHoles closes specks, keeps real holes and open bays", { tag: ["@unit"] }, () => {
    const w = 12, h = 12;
    const data = new Uint8Array(w * h).fill(1);
    const clear = (x, y) => { data[y * w + x] = 0; };
    clear(2, 2);                                   // speck: 1 pixel
    for (let y = 5; y < 9; y++) for (let x = 5; x < 9; x++) clear(x, y); // real hole: 16 pixels
    clear(0, 10); clear(1, 10);                    // bay reaching the edge of the bounds

    Wand.fillSmallHoles({ data, width: w, bounds: { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1 } }, 4);

    expect(data[2 * w + 2], "speck filled").toBe(1);
    expect(data[6 * w + 6], "real hole kept").toBe(0);
    expect(data[10 * w + 0], "open bay kept").toBe(0);
    expect(data[10 * w + 1], "open bay kept").toBe(0);
    expect(count(data)).toBe(w * h - 16 - 2);
});
