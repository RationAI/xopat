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

import { XOpatRemoteEndpoint } from "./remote-endpoint";
import type { RemoteEndpointOptions } from "./remote-endpoint";

// Re-export for backward compatibility (consumers historically imported these from http-client).
export type { AuthHandler, AuthHandlerParams } from "./remote-endpoint";

export interface HttpClientOptions extends RemoteEndpointOptions {
    /** @default 30000 */
    timeoutMs?: number;
    /** @default 3 */
    maxRetries?: number;
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
 * HTTP client built on top of `XOpatRemoteEndpoint`:
 * - pluggable auth (JWT by default) with context-aware secrets        (← base)
 * - automatic auth headers via handlers                                 (← base)
 * - proxy baseURL composition + `XOpatUser`-bound secret store           (← base)
 * - JSON/query handling                                                  (← here)
 * - configurable retries for 429/5xx                                     (← here)
 * - 401-triggered secret refresh                                         (← here)
 * - smart response parsing                                               (← here)
 * - throws `HTTPError` for HTTP failures                                 (← here)
 *
 * NOTE FOR FUTURE MAINTAINERS: a sibling `WebSocketClient` is planned to
 * extend `XOpatRemoteEndpoint` directly and reuse the auth/proxy/secret
 * plumbing factored out below. Anything specifically tied to `fetch` /
 * `Response` / CSRF / 429-retry belongs here in `HttpClient`; transport-
 * agnostic auth/proxy work belongs in `XOpatRemoteEndpoint`. See the plan
 * note in `~/.claude/plans/my-dicom-plugin-snoopy-turing.md` (WebSocket-
 * readiness for the slide-protocol transport) for the design intent.
 */
export class HttpClient extends XOpatRemoteEndpoint {
    public timeoutMs: number;
    public maxRetries: number;

    constructor(opts: HttpClientOptions = {}) {
        const { timeoutMs = 30000, maxRetries = 3, ...endpointOpts } = opts;
        super(endpointOpts);
        this.timeoutMs = timeoutMs;
        this.maxRetries = Math.max(0, maxRetries);
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

    // `_maybeRefreshSecrets`, `resolveUrl`, and `isProxied` live on the
    // `XOpatRemoteEndpoint` base — they are reused as-is by any subclass.

    /**
     * Issue a single fetch and return the raw Response. Sibling of `request()`
     * for callers that need streaming or binary bodies (e.g. tile downloads).
     * Applies the same auth-header + CSRF + 401-refresh + retry semantics as
     * `request()`, but does not parse the body.
     *
     * The caller supplies `init.method`, `init.body`, `init.signal`, etc.
     * Headers are merged in this order: auth handlers → CSRF (if proxied) →
     * `init.headers` (caller-supplied wins on collisions).
     *
     * Throws `HTTPError` on non-retriable 4xx/5xx (after refresh + retries
     * are exhausted). Returns `Response` only when `res.ok` is true.
     */
    async fetchRaw(path: string, init: RequestInit = {}): Promise<Response> {
        const url = this.resolveUrl(path);
        const method = (init.method || "GET").toUpperCase();
        const callerHeaders = (init.headers as Record<string, string> | undefined) || undefined;

        const buildHeaders = async (): Promise<Record<string, string>> => ({
            ...(await this._authHeaders(url, method)),
            ...(this.usingProxy && typeof window?.XOPAT_CSRF_TOKEN
                ? { "X-XOPAT-CSRF": window.XOPAT_CSRF_TOKEN as string }
                : {}),
            ...(callerHeaders || {}),
        });

        if (this.usingProxy && !window?.XOPAT_CSRF_TOKEN) {
            console.warn("HttpClient.fetchRaw: CSRF token not in window.XOPAT_CSRF_TOKEN with proxy — request will likely fail.", path);
        }

        // If the caller didn't pass a signal, compose our own timeout.
        const ownController = init.signal ? null : new AbortController();
        const timeoutHandle = ownController
            ? setTimeout(() => ownController.abort(), this.timeoutMs)
            : null;
        const signal = init.signal ?? ownController!.signal;

        let currentHeaders = await buildHeaders();
        let attempt = 0;
        let refreshed = false;

        try {
            while (true) {
                try {
                    const res = await fetch(url, {
                        ...init,
                        method,
                        headers: currentHeaders,
                        signal,
                        ...(this.usingProxy ? { credentials: "same-origin" as RequestCredentials } : {}),
                    });

                    if (!res.ok) {
                        const text = await res.clone().text().catch(() => "");

                        if (this._tryHandleSessionExpiry(res.status, text)) {
                            throw new HTTPError(`HTTP ${method} ${url} failed: ${res.status}`, res, text);
                        }

                        if (res.status === 401 && this.auth.refreshOn401 && !refreshed) {
                            refreshed = await this._maybeRefreshSecrets();
                            if (refreshed) {
                                currentHeaders = await buildHeaders();
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

                    return res;
                } catch (err: any) {
                    if (err instanceof HTTPError) throw err;
                    if (err?.name === "AbortError") {
                        throw new HTTPError(`HTTP ${method} ${url} aborted`);
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
        } finally {
            if (timeoutHandle !== null) clearTimeout(timeoutHandle);
        }
    }
}

/**
 * Adapter shape consumed by libraries (flex-renderer, geotiff) that need an
 * auth-aware `fetch` shim. The contract is duck-typed in those libraries:
 * `{ fetch(url, init?) => Promise<Response> }` with full RequestInit support
 * (method, headers, body, signal, Range headers, binary responses).
 */
export interface HttpAdapter {
    fetch(url: string, init?: RequestInit): Promise<Response>;
}

/**
 * Build an HttpAdapter that routes each request to the HttpClient owning the
 * URL (via SLIDE_PROTOCOLS prefix matching). Falls back to native fetch when
 * no protocol claims the URL — matches the libraries' adapter-absent behavior.
 */
export function createHttpClientAdapter(): HttpAdapter {
    return {
        fetch(url: string, init?: RequestInit): Promise<Response> {
            const protocols = (window as any).SLIDE_PROTOCOLS;
            const client: HttpClient | undefined = protocols?.getActiveClientForUrl?.(url);
            return client ? client.fetchRaw(url, init) : window.fetch(url, init);
        }
    };
}

// Global assignment for side-effect compatibility
window.HttpClient = HttpClient;
(HttpClient as any).createAdapter = createHttpClientAdapter;

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