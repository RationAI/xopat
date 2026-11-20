/**
 * `buildTagFilter` is the only place a run-lookup filter is built from data.
 * Keys and values routinely come from records or a session (a session-chosen
 * run name is matched by `mlflow.runName`), so neither may end the string
 * literal or the identifier and append clauses of its own — and the parsed
 * value must equal the tag `getOrCreateRunByTag` writes, or lookups miss and
 * duplicate runs.
 */
import { test, expect } from "@xopat/test-harness";
import { buildTagFilter } from "../../utils.mjs";

/**
 * Parse `tags.`<key>` = <quoted value>` the way MLflow does: sqlparse's string
 * token regexes delimit the literal, then `SearchUtils._strip_quotes` slices the
 * ends off. No escape is decoded — that is the whole point.
 */
function parse(filter) {
    const m = /^tags\.(`(?:``|[^`])*`) = ("(?:""|\\"|[^"])*"|'(?:''|\\'|[^'])*')$/.exec(filter);
    return m && { key: m[1].slice(1, -1), value: m[2].slice(1, -1) };
}

test("dotted keys are backtick-quoted @unit", () => {
    expect(buildTagFilter("mlflow.runName", "review")).toBe('tags.`mlflow.runName` = "review"');
});

test("values round-trip exactly through MLflow's parser @unit", () => {
    for (const value of ["plain", "a\\", "a\\b", "\\\\", 'a"b', "a'b", 'a\\" AND tags.x = "y', '"', ""]) {
        const parsed = parse(buildTagFilter("data_id", value));
        expect(parsed, value).not.toBeNull();
        expect(parsed.value, value).toBe(value);
    }
});

test("a value with both quote kinds cannot be matched exactly and throws @unit", () => {
    expect(() => buildTagFilter("data_id", `a'b"c`)).toThrow();
});

test("keys are kept verbatim, so lookup matches the key written on create @unit", () => {
    for (const key of ["data id", "group/slide", "mlflow.runName"]) {
        expect(parse(buildTagFilter(key, "v"))?.key, key).toBe(key);
    }
});

test("hostile keys cannot leave the identifier @unit", () => {
    expect(() => buildTagFilter('k` = "x" AND tags.`y', "v")).toThrow();
    expect(() => buildTagFilter("", "v")).toThrow();
});
