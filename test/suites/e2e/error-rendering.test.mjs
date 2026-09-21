/**
 * What the viewer does when things are broken.
 *
 * xOpat has a substantial failure-handling layer — a per-viewer faulty-source
 * registry, transparent `EmptyTileSource` placeholders, per-shader degradation,
 * a status dispatcher on `add-item-failed` — and until this suite existed, not
 * one line of it was covered. The nearest thing was a comment in
 * `synthetic-slide.test.mjs` naming the 404-tile failure mode.
 *
 * ## How a failure is injected
 *
 * Two mechanisms, chosen by what is actually being tested:
 *
 *  - **`page.route`** for a destination that answers *wrongly* — a tile that
 *    500s, a descriptor that comes back malformed. There is deliberately no
 *    server-side fault-injection hook: adding a test-only "fail this path"
 *    route to `server/node/index.js` would put test surface in the production
 *    server, and interception reproduces the same client behaviour.
 *  - **the `errors` deployment** for a destination that is *not there*. That
 *    one has to be a real 404 from the real static handler, because the whole
 *    point of the case is that the network — not the test — produced it. See
 *    `test/env/errors.json`.
 *
 * ## What is asserted
 *
 * State and messages, not pixels. That is not a shortcut, it is the finding:
 * a failed tile draws *nothing* (OSD sets `exists = false` and returns, and
 * `tileRetryMax` is 0), and a faulty background is an `EmptyTileSource` at
 * `opacity: 0`. Both are pixel-identical to a slow load. Making failure visible
 * on canvas is a separate change; until then, asserting on pixels here would
 * assert that the bug is present.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const TAGS = ["@errors", "@e2e"];

const slide = ensureSyntheticSlide();

const session = (overrides = {}) => ({
    data: [slide.dataId],
    background: [{ dataReference: 0, name: "Synthetic" }],
    ...overrides,
    params: {
        // No state may leak between tests.
        bypassCookies: true,
        bypassCache: true,
        disablePluginsAutoload: true,
        debugMode: false,
        ...(overrides.params ?? {}),
    },
});

/**
 * Record every message the app tried to show the user.
 *
 * The toast component keeps ONE container and collapses repeats into a count
 * badge, so scraping the DOM answers "what is on screen right now" — a race
 * against the auto-hide timer, and blind to a message that was superseded.
 * `window.Dialogs` is a plain assignment in `initXOpatUI`, so a property trap
 * installed before any page script wraps `show` the moment it lands.
 *
 * Must be installed before `launch()`.
 */
const recordDialogs = (page) => page.addInitScript(() => {
    window.__dialogs = [];
    let real;
    Object.defineProperty(window, "Dialogs", {
        configurable: true,
        get: () => real,
        set(value) {
            real = value;
            if (value && typeof value.show === "function") {
                const show = value.show.bind(value);
                value.show = (text, ...rest) => {
                    window.__dialogs.push(String(text));
                    return show(text, ...rest);
                };
            }
        },
    });
});

/** The translated string for `key`, read from the page's own i18n. */
const translate = (xopat, key, params) =>
    xopat.page.evaluate(([k, p]) => window.$.t(k, p ?? undefined), [key, params ?? null]);

const dialogs = (xopat) => xopat.page.evaluate(() => window.__dialogs ?? []);

/** Wait until the app has shown a message containing `text`. */
const waitForDialog = (xopat, text, timeout = 30_000) =>
    xopat.page.waitForFunction(
        (needle) => (window.__dialogs ?? []).some(m => m.includes(needle)),
        text,
        { timeout },
    );

/** The shape of world item 0, as the faulty-source consumers see it. */
const itemState = (xopat) => xopat.page.evaluate(() => {
    const viewer = window.VIEWER;
    const item = viewer?.world?.getItemAt(0);
    const source = item?.source;
    const key = source?.tileSourceId || source?.url || item?.__xopatLoadKey || undefined;
    return {
        items: viewer?.world?.getItemCount() ?? 0,
        key,
        // `getConfig() === undefined` is what makes a placeholder slot inert:
        // no IO restore, no annotation attach.
        hasConfig: typeof item?.getConfig === "function" ? item.getConfig() !== undefined : null,
        faultyBackground: Boolean(item?.__xopatFaultyBackground),
        sourceError: source?.getMetadata?.()?.error ?? null,
        isFaulty: Boolean(viewer?.__faultySources?.isFaulty(key)),
        registryError: viewer?.__faultySources?.getError(key) ?? null,
        hasInstantiationFaulty: Boolean(viewer?.__faultySources?.hasInstantiationFaulty()),
        drawer: typeof viewer?.drawer?.getType === "function" ? viewer.drawer.getType() : null,
    };
});

test.describe("error rendering", () => {

    test("repeated tile failures mark the source faulty and say so", { tag: TAGS }, async ({ xopat }) => {
        await recordDialogs(xopat.page);
        // The descriptor is served normally — only the pyramid fails, which is
        // the realistic shape: a slide that opens and then cannot be viewed.
        await xopat.page.route("**/*_files/**", route => route.fulfill({ status: 500, body: "" }));

        // `faultyTileThreshold` is declared in `src/config.json`, so it survives
        // the boot sanitizer and can be set per-session. 1 makes the transition
        // trip on the first failure instead of racing five of them.
        await xopat.launch(session({ params: { faultyTileThreshold: 1 } }));
        await xopat.waitForViewer();

        await waitForDialog(xopat, await translate(xopat, "error.slide.tilesFaulty"));

        const state = await itemState(xopat);
        expect(state.items, "a tile fault keeps the image in the world — it is warn-only").toBe(1);
        expect(state.isFaulty, "the registry holds the verdict").toBe(true);
        expect(state.registryError, "the shader-menu alert renders this string").toBeTruthy();
        expect(
            state.hasInstantiationFaulty,
            "a tile fault is NOT an instantiation fault: those short-circuit to a placeholder, these keep being requested",
        ).toBe(false);
    });

    test("a descriptor that fails to parse becomes a placeholder slot", { tag: TAGS }, async ({ xopat }) => {
        await recordDialogs(xopat.page);
        await xopat.page.route("**/*.dzi", route => route.fulfill({
            status: 200,
            contentType: "application/xml",
            body: "<Image not-even-close",
        }));

        await xopat.launch(session());
        await xopat.waitForViewer();

        const state = await itemState(xopat);
        expect(state.hasInstantiationFaulty, "the source could not be built at all").toBe(true);
        expect(state.hasConfig, "the placeholder slot is inert: no IO restore, no annotations").toBe(false);
        expect(state.faultyBackground, "the dead slot still names the background it was meant to hold").toBe(true);
        expect(state.sourceError, "EmptyTileSource carries the reason").toBeTruthy();
    });

    test("a destination that does not exist is reported, not swallowed", { tag: TAGS }, async ({ xopat }) => {
        await recordDialogs(xopat.page);

        // No interception: `missing` points inside the opted-in static root at a
        // directory `make-synthetic.mjs` never creates, so this is a real 404
        // from the real static handler.
        await xopat.launch(session({
            data: ["absent.dzi"],
            background: [{ dataReference: 0, protocol: "missing", name: "Absent" }],
        }));
        await xopat.waitForViewer();

        const state = await itemState(xopat);
        expect(state.hasInstantiationFaulty).toBe(true);
        expect(state.hasConfig).toBe(false);

        // Which message depends on whether OSD surfaced a `statusCode` on
        // `add-item-failed`: with one, the handler classifies it as a 404; with
        // none, it falls through to the generic failure. Either is correct —
        // the property under test is that *neither* is silent, which is exactly
        // what the no-statusCode branch used to be (a bare `console.info`).
        const [notFound, failed] = await Promise.all([
            translate(xopat, "error.slide.404"),
            translate(xopat, "error.slide.failed"),
        ]);
        await xopat.page.waitForFunction(
            ([a, b]) => (window.__dialogs ?? []).some(m => m.includes(a) || m.includes(b)),
            [notFound, failed],
            { timeout: 30_000 },
        );

        // Nothing opened, so the viewer falls back to the full-viewport overlay.
        // It must read as an incident report, not a product landing page: the
        // banner is what made the old one useless, and the image name plus the
        // upstream error are what make a bug report actionable.
        const overlay = await xopat.page.evaluate(() => {
            const el = document.getElementById("demo-ad-" + window.VIEWER.id);
            return el && {
                text: el.textContent,
                banner: el.querySelectorAll("img").length,
                // The reasons list is rendered as real nodes now; the previous
                // version injected translated markup through innerHTML.
                reasons: el.querySelectorAll("li").length,
            };
        });
        expect(overlay, "a viewer with nothing open shows the overlay").toBeTruthy();
        expect(overlay.text).toContain(await translate(xopat, "error.demoPage.failureTitle"));
        expect(overlay.text, "it names the image that failed").toContain("Absent");
        expect(overlay.text).toContain(await translate(xopat, "error.demoPage.whatFailed"));
        expect(overlay.reasons, "reasons are nodes, not an innerHTML blob").toBeGreaterThan(0);
        expect(overlay.banner, "no marketing banner on a failure").toBe(0);
    });

    test("a healthy slide beside a dead one still renders", { tag: TAGS }, async ({ xopat }) => {
        await recordDialogs(xopat.page);

        // The case that decides whether failure handling is *containment* or
        // just a nicer way to lose the viewer: one background resolves, one
        // 404s, both open into the same viewer. The dead slot must become an
        // inert placeholder without taking the good image — or the demo
        // overlay, which only belongs on a viewer where NOTHING opened — with it.
        await xopat.launch(session({
            data: [slide.dataId, "absent.dzi"],
            background: [
                { dataReference: 0, name: "Healthy" },
                { dataReference: 1, protocol: "missing", name: "Dead" },
            ],
            params: { activeBackgroundIndex: [0, 1] },
        }));
        await xopat.waitForViewer();

        const state = await xopat.page.evaluate(() => {
            const viewer = window.VIEWER;
            const items = [];
            for (let i = 0; i < viewer.world.getItemCount(); i++) {
                const item = viewer.world.getItemAt(i);
                const source = item.source;
                const key = source?.tileSourceId || source?.url || item.__xopatLoadKey;
                items.push({
                    name: item.__xopatFaultyBackground?.name ?? null,
                    placeholder: typeof item.getConfig === "function" ? item.getConfig() === undefined : null,
                    error: viewer.__faultySources?.getError(key) ?? source?.getMetadata?.()?.error ?? null,
                    width: source?.width ?? null,
                });
            }
            return { items, demoOverlay: Boolean(document.getElementById("demo-ad-" + viewer.id)) };
        });

        expect(state.items.length, "both slots are represented").toBe(2);

        const dead = state.items.filter(i => i.placeholder);
        const alive = state.items.filter(i => !i.placeholder);
        expect(dead.length).toBe(1);
        expect(alive.length).toBe(1);
        expect(dead[0].name, "the dead slot still names the background it was meant to hold").toBe("Dead");
        expect(dead[0].error, "and carries why").toBeTruthy();
        expect(alive[0].width, "the healthy slide opened at its real dimensions").toBe(slide.width);

        expect(
            state.demoOverlay,
            "the demo/failure overlay belongs only to a viewer where nothing opened",
        ).toBe(false);
    });

    test("one dead visualization layer does not take the others down", { tag: TAGS }, async ({ xopat }) => {
        await recordDialogs(xopat.page);

        // Distinct from the background case above: a shader layer resolves its
        // `dataReferences` through the *visualization* protocol
        // (`assemble-render-output.ts` → `env.resolveWorldIndex(i, "visualization")`),
        // which allocates its own world item. So a 404 here produces a
        // placeholder that a live shader is still pointing at — the question is
        // whether the renderer survives being configured with one, or whether
        // one bad overlay costs the whole visualization.
        await xopat.launch(session({
            data: [slide.dataId, "absent.dzi"],
            background: [{ dataReference: 0, name: "Synthetic", visualizationIndex: 0 }],
            visualizations: [{
                name: "One good, one dead",
                shaders: {
                    good: { type: "identity", dataReferences: [0] },
                    dead: { type: "identity", dataReferences: [1] },
                },
            }],
        }));
        await xopat.waitForViewer();

        const state = await xopat.page.evaluate(() => {
            const viewer = window.VIEWER;
            const items = [];
            for (let i = 0; i < viewer.world.getItemCount(); i++) {
                const item = viewer.world.getItemAt(i);
                const source = item.source;
                const key = source?.tileSourceId || source?.url || item.__xopatLoadKey;
                items.push({
                    placeholder: typeof item.getConfig === "function" ? item.getConfig() === undefined : null,
                    error: viewer.__faultySources?.getError(key) ?? source?.getMetadata?.()?.error ?? null,
                    width: source?.width ?? null,
                });
            }
            let shaders = null;
            try {
                shaders = Object.keys(viewer.drawer.renderer.getAllShaders() ?? {});
            } catch { /* not the flex drawer */ }
            return {
                items,
                shaders,
                drawer: typeof viewer.drawer?.getType === "function" ? viewer.drawer.getType() : null,
                demoOverlay: Boolean(document.getElementById("demo-ad-" + viewer.id)),
            };
        });

        expect(state.items.length, "the dead layer still occupies a world slot").toBe(2);
        expect(state.items.filter(i => i.placeholder).length, "exactly one placeholder").toBe(1);
        expect(state.items.find(i => i.placeholder).error, "and it carries why").toBeTruthy();
        expect(
            state.items.find(i => !i.placeholder)?.width,
            "the healthy data opened at its real dimensions",
        ).toBe(slide.width);
        expect(
            state.demoOverlay,
            "a background opened, so this is not a nothing-opened viewer",
        ).toBe(false);

        test.skip(state.drawer !== "flex-renderer", `no flex renderer in this browser (drawer: ${state.drawer})`);
        // The claim being pinned: degradation is per layer. If the renderer
        // refused the whole configuration because one source was a placeholder,
        // `good` would be missing too.
        expect(state.shaders, "the healthy layer is still configured").toEqual(
            expect.arrayContaining([expect.stringContaining("good")]),
        );
    });

    test("a visualizationIndex past the end of the collection warns", { tag: TAGS }, async ({ xopat }) => {
        await recordDialogs(xopat.page);

        await xopat.launch(session({
            background: [{ dataReference: 0, name: "Synthetic", visualizationIndex: 7 }],
            visualizations: [{
                name: "Only one",
                shaders: { base: { type: "identity", dataReferences: [0] } },
            }],
        }));
        await xopat.waitForViewer();

        const state = await itemState(xopat);
        // The bounds check lives on the WebGL branch, because that is where the
        // index is dereferenced. Without the flex drawer the session never gets
        // that far and there is nothing to assert.
        test.skip(state.drawer !== "flex-renderer", `no flex renderer in this browser (drawer: ${state.drawer})`);

        await waitForDialog(xopat, await translate(xopat, "error.visualizationIndexMissing", { index: 7 }));
        expect(state.items, "the background still opens; only the overlays are missing").toBe(1);
    });

    test("a shader type nothing registers is dropped, and reported", { tag: TAGS }, async ({ xopat }) => {
        await recordDialogs(xopat.page);

        await xopat.launch(session({
            background: [{ dataReference: 0, name: "Synthetic", visualizationIndex: 0 }],
            visualizations: [{
                name: "Broken",
                shaders: {
                    ghost: { type: "no-such-shader-type", dataReferences: [0] },
                    real: { type: "identity", dataReferences: [0] },
                },
            }],
        }));
        await xopat.waitForViewer();

        await waitForDialog(xopat, await translate(xopat, "error.visualizationValidationIssues"));

        const shaders = await xopat.page.evaluate(() => {
            const context = window.APPLICATION_CONTEXT;
            const config = context.config ?? context._dangerouslyAccessConfig?.();
            return Object.keys(config?.visualizations?.[0]?.shaders ?? {});
        });
        expect(shaders, "the unknown layer is dropped before it can reach the renderer").not.toContain("ghost");
        expect(shaders, "its siblings survive — validation degrades per layer").toContain("real");
    });

    test("the healthy path is unchanged in this deployment", { tag: TAGS }, async ({ xopat }) => {
        // The `errors` ENV only ADDS a broken protocol; the inherited `static`
        // one stays the default. If this goes red, every assertion above is
        // measuring a broken deployment rather than a broken slide.
        await recordDialogs(xopat.page);
        await xopat.launch(session());
        await xopat.waitForViewer();

        const state = await itemState(xopat);
        expect(state.items).toBe(1);
        expect(state.isFaulty).toBe(false);
        expect(state.hasInstantiationFaulty).toBe(false);

        const shown = await dialogs(xopat);
        const failure = await translate(xopat, "error.slide.failed");
        expect(shown.filter(m => m.includes(failure)), "no failure message on a healthy open").toEqual([]);
    });
});
