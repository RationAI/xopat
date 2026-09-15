/**
 * The `cookies` KV driver owns `document.cookie` directly — js-cookie is no
 * longer vendored (it was one of six `src/external/*` startup scripts).
 *
 * What these vectors pin:
 *  - the RFC-6265 encoding is js-cookie's, not a naive `encodeURIComponent`,
 *    so cookies written by an older xOpat build stay readable;
 *  - a configured `domain` is normalised to a bare host. `ENV.client.domain`
 *    is an ORIGIN in most deployments, and a browser that sees a scheme in
 *    `domain=` drops the WHOLE cookie — which silently made every cookie write
 *    a no-op wherever `js_cookie_domain` was unset;
 *  - a foreign, malformed cookie in the jar does not take the others down;
 *  - `secure` / `sameSite` are emitted only when actually configured.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

/**
 * Put `document` back the way it was.
 *
 * Unit suites share one worker and therefore one `globalThis`. Leaving a
 * cookie-jar stand-in installed handed the next suite a `document` with no
 * `getElementById`, which is not a failure this file's subject can explain.
 */
const ORIGINAL_DOCUMENT = Object.getOwnPropertyDescriptor(globalThis, "document");
test.afterEach(() => {
    if (ORIGINAL_DOCUMENT) Object.defineProperty(globalThis, "document", ORIGINAL_DOCUMENT);
    else delete globalThis.document;
});

/** A jar that records raw `Set-Cookie`-ish writes and applies the plausible ones. */
function installCookieJar() {
    const jar = new Map();
    const writes = [];
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        // `writable` defaults to FALSE on defineProperty, which froze the global
        // for every later test sharing this worker: a suite that does the ordinary
        // `globalThis.document = globalThis.document ?? {…}` then threw
        // "Cannot assign to read only property 'document'". This installs a
        // stand-in; it does not claim the name.
        writable: true,
        value: {
            get cookie() {
                return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
            },
            set cookie(raw) {
                writes.push(raw);
                const [pair, ...attrs] = raw.split("; ");
                const eq = pair.indexOf("=");
                const name = pair.slice(0, eq);
                const value = pair.slice(eq + 1);
                const expires = attrs.find(a => a.toLowerCase().startsWith("expires="));
                if (expires && new Date(expires.slice(8)).getTime() < Date.now()) {
                    jar.delete(name);
                    return;
                }
                jar.set(name, value);
            },
        },
    });
    return { jar, writes, seed: (k, v) => jar.set(k, v) };
}

globalThis.XOpatStorageAvailability = { cookies: true };
const { makeCookiesDriver } = await import("../../../src/classes/io/kv-drivers.ts");
const { normalizeCookieDomain } = await import("../../../src/classes/io/bootstrap.ts");

test("a value survives a write/read round-trip @unit", () => {
    const { jar } = installCookieJar();
    const driver = makeCookiesDriver("cookies", { path: "/" });
    driver.setItem("session", "abc123");
    expect(jar.size).toBe(1);
    expect(driver.getItem("session")).toBe("abc123");
    expect(driver.getItem("absent")).toBe(null);
});

test("js-cookie's encoding is preserved, not a naive encodeURIComponent @unit", () => {
    const { jar } = installCookieJar();
    const driver = makeCookiesDriver("cookies", {});
    // `::` is xOpat's owner separator and appears in EVERY real key.
    driver.setItem("core::pref", "a b/c=d");
    const [rawName, rawValue] = [...jar.entries()][0];
    // js-cookie decodes the RFC-6265-permitted set back after escaping, so `/`
    // and `=` stay literal while the separator stays percent-encoded.
    expect(rawName).toBe("core%3A%3Apref");
    expect(rawValue).toBe("a%20b/c=d");
    expect(driver.getItem("core::pref")).toBe("a b/c=d");
});

test("a malformed foreign cookie does not hide the others @unit", () => {
    const { seed } = installCookieJar();
    seed("good", "value");
    seed("broken", "%E0%A4%A");   // truncated escape — decodeURIComponent throws
    const driver = makeCookiesDriver("cookies", {});
    expect(driver.getItem("good")).toBe("value");
    expect(driver.getItem("broken")).toBe(null);
});

test("removal expires the cookie in the past @unit", () => {
    const { jar, writes } = installCookieJar();
    const driver = makeCookiesDriver("cookies", { path: "/" });
    driver.setItem("gone", "1");
    driver.removeItem("gone");
    expect(jar.has("gone")).toBe(false);
    expect(writes.at(-1)).toContain("expires=");
    // The delete must repeat the write's path, or the browser keeps the original.
    expect(writes.at(-1)).toContain("path=/");
});

test("secure and sameSite are emitted only when configured @unit", () => {
    const { writes } = installCookieJar();
    makeCookiesDriver("cookies", { secure: false, sameSite: "" }).setItem("a", "1");
    expect(writes.at(-1)).not.toContain("secure");
    expect(writes.at(-1)).not.toContain("samesite");

    makeCookiesDriver("cookies", { secure: true, sameSite: "strict" }).setItem("b", "1");
    expect(writes.at(-1)).toContain("; secure");
    expect(writes.at(-1)).toContain("; samesite=strict");
});

test("an origin-shaped domain is reduced to its host @unit", () => {
    // The regression: ENV.client.domain is an origin, and `domain=https://…`
    // makes the browser reject the cookie outright.
    expect(normalizeCookieDomain("http://localhost:9300")).toBe("localhost");
    expect(normalizeCookieDomain("https://viewer.example.org:8443")).toBe("viewer.example.org");
    // An already-bare host is passed through untouched.
    expect(normalizeCookieDomain(".example.org")).toBe(".example.org");
    expect(normalizeCookieDomain("")).toBe(undefined);
    expect(normalizeCookieDomain(null)).toBe(undefined);
    expect(normalizeCookieDomain(undefined)).toBe(undefined);
});

test("an unavailable cookie jar degrades to memory instead of throwing @unit", () => {
    installCookieJar();
    globalThis.XOpatStorageAvailability = { cookies: false };
    try {
        const driver = makeCookiesDriver("cookies", {});
        driver.setItem("k", "v");
        expect(driver.getItem("k")).toBe("v");
        expect(document.cookie).toBe("");
    } finally {
        globalThis.XOpatStorageAvailability = { cookies: true };
    }
});
