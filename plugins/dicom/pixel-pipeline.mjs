/**
 * pixel-pipeline.mjs — pure DICOM pixel-transform helpers.
 *
 * Everything here is a side-effect-free function over a DICOM-JSON dataset or a
 * typed array. No network, no DOM, no plugin state — which is what makes the
 * pipeline testable without a DICOM server and reusable from the tile source,
 * the SEG reader and the shader-layer seeding code alike.
 *
 * The display chain implemented here is the one PS3.3 C.11 defines:
 *
 *     stored value -> Modality LUT -> VOI LUT -> Presentation LUT / palette
 *
 * `buildGrayscaleLut` collapses the first two stages into a single lookup table
 * indexed by the raw stored value, so the per-pixel hot loop is one array read.
 */

// Local copies of the DICOM-JSON accessors. They are duplicated from
// DicomTools deliberately: importing dicom-query.mjs here would close an import
// cycle (dicom-query needs this module for the pixel descriptors), and this
// module's whole point is to stay dependency-free and unit-testable.
const va = (ds, tag) => ds?.[tag]?.Value || null;
const v  = (ds, tag) => { const x = va(ds, tag); return Array.isArray(x) ? x[0] : (x ?? null); };
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

/* ------------------------------------------------------------------ */
/* Generic dataset access                                              */
/* ------------------------------------------------------------------ */

/**
 * Depth-first search for a tag anywhere in a DICOM-JSON tree, descending into
 * sequences. DICOMweb servers disagree about how deeply attributes like the ICC
 * profile or the palette descriptors are nested, so a direct lookup is not
 * enough.
 *
 * @returns {object|null} the raw element ({vr, Value|InlineBinary|BulkDataURI})
 */
export function findTagDeep(node, tagKey) {
    if (!node || typeof node !== "object") return null;
    if (node[tagKey]) return node[tagKey];

    for (const k of Object.keys(node)) {
        const el = node[k];
        if (!el || typeof el !== "object") continue;
        const value = el.Value;
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item && typeof item === "object") {
                    const hit = findTagDeep(item, tagKey);
                    if (hit) return hit;
                }
            }
        }
    }
    return null;
}

/**
 * Look a tag up where DICOM actually puts it for multi-frame objects: directly
 * on the dataset, then inside a named sequence of the Shared Functional Groups,
 * then anywhere in the tree.
 *
 * This ordering is not defensive padding — real Parametric Maps put the whole
 * display chain in the shared groups (`PixelValueTransformationSequence`,
 * `FrameVOILUTSequence`) and carry nothing at the top level, so a top-level-only
 * read silently returns "no window" and renders a flat grey square.
 *
 * @param {object} ds instance dataset
 * @param {string} tag the tag to find
 * @param {string[]} sharedSequences sequence tags inside (5200,9229) to search
 */
export function resolveTagScoped(ds, tag, sharedSequences = []) {
    if (ds?.[tag]) return ds[tag];

    const shared = ds?.["52009229"]?.Value?.[0];
    if (shared) {
        for (const seqTag of sharedSequences) {
            const item = shared?.[seqTag]?.Value?.[0];
            if (item?.[tag]) return item[tag];
        }
        if (shared[tag]) return shared[tag];
    }

    return findTagDeep(ds, tag);
}

export function base64ToUint8(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/**
 * Read a numeric element that may arrive either as a JSON `Value` array or as
 * `InlineBinary`. LUT payloads (LUTData, palette data) are the usual offenders:
 * servers send them as US arrays, as OW InlineBinary, or as a BulkDataURI we
 * cannot resolve synchronously.
 *
 * @param {object} el raw DICOM-JSON element
 * @param {number} bitsPerEntry 8 or 16
 * @returns {Uint8Array|Uint16Array|null} null when the payload is out-of-line
 */
export function readNumericPayload(el, bitsPerEntry = 16) {
    if (!el) return null;

    if (Array.isArray(el.Value) && el.Value.length) {
        const nums = el.Value.map(Number);
        // A single OW element sometimes arrives as one giant packed string
        // rather than an array of samples; treat that as unusable here.
        if (nums.some(n => !Number.isFinite(n))) return null;
        return bitsPerEntry > 8 ? Uint16Array.from(nums) : Uint8Array.from(nums);
    }

    if (el.InlineBinary) {
        const bytes = base64ToUint8(el.InlineBinary);
        if (bitsPerEntry > 8) {
            // DICOM-JSON InlineBinary is little-endian.
            return new Uint16Array(bytes.buffer, bytes.byteOffset,
                Math.floor(bytes.byteLength / 2));
        }
        return bytes;
    }

    // BulkDataURI — resolvable only with a client; callers that care must fetch
    // it themselves and re-enter with the bytes.
    return null;
}

/* ------------------------------------------------------------------ */
/* Image Pixel module (PS3.3 C.7.6.3)                                  */
/* ------------------------------------------------------------------ */

/**
 * @typedef {object} ImagePixelDescriptor
 * @property {number} samplesPerPixel
 * @property {string} photometricInterpretation
 * @property {number} planarConfiguration
 * @property {number} bitsAllocated
 * @property {number} bitsStored
 * @property {number} highBit
 * @property {number} pixelRepresentation 0 = unsigned, 1 = two's complement
 * @property {number} numberOfFrames
 */

/**
 * Read the real Image Pixel module instead of assuming 8-bit RGB. Missing
 * attributes are filled with the DICOM-consistent derivation (bitsStored from
 * bitsAllocated, highBit from bitsStored) rather than a blanket default, so a
 * partially-populated dataset still decodes correctly.
 *
 * @param {object} ds DICOM-JSON dataset (instance level)
 * @returns {ImagePixelDescriptor}
 */
export function parseImagePixel(ds) {
    const samplesPerPixel = iv(ds, "00280002") ?? 1;
    const pi = String(v(ds, "00280004") ?? "").toUpperCase().trim();
    const bitsAllocated = iv(ds, "00280100") ?? 8;
    const bitsStored = iv(ds, "00280101") ?? bitsAllocated;
    const highBit = iv(ds, "00280102") ?? (bitsStored - 1);

    // Parametric Maps commonly store samples as IEEE floats in Float Pixel Data
    // (7FE0,0008) or Double Float Pixel Data (7FE0,0009) instead of PixelData,
    // and then omit BitsStored/PixelRepresentation entirely. Those frames need a
    // typed-array read, not an integer decoder.
    const floatPixelData = !!ds?.["7FE00008"];
    const doubleFloatPixelData = !!ds?.["7FE00009"];

    return {
        floatPixelData,
        doubleFloatPixelData,
        samplesPerPixel,
        // PALETTE COLOR is single-sample; RGB/YBR are three. When the server
        // omits PhotometricInterpretation, infer from SamplesPerPixel rather
        // than defaulting to RGB — the old behaviour turned every monochrome
        // frame into garbage.
        photometricInterpretation: pi || (samplesPerPixel >= 3 ? "RGB" : "MONOCHROME2"),
        planarConfiguration: iv(ds, "00280006") ?? 0,
        bitsAllocated,
        bitsStored,
        highBit,
        pixelRepresentation: iv(ds, "00280103") ?? 0,
        numberOfFrames: iv(ds, "00280008") ?? 1,
    };
}

/** True when the descriptor describes single-sample intensity data. */
export function isMonochrome(pixel) {
    const pi = pixel?.photometricInterpretation || "";
    return pi === "MONOCHROME1" || pi === "MONOCHROME2" ||
        (pixel?.samplesPerPixel === 1 && pi !== "PALETTE COLOR");
}

/* ------------------------------------------------------------------ */
/* Modality LUT (PS3.3 C.11.1) and Real World Value Mapping (C.7.6.16) */
/* ------------------------------------------------------------------ */

/**
 * @typedef {{kind:"linear", slope:number, intercept:number, units:?string, explanation:?string}
 *          |{kind:"lut", firstMapped:number, bitsPerEntry:number, data:Uint8Array|Uint16Array,
 *            units:?string, explanation:?string}} ModalityLut
 */

/**
 * Resolve the stored-value -> real-world-value transform.
 *
 * Precedence is deliberate: Real World Value Mapping wins when present because
 * that is the mechanism Parametric Map objects use to carry physical units, and
 * a PMAP that also carries a rescale pair means the same thing by both routes.
 *
 * @param {object} ds instance-level dataset (shared functional groups are searched too)
 * @returns {ModalityLut|null}
 */
export function parseModalityLut(ds) {
    if (!ds) return null;

    const rwvmEl = findTagDeep(ds, "00409096");           // RealWorldValueMappingSequence
    const rwvm = rwvmEl?.Value?.[0];
    if (rwvm) {
        const units = v(rwvm?.["004008EA"]?.Value?.[0], "00080104") ?? null; // CodeMeaning
        const explanation = v(rwvm, "00409210") ?? null;                     // LUTExplanation

        const lutData = rwvm["00409212"];                 // RealWorldValueLUTData
        if (lutData) {
            const data = readNumericPayload(lutData, 16);
            if (data) {
                return {
                    kind: "lut",
                    firstMapped: fv(rwvm, "00409216") ?? 0,  // RealWorldValueFirstValueMapped
                    bitsPerEntry: 16,
                    data,
                    units,
                    explanation,
                };
            }
        }

        const slope = fv(rwvm, "00409225");               // RealWorldValueSlope
        const intercept = fv(rwvm, "00409224");           // RealWorldValueIntercept
        if (Number.isFinite(slope)) {
            return {
                kind: "linear",
                slope,
                intercept: Number.isFinite(intercept) ? intercept : 0,
                units,
                explanation,
            };
        }
    }

    // Rescale lives at the top level for ordinary images and inside
    // PixelValueTransformationSequence (0028,9145) of the Shared Functional
    // Groups for enhanced multi-frame objects.
    const el = (tag) => resolveTagScoped(ds, tag, ["00289145"]);
    const one = (tag) => {
        const value = el(tag)?.Value;
        const x = Array.isArray(value) ? value[0] : value;
        const n = typeof x === "string" ? parseFloat(x) : Number(x);
        return Number.isFinite(n) ? n : undefined;
    };

    const slope = one("00281053");                        // RescaleSlope
    const intercept = one("00281052");                    // RescaleIntercept
    if (Number.isFinite(slope) || Number.isFinite(intercept)) {
        const typeValue = el("00281054")?.Value;          // RescaleType
        return {
            kind: "linear",
            slope: Number.isFinite(slope) ? slope : 1,
            intercept: Number.isFinite(intercept) ? intercept : 0,
            units: Array.isArray(typeValue) ? typeValue[0] : (typeValue ?? null),
            explanation: null,
        };
    }

    const seq = findTagDeep(ds, "00283000")?.Value?.[0];  // ModalityLUTSequence
    if (seq) {
        const desc = (va(seq, "00283002") || []).map(Number);   // LUTDescriptor
        const data = readNumericPayload(seq["00283006"], desc[2] > 8 ? 16 : 8);
        if (data && desc.length >= 3) {
            return {
                kind: "lut",
                firstMapped: desc[1] || 0,
                bitsPerEntry: desc[2] || 16,
                data,
                units: v(seq, "00283004") ?? null,        // ModalityLUTType
                explanation: v(seq, "00283003") ?? null,
            };
        }
    }

    return null;
}

/** Apply a Modality LUT to one stored value. */
export function applyModality(storedValue, modalityLut) {
    if (!modalityLut) return storedValue;
    if (modalityLut.kind === "linear") {
        return storedValue * modalityLut.slope + modalityLut.intercept;
    }
    const idx = Math.round(storedValue - modalityLut.firstMapped);
    const data = modalityLut.data;
    if (idx <= 0) return data[0];
    if (idx >= data.length) return data[data.length - 1];
    return data[idx];
}

/* ------------------------------------------------------------------ */
/* VOI LUT (PS3.3 C.11.2)                                              */
/* ------------------------------------------------------------------ */

/**
 * @typedef {{center:number, width:number, explanation:?string}} VoiPreset
 * @typedef {{presets:VoiPreset[], fn:"LINEAR"|"LINEAR_EXACT"|"SIGMOID",
 *            lut:?{firstMapped:number, bitsPerEntry:number, data:Uint8Array|Uint16Array, explanation:?string}}} VoiLut
 */

/**
 * WindowCenter/WindowWidth are multi-valued — each pair is a named preset the
 * user is meant to be able to choose between, so all of them are kept rather
 * than only the first.
 *
 * @returns {VoiLut|null}
 */
export function parseVoiLut(ds) {
    if (!ds) return null;

    // Enhanced multi-frame objects (Parametric Maps in particular) carry the
    // window inside FrameVOILUTSequence (0028,9132) of the Shared Functional
    // Groups rather than at the top level.
    const values = (tag) => {
        const value = resolveTagScoped(ds, tag, ["00289132"])?.Value;
        return Array.isArray(value) ? value : (value == null ? [] : [value]);
    };

    const centers = values("00281050").map(Number).filter(Number.isFinite);
    const widths = values("00281051").map(Number).filter(Number.isFinite);
    const explanations = values("00281055").map(String);

    const presets = [];
    for (let i = 0; i < Math.min(centers.length, widths.length); i++) {
        // A zero or negative width is meaningless and would divide by zero in
        // the LINEAR formula below.
        if (!(widths[i] > 0)) continue;
        presets.push({ center: centers[i], width: widths[i], explanation: explanations[i] ?? null });
    }

    let fn = String(values("00281056")[0] ?? "").toUpperCase().trim();
    if (fn !== "LINEAR_EXACT" && fn !== "SIGMOID") fn = "LINEAR";

    let lut = null;
    const seq = findTagDeep(ds, "00283010")?.Value?.[0];       // VOILUTSequence
    if (seq) {
        const desc = (va(seq, "00283002") || []).map(Number);  // LUTDescriptor
        if (desc.length >= 3) {
            const bitsPerEntry = desc[2] > 8 ? 16 : 8;
            const data = readNumericPayload(seq["00283006"], bitsPerEntry);
            if (data) {
                lut = {
                    firstMapped: desc[1] || 0,
                    bitsPerEntry,
                    data,
                    explanation: v(seq, "00283003") ?? null,
                };
            }
        }
    }

    if (!presets.length && !lut) return null;
    return { presets, fn, lut };
}

/**
 * Recover the signed stored value from a raw sample as it sits in the pixel
 * buffer: mask to `bitsStored`, then sign-extend when the object declares two's
 * complement.
 *
 * `buildGrayscaleLut` does this inline while filling its table, but the direct
 * typed-array path (quantitative consumers that never build a LUT) had nothing.
 * Reading a 12-bit-stored signed CT straight out of an `Int16Array` is *usually*
 * right — the high nibble is normally sign-extended padding already — and
 * occasionally catastrophically wrong, because nothing in DICOM requires the
 * bits above `highBit` to be anything at all. A wrong value here is a wrong
 * Hounsfield number, silently.
 *
 * @param {number} raw sample as stored
 * @param {ImagePixelDescriptor} pixel
 * @returns {number} the signed stored value
 */
export function signExtendStored(raw, pixel) {
    const bitsAllocated = Math.min(pixel?.bitsAllocated || 16, 32);
    const bitsStored = Math.min(pixel?.bitsStored || bitsAllocated, bitsAllocated);
    if (bitsStored >= 32) return raw;

    const stored = raw & ((1 << bitsStored) - 1);
    if (pixel?.pixelRepresentation !== 1) return stored;

    const signBit = 1 << (bitsStored - 1);
    return (stored & signBit) ? stored - (signBit << 1) : stored;
}

/**
 * The value range a stored sample can occupy, after the Modality LUT.
 * Used to synthesize a window when the object carries no VOI at all.
 */
export function storedValueRange(pixel, modalityLut) {
    const bits = Math.min(pixel.bitsStored || pixel.bitsAllocated || 8, 32);
    let lo, hi;
    if (pixel.pixelRepresentation === 1) {
        hi = Math.pow(2, bits - 1) - 1;
        lo = -Math.pow(2, bits - 1);
    } else {
        lo = 0;
        hi = Math.pow(2, bits) - 1;
    }
    const a = applyModality(lo, modalityLut);
    const b = applyModality(hi, modalityLut);
    return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** Full-range window used when the object declares no VOI. */
export function defaultWindow(pixel, modalityLut) {
    const { min, max } = storedValueRange(pixel, modalityLut);
    const width = Math.max(max - min, 1);
    return { center: min + width / 2, width, explanation: null };
}

/**
 * Map one real-world value to `[0, outMax]` using the DICOM VOI formulas
 * (PS3.3 C.11.2.1.2 / C.11.2.1.3).
 */
export function applyVoiValue(value, { center, width, fn = "LINEAR", outMax = 255, continuous = false }) {
    if (fn === "SIGMOID") {
        return outMax / (1 + Math.exp(-4 * (value - center) / width));
    }

    // The LINEAR formula's `-0.5` and `(w-1)` terms count *distinct integer
    // stored values*; they are meaningless for continuous samples, where a
    // window of width 1 describes a range, not a single value. Evaluating
    // LINEAR literally on float data collapses it to a hard threshold — a real
    // Parametric Map with WindowCenter 0.5 / WindowWidth 1 over values in [0,1]
    // would render as a binary mask. Promote to LINEAR_EXACT for float samples.
    if (fn === "LINEAR_EXACT" || continuous) {
        if (value <= center - width / 2) return 0;
        if (value > center + width / 2) return outMax;
        return ((value - center) / width + 0.5) * outMax;
    }

    // LINEAR (PS3.3 C.11.2.1.2.1). The boundary tests use the true `(w-1)/2`
    // half-width — clamping it away would shift both edges and put the window's
    // low end at mid-grey instead of black.
    const c = center - 0.5;
    const half = (width - 1) / 2;
    if (value <= c - half) return 0;
    if (value > c + half) return outMax;
    const denom = width - 1;
    if (denom <= 0) return outMax;   // width 1: a step at c; both tests above already handled it
    return ((value - c) / denom + 0.5) * outMax;
}

/**
 * Is this Modality LUT the identity — i.e. does the stored value already *equal*
 * the real-world value?
 *
 * `null` and an explicit `slope 1 / intercept 0` mean the same thing and must
 * answer the same way: a slide that carries the rescale pair at its identity
 * values (the common case for `SM`) is not thereby a different kind of data.
 */
export function isIdentityModalityLut(modalityLut) {
    if (!modalityLut) return true;
    return modalityLut.kind === "linear" && modalityLut.slope === 1 && modalityLut.intercept === 0;
}

/**
 * Can the VOI transform be left to a shader instead of baked into the tile?
 *
 * A slide tile source hands the renderer 8-bit RGBA, so a window applied in a
 * shader can only be honest when the byte the shader samples **is** the stored
 * value. That holds under one narrow, checkable condition set:
 *
 * - `MONOCHROME2`, one sample per pixel — colour and palette have no window, and
 *   `MONOCHROME1` would need its inversion moved to the shader too, which changes
 *   what an author-declared layer other than `dicom-window` would render.
 * - unsigned, `bitsAllocated === bitsStored === 8` — anything wider is quantized
 *   on the way to the byte, and windowing a quantized sample bands visibly. That
 *   data is what {@link RadiologySeriesTileSource} and its half-float packs exist
 *   for; a slide pyramid has no such path.
 * - identity Modality LUT — otherwise the byte carries a rescaled value the
 *   shader would have to un-rescale, in 8 bits, having already lost the range.
 * - no VOI LUT and no declared window — with a window declared, the bake is doing
 *   real work and dropping it would change the default picture. Keeping the bake
 *   there is also what makes this switch invisible to every existing deployment.
 *
 * Under exactly those conditions the baked table is the identity (modulo the
 * LINEAR formula's ±1 LSB rounding, which the identity table does not have), so
 * skipping it is not a change of appearance — it is what makes the *stored*
 * value reach a `dicom-window` layer, and window/level therefore reachable at
 * all for a monochrome slide.
 *
 * Shared deliberately: the plugin decides whether to mount the layer and the
 * tile source decides whether to bake, and those two must never disagree.
 *
 * @param {ImagePixelDescriptor} pixel
 * @param {object} [opts]
 * @param {ModalityLut|null} [opts.modalityLut]
 * @param {VoiLut|null} [opts.voiLut]
 * @returns {boolean}
 */
export function canDeferVoiToShader(pixel, opts = {}) {
    if (!pixel) return false;
    if (pixel.photometricInterpretation !== "MONOCHROME2") return false;
    if ((pixel.samplesPerPixel ?? 1) !== 1) return false;
    if (pixel.pixelRepresentation === 1) return false;
    if (pixel.floatPixelData || pixel.doubleFloatPixelData) return false;
    if ((pixel.bitsAllocated ?? 8) !== 8) return false;
    if ((pixel.bitsStored ?? pixel.bitsAllocated ?? 8) !== 8) return false;

    if (!isIdentityModalityLut(opts.modalityLut ?? null)) return false;

    const voiLut = opts.voiLut ?? null;
    if (voiLut?.lut) return false;
    if (voiLut?.presets?.length) return false;

    return true;
}

/**
 * The lookup table for {@link canDeferVoiToShader}: 8-bit stored value straight
 * through, so the RGBA byte the renderer samples is the DICOM stored value.
 *
 * Built rather than skipped so the decode hot loop keeps ONE shape — one array
 * read per pixel — instead of growing a branch that has to be right in both arms.
 *
 * @returns {Uint8ClampedArray} length 256
 */
export function buildIdentityLut() {
    const out = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) out[i] = i;
    return out;
}

/**
 * Collapse Modality LUT + VOI LUT + MONOCHROME1 inversion into a single lookup
 * table indexed by the **raw stored integer** as it appears in the pixel buffer
 * (i.e. before sign extension). One array read per pixel in the hot loop.
 *
 * @param {ImagePixelDescriptor} pixel
 * @param {object} [opts]
 * @param {ModalityLut|null} [opts.modalityLut]
 * @param {VoiLut|null} [opts.voiLut]
 * @param {number} [opts.presetIndex] which WindowCenter/Width pair to use
 * @param {{center:number,width:number}|null} [opts.window] explicit override
 * @param {number} [opts.outMax]
 * @returns {Uint8ClampedArray} length 2^bitsStored. Consumers index it with
 *   `raw & (lut.length - 1)`, which is the same mask the table was built with.
 */
export function buildGrayscaleLut(pixel, opts = {}) {
    const {
        modalityLut = null,
        voiLut = null,
        presetIndex = 0,
        window: explicitWindow = null,
        outMax = 255,
    } = opts;

    const bitsAllocated = Math.min(pixel.bitsAllocated || 8, 16);
    const bitsStored = Math.min(pixel.bitsStored || bitsAllocated, bitsAllocated);
    const signed = pixel.pixelRepresentation === 1;
    const invert = pixel.photometricInterpretation === "MONOCHROME1";

    // Sized by bitsStored, NOT bitsAllocated. Every index is masked to the
    // stored width below, so a 2^bitsAllocated table would just repeat itself:
    // for the common 12-bit-in-16 case entries 4096..65535 duplicate 0..4095.
    // Measured (warm, V8): 0.50 ms for 65536 entries vs 0.086 ms for 4096, and
    // 16x less memory, for byte-identical output. This is rebuilt whenever the
    // window changes, since setVoiWindow drops the cache.
    const size = 1 << bitsStored;
    const out = new Uint8ClampedArray(size);

    const storedMask = (bitsStored >= 32) ? 0xffffffff : ((1 << bitsStored) - 1);
    const signBit = 1 << (bitsStored - 1);

    const win = explicitWindow
        || voiLut?.presets?.[presetIndex]
        || voiLut?.presets?.[0]
        || defaultWindow(pixel, modalityLut);

    const fn = voiLut?.fn || "LINEAR";
    const voiTable = voiLut?.lut || null;

    for (let raw = 0; raw < size; raw++) {
        let stored = raw & storedMask;
        if (signed && (stored & signBit)) stored -= (signBit << 1);

        const real = applyModality(stored, modalityLut);

        let y;
        if (voiTable) {
            // An explicit VOI LUT replaces the window entirely.
            const idx = Math.round(real - voiTable.firstMapped);
            const d = voiTable.data;
            const entry = idx <= 0 ? d[0] : (idx >= d.length ? d[d.length - 1] : d[idx]);
            const entryMax = (1 << voiTable.bitsPerEntry) - 1;
            y = (entry / entryMax) * outMax;
        } else {
            y = applyVoiValue(real, { center: win.center, width: win.width, fn, outMax });
        }

        out[raw] = invert ? (outMax - y) : y;
    }

    return out;
}

/**
 * The real-world value range a Parametric Map declares, from
 * RealWorldValueFirst/LastValueMapped — either the integer form (0040,9216 /
 * 0040,9211) or the double-float form (0040,9214 / 0040,9213).
 *
 * Float-valued maps have no bit-depth-derived range, so this is the only honest
 * source for a default window.
 *
 * @returns {{min:number, max:number}|null}
 */
export function parseRealWorldRange(ds) {
    const rwvm = findTagDeep(ds, "00409096")?.Value?.[0];
    if (!rwvm) return null;

    const first = fv(rwvm, "00409216") ?? fv(rwvm, "00409214");
    const last = fv(rwvm, "00409211") ?? fv(rwvm, "00409213");
    if (!Number.isFinite(first) || !Number.isFinite(last) || last === first) return null;

    // First/LastValueMapped are STORED-value bounds — the interval over which the
    // mapping is defined (PS3.3 C.7.6.16.2.11), not the real-world values those
    // bounds denote. Returning them raw declared a range in one unit system while
    // `applyModality` put the samples in another, so an object with slope 2 was
    // labelled [0,1] while its data reached 2 — and the tile source then clamped
    // the excess away. Push the bounds through the very transform the samples get,
    // which is also what `storedValueRange` does.
    const lut = parseModalityLut(ds);
    let lo, hi;
    if (lut?.kind === "lut" && lut.data?.length) {
        // A lookup table need not be monotonic, so its endpoints are not its
        // extremes. The table IS the set of reachable values.
        lo = hi = lut.data[0];
        for (let i = 1; i < lut.data.length; i++) {
            const v = lut.data[i];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
    } else {
        lo = applyModality(Math.min(first, last), lut);
        hi = applyModality(Math.max(first, last), lut);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return null;

    return { min: Math.min(lo, hi), max: Math.max(lo, hi) };
}

/**
 * Window/level mapper for **continuous** (float) samples, where a lookup table
 * indexed by the stored integer is not applicable.
 *
 * @param {object} opts
 * @param {ModalityLut|null} [opts.modalityLut]
 * @param {VoiLut|null} [opts.voiLut]
 * @param {{center:number,width:number}|null} [opts.window] explicit override
 * @param {{min:number,max:number}|null} [opts.valueRange] fallback when no VOI
 * @param {number} [opts.presetIndex]
 * @param {number} [opts.outMax]
 * @returns {(value:number) => number}
 */
export function makeContinuousVoiMapper(opts = {}) {
    const {
        modalityLut = null,
        voiLut = null,
        window: explicitWindow = null,
        valueRange = null,
        presetIndex = 0,
        outMax = 255,
    } = opts;

    const fallbackRange = valueRange || { min: 0, max: 1 };
    const win = explicitWindow
        || voiLut?.presets?.[presetIndex]
        || voiLut?.presets?.[0]
        || {
            center: (fallbackRange.min + fallbackRange.max) / 2,
            width: Math.max(fallbackRange.max - fallbackRange.min, Number.EPSILON),
        };

    const fn = voiLut?.fn || "LINEAR";
    const table = voiLut?.lut || null;

    return (value) => {
        const real = applyModality(value, modalityLut);
        if (table) {
            const idx = Math.round(real - table.firstMapped);
            const d = table.data;
            const entry = idx <= 0 ? d[0] : (idx >= d.length ? d[d.length - 1] : d[idx]);
            return (entry / ((1 << table.bitsPerEntry) - 1)) * outMax;
        }
        return applyVoiValue(real, { center: win.center, width: win.width, fn, outMax, continuous: true });
    };
}

/* ------------------------------------------------------------------ */
/* Palette Color LUT (PS3.3 C.7.9)                                     */
/* ------------------------------------------------------------------ */

/**
 * @typedef {{size:number, firstMapped:number, bitsPerEntry:number,
 *            r:Uint8ClampedArray, g:Uint8ClampedArray, b:Uint8ClampedArray}} PaletteLut
 */

/**
 * Parse a Palette Color Lookup Table, supporting both the plain
 * (0028,1201-1203) and the segmented (0028,1221-1223) forms.
 *
 * @returns {PaletteLut|null}
 */
export function parsePaletteLut(ds) {
    if (!ds) return null;

    const descEl = findTagDeep(ds, "00281101");            // RedPaletteColorLookupTableDescriptor
    if (!descEl) return null;
    const desc = (descEl.Value || []).map(Number);
    if (desc.length < 3) return null;

    // A declared entry count of 0 means 65536 (the field is US and cannot hold it).
    const size = desc[0] === 0 ? 65536 : desc[0];
    const firstMapped = Number.isFinite(desc[1]) ? desc[1] : 0;
    const bitsPerEntry = desc[2] || 8;

    // Third-party DICOM is untrusted input, so the descriptor is range-checked
    // HERE rather than absorbed by the consumers: a non-positive or non-integer
    // entry count made `size - 1` a bad clamp bound in the tile mappers, which
    // then read past the end of the plane and silently painted black. Degrading
    // to "no palette" routes the frame down the grayscale path instead.
    if (!Number.isInteger(size) || size <= 0 || size > 65536) return null;
    if (!Number.isInteger(bitsPerEntry) || bitsPerEntry <= 0 || bitsPerEntry > 16) return null;

    const channels = [
        ["00281201", "00281221"],   // red   plain / segmented
        ["00281202", "00281222"],   // green
        ["00281203", "00281223"],   // blue
    ];

    const planes = [];
    for (const [plainTag, segTag] of channels) {
        const plain = readNumericPayload(findTagDeep(ds, plainTag), bitsPerEntry);
        if (plain) { planes.push(plain); continue; }

        const seg = readNumericPayload(findTagDeep(ds, segTag), bitsPerEntry);
        if (seg) {
            const expanded = expandSegmentedPalette(seg, size);
            if (expanded) { planes.push(expanded); continue; }
        }
        return null;
    }

    // Normalize every entry to 8 bits regardless of the declared depth, so
    // consumers never have to care whether the source was 8- or 16-bit.
    const shift = bitsPerEntry > 8 ? (bitsPerEntry - 8) : 0;
    const toByte = (plane) => {
        const out = new Uint8ClampedArray(size);
        for (let i = 0; i < size; i++) {
            const value = plane[Math.min(i, plane.length - 1)] ?? 0;
            out[i] = shift ? (value >> shift) : value;
        }
        return out;
    };

    return {
        size,
        firstMapped,
        bitsPerEntry,
        r: toByte(planes[0]),
        g: toByte(planes[1]),
        b: toByte(planes[2]),
    };
}

/**
 * Expand a Segmented Palette Color LUT (PS3.3 C.7.9.2).
 *
 * Discrete (opcode 0) and linear (opcode 1) segments are supported. Indirect
 * segments (opcode 2) reference a byte offset into a previously-transmitted
 * segment table we do not retain, so those are refused rather than guessed at —
 * a wrong palette on medical data is worse than no palette.
 *
 * @returns {Uint16Array|null}
 */
export function expandSegmentedPalette(segments, size) {
    const out = new Uint16Array(size);
    let write = 0;
    let read = 0;
    let previous = 0;

    while (read < segments.length && write < size) {
        const opcode = segments[read++];
        const count = segments[read++];
        if (!Number.isFinite(opcode) || !Number.isFinite(count)) break;

        if (opcode === 0) {                 // discrete
            for (let i = 0; i < count && write < size; i++) {
                previous = segments[read++];
                out[write++] = previous;
            }
        } else if (opcode === 1) {          // linear ramp from the previous value
            const target = segments[read++];
            for (let i = 1; i <= count && write < size; i++) {
                out[write++] = Math.round(previous + (target - previous) * (i / count));
            }
            previous = target;
        } else {
            console.warn(`[DICOM] unsupported segmented-palette opcode ${opcode}; palette ignored`);
            return null;
        }
    }

    if (write === 0) return null;
    // Pad a short table by repeating its last entry rather than leaving zeros,
    // which would render as an abrupt black band at the top of the value range.
    for (let i = write; i < size; i++) out[i] = out[write - 1];
    return out;
}

/* ------------------------------------------------------------------ */
/* CIELab (used by SEG RecommendedDisplayCIELabValue, PS3.3 C.10.7.1.1) */
/* ------------------------------------------------------------------ */

/**
 * Convert a DICOM PCS-Value CIELab triplet (three 16-bit unsigned integers) to
 * sRGB bytes.
 *
 * The PCS white point is D50, not D65 — using the D65 matrix here (a common
 * shortcut) shifts every segment colour noticeably towards blue.
 *
 * @param {ArrayLike<number>} lab [L*, a*, b*] as stored 16-bit values
 * @returns {[number, number, number]} sRGB 0..255
 */
export function cielabToSrgb(lab) {
    if (!lab || lab.length < 3) return [255, 0, 0];

    const L = (Number(lab[0]) / 65535) * 100;
    const a = (Number(lab[1]) / 65535) * 255 - 128;
    const b = (Number(lab[2]) / 65535) * 255 - 128;

    const fy = (L + 16) / 116;
    const fx = fy + a / 500;
    const fz = fy - b / 200;

    const finv = (t) => (t > 6 / 29) ? (t * t * t) : (3 * (6 / 29) * (6 / 29) * (t - 4 / 29));

    // D50 white point (ICC PCS).
    const Xn = 0.96422, Yn = 1.0, Zn = 0.82521;
    const X = Xn * finv(fx);
    const Y = Yn * finv(fy);
    const Z = Zn * finv(fz);

    // sRGB primaries with a Bradford-adapted D50 white.
    let r =  3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z;
    let g = -0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z;
    let bl =  0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z;

    const gamma = (c) => {
        c = Math.max(0, Math.min(1, c));
        return c <= 0.0031308 ? (12.92 * c) : (1.055 * Math.pow(c, 1 / 2.4) - 0.055);
    };

    return [
        Math.round(gamma(r) * 255),
        Math.round(gamma(g) * 255),
        Math.round(gamma(bl) * 255),
    ];
}

/**
 * Deterministic fallback colour for a segment that carries no
 * RecommendedDisplayCIELabValue.
 *
 * The golden-angle hue rotation keeps adjacent segments visually distinct, and
 * being a pure function of the index means the same segment gets the same
 * colour on every reload — a random palette would make two screenshots of the
 * same slide disagree.
 *
 * @param {number} index
 * @returns {[number, number, number]} sRGB 0..255
 */
export function hueForIndex(index) {
    const h = (index * 137.508) % 360;   // golden angle
    const s = 0.72, l = 0.55;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const seg = Math.floor(h / 60) % 6;
    const rgb = [
        [c, x, 0], [x, c, 0], [0, c, x],
        [0, x, c], [x, 0, c], [c, 0, x],
    ][seg];
    return [
        Math.round((rgb[0] + m) * 255),
        Math.round((rgb[1] + m) * 255),
        Math.round((rgb[2] + m) * 255),
    ];
}

/* ------------------------------------------------------------------ */
/* Half-float encoding (R16F / RG16F / RGBA16F texture upload)         */
/* ------------------------------------------------------------------ */

const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);

/**
 * Encode one float as an IEEE 754 half-precision bit pattern.
 *
 * WebGL2's `HALF_FLOAT` upload path takes a `Uint16Array` of these patterns —
 * handing it a `Float32Array` raises INVALID_OPERATION, so the conversion has to
 * happen here rather than being left to the driver.
 *
 * Precision note: half-float carries ~11 mantissa bits and tops out at ±65504.
 * That is ample for the normalized 0..1 ranges Parametric Maps typically declare
 * (~0.0005 resolution), but a map in raw Hounsfield units loses sub-unit detail
 * above 2048. Values outside the representable range saturate to ±Infinity
 * rather than wrapping.
 *
 * @param {number} value
 * @returns {number} uint16 bit pattern
 */
export function floatToHalf(value) {
    _f32[0] = value;
    const x = _u32[0];

    const sign = (x >>> 16) & 0x8000;
    let exponent = (x >>> 23) & 0xff;
    let mantissa = x & 0x7fffff;

    // NaN / Infinity pass through with the sign preserved.
    if (exponent === 0xff) {
        return sign | 0x7c00 | (mantissa ? 0x200 : 0);
    }

    // Rebias 127 -> 15.
    let e = exponent - 127 + 15;

    if (e >= 0x1f) return sign | 0x7c00;          // overflow -> Infinity
    if (e <= 0) {
        if (e < -10) return sign;                 // underflow -> signed zero
        // Subnormal: restore the implicit leading 1 and shift it into place.
        mantissa |= 0x800000;
        const shift = 14 - e;
        const half = sign | (mantissa >> shift);
        // Round to nearest, ties away from zero.
        return ((mantissa >> (shift - 1)) & 1) ? half + 1 : half;
    }

    const half = sign | (e << 10) | (mantissa >> 13);
    return (mantissa & 0x1000) ? half + 1 : half;  // round to nearest
}

/**
 * Guard for {@link warnHalfFloatPrecisionOnce}.
 *
 * Keyed on the application context rather than held as a module flag, because
 * "once" means once per *session*: a host that tears the viewer down and builds
 * a new one gets a new context and deserves to hear about a precision setting
 * again. A module-level boolean would also make the warning depend on whatever
 * else happened to touch this module first, which is exactly the kind of hidden
 * ordering coupling that makes a diagnostic untrustworthy.
 */
const _warnedHalfFloatPrecision = new WeakSet();

/**
 * Warn when the renderer will quantize a half-float pack before any shader can
 * read it.
 *
 * Uploading `R16F`/`RGBA16F` only buys fidelity if the renderer's first-pass
 * colour target keeps float precision, and that is a deployment decision:
 * `webGlPrecision: "auto"` negotiates it from the data (these packs report
 * themselves non-normalized) and `"float16"` forces it. **Only `"unorm8"` — the
 * `src/config.json` default — actually bands**, so only that is worth a warning.
 * The previous per-source version fired for `"float16"` too, telling a correctly
 * configured deployment to change a working setting, and repeated itself once
 * per series in a study.
 *
 * @param {string} label the subsystem to name in the message
 */
export function warnHalfFloatPrecisionOnce(label) {
    const context = globalThis.APPLICATION_CONTEXT;
    if (!context || _warnedHalfFloatPrecision.has(context)) return;
    const precision = context.getOption?.("webGlPrecision", "unorm8");
    if (precision !== "unorm8") return;
    _warnedHalfFloatPrecision.add(context);
    console.warn(
        `[${label}] webGlPrecision is "unorm8"; the renderer's first pass will quantize samples ` +
        `to 8 bits before the shader reads them, so a narrow window will band. Set ` +
        `"webGlPrecision": "auto" in the session params (or the deployment setup) for full fidelity.`
    );
}

/**
 * Encode a plane of floats into an interleaved half-float buffer, writing into
 * one channel and leaving the rest untouched.
 *
 * `componentsPerPack` is the pack's own width, not always 4: the renderer takes
 * `R16F` (1) and `RG16F` (2) as well as `RGBA16F`, and a single-channel plane in
 * an RGBA pack is three quarters padding. It doubles as the stride and as the
 * bound, so a buffer sized for the narrow format is filled completely rather
 * than a quarter of the way.
 *
 * @param {Uint16Array} target half-float destination
 * @param {ArrayLike<number>} values source plane
 * @param {number} channel component index within the pack, `0..componentsPerPack-1`
 * @param {number} [componentsPerPack=4] components per pixel in `target`
 */
export function writeHalfChannel(target, values, channel, componentsPerPack = 4) {
    const n = Math.min(values.length, Math.floor(target.length / componentsPerPack));
    for (let i = 0, o = channel; i < n; i++, o += componentsPerPack) {
        target[o] = floatToHalf(values[i]);
    }
}

/* ------------------------------------------------------------------ */
/* Bit-packed frames (SEG BINARY, PS3.5 8.1.1)                         */
/* ------------------------------------------------------------------ */

/**
 * Unpack a 1-bit-per-pixel DICOM frame into one byte per pixel (0 or 1).
 *
 * Bits are packed least-significant-bit first and run continuously across the
 * whole frame — there is no row padding, which is why a naive per-row unpack
 * shears the mask.
 *
 * @param {Uint8Array} bytes
 * @param {number} count number of pixels to produce
 * @returns {Uint8Array}
 */
export function unpackBits(bytes, count) {
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
        out[i] = (bytes[i >> 3] >> (i & 7)) & 1;
    }
    return out;
}

/**
 * Slice one frame out of a bit-packed multi-frame PixelData blob.
 * Frames are NOT byte-aligned in the BINARY encoding, hence the bit offset.
 */
export function unpackBitsFrame(bytes, frameIndex, pixelsPerFrame) {
    const out = new Uint8Array(pixelsPerFrame);
    const base = frameIndex * pixelsPerFrame;
    for (let i = 0; i < pixelsPerFrame; i++) {
        const bit = base + i;
        out[i] = (bytes[bit >> 3] >> (bit & 7)) & 1;
    }
    return out;
}
