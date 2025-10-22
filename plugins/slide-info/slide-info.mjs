import {SlideSwitcherMenu} from "./slideSwitcherMenu.mjs";
addPlugin('slide-info', class extends XOpatPlugin {
    constructor(id) { 
        super(id);

        this.infoMenuBuilder = new AdvancedMenuPages(this.id, 'guessUIFromJson');
        this.hasCustomBrowser = false;

        VIEWER_MANAGER.addHandler('after-open', e => {
            if (!this.hasCustomBrowser) {
                this.menu.refresh();
            }

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
            onClose: () => !this._preventChange && USER_INTERFACE.AppBar.View.setTabSelected('slide-info-switcher', false)
        });
        // todo this does not follow plugin API!
        const selected = USER_INTERFACE.AppBar.View.registerViewItem('slide-info-switcher', 'fa-window-restore', 'Slide Manager', selected => {
            this._preventChange = true;
            if (selected) {
                this.menu.close();
                USER_INTERFACE.AppBar.View.setTabSelected('slide-info-switcher', false);
            } else {
                this.menu.open();
                USER_INTERFACE.AppBar.View.setTabSelected('slide-info-switcher', true);
            }
            this._preventChange = false;
        });
        if (selected) setTimeout(() => this.menu.open());
    }

    /**
     * @callback getBGStandaloneItem
     * @param {object} item
     * @returns {StandaloneBackgroundItem}
     */

    // todo consider updates support and colision resolution, e.g. by OSD events...
    /**
     *
     * @param {UI.Explorer.Options|undefined|false} config if falsey value, customization is disabled
     * @param {getBGStandaloneItem} config.bgItemGetter a function that from explorer leaf item returns BG configuration,
     *  the configuration must be of a type StandaloneBackgroundItem as the browsing is not dependent on the active session.
     */
    setCustomBrowser(config) {
        this.menu.refresh(config);
        this.hasCustomBrowser = !!config;

        // todo consider support for layout positioning (globally, not here)
        // if (!this.explorer) {
        //     this.explorer = new UI.Explorer(config);
        //     // LAYOUT.addTab({
        //     //     id: 'browser',
        //     //     title: 'Slide Browser',
        //     //     icon: 'fa-list-ul',
        //     //     body: [
        //     //         this.explorer.create()
        //     //     ]
        //     // });
        // } else {
        //     console.error("Slide browser can show only single explorer instance: collision of use in modules or plugins!");
        // }
    }
});