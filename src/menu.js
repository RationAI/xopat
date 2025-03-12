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
}