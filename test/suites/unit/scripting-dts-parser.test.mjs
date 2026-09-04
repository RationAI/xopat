/**
 * The scripting `.d.ts` parser feeds two model-facing surfaces: the per-method
 * signatures in `describeScriptingApi`, and the "Exact signatures of the API
 * methods your script referenced" block the chat host sends back after a failed
 * script.
 *
 * It used to drop any interface member preceded by a `// ---- section ----`
 * header. Members are split on `;`, so the header travels with the member that
 * FOLLOWS it, and both the doc-comment match and the signature match are
 * anchored at the start — so the member matched neither and was skipped
 * silently. The model was then told `captureFrame() => void — Executes the
 * captureFrame operation.` for a fully documented method, and corrected a call
 * it had no signature for. The recorder and questionnaire namespaces both use
 * those headers; `recorder.captureFrame` is the one that cost a real session.
 */
import { test, expect } from "@xopat/test-harness";

// The module is a browser script; give it the globals it touches at load time.
globalThis.window = globalThis.window ?? globalThis;
globalThis.window.APPLICATION_CONTEXT = globalThis.window.APPLICATION_CONTEXT ?? {
    getOption: (key, def) => def,
};

const { ScriptingManager, stripLeadingLineComments } =
    await import("../../../src/classes/scripting-manager.ts");

/** The shape `parseDtsForApi` reads off an API instance, with no manager built. */
function parse(dts, namespace = "sample") {
    const parser = Object.create(ScriptingManager.prototype);
    return parser.parseDtsForApi({ namespace }, dts);
}

/** A miniature of the real recorder d.ts: section headers between members. */
const SECTIONED_DTS = `
export type StepInfo = { id: string; index: number };
export type StepTiming = { duration?: number };

export interface SampleScriptApi {
    // ---- recordings ----

    /** List the viewer's recordings. */
    listRecordings(): StepInfo[];

    createRecording(name?: string): StepInfo;

    // ---- steps ----

    /**
     * Capture the current view as a new keyframe step.
     *
     * Capturing without having moved is an ERROR.
     */
    captureFrame(timing?: StepTiming): StepInfo;

    /** Append a timing-only hold. */
    captureHold(timing?: StepTiming): StepInfo;

    // ---- playback ----

    play(): StepInfo;
}
`;

test("members after a // section header keep their signature and docs", () => {
    const parsed = parse(SECTIONED_DTS);

    // Every member, not just the ones that happened to follow another member.
    expect(Object.keys(parsed.tsSignature).sort()).toEqual(
        ["captureFrame", "captureHold", "createRecording", "listRecordings", "play"]
    );

    // The section header must not survive into the signature the model reads.
    expect(parsed.tsSignature.captureFrame).toBe("captureFrame(timing?: StepTiming): StepInfo");
    expect(parsed.tsSignature.captureFrame).not.toContain("//");
    expect(parsed.tsDeclaration.captureFrame).toBe("captureFrame(timing?: StepTiming): StepInfo;");
    expect(parsed.returnType.captureFrame).toBe("StepInfo");
    expect(parsed.params.captureFrame).toEqual([{ name: "timing", type: "StepTiming" }]);

    // The doc block behind the header is the one that reaches the model.
    expect(parsed.docs.captureFrame).toContain("Capture the current view");
    expect(parsed.docs.captureFrame).not.toContain("----");

    // An undocumented member still parses; the header before it is not its doc.
    expect(parsed.tsSignature.createRecording).toBe("createRecording(name?: string): StepInfo");
    expect(parsed.docs.listRecordings).toContain("List the viewer's recordings");
    expect(parsed.tsSignature.play).toBe("play(): StepInfo");
});

test("members without section headers are unaffected", () => {
    const parsed = parse(`
export interface SampleScriptApi {
    /** Plain one. */
    alpha(a: string): number;
    beta(): void;
}
`);
    expect(parsed.tsSignature.alpha).toBe("alpha(a: string): number");
    expect(parsed.docs.alpha).toContain("Plain one");
    expect(parsed.tsSignature.beta).toBe("beta(): void");
});

test("a member the parser cannot read is reported, not silently degraded", () => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
        // A call-shaped member with no return type: matches "looks like a
        // method" but not the full signature grammar.
        parse(`
export interface SampleScriptApi {
    /** Fine. */
    good(a: string): number;
    broken(a: string)
}
`);
    } finally {
        console.warn = original;
    }
    expect(warnings.join("\n")).toContain("broken");
});

test("properties do not produce a warning", () => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
        parse(`
export interface SampleScriptApi {
    /** A plain property, legitimately not a method. */
    readonly version: number;
    good(): void;
}
`);
    } finally {
        console.warn = original;
    }
    expect(warnings).toEqual([]);
});

test("stripLeadingLineComments removes only leading // lines", () => {
    expect(stripLeadingLineComments("// a\n// b\nfoo(): void")).toBe("foo(): void");
    expect(stripLeadingLineComments("foo(): void // trailing")).toBe("foo(): void // trailing");
    expect(stripLeadingLineComments("/** doc */ foo(): void")).toBe("/** doc */ foo(): void");
    // A comment with nothing after it is not a member at all.
    expect(stripLeadingLineComments("// only a header")).toBe("");
});
