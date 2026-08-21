/**
 * Turning an EMPAIA refusal into a sentence, and attributing output without
 * depending on `creator_type`.
 *
 * Both pin defects a user actually met: a delete of a job-locked region showed
 * the toast `{"detail":"Annotation is locked"}` — the serialized body, because
 * the unwrap only knew `detail` as a string or `{cause}` — and result
 * attribution rested entirely on a `creator_type` whose wire casing is not the
 * schema's.
 */
import { test, expect } from "@xopat/test-harness";

const { detailOf, describeRemoteError } = await import("../../errors.ts");
const { empaiaToNative } = await import("../../convertor.ts");

const bodied = (body) => ({ textData: JSON.stringify(body), statusCode: 423 });

test("the backend's sentence is read out of every shape it arrives in", () => {
    expect(detailOf(bodied({ detail: "Annotation is locked" }))).toBe("Annotation is locked");
    expect(detailOf(bodied({ detail: { cause: "Job has wrong state: ERROR" } })))
        .toBe("Job has wrong state: ERROR");
    // The shape that produced the raw-JSON toast.
    expect(detailOf(bodied({ detail: { detail: "Annotation is locked" } })))
        .toBe("Annotation is locked");
});

test("a body with no sentence in it yields the caller's message, never JSON", () => {
    const shapeless = bodied({ detail: { loc: ["body", 0], ctx: {} } });
    expect(detailOf(shapeless)).toBe(undefined);
    expect(describeRemoteError(shapeless, "Could not delete.")).toBe("Could not delete.");

    // Not JSON at all (a proxy error page) and no body: same rule.
    expect(detailOf({ textData: "<html>502</html>" })).toBe(undefined);
    expect(detailOf({})).toBe(undefined);
});

// ── attribution without creator_type ────────────────────────────────────────

const wire = (over = {}) => ({
    id: "ann-1", type: "rectangle", upper_left: [0, 0], width: 4, height: 4,
    creator_id: "job-42", creator_type: "SoMeThInG_eLsE", ...over,
});

test("a creator_id the module knows as an analysis attributes the annotation", () => {
    const ctx = { slideId: "slide-1", isJobId: (id) => id === "job-42" };
    const native = empaiaToNative(wire(), ctx);
    expect(native.empaiaJobId).toBe("job-42");
    expect(native.readOnly).toBe(true);
});

test("an unknown creator_id with an unknown creator_type is the user's own work", () => {
    const ctx = { slideId: "slide-1", isJobId: () => false };
    const native = empaiaToNative(wire({ creator_id: "scope-1" }), ctx);
    expect(native.empaiaJobId).toBe(undefined);
    expect(native.readOnly).toBe(undefined);
});
