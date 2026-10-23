/**
 * `Questionnaire page '1' was not found.` names the bad reference and nothing else.
 *
 * A script asked for "the second page" with `1` against a questionnaire that had been
 * reset to its one-page default, got that sentence, and had no way to see the mismatch —
 * so it guessed again. `pageRef` is also genuinely ambiguous (a number is a 0-based
 * index, a string is an id) while the surrounding prompt rules push a model toward
 * 1-based counting, which makes the inventory the only reliable correction.
 *
 * These tests drive the private helpers through the prototype: the plugin class itself
 * needs the whole app to construct.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.$ = globalThis.$ ?? { t: (key) => key.split(".").pop() };
// The plugin extends a runtime global installed by the loader; nothing under test
// touches it, but the class body cannot be evaluated without it.
globalThis.XOpatPlugin = globalThis.XOpatPlugin ?? class XOpatPlugin {};

const module = await import("../../plugin.ts");
const QuestionnairePlugin = module.default
    ?? Object.values(module).find((v) => typeof v === "function" && v.prototype?._requirePage);

/** A plugin stub carrying only the schema — the lookup helpers read nothing else. */
function pluginWith(pages) {
    const instance = Object.create(QuestionnairePlugin.prototype);
    instance._schema = { version: 1, title: "T", pages };
    return instance;
}

const ONE_PAGE = [{ id: "page_1", title: "Page 1", elements: [] }];

test("a missing page names the pages that exist and the indexing rule", () => {
    const plugin = pluginWith(ONE_PAGE);
    let error = null;
    try { plugin._requirePage(1); } catch (e) { error = e; }

    expect(error).toBeTruthy();
    expect(error.message).toContain("Questionnaire page '1' was not found");
    expect(error.message).toContain("has 1 page(s)");
    expect(error.message).toContain('[0] "Page 1" (id page_1)');
    // The exact confusion that produced the failure.
    expect(error.message).toContain("0-BASED index");
    expect(error.message).toContain("page id");
});

test("an unknown page id is reported the same way", () => {
    const plugin = pluginWith(ONE_PAGE);
    let error = null;
    try { plugin._requirePage("questions"); } catch (e) { error = e; }
    expect(error.message).toContain("Questionnaire page 'questions' was not found");
    expect(error.message).toContain("id page_1");
});

test("a resolvable page still returns without complaint", () => {
    const plugin = pluginWith([
        { id: "page_1", title: "Case Overview", elements: [] },
        { id: "page_2", title: "Questions", elements: [] },
    ]);
    expect(plugin._requirePage(1).id).toBe("page_2");
    expect(plugin._requirePage("page_1").title).toBe("Case Overview");
});

test("the page inventory is capped for a long questionnaire", () => {
    const pages = Array.from({ length: 25 }, (_, i) => ({ id: `page_${i + 1}`, title: `P${i + 1}`, elements: [] }));
    const plugin = pluginWith(pages);
    let error = null;
    try { plugin._requirePage(99); } catch (e) { error = e; }
    expect(error.message).toContain("has 25 page(s)");
    expect(error.message).toContain("… 15 more");
    expect(error.message).not.toContain("page_20");
});

test("the element inventory lists ids and kinds", () => {
    const page = {
        id: "page_1",
        title: "Questions",
        elements: [
            { id: "q1", kind: "radio", name: "q1" },
            { id: "q2", kind: "textarea", name: "q2" },
        ],
    };
    const plugin = pluginWith([page]);
    const described = plugin._describeElements(page);
    expect(described).toContain("has 2 field(s)");
    expect(described).toContain("q1 (radio)");
    expect(described).toContain("q2 (textarea)");

    expect(plugin._describeElements({ id: "p", title: "Empty", elements: [] }))
        .toContain("no fields yet");
});
