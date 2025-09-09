// ui/classes/components/slideSwitcher.mjs
import van from "../../vanjs.mjs";
import {BaseComponent} from "../baseComponent.mjs";
import {Div} from "../elements/div.mjs";
import {Button} from "../elements/buttons.mjs";
import {FAIcon} from "../elements/fa-icon.mjs";
import {FloatingWindow} from "./floatingWindow.mjs";

const { div, input, label, img, span } = van.tags;

/**
 * SlideSwitcher (embedded in its own FloatingWindow)
 *
 * Options:
 *  - id?: string                    // window id; default "slide-switcher"
 *  - title?: string                 // window + toolbar title; default "Slide Switcher"
 *  - width?: number                 // default 520
 *  - height?: number                // default 460
 *  - startLeft?: number             // persisted by FloatingWindow
 *  - startTop?: number
 *
 *  - data?: string[]                // optional; else APPLICATION_CONTEXT.getOption("data")
 *  - background?: Array<{...}>      // optional; else APPLICATION_CONTEXT.getOption("background")
 *  - maxThumbsHeight?: number       // inner list max height (px); default auto (adapts to window)
 *
 * Public helpers:
 *  - open(): void                   // attach window to document.body (or focus if already)
 *  - close(): void
 *  - refresh(): void                // re-reads data/background from APPLICATION_CONTEXT
 */
export class SlideSwitcherMenu extends BaseComponent {
    constructor(options = {}) {
        super(options);
        this._needsRefresh = true;
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
            this.stacked = !!APPLICATION_CONTEXT.getOption?.("stackedBackground");
            this.selected = new Set();

            // UI refs
            this._listEl = null;
            this._toolbarEl = null;

            // Controls
            this._btnOpen = new Button({
                extraClasses: { btn: "btn btn-primary btn-sm" },
                onClick: () => this._applySelection("replace"),
            }, span({}, "Open Selected"));

            this._btnAdd = new Button({
                extraClasses: { btn: "btn btn-ghost btn-sm" },
                onClick: () => this._applySelection("add"),
            }, span({}, "Add Selected"));

            // Floating window host (we’ll pass our content as child)
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
                    extraClasses: {body: "card-body p-2 gap-2 flex-1 min-h-0 overflow-hidden"}
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
        if (this._needsRefresh) {
            this.refresh();
        }
    }

    close() {
        this._fw.close();
    }

    opened() {
        return this._fw && this._fw.opened();
    }

    refresh() {
        if (!this.opened()) {
            this._needsRefresh = true;
            return;
        }

        // Data sources
        this.data = this.options.data ?? APPLICATION_CONTEXT.config.data ?? [];
        this.background = this.options.background ?? APPLICATION_CONTEXT.config.background ?? [];
        const parent = this._listEl.parentNode;
        const newList = this._renderList(this.background);
        parent.replaceChild(newList, this._listEl);
        this._listEl = newList;
    }

    // ---------- internals ----------
    _isViewable(bg) {
        return bg && typeof bg.dataReference === "number" && this.data?.[bg.dataReference] != null;
    }

    _displayName(bg) {
        const path = this.data?.[bg.dataReference] ?? "";
        if (bg?.name) return bg.name;
        try {
            return (globalThis.UTILITIES?.fileNameFromPath?.(path)) ?? (path.split(/[\\/]/).pop() || "(unnamed)");
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
        // remember last opened set for better "Add Selected"
        this.options.onOpen?.(Array.isArray(bgIndices) ? bgIndices : [bgIndices]);
        APPLICATION_CONTEXT.setOption("activeBackgroundIndex", Array.isArray(bgIndices) ? bgIndices : [bgIndices]);
    }

    _applySelection(mode /* replace | add */) {
        const chosen = Array.from(this.selected).sort((a,b)=>a-b);
        if (!chosen.length) return;

        if (mode === "replace") {
            this._openWith(chosen);
            return;
        }

        const existing = APPLICATION_CONTEXT.getOption("activeBackgroundIndex");
        const merged = Array.isArray(existing)
            ? Array.from(new Set([...existing, ...chosen])).sort((a,b)=>a-b)
            : chosen;

        this._openWith(merged);
    }

    _onCardClick(idx) { this._openWith([idx]); }

    _onCheck(idx, checked) {
        if (checked) this.selected.add(idx);
        else this.selected.delete(idx);
    }

    _renderToolbar() {
        const toggleId = `${this.windowId}-stacked`;
        return div({ class: "flex items-center justify-between gap-2 px-2 py-1 border border-base-300 bg-base-100" },
            div({ class: "flex items-center gap-2" },
                new FAIcon({ name: "fa-images" }).create(),
                span({ class: "font-semibold" }, this.title),
            ),
            div({ class: "flex items-center gap-3" },
                div({ class: "form-control" },
                    label({ for: toggleId, class: "label cursor-pointer gap-2" },
                        span({ class: "label-text text-sm" }, "Stacked view"),
                        input({
                            id: toggleId, type: "checkbox",
                            class: "toggle toggle-sm",
                            checked: this.stacked,
                            onchange: (e) => {
                                this.stacked = !!e.target.checked;
                                APPLICATION_CONTEXT.setOption?.("stackedBackground", this.stacked);
                                if (this.selected.size) this._applySelection("replace");
                            }
                        })
                    )
                ),
                this._btnAdd.create(),
                this._btnOpen.create(),
            )
        );
    }

    _renderSlideCard(idx, bg) {
        const viewable = this._isViewable(bg);
        const disabled = !viewable;
        const classes = "card bg-base-200 border border-base-300 hover:border-primary transition " +
            (disabled ? "opacity-50 pointer-events-none " : "cursor-pointer ");

        const name = this._displayName(bg);
        const checkboxId = `${this.windowId}-chk-${idx}`;
        const checked = this.selected.has(idx);

        const thumb = img({
            id: `${this.windowId}-thumb-${idx}`,
            class: "w-full h-24 object-center bg-base-300 object-contain",
            alt: name,
            onerror: (e) => { e.target.classList.add("opacity-30"); e.target.removeAttribute("src"); },
            draggable: "false",
        });

        const imagePath = this.data[bg.dataReference];
        const eventArgs = {
            server: APPLICATION_CONTEXT.env.client.image_group_server,
            usesCustomProtocol: !!bg.protocolPreview,
            image: imagePath,
            imagePreview: null,
        };

        // todo better reference - global event relay?
        VIEWER.raiseEventAwaiting('get-preview-url', eventArgs).then(() => {
            let blobUrl;
            if (!eventArgs.imagePreview) {
                const previewUrlmaker = new Function("path,data", "return " +
                    (bg.protocolPreview || APPLICATION_CONTEXT.env.client.image_group_preview));
                eventArgs.imagePreview = previewUrlmaker(eventArgs.server, imagePath);
            } else if (typeof eventArgs.imagePreview !== "string") {
                //treat as blob
                blobUrl = eventArgs.imagePreview = URL.createObjectURL(eventArgs.imagePreview);
            }

            // const img = new Image();
            // img.onload = () => {
            //     let child = img;
            //     if (img.width < img.height) {
            //         child = document.createElement("canvas");
            //         const context = child.getContext("2d");
            //         child.width = img.height;
            //         child.height = img.width;
            //         context.setTransform(0,-1, 1,0, 0, child.width/2);
            //         context.drawImage(img, 0, 0);
            //     }
            //     child.style.width = '180px';
            //     $(`#tissue-preview-item-${idx}`).append(child);
            //     if (blobUrl) URL.revokeObjectURL(blobUrl);
            // };
            // img.onerror = img.onabort = () => {
            //     $(`#tissue-preview-item-${idx}`).append('<span class="material-icons" style="color: darkred">warning</span>');
            //     if (blobUrl) URL.revokeObjectURL(blobUrl);
            // };
            thumb.src = eventArgs.imagePreview;
        });

        const header = div({ class: "card-title text-sm px-3 pt-2 select-none truncate" }, name);

        const body = div({ class: "card-body p-2 gap-2" },
            div({ class: "flex items-center gap-2" },
                input({
                    id: checkboxId, type: "checkbox",
                    class: "checkbox checkbox-sm",
                    checked,
                    onchange: (e) => this._onCheck(idx, e.target.checked),
                    onclick: (e) => e.stopPropagation(),
                }),
                label({ for: checkboxId, class: "label-text text-xs truncate" }, "Select"),
            ),
        );

        return div({ class: classes, onclick: () => this._onCardClick(idx) }, thumb, header, body);
    }

    _renderList(backgroundList) {
        const items = [];
        for (let i = 0; i < backgroundList.length; i++) {
            const bg = backgroundList[i];
            if (!this._isViewable(bg)) continue;
            items.push(this._renderSlideCard(i, bg));
        }

        // Adaptive height: fill remaining space of the window content
        return div({
            class: "p-2 grid gap-2 overflow-auto flex-1 min-h-0",
            style: "grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));",
        }, ...items);
    }

    // BaseComponent contract — when someone calls create(), we return the FloatingWindow’s element.
    create() {
        return this._fw.create();
    }
}
