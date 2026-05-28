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

export interface AuthHandlerParams {
    secret: any;
    type: string;
    contextId?: string;
    url: string;
    method: string;
}

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
        /** Which secret types to apply (default ["jwt"]) in order. */
        types?: string[];
        /** Per-instance handler overrides composed on top of global defaults. */
        handlers?: Record<string, AuthHandler>;
        /** Attempt a one-shot secret refresh on authn failure (HTTP 401 / WS close 1008). @default true */
        refreshOn401?: boolean;
        /** Warn (when proxied) if no secrets found at request time. */
        required?: boolean;
    };
}

export class XOpatRemoteEndpoint {
    public readonly baseURL: string;
    public readonly usingProxy: boolean;
    protected readonly secretStore: any;
    protected readonly auth: {
        contextId?: string;
        types: string[];
        handlers: Record<string, AuthHandler>;
        refreshOn401: boolean;
        required: boolean;
    };

    private static _globalAuthHandlers: Record<string, AuthHandler> = {};

    /** Origin parsed from `baseURL`, used for cross-origin auth-stripping. `null` when baseURL itself is not an absolute URL we can parse. */
    private _baseOrigin: string | null = null;
    /** One-shot warning suppression keyed by foreign origin. */
    private _warnedForeignOrigins: Set<string> = new Set();

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
            types = ["jwt"],
            handlers = {},
            refreshOn401 = true,
            required = false,
        } = auth;

        this.auth = {
            contextId,
            types,
            handlers: { ...XOpatRemoteEndpoint._globalAuthHandlers, ...handlers },
            refreshOn401,
            required,
        };
    }

    /** True when this endpoint was constructed with a `proxy` alias. */
    get isProxied(): boolean { return this.usingProxy; }

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
     * Walk the registered handlers for the configured `auth.types` and merge
     * any header maps they produce. Header-shape is the natural fit for HTTP;
     * a WebSocket subclass that needs to surface secrets via the handshake
     * subprotocol can either call this and translate the result, or override
     * the collection step entirely.
     */
    protected async _authHeaders(url: string, method: string): Promise<Record<string, string>> {
        if (this.isCrossOriginUrl(url)) {
            this._warnCrossOriginOnce(url);
            return {};
        }

        const { types, handlers, contextId, required } = this.auth;
        const headers: Record<string, string> = {};
        let hasAnySecret = false;

        for (const type of types || []) {
            const handler = handlers[type];
            if (!handler) continue;
            const secret = this.secretStore.getSecret(type, contextId);
            if (!secret) continue;
            hasAnySecret = true;
            const addition = await handler({ secret, type, contextId, url, method });
            if (addition && typeof addition === "object") Object.assign(headers, addition);
        }

        if (!hasAnySecret && required && this.usingProxy) {
            console.warn(
                `XOpatRemoteEndpoint: auth.required=true for proxy request but no secrets found` +
                (contextId ? ` for context '${contextId}'` : "") +
                `. Request will be sent without auth headers and will likely result in 401.`
            );
        }

        return headers;
    }

    /** Ask the secret store to refresh credentials for the configured `auth.types`. */
    protected async _maybeRefreshSecrets(): Promise<boolean> {
        const { types, contextId } = this.auth;
        try {
            for (const t of types || []) {
                await this.secretStore.requestSecretUpdate(t, contextId);
            }
            return true;
        } catch (_) { return false; }
    }
}
