/**
 * Per-viewer canvas right-click registry.
 *
 * Plugins, modules, and core features call `register(id, providerFn, priority?)`
 * to contribute items to the canvas context menu. When the user right-clicks an
 * OSD viewer canvas, all registered providers are asked for items and the
 * aggregated list is shown via `window.DropDown`. If every provider returns
 * empty, no menu opens (preserves the previous "no native menu" behavior).
 *
 * Provider functions receive the viewer that fired the event — never read
 * `window.VIEWER` from a provider.
 */

export interface CanvasContextMenuContext {
    viewer: any;                       // OpenSeadragon.Viewer
    event: MouseEvent;
    osdPosition: { x: number; y: number };       // viewport coords (or fallback)
    pixelPosition: { x: number; y: number };     // image-pixel coords (or fallback)
    /**
     * Pre-resolved active target (e.g. an annotation). Set when the menu is
     * opened from a UI surface other than a right-click on the canvas, where
     * the caller already knows which object the menu pertains to and standard
     * hit-testing on `event` would not resolve it. Providers that care about
     * the active object should prefer `ctx.active` over re-deriving it.
     */
    active?: any;
    /**
     * Origin of the right-click. `'canvas'` for the OSD viewer surface,
     * `'board'` (or other plugin-specific values) for UI overlays that open
     * the canvas menu programmatically. Providers can use this to disable
     * spatially-invalid actions (e.g. Paste-at-mouse) when the click did
     * not originate from a real position on the slide.
     */
    source?: string;
}

export interface CanvasContextMenuItem {
    title: string;
    /** Optional callback. When undefined and no `children`, the entry renders as a header/separator. */
    action?: (selected?: boolean) => void;
    selected?: boolean;
    icon?: string;
    iconCss?: string;
    containerCss?: string;
    /**
     * Cascading flyout entries. The runtime menu component
     * (`ui/classes/components/contextMenu.mjs`) renders any item with a
     * non-empty `children` array as a submenu parent — hovering / clicking
     * opens the flyout. Use this to group related actions (e.g. annotation
     * z-order) under a single top-level entry instead of cluttering the
     * root menu.
     */
    children?: CanvasContextMenuItem[];
}

/**
 * Return values:
 * - item array — entries to aggregate into the menu;
 * - `[]` / `null` / `undefined` — this provider has nothing to add, other
 *   providers may still open the menu;
 * - `false` — veto: the right-click was consumed by an interaction (drawing,
 *   drag, control manipulation, …) and NO menu must open at all, regardless
 *   of what other providers would contribute.
 */
export type CanvasContextProvider = (
    ctx: CanvasContextMenuContext
) => CanvasContextMenuItem[] | null | undefined | false;

interface ProviderEntry {
    fn: CanvasContextProvider;
    priority: number;
}

class CanvasContextMenuRegistry {
    private providers = new Map<string, ProviderEntry>();

    /** Register a provider. Higher priority = earlier in the menu. */
    register(id: string, fn: CanvasContextProvider, priority = 0): void {
        if (typeof fn !== "function") {
            console.warn(`[CanvasContextMenu] register("${id}"): provider must be a function`);
            return;
        }
        this.providers.set(id, { fn, priority });
    }

    unregister(id: string): boolean {
        return this.providers.delete(id);
    }

    has(id: string): boolean {
        return this.providers.has(id);
    }

    /**
     * Build the context, collect provider items, and render the menu via the
     * van.js `window.ContextMenu` (preferred) or legacy `window.DropDown`
     * fallback. Returns `true` iff at least one provider produced items and
     * the menu was opened.
     */
    open(opts: {
        event: MouseEvent;
        viewer?: any;
        active?: any;
        source?: string;
        osdPosition?: { x: number; y: number };
        pixelPosition?: { x: number; y: number };
    }): boolean {
        const ctx: CanvasContextMenuContext = {
            viewer: opts.viewer,
            event: opts.event,
            osdPosition: opts.osdPosition ?? { x: 0, y: 0 },
            pixelPosition: opts.pixelPosition ?? { x: 0, y: 0 },
            active: opts.active,
            source: opts.source,
        };
        const items = this.collect(ctx);
        if (!items.length) return false;
        const ctxMenu = (window as any).ContextMenu;
        if (ctxMenu?.open) ctxMenu.open(opts.event, items);
        else (window as any).DropDown?.open(opts.event, items);
        return true;
    }

    /**
     * Aggregate all provider items, separated by visual dividers. Returns `[]`
     * (so no menu opens) as soon as any provider vetoes by returning `false`.
     */
    collect(ctx: CanvasContextMenuContext): CanvasContextMenuItem[] {
        const items: CanvasContextMenuItem[] = [];
        const sorted = [...this.providers.entries()]
            .sort((a, b) => b[1].priority - a[1].priority);

        for (const [id, entry] of sorted) {
            let got: CanvasContextMenuItem[] | null | undefined | false;
            try {
                got = entry.fn(ctx);
            } catch (e) {
                console.error(`[CanvasContextMenu] provider "${id}" threw`, e);
                continue;
            }
            if (got === false) return [];
            if (Array.isArray(got) && got.length) {
                if (items.length) {
                    // visual separator: window.DropDown renders entries with no `action` as headers
                    items.push({ title: "", action: undefined });
                }
                items.push(...got);
            }
        }
        return items;
    }
}

// Idempotent singleton: when this module is bundled into multiple dist files
// (loader.js, playground-service.js, ...) each IIFE creates its own copy of
// the class. We anchor a single instance on `window` so all callers — no
// matter which bundle they came from — talk to the same registry. We use
// duck-typing because the class identity differs across IIFEs.
const _existing: any = (window as any).CanvasContextMenu;
export const CanvasContextMenu: CanvasContextMenuRegistry = (
    _existing && typeof _existing.register === "function" && typeof _existing.collect === "function"
) ? (() => {
    // Older bundled copies may not expose `open`. Patch it on so all callers
    // — regardless of which IIFE installed the singleton — get the helper.
    if (typeof _existing.open !== "function") {
        _existing.open = CanvasContextMenuRegistry.prototype.open;
    }
    return _existing as CanvasContextMenuRegistry;
})() : (() => {
    const inst = new CanvasContextMenuRegistry();
    (window as any).CanvasContextMenu = inst;
    return inst;
})();

declare global {
    interface Window {
        CanvasContextMenu: CanvasContextMenuRegistry;
    }
}
