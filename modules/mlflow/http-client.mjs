/**
 * Minimal HTTP client with:
 *  - automatic auth (Bearer or Basic)
 *  - JSON/query handling
 *  - configurable retries for 429/5xx
 *  - smart response parsing
 */
export class HttpClient {
    /**
     * @param {Object} options
     * @param {string} options.baseURL - e.g. "https://mlflow.myhost.com/api/2.0/mlflow"
     * @param {string} [options.token]
     * @param {string} [options.username]
     * @param {string} [options.password]
     * @param {number} [options.timeoutMs=30000]
     * @param {number} [options.maxRetries=3]
     */
    constructor({ baseURL, token, username, password, timeoutMs = 30000, maxRetries = 3 }) {
        if (!baseURL) throw new Error("HttpClient: baseURL is required");
        this.baseURL = baseURL.replace(/\/$/, "");
        this.token = token || null;
        this.username = username || null;
        this.password = password || null;
        this.timeoutMs = timeoutMs;
        this.maxRetries = Math.max(0, maxRetries);
    }

    _authHeader() {
        if (this.token) return { Authorization: `Bearer ${this.token}` };
        if (this.username && this.password) {
            const b64 = typeof btoa !== "undefined"
                ? btoa(`${this.username}:${this.password}`)
                : Buffer.from(`${this.username}:${this.password}`, "utf8").toString("base64");
            return { Authorization: `Basic ${b64}` };
        }
        return {};
    }

    _isRetriable(status) {
        return status === 429 || (status >= 500 && status < 600);
    }

    _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

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
            ...this._authHeader(),
            ...headers,
        };

        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), this.timeoutMs);

        const init = {
            method,
            headers: baseHeaders,
            signal: controller.signal,
            ...(hasBody ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
        };

        let attempt = 0;
        // retry loop
        while (true) {
            try {
                const res = await fetch(url, init);
                clearTimeout(to);
                if (!res.ok) {
                    if (this._isRetriable(res.status) && attempt < this.maxRetries) {
                        attempt += 1;
                        const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
                        await this._delay(backoff);
                        continue;
                    }
                    const text = await res.text().catch(() => "");
                    throw new Error(`HTTP ${method} ${url} failed: ${res.status} ${text}`);
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
                if (err.name === "AbortError") throw new Error(`HTTP ${method} ${url} aborted after ${this.timeoutMs} ms`);
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
}



