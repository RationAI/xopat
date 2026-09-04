import {
    CapabilityRegistry,
    type CapabilityDescriptor,
    type RoleDescriptor,
    type RolesEnvConfig,
    type CapabilityExplanation,
    diffEffective,
    explainCapabilities,
    resolveCapabilities,
    rolesFromClaims,
} from "./user-roles-core";

/**
 * Read a JWT payload WITHOUT verifying its signature.
 *
 * That is sound here and only here: the roles it feeds drive **UI gating**, and
 * `src/USER_ROLES.md` is explicit that the browser's role state is not
 * authoritative. The same token is verified independently server-side by the
 * `saml` / `oidc` RPC and proxy verifiers before it authorizes anything. Forging
 * a claim therefore buys a user some buttons, not access.
 *
 * Never throws — a malformed or opaque token yields `{}`, which resolves to the
 * deployment's fallback roles rather than breaking login.
 */
/**
 * Stable, non-cryptographic fingerprint of a secret value, for "is this the same
 * credential I already saw rejected?" comparisons only.
 *
 * Deliberately lossy and deliberately not a hash anyone could reverse into the token:
 * the point is to compare identities WITHOUT retaining a second copy of a bearer
 * credential anywhere in the app. A collision costs one avoidable refresh attempt,
 * which the cooldown absorbs.
 */
function secretFingerprint(secret: unknown): string | null {
    if (secret === null || secret === undefined) return null;
    const text = typeof secret === "string" ? secret : (() => {
        try { return JSON.stringify(secret); } catch (e) { return String(secret); }
    })();
    if (!text) return null;
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193);
        h2 = Math.imul(h2 ^ c, 0x85ebca6b);
    }
    return `${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}.${text.length}`;
}

function decodeJwtPayloadUnverified(token: unknown): Record<string, any> {
    if (typeof token !== "string") return {};
    const parts = token.split(".");
    if (parts.length < 2) return {};
    try {
        const base64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
        // `atob` yields one char per byte; re-decode as UTF-8 so non-ASCII
        // display names and group names survive.
        const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
        return {};
    }
}

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
    /**
     * Credential GENERATION per secret: bumped on every landing, so "which credential
     * is this?" has an answer that a fingerprint comparison alone cannot give.
     *
     * Two cases have to be told apart and they look identical without it:
     *
     *  - A provider that re-issues the SAME value (a SAML / OIDC-server broker
     *    re-reading its server session's stored token, basic-auth replaying the same
     *    `{username, password}`). Refusing it twice across two refreshes is two pieces
     *    of evidence — the refresh accomplished nothing — and must count.
     *  - A BURST of in-flight requests sharing one expired token, where one of them
     *    refreshes and the rest report their 401s afterwards. Those are all one piece
     *    of evidence about the OLD credential, and counting them would park a context
     *    whose new credential nothing has tested yet.
     *
     * Generation separates them: a rejection counts only when the credential being
     * reported is the one currently attached AND its generation is newer than the
     * newest already known refused.
     */
    private _secretGeneration: Record<string, number> = {};
    /**
     * Fingerprint of the currently attached credential, per secret — a fingerprint and
     * never the value, so this cannot become a second place a bearer token lives.
     * Identity comparison only; no security property.
     */
    private _secretFingerprint: Record<string, string> = {};
    /** Generation of the newest credential a protected resource is known to have refused. */
    private _rejectedGeneration: Record<string, number> = {};
    /**
     * How many DISTINCT credentials this secret has burned since one was last proven
     * to work ({@link reportSecretAccepted}).
     *
     * This is the loop breaker, and it is deliberately NOT the budget above. The
     * budget counts refreshes that *failed*, and `setSecret` re-arms it — which is
     * right, because a landing is evidence the provider recovered. But it leaves the
     * one case that actually ran away unguarded: a provider whose refresh SUCCEEDS
     * every time, handing back a fresh token the server still rejects. Every landing
     * cleared the budget, the next request 401'd, asked for another refresh, and the
     * cycle ran unbounded — thousands of requests, one identity-provider round trip
     * each, until the IdP started timing out.
     *
     * A landing proves the IdP answered. Only a request that stops failing proves the
     * credential works, so only that resets this.
     */
    private _rejectionStreak: Record<string, number> = {};

    // ── roles & capabilities (see src/USER_ROLES.md) ────────────────────
    /** Currently assigned roles, in declaration order. Recomputed on assignRoles. */
    private _roles: string[] = [];
    /** Effective capability map cached for fast `can()` reads. */
    private _effective: Record<string, boolean> = {};
    /** Guards {@link _installClaimRoleResolver} against double subscription. */
    private _claimResolverInstalled: boolean = false;

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

        this._installClaimRoleResolver();
    }

    /**
     * Deployment-configured rights resolver: map an IdP claim to roles at login.
     *
     * Subscribes to both `login` and `secret-updated` because the two orders
     * both occur in practice — a broker may set the credential before it
     * announces the identity, or after. `assignRoles` short-circuits when the
     * result is unchanged, so the duplicate path and every token refresh are
     * free.
     *
     * Inert unless `core.roles.claims` is configured, so deployments without it
     * behave exactly as they did before this existed.
     */
    private _installClaimRoleResolver(): void {
        const cfg = XOpatUser._envConfig.claims;
        if (!cfg || this._claimResolverInstalled) return;
        this._claimResolverInstalled = true;
        const ctxId = cfg.contextId ?? 'core';
        const claimName = cfg.claim ?? 'roles';

        const resolve = () => {
            const payload = decodeJwtPayloadUnverified(this.getSecret('jwt', ctxId));
            this.assignRoles(rolesFromClaims(payload[claimName], cfg));
        };

        this.addHandler(this.getEventName('login', ctxId), resolve);
        this.addHandler(this.getEventName('secret-updated', ctxId), (e: any) => {
            if (e?.type && e.type !== 'jwt') return;
            resolve();
        });
    }

    /**
     * Login user. Idempotent for EVERY context, core and sub-context alike:
     * re-asserting the identity that is already logged in only refreshes the display
     * data and raises nothing, and logging in a *different* identity logs the previous
     * one out first (`logout {switching: true}`) and drops that context's secrets.
     * This should be used only for the first login; after that, use setSecret() and
     * getSecret(). The state reflects the default core contextId state.
     *
     * The idempotence is a contract consumers depend on: `login` / `logout` are the
     * coarse "is this context signed in?" signal, as opposed to `secret-updated`, which
     * a token renew raises several times an hour. A feature subscribing to `login` must
     * never be woken by a renew — see src/AUTH.md.
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
            // Same rules as core above, and for the same reason. This branch used to
            // raise `login:<ctx>` unconditionally, so whether a token refresh looked
            // like a fresh sign-in depended on every broker remembering to guard the
            // call — five separate call-site checks (oidc-client-ts, oidc-server-ts,
            // saml-auth, basic-auth, empaia-workbench) upholding an invariant that
            // belongs here. A sixth broker would have got it wrong silently, and
            // consumers that treat `login` as "logged in" would be back to reacting to
            // every renew.
            const previous = this._identities[ctx];
            if (previous) {
                if (previous.id === id) {
                    // Re-asserted identity: refresh display data, raise nothing.
                    this._identities[ctx] = { id, name, icon };
                    return;
                }
                // Identity swap. Dropping this context's secrets is the point: leaving
                // the previous subject's bearer token attached to the new identity is
                // precisely what the brokers' subject-change guards were working
                // around. Safe to do here — every caller does login() then setSecret().
                //
                // Say so out loud when a LIVE credential is discarded. Silence here cost
                // a full debugging session: a broker that refined a display label by
                // logging in with a different id (the empaia-workbench user id over the
                // scope id) destroyed a perfectly good token, and the only symptom was
                // every later request going out with no Authorization header.
                if (Object.keys(this._secret || {}).some(k => k.startsWith(`${ctx}:`))) {
                    console.warn(`XOpatUser.login: identity of context '${ctx}' changed ` +
                        `('${previous.id}' -> '${id}') — that context's secrets are being discarded. ` +
                        `If this is the SAME subject with a better label, re-assert the current id ` +
                        `instead and pass the label as 'name'; otherwise setSecret() a new credential.`);
                }
                this._identities[ctx] = undefined;
                this._clearContextSecrets(ctx);
                this.raiseEvent(this.getEventName('logout', ctx), { contextId: ctx, switching: true });
            }
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
            // A credential landing is proof the provider answered, so it re-arms the
            // *refresh* budget, as it always has. It is NOT proof the credential works,
            // so it deliberately does not touch `_rejectionStreak` — only a request
            // that stops failing does (reportSecretAccepted).
            delete this._refreshBudget[keyWithCtx];
            // A new generation, even when the bytes are identical: a refresh completed,
            // so a 401 that follows is fresh evidence rather than an echo of the one
            // that triggered it. See `_secretGeneration`.
            this._secretGeneration[keyWithCtx] = (this._secretGeneration[keyWithCtx] ?? 0) + 1;
            this._secretFingerprint[keyWithCtx] = secretFingerprint(secret) ?? "";
            // The event is raised UNCONDITIONALLY, including for a re-issued
            // known-rejected value. Subscribers (the claim role resolver, XOpatAuth's
            // memo/epoch bookkeeping, `requestSecretUpdate`'s own resolver below, and
            // any module holding the token) must see every rotation — withholding it
            // would strand `requestSecretUpdate` on its full timeout and freeze stale
            // auth state. Consumers that only care about login/logout listen to
            // `login`/`logout`, which a rotation does not raise.
            this.raiseEvent(this.getEventName('secret-updated', contextId), { secret, type, contextId });
        } else if (this._secret[keyWithCtx]) {
            delete this._secret[keyWithCtx];
            // Nothing is attached any more, so no 401 can be evidence about "the
            // credential in hand" until one lands again. Dropping the fingerprint makes
            // late reports from the removed credential no-ops. The generation counter
            // stays — it is monotonic per secret, and reusing a number would let a
            // stale report look current.
            delete this._secretFingerprint[keyWithCtx];
            this.raiseEvent(this.getEventName('secret-removed', contextId), { type, contextId });
        }
    }

    /**
     * Report that a protected resource answered 401 while this exact credential was
     * attached — the only evidence that distinguishes "the provider cannot issue a
     * token" from "the provider issues tokens the server will not accept".
     *
     * Charges the refresh budget and remembers the credential's fingerprint, so a
     * subsequent {@link setSecret} carrying the same value does not re-arm the budget.
     * Callers are 401 handlers (`XOpatRemoteEndpoint._maybeRefreshSecrets`), never
     * auth modules — a broker has no way to know whether the token it just wrote works.
     *
     * No-op when `secret` is absent: a request that went out with no credential says
     * nothing about any credential.
     */
    reportSecretRejected(secret: any, type: string = "jwt", contextId: string | undefined = undefined): void {
        const fingerprint = secretFingerprint(secret);
        if (fingerprint === null) return;
        const key = this._getContextUniqueKey(type, contextId);

        // A credential that is no longer the attached one belongs to an earlier
        // generation: this is a late 401 from a burst that a refresh has already
        // superseded, and it says nothing about the credential in hand.
        if (this._secretFingerprint[key] !== fingerprint) return;

        // Already counted. A burst of parallel requests sharing one dead token is ONE
        // rejection, not one per request, or a single tile burst would exhaust the
        // streak before any refresh had a chance to run. Comparing GENERATIONS rather
        // than fingerprints is what also catches a provider re-issuing the same value:
        // the bytes repeat, the generation does not.
        const generation = this._secretGeneration[key] ?? 0;
        if (generation <= (this._rejectedGeneration[key] ?? 0)) return;

        this._rejectedGeneration[key] = generation;
        this._rejectionStreak[key] = (this._rejectionStreak[key] ?? 0) + 1;
    }

    /**
     * Report that a request carrying this secret was ACCEPTED — the only evidence
     * that the credential source is producing something the resource will take.
     * Clears the rejection streak, the last-rejected fingerprint and the refresh
     * budget, so a context that recovered starts from a clean slate.
     *
     * Cheap by design: this sits on the success path of every authenticated request
     * (tiles included) and returns immediately when there is nothing to forget.
     */
    reportSecretAccepted(type: string = "jwt", contextId: string | undefined = undefined): void {
        const key = this._getContextUniqueKey(type, contextId);
        if (this._rejectionStreak[key] === undefined && this._rejectedGeneration[key] === undefined) return;
        delete this._rejectedGeneration[key];
        delete this._rejectionStreak[key];
        delete this._refreshBudget[key];
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
     *
     * Refreshes that SUCCEED are bounded separately, by {@link _rejectionStreak}: a
     * provider that keeps issuing credentials the protected resource keeps refusing
     * is stopped after {@link XOpatUser.MAX_REFRESH_FAILURES} distinct rejections and
     * the context is handed to the interactive-recovery gate. Nothing else could stop
     * that case — every landing legitimately re-arms the budget above.
     */
    async requestSecretUpdate(type: string = "jwt", contextId: string | undefined = undefined,
                              timeoutMs: number = 20000): Promise<void> {
        const key = this._getContextUniqueKey(type, contextId);

        // 1. Deduplication: If a refresh is already in flight for this key, return that promise
        if (this._refreshing[key]) return this._refreshing[key];

        if ((this._rejectionStreak[key] ?? 0) >= XOpatUser.MAX_REFRESH_FAILURES) {
            // Refreshing works and changes nothing: this credential source cannot
            // produce something the resource accepts. Park the context so pending and
            // future requests HOLD on the recovery gate (XOpatRemoteEndpoint._authHeaders)
            // instead of each one starting another refresh. `force` is warranted — a
            // 401 from the protected resource is exactly the proof XOpatAuth asks for.
            try {
                (window as any).APPLICATION_CONTEXT?.auth?.markNeedsInteraction?.(
                    this._sanitizeContextId(contextId),
                    { reason: "rejected", force: true }
                );
            } catch (e) { /* core gate optional; the rejection below still bounds the loop */ }
            return Promise.reject(new Error(
                `XOpatUser.requestSecretUpdate: '${key}' was refreshed ${this._rejectionStreak[key]} times and ` +
                `the protected resource rejected every result — refreshing again cannot help. ` +
                `An interactive login (or a server-side fix) is required.`
            ));
        }

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

        // Deferred rather than `_refreshing[key] = new Promise(executor)`: the executor
        // runs SYNCHRONOUSLY, and a provider that answers `secret-needs-update`
        // synchronously calls `setSecret` from inside it — so `onUpdate` ran its
        // `delete this._refreshing[key]` BEFORE the assignment happened, and the
        // already-settled promise stayed in the map for the rest of the session. Every
        // later call then returned it instantly, reporting a refresh that never ran.
        let resolve!: () => void;
        let reject!: (err: any) => void;
        const pending = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
        this._refreshing[key] = pending;

        const settle = (fn: () => void) => {
            if (this._refreshing[key] === pending) delete this._refreshing[key];
            fn();
        };

        const timeout = setTimeout(() => settle(() => reject('Timeout waiting for secret update')), timeoutMs);

        const onUpdate = (e: any) => {
            if (e.type === type && this._sanitizeContextId(e.contextId) === this._sanitizeContextId(contextId)) {
                this.removeHandler(this.getEventName('secret-updated', contextId), onUpdate);
                clearTimeout(timeout);
                settle(resolve);
            }
        };

        // Attach handler BEFORE raising the event to prevent the race condition
        this.addHandler(this.getEventName('secret-updated', contextId), onUpdate);

        // @ts-ignore: Assumes raiseEventAwaiting exists on OpenSeadragon.EventSource
        this.raiseEventAwaiting(needsUpdateEvent, { type, contextId })
            .catch((err: any) => {
                this.removeHandler(this.getEventName('secret-updated', contextId), onUpdate);
                clearTimeout(timeout);
                settle(() => reject(err));
            });

        return pending;
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
            iconEl.innerHTML = icon || `<i class="ph-light ph-user-circle btn-pointer"></i>`;
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
            // for this context starts from a clean budget — and a clean rejection
            // streak, so a fresh sign-in is never judged by the dead session's 401s.
            delete this._refreshBudget[key];
            delete this._rejectedGeneration[key];
            delete this._rejectionStreak[key];
            delete this._secretGeneration[key];
            delete this._secretFingerprint[key];
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
        this._name = $.t('user.anonymous');
        this._secret = {};
        this._refreshBudget = {};
        this._rejectedGeneration = {};
        this._rejectionStreak = {};
        this._secretGeneration = {};
        this._secretFingerprint = {};
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
            // The instance may predate the config (it is constructed lazily by
            // whoever calls `instance()` first), in which case its constructor
            // saw no `claims` block and installed nothing.
            XOpatUser.__self._installClaimRoleResolver();
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

    /**
     * How a capability should be NAMED to a human — in a refusal message, in
     * the roles panel, anywhere a person has to understand which gate closed.
     *
     * Resolved here rather than at declaration so the label is translated at
     * render time, and so every surface says the same thing. Three tiers:
     *
     *   `"Annotation — delete"`         label + direction (CRUD-derived)
     *   `"Run scripts"`                 label alone
     *   `"annotations.bundle-export"`   the id, when nobody declared a label
     *
     * The id fallback is deliberate: an owner that declared no label has
     * nothing better to offer, and a bare "you may not do that" is what made
     * these refusals impossible to diagnose in the first place.
     */
    static capabilityLabel(id: string): string {
        const desc = XOpatUser._capRegistry.get(id);
        if (!desc?.label) return id;
        if (!desc.direction) return desc.label;
        return `${desc.label} — ${$.t(`user.roles.direction.${desc.direction}`)}`;
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

    /**
     * Every declared capability with its verdict AND the role that decided it.
     *
     * For debugging and admin UIs — the runtime path is `can()`, which is a map
     * lookup. Unknown ids do not appear here at all: `can()` answers `true` for
     * them, and listing them as "allowed" would suggest a gate exists.
     */
    explainCapabilities(): Record<string, CapabilityExplanation> {
        return explainCapabilities({
            capabilities: XOpatUser._capRegistry.list(),
            assignedRoles: this._roles,
            definitions: XOpatUser._envConfig.definitions ?? {},
        });
    }

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