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
        | {
            kind: "viewer-with-override";
            viewer: any | string;
            visualization: any;
            data?: any[];
            background?: any[];
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

        const pages: PlaygroundPageHandle[] = pageInits.map((init) => createPlaygroundPage({
            ...init,
            initialLiveState: undefined, // defer; handled after restore prompt
        }));

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
        const snapshot = snapshotViewerVisualization(viewer);
        if (!snapshot) return out;
        out.push({
            id: snapshot.id,
            title: snapshot.title,
            sourceViewerUniqueId: viewer.uniqueId,
            visualization: snapshot.visualization,
            background: snapshot.background,
            data: snapshot.data,
        });
        return out;
    }

    if (options.source.kind === "viewer-with-override") {
        const VM: any = (window as any).VIEWER_MANAGER;
        const viewer = typeof options.source.viewer === "string"
            ? VM?.getViewer?.(options.source.viewer, false)
            : options.source.viewer;
        if (!viewer) return out;
        out.push({
            id: `viewer-override-${viewer.uniqueId || viewer.id || "0"}`,
            title: (options.source.visualization?.name as string) || "Proposed visualization",
            sourceViewerUniqueId: viewer.uniqueId,
            visualization: options.source.visualization,
            background: options.source.background,
            data: options.source.data,
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

function snapshotViewerVisualization(viewer: any) {
    if (!viewer) return null;
    let visualization: any = undefined;
    let background: any[] | undefined;
    try {
        const primary = viewer.world?.getItemAt?.(0);
        if (primary && typeof primary.getConfig === "function") {
            visualization = primary.getConfig("visualization") || primary.getConfig();
            background = [primary.getConfig("background")].filter(Boolean);
        }
    } catch (e) {
        /* noop */
    }

    if (!visualization) {
        const APP: any = (window as any).APPLICATION_CONTEXT;
        const cfg = APP?.config;
        const idx = APP?.getOption?.("activeVisualizationIndex", 0);
        const flatIdx = Array.isArray(idx) ? idx[0] : idx;
        visualization = cfg?.visualizations?.[flatIdx];
        background = cfg?.background;
    }

    if (!visualization) return null;

    return {
        id: `viewer-${viewer.uniqueId || viewer.id || "0"}`,
        title: (visualization.name as string) || "Visualization",
        visualization: deepClone(visualization),
        background: background ? deepClone(background) : undefined,
        data: undefined,
    };
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
