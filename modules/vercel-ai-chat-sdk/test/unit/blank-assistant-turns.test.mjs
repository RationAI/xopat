/**
 * A turn where the model produced nothing usable is persisted (the transcript stays
 * faithful, and `metadata.emptyReply` is what the UI and the logs read) — but it must
 * never be replayed as conversation.
 *
 * The client already refused to keep one in its own history; the server did not, so a
 * stalled turn sat in the stored session and went back into every later prompt. One
 * failing session ended with two `content: ""` assistant turns in the model input and
 * no corrective instruction anywhere — which is close to an instruction to produce a
 * third.
 */
import { test, expect } from "@xopat/test-harness";

const { isContentlessAssistantMessage } = await import("../../server/model-messages.ts");

test("an assistant turn with no content is dropped", () => {
    expect(isContentlessAssistantMessage({ role: "assistant", content: "" })).toBe(true);
    expect(isContentlessAssistantMessage({ role: "assistant", content: "   \n " })).toBe(true);
    expect(isContentlessAssistantMessage({
        role: "assistant",
        content: "",
        parts: [{ type: "text", text: "" }],
        metadata: { emptyReply: true },
    })).toBe(true);
});

test("an assistant turn with real content is kept", () => {
    expect(isContentlessAssistantMessage({ role: "assistant", content: "here you go" })).toBe(false);
    // Text only in the parts is still text.
    expect(isContentlessAssistantMessage({
        role: "assistant",
        content: "",
        parts: [{ type: "text", text: "```xopat-script\nreturn 1;\n```" }],
    })).toBe(false);
});

test("an assistant turn carrying only media is kept", () => {
    // A screenshot with no caption still says something; dropping it loses the turn.
    expect(isContentlessAssistantMessage({
        role: "assistant",
        content: "",
        parts: [{ type: "image", mimeType: "image/png", dataUrl: "data:image/png;base64,AA==" }],
    })).toBe(false);
});

test("only assistant turns are eligible", () => {
    // A user or tool message with no text is still input — never drop it.
    for (const role of ["user", "tool", "system"]) {
        expect(isContentlessAssistantMessage({ role, content: "" }), role).toBe(false);
    }
    expect(isContentlessAssistantMessage(null)).toBe(false);
    expect(isContentlessAssistantMessage(undefined)).toBe(false);
});

test("a script-error or host-feedback part counts as content", () => {
    // These arrive on tool turns, but the predicate must not treat typed parts as empty
    // if one is ever carried by an assistant message.
    expect(isContentlessAssistantMessage({
        role: "assistant",
        content: "",
        parts: [{ type: "host-feedback", text: "Script execution failed." }],
    })).toBe(false);
});
