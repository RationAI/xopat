const { div, button, input, span, label, select, option } = globalThis.van.tags;

const textarea = globalThis.van.tags("textarea").textarea;
const p = globalThis.van.tags("p").p;
const br = globalThis.van.tags("br").br;

function runChangedHandler(handler, node, value) {
    // Convertor option handlers are function references (see
    // OSDAnnotations.Convertor.register). We deliberately do NOT compile
    // strings — a string handler is ignored rather than eval'd (AGENTS.md §7).
    if (typeof handler !== "function") {
        if (typeof handler === "string") {
            console.warn("Ignoring string convertor-option handler; provide a function reference instead.");
        }
        return;
    }
    try {
        handler.call(node, value);
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
    // Convertor-supplied label/content is rendered through the core builder,
    // which sanitizes markup (when the sanitizer is loaded) or falls back to
    // plain text — never a raw innerHTML injection.
    return Tag(UI.BaseComponent.toNode(String(content ?? "")));
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
        return p({ class: withClasses("text-sm opacity-80", classes) },
            UI.BaseComponent.toNode(String(opt.content || "")));
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

    // Mode toggle for the merged IO card. Persisted only in-session — the
    // user typically opens this panel to do one of import/export, not both.
    const ioMode = van.state('export');

    // Derived state for the current convertor. Returns null in 'auto' mode
    // (no concrete convertor selected).
    const getConvertor = () => {
        if (selectedFormat.val === 'auto') return null;
        try { return OSDAnnotations.Convertor.get(selectedFormat.val); }
        catch (_e) { return null; }
    };

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

    const fs = window.USER_INTERFACE?.FullscreenMenu;

    // --- Export panel (mode-specific body of the merged IO card) ---
    const renderExportPanel = () => div({ class: "space-y-2" },
        // Scope (All / Selected) — only when the convertor handles annotation objects.
        () => {
            const conv = getConvertor();
            if (!conv?.exportsObjects) return null;
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
        // Inline lossy-format hint so the user can switch formats before
        // clicking export. Mirrors the post-export warning toast.
        () => {
            const conv = getConvertor();
            if (!conv?.lossy) return null;
            const reason = conv.lossyReason
                || plugin.t('annotations.export.lossyDefaultHint');
            return div({ class: "alert alert-warning py-1 px-2 text-xs flex gap-2 items-start" },
                span({ class: "ph-light ph-warning text-base shrink-0" }),
                span(reason)
            );
        },
        () => {
            const conv = getConvertor();
            // Auto cannot export — needs a concrete format.
            if (!conv) {
                return div({ class: "text-xs opacity-70 italic mt-1" },
                    plugin.t('annotations.export.autoExportHint'));
            }
            return div({ class: "grid grid-cols-2 gap-2 mt-1" },
                button({
                    class: () => `btn btn-primary btn-sm ${conv.exportsObjects ? '' : 'btn-disabled'}`,
                    onclick: () => plugin.exportToFile(true, true, resolveActionViewerId(exportViewerId))
                }, plugin.t('annotations.export.downloadAnnotations')),
                button({
                    class: () => `btn btn-outline btn-sm ${conv.exportsPresets ? '' : 'btn-disabled'}`,
                    onclick: () => plugin.exportToFile(false, true, resolveActionViewerId(exportViewerId))
                }, plugin.t('annotations.export.downloadPresets'))
            );
        }
    );

    // --- Import panel (mode-specific body of the merged IO card) ---
    const renderImportPanel = () => div({ class: "space-y-2" },
        renderViewerField(plugin.t('annotations.export.intoSlide'), importViewerId),
        label({ class: "flex items-center gap-2 cursor-pointer text-xs opacity-80" },
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
        div({ class: "mt-1" },
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
        )
    );

    // --- Display: always-on measurement labels (hidden when the deployment
    // disables the feature with measurementLabelMaxCount = 0) ---
    const displayCard = plugin.context.measurementLabelMaxCount > 0
        ? fs.card(plugin.t('annotations.display.title'),
            label({ class: "flex items-center justify-between cursor-pointer text-sm" },
                span(plugin.t('annotations.display.measurementLabels')),
                input({
                    type: "checkbox", class: "toggle toggle-primary toggle-sm",
                    checked: !!plugin.context.getMeasurementLabelsVisible(),
                    onchange: (e) => {
                        plugin.setOption('showMeasurementLabels', e.target.checked);
                        plugin.context.setMeasurementLabelsVisible(e.target.checked);
                    }
                })
            ),
            p({ class: "text-xs opacity-60" },
                plugin.t('annotations.display.measurementLabelsHint',
                    { count: plugin.context.measurementLabelMaxCount }))
        )
        : null;

    // --- Merged File IO card: format selection + import/export tabs ---
    const ioCard =
        fs.card(plugin.t('annotations.export.ioSection'),
            // Mode tabs (Import / Export) — same DaisyUI join pattern as scope.
            div({ class: "join w-full mb-2" },
                ['export', 'import'].map(m => button({
                    class: () => `join-item btn btn-sm flex-1 ${ioMode.val === m ? 'btn-active' : ''}`,
                    onclick: () => { ioMode.val = m; }
                }, plugin.t(`annotations.export.modeTabs.${m}`)))
            ),

            // Format dropdown — shared by import and export.
            fieldRow(plugin.t('annotations.export.formatLabel'),
                select({
                        class: "select select-bordered select-xs flex-1 min-w-0",
                        onchange: (e) => {
                            selectedFormat.val = e.target.value;
                            plugin.updateSelectedFormat(e.target.value);
                        }
                    },
                    // Auto detect — sentinel, only useful for import (export is disabled in auto).
                    option({
                        value: 'auto',
                        selected: selectedFormat.val === 'auto',
                        title: plugin.t('annotations.export.autoFormatHint')
                    }, plugin.t('annotations.export.autoFormat')),
                    plugin.exportOptions.availableFormats.map(format => {
                        let conv;
                        try { conv = OSDAnnotations.Convertor.get(format); } catch (_e) { conv = null; }
                        return option({
                            value: format,
                            selected: selectedFormat.val === format,
                            title: conv?.description || ''
                        }, format);
                    })
                )
            ),

            // Format-specific options (only when a concrete format is selected
            // and the convertor exposes any).
            () => {
                const convertor = getConvertor();
                if (!convertor) return div({ class: "hidden" });
                const opts = renderConvertorOptions(convertor);
                if (!opts.length) return div({ class: "hidden" });
                return div({ class: "bg-base-200/60 p-2 mt-1 rounded text-xs space-y-2" }, ...opts);
            },

            // Mode-specific body (Import vs Export panels).
            div({ class: "mt-2 pt-2 border-t border-base-300/60" },
                () => ioMode.val === 'import' ? renderImportPanel() : renderExportPanel()
            )
        );

    // --- Comments (separate concern: not file IO) ---
    const commentsCard =
        fs.card(plugin.t('annotations.comments.title'),
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

    // --- Point snapping ---
    const snappingCard =
        fs.card('Point snapping',
            label({ class: "flex items-center justify-between cursor-pointer text-sm" },
                span('Snap clicks to nearby vertices'),
                input({
                    type: "checkbox", class: "toggle toggle-primary toggle-sm",
                    checked: plugin.context.getSnap().enabled,
                    onchange: (e) => plugin.context.setSnap({ enabled: e.target.checked })
                })
            ),
            fieldRow('Snap radius (screen px)',
                input({
                    type: "number",
                    class: "input input-bordered input-xs flex-1 min-w-0",
                    min: 2, max: 64, step: 1,
                    value: plugin.context.getSnap().radiusPx,
                    onchange: (e) => plugin.context.setSnap({ radiusPx: Number(e.target.value) })
                })
            ),
            p({ class: "text-xs opacity-60" },
                'Measured in screen pixels — the same visual distance at any zoom level. Image-pixel radius scales automatically.')
        );

    // Two explicit columns so the short cards stack together and fill the
    // height beside the tall File IO card, rather than each short card being
    // stretched by the layout grid's row alignment (which left dead space).
    return fs.layout(
        plugin.t('annotations.export.menuTitle'),
        div({ class: "flex flex-col gap-4" }, ioCard),
        div({ class: "flex flex-col gap-4" }, commentsCard, displayCard, snappingCard)
    );
};
