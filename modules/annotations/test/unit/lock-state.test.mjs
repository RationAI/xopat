/**
 * What "locked" means, and who gets to say so.
 *
 * The padlock on an annotation used to toggle `private`, which only the export
 * filter ever read — a lock that locked nothing. Two flags carry it now, and the
 * whole point of resolving them in one place is that hit-testing, selectability,
 * editability, the IO guard, the padlock icon and the board badge cannot drift
 * apart: they all read this descriptor.
 *
 *   locked    the user's own lock   — out of the canvas's way, releasable again
 *   readOnly  imposed by an owner   — still readable, never releasable here
 *
 * And because what a lock *means* belongs to whoever owns the data (EMPAIA's job
 * output stays clickable; only its owner may release it), a policy may override
 * the answer. These pin both halves.
 *
 * Driven against the real resolver, called on a bare `this` — no module instance,
 * no canvas, no browser.
 */
import { test, expect, fromRoot, installBrowserGlobals, loadBrowserScript } from "@xopat/test-harness";

let shim;
let A;

/** The resolver, invoked without constructing the module. */
const resolve = (object, policies) =>
    A.prototype.getAnnotationLockState.call({ _lockPolicies: policies }, object);

/** The registry, likewise — `reapplyVisibility` is the only thing it reaches for. */
function registry() {
    const host = {
        _lockPolicies: undefined,
        reapplies: 0,
        reapplyVisibility() { this.reapplies++; },
    };
    host.register = (ownerId, policy) => A.prototype.registerLockPolicy.call(host, ownerId, policy);
    host.resolve = (object) => A.prototype.getAnnotationLockState.call(host, object);
    return host;
}

test.beforeAll(async () => {
    shim = installBrowserGlobals({
        extra: {
            XOpatModuleSingleton: class {},
            XOpatHistory: { XOpatHistoryProvider: class {} },
            addModule: () => {},
        },
    });
    A = await loadBrowserScript(fromRoot("modules", "annotations", "annotations.js"), "OSDAnnotations");
});

test.afterAll(() => shim?.restore());

// ── the four combinations ───────────────────────────────────────────────────

test("an ordinary annotation is not locked", { tag: ["@unit"] }, () => {
    const state = resolve({});
    expect(state.locked).toBe(false);
    expect(state.interactive).toBe(true);
    expect(state.mutable).toBe(true);
    expect(state.code).toBe(null);
});

test("the user's lock takes the annotation off the canvas, and can be lifted", { tag: ["@unit"] }, () => {
    const state = resolve({ locked: true });
    expect(state.locked).toBe(true);
    // This is what lets the user draw straight over it.
    expect(state.interactive).toBe(false);
    expect(state.mutable).toBe(false);
    expect(state.releasable).toBe(true);
    expect(state.code).toBe("W_ANNOTATION_LOCKED");
});

test("an imposed lock stays readable but cannot be lifted", { tag: ["@unit"] }, () => {
    const state = resolve({ readOnly: true });
    expect(state.locked).toBe(true);
    // Unchanged from before the user lock existed: selection is how the user
    // inspects a job's output and comments on it.
    expect(state.interactive).toBe(true);
    expect(state.mutable).toBe(false);
    expect(state.releasable).toBe(false);
    expect(state.code).toBe("W_ANNOTATION_READONLY");
});

test("both at once keeps the restrictive half of each", { tag: ["@unit"] }, () => {
    const state = resolve({ locked: true, readOnly: true });
    expect(state.interactive, "non-interactive, from the user's lock").toBe(false);
    expect(state.releasable, "and not releasable, from the imposed one").toBe(false);
});

test("a junk flag out of a foreign bundle fails safe", { tag: ["@unit"] }, () => {
    // Imported state is not trusted to be boolean; a truthy value locks rather
    // than throwing, because refusing a mutation is the safe direction.
    expect(resolve({ locked: "false" }).locked).toBe(true);
    expect(resolve({ locked: 0 }).locked).toBe(false);
    expect(resolve(undefined).locked).toBe(false);
});

test("the refusal message is resolved at call time, not at module load", { tag: ["@unit"] }, () => {
    // A `$.t()` baked into the frozen state would have captured the placeholder
    // translator. The shim's `$.t` returns the key's last segment.
    expect(resolve({ locked: true }).reason).toBe("refused");
    expect(resolve({}).reason).toBe("");
});

// ── policies ────────────────────────────────────────────────────────────────

test("a policy redefines the meaning without touching the flag", { tag: ["@unit"] }, () => {
    const host = registry();
    host.register("owner", (object) => (object.jobId ? { interactive: true, releasable: false } : undefined));

    const job = host.resolve({ locked: true, jobId: "j1" });
    expect(job.locked, "still locked").toBe(true);
    expect(job.interactive, "but this owner wants it clickable").toBe(true);
    expect(job.releasable, "and refuses to let the user release it").toBe(false);

    const own = host.resolve({ locked: true });
    expect(own.interactive, "an annotation the policy has no opinion on is untouched").toBe(false);
    expect(own.releasable).toBe(true);
});

test("policies compose in registration order", { tag: ["@unit"] }, () => {
    const host = registry();
    const seen = [];
    host.register("first", () => ({ interactive: true }));
    host.register("second", (object, stateSoFar) => {
        seen.push(stateSoFar.interactive);
        return { releasable: false };
    });

    const state = host.resolve({ locked: true });
    expect(seen, "the later policy sees the earlier one's answer").toEqual([true]);
    expect(state.interactive).toBe(true);
    expect(state.releasable).toBe(false);
});

test("a throwing policy is no opinion, not a locked canvas", { tag: ["@unit"] }, () => {
    const host = registry();
    const warn = console.warn;
    console.warn = () => {};
    try {
        host.register("broken", () => { throw new Error("boom"); });
        expect(host.resolve({}).locked).toBe(false);
        expect(host.resolve({ locked: true }).interactive).toBe(false);
    } finally {
        console.warn = warn;
    }
});

test("re-registering replaces, and the disposer restores the default answer", { tag: ["@unit"] }, () => {
    const host = registry();
    const dispose = host.register("owner", () => ({ releasable: false }));
    host.register("owner", () => ({ interactive: true }));

    expect(host.resolve({ locked: true }).releasable, "the first policy is gone").toBe(true);
    expect(host.resolve({ locked: true }).interactive).toBe(true);

    // The disposer of the replaced registration must not remove the live one.
    dispose();
    expect(host.resolve({ locked: true }).interactive, "still the replacement's answer").toBe(true);

    const before = host.reapplies;
    host.register("owner", () => undefined)();
    expect(host.resolve({ locked: true }).interactive, "default again once disposed").toBe(false);
    expect(host.reapplies, "registering and disposing each re-derive interactivity").toBe(before + 2);
});

test("a non-function registration is ignored", { tag: ["@unit"] }, () => {
    const host = registry();
    host.register("owner", null);
    expect(host._lockPolicies, "nothing registered, nothing to iterate").toBe(undefined);
    expect(host.resolve({ locked: true }).interactive).toBe(false);
});
