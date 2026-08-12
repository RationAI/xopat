/**
 * Dev-only render capture: what the renderer was asked to draw, and what it
 * produced — for the on-screen viewport path and every off-screen path.
 *
 * The controller is INERT by default. Nothing is installed, nothing is
 * measured, no memory is held beyond a list of known drawers. Hooks go in only
 * while the Render Debug window is open (`activate()` / `deactivate()`), so a
 * normal session pays exactly zero.
 *
 * Capture works by wrapping four *instance* methods per drawer — the vendored
 * flex-renderer bundle is never edited (AGENTS.md §0.6):
 *
 *   drawer.draw                  viewport frame boundary        (flex-renderer.js:15759)
 *   drawer.drawWithConfiguration off-screen frame boundary      (flex-renderer.js:17534)
 *   renderer.renderFirstPass     tiles -> offscreen arrays      (flex-renderer.js:1454)
 *   renderer.renderSecondPass    shader stack -> final image    (flex-renderer.js:1500)
 *
 * The frame currently being recorded lives on the renderer instance
 * (`renderer.__xoFrame`); the frame wrappers open it, the pass wrappers append
 * to it. That single rule handles both re-entrancy (`drawWithConfiguration`
 * calls `draw` internally) and concurrency (each drawer has its own renderer,
 * and the off-screen path is serialized by the drawer's own mutex).
 *
 * Descriptors never contain tile pixels — only counts, coordinates and ids.
 * Result imagery is opt-in: a small thumbnail per captured frame (tier 1) and
 * an explicit per-frame first-pass layer grid (tier 2), which replaces the
 * library's own `window.open` debug popup.
 */

type RenderDebugKind = "viewport" | "navigator" | "offscreen";

interface RenderDebugSource {
    id: string;
    label: string;
    kind: RenderDebugKind;
    viewerId: string;
    drawer: any;
    /** performance.now() of the last captured frame — drives the throttle. */
    lastT: number;
}

interface RenderPassRecord {
    pass: "first" | "second";
    ms: number;
    packages: any[];
    out: any;
    error?: string;
}

interface RenderFrameRecord {
    seq: number;
    /** performance.now() at frame start. */
    t: number;
    /** Wall-clock ISO stamp (export readability). */
    wall: string;
    sourceId: string;
    label: string;
    kind: RenderDebugKind;
    mode: "full-draw" | "second-pass-reuse";
    shared: boolean;
    view: any;
    viewFrom?: string;
    size: { x: number; y: number } | null;
    precision?: string;
    images: any[];
    order?: string[];
    packLayout?: any;
    firstPassDepths?: { texture: number; stencil: number; borrowed?: boolean };
    passes: RenderPassRecord[];
    ms: number;
    error?: string;
    thumb: HTMLCanvasElement | null;
    fpGrid: any[] | null;
}

interface RenderDebugOptions {
    /** Tier 1: copy the presentation canvas into a small thumbnail. */
    thumbnails: boolean;
    /** Include per-tile {level,x,y} in the first-pass descriptor. */
    tiles: boolean;
    /** Minimum ms between two captured viewport frames (off-screen is never throttled). */
    minIntervalMs: number;
    /** Also capture the navigator's mini-drawer. */
    includeNavigator: boolean;
    /** Ring-buffer size. */
    capacity: number;
}

const THUMB_MAX_PX = 192;

export class RenderDebugController {
    private _active = false;
    private _paused = false;
    private _captureNext = false;
    /** Set while the controller itself drives a render (tier 2) — never recorded. */
    private _internal = false;
    private _seq = 0;
    private _sources = new Map<any, RenderDebugSource>();
    private _frames: RenderFrameRecord[] = [];
    private _handlers = new Map<string, Set<(e?: any) => void>>();
    private _viewerManager: any = null;
    private _toolsRegistered = false;
    private _window: any = null;

    readonly options: RenderDebugOptions = {
        thumbnails: false,
        tiles: false,
        minIntervalMs: 200,
        includeNavigator: false,
        capacity: 60,
    };

    // ── state ────────────────────────────────────────────────────────────────

    /** Dev gate. The whole feature is unreachable without it. */
    get available(): boolean {
        return !!APPLICATION_CONTEXT.getOption("debugMode");
    }

    get active(): boolean {
        return this._active;
    }

    get paused(): boolean {
        return this._paused;
    }

    set paused(value: boolean) {
        this._paused = !!value;
        this._raise("state-changed");
    }

    get frames(): RenderFrameRecord[] {
        return this._frames;
    }

    get sources(): RenderDebugSource[] {
        return [...this._sources.values()];
    }

    /** Capture one frame regardless of pause / throttle. */
    captureNext() {
        this._captureNext = true;
        this._raise("state-changed");
    }

    clear() {
        for (const frame of this._frames) {
            this._releaseFrame(frame);
        }
        this._frames = [];
        this._raise("frame");
    }

    addHandler(name: string, handler: (e?: any) => void) {
        let set = this._handlers.get(name);
        if (!set) {
            this._handlers.set(name, set = new Set());
        }
        set.add(handler);
        return () => set!.delete(handler);
    }

    private _raise(name: string, payload?: any) {
        const set = this._handlers.get(name);
        if (!set) {
            return;
        }
        for (const handler of set) {
            try {
                handler(payload);
            } catch (e) {
                console.error("RenderDebug handler failed:", e);
            }
        }
    }

    // ── registration ─────────────────────────────────────────────────────────

    /**
     * Announce a drawer so the panel can capture from it. Off-screen drawers
     * must call this at creation time (one optional-chained line); viewport
     * drawers are picked up automatically from VIEWER_MANAGER.
     *
     * Cheap and idempotent — safe to call unconditionally.
     */
    registerDrawer(drawer: any, opts: { label: string; viewer?: any; kind?: RenderDebugKind } = { label: "offscreen" }) {
        if (!drawer || this._sources.has(drawer)) {
            return;
        }
        const viewer = opts.viewer || drawer.viewer;
        const source: RenderDebugSource = {
            id: `${opts.kind || "offscreen"}:${opts.label}:${this._sources.size}`,
            label: opts.label,
            kind: opts.kind || "offscreen",
            viewerId: viewer?.uniqueId ?? "",
            drawer,
            lastT: 0,
        };
        this._sources.set(drawer, source);
        if (this._active) {
            this._hook(source);
        }
        this._raise("sources-changed");
    }

    unregisterDrawer(drawer: any) {
        const source = this._sources.get(drawer);
        if (!source) {
            return;
        }
        this._unhook(source);
        this._sources.delete(drawer);
        this._raise("sources-changed");
    }

    /** Track viewport drawers: sweep the open ones and follow the grid. */
    attachViewerManager(viewerManager: any) {
        if (!viewerManager || this._viewerManager) {
            return;
        }
        this._viewerManager = viewerManager;
        viewerManager.addHandler?.("viewer-create", (e: any) => this._registerViewer(e?.viewer));
        viewerManager.addHandler?.("viewer-destroy", (e: any) => this._unregisterViewer(e?.viewer));
    }

    private _registerViewer(viewer: any) {
        if (!viewer?.drawer) {
            return;
        }
        this.registerDrawer(viewer.drawer, { label: viewer.uniqueId || "viewer", viewer, kind: "viewport" });
        if (this.options.includeNavigator && viewer.navigator?.drawer) {
            this.registerDrawer(viewer.navigator.drawer, {
                label: `${viewer.uniqueId || "viewer"}/nav`, viewer, kind: "navigator"
            });
        }
    }

    private _unregisterViewer(viewer: any) {
        if (!viewer) {
            return;
        }
        for (const [drawer, source] of [...this._sources]) {
            if (source.viewerId && source.viewerId === viewer.uniqueId) {
                this.unregisterDrawer(drawer);
            }
        }
    }

    // ── activation ───────────────────────────────────────────────────────────

    activate() {
        if (this._active) {
            return;
        }
        this._active = true;
        for (const viewer of (this._viewerManager?.viewers || [])) {
            this._registerViewer(viewer);
        }
        for (const source of this._sources.values()) {
            this._hook(source);
        }
        this._raise("state-changed");
    }

    deactivate() {
        if (!this._active) {
            return;
        }
        this._active = false;
        for (const source of this._sources.values()) {
            this._unhook(source);
        }
        this._raise("state-changed");
    }

    // ── hook plumbing ────────────────────────────────────────────────────────

    /**
     * Instance-wrap `obj[name]`, remembering how to put it back. The restorer
     * refuses to clobber someone else's later wrapper and instead disarms ours,
     * so an un-restorable wrapper degrades to a permanent pass-through.
     */
    private _wrap(obj: any, name: string, make: (orig: Function) => Function) {
        const orig = obj?.[name];
        if (typeof orig !== "function") {
            return;
        }
        const hadOwn = Object.prototype.hasOwnProperty.call(obj, name);
        const wrapper: any = make(orig);
        obj[name] = wrapper;
        (obj.__xoRenderDebug ||= {})[name] = () => {
            if (obj[name] !== wrapper) {
                wrapper.__passthrough = true;
                return;
            }
            if (hadOwn) {
                obj[name] = orig;
            } else {
                delete obj[name];
            }
        };
    }

    private _unwrap(obj: any) {
        const restorers = obj?.__xoRenderDebug;
        if (!restorers) {
            return;
        }
        for (const restore of Object.values(restorers) as Function[]) {
            try {
                restore();
            } catch (e) {
                console.error("RenderDebug restore failed:", e);
            }
        }
        delete obj.__xoRenderDebug;
    }

    private _hook(source: RenderDebugSource) {
        const drawer = source.drawer;
        const renderer = drawer?.renderer;
        if (!renderer || drawer.__xoRenderDebug) {
            return;
        }

        if (source.kind === "offscreen") {
            this._wrap(drawer, "drawWithConfiguration", orig => this._makeOffscreenWrapper(source, orig));
        } else {
            this._wrap(drawer, "draw", orig => this._makeViewportWrapper(source, orig));
        }

        this._wrap(renderer, "renderFirstPass", orig => this._makePassWrapper("first", orig));
        this._wrap(renderer, "renderSecondPass", orig => this._makePassWrapper("second", orig));
    }

    private _unhook(source: RenderDebugSource) {
        this._unwrap(source.drawer);
        this._unwrap(source.drawer?.renderer);
    }

    // ── wrappers ─────────────────────────────────────────────────────────────

    /** True when this call must be recorded. Ordered cheapest-check-first. */
    private _shouldCapture(source: RenderDebugSource, throttled: boolean): boolean {
        if (this._internal) {
            return false;
        }
        if (this._captureNext) {
            return true;
        }
        if (this._paused) {
            return false;
        }
        if (!throttled) {
            return true;
        }
        return (performance.now() - source.lastT) >= this.options.minIntervalMs;
    }

    private _makeViewportWrapper(source: RenderDebugSource, orig: Function) {
        const self = this;
        const wrapper: any = function (this: any, tiledImages: any[], view: any) {
            const renderer = this.renderer;
            if (wrapper.__passthrough || !self._active || renderer?.__xoFrame ||
                !self._shouldCapture(source, true)) {
                return orig.apply(this, arguments);
            }

            const frame = self._openFrame(source, this, "full-draw");
            frame.view = self._describeView(view || self._readViewportView(this));
            frame.size = { x: this.canvas?.width ?? 0, y: this.canvas?.height ?? 0 };
            frame.images = self._describeImages(tiledImages, false);

            const start = performance.now();
            try {
                return orig.apply(this, arguments);
            } catch (e) {
                frame.error = String(e);
                throw e;
            } finally {
                frame.ms = performance.now() - start;
                // The presentation canvas IS the live canvas in private-context
                // mode, so this read must stay synchronous — never deferred.
                if (self.options.thumbnails) {
                    frame.thumb = self._thumbnail(renderer?.getPresentationCanvas?.());
                }
                self._closeFrame(frame, renderer);
            }
        };
        return wrapper;
    }

    private _makeOffscreenWrapper(source: RenderDebugSource, orig: Function) {
        const self = this;
        const wrapper: any = async function (this: any, tiledImages: any[], configuration: any, view: any, size: any) {
            const drawer = source.drawer;
            const renderer = drawer.renderer;
            if (wrapper.__passthrough || !self._active || renderer?.__xoFrame ||
                !self._shouldCapture(source, false)) {
                return orig.apply(this, arguments);
            }

            // Branch detection mirrors flex-renderer.js:17540.
            const reuse = !view || view instanceof (OpenSeadragon as any).FlexDrawer;
            const frame = self._openFrame(source, drawer, reuse ? "second-pass-reuse" : "full-draw");
            frame.images = self._describeImages(tiledImages, reuse);
            if (reuse) {
                const from = view || (drawer.viewer?.drawer);
                frame.viewFrom = self._labelOf(from);
                frame.size = size || (from?.canvas ? { x: from.canvas.width, y: from.canvas.height } : null);
            } else {
                frame.view = self._describeView(view);
                frame.size = size ? { x: size.x, y: size.y } : null;
            }

            const start = performance.now();
            try {
                const ctx = await orig.apply(this, arguments);
                if (self.options.thumbnails) {
                    // Already a CPU-side 2D canvas — no GL readback needed.
                    frame.thumb = self._thumbnail(ctx?.canvas);
                }
                return ctx;
            } catch (e) {
                frame.error = String(e);
                throw e;
            } finally {
                frame.ms = performance.now() - start;
                if (reuse) {
                    const fp = renderer?.__firstPassResult;
                    if (fp) {
                        frame.firstPassDepths = {
                            texture: fp.textureDepth ?? 0,
                            stencil: fp.stencilDepth ?? 0,
                            borrowed: true,
                        };
                    }
                }
                self._closeFrame(frame, renderer);
            }
        };
        return wrapper;
    }

    private _makePassWrapper(pass: "first" | "second", orig: Function) {
        const self = this;
        const wrapper: any = function (this: any, packages: any[], options: any) {
            const frame: RenderFrameRecord | undefined = this.__xoFrame;
            if (wrapper.__passthrough || !self._active || !frame) {
                return orig.apply(this, arguments);
            }

            const record: RenderPassRecord = {
                pass,
                ms: 0,
                packages: pass === "first"
                    ? self._describeFirstPass(packages)
                    : self._describeSecondPass(packages),
                out: null,
            };
            frame.passes.push(record);

            const start = performance.now();
            try {
                const out = orig.apply(this, arguments);
                record.out = self._describePassOutput(out, options);
                if (pass === "first" && out) {
                    frame.firstPassDepths = {
                        texture: out.textureDepth ?? 0,
                        stencil: out.stencilDepth ?? 0,
                    };
                }
                return out;
            } catch (e) {
                record.error = String(e);
                throw e;
            } finally {
                record.ms = performance.now() - start;
            }
        };
        return wrapper;
    }

    // ── frame lifecycle ──────────────────────────────────────────────────────

    private _openFrame(source: RenderDebugSource, drawer: any, mode: RenderFrameRecord["mode"]): RenderFrameRecord {
        const renderer = drawer.renderer;
        source.lastT = performance.now();
        const frame: RenderFrameRecord = {
            seq: ++this._seq,
            t: source.lastT,
            wall: new Date().toISOString(),
            sourceId: source.id,
            label: source.label,
            kind: source.kind,
            mode,
            shared: !!renderer?.isSharedContext?.(),
            view: null,
            size: null,
            precision: renderer?.getColorTargetPrecision?.(),
            images: [],
            order: renderer?.getShaderLayerOrder?.()?.slice?.(),
            packLayout: this._describePackLayout(renderer),
            passes: [],
            ms: 0,
            thumb: null,
            fpGrid: null,
        };
        renderer.__xoFrame = frame;
        return frame;
    }

    private _closeFrame(frame: RenderFrameRecord, renderer: any) {
        if (renderer) {
            renderer.__xoFrame = null;
        }
        this._captureNext = false;
        this._frames.push(frame);
        while (this._frames.length > this.options.capacity) {
            this._releaseFrame(this._frames.shift()!);
        }
        this._raise("frame", frame);
    }

    private _releaseFrame(frame: RenderFrameRecord) {
        if (frame.thumb) {
            frame.thumb.width = frame.thumb.height = 0;
            frame.thumb = null;
        }
        if (frame.fpGrid) {
            for (const layer of frame.fpGrid) {
                if (layer?.canvas) {
                    layer.canvas.width = layer.canvas.height = 0;
                }
            }
            frame.fpGrid = null;
        }
    }

    // ── descriptors (never carry pixels) ─────────────────────────────────────

    /** Mirrors `_resolveRenderView` using public OSD viewport API only. */
    private _readViewportView(drawer: any) {
        const viewport = drawer?.viewport;
        if (!viewport) {
            return null;
        }
        try {
            return {
                bounds: viewport.getBoundsNoRotateWithMargins(true),
                center: viewport.getCenter?.(true),
                rotation: viewport.getRotation(true) * Math.PI / 180,
                zoom: viewport.getZoom(true),
            };
        } catch (e) {
            return null;
        }
    }

    private _describeView(view: any) {
        if (!view || typeof view !== "object" || !view.bounds) {
            return null;
        }
        const b = view.bounds;
        return {
            bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
            center: view.center ? { x: view.center.x, y: view.center.y } : null,
            rotationDeg: typeof view.rotation === "number" ? view.rotation * 180 / Math.PI : null,
            zoom: view.zoom ?? null,
        };
    }

    private _describeImages(tiledImages: any[], countOnly: boolean) {
        if (!Array.isArray(tiledImages)) {
            return [];
        }
        return tiledImages.map((ti: any, index: number) => ({
            index,
            // Never key per-source state by source.url — DICOMweb shares baseUrl.
            tileSourceId: ti?.source?.tileSourceId ?? null,
            opacity: ti?.getOpacity?.() ?? null,
            packCount: ti?.__flexPackCount ?? 1,
            baseLayer: typeof ti?.__flexBaseLayer === "number" ? ti.__flexBaseLayer : index,
            synthetic: !!ti?.__synthetic,
            countOnly: countOnly || undefined,
            tilesToDraw: countOnly ? undefined : (ti?.getTilesToDraw?.()?.length ?? null),
        }));
    }

    private _describeFirstPass(packages: any[]) {
        if (!Array.isArray(packages)) {
            return [];
        }
        const withTiles = this.options.tiles;
        return packages.map((p: any) => ({
            dataIndex: p.dataIndex,
            stencilIndex: p.stencilIndex,
            packIndex: p.packIndex,
            tiles: p.tiles?.length ?? 0,
            vectors: p.vectors?.length ?? 0,
            diagnostics: p.diagnostics?.length ?? 0,
            polygons: p.polygons?.length ?? 0,
            tileKeys: withTiles
                ? (p.tiles || []).map((t: any) => ({ l: t.tile?.level, x: t.tile?.x, y: t.tile?.y }))
                : undefined,
        }));
    }

    private _describeSecondPass(packages: any[]) {
        if (!Array.isArray(packages)) {
            return [];
        }
        return packages.map((p: any) => {
            const config = p.shader?.getConfig?.() || {};
            return {
                id: p.shader?.id ?? null,
                type: config.type ?? null,
                visible: config.visible !== false && config.visible !== 0,
                error: !!config.error,
                opacity: p.opacity,
                pixelSize: p.pixelSize,
                zoom: p.zoom,
            };
        });
    }

    private _describePassOutput(out: any, options: any) {
        if (!out) {
            return null;
        }
        return {
            textureDepth: out.textureDepth ?? null,
            stencilDepth: out.stencilDepth ?? null,
            rendered: out.rendered !== false,
            reason: out.reason ?? undefined,
            toFramebuffer: !!options?.framebuffer,
            target: options?.framebuffer ? { width: options.width, height: options.height } : undefined,
        };
    }

    private _describePackLayout(renderer: any) {
        const layout = renderer?.__flexPackInfo?.layout;
        if (!layout) {
            return undefined;
        }
        return {
            totalLayers: layout.totalLayers,
            packCount: Array.isArray(layout.packCount) ? layout.packCount.slice() : undefined,
            baseLayer: Array.isArray(layout.baseLayer) ? layout.baseLayer.slice() : undefined,
        };
    }

    private _labelOf(drawer: any) {
        return this._sources.get(drawer)?.label ?? (drawer?.viewer?.uniqueId || "viewport");
    }

    // ── result imagery ───────────────────────────────────────────────────────

    private _thumbnail(source: any): HTMLCanvasElement | null {
        if (!source?.width || !source?.height) {
            return null;
        }
        try {
            const scale = Math.min(1, THUMB_MAX_PX / Math.max(source.width, source.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(source.width * scale));
            canvas.height = Math.max(1, Math.round(source.height * scale));
            canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
            return canvas;
        } catch (e) {
            return null;
        }
    }

    /**
     * Tier 2 — read back the first-pass array layers of a captured frame and
     * turn them into per-layer canvases. This is the in-app replacement for the
     * library's `_showOffscreenMatrix` popup.
     *
     * A viewport drawer has no extraction API, so the read is routed through the
     * viewer's off-screen drawer using the second-pass-reuse branch: that copies
     * the viewport's first-pass textures into the off-screen context, where they
     * can be read layer by layer.
     */
    async grabFirstPassLayers(frame: RenderFrameRecord, kind: "texture" | "stencil" = "texture") {
        const source = this.sources.find(s => s.id === frame.sourceId);
        if (!source) {
            throw new Error("Render source is gone.");
        }

        this._internal = true;
        try {
            let drawer = source.drawer;
            if (source.kind !== "offscreen") {
                drawer = this._ensureExtractionDrawer(source);
                const viewer = source.drawer.viewer;
                const images = viewer?.world
                    ? [...Array(viewer.world.getItemCount()).keys()].map(i => viewer.world.getItemAt(i))
                    : [];
                await drawer.drawWithConfiguration(images, undefined, source.drawer, {
                    x: source.drawer.canvas.width, y: source.drawer.canvas.height
                });
            }

            const fp = drawer.renderer?.__firstPassResult;
            const depth = kind === "stencil" ? (fp?.stencilDepth ?? 0) : (fp?.textureDepth ?? 0);
            const grid: any[] = [];
            for (let layerIndex = 0; layerIndex < depth; layerIndex++) {
                // "canvas" would hand back the shared scratch canvas for every
                // layer, so take the ImageData and own a copy per layer.
                const data = await drawer.extract({ mode: "first-pass-layer", kind, layerIndex, result: "imageData" });
                const canvas = document.createElement("canvas");
                canvas.width = data.width;
                canvas.height = data.height;
                canvas.getContext("2d")!.putImageData(data, 0, 0);
                grid.push({ kind, layerIndex, canvas });
            }
            frame.fpGrid = grid;
            this._raise("frame", frame);
            return grid;
        } finally {
            this._internal = false;
        }
    }

    private _ensureExtractionDrawer(source: RenderDebugSource) {
        const viewer = source.drawer.viewer;
        const osd: any = OpenSeadragon as any;
        if (typeof osd.makeStandaloneFlexDrawer !== "function") {
            throw new Error("OpenSeadragon.makeStandaloneFlexDrawer is not available.");
        }
        if (!viewer.__ofscreenRender) {
            viewer.__ofscreenRender = osd.makeStandaloneFlexDrawer(viewer);
            this.registerDrawer(viewer.__ofscreenRender, { label: "shared-offscreen", viewer, kind: "offscreen" });
        }
        return viewer.__ofscreenRender;
    }

    // ── export ───────────────────────────────────────────────────────────────

    exportJson() {
        const payload = this._frames.map(({ thumb, fpGrid, ...rest }) => rest);
        UTILITIES.downloadAsFile("render-debug.json", JSON.stringify(payload, null, 2));
    }

    // ── UI entry ─────────────────────────────────────────────────────────────

    /**
     * Mount the "Render debug" entry in the app-bar Tools category. No-op unless
     * dev mode is on — the panel and all its hooks stay unreachable otherwise.
     */
    registerToolsMenu() {
        if (this._toolsRegistered || !this.available) {
            return;
        }
        const Tools = USER_INTERFACE.AppBar?.Tools;
        if (!Tools?.register) {
            return;
        }
        this._toolsRegistered = true;
        Tools.register("core.renderDebug", {
            section: "diagnostics",
            sectionTitle: $.t("renderDebug.section"),
            icon: "ph-bug",
            label: $.t("renderDebug.tool"),
            hint: $.t("renderDebug.toolHint"),
            onClick: () => this.openWindow(),
        });
    }

    /** Lazily build the debug window; capture is bound to its visibility. */
    openWindow() {
        if (!this._window) {
            const panel = new UI.RenderDebugPanel({ id: "render-debug-panel" });
            this._window = new UI.DockableWindow({
                    id: "render-debug",
                    title: $.t("renderDebug.title"),
                    icon: "ph-bug",
                    defaultMode: "floating",
                    floating: { width: 860, height: 540, resizable: true, closable: true },
                },
                panel
            );
            USER_INTERFACE.addHtml(this._window, "render-debug");
            this._window.visibilityManager?.onChange?.((visible: boolean) => {
                if (visible) {
                    this.activate();
                } else {
                    this.deactivate();
                }
            });
        }
        this._window.open();
        this.activate();
    }
}
