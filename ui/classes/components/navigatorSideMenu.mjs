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

        return div(
            { class: "flex flex-col w-[360px]" },
            header.create(),
            div(
                { class: "flex flex-col", style: "width:360px;" },
                div({ id: this.navigatorId, style: "height:300px; width:360px;" }),
                this._createDepthRow()
            )
        );
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
