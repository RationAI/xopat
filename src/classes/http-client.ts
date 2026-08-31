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
    /**
     * Caller-owned abort signal. Composed with the client's internal timeout —
     * the request aborts on whichever fires first, so a caller signal never
     * removes the timeout backstop (a stalled upstream that neither closes the
     * socket nor trips the signal would otherwise hang forever).
     */
    signal?: AbortSignal;
    /**
     * Override the client's `timeoutMs` for this call. `0` (or negative)
     * disables the timeout entirely, making the caller `signal` the sole
     * deadline — use only for genuinely open-ended calls (e.g. a chat turn
     * whose lifetime is owned by the turn's abort controller).
     */
    timeoutMs?: number;
    /**
     * Connection-pool scheduling hint (NOT auth/security). `"background"` routes
     * the request through {@link APPLICATION_CONTEXT.requestScheduler}, which caps
     * concurrent background requests per origin so slow POSTs (e.g. LLM inference)
     * never starve interactive tile loading. `"background-urgent"` is the same lane
     * and cap but jumps ahead of bulk background waiters — for latency-sensitive
     * background traffic (e.g. dictation transcription) that must not sit behind a
     * pile of extraction chunks. `"high"`/`"normal"` (default) bypass the scheduler
     * entirely — zero overhead on the hot path.
     * @default "normal"
     */
    priority?: "high" | "normal" | "background" | "background-urgent";
}

/**
 * `RequestInit` plus the two xOpat-specific knobs {@link HttpClient.fetchRaw}
 * understands. Both are stripped before the underlying `fetch` call.
 */
export interface FetchRawInit extends RequestInit {
    /**
     * Retry budget for this request, overriding the client-wide `maxRetries`.
     * `0` means "one attempt". Tile downloads use it: retrying a tile the viewer
     * has already panned past just holds a connection slot, and the draw loop
     * re-requests anything it still needs.
     */
    maxRetries?: number;
    /**
     * Connection-pool scheduling hint, with the same meaning as
     * {@link RequestOptions.priority}. `"background"` makes the request yield to
     * tile loading via {@link APPLICATION_CONTEXT.requestScheduler}; the default
     * bypasses the scheduler entirely.
     * @default "normal"
     */
    priority?: "high" | "normal" | "background" | "background-urgent";
}

/** Options for {@link HttpClient.stream}. */
export interface StreamOptions {
    /** @default "POST" */
    method?: string;
    body?: any;
    headers?: Record<string, string>;
    /** Caller-owned abort signal; when omitted, use `HttpStream.cancel()` to end the stream. */
    signal?: AbortSignal;
}

/**
 * Handle over a live NDJSON response. The caller owns the lifetime: iterate
 * `lines()` to completion, `break` out of it, or call `cancel()` — all three
 * release the underlying connection. There is NO internal timeout.
 */
export interface HttpStream {
    status: number;
    ok: boolean;
    headers: Headers;
    /** The raw Response — body is untouched until `lines()` is iterated. */
    raw: Response;
    /** One parsed JSON value per NDJSON line. Throws on malformed or truncated data. */
    lines(): AsyncGenerator<any, void, unknown>;
    /** Abort the stream (no-op after completion). */
    cancel(reason?: any): void;
}

// Global declarations for external dependencies
declare const APPLICATION_CONTEXT: { url: string };
declare const XOpatUser: { instance(): any };
declare interface Window {
    XOPAT_CSRF_TOKEN?: string;
    XOPAT_SESSION_ID?: string;
    HTTPError: typeof HTTPError;
    HttpClient: any;
    XOpatSessionRecovery?: {
        isReloading?: boolean;
        handle?: (reason?: { status?: number; code?: string; message?: string; source?: string }) => boolean;
    };
}

/**
 * The two headers that name this browser's xOpat session to our own server.
 *
 * `X-XOPAT-CSRF` is the long-standing one. `X-XOPAT-Session` exists because a
 * viewer embedded in a third-party page may have **no cookie jar at all** —
 * third-party cookies blocked, or a `sandbox` iframe without
 * `allow-same-origin`, where the document sits on an opaque origin. The server
 * then hands the session id to the document itself (`security.cookielessSessions`,
 * `server/node/index.js`) and accepts it here instead of the cookie. Absent
 * outside that mode, so a normal deployment sends exactly what it sends today.
 */
function xopatSessionHeaders(): Record<string, string> {
    const out: Record<string, string> = {};
    const csrf = window?.XOPAT_CSRF_TOKEN;
    if (typeof csrf === "string" && csrf) out["X-XOPAT-CSRF"] = csrf;
    const sessionId = window?.XOPAT_SESSION_ID;
    if (typeof sessionId === "string" && sessionId) out["X-XOPAT-Session"] = sessionId;
    return out;
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

    private _isRetriable(status: number, bodyText?: string): boolean {
        // An explicit verdict from the server wins over any status heuristic, at
        // every status. Our RPC layer answers 500 for *every* handler throw, so
        // the status alone cannot distinguish an overloaded gateway from an
        // upstream 401/404 relayed through it — replaying the latter burns the
        // whole retry budget (1s+2s+4s) on a question whose answer cannot change.
        // The thrower is the only party that knows, and says so via `retriable`
        // (see server/node/ssrf-guard.js, forwarded by #rpcErrorPayload).
        const declared = bodyText ? this._parseErrorPayload(bodyText) : null;
        if (typeof declared?.retriable === "boolean") return declared.retriable;

        if (status === 429) return true;
        if (status < 500 || status >= 600) return false;
        // A server-side RPC deadline (504 + code RPC_TIMEOUT) is deterministic
        // for this request — replaying it multiplies load on an already-slow
        // upstream and cannot succeed faster. Genuine gateway 5xx (which carry
        // no such code) stay retriable.
        if (status === 504 && declared?.code === "RPC_TIMEOUT") return false;
        return true;
    }

    private _parseErrorPayload(textData?: string): { code?: string; retriable?: boolean; error?: string; message?: string; details?: any } | null {
        if (!textData) return null;
        try {
            const parsed = JSON.parse(textData);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    /**
     * An xOpat *session* error (dead session cookie, stale CSRF) routed to the
     * recovery gate rather than to the credential-refresh path — refreshing an OIDC
     * token cannot revive a server session, and treating one as the other is how a
     * dead session became an unbounded refresh loop.
     *
     * Gated on the target being OUR origin, not on `usingProxy`. The proxy check was
     * too narrow: `/__rpc/...` calls go through same-origin clients built with a bare
     * `baseURL` and no proxy alias (see `chatService._getRpcHttpClient`), so every
     * `RPC_NO_SESSION` / `RPC_BAD_CSRF` from an RPC fell straight through to the
     * refresh arm. A cross-origin upstream's 401 is still never read as an xOpat
     * session expiry.
     */
    private _tryHandleSessionExpiry(status: number, textData?: string, url?: string): boolean {
        if (url !== undefined ? this.isCrossOriginUrl(url) : !this.usingProxy) return false;

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
     * Build the signal handed to `fetch`: an internal controller that aborts on
     * (a) our timeout backstop and (b) the caller's signal, if any — whichever
     * fires first. A caller signal therefore never removes the timeout, closing
     * the "stalled upstream + signal that never fires = infinite hang" gap.
     * `timeoutMs <= 0` arms no timer (caller fully owns the deadline). `dispose()`
     * clears the timer and detaches the caller listener; `timedOut()` reports
     * whether our timer (not the caller) triggered the abort, for messaging.
     */
    private _composeAbort(callerSignal: AbortSignal | undefined, timeoutMs: number): {
        signal: AbortSignal; dispose: () => void; disarmTimeout: () => void; timedOut: () => boolean;
    } {
        const controller = new AbortController();
        let timedOut = false;
        let timer = timeoutMs > 0
            ? setTimeout(() => { timedOut = true; controller.abort(new Error(`timeout after ${timeoutMs} ms`)); }, timeoutMs)
            : null;
        // Stop the deadline once response headers are in: the timeout guards
        // connect+headers, NOT body streaming/parsing, which can legitimately run
        // longer than timeoutMs for a large JSON payload. A caller-supplied signal
        // still aborts the body read; only our own timer is disarmed here.
        const disarmTimeout = () => {
            if (timer !== null) { clearTimeout(timer); timer = null; }
        };
        let onAbort: (() => void) | null = null;
        if (callerSignal) {
            if (callerSignal.aborted) {
                controller.abort((callerSignal as any).reason);
            } else {
                onAbort = () => controller.abort((callerSignal as any).reason);
                callerSignal.addEventListener("abort", onAbort, { once: true });
            }
        }
        return {
            signal: controller.signal,
            dispose: () => {
                disarmTimeout();
                if (onAbort && callerSignal) callerSignal.removeEventListener("abort", onAbort);
            },
            disarmTimeout,
            timedOut: () => timedOut,
        };
    }

    /**
     * Core request helper
     * @param path - path relative to baseURL (can also be absolute)
     */
    async request(path: string, { method = "GET", query, body, headers = {}, expect = "auto", signal, timeoutMs: timeoutOverride, priority = "normal" }: RequestOptions = {}): Promise<any> {
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
        const crossOrigin = this.isCrossOriginUrl(url);

        // The credentials this attempt is carrying, recorded as the headers are built.
        // Reset on every rebuild (i.e. after a refresh) so a 401 always reports the
        // credential that request actually sent — see `_maybeRefreshSecrets`.
        let sentSecrets: Record<string, any> = {};

        const getBaseHeaders = async (headerSignal?: AbortSignal) => {
            sentSecrets = {};
            return {
                ...(hasBody ? { "Content-Type": "application/json" } : {}),
                ...(await this._authHeaders(url, method, headerSignal, sentSecrets)),
                ...headers,
                ...(!crossOrigin && this.usingProxy ? xopatSessionHeaders() : {})
            };
        };

        // Resolved before the timeout is armed below: building headers may wait
        // for the auth context to settle, and that wait must not eat the request
        // deadline. The caller's own signal still bounds it.
        let currentHeaders = await getBaseHeaders(signal ?? undefined);

        if (!crossOrigin && this.usingProxy && !window?.XOPAT_CSRF_TOKEN) {
            console.warn("HttpClient: CSRF token not found in window.XOPAT_CSRF_TOKEN with proxy - the request will likely fail.", path);
        }

        // Compose the caller signal with the timeout backstop: a caller signal
        // narrows the lifetime but never removes the deadline. `timeoutMs: 0`
        // opts out of the timer for genuinely open-ended calls (e.g. chat turns).
        const effTimeout = timeoutOverride ?? this.timeoutMs;
        const abort = this._composeAbort(signal, effTimeout);
        const effectiveSignal = abort.signal;

        // Background priority yields connection slots to interactive traffic
        // (tiles). Non-background requests never touch the scheduler. The queued
        // wait rides the composed signal, so a caller abort / timeout also drops
        // it from the queue.
        let releaseSlot: (() => void) | undefined;
        if (priority === "background" || priority === "background-urgent") {
            const scheduler = (globalThis as any).APPLICATION_CONTEXT?.requestScheduler;
            if (scheduler) {
                try {
                    releaseSlot = await scheduler.acquire(this._originOf(url), {
                        signal: effectiveSignal,
                        jumpQueue: priority === "background-urgent",
                    });
                } catch (_e) {
                    abort.dispose();
                    throw new HTTPError(abort.timedOut()
                        ? `HTTP ${method} ${url} aborted after ${effTimeout} ms`
                        : `HTTP ${method} ${url} aborted`);
                }
            }
        }

        const getInit = (currentHeaders: Record<string, string>): RequestInit => ({
            method,
            headers: currentHeaders,
            signal: effectiveSignal,
            ...(!crossOrigin && this.usingProxy ? { credentials: "same-origin" } : {}),
            ...(hasBody ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
        });

        let attempt = 0;
        let refreshed = false;

      try {
        while (true) {
            try {
                const res = await fetch(url, getInit(currentHeaders));

                if (!res.ok) {
                    const text = await res.text().catch(() => "");

                    if (this._tryHandleSessionExpiry(res.status, text, url)) {
                        throw new HTTPError(`HTTP ${method} ${url} failed: ${res.status}`, res, text);
                    }

                    if (this.refreshesOnStatus(res.status) && !refreshed) {
                        refreshed = await this._maybeRefreshSecrets(sentSecrets);
                        if (refreshed) {
                            currentHeaders = await getBaseHeaders(effectiveSignal);
                            continue;
                        }
                    }

                    if (this._isRetriable(res.status, text) && attempt < this.maxRetries) {
                        attempt += 1;
                        const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
                        await this._delay(backoff);
                        continue;
                    }

                    throw new HTTPError(`HTTP ${method} ${url} failed: ${res.status}`, res, text);
                }

                // Headers are in and the response is OK — the body read below is
                // no longer subject to the connect/headers deadline.
                abort.disarmTimeout();
                // The credentials we sent were accepted: clear any rejection streak
                // recorded from an earlier 401 on this context.
                this._reportAuthAccepted();

                const ct = (res.headers.get("content-type") || "").toLowerCase();
                if (expect === "text") return await res.text();
                if (expect === "json") return await res.json();

                if (ct.includes("application/json")) return await res.json();
                try { return await res.json(); } catch (_) {}
                try { return await res.text(); } catch (_) {}
                return {};
            } catch (err: any) {
                if (err.name === "AbortError") {
                    // Distinguish our own timeout from a caller abort — the latter
                    // must not be blamed on timeoutMs.
                    throw new HTTPError(abort.timedOut()
                        ? `HTTP ${method} ${url} aborted after ${effTimeout} ms`
                        : `HTTP ${method} ${url} aborted`);
                }
                // A deliberate throw from the `!res.ok` branch above — the retry
                // decision was already made there by `_isRetriable` (a retriable
                // status `continue`s and never reaches here). Falling into the
                // generic retry arm replays a request the server has definitively
                // rejected: a 4xx cost 1 + maxRetries round trips and seconds of
                // backoff before surfacing. `fetchRaw` has the same guard.
                if (err instanceof HTTPError) throw err;
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
        abort.dispose();
        if (releaseSlot) releaseSlot();
      }
    }

    /** Resolve an absolute/relative URL to its origin for scheduler keying. */
    private _originOf(url: string): string {
        try {
            return new URL(url, typeof location !== "undefined" ? location.href : undefined).origin;
        } catch (_) {
            return "*";
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
     *
     * Beyond `RequestInit`, two xOpat-specific options are honoured and stripped
     * before the underlying `fetch`:
     *
     * - `maxRetries` — overrides the client-wide retry budget for this request.
     *   A tile is the motivating case: the default three retries with 1s/2s/4s
     *   backoff can hold a connection slot for 7 s+ on a tile the viewer has
     *   already panned away from, and there is no point retrying something the
     *   draw loop will simply request again if it still needs it.
     * - `priority` — `"background"` / `"background-urgent"` route through
     *   {@link APPLICATION_CONTEXT.requestScheduler}, exactly as `request()`
     *   does, so bulk traffic yields to tiles. Anything else (the default) keeps
     *   the documented zero-overhead bypass on the hot path.
     */
    async fetchRaw(path: string, init: FetchRawInit = {}): Promise<Response> {
        const { maxRetries: initRetries, priority, ...fetchInit } = init;
        const maxRetries = typeof initRetries === "number" ? initRetries : this.maxRetries;

        if (priority === "background" || priority === "background-urgent") {
            const scheduler = (globalThis as any).APPLICATION_CONTEXT?.requestScheduler;
            if (scheduler) {
                // Same lane key as `request()`: admission is per origin, so
                // background traffic to the tile origin is what yields to tiles.
                const release = await scheduler.acquire(this._originOf(this.resolveUrl(path)), {
                    signal: fetchInit.signal ?? undefined,
                    jumpQueue: priority === "background-urgent",
                });
                try {
                    return await this._fetchRaw(path, fetchInit, maxRetries);
                } finally {
                    release?.();
                }
            }
        }
        return this._fetchRaw(path, fetchInit, maxRetries);
    }

    private async _fetchRaw(path: string, init: RequestInit, maxRetries: number): Promise<Response> {
        const url = this.resolveUrl(path);
        const method = (init.method || "GET").toUpperCase();
        const callerHeaders = (init.headers as Record<string, string> | undefined) || undefined;
        const crossOrigin = this.isCrossOriginUrl(url);

        // See `request`: reset per rebuild so a 401 reports the credential this
        // attempt actually carried, not one a concurrent refresh has since installed.
        let sentSecrets: Record<string, any> = {};

        const buildHeaders = async (headerSignal?: AbortSignal): Promise<Record<string, string>> => {
            sentSecrets = {};
            return {
                ...(await this._authHeaders(url, method, headerSignal, sentSecrets)),
                ...(!crossOrigin && this.usingProxy ? xopatSessionHeaders() : {}),
                ...(callerHeaders || {}),
            };
        };

        if (!crossOrigin && this.usingProxy && !window?.XOPAT_CSRF_TOKEN) {
            console.warn("HttpClient.fetchRaw: CSRF token not in window.XOPAT_CSRF_TOKEN with proxy — request will likely fail.", path);
        }

        // Headers first, timeout second: building them may wait for the auth
        // context to settle (see `_awaitAuthContext`), and that wait must not be
        // charged against the request deadline. A caller signal still bounds it.
        let currentHeaders = await buildHeaders(init.signal ?? undefined);

        // If the caller didn't pass a signal, compose our own timeout.
        const ownController = init.signal ? null : new AbortController();
        const timeoutHandle = ownController
            ? setTimeout(() => ownController.abort(), this.timeoutMs)
            : null;
        const signal = init.signal ?? ownController!.signal;

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
                        ...(!crossOrigin && this.usingProxy ? { credentials: "same-origin" as RequestCredentials } : {}),
                    });

                    if (!res.ok) {
                        const text = await res.clone().text().catch(() => "");

                        if (this._tryHandleSessionExpiry(res.status, text, url)) {
                            throw new HTTPError(`HTTP ${method} ${url} failed: ${res.status}`, res, text);
                        }

                        if (this.refreshesOnStatus(res.status) && !refreshed) {
                            refreshed = await this._maybeRefreshSecrets(sentSecrets);
                            if (refreshed) {
                                currentHeaders = await buildHeaders(signal);
                                continue;
                            }
                        }

                        if (this._isRetriable(res.status, text) && attempt < maxRetries) {
                            attempt += 1;
                            const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
                            await this._delay(backoff);
                            continue;
                        }

                        throw new HTTPError(`HTTP ${method} ${url} failed: ${res.status}`, res, text);
                    }

                    this._reportAuthAccepted();
                    return res;
                } catch (err: any) {
                    if (err instanceof HTTPError) throw err;
                    if (err?.name === "AbortError") {
                        throw new HTTPError(`HTTP ${method} ${url} aborted`);
                    }
                    if (attempt < maxRetries) {
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

    /**
     * Open an NDJSON stream. Generic transport primitive — one parsed JSON value
     * per newline-terminated line; usable by any module against any endpoint
     * that speaks newline-delimited JSON (the RPC streaming mode being the
     * first consumer).
     *
     * Inherits every `fetchRaw` guarantee: proxy-alias URL resolution, auth
     * handlers (JWT), CSRF, 401-driven secret refresh, retry-before-ok, and
     * session-expiry recovery. Retries can only ever happen BEFORE an ok
     * response resolves, so a stream never replays partial data.
     *
     * Lifetime is caller-owned: no internal timeout ever arms. End the stream
     * by finishing/`break`ing the `lines()` iteration, aborting the supplied
     * `signal`, or calling `cancel()`.
     */
    async stream(path: string, { method = "POST", body, headers = {}, signal }: StreamOptions = {}): Promise<HttpStream> {
        // Own the fetch signal for the stream's whole life so cancel() can always
        // abort the in-flight body — even after lines() has locked the reader,
        // where res.body.cancel() throws "Cannot cancel a locked stream" and the
        // connection would leak. A caller signal is chained in (its abort aborts
        // ours); we never hand it to fetch directly, so cancel(), caller-abort,
        // and teardown all funnel through this one controller. No internal
        // timeout arms here by contract — the caller owns the deadline (the RPC
        // layer arms its own pre-header/stall timer on the supplied signal).
        const ownController = new AbortController();
        if (signal) {
            if (signal.aborted) ownController.abort((signal as any).reason);
            else signal.addEventListener("abort", () => ownController.abort((signal as any).reason), { once: true });
        }

        const hasBody = body !== undefined && body !== null && !/^(GET|HEAD)$/i.test(method);
        const res = await this.fetchRaw(path, {
            method,
            headers: {
                ...(hasBody ? { "Content-Type": "application/json" } : {}),
                ...headers,
            },
            ...(hasBody ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
            signal: ownController.signal,
        });

        return {
            status: res.status,
            ok: res.ok,
            headers: res.headers,
            raw: res,
            cancel(reason?: any) {
                try { ownController.abort(reason); } catch (_) { /* already settled */ }
            },
            lines: async function* (): AsyncGenerator<any, void, unknown> {
                const bodyStream = res.body;
                if (!bodyStream) throw new HTTPError(`HTTP ${method} ${path}: response has no readable body`, res);
                const reader = bodyStream.getReader();
                // stream:true keeps multi-byte UTF-8 sequences split across chunk
                // boundaries intact — never slice bytes manually.
                const decoder = new TextDecoder("utf-8");
                let buffer = "";
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        let idx;
                        while ((idx = buffer.indexOf("\n")) >= 0) {
                            let line = buffer.slice(0, idx);
                            buffer = buffer.slice(idx + 1);
                            if (line.endsWith("\r")) line = line.slice(0, -1);
                            if (!line.trim()) continue;
                            // A malformed complete line is a protocol error — throw,
                            // never skip silently.
                            yield JSON.parse(line);
                        }
                    }
                    buffer += decoder.decode();
                    const residual = buffer.trim();
                    if (residual) {
                        // Stream ended mid-record: either the final line simply lacked
                        // a trailing newline (parseable → fine) or it was truncated.
                        try {
                            yield JSON.parse(residual);
                        } catch (_) {
                            throw new HTTPError(`HTTP ${method} ${path}: NDJSON stream truncated mid-record`, res);
                        }
                    }
                } finally {
                    // Early break/return/throw releases the connection — this is what
                    // lets a consumer cut a stream short and tear the socket down.
                    try { await reader.cancel(); } catch (_) { /* already closed */ }
                }
            },
        };
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