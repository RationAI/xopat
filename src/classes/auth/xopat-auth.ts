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
    /**
     * Trigger an interactive login. May not resolve in-page (redirect unloads).
     *
     * Return `false` when the attempt is definitively over AND failed — a closed
     * popup, a cancelled modal, a refused token exchange. Core then stops waiting
     * for the login events immediately instead of holding the caller (and the
     * recovery scrim) for {@link LOGIN_TIMEOUT_MS}. Return nothing when there is no
     * verdict yet, which is the correct answer for a fire-and-forget popup or a
     * redirect that is about to unload the page.
     */
    login(contextId: string, config: any, options?: AuthLoginOptions): void | boolean | Promise<void | boolean>;
    /**
     * Optional. Attempt a login that needs NO user interaction — a refresh grant, a
     * hidden `prompt=none` probe riding an IdP session someone else established, a
     * server-side session sync.
     *
     * MUST NOT open a window, navigate the page, or show UI, and MUST resolve.
     * Return `true` when it worked; `false`/nothing when it did not (core re-reads
     * {@link XOpatAuth.isAuthenticated} either way, so depositing the credential is
     * enough).
     *
     * This is what makes an automatic login possible at all: `window.open` without
     * a user gesture is blocked by every browser, so a broker with no silent route
     * has nothing to offer a click-less caller and core sends the user to the
     * interaction gate instead of burning a blocked popup.
     */
    loginSilent?(contextId: string, config: any): void | boolean | Promise<void | boolean>;
    /**
     * Optional. Whether this broker's INTERACTIVE flow can run with no user gesture
     * behind it — true for a full-page redirect or a server-side flow, false for
     * anything built on `window.open`.
     *
     * Defaults to **false**: a broker that does not claim otherwise is never asked
     * to prompt without a click.
     */
    canLoginWithoutGesture?(contextId: string, config: any): boolean;
    logout?(contextId: string, config: any): void | Promise<void>;
    isAuthenticated?(contextId: string, config: any): boolean;
    /** The token to send to our own server for verification (see tokenForServer). */
    getToken?(contextId: string, config: any): any;
}

/** How a login attempt was started. */
export interface AuthLoginOptions {
    /**
     * Whether a real user gesture (a click/tap) is behind this call. `false` means
     * the login started on its own — at boot, from a 401 handler, from a timer —
     * and therefore may not open a window.
     *
     * Defaults to `true`, because every UI caller is a click handler; automatic
     * callers must opt out explicitly.
     */
    gesture?: boolean;
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
/**
 * How long a *deferred* interaction report (see {@link XOpatAuth.markNeedsInteraction})
 * stays promotable. A renew hiccup reported while the credential still worked is
 * evidence about that moment, not a permanent verdict — without an expiry it sat in
 * `_interactionPending` for the whole session and detonated on the next unrelated
 * auth transition, hours later.
 */
const INTERACTION_PENDING_TTL_MS = 10 * 60 * 1000;
const EVENT_BASES = ["login", "logout", "secret-updated", "secret-removed"] as const;

/** Why a settle wait stopped. Diagnostics only — never branch security on it. */
export type AuthSettleReason =
    | "authenticated"
    | "unconfigured"
    | "no-broker"
    | "not-authenticated"
    | "needs-interaction"
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
    /**
     * When the context is flagged {@link XOpatAuth.isInteractionRequired}, keep
     * waiting for the user to complete an interactive login instead of settling
     * immediately as unauthenticated. Bounded by {@link LOGIN_TIMEOUT_MS}, so a
     * caller can hold a request across a sign-in without hanging forever.
     */
    awaitInteractive?: boolean;
}

/** Why a context needs the user to log in again. Diagnostics only. */
export interface AuthInteractionInfo {
    reason: string;
    since: number;
    /**
     * A broker reported trouble while the credential was still usable, so nothing
     * was dropped and nothing is blocking the user. The report is remembered and
     * promoted the moment the credential actually dies. See
     * {@link XOpatAuth.markNeedsInteraction}.
     */
    pending?: boolean;
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
    /**
     * Contexts whose broker `init()` is RUNNING right now.
     *
     * Deliberately not `_initPromises`: that map retains its handle after a
     * successful init (so `whenContextSettled` can still await it), which makes
     * "has an entry" mean "has ever initialized", not "is initializing". Using it
     * as a mid-login test left {@link _isMidLogin} permanently true for every
     * context and made the deferred-promotion branch of {@link _notify}
     * unreachable.
     */
    private _initInFlight = new Set<string>();
    /** In-flight settle waits, shared by every concurrent caller of a context. */
    private _settling = new Map<string, Promise<AuthSettleResult>>();
    /** Memoized terminal verdicts, invalidated by {@link _notify}. */
    private _settled = new Map<string, AuthSettleResult>();
    private _settleListeners = new Set<(result: AuthSettleResult) => void>();
    /** Contexts whose credential died and that only a user gesture can revive. */
    private _needsInteraction = new Map<string, AuthInteractionInfo>();
    /**
     * Reports that arrived while the credential was still working. Held here
     * instead of acted on, and promoted into `_needsInteraction` the moment the
     * credential stops working. See {@link markNeedsInteraction}.
     */
    private _interactionPending = new Map<string, AuthInteractionInfo>();
    /**
     * Contexts with an interactive {@link login} in flight. A login is a sequence
     * of XOpatUser events that passes THROUGH an unauthenticated state (see
     * `_notify`), so "not authenticated right now" must not be read as failure
     * while one is running.
     */
    private _loginInFlight = new Set<string>();
    /**
     * Per-context credential generation, bumped every time a secret lands. A 401 is
     * proof about the credential that was ATTACHED TO IT, not about whichever one is
     * installed by the time the failure is handled — and handling is asynchronous
     * (the slide gate waits for the context to settle first). Without this, a 401
     * from a dead token routinely arrived after the replacement had already landed
     * and force-dropped the good credential, which made the next request 401 too and
     * "confirmed" the diagnosis.
     */
    private _credentialEpoch = new Map<string, number>();
    /**
     * Announced asynchronous context discoveries (see {@link registerContextDiscovery}).
     * Already normalized to never reject, so awaiting them is always safe.
     */
    private _discoveries = new Set<Promise<void>>();

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
     * config. Starts the broker's init for that context if it is already registered.
     * The context id is canonicalized (`""`/`null`/omitted/`"core"` → `"core"`).
     *
     * Resolving means **declared**, NOT **authenticated**: the broker's `init()`
     * (where a boot/auto login happens) is kicked off but deliberately not awaited,
     * so declaring several contexts cannot be serialized behind the first one's
     * login. A caller that needs the login outcome awaits
     * {@link whenContextSettled} for the context.
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
            // NOT awaited. Declaration must not be serialized behind the login it
            // describes: `initContext` runs the broker's full init, which for a boot
            // redirect never resolves at all (the page is unloading). Awaiting it
            // here meant a second declared context was never reached, so the boot
            // barrier — which reads `listAutoLoginContexts()` — could not see it and
            // waited for nothing. `_initPromises` retains the handle, and that is
            // what `_runSettle` already awaits, so nothing loses the ability to wait
            // for completion: it just asks `whenContextSettled` instead.
            void this.initContext(contextId);
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
        this._initInFlight.add(contextId);
        const running = (async () => {
            try {
                await broker.init?.(contextId, cfg);
            } catch (e) {
                this._initialized.delete(contextId);
                this._initPromises.delete(contextId);
                console.warn(`XOpatAuth: init of context '${contextId}' failed`, e);
            } finally {
                // Only the RUNNING mark is cleared here — the promise handle stays,
                // by design, so `whenContextSettled` keeps its wait target.
                this._initInFlight.delete(contextId);
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

    // ── expired credentials ────────────────────────────────────────────────
    //
    // A silent renew that fails with `interaction_required` (or an equivalent
    // server-session loss) is RECOVERABLE — a single user gesture fixes it — but
    // it cannot be fixed in the background, because every browser blocks
    // `window.open` without one. Core owns that state so the UI can gate on it
    // and so every broker reports it the same way; brokers classify, core decides
    // nothing about presentation. See `src/AUTH.md`.

    /**
     * Declare that `contextId` can only be revived by an interactive login.
     *
     * Drops the context's secrets first: they are known-dead, and removing them
     * both stops anything from sending an expired credential and (via
     * `secret-removed` → {@link _notify}) invalidates the settle memo, so callers
     * that wait on {@link whenContextSettled} start holding instead of failing.
     *
     * Deliberately NOT a logout — the identity is still known, only the
     * credential is stale, and logging out raises "you have been logged out",
     * which is both wrong and unhelpful here. Idempotent.
     *
     * **A broker reports; the credential decides.** A renew failure is evidence
     * about the *renewal*, not about the token in hand — a silent-renew iframe that
     * times out, a network blip on a refresh grant, or an IdP that answers
     * `interaction_required` to a `prompt=none` probe all happen routinely while the
     * current access token is still perfectly valid. Acting on those unconditionally
     * used to destroy a working credential and block the viewer, after which every
     * request 401'd and "confirmed" the diagnosis. So by default a report that
     * arrives while {@link isAuthenticated} is still true is only *remembered*
     * ({@link isInteractionPending}) and promoted when the credential actually dies.
     *
     * Pass `force: true` only when the caller holds proof that the credential is
     * unusable — an actual 401 from the resource it protects.
     */
    /**
     * The current credential generation for a context. A caller that will report a
     * failure ASYNCHRONOUSLY reads this at the moment the failure happened and hands
     * it back to {@link markNeedsInteraction} as `epoch`; core then ignores the
     * report if a newer credential has landed in the meantime.
     */
    getCredentialEpoch(contextId: string | null | undefined): number {
        return this._credentialEpoch.get(this._ctx(contextId)) ?? 0;
    }

    markNeedsInteraction(
        contextId: string | null | undefined,
        info: { reason?: string; force?: boolean; epoch?: number } = {}
    ): void {
        const ctx = this._ctx(contextId);
        // Evidence about a credential that has since been replaced says nothing
        // about the one installed now. Dropping the new one here is what turned a
        // single stale 401 into a permanent, self-confirming failure.
        if (typeof info.epoch === "number" && info.epoch < this.getCredentialEpoch(ctx)) {
            console.debug(`XOpatAuth: ignoring a '${info.reason || "expired"}' report for '${ctx}' — ` +
                `it concerns credential #${info.epoch}, and #${this.getCredentialEpoch(ctx)} is in use.`);
            return;
        }
        // The context is FLAGGED but a credential is present again — the flag is
        // simply stale (a report that raced the login that fixed it). Re-raising
        // `auth-interaction-required` here is how a healthy session got a blocking
        // scrim it could never dismiss: `clearNeedsInteraction` had already fired,
        // so no `-resolved` was left to close it. Converge on the truth instead.
        if (this._needsInteraction.has(ctx) && this.isAuthenticated(ctx)) {
            this.clearNeedsInteraction(ctx);
            return;
        }
        if (!info.force && !this._needsInteraction.has(ctx) && this.isAuthenticated(ctx)) {
            if (!this._interactionPending.has(ctx)) {
                this._interactionPending.set(ctx, {
                    reason: info.reason || "expired", since: Date.now(), pending: true,
                });
                console.debug(`XOpatAuth: '${ctx}' reported '${info.reason || "expired"}' while its ` +
                    `credential still works — deferring until it actually fails.`);
            }
            return;
        }
        this._interactionPending.delete(ctx);
        // Idempotent for the STATE (secrets are dropped once), but the event is
        // re-raised: a broker can flag a context at boot before the recovery UI has
        // subscribed, and swallowing the repeat left the flag set with nothing on
        // screen — a viewer that refuses every request and never says why. The UI
        // side is guarded against a duplicate, so re-raising is free.
        const known = this._needsInteraction.get(ctx);
        if (!known) {
            this._needsInteraction.set(ctx, { reason: info.reason || "expired", since: Date.now() });

            const user = this._user();
            if (user) {
                // setSecret(null, …) raises `secret-removed`, which _notify() turns
                // into a memo invalidation for this context.
                for (const type of this.getSecretTypes(ctx)) {
                    try { user.setSecret(null, type, ctx); } catch (e) { /* best effort */ }
                }
            }
            this._settled.delete(ctx);
        }

        const cfg = this._contexts.get(ctx);
        this._raiseUserEvent("auth-interaction-required", ctx, {
            contextId: ctx,
            isMain: ctx === "core" || cfg?.isMain === true,
            serviceName: cfg?.serviceName || ctx,
            reason: this._needsInteraction.get(ctx)!.reason,
        });
    }

    /**
     * Clear the flag once a credential lands again. Idempotent.
     *
     * The `-resolved` event is raised even when the flag was ALREADY clear. It is
     * the only signal that closes the recovery scrim, and the two can legitimately
     * disagree: a duplicate `auth-interaction-required` can open a scrim after the
     * flag was cleared, and swallowing the resolve then left a blocking overlay
     * with nothing able to dismiss it. Re-raising is free — the UI side is
     * idempotent.
     */
    clearNeedsInteraction(contextId: string | null | undefined): void {
        const ctx = this._ctx(contextId);
        this._interactionPending.delete(ctx);
        if (this._needsInteraction.delete(ctx)) {
            this._settled.delete(ctx);
        }
        this._raiseUserEvent("auth-interaction-resolved", ctx, { contextId: ctx });
    }

    /** Whether this context is waiting for the user to sign in again. */
    isInteractionRequired(contextId: string | null | undefined): boolean {
        return this._needsInteraction.has(this._ctx(contextId));
    }

    /**
     * A broker reported that this context will eventually need an interactive
     * login, but the credential still works — nothing is blocked and nothing was
     * dropped. Use it for a soft hint ("sign-in will be required soon"); never to
     * refuse a request.
     */
    isInteractionPending(contextId: string | null | undefined): boolean {
        return this._interactionPending.has(this._ctx(contextId));
    }

    /** Why/when, for diagnostics and UI copy. Pending reports carry `pending: true`. */
    getInteractionInfo(contextId: string | null | undefined): AuthInteractionInfo | undefined {
        const ctx = this._ctx(contextId);
        return this._needsInteraction.get(ctx) || this._interactionPending.get(ctx);
    }

    listContextsNeedingInteraction(): string[] {
        return [...this._needsInteraction.keys()];
    }

    /**
     * Raise on the XOpatUser event surface, twice:
     *  - `<base>:<ctx>` (bare for core) — for a feature that cares about ITS context;
     *  - `auth-interaction-changed` — one global channel carrying `contextId` in
     *    the payload, so an app-wide listener (the recovery UI) does not have to
     *    know every context id up front and re-subscribe as contexts appear.
     */
    private _raiseUserEvent(base: string, contextId: string, payload: any): void {
        const user = this._user();
        if (!user) return;
        try {
            user.raiseEvent(user.getEventName(base, contextId), payload);
            user.raiseEvent("auth-interaction-changed", { ...payload, event: base });
        } catch (e) { /* event surface is best-effort */ }
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
     * Announce that a broker is still ENUMERATING its contexts.
     *
     * A broker whose contexts come from the server (an RPC such as `listContexts`)
     * declares them late — often after the boot barrier already asked
     * {@link listAutoLoginContexts} and, finding nothing, waited for nothing. The
     * first slide then goes out before the token lands and the upstream answers 401
     * on a perfectly good session. Handing core the in-flight discovery closes that
     * window without core knowing anything about the method.
     *
     * The promise is normalized to never reject: discovery failing is a reason to
     * stop waiting, not to break boot.
     */
    registerContextDiscovery(discovery: Promise<unknown> | null | undefined): void {
        if (!discovery || typeof (discovery as any).then !== "function") return;
        this._discoveries.add(Promise.resolve(discovery).then(() => undefined, () => undefined));
    }

    /**
     * Wait (bounded) for every announced {@link registerContextDiscovery} to finish,
     * so a later `listAutoLoginContexts()` sees the full set. Resolves — never
     * rejects — and returns immediately when nothing was announced.
     */
    async whenContextsDiscovered(opts: { timeoutMs?: number } = {}): Promise<void> {
        if (!this._discoveries.size) return;
        const timeoutMs = Math.max(0, opts.timeoutMs ?? CONTEXT_GRACE_MS);
        const all = Promise.all([...this._discoveries]).then(() => undefined);
        if (!timeoutMs) return;
        let timer: any;
        try {
            await Promise.race([all, new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
        } finally {
            clearTimeout(timer);
        }
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
        unique.forEach((id, i) => { out[id] = results[i] ?? false; });
        return out;
    }

    /** Subscribe to settle verdicts for ANY context. Returns an unsubscribe fn. */
    onSettled(cb: (result: AuthSettleResult) => void): () => void {
        this._settleListeners.add(cb);
        return () => { this._settleListeners.delete(cb); };
    }

    private async _settleContext(contextId: string | null | undefined, opts: SettleOptions): Promise<AuthSettleResult> {
        const ctx = this._ctx(contextId);
        let timeoutMs = Math.max(0, opts.timeoutMs ?? SETTLE_TIMEOUT_MS);

        if (this.isAuthenticated(ctx)) return this._recordSettle(ctx, "authenticated");

        // The credential expired and only a user gesture can replace it. Nothing
        // this wait does can help, so an ordinary caller settles immediately as
        // unauthenticated rather than burning the timeout. A caller that opted
        // into `awaitInteractive` instead HOLDS across the sign-in — that is what
        // turns a 401 burst into a queue that drains once the user clicks.
        if (this._needsInteraction.has(ctx)) {
            if (!opts.awaitInteractive) return this._recordSettle(ctx, "needs-interaction");
            timeoutMs = Math.max(timeoutMs, LOGIN_TIMEOUT_MS);
            if (!opts.force) {
                const running = this._settling.get(ctx);
                if (running) return running;
            }
            const held = this._awaitAuth(ctx, timeoutMs)
                .then((): AuthSettleResult => {
                    this._settling.delete(ctx);
                    const result = this._recordSettle(
                        ctx, this.isAuthenticated(ctx) ? "authenticated" : "needs-interaction");
                    this._raiseSettled(result);
                    return result;
                });
            this._settling.set(ctx, held);
            return held;
        }
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
     * Log a context in. Returns whether the context ended up authenticated.
     * Completion is detected via XOpatUser events, because the redirect flow
     * unloads the page and never resolves the broker's promise.
     *
     * `options.gesture` decides how far this may go, and core — not each broker —
     * enforces it, because "a click-less login must not try to open a window" is a
     * browser rule, not a property of OIDC or SAML:
     *
     *  - `true` (default, every UI caller): interactive, exactly as before.
     *  - `false`: try {@link AuthBroker.loginSilent} first; if that does not
     *    authenticate, prompt only when the broker declares its interactive flow
     *    gesture-free ({@link AuthBroker.canLoginWithoutGesture} — a redirect or a
     *    server-side flow). Otherwise hand over to the interaction gate, which
     *    prompts on the user's next click.
     *
     * Without this an automatic login either opened a popup the browser blocked —
     * leaving a "please allow popups" toast and an unauthenticated viewer — or
     * silently did nothing at all.
     */
    async login(contextId: string, options: AuthLoginOptions = {}): Promise<boolean> {
        contextId = this._ctx(contextId);
        const gesture = options.gesture !== false;
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

        if (!gesture) {
            const silent = await this._tryLoginSilent(contextId, cfg, broker);
            if (silent) return true;
            if (broker.canLoginWithoutGesture?.(contextId, cfg) !== true) {
                // Nothing here can run without a click. Saying so is the whole point:
                // the gate turns the user's next interaction into the gesture, instead
                // of this call spending itself on a popup the browser will block.
                console.debug(`XOpatAuth: automatic login for '${contextId}' cannot proceed without a ` +
                    `user gesture (broker '${cfg.method}'); handing over to the interaction gate.`);
                this.markNeedsInteraction(contextId, { reason: "login_required" });
                return false;
            }
        }

        this._loginInFlight.add(contextId);
        try {
            const settled = this._awaitAuth(contextId, LOGIN_TIMEOUT_MS);
            let definitiveFailure = false;
            try {
                // An explicit `false` means "this attempt is over and it failed"
                // (popup closed, modal cancelled). Anything else — including the
                // `undefined` that a fire-and-forget broker returns while its popup
                // is still open — carries no verdict, so we keep waiting.
                definitiveFailure = (await broker.login(contextId, cfg, { gesture })) === false;
            } catch (e) {
                console.warn(`XOpatAuth: login for '${contextId}' errored`, e);
                definitiveFailure = true;
            }
            if (definitiveFailure) {
                // Give a secret that is already in flight its usual tick to land,
                // then answer. Waiting the full LOGIN_TIMEOUT_MS on a login the
                // broker already declared dead froze the recovery scrim on
                // "working…" for five minutes and swallowed every further click.
                await Promise.race([
                    settled.catch(() => {}),
                    new Promise<void>((resolve) => setTimeout(resolve, SETTLE_SECRET_GRACE_MS)),
                ]);
            } else {
                // A redirect flow never reaches here (the page unloads inside
                // `broker.login`); a popup flow resolves through the user events.
                await settled.catch(() => {});
            }
            return this.isAuthenticated(contextId);
        } finally {
            this._loginInFlight.delete(contextId);
        }
    }

    /**
     * Attempt a non-interactive login for a context, without ever prompting.
     *
     * Use it when something wants a credential but has no gesture to spend — a boot
     * sequence, a background job. Resolves to whether the context is authenticated
     * afterwards; a broker with no {@link AuthBroker.loginSilent} answers `false`
     * immediately, so callers can treat "cannot" and "did not work" alike.
     *
     * Unlike {@link login} it never reports to the interaction gate: the caller
     * decides whether a failure is worth a user's attention.
     */
    async loginSilent(contextId: string): Promise<boolean> {
        contextId = this._ctx(contextId);
        if (!this._contexts.has(contextId)) await this.ensureContextReady(contextId);
        const cfg = this._contexts.get(contextId);
        const broker = cfg && this._brokers.get(cfg.method);
        if (!cfg || !broker) return false;
        await this.initContext(contextId);
        if (this.isAuthenticated(contextId)) return true;
        return this._tryLoginSilent(contextId, cfg, broker);
    }

    /**
     * Run the broker's silent hook and report the resulting state. The hook's own
     * return value is advisory — the credential in `XOpatUser` is the verdict, so a
     * broker that just deposits a token (and returns nothing) works unchanged.
     */
    private async _tryLoginSilent(contextId: string, cfg: AuthContextConfig, broker: AuthBroker): Promise<boolean> {
        if (typeof broker.loginSilent !== "function") return false;
        this._loginInFlight.add(contextId);
        try {
            await broker.loginSilent(contextId, cfg);
        } catch (e) {
            console.debug(`XOpatAuth: silent login for '${contextId}' did not succeed`, e);
        } finally {
            this._loginInFlight.delete(contextId);
        }
        if (!this.isAuthenticated(contextId)) return false;
        // A silent success invalidates any memoized "not authenticated" verdict.
        this._settled.delete(contextId);
        return true;
    }

    /**
     * Every configured context, in declaration order, as snapshots — mutating the
     * result cannot corrupt the registry.
     *
     * For UI that must offer a sign-in per context without knowing the ids up front:
     * contexts appear after boot (some only when a feature first needs one), so
     * enumerating them is the only broker-agnostic way to render account controls.
     */
    listContexts(): AuthContextConfig[] {
        return [...this._contexts.values()].map((cfg) => ({ ...cfg }));
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

    private _notify(contextId: string, base?: string, payload?: any): void {
        // `login` / `logout` / `secret-updated` / `secret-removed` are exactly the
        // transitions that can flip a settle verdict — drop the memo so the next
        // `whenContextSettled` re-evaluates instead of replaying a stale answer.
        this._settled.delete(contextId);
        // A NEW credential starts a new generation, so in-flight reports about the
        // previous one can be recognised as stale (see markNeedsInteraction).
        if (base === "secret-updated") {
            this._credentialEpoch.set(contextId, this.getCredentialEpoch(contextId) + 1);
        }
        // A credential landing is what resolves an expired context. Checked via
        // isAuthenticated rather than the event name because the removal we do in
        // markNeedsInteraction also lands here.
        if (this._needsInteraction.has(contextId) && this.isAuthenticated(contextId)) {
            this.clearNeedsInteraction(contextId);
        }
        // The deferred half of markNeedsInteraction: a broker already told us this
        // context will need a human, we just refused to act while the credential
        // worked. It stopped working — act now.
        const deferred = this._interactionPending.get(contextId);
        if (deferred) {
            if (this.isAuthenticated(contextId)) {
                // A fresh credential landed: whatever the broker was worried about
                // resolved itself.
                this._interactionPending.delete(contextId);
            } else if (Date.now() - deferred.since > INTERACTION_PENDING_TTL_MS) {
                // Stale evidence. A renew that failed ten minutes ago says nothing
                // about the credential state of this transition.
                this._interactionPending.delete(contextId);
            } else if (!this._isMidLogin(contextId, base, payload)) {
                this.markNeedsInteraction(contextId, { reason: deferred.reason, force: true });
            }
            // else: a login is mid-flight. Promoting here would raise the recovery
            // scrim in the middle of the sign-in that is about to succeed; the next
            // transition of this context re-evaluates.
        }
        for (const cb of this._listeners) {
            try { cb(contextId); } catch (e) { console.warn("XOpatAuth onChange listener failed", e); }
        }
    }

    /**
     * Is this event an intermediate step of a login that is still running?
     *
     * A login is NOT atomic on the XOpatUser event surface. `XOpatUser.login()`
     * swapping identities raises `logout {switching: true}` BEFORE writing the new
     * one, and every broker writes the identity first and the secret second — so a
     * perfectly healthy sign-in passes through one or more ticks where
     * `isAuthenticated()` is false. Promoting a deferred report in that window
     * raised the recovery scrim in the middle of the login that was about to
     * succeed (and force-dropped the credential on its way in).
     *
     * "Still running" covers a broker init in flight too: that is where a boot /
     * redirect-return login lives. It must be `_initInFlight`, NOT `_initPromises`
     * — the latter retains its handle after init completes, so testing it made
     * every initialized context read as "mid-login" forever and this method could
     * never return false.
     */
    private _isMidLogin(contextId: string, base?: string, payload?: any): boolean {
        if (payload && payload.switching === true) return true;
        if (base === "login") return true;   // the secret write is the NEXT event
        return this._loginInFlight.has(contextId) || this._initInFlight.has(contextId);
    }

    private _subscribeContext(contextId: string): void {
        if (this._subscribed.has(contextId)) return;
        const user = this._user();
        if (!user) return; // resubscribes on next configure/init once the user exists
        this._subscribed.add(contextId);
        for (const base of EVENT_BASES) {
            user.addHandler(user.getEventName(base, contextId),
                (payload: any) => this._notify(contextId, base, payload));
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
