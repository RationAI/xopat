/**
 * The full-viewport error screen may not execute what it reports.
 *
 * `USER_INTERFACE.Errors.show` assigned both of its arguments to `innerHTML`
 * with no sanitizer, and `src/app.ts` feeds it `CONFIG.error` / `.description` /
 * `.details` — which come straight from the session bundle (POST_DATA,
 * `?visualization=`, the URL hash), i.e. from whoever handed the user the link.
 * A session that merely *says it is broken* could therefore run script on the
 * viewer's origin, before any slide opened.
 *
 * The second half is the path that feeds it: an error carrying an upstream
 * response body. `HttpClient` under the default `expect:"auto"` decided what to
 * return by consuming the body twice — `res.json()` then `res.text()` — which
 * cannot work (the second read throws "body already read"), so every non-JSON
 * response silently became `{}`. Reading once and branching on the text fixes
 * that, and the branch refuses an HTML *document* outright: what answers
 * `text/html` to an API call is an intermediary, not the endpoint.
 *
 * Payload shapes mirror `plugins/custom-pages/test/e2e/session-pages-xss.test.mjs`
 * — the `<img onerror>` / `<svg onload>` pair needs no `<script>` tag and fires
 * on insertion, which is what a sanitizer that only strips `<script>` misses.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const TAGS = ["@security", "@e2e"];

const slide = ensureSyntheticSlide();

const BASE_PARAMS = {
    bypassCookies: true,
    bypassCache: true,
    disablePluginsAutoload: true,
};

/** Give an inserted `<img onerror>` / `<svg onload>` a chance to actually fire. */
const settle = (xopat) => xopat.page.evaluate(() => new Promise(r => setTimeout(r, 250)));

const screenState = (xopat) => xopat.page.evaluate(() => {
    const host = document.getElementById("system-message");
    const title = document.getElementById("system-message-title");
    const details = document.getElementById("system-message-details");
    return {
        fired: window.__xopatXss ?? null,
        hidden: Boolean(host?.classList.contains("hidden")),
        titleHtml: title?.innerHTML ?? "",
        titleText: title?.textContent ?? "",
        detailsHtml: details?.innerHTML ?? "",
        detailsText: details?.textContent ?? "",
        liveHandlers: document.querySelectorAll(
            "#system-message [onerror], #system-message [onload], #system-message [onmouseover]").length,
        // Any `on*` attribute at all, not just the three above — the selector
        // list only catches handlers somebody thought to enumerate. Scoped to
        // the two content containers: the surrounding card carries the
        // template's own `onclick` buttons (`server/templates/index.html`),
        // which are author-written markup and not what this is watching.
        handlerAttributes: [...document.querySelectorAll(
            "#system-message-title *, #system-message-details *")]
            .flatMap(el => [...el.attributes].map(a => a.name))
            .filter(name => /^on/i.test(name)),
    };
});

test.describe("error screen injection", () => {

    test("a session that reports its own failure cannot execute script", { tag: TAGS }, async ({ xopat }) => {
        // A *valid* slide with an error attached. Leaving the session empty
        // looks like the sharper test but is not: the app raises its own "No
        // data to view." a moment later and overwrites the very screen under
        // assertion, so the session's payload would never be the thing checked.
        await xopat.launch({
            data: [slide.dataId],
            background: [{ dataReference: 0, name: "Synthetic" }],
            error: "<img src=x onerror=\"window.__xopatXss='title'\">Session rejected",
            description: "<img src=x onerror=\"window.__xopatXss='description'\">Could not open",
            details: "<svg onload=\"window.__xopatXss='details'\"></svg>",
            params: { ...BASE_PARAMS },
        });
        await xopat.page.waitForFunction(
            () => !document.getElementById("system-message")?.classList.contains("hidden"),
            null, { timeout: 30_000 });
        await settle(xopat);

        const state = await screenState(xopat);
        expect(state.fired, "a session payload executed on the error screen").toBe(null);
        expect(state.liveHandlers, "an inline handler survived into the DOM").toBe(0);
        expect(state.handlerAttributes, "an event-handler attribute survived sanitization").toEqual([]);

        // NOT asserted: that no `<img>` exists. `img` is on the component
        // allowlist (`ui/classes/baseComponent.mjs`), so a payload's tag can
        // legitimately survive with its handler stripped — that is the
        // allowlist working, and asserting otherwise would pin the wrong thing.

        // The point of sanitizing rather than dropping: the operator still gets
        // to read what the session claimed went wrong.
        expect(state.titleText).toContain("Session rejected");
        expect(state.detailsText).toContain("Could not open");
        // `details` is rendered as text by `Errors.detail`, so the payload is
        // legible in full rather than silently discarded.
        expect(state.detailsText).toContain("svg onload");
    });

    test("Errors.detail renders the detail as text, inside our own <code>", { tag: TAGS }, async ({ xopat }) => {
        await xopat.launch(null, {});

        await xopat.page.evaluate(() => {
            delete window.__xopatXss;
            // The exact shape every core caller uses: our markup, their text.
            USER_INTERFACE.Errors.show(
                "Boot failed",
                USER_INTERFACE.Errors.detail(
                    "Something went wrong",
                    "Error: WADO /studies failed: 500 <img src=x onerror=\"window.__xopatXss='detail'\">"),
                true);
        });
        await settle(xopat);

        const state = await screenState(xopat);
        expect(state.fired).toBe(null);
        expect(state.handlerAttributes).toEqual([]);
        expect(state.detailsHtml, "the <code> wrapper is ours and must survive").toContain("<code>");
        expect(state.detailsHtml, "the detail must be escaped, not parsed").toContain("&lt;img");
        expect(state.detailsText).toContain("WADO /studies failed: 500");
    });

    test("HttpClient auto-parse refuses an HTML document and keeps the text fallback",
        { tag: TAGS }, async ({ xopat }) => {
        await xopat.launch(null, {});

        await xopat.page.route("**/xss-probe/html", route => route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<!doctype html><html><body>Gateway error</body></html>",
        }));
        await xopat.page.route("**/xss-probe/sniff", route => route.fulfill({
            status: 200,
            // No content-type claim at all — the sniff is what has to catch this.
            contentType: "application/octet-stream",
            body: "<html><body>Captive portal</body></html>",
        }));
        await xopat.page.route("**/xss-probe/text", route => route.fulfill({
            status: 200, contentType: "text/plain", body: "plain body",
        }));
        await xopat.page.route("**/xss-probe/json", route => route.fulfill({
            status: 200, contentType: "application/json", body: "{\"ok\":true}",
        }));

        const out = await xopat.page.evaluate(async () => {
            const client = new window.HttpClient({
                baseURL: window.location.origin + "/xss-probe",
                maxRetries: 0,
            });
            const probe = async (path) => {
                try { return { resolved: true, value: await client.request(path) }; }
                catch (e) { return { resolved: false, name: e.name, message: String(e.message) }; }
            };
            return {
                html: await probe("html"),
                sniff: await probe("sniff"),
                text: await probe("text"),
                json: await probe("json"),
            };
        });

        expect(out.html.resolved, "an HTML document must never be returned as a result").toBe(false);
        expect(out.html.name).toBe("HTTPError");
        expect(out.sniff.resolved, "a document with no HTML content-type must be sniffed").toBe(false);

        // The regression guard on the other side: refusing documents must not
        // take the text fallback with it. It used to return `{}` here, because
        // `res.json()` had already consumed the body.
        expect(out.text.resolved).toBe(true);
        expect(out.text.value).toBe("plain body");
        expect(out.json.resolved).toBe(true);
        expect(out.json.value).toEqual({ ok: true });
    });
});
