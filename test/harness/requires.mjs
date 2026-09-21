/**
 * Declarative capability gates.
 *
 * A test that needs something the environment may not have should say so and
 * **skip with a reason**, not fail. The pre-runner suite's failure mode for a
 * missing slide service was a 30-second "Waiting for the viewer" timeout whose
 * cause `test/README.md` had to explain in prose — a skip that names the missing
 * variable is strictly better information for the same zero effort.
 */
import { test } from "@playwright/test";

/**
 * Real slide data, as opposed to the generated synthetic pyramid.
 *
 * Set `XOPAT_TEST_WSI` to the base URL of a slide service and the slide ids in
 * `XOPAT_TEST_SLIDES` (comma-separated) to enable these.
 *
 * @returns {{baseUrl: string, slides: string[]}} valid only when not skipped
 */
export function requireSlides() {
    const baseUrl = process.env.XOPAT_TEST_WSI;
    const slides = (process.env.XOPAT_TEST_SLIDES || "").split(",").map(s => s.trim()).filter(Boolean);
    test.skip(
        !baseUrl || slides.length === 0,
        "needs real slide data: set XOPAT_TEST_WSI and XOPAT_TEST_SLIDES (the synthetic pyramid covers most rendering tests)",
    );
    return { baseUrl, slides };
}

/** A capability the deployment under test may not expose. */
export function requireEnvVar(name, why) {
    test.skip(!process.env[name], `needs ${name}: ${why}`);
    return process.env[name];
}

/** Where the Keycloak fixture listens. Overridable for a shared instance. */
export const KEYCLOAK_URL = process.env.XOPAT_TEST_KEYCLOAK || "http://localhost:8081";
export const KEYCLOAK_REALM = `${KEYCLOAK_URL}/realms/xopat`;
/** The OIDC half of the same realm — issuer, JWKS, and the public PKCE client. */
export const KEYCLOAK_OIDC_ISSUER = KEYCLOAK_REALM;
export const KEYCLOAK_JWKS_URI = `${KEYCLOAK_REALM}/protocol/openid-connect/certs`;
export const KEYCLOAK_OIDC_CLIENT_ID = "xopat-viewer-oidc";
/**
 * A redirect URI the realm registers for that client — the `oidc` project's own
 * origin, so the probe checks the registration this project actually depends on
 * rather than some other deployment's.
 */
export const KEYCLOAK_OIDC_REDIRECT_PROBE = "http://localhost:9401/";

/**
 * GET a fixture URL, falling back from `localhost` to `127.0.0.1`.
 *
 * Docker publishes `8081:8080` on IPv4 only, while Node resolves `localhost` to `::1` FIRST on
 * Windows — so a probe against `http://localhost:8081` intermittently hangs until its own
 * timeout and reports a running container as absent. The symptom is the worst kind: a suite
 * that skips itself, with a message telling you to start something that is already up.
 *
 * The fallback is the PROBE's only. The URLs the tests and the deployment use keep saying
 * `localhost`, because that is the issuer Keycloak mints into its tokens and the origin the
 * realm registers — rewriting those would break the audience check rather than fix anything.
 *
 * @returns {Promise<Response|null>} the response, or null when the host could not be reached
 */
async function probe(url, timeoutMs = 10_000, init = {}) {
    const attempt = async (target) => {
        try {
            return await fetch(target, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        } catch {
            return null;
        }
    };
    const first = await attempt(url);
    if (first) return first;
    return url.includes("//localhost") ? attempt(url.replace("//localhost", "//127.0.0.1")) : null;
}

/**
 * The Keycloak fixture from `test/fixtures/keycloak/`.
 *
 * Probed rather than gated on an env var: the container is either up or it is
 * not, and asking the developer to also remember a flag turns a working setup
 * into a silent skip.
 */
export async function requireKeycloak() {
    const res = await probe(`${KEYCLOAK_REALM}/protocol/saml/descriptor`);
    test.skip(
        !res?.ok,
        `needs the Keycloak fixture at ${KEYCLOAK_URL} — `
        + "docker compose -f test/fixtures/keycloak/docker-compose.yaml up -d "
        + "(see test/fixtures/keycloak/README.md)",
    );
    return { url: KEYCLOAK_URL, realm: KEYCLOAK_REALM };
}

/**
 * The same fixture, but checked for the OIDC **client** rather than only the realm.
 *
 * `requireKeycloak()` would pass here — the realm is up and its SAML descriptor
 * answers — while `xopat-viewer-oidc` does not exist at all, because the compose
 * file imports a realm only when it is absent. Anyone whose container predates
 * that client keeps the old realm indefinitely, and the failure surfaces as a
 * login that never completes rather than as stale state. So the probe asks for
 * the thing this project actually needs, and the skip names the one command that
 * fixes it.
 *
 * Keycloak accepts the authorize request only when BOTH the client id and the
 * `redirect_uri` are registered, and answers **400** otherwise — so the probe
 * sends a registered redirect URI and reads any non-400 as the registration being
 * present. That is the cheapest true test available without admin credentials,
 * and it covers the port mistakes too: a client whose redirect URIs do not
 * include this project's origin fails here rather than three redirects into a
 * login the assertions cannot see.
 *
 * Two things that look like they could be tightened and cannot:
 *
 * - **Do not require 200.** Keycloak 26 answers an accepted authorize request
 *   with a 302 to its own `login-actions/authenticate`; only older versions
 *   rendered the form inline. `< 400` is the version-independent predicate, and
 *   `redirect: "manual"` is what keeps that 302 visible instead of following it.
 * - **Do not drop `redirect_uri`.** Keycloak 400s on a missing one even for a
 *   client it knows, which makes an unregistered client and a malformed request
 *   indistinguishable and turns the probe into a permanent skip.
 */
export async function requireKeycloakOidc() {
    const authorize = `${KEYCLOAK_REALM}/protocol/openid-connect/auth`
        + `?client_id=${encodeURIComponent(KEYCLOAK_OIDC_CLIENT_ID)}`
        + `&redirect_uri=${encodeURIComponent(KEYCLOAK_OIDC_REDIRECT_PROBE)}`
        + "&response_type=code&scope=openid";
    const res = await probe(authorize, 10_000, { redirect: "manual" });
    let reason = null;
    if (!res) {
        reason = `needs the Keycloak fixture at ${KEYCLOAK_URL} — `
            + "docker compose -f test/fixtures/keycloak/docker-compose.yaml up -d "
            + "(see test/fixtures/keycloak/README.md)";
    } else if (res.status >= 400) {
        reason = `Keycloak at ${KEYCLOAK_URL} did not accept client `
            + `'${KEYCLOAK_OIDC_CLIENT_ID}' with redirect_uri ${KEYCLOAK_OIDC_REDIRECT_PROBE} `
            + `(HTTP ${res.status}). An EXISTING realm is never re-imported, so a container `
            + "older than this client keeps the old realm — recreate it: "
            + "docker compose -f test/fixtures/keycloak/docker-compose.yaml down -v && "
            + "docker compose -f test/fixtures/keycloak/docker-compose.yaml up -d";
    }
    test.skip(Boolean(reason), reason ?? "");
    return { url: KEYCLOAK_URL, realm: KEYCLOAK_REALM, clientId: KEYCLOAK_OIDC_CLIENT_ID };
}
