/**
 * Which viewer cells get their own WebGL context.
 *
 * A shared context forces the renderer through a per-frame `readPixels` +
 * `putImageData` transfer — 18% of wall clock in the session that prompted this
 * (`UPSTREAM.md`, "shared-context presentation reads every frame back to the
 * CPU"). A private context has no transfer at all, so the allocator's job is to
 * hand out as many as the browser's ~16-context cap safely allows and fall back
 * to sharing beyond that.
 *
 * The failure that actually matters is the quiet one: a slot that is never
 * released. Nothing breaks, nothing logs — every viewer opened after the leak
 * just silently runs on the slow path. Hence the release/re-acquire vectors.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

const {
    FLEX_SHARED_CONTEXT_KEY,
    acquireFlexContextKey,
    releaseFlexContextKey,
    hasPrivateFlexContext,
    flexContextUsage,
} = await import("../../../src/classes/app/flex-renderer-context.ts");

/** Point `APPLICATION_CONTEXT.getOption` at a fixed budget for one test. */
function withBudget(value, run) {
    const previous = globalThis.APPLICATION_CONTEXT;
    globalThis.APPLICATION_CONTEXT = {
        getOption: (key) => (key === "webGlPrivateContextBudget" ? value : undefined),
    };
    try { run(); } finally { globalThis.APPLICATION_CONTEXT = previous; }
}

/** Release everything this test claimed, so ordering between tests cannot matter. */
function releaseAll(ids) {
    for (const id of ids) releaseFlexContextKey(id);
}

test("cells under the budget get a private context @unit", () => {
    withBudget(3, () => {
        const ids = ["osd-0", "osd-1", "osd-2"];
        for (const id of ids) {
            expect(acquireFlexContextKey(id), `${id} is private`).toBe(null);
            expect(hasPrivateFlexContext(id)).toBe(true);
        }
        expect(flexContextUsage()).toEqual({ used: 3, budget: 3 });
        releaseAll(ids);
    });
});

test("cells past the budget fall back to the shared context @unit", () => {
    withBudget(2, () => {
        const ids = ["a", "b", "c", "d"];
        expect(acquireFlexContextKey("a")).toBe(null);
        expect(acquireFlexContextKey("b")).toBe(null);
        // The fallback is what keeps a host spawning many viewers under the cap.
        expect(acquireFlexContextKey("c")).toBe(FLEX_SHARED_CONTEXT_KEY);
        expect(acquireFlexContextKey("d")).toBe(FLEX_SHARED_CONTEXT_KEY);
        expect(hasPrivateFlexContext("c")).toBe(false);
        releaseAll(ids);
    });
});

test("acquiring twice for one cell does not consume two slots @unit", () => {
    withBudget(1, () => {
        expect(acquireFlexContextKey("only")).toBe(null);
        expect(acquireFlexContextKey("only"), "same answer, same slot").toBe(null);
        expect(flexContextUsage().used).toBe(1);
        releaseAll(["only"]);
    });
});

test("a released slot is reusable — a rearranged grid does not drift onto the shared path @unit", () => {
    withBudget(1, () => {
        expect(acquireFlexContextKey("first")).toBe(null);
        expect(acquireFlexContextKey("second"), "budget is spent").toBe(FLEX_SHARED_CONTEXT_KEY);

        releaseFlexContextKey("first");
        expect(flexContextUsage().used).toBe(0);
        expect(acquireFlexContextKey("second"), "the freed slot is handed out again").toBe(null);
        releaseAll(["second"]);
    });
});

test("releasing a cell that never held a slot is a no-op @unit", () => {
    withBudget(2, () => {
        // Viewer teardown calls this unconditionally, including for cells that
        // fell back to the shared context and for aborted opens.
        releaseFlexContextKey("never-acquired");
        releaseFlexContextKey("");
        releaseFlexContextKey(undefined);
        expect(flexContextUsage().used).toBe(0);
    });
});

test("a budget of 0 disables private contexts entirely @unit", () => {
    withBudget(0, () => {
        expect(acquireFlexContextKey("x")).toBe(FLEX_SHARED_CONTEXT_KEY);
        expect(flexContextUsage()).toEqual({ used: 0, budget: 0 });
    });
});

test("a missing or nonsense budget falls back to the built-in default @unit", () => {
    for (const value of [undefined, null, "", "abc", -4, NaN]) {
        withBudget(value, () => {
            expect(flexContextUsage().budget, `budget for ${String(value)}`).toBeGreaterThan(0);
            expect(acquireFlexContextKey("probe")).toBe(null);
            releaseAll(["probe"]);
        });
    }
});

test("an anonymous owner never claims a slot @unit", () => {
    withBudget(4, () => {
        // No id means no way to release it later, so it must not take one.
        expect(acquireFlexContextKey("")).toBe(FLEX_SHARED_CONTEXT_KEY);
        expect(flexContextUsage().used).toBe(0);
    });
});
