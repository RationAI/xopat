/**
 * A namespace that no intent hint matches stays in the prompt's compact tier — method
 * names only, description cut to 400 characters — until a call fails and expands it.
 *
 * `questionnaire`, `recorder` and `measurements` had no hint at all, so "create a
 * questionnaire + a recording narrative" documented neither of the two namespaces the
 * task was entirely about. The model read `bindPageTour` from the questionnaire's
 * name list and called it on `recorder`.
 *
 * These vectors pin the routing, not the regexes: each phrase is one a user actually
 * types for that feature.
 */
import { test, expect } from "@xopat/test-harness";

const { NAMESPACE_INTENT_HINTS } = await (async () => {
    // The module is a plugin bundle with heavy globals; the hint table is a pure static,
    // so read it out of the source rather than importing the whole ChatModule.
    const fs = await import("node:fs/promises");
    const url = new URL("../../chat.ts", import.meta.url);
    const source = await fs.readFile(url, "utf8");
    const start = source.indexOf("static NAMESPACE_INTENT_HINTS");
    const open = source.indexOf("{", start);
    let depth = 0, end = -1;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    const body = source.slice(open, end + 1);
    // eslint-disable-next-line no-new-func
    return { NAMESPACE_INTENT_HINTS: new Function(`return ${body}`)() };
})();

/** What `applyIntentExpansionHints` does, minus the consent lookup it guards with. */
function hits(text) {
    return Object.entries(NAMESPACE_INTENT_HINTS)
        .filter(([, re]) => re.test(text))
        .map(([ns]) => ns)
        .sort();
}

test("the namespaces a task is about are hinted", () => {
    // The exact request from the session that failed.
    const asked = hits("create a questionnaire + recording narrative from the findings for a potential student");
    expect(asked).toContain("questionnaire");
    expect(asked).toContain("recorder");

    expect(hits("do it in screen recorder and the questionaire plugin")).toContain("recorder");
    expect(hits("build a short survey about this slide")).toContain("questionnaire");
    expect(hits("record a guided tour of the tumour regions")).toContain("recorder");
    expect(hits("add a narrated walkthrough")).toContain("recorder");
    expect(hits("how far apart are these nuclei in microns?")).toContain("measurements");
    expect(hits("measure the lesion diameter")).toContain("measurements");
});

test("hints that already existed still route", () => {
    expect(hits("outline the tumour and annotate it")).toContain("annotationsWrite");
    expect(hits("the overlay is too dark")).toContain("visualization");
    expect(hits("explore the slide for invasive carcinoma")).toContain("pathology");
});

test("every hint entry is a case-insensitive regex", () => {
    for (const [ns, re] of Object.entries(NAMESPACE_INTENT_HINTS)) {
        expect(re, ns).toBeInstanceOf(RegExp);
        expect(re.flags, ns).toContain("i");
        // A global regex would carry lastIndex between turns and match every other call.
        expect(re.flags, ns).not.toContain("g");
    }
});

test("no hint exists for the sensitive namespace", () => {
    // `patient` docs enter the prompt only after a consent-gated call or an explicit
    // describe — a keyword must never pull them in.
    expect(NAMESPACE_INTENT_HINTS.patient).toBeUndefined();
});
