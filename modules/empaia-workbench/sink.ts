/// <reference path="../../src/types/globals.d.ts" />

/**
 * IO-pipeline sinks backed by the EMPAIA Workbench Service.
 *
 * Two sinks, because they are two genuinely different destinations and a sink
 * must mean exactly one thing (src/IO_PIPELINE.md, "Round-trip contract"):
 *
 *  - **`empaia-annotations`** (`crud` + `bundle`) — the real annotation API.
 *    Owner-scoped to the `annotations` module. Per-annotation CRUD maps through
 *    `convertor.ts`; the bundle direction is an *upload-what-is-missing* pass
 *    (never a wipe-and-repost, which would mint new ids and orphan the ROIs an
 *    already-running job points at) plus a full read for hydration.
 *
 *  - **`empaia-app-storage`** (`bundle`) — the generic `app-ui-storage`
 *    key/value slot, for any other owner that wants its state to follow the
 *    examination. `scope` storage is shared by everyone in the examination;
 *    `user` storage is private to the current user.
 *
 * Neither sink interprets a payload it did not produce: `empaia-app-storage`
 * stores the owner's bytes verbatim and hands them back unchanged.
 *
 * Both are inert until an admin binds them in `ENV.client.io.bindings`.
 */

import {
    empaiaToNative, nativeToEmpaia, nativeToEmpaiaClass,
    type AnnotationLink, type AnnotationMappingContext,
} from "./convertor";
import { asRemoteRefusal, describeRemoteError, RemoteRefusal } from "./errors";
import { isJobCreated } from "./types";
import type { EmpaiaAnnotation, EmpaiaClass } from "./types";
import type { Wbs3Client } from "./wbs3-client";

export const ANNOTATIONS_SINK_ID = "empaia-annotations";
export const APP_STORAGE_SINK_ID = "empaia-app-storage";

/** The annotations module's own id — the only owner the CRUD sink serves. */
const ANNOTATIONS_OWNER_ID = "annotations";

export interface EmpaiaSinkDeps {
    /** Undefined until the workbench session resolves; every call degrades closed. */
    getClient(): Wbs3Client | undefined;
    getMappingContext(): AnnotationMappingContext | undefined;
    /**
     * Mapping context for the slide THIS dispatch is about.
     *
     * Bundle traffic is keyed by `(viewerId, backgroundId)`, so answering from the
     * active slide is wrong the moment a second viewport exists — it is why this
     * sink used to decline `bundle-import` and the module carried its own private
     * hydration path instead.
     */
    getMappingContextFor(ctx: unknown): AnnotationMappingContext | undefined;
    /**
     * Called after an annotation is stored, so the module can stamp the server
     * id onto the live object (and remember the link for later delete/update).
     * `renameFrom` moves an existing link when an update changed the local id.
     */
    linkAnnotation(localId: string | undefined, empaiaId: string | undefined, renameFrom?: string): void;
    /** Local id → server id, for update/delete. */
    resolveEmpaiaId(localId: string): string | undefined;
    /** Which `app-ui-storage` bucket generic bundles land in. */
    storageKind(): "scope" | "user";
    /**
     * The backend refused this record for good (423 locked by a job, 412 owned
     * by another scope).
     *
     * Reported so the module can record the fact and render the annotation
     * read-only: the next attempt is then refused locally, with a sentence that
     * names the analysis, instead of making the same round trip to be told no.
     */
    noteLocked?(empaiaId: string, detail?: string): void;
}

type IOResultLike = { ok: true; payload?: unknown } | {
    ok: false; refused: true; reason: string; userMessage?: string; code?: string;
};

function refuse(reason: string, code: string, userMessage?: string): IOResultLike {
    return { ok: false, refused: true, reason, code, userMessage };
}

/**
 * The owner's own id for this item.
 *
 * `ctx.meta.localId` is the pipeline's answer to "which of my objects is this?"
 * and is the ONLY one available on `create`, where `ctx.itemId` is absent by
 * design (the id is the destination's to assign). Falling back to `ctx.itemId`
 * keeps update/delete working against a pipeline that predates the field.
 */
function localIdOf(ctx: any): string | undefined {
    const id = ctx?.meta?.localId ?? ctx?.itemId;
    return id !== undefined && id !== null ? String(id) : undefined;
}

/**
 * The server record this dispatch is about.
 *
 * Read from `ctx.meta` FIRST, because the per-session map cannot be trusted to
 * hold the answer and the canvas cannot be consulted at all:
 *
 *  - the map (`resolveEmpaiaId`) is keyed by `incrementId`, a counter re-minted
 *    on every load, and is only written for annotations *this session* wrote —
 *    so it is empty for everything restored on a reload;
 *  - its "repair from the canvas" fallback is structurally unable to help here.
 *    The pipeline runs the caller's `apply()` synchronously (detaching the
 *    object, and dropping it from the canvas index) and dispatches to us a
 *    microtask later. By the time we are asked about a deleted or replaced
 *    annotation, it is already gone from the canvas.
 *
 * `ctx.meta.object` / `ctx.meta.previous` is the object as it was *before* that
 * commit — every delete/update site in the annotations module passes one — and
 * `empaiaId` is a registered persisted property, so it is right there on it.
 *
 * `previous` wins: an update is a replace, and the record to retire is the OLD
 * one. Falling through to the map keeps the freshly-drawn case working when a
 * caller passes no object.
 */
function serverIdOf(ctx: any, deps: EmpaiaSinkDeps): string | undefined {
    const carried = ctx?.meta?.previous?.empaiaId ?? ctx?.meta?.object?.empaiaId;
    if (typeof carried === "string" && carried) return carried;
    const localId = localIdOf(ctx);
    return localId ? deps.resolveEmpaiaId(localId) : undefined;
}

// ── annotations sink ────────────────────────────────────────────────────────

export function makeAnnotationsSink(deps: EmpaiaSinkDeps): any {
    /** Common preflight: session ready and this really is our owner's traffic. */
    const ready = (dispatchCtx?: unknown): { client: Wbs3Client; ctx: AnnotationMappingContext } | IOResultLike => {
        const client = deps.getClient();
        const ctx = deps.getMappingContextFor(dispatchCtx);
        if (!client || !ctx) {
            return refuse(
                "EMPAIA workbench session is not ready",
                "W_EMPAIA_NO_SESSION",
                $.t("io.notReady", { ns: "empaia-workbench" })
            );
        }
        return { client, ctx };
    };

    /** ROIs must be posted with `is_roi=true` — see `postAnnotations`. */
    const isRoi = (item: any, mapping: AnnotationMappingContext): boolean =>
        !!mapping.roiPresetId && String(item?.presetID ?? "") === mapping.roiPresetId;

    /**
     * ROI-ness of the record an *update* is about to post.
     *
     * A partial patch need not carry `presetID` — a geometry edit does not — so
     * fall back to the object the dispatch was about. Reading only the patch is
     * how editing a region of interest silently re-posted it as an ordinary
     * annotation and quietly disqualified it as a job input.
     */
    const isRoiForUpdate = (patch: any, ctx: any, mapping: AnnotationMappingContext): boolean => {
        const presetID = patch && "presetID" in patch ? patch.presetID : ctx?.meta?.object?.presetID;
        return !!mapping.roiPresetId && String(presetID ?? "") === mapping.roiPresetId;
    };

    /**
     * Retire the server record and post `mapped` in its place.
     *
     * The workbench has no annotation update route, so anything that changes a
     * stored annotation is a delete + re-post. Factored out because a preset
     * change that flips ROI-ness needs exactly this path too: `is_roi` is a
     * POST-time flag, not a patchable field.
     */
    const repost = async (
        client: Wbs3Client,
        mapping: AnnotationMappingContext,
        options: { localId: string | undefined; existing: string | undefined; mapped: any; classSource: any; asRoi: boolean },
    ): Promise<IOResultLike> => {
        const { localId, existing, mapped, classSource, asRoi } = options;
        try {
            if (existing) await client.deleteAnnotation(existing);
            const [created] = await client.postAnnotations([mapped], { isRoi: asRoi });
            const empaiaId = typeof created?.id === "string" ? created.id : undefined;
            // The dispatch is keyed by the object being replaced, but the one
            // left on the canvas is the replacement. `annotation-persisted`
            // moves the link to its id; here we only retire the old entry.
            deps.linkAnnotation(localId, empaiaId);

            if (empaiaId) {
                const cls = nativeToEmpaiaClass(classSource, empaiaId, mapping);
                if (cls) await client.postClasses([cls]);
            }
            return { ok: true, payload: { id: empaiaId } };
        } catch (e: any) {
            // An update is a delete + re-post, so it hits the same lock as a
            // delete — and the same refusal is worth remembering.
            const refusal = asRemoteRefusal(e);
            if (refusal.permanent && existing) deps.noteLocked?.(existing, refusal.detail);
            return refuse(
                `EMPAIA annotation update failed: ${e?.message ?? e}`,
                refusal.permanent ? "W_EMPAIA_PERMANENT" : "W_EMPAIA_UPDATE_FAILED",
                describeRemoteError(e, $.t("io.updateFailed", { ns: "empaia-workbench" })),
            );
        }
    };

    return {
        id: ANNOTATIONS_SINK_ID,
        label: "EMPAIA Annotations",
        // Declarative form, so a misrouted binding is reported once at boot
        // (`io:invalid-binding`) instead of failing on the first user gesture.
        supports: {
            kinds: ["crud", "bundle"],
            owners: [ANNOTATIONS_OWNER_ID],
            resources: ["annotation"],
        },

        // Only genuinely runtime conditions belong here — the static routing is
        // declared above. A session that has not resolved yet says so, rather than
        // silently declining and letting the dispatch report "nothing stored".
        accepts(ctx: any): any {
            if (ctx?.ownerId !== ANNOTATIONS_OWNER_ID) return false;
            if (ctx.resourceName !== undefined && ctx.resourceName !== "annotation") return false;
            if (!deps.getClient() || !deps.getMappingContextFor(ctx)) {
                return {
                    accept: false,
                    reason: "EMPAIA workbench session is not ready",
                    userMessage: $.t("io.notReady", { ns: "empaia-workbench" }),
                };
            }
            return true;
        },

        // ── per-annotation CRUD ─────────────────────────────────────────────

        async create(ctx: any, item: any): Promise<IOResultLike> {
            const pre = ready(ctx);
            if ("ok" in pre) return pre;
            const { client, ctx: mapping } = pre;

            const mapped = nativeToEmpaia(item, mapping);
            if (!mapped) {
                // No EMPAIA counterpart for this shape. Reporting success here is
                // what made annotations "sometimes save": the pipeline recorded a
                // stored annotation, the backend never saw one, and the difference
                // only surfaced on the next reload. The module's `pre-create` guard
                // normally catches this before anything is committed; reaching here
                // means it was disabled, so say so and let the revert run.
                const type = String(item?.factoryID ?? item?.type ?? "?");
                return refuse(
                    `shape "${type}" has no EMPAIA representation`,
                    "W_EMPAIA_UNREPRESENTABLE",
                    $.t("io.unrepresentable", { ns: "empaia-workbench", type }),
                );
            }

            try {
                const [created] = await client.postAnnotations([mapped], { isRoi: isRoi(item, mapping) });
                const empaiaId = typeof created?.id === "string" ? created.id : undefined;
                deps.linkAnnotation(localIdOf(ctx), empaiaId);

                if (empaiaId) {
                    const cls = nativeToEmpaiaClass(item, empaiaId, mapping);
                    if (cls) await client.postClasses([cls]);
                }
                return { ok: true, payload: { id: empaiaId } };
            } catch (e: any) {
                return refuse(
                    `EMPAIA annotation create failed: ${e?.message ?? e}`,
                    "W_EMPAIA_CREATE_FAILED",
                    $.t("io.createFailed", { ns: "empaia-workbench" })
                );
            }
        },

        /**
         * The workbench has no annotation update endpoint, so an update is a
         * replace: delete the old record and post the new geometry. The class
         * record is recreated with it (classes reference the annotation id).
         */
        async update(ctx: any, patch: any): Promise<IOResultLike> {
            const pre = ready(ctx);
            if ("ok" in pre) return pre;
            const { client, ctx: mapping } = pre;

            const localId = localIdOf(ctx);
            const existing = serverIdOf(ctx, deps);
            const mapped = nativeToEmpaia(patch, mapping);

            if (!mapped) {
                // A preset change that flips ROI-ness is NOT a class rewrite.
                // `is_roi` is a POST-time flag — the service attaches the global
                // ROI class itself and there is no update route — so the record
                // has to be re-posted with the flag set (or cleared). Falling
                // through to the class-only path below is what made "use this
                // annotation as a region of interest" a silent no-op: the ROI
                // preset deliberately maps to no class value, so both branches
                // produced `undefined` and the sink reported `skipped: true`.
                if (existing && patch && "presetID" in patch) {
                    const wasRoi = !!mapping.roiPresetId
                        && String(ctx?.meta?.oldPresetID ?? "") === mapping.roiPresetId;
                    const nowRoi = isRoiForUpdate(patch, ctx, mapping);
                    if (wasRoi !== nowRoi) {
                        const full = nativeToEmpaia(ctx?.meta?.object, mapping);
                        if (full) {
                            return repost(client, mapping, {
                                localId, existing, mapped: full,
                                classSource: ctx?.meta?.object ?? patch,
                                asRoi: nowRoi,
                            });
                        }
                    }
                }

                // A partial patch carries no geometry, so there is nothing to
                // replace — but a preset change IS a real mutation: the annotation
                // keeps its id and only its class record is rewritten. Treating
                // that as "nothing to do" is why re-classifying an annotation never
                // reached the workbench.
                if (existing && patch && "presetID" in patch) {
                    try {
                        const cls = nativeToEmpaiaClass(patch, existing, mapping);
                        if (cls) {
                            await client.postClasses([cls]);
                            return { ok: true, payload: { id: existing } };
                        }
                    } catch (e: any) {
                        return refuse(
                            `EMPAIA class update failed: ${e?.message ?? e}`,
                            "W_EMPAIA_UPDATE_FAILED",
                            $.t("io.updateFailed", { ns: "empaia-workbench" }),
                        );
                    }
                }
                // Comments, labels and the like have no EMPAIA model at all.
                return { ok: true, payload: { skipped: true } };
            }

            return repost(client, mapping, {
                localId, existing, mapped,
                classSource: patch,
                asRoi: isRoiForUpdate(patch, ctx, mapping),
            });
        },

        async delete(ctx: any): Promise<IOResultLike> {
            const pre = ready(ctx);
            if ("ok" in pre) return pre;
            const { client } = pre;

            const localId = localIdOf(ctx);
            const empaiaId = serverIdOf(ctx, deps);
            // Never stored server-side (helper shape, or created while offline).
            if (!empaiaId) return { ok: true, payload: { skipped: true } };

            try {
                await client.deleteAnnotation(empaiaId);
                deps.linkAnnotation(localId, undefined);
                return { ok: true };
            } catch (e: any) {
                // 423 (a job holds it, and there is no unlock route) and 412
                // (another scope owns it) are final: the code says so, so the retry
                // wrapper stops and the annotation is restored instead of the user
                // watching it disappear and come back on the next reload.
                const refusal = asRemoteRefusal(e);
                const permanent = refusal.permanent;
                // Learn from the refusal instead of repeating it: a 423 says a
                // job holds this record, and that never changes.
                if (permanent) deps.noteLocked?.(empaiaId, refusal.detail);
                return refuse(
                    `EMPAIA annotation delete failed: ${e?.message ?? e}`,
                    permanent ? "W_EMPAIA_PERMANENT" : "W_EMPAIA_DELETE_FAILED",
                    describeRemoteError(e, $.t("io.deleteFailed", { ns: "empaia-workbench" })),
                );
            }
        },

        /**
         * Streamed read. `params` is domain-specific and owner-supplied; we read
         * `backgroundId`-independent filters plus an optional viewport so the
         * caller can hydrate progressively while panning.
         *
         * Yields **native** xOpat objects: the annotations resource's
         * `deserialize` is a passthrough, so whatever we yield lands on the
         * canvas as-is.
         */
        async *query(ctx: any, params: any): AsyncIterable<unknown> {
            const pre = ready(ctx);
            if ("ok" in pre) return;
            const { client, ctx: mapping } = pre;

            const signal: AbortSignal | undefined = ctx?.meta?.signal;
            const query: Record<string, unknown> = { references: [mapping.slideId] };
            if (params?.viewport) query.viewport = params.viewport;
            if (Array.isArray(params?.nppViewing)) query.npp_viewing = params.nppViewing;
            if (Array.isArray(params?.jobs)) query.jobs = params.jobs;
            if (Array.isArray(params?.creators)) query.creators = params.creators;
            if (Array.isArray(params?.types)) query.types = params.types;

            const pageSize = Number.isFinite(params?.pageSize) ? Number(params.pageSize) : 500;
            let skip = 0;

            for (;;) {
                if (signal?.aborted) return;
                let page;
                try {
                    page = await client.queryAnnotations(query as any, {
                        skip, limit: pageSize, withClasses: true, signal,
                    });
                } catch (e: any) {
                    if (signal?.aborted) return;
                    console.warn("[empaia-workbench] annotation query failed:", e?.message ?? e);
                    return;
                }

                for (const annotation of page.items) {
                    const native = empaiaToNative(annotation, mapping);
                    if (!native) continue;
                    // No linking from here: the local id is assigned when the object
                    // lands on the canvas, so a link made now would key the map by
                    // nothing. The owner indexes it after the import
                    // (`_indexHydratedAnnotations`).
                    yield native;
                }

                if (page.items.length < pageSize) return;
                skip += page.items.length;
            }
        },

        // ── bundle ──────────────────────────────────────────────────────────

        /**
         * Upload every annotation that is not on the server yet.
         *
         * Deliberately additive. A destructive sync (delete-all + repost) would
         * change the server id of every ROI, which breaks any job already
         * holding one as an input. Removals travel through `delete` above,
         * where the user's intent is unambiguous.
         */
        async writeBundle(ctx: any, payload: unknown): Promise<IOResultLike> {
            const pre = ready(ctx);
            if ("ok" in pre) return pre;
            const { client, ctx: mapping } = pre;

            let parsed: { items?: Array<Partial<EmpaiaAnnotation>>; links?: AnnotationLink[] };
            try {
                parsed = typeof payload === "string" ? JSON.parse(payload) : (payload as any);
            } catch {
                return refuse(
                    "annotation bundle is not valid JSON",
                    "W_EMPAIA_BAD_BUNDLE",
                    $.t("io.badBundle", { ns: "empaia-workbench" })
                );
            }

            const items = Array.isArray(parsed?.items) ? parsed.items : [];
            const links = Array.isArray(parsed?.links) ? parsed.links : [];
            if (!items.length) return { ok: true, payload: { created: 0 } };

            // Only the ones with no server id yet.
            const pending: Array<{ item: Partial<EmpaiaAnnotation>; link: AnnotationLink }> = [];
            items.forEach((item, i) => {
                const link = links[i] ?? {};
                const known = link.empaiaId
                    ?? (link.incrementId ? deps.resolveEmpaiaId(link.incrementId) : undefined);
                if (!known) pending.push({ item, link });
            });
            if (!pending.length) return { ok: true, payload: { created: 0 } };

            try {
                const created = await client.postAnnotations(pending.map(p => p.item));
                const classes: Array<Partial<EmpaiaClass>> = [];

                created.forEach((record, i) => {
                    const link = pending[i]?.link;
                    const empaiaId = typeof record?.id === "string" ? record.id : undefined;
                    deps.linkAnnotation(link?.incrementId, empaiaId);
                    if (empaiaId && link?.classValue) {
                        classes.push({
                            type: "class",
                            value: link.classValue,
                            creator_id: mapping.scopeId,
                            creator_type: "scope",
                            reference_id: empaiaId,
                            reference_type: "annotation",
                        });
                    }
                });

                if (classes.length) await client.postClasses(classes);
                return { ok: true, payload: { created: created.length } };
            } catch (e: any) {
                return refuse(
                    `EMPAIA annotation upload failed: ${e?.message ?? e}`,
                    "W_EMPAIA_BUNDLE_FAILED",
                    $.t("io.bundleFailed", { ns: "empaia-workbench" })
                );
            }
        },

        /**
         * Whole-slide read for hydration. Returns the payload wrapped as
         * `{ format, meta, buffer }` — the shape the annotations module already
         * unwraps to pick a convertor (see its `importBundle`), so the bytes are
         * decoded by the `empaia` convertor rather than the deployment default.
         *
         * **Job output is excluded.** Which analysis is shown on the slide is
         * decided by the panel and applied by `syncJobAnnotations`, and the job list
         * has usually not loaded when hydration runs — restoring it here would flash
         * every analysis ever run and have most of them evicted a moment later.
         * There is one owner of job-output presence and it is not the bundle.
         */
        async readBundle(ctx: any): Promise<IOResultLike> {
            const pre = ready(ctx);
            if ("ok" in pre) return pre;
            const { client, ctx: mapping } = pre;

            try {
                const all: EmpaiaAnnotation[] = [];
                const pageSize = 500;
                let skip = 0;
                for (;;) {
                    const page = await client.queryAnnotations(
                        { references: [mapping.slideId] },
                        { skip, limit: pageSize, withClasses: true }
                    );
                    all.push(...page.items);
                    if (page.items.length < pageSize) break;
                    skip += page.items.length;
                    // Defensive stop: a backend that ignores paging would loop forever.
                    if (skip > 200_000) {
                        console.warn("[empaia-workbench] annotation hydration stopped at 200k items.");
                        break;
                    }
                }
                // Same as `query`: the local ids do not exist yet. The owner links
                // them after the import lands them on the canvas.
                //
                // Analysis output is deliberately excluded: which analysis is on the
                // slide is decided by the visibility set, not by hydration. Compared
                // through `isJobCreated` — an exact `!== "job"` matched every record,
                // so hydration used to load every analysis ever run, permanently.
                const items = all.filter(a => !isJobCreated(a as any));

                return {
                    ok: true,
                    payload: {
                        format: "empaia",
                        meta: { slideId: mapping.slideId },
                        buffer: JSON.stringify({ items }),
                    },
                };
            } catch (e: any) {
                return refuse(
                    `EMPAIA annotation read failed: ${e?.message ?? e}`,
                    "W_EMPAIA_READ_FAILED",
                    $.t("io.readFailed", { ns: "empaia-workbench" })
                );
            }
        },
    };
}

// ── generic app-ui-storage sink ─────────────────────────────────────────────

/** Keys must survive a JSON object; keep them to a conservative charset. */
function storageKey(ctx: any): string {
    const raw = `${ctx?.ownerUid ?? "unknown"}::${ctx?.key ?? ""}`;
    return raw.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 200);
}

export function makeAppStorageSink(deps: EmpaiaSinkDeps): any {
    return {
        id: APP_STORAGE_SINK_ID,
        label: "EMPAIA App-UI Storage",
        supports: ["bundle"],

        // The annotations module has a real home (the sink above); everything
        // else may use this generic slot.
        accepts(ctx: any): boolean {
            return ctx?.ownerId !== ANNOTATIONS_OWNER_ID;
        },

        async writeBundle(ctx: any, payload: unknown): Promise<IOResultLike> {
            const client = deps.getClient();
            if (!client) {
                return refuse("EMPAIA workbench session is not ready", "W_EMPAIA_NO_SESSION",
                    $.t("io.notReady", { ns: "empaia-workbench" }));
            }
            const kind = deps.storageKind();
            const key = storageKey(ctx);

            try {
                // The endpoint replaces the whole dictionary, so merge first —
                // otherwise one owner's flush wipes every other owner's slot.
                const current = await client.getStorage(kind);
                const content = { ...current.content };
                if (payload === undefined || payload === null) {
                    delete content[key];
                } else {
                    // Values must be scalars; anything structured is the owner's
                    // own encoding and is stored verbatim as a string.
                    content[key] = typeof payload === "string" ? payload : JSON.stringify(payload);
                }
                await client.putStorage(kind, content);
                return { ok: true };
            } catch (e: any) {
                return refuse(
                    `EMPAIA app-ui storage write failed: ${e?.message ?? e}`,
                    "W_EMPAIA_STORAGE_WRITE_FAILED",
                    $.t("io.storageWriteFailed", { ns: "empaia-workbench" })
                );
            }
        },

        async readBundle(ctx: any): Promise<IOResultLike> {
            const client = deps.getClient();
            if (!client) {
                return refuse("EMPAIA workbench session is not ready", "W_EMPAIA_NO_SESSION",
                    $.t("io.notReady", { ns: "empaia-workbench" }));
            }
            try {
                const stored = await client.getStorage(deps.storageKind());
                const value = stored.content[storageKey(ctx)];
                // Round-trip contract: hand back exactly what was written. The
                // owner decodes its own format — we never JSON.parse for it.
                return { ok: true, payload: value === undefined ? undefined : value };
            } catch (e: any) {
                return refuse(
                    `EMPAIA app-ui storage read failed: ${e?.message ?? e}`,
                    "W_EMPAIA_STORAGE_READ_FAILED",
                    $.t("io.storageReadFailed", { ns: "empaia-workbench" })
                );
            }
        },
    };
}
