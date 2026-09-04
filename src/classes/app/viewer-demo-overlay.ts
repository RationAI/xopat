/**
 * The full-viewport overlay a viewer shows when it has nothing to render.
 *
 * This used to be one code path for two unrelated situations, which is why it
 * read badly in both: a viewer that was never given any image, and a viewer
 * whose images all failed to open. The first is a product landing page; the
 * second is an incident report. Showing the marketing banner under "the data
 * you are trying to view does not exist" told a user whose slide just broke to
 * look at screenshots of the app they are already in.
 *
 * So there are two modes here:
 *
 *  - **demo** — nothing was requested. Keep the pitch; there is no failure to
 *    describe.
 *  - **failure** — something was requested and none of it opened. Lead with
 *    what failed, name the images, quote the errors the faulty-source registry
 *    collected, and drop the banner entirely.
 *
 * Two constraints shaped the markup:
 *
 *  - **No `innerHTML`.** The previous version injected `error.invalidDataHtml`,
 *    a translated string carrying `<ul><li>` markup, straight into the DOM.
 *    Reasons are now plain strings rendered as real nodes, so a locale file
 *    cannot inject markup and translators stop having to hand-write HTML.
 *  - **No buttons.** An OSD overlay sits under the annotation canvas, so
 *    pointer events do not reach it — `plugins/slide-info` has a commented-out
 *    "Open Slide Manager" button and a TODO saying exactly this. A retry
 *    control that silently does nothing is worse than prose telling the user
 *    what to do, so this stays informational until the overlay is clickable.
 *
 * Styling leans on inline styles plus the handful of utility classes already
 * used at this call site: the shipped Tailwind build is purge-minimised, so a
 * class that is not already in use may not exist (AGENTS §8).
 */

declare const van: any;

export interface DemoOverlayFailedSource {
    /** Human-readable image name, already resolved. */
    name: string;
    /** The error text the registry (or the placeholder source) carries. */
    error?: string;
}

/**
 * Name and error for every failed image in this viewer.
 *
 * Reads the same two signals the shader-menu alert does, in the same order:
 * the persisted per-viewer registry first (it survives rebuilds and viz
 * switches), then the placeholder source's own metadata. `__xopatFaultyBackground`
 * is what makes a dead slot still able to say which background it was meant to
 * hold — without it a placeholder is anonymous.
 */
export function collectFailedSources(viewer: any): DemoOverlayFailedSource[] {
    const out: DemoOverlayFailedSource[] = [];
    const count = viewer?.world?.getItemCount?.() ?? 0;
    for (let i = 0; i < count; i++) {
        const item = viewer.world.getItemAt(i);
        const background = item?.__xopatFaultyBackground;
        if (!background) continue;

        const source = item.source;
        const key = source?.tileSourceId || source?.url || item.__xopatLoadKey;
        const registryError = viewer.__faultySources?.getError?.(key);
        const meta = typeof source?.getMetadata === "function" ? source.getMetadata() : undefined;
        const error = registryError || (meta && meta.error) || undefined;

        out.push({
            name: String(background.name || background.id || $.t("error.demoPage.unnamedImage")),
            error: error ? String(error) : undefined,
        });
    }
    return out;
}

/** A `<ul>` of plain strings — no markup crosses the locale boundary. */
const reasonList = (keys: string[]) => {
    const { ul, li } = van.tags;
    return ul(
        { style: "margin:0.5rem 0 0 1.25rem;list-style:disc;" },
        keys.map(key => li({ style: "margin-bottom:0.15rem;" }, $.t(key))),
    );
};

const brandBanner = () => {
    const { p, img } = van.tags;
    return [
        p({ class: "text-small mx-6 text-center", style: "margin-top:2rem;" },
            $.t("error.demoPage.tagline")),
        img({
            src: "docs/assets/xopat-banner-v3.png",
            alt: "",
            style: "width:80%;display:block;margin:0 auto;",
        }),
    ];
};

/** Nothing was requested: this is a landing page, not an error. */
const buildDemo = (id: string) => {
    const { h1, p, div } = van.tags;
    return div({ id },
        h1($.t("error.demoPage.title")),
        p($.t("error.demoPage.demoLead")),
        reasonList(["error.demoPage.reason.invalidLink", "error.demoPage.reason.sessionLost"]),
        ...brandBanner(),
    );
};

/** Something was requested and none of it opened. */
const buildFailure = (id: string, failed: DemoOverlayFailedSource[]) => {
    const { h1, h2, p, div, i, span, code } = van.tags;

    const detail = failed.length
        ? div({ style: "margin-top:1.5rem;max-width:44rem;" },
            h2({ style: "font-size:1rem;font-weight:600;margin-bottom:0.5rem;" },
                $.t("error.demoPage.whatFailed")),
            ...failed.map(source => div({
                style: "margin-bottom:0.5rem;padding:0.5rem 0.75rem;"
                    + "border-left:3px solid currentColor;opacity:0.85;",
            },
                div({ style: "font-weight:600;" }, source.name),
                source.error
                    // The upstream error verbatim: it is the only thing that
                    // distinguishes "wrong id" from "server down" from "CORS",
                    // and it is what a bug report needs to carry.
                    ? code({ style: "font-size:0.85em;word-break:break-word;" }, source.error)
                    : span({ style: "font-size:0.85em;opacity:0.7;" }, $.t("error.demoPage.noDetail")),
            )),
        )
        : null;

    return div({ id },
        h1({ style: "display:flex;align-items:center;gap:0.5rem;" },
            i({ class: "ph-light ph-warning-circle", style: "font-size:1.2em;" }),
            span($.t("error.demoPage.failureTitle")),
        ),
        p($.t("error.demoPage.failureLead")),
        reasonList([
            "error.demoPage.reason.invalidLink",
            "error.demoPage.reason.notExist",
            "error.demoPage.reason.notAuthorized",
            "error.demoPage.reason.serverDown",
        ]),
        detail,
        p({ style: "margin-top:1.5rem;opacity:0.7;font-size:0.9em;" },
            $.t("error.demoPage.failureHint")),
    );
};

/**
 * Build the overlay element for `viewer`.
 *
 * @param viewer the viewer the overlay belongs to — read for failed sources
 * @param id     DOM id, owned by the caller so the toggle stays idempotent
 * @param isFailure false renders the demo/landing variant
 */
export function buildDemoOverlay(viewer: any, id: string, isFailure: boolean): HTMLElement {
    return isFailure
        ? buildFailure(id, collectFailedSources(viewer))
        : buildDemo(id);
}
