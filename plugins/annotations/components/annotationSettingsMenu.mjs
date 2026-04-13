const { div, button, input, span, h3, h4, label, select, option, section, header, i } = globalThis.van.tags;

const textarea = globalThis.van.tags("textarea").textarea;
const p = globalThis.van.tags("p").p;
const br = globalThis.van.tags("br").br;

function runChangedHandler(code, node, value) {
    if (typeof code !== "string" || !code.trim()) return;
    try {
        new Function("value", code).call(node, value);
    } catch (error) {
        console.error("Annotation settings option handler failed.", error);
    }
}

function withClasses(baseClasses, extraClasses) {
    return [baseClasses, extraClasses].filter(Boolean).join(" ");
}

function renderHtmlContent(content, fallbackTag = "span") {
    const tags = globalThis.van.tags;
    const Tag = tags[fallbackTag];
    return Tag({ innerHTML: content ?? "" });
}

// Todo API-fy this in core, or use menus plugin to do this dynamically on a single place rather than re-implementing stuff
function renderConvertorOption(opt) {
    const classes = opt.classes || "";

    switch (opt.type) {
    case "textInput":
        return input({
            type: "text",
            class: withClasses("input input-bordered input-sm w-full", classes),
            placeholder: opt.placeholder || "",
            value: opt.default ?? "",
            onchange: function () {
                runChangedHandler(opt.changed || opt.onchange, this, this.value);
            }
        });
    case "checkBox":
        return label({ class: withClasses("label cursor-pointer justify-start gap-3 rounded-lg px-3 py-2", classes) },
            input({
                type: "checkbox",
                class: "checkbox checkbox-sm checkbox-primary",
                checked: opt.default !== false && opt.default !== "false",
                onchange: function () {
                    runChangedHandler(opt.changed || opt.onchange, this, !!this.checked);
                }
            }),
            renderHtmlContent(opt.label || "", "span")
        );
    case "colorInput":
        return input({
            type: "color",
            class: withClasses("input input-bordered input-sm h-10 w-full", classes),
            value: opt.default || "#ffffff",
            placeholder: opt.placeholder || "",
            onchange: function () {
                runChangedHandler(opt.changed || opt.onchange, this, this.value);
            }
        });
    case "numberInput":
        return input({
            type: "number",
            class: withClasses("input input-bordered input-sm w-full", classes),
            placeholder: opt.placeholder || "",
            min: opt.min ?? 0,
            max: opt.max ?? 1,
            step: opt.step ?? 0.1,
            value: opt.default ?? 0,
            onchange: function () {
                const parser = Number.isInteger(opt.step) ? Number.parseInt : Number.parseFloat;
                runChangedHandler(opt.changed || opt.onchange, this, parser(this.value));
            }
        });
    case "select":
        return select({
                class: withClasses("select select-bordered select-sm w-full", classes),
                onchange: function () {
                    runChangedHandler(opt.changed || opt.onchange, this, this.value);
                }
            },
            Object.entries(opt.options || {}).map(([key, value]) => {
                const optionValue = Array.isArray(opt.options) ? value : key;
                const optionLabel = Array.isArray(opt.options) ? value : value;
                return option({ value: optionValue, selected: optionValue === opt.default }, optionLabel);
            })
        );
    case "numberArray":
        return textarea({
            class: withClasses("textarea textarea-bordered textarea-sm w-full", classes),
            rows: 2,
            placeholder: "[1,2,3]",
            onchange: function () {
                try {
                    let value = JSON.parse(this.value);
                    if (!Array.isArray(value)) throw new Error("Cannot parse number array.");
                    value = value.map(Number.parseFloat);
                    this.style.background = "";
                    this.values = value;
                    runChangedHandler(opt.changed || opt.onchange, this, value);
                } catch (error) {
                    console.warn(error);
                    this.style.background = "var(--fallback-er, oklch(var(--er)/0.2))";
                }
            }
        }, JSON.stringify(Array.isArray(opt.default) ? opt.default : new Array(opt.default)));
    case "header":
        return div({ class: withClasses("text-sm font-bold uppercase tracking-wider opacity-60", classes) }, opt.title || "Title");
    case "text":
        return p({ class: withClasses("text-sm opacity-80", classes), innerHTML: opt.content || "" });
    case "button":
        return button({
            class: withClasses("btn btn-sm", classes),
            onclick: function () {
                runChangedHandler(opt.action, this);
            }
        }, opt.title || "");
    case "newline":
        return br();
    default:
        return div({ class: "hidden" });
    }
}

function renderConvertorOptions(convertor) {
    return Object.values(convertor.options || {})
        .filter(opt => opt && !String(opt.type || "").startsWith("_"))
        .map(renderConvertorOption);
}

export const createAnnotationSettingsMenu = (plugin) => {
    // Reactive state for the UI
    const selectedFormat = van.state(plugin.exportOptions.format);
    const selectedScope = van.state(plugin.exportOptions.scope || 'all');
    const importReplace = van.state(plugin.getOption('importReplace', true));

    // Derived state for the current convertor
    const getConvertor = () => OSDAnnotations.Convertor.get(selectedFormat.val);

    return div({ class: "p-4 space-y-6 flex flex-col h-full overflow-y-auto" },
        // --- Header ---
        header({ class: "border-b border-base-300 pb-2" },
            h3({ class: "text-lg font-bold flex items-center gap-2" },
                i({ class: "fa-solid fa-file-export opacity-70" }),
                plugin.t('annotations.export.menuTitle')
            ),
            div({ class: "text-xs opacity-60 italic" },
                plugin.t('annotations.export.forSlide', { slide: plugin.activeTissue })
            )
        ),

        // --- Format Selection ---
        section({ class: "space-y-3" },
            h4({ class: "text-sm font-bold uppercase opacity-50 tracking-wider" },
                plugin.t('annotations.export.fileSection')
            ),
            div({ class: "grid grid-cols-2 gap-2" },
                plugin.exportOptions.availableFormats.map(format => {
                    const conv = OSDAnnotations.Convertor.get(format);
                    return button({
                        class: () => `btn btn-sm ${selectedFormat.val === format ? 'btn-primary' : 'btn-outline'}`,
                        onclick: () => {
                            selectedFormat.val = format;
                            plugin.updateSelectedFormat(format);
                        },
                        title: conv.description || ''
                    }, format);
                })
            ),
            // Dynamic Convertor Options TODO: support instead UI.Components
            () => {
                const convertor = getConvertor();
                return div(
                    { class: "bg-base-200 p-3 rounded-lg text-sm space-y-3" },
                    ...renderConvertorOptions(convertor)
                );
            }
        ),

        // --- IO Controls ---
        section({ class: "card bg-base-100 border border-base-300 shadow-sm" },
            div({ class: "card-body p-4 gap-4" },
                // Scope (All vs Selected)
                div({ class: () => `form-control ${getConvertor().exportsObjects ? '' : 'hidden'}` },
                    label({ class: "label" }, span({ class: "label-text font-semibold" }, plugin.t('annotations.export.scopeLabel'))),
                    div({ class: "join w-full" },
                        ['all', 'selected'].map(s => button({
                            class: () => `join-item btn btn-xs flex-1 ${selectedScope.val === s ? 'btn-active' : ''}`,
                            onclick: () => {
                                selectedScope.val = s;
                                plugin.setExportScope(s);
                            }
                        }, plugin.t(`annotations.export.scopeOptions.${s}`)))
                    )
                ),

                // Replace Checkbox
                label({ class: "label cursor-pointer justify-start gap-3 bg-base-200 rounded-lg px-3" },
                    input({
                        type: "checkbox", class: "checkbox checkbox-sm checkbox-primary",
                        checked: importReplace,
                        onchange: (e) => {
                            importReplace.val = e.target.checked;
                            plugin.setOption('importReplace', e.target.checked);
                        }
                    }),
                    span({ class: "label-text" }, plugin.t('annotations.export.replaceOnImport'))
                ),

                // Action Buttons
                div({ class: "flex flex-col gap-2 pt-2" },
                    div({ class: "flex gap-2" },
                        button({
                            class: "btn btn-primary flex-1",
                            onclick: (e) => e.target.nextElementSibling.click()
                        }, plugin.t('annotations.export.importFileButton', { format: selectedFormat.val })),
                        input({
                            type: 'file', class: "hidden",
                            onchange: (e) => { plugin.importFromFile(e); e.target.value = ''; }
                        })
                    ),
                    div({ class: "grid grid-cols-2 gap-2" },
                        button({
                            class: () => `btn btn-outline btn-sm ${getConvertor().exportsPresets ? '' : 'btn-disabled'}`,
                            onclick: () => plugin.exportToFile(false, true)
                        }, plugin.t('annotations.export.downloadPresets')),
                        button({
                            class: () => `btn btn-outline btn-sm ${getConvertor().exportsObjects ? '' : 'btn-disabled'}`,
                            onclick: () => plugin.exportToFile(true, true)
                        }, plugin.t('annotations.export.downloadAnnotations'))
                    )
                )
            )
        ),

        // --- Comments Section ---
        section({ class: "space-y-3 pt-2" },
            h4({ class: "text-sm font-bold uppercase opacity-50 tracking-wider" }, plugin.t('annotations.comments.title')),
            label({ class: "label cursor-pointer" },
                span({ class: "label-text" }, plugin.t('annotations.comments.enable')),
                input({
                    type: "checkbox", class: "toggle toggle-primary toggle-sm",
                    checked: plugin._commentsEnabled,
                    onchange: (e) => plugin.enableComments(e.target.checked)
                })
            ),
            div({ class: "form-control" },
                label({ class: "label" }, span({ class: "label-text text-xs" }, plugin.t('annotations.comments.rememberState'))),
                select({
                        class: "select select-bordered select-sm",
                        onchange: (e) => plugin.switchCommentsClosedMethod(e.target.value)
                    },
                    ['none', 'global', 'individual'].map(m => option({
                        value: m,
                        selected: plugin._commentsClosedMethod === m
                    }, plugin.t(`annotations.comments.rememberOptions.${m}`)))
                )
            )
        )
    );
};
