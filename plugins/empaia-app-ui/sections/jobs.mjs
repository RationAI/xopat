import { jobTime, modeOf, relativeTime, RUNNING_STATUSES, statusClass } from "./job-status.mjs";

const van = globalThis.van;
const { div, span, button, i, progress } = van.tags;

/**
 * One analysis, as a row of the analyses window.
 *
 * The collapsed row is exactly one line. A pathologist scanning for "the run I
 * did before lunch" reads down a column of times and states; a three-line card
 * per run turns twenty analyses into a scroll. Everything that is only wanted
 * once a specific run is in question — the messages, the buttons, the outputs —
 * lives in {@link jobMessages} and {@link jobActions}, behind the expander.
 *
 * The list, the search and the filters live in `jobs-window.mjs`; the status
 * vocabulary and the time handling live in `job-status.mjs`, free of the DOM.
 */

/** Percent complete as an integer, or undefined when the backend reports none. */
function progressPercent(job) {
    if (!Number.isFinite(job?.progress)) return undefined;
    return Math.round(Math.max(0, Math.min(1, job.progress)) * 100);
}

function failureText(job) {
    return job?.error_message
        || job?.input_validation_error_message
        || job?.output_validation_error_message
        || "";
}

/**
 * One analysis, collapsed to a single line.
 *
 * @param plugin the app-ui plugin (for `t`, actions and the workbench)
 * @param job the job record
 * @param opts.visible whether its output is on the slide right now
 * @param opts.latest whether it is the newest finished analysis
 * @param opts.expanded whether the detail pane below it is open
 * @param opts.showMode render the job's mode — only useful when several are listed
 * @param opts.onToggleVisible / onSolo / onExpand
 */
export function jobRow(plugin, job, opts) {
    const t = (key, args) => plugin.t(key, args);
    const percent = progressPercent(job);
    const running = RUNNING_STATUSES.has(job.status);
    const failure = failureText(job);

    return div({
        class: "rounded bg-base-200 px-1 flex items-center gap-1 h-7"
            // A hidden analysis stays legible but recedes — the same grammar the
            // shader layer list uses for a hidden layer.
            + (opts.visible ? "" : " opacity-60"),
    },
        button({
            type: "button",
            class: "btn btn-ghost btn-xs px-1 min-h-0 h-5",
            title: opts.visible ? t("jobs.hideOutput") : t("jobs.showOutput"),
            onclick: (e) => {
                // Alt-click is the keyboard-free way to say "only this one".
                if (e.altKey) opts.onSolo();
                else opts.onToggleVisible();
            },
            oncontextmenu: (e) => { e.preventDefault(); opts.onSolo(); },
        }, i({ class: `ph-light ${opts.visible ? "ph-eye" : "ph-eye-slash"}` })),

        button({
            type: "button",
            class: "flex-1 min-w-0 text-left flex items-center gap-2 h-full",
            title: t(opts.expanded ? "jobs.collapseHint" : "jobs.expandHint"),
            onclick: () => opts.onExpand(),
        },
            i({ class: `ph-light text-xs ${opts.expanded ? "ph-caret-down" : "ph-caret-right"}` }),
            span({ class: "font-mono text-xs shrink-0", title: job.id }, job.id.slice(0, 8)),
            // Time is the column the eye actually scans, so it stays on the row
            // and gives up its space last.
            span({ class: "text-xs opacity-60 truncate" }, relativeTime(t, jobTime(job))),
        ),

        // A failure says so on the row; *what* it said is one click away. Wrapped
        // error text was what made these rows three lines tall.
        failure
            ? i({
                class: "ph-light ph-warning-circle text-warning text-xs shrink-0",
                title: failure,
            })
            : span(),

        running && percent !== undefined
            ? span({ class: "text-xs opacity-60 shrink-0 tabular-nums" }, `${percent}%`)
            : Number.isFinite(job.runtime)
                ? span({ class: "text-xs opacity-60 shrink-0 tabular-nums" },
                    t("jobs.runtime", { seconds: Math.round(job.runtime) }))
                : span(),

        // Which step produced this. The list carries every mode's jobs now, and
        // "preprocessing" versus "standalone" is the difference between a result
        // the platform made and one the user asked for.
        opts.showMode && modeOf(job)
            ? span({ class: "badge badge-xs badge-ghost shrink-0", title: t(`jobs.mode.${modeOf(job)}`) },
                t(`jobs.modeShort.${modeOf(job)}`))
            : span(),
        // The batch being assembled is an ordinary ASSEMBLY row; without this it
        // is indistinguishable from an abandoned one, which is the difference
        // between "Run" and "delete this".
        plugin.isCurrentBatch(job.id)
            ? span({ class: "badge badge-xs badge-primary shrink-0", title: t("jobs.draftHint") },
                t("jobs.draft"))
            : span(),
        opts.latest
            ? span({ class: "badge badge-xs badge-outline shrink-0", title: t("jobs.latestHint") },
                t("jobs.latest"))
            : span(),
        span({ class: `badge badge-xs shrink-0 ${statusClass(job.status)}` },
            t(`jobs.status.${job.status}`)),
    );
}

/**
 * Progress and the full messages — what the collapsed row could only hint at
 * with a warning icon. Renders nothing at all when there is nothing to say, so
 * a healthy analysis costs the detail pane no vertical space.
 */
export function jobMessages(plugin, job) {
    const percent = progressPercent(job);
    const running = RUNNING_STATUSES.has(job.status);
    const validationError = job.input_validation_error_message || job.output_validation_error_message;
    const bar = running && percent !== undefined;

    if (!bar && !job.error_message && !validationError) return undefined;

    return div({ class: "flex flex-col gap-1" },
        bar
            ? progress({ class: "progress progress-info h-1", value: String(percent), max: "100" })
            : span(),
        job.error_message
            ? span({ class: "text-xs text-error break-words" }, job.error_message)
            : span(),
        validationError
            ? span({ class: "text-xs text-warning break-words" }, validationError)
            : span(),
    );
}

/**
 * Run / stop / delete, as one compact icon group that sits beside the output
 * chips rather than claiming a line of its own.
 *
 * Buttons stay clickable when the backend would refuse: the click handler
 * explains why (`plugin.deleteJob` / `stopJob` check first and toast). A control
 * that vanishes, or greys out and swallows the click, leaves the user guessing.
 *
 * @param opts.readOnly the platform owns the jobs (preprocessing mode)
 */
export function jobActions(plugin, job, opts = {}) {
    const t = (key, args) => plugin.t(key, args);
    if (opts.readOnly) return undefined;
    const running = RUNNING_STATUSES.has(job.status);

    return div({ class: "flex gap-1 shrink-0" },
        job.status === "READY" || job.status === "ASSEMBLY"
            ? button({
                class: "btn btn-xs btn-primary",
                title: t("jobs.run"),
                onclick: () => plugin.runJob(job.id),
            }, i({ class: "ph-light ph-play mr-1" }), t("jobs.run"))
            : span(),
        running
            ? button({
                class: `btn btn-xs btn-warning ${plugin.workbench.canStopJob(job) ? "" : "opacity-50"}`,
                title: plugin.workbench.canStopJob(job) ? t("jobs.stop") : t("jobs.stopNotPossible"),
                onclick: () => plugin.stopJob(job.id),
            }, i({ class: "ph-light ph-stop mr-1" }), t("jobs.stop"))
            : span(),
        button({
            class: `btn btn-xs btn-ghost px-1 ${plugin.workbench.canDeleteJob(job) ? "" : "opacity-50"}`,
            title: plugin.workbench.canDeleteJob(job)
                ? t("jobs.delete") : t("jobs.deleteOnlyBeforeRun"),
            onclick: () => plugin.deleteJob(job.id),
        }, i({ class: "ph-light ph-trash" })),
    );
}
