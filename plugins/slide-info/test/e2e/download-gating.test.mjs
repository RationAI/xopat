/**
 * The "Download slide" action is behind two independent gates, and both of them
 * fail *open* if wired wrong — which is exactly the direction that matters here.
 *
 * - The tile-source capability. Most protocols cannot hand back the original
 *   file at all; the default `canDownloadSlideFile()` says so. If the UI stopped
 *   consulting it, every slide would grow a button that 404s.
 * - The user capability. `XOpatUser.can()` answers `true` for ids nobody
 *   declared (`user-roles-core.ts`), so a missing/renamed declaration silently
 *   un-gates the action rather than hiding it. Pinning the declaration is what
 *   keeps a `deny` in `core.roles` meaningful.
 */
import { test, expect } from "@xopat/test-harness";

const PLUGIN_ID = "slide-info";

async function ready(xopat) {
    await xopat.launch({ params: { bypassCookies: true, bypassCache: true } });
    await xopat.page.waitForFunction(
        (id) => { try { return Boolean(window.plugin(id)); } catch { return false; } },
        PLUGIN_ID,
        { timeout: 30_000 },
    );
}

test("the capability is declared, so denying it actually denies", { tag: ["@e2e"] }, async ({ xopat }) => {
    await ready(xopat);

    const declared = await xopat.page.evaluate(() =>
        (window.XOpatUser.listCapabilities() || []).some(c => c?.id === "slide-info.download-slide"));

    expect(declared,
        "an undeclared capability id answers `true` for everyone — the deny switch would be dead"
    ).toBe(true);
});

test("a source without the capability is offered no download", { tag: ["@e2e"] }, async ({ xopat }) => {
    await ready(xopat);

    const verdicts = await xopat.page.evaluate(() => {
        const p = window.plugin("slide-info");
        return {
            // Default prototype behaviour: the base TileSource opts out.
            base: p._canDownloadSlide(new OpenSeadragon.TileSource({ width: 1, height: 1 })),
            nothing: p._canDownloadSlide(undefined),
            // A source that claims the capability and holds the user grant.
            supporting: p._canDownloadSlide({ canDownloadSlideFile: () => true }),
            // A throwing implementation must not take the menu down with it.
            throwing: p._canDownloadSlide({ canDownloadSlideFile() { throw new Error("boom"); } }),
            item: !!p._downloadMenuItem({ canDownloadSlideFile: () => true }, null, "Slide"),
            noItem: p._downloadMenuItem({ canDownloadSlideFile: () => false }, null, "Slide"),
        };
    });

    expect(verdicts.base).toBe(false);
    expect(verdicts.nothing).toBe(false);
    expect(verdicts.throwing).toBe(false);
    expect(verdicts.supporting).toBe(true);
    expect(verdicts.item, "a supporting source yields a menu entry").toBe(true);
    expect(verdicts.noItem, "a non-supporting source yields none").toBe(null);
});

/**
 * A cross-origin `<a download>` is ignored by the browser and degrades into a
 * real top-level navigation, which fires `beforeunload` and raises xOpat's
 * unsaved-state "Leave site?" prompt for an action that never meant to leave.
 * The driver therefore routes cross-origin downloads through a hidden iframe.
 */
test("a cross-origin download never navigates the viewer", { tag: ["@e2e"] }, async ({ xopat }) => {
    await ready(xopat);

    const result = await xopat.page.evaluate(async () => {
        const before = window.location.href;
        // Dirty state is what arms the unload guard — without it the bug is invisible.
        window.APPLICATION_CONTEXT.setDirty();

        const source = {
            canDownloadSlideFile: () => true,
            getSlideFileDownload: async () => ({ url: "https://images.invalid:8080/v3/slides/download?slide_id=x" }),
        };
        await window.UTILITIES.downloadSlideFile(source, {});

        return {
            framed: !!document.querySelector("iframe[data-xopat-download]"),
            anchored: !!document.querySelector("a[download][href^='https://images.invalid']"),
            navigated: window.location.href !== before,
        };
    });

    expect(result.framed, "cross-origin goes through an iframe").toBe(true);
    expect(result.anchored, "no anchor is left behind to navigate").toBe(false);
    expect(result.navigated).toBe(false);
});

test("a same-origin download uses the anchor, not an iframe", { tag: ["@e2e"] }, async ({ xopat }) => {
    await ready(xopat);

    // `<a download>` is honoured same-origin: it forces the name and never
    // navigates, so the iframe indirection would only cost feedback.
    const framed = await xopat.page.evaluate(async () => {
        const source = {
            canDownloadSlideFile: () => true,
            getSlideFileDownload: async () => ({
                url: new URL("/does-not-exist.svs", window.location.href).href,
                fileName: "slide.svs",
            }),
        };
        await window.UTILITIES.downloadSlideFile(source, {});
        return !!document.querySelector("iframe[data-xopat-download]");
    });

    expect(framed).toBe(false);
});

test("the core driver refuses a source that cannot download", { tag: ["@e2e"] }, async ({ xopat }) => {
    await ready(xopat);

    // Resolves (with a user-facing notice) rather than throwing — a menu action
    // must never leave an unhandled rejection behind.
    const outcome = await xopat.page.evaluate(async () => {
        try {
            await window.UTILITIES.downloadSlideFile({}, {});
            return "resolved";
        } catch (e) {
            return `threw: ${e?.message}`;
        }
    });

    expect(outcome).toBe("resolved");
});
