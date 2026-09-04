/**
 * What can be done with a selected annotation.
 *
 * The verdict used to be a single "eligible" flag, and it answered "is it
 * locked?" before "can it be analysed?". That inversion made a region an earlier
 * analysis had consumed drop silently out of every offer — the user selected it,
 * nothing was offered, and nothing said why.
 *
 * The lock is delete/update-scoped: every guard in the repo tests exactly
 * `pre-delete` / `pre-update`, and `POST /collections/{id}/items` has no lock
 * precheck. So locked means "cannot be edited", never "cannot be analysed", and
 * these tests pin that apart.
 */
import { test, expect } from "@xopat/test-harness";

const { describeRegion, refusalGroups } =
    await import("../../sections/region-eligibility.mjs");

const ROI_PRESET = "empaia:roi";

/** A context where nothing is locked, nothing is job output, rect is accepted. */
function contextWith({ locked = {}, jobOwned = new Set(), rows = {} } = {}) {
    return {
        roiTypeOf: (o) => (o?.factoryID === "rect" ? "rectangle" : undefined),
        isJobOwned: (o) => jobOwned.has(o?.incrementId),
        lockingJobFor: (o) => locked[o?.incrementId],
        roiPresetId: ROI_PRESET,
        rowFor: (incrementId) => rows[incrementId],
        labelOf: (o) => `rect #${o?.incrementId}`,
    };
}

const roi = (incrementId, extra = {}) =>
    ({ incrementId, factoryID: "rect", presetID: ROI_PRESET, ...extra });

test("a stored region of interest is analysable", () => {
    const v = describeRegion(roi(1, { empaiaId: "a" }), contextWith());
    expect(v.analysable).toBe(true);
    expect(v.convertible).toBe(false);
    expect(v.empaiaId).toBe("a");
    expect(v.reasonKey).toBe(undefined);
    expect(v.roiType).toBe("rectangle");
});

test("a LOCKED region of interest is still analysable — the lock is edit-scoped", () => {
    const v = describeRegion(
        roi(1, { empaiaId: "a" }),
        contextWith({ locked: { 1: "job-7" } }));

    // The regression this whole change exists for: locked used to mean
    // `eligible: false` with no offer and no explanation.
    expect(v.analysable).toBe(true);
    expect(v.empaiaId).toBe("a");
    expect(v.reasonKey).toBe(undefined);
    // Reported as an attribute so the row can say "editing is what you lost".
    expect(v.lockedBy).toBe("job-7");
    // But it may NOT be converted — conversion is a preset change, i.e. an update.
    expect(v.convertible).toBe(false);
});

test("a lock with an unknown holder still does not block analysis", () => {
    // "" is the id learned from a bare backend refusal — a real lock, no name.
    const v = describeRegion(roi(1, { empaiaId: "a" }), contextWith({ locked: { 1: "" } }));
    expect(v.analysable).toBe(true);
    expect(v.lockedBy).toBe("");
});

test("a locked annotation that is NOT a region of interest cannot be converted", () => {
    const v = describeRegion(
        { incrementId: 2, factoryID: "rect", presetID: "user-preset", empaiaId: "b" },
        contextWith({ locked: { 2: "job-7" } }));
    expect(v.analysable).toBe(false);
    expect(v.convertible).toBe(false);
    expect(v.reasonKey).toBe("roi.lockedNotConvertible");
});

test("job output is neither, and says so", () => {
    const v = describeRegion(
        { incrementId: 3, factoryID: "rect", presetID: "cls-tumor", empaiaId: "c" },
        contextWith({ jobOwned: new Set([3]) }));
    expect(v.analysable).toBe(false);
    expect(v.convertible).toBe(false);
    expect(v.reasonKey).toBe("roi.jobOwned");
});

test("a shape the app does not declare is refused before anything else", () => {
    // Shape comes first because it is the one condition no action can repair —
    // offering "mark as region of interest" for a polygon under a rectangle-only
    // app produces a job the backend rejects at input validation.
    const v = describeRegion(
        { incrementId: 4, factoryID: "polygon", presetID: "user-preset" },
        contextWith({ locked: { 4: "job-7" }, jobOwned: new Set([4]) }));
    expect(v.reasonKey).toBe("roi.wrongShape");
    expect(v.analysable).toBe(false);
    expect(v.convertible).toBe(false);
});

test("a matching shape with someone else's preset is convertible", () => {
    const v = describeRegion(
        { incrementId: 5, factoryID: "rect", presetID: "user-preset" },
        contextWith());
    expect(v.convertible).toBe(true);
    expect(v.analysable).toBe(false);
    expect(v.reasonKey).toBe("roi.notRoiPreset");
});

test("a region of interest without a server id reports waiting, not refusal", () => {
    const saving = describeRegion(roi(6), contextWith({ rows: { 6: { pending: true } } }));
    expect(saving.reasonKey).toBe("roi.stillSaving");
    expect(saving.convertible).toBe(false);

    const failed = describeRegion(roi(7), contextWith({ rows: { 7: { pending: false } } }));
    expect(failed.reasonKey).toBe("roi.notStoredCount");
});

test("the row's id wins over the object's, and either will do", () => {
    const fromRow = describeRegion(roi(8), contextWith({ rows: { 8: { empaiaId: "row" } } }));
    expect(fromRow.empaiaId).toBe("row");

    const fromObject = describeRegion(roi(9, { empaiaId: "obj" }), contextWith());
    expect(fromObject.empaiaId).toBe("obj");
});

test("refusalGroups collapses by reason, most common first", () => {
    const groups = refusalGroups([
        { reasonKey: "roi.jobOwned" },
        { reasonKey: "roi.wrongShape" },
        { reasonKey: "roi.jobOwned" },
        { reasonKey: "roi.jobOwned" },
        { reasonKey: "roi.wrongShape" },
    ]);
    expect(groups.map(g => [g.reasonKey, g.count]))
        .toEqual([["roi.jobOwned", 3], ["roi.wrongShape", 2]]);
});

test("refusalGroups carries the locking analysis and ignores verdicts with no reason", () => {
    const groups = refusalGroups([
        { reasonKey: "roi.lockedNotConvertible", lockedBy: "job-7" },
        { analysable: true },
        undefined,
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0].lockedBy).toBe("job-7");
    expect(refusalGroups([])).toEqual([]);
    expect(refusalGroups(undefined)).toEqual([]);
});

// ── drawing a region is not running an app ─────────────────────────────────

const { drawRefusal, runRefusal } = await import("../../sections/region-eligibility.mjs");

/** Identity `t`, so a returned key is visible as itself in the assertion. */
const runCtx = (over = {}) => ({
    ready: true, blockers: [], roiTypes: ["rectangle"], roiMode: "single",
    t: (key) => key, ...over,
});

test("an app that cannot RUN can still be DRAWN on", () => {
    // The regression. TA09 declares a slide *collection*, so it can never be
    // started here — but a region is a scope-owned annotation with a flag, stored
    // without the EAD being consulted, so drawing one is always allowed. Gating
    // this on `runBlockers` put a sentence about SLIDES on three region-shaped
    // surfaces.
    const blocker = "This app analyses several slides in one run, which this viewer cannot do.";
    expect(drawRefusal({ ready: true, t: (key) => key })).toBe(undefined);
    expect(runRefusal(runCtx({ blockers: [blocker], roiTypes: [] }))).toBe(blocker);
});

test("drawing is refused only when there is no session to store into", () => {
    // No client and no slide id means the annotation cannot be persisted at all —
    // the one condition that genuinely stops a region existing.
    expect(drawRefusal({ ready: false, t: (key) => key })).toBe("roi.quickModeNotReady");
});

test("an app declaring no usable region input still allows drawing", () => {
    expect(drawRefusal({ ready: true, t: (key) => key })).toBe(undefined);
    // …while running is refused, and says the region-shaped thing.
    expect(runRefusal(runCtx({ roiTypes: [] }))).toBe("jobs.noRoiInput");
});

test("runRefusal keeps every case the merged version had", () => {
    expect(runRefusal(runCtx())).toBe(undefined);
    expect(runRefusal(runCtx({ ready: false, blockers: ["x"], roiTypes: [] })))
        .toBe("roi.quickModeNotReady");
    // A blocker outranks the vaguer statement of the same fact.
    expect(runRefusal(runCtx({ blockers: ["blocked"] }))).toBe("blocked");
    // The one-region promise is the quick mode's alone.
    expect(runRefusal(runCtx({ roiMode: "multiple" }))).toBe(undefined);
    expect(runRefusal(runCtx({ roiMode: "multiple", singleOnly: true })))
        .toBe("roi.quickModeSingleOnly");
});

test("no region input is not the shape's fault", () => {
    // "This shape is not accepted" is untrue when no shape would be. The two
    // facts wore one sentence, which is the same misreading as quoting a slide
    // blocker at a region surface.
    const base = {
        roiTypeOf: () => undefined,
        isJobOwned: () => false,
        lockingJobFor: () => undefined,
        roiPresetId: ROI_PRESET,
        rowFor: () => undefined,
        labelOf: () => "r",
    };
    const object = { incrementId: 1, factoryID: "rect", presetID: "other" };

    expect(describeRegion(object, { ...base, hasRoiInput: () => false }).reasonKey)
        .toBe("roi.noRoiInput");
    expect(describeRegion(object, { ...base, hasRoiInput: () => true }).reasonKey)
        .toBe("roi.wrongShape");
    // No `hasRoiInput` at all keeps the old answer, so an unmigrated caller does
    // not silently start blaming the app.
    expect(describeRegion(object, base).reasonKey).toBe("roi.wrongShape");
});
