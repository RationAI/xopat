import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import {Button} from "../elements/buttons.mjs";
import {Checkbox} from "../elements/checkbox.mjs";
import {PhIcon} from "../elements/ph-icon.mjs";
import {Div} from "../elements/div.mjs";
import {AdjustmentControls} from "./adjustmentControls.mjs";
import {Popover} from "./popover.mjs";

const { div } = van.tags;

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
    /** The sliders need this much even under the smallest navigator. */
    static QUICK_ADJUST_MIN_WIDTH = 240;
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
                // One line, ellipsised, and allowed to shrink (`min-width:0`):
                // a long slide path used to wrap and push the header buttons
                // out of the panel. Inline because the `class` option above
                // is not what `Div` renders its classes from.
                style: "flex:1 1 0; min-width:0; overflow:hidden; text-overflow:ellipsis;"
                    + " white-space:nowrap; box-sizing:border-box; vertical-align:middle;"
            },
            onClick: function () {
                // inside this handler, `this` is the DOM node for the title
                UTILITIES.copyToClipboard(this.textContent);
            }
        });

        const self = this;
        this.visibility = new Checkbox({
            id: this.id + "-visibility",
            label: "",
            checked: true,
            onchange: function () {
                // The viewer this navigator belongs to — never the focused one.
                self._viewer?.world?.getItemAt(0)?.setOpacity(this.checked ? 1 : 0);
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
                style: "width:30px; flex:none;"
            },
        }, new PhIcon({ name: "ph-copy" }));

        // Quick background adjustment: revealed on navigator hover (see
        // `.navigator-hover-action` in src/assets/style.css), toggles the
        // slider pop-over hanging under the navigator.
        this.quickAdjust = new Button({
            id: this.id + "-quick-adjust",
            size: Button.SIZE.SMALL,
            onClick: () => this.toggleQuickAdjust(),
            extraClasses: { hover: "navigator-hover-action" },
            extraProperties: {
                title: $.t("adjustments.quickTitle"),
                "aria-label": $.t("adjustments.quickTitle"),
                style: "width:30px; flex:none;"
            },
        }, new PhIcon({ name: "ph-sliders-horizontal" }));


        // A plain flex row, not a `Join`: this is three controls in a line, not a
        // segmented control, and `Join`'s own base class carries `bg-join`
        // (ui/classes/elements/join.mjs) — a single-class rule that loads after
        // Tailwind and therefore beat the `bg-base-200/90` asked for here, so the
        // title bar painted the `--ctp-text` tint instead of the panel surface.
        //
        // No horizontal padding: the navigator canvas below is flush with the
        // panel edge (its width is written in px by setSize), so an inset header
        // would put these controls out of line with everything under them.
        const header = div(
            {
                class: "w-full px-0 py-0 bg-base-200/90 border-b border-base-300 flex flex-row items-center gap-2"
            },
            this.toNode(this.visibility),
            this.toNode(this.title),
            this.toNode(this.quickAdjust),
            this.toNode(this.copy)
        );

        // No fixed width here: the panel is sized by `setSize()` against the
        // owning viewer cell, so a small screen / dense grid gets a small
        // navigator instead of a 360px square covering the tissue.
        this._navHost = div({ id: this.navigatorId });
        // Only the overview lives here. The quick adjustments are a pop-over
        // (see toggleQuickAdjust): inline they grew the panel and shoved every
        // side-menu panel below it down each time they were opened.
        this._body = div(
            { class: "flex flex-col" },
            this._navHost
        );
        this._root = div(
            { class: "navigator-panel flex flex-col" },
            header,
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
        // The pop-over is as wide as the navigator it hangs under.
        this._quickPopover?.reposition();
        return true;
    }

    /**
     * Show/hide the quick background adjustment pop-over. Its sliders write the
     * same value to every background layer of this navigator's viewer.
     * @param {boolean} [open] force a state; toggles when omitted
     */
    toggleQuickAdjust(open) {
        if (!this._root) return;
        const show = open ?? !this._quickPopover?.isOpen();
        if (!show) {
            this._quickPopover?.close();
            return;
        }
        if (!this._quickPopover) {
            // Built on first open: the adjustments broker and the viewer must exist.
            this._quickPopover = new Popover({
                id: this.id + "-quick-adjust-popover",
                // Right under the button that opens it, so it reads as that
                // button's panel; it overlays the overview instead of sitting
                // detached below the whole navigator.
                anchor: () => document.getElementById(this.id + "-quick-adjust"),
                trigger: () => document.getElementById(this.id + "-quick-adjust"),
                placement: "bottom",
                width: () => Math.max(NavigatorSideMenu.QUICK_ADJUST_MIN_WIDTH, this._appliedWidth || 0),
                // Tuning is a loop of "move a slider, pan and zoom to look,
                // move it again" — navigating the slide must not dismiss it.
                keepOpenOn: (target) => !!target?.closest?.(".openseadragon-container"),
                onOpen: () => {
                    // `btn-active` also keeps the hover-revealed button visible
                    // while the pointer is in the pop-over, outside the panel.
                    this.quickAdjust?.setClass?.("active", "btn-active");
                    this._quickControls?.refresh();
                },
                onClose: () => this.quickAdjust?.setClass?.("active", ""),
            }, this._buildQuickAdjust());
        }
        this._quickPopover.open();
    }

    /** @returns {Node} the controls, built once and re-attached on every open */
    _buildQuickAdjust() {
        const adjustments = APPLICATION_CONTEXT.adjustments;
        const background = () => this._viewer ? adjustments.backgroundLayerIds(this._viewer) : [];
        this._quickControls = new AdjustmentControls({
            keys: adjustments.getQuickKeys(),
            // All background layers move together; the first one is the readout.
            getValues: () => {
                const first = background()[0];
                return first ? adjustments.get(this._viewer, first) : {};
            },
            onInput: (patch) => this._viewer && adjustments.setBackground(this._viewer, patch),
            onAuto: async () => {
                const first = background()[0];
                if (!first) return;
                const range = await adjustments.autoLevels(this._viewer, first);
                if (range) adjustments.setBackground(this._viewer, range);
            },
            onReset: () => {
                for (const id of background()) adjustments.reset(this._viewer, id);
            },
        });
        this._unsubscribeAdjustments = adjustments.onChange((change) => {
            if (change.viewer === this._viewer && this._quickPopover?.isOpen()) {
                this._quickControls?.refresh();
            }
        });
        return this._quickControls.create();
    }

    destroy() {
        this._quickPopover?.destroy();
        this._quickPopover = null;
        this._unsubscribeAdjustments?.();
        this._unsubscribeAdjustments = null;
        this._quickControls?.destroy();
        this._quickControls = null;
    }

    /**
     * Two-level init (matches ShaderSideMenu): the constructor builds DOM before
     * the viewer opens; this binds the viewer once it exists. The focal-plane
     * control that used to live here is the per-viewer `DepthRuler`.
     * @param {OpenSeadragon.Viewer} viewer
     */
    init(viewer) {
        this._viewer = viewer;
    }
}
