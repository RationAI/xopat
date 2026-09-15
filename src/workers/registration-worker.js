/**
 * Slide registration worker.
 *
 * Estimates a 2D similarity transform (rotation + uniform scale + translation,
 * optionally with a mirror) between two low-resolution grayscale slide
 * thumbnails. Runs off the main thread: the search is a few thousand mask
 * lookups per iteration and would otherwise stall the render loop.
 *
 * Protocol (classic worker, structured clone):
 *   in : {id, ref:{w,h,gray:Uint8Array}, tgt:{w,h,gray:Uint8Array}, opts}
 *   out: {id, ok:true, result:{A:[a,b,c,d], b:{x,y}, flip, confidence, coverage}}
 *        {id, ok:false, error:string}
 *
 * The returned transform maps REF thumbnail pixels to TARGET thumbnail pixels:
 *   p_tgt = A * p_ref + b
 * The caller rescales it to full-resolution image pixels.
 */

const DEFAULTS = {
    detectFlip: true,
    // A mirrored fit must beat the best non-mirrored one by this margin before
    // we believe the slide was actually flipped (coverslip inversion is rare;
    // a spurious mirror is much worse than a missed one).
    flipMargin: 0.08,
    maxSamples: 6000,
    refineRounds: 7,
};

/** Otsu threshold over an 8-bit histogram. */
function otsu(gray) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];

    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (!wB) continue;
        const wF = total - wB;
        if (!wF) break;
        sumB += t * hist[t];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > best) { best = between; thr = t; }
    }
    return thr;
}

/**
 * Tissue mask: everything darker than the Otsu threshold. Brightfield WSIs are
 * bright background + darker tissue, so no polarity guessing is needed; we only
 * refuse degenerate masks (all/nothing) which would make the moments useless.
 */
function tissueMask(img) {
    const { w, h, gray } = img;
    const thr = otsu(gray);
    const mask = new Uint8Array(w * h);
    let count = 0;
    for (let i = 0; i < mask.length; i++) {
        if (gray[i] < thr) { mask[i] = 1; count++; }
    }
    const frac = count / mask.length;
    if (frac < 0.002 || frac > 0.98) return null;
    return { w, h, mask, count, thr };
}

/** Centroid + second moments → principal axis and anisotropy. */
function moments(m) {
    const { w, h, mask } = m;
    let n = 0, sx = 0, sy = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (!mask[y * w + x]) continue;
            n++; sx += x; sy += y;
        }
    }
    if (n < 16) return null;
    const cx = sx / n, cy = sy / n;

    let sxx = 0, syy = 0, sxy = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (!mask[y * w + x]) continue;
            const dx = x - cx, dy = y - cy;
            sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
        }
    }
    sxx /= n; syy /= n; sxy /= n;

    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const common = Math.sqrt((sxx - syy) * (sxx - syy) + 4 * sxy * sxy);
    const l1 = (sxx + syy + common) / 2;
    const l2 = (sxx + syy - common) / 2;
    const anisotropy = l1 > 1e-9 ? (l1 - l2) / (l1 + l2) : 0;

    return { n, cx, cy, theta, anisotropy, radius: Math.sqrt(l1) };
}

/** Sub-sampled list of mask pixel coordinates, capped at `maxSamples`. */
function sampleMask(m, maxSamples) {
    const { w, h, mask, count } = m;
    const step = Math.max(1, Math.round(Math.sqrt(count / maxSamples)));
    const pts = [];
    for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
            if (mask[y * w + x]) pts.push(x, y);
        }
    }
    return new Float32Array(pts);
}

/**
 * Symmetric silhouette agreement for `p_tgt = s*R*(p_ref - cRef) + cTgt + d`.
 * Coverage is measured in both directions and combined harmonically, so a fit
 * that shrinks the reference into a corner of the target (high one-way
 * coverage, nonsense alignment) scores near zero.
 */
function scoreParams(refPts, tgtPts, refM, tgtM, refMask, tgtMask, p) {
    const cos = Math.cos(p.rot) * p.scale;
    const sin = Math.sin(p.rot) * p.scale;

    // forward: ref -> tgt
    let hit = 0;
    for (let i = 0; i < refPts.length; i += 2) {
        const dx = refPts[i] - refM.cx, dy = refPts[i + 1] - refM.cy;
        const x = (cos * dx - sin * dy) + tgtM.cx + p.dx;
        const y = (sin * dx + cos * dy) + tgtM.cy + p.dy;
        const xi = x | 0, yi = y | 0;
        if (xi >= 0 && yi >= 0 && xi < tgtMask.w && yi < tgtMask.h && tgtMask.mask[yi * tgtMask.w + xi]) hit++;
    }
    const covRef = hit / (refPts.length / 2);
    if (covRef <= 0) return 0;

    // inverse: tgt -> ref
    const inv = 1 / (p.scale * p.scale);
    const icos = cos * inv, isin = -sin * inv;
    let hit2 = 0;
    for (let i = 0; i < tgtPts.length; i += 2) {
        const dx = tgtPts[i] - tgtM.cx - p.dx, dy = tgtPts[i + 1] - tgtM.cy - p.dy;
        const x = (icos * dx - isin * dy) + refM.cx;
        const y = (isin * dx + icos * dy) + refM.cy;
        const xi = x | 0, yi = y | 0;
        if (xi >= 0 && yi >= 0 && xi < refMask.w && yi < refMask.h && refMask.mask[yi * refMask.w + xi]) hit2++;
    }
    const covTgt = hit2 / (tgtPts.length / 2);
    if (covTgt <= 0) return 0;

    return (2 * covRef * covTgt) / (covRef + covTgt);
}

/** Coarse-to-fine pattern search over (dx, dy, rot, log scale). */
function refine(refPts, tgtPts, refM, tgtM, refMask, tgtMask, seed, rounds) {
    let best = { ...seed };
    let bestScore = scoreParams(refPts, tgtPts, refM, tgtM, refMask, tgtMask, best);

    let stepT = Math.max(4, 0.15 * Math.max(tgtMask.w, tgtMask.h));
    let stepR = 10 * Math.PI / 180;
    let stepS = 0.12;

    for (let round = 0; round < rounds; round++) {
        let improved = true;
        while (improved) {
            improved = false;
            const trials = [
                { dx: best.dx + stepT }, { dx: best.dx - stepT },
                { dy: best.dy + stepT }, { dy: best.dy - stepT },
                { rot: best.rot + stepR }, { rot: best.rot - stepR },
                { scale: best.scale * (1 + stepS) }, { scale: best.scale / (1 + stepS) },
            ];
            for (const t of trials) {
                const cand = { ...best, ...t };
                if (cand.scale < 0.05 || cand.scale > 20) continue;
                const s = scoreParams(refPts, tgtPts, refM, tgtM, refMask, tgtMask, cand);
                if (s > bestScore + 1e-6) { bestScore = s; best = cand; improved = true; }
            }
        }
        stepT *= 0.5; stepR *= 0.5; stepS *= 0.5;
    }
    return { params: best, score: bestScore };
}

/** Build the ref→tgt matrix form of a parameter set. */
function toMatrix(params, refM, tgtM, mirrorWidth) {
    const cos = Math.cos(params.rot) * params.scale;
    const sin = Math.sin(params.rot) * params.scale;
    let A = [cos, -sin, sin, cos];

    // p = A*(pRef - cRef) + cTgt + d  ->  b = cTgt + d - A*cRef
    let b = {
        x: tgtM.cx + params.dx - (A[0] * refM.cx + A[1] * refM.cy),
        y: tgtM.cy + params.dy - (A[2] * refM.cx + A[3] * refM.cy),
    };

    if (typeof mirrorWidth === "number") {
        // The fit was made against a horizontally mirrored reference:
        //   pMirror = M*pRef + (W-1, 0),  M = diag(-1, 1)
        // Fold that into the returned transform so the caller always receives a
        // plain ref→tgt matrix (the mapper multiplies by a generic 2×2).
        const Am = [-A[0], A[1], -A[2], A[3]];
        b = {
            x: b.x + A[0] * (mirrorWidth - 1),
            y: b.y + A[2] * (mirrorWidth - 1),
        };
        A = Am;
    }
    return { A, b };
}

function mirrorImage(img) {
    const { w, h, gray } = img;
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) out[row + x] = gray[row + (w - 1 - x)];
    }
    return { w, h, gray: out };
}

function estimate(ref, tgt, opts) {
    const o = { ...DEFAULTS, ...(opts || {}) };

    const tgtMask = tissueMask(tgt);
    if (!tgtMask) throw new Error("target thumbnail has no usable tissue mask");
    const tgtM = moments(tgtMask);
    if (!tgtM) throw new Error("target tissue too small");
    const tgtPts = sampleMask(tgtMask, o.maxSamples);

    const variants = [{ img: ref, mirror: false }];
    if (o.detectFlip) variants.push({ img: mirrorImage(ref), mirror: true });

    let best = null;
    for (const variant of variants) {
        const refMask = tissueMask(variant.img);
        if (!refMask) continue;
        const refM = moments(refMask);
        if (!refM) continue;
        const refPts = sampleMask(refMask, o.maxSamples);

        const scale0 = Math.sqrt(tgtM.n / refM.n);
        // The principal axis is defined modulo 180°, and the seed scale can be
        // off when one scan crops more background — try both orientations and,
        // when the shape is nearly isotropic, a plain no-rotation seed too.
        const rotSeeds = [tgtM.theta - refM.theta, tgtM.theta - refM.theta + Math.PI];
        if (refM.anisotropy < 0.15 || tgtM.anisotropy < 0.15) rotSeeds.push(0, Math.PI / 2, Math.PI, -Math.PI / 2);

        for (const rot of rotSeeds) {
            for (const scale of [scale0, scale0 * 0.8, scale0 * 1.25]) {
                const seed = { dx: 0, dy: 0, rot, scale };
                const r = refine(refPts, tgtPts, refM, tgtM, refMask, tgtMask, seed, o.refineRounds);
                const penalized = variant.mirror ? r.score - o.flipMargin : r.score;
                if (!best || penalized > best.penalized) {
                    best = { ...r, penalized, mirror: variant.mirror, refM, refWidth: refMask.w };
                }
            }
        }
    }

    if (!best) throw new Error("reference thumbnail has no usable tissue mask");

    const { A, b } = toMatrix(best.params, best.refM, tgtM, best.mirror ? best.refWidth : undefined);
    return {
        A, b,
        flip: best.mirror,
        confidence: best.score,
        coverage: best.score,
    };
}

self.onmessage = (e) => {
    const msg = e.data;
    if (!msg || msg.type !== "estimate") return;
    try {
        const result = estimate(msg.ref, msg.tgt, msg.opts);
        self.postMessage({ id: msg.id, ok: true, result });
    } catch (err) {
        self.postMessage({ id: msg.id, ok: false, error: String(err && err.message || err) });
    }
};
