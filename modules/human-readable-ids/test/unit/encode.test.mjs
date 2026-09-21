/**
 * Reference element unit test: pure module logic, no server, no browser.
 *
 * `HumanReadableIds` maps an integer to a four-word sentence and back. It is a
 * bijection by construction, so the property worth pinning is the round trip —
 * a reordered word list or an off-by-one factor silently changes every id a
 * deployment ever generated, and nothing else in the app would notice.
 *
 * Note the module is a browser script (`window.HumanReadableIds = {...}`),
 * which is what `installBrowserGlobals` / `loadBrowserScript` are for.
 */
import { test, expect, fromRoot, installBrowserGlobals, loadBrowserScript } from "@xopat/test-harness";

let shim;
let ids;

test.beforeAll(async () => {
    shim = installBrowserGlobals();
    ids = await loadBrowserScript(fromRoot("modules", "human-readable-ids", "index.js"), "HumanReadableIds");
});

test.afterAll(() => shim?.restore());

test("encode and parse are inverses", { tag: ["@unit"] }, () => {
    for (const n of [0, 1, 2, 41, 1234, 987654, 4_000_000]) {
        expect(ids.parse(ids.encode(n)), `round trip of ${n}`).toBe(n);
    }
});

test("a sentence is four words", { tag: ["@unit"] }, () => {
    expect(ids.encode(123456).split(" ")).toHaveLength(4);
});

test("the id space is the product of the word lists", { tag: ["@unit"] }, () => {
    const capacity = ids.adjectives.length * ids.nouns.length * ids.verbs.length * ids.adverbs.length;
    expect(() => ids.encode(capacity), "one past the end must not silently wrap").toThrow();
    expect(ids.parse(ids.encode(capacity - 1))).toBe(capacity - 1);
});

test("generated ids stay inside the space", { tag: ["@unit"] }, () => {
    for (let i = 0; i < 50; i++) {
        const sentence = ids.create();
        expect(ids.parse(sentence), sentence).toBeGreaterThanOrEqual(0);
    }
});
