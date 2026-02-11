import {SlideSwitcherMenu} from "./slideSwitcherMenu.mjs";
addPlugin('slide-info', class extends XOpatPlugin {
    constructor(id) { 
        super(id);

        this.infoMenuBuilder = new AdvancedMenuPages(this.id, 'guessUIFromJson');
        this.hasCustomBrowser = false;

        this.slideSwitching = this.getOptionOrConfiguration('slideSwitching', 'slideSwitching', true);
        this.slideBrowser = this.getOptionOrConfiguration('slideBrowser', 'slideBrowser', true);

        this.infoMenuBuilder.buildViewerMenu(viewer => {

            let result = {
                id: `${viewer.id}-slide-info`,
                title: "Slide Information",
                page: undefined
            };

            try {
                const mainTiledImage = viewer.world.getItemAt(0);
                let metadata = mainTiledImage?.source.getMetadata();
                if (metadata) {
                    metadata = metadata.info || metadata;
                    result.page = Array.isArray(metadata) ? metadata : [metadata];
                }
            } catch (e) {
                console.error('Failed to load slide meta for slide viewer', viewer, e);
            }

            return result;
        });

        VIEWER_MANAGER.addHandler('after-open', e => {
            if (!this.hasCustomBrowser && this.slideBrowser) {
                this.menu.refresh();
            }
        });

        VIEWER_MANAGER.broadcastHandler('show-demo-page', e => {
            // Only show our custom UI if there isn't a specific loading error
            if (e.error) return;

            const showExplorer = () => {
                if (this.menu) {
                    this.menu.open();
                    USER_INTERFACE.AppBar.View.setTabSelected('slide-info-switcher', true);
                }
            };

            // TODO: does not work, OSD overlays are hidden behind another canvas - either annotations
            // const openBtn = new UI.Button({
            //     onClick: showExplorer,
            //     extraClasses: "btn-primary btn-lg shadow-lg",
            // }, "Open Slide Manager").create();
            //
            // new OpenSeadragon.MouseTracker({
            //     element: openBtn,
            //     handler: (event) => {
            //         // This prevents OSD from panning the viewer when you click the button
            //         event.preventDefaultAction = true;
            //     }
            // });

            const demoUI = van.tags.div({
                    id: e.id,
                    class: "flex flex-col items-center justify-center h-full p-4 text-center m-8"
                },
                van.tags.div({ class: "mb-6 opacity-20" },
                    new UI.FAIcon({ name: "fa-images", extraClasses: "text-9xl" }).create()
                ),
                van.tags.h2({ class: "text-2xl font-bold mb-2" }, "No Slide Loaded"),
                van.tags.p({ class: "max-w-md mb-6 opacity-70" },
                    "Please select a slide from the Slide Manager. If not visible, slide manager can be opened via View menu."
                ),
                // openBtn
            );

            e.show(demoUI);
        });

        this._customControlButtons = undefined;
        this._customControlsInitialized = false;
        if (this.slideSwitching) {
            this.setupSlideSwitching();
        }
    }

    setupSlideSwitching() {
        VIEWER_MANAGER.addHandler('viewer-create', e => {
            this._createControlButtons(e.viewer);
        });
        VIEWER_MANAGER.addHandler('viewer-destroy', e => {
            // todo this needs to be fixed in some api-level way
            document.getElementById("slide-info-control-bar-"+e.viewer.id)?.remove();
        });
        this._customControlsInitialized = true;
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
        if (this.slideBrowser) {
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
    }

    /**
     * @callback customItemToBackground
     * @param {object} item item that is being browsed: a generic object that you returned from the hierarchy getter
     * @returns {StandaloneBackgroundItem}
     * The return value should include optional ID property.
     */

    /**
     * @callback backgroundToCustomItem
     * @param {StandaloneBackgroundItem} item item that is being browsed: a generic object that you returned from the hierarchy getter
     * @returns {object}
     * The return value should include optional ID property.
     */

    /**
     * Set custom browser hierarchy for the slide item browser.
     * Note that you should do this before the viewer is opened. If you cannot do it, you can use setWillInitCustomBrowser instead,
     * and initialize the UI later on.
     * @param {UI.Explorer.Options|undefined|false} config if falsey value, customization is disabled
     * @param {customItemToBackground} config.customItemToBackground a function that from explorer leaf item returns BG configuration,
     *  the configuration must be of a type StandaloneBackgroundItem as the browsing is not dependent on the active session.
     * @param {backgroundToCustomItem} config.backgroundToCustomItem a function that does the opposite of customItemToBackground,
     *  since the viewer can open a cached session and needs to know the original item to open.
     */
    setCustomBrowser(config) {
        if (!this.slideBrowser) {
            console.warn("Slide browser is disabled, skipping setCustomBrowser call.");
            return;
        }
        if (this.hasCustomBrowser && this.menu.orgConfig?.id && this.menu.orgConfig?.id !== config?.id) {
            console.warn(`Slide browser is already configured with different ID ${this.menu.orgConfig.id}, consider keeping only one browsing configuration. Overwriting with ${config.id}.`);
        }
        this.menu.refresh(config);
        this.hasCustomBrowser = !!config;
    }

    /**
     * In case you cannot set the browser hierarchy before the viewer is opened, you can use this method to set the configuration
     * and initialize the UI later on.
     */
    setWillInitCustomBrowser() {
        this.menu.refresh({});
        this.hasCustomBrowser = true;
    }

    /**
     * Add custom control buttons to the viewer.
     * TODO redesign this
     * @param children
     */
    addCustomViewerButtons(...children) {
        if (!children.length) return;

        if (this._customControlButtons === undefined) {
            // todo consider using JOIN, or better yet, use toolbar view once ready (with nested items strategy)
            this._customControlButtons = van.tags.div({class: "mx-2 my-0 px-2 py-1 bg-base-100 flex flex-row rounded-md"});
        }
        for (let ch of children) this._customControlButtons.appendChild(UI.BaseComponent.toNode(ch));

        if (this._customControlsInitialized) {
            for (let viewer of VIEWER_MANAGER.viewers) {
                this._createControlButtons(viewer);
            }
        }
    }

    _createControlButtons(viewer) {
        const active = APPLICATION_CONTEXT.config.background.length <= 1 ? {"active": "disabled"} : undefined;
        USER_INTERFACE.addViewerHtml(
            van.tags.div({class: "absolute bottom-0 left-[50%] flex flex-row", id: "slide-info-control-bar-"+viewer.id, style: "transform: translate(-50%, 0);"},
                new UI.Button({onClick: this.changeSlide.bind(this, false), extraClasses: active}, '❮❮').create(),
                this._customControlButtons,
                new UI.Button({onClick: this.changeSlide.bind(this, true), extraClasses: active}, '❯❯').create()
            ), this.id, viewer.id);
    }
});