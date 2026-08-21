// Slide-protocol registry. Owns the resolution from a `DataSpecification`
// (or per-entry `protocol` override) to either a URL string or a pre-built
// `OpenSeadragon.TileSource`. Replaces the inline `new Function(...)` eval
// of `env.client.image_group_protocol` / `data_group_protocol` and gives
// plugins a clean extension point (factory protocols, e.g. DICOMWebTileSource).
//
// Singleton, exposed as `window.SLIDE_PROTOCOLS`. Bootstrapped from
// `src/app.ts` adjacent to `bootstrapIOPipeline(...)`.
//
// See src/types/slide-protocols.d.ts for the public type surface and
// src/.claude or the plan file for the full design.

import { BackgroundConfig } from "./background-config";
import { HttpClient } from "./http-client";

const INLINE_JS_HINT = /[`$]/; // backtick or `${` — heuristic for legacy inline template

function looksLikeInlineTemplate(s: string): boolean {
    return typeof s === "string" && INLINE_JS_HINT.test(s);
}

function compileUrlEntry(entry: SlideProtocolUrlTemplateEntry): (data: any) => string {
    // Trust boundary: templates fed here come from registry entries
    // (admin-controlled env.client.*). Inline user overrides via
    // spec.protocol / configEntry.protocol are rejected in resolve() before
    // they reach this function, so new Function() below stays safe.
    // Cache the compiled Function on the entry so we don't `new Function` per tile.
    const cached = (entry as any).__compiled as ((data: any) => string) | undefined;
    if (cached) return cached;

    const fn = entry.legacy
        ? new Function("path,data", "return " + entry.urlTemplate) as (path: any, data: any) => string
        : new Function("data", "return " + entry.urlTemplate) as (data: any) => string;

    const wrapped: (data: any) => string = entry.legacy
        ? (data: any) => (fn as (path: any, data: any) => string)(entry.legacyServer, data)
        : (data: any) => (fn as (data: any) => string)(data);

    (entry as any).__compiled = wrapped;
    return wrapped;
}

function isFactoryEntry(e: SlideProtocolEntry): e is SlideProtocolFactoryEntry {
    return typeof (e as SlideProtocolFactoryEntry).createTileSource === "function";
}

function isTileSourceInstance(value: any): boolean {
    // `instanceof` THROWS when the right-hand side is not callable, and
    // `OpenSeadragon` here is whatever the page installed — a partial stub, a
    // half-initialized global during boot, a vendored build without the symbol.
    // A type probe that can take the caller down is not a probe.
    const TileSource = (globalThis as any).OpenSeadragon?.TileSource;
    return typeof TileSource === "function" && value instanceof TileSource;
}

/** Bare JS identifier — anything else never reaches the namespace lookup. */
const CLASS_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Effective slide source options for a data spec: the per-data-entry `options`
 * merged under the background/visualization entry `options` (the entry wins).
 *
 * Single source of truth: used both by `resolve(...)` (applied to a
 * directly-constructed source *before* its metadata request) and by
 * `configureOpenedItem` in the open pipeline (applied post-open, when the
 * metadata is known and e.g. `channels: "all"` can expand). Both calls must see
 * the same object — that is what makes the double invocation safe.
 */
export function mergeSourceOptions(
    spec: DataSpecification | undefined,
    configEntry: any,
    explicit?: SlideSourceOptions
): SlideSourceOptions | undefined {
    if (explicit) return explicit;
    const fromSpec = spec && typeof spec === "object" ? (spec as DataOverride).options : undefined;
    const fromEntry = configEntry?.options;
    if (!fromSpec && !fromEntry) return undefined;
    return { ...(fromSpec || {}), ...(fromEntry || {}) };
}

export class SlideProtocolRegistry implements SlideProtocolRegistryLike {
    private entries = new Map<SlideProtocolId, SlideProtocolEntry>();
    private defaultBackground: SlideProtocolId | undefined;
    private defaultVisualization: SlideProtocolId | undefined;
    private warnedLegacyBypass = false;
    private warnedLegacyEnv = false;
    /** Roles whose configured default protocol was already reported missing. */
    private warnedMissingDefault = new Set<"background" | "visualization">();
    /** Protocol ids whose `tileSourceClass` lookup already warned (one warning per entry). */
    private warnedClassLookup = new Set<SlideProtocolId>();
    /** Entries declaring `auth` with no transport to bind it to. Warn once each. */
    private warnedClientlessAuth = new Set<SlideProtocolId>();
    /** Per-entry HttpClient cache. Keyed by entry id so factory/url entries share the lookup path. */
    private clients = new Map<SlideProtocolId, HttpClient>();
    /**
     * Longest-first list for URL-based reverse lookup. `ambiguous` marks a prefix
     * claimed by two entries authenticating against DIFFERENT contexts — the URL
     * alone cannot say which credential belongs to it, so the lookup refuses
     * rather than guessing (see `getActiveClientForUrl`).
     */
    private clientPrefixes: Array<{ prefix: string; client: HttpClient; entryId: SlideProtocolId; contextId: string; ambiguous?: boolean }> = [];
    /** Prefixes already reported as ambiguous, and contexts already declared. Warn/declare once each. */
    private warnedAmbiguousPrefix = new Set<string>();
    private declaredAuthContexts = new Set<SlideProtocolId>();
    /** Transient "active" client set by `withActiveClient`. Read by the patched `OpenSeadragon.makeAjaxRequest`. */
    private activeClient: HttpClient | undefined = undefined;

    register(entry: SlideProtocolEntry): () => void {
        if (!entry?.id) throw new Error("[SLIDE_PROTOCOLS] register: missing id");
        if (this.entries.has(entry.id)) {
            throw new Error(`[SLIDE_PROTOCOLS] duplicate protocol id "${entry.id}"`);
        }
        this.entries.set(entry.id, entry);
        return () => this.unregister(entry.id);
    }

    unregister(id: SlideProtocolId): boolean {
        const cur = this.entries.get(id);
        if (!cur) return false;
        this.entries.delete(id);
        if (this.defaultBackground === id) this.defaultBackground = undefined;
        if (this.defaultVisualization === id) this.defaultVisualization = undefined;
        return true;
    }

    get(id: SlideProtocolId): SlideProtocolEntry | undefined {
        return this.entries.get(id);
    }

    has(id: SlideProtocolId): boolean {
        return this.entries.has(id);
    }

    list() {
        const out: Array<{ id: SlideProtocolId; label: string; deprecated: boolean; kind: "url" | "factory" }> = [];
        for (const e of this.entries.values()) {
            out.push({
                id: e.id,
                label: e.label ?? e.id,
                deprecated: !!e.deprecated,
                kind: isFactoryEntry(e) ? "factory" : "url",
            });
        }
        return out;
    }

    getDefaultBackgroundId() { return this._resolveDefault("background", this.defaultBackground); }
    getDefaultVisualizationId() { return this._resolveDefault("visualization", this.defaultVisualization); }

    /**
     * A default may name a protocol that is registered later: env is ingested
     * from `app.ts` before module/plugin scripts run, and those register their
     * own entries (`window.SLIDE_PROTOCOLS.register(...)`). So the id is stored
     * as written and validated on use — warning once, when it is actually needed
     * and still missing.
     */
    private _resolveDefault(role: "background" | "visualization", id: SlideProtocolId | undefined) {
        if (id === undefined || this.entries.has(id)) return id;
        if (!this.warnedMissingDefault.has(role)) {
            this.warnedMissingDefault.add(role);
            console.warn(`[SLIDE_PROTOCOLS] default ${role} protocol "${id}" is not registered.`);
        }
        return undefined;
    }

    setDefault(role: "background" | "visualization", id: SlideProtocolId | undefined) {
        if (role === "background") this.defaultBackground = id;
        else this.defaultVisualization = id;
        this.warnedMissingDefault.delete(role);
    }

    /**
     * Lazily construct and cache the HttpClient for an entry that declares
     * `httpClient` options. Returns undefined when an entry has no client
     * options.
     */
    private _clientFor(entry: SlideProtocolEntry): HttpClient | undefined {
        const cached = this.clients.get(entry.id);
        if (cached) return cached;
        const opts = entry.httpClient;
        if (!opts) return undefined;
        if (!opts.proxy && !opts.baseURL) {
            // Without a transport there is no client to stamp onto the tile
            // source, so it falls back to a bare `fetch` — silently dropping the
            // declared credentials. Say so instead of 401-ing mysteriously.
            if (opts.auth && !this.warnedClientlessAuth.has(entry.id)) {
                this.warnedClientlessAuth.add(entry.id);
                console.warn(
                    `[SLIDE_PROTOCOLS] protocol "${entry.id}" declares an \`auth\` block but neither ` +
                    `\`proxy\` nor \`baseURL\`, so no HttpClient can be bound — its metadata and tile requests ` +
                    `will be sent UNAUTHENTICATED. Add \`baseURL\` (the upstream origin) or \`proxy\` (a server alias).`
                );
            }
            return undefined;
        }
        this._declareAuthContext(entry);
        try {
            const client = new HttpClient({ ...opts });
            this.clients.set(entry.id, client);
            this._indexClientPrefix(entry, client, opts.auth?.contextId || "core");
            return client;
        } catch (e) {
            console.warn(`[SLIDE_PROTOCOLS] failed to construct HttpClient for protocol "${entry.id}":`, e);
            return undefined;
        }
    }

    /**
     * Add a client to the baseURL-prefix index, flagging a collision between two
     * entries that authenticate differently.
     *
     * A deployment streaming from two upstreams with two credentials declares one
     * entry per context; if they share a proxy alias or origin, their clients have
     * the SAME baseURL. `resolve()` hands the right client to its caller, so the
     * prefix index only ever serves sources built outside that path — and there,
     * handing back the wrong context's token would send a credential to a slide the
     * operator did not bind it to. Mark it and refuse instead.
     */
    private _indexClientPrefix(entry: SlideProtocolEntry, client: HttpClient, contextId: string): void {
        const prefix = (client.baseURL || "").replace(/\/+$/, "");
        const collision = this.clientPrefixes.find(p => p.prefix === prefix && p.contextId !== contextId);
        const row = { prefix, client, entryId: entry.id, contextId, ambiguous: !!collision };
        if (collision) {
            collision.ambiguous = true;
            if (!this.warnedAmbiguousPrefix.has(prefix)) {
                this.warnedAmbiguousPrefix.add(prefix);
                console.warn(
                    `[SLIDE_PROTOCOLS] protocols "${collision.entryId}" (context '${collision.contextId}') and ` +
                    `"${entry.id}" (context '${contextId}') share the base URL "${prefix}", so a URL alone no longer ` +
                    `identifies which credential belongs to it. Sources built through SLIDE_PROTOCOLS.resolve() are ` +
                    `unaffected (the client travels with the result); anything relying on getActiveClientForUrl() for ` +
                    `this prefix will now get NO client rather than the wrong one — pass the resolved client explicitly, ` +
                    `or ask for it by id via getClientForProtocol().`
                );
            }
        }
        this.clientPrefixes.push(row);
        // Longest prefix first so `getActiveClientForUrl` picks the most specific match.
        this.clientPrefixes.sort((a, b) => b.prefix.length - a.prefix.length);
    }

    /**
     * Declare the auth context an ENV entry requires. Deployment-trusted (the entry
     * comes from `env.client.slide_protocols`), so it can register the requirement:
     * an unclaimed context is then reported by the broker instead of surfacing as a
     * mysterious 401 on the first tile.
     */
    private _declareAuthContext(entry: SlideProtocolEntry): void {
        if (!entry.httpClient?.auth?.required || this.declaredAuthContexts.has(entry.id)) return;
        const auth = (globalThis as any).APPLICATION_CONTEXT?.auth;
        // Before APPLICATION_CONTEXT exists there is nothing to declare into; the
        // later `declareAuthContexts()` sweep (and `_clientFor`) retries.
        if (!auth?.requireContext) return;
        this.declaredAuthContexts.add(entry.id);
        try {
            auth.requireContext({
                // An omitted contextId is the main identity, same as XOpatUser.
                contextId: entry.httpClient.auth.contextId || "core",
                serviceName: entry.label ?? entry.id,
                requiresLogin: true,
            });
        } catch (e) {
            console.warn(`[SLIDE_PROTOCOLS] requireContext for protocol "${entry.id}" failed:`, e);
        }
    }

    /**
     * Declare the auth contexts of EVERY registered entry that requires one.
     *
     * Called once the auth broker exists (`before-app-init`). Without it the
     * declaration happens lazily, when a slide from that entry is first opened —
     * so a deployment with two credentialed upstreams never reports the second
     * context as unclaimed until someone happens to open a slide from it. Declaring
     * does not start a login; it only registers the requirement.
     */
    declareAuthContexts(): void {
        for (const entry of this.entries.values()) this._declareAuthContext(entry);
    }

    optionsFor(spec: DataSpecification | undefined, configEntry: any): SlideSourceOptions | undefined {
        return mergeSourceOptions(spec, configEntry);
    }

    /**
     * Resolve `entry.tileSourceClass` to a constructor, degrading closed.
     *
     * Lookup only — an own property of the global `OpenSeadragon`, never eval
     * and never a dotted path, so `__proto__` / `constructor` / `toString` are
     * unreachable. The class must subclass `OpenSeadragon.TileSource` and
     * declare `static xopatSelfConfiguring` (see `src/tile-source.ts`): a class
     * without it re-enters `determineType` from its inherited `getImageInfo`
     * and configures a *second* instance, silently discarding the options we
     * pre-applied — exactly the bug this feature exists to fix.
     *
     * Deliberately lazy (resolved per open, not at bootstrap): the registry is
     * created in `src/app.ts` before modules are loaded, so the class usually
     * does not exist yet at ingest time.
     */
    private _tileSourceClassFor(entry: SlideProtocolUrlTemplateEntry): any | undefined {
        const name = entry.tileSourceClass;
        if (!name) return undefined;
        // Resolution runs per slide open; warn once per entry so a misconfigured
        // deployment doesn't spam the console on every viewer refresh.
        const warn = (why: string) => {
            if (this.warnedClassLookup.has(entry.id)) return;
            this.warnedClassLookup.add(entry.id);
            console.warn(`[SLIDE_PROTOCOLS] protocol "${entry.id}": tileSourceClass "${name}" ${why}; ` +
                `falling back to URL autodetection.`);
        };

        if (!CLASS_NAME_RE.test(name)) {
            warn("is not a plain class identifier");
            return undefined;
        }
        const OSD = (globalThis as any).OpenSeadragon;
        if (!OSD || !Object.prototype.hasOwnProperty.call(OSD, name)) {
            warn("is not present in the OpenSeadragon namespace (is the module providing it loaded?)");
            return undefined;
        }
        const Cls = OSD[name];
        if (typeof Cls !== "function" || !(Cls.prototype instanceof OSD.TileSource)) {
            warn("is not an OpenSeadragon.TileSource subclass");
            return undefined;
        }
        if (!Cls.xopatSelfConfiguring) {
            warn("does not declare `static xopatSelfConfiguring` and cannot be constructed directly");
            return undefined;
        }
        return Cls;
    }

    /**
     * Await readiness of an already-constructed TileSource (registry- or
     * factory-built). Mirrors OSD's internal `waitUntilReady`, plus the
     * `__xopatOpenFailure` check: such a source begins fetching at construction
     * time, so an `open-failed` can fire before anyone subscribes and OSD's
     * version would then never settle.
     */
    async awaitSourceReady(source: any): Promise<any> {
        if (!source) throw new Error("[SLIDE_PROTOCOLS] awaitSourceReady: no source given");
        if (source.ready) return source;
        if (source.__xopatOpenFailure) throw new Error(source.__xopatOpenFailure);
        // No event surface: it is neither ready nor able to ever tell us it is.
        // Fail here rather than construct a promise nothing can settle — a
        // factory returning a bare object would otherwise hang the whole open.
        if (typeof source.addHandler !== "function") {
            throw new Error("[SLIDE_PROTOCOLS] awaitSourceReady: source is not ready and raises no " +
                "events — a protocol factory must return a TileSource (or something ready).");
        }
        return new Promise((resolve, reject) => {
            source.addHandler("ready", (e: any) => resolve(e?.tileSource ?? source));
            source.addHandler("open-failed", (e: any) =>
                reject(new Error(this._failureMessage(e))));
        });
    }

    /**
     * Record an `open-failed` that may fire before the open pipeline subscribes.
     *
     * A prebuilt TileSource starts fetching its metadata at construction time,
     * but `awaitSourceReady` is awaited much later — after `before-open` and
     * every preceding slot's own fetch. OSD's `raiseEvent` has no replay, and a
     * failed source never sets `ready`, so an event that fires in that window is
     * lost and the open promise never settles: a 404 becomes an endless spinner
     * instead of a placeholder. Latching it here is what lets `awaitSourceReady`
     * turn it back into a rejection.
     *
     * Must be applied to EVERY path that returns an already-constructed source.
     */
    private _latchOpenFailure(ts: any): void {
        // A factory may hand back a plain object with no event surface, and an
        // already-ready source has nothing left to fail.
        if (!ts || ts.ready || typeof ts.addHandler !== "function") return;
        ts.addHandler("open-failed", (e: any) => {
            ts.__xopatOpenFailure = this._failureMessage(e);
        });
    }

    private _failureMessage(e: any): string {
        const m = e?.message;
        if (!m) return "TileSource failed to open";
        return typeof m === "string" ? m : (m.message || String(m));
    }

    getClientForProtocol(id: SlideProtocolId): HttpClient | undefined {
        const entry = this.entries.get(id);
        return entry ? this._clientFor(entry) : undefined;
    }

    getActiveClientForUrl(url: string): HttpClient | undefined {
        if (this.activeClient) return this.activeClient;
        if (!url) return undefined;
        // Normalize relative URLs to absolute against the viewer origin so
        // prefix matching against `client.baseURL` (which is absolute) works
        // for TileSources that emit relative tile URLs.
        let absolute = url;
        if (!/^https?:\/\//i.test(url)) {
            try { absolute = new URL(url, window.location.href).href; }
            catch { /* malformed URL — keep original, prefix match will simply miss */ }
        }
        for (const { prefix, client, ambiguous } of this.clientPrefixes) {
            if (!prefix || !absolute.startsWith(prefix)) continue;
            // Two entries, two contexts, one base URL: the URL does not say which
            // credential is the right one. Degrade to unauthenticated (a 401 the
            // caller can act on) rather than send the other context's token.
            return ambiguous ? undefined : client;
        }
        return undefined;
    }

    async withActiveClient<T>(client: HttpClient | undefined, fn: () => T | Promise<T>): Promise<T> {
        if (!client) return await fn();
        const prev = this.activeClient;
        this.activeClient = client;
        try {
            return await fn();
        } finally {
            this.activeClient = prev;
        }
    }

    resolveBackground(args: SlideProtocolResolveArgs): ResolvedSlideProtocol {
        return this.resolve({ ...args, role: "background" });
    }

    resolveVisualization(args: SlideProtocolResolveArgs): ResolvedSlideProtocol {
        return this.resolve({ ...args, role: "visualization" });
    }

    /**
     * Which registered protocol *would* handle this spec, without building anything.
     *
     * `resolve()` cannot answer an ownership question: for a factory entry it calls
     * `entry.createTileSource(ctx)`, so a module asking "is this background mine?"
     * would construct a foreign protocol's tile source as a side effect — issuing its
     * requests, and then throwing it away. This runs the selection half only, which is
     * pure.
     *
     * Diagnostics are suppressed here on purpose: an ownership probe runs for every
     * background, often several times, and would otherwise repeat warnings that
     * `resolve()` emits properly at the moment the source is actually built.
     *
     * @param args same shape as `resolve()`; `options` is ignored
     * @return the protocol id, `"__inline_tile_source"` for the deprecated inline
     *      bypass, or undefined when nothing resolves — where `resolve()` throws. A
     *      caller asking about ownership wants an answer, not an exception.
     */
    protocolIdFor(args: SlideProtocolResolveArgs & { role: "background" | "visualization" }): SlideProtocolId | undefined {
        const { spec } = args;
        if (spec && typeof spec === "object" && isTileSourceInstance((spec as DataOverride).tileSource)) {
            return "__inline_tile_source";
        }
        return this._selectEntry(args, true)?.id;
    }

    /**
     * The registry entry a spec selects: per-entry override first, configured default
     * second. Shared by `resolve()` and {@link protocolIdFor} so the two can never
     * disagree about who owns a slide.
     *
     * @param quiet suppress warnings and return undefined instead of throwing
     */
    private _selectEntry(
        args: SlideProtocolResolveArgs & { role: "background" | "visualization" },
        quiet = false
    ): SlideProtocolEntry | undefined {
        const { spec, role } = args;
        const isObjectSpec = spec && typeof spec === "object";
        const configEntry = role === "background" ? args.bgEntry : args.vizEntry;
        const protoOverride: string | undefined =
            (isObjectSpec ? (spec as DataOverride).protocol : undefined)
            ?? configEntry?.protocol;

        if (protoOverride) {
            if (this.entries.has(protoOverride)) {
                return this.entries.get(protoOverride);
            }
            if (!quiet) {
                if (looksLikeInlineTemplate(protoOverride)) {
                    // Inline JS-style templates supplied via spec/configEntry are
                    // user-influenced and were previously fed to new Function(),
                    // which is an RCE sink. Registered protocols only.
                    console.warn(
                        `[SLIDE_PROTOCOLS] rejected inline protocol override; only registered protocol ids are accepted ` +
                        `(value: ${JSON.stringify(protoOverride)}); falling back to default.`
                    );
                } else {
                    console.warn(
                        `[SLIDE_PROTOCOLS] unknown protocol "${protoOverride}"; falling back to default.`
                    );
                }
            }
        }

        const defaultId = role === "background" ? this.defaultBackground : this.defaultVisualization;
        if (!defaultId) {
            if (quiet) return undefined;
            throw new Error(
                `[SLIDE_PROTOCOLS] no protocol resolvable for role "${role}" — neither override nor default available.`
            );
        }
        const entry = this.entries.get(defaultId);
        if (!entry && !quiet) {
            // Defaults are validated on use, not on `setDefault`, because a
            // module or plugin may register the entry after env ingestion.
            throw new Error(
                `[SLIDE_PROTOCOLS] default protocol "${defaultId}" for role "${role}" is not registered — ` +
                "check the env `slide_protocols` entry, or whether the module/plugin providing it is loaded."
            );
        }
        return entry;
    }

    resolve(args: SlideProtocolResolveArgs & { role: "background" | "visualization" }): ResolvedSlideProtocol {
        const { spec, role } = args;
        const isObjectSpec = spec && typeof spec === "object";

        // 1. Deprecated TileSource short-circuit.
        if (isObjectSpec && isTileSourceInstance((spec as DataOverride).tileSource)) {
            if (!this.warnedLegacyBypass) {
                this.warnedLegacyBypass = true;
                console.warn(
                    "[SLIDE_PROTOCOLS] DataOverride.tileSource bypass is deprecated; " +
                    "plugins should register a factory protocol via SLIDE_PROTOCOLS.register({ id, createTileSource }) " +
                    "and reference it via `protocol: '<id>'` instead."
                );
            }
            // Same exposure as a factory entry, through a different door: the
            // caller built this source, so it may already be fetching.
            this._latchOpenFailure((spec as DataOverride).tileSource);
            return {
                kind: "tileSource",
                tileSource: (spec as DataOverride).tileSource,
                protocolId: "__inline_tile_source",
            };
        }

        // 2/3. Per-entry override, then the configured default. Throws when neither
        // resolves — see `_selectEntry`.
        const configEntry = role === "background" ? args.bgEntry : args.vizEntry;
        const entry = this._selectEntry(args) as SlideProtocolEntry;

        // 4. Eval / factory.
        const dataID = BackgroundConfig.dataFromSpec(spec) as DataID;
        const client = this._clientFor(entry);
        const ctx: SlideProtocolResolveContext = {
            dataID,
            spec,
            bgEntry: args.bgEntry,
            vizEntry: args.vizEntry,
            role,
            options: mergeSourceOptions(spec, configEntry, args.options),
            httpClient: client,
        };

        if (isFactoryEntry(entry)) {
            const ts = entry.createTileSource(ctx);
            // Safety net: factories may forget to stamp the client; we do it for them.
            if (client && ts && !(ts as any).__xopatHttpClient) {
                (ts as any).__xopatHttpClient = client;
            }
            // Factory sources typically start fetching in their constructor (see
            // DICOMWebTileSource), so they can fail before anyone subscribes.
            this._latchOpenFailure(ts);
            this._applyPreMetadataOptions(ts, ctx.options, entry.id);
            return { kind: "tileSource", tileSource: ts, protocolId: entry.id, client };
        }

        const urlEntry = entry as SlideProtocolUrlTemplateEntry;
        const compile = compileUrlEntry(urlEntry);
        const data = urlEntry.legacy && urlEntry.legacyArrayData ? [dataID] : dataID;
        const rendered = compile(data);
        // Relative URLs from the template are joined onto the proxy baseURL.
        // Absolute URLs (http(s)://…) are returned verbatim; the client matches
        // them via `getActiveClientForUrl` if its baseURL is a prefix.
        const url = client ? client.resolveUrl(rendered) : rendered;

        // Explicit class selection: build the real source now instead of letting
        // OSD fetch the metadata with a generic TileSource and autodetect from
        // the response. Everything below up to the `return` is SYNCHRONOUS, and
        // the OSD base constructor only *schedules* `getImageInfo` via
        // `setTimeout` — so the options provably land before the metadata
        // request is issued.
        const Cls = this._tileSourceClassFor(urlEntry);
        if (Cls) {
            try {
                const ts = new Cls({ ...(urlEntry.tileSourceOptions || {}), url, tileSourceId: url });
                // Stamp before anything can fetch, so the metadata request routes
                // through the proxy/auth pipeline too.
                if (client) ts.__xopatHttpClient = client;
                // The fetch is already scheduled; record a failure that may fire
                // before the open pipeline gets to subscribe (see awaitSourceReady).
                this._latchOpenFailure(ts);
                this._applyPreMetadataOptions(ts, ctx.options, entry.id);
                return { kind: "tileSource", tileSource: ts, protocolId: entry.id, client };
            } catch (e) {
                console.warn(
                    `[SLIDE_PROTOCOLS] protocol "${entry.id}": direct construction of ` +
                    `"${urlEntry.tileSourceClass}" failed; falling back to URL autodetection.`, e);
            }
        }
        // `client` rides along: the auth context belongs to the ENTRY, and a
        // rendered URL cannot carry it back — two entries on the same upstream
        // with different `auth.contextId` produce the same baseURL prefix.
        return { kind: "url", url, protocolId: entry.id, client };
    }

    /**
     * Apply source options to a source the registry (or a factory) just built,
     * before its metadata request resolves. Never fatal: a throwing
     * `setSourceOptions` must not abort the slide open — the post-open call in
     * `configureOpenedItem` gets another chance with the same object.
     */
    private _applyPreMetadataOptions(ts: any, options: SlideSourceOptions | undefined, protocolId: SlideProtocolId) {
        if (!ts || !options || typeof ts.setSourceOptions !== "function") return;
        try {
            ts.setSourceOptions(options);
        } catch (e) {
            console.warn(`[SLIDE_PROTOCOLS] protocol "${protocolId}": setSourceOptions failed`, e);
        }
    }

    ingestFromEnv(envClient: any): void {
        if (!envClient) return;

        // 1. New-shape entries (admin-controlled). Each entry is either a string
        //    (URL template only) or an object `{ url, ...httpClientOptions }`.
        const newMap = envClient.slide_protocols as Record<string, string | SlideProtocolEnvEntry> | undefined;
        if (newMap && typeof newMap === "object") {
            for (const [id, value] of Object.entries(newMap)) {
                if (this.entries.has(id)) continue;
                if (typeof value === "string") {
                    this.register({ id, label: id, urlTemplate: value, legacy: false });
                } else if (value && typeof value === "object" && typeof value.url === "string") {
                    // Every key that is NOT explicitly pulled out here lands in the
                    // per-protocol HttpClient options — keep this destructure in sync
                    // with `SlideProtocolEnvEntry`.
                    const { url, tileSourceClass, tileSourceOptions, ...clientOpts } = value;
                    this.register({
                        id,
                        label: id,
                        urlTemplate: url,
                        legacy: false,
                        tileSourceClass,
                        tileSourceOptions,
                        httpClient: clientOpts,
                    });
                } else {
                    console.warn(`[SLIDE_PROTOCOLS] ignoring malformed slide_protocols entry "${id}":`, value);
                }
            }
        }

        // 2. Synthesize from legacy fields.
        let synthBg = false;
        let synthViz = false;
        if (envClient.image_group_protocol && !this.has("__legacy_bg")) {
            this.register({
                id: "__legacy_bg",
                label: "Legacy image_group_protocol",
                urlTemplate: envClient.image_group_protocol,
                legacy: true,
                legacyServer: envClient.image_group_server,
                deprecated: true,
            });
            synthBg = true;
        }
        if (envClient.data_group_protocol && !this.has("__legacy_viz")) {
            this.register({
                id: "__legacy_viz",
                label: "Legacy data_group_protocol",
                urlTemplate: envClient.data_group_protocol,
                legacy: true,
                legacyServer: envClient.data_group_server,
                legacyArrayData: true,
                deprecated: true,
            });
            synthViz = true;
        }

        // 3. Defaults.
        const firstNewKey = newMap ? Object.keys(newMap)[0] : undefined;
        const bgDefault = envClient.default_background_protocol
            ?? (synthBg ? "__legacy_bg" : firstNewKey);
        const vizDefault = envClient.default_visualization_protocol
            ?? (synthViz ? "__legacy_viz" : firstNewKey ?? bgDefault);

        if (bgDefault) this.setDefault("background", bgDefault);
        if (vizDefault) this.setDefault("visualization", vizDefault);

        // 4. One-shot deprecation warning.
        if ((synthBg || synthViz) && !this.warnedLegacyEnv) {
            this.warnedLegacyEnv = true;
            console.warn(
                "[SLIDE_PROTOCOLS] env.client uses legacy image_group_protocol/data_group_protocol; " +
                "synthesizing __legacy_bg / __legacy_viz entries. Please migrate to slide_protocols + " +
                "default_background_protocol / default_visualization_protocol."
            );
        }

        // 5. A custom URL scheme on the legacy *_group_server keys (e.g.
        //    "xo.module://empation-api") is INERT in v3: the resolver that
        //    understood it was removed with modules/empation-api, and nothing
        //    parses it now. The string still reaches the `get-preview-url` event
        //    and the session fingerprint, so it looks configured while resolving
        //    to nothing — worth one warning rather than a silent no-op.
        this.warnUnparseableServerScheme("image_group_server", envClient.image_group_server);
        this.warnUnparseableServerScheme("data_group_server", envClient.data_group_server);
    }

    private warnedServerSchemes = new Set<string>();

    /** Warn once per key when a legacy server value uses a scheme nothing resolves. */
    private warnUnparseableServerScheme(key: string, value: unknown): void {
        if (typeof value !== "string") return;
        const scheme = /^([a-z][a-z0-9.+-]*):\/\//i.exec(value)?.[1]?.toLowerCase();
        if (!scheme || ["http", "https", "file", "data", "blob"].includes(scheme)) return;
        if (this.warnedServerSchemes.has(key)) return;
        this.warnedServerSchemes.add(key);
        console.warn(
            `[SLIDE_PROTOCOLS] env.client.${key} uses the '${scheme}://' scheme, which no protocol ` +
            `resolver handles in this version — the value is inert. Declare the source under ` +
            `client.slide_protocols (object form supports tileSourceClass + HttpClient options) and ` +
            `point default_background_protocol / default_visualization_protocol at it instead.`
        );
    }
}

/**
 * Create the registry, ingest env, attach to `window.SLIDE_PROTOCOLS`. Mirrors
 * `bootstrapIOPipeline` in `src/classes/io/bootstrap.ts`.
 */
export function bootstrapSlideProtocols(ENV: XOpatCoreConfig): SlideProtocolRegistry {
    const registry = new SlideProtocolRegistry();
    registry.ingestFromEnv((ENV as any)?.client);
    (window as any).SLIDE_PROTOCOLS = registry;
    return registry;
}
