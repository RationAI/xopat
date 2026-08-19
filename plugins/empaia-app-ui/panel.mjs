import { createRoiSection } from "./sections/roi.mjs";
import { RUNNING_STATUSES } from "./sections/job-status.mjs";

const van = globalThis.van;
const { div, span, p, h3, select, option, button, i } = van.tags;

/**
 * The workbench panel.
 *
 * A plain Van.js composition rather than a `BaseComponent` subclass: every part
 * of it is a reactive read of the plugin's state, with no per-component state,
 * lifecycle or styling API of its own to justify the extra layer. Controls that
 * do have shared behaviour (buttons) come from `UI.*`.
 */
export function createEmpaiaPanel(plugin) {
    const t = (key, args) => plugin.t(key, args);
    const s = plugin.state;

    return div({ class: "flex flex-col gap-3 p-2 text-sm" },
        statusBanner(),
        // Everything below is meaningless until the session is up.
        () => s.status.val !== "ready" ? div() : div({ class: "flex flex-col gap-3" },
            errorBanner(),
            examinationHeader(plugin),
            slidesSection(plugin),
            modeSection(plugin),
            createRoiSection(plugin),
            analysesSummary(plugin),
        ),
    );

    function statusBanner() {
        return () => {
            switch (s.status.val) {
                case "loading":
                    return div({ class: "alert alert-info py-2" },
                        span({ class: "loading loading-spinner loading-sm" }),
                        span(t("status.connecting")));
                case "not-embedded":
                    return div({ class: "alert alert-warning py-2 flex-col items-start" },
                        span({ class: "font-semibold" }, t("status.notEmbeddedTitle")),
                        span({ class: "text-xs" }, t("status.notEmbedded")));
                case "failed":
                    return div({ class: "alert alert-error py-2 flex-col items-start" },
                        span({ class: "font-semibold" }, t("status.failedTitle")),
                        span({ class: "text-xs break-words" }, s.statusMessage.val || ""));
                default:
                    return div();
            }
        };
    }

    function errorBanner() {
        return () => s.error.val
            ? div({ class: "alert alert-error py-2 text-xs break-words" }, s.error.val)
            : div();
    }
}

/**
 * Analyses live in their own window now.
 *
 * What stays here is the one thing worth knowing while drawing regions — is
 * anything running, and is anything painted on the slide — plus the way in.
 * The list itself was the reason this panel had to be scrolled past.
 */
function analysesSummary(plugin) {
    const t = (key, args) => plugin.t(key, args);
    const s = plugin.state;

    return div({ class: "flex flex-col gap-1" },
        h3({ class: "font-semibold" }, t("jobs.title")),
        () => {
            const jobs = s.jobs.val;
            const running = jobs.filter(job => RUNNING_STATUSES.has(job.status)).length;
            const shown = plugin.visibleJobIds().length;
            return p({ class: "text-xs opacity-60" },
                jobs.length
                    ? t("jobs.summary", { total: jobs.length, running, shown })
                    : t("jobs.empty"));
        },
        button({
            class: "btn btn-sm btn-outline justify-start normal-case",
            onclick: () => plugin.showJobsWindow(),
        }, i({ class: "ph-light ph-flask mr-1" }), t("jobs.openManager")),
    );
}

function examinationHeader(plugin) {
    const t = (key, args) => plugin.t(key, args);
    return () => {
        const scope = plugin.workbench.getScope();
        if (!scope) return div();
        return div({ class: "rounded bg-base-200 p-2 flex flex-col gap-0.5 text-xs" },
            // The EAD name if the app declares one — the id is a UUID and tells
            // the pathologist nothing. It stays as the hover title.
            row(t("scope.app"), plugin.workbench.getAppName() ?? scope.app_id, scope.app_id),
            row(t("scope.case"), scope.case_id),
            row(t("scope.examination"), scope.examination_id),
        );
    };

    function row(label, value, title) {
        const { div, span } = van.tags;
        return div({ class: "flex gap-2" },
            span({ class: "opacity-60 shrink-0" }, label),
            span({ class: "truncate", title: String(title ?? value ?? "") }, String(value ?? "—")),
        );
    }
}

function slidesSection(plugin) {
    const t = (key, args) => plugin.t(key, args);
    const s = plugin.state;

    return div({ class: "flex flex-col gap-1" },
        h3({ class: "font-semibold" }, t("slides.title")),
        () => {
            const slides = s.slides.val.filter(slide => !slide.deleted);
            if (!slides.length) return p({ class: "opacity-60 text-xs" }, t("slides.empty"));

            return div({ class: "flex flex-col gap-1 max-h-64 overflow-y-auto" },
                ...slides.map(slide => slideRow(plugin, slide)));
        },
    );
}

function slideRow(plugin, slide) {
    const t = (key, args) => plugin.t(key, args);
    const s = plugin.state;
    const label = slide.local_id || slide.id;
    const tags = [slide.stain?.name, slide.tissue?.name, slide.block].filter(Boolean).join(" · ");

    return () => {
        const active = s.activeSlideId.val === slide.id;
        return button({
            class: `btn btn-sm justify-start normal-case ${active ? "btn-primary" : "btn-ghost"}`,
            disabled: s.busy.val ? "disabled" : undefined,
            title: slide.id,
            onclick: () => plugin.openSlide(slide.id),
        },
            i({ class: `ph-light ${active ? "ph-eye" : "ph-image"} mr-1` }),
            div({ class: "flex flex-col items-start leading-tight overflow-hidden" },
                span({ class: "truncate" }, label),
                tags ? span({ class: "text-xs opacity-60 truncate" }, tags) : span(),
            ),
            active ? span({ class: "badge badge-xs ml-auto" }, t("slides.open")) : span(),
        );
    };
}

function modeSection(plugin) {
    const t = (key, args) => plugin.t(key, args);
    const s = plugin.state;

    return div({ class: "flex flex-col gap-1" },
        () => {
            const modes = s.modes.val;
            if (modes.length <= 1) return div();
            return div({ class: "flex items-center gap-2" },
                span({ class: "opacity-60" }, t("mode.label")),
                select({
                    class: "select select-bordered select-xs flex-1",
                    onchange: (e) => plugin.setMode(e.target.value),
                }, ...modes.map(mode => option({
                    value: mode,
                    selected: mode === s.mode.val ? "selected" : undefined,
                }, t(`mode.${mode}`)))),
            );
        },
        () => {
            const report = s.incompatibility.val;
            if (!report) return div();
            return div({ class: "alert alert-warning py-2 flex-col items-start gap-0.5" },
                span({ class: "font-semibold text-xs" }, t("mode.incompatibleTitle")),
                ...report.reasons.map(reason => span({ class: "text-xs" }, reason)),
            );
        },
    );
}
