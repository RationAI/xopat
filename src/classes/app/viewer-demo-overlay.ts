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
 *  - **No buttons here.** The page is no longer an OSD overlay — `loader.ts`
 *    mounts it as a screen-fixed layer in the viewer container, so clicks do
 *    reach it now (`plugins/slide-info` puts a real "Open Slide Manager"
 *    button on the empty-viewer variant). This core variant stays
 *    informational because there is no action it could offer: the failure
 *    case has already retried, and the demo case has nothing to open.
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

/**
 * The shell every variant shares: one centred card, capped width, its own
 * pointer events (the host layer is click-through so the canvas keeps
 * working — the card opts back in so the error text can be selected/copied).
 *
 * Inline styles, not utilities: the shipped Tailwind build is purge-minimised
 * and a class that is not already used elsewhere may simply not exist (§8).
 */
const card = (id: string, ...children: any[]) => {
    const { div } = van.tags;
    return div({
        id,
        class: "bg-base-100 border border-base-300 rounded-2xl shadow-lg",
        style: "pointer-events:auto;max-width:34rem;width:100%;"
            + "padding:2rem 2.25rem;text-align:center;"
            + "display:flex;flex-direction:column;align-items:center;"
    }, ...children);
};

const cardIcon = (name: string, extraStyle = "") => {
    const { i } = van.tags;
    return i({
        class: `ph-light ${name}`,
        style: "font-size:3.5rem;line-height:1;margin-bottom:0.75rem;" + extraStyle,
    });
};

const cardTitle = (text: string) => van.tags.h1({
    style: "font-size:1.375rem;font-weight:700;margin:0 0 0.5rem;",
}, text);

const cardLead = (text: string) => van.tags.p({
    class: "opacity-70",
    style: "margin:0;font-size:0.95rem;line-height:1.45;",
}, text);

/**
 * A `<ul>` of plain strings — no markup crosses the locale boundary.
 *
 * Left-aligned inside the centred card: a bulleted list centred item by item
 * is unreadable, the bullets stop forming a column.
 */
const reasonList = (keys: string[]) => {
    const { ul, li } = van.tags;
    return ul(
        {
            class: "opacity-70",
            style: "margin:1rem 0 0;padding-left:1.25rem;list-style:disc;"
                + "text-align:left;font-size:0.9rem;align-self:stretch;",
        },
        keys.map(key => li({ style: "margin-bottom:0.2rem;" }, $.t(key))),
    );
};

const brandBanner = () => {
    const { p, img, div } = van.tags;
    return div({
        class: "border-t border-base-300",
        style: "margin-top:1.75rem;padding-top:1.25rem;align-self:stretch;",
    },
        p({ class: "opacity-60", style: "margin:0 0 0.75rem;font-size:0.8rem;" },
            $.t("error.demoPage.tagline")),
        img({
            src: "docs/assets/xopat-banner-v3.png",
            alt: "",
            style: "width:70%;max-width:18rem;display:block;margin:0 auto;opacity:0.85;",
        }),
    );
};

/** Nothing was requested: this is a landing page, not an error. */
const buildDemo = (id: string) => card(id,
    cardIcon("ph-images", "opacity:0.25;"),
    cardTitle($.t("error.demoPage.title")),
    cardLead($.t("error.demoPage.demoLead")),
    reasonList(["error.demoPage.reason.invalidLink", "error.demoPage.reason.sessionLost"]),
    brandBanner(),
);

/** Something was requested and none of it opened. */
const buildFailure = (id: string, failed: DemoOverlayFailedSource[]) => {
    const { h2, p, div, span, code } = van.tags;

    const detail = failed.length
        ? div({
            style: "margin-top:1.5rem;align-self:stretch;text-align:left;",
        },
            h2({ class: "opacity-70", style: "font-size:0.8rem;font-weight:600;"
                + "text-transform:uppercase;letter-spacing:0.04em;margin:0 0 0.5rem;" },
                $.t("error.demoPage.whatFailed")),
            ...failed.map(source => div({
                class: "bg-base-200 border-error rounded-md",
                style: "margin-bottom:0.5rem;padding:0.5rem 0.75rem;border-left-width:3px;"
                    + "border-left-style:solid;",
            },
                div({ style: "font-weight:600;font-size:0.9rem;" }, source.name),
                source.error
                    // The upstream error verbatim: it is the only thing that
                    // distinguishes "wrong id" from "server down" from "CORS",
                    // and it is what a bug report needs to carry.
                    ? code({ class: "opacity-80", style: "font-size:0.8rem;word-break:break-word;" },
                        source.error)
                    : span({ class: "opacity-60", style: "font-size:0.8rem;" },
                        $.t("error.demoPage.noDetail")),
            )),
        )
        : null;

    return card(id,
        cardIcon("ph-warning-circle", "color:var(--fallback-er,oklch(var(--er)/1));opacity:0.9;"),
        cardTitle($.t("error.demoPage.failureTitle")),
        cardLead($.t("error.demoPage.failureLead")),
        reasonList([
            "error.demoPage.reason.invalidLink",
            "error.demoPage.reason.notExist",
            "error.demoPage.reason.notAuthorized",
            "error.demoPage.reason.serverDown",
        ]),
        detail,
        p({ class: "opacity-60", style: "margin:1.25rem 0 0;font-size:0.85rem;" },
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
