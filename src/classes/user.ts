/**
 * Lightweight user instance, mainly for event interaction
 * @class
 * @extends OpenSeadragon.EventSource
 */
export class XOpatUser extends window.OpenSeadragon.EventSource {
    private _id: string | null = null;
    private _name: string = "";
    private _icon: string | null = null;
    private _secret: Record<string, any> = {};
    private _identities: Record<string, { id: string; name: string; icon: string } | undefined> = {};
    private _refreshing: Record<string, Promise<void>> = {};

    /** @static */
    private static __self: XOpatUser | undefined = undefined;

    constructor() {
        super();
        const staticContext = XOpatUser;
        if (staticContext.__self) {
            throw `Trying to instantiate a singleton. Instead, use ${staticContext.name}::instance().`;
        }
        staticContext.__self = this;

        // Note: Using standard DOM selection to replace jQuery style if needed,
        // but preserving the original logic.
        const userPanel = document.getElementById("user-panel");
        if (userPanel) {
            userPanel.addEventListener('click', this.onUserSelect.bind(this));
        }

        this.addHandler(this.getEventName('logout'), () => {
            // @ts-ignore: Legacy global Dialogs
            Dialogs.show('You have been logged out. Please, <a onclick="UTILITIES.refreshPage()">log-in</a> again.',
                50000,
                // @ts-ignore: Legacy global Dialogs
                Dialogs.MSG_ERR);
        });
    }

    /**
     * Login user, if already logged out, logout first. This should be used only
     * for the first login, after that, use setSecret() and getSecret() methods.
     * The state reflects the default core contextId state.
     */
    login(id: string, name: string, icon: string = "", contextId: string | undefined = undefined): void {
        const ctx = this._sanitizeContextId(contextId);

        // Only treat as a global login if context is 'core'
        if (ctx === 'core') {
            if (this.isLogged) throw "User needs to be first logged out!";
            this._id = id;
            this._name = name;
            this.icon = icon;
            try {
                // @ts-ignore: Legacy global UI
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
    logout(contextId: string | undefined = undefined): void {
        if (!this.getIsLogged(contextId)) return;
        const ctx = this._sanitizeContextId(contextId);

        if (ctx === 'core') {
            this._id = null;
            // @ts-ignore: Legacy global jQuery translation
            this._name = $.t('user.anonymous');
            this._secret = {};
            // @ts-ignore: Legacy global UI
            USER_INTERFACE.AppBar.rightMenu.getTab('user').setTitle(this._name);
            this._icon = null;
        } else {
            this._identities[ctx] = undefined;
        }
        this.raiseEvent(this.getEventName('logout', ctx), { contextId: ctx });
    }

    /**
     * Check if user logged in for the default core contextId
     * @return {boolean}
     */
    get isLogged(): boolean {
        return !!this._id;
    }

    /**
     * Check if user logged in for given contextId. If contextId is not set, returns the default core contextId state.
     */
    getIsLogged(contextId: string | undefined = undefined): boolean {
        if (contextId === undefined) {
            return this.isLogged;
        }
        return this._identities[this._sanitizeContextId(contextId)] !== undefined;
    }

    /**
     * Get secret for given type and contextId.
     */
    getSecret(type: string = "jwt", contextId: string | undefined = undefined): any {
        return this._secret && this._secret[this._getContextUniqueKey(type, contextId)];
    }

    /**
     * Set secret for given type and contextId
     */
    setSecret(secret: any, type: string = "jwt", contextId: string | undefined = undefined): void {
        const keyWithCtx = this._getContextUniqueKey(type, contextId);

        // Ensure global HttpClient is accessed safely
        if (!HttpClient?.knowsSecretType(type)) {
            console.warn(`XOpatUser.setSecret: unknown secret type '${type}'! You should register a handler for this type in HTTPClient.`);
        }

        if (secret) {
            this._secret[keyWithCtx] = secret;
            this.raiseEvent(this.getEventName('secret-updated', contextId), { secret, type, contextId });
        } else if (this._secret[keyWithCtx]) {
            delete this._secret[keyWithCtx];
            this.raiseEvent(this.getEventName('secret-removed', contextId), { type, contextId });
        }
    }

    /**
     * Request a secret update for given type and contextId
     */
    async requestSecretUpdate(type: string = "jwt", contextId: string | undefined = undefined): Promise<void> {
        const key = this._getContextUniqueKey(type, contextId);

        // 1. Deduplication: If a refresh is already in flight for this key, return that promise
        if (this._refreshing[key]) return this._refreshing[key];

        this._refreshing[key] = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                delete this._refreshing[key];
                reject('Timeout waiting for secret update');
            }, 20000);

            const onUpdate = (e: any) => {
                if (e.type === type && this._sanitizeContextId(e.contextId) === this._sanitizeContextId(contextId)) {
                    this.removeHandler(this.getEventName('secret-updated', contextId), onUpdate);
                    clearTimeout(timeout);
                    delete this._refreshing[key];
                    resolve();
                }
            };

            // Attach handler BEFORE raising the event to prevent the race condition
            this.addHandler(this.getEventName('secret-updated', contextId), onUpdate);

            // @ts-ignore: Assumes raiseEventAwaiting exists on OpenSeadragon.EventSource
            this.raiseEventAwaiting(this.getEventName('secret-needs-update', contextId), { type, contextId })
                .catch((err: any) => {
                    this.removeHandler(this.getEventName('secret-updated', contextId), onUpdate);
                    delete this._refreshing[key];
                    reject(err);
                });
        });

        return this._refreshing[key];
    }

    get id(): string | null {
        return this._id;
    }

    get name(): string {
        return this._name;
    }

    set icon(icon: string | null) {
        this._icon = icon;
        const iconEl = document.getElementById("user-icon");
        if (iconEl) {
            iconEl.innerHTML = icon || `<i class="fa-auto fa-circle-user btn-pointer"></i>`;
        }
    }

    onUserSelect(): void {
        this.raiseEvent(this.getEventName('user-select'), {
            userId: this._id,
            userName: this._name
        });
    }

    getEventName(name: string, contextId: string | undefined = undefined): string {
        const ctx = this._sanitizeContextId(contextId);
        return ctx === 'core' ? name : `${name}:${ctx}`;
    }

    private _sanitizeContextId(contextId: string | undefined = undefined): string {
        return contextId || 'core';
    }

    private _getContextUniqueKey(type: string, contextId: string | undefined = undefined): string {
        return `${this._sanitizeContextId(contextId)}:${type}`;
    }

    /**
     * Get instance of the singleton
     */
    static instance(): XOpatUser {
        if (!this.__self) {
            this.__self = new this();
        }
        return this.__self;
    }

    /**
     * Check if instantiated
     */
    static instantiated(): boolean {
        return !!this.__self;
    }
}

window.XOpatUser = XOpatUser;