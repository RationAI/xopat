globalThis.UI = {};
globalThis.VANCOMPONENTS = {};

import { PrimaryButton } from "./components/buttons.mjs"; // TODO
import { Collapse } from "./components/collapse.mjs"; // TODO
import { FAIcon } from "./components/fa-icon.mjs";
const UI = { PrimaryButton, Collapse, FAIcon };
globalThis.UI = UI;
export default UI;
//console.log(globalThis);

// globalThis.vanInject = function (id, thiss) {
//     const component = globalThis.VANCOMPONENTS[id];
//     thiss.appendChild(component);
// }

// globalThis.vanReplace = function (id, thiss) {
//     console.log("vanReplace");
//     const component = globalThis.VANCOMPONENTS[id];
//     thiss.replaceWith(component);
// }

globalThis.vanRegister = function (id, component) {
    globalThis.VANCOMPONENTS[id] = component;
}

var settingsIcon = new FAIcon({
    name: "fa-gear"
});
var settings = new PrimaryButton({
    onClick: () => {
        USER_INTERFACE.AdvancedMenu.openMenu(APPLICATION_CONTEXT.settingsMenuId);
    },
    id: "settingsButton",
}, settingsIcon);

settings.set(PrimaryButton.SIZE.SMALL)

vanRegister("settings", settings);

var tutorialIcon = new FAIcon({
    name: "fa-graduation-cap"
});

var tutorial = new PrimaryButton({
    onClick: () => {
        USER_INTERFACE.Tutorials.show();
    },
    id: "tutorialButton",
}, tutorialIcon, "tutorial");
tutorial.set(PrimaryButton.SIZE.SMALL)
vanRegister("tutorial", tutorial);

var pluginsIcon = new FAIcon({
    name: "fa-puzzle-piece"
});
var plugins = new PrimaryButton({
    onClick: () => {
        USER_INTERFACE.AdvancedMenu.openMenu(APPLICATION_CONTEXT.pluginsMenuId);
    },
    id: "pluginsButton",
}, pluginsIcon, "plugins");
plugins.set(PrimaryButton.SIZE.SMALL)
vanRegister("plugins", plugins);

globalThis.window.addEventListener("load", function () {
    for (const id in globalThis.VANCOMPONENTS) {
        const component = globalThis.VANCOMPONENTS[id];
        let elements = document.querySelectorAll(`[data-van="${id}"]`);
        elements.forEach(element => {
            console.log(element);
            component.attachTo(element);
        });
    }

});