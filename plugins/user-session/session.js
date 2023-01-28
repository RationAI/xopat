addPlugin("user-session", class extends XOpatPlugin {
    constructor(id, params) {
        super(id);
        this.server = this.getStaticMeta('server');
        this.headers = this.getStaticMeta('headers');
        this.sessionReferenceFile = params.referenceFile || "";

        this.enabled = this.sessionReferenceFile && this.server && true; //retype
    }

    pluginReady() {
        if (this.enabled) {
            USER_INTERFACE.MainMenu.append(
                "Session Store",
                `<span class="material-icons pointer" title="Save session" style="text-align:right; vertical-align:sub;float: right;" onclick="${this.THIS}.export();">save</span>`,
                '',
                "user-session-panel",
                this.id
            );

            //record visiting to the endpoint
            UTILITIES.fetchJSON(this.server, {
                ajax: "setSeen", //todo not flexible :/
                user: APPLICATION_CONTEXT.metadata.getUser(),
                filename: this.sessionReferenceFile
            }, this.headers, false).then(response => {
                //ignore whatever response
            }).catch(e => {
                console.warn("Adding record of viewed tissue failed!", e);
            });

        } else {
            USER_INTERFACE.MainMenu.append(
                "Session Store",
                `<span class="material-icons pointer" title="Not available" style="text-decoration: line-through; text-align:right; vertical-align:sub;float: right;" onclick="${this.THIS}.export();">save</span>`,
                '',
                "user-session-panel",
                this.id
            );
        }
    }

    async export() {
        if (!this.enabled) {
            console.warn("Cannot save the session: no target WSI found.");
            Dialogs.show("Cannot save the session: no target WSI found.", 2500, Dialogs.MSG_WARN);
        } else {
            UTILITIES.fetchJSON(this.server, {
                ajax: "storeSession", //todo not flexible :/
                user: APPLICATION_CONTEXT.metadata.getUser(),
                filename: this.sessionReferenceFile,
                session: await UTILITIES.getForm()
            }, this.headers, false).then(response => {
                //todo not flexible :/
                if (response?.status !== "success") throw new HTTPError(response.message, response, response.error);
                Dialogs.show("Saved", 1500, Dialogs.MSG_INFO);
            }).catch(e => {
                console.warn("Failed to save export to server.", e);
                Dialogs.show("Failed to save the session!", 2500, Dialogs.MSG_ERR);
            });
        }
    }
});
