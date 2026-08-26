/**
 * radiology-geometry.mjs — pure slice-model helpers for DICOM radiology series
 * (CT / MR / PT / CR / DX / NM).
 *
 * A WSI series is *one image* whose instances are pyramid levels. A radiology
 * series is the opposite: N instances (or N frames of one enhanced instance)
 * that are the *same raster at different depths*. That is exactly the shape the
 * core z-stack contract describes (`src/ZSTACK.md`), so the job of this module
 * is to turn a pile of instance metadata into an ordered plane list plus the
 * `{count, index, spacingUm, labels}` descriptor the contract wants.
 *
 * Everything here is side-effect free — no network, no DOM, no plugin state —
 * so the ordering rules are unit-testable without a DICOM server. Network I/O
 * lives in `dicom-query.mjs`; the tile source only consumes the model.
 *
 * ## The rule that governs the whole file
 *
 * A radiology stack drives a *quantitative* display. When the metadata does not
 * unambiguously say what the depth axis is, guessing produces a plausible
 * picture of the wrong thing — slices in the wrong order, two interleaved
 * volumes combed together, or a spacing that is off by the overlap factor. So
 * every ambiguity below resolves to one of: pick the unambiguous subset and
 * report what was dropped, or refuse the series outright. Nothing is inferred
 * silently.
 */

import { storedValueRange } from "./pixel-pipeline.mjs";

/* ------------------------------------------------------------------ */
/* Local DICOM-JSON accessors                                          */
/* ------------------------------------------------------------------ */

// Duplicated from pixel-pipeline.mjs / dicom-query.mjs for the same reason they
// duplicate each other: importing the query layer here would close an import
// cycle, and this module's value is that it depends on nothing.
const va = (ds, tag) => ds?.[tag]?.Value || null;
const v = (ds, tag) => { const x = va(ds, tag); return Array.isArray(x) ? x[0] : (x ?? null); };
const iv = (ds, tag) => {
    const x = v(ds, tag);
    if (x == null) return undefined;
    const n = typeof x === "string" ? parseInt(x, 10) : Number(x);
    return Number.isFinite(n) ? n : undefined;
};
const fv = (ds, tag) => {
    const x = v(ds, tag);
    if (x == null) return undefined;
    const n = typeof x === "string" ? parseFloat(x) : Number(x);
    return Number.isFinite(n) ? n : undefined;
};
const nums = (ds, tag) => {
    const x = va(ds, tag);
    if (!Array.isArray(x)) return null;
    const out = x.map(Number);
    return out.every(Number.isFinite) ? out : null;
};
const str = (x) => (x == null ? null : String(x));

/** First item of a sequence element, or null. */
const seqItem = (ds, tag) => ds?.[tag]?.Value?.[0] ?? null;

/* ------------------------------------------------------------------ */
/* Constants and small vector maths                                    */
/* ------------------------------------------------------------------ */

/**
 * Largest raster we will open. A mammography DX at 4728x5928 must work; beyond
 * this we are past `MAX_TEXTURE_SIZE` on common hardware and would render a
 * black tile with no explanation. Refuse loudly instead.
 */
export const RADIOLOGY_MAX_DIMENSION = 8192;

/** cos(1 degree) — the orientation-clustering tolerance. */
const ORIENTATION_COS_TOLERANCE = 0.9998477;

/** Relative spread above which consecutive spacings count as irregular. */
const IRREGULAR_SPREAD = 0.01;

/** A consecutive delta this many times the median is a gap, not a slice step. */
const GAP_FACTOR = 3;

/** Two planes closer than this (mm, or medianDelta/100) are co-located. */
const COLOCATION_EPSILON_MM = 0.01;

/** Modality-specific clamps for the normalization range (see chooseValueRange). */
const CT_HU_CLAMP = { min: -1024, max: 3071 };

const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.sqrt(dot(a, a));

/**
 * Unit normal of an ImageOrientationPatient sextet, or null when the value is
 * absent or degenerate (non-orthogonal direction cosines, zero-length cross).
 */
export function normalFromOrientation(iop) {
    if (!Array.isArray(iop) || iop.length < 6 || !iop.every(Number.isFinite)) return null;
    const n = cross(iop.slice(0, 3), iop.slice(3, 6));
    const len = norm(n);
    // The two direction cosines are unit and orthogonal, so |r x c| must be 1.
    // A meaningful deviation means the attribute is corrupt, not merely rounded.
    if (!(len > 0.99 && len < 1.01)) return null;
    return [n[0] / len, n[1] / len, n[2] / len];
}

const median = (sorted) => {
    if (!sorted.length) return NaN;
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/* ------------------------------------------------------------------ */
/* Plane candidates                                                    */
/* ------------------------------------------------------------------ */

/**
 * @typedef {object} PlaneCandidate
 * @property {string} instanceUID SOPInstanceUID
 * @property {number} frame 1-based WADO frame number
 * @property {number[]|null} ipp ImagePositionPatient
 * @property {number[]|null} iop ImageOrientationPatient
 * @property {number|undefined} sliceLocation
 * @property {number|undefined} instanceNumber
 * @property {number|undefined} inStackPosition InStackPositionNumber (multiframe)
 * @property {number|undefined} rows
 * @property {number|undefined} cols
 * @property {number[]|null} pixelSpacing [rowSpacing, colSpacing] in mm
 * @property {number|undefined} sliceThickness
 * @property {number|undefined} spacingBetweenSlices
 * @property {string|null} photometricInterpretation
 * @property {Record<string, string|null>} keys discriminators for interleaved volumes
 */

/**
 * The attributes that distinguish two *co-located* planes. If any of them
 * differs, the series holds more than one volume and combing them into a single
 * depth axis would be wrong (a dual-echo MR would alternate contrast every
 * slice). Order matters only for the readability of the generated key.
 */
const DISCRIMINATOR_TAGS = [
    ["stackId", "00209056"],             // StackID
    ["echoNumber", "00180086"],          // EchoNumbers
    ["echoTime", "00180081"],            // EchoTime
    ["temporalPosition", "00200100"],    // TemporalPositionIdentifier
    ["acquisitionNumber", "00200012"],   // AcquisitionNumber
    ["bValue", "00189087"],              // DiffusionBValue
];

function discriminatorsOf(ds, extra = {}) {
    const keys = {};
    for (const [name, tag] of DISCRIMINATOR_TAGS) {
        const value = v(ds, tag);
        if (value != null && value !== "") keys[name] = String(value);
    }
    // ImageType value 3 is the vendor's own "which flavour of image is this"
    // slot (e.g. IN_PHASE / OUT_PHASE, or the PET correction state).
    const imageType = va(ds, "00080008");
    if (Array.isArray(imageType) && imageType[2] != null) keys.imageType3 = String(imageType[2]);

    // A per-plane rescale that differs is itself a discriminator: two planes at
    // the same depth mapping stored values to different real-world values are
    // not the same measurement.
    const slope = fv(ds, "00281053");
    const intercept = fv(ds, "00281052");
    if (Number.isFinite(slope) || Number.isFinite(intercept)) {
        keys.rescale = `${Number.isFinite(slope) ? slope : 1}/${Number.isFinite(intercept) ? intercept : 0}`;
    }

    return { ...keys, ...extra };
}

/**
 * Build a plane candidate from an instance-level dataset — either a QIDO
 * instance row or a full WADO `/metadata` item. Both are DICOM-JSON, so one
 * reader serves both.
 *
 * @param {object} ds
 * @returns {PlaneCandidate|null} null when the dataset carries no SOPInstanceUID
 */
export function planeCandidateFromInstance(ds) {
    const instanceUID = v(ds, "00080018");
    if (!instanceUID) return null;

    return {
        instanceUID: String(instanceUID),
        frame: 1,
        ipp: nums(ds, "00200032"),
        iop: nums(ds, "00200037"),
        sliceLocation: fv(ds, "00201041"),
        instanceNumber: iv(ds, "00200013"),
        inStackPosition: undefined,
        rows: iv(ds, "00280010"),
        cols: iv(ds, "00280011"),
        pixelSpacing: nums(ds, "00280030"),
        sliceThickness: fv(ds, "00180050"),
        spacingBetweenSlices: fv(ds, "00180088"),
        photometricInterpretation: str(v(ds, "00280004"))?.toUpperCase().trim() ?? null,
        keys: discriminatorsOf(ds),
    };
}

/**
 * Build one candidate per frame of an enhanced multi-frame instance.
 *
 * Geometry lives in the Per-Frame Functional Groups (5200,9230); anything a
 * frame does not override is inherited from the Shared groups (5200,9229). Both
 * are searched here rather than through `resolveTagScoped`, because that helper
 * only ever looks in the *shared* branch — which is precisely the branch that is
 * wrong when a per-frame value exists.
 *
 * @param {object} ds instance-level dataset with (5200,9230) present
 * @returns {PlaneCandidate[]}
 */
export function planeCandidatesFromMultiframe(ds) {
    const perFrame = va(ds, "52009230");
    if (!Array.isArray(perFrame) || !perFrame.length) return [];

    const shared = seqItem(ds, "52009229");
    const sharedPos = shared ? seqItem(shared, "00209113") : null;
    const sharedOrient = shared ? seqItem(shared, "00209116") : null;
    const sharedMeasures = shared ? seqItem(shared, "00289110") : null;   // PixelMeasuresSequence
    const sharedTransform = shared ? seqItem(shared, "00289145") : null;  // PixelValueTransformationSequence

    const instanceUID = String(v(ds, "00080018") ?? "");
    const rows = iv(ds, "00280010");
    const cols = iv(ds, "00280011");
    const photometric = str(v(ds, "00280004"))?.toUpperCase().trim() ?? null;

    return perFrame.map((fg, i) => {
        const pos = seqItem(fg, "00209113") || sharedPos;
        const orient = seqItem(fg, "00209116") || sharedOrient;
        const measures = seqItem(fg, "00289110") || sharedMeasures;
        const transform = seqItem(fg, "00289145") || sharedTransform;
        const content = seqItem(fg, "00209111");   // FrameContentSequence

        return {
            instanceUID,
            frame: i + 1,
            ipp: pos ? nums(pos, "00200032") : null,
            iop: orient ? nums(orient, "00200037") : null,
            sliceLocation: undefined,
            // A frame has no InstanceNumber of its own; its ordinal within the
            // instance is the only stable fallback.
            instanceNumber: i + 1,
            inStackPosition: content ? iv(content, "00209057") : undefined,
            rows,
            cols,
            pixelSpacing: measures ? nums(measures, "00280030") : nums(ds, "00280030"),
            sliceThickness: measures ? fv(measures, "00180050") : fv(ds, "00180050"),
            spacingBetweenSlices: measures ? fv(measures, "00180088") : fv(ds, "00180088"),
            photometricInterpretation: photometric,
            keys: discriminatorsOf(content || {}, transformKeys(transform)),
        };
    });
}

function transformKeys(transform) {
    if (!transform) return {};
    const slope = fv(transform, "00281053");
    const intercept = fv(transform, "00281052");
    if (!Number.isFinite(slope) && !Number.isFinite(intercept)) return {};
    return { rescale: `${Number.isFinite(slope) ? slope : 1}/${Number.isFinite(intercept) ? intercept : 0}` };
}

/* ------------------------------------------------------------------ */
/* The plane model                                                     */
/* ------------------------------------------------------------------ */

/**
 * @typedef {object} PlaneModel
 * @property {{instanceUID:string, frame:number, position:number|null, label:string}[]} planes
 * @property {number|undefined} spacingUm centre-to-centre plane distance, micrometres
 * @property {"positions"|"spacing-between-slices"|"slice-thickness"|null} spacingSource
 * @property {boolean} irregular spacing varies by more than 1%
 * @property {"ipp-normal"|"slice-location"|"instance-number"} orderStrategy
 * @property {{key:string, count:number, label:string}[]} subVolumes
 * @property {string|null} activeSubVolume
 * @property {{reason:string, count:number}[]} rejected
 * @property {string[]} warnings
 * @property {{rows:number, cols:number, pixelSpacing:number[]|null}} raster
 */

/** A refusal carries the reason instead of a half-usable model. */
const refuse = (reason) => ({ error: reason });

/**
 * Turn plane candidates into an ordered, single-volume plane model.
 *
 * @param {PlaneCandidate[]} candidates
 * @param {object} [opts]
 * @param {string} [opts.subVolume] pick this sub-volume key instead of the largest
 * @returns {PlaneModel|{error:string}}
 */
export function buildPlaneModel(candidates, opts = {}) {
    const warnings = [];
    const rejected = [];

    const input = (candidates || []).filter(c => c && c.instanceUID);
    if (!input.length) return refuse("no instances in series");

    const rasterCheck = validateCommonRaster(input);
    if (rasterCheck.error) return rasterCheck;

    const ordered = orderCandidates(input, warnings, rejected);
    if (ordered.error) return ordered;
    const { orderStrategy, entries } = ordered;

    const split = splitSubVolumes(entries, warnings);
    const chosen = pickSubVolume(split, opts.subVolume, warnings);

    // `resolveSpacing` may itself drop planes (a gap splits the stack), so it —
    // not the caller — owns the final plane list.
    const spacing = resolveSpacing(dedupeCoLocated(chosen.entries, warnings), input, orderStrategy, warnings);
    const planes = spacing.planes;
    if (spacing.gapDropped) {
        rejected.push({ reason: "position gap (discontinuous stack)", count: spacing.gapDropped });
    }

    return {
        planes: planes.map((e, i) => ({
            instanceUID: e.instanceUID,
            frame: e.frame,
            position: e.position ?? null,
            label: labelFor(e, i, split.subVolumes.length > 1 ? chosen.label : null),
        })),
        spacingUm: spacing.spacingUm,
        spacingSource: spacing.source,
        irregular: spacing.irregular,
        orderStrategy,
        subVolumes: split.subVolumes,
        activeSubVolume: split.subVolumes.length > 1 ? chosen.key : null,
        rejected,
        warnings,
        raster: rasterCheck.raster,
    };
}

/* -- raster consistency -------------------------------------------- */

/**
 * Every plane must be the same raster: the z-stack contract swaps tile *data*
 * in place, so a differing size or pixel spacing between planes would silently
 * rescale the image mid-scrub.
 */
function validateCommonRaster(candidates) {
    const first = candidates[0];
    const rows = first.rows;
    const cols = first.cols;

    if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 0 || cols <= 0) {
        return refuse("series declares no Rows/Columns");
    }
    if (Math.max(rows, cols) > RADIOLOGY_MAX_DIMENSION) {
        return refuse(`raster ${cols}x${rows} exceeds the ${RADIOLOGY_MAX_DIMENSION}px limit`);
    }

    const photometric = first.photometricInterpretation;
    if (photometric && photometric !== "MONOCHROME1" && photometric !== "MONOCHROME2") {
        // RGB / YBR / PALETTE COLOR radiology objects exist (US, some NM
        // displays) but they are not quantitative and belong on the ordinary
        // DICOMWebTileSource display chain, not on a windowed float path.
        return refuse(`photometric interpretation ${photometric} is not a monochrome intensity image`);
    }

    const spacing = first.pixelSpacing;
    for (const c of candidates) {
        if (c.rows !== rows || c.cols !== cols) {
            return refuse("instances declare different Rows/Columns");
        }
        if (spacing && c.pixelSpacing) {
            // 0.1% — anything larger is a genuinely different acquisition
            // geometry, not a rounding difference in the DICOM text VR.
            const dr = Math.abs(c.pixelSpacing[0] - spacing[0]) / Math.abs(spacing[0] || 1);
            const dc = Math.abs(c.pixelSpacing[1] - spacing[1]) / Math.abs(spacing[1] || 1);
            if (dr > 0.001 || dc > 0.001) return refuse("instances declare different PixelSpacing");
        }
    }

    return { raster: { rows, cols, pixelSpacing: spacing } };
}

/* -- ordering ------------------------------------------------------- */

/**
 * Sort into depth order and record which rule got us there. The three
 * strategies are tried in decreasing order of trustworthiness; the last one
 * carries no geometry at all, which is why it also forbids deriving a spacing
 * from the ordering (see `resolveSpacing`).
 */
function orderCandidates(candidates, warnings, rejected) {
    const withNormals = candidates.map(c => ({ c, n: normalFromOrientation(c.iop) }));
    const usable = withNormals.filter(x => x.n && Array.isArray(x.c.ipp) && x.c.ipp.length >= 3);

    // Only trust the positional path when it covers most of the series. A
    // handful of instances carrying IPP/IOP in an otherwise position-less series
    // would otherwise reduce the whole stack to those few planes; ordering the
    // full series by SliceLocation or InstanceNumber is the better answer.
    if (usable.length && usable.length * 2 >= candidates.length) {
        const clusters = clusterByNormal(usable);
        clusters.sort((a, b) => b.members.length - a.members.length);
        const main = clusters[0];

        for (const other of clusters.slice(1)) {
            rejected.push({ reason: "differing image orientation (localizer or second series)", count: other.members.length });
        }
        if (clusters.length > 1) {
            warnings.push(`series mixes ${clusters.length} image orientations; rendering the largest (${main.members.length} planes)`);
        }

        const dropped = candidates.length - usable.length;
        if (dropped > 0) {
            rejected.push({ reason: "missing ImagePositionPatient/ImageOrientationPatient", count: dropped });
        }

        const entries = main.members.map(({ c, n }) => ({
            instanceUID: c.instanceUID,
            frame: c.frame,
            // Project onto the CLUSTER's reference normal, not each plane's own:
            // an anti-parallel normal would otherwise flip the sign of half the
            // stack and comb the two halves together.
            position: dot(c.ipp.slice(0, 3), main.normal),
            instanceNumber: c.instanceNumber,
            inStackPosition: c.inStackPosition,
            keys: c.keys,
            source: c,
            _n: n,
        }));
        sortEntries(entries, true);
        return { orderStrategy: "ipp-normal", entries };
    }

    const located = candidates.filter(c => Number.isFinite(c.sliceLocation));
    if (located.length === candidates.length) {
        warnings.push("no ImagePositionPatient/ImageOrientationPatient; ordering by SliceLocation");
        // SliceLocation IS the projected position along the normal, so it is a
        // real coordinate and a derived spacing stays meaningful.
        const entries = located.map(c => ({
            instanceUID: c.instanceUID,
            frame: c.frame,
            position: c.sliceLocation,
            instanceNumber: c.instanceNumber,
            inStackPosition: c.inStackPosition,
            keys: c.keys,
            source: c,
        }));
        sortEntries(entries, true);
        return { orderStrategy: "slice-location", entries };
    }

    const numbered = candidates.filter(c => Number.isFinite(c.instanceNumber));
    if (numbered.length === candidates.length) {
        warnings.push("no positional metadata; ordering by InstanceNumber — spacing cannot be derived");
        const entries = numbered.map(c => ({
            instanceUID: c.instanceUID,
            frame: c.frame,
            position: null,
            instanceNumber: c.instanceNumber,
            inStackPosition: c.inStackPosition,
            keys: c.keys,
            source: c,
        }));
        sortEntries(entries, false);
        return { orderStrategy: "instance-number", entries };
    }

    return refuse("series carries no ImagePositionPatient, SliceLocation or InstanceNumber — depth order is undefined");
}

/**
 * Greedy clustering by normal direction. `|dot|` rather than `dot` so a stack
 * whose normals are reported anti-parallel (both conventions occur) stays one
 * cluster.
 */
function clusterByNormal(withNormals) {
    const clusters = [];
    for (const item of withNormals) {
        const hit = clusters.find(cl => Math.abs(dot(cl.normal, item.n)) >= ORIENTATION_COS_TOLERANCE);
        if (hit) hit.members.push(item);
        else clusters.push({ normal: item.n, members: [item] });
    }
    return clusters;
}

/**
 * `InStackPositionNumber` is the DICOM-authored ordinal within a stack and
 * outranks a computed projection when present; the projection is still the
 * source of truth for *spacing*.
 */
function sortEntries(entries, byPosition) {
    const hasStackOrdinals = entries.every(e => Number.isFinite(e.inStackPosition));
    entries.sort((a, b) => {
        if (hasStackOrdinals && a.inStackPosition !== b.inStackPosition) {
            return a.inStackPosition - b.inStackPosition;
        }
        if (byPosition && a.position !== b.position) return a.position - b.position;
        const an = Number.isFinite(a.instanceNumber) ? a.instanceNumber : Infinity;
        const bn = Number.isFinite(b.instanceNumber) ? b.instanceNumber : Infinity;
        if (an !== bn) return an - bn;
        if (a.instanceUID !== b.instanceUID) return a.instanceUID < b.instanceUID ? -1 : 1;
        // Two frames of one instance: the frame number is the last tiebreak, and
        // it is what makes the whole sort deterministic.
        return a.frame - b.frame;
    });
}

/* -- interleaved volumes -------------------------------------------- */

/**
 * Partition an interleaved series into sub-volumes.
 *
 * The key is built only from the attributes that actually vary *between
 * co-located planes* — using every discriminator unconditionally would split a
 * perfectly ordinary series on AcquisitionNumber, which many scanners increment
 * per slice.
 */
function splitSubVolumes(entries, warnings) {
    const positioned = entries.every(e => Number.isFinite(e.position));
    const groups = positioned ? coLocatedGroups(entries) : [];
    const varying = new Set();

    for (const group of groups) {
        if (group.length < 2) continue;
        const names = new Set();
        for (const e of group) for (const k of Object.keys(e.keys || {})) names.add(k);
        for (const name of names) {
            const seen = new Set(group.map(e => e.keys?.[name] ?? " "));
            if (seen.size > 1) varying.add(name);
        }
    }

    if (!varying.size) {
        return { subVolumes: [{ key: "", count: entries.length, label: "" }], byKey: new Map([["", entries]]) };
    }

    const names = [...varying].sort();
    const byKey = new Map();
    for (const e of entries) {
        const key = names.map(n => `${n}=${e.keys?.[n] ?? ""}`).join("|");
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(e);
    }

    const subVolumes = [...byKey.entries()]
        .map(([key, list]) => ({ key, count: list.length, label: key.replace(/\|/g, " · ") }))
        // Largest first; ties broken lexicographically so the choice is stable
        // across reloads rather than dependent on server row order.
        .sort((a, b) => (b.count - a.count) || (a.key < b.key ? -1 : 1));

    warnings.push(
        `series interleaves ${subVolumes.length} volumes (split on ${names.join(", ")}); ` +
        `rendering "${subVolumes[0].label}" (${subVolumes[0].count} planes)`
    );

    return { subVolumes, byKey };
}

function coLocatedGroups(entries) {
    const deltas = consecutiveDeltas(entries).filter(d => d > 0);
    const med = deltas.length ? median([...deltas].sort((a, b) => a - b)) : NaN;
    const eps = Math.max(COLOCATION_EPSILON_MM, Number.isFinite(med) ? med / 100 : 0);

    const groups = [];
    let current = [entries[0]];
    for (let i = 1; i < entries.length; i++) {
        if (Math.abs(entries[i].position - current[0].position) < eps) current.push(entries[i]);
        else { groups.push(current); current = [entries[i]]; }
    }
    groups.push(current);
    return groups;
}

function pickSubVolume(split, requested, warnings) {
    if (requested != null && split.byKey.has(requested)) {
        const meta = split.subVolumes.find(s => s.key === requested);
        return { key: requested, label: meta?.label ?? requested, entries: split.byKey.get(requested) };
    }
    if (requested != null) {
        warnings.push(`requested sub-volume "${requested}" not present in this series; using the largest`);
    }
    const best = split.subVolumes[0];
    return { key: best.key, label: best.label, entries: split.byKey.get(best.key) };
}

/**
 * Planes still sharing a position after the sub-volume split are genuine
 * duplicates (a re-sent instance). Keep the lowest InstanceNumber — arbitrary
 * but deterministic, and the lower number is the original in every ordering
 * convention a scanner uses.
 */
function dedupeCoLocated(entries, warnings) {
    if (!entries.every(e => Number.isFinite(e.position))) return entries;

    const groups = coLocatedGroups(entries);
    let dropped = 0;
    const out = [];
    for (const group of groups) {
        if (group.length === 1) { out.push(group[0]); continue; }
        dropped += group.length - 1;
        out.push(group.reduce((a, b) => {
            const an = Number.isFinite(a.instanceNumber) ? a.instanceNumber : Infinity;
            const bn = Number.isFinite(b.instanceNumber) ? b.instanceNumber : Infinity;
            return bn < an ? b : a;
        }));
    }
    if (dropped) warnings.push(`dropped ${dropped} duplicate plane(s) at an already-occupied position`);
    return out;
}

/* -- spacing -------------------------------------------------------- */

function consecutiveDeltas(entries) {
    const out = [];
    for (let i = 1; i < entries.length; i++) {
        out.push(Math.abs(entries[i].position - entries[i - 1].position));
    }
    return out;
}

/**
 * Resolve `spacingUm`, and split the stack at any gap.
 *
 * Precedence is strict and `SliceThickness` is never preferred over a derived
 * spacing: thickness is the slab a slice integrates over, spacing is the
 * distance between slab centres. On an overlapped acquisition they differ by up
 * to 2x, and `mapPlaneIndex` uses `spacingUm` to align overlays physically —
 * so a wrong value here misregisters every mask on the stack, silently.
 */
function resolveSpacing(planes, candidates, orderStrategy, warnings) {
    const declaredSpacing = candidates.find(c => Number.isFinite(c.spacingBetweenSlices))?.spacingBetweenSlices;
    const declaredThickness = candidates.find(c => Number.isFinite(c.sliceThickness))?.sliceThickness;

    const fromDeclared = () => {
        if (Number.isFinite(declaredSpacing) && declaredSpacing > 0) {
            return { spacingUm: declaredSpacing * 1000, source: "spacing-between-slices", irregular: false, planes };
        }
        if (Number.isFinite(declaredThickness) && declaredThickness > 0) {
            warnings.push("no SpacingBetweenSlices; falling back to SliceThickness, which may differ on an overlapped acquisition");
            return { spacingUm: declaredThickness * 1000, source: "slice-thickness", irregular: false, planes };
        }
        return { spacingUm: undefined, source: null, irregular: false, planes };
    };

    // Ordering by InstanceNumber gives no coordinate, so a "derived" spacing
    // would be derived from nothing.
    if (orderStrategy === "instance-number" || planes.length < 2) return fromDeclared();

    const deltas = consecutiveDeltas(planes);
    if (deltas.some(d => !(d > 0))) {
        warnings.push("non-monotonic plane positions; spacing cannot be derived");
        return fromDeclared();
    }

    const sorted = [...deltas].sort((a, b) => a - b);
    const med = median(sorted);
    if (!(med > 0)) return fromDeclared();

    const gapAt = deltas.findIndex(d => d > med * GAP_FACTOR);
    if (gapAt >= 0) {
        // A single spacing across a gap is a lie about physical depth. Keep the
        // longest contiguous run and report the rest rather than stretching the
        // axis over a hole.
        const runs = [];
        let start = 0;
        for (let i = 0; i < deltas.length; i++) {
            if (deltas[i] > med * GAP_FACTOR) { runs.push(planes.slice(start, i + 1)); start = i + 1; }
        }
        runs.push(planes.slice(start));
        runs.sort((a, b) => b.length - a.length);
        const kept = runs[0];
        warnings.push(`series has a positional gap; rendering the largest contiguous run (${kept.length} of ${planes.length} planes)`);
        // Re-run on the kept run: its median differs, so it may reveal a second
        // gap the original median hid. `inner.planes` is authoritative.
        const inner = resolveSpacing(kept, candidates, orderStrategy, warnings);
        return { ...inner, gapDropped: (inner.gapDropped || 0) + (planes.length - kept.length) };
    }

    const spread = (sorted[sorted.length - 1] - sorted[0]) / med;
    if (spread > IRREGULAR_SPREAD) {
        warnings.push(`plane spacing varies by ${(spread * 100).toFixed(1)}%; using the median (exact positions are kept in the plane labels)`);
    }

    return {
        spacingUm: med * 1000,
        source: "positions",
        irregular: spread > IRREGULAR_SPREAD,
        planes,
    };
}

/* -- labels --------------------------------------------------------- */

/**
 * The z-stack descriptor's `labels[]`. The signed position along the normal is
 * exact even when the spacing is irregular, which is the case a single
 * `spacingUm` cannot express. Pure data (a number plus a unit symbol), so it
 * carries no translation key.
 */
function labelFor(entry, index, subVolumeLabel) {
    const base = Number.isFinite(entry.position) ? `${entry.position.toFixed(1)} mm` : `#${index + 1}`;
    return subVolumeLabel ? `${base} · ${subVolumeLabel}` : base;
}

/* ------------------------------------------------------------------ */
/* Normalization range                                                 */
/* ------------------------------------------------------------------ */

/**
 * The real-world interval tile samples are normalized against before they are
 * packed as half-floats.
 *
 * Raw values are not uploaded, for the reason `derived-tile-source.mjs` already
 * documents: half-float spends ~11 mantissa bits wherever the values happen to
 * sit, so raw Hounsfield units lose sub-unit precision above 2048 and, under the
 * RGBA8 fallback, clamp to white instead of banding. Normalizing spends the
 * precision on the range that actually occurs, and the shader undoes it with
 * GLSL literals so every control stays in the object's own units.
 *
 * @param {object} opts
 * @param {string|null} [opts.modality]
 * @param {object} opts.pixel ImagePixelDescriptor
 * @param {object|null} [opts.modalityLut]
 * @param {object|null} [opts.voiLut]
 * @param {{min:number,max:number}|null} [opts.realWorldRange]
 * @param {{min:number,max:number}[]} [opts.extraRanges] per-plane ranges to cover
 * @returns {{min:number, max:number}}
 */
export function chooseValueRange(opts = {}) {
    const { modality, pixel, modalityLut = null, voiLut = null, realWorldRange = null, extraRanges = [] } = opts;

    let range = realWorldRange && realWorldRange.max > realWorldRange.min
        ? { ...realWorldRange }
        : modalityClampedRange(modality, pixel, modalityLut, voiLut);

    // Widen to every declared preset, or selecting one would clip against the
    // very range chosen to represent it.
    for (const preset of voiLut?.presets || []) {
        if (!(preset.width > 0)) continue;
        range.min = Math.min(range.min, preset.center - preset.width / 2);
        range.max = Math.max(range.max, preset.center + preset.width / 2);
    }

    // One range, one pair of GLSL literals — it must cover every plane, which
    // matters when a PET carries a per-plane rescale.
    for (const extra of extraRanges) {
        if (!extra) continue;
        range.min = Math.min(range.min, extra.min);
        range.max = Math.max(range.max, extra.max);
    }

    let span = range.max - range.min;
    if (!(span > 0)) { range = { min: range.min, max: range.min + 1 }; span = 1; }

    const margin = span * 0.02;
    return { min: range.min - margin, max: range.max + margin };
}

function modalityClampedRange(modality, pixel, modalityLut, voiLut) {
    const full = storedValueRange(pixel, modalityLut);

    // Only clamp when a Modality LUT actually puts us in Hounsfield units.
    // Without one the values are raw stored samples and -1024..3071 would clip
    // real data.
    if (modality === "CT" && modalityLut) {
        // The unclamped signed 16-bit range is ~65000 HU wide; at half-float's
        // ~2^-11 relative step that is ~32 HU per representable value, which is
        // useless. Air-to-dense-bone is the range CT actually occupies.
        return {
            min: Math.max(full.min, CT_HU_CLAMP.min),
            max: Math.min(full.max, CT_HU_CLAMP.max),
        };
    }

    if (modality === "PT" || modality === "NM") {
        // Activity is non-negative; a negative stored minimum is an artefact of
        // the pixel representation, not a measurement.
        const presetMax = (voiLut?.presets || [])
            .reduce((m, p) => Math.max(m, p.center + p.width / 2), -Infinity);
        const max = Number.isFinite(presetMax) && presetMax > 0 ? Math.max(presetMax, full.max) : full.max;
        return { min: 0, max };
    }

    // MR / CR / DX: storedValueRange is already derived from BitsStored, so a
    // 12-bit-in-16 acquisition gives 0..4095 rather than 0..65535.
    return full;
}
