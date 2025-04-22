globalThis.UI = {};
globalThis.VANCOMPONENTS = {};

import van from "./vanjs.mjs";

import { Button } from "./components/buttons.mjs";
import { Collapse } from "./components/collapse.mjs";
import { FAIcon } from "./components/fa-icon.mjs";
import { Join } from "./components/join.mjs";
import { Menu } from "./components/menu.mjs";
import { Div } from "./components/div.mjs";
import { MainPanel } from "./components/mainPanel.mjs";
import { menuDropdown } from "./components/menuDropdown.mjs";
import { MenuButton } from "./components/menuButton.mjs";
import { MultiPanelMenuTab } from "./components/multiPanelMenuTab.mjs";

const UI = { Button, Collapse, FAIcon, Join, Menu, Div, MainPanel, menuDropdown, MenuButton, MultiPanelMenuTab };
globalThis.UI = UI;

globalThis.vanRegister = function (id, component) {
    globalThis.VANCOMPONENTS[id] = component;
}
// Allow also external code to use vanjs
globalThis.van = van;
