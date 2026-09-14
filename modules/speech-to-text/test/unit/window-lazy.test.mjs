/**
 * Lazy archive windows: banked, never uploaded until someone asks.
 *
 * With the review starting from the live transcript, the eager background decode of
 * every ~90 s window was an upload per window for text that is usually never read.
 * `windowMode: "lazy"` keeps the sealed audio and lets `transcribeSessionAudio` decode
 * it — serially, in seal order — only when the consumer decides the recording is needed.
 *
 * Like window-retry.test.mjs this pins the contract on a fake that mirrors the module's
 * `_enqueueWindow` / `transcribeSessionAudio` shape; the real branch is three lines.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

class FakeStt {
    constructor(transcribe) {
        this._windows = [];
        this._transcribe = transcribe;
        this.calls = [];
        this.onWindowCalls = [];
        this._chain = null;
    }
    get pendingWindowCount() { return this._windows.filter((w) => w.state === "pending").length; }

    /** Mirrors `_enqueueWindow`: bank the record; eager runs the decode, lazy returns. */
    enqueue(w, { lazy = false, onWindow = null } = {}) {
        const record = { index: w.index, text: "", blob: w.blob, state: "pending", final: w.final };
        this._windows.push(record);
        if (lazy) return;
        const run = async () => {
            this.calls.push(record.index);
            const res = await this._transcribe(record.blob);
            record.text = String(res?.text || "").trim();
            if (record.text) { record.blob = null; record.state = "done"; } else record.state = "retryable";
            if (record.text && onWindow) { this.onWindowCalls.push(record.index); onWindow({ index: record.index, text: record.text }); }
        };
        this._chain = (this._chain || Promise.resolve()).then(run, run);
    }

    async whenSessionAudioSettled() { if (this._chain) await this._chain; }

    /** Mirrors `transcribeSessionAudio`: decode whatever still holds audio, in order. */
    async transcribeSessionAudio() {
        await this.whenSessionAudioSettled();
        const parts = [];
        for (const w of this._windows) {
            if (w.text) { parts.push(w.text); continue; }
            if (!w.blob) continue;
            w.state = "pending";
            this.calls.push(w.index);
            const res = await this._transcribe(w.blob);
            w.text = String(res?.text || "").trim();
            if (w.text) { w.blob = null; w.state = "done"; parts.push(w.text); } else w.state = "retryable";
        }
        return parts.join(" ");
    }
}

const blobOf = (index) => ({ size: 240000 + index });
const texts = { 0: "wedge biopsy, left upper lobe", 1: "no dense fibrosis", 2: "clinical correlation" };

test("@unit lazy windows are banked and nothing is uploaded", async () => {
    const stt = new FakeStt(async (blob) => ({ text: texts[blob.size - 240000] }));
    const onWindow = (w) => stt.onWindowCalls.push(w.index);
    for (const i of [0, 1, 2]) stt.enqueue({ index: i, blob: blobOf(i), final: i === 2 }, { lazy: true, onWindow });
    await stt.whenSessionAudioSettled();
    expect(stt.calls).toEqual([]);
    expect(stt.onWindowCalls).toEqual([]);
    expect(stt.pendingWindowCount).toBe(3);
    expect(stt._windows.every((w) => w.blob)).toBe(true);
});

test("@unit the recording is decoded in seal order only when asked for", async () => {
    const stt = new FakeStt(async (blob) => ({ text: texts[blob.size - 240000] }));
    for (const i of [0, 1, 2]) stt.enqueue({ index: i, blob: blobOf(i), final: i === 2 }, { lazy: true });
    const whole = await stt.transcribeSessionAudio();
    expect(stt.calls).toEqual([0, 1, 2]);
    expect(whole).toBe("wedge biopsy, left upper lobe no dense fibrosis clinical correlation");
    expect(stt.pendingWindowCount).toBe(0);
    expect(stt._windows.every((w) => w.blob === null)).toBe(true);
    // A second ask joins the retained texts; nothing is decoded twice.
    expect(await stt.transcribeSessionAudio()).toBe(whole);
    expect(stt.calls).toEqual([0, 1, 2]);
});

test("@unit eager windows still decode as they seal and report through onWindow", async () => {
    const stt = new FakeStt(async (blob) => ({ text: texts[blob.size - 240000] }));
    const seen = [];
    for (const i of [0, 1]) stt.enqueue({ index: i, blob: blobOf(i), final: i === 1 }, { onWindow: (w) => seen.push(w.text) });
    await stt.whenSessionAudioSettled();
    expect(stt.calls).toEqual([0, 1]);
    expect(seen).toEqual([texts[0], texts[1]]);
    expect(stt.pendingWindowCount).toBe(0);
    expect(await stt.transcribeSessionAudio()).toBe("wedge biopsy, left upper lobe no dense fibrosis");
    expect(stt.calls).toEqual([0, 1]);
});
