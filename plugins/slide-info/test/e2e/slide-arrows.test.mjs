/**
 * Prev/next arrows in the scalebar magnification strip.
 *
 * The strip is rebuilt per viewer, and each arrow must switch the viewport it
 * sits in — never the focused one. Backgrounds share the synthetic slide but
 * carry distinct ids, which is what "already open" detection keys on.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();

const session = (background, activeBackgroundIndex) => ({
    data: [slide.dataId],
    background,
    params: {
        bypassCookies: true,
        bypassCache: true,
        activeBackgroundIndex,
    },
});

const bg = (id) => ({ dataReference: 0, id, name: id });

const arrowsOf = (page, slot) => page.evaluate((slot) => {
    const viewer = window.VIEWER_MANAGER.viewers[slot];
    return [...viewer.container.querySelectorAll("[data-viewer-control^='slide-info.']")]
        .filter(b => b.offsetParent !== null)
        .map(b => b.dataset.viewerControl);
}, slot);

test("each viewport strip carries arrows that switch only that viewport", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session([bg("s-a"), bg("s-b"), bg("s-c")], [0, 1]));
    await xopat.page.waitForFunction(() => window.VIEWER_MANAGER?.viewers?.length === 2
        && window.VIEWER_MANAGER.viewers.every(v => v.scalebar?._ui?.unmountControls), null, { timeout: 30_000 });
    await xopat.page.waitForFunction(() => {
        try { return Boolean(window.plugin("slide-info")); } catch { return false; }
    }, null, { timeout: 30_000 });

    for (const slot of [0, 1]) {
        await expect.poll(() => arrowsOf(xopat.page, slot), { timeout: 15_000 })
            .toEqual(["slide-info.prevSlide", "slide-info.nextSlide"]);
    }

    // Discoverable through the UI catalog as a viewer-scoped action.
    const node = await xopat.page.evaluate(() => {
        const viewer = window.VIEWER_MANAGER.viewers[1];
        const n = window.USER_INTERFACE.AppBar.Catalog.get("viewer-control:slide-info.nextSlide", { viewer });
        return n && { kind: n.kind, viewerScoped: n.viewerScoped, hidden: !!n.state?.hidden };
    });
    expect(node).toEqual({ kind: "action", viewerScoped: true, hidden: false });

    await xopat.page.evaluate(() => {
        window.VIEWER_MANAGER.viewers[1].container
            .querySelector("[data-viewer-control='slide-info.nextSlide']").click();
    });

    await expect.poll(() => xopat.page.evaluate(() =>
        window.APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, true, true)
    ), { timeout: 30_000 }).toEqual([0, 2]);
});

test("a single-slide session shows no arrows", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session([bg("s-only")], [0]));
    await xopat.waitForViewer();
    await xopat.page.waitForFunction(() => {
        try { return Boolean(window.plugin("slide-info")) && window.VIEWER?.scalebar?._ui?.unmountControls; }
        catch { return false; }
    }, null, { timeout: 30_000 });

    expect(await arrowsOf(xopat.page, 0)).toEqual([]);
});
