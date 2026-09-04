/**
 * ImageOrientationSlide (0048,0102) — and what a viewer may honestly do with it.
 *
 * The tag holds the direction cosines of the total pixel matrix's first ROW and
 * first COLUMN in the slide frame of reference: `[Rx, Ry, Rz, Cx, Cy, Cz]`. It
 * defines where the raster sits on the glass, which is what `SCOORD3D`
 * annotation coordinates are expressed in.
 *
 * ## Two consumers, deliberately different
 *
 * **Coordinates take the tag whole.** `slideAffine` maps pixels to slide
 * millimetres through the full 2×2 plus the origin, reflection included, because
 * that mapping is defined by the standard and is not a matter of taste. Treating
 * it as a plain scale of pixel coordinates — which this plugin used to do — is
 * right only for the identity orientation at a zero origin, and every IDC slide
 * declares `[0,-1,0,-1,0,0]`, which swaps and negates both axes.
 *
 * **Display reads the same numbers through the slide's axes.** Slide X runs down
 * the image and slide Y across it — see {@link displayRotation} — so the on-screen
 * matrix is `M` with its axes swapped, and its determinant is `−det(M)`. The tag
 * every real file carries is `det(M) = −1`, which is therefore a proper 180°
 * ROTATION on screen, not a mirror. OSD applies a rotation in rendering *and* in
 * coordinate conversion, so annotations, masks and measurements follow it with
 * nothing to translate.
 *
 * An orientation that would need a mirror on screen is refused: OSD honours
 * `setFlip` when drawing but not when converting coordinates
 * (`_imageToViewportDelta` has no flip term), so a mirrored slide would carry
 * its annotations unmirrored. See `UPSTREAM.md`.
 *
 * Everything here is pure: six numbers in, a description out. No DOM, no OSD.
 */

/** Values below this are treated as zero when classifying a cosine triplet. */
const EPS = 1e-6;

/**
 * Read the six direction cosines, or refuse.
 *
 * Refusing means `null`, never a partially-populated descriptor: a half-known
 * orientation is a *different* orientation, which is worse than no orientation.
 *
 * @param {*} raw the tag's Value array
 * @returns {number[]|null} six finite numbers, or null
 */
export function parseOrientation(raw) {
    if (!Array.isArray(raw) || raw.length < 6) return null;
    const out = [];
    for (let i = 0; i < 6; i++) {
        const n = Number(raw[i]);
        if (!Number.isFinite(n)) return null;
        out.push(n);
    }
    // An all-zero triplet carries no direction and cannot be normalized.
    if (Math.hypot(out[0], out[1], out[2]) < EPS) return null;
    if (Math.hypot(out[3], out[4], out[5]) < EPS) return null;
    return out;
}

/**
 * The in-plane 2×2 `[[Rx, Cx], [Ry, Cy]]` and its determinant.
 *
 * Only x and y matter: a z component would tilt the slide out of the viewing
 * plane, which no whole-slide image does.
 */
function inPlane(orientation) {
    // Always through the parser, never trusting a six-long array on sight: a
    // NaN among otherwise plausible cosines used to reach `atan2` and come back
    // as a confident 90° turn.
    const o = parseOrientation(orientation);
    if (!o) return null;
    const m = { rx: o[0], ry: o[1], cx: o[3], cy: o[4] };
    m.det = (m.rx * m.cy) - (m.ry * m.cx);
    // Degenerate: the two axes are parallel, so they describe no frame at all.
    return (!Number.isFinite(m.det) || Math.abs(m.det) < EPS) ? null : m;
}

/**
 * How far to rotate the rendered image.
 *
 * The subtlety is that the slide frame's axes are **not** the screen's. Slide X
 * runs DOWN the image and slide Y runs ACROSS it — read it off the mapping
 * itself, which for the ubiquitous `[0,-1,0,-1,0,0]` is `X = −row`, `Y = −col`.
 * If slide X were the horizontal axis, that tag would mean the image's rows run
 * horizontally, i.e. every slide in every viewer would come out transposed.
 *
 * Hence the display matrix is `M` read with its axes swapped:
 *
 *     D = [[ry, cy],        screen x  =  ry·col + cy·row     (slide Y)
 *          [rx, cx]]        screen y  =  rx·col + cx·row     (slide X)
 *
 * and `det(D) = −det(M)`. So the tag every real file carries — determinant −1 —
 * describes a proper **rotation** on screen: 180° for `[0,-1,0,-1,0,0]`.
 *
 * A `det(D) < 0` orientation would need a mirror, which is refused: OSD honours
 * `setFlip` when drawing but not when converting coordinates, so a mirrored
 * slide would carry its annotations unmirrored. See `UPSTREAM.md`.
 *
 * @param {number[]|null} orientation six direction cosines
 * @returns {{degrees: number}|null} null for a mirror, a degenerate matrix, an
 *          absent/malformed tag, or an orientation that asks for nothing
 */
export function displayRotation(orientation) {
    const m = inPlane(orientation);
    // `m.det` is det(M); the display determinant is its negation, so a mirror on
    // screen is what a POSITIVE det(M) means here.
    if (!m || m.det > 0) return null;

    // The image of the column axis under D is (ry, rx) — screen x from slide Y,
    // screen y from slide X.
    let degrees = Math.atan2(m.rx, m.ry) * 180 / Math.PI;
    degrees = ((degrees % 360) + 360) % 360;
    // Snap the axis-aligned cases, which is all of them in practice: a scanner
    // writing 0.9999999 must not rotate the whole slide by 89.99999° and resample
    // every tile for it.
    const snapped = Math.round(degrees / 90) * 90;
    if (Math.abs(degrees - snapped) < 1e-3) degrees = snapped % 360;

    return degrees ? { degrees } : null;
}

/**
 * The mapping between image pixels and slide millimetres — the whole tag,
 * reflection included.
 *
 * This is what DICOM SR needs. `SCOORD3D` graphic data is millimetres in the
 * frame of reference, so an annotation written with a pure scale lands somewhere
 * else for every conformant reader, and one read back lands somewhere else for
 * us. Round-tripping inside one viewer hides it, because both directions are
 * wrong the same way.
 *
 * With no orientation this degrades to exactly the previous arithmetic:
 * `x * micronsX / 1000`.
 *
 * @param {object} p
 * @param {number[]} [p.orientation] six direction cosines
 * @param {number} [p.originX] XOffsetInSlideCoordinateSystem, millimetres
 * @param {number} [p.originY] YOffsetInSlideCoordinateSystem, millimetres
 * @param {number} [p.micronsX] spacing between columns, micrometres
 * @param {number} [p.micronsY] spacing between rows, micrometres
 * @returns {{toSlide: (function(number, number): {x: number, y: number}),
 *            toPixel: (function(number, number): {x: number, y: number})}}
 */
export function slideAffine({
    orientation = null, originX = 0, originY = 0,
    micronsX = 0.25, micronsY = 0.25,
} = {}) {
    // Micrometres per pixel -> millimetres per pixel, the SCOORD3D unit.
    const sx = Number(micronsX) / 1000;
    const sy = Number(micronsY) / 1000;
    const ox = Number(originX) || 0;
    const oy = Number(originY) || 0;

    // Without a declared orientation the axes are assumed to be the slide's own,
    // which is what every caller assumed implicitly before the tag was read.
    const m = inPlane(orientation) || { rx: 1, ry: 0, cx: 0, cy: 1, det: 1 };

    // Moving one COLUMN steps `sx` along the row direction; moving one ROW steps
    // `sy` along the column direction.
    const a = m.rx * sx, c = m.cx * sy;
    const b = m.ry * sx, d = m.cy * sy;
    const det = (a * d) - (b * c);

    return {
        toSlide(x, y) {
            return { x: (a * x) + (c * y) + ox, y: (b * x) + (d * y) + oy };
        },
        toPixel(X, Y) {
            const mx = X - ox;
            const my = Y - oy;
            return { x: ((d * mx) - (c * my)) / det, y: ((a * my) - (b * mx)) / det };
        },
    };
}
