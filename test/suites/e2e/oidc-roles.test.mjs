/**
 * The same rules, the other protocol.
 *
 * `saml-roles.test.mjs` proves that a Keycloak group reaches a capability
 * decision. This proves the part that suite cannot: that **none of that chain is
 * SAML**. `core.roles.claims` names a claim and a context, `chat-openai` names a
 * context, and the broker underneath is a `modules` choice — so the deployment
 * here (`test/env/oidc.json`) carries those two blocks copied verbatim from the
 * SAML one and changes only which module claims `core`.
 *
 *   Keycloak group → `groups` claim → the token oidc-client-ts holds for `core`
 *   → core.roles.claims → assignRoles → capability resolution → what the UI
 *   offers and what the pipeline lets through.
 *
 * Every helper below is the SAML suite's, unchanged and not re-parameterized:
 * `APPLICATION_CONTEXT.auth.login("core")`, the Keycloak login form, `XOpatUser`.
 * That they port across untouched is itself the claim being made — if this file
 * ever needs an OIDC-shaped branch, the indirection has sprung a leak.
 *
 * IdP: `test/fixtures/keycloak/`, the same container the `saml` project uses, via
 * a second client (`xopat-viewer-oidc`, public + PKCE). Without it the suite
 * skips with instructions rather than timing out — including the case that only
 * bites here, a container older than that client (see `requireKeycloakOidc`).
 */
import { test, expect, requireKeycloakOidc } from "@xopat/test-harness";

/** Sign in through the Keycloak login form and wait for the viewer to settle. */
async function login(xopat, username, password) {
    const page = xopat.page;
    await page.getByLabel(/username|email/i).first().fill(username);
    await page.getByLabel(/password/i).first().fill(password);
    await page.getByRole("button", { name: /sign in|log in/i }).first().click();
    // Back on the viewer origin, with the token in hand.
    await page.waitForURL(url => !url.href.includes("/realms/"), { timeout: 60_000 });
    await xopat.waitForApp();
    await page.waitForFunction(
        () => window.XOpatUser?.instance?.()?.isLogged === true,
        null,
        { timeout: 60_000 },
    );
}

/**
 * Start the interactive login for the core context.
 *
 * The evaluate is deliberately not awaited to completion: a redirect flow
 * navigates away mid-call, which destroys the execution context and rejects it.
 * The navigation IS the success signal.
 */
async function startLogin(xopat) {
    xopat.page.evaluate(() => window.APPLICATION_CONTEXT.auth.login("core")).catch(() => {});
    await xopat.page.waitForURL(/\/realms\//, { timeout: 60_000 });
}

const roles = (xopat) => xopat.page.evaluate(() => window.XOpatUser.instance().currentRoles());
const can = (xopat, capability) =>
    xopat.page.evaluate(id => window.XOpatUser.instance().can(id), capability);

/** Chat providers the client can currently see. */
const chatProviders = (xopat) => xopat.page.evaluate(() => {
    const svc = window.singletonModule?.("vercel-ai-chat-sdk")?.chatService;
    return (svc?.getProviders?.() ?? []).map(p => ({
        id: p.id, label: p.label, requiresLogin: p.requiresLogin, contextId: p.contextId,
    }));
});

test.describe("OIDC group claim drives the same role-based rules @oidc @e2e @security", () => {
    test.beforeEach(async () => { await requireKeycloakOidc(); });

    test("the OIDC broker owns the core context, and SAML is not loaded", async ({ xopat }) => {
        // The premise of everything below. If saml-auth also claimed `core` the
        // rest of the suite could pass for the wrong reason — two brokers racing
        // for one context is exactly the misconfiguration the deployment's
        // `modules` block disables, so assert it rather than assume it.
        await xopat.launch();
        const core = await xopat.page.evaluate(
            () => window.APPLICATION_CONTEXT.auth.listContexts().find(c => c.contextId === "core") ?? null,
        );
        expect(core, "the core context must be declared at boot, before any login").not.toBeNull();
        expect(core.method, "declared by oidc-client-ts, not saml-auth").toBe("oidc");
        expect(core.autoLogin).toBe(false);
        // The choice that makes `rpcVerifiers.core.verifiers.oidc.audience` the
        // client id rather than Keycloak's default `account`.
        expect(core.tokenForServer).toBe("id_token");
    });

    test("a logged-out visitor holds the deployment default role", async ({ xopat }) => {
        await xopat.launch();
        // `autoLogin` is off in this deployment precisely so this state exists.
        expect(await roles(xopat)).toEqual(["guest"]);
        expect(await can(xopat, "questionaire.edit")).toBe(false);
        expect(await can(xopat, "questionaire.answer")).toBe(false);
    });

    test("a pathologist may answer and submit, but not author the form", async ({ xopat }) => {
        await xopat.launch();
        await startLogin(xopat);
        await login(xopat, "pathologist", "pathologist");

        // The `groups` claim arrived in the OIDC token and was mapped by the same
        // `core.roles.claims` block the SAML deployment uses.
        expect(await roles(xopat)).toEqual(["pathologist"]);

        expect(await can(xopat, "questionaire.answer")).toBe(true);
        expect(await can(xopat, "questionaire.bundle-submit")).toBe(true);
        // The point of the role: fills forms, does not change them.
        expect(await can(xopat, "questionaire.edit")).toBe(false);
        expect(await can(xopat, "questionaire.import.schema")).toBe(false);
        // Annotating is theirs.
        expect(await can(xopat, "annotations.crud:annotation.create")).toBe(true);
    });

    test("a researcher authors the form but cannot write annotations", async ({ xopat }) => {
        await xopat.launch();
        await startLogin(xopat);
        await login(xopat, "researcher", "researcher");

        expect(await roles(xopat)).toEqual(["researcher"]);

        expect(await can(xopat, "questionaire.edit")).toBe(true);
        expect(await can(xopat, "questionaire.import.schema")).toBe(true);
        // Read yes, write no.
        expect(await can(xopat, "annotations.crud:annotation.read")).toBe(true);
        expect(await can(xopat, "annotations.crud:annotation.create")).toBe(false);
        expect(await can(xopat, "annotations.crud:annotation.delete")).toBe(false);
        expect(await can(xopat, "annotations.bundle-export")).toBe(false);
    });

    test("a denied capability is enforced by the pipeline, not just hidden", async ({ xopat }) => {
        // Hiding a button is a hint; a role rule has to hold for a caller that
        // never touched the button — which is what a bound sink is. Asserted here
        // as well as in the SAML suite because the pipeline reads the roles, and
        // the roles are what this deployment produces differently.
        await xopat.launch();
        await startLogin(xopat);
        await login(xopat, "researcher", "researcher");

        const verdicts = await xopat.page.evaluate(() => ({
            // Bundle export: no `resourceName`, so only a `resource: "*"` guard
            // can match it.
            exportVerdict: window.IO_PIPELINE.runGuards({
                direction: "pre-export",
                capabilityId: "bundle-export",
                xoType: "module",
                ownerUid: "module.annotations",
                ownerId: "annotations",
                key: "",
                meta: {},
            }),
            // A write this role is denied.
            createVerdict: window.IO_PIPELINE.runGuards({
                direction: "pre-create",
                capabilityId: "crud:annotation",
                resourceName: "annotation",
                xoType: "module",
                ownerUid: "module.annotations",
                ownerId: "annotations",
                key: "",
                meta: {},
            }),
            // A read this role keeps.
            readVerdict: window.IO_PIPELINE.runGuards({
                direction: "pre-read",
                capabilityId: "crud:annotation",
                resourceName: "annotation",
                xoType: "module",
                ownerUid: "module.annotations",
                ownerId: "annotations",
                key: "",
                meta: {},
            }),
        }));

        expect(verdicts.exportVerdict.ok).toBe(false);
        expect(verdicts.exportVerdict.code).toBe("W_PERM_DENIED");
        expect(verdicts.createVerdict.ok).toBe(false);
        expect(verdicts.createVerdict.code).toBe("W_PERM_DENIED");
        // Denying writes must not quietly deny reads too.
        expect(verdicts.readVerdict.ok).toBe(true);
    });

    test("the chat provider's RPCs are refused without an OIDC token", async ({ xopatServer }) => {
        // Server-side, no browser. This is the assertion that exercises the
        // `oidc` RS256/JWKS verifier end to end: `rpcVerifiers.core` demands a
        // token Keycloak signed, and a session cookie plus a CSRF token is not an
        // identity. It also proves the JWKS fetch is reachable — the guard fails
        // CLOSED, so a missing XOPAT_SSRF_ALLOWED_HOSTS entry lands here too.
        const res = await xopatServer.rpc("plugin", "chat-openai", "ensureChatProviderRegistered", {});
        expect(res.status).toBe(401);
        expect(res.body?.code).toBe("RPC_AUTH_FAILED");
    });

    test("the chat provider appears only after logging in, on the viewer's own context", async ({ xopat }) => {
        // The plugin names a context and knows nothing about OIDC; the broker is
        // a `modules` choice. This block is byte-identical to the SAML
        // deployment's, so passing here is the indirection working.
        await xopat.launch();
        expect(await chatProviders(xopat)).toEqual([]);

        await startLogin(xopat);
        await login(xopat, "pathologist", "pathologist");
        await expect.poll(() => chatProviders(xopat), { timeout: 30_000 })
            .not.toEqual([]);

        const providers = await chatProviders(xopat);
        expect(providers).toHaveLength(1);
        expect(providers[0].label).toBe("OpenAI");
        expect(providers[0].requiresLogin).toBe(true);
        // Not a sub-identity: the same context that carried the `groups` claim.
        expect(providers[0].contextId).toBe("core");
    });

    test("logging out reverts to the deployment default", async ({ xopat }) => {
        await xopat.launch();
        await startLogin(xopat);
        await login(xopat, "pathologist", "pathologist");
        expect(await roles(xopat)).toEqual(["pathologist"]);

        await xopat.page.evaluate(() => window.XOpatUser.instance().logout("core"));
        await xopat.page.waitForFunction(
            () => window.XOpatUser.instance().currentRoles().join() === "guest",
            null,
            { timeout: 15_000 },
        );
        // A revoked role must not leave its capabilities behind.
        expect(await can(xopat, "questionaire.answer")).toBe(false);
    });

    test("the silent-renew frame does not boot a second viewer", async ({ xopat }) => {
        // `useCallbackPage` is on in this deployment, and the failure it prevents
        // is invisible by design: without it `silent_redirect_uri` falls back to
        // the page URL, so the library's prompt=none iframe loads the WHOLE
        // application — plugins, config, tile sources — inside a 10s watchdog it
        // then trips, and reports "your session expired" over a perfectly valid
        // token. The observable signature is a frame on the viewer origin that is
        // not the callback document.
        await xopat.launch();
        await startLogin(xopat);
        await login(xopat, "pathologist", "pathologist");

        const bootedFrames = xopat.page.frames()
            .filter(f => f !== xopat.page.mainFrame())
            .map(f => f.url())
            .filter(u => u.startsWith("http") && !u.includes("auth-callback.html"));
        expect(bootedFrames, "an OIDC frame must land on the bare callback page").toEqual([]);
    });
});
