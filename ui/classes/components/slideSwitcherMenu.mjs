// ui/classes/components/slideSwitcher.mjs
import van from "../../vanjs.mjs";
import {BaseComponent} from "../baseComponent.mjs";
import {Div} from "../elements/div.mjs";
import {FAIcon} from "../elements/fa-icon.mjs";
import {FloatingWindow} from "./floatingWindow.mjs";

const { div, input, label, img, span, button } = van.tags;

/**
 * SlideSwitcherMenu (compact, instant selection; embedded FloatingWindow)
 */
export class SlideSwitcherMenu extends BaseComponent {
    constructor(options = undefined) {
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
            const selection = (Array.isArray(pre) ? pre : (pre ? [pre] : [0])).map(Number);
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

    _openCurrentSelection() {
        const chosen = Array.from(this.selected).sort((a,b)=>a-b);
        this._openWith(chosen);

        // Give the viewer manager a tick to (re)build, then refresh icons
        setTimeout(() => this._refreshAllLinkIcons(), 0);
    }

    refresh() {
        if (!this.opened()) { this._needsRefresh = true; return; }
        this.data = this.options.data ?? APPLICATION_CONTEXT.config.data ?? [];
        this.background = this.options.background ?? APPLICATION_CONTEXT.config.background ?? [];

        const parent = this._listEl.parentNode;
        const newList = this._renderList(this.background);
        parent.replaceChild(newList, this._listEl);
        this._listEl = newList;

        // After (re)render, sync link icons
        this._refreshAllLinkIcons();
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

        // wrapper: aspect-ratio container instead of fixed h-20 + rotate-90
        const thumbWrap = div({
                class: "relative overflow-hidden cursor-pointer",
                style: "aspect-ratio: 4/3;", // TODO: compute from bg.width/bg.height if available
                onclick: () => this._onCardClick(idx)
            },
            div({ class: "absolute left-1 top-1 z-10 px-2 py-1 text-xs font-medium truncate bg-black/60 text-white rounded" }, name),
            div({ class: "absolute inset-0 grid place-items-center" },
                img({
                    id: `${this.windowId}-thumb-${idx}`,
                    class: "max-w-[86%] max-h-[86%] object-contain select-none pointer-events-none",
                    alt: name,
                    draggable: "false",
                    onerror: (e) => { e.target.classList.add("opacity-30"); e.target.removeAttribute("src"); },
                })
            )
        );

        // --- Preview URL fetch (unchanged) ---
        const imagePath = this.data[bg.dataReference];
        const eventArgs = {
            server: APPLICATION_CONTEXT.env.client.image_group_server,
            usesCustomProtocol: !!bg.protocolPreview,
            image: imagePath,
            imagePreview: null,
        };
        VIEWER_MANAGER.raiseEventAwaiting("get-preview-url", eventArgs).then(() => {
            if (!eventArgs.imagePreview) {
                const previewUrlmaker = new Function("path,data", "return " +
                    (bg.protocolPreview || APPLICATION_CONTEXT.env.client.image_group_preview));
                eventArgs.imagePreview = previewUrlmaker(eventArgs.server, imagePath);
            } else if (eventArgs.imagePreview instanceof Image) {
                const imageEl = eventArgs.imagePreview;
                imageEl.classList.add("max-w-[86%]", "max-h-[86%]", "object-contain", "select-none");
                imageEl.id = `${this.windowId}-thumb-${idx}`;
                return;
            } else if (typeof eventArgs.imagePreview !== "string" && !(eventArgs.imagePreview instanceof Image)) {
                eventArgs.imagePreview = URL.createObjectURL(eventArgs.imagePreview);
                imageEl.onload = imageEl.onerror = () => URL.revokeObjectURL(eventArgs.imagePreview);
            }
            const imageEl = document.getElementById(`${this.windowId}-thumb-${idx}`);
            if (imageEl) imageEl.src = eventArgs.imagePreview;
        });

        // --- Existing viewer/link controls ---
        const viewer = this._getViewerForBg(idx);
        const linked = this._isLinked(viewer);

        const controls = div({ class: "flex items-center gap-2 p-2" },
            input({
                id: checkboxId,
                "data-idx": idx,
                type: "checkbox",
                class: "checkbox checkbox-xs",
                checked: checked,
                onclick: (e) => e.stopPropagation(),
                onchange: (e) => this._onCheck(idx, e.target.checked),
                title: "Add/remove from view"
            }),
            button({
                id: `${this.windowId}-lnk-${idx}`,
                class: "btn btn-ghost btn-xs",
                disabled: !viewer,
                title: viewer
                    ? (linked ? "Synced — click to unsync" : "Not synced — click to sync")
                    : "Not open",
                onclick: (e) => this._onToggleLink(idx, e)
            }, new FAIcon({ name: linked ? "fa-link" : "fa-link-slash" }).create())
        );

        // --- New action buttons (lock, visibility, center, fit, remove) ---
        const actionBar = div({
                class: "absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/60 to-transparent flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition"
            },
            button({ class: "btn btn-ghost btn-xs", onclick: () => VIEWER_MANAGER.centerSlide?.(idx) }, "Center"),
            button({ class: "btn btn-ghost btn-xs", onclick: () => VIEWER_MANAGER.fitSlide?.(idx) }, "Fit"),
            button({ class: "btn btn-ghost btn-xs", onclick: () => VIEWER_MANAGER.removeSlide?.(idx) }, "Remove"),
        );

        return div({
                id: `${this.windowId}-card-${idx}`,
                class: "slide-card group bg-base-200 border border-base-300 transition " +
                    (checked ? "ring ring-primary ring-offset-1 " : "") +
                    "flex flex-col relative"
            },
            controls,
            thumbWrap,
            actionBar
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

    // --- Viewer plumbing (default context=0) ---
    _getVM() {
        return globalThis.VIEWER_MANAGER || APPLICATION_CONTEXT?._vm || null;
    }
    _getViewerForBg(idx) {
        const vm = this._getVM();
        if (!vm || !vm.viewers || !vm.viewers.length) return null;

        const stacked = !!APPLICATION_CONTEXT.getOption("stackedBackground");
        if (stacked) return vm.viewers[0] || null;

        // map background index -> viewer index by current selection order
        const order = Array.from(this.selected).sort((a,b)=>a-b);
        const vIdx = order.indexOf(idx);
        return vIdx >= 0 ? vm.viewers[vIdx] || null : null;
    }
    _isLinked(viewer) {
        if (!viewer) return false;
        return !!viewer.tools.isLinked();
    }
    _link(viewer)  {
        if (!viewer) return;
        return viewer.tools.link();
    }
    _unlink(viewer){
        if (!viewer) return;
        return viewer.tools.unlink();
    }

    _updateLinkIcon(idx) {
        const btn = document.getElementById(`${this.windowId}-lnk-${idx}`);
        if (!btn) return;
        const viewer = this._getViewerForBg(idx);
        const linked = this._isLinked(viewer);
        btn.title = viewer
            ? (linked ? "Synced — click to unsync" : "Not synced — click to sync")
            : "Not open";
        btn.disabled = !viewer;
        btn.innerHTML = "";  // replace icon
        btn.appendChild(new FAIcon({ name: linked ? "fa-link" : "fa-link-slash" }).create());
    }
    _refreshAllLinkIcons() {
        // Call this after list render, after selection changes, and after viewer open
        const n = (this.background || []).length;
        for (let i = 0; i < n; i++) this._updateLinkIcon(i);
    }

    _onToggleLink(idx, ev) {
        ev?.stopPropagation?.();
        const viewer = this._getViewerForBg(idx);
        if (!viewer) return;
        if (this._isLinked(viewer)) this._unlink(viewer); else this._link(viewer);
        // Update all cards that might share the same viewer (esp. stacked)
        this._refreshAllLinkIcons();
    }

    // BaseComponent contract
    create() { return this._fw.create(); }
}
