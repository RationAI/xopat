const { div, span, input, select, option, button, i } = globalThis.van.tags;

const ROW_BASE = "rounded-md border border-base-300/70 bg-base-100 hover:border-primary/50 transition-all";
const ROW_SELECTED = "rounded-md border border-primary bg-base-100 ring-1 ring-primary/30";

function iconNode(icon, extraClass = "", style = "") {
    const isPh = String(icon ?? '').trim().startsWith('ph-');
    const cls = isPh ? `ph-light ${icon} ${extraClass}` : `fa-auto ${icon} ${extraClass}`;
    return i({ class: cls.trim(), style });
}

/**
 * One annotation preset rendered as a collapsible row. Collapsed state is
 * a single line (color • title • factory icon • delete). Selecting the row
 * expands an editor that exposes the factory select, metadata fields, and
 * "add field" affordance.
 *
 * View only: domain logic flows through `callbacks` so the card stays
 * decoupled from the plugin.
 */
export class PresetCard extends UI.BaseComponent {
    constructor({ preset, isSelected, enableModify, allowedFactories, t, callbacks }) {
        super({ extraClasses: {} });
        this.preset = preset;
        this.enableModify = !!enableModify;
        this.allowedFactories = allowedFactories || [];
        this.t = typeof t === "function" ? t : (k) => k;
        this.cb = callbacks || {};
        this._expanded = !!isSelected;

        this.classMap = {
            base: isSelected ? ROW_SELECTED : ROW_BASE,
        };
    }

    setSelected(on) {
        this.toggleClass("base", on ? ROW_SELECTED : ROW_BASE, true);
        this.setExpanded(on);
    }

    setExpanded(on) {
        this._expanded = !!on;
        this._editor?.classList.toggle("hidden", !this._expanded);
        this._chevron?.classList.toggle("rotate-90", this._expanded);
    }

    create() {
        if (this.root) return this.root;

        const row = div({
            ...this.commonProperties,
            'data-preset-id': this.preset.presetID,
        });

        row.append(this._renderHead(), this._renderEditor());
        this.root = row;
        return row;
    }

    _renderHead() {
        const preset = this.preset;

        const colorChip = input({
            class: "p-0 border border-base-300 bg-transparent cursor-pointer w-5 h-5 rounded overflow-hidden shrink-0",
            type: "color",
            value: preset.color,
            disabled: !this.enableModify,
            title: this.t("annotations.presets.color") || "Color",
            onclick: (e) => e.stopPropagation(),
            onchange: (e) => this.cb.onColorChange?.(preset.presetID, e.target.value),
        });

        const titleNode = this.enableModify
            ? input({
                class: "input input-xs bg-transparent border-none focus:bg-base-200 hover:bg-base-200/60 transition-colors flex-1 min-w-0 px-2 font-medium",
                placeholder: this.t("annotations.presets.unnamed") || "Unnamed Class",
                value: preset.meta.category?.value || "",
                onclick: (e) => e.stopPropagation(),
                onchange: (e) => this.cb.onMetaChange?.(preset.presetID, "category", e.target.value),
            })
            : span({ class: "text-sm font-medium px-2 truncate flex-1" },
                preset.meta.category?.value || (this.t("annotations.presets.unnamed") || "Unnamed Class"));

        const factoryIcon = iconNode(
            preset.objectFactory.getIcon?.() || "ph-shapes",
            "text-xs opacity-70 shrink-0",
            `color: ${preset.color};`
        );

        const metaCount = Object.keys(preset.meta).filter(k => k !== "category").length;
        const metaBadge = metaCount > 0
            ? span({ class: "badge badge-ghost badge-xs shrink-0", title: `${metaCount} fields` }, String(metaCount))
            : null;

        const deleteBtn = this.enableModify ? button({
            class: "btn btn-ghost btn-xs btn-square text-error opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0",
            title: this.t("annotations.presets.delete") || "Delete class",
            onclick: (e) => {
                e.stopPropagation();
                this.cb.onDelete?.(preset.presetID, this);
            },
        }, iconNode("ph-trash", "text-[10px]")) : null;

        this._chevron = iconNode(
            "ph-caret-right",
            `text-[10px] opacity-50 shrink-0 transition-transform ${this._expanded ? "rotate-90" : ""}`
        );

        return div({
            class: "group flex items-center gap-2 px-2 py-1.5 cursor-pointer",
            onclick: () => this.cb.onSelect?.(this.preset.presetID, this),
        }, this._chevron, colorChip, titleNode, factoryIcon, metaBadge, deleteBtn);
    }

    _renderEditor() {
        const preset = this.preset;

        const factorySelect = select({
            class: "select select-bordered select-xs flex-1 font-medium",
            disabled: !this.enableModify,
            onclick: (e) => e.stopPropagation(),
            onchange: (e) => this.cb.onFactoryChange?.(preset.presetID, e.target.value),
        }, ...this.allowedFactories.map((factoryId) => {
            const factory = this.cb.getFactory?.(factoryId);
            return factory ? option({
                value: factory.factoryID,
                selected: factory.factoryID === preset.objectFactory.factoryID,
            }, factory.title()) : null;
        }));

        const metaList = div({ class: "flex flex-col gap-1" });
        const otherMetaEntries = Object.entries(preset.meta).filter(([key]) => key !== "category");
        for (const [key, meta] of otherMetaEntries) {
            metaList.appendChild(this._metaRow(key, meta));
        }
        this._metaList = metaList;

        const addFieldRow = this._renderAddFieldRow();
        this._addFieldRow = addFieldRow;

        const editor = div({
            class: `flex flex-col gap-2 px-2 pb-2 pt-1 border-t border-base-200 ${this._expanded ? "" : "hidden"}`,
            onclick: (e) => e.stopPropagation(),
        },
            div({ class: "flex items-center gap-2" },
                span({ class: "text-xs opacity-60 shrink-0 w-12" }, this.t("annotations.presets.typeLabel") || "Type"),
                factorySelect,
            ),
            otherMetaEntries.length > 0 ? div({ class: "flex items-start gap-2" },
                span({ class: "text-xs opacity-60 shrink-0 w-12 pt-1" }, this.t("annotations.presets.fieldsLabel") || "Fields"),
                metaList,
            ) : null,
            this.enableModify ? addFieldRow : null,
        );
        this._editor = editor;
        return editor;
    }

    _metaRow(key, meta) {
        const wrap = div({ class: "relative group/meta flex-1" });
        wrap.append(this._metaInput(key, meta, true, "input-xs w-full pr-7"));
        return wrap;
    }

    _metaInput(key, meta, allowDelete, classes) {
        const wrap = div({ class: "relative group/meta flex-1" });
        const inputNode = input({
            class: `input input-bordered focus:input-primary transition-all ${classes}`.trim(),
            placeholder: meta.name || (this.t("annotations.presets.valuePlaceholder") || "Value..."),
            type: "text",
            value: meta.value,
            disabled: !this.enableModify,
            onclick: (e) => e.stopPropagation(),
            onchange: (e) => this.cb.onMetaChange?.(this.preset.presetID, key, e.target.value),
        });
        wrap.appendChild(inputNode);

        if (allowDelete && this.enableModify) {
            wrap.appendChild(button({
                class: "btn btn-ghost btn-xs btn-square absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/meta:opacity-100 text-error",
                onclick: (e) => {
                    e.stopPropagation();
                    this.cb.onMetaDelete?.(this.preset.presetID, key, wrap);
                },
            }, iconNode("ph-trash", "text-[10px]")));
        }
        return wrap;
    }

    _renderAddFieldRow() {
        const editor = div({ class: "join w-full hidden" });
        const fieldInput = input({
            class: "input input-xs input-bordered join-item flex-1",
            placeholder: this.t("annotations.presets.newFieldPlaceholder") || "Field name...",
            onclick: (e) => e.stopPropagation(),
            onkeydown: (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                } else if (e.key === "Escape") {
                    close();
                }
            },
        });
        const submitBtn = button({
            class: "btn btn-xs btn-primary join-item",
            onclick: (e) => {
                e.stopPropagation();
                commit();
            },
        }, this.t("annotations.presets.add") || "Add");

        editor.append(fieldInput, submitBtn);

        const open = () => {
            editor.classList.remove("hidden");
            toggle.classList.add("hidden");
            fieldInput.focus();
        };
        const close = () => {
            fieldInput.value = "";
            editor.classList.add("hidden");
            toggle.classList.remove("hidden");
        };
        const commit = () => {
            const name = fieldInput.value?.trim();
            if (!name) return;
            const inserted = this.cb.onMetaAdd?.(this.preset.presetID, name);
            if (inserted instanceof Node) {
                this._metaList?.appendChild(inserted);
            }
            close();
        };

        const toggle = button({
            class: "btn btn-ghost btn-xs justify-start gap-1 normal-case opacity-60 hover:opacity-100 transition-opacity self-start ml-14",
            onclick: (e) => {
                e.stopPropagation();
                open();
            },
        }, iconNode("ph-plus", "text-[10px]"), this.t("annotations.presets.addField") || "Add field");

        return div({ class: "flex flex-col" }, toggle, editor);
    }
}
