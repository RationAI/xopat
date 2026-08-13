/**
 * The legacy output parser guards every not-yet-ported suite, so a bug in it
 * silently under-reports coverage — the exact failure mode the adapter exists to
 * prevent. The vectors below are copied from the real dialects in the repo.
 */
import { test, expect } from "@xopat/test-harness";
import { parseLegacyOutput } from "../../harness/legacy/tap.mjs";

test("reads the TAP-ish dialect used by most suites", { tag: ["@unit"] }, () => {
    const parsed = parseLegacyOutput([
        "# static serving confinement",
        "ok 1 - env/env.json is not served",
        "not ok 2 - traversal via %2e%2e is refused",
        "  expected 404, got 200",
        "ok 3 - a .server.ts source is not served",
        "",
    ].join("\n"));

    expect(parsed.dialect).toBe("tap");
    expect(parsed.assertions).toHaveLength(3);
    expect(parsed.passed).toBe(2);
    expect(parsed.failed).toBe(1);
    expect(parsed.assertions[1]).toMatchObject({
        name: "traversal via %2e%2e is refused",
        ok: false,
        detail: "expected 404, got 200",
    });
});

test("reads the `# <json>` inline-detail variant", { tag: ["@unit"] }, () => {
    const parsed = parseLegacyOutput('not ok 7 - and flags the ungraded parent  # ["honeycomb_quality"]');
    expect(parsed.failed).toBe(1);
    expect(parsed.assertions[0].name).toBe("and flags the ungraded parent");
    expect(parsed.assertions[0].detail).toBe('["honeycomb_quality"]');
});

test("trusts a summary-only suite's own count", { tag: ["@unit"] }, () => {
    // `test/dicom/derived-conformance.mjs` never prints its passes.
    const parsed = parseLegacyOutput("DICOM conformance: 128 checks passed.");
    expect(parsed.dialect).toBe("summary");
    expect(parsed.declared).toBe(128);
    expect(parsed.passed).toBe(128);
    expect(parsed.failed).toBe(0);
});

test("names the failures a summary-only suite does print", { tag: ["@unit"] }, () => {
    const parsed = parseLegacyOutput([
        "",
        "DICOM conformance: 126 passed, 2 FAILED",
        "  ✗ pmap.valueRange",
        "     expected {\"min\":0,\"max\":1}",
        "     actual   {\"min\":0,\"max\":255}",
        "  ✗ seg.frameDims",
    ].join("\n"));

    expect(parsed.failed).toBe(2);
    expect(parsed.declared).toBe(128);
    expect(parsed.passed).toBe(126);
    expect(parsed.assertions[0].detail).toContain("expected");
});

test("picks up the trailer counts emitted alongside TAP", { tag: ["@unit"] }, () => {
    const parsed = parseLegacyOutput(["ok 1 - a", "ok 2 - b", "", "1..2", "# all passed"].join("\n"));
    expect(parsed.passed).toBe(2);
    expect(parsed.declared).toBe(2);
});

test("reports nothing recognisable rather than a green zero", { tag: ["@unit"] }, () => {
    const parsed = parseLegacyOutput("Segmentation fault");
    expect(parsed.dialect).toBe("none");
    expect(parsed.declared).toBeNull();
    expect(parsed.assertions).toHaveLength(0);
});
