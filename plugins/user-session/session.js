addPlugin("user-session", class {
    constructor(id, params) {
        this.id = id;
        this.PLUGIN = `plugin('${id}')`;
        this.server = this.staticData('server');
        this.headers = this.staticData('headers');
    }

    pluginReady() {
        $("#navigator-container").append(`
<span class="material-icons pointer" onclick="${this.PLUGIN}.export();">save</span>        
        `);
    }

    export() {
        UTILITIES.fetchJSON(this.server, {
            filename: "",//todo
            session: UTILITIES.getForm()
        }, this.headers);
    }
});
