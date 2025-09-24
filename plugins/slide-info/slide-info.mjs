import {SlideSwitcherMenu} from "./slideSwitcherMenu.mjs";
addPlugin('slide-info', class extends XOpatPlugin {
    constructor(id) { 
        super(id);

        VIEWER_MANAGER.addHandler('after-open', e => {
            this.menu.refresh();
        });
    }

    pluginReady() {
        this.menu = new SlideSwitcherMenu({
            onClose: () => USER_INTERFACE.TopVisualMenu.setTabSelected(false)
        });
        USER_INTERFACE.TopVisualMenu.registerWindowTab('slide-info-switcher', 'fa-window-restore', 'Slide Manager', selected => {
            if (selected) {
                this.menu.open();
            } else {
                this.menu.close();
            }
        });
    }
});