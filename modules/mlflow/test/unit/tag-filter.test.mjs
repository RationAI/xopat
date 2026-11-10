/**
 * `buildTagFilter` is the only place a run-lookup filter is built from data.
 * Keys and values routinely come from records or a session (a session-chosen
 * run name is matched by `mlflow.runName`), so neither may end the string
 * literal or the identifier and append clauses of its own.
 */
import { test, expect } from "@xopat/test-harness";
import { buildTagFilter } from "../../utils.mjs";

/** Parse `tags.`<key>` = "<value>"` the way MLflow's tokenizer would. */
function parse(filter) {
    const m = /^tags\.`([^`]*)` = "((?:[^"\\]|\\.)*)"$/.exec(filter);
    return m && { key: m[1], value: m[2].replace(/\\(.)/g, "$1") };
}

test("dotted keys are backtick-quoted @unit", () => {
    expect(buildTagFilter("mlflow.runName", "review")).toBe('tags.`mlflow.runName` = "review"');
});

test("hostile values stay inside one string literal @unit", () => {
    for (const value of ['a\\', 'a\\" AND tags.x = "y', '"', '\\\\"', "plain"]) {
        const parsed = parse(buildTagFilter("data_id", value));
        expect(parsed, value).not.toBeNull();
        expect(parsed.value, value).toBe(value);
    }
});

test("hostile keys cannot leave the identifier @unit", () => {
    const parsed = parse(buildTagFilter('k` = "x" AND tags.`y', "v"));
    expect(parsed).not.toBeNull();
    expect(parsed.key).not.toContain("`");
    expect(parsed.value).toBe("v");
});
