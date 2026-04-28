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
}

export interface CanvasContextMenuItem {
    title: string;
    /** Optional callback. When undefined, the entry renders as a header/separator. */
    action?: (selected?: boolean) => void;
    selected?: boolean;
    icon?: string;
    iconCss?: string;
    containerCss?: string;
}

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

    /** Aggregate all provider items, separated by visual dividers. */
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
) ? _existing as CanvasContextMenuRegistry : (() => {
    const inst = new CanvasContextMenuRegistry();
    (window as any).CanvasContextMenu = inst;
    return inst;
})();

declare global {
    interface Window {
        CanvasContextMenu: CanvasContextMenuRegistry;
    }
}
