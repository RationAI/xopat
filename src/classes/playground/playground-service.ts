/**
 * PlaygroundService — public API for opening the Visualization Playground.
 *
 * Usage (default user-driven flow):
 *   const result = await PlaygroundService.open({
 *       source: { kind: "viewer", viewer: VIEWER_MANAGER.get() },
 *   });
 *   // result.actionId === "apply" | "copy" | "close" | "dismiss"
 *   // result.pages[i] = { id, visualization, liveState }
 *
 * Usage (programmatic, custom action set):
 *   const out = await PlaygroundService.open({
 *       source: { kind: "viewer", viewer },
 *       actions: [
 *           { id: "use", label: "Use", primary: true,
 *             onClick: (ctx) => ctx.closeModal("use", ctx.activePage?.getVisualization()) },
 *           { id: "cancel", label: "Cancel", onClick: (ctx) => ctx.closeModal("cancel") },
 *       ],
 *   });
 *
 * The default action set is:
 *   - "Apply to current viewer" (only when source.kind === "viewer"; uses
 *     UTILITIES.importLiveVisualization on the live state).
 *   - "Copy to clipboard" (writes the page payload as JSON; marks page copied).
 *   - "Close" (asks for confirmation if any page is dirty AND not copied since last edit).
 *
 * When `actions` is supplied, defaults — including close-confirm and draft
 * persistence — are disabled. Custom callers own their UX.
 */

import { createPlaygroundPage, type PlaygroundPageHandle } from "./playground-page";
import { createPlaygroundModal, type ModalAction } from "./visualization-playground-modal";

export type PlaygroundActionId = string;

export interface PlaygroundActionCtx {
    activePage: PlaygroundPageHandle | undefined;
    pages: PlaygroundPageHandle[];
    closeModal: (actionId?: string, payload?: any) => void;
}

export interface PlaygroundAction {
    id: PlaygroundActionId;
    label: string;
    primary?: boolean;
    isDisabled?: (page: PlaygroundPageHandle | undefined) => boolean;
    onClick: (ctx: PlaygroundActionCtx) => any | Promise<any>;
}

export interface PlaygroundOpenOptions {
    source:
        | { kind: "viewer"; viewer: any | string }
        | { kind: "config"; data: any[]; background: any[]; visualization: any }
        // Show the source viewer's slide but with a different (proposed) visualization
        // pre-loaded — used by the LLM-review flow. The slide comes from the source
        // viewer; the side menu and getVisualization() reflect the override.
        //
        // Two shapes are supported:
        //   1. `snapshot`: a complete VisualizationStateSnapshot describing the
        //      post-mutation parent session config. The playground inherits the
        //      parent's world layout, applies the snapshot's active visualization
        //      via the shared `assembleRenderOutput` helper, and round-trips the
        //      edited result back through `composeEditedSnapshot` on accept. This
        //      is the LLM-review path; it guarantees WYSIWYG with the parent
        //      because the same assembly logic drives both the playground viewer
        //      and the production open-pipeline.
        //   2. `visualization` (legacy): a single visualization config. Used by
        //      the user-driven Edit-menu flow until that path migrates to
        //      snapshots. `background` is also accepted on this shape for the
        //      same legacy reason.
        | {
            kind: "viewer-with-override";
            viewer: any | string;
            snapshot?: any;
            visualization?: any;
            data?: any[];
            background?: any[];
            liveState?: any;
        };

    pages?: Array<{
        id?: string;
        title?: string;
        data?: any[];
        background?: any[];
        visualization: any;
        sourceViewerUniqueId?: string;
    }>;

    title?: string;
    showLeftPanel?: boolean;

    actions?: PlaygroundAction[];

    defaults?: {
        persistDrafts?: boolean;
        confirmCloseIfDirty?: boolean;
    };
}

export interface PlaygroundResult {
    actionId: PlaygroundActionId | "apply" | "copy" | "close" | "dismiss";
    pages: Array<{ id: string; visualization: any; liveState: any }>;
    visualization?: any;
    liveState?: any;
    payload?: any;
}

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DRAFT_KEY_PREFIX = "xopat:playground:draft:v1:";

let initialized = false;
let openInstanceCount = 0;

const _debugActivePages = new Set<PlaygroundPageHandle>();
const _debug = {
    /** Live PlaygroundPageHandle instances for every currently-open playground modal. */
    activePages: () => Array.from(_debugActivePages),
    /** Snapshot of the most recent proposal handed to requireVisualizationReview (clone-on-stash). */
    lastProposed: undefined as any,
    /** Source backgrounds the most recent review forwarded to the playground. */
    lastSourceBackgrounds: undefined as any,
};

function isInitialized() { return initialized; }

function init() {
    if (initialized) return;
    initialized = true;
    pruneExpiredDrafts();

    // Edit-menu entry — best effort: AppBar.Edit.subMenu.addItem may exist post-init.
    tryRegisterEditMenuEntry();
    // Canvas right-click provider.
    tryRegisterCanvasContextProvider();
}

function tryRegisterEditMenuEntry() {
    const USER_INTERFACE: any = (window as any).USER_INTERFACE;
    const Edit = USER_INTERFACE?.AppBar?.Edit;
    if (!Edit?.subMenu?.addItem) {
        // AppBar may not be ready at this exact tick — retry shortly.
        setTimeout(tryRegisterEditMenuEntry, 200);
        return;
    }
    try {
        if (typeof Edit.subMenu.addSection === "function") {
            try { Edit.subMenu.addSection({ id: "playground" }); } catch (e) { /* already exists */ }
        }
        Edit.subMenu.addItem({
            id: "open-visualization-playground",
            icon: "fa-flask",
            label: tr("playground.openFromActiveViewer", "Open Visualization Playground"),
            section: "playground",
            onClick: () => {
                const VM: any = (window as any).VIEWER_MANAGER;
                const viewer = VM?.get?.();
                if (!viewer) return true;
                openPlayground({ source: { kind: "viewer", viewer } });
                return true;
            },
        });
    } catch (e) {
        console.warn("[PlaygroundService] failed to register Edit-menu entry", e);
    }
}

function tryRegisterCanvasContextProvider() {
    const reg: any = (window as any).CanvasContextMenu;
    if (!reg?.register) {
        setTimeout(tryRegisterCanvasContextProvider, 200);
        return;
    }
    reg.register(
        "playground",
        ({ viewer }: any) => ([
            {
                icon: "fa-flask",
                title: tr("playground.openHere", "Open Visualization Playground"),
                action: () => openPlayground({ source: { kind: "viewer", viewer } }),
            },
        ]),
        10,
    );
}

async function openPlayground(options: PlaygroundOpenOptions): Promise<PlaygroundResult> {
    init();
    openInstanceCount += 1;
    try {
        const pageInits = resolvePages(options);
        if (pageInits.length === 0) {
            console.warn("[PlaygroundService] open() with no resolvable pages");
            return { actionId: "dismiss", pages: [] };
        }

        const persistDrafts = options.actions
            ? false
            : (options.defaults?.persistDrafts ?? pageInits.some((p) => !!p.sourceViewerUniqueId));
        const confirmCloseIfDirty = options.actions
            ? false
            : (options.defaults?.confirmCloseIfDirty ?? true);

        // Draft restore: if any page has a stored draft, prompt the user (in-modal toast).
        // For v1 we auto-pass `initialLiveState` to the page only after the user confirms.
        const draftRestoreMap = persistDrafts ? loadDraftsForPages(pageInits) : new Map<string, any>();

        const pages: PlaygroundPageHandle[] = pageInits.map((init) => {
            // When draft persistence is on (manual flow) AND a stored draft exists
            // for this page, the interactive draft-restore toast owns the seed —
            // force undefined so we don't auto-import on top of it. When no draft
            // exists, fall through to the source-supplied liveState so the
            // playground mirrors the user's current viewer state on first open.
            const hasDraft = persistDrafts && draftRestoreMap.has(init.id);
            return createPlaygroundPage({
                ...init,
                initialLiveState: hasDraft ? undefined : init.initialLiveState,
            });
        });
        for (const p of pages) _debugActivePages.add(p);

        // Wire draft autosave (debounced) per page.
        const draftSavers: Array<() => void> = [];
        if (persistDrafts) {
            for (const page of pages) {
                if (!page.sourceViewerUniqueId) continue;
                let pending: number | undefined;
                const save = () => {
                    if (pending !== undefined) clearTimeout(pending);
                    pending = window.setTimeout(() => {
                        try {
                            const live = page.getLiveState();
                            if (live) {
                                writeDraft(page.sourceViewerUniqueId!, page.id, {
                                    savedAt: Date.now(),
                                    visualization: page.getVisualization(),
                                    liveState: live,
                                });
                            }
                        } catch (e) {
                            console.warn("[PlaygroundService] draft save failed", e);
                        }
                    }, 500);
                };
                page.onDirtyChange((dirty) => { if (dirty) save(); });
                draftSavers.push(() => { if (pending !== undefined) clearTimeout(pending); });
            }
        }

        // Build action set.
        const actions: ModalAction[] = options.actions
            ? options.actions.map(toModalAction)
            : buildDefaultActions(pages);

        const modal = createPlaygroundModal({
            title: options.title || tr("playground.title", "Visualization Playground"),
            pages,
            actions,
            showLeftPanel: options.showLeftPanel,
            onCloseRequested: confirmCloseIfDirty
                ? () => confirmCloseIfDirtyPages(pages)
                : undefined,
        });
        modal.open();

        // Offer to restore drafts after the modal is mounted.
        if (persistDrafts && draftRestoreMap.size > 0) {
            queueRestoreToast(modal, pages, draftRestoreMap);
        }

        const closed = await modal.waitForClose();
        for (const cancel of draftSavers) cancel();

        const result: PlaygroundResult = {
            actionId: closed.reason as any,
            pages: pages.map((p) => ({
                id: p.id,
                visualization: p.getVisualization(),
                liveState: p.getLiveState(),
            })),
            payload: closed.payload,
        };
        const active = pages[0];
        if (active) {
            result.visualization = active.getVisualization();
            result.liveState = active.getLiveState();
        }

        // Cleanup pages.
        for (const p of pages) {
            _debugActivePages.delete(p);
            try { p.dispose(); } catch (e) { /* noop */ }
        }

        return result;
    } finally {
        openInstanceCount -= 1;
    }
}

// ---------------------------------------------------------------------------
// Source resolution

function resolvePages(options: PlaygroundOpenOptions) {
    const out: Array<{
        id: string;
        title: string;
        sourceViewerUniqueId?: string;
        visualization: any;
        background?: any[];
        data?: any[];
        initialLiveState?: any;
        snapshot?: any;
    }> = [];

    if (Array.isArray(options.pages) && options.pages.length > 0) {
        for (let i = 0; i < options.pages.length; i++) {
            const p = options.pages[i]!;
            out.push({
                id: p.id || `page-${i}`,
                title: p.title || `Tab ${i + 1}`,
                sourceViewerUniqueId: p.sourceViewerUniqueId,
                visualization: p.visualization,
                background: p.background,
                data: p.data,
            });
        }
        return out;
    }

    if (options.source.kind === "viewer") {
        const VM: any = (window as any).VIEWER_MANAGER;
        const viewer = typeof options.source.viewer === "string"
            ? VM?.getViewer?.(options.source.viewer, false)
            : options.source.viewer;
        if (!viewer) return out;
        const seed = buildUserDrivenViewerPageSeed(viewer);
        if (!seed) return out;
        out.push(seed);
        return out;
    }

    if (options.source.kind === "viewer-with-override") {
        const VM: any = (window as any).VIEWER_MANAGER;
        const viewer = typeof options.source.viewer === "string"
            ? VM?.getViewer?.(options.source.viewer, false)
            : options.source.viewer;
        if (!viewer) return out;

        // Snapshot path (LLM-review): forward the full snapshot AND derive the
        // legacy `visualization` field from snapshot.visualizations[active] so
        // older code paths that read `init.visualization` (the side-rail's
        // initial render of the active layer set, draft-restore key, etc.)
        // still see something coherent.
        const snapshot = options.source.snapshot;
        let visualization = options.source.visualization;
        let background = options.source.background;
        let data = options.source.data;
        if (snapshot && typeof snapshot === "object") {
            const idx = pickActiveIndex(snapshot.activeVisualizationIndex);
            const activeViz = Array.isArray(snapshot.visualizations) ? snapshot.visualizations[idx] : undefined;
            visualization = visualization ?? activeViz;
            data = data ?? snapshot.data;
        }

        out.push({
            id: `viewer-override-${viewer.uniqueId || viewer.id || "0"}`,
            title: (visualization?.name as string) || "Proposed visualization",
            sourceViewerUniqueId: viewer.uniqueId,
            visualization,
            background,
            data,
            initialLiveState: options.source.liveState,
            snapshot,
        });
        return out;
    }

    if (options.source.kind === "config") {
        out.push({
            id: "page-0",
            title: "Tab 1",
            visualization: options.source.visualization,
            background: options.source.background,
            data: options.source.data,
        });
    }
    return out;
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
 * Build a playground-page seed from the user's currently active viewer.
 *
 * Mirrors the LLM-review (`viewer-with-override`) data prep:
 *   - full session snapshot (data + visualizations + activeVisualizationIndex)
 *     from APPLICATION_CONTEXT.config so the assembler in playground-page can
 *     resolve every shader's data references the same way the production
 *     pipeline does;
 *   - backgrounds collected from the viewer's world (NOT the global pool),
 *     matching what the source viewer is actually rendering;
 *   - live state exported from FlexRenderer so user edits made in the source
 *     side-rail (slider values, opacities, colormaps) are seeded into the
 *     playground viewer instead of being lost.
 *
 * Falls back to the persisted-config visualization when the world hasn't
 * been opened yet (rare; e.g. very early init paths).
 */
function buildUserDrivenViewerPageSeed(viewer: any) {
    if (!viewer) return null;
    const APP: any = (window as any).APPLICATION_CONTEXT;
    const cfg = APP?.config || {};
    const visualizations: any[] = Array.isArray(cfg.visualizations) ? cfg.visualizations : [];
    if (!visualizations.length) return null;

    const rawIdx = APP?.getOption?.("activeVisualizationIndex", undefined, true, true);
    const activeVisualizationIndex = normalizeActiveVisualizationIndex(rawIdx);
    const activeIdx = pickActiveIndex(activeVisualizationIndex);
    const cfgActiveViz = visualizations[activeIdx];
    if (!cfgActiveViz) return null;

    const viewerBackgrounds = collectViewerBackgrounds(viewer);
    const background = viewerBackgrounds.length
        ? deepClone(viewerBackgrounds)
        : (Array.isArray(cfg.background) ? deepClone(cfg.background) : undefined);

    // Mirror the source viewer's RUNTIME shader stack rather than the persisted
    // `cfg.visualizations[activeIdx]`. Channel UI / runtime shader registrations
    // (e.g. fluorescence pipelines) populate the renderer without round-tripping
    // back to cfg, so reading cfg can produce an empty viz and the playground
    // would only render the background. We rebuild the active visualization
    // from `renderer.getAllShaders()` minus background-id entries.
    const runtimeViz = buildRuntimeVisualizationFromViewer(viewer, cfgActiveViz, background);
    const activeViz = runtimeViz || deepClone(cfgActiveViz);

    const visualizationsForSnapshot = deepClone(visualizations);
    visualizationsForSnapshot[activeIdx] = activeViz;

    const snapshot = {
        data: deepClone(Array.isArray(cfg.data) ? cfg.data : []),
        visualizations: visualizationsForSnapshot,
        activeVisualizationIndex: deepClone(activeVisualizationIndex),
    };

    return {
        id: `viewer-${viewer.uniqueId || viewer.id || "0"}`,
        title: (activeViz.name as string) || "Visualization",
        sourceViewerUniqueId: viewer.uniqueId,
        // Legacy field — page falls back to this when snapshot is absent.
        visualization: activeViz,
        background,
        data: snapshot.data,
        // No initialLiveState: cache+state already travel inside each shader's
        // getConfig() output captured into `activeViz.shaders`. Re-importing
        // would just trip the "missing local config" warnings the page already
        // documents (see playground-page.ts pre-overrideConfigureAll comment).
        snapshot,
    };
}

/**
 * Build a synthetic active-visualization object whose `shaders` map mirrors the
 * source viewer's CURRENT renderer state — minus any shader whose id matches a
 * background id (the bg shader stack is owned by `assembleBackgroundShaders`
 * and would collide otherwise).
 *
 * Returns null when the renderer is unavailable or has no non-background
 * shaders; the caller falls back to the persisted cfg visualization.
 */
function buildRuntimeVisualizationFromViewer(
    viewer: any,
    cfgActiveViz: any,
    backgrounds: any[] | undefined,
): any | null {
    const renderer: any = viewer?.drawer?.renderer;
    if (!renderer || typeof renderer.getAllShaders !== "function") return null;

    let allShaders: Record<string, any> = {};
    try { allShaders = renderer.getAllShaders() || {}; } catch (e) { return null; }

    const ids = Object.keys(allShaders);
    if (!ids.length) return null;

    const bgIdSet = collectBackgroundShaderIdSet(backgrounds);

    const shadersOut: Record<string, any> = {};
    for (const id of ids) {
        if (bgIdSet.has(id)) continue;
        const shader = allShaders[id];
        const cfg = typeof shader?.getConfig === "function" ? shader.getConfig() : undefined;
        if (!cfg || typeof cfg !== "object") continue;
        shadersOut[id] = deepClone(cfg);
    }

    if (!Object.keys(shadersOut).length) return null;

    let order: string[] | undefined;
    if (typeof renderer.getShaderLayerOrder === "function") {
        try {
            const raw = renderer.getShaderLayerOrder();
            if (Array.isArray(raw)) {
                order = raw.filter((id: any) => typeof id === "string" && !bgIdSet.has(id) && id in shadersOut);
            }
        } catch (e) { /* noop */ }
    }
    if (!Array.isArray(order) || !order.length) order = Object.keys(shadersOut);

    return {
        id: cfgActiveViz?.id || "viewer-runtime",
        name: (cfgActiveViz?.name as string) || "Active visualization",
        shaders: shadersOut,
        order,
    };
}

function collectBackgroundShaderIdSet(backgrounds: any[] | undefined): Set<string> {
    const out = new Set<string>();
    if (!Array.isArray(backgrounds)) return out;
    const fr: any = (window as any).OpenSeadragon?.FlexRenderer;
    const sanitize: ((s: string) => string) | undefined =
        typeof fr?.sanitizeKey === "function" ? fr.sanitizeKey.bind(fr) : undefined;
    for (const bg of backgrounds) {
        const id = bg?.id;
        if (typeof id !== "string" || !id.length) continue;
        out.add(id);
        if (sanitize) {
            try { out.add(sanitize(id)); } catch (e) { /* skip */ }
        }
    }
    return out;
}

function normalizeActiveVisualizationIndex(raw: any): Array<number | undefined> | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (Array.isArray(raw)) {
        return raw.map((entry: any) => (Number.isInteger(entry) ? entry : undefined));
    }
    if (Number.isInteger(raw)) return [raw];
    return undefined;
}

/**
 * Walk the viewer's OSD world and collect distinct BackgroundConfig objects.
 * Same shape as visualization-review.ts so user-driven and LLM-review paths
 * end up with identical background lists for identical viewer state.
 */
function collectViewerBackgrounds(viewer: any): any[] {
    const out: any[] = [];
    if (!viewer?.world?.getItemAt || !viewer.world.getItemCount) return out;
    const seen = new Set<any>();
    const count = viewer.world.getItemCount() || 0;
    for (let i = 0; i < count; i++) {
        const item = viewer.world.getItemAt(i);
        const bg = typeof item?.getConfig === "function" ? item.getConfig("background") : undefined;
        if (bg && !seen.has(bg)) {
            seen.add(bg);
            out.push(bg);
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Default actions

function buildDefaultActions(pages: PlaygroundPageHandle[]): ModalAction[] {
    return [
        {
            id: "apply",
            label: tr("playground.applyToCurrentViewer", "Apply to current viewer"),
            primary: true,
            isDisabled: (page) => {
                if (!page) return true;
                if (!page.sourceViewerUniqueId) return true;
                const VM: any = (window as any).VIEWER_MANAGER;
                return !VM?.getViewer?.(page.sourceViewerUniqueId, false);
            },
            onClick: async (ctx) => {
                const page = ctx.activePage;
                if (!page) return;
                const VM: any = (window as any).VIEWER_MANAGER;
                const target = page.sourceViewerUniqueId
                    ? VM?.getViewer?.(page.sourceViewerUniqueId, false)
                    : undefined;
                if (!target) {
                    showToast(tr("playground.sourceViewerMissing", "Source viewer is no longer available."));
                    return;
                }
                const live = page.getLiveState();
                if (live) {
                    try {
                        (window as any).UTILITIES?.importLiveVisualization?.(target, live);
                    } catch (e) {
                        console.warn("[PlaygroundService] apply failed", e);
                    }
                }
                clearDraftFor(page.sourceViewerUniqueId, page.id);
                ctx.closeModal("apply");
            },
        },
        {
            id: "copy",
            label: tr("playground.copyToClipboard", "Copy to clipboard"),
            isDisabled: (page) => !page,
            onClick: async (ctx) => {
                const page = ctx.activePage;
                if (!page) return;
                const payload = JSON.stringify({
                    visualization: page.getVisualization(),
                    liveState: page.getLiveState(),
                }, null, 2);
                try {
                    await navigator.clipboard.writeText(payload);
                    page.markCopied();
                    showToast(tr("playground.copied", "Copied to clipboard."));
                } catch (e) {
                    console.warn("[PlaygroundService] clipboard write failed", e);
                    showToast(tr("playground.copyFailed", "Failed to copy to clipboard."), "error");
                }
            },
        },
        {
            id: "close",
            label: tr("playground.close", "Close"),
            onClick: (ctx) => ctx.closeModal("close"),
        },
    ];
}

function toModalAction(a: PlaygroundAction): ModalAction {
    return {
        id: a.id,
        label: a.label,
        primary: a.primary,
        isDisabled: a.isDisabled,
        onClick: (ctx) => a.onClick(ctx),
    };
}

// ---------------------------------------------------------------------------
// Confirm-on-close

async function confirmCloseIfDirtyPages(pages: PlaygroundPageHandle[]): Promise<boolean> {
    const anyDirty = pages.some((p) => p.isDirty() && !p.isCopiedSinceLastEdit());
    if (!anyDirty) return true;

    const Dialogs: any = (window as any).Dialogs;
    if (Dialogs?.confirm) {
        try {
            return !!(await Dialogs.confirm(
                tr("playground.confirmDiscardBody", "You have unsaved playground changes. Discard them?"),
                tr("playground.confirmDiscardTitle", "Discard changes?"),
            ));
        } catch (e) { /* fallthrough to native */ }
    }
    return window.confirm(tr("playground.confirmDiscardBody", "You have unsaved playground changes. Discard them?"));
}

// ---------------------------------------------------------------------------
// Draft persistence

function pruneExpiredDrafts() {
    try {
        const now = Date.now();
        const ls = window.localStorage;
        const expired: string[] = [];
        for (let i = 0; i < ls.length; i++) {
            const k = ls.key(i);
            if (!k || !k.startsWith(DRAFT_KEY_PREFIX)) continue;
            try {
                const v = JSON.parse(ls.getItem(k) || "null");
                if (!v?.savedAt || (now - v.savedAt) > DRAFT_TTL_MS) {
                    expired.push(k);
                }
            } catch (e) {
                expired.push(k);
            }
        }
        for (const k of expired) ls.removeItem(k);
    } catch (e) { /* noop */ }
}

function draftKey(sourceUniqueId: string, pageId: string) {
    return `${DRAFT_KEY_PREFIX}${sourceUniqueId}:${pageId}`;
}

function loadDraftsForPages(pages: Array<{ sourceViewerUniqueId?: string; id: string }>) {
    const map = new Map<string, any>();
    try {
        for (const p of pages) {
            if (!p.sourceViewerUniqueId) continue;
            const raw = window.localStorage.getItem(draftKey(p.sourceViewerUniqueId, p.id));
            if (!raw) continue;
            try { map.set(p.id, JSON.parse(raw)); } catch (e) { /* noop */ }
        }
    } catch (e) { /* localStorage unavailable */ }
    return map;
}

function writeDraft(sourceUniqueId: string, pageId: string, data: any) {
    try {
        window.localStorage.setItem(draftKey(sourceUniqueId, pageId), JSON.stringify(data));
    } catch (e) { /* quota / unavailable */ }
}

function clearDraftFor(sourceUniqueId: string | undefined, pageId: string) {
    if (!sourceUniqueId) return;
    try { window.localStorage.removeItem(draftKey(sourceUniqueId, pageId)); } catch (e) { /* noop */ }
}

function queueRestoreToast(
    modal: ReturnType<typeof createPlaygroundModal>,
    pages: PlaygroundPageHandle[],
    drafts: Map<string, any>,
) {
    // Render a non-blocking banner inside the modal body offering Restore/Discard.
    // Implemented as a transient div appended to body; user-driven and per-page.
    const Dialogs: any = (window as any).Dialogs;
    Dialogs?.show?.(
        tr("playground.restoreDraftPrompt", "Unsaved playground changes are available — see drafts in storage."),
        6000,
        Dialogs?.MSG_INFO,
    );
    // For v1 we don't auto-import — drafts remain in localStorage.
    // A future iteration adds an in-modal toast with Restore/Discard buttons.
    void modal; void pages; void drafts;
}

// ---------------------------------------------------------------------------
// Helpers

function deepClone<T>(v: T): T {
    if (v === undefined || v === null) return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
}

function tr(key: string, fallback: string): string {
    const $: any = (window as any).$;
    try {
        const out = $?.t?.(key);
        if (typeof out === "string" && out !== key) return out;
    } catch (e) { /* noop */ }
    return fallback;
}

function showToast(message: string, kind: "info" | "warn" | "error" = "info") {
    const Dialogs: any = (window as any).Dialogs;
    if (Dialogs?.show) {
        const code = kind === "error" ? Dialogs.MSG_ERR : kind === "warn" ? Dialogs.MSG_WARN : Dialogs.MSG_INFO;
        Dialogs.show(message, 4000, code);
    } else {
        console.log(`[Playground] ${message}`);
    }
}

// ---------------------------------------------------------------------------
// Public surface

export const PlaygroundService = {
    open: openPlayground,
    init,
    isInitialized,
    _debug,
};

(window as any).PLAYGROUND = PlaygroundService;

// Self-initialize at module load. The init() function uses retry-with-setTimeout
// to defer Edit-menu and CanvasContextMenu provider registration until those
// surfaces are ready, so it is safe to call this even if AppBar / VIEWER_MANAGER
// haven't fully booted yet.
try { init(); } catch (e) { console.warn("[PlaygroundService] auto-init failed", e); }

declare global {
    interface Window {
        PLAYGROUND: typeof PlaygroundService;
    }
}
