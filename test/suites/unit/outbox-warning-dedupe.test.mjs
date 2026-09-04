/**
 * A systematic outbox failure says itself once, and says what to do about it.
 *
 * Outbox persistence is best-effort: a failed write is warned about and the
 * dispatch proceeds, so the user never loses the operation. But the failures
 * that actually happen are *systematic* — a resource whose payload cannot be
 * structured-cloned fails on every single op — and the warning fired per
 * operation. Recording one tour produced eleven identical lines, none of which
 * mentioned the fix (`declare a serialize()`).
 *
 * The event stays per-operation on purpose: a listener may legitimately count
 * how many ops lost their crash-recovery record. Only the console is deduped.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

class EventSource {
    constructor() { this._h = new Map(); }
    addHandler(name, fn) { (this._h.get(name) ?? this._h.set(name, []).get(name)).push(fn); }
    removeHandler(name, fn) {
        const l = this._h.get(name);
        if (l) this._h.set(name, l.filter(x => x !== fn));
    }
    raiseEvent(name, payload) { for (const fn of this._h.get(name) ?? []) fn(payload); }
}
globalThis.OpenSeadragon = globalThis.OpenSeadragon ?? {};
globalThis.OpenSeadragon.EventSource = globalThis.OpenSeadragon.EventSource ?? EventSource;
globalThis.$ = globalThis.$ ?? { t: (key) => String(key).split(".").pop() };

const { IOResourceImpl } = await import("../../../src/classes/io/io-resource.ts");

/** Just enough pipeline for construction; nothing here dispatches. */
const stubPipeline = () => ({
    isEnabled: () => false,
    registerResource: () => () => {},
    runGuards: () => ({ ok: true }),
    dispatch: async () => ({ ok: true }),
    emitQueueEvent_: () => {},
    surfaceRefusal_: () => {},
    bindingsFor: () => [],
});

function makeResource(name) {
    return new IOResourceImpl({
        ownerUid: "module.test",
        ownerId: "test",
        xoType: "module",
        pipeline: stubPipeline(),
        def: { name },
    });
}

/** Capture console.warn for the duration of one call. */
function captureWarnings(fn) {
    const seen = [];
    const original = console.warn;
    console.warn = (...args) => seen.push(args.join(" "));
    try { fn(); } finally { console.warn = original; }
    return seen;
}

test("a repeated failure warns once per resource @unit", () => {
    const resource = makeResource("step");
    const warnings = captureWarnings(() => {
        for (let i = 0; i < 11; i += 1) {
            // Reaching a `private` directly: it is private to TypeScript only,
            // and the alternative — driving eleven real IndexedDB failures — is
            // a worse test of the same one branch.
            resource._warnOutboxFailureOnce("W_IO_OUTBOX_WRITE", "HTMLImageElement object could not be cloned");
        }
    });

    expect(warnings).toHaveLength(1);
});

test("the warning names the resource and the fix @unit", () => {
    const resource = makeResource("step");
    const [warning] = captureWarnings(() => {
        resource._warnOutboxFailureOnce("W_IO_OUTBOX_WRITE", "HTMLImageElement object could not be cloned");
    });

    expect(warning).toContain('resource "step"');
    expect(warning, "the reader must learn what to DO").toContain("serialize()");
    expect(warning, "and that their data is not lost").toContain("Dispatch is unaffected");
});

test("a different failure code is still reported @unit", () => {
    // Dedupe is per (code, resource): a quota failure after a clone failure is
    // new information, not a repeat.
    const resource = makeResource("step");
    const warnings = captureWarnings(() => {
        resource._warnOutboxFailureOnce("W_IO_OUTBOX_WRITE", "could not be cloned");
        resource._warnOutboxFailureOnce("W_IO_OUTBOX_WRITE", "could not be cloned");
        resource._warnOutboxFailureOnce("W_IO_OUTBOX_QUOTA", "quota exceeded");
    });

    expect(warnings).toHaveLength(2);
});

test("another resource with the same failure still gets its own warning @unit", () => {
    // The dedupe must not hide a SECOND broken owner behind the first.
    const step = makeResource("step");
    const asset = makeResource("asset");
    const warnings = captureWarnings(() => {
        step._warnOutboxFailureOnce("W_IO_OUTBOX_WRITE", "could not be cloned");
        asset._warnOutboxFailureOnce("W_IO_OUTBOX_WRITE", "could not be cloned");
    });

    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain('resource "asset"');
});

test("a non-clone failure gets no serialize advice @unit", () => {
    // The hint is only right for a structured-clone failure. Telling someone
    // whose disk is full to write a serializer wastes their time.
    const resource = makeResource("step");
    const [warning] = captureWarnings(() => {
        resource._warnOutboxFailureOnce("W_IO_OUTBOX_WRITE", "QuotaExceededError: storage is full");
    });

    expect(warning).not.toContain("serialize()");
    expect(warning).toContain("QuotaExceededError");
});
