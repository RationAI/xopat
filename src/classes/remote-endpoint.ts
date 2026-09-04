/**
 * Shared base for transport clients that talk to a (potentially proxied,
 * potentially authenticated) remote endpoint. Owns the transport-agnostic
 * plumbing:
 *
 *   - Proxy baseURL composition (`<viewer-origin>/proxy/<alias>/…`).
 *   - Pluggable auth handler stack with a global default registry.
 *   - Secret-store binding via `XOpatUser` (per-`contextId` JWT etc.).
 *   - Refresh-on-fail delegation.
 *
 * Currently extended only by `HttpClient`. The future `WebSocketClient`
 * is expected to extend this same base and reuse the proxy + auth/secret
 * plumbing while implementing its own subprotocol-based handshake auth
 * and reconnect loop — see the planning note in
 * `~/.claude/plans/my-dicom-plugin-snoopy-turing.md` ("WebSocket-readiness
 * for the slide-protocol transport") for the design intent.
 *
 * Public API surface for consumers (sub-class or external) is intentionally
 * small: `baseURL`, `isProxied`, `resolveUrl(path)`, plus the static
 * `registerAuthHandler` / `knowsSecretType`. Everything below the line is
 * `protected` and meant for sub-classes.
 */

declare const APPLICATION_CONTEXT: { url: string };
declare const XOpatUser: { instance(): any };

/** Core auth broker, read through `globalThis` — it may not exist yet (or at all, in a worker). */
interface AuthBrokerSurface {
    getSecretTypes?(contextId?: string): string[];
    whenContextSettled?(contextId?: string,
                        opts?: { timeoutMs?: number; awaitInteractive?: boolean }): Promise<boolean>;
    /** The context's credential expired and only a user gesture can replace it. */
    isInteractionRequired?(contextId?: string): boolean;
}
const appAuth = (): AuthBrokerSurface | undefined =>
    (globalThis as any).APPLICATION_CONTEXT?.auth;

export interface AuthHandlerParams {
    secret: any;
    type: string;
    contextId?: string;
    url: string;
    method: string;
}

const DEFAULT_SECRET_TYPES = ["jwt"];
/** Statuses that drive the one-shot credential refresh unless overridden. */
const DEFAULT_REFRESH_STATUSES = [401];
/** Default bound on the pre-request auth-context wait, in ms. */
const DEFAULT_AWAIT_CONTEXT_MS = 8000;

export type AuthHandler = (
    params: AuthHandlerParams
) => Promise<Record<string, string | undefined>> | Record<string, string | undefined>;

export interface RemoteEndpointOptions {
    /** Absolute URL, or path joined onto the proxy baseURL when `proxy` is set. */
    baseURL?: string;
    /** Optional alias for server-side proxy (e.g. "wsi-server"). Routes via `/proxy/<alias>`. */
    proxy?: string;
    auth?: {
        /** Optional logical context (e.g. "wsi", "mlflow"). */
        contextId?: string;
        /**
         * Which secret types to apply, in order.
         *
         * Leave it out when you have a `contextId`: types are resolved at REQUEST
         * time from `APPLICATION_CONTEXT.auth.getSecretTypes(contextId)`, so the
         * auth module owning the context decides, and a client constructed before
         * that context was configured still follows it. Falls back to `["jwt"]`.
         * Set it explicitly only to override the owning module.
         */
        types?: string[];
        /** Per-instance handler overrides composed on top of global defaults. */
        handlers?: Record<string, AuthHandler>;
        /** Attempt a one-shot secret refresh on authn failure (HTTP 401 / WS close 1008). @default true */
        refreshOn401?: boolean;
        /**
         * Which HTTP statuses count as "authn failure" for that one-shot refresh.
         *
         * @default [401]
         *
         * Set it when the upstream reports a MISSING credential with something
         * else. FastAPI's `HTTPBearer`, for one, answers 403 when the
         * `Authorization` header is absent and 401 only once it is present and
         * rejected — so a context that lost its credential is served 403s that
         * nothing here would ever retry, and the session stays dead behind a
         * console warning. `refreshOn401: false` still disables the whole
         * mechanism, whatever this lists.
         *
         * Keep it narrow: a status listed here spends an identity-provider round
         * trip per failing request burst, so it must mean "your credential is
         * wrong or missing", never "you are authenticated but not allowed".
         */
        refreshOnStatuses?: number[];
        /** Warn if no secrets are found at request time; also the default for {@link awaitContext}. */
        required?: boolean;
        /**
         * Before issuing a request for which NO secret is available yet, wait
         * (bounded) for the auth context to finish authenticating — see
         * `APPLICATION_CONTEXT.auth.whenContextSettled`. Without this, the first
         * request burst after boot races an asynchronous login (OIDC redirect
         * return, silent renew) and is sent unauthenticated.
         *
         * @default the value of `required`
         *
         * MUST be `false` on a client an auth broker itself uses to OBTAIN a
         * credential for the same context — it would wait on its own work.
         */
        awaitContext?: boolean;
        /** Bound on that wait, in ms. @default 8000 */
        awaitContextTimeoutMs?: number;
    };
}

export class XOpatRemoteEndpoint {
    public readonly baseURL: string;
    public readonly usingProxy: boolean;
    protected readonly secretStore: any;
    protected readonly auth: {
        contextId?: string;
        /** Explicit override only — read {@link authTypes}, never this. */
        types?: string[];
        handlers: Record<string, AuthHandler>;
        refreshOn401: boolean;
        /** Resolved, non-empty. Read it through {@link refreshesOnStatus}. */
        refreshOnStatuses: number[];
        required: boolean;
        awaitContext: boolean;
        awaitContextTimeoutMs: number;
    };

    private static _globalAuthHandlers: Record<string, AuthHandler> = {};

    /** Origin parsed from `baseURL`, used for cross-origin auth-stripping. `null` when baseURL itself is not an absolute URL we can parse. */
    private _baseOrigin: string | null = null;
    /** One-shot warning suppression keyed by foreign origin. */
    private _warnedForeignOrigins: Set<string> = new Set();
    /** One-shot "required but no secret" warning suppression, keyed by context. */
    private _warnedMissingSecret: Set<string> = new Set();
    /**
     * Whether this endpoint reported a credential rejected since its last success.
     * Pure fast-path guard for {@link _reportAuthAccepted}, which sits on every OK
     * response — without it, each tile would resolve `authTypes` through the auth
     * broker just to discover there is nothing to clear.
     */
    private _sawRejection: boolean = false;

    constructor({ baseURL, proxy, auth = {} }: RemoteEndpointOptions = {}) {
        let base = "";
        if (proxy && typeof proxy === "string") {
            const domain = APPLICATION_CONTEXT.url;
            base = domain.endsWith("/")
                ? `${domain}proxy/${proxy}`
                : `${domain}/proxy/${proxy}`;
        }

        if (baseURL) {
            if (base) {
                if (baseURL.startsWith("http")) {
                    console.warn("XOpatRemoteEndpoint: baseURL is an absolute URL, which is wrong with proxy usage!", baseURL, proxy);
                }
                if (!base.endsWith("/")) base = `${base}/`;
                base = base + baseURL.replace(/^\//, "");
            } else {
                base = baseURL;
            }
        }

        if (!base) {
            throw new Error("XOpatRemoteEndpoint: baseURL or proxy alias is required");
        }

        // Collapse accidental `//` (trailing-slash domain + leading-slash path)
        // so server-side route matching like `pathname.startsWith("/proxy/")`
        // doesn't silently fail. Preserves `://`.
        this.baseURL = base.replace(/([^:])\/{2,}/g, "$1/").replace(/\/$/, "");
        this.usingProxy = !!proxy;

        try {
            const absoluteBase = /^https?:\/\//i.test(this.baseURL)
                ? this.baseURL
                : new URL(this.baseURL, (typeof window !== "undefined" && window.location?.href) || "http://localhost/").href;
            this._baseOrigin = new URL(absoluteBase).origin;
        } catch (_) {
            this._baseOrigin = null;
        }

        this.secretStore = XOpatUser.instance();

        const {
            contextId = undefined,
            types = undefined,
            handlers = {},
            refreshOn401 = true,
            refreshOnStatuses = undefined,
            required = false,
            awaitContext = undefined,
            awaitContextTimeoutMs = DEFAULT_AWAIT_CONTEXT_MS,
        } = auth;

        this.auth = {
            contextId,
            // Deliberately NOT defaulted here: resolving lazily in `authTypes` is
            // what lets a client built before its context was configured still
            // follow the owning auth module's declaration.
            types,
            handlers: { ...XOpatRemoteEndpoint._globalAuthHandlers, ...handlers },
            refreshOn401,
            refreshOnStatuses: Array.isArray(refreshOnStatuses) && refreshOnStatuses.length
                ? refreshOnStatuses.slice()
                : DEFAULT_REFRESH_STATUSES.slice(),
            required,
            awaitContext: awaitContext ?? required,
            awaitContextTimeoutMs,
        };
    }

    /**
     * Secret types to attach, resolved at REQUEST time. An explicit `auth.types`
     * always wins; otherwise the auth module owning the context declares them.
     */
    protected get authTypes(): string[] {
        const explicit = this.auth.types;
        if (Array.isArray(explicit) && explicit.length) return explicit;
        const declared = appAuth()?.getSecretTypes?.(this.auth.contextId);
        return Array.isArray(declared) && declared.length ? declared : DEFAULT_SECRET_TYPES;
    }

    /** True when this endpoint was constructed with a `proxy` alias. */
    get isProxied(): boolean { return this.usingProxy; }

    /**
     * The auth context this endpoint authenticates against, or `undefined` for the
     * main one. Public so a failure handler can ask WHICH context a dead request
     * belonged to instead of assuming the main identity — a 401 from a sub-context
     * slide must not accuse (and drop the credential of) `core`.
     */
    get authContextId(): string | undefined { return this.auth.contextId; }

    /** Resolve a path (relative or absolute) against `this.baseURL`. */
    resolveUrl(path: string): string {
        return /^https?:\/\//i.test(path)
            ? path
            : `${this.baseURL}${path.startsWith("/") ? "" : "/"}${path}`;
    }

    /**
     * True when `url` is an absolute URL whose origin differs from `baseURL`.
     * Relative URLs are always same-origin (they resolve onto `baseURL`).
     * Prevents auth/CSRF leakage when a URL template or caller hands us an
     * absolute URL pointing somewhere other than the configured upstream.
     */
    isCrossOriginUrl(url: string): boolean {
        if (!url || !/^https?:\/\//i.test(url)) return false;
        if (!this._baseOrigin) return false; // can't compare; defer to caller
        try {
            return new URL(url).origin !== this._baseOrigin;
        } catch {
            return false;
        }
    }

    /** Log once per foreign origin so absolute-URL misconfigurations are visible without flooding the console. */
    protected _warnCrossOriginOnce(url: string): void {
        let foreign = "";
        try { foreign = new URL(url).origin; } catch { foreign = url; }
        if (this._warnedForeignOrigins.has(foreign)) return;
        this._warnedForeignOrigins.add(foreign);
        console.warn(
            `XOpatRemoteEndpoint: dropping auth headers for cross-origin URL (base=${this._baseOrigin}, target=${foreign}). ` +
            `Absolute URLs that bypass the configured upstream are sent unauthenticated to avoid leaking credentials.`
        );
    }

    /** Register a global auth handler shared by every endpoint instance. */
    static registerAuthHandler(type: string, handler: AuthHandler): void {
        XOpatRemoteEndpoint._globalAuthHandlers[type] = handler;
    }

    /** True if at least one handler is registered for the given secret type. */
    static knowsSecretType(type: string): boolean {
        return type in XOpatRemoteEndpoint._globalAuthHandlers;
    }

    /**
     * Walk the registered handlers for the resolved secret types ({@link authTypes})
     * and merge any header maps they produce. When `auth.awaitContext` is on and no
     * credential exists yet, this first waits (bounded) for the auth context to
     * finish authenticating. Header-shape is the natural fit for HTTP;
     * a WebSocket subclass that needs to surface secrets via the handshake
     * subprotocol can either call this and translate the result, or override
     * the collection step entirely.
     *
     * `sent` is an optional out-parameter recording, per type, the credential this
     * request is actually carrying. A 401 handler needs that rather than "whatever is
     * attached now": the two diverge exactly when a burst of in-flight requests holds
     * an expired token and one of them refreshes it, and blaming the fresh credential
     * for the stale burst's 401s would park a healthy context. See
     * {@link _maybeRefreshSecrets}.
     */
    protected async _authHeaders(url: string, method: string, signal?: AbortSignal,
                                 sent?: Record<string, any>): Promise<Record<string, string>> {
        if (this.isCrossOriginUrl(url)) {
            this._warnCrossOriginOnce(url);
            return {};
        }

        const { handlers, contextId, required, awaitContext } = this.auth;
        let types = this.authTypes;

        // Auth contexts authenticate asynchronously (OIDC redirect return, silent
        // renew). Without this wait the first request burst after boot races the
        // login and goes out bare, and the upstream answers 401.
        //
        // The `isInteractionRequired` arm is deliberately NOT gated on
        // `awaitContext`/`required`: those say "this endpoint needs auth before it
        // can start", whereas an expired context means "the credential everyone
        // was already using just died" — which applies to every caller, including
        // the core client (`required: false`) that tiles borrow headers from.
        // Holding here is what turns a 401 burst into a queue that drains on
        // sign-in, instead of a wave of dead tiles.
        const interactionPending = appAuth()?.isInteractionRequired?.(contextId) === true;
        if (interactionPending || (awaitContext && !this._hasAnySecret(types))) {
            await this._awaitAuthContext(signal, interactionPending);
            // The owning module may only now have declared its secret types.
            types = this.authTypes;
        }

        const headers: Record<string, string> = {};
        let hasAnySecret = false;

        for (const type of types) {
            const handler = handlers[type];
            if (!handler) continue;
            const secret = this.secretStore.getSecret(type, contextId);
            if (!secret) continue;
            hasAnySecret = true;
            if (sent) sent[type] = secret;
            const addition = await handler({ secret, type, contextId, url, method });
            if (addition && typeof addition === "object") Object.assign(headers, addition);
        }

        if (required) this._reportSecretPresence(hasAnySecret, types);
        return headers;
    }

    /**
     * Whether a response with this status should drive the one-shot credential
     * refresh. Single decision point for every transport (request, stream, socket)
     * so they cannot drift apart.
     */
    protected refreshesOnStatus(status: number): boolean {
        return this.auth.refreshOn401 && this.auth.refreshOnStatuses.includes(status);
    }

    /** True when at least one of `types` currently has a secret for our context. */
    protected _hasAnySecret(types: string[]): boolean {
        const { contextId } = this.auth;
        return types.some((t) => !!this.secretStore.getSecret(t, contextId));
    }

    /**
     * Bounded wait for the auth context to finish authenticating. Never throws,
     * and never outlives the caller's abort. A failed wait falls through to an
     * unauthenticated request on purpose: the upstream's own 401 carries better
     * diagnostics than a synthetic client-side error, and it keeps a transient
     * auth outage from being recorded as a permanent client failure.
     */
    protected async _awaitAuthContext(signal?: AbortSignal, awaitInteractive = false): Promise<boolean> {
        const auth = appAuth();
        if (typeof auth?.whenContextSettled !== "function") return false;
        // `awaitInteractive` lifts the bound to the interactive login timeout —
        // the user has to see the prompt, click, and complete an IdP round trip,
        // which does not fit in awaitContextTimeoutMs (8 s by default).
        const settled = Promise.resolve(
            auth.whenContextSettled(this.auth.contextId,
                { timeoutMs: this.auth.awaitContextTimeoutMs, awaitInteractive })
        ).catch(() => false);
        if (!signal) return settled;
        if (signal.aborted) return false;
        let onAbort!: () => void;
        const aborted = new Promise<boolean>((resolve) => {
            onAbort = () => resolve(false);
            signal.addEventListener("abort", onAbort, { once: true });
        });
        try {
            return await Promise.race([settled, aborted]);
        } finally {
            signal.removeEventListener("abort", onAbort);
        }
    }

    /**
     * One warning per context when a `required` endpoint has no credential —
     * tile bursts would otherwise emit hundreds. Re-armed once a secret attaches,
     * so a later regression is reported again.
     */
    private _reportSecretPresence(hasAnySecret: boolean, types: string[]): void {
        const key = this.auth.contextId || "core";
        if (hasAnySecret) {
            this._warnedMissingSecret.delete(key);
            return;
        }
        if (this._warnedMissingSecret.has(key)) return;
        this._warnedMissingSecret.add(key);
        console.warn(
            `XOpatRemoteEndpoint: auth.required=true but no secret is available for context '${key}' ` +
            `(types: ${types.join(", ")}, base: ${this.baseURL}). Requests are being sent WITHOUT auth ` +
            `headers and will likely fail with 401. Check that an auth module claims this context — see src/AUTH.md.`
        );
    }

    /**
     * Ask the secret store to refresh credentials for the resolved secret types.
     *
     * The credentials the request CARRIED are reported REJECTED first. That report is
     * the only thing that distinguishes "the provider cannot issue a token" from "the
     * provider issues tokens this resource refuses" — and the second case is what used
     * to run away: the refresh succeeded every time, `setSecret` re-armed the attempt
     * budget, the retry 401'd, and the cycle repeated without bound. See
     * `XOpatUser._rejectionStreak`.
     *
     * `sent` comes from {@link _authHeaders} and matters: reading the store here
     * instead would report whatever is attached *now*. When a burst of in-flight
     * requests shares an expired token and one of them refreshes it, the burst's late
     * 401s would then accuse the brand-new credential — two of those and a perfectly
     * healthy context is parked on the interaction gate. The store fallback keeps
     * callers that do not thread it working as before.
     *
     * `sent` also tells us when there is nothing to do: a credential that is no longer
     * the attached one was already replaced while this request was in flight, so the
     * caller should simply retry with what is there. Asking again would spend one IdP
     * round trip per member of a stale burst.
     *
     * "Nothing was sent" is a THIRD case and must not be folded into that one. A
     * request that carried no credential at all — because the context never got one,
     * or lost it (an identity swap drops a context's secrets, see `user.ts`
     * `_clearContextSecrets`) — has nothing to supersede it, so retrying bare just
     * reproduces the failure and the context stays dead for the session. Asking the
     * provider is the only thing that can fix it, and it is exactly what the provider
     * is for. Safe to do unconditionally: `requestSecretUpdate` rejects at once when
     * no auth module listens on the context, and is budgeted per secret
     * (`XOpatUser.REFRESH_COOLDOWN_MS` / `MAX_REFRESH_FAILURES`) so a provider that
     * cannot deliver is asked twice, not once per request.
     */
    protected async _maybeRefreshSecrets(sent?: Record<string, any>): Promise<boolean> {
        const { contextId } = this.auth;
        const types = this.authTypes;
        const stale: string[] = [];
        let carriedAny = false;

        for (const t of types) {
            const current = this.secretStore.getSecret(t, contextId);
            const inUse = sent?.[t] ?? current;
            if (!inUse) continue;
            carriedAny = true;
            this.secretStore.reportSecretRejected?.(inUse, t, contextId);
            this._sawRejection = true;
            if (inUse !== current) continue;   // already superseded — nothing to ask for
            stale.push(t);
        }

        // Every credential this request carried has already been replaced. Report the
        // retry as "refreshed" so the caller rebuilds its headers and tries once more.
        if (carriedAny && !stale.length) return true;

        // Nothing carried: ask for every type the context declares, and let the
        // presence of a credential afterwards be the verdict — a provider may resolve
        // its update without this promise carrying the value.
        const request = stale.length ? stale : types;

        try {
            for (const t of request) {
                await this.secretStore.requestSecretUpdate(t, contextId);
            }
            return carriedAny || this._hasAnySecret(types);
        } catch (_) {
            return !carriedAny && this._hasAnySecret(types);
        }
    }

    /**
     * A request carrying this context's credentials was accepted — clears the
     * rejection streak so a recovered context is not judged by its past 401s.
     *
     * On the success path of EVERY request, tiles included, so the common case must
     * cost nothing: `_sawRejection` short-circuits before `authTypes` is even
     * resolved (that getter reaches into the auth broker). Only an endpoint that has
     * actually seen a 401 pays for the clear.
     */
    protected _reportAuthAccepted(): void {
        if (!this._sawRejection) return;
        this._sawRejection = false;
        const { contextId } = this.auth;
        const store = this.secretStore;
        if (typeof store?.reportSecretAccepted !== "function") return;
        for (const t of this.authTypes) store.reportSecretAccepted(t, contextId);
    }
}
