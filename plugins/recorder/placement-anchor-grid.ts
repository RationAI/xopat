/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../modules/recorder/recorder.d.ts" />

import { ANCHOR_LIST } from "./overlay-types";

interface AnchorGridProps {
    value: RecorderOverlayAnchor;
    onChange(next: RecorderOverlayAnchor): void;
}

/**
 * 3×3 anchor picker. Returns a self-contained element; pass `value` to
 * reflect the current selection and `onChange` to be notified when the user
 * clicks a different cell.
 */
// Cell visual sizing kept compact so the picker fits inline with a card's
// title/delete row without dominating the header.
const CELL_BASE = "w-4 h-4 rounded-sm cursor-pointer transition-colors";
const CELL_IDLE = "bg-base-content/15 hover:bg-base-content/30";
const CELL_ACTIVE = "bg-primary";

export function createAnchorGrid({ value, onChange }: AnchorGridProps): HTMLDivElement {
    const { div } = van.tags;
    // Selection is one state the whole grid derives from — no per-cell class
    // bookkeeping, no DOM lookups.
    const selected = van.state(value);

    return div({ class: "inline-grid grid-cols-3 gap-[3px] p-1 bg-base-200/60 rounded", "data-role": "anchor-grid" },
        ...ANCHOR_LIST.map(anchor => {
            const commit = () => { selected.val = anchor; onChange(anchor); };
            return div({
                "data-anchor": anchor,
                title: $.t("anchorCell", { anchor, ns: "recorder" }),
                role: "button",
                tabIndex: 0,
                class: () => `${CELL_BASE} ${selected.val === anchor ? CELL_ACTIVE : CELL_IDLE}`,
                onclick: commit,
                onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); commit(); } },
            });
        }),
    ) as HTMLDivElement;
}
