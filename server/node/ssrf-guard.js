"use strict";

// Server-level SSRF guard. Exposed on `globalThis.XOPAT_SERVER` as
// `safeFetch` / `validateUpstreamUrl` so any `*.server.{ts,js,mjs}` file —
// plugin, module or core — can perform outbound HTTP without rolling its
// own private-IP / redirect filtering.
//
// Threat model: upstream URLs that flow into server-side fetch calls are
// frequently operator- or user-configured (provider registration, custom
// proxies, webhooks, …). Without these checks, an attacker who controls a
// URL string can make the server hit 169.254.169.254 / localhost / internal
// VPC endpoints. Node's default fetch follows up to 20 redirects, so a
// public host can also 302 into the internal network and bypass naive
// host-only filters.
//
// What this guard does:
//   - Restrict scheme to http(s).
//   - DNS-resolve the host (or accept literal IPs) and refuse any answer
//     that lands in a private, loopback, link-local, CGNAT, multicast,
//     IPv6-special range, or a known public cloud-metadata endpoint.
//   - Expose `safeFetch` (global-fetch based) and `safeRequest`
//     (node:http/https based) that disable redirect following and surface a
//     clear error when an upstream tries to 3xx.
//   - Expose `createValidatingLookup` — a connect-time DNS resolver that
//     re-checks every resolved address before the socket uses it. Because
//     Node performs this exact lookup to obtain the IP it connects to,
//     `safeRequest` (which wires it in) has NO DNS-rebinding TOCTOU: the name
//     cannot re-resolve to an internal IP between the check and the connect.
//
// What this guard does *not* do:
//   - Vet redirects performed by third-party SDKs that bring their own
//     fetch (e.g. the Vercel AI SDK once we hand it a baseURL). Callers
//     must vet the baseURL up-front via `validateUpstreamUrl` and treat
//     subsequent fetches inside the SDK as trusted.
//   - Close the TOCTOU for `safeFetch`. Global `fetch` (undici) exposes no
//     connect-time lookup hook without pulling in the `undici` package, so
//     `safeFetch` still has a small resolve-then-connect window. Prefer
//     `safeRequest` for untrusted / attacker-influenced hostnames — it pins
//     the validated resolution through `createValidatingLookup`.

const dns = require("node:dns/promises");
const net = require("node:net");

function ipv4ToInt(addr) {
    const parts = addr.split(".").map(p => Number.parseInt(p, 10));
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

const PRIVATE_IPV4_BLOCKS = [
    [ipv4ToInt("10.0.0.0"),       8],   // RFC1918
    [ipv4ToInt("172.16.0.0"),    12],   // RFC1918
    [ipv4ToInt("192.168.0.0"),   16],   // RFC1918
    [ipv4ToInt("127.0.0.0"),      8],   // loopback
    [ipv4ToInt("169.254.0.0"),   16],   // link-local (incl. AWS/GCP IMDS 169.254.169.254, ECS 169.254.170.2)
    [ipv4ToInt("100.64.0.0"),    10],   // CGNAT (incl. Alibaba metadata 100.100.100.200)
    [ipv4ToInt("0.0.0.0"),        8],   // "this network"
    [ipv4ToInt("224.0.0.0"),      4],   // multicast
    [ipv4ToInt("240.0.0.0"),      4],   // reserved
];

// Cloud metadata / infra endpoints that are PUBLICLY routable and therefore not
// caught by the private-range blocks above. Azure's wireserver is the notable
// one — a plain public IP that still exposes instance metadata / DNS.
const BLOCKED_PUBLIC_IPV4 = new Set([
    "168.63.129.16",   // Azure wireserver (metadata + platform DNS)
]);

function isPrivateIpv4(addr) {
    if (!net.isIPv4(addr)) return false;
    if (BLOCKED_PUBLIC_IPV4.has(addr)) return true;
    const value = ipv4ToInt(addr);
    for (const [base, prefix] of PRIVATE_IPV4_BLOCKS) {
        const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
        if ((value & mask) === (base & mask)) return true;
    }
    return false;
}

/**
 * Expand any IPv6 presentation form to its 8 hextets.
 *
 * Needed because a single address has many spellings: `::ffff:127.0.0.1`,
 * `::ffff:7f00:1` and `0:0:0:0:0:ffff:127.0.0.1` are the SAME address, so
 * matching on the text form blocks one and lets the others through.
 *
 * @param {string} addr
 * @returns {number[]|null} 8 hextets, or null if unparsable.
 */
function expandIpv6(addr) {
    let s = String(addr).toLowerCase().split("%")[0];        // drop any zone id
    // A trailing dotted quad (::ffff:1.2.3.4) becomes the low two hextets.
    const dotted = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (dotted) {
        const o = dotted[1].split(".").map(Number);
        if (o.some(n => !Number.isInteger(n) || n > 255)) return null;
        s = s.slice(0, s.length - dotted[1].length)
            + (((o[0] << 8) | o[1]) >>> 0).toString(16) + ":"
            + (((o[2] << 8) | o[3]) >>> 0).toString(16);
    }
    const halves = s.split("::");
    if (halves.length > 2) return null;                      // at most one "::"
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;
    if (right === null && left.length !== 8) return null;    // uncompressed must be full
    const fill = 8 - left.length - (right ? right.length : 0);
    if (fill < 0) return null;
    const parts = right ? [...left, ...Array(fill).fill("0"), ...right] : left;
    const hextets = parts.map(p => (/^[0-9a-f]{1,4}$/.test(p) ? parseInt(p, 16) : NaN));
    return hextets.some(h => !Number.isInteger(h)) ? null : hextets;
}

function isPrivateIpv6(addr) {
    if (!net.isIPv6(addr)) return false;
    const h = expandIpv6(addr);
    if (!h) return true;                                     // unparsable → degrade closed
    if (h.every(x => x === 0)) return true;                              // ::   unspecified
    if (h.slice(0, 7).every(x => x === 0) && h[7] === 1) return true;    // ::1  loopback
    if ((h[0] & 0xfe00) === 0xfc00) return true;             // fc00::/7  unique local
    if ((h[0] & 0xffc0) === 0xfe80) return true;             // fe80::/10 link local
    if ((h[0] & 0xffc0) === 0xfec0) return true;             // fec0::/10 site local (deprecated)
    if ((h[0] & 0xff00) === 0xff00) return true;             // ff00::/8  multicast
    // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96) carry an IPv4
    // target in the low 32 bits — apply the IPv4 rules to it, whatever spelling
    // it arrived in, so a mapped internal/metadata IP can't slip past.
    if (h.slice(0, 5).every(x => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
        return isPrivateIpv4(`${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`);
    }
    return false;
}

class SsrfBlockedError extends Error {
    constructor(message) {
        super(message);
        this.name = "SsrfBlockedError";
        this.code = "SSRF_BLOCKED";
    }
}

/**
 * Parse + validate an upstream URL.
 *
 * @param {string} urlStr
 * @param {{ allowHosts?: string[], lookup?: (host: string) => Promise<Array<{address: string}>> }} [opts]
 *   `allowHosts` — if set, only listed hostnames pass (post-scheme check).
 *   `lookup`     — DNS override for testing.
 * @returns {Promise<URL>} the parsed URL.
 * @throws {SsrfBlockedError} on rejection.
 */
async function validateUpstreamUrl(urlStr, opts = {}) {
    if (!urlStr || typeof urlStr !== "string") {
        throw new SsrfBlockedError("SSRF guard: URL must be a non-empty string.");
    }
    let url;
    try {
        url = new URL(urlStr);
    } catch {
        throw new SsrfBlockedError(`SSRF guard: not a valid URL: ${urlStr}`);
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new SsrfBlockedError(`SSRF guard: scheme '${url.protocol}' not allowed (http/https only).`);
    }

    const host = url.hostname.toLowerCase();
    if (!host) throw new SsrfBlockedError("SSRF guard: missing hostname.");

    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
        throw new SsrfBlockedError(`SSRF guard: hostname '${host}' is loopback / mDNS.`);
    }

    if (Array.isArray(opts.allowHosts) && opts.allowHosts.length > 0) {
        const allow = opts.allowHosts.map(h => String(h).toLowerCase());
        if (!allow.includes(host)) {
            throw new SsrfBlockedError(`SSRF guard: hostname '${host}' not in allowlist.`);
        }
    }

    // WHATWG keeps the brackets on an IPv6 literal, so `net.isIP` would return 0
    // and send a literal down the DNS path. Strip them and check it as the
    // literal it is, rather than relying on the resolver to canonicalize.
    const literal = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
    if (net.isIP(literal)) {
        if (isPrivateIpv4(literal) || isPrivateIpv6(literal)) {
            throw new SsrfBlockedError(`SSRF guard: host IP '${literal}' is in a private/reserved range.`);
        }
        return url;
    }

    const customLookup = typeof opts.lookup === "function";
    const lookup = customLookup
        ? opts.lookup
        : async (h) => dns.lookup(h, { all: true, verbatim: true });

    // Positive-only pre-flight verdict cache. This is an availability
    // optimization for hot paths that re-validate the same upstream every call
    // (e.g. one chat turn per assistant-loop step): a hostname that passed
    // within the TTL skips the real DNS round-trip. Failures and private-range
    // verdicts are NEVER cached. The rebinding window this opens is bounded by
    // the TTL and only affects this pre-flight — `safeRequest`'s connect-time
    // validating lookup remains the authoritative TOCTOU guard; callers that
    // hand the URL to a third-party SDK accept the same class of window this
    // pre-flight always had between validation and the SDK's own connect.
    if (!customLookup) {
        const cached = _validatedHostCache.get(host);
        if (cached && cached > Date.now()) return url;
    }

    let addresses;
    try {
        addresses = await lookup(host);
    } catch (err) {
        throw new SsrfBlockedError(`SSRF guard: DNS lookup failed for '${host}': ${(err && err.message) || err}`);
    }
    if (!addresses || !addresses.length) {
        throw new SsrfBlockedError(`SSRF guard: DNS lookup returned no addresses for '${host}'.`);
    }
    for (const { address } of addresses) {
        if (isPrivateIpv4(address) || isPrivateIpv6(address)) {
            throw new SsrfBlockedError(
                `SSRF guard: '${host}' resolved to private/reserved address '${address}'.`
            );
        }
    }

    if (!customLookup) {
        _validatedHostCache.set(host, Date.now() + VALIDATED_HOST_TTL_MS);
        while (_validatedHostCache.size > VALIDATED_HOST_CACHE_MAX) {
            _validatedHostCache.delete(_validatedHostCache.keys().next().value);
        }
    }

    return url;
}

/** @see validateUpstreamUrl — positive verdicts only, short TTL. */
const VALIDATED_HOST_TTL_MS = 45_000;
const VALIDATED_HOST_CACHE_MAX = 256;
const _validatedHostCache = new Map();

/**
 * Validated `fetch`. Vets the URL through `validateUpstreamUrl`, forces
 * `redirect: "manual"` and throws on any 3xx so attacker-controlled
 * upstreams cannot chain redirects into private space.
 *
 * @param {string} urlStr
 * @param {RequestInit & { allowHosts?: string[], _lookup?: Function }} [init]
 */
async function safeFetch(urlStr, init = {}) {
    const { allowHosts, _lookup, ...rest } = init;
    const url = await validateUpstreamUrl(urlStr, { allowHosts, lookup: _lookup });

    const res = await fetch(url, { ...rest, redirect: "manual" });

    if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location") || "";
        throw new SsrfBlockedError(
            `SSRF guard: upstream ${url.origin} returned ${res.status}` +
            (location ? ` → ${location}` : "") +
            " (redirects are disabled on this code path)."
        );
    }

    return res;
}

/**
 * Build a `lookup` function for `node:http`/`node:https` (or `net.connect`)
 * that resolves the hostname and rejects the connection if ANY resolved address
 * is private/reserved/metadata. Since the socket connects to exactly what this
 * returns, wiring it into a request closes the DNS-rebinding TOCTOU that a
 * separate pre-flight `validateUpstreamUrl` would leave open.
 *
 * @param {{ lookup?: (host: string) => Promise<Array<{address: string, family?: number}>> }} [opts]
 *   `lookup` — DNS override for testing.
 * @returns {(hostname: string, options: any, callback: Function) => void}
 */
function createValidatingLookup(opts = {}) {
    const resolver = typeof opts.lookup === "function"
        ? opts.lookup
        : (h) => dns.lookup(h, { all: true, verbatim: true });
    const familyOf = (address, given) => given || (net.isIPv6(address) ? 6 : 4);
    return (hostname, options, callback) => {
        const wantAll = typeof options === "object" && options ? !!options.all : false;
        Promise.resolve()
            .then(() => resolver(hostname))
            .then((records) => {
                const list = Array.isArray(records) ? records : [records];
                if (!list.length) {
                    throw new SsrfBlockedError(`SSRF guard: '${hostname}' did not resolve to an address.`);
                }
                for (const rec of list) {
                    if (isPrivateIpv4(rec.address) || isPrivateIpv6(rec.address)) {
                        throw new SsrfBlockedError(
                            `SSRF guard: '${hostname}' resolved to private/reserved address '${rec.address}'.`
                        );
                    }
                }
                if (wantAll) {
                    callback(null, list.map(r => ({ address: r.address, family: familyOf(r.address, r.family) })));
                } else {
                    const first = list[0];
                    callback(null, first.address, familyOf(first.address, first.family));
                }
            })
            .catch((err) => callback(err));
    };
}

/**
 * TOCTOU-safe outbound request built on `node:http`/`node:https`. Unlike
 * {@link safeFetch}, the SSRF check runs at connect time via
 * {@link createValidatingLookup}, so an attacker-controlled DNS name cannot
 * rebind to an internal IP after validation. Redirects are never followed.
 *
 * @param {string} urlStr
 * @param {{
 *   method?: string, headers?: Record<string,string>, body?: Buffer|string|null,
 *   timeoutMs?: number, signal?: AbortSignal, allowHosts?: string[], _lookup?: Function
 * }} [init]
 * @returns {Promise<{ status: number, ok: boolean, headers: object,
 *   arrayBuffer(): Promise<Buffer>, text(): Promise<string>, json(): Promise<any> }>}
 * @throws {SsrfBlockedError} on a blocked destination or a 3xx redirect.
 */
async function safeRequest(urlStr, init = {}) {
    const { allowHosts, _lookup, method = "GET", headers = {}, body = null, timeoutMs = 30000, signal } = init;
    const url = await validateUpstreamUrl(urlStr, { allowHosts, lookup: _lookup });
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? require("node:https") : require("node:http");

    return new Promise((resolve, reject) => {
        const req = transport.request(
            {
                method,
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: `${url.pathname}${url.search}`,
                headers,
                ...(isHttps ? { servername: url.hostname } : {}), // pin TLS SNI to the validated hostname
                lookup: createValidatingLookup({ lookup: _lookup }),
                timeout: timeoutMs,
            },
            (res) => {
                const status = res.statusCode || 0;
                if (status >= 300 && status < 400) {
                    res.resume();
                    const location = res.headers.location || "";
                    reject(new SsrfBlockedError(
                        `SSRF guard: upstream ${url.origin} returned ${status}` +
                        (location ? ` → ${location}` : "") +
                        " (redirects are disabled on this code path)."
                    ));
                    return;
                }
                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => {
                    const buf = Buffer.concat(chunks);
                    resolve({
                        status,
                        ok: status >= 200 && status < 300,
                        headers: res.headers,
                        arrayBuffer: async () => buf,
                        text: async () => buf.toString("utf8"),
                        json: async () => JSON.parse(buf.toString("utf8") || "{}"),
                    });
                });
                res.on("error", reject);
            }
        );
        req.on("error", reject);
        req.on("timeout", () => req.destroy(new SsrfBlockedError(
            `SSRF guard: request to ${url.origin} timed out after ${timeoutMs}ms.`
        )));
        if (signal) {
            if (signal.aborted) req.destroy(new Error("Request aborted."));
            else signal.addEventListener("abort", () => req.destroy(new Error("Request aborted.")), { once: true });
        }
        if (body != null) req.end(body); else req.end();
    });
}

module.exports = {
    SsrfBlockedError,
    validateUpstreamUrl,
    safeFetch,
    safeRequest,
    createValidatingLookup,
    // exposed for unit tests
    _internals: { isPrivateIpv4, isPrivateIpv6, ipv4ToInt, expandIpv6 },
};
