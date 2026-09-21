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
//   - Honor an OPERATOR allowlist (XOPAT_SSRF_ALLOWED_HOSTS /
//     XOPAT_SSRF_ALLOWED_CIDRS) so a Dockerized / VPC deployment can reach its
//     own trusted internal backends. The allowlist relaxes ONLY the private-IP
//     verdict for the listed hosts/subnets — scheme + redirect + rebinding
//     protection stay in force. See the allowlist block below. Default empty ⇒
//     strict.
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
const { createBoundedCache } = require("./storage/bounded-cache");

// Default socket-idle timeout for guarded outbound requests. LLM streaming,
// vision inference and slow model-discovery endpoints routinely exceed the old
// 30s value, so the default is generous and operator-tunable via
// XOPAT_SSRF_TIMEOUT_MS. Callers with their own budget (transcription, vision)
// still pass an explicit `timeoutMs` that overrides this. Floored at 1000ms so a
// misconfigured env cannot make every request fail instantly.
const DEFAULT_SSRF_TIMEOUT_MS = (() => {
    const raw = Number.parseInt(String(process.env.XOPAT_SSRF_TIMEOUT_MS || ""), 10);
    return Number.isFinite(raw) && raw >= 1000 ? raw : 120000;
})();

/**
 * Ceiling on a `safeRequest` response body, which is fully materialized.
 *
 * There was no ceiling at all: `res.on("data", …)` accumulated whatever the
 * upstream sent. Set high enough that nothing legitimate trips it — decoded WSI
 * regions, DICOM instances and model responses are genuinely large — and low
 * enough to stop one upstream from exhausting the heap. Callers that stream
 * should use `safeFetch`, which hands back the response object unread.
 */
const DEFAULT_SSRF_MAX_RESPONSE_BYTES = (() => {
    const raw = Number.parseInt(String(process.env.XOPAT_SSRF_MAX_RESPONSE_BYTES || ""), 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 512 * 1024 * 1024;
})();

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

// ---- Operator allowlist for trusted internal upstreams --------------------
//
// Private/reserved ranges are blocked above because they are precisely the SSRF
// target surface: cloud metadata (169.254.169.254 → IAM creds), loopback
// admin/db endpoints, and internal microservices that trust the private network
// and run without auth. A Dockerized / VPC deployment, however, legitimately
// needs to reach its OWN internal backends (e.g. a sibling `internal-backend`
// container on 172.28.0.0/16) — indistinguishable BY IP from the attack. The
// operator is the trust boundary (AGENTS.md §7), so they may vouch for SPECIFIC
// hosts / subnets via two env vars, read once here:
//
//   XOPAT_SSRF_ALLOWED_HOSTS  comma/space list of hostnames (exact, lowercased;
//                             a leading-dot entry like ".internal" matches any
//                             subdomain, mirroring the ".local"/".localhost"
//                             handling below).
//   XOPAT_SSRF_ALLOWED_CIDRS  comma list of IPv4 CIDRs (e.g. 172.28.0.0/16). A
//                             resolved/literal address inside one bypasses the
//                             private-range block.
//
// Empty (the default) ⇒ strict, no carve-out, current behavior unchanged. This
// only relaxes the private-IP verdict for the listed destinations; the scheme
// restriction and the redirect / DNS-rebinding protections are NEVER relaxed,
// even for an allowlisted host — a trusted internal host that 3xx-redirects is
// still refused.
function parseAllowedHosts() {
    return String(process.env.XOPAT_SSRF_ALLOWED_HOSTS || "")
        .split(/[,\s]+/).map(h => h.trim().toLowerCase()).filter(Boolean);
}
function parseAllowedCidrs() {
    const out = [];
    for (const raw of String(process.env.XOPAT_SSRF_ALLOWED_CIDRS || "").split(",")) {
        const entry = raw.trim();
        if (!entry) continue;
        const [addr, prefixStr] = entry.split("/");
        const prefix = Number.parseInt(prefixStr, 10);
        if (!net.isIPv4(addr) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
            // Skip loudly: a malformed entry must not silently widen or void the list.
            console.warn(`[ssrf-guard] ignoring invalid XOPAT_SSRF_ALLOWED_CIDRS entry '${entry}' (IPv4 a.b.c.d/0-32 only).`);
            continue;
        }
        const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
        out.push([ipv4ToInt(addr) & mask, mask]);
    }
    return out;
}
const ALLOWED_HOSTS = parseAllowedHosts();
const ALLOWED_CIDRS = parseAllowedCidrs();

function isAllowlistedHost(host) {
    if (!ALLOWED_HOSTS.length) return false;
    const h = String(host).toLowerCase();
    for (const entry of ALLOWED_HOSTS) {
        if (h === entry) return true;
        if (entry.startsWith(".") && h.endsWith(entry)) return true;   // ".internal" → *.internal
    }
    return false;
}
function isAllowlistedIp(addr) {
    if (!ALLOWED_CIDRS.length || !net.isIPv4(addr)) return false;   // IPv6 CIDR not supported yet
    const value = ipv4ToInt(addr);
    for (const [base, mask] of ALLOWED_CIDRS) {
        if ((value & mask) === base) return true;
    }
    return false;
}

/**
 * Errors leaving this guard carry three fields beyond a plain `Error`:
 *
 *   - `code`         — stable, enum-ish identifier (`SSRF_BLOCKED`,
 *                      `UPSTREAM_UNREACHABLE`, …). Forwarded verbatim to the RPC
 *                      client, so callers can branch on the failure class.
 *   - `publicMessage`— host-free summary. The RPC layer sends THIS in production
 *                      and the full `message` only in dev mode: `message` names
 *                      the upstream URL, which is operator topology and has no
 *                      business in a non-admin's chat panel.
 *   - `cause`        — the original error, so the undici/DNS chain (ECONNREFUSED,
 *                      EAI_AGAIN, …) survives into the server log instead of
 *                      being flattened into the string "fetch failed".
 *   - `retriable`    — optional tri-state replay hint, forwarded to the RPC
 *                      client. Every RPC failure becomes an HTTP 500 on the wire,
 *                      so the client's status heuristic ("5xx may be transient")
 *                      cannot see that the *upstream* answered 401/404 — a verdict
 *                      replaying cannot change. Only the thrower knows, so it
 *                      says so here. `undefined` = unknown, keep the heuristic.
 *
 * @param {string} message full detail, may name the upstream — log/dev surface
 * @param {{ publicMessage?: string, cause?: any, retriable?: boolean }} [options]
 */
class SsrfBlockedError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = "SsrfBlockedError";
        this.code = "SSRF_BLOCKED";
        // Deliberately generic: the detailed variant names the host/address that
        // was refused, which is exactly what must not travel to the client.
        this.publicMessage = options.publicMessage || "upstream blocked by the SSRF guard";
        if (options.cause !== undefined) this.cause = options.cause;
        // A guard verdict is policy, not weather: the same destination is refused
        // on every attempt, so replaying it only burns the client's retry budget.
        this.retriable = false;
    }
}

/** @see SsrfBlockedError for the `code` / `publicMessage` / `cause` / `retriable` contract. */
class UpstreamRequestError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = "UpstreamRequestError";
        this.code = options.code || "UPSTREAM_UNREACHABLE";
        this.publicMessage = options.publicMessage || "upstream request failed";
        if (options.cause !== undefined) this.cause = options.cause;
        // Left undefined unless the thrower actually knows — an absent hint means
        // "use the status heuristic", which is the pre-existing behaviour.
        if (typeof options.retriable === "boolean") this.retriable = options.retriable;
    }
}

/**
 * Turn a transport-level failure into a classified {@link UpstreamRequestError}.
 *
 * Global `fetch` reports every connect/DNS/TLS failure as the same opaque
 * `TypeError: fetch failed` and hides the real reason one level down in
 * `err.cause.code`; `node:http` surfaces it directly on the error. Both are
 * flattened to `message` by the time anything logs them, so the classification
 * has to happen here, at the only place that still has the whole object.
 *
 * @param {any} err original transport error
 * @param {URL} url validated destination (named in `message`, never in `publicMessage`)
 * @param {string} what short description of the operation, e.g. "request"
 */
function classifyUpstreamError(err, url, what = "request") {
    const raw = String(err?.cause?.code || err?.code || err?.name || "");
    let code = "UPSTREAM_UNREACHABLE";
    let summary = "upstream unreachable";
    if (/^(ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|TimeoutError|AbortError)$/.test(raw)) {
        code = "UPSTREAM_TIMEOUT";
        summary = "upstream timed out";
    } else if (/^(ENOTFOUND|EAI_AGAIN)$/.test(raw)) {
        code = "UPSTREAM_DNS";
        summary = "upstream host could not be resolved";
    } else if (/^(CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|ERR_TLS_)/.test(raw)) {
        code = "UPSTREAM_TLS";
        summary = "upstream TLS handshake failed";
    }
    const detail = raw ? ` (${raw})` : "";
    return new UpstreamRequestError(
        `${summary}${detail}: ${what} to ${url?.href || url || "upstream"} failed.`,
        { code, publicMessage: `${summary}${detail}`, cause: err }
    );
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

    // Operator-vouched trusted host (see the allowlist block above): bypasses the
    // loopback/mDNS and private-IP verdicts, but NOT the scheme / redirect /
    // rebinding protections.
    const hostAllowed = isAllowlistedHost(host);

    if (!hostAllowed && (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local"))) {
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
        if ((isPrivateIpv4(literal) || isPrivateIpv6(literal)) && !hostAllowed && !isAllowlistedIp(literal)) {
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
    if (!customLookup && _validatedHostCache.has(host)) return url;

    let addresses;
    try {
        addresses = await lookup(host);
    } catch (err) {
        // A name that does not resolve is an unreachable upstream, not a blocked
        // one — report it as such so an operator can tell "my baseUrl is wrong"
        // from "the guard refused this destination".
        const raw = String(err?.code || "");
        throw new UpstreamRequestError(
            `upstream DNS lookup failed for '${host}'${raw ? ` (${raw})` : ""}: ${(err && err.message) || err}`,
            {
                code: "UPSTREAM_DNS",
                publicMessage: `upstream host could not be resolved${raw ? ` (${raw})` : ""}`,
                cause: err,
            }
        );
    }
    if (!addresses || !addresses.length) {
        throw new UpstreamRequestError(`upstream DNS lookup returned no addresses for '${host}'.`, {
            code: "UPSTREAM_DNS",
            publicMessage: "upstream host could not be resolved",
        });
    }
    for (const { address } of addresses) {
        if ((isPrivateIpv4(address) || isPrivateIpv6(address)) && !hostAllowed && !isAllowlistedIp(address)) {
            throw new SsrfBlockedError(
                `SSRF guard: '${host}' resolved to private/reserved address '${address}'.`
            );
        }
    }

    if (!customLookup) _validatedHostCache.set(host, true);

    return url;
}

/**
 * @see validateUpstreamUrl — positive verdicts only, short TTL.
 *
 * `has()` reads without refreshing the TTL, so an entry expires 45 s after the
 * DNS check that created it however often it is consulted. That is deliberate:
 * the entry is a *verdict about a resolution*, and refreshing it on read would
 * let a hot upstream keep a stale verdict alive indefinitely.
 */
const VALIDATED_HOST_TTL_MS = 45_000;
const VALIDATED_HOST_CACHE_MAX = 256;
const _validatedHostCache = createBoundedCache({
    name: "core:ssrf-validated-hosts",
    ttlMs: VALIDATED_HOST_TTL_MS,
    maxEntries: VALIDATED_HOST_CACHE_MAX,
});

/**
 * Validated `fetch`. Vets the URL through `validateUpstreamUrl`, forces
 * `redirect: "manual"` and throws on any 3xx so attacker-controlled
 * upstreams cannot chain redirects into private space.
 *
 * A default idle timeout (DEFAULT_SSRF_TIMEOUT_MS, env XOPAT_SSRF_TIMEOUT_MS)
 * bounds otherwise-unbounded discovery/oidc calls; pass `timeoutMs` to override
 * or an explicit `signal` to combine with your own deadline. Pass
 * `timeoutMs: 0` to opt out entirely.
 *
 * @param {string} urlStr
 * @param {RequestInit & { allowHosts?: string[], _lookup?: Function, timeoutMs?: number }} [init]
 */
async function safeFetch(urlStr, init = {}) {
    const { allowHosts, _lookup, timeoutMs = DEFAULT_SSRF_TIMEOUT_MS, signal, ...rest } = init;
    const url = await validateUpstreamUrl(urlStr, { allowHosts, lookup: _lookup });

    // Combine the caller's signal (if any) with a timeout deadline. Global fetch
    // has no `timeout` option, so a hung upstream would otherwise never resolve.
    const signals = [];
    if (signal) signals.push(signal);
    let timer = null;
    if (timeoutMs > 0 && typeof AbortSignal?.timeout === "function") {
        signals.push(AbortSignal.timeout(timeoutMs));
    } else if (timeoutMs > 0) {
        const ac = new AbortController();
        timer = setTimeout(() => ac.abort(new Error(`safeFetch: ${url.origin} timed out after ${timeoutMs}ms.`)), timeoutMs);
        signals.push(ac.signal);
    }
    // The old fallback was `signals[0]`, which silently DROPPED the timeout
    // whenever the caller also passed a signal (caller's signal sorts first) —
    // exactly the combination where a hung upstream matters most. Fan the
    // signals into one controller by hand instead.
    let combinedSignal;
    if (signals.length === 1) {
        combinedSignal = signals[0];
    } else if (signals.length > 1) {
        if (typeof AbortSignal?.any === "function") {
            combinedSignal = AbortSignal.any(signals);
        } else {
            const ac = new AbortController();
            const forward = (s) => ac.abort(s.reason);
            for (const s of signals) {
                if (s.aborted) { forward(s); break; }
                s.addEventListener("abort", () => forward(s), { once: true });
            }
            combinedSignal = ac.signal;
        }
    }

    let res;
    try {
        res = await fetch(url, { ...rest, redirect: "manual", ...(combinedSignal ? { signal: combinedSignal } : {}) });
    } catch (err) {
        // A caller-driven abort is that caller's own control flow — never
        // reclassify it as an upstream fault.
        if (signal?.aborted) throw err;
        throw classifyUpstreamError(err, url, "fetch");
    } finally {
        if (timer) clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location") || "";
        throw new SsrfBlockedError(
            `SSRF guard: upstream ${url.origin} returned ${res.status}` +
            (location ? ` → ${location}` : "") +
            " (redirects are disabled on this code path).",
            { publicMessage: `upstream returned an unfollowed redirect (${res.status})` }
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
        const hostAllowed = isAllowlistedHost(hostname);
        Promise.resolve()
            .then(() => resolver(hostname))
            .then((records) => {
                const list = Array.isArray(records) ? records : [records];
                if (!list.length) {
                    throw new SsrfBlockedError(`SSRF guard: '${hostname}' did not resolve to an address.`);
                }
                for (const rec of list) {
                    if ((isPrivateIpv4(rec.address) || isPrivateIpv6(rec.address)) && !hostAllowed && !isAllowlistedIp(rec.address)) {
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
    const {
        allowHosts, _lookup, method = "GET", headers = {}, body = null,
        timeoutMs = DEFAULT_SSRF_TIMEOUT_MS, signal,
        maxResponseBytes = DEFAULT_SSRF_MAX_RESPONSE_BYTES,
    } = init;
    const url = await validateUpstreamUrl(urlStr, { allowHosts, lookup: _lookup });
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? require("node:https") : require("node:http");

    return new Promise((resolve, reject) => {
        // Transport failures are classified; verdicts that already carry a code
        // (a connect-time SSRF block, a timeout) and caller-driven aborts pass
        // through untouched — reclassifying them would erase the real reason.
        const rejectTransport = (err) => {
            // Only OUR verdicts and caller aborts pass through — a raw socket
            // error carries its own `code` (ECONNREFUSED, …) and must still be
            // classified, so "has a code" is not the test.
            const alreadyClassified = err instanceof SsrfBlockedError || err instanceof UpstreamRequestError;
            if (signal?.aborted || alreadyClassified) reject(err);
            else reject(classifyUpstreamError(err, url, `${method} request`));
        };
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
                autoSelectFamily: true,
                autoSelectFamilyAttemptTimeout: 5000,
            },
            (res) => {
                const status = res.statusCode || 0;
                if (status >= 300 && status < 400) {
                    res.resume();
                    const location = res.headers.location || "";
                    reject(new SsrfBlockedError(
                        `SSRF guard: upstream ${url.origin} returned ${status}` +
                        (location ? ` → ${location}` : "") +
                        " (redirects are disabled on this code path).",
                        { publicMessage: `upstream returned an unfollowed redirect (${status})` }
                    ));
                    return;
                }
                // `safeRequest` materializes the whole response, so it needs a
                // ceiling — without one a hostile or merely enormous upstream
                // could make the server allocate without bound, which is the
                // same class of bug the request-body caps exist to prevent.
                // Generous by default (model weights, WSI regions and DICOM
                // instances are legitimately large); override per call.
                const chunks = [];
                let received = 0;
                res.on("data", (chunk) => {
                    received += chunk.length;
                    if (received > maxResponseBytes) {
                        res.destroy();
                        reject(new SsrfBlockedError(
                            `SSRF guard: response from ${url.origin} exceeded ${maxResponseBytes} bytes.`,
                            { publicMessage: `upstream response exceeded ${maxResponseBytes} bytes` }
                        ));
                        return;
                    }
                    chunks.push(chunk);
                });
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
                res.on("error", rejectTransport);
            }
        );
        req.on("error", rejectTransport);
        req.on("timeout", () => req.destroy(new UpstreamRequestError(
            `upstream request to ${url.origin} timed out after ${timeoutMs}ms.`,
            { code: "UPSTREAM_TIMEOUT", publicMessage: `upstream timed out after ${timeoutMs}ms` }
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
    UpstreamRequestError,
    classifyUpstreamError,
    validateUpstreamUrl,
    safeFetch,
    safeRequest,
    createValidatingLookup,
    // exposed for unit tests
    _internals: { isPrivateIpv4, isPrivateIpv6, ipv4ToInt, expandIpv6 },
};
