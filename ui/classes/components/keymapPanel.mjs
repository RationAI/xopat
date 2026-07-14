// KeymapPanel — JetBrains-Keymap-style shortcut editor for the fullscreen
// menu (registered by the FullscreenMenus service next to Settings). Renders
// the central shortcut registry (`APPLICATION_CONTEXT.shortcuts`, see
// src/SHORTCUTS.md) as a searchable category tree with kbd chips; clicking a
// row records a new combo, with JetBrains-style conflict stealing.
import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div, span, input, button, i, kbd } = van.tags;

export class KeymapPanel extends BaseComponent {
    constructor(options = undefined, ...children) {
        super(options, ...children);
        this._search = "";
        /** Shortcut id currently in capture mode (waiting for a key press). */
        this._capturing = null;
        /** Pending conflict confirm: { id, combo, conflicts } or null. */
        this._conflict = null;
        this._captureListener = null;
        this._renderQueued = false;
        this._treeEl = null;
        /** Category paths the user folded (JetBrains-style tree, default open). */
        this._collapsed = new Set();

        const shortcuts = this._shortcuts;
        if (shortcuts?.addHandler) {
            const refresh = () => this._queueRender();
            shortcuts.addHandler("shortcut-registered", refresh);
            shortcuts.addHandler("shortcut-unregistered", refresh);
            shortcuts.addHandler("binding-changed", refresh);
            shortcuts.addHandler("bindings-reset", refresh);
        }
    }

    get _shortcuts() {
        return window.APPLICATION_CONTEXT?.shortcuts;
    }

    create() {
        this._treeEl = div({ class: "flex flex-col gap-2" });
        this._render();

        const searchInput = input({
            type: "search",
            class: "grow bg-transparent outline-none",
            placeholder: $.t("keymap.search"),
            oninput: (e) => {
                this._search = e.target.value.trim().toLowerCase();
                this._render();
            },
        });

        return div({ ...this.commonProperties, class: "relative flex min-h-full flex-col gap-4 pb-24 pt-3" },
            div({ class: "flex flex-wrap items-center justify-between gap-3" },
                span({ class: "text-2xl font-semibold" }, $.t("keymap.title")),
                div({ class: "flex items-center gap-2" },
                    div({ class: "input input-sm flex items-center gap-2" },
                        i({ class: "ph-light ph-magnifying-glass opacity-60" }),
                        searchInput
                    ),
                    button({
                        class: "btn btn-ghost btn-sm",
                        title: $.t("keymap.resetAll"),
                        onclick: () => {
                            if (window.confirm($.t("keymap.resetAllConfirm"))) {
                                this._cancelCapture();
                                this._shortcuts?.resetAllToDefaults();
                            }
                        },
                    }, i({ class: "ph-light ph-arrow-counter-clockwise" }), $.t("keymap.resetAll"))
                )
            ),
            div({ class: "rounded-2xl border border-base-300 bg-base-100 p-3 shadow-sm" }, this._treeEl)
        );
    }

    /** Coalesce bursts of registry events (e.g. module load) into one render. */
    _queueRender() {
        if (this._renderQueued) return;
        this._renderQueued = true;
        requestAnimationFrame(() => {
            this._renderQueued = false;
            this._render();
        });
    }

    _render() {
        if (!this._treeEl) return;
        this._treeEl.replaceChildren();

        const shortcuts = this._shortcuts;
        if (!shortcuts) return;

        const items = shortcuts.list().filter(item => this._matchesSearch(item));
        if (!items.length) {
            this._treeEl.append(div({ class: "px-2 py-6 text-center text-sm opacity-60" }, $.t("keymap.noResults")));
            return;
        }
        this._treeEl.append(...this._renderGroup(this._groupTree(items), 0));
    }

    _matchesSearch(item) {
        if (!this._search) return true;
        const haystack = [
            $.t(item.titleKey),
            ...(item.categoryPath || []).map(key => $.t(key)),
            ...item.combos.map(combo => this._shortcuts.comboDisplayParts(combo).join("+")),
        ].join(" ").toLowerCase();
        return haystack.includes(this._search);
    }

    /** Group flat shortcut list into a category tree keyed by categoryPath segments. */
    _groupTree(items) {
        const root = { children: new Map(), items: [] };
        for (const item of items) {
            let node = root;
            for (const segment of (item.categoryPath || [])) {
                if (!node.children.has(segment)) {
                    node.children.set(segment, { children: new Map(), items: [] });
                }
                node = node.children.get(segment);
            }
            node.items.push(item);
        }
        return root;
    }

    _renderGroup(node, depth, pathKey = "") {
        const out = node.items.map(item => this._renderRow(item));
        for (const [segment, child] of node.children) {
            const childPath = `${pathKey}/${segment}`;
            // Folders default open (JetBrains style); a search always expands
            // so matches are visible.
            const folded = !this._search && this._collapsed.has(childPath);
            out.push(div({ class: depth ? "ml-4" : "" },
                div({
                        class: "flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 font-medium hover:bg-base-200",
                        onclick: () => {
                            if (this._collapsed.has(childPath)) this._collapsed.delete(childPath);
                            else this._collapsed.add(childPath);
                            this._render();
                        },
                    },
                    i({ class: `ph-light ${folded ? "ph-caret-right" : "ph-caret-down"} opacity-60` }),
                    i({ class: "ph-light ph-folder opacity-60" }),
                    span({ class: "text-sm" }, $.t(segment))
                ),
                folded ? null : div({ class: "ml-4 flex flex-col gap-0.5" },
                    ...this._renderGroup(child, depth + 1, childPath))
            ));
        }
        return out;
    }

    _renderRow(item) {
        const { id, combos, isDefault } = item;

        if (this._conflict?.id === id) return this._renderConflictRow(item);

        if (this._capturing === id) {
            return div({ class: "flex items-center justify-between gap-2 rounded-lg bg-base-200 px-2 py-1.5" },
                span({ class: "text-sm" }, $.t(item.titleKey)),
                span({ class: "badge badge-primary animate-pulse text-xs" }, $.t("keymap.pressCombo"))
            );
        }

        const chips = combos.length
            ? combos.map(combo => this._renderCombo(combo))
            : [span({ class: "text-xs italic opacity-50" }, $.t("keymap.unbound"))];

        const actionButton = (iconName, titleKey, onclick) => button({
            class: "btn btn-ghost btn-xs opacity-0 transition-opacity group-hover:opacity-100",
            title: $.t(titleKey),
            onclick: (e) => { e.stopPropagation(); onclick(); },
        }, i({ class: `ph-light ${iconName}` }));

        const actions = [actionButton("ph-pencil-simple", "keymap.edit", () => this._startCapture(id))];
        if (combos.length) {
            actions.push(actionButton("ph-x", "keymap.unbind", () => this._shortcuts.setUserBinding(id, null)));
        }
        if (!isDefault) {
            actions.push(actionButton("ph-arrow-counter-clockwise", "keymap.reset", () => this._shortcuts.resetToDefault(id)));
        }

        return div({
                class: "group flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-base-200",
                title: item.descriptionKey ? $.t(item.descriptionKey) : undefined,
                onclick: () => this._startCapture(id),
            },
            div({ class: "flex min-w-0 items-center gap-2" },
                span({ class: `truncate text-sm${isDefault ? "" : " font-semibold"}` }, $.t(item.titleKey)),
                // JetBrains-style "modified" marker.
                isDefault ? null : span({ class: "text-primary", title: $.t("keymap.modified") }, "•")
            ),
            div({ class: "flex shrink-0 items-center gap-1" }, ...chips, ...actions)
        );
    }

    _renderCombo(combo) {
        const parts = this._shortcuts.comboDisplayParts(combo);
        const nodes = [];
        parts.forEach((part, index) => {
            if (index) nodes.push(span({ class: "text-xs opacity-50" }, "+"));
            nodes.push(kbd({ class: "kbd text-xs" }, part));
        });
        return span({ class: "flex items-center gap-0.5" }, ...nodes);
    }

    _renderConflictRow(item) {
        const { combo, conflicts } = this._conflict;
        const other = this._shortcuts.list().find(s => s.id === conflicts[0]);
        return div({ class: "flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warning/10 px-2 py-1.5" },
            div({ class: "flex min-w-0 items-center gap-2" },
                i({ class: "ph-light ph-warning text-warning" }),
                span({ class: "truncate text-sm" },
                    $.t("keymap.conflict", { shortcut: other ? $.t(other.titleKey) : conflicts[0] }))
            ),
            div({ class: "flex shrink-0 items-center gap-1" },
                this._renderCombo(combo),
                button({
                    class: "btn btn-warning btn-xs",
                    onclick: () => this._resolveConflict(true),
                }, $.t("keymap.reassign")),
                button({
                    class: "btn btn-ghost btn-xs",
                    onclick: () => this._resolveConflict(false),
                }, $.t("common.cancel"))
            )
        );
    }

    _startCapture(id) {
        this._cancelCapture();
        this._conflict = null;
        this._capturing = id;
        // Capture-phase window listener so neither the shortcut manager nor
        // any widget sees the recording key strokes.
        this._captureListener = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "Escape") {
                this._cancelCapture();
                this._render();
                return;
            }
            const combo = this._shortcuts.comboFromEvent(e);
            if (!combo) return; // pure-modifier press — keep waiting
            this._commitCapture(id, combo);
        };
        window.addEventListener("keydown", this._captureListener, { capture: true });
        this._render();
    }

    _cancelCapture() {
        if (this._captureListener) {
            window.removeEventListener("keydown", this._captureListener, { capture: true });
            this._captureListener = null;
        }
        this._capturing = null;
    }

    _commitCapture(id, combo) {
        this._cancelCapture();
        const conflicts = this._shortcuts.findConflicts(combo, id);
        if (conflicts.length) {
            this._conflict = { id, combo, conflicts };
            this._render();
            return;
        }
        this._shortcuts.setUserBinding(id, [combo]);
    }

    _resolveConflict(reassign) {
        const conflict = this._conflict;
        this._conflict = null;
        if (!conflict) return;
        if (!reassign) {
            this._render();
            return;
        }
        // Steal the combo: strip it from every conflicting shortcut first.
        for (const otherId of conflict.conflicts) {
            const remaining = (this._shortcuts.getBinding(otherId)?.combos || []).filter(c => c !== conflict.combo);
            this._shortcuts.setUserBinding(otherId, remaining.length ? remaining : null);
        }
        this._shortcuts.setUserBinding(conflict.id, [conflict.combo]);
    }
}
