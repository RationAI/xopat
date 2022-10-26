addPlugin("user-session", class {
    constructor(id, params) {
        this.id = id;
        this.PLUGIN = `plugin('${id}')`;
        this.server = this.staticData('server');
        this.headers = this.staticData('headers');
        this.sessionReferenceFile = params.referenceFile || "";

        this.enabled = this.sessionReferenceFile && this.server && true; //retype
    }

    pluginReady() {
        if (this.enabled) {
            $("#shaders").parent().append(`
<span class="material-icons pointer" title="Save session" style="text-align:right; vertical-align:sub;float: right;" onclick="${this.PLUGIN}.export();">save</span>`);
        } else {
            $("#navigator-container").parent().append(`
<span class="material-icons pointer" title="Not available" style="text-decoration: line-through; text-align:right; vertical-align:sub;float: right;" onclick="${this.PLUGIN}.export();">save</span>`);
        }
    }

    export() {
        if (!this.enabled) {
            console.warn("Cannot save the session: no target WSI found.");
            Dialogs.show("Cannot save the session: no target WSI found.", 2500, Dialogs.MSG_WARN);
        } else {
            UTILITIES.fetchJSON(this.server, {
                ajax: "storeSession", //todo not flexible :/
                filename: this.sessionReferenceFile,
                session: UTILITIES.getForm()
            }, this.headers).then(response => {
                //todo response check for success?
                Dialogs.show("Saved", 1500, Dialogs.MSG_INFO);
            }).catch(e => {
                console.warn("Failed to save export to server.", e);
                Dialogs.show("Failed to save the session!", 2500, Dialogs.MSG_ERR);
            });
        }
    }
});
