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
    const wrap = document.createElement("div");
    wrap.className = "inline-grid grid-cols-3 gap-[3px] p-1 bg-base-200/60 rounded";
    wrap.dataset.role = "anchor-grid";

    const cells = new Map<RecorderOverlayAnchor, HTMLDivElement>();
    let current = value;

    const setSelected = (next: RecorderOverlayAnchor) => {
        if (next === current) return;
        cells.get(current)?.classList.remove(...CELL_ACTIVE.split(" "));
        cells.get(current)?.classList.add(...CELL_IDLE.split(" "));
        const el = cells.get(next);
        if (el) {
            el.classList.remove(...CELL_IDLE.split(" "));
            el.classList.add(...CELL_ACTIVE.split(" "));
        }
        current = next;
    };

    for (const anchor of ANCHOR_LIST) {
        const cell = document.createElement("div");
        cell.dataset.anchor = anchor;
        cell.title = `Anchor: ${anchor}`;
        cell.setAttribute("role", "button");
        cell.tabIndex = 0;
        cell.className = `${CELL_BASE} ${anchor === value ? CELL_ACTIVE : CELL_IDLE}`;
        const commit = () => { setSelected(anchor); onChange(anchor); };
        cell.onclick = commit;
        cell.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); commit(); } };
        cells.set(anchor, cell);
        wrap.appendChild(cell);
    }

    return wrap;
}
