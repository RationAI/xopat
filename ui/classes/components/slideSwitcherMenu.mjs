// ui/classes/components/slideSwitcher.mjs
import van from "../../../../../Desktop/Vis2/src/xopat/ui/vanjs.mjs";
import {BaseComponent} from "../baseComponent.mjs";
import {Div} from "../elements/div.mjs";
import {FAIcon} from "../elements/fa-icon.mjs";
import {FloatingWindow} from "./floatingWindow.mjs";

const { div, input, label, img, span, button } = van.tags;

/**
 * SlideSwitcherMenu (compact, instant selection; embedded FloatingWindow)
 */
export class SlideSwitcherMenu extends BaseComponent {
    constructor(options = {}) {
        super(options);
        this._needsRefresh = true;
        this._suspendUpdates = false; // used to batch "Clear all"
    }

    // ---------- public ----------
    open() {
        if (!this._fw) {
            // Window config
            this.windowId = this.options.id ?? "slide-switcher";
            this.title = this.options.title ?? "Slide Switcher";
            this.w = this.options.width ?? 520;
            this.h = this.options.height ?? 460;
            this.l = this.options.startLeft ?? 80;
            this.t = this.options.startTop ?? 80;

            // State
            this.stacked = !!APPLICATION_CONTEXT.getOption("stackedBackground");
            const pre = APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, false);
            const selection = (Array.isArray(pre) ? pre : (pre ? [pre] : [0])).map(Number.parseInt);
            this.selected = new Set(selection);

            // UI refs
            this._listEl = null;
            this._toolbarEl = null;

            // Floating window host
            this._fw = new FloatingWindow({
                id: this.windowId,
                title: this.title,
                width: this.w,
                height: this.h,
                startLeft: this.l,
                startTop: this.t,
                resizable: true,
                onClose: () => this.options.onClose?.(),
                onPopout: (w) => this.options.onPopout?.(w),
            }, new Div({
                    extraClasses: { body: "card-body p-1 gap-1 flex-1 min-h-0 overflow-hidden" }
                },
                (this._toolbarEl = this._renderToolbar()),
                (this._listEl = this._renderList([])),
            ));
        }

        if (!this._fw.opened()) {
            this._fw.attachTo(document.body);
        } else {
            this._fw.focus();
        }
        if (this._needsRefresh) this.refresh();
    }

    close() { this._fw.close(); }
    opened() { return this._fw && this._fw.opened(); }

    refresh() {
        if (!this.opened()) { this._needsRefresh = true; return; }

        // Data sources
        this.data = this.options.data ?? APPLICATION_CONTEXT.config.data ?? [];
        this.background = this.options.background ?? APPLICATION_CONTEXT.config.background ?? [];

        // Re-render list
        const parent = this._listEl.parentNode;
        const newList = this._renderList(this.background);
        parent.replaceChild(newList, this._listEl);
        this._listEl = newList;
        this._needsRefresh = false;
    }

    // ---------- internals ----------
    _isViewable(bg) {
        return bg && typeof bg.dataReference === "number" && this.data?.[bg.dataReference] != null;
    }

    _displayName(bg) {
        const path = this.data?.[bg.dataReference] ?? "";
        if (bg?.name) return bg.name;
        try {
            return (globalThis.UTILITIES.fileNameFromPath(path)) ?? (path.split(/[\\/]/).pop() || "(unnamed)");
        } catch {
            return path.split(/[\\/]/).pop() || "(unnamed)";
        }
    }

    _openWith(bgIndices) {
        APPLICATION_CONTEXT.openViewerWith(
            this.data,
            this.background,
            APPLICATION_CONTEXT.config.visualizations,
            bgIndices,
            undefined,
            { deriveOverlayFromBackgroundGoals: true },
        );
        APPLICATION_CONTEXT.setOption?.("activeBackgroundIndex", Array.isArray(bgIndices) ? bgIndices : [bgIndices]);
    }

    _openCurrentSelection() {
        // Called after any change; if empty, still trigger one update with [] so the app can clear.
        const chosen = Array.from(this.selected).sort((a,b)=>a-b);
        this._openWith(chosen);
    }

    _onCardClick(idx) {
        // Single-open: replace selection with just this idx, update once
        this._suspendUpdates = true;
        // Uncheck all checkboxes visually
        this.selected.clear();
        const checks = document.querySelectorAll(`#${this.windowId}-list input[type="checkbox"]`);
        checks.forEach(ch => { ch.checked = false; });
        // select the clicked one
        this.selected.add(idx);
        const box = document.getElementById(`${this.windowId}-chk-${idx}`);
        if (box) box.checked = true;
        this._toggleCardRing(idx, true);
        // remove rings from others
        checks.forEach(ch => {
            const i = Number(ch.getAttribute("data-idx"));
            if (i !== idx) this._toggleCardRing(i, false);
        });
        this._suspendUpdates = false;
        this._openCurrentSelection();
    }

    _onCheck(idx, checked) {
        if (checked) this.selected.add(idx);
        else this.selected.delete(idx);
        this._toggleCardRing(idx, checked);
        if (!this._suspendUpdates) this._openCurrentSelection();
    }

    _toggleCardRing(idx, on) {
        const card = document.getElementById(`${this.windowId}-card-${idx}`);
        if (!card) return;
        card.classList.toggle("ring", !!on);
        card.classList.toggle("ring-primary", !!on);
        card.classList.toggle("ring-offset-1", !!on);
    }

    _clearAll = () => {
        if (!this.selected.size) return;
        this._suspendUpdates = true;
        this.selected.clear();
        const checks = document.querySelectorAll(`#${this.windowId}-list input[type="checkbox"]`);
        checks.forEach(ch => { ch.checked = false; });
        // remove all rings
        const cards = document.querySelectorAll(`#${this.windowId}-list .slide-card`);
        cards.forEach(c => c.classList.remove("ring","ring-primary","ring-offset-1"));
        this._suspendUpdates = false;
        // Single update
        this._openCurrentSelection();
    };

    _renderToolbar() {
        const toggleId = `${this.windowId}-stacked`;
        return div({ class: "flex items-center justify-between gap-2 px-2 py-1 border border-base-300 bg-base-100" },
            // left: tiny title
            div({ class: "flex items-center gap-2 text-sm" },
                new FAIcon({ name: "fa-images" }).create(),
                span({ class: "font-semibold" }, this.title),
            ),
            // right: stacked toggle + clear
            div({ class: "flex items-center gap-2" },
                div({ class: "form-control" },
                    label({ for: toggleId, class: "label cursor-pointer gap-2 py-0" },
                        span({ class: "label-text text-xs" }, "Stacked"),
                        input({
                            id: toggleId, type: "checkbox",
                            class: "toggle toggle-xs",
                            checked: this.stacked,
                            onchange: (e) => {
                                this.stacked = !!e.target.checked;
                                APPLICATION_CONTEXT.setOption?.("stackedBackground", this.stacked);
                                // Re-open with current selection immediately so mode applies
                                this._openCurrentSelection();
                            }
                        })
                    )
                ),
                button({
                    class: "btn btn-ghost btn-xs",
                    title: "Clear all selections",
                    onclick: this._clearAll
                }, "Clear")
            )
        );
    }

    _renderSlideCard(idx, bg) {
        const viewable = this._isViewable(bg);
        if (!viewable) return null;

        const name = this._displayName(bg);
        const checkboxId = `${this.windowId}-chk-${idx}`;
        const checked = this.selected.has(idx);

        const imageEl = img({
            id: `${this.windowId}-thumb-${idx}`,
            // absolute so the translate is deterministic; rotate into a horizontal row
            class: "block h-auto w-full rotate-90 select-none shrink-0 w-full",
            alt: name,
            draggable: "false",
            onerror: (e) => { e.target.classList.add("opacity-30"); e.target.removeAttribute("src"); },
        });
        const thumbWrap = div({ class: "relative h-20 overflow-hidden" },
            div({ class: "absolute left-1 top-1 z-10  px-2 py-1 text-xs font-medium truncate" }, name),
            imageEl
        );

        // request preview url (kept from your current logic)
        const imagePath = this.data[bg.dataReference];
        const eventArgs = {
            server: APPLICATION_CONTEXT.env.client.image_group_server,
            usesCustomProtocol: !!bg.protocolPreview,
            image: imagePath,
            imagePreview: null,
        };

        //todo correct VIEWER ref
        VIEWER.raiseEventAwaiting('get-preview-url', eventArgs).then(() => {
            let blobUrl;
            if (!eventArgs.imagePreview) {
                const previewUrlmaker = new Function("path,data", "return " +
                    (bg.protocolPreview || APPLICATION_CONTEXT.env.client.image_group_preview));
                eventArgs.imagePreview = previewUrlmaker(eventArgs.server, imagePath);
            } else if (typeof eventArgs.imagePreview !== "string") {
                blobUrl = eventArgs.imagePreview = URL.createObjectURL(eventArgs.imagePreview);
            }
            imageEl.src = eventArgs.imagePreview;
            // (optional) revoke later if you attach onload; safe to omit here
        });

        return div({
                id: `${this.windowId}-card-${idx}`,
                class: "slide-card bg-base-200 border border-base-300 transition " +
                    (checked ? "ring ring-primary ring-offset-1 " : "") +
                    "cursor-pointer flex flex-row",
                onclick: () => this._onCardClick(idx),
            },
            div({
                class: "relative bg-base-300 w-10",
                style: "width: 80px"
            }, input({
                id: checkboxId,
                "data-idx": idx,
                type: "checkbox",
                class: "absolute left-1 top-1 z-10 checkbox checkbox-xs",
                checked: checked,
                onclick: (e) => e.stopPropagation(),
                onchange: (e) => this._onCheck(idx, e.target.checked),
                title: "Add/remove from view"
            })),
            thumbWrap
        );
    }

    _renderList(backgroundList) {
        const items = [];
        for (let i = 0; i < backgroundList.length; i++) {
            const card = this._renderSlideCard(i, backgroundList[i]);
            if (card) items.push(card);
        }

        return div({
            id: `${this.windowId}-list`,
            class: "p-1 grid gap-1 overflow-auto flex-1 min-h-0",
            style: "grid-template-columns: repeat(auto-fill, minmax(240px, 90px));",
        }, ...items);
    }

    // BaseComponent contract
    create() { return this._fw.create(); }
}
