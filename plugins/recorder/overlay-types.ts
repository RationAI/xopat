/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../modules/recorder/recorder.d.ts" />

export function newOverlayId(): string {
    return Math.random().toString(36).slice(2, 10);
}

export function newAssetId(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function defaultPlacement(): RecorderOverlayPlacement {
    return { anchor: "bc", padding: 16 };
}

export function defaultStyle(): RecorderOverlayStyle {
    return {
        fontSize: 14,
        color: "#fff",
        background: "rgba(0,0,0,0.55)",
        opacity: 1,
        borderRadius: 6,
        maxWidth: 320,
    };
}

/**
 * Translate a 9-cell anchor + padding into the CSS properties needed to pin
 * an absolutely-positioned overlay inside its viewer container. Centered
 * anchors use `translate(-50%, …)` so the overlay's own width is irrelevant.
 */
export function anchorToCss(anchor: RecorderOverlayAnchor, padding = 16): Partial<CSSStyleDeclaration> {
    const p = `${padding}px`;
    const css: Partial<CSSStyleDeclaration> = { position: "absolute" };
    const [v, h] = anchor.split("") as ["t" | "m" | "b", "l" | "c" | "r"];

    if (v === "t") css.top = p;
    else if (v === "b") css.bottom = p;
    else { css.top = "50%"; }

    if (h === "l") css.left = p;
    else if (h === "r") css.right = p;
    else { css.left = "50%"; }

    if (v === "m" && h === "c") css.transform = "translate(-50%, -50%)";
    else if (v === "m") css.transform = "translateY(-50%)";
    else if (h === "c") css.transform = "translateX(-50%)";

    return css;
}

/**
 * Translate a layout region into CSS. Unlike {@link anchorToCss}, which only
 * pins a box whose size the author has to guess, a region also decides the
 * box's extent — that is the point of regions: a "bottom" overlay is a band the
 * width of the viewer, not a card that happens to sit at the bottom.
 *
 * Widths are viewer-relative (%) so the same recording reads correctly in a
 * grid cell and in a fullscreen viewer.
 */
export function regionToCss(region: RecorderOverlayRegion, padding = 16): Partial<CSSStyleDeclaration> {
    const p = `${padding}px`;
    const css: Partial<CSSStyleDeclaration> = { position: "absolute" };

    switch (region) {
        case "center":
            // Meant to be read instead of the slide: a wide, centered card.
            css.top = "50%";
            css.left = "50%";
            css.transform = "translate(-50%, -50%)";
            css.maxWidth = "min(60%, 640px)";
            break;
        case "top":
        case "bottom":
            // Informative band: spans the viewer, leaves the opposite half clear.
            css[region] = p;
            css.left = p;
            css.right = p;
            css.maxWidth = "none";
            break;
        case "left":
        case "right":
            // Side column. Narrow on purpose — these edges usually hold app UI.
            css.top = "50%";
            css[region] = p;
            css.transform = "translateY(-50%)";
            css.maxWidth = "min(30%, 360px)";
            break;
    }
    return css;
}

export const ANCHOR_LIST: RecorderOverlayAnchor[] = [
    "tl", "tc", "tr",
    "ml", "mc", "mr",
    "bl", "bc", "br",
];
