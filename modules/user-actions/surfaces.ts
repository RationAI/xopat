/// <reference path="../../src/types/globals.d.ts" />
/**
 * Mounts actions onto the existing UI registries. Every registry already renders
 * labels as text, replaces on re-register and appears in AppBar.Catalog, so an
 * action placed here is also discoverable by the `ui` scripting namespace.
 *
 * Strategy: idempotent full sync. On any change, unmount what we registered and
 * mount the eligible set again — at most a few dozen entries, and every
 * registry replaces by id, so this costs nothing and cannot drift.
 */
import type { AnyAction, Placement } from "./schema";
import { isApproved } from "./schema";
import type { Trigger } from "./runner";

export interface SurfaceHost {
    /** Module-namespaced translation. */
    t(key: string, options?: Record<string, unknown>): string;
    invoke(action: AnyAction, trigger: Trigger, viewer?: any, extra?: Record<string, unknown>): void;
    canRun(): boolean;
    /** True exactly once per action id (persisted) — drives `pinned: true`. */
    claimFirstPin(id: string): boolean;
    warn(message: string, data?: unknown): void;
}

export const OWNER = "user-actions";
export const quickKeyOf = (id: string) => `custom:${OWNER}.${id}`;
export const shortcutIdOf = (id: string) => `${OWNER}.${id}`;
const CONTEXT_PROVIDER_ID = OWNER;

const g = () => globalThis as any;

export class SurfaceMounter {
    private _quick = new Set<string>();
    private _tools = new Set<string>();
    private _controls = new Set<string>();
    private _shortcuts = new Set<string>();
    private _contextItems: AnyAction[] = [];
    private _contextRegistered = false;
    private _panelEntryRegistered = false;

    constructor(private readonly host: SurfaceHost) {}

    /** Mount every enabled, approved action; remove everything else we own. */
    sync(actions: AnyAction[]): void {
        this._unmountAll();
        if (!this.host.canRun()) return;
        const eligible = actions.filter(a => a.enabled && isApproved(a));
        for (const action of eligible) {
            for (const placement of action.placements) {
                try {
                    this._mount(action, placement);
                } catch (e) {
                    this.host.warn(`cannot mount '${action.id}' on ${placement.surface}`, e);
                }
            }
        }
        this._contextItems = eligible.filter(a => a.placements.some(p => p.surface === "context-menu"));
        this._ensureContextProvider();
    }

    /** The "Actions…" entry in Tools that opens the management panel. */
    registerPanelEntry(open: () => void): void {
        const Tools = g().USER_INTERFACE?.AppBar?.Tools;
        if (!Tools || this._panelEntryRegistered) return;
        Tools.register(`${OWNER}.manage`, {
            section: OWNER,
            sectionTitle: this.host.t("tools.section"),
            label: this.host.t("tools.manage"),
            icon: "ph-lightning",
            order: 1000,
            onClick: open,
        });
        this._panelEntryRegistered = true;
    }

    /** Current shortcut conflicts: the combos our shortcut lost to another registration. */
    shortcutState(id: string): { combo?: string; suppressed: string[] } | null {
        const binding = g().APPLICATION_CONTEXT?.shortcuts?.getBinding?.(shortcutIdOf(id));
        if (!binding) return null;
        return { combo: binding.combos?.[0], suppressed: [...(binding.suppressed || [])] };
    }

    dispose(): void {
        this._unmountAll();
        if (this._contextRegistered) g().CanvasContextMenu?.unregister?.(CONTEXT_PROVIDER_ID);
        this._contextRegistered = false;
        if (this._panelEntryRegistered) g().USER_INTERFACE?.AppBar?.Tools?.unregister?.(`${OWNER}.manage`);
        this._panelEntryRegistered = false;
    }

    private _mount(action: AnyAction, placement: Placement): void {
        const ui = g().USER_INTERFACE;
        const hint = action.description || undefined;
        switch (placement.surface) {
            case "quick": {
                const Actions = ui?.AppBar?.Actions;
                if (!Actions) return;
                const rawId = `${OWNER}.${action.id}`;
                Actions.register(rawId, {
                    label: action.label,
                    icon: action.icon || "ph-lightning",
                    hint,
                    group: this.host.t("group"),
                    invoke: () => this.host.invoke(action, "quick"),
                });
                this._quick.add(rawId);
                if (placement.pinned && this.host.claimFirstPin(action.id)) {
                    ui?.AppBar?.QuickActions?.pin?.(quickKeyOf(action.id));
                }
                return;
            }
            case "tools": {
                const Tools = ui?.AppBar?.Tools;
                if (!Tools) return;
                const id = `${OWNER}.run.${action.id}`;
                Tools.register(id, {
                    section: OWNER,
                    sectionTitle: this.host.t("tools.section"),
                    label: action.label,
                    icon: action.icon || "ph-lightning",
                    hint,
                    onClick: () => this.host.invoke(action, "tools"),
                });
                this._tools.add(id);
                return;
            }
            case "viewer-control": {
                const Controls = ui?.ViewerControls;
                if (!Controls) return;
                const id = `${OWNER}.${action.id}`;
                Controls.register(id, {
                    label: action.label,
                    icon: action.icon || "ph-lightning",
                    hint,
                    order: 100,
                    onClick: ({ viewer }: { viewer: any }) => this.host.invoke(action, "viewer-control", viewer),
                });
                this._controls.add(id);
                return;
            }
            case "shortcut": {
                const shortcuts = g().APPLICATION_CONTEXT?.shortcuts;
                if (!shortcuts?.register || !placement.combo) return;
                const id = shortcutIdOf(action.id);
                shortcuts.register({
                    id,
                    // The label is user data, not app chrome: interpolate it into a key.
                    titleKey: `${OWNER}:shortcut.title`,
                    titleArgs: { label: action.label },
                    categoryPath: [`${OWNER}:shortcut.category`],
                    defaultCombos: [placement.combo],
                    owner: OWNER,
                    icon: action.icon,
                    type: "press",
                    scope: { requiresCanvasFocus: false, allowInInputs: false },
                    handler: (inv: { viewer?: any }) => this.host.invoke(action, "shortcut", inv?.viewer),
                });
                this._shortcuts.add(id);
                return;
            }
            case "context-menu":
                return; // served by the single provider below
        }
    }

    private _ensureContextProvider(): void {
        const menu = g().CanvasContextMenu;
        if (!menu?.register || this._contextRegistered) return;
        menu.register(CONTEXT_PROVIDER_ID, (ctx: any) => this._contextMenuItems(ctx), -5);
        this._contextRegistered = true;
    }

    private _contextMenuItems(ctx: any): any[] {
        if (!this._contextItems.length || !this.host.canRun()) return [];
        const selection = summarizeSelection(ctx?.selection);
        const items = this._contextItems
            .filter(a => {
                const p = a.placements.find(pl => pl.surface === "context-menu");
                return p?.when !== "selection" || selection.length > 0;
            })
            .map(a => ({
                title: a.label,
                icon: a.icon || "ph-lightning",
                action: () => this.host.invoke(a, "context-menu", ctx?.viewer, {
                    position: pickPoint(ctx?.pixelPosition),
                    viewportPosition: pickPoint(ctx?.osdPosition),
                    selection,
                }),
            }));
        if (!items.length) return [];
        return [{ title: this.host.t("contextMenu.title"), icon: "ph-lightning", children: items }];
    }

    private _unmountAll(): void {
        const ui = g().USER_INTERFACE;
        for (const id of this._quick) ui?.AppBar?.Actions?.unregister?.(id);
        for (const id of this._tools) ui?.AppBar?.Tools?.unregister?.(id);
        for (const id of this._controls) ui?.ViewerControls?.unregister?.(id);
        const shortcuts = g().APPLICATION_CONTEXT?.shortcuts;
        for (const id of this._shortcuts) shortcuts?.unregister?.(id);
        this._quick.clear();
        this._tools.clear();
        this._controls.clear();
        this._shortcuts.clear();
        this._contextItems = [];
    }
}

function pickPoint(p: any): { x: number; y: number } | null {
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
}

/** Only identifiers cross into the worker — never live fabric objects. */
function summarizeSelection(selection: unknown): Array<{ id: string | number | null; incrementId: number | null }> {
    if (!Array.isArray(selection)) return [];
    return selection.filter(Boolean).slice(0, 500).map((o: any) => ({
        id: typeof o.id === "string" || typeof o.id === "number" ? o.id : null,
        incrementId: Number.isFinite(o.incrementId) ? o.incrementId : null,
    }));
}
