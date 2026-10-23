/**
 * `normalizeSchema` has two callers with opposite needs.
 *
 * The designer and the undo stack must always end up with SOME form on screen,
 * so an unrecognized field degrades to a plain text box. A programmatic author
 * — the scripting API, and through it the chat model — must not: a schema of
 * four choice questions came back as four blank text boxes while `setSchema`
 * reported success, so nothing on either side had anything to correct. The
 * payload below is the one that actually shipped that failure: SurveyJS shapes
 * (`type` / `title` / `choices`), which is what a model writes unprompted.
 */
import { test, expect } from "@xopat/test-harness";

// The module reaches for the app's i18n global when building a refusal's
// user-facing sentence.
globalThis.window = globalThis.window ?? globalThis;
globalThis.$ = globalThis.$ ?? { t: (key) => key.split(".").pop() };

const { normalizeSchema, QuestionnaireSchemaError, QUESTIONNAIRE_ELEMENT_KINDS, assertUsableElement } =
    await import("../../schema.ts");

/** Verbatim shape from the session that motivated this test. */
const SURVEYJS_PAYLOAD = {
    version: 1,
    title: "Prostate Slide Review",
    pages: [{
        title: "Slide Findings",
        elements: [
            { type: "html", name: "intro", html: "<p>H&E-stained prostate biopsy.</p>" },
            {
                type: "radiogroup",
                name: "cancerAssessment",
                title: "Can cancer be assessed at this magnification?",
                choices: [
                    { value: "not_assessable", text: "Not assessable" },
                    { value: "yes", text: "Yes" },
                ],
            },
            { type: "rating", name: "glandularExtent", title: "Extent of glandular tissue", min: 1, max: 5 },
            { type: "comment", name: "studentNotes", title: "Your observations" },
        ],
    }],
};

/** The same questionnaire, written in this schema's own vocabulary. */
const NATIVE_PAYLOAD = {
    version: 1,
    title: "Prostate Slide Review",
    pages: [{
        title: "Slide Findings",
        elements: [
            { kind: "content", name: "intro", text: "H&E-stained prostate biopsy." },
            {
                kind: "radio",
                name: "cancer_assessment",
                label: "Can cancer be assessed at this magnification?",
                options: [
                    { value: "not_assessable", label: "Not assessable" },
                    { value: "yes", label: "Yes" },
                ],
            },
            { kind: "rating", name: "glandular_extent", label: "Extent of glandular tissue", maxRating: 5 },
            { kind: "textarea", name: "student_notes", label: "Your observations" },
        ],
    }],
};

test("strict refuses the SurveyJS shape and names the edit to make", () => {
    let error = null;
    try {
        normalizeSchema(SURVEYJS_PAYLOAD, { strict: true });
    } catch (e) {
        error = e;
    }
    expect(error).toBeInstanceOf(QuestionnaireSchemaError);
    // Which field, on which page — the first offending one.
    expect(error.message).toContain('element 1 on page "Slide Findings"');
    expect(error.message).toContain('"kind"');
    expect(error.message).toContain('"type": "html"');
    // The rename table, and the equivalent kind, so one turn is enough to fix.
    expect(error.message).toContain('"type" -> "kind"');
    expect(error.message).toContain('kind: "content"');
    // And a translated sentence for the user, not the technical one.
    expect(typeof error.userMessage).toBe("string");
    expect(error.userMessage.length).toBeGreaterThan(0);
    expect(error.userMessage).not.toContain("SurveyJS");
});

test("strict names the equivalent kind for a recognizable foreign type", () => {
    const payload = {
        version: 1,
        pages: [{ title: "P", elements: [{ type: "radiogroup", choices: [] }] }],
    };
    let error = null;
    try { normalizeSchema(payload, { strict: true }); } catch (e) { error = e; }
    expect(error.message).toContain('A SurveyJS "radiogroup" is kind: "radio" here.');
    expect(error.message).toContain('"choices" -> "options"');
});

test("strict rejects an unknown kind and lists the valid ones", () => {
    const payload = { version: 1, pages: [{ title: "P", elements: [{ kind: "slider", label: "x" }] }] };
    let error = null;
    try { normalizeSchema(payload, { strict: true }); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(QuestionnaireSchemaError);
    expect(error.message).toContain('unknown kind "slider"');
    for (const kind of ["text", "radio", "content", "matrix"]) {
        expect(error.message).toContain(kind);
    }
});

test("an authoring caller is refused a choice field with nothing to choose", () => {
    const noOptions = { version: 1, pages: [{ title: "P", elements: [{ kind: "radio", label: "x" }] }] };
    expect(() => normalizeSchema(noOptions, { strict: true, authored: true })).toThrow(/no "options"/);

    const noText = { version: 1, pages: [{ title: "P", elements: [{ kind: "content" }] }] };
    expect(() => normalizeSchema(noText, { strict: true, authored: true })).toThrow(/no "text"/);
});

test("importing a saved file is not blocked by an incomplete field", () => {
    // A form whose author emptied a select's options in the designer must still
    // open — refusing the file would lock them out of fixing it. Only the KIND
    // check is structural enough to refuse an import.
    const incomplete = { version: 1, pages: [{ title: "P", elements: [{ kind: "radio", label: "x" }] }] };
    const schema = normalizeSchema(incomplete, { strict: true });
    expect(schema.pages[0].elements[0].kind).toBe("radio");
    expect(schema.pages[0].elements[0].options).toEqual([]);

    // A field whose kind was never understood is still refused on import.
    const foreign = { version: 1, pages: [{ title: "P", elements: [{ type: "radiogroup" }] }] };
    expect(() => normalizeSchema(foreign, { strict: true })).toThrow(/"kind"/);
});

test("a legacy content element carrying html instead of text still imports", () => {
    const legacy = { version: 1, pages: [{ title: "P", elements: [{ kind: "content", html: "<p>hi</p>" }] }] };
    const schema = normalizeSchema(legacy, { strict: true, authored: true });
    expect(schema.pages[0].elements[0].text).toBe("hi");
});

test("strict rejects a page that is not { title, elements }", () => {
    const payload = { version: 1, pages: [{ title: "P" }] };
    expect(() => normalizeSchema(payload, { strict: true })).toThrow(/page 1 has no "elements"/);
});

test("the native shape normalizes to the fields it asks for", () => {
    const schema = normalizeSchema(NATIVE_PAYLOAD, { strict: true });
    const kinds = schema.pages[0].elements.map((e) => e.kind);
    expect(kinds).toEqual(["content", "radio", "rating", "textarea"]);

    const radio = schema.pages[0].elements[1];
    expect(radio.label).toBe("Can cancer be assessed at this magnification?");
    expect(radio.options.map((o) => o.value)).toEqual(["not_assessable", "yes"]);
    expect(schema.pages[0].elements[2].maxRating).toBe(5);
    expect(schema.pages[0].elements[0].text).toBe("H&E-stained prostate biopsy.");
});

test("the lenient path still degrades instead of throwing", () => {
    // The designer and undo must always have a form to render.
    const schema = normalizeSchema(SURVEYJS_PAYLOAD);
    const kinds = schema.pages[0].elements.map((e) => e.kind);
    expect(kinds).toEqual(["text", "text", "text", "text"]);
});

test("assertUsableElement accepts every declared kind", () => {
    const sample = {
        select: { options: [{ value: "a", label: "A" }] },
        multiselect: { options: [{ value: "a", label: "A" }] },
        radio: { options: [{ value: "a", label: "A" }] },
        content: { text: "hello" },
    };
    for (const kind of QUESTIONNAIRE_ELEMENT_KINDS) {
        expect(() => assertUsableElement({ kind, ...(sample[kind] || {}) }, "P", 0)).not.toThrow();
    }
});
