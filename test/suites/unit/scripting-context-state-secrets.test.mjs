/**
 * A scripting context's POLICY must never be serializable.
 *
 * `ScriptingContext.getState()` is what a session bundle carries. Three fields are runtime-only
 * on purpose, and each of them is a decision the user made: the viewer-id alias, the remembered
 * action-consent grants, and the sensitive-data resolver. If any of them round-tripped through a
 * bundle, an imported session could arrive pre-authorised — the exact `getOption`-vs-`getStaticMeta`
 * trust boundary AGENTS.md §7 draws, one layer down.
 *
 * `getState` builds an explicit object literal rather than spreading the instance, so this is a
 * guard against the day someone "simplifies" it into a spread.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

const { ScriptingContext } = await import("../../../src/classes/scripting-manager.ts");

/** The manager is only needed as an identity here; nothing in this test dispatches. */
const context = () => new ScriptingContext({}, "ctx-1", { label: "Chat: ctx-1" });

test("the sensitive-data resolver never reaches getState()", () => {
    const ctx = context();
    ctx.setSensitiveDataResolver(() => true);

    const serialized = JSON.stringify(ctx.getState());

    expect(serialized.includes("sensitiveDataResolver")).toBe(false);
    expect(serialized.includes("SensitiveData")).toBe(false);
    // The policy still answers in-process — it is withheld from the bundle, not from the host.
    expect(ctx.mayExposeSensitiveData()).toBe(true);
});

test("the viewer-id alias never reaches getState()", () => {
    const ctx = context();
    ctx.setViewerIdAlias({ toPresented: () => "viewer-1" });

    expect(JSON.stringify(ctx.getState()).includes("viewer-1")).toBe(false);
    expect(ctx.toPresentedViewerId("real-id")).toBe("viewer-1");
});

test("remembered action consent never reaches getState()", () => {
    const ctx = context();
    ctx.rememberActionConsent("visualization:replace");

    expect(JSON.stringify(ctx.getState()).includes("visualization:replace")).toBe(false);
    expect(ctx.isActionConsented("visualization:replace")).toBe(true);
});

test("no policy installed means sensitive data is allowed", () => {
    // Absence of a policy is not a policy: local scripting must keep seeing its own data.
    expect(context().mayExposeSensitiveData()).toBe(true);
});

test("a resolver that throws degrades closed", () => {
    const ctx = context();
    ctx.setSensitiveDataResolver(() => { throw new Error("consent state unavailable"); });

    // Once a policy exists, one that cannot answer is not permission.
    expect(ctx.mayExposeSensitiveData()).toBe(false);
});
