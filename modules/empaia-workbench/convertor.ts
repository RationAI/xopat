/// <reference path="../../src/types/globals.d.ts" />

/**
 * xOpat annotations ⇄ EMPAIA Workbench annotations.
 *
 * Two consumers, one mapping:
 *   - `nativeToEmpaia` / `empaiaToNative` are pure functions used by the IO sink
 *     for per-annotation CRUD (the sink receives the module's *native* snapshot,
 *     never a live fabric object — see `modules/annotations/annotations.js`
 *     `defineResource({ serialize })`);
 *   - the registered `"empaia"` convertor wraps them for whole-canvas
 *     bundle export/import and for file save/load through the usual UI.
 *
 * Coordinates need no transform: EMPAIA annotation coordinates are level-0
 * image pixels (`libs/empaia-api-lib/.../point-annotation.ts` — "must be >= 0"),
 * which is exactly xOpat's fabric image coordinate space.
 *
 * Type mapping (the EMPAIA side is the fixed vocabulary):
 *
 * | xOpat factory | EMPAIA type | geometry |
 * |---------------|-------------|----------|
 * | `rect`        | `rectangle` | `upper_left`, `width`, `height` |
 * | `polygon`     | `polygon`   | `coordinates: [[x,y], …]` |
 * | `ellipse`     | `circle`    | `center`, `radius` |
 * | `point`       | `point`     | `coordinates: [x,y]` |
 * | `line`        | `line`      | `coordinates: [[x1,y1],[x2,y2]]` |
 * | `polyline`    | `line`      | `coordinates: [[x,y], …]` |
 * | `arrow`       | `arrow`     | `head`, `tail` |
 *
 * Two deliberate lossy edges, both surfaced through `lossy` / `lossyReason`:
 *   - an ellipse with `rx !== ry` has no EMPAIA representation and is exported
 *     as a circle of the mean radius;
 *   - an EMPAIA `arrow` is imported as an xOpat `line` (rebuilding xOpat's
 *     arrow — a fabric Group of shaft + head — from outside the factory would
 *     couple us to its internals). The original type is remembered on
 *     `empaiaType`, so a re-export is still an `arrow`.
 */

import { isJobCreated } from "./types";
import type { EmpaiaAnnotation, EmpaiaAnnotationType, EmpaiaClass } from "./types";

/** Context the mapping needs but cannot discover on its own. */
export interface AnnotationMappingContext {
    /** EMPAIA slide id → `reference_id`. */
    slideId: string;
    /** Scope id → `creator_id` for anything this UI writes. */
    scopeId: string;
    /** nm/px at level 0 — the fallback for `npp_created`. */
    defaultNpp: number;
    /** preset id → EMPAIA class value. Undefined ⇒ the annotation carries no class. */
    /**
     * Preset id that marks a region of interest. An annotation drawn with it must
     * be posted with `is_roi=true` — that flag is what makes it usable as a job
     * input, and it makes the service attach the global ROI class itself.
     */
    roiPresetId?: string;
    classValueForPreset?: (presetId: unknown) => string | undefined;
    /** EMPAIA class value → xOpat preset id, creating one if needed. */
    presetForClassValue?: (classValue: string | undefined) => string | number | undefined;
    /** Optional offset applied to every coordinate (BioFormats/OpenSlide crops). */
    coordinateOffset?: { x: number; y: number };
    /**
     * Is this id one of the examination's analyses?
     *
     * The primary attribution route: for a job's output `creator_id` IS the
     * producing job's id, so a `creator_id` the module recognises as a job is
     * proof of authorship that does not depend on `creator_type` — whose wire
     * casing has silently broken attribution before. An input ROI's
     * `creator_id` is the scope id, so it can never match.
     */
    isJobId?: (id: string) => boolean;
}

const SUPPORTED_EMPAIA_TYPES = new Set<EmpaiaAnnotationType>([
    "point", "line", "arrow", "circle", "rectangle", "polygon",
]);

/**
 * Sidecar entry emitted alongside each exported annotation. Lets a consumer
 * (the IO sink) correlate a wire item with the local annotation it came from
 * and skip the ones already stored server-side.
 */
export interface AnnotationLink {
    /** The annotations module's canvas-stable id (`incrementId`). */
    incrementId?: string;
    /** Server id, present once the annotation has been persisted. */
    empaiaId?: string;
    /** Class value the annotation's preset maps to, if any. */
    classValue?: string;
}

/**
 * Properties the annotations module must keep in its export whitelist for us.
 *
 * `empaiaCreatorType` matters as much as the geometry: it is how the UI knows an
 * annotation was produced by a job and therefore cannot be deleted or edited by
 * this scope (the backend answers 412). Left out of the whitelist, it is set at
 * import and then dropped by the first `serializeAnnotation` round trip, and the
 * UI silently offers actions that cannot succeed.
 */
export const REQUIRED_EXPORT_PROPS = [
    "empaiaId", "empaiaClass", "empaiaType", "empaiaCreatorType", "nppCreated", "nppViewing",
    // Which analysis produced it. The panel shows one analysis at a time, and
    // without this every job's output is an indistinguishable pile on the slide.
    "empaiaJobId",
];

// ── native (xOpat) → EMPAIA ─────────────────────────────────────────────────

/**
 * Convert one native annotation snapshot into an EMPAIA POST body.
 * Returns undefined for shapes EMPAIA cannot represent (text, angle, group,
 * multipolygon) — callers skip those rather than failing the whole batch.
 */
export function nativeToEmpaia(
    native: Record<string, any>,
    ctx: AnnotationMappingContext
): Partial<EmpaiaAnnotation> | undefined {
    if (!native || typeof native !== "object") return undefined;

    const dx = ctx.coordinateOffset?.x ?? 0;
    const dy = ctx.coordinateOffset?.y ?? 0;
    const pt = (x: number, y: number): number[] => [round(x + dx), round(y + dy)];

    const base = {
        name: typeof native.name === "string" && native.name ? native.name : defaultName(native),
        // The API rejects an empty string; send undefined instead
        // (annotation-conversion.service.ts does the same).
        description: typeof native.description === "string" && native.description.length > 0
            ? native.description : undefined,
        creator_id: ctx.scopeId,
        creator_type: "scope" as const,
        reference_id: ctx.slideId,
        reference_type: "wsi" as const,
        npp_created: Number.isFinite(native.nppCreated) && native.nppCreated > 0
            ? Number(native.nppCreated) : ctx.defaultNpp,
        ...(Array.isArray(native.nppViewing) ? { npp_viewing: native.nppViewing } : {}),
    };

    const factoryID = String(native.factoryID ?? native.type ?? "");

    switch (factoryID) {
        case "rect": {
            const left = num(native.left), top = num(native.top);
            const width = num(native.width) * (num(native.scaleX, 1) || 1);
            const height = num(native.height) * (num(native.scaleY, 1) || 1);
            if (!(width > 0) || !(height > 0)) return undefined;
            return { ...base, type: "rectangle", upper_left: pt(left, top), width: round(width), height: round(height) };
        }
        case "ellipse": {
            const rx = num(native.rx) * (num(native.scaleX, 1) || 1);
            const ry = num(native.ry) * (num(native.scaleY, 1) || 1);
            if (!(rx > 0) || !(ry > 0)) return undefined;
            // `left`/`top` are the bounding box corner (fabric origin left/top),
            // so the centre sits one radius in on each axis.
            const center = pt(num(native.left) + rx, num(native.top) + ry);
            return { ...base, type: "circle", center, radius: round((rx + ry) / 2) };
        }
        case "point": {
            return { ...base, type: "point", coordinates: pt(num(native.left), num(native.top)) };
        }
        case "polygon":
        case "polyline": {
            const points = pointsOf(native);
            if (points.length < 2) return undefined;
            const coordinates = points.map(p => pt(p.x, p.y));
            // A polyline is an open path — EMPAIA calls that a `line`.
            return { ...base, type: factoryID === "polygon" ? "polygon" : "line", coordinates };
        }
        case "line": {
            const coordinates = [pt(num(native.x1), num(native.y1)), pt(num(native.x2), num(native.y2))];
            // An imported EMPAIA arrow round-trips back to `arrow` (see file docs).
            if (native.empaiaType === "arrow") {
                return { ...base, type: "arrow", head: coordinates[0], tail: coordinates[1] };
            }
            return { ...base, type: "line", coordinates };
        }
        case "arrow": {
            const shaft = arrowShaft(native);
            if (!shaft) return undefined;
            return { ...base, type: "arrow", head: pt(shaft.x1, shaft.y1), tail: pt(shaft.x2, shaft.y2) };
        }
        default:
            return undefined;
    }
}

/** The class record that pairs with an exported annotation, if the preset maps to one. */
export function nativeToEmpaiaClass(
    native: Record<string, any>,
    annotationId: string,
    ctx: AnnotationMappingContext
): Partial<EmpaiaClass> | undefined {
    const value = ctx.classValueForPreset?.(native?.presetID);
    if (!value) return undefined;
    return {
        type: "class",
        value,
        creator_id: ctx.scopeId,
        creator_type: "scope",
        reference_id: annotationId,
        reference_type: "annotation",
    };
}

/** True when this shape has an EMPAIA representation at all. */
export function isExportable(native: Record<string, any>): boolean {
    const id = String(native?.factoryID ?? native?.type ?? "");
    return ["rect", "ellipse", "point", "polygon", "polyline", "line", "arrow"].includes(id);
}

/** Ellipses that will be circularized by export — used for the lossy warning. */
export function findNonCircularEllipses(natives: Record<string, any>[]): Record<string, any>[] {
    return (natives || []).filter(o => {
        if (String(o?.factoryID) !== "ellipse") return false;
        const rx = num(o.rx) * (num(o.scaleX, 1) || 1);
        const ry = num(o.ry) * (num(o.scaleY, 1) || 1);
        return rx > 0 && ry > 0 && Math.abs(rx - ry) > Math.max(rx, ry) * 0.01;
    });
}

// ── EMPAIA → native (xOpat) ─────────────────────────────────────────────────

/**
 * Convert one EMPAIA annotation into a native xOpat annotation object.
 *
 * Treats the payload as adversarial (AGENTS.md §7): the discriminator must be
 * a known type, every coordinate must be a finite non-negative number, and
 * arrays must have the arity the type requires. Anything else returns
 * undefined and is skipped by the caller.
 */
export function empaiaToNative(
    annotation: any,
    ctx: AnnotationMappingContext
): Record<string, any> | undefined {
    if (!annotation || typeof annotation !== "object") return undefined;
    const type = annotation.type as EmpaiaAnnotationType;
    if (!SUPPORTED_EMPAIA_TYPES.has(type)) return undefined;

    const dx = ctx.coordinateOffset?.x ?? 0;
    const dy = ctx.coordinateOffset?.y ?? 0;
    const x = (v: number) => v - dx;
    const y = (v: number) => v - dy;

    const classValue = firstClassValue(annotation);
    const presetID = ctx.presetForClassValue?.(classValue);

    // Two independent routes to "an analysis made this", because either one
    // alone has failed in the field: the wire's `creator_type` casing is not
    // the schema's, and a deployment may answer a query before the module has
    // polled the job list.
    const creatorId = typeof annotation.creator_id === "string" ? annotation.creator_id : "";
    const byJob = !!creatorId && ctx.isJobId?.(creatorId) === true;
    const jobCreated = byJob || isJobCreated(annotation);

    const common: Record<string, any> = {
        ...(presetID !== undefined ? { presetID } : {}),
        ...(typeof annotation.name === "string" ? { name: annotation.name } : {}),
        ...(typeof annotation.description === "string" ? { description: annotation.description } : {}),
        ...(Number.isFinite(annotation.npp_created) ? { nppCreated: annotation.npp_created } : {}),
        ...(Array.isArray(annotation.npp_viewing) ? { nppViewing: annotation.npp_viewing } : {}),
        ...(typeof annotation.id === "string" ? { empaiaId: annotation.id } : {}),
        ...(classValue ? { empaiaClass: classValue } : {}),
        // The annotations module's own read-only flag: it refuses every mutation
        // at the IO checkpoint and renders the object locked, so this is the whole
        // enforcement. "job" means the analysis produced it — owned by the job's
        // scope, and the backend answers 412 whatever we send. (`is_locked` is a
        // separate v3 field that is effectively always null; the real lock lives in
        // a job-reference table no route exposes, which is why creator_type is the
        // one we can actually act on.)
        ...(annotation.is_locked || jobCreated ? { readOnly: true } : {}),
        ...(typeof annotation.creator_type === "string"
            ? { empaiaCreatorType: annotation.creator_type } : {}),
        // For a job's output, `creator_id` IS the producing job's id — the only
        // handle tying an annotation back to the analysis that made it, and what
        // every visibility, eviction and focus decision keys on.
        ...(jobCreated && creatorId ? { empaiaJobId: creatorId } : {}),
    };

    switch (type) {
        case "rectangle": {
            const ul = coordPair(annotation.upper_left);
            const width = positive(annotation.width);
            const height = positive(annotation.height);
            if (!ul || width === undefined || height === undefined) return undefined;
            return { ...common, factoryID: "rect", type: "rect", left: x(ul[0]), top: y(ul[1]), width, height };
        }
        case "circle": {
            const center = coordPair(annotation.center);
            const radius = positive(annotation.radius);
            if (!center || radius === undefined) return undefined;
            // Back to the bounding-box corner fabric expects.
            return {
                ...common, factoryID: "ellipse", type: "ellipse",
                left: x(center[0]) - radius, top: y(center[1]) - radius,
                rx: radius, ry: radius, angle: 0,
            };
        }
        case "point": {
            const c = coordPair(annotation.coordinates);
            if (!c) return undefined;
            return { ...common, factoryID: "point", type: "ellipse", left: x(c[0]), top: y(c[1]) };
        }
        case "polygon": {
            const ring = coordList(annotation.coordinates, 3);
            if (!ring) return undefined;
            return {
                ...common, factoryID: "polygon", type: "polygon",
                points: ring.map(([px, py]) => ({ x: x(px), y: y(py) })),
            };
        }
        case "line": {
            const path = coordList(annotation.coordinates, 2);
            if (!path) return undefined;
            if (path.length === 2) {
                return {
                    ...common, factoryID: "line", type: "line",
                    x1: x(path[0][0]), y1: y(path[0][1]), x2: x(path[1][0]), y2: y(path[1][1]),
                };
            }
            return {
                ...common, factoryID: "polyline", type: "polyline",
                points: path.map(([px, py]) => ({ x: x(px), y: y(py) })),
            };
        }
        case "arrow": {
            const head = coordPair(annotation.head);
            const tail = coordPair(annotation.tail);
            if (!head || !tail) return undefined;
            // Rendered as a plain line; `empaiaType` keeps the export faithful.
            return {
                ...common, factoryID: "line", type: "line", empaiaType: "arrow",
                x1: x(head[0]), y1: y(head[1]), x2: x(tail[0]), y2: y(tail[1]),
            };
        }
        default:
            return undefined;
    }
}

/** The class value carried inline by a `with_classes` query, if any. */
export function firstClassValue(annotation: any): string | undefined {
    const classes = annotation?.classes;
    if (!Array.isArray(classes)) return undefined;
    for (const c of classes) {
        if (c && typeof c.value === "string" && c.value) return c.value;
    }
    return undefined;
}

// ── the registered convertor ────────────────────────────────────────────────

let _contextProvider: (() => AnnotationMappingContext | undefined) | undefined;

/**
 * The convertor is instantiated by the annotations module, which knows nothing
 * about EMPAIA — so the mapping context is supplied out of band by this module
 * once the workbench session resolves.
 */
export function setAnnotationMappingContextProvider(provider: () => AnnotationMappingContext | undefined): void {
    _contextProvider = provider;
}

export function currentMappingContext(): AnnotationMappingContext | undefined {
    return _contextProvider?.();
}

export const EMPAIA_CONVERTOR_FORMAT = "empaia";

/** Registers `OSDAnnotations.Convertor` format `"empaia"`. Idempotent. */
export function registerEmpaiaConvertor(): void {
    const OSDAnnotations: any = (window as any).OSDAnnotations;
    if (!OSDAnnotations?.Convertor?.register) {
        console.warn("[empaia-workbench] OSDAnnotations.Convertor unavailable — annotation format not registered.");
        return;
    }
    if (OSDAnnotations.Convertor.CONVERTERS?.[EMPAIA_CONVERTOR_FORMAT]) return;

    OSDAnnotations.Convertor.register(EMPAIA_CONVERTOR_FORMAT, class extends OSDAnnotations.Convertor.IConvertor {
        static title = "EMPAIA Annotations";
        static description = "Annotations in the EMPAIA Workbench Service v3 data model.";
        static getSuffix() { return ".empaia.json"; }

        // Presets have no EMPAIA counterpart of their own: an annotation's
        // class IS its preset, carried per annotation as a `Class` record.
        static exportsPresets = false;
        static exportsObjects = true;
        // MUST stay true. With `false`, `FabricWrapper.toObject` runs its
        // output through `trimExportJSON`, which reduces every object to its
        // factory's `necessaryProperties` and passes no extra keeps — so
        // `empaiaId` (the server link) and `nppCreated` would be dropped and
        // every export would look like a set of brand-new annotations.
        static includeAllAnnotationProps = true;

        static lossy = true;
        static lossyReason =
            "EMPAIA has no ellipse (non-circular ellipses export as a circle of the mean radius), " +
            "no text/angle/multipolygon annotations (skipped), and its arrows re-import as plain lines.";

        async encodePartial(annotationsGetter: () => any[]) {
            const ctx = currentMappingContext();
            if (!ctx) throw new Error("EMPAIA workbench session is not ready — cannot export annotations.");

            // Ask for the linkage properties explicitly as well: they are not
            // part of any factory's geometry whitelist, and the module-level
            // `forceExportsProp` registration is a separate mechanism.
            const natives = annotationsGetter(...REQUIRED_EXPORT_PROPS) || [];
            const items: Array<Partial<EmpaiaAnnotation>> = [];
            // Sidecar, parallel to `items`: which local annotation produced each
            // entry and whether it is already on the server. The bundle sink
            // needs it to upload only what is new instead of re-posting the whole
            // set (which would mint fresh ids and orphan job-linked ROIs). It is
            // not part of the EMPAIA model — `decode` ignores it.
            const links: AnnotationLink[] = [];
            const skipped: string[] = [];

            for (const native of natives) {
                const mapped = nativeToEmpaia(native, ctx);
                if (!mapped) {
                    if (native?.factoryID) skipped.push(String(native.factoryID));
                    continue;
                }
                items.push(mapped);
                links.push({
                    incrementId: native?.incrementId !== undefined ? String(native.incrementId) : undefined,
                    empaiaId: typeof native?.empaiaId === "string" ? native.empaiaId : undefined,
                    classValue: ctx.classValueForPreset?.(native?.presetID),
                });
            }
            if (skipped.length) {
                console.warn(`[empaia-workbench] ${skipped.length} annotation(s) have no EMPAIA representation ` +
                    `and were skipped: ${[...new Set(skipped)].join(", ")}`);
            }
            return { objects: items, presets: undefined, links };
        }

        static encodeFinalize(output: { objects?: any[]; links?: AnnotationLink[] }) {
            return JSON.stringify({ items: output?.objects ?? [], links: output?.links ?? [] });
        }

        async decode(data: any) {
            const ctx = currentMappingContext();
            if (!ctx) throw new Error("EMPAIA workbench session is not ready — cannot import annotations.");

            let parsed: any = data;
            if (typeof parsed === "string") {
                try { parsed = JSON.parse(parsed); }
                catch { throw new Error("EMPAIA annotation payload is not valid JSON."); }
            }
            const items = Array.isArray(parsed) ? parsed
                : (Array.isArray(parsed?.items) ? parsed.items : []);

            const objects: Record<string, any>[] = [];
            for (const item of items) {
                const native = empaiaToNative(item, ctx);
                if (native) objects.push(native);
            }
            return { objects, presets: [] };
        }
    });
}

// ── helpers ─────────────────────────────────────────────────────────────────

function num(v: unknown, fallback = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function round(v: number): number {
    // EMPAIA stores integers for pixel coordinates; sub-pixel precision would
    // be rejected by some validators and means nothing at level 0 anyway.
    return Math.round(v);
}

function positive(v: unknown): number | undefined {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A `[x, y]` pair of finite, non-negative numbers, or undefined. */
function coordPair(v: unknown): [number, number] | undefined {
    if (!Array.isArray(v) || v.length < 2) return undefined;
    const x = Number(v[0]), y = Number(v[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return undefined;
    return [x, y];
}

/** A list of at least `minPoints` valid pairs, or undefined. */
function coordList(v: unknown, minPoints: number): Array<[number, number]> | undefined {
    if (!Array.isArray(v) || v.length < minPoints) return undefined;
    const out: Array<[number, number]> = [];
    for (const entry of v) {
        const pair = coordPair(entry);
        if (!pair) return undefined;
        out.push(pair);
    }
    return out.length >= minPoints ? out : undefined;
}

/** Absolute vertex list of a fabric polygon/polyline snapshot. */
function pointsOf(native: Record<string, any>): Array<{ x: number; y: number }> {
    const points = native?.points;
    if (!Array.isArray(points)) return [];
    return points
        .filter(p => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
        .map(p => ({ x: Number(p.x), y: Number(p.y) }));
}

/**
 * Absolute shaft endpoints of an xOpat arrow. The arrow is a fabric Group whose
 * first child is the shaft line carrying ABSOLUTE `x1..y2` (documented in the
 * arrow factory's `configure`), so no group-frame arithmetic is needed.
 */
function arrowShaft(native: Record<string, any>): { x1: number; y1: number; x2: number; y2: number } | undefined {
    const children = Array.isArray(native?.objects) ? native.objects : undefined;
    const line = children?.find((c: any) => c && c.type === "line") ?? children?.[0];
    if (!line) return undefined;
    const x1 = Number(line.x1), y1 = Number(line.y1), x2 = Number(line.x2), y2 = Number(line.y2);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return undefined;
    return { x1, y1, x2, y2 };
}

function defaultName(native: Record<string, any>): string {
    const id = native?.incrementId ?? native?.id;
    return id !== undefined ? `xopat-${id}` : "xopat-annotation";
}
