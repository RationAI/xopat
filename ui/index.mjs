globalThis.UI = {};
globalThis.VANCOMPONENTS = {};

import van from "./vanjs.mjs";

import { BaseComponent } from "./classes/baseComponent.mjs";

// ELEMENTS
import { Button } from "./classes/elements/buttons.mjs";
import { FAIcon } from "./classes/elements/fa-icon.mjs";
import { Join } from "./classes/elements/join.mjs";
import { Div } from "./classes/elements/div.mjs";
import { Dropdown } from "./classes/elements/dropdown.mjs";
import { Checkbox } from "./classes/elements/checkbox.mjs";
import { Select } from "./classes/elements/select.mjs";
import { RawHtml } from "./classes/elements/rawHtml.mjs";
import { Alert } from "./classes/elements/alert.mjs";
import { StretchGrid } from "./classes/elements/stretchGrid.mjs";
import { Input } from "./classes/elements/input.mjs";
import { Badge } from "./classes/elements/badge.mjs";
import { Title } from "./classes/elements/title.mjs";
import { Collapse } from "./classes/elements/collapse.mjs";

// COMPONENTS
import { Menu } from "./classes/components/menu.mjs";
import { MainPanel } from "./classes/components/mainPanel.mjs";
import { MultiPanelMenuTab } from "./classes/components/multiPanelMenuTab.mjs";
import { MultiPanelMenu } from "./classes/components/multiPanelMenu.mjs";
import { FullscreenMenu } from "./classes/components/fullscreenMenu.mjs";
import { TabsMenu } from "./classes/components/tabsMenu.mjs";
import { Toolbar } from "./classes/components/toolbar.mjs";
import { ShaderLayer } from "./classes/components/shaderLayer.mjs";
import { ShaderSideMenu } from "./classes/components/shaderSideMenu.mjs";
import { FloatingWindow } from "./classes/components/floatingWindow.mjs";
import { MainLayout } from "./classes/components/mainLayout.mjs";
import { Toast } from "./classes/components/toast.mjs";
import { MenuTabBanner } from "./classes/components/menuTabBanner.mjs";
import { RightSideViewerMenu } from "./classes/components/rightSideViewerMenu.mjs";
import { NavigatorSideMenu } from "./classes/components/navigatorSideMenu.mjs";
import { Explorer } from "./classes/components/explorer.mjs";

import { GlobalTooltip } from "./services/globalTooltip.mjs";
import { AppBar } from "./services/appBar.mjs";

const UI = {
    // Elements
    BaseComponent,
    Button, FAIcon, Join, Div, Dropdown, Checkbox, Select, RawHtml, Alert,
    StretchGrid, Input, Badge, Title, Collapse,

    // Components
    Menu, MainPanel, MultiPanelMenuTab, MultiPanelMenu, FullscreenMenu, TabsMenu,
    Toolbar, ShaderLayer, ShaderSideMenu, FloatingWindow,
    MainLayout, Toast, MenuTabBanner, RightSideViewerMenu, NavigatorSideMenu,
    Explorer,

    // Services
    GlobalTooltip, AppBar
};

globalThis.UI = UI;

globalThis.vanRegister = function (id, component) {
    globalThis.VANCOMPONENTS[id] = component;
}

globalThis.van = van;
