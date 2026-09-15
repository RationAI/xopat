/**
 * The `/proxy/<alias>` route checks a session cookie and a CSRF header. Neither is
 * authorization: a session is minted to any anonymous page load and the CSRF token
 * is rendered into that page, so the pair proves same-origin and nothing else. An
 * alias that attaches an operator API key via `proxies.<alias>.headers` was
 * therefore an open relay to its upstream — on the operator's credential — for
 * every visitor of the deployment.
 *
 * Two gates close that, and both are pure functions so they can be pinned here:
 * the per-session alias allowlist (`session.allowedProxies`, a field that existed
 * and was never read) and the credential gate.
 */
import { test, expect } from "@xopat/test-harness";

const load = () => import("../../../server/node/auth.js");

test("@security unrestricted sessions reach any alias", async () => {
    const { proxyAliasAllowedForSession } = await load();
    // 'ALL' is what createSession mints. Absent covers sessions persisted before
    // the field existed — both must stay unrestricted, or upgrading the server
    // breaks every deployment that never logs anyone in.
    expect(proxyAliasAllowedForSession({ allowedProxies: "ALL" }, "cerit")).toBe(true);
    expect(proxyAliasAllowedForSession({}, "cerit")).toBe(true);
    expect(proxyAliasAllowedForSession(undefined, "cerit")).toBe(true);
});

test("@security a narrowed session reaches only its listed aliases", async () => {
    const { proxyAliasAllowedForSession } = await load();
    const session = { allowedProxies: ["cerit", "github"] };
    expect(proxyAliasAllowedForSession(session, "cerit")).toBe(true);
    expect(proxyAliasAllowedForSession(session, "mlflow")).toBe(false);
    expect(proxyAliasAllowedForSession({ allowedProxies: [] }, "cerit")).toBe(false);
    expect(proxyAliasAllowedForSession({ allowedProxies: "NONE" }, "cerit")).toBe(false);
});

test("@security an unreadable allowedProxies denies rather than falls open", async () => {
    const { proxyAliasAllowedForSession } = await load();
    // The only reason the field is neither sentinel nor array is that something
    // tried to restrict this session. Degrade closed.
    expect(proxyAliasAllowedForSession({ allowedProxies: "cerit" }, "cerit")).toBe(false);
    expect(proxyAliasAllowedForSession({ allowedProxies: { cerit: true } }, "cerit")).toBe(false);
    expect(proxyAliasAllowedForSession({ allowedProxies: 0 }, "cerit")).toBe(false);
});

test("setSessionAllowedProxies mutates in place so the write-back sees it", async () => {
    const { setSessionAllowedProxies } = await load();
    const session = { id: "s1", allowedProxies: "ALL" };
    setSessionAllowedProxies(session, ["cerit"]);
    expect(session.allowedProxies).toEqual(["cerit"]);
    setSessionAllowedProxies(session, "NONE");
    expect(session.allowedProxies).toBe("NONE");
    // Non-string members would produce an allowlist entry nothing can match, but
    // also one nothing can audit. Drop them.
    setSessionAllowedProxies(session, ["cerit", 5, "", null]);
    expect(session.allowedProxies).toEqual(["cerit"]);
    expect(() => setSessionAllowedProxies(session, "cerit")).toThrow();
});

test("setSessionAllowedProxies is a no-op without a session", async () => {
    const { setSessionAllowedProxies } = await load();
    // Called from a login path that may have no session yet; must not throw there.
    expect(() => setSessionAllowedProxies(null, ["cerit"])).not.toThrow();
});

test("@security a credential-bearing alias with no verifier is refused", async () => {
    const { checkProxyCredentialGate } = await load();
    const gate = checkProxyCredentialGate("cerit", {
        baseUrl: "https://api.example.com",
        headers: { Authorization: "Bearer secret" },
    }, {});
    expect(gate.ok).toBe(false);
    // The response renders on the viewer's own origin; the alias is not echoed.
    expect(gate.message).not.toContain("cerit");
});

test("@security an alias with auth but no verifiers is still refused", async () => {
    const { checkProxyCredentialGate } = await load();
    // `enabled: true` with an empty verifier list runs nothing — verifyProxyAuth
    // 500s on it, but only after the credentials were already assembled.
    for (const auth of [{ enabled: true }, { enabled: true, verifiers: [] }, { verifiers: [] }]) {
        expect(checkProxyCredentialGate("cerit", {
            headers: { Authorization: "Bearer secret" }, auth,
        }, {}).ok).toBe(false);
    }
});

test("a credential-bearing alias with a verifier passes", async () => {
    const { checkProxyCredentialGate } = await load();
    // Both accepted verifier shapes: a name list and a name => config map.
    for (const verifiers of [["jwt"], { jwt: { issuer: "https://login.example.com/" } }]) {
        expect(checkProxyCredentialGate("cerit", {
            headers: { Authorization: "Bearer secret" },
            auth: { enabled: true, verifiers },
        }, {}).ok).toBe(true);
    }
});

test("an alias carrying no credentials is never gated", async () => {
    const { checkProxyCredentialGate } = await load();
    // The image-server / mlflow shape: a plain reverse proxy to an upstream that
    // needs no key. Nothing of the operator's is at stake, so this stays open.
    expect(checkProxyCredentialGate("image-server", { baseUrl: "http://localhost:8080" }, {}).ok).toBe(true);
    expect(checkProxyCredentialGate("image-server", { baseUrl: "http://x", headers: {} }, {}).ok).toBe(true);
});

test("@security only an EXPLICIT opt-out unlocks a credential-bearing alias", async () => {
    const { checkProxyCredentialGate } = await load();
    const credentialed = { headers: { Authorization: "Bearer secret" } };
    // Present block saying "public" — the operator stated it.
    expect(checkProxyCredentialGate("github", { ...credentialed, auth: { enabled: false } }, {}).ok).toBe(true);
    // Deployment-wide switch.
    expect(checkProxyCredentialGate("github", credentialed, { proxyCredentialsRequireAuth: false }).ok).toBe(true);
    // A missing block is an omission, not a statement, and `true`/absent keep the
    // gate on — the whole point is that the dangerous shape cannot be reached by
    // forgetting something.
    expect(checkProxyCredentialGate("github", credentialed, { proxyCredentialsRequireAuth: true }).ok).toBe(false);
    expect(checkProxyCredentialGate("github", credentialed, undefined).ok).toBe(false);
});
