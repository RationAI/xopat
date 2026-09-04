/**
 * Two real users, two sets of rights, one deployment config.
 *
 * Everything the roles layer needed already existed — a capability registry,
 * roles with grant/deny globs, IO guards — except the two ends: nothing ever
 * called `assignRoles`, and bundle/read traffic had no phase to veto in. So
 * `core.roles` was configurable and inert, and `env/env.saml.json` mapped a
 * `groups` claim that no code read.
 *
 * This suite walks the whole chain against a live identity provider, because
 * every link in it can be unit-tested green while the chain is broken:
 *
 *   Keycloak group → SAML attribute → minted token claim → core.roles.claims
 *   → assignRoles → capability resolution → what the UI offers and what the
 *   pipeline lets through.
 *
 * Deployment under test: `test/env/saml.json`. IdP: `test/fixtures/keycloak/`.
 * Without the container the suite skips with instructions rather than timing out.
 */
import { test, expect, requireKeycloak } from "@xopat/test-harness";

/** Sign in through the Keycloak login form and wait for the viewer to settle. */
async function login(xopat, username, password) {
    const page = xopat.page;
    await page.getByLabel(/username|email/i).first().fill(username);
    await page.getByLabel(/password/i).first().fill(password);
    await page.getByRole("button", { name: /sign in|log in/i }).first().click();
    // Back on the viewer origin, with the minted token in hand.
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

test.describe("SAML group claim drives role-based rules @saml @e2e @security", () => {
    test.beforeEach(async () => { await requireKeycloak(); });

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

        // The claim actually arrived and was mapped.
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
        // Read yes, write no — the case the pipeline had no phase for.
        expect(await can(xopat, "annotations.crud:annotation.read")).toBe(true);
        expect(await can(xopat, "annotations.crud:annotation.create")).toBe(false);
        expect(await can(xopat, "annotations.crud:annotation.delete")).toBe(false);
        expect(await can(xopat, "annotations.bundle-export")).toBe(false);
    });

    test("a denied capability is enforced by the pipeline, not just hidden", async ({ xopat }) => {
        // The distinction the whole change turns on. Hiding a button is a hint;
        // a role rule has to hold for a caller that never touched the button —
        // which is what a bound sink is.
        await xopat.launch();
        await startLogin(xopat);
        await login(xopat, "researcher", "researcher");

        const verdicts = await xopat.page.evaluate(() => ({
            // Bundle export: no `resourceName`, so only a `resource: "*"` guard
            // can match it — the shape `registerOwnerRights` now mounts.
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
        // The read/write split is the whole point — denying writes must not
        // quietly deny reads too.
        expect(verdicts.readVerdict.ok).toBe(true);
    });

    test("Submit hands the filled form over — as a file when nothing is bound", async ({ xopat }) => {
        // The headline bug: with no sink bound, `submit()` flushed a capability
        // that resolved to `[]`, saw zero failures, and returned. No file, no
        // toast, no error — the button did nothing and said nothing. Export had
        // handled that case for its own payload all along.
        await xopat.launch();
        await startLogin(xopat);
        await login(xopat, "pathologist", "pathologist");

        // Settle first: registering the chat provider mounts its panel and
        // reflows the layout, and a click issued during that window lands on a
        // moving button.
        await expect.poll(() => chatProviders(xopat), { timeout: 30_000 }).not.toEqual([]);

        const page = xopat.page;
        // Both clicks are dispatched IN-PAGE rather than through Playwright's
        // pointer pipeline. This deployment also runs a chat provider with no
        // API key, and on login the chat opens its settings modal — a
        // full-viewport `.modal-open` that legitimately intercepts pointer
        // events for everything behind it. The subject here is the submit
        // pipeline, not pointer routing between plugins, and `.click()` still
        // runs the real handler.
        await page.evaluate(() => document.getElementById("viewer-container-menu-b-questionaire")?.click());
        const runtime = page.locator("#questionnaire-runtime");
        await expect(runtime).toBeVisible();

        // The default form is one required text field.
        await runtime.locator("input[type=text]").first().fill("Case 42");

        const [download] = await Promise.all([
            page.waitForEvent("download", { timeout: 30_000 }),
            page.evaluate(() => {
                const root = document.getElementById("questionnaire-runtime");
                const button = [...root.querySelectorAll("button")]
                    .find(b => /^submit$/i.test((b.textContent || "").trim()));
                if (!button) throw new Error("no Submit button in the questionnaire runtime");
                button.click();
            }),
        ]);

        const body = JSON.parse(
            await (await import("node:fs/promises")).readFile(await download.path(), "utf8"),
        );
        expect(body.answers.name).toBe("Case 42");
        expect(body.schema.title).toBeTruthy();
        // A submission is the filled form, not a copy of the form definition.
        expect(body.schema.pages).toBeUndefined();
        expect(typeof body.submittedAt).toBe("string");
    });

    test("the chat provider's RPCs are refused without a SAML token", async ({ xopatServer }) => {
        // Server-side, no browser: the gate has to hold for a caller that never
        // loaded the page. A session cookie and a CSRF token are NOT an identity
        // — `rpcVerifiers.core` demands the token saml-auth mints.
        const res = await xopatServer.rpc("plugin", "chat-openai", "ensureChatProviderRegistered", {});
        expect(res.status).toBe(401);
        expect(res.body?.code).toBe("RPC_AUTH_FAILED");
    });

    test("the chat provider appears only after logging in, on the viewer's own context", async ({ xopat }) => {
        // The plugin names a context and knows nothing about SAML; the broker is
        // a `modules` choice. This asserts the indirection end to end — and that
        // reusing `core` means ONE login covers the viewer, its roles and the chat.
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

    test("a read-only role hits no crash and no refusal storm", async ({ xopat }) => {
        // Both halves of what a denied role hit in practice:
        //
        //  - clicking the canvas threw `Cannot read properties of undefined
        //    (reading 'presetID')` on EVERY press, because the preset auto-create
        //    was refused and `ensureActivePreset` dereferenced the undefined it
        //    got back;
        //  - one Export click raised a stack of "you cannot do this action"
        //    dialogs, because the bundle gate was registered under `resource: "*"`
        //    with a handler that ignored the context, so annotations' denial
        //    refused every other owner's export too.
        const page = xopat.page;
        const pageErrors = [];
        page.on("pageerror", e => pageErrors.push(String(e)));

        await xopat.launch();
        await startLogin(xopat);
        await login(xopat, "researcher", "researcher");   // annotations read-only
        expect(await can(xopat, "annotations.crud:annotation.create")).toBe(false);

        // Drive the exact function the canvas press lands in. This deployment
        // serves no slides, so there is no canvas to click — but the crash was
        // never about the canvas: `handleLeftClickDown` calls this, and it threw
        // before returning. Assert it now answers "no preset" instead.
        const verdict = await page.evaluate(() => {
            const presets = window.OSDAnnotations?.instance?.()?.presets;
            if (!presets) return { skipped: true };
            try {
                const preset = presets.ensureActivePreset(true);
                return { threw: false, preset: preset ? "preset" : "undefined" };
            } catch (e) {
                return { threw: true, message: String(e) };
            }
        });
        expect(verdict.skipped, "annotations module is not loaded in this deployment").toBeFalsy();
        expect(verdict.threw).toBe(false);
        expect(pageErrors.join("\n")).not.toContain("presetID");

        // Export must still produce a file, and must not raise a refusal per owner.
        const [download] = await Promise.all([
            page.waitForEvent("download", { timeout: 60_000 }),
            page.evaluate(() => window.UTILITIES.export()),
        ]);
        expect(await download.path()).toBeTruthy();
        expect(pageErrors.join("\n")).toBe("");

        // The refusals the pipeline reports are now one per (owner, capability),
        // carry the owner, and name only the owner that was actually denied.
        const refusals = await page.evaluate(async () => {
            const out = await window.IO_PIPELINE.flushBundleExport();
            return out.filter(r => !r.ok && r.code === "W_PERM_DENIED")
                      .map(r => ({ ownerId: r.ownerId, capabilityId: r.capabilityId }));
        });
        expect(refusals.every(r => r.ownerId === "annotations")).toBe(true);
        expect(new Set(refusals.map(r => `${r.ownerId}::${r.capabilityId}`)).size).toBe(refusals.length);
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
});
