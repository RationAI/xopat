/**
 * Lightweight user instance, mainly for event interaction
 * @class
 * @extends OpenSeadragon.EventSource
 */
class XOpatUser extends OpenSeadragon.EventSource {

    login(id, name, icon="") {
        if (this.isLogged) throw "User needs to be first logged out!";

        if (!id) {
            throw "XOpatUser.login user ID not supplied!";
        }
        this._id = id;
        this._name = name;
        this._secret = {};
        USER_INTERFACE.AppBar.rightMenu.getTab('user').setTitle(name);

        this.icon = icon;
        this.raiseEvent('login', {
            userId: id,
            userName: name
        });
    }

    logout() {
        if (!this.isLogged) return;
        this._id = null;
        this._name = $.t('user.anonymous');
        this._secret = {};
        USER_INTERFACE.AppBar.rightMenu.getTab('user').setTitle(this.name);
        this.icon = null;
        this.secret = null;
        this.raiseEvent('logout', null);
    }

    get isLogged() {
        return !!this._id;
    }

    /**
     * Get secret for given type and contextId. If generic type secret exists but context ID-specific secret is not found,
     * generic secret is returned.
     * @param {string} type - secret type, e.g. 'jwt' or 'basic'. For new types, HTTPClient needs to register a handler
     * @param {string} [contextId] if set, the secret si bound to a given context, see HTTPClient class
     * @return {*} secret
     */
    getSecret(type="jwt", contextId = undefined) {
        const keyWithCtx = contextId ? `${type}:${contextId}` : type;
        return this._secret && (this._secret[keyWithCtx] || this._secret[type]);
    }

    /**
     * Get secret for given type and contextId
     * @param {any} secret - secret to set, if falsey value, the secret is removed
     * @param {string} type - secret type, e.g. 'jwt' or 'basic'. For new types, HTTPClient needs to register a handler
     * @param {string} [contextId] if set, the secret si bound to a given context, see HTTPClient class
     * @raise secret-updated, secret-removed
     */
    setSecret(secret, type="jwt", contextId = undefined) {
        if (!this.isLogged) throw "User needs to be first logged in to set a secret!";
        this._secret = this._secret || {};
        const keyWithCtx = contextId ? `${type}:${contextId}` : type;
        if (!HttpClient.knowsSecretType(type)) {
            console.warn(`XOpatUser.setSecret: unknown secret type '${type}'! You should register a handler for this type in HTTPClient.`);
        }
        if (secret) {
            this._secret[keyWithCtx] = secret;
            this.raiseEvent('secret-updated', {secret, type, contextId});
        } else if (this._secret[keyWithCtx]) {
            delete this._secret[keyWithCtx];
            this.raiseEvent('secret-removed', {type, contextId});
        }
    }

    /**
     * Request a secret update for given type and contextId
     * @param {string} type - secret type, e.g. 'jwt' or 'basic'. For new types, HTTPClient needs to register a handler
     * @param {string} [contextId] if set, the secret si bound to a given context, see HTTPClient class
     * @raise secret-needs-update
     */
    async requestSecretUpdate(type="jwt", contextId = undefined) {
        const awaitToken = new Promise((resolve, reject) => {
            let timeout = setTimeout(() => reject('Timeout waiting for secret update'), 20000);
            this.addOnceHandler('secret-updated', e => {
                if (e.type === type) {
                    clearTimeout(timeout);
                    resolve();
                }
            });
            this.addOnceHandler('secret-removed', e => {
                if (e.type === type) {
                    clearTimeout(timeout);
                    reject('Secret removed.');
                }
            });
        });
        await VIEWER.raiseEventAwaiting('secret-needs-update', {type, contextId});
        return awaitToken;
    }

    get id() {
        return this._id;
    }

    get name() {
        return this._name;
    }

    set icon(icon) {
        $("#user-icon").html(icon || `<i class="fa-auto fa-circle-user btn-pointer"></i>`);
    }

    onUserSelect() {
        this.raiseEvent('user-select', {
            userId: id,
            userName: name
        });
    }

    /**
     * Get instance of the annotations manger, a singleton
     * (only one instance can run since it captures mouse events)
     * @static
     * @return {XOpatUser} manager instance
     */
    static instance() {
        //this calls sub-class constructor, no args required
        this.__self = this.__self || new this();
        return this.__self;
    }

    /**
     * Check if instantiated
     * @return {boolean}
     */
    static instantiated() {
        return this.__self && true; //retype
    }

    static __self = undefined;
    constructor() {
        super();
        const staticContext = this.constructor;
        if (staticContext.__self) {
            throw `Trying to instantiate a singleton. Instead, use ${staticContext.name}::instance().`;
        }
        staticContext.__self = this;
        $("#user-panel").on('click', this.onUserSelect.bind(this));
        this.addHandler('logout', () => {
            Dialogs.show('You have been logged out. Please, <a onclick="UTILITIES.refreshPage()">log-in</a> again.',
                50000, Dialogs.MSG_ERR);
        });
    }
}
