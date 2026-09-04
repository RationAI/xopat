/**
 * Which earlier step a mode is built on, and what to say when it has not run.
 *
 * TA12 declares no standalone mode: the viewer lands on `postprocessing`, which
 * consumes `my_cells` — an output of the platform-run `preprocessing` step. On a
 * fresh examination nothing has produced it, so the run button refuses. The
 * refusal used to be one sentence for three different situations ("built on an
 * earlier analysis, and none has finished"), which named no step, did not say the
 * workbench is the one that runs it, and did not distinguish "wait" from "nothing
 * will happen by itself". Each of those is a different next move for the reader.
 */
import { test, expect } from "@xopat/test-harness";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { sourceModeFor, missingSourceKind } = await import("../../inputs.ts");

const ead = (id) => JSON.parse(readFileSync(
    fileURLToPath(new URL(`../fixtures/ead/${id}.json`, import.meta.url)), "utf8"));

// ── naming the producing mode ───────────────────────────────────────────────

test("TA12 — postprocessing is built on preprocessing", () => {
    expect(sourceModeFor(ead("ta12"), "postprocessing")).toBe("preprocessing");
});

test("a mode that consumes nothing from a job has no source mode", () => {
    // TA12's own preprocessing takes only the slide.
    expect(sourceModeFor(ead("ta12"), "preprocessing")).toBe(undefined);
    // TA10 is standalone: one slide, one rectangle, nothing from anywhere else.
    expect(sourceModeFor(ead("ta10"), "standalone")).toBe(undefined);
    expect(sourceModeFor(ead("ta11"), "standalone")).toBe(undefined);
});

test("TA11 — postprocessing consumes two keys, still names one producer", () => {
    expect(sourceModeFor(ead("ta11"), "postprocessing")).toBe("preprocessing");
});

test("no EAD is not an error, it is simply no answer", () => {
    expect(sourceModeFor(undefined, "postprocessing")).toBe(undefined);
});

// ── what to tell the user ───────────────────────────────────────────────────

test("nothing started, and the platform is the one that starts it", () => {
    // The TA12 case on a fresh examination: no preprocessing job exists at all.
    expect(missingSourceKind(ead("ta12"), "postprocessing", undefined))
        .toEqual({ kind: "platform", mode: "preprocessing" });
});

test("a preprocessing run is on its way — waiting is the answer", () => {
    expect(missingSourceKind(ead("ta12"), "postprocessing", { status: "RUNNING" }))
        .toEqual({ kind: "pending", mode: "preprocessing", status: "RUNNING" });
    // ASSEMBLY and SCHEDULED are equally "not yet", not "never".
    expect(missingSourceKind(ead("ta12"), "postprocessing", { status: "SCHEDULED" }).kind)
        .toBe("pending");
});

test("a failed preprocessing run is not pending — waiting will not help", () => {
    // "It is still running, wait for it" is the wrong thing to say about a run
    // that is over and produced nothing. Every failure state is its own answer.
    for (const status of ["FAILED", "TIMEOUT", "ERROR", "INCOMPLETE"]) {
        expect(missingSourceKind(ead("ta12"), "postprocessing", { status }))
            .toEqual({ kind: "failed", mode: "preprocessing", status });
    }
});

test("not-yet-started states are pending, not failures", () => {
    // ASSEMBLY and NONE are terminal for `status` (nothing moves them without a
    // user) but they sit *before* the run, so they are still "on its way".
    for (const status of ["NONE", "ASSEMBLY", "READY"]) {
        expect(missingSourceKind(ead("ta12"), "postprocessing", { status }).kind)
            .toBe("pending");
    }
});

test("a completed source job is not a missing source at all", () => {
    // Reached only when `sourceJobCandidates` found nothing usable — a COMPLETED
    // job whose outputs do not cover the needed keys. Not pending: it is done.
    expect(missingSourceKind(ead("ta12"), "postprocessing", { status: "COMPLETED" }))
        .toEqual({ kind: "platform", mode: "preprocessing" });
});

test("with no producing mode the caller falls back to the generic sentence", () => {
    expect(missingSourceKind(ead("ta10"), "standalone", undefined))
        .toEqual({ kind: "unknown" });
});
