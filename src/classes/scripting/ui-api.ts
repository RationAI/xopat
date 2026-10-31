import type {ScriptApiMetadata} from "./abstract-types";
import type {
    UiElementInfo,
    UiListFilter,
    UiListResult,
    UiScriptApi,
    UiShowOptions,
    UiShowResult,
    UiTargetOptions
} from "./ui-api.scripts";

import {XOpatScriptingApi} from "./abstract-api";
import {fetchDtsCached} from "./dts-fetch";
import {UI_ASSISTANT_HINTS} from "./ui-api.assistant";

const DEFAULT_LIST_LIMIT = 80;
const MAX_LIST_LIMIT = 300;
const MAX_MESSAGE_CHARS = 400;
const PULSE_MS = 2500;
const TARGET_ATTR = "data-xo-ui-target";

/** Step text is HTML-capable (TourEngine); model-authored text must stay text. */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * The `ui` namespace: lets a script (and so the chat assistant) explore the live
 * UI, open menus and panels, point the user at a control and — with consent —
 * trigger it. A thin adapter over `USER_INTERFACE.AppBar.Catalog`, which owns
 * the enumeration; nothing here knows about specific menus.
 */
export class XOpatUiScriptApi extends XOpatScriptingApi implements UiScriptApi {

    static ScriptApiMetadata: ScriptApiMetadata<XOpatUiScriptApi> = {
        dtypesSource: {
            kind: "resolve",
            value: () => fetchDtsCached(APPLICATION_CONTEXT.url + "src/classes/scripting/ui-api.scripts.d.ts")
        },
        assistant: UI_ASSISTANT_HINTS,
    };

    private static _targetSeq = 0;

    constructor(namespace: string) {
        super(
            namespace,
            "User Interface",
            "Explore the viewer's menus, panels, toolbars, actions and keyboard shortcuts, open them for the user, highlight where something is, and trigger actions on request. Always list or describe UI before referring to it."
        );
    }

    private get _catalog(): any {
        return (globalThis as any).USER_INTERFACE?.AppBar?.Catalog || null;
    }

    private _requireCatalog(): any {
        const catalog = this._catalog;
        if (!catalog) throw new Error("The user interface is not available.");
        return catalog;
    }

    /** Catalog context for an optional (possibly aliased) viewer id. */
    private _context(viewerId?: string): { viewer?: OpenSeadragon.Viewer } {
        const viewers: OpenSeadragon.Viewer[] = VIEWER_MANAGER?.viewers || [];
        if (viewerId) {
            const realId = this.scriptingContext.toInternalViewerId?.(viewerId) ?? viewerId;
            const viewer = viewers.find(v => v.uniqueId === realId);
            if (!viewer) throw new Error(`Unknown viewerId '${viewerId}'.`);
            return { viewer };
        }
        try {
            return { viewer: this.activeViewer };
        } catch (_) {
            // UI outside viewer side panels does not need a viewer; an ambiguous
            // multi-viewer context falls back to the focused one.
            return { viewer: VIEWER_MANAGER?.active || undefined };
        }
    }

    private _node(id: string, ctx: object): any {
        const catalog = this._requireCatalog();
        if (typeof id !== "string" || !id) throw new Error("A UI element id is required.");
        const node = catalog.get(id, ctx);
        if (node) return node;

        const rawId = id.slice(id.indexOf(":") + 1);
        const words = rawId.split(/[\/.\-_:\s]+/).filter(w => w.length > 2);
        const suggestions = new Set<string>();
        for (const word of words) {
            for (const n of catalog.list({ query: word }, ctx)) {
                suggestions.add(n.id);
                if (suggestions.size >= 6) break;
            }
            if (suggestions.size >= 6) break;
        }
        const hint = suggestions.size
            ? ` Similar elements: ${[...suggestions].join(", ")}.`
            : " Use ui.listUi({ query }) to find it.";
        throw new Error(`Unknown UI element '${id}'.${hint}`);
    }

    private _info(node: any, ctx: object): UiElementInfo {
        return this._requireCatalog().serialize(node, ctx);
    }

    listUi(filter?: UiListFilter): UiListResult {
        const catalog = this._requireCatalog();
        const ctx = this._context(filter?.viewerId);
        const nodes = catalog.list({
            kind: filter?.kind,
            owner: filter?.owner,
            parent: filter?.parent,
            query: filter?.query,
        }, ctx);
        const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(Number(filter?.limit) || DEFAULT_LIST_LIMIT)));
        return {
            items: nodes.slice(0, limit).map((n: any) => this._info(n, ctx)),
            total: nodes.length,
            truncated: nodes.length > limit,
        };
    }

    describeUi(id: string, options?: UiTargetOptions): UiElementInfo & { children: UiElementInfo[] } {
        const ctx = this._context(options?.viewerId);
        const node = this._node(id, ctx);
        const children = this._requireCatalog().list({ parent: node.id }, ctx);
        return {
            ...this._info(node, ctx),
            children: children.map((n: any) => this._info(n, ctx)),
        };
    }

    getUiState(options?: UiTargetOptions): { open: UiElementInfo[] } {
        const ctx = this._context(options?.viewerId);
        return {
            open: this._requireCatalog().openNodes(ctx).map((n: any) => this._info(n, ctx)),
        };
    }

    async openUi(id: string, options?: UiTargetOptions): Promise<UiElementInfo> {
        const ctx = this._context(options?.viewerId);
        const node = this._node(id, ctx);
        if (typeof node.open !== "function") {
            throw new Error(`UI element '${id}' (${node.kind}) cannot be opened; supported operations: ${this._info(node, ctx).ops.join(", ")}.`);
        }
        await this._requireCatalog().open(id, ctx);
        return this._info(this._node(id, ctx), ctx);
    }

    closeUi(id: string, options?: UiTargetOptions): UiElementInfo {
        const ctx = this._context(options?.viewerId);
        const node = this._node(id, ctx);
        if (!this._requireCatalog().close(id, ctx)) {
            throw new Error(`UI element '${id}' (${node.kind}) cannot be closed.`);
        }
        return this._info(this._node(id, ctx), ctx);
    }

    async showUi(id: string, options?: UiShowOptions): Promise<UiShowResult> {
        const ctx = this._context(options?.viewerId);
        this._node(id, ctx);
        const { node, element, target } = await this._requireCatalog().locate(id, ctx);
        if (!element) {
            return { shown: false, reason: "The element is not on screen (it may be hidden or need a viewer)." };
        }

        const raw = typeof options?.message === "string" && options.message.trim()
            ? options.message.trim()
            : String(node.label || id);
        const text = escapeHtml(raw.slice(0, MAX_MESSAGE_CHARS));

        const tour = APPLICATION_CONTEXT?.tutorials;
        const narrow = window.innerWidth < (APPLICATION_CONTEXT?.getOption?.("maxMobileWidthPx") || 0);
        if (!tour || tour.isRunning || narrow) {
            element.classList.add("ui-highlight-animated");
            setTimeout(() => element.classList.remove("ui-highlight-animated"), PULSE_MS);
            return { shown: true, target };
        }

        // The tour engine addresses steps by selector; mark the element for the
        // duration of the step rather than deriving a selector from its id.
        const mark = String(++XOpatUiScriptApi._targetSeq);
        element.setAttribute(TARGET_ATTR, mark);
        const unmark = () => {
            if (element.getAttribute(TARGET_ATTR) === mark) element.removeAttribute(TARGET_ATTR);
        };
        tour.run([{ [`next [${TARGET_ATTR}="${mark}"]`]: text }], { onEnd: unmark, onSkip: unmark });
        return { shown: true, target };
    }

    async invokeUiAction(id: string, options?: UiTargetOptions): Promise<{ invoked: boolean }> {
        const catalog = this._requireCatalog();
        const ctx = this._context(options?.viewerId);
        const node = this._node(id, ctx);
        if (typeof node.invoke !== "function") {
            throw new Error(`UI element '${id}' (${node.kind}) has no action; supported operations: ${this._info(node, ctx).ops.join(", ")}.`);
        }
        if (node.state?.disabled) {
            throw new Error(`UI element '${id}' is currently disabled.`);
        }

        const info = this._info(node, ctx);
        await this.requireActionConsent({
            title: $.t('scripting.ui.invokeTitle'),
            description: $.t('scripting.ui.invokeDescription', { label: info.label }),
            details: info.path.length ? [[...info.path, info.label].join(" › ")] : undefined,
            mode: "warning",
            confirmLabel: $.t('scripting.ui.invokeConfirm'),
            cancelLabel: $.t('common.cancel'),
            rejectedMessage: `Triggering '${id}' was canceled by the user.`,
            cacheKey: `ui.invoke:${id}`,
        });

        return { invoked: await catalog.invoke(id, ctx) };
    }
}
