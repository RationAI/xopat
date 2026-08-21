import {
    CapabilityRegistry,
    type CapabilityDescriptor,
    type RoleDescriptor,
    type RolesEnvConfig,
    diffEffective,
    resolveCapabilities,
} from "./user-roles-core";

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
    /**
     * Per-secret budget for {@link requestSecretUpdate}. Deduplicating only the
     * IN-FLIGHT attempt is not enough: a provider that cannot re-provision right now
     * still cannot a second later, while every failing request keeps asking. In one
     * captured session that turned three request bursts into three full identity
     * -provider round trips, each several seconds long, with nothing to show for it.
     */
    private _refreshBudget: Record<string, { lastAt: number; failures: number }> = {};

    // ── roles & capabilities (see src/USER_ROLES.md) ────────────────────
    /** Currently assigned roles, in declaration order. Recomputed on assignRoles. */
    private _roles: string[] = [];
    /** Effective capability map cached for fast `can()` reads. */
    private _effective: Record<string, boolean> = {};

    /**
     * Minimum spacing between two {@link requestSecretUpdate} attempts for the same
     * secret after an unsuccessful one. Long enough that a burst of failing requests
     * cannot walk around it, short enough that a genuinely transient outage recovers
     * within one user's patience.
     */
    static REFRESH_COOLDOWN_MS = 60 * 1000;
    /**
     * Consecutive failed refresh attempts after which core stops asking the provider
     * altogether. A credential landing (`setSecret`) clears it — including one
     * obtained through an interactive login, which is what the interaction gate is for.
     */
    static MAX_REFRESH_FAILURES = 2;

    /** Process-global capability registry. Shared across all instances. */
    private static readonly _capRegistry = new CapabilityRegistry();
    /** Live env config snapshot — populated by `configureRoles(...)` at boot. */
    private static _envConfig: RolesEnvConfig = {};

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

        this.addHandler(this.getEventName('logout'), (e: any) => {
            // An identity swap (login() replacing a different user) emits the same
            // event so state resets run, but it is not a logout the user should be
            // told to recover from.
            if (e?.switching) return;
            // @ts-ignore: Legacy global Dialogs
            Dialogs.show($.t('user.loggedOut'),
                50000,
                // @ts-ignore: Legacy global Dialogs
                Dialogs.MSG_ERR);
        });

        // Recompute capabilities whenever a new one is declared (lazy plugin load).
        XOpatUser._capRegistry.onDeclared(() => this._recomputeEffective([]));

        // Apply the deployment default role(s) immediately so calls to `can(...)`
        // before any rights-resolver plugin runs still answer correctly.
        this._roles = (XOpatUser._envConfig.default ?? []).slice();
        this._recomputeEffective([]);

        // On any logout, revert role assignments to the deployment default.
        this.addHandler(this.getEventName('logout'), () => {
            this.assignRoles(XOpatUser._envConfig.default ?? []);
        });
    }

    /**
     * Login user. Idempotent for the core context: re-asserting the identity that
     * is already logged in only refreshes the display data, and logging in a
     * *different* identity logs the previous one out first. This should be used
     * only for the first login, after that, use setSecret() and getSecret().
     * The state reflects the default core contextId state.
     */
    login(id: string, name: string, icon: string = "", contextId: string | undefined = undefined): void {
        const ctx = this._sanitizeContextId(contextId);

        // Only treat as a global login if context is 'core'
        if (ctx === 'core') {
            if (this.isLogged) {
                if (this._id === id) {
                    // Same identity re-asserted (e.g. every OIDC silent renew raises
                    // `userLoaded`). Refresh the display data and bail — throwing here
                    // used to reject the auth library's awaited handler and cascade
                    // into a bogus "login failed" dialog.
                    this._name = name;
                    this.icon = icon;
                    return;
                }
                // Identity swap: log the previous one out first, as documented above.
                this._clearCoreIdentity();
                this.raiseEvent(this.getEventName('logout', ctx), { contextId: ctx, switching: true });
            }
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
        // Uniform event naming: getEventName collapses the core context (empty /
        // 'core') to the bare name `login`, and yields `login:<ctx>` otherwise —
        // exactly like logout/secret-updated/etc. below. (A prior change raised a
        // hardcoded `login:${ctx}` = `login:core` for core, which diverged from
        // the resolver and silently broke bare-`login` listeners such as the
        // appbar user-title handler in ui/services/appBar.mjs.)
        this.raiseEvent(this.getEventName('login', ctx), {
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
            this._clearCoreIdentity();
        } else {
            this._identities[ctx] = undefined;
            // Drop this context's secrets too. Clearing only the identity left a
            // live bearer token in `_secret["<ctx>:<type>"]`, which HttpClient kept
            // attaching until it expired — a logged-out user still authenticating.
            this._clearContextSecrets(ctx);
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
        // The core identity lives in `_id`, never in `_identities` — resolve the
        // context the same way login()/logout() do. Callers routed through
        // XOpatAuth get the canonicalized literal 'core' (not undefined), and
        // reading `_identities['core']` reported "logged out" while logged in.
        const ctx = this._sanitizeContextId(contextId);
        if (ctx === 'core') {
            return this.isLogged;
        }
        return this._identities[ctx] !== undefined;
    }

    /**
     * The user id bound to a context, or null when that context is logged out.
     * Auth modules need this to tell "same subject re-asserted" (a token refresh)
     * from "different subject" (an account switch at the IdP) — the latter must
     * re-`login()` so the displayed identity and the attached secret cannot drift
     * apart.
     */
    getUserId(contextId: string | undefined = undefined): string | null {
        const ctx = this._sanitizeContextId(contextId);
        if (ctx === 'core') return this._id;
        return this._identities[ctx]?.id ?? null;
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
            // A credential landing is the only proof the provider works again, so it
            // is what re-arms the refresh budget below.
            delete this._refreshBudget[keyWithCtx];
            this.raiseEvent(this.getEventName('secret-updated', contextId), { secret, type, contextId });
        } else if (this._secret[keyWithCtx]) {
            delete this._secret[keyWithCtx];
            this.raiseEvent(this.getEventName('secret-removed', contextId), { type, contextId });
        }
    }

    /**
     * Request a secret update for given type and contextId.
     *
     * Rejects immediately when no auth module listens for `secret-needs-update`
     * on that context — otherwise every 401 retry would sit on the timeout before
     * discovering there is nobody to provision a credential.
     *
     * Attempts are BUDGETED per secret (see {@link XOpatUser.REFRESH_COOLDOWN_MS} /
     * {@link XOpatUser.MAX_REFRESH_FAILURES}): several failing requests share one
     * attempt, a fresh attempt waits out a cooldown, and a provider that failed
     * repeatedly is left alone until a credential lands. Without that, one
     * unauthenticated context turned every background request into another identity
     * -provider round trip for the rest of the session — and the caller paid the
     * full `timeoutMs` each time instead of seeing the upstream's own error.
     */
    async requestSecretUpdate(type: string = "jwt", contextId: string | undefined = undefined,
                              timeoutMs: number = 20000): Promise<void> {
        const key = this._getContextUniqueKey(type, contextId);

        // 1. Deduplication: If a refresh is already in flight for this key, return that promise
        if (this._refreshing[key]) return this._refreshing[key];

        const budget = this._refreshBudget[key];
        if (budget) {
            if (budget.failures >= XOpatUser.MAX_REFRESH_FAILURES) {
                return Promise.reject(new Error(
                    `XOpatUser.requestSecretUpdate: giving up on '${key}' after ` +
                    `${budget.failures} failed refresh attempts — the provider cannot re-provision it ` +
                    `without user interaction. A successful login re-arms this.`
                ));
            }
            const waited = Date.now() - budget.lastAt;
            if (waited < XOpatUser.REFRESH_COOLDOWN_MS) {
                return Promise.reject(new Error(
                    `XOpatUser.requestSecretUpdate: '${key}' was refreshed unsuccessfully ` +
                    `${Math.round(waited / 1000)}s ago; waiting out the cooldown before asking again.`
                ));
            }
        }

        const needsUpdateEvent = this.getEventName('secret-needs-update', contextId);
        // @ts-ignore: OpenSeadragon.EventSource
        if (this.numberOfHandlers(needsUpdateEvent) < 1) {
            return Promise.reject(new Error(
                `XOpatUser.requestSecretUpdate: no provider listens for '${needsUpdateEvent}' ` +
                `(type '${type}', context '${this._sanitizeContextId(contextId)}') — nothing can refresh this secret.`
            ));
        }

        // Counted BEFORE the attempt: a failure may arrive as a rejection, a timeout,
        // or (for a provider that answers without providing anything) not at all.
        // `setSecret` clears the entry, so only unsuccessful attempts accumulate.
        this._refreshBudget[key] = { lastAt: Date.now(), failures: (budget?.failures ?? 0) + 1 };

        this._refreshing[key] = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                delete this._refreshing[key];
                reject('Timeout waiting for secret update');
            }, timeoutMs);

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
            this.raiseEventAwaiting(needsUpdateEvent, { type, contextId })
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

    /**
     * Remove every secret bound to a non-core context, announcing each removal so
     * listeners (HttpClient consumers, settle logic) see it. Core logout wipes
     * `_secret` wholesale instead — see {@link _clearCoreIdentity}.
     */
    private _clearContextSecrets(ctx: string): void {
        const prefix = `${ctx}:`;
        for (const key of Object.keys(this._secret || {})) {
            if (!key.startsWith(prefix)) continue;
            const type = key.slice(prefix.length);
            delete this._secret[key];
            // Signing out is a deliberate act, not a failed refresh: the next attempt
            // for this context starts from a clean budget.
            delete this._refreshBudget[key];
            this.raiseEvent(this.getEventName('secret-removed', ctx), { type, contextId: ctx });
        }
    }

    /**
     * Reset the core identity + all secrets. Shared by logout('core') and by the
     * identity-swap branch of login(), so both paths clear exactly the same state.
     * Raising the `logout` event is left to the caller — the swap path tags it
     * `switching: true` so the "you have been logged out" dialog stays silent.
     */
    private _clearCoreIdentity(): void {
        this._id = null;
        // @ts-ignore: Legacy global jQuery translation
        this._name = $.t('user.anonymous');
        this._secret = {};
        this._refreshBudget = {};
        try {
            // @ts-ignore: Legacy global UI
            USER_INTERFACE.AppBar.rightMenu.getTab('user').setTitle(this._name);
        } catch (e) { /* ignore UI errors */ }
        this._icon = null;
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

    // ── roles & capabilities API ─────────────────────────────────────────
    // Full design in src/USER_ROLES.md.

    /**
     * Configure the deployment-level roles block at boot. Called once by
     * the application bootstrap with `ENV.core.roles`. If never called, all
     * capabilities fall back to their declared defaults.
     */
    static configureRoles(env: RolesEnvConfig | undefined): void {
        XOpatUser._envConfig = env ? { ...env } : {};
        if (XOpatUser.__self) {
            XOpatUser.__self.assignRoles(XOpatUser._envConfig.default ?? []);
        }
    }

    /** Register a capability gate. Called by the loader for each include.json declaration. */
    static declareCapability(desc: CapabilityDescriptor): boolean {
        const ok = XOpatUser._capRegistry.declare(desc);
        if (ok && XOpatUser.__self) {
            // raise the event on the instance so consumers can subscribe lazily
            XOpatUser.__self.raiseEvent('capability-declared', { id: desc.id, declaredBy: desc.declaredBy });
        }
        return ok;
    }

    /** Remove all capabilities declared by an owner (e.g. on plugin unload). */
    static undeclareCapabilities(ownerId: string): string[] {
        const removed = XOpatUser._capRegistry.undeclareAll(ownerId);
        if (removed.length && XOpatUser.__self) XOpatUser.__self._recomputeEffective([]);
        return removed;
    }

    /** All currently declared capabilities. Snapshot — safe to iterate. */
    static listCapabilities(): CapabilityDescriptor[] {
        return XOpatUser._capRegistry.list();
    }

    /** Definition of a single capability, if declared. */
    static describeCapability(id: string): CapabilityDescriptor | undefined {
        return XOpatUser._capRegistry.get(id);
    }

    /** Role catalog from env config. Snapshot. */
    static listRoles(): RoleDescriptor[] {
        const defs = XOpatUser._envConfig.definitions ?? {};
        return Object.keys(defs).map(id => ({ id, ...defs[id] }));
    }

    /** Definition of a single role, if defined in env. */
    static describeRole(id: string): RoleDescriptor | undefined {
        const def = XOpatUser._envConfig.definitions?.[id];
        return def ? { id, ...def } : undefined;
    }

    /** True iff the current user is granted this capability. */
    can(capabilityId: string): boolean {
        // Unknown capability id → default to allow (don't accidentally lock UI
        // when role config references something not present in this deployment).
        const known = XOpatUser._capRegistry.has(capabilityId);
        if (!known) return true;
        return this._effective[capabilityId] !== false;
    }

    /** Inverse of `can()`. Sugar for readability. */
    cannot(capabilityId: string): boolean { return !this.can(capabilityId); }

    /** Currently assigned roles, in array order (does not include inherited parents). */
    currentRoles(): string[] { return this._roles.slice(); }

    /** Replace the assigned role set. Triggers recomputation; emits diff events. */
    assignRoles(roles: string[]): void {
        const next = Array.isArray(roles) ? roles.filter(r => typeof r === "string") : [];
        const previous = this._roles.slice();
        // Cheap equality short-circuit so resolver plugins can be idempotent.
        if (next.length === previous.length && next.every((r, i) => r === previous[i])) return;
        this._roles = next;
        this.raiseEvent('roles-changed', { roles: next.slice(), previous });
        this._recomputeEffective(previous);
    }

    /** Add a single role if not already present. */
    addRole(role: string): void {
        if (this._roles.includes(role)) return;
        this.assignRoles([...this._roles, role]);
    }

    /** Remove a single role if present. */
    removeRole(role: string): void {
        if (!this._roles.includes(role)) return;
        this.assignRoles(this._roles.filter(r => r !== role));
    }

    /** Revert to the deployment default role set. */
    clearRoles(): void {
        this.assignRoles(XOpatUser._envConfig.default ?? []);
    }

    private _recomputeEffective(previousRoles: string[]): void {
        const prev = this._effective;
        this._effective = resolveCapabilities({
            capabilities: XOpatUser._capRegistry.list(),
            assignedRoles: this._roles,
            definitions: XOpatUser._envConfig.definitions ?? {},
        });
        const changed = diffEffective(prev, this._effective);
        if (changed.length) {
            this.raiseEvent('capabilities-changed', { changed });
        }
    }
}

window.XOpatUser = XOpatUser;