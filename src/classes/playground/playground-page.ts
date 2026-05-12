/**
 * One isolated viewer + visualization editor instance for a single playground tab.
 *
 * Owns:
 *   - the page DOM (center cell + navigator cell + right-rail menu host)
 *   - an isolated OSD viewer (via setupIsolatedViewer)
 *   - a scoped RightSideViewerMenu (with skipAppBarRegistration)
 *   - dirty/copied state tracking for the modal's close-confirm + draft logic
 *
 * NOTE (v1 limitation): the FULL visualization pipeline lives in
 * src/classes/app/viewer-open-pipeline.ts and is tightly coupled to
 * APPLICATION_CONTEXT.config + VIEWER_MANAGER. Spinning up a sandboxed viewer
 * with a deep-cloned visualization without touching that global state requires
 * extracting the per-viewer apply path, which is a separate, larger change.
 *
 * For v1 this page:
 *   - mounts an isolated viewer in the modal,
 *   - opens the same primary tile-image as the source viewer (so the slide is visible),
 *   - mounts the right-rail editor (visible, scoped — no AppBar pollution),
 *   - exposes getLiveState() / getVisualization() so the action bar can read the
 *     current state and apply it to the source viewer via UTILITIES.importLiveVisualization,
 *   - tracks dirty/copied flags via a debounced edit watcher.
 *
 * Structural visualization edits (adding/removing layers, changing types) are
 * out of scope until the open-pipeline is refactored — see follow-up TODO.
 */

import { setupIsolatedViewer, type IsolatedViewerHandle } from "../app/setup-isolated-viewer";
import { assembleBackgroundShaders, assembleVisualizationShaders } from "../app/assemble-render-output";
import {
    serializeSceneFromViewer,
    type CanonicalBackground,
    type CanonicalVisualization,
} from "../app/canonical-scene";

export interface PlaygroundPageInit {
    /** Stable id (used for draft persistence and result keying). */
    id: string;
    /** Tab title shown in the strip. */
    title: string;
    /** Optional uniqueId of the source viewer (the one we'll apply edits back to). */
    sourceViewerUniqueId?: string;
    /** The visualization config the page starts with. Will be deep-cloned. */
    visualization: any;
    /** Background config(s). */
    background?: any[];
    /** Data registry. */
    data?: any[];
    /** Optional initial liveState payload to import on boot (draft restore). */
    initialLiveState?: any;
    /**
     * Full post-mutation parent-session snapshot (LLM-review path). When
     * present, `openSourceMirror` assembles the renderer config from
     * `snapshot.background` + `snapshot.visualizations[activeIndex]` via the
     * shared `assembleRenderOutput` helper — same logic the production
     * open-pipeline runs, so the playground's render is pixel-identical to
     * what the source viewer will show after Accept. When absent, the page
     * falls back to the legacy `visualization`+`background` fields used by
     * the user-driven Edit-menu flow.
     */
    snapshot?: any;
}

export interface PlaygroundPageHandle {
    readonly id: string;
    readonly title: string;
    readonly sourceViewerUniqueId: string | undefined;
    readonly viewer: any;

    activate(): void;
    deactivate(): void;
    isDirty(): boolean;
    markCopied(): void;
    isCopiedSinceLastEdit(): boolean;
    /** Returns the edited visualization config (clone merged with current cache/state). */
    getVisualization(): any;
    /**
     * Returns the edited slice this page is rendering, in the canonical scene
     * shape. `background` is a fresh array (mirrors `init.background`) with each
     * shader's runtime cache/state/type merged in via the canonical
     * serializer. `visualization` is the page's active viz with runtime state
     * merged. Used by Apply to write back to the source viewer via
     * `deserializeScene` / `APPLICATION_CONTEXT.openViewerWith`.
     */
    getScene(): { background: CanonicalBackground[]; visualization: CanonicalVisualization | undefined };
    /** Returns UTILITIES.exportLiveVisualization(viewer) for the playground viewer. */
    getLiveState(): any;
    /**
     * Convenience for review/scripting flows: returns `{ visualization, liveState }`
     * where `visualization.shaders[id].cache/state` is merged with the runtime
     * live state, so the result is self-contained and round-trippable.
     */
    getEditedPayload(): { visualization: any; liveState: any };
    /** Per-tab DOM root, for mounting into the tab body. */
    getRoot(): HTMLElement;
    /** Subscribe to dirty-state changes (debounced). */
    onDirtyChange(fn: (dirty: boolean) => void): () => void;
    dispose(): void;
}

const HTML_NS_KEY = "xopat-playground-page";
let pageCounter = 0;

export function createPlaygroundPage(init: PlaygroundPageInit): PlaygroundPageHandle {
    const initialVisualizationClone = deepClone(init.visualization);

    // --- Root layout ----------------------------------------------------
    const root = document.createElement("div");
    root.setAttribute("data-kind", HTML_NS_KEY);
    root.style.position = "relative";
    root.style.width = "100%";
    root.style.height = "100%";
    root.style.display = "flex";
    root.style.flexDirection = "row";

    // Center: viewer host
    const centerWrap = document.createElement("div");
    centerWrap.style.flex = "1 1 auto";
    centerWrap.style.position = "relative";
    centerWrap.style.minWidth = "0";
    centerWrap.style.minHeight = "0";
    centerWrap.style.height = "100%";
    centerWrap.style.background = "var(--fallback-b3, #111)";
    root.appendChild(centerWrap);

    // Stable IDs for OSD lookups. Generated upfront so the menu and the viewer
    // agree on the same navigator-host id.
    const cellId = `xopat-pg-cell-${++pageCounter}`;
    const navigatorId = `${cellId}-navigator`;

    const cellEl = document.createElement("div");
    cellEl.id = cellId;
    cellEl.style.position = "absolute";
    cellEl.style.inset = "0";
    centerWrap.appendChild(cellEl);

    // Right-side menu host: the RightSideViewerMenu's root is `position: absolute`
    // (designed to overlay the OSD cell, like the main app does), so we mount it as
    // a sibling overlay inside centerWrap rather than as a separate flex column —
    // otherwise the absolute element collapses to its content height inside a flex
    // column and the menu disappears. See ui/classes/components/rightSideViewerMenu.mjs.
    //
    // The menu's NavigatorSideMenu also creates the navigator host element with
    // id=navigatorId. We mount the menu BEFORE constructing the OSD viewer so the
    // navigator host is in the DOM by the time OSD looks it up by id.
    const menuOverlay = document.createElement("div");
    menuOverlay.style.position = "absolute";
    menuOverlay.style.top = "0";
    menuOverlay.style.right = "0";
    menuOverlay.style.bottom = "0";
    menuOverlay.style.width = "400px";
    menuOverlay.style.maxWidth = "40%";
    menuOverlay.style.zIndex = "10";
    menuOverlay.style.pointerEvents = "auto";
    centerWrap.appendChild(menuOverlay);

    // Per-page shader-id namespace. FlexRenderer DOM ids are derived from the
    // shader id (e.g. `${shader.id}_${controlName}`); without a unique prefix
    // the playground's controls collide with the parent right-rail's controls
    // (noUiSlider "already initialized", colormap `Float32Array.from(undefined)`).
    // We add this prefix when building the playground renderer config and
    // strip it back off in getLiveState() / getVisualization() so callers see
    // un-namespaced ids that match init.visualization and the source viewer.
    const namespace = buildShaderIdNamespace(init.id);

    // --- State ----------------------------------------------------------
    let viewerHandle: IsolatedViewerHandle | undefined;
    let menuInstance: any = null;
    let activated = false;
    let disposed = false;

    let dirty = false;
    let copiedSinceLastEdit = false;
    const dirtyListeners = new Set<(d: boolean) => void>();
    const fireDirtyChange = (next: boolean) => {
        if (dirty === next) return;
        dirty = next;
        for (const fn of [...dirtyListeners]) {
            try { fn(next); } catch (e) { console.warn("[PlaygroundPage] dirty listener threw", e); }
        }
    };

    const markEdited = () => {
        copiedSinceLastEdit = false;
        if (!dirty) fireDirtyChange(true);
    };

    // --- Lazy activation ------------------------------------------------
    const activate = () => {
        if (activated || disposed) return;
        activated = true;

        // 1) Mount the right-side menu FIRST. Its NavigatorSideMenu creates a
        //    container with id=navigatorId — OSD looks that id up at viewer
        //    construction time, so it must already be in the DOM.
        const UI = (window as any).UI;
        if (UI?.RightSideViewerMenu) {
            try {
                menuInstance = new UI.RightSideViewerMenu(
                    cellId,
                    navigatorId,
                    {
                        skipAppBarRegistration: true,
                        viewerResolver: () => viewerHandle?.viewer,
                        onShaderChange: () => {
                            // Sandbox: do NOT mutate APPLICATION_CONTEXT or call openViewerWith.
                            // Structural visualization swaps require the v2 pipeline extraction.
                            const Dialogs = (window as any).Dialogs;
                            Dialogs?.show?.(
                                $t("playground.structuralChangeNotSupported", "Structural visualization changes are not yet supported in the playground."),
                                4000,
                                Dialogs?.MSG_INFO,
                            );
                        },
                        onOpacityChange: () => {/* no-op in sandbox */},
                        onCacheSnapshotByName: () => {/* no-op in sandbox */},
                        onCacheSnapshotByOrder: () => {/* no-op in sandbox */},
                    },
                );
                const menuRoot = menuInstance.create() as HTMLElement;
                // RightSideViewerMenu renders with `position: absolute; width: 400px;
                // overflow-y: auto;` but no top/bottom inset and no height — so its
                // own overflow-y never engages and tall menus push past the modal,
                // hiding the action footer. In the playground we own the host
                // overlay, so stretch the menu to fill it; production layouts
                // (AppBar.View) keep their existing geometry untouched.
                try {
                    menuRoot.style.top = "0";
                    menuRoot.style.bottom = "0";
                    menuRoot.style.maxHeight = "100%";
                } catch (e) { /* noop */ }
                menuOverlay.appendChild(menuRoot);
            } catch (e) {
                console.error("[PlaygroundPage] failed to mount RightSideViewerMenu", e);
            }
        } else {
            const note = document.createElement("div");
            note.className = "p-4 text-sm";
            note.textContent = "RightSideViewerMenu unavailable; UI namespace missing.";
            menuOverlay.appendChild(note);
        }

        // 2) Resolve the navigator-host element the menu just appended.
        const navigatorHost = document.getElementById(navigatorId) as HTMLElement | null;
        if (!navigatorHost) {
            console.warn(`[PlaygroundPage] navigator host #${navigatorId} not found in DOM — navigator will be unavailable`);
        }

        // 3) Now create the OSD viewer. It will mount the navigator into the
        //    menu's nav host element (the same element rendered in the menu's
        //    "Navigator" tab).
        try {
            viewerHandle = setupIsolatedViewer({
                cellEl,
                navigatorEl: navigatorHost || cellEl, // fallback so OSD doesn't crash
                cellId,
                htmlHandler: (shaderLayer: any, shaderConfig: any, htmlContext: any) => {
                    try {
                        menuInstance?.getShadersTab?.()?.createLayer?.(viewerHandle?.viewer, shaderLayer, shaderConfig, htmlContext);
                    } catch (e) {
                        console.warn("[PlaygroundPage] htmlHandler failed", e);
                    }
                },
                htmlReset: () => {
                    try { menuInstance?.getShadersTab?.()?.clearLayers?.(); } catch (e) { /* noop */ }
                },
            });
        } catch (e) {
            console.error("[PlaygroundPage] failed to spawn isolated viewer", e);
            renderViewerSetupError(centerWrap, e);
            return;
        }

        // 4) Attach the side menu to the now-live viewer (this wires the
        //    shaders-tab's per-layer UI handlers).
        try {
            menuInstance?.init?.(viewerHandle.viewer);
        } catch (e) {
            console.error("[PlaygroundPage] menu.init failed", e);
        }

        // 5) Lock the side-menu tabs open. RightSideViewerMenu's constructor
        //    seeds each tab's open/closed state from APPLICATION_CONTEXT.AppCache,
        //    and MultiPanelMenuTab.focus() / closeButton.onClick write back to
        //    that same cache when toggled. In the playground the side menu IS
        //    the proposal preview, so collapsing it is meaningless and the
        //    cache write leaks playground UX state into the parent app's
        //    persisted preferences (closed-by-default thereafter, even outside
        //    the playground). Force-open every tab, neutralize the close
        //    paths, and hide the X button.
        try {
            const tabs = (menuInstance as any)?.menu?.tabs || {};
            for (const id of Object.keys(tabs)) {
                const tab: any = tabs[id];
                if (!tab) continue;
                // Playground only surfaces the shaders editor in the side rail. The
                // navigator host element still has to live in the DOM so the OSD
                // viewer can mount its navigator widget into it (see step 3 above);
                // we hide the tab's own UI but keep the host attached.
                if (id === "navigator") {
                    try { tab.hide?.(); } catch (e) { /* noop */ }
                    continue;
                }
                try { tab._setFocus?.(); } catch (e) { /* noop */ }
                tab._removeFocus = () => { /* locked open in playground */ };
                if (typeof tab.focus === "function") {
                    tab.focus = () => { try { tab._setFocus?.(); } catch (e) { /* noop */ } };
                }
                try { tab.closeButton?.setClass?.("display", "display-none"); } catch (e) { /* noop */ }
            }
        } catch (e) {
            console.warn("[PlaygroundPage] failed to lock side-menu tabs open", e);
        }

        // Open the source viewer's slide in the playground viewer and apply the
        // playground's own visualization (init.visualization) on top — so the
        // user sees the proposed/edited config rendered, not whatever the source
        // viewer is currently displaying.
        openSourceMirror(viewerHandle.viewer, init, namespace);

        // Edit watcher: any 'cache-applied' / shader UI mutation should mark dirty.
        // FlexRenderer raises 'render' on every redraw; we instead listen for a
        // small set of explicit edit signals to avoid spamming dirty=true.
        const watchEdits = (eventName: string) => {
            try { viewerHandle?.viewer?.addHandler?.(eventName, markEdited); } catch (e) { /* noop */ }
        };
        watchEdits("shader-config-update");
        watchEdits("shader-config-cache-update");
        watchEdits("layer-property-changed");

        // Restore initial liveState if provided (draft restore path / source seed).
        // Called BEFORE the renderer has been configured by overrideConfigureAll —
        // importLiveVisualization warns "missing local config for ..." for shaders
        // not yet installed and silently skips them. That is intentional: doing
        // this AFTER overrideConfigureAll causes drawer.rebuild() to re-init
        // newly configured shaders without the htmlHandler/htmlContext that
        // overrideConfigureAll's first init wired up, breaking the first draw.
        // Drafts re-apply via the side-rail state on subsequent edits, so the
        // visible-cache delta is small.
        if (init.initialLiveState) {
            try {
                const namespaced = addNamespaceToLiveState(init.initialLiveState, namespace);
                (window as any).UTILITIES?.importLiveVisualization?.(viewerHandle.viewer, namespaced);
                markEdited();
            } catch (e) {
                console.warn("[PlaygroundPage] importLiveVisualization (initial) failed", e);
            }
        }
    };

    const deactivate = () => { /* keep state; switching tabs should not destroy */ };

    const getLiveState = () => {
        const utils = (window as any).UTILITIES;
        if (!viewerHandle || !utils?.exportLiveVisualization) return undefined;
        try {
            const raw = utils.exportLiveVisualization(viewerHandle.viewer);
            return stripNamespaceFromLiveState(raw, namespace);
        } catch (e) {
            console.warn("[PlaygroundPage] exportLiveVisualization failed", e);
            return undefined;
        }
    };

    const getVisualization = () => {
        // Merge the live runtime state (cache/state per layer) into a fresh clone of
        // the structural config so the returned object is self-contained — callers
        // can hand it to APPLICATION_CONTEXT.openViewerWith without needing to also
        // forward live state.
        const cloned = deepClone(initialVisualizationClone);
        const live = getLiveState();
        if (cloned && live?.layers && cloned.shaders) {
            mergeLiveStateIntoShaderMap(cloned.shaders, live.layers);
        }
        return cloned;
    };

    const getScene = (): { background: CanonicalBackground[]; visualization: CanonicalVisualization | undefined } => {
        // Canonical serializer: bg shaders are an ARRAY whose renderer ids are
        // derived (`bgRef.id`, `${bgRef.id}-N`); the helper knows the formula
        // and merges live cache/state into the right structural slots — fixing
        // the silent no-op of the previous getBackground impl that walked
        // bg.shaders as if it were a map.
        if (!viewerHandle?.viewer) {
            return {
                background: Array.isArray(init.background) ? deepClone(init.background) : [],
                visualization: init.visualization ? deepClone(init.visualization) : undefined,
            };
        }
        // getLiveState() already strips the page namespace, so live keys match
        // the structural shader ids in init.background / init.visualization.
        const live = getLiveState();
        return serializeSceneFromViewer(viewerHandle.viewer, {
            background: init.background,
            visualization: init.visualization,
        }, live ?? null);
    };

    const getEditedPayload = () => ({
        visualization: getVisualization(),
        liveState: getLiveState(),
    });

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        dirtyListeners.clear();
        try { menuInstance?.destroy?.(); } catch (e) { /* noop */ }
        menuInstance = null;
        try { viewerHandle?.dispose?.(); } catch (e) { /* noop */ }
        viewerHandle = undefined;
        if (root.parentNode) root.parentNode.removeChild(root);
    };

    return {
        get id() { return init.id; },
        get title() { return init.title; },
        get sourceViewerUniqueId() { return init.sourceViewerUniqueId; },
        get viewer() { return viewerHandle?.viewer; },
        activate,
        deactivate,
        isDirty: () => dirty,
        markCopied: () => { copiedSinceLastEdit = true; },
        isCopiedSinceLastEdit: () => copiedSinceLastEdit,
        getVisualization,
        getScene,
        getLiveState,
        getEditedPayload,
        getRoot: () => root,
        onDirtyChange: (fn) => {
            dirtyListeners.add(fn);
            return () => dirtyListeners.delete(fn);
        },
        dispose,
    };
}

// ---------------------------------------------------------------------------

function deepClone<T>(v: T): T {
    if (v === undefined || v === null) return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
}

/**
 * Merge per-layer cache + state from a LiveViewerPayload back into the structural
 * shader map of a VisualizationItem. Walks groups recursively. The merge is non-
 * destructive: if a live entry is missing for a layer id, the existing config
 * values are kept.
 */
function mergeLiveStateIntoShaderMap(
    shaderMap: Record<string, any>,
    liveLayers: Record<string, { cache?: any; state?: any; type?: string }>,
): void {
    for (const id in shaderMap) {
        if (!Object.prototype.hasOwnProperty.call(shaderMap, id)) continue;
        const node = shaderMap[id];
        if (!node || typeof node !== "object") continue;

        const live = liveLayers[id];
        if (live) {
            if (live.cache !== undefined) node.cache = deepClone(live.cache);
            if (live.state !== undefined) {
                node.state = { ...(node.state || {}), ...deepClone(live.state) };
            }
        }

        if (node.shaders && typeof node.shaders === "object" && !Array.isArray(node.shaders)) {
            mergeLiveStateIntoShaderMap(node.shaders, liveLayers);
        }
    }
}

function $t(key: string, fallback: string): string {
    const $: any = (window as any).$;
    try {
        const out = $?.t?.(key);
        if (typeof out === "string" && out !== key) return out;
    } catch (e) { /* noop */ }
    return fallback;
}

function renderViewerSetupError(host: HTMLElement, err: any) {
    const box = document.createElement("div");
    box.className = "alert alert-error m-4";
    box.textContent = `Failed to initialize playground viewer: ${err?.message || err}`;
    host.appendChild(box);
}

/**
 * Open the source viewer's slide in the playground and apply a FlexRenderer
 * config assembled the same way the production open-pipeline assembles its
 * renderOutput — via `assemble-render-output.ts`'s
 * `assembleBackgroundShaders` + `assembleVisualizationShaders`. The user
 * therefore sees in the modal exactly what the source viewer will show after
 * Accept (WYSIWYG).
 *
 *   - Tile sources come from the source viewer's world (the playground has no
 *     open-pipeline of its own; the slide pyramid is reused as-is).
 *   - The shared assembler walks `init.background` (or `init.snapshot.background`)
 *     and `init.visualization.shaders` (or `init.snapshot.visualizations[active]`),
 *     resolves `tiledImages` against the source viewer's `__dataToWorldIndex`
 *     map (stashed by the production pipeline at the end of openIntoViewer),
 *     and produces a renderOutput keyed under `bgRef.id` (bg) and the user-
 *     authored shader ids (viz).
 *   - Every shader id is then prefixed with the per-page namespace so its
 *     DOM controls don't collide with the parent right-rail's controls.
 *
 * Numeric refs inside shader configs (`tiledImages`, `dataReferences`, cache
 * control values) are otherwise left untouched.
 */
function openSourceMirror(playgroundViewer: any, init: PlaygroundPageInit, namespace: string) {
    if (!playgroundViewer) return;
    const VM: any = (window as any).VIEWER_MANAGER;
    const sourceViewer = init.sourceViewerUniqueId && VM
        ? VM.getViewer?.(init.sourceViewerUniqueId, false)
        : undefined;

    if (!sourceViewer?.world?.getItemAt) {
        renderMirrorNotice(playgroundViewer);
        return;
    }

    // Collect every source tiled image so the world layout matches index-for-index.
    // OSD's viewer.open() ignores per-item `index` and warns when one is supplied —
    // array order already encodes world order, which is what we want.
    const items: Array<{ tileSource: any; opacity: number }> = [];
    const itemCount = sourceViewer.world.getItemCount?.() || 0;
    for (let i = 0; i < itemCount; i++) {
        const item = sourceViewer.world.getItemAt(i);
        if (item?.source) {
            items.push({
                tileSource: item.source,
                opacity: typeof item.opacity === "number" ? item.opacity : 1,
            });
        }
    }
    if (!items.length) {
        renderMirrorNotice(playgroundViewer);
        return;
    }

    // Pull the dataIndex → worldIndex map the source viewer's open-pipeline
    // stashed at the end of its run (see viewer-open-pipeline.ts, after the
    // tile-loop). Falls back to deriving the map from the list of backgrounds
    // when the source viewer hasn't been through the pipeline yet (e.g. tests).
    const stashedEntries = (sourceViewer as any).__dataToWorldIndex;
    const dataToWorldIndex = new Map<number, number>(
        Array.isArray(stashedEntries) ? stashedEntries : []
    );
    const backgrounds = pickBackgrounds(init);
    if (!dataToWorldIndex.size && Array.isArray(backgrounds)) {
        let next = 0;
        for (const bg of backgrounds) {
            if (!bg || typeof bg.dataReference !== "number") continue;
            if (!dataToWorldIndex.has(bg.dataReference)) {
                dataToWorldIndex.set(bg.dataReference, next++);
            }
        }
    }

    const data = pickData(init);
    const activeVisualization = pickActiveVisualization(init);

    const renderOutput: Record<string, any> = {};
    const env = {
        backgrounds: backgrounds || [],
        activeVisualization,
        data,
        cloneRuntimeState: <T,>(value: T): T => {
            if (value === undefined || value === null) return value;
            try { return JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
        },
        // The playground never opens new tiles — anything missing from the
        // pre-stashed map maps to -1, which the renderer treats as "no tile".
        // In practice the source viewer has already opened every dataReference
        // the snapshot can name, so this shouldn't happen.
        resolveWorldIndex: (dataIndex: number): number => {
            const idx = dataToWorldIndex.get(dataIndex);
            return Number.isInteger(idx) ? (idx as number) : -1;
        },
        // No managed-source rerouting in the playground. Time-series and
        // shader-source-controller bindings stay on the production side; the
        // playground renders the active frame as-is.
        expandDataSourceRef: (entry: any): any => entry,
    };

    assembleBackgroundShaders(env, renderOutput);
    assembleVisualizationShaders(env, renderOutput);

    if (!Object.keys(renderOutput).length) {
        try { playgroundViewer.open(items); } catch (e) { /* swallow */ }
        renderMirrorNotice(playgroundViewer);
        return;
    }

    const renamedMap = renameShaderIds(renderOutput, namespace);
    const renamedOrder = Object.keys(renderOutput).map(id => namespace + id);

    try {
        playgroundViewer.open(items);
    } catch (e) {
        console.warn("[PlaygroundPage] viewer.open(mirrored items) failed", e);
        renderMirrorNotice(playgroundViewer);
        return;
    }

    // Apply the renamed shader map after the world is populated. The FlexRenderer
    // wires htmlHandler per layer here, which builds the side-menu rows with
    // namespaced ids — no DOM id collision with the parent viewer's controls.
    const apply = () => {
        try {
            playgroundViewer.drawer?.overrideConfigureAll?.(renamedMap, renamedOrder);
        } catch (e) {
            console.warn("[PlaygroundPage] overrideConfigureAll failed", e);
        }
    };
    if (typeof playgroundViewer.addOnceHandler === "function") {
        playgroundViewer.addOnceHandler("open", apply);
    } else {
        setTimeout(apply, 0);
    }
}

/**
 * Backgrounds aren't part of `VisualizationStateSnapshot`; they come in via
 * `init.background` (forwarded by playground-service from
 * `options.source.background`). Falls back to the global session config so
 * the user-driven Edit-menu flow still works without a snapshot.
 */
function pickBackgrounds(init: PlaygroundPageInit): any[] | undefined {
    if (Array.isArray(init.background)) return init.background;
    const APP: any = (window as any).APPLICATION_CONTEXT;
    return Array.isArray(APP?.config?.background) ? APP.config.background : undefined;
}

function pickData(init: PlaygroundPageInit): any[] {
    const fromSnapshot = init.snapshot?.data;
    if (Array.isArray(fromSnapshot)) return fromSnapshot;
    if (Array.isArray(init.data)) return init.data;
    const APP: any = (window as any).APPLICATION_CONTEXT;
    return Array.isArray(APP?.config?.data) ? APP.config.data : [];
}

/**
 * Snapshot path takes precedence: when a full VisualizationStateSnapshot is
 * supplied, the playground inherits the parent session's active visualization
 * from there. Legacy `init.visualization` is used otherwise.
 */
function pickActiveVisualization(init: PlaygroundPageInit): any | undefined {
    if (init.snapshot && Array.isArray(init.snapshot.visualizations)) {
        const idx = pickActiveIndex(init.snapshot.activeVisualizationIndex);
        return init.snapshot.visualizations[idx];
    }
    return init.visualization;
}

function pickActiveIndex(value: any): number {
    if (Array.isArray(value)) {
        for (const entry of value) {
            if (Number.isInteger(entry)) return entry as number;
        }
    } else if (Number.isInteger(value)) {
        return value as unknown as number;
    }
    return 0;
}

/**
 * Builds the per-page id prefix. FlexRenderer's `idPattern` rejects ids that
 * start with `_` or contain `__`, so we use `pg<n>_` and rely on the original
 * shader id (also pattern-conformant) as the suffix.
 */
function buildShaderIdNamespace(pageId: string): string {
    const safePid = String(pageId).replace(/[^A-Za-z0-9]/g, "");
    return `pg${safePid || "0"}_`;
}

/**
 * Recursively renames shader-map keys, each shader's `.id`, group children's
 * `shaders` keys + ids, and `order` arrays. Returns a NEW map; the input is
 * not mutated.
 */
function renameShaderIds(map: Record<string, any>, namespace: string): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [origId, value] of Object.entries(map)) {
        const newId = namespace + origId;
        out[newId] = renameShaderConfigInPlace(value, namespace, newId);
    }
    return out;
}

function renameShaderConfigInPlace(config: any, namespace: string, newId: string): any {
    if (!config || typeof config !== "object") return config;
    config.id = newId;
    if (config.shaders && typeof config.shaders === "object" && !Array.isArray(config.shaders)) {
        config.shaders = renameShaderIds(config.shaders, namespace);
    }
    if (Array.isArray(config.order)) {
        config.order = config.order.map((id: string) => namespace + id);
    }
    return config;
}

/**
 * Live state from FlexRenderer (UTILITIES.exportLiveVisualization) is keyed by
 * the renderer's (namespaced) shader-path strings, where each segment is one
 * shader id (top-level or nested under a group). Strip the namespace so
 * callers — draft persistence, source-viewer apply via importLiveVisualization,
 * and edited-snapshot composition — see ids matching `init.visualization` and
 * the source viewer's shader map.
 *
 * Shape contract (see src/layers.js):
 *   { layerOrder: string[], layers: { [pathString]: { id, type, cache, state } } }
 */
function stripNamespaceFromLiveState(live: any, namespace: string): any {
    if (!live || typeof live !== "object" || !live.layers || typeof live.layers !== "object") return live;
    const out: any = { ...live, layers: {} };
    for (const key in live.layers) {
        if (!Object.prototype.hasOwnProperty.call(live.layers, key)) continue;
        const strippedKey = stripNamespaceFromPath(key, namespace);
        const layer = live.layers[key];
        // Layer payload carries its own `id` field — strip the namespace there too.
        const cleanLayer = layer && typeof layer === "object" && typeof layer.id === "string"
            ? { ...layer, id: stripNamespaceFromPath(layer.id, namespace) }
            : layer;
        out.layers[strippedKey] = cleanLayer;
    }
    if (Array.isArray(live.layerOrder)) {
        out.layerOrder = live.layerOrder.map((id: string) =>
            typeof id === "string" ? stripNamespaceFromPath(id, namespace) : id);
    }
    return out;
}

/**
 * Inverse of stripNamespaceFromLiveState — used for draft restore and
 * source-viewer-state seeding, where the stored payload is un-namespaced and
 * must be re-namespaced for the current page's renderer instance (page
 * namespaces differ across sessions).
 */
function addNamespaceToLiveState(live: any, namespace: string): any {
    if (!live || typeof live !== "object" || !live.layers || typeof live.layers !== "object") return live;
    const out: any = { ...live, layers: {} };
    for (const key in live.layers) {
        if (!Object.prototype.hasOwnProperty.call(live.layers, key)) continue;
        const namespacedKey = addNamespaceToPath(key, namespace);
        const layer = live.layers[key];
        const namespacedLayer = layer && typeof layer === "object" && typeof layer.id === "string"
            ? { ...layer, id: addNamespaceToPath(layer.id, namespace) }
            : layer;
        out.layers[namespacedKey] = namespacedLayer;
    }
    if (Array.isArray(live.layerOrder)) {
        out.layerOrder = live.layerOrder.map((id: string) =>
            typeof id === "string" ? addNamespaceToPath(id, namespace) : id);
    }
    return out;
}

/** Strip the per-page namespace from every segment of a shader path. */
function stripNamespaceFromPath(path: string, namespace: string): string {
    if (typeof path !== "string" || !path) return path;
    return path.split("/").map(seg => seg.startsWith(namespace) ? seg.slice(namespace.length) : seg).join("/");
}

/** Add the per-page namespace to every segment of a shader path. */
function addNamespaceToPath(path: string, namespace: string): string {
    if (typeof path !== "string" || !path) return path;
    return path.split("/").map(seg => namespace + seg).join("/");
}

function renderMirrorNotice(playgroundViewer: any) {
    const note = document.createElement("div");
    note.className = "p-4 text-sm absolute inset-0 flex items-center justify-center";
    note.textContent = $t(
        "playground.previewRenderingPending",
        "Source viewer has no slide loaded — nothing to mirror.",
    );
    playgroundViewer?.element?.appendChild?.(note);
}
