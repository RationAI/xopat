/**
 * `onWindowAudio` — the one moment a window's audio can be taken.
 *
 * A consumer that wants to keep the recording (e.g. a reporting trace that archives
 * each ~90 s window as a file) cannot get the bytes from any of the existing
 * hooks, and the reason is the decode:
 *
 *   - a window that transcribes frees its blob immediately (`record.blob = null`),
 *     so by the time `onWindow` fires the audio is already gone;
 *   - a window that never decodes never reaches `onWindow` at all — and that is
 *     precisely the window someone would want to listen to;
 *   - in `windowMode: "lazy"` nothing is decoded and `onWindow` never fires.
 *
 * So the tap is placed at the seal, before any of that. That placement IS the
 * contract, which is why this drives the real `_enqueueWindow` — bundled from the
 * module source and invoked against a minimal `this` — rather than a fake
 * mirroring it. A fake would only assert that the copy in this file is correct.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-window-audio-"));

// The module reaches for the browser and the loader at import time (it registers
// itself with `addModule` and its UI destructures `UI` / `van`). None of that is
// under test here; the smallest stands-ins that let the file load are enough.
globalThis.window = globalThis.window ?? globalThis;
globalThis.addModule = globalThis.addModule ?? (() => {});
globalThis.XOpatModuleSingleton = globalThis.XOpatModuleSingleton ?? class { static instance() {} };
globalThis.$ = globalThis.$ ?? { t: (key) => key };
globalThis.UI = globalThis.UI ?? { BaseComponent: class {}, PhIcon: class {} };
globalThis.van = globalThis.van ?? {
    tags: new Proxy({}, { get: () => () => ({}) }),
    state: (value) => ({ val: value }),
};
globalThis.document = globalThis.document ?? {
    createElement: () => ({
        style: {}, classList: { add() {}, remove() {}, toggle() {} },
        appendChild() {}, setAttribute() {}, addEventListener() {},
    }),
    body: { appendChild() {} },
    querySelector: () => null,
};
const quietChannel = {
    warn() {}, error() {}, info() {}, debug() {}, trace() {}, sensitive() {},
    child() { return quietChannel; }, isEnabled() { return false; }, level() { return "warn"; },
};
// Assigned, not defaulted: test files share a worker process, and one that ran
// earlier may have left an APPLICATION_CONTEXT with no `log` on the global. A `??`
// here keeps that one and the module's first log call throws.
globalThis.APPLICATION_CONTEXT = {
    ...(globalThis.APPLICATION_CONTEXT || {}),
    log: () => quietChannel,
    getOption: () => false,
};

const outfile = path.join(tmp, "speech-to-text.mjs");
await esbuild.build({
    entryPoints: [path.join(fromRoot(), "modules", "speech-to-text", "speech-to-text.ts")],
    outfile,
    bundle: true,
    // "browser", not "neutral": the Silero VAD package publishes only browser
    // entry points, and `neutral` refuses to pick one.
    platform: "browser",
    format: "esm",
    logLevel: "silent",
});
const { SpeechToTextModule } = await import(pathToFileURL(outfile).href);
const enqueueWindow = SpeechToTextModule.prototype._enqueueWindow;

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * The smallest `this` `_enqueueWindow` touches. `transcribe` decides what the
 * window's decode does — resolve with text, resolve empty, or throw.
 */
function stubModule(transcribe) {
    return {
        _windows: [],
        _windowSession: 1,
        _windowAbort: null,
        _windowChain: null,
        raiseEvent() {},
        _composePrompt: () => ({ prompt: "", context: "" }),
        _diagnoseEmptyWindow() {},
        _transcribeBlob: transcribe,
    };
}

const sealed = (index, over = {}) => ({
    blob: new Blob([new Uint8Array([1, 2, 3, index])], { type: "audio/webm" }),
    index, fromSegment: index * 4, toSegment: index * 4 + 3, final: false, ...over,
});

/** Let the window chain settle. */
const settle = (stt) => stt._windowChain ?? Promise.resolve();

test("the tap receives the audio of a window that goes on to decode @unit", async () => {
    // And the record's own blob is gone afterwards — which is exactly why the tap
    // cannot live on `onWindow`.
    const stt = stubModule(async () => ({ text: "left upper lobe" }));
    const seen = [];
    const window = sealed(0, { final: true });

    enqueueWindow.call(stt, window, {
        contextChars: 0, session: 1,
        onWindowAudio: (w) => seen.push(w),
        onWindow: () => {},
    });
    await settle(stt);

    expect(seen.length).toBe(1);
    expect(seen[0].blob, "the blob itself, not a description of it").toBe(window.blob);
    expect(seen[0].index).toBe(0);
    expect(seen[0].fromSegment).toBe(0);
    expect(seen[0].toSegment).toBe(3);
    expect(seen[0].final).toBe(true);
    expect(stt._windows[0].blob, "the decode freed it").toBe(null);
});

test("the tap receives the audio of a window whose decode fails @unit", async () => {
    // `onWindow` never fires for this one, so without the tap the window worth
    // listening to is the only window a consumer could never hear.
    const stt = stubModule(async () => { throw new Error("upstream down"); });
    const seen = [];
    const reported = [];

    enqueueWindow.call(stt, sealed(0), {
        contextChars: 0, session: 1,
        onWindowAudio: (w) => seen.push(w.index),
        onWindow: (w) => reported.push(w.index),
    });
    await settle(stt);

    expect(seen).toEqual([0]);
    expect(reported, "the transcript hook saw nothing").toEqual([]);
    expect(stt._windows[0].state).toBe("retryable");
});

test("the tap fires in lazy mode, where nothing is decoded at all @unit", async () => {
    // Lazy banks the audio and uploads nothing until a consumer asks for the
    // recording. An archive that only worked in eager mode would silently stop
    // recording the moment a deployment chose the cheaper window mode.
    const decodes = [];
    const stt = stubModule(async () => { decodes.push(1); return { text: "x" }; });
    const seen = [];

    enqueueWindow.call(stt, sealed(0), {
        contextChars: 0, session: 1, lazy: true,
        onWindowAudio: (w) => seen.push(w.index),
        onWindow: () => seen.push("onWindow"),
    });
    await settle(stt);

    expect(seen).toEqual([0]);
    expect(decodes, "nothing left the browser").toEqual([]);
    expect(stt._windows[0].blob, "and the audio is still banked").toBeTruthy();
});

test("a throwing tap does not stop the dictation from being transcribed @unit", async () => {
    // The tap runs on the chain that transcribes the case. A consumer's bug there
    // must cost its own archive, never the transcript.
    const stt = stubModule(async () => ({ text: "no dense fibrosis" }));

    enqueueWindow.call(stt, sealed(0), {
        contextChars: 0, session: 1,
        onWindowAudio: () => { throw new Error("consumer blew up"); },
    });
    await settle(stt);

    expect(stt._windows[0].text).toBe("no dense fibrosis");
    expect(stt._windows[0].state).toBe("done");
});

test("a window sealed after the recording was cleared never reaches the tap @unit", async () => {
    // `clearSessionAudio()` means "delete my recording". A window that seals
    // moments later belongs to a dictation the consumer already discarded, and
    // handing its audio out would make that promise false.
    const stt = stubModule(async () => ({ text: "x" }));
    stt._windowSession = 2;              // the session moved on
    const seen = [];

    enqueueWindow.call(stt, sealed(0), {
        contextChars: 0, session: 1,     // this window belongs to the old one
        onWindowAudio: (w) => seen.push(w.index),
    });
    await settle(stt);

    expect(seen).toEqual([]);
    expect(stt._windows.length, "and it is not banked either").toBe(0);
});
