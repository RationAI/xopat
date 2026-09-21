/**
 * The analyses list is the only place a pathologist can tell one run from
 * another, so the vocabulary behind it has to be exact:
 *
 *  - a status is classified once, and the badge colour and the filter chip both
 *    read that classification — a run that is coloured as a failure must never
 *    be filtered as a success,
 *  - "yesterday" means the previous calendar day, not 24 hours, because that is
 *    what a reader means by it,
 *  - EMPAIA timestamps are seconds; treating them as milliseconds puts every run
 *    in 1970 and silently destroys the ordering the whole window depends on,
 *  - the default shown analysis is the newest *completed* one — a newer failed or
 *    still-running job must not blank the result being read,
 *  - search matches what the user can see (the translated status), not only the
 *    wire enum.
 */
import { test, expect } from "@xopat/test-harness";

import {
    dayGroupOf, jobTime, latestCompletedJob, MODE_FILTERS, modeOf, normalizeTime,
    relativeTime, selectJobs, statusClass, statusGroup,
} from "../../sections/job-status.mjs";

/** Stand-in translator: returns the key's last segment, like the real dummy `$.t`. */
const t = (key, args) => (args?.count !== undefined ? `${args.count}:${key}` : key);

const job = (over = {}) => ({
    id: "job-id", app_id: "app-id", status: "COMPLETED", inputs: {}, outputs: {}, ...over,
});

test("every status classifies into exactly one filter bucket", () => {
    expect(statusGroup("COMPLETED")).toBe("completed");
    for (const status of ["SCHEDULED", "RUNNING"]) expect(statusGroup(status)).toBe("running");
    for (const status of ["FAILED", "TIMEOUT", "ERROR", "INCOMPLETE"]) {
        expect(statusGroup(status)).toBe("failed");
    }
    for (const status of ["NONE", "ASSEMBLY", "READY"]) expect(statusGroup(status)).toBe("pending");
    // An enum the backend adds later must land somewhere, not nowhere.
    expect(statusGroup("SOMETHING_NEW")).toBe("pending");
});

test("badge colour follows the same classification as the filter", () => {
    expect(statusClass("COMPLETED")).toBe("badge-success");
    expect(statusClass("TIMEOUT")).toBe("badge-error");
    expect(statusClass("RUNNING")).toBe("badge-info");
    expect(statusClass("ASSEMBLY")).toBe("badge-ghost");
});

test("job time prefers the end, then the start, then the creation", () => {
    expect(jobTime(job({ created_at: 1, started_at: 2, ended_at: 3 }))).toBe(3);
    expect(jobTime(job({ created_at: 1, started_at: 2, ended_at: null }))).toBe(2);
    expect(jobTime(job({ created_at: 1, started_at: null, ended_at: null }))).toBe(1);
    expect(jobTime(undefined)).toBe(0);
});

test("second timestamps are promoted, millisecond ones are left alone", () => {
    const seconds = 1_700_000_000;
    expect(normalizeTime(seconds)).toBe(seconds * 1000);
    expect(normalizeTime(seconds * 1000)).toBe(seconds * 1000);
    expect(normalizeTime(0)).toBe(0);
    expect(normalizeTime(undefined)).toBe(0);
    expect(normalizeTime(-5)).toBe(0);
});

test("day grouping uses calendar days, not a rolling 24 hours", () => {
    // 09:00 local on some day, and 23:00 local on the day before: 10 hours apart,
    // but a reader calls the second one "yesterday".
    const now = new Date(2026, 0, 15, 9, 0, 0).getTime();
    const earlierToday = new Date(2026, 0, 15, 1, 0, 0).getTime();
    const lateYesterday = new Date(2026, 0, 14, 23, 0, 0).getTime();
    const twoDaysAgo = new Date(2026, 0, 13, 12, 0, 0).getTime();

    expect(dayGroupOf(earlierToday, now)).toBe("today");
    expect(dayGroupOf(lateYesterday, now)).toBe("yesterday");
    expect(dayGroupOf(twoDaysAgo, now)).toBe("earlier");
    // A run with no usable timestamp still has to land in a rendered group.
    expect(dayGroupOf(0, now)).toBe("earlier");
});

test("relative time picks the coarsest unit that still reads as recent", () => {
    const now = new Date(2026, 0, 15, 12, 0, 0).getTime();
    expect(relativeTime(t, (now - 30_000) / 1000, now)).toBe("30:jobs.ago.seconds");
    expect(relativeTime(t, (now - 5 * 60_000) / 1000, now)).toBe("5:jobs.ago.minutes");
    expect(relativeTime(t, (now - 3 * 3_600_000) / 1000, now)).toBe("3:jobs.ago.hours");
    expect(relativeTime(t, (now - 4 * 86_400_000) / 1000, now)).toBe("4:jobs.ago.days");
    expect(relativeTime(t, undefined, now)).toBe("jobs.timeUnknown");
});

test("the default analysis is the newest completed one, never a newer failure", () => {
    const jobs = [
        job({ id: "old-ok", status: "COMPLETED", ended_at: 100 }),
        job({ id: "new-ok", status: "COMPLETED", ended_at: 200 }),
        job({ id: "newest-failed", status: "FAILED", ended_at: 300 }),
        job({ id: "newest-running", status: "RUNNING", started_at: 400 }),
    ];
    expect(latestCompletedJob(jobs)?.id).toBe("new-ok");
    expect(latestCompletedJob([job({ status: "RUNNING", started_at: 1 })])).toBe(undefined);
    expect(latestCompletedJob([])).toBe(undefined);
});

test("selection filters by status bucket and orders newest first", () => {
    const jobs = [
        job({ id: "a", status: "COMPLETED", ended_at: 100 }),
        job({ id: "b", status: "RUNNING", started_at: 300 }),
        job({ id: "c", status: "ERROR", ended_at: 200 }),
    ];
    expect(selectJobs(jobs, {}).map(j => j.id)).toEqual(["b", "c", "a"]);
    expect(selectJobs(jobs, { filter: "running" }).map(j => j.id)).toEqual(["b"]);
    expect(selectJobs(jobs, { filter: "failed" }).map(j => j.id)).toEqual(["c"]);
    expect(selectJobs(jobs, { filter: "completed" }).map(j => j.id)).toEqual(["a"]);
});

test("search matches the id, the app, the visible status and the failure text", () => {
    const jobs = [
        job({ id: "a13f2c9e", status: "COMPLETED", ended_at: 200 }),
        job({ id: "0e21bb00", status: "FAILED", ended_at: 100, error_message: "out of memory" }),
    ];
    const query = {
        appName: "Mitosis Counter",
        statusLabel: (status) => ({ COMPLETED: "completed", FAILED: "failed" })[status] ?? status,
    };

    expect(selectJobs(jobs, { ...query, search: "a13f" }).map(j => j.id)).toEqual(["a13f2c9e"]);
    // Case-insensitive, and the id is matched anywhere, not only as a prefix.
    expect(selectJobs(jobs, { ...query, search: "BB00" }).map(j => j.id)).toEqual(["0e21bb00"]);
    expect(selectJobs(jobs, { ...query, search: "memory" }).map(j => j.id)).toEqual(["0e21bb00"]);
    // The word the user can actually see on the badge.
    expect(selectJobs(jobs, { ...query, search: "failed" }).map(j => j.id)).toEqual(["0e21bb00"]);
    // The app name is shared, so it selects everything rather than nothing.
    expect(selectJobs(jobs, { ...query, search: "mitosis" }).length).toBe(2);
    expect(selectJobs(jobs, { ...query, search: "nothing-matches" })).toEqual([]);
});

test("a validation failure is searchable even when the job carries no error message", () => {
    const jobs = [
        job({ id: "v1", status: "INCOMPLETE", ended_at: 1, output_validation_error_message: "bad class value" }),
        job({ id: "v2", status: "COMPLETED", ended_at: 2 }),
    ];
    expect(selectJobs(jobs, { search: "bad class" }).map(j => j.id)).toEqual(["v1"]);
});

// ── which step, not just which state ────────────────────────────────────────

const preprocessing = { id: "p1", mode: "PREPROCESSING", status: "COMPLETED", ended_at: 300 };
const standalone = { id: "s1", mode: "STANDALONE", status: "COMPLETED", ended_at: 200 };
const postprocessing = { id: "x1", mode: "POSTPROCESSING", status: "FAILED", ended_at: 100 };
const allModes = [preprocessing, standalone, postprocessing];

test("modeOf lowercases the uppercase wire enum", () => {
    expect(modeOf(preprocessing)).toBe("preprocessing");
    expect(modeOf({})).toBe("");
    expect(modeOf(undefined)).toBe("");
});

test("the mode filter selects one step and 'all' selects every one", () => {
    // The list carries every mode's jobs for the slide now — a postprocessing run
    // is built on a preprocessing result, so filtering the list down to the mode
    // the user is about to run hid the very thing they need to pick.
    expect(selectJobs(allModes, { mode: "preprocessing" }).map(j => j.id)).toEqual(["p1"]);
    expect(selectJobs(allModes, { mode: "all" }).map(j => j.id)).toEqual(["p1", "s1", "x1"]);
    expect(selectJobs(allModes, {}).map(j => j.id)).toEqual(["p1", "s1", "x1"]);
});

test("mode and status filters compose", () => {
    expect(selectJobs(allModes, { mode: "postprocessing", filter: "failed" }).map(j => j.id))
        .toEqual(["x1"]);
    expect(selectJobs(allModes, { mode: "postprocessing", filter: "completed" })).toEqual([]);
});

test("the mode is searchable, because it is a word the user can see", () => {
    expect(selectJobs(allModes, { search: "preprocessing" }).map(j => j.id)).toEqual(["p1"]);
    // "processing" matches both pre- and post-, which is the honest substring answer.
    expect(selectJobs(allModes, { search: "postprocessing" }).map(j => j.id)).toEqual(["x1"]);
});

test("MODE_FILTERS leads with 'all', like the status chips", () => {
    expect(MODE_FILTERS[0]).toBe("all");
    expect(MODE_FILTERS).toContain("standalone");
    expect(MODE_FILTERS).toContain("postprocessing");
});
