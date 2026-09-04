/**
 * The server and the browser must reach the SAME verdict from the same rules.
 *
 * They are two different runtimes reading one config: the browser resolves
 * `core.roles` to decide what to render, the server resolves it to decide what
 * to serve. A divergence would not look like a bug — it would look like a UI
 * that offers an action the API then refuses, or (far worse) hides an action
 * the API happily performs.
 *
 * `server/node/roles.js` therefore does not reimplement the cascade: it
 * transforms `src/classes/user-roles-core.ts` and calls into it. These vectors
 * pin that this is actually what happens — a future "small copy to avoid the
 * esbuild dependency" would fail here rather than in production — plus the two
 * places the server deliberately answers DIFFERENTLY, which is the whole reason
 * a client-side role is not authorization.
 */
import { test, expect } from "@xopat/test-harness";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const serverRoles = require_("../../../server/node/roles.js");
const { resolveCapabilities, rolesFromClaims } = await import("../../../src/classes/user-roles-core.ts");

/** The three-role catalogue the shipped fragments use, in ENV shape. */
const CORE = {
    CORE: {
        roles: {
            default: ["guest"],
            claims: {
                claim: "groups",
                map: { pathologists: ["pathologist"], researchers: ["researcher"] },
            },
            definitions: {
                guest: { deny: ["questionaire.*", "annotations.*"] },
                pathologist: {
                    grant: ["annotations.*", "questionaire.answer"],
                    deny: ["questionaire.edit"],
                },
                researcher: {
                    grant: ["questionaire.*"],
                    deny: ["annotations.crud:annotation.create"],
                },
            },
        },
    },
};

const CAPS = [
    "annotations.bundle-export",
    "annotations.crud:annotation.create",
    "annotations.crud:annotation.read",
    "questionaire.edit",
    "questionaire.answer",
    "unrelated.thing",
];

/** What the browser would answer for one capability under one role set. */
function clientVerdict(capabilityId, assignedRoles) {
    const effective = resolveCapabilities({
        capabilities: [{ id: capabilityId, default: "allow", declaredBy: "test" }],
        assignedRoles,
        definitions: CORE.CORE.roles.definitions,
    });
    return effective[capabilityId] !== false;
}

/** A ctx as the RPC runtime builds it, with claims already VERIFIED. */
const ctxWithGroups = (groups) => ({ user: { id: "u1", claims: { groups } } });

test("every capability resolves identically on both sides @unit @security", () => {
    for (const groups of [["pathologists"], ["researchers"], ["pathologists", "researchers"], []]) {
        const ctx = ctxWithGroups(groups);
        const assigned = serverRoles.resolveRoles(ctx, CORE);
        for (const cap of CAPS) {
            const server = serverRoles.can(ctx, cap, CORE);
            expect(
                server.ok,
                `capability "${cap}" for groups [${groups.join(",")}] resolved to `
                    + `${server.ok} on the server and ${clientVerdict(cap, assigned)} on the client`,
            ).toBe(clientVerdict(cap, assigned));
        }
    }
});

test("the server borrows the shared claim mapper, not a copy @unit", () => {
    const ctx = ctxWithGroups(["pathologists"]);
    expect(serverRoles.resolveRoles(ctx, CORE))
        .toEqual(rolesFromClaims(["pathologists"], CORE.CORE.roles.claims));
});

test("an authenticated caller with no recognised group gets the deployment default @unit", () => {
    // Same as the browser at boot: `core.roles.default` applies until something
    // says otherwise.
    expect(serverRoles.resolveRoles(ctxWithGroups(["nobody-knows-this"]), CORE)).toEqual(["guest"]);
});

// ── where the two sides differ, on purpose ───────────────────────────────────

test("no verified identity fails a capability check CLOSED @unit @security", () => {
    // The asymmetry that makes this layer worth having. The browser answers
    // `true` for an unknown id so one deployment's config cannot lock another's
    // UI; the server cannot afford that generosity, because here the answer IS
    // the access decision.
    const verdict = serverRoles.can({}, "annotations.bundle-export", CORE);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("no verified identity");
    expect(serverRoles.resolveRoles({}, CORE)).toBe(null);
});

test("a method declaring no capabilities is never gated @unit", () => {
    // What makes this safe to ship into a running deployment: existing methods
    // declare nothing, so nothing changes for them — including for anonymous
    // callers, who would otherwise be refused by the rule above.
    expect(serverRoles.checkCapabilities({}, [], "all", CORE).ok).toBe(true);
    expect(serverRoles.checkCapabilities({}, null, "all", CORE).ok).toBe(true);
});

test("a deployment with no roles block denies nothing @unit", () => {
    const ctx = ctxWithGroups([]);
    expect(serverRoles.can(ctx, "annotations.bundle-export", {}).ok).toBe(true);
    expect(serverRoles.can(ctx, "anything.at.all", { CORE: {} }).ok).toBe(true);
});

// ── the modes ────────────────────────────────────────────────────────────────

test('mode "all" needs every capability, "any" needs one @unit @security', () => {
    const ctx = ctxWithGroups(["pathologists"]);
    const both = ["annotations.bundle-export", "questionaire.edit"];   // granted, denied

    expect(serverRoles.checkCapabilities(ctx, both, "all", CORE).ok).toBe(false);
    expect(serverRoles.checkCapabilities(ctx, both, "any", CORE).ok).toBe(true);
    expect(serverRoles.checkCapabilities(ctx, ["questionaire.edit"], "any", CORE).ok).toBe(false);
});

test("a refusal names the capability and the roles that failed it @unit", () => {
    const verdict = serverRoles.can(ctxWithGroups(["pathologists"]), "questionaire.edit", CORE);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("questionaire.edit");
    expect(verdict.roles).toEqual(["pathologist"]);
});
