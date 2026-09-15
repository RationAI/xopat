/**
 * Turning an identity provider's group claim into xOpat roles.
 *
 * This is the link that was missing entirely: `env/env.saml.json` mapped a
 * `groups` SAML attribute into the minted token, and nothing on the client ever
 * read it, so `core.roles` was inert in every deployment — the whole
 * authorization layer sat there configured and unreachable.
 *
 * The failure mode to protect against is silent over-granting. A claim shape the
 * mapper does not understand must yield NO roles (falling back to the
 * deployment default), never "everything" and never a crash on the login path.
 */
import { test, expect } from "@xopat/test-harness";

const load = () => import("../../../src/classes/user-roles-core.ts");

const CFG = {
    claim: "groups",
    map: {
        pathologists: ["pathologist"],
        researchers: ["researcher"],
        admins: ["researcher", "admin"],
    },
};

test("maps an array claim to role ids @unit", async () => {
    const { rolesFromClaims } = await load();
    expect(rolesFromClaims(["pathologists"], CFG)).toEqual(["pathologist"]);
});

test("maps a single-string claim @unit", async () => {
    const { rolesFromClaims } = await load();
    expect(rolesFromClaims("researchers", CFG)).toEqual(["researcher"]);
});

test("splits a space-separated claim @unit", async () => {
    // The OAuth `scope` convention, and what some SAML mappers emit when
    // "Single Attribute" is left on.
    const { rolesFromClaims } = await load();
    expect(rolesFromClaims("pathologists researchers", CFG)).toEqual(["pathologist", "researcher"]);
});

test("one claim value may grant several roles, deduplicated @unit", async () => {
    const { rolesFromClaims } = await load();
    expect(rolesFromClaims(["admins", "researchers"], CFG)).toEqual(["researcher", "admin"]);
});

test("an unmapped group grants nothing by default @unit", async () => {
    // The important one: a group the operator never mentioned must not become a
    // role id just because it exists at the IdP.
    const { rolesFromClaims } = await load();
    expect(rolesFromClaims(["visitors"], CFG)).toEqual([]);
});

test("unmapped: passthrough treats the value as the role id @unit", async () => {
    const { rolesFromClaims } = await load();
    const cfg = { claim: "groups", unmapped: "passthrough" };
    expect(rolesFromClaims(["editor", "viewer"], cfg)).toEqual(["editor", "viewer"]);
});

test("falls back when the claim is absent or matches nothing @unit", async () => {
    const { rolesFromClaims } = await load();
    const cfg = { ...CFG, fallback: ["guest"] };
    expect(rolesFromClaims(undefined, cfg)).toEqual(["guest"]);
    expect(rolesFromClaims([], cfg)).toEqual(["guest"]);
    expect(rolesFromClaims(["visitors"], cfg)).toEqual(["guest"]);
});

test("junk claim shapes contribute nothing rather than throwing @unit", async () => {
    // A hostile or merely surprising token must not break login.
    const { rolesFromClaims } = await load();
    for (const junk of [null, 42, {}, [{ nested: true }], [null, 7]]) {
        expect(rolesFromClaims(junk, CFG)).toEqual([]);
    }
});

test("no claims config at all yields only the fallback @unit", async () => {
    const { rolesFromClaims } = await load();
    expect(rolesFromClaims(["pathologists"], undefined)).toEqual([]);
});

test("resolveCapabilities applies the mapped roles @unit", async () => {
    // End of the chain: claim → roles → effective capabilities. Asserted here so
    // a change to either half cannot pass by testing only its own side.
    const { rolesFromClaims, resolveCapabilities } = await load();
    const capabilities = [
        { id: "questionaire.edit", default: "allow", declaredBy: "questionaire" },
        { id: "questionaire.answer", default: "allow", declaredBy: "questionaire" },
    ];
    const definitions = {
        pathologist: { grant: ["questionaire.answer"], deny: ["questionaire.edit"] },
    };
    const roles = rolesFromClaims(["pathologists"], CFG);
    const effective = resolveCapabilities({ capabilities, assignedRoles: roles, definitions });
    expect(effective["questionaire.answer"]).toBe(true);
    expect(effective["questionaire.edit"]).toBe(false);
});
