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
    /**
     * Server-side plugin selection mode. Controls which plugins the server
     * ships to the client in the page-level `PLUGINS` map. See
     * `XOpatPluginSelectionMode` for semantics. Defaults to `"all"`.
     */
    pluginSelectionMode?: XOpatPluginSelectionMode;
};

type ViewportSetup = {
    zoomLevel: number;
    point: { x: number; y: number };
    rotation?: number;
}

/**
 * UI visibility namespace under `params.ui.*`. Each flag is the *initial*
 * visible state at boot — `false` boots the component collapsed/hidden but
 * the user can still bring it back via the relevant toggle (settings
 * checkbox, hide-UI button, menu opener). Defaults to `true` for every key
 * when unset. Read at boot via `APPLICATION_CONTEXT.getUiOption(key)` —
 * which also honors the legacy flat `XOpatSetup.scaleBar`/`toolBar`/
 * `statusBar` aliases.
 */
type XOpatUiSetup = {
    /** Initial visible state of the scalebar overlay. */
    scaleBar?: boolean | null;
    /** Initial visible state of the top toolbar. */
    toolBar?: boolean | null;
    /** Initial visible state of the bottom status bar. */
    statusBar?: boolean | null;
    /** Initial visible state of the global menu (FullscreenMenus panel). */
    mainMenu?: boolean | null;
    /** Initial visible state of the OSD navigator panel (per viewer). */
    navigator?: boolean | null;
    /**
     * Initial visible state of the top app bar chrome. `false` is equivalent
     * to the hide-UI button being pre-toggled at boot — hides every
     * Chrome-registered component until the user toggles back.
     */
    appBar?: boolean | null;
    /**
     * Initial visible state of the global right-side dock (`window.LAYOUT`,
     * `MainLayout`) that hosts plugin tabs such as chats, slide-switcher and
     * questionnaire. `false` boots the dock closed; the user (and plugins
     * that explicitly focus a tab) can still reopen it.
     */
    globalMenu?: boolean | null;
    /**
     * Interaction mode of the global right-side dock.
     * `"overlay"` (default): the dock hides to a thin edge rail and floats over
     * the viewer on hover/focus (no viewer reflow).
     * `"docked"`: the dock is a flex sibling that pushes the viewer and stays
     * open when open (the classic behavior).
     * Unlike the boolean flags above this is NOT read via `getUiOption` (which
     * is boolean-only) — `MainLayout` reads it directly at construction. The
     * user's runtime pin choice (AppCache `<layoutId>-dock-mode`) overrides
     * this session/deployment default.
     */
    globalMenuMode?: "docked" | "overlay" | null;
};

type XOpatSetup = {
    sessionName?: string | null;
    locale?: string | null;
    customBlending?: boolean | null;
    debugMode?: boolean | null;
    webglDebugMode?: boolean | null;
    /** @deprecated Use `params.ui.scaleBar` instead. Kept as backwards-compatible alias. */
    scaleBar?: boolean | null;
    /** @deprecated Use `params.ui.toolBar` instead. Kept as backwards-compatible alias. */
    toolBar?: boolean | null;
    /** @deprecated Use `params.ui.statusBar` instead. Kept as backwards-compatible alias. */
    statusBar?: boolean | null;
    background?: string | null;
    viewport?: ViewportSetup | ViewportSetup[] | null;
    activeBackgroundIndex?: number | number[] | null;
    /**
     * @deprecated Per-viewer visualization is now a property of each background entry
     * (`config.background[i].visualizationIndex`). Legacy input shape is still accepted —
     * it is folded into bg entries at config-parse time — but no longer authoritative state
     * and never emitted on serialization.
     */
    activeVisualizationIndex?: number | number[] | null;
    grayscale?: boolean | null;
    /** Viewer canvas background color (hex `#rrggbb` / `#rrggbbaa`). */
    backgroundColor?: string | null;
    tileCache?: boolean | null;
    preventNavigationShortcuts?: boolean | null;
    /**
     * If true, the viewer only zooms on `Ctrl/Cmd + wheel`; plain wheel scrolls
     * the host page through. Intended for notebook / scrollable-host embeddings
     * where unintentional viewer zoom hijacks page scroll.
     */
    scrollRequiresCtrl?: boolean | null;
    /**
     * If true, the scroll-to-zoom direction is inverted: scrolling down zooms in
     * and scrolling up zooms out. Intended for users who expect map-style or
     * trackpad-style wheel behaviour.
     */
    reverseScroll?: boolean | null;
    /**
     * If true (default), scroll-to-zoom snaps between standard objective
     * magnification stops (5x/10x/20x/40x…) — but only when the current slide has
     * a resolved native magnification (a calibrated MPP). Uncalibrated / pixel-unit
     * slides fall back to continuous zoom. Composes with `reverseScroll`.
     */
    snapZoomToMagnification?: boolean | null;
    permaLoadPlugins?: boolean | null;
    bypassCloseConfirmation?: boolean | null;
    bypassCookies?: boolean | null;
    bypassCache?: boolean | null;
    bypassCacheLoadTime?: boolean | null;
    theme?: string | null;
    /**
     * Vertical placement of the system notification toast (`window.Dialogs`).
     * Default `"bottom"`. Set to `"top"` for embeddings where the bottom edge
     * is reserved (e.g. notebook hosts with their own status bar). Runtime
     * changes via `Dialogs.setPosition(...)` persist on this same key.
     */
    notificationsPosition?: "top" | "bottom" | null;
    maxImageCacheCount?: number | null;
    /**
     * Keep visited/prefetched focal planes of a z-stack as extra per-tile OSD
     * cache records so plane revisits are served without a network round-trip.
     * Default `true`. `false` restores fetch-per-scrub behavior.
     */
    zPlaneCacheEnabled?: boolean | null;
    /**
     * Budget for the z-plane cache records (they also count toward
     * `maxImageCacheCount`). Oldest records are dropped first. Default 400.
     */
    zPlaneCacheMaxItems?: number | null;
    /**
     * After a plane change settles, prefetch the `z±1..radius` variants of the
     * tiles currently in the viewport. `0` disables prefetching. Default 1.
     */
    zPrefetchRadius?: number | null;
    /** Parallel connections used by the z-plane prefetcher. Default 4. */
    zPrefetchConcurrency?: number | null;
    /**
     * What happens to loaded tiles OUTSIDE the viewport on a plane change:
     * `"cached-only"` (default) swaps only planes already in the cache and
     * unloads the rest (they reload at the live plane when panned back to);
     * `"fetch"` refetches every loaded tile over the network (full fidelity).
     */
    zRepaintOffViewport?: "cached-only" | "fetch" | null;
    webGlPreferredVersion?: string | null;
    preferredFormat?: string | null;
    fetchAsync?: boolean | null;
    disablePluginsUi?: boolean | null;
    /**
     * Operator-trusted custom branding (ENV `core.setup.branding` only — read
     * via `APPLICATION_CONTEXT.defaultParams`, never `getOption`, so an imported
     * session / URL param cannot override it; see AGENTS.md §7). `title` and the
     * favicon paths are consumed server-side when rendering the page head;
     * `logo` renders a company image at the left of the top app bar. Any key
     * omitted falls back to the stock xOpat asset.
     */
    branding?: {
        title?: string | null;
        appleTouchIcon?: string | null;
        icon32?: string | null;
        icon16?: string | null;
        maskIcon?: string | null;
        maskIconColor?: string | null;
        logo?: string | null;
    } | null;
    /**
     * If true, skip the cookie-driven plugin restore (`_plugins`) for this
     * session. Plugins flagged `permaLoad: true` in their `include.json` and
     * plugins explicitly listed in this session's `config.plugins` still come
     * up normally. The intent is to ignore the user's *previous* manual
     * picks while still respecting the deployment's auto-loaded set and the
     * current session's declared plugins.
     */
    disablePluginsAutoload?: boolean | null;
    valueInspectorEnabled?: boolean | null;
    visualizationInspectorEnabled?: boolean | null;
    visualizationInspectorMode?: string | null;
    visualizationInspectorRadiusPx?: number | null;
    visualizationInspectorLensZoom?: number | null;
    isStaticPreview?: boolean | null;
    historySize?: number | null;
    maxMobileWidthPx?: number | null;
    /**
     * Canonical home for UI initial-visibility flags. See `XOpatUiSetup`.
     * As a shorthand, set to `false` to hide every global UI component at
     * boot (useful for headless / notebook embeddings). `true` is equivalent
     * to leaving the field unset.
     */
    ui?: XOpatUiSetup | boolean | null;
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
    /**
     * Server-side-only configuration. Always stripped from the CORE object
     * shipped to the browser (the server keeps a pre-strip copy for its
     * own use — see `core.CORE_SECURE` in `core.js` and PHP's
     * `$GLOBALS['CORE_SECURE']`). The `plugins[id]` / `modules[id]` slots
     * are the second source consulted by element-level `requiredConfig`
     * declarations in "available" plugin-selection mode (see
     * `XOpatPluginSelectionMode`) — they're the natural home for
     * secret-adjacent per-element configuration that should never leak to
     * the client.
     */
    secure?: {
        proxies?: Record<string, XOpatServerProxy>;
        plugins?: Record<string, Record<string, unknown>>;
        modules?: Record<string, Record<string, unknown>>;
    };
};

/**
 * Server-side plugin selection mode. Read by the server when building the
 * plugin manifest shipped to the client.
 *  - "all":       every plugin without `enabled: false` is shipped (default).
 *  - "whitelist": only plugins for which the deployment ENV sets
 *                 `plugins[id].enabled = true` are shipped. A plugin's own
 *                 `enabled: true` in include.json is NOT enough. No
 *                 server-secure-side fallback for this opt-in.
 *  - "available": same as "all", but each plugin / module may declare a
 *                 single `requiredConfig: string[]` array of dot-paths in
 *                 its include.json. The gate resolves each path against
 *                 the deployment ENV block (`ENV.plugins[id]` /
 *                 `ENV.modules[id]`) AND the server-secure block
 *                 (`CORE.server.secure.plugins[id]` / `...modules[id]`);
 *                 a path is satisfied when EITHER source carries a
 *                 non-undefined/non-null/non-empty value. Include.json
 *                 defaults are NOT consulted. The plugin author declares
 *                 *what* is needed; the deployment admin decides *where*
 *                 each value lives based on sensitivity.
 */
type XOpatPluginSelectionMode = "all" | "whitelist" | "available";

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
    /**
     * Human readable name. `"%key%"` references a key in the element's own locale
     * bundle (`locales/<lang>.json`, i18next namespace = the element id) and is
     * resolved by `pluginMeta` / `moduleMeta`; any other string is literal.
     */
    name?: string;
    /** Short user-facing summary. Localizable the same way as `name`. */
    description?: string;
    /** Longer user-facing text shown where there is room for it. Localizable the same way as `name`. */
    longDescription?: string;
    /** Free-form grouping labels, e.g. ["Annotations", "AI"]. Used to group and filter the plugin list and the docs catalogue. */
    categories?: string[];
    /** Search terms; never displayed. */
    keywords?: string[];
    /** Project homepage, http(s) only. */
    homepage?: string;
    /** Source repository, http(s) only. */
    repository?: string;
    /** Issue tracker, http(s) only. */
    bugs?: string;
    /** User documentation, http(s) only. */
    docsUrl?: string;
    /** SPDX license identifier. Documentation only. */
    license?: string;
    /**
     * Compatibility ranges. Only `xopat` is understood: the element is refused at
     * load time when the app version is outside the range. Prerelease tags of the
     * app version are ignored, so `>=3.0.0` matches a `3.0.0-beta.1` build.
     */
    engines?: { xopat?: string } & Record<string, string | undefined>;
    /** Subdirectory where element is located */
    directory: string;
    /** Files to include (JS/MJS) */
    includes: Array<string | Record<string, any>>;
    /**
     * Production-only overlay computed server-side (see buildProdIncludes):
     * foldable includes collapsed into a single minified bundle, non-foldable
     * entries kept in place. The loader iterates this when present, else
     * `includes`. Absent in dev or when no min artifact exists.
     */
    prodIncludes?: Array<string | Record<string, any>>;
    /** If true, the element is always loaded on boot */
    permaLoad: boolean;
    /**
     * Maturity marker, absent means "stable". Presentation only: it drives the
     * docs catalogue badge and the plugin-list badge, and never gates loading.
     * A deployment can override it via ENV `plugins[id]` / `modules[id]`.
     */
    stability?: "stable" | "experimental" | "deprecated";
    /** Module IDs to require for a plugin */
    modules?: string[];
    /** Module IDs to require for a module */
    requires?: string[];
    /**
     * Dot-paths within this element's `<id>` namespace that MUST be
     * configured by the deployment for the element to be shipped to the
     * client under "available" plugin-selection mode. Each path is resolved
     * against TWO deployment-controlled sources (in order); a path is
     * satisfied when it resolves to a non-`undefined`/non-`null`/non-empty
     * value in EITHER source:
     *   1. Deployment ENV block — `ENV.plugins[id]` (plugins) /
     *      `ENV.modules[id]` (modules). Set via env.json's top-level
     *      `plugins`/`modules` arrays.
     *   2. Server-secure block — `CORE.server.secure.plugins[id]` /
     *      `CORE.server.secure.modules[id]`. Set via env.json's
     *      `core.server.secure.plugins`/`modules` and never shipped to the
     *      client. The natural home for secret-adjacent values (API key
     *      bindings, proxy aliases referencing a secret).
     * Include.json defaults are NOT consulted — only deployment
     * configuration satisfies the gate. Booleans `false` and the number `0`
     * count as configured. Ignored in other selection modes. The plugin
     * author declares *what* is needed; the admin chooses *where* per
     * deployment based on sensitivity.
     */
    requiredConfig?: string[];
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
