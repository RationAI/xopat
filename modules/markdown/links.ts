/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />

/**
 * The `#xopat-<kind>?<query>` link mechanism.
 *
 * A link kind is *registered* by whoever knows what it means; the markdown
 * renderer only recognises the shape and dispatches. That is what makes an
 * assistant-authored region link work in a questionnaire description, a recorder
 * overlay or a chat bubble alike — before this registry the whole convention was
 * private to one chat UI class, so the same text rendered elsewhere produced a
 * dead link.
 *
 * The scheme is deliberately a bare fragment: it carries no URL scheme, so the
 * HTML sanitizer passes it through untouched (`sanitize-html` only vets
 * `allowedSchemes` on hrefs that HAVE a scheme), and a browser that somehow
 * follows it navigates nowhere instead of somewhere hostile.
 */

/** Parsed link, ready to be acted upon. */
export interface XOpatLinkDescriptor {
    kind: string;
    payload: unknown;
    /** Tooltip for the rendered anchor, already translated. */
    title?: string;
}

export interface XOpatLinkHandler {
    /**
     * Turn the link query into a payload, or return `null` when it is malformed.
     * A `null` here means "not one of mine after all" — the renderer then emits an
     * ordinary link instead of a dead action.
     */
    parse(params: URLSearchParams): unknown | null;
    /** Act on a payload. Return false when the action could not be carried out. */
    activate(payload: any): boolean;
    /** i18n key (module namespace) for the anchor tooltip. */
    titleKey?: string;
}

/** Resolves a textual viewer reference to a live viewer, or null if it cannot. */
export type ViewerResolver = (reference: string) => any | null;

const LINK_PREFIX = "#xopat-";

export class XOpatLinks {
    private _handlers = new Map<string, XOpatLinkHandler>();
    private _viewerResolvers: ViewerResolver[] = [];
    private readonly _t: (key: string, options?: any) => string;

    constructor(translate: (key: string, options?: any) => string) {
        this._t = translate;
        this.register("region", regionHandler(this));
    }

    register(kind: string, handler: XOpatLinkHandler): void {
        this._handlers.set(kind, handler);
    }

    unregister(kind: string): void {
        this._handlers.delete(kind);
    }

    has(kind: string): boolean {
        return this._handlers.has(kind);
    }

    /**
     * Parse `#xopat-<kind>?<query>`. Returns null for anything else, for an
     * unregistered kind, or for a payload its handler rejects — all three mean
     * "render this as an ordinary link".
     */
    parse(href: string): XOpatLinkDescriptor | null {
        if (typeof href !== "string" || !href.startsWith(LINK_PREFIX)) return null;
        const rest = href.slice(LINK_PREFIX.length);
        const split = rest.indexOf("?");
        const kind = split < 0 ? rest : rest.slice(0, split);
        const query = split < 0 ? "" : rest.slice(split + 1);
        const handler = this._handlers.get(kind);
        if (!handler) return null;

        let params: URLSearchParams;
        try {
            params = new URLSearchParams(query);
        } catch (_e) {
            return null;
        }
        const payload = handler.parse(params);
        if (payload == null) return null;
        return {kind, payload, title: handler.titleKey ? this._t(handler.titleKey) : undefined};
    }

    /** Act on a parsed descriptor or on a raw `#xopat-…` href. */
    open(link: XOpatLinkDescriptor | string): boolean {
        const descriptor = typeof link === "string" ? this.parse(link) : link;
        if (!descriptor) return false;
        const handler = this._handlers.get(descriptor.kind);
        if (!handler) return false;
        try {
            return handler.activate(descriptor.payload);
        } catch (error) {
            console.warn(`[markdown] link action '${descriptor.kind}' failed:`, error);
            return false;
        }
    }

    /**
     * Teach the built-in `region` handler how to resolve viewer references it would
     * not otherwise understand. The chat module registers one for its per-session
     * anonymization handles (`viewer-1`), which is why an assistant-authored link
     * resolves the same no matter which subsystem renders the text.
     */
    registerViewerResolver(resolver: ViewerResolver): void {
        if (typeof resolver === "function") this._viewerResolvers.push(resolver);
    }

    /**
     * Reference → live viewer. Order: real `uniqueId`, then registered resolvers,
     * then the active viewer, then the sole open viewer.
     */
    resolveViewer(reference: string | null): any | null {
        const viewers: any[] = (globalThis as any).VIEWER_MANAGER?.viewers || [];
        if (!viewers.length) return null;

        const ref = (typeof reference === "string" && reference.trim()) ? reference.trim() : null;
        if (ref) {
            const direct = viewers.find((v: any) => String(v?.uniqueId || "") === ref);
            if (direct) return direct;
            for (const resolve of this._viewerResolvers) {
                let resolved: any = null;
                try { resolved = resolve(ref); } catch (e) { console.warn("[markdown] viewer resolver failed:", e); }
                if (typeof resolved === "string") {
                    const byId = viewers.find((v: any) => String(v?.uniqueId || "") === resolved);
                    if (byId) return byId;
                } else if (resolved) {
                    return resolved;
                }
            }
        }
        const activeId = (globalThis as any).VIEWER_MANAGER?.getActiveUniqueId?.();
        const active = activeId ? viewers.find((v: any) => String(v?.uniqueId || "") === String(activeId)) : null;
        if (active) return active;
        return viewers.length === 1 ? viewers[0] : null;
    }

    warn(key: string): void {
        const Dialogs = (globalThis as any).Dialogs;
        Dialogs?.show?.(this._t(key), 4000, Dialogs?.MSG_WARN);
    }
}

/** Payload of a `#xopat-region` link — level-0 image pixels, parent-global. */
export interface RegionLinkPayload {
    viewer: string | null;
    x: number;
    y: number;
    w: number | null;
    h: number | null;
    z: number | null;
}

/**
 * Navigate a viewer to a slide region. Coordinates are level-0 image pixels,
 * parent-global for virtual-region splits — the same space as annotation
 * coordinates, pathology `bounds`, and `viewer.frameImageRegion(...)` (whose
 * fit/pad semantics this mirrors).
 */
function regionHandler(links: XOpatLinks): XOpatLinkHandler {
    return {
        titleKey: "links.goToRegion",
        parse(params: URLSearchParams): RegionLinkPayload | null {
            const num = (key: string): number | null => {
                const raw = params.get(key);
                if (raw == null || raw === "") return null;
                const value = Number(raw);
                return Number.isFinite(value) ? value : null;
            };
            const x = num("x");
            const y = num("y");
            // Without a position there is nothing to navigate to; such a link is
            // malformed rather than "mine", so it renders as ordinary text/link.
            if (x == null || y == null) return null;
            const viewer = (params.get("viewer") || "").trim();
            return {viewer: viewer || null, x, y, w: num("w"), h: num("h"), z: num("z")};
        },
        activate(payload: RegionLinkPayload): boolean {
            const viewer = links.resolveViewer(payload?.viewer ?? null);
            const x = Number(payload?.x);
            const y = Number(payload?.y);
            if (!viewer || !Number.isFinite(x) || !Number.isFinite(y)) {
                links.warn("links.regionUnavailable");
                return false;
            }

            try {
                // Switch the focal plane first when the link pins one (z-stack slides only) —
                // same path as viewer.setZDepth; a no-op for single-plane slides.
                const z = Number(payload?.z);
                if (Number.isFinite(z)) {
                    viewer.__depthController?.setDepth?.(Math.round(z));
                }

                const item: any = viewer.scalebar?.getReferencedTiledImage?.()
                    || (viewer.world?.getItemCount?.() > 0 ? viewer.world.getItemAt(0) : null);
                if (!item) throw new Error("The viewer has no tiled image to navigate.");

                const OSD = (globalThis as any).OpenSeadragon;
                // Virtual-region crops expose the parent↔region mapping on their source —
                // link coordinates are parent-global, so map them into the crop first.
                const source = item.source;
                const cropped = source && typeof source.getParentId === "function" && source.getParentId() ? source : null;
                const toViewport = (px: number, py: number) => {
                    const local = cropped ? cropped.fromParentImageCoordinates({x: px, y: py}) : {x: px, y: py};
                    return item.imageToViewportCoordinates(new OSD.Point(local.x, local.y));
                };

                const w = Number.isFinite(Number(payload?.w)) ? Math.max(0, Number(payload.w)) : 0;
                const h = Number.isFinite(Number(payload?.h)) ? Math.max(0, Number(payload.h)) : 0;
                const tl = toViewport(x, y);
                const br = toViewport(x + w, y + h);

                const vw = Math.abs(br.x - tl.x);
                const vh = Math.abs(br.y - tl.y);
                if (vw > 0 && vh > 0) {
                    const pad = 0.1;
                    viewer.viewport.fitBounds(new OSD.Rect(
                        Math.min(tl.x, br.x) - vw * pad,
                        Math.min(tl.y, br.y) - vh * pad,
                        vw * (1 + 2 * pad),
                        vh * (1 + 2 * pad),
                    ));
                } else {
                    // Point of interest — centre on it without changing zoom.
                    viewer.viewport.panTo(new OSD.Point(tl.x, tl.y));
                }
                viewer.viewport.applyConstraints();
                return true;
            } catch (error) {
                console.warn("[markdown] region link navigation failed:", error);
                links.warn("links.regionUnavailable");
                return false;
            }
        },
    };
}
