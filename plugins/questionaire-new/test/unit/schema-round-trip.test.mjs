/**
 * `getSchema()` → edit → `setSchema()` must not destroy the page payloads it summarized.
 *
 * A page's `scene` and `recordings` are BULK payloads: a canonical viewer scene, and tour
 * steps carrying screenshots and base64 assets. Every read path summarizes them rather than
 * handing them out — the scripting `getSchema` replaces a scene with `{captured: true, …}` and
 * each binding with a `{…, stepCount}` descriptor, which is right for a read.
 *
 * `setSchema` accepted that same shape and wrote it through. `normalizePageRecordings` drops
 * any entry with no `steps`, and `normalizeScene` turns a summary into a hollow scene with no
 * backgrounds. So the most natural edit there is — read the schema, append a page, write it
 * back — silently destroyed every page's tour and viewer setup and returned successfully.
 *
 * Observed in a live session: an assistant built a tour, bound it to page 0, then added a
 * second page by read-modify-write. The bindings were gone, nothing errored, and the user
 * found it before the tooling did ("questionaire now has no recordings bound why").
 *
 * That is precisely the degradation `strict` exists to prevent for elements; scene and
 * recordings were the hole in it.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.$ = globalThis.$ ?? { t: (key) => key.split(".").pop() };

const { preservePageOpaques, normalizeSchema } = await import("../../schema.ts");

/** A real binding: what lives on the page, with the steps that make it playable. */
const LIVE_BINDING = {
    id: "binding_1",
    slotIndex: 0,
    recordingId: "rec-1787703702288-87nqz7",
    recordingName: "Lung Pathology Case Study",
    steps: [{ narration: "Granulomas here." }, { narration: "Necrosis here." }],
    stepCount: 2,
    autoplay: false,
};

/** What `getSchema` hands a caller instead — no `steps`, so the normalizer drops it. */
const BINDING_SUMMARY = {
    id: "binding_1",
    slotIndex: 0,
    recordingId: "rec-1787703702288-87nqz7",
    recordingName: "Lung Pathology Case Study",
    stepCount: 2,
    autoplay: false,
};

const LIVE_SCENE = { version: 1, data: ["a.dzi"], background: [{ dataReference: 0 }], visualizations: [] };
const SCENE_SUMMARY = { captured: true, capturedAt: "2026-08-26T00:21:00.000Z", viewerCount: 1 };

const livePage = (over = {}) => ({
    id: "page_1",
    title: "Findings & Interpretation",
    elements: [{ id: "e1", kind: "textarea", name: "notes", label: "Notes" }],
    scene: LIVE_SCENE,
    recordings: [LIVE_BINDING],
    ...over,
});

/** The page as a caller reads it back out of `getSchema`. */
const readPage = (over = {}) => ({
    ...livePage(),
    scene: SCENE_SUMMARY,
    recordings: [BINDING_SUMMARY],
    ...over,
});

const NEW_PAGE = {
    id: "page_2",
    title: "Deep Analysis",
    elements: [{ id: "e2", kind: "textarea", name: "analysis", label: "Analysis" }],
};

// ---- the observed failure -------------------------------------------------------------

test("appending a page by read-modify-write keeps the first page's tour", { tag: ["@unit"] }, () => {
    const current = [livePage()];
    const { schema, dropped } = preservePageOpaques(
        { version: 1, title: "Case Study", pages: [readPage(), NEW_PAGE] },
        current,
    );

    expect(dropped, "nothing was lost, so nothing to report").toEqual([]);
    expect(schema.pages[0].recordings[0].steps, "the playable steps are back")
        .toEqual(LIVE_BINDING.steps);
    expect(schema.pages[0].scene, "and so is the captured scene").toEqual(LIVE_SCENE);
    expect(schema.pages[1].id, "the appended page is untouched").toBe("page_2");
});

test("the restored binding survives normalization", { tag: ["@unit"] }, () => {
    // The end-to-end statement: this is the pair that used to lose the tour.
    const { schema } = preservePageOpaques(
        { version: 1, title: "Case Study", pages: [readPage(), NEW_PAGE] },
        [livePage()],
    );
    const normalized = normalizeSchema(schema, { strict: true, authored: true });

    expect(normalized.pages[0].recordings, "normalizePageRecordings kept it").toHaveLength(1);
    expect(normalized.pages[0].recordings[0].recordingId).toBe(LIVE_BINDING.recordingId);
    expect(normalized.pages[0].recordings[0].stepCount).toBe(2);
});

test("without the reconciler the same payload loses the binding", { tag: ["@unit"] }, () => {
    // Pins the cause rather than the symptom: the summary alone does not survive, which is
    // why restoring it before normalization is the fix and not a workaround.
    const normalized = normalizeSchema(
        { version: 1, title: "Case Study", pages: [readPage(), NEW_PAGE] },
        { strict: true, authored: true },
    );

    expect(normalized.pages[0].recordings, "no steps, no binding").toBeUndefined();
});

// ---- clearing stays possible, and explicit ---------------------------------------------

test("an empty array is an explicit clear, not an echo", { tag: ["@unit"] }, () => {
    const { schema } = preservePageOpaques(
        { version: 1, pages: [readPage({ recordings: [] })] },
        [livePage()],
    );

    expect(schema.pages[0].recordings, "the caller said none").toEqual([]);
});

test("scene: null clears the captured scene", { tag: ["@unit"] }, () => {
    const { schema } = preservePageOpaques(
        { version: 1, pages: [readPage({ scene: null })] },
        [livePage()],
    );

    expect(schema.pages[0].scene ?? null).toBeNull();
});

test("omission preserves, because a dropped tour is unrecoverable", { tag: ["@unit"] }, () => {
    // The asymmetry is deliberate. A preserved tour the caller did not want is one
    // `unbindPageRecording` away; a dropped one is gone, because the binding embeds the only
    // copy of the snapshot.
    const page = readPage();
    delete page.recordings;
    delete page.scene;

    const { schema } = preservePageOpaques({ version: 1, pages: [page] }, [livePage()]);

    expect(schema.pages[0].recordings[0].steps).toEqual(LIVE_BINDING.steps);
    expect(schema.pages[0].scene).toEqual(LIVE_SCENE);
});

// ---- what cannot be carried is reported, never silently dropped -------------------------

test("a binding whose page is gone is reported", { tag: ["@unit"] }, () => {
    const { schema, dropped } = preservePageOpaques(
        { version: 1, pages: [{ ...readPage(), id: "page_renamed" }] },
        [livePage()],
    );

    expect(dropped, "one binding could not be matched to a live page").toHaveLength(1);
    expect(dropped[0]).toEqual({
        pageId: "page_renamed",
        slotIndex: 0,
        recordingName: "Lung Pathology Case Study",
    });
    expect(schema.pages[0].recordings[0].steps, "and it is still payload-less").toBeUndefined();
});

test("a re-bound slot restores what the slot holds NOW", { tag: ["@unit"] }, () => {
    // The slot was re-bound between the read and the write, so the summary names a tour that
    // is no longer there. Two answers are available: hand back whatever the slot holds now, or
    // leave the entry payload-less and let normalization delete it. The second destroys a
    // binding the caller never asked to remove — and there is no stale payload to resurrect
    // either way, because a summary carries no steps.
    const rebound = { ...LIVE_BINDING, recordingId: "rec-newer", recordingName: "Newer tour" };
    const { schema, dropped } = preservePageOpaques(
        { version: 1, pages: [readPage()] },
        [livePage({ recordings: [rebound] })],
    );

    expect(schema.pages[0].recordings[0].recordingId, "the current binding, not the echoed one")
        .toBe("rec-newer");
    expect(schema.pages[0].recordings[0].steps, "and it is playable").toEqual(rebound.steps);
    expect(dropped, "nothing was lost — `dropped` means lost, not merely changed").toEqual([]);
});

test("the exact tour wins over the slot when both are present", { tag: ["@unit"] }, () => {
    // Two bindings on one page. Matching by slot alone would be ambiguous here; the recording
    // id names which one the caller echoed.
    const second = {
        ...LIVE_BINDING,
        id: "binding_2", slotIndex: 1,
        recordingId: "rec-second", recordingName: "Second tour",
        steps: [{ narration: "Elsewhere." }],
    };
    const { schema } = preservePageOpaques(
        { version: 1, pages: [readPage({ recordings: [{ ...BINDING_SUMMARY, slotIndex: 1, recordingId: "rec-second" }] })] },
        [livePage({ recordings: [LIVE_BINDING, second] })],
    );

    expect(schema.pages[0].recordings[0].recordingId).toBe("rec-second");
    expect(schema.pages[0].recordings[0].steps).toEqual(second.steps);
});

// ---- the reconciler must not disturb the paths that carry real payloads -----------------

test("a real payload passes through untouched", { tag: ["@unit"] }, () => {
    // `addPage` / `addElement` / the import path all re-apply the LIVE schema, which carries
    // real steps and a real scene. Those must not be rewritten.
    const { schema, dropped } = preservePageOpaques(
        { version: 1, pages: [livePage()] },
        [livePage()],
    );

    expect(dropped).toEqual([]);
    expect(schema.pages[0].recordings[0]).toEqual(LIVE_BINDING);
    expect(schema.pages[0].scene).toEqual(LIVE_SCENE);
});

test("a first-time author with no current schema is unaffected", { tag: ["@unit"] }, () => {
    const next = { version: 1, title: "New", pages: [NEW_PAGE] };

    expect(preservePageOpaques(next, []).schema, "nothing to preserve from").toBe(next);
    expect(preservePageOpaques(next, undefined).schema).toBe(next);
});

test("pages without ids are left alone", { tag: ["@unit"] }, () => {
    const anonymous = { title: "No id", elements: [] };
    const { schema, dropped } = preservePageOpaques(
        { version: 1, pages: [anonymous] },
        [livePage()],
    );

    expect(dropped).toEqual([]);
    expect(schema.pages[0]).toBe(anonymous);
});

test("a non-schema payload is returned as-is rather than throwing", { tag: ["@unit"] }, () => {
    // `normalizeSchema` owns the refusal, and it names the offending field. This runs first,
    // so it must not pre-empt that with an error of its own.
    for (const bad of [null, undefined, "nope", 42, {}, { pages: "no" }]) {
        expect(preservePageOpaques(bad, [livePage()]).schema, JSON.stringify(bad) ?? "undefined")
            .toBe(bad);
    }
});
