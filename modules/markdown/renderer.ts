import {marked} from "marked";
import type {XOpatLinks, XOpatLinkDescriptor} from "./links";

/**
 * The rendering pipeline: markdown in, sanitized HTML out, `#xopat-…` links wired.
 *
 * Deliberately free of xOpat base classes and globals so it can be exercised
 * directly (the module class around it is a thin owner of locale + registry).
 * Equally deliberately *around* `marked`, never inside it: markdown is parsed by
 * the library and links are recognised afterwards, on the parsed markup. That
 * keeps this independent of which `marked` major is installed — the
 * renderer-override API changed shape between v4 and v13 — and leaves exactly one
 * link grammar in the system.
 */

export interface MarkdownRenderOptions {
    /** Inline rendering (`marked.parseInline`) — for labels, titles, table cells. */
    inline?: boolean;
    /** `sanitize-html` config override, merged over the module default. */
    sanitize?: any;
    /**
     * Presentation transform applied to TEXT ONLY, after parsing. It never sees a
     * href or an attribute, which is what lets chat restore friendly slide names
     * from anonymization handles without corrupting the handles inside link targets.
     */
    transformText?: (text: string) => string;
    /** Recognise `#xopat-…` links and make them actionable. Default true. */
    links?: boolean;
}

/**
 * Cheap pre-test: does this text contain anything markdown could act on?
 * Plain prose (the common case for a questionnaire description) then takes the
 * `textContent` path and never touches `marked`, the sanitizer, or the cache —
 * and never triggers the lazy sanitizer load either.
 */
const MARKDOWN_HINT = /[*_`~\[\]#>|<]|^\s*\d+\.\s|\n\s*\d+\.\s/;

export function needsMarkdown(text: string): boolean {
    return MARKDOWN_HINT.test(text);
}

/** Rendered-HTML cache bound; entries are small strings, evicted oldest-first. */
const CACHE_LIMIT = 300;

/** Degraded (plain-text) renders waiting for the sanitizer to arrive. */
const PENDING_LIMIT = 100;

export const DEFAULT_SANITIZE = {
    allowedTags: [
        "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "del",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "ul", "ol", "li", "blockquote",
        "pre", "code", "a", "span", "div",
        "table", "thead", "tbody", "tr", "th", "td",
    ],
    allowedAttributes: {
        a: ["href", "title", "target", "rel"],
        code: ["class"],
        pre: ["class"],
        span: ["class"],
        div: ["class"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    disallowedTagsMode: "discard",
    transformTags: {
        // In-page fragment hrefs (`#xopat-…` actions) must not open a new tab; every
        // other link leaves the app, so it gets the anti-tabnabbing pair.
        a: (tagName: string, attribs: Record<string, string>) => {
            const attrs = {...attribs};
            if (!String(attrs.href || "").startsWith("#")) {
                attrs.target = "_blank";
                attrs.rel = "noopener noreferrer";
            }
            return {tagName, attribs: attrs};
        },
    },
};

export class MarkdownRenderer {

    private _cache = new Map<string, string>();
    /** Stable short ids for caller-supplied sanitize configs, so cache keys stay cheap. */
    private _configIds = new WeakMap<object, number>();
    private _nextConfigId = 1;
    private _sanitizerRequested = false;
    private _pending: Array<WeakRef<HTMLElement>> = [];

    constructor(private readonly _links: XOpatLinks) {}

    /**
     * Render `text` into `host`. Always safe: unrenderable markdown or a missing
     * sanitizer both fall back to `host.textContent = text`.
     */
    renderInto(host: HTMLElement, text: string, opts: MarkdownRenderOptions = {}): void {
        if (!host) return;
        const source = typeof text === "string" ? text : String(text ?? "");
        if (!source) {
            host.textContent = "";
            return;
        }
        if (!needsMarkdown(source)) {
            this._plain(host, source, opts);
            return;
        }

        const html = this.renderToHtml(source, opts);
        if (html == null) {
            this._plain(host, source, opts);
            this._remember(host, source, opts);
            return;
        }

        host.classList.remove("xo-md-plain");
        host.innerHTML = html;
        if (opts.transformText) transformTextNodes(host, opts.transformText);
        if (opts.links !== false && html.includes("#xopat-")) this._activateLinks(host);
    }

    /**
     * String form, for callers that own the innerHTML assignment. Returns null when
     * the pipeline cannot run — the caller MUST then render plain text.
     * Prefer {@link renderInto}, which also wires up `#xopat-…` links.
     */
    renderToHtml(text: string, opts: MarkdownRenderOptions = {}): string | null {
        const source = typeof text === "string" ? text : String(text ?? "");
        if (!source) return "";

        const key = `${opts.inline ? "i" : "b"}|${this._configId(opts.sanitize)}|${source}`;
        const hit = this._cache.get(key);
        if (hit !== undefined) {
            // Refresh recency — a description re-rendered on every keystroke must not
            // be evicted by a one-off long message.
            this._cache.delete(key);
            this._cache.set(key, hit);
            return hit;
        }

        const parsed = this._parse(source, opts.inline === true);
        if (parsed == null) return null;
        const clean = this._sanitize(parsed, opts.sanitize);
        if (clean == null) return null;

        if (this._cache.size >= CACHE_LIMIT) {
            const oldest = this._cache.keys().next();
            if (!oldest.done) this._cache.delete(oldest.value);
        }
        this._cache.set(key, clean);
        return clean;
    }

    /** Re-render everything that had to degrade to plain text. */
    upgradePending(): void {
        const pending = this._pending;
        this._pending = [];
        for (const ref of pending) {
            const host = ref.deref();
            const state = host && (host as any).__xoMdPending;
            if (!host || !state || !host.isConnected) continue;
            delete (host as any).__xoMdPending;
            this.renderInto(host, state.text, state.opts);
        }
    }

    // ---------------------------------------------------------------- internals

    /**
     * Plain-text rendering — the fast path AND the degrade-closed path.
     * `xo-md-plain` restores `pre-wrap`: markdown collapses newlines and the host
     * class does too, so unparsed text would otherwise lose its line breaks.
     */
    private _plain(host: HTMLElement, source: string, opts: MarkdownRenderOptions): void {
        host.classList.add("xo-md-plain");
        host.textContent = opts.transformText ? opts.transformText(source) : source;
    }

    private _parse(source: string, inline: boolean): string | null {
        // `marked` is bundled into this module (package.json dependency), so the
        // parser is always present — only the sanitizer can be missing.
        const options = {gfm: true, breaks: true, async: false} as any;
        try {
            return String(inline ? marked.parseInline(source, options) : marked.parse(source, options));
        } catch (error) {
            console.warn("[markdown] parse failed; falling back to plain text:", error);
            return null;
        }
    }

    /**
     * Returns sanitized HTML, or null when it cannot be sanitized. Authored text is
     * untrusted (a model wrote it, or it arrived in an imported bundle), so an
     * unavailable sanitizer must degrade CLOSED — callers render null as plain
     * `textContent` (AGENTS.md §0 rule 2 / §7).
     */
    private _sanitize(html: string, override: any): string | null {
        const sanitizer = (globalThis as any).SanitizeHtml;
        if (typeof sanitizer !== "function") {
            this._requestSanitizer();
            return null;
        }
        const config = override ? {...DEFAULT_SANITIZE, ...override} : DEFAULT_SANITIZE;
        try {
            return sanitizer(html, config);
        } catch (error) {
            console.warn("[markdown] sanitize failed; falling back to plain text:", error);
            return null;
        }
    }

    private _configId(config: any): number {
        if (!config || typeof config !== "object") return 0;
        let id = this._configIds.get(config);
        if (id === undefined) {
            id = this._nextConfigId++;
            this._configIds.set(config, id);
        }
        return id;
    }

    /**
     * Turn `#xopat-<kind>?…` anchors into actions. One delegated listener per host,
     * not one closure per anchor: cached HTML is re-mounted often, and the payloads
     * live beside the host rather than inside per-node handlers.
     */
    private _activateLinks(host: HTMLElement): void {
        const anchors = host.querySelectorAll('a[href^="#xopat-"]');
        if (!anchors.length) return;

        const payloads: XOpatLinkDescriptor[] = [];
        for (const anchor of Array.from(anchors)) {
            const descriptor = this._links.parse(anchor.getAttribute("href") || "");
            // Unknown kind or malformed query: leave it as the ordinary link marked
            // rendered. A dead action is worse than a link that does nothing special.
            if (!descriptor) continue;
            const index = payloads.push(descriptor) - 1;
            anchor.setAttribute("data-xopat-link", String(index));
            anchor.removeAttribute("target");
            anchor.removeAttribute("rel");
            anchor.classList.add("link", "link-primary", "cursor-pointer");
            if (descriptor.title) anchor.setAttribute("title", descriptor.title);
        }
        if (!payloads.length) return;

        (host as any).__xoMdLinks = payloads;
        if ((host as any).__xoMdBound) return;
        (host as any).__xoMdBound = true;
        host.addEventListener("click", (event: Event) => {
            const target = (event.target as HTMLElement)?.closest?.("a[data-xopat-link]");
            if (!target || !host.contains(target)) return;
            const list: XOpatLinkDescriptor[] = (host as any).__xoMdLinks || [];
            const descriptor = list[Number(target.getAttribute("data-xopat-link"))];
            if (!descriptor) return;
            event.preventDefault();
            this._links.open(descriptor);
        });
    }

    /** One-shot lazy load so later renders get real markup back. */
    private _requestSanitizer(): void {
        if (this._sanitizerRequested) return;
        const utils = (globalThis as any).UTILITIES;
        if (!utils?.loadModules) return;
        this._sanitizerRequested = true;
        try { utils.loadModules(() => {}, "sanitize-html"); }
        catch (_e) { /* best effort */ }
    }

    private _remember(host: HTMLElement, text: string, opts: MarkdownRenderOptions): void {
        (host as any).__xoMdPending = {text, opts};
        if (this._pending.length >= PENDING_LIMIT) this._pending.shift();
        this._pending.push(new WeakRef(host));
    }
}

/**
 * Apply a presentation transform to text nodes only. Attributes — hrefs above all
 * — are never visited, so a transform cannot rewrite a link target.
 */
function transformTextNodes(root: HTMLElement, transform: (text: string) => string): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
        const value = node.nodeValue;
        if (!value) continue;
        const next = transform(value);
        if (next !== value) node.nodeValue = next;
    }
}
