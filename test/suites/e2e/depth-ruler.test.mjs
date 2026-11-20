/**
 * The focal-plane depth ruler on the bottom edge of a viewport.
 *
 * The synthetic slide has a single plane, so the depth controller is stubbed
 * on the page: what is pinned here is the ruler's own contract — it exists
 * only for multi-plane slides, it takes its strip instead of covering the
 * scalebar, and track input / controller events round-trip.
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

/** Page-side: pretend the open slide has `count` planes. */
function stubStack(count) {
    const viewer = window.VIEWER;
    const state = { count, index: 0, spacingUm: 0.5 };
    window.__depthCalls = [];
    viewer.__depthController.getRange = () => ({ ...state });
    viewer.__depthController.setDepth = (index) => {
        window.__depthCalls.push(index);
        state.index = index;
        viewer.raiseEvent("z-depth-changed", { index, count: state.count, viewer });
    };
    viewer.__depthRuler.refresh();
    return viewer.id;
}

test("depth ruler: absent on a single-plane slide", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();
    await expect(xopat.page.locator("[id$='-depth-ruler']")).toBeHidden();
});

test("depth ruler: takes its own strip and drives the depth controller",
    { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
        await xopat.launch(session());
        await xopat.waitForViewer();
        const page = xopat.page;

        const viewerId = await page.evaluate(stubStack, 11);
        const ruler = page.locator("[id$='-depth-ruler']");
        await expect(ruler).toBeVisible();
        await expect(ruler).toContainText("1 / 11");

        // The scalebar dock sits above the ruler, not under it.
        const rulerBox = await ruler.boundingBox();
        await expect.poll(async () => {
            const dock = await page.locator(`#${viewerId}-scale-bar-dock`).boundingBox();
            return dock.y + dock.height <= rulerBox.y + 0.5;
        }).toBe(true);

        // Clicking the far end of the track selects the last plane…
        const track = await ruler.locator("[role='slider']").boundingBox();
        await page.mouse.click(track.x + track.width - 2, track.y + track.height / 2);
        expect(await page.evaluate(() => window.__depthCalls.at(-1))).toBe(10);
        await expect(ruler).toContainText("11 / 11");
        await expect(ruler).toContainText("5 µm");

        // …and a change from elsewhere (shortcut, scripting) is reflected back.
        await page.evaluate(() => window.VIEWER.__depthController.setDepth(4));
        await expect(ruler).toContainText("5 / 11");
        await expect(ruler.locator("[role='slider']")).toHaveAttribute("aria-valuenow", "5");
    });
