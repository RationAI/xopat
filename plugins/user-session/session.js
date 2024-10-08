addPlugin("user-session", class extends XOpatPlugin {
    constructor(id) {
        super(id);
        this.authServer = this.getStaticMeta('authServer');
        this.performAuthServer = this.getStaticMeta('performAuth');
        this.storeSessionServer = this.getStaticMeta('sessionServer');
        this.headers = this.getStaticMeta('headers');
        this.authenticated = false;
    }

    pluginReady() {
        //todo this code is duplicated
        this.setupActiveTissue(APPLICATION_CONTEXT.config.background[APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0)]);

        this.authenticate();

        const _this = this;
        VIEWER.addHandler('background-image-swap', e => {
            _this.setupActiveTissue(e.backgroundSetup);
        });
    }

    setupActiveTissue(bgImageConfigObject) {
        if (!bgImageConfigObject) this.activeTissue = null;
        else this.activeTissue = APPLICATION_CONTEXT.config.data[bgImageConfigObject.dataReference];
    }

    authenticate(repeatedLogin=true) {
        if (!this.authServer || this.authenticated) {
            this._finishNoAuth();
            return; //todo message
        }

        const _this = this;
        UTILITIES.fetchJSON(this.authServer, {}, this.headers).then(response => {
                //todo not flexible:
            if (response.status === "success") {
                _this._finishAuthOk(response);
                if (!repeatedLogin) Dialogs.show("Logged in!", 5000, Dialogs.MSG_OK);
            } else if (repeatedLogin) {
                _this.performAuth();
            } else {
                _this._finishAuthFail();
            }
        }).catch(e => {
            if (repeatedLogin) _this.performAuth();
            else _this._finishAuthFail();
        });
    }

    requestAuth() {
        Dialogs.show(`Your login has timed out. Please, <a class="pointer" onclick="plugin('${this.id}').performAuth(false);">login again.</a>`, 10000, Dialogs.MSG_WARN);
    }

    performAuth(ask=true) {
        if (!this.performAuthServer || this.authenticated) {
            Dialogs.show("Unable to log-in: the viewer is not able to do it.", 5000, Dialogs.MSG_ERR);
            return;
        }
        const _this = this;
        const theWindow = window.open(this.performAuthServer,
            'authenticate-user', "height=550,width=850");
        if (theWindow) {
            theWindow.addEventListener('unload',function(){
                setTimeout(() => {
                    //continue only when closed
                    if (!theWindow?.name) _this.authenticate(false);
                }, 1000)
            });
            theWindow.focus();
            _this._finishAuthFail();
        } else if (ask) {
            this.requestAuth();
            _this._finishAuthFail();
        } else {
            Dialogs.show("Unable to log-in: the viewer is not able to do it.", 5000, Dialogs.MSG_ERR);
            _this._finishAuthFail();
        }
    }

    _finishNoAuth() {
        if (this.activeTissue && this.storeSessionServer) {
            USER_INTERFACE.MainMenu.replace(
                `Session store`,
                `<span class="btn-pointer" title="Store your workplace on the server." 
style="text-align:right; vertical-align:sub;float: right;" onclick="${this.THIS}.export();">
Save Session: <span class="material-icons">save</span></span>`,
                '',
                "user-session-panel",
                this.id
            );
        }
    }

    //todo implement new auth flow
    _finishAuthOk(response) {
        USER_INTERFACE.MainMenu.replace(
            `User &nbsp;<span class="f3-light">${XOpatUser.instance().name}</span>`,
            this.activeTissue && this.storeSessionServer ? `<span class="btn-pointer" title="Store your workplace on the server." 
style="text-align:right; vertical-align:sub;float: right;" onclick="${this.THIS}.export();">
Save Session: <span class="material-icons">save</span></span>` : "",
            '',
            "user-session-panel",
            this.id
        );
    }

    _finishAuthFail() {
        USER_INTERFACE.MainMenu.replace(
            "Not logged in!",
            this.activeTissue && this.storeSessionServer ? `<span title="Session storing not available!." 
style="text-align:right; text-decoration: line-through; vertical-align:sub;float: right;">Save Session: 
<span class="material-icons">save</span></span>` : "",
            `Some services might not work. <a class="pointer" onclick="plugin('${this.id}').performAuth(false);">Log-in.</a>`,
            "user-session-panel",
            this.id
        );
    }

    async viewerToHTML() {
        return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><title>Visualization export</title></head>
<body>
${await UTILITIES.getForm()}
</body></html>`;
    }

    async export() {
        if (!this.storeSessionServer) {
            console.warn("Cannot save the session: no target WSI found.");
            Dialogs.show("Cannot save the session: no target WSI found.", 2500, Dialogs.MSG_WARN);
        } else {
            const exporter = this.getStaticMeta("exportHTML") ? this.viewerToHTML : UTILITIES.serializeApp;

            UTILITIES.fetchJSON(this.storeSessionServer, {
                data: await exporter(),
                tissue: this.activeTissue
            }, this.headers).then(response => {
                if (response?.status !== "success") throw new HTTPError(response.message, response, response.error);

                if (response.url) {
                    UTILITIES.copyToClipboard(response.url);
                    Dialogs.show("Url saved in your clipboard.", 1500, Dialogs.MSG_INFO);
                } else {
                    Dialogs.show("Saved", 1500, Dialogs.MSG_INFO);
                }
            }).catch(e => {
                console.warn("Failed to save export to server.", e);
                Dialogs.show("Failed to save the session!", 2500, Dialogs.MSG_ERR);
            });
        }
    }
});
