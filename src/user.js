/**
 * Lightweight user instance, mainly for event interaction
 * @class
 * @extends OpenSeadragon.EventSource
 */
class XOpatUser extends OpenSeadragon.EventSource {

    /**
     * Login user, if already logged out, logout first. This should be used only
     * for the first login, after that, use setSecret() and getSecret() methods.
     * The state reflects the default core contextId state.
     * @param id
     * @param name
     * @param icon
     * @param contextId
     */
    login(id, name, icon="", contextId = undefined) {
        const ctx = this._sanitizeContextId(contextId);

        // Only treat as a global login if context is 'core'
        if (ctx === 'core') {
            if (this.isLogged) throw "User needs to be first logged out!";
            this._id = id;
            this._name = name;
            this.icon = icon;
            try {
                USER_INTERFACE.AppBar.rightMenu.getTab('user').setTitle(name);
            } catch (e) { /* ignore UI errors */ }
        } else {
            this._identities[ctx] = { id, name, icon };
        }
        this.raiseEvent(`login:${ctx}`, {
            userId: id,
            userName: name,
            contextId: ctx
        });
    }

    /**
     * Logging out erases __ALL__ secrets, including the default core contextId secret.
     */
    logout(contextId = undefined) {
        if (!this.getIsLogged(contextId)) return;
        const ctx = this._sanitizeContextId(contextId);

        // Only treat as a global login if context is 'core'
        if (ctx === 'core') {
            this._id = null;
            this._name = $.t('user.anonymous');
            this._secret = {};
            USER_INTERFACE.AppBar.rightMenu.getTab('user').setTitle(this.name);
            this.icon = null;
            this.secret = null;
        } else {
            this._identities[ctx] = undefined;
        }
        this.raiseEvent(this.getEventName('logout', ctx), {contextId: ctx});
    }

    /**
     * Check if user logged in for the default core contextId
     * @return {boolean}
     */
    get isLogged() {
        return !!this._id;
    }

    /**
     * Check if user logged in for given contextId. If contextId is not set, returns the default core contextId state.
     * @param contextId
     * @return {boolean}
     */
    getIsLogged(contextId = undefined) {
        if (contextId === undefined) {
            return this.isLogged;
        }
        return this._identities[this._sanitizeContextId(contextId)] !== undefined;
    }

    /**
     * Get secret for given type and contextId. If generic type secret exists but context ID-specific secret is not found,
     * generic secret is returned.
     * @param {string} type - secret type, e.g. 'jwt' or 'basic'. For new types, HTTPClient needs to register a handler
     * @param {string} [contextId] if set, the secret si bound to a given context, see HTTPClient class
     * @return {*} secret
     */
    getSecret(type="jwt", contextId = undefined) {
        return this._secret && this._secret[this._getContextUniqueKey(type, contextId)];
    }

    /**
     * Get secret for given type and contextId
     * @param {any} secret - secret to set, if falsey value, the secret is removed
     * @param {string} type - secret type, e.g. 'jwt' or 'basic'. For new types, HTTPClient needs to register a handler
     * @param {string} [contextId] if set, the secret si bound to a given context, see HTTPClient class
     * @raise secret-updated, secret-removed
     */
    setSecret(secret, type="jwt", contextId = undefined) {
        const keyWithCtx = this._getContextUniqueKey(type, contextId);
        if (!HttpClient.knowsSecretType(type)) {
            console.warn(`XOpatUser.setSecret: unknown secret type '${type}'! You should register a handler for this type in HTTPClient.`);
        }

        if (secret) {
            this._secret[keyWithCtx] = secret;
            this.raiseEvent(this.getEventName('secret-updated', contextId), {secret, type, contextId});
        } else if (this._secret[keyWithCtx]) {
            delete this._secret[keyWithCtx];
            this.raiseEvent(this.getEventName('secret-removed', contextId), {type, contextId});
        }
    }

    /**
     * Request a secret update for given type and contextId
     * @param {string} type - secret type, e.g. 'jwt' or 'basic'. For new types, HTTPClient needs to register a handler
     * @param {string} [contextId] if set, the secret si bound to a given context, see HTTPClient class
     * @raise secret-needs-update
     */
    async requestSecretUpdate(type="jwt", contextId = undefined) {
        const key = this._getContextUniqueKey(type, contextId);

        // 1. Deduplication: If a refresh is already in flight for this key, return that promise
        if (this._refreshing[key]) return this._refreshing[key];

        this._refreshing[key] = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                delete this._refreshing[key];
                reject('Timeout waiting for secret update');
            }, 20000);

            const onUpdate = e => {
                if (e.type === type && this._sanitizeContextId(e.contextId) === this._sanitizeContextId(contextId)) {
                    this.removeHandler(this.getEventName('secret-updated', contextId), onUpdate);
                    clearTimeout(timeout);
                    delete this._refreshing[key];
                    resolve();
                }
            };

            // Attach handler BEFORE raising the event to prevent the race condition
            this.addHandler(this.getEventName('secret-updated', contextId), onUpdate);

            this.raiseEventAwaiting(this.getEventName('secret-needs-update', contextId), {type, contextId})
                .catch(err => {
                    this.removeHandler(this.getEventName('secret-updated', contextId), onUpdate);
                    delete this._refreshing[key];
                    reject(err);
                });
        });

        return this._refreshing[key];
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
        this.raiseEvent(this.getEventName('user-select'), {
            userId: this._id,
            userName: this._name
        });
    }

    getEventName(name, contextId=undefined) {
        const ctx = this._sanitizeContextId(contextId);
        return ctx === 'core' ? name : `${name}:${ctx}`;
    }
    
    // map context ID to 'core' -> default if undefined
    _sanitizeContextId(contextId=undefined) {
        return contextId || 'core';
    }
    
    // get storage key for secrets
    _getContextUniqueKey(type, contextId=undefined) {
        return `${this._sanitizeContextId(contextId)}:${type}`;
    }

    /**
     * Get instance of the singleton
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
        return !!this.__self;
    }

    static __self = undefined;
    constructor() {
        super();
        const staticContext = this.constructor;
        if (staticContext.__self) {
            throw `Trying to instantiate a singleton. Instead, use ${staticContext.name}::instance().`;
        }
        this._secret = {};
        this._identities = {};
        this._refreshing = {};
        staticContext.__self = this;
        $("#user-panel").on('click', this.onUserSelect.bind(this));
        this.addHandler(this.getEventName('logout'), () => {
            Dialogs.show('You have been logged out. Please, <a onclick="UTILITIES.refreshPage()">log-in</a> again.',
                50000, Dialogs.MSG_ERR);
        });
    }
}
