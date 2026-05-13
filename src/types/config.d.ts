type XOpatClientConfig = {
    domain: string | null;
    path: string | null;
    /**
     * Named slide-protocol registry. Each entry is either a backtick-template
     * URL string with `data` (scalar DataID) in scope — the server URL embedded
     * in the template — or an object `{ url, proxy?, baseURL?, auth?, … }` whose
     * extra fields are forwarded verbatim to `new HttpClient({…})`. The object
     * form makes every request issued by this protocol's TileSource (metadata
     * + tiles) flow through the configured HttpClient — gaining proxy routing,
     * CSRF injection, and JWT/auth headers uniformly. Referenced by name from
     * `BackgroundItem.protocol` / `DataOverride.protocol`. Plugins may add
     * entries at runtime via `window.SLIDE_PROTOCOLS.register(...)`. Safe in
     * secure mode (no eval of user-controlled strings).
     */
    slide_protocols?: Record<string, string | SlideProtocolEnvEntry>;
    /** Name of the protocol used by default for background slides. */
    default_background_protocol?: string;
    /** Name of the protocol used by default for visualization slides. */
    default_visualization_protocol?: string;
    /** @deprecated use `slide_protocols` + `default_background_protocol`. Auto-synthesized into the `__legacy_bg` registry entry on load. */
    image_group_server?: string;
    /** @deprecated use `slide_protocols` + `default_background_protocol`. Auto-synthesized into the `__legacy_bg` registry entry on load. */
    image_group_protocol?: string;
    /** @deprecated use `slide_protocols` + `default_visualization_protocol`. Auto-synthesized into the `__legacy_viz` registry entry on load. */
    data_group_server?: string;
    /** @deprecated use `slide_protocols` + `default_visualization_protocol`. Auto-synthesized into the `__legacy_viz` registry entry on load. */
    data_group_protocol?: string;
    osdOptions?: Partial<OpenSeadragon.Options> & Record<string, unknown>;
    js_cookie_expire?: number | null;
    js_cookie_path?: string | null;
    js_cookie_same_site?: string | null;
    js_cookie_secure?: boolean | null;
    js_cookie_domain?: string | null;
    secureMode?: boolean | null;
    production?: boolean | null;
    /**
     * Admin-controlled IO pipeline configuration. Server-injected, NOT
     * URL-modifiable (lives in ENV, not in `params`). Carries bindings,
     * disabled owners/capabilities, and per-sink override slots. See
     * `src/types/io.d.ts` for the `IOConfigBlock` shape and
     * `src/IO_PIPELINE.md` for the full design.
     */
    io?: IOConfigBlock;
};

type ViewportSetup = {
    zoomLevel: number;
    point: { x: number; y: number };
    rotation?: number;
}

type XOpatSetup = {
    sessionName?: string | null;
    locale?: string | null;
    customBlending?: boolean | null;
    debugMode?: boolean | null;
    webglDebugMode?: boolean | null;
    scaleBar?: boolean | null;
    toolBar?: boolean | null;
    statusBar?: boolean | null;
    background?: string | null;
    viewport?: ViewportSetup | ViewportSetup[] | null;
    activeBackgroundIndex?: number | number[] | null;
    activeVisualizationIndex?: number | number[] | null;
    grayscale?: boolean | null;
    tileCache?: boolean | null;
    preventNavigationShortcuts?: boolean | null;
    permaLoadPlugins?: boolean | null;
    bypassCookies?: boolean | null;
    bypassCache?: boolean | null;
    bypassCacheLoadTime?: boolean | null;
    theme?: string | null;
    maxImageCacheCount?: number | null;
    webGlPreferredVersion?: string | null;
    preferredFormat?: string | null;
    fetchAsync?: boolean | null;
    disablePluginsUi?: boolean | null;
    valueInspectorEnabled?: boolean | null;
    visualizationInspectorEnabled?: boolean | null;
    visualizationInspectorMode?: string | null;
    visualizationInspectorRadiusPx?: number | null;
    visualizationInspectorLensZoom?: number | null;
    isStaticPreview?: boolean | null;
    historySize?: number | null;
    maxMobileWidthPx?: number | null;
};

type XOpatServerProxyAuthJwt = {
    secret?: string;
    issuer?: string;
    audience?: string;
    forward?: boolean;
    userClaimHeader?: string;
};

type XOpatServerProxyAuth = {
    enabled?: boolean;
    verifiers?: string[];
    mode?: "all" | "any";
    jwt?: XOpatServerProxyAuthJwt;
};

type XOpatServerProxy = {
    baseUrl: string;
    headers?: Record<string, string>;
    auth?: XOpatServerProxyAuth;
};

type XOpatServerConfig = {
    devMode: boolean | null | undefined;
    name: string | null;
    supportsPost: boolean;
    secure?: {
        proxies?: Record<string, XOpatServerProxy>;
    };
};

type XOpatCoreConfig = {
    name: string;
    version: string;
    gateway: string;
    active_client: string;
    client: XOpatClientConfig | Record<string, XOpatClientConfig>;
    setup: XOpatSetup;
    server: XOpatServerConfig;
    monaco: string;
    openSeadragonPrefix: string;
    openSeadragon: string;
    openSeadragonConfiguration: Partial<OpenSeadragon.Options> & Record<string, unknown>;
    js: Record<string, unknown>;
    css: Record<string, unknown>;
};

/**
 * The record as defined in include.json file
 */
type XOpatElementItem = {
    id: string;
    /** Human readable name */
    name?: string;
    /** Subdirectory where element is located */
    directory: string;
    /** Files to include (JS/MJS) */
    includes: Array<string | Record<string, any>>;
    /** If true, the element is always loaded on boot */
    permaLoad: boolean;
    /** Module IDs to require for a plugin */
    modules?: string[];
    /** Module IDs to require for a module */
    requires?: string[];
    [key: string]: any;
}

/**
 * The internal representation in the app, extends XOpatElementItem
 */
interface XOpatElementInternalRecord extends XOpatElementItem {
    /** Instantiated class reference */
    instance?: XOpatElementClass;
    loaded: boolean;
    error?: any;
    /** Optional CSS file to inject */
    styleSheet?: string;
}

/**
 * The viewer session configuration.
 */
interface XOpatSessionConfig {
    params?: Partial<XOpatSetup>;
    data?: DataSpecification[];
    background?: BackgroundItem[];
    visualizations?: VisualizationItem[];
    plugins?: Record<string, unknown>;
}

/**
 * The internal session configuration of the application.
 */
interface XOpatRuntimeConfig extends XOpatSessionConfig {
    error?: string;
    description?: string;
    details?: string;
    __fromLocalStorage?: boolean;
}
