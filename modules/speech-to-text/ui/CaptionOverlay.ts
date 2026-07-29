/// <reference path="../../../src/types/globals.d.ts" />

// Cross-boundary UI access is via the global UI/van namespaces, never ES imports
// from `ui/` (§0/§5). BaseComponent gives us reactive class/prop state for free.
const {BaseComponent} = (globalThis as any).UI;
const {div, span} = (globalThis as any).van.tags;

export interface CaptionOverlayOptions {
    id?: string;
    /** Element id to mount into. Defaults to the viewer area (`osd`). */
    mountId?: string;
    /** Distance from the bottom of the viewer area, px. */
    bottomPx?: number;
}

/**
 * Video-subtitle-style caption band over the viewer area.
 *
 * Purely presentational: the owning module drives it (what text to show, the
 * "Listening…" hint, visibility) — the overlay holds no capture logic. Mounts
 * into `#osd` (the viewer bounding box, below the top app bar) and anchors
 * bottom-center, so it never overlaps the global menu and stays clear of the
 * bottom-right StatusBar / bottom-left scalebar. `pointer-events:none` so it
 * never eats a click meant for the slide.
 *
 * Effective visibility = `_visible` (owner-driven) AND NOT `_chromeHidden`
 * (the top-bar "hide UI" button), so both can hide it independently.
 */
export class CaptionOverlay extends BaseComponent {
    private _text: any;      // van.state<string> — the recent transcript lines
    private _hint: any;      // van.state<string> — placeholder shown when no text
    private _dim: any;       // van.state<boolean> — low-confidence styling
    private _style: any;     // van.state<string>
    private _visible = false;
    private _chromeHidden = false;

    constructor(options: CaptionOverlayOptions = {}) {
        options = (super(options) as any).options;
        this.id = options.id || "speech-captions";
        this.mountId = options.mountId || "osd";
        const bottomPx = Number.isFinite(options.bottomPx as any) ? (options.bottomPx as number) : 72;

        const van = (globalThis as any).van;
        this._text = van.state("");
        this._hint = van.state("");
        this._dim = van.state(false);
        this._style = van.state([
            "position: absolute;",
            `bottom: ${bottomPx}px;`,
            "left: 50%;",
            "transform: translateX(-50%);",
            "max-width: min(70%, 900px);",
            "text-align: center;",
            "z-index: 50;",
            "pointer-events: none;",
        ].join(" "));

        this.classMap = {
            ...(this.classMap || {}),
            base: "absolute glass fixed-bg-opacity bg-opacity px-3 py-2 rounded-2 " +
                "text-base-content text-lg leading-snug whitespace-pre-wrap pointer-events-none",
        };
        this.toggleClass("hidden", "hidden", true);   // starts hidden
        this.refreshClassState();
    }

    /** @override */
    create() {
        return div(
            {...this.commonProperties, style: this._style, ...this.extraProperties},
            // Reactive children (functions) — van escapes text nodes, so raw
            // transcript / speech text can never inject markup.
            () => (this._text.val
                ? span({class: this._dim.val ? "opacity-60" : ""}, this._text.val)
                : span({class: "opacity-70 italic"}, this._hint.val || "")),
        );
    }

    /** Replace the shown transcript text (already trimmed/joined by the owner). */
    setText(text: string, opts: {dim?: boolean} = {}) {
        this._text.val = String(text || "");
        this._dim.val = !!opts.dim;
        return this;
    }

    /** Placeholder shown while there is no recent transcript (e.g. "Listening…"). */
    setHint(text: string) {
        this._hint.val = String(text || "");
        return this;
    }

    clear() {
        this._text.val = "";
        return this;
    }

    /** Owner-driven visibility. */
    setVisible(visible: boolean) {
        this._visible = !!visible;
        this._applyVisibility();
        return this;
    }

    /** Top-bar "hide UI" gate — independent of owner visibility. */
    setChromeHidden(hidden: boolean) {
        this._chromeHidden = !!hidden;
        this._applyVisibility();
        return this;
    }

    /** Is the band currently on screen (owner wants it AND chrome isn't hiding it)? */
    isShown() {
        return this._visible && !this._chromeHidden;
    }

    private _applyVisibility() {
        const shown = this.isShown();
        this.toggleClass("hidden", "hidden", !shown);
        if (this.context) this.context.className = String(this.classState.val || "");
    }
}
