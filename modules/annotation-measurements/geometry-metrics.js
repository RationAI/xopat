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
    // We obtain rings from the annotations factory (`toPointArray`) which
    // already resolves fabric transforms into image coordinates.

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
            // pretty strings via scalebar formatters when present
            formatArea: (px2) => (sb && typeof sb.formatArea === 'function') ? sb.formatArea(px2) : `${Math.round(px2)} px²`,
            formatLength: (px) => (sb && typeof sb.formatLength === 'function') ? sb.formatLength(px) : `${Math.round(px)} px`,
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
        const na = areaOf(annotations, numeratorObject);
        let da = 0;
        for (const d of denominatorObjects || []) {
            const a = areaOf(annotations, d);
            if (Number.isFinite(a)) da += a;
        }
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
        const fromRings = ringsForObject(annotations, fromObject);
        if (!fromRings) return null;
        let best = { distancePx: Infinity, target: null };
        for (const t of targetObjects || []) {
            if (t === fromObject) continue;
            const tr = ringsForObject(annotations, t);
            if (!tr) continue;
            // Symmetric min over outer rings (holes ignored for margin distance).
            const d = Math.min(
                ringToRingMinDistance(fromRings[0], tr[0]),
                ringToRingMinDistance(tr[0], fromRings[0])
            );
            if (d < best.distancePx) best = { distancePx: d, target: t };
        }
        return Number.isFinite(best.distancePx) ? best : null;
    }

    NS.geometry = {
        ringsForObject,
        areaOf,
        polygonAreaImagePx,
        unitConverter,
        areaRatio,
        areaRatioAgainstSet,
        presetComposition,
        nearestDistance,
        // low-level exports for reuse/testing
        ringSignedArea,
        centroid,
        pointInRing,
    };
})(typeof window !== 'undefined' ? window : globalThis);
