/// <reference path="../../src/types/globals.d.ts" />

/**
 * What an EAD says a job *produces*, and how to attribute it.
 *
 * The input half of an EAD has always been read (`ead.ts`); the output half was
 * declared and ignored, which is why an app whose whole point is "one number per
 * region you drew" could only ever show an unattributed list of numbers.
 *
 * The interesting part is the `reference` chain. An output node names what its
 * value describes:
 *
 *   "reference": "io.my_wsi"                 → the slide
 *   "reference": "io.my_rectangles"          → the input collection as a whole
 *   "reference": "io.my_rectangles.items"    → ONE VALUE PER MEMBER of it
 *
 * The last form is the one with nowhere to go in a flat results table, and it is
 * the one this module exists to resolve. Nothing here is app-specific: the same
 * code describes any v3 EAD.
 *
 * Pure functions — no DOM, no client, no `window`. Directly unit-testable, like
 * `visibility.ts`.
 */

import {
    getOutputs, leafTypeOf,
    EMPAIA_ANNOTATION_TYPES, EMPAIA_PRIMITIVE_TYPES,
    type EadDocument, type EadMode,
} from "./ead";

/**
 * What an output actually holds, once every `collection` wrapper is stripped.
 *
 * The distinction the resolver used to lack. Dispatching on "is it a collection?"
 * alone meant an app whose output is a collection of *collections of points*
 * (TA03, TA06 — thousands of them) got a `collections/{id}/items/query` whose
 * records have no `value` at all: one wasted request per output per job, and a
 * results table column of blanks where the honest answer was "these are on the
 * slide, not in a table".
 */
export type OutputKind = "primitive" | "annotation" | "class" | "pixelmap" | "unknown";

export function outputKind(spec: { leafType?: string }): OutputKind {
    const type = spec.leafType ?? "";
    if ((EMPAIA_PRIMITIVE_TYPES as readonly string[]).includes(type)) return "primitive";
    if ((EMPAIA_ANNOTATION_TYPES as readonly string[]).includes(type)) return "annotation";
    if (type === "class") return "class";
    if (type.endsWith("pixelmap")) return "pixelmap";
    return "unknown";
}

/** One declared output of a mode, with its reference chain resolved. */
export interface OutputSpec {
    /** The io key, e.g. `"tumor_cell_counts"`. */
    key: string;
    /** The declared `type`: `"collection"`, a primitive, an annotation, a pixelmap. */
    type: string;
    /** For a collection, the `items.type`. */
    itemType?: string;
    /** The type actually held, after every `collection` wrapper — what decides {@link outputKind}. */
    leafType?: string;
    /** How many `collection` wrappers deep that leaf sits. */
    leafDepth?: number;
    /**
     * The reference that governs attribution: a collection's `items.reference`
     * when it is a per-item output, otherwise the node's own `reference`.
     */
    reference?: string;
    /** First segment of the reference after `io.` — e.g. `"my_rectangles"`. */
    referenceKey?: string;
    /** True when the reference ends at `.items`: one value per input member. */
    perItem: boolean;
    name?: string;
    description?: string;
}

/** Primitive value types a per-item collection can hold. */
const PRIMITIVE_TYPES = new Set(["integer", "float", "bool", "string"]);

export function isPrimitiveType(type: string | undefined): boolean {
    return !!type && PRIMITIVE_TYPES.has(type);
}

/**
 * Split `"io.my_rectangles.items"` into its input key and whether it addresses
 * the members. Anything not rooted at `io.` yields no key — the reference then
 * describes something outside the io block and is not ours to resolve.
 */
function parseReference(reference: unknown): { referenceKey?: string; perItem: boolean } {
    if (typeof reference !== "string" || !reference.startsWith("io.")) {
        return { perItem: false };
    }
    const segments = reference.slice(3).split(".").filter(Boolean);
    if (!segments.length) return { perItem: false };
    return {
        referenceKey: segments[0],
        perItem: segments[segments.length - 1] === "items",
    };
}

/** Every declared output of `mode`, in declaration order. */
export function describeOutputs(ead: EadDocument | undefined, mode: EadMode): OutputSpec[] {
    if (!ead) return [];
    const io = ead.io;
    if (!io || typeof io !== "object") return [];

    const specs: OutputSpec[] = [];
    for (const key of getOutputs(ead, mode)) {
        const node: any = (io as any)[key];
        if (!node || typeof node !== "object") continue;

        const type = typeof node.type === "string" ? node.type : "";
        // A collection's attribution lives on its ITEMS, not on the collection:
        // `tumor_cell_counts` as a whole describes nothing, each integer in it
        // describes one rectangle.
        const isCollection = type === "collection";
        const items = isCollection && node.items && typeof node.items === "object" ? node.items : undefined;
        const { referenceKey, perItem } = parseReference(items ? items.reference : node.reference);

        const leaf = leafTypeOf(node);
        specs.push({
            key,
            type,
            itemType: items && typeof items.type === "string" ? items.type : undefined,
            leafType: leaf?.type,
            leafDepth: leaf?.depth,
            reference: (items ? items.reference : node.reference) as string | undefined,
            referenceKey,
            perItem: isCollection && perItem,
            name: typeof node.name === "string" ? node.name : undefined,
            description: typeof node.description === "string" ? node.description : undefined,
        });
    }
    return specs;
}

/** Per-item outputs that resolve against `referenceKey`'s members. */
export function perItemOutputs(specs: OutputSpec[], referenceKey: string | undefined): OutputSpec[] {
    if (!referenceKey) return [];
    return specs.filter(spec => spec.perItem && spec.referenceKey === referenceKey);
}

/**
 * One value, as a user reads it.
 *
 * Floats are trimmed to four decimals — a raw `0.9327239990234375` in a label is
 * noise, and the exact value stays readable under its own key in `meta`.
 *
 * There used to be a `describeAnnotationValues` beside this, composing
 * `class · name 0.93` into the annotation's *name* (`meta.category`) because the
 * label area could not be written to. That produced `"Tumor ratio 0 6"` once the
 * board appended the annotation's own label, and it was not idempotent — its
 * output was fed back in as a lead, so re-showing an analysis grew the string.
 * The label is a value slot now (`object.displayValue`), so a value goes where a
 * value belongs and the name is left alone.
 */
/**
 * One value with the name of what it measures — what an annotation's label shows.
 *
 * `0` on its own is not a reading, it is a digit: nothing on screen says whether
 * it is a ratio, a count or a score. The app already names its outputs (`Tumor
 * Ratio`), so the label carries that name and the number together.
 *
 * The name is the *display* one only. An output with no name falls back to the
 * bare value rather than to its io key or record id, which would be worse than
 * saying nothing — `bfc1a2e4-… 0` is noise, not an explanation.
 */
export function labelForOutputValue(name: unknown, value: unknown): string {
    const text = formatOutputValue(value);
    if (!text) return "";
    const label = String(name ?? "").trim();
    return label ? `${label} ${text}` : text;
}

export function formatOutputValue(value: unknown): string {
    if (typeof value === "boolean") return value ? "yes" : "no";
    if (typeof value === "number") {
        return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
    }
    if (value === undefined || value === null) return "";
    return String(value);
}

/** One value an output collection produced. */
export interface OutputItem {
    value: unknown;
    /** The record it describes — an annotation id for a per-item output. */
    reference_id?: string | null;
}

/** One input region and everything the analysis said about it. */
export interface RegionResultRow {
    /** EMPAIA annotation id of the region. */
    regionId: string;
    /** Its position in the input collection, 1-based — the label when nothing better exists. */
    index: number;
    /** output key → value. Absent keys mean the analysis produced nothing for it. */
    values: Record<string, unknown>;
}

/**
 * Attribute per-item output values back to the input regions.
 *
 * `reference_id` wins wherever it is populated: it is the wire's own answer and
 * it survives a backend that reorders. Positional zip is the fallback for an
 * output whose items carry none — correct only because both collections are
 * ordered, which is why the input order is read from the collection record
 * rather than reconstructed from the canvas.
 *
 * A region with no value for an output is simply absent from `values`, never
 * `null` — the app may legitimately have produced fewer items than there were
 * regions, and inventing a null there would render as a computed result.
 */
export function zipRegionResults(
    regionIds: string[],
    perItem: Record<string, OutputItem[]>,
): RegionResultRow[] {
    const rows: RegionResultRow[] = (regionIds ?? []).map((regionId, index) => ({
        regionId: String(regionId),
        index: index + 1,
        values: {},
    }));
    const byRegionId = new Map(rows.map(row => [row.regionId, row]));

    for (const [key, items] of Object.entries(perItem ?? {})) {
        const list = Array.isArray(items) ? items : [];
        const referenced = list.some(item =>
            typeof item?.reference_id === "string" && !!item.reference_id);

        // An item that carries no value is not a value of `undefined` — it is a
        // record of a different shape (an inner collection, an annotation) that
        // this output should never have been asked for. Writing the key anyway is
        // what rendered a column of empty cells instead of the "—" that means
        // "nothing here".
        if (referenced) {
            for (const item of list) {
                if (item?.value === undefined) continue;
                const row = byRegionId.get(String(item?.reference_id ?? ""));
                if (row) row.values[key] = item.value;
            }
            continue;
        }

        for (let i = 0; i < list.length && i < rows.length; i++) {
            if (list[i]?.value === undefined) continue;
            rows[i].values[key] = list[i].value;
        }
    }
    return rows;
}

// ── per-annotation values ───────────────────────────────────────────────────

/** A value an analysis produced *about one annotation*, ready to render. */
export interface AnnotationValueRow {
    /** EMPAIA annotation id the value describes — what a focus click needs. */
    annotationId: string;
    name: string;
    value: unknown;
    description?: string;
}

/** What a whole group of same-named values looks like, without listing them. */
export interface AnnotationValueSummary {
    name: string;
    count: number;
    /** Numeric groups only. */
    min?: number;
    max?: number;
    mean?: number;
    /** True when every value in the group is identical — the honest headline. */
    uniform: boolean;
    /** Non-numeric groups: value → how many carry it, most common first. */
    tally?: Array<{ value: string; count: number }>;
}

export interface AnnotationValues {
    /** Rows to render, already capped. Empty when `truncated` and nothing fits. */
    rows: AnnotationValueRow[];
    /** Every value, grouped and reduced. Always present — cheap, and the headline. */
    summary: AnnotationValueSummary[];
    /** Total values, before any cap. */
    total: number;
    /** True when `rows` is a prefix of the data rather than all of it. */
    truncated: boolean;
}

/**
 * Per-annotation values, aggregated first and listed second.
 *
 * A real analysis produces one of these per detected object — tens of thousands
 * for a nucleus detector. Rendering a row each is not a long list, it is a dead
 * tab: every row is a van binding and a DOM node, and the browser stops before
 * the user has learned anything the first screenful did not already say.
 *
 * So the summary is unconditional and the rows are the extra. Above `limit`
 * nothing is listed at all — a truncated list is worse than none, because it
 * silently answers "what is the range?" with whatever happened to sort first.
 *
 * `uniform` earns its own field because it is the one shape that makes a caller
 * doubt the integration rather than the data: ten identical confidences read as
 * a bug until something says "all ten are 0.9".
 */
export function summarizeAnnotationValues(
    primitives: Array<Record<string, any>> | undefined,
    limit = 200,
): AnnotationValues {
    const rows: AnnotationValueRow[] = [];
    for (const primitive of primitives ?? []) {
        if (primitive?.reference_type !== "annotation") continue;
        const annotationId = typeof primitive.reference_id === "string" ? primitive.reference_id : "";
        if (!annotationId || primitive.value === undefined) continue;
        rows.push({
            annotationId,
            name: String(primitive.name ?? "").trim() || "value",
            value: primitive.value,
            description: typeof primitive.description === "string" ? primitive.description : undefined,
        });
    }

    const groups = new Map<string, AnnotationValueRow[]>();
    for (const row of rows) {
        const list = groups.get(row.name);
        if (list) list.push(row);
        else groups.set(row.name, [row]);
    }

    const summary: AnnotationValueSummary[] = [];
    for (const [name, list] of groups) {
        const numbers = list
            .map(r => (typeof r.value === "number" && Number.isFinite(r.value) ? r.value : undefined))
            .filter((n): n is number => n !== undefined);

        if (numbers.length === list.length && numbers.length) {
            const min = Math.min(...numbers);
            const max = Math.max(...numbers);
            summary.push({
                name, count: list.length, min, max,
                mean: numbers.reduce((a, b) => a + b, 0) / numbers.length,
                uniform: min === max,
            });
            continue;
        }

        const counts = new Map<string, number>();
        for (const row of list) {
            const key = formatOutputValue(row.value);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        const tally = [...counts.entries()]
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
        summary.push({ name, count: list.length, uniform: tally.length === 1, tally });
    }
    summary.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
    const truncated = rows.length > cap;
    return { rows: truncated ? [] : rows, summary, total: rows.length, truncated };
}

// ── attributing shapes to the output that produced them ─────────────────────

/** The one annotation output of a mode, when there is exactly one. */
export interface AnnotationOutputIdentity {
    /** The io key, e.g. `"my_cells"`. */
    key: string;
    /** What to call it: the io node's own `name` when it declares one. */
    label: string;
}

/**
 * Which declared output a job's shapes came from — when that is answerable.
 *
 * Three of the tutorial apps (TA03, TA04, TA06) declare an annotation output and
 * **no class output**, and an app may only write what its EAD declares, so those
 * shapes arrive carrying no class at all. Something still has to name them: the
 * annotations module stamps a preset onto every imported object, so the choice is
 * *which* preset, not whether — and without this the answer was `unknownPreset`,
 * which renders as the literal "Unknown" for the whole result set.
 *
 * `undefined` for zero outputs (nothing to name) and for **several** (nothing
 * honest to say): the pooled `annotations/query` cannot tell which output a shape
 * came from without one collection query per output, which `loadResolvedResults`
 * already refuses to pay for `annotationCount`. Same rule, deliberately — if one
 * of them ever learns to split a multi-output response, so should the other.
 */
export function soleAnnotationOutput(
    ead: EadDocument | undefined, mode: EadMode,
): AnnotationOutputIdentity | undefined {
    const annotationOutputs = describeOutputs(ead, mode)
        .filter(spec => outputKind(spec) === "annotation");
    if (annotationOutputs.length !== 1) return undefined;
    const spec = annotationOutputs[0];
    return { key: spec.key, label: spec.name?.trim() || spec.key };
}
