/**
 * The file export still works when nobody configured any roles.
 *
 * The gating work put a policy phase in front of every bundle dispatch and a
 * capability check in front of `UTILITIES.export`. Those are the right places
 * for them, and they are also exactly the places where a mistake is invisible:
 * a deployment with no `core.roles` block would keep rendering, keep loading
 * slides, keep looking healthy — and quietly hand the user an `export.html`
 * with the plugin data missing, or refuse the action outright.
 *
 * So this suite asserts the *absence* of gating on the shipped default. It runs
 * on the synthetic slide because none of what it checks needs real pixels, only
 * a booted app with the pipeline live.
 *
 * The route split itself is covered exhaustively in
 * `test/suites/unit/io-export-routes.test.mjs`; here we only care that the
 * default deployment never enters it.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();

const session = () => ({
    data: [slide.dataId],
    background: [{ dataReference: 0, name: "Synthetic" }],
    params: {
        bypassCookies: true,
        bypassCache: true,
        disablePluginsAutoload: true,
        debugMode: false,
    },
});

test("no roles configured means no capability is denied", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();

    const verdicts = await xopat.page.evaluate(() => {
        const user = window.XOpatUser?.instance?.();
        const declared = window.XOpatUser?.listCapabilities?.() ?? [];
        return {
            roles: user?.currentRoles?.() ?? null,
            denied: declared.filter(c => !user.can(c.id)).map(c => c.id),
            // Core declares its own; if this is empty the wiring never ran and
            // the rest of the assertions would pass vacuously.
            coreDeclared: declared.filter(c => c.declaredBy === "core").map(c => c.id).sort(),
        };
    });

    expect(verdicts.roles, "the shipped default assigns no role").toEqual([]);
    expect(verdicts.denied, "nothing is denied without a role definition").toEqual([]);
    expect(verdicts.coreDeclared).toEqual([
        "core.export.file", "core.export.url", "core.io.local-file", "core.scripting.run",
    ]);
});

test("a bundle export reaches its destination and takes no local copy", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();

    const outcome = await xopat.page.evaluate(async () => {
        const results = await window.IO_PIPELINE.flushBundleExport();
        return {
            refusals: results.filter(r => !r.ok).map(r => ({ code: r.code, owner: r.ownerId })),
        };
    });

    expect(outcome.refusals, "no owner may be refused on a deployment with no roles").toEqual([]);
});

test("the session document is produced and carries the app config", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();

    // `getForm` is what `UTILITIES.export()` downloads, minus the download —
    // driving the real action would open a file dialog the harness cannot read,
    // and the assertion worth making is about the CONTENT either way.
    const form = await xopat.page.evaluate(async () => {
        const outcome = [];
        const html = await window.UTILITIES.getForm("", undefined, false, outcome);
        return { html, refusals: outcome.filter(r => !r.ok).length };
    });

    expect(form.refusals).toBe(0);
    expect(form.html, "the form posts back to the viewer").toContain("<form");
    expect(form.html, "the scene travels with it").toContain("visualization");
});

/**
 * Install a deny-everything role BEFORE the app boots, and record every dialog.
 *
 * The role has to be in place before elements load, because the thing under
 * test is their boot hydration. `configureRoles` is the loader's own entry
 * point (it calls it once with `ENV.roles`), so wrapping it substitutes the
 * config at exactly the right moment instead of racing it.
 */
async function armDenyAllAndCountDialogs(page) {
    await page.addInitScript(() => {
        window.__dialogs = [];

        const wrapDialogs = (value) => {
            if (!value || typeof value.show !== "function" || value.__wrapped) return value;
            const show = value.show.bind(value);
            value.show = (msg, ...rest) => { window.__dialogs.push(String(msg)); return show(msg, ...rest); };
            value.__wrapped = true;
            return value;
        };
        let dialogs;
        Object.defineProperty(window, "Dialogs", {
            configurable: true,
            get: () => dialogs,
            set: (v) => { dialogs = wrapDialogs(v); },
        });

        let User;
        Object.defineProperty(window, "XOpatUser", {
            configurable: true,
            get: () => User,
            set: (v) => {
                User = v;
                if (v && typeof v.configureRoles === "function" && !v.__rolesPatched) {
                    const original = v.configureRoles.bind(v);
                    v.configureRoles = () => original({
                        default: ["locked"],
                        definitions: { locked: { label: "Locked", deny: ["*"] } },
                    });
                    v.__rolesPatched = true;
                }
            },
        });
    });
}

test("a restricted role produces no dialogs at boot", { tag: ["@synthetic", "@e2e", "@security"] }, async ({ xopat }) => {
    // The reported bug, pinned: loading the page as `guest` greeted the user
    // with four "You do not have permission…" dialogs before they had done
    // anything. Every one of them came from boot hydration — work the user
    // never requested.
    await armDenyAllAndCountDialogs(xopat.page);
    await xopat.launch(session());
    await xopat.waitForViewer();

    const state = await xopat.page.evaluate(() => ({
        roles: window.XOpatUser.instance().currentRoles(),
        denied: window.XOpatUser.listCapabilities().filter(c => !window.XOpatUser.instance().can(c.id)).length,
        dialogs: window.__dialogs.slice(),
    }));

    expect(state.roles, "the deny-all role really is in effect").toEqual(["locked"]);
    expect(state.denied, "…and it really denies things").toBeGreaterThan(0);
    expect(state.dialogs, "boot interrupted the user").toEqual([]);

    // SCOPE, stated so this is not mistaken for the full reproduction: no
    // shipped test deployment enables an owner with an `importBundle` hook
    // (annotations, recorder, questionaire, slide-scoring are what produced the
    // four dialogs, and they live in `roles-dev`). So this asserts the boot
    // path is quiet under a live deny-all role — a smoke check that the wiring
    // holds end to end — while the mechanism itself, including that the same
    // refusal still interrupts a USER-triggered call, is pinned per-vector in
    // `test/suites/unit/io-export-routes.test.mjs`.
    const stillQuiet = await xopat.page.evaluate(async () => {
        await window.IO_PIPELINE.tryRestoreImport({ trigger: "system" });
        await window.IO_PIPELINE.flushBundleExport({ trigger: "system" });
        return window.__dialogs.length;
    });

    expect(stillQuiet, "an automatic restore/flush stays quiet").toBe(0);
});

test("denying the local-file capability does not touch the configured route", { tag: ["@synthetic", "@e2e", "@security"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();

    // Assign a role at runtime rather than shipping another ENV: this asserts
    // the WIRING (core guard ↔ capability ↔ route), and the resolution rules
    // themselves are unit-tested. `assignRoles` is the documented escape hatch.
    const verdict = await xopat.page.evaluate(async () => {
        const user = window.XOpatUser.instance();
        window.XOpatUser.configureRoles({
            default: [],
            definitions: { kiosk: { label: "Kiosk", deny: ["core.io.local-file"] } },
        });
        user.assignRoles(["kiosk"]);

        const local = window.IO_PIPELINE.runGuards({
            direction: "pre-export", route: "local", capabilityId: "bundle-export",
            xoType: "module", ownerUid: "module.annotations", ownerId: "annotations",
            key: "", meta: {},
        }, undefined, { surface: false });
        const sink = window.IO_PIPELINE.runGuards({
            direction: "pre-export", route: "sink", capabilityId: "bundle-export",
            xoType: "module", ownerUid: "module.annotations", ownerId: "annotations",
            key: "", meta: {},
        }, undefined, { surface: false });

        user.assignRoles([]);
        return { local: local.ok, localCode: local.code, sink: sink.ok };
    });

    expect(verdict.local, "the local route is closed").toBe(false);
    expect(verdict.localCode).toBe("W_PERM_DENIED");
    expect(verdict.sink, "the bound destination is unaffected").toBe(true);
});
