/**
 * `ExecuteScriptOptions.input` — invocation data handed to a sandboxed script as
 * the read-only global `input`, instead of being spliced into script text.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();

const session = () => ({
    data: [slide.dataId],
    background: [{ dataReference: 0, name: "Synthetic" }],
    params: { bypassCookies: true, bypassCache: true, disablePluginsAutoload: true, debugMode: false },
});

test("scripts read a frozen copy of `input`", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();

    const result = await xopat.page.evaluate(async () => {
        const ctx = window.APPLICATION_CONTEXT.Scripting.createContext({ id: "__input_test__" });
        const data = { list: [1, 2], nested: { a: "x" } };
        const echoed = await ctx.executeScript("return input;", { input: data });
        const frozen = await ctx.executeScript(
            "try { input.list.push(3); return 'mutated'; } catch (e) { return 'frozen'; }", { input: data });
        const shadowed = await ctx.executeScript("const input = 5; return input;", { input: data });
        const absent = await ctx.executeScript("return typeof input;");

        // A reused worker must not leak the previous run's input.
        const workerId = "__input_reuse__";
        await ctx.executeScript("return input;", { input: { secret: 1 }, workerId, reuseWorker: true });
        const reused = await ctx.executeScript("return typeof input;", { workerId, reuseWorker: true });
        ctx.abortScript(workerId);

        return { echoed, frozen, shadowed, absent, reused, callerUntouched: data.list.length };
    });

    expect(result.echoed).toEqual({ list: [1, 2], nested: { a: "x" } });
    expect(result.frozen).toBe("frozen");
    expect(result.shadowed).toBe(5);
    expect(result.absent).toBe("undefined");
    expect(result.reused).toBe("undefined");
    expect(result.callerUntouched).toBe(2);
});
