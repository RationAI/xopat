(function (global) {
    'use strict';

    const NS = global.AnnotationMeasurements = global.AnnotationMeasurements || {};

    // Zoom-independent geometric metrics. Everything here is derived from
    // annotation polygon geometry in slide-pixel space and converted to
    // physical units via the per-viewer scalebar — no pixel readback, so
    // results are fully reproducible and independent of viewport state.
    //
    // Ring representation: a polygon is an array of rings; ring[0] is the outer
    // boundary, ring[1..] are holes. Each ring is an array of {x,y} in slide px.
    // We obtain rings from the annotations factory (`toPointArray`), which resolves
    // the object's fabric transform into image coordinates. That was not true until
    // the factories were fixed to apply the matrix — the comment described the
    // intent while the code returned raw local points.

    function ringsForObject(annotations, object) {
        const factory = annotations?.getAnnotationObjectFactory?.(object?.factoryID);
        if (!factory || typeof factory.toPointArray !== 'function') return null;
        // Sentinel converter + quality=1 matches getSnapVertices: no copies /
        // simplification, so boundary ops (distance, containment) use the exact
        // authored vertices. Multipolygon returns rings-of-rings; simple shapes
        // (incl. ellipse-as-perimeter) return one flat ring.
        const withObjectPoint = global.OSDAnnotations?.AnnotationObjectFactory?.withObjectPoint;
        let pts;
        try {
            pts = factory.toPointArray(object, withObjectPoint, undefined, 1);
        } catch (e) { return null; }
        return normalizeRings(pts);
    }

    // Authoritative absolute area (slide px²). Uses the factory's own getArea —
    // exact for rect (w·h) and ellipse (π·rx·ry), shoelace-with-holes for
    // polygons — rather than re-deriving from boundary points, which would
    // approximate curved shapes and diverge from what the board/popover show.
    function areaOf(annotations, object) {
        const factory = annotations?.getAnnotationObjectFactory?.(object?.factoryID);
        if (!factory || typeof factory.getArea !== 'function') return NaN;
        const a = factory.getArea(object);
        return (typeof a === 'number' && Number.isFinite(a)) ? a : NaN;
    }

    function normalizeRings(pts) {
        if (!Array.isArray(pts) || !pts.length) return null;
        // Nested (multipolygon / with holes): array of rings of points.
        if (Array.isArray(pts[0]) && pts[0].length && typeof pts[0][0] === 'object') {
            return pts.map((ring) => ring.map(toXY)).filter((r) => r.length >= 3);
        }
        // Flat ring of points.
        if (typeof pts[0] === 'object') {
            const ring = pts.map(toXY);
            return ring.length >= 3 ? [ring] : null;
        }
        return null;
    }

    function toXY(p) {
        if (Array.isArray(p)) return { x: p[0], y: p[1] };
        return { x: p.x, y: p.y };
    }

    // Signed shoelace area of a ring (slide px²). Positive/negative by winding.
    function ringSignedArea(ring) {
        let a = 0;
        for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
            a += (ring[j].x * ring[i].y) - (ring[i].x * ring[j].y);
        }
        return a / 2;
    }

    // Absolute polygon area in slide px²: |outer| minus |holes|.
    function polygonAreaImagePx(rings) {
        if (!rings || !rings.length) return NaN;
        let area = Math.abs(ringSignedArea(rings[0]));
        for (let i = 1; i < rings.length; i++) area -= Math.abs(ringSignedArea(rings[i]));
        return Math.max(0, area);
    }

    // ─── physical-unit conversion ──────────────────────────────────────────
    //
    // The scalebar owns µm/px. We expose a small converter bundle the engine
    // and UI share so area/length units stay consistent everywhere.

    function unitConverter(viewer) {
        const sb = viewer?.scalebar;
        const mppPerPx = NS.sampler?.imageMppPerPx?.(viewer);
        const hasPhysical = typeof mppPerPx === 'number' && mppPerPx > 0;
        return {
            hasPhysical,
            mppPerPx: hasPhysical ? mppPerPx : undefined,
            // slide px² → µm²
            areaImagePxToUm2: (px2) => hasPhysical ? px2 * mppPerPx * mppPerPx : NaN,
            // slide px² → mm²
            areaImagePxToMm2: (px2) => hasPhysical ? (px2 * mppPerPx * mppPerPx) / 1e6 : NaN,
            // slide px → µm
            lengthImagePxToUm: (px) => hasPhysical ? px * mppPerPx : NaN,
            // Pretty strings from the scalebar. These MUST be the `image*ToGivenUnits`
            // pair: they take *image pixels* and divide by `pixelsPerMeter` (squared for
            // area) before choosing a unit prefix. The bare `formatArea`/`formatLength`
            // take a value already in m/m² and only attach the prefix, so feeding them
            // pixels printed a raw pixel count labelled as metres — off by
            // `pixelsPerMeter` (~2.1e6 on a 0.47 µm/px slide) and disagreeing with the
            // very same annotation's on-canvas label. This is also the exact call the
            // annotations module uses (objects.js getLabelValue), so panel and canvas
            // now agree by construction rather than by coincidence.
            formatArea: (px2) => (sb && typeof sb.imageAreaToGivenUnits === 'function')
                ? sb.imageAreaToGivenUnits(px2) : `${Math.round(px2)} px²`,
            formatLength: (px) => (sb && typeof sb.imageLengthToGivenUnits === 'function')
                ? sb.imageLengthToGivenUnits(px) : `${Math.round(px)} px`,

            // A column of measurements must share one unit, or the reader has to
            // rescale every row in their head before two of them can be compared.
            // Single readouts keep the per-value prefix — that is where it helps.
            formatAreaSeries: (values) => (sb && typeof sb.imageAreasToGivenUnits === 'function')
                ? sb.imageAreasToGivenUnits(values)
                : values.map((px2) => `${Math.round(px2)} px²`),
            formatLengthSeries: (values) => (sb && typeof sb.imageLengthsToGivenUnits === 'function')
                ? sb.imageLengthsToGivenUnits(values)
                : values.map((px) => `${Math.round(px)} px`),
        };
    }

    // ─── area ratio ─────────────────────────────────────────────────────────
    //
    // ratio = area(numerator) / area(denominator). Both are polygon areas in
    // the same slide-pixel space, so the ratio is unit-free and exact. The
    // clinically important case (annotation vs tissue mask) is just this with
    // the tissue polygon(s) as denominator.

    function areaRatio(annotations, numeratorObject, denominatorObject) {
        const na = areaOf(annotations, numeratorObject);
        const da = areaOf(annotations, denominatorObject);
        if (!(da > 0) || !Number.isFinite(na)) return { ratio: NaN, numeratorAreaPx: na, denominatorAreaPx: da };
        return { ratio: na / da, numeratorAreaPx: na, denominatorAreaPx: da };
    }

    // Ratio of an annotation against the union of a set of denominator objects
    // (e.g. all tissue-layer polygons). Uses summed area as an upper bound; for
    // exact overlap-aware ratios use intersectionArea below.
    function areaRatioAgainstSet(annotations, numeratorObject, denominatorObjects) {
        return areaRatioBetweenSets(annotations, [numeratorObject], denominatorObjects);
    }

    /** Summed area of a set, skipping members that cannot be measured. */
    function summedArea(annotations, objects) {
        let total = 0;
        for (const o of objects || []) {
            const a = areaOf(annotations, o);
            if (Number.isFinite(a)) total += a;
        }
        return total;
    }

    /**
     * Ratio between two SETS of annotations.
     *
     * The general form the other two are now special cases of. It exists because
     * the comparison has to be swappable: with a single-object numerator "tumour ÷
     * tissue" is expressible and its inverse is not, which makes the direction of
     * every ratio an accident of which operand the UI happened to restrict.
     *
     * Areas are summed, not unioned — two overlapping members count twice. That is
     * the same convention `areaRatioAgainstSet` has always used for the denominator.
     */
    function areaRatioBetweenSets(annotations, numeratorObjects, denominatorObjects) {
        const na = summedArea(annotations, numeratorObjects);
        const da = summedArea(annotations, denominatorObjects);
        if (!(da > 0)) return { ratio: NaN, numeratorAreaPx: na, denominatorAreaPx: da };
        return { ratio: na / da, numeratorAreaPx: na, denominatorAreaPx: da };
    }

    // ─── preset composition ──────────────────────────────────────────────────
    //
    // Break a parent region down by the presets of the annotations contained
    // within it. Returns per-preset absolute area and fraction of the parent.
    // Containment test: an annotation counts toward the parent when its polygon
    // centroid falls inside the parent's outer ring (cheap, robust for the
    // common nested-annotation authoring pattern). For strict area-accurate
    // composition, callers can pass exact intersection via intersectionArea.

    function centroid(ring) {
        let x = 0, y = 0, a = 0;
        for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
            const cross = (ring[j].x * ring[i].y) - (ring[i].x * ring[j].y);
            a += cross;
            x += (ring[j].x + ring[i].x) * cross;
            y += (ring[j].y + ring[i].y) * cross;
        }
        a *= 0.5;
        if (Math.abs(a) < 1e-9) {
            // Degenerate — fall back to vertex mean.
            let mx = 0, my = 0;
            for (const p of ring) { mx += p.x; my += p.y; }
            return { x: mx / ring.length, y: my / ring.length };
        }
        return { x: x / (6 * a), y: y / (6 * a) };
    }

    function pointInRing(pt, ring) {
        let inside = false;
        for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
            const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
            const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
                (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function presetComposition(annotations, parentObject, candidateObjects, presetLabelOf) {
        const parentRings = ringsForObject(annotations, parentObject);
        if (!parentRings) return null;
        const parentOuter = parentRings[0];
        const parentArea = areaOf(annotations, parentObject);
        const byPreset = new Map();
        for (const obj of candidateObjects || []) {
            if (obj === parentObject) continue;
            const rings = ringsForObject(annotations, obj);
            if (!rings) continue;
            const c = centroid(rings[0]);
            if (!pointInRing(c, parentOuter)) continue;
            const area = areaOf(annotations, obj);
            if (!Number.isFinite(area) || area <= 0) continue;
            const key = obj.presetID != null ? String(obj.presetID) : '(none)';
            const cur = byPreset.get(key) || { presetID: obj.presetID, areaPx: 0, count: 0 };
            cur.areaPx += area;
            cur.count += 1;
            byPreset.set(key, cur);
        }
        const rows = Array.from(byPreset.values()).map((r) => ({
            presetID: r.presetID,
            label: presetLabelOf ? presetLabelOf(r.presetID) : String(r.presetID),
            areaPx: r.areaPx,
            count: r.count,
            fractionOfParent: parentArea > 0 ? r.areaPx / parentArea : NaN,
        }));
        rows.sort((a, b) => b.areaPx - a.areaPx);
        return { parentAreaPx: parentArea, rows };
    }

    // ─── distances ────────────────────────────────────────────────────────────
    //
    // Nearest-boundary distance between one annotation and a target set, in
    // slide px (convert via unitConverter). Used for margin measurements
    // (e.g. distance from a lesion to the nearest resection-margin annotation).

    function pointToSegment(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * dx, cy = ay + t * dy;
        return Math.hypot(px - cx, py - cy);
    }

    function ringToRingMinDistance(ringA, ringB) {
        let min = Infinity;
        for (const p of ringA) {
            for (let i = 0, n = ringB.length, j = n - 1; i < n; j = i++) {
                const d = pointToSegment(p.x, p.y, ringB[j].x, ringB[j].y, ringB[i].x, ringB[i].y);
                if (d < min) min = d;
            }
        }
        return min;
    }

    function nearestDistance(annotations, fromObject, targetObjects) {
        return nearestDistanceBetweenSets(annotations, [fromObject], targetObjects);
    }

    /**
     * Closest approach between two SETS: the minimum over every (from, target)
     * pair. Reports which member of each side produced it, so a caller can say
     * *what* is nearest rather than only how far.
     *
     * A member is never measured against itself, so a set compared with one that
     * contains it still answers about the others.
     */
    function nearestDistanceBetweenSets(annotations, fromObjects, targetObjects) {
        let best = { distancePx: Infinity, target: null, from: null };
        for (const f of fromObjects || []) {
            const fromRings = ringsForObject(annotations, f);
            if (!fromRings) continue;
            for (const t of targetObjects || []) {
                if (t === f) continue;
                const tr = ringsForObject(annotations, t);
                if (!tr) continue;
                // Symmetric min over outer rings (holes ignored for margin distance).
                const d = Math.min(
                    ringToRingMinDistance(fromRings[0], tr[0]),
                    ringToRingMinDistance(tr[0], fromRings[0])
                );
                if (d < best.distancePx) best = { distancePx: d, target: t, from: f };
            }
        }
        return Number.isFinite(best.distancePx) ? best : null;
    }

    /**
     * Is `candidate` close enough to `subject` to be part of the same thing?
     *
     * True when the subject sits INSIDE the candidate, or when the two boundaries
     * come within `maxDistancePx`. The containment case is not an optimisation: a
     * subject in the middle of a large island is far from that island's *boundary*,
     * so a pure distance test would discard the very region the subject is drawn on.
     *
     * Used to prune a derived tissue mask down to the section around a target. The
     * caller supplies the distance, so the policy — a fraction of the viewport
     * width, which makes the rule relative to the current zoom — stays in the UI.
     */
    function withinReach(annotations, subject, candidate, maxDistancePx) {
        const d = proximity(annotations, subject, candidate);
        if (d === null) return false;
        if (d === 0) return true;
        if (!(maxDistancePx >= 0)) return false;
        return d <= maxDistancePx;
    }

    /**
     * How far `candidate` is from `subject`, in image px: `0` when the subject's
     * centroid lies inside the candidate (the containment case, see
     * {@link withinReach}), else the closest approach of the two outer rings.
     * `null` when either side has no measurable geometry.
     */
    function proximity(annotations, subject, candidate) {
        const subjectRings = ringsForObject(annotations, subject);
        const candidateRings = ringsForObject(annotations, candidate);
        if (!subjectRings || !candidateRings) return null;
        if (pointInRing(centroid(subjectRings[0]), candidateRings[0])) return 0;
        return Math.min(
            ringToRingMinDistance(subjectRings[0], candidateRings[0]),
            ringToRingMinDistance(candidateRings[0], subjectRings[0])
        );
    }

    /**
     * Order `candidates` by their distance to `subject`, nearest first.
     *
     * The island the subject sits ON always ranks first (distance 0), even when
     * some small neighbouring island's *boundary* is closer than the containing
     * island's — that is what "the mask of the region I am measuring" means.
     * Candidates with no measurable geometry are dropped; the order among ties
     * is the input order.
     *
     * @return {Array<{object: object, distancePx: number}>}
     */
    function rankByProximity(annotations, subject, candidates) {
        const ranked = [];
        for (const object of candidates || []) {
            const distancePx = proximity(annotations, subject, object);
            if (distancePx === null || !Number.isFinite(distancePx)) continue;
            ranked.push({ object, distancePx });
        }
        // Stable sort: equal distances keep their input order.
        return ranked
            .map((r, i) => ({ r, i }))
            .sort((a, b) => (a.r.distancePx - b.r.distancePx) || (a.i - b.i))
            .map(({ r }) => r);
    }

    NS.geometry = {
        ringsForObject,
        withinReach,
        proximity,
        rankByProximity,
        areaOf,
        polygonAreaImagePx,
        unitConverter,
        areaRatio,
        areaRatioAgainstSet,
        areaRatioBetweenSets,
        summedArea,
        presetComposition,
        nearestDistance,
        nearestDistanceBetweenSets,
        // low-level exports for reuse/testing
        ringSignedArea,
        centroid,
        pointInRing,
    };
})(typeof window !== 'undefined' ? window : globalThis);
