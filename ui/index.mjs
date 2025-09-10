globalThis.UI = {};
globalThis.VANCOMPONENTS = {};

import van from "../../../Desktop/Vis2/src/xopat/ui/vanjs.mjs";

import { BaseComponent } from "./classes/baseComponent.mjs";
import { Button } from "./classes/elements/buttons.mjs";
import { FAIcon } from "./classes/elements/fa-icon.mjs";
import { Join } from "./classes/elements/join.mjs";
import { Menu } from "./classes/components/menu.mjs";
import { Div } from "./classes/elements/div.mjs";
import { MainPanel } from "./classes/components/mainPanel.mjs";
import { MultiPanelMenuTab } from "./classes/components/multiPanelMenuTab.mjs";
import { MultiPanelMenu } from "./classes/components/multiPanelMenu.mjs";
import { FullscreenMenu } from "./classes/components/fullscreenMenu.mjs";
import { TabsMenu } from "./classes/components/tabsMenu.mjs";
import { Dropdown } from "./classes/elements/dropdown.mjs";
import { Checkbox } from "./classes/elements/checkbox.mjs";
import { Toolbar } from "./classes/components/toolbar.mjs";
import { Select } from "./classes/elements/select.mjs";
import { ShaderLayer } from "./classes/components/shaderLayer.mjs";
import { RawHtml } from "./classes/elements/rawHtml.mjs";
import { ShaderMenu } from "./classes/components/shaderMenu.mjs";
import { Alert } from "./classes/elements/alert.mjs";
import { StretchGrid } from "./classes/elements/stretch-grid.mjs";
import { FloatingWindow } from "./classes/components/floatingWindow.mjs";
import { SlideSwitcherMenu } from "./classes/components/slideSwitcherMenu.mjs";

import GlobalTooltip from "./services/globalTooltip.mjs";

const UI = {
    BaseComponent,
    Button, FAIcon, Join, Menu, Div, MainPanel, MultiPanelMenuTab, MultiPanelMenu, FullscreenMenu, TabsMenu,
    Dropdown, Checkbox, Toolbar, Select, ShaderLayer, RawHtml, ShaderMenu, Alert, GlobalTooltip, StretchGrid,
    FloatingWindow, SlideSwitcherMenu
};
globalThis.UI = UI;

globalThis.vanRegister = function (id, component) {
    globalThis.VANCOMPONENTS[id] = component;
}
// Allow also external code to use vanjs
globalThis.van = van;
