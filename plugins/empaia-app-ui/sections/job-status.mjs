/**
 * The analyses vocabulary: how a job status is classified, when a run happened,
 * and which runs a search matches.
 *
 * Deliberately free of van.js and of the DOM. The badge colour and the filter
 * chip both read `statusGroup` from here, so a status can never be coloured as a
 * failure and filtered as a success — and the whole file is directly testable.
 */

export const RUNNING_STATUSES = new Set(["SCHEDULED", "RUNNING"]);
export const FAILED_STATUSES = new Set(["FAILED", "TIMEOUT", "ERROR", "INCOMPLETE"]);
export const PENDING_STATUSES = new Set(["NONE", "ASSEMBLY", "READY"]);

/** Filter buckets, in the order the chips are rendered. */
export const FILTERS = ["all", "running", "completed", "failed", "pending"];

/**
 * Job modes, for the second filter row.
 *
 * The list carries every mode's jobs for the slide now — a postprocessing step
 * is built on a preprocessing result, so hiding one while preparing the other
 * was the wrong shape. That makes "which step is this?" a question the window has
 * to be able to answer and to filter on.
 */
export const MODE_FILTERS = ["all", "standalone", "preprocessing", "postprocessing"];

/** The EAD mode name of a job, lowercased from the uppercase wire enum. */
export function modeOf(job) {
    return String(job?.mode ?? "").toLowerCase();
}
/** Day buckets, newest first. */
export const DAY_GROUPS = ["today", "yesterday", "earlier"];

/** Filter bucket a status belongs to — the id of the chip that matches it. */
export function statusGroup(status) {
    if (status === "COMPLETED") return "completed";
    if (FAILED_STATUSES.has(status)) return "failed";
    if (RUNNING_STATUSES.has(status)) return "running";
    return "pending";
}

/** DaisyUI badge modifier per job status. */
export function statusClass(status) {
    switch (statusGroup(status)) {
        case "completed": return "badge-success";
        case "failed": return "badge-error";
        case "running": return "badge-info";
        default: return "badge-ghost";
    }
}

/** When an analysis happened — the one ordering the whole window uses. */
export function jobTime(job) {
    return job?.ended_at ?? job?.started_at ?? job?.created_at ?? 0;
}

/**
 * EMPAIA timestamps are seconds since the epoch; `Date` wants milliseconds.
 * Anything already large enough to be milliseconds is left alone, so a backend
 * that changes its mind does not push every analysis into 1970.
 */
export function normalizeTime(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value < 1e12 ? value * 1000 : value;
}

/**
 * Which day bucket an analysis falls in.
 *
 * Day boundaries, not "24 hours ago": a pathologist reading a slide in the
 * morning means *yesterday's* run, not one from 23 hours ago.
 */
export function dayGroupOf(timestamp, now = Date.now()) {
    const at = normalizeTime(timestamp);
    if (!at) return "earlier";
    const startOfToday = new Date(now).setHours(0, 0, 0, 0);
    if (at >= startOfToday) return "today";
    if (at >= startOfToday - 86_400_000) return "yesterday";
    return "earlier";
}

/** A short "2 min ago" for a job timestamp. `t` is the plugin translator. */
export function relativeTime(t, timestamp, now = Date.now()) {
    const at = normalizeTime(timestamp);
    if (!at) return t("jobs.timeUnknown");
    const seconds = Math.max(0, Math.round((now - at) / 1000));
    if (seconds < 60) return t("jobs.ago.seconds", { count: seconds });
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return t("jobs.ago.minutes", { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return t("jobs.ago.hours", { count: hours });
    return t("jobs.ago.days", { count: Math.round(hours / 24) });
}

/**
 * The analyses a search and a status chip select, newest first.
 *
 * The text is matched against everything the user could plausibly remember
 * about a run — its id, the app that ran it, the state it is in, and what it
 * said when it failed. Matching happens over the already-polled list, so it
 * costs no requests.
 *
 * @param jobs the slide's analyses
 * @param query.filter one of {@link FILTERS}
 * @param query.mode one of {@link MODE_FILTERS}
 * @param query.search free text; empty matches everything
 * @param query.appName the app's display name, matched as if it were a field
 * @param query.statusLabel translator for a status, so a user searching the word
 *   they can see ("failed") matches the run, not only the wire enum
 */
export function selectJobs(jobs, query = {}) {
    const filter = query.filter || "all";
    const mode = query.mode || "all";
    const needle = String(query.search ?? "").trim().toLowerCase();
    const appName = String(query.appName ?? "").toLowerCase();
    const statusLabel = query.statusLabel ?? (status => status);

    return (jobs ?? [])
        .filter(job => {
            if (filter !== "all" && statusGroup(job?.status) !== filter) return false;
            if (mode !== "all" && modeOf(job) !== mode) return false;
            if (!needle) return true;
            return [
                job?.id,
                job?.app_id,
                appName,
                statusLabel(job?.status),
                modeOf(job),
                job?.error_message,
                job?.input_validation_error_message,
                job?.output_validation_error_message,
            ].filter(Boolean).join(" ").toLowerCase().includes(needle);
        })
        .sort((a, b) => jobTime(b) - jobTime(a));
}

/**
 * The analysis shown by default: the most recently *completed* one.
 *
 * Deliberately not "most recently created": a run that failed, or one still
 * going, has no output to show, and blanking the slide because someone started
 * a new analysis would take away the result they are reading.
 *
 * Mirrors `EmpaiaWorkbench.latestCompletedJob`, which is the authority — this
 * copy exists so the list can render the "newest" badge without a module call
 * per row.
 */
export function latestCompletedJob(jobs) {
    return (jobs ?? [])
        .filter(job => job?.status === "COMPLETED")
        .reduce((best, job) => (!best || jobTime(job) >= jobTime(best) ? job : best), undefined);
}
