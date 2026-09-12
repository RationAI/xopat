/**
 * A session may supply pages. It may not supply script.
 *
 * This plugin's entire input — the page list, and until recently the
 * sanitization policy applied to it — came from `getOption`, i.e. from the
 * session bundle, POST_DATA or URL params: whoever handed the user the link.
 * A page could therefore carry `{type:"html", html:"<img src=x onerror=...>"}`
 * and select `target:"viewer"`, the one mount path that stopped sanitizing when
 * the menu body became DOM nodes instead of an HTML string.
 *
 * The unit suite (`modules/menu-pages/test/unit/render-sanitize.test.mjs`) pins
 * the renderer's three entry points against stubs. This runs the same payloads
 * through the real builder in a real DOM and then *attaches* the result, which
 * is the step that fires an inline handler and the step no unit test can model.
 *
 * `false` is passed as the sanitize policy on purpose: it is what
 * `custom-pages` resolves to from its own `include.json`, and it used to mean
 * "raw pass-through". It now means "the module default allowlist".
 */
import { test, expect } from "@xopat/test-harness";

/** The report's payload, plus the two gadgets that need no {type:"html"} node. */
const HOSTILE_PAGES = {
    html: { type: "html", html: "<img src=x onerror=\"window.__xopatXss = 'html'\">" },
    svgHandler: { type: "html", html: "<svg onload=\"window.__xopatXss = 'svg'\"></svg>" },
    // `UI.RawHtml.create()` does `el.innerHTML = this._children.join("")`.
    rawHtml: { type: "RawHtml", children: ["<img src=x onerror=\"window.__xopatXss = 'rawhtml'\">"] },
    // `UI.StatusBar` renders `span({innerHTML: options.initialMessage})`.
    statusBar: { type: "StatusBar", initialMessage: "<img src=x onerror=\"window.__xopatXss = 'statusbar'\">" },
    // Attribute breakout: the value is sanitized as TEXT, which leaves `"` intact.
    attribute: { type: "vega", classes: "\" onmouseover=\"window.__xopatXss = 'attr'" },
};

async function ready(xopat) {
    await xopat.launch({ params: { bypassCookies: true, bypassCache: true } });
    // menu-pages arrives as a dependency of whatever the deployment loads.
    await xopat.page.waitForFunction(() => Boolean(window.AdvancedMenuPages), null, { timeout: 30_000 });
}

/**
 * Build a page through the real builder and attach it to the live document,
 * exactly as `MenuTab._createTab` does — attaching is what fires a handler.
 * Runs in the browser; returns what, if anything, executed.
 */
const renderAndAttach = (pages) => {
    delete window.__xopatXss;
    const builder = new window.AdvancedMenuPages("custom-pages-xss-probe");
    const item = builder._pageToViewerItem({ id: "probe", title: "Probe", page: pages }, false, "probe");

    const host = document.createElement("div");
    document.body.appendChild(host);
    const nodes = Array.isArray(item.body) ? item.body : [item.body];
    for (const n of nodes) if (n) host.append(n);

    const result = {
        markup: host.innerHTML,
        liveHandlers: host.querySelectorAll("[onerror],[onload],[onmouseover],[onclick]").length,
        fired: window.__xopatXss ?? null,
    };
    host.remove();
    return result;
};

test("no session page shape can execute script", { tag: ["@e2e"] }, async ({ xopat }) => {
    await ready(xopat);

    for (const [name, page] of Object.entries(HOSTILE_PAGES)) {
        const result = await xopat.page.evaluate(renderAndAttach, [page]);

        expect(result.fired, `payload "${name}" executed`).toBe(null);
        expect(result.liveHandlers, `payload "${name}" left a live handler in the DOM`).toBe(0);
        expect(result.markup, `payload "${name}" injected a raw <img>`).not.toContain("<img");
    }
});

test("benign markup survives, placeholders keep their ids", { tag: ["@e2e"] }, async ({ xopat }) => {
    await ready(xopat);

    // The builders wait for the sanitizer before rendering a config that needs
    // it; `_pageToViewerItem` is below that seam, so the wait is done here.
    await xopat.page.evaluate(() => new Promise(resolve => {
        if (typeof window.SanitizeHtml === "function") return resolve();
        window.UTILITIES.loadModules(() => resolve(), "sanitize-html");
    }));

    // The regression guard on the other side: closing the hole must not go back
    // to sanitizing the assembled body, which is what stripped these ids.
    const result = await xopat.page.evaluate(renderAndAttach, [
        { type: "div", id: "xss-probe-placeholder", extraClasses: "hidden" },
        { type: "html", html: "<p>Plain <b>documentation</b> text.</p>" },
        { type: "html", html: "<details><summary>More</summary><p>Detail.</p></details>" },
    ]);

    expect(result.markup).toContain('id="xss-probe-placeholder"');
    expect(result.markup).toContain("<b>documentation</b>");
    // The two tags this module widens the allowlist for.
    expect(result.markup).toContain("<summary>");
    expect(result.fired).toBe(null);
});

test("a config with no raw html renders without the sanitizer at all", { tag: ["@e2e"] }, async ({ xopat }) => {
    await ready(xopat);

    // The timing property `needsSanitizer` exists for: a placeholder-only page
    // (slide-info's shape, and the one a menu is opened on the next line for)
    // must not wait on a module load, and must not degrade to text either.
    const result = await xopat.page.evaluate(renderAndAttach, [
        { type: "div", id: "xss-probe-sync", extraClasses: "hidden" },
        { type: "div", children: ["Plain text & an ampersand"] },
    ]);

    expect(result.markup).toContain('id="xss-probe-sync"');
    // Text reaches the component verbatim - it used to arrive double-escaped,
    // because it was run through the sanitizer and then rendered as a text node.
    expect(result.markup).toContain("Plain text &amp; an ampersand");
    expect(result.markup).not.toContain("&amp;amp;");
});
