/**
 * ImageOrientationSlide: taken whole for coordinates, and only partly for pixels.
 *
 * The tag says where the total pixel matrix sits on the glass. `SCOORD3D`
 * annotation coordinates are expressed in that frame, so the affine must use all
 * of it — the plugin used to treat millimetres as a plain scale of pixels, which
 * misplaced every annotation it wrote for any other reader.
 *
 * Display reads the same numbers through the slide's own axes: slide X runs DOWN
 * the image and slide Y across it, so the screen matrix is `M` with its axes
 * swapped and its determinant negated.
 *
 * The load-bearing assertion is: an orientation that would need a MIRROR is
 * refused outright, never approximated. OSD draws a flip but does not convert
 * coordinates through one.
 */
import { test, expect } from "@xopat/test-harness";
import { parseOrientation, displayRotation, slideAffine } from "../../slide-orientation.mjs";

/** What every IDC slide declares: `(x, y) -> (-y, -x)`, determinant -1. */
const IDC = [0, -1, 0, -1, 0, 0];
const IDENTITY = [1, 0, 0, 0, 1, 0];

/* ------------------------------------------------------------------ */
/* displayRotation                                                     */
/* ------------------------------------------------------------------ */

test("the measured IDC orientation is a half turn on screen", { tag: ["@unit"] }, async () => {
    // Slide X runs DOWN the image and slide Y across it, so this tag means
    // "-col horizontally, -row vertically" — a 180 turn
    expect(displayRotation(IDC)).toEqual({ degrees: 180 });
});

test("an orientation that would need a mirror is refused", { tag: ["@unit"] }, async () => {
    // det(M) = +1 means det(D) = -1: a mirror on screen. OSD draws a flip but
    // does not convert coordinates through one, so annotations would end up
    // unmirrored on mirrored pixels. Rendered as stored instead.
    expect(displayRotation(IDENTITY)).toBe(null);
});

test("every orientation resolves to a turn or to nothing, never to a mirror", { tag: ["@unit"] }, async () => {
    const CASES = [
        // [row cosines, column cosines, expected]  — D = [[ry, cy], [rx, cx]]
        [[0, -1], [-1, 0], { degrees: 180 }],    // the IDC value
        [[0, 1], [1, 0], null],                  // slide axes as-is: a turn of 0°
        [[1, 0], [0, -1], { degrees: 90 }],
        [[-1, 0], [0, 1], { degrees: 270 }],
        [[1, 0], [0, 1], null],                  // mirror on screen
        [[0, 1], [-1, 0], null],
        [[-1, 0], [0, -1], null],
        [[0, -1], [1, 0], null],
    ];

    for (const [row, col, expected] of CASES) {
        const orientation = [row[0], row[1], 0, col[0], col[1], 0];
        const got = displayRotation(orientation);
        expect(got, `orientation ${JSON.stringify(orientation)}`).toEqual(expected);
        // No answer may ever ask the renderer to mirror.
        expect(got == null || !("flipped" in got), JSON.stringify(orientation)).toBe(true);

        // A returned angle must be the one the display matrix describes: D maps
        // the column axis (1,0) to (ry, rx).
        if (got) {
            const rad = got.degrees * Math.PI / 180;
            expect(Math.abs(Math.cos(rad) - row[1]) < 1e-9, `cos ${got.degrees}`).toBe(true);
            expect(Math.abs(Math.sin(rad) - row[0]) < 1e-9, `sin ${got.degrees}`).toBe(true);
        }
    }
});

test("a missing or malformed tag is refused whole", { tag: ["@unit"] }, async () => {
    for (const bad of [null, undefined, [], [1, 0, 0], [1, 0, 0, 0, 1], "1\\0\\0\\0\\1\\0",
        [1, 0, 0, 0, NaN, 0], [0, 0, 0, 0, 0, 0], [1, 0, 0, 2, 0, 0]]) {
        expect(displayRotation(bad), JSON.stringify(bad)).toBe(null);
    }
    expect(parseOrientation(IDENTITY)).toEqual(IDENTITY);
    // Strings are what a DICOM JSON Value array actually carries for DS.
    expect(parseOrientation(["0", "-1", "0", "-1", "0", "0"])).toEqual(IDC);
});

test("a near-axis rotation snaps instead of drifting", { tag: ["@unit"] }, async () => {
    // A scanner writing 0.9999999 must not rotate the slide by 179.99999° and
    // resample every tile for it.
    expect(displayRotation([0, -0.99999999, 0, -0.99999999, 0, 0])).toEqual({ degrees: 180 });
});

/* ------------------------------------------------------------------ */
/* slideAffine                                                         */
/* ------------------------------------------------------------------ */

const near = (got, want, eps = 1e-9) => {
    expect(Math.abs(got.x - want.x) < eps && Math.abs(got.y - want.y) < eps,
        `${JSON.stringify(got)} ≈ ${JSON.stringify(want)}`).toBe(true);
};

test("SCOORD3D millimetres are not a plain scale of pixels", { tag: ["@unit"] }, async () => {
    // The bug, stated. Under the IDC orientation a pixel maps with its axes
    // SWAPPED and both negated; the old converter multiplied x by micronsX/1000
    // and called it done, so everything it wrote was in the wrong place for
    // anybody but itself. Note the reflection IS applied here — coordinates are
    // defined by the standard, not by what a renderer can draw.
    const a = slideAffine({
        orientation: IDC, originX: 12, originY: -3, micronsX: 0.5, micronsY: 0.25,
    });

    // rowVec (0,-1) is stepped by the COLUMN spacing (micronsX), colVec (-1,0)
    // by the row spacing (micronsY).
    near(a.toSlide(100, 200), { x: 12 - (200 * 0.00025), y: -3 - (100 * 0.0005) });

    // What the old code produced, for contrast.
    const naive = { x: 100 * 0.0005, y: 200 * 0.00025 };
    expect(Math.abs(naive.x - a.toSlide(100, 200).x) > 1e-6).toBe(true);
});

test("pixel -> mm -> pixel is the identity", { tag: ["@unit"] }, async () => {
    const cases = [
        { orientation: IDC, originX: 12, originY: -3 },
        { orientation: IDENTITY, originX: 0, originY: 0 },
        { orientation: [0, 1, 0, -1, 0, 0], originX: -1.25, originY: 4 },
        { orientation: null, originX: 0.5, originY: 0.5 },
    ];
    for (const c of cases) {
        const a = slideAffine({ ...c, micronsX: 0.5, micronsY: 0.25 });
        for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1234.5, -678.25]]) {
            const mm = a.toSlide(x, y);
            near(a.toPixel(mm.x, mm.y), { x, y }, 1e-6);
        }
    }
});

test("with no orientation the affine is exactly the old arithmetic", { tag: ["@unit"] }, async () => {
    // Stores that declare nothing must keep byte-identical behaviour: this is the
    // whole reason the descriptor is allowed to be absent rather than defaulted.
    const a = slideAffine({ micronsX: 0.25, micronsY: 0.25 });
    near(a.toSlide(400, 800), { x: 400 * 0.00025, y: 800 * 0.00025 });
    near(a.toPixel(0.1, 0.2), { x: 0.1 / 0.00025, y: 0.2 / 0.00025 });
});
