// Core auth broker — sibling to XOpatUser, reached as `APPLICATION_CONTEXT.auth`.
//
// XOpatUser holds per-context identity + secrets (getIsLogged / getSecret /
// setSecret, events `login:<ctx>` / `secret-updated:<ctx>`). XOpatAuth is the
// registry + orchestration on top: it knows HOW to obtain a login for a named
// context via a pluggable *broker* (OIDC today; SAML or others later). Core is
// deliberately method-agnostic — brokers REGISTER INTO it (inversion of
// control), so no OIDC/SAML specifics live here. A module (e.g. oidc-client-ts)
// registers its broker AND declares the contexts it owns via `configureContext`.
//
// A FEATURE never names a method: it declares `requireContext({contextId})` and
// then uses `isAuthenticated(...)` / `login(...)`. Whichever module owns that
// context supplies the mechanism, so the same feature works unchanged on an OIDC
// deployment, a SAML deployment, or one with no auth configured at all.
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
    /**
     * Optional. Resolve once this broker's *automatic* (non-interactive) login
     * attempt for `contextId` has finished — successfully or not. Implement it
     * when `init()` resolving does not yet mean the secret is written (e.g. the
     * token lands from an asynchronous `userLoaded` event). Core's default is
     * `init()` plus a short grace on `login`/`secret-updated`, which is correct
     * for every broker shipped today.
     *
     * MUST NOT start an interactive login, and MUST resolve — core races it
     * against its own deadline regardless. See {@link XOpatAuth.whenContextSettled}.
     */
    whenSettled?(contextId: string, config: any): void | Promise<void>;
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
    /**
     * Which `XOpatUser` secret types `HttpClient` should attach for this context
     * (`auth.types`). Declared by the BROKER — the mechanism knows what it stores;
     * a consuming feature must not guess. Defaults to `["jwt"]`.
     */
    secretTypes?: string[];
    [key: string]: any;
}

/** A feature's "I need login here, I don't care how" declaration. */
export interface AuthContextRequirement {
    contextId: string;
    serviceName?: string;
    requiresLogin?: boolean;
    /**
     * Applied ONLY when no auth module claims the context within the grace
     * period. Back-compat for deployments that carry the auth config inline on
     * the feature (e.g. a plugin's own `oidc` block) instead of on an auth module.
     */
    fallback?: Partial<AuthContextConfig> & { method: string };
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_SECRET_TYPES = ["jwt"];
/** How long a required context waits for a real broker before a fallback lands. */
const CONTEXT_GRACE_MS = 3000;
/**
 * Default bound on a settle wait ({@link XOpatAuth.whenContextSettled}). Long
 * enough for a redirect-callback token exchange or a silent renew, short enough
 * that an unreachable IdP cannot hold the viewer boot hostage.
 */
const SETTLE_TIMEOUT_MS = 8000;
/**
 * After `broker.init()` resolves, a broker may still write the secret
 * asynchronously (oidc-client-ts does it from `userManager.events.addUserLoaded`,
 * not inside `init`). Wait this long for `login`/`secret-updated` before
 * declaring the context not-authenticated.
 */
const SETTLE_SECRET_GRACE_MS = 1500;
const EVENT_BASES = ["login", "logout", "secret-updated", "secret-removed"] as const;

/** Why a settle wait stopped. Diagnostics only — never branch security on it. */
export type AuthSettleReason =
    | "authenticated"
    | "unconfigured"
    | "no-broker"
    | "not-authenticated"
    | "timeout";

/** Verdict of a {@link XOpatAuth.whenContextSettled} wait. */
export interface AuthSettleResult {
    contextId: string;
    authenticated: boolean;
    reason: AuthSettleReason;
}

export interface SettleOptions {
    /** Overall bound on the wait. @default SETTLE_TIMEOUT_MS */
    timeoutMs?: number;
    /**
     * How long to wait for an auth module to CLAIM a not-yet-configured context.
     * Defaults to 0 for a context nothing has declared (so an auth-less
     * deployment pays nothing) and to {@link CONTEXT_GRACE_MS} otherwise.
     */
    claimGraceMs?: number;
    /** Ignore the memoized verdict and re-evaluate. */
    force?: boolean;
}

export class XOpatAuth {
    private _brokers = new Map<string, AuthBroker>();
    private _contexts = new Map<string, AuthContextConfig>();
    private _initialized = new Set<string>();
    private _subscribed = new Set<string>();
    private _listeners = new Set<(contextId: string) => void>();
    /** Contexts declared via {@link requireContext} but not yet claimed by a broker. */
    private _required = new Map<string, AuthContextRequirement>();
    /** Contexts whose current config came from a requirement fallback, not a broker. */
    private _fallbackInstalled = new Set<string>();
    private _unclaimedWarned = new Set<string>();
    /**
     * Retained `broker.init()` promises. `_initialized` only marks that init
     * STARTED; this is the handle everything that needs to wait for it uses.
     * Never rejects — failures are logged and the entry dropped.
     */
    private _initPromises = new Map<string, Promise<void>>();
    /** In-flight settle waits, shared by every concurrent caller of a context. */
    private _settling = new Map<string, Promise<AuthSettleResult>>();
    /** Memoized terminal verdicts, invalidated by {@link _notify}. */
    private _settled = new Map<string, AuthSettleResult>();
    private _settleListeners = new Set<(result: AuthSettleResult) => void>();

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
            if (cfg.method !== method) continue;
            // A `no-broker` / `unconfigured` verdict recorded before this broker
            // existed is now stale.
            this._settled.delete(cfg.contextId);
            if (!this._initialized.has(cfg.contextId)) {
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
        return this._configure(cfg, false);
    }

    private async _configure(cfg: AuthContextConfig, viaFallback: boolean): Promise<void> {
        if (!cfg || !cfg.method) {
            throw new Error("XOpatAuth.configureContext: method is required.");
        }
        const contextId = this._ctx(cfg.contextId);
        // Any (re)declaration invalidates a recorded settle verdict — an
        // `unconfigured` answer from before this call is no longer true.
        this._settled.delete(contextId);
        // A real owner always beats an inline fallback, even when it arrives late
        // (a server-declared context, e.g. SAML's listContexts RPC, is async). Drop
        // the initialized mark so the incoming broker actually gets to init.
        if (!viaFallback && this._fallbackInstalled.has(contextId)) {
            this._fallbackInstalled.delete(contextId);
            this._initialized.delete(contextId);
            // Drop the fallback's init handle and settle verdict too, or the
            // incoming real broker would be reported as "already settled".
            this._initPromises.delete(contextId);
            this._settled.delete(contextId);
        }
        // Store under the canonical id, and record whether this is the main
        // identity so brokers don't each re-derive it from the raw id.
        const isMain = cfg.isMain === true || contextId === "core";
        const requirement = this._required.get(contextId);
        this._contexts.set(contextId, {
            serviceName: requirement?.serviceName,
            ...cfg,
            contextId,
            isMain,
        });
        if (viaFallback) this._fallbackInstalled.add(contextId);
        this._subscribeContext(contextId);
        if (this._brokers.has(cfg.method)) {
            await this.initContext(contextId);
        }
        // Otherwise the broker will init this context when it registers.
    }

    /**
     * Declare that a feature REQUIRES login for a context, without naming the
     * method. Whichever auth module owns the context (OIDC, SAML, …) configures
     * it; the feature only needs the id. This is the method-agnostic counterpart
     * of {@link configureContext} and the one features should call.
     *
     * `fallback` is applied only if nothing claims the context within the grace
     * period — back-compat for deployments carrying inline auth config on the
     * feature itself.
     */
    requireContext(req: AuthContextRequirement): void {
        if (!req || !req.contextId) throw new Error("XOpatAuth.requireContext: contextId is required.");
        const contextId = this._ctx(req.contextId);
        this._required.set(contextId, { ...req, contextId });
        // An `unconfigured` verdict recorded before anyone declared this context
        // must not be replayed — a claim may still be on its way.
        this._settled.delete(contextId);
        void this.ensureContextReady(contextId);
    }

    /** True when `contextId` is configured by a broker rather than by a fallback. */
    private _isOwned(contextId: string): boolean {
        return this._contexts.has(contextId) && !this._fallbackInstalled.has(contextId);
    }

    /**
     * Wait (bounded) for a context to be claimed by an auth module; install the
     * requirement's fallback if none does. Resolves to whether the context ended
     * up configured at all.
     */
    async ensureContextReady(contextId: string, graceMs = CONTEXT_GRACE_MS): Promise<boolean> {
        contextId = this._ctx(contextId);
        if (this._isOwned(contextId)) return true;

        const requirement = this._required.get(contextId);
        const deadline = Date.now() + Math.max(0, graceMs);
        while (Date.now() < deadline) {
            if (this._isOwned(contextId)) return true;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (this._isOwned(contextId)) return true;

        const fallback = requirement?.fallback;
        if (fallback?.method && this._brokers.has(fallback.method)) {
            await this._configure({
                serviceName: requirement?.serviceName,
                ...fallback,
                contextId,
            } as AuthContextConfig, true);
            return true;
        }

        if (requirement && !this._contexts.has(contextId) && !this._unclaimedWarned.has(contextId)) {
            this._unclaimedWarned.add(contextId);
            console.warn(
                `XOpatAuth: context '${contextId}' is required but no auth module claims it. ` +
                `Load an auth module that declares it (e.g. modules.oidc-client-ts / modules.saml-auth ` +
                `with permaLoad), or give the feature an inline authBroker + authConfig.`
            );
        }
        return this._contexts.has(contextId);
    }

    /**
     * Which `XOpatUser` secret types `HttpClient` should attach for a context.
     * Read this instead of hardcoding `["jwt"]`: a broker that stores something
     * else (basic, mTLS-derived, …) declares it on the context and every consumer
     * follows with no code change. Unknown contexts default to `["jwt"]`, so a
     * resource built before its context is configured behaves as it always did.
     */
    getSecretTypes(contextId: string): string[] {
        const types = this._contexts.get(this._ctx(contextId))?.secretTypes;
        return Array.isArray(types) && types.length ? types.slice() : DEFAULT_SECRET_TYPES.slice();
    }

    /**
     * Idempotent broker init for a context (processes a returning redirect).
     *
     * The promise is RETAINED: a concurrent caller awaits the in-flight init
     * instead of returning immediately, which is what makes
     * {@link whenContextSettled} able to wait for the boot login attempt.
     */
    async initContext(contextId: string): Promise<void> {
        contextId = this._ctx(contextId);
        const inFlight = this._initPromises.get(contextId);
        if (inFlight) return inFlight;
        if (this._initialized.has(contextId)) return;
        const cfg = this._contexts.get(contextId);
        if (!cfg) return;
        const broker = this._brokers.get(cfg.method);
        if (!broker) return;
        this._initialized.add(contextId);
        this._subscribeContext(contextId);
        // Publish the handle BEFORE running the body. The async IIFE executes
        // synchronously up to its first await, so a broker whose `init` throws
        // synchronously would reach the catch before `_initPromises.set` — deleting
        // an entry that does not exist yet, and then having the resolved promise
        // installed on top of it. `_initialized` would say "not initialized" while
        // `_initPromises` said "done", and the early return above would make that
        // permanent.
        let settle: () => void = () => {};
        this._initPromises.set(contextId, new Promise<void>((resolve) => { settle = resolve; }));
        const running = (async () => {
            try {
                await broker.init?.(contextId, cfg);
            } catch (e) {
                this._initialized.delete(contextId);
                this._initPromises.delete(contextId);
                console.warn(`XOpatAuth: init of context '${contextId}' failed`, e);
            } finally {
                settle();
            }
        })();
        return running;
    }

    /**
     * Resolve once `contextId` has finished *trying* to authenticate: an auth
     * module claimed it, its broker's `init()` (which is where a boot/auto login
     * happens) completed, and any asynchronous secret write landed. Resolves to
     * whether the context ended up authenticated.
     *
     * "Settled" means *finished trying*, NOT *succeeded* — a context whose IdP
     * is down settles as `false` so callers degrade instead of hanging. This
     * never throws and never starts an interactive login (that is {@link login});
     * it only waits for the attempt the broker makes on its own.
     *
     * Concurrent callers share a single wait, and the verdict is memoized until
     * the next auth state change for the context, so the hot path (every
     * authenticated request) is effectively free.
     */
    async whenContextSettled(contextId: string | null | undefined, opts: SettleOptions = {}): Promise<boolean> {
        return (await this._settleContext(contextId, opts)).authenticated;
    }

    /** The last {@link whenContextSettled} verdict for a context, if any. */
    getLastSettleResult(contextId: string | null | undefined): AuthSettleResult | undefined {
        return this._settled.get(this._ctx(contextId));
    }

    /**
     * Contexts whose broker attempts a login WITHOUT user interaction at boot.
     * These are the only ones worth blocking the application start on: a context
     * declared merely as *required* has nothing driving a login, so waiting for
     * it would only burn the timeout.
     */
    listAutoLoginContexts(): string[] {
        const out: string[] = [];
        for (const cfg of this._contexts.values()) {
            if (cfg.autoLogin === true) out.push(cfg.contextId);
        }
        return out;
    }

    /**
     * Settle several contexts in parallel under one deadline. Defaults to
     * {@link listAutoLoginContexts}. Never throws, and returns `{}` immediately
     * when nothing qualifies — a deployment with no auth pays nothing.
     */
    async whenAllSettled(opts: SettleOptions & { contexts?: string[] } = {}): Promise<Record<string, boolean>> {
        const { contexts, ...settleOpts } = opts;
        const ids = (contexts ?? this.listAutoLoginContexts()).map((c) => this._ctx(c));
        const out: Record<string, boolean> = {};
        if (!ids.length) return out;
        const unique = [...new Set(ids)];
        const results = await Promise.all(
            unique.map((id) => this.whenContextSettled(id, settleOpts).catch(() => false))
        );
        unique.forEach((id, i) => { out[id] = results[i]; });
        return out;
    }

    /** Subscribe to settle verdicts for ANY context. Returns an unsubscribe fn. */
    onSettled(cb: (result: AuthSettleResult) => void): () => void {
        this._settleListeners.add(cb);
        return () => { this._settleListeners.delete(cb); };
    }

    private async _settleContext(contextId: string | null | undefined, opts: SettleOptions): Promise<AuthSettleResult> {
        const ctx = this._ctx(contextId);
        const timeoutMs = Math.max(0, opts.timeoutMs ?? SETTLE_TIMEOUT_MS);

        if (this.isAuthenticated(ctx)) return this._recordSettle(ctx, "authenticated");
        if (!opts.force) {
            const memo = this._settled.get(ctx);
            if (memo) return memo;
            const running = this._settling.get(ctx);
            if (running) return running;
        }

        // Nothing declares this context and the caller did not ask us to wait for
        // one to appear: answer now rather than paying the claim grace on every
        // request of an auth-less deployment.
        const declared = this._contexts.has(ctx) || this._required.has(ctx);
        const claimGraceMs = opts.claimGraceMs ?? (declared ? CONTEXT_GRACE_MS : 0);
        if (!declared && claimGraceMs <= 0) return this._recordSettle(ctx, "unconfigured");

        const deadline = Date.now() + timeoutMs;
        const work = this._runSettle(ctx, claimGraceMs, deadline)
            .catch((e): AuthSettleResult => {
                console.warn(`XOpatAuth: settle wait for '${ctx}' failed`, e);
                return { contextId: ctx, authenticated: this.isAuthenticated(ctx), reason: "not-authenticated" };
            })
            .then((result) => {
                this._settling.delete(ctx);
                this._settled.set(ctx, result);
                this._raiseSettled(result);
                return result;
            });
        this._settling.set(ctx, work);
        return work;
    }

    private async _runSettle(ctx: string, claimGraceMs: number, deadline: number): Promise<AuthSettleResult> {
        const verdict = (reason: AuthSettleReason): AuthSettleResult =>
            ({ contextId: ctx, authenticated: this.isAuthenticated(ctx), reason });
        const remaining = () => deadline - Date.now();

        const configured = await this.ensureContextReady(ctx, Math.min(claimGraceMs, Math.max(0, remaining())));
        if (!configured) return verdict("unconfigured");

        // `ensureContextReady` proves the context is CONFIGURED, not that its
        // broker registered — a context configured before its module loads is
        // back-filled later by `registerBroker`.
        const broker = await this._awaitBroker(ctx, deadline);
        if (!broker) return verdict("no-broker");
        if (this.isAuthenticated(ctx)) return verdict("authenticated");

        const timedOut = await this._raceDeadline(this.initContext(ctx), deadline);
        if (this.isAuthenticated(ctx)) return verdict("authenticated");
        if (timedOut) return verdict("timeout");

        const cfg = this._contexts.get(ctx);
        if (typeof broker.whenSettled === "function") {
            const late = await this._raceDeadline(Promise.resolve(broker.whenSettled(ctx, cfg)), deadline);
            if (this.isAuthenticated(ctx)) return verdict("authenticated");
            if (late) return verdict("timeout");
        } else {
            // No explicit hook: brokers commonly write the secret one event tick
            // after init() resolves, so give that write a bounded grace.
            const grace = Math.max(0, Math.min(SETTLE_SECRET_GRACE_MS, remaining()));
            if (grace > 0) await this._awaitAuth(ctx, grace);
            if (this.isAuthenticated(ctx)) return verdict("authenticated");
        }
        return verdict(remaining() <= 0 ? "timeout" : "not-authenticated");
    }

    /** Bounded poll for the broker owning `ctx` to be registered. */
    private async _awaitBroker(ctx: string, deadline: number): Promise<AuthBroker | undefined> {
        for (;;) {
            const cfg = this._contexts.get(ctx);
            const broker = cfg && this._brokers.get(cfg.method);
            if (broker) return broker;
            if (Date.now() >= deadline) return undefined;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }

    /** Await `p` but give up at `deadline`. Resolves to whether it timed out. */
    private async _raceDeadline(p: Promise<any>, deadline: number): Promise<boolean> {
        const ms = deadline - Date.now();
        if (ms <= 0) return true;
        let timer: any;
        const expired = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), ms); });
        try {
            return await Promise.race([p.then(() => false, () => false), expired]);
        } finally {
            clearTimeout(timer);
        }
    }

    private _recordSettle(ctx: string, reason: AuthSettleReason): AuthSettleResult {
        const result: AuthSettleResult = { contextId: ctx, authenticated: this.isAuthenticated(ctx), reason };
        this._settled.set(ctx, result);
        return result;
    }

    /**
     * Notify settle subscribers. XOpatAuth is not an EventSource and must not
     * become a new global, so the event rides on XOpatUser using its own naming
     * rules: bare `auth-settled` for the core context, `auth-settled:<ctx>` else.
     */
    private _raiseSettled(result: AuthSettleResult): void {
        for (const cb of this._settleListeners) {
            try { cb(result); } catch (e) { console.warn("XOpatAuth onSettled listener failed", e); }
        }
        const user = this._user();
        if (!user) return;
        try {
            user.raiseEvent(user.getEventName("auth-settled", result.contextId), { ...result });
        } catch (e) { /* event surface is best-effort */ }
    }

    isAuthenticated(contextId: string): boolean {
        contextId = this._ctx(contextId);
        const cfg = this._contexts.get(contextId);
        const broker = cfg && this._brokers.get(cfg.method);
        if (broker && broker.isAuthenticated) {
            try { return !!broker.isAuthenticated(contextId, cfg); } catch { /* fall through to default */ }
        }
        const user = this._user();
        if (!user || !user.getIsLogged(contextId)) return false;
        // Follow the context's declared secret types instead of assuming "jwt" —
        // a broker storing something else (basic, mTLS-derived, …) would otherwise
        // settle as permanently unauthenticated and burn the full settle timeout
        // at every boot. getSecretTypes falls back to ["jwt"], so this is a no-op
        // for every context that does not declare anything.
        return this.getSecretTypes(contextId).some((type) => !!user.getSecret(type, contextId));
    }

    /** The token to attach to our own server calls for this context. */
    getToken(contextId: string): any {
        contextId = this._ctx(contextId);
        const cfg = this._contexts.get(contextId);
        const broker = cfg && this._brokers.get(cfg.method);
        if (broker && broker.getToken) {
            try { return broker.getToken(contextId, cfg); } catch { /* fall through */ }
        }
        const user = this._user();
        if (!user) return undefined;
        for (const type of this.getSecretTypes(contextId)) {
            const secret = user.getSecret(type, contextId);
            if (secret) return secret;
        }
        return undefined;
    }

    /**
     * Interactive login for a context. Returns whether the context ended up
     * authenticated. Completion is detected via XOpatUser events, because the
     * redirect flow unloads the page and never resolves the broker's promise.
     */
    async login(contextId: string): Promise<boolean> {
        contextId = this._ctx(contextId);
        // A context declared through requireContext may still be waiting for its
        // auth module (server-declared contexts arrive asynchronously).
        if (!this._contexts.has(contextId)) await this.ensureContextReady(contextId);
        const cfg = this._contexts.get(contextId);
        if (!cfg) {
            throw new Error(
                `XOpatAuth.login: context '${contextId}' is not configured — no auth module claims it. ` +
                `Load one that declares this context (modules.oidc-client-ts / modules.saml-auth, permaLoad), ` +
                `or give the requiring feature an inline authBroker + authConfig.`
            );
        }
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
        // `login` / `logout` / `secret-updated` / `secret-removed` are exactly the
        // transitions that can flip a settle verdict — drop the memo so the next
        // `whenContextSettled` re-evaluates instead of replaying a stale answer.
        this._settled.delete(contextId);
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
