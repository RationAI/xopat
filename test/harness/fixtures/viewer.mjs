/**
 * Browser-side fixture: a page with the viewer loaded from the project's server.
 *
 * ## Launching a session without POST
 *
 * `src/parse-input.js` resolves a session from four places, in priority order:
 * the POST body, `location.hash`, `?visualization=`, and `?slides=`. The hash
 * form is parsed locally with no round-trip, which makes it the cheapest and
 * most deterministic transport for a test — and unlike POST navigation it needs
 * no interception at all.
 *
 * The POST transport is still available (`transport: "post"`), because that is
 * what real embeddings use and it deserves coverage: it is served by fulfilling
 * the navigation with a self-submitting form, which is exactly the mechanism
 * `parse-input.js` itself uses for the `?visualization=` path.
 *
 * ## Waiting
 *
 * There is no `app-ready` event and no global ready promise in xOpat — boot is
 * kicked off by an inline `DOMContentLoaded` handler in the page template. So
 * `waitForApp()` polls for `APPLICATION_CONTEXT`, and `waitForViewer()` polls
 * the viewer's own readiness the way the pre-runner suite did: an item in the
 * world and the image loader mostly drained.
 */

const jsonParam = (session) => encodeURIComponent(JSON.stringify(session));

class XOpatPage {
    constructor(page, server) {
        this.page = page;
        this.server = server;
        /**
         * What the last `launch()` opened, for failure diagnostics.
         * @type {{session: object|null, transport: string, url: string|null}|null}
         */
        this.lastLaunch = null;
    }

    /**
     * Open the viewer.
     *
     * @param {object|null} session  a visualization/session object, or null for a bare viewer
     * @param {object} [opts]
     * @param {"hash"|"query"|"post"|"slides"} [opts.transport="hash"]
     * @param {string[]} [opts.slides] used by the `slides` transport
     * @param {Record<string,string>} [opts.headers] extra headers for the `post` transport
     */
    async launch(session = null, opts = {}) {
        const transport = opts.transport ?? (opts.slides ? "slides" : "hash");
        const base = this.server.baseURL;
        this.lastLaunch = { session, transport, url: null };

        if (transport === "post") {
            await this.#launchViaPost(session, opts);
        } else {
            let url = `${base}/`;
            if (transport === "slides") url += `?slides=${(opts.slides ?? []).map(encodeURIComponent).join(",")}`;
            else if (transport === "query" && session) url += `?visualization=${jsonParam(session)}`;
            else if (transport === "hash" && session) url += `#${jsonParam(session)}`;
            this.lastLaunch.url = url;
            await this.page.goto(url, { waitUntil: "domcontentloaded" });
        }
        await this.waitForApp();
        return this;
    }

    /**
     * Navigate by POST, the way an embedding application does.
     *
     * A page cannot be told to POST a top-level navigation, and the usual
     * workaround — a self-submitting form — cannot send `application/json`
     * (forms only speak urlencoded / multipart / text-plain), so it would
     * exercise a different server branch than the one embeddings actually hit.
     * Rewriting the navigation request itself keeps the body byte-identical to
     * a real embedding POST.
     */
    async #launchViaPost(session, opts) {
        const base = this.server.baseURL;
        const target = `${base}/`;
        const body = JSON.stringify({ visualization: session, ...(opts.data ?? {}) });

        const handler = (route, request) => {
            if (request.isNavigationRequest() && request.frame() === this.page.mainFrame()) {
                return route.continue({
                    method: "POST",
                    postData: body,
                    headers: { ...request.headers(), "content-type": "application/json", ...(opts.headers ?? {}) },
                });
            }
            return route.continue();
        };

        await this.page.route(target, handler);
        try {
            await this.page.goto(target, { waitUntil: "domcontentloaded" });
        } finally {
            await this.page.unroute(target, handler);
        }
    }

    /** Resolve once `initXOpat` has produced an application context. */
    async waitForApp({ timeout = 60_000 } = {}) {
        await this.page.waitForFunction(() => Boolean(window.APPLICATION_CONTEXT), null, { timeout });
        return this;
    }

    /** Resolve once a viewer has actually opened something. */
    async waitForViewer({ timeout = 60_000 } = {}) {
        await this.page.waitForFunction(() => {
            const viewer = window.VIEWER;
            return Boolean(viewer) && viewer.world?.getItemCount() > 0 && viewer.imageLoader?.jobsInProgress < 2;
        }, null, { timeout });
        return this;
    }

    /** The main OSD canvas, skipping the navigator's. */
    canvas() {
        return this.page.locator(".openseadragon-canvas > canvas")
            .filter({ hasNot: this.page.locator('[id*="navigator"] canvas') })
            .first();
    }

    /**
     * Drag a path with a real (CDP-level) mouse — annotation drawing, panning.
     * @param {{x:number,y:number}[]} points viewport coordinates
     * @param {{button?: "left"|"right"|"middle", steps?: number}} [opts]
     */
    async drag(points, opts = {}) {
        const button = opts.button ?? "left";
        const [first, ...rest] = points;
        await this.page.mouse.move(first.x, first.y);
        await this.page.mouse.down({ button });
        for (const point of rest) await this.page.mouse.move(point.x, point.y, { steps: opts.steps ?? 4 });
        await this.page.mouse.up({ button });
    }

    /** Read an option through the core resolver, from inside the page. */
    getOption(key, defaultValue) {
        return this.page.evaluate(
            ([k, d]) => (d === undefined
                ? window.APPLICATION_CONTEXT.getOption(k)
                : window.APPLICATION_CONTEXT.getOption(k, d)),
            [key, defaultValue],
        );
    }

    /** The raw per-request ENV the server handed this page. */
    env() {
        return this.page.evaluate(() => window.APPLICATION_CONTEXT.env);
    }

    /** Everything the app logged at WARN/ERROR, for failure diagnostics. */
    async appTrace() {
        return this.page.evaluate(() => (window.console?.appTrace ?? []).slice(-200)).catch(() => []);
    }
}

/**
 * Everything needed to reproduce a failing viewer test by hand.
 *
 * The scratch ENV *file* is already attached by the diagnostics fixture, but a
 * file is not what the page ran against: `<% VAR %>` placeholders are
 * substituted server-side, so the protocol URL a test actually hit — the thing
 * that is usually wrong — appears nowhere in it. And nothing at all recorded
 * the session. So attach the ENV the page received, the session that was
 * launched, and, for the hash transport, the literal URL: pasting it into a
 * browser against `XOPAT_ENV=<sourceFile>` reproduces the failure with no test
 * runner involved.
 */
const attachReproduction = async (xopat, testInfo) => {
    const launch = xopat.lastLaunch;
    if (launch) {
        await testInfo.attach("session config", {
            body: JSON.stringify(launch.session, null, 2),
            contentType: "application/json",
        }).catch(() => {});
    }

    const env = await xopat.env().catch(() => null);
    if (env) {
        await testInfo.attach("effective client ENV (as the page received it)", {
            body: JSON.stringify(env, null, 2),
            contentType: "application/json",
        }).catch(() => {});
    }

    // The scratch path, not the source file. `createEnvScratch` FLATTENS the
    // `$base` chain; the server does not resolve `$base` itself, so pointing
    // XOPAT_ENV at the source file gives a deployment missing everything the
    // base layers contributed — and it fails by silently falling back to
    // `src/config.json`, which looks like a broken slide rather than a broken
    // ENV. `npm run up:dev` does the same flattening for a hand-run server.
    const source = xopat.server.scratch?.sourceFile;
    const lines = [
        `XOPAT_ENV=${xopat.server.scratch?.path ?? "(unknown)"}`,
        `XOPAT_NODE_PORT=${xopat.server.port}`,
        `transport=${launch?.transport ?? "(never launched)"}`,
        "",
        source
            ? `That path is a flattened scratch copy and is deleted when the run ends.\n`
              + `To start the same deployment by hand:  npm run up:dev -- ${source}`
            : "",
        "",
        launch?.url
            ? `Open this URL against that ENV:\n${launch.url}`
            : "This transport rewrites the navigation request, so there is no URL to paste — see the attached session config.",
    ];
    await testInfo.attach("reproduce", {
        body: lines.join("\n"),
        contentType: "text/plain",
    }).catch(() => {});
};

export const viewerFixtures = {
    xopat: async ({ page, xopatServer }, use, testInfo) => {
        const xopat = new XOpatPage(page, xopatServer);
        await use(xopat);

        if (testInfo.status !== testInfo.expectedStatus) {
            const trace = await xopat.appTrace();
            if (trace.length) {
                await testInfo.attach("app console trace (WARN/ERROR)", {
                    body: JSON.stringify(trace, null, 2),
                    contentType: "application/json",
                }).catch(() => {});
            }
            await attachReproduction(xopat, testInfo).catch(() => {});
        }
    },
};

export { XOpatPage };
