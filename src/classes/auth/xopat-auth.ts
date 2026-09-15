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
 * What a {@link AuthBroker.loginSilent} attempt concluded. `"unknown"` is not a
 * softer `false`: it says the authority was never reached, which is the one answer
 * that must NOT be escalated to a full-page redirect.
 */
export type AuthSilentOutcome = boolean | "unknown";

/**
 * What a provider OBSERVED. **Facts only — never an instruction to core.**
 *
 * This is the channel whose absence caused the worst bug in this subsystem. A
 * provider routinely learns something decisive while its `init()` runs — above all,
 * that a returning redirect callback came back `interaction_required` — and `init()`
 * used to return `void`. With no way to *report* it, a provider had two exits and
 * both were layering violations: act on it (start its own navigation, bypassing the
 * arbitration that keeps two providers from cancelling each other's redirect), or
 * call a core mutator (`markNeedsInteraction`), which dead-ends — nothing escalates
 * afterwards, and while a credential is still alive it does not even register.
 *
 * A returned verdict is acted on by the ladder regardless of the current credential's
 * health, which is precisely what a mutator call can never be.
 */
export type AuthProviderVerdict =
    /** A credential was obtained. */
    | { outcome: "authenticated"; reason?: string }
    /** The authority answered, and the answer was "not without a human". */
    | { outcome: "interaction-required"; reason?: string }
    /** The authority answered, and the answer was no. */
    | { outcome: "no-session"; reason?: string }
    /** We never reached the authority at all. Must NOT be escalated to a navigation. */
    | { outcome: "unreachable"; reason?: string }
    /** Nothing happened: no callback to consume, no attempt made. */
    | { outcome: "idle"; reason?: string };

/** Narrow an `AuthSilentOutcome` shorthand (or nothing) to a verdict. */
function toVerdict(value: void | AuthSilentOutcome | AuthProviderVerdict): AuthProviderVerdict {
    if (value && typeof value === "object" && typeof (value as any).outcome === "string") {
        return value as AuthProviderVerdict;
    }
    if (value === true) return { outcome: "authenticated" };
    if (value === "unknown") return { outcome: "unreachable" };
    if (value === false) return { outcome: "no-session" };
    return { outcome: "idle" };
}

/**
 * An auth mechanism implementation (OIDC, SAML, …). Registered under a `method`
 * name via {@link XOpatAuth.registerBroker}. All methods receive the resolved
 * per-context config. Brokers are expected to store the resulting identity/token
 * in `XOpatUser` under the same `contextId` (type `"jwt"`), so the defaults here
 * work even when a method is not implemented.
 */
export interface AuthBroker {
    /**
     * Idempotent per-context setup; also processes a returning redirect callback.
     *
     * MAY return what it observed ({@link AuthProviderVerdict}) — in particular, that
     * a consumed callback came back `interaction_required`, which core reads as "the
     * silent rung has been answered, and the answer unlocks the interactive one".
     * Returning nothing means `{outcome: "idle"}`, so a provider that does not report
     * behaves exactly as before.
     *
     * Do NOT log in from here. Deciding to prompt or navigate is core's; `init` only
     * finishes an attempt a previous page load started, and says what came of it.
     */
    init?(contextId: string, config: any):
        void | AuthProviderVerdict | Promise<void | AuthProviderVerdict>;
    /**
     * Optional. Resolve once this broker's *automatic* (non-interactive) login
     * attempt for `contextId` has finished — successfully or not.
     *
     * **Implement it when your secret lands well after `init()` resolves AND you have
     * not installed the identity by then.** Core's default covers everything else: it
     * waits a short grace on `login`/`secret-updated`, and it recognises a write in
     * flight by the identity being present with no secret yet — brokers write
     * identity first, secret second. A broker that installs neither during `init()`
     * and then produces a credential much later is the one shape core cannot infer,
     * and it needs this hook (`empaia-workbench` is the worked example: its token
     * arrives from a `postMessage` the workbench sends whenever it likes).
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
     *
     *  - `true` — authenticated. (Core re-reads {@link XOpatAuth.isAuthenticated}
     *    anyway, so simply depositing the credential is enough.)
     *  - `false`/nothing — we asked, and the answer is no.
     *  - `"unknown"` — we never reached the authority at all: the network is down,
     *    the RPC did not get through, the IdP is unreachable. **Core does not
     *    escalate `"unknown"` to a navigation.** Redirecting to an unreachable IdP
     *    replaces the viewer with the browser's own error page and takes the
     *    unsaved workspace with it, over what may be a two-second blip. Report it
     *    and let the ordinary 401-driven paths speak up if the session really is
     *    gone.
     *
     * This is what makes an automatic login possible at all: `window.open` without
     * a user gesture is blocked by every browser, so a broker with no silent route
     * has nothing to offer a click-less caller and core sends the user to the
     * interaction gate instead of burning a blocked popup.
     */
    loginSilent?(contextId: string, config: any): void | AuthSilentOutcome | Promise<void | AuthSilentOutcome>;
    /**
     * Optional. Whether this broker's INTERACTIVE flow can run with no user gesture
     * behind it — true for a full-page redirect or a server-side flow, false for
     * anything built on `window.open`.
     *
     * Defaults to **false**: a broker that does not claim otherwise is never asked
     * to prompt without a click.
     */
    canLoginWithoutGesture?(contextId: string, config: any): boolean;
    /**
     * Optional. Whether that gesture-free interactive flow UNLOADS the document —
     * i.e. it is a full-page redirect rather than an in-page modal or a
     * `postMessage` handover.
     *
     * At most one navigating login may run per page load: a second
     * `location.assign` in the same tick cancels the first, strands its state
     * entry, and costs the full settle timeout at every boot. Core arbitrates that
     * across ALL brokers (each broker used to guard only its own contexts, so a
     * deployment mixing two auth modules was unguarded).
     *
     * Defaults to this broker's {@link canLoginWithoutGesture} verdict, which is
     * correct for every redirect broker. Declare it explicitly when the two differ:
     * an in-page login modal or a workbench token handover is gesture-free but does
     * NOT navigate, and must not consume the single navigation slot.
     */
    navigatesOnLogin?(contextId: string, config: any): boolean;
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
    /**
     * Bound on how long to wait for the XOpatUser `login`/`secret-updated` events
     * after `broker.login` returns.
     *
     * Defaults to {@link LOGIN_TIMEOUT_MS} (5 minutes) — right for a user who just
     * clicked "Sign in" and may take a while at the identity provider, badly wrong
     * for a boot barrier that has to open the first slide. Not forwarded to the
     * broker: this bounds core's wait, not the broker's flow.
     *
     * **Bounds MACHINE work only** — consuming a returning callback, adopting an
     * existing session. It must never become a limit on how long a person may take at
     * an identity provider: an interactive login is over when the window closes, not
     * when a clock expires. That is why it is named for what it bounds.
     *
     * It used to be a single `timeoutMs` that also shortened the anti-wedge backstop
     * and the wait-for-the-credential, so the boot barrier's 8-second budget arrived
     * as "you have 8 seconds to sign in".
     */
    initTimeoutMs?: number;
    /**
     * Whether this attempt may UNLOAD the document.
     *
     * Core's decision, combining the provider's capability
     * ({@link AuthBroker.navigatesOnLogin}) with policy
     * ({@link XOpatAuth.canNavigateAway}) and the attempt budget. A provider obeys it
     * and never re-derives it: it cannot see whether the user has unsaved work, nor
     * whether another provider already claimed the one navigation this page load gets.
     *
     * `false` means "use your non-navigating route — a popup, a modal, a message
     * handover — or report that you cannot".
     */
    mayNavigate?: boolean;
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
/**
 * How long a definite `false` from a broker's silent route is reused before the
 * authority is asked again. The ladder asks more than once per boot by design
 * (phase 1 of {@link XOpatAuth.runAutoLogin}, then again inside {@link login}), and
 * only one shipped broker budgets its own probes — so without this a cold boot
 * spent four to six server round trips answering the same question.
 */
const SILENT_MEMO_MS = 30 * 1000;
/**
 * Shorter, for `"unknown"`: that verdict says the network failed, and networks come
 * back. Reusing it for the full window would keep reporting an outage that ended.
 */
const SILENT_UNKNOWN_MEMO_MS = 5 * 1000;
/**
 * Grace for a broker that raised NOTHING while its `init()` ran. See
 * {@link SETTLE_SECRET_GRACE_MS}: a broker mid-write has already raised `login`
 * (identity first, secret second), so silence means there is no partial write to
 * wait for and the full grace would be pure latency. Small but non-zero, to cover a
 * write already queued on the microtask/task queue.
 */
const SETTLE_QUIET_GRACE_MS = 50;
/**
 * Bound on how long core waits for a provider's `login()` CALL to return.
 *
 * Generous, because a popup login legitimately resolves only when the user closes
 * the window — this is a backstop against a provider that has wedged (a hung request
 * before it ever opened anything), not a policy on how long a human may take. A
 * redirect flow never returns at all and does not need to: the page is unloading.
 *
 * Deliberately LONGER than any provider's own ceiling (`saml-auth`'s popup watch is
 * 10 min): core must not give up on a window a provider is still legitimately
 * watching, or it reports a failure for a sign-in that is about to succeed. If a
 * provider ever wants longer than this, raise this — do not shorten the provider.
 *
 * No caller may shorten it. It used to be `Math.min(…, options.timeoutMs)`, which let
 * the boot barrier's 8-second budget arrive as a deadline for a human.
 */
const BROKER_CALL_TIMEOUT_MS = 15 * 60 * 1000;
const EVENT_BASES = ["login", "logout", "secret-updated", "secret-removed"] as const;
/**
 * URL parameter marking that an automatic navigating login already ran for a
 * context on a previous page load. A query parameter rather than only storage,
 * because in a sandboxed / opaque-origin frame every storage driver degrades to
 * memory — which is no marker at all across a navigation.
 */
const BOOT_MARKER_PARAM = "xo-auth-boot";
/**
 * How long the storage half of the boot marker stays valid. A login round trip
 * takes seconds; anything older is not "an attempt in progress" but an attempt
 * that died (tab closed mid-redirect, network drop) and must not veto the next one.
 */
const BOOT_MARKER_TTL_MS = 2 * 60 * 1000;

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

/** Outcome of {@link XOpatAuth.runAutoLogin}. Diagnostics; the verdicts are the answer. */
export interface AutoLoginResult {
    /** contextId → whether it ended up authenticated. */
    verdicts: Record<string, boolean>;
    /** Contexts whose boot navigation was refused because another one claimed it. */
    demoted: string[];
    /** Contexts handed to the interaction gate — they need the user's next click. */
    deferred: string[];
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
     * One silent attempt per context, shared by every concurrent caller, plus a
     * short-lived memo of the last NON-success verdict.
     *
     * Core is the only place that sees all three callers of the silent rung
     * ({@link runAutoLogin} phase 1, {@link login}'s gesture-less branch, and the
     * public {@link loginSilent}), so this is the only place the duplication can be
     * removed. Doing it here also makes the guarantee uniform: it used to hold only
     * for the one broker that had built its own coalescing and probe budget.
     */
    private _silentInFlight = new Map<string, Promise<AuthSilentOutcome>>();
    private _silentMemo = new Map<string, { at: number; outcome: AuthSilentOutcome }>();
    /**
     * What each provider's `init()` reported, if anything. Read once by the ladder —
     * a consumed callback is evidence about *this* page load only.
     */
    private _initVerdict = new Map<string, AuthProviderVerdict>();
    /**
     * Contexts whose interactive attempt has already been unlocked by a silent-rung
     * `interaction-required`. Bounds the escalation to one per page load.
     */
    private _escalated = new Set<string>();
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
    /**
     * Waiters for a context to be CLAIMED by a real broker (keyed by context id),
     * and for a broker METHOD to register (keyed by method name). Signalled from
     * {@link _configure} and {@link registerBroker} respectively — the events these
     * two waits used to poll for at 50 ms intervals.
     */
    private _claimWaiters = new Map<string, Set<() => void>>();
    private _brokerWaiters = new Map<string, Set<() => void>>();
    /** Contexts whose one automatic navigating login has been spent. */
    private _bootAttempted = new Set<string>();
    private _bootStoreHandle: any = null;

    constructor() {
        // Synchronous, and before anything else can touch the URL — see
        // `_consumeBootMarkers`.
        this._consumeBootMarkers();
    }

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
        const previous = this._brokers.get(method);
        const replaced = !!previous && previous !== broker;
        if (replaced) {
            // Every lookup already resolves to the NEW broker, so leaving the old
            // one's contexts marked initialized produced a split registry: they
            // would be driven by an object whose `init()` never ran for them.
            console.warn(`XOpatAuth: broker '${method}' was replaced; re-initializing its contexts.`);
        }
        this._brokers.set(method, broker);
        for (const cfg of this._contexts.values()) {
            if (cfg.method !== method) continue;
            // A `no-broker` / `unconfigured` verdict recorded before this broker
            // existed is now stale.
            this._settled.delete(cfg.contextId);
            if (replaced) {
                this._initialized.delete(cfg.contextId);
                this._initPromises.delete(cfg.contextId);
            }
            if (!this._initialized.has(cfg.contextId)) {
                void this.initContext(cfg.contextId);
            }
        }
        this._signal(this._brokerWaiters, method);
    }

    hasBroker(method: string): boolean { return this._brokers.has(method); }
    /**
     * Every registered broker method. For diagnostics that would otherwise hardcode
     * a list of known auth modules and silently omit every one added since.
     */
    listBrokerMethods(): string[] { return [...this._brokers.keys()]; }
    hasContext(contextId: string | null | undefined): boolean { return this._contexts.has(this._ctx(contextId)); }
    getContextConfig(contextId: string | null | undefined): AuthContextConfig | undefined {
        return this._contexts.get(this._ctx(contextId));
    }

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
        else this._signal(this._claimWaiters, contextId);   // matches `_isOwned`
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
    async ensureContextReady(contextId: string | null | undefined, graceMs = CONTEXT_GRACE_MS): Promise<boolean> {
        const ctx = this._ctx(contextId);
        if (this._isOwned(ctx)) return true;

        const requirement = this._required.get(ctx);
        await this._awaitSignal(this._claimWaiters, ctx, Math.max(0, graceMs));
        if (this._isOwned(ctx)) return true;

        const fallback = requirement?.fallback;
        if (fallback?.method && this._brokers.has(fallback.method)) {
            await this._configure({
                serviceName: requirement?.serviceName,
                ...fallback,
                contextId: ctx,
            } as AuthContextConfig, true);
            return true;
        }

        if (requirement && !this._contexts.has(ctx) && !this._unclaimedWarned.has(ctx)) {
            this._unclaimedWarned.add(ctx);
            console.warn(
                `XOpatAuth: context '${ctx}' is required but no auth module claims it. ` +
                `Load an auth module that declares it (e.g. modules.oidc-client-ts / modules.saml-auth ` +
                `with permaLoad), or give the feature an inline authBroker + authConfig.`
            );
        }
        return this._contexts.has(ctx);
    }

    /**
     * Wait up to `timeoutMs` for `key` to be signalled on `waiters`, or resolve
     * immediately when the budget is already spent.
     *
     * Replaces the two 50 ms poll loops this class used to run (waiting for a
     * context to be claimed, and for its broker to register). Both sit on the path
     * a cold `whenContextSettled` takes, so polling there meant a request could
     * wait up to a full grace period past the moment the thing it needed appeared.
     */
    private async _awaitSignal(waiters: Map<string, Set<() => void>>, key: string, timeoutMs: number): Promise<void> {
        if (timeoutMs <= 0) return;
        let release: () => void = () => {};
        let timer: any;
        const set = waiters.get(key) ?? new Set<() => void>();
        waiters.set(key, set);
        try {
            await new Promise<void>((resolve) => {
                release = resolve;
                set.add(release);
                timer = setTimeout(resolve, timeoutMs);
            });
        } finally {
            clearTimeout(timer);
            set.delete(release);
            if (!set.size) waiters.delete(key);
        }
    }

    /** Wake everyone waiting on `key`. Safe to call when nobody is. */
    private _signal(waiters: Map<string, Set<() => void>>, key: string): void {
        const set = waiters.get(key);
        if (!set) return;
        // Copy first: a resolved waiter removes itself from `set` in its `finally`.
        for (const release of [...set]) release();
    }

    /**
     * Which `XOpatUser` secret types `HttpClient` should attach for a context.
     * Read this instead of hardcoding `["jwt"]`: a broker that stores something
     * else (basic, mTLS-derived, …) declares it on the context and every consumer
     * follows with no code change. Unknown contexts default to `["jwt"]`, so a
     * resource built before its context is configured behaves as it always did.
     */
    getSecretTypes(contextId: string | null | undefined): string[] {
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
    async initContext(rawContextId: string | null | undefined): Promise<void> {
        const contextId = this._ctx(rawContextId);
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
                // What init OBSERVED — above all, a consumed callback that came back
                // `interaction_required`. Kept for the ladder to read; see
                // `runAutoLogin`. `undefined` narrows to `{outcome:"idle"}`.
                const verdict = toVerdict(await broker.init?.(contextId, cfg));
                if (verdict.outcome !== "idle") this._initVerdict.set(contextId, verdict);
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
     * The current credential generation for a context. A caller that will report a
     * failure ASYNCHRONOUSLY reads this at the moment the failure happened and hands
     * it back to {@link markNeedsInteraction} as `epoch`; core then ignores the
     * report if a newer credential has landed in the meantime.
     */
    getCredentialEpoch(contextId: string | null | undefined): number {
        return this._credentialEpoch.get(this._ctx(contextId)) ?? 0;
    }

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
     * Drop every interaction flag for a context, raising `-resolved` only if there
     * was something to drop.
     *
     * The guard matters: {@link clearNeedsInteraction} raises unconditionally (that
     * is what closes a scrim opened by a duplicate `-required`), so calling it on
     * every logout would emit `auth-interaction-resolved` for contexts that were
     * never flagged.
     */
    private _clearInteractionState(contextId: string): void {
        if (this._needsInteraction.has(contextId) || this._interactionPending.has(contextId)) {
            this.clearNeedsInteraction(contextId);
        }
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
                    // `_recordSettle` publishes; raising again here double-fired.
                    return this._recordSettle(
                        ctx, this.isAuthenticated(ctx) ? "authenticated" : "needs-interaction");
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
                return this._publishSettle(result);
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
            // after init() resolves, so give that write a bounded grace — but only
            // when there is evidence of a write to wait for.
            //
            // Only when there is evidence of a write to wait for. A broker mid-write
            // has, by construction, already installed the IDENTITY: every one of them
            // writes identity first and secret second (the invariant `_isMidLogin`
            // relies on). So "logged in, no secret yet" is a partial write in flight,
            // and worth the full grace — while "no identity at all" means nothing
            // started, and the grace is pure latency on every unauthenticated settle:
            // the common case at boot and on each `HttpClient` awaitContext.
            const budget = this._isMidWrite(ctx) ? SETTLE_SECRET_GRACE_MS : SETTLE_QUIET_GRACE_MS;
            const grace = Math.max(0, Math.min(budget, remaining()));
            if (grace > 0) await this._awaitAuth(ctx, grace);
            if (this.isAuthenticated(ctx)) return verdict("authenticated");
        }
        return verdict(remaining() <= 0 ? "timeout" : "not-authenticated");
    }

    /**
     * Is a broker part-way through installing a credential for this context?
     *
     * Brokers write the identity first and the secret second, so an identity with no
     * secret is a write in flight — the case the post-init secret grace exists for.
     * No identity at all means nothing started.
     *
     * Deliberately a state test, not a timestamp: `initContext` is kicked off from
     * `configureContext`, so by the time a settle wait runs, the identity event has
     * usually already been and gone. Anything that tried to observe activity *during*
     * the awaited init would see none and cut the grace short on a healthy login.
     */
    private _isMidWrite(ctx: string): boolean {
        const user = this._user();
        if (!user || !user.getIsLogged(ctx)) return false;
        return !this.getSecretTypes(ctx).some((type) => !!user.getSecret(type, ctx));
    }

    /** Bounded wait for the broker owning `ctx` to be registered. */
    private async _awaitBroker(ctx: string, deadline: number): Promise<AuthBroker | undefined> {
        for (;;) {
            const cfg = this._contexts.get(ctx);
            const broker = cfg && this._brokers.get(cfg.method);
            if (broker) return broker;
            const remaining = deadline - Date.now();
            if (remaining <= 0) return undefined;
            // Loop rather than wait once: without a config yet there is no method to
            // wait on, and a re-`configureContext` can move the context to a
            // different method mid-wait. The claim signal covers the first case.
            await Promise.race([
                this._awaitSignal(this._brokerWaiters, cfg?.method ?? "", remaining),
                this._awaitSignal(this._claimWaiters, ctx, remaining),
            ]);
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

    /**
     * Memoize a verdict and notify subscribers, but ONLY when it differs from the
     * one already memoized.
     *
     * Every terminal path goes through here, including the authenticated fast
     * return of {@link _settleContext}, which is hit by every authenticated
     * request that passes through `HttpClient`. Raising unconditionally would turn
     * `auth-settled` into a per-request event; raising not at all (the previous
     * behaviour of `_recordSettle`) meant the three fast paths — `authenticated`,
     * `needs-interaction`, `unconfigured` — never reached {@link onSettled} at all,
     * so the most common verdict of the lot was the one nobody could observe.
     *
     * Change-detection is sound because {@link _notify} drops the memo on every
     * auth transition of the context, so a real state change always presents as a
     * difference here.
     */
    private _publishSettle(result: AuthSettleResult): AuthSettleResult {
        const previous = this._settled.get(result.contextId);
        this._settled.set(result.contextId, result);
        if (!previous || previous.authenticated !== result.authenticated || previous.reason !== result.reason) {
            this._raiseSettled(result);
        }
        return result;
    }

    private _recordSettle(ctx: string, reason: AuthSettleReason): AuthSettleResult {
        return this._publishSettle({ contextId: ctx, authenticated: this.isAuthenticated(ctx), reason });
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

    isAuthenticated(rawContextId: string | null | undefined): boolean {
        const contextId = this._ctx(rawContextId);
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
    getToken(rawContextId: string | null | undefined): any {
        const contextId = this._ctx(rawContextId);
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
    async login(rawContextId: string | null | undefined, options: AuthLoginOptions = {}): Promise<boolean> {
        const contextId = this._ctx(rawContextId);
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

        // BOUNDED, and this is load-bearing. `initContext` resolves only when the
        // provider's `init()` settles — and a provider is explicitly ALLOWED never to
        // settle: every one parks on `new Promise(() => {})` once it has started a
        // navigation, and `oidc-client-ts` also parks when it decides this document is
        // somebody else's auth callback. Awaiting that bare is how the entire boot came
        // to hang on a wordless spinner: nothing throws, so nothing is reported, and
        // `openViewerWith` is never reached.
        //
        // `declareContext` already `void`s this call for exactly this reason. Here we
        // cannot skip it (a returning callback must be consumed before a new attempt),
        // so we race it: a timeout is "no verdict yet", not a failure, and the rungs
        // below are themselves bounded.
        if (await this._raceDeadline(this.initContext(contextId),
                Date.now() + (options.initTimeoutMs ?? SETTLE_TIMEOUT_MS))) {
            console.debug(`XOpatAuth: init of '${contextId}' has not settled; continuing without it.`);
        }
        if (this.isAuthenticated(contextId)) return true;

        if (!gesture && !this._escalated.has(contextId)) {
            // Skipped for an escalated context: the authority has already answered a
            // non-interactive request with "needs a human", so probing again spends a
            // budget to be told the same thing. Escalation exists precisely to move
            // past this rung.
            const silent = await this._tryLoginSilent(contextId, cfg, broker);
            if (silent === true) return true;
            if (silent === "unknown") {
                // Never reached the authority. A redirect from here lands the user
                // on the browser's network-error page instead of the viewer, and it
                // would do so over a transient blip. Say nothing to the gate either:
                // we have no evidence the session is actually gone.
                console.warn(`XOpatAuth: could not reach the authority for '${contextId}'; ` +
                    `leaving the session untouched rather than starting an automatic login.`);
                return false;
            }
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
            // NOT shortened by any caller. This is the literal wait for the person at
            // the identity provider — the credential arrives when they finish, and the
            // provider resolves when the window closes. A caller that merely wants to
            // stop *waiting* races this call; it does not get to end the attempt.
            const settled = this._awaitAuth(contextId, LOGIN_TIMEOUT_MS);
            try {
                // The RETURN VALUE no longer changes what we do — resolving at all is
                // the signal, because it means the attempt is over. `false` remains
                // meaningful to a reader (and to the provider contract) as "over AND
                // failed", but the credential is what decides the answer either way.
                //
                // Bounded, because a provider that never settles must not become a
                // viewer that never responds. But bounded ONLY by core's own backstop
                // — no caller may shorten it. An interactive login is over when the
                // window closes, and the provider resolves on exactly that; a clock
                // here is a guard against a provider that has wedged, never a policy
                // on how long a person may take. Letting the boot barrier's budget
                // through turned "you may take as long as you need" into "you have
                // eight seconds". A timeout is NOT a definitive failure — it means no
                // verdict arrived — so we fall through to the event wait. The redirect
                // flow legitimately never resolves here; by then the page is unloading.
                const callBound = BROKER_CALL_TIMEOUT_MS;
                // Resolved here so a provider never has to ask: an explicit caller
                // opinion wins, otherwise policy decides.
                const mayNavigate = options.mayNavigate ?? this.canNavigateAway().ok;
                // The timer is CLEARED when the race settles. `Promise.race` does not cancel
                // the loser, so leaving it armed meant every login — including one that
                // resolved or rejected in a second — printed "did not answer login" a quarter
                // of an hour later, one timer per attempt. In a long session that warning
                // arrived detached from anything, and it buried the real failure the broker
                // had reported (below) minutes earlier.
                let wedgeTimer: any;
                try {
                    await Promise.race([
                        Promise.resolve(broker.login(contextId, cfg, { gesture, mayNavigate })),
                        new Promise<undefined>((resolve) => {
                            wedgeTimer = setTimeout(() => {
                                console.warn(`XOpatAuth: broker '${cfg.method}' did not answer login for ` +
                                    `'${contextId}' within ${callBound}ms; giving up on it.`);
                                resolve(undefined);
                            }, callBound);
                        }),
                    ]);
                } finally {
                    clearTimeout(wedgeTimer);
                }
            } catch (e) {
                console.warn(`XOpatAuth: login for '${contextId}' errored`, e);
            }
            // We are here because `broker.login` RESOLVED — the attempt is over: the
            // popup closed, the modal was dismissed, the handover completed. (A
            // redirect never reaches this line; the page unloads inside the call.)
            //
            // So wait only for a secret that is already in flight, whatever the
            // verdict was. Continuing to wait on `_awaitAuth` for an attempt that has
            // finished is waiting for an event nobody is going to raise: it held the
            // recovery scrim on "working…" long after the user's window had closed.
            // The long wait exists for the *pending* case, and is spent above.
            await Promise.race([
                settled.catch(() => {}),
                new Promise<void>((resolve) => setTimeout(resolve, SETTLE_SECRET_GRACE_MS)),
            ]);
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
     *
     * Concurrent callers share one attempt, and a recent negative answer is reused
     * for a few seconds rather than re-asked. Pass `force` when the caller has reason
     * to believe the answer just changed and the memo would be stale.
     */
    async loginSilent(rawContextId: string | null | undefined,
                      opts: { force?: boolean } = {}): Promise<boolean> {
        const contextId = this._ctx(rawContextId);
        if (!this._contexts.has(contextId)) await this.ensureContextReady(contextId);
        const cfg = this._contexts.get(contextId);
        const broker = cfg && this._brokers.get(cfg.method);
        if (!cfg || !broker) return false;
        // Bounded for the same reason as in `login` — a provider's `init()` may never
        // settle — but on the SILENT budget, not the interactive one. An interactive
        // login may legitimately take minutes (the user is at the identity provider);
        // a call whose whole promise is "this shows nothing and blocks nothing" may
        // not, and inheriting `BROKER_CALL_TIMEOUT_MS` here meant a background caller
        // could wait five minutes for an answer it asked for quietly.
        await this._raceDeadline(this.initContext(contextId), Date.now() + SETTLE_TIMEOUT_MS);
        if (this.isAuthenticated(contextId)) return true;
        // Collapse the tri-state: a caller asking "am I signed in now?" gets a
        // boolean. The `"unknown"` distinction only matters to the automatic ladder,
        // which needs it to decide whether a navigation is justified.
        return (await this._tryLoginSilent(contextId, cfg, broker, opts)) === true;
    }

    /**
     * Run the broker's silent hook and report the resulting state. The hook's own
     * return value is advisory — the credential in `XOpatUser` is the verdict, so a
     * broker that just deposits a token (and returns nothing) works unchanged.
     */
    private async _tryLoginSilent(
        contextId: string, cfg: AuthContextConfig, broker: AuthBroker, opts: { force?: boolean } = {}
    ): Promise<AuthSilentOutcome> {
        if (typeof broker.loginSilent !== "function") return false;
        if (!opts.force) {
            // Coalesce: a burst of callers must become one question to the authority.
            const running = this._silentInFlight.get(contextId);
            if (running) return running;
            const memo = this._silentMemo.get(contextId);
            const ttl = memo?.outcome === "unknown" ? SILENT_UNKNOWN_MEMO_MS : SILENT_MEMO_MS;
            if (memo && Date.now() - memo.at < ttl) return memo.outcome;
        }

        const attempt = (async (): Promise<AuthSilentOutcome> => {
            let reported: void | AuthSilentOutcome = false;
            this._loginInFlight.add(contextId);
            try {
                reported = await broker.loginSilent!(contextId, cfg);
            } catch (e) {
                console.debug(`XOpatAuth: silent login for '${contextId}' did not succeed`, e);
            } finally {
                this._loginInFlight.delete(contextId);
            }
            if (this.isAuthenticated(contextId)) {
                // A silent success invalidates any memoized "not authenticated" verdict.
                this._settled.delete(contextId);
                return true;
            }
            // The credential is the verdict on SUCCESS, but only the broker can tell
            // "the authority said no" from "I never reached the authority", and the
            // difference decides whether an automatic navigation is allowed.
            return reported === "unknown" ? "unknown" : false;
        })().finally(() => { this._silentInFlight.delete(contextId); });

        this._silentInFlight.set(contextId, attempt);
        const outcome = await attempt;
        // Only a NEGATIVE verdict is worth remembering. A success has already written
        // the credential, and every caller short-circuits on `isAuthenticated` before
        // reaching here. The memo is dropped by `_notify` on any auth transition —
        // exactly the set of events that can change what the authority would answer.
        if (outcome === true) this._silentMemo.delete(contextId);
        else this._silentMemo.set(contextId, { at: Date.now(), outcome });
        return outcome;
    }

    // ── automatic (click-less) login ───────────────────────────────────────────
    //
    // Core drives this, not each broker. The rule being enforced — "a login with no
    // user gesture behind it may not open a window, and only ONE may navigate" — is
    // a property of browsers, not of OIDC or SAML, and every broker that
    // re-implemented it got a different subset right. See src/AUTH.md.

    /**
     * Read and strip the boot-attempt markers left by a previous page load.
     *
     * Called synchronously from the constructor, deliberately: `OIDCAuthClient`
     * also rewrites the URL from its own snapshot of `location` while processing a
     * returning callback, so a later strip can race it and resurrect a stale URL.
     * Stripping before any broker can possibly init removes the race entirely.
     */
    private _consumeBootMarkers(): void {
        // URL half. Survives an opaque origin (where storage is memory-only) and is
        // round-tripped for free by any broker whose return URL is the current href.
        try {
            const loc = window?.location;
            if (loc?.href && window.history?.replaceState) {
                const url = new URL(loc.href);
                const marked = url.searchParams.get(BOOT_MARKER_PARAM);
                if (marked) {
                    this._bootAttempted.add(this._ctx(marked));
                    url.searchParams.delete(BOOT_MARKER_PARAM);
                    // Preserve every other parameter — `?code=`/`?state=` of a
                    // callback still in flight are among them.
                    window.history.replaceState(window.history.state, "", url.toString());
                }
            }
        } catch (e) { /* no URL to read from; the storage half still applies */ }
    }

    /** Tab-scoped store for the storage half of the marker, or null if unavailable. */
    private _bootStore(): any {
        try {
            return this._bootStoreHandle ??= new (window as any).XOpatStorage.Session({ id: "core" });
        } catch (e) {
            return null;
        }
    }

    private _bootMarkerKey(ctx: string): string { return `auth.boot-attempt.${ctx}`; }

    /**
     * Hand back the interactive attempt this context already spent, because the
     * authority told us the attempt was *right* and merely needs a human.
     *
     * `interaction_required` is the answer to a NON-interactive request. The marker
     * that blocks us was written by that request; refusing to escalate because of it
     * is refusing to do the one thing that can succeed, and it is what put a blocking
     * "Sign in required" scrim in front of users who should simply have been
     * redirected to sign in.
     *
     * Not a loop: the rung this unlocks is a real account chooser, which cannot come
     * back `interaction_required` again. Bounded to once per page load regardless, so
     * an identity provider that does answer twice still stops here.
     */
    private _escalateToInteractive(ctx: string): boolean {
        if (this._escalated.has(ctx)) return false;
        this._escalated.add(ctx);
        this._bootAttempted.delete(ctx);
        try { this._bootStore()?.delete(this._bootMarkerKey(ctx)); } catch (e) { /* best effort */ }
        return true;
    }

    /**
     * Claim the one automatic navigation allowed for `contextId` per deployment.
     * Returns false when a previous page load already spent it.
     *
     * Two backings, read as OR, because neither covers every broker alone: a URL
     * parameter cannot be used by a broker whose `redirect_uri` is registered
     * verbatim at the identity provider (it would no longer match), and a storage
     * flag degrades to memory-only on an opaque origin — i.e. it silently vanishes
     * in exactly the sandboxed-iframe deployment the guard exists for.
     *
     * The storage half expires: a bare flag released only when a credential finally
     * lands stays set forever if the attempt died in between (tab closed
     * mid-redirect, network drop), and from then on the viewer refuses the one
     * automatic login it was allowed to start.
     */
    private _claimBootAttempt(contextId: string): boolean {
        if (this._bootAttempted.has(contextId)) return false;
        const store = this._bootStore();
        try {
            const raw = Number(store?.get(this._bootMarkerKey(contextId))) || 0;
            if (raw && Date.now() - raw < BOOT_MARKER_TTL_MS) {
                this._bootAttempted.add(contextId);
                return false;
            }
        } catch (e) { /* storage unusable — the URL half stands alone */ }

        this._bootAttempted.add(contextId);
        try { store?.set(this._bootMarkerKey(contextId), Date.now()); } catch (e) { /* best effort */ }
        try {
            const url = new URL(window.location.href);
            url.searchParams.set(BOOT_MARKER_PARAM, contextId);
            window.history.replaceState(window.history.state, "", url.toString());
        } catch (e) { /* best effort */ }
        return true;
    }

    /**
     * May we unload the document right now without destroying the user's work?
     *
     * This is **policy, and it is core's** — a provider knows whether its flow
     * navigates (a capability), never whether navigating is acceptable at this
     * moment. Keeping the two apart is what lets the common case be the automatic
     * one: on a first page load there is nothing to lose, so a redirect is simply the
     * right answer and the user should never be asked to click for it.
     *
     * Refuses in exactly three situations:
     *  - **framed** — a top-level navigation would take the embedding page with it,
     *    and identity providers refuse to render inside a frame anyway. This is the
     *    case the recovery gate exists for.
     *  - **the user has produced something** — `history.canUndo()` unions the undo
     *    stack with every registered provider (annotations register one), and the
     *    boot open resets it, so it is empty until the user actually does something.
     *  - only once boot has finished. `isUiBootComplete()` flips after the first
     *    slide opens, and the auth barrier runs before that, so "the boot redirect is
     *    always allowed" holds structurally rather than by timing luck.
     */
    canNavigateAway(): { ok: boolean; reason?: string } {
        try {
            if (window.self !== window.top) return { ok: false, reason: "framed" };
        } catch (e) {
            // Reading `top` threw: an opaque-origin frame. Framed, and then some.
            return { ok: false, reason: "framed" };
        }
        const app = (window as any).APPLICATION_CONTEXT;
        if (app?.isUiBootComplete?.() !== true) return { ok: true, reason: "booting" };
        try {
            if (app?.history?.canUndo?.() === true) return { ok: false, reason: "unsaved-work" };
        } catch (e) { /* no history is not a reason to refuse */ }
        return { ok: true };
    }

    /** Does this broker's gesture-free interactive flow unload the document? */
    private _navigatesOnLogin(contextId: string): boolean {
        const cfg = this._contexts.get(contextId);
        const broker = cfg && this._brokers.get(cfg.method);
        if (!broker || !cfg) return false;
        try {
            if (typeof broker.navigatesOnLogin === "function") return broker.navigatesOnLogin(contextId, cfg) === true;
            // Defaults to the gesture-free verdict: for every redirect broker the
            // two coincide, and a broker that cannot prompt without a click cannot
            // navigate without one either.
            return broker.canLoginWithoutGesture?.(contextId, cfg) === true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Run the automatic login for every context declared `autoLogin`, and resolve
     * once each has finished trying.
     *
     * This is the counterpart of {@link whenAllSettled}, not a replacement for it:
     * this STARTS and bounds the attempt, that one OBSERVES and memoizes the
     * verdict. The boot barrier calls both, under one shared deadline.
     *
     * Two phases, because only one of them is exclusive:
     *
     *  1. **Silent, in parallel.** A hidden `prompt=none` probe or a server-session
     *     sync shows nothing and blocks nothing, so N of them may run at once;
     *     serializing would cost N × probe timeout at every boot.
     *  2. **At most one navigating interactive login.** A redirect unloads the
     *     page, so a second one in the same tick cancels the first. The main
     *     context wins when several ask. Non-navigating gesture-free flows (an
     *     in-page modal, a `postMessage` handover) are not exclusive and all run.
     *
     * Never throws, and never blocks on a user: anything that would need a click is
     * handed to the interaction gate, which turns the user's next interaction into
     * the gesture.
     */
    async runAutoLogin(opts: { timeoutMs?: number } = {}): Promise<AutoLoginResult> {
        const deadline = Date.now() + Math.max(0, opts.timeoutMs ?? SETTLE_TIMEOUT_MS);
        const result: AutoLoginResult = { verdicts: {}, demoted: [], deferred: [] };
        const ids = this.listAutoLoginContexts();
        if (!ids.length) return result;

        // ── Phase 1: silent, parallel, nothing on screen ──────────────────────
        const silent = new Map<string, AuthProviderVerdict>();
        await Promise.all(ids.map(async (id) => {
            try {
                // `initContext` is where a RETURNING callback is consumed, so it has
                // to run before any new attempt is considered — but bounded, because a
                // provider's `init()` is allowed never to settle (it parks once it has
                // started a navigation).
                await this._raceDeadline(this.initContext(id), deadline);
                if (this.isAuthenticated(id)) { silent.set(id, { outcome: "authenticated" }); return; }

                // What init reported about the callback it just consumed. Read once
                // — it is evidence about this page load only.
                const reported = this._initVerdict.get(id);
                this._initVerdict.delete(id);
                // A conclusive report already IS the silent rung's answer — init
                // consumed a callback, which is an attempt finishing, not one skipped.
                // Re-probing would spend a budget to learn what we were just told:
                // `interaction-required` means the rung above is what is wanted, and
                // `unreachable` means the authority is not answering at all.
                if (reported && reported.outcome !== "idle") {
                    silent.set(id, reported);
                    return;
                }

                const cfg = this._contexts.get(id);
                const broker = cfg && this._brokers.get(cfg.method);
                if (!cfg || !broker) { silent.set(id, { outcome: "no-session" }); return; }
                silent.set(id, toVerdict(await this._tryLoginSilent(id, cfg, broker)));
            } catch (e) {
                console.warn(`XOpatAuth: automatic login for '${id}' failed during the silent phase`, e);
                silent.set(id, { outcome: "no-session" });
            }
        }));

        // ── Phase 2: interactive, arbitrated ──────────────────────────────────
        const remaining = ids.filter((id) => !this.isAuthenticated(id));
        for (const id of ids) if (!remaining.includes(id)) result.verdicts[id] = true;

        // Unreachable authority: no evidence the session is gone, so do not navigate
        // — a redirect to a host we just failed to reach lands the user on the
        // browser's own error page instead of the viewer.
        //
        // The gate is a different question, and answering both with "stay silent" was
        // wrong. These contexts are drawn from `remaining`, which already excludes
        // every authenticated one — so there is no session here to protect, and saying
        // nothing means `_authHeaders` has nothing to hold on: every request bound to
        // the context goes out bare and fails. Holding them behind a scrim whose click
        // can sign the user in is strictly better. A blip that arrives while a
        // credential is alive never reaches this branch, and `markNeedsInteraction`
        // defers itself in that case regardless.
        const unreachable = remaining.filter((id) => silent.get(id)?.outcome === "unreachable");
        for (const id of unreachable) {
            console.warn(`XOpatAuth: could not reach the authority for '${id}' during boot; ` +
                `not starting an automatic login. Requests bound to it will hold for a sign-in.`);
            this.markNeedsInteraction(id, { reason: "authority-unreachable" });
            result.deferred.push(id);
            result.verdicts[id] = false;
        }

        // The authority said "needs a human". Hand back the attempt it already spent,
        // so the interactive rung below can actually run — this is the escalation
        // that turns a returning `interaction_required` into a real sign-in instead
        // of a blocking scrim.
        for (const id of remaining) {
            if (silent.get(id)?.outcome !== "interaction-required") continue;
            if (this._escalateToInteractive(id)) {
                console.debug(`XOpatAuth: '${id}' needs an interactive login; escalating.`);
            }
        }

        const candidates = remaining.filter((id) => !unreachable.includes(id));
        const navigators = candidates.filter((id) => this._navigatesOnLogin(id));
        const winner = navigators.find((id) => this._contexts.get(id)?.isMain) ?? navigators[0];
        // One policy question for the whole phase: may we unload the document at all?
        // On a first page load the answer is yes and the user is simply signed in —
        // asking them to click for a redirect that costs them nothing is the wrong
        // default, and it is what put a "you need to click to sign in" panel in front
        // of people who had done nothing yet.
        const navPolicy = this.canNavigateAway();

        const attempts: Promise<void>[] = [];
        for (const id of candidates) {
            if (navigators.includes(id) && id !== winner) {
                // Demoted to on-demand rather than gated: the appbar user menu
                // already offers a per-context sign-in, which is the right
                // affordance for a context nobody has asked for yet.
                console.error(`XOpatAuth: context '${id}' also requests an automatic login, but ` +
                    `'${winner}' already started one — demoting '${id}' to on-demand. Only one ` +
                    `context per deployment may navigate at boot (see src/AUTH.md).`);
                result.demoted.push(id);
                result.verdicts[id] = false;
                continue;
            }
            if (navigators.includes(id) && !navPolicy.ok) {
                // We cannot navigate — framed, or the user has work a redirect would
                // discard. This IS the case the gate exists for: their next click
                // becomes the gesture, and a click can open a popup, which keeps the
                // page (and the work) intact.
                console.debug(`XOpatAuth: not navigating for '${id}' (${navPolicy.reason}); ` +
                    `handing over to the interaction gate.`);
                this.markNeedsInteraction(id, { reason: "login_required" });
                result.deferred.push(id);
                result.verdicts[id] = false;
                continue;
            }
            if (id === winner && !this._claimBootAttempt(id)) {
                // We navigated for this context on a previous page load and came
                // back with nothing. Going round again would trap the user at the
                // identity provider; the gate's click IS the gesture a real
                // interactive login needs.
                console.warn(`XOpatAuth: the automatic login for '${id}' already ran and returned no ` +
                    `credential; handing over to the interaction gate.`);
                this.markNeedsInteraction(id, { reason: "auto-login-failed" });
                result.deferred.push(id);
                result.verdicts[id] = false;
                continue;
            }
            attempts.push((async () => {
                try {
                    // `login` re-runs the silent rung, but `_tryLoginSilent`
                    // coalesces and memoizes it, so phase 1's answer is reused rather
                    // than re-asked. It then applies the same gesture rule, reporting
                    // to the gate when nothing here can run click-less.
                    const ok = await this.login(id, {
                        gesture: false,
                        // Only the MACHINE half of the attempt is bounded by the boot
                        // deadline. The attempt itself is not: a redirect unloads the
                        // page, and a click-less flow that ends up waiting on a person
                        // must be allowed to. The barrier's power is to stop *waiting*
                        // (the race below), never to stop the login.
                        initTimeoutMs: Math.max(0, deadline - Date.now()),
                        // Decided once, above, for the whole phase — including the
                        // one-navigation arbitration, which an individual provider
                        // cannot see.
                        mayNavigate: navPolicy.ok && navigators.includes(id),
                    });
                    result.verdicts[id] = ok;
                    if (!ok && this.isInteractionRequired(id)) result.deferred.push(id);
                } catch (e) {
                    console.warn(`XOpatAuth: automatic login for '${id}' failed`, e);
                    result.verdicts[id] = false;
                }
            })());
        }
        // Raced, not awaited. One provider that never settles must not hold the boot
        // barrier open — the viewer would sit on a spinner with nothing on screen to
        // explain it, and no error, because a promise that never resolves throws
        // nothing. A context still running at the deadline is simply not authenticated
        // *yet*; it settles on its own afterwards through `whenAllSettled` and the
        // `onChange` credential hook, and the viewer opens meanwhile.
        if (await this._raceDeadline(Promise.all(attempts), deadline)) {
            for (const id of candidates) {
                if (result.verdicts[id] === undefined) result.verdicts[id] = this.isAuthenticated(id);
            }
            // Not a failure: the login is STILL RUNNING. Saying otherwise sent people
            // hunting for a broken login that was merely slower than the viewer.
            console.info("XOpatAuth: a login is still in progress; opening the viewer without waiting " +
                "for it. It continues in the background and the viewer recovers when it completes.");
        }
        return result;
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

    async logout(contextId: string | null | undefined): Promise<void> {
        contextId = this._ctx(contextId);
        // BEFORE the broker call, not after: a redirect-based single-logout
        // (saml-auth `_startRedirect("slo", …)`) unloads the page inside
        // `broker.logout`, so anything sequenced after the await never runs.
        // Leaving the flag set kept the context in `listContextsNeedingInteraction()`
        // for the rest of the session, pinned `_settleContext` on its
        // `needs-interaction` fast path, and held every `awaitInteractive` caller.
        this._clearInteractionState(contextId);
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
        // These four transitions are exactly what can change the answer the authority
        // would give, so the silent memo cannot outlive one. Also the record that a
        // broker is writing — which is what `_runSettle` reads to decide whether a
        // post-init secret grace is worth paying.
        this._silentMemo.delete(contextId);
        // A NEW credential starts a new generation, so in-flight reports about the
        // previous one can be recognised as stale (see markNeedsInteraction).
        if (base === "secret-updated") {
            this._credentialEpoch.set(contextId, this.getCredentialEpoch(contextId) + 1);
        }
        // A real logout ends the whole session for this context, so nothing about
        // the previous credential is still actionable: an interaction flag left
        // behind would keep the context in `listContextsNeedingInteraction()` and on
        // the `needs-interaction` settle path forever, since the only thing that
        // clears it below is BECOMING authenticated. `switching: true` is excluded —
        // that is the intermediate logout `XOpatUser.login()` raises while swapping
        // identities, not the end of a session.
        if (base === "logout" && payload?.switching !== true) {
            this._clearInteractionState(contextId);
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

// ── ambient-mirror guard ──────────────────────────────────────────────────────
//
// `XOpatAuthLike` in src/types/app.d.ts is a HAND-MAINTAINED structural mirror of
// this class (plugins and modules cannot import across boundaries, so the surface
// is published as an ambient interface instead). It has drifted before —
// `whenAllSettled` lost its `awaitInteractive` option and nothing noticed.
//
// These are pure type aliases: they emit NOTHING, and they fail the IDE / any
// `tsc --noEmit` run the moment the two disagree. `_MirrorCovers` catches a public
// member the mirror forgot; `_MirrorConforms` catches a signature that narrowed.
// `keyof` on a class type yields public members only, so privates stay out of it.
//
// If you add a public method here, add it to `XOpatAuthLike` in the same commit.
type _AuthAssert<T extends true> = T;
type _AuthMirrorMissing = Exclude<keyof XOpatAuth, keyof XOpatAuthLike>;
type _MirrorCovers = _AuthAssert<[_AuthMirrorMissing] extends [never] ? true : false>;
type _MirrorConforms = _AuthAssert<XOpatAuth extends XOpatAuthLike ? true : false>;
