/**
 * A provider must not advertise a context it cannot serve.
 *
 * `listContexts` used to map every declared config key straight to an announced
 * context, reading none of it. Core now DRIVES the automatic login for whatever it is
 * told exists, so a context with a missing `clientId` was announced with
 * `autoLogin: true` and the viewer navigated itself to the identity provider with
 * `client_id=undefined` — which the IdP rejects, making a local configuration error
 * look like a problem at the provider.
 *
 * These vectors pin the structural check that stops it.
 */
import { test, expect } from "@xopat/test-harness";

const load = () => import(`../../oidc-flow.ts?t=${Math.random()}`);

test("a complete context is usable", async () => {
    const { contextConfigProblem } = await load();
    expect(contextConfigProblem({
        clientId: "xopat", clientSecret: "s", issuer: "https://idp.example/realms/x",
    })).toBe(null);
});

test("discoveryUrl satisfies the issuer requirement", async () => {
    const { contextConfigProblem } = await load();
    expect(contextConfigProblem({
        clientId: "xopat", discoveryUrl: "https://idp.example/.well-known/openid-configuration",
    })).toBe(null);
});

test("a missing clientId is caught — it used to reach the IdP as the string 'undefined'", async () => {
    const { contextConfigProblem } = await load();
    const problem = contextConfigProblem({ issuer: "https://idp.example" });
    expect(typeof problem).toBe("string");
    expect(problem.includes("clientId")).toBe(true);
});

test("neither issuer nor discoveryUrl is caught", async () => {
    const { contextConfigProblem } = await load();
    const problem = contextConfigProblem({ clientId: "xopat" });
    expect(problem.includes("issuer")).toBe(true);
});

test("a non-http issuer is caught rather than deferred to a request", async () => {
    const { contextConfigProblem } = await load();
    expect(typeof contextConfigProblem({ clientId: "x", issuer: "idp.example" })).toBe("string");
});

test("an empty context object is caught", async () => {
    const { contextConfigProblem } = await load();
    expect(typeof contextConfigProblem({})).toBe("string");
    expect(typeof contextConfigProblem(null)).toBe("string");
});
