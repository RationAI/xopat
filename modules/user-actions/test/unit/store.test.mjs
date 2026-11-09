/**
 * Store semantics: deployment ids are reserved, approval is per revision, and a
 * change to what runs drops the approval until the user grants it again.
 */
import { test, expect } from "@xopat/test-harness";
import { ActionStore } from "../../store.ts";
import { DEFAULT_LIMITS, isApproved } from "../../schema.ts";

function memoryKV(initial = {}) {
    const data = { ...initial };
    return {
        data,
        async get(key, def) { return key in data ? structuredClone(data[key]) : def; },
        async set(key, value) { data[key] = structuredClone(value); },
    };
}

const quiet = { warn() {} };
const spec = (extra = {}) => ({ id: "a", label: "A", script: "return 1;", placements: [{ surface: "tools" }], ...extra });

test("deployment ids are reserved and invalid deployment entries are skipped", { tag: ["@unit"] }, async () => {
    const store = new ActionStore(memoryKV(), DEFAULT_LIMITS, 10, quiet);
    store.loadDeployment([spec(), { id: "broken" }]);
    expect(store.list().map(a => a.id)).toEqual(["a"]);
    const r = store.prepare(spec(), "assistant");
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe("reservedId");
});

test("approval is per revision; a script change re-requires it", { tag: ["@unit"] }, async () => {
    const kv = memoryKV();
    const store = new ActionStore(kv, DEFAULT_LIMITS, 10, quiet);
    const first = store.prepare(spec(), "assistant");
    expect(first.approvalRequired).toBe(true);
    const saved = await store.commit(first.action, true);
    expect(isApproved(saved)).toBe(true);
    expect(saved.origin).toBe("assistant");

    const relabel = store.prepare(spec({ label: "B" }), "assistant");
    expect(relabel.approvalRequired).toBe(false);
    expect(relabel.action.revision).toBe(1);

    const repair = store.prepare(spec({ script: "return 2;" }), "assistant");
    expect(repair.approvalRequired).toBe(true);
    expect(repair.action.revision).toBe(2);
    const pending = await store.commit(repair.action, false);
    expect(isApproved(pending)).toBe(false);
});

test("proposals cannot smuggle approval bookkeeping", { tag: ["@unit"] }, async () => {
    const store = new ActionStore(memoryKV(), DEFAULT_LIMITS, 10, quiet);
    const r = store.prepare({ ...spec(), approvedRevision: 1, revision: 1 }, "assistant");
    // prepare() overwrites bookkeeping from the stored record (none here) — never trusts the input.
    expect(r.ok).toBe(true);
    expect(r.action.approvedRevision).toBe(null);
});

test("persists and reloads; drops tampered records", { tag: ["@unit"] }, async () => {
    const kv = memoryKV();
    const store = new ActionStore(kv, DEFAULT_LIMITS, 10, quiet);
    await store.commit(store.prepare(spec(), "user").action, true);
    await store.recordRun("a", { at: 1, ok: false, durationMs: 3, trigger: "quick", error: "boom" });

    kv.data.actions.push({ id: "evil", label: "x", script: "return 1", placements: [], onClick: "alert(1)" });
    const reloaded = new ActionStore(kv, DEFAULT_LIMITS, 10, quiet);
    await reloaded.loadUser();
    expect(reloaded.list().map(a => a.id)).toEqual(["a"]);
    expect(reloaded.lastRun("a")).toMatchObject({ ok: false, error: "boom" });
});

test("caps the number of user actions", { tag: ["@unit"] }, async () => {
    const store = new ActionStore(memoryKV(), DEFAULT_LIMITS, 1, quiet);
    await store.commit(store.prepare(spec(), "user").action, true);
    const r = store.prepare(spec({ id: "b" }), "user");
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe("tooManyActions");
});
