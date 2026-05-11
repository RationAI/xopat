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

// ----- Multi-viewer helpers -----

function _resolveViewerLabel(viewer, plugin) {
    // Prefer the slide title from the viewer's IO context (clean filename
    // without the uniqueId suffix), fall back to the uniqueId, then to a
    // generic placeholder.
    const ioCtx = (typeof UTILITIES !== 'undefined' && typeof UTILITIES.getViewerIOContext === 'function')
        ? UTILITIES.getViewerIOContext(viewer)
        : undefined;
    const candidates = [
        ioCtx?.title,
        ioCtx?.fileName,
        ioCtx?.label,
        viewer?.uniqueId,
    ];
    for (const c of candidates) {
        if (c && String(c).trim()) return String(c);
    }
    return plugin?.t?.('annotations.viewerMenu.title') || 'Viewer';
}

function _listOpenViewers() {
    const vm = (typeof window !== 'undefined') ? window.VIEWER_MANAGER : null;
    const all = (vm && Array.isArray(vm.viewers)) ? vm.viewers.filter(Boolean) : [];
    return all;
}

function _activeViewerId() {
    const vm = (typeof window !== 'undefined') ? window.VIEWER_MANAGER : null;
    const active = vm?.active || (typeof window !== 'undefined' ? window.VIEWER : null);
    return active ? String(active.uniqueId) : null;
}

export const createAnnotationSettingsMenu = (plugin) => {
    // Reactive state for the UI
    const selectedFormat = van.state(plugin.exportOptions.format);
    const selectedScope = van.state(plugin.exportOptions.scope || 'all');
    const importReplace = van.state(plugin.getOption('importReplace', true));

    // Multi-viewer state. `viewersTick` bumps whenever the open-viewer list
    // or the active-viewer changes; reactive renderers below depend on it
    // to recompute. `exportViewerId` / `importViewerId` track the user's
    // selection (or default to active when null).
    const viewersTick = van.state(0);
    const exportViewerId = van.state(null); // null => follow active viewer
    const importViewerId = van.state(null);

    const _bumpViewers = () => { viewersTick.val = viewersTick.val + 1; };
    const _onViewerCreate = () => _bumpViewers();
    const _onViewerDestroy = (e) => {
        const goneId = String(e?.uniqueId || '');
        if (goneId && exportViewerId.val === goneId) exportViewerId.val = null;
        if (goneId && importViewerId.val === goneId) importViewerId.val = null;
        _bumpViewers();
    };
    const _onActiveViewerChanged = () => _bumpViewers();

    const vm = (typeof window !== 'undefined') ? window.VIEWER_MANAGER : null;
    if (vm?.addHandler) {
        vm.addHandler('viewer-create', _onViewerCreate);
        vm.addHandler('viewer-destroy', _onViewerDestroy);
        vm.addHandler('active-viewer-changed', _onActiveViewerChanged);
    }

    // Derived state for the current convertor
    const getConvertor = () => OSDAnnotations.Convertor.get(selectedFormat.val);

    // Resolve the actual viewer to act on for a given selection state. When
    // the user hasn't picked anything (null), we follow the focused viewer.
    const resolveActionViewerId = (stateRef) => {
        // Touch viewersTick so this re-evaluates when the active viewer changes.
        viewersTick.val; // eslint-disable-line no-unused-expressions
        if (stateRef.val) return stateRef.val;
        return _activeViewerId();
    };

    // Compact "<label> <control>" row used throughout the panel so every
    // setting reads as a single horizontal line and the panel stays dense.
    const fieldRow = (labelText, ...controls) =>
        div({ class: "flex items-center gap-2 text-sm" },
            span({ class: "text-xs opacity-70 shrink-0", style: "min-width: 70px;" }, labelText),
            ...controls
        );

    // Reactive viewer-select. Always rendered so the user can see and pick
    // the IO target even with a single open viewer (makes the multi-viewer
    // flow discoverable and the action target explicit).
    const renderViewerField = (labelText, stateRef) => () => {
        viewersTick.val; // re-render trigger
        const viewers = _listOpenViewers();
        if (!viewers.length) return null;

        const activeId = _activeViewerId();
        const focusedMark = ' ' + plugin.t('annotations.export.focusedMarker');

        return fieldRow(labelText,
            select({
                    class: "select select-bordered select-xs flex-1 min-w-0",
                    onchange: (e) => { stateRef.val = e.target.value || null; }
                },
                viewers.map(v => {
                    const id = String(v.uniqueId);
                    const name = _resolveViewerLabel(v, plugin);
                    const isActive = id === activeId;
                    const isSelected = (stateRef.val ? id === stateRef.val : isActive);
                    return option(
                        { value: id, selected: isSelected },
                        isActive ? `${name}${focusedMark}` : name
                    );
                })
            )
        );
    };

    // Section divider with a small uppercase tag and an icon.
    const sectionLabel = (icon, text) =>
        div({ class: "flex items-center gap-2 mt-3 mb-1" },
            i({ class: `fa-solid ${icon} text-xs opacity-50` }),
            span({ class: "text-[11px] font-bold uppercase tracking-wider opacity-60" }, text),
            div({ class: "flex-1 h-px bg-base-300" })
        );

    const root = div({ class: "p-3 flex flex-col h-full overflow-y-auto text-sm" },
        // --- Header (compact, no per-slide subtitle) ---
        header({ class: "flex items-center gap-2 mb-2" },
            i({ class: "fa-solid fa-file-export opacity-70" }),
            h3({ class: "text-base font-bold" }, plugin.t('annotations.export.menuTitle'))
        ),

        // --- File format (shared by Download and Upload) ---
        // Single-row dropdown — much tighter than the previous 2x2 chip grid
        // and scales gracefully if more formats are added.
        fieldRow(plugin.t('annotations.export.formatSection'),
            select({
                    class: "select select-bordered select-xs flex-1 min-w-0",
                    onchange: (e) => {
                        selectedFormat.val = e.target.value;
                        plugin.updateSelectedFormat(e.target.value);
                    }
                },
                plugin.exportOptions.availableFormats.map(format => {
                    const conv = OSDAnnotations.Convertor.get(format);
                    return option({
                        value: format,
                        selected: selectedFormat.val === format,
                        title: conv?.description || ''
                    }, format);
                })
            )
        ),
        // Format-specific options (only render when the convertor exposes any).
        () => {
            const convertor = getConvertor();
            const opts = renderConvertorOptions(convertor);
            if (!opts.length) return div({ class: "hidden" });
            return div({ class: "bg-base-200/60 p-2 mt-1 rounded text-xs space-y-2" }, ...opts);
        },

        // --- Download ---
        sectionLabel("fa-download", plugin.t('annotations.export.exportSection')),
        // Scope (All / Selected) — only when the convertor handles annotation objects.
        () => {
            if (!getConvertor().exportsObjects) return null;
            return fieldRow(plugin.t('annotations.export.scopeLabel'),
                div({ class: "join flex-1" },
                    ['all', 'selected'].map(s => button({
                        class: () => `join-item btn btn-xs flex-1 ${selectedScope.val === s ? 'btn-active' : ''}`,
                        onclick: () => {
                            selectedScope.val = s;
                            plugin.setExportScope(s);
                        }
                    }, plugin.t(`annotations.export.scopeOptions.${s}`)))
                )
            );
        },
        renderViewerField(plugin.t('annotations.export.fromSlide'), exportViewerId),
        div({ class: "grid grid-cols-2 gap-2 mt-2" },
            button({
                class: () => `btn btn-primary btn-sm ${getConvertor().exportsObjects ? '' : 'btn-disabled'}`,
                onclick: () => plugin.exportToFile(true, true, resolveActionViewerId(exportViewerId))
            }, plugin.t('annotations.export.downloadAnnotations')),
            button({
                class: () => `btn btn-outline btn-sm ${getConvertor().exportsPresets ? '' : 'btn-disabled'}`,
                onclick: () => plugin.exportToFile(false, true, resolveActionViewerId(exportViewerId))
            }, plugin.t('annotations.export.downloadPresets'))
        ),

        // --- Upload ---
        sectionLabel("fa-upload", plugin.t('annotations.export.importSection')),
        renderViewerField(plugin.t('annotations.export.intoSlide'), importViewerId),
        label({ class: "flex items-center gap-2 cursor-pointer text-xs opacity-80 mt-1" },
            input({
                type: "checkbox", class: "checkbox checkbox-xs checkbox-primary",
                checked: importReplace,
                onchange: (e) => {
                    importReplace.val = e.target.checked;
                    plugin.setOption('importReplace', e.target.checked);
                }
            }),
            span(plugin.t('annotations.export.replaceOnImport'))
        ),
        div({ class: "mt-2" },
            button({
                class: "btn btn-primary btn-sm w-full",
                onclick: (e) => e.target.nextElementSibling.click()
            }, plugin.t('annotations.export.chooseFileButton')),
            input({
                type: 'file', class: "hidden",
                onchange: (e) => {
                    plugin.importFromFile(e, resolveActionViewerId(importViewerId));
                    e.target.value = '';
                }
            })
        ),

        // --- Comments (separate concern: not file IO) ---
        sectionLabel("fa-comment", plugin.t('annotations.comments.title')),
        label({ class: "flex items-center justify-between cursor-pointer text-sm" },
            span(plugin.t('annotations.comments.enable')),
            input({
                type: "checkbox", class: "toggle toggle-primary toggle-sm",
                checked: plugin._commentsEnabled,
                onchange: (e) => plugin.enableComments(e.target.checked)
            })
        ),
        fieldRow(plugin.t('annotations.comments.rememberState'),
            select({
                    class: "select select-bordered select-xs flex-1 min-w-0",
                    onchange: (e) => plugin.switchCommentsClosedMethod(e.target.value)
                },
                ['none', 'global', 'individual'].map(m => option({
                    value: m,
                    selected: plugin._commentsClosedMethod === m
                }, plugin.t(`annotations.comments.rememberOptions.${m}`)))
            )
        )
    );

    return root;
};
