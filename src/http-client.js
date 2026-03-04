/**
 * Error thrown for HTTP failures in HTTPClient.
 * The content is not guaranteed to be translated.
 * @class HTTPError
 * @extends Error
 * @property {string} message - Human-readable error message.
 * @property {Response} [response] - The Fetch API Response object, if available.
 * @property {string} [textData] - Raw response body text returned by the server.
 * @property {number} statusCode - HTTP status code derived from the response (default 500).
 */
window.HTTPError = class extends Error {
    /**
     * @param {string} message - Error message.
     * @param {Response} [response] - Fetch Response associated with the error.
     * @param {string} [textData] - Raw response text for diagnostics.
     */
    constructor(message, response, textData) {
        super();
        this.message = message;
        this.response = response;
        this.textData = textData;
        this.statusCode = response && response.status || 500;
    }
};

// Tiny MLflow JS Client — modular, documented, robust-by-default
// -----------------------------------------------------------------------------
// File layout in this single document (split into logical modules):
//   - src/http.js               : thin HTTP wrapper with retries + auth
//   - src/utils.js              : small helpers (query, time, sanitizers)
//   - src/experiments.js        : experiment management helpers
//   - src/runs.js               : run management (create/search/log/end)
//   - src/artifacts/adapters.js : pluggable artifact adapters
//   - src/client.js             : MLflowClient orchestrating everything
//   - src/index.js              : library entrypoint (ES module exports)
//   - README.md                 : quick docs & examples
// -----------------------------------------------------------------------------

// =============================
// FILE: src/http.js
// =============================

/**
 * Minimal HTTP client with:
 *  - pluggable auth (JWT by default) with context-aware secrets
 *  - automatic auth headers via handlers
 *  - JSON/query handling
 *  - configurable retries for 429/5xx
 *  - smart response parsing
 *  - throws window.HTTPError for HTTP failures
 */
window.HttpClient = class {
    /**
     * @param {Object} options
     * @param {string} [options.baseURL] - e.g. "https://mlflow.myhost.com/api/2.0/mlflow", must be defined if proxy is not defined
     * @param {string} [options.proxy] - Optional alias for server-side proxy (e.g. "openai"). Routes via `/proxy/{alias}`,
     *   must be defined if baseURL is not defined. If base url defined with proxy, the resulting base url is mounted atop the proxy.
     * @param {number} [options.timeoutMs=30000]
     * @param {number} [options.maxRetries=3]
     * @param {Object} [options.auth]
     * @param {string} [options.auth.contextId] - optional logical context (e.g., "mlflow", "analytics")
     * @param {string[]} [options.auth.types] - which secret types to apply (default ["jwt"]) in order
     * @param {Object} [options.auth.handlers] - map of type=>handler override for this instance
     * @param {boolean} [options.auth.refreshOn401=true] - if true, attempts a one-shot secret refresh via user interface
     */
    constructor({ baseURL, proxy, timeoutMs = 30000, maxRetries = 3, auth = {} } = {}) {
        let base = "";
        if (proxy && typeof proxy === "string") {
            const domain = APPLICATION_CONTEXT.url;
            if (domain.endsWith("/")) {
                base = `${APPLICATION_CONTEXT.url}proxy/${proxy}`;
            } else {
                base = `${APPLICATION_CONTEXT.url}/proxy/${proxy}`;
            }
        }

        if (baseURL) {
            if (base) {
                if (baseURL.startsWith("http")) {
                    console.warn("HttpClient: baseURL is an a...bsolute URL, which is wrong with proxy usage!", baseURL, proxy);
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
            required = false,              // NEW: auth.required flag
        } = auth || {};

        this.auth = {
            contextId,
            types,
            handlers: { ...HttpClient._globalAuthHandlers, ...handlers },
            refreshOn401,
            required,
        };
    }

    /** Private handlers */
    static _globalAuthHandlers = {};

    // ---------------------- Auth plumbing ----------------------

    /** Register a global auth handler. */
    static registerAuthHandler(type, handler) {
        HttpClient._globalAuthHandlers[type] = handler;
    }

    /** Check type validity */
    static knowsSecretType(type) {
        return type in HttpClient._globalAuthHandlers;
    }

    async _authHeaders(url, method) {
        const { types, handlers, contextId, required } = this.auth;
        const headers = {};
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

        // If auth is required for this client, we're using a proxy,
        // but we found no secrets, warn loudly (and let the request fail/401).
        if (!hasAnySecret && required && this.usingProxy) {
            console.warn(
                `HttpClient: auth.required=true for proxy request but no secrets found` +
                (contextId ? ` for context '${contextId}'` : "") +
                `. Request will be sent without auth headers and will likely result in 401.`
            );
        }

        return headers;
    }

    // ---------------------- Retry helpers ----------------------

    _isRetriable(status) {
        return status === 429 || (status >= 500 && status < 600);
    }

    _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ---------------------- Core request -----------------------

    /**
     * Core request helper
     * @param {string} path - path relative to baseURL (can also be absolute)
     * @param {Object} [opts]
     * @param {string} [opts.method="GET"]
     * @param {Object} [opts.query]
     * @param {any}    [opts.body]
     * @param {Object} [opts.headers]
     * @param {string} [opts.expect] - "json" | "text" | "auto"
     */
    async request(path, { method = "GET", query, body, headers = {}, expect = "auto" } = {}) {
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

        const baseHeaders = {
            ...(hasBody ? { "Content-Type": "application/json" } : {}),
            ...(await this._authHeaders(url, method)),
            ...headers,
        };

        if (this.usingProxy) {
            if (typeof window !== "undefined" && window.XOPAT_CSRF_TOKEN) {
                baseHeaders["X-XOPAT-CSRF"] = window.XOPAT_CSRF_TOKEN;
            } else {
                console.warn("HttpClient: CSRF token not found in window.XOPAT_CSRF_TOKEN with proxy - the request will likely fail.", path);
            }
        }

        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), this.timeoutMs);

        const init = {
            method,
            headers: baseHeaders,
            signal: controller.signal,
            ...(this.usingProxy ? { credentials: "same-origin" } : {}),
            ...(hasBody ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
        };

        let attempt = 0;
        let refreshed = false;

        // todo support retry-after header
        while (true) {
            try {
                const res = await fetch(url, init);
                clearTimeout(to);
                if (!res.ok) {
                    // Optionally try a single refresh on 401
                    if (res.status === 401 && this.auth.refreshOn401 && !refreshed) {
                        refreshed = await this._maybeRefreshSecrets();
                        if (refreshed) {
                            // rebuild auth + CSRF headers after refresh
                            init.headers = {
                                ...(hasBody ? { "Content-Type": "application/json" } : {}),
                                ...(await this._authHeaders(url, method)),
                                ...headers,
                            };
                            if (this.usingProxy) {
                                if (typeof window !== "undefined" && window.XOPAT_CSRF_TOKEN) {
                                    init.headers["X-XOPAT-CSRF"] = window.XOPAT_CSRF_TOKEN;
                                } else {
                                    console.warn("HttpClient: CSRF token not found in window.XOPAT_CSRF_TOKEN with proxy - the request will likely fail.", path);
                                }
                            }
                            continue;
                        }
                    }

                    if (this._isRetriable(res.status) && attempt < this.maxRetries) {
                        attempt += 1;
                        const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
                        await this._delay(backoff);
                        continue;
                    }

                    const text = await res.text().catch(() => "");
                    const HTTPError = (globalThis && globalThis.HTTPError) || Error;
                    throw new HTTPError(`HTTP ${method} ${url} failed: ${res.status}`, res, text);
                }

                const ct = (res.headers.get("content-type") || "").toLowerCase();
                if (expect === "text") return await res.text();
                if (expect === "json") return await res.json();

                // auto
                if (ct.includes("application/json")) return await res.json();
                try { return await res.json(); } catch (_) {}
                try { return await res.text(); } catch (_) {}
                return {};
            } catch (err) {
                if (err.name === "AbortError") {
                    const HTTPError = (globalThis && globalThis.HTTPError) || Error;
                    throw new HTTPError(`HTTP ${method} ${url} aborted after ${this.timeoutMs} ms`);
                }
                // network errors can retry
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

    async _maybeRefreshSecrets() {
        const { types, contextId } = this.auth;
        try {
            for (const t of types || []) {
                await this.secretStore.requestSecretUpdate(t, contextId);
            }
            return true;
        } catch (_) { return false; }
    }
}

// ---------------------- Default auth handlers ----------------------
// Built-in JWT handler
HttpClient.registerAuthHandler("jwt", async ({ secret }) => {
    if (!secret) return {};
    return { Authorization: `Bearer ${secret}` };
});
// Allow basic auth via a synthetic secret type "basic" where secret = {username, password}
HttpClient.registerAuthHandler("basic", async ({ secret }) => {
    if (!secret || !secret.username) return {};
    const raw = `${secret.username}:${secret.password || ""}`;
    const b64 = typeof btoa !== "undefined" ? btoa(raw) : Buffer.from(raw, "utf8").toString("base64");
    return { Authorization: `Basic ${b64}` };
});