/**
 * Pure helper that constructs an OpenSeadragon viewer + FlexRenderer in a caller-owned
 * pair of DOM containers, without any VIEWER_MANAGER membership, broadcast-event replay,
 * or REQUIRED_SINGLETONS attachment.
 *
 * Mirrors the per-viewer wiring done in `ViewerManager.add()` (loader.ts), minus the global
 * registration and side effects. Used by the Visualization Playground to spawn sandboxed
 * viewers inside its modal.
 *
 * Lifecycle:
 *   const handle = setupIsolatedViewer({ cellEl, navigatorEl, htmlHandler, htmlReset });
 *   handle.viewer  // OpenSeadragon.Viewer
 *   handle.dispose();  // tears down the viewer and detaches the controller
 */

import { ViewerShaderSourceController } from "./viewer-shader-source-controller";
import { createHttpClientAdapter } from "../http-client";

export interface IsolatedViewerOptions {
    /** Container element where the OSD canvas will be mounted. Must be in the DOM and have nonzero size. */
    cellEl: HTMLElement;
    /** Container element where the OSD navigator overlay will be mounted. */
    navigatorEl: HTMLElement;
    /**
     * Per-layer UI binder, called by FlexRenderer when a shader is attached.
     * Mirrors loader.ts:3353 — the playground page wires this to its own
     * RightSideViewerMenu shaders tab.
     */
    htmlHandler?: (shaderLayer: any, shaderConfig: any, htmlContext: any) => void;
    /** Called by FlexRenderer when shaders are reset. */
    htmlReset?: () => void;
    /** Optional override for the FlexRenderer's WebGL preferred version; falls back to APPLICATION_CONTEXT option. */
    webGlPreferredVersion?: string;
    /** Show the OSD scalebar. Default true. */
    scalebar?: boolean;
    /** Extra options merged into OSD's constructor (last wins). */
    osdOptionsOverride?: Record<string, any>;
    /** Stable id used as `viewer.id`. Default auto-generated. */
    cellId?: string;
}

export interface IsolatedViewerHandle {
    viewer: any;
    shaderSourceController: ViewerShaderSourceController;
    dispose(): void;
}

let isolatedViewerCounter = 0;

export function setupIsolatedViewer(options: IsolatedViewerOptions): IsolatedViewerHandle {
    const OpenSeadragon = (window as any).OpenSeadragon;
    if (!OpenSeadragon) {
        throw new Error("setupIsolatedViewer: OpenSeadragon is not loaded");
    }
    const $: any = (window as any).$;
    const ENV: any = (window as any).ENV;
    const APP: any = (window as any).APPLICATION_CONTEXT;

    if (!options.cellEl || !options.navigatorEl) {
        throw new Error("setupIsolatedViewer: cellEl and navigatorEl are required");
    }

    const cellId = options.cellId || `xopat-iso-osd-${++isolatedViewerCounter}`;
    const navigatorId = `${cellId}-navigator`;

    // Ensure containers carry the IDs OSD expects.
    if (!options.cellEl.id) options.cellEl.id = cellId;
    if (!options.navigatorEl.id) options.navigatorEl.id = navigatorId;

    const flexRendererClass = (OpenSeadragon as any).FlexRenderer;
    const preferredWebGlVersion = options.webGlPreferredVersion ?? APP?.getOption?.("webGlPreferredVersion");

    const flexDrawerOptions = {
        webGlPreferredVersion: preferredWebGlVersion,
        backgroundColor: APP?.getOption?.("backgroundColor"),
        debug: !!APP?.getOption?.("webglDebugMode"),
        interactive: true,
        htmlHandler: options.htmlHandler || (() => {}),
        htmlReset: options.htmlReset || (() => {}),
        // The OSD navigator is created asynchronously; FlexRenderer.rebuild()
        // accesses `viewer.navigator.drawer.rebuild()` without a null guard
        // (flex-renderer.js:10003), so any rebuild that fires before the navigator
        // drawer is wired crashes. We disable shader-mirroring into the navigator
        // for the playground (the navigator still renders the slide for navigation
        // — only the shader pipeline is not duplicated there). Toggle on once the
        // host & navigator drawer init order is bullet-proof, or once the upstream
        // null-guard lands.
        handleNavigator: false,
        httpAdapter: createHttpClientAdapter(),
    };

    const renderingCapability = flexRendererClass && typeof flexRendererClass.ensureRuntimeSupport === "function"
        ? flexRendererClass.ensureRuntimeSupport({
            webGLPreferredVersion: preferredWebGlVersion,
            debug: !!APP?.getOption?.("webglDebugMode"),
            throwOnFailure: false,
        })
        : { ok: false, error: "FlexRenderer self-test is not available." };

    const viewerOptions: Record<string, any> = {
        id: options.cellEl.id,
        navigatorId: options.navigatorEl.id,
        prefixUrl: (ENV?.openSeadragonPrefix || "src/libs/") + "images",
        loadTilesWithAjax: true,
        splitHashDataForPost: true,
        // Hide OSD's built-in navigation control icons (zoom in/out/home/full-page)
        // — xOpat does not use them anywhere else in the UI either. Forcing here so
        // the playground stays consistent regardless of how ENV.openSeadragonConfiguration
        // is layered.
        showNavigationControl: false,
        subPixelRoundingForTransparency:
            navigator.userAgent.includes("Chrome") && navigator.vendor.includes("Google Inc")
                ? OpenSeadragon.SUBPIXEL_ROUNDING_OCCURRENCES.NEVER
                : OpenSeadragon.SUBPIXEL_ROUNDING_OCCURRENCES.ONLY_AT_REST,
        debugMode: APP?.getOption?.("debugMode", false, false),
        maxImageCacheCount: APP?.getOption?.("maxImageCacheCount", undefined, false),
        drawer: "flex-renderer",
        drawerOptions: { "flex-renderer": flexDrawerOptions },
        ...(options.osdOptionsOverride || {}),
    };

    const merged = $ ? $.extend(
        true,
        {},
        ENV?.openSeadragonConfiguration || {},
        ENV?.client?.osdOptions || {},
        viewerOptions
    ) : Object.assign({}, ENV?.openSeadragonConfiguration || {}, ENV?.client?.osdOptions || {}, viewerOptions);

    const viewer = OpenSeadragon(merged);
    (viewer as any).__renderingCapability = renderingCapability;
    (viewer as any).__playground = true;

    const shaderSourceController = new ViewerShaderSourceController(viewer);
    (viewer as any).__shaderSourceController = shaderSourceController;

    const attachResolver = (drawer: any) => {
        if (!drawer || drawer.__xopatShaderResolverAttached) return;
        drawer.options = drawer.options || {};
        drawer.options.shaderSourceResolver = shaderSourceController.resolver;
        drawer.__xopatShaderResolverAttached = true;
    };
    attachResolver(viewer.drawer);

    let navResolverAttempts = 0;
    const waitForNavResolver = () => {
        const nd = (viewer.navigator as any)?.drawer;
        if (nd) attachResolver(nd);
        else if (navResolverAttempts++ < 30) setTimeout(waitForNavResolver, 50);
    };
    waitForNavResolver();

    if (options.scalebar !== false && typeof viewer.makeScalebar === "function") {
        try {
            viewer.makeScalebar({
                pixelsPerMeter: 1,
                sizeAndTextRenderer: OpenSeadragon.ScalebarSizeAndTextRenderer?.METRIC_GENERIC?.bind?.(null, "px"),
                stayInsideImage: false,
                location: OpenSeadragon.ScalebarLocation?.BOTTOM_LEFT,
                xOffset: 5,
                yOffset: 10,
                backgroundColor: "rgba(255, 255, 255, 0.5)",
                fontSize: "small",
                barThickness: 2,
                destroy: false,
            });
        } catch (e) {
            console.warn("[setupIsolatedViewer] scalebar attach failed", e);
        }
    }

    if ($ && viewer.element) {
        $(viewer.element).on("contextmenu", (event: any) => {
            event.preventDefault();
        });
    }
    if (typeof viewer.addHandler === "function") {
        viewer.addHandler("navigator-scroll", (e: any) => {
            viewer.viewport.zoomBy(e.scroll / 2 + 1);
            viewer.viewport.applyConstraints();
        });
    }
    if (viewer.gestureSettingsMouse) viewer.gestureSettingsMouse.clickToZoom = false;

    if ((OpenSeadragon as any).Tools) {
        try { new (OpenSeadragon as any).Tools(viewer); } catch (e) { /* tools optional */ }
    }

    const dispose = () => {
        try {
            viewer.destroy?.();
        } catch (e) {
            console.warn("[setupIsolatedViewer] viewer.destroy failed", e);
        }
    };

    return { viewer, shaderSourceController, dispose };
}
