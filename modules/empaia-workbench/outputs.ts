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
 * The label an annotation carrying per-object values should show.
 *
 * `class · name 0.93`. The class leads because it is what the annotation *is*;
 * the numbers follow because they are what an analysis said about it. Overwriting
 * the class outright would trade a permanent fact for a per-run one.
 *
 * Floats are trimmed to four decimals — a raw `0.9327239990234375` in a board row
 * is noise, and the exact value stays readable under its own key in `meta`.
 */
export function describeAnnotationValues(
    object: { empaiaClass?: string } | undefined,
    values: Array<{ name?: string; value: unknown }>,
    existingCategory?: unknown,
): string {
    const parts: string[] = [];
    const lead = typeof existingCategory === "string" && existingCategory.trim()
        ? existingCategory.trim()
        : shortClassName(object?.empaiaClass);
    if (lead) parts.push(lead);

    for (const entry of values ?? []) {
        const name = String(entry?.name ?? "").trim();
        const value = formatOutputValue(entry?.value);
        if (!value) continue;
        parts.push(name ? `${name} ${value}` : value);
    }
    return parts.join(" · ");
}

/** `org.empaia.vendor.app.v1.classes.tumor` reads as `tumor` in a list. */
function shortClassName(classValue: string | undefined): string {
    if (typeof classValue !== "string" || !classValue) return "";
    const last = classValue.split(".").filter(Boolean).pop();
    return last ?? "";
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
