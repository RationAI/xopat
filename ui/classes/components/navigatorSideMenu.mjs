import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import {Button} from "../elements/buttons.mjs";
import {Checkbox} from "../elements/checkbox.mjs";
import {Join} from "../elements/join.mjs";
import {PhIcon} from "../elements/ph-icon.mjs";
import {Div} from "../elements/div.mjs";

const { div, input, span } = van.tags;

/**
 * ShaderMenu (DaisyUI)
 * Props:
 *  - shaders: Array<{ value:string, label:string }>
 *  - selectedVisualization?: string
 *  - opacity?: number   // 0..1
 *  - onShaderChange?(value)
 *  - onOpacityChange?(value)
 *  - onCacheSnapshotByName?()
 *  - onCacheSnapshotByOrder?()
 *
 * Keeps legacy element IDs:
 *   panel-images,
 *   cache-snapshot, global-opacity
 */
export class NavigatorSideMenu extends BaseComponent {
    /** Upper bound = the historical fixed size; the panel never grows past it. */
    static MAX_WIDTH = 360;
    static MAX_HEIGHT = 300;
    /** Lower bound: below this the overview is unreadable, phone included. */
    static MIN_WIDTH = 175;
    static MIN_HEIGHT = 146;
    /**
     * Share of the viewer cell the navigator may occupy. Deliberately below a
     * quarter: at a laptop's ~1200px the overview is a reference, not a second
     * viewport, and the cap is only reached on genuinely large displays.
     */
    static WIDTH_RATIO = 0.18;
    static HEIGHT_RATIO = 0.3;

    constructor(id, navigatorId) {
        super();
        this.id = id;
        this.navigatorId = navigatorId;
    }

    /**
     * @param title
     * @param {boolean} isError
     */
    setTitle(title, isError) {
        // todo ugly
        const domNode = document.getElementById(this.id + "-title");
        domNode.textContent = title;
        domNode.title = title;
        // todo style error-container using tailwind?
        if (isError) {
            this.title.setClass("err", "error-container");
        } else {
            this.title.setClass("err", undefined);
        }
    }

    create() {
        this.title = new Div({
            id: this.id + "-title",
            class: "truncate text-sm cursor-pointer",
            extraProperties: {
                title: $.t("main.bar.copy"), // tooltip
                style: "flex-grow:1; box-sizing:border-box; vertical-align:middle;"
            },
            onClick: function () {
                // inside this handler, `this` is the DOM node for the title
                UTILITIES.copyToClipboard(this.textContent);
            }
        });

        this.visibility = new Checkbox({
            id: this.id + "-visibility",
            label: "",
            checked: true,
            onchange: function () {
                VIEWER.world.getItemAt(0).setOpacity(this.checked ? 1 : 0);
            },
        });

        this.copy = new Button({
            id: this.id + "-copy",
            size: Button.SIZE.SMALL,
            onClick: () => {
                const el = document.getElementById(this.id + "-title");
                if (el) UTILITIES.copyToClipboard(el.textContent);
            },
            extraProperties: {
                title: $.t("main.bar.copy"),
                style: "width:30px;"
            },
        }, new PhIcon({ name: "ph-copy" }));


        const header = new Join({
            style: Join.STYLE.HORIZONTAL,
            extraClasses: {
                width: "w-full",
                padding: "px-2 py-0",
                bg: "bg-base-200/90",
                border: "border-b border-base-300",
                items: "items-center",
                gap: "gap-2"
            }
        }, this.visibility, this.title, this.copy);

        // No fixed width here: the panel is sized by `setSize()` against the
        // owning viewer cell, so a small screen / dense grid gets a small
        // navigator instead of a 360px square covering the tissue.
        this._navHost = div({ id: this.navigatorId });
        this._body = div(
            { class: "flex flex-col" },
            this._navHost,
            this._createDepthRow()
        );
        this._root = div(
            { class: "flex flex-col" },
            header.create(),
            this._body
        );
        this.setSize(this._lastCellWidth, this._lastCellHeight);
        return this._root;
    }

    /**
     * Size the navigator proportionally to the viewer cell it belongs to,
     * capped at the historical 360x300 and floored so it stays readable.
     * The OSD navigator fills its host element (xOpat passes `navigatorId`, so
     * OSD's own navigatorSizeRatio/width/height options are ignored), which is
     * why sizing happens here and not through viewer options.
     * @param {number} [cellWidth] width of the viewer cell in px
     * @param {number} [cellHeight] height of the viewer cell in px
     * @return {boolean} true when the applied size actually changed
     */
    setSize(cellWidth, cellHeight) {
        if (cellWidth > 0) this._lastCellWidth = cellWidth;
        if (cellHeight > 0) this._lastCellHeight = cellHeight;
        const cw = this._lastCellWidth || window.innerWidth || NavigatorSideMenu.MAX_WIDTH;
        const ch = this._lastCellHeight || window.innerHeight || NavigatorSideMenu.MAX_HEIGHT;

        const { MIN_WIDTH, MAX_WIDTH, MIN_HEIGHT, MAX_HEIGHT, WIDTH_RATIO, HEIGHT_RATIO } = NavigatorSideMenu;
        const aspect = MAX_WIDTH / MAX_HEIGHT;

        let w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(cw * WIDTH_RATIO)));
        let h = Math.round(w / aspect);
        // A wide but short cell (e.g. a 1x3 row grid) must not get a navigator
        // taller than the slide area: re-derive the width from the height cap.
        const hCap = Math.round(ch * HEIGHT_RATIO);
        if (h > hCap) {
            h = Math.max(MIN_HEIGHT, hCap);
            w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(h * aspect)));
        }

        if (w === this._appliedWidth && h === this._appliedHeight) return false;
        this._appliedWidth = w;
        this._appliedHeight = h;
        if (this._navHost) {
            this._navHost.style.width = `${w}px`;
            this._navHost.style.height = `${h}px`;
            this._body.style.width = `${w}px`;
            this._root.style.width = `${w}px`;
        }
        return true;
    }

    /**
     * Focal-plane (z-stack) navigator row, mounted at the bottom of the
     * navigator window. Hidden by default — {@link init} reveals it only when
     * the bound viewer shows a multi-plane slide. Drives / reflects the core
     * per-viewer `viewer.__depthController`; the actual tile swap + zombie cache
     * handling lives there, this is pure UI.
     */
    _createDepthRow() {
        const commit = (value) => {
            const v = parseInt(value, 10);
            if (Number.isNaN(v)) return;
            this._viewer?.__depthController?.setDepth?.(v);
        };

        const readout = input({
            type: "number", min: "0", step: "1",
            class: "input input-xs input-bordered text-center px-1 flex-none",
            style: "width:3.5rem; height:1.5rem;",
            title: $.t("main.navigator.focalPlane"),
        });
        readout.addEventListener("change", (e) => commit(e.target.value));

        const slider = input({
            type: "range", min: "0", max: "0", step: "1", value: "0",
            class: "range range-xs range-primary w-full",
        });
        // "input" tracks the drag live; the depth controller de-dupes unchanged
        // indices and only fetches when the plane actually changes.
        slider.addEventListener("input", (e) => commit(e.target.value));

        const count = span({ class: "text-[10px] opacity-60 whitespace-nowrap" });

        const row = div(
            {
                class: "display-none flex flex-col gap-1 px-2 py-1 border-t border-base-300 bg-base-200/60",
                title: $.t("main.navigator.focalPlaneHint"),
            },
            // Row 1: label + count + numeric input, all on one compact line.
            div(
                { class: "flex items-center gap-2 text-xs" },
                span({ class: "font-semibold opacity-80 whitespace-nowrap" }, $.t("main.navigator.focalPlane")),
                count,
                span({ class: "flex-1" }),
                readout,
            ),
            // Row 2: slider spanning the width.
            slider,
        );

        this._depth = { row, slider, readout, count };
        return row;
    }

    /**
     * Two-level init (matches ShaderSideMenu): the constructor builds DOM before
     * the viewer opens; this wires per-viewer events once it exists.
     * @param {OpenSeadragon.Viewer} viewer
     */
    init(viewer) {
        this._viewer = viewer;
        if (this._depthWired) return;
        this._depthWired = true;
        // Slide (re)opens can add/remove/replace the z-stack; reflect availability.
        viewer.addHandler("open", () => this.refreshDepth());
        // Keyboard / Alt-scroll / scripting changes flow back here.
        viewer.addHandler("z-depth-changed", (e) => this._reflectDepth(e.index, e.count));
        this.refreshDepth();
    }

    /** Recompute range + visibility from the bound viewer's depth controller. */
    refreshDepth() {
        const d = this._depth;
        if (!d || !this._viewer) return;
        const range = this._viewer.__depthController?.getRange?.();
        if (!range) {
            d.row.classList.add("display-none");
            return;
        }
        d.row.classList.remove("display-none");
        d.slider.max = String(range.count - 1);
        d.readout.max = String(range.count - 1);
        this._reflectDepth(range.index, range.count);
    }

    _reflectDepth(index, count) {
        const d = this._depth;
        if (!d) return;
        d.slider.value = String(index);
        d.readout.value = String(index);
        d.count.textContent = $.t("main.navigator.focalPlaneCount", { count });
    }
}
