/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />

import {XOpatLinks} from "./links";
import type {XOpatLinkDescriptor, RegionLinkPayload, ViewerResolver} from "./links";
import {MarkdownRenderer, needsMarkdown, DEFAULT_SANITIZE} from "./renderer";
import type {MarkdownRenderOptions} from "./renderer";
import {createMarkdownView} from "./MarkdownView";
import type {MarkdownViewOptions} from "./MarkdownView";

/**
 * Shared markdown rendering.
 *
 * Text authored by an assistant — or imported from a peer session — is markdown,
 * and it reaches more than one subsystem: chat bubbles, recorder overlays,
 * questionnaire prose. Each of those used to carry its own copy of "find a
 * markdown parser, sanitize, degrade closed, lazily load the sanitizer", which is
 * how the same `[label](#xopat-region?…)` link rendered as a working button in
 * chat and as dead text everywhere else.
 *
 * `marked` is a bundled dependency of this module rather than a separately
 * published npm-module global: one module owns markdown, and consumers declare one
 * dependency instead of three.
 *
 * The pipeline lives in renderer.ts and the `#xopat-<kind>` mechanism in links.ts;
 * this class owns the module identity, the locale bundle and the singletons.
 */
class MarkdownModule extends (XOpatModuleSingleton as any) {

    /** The `#xopat-<kind>` link registry. Public — subsystems register their kinds here. */
    links: XOpatLinks;
    private _renderer: MarkdownRenderer;
    private _localeReady: Promise<void>;

    /** `module-loaded` is subscribed lazily; VIEWER_MANAGER may not exist at load time. */
    private _upgradeHooked = false;

    constructor() {
        super();
        this._localeReady = this.loadLocale().catch((e: any) =>
            console.warn("[markdown] locale load failed:", e));
        this.links = new XOpatLinks((key: string, options?: any) => this.t(key, options));
        this._renderer = new MarkdownRenderer(this.links);
        this._hookSanitizerUpgrade();
    }

    /** Render markdown into `host`; degrades to `textContent` when it cannot. */
    renderInto(host: HTMLElement, text: string, opts?: MarkdownRenderOptions): void {
        this._hookSanitizerUpgrade();
        this._renderer.renderInto(host, text, opts);
    }

    /**
     * A late-arriving sanitizer must upgrade what was rendered as plain text,
     * otherwise a first paint that raced the module load stays degraded forever.
     *
     * Subscribed on first opportunity rather than in the constructor alone: this
     * module can be instantiated before `VIEWER_MANAGER` exists, and an unguarded
     * reference there is a ReferenceError that takes the whole module down.
     */
    private _hookSanitizerUpgrade(): void {
        if (this._upgradeHooked) return;
        const manager = (globalThis as any).VIEWER_MANAGER;
        if (!manager?.addHandler) return;
        this._upgradeHooked = true;
        manager.addHandler("module-loaded", (e: any) => {
            if (e?.id === "sanitize-html") this._renderer.upgradePending();
        });
    }

    /** Sanitized HTML string, or null when the caller must render plain text. */
    renderToHtml(text: string, opts?: MarkdownRenderOptions): string | null {
        return this._renderer.renderToHtml(text, opts);
    }

    /** Would this text change if rendered as markdown? False means the fast path. */
    isMarkdown(text: string): boolean {
        return needsMarkdown(String(text ?? ""));
    }

    /** A component wrapper for the same pipeline (`UI.BaseComponent` subclass). */
    view(text: string, opts?: MarkdownViewOptions): any {
        return createMarkdownView(text, opts);
    }

    /** Teach the built-in region links how to resolve a viewer reference; see links.ts. */
    registerViewerResolver(resolver: ViewerResolver): void {
        this.links.registerViewerResolver(resolver);
    }

    /** Act on a `#xopat-…` href or a parsed descriptor. */
    openLink(link: XOpatLinkDescriptor | string): boolean {
        return this.links.open(link);
    }

    /** Resolve a localized string from this module's namespace. */
    t(key: string, options?: any): string {
        return $.t(key, {ns: this.id, ...(options || {})});
    }

    whenLocaleReady(): Promise<void> {
        return this._localeReady;
    }
}

// NOT eager: an eager instance would run this constructor while the module bundle
// is still loading, i.e. before the rest of the app's globals exist. Consumers
// reach it through `singletonModule("markdown")`, which instantiates on demand.
addModule("markdown", MarkdownModule as any);

export {MarkdownModule, MarkdownRenderer, XOpatLinks, createMarkdownView, needsMarkdown, DEFAULT_SANITIZE};
export type {MarkdownRenderOptions, MarkdownViewOptions, XOpatLinkDescriptor, RegionLinkPayload, ViewerResolver};
