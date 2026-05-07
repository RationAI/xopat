// ── Generic IO/persistence pipeline types — ambient, visible in all files ───
// Canonical reference: src/IO_PIPELINE.md
//
// The pipeline lets modules/plugins declare what kinds of IO they support
// (bundle-level export/import, per-element CRUD), and lets administrators
// bind those capabilities to sinks (file download, HTTP, custom).
//
// Vocabulary: a *sink* is the runtime object that performs IO (writeBundle,
// readBundle, create/read/update/delete). Modules/plugins register their
// own sinks via `IO_PIPELINE.registerSink(...)`; admins route capabilities
// to sinks via `ENV.client.io.bindings`. Per-deployment overrides for a
// sink's options live in `ENV.client.io.sinkOverrides[sinkId]` and are
// merged by the *module* with its own defaults — the pipeline never
// composes sink options for the module.

/**
 * Direction of a single IO operation.
 *  - `export` / `import`     — whole-bundle traffic
 *  - `create` / `read` / `update` / `delete` / `list` — per-element CRUD
 *  - `pre-create` / `pre-update` / `pre-delete` — guard (pre-action) phase;
 *    runs before the corresponding CRUD direction so external handlers can
 *    veto the operation. Owners use `IOResource.create/update/delete` (which
 *    runs guards then dispatches) or call `IOResource.canCreate/…` for the
 *    guard-only check.
 *  - `kv-get` / `kv-set` / `kv-delete` / `kv-clear` / `kv-keys` — key/value store
 */
type IODirection =
    | "export"
    | "import"
    | "create"
    | "read"
    | "update"
    | "delete"
    | "query"
    | "pre-create"
    | "pre-update"
    | "pre-delete"
    | "kv-get"
    | "kv-set"
    | "kv-delete"
    | "kv-clear"
    | "kv-keys";

/**
 * Kinds of capability a module/plugin can declare.
 *  - `bundle` — whole-set export/import (e.g. all annotations + presets at once)
 *  - `crud`   — per-element create/read/update/delete
 *  - `kv`     — namespaced key/value storage (replaces XOpatStorage.Cache/Cookies/Data;
 *               capability id convention is `kv:<namespace>` e.g. `kv:cache`,
 *               `kv:cookies`, `kv:data`, `kv:session` or any custom name)
 */
type IOCapabilityKind = "bundle" | "crud" | "kv";

/**
 * A capability declared by an owner. Owner = a plugin, a module, or "core".
 *
 *  - `id`     stable identifier, e.g. `"bundle-export"`, `"crud:annotation"`.
 *             For CRUD, the convention `"crud:<resourceName>"` lets the
 *             pipeline link the capability to a registered IOResource.
 *  - `kind`   `bundle` or `crud`.
 *  - `label`  optional human label for admin UIs / logs.
 *  - `schema` optional JSON Schema describing the payload shape.
 */
interface IOCapability {
    id: string;
    kind: IOCapabilityKind;
    label?: string;
    schema?: object;
}

/**
 * Context passed through every IO call. Sinks inspect it to decide
 * how to route the payload; middleware can read/mutate `meta` freely.
 */
interface IOContext {
    direction: IODirection;
    capabilityId: string;
    /** Owner kind: "core", "plugin", or "module". */
    xoType: "core" | "plugin" | "module";
    /** Owner uid (the element's `uid`, or `"core"`). */
    ownerUid: string;
    /** Plugin/module id (for sinks keyed by id rather than uid). */
    ownerId: string;
    /** Set for CRUD; the resource collection name (e.g. `"annotation"`). */
    resourceName?: string;
    /** Set for read/update/delete; the item id within the resource. */
    itemId?: string;
    /** Bundle key (legacy `exportKey`); empty string by default. */
    key: string;
    /** Set for viewer-scoped exports/imports. */
    viewerId?: string;
    /** Free-form metadata, e.g. format hints. */
    meta: Record<string, unknown>;
}

/**
 * Result of any IO call. Either a success (optionally carrying a payload)
 * or a refusal with a reason. `userMessage` (when present) is what gets
 * surfaced via `Dialogs.show`; `reason` is what gets logged.
 */
type IOResult<T = unknown> =
    | { ok: true; payload?: T }
    | {
          ok: false;
          refused: true;
          reason: string;
          userMessage?: string;
          code?: string;
      };

/**
 * Sink contract. Each sink implements only the methods relevant
 * to the capability kinds it advertises in `supports`.
 *
 * `accepts` is an optional fine-grained gate: if defined, it must return
 * true for the sink to receive the call. Useful for per-context
 * filtering (e.g. "only handle items from viewer X").
 *
 * Modules/plugins register sinks at runtime via `IO_PIPELINE.registerSink(...)`.
 * Sink options (URLs, repo paths, tokens, …) are composed by the module
 * itself; `IO_PIPELINE.sinkOverrides(sinkId)` returns ONLY the admin-supplied
 * override slot from `ENV.client.io.sinkOverrides[sinkId]`, which the module
 * merges with its own defaults inside its `getOptions` callback.
 */
interface IOSink {
    id: string;
    label?: string;
    supports: IOCapabilityKind[];
    accepts?(ctx: IOContext): boolean;

    writeBundle?(ctx: IOContext, payload: unknown): Promise<IOResult> | IOResult;
    readBundle?(ctx: IOContext): Promise<IOResult> | IOResult;

    create?(ctx: IOContext, item: unknown): Promise<IOResult> | IOResult;
    read?(ctx: IOContext): Promise<IOResult> | IOResult;
    update?(ctx: IOContext, patch: unknown): Promise<IOResult> | IOResult;
    delete?(ctx: IOContext): Promise<IOResult> | IOResult;
    /**
     * Streamed parameterised read. The owner sends `params` (free-form,
     * domain-specific — bbox + zoom, page tokens, anything) and the
     * sink yields raw items as they arrive. The pipeline routes
     * `query` to the **first** bound sink whose method exists and
     * whose `accepts(ctx)` (if defined) passes; subsequent sinks
     * are not consulted. Authors typically write this with
     * `async function*` so they can `await` setup before the first
     * yield. Read `ctx.meta.signal` (an AbortSignal) for cancellation.
     */
    query?(ctx: IOContext, params: unknown): AsyncIterable<unknown>;
}

/**
 * KV driver — any object implementing the `localStorage` API. The pipeline
 * accepts `window.localStorage` directly; custom drivers (cookies, IndexedDB,
 * server-backed key-value, in-memory) follow the same shape.
 *
 * Drivers are registered with `IO_PIPELINE.registerKVDriver(...)`; admins
 * bind `kv:*` capabilities to them in `ENV.client.io.bindings`.
 *
 * `mode: "sync"` drivers expose the synchronous `localStorage` shape; values
 * are returned directly.
 * `mode: "async"` drivers return Promises from every method; only the async
 * KV handle (`mode: "async"`, used by `kv:data` and friends) accepts these.
 *
 * `shared: true` (default for `local-storage`, `cookies`, `memory`) means
 * the driver is shared across owners — the pipeline auto-prefixes keys with
 * `<ownerUid>::` to prevent collisions. `shared: false` dedicates the driver
 * to one owner; keys pass through unchanged (modulo sanitization).
 *
 * `contextAware: true` lets the driver receive the active `IOContext` as the
 * second arg of every method, so it can route by `ctx.ownerUid` /
 * `ctx.capabilityId` itself rather than relying on key prefixing.
 */
interface IOKVDriver {
    id: string;
    mode: "sync" | "async";
    label?: string;
    shared?: boolean;
    contextAware?: boolean;

    getItem(key: string, ctx?: IOContext): string | null | Promise<string | null>;
    setItem(key: string, value: string, ctx?: IOContext): void | Promise<void>;
    removeItem(key: string, ctx?: IOContext): void | Promise<void>;
    key(index: number, ctx?: IOContext): string | null | Promise<string | null>;
    readonly length: number;
    clear(ctx?: IOContext): void | Promise<void>;
}

/**
 * Façade returned from `IO_PIPELINE.kv(...)` (and underlying
 * `XOpatStorage.Cache/Cookies/Data`). When `mode === "sync"` the basic
 * methods return values directly; the async equivalents are still available.
 * When `mode === "async"` the basic methods return `Promise`s.
 */
interface IOKVHandle {
    readonly mode: "sync" | "async";
    readonly ownerUid: string;
    readonly capabilityId: string;

    // localStorage-shaped (sync mode returns sync values; async mode returns Promises)
    getItem(key: string): string | null | Promise<string | null>;
    setItem(key: string, value: string): void | Promise<void>;
    removeItem(key: string): void | Promise<void>;
    keys(): string[] | Promise<string[]>;
    clear(): void | Promise<void>;

    // xOpat conveniences (mirror XOpatStorage.Cache/Data shape)
    get<T = any>(key: string, defaultValue?: T): T | string | boolean | null | Promise<T | string | boolean | null>;
    set(key: string, value: any): void | Promise<void>;
    delete(key: string): void | Promise<void>;
}

/**
 * Per-resource hooks supplied by the owner. All hooks are optional — the
 * pipeline runs without them, but `validate` is the canonical way to
 * refuse incoming items, and `serialize` / `deserialize` let the owner
 * keep its in-memory shape decoupled from the wire shape.
 */
interface IOResourceDef<T = unknown> {
    name: string;
    schema?: object;
    validate?(item: T, ctx: IOContext): IOResult;
    serialize?(item: T, ctx: IOContext): unknown;
    deserialize?(raw: unknown, ctx: IOContext): T;
    /**
     * Extract a stable identity key from a local item, used by the outbox
     * queue to recognize ops on the same logical entity for coalescing.
     * Required when `coalesce: true` is set; otherwise creates use a
     * unique synthetic id and never coalesce.
     */
    identityOf?(item: T): string;
    /**
     * Enable rewrite rules on the per-resource outbox queue:
     *  - `create X` then `delete X` (same identity, both unstarted): both removed.
     *  - `delete X` then `create X`: both removed.
     *  - Multiple `update X`: keep only the latest.
     *  - `create X` then `update X`: merge `update`'s patch into the
     *    `create`'s payload via `merge` (only applied if `merge` is provided).
     * In-flight ops never coalesce — only entries with `started === false`
     * are candidates. Rollback ops (from `rollbackOnAsyncRefuse`) participate
     * in coalescing like any normal op.
     */
    coalesce?: boolean;
    /**
     * Shallow-merge function for the `create + update` coalescing rule.
     * Receives the previous payload and the next patch; returns the merged
     * payload that supersedes the original create.
     */
    merge?(prevPayload: unknown, nextPatch: unknown): unknown;
    /**
     * Enable a persistent outbox for this resource (Phase 10). When `true`,
     * every queued op is mirrored into IndexedDB before sink dispatch
     * and removed after settle. Pending ops survive page reloads and
     * replay automatically on next boot. Requires `serialize` /
     * `deserialize` that round-trip through JSON.
     */
    persistOutbox?: boolean;
    /**
     * Maximum entries kept in the persistent outbox before refusing new
     * enqueues with `code: "W_IO_OUTBOX_FULL"`. Default 5000.
     */
    persistMaxEntries?: number;
    /**
     * Drop persisted entries older than this (ms) on boot and during
     * periodic sweeps. Default 7 days. Stale ops are unlikely to be
     * acceptable to the server anyway.
     */
    persistMaxAgeMs?: number;
}

/**
 * Options accepted by `IOResource.create / update / delete`.
 *
 *  - `meta`         free-form `IOContext.meta` carried into validate/guards/sinks.
 *                   Reserved keys (set by the pipeline, sinks/guards may read):
 *                   - `clientOpId: string` — stable per-call UUID minted by the
 *                     resource. Servers should dedup on this id when retries hit.
 *                   - `fromUndo: true` / `fromRedo: true` — auto-history replay flag.
 *                   - `fromReplay: true` — boot-time persistent-outbox replay flag.
 *                   - `phase: 'post-commit'` — set on the queued dispatch context
 *                     (so sinks / `io:refused` listeners can tell sync local
 *                     commit apart from async server outcome).
 *                   - `session: { isLocal: boolean; sourceUserId?: string; sessionId?: string }`
 *                     — set by session-aware owners when a mutation comes from
 *                     a remote peer's DELTA (`isLocal: false`) vs a local user
 *                     action (`isLocal: true`). sinks filter via
 *                     `accepts(ctx) => !!ctx.meta.session?.isLocal` so only the
 *                     originating peer fires upstream — the server sees ONE op
 *                     per logical action even when the live-collab session has
 *                     multiple peers. See src/IO_PIPELINE.md "Session-aware sinks".
 *  - `apply`        owner-supplied local commit. **Synchronous**. Runs in the
 *                   caller's frame, after sync guards pass. If it throws, the
 *                   call refuses with code `W_IO_APPLY_THREW` and the queued
 *                   dispatch is not started.
 *  - `inverseApply` owner-supplied local rollback. **Synchronous**. When
 *                   provided alongside `apply`, the resource auto-pushes a
 *                   history entry. Also used by the post-commit rollback path
 *                   when `rollbackOnAsyncRefuse: true` and the queued dispatch
 *                   resolves to refusal — the pipeline drives `history.undo()`
 *                   so the entry is popped and `inverseApply` runs once.
 *  - `skipGuards`   bypass the guard phase.
 *  - `skipHistory`  bypass the auto-history push for this single call.
 *  - `rollbackOnAsyncRefuse`
 *                   when `true` and the queued dispatch ultimately refuses,
 *                   the pipeline calls `history.undo()` to revert local state
 *                   and drop the entry. Default `false` — local input stays
 *                   visible; user is informed via `io:refused` toast and the
 *                   owner can react manually. See src/IO_PIPELINE.md.
 */
interface IOResourceMutateOptions {
    meta?: Record<string, unknown>;
    apply?: () => void;
    inverseApply?: () => void;
    skipGuards?: boolean;
    skipHistory?: boolean;
    rollbackOnAsyncRefuse?: boolean;
}

/**
 * Sync result returned from `IOResource.create / update / delete`. The `ok`
 * field reports the outcome of the local pipeline (validate + sync guards +
 * apply + history push). The `settled` Promise resolves with the eventual
 * outcome of the queued sink dispatch (or `{ ok: true }` when nothing
 * is bound). Callers that want server confirmation `await result.settled`;
 * fire-and-forget callers ignore it.
 */
type IOSyncResult<T = unknown> = IOResult<T> & { settled: Promise<IOResult<T>> };

/**
 * Façade returned from `XOpatElement.defineResource(...)`. CRUD calls are
 * inert (return `{ ok: true }`) when no sink is bound to the matching
 * `crud:<name>` capability, so resource declarations are free.
 *
 * `create / update / delete` run validate + guards + apply + dispatch in
 * that order. `canCreate / canUpdate / canDelete` run validate + guards
 * only — useful when the caller wants to gate a local commit and run the
 * persistence step separately (with `{ skipGuards: true }`).
 */
interface IOResource<T = unknown> {
    readonly name: string;
    /** Sync local commit; queued sink dispatch resolved on `.settled`. */
    create(item: T, options?: IOResourceMutateOptions): IOSyncResult<{ id: string }>;
    /** Read remains async — fetch from a bound sink. */
    read(itemId: string, meta?: Record<string, unknown>): Promise<IOResult<T>>;
    update(itemId: string, patch: Partial<T>, options?: IOResourceMutateOptions): IOSyncResult;
    delete(itemId: string, options?: IOResourceMutateOptions): IOSyncResult;
    /** Run validate + sync guards for `pre-create`. No sink calls. */
    canCreate(item: T, meta?: Record<string, unknown>): IOResult;
    /** Run validate + sync guards for `pre-update`. No sink calls. */
    canUpdate(itemId: string, patch: Partial<T>, meta?: Record<string, unknown>): IOResult;
    /** Run sync guards for `pre-delete`. No sink calls. */
    canDelete(itemId: string, meta?: Record<string, unknown>): IOResult;
    /**
     * Wait for the per-resource outbox queue to drain. Resolves with the
     * aggregate results of every queued op once all of them have settled
     * (success, refusal, or coalesced-out). Useful for "before closing
     * the page, wait for sync to finish" workflows.
     */
    flush(): Promise<IOResult[]>;
    /**
     * Abandon any pending (unstarted) ops in the outbox queue. Their
     * `.settled` Promises resolve to a refusal with `code: "W_IO_QUEUE_DROPPED"`.
     * Started ops continue and are not interrupted. Use for hard-shutdown.
     */
    drop(): void;
    /**
     * Stream items matching `params` from the first bound sink that
     * implements `query`. Per-item `deserialize` is applied; per-item
     * `validate` failures are logged and skipped (do not break the
     * stream). Returns an empty async iterable when nothing is bound or
     * no bound sink has a `query` method. Pass `meta.signal` for
     * cancellation.
     */
    query(params: Record<string, unknown>, meta?: Record<string, unknown>): AsyncIterable<T>;
}

/** Direction(s) a guard listens to. `"*"` matches every CRUD direction. */
type IOGuardDirection = "pre-create" | "pre-update" | "pre-delete" | "*";

/**
 * A registered guard handler. Guards are not routed (they don't appear in
 * `ENV.client.io.bindings`); they're vetoes that run in the pre-action phase
 * of every matching CRUD call.
 *
 *  - `ownerId`   who registered. If listed in `ENV.client.io.disabled`, all
 *                guards from that owner are silenced (consistent with how
 *                sink/capability disable already works).
 *  - `resource`  matches `IOContext.resourceName`. `"*"` = any resource.
 *  - `direction` `"pre-create" | "pre-update" | "pre-delete" | "*"`.
 *  - `priority`  higher first; default 0.
 *  - `handler`   returns `{ ok: true }` to allow or `{ ok: false, refused: true, … }`
 *                to abort. First refusal short-circuits the call. Per-viewer
 *                logic lives inside the handler — read `ctx.viewerId`.
 *  - `label`     optional human label for admin/debug surfaces.
 */
interface IOGuardSpec {
    ownerId: string;
    resource: string | "*";
    direction: IOGuardDirection;
    priority?: number;
    /**
     * Sync-only handler. Returns `{ ok: true }` to allow or
     * `{ ok: false, refused: true, … }` to abort. First refusal short-circuits.
     * Use the (separate) async-guard registry for round-trip checks that
     * cannot run synchronously — those run AFTER local commit and rely on
     * `rollbackOnAsyncRefuse` for revert.
     */
    handler: (ctx: IOContext, payload?: unknown) => IOResult;
    label?: string;
}

/**
 * Per-owner bundle hooks. Owners pass these via `initIO(...)` so the
 * pipeline can request a bundle payload during a flush (export) and apply
 * a bundle payload after a read (import).
 */
interface IOOwnerBundleHooks {
    exportBundle?(ctx: IOContext): Promise<unknown> | unknown;
    importBundle?(ctx: IOContext, data: unknown): Promise<void> | void;
}

/**
 * App-level IO config (lives in `ENV.client.io`).
 * Bindings keyed by owner id (plugin/module id) and capability id.
 *
 * Resolution order (highest to lowest):
 *   1. `disabled[ownerId]` set → IO inert
 *   2. `bindings[ownerId][capabilityId]` defined → that exact list
 *   3. include.json `io.defaultBindings[capabilityId]` defined → that list
 *   4. capability kind === `"bundle"` → fallback to `["post-data"]`
 *      (preserves legacy HTML-form session export)
 *   5. capability kind === `"crud"` → `[]` (inert)
 */
interface IOConfigBlock {
    /** Owner ids (or uids) for which IO is fully inert. Highest precedence. */
    disabled?: string[];
    /**
     * Per-(owner, capability) disable. Each tuple is `[ownerId, capabilityId]`
     * (matches by `ownerId` OR `ownerUid`). Resolved at the same precedence
     * as `disabled`: if a tuple matches, `bindingsFor` returns `[]` for that
     * specific (owner, capability). Useful for live-collab scenarios where
     * the session controller wants to silence a single CRUD capability
     * (e.g. `[plugin.annotations, crud:annotation]` for guests during a
     * shared session) without disabling the whole owner. Future-proof slot
     * for the session-aware sync described in src/IO_PIPELINE.md.
     */
    disabledCapabilities?: Array<[string, string]>;
    /** Routing decisions: `{ ownerId: { capabilityId: [sinkId, ...] } }`. */
    bindings?: Record<string, Record<string, string[]>>;
    /**
     * Per-deployment overrides for a sink's options, keyed by sink id.
     * The module that registered the sink decides how to merge this slot
     * with its own defaults (typically inside the sink factory's
     * `getOptions` callback). The pipeline does NOT compose options on the
     * module's behalf — `IO_PIPELINE.sinkOverrides(id)` returns this slot
     * verbatim (or `{}` when missing). Use this for secrets and
     * deployment-specific values (repo URL, baseURL, token, …).
     */
    sinkOverrides?: Record<string, Record<string, unknown>>;
}

/**
 * `io` block in a module/plugin `include.json`.
 *  - `false`     hard-disable IO for this owner (irrespective of admin config).
 *  - `true`      participate; capabilities discovered from runtime calls only.
 *  - object form — declarative capability list + optional default bindings.
 */
type IOIncludeBlock =
    | boolean
    | {
          capabilities?: Array<IOCapability | string>;
          defaultBindings?: Record<string, string[]>;
      };

type IODisposer = () => void;

/**
 * Public shape of the `IO_PIPELINE` singleton (also aliased at
 * `APPLICATION_CONTEXT.io`).
 */
interface IOPipelineLike {
    // ── capability registry ─────────────────────────────────────────────
    registerCapability(ownerUid: string, cap: IOCapability): IODisposer;
    listCapabilities(ownerUid?: string): Array<{ ownerUid: string; capability: IOCapability }>;

    // ── sink registry ───────────────────────────────────────────────────
    registerSink(s: IOSink): IODisposer;
    listSinks(): IOSink[];
    getSink(id: string): IOSink | undefined;

    // ── owner registry (for bundle hooks + ownerId↔uid mapping) ─────────
    registerOwner(
        ownerUid: string,
        info: { ownerId: string; xoType: "core" | "plugin" | "module" } & IOOwnerBundleHooks,
    ): IODisposer;

    // ── binding resolution ──────────────────────────────────────────────
    bindingsFor(ownerUid: string, capabilityId: string): string[];
    isEnabled(ownerUid: string, capabilityId?: string): boolean;
    /**
     * Returns the admin-supplied override slot for a sink, or `{}`. The
     * module that registered the sink is responsible for merging this with
     * its own defaults. The pipeline does not interpret the contents.
     */
    sinkOverrides(sinkId: string): Record<string, unknown>;

    // ── orchestration ───────────────────────────────────────────────────
    flushBundleExport(scope?: { ownerUid?: string; viewerId?: string }): Promise<IOResult[]>;
    importBundle(rawData: unknown, scope?: { ownerUid?: string }): Promise<IOResult[]>;
    dispatch(ctx: IOContext, payload?: unknown): Promise<IOResult>;
    /**
     * Stream raw items from the first bound sink whose `query` method
     * exists and `accepts(ctx)` (if defined) passes. `ctx.direction` is
     * expected to be `"query"`. The pipeline does not deserialize —
     * `IOResource.query` does that. Emits `io:rejected-by-accepts` /
     * `io:fully-refused` to surface misconfigured bindings.
     */
    queryStream(ctx: IOContext, params: unknown): AsyncIterable<unknown>;

    // ── Guards (abortable CRUD pre-action hooks) ────────────────────────
    /** Register a sync guard handler. Returns a Disposer. */
    registerGuard(spec: IOGuardSpec): IODisposer;
    /** Run all matching guards in priority order, synchronously. First
     *  refusal wins; emits `io:refused` on refusal. Returns `{ ok: true }`
     *  if no guards or all passed. */
    runGuards(ctx: IOContext, payload?: unknown): IOResult;
    /** All currently registered guards (for admin/debug UIs). */
    listGuards(): IOGuardSpec[];

    // ── KV (key/value storage) ──────────────────────────────────────────
    registerKVDriver(d: IOKVDriver): IODisposer;
    listKVDrivers(): IOKVDriver[];
    getKVDriver(id: string): IOKVDriver | undefined;
    /**
     * Returns a KV handle for `(ownerUid, capabilityId)`. Throws on
     * sync/async mismatch (sync handle bound to async drivers).
     * `capabilityId` follows the convention `kv:<namespace>` (e.g.
     * `kv:cache`, `kv:cookies`, `kv:data`, `kv:session`).
     */
    kv(ownerUid: string, capabilityId: string, options?: { sync?: boolean }): IOKVHandle;
    /**
     * Sanitize a user-supplied key to the safe charset `[A-Za-z0-9._-]`.
     * Used internally before key prefixing on shared drivers.
     */
    sanitizeKey(s: string): string;

    // ── events: 'io:refused', 'io:conflict' ─────────────────────────────
    addHandler(eventName: string, handler: (e: any) => void): void;
    removeHandler(eventName: string, handler: (e: any) => void): void;
}
