/**
 * The slide-info panel is built from a `menu-pages` JSON spec whose divs are
 * *placeholders*: `_fillSlideLabel` / `_fillTechnical` / `_fillDownloadAction`
 * find them again by id after the tab is in the DOM. Both properties that makes
 * necessary — real elements, and surviving ids — were broken by the same thing:
 * the page was handed to the menu as an HTML *string*, and a string child goes
 * through `BaseComponent.toNode`'s untrusted-text renderer. Without
 * `SanitizeHtml` loaded it rendered the markup as literal visible text; with it
 * loaded the allowlist stripped every `id`, so all three fills silently gave up.
 *
 * A deployment only hits this when nothing else pulls the sanitizer in (the
 * EMPAIA workbench whitelist is three plugins, none of them a consumer), which
 * is why the dev deployment hid it. These assertions do not depend on the
 * sanitizer's presence either way.
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

test("a page spec becomes real elements that keep their ids", { tag: ["@e2e"] }, async ({ xopat }) => {
    await ready(xopat);

    const result = await xopat.page.evaluate(() => {
        const builder = new window.AdvancedMenuPages("slide-info-markup-probe");
        const item = builder._pageToViewerItem({
            id: "probe",
            title: "Probe",
            page: [
                { type: "div", id: "markup-probe-label", extraClasses: "hidden mb-3" },
                { type: "div", id: "markup-probe-tech", extraClasses: "hidden" },
            ],
        }, false, "probe");

        const nodes = Array.isArray(item.body) ? item.body : [item.body];
        const host = document.createElement("div");
        for (const n of nodes) host.append(n);

        return {
            isString: typeof item.body === "string",
            everyNode: nodes.every(n => n && n.nodeType === Node.ELEMENT_NODE),
            label: !!host.querySelector("#markup-probe-label"),
            tech: !!host.querySelector("#markup-probe-tech"),
            // The failure mode: markup surviving as text instead of elements.
            leakedText: host.textContent.includes("<div"),
        };
    });

    expect(result.isString, "a string body is re-parsed by the UI layer as untrusted text").toBe(false);
    expect(result.everyNode).toBe(true);
    expect(result.label, "the label placeholder must be findable by id").toBe(true);
    expect(result.tech, "the technical placeholder must be findable by id").toBe(true);
    expect(result.leakedText, "markup rendered as text").toBe(false);
});

test("the rendered panel shows no raw markup", { tag: ["@e2e"] }, async ({ xopat }) => {
    await ready(xopat);
    await xopat.waitForViewer();

    const state = await xopat.page.evaluate(async () => {
        const viewer = window.VIEWER_MANAGER.viewers[0];
        const menu = window.VIEWER_MANAGER.getMenu(viewer);
        // The tab is built from an async getter (locale bundle) on viewer open,
        // under a composed id (`<owner>-pages-menu-root-<owner>-<page>`), so
        // find it rather than spelling it out.
        const find = () => Object.entries(menu?.menu?.tabs || {})
            .find(([key]) => key.includes("pages-menu-root-slide-info"))?.[1];
        let tab = find();
        for (let i = 0; i < 100 && !tab; i++) {
            await new Promise(r => setTimeout(r, 100));
            tab = find();
        }
        return {
            found: !!tab,
            // The placeholder ids are what `_fillSlideLabel` / `_fillTechnical`
            // look up; if the body degraded to text they do not exist at all.
            label: !!document.getElementById(`slide-info-label-${viewer.id}`),
            leakedText: document.body.textContent.includes("<div id=\"slide-info-"),
        };
    });

    expect(state.found, "the slide-info tab is mounted").toBe(true);
    expect(state.label, "the label placeholder reached the DOM with its id").toBe(true);
    expect(state.leakedText, "the panel renders its own markup as visible text").toBe(false);
});
