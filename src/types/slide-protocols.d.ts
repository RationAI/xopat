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
        types?: string[];
        refreshOn401?: boolean;
        required?: boolean;
    };
    headers?: Record<string, string>;
}

/**
 * Env-side shape of an object-form `slide_protocols.<name>` entry. The `url`
 * field carries the same backtick template as the string form; remaining
 * fields configure a per-protocol `HttpClient`.
 */
interface SlideProtocolEnvEntry extends SlideProtocolHttpClientOptions {
    url: string;
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

type ResolvedSlideProtocol =
    | { kind: "url"; url: string; protocolId: SlideProtocolId }
    | { kind: "tileSource"; tileSource: any /* OpenSeadragon.TileSource */; protocolId: SlideProtocolId };

interface SlideProtocolResolveArgs {
    spec: DataSpecification | undefined;
    bgEntry?: BackgroundItem;
    vizEntry?: VisualizationItem;
    isSecureMode: boolean;
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
    ingestFromEnv(envClient: any): void;
    /** Lazily-built HttpClient for a registered protocol (or undefined if it has no `httpClient` options). */
    getClientForProtocol(id: SlideProtocolId): any /* HttpClient */ | undefined;
    /** Longest-prefix match against built HttpClients' baseURLs. Used by the patched `OpenSeadragon.makeAjaxRequest` to route per-protocol fetches that aren't wrapped in `withActiveClient`. */
    getActiveClientForUrl(url: string): any /* HttpClient */ | undefined;
    /** Sets the "active" HttpClient for the duration of `fn` (a sync or async block). Used to thread a per-protocol client through OSD's synchronous metadata-fetch call boundary. */
    withActiveClient<T>(client: any /* HttpClient */ | undefined, fn: () => T | Promise<T>): Promise<T>;
}
