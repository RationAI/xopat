(function (global) {
    'use strict';

    const NS = global.AnnotationMeasurements = global.AnnotationMeasurements || {};

    // Union-find used by the row-pass labeler. We keep parents sparse so a
    // single-component mask doesn't allocate the whole label range.
    function makeUF(initialCapacity) {
        let ufParents = new Int32Array(initialCapacity || 64);
        let nextLabel = 1; // 0 reserved for background
        function newLabel() {
            if (nextLabel >= ufParents.length) {
                const grown = new Int32Array(ufParents.length * 2);
                grown.set(ufParents);
                ufParents = grown;
            }
            ufParents[nextLabel] = nextLabel;
            return nextLabel++;
        }
        function find(x) {
            while (ufParents[x] !== x) {
                ufParents[x] = ufParents[ufParents[x]];
                x = ufParents[x];
            }
            return x;
        }
        function union(a, b) {
            const ra = find(a), rb = find(b);
            if (ra === rb) return ra;
            if (ra < rb) { ufParents[rb] = ra; return ra; }
            ufParents[ra] = rb; return rb;
        }
        return {
            newLabel,
            find,
            union,
            count: () => nextLabel - 1,
            get parents() { return ufParents; },
        };
    }

    /**
     * 4-connected two-pass labeling on a binary mask (1 = foreground, 0 = bg).
     * Returns:
     *  - labels: Int32Array (mask.length) with compacted labels (1..K, 0 = bg)
     *  - count: K
     *  - sizes: Uint32Array (length K+1, [0] unused)
     *  - perimeters: Uint32Array — count of foreground pixels with ≥1 4-neighbor
     *      that is background or out-of-bounds
     *  - bboxes: Int32Array (4*(K+1)) packed as [minX, minY, maxX, maxY]
     */
    function labelConnected(mask, width, height) {
        const n = mask.length;
        const raw = new Int32Array(n); // raw labels; remapped at the end
        const uf = makeUF(Math.max(64, Math.floor(n / 8)));

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (!mask[idx]) continue;
                const upIdx = idx - width;
                const leftIdx = idx - 1;
                const up = y > 0 ? raw[upIdx] : 0;
                const left = x > 0 ? raw[leftIdx] : 0;
                if (up && left) {
                    raw[idx] = uf.union(up, left);
                } else if (up) {
                    raw[idx] = up;
                } else if (left) {
                    raw[idx] = left;
                } else {
                    raw[idx] = uf.newLabel();
                }
            }
        }

        // Compact labels to 1..K
        const remap = new Int32Array(uf.parents.length);
        let nextOut = 1;
        const labels = raw; // reuse storage
        for (let i = 0; i < n; i++) {
            const l = labels[i];
            if (!l) continue;
            const root = uf.find(l);
            let dst = remap[root];
            if (!dst) { dst = nextOut++; remap[root] = dst; }
            labels[i] = dst;
        }

        const K = nextOut - 1;
        const sizes = new Uint32Array(K + 1);
        const perimeters = new Uint32Array(K + 1);
        const bboxes = new Int32Array(4 * (K + 1));
        for (let k = 0; k <= K; k++) {
            bboxes[4 * k] = Number.MAX_SAFE_INTEGER;
            bboxes[4 * k + 1] = Number.MAX_SAFE_INTEGER;
            bboxes[4 * k + 2] = -1;
            bboxes[4 * k + 3] = -1;
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const k = labels[idx];
                if (!k) continue;
                sizes[k]++;
                const b = 4 * k;
                if (x < bboxes[b]) bboxes[b] = x;
                if (y < bboxes[b + 1]) bboxes[b + 1] = y;
                if (x > bboxes[b + 2]) bboxes[b + 2] = x;
                if (y > bboxes[b + 3]) bboxes[b + 3] = y;

                // Perimeter: pixel touches the boundary if any 4-neighbor is bg/oob.
                const upBg = y === 0 || labels[idx - width] !== k;
                if (upBg) { perimeters[k]++; continue; }
                const downBg = y === height - 1 || labels[idx + width] !== k;
                if (downBg) { perimeters[k]++; continue; }
                const leftBg = x === 0 || labels[idx - 1] !== k;
                if (leftBg) { perimeters[k]++; continue; }
                const rightBg = x === width - 1 || labels[idx + 1] !== k;
                if (rightBg) { perimeters[k]++; }
            }
        }

        return { labels, count: K, sizes, perimeters, bboxes };
    }

    /**
     * Build per-component statistics from a labelConnected() result.
     * Returns:
     *  - count
     *  - sizes (Uint32Array, K entries — index 0 = first component)
     *  - perimeters (Uint32Array)
     *  - circularities (Float32Array): 4πA / P². For very small components
     *      perimeter < 3 is clamped to 3 to keep the metric finite.
     *  - meanArea, medianArea, p10/p50/p90 (size percentiles)
     */
    function componentStats(labelResult) {
        const K = labelResult.count;
        const sizesAll = labelResult.sizes;
        const perimsAll = labelResult.perimeters;
        const sizes = new Uint32Array(K);
        const perimeters = new Uint32Array(K);
        for (let k = 1; k <= K; k++) {
            sizes[k - 1] = sizesAll[k];
            perimeters[k - 1] = perimsAll[k];
        }
        const circularities = new Float32Array(K);
        for (let k = 0; k < K; k++) {
            const A = sizes[k];
            const P = Math.max(3, perimeters[k]);
            circularities[k] = (4 * Math.PI * A) / (P * P);
        }

        let meanArea = 0;
        for (let k = 0; k < K; k++) meanArea += sizes[k];
        meanArea = K ? meanArea / K : NaN;

        let medianArea = NaN, p10 = NaN, p50 = NaN, p90 = NaN;
        if (K) {
            const sorted = Array.from(sizes).sort((a, b) => a - b);
            const pick = (q) => {
                if (!sorted.length) return NaN;
                const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
                return sorted[i];
            };
            p10 = pick(0.1);
            p50 = pick(0.5);
            p90 = pick(0.9);
            medianArea = p50;
        }

        return {
            count: K,
            sizes,
            perimeters,
            circularities,
            meanArea,
            medianArea,
            p10,
            p50,
            p90,
        };
    }

    NS.components = {
        labelConnected,
        componentStats,
    };
})(typeof window !== 'undefined' ? window : globalThis);
