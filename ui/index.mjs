globalThis.UI = {};
globalThis.VANCOMPONENTS = {};

import van from "./vanjs.mjs";

import { Button } from "./components/buttons.mjs";
import { FAIcon } from "./components/fa-icon.mjs";
import { Join } from "./components/join.mjs";
import { Menu } from "./components/menu.mjs";
import { Div } from "./components/div.mjs";
import { MainPanel } from "./components/mainPanel.mjs";
import { MultiPanelMenuTab } from "./components/multiPanelMenuTab.mjs";
import { MultiPanelMenu } from "./components/multiPanelMenu.mjs";
import { FullscreenMenu } from "./components/fullscreenMenu.mjs";
import { TabsMenu } from "./components/tabsMenu.mjs";

const UI = { Button, FAIcon, Join, Menu, Div, MainPanel, MultiPanelMenuTab, MultiPanelMenu, FullscreenMenu, TabsMenu };
globalThis.UI = UI;

globalThis.vanRegister = function (id, component) {
    globalThis.VANCOMPONENTS[id] = component;
}
// Allow also external code to use vanjs
globalThis.van = van;
