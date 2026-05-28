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
//     that lands in a private, loopback, link-local, CGNAT, multicast or
//     IPv6-special range.
//   - Expose `safeFetch` that disables redirect following and surfaces a
//     clear error when an upstream tries to 3xx.
//
// What this guard does *not* do:
//   - Vet redirects performed by third-party SDKs that bring their own
//     fetch (e.g. the Vercel AI SDK once we hand it a baseURL). Callers
//     must vet the baseURL up-front via `validateUpstreamUrl` and treat
//     subsequent fetches inside the SDK as trusted.
//   - Pin DNS between validation and fetch. The TOCTOU window is small
//     and the upstream is typically operator-configured. A custom
//     dispatcher (undici) or fetching by literal IP would be required to
//     close that gap entirely.

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
    [ipv4ToInt("169.254.0.0"),   16],   // link-local (incl. cloud metadata)
    [ipv4ToInt("100.64.0.0"),    10],   // CGNAT
    [ipv4ToInt("0.0.0.0"),        8],   // "this network"
    [ipv4ToInt("224.0.0.0"),      4],   // multicast
    [ipv4ToInt("240.0.0.0"),      4],   // reserved
];

function isPrivateIpv4(addr) {
    if (!net.isIPv4(addr)) return false;
    const value = ipv4ToInt(addr);
    for (const [base, prefix] of PRIVATE_IPV4_BLOCKS) {
        const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
        if ((value & mask) === (base & mask)) return true;
    }
    return false;
}

function isPrivateIpv6(addr) {
    if (!net.isIPv6(addr)) return false;
    const lower = addr.toLowerCase();
    if (lower === "::1" || lower === "::") return true;     // loopback / unspecified
    if (lower.startsWith("fe80:")) return true;             // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    if (lower.startsWith("ff")) return true;                // multicast
    const mapped = lower.match(/^::ffff:([0-9a-f.:]+)$/);
    if (mapped && net.isIPv4(mapped[1])) return isPrivateIpv4(mapped[1]);
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

    if (net.isIP(host)) {
        if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
            throw new SsrfBlockedError(`SSRF guard: host IP '${host}' is in a private/reserved range.`);
        }
        return url;
    }

    const lookup = typeof opts.lookup === "function"
        ? opts.lookup
        : async (h) => dns.lookup(h, { all: true, verbatim: true });

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

    return url;
}

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

module.exports = {
    SsrfBlockedError,
    validateUpstreamUrl,
    safeFetch,
    // exposed for unit tests
    _internals: { isPrivateIpv4, isPrivateIpv6, ipv4ToInt },
};
