/// <reference path="../../src/types/globals.d.ts" />

/**
 * Typed wrapper over the EMPAIA Workbench Service v3 **app** API.
 *
 * Base URL is `{wbsUrl}/v3/scopes`; every route is prefixed with the scope id
 * (`libs/empaia-api-lib/src/lib/v3/app/api-configuration.ts` and the generated
 * `fn/**` modules). All traffic goes through `window.HttpClient` so it inherits
 * JWT injection for the `empaia` auth context, the one-shot refresh on 401,
 * CSRF, and optional server-proxy routing (AGENTS.md §0.3 / §4).
 *
 * Everything that comes back is treated as adversarial: each accessor
 * re-validates shape before handing data on (AGENTS.md §7). Malformed items are
 * dropped with a warning rather than propagated into the viewer.
 */

import type {
    AnnotationList, AnnotationQuery, AppUiStorage, EmpaiaAnnotation, EmpaiaClass,
    EmpaiaCollection, ExtendedScope, Job, JobMode, Pixelmap, Primitive,
    Slide, SlideInfo,
} from "./types";

export interface Wbs3ClientOptions {
    wbsUrl: string;
    scopeId: string;
    /** Optional server proxy alias (`server.secure.proxies.<alias>`). */
    proxy?: string | null;
    /** Auth context id declared by this module (`include.json::authContext`). */
    contextId: string;
    timeoutMs?: number;
}

/** Scheduling lane for job polling / result fetches so tiles never starve. */
const BACKGROUND: { priority: "background" } = { priority: "background" };

export class Wbs3Client {
    readonly scopeId: string;
    /**
     * Absolute root of every scope route — and the prefix the tile sources build
     * their URLs from.
     *
     * Read back from the client rather than composed here: with a server proxy
     * alias configured, `XOpatRemoteEndpoint` resolves the base to
     * `<origin>/proxy/<alias>/v3/scopes/<id>`, and a tile URL composed from the
     * raw `wbsUrl` would bypass the proxy (and its credentials) entirely.
     */
    readonly scopeRoot: string;

    private readonly _client: any;

    constructor(options: Wbs3ClientOptions) {
        this.scopeId = options.scopeId;
        const scopePath = `/v3/scopes/${encodeURIComponent(options.scopeId)}`;

        this._client = new (window as any).HttpClient({
            ...(options.proxy
                ? { proxy: options.proxy, baseURL: scopePath }
                : { baseURL: `${options.wbsUrl.replace(/\/+$/, "")}${scopePath}` }),
            timeoutMs: options.timeoutMs ?? 30_000,
            // `types` omitted: HttpClient resolves it per request from
            // XOpatAuth.getSecretTypes, so the broker owning this context stays the
            // single source of truth even if it is configured after us.
            auth: {
                contextId: options.contextId,
                refreshOn401: true,
                // The workbench runs FastAPI's `HTTPBearer`, which answers **403**
                // when the `Authorization` header is absent and 401 only once it is
                // present and rejected. With the default `[401]` a context that lost
                // its token (or never got one) is served 403s nothing retries, and the
                // session is dead for good behind a single console warning. Listing
                // 403 makes that one refresh cycle — `secret-needs-update` →
                // `requestNewToken()` over VACI → retry — reachable.
                refreshOnStatuses: [401, 403],
                required: true,
            },
        });

        this.scopeRoot = String(this._client.baseURL).replace(/\/+$/, "");
    }

    /** The underlying client — tile sources are stamped with it by the protocol. */
    get httpClient(): any { return this._client; }

    /**
     * Complete a `*\/query` body so the workbench service accepts it.
     *
     * The service validates every query route through the same rule
     * (`annot_connector.validate_query`): the body must select by **`creators`**
     * or by **`jobs`** — the two are mutually exclusive, and a body that sets
     * neither is a **400** (`"Either a valid creator_id or job list or a list of
     * <items> must be set as query parameter"`). `references` alone — the natural
     * "everything on this slide" — is *not* a selector, so it needs a creator.
     *
     * We default to "what this scope authored", which is the only creator list a
     * scope may always ask for (with multi-user disabled the service demands
     * exactly `[scope_id]`; with it enabled, any subset of the examination's
     * scopes, of which this is one). Job output keeps arriving through the
     * callers that pass `jobs` — those are left untouched.
     *
     * The one other legal shape is the id-list escape hatch (a body whose ONLY
     * field is the item id list), which must not be narrowed by a creator either.
     */
    private _scopedQuery<T extends AnnotationQuery>(query: T): T {
        if (query.creators?.length || query.jobs?.length) return query;
        const keys = Object.keys(query).filter(k => (query as any)[k] !== undefined);
        if (keys.length === 1 && query.annotations?.length) return query;
        return { ...query, creators: [this.scopeId] };
    }

    // ── scope ───────────────────────────────────────────────────────────────

    /**
     * `GET /{scope_id}` → scope record incl. the EMPAIA App Description.
     *
     * Passes the ABSOLUTE url rather than an empty relative path. `baseURL` IS
     * the scope root, and there is no relative path that expresses "the base and
     * nothing more": `HttpClient.request` joins as
     * `baseURL + (path.startsWith("/") ? "" : "/") + path`, so `""` produces a
     * TRAILING SLASH. The workbench service then 307-redirects `/…/{id}/` →
     * `/…/{id}`, and behind the EATS reverse proxy that redirect comes back with
     * the `/wbs-api` prefix applied twice — which 404s, and a 404 carries no CORS
     * headers, so the browser reports it as an opaque CORS failure. `request`
     * passes a `^https?://` argument through unchanged, which avoids all of it.
     */
    async getScope(): Promise<ExtendedScope> {
        const raw = await this._client.request(this.scopeRoot, { method: "GET" });
        if (!isObject(raw) || typeof raw.id !== "string") {
            throw new Error("EMPAIA scope response is malformed.");
        }
        return {
            id: raw.id,
            app_id: str(raw.app_id),
            case_id: str(raw.case_id),
            examination_id: str(raw.examination_id),
            examination_state: typeof raw.examination_state === "string" ? raw.examination_state : undefined,
            user_id: str(raw.user_id),
            created_at: num(raw.created_at),
            ead: isObject(raw.ead) ? raw.ead : {},
        };
    }

    // ── slides ──────────────────────────────────────────────────────────────

    /** `GET /{scope_id}/slides` */
    async listSlides(): Promise<Slide[]> {
        const raw = await this._client.request("/slides", { method: "GET" });
        return itemsOf(raw)
            .filter(s => isObject(s) && typeof s.id === "string")
            .map(s => ({
                id: s.id,
                case_id: str(s.case_id),
                local_id: strOrNull(s.local_id),
                block: strOrNull(s.block),
                stain: isObject(s.stain) ? s.stain : null,
                tissue: isObject(s.tissue) ? s.tissue : null,
                deleted: typeof s.deleted === "boolean" ? s.deleted : null,
                created_at: num(s.created_at),
                updated_at: num(s.updated_at),
            }));
    }

    /** `GET /{scope_id}/slides/{slide_id}/info` */
    async getSlideInfo(slideId: string): Promise<SlideInfo> {
        const raw = await this._client.request(`/slides/${encodeURIComponent(slideId)}/info`, { method: "GET" });
        if (!isObject(raw) || !isObject(raw.extent) || !Array.isArray(raw.levels)) {
            throw new Error(`EMPAIA slide info for ${slideId} is malformed.`);
        }
        return raw as SlideInfo;
    }

    // ── annotations ─────────────────────────────────────────────────────────

    /**
     * `POST /{scope_id}/annotations` — one request per item, deliberately.
     *
     * The schema advertises a list wrapper (`PostAnnotations = PostAnnotationList
     * | PostAnnotation`), but the list form **cannot succeed** against
     * workbench-service 0.13.3: `validate_post_data`
     * (`workbench_service/api/v3/connectors/annot_connector.py:108-118`) recurses
     * into `post_data.items` and then falls through *without returning*, so it
     * re-checks `creator_id` on the wrapper — and `PostAnnotationList` has no
     * such field, only `items`. Every batch POST therefore answers
     * `412 "Creator_id must be set to scope_id"` no matter how correct its
     * contents. `POST /classes` shares the validator and the same fate.
     *
     * When the service is fixed this collapses back to a single batched request.
     *
     * `isRoi` maps to the `is_roi` query flag, which is what makes the annotation
     * a usable job input: the service then attaches the global ROI class itself
     * (`annot_connector.post_roi_class` → `org.empaia.global.v1.classes.roi`), so
     * callers must NOT post their own class record for these.
     *
     * The route answers with the annotation re-fetched `with_classes=True` — a
     * bare object, not a list — hence the `itemsOf`-or-single read below.
     */
    async postAnnotations(
        items: Partial<EmpaiaAnnotation>[],
        opts: { isRoi?: boolean } = {}
    ): Promise<EmpaiaAnnotation[]> {
        const created: EmpaiaAnnotation[] = [];
        for (const item of items) {
            const raw = await this._client.request("/annotations", {
                method: "POST",
                body: item,
                ...(opts.isRoi ? { query: { is_roi: true } } : {}),
            });
            created.push(...(oneOrMany(raw).filter(isAnnotationLike) as EmpaiaAnnotation[]));
        }
        return created;
    }

    /** `DELETE /{scope_id}/annotations/{annotation_id}` */
    async deleteAnnotation(annotationId: string): Promise<void> {
        await this._client.request(`/annotations/${encodeURIComponent(annotationId)}`, { method: "DELETE" });
    }

    /**
     * `PUT /{scope_id}/annotations/query` — the viewport/npp-filtered read used
     * for hydration. `with_classes` asks the server to inline class values so we
     * do not need a second round trip per annotation.
     */
    async queryAnnotations(query: AnnotationQuery, opts: {
        skip?: number; limit?: number; withClasses?: boolean; signal?: AbortSignal;
    } = {}): Promise<AnnotationList> {
        const raw = await this._client.request("/annotations/query", {
            method: "PUT",
            body: this._scopedQuery(query),
            query: {
                skip: opts.skip,
                limit: opts.limit,
                with_classes: opts.withClasses === undefined ? true : opts.withClasses,
            },
            signal: opts.signal,
            ...BACKGROUND,
        });
        const items = keepValid(itemsOf(raw), isAnnotationLike, "annotation") as EmpaiaAnnotation[];
        warnGeometryless(items);
        return {
            item_count: num(raw?.item_count) ?? 0,
            items,
            low_npp_centroids: Array.isArray(raw?.low_npp_centroids) ? raw.low_npp_centroids : null,
        };
    }

    /** `PUT /{scope_id}/annotations/query/count` */
    async countAnnotations(query: AnnotationQuery): Promise<number> {
        const raw = await this._client.request("/annotations/query/count", {
            method: "PUT", body: this._scopedQuery(query), ...BACKGROUND,
        });
        return num(raw?.item_count) ?? 0;
    }

    // ── classes ─────────────────────────────────────────────────────────────

    /**
     * `POST /{scope_id}/classes` — one request per item, for the same reason
     * `postAnnotations` is (see its doc: the shared `validate_post_data`
     * fall-through 412s every list body).
     *
     * `value` must be one of the values `getClassNamespaces()` reports, else the
     * service answers `400 "Invalid class name for EAD"`.
     */
    async postClasses(items: Partial<EmpaiaClass>[]): Promise<EmpaiaClass[]> {
        const created: EmpaiaClass[] = [];
        for (const item of items) {
            const raw = await this._client.request("/classes", { method: "POST", body: item });
            created.push(...(oneOrMany(raw)
                .filter(c => isObject(c) && typeof c.value === "string") as EmpaiaClass[]));
        }
        return created;
    }

    /**
     * `GET /{scope_id}/class-namespaces` — every class value this scope may use:
     * the global namespace plus the namespace of the app bound to the
     * examination. This is the *same* dict the service validates posted classes
     * against (`namespace_validation.validate_class_value`), so it is the
     * authoritative source for seeding presets — and far more reliable than the
     * EAD's optional `rendering.annotations` hints.
     *
     * The response is nested; use {@link flattenClassNamespaces} to get values.
     */
    async getClassNamespaces(): Promise<Record<string, ClassNamespace>> {
        const raw = await this._client.request("/class-namespaces", { method: "GET", ...BACKGROUND });
        return isObject(raw) ? raw as Record<string, ClassNamespace> : {};
    }

    /** `PUT /{scope_id}/classes/query` */
    async queryClasses(body: {
        references?: string[]; jobs?: (string | null)[]; creators?: string[];
    }): Promise<EmpaiaClass[]> {
        const raw = await this._client.request("/classes/query",
            { method: "PUT", body: this._scopedQuery(body), ...BACKGROUND });
        return itemsOf(raw).filter(c => isObject(c) && typeof c.value === "string") as EmpaiaClass[];
    }

    // ── collections ─────────────────────────────────────────────────────────

    /** `POST /{scope_id}/collections` */
    async postCollection(collection: Partial<EmpaiaCollection>): Promise<EmpaiaCollection> {
        const raw = await this._client.request("/collections", { method: "POST", body: collection });
        if (!isObject(raw) || typeof raw.id !== "string") {
            throw new Error("EMPAIA collection creation returned no id.");
        }
        return raw as EmpaiaCollection;
    }

    /** `POST /{scope_id}/collections/{collection_id}/items` */
    async postCollectionItems(collectionId: string, items: unknown[]): Promise<void> {
        if (!items.length) return;
        await this._client.request(`/collections/${encodeURIComponent(collectionId)}/items`, {
            method: "POST", body: { items },
        });
    }

    /**
     * `PUT /{scope_id}/collections/{collection_id}/items/query`
     *
     * **This route takes NO creator selector — not `creators`, not `jobs.`** Its
     * body model is closed (`extra_forbidden`), so either field is a 422 and the
     * whole read is lost:
     *
     *   `{"loc":["body","jobs"],"msg":"Extra inputs are not permitted"}`
     *   `{"loc":["body","creators"],"msg":"Extra inputs are not permitted"}`
     *
     * Both were tried, because every *other* query route (annotations,
     * primitives, pixelmaps) takes one and the uniformity looked like the rule.
     * It is not: the collection id already scopes the read completely — a
     * collection holds one job's output or one scope's input, never a mix — so
     * there is nothing left to select by, and `_scopedQuery`'s automatic
     * `creators: [scopeId]` must not be applied here either. That default is why
     * the *input*-collection fallback 422'd too, silently, and staged-batch
     * membership then came back empty on reload.
     *
     * `references` is the one filter the model does accept.
     */
    async queryCollectionItems(
        collectionId: string,
        body: { references?: string[] } = {}
    ): Promise<any[]> {
        const raw = await this._client.request(
            `/collections/${encodeURIComponent(collectionId)}/items/query`,
            { method: "PUT", body, ...BACKGROUND }
        );
        return itemsOf(raw);
    }

    /** `GET /{scope_id}/collections/{collection_id}` */
    async getCollection(collectionId: string): Promise<EmpaiaCollection | undefined> {
        const raw = await this._client.request(
            `/collections/${encodeURIComponent(collectionId)}`,
            // The one read that was missing the background lane, while sitting on
            // the job-detail path — so opening an analysis competed with tiles.
            { method: "GET", ...BACKGROUND },
        );
        return isObject(raw) ? raw as EmpaiaCollection : undefined;
    }

    // ── primitives ──────────────────────────────────────────────────────────

    /** `PUT /{scope_id}/primitives/query` */
    async queryPrimitives(body: {
        references?: string[]; jobs?: (string | null)[]; creators?: string[];
    }): Promise<Primitive[]> {
        const raw = await this._client.request("/primitives/query",
            { method: "PUT", body: this._scopedQuery(body), ...BACKGROUND });
        return keepValid(itemsOf(raw), isPrimitiveLike, "primitive") as Primitive[];
    }

    // ── pixelmaps ───────────────────────────────────────────────────────────

    /** `PUT /{scope_id}/pixelmaps/query` */
    async queryPixelmaps(body: {
        references?: string[]; jobs?: (string | null)[]; creators?: string[];
    }): Promise<Pixelmap[]> {
        const raw = await this._client.request("/pixelmaps/query",
            { method: "PUT", body: this._scopedQuery(body), ...BACKGROUND });
        return keepValid(itemsOf(raw), isPixelmapLike, "pixelmap") as Pixelmap[];
    }

    /** `GET /{scope_id}/pixelmaps/{pixelmap_id}` */
    async getPixelmap(pixelmapId: string): Promise<Pixelmap | undefined> {
        const raw = await this._client.request(`/pixelmaps/${encodeURIComponent(pixelmapId)}`, { method: "GET" });
        return isPixelmapLike(raw) ? raw as Pixelmap : undefined;
    }

    /** Absolute URL of one raw pixelmap tile buffer (used by the tile source). */
    pixelmapTileUrl(pixelmapId: string, level: number, x: number, y: number): string {
        return `${this.scopeRoot}/pixelmaps/${encodeURIComponent(pixelmapId)}` +
            `/level/${level}/position/${x}/${y}/data`;
    }

    // ── jobs ────────────────────────────────────────────────────────────────

    /** `POST /{scope_id}/jobs` */
    async createJob(mode: JobMode, containerized: boolean): Promise<Job> {
        const raw = await this._client.request("/jobs", {
            method: "POST",
            body: { creator_id: this.scopeId, creator_type: "SCOPE", mode, containerized },
        });
        if (!isJobLike(raw)) throw new Error("EMPAIA job creation returned a malformed job.");
        return raw as Job;
    }

    /** `PUT /{scope_id}/jobs/{job_id}/inputs/{input_key}` */
    async setJobInput(jobId: string, inputKey: string, inputId: string): Promise<Job> {
        const raw = await this._client.request(
            `/jobs/${encodeURIComponent(jobId)}/inputs/${encodeURIComponent(inputKey)}`,
            { method: "PUT", body: { id: inputId } }
        );
        return raw as Job;
    }

    /** `PUT /{scope_id}/jobs/{job_id}/run` */
    async runJob(jobId: string): Promise<Job> {
        const raw = await this._client.request(`/jobs/${encodeURIComponent(jobId)}/run`, { method: "PUT" });
        return raw as Job;
    }

    /** `PUT /{scope_id}/jobs/{job_id}/stop` */
    async stopJob(jobId: string): Promise<void> {
        await this._client.request(`/jobs/${encodeURIComponent(jobId)}/stop`, { method: "PUT" });
    }

    /** `DELETE /{scope_id}/jobs/{job_id}` */
    async deleteJob(jobId: string): Promise<void> {
        await this._client.request(`/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    }

    /** `GET /{scope_id}/jobs` */
    async listJobs(signal?: AbortSignal): Promise<Job[]> {
        const raw = await this._client.request("/jobs", { method: "GET", signal, ...BACKGROUND });
        return itemsOf(raw).filter(isJobLike) as Job[];
    }

    /** `GET /{scope_id}/jobs/{job_id}` */
    async getJob(jobId: string): Promise<Job | undefined> {
        const raw = await this._client.request(`/jobs/${encodeURIComponent(jobId)}`, { method: "GET", ...BACKGROUND });
        return isJobLike(raw) ? raw as Job : undefined;
    }

    // ── app-ui storage ──────────────────────────────────────────────────────

    /** `GET /{scope_id}/app-ui-storage/{scope|user}` */
    async getStorage(kind: "scope" | "user"): Promise<AppUiStorage> {
        const raw = await this._client.request(`/app-ui-storage/${kind}`, { method: "GET" });
        return { content: isObject(raw?.content) ? raw.content : {} };
    }

    /** `PUT /{scope_id}/app-ui-storage/{scope|user}` */
    async putStorage(kind: "scope" | "user", content: Record<string, string | number | boolean>): Promise<void> {
        await this._client.request(`/app-ui-storage/${kind}`, { method: "PUT", body: { content } });
    }
}

// ── class namespaces ────────────────────────────────────────────────────────

/** One entry of the `GET /class-namespaces` response: a nested class tree. */
export interface ClassNamespace { classes?: Record<string, any> | null }

/** A class value the scope is permitted to post, with its display metadata. */
export interface PermittedClass { value: string; name: string; description?: string }

/**
 * Flatten the nested `class-namespaces` response into the exact value strings
 * the service accepts.
 *
 * Mirrors the server's own `parse_class_values`
 * (`workbench_service/api/v3/namespace_validation.py:24-33`): values are built as
 * `<namespace>.classes.<key>[.<key>…]`, and a node is a **leaf** — an actual
 * class — only when it carries a `name`; anything else is a sub-namespace and is
 * recursed into. Getting this wrong means offering the user a preset whose class
 * the server will reject with `400 "Invalid class name for EAD"`.
 */
export function flattenClassNamespaces(namespaces: Record<string, ClassNamespace>): PermittedClass[] {
    const out: PermittedClass[] = [];

    const walk = (base: string, node: Record<string, any>): void => {
        for (const [key, data] of Object.entries(node)) {
            if (!isObject(data)) continue;
            const value = `${base}.${key}`;
            if (typeof data.name === "string") {
                out.push({
                    value,
                    name: data.name,
                    ...(typeof data.description === "string" ? { description: data.description } : {}),
                });
            } else {
                walk(value, data);
            }
        }
    };

    for (const [namespace, entry] of Object.entries(namespaces || {})) {
        const classes = entry?.classes;
        if (isObject(classes)) walk(`${namespace}.classes`, classes);
    }
    return out;
}

// ── boundary validation helpers ─────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, any> {
    return !!v && typeof v === "object" && !Array.isArray(v);
}

function itemsOf(raw: unknown): any[] {
    if (Array.isArray(raw)) return raw;
    if (isObject(raw) && Array.isArray(raw.items)) return raw.items;
    return [];
}

/**
 * Like {@link itemsOf}, but a bare record counts as a one-element list. The POST
 * routes answer with the created object itself while the query routes answer
 * with a list wrapper, and both shapes are legal per the OpenAPI unions.
 */
function oneOrMany(raw: unknown): any[] {
    if (Array.isArray(raw) || (isObject(raw) && Array.isArray(raw.items))) return itemsOf(raw);
    return isObject(raw) ? [raw] : [];
}

function str(v: unknown): string { return typeof v === "string" ? v : ""; }
function strOrNull(v: unknown): string | null { return typeof v === "string" ? v : null; }
function num(v: unknown): number | undefined { return typeof v === "number" && Number.isFinite(v) ? v : undefined; }

const ANNOTATION_TYPES = new Set(["point", "line", "arrow", "circle", "rectangle", "polygon"]);

function isAnnotationLike(v: unknown): boolean {
    return isObject(v) && typeof v.type === "string" && ANNOTATION_TYPES.has(v.type)
        && typeof v.reference_id === "string";
}

/**
 * A `[x, y]` pair of real numbers — the atom every annotation geometry is built
 * from. `Number(null)` is `0` and `Number.isFinite(0)` is true, so a coercing
 * check would call `[null, 17890]` a valid coordinate and the annotation would
 * silently land on the slide's edge; only a number, or a string that is one,
 * counts (the convertor applies the same rule).
 */
function isCoord(v: unknown): boolean {
    if (typeof v === "number") return Number.isFinite(v);
    return typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v));
}

function isPair(v: unknown): boolean {
    return Array.isArray(v) && v.length >= 2 && isCoord(v[0]) && isCoord(v[1]);
}

/**
 * Whether the record carries the geometry its own type declares.
 *
 * Deliberately NOT part of {@link isAnnotationLike}: the convertor is the one
 * that decides what is renderable, and a second drop point here would only move
 * the data loss earlier. This exists so the loss is *reported* — a response of
 * ten thousand points that all lack `coordinates` currently reaches the canvas
 * as "nothing appeared", with nothing anywhere naming the cause.
 */
function hasDeclaredGeometry(v: any): boolean {
    switch (v?.type) {
        case "point": return isPair(v.coordinates);
        case "line": return Array.isArray(v.coordinates) && v.coordinates.length >= 2
            && v.coordinates.every(isPair);
        case "polygon": return Array.isArray(v.coordinates) && v.coordinates.length >= 3
            && v.coordinates.every(isPair);
        case "arrow": return isPair(v.head) && isPair(v.tail);
        case "circle": return isPair(v.center) && Number(v.radius) > 0;
        case "rectangle": return isPair(v.upper_left) && Number(v.width) > 0 && Number(v.height) > 0;
        default: return true;
    }
}

function warnGeometryless(items: any[]): void {
    const bad = items.filter(item => !hasDeclaredGeometry(item));
    if (!bad.length) return;
    const kind = `annotation-geometry:${[...new Set(bad.map(b => String(b?.type)))].sort().join(",")}`;
    if (_shapeWarned.has(kind)) return;
    _shapeWarned.add(kind);
    console.warn(`[empaia-workbench] ${bad.length}/${items.length} annotation(s) carry no usable ` +
        `geometry for their declared type and will not render. First one:`, bad[0]);
}

/**
 * Drop records that do not match the shape we can act on — but say so once.
 *
 * A silent `.filter()` over a wire response is indistinguishable from an empty
 * response, so a schema drift (a renamed field, a new value encoding) presents
 * as "this analysis produced nothing" with nothing anywhere to explain it. One
 * warning per kind, carrying the first offender, turns that into a lead.
 */
const _shapeWarned = new Set<string>();

function keepValid(items: any[], predicate: (v: unknown) => boolean, kind: string): any[] {
    const kept = items.filter(predicate);
    if (kept.length !== items.length && !_shapeWarned.has(kind)) {
        _shapeWarned.add(kind);
        const rejected = items.find(item => !predicate(item));
        console.warn(`[empaia-workbench] ${items.length - kept.length} ${kind} record(s) did not ` +
            `match the expected shape and were dropped. First one:`, rejected);
    }
    return kept;
}

const PRIMITIVE_TYPES = new Set(["integer", "float", "bool", "string"]);

function isPrimitiveLike(v: unknown): boolean {
    return isObject(v) && typeof v.type === "string" && PRIMITIVE_TYPES.has(v.type)
        && (typeof v.value === "number" || typeof v.value === "boolean" || typeof v.value === "string");
}

const PIXELMAP_TYPES = new Set(["continuous_pixelmap", "discrete_pixelmap", "nominal_pixelmap"]);

function isPixelmapLike(v: unknown): boolean {
    return isObject(v) && typeof v.type === "string" && PIXELMAP_TYPES.has(v.type)
        && typeof v.tilesize === "number" && v.tilesize > 0
        && Array.isArray(v.levels) && typeof v.channel_count === "number";
}

function isJobLike(v: unknown): boolean {
    return isObject(v) && typeof v.id === "string" && typeof v.status === "string";
}
