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

export type EadInputType = "wsi" | "collection" | EadAnnotationType;

/** `"single"` = one ROI per job; `"multiple"` = ROIs collected into a collection. */
export type EadRoiMode = "single" | "multiple";

export interface InputKey {
    inputKey: string;
    /** Nesting depth: 0 = direct input, 1 = inside one collection, >1 = nested. */
    inCollection: number;
}

export interface TypeInputKey extends InputKey {
    type: EadInputType;
}

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

/** Why an EAD cannot be driven from this UI. All flags false ⇒ compatible. */
export interface EadIncompatibility {
    singleAndMultiInput: boolean;
    noCompatibleInputs: boolean;
    nestedInputCollections: boolean;
    sameInputTypes: boolean;
}

export function isV3Ead(ead: unknown): ead is EadDocument {
    return !!ead && typeof ead === "object" && "io" in (ead as any) && "modes" in (ead as any);
}

function isCollection(type: unknown): boolean { return type === "collection"; }
function isAnnotationType(type: unknown): type is EadAnnotationType {
    return EAD_ANNOTATION_TYPES.includes(type as EadAnnotationType);
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

/** Every annotation type the app accepts, across all of its declared modes. */
export function getAllAnnotationInputTypes(ead: EadDocument | undefined): EadAnnotationType[] {
    if (!ead) return [];
    const seen = new Set<EadAnnotationType>();
    for (const mode of getModes(ead)) {
        for (const type of getAnnotationInputTypes(ead, mode)) seen.add(type);
    }
    return [...seen];
}

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

// ── input-key resolution ────────────────────────────────────────────────────

/**
 * Depth-first search for `type` inside an io node, tracking how many
 * `collection` wrappers we descended through. Mirrors the reference
 * `searchForTypeWithCollection`.
 */
function searchForTypeWithCollection(type: EadInputType, node: any): InputKey | undefined {
    if (!node || typeof node !== "object") return undefined;
    for (const [key, value] of Object.entries(node)) {
        if (!value || typeof value !== "object") continue;
        const valueType = (value as any).type;
        if (valueType === type) {
            return { inputKey: key, inCollection: 0 };
        }
        if (isCollection(valueType)) {
            const found = searchForTypeWithCollection(type, value);
            if (found) {
                found.inputKey = key;
                found.inCollection += 1;
                return found;
            }
        }
    }
    return undefined;
}

function searchForTypeAtKey(type: EadInputType, key: string, io: any): InputKey | undefined {
    const input = io?.[key];
    if (!input || typeof input !== "object") return undefined;
    if (input.type === type) return { inputKey: key, inCollection: 0 };
    if (isCollection(input.type)) {
        const found = searchForTypeWithCollection(type, input);
        if (found) {
            found.inputKey = key;
            found.inCollection += 1;
            return found;
        }
    }
    return undefined;
}

/** First input key of `type` declared by `mode`, with its collection depth. */
export function getTypeInputKey(type: EadInputType, ead: EadDocument, mode: EadMode): InputKey | undefined {
    for (const key of getInputs(ead, mode)) {
        const result = searchForTypeAtKey(type, key, ead?.io);
        if (result) return result;
    }
    return undefined;
}

/** Every input key of `type` declared by `mode`. */
export function getTypeInputKeys(type: EadInputType, ead: EadDocument, mode: EadMode): TypeInputKey[] {
    const out: TypeInputKey[] = [];
    for (const key of getInputs(ead, mode)) {
        const result = searchForTypeAtKey(type, key, ead?.io);
        if (result) out.push({ ...result, type });
    }
    return out;
}

export function getTypesInputKeys(types: readonly EadInputType[], ead: EadDocument, mode: EadMode): TypeInputKey[] {
    return types.flatMap(type => getTypeInputKeys(type, ead, mode));
}

/** The mandatory `wsi` input key — the slide every job runs on. */
export function getWsiInputKey(ead: EadDocument, mode: EadMode): string | undefined {
    return getTypeInputKey("wsi", ead, mode)?.inputKey;
}

/** ROI shapes this mode accepts, in declaration order of EAD_ANNOTATION_TYPES. */
export function getAnnotationInputTypes(ead: EadDocument, mode: EadMode): EadAnnotationType[] {
    return EAD_ANNOTATION_TYPES.filter(type => !!getTypeInputKey(type, ead, mode));
}

/**
 * Whether the app takes one ROI per job or a collection of them.
 * Preprocessing never takes user ROIs, so it is always reported as `single`.
 */
export function getRoiMode(ead: EadDocument, mode: EadMode): EadRoiMode {
    if (mode === "preprocessing") return "single";
    const types = getAnnotationInputTypes(ead, mode);
    const results = getTypesInputKeys(types, ead, mode);
    if (!results.length) return "single";
    return results.every(r => r.inCollection === 1) ? "multiple" : "single";
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

// ── compatibility ───────────────────────────────────────────────────────────

/**
 * Can this UI drive ROI submission for `mode`?
 *
 * Ported from `checkEadInputCompatibility$`. Preprocessing is excluded upstream
 * (the user never creates preprocessing ROIs), so callers should only ask about
 * `standalone` / `postprocessing`.
 */
export function checkCompatibility(ead: EadDocument, mode: EadMode): EadIncompatibility {
    const types = EAD_ANNOTATION_TYPES as readonly EadInputType[];
    const inputKeyTypes = getTypesInputKeys(types, ead, mode);

    const singleInput = inputKeyTypes.some(k => k.inCollection === 0);
    const multiInput = inputKeyTypes.some(k => k.inCollection === 1);
    const nestedInputCollections = inputKeyTypes.some(k => k.inCollection > 1);

    const duplicatesAtDepth = (depth: number) =>
        EAD_ANNOTATION_TYPES.some(type =>
            inputKeyTypes.filter(k => k.inCollection === depth && k.type === type).length > 1);

    return {
        singleAndMultiInput: singleInput && multiInput,
        noCompatibleInputs: !(singleInput || multiInput),
        nestedInputCollections,
        sameInputTypes: duplicatesAtDepth(0) || duplicatesAtDepth(1),
    };
}

export function isCompatible(incompatibility: EadIncompatibility): boolean {
    return !Object.values(incompatibility).some(Boolean);
}

/** i18n keys describing each incompatibility flag, in a stable order. */
export const INCOMPATIBILITY_KEYS: Record<keyof EadIncompatibility, string> = {
    singleAndMultiInput: "ead.incompatible.singleAndMulti",
    noCompatibleInputs: "ead.incompatible.noCompatibleInputs",
    nestedInputCollections: "ead.incompatible.nestedCollections",
    sameInputTypes: "ead.incompatible.sameInputTypes",
};

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
