/**
 * The un-docked ("overlay") global menu.
 *
 * At rest it is an edge rail. What these pin is the part users tripped over:
 * the rail owns its own pixels instead of lying over the viewer (where it
 * collided with the outermost viewer's side menu), a pointer on the rail opens
 * nothing until it clicks, and a panel opened on purpose does not close
 * because the pointer happens to be elsewhere.
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
        ui: { globalMenuMode: "overlay" },
    },
});

const DOCK = "#viewer-container-dock";
const RAIL = "#viewer-container-knob";

async function launch(xopat) {
    await xopat.launch(session());
    await xopat.waitForViewer();
    const page = xopat.page;
    // An explicit toggle is what legitimately opens a dock with no panels in
    // it; closing it again leaves the rail as the resting state.
    await page.evaluate(() => window.LAYOUT.toggleGlobalMenu());
    await expect(page.locator(DOCK)).toBeVisible();
    await page.evaluate(() => window.LAYOUT.toggleGlobalMenu());
    await expect(page.locator(DOCK)).toBeHidden();
    await expect(page.locator(RAIL)).toBeVisible();
    return page;
}

const center = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

test("the rail is a gutter beside the viewer, not a strip over it",
    { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
        const page = await launch(xopat);
        const rail = await page.locator(RAIL).boundingBox();
        const osd = await page.locator("#osd").boundingBox();
        expect(rail.width).toBeGreaterThanOrEqual(12);
        expect(osd.x + osd.width).toBeLessThanOrEqual(rail.x + 0.5);
    });

test("hovering the rail opens nothing; clicking it opens the menu",
    { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
        const page = await launch(xopat);
        const rail = center(await page.locator(RAIL).boundingBox());
        const viewer = center(await page.locator("#osd").boundingBox());

        // The rail neighbours the side menu: a pointer resting on it on the
        // way there must not pop the global menu over that menu.
        await page.mouse.move(viewer.x, viewer.y);
        await page.mouse.move(rail.x, rail.y);
        await page.waitForTimeout(800);
        await expect(page.locator(DOCK)).toBeHidden();

        await page.mouse.click(rail.x, rail.y);
        await expect(page.locator(DOCK)).toBeVisible();

    });

test("leaving the panel closes it after a grace that coming back cancels",
    { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
        const page = await launch(xopat);
        const rail = center(await page.locator(RAIL).boundingBox());
        const viewer = center(await page.locator("#osd").boundingBox());

        await page.mouse.click(rail.x, rail.y);
        await expect(page.locator(DOCK)).toBeVisible();
        const dock = center(await page.locator(DOCK).boundingBox());

        // An accidental slip onto the slide and straight back: still open.
        await page.mouse.move(dock.x, dock.y);
        await page.mouse.move(viewer.x - 200, viewer.y);
        await page.waitForTimeout(300);
        await page.mouse.move(dock.x, dock.y);
        await page.waitForTimeout(1200);
        await expect(page.locator(DOCK)).toBeVisible();

        // Leaving for good closes it.
        await page.mouse.move(viewer.x - 200, viewer.y);
        await expect(page.locator(DOCK)).toBeHidden();
    });

test("a menu opened without the pointer stays until Escape or a click on the viewer",
    { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
        const page = await launch(xopat);
        const viewer = center(await page.locator("#osd").boundingBox());

        // Opened from the keyboard with the pointer already on the slide:
        // moving around the slide is not "leaving the panel".
        await page.mouse.move(viewer.x - 250, viewer.y);
        await page.evaluate(() => window.LAYOUT.toggleGlobalMenu());
        await expect(page.locator(DOCK)).toBeVisible();
        await page.mouse.move(viewer.x - 200, viewer.y);
        await page.waitForTimeout(1200);
        await expect(page.locator(DOCK)).toBeVisible();

        await page.keyboard.press("Escape");
        await expect(page.locator(DOCK)).toBeHidden();

        await page.evaluate(() => window.LAYOUT.toggleGlobalMenu());
        await expect(page.locator(DOCK)).toBeVisible();
        await page.mouse.click(viewer.x - 200, viewer.y);
        await expect(page.locator(DOCK)).toBeHidden();
    });
