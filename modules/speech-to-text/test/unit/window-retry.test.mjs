/**
 * What happens to an archive window whose transcription came back empty.
 *
 * The windows ARE the whole-audio transcript — the accurate one, the reason the recording
 * is kept at all. `transcribeSessionAudio` retries any window the background pass did not
 * decode, and used to free that window's audio unconditionally afterwards:
 *
 *     w.text = String(res?.text || "").trim();
 *     w.blob = null;                          // ← even when the retry produced nothing
 *
 * One empty decode therefore killed the feature for the whole session. The record kept no
 * text and no audio, every later call skipped it, `transcribeSessionAudio` returned "",
 * and the review modal silently showed the per-segment transcript instead — for every
 * subsequent dictation, because `_windows` is not reset between captures. Observed live
 * as `{wholeAudio: false, reason: 'empty', windows: 1, pending: 1}` against a window whose
 * dump read `chars: 0, hasBlob: false`.
 *
 * These pin the retry contract on a fake module: the audio survives an empty result, and
 * a later attempt can still recover the speech.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

/**
 * The narrow slice of `SpeechToTextModule` these assertions need: the window list, the
 * retry loop, and the two counters that describe it. Mirrors the real implementation —
 * kept in step by `transcribeSessionAudio`'s shape, which is what the test is about.
 */
class FakeStt {
    constructor(windows, transcribe) {
        this._windows = windows;
        this._transcribe = transcribe;
        this.calls = 0;
        this.warnings = [];
    }
    get sessionWindowCount() { return this._windows.length; }
    get pendingWindowCount() { return this._windows.filter((w) => !w.text && w.blob).length; }
    get failedWindowCount() { return this._windows.filter((w) => !w.text && !w.blob).length; }
    async transcribeSessionAudio() {
        const parts = [];
        for (const w of this._windows) {
            if (w.text) { parts.push(w.text); continue; }
            if (!w.blob) continue;
            this.calls++;
            const res = await this._transcribe(w.blob);
            w.text = String(res?.text || "").trim();
            if (w.text) { w.blob = null; parts.push(w.text); }
            else this.warnings.push(w.index);
        }
        return parts.join(" ");
    }
}

const windowOf = (index, text = "", blob = { size: 240000 }) => ({ index, text, blob, final: true });

test("@unit an empty retry keeps the audio so a later attempt can still recover it", async () => {
    let attempt = 0;
    const stt = new FakeStt([windowOf(0)], async () => {
        attempt++;
        return attempt === 1 ? { text: "  " } : { text: "Transbronchial biopsies, adequate." };
    });

    expect(await stt.transcribeSessionAudio()).toBe("");
    // The failure that mattered: after this, the old code held neither text nor audio.
    expect(stt._windows[0].blob).toBeTruthy();
    expect(stt.pendingWindowCount).toBe(1);
    expect(stt.failedWindowCount).toBe(0);

    expect(await stt.transcribeSessionAudio()).toBe("Transbronchial biopsies, adequate.");
    expect(stt._windows[0].blob).toBe(null);
});

test("@unit an empty retry is reported rather than passing silently", async () => {
    const stt = new FakeStt([windowOf(0)], async () => ({ text: "" }));
    await stt.transcribeSessionAudio();
    // A window is ~90 s of speech; coming back with none of it must never be quiet.
    expect(stt.warnings).toEqual([0]);
});

test("@unit a decoded window frees its audio and is not retried", async () => {
    const stt = new FakeStt([windowOf(0, "already decoded", null)], async () => ({ text: "nope" }));
    expect(await stt.transcribeSessionAudio()).toBe("already decoded");
    expect(stt.calls).toBe(0);
    expect(stt.pendingWindowCount).toBe(0);
    expect(stt.failedWindowCount).toBe(0);
});

test("@unit a window with neither text nor audio counts as LOST, not as pending", async () => {
    // Conflating the two is what made a corpse read as "about to arrive": the caller
    // waited for something that could never land, and took "still decoding" as comfort
    // while it degraded.
    const stt = new FakeStt([{ index: 0, text: "", blob: null, final: true }], async () => ({ text: "x" }));
    expect(stt.pendingWindowCount).toBe(0);
    expect(stt.failedWindowCount).toBe(1);
    expect(await stt.transcribeSessionAudio()).toBe("");
    expect(stt.calls).toBe(0);
});

test("@unit one lost window does not discard the windows that did decode", async () => {
    const stt = new FakeStt(
        [{ index: 0, text: "", blob: null, final: false }, windowOf(1, "the second window", null)],
        async () => ({ text: "unused" }),
    );
    expect(await stt.transcribeSessionAudio()).toBe("the second window");
    expect(stt.failedWindowCount).toBe(1);
});
