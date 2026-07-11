// Core auth broker — sibling to XOpatUser, reached as `APPLICATION_CONTEXT.auth`.
//
// XOpatUser holds per-context identity + secrets (getIsLogged / getSecret /
// setSecret, events `login:<ctx>` / `secret-updated:<ctx>`). XOpatAuth is the
// registry + orchestration on top: it knows HOW to obtain a login for a named
// context via a pluggable *broker* (OIDC today; SAML or others later). Core is
// deliberately method-agnostic — brokers REGISTER INTO it (inversion of
// control), so no OIDC/SAML specifics live here. A module (e.g. oidc-client-ts)
// registers its broker; any feature can then require login for a context via
// `configureContext(...)` + `isAuthenticated(...)` / `login(...)`.
//
// See src/AUTH.md.

/**
 * An auth mechanism implementation (OIDC, SAML, …). Registered under a `method`
 * name via {@link XOpatAuth.registerBroker}. All methods receive the resolved
 * per-context config. Brokers are expected to store the resulting identity/token
 * in `XOpatUser` under the same `contextId` (type `"jwt"`), so the defaults here
 * work even when a method is not implemented.
 */
export interface AuthBroker {
    /** Idempotent per-context setup; also processes a returning redirect callback. */
    init?(contextId: string, config: any): void | Promise<void>;
    /** Trigger an interactive login. May not resolve in-page (redirect unloads). */
    login(contextId: string, config: any): void | Promise<void>;
    logout?(contextId: string, config: any): void | Promise<void>;
    isAuthenticated?(contextId: string, config: any): boolean;
    /** The token to send to our own server for verification (see tokenForServer). */
    getToken?(contextId: string, config: any): any;
}

/** How a named auth context authenticates. Declared by the consuming feature. */
export interface AuthContextConfig {
    /** Unique context id — also the XOpatUser sub-context and RPC verifier key. */
    contextId: string;
    /** Registered broker method, e.g. "oidc". */
    method: string;
    /** Method-specific config (e.g. the OIDC block: authority/client_id/scope). */
    config?: any;
    /** Human label shown by the broker during login. */
    serviceName?: string;
    /** Which token the broker exposes to our server ("access_token" | "id_token"). */
    tokenForServer?: string;
    /** Mark this context as the MAIN viewer identity (updates the appbar user +
     *  the default XOpatUser context). The `"core"` context id implies this. */
    isMain?: boolean;
    /** Trigger interactive login automatically at startup when not authenticated. */
    autoLogin?: boolean;
    [key: string]: any;
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const EVENT_BASES = ["login", "logout", "secret-updated", "secret-removed"] as const;

export class XOpatAuth {
    private _brokers = new Map<string, AuthBroker>();
    private _contexts = new Map<string, AuthContextConfig>();
    private _initialized = new Set<string>();
    private _subscribed = new Set<string>();
    private _listeners = new Set<(contextId: string) => void>();

    /** Resolve the XOpatUser singleton lazily (it may not exist at construction). */
    private _user(): any {
        return (window as any).XOpatUser?.instance?.();
    }

    /**
     * Canonicalize a context id. The default/main context may be written as an
     * empty string, null, or omitted in JSON config/sessions (or the explicit
     * literal `"core"`) — all of these collapse to `"core"`, matching
     * `XOpatUser._sanitizeContextId`. Normalizing here (not per-caller) is what
     * guarantees a JSON `""`/`null` default context is treated as the MAIN
     * identity and fires the bare `login`/`secret-updated` events. Sub-context
     * ids (e.g. `"anthropic"`) pass through unchanged.
     */
    private _ctx(contextId?: string | null): string {
        // Mirror XOpatUser._sanitizeContextId EXACTLY (`contextId || 'core'`) so the
        // two never disagree on which key holds the identity/secret/events.
        return contextId || "core";
    }

    /**
     * Register an auth mechanism. Any context already declared for this method is
     * initialized now (brokers can load after `configureContext`).
     */
    registerBroker(method: string, broker: AuthBroker): void {
        if (!method || !broker) throw new Error("XOpatAuth.registerBroker: method and broker are required.");
        this._brokers.set(method, broker);
        for (const cfg of this._contexts.values()) {
            if (cfg.method === method && !this._initialized.has(cfg.contextId)) {
                void this.initContext(cfg.contextId);
            }
        }
    }

    hasBroker(method: string): boolean { return this._brokers.has(method); }
    hasContext(contextId: string): boolean { return this._contexts.has(this._ctx(contextId)); }
    getContextConfig(contextId: string): AuthContextConfig | undefined { return this._contexts.get(this._ctx(contextId)); }

    /**
     * Declare how a context authenticates. Idempotent; re-declaring updates the
     * config. Initializes the broker for that context if it is already registered.
     * The context id is canonicalized (`""`/`null`/omitted/`"core"` → `"core"`).
     */
    async configureContext(cfg: AuthContextConfig): Promise<void> {
        if (!cfg || !cfg.method) {
            throw new Error("XOpatAuth.configureContext: method is required.");
        }
        const contextId = this._ctx(cfg.contextId);
        // Store under the canonical id, and record whether this is the main
        // identity so brokers don't each re-derive it from the raw id.
        const isMain = cfg.isMain === true || contextId === "core";
        this._contexts.set(contextId, { ...cfg, contextId, isMain });
        this._subscribeContext(contextId);
        if (this._brokers.has(cfg.method)) {
            await this.initContext(contextId);
        }
        // Otherwise the broker will init this context when it registers.
    }

    /** Idempotent broker init for a context (processes a returning redirect). */
    async initContext(contextId: string): Promise<void> {
        contextId = this._ctx(contextId);
        if (this._initialized.has(contextId)) return;
        const cfg = this._contexts.get(contextId);
        if (!cfg) return;
        const broker = this._brokers.get(cfg.method);
        if (!broker) return;
        this._initialized.add(contextId);
        this._subscribeContext(contextId);
        try {
            await broker.init?.(contextId, cfg);
        } catch (e) {
            this._initialized.delete(contextId);
            console.warn(`XOpatAuth: init of context '${contextId}' failed`, e);
        }
    }

    isAuthenticated(contextId: string): boolean {
        contextId = this._ctx(contextId);
        const cfg = this._contexts.get(contextId);
        const broker = cfg && this._brokers.get(cfg.method);
        if (broker && broker.isAuthenticated) {
            try { return !!broker.isAuthenticated(contextId, cfg); } catch { /* fall through to default */ }
        }
        const user = this._user();
        return !!user && !!user.getIsLogged(contextId) && !!user.getSecret("jwt", contextId);
    }

    /** The token to attach to our own server calls for this context. */
    getToken(contextId: string): any {
        contextId = this._ctx(contextId);
        const cfg = this._contexts.get(contextId);
        const broker = cfg && this._brokers.get(cfg.method);
        if (broker && broker.getToken) {
            try { return broker.getToken(contextId, cfg); } catch { /* fall through */ }
        }
        return this._user()?.getSecret("jwt", contextId);
    }

    /**
     * Interactive login for a context. Returns whether the context ended up
     * authenticated. Completion is detected via XOpatUser events, because the
     * redirect flow unloads the page and never resolves the broker's promise.
     */
    async login(contextId: string): Promise<boolean> {
        contextId = this._ctx(contextId);
        const cfg = this._contexts.get(contextId);
        if (!cfg) throw new Error(`XOpatAuth.login: context '${contextId}' is not configured.`);
        const broker = this._brokers.get(cfg.method);
        if (!broker) {
            throw new Error(`XOpatAuth.login: no auth broker registered for method '${cfg.method}' (context '${contextId}').`);
        }

        await this.initContext(contextId);
        if (this.isAuthenticated(contextId)) return true;

        const settled = this._awaitAuth(contextId, LOGIN_TIMEOUT_MS);
        try {
            await broker.login(contextId, cfg);
        } catch (e) {
            console.warn(`XOpatAuth: login for '${contextId}' errored`, e);
        }
        await settled.catch(() => {});
        return this.isAuthenticated(contextId);
    }

    async logout(contextId: string): Promise<void> {
        contextId = this._ctx(contextId);
        const cfg = this._contexts.get(contextId);
        const broker = cfg && this._brokers.get(cfg.method);
        if (broker && broker.logout) {
            await broker.logout(contextId, cfg);
        } else {
            this._user()?.logout(contextId);
        }
    }

    /** Subscribe to auth state changes for ANY configured context. */
    onChange(cb: (contextId: string) => void): () => void {
        this._listeners.add(cb);
        return () => { this._listeners.delete(cb); };
    }

    private _notify(contextId: string): void {
        for (const cb of this._listeners) {
            try { cb(contextId); } catch (e) { console.warn("XOpatAuth onChange listener failed", e); }
        }
    }

    private _subscribeContext(contextId: string): void {
        if (this._subscribed.has(contextId)) return;
        const user = this._user();
        if (!user) return; // resubscribes on next configure/init once the user exists
        this._subscribed.add(contextId);
        const handler = () => this._notify(contextId);
        for (const base of EVENT_BASES) {
            user.addHandler(user.getEventName(base, contextId), handler);
        }
    }

    /** Resolve once a login/secret update lands for the context (or on timeout). */
    private _awaitAuth(contextId: string, timeoutMs: number): Promise<void> {
        const user = this._user();
        if (!user) return Promise.resolve();
        const loginEvent = user.getEventName("login", contextId);
        const secretEvent = user.getEventName("secret-updated", contextId);
        return new Promise<void>((resolve) => {
            let settled = false;
            const onEvent = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                user.removeHandler(loginEvent, onEvent);
                user.removeHandler(secretEvent, onEvent);
                resolve();
            };
            const timer = setTimeout(onEvent, timeoutMs);
            user.addHandler(loginEvent, onEvent);
            user.addHandler(secretEvent, onEvent);
        });
    }
}
