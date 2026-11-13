/**
 * Quick adjustments on the navigator are a pop-over, not a row.
 *
 * As an inline row they resized the navigator and pushed every side-menu panel
 * below it. What is pinned: opening them leaves the navigator's box alone, the
 * sliders still drive the viewer's background layers, and navigating the slide
 * — which is how a user judges the change — does not dismiss them.
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

const backgroundValues = () => {
    const adjustments = window.APPLICATION_CONTEXT.adjustments;
    const first = adjustments.backgroundLayerIds(window.VIEWER)[0];
    return JSON.stringify(adjustments.get(window.VIEWER, first));
};

test("navigator quick adjust opens as a pop-over and leaves the navigator size alone",
    { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
        await xopat.launch(session());
        await xopat.waitForViewer();
        const page = xopat.page;

        const navigator = page.locator(".navigator-panel").first();
        const button = page.locator("[id$='-quick-adjust']").first();
        const popover = page.locator("[id$='-quick-adjust-popover']");
        const before = await navigator.boundingBox();

        await navigator.hover();
        await button.click();
        await expect(popover).toBeVisible();
        expect(await popover.evaluate(el => el.parentElement === document.body)).toBe(true);
        expect(await navigator.boundingBox()).toEqual(before);
        // It hangs directly under the button that opened it.
        const box = await popover.boundingBox();
        const buttonBox = await button.boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height);
        expect(box.y).toBeLessThan(buttonBox.y + buttonBox.height + 16);

        // A slider still writes to the viewer's background layers.
        const slider = popover.locator("input[type='range']").first();
        await expect(slider).toBeVisible();
        const valuesBefore = await page.evaluate(backgroundValues);
        await slider.evaluate((el) => {
            const min = Number(el.min), max = Number(el.max);
            el.value = String(Number(el.value) === max ? min : max);
            el.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await expect.poll(() => page.evaluate(backgroundValues)).not.toBe(valuesBefore);
        await expect(popover).toBeVisible();

        // Navigating the slide keeps it; Escape and the button close it.
        const osd = await page.locator("#osd").boundingBox();
        await page.mouse.click(osd.x + osd.width / 3, osd.y + osd.height / 2);
        await expect(popover).toBeVisible();

        await page.keyboard.press("Escape");
        await expect(popover).toBeHidden();

        await navigator.hover();
        await button.click();
        await expect(popover).toBeVisible();
        await button.click();
        await expect(popover).toBeHidden();
    });
