globalThis.UI = {};
globalThis.VANCOMPONENTS = {};

import { Button } from "./components/buttons.mjs";
import { Collapse } from "./components/collapse.mjs";
import { FAIcon } from "./components/fa-icon.mjs";
import { Join } from "./components/join.mjs";
const UI = { Button, Collapse, FAIcon, Join };
globalThis.UI = UI;
export default UI;

globalThis.vanRegister = function (id, component) {
    globalThis.VANCOMPONENTS[id] = component;
}
