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

    const cellEl = document.createElement("div");
    cellEl.style.position = "absolute";
    cellEl.style.inset = "0";
    centerWrap.appendChild(cellEl);

    const navigatorEl = document.createElement("div");
    navigatorEl.style.position = "absolute";
    navigatorEl.style.right = "8px";
    navigatorEl.style.top = "8px";
    navigatorEl.style.width = "180px";
    navigatorEl.style.height = "120px";
    navigatorEl.style.zIndex = "5";
    navigatorEl.style.pointerEvents = "auto";
    centerWrap.appendChild(navigatorEl);

    // Right-side menu host: the RightSideViewerMenu's root is `position: absolute`
    // (designed to overlay the OSD cell, like the main app does), so we mount it as
    // a sibling overlay inside centerWrap rather than as a separate flex column —
    // otherwise the absolute element collapses to its content height inside a flex
    // column and the menu disappears. See ui/classes/components/rightSideViewerMenu.mjs.
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

        try {
            viewerHandle = setupIsolatedViewer({
                cellEl,
                navigatorEl,
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

        // Mount scoped right-side menu (no AppBar pollution, custom viewer resolver).
        const UI = (window as any).UI;
        if (UI?.RightSideViewerMenu) {
            try {
                menuInstance = new UI.RightSideViewerMenu(
                    cellEl.id,
                    navigatorEl.id,
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
                menuOverlay.appendChild(menuInstance.create());
                menuInstance.init(viewerHandle.viewer);
            } catch (e) {
                console.error("[PlaygroundPage] failed to mount RightSideViewerMenu", e);
            }
        } else {
            const note = document.createElement("div");
            note.className = "p-4 text-sm";
            note.textContent = "RightSideViewerMenu unavailable; UI namespace missing.";
            menuOverlay.appendChild(note);
        }

        // Open the source viewer's primary tile image in the playground viewer so
        // the user sees the same slide. v2 will replace this with a full
        // visualization-pipeline apply.
        openSourceMirror(viewerHandle.viewer, init);

        // Edit watcher: any 'cache-applied' / shader UI mutation should mark dirty.
        // FlexRenderer raises 'render' on every redraw; we instead listen for a
        // small set of explicit edit signals to avoid spamming dirty=true.
        const watchEdits = (eventName: string) => {
            try { viewerHandle?.viewer?.addHandler?.(eventName, markEdited); } catch (e) { /* noop */ }
        };
        watchEdits("shader-config-update");
        watchEdits("shader-config-cache-update");
        watchEdits("layer-property-changed");

        // Restore initial liveState if provided (draft restore path).
        if (init.initialLiveState) {
            try {
                (window as any).UTILITIES?.importLiveVisualization?.(viewerHandle.viewer, init.initialLiveState);
                // Restored draft IS dirty (it has unsaved edits).
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
            return utils.exportLiveVisualization(viewerHandle.viewer);
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
 * Open the same primary tile image as the source viewer in the playground
 * viewer, so the user sees the slide. This is a deliberate v1 simplification —
 * visualization layers / FlexRenderer shader bindings are NOT applied.
 */
function openSourceMirror(playgroundViewer: any, init: PlaygroundPageInit) {
    if (!playgroundViewer) return;
    const VM: any = (window as any).VIEWER_MANAGER;
    const sourceViewer = init.sourceViewerUniqueId && VM
        ? VM.getViewer?.(init.sourceViewerUniqueId, false)
        : undefined;

    if (sourceViewer && sourceViewer.world?.getItemAt) {
        const primary = sourceViewer.world.getItemAt(0);
        if (primary && primary.source) {
            try {
                playgroundViewer.open([{ tileSource: primary.source, opacity: 1 }]);
                return;
            } catch (e) {
                console.warn("[PlaygroundPage] open by source-clone failed, falling back", e);
            }
        }
    }

    // Last-ditch: nothing to mirror. Show a notice.
    const note = document.createElement("div");
    note.className = "p-4 text-sm absolute inset-0 flex items-center justify-center";
    note.textContent = $t(
        "playground.previewRenderingPending",
        "Playground preview rendering is a pending feature. Use Copy to clipboard to export the current visualization.",
    );
    playgroundViewer.element?.appendChild?.(note);
}
