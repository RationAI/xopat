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
import { Toolbar } from "./classes/components/toolbar/toolbar.mjs";
import { ToolbarItem} from "./classes/components/toolbar/toolbarItem.mjs";
import { ToolbarSeparator } from "./classes/components/toolbar/toolbarSeparator.mjs";
import { ToolbarGroup } from "./classes/components/toolbar/toolbarGroup.mjs";
import { ToolbarChoiceGroup } from "./classes/components/toolbar/toolbarChoiceGroup.mjs";
import { ToolbarPanelButton } from "./classes/components/toolbar/toolbarPanelButton.mjs";
import { ShaderLayer } from "./classes/components/shaderLayer.mjs";
import { ShaderSideMenu } from "./classes/components/shaderSideMenu.mjs";
import { FloatingWindow } from "./classes/components/floatingWindow.mjs";
import { MainLayout } from "./classes/components/mainLayout.mjs";
import { Toast } from "./classes/components/toast.mjs";
import { MenuTabBanner } from "./classes/components/menuTabBanner.mjs";
import { RightSideViewerMenu } from "./classes/components/rightSideViewerMenu.mjs";
import { NavigatorSideMenu } from "./classes/components/navigatorSideMenu.mjs";
import { Explorer } from "./classes/components/explorer.mjs";
import { DockableWindow } from "./classes/components/dockableWindow.mjs";

// COMPONENTS
import { GlobalTooltip } from "./services/globalTooltip.mjs";
import { AppBar } from "./services/appBar.mjs";
import { FloatingManager } from "./services/floatingManager.mjs";

class ServiceContainer {
    _globalTooltip = null;
    _appBar = null;
    _floatingManager = null;

    /**
     * Gets the GlobalTooltip service.
     * Instantiates it on the first call.
     */
    get GlobalTooltip() {
        if (!this._globalTooltip) {
            this._globalTooltip = new GlobalTooltip();
        }
        return this._globalTooltip;
    }

    /**
     * Gets the AppBar service.
     * Instantiates it on the first call.
     */
    get AppBar() {
        if (!this._appBar) {
            this._appBar = new AppBar();
        }
        return this._appBar;
    }

    /**
     * Gets the FloatingManager service.
     * Instantiates it on the first call.
     */
    get FloatingManager() {
        if (!this._floatingManager) {
            this._floatingManager = new FloatingManager();
        }
        return this._floatingManager;
    }
}

const UI = {
    // Elements
    BaseComponent,
    Button, FAIcon, Join, Div, Dropdown, Checkbox, Select, RawHtml, Alert,
    StretchGrid, Input, Badge, Title, Collapse,

    // Components
    Menu, MainPanel, MultiPanelMenuTab, MultiPanelMenu, FullscreenMenu, TabsMenu, ShaderLayer,
    ShaderSideMenu, FloatingWindow, MainLayout, Toast, MenuTabBanner, RightSideViewerMenu, NavigatorSideMenu,
    Explorer, Toolbar, ToolbarItem, ToolbarSeparator, ToolbarGroup, ToolbarChoiceGroup, ToolbarPanelButton,
    DockableWindow,

    // Services -> instantiated
    Services: new ServiceContainer()
};

globalThis.UI = UI;

globalThis.vanRegister = function (id, component) {
    globalThis.VANCOMPONENTS[id] = component;
}

globalThis.van = van;
