/**
 * Error thrown for HTTP failures in HTTPClient.
 * The content is not guaranteed to be translated.
 */
export class HTTPError extends Error {
    /** The Fetch API Response object, if available. */
    public response?: Response;
    /** Raw response body text returned by the server. */
    public textData?: string;
    /** HTTP status code derived from the response (default 500). */
    public statusCode: number;

    /**
     * @param message - Error message.
     * @param response - Fetch Response associated with the error.
     * @param textData - Raw response text for diagnostics.
     */
    constructor(message: string, response?: Response, textData?: string) {
        super(message);
        this.name = 'HTTPError';
        this.response = response;
        this.textData = textData;
        this.statusCode = response?.status || 500;

        // Fix prototype chain for custom errors in TS
        Object.setPrototypeOf(this, HTTPError.prototype);
    }
}

// Support for legacy global access if required by your environment
window.HTTPError = HTTPError;

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

export interface HttpClientOptions {
    /** e.g. "https://mlflow.myhost.com/api/2.0/mlflow", must be defined if proxy is not defined */
    baseURL?: string;
    /** Optional alias for server-side proxy (e.g. "openai"). Routes via `/proxy/{alias}`. */
    proxy?: string;
    /** @default 30000 */
    timeoutMs?: number;
    /** @default 3 */
    maxRetries?: number;
    auth?: {
        /** optional logical context (e.g., "mlflow", "analytics") */
        contextId?: string;
        /** which secret types to apply (default ["jwt"]) in order */
        types?: string[];
        /** map of type=>handler override for this instance */
        handlers?: Record<string, AuthHandler>;
        /** if true, attempts a one-shot secret refresh via user interface @default true */
        refreshOn401?: boolean;
        /** auth.required flag */
        required?: boolean;
    };
}

export interface RequestOptions {
    /** @default "GET" */
    method?: string;
    query?: Record<string, any>;
    body?: any;
    headers?: Record<string, string>;
    /** @default "auto" */
    expect?: "json" | "text" | "auto";
}

// Global declarations for external dependencies
declare const APPLICATION_CONTEXT: { url: string };
declare const XOpatUser: { instance(): any };
declare interface Window {
    XOPAT_CSRF_TOKEN?: string;
    HTTPError: typeof HTTPError;
    HttpClient: any;
    XOpatSessionRecovery?: {
        isReloading?: boolean;
        handle?: (reason?: { status?: number; code?: string; message?: string; source?: string }) => boolean;
    };
}

/**
 * Minimal HTTP client with:
 * - pluggable auth (JWT by default) with context-aware secrets
 * - automatic auth headers via handlers
 * - JSON/query handling
 * - configurable retries for 429/5xx
 * - smart response parsing
 * - throws HTTPError for HTTP failures
 */
export class HttpClient {
    public baseURL: string;
    public timeoutMs: number;
    public maxRetries: number;
    private secretStore: any;
    private usingProxy: boolean;
    private auth: {
        contextId?: string;
        types: string[];
        handlers: Record<string, AuthHandler>;
        refreshOn401: boolean;
        required: boolean;
    };

    private static _globalAuthHandlers: Record<string, AuthHandler> = {};

    constructor({ baseURL, proxy, timeoutMs = 30000, maxRetries = 3, auth = {} }: HttpClientOptions = {}) {
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
                    console.warn("HttpClient: baseURL is an absolute URL, which is wrong with proxy usage!", baseURL, proxy);
                }
                if (!base.endsWith("/")) {
                    base = `${base}/`;
                }
                base = base + baseURL.replace(/^\//, "");
            } else {
                base = baseURL;
            }
        }

        if (!base) {
            throw new Error("HttpClient: baseURL or proxy alias is required");
        }

        this.baseURL = base.replace(/\/$/, "");
        this.timeoutMs = timeoutMs;
        this.maxRetries = Math.max(0, maxRetries);
        this.secretStore = XOpatUser.instance();
        this.usingProxy = !!proxy;

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
            handlers: { ...HttpClient._globalAuthHandlers, ...handlers },
            refreshOn401,
            required,
        };
    }

    /** Register a global auth handler. */
    static registerAuthHandler(type: string, handler: AuthHandler): void {
        HttpClient._globalAuthHandlers[type] = handler;
    }

    /** Check type validity */
    static knowsSecretType(type: string): boolean {
        return type in HttpClient._globalAuthHandlers;
    }

    private async _authHeaders(url: string, method: string): Promise<Record<string, string>> {
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
                `HttpClient: auth.required=true for proxy request but no secrets found` +
                (contextId ? ` for context '${contextId}'` : "") +
                `. Request will be sent without auth headers and will likely result in 401.`
            );
        }

        return headers;
    }

    private _isRetriable(status: number): boolean {
        return status === 429 || (status >= 500 && status < 600);
    }

    private _parseErrorPayload(textData?: string): { code?: string; error?: string; message?: string; details?: any } | null {
        if (!textData) return null;
        try {
            const parsed = JSON.parse(textData);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    private _tryHandleSessionExpiry(status: number, textData?: string): boolean {
        if (!this.usingProxy) return false;

        const payload = this._parseErrorPayload(textData);
        const code = payload?.code;
        const message = String(payload?.error || payload?.message || textData || "");
        const isSessionError =
            code === "RPC_NO_SESSION" ||
            code === "RPC_BAD_CSRF" ||
            (status === 401 && /missing or invalid session/i.test(message)) ||
            (status === 403 && /invalid csrf token/i.test(message));

        if (!isSessionError) return false;

        try {
            return !!(window as any).XOpatSessionRecovery?.handle?.({
                status,
                code,
                message,
                source: "proxy",
            });
        } catch (e) {
            console.warn("HttpClient: session recovery handler failed.", e);
            return false;
        }
    }

    private _delay(ms: number): Promise<void> {
        return new Promise(r => setTimeout(r, ms));
    }

    /**
     * Core request helper
     * @param path - path relative to baseURL (can also be absolute)
     */
    async request(path: string, { method = "GET", query, body, headers = {}, expect = "auto" }: RequestOptions = {}): Promise<any> {
        const isAbsolute = /^https?:\/\//i.test(path);
        let url = isAbsolute ? path : `${this.baseURL}${path.startsWith("/") ? "" : "/"}${path}`;

        if (query && typeof query === "object") {
            const usp = new URLSearchParams();
            for (const [k, v] of Object.entries(query)) {
                if (v === undefined || v === null) continue;
                if (Array.isArray(v)) v.forEach(x => usp.append(k, String(x)));
                else usp.append(k, String(v));
            }
            const qs = usp.toString();
            if (qs) url += (url.includes("?") ? "&" : "?") + qs;
        }

        const hasBody = body !== undefined && body !== null && !/^(GET|HEAD)$/i.test(method);

        const getBaseHeaders = async () => ({
            ...(hasBody ? { "Content-Type": "application/json" } : {}),
            ...(await this._authHeaders(url, method)),
            ...headers,
            ...(this.usingProxy && typeof window?.XOPAT_CSRF_TOKEN
                ? { "X-XOPAT-CSRF": window.XOPAT_CSRF_TOKEN }
                : {})
        });

        let currentHeaders = await getBaseHeaders();

        if (this.usingProxy && !window?.XOPAT_CSRF_TOKEN) {
            console.warn("HttpClient: CSRF token not found in window.XOPAT_CSRF_TOKEN with proxy - the request will likely fail.", path);
        }

        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), this.timeoutMs);

        const getInit = (currentHeaders: Record<string, string>): RequestInit => ({
            method,
            headers: currentHeaders,
            signal: controller.signal,
            ...(this.usingProxy ? { credentials: "same-origin" } : {}),
            ...(hasBody ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
        });

        let attempt = 0;
        let refreshed = false;

        while (true) {
            try {
                const res = await fetch(url, getInit(currentHeaders));
                clearTimeout(to);

                if (!res.ok) {
                    const text = await res.text().catch(() => "");

                    if (this._tryHandleSessionExpiry(res.status, text)) {
                        throw new HTTPError(`HTTP ${method} ${url} failed: ${res.status}`, res, text);
                    }

                    if (res.status === 401 && this.auth.refreshOn401 && !refreshed) {
                        refreshed = await this._maybeRefreshSecrets();
                        if (refreshed) {
                            currentHeaders = await getBaseHeaders();
                            continue;
                        }
                    }

                    if (this._isRetriable(res.status) && attempt < this.maxRetries) {
                        attempt += 1;
                        const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
                        await this._delay(backoff);
                        continue;
                    }

                    throw new HTTPError(`HTTP ${method} ${url} failed: ${res.status}`, res, text);
                }

                const ct = (res.headers.get("content-type") || "").toLowerCase();
                if (expect === "text") return await res.text();
                if (expect === "json") return await res.json();

                if (ct.includes("application/json")) return await res.json();
                try { return await res.json(); } catch (_) {}
                try { return await res.text(); } catch (_) {}
                return {};
            } catch (err: any) {
                if (err.name === "AbortError") {
                    throw new HTTPError(`HTTP ${method} ${url} aborted after ${this.timeoutMs} ms`);
                }
                if (attempt < this.maxRetries) {
                    attempt += 1;
                    const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
                    await this._delay(backoff);
                    continue;
                }
                throw err;
            }
        }
    }

    private async _maybeRefreshSecrets(): Promise<boolean> {
        const { types, contextId } = this.auth;
        try {
            for (const t of types || []) {
                await this.secretStore.requestSecretUpdate(t, contextId);
            }
            return true;
        } catch (_) { return false; }
    }
}

// Global assignment for side-effect compatibility
window.HttpClient = HttpClient;

// ---------------------- Default auth handlers ----------------------
HttpClient.registerAuthHandler("jwt", async ({ secret }) => {
    if (!secret) return {};
    return { Authorization: `Bearer ${secret}` };
});

HttpClient.registerAuthHandler("basic", async ({ secret }) => {
    if (!secret || !secret.username) return {};
    const raw = `${secret.username}:${secret.password || ""}`;
    const b64 = btoa(raw);
    return { Authorization: `Basic ${b64}` };
});