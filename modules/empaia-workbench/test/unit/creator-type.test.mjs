/**
 * `creator_type` is the only thing tying a result annotation, a primitive or a
 * pixel map back to the analysis that produced it. Everything the analyses UI
 * does — showing one run, hiding another, marking job output read-only, keeping
 * job output out of hydration — rests on reading it correctly.
 *
 * It was read with an exact `=== "job"` while the service sends a different
 * casing than its schema documents. Nothing threw: annotations simply arrived
 * with no `empaiaJobId`, so eviction matched nothing, re-import was suppressed,
 * pixel maps were never attributed, and the eye toggle became a silent no-op.
 *
 * These vectors pin the normalization so a casing change can never turn a
 * subsystem off again.
 */
import { test, expect } from "@xopat/test-harness";

const { isJobCreated } = await import("../../types.ts");
const { empaiaToNative } = await import("../../convertor.ts");

/** Minimal mapping context — the decode only needs the optional hooks absent. */
const ctx = { slideId: "slide-1" };

/** A valid rectangle on the wire, with the creator fields under test. */
const wireRect = (over = {}) => ({
    id: "ann-1",
    type: "rectangle",
    upper_left: [10, 20],
    width: 30,
    height: 40,
    creator_id: "job-42",
    creator_type: "job",
    ...over,
});

// ── the predicate ───────────────────────────────────────────────────────────

test("job creation is recognised whatever the service capitalises it as", () => {
    for (const creator_type of ["job", "JOB", "Job", "jOb"]) {
        expect(isJobCreated({ creator_type })).toBe(true);
    }
});

test("nothing else counts as job-created", () => {
    for (const creator_type of ["scope", "SCOPE", "user", "USER", "service", ""]) {
        expect(isJobCreated({ creator_type })).toBe(false);
    }
    // Absent, null and non-string values must answer false rather than throw —
    // this reads a field off an untrusted wire record.
    expect(isJobCreated({})).toBe(false);
    expect(isJobCreated(undefined)).toBe(false);
    expect(isJobCreated(null)).toBe(false);
    expect(isJobCreated({ creator_type: 7 })).toBe(false);
});

// ── what the decode must stamp ──────────────────────────────────────────────

test("job output is attributed to its job in every casing", () => {
    for (const creator_type of ["job", "JOB", "Job"]) {
        const native = empaiaToNative(wireRect({ creator_type }), ctx);
        expect(native).toBeTruthy();
        // `creator_id` IS the producing job's id — the only handle the visibility
        // set can match against.
        expect(native.empaiaJobId).toBe("job-42");
    }
});

test("job output is read-only in every casing", () => {
    for (const creator_type of ["job", "JOB", "Job"]) {
        const native = empaiaToNative(wireRect({ creator_type }), ctx);
        expect(native.readOnly).toBe(true);
    }
});

test("the scope's own annotations are neither attributed nor locked", () => {
    const native = empaiaToNative(wireRect({ creator_type: "scope", creator_id: "scope-1" }), ctx);
    expect(native).toBeTruthy();
    expect(native.empaiaJobId).toBe(undefined);
    expect(native.readOnly).toBe(undefined);
    // The raw value is still carried through, so the UI can say who made it.
    expect(native.empaiaCreatorType).toBe("scope");
});

test("an explicit lock still marks read-only without claiming a job made it", () => {
    const native = empaiaToNative(
        wireRect({ creator_type: "scope", creator_id: "scope-1", is_locked: true }), ctx);
    expect(native.readOnly).toBe(true);
    expect(native.empaiaJobId).toBe(undefined);
});

test("a job id is only stamped when the service actually sent one", () => {
    const native = empaiaToNative(wireRect({ creator_id: undefined }), ctx);
    expect(native.empaiaJobId).toBe(undefined);
    // Still read-only: the record says a job made it, so the scope cannot edit it.
    expect(native.readOnly).toBe(true);
});

// ── the two derived rules that share the predicate ──────────────────────────

test("hydration excludes job output in every casing", () => {
    const all = [
        { id: "a", creator_type: "JOB" },
        { id: "b", creator_type: "job" },
        { id: "c", creator_type: "Job" },
        { id: "d", creator_type: "scope" },
        { id: "e", creator_type: "user" },
    ];
    // The filter the annotations sink applies in `readBundle`: which analysis is
    // on the slide is the visibility set's decision, never hydration's.
    const hydrated = all.filter(a => !isJobCreated(a));
    expect(hydrated.map(a => a.id)).toEqual(["d", "e"]);
});

test("pixel maps are attributed to the analysis that produced them", () => {
    const maps = [
        { id: "pm-1", creator_type: "JOB", creator_id: "job-42" },
        { id: "pm-2", creator_type: "scope", creator_id: "scope-1" },
    ];
    // The mapping `registerPixelmaps` builds; without it a map can never follow
    // the analysis it belongs to and its layer never toggles.
    const byJob = new Map(maps
        .filter(m => isJobCreated(m) && m.creator_id)
        .map(m => [m.id, m.creator_id]));
    expect(byJob.get("pm-1")).toBe("job-42");
    expect(byJob.has("pm-2")).toBe(false);
});
