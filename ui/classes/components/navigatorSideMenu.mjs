import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import {Button} from "../elements/buttons.mjs";
import {Checkbox} from "../elements/checkbox.mjs";
import {Join} from "../elements/join.mjs";
import {FAIcon} from "../elements/fa-icon.mjs";
import {Div} from "../elements/div.mjs";

const { div, } = van.tags;

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
        }, new FAIcon({ name: "fa-copy" }));


        const header = new Join({
            style: Join.STYLE.HORIZONTAL,
            extraClasses: {
                width: "w-full",
                padding: "px-2 py-1",
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
                div({ id: this.navigatorId, style: "height:300px; width:360px;" })
            )
        );
    }
}
