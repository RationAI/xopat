/**
 * SSRF guard — regression suite.
 *
 * Was the first item on `test/TEST_COVERAGE_GAPS.md` (that doc lists only what
 * is still uncovered, so the entry is gone): a security control, pure, and
 * pre-instrumented (`_internals` has been exported for tests since the guard was
 * written, and nothing used it). The address vectors live here now.
 *
 * The IPv6 checks were string-based until the PR #188 review and let hex-form
 * mapped addresses through. `::ffff:7f00:1`, `::ffff:a9fe:a9fe` and
 * `0:0:0:0:0:ffff:127.0.0.1` are each the same address as a blocked dotted form
 * spelled differently — that equivalence is the whole point of the vectors
 * below, and it is exactly what a string comparison misses.
 *
 * Beyond the address table this also pins the properties the guard promises but
 * that the table cannot express: bracketed literals take a different code path,
 * redirects are refused rather than followed, `allowHosts` may only ever
 * *narrow*, and validation happens at CONNECT time so a DNS rebind between
 * resolve and connect is still caught.
 *
 * Run: npm run test:ssrf
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { fromRoot } from "@xopat/test-harness/paths";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const guard = require(fromRoot("server", "node", "ssrf-guard.js"));

const { isPrivateIpv4, isPrivateIpv6, ipv4ToInt, expandIpv6 } = guard._internals;
const { validateUpstreamUrl, safeFetch, SsrfBlockedError } = guard;

let failed = 0;
let n = 0;
function ok(name, cond, detail) {
    n++;
    if (cond) {
        console.log(`ok ${n} - ${name}`);
    } else {
        failed++;
        console.log(`not ok ${n} - ${name}${detail ? `\n  ${detail}` : ""}`);
    }
}
function eq(name, actual, expected) {
    ok(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
async function codeOf(promise) {
    try { await promise; return null; } catch (e) { return e?.code || e?.name || e?.message; }
}

// ── A. IPv4 blocks ──────────────────────────────────────────────────────────
console.log("# isPrivateIpv4");
{
    const blocked = [
        ["loopback", "127.0.0.1"],
        ["loopback, whole /8", "127.255.255.254"],
        ["RFC1918 10/8", "10.0.0.1"],
        ["RFC1918 172.16/12", "172.16.0.1"],
        ["RFC1918 172.31 (upper edge)", "172.31.255.255"],
        ["RFC1918 192.168/16", "192.168.1.1"],
        ["link-local", "169.254.1.1"],
        ["cloud metadata", "169.254.169.254"],
        ["Azure wireserver", "168.63.129.16"],
        ["CGNAT 100.64/10", "100.64.0.1"],
        ["this-network 0/8", "0.0.0.0"],
    ];
    for (const [what, ip] of blocked) ok(`blocks ${what} (${ip})`, isPrivateIpv4(ip) === true);

    const allowed = [
        ["a public address", "8.8.8.8"],
        ["Cloudflare", "1.1.1.1"],
        ["just below 172.16/12", "172.15.255.255"],
        ["just above 172.16/12", "172.32.0.1"],
        ["just below CGNAT", "100.63.255.255"],
        ["just above CGNAT", "100.128.0.1"],
    ];
    for (const [what, ip] of allowed) ok(`allows ${what} (${ip})`, isPrivateIpv4(ip) === false);

    // The boundary arithmetic is where an off-by-one hides.
    ok("ipv4ToInt is unsigned (no sign flip above 127.x)", ipv4ToInt("255.255.255.255") === 4294967295);
    ok("ipv4ToInt orders correctly", ipv4ToInt("10.0.0.1") < ipv4ToInt("10.0.1.0"));
}

// ── B. IPv6 expansion and blocks ────────────────────────────────────────────
console.log("# isPrivateIpv6 — the mapped-address equivalence");
{
    // Every one of these must stay blocked; the three marked below are the
    // ones that regressed before the PR #188 review.
    const mustBlock = [
        "::1",
        "::",
        "::ffff:127.0.0.1",
        "::ffff:7f00:1",                 // regressed once: hex form of 127.0.0.1
        "::ffff:a9fe:a9fe",              // regressed once: hex form of 169.254.169.254
        "0:0:0:0:0:ffff:127.0.0.1",      // regressed once: fully-expanded form
        "::ffff:169.254.169.254",
        "::ffff:10.0.0.1",
        "fe80::1",
        "fe9f::1",
        "feaf::1",
        "febf::1",
        "fec0::1",
        "fc00::1",
        "fd12:3456::1",
        "ff02::1",
        "::ffff:168.63.129.16",
        "::ffff:100.64.0.1",
        "::ffff:c0a8:1",                 // hex form of 192.168.0.1
        "::127.0.0.1",
    ];
    for (const ip of mustBlock) ok(`blocks ${ip}`, isPrivateIpv6(ip) === true);

    const mustAllow = [
        "2606:4700:4700::1111",
        "2001:4860:4860::8888",
        "2a00:1450:4001:80f::200e",
    ];
    for (const ip of mustAllow) ok(`allows public ${ip}`, isPrivateIpv6(ip) === false);

    // The equivalence itself, stated directly: differing spellings of one
    // address must produce one verdict.
    ok("hex and dotted spellings of 127.0.0.1 agree",
        isPrivateIpv6("::ffff:7f00:1") === isPrivateIpv6("::ffff:127.0.0.1"));
    ok("compressed and expanded spellings agree",
        isPrivateIpv6("::ffff:127.0.0.1") === isPrivateIpv6("0:0:0:0:0:ffff:127.0.0.1"));

    // Scope note: `isPrivateIpv6` answers "is this IPv6 address private", so a
    // string that is not an IPv6 address at all is correctly `false` — the rule
    // does not apply to it. Degrade-closed lives one level up: such a string is
    // never an address the guard would connect to, and `validateUpstreamUrl`
    // refuses a hostname it cannot resolve (see §C).
    for (const notV6 of ["not-an-address", "::gggg", "1:2:3:4:5:6:7:8:9", "", "127.0.0.1"]) {
        ok(`non-IPv6 input is out of scope, not a false allow: ${JSON.stringify(notV6)}`,
            isPrivateIpv6(notV6) === false);
    }
    // The genuine degrade-closed branch: valid IPv6 that cannot be expanded.
    ok("a valid-but-unexpandable address degrades closed",
        expandIpv6("1:2:3:4:5:6:7:8:9") === null || expandIpv6("1:2:3:4:5:6:7:8:9") === undefined);

    ok("expandIpv6 produces 8 groups", (expandIpv6("::1") || []).length === 8);
    ok("expandIpv6 rejects malformed input", !expandIpv6("1:2:3:4:5:6:7:8:9"));
}

// ── C. validateUpstreamUrl — scheme, hostname, bracketed literals ───────────
console.log("# validateUpstreamUrl");
{
    // Bracketed IPv6 literals take a different code path than bare ones — the
    // brackets have to be stripped before the address is parsed.
    eq("a bracketed private IPv6 literal is blocked",
        await codeOf(validateUpstreamUrl("http://[fec0::1]/x")), "SSRF_BLOCKED");
    eq("a bracketed loopback literal is blocked",
        await codeOf(validateUpstreamUrl("http://[::1]/x")), "SSRF_BLOCKED");
    eq("a bracketed mapped-loopback literal is blocked",
        await codeOf(validateUpstreamUrl("http://[::ffff:7f00:1]/x")), "SSRF_BLOCKED");

    eq("a literal private IPv4 is blocked",
        await codeOf(validateUpstreamUrl("http://169.254.169.254/latest/meta-data/")), "SSRF_BLOCKED");
    eq("localhost by name is blocked",
        await codeOf(validateUpstreamUrl("http://localhost:8080/")), "SSRF_BLOCKED");
    eq("a .localhost name is blocked",
        await codeOf(validateUpstreamUrl("http://foo.localhost/")), "SSRF_BLOCKED");

    // Non-HTTP schemes are the other half of the same door.
    for (const url of ["file:///etc/passwd", "gopher://x/", "ftp://x/", "data:text/plain,hi"]) {
        eq(`non-http scheme refused: ${url}`, await codeOf(validateUpstreamUrl(url)), "SSRF_BLOCKED");
    }

    // A stubbed lookup keeps the suite offline while still exercising the
    // resolve-then-verdict path for a NAME (not a literal).
    // The guard's lookup seam is promise-returning and takes only the host —
    // the same shape for the pre-flight and for createValidatingLookup.
    const lookupTo = (addr, family = 4) => async () => [{ address: addr, family }];
    eq("a name resolving into RFC1918 is blocked",
        await codeOf(validateUpstreamUrl("http://internal.example/", { lookup: lookupTo("10.1.2.3") })),
        "SSRF_BLOCKED");
    eq("a name resolving to metadata is blocked",
        await codeOf(validateUpstreamUrl("http://meta.example/", { lookup: lookupTo("169.254.169.254") })),
        "SSRF_BLOCKED");
    eq("a name resolving into a mapped-private IPv6 is blocked",
        await codeOf(validateUpstreamUrl("http://v6.example/", { lookup: lookupTo("::ffff:10.0.0.1", 6) })),
        "SSRF_BLOCKED");
    ok("a name resolving public is allowed",
        (await validateUpstreamUrl("http://ok.example/x", { lookup: lookupTo("93.184.216.34") })) instanceof URL);
}

// ── D. allowHosts narrows; only the OPERATOR allowlist relaxes ──────────────
console.log("# allowHosts narrowing");
{
    const lookupTo = (addr) => async () => [{ address: addr, family: 4 }];

    // Two different mechanisms, easy to conflate, opposite directions:
    //
    //   opts.allowHosts        — a CALLER-side restriction. "only these hosts",
    //                            applied on top of every other check.
    //   XOPAT_SSRF_ALLOWED_HOSTS — the OPERATOR carve-out, the only thing that
    //                            relaxes the private-IP verdict.
    //
    // Conflating them is how an allowlist becomes a bypass, so pin both.
    ok("a caller allowlist permits a listed host that resolves public",
        (await validateUpstreamUrl("http://allowed.example/x", {
            allowHosts: ["allowed.example"],
            lookup: lookupTo("93.184.216.34"),
        })) instanceof URL);

    eq("…and refuses a host that is not on it, however public it resolves",
        await codeOf(validateUpstreamUrl("http://other.example/x", {
            allowHosts: ["allowed.example"],
            lookup: lookupTo("93.184.216.34"),
        })), "SSRF_BLOCKED");

    // THE property of a caller allowlist: it must restrict, never bypass.
    eq("a caller allowlist does NOT unlock a private address",
        await codeOf(validateUpstreamUrl("http://allowed.example/x", {
            allowHosts: ["allowed.example"],
            lookup: lookupTo("172.28.0.5"),
        })), "SSRF_BLOCKED");

    eq("…nor the metadata endpoint",
        await codeOf(validateUpstreamUrl("http://allowed.example/x", {
            allowHosts: ["allowed.example"],
            lookup: lookupTo("169.254.169.254"),
        })), "SSRF_BLOCKED");

    eq("…nor a non-http scheme",
        await codeOf(validateUpstreamUrl("file:///etc/passwd", { allowHosts: ["allowed.example"] })),
        "SSRF_BLOCKED");
}

// ── E. The operator carve-out relaxes the private-IP verdict, nothing else ──
console.log("# operator allowlist (XOPAT_SSRF_ALLOWED_HOSTS / _CIDRS)");
{
    // Read once at module load, so this needs a fresh process per configuration.
    const { execFileSync } = await import("node:child_process");
    const guardPath = fromRoot("server", "node", "ssrf-guard.js")
        .replace(/\\/g, "\\\\");

    const probe = (env, urlStr, addr) => {
        const script = `
            const g = require("${guardPath}");
            const lookup = async () => [{ address: ${JSON.stringify(addr)}, family: 4 }];
            g.validateUpstreamUrl(${JSON.stringify(urlStr)}, { lookup })
                .then(() => console.log("ALLOWED"))
                .catch(e => console.log(e && e.code === "SSRF_BLOCKED" ? "BLOCKED" : "ERROR:" + (e && e.message)));
        `;
        return execFileSync(process.execPath, ["-e", script], {
            env: { ...process.env, ...env }, encoding: "utf8",
        }).trim().split("\n").pop();
    };

    eq("a host named in XOPAT_SSRF_ALLOWED_HOSTS may reach a private address",
        probe({ XOPAT_SSRF_ALLOWED_HOSTS: "internal-backend" }, "http://internal-backend/x", "172.28.0.5"),
        "ALLOWED");
    eq("…while every other host stays blocked in that same range",
        probe({ XOPAT_SSRF_ALLOWED_HOSTS: "internal-backend" }, "http://other-host/x", "172.28.0.5"),
        "BLOCKED");
    eq("an address inside XOPAT_SSRF_ALLOWED_CIDRS is permitted",
        probe({ XOPAT_SSRF_ALLOWED_CIDRS: "172.28.0.0/16" }, "http://anything/x", "172.28.0.5"),
        "ALLOWED");
    eq("…but an address outside the CIDR is not",
        probe({ XOPAT_SSRF_ALLOWED_CIDRS: "172.28.0.0/16" }, "http://anything/x", "10.0.0.5"),
        "BLOCKED");
    eq("the carve-out never reaches the metadata endpoint by default",
        probe({ XOPAT_SSRF_ALLOWED_CIDRS: "172.28.0.0/16" }, "http://anything/x", "169.254.169.254"),
        "BLOCKED");
    eq("with no carve-out configured the default is strict",
        probe({}, "http://internal-backend/x", "172.28.0.5"),
        "BLOCKED");
}

// ── F. Redirects are refused, not followed ──────────────────────────────────
console.log("# redirect refusal");
{
    // A 3xx from a vouched-for upstream is the credential-harvesting primitive
    // the guard exists to stop, so it must be an error rather than a hop.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
    });
    try {
        // `safeFetch` hands `_lookup` to validateUpstreamUrl, which awaits it —
        // so the stub must be promise-shaped. It used to be written in Node's
        // callback shape, which threw inside the pre-flight and made this case
        // pass on a DNS error without ever reaching the redirect check.
        const code = await codeOf(safeFetch("http://ok.example/x", {
            _lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        }));
        eq("a 3xx response is refused rather than followed", code, "SSRF_BLOCKED");
    } finally {
        globalThis.fetch = realFetch;
    }
}

// ── G. Validation happens at connect time (DNS rebinding) ───────────────────
console.log("# connect-time validation");
{
    // The rebinding attack: resolve returns a public address, then the SECOND
    // resolution — the one the socket actually uses — returns a private one.
    // `safeRequest` installs a validating lookup so the check happens on the
    // address the connection really goes to, not the one we saw first.
    let call = 0;
    const rebinding = async () => {
        call += 1;
        // First answer (the pre-flight) is public and passes; the second — the
        // one the socket actually uses — is the metadata endpoint.
        return [{ address: call === 1 ? "93.184.216.34" : "169.254.169.254", family: 4 }];
    };

    const code = await codeOf(guard.safeRequest("http://rebind.example/x", {
        _lookup: rebinding,
        timeoutMs: 2000,
    }));
    ok("a rebind between resolve and connect is caught",
        code === "SSRF_BLOCKED",
        `got ${code} after ${call} lookup(s)`);
    ok("…which means the lookup really was consulted more than once", call >= 2, `call=${call}`);
}

// ── done ────────────────────────────────────────────────────────────────────
console.log(failed ? `\n# ${failed} of ${n} FAILED` : `\n# all ${n} passed`);
process.exit(failed ? 1 : 0);
