/**
 * The four ways a session reaches the viewer.
 *
 * `src/parse-input.js` resolves them in priority order — POST body, hash,
 * `?visualization=`, `?slides=` — and each is a real deployment path: hash for
 * shareable links, query for hand-written URLs, POST for embedding
 * applications, `slides` for the cheapest possible smoke URL. A harness that
 * only ever exercised one of them would let the others rot, which is roughly
 * what happened before.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();

const session = () => ({
    data: [slide.dataId],
    background: [{ dataReference: 0, name: "Synthetic" }],
    params: { bypassCookies: true, bypassCache: true, disablePluginsAutoload: true },
});

const openedDimensions = (xopat) => xopat.page.evaluate(() => {
    const item = window.VIEWER.world.getItemAt(0);
    return { width: item?.source?.width, height: item?.source?.height };
});

for (const transport of ["hash", "query", "post"]) {
    test(`opens a session via ${transport}`, { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
        await xopat.launch(session(), { transport });
        await xopat.waitForViewer();
        expect(await openedDimensions(xopat)).toEqual({ width: slide.width, height: slide.height });
    });
}

test("opens a slide list via ?slides=", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    // The synthesized form: no visualization object at all, just ids.
    await xopat.launch(null, { transport: "slides", slides: [slide.dataId] });
    await xopat.waitForViewer();
    expect(await openedDimensions(xopat)).toEqual({ width: slide.width, height: slide.height });
});
