/**
 * A provider must not advertise a context it cannot serve.
 *
 * `listContexts` guarded only "context key absent" — and since it enumerates the
 * declared keys, that guard was structurally dead. `issuer`, `entryPoint`/`idpCert`
 * and the token signing secret were never read, so an incomplete context was
 * announced as fully usable with `autoLogin: true`. Core now DRIVES the automatic
 * login, so the viewer navigated itself into a bare 400 page on the first load, with
 * the reason visible only in the server log.
 *
 * The case that actually bit: `token.secretEnv` naming an environment variable that
 * was never set. `tokenSecret()` consults `secretEnv` unconditionally once present —
 * an unset variable is NOT a fallback to `token.secret` — and it throws from
 * `signRelayState` on `/login`, long before any token is minted.
 */
import { test, expect } from "@xopat/test-harness";

// `context-config.ts`, not `saml-flow.ts`: the latter loads node-saml through
// `createRequire(import.meta.url)` and cannot be imported outside the server bundle.
const load = () => import(`../../context-config.ts?t=${Math.random()}`);

/** A context that is complete apart from whatever the caller overrides. */
const complete = (over = {}) => ({
    issuer: "xopat-viewer",
    entryPoint: "https://idp.example/saml",
    idpCert: "MIICmzCCAYMCBgF",
    token: { secret: "shhh" },
    ...over,
});

test("a complete context is usable", async () => {
    const { contextConfigProblem } = await load();
    expect(contextConfigProblem(complete())).toBe(null);
});

test("idpMetadataUrl supplies both entryPoint and idpCert", async () => {
    const { contextConfigProblem } = await load();
    expect(contextConfigProblem({
        issuer: "xopat-viewer",
        idpMetadataUrl: "http://localhost:8081/realms/xopat/protocol/saml/descriptor",
        token: { secret: "shhh" },
    })).toBe(null);
});

test("a missing issuer is caught", async () => {
    const { contextConfigProblem } = await load();
    expect(contextConfigProblem(complete({ issuer: undefined })).includes("issuer")).toBe(true);
});

test("a missing entryPoint with no metadata URL is caught", async () => {
    const { contextConfigProblem } = await load();
    expect(contextConfigProblem(complete({ entryPoint: undefined })).includes("entryPoint")).toBe(true);
});

test("a missing idpCert with no metadata URL is caught, including an empty array", async () => {
    const { contextConfigProblem } = await load();
    expect(contextConfigProblem(complete({ idpCert: undefined })).includes("idpCert")).toBe(true);
    expect(contextConfigProblem(complete({ idpCert: [] })).includes("idpCert")).toBe(true);
});

test("secretEnv naming an UNSET variable is a failure, not a fallback to token.secret", async () => {
    const { contextConfigProblem } = await load();
    const name = "XOPAT_TEST_SAML_SECRET_DEFINITELY_UNSET";
    delete process.env[name];

    // `.secret` is present and still must not save it: `tokenSecret` consults
    // `secretEnv` unconditionally once present, so the two disagree-by-design and the
    // validator has to mirror that exactly or it would pass a context that 400s.
    const problem = contextConfigProblem(complete({ token: { secretEnv: name, secret: "ignored" } }));
    expect(typeof problem).toBe("string");
    expect(problem.includes(name)).toBe(true);
});

test("secretEnv naming a SET variable passes", async () => {
    const { contextConfigProblem } = await load();
    const name = "XOPAT_TEST_SAML_SECRET_SET";
    process.env[name] = "value";
    try {
        expect(contextConfigProblem(complete({ token: { secretEnv: name } }))).toBe(null);
    } finally {
        delete process.env[name];
    }
});

test("no token block at all is caught", async () => {
    const { contextConfigProblem } = await load();
    expect(typeof contextConfigProblem(complete({ token: undefined }))).toBe("string");
});

test("an empty context object is caught", async () => {
    const { contextConfigProblem } = await load();
    expect(typeof contextConfigProblem({})).toBe("string");
    expect(typeof contextConfigProblem(null)).toBe("string");
});
