/// <reference path="../../src/types/globals.d.ts" />

/**
 * What a mode needs, and where each of it comes from.
 *
 * The reader used to ask the io block two hardcoded questions — "which key is the
 * wsi?" and "which keys are ROI shapes?" — and throw away everything else,
 * including the collection depth of the answers. That is how an app declaring
 * `"my_wsis": {"type":"collection","items":{"type":"wsi"}}` had a bare slide id
 * PUT into a collection-typed input and produced a job that could only fail
 * server-side, with no warning anywhere in the UI.
 *
 * So describe the whole input list instead, once, and let every other decision —
 * can this mode run, what does the drawing tool produce, what does a job need
 * wiring to — read off that description.
 *
 * Pure functions, no DOM, no client: directly testable against the tutorial EADs
 * in `test/fixtures/ead/`, the way `visibility.ts` and `outputs.ts` are.
 */

import {
    getInputs, getModes, getOutputs, isContainerized, leafTypeOf,
    EAD_ANNOTATION_TYPES, type EadAnnotationType, type EadDocument, type EadMode,
} from "./ead";

/** Where the value for an input comes from. */
export type InputSource =
    /** The open slide. */
    | "wsi"
    /** One region the user draws. */
    | "roi"
    /** A collection of regions the user draws — the staged batch. */
    | "roi-collection"
    /** Produced by another mode of this same app (postprocessing consumes preprocessing). */
    | "from-job"
    /** Nothing here can supply it. */
    | "unsupported";

export interface ModeInput {
    /** The io key, e.g. `"my_rectangles"`. */
    key: string;
    source: InputSource;
    /** The leaf type, after descending through any `collection` wrappers. */
    type: string;
    /** Collection nesting: 0 = the value itself, 1 = inside one collection. */
    depth: number;
    /** For `unsupported`, the i18n key naming why (namespace `empaia-workbench`). */
    reasonKey?: string;
    /** Interpolation for `reasonKey`. */
    reasonArgs?: Record<string, string>;
}

/** Annotation types the wire models but the drawing tool cannot author as a ROI. */
const UNDRAWABLE_ANNOTATIONS = new Set(["point", "line", "arrow"]);

/** Every io key any OTHER mode of this app declares as an output. */
function keysProducedElsewhere(ead: EadDocument, mode: EadMode): Set<string> {
    const produced = new Set<string>();
    for (const other of getModes(ead)) {
        if (other === mode) continue;
        for (const key of getOutputs(ead, other)) produced.add(key);
    }
    return produced;
}

/** Every input `mode` declares, described. Order follows the EAD. */
export function resolveModeInputs(ead: EadDocument | undefined, mode: EadMode): ModeInput[] {
    if (!ead) return [];
    const io = ead.io;
    if (!io || typeof io !== "object") return [];
    const produced = keysProducedElsewhere(ead, mode);

    const out: ModeInput[] = [];
    for (const key of getInputs(ead, mode)) {
        const leaf = leafTypeOf((io as any)[key]);
        if (!leaf) {
            out.push({
                key, source: "unsupported", type: "", depth: 0,
                reasonKey: "ead.blocked.unreadableInput", reasonArgs: { key },
            });
            continue;
        }
        out.push({ key, ...classify(key, leaf, produced) });
    }
    return out;
}

function classify(
    key: string,
    leaf: { type: string; depth: number },
    produced: Set<string>,
): Omit<ModeInput, "key"> {
    const { type, depth } = leaf;
    const base = { type, depth };

    // Provenance beats shape. TA12's `my_cells` is a `collection<polygon>` — the
    // shape of something the user could draw — but the app declares it as an
    // output of its preprocessing mode, so it is a *result being consumed*, not a
    // region to ask for. Classifying by shape first is how a postprocessing run
    // would have demanded the pathologist hand-draw the cells preprocessing had
    // already found.
    if (produced.has(key)) return { ...base, source: "from-job" };

    if (type === "wsi") {
        // A slide collection is a multi-slide job: a different shape of run
        // entirely, not a deeper version of this one.
        return depth === 0
            ? { ...base, source: "wsi" }
            : { ...base, source: "unsupported", reasonKey: "ead.blocked.wsiCollection" };
    }

    if ((EAD_ANNOTATION_TYPES as readonly string[]).includes(type)) {
        if (depth === 0) return { ...base, source: "roi" };
        if (depth === 1) return { ...base, source: "roi-collection" };
        return { ...base, source: "unsupported", reasonKey: "ead.blocked.nestedRoiCollection" };
    }

    if (UNDRAWABLE_ANNOTATIONS.has(type)) {
        return { ...base, source: "unsupported", reasonKey: "ead.blocked.roiShape", reasonArgs: { type } };
    }

    // Everything else — primitives, classes, pixel maps, FHIR documents. Nothing
    // the user can author, and no other mode produces it (that was checked
    // first), so nothing here can fill it.
    return {
        ...base, source: "unsupported",
        reasonKey: "ead.blocked.inputType", reasonArgs: { type, key },
    };
}

// ── derived questions ───────────────────────────────────────────────────────

/** The slide input key, only when it really is one slide. */
export function wsiInputKey(ead: EadDocument | undefined, mode: EadMode): string | undefined {
    return resolveModeInputs(ead, mode).find(i => i.source === "wsi")?.key;
}

/** ROI inputs, single and collection alike, in declaration order. */
export function roiInputs(ead: EadDocument | undefined, mode: EadMode): ModeInput[] {
    return resolveModeInputs(ead, mode)
        .filter(i => i.source === "roi" || i.source === "roi-collection");
}

/**
 * `"single"` = one region per job, `"multiple"` = regions go into a collection.
 *
 * Read off the input model so a collection the app *produces* and consumes
 * (postprocessing) never makes the UI ask the user to draw a batch.
 */
export function roiMode(ead: EadDocument | undefined, mode: EadMode): "single" | "multiple" {
    const rois = roiInputs(ead, mode);
    if (!rois.length) return "single";
    return rois.every(input => input.source === "roi-collection") ? "multiple" : "single";
}

/** Inputs that must be filled from another job's outputs. */
export function fromJobInputs(ead: EadDocument | undefined, mode: EadMode): ModeInput[] {
    return resolveModeInputs(ead, mode).filter(i => i.source === "from-job");
}

/**
 * Every region shape the user could be asked to draw, across all modes.
 *
 * The fallback the ROI preset uses when the *current* mode declares none — a
 * preprocessing mode has no regions of its own, but the preset still has to
 * carry some factory. Derived from the input model, so a collection the app
 * produces for itself is not mistaken for one the user must fill.
 */
export function allRoiTypes(ead: EadDocument | undefined): EadAnnotationType[] {
    if (!ead) return [];
    const seen = new Set<EadAnnotationType>();
    for (const mode of orderedModes(ead)) {
        for (const input of roiInputs(ead, mode)) seen.add(input.type as EadAnnotationType);
    }
    return [...seen];
}

/**
 * Every reason this viewer cannot START a job in `mode`, as i18n keys with their
 * interpolation. Empty means runnable.
 *
 * This is the single source of the answer. The panel banner and the refusal at
 * the run button both read it, so they cannot disagree — the previous split (an
 * advisory banner from `checkCompatibility`, and run paths that consulted
 * nothing) let a UI say "this app is not supported here" and then start the job
 * anyway.
 */
export function modeBlockers(
    ead: EadDocument | undefined, mode: EadMode,
): Array<{ key: string; args?: Record<string, string> }> {
    if (!ead) return [{ key: "ead.blocked.noApp" }];
    const blockers: Array<{ key: string; args?: Record<string, string> }> = [];
    const seen = new Set<string>();
    const add = (key: string, args?: Record<string, string>) => {
        // One sentence per reason: three nested collections are one problem.
        const id = key + JSON.stringify(args ?? {});
        if (seen.has(id)) return;
        seen.add(id);
        blockers.push({ key, args });
    };

    // Preprocessing runs are scheduled by the platform when the examination
    // opens — there is no "start" for the user to press. Saying so is not the
    // same as saying the app is unsupported, and TA13/TA14 are exactly that case.
    if (mode === "preprocessing") add("ead.blocked.platformRun");

    // `containerized: false` means the app computes this step inside its own UI
    // and posts the result back. This module writes no primitives, collections
    // or pixel maps, by design.
    if (mode === "postprocessing" && !isContainerized(ead, mode)) {
        add("ead.blocked.nonContainerized");
    }

    const inputs = resolveModeInputs(ead, mode);
    for (const input of inputs) {
        if (input.source === "unsupported" && input.reasonKey) add(input.reasonKey, input.reasonArgs);
    }

    // Only when the app names no slide at all. A rejected slide *collection* has
    // already said what is wrong; adding "declares no slide input" on top of it
    // describes our own refusal back to the user.
    if (!inputs.some(i => i.type === "wsi")) add("ead.blocked.noWsi");

    const rois = inputs.filter(i => i.source === "roi" || i.source === "roi-collection");
    if (rois.some(i => i.source === "roi") && rois.some(i => i.source === "roi-collection")) {
        add("ead.blocked.singleAndMulti");
    }
    const atDepth = (depth: number) => rois.filter(i => i.depth === depth).map(i => i.type);
    for (const depth of [0, 1]) {
        const types = atDepth(depth);
        if (new Set(types).size !== types.length) add("ead.blocked.sameInputTypes");
    }

    return blockers;
}

/**
 * Modes this viewer can start a job in, in the order to offer them.
 *
 * `standalone` first because it is the one that needs nothing but a slide and a
 * region; `postprocessing` next because it needs a preprocessing result to exist
 * first. Reading the EAD's own key order instead — which is what the boot used to
 * do — meant the session opened in whichever mode the vendor happened to write
 * first in their JSON.
 */
export const MODE_PREFERENCE: EadMode[] = ["standalone", "postprocessing", "preprocessing"];

export function orderedModes(ead: EadDocument | undefined): EadMode[] {
    if (!ead) return [];
    const declared = new Set(getModes(ead));
    return MODE_PREFERENCE.filter(mode => declared.has(mode));
}
