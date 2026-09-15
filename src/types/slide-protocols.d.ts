// ── Ambient types for the slide-protocol registry (window.SLIDE_PROTOCOLS) ───
// No export{} here: these types are visible in all files like the other
// `src/types/*.d.ts` ambients (e.g. app.d.ts).

type SlideProtocolId = string;

/**
 * HttpClient options forwarded into `new HttpClient(...)` when a slide
 * protocol declares one. When present, the registry constructs (and caches)
 * one client per protocol; every request issued by that protocol's TileSource
 * (initial metadata + tiles) flows through it — gaining proxy routing,
 * CSRF injection, and JWT/auth headers uniformly. Shape mirrors
 * `HttpClientOptions` in `src/classes/http-client.ts` (a subset suitable for
 * serializable env configuration — no `handlers`).
 */
interface SlideProtocolHttpClientOptions {
    /** Proxy alias declared under `server.secure.proxies`. */
    proxy?: string;
    /** Extra base-URL segment appended after the `/proxy/<alias>` prefix (or used standalone). */
    baseURL?: string;
    timeoutMs?: number;
    maxRetries?: number;
    auth?: {
        contextId?: string;
        /** Omit to follow the auth module owning `contextId` (recommended). */
        types?: string[];
        refreshOn401?: boolean;
        /**
         * Statuses treated as "credential missing or rejected" for that refresh.
         * @default [401]
         *
         * Widen only for an upstream that reports a MISSING credential with
         * something else (FastAPI's bearer scheme answers 403).
         */
        refreshOnStatuses?: number[];
        /**
         * Warn when no credential is available at request time, and — unless
         * `awaitContext` says otherwise — hold requests until the context has
         * finished authenticating, so the boot burst does not race the login.
         */
        required?: boolean;
        /** Override the wait implied by `required`. @default required */
        awaitContext?: boolean;
        /** Bound on that wait, in ms. @default 8000 */
        awaitContextTimeoutMs?: number;
    };
    headers?: Record<string, string>;
}

/**
 * Env-side shape of an object-form `slide_protocols.<name>` entry. The `url`
 * field carries the same backtick template as the string form;
 * `tileSourceClass` / `tileSourceOptions` select a TileSource class explicitly
 * (see {@link SlideProtocolUrlTemplateEntry}); **all remaining fields** are
 * forwarded verbatim to a per-protocol `HttpClient`.
 */
interface SlideProtocolEnvEntry extends SlideProtocolHttpClientOptions {
    url: string;
    /** @see SlideProtocolUrlTemplateEntry.tileSourceClass */
    tileSourceClass?: string;
    /** @see SlideProtocolUrlTemplateEntry.tileSourceOptions */
    tileSourceOptions?: Record<string, unknown>;
}

/**
 * Context passed into protocol resolution (URL-template eval or factory call).
 * `dataID` is the result of `BackgroundConfig.dataFromSpec(spec)`. For factory
 * entries it's the only thing the factory needs in most cases — the DICOM
 * factory, for instance, reads `{ studyUID, seriesUID }` from `dataID`.
 */
interface SlideProtocolResolveContext {
    dataID: DataID;
    spec: DataSpecification | undefined;
    bgEntry?: BackgroundItem;
    vizEntry?: VisualizationItem;
    role: "background" | "visualization";
    /**
     * Effective slide source options for this spec — always populated by the
     * registry as `{...spec.options, ...configEntry.options}` (the background /
     * visualization entry wins), unless the caller passed an explicit override
     * via `SlideProtocolResolveArgs.options`. Identical to what
     * `configureOpenedItem` later hands to `setSourceOptions` post-open.
     *
     * For factory entries and for URL entries naming a `tileSourceClass`, the
     * registry applies these to the constructed source **before** its metadata
     * request is issued (see `SLIDE_PROTOCOLS.optionsFor`).
     */
    options?: SlideSourceOptions;
    /**
     * Per-protocol HttpClient resolved from the entry's `httpClient` options,
     * if any. Factory entries that construct their own TileSource should stamp
     * this onto the resulting instance (`tileSource.__xopatHttpClient = ctx.httpClient`)
     * so OSD's metadata fetch and the patched `downloadTileStart` both route
     * through the proxy/auth pipeline. The registry stamps it automatically
     * as a safety net.
     */
    httpClient?: any /* HttpClient */;
}

/**
 * URL-template entry. New entries (declared under `env.client.slide_protocols`)
 * have `legacy=false` and a `(data) => string` signature — `data` is the scalar
 * `DataID`. Auto-synthesized `__legacy_bg` / `__legacy_viz` entries (from the
 * deprecated `image_group_*` / `data_group_*` env keys) have `legacy=true` and
 * a `(path, data) => string` signature, with `path` being the legacy
 * `*_server` value. `__legacy_viz` additionally sets `legacyArrayData=true`
 * to keep the legacy `data.join(",")` template contract working.
 */
interface SlideProtocolUrlTemplateEntry {
    id: SlideProtocolId;
    label?: string;
    urlTemplate: string;
    legacy?: boolean;
    legacyServer?: string;
    legacyArrayData?: boolean;
    supports?: (ctx: SlideProtocolResolveContext) => boolean;
    deprecated?: boolean;
    /**
     * Optional HttpClient configuration. When present, all requests issued by
     * TileSources resolved through this entry (metadata + tiles) route through
     * a per-entry `HttpClient` constructed from these options. The rendered
     * `urlTemplate` result is joined onto the client's `baseURL` when relative.
     */
    httpClient?: SlideProtocolHttpClientOptions;
    /**
     * Name of a TileSource class to construct **directly** from the rendered
     * URL, skipping OpenSeadragon's `TileSource.determineType` autodetection.
     *
     * Why: autodetection fetches the slide metadata with a *generic*
     * `OpenSeadragon.TileSource` first and only then picks a class from the
     * response — so the class never sees (nor can shape) its own info request,
     * and per-slide `options` cannot reach it in time. Naming the class here
     * lets the registry build the real source up-front and apply
     * `setSourceOptions(ctx.options)` synchronously, before the metadata fetch.
     *
     * Resolution is a plain own-property lookup on the global `OpenSeadragon`
     * namespace (no eval, no dotted paths). The class must subclass
     * `OpenSeadragon.TileSource` and declare `static xopatSelfConfiguring = true`
     * — see the contract in `src/tile-source.ts`. Anything else logs a warning
     * and degrades to the normal URL/autodetect path.
     *
     * **Operator-only.** This is declared on the protocol entry
     * (`ENV.client.slide_protocols`), never on a `DataOverride` / session
     * bundle: sessions are third-party controllable and must not be able to
     * choose which code runs (AGENTS.md §7). A session selects behaviour by
     * naming a registered protocol id via `protocol: "<id>"`.
     */
    tileSourceClass?: string;
    /**
     * Extra constructor options merged under `{url}` when `tileSourceClass` is
     * used (e.g. a `type` discriminator a source expects). Operator-only, same
     * trust reasoning as `tileSourceClass`.
     */
    tileSourceOptions?: Record<string, unknown>;
}

/**
 * Factory entry. Used by plugins that need to construct a `TileSource`
 * directly (e.g. DICOMWebTileSource). Synchronous — async setup must complete
 * before the plugin calls `register()`.
 */
interface SlideProtocolFactoryEntry {
    id: SlideProtocolId;
    label?: string;
    createTileSource: (ctx: SlideProtocolResolveContext) => any /* OpenSeadragon.TileSource */;
    supports?: (ctx: SlideProtocolResolveContext) => boolean;
    deprecated?: boolean;
    /**
     * Optional HttpClient configuration. When present, the factory receives
     * the constructed client via `ctx.httpClient` and the registry stamps it
     * onto the returned TileSource so OSD's metadata + tile paths flow through
     * the proxy/auth pipeline.
     */
    httpClient?: SlideProtocolHttpClientOptions;
}

type SlideProtocolEntry = SlideProtocolUrlTemplateEntry | SlideProtocolFactoryEntry;

/**
 * `client` is the per-entry `HttpClient` (undefined when the entry declares no
 * transport). It is part of the result on purpose: the auth context is bound to
 * the *protocol entry*, and a rendered URL cannot carry that binding back. Two
 * entries pointing at the same upstream with different `auth.contextId` render
 * indistinguishable URLs, so recovering the client by baseURL prefix
 * (`getActiveClientForUrl`) would pick one at random. Callers must pass this
 * along to whatever instantiates the source; the prefix lookup is a fallback
 * for sources that never went through `resolve`.
 */
type ResolvedSlideProtocol =
    | { kind: "url"; url: string; protocolId: SlideProtocolId; client?: any /* HttpClient */ }
    | { kind: "tileSource"; tileSource: any /* OpenSeadragon.TileSource */; protocolId: SlideProtocolId; client?: any /* HttpClient */ };

interface SlideProtocolResolveArgs {
    spec: DataSpecification | undefined;
    bgEntry?: BackgroundItem;
    vizEntry?: VisualizationItem;
    /** Currently advisory — inline templates are rejected unconditionally. */
    isSecureMode: boolean;
    /**
     * Optional override of the effective source options. Callers normally omit
     * it: the registry derives them from `spec` + `bgEntry`/`vizEntry`, which
     * every call site already passes.
     */
    options?: SlideSourceOptions;
}

interface SlideProtocolRegistryLike {
    register(entry: SlideProtocolEntry): () => void;
    unregister(id: SlideProtocolId): boolean;
    get(id: SlideProtocolId): SlideProtocolEntry | undefined;
    has(id: SlideProtocolId): boolean;
    list(): ReadonlyArray<{ id: SlideProtocolId; label: string; deprecated: boolean; kind: "url" | "factory" }>;
    getDefaultBackgroundId(): SlideProtocolId | undefined;
    getDefaultVisualizationId(): SlideProtocolId | undefined;
    setDefault(role: "background" | "visualization", id: SlideProtocolId | undefined): void;
    resolveBackground(args: SlideProtocolResolveArgs): ResolvedSlideProtocol;
    resolveVisualization(args: SlideProtocolResolveArgs): ResolvedSlideProtocol;
    resolve(args: SlideProtocolResolveArgs & { role: "background" | "visualization" }): ResolvedSlideProtocol;
    /**
     * Which registered protocol *would* handle this spec, without building anything.
     *
     * Use this — never `resolve(...)` — to ask an ownership question ("is this
     * background served by my protocol?"). `resolve` calls `createTileSource` for
     * factory entries, so probing with it constructs a foreign protocol's source as a
     * side effect. Returns `"__inline_tile_source"` for the deprecated
     * `DataOverride.tileSource` bypass, and `undefined` where `resolve` would throw.
     * Emits no diagnostics: a probe runs for every background, repeatedly.
     */
    protocolIdFor(args: SlideProtocolResolveArgs & { role: "background" | "visualization" }): SlideProtocolId | undefined;
    ingestFromEnv(envClient: any): void;
    /**
     * Effective source options for a data spec: `{...spec.options, ...configEntry.options}`
     * (background / visualization entry wins). Single source of truth shared by
     * the pre-metadata call inside `resolve(...)` and the post-open call in
     * `configureOpenedItem`, so a source always sees the same object twice.
     */
    optionsFor(spec: DataSpecification | undefined, configEntry: any): SlideSourceOptions | undefined;
    /**
     * Await readiness of a TileSource the registry (or a factory protocol)
     * already constructed. Equivalent to OSD's internal `waitUntilReady`, plus
     * a check for an `open-failed` that fired *before* we subscribed — such a
     * source starts fetching at construction, so OSD's version can hang forever.
     */
    awaitSourceReady(source: any): Promise<any>;
    /** Lazily-built HttpClient for a registered protocol (or undefined if it has no `httpClient` options). */
    getClientForProtocol(id: SlideProtocolId): any /* HttpClient */ | undefined;
    /**
     * Longest-prefix match against built HttpClients' baseURLs. Used by the patched
     * `OpenSeadragon.makeAjaxRequest` to route per-protocol fetches that aren't wrapped
     * in `withActiveClient`.
     *
     * FALLBACK ONLY — prefer the `client` on the `resolve(...)` result. When two entries
     * with different auth contexts share a base URL the prefix is ambiguous and this
     * returns `undefined` (once warned) instead of guessing a credential.
     */
    getActiveClientForUrl(url: string): any /* HttpClient */ | undefined;
    /** Declare the auth context of every entry that requires one (no login is started). Called once the auth broker exists. */
    declareAuthContexts(): void;
    /** Sets the "active" HttpClient for the duration of `fn` (a sync or async block). Used to thread a per-protocol client through OSD's synchronous metadata-fetch call boundary. */
    withActiveClient<T>(client: any /* HttpClient */ | undefined, fn: () => T | Promise<T>): Promise<T>;
}
