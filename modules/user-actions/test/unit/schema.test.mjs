/**
 * The action validator is the single gate for every producer (deployment ENV,
 * user, assistant, file import). A stored action is executable content, so the
 * schema is closed: unknown fields are errors, not passengers.
 */
import { test, expect } from "@xopat/test-harness";
import { validateAction, needsApproval, toSpec, isApproved, DEFAULT_LIMITS } from "../../schema.ts";

const base = () => ({
    id: "count-per-class",
    label: "Count by class",
    script: "return 1;",
    placements: [{ surface: "quick", pinned: true }],
});

test("accepts a minimal user action and fills defaults", { tag: ["@unit"] }, () => {
    const r = validateAction(base(), { trust: "user" });
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({
        source: "user", origin: "user", output: "auto", enabled: true,
        timeoutMs: 600000, revision: 1, approvedRevision: null,
    });
    expect(isApproved(r.value)).toBe(false);
});

test("rejects unknown fields at both levels", { tag: ["@unit"] }, () => {
    const r = validateAction({ ...base(), onClick: "x", placements: [{ surface: "quick", html: "<b>" }] }, { trust: "user" });
    expect(r.ok).toBe(false);
    expect(r.errors.map(e => e.field)).toEqual(expect.arrayContaining(["onClick", "placements[0].html"]));
});

test("user input may not claim deployment privileges", { tag: ["@unit"] }, () => {
    const r = validateAction({ ...base(), bypassConsent: true }, { trust: "user" });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ field: "bypassConsent", code: "unknownField" });
});

test("deployment input: label maps, script lines, bypassConsent", { tag: ["@unit"] }, () => {
    const r = validateAction({
        ...base(),
        label: { en: "Count by class", cs: "Počet dle třídy" },
        script: ["const a = 1;", "return a;"],
        bypassConsent: true,
    }, { trust: "deployment", language: "cs" });
    expect(r.ok).toBe(true);
    expect(r.value.label).toBe("Počet dle třídy");
    expect(r.value.script).toBe("const a = 1;\nreturn a;");
    expect(r.value).toMatchObject({ source: "deployment", bypassConsent: true });
    expect(isApproved(r.value)).toBe(true);
});

test("label map falls back to en, then the first entry", { tag: ["@unit"] }, () => {
    const en = validateAction({ ...base(), label: { en: "E", de: "D" } }, { trust: "deployment", language: "fr" });
    const first = validateAction({ ...base(), label: { de: "D" } }, { trust: "deployment", language: "fr" });
    expect(en.value.label).toBe("E");
    expect(first.value.label).toBe("D");
});

test("user input must be canonical (no label maps / script arrays)", { tag: ["@unit"] }, () => {
    const r = validateAction({ ...base(), label: { en: "x" }, script: ["return 1"] }, { trust: "user" });
    expect(r.ok).toBe(false);
    expect(r.errors.map(e => e.code)).toEqual(expect.arrayContaining(["badLabel", "badScript"]));
});

test("validates ids, icons, combos and placement-specific fields", { tag: ["@unit"] }, () => {
    const r = validateAction({
        ...base(),
        id: "Bad Id",
        icon: "fa-star",
        placements: [
            { surface: "shortcut", combo: "ctrl+c" },
            { surface: "tools", pinned: true },
            { surface: "context-menu", when: "hover" },
            { surface: "nowhere" },
        ],
    }, { trust: "user" });
    expect(r.ok).toBe(false);
    expect(r.errors.map(e => e.code)).toEqual(expect.arrayContaining(
        ["badId", "badIcon", "badCombo", "badPinned", "badWhen", "badSurface"]));
});

test("accepts valid shortcut combos", { tag: ["@unit"] }, () => {
    for (const combo of ["Alt+KeyC", "Primary+Shift+Digit1", "F2", "Ctrl+Alt+ArrowUp"]) {
        const r = validateAction({ ...base(), placements: [{ surface: "shortcut", combo }] }, { trust: "user" });
        expect(r.ok, combo).toBe(true);
    }
});

test("enforces deployment limits", { tag: ["@unit"] }, () => {
    const limits = { ...DEFAULT_LIMITS, maxScriptBytes: 10, maxTimeoutMs: 5000, surfaces: ["tools"] };
    const r = validateAction({ ...base(), script: "return 'more than ten bytes';" }, { trust: "user", limits });
    expect(r.errors.map(e => e.code)).toEqual(expect.arrayContaining(["scriptTooLarge", "surfaceDisabled"]));
    const clamped = validateAction({ ...base(), placements: [], timeoutMs: 999999 }, { trust: "user", limits });
    expect(clamped.value.timeoutMs).toBe(5000);
});

test("rejects duplicate surfaces", { tag: ["@unit"] }, () => {
    const r = validateAction({ ...base(), placements: [{ surface: "tools" }, { surface: "tools" }] }, { trust: "user" });
    expect(r.errors[0].code).toBe("duplicateSurface");
});

test("needsApproval tracks the executable surface only", { tag: ["@unit"] }, () => {
    const a = toSpec(validateAction(base(), { trust: "user" }).value);
    expect(needsApproval(undefined, a)).toBe(true);
    expect(needsApproval(a, { ...a, label: "Renamed", icon: "ph-star" })).toBe(false);
    expect(needsApproval(a, { ...a, script: "return 2;" })).toBe(true);
    expect(needsApproval(a, { ...a, placements: [{ surface: "tools" }] })).toBe(true);
});
