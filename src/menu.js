function initMenu(){

    let menu = new UI.Menu({
                         id: "myMenu",
                         orientation: UI.Menu.ORIENTATION.TOP
                        },);
    menu.attachTo(document.getElementById('main-panel'));
    document.getElementById("myMenu").classList.remove("bg-base-200");

    // TODO make new component for main-panel -> add methods from user-interface MainMenu
    // `<div id="${id}" -> id MENU, on components we will access through API
    // class="inner-panel ${pluginId}-plugin-root -> must be for every top level component of some plugin
    // firstly we add plugin div and in it there will be our UI component hiearchy
    // advanced menu shoudl be equiallent to our Menu, submenu -> creates menu in menu
    // we can have always submenu and only hide header
    // create one component for main menu and advanced menu

    //appCache -> remember settings for each user, remember open/close etc

    //setup component in config.json -> can be added in URL, important setting such as removed cookies, theme etc -> can be set from outside


    menu.getBodyDomNode().innerHTML = `<div id="main-panel-content" class='position-relative height-full' style="padding-bottom: 80px;overflow-y: scroll;scrollbar-width: thin /*mozilla*/;overflow-x: hidden;">
        <div id="main-panel-top" class="inner-panel inner-panel-visible d-flex py-1 flex-content-between">
            <span id="main-panel-hide" class="material-icons btn-pointer" onclick="USER_INTERFACE.MainMenu.close();">chevron_right</span>

            <div id="user-panel" class="btn-pointer" style="flex-grow: 1;text-align-last: right;">
                <span id="user-name" data-i18n="user.anonymous"></span>
                <span id="user-icon"><span class="material-icons btn-pointer">account_circle</span></span>
            </div>
        </div>

        <div id="navigator-container" data-position="relative" class="inner-panel right-0 mb-1" style="width: 400px; max-width: 100vw; position: relative; background-color: var(--color-bg-canvas)">
            <div><!--the div below is re-inserted by OSD, keep it in the hierarchy at the same position-->
                <div id="panel-navigator" style=" height: 300px; width: 100%;"></div>
            </div>
            <div class="position-absolute top-1 left-3 right-0 d-flex pr-2">
                <div id="tissue-title-header" class="d-flex flex-items-center" style="max-height: 255px; max-width: 90%; flex-grow: 1;">
                    <span id="global-tissue-visibility" class="d-inline-block">
                        <input type="checkbox" style="align-self: center; vertical-align: baseline;" checked class="form-control mr-1" onchange="VIEWER.world.getItemAt(0).setOpacity(this.checked ? 1 : 0);">
                    </span>
                    <span class="tissue-title-container d-flex">
                        <span id="tissue-title-content" class="text-shadow-mild one-liner" style="flex-grow: 1">Slide<!--Inserted slide name--></span>
                        <span class="material-icons pointer" onclick="UTILITIES.copyToClipboard(this.previousElementSibling.textContent)">content_copy</span>
                    </span>
                </div>
                <span id="navigator-pin" class="material-icons btn-pointer inline-pin" onclick="
 let self = $(this);
 if (self.hasClass('pressed')) {
    self.removeClass('pressed');
    self.parent().parent().removeClass('color-shadow-medium').attr('data-position', 'relative').css('position', 'relative');
 } else {
    self.parent().parent().addClass('color-shadow-medium').attr('data-position', 'fixed');
    self.addClass('pressed');
 }
"> push_pin </span>
            </div>
            <span class="fas fa-clone btn-pointer right-2 bottom-2 position-absolute" onclick="UTILITIES.clone()" data-i18n="[title]main.global.clone"></span>

        </div>

        <div id="panel-images" class="inner-panel mt-2"></div>

        <div id="panel-shaders" class="inner-panel" style="display:none;">

            <!--NOSELECT important due to interaction with slider, default height must be defined due to height adjustment later, TODO: set from cookies-->
            <div class="inner-panel-content noselect" id="inner-panel-content-1">
                <div>
                    <span id="shaders-pin" class="material-icons btn-pointer inline-arrow" onclick="let jqSelf = $(this); USER_INTERFACE.MainMenu.clickHeader(jqSelf, jqSelf.parents().eq(1).children().eq(1));
                    APPLICATION_CONTEXT.AppCookies.set('_shadersPin', String(jqSelf.hasClass('opened')));" style="padding: 0;">navigate_next</span>
                    <select name="shaders" id="shaders" style="max-width: 80%;" class="form-select v-align-baseline h3 mb-1 pointer" aria-label="Visualization">
                        <!--populated with shaders from the list -->
                    </select>
                    <div class="d-inline-block float-right position-relative hover-selectable">
                        <span id="cache-snapshot" class="material-icons btn-pointer text-right"
                        style="vertical-align:sub;" data-i18n="[title]main.shaders.saveCookies">bookmark</span>
                        <div class="position-absolute px-2 py-1 rounded-2 border-sm top-0 right-2 flex-row" style="display: none; background: var(--color-bg-tertiary);">
                            <span class="material-icons btn-pointer" data-i18n="[title]main.shaders.cacheByName" onclick="UTILITIES.makeCacheSnapshot(true);">sort_by_alpha</span>
                            <span class="material-icons btn-pointer" data-i18n="[title]main.shaders.cacheByOrder" onclick="UTILITIES.makeCacheSnapshot(false);">format_list_numbered</span>
                        </div>
                    </div>
                    <br>
                    <div id="global-opacity" class="float-right">
                        <label>
                            <span data-i18n="main.global.layerOpacity">Opacity</span>
                            <input type="range"  min="0" max="1" value="1" step="0.1" class="ml-1" style="width: 100px;">
                        </label>
                    </div>
                </div>

                <div id="data-layer-options" class="inner-panel-hidden" style="clear:both">
                        <!--populated with options for a given image data -->
                </div>
                <div id="blending-equation"></div>
            </div>
        </div>
        <!-- Appended controls for other plugins -->
    </div>

    <div class="d-flex flex-1 position-fixed bottom-0 bg-opacity fixed-bg-opacity" style="width: 400px; max-width: 100vw;">
        <div class="width-full d-flex flex-justify-between mx-4">
            <span id="copy-url" class="hover-selectable py-2 pr-1" style="flex: none" data-i18n="[title]main.bar.explainExportUrl">
                <span class="material-icons pr-0" style="font-size: 22px;">share</span>
                <span class="pl-1" data-i18n="main.bar.share">Share &emsp;</span>

                <div class="position-absolute px-1 py-1 rounded-2 border-sm bottom-1 left-0 flex-column width-full flex-items-center" style="background: var(--color-bg-tertiary);">

                    <span id="global-export" class="btn-pointer flex-row" onclick="UTILITIES.export();" data-i18n="[title]main.bar.explainExportFile">
                        <span class="material-icons px-0 py-1" style="font-size: 22px;">download</span>
                        <span data-i18n="main.bar.exportFile">Export</span>
                    </span>
                    <span id="copy-url-inner" class="btn-pointer flex-row"  onclick="UTILITIES.copyUrlToClipboard();" data-i18n="[title]main.bar.explainExportUrl">
                        <span class="material-icons px-0" style="font-size: 22px;">link</span>
                        <span data-i18n="main.bar.exportUrl">URL</span>
                    </span>
                </div>
            </span>
            <span id="add-plugins" class="btn-pointer py-2 pr-1" style="flex: none" onclick="USER_INTERFACE.AdvancedMenu.openMenu(APPLICATION_CONTEXT.pluginsMenuId);" data-i18n="[title]main.bar.explainPlugins">
                <span class="material-icons pr-0" style="font-size: 22px;">extension</span>
                <span class="pl-1" data-i18n="main.bar.plugins">Plugins</span>
            </span>
            <span id="global-help" class="btn-pointer py-2 pr-1"  style="flex: none" onclick="USER_INTERFACE.Tutorials.show();" data-i18n="[title]main.bar.explainTutorials">
                <span class="material-icons pr-0 pointer" style="font-size: 22px;">school</span>
                <span class="pl-1" data-i18n="main.bar.tutorials">Tutorial</span>
            </span>
            <span id="settings" class="p-0 material-icons btn-pointer py-2 pr-1" style="flex: none" onclick="USER_INTERFACE.AdvancedMenu.openMenu(APPLICATION_CONTEXT.settingsMenuId);" data-i18n="[title]main.bar.settings">settings</span>
        </div>
    </div>
</div>
`;
}