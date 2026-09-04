/**
 * Submit hands in a filled form; Export hands over session state; the toolbar's
 * Save form hands over a blank form. Three documents, and mixing them up is how
 * this plugin lost data in both directions.
 *
 * Before: Submit flushed the SAME `bundle-export` capability the session channel
 * uses, so it could not be routed anywhere else, and with nothing bound it
 * resolved to `[]` — no toast, no file, no error. The button did nothing and
 * said nothing. Meanwhile the toolbar's Export shipped every case's answers
 * inside what an author reasonably read as "the form".
 *
 * The regression that matters in the other direction: the STATE bundle must keep
 * carrying answers. It is what a session save/share writes, so stripping them to
 * make Export "clean" would silently empty every in-progress form that travels
 * between machines.
 *
 * Validation is here too: only the current page used to be checked, so a
 * respondent who stepped back and cleared a required field on page 1 could
 * still submit from page 3.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.$ = globalThis.$ ?? { t: (key) => String(key).split(".").pop() };
globalThis.XOpatPlugin = globalThis.XOpatPlugin ?? class XOpatPlugin {};

const module = await import("../../plugin.ts");
const QuestionnairePlugin = module.default
    ?? Object.values(module).find((v) => typeof v === "function" && v.prototype?._requirePage);

const GLOBAL_SLOT = "__global__";

const SCHEMA = {
    version: 1,
    id: "grading-v3",
    title: "Grading",
    pages: [
        { id: "page_1", title: "Case", elements: [{ id: "e1", kind: "text", name: "caseId", label: "Case", validation: { required: true } }] },
        { id: "page_2", title: "Score", elements: [{ id: "e2", kind: "text", name: "score", label: "Score", validation: { required: true } }] },
    ],
};

/**
 * A plugin stub carrying only what the payload builders and the page walker
 * read. The class itself needs the whole app to construct.
 */
function pluginWith({ answers = {}, slotKey = GLOBAL_SLOT, can = () => true } = {}) {
    const instance = Object.create(QuestionnairePlugin.prototype);
    instance._schema = structuredClone(SCHEMA);
    instance._answers = answers;
    instance._answersBySlot = new Map([[slotKey, answers]]);
    instance._slotKey = slotKey;
    instance._isExported = false;
    instance._currentPage = 0;
    instance.can = can;
    // Draft persistence is a cache write; irrelevant to the document shape.
    instance.flushDraftSave = () => {};
    return instance;
}

const FILLED = { caseId: "C-1", score: "3" };

// ── the submission document ──────────────────────────────────────────────────

test("a submission carries the answers and a schema IDENTITY, not the schema", () => {
    // Re-shipping the whole definition with every response is what makes a
    // submission store unable to group by form without comparing kilobytes.
    const plugin = pluginWith({ answers: FILLED });
    const payload = plugin._buildSubmissionPayload();

    expect(payload.answers).toEqual(FILLED);
    expect(payload.schema).toEqual({ id: "grading-v3", title: "Grading", version: 1 });
    expect(payload.schema.pages).toBeUndefined();
    expect(payload.slotKey).toBe(GLOBAL_SLOT);
    expect(typeof payload.submittedAt).toBe("string");
});

test("a submission is ONE slot, not every case the browser has open", () => {
    const plugin = pluginWith({ answers: { score: "5" }, slotKey: "viewer-1::slide-a" });
    plugin._answersBySlot.set("viewer-2::slide-b", { score: "1" });

    const payload = plugin._buildSubmissionPayload();

    expect(payload.answers).toEqual({ score: "5" });
    expect(payload.viewerId).toBe("viewer-1");
    expect(payload.backgroundId).toBe("slide-a");
});

test("the submission answers are a copy — a later edit cannot rewrite what was sent", () => {
    const answers = { caseId: "C-1" };
    const plugin = pluginWith({ answers });
    const payload = plugin._buildSubmissionPayload();
    answers.caseId = "C-999";
    expect(payload.answers.caseId).toBe("C-1");
});

// ── the template document ────────────────────────────────────────────────────

test("the template is the blank form and never leaks answers", () => {
    // An author handing a form to respondents must not be able to ship somebody
    // else's fills with it by forgetting a capability.
    const plugin = pluginWith({ answers: FILLED });
    const payload = plugin._buildTemplatePayload();

    expect(payload.schema.pages).toHaveLength(2);
    expect(payload.answers).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("C-1");
});

// ── the state document (the anti-regression) ─────────────────────────────────

test("the STATE bundle still carries answers, so a session save keeps them", () => {
    const plugin = pluginWith({ answers: FILLED });
    const payload = plugin._buildExportPayload();

    expect(payload.schema.pages).toHaveLength(2);
    expect(payload.answers[GLOBAL_SLOT]).toEqual(FILLED);
    expect(payload.activeSlot).toBe(GLOBAL_SLOT);
});

test("the state bundle drops answers only when the capability denies them", () => {
    const plugin = pluginWith({
        answers: FILLED,
        can: (id) => id !== "questionaire.export.answers",
    });
    const payload = plugin._buildExportPayload();
    expect(payload.answers).toBeUndefined();
    expect(payload.schema.pages).toHaveLength(2);
});

// ── validation across every page ─────────────────────────────────────────────

test("an invalid EARLIER page blocks submission, and is named", () => {
    const plugin = pluginWith({ answers: { score: "3" } }); // page 1 required field missing
    const invalid = plugin._firstInvalidPage();

    expect(invalid).toBeTruthy();
    expect(invalid.page.id).toBe("page_1");
    expect(invalid.pos).toBe(0);
    expect(Object.keys(invalid.errors)).toContain("caseId");
});

test("a fully answered form has no invalid page", () => {
    const plugin = pluginWith({ answers: FILLED });
    expect(plugin._firstInvalidPage()).toBeNull();
});

test("a page hidden by a condition is not required to be valid", () => {
    // A respondent cannot answer what a branch never showed them.
    const plugin = pluginWith({ answers: { caseId: "C-1" } });
    plugin._schema.pages[1].visibleWhen = { op: "eq", field: "caseId", value: "SOMETHING-ELSE" };
    expect(plugin._firstInvalidPage()).toBeNull();
});
