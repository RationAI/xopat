import {SlideSwitcherMenu} from "./slideSwitcherMenu.mjs";
addPlugin('slide-info', class extends XOpatPlugin {
    constructor(id) { 
        super(id);

        this.infoMenuBuilder = new AdvancedMenuPages(this.id, 'guessUIFromJson');

        VIEWER_MANAGER.addHandler('after-open', e => {
            this.menu.refresh();

            for (let viewer of VIEWER_MANAGER.viewers) {
                // todo consider consulting bgconfig
                const mainTiledImage = viewer.world.getItemAt(0);
                let metadata = mainTiledImage?.source.getMetadata();
                if (metadata) {
                    metadata = metadata.info || metadata;

                    this.infoMenuBuilder.buildViewerMenu(viewer, {
                        id: viewer.id,
                        title: "Slide Information",
                        page: Array.isArray(metadata) ? metadata : [metadata],
                    });
                } else {
                    // todo remove old menu
                }
            }
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

    // todo consider updates support and colision resolution, e.g. by OSD events...
    initBrowser(config) {
        if (!this.explorer) {
            this.explorer = new UI.Explorer(config);
            LAYOUT.addTab({
                id: 'browser',
                title: 'Slide Browser',
                icon: 'fa-list-ul',
                body: [
                    this.explorer.create()
                ]
            });
        } else {
            console.error("Slide browser can show only single explorer instance: collision of use in modules or plugins!");
        }
    }
});