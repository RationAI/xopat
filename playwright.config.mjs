/**
 * xOpat test runner configuration.
 *
 * One runner for core client, core server, plugins and modules — including
 * elements developed in their own repositories and symlinked in (the mechanism
 * documented in `plugins/README.md`; `fs.realpathSync` makes a symlink
 * indistinguishable from a directory to both the server scanner and this
 * config's globs).
 *
 * ## Projects are the deployment matrix
 *
 * A project pairs a suite kind with a deployment ENV. `xopatEnv` is a worker
 * option consumed by the `xopatServer` fixture, so the same specs run against
 * as many deployment shapes as there are projects. `secureMode` in particular
 * is reachable *only* this way: it lives at `core.client.<active>.secureMode`
 * and is deliberately absent from the `setup` block, so the boot sanitizer in
 * `src/app.ts` drops any attempt to set it from a session.
 *
 * ## Conventions
 *
 *   test/suites/{unit,integration,e2e}/**\/*.test.mjs      core suites
 *   {plugins,modules}/<id>/test/{unit,integration,e2e}/**  element suites
 *
 * Cypress is untouched and still owns `*.cy.js` under `test/e2e/` — run it with
 * `npm run test:cypress`. The two never see each other's files.
 *
 * ## Tags
 *
 *   @unit @integration @e2e   suite kind (usually implied by location)
 *   @security                 security-relevant assertions
 *   @slow @soak               excluded from the default run; see `npm run test:slow`
 *   @secure-only              only meaningful under a secureMode deployment
 *   @production-only          only meaningful under a production client build
 *   @needs-slides             requires real slide data (auto-skips without it)
 */
import { defineConfig } from "@playwright/test";
import { elementIgnoresFor } from "./test/harness/discover.mjs";

const BASE_IGNORE = [
    "**/node_modules/**",
    "**/.git/**",
    "**/.server-dist/**",
    "docs/**",
    "src/libs/**",
    // Cypress territory — frozen, run separately. Match the spec extension
    // rather than the directory: an ignore of `test/e2e/**` is matched against
    // any path suffix, so it would also swallow `plugins/<id>/test/e2e/**`.
    "**/*.cy.js",
];

const ELEMENT_GLOBS = (...kinds) => kinds.flatMap(kind => [
    `test/suites/${kind}/**/*.test.mjs`,
    `plugins/*/test/${kind}/**/*.test.mjs`,
    `modules/*/test/${kind}/**/*.test.mjs`,
    // Elements linked in from their own repositories: the file scan stops at a
    // symlink/junction, so their suites arrive through a bridge instead.
    `test/harness/external/external-${kind}.test.mjs`,
]);

/**
 * Long-running suites are out of the default run. `XOPAT_TEST_ALL=1` lifts the
 * exclusion — as an env var rather than a baked-in `--grep-invert`, so that
 * `--grep @slow` on the command line is not silently cancelled out by it.
 */
const SLOW = process.env.XOPAT_TEST_ALL ? [] : ["@slow", "@soak"];

/**
 * A project's `grepInvert` REPLACES the top-level one rather than adding to it,
 * so the slow exclusion has to be composed into each project that sets its own.
 */
const excluding = (...tags) => {
    const all = [...SLOW, ...tags];
    return all.length ? new RegExp(all.join("|")) : undefined;
};

/** Suites that run against every deployment in the matrix. */
const MATRIX_GLOBS = ELEMENT_GLOBS("integration", "e2e");

/**
 * A matrix project. Elements that declared `tests.envs` without this project
 * are excluded here rather than having to skip themselves in every spec.
 */
const matrixProject = (name, xopatEnv, { grep, exclude = [] } = {}) => ({
    name,
    testMatch: MATRIX_GLOBS,
    testIgnore: [...BASE_IGNORE, ...elementIgnoresFor(name)],
    ...(grep ? { grep } : {}),
    grepInvert: excluding(...exclude),
    use: { xopatEnv },
});

export default defineConfig({
    testDir: import.meta.dirname,
    testIgnore: BASE_IGNORE,
    grepInvert: excluding(),
    // Playwright's 60s default assumes a page against an already-running app.
    // Here a test can be waiting on a spawned xOpat server, its extension load,
    // and a viewer boot — ~20s each on an idle machine, and every worker is
    // doing the same thing at once. 60s produced failures that passed in
    // isolation, which is the worst kind of test.
    timeout: 120_000,
    expect: { timeout: 10_000 },
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    outputDir: "test/reports/artifacts",
    reporter: [
        ["list"],
        ["html", { outputFolder: "test/reports/html", open: "never" }],
    ],
    use: {
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
    },

    projects: [
        {
            // Pure logic. No server, no browser, no deployment.
            name: "unit",
            testMatch: ELEMENT_GLOBS("unit"),
        },
        {
            // Suites that predate the runner, executed unmodified.
            // Shrinks to nothing as `test/harness/legacy/manifest.mjs` shrinks.
            name: "legacy",
            testMatch: ["test/harness/legacy/legacy.test.mjs"],
        },

        // ── the deployment matrix ───────────────────────────────────────────
        // Same suites, different server configuration. A test that only makes
        // sense under one of them says so with a tag.
        matrixProject("default", "env/env.default.json", {
            exclude: ["@secure-only", "@production-only", "@synthetic"],
        }),
        matrixProject("secure", "test/env/secure.json", {
            exclude: ["@production-only", "@synthetic"],
        }),
        matrixProject("production", "test/env/production.json", {
            exclude: ["@secure-only", "@synthetic"],
        }),
        // Slide rendering against a generated DeepZoom pyramid — the only
        // deployment that serves image data, and the reason a clean checkout
        // can run browser tests at all.
        matrixProject("synthetic", "test/env/synthetic.json", { grep: /@synthetic/ }),
    ],
});
