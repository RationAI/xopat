/**
 * Turn a binary cell grid into polygon rings.
 *
 * Not marching squares. The source masks in `test/fixtures/data/slides/` are not smooth
 * probability fields — they are a **grid of 512x512-pixel prediction squares**
 * (measured: nonzero runs are multiples of 4 at pyramid level 7 and 32 at level
 * 4, both of which are 512 full-resolution pixels). Contouring an iso-line
 * through that would invent diagonal boundaries the model never produced.
 *
 * So the rings here follow cell EDGES exactly: every vertex sits on a grid line,
 * and the polygon is the precise union of the cells above threshold. Collinear
 * runs are then merged, which is lossless — a long horizontal boundary becomes
 * two vertices instead of two hundred. What comes out is what the model said.
 *
 * Coordinates are in cell units; the caller scales them to slide pixels.
 */

/**
 * Extract closed rings from a binary grid.
 *
 * Emits one directed edge per cell side that separates inside from outside,
 * oriented so the inside is always on the same hand. Chaining those edges gives
 * closed rings: outer boundaries in one winding, holes in the other.
 *
 * @param {Uint8Array} grid    `width * height`, non-zero = inside
 * @param {number} width
 * @param {number} height
 * @return {number[][][]} rings, each an array of `[x, y]` grid-line vertices,
 *     first vertex repeated as last
 */
export function traceCellRings(grid, width, height) {
    const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height && grid[y * width + x] !== 0;

    // key: "x,y" of the edge start -> list of edge end vertices.
    // A vertex normally has one outgoing edge; a diagonal pinch (two inside
    // cells meeting corner-to-corner) gives it two, which is why this is a list.
    const out = new Map();
    const push = (ax, ay, bx, by) => {
        const key = ax + "," + ay;
        const list = out.get(key);
        if (list) list.push([bx, by]);
        else out.set(key, [[bx, by]]);
    };

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!inside(x, y)) continue;
            // Cell (x,y) spans the square [x,x+1] x [y,y+1] in grid-line space.
            if (!inside(x, y - 1)) push(x, y, x + 1, y);             // top,    ->
            if (!inside(x + 1, y)) push(x + 1, y, x + 1, y + 1);     // right,  v
            if (!inside(x, y + 1)) push(x + 1, y + 1, x, y + 1);     // bottom, <-
            if (!inside(x - 1, y)) push(x, y + 1, x, y);             // left,   ^
        }
    }

    /**
     * Pick the next edge out of `at`, having arrived along `incoming`.
     *
     * Only matters at a pinch — a vertex where two cells meet corner to corner
     * and two edges leave. Taking the tightest right turn keeps the traversal
     * inside the component it is already walking, so the two blobs come out as
     * two rings. Popping arbitrarily instead yields one ring that touches
     * itself at that vertex, which is a self-intersecting ring and therefore
     * invalid GeoJSON (RFC 7946 s3.1.6) — renderers mostly cope, tessellators
     * mostly do not.
     */
    const takeNext = (list, at, incoming) => {
        if (list.length === 1) return list.pop();
        let bestIndex = 0;
        let bestTurn = -Infinity;
        for (let i = 0; i < list.length; i++) {
            const dx = list[i][0] - at[0];
            const dy = list[i][1] - at[1];
            // Screen coordinates are y-down, so a positive cross product is a
            // clockwise turn. Rank by angle so "straight on" loses to "turn
            // right" and both beat "turn back".
            const cross = incoming[0] * dy - incoming[1] * dx;
            const dot = incoming[0] * dx + incoming[1] * dy;
            const turn = Math.atan2(cross, dot);
            if (turn > bestTurn) { bestTurn = turn; bestIndex = i; }
        }
        return list.splice(bestIndex, 1)[0];
    };

    const rings = [];
    for (const [startKey, startList] of out) {
        while (startList.length) {
            const first = startKey.split(",").map(Number);
            const ring = [first];
            let cursor = startList.pop();
            ring.push(cursor);
            let incoming = [cursor[0] - first[0], cursor[1] - first[1]];

            // Follow the chain until it returns to the start. The edge set is a
            // union of closed cycles by construction, so this terminates; the
            // bound is a guard against a corrupted map, not an expected exit.
            let guard = 0;
            const limit = 4 * width * height + 8;
            while ((cursor[0] !== first[0] || cursor[1] !== first[1]) && guard++ < limit) {
                const list = out.get(cursor[0] + "," + cursor[1]);
                if (!list || !list.length) break;
                const next = takeNext(list, cursor, incoming);
                incoming = [next[0] - cursor[0], next[1] - cursor[1]];
                cursor = next;
                ring.push(cursor);
            }

            if (ring.length > 3) rings.push(mergeCollinear(ring));
        }
    }
    return rings;
}

/**
 * Drop vertices that lie on the straight segment between their neighbours.
 * Lossless for rectilinear rings, and it is what keeps a 434-cell-tall boundary
 * from costing 434 points.
 *
 * @param {number[][]} ring closed ring (first vertex repeated as last)
 * @return {number[][]} closed ring
 */
export function mergeCollinear(ring) {
    // Work on the open ring, then re-close.
    const open = ring.slice(0, ring.length - 1);
    const n = open.length;
    if (n < 3) return ring;

    const kept = [];
    for (let i = 0; i < n; i++) {
        const prev = open[(i - 1 + n) % n];
        const cur = open[i];
        const next = open[(i + 1) % n];
        const cross = (cur[0] - prev[0]) * (next[1] - prev[1]) - (cur[1] - prev[1]) * (next[0] - prev[0]);
        if (cross !== 0) kept.push(cur);
    }
    if (kept.length < 3) return ring;
    return kept.concat([kept[0]]);
}

/**
 * Signed area of a closed ring (shoelace / 2). Sign encodes winding; in a
 * y-down raster coordinate system the sign of an outer ring is the opposite of
 * a hole's, which is all we use it for.
 * @param {number[][]} ring
 * @return {number}
 */
export function signedArea(ring) {
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return sum / 2;
}

/** Ray-casting containment test; the ring is assumed closed. */
export function pointInRing(ring, px, py) {
    let hit = false;
    for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
}

/**
 * Group rings into GeoJSON polygons: each outer ring followed by the holes it
 * contains. Holes are matched to the SMALLEST containing outer ring, so a hole
 * inside an island inside a hole lands on the right parent.
 *
 * @param {number[][][]} rings
 * @param {number} minArea drop rings whose |area| is below this (cell units)
 * @return {number[][][][]} array of polygons, each `[outer, ...holes]`
 */
export function assemblePolygons(rings, minArea = 0) {
    const scored = rings
        .map(ring => ({ ring, area: signedArea(ring) }))
        .filter(r => Math.abs(r.area) >= minArea);
    if (!scored.length) return [];

    // The dominant winding is the outer one: cells above threshold are the
    // figure, holes are the exception.
    const positive = scored.filter(r => r.area > 0);
    const negative = scored.filter(r => r.area < 0);
    const outers = positive.length >= negative.length ? positive : negative;
    const holes = outers === positive ? negative : positive;

    const polygons = outers
        .sort((a, b) => Math.abs(a.area) - Math.abs(b.area))
        .map(o => [o.ring]);

    for (const hole of holes) {
        const [hx, hy] = hole.ring[0];
        // `polygons` is sorted smallest-first, so the first container is the
        // tightest one.
        const parent = polygons.find(poly => pointInRing(poly[0], hx, hy));
        if (parent) parent.push(hole.ring);
    }
    return polygons;
}

/**
 * Full pipeline: threshold a score raster into a cell grid, trace it, and return
 * GeoJSON-ready polygons in cell coordinates.
 *
 * @param {Uint8Array} cells   score per cell, `width * height`
 * @param {number} width
 * @param {number} height
 * @param {number} lo          inclusive lower score bound
 * @param {number} hi          inclusive upper score bound
 * @param {number} minArea     minimum ring area in cells
 * @return {number[][][][]}
 */
export function polygonsForBand(cells, width, height, lo, hi, minArea = 1) {
    const grid = new Uint8Array(width * height);
    for (let i = 0; i < cells.length; i++) {
        grid[i] = cells[i] >= lo && cells[i] <= hi ? 1 : 0;
    }
    return assemblePolygons(traceCellRings(grid, width, height), minArea);
}
