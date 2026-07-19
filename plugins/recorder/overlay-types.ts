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

export const ANCHOR_LIST: RecorderOverlayAnchor[] = [
    "tl", "tc", "tr",
    "ml", "mc", "mr",
    "bl", "bc", "br",
];
