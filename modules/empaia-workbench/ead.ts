/// <reference path="../../src/types/globals.d.ts" />

/**
 * EMPAIA App Description (EAD) v3 reader.
 *
 * Pure functions ported from the reference `EadService`
 * (`libs/empaia-ui-commons/src/lib/shared/services/ead.service.ts`) plus the
 * v3 model constants from `../models/ead.models.ts`, with the app-side
 * compatibility checks from
 * `apps/generic-app-ui-v3/src/app/ead/store/ead/ead.effects.ts`.
 *
 * The EAD arrives inside the scope record and is therefore **backend-supplied,
 * not operator-supplied**: every accessor tolerates a missing/misshaped block
 * and returns an empty answer rather than throwing into the boot path.
 */

export const V3_MODES = ["standalone", "preprocessing", "postprocessing"] as const;
export type EadMode = typeof V3_MODES[number];

/** ROI shapes an app may take as input. Same list the reference UI supports. */
export const EAD_ANNOTATION_TYPES = ["rectangle", "polygon", "circle"] as const;
export type EadAnnotationType = typeof EAD_ANNOTATION_TYPES[number];



export interface RenderingHint {
    class_value: string;
    color: string;
    color_selection?: string;
    color_hover?: string;
}

export interface EadDocument {
    name?: string;
    name_short?: string;
    namespace?: string;
    description?: string;
    io?: Record<string, any>;
    modes?: Partial<Record<EadMode, { inputs?: string[]; outputs?: string[]; containerized?: boolean }>>;
    rendering?: { annotations?: RenderingHint[]; nominal_pixelmaps?: RenderingHint[] };
    [key: string]: any;
}

export function isV3Ead(ead: unknown): ead is EadDocument {
    return !!ead && typeof ead === "object" && "io" in (ead as any) && "modes" in (ead as any);
}


// ── mode / io accessors ─────────────────────────────────────────────────────

/**
 * The app's display name. `name_short` exists for exactly this — narrow UI
 * labels — so it wins; `name` is the fallback, and an EAD that declares neither
 * yields undefined so callers can keep a generic label.
 */
export function getAppName(ead: EadDocument | undefined): string | undefined {
    const short = ead?.name_short;
    if (typeof short === "string" && short.trim()) return short.trim();
    const full = ead?.name;
    return typeof full === "string" && full.trim() ? full.trim() : undefined;
}

/**
 * Descend through `collection` wrappers to the value an io node actually holds.
 *
 * The one place that knows how a v3 collection nests. Both halves of the reader
 * need it — the input side to tell a slide from a slide *collection*, the output
 * side to tell a collection of numbers from a collection of annotations — and
 * having each answer it separately is how the output side ended up asking the
 * server for the `value` of records that have none.
 *
 * v3 collections always name their element type under `items`; the sibling scan
 * is the fallback for a document that does not.
 */
export function leafTypeOf(node: any, depth = 0): { type: string; depth: number } | undefined {
    if (!node || typeof node !== "object") return undefined;
    const type = typeof node.type === "string" ? node.type : "";
    if (!type) return undefined;
    if (type !== "collection") return { type, depth };

    const items = node.items;
    if (items && typeof items === "object") return leafTypeOf(items, depth + 1);
    for (const value of Object.values(node)) {
        if (value && typeof value === "object" && typeof (value as any).type === "string") {
            return leafTypeOf(value, depth + 1);
        }
    }
    return undefined;
}

/** Annotation shapes the wire models, whether or not the tool can draw them. */
export const EMPAIA_ANNOTATION_TYPES =
    ["point", "line", "arrow", "circle", "rectangle", "polygon"] as const;

/** Primitive value types a collection may hold. */
export const EMPAIA_PRIMITIVE_TYPES = ["integer", "float", "bool", "string"] as const;

export function getModes(ead: EadDocument): EadMode[] {
    const modes = ead?.modes;
    if (!modes || typeof modes !== "object") return [];
    return Object.keys(modes).filter(m => (V3_MODES as readonly string[]).includes(m)) as EadMode[];
}

export function getInputs(ead: EadDocument, mode: EadMode): string[] {
    const inputs = ead?.modes?.[mode]?.inputs;
    return Array.isArray(inputs) ? inputs.filter(k => typeof k === "string") : [];
}

export function getOutputs(ead: EadDocument, mode: EadMode): string[] {
    const outputs = ead?.modes?.[mode]?.outputs;
    return Array.isArray(outputs) ? outputs.filter(k => typeof k === "string") : [];
}

export function isContainerized(ead: EadDocument, mode: EadMode): boolean {
    // Only postprocessing declares this; every other mode runs containerized.
    const declared = ead?.modes?.[mode]?.containerized;
    return typeof declared === "boolean" ? declared : mode !== "postprocessing";
}

// ── rendering hints ─────────────────────────────────────────────────────────

export function getAnnotationRenderingHints(ead: EadDocument): RenderingHint[] {
    const hints = ead?.rendering?.annotations;
    return Array.isArray(hints) ? hints.filter(h => h && typeof h.class_value === "string") : [];
}

export function getPixelmapRenderingHints(ead: EadDocument): RenderingHint[] {
    const hints = ead?.rendering?.nominal_pixelmaps;
    return Array.isArray(hints) ? hints.filter(h => h && typeof h.class_value === "string") : [];
}

/** class value → color, from the EAD's annotation rendering hints. */
export function annotationColorMap(ead: EadDocument): Map<string, string> {
    const map = new Map<string, string>();
    for (const hint of getAnnotationRenderingHints(ead)) {
        if (typeof hint.color === "string") map.set(hint.class_value, hint.color);
    }
    return map;
}

/** class value → color, from the EAD's nominal-pixelmap rendering hints. */
export function pixelmapColorMap(ead: EadDocument): Map<string, string> {
    const map = new Map<string, string>();
    for (const hint of getPixelmapRenderingHints(ead)) {
        if (typeof hint.color === "string") map.set(hint.class_value, hint.color);
    }
    return map;
}

// ── xOpat interop ───────────────────────────────────────────────────────────

/**
 * EMPAIA ROI type → the xOpat annotation factory that draws it.
 * A `circle` becomes an ellipse constrained to rx === ry on export
 * (see `convertor.ts`); xOpat has no dedicated circle factory.
 */
export const ROI_TYPE_TO_FACTORY: Record<EadAnnotationType, string> = {
    rectangle: "rect",
    polygon: "polygon",
    circle: "ellipse",
};

export function factoryForRoiType(type: EadAnnotationType): string {
    return ROI_TYPE_TO_FACTORY[type] ?? "rect";
}
