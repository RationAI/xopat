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

        // TODO proper slide switching
        VIEWER_MANAGER.addHandler('viewer-create', e => {
            if (APPLICATION_CONTEXT.config.background.length <= 1) return;
            USER_INTERFACE.addViewerHtml(
                new UI.Div({class: "absolute", id:"my-test-item"},
                    new UI.Button({onClick: this.changeSlide.bind(this, false)}, '<<'),
                    new UI.Button({onClick: this.changeSlide.bind(this, true)}, '>>')
                ), this.id, e.viewer.id);
        });
        VIEWER_MANAGER.addHandler('viewer-destroy', e => {
            document.getElementById("my-test-item")?.remove();
        });
    }

    changeSlide(forward) {
        const currentIndex = Number.parseInt(APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0));
        const nextIndex = forward ? currentIndex + 1 : currentIndex - 1;
        const bgSize = APPLICATION_CONTEXT.config.background.length;
        if (nextIndex >= bgSize) {
            Dialogs.show("This is the last slide.", 5000, Dialogs.MSG_OK);
            return;
        }
        if (nextIndex < 0) {
            Dialogs.show("This is the first slide.", 5000, Dialogs.MSG_OK);
            return;
        }
        console.log(`Switching to slide index ${nextIndex} out of ${bgSize}`);
        APPLICATION_CONTEXT.openViewerWith(
            APPLICATION_CONTEXT.config.data,
            APPLICATION_CONTEXT.config.background,
            APPLICATION_CONTEXT.config.visualizations,
            nextIndex
        );
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
    }
});