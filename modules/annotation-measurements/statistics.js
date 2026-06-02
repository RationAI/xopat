(function (global) {
    'use strict';

    const NS = global.AnnotationMeasurements = global.AnnotationMeasurements || {};

    function meanOf(values) {
        const n = values.length;
        if (!n) return NaN;
        let sum = 0;
        for (let i = 0; i < n; i++) sum += values[i];
        return sum / n;
    }

    // In-place quickselect to find the k-th smallest. O(n) average; mutates.
    function quickselect(arr, k, lo, hi) {
        lo = lo ?? 0;
        hi = hi ?? arr.length - 1;
        while (lo < hi) {
            const pivot = arr[(lo + hi) >> 1];
            let i = lo, j = hi;
            while (i <= j) {
                while (arr[i] < pivot) i++;
                while (arr[j] > pivot) j--;
                if (i <= j) { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; i++; j--; }
            }
            if (k <= j) hi = j;
            else if (k >= i) lo = i;
            else return arr[k];
        }
        return arr[k];
    }

    // Median via quickselect on a copy (preserves the input).
    function medianOf(values) {
        const n = values.length;
        if (!n) return NaN;
        const buf = values.slice();
        const mid = n >> 1;
        const a = quickselect(buf, mid);
        if (n & 1) return a;
        const b = quickselect(buf, mid - 1, 0, mid);
        return (a + b) / 2;
    }

    function histogram(values, bins, range) {
        const n = values.length;
        const lo = range ? range[0] : 0;
        const hi = range ? range[1] : 255;
        const out = new Uint32Array(bins);
        if (!n || hi <= lo) return { bins: out, lo, hi };
        const span = hi - lo;
        for (let i = 0; i < n; i++) {
            const v = values[i];
            // Map [lo, hi] → [0, bins). Clamp out-of-range.
            let idx = ((v - lo) / span) * bins;
            if (idx < 0) idx = 0;
            else if (idx >= bins) idx = bins - 1;
            out[idx | 0]++;
        }
        return { bins: out, lo, hi };
    }

    function percentPositive(values, threshold) {
        const n = values.length;
        if (!n) return NaN;
        let count = 0;
        for (let i = 0; i < n; i++) if (values[i] >= threshold) count++;
        return count / n;
    }

    NS.stats = {
        mean: meanOf,
        median: medianOf,
        histogram,
        percentPositive,
    };
})(typeof window !== 'undefined' ? window : globalThis);
