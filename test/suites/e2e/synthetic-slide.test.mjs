/**
 * Opening a slide, on a clean checkout, with nothing installed.
 *
 * This is the test that decides whether the browser suite is runnable at all:
 * everything it needs is generated on the spot and served by the viewer's own
 * static handler. If it is green, a contributor with a fresh clone can write
 * rendering tests; if it is red, the suite is back to needing a WSI service.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();

const session = () => ({
    data: [slide.dataId],
    background: [{ dataReference: 0, name: "Synthetic" }],
    params: {
        // Match the pre-runner fixtures: no state may leak between tests.
        bypassCookies: true,
        bypassCache: true,
        disablePluginsAutoload: true,
        debugMode: false,
    },
});

test("serves the generated pyramid as static files", { tag: ["@synthetic", "@e2e"] }, async ({ xopatServer }) => {
    const descriptor = await fetch(`${xopatServer.baseURL}/test/fixtures/slides/generated/${slide.dataId}`);
    expect(descriptor.status, "the fixture directory is an opted-in static root").toBe(200);
    expect(await descriptor.text()).toContain("deepzoom/2008");

    const tile = await fetch(`${xopatServer.baseURL}/test/fixtures/slides/generated/synthetic_files/${slide.maxLevel}/0_0.png`);
    expect(tile.status).toBe(200);
    expect(Number(tile.headers.get("content-length"))).toBeGreaterThan(0);
});

test("opens the slide in the viewer", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();

    const state = await xopat.page.evaluate(() => {
        const item = window.VIEWER.world.getItemAt(0);
        return {
            items: window.VIEWER.world.getItemCount(),
            width: item?.source?.width,
            height: item?.source?.height,
            tileSize: item?.source?.getTileWidth?.(),
        };
    });

    expect(state.items).toBe(1);
    expect(state.width, "the descriptor's dimensions reached the tile source").toBe(slide.width);
    expect(state.height).toBe(slide.height);
    expect(state.tileSize).toBe(slide.tileSize);

    await expect(xopat.canvas()).toBeVisible();
});

test("renders tiles rather than an empty canvas", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();

    // A viewer that "opened" but drew nothing is the failure this catches: the
    // world reports an item while every tile request 404s.
    await xopat.page.waitForFunction(() => {
        const item = window.VIEWER.world.getItemAt(0);
        return Boolean(item) && item.getFullyLoaded?.() !== false;
    }, null, { timeout: 30_000 }).catch(() => { /* fall through to the pixel check */ });

    const canvas = xopat.canvas();
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(0);

    const hasInk = await xopat.page.evaluate(() => {
        const el = document.querySelector(".openseadragon-canvas > canvas");
        const probe = document.createElement("canvas");
        probe.width = 64; probe.height = 64;
        const ctx = probe.getContext("2d");
        ctx.drawImage(el, 0, 0, 64, 64);
        const { data } = ctx.getImageData(0, 0, 64, 64);
        let distinct = new Set();
        for (let i = 0; i < data.length; i += 4) distinct.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        return distinct.size;
    });
    expect(hasInk, "the canvas shows more than one flat colour").toBeGreaterThan(1);
});
