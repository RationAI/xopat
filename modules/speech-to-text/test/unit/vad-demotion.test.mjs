/**
 * When the capture is allowed to give up its engine — and what it says when it does.
 *
 * `_pollHealth` samples once a second against a 2 s staleness threshold, and the
 * demotion it triggers is **permanent for the session** (`a session never switches
 * back`). A single sample deciding an irreversible thing meant one hiccup — a GC
 * pause, a frame landing a few ms late — cost the whole dictation the better engine.
 *
 * The other half is what the warning carried. It named a verdict and none of its
 * inputs, and `classifyCapture` has TWO rules that produce `vad-stalled`
 * (`!contextTimeAdvancing`, and `msSinceVadTick > 2000`) which are different faults
 * with different fixes. A whole production session was undiagnosable because of it.
 *
 * `classifyCapture` itself is covered by capture-health.test.mjs; this is about the
 * policy that consumes its verdict.
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
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-vad-demotion-"));

globalThis.window = globalThis.window ?? globalThis;
const warnings = [];
const channel = {
    warn: (fields, message) => warnings.push({ fields, message }),
    error() {}, info() {}, debug() {}, trace() {}, sensitive() {},
    child() { return channel; }, isEnabled() { return false; }, level() { return "warn"; },
};
globalThis.APPLICATION_CONTEXT = {
    ...(globalThis.APPLICATION_CONTEXT || {}),
    log: () => channel,
    getOption: () => false,
};

const outfile = path.join(tmp, "audioCapture.mjs");
await esbuild.build({
    entryPoints: [path.join(fromRoot(), "modules", "speech-to-text", "audioCapture.ts")],
    outfile,
    bundle: true,
    platform: "browser",
    format: "esm",
    logLevel: "silent",
});
const { AudioCapture } = await import(pathToFileURL(outfile).href);
const pollHealth = AudioCapture.prototype._pollHealth;

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * A capture mid-session on Silero, with a context whose clock is frozen — the
 * production case: `contextState` running, `currentTime` never advancing.
 */
function stalledCapture(over = {}) {
    const capture = {
        _recording: true,
        _segmented: true,
        _vad: "silero",
        _vadStallStrikes: 0,
        _segVadStalled: false,
        // Primed to the frozen value: `contextTimeAdvancing` compares against the
        // PREVIOUS reading, so the very first poll of a session can never detect a
        // frozen clock — it has nothing to compare with. Production sees one healthy
        // poll and only then the stall.
        _lastCtxTime: 5,
        _lastVadTickAt: 0,
        _lastRecorderDataAt: performance.now(),
        _silero: { frames: 0 },
        _stream: { getAudioTracks: () => [{ readyState: "live", muted: false }] },
        // Frozen: currentTime is the same on every poll.
        _vadCtx: () => ({ state: "running", currentTime: 5 }),
        _beat() {},
        _recoverVadClock() {},
        demotions: [],
        ...over,
    };
    capture._switchToAmplitude = (reason, evidence) => capture.demotions.push({ reason, evidence });
    return capture;
}

const poll = (capture) => pollHealth.call(capture);

test("one stalled poll does not cost the session its engine @unit", () => {
    // The threshold is 2 s and the poll is 1 s: a single sample is not evidence
    // enough for a decision the session cannot take back.
    const capture = stalledCapture();
    poll(capture);

    expect(capture.demotions.length).toBe(0);
    expect(capture._vadStallStrikes).toBe(1);
    expect(capture._segVadStalled, "but the segment is still marked untrusted").toBe(true);
});

test("the first poll of a session cannot detect a frozen clock @unit", () => {
    // `contextTimeAdvancing` needs a previous reading. Worth stating: it is why a
    // demotion never happens instantly, and why the strike counter costs one extra
    // second rather than the four it looks like.
    const capture = stalledCapture({ _lastCtxTime: -1 });
    poll(capture);
    expect(capture._vadStallStrikes).toBe(0);
    expect(capture.demotions.length).toBe(0);
});

test("two consecutive stalled polls do @unit", () => {
    const capture = stalledCapture();
    poll(capture);
    poll(capture);

    expect(capture.demotions.length).toBe(1);
    expect(capture.demotions[0].reason).toBe("silero frames stalled");
});

test("a healthy poll in between clears the count @unit", () => {
    // Otherwise "two consecutive" would quietly mean "two ever", and a session with
    // one blip an hour would still end up demoted.
    let frozen = true;
    let time = 5;
    const capture = stalledCapture();
    capture._vadCtx = () => ({ state: "running", currentTime: frozen ? time : ++time });

    poll(capture);
    expect(capture._vadStallStrikes).toBe(1);

    frozen = false;
    capture._lastVadTickAt = performance.now();
    poll(capture);
    expect(capture._vadStallStrikes, "reset by a good sample").toBe(0);
    expect(capture.demotions.length).toBe(0);

    frozen = true;
    poll(capture);
    expect(capture.demotions.length, "and the next stall starts over").toBe(0);
    expect(capture._vadStallStrikes).toBe(1);
});

test("the demotion carries the evidence that produced it @unit", () => {
    // Two different rules produce `vad-stalled`. Without these fields a paste cannot
    // say which one fired, which is exactly how this went unexplained in production.
    const capture = stalledCapture();
    poll(capture);
    poll(capture);

    const { evidence } = capture.demotions[0];
    expect(evidence.contextTimeAdvancing, "the rule that actually fired").toBe(false);
    expect(evidence.contextState).toBe("running");
    expect(evidence.frames, "zero = the engine never emitted one").toBe(0);
    expect(evidence.msSinceVadTick, "-1 = it never ticked").toBe(-1);
    expect(typeof evidence.contextTime).toBe("number");
});

test("a capture that is not on Silero is not strike-counted @unit", () => {
    // The amplitude engine has its own recovery (`_recoverVadClock`) and nothing to
    // be demoted to; the strike counter must not silently gate that path.
    let recovered = 0;
    const capture = stalledCapture({ _vad: "amplitude", _recoverVadClock: () => { recovered++; } });
    poll(capture);

    expect(recovered).toBe(1);
    expect(capture.demotions.length).toBe(0);
});
