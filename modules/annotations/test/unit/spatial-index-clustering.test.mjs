/**
 * The spatial index's clustering output, and the lifetime of its cache.
 *
 * Two things are pinned here, both of which a profiler-driven rewrite could
 * plausibly have broken without anyone noticing until a slide looked wrong:
 *
 * 1. **`clusters()` is output-identical to the per-level-query algorithm it
 *    replaced.** The recursion used to re-query rbush and re-run the
 *    eligibility test in every cell, so each visible annotation was tested once
 *    per level. It now queries once at the root and narrows by intersecting
 *    boxes on the way down. That is only sound because the screen clip and the
 *    eligibility test are deterministic per object for a given frame — a claim
 *    worth a test rather than a comment, so the reference implementation of the
 *    old algorithm lives here and both are run over the same fixtures.
 *
 * 2. **The cache survives a viewport that did not move.** It used to be dropped
 *    by `bumpSetCoords()` before any consumer could compare the key, which made
 *    it incapable of surviving a frame; the key already carries the whole
 *    viewport transform, so identity of the answer is decided there.
 */
import { test, expect, fromRoot, installBrowserGlobals, loadBrowserScript } from "@xopat/test-harness";

let shim;
let SpatialIndex;

/** A fabric-ish object: only what the index reads. */
function obj(id, x, y, w, h, extra = {}) {
    return Object.assign({
        id,
        _bounds: { left: x, top: y, width: w, height: h },
        getBoundingRect() { return this._bounds; },
    }, extra);
}

/**
 * A canvas stub. `vptCoords` is the image-space AABB of the viewport, exactly
 * as fabric's `calcViewportBoundaries` produces it.
 */
function fakeCanvas(objects, { zoom = 1, panX = 0, panY = 0, width = 1000, height = 800 } = {}) {
    return {
        _objects: objects,
        _activeObject: null,
        width,
        height,
        // no rotation: makeScreenClipper returns null, so the AABB is exact
        viewportTransform: [zoom, 0, 0, zoom, panX, panY],
        vptCoords: {
            tl: { x: -panX / zoom, y: -panY / zoom },
            br: { x: (width - panX) / zoom, y: (height - panY) / zoom },
        },
    };
}

/**
 * An index over `objects`, attached to `canvas`, with a known slide size.
 *
 * `viewport` is optional and omitted by every clustering-equivalence case, so
 * those exercise the recursion rather than the near-max-zoom escape.
 */
function buildIndex(objects, canvas, { slide = { x: 4000, y: 4000 }, viewport, options } = {}) {
    const wrapper = {
        viewer: {
            world: { getItemAt: () => ({ source: { dimensions: slide } }) },
            viewport,
        },
    };
    const index = new SpatialIndex(wrapper, options ?? {});
    index.attachTo(canvas);
    for (const o of objects) index.add(o);
    return index;
}

/** An OSD viewport stub reporting a fixed zoom against a fixed maximum. */
function fakeViewport(zoom, maxZoom = 4) {
    return { getZoom: () => zoom, getMaxZoom: () => maxZoom };
}

/**
 * The clustering recursion as it was before the rewrite: one rbush query and a
 * full eligibility pass per cell. Reads the index's own state so the two
 * implementations cannot drift on options, root rect or eligibility rules.
 */
function referenceClusters(index, canvas) {
    const opts = index.options;
    const vt = canvas.viewportTransform;
    const root = index._getClusterRoot();
    if (!root) return { rects: [], suppressed: new Set() };

    const c = canvas.vptCoords;
    const vpt = { minX: c.tl.x, minY: c.tl.y, maxX: c.br.x, maxY: c.br.y };
    const sx = Math.sqrt(vt[0] * vt[0] + vt[1] * vt[1]) || 1;
    const sy = Math.sqrt(vt[2] * vt[2] + vt[3] * vt[3]) || 1;
    const itemCapImg = (opts.clusterMinCellPx * opts.clusterMaxItemFactor) / sx;
    const exempt = index._exemptSet(canvas);
    const threshold = opts.clusterMinThreshold;

    const isClusterable = (o) => {
        if (o._idxOversized || o.__cluster) return false;
        if (o.isHighlight || o.__excludeFromCluster) return false;
        if (o.isHelperAnnotation) return false;
        if (exempt.has(o)) return false;
        const b = o._idxBox;
        if (!b) return false;
        return (b.maxX - b.minX) <= itemCapImg && (b.maxY - b.minY) <= itemCapImg;
    };

    const rects = [];
    const suppressed = new Set();
    const rec = (minX, minY, maxX, maxY, depth) => {
        if (maxX <= vpt.minX || minX >= vpt.maxX || maxY <= vpt.minY || minY >= vpt.maxY) return;
        const qMinX = Math.max(minX, vpt.minX);
        const qMinY = Math.max(minY, vpt.minY);
        const qMaxX = Math.min(maxX, vpt.maxX);
        const qMaxY = Math.min(maxY, vpt.maxY);
        const hits = index._tree.search({ minX: qMinX, minY: qMinY, maxX: qMaxX, maxY: qMaxY });
        let members = null;
        for (const b of hits) {
            if (!isClusterable(b._obj)) continue;
            if (!members) members = [];
            members.push(b._obj);
        }
        const count = members ? members.length : 0;
        if (count <= threshold) return;

        const minSidePx = Math.min(sx * (maxX - minX), sy * (maxY - minY));
        // Same emit rule as the implementation: on-screen cell size decides, and
        // running out of depth renders rather than pilling. This helper pins the
        // TRAVERSAL (one root query + partition vs a query per cell), not the
        // policy, so the two have to move together — otherwise it quietly starts
        // asserting the old policy instead of the new one.
        if (minSidePx <= opts.clusterMinCellPx) {
            rects.push({ image: { x: qMinX, y: qMinY, w: qMaxX - qMinX, h: qMaxY - qMinY }, count });
            for (const o of members) suppressed.add(o);
            return;
        }
        if (depth >= opts.clusterMaxDepth) return;
        const mx = (minX + maxX) * 0.5;
        const my = (minY + maxY) * 0.5;
        rec(minX, minY, mx, my, depth + 1);
        rec(mx, minY, maxX, my, depth + 1);
        rec(minX, my, mx, maxY, depth + 1);
        rec(mx, my, maxX, maxY, depth + 1);
    };
    rec(root.minX, root.minY, root.maxX, root.maxY, 0);
    return { rects, suppressed };
}

/** Comparable shape: cell geometry + count, in a stable order. */
function normalize(rects) {
    return rects
        .map(r => `${r.image.x},${r.image.y},${r.image.w},${r.image.h}:${r.count}`)
        .sort();
}

function idsOf(set) {
    return [...(set ?? [])].map(o => o.id).sort();
}

/**
 * A deterministic pseudo-random spread — a fixed LCG rather than Math.random,
 * so a failure is reproducible.
 */
function scatter(count, seed, { span = 4000, size = 12 } = {}) {
    let state = seed;
    const next = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
    const out = [];
    for (let i = 0; i < count; i++) out.push(obj(`o${i}`, next() * span, next() * span, size, size));
    return out;
}

test.beforeAll(async () => {
    shim = installBrowserGlobals({ extra: { OSDAnnotations: {} } });
    await loadBrowserScript(fromRoot("modules", "annotations", "ext", "rbush.min.js"), "RBush");
    await loadBrowserScript(fromRoot("modules", "annotations", "spatial-index.js"), "OSDAnnotations");
    SpatialIndex = globalThis.OSDAnnotations.SpatialIndex;
});

test.afterAll(() => shim?.restore());

test("the index loads and exposes SpatialIndex", { tag: ["@unit"] }, () => {
    expect(typeof SpatialIndex).toBe("function");
});

for (const [name, spec] of Object.entries({
    "dense uniform scatter": { objects: () => scatter(1200, 7), view: {} },
    "sparse scatter clusters nothing": { objects: () => scatter(30, 11), view: {} },
    "zoomed in": { objects: () => scatter(1200, 13), view: { zoom: 4, panX: -1200, panY: -900 } },
    "zoomed out past the slide": { objects: () => scatter(900, 17), view: { zoom: 0.2 } },
    "objects straddling the midpoint split": {
        // 4000-wide root halves at x=2000; wide boxes land in several children,
        // which is the case the partition rewrite has to reproduce exactly.
        objects: () => Array.from({ length: 400 }, (_, i) =>
            obj(`s${i}`, 1900 + (i % 20) * 10, 100 + i * 4, 120, 12)),
        view: {},
    },
})) {
    test(`clusters() matches the per-level-query reference: ${name}`, { tag: ["@unit"] }, () => {
        const objects = spec.objects();
        const canvas = fakeCanvas(objects, spec.view);
        const index = buildIndex(objects, canvas);

        const actual = index.clusters(canvas.vptCoords, canvas);
        const expected = referenceClusters(index, canvas);

        expect(normalize(actual.rects)).toEqual(normalize(expected.rects));
        expect(idsOf(actual.suppressed)).toEqual(idsOf(expected.suppressed));
    });
}

test("clusters() still exempts the active object", { tag: ["@unit"] }, () => {
    const objects = scatter(1200, 23);
    const canvas = fakeCanvas(objects, {});
    const index = buildIndex(objects, canvas);

    canvas._activeObject = objects[5];
    index.bumpSelection();

    const actual = index.clusters(canvas.vptCoords, canvas);
    const expected = referenceClusters(index, canvas);

    expect(actual.suppressed.has(objects[5]), "the active object is never clustered away").toBe(false);
    expect(normalize(actual.rects)).toEqual(normalize(expected.rects));
});

test("clusters() skips helpers, highlights and opted-out objects", { tag: ["@unit"] }, () => {
    const objects = scatter(1200, 29);
    objects[3].isHelperAnnotation = true;
    objects[4].isHighlight = true;
    objects[6].__excludeFromCluster = true;
    const canvas = fakeCanvas(objects, {});
    const index = buildIndex(objects, canvas);

    const actual = index.clusters(canvas.vptCoords, canvas);
    expect(idsOf(actual.suppressed)).toEqual(idsOf(referenceClusters(index, canvas).suppressed));
    for (const i of [3, 4, 6]) {
        expect(actual.suppressed.has(objects[i]), `object ${i} renders individually`).toBe(false);
    }
});

test("the cache answers a repeated query without recomputing", { tag: ["@unit"] }, () => {
    const objects = scatter(600, 31);
    const canvas = fakeCanvas(objects, {});
    const index = buildIndex(objects, canvas);

    const first = index.visibleObjects(canvas.vptCoords, canvas);
    expect(index.visibleObjects(canvas.vptCoords, canvas), "same array, not a recompute").toBe(first);

    const clusters = index.clusters(canvas.vptCoords, canvas);
    expect(index.clusters(canvas.vptCoords, canvas)).toBe(clusters);

    const candidates = index.realCandidates(canvas.vptCoords, canvas);
    expect(index.realCandidates(canvas.vptCoords, canvas)).toBe(candidates);
});

test("bumpSetCoords does NOT invalidate a viewport that did not move", { tag: ["@unit"] }, () => {
    const objects = scatter(600, 37);
    const canvas = fakeCanvas(objects, {});
    const index = buildIndex(objects, canvas);

    const first = index.visibleObjects(canvas.vptCoords, canvas);
    // What the setViewportTransform override does every frame. The oCoords
    // resync it drives is per-object and unrelated to which objects are visible.
    index.bumpSetCoords();
    expect(index.visibleObjects(canvas.vptCoords, canvas), "still the cached answer").toBe(first);
    expect(index.setCoordsVersion, "the version still advanced for ensureFresh").toBeGreaterThan(1);
});

test("a viewport that DID move misses the cache", { tag: ["@unit"] }, () => {
    const objects = scatter(600, 41);
    const canvas = fakeCanvas(objects, {});
    const index = buildIndex(objects, canvas);

    const first = index.visibleObjects(canvas.vptCoords, canvas);

    const moved = fakeCanvas(objects, { panX: -640, panY: -480 });
    canvas.viewportTransform = moved.viewportTransform;
    canvas.vptCoords = moved.vptCoords;

    expect(index.visibleObjects(canvas.vptCoords, canvas)).not.toBe(first);
});

test("a selection change misses the cache", { tag: ["@unit"] }, () => {
    const objects = scatter(600, 43);
    const canvas = fakeCanvas(objects, {});
    const index = buildIndex(objects, canvas);

    const first = index.visibleObjects(canvas.vptCoords, canvas);
    canvas._activeObject = objects[1];
    index.bumpSelection();
    expect(index.visibleObjects(canvas.vptCoords, canvas)).not.toBe(first);
});

/*
 * Clustering hides its members from `realCandidates`, which feeds the hit-test
 * path as well as the render path — a clustered annotation can be neither seen
 * nor clicked. That is only acceptable while zooming in dissolves the pill.
 * Two mechanisms used to break that guarantee, and these pin both.
 */

/** 3000 annotations packed into the viewport — dense enough to cluster hard. */
const dense = (seed) => scatter(3000, seed, { span: 400 });

test("no pills at or above the escape zoom, however dense the view", { tag: ["@unit"] }, () => {
    const objects = dense(61);
    const canvas = fakeCanvas(objects, {});
    // Far above `maxRenderedReal` (800): density used to re-enable clustering
    // here, which is what made a dense slide unreadable at maximum zoom.
    const index = buildIndex(objects, canvas, { viewport: fakeViewport(4, 4) });

    const result = index.clusters(canvas.vptCoords, canvas);
    expect(result.rects, "nothing is drawn as a pill").toEqual([]);
    expect(result.suppressed == null || result.suppressed.size === 0).toBe(true);

    const visible = index.visibleObjects(canvas.vptCoords, canvas);
    expect(visible.length, "the fixture really is denser than the old cap").toBeGreaterThan(800);
    expect(
        index.realCandidates(canvas.vptCoords, canvas).length,
        "every visible annotation stays hit-testable"
    ).toBe(visible.length);
});

test("the escape is a ramp: it starts at maxZoom * clusterEscapeZoomRatio", { tag: ["@unit"] }, () => {
    // Each index needs its OWN objects: `add()` no-ops on an object that already
    // carries an `_idxBox`, so re-indexing one array into a second index leaves
    // that index empty and every assertion below vacuously true.
    const clustersAt = (viewportZoom, seed) => {
        const objects = dense(seed);
        const canvas = fakeCanvas(objects, {});
        const index = buildIndex(objects, canvas, { viewport: fakeViewport(viewportZoom, 4) });
        return index.clusters(canvas.vptCoords, canvas).rects;
    };

    // Exactly on the boundary (0.5 * 4) — escaped.
    expect(clustersAt(2, 67)).toEqual([]);
    // A hair below it — clustering is still doing its job.
    expect(clustersAt(1.99, 67).length).toBeGreaterThan(0);
});

test("the escape ratio is configurable", { tag: ["@unit"] }, () => {
    const objects = dense(71);
    const canvas = fakeCanvas(objects, {});
    const index = buildIndex(objects, canvas, {
        viewport: fakeViewport(1, 4),
        options: { clusterEscapeZoomRatio: 0.25 },
    });
    expect(index.clusters(canvas.vptCoords, canvas).rects).toEqual([]);
});

test("running out of depth renders the cell instead of pilling it", { tag: ["@unit"] }, () => {
    // A tight knot of annotations inside ONE cell at the depth cap. The root is
    // the whole slide, so the finest reachable cell is slide/2^clusterMaxDepth;
    // at this zoom that cell is far larger than `clusterMinCellPx` on screen, so
    // there is nothing legitimate to hide. Emitting a pill here used to be a
    // floor no zoom could get past — the recursion stopped on depth, not on cell
    // size, so the pill survived at every magnification.
    const slide = { x: 4000, y: 4000 };
    const cell = slide.x / Math.pow(2, 8);              // 15.6 image px at depth 8
    const knot = Array.from({ length: 60 }, (_, i) =>
        obj(`k${i}`, 100 + (i % 10) * 0.4, 100 + Math.floor(i / 10) * 0.4, 0.5, 0.5));
    const canvas = fakeCanvas(knot, { zoom: 40, panX: -3900, panY: -3900 });
    const index = buildIndex(knot, canvas, { slide });

    const sx = canvas.viewportTransform[0];
    expect(sx * cell, "the depth-cap cell is large on screen, so a pill would be wrong")
        .toBeGreaterThan(index.options.clusterMinCellPx);

    const result = index.clusters(canvas.vptCoords, canvas);
    expect(result.rects, "the knot renders individually").toEqual([]);
    expect(result.suppressed.size).toBe(0);
});

test("a cell that is small on screen still pills, at any depth", { tag: ["@unit"] }, () => {
    // The other half of the rule: Fix 1 must not switch clustering off where it
    // is doing its job.
    const objects = dense(73);
    const canvas = fakeCanvas(objects, {});
    const index = buildIndex(objects, canvas);

    const result = index.clusters(canvas.vptCoords, canvas);
    expect(result.rects.length, "a zoomed-out dense view still clusters").toBeGreaterThan(0);
    for (const r of result.rects) {
        const sx = canvas.viewportTransform[0];
        expect(Math.min(sx * r.image.w, sx * r.image.h))
            .toBeLessThanOrEqual(index.options.clusterMinCellPx + 1e-9);
    }
});

/*
 * The cache used to be dropped wholesale on every frame by `bumpSetCoords`,
 * which meant no other mutation had to invalidate correctly — it just had to
 * survive until the next frame. Now that the cache genuinely persists, anything
 * feeding the visible set that is NOT part of the key has to say so itself.
 * These are the two that did not.
 */

test("marking an object dirty invalidates — it joins the visible set mid-drag", { tag: ["@unit"] }, () => {
    const inside = obj("inside", 100, 100, 20, 20);
    // Far outside the viewport: only `_dirty` can put it in the visible set.
    const dragged = obj("dragged", 3500, 3500, 20, 20);
    const objects = [inside, dragged];
    const canvas = fakeCanvas(objects, {});
    const index = buildIndex(objects, canvas);

    expect(index.visibleObjects(canvas.vptCoords, canvas).map(o => o.id)).toEqual(["inside"]);

    index.markDirty(dragged);
    expect(
        index.visibleObjects(canvas.vptCoords, canvas).map(o => o.id),
        "an object picked up mid-drag is always visible"
    ).toEqual(["inside", "dragged"]);

    index.clearDirty();
    expect(index.visibleObjects(canvas.vptCoords, canvas).map(o => o.id)).toEqual(["inside"]);
});

test("marking an already-dirty object again does not thrash the cache", { tag: ["@unit"] }, () => {
    const objects = scatter(200, 47);
    const canvas = fakeCanvas(objects, {});
    const index = buildIndex(objects, canvas);

    index.markDirty(objects[0]);
    const first = index.visibleObjects(canvas.vptCoords, canvas);
    index.markDirty(objects[0]);
    expect(index.visibleObjects(canvas.vptCoords, canvas), "no change, no recompute").toBe(first);
});

test("the slide resolving late invalidates the cluster root", { tag: ["@unit"] }, () => {
    const objects = scatter(1200, 53);
    const canvas = fakeCanvas(objects, {});

    // A wrapper whose slide dimensions only become available on the second ask,
    // which is what a still-opening viewer looks like.
    let dimensions = undefined;
    const wrapper = { viewer: { world: { getItemAt: () => ({ source: { dimensions } }) } } };
    const index = new SpatialIndex(wrapper, {});
    index.attachTo(canvas);
    for (const o of objects) index.add(o);

    index.clusters(canvas.vptCoords, canvas);
    index.visibleObjects(canvas.vptCoords, canvas);

    dimensions = { x: 4000, y: 4000 };
    index._ensureSlideThreshold();

    const after = index.clusters(canvas.vptCoords, canvas);
    const reference = referenceClusters(index, canvas);
    expect(normalize(after.rects), "clusters recomputed against the real slide box")
        .toEqual(normalize(reference.rects));
});

test("visibleObjects returns the visible set in canvas z-order", { tag: ["@unit"] }, () => {
    // Two on screen, one far outside; z-order is canvas._objects order, not
    // insertion or rbush order.
    const a = obj("a", 100, 100, 20, 20);
    const b = obj("b", 300, 300, 20, 20);
    const off = obj("off", 3500, 3500, 20, 20);
    const objects = [b, a, off];
    const canvas = fakeCanvas(objects, {});
    const index = buildIndex([a, b, off], canvas);

    expect(index.visibleObjects(canvas.vptCoords, canvas).map(o => o.id)).toEqual(["b", "a"]);
});
