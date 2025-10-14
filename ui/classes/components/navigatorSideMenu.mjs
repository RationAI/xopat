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
            class: "",
            extraClasses: {btn: "btn btn-neutral btn-sm"},
            extraProperties: {style: "flex-grow: 1; box-sizing: border-box; vertical-align: center", title: "Copy"},
            onClick: function () {
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
            onClick: function () {
                UTILITIES.copyToClipboard(text.textContent);
            },
            extraProperties: {title: $.t('main.bar.copy'), style: "width: 30px"},
        }, new FAIcon({name: "fa-copy"}),);


        return div(
            new Join({
                style: Join.STYLE.HORIZONTAL,
                extraClasses: {width: "w-full"}
            }, this.visibility, this.title, this.copy).create(),
            div({class: "flex flex-col", style: "width: 360px;"},
                div({id: this.navigatorId, style: " height: 360px; width: 360px;"})
            )
        );
    }
}
