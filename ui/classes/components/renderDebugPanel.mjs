// RenderDebugPanel — dev-mode view over `APPLICATION_CONTEXT.renderDebug`
// (src/classes/app/render-debug-controller.ts). Left column lists captured
// render frames (viewport and off-screen), right column shows what that frame
// asked the renderer to draw and what came out of each pass.
//
// The panel owns no capture logic: opening the window activates the controller,
// closing it restores every hook. Renders are rAF-coalesced so a burst of
// frames costs one DOM update.
import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div, span, button, i, input, select, option, table, thead, tbody, tr, th, td, label } = van.tags;

export class RenderDebugPanel extends BaseComponent {
    constructor(options = undefined, ...children) {
        super(options, ...children);
        /** Sequence number of the inspected frame, or null for "latest". */
        this._selected = null;
        this._filter = "";
        this._layerKind = "texture";
        this._renderQueued = false;
        this._listEl = null;
        this._detailEl = null;
        this._toolbarEl = null;
        this._busy = false;

        const debug = this._debug;
        if (debug?.addHandler) {
            debug.addHandler("frame", () => this._queueRender());
            debug.addHandler("sources-changed", () => this._queueRender());
            debug.addHandler("state-changed", () => this._queueRender());
        }
    }

    get _debug() {
        return window.APPLICATION_CONTEXT?.renderDebug;
    }

    create() {
        this._toolbarEl = div({ class: "flex flex-wrap items-center gap-2 border-b border-base-300 px-2 py-2" });
        this._listEl = div({ class: "flex flex-col gap-0.5 overflow-y-auto p-1", style: "min-height:0;" });
        this._detailEl = div({ class: "overflow-y-auto p-2", style: "min-height:0;" });
        this._render();

        return div({ ...this.commonProperties, class: "flex h-full flex-col text-sm", style: "min-height:0;" },
            this._toolbarEl,
            div({ class: "flex flex-1 gap-2 overflow-hidden", style: "min-height:0;" },
                div({ class: "flex w-64 shrink-0 flex-col border-r border-base-300", style: "min-height:0;" },
                    this._listEl),
                div({ class: "flex-1", style: "min-height:0;" }, this._detailEl)
            )
        );
    }

    /** Coalesce capture bursts into one DOM update. */
    _queueRender() {
        if (this._renderQueued) return;
        this._renderQueued = true;
        requestAnimationFrame(() => {
            this._renderQueued = false;
            this._render();
        });
    }

    _render() {
        this._renderToolbar();
        this._renderList();
        this._renderDetail();
    }

    // ── toolbar ──────────────────────────────────────────────────────────────

    _renderToolbar() {
        if (!this._toolbarEl) return;
        const debug = this._debug;
        this._toolbarEl.replaceChildren();
        if (!debug) return;

        const checkbox = (key, titleKey) => label({ class: "flex cursor-pointer items-center gap-1" },
            input({
                type: "checkbox",
                class: "checkbox checkbox-xs",
                checked: !!debug.options[key],
                onchange: (e) => { debug.options[key] = !!e.target.checked; },
            }),
            span({ class: "text-xs" }, $.t(titleKey))
        );

        const sources = debug.sources;
        this._toolbarEl.append(
            button({
                class: `btn btn-xs ${debug.paused ? "btn-primary" : "btn-ghost"}`,
                onclick: () => { debug.paused = !debug.paused; },
            },
                i({ class: `ph-light ${debug.paused ? "ph-play" : "ph-pause"}` }),
                $.t(debug.paused ? "renderDebug.record" : "renderDebug.pause")),
            button({
                class: "btn btn-ghost btn-xs",
                onclick: () => debug.captureNext(),
            }, i({ class: "ph-light ph-camera" }), $.t("renderDebug.captureNext")),
            checkbox("thumbnails", "renderDebug.thumbnails"),
            checkbox("tiles", "renderDebug.tileCoords"),
            label({ class: "flex items-center gap-1" },
                span({ class: "text-xs opacity-70" }, $.t("renderDebug.minInterval")),
                input({
                    type: "number",
                    class: "input input-xs w-16",
                    min: "0",
                    value: String(debug.options.minIntervalMs),
                    onchange: (e) => {
                        debug.options.minIntervalMs = Math.max(0, Number(e.target.value) || 0);
                    },
                })
            ),
            select({
                class: "select select-xs",
                onchange: (e) => { this._filter = e.target.value; this._render(); },
            },
                option({ value: "", selected: this._filter === "" }, $.t("renderDebug.allSources")),
                ...sources.map(s => option({ value: s.id, selected: this._filter === s.id }, s.label))
            ),
            div({ class: "grow" }),
            button({
                class: "btn btn-ghost btn-xs",
                onclick: () => { this._selected = null; debug.clear(); },
            }, i({ class: "ph-light ph-trash" }), $.t("renderDebug.clear")),
            button({
                class: "btn btn-ghost btn-xs",
                onclick: () => debug.exportJson(),
            }, i({ class: "ph-light ph-download-simple" }), $.t("renderDebug.export"))
        );
    }

    // ── frame list ───────────────────────────────────────────────────────────

    _frames() {
        const frames = this._debug?.frames || [];
        return this._filter ? frames.filter(f => f.sourceId === this._filter) : frames;
    }

    _renderList() {
        if (!this._listEl) return;
        this._listEl.replaceChildren();

        const frames = this._frames();
        if (!frames.length) {
            this._listEl.append(div({ class: "p-3 text-center text-xs opacity-60" }, $.t("renderDebug.noFrames")));
            return;
        }

        const selected = this._selectedFrame();
        for (let index = frames.length - 1; index >= 0; index--) {
            const frame = frames[index];
            const isSelected = frame === selected;
            this._listEl.append(div({
                    class: "flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 hover:bg-base-200" +
                        (isSelected ? " bg-base-300" : ""),
                    onclick: () => { this._selected = frame.seq; this._render(); },
                },
                span({ class: "w-10 shrink-0 text-xs opacity-50" }, `#${frame.seq}`),
                span({ class: "truncate text-xs" }, frame.label),
                div({ class: "grow" }),
                frame.error
                    ? span({ class: "badge badge-error badge-xs" }, "!")
                    : span({ class: `badge badge-xs ${frame.mode === "full-draw" ? "badge-ghost" : "badge-info"}` },
                        $.t(frame.mode === "full-draw" ? "renderDebug.fullDraw" : "renderDebug.reuse")),
                span({ class: "w-12 shrink-0 text-right text-xs opacity-60" }, `${frame.ms.toFixed(1)}ms`)
            ));
        }
    }

    _selectedFrame() {
        const frames = this._frames();
        if (!frames.length) return null;
        if (this._selected === null) return frames[frames.length - 1];
        return frames.find(f => f.seq === this._selected) || frames[frames.length - 1];
    }

    // ── detail ───────────────────────────────────────────────────────────────

    _renderDetail() {
        if (!this._detailEl) return;
        this._detailEl.replaceChildren();

        const frame = this._selectedFrame();
        if (!frame) {
            this._detailEl.append(div({ class: "p-4 text-center text-xs opacity-60" }, $.t("renderDebug.selectFrame")));
            return;
        }

        const rows = [
            [$.t("common.Source"), `${frame.label} (${frame.kind})`],
            [$.t("renderDebug.output"), frame.size ? `${frame.size.x} × ${frame.size.y}` : "—"],
            [$.t("renderDebug.precision"), frame.precision || "—"],
            [$.t("renderDebug.sharedContext"), String(!!frame.shared)],
            [$.t("renderDebug.timing"), `${frame.ms.toFixed(2)} ms`],
        ];
        if (frame.view) {
            const b = frame.view.bounds;
            rows.push([$.t("renderDebug.view"),
                `x ${b.x.toFixed(4)} y ${b.y.toFixed(4)} w ${b.width.toFixed(4)} h ${b.height.toFixed(4)}` +
                ` · zoom ${Number(frame.view.zoom).toFixed(3)}` +
                ` · rot ${Number(frame.view.rotationDeg || 0).toFixed(1)}°`]);
        }
        if (frame.firstPassDepths) {
            rows.push(["layers", `color ${frame.firstPassDepths.texture} · stencil ${frame.firstPassDepths.stencil}` +
                (frame.firstPassDepths.borrowed ? " (borrowed)" : "")]);
        }

        this._detailEl.append(
            frame.error
                ? div({ class: "mb-2 rounded bg-error/10 px-2 py-1 text-xs text-error" },
                    `${$.t("renderDebug.renderError")}: ${frame.error}`)
                : null,
            frame.mode === "second-pass-reuse"
                ? div({ class: "mb-2 rounded bg-info/10 px-2 py-1 text-xs" },
                    $.t("renderDebug.reuseNote", { source: frame.viewFrom || "?" }))
                : null,
            this._kvTable(rows),
            this._imagesTable(frame),
            ...this._passSections(frame),
            this._resultSection(frame)
        );
    }

    _kvTable(rows) {
        return table({ class: "mb-3 w-full text-xs" }, tbody(
            ...rows.map(([key, value]) => tr(
                th({ class: "w-40 py-0.5 text-left font-medium opacity-60" }, key),
                td({ class: "py-0.5 font-mono" }, value)
            ))
        ));
    }

    _imagesTable(frame) {
        if (!frame.images?.length) return null;
        return div({ class: "mb-3" },
            div({ class: "mb-1 text-xs font-semibold opacity-70" }, $.t("renderDebug.images")),
            table({ class: "w-full text-xs" },
                thead(tr(
                    th({ class: "text-left" }, "#"),
                    th({ class: "text-left" }, "tileSourceId"),
                    th({ class: "text-right" }, "opacity"),
                    th({ class: "text-right" }, "packs"),
                    th({ class: "text-right" }, "base"),
                    th({ class: "text-right" }, "tiles")
                )),
                tbody(...frame.images.map(image => tr(
                    td(String(image.index)),
                    td({ class: "truncate font-mono" }, image.tileSourceId ?? "—"),
                    td({ class: "text-right" }, image.opacity == null ? "—" : Number(image.opacity).toFixed(2)),
                    td({ class: "text-right" }, String(image.packCount)),
                    td({ class: "text-right" }, String(image.baseLayer)),
                    td({ class: "text-right" }, image.countOnly ? "—" : String(image.tilesToDraw ?? "—"))
                )))
            )
        );
    }

    _passSections(frame) {
        const out = [];
        const first = frame.passes.find(p => p.pass === "first");
        const second = frame.passes.find(p => p.pass === "second");

        out.push(first
            ? div({ class: "mb-3" },
                div({ class: "mb-1 text-xs font-semibold opacity-70" },
                    `${$.t("renderDebug.firstPass")} · ${first.ms.toFixed(2)} ms`),
                table({ class: "w-full text-xs" },
                    thead(tr(
                        th({ class: "text-left" }, "layer"),
                        th({ class: "text-right" }, "stencil"),
                        th({ class: "text-right" }, "pack"),
                        th({ class: "text-right" }, "tiles"),
                        th({ class: "text-right" }, "vectors"),
                        th({ class: "text-right" }, "diag"),
                        th({ class: "text-right" }, "poly")
                    )),
                    tbody(...first.packages.map(p => tr(
                        td(String(p.dataIndex)),
                        td({ class: "text-right" }, String(p.stencilIndex)),
                        td({ class: "text-right" }, String(p.packIndex)),
                        td({ class: "text-right" }, String(p.tiles)),
                        td({ class: "text-right" }, String(p.vectors)),
                        td({ class: "text-right" }, String(p.diagnostics)),
                        td({ class: "text-right" }, String(p.polygons))
                    )))
                ),
                this._tileKeys(first))
            : div({ class: "mb-3 text-xs opacity-60" },
                $.t("renderDebug.noFirstPass", { source: frame.viewFrom || "?" })));

        if (second) {
            out.push(div({ class: "mb-3" },
                div({ class: "mb-1 text-xs font-semibold opacity-70" },
                    `${$.t("renderDebug.secondPass")} · ${second.ms.toFixed(2)} ms`),
                table({ class: "w-full text-xs" },
                    thead(tr(
                        th({ class: "text-left" }, "shader"),
                        th({ class: "text-left" }, "type"),
                        th({ class: "text-right" }, "opacity"),
                        th({ class: "text-right" }, "pixelSize"),
                        th({ class: "text-right" }, "zoom")
                    )),
                    tbody(...second.packages.map(p => tr(
                        td({ class: "font-mono" + (p.visible ? "" : " opacity-40") }, p.id ?? "—"),
                        td(p.error ? span({ class: "text-error" }, p.type ?? "?") : (p.type ?? "—")),
                        td({ class: "text-right" }, Number(p.opacity ?? 0).toFixed(2)),
                        td({ class: "text-right" }, Number(p.pixelSize ?? 0).toFixed(4)),
                        td({ class: "text-right" }, Number(p.zoom ?? 0).toFixed(3))
                    )))
                ),
                second.out?.rendered === false
                    ? div({ class: "text-xs opacity-60" }, `not rendered: ${second.out.reason}`)
                    : null
            ));
        }
        return out;
    }

    _tileKeys(pass) {
        const withKeys = pass.packages.filter(p => p.tileKeys?.length);
        if (!withKeys.length) return null;
        return div({ class: "mt-1 max-h-32 overflow-y-auto font-mono text-[10px] opacity-70" },
            ...withKeys.map(p => div(`L${p.dataIndex}: ` +
                p.tileKeys.map(k => `${k.l}/${k.x},${k.y}`).join("  ")))
        );
    }

    _resultSection(frame) {
        const debug = this._debug;
        const children = [
            div({ class: "mb-1 flex items-center gap-2" },
                span({ class: "text-xs font-semibold opacity-70" }, $.t("renderDebug.result")),
                div({ class: "grow" }),
                select({
                    class: "select select-xs",
                    onchange: (e) => { this._layerKind = e.target.value; },
                },
                    option({ value: "texture", selected: this._layerKind === "texture" }, $.t("renderDebug.layerColor")),
                    option({ value: "stencil", selected: this._layerKind === "stencil" }, $.t("renderDebug.layerStencil"))
                ),
                button({
                    class: "btn btn-ghost btn-xs",
                    disabled: this._busy,
                    onclick: async () => {
                        this._busy = true;
                        this._render();
                        try {
                            await debug.grabFirstPassLayers(frame, this._layerKind);
                        } catch (e) {
                            console.error(e);
                        } finally {
                            this._busy = false;
                            this._render();
                        }
                    },
                }, i({ class: "ph-light ph-squares-four" }),
                    $.t(this._busy ? "renderDebug.grabbing" : "renderDebug.grabLayers"))
            )
        ];

        if (frame.thumb) {
            children.push(div({ class: "mb-2 inline-block rounded border border-base-300 p-1" }, frame.thumb));
        }

        if (frame.fpGrid?.length) {
            children.push(div({ class: "flex flex-wrap gap-2" },
                ...frame.fpGrid.map(layer => div({ class: "flex flex-col items-center" },
                    this._scaledCopy(layer.canvas),
                    span({ class: "text-[10px] opacity-60" }, `${layer.kind} L${layer.layerIndex}`)
                ))
            ));
        } else if (frame.fpGrid) {
            children.push(div({ class: "text-xs opacity-60" }, $.t("renderDebug.noLayers")));
        }

        return div({ class: "mb-3" }, ...children);
    }

    /** Layer readbacks are full-size; show them small without holding two copies. */
    _scaledCopy(source) {
        const max = 128;
        const scale = Math.min(1, max / Math.max(source.width || 1, source.height || 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round((source.width || 1) * scale));
        canvas.height = Math.max(1, Math.round((source.height || 1) * scale));
        canvas.className = "rounded border border-base-300";
        canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
        return canvas;
    }
}
