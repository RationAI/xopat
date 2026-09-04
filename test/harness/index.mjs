/**
 * The xOpat test harness — public entry point.
 *
 * Core suites and element (plugin/module) suites alike import from here:
 *
 * ```js
 * import { test, expect } from "@xopat/test-harness";
 *
 * test("the server boots with this deployment ENV", async ({ xopatServer }) => {
 *     expect((await fetch(`${xopatServer.baseURL}/ready`)).ok).toBe(true);
 * });
 * ```
 *
 * Fixtures available:
 *
 *  - `xopatServer` (worker) — a running xOpat server for this project's ENV.
 *    See `fixtures/server.mjs`.
 *  - `xopat` — a browser page bound to that server: `launch()`, `waitForApp()`,
 *    `waitForViewer()`, `canvas()`, `drag()`. See `fixtures/viewer.mjs`.
 *    Requesting it is what launches a browser; server-only tests must not.
 *  - `xopatEnv`, `xopatDevMode`, `xopatServerLogLevel`, `xopatServerEnv`,
 *    `xopatPort` (worker options) — set by projects in `playwright.config.mjs`
 *    to build the deployment matrix.
 *  - `xopatDiagnostics` (auto) — attaches server ENV/logs to failures.
 */
import { test as base, expect } from "@playwright/test";
import { serverFixtures } from "./fixtures/server.mjs";
import { diagnosticsFixtures } from "./fixtures/diagnostics.mjs";
import { viewerFixtures } from "./fixtures/viewer.mjs";

export const test = base.extend({
    ...serverFixtures,
    ...diagnosticsFixtures,
    ...viewerFixtures,
});

export { expect };
export { effectiveClient } from "./env-scratch.mjs";
export { ensureSyntheticSlide } from "./slides/make-synthetic.mjs";
export {
    requireSlides, requireEnvVar, requireKeycloak, requireKeycloakOidc,
    KEYCLOAK_URL, KEYCLOAK_REALM,
    KEYCLOAK_OIDC_ISSUER, KEYCLOAK_JWKS_URI, KEYCLOAK_OIDC_CLIENT_ID,
    KEYCLOAK_OIDC_REDIRECT_PROBE,
} from "./requires.mjs";
export { installBrowserGlobals, loadBrowserScript, loadOpenSeadragon } from "./shims.mjs";
export { repoRoot, fromRoot } from "./paths.mjs";
