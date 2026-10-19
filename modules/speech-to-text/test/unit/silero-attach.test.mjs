/**
 * The two ways the Silero engine failed SILENTLY in production.
 *
 * 1. `MicVAD.start()` is a state machine with no-op branches. Called while the
 *    library is still `initializing` it logs `start called while initializing` and
 *    returns having wired nothing; called while already `listening` it returns at
 *    once. `attach()` checked only `vad.errored`, so a swallowed call was reported
 *    as a successful attach — the session then recorded ~15 s segments that were all
 *    discarded as `silent`, and a manual stop/start was the only way out. The
 *    capture's stale-session watchdog restarts a dictation without waiting for the
 *    previous attach to settle, which is exactly how the second call lands there.
 *
 * 2. The library's AudioWorklet path connects `source -> vadNode` and never reaches
 *    the destination (its own ScriptProcessor path does, citing the Chrome bug).
 *    Chrome does not run the render thread for a context whose graph reaches no
 *    destination, so the engine loaded, reported `started micVAD`, and emitted
 *    nothing while `currentTime` stayed frozen.
 *
 * Both are invisible from the outside, which is why they are pinned here against the
 * REAL `attach` / `_armKeepAlive` rather than a description of them.
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
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-silero-attach-"));

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
const quiet = {
    warn() {}, error() {}, info() {}, debug() {}, trace() {}, sensitive() {},
    child() { return quiet; }, isEnabled() { return false; }, level() { return "warn"; },
};
// Assigned, not defaulted — see window-audio-tap.test.mjs: a sibling file sharing
// this worker may have left an APPLICATION_CONTEXT without `log`.
globalThis.APPLICATION_CONTEXT = {
    ...(globalThis.APPLICATION_CONTEXT || {}),
    log: () => quiet,
    getOption: () => false,
};

const outfile = path.join(tmp, "silero.mjs");
await esbuild.build({
    entryPoints: [path.join(fromRoot(), "modules", "speech-to-text", "sileroVad.ts")],
    outfile,
    bundle: true,
    // The Silero package publishes browser entry points only; "neutral" refuses to
    // pick one. Nothing under test touches the library itself — it is faked below.
    platform: "browser",
    format: "esm",
    logLevel: "silent",
});
const { SileroVadEngine } = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * A MicVAD that reproduces the library's state machine, including its silence.
 * `initializeMs` is how long a first `start()` stays in `initializing`.
 */
function fakeVad({ initializeMs = 0 } = {}) {
    const vad = {
        listening: false,
        errored: null,
        state: "uninitialized",
        starts: 0,
        pauses: 0,
        concurrentStarts: 0,
        _inStart: 0,
        async start() {
            this.starts++;
            if (this._inStart > 0) this.concurrentStarts++;
            if (this.state === "initializing") return;          // the swallowed call
            if (this.state === "initialized" && this.listening) return;
            this._inStart++;
            this.state = "initializing";
            try {
                if (initializeMs) await new Promise(r => setTimeout(r, initializeMs));
                this.state = "initialized";
                this.listening = true;
            } finally { this._inStart--; }
        },
        async pause() {
            this.pauses++;
            if (!this.listening) return;
            await Promise.resolve();
            this.listening = false;
        },
    };
    return vad;
}

/** The minimal `this` `attach` / `detach` touch, with the real `_serial`. */
function engineWith(vad, ctx = null) {
    return {
        _vad: vad,
        _state: "ready",
        _ctx: ctx,
        _stream: null,
        _onFrame: null,
        _frames: 0,
        _ops: Promise.resolve(),
        _serial: SileroVadEngine.prototype._serial,
    };
}

const stream = (id) => ({ id });
const attach = (engine, s, onFrame = () => {}) =>
    SileroVadEngine.prototype.attach.call(engine, s, onFrame);

test("a start the library swallows is a failure, not a successful attach @unit", async () => {
    // `listening` false after start() means nothing was wired. Reporting success here
    // is what left the session recording audio nobody was judging.
    const vad = fakeVad();
    vad.state = "initializing";                 // a previous start is still in flight
    const engine = engineWith(vad);

    await expect(attach(engine, stream("a"))).rejects.toThrow(/did not take effect/);
    expect(engine._onFrame, "and the frame callback is not left dangling").toBe(null);
});

test("overlapping attaches never issue a start while one is in flight @unit", async () => {
    // The stale-session watchdog restarts capture without waiting for the previous
    // attach. Serializing is what makes the swallowed branch unreachable.
    const vad = fakeVad({ initializeMs: 20 });
    const engine = engineWith(vad);

    const first = attach(engine, stream("a"));
    const second = attach(engine, stream("b"));
    await Promise.all([first, second]);

    expect(vad.concurrentStarts, "no start overlapped another").toBe(0);
    expect(vad.listening).toBe(true);
    expect(engine._stream.id, "the last attach owns the stream").toBe("b");
});

test("a detach's pause completes before the next attach starts @unit", async () => {
    const vad = fakeVad();
    const engine = engineWith(vad);
    await attach(engine, stream("a"));

    SileroVadEngine.prototype.detach.call(engine);
    expect(engine._onFrame, "the callback is dropped synchronously").toBe(null);

    await attach(engine, stream("b"));
    expect(vad.pauses).toBeGreaterThan(0);
    expect(vad.listening).toBe(true);
    expect(vad.concurrentStarts).toBe(0);
});

test("the frame count resets per attach, so zero means this session emitted none @unit", async () => {
    const vad = fakeVad();
    const engine = engineWith(vad);
    engine._frames = 99;
    await attach(engine, stream("a"));
    expect(engine._frames).toBe(0);
});

// ---- the render keep-alive ------------------------------------------------------

/** An AudioContext that records what was connected to what. */
function fakeContext({ constantSource = true } = {}) {
    const ctx = { destination: { id: "destination" }, connections: [], started: 0 };
    const node = (id) => ({
        id,
        gain: { value: 1 },
        offset: { value: 1 },
        connect: (to) => ctx.connections.push([id, to.id]),
        disconnect: () => {},
        start: () => { ctx.started++; },
        stop: () => {},
    });
    ctx.createGain = () => node("gain");
    if (constantSource) ctx.createConstantSource = () => node("source");
    return ctx;
}

const armKeepAlive = (engine, ctx) => SileroVadEngine.prototype._armKeepAlive.call(engine, ctx);

test("the engine's context gets a silent path to its destination @unit", () => {
    // Without a sink the renderer never pulls the graph: no frames, frozen clock,
    // and the capture demotes the session within two seconds.
    const engine = { _keepAlive: null };
    const ctx = fakeContext();
    armKeepAlive(engine, ctx);

    expect(ctx.connections).toContainEqual(["gain", "destination"]);
    expect(ctx.connections).toContainEqual(["source", "gain"]);
    expect(ctx.started, "a source that never starts pulls nothing").toBe(1);
    expect(engine._keepAlive.sink.gain.value, "and it is silent").toBe(0);
    expect(engine._keepAlive.source.offset.value).toBe(0);
});

test("the keep-alive is armed once, not once per load @unit", () => {
    const engine = { _keepAlive: null };
    const ctx = fakeContext();
    armKeepAlive(engine, ctx);
    armKeepAlive(engine, ctx);
    expect(ctx.connections.length).toBe(2);
});

test("a context that cannot provide a source is degraded, never thrown @unit", () => {
    // A logging/diagnostic aid must not be able to break capture: without the sink
    // the old behaviour returns, and the health poll already handles it.
    const engine = { _keepAlive: null };
    expect(() => armKeepAlive(engine, fakeContext({ constantSource: false }))).not.toThrow();
    expect(engine._keepAlive).toBe(null);
});
