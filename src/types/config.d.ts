export type XOpatClientConfig = {
    domain: string | null;
    path: string | null;
    image_group_server: string;
    image_group_protocol: string;
    data_group_server: string;
    data_group_protocol: string;
    osdOptions?: Partial<OpenSeadragon.Options> & Record<string, unknown>;
    js_cookie_expire?: number | null;
    js_cookie_path?: string | null;
    js_cookie_same_site?: string | null;
    js_cookie_secure?: boolean | null;
    js_cookie_domain?: string | null;
    secureMode?: boolean | null;
    production?: boolean | null;
};

export type ViewportSetup = {
    zoomLevel?: number;
    point?: { x: number; y: number };
    rotation?: number;
}

export type XOpatSetup = {
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
    activeBackgroundIndex?: number | null;
    activeVisualizationIndex?: number | null;
    grayscale?: boolean | null;
    tileCache?: boolean | null;
    preventNavigationShortcuts?: boolean | null;
    permaLoadPlugins?: boolean | null;
    bypassCookies?: boolean | null;
    bypassCache?: boolean | null;
    bypassCacheLoadTime?: boolean | null;
    theme?: string | null;
    stackedBackground?: boolean | null;
    maxImageCacheCount?: number | null;
    webGlPreferredVersion?: string | null;
    preferredFormat?: string | null;
    disablePluginsUi?: boolean | null;
    isStaticPreview?: boolean | null;
    historySize?: number | null;
};

export type XOpatServerProxyAuthJwt = {
    secret?: string;
    issuer?: string;
    audience?: string;
    forward?: boolean;
    userClaimHeader?: string;
};

export type XOpatServerProxyAuth = {
    enabled?: boolean;
    verifiers?: string[];
    mode?: "all" | "any";
    jwt?: XOpatServerProxyAuthJwt;
};

export type XOpatServerProxy = {
    baseUrl: string;
    headers?: Record<string, string>;
    auth?: XOpatServerProxyAuth;
};

export type XOpatServerConfig = {
    name: string | null;
    supportsPost: boolean;
    secure?: {
        proxies?: Record<string, XOpatServerProxy>;
    };
};

export type XOpatCoreConfig = {
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

export type XOpatElementRecord = {
    id: string;
    /** Human readable name */
    name?: string;
    /** Subdirectory where element is located */
    directory: string;
    /** Files to include (JS/MJS) */
    includes: Array<string | Record<string, any>>;
    /** If true, the element is always loaded on boot */
    permaLoad: boolean;
    /** Instantiated class reference */
    instance?: any;
    loaded: boolean;
    error?: any;
    /** Optional CSS file to inject */
    styleSheet?: string;
    /** Module IDs to require for a plugin */
    modules?: string[];
    /** Module IDs to require for a module */
    requires?: string[];
    [key: string]: any;
};