/**
 * Visualization Playground modal shell.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────┐
 *   │ Header (title + close)                               │
 *   ├──────────┬──────────────────────────────┬────────────┤
 *   │  Left    │  Tabbed center pane          │  (per-page │
 *   │  panel   │  → active PlaygroundPage     │   right    │
 *   │ (hidden) │    (own viewer + side menu)  │   rail in  │
 *   │          │                              │   page)    │
 *   ├──────────┴──────────────────────────────┴────────────┤
 *   │ Footer: action buttons                               │
 *   └──────────────────────────────────────────────────────┘
 *
 * Tabs lazy-activate their PlaygroundPage on first focus.
 */

import type { PlaygroundPageHandle } from "./playground-page";

export interface ModalAction {
    id: string;
    label: string;
    primary?: boolean;
    /** Compute disabled state from the active page (re-evaluated on dirty change). */
    isDisabled?: (page: PlaygroundPageHandle | undefined) => boolean;
    onClick: (ctx: ModalActionCtx) => any | Promise<any>;
}

export interface ModalActionCtx {
    activePage: PlaygroundPageHandle | undefined;
    pages: PlaygroundPageHandle[];
    closeModal: (reason?: string, payload?: any) => void;
}

export interface PlaygroundModalOptions {
    title: string;
    pages: PlaygroundPageHandle[];
    actions: ModalAction[];
    showLeftPanel?: boolean;
    /**
     * Called when the user requests to close (X button, ESC, or Close action).
     * If returns `false` (or a Promise resolving to false), the close is cancelled.
     */
    onCloseRequested?: () => boolean | Promise<boolean>;
}

export interface PlaygroundModalHandle {
    open(): void;
    close(reason?: string, payload?: any): void;
    /** Resolves once the modal is closed (either action, X button, or programmatic close). */
    waitForClose(): Promise<{ reason: string; payload: any }>;
    setActions(actions: ModalAction[]): void;
    getActivePage(): PlaygroundPageHandle | undefined;
    setActivePage(id: string): void;
}

export function createPlaygroundModal(options: PlaygroundModalOptions): PlaygroundModalHandle {
    const root = document.createElement("div");
    root.className = "modal";
    root.setAttribute("data-kind", "xopat-playground-modal");
    root.style.zIndex = "9999";

    const box = document.createElement("div");
    box.className = "modal-box relative";
    box.style.width = "min(96vw, 1500px)";
    box.style.maxWidth = "min(96vw, 1500px)";
    box.style.height = "min(92vh, 950px)";
    box.style.maxHeight = "min(92vh, 950px)";
    box.style.padding = "0";
    box.style.display = "flex";
    box.style.flexDirection = "column";
    box.style.overflow = "hidden";
    root.appendChild(box);

    // ---- Header ----
    const header = document.createElement("div");
    header.className = "flex items-center justify-between px-4 py-2 border-b border-base-300";
    header.style.flex = "0 0 auto";
    const title = document.createElement("div");
    title.className = "font-bold text-base";
    title.textContent = options.title;
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn btn-sm btn-circle btn-ghost";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => requestClose("dismiss"));
    header.appendChild(closeBtn);
    box.appendChild(header);

    // ---- Body: optional left panel + tabs + center ----
    const body = document.createElement("div");
    body.style.flex = "1 1 auto";
    body.style.display = "flex";
    body.style.flexDirection = "row";
    body.style.minHeight = "0";
    box.appendChild(body);

    // Left panel (reserved for future visual-programming UI).
    const leftPanel = document.createElement("div");
    leftPanel.id = "xopat-playground-left-panel";
    leftPanel.setAttribute("data-kind", "playground-left-panel");
    leftPanel.style.flex = "0 0 0";
    leftPanel.style.borderRight = "1px solid var(--fallback-b3, #333)";
    leftPanel.style.overflow = "auto";
    leftPanel.hidden = !options.showLeftPanel;
    if (options.showLeftPanel) {
        leftPanel.style.flex = "0 0 280px";
    }
    body.appendChild(leftPanel);

    // Center wrapper: tabs + active page host
    const centerWrap = document.createElement("div");
    centerWrap.style.flex = "1 1 auto";
    centerWrap.style.display = "flex";
    centerWrap.style.flexDirection = "column";
    centerWrap.style.minWidth = "0";
    centerWrap.style.minHeight = "0";
    body.appendChild(centerWrap);

    const tabBar = document.createElement("div");
    tabBar.className = "tabs tabs-bordered px-2 pt-2";
    tabBar.style.flex = "0 0 auto";
    centerWrap.appendChild(tabBar);

    const pageHost = document.createElement("div");
    pageHost.style.flex = "1 1 auto";
    pageHost.style.position = "relative";
    pageHost.style.minHeight = "0";
    pageHost.style.overflow = "hidden";
    centerWrap.appendChild(pageHost);

    // Mount each page root (initially hidden); activate first on open.
    for (const page of options.pages) {
        const r = page.getRoot();
        r.style.position = "absolute";
        r.style.inset = "0";
        r.style.display = "none";
        pageHost.appendChild(r);
    }

    let activePageId: string | undefined;
    const setActivePage = (id: string) => {
        const next = options.pages.find((p) => p.id === id);
        if (!next) return;
        if (activePageId === id) return;

        if (activePageId) {
            const prev = options.pages.find((p) => p.id === activePageId);
            if (prev) {
                prev.deactivate();
                prev.getRoot().style.display = "none";
            }
        }
        activePageId = id;
        next.getRoot().style.display = "";
        next.activate();
        renderTabs();
        renderActions();
    };

    const renderTabs = () => {
        tabBar.innerHTML = "";
        for (const page of options.pages) {
            const btn = document.createElement("a");
            btn.className = "tab" + (page.id === activePageId ? " tab-active" : "");
            btn.textContent = page.title;
            btn.addEventListener("click", () => setActivePage(page.id));
            tabBar.appendChild(btn);
        }
        if (options.pages.length <= 1) tabBar.style.display = "none";
    };

    // ---- Footer: action buttons ----
    const footer = document.createElement("div");
    footer.className = "flex items-center justify-end gap-2 px-4 py-2 border-t border-base-300";
    footer.style.flex = "0 0 auto";
    box.appendChild(footer);

    let currentActions: ModalAction[] = options.actions;
    const renderActions = () => {
        footer.innerHTML = "";
        const activePage = getActivePage();
        for (const action of currentActions) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "btn btn-sm" + (action.primary ? " btn-primary" : "");
            btn.textContent = action.label;
            btn.disabled = !!action.isDisabled?.(activePage);
            btn.addEventListener("click", () => runAction(action));
            footer.appendChild(btn);
        }
    };

    const getActivePage = () => options.pages.find((p) => p.id === activePageId);

    const runAction = async (action: ModalAction) => {
        try {
            await action.onClick({
                activePage: getActivePage(),
                pages: options.pages,
                closeModal: (reason, payload) => closeNow(reason || action.id, payload),
            });
        } catch (e) {
            console.error("[PlaygroundModal] action threw", e);
        }
    };

    // Refresh the action bar when the active page's dirty state flips.
    const reRenderOnDirty = () => renderActions();
    for (const page of options.pages) {
        page.onDirtyChange(reRenderOnDirty);
    }

    // ---- Close pipeline ----
    let closePromiseResolve: ((v: { reason: string; payload: any }) => void) | undefined;
    const closePromise = new Promise<{ reason: string; payload: any }>((res) => {
        closePromiseResolve = res;
    });
    let closing = false;

    const closeNow = (reason: string, payload?: any) => {
        if (closing) return;
        closing = true;
        try { document.removeEventListener("keydown", onKeyDown); } catch (e) { /* noop */ }
        if (root.parentNode) root.parentNode.removeChild(root);
        closePromiseResolve?.({ reason, payload });
    };

    const requestClose = async (reason: string) => {
        if (options.onCloseRequested) {
            try {
                const ok = await options.onCloseRequested();
                if (ok === false) return;
            } catch (e) {
                console.warn("[PlaygroundModal] onCloseRequested threw", e);
            }
        }
        closeNow(reason);
    };

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            requestClose("dismiss");
        }
    };

    return {
        open() {
            document.body.appendChild(root);
            root.classList.add("modal-open");
            document.addEventListener("keydown", onKeyDown);
            if (options.pages.length > 0) {
                setActivePage(options.pages[0]!.id);
            } else {
                renderTabs();
                renderActions();
            }
        },
        close: (reason, payload) => closeNow(reason || "dismiss", payload),
        waitForClose: () => closePromise,
        setActions: (actions) => {
            currentActions = actions;
            renderActions();
        },
        getActivePage,
        setActivePage,
    };
}
