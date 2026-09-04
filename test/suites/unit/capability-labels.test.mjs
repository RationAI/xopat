/**
 * Naming a capability to the person it was refused to.
 *
 * The refusal message used to be "You do not have permission to perform this
 * action." and nothing else — every call site passed the capability id into the
 * interpolation and the locale string dropped it. Diagnosing a closed gate then
 * meant reading `flattenRoles` and the role config side by side, which is what
 * a real user cannot do: a pathologist whose LLM workflow died had no way to
 * learn that `core.scripting.run` was the missing grant.
 *
 * Two things have to hold for the message to be worth printing:
 *
 *  - it must DISAMBIGUATE. One `io.capabilities` entry derives four
 *    capabilities that share the owner's single label, so "Annotation" alone
 *    names the read gate and the delete gate equally badly.
 *  - it must DEGRADE to the id. An owner that declared no label has nothing
 *    better to offer, and printing nothing is how this problem started.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

// A WORKING stub, not a convenient one. `OpenSeadragon.EventSource` is assigned
// with `??=`, so whichever suite imports first installs it for every suite in
// the worker — a no-op `raiseEvent` here silently broke a neighbouring test
// that depends on the events actually firing.
class EventSource {
    constructor() { this._h = new Map(); }
    addHandler(name, fn) { (this._h.get(name) ?? this._h.set(name, []).get(name)).push(fn); }
    removeHandler(name, fn) {
        const l = this._h.get(name);
        if (l) this._h.set(name, l.filter(x => x !== fn));
    }
    raiseEvent(name, payload) { for (const fn of this._h.get(name) ?? []) fn(payload); }
}
globalThis.OpenSeadragon = globalThis.OpenSeadragon ?? {};
globalThis.OpenSeadragon.EventSource = globalThis.OpenSeadragon.EventSource ?? EventSource;
window.OpenSeadragon = globalThis.OpenSeadragon;
// The real dictionary for the four direction words, so a renamed key fails here
// rather than shipping "user.roles.direction.delete" into a dialog.
// `translation` is i18next's default namespace — the file's single top-level
// key, which `$.t("user.roles.…")` resolves beneath.
const en = JSON.parse(
    await (await import("node:fs/promises")).readFile(
        new URL("../../../src/locales/en.json", import.meta.url), "utf8")).translation;
globalThis.$ = {
    t: (key) => key.split(".").reduce((o, k) => (o ?? {})[k], en) ?? key.split(".").pop(),
};

const { XOpatUser } = await import("../../../src/classes/user.ts");

/** Declare a capability exactly as `registerOwnerRights` would. */
const declare = (desc) => XOpatUser.declareCapability({ default: "allow", ...desc });

test("a CRUD-derived capability names its operation @unit", () => {
    // All four siblings carry `label: "Annotation"` from one include.json
    // entry; without the direction the panel rendered four identical chips and
    // a refusal could not say which gate closed.
    declare({ id: "annotations.crud:annotation.create", label: "Annotation", direction: "create", declaredBy: "annotations" });
    declare({ id: "annotations.crud:annotation.delete", label: "Annotation", direction: "delete", declaredBy: "annotations" });

    const create = XOpatUser.capabilityLabel("annotations.crud:annotation.create");
    const del = XOpatUser.capabilityLabel("annotations.crud:annotation.delete");

    expect(create).toContain("Annotation");
    expect(del).toContain("Annotation");
    expect(create, "the two gates must not read identically").not.toBe(del);
    expect(create).toContain(en.user.roles.direction.create);
    expect(del).toContain(en.user.roles.direction.delete);
});

test("a labelled capability with no direction reads as its label @unit", () => {
    declare({ id: "core.scripting.run", label: "Run scripts", declaredBy: "core" });
    expect(XOpatUser.capabilityLabel("core.scripting.run")).toBe("Run scripts");
});

test("an unlabelled capability falls back to its id @unit", () => {
    // `include.json` entries are not required to carry a label. The id is ugly
    // but true, and it is still enough to find the grant that is missing.
    declare({ id: "empaia-app-ui.job.run", declaredBy: "empaia-app-ui" });
    expect(XOpatUser.capabilityLabel("empaia-app-ui.job.run")).toBe("empaia-app-ui.job.run");
});

test("an undeclared capability is returned verbatim @unit", () => {
    // `can()` answers `true` for ids nobody declared, so this should be
    // unreachable from a refusal — but a caller must never get `undefined`
    // interpolated into a sentence.
    expect(XOpatUser.capabilityLabel("nobody.declared.this")).toBe("nobody.declared.this");
});

test("the refusal sentence carries the capability @unit", () => {
    // The template itself: a message that interpolates nothing is what made
    // this class of failure undiagnosable.
    expect(en.user.roles.refused).toContain("{{capability}}");
});
