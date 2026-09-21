/// <reference path="../../src/types/globals.d.ts" />

import type {MarkdownRenderOptions} from "./renderer";

export type MarkdownViewOptions = MarkdownRenderOptions & { id?: string; extraClasses?: any };

/**
 * A markdown block as a UI component (AGENTS.md §0 rule 1 — app-state UI is never
 * raw DOM). Rendering itself lives in the module singleton; this is the mountable
 * wrapper, for call sites that compose components rather than manage a host node.
 *
 *     markdown.view(page.description).attachTo(container);
 *
 * `setText` re-renders in place, so a reactive caller does not rebuild the tree.
 *
 * The base class is resolved LAZILY, on first use. Reading `UI.BaseComponent` at
 * module scope evaluates while the module bundle loads — before the UI bundle
 * exists in some boot orders — and the resulting TypeError takes down the WHOLE
 * bundle, `addModule` included, leaving the module silently unregistered and every
 * consumer falling back to plain text.
 */
let MarkdownViewClass: any = null;

function defineMarkdownView(): any {
    if (MarkdownViewClass) return MarkdownViewClass;
    const BaseComponent = (globalThis as any).UI?.BaseComponent;
    if (!BaseComponent) throw new Error("MarkdownView needs the xOpat UI bundle (UI.BaseComponent) to be loaded.");

    MarkdownViewClass = class MarkdownView extends BaseComponent {

        _text: string;
        _renderOptions: MarkdownRenderOptions;
        _node: HTMLElement | null = null;

        constructor(text: string, options: MarkdownViewOptions = {}) {
            super({id: options.id, extraClasses: options.extraClasses});
            this._text = typeof text === "string" ? text : "";
            this._renderOptions = {
                inline: options.inline,
                sanitize: options.sanitize,
                transformText: options.transformText,
                links: options.links,
            };
        }

        setText(text: string): void {
            this._text = typeof text === "string" ? text : "";
            if (this._node) this._render(this._node);
        }

        create(): HTMLElement {
            const node = document.createElement(this._renderOptions.inline ? "span" : "div");
            node.id = this.id;
            node.className = `${this._renderOptions.inline ? "xo-md xo-md-inline" : "xo-md xo-md-body"} ${this.classState?.val || ""}`.trim();
            this._node = node;
            this._render(node);
            return node;
        }

        _render(node: HTMLElement): void {
            const markdown = (globalThis as any).singletonModule?.("markdown");
            if (markdown) markdown.renderInto(node, this._text, this._renderOptions);
            else node.textContent = this._text;
        }
    };
    return MarkdownViewClass;
}

/** Build a markdown component. The class is created on first call (see above). */
export function createMarkdownView(text: string, options: MarkdownViewOptions = {}): any {
    return new (defineMarkdownView())(text, options);
}
