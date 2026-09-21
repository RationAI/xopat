/**
 * Where the step label, the arrow and the button row go.
 *
 * Pure geometry, ported unchanged from the former `src/external/enjoyhint.js`
 * (`renderLabelWithShape`, lines 835-1158). Kept free of DOM access so the
 * placement can be reasoned about — and, eventually, tested — on its own.
 */

/** Highlight geometry the layout reasons about, after offsets are applied. */
export interface ShapeBox {
    centerX: number;
    centerY: number;
    /** Full width/height of the highlight (for a circle: `radius * 2`). */
    width: number;
    height: number;
    /** Half-extents used for the free-space computation. */
    halfW: number;
    halfH: number;
}

export interface LabelPlacement {
    labelX: number;
    labelY: number;
    arrow: { xFrom: number; yFrom: number; xTo: number; yTo: number; axis: "hor" | "ver" } | null;
    /** No screen region fits the label — it is centred and the arrow dropped. */
    oversized: boolean;
}

/**
 * Pick the emptiest screen region that still fits the label, then derive the
 * label origin and the arrow endpoints.
 *
 * The region scan deliberately keeps the LAST fitting candidate of the
 * area-ascending sort, i.e. the largest region that fits — matching the
 * original loop, which did not break early.
 */
export function placeLabel(shape: ShapeBox, labelWidth: number, labelHeight: number): LabelPlacement {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const topOffset = shape.centerY - shape.halfH;
    const bottomOffset = vh - (shape.centerY + shape.halfH);
    const leftOffset = shape.centerX - shape.halfW;
    const rightOffset = vw - (shape.centerX + shape.halfW);

    const labelShift = vh < 670 ? 130 : 150;
    const labelMargin = vh < 670 ? 0 : 40;
    const labelShiftWithHeight = labelShift + labelHeight + labelMargin;
    const labelVerOffset = shape.halfH + labelShift;

    const areas = [
        { name: "right_center", area: rightOffset * vh, width: rightOffset, height: vh },
        { name: "right_top", area: rightOffset * topOffset, width: rightOffset, height: topOffset },
        { name: "right_bottom", area: rightOffset * bottomOffset, width: rightOffset, height: bottomOffset },
        { name: "left_center", area: leftOffset * vh, width: leftOffset, height: vh },
        { name: "left_top", area: leftOffset * topOffset, width: leftOffset, height: topOffset },
        { name: "left_bottom", area: leftOffset * bottomOffset, width: leftOffset, height: bottomOffset },
        { name: "center_top", area: vw * topOffset, width: vw, height: topOffset },
        { name: "center_bottom", area: vw * bottomOffset, width: vw, height: bottomOffset },
    ];

    const verticalSpaceRequired = vh <= 670 ? labelShiftWithHeight : labelShiftWithHeight + 20;
    areas.sort((a, b) => a.area - b.area);

    let side = "oversized";
    for (const a of areas) {
        if (a.width > labelWidth && a.height > verticalSpaceRequired) side = a.name;
    }

    const rightPosition = shape.centerX + shape.width / 2 + 80;
    const leftPosition = shape.centerX - labelWidth - shape.width / 2 - 80;
    const centralPosition = vw / 2 - labelWidth / 2;
    const topPosition = shape.centerY - labelVerOffset - labelHeight;
    const bottomPosition = shape.centerY + labelVerOffset;
    const centralVerPosition = vh / 2 - verticalSpaceRequired / 2 + 20;

    let labelX = centralPosition;
    let labelY = centralVerPosition;
    let xTo = 0;
    let yTo = 0;
    let axis: "hor" | "ver" = "hor";

    switch (side) {
        case "center_top":
            labelY = topPosition; labelX = centralPosition;
            xTo = shape.centerX; yTo = shape.centerY - shape.height / 2 - 20;
            break;
        case "center_bottom":
            labelY = bottomPosition; labelX = centralPosition;
            xTo = shape.centerX; yTo = shape.centerY + shape.height / 2 + 20;
            break;
        case "left_center":
            labelY = centralVerPosition; labelX = leftPosition;
            xTo = shape.centerX - shape.width / 2 - 20; yTo = shape.centerY;
            axis = "ver";
            break;
        case "left_top":
            labelY = topPosition; labelX = leftPosition;
            xTo = shape.centerX - shape.width / 2; yTo = shape.centerY - 20;
            break;
        case "left_bottom":
            labelY = bottomPosition; labelX = leftPosition;
            xTo = shape.centerX - shape.width / 2; yTo = shape.centerY + 20;
            axis = "ver";
            break;
        case "right_center":
            labelY = centralVerPosition; labelX = rightPosition;
            xTo = shape.centerX + shape.width / 2 + 20; yTo = shape.centerY;
            axis = "ver";
            break;
        case "right_top":
            labelY = topPosition; labelX = rightPosition;
            xTo = shape.centerX + shape.width / 2; yTo = shape.centerY - 20;
            break;
        case "right_bottom":
            labelY = bottomPosition; labelX = rightPosition;
            xTo = shape.centerX + shape.width / 2; yTo = shape.centerY + 20;
            axis = "ver";
            break;
        default:
            return { labelX: centralPosition, labelY: centralVerPosition, arrow: null, oversized: true };
    }

    let xFrom = labelX + labelWidth / 2;
    let yFrom = shape.centerY > labelY + labelHeight / 2 ? labelY + labelHeight : labelY;

    // Target off the top/bottom of the viewport: pin the arrow head to an edge
    // so it still points somewhere visible.
    if (shape.centerY < 0) yTo = 20;
    else if (shape.centerY > vh + 20) yTo = vh - 20;

    // Target vertically inside the label band: leave from the label's side
    // instead of its top/bottom edge, or the arrow doubles back on itself.
    if (shape.centerY >= labelY && shape.centerY <= labelY + labelHeight) {
        xFrom = shape.centerX > labelX ? labelX + labelWidth : labelX;
        yFrom = shape.centerY;
    }

    return { labelX, labelY, arrow: { xFrom, yFrom, xTo, yTo, axis }, oversized: false };
}

export interface RowItem {
    /** Measured width; 0 means "not visible, do not reserve space". */
    width: number;
    place: (left: number, top: number) => void;
}

export interface RowResult {
    /** Final label top — the caller must re-apply it: the row may push the
     *  label up to keep the (label + gap + row) stack inside the viewport. */
    labelY: number;
}

/**
 * Lay the Skip — Prev — (Next | action hint) row out under the label, centred
 * on it and clamped into the viewport.
 *
 * `trailing` is the Next/hint pair: they occupy the same slot (one is hidden)
 * and are BOTH positioned, so whichever becomes visible next render is already
 * in place.
 */
export function placeButtonRow(
    label: { x: number; y: number; width: number; height: number },
    leading: RowItem[],
    trailing: { width: number; place: (left: number, top: number) => void }[],
    isMobile: boolean,
): RowResult {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = isMobile ? 8 : 12;
    const rowHeight = 56;
    const rowGap = isMobile ? 16 : 24;

    const trailWidth = trailing.reduce((m, t) => Math.max(m, t.width), 0);
    const widths = leading.map((i) => i.width).filter((w) => w > 0);
    if (trailWidth) widths.push(trailWidth);
    const rowTotal = widths.reduce((a, b) => a + b, 0) + Math.max(0, widths.length - 1) * gap;

    let rowLeft = label.x + (label.width - rowTotal) / 2;
    if (rowLeft < 16) rowLeft = 16;
    if (rowLeft + rowTotal > vw - 16) rowLeft = Math.max(16, vw - 16 - rowTotal);

    let labelY = label.y;
    let rowTop = labelY + label.height + rowGap;
    if (rowTop + rowHeight > vh - 16) {
        labelY = Math.max(16, vh - 16 - rowHeight - rowGap - label.height);
        rowTop = labelY + label.height + rowGap;
    }
    // Last resort — a label taller than the viewport. Readability of the text
    // wins over the row staying attached to it.
    if (rowTop < labelY + label.height + 4) {
        rowTop = Math.min(labelY + label.height + 4, vh - 16 - rowHeight);
    }

    let cursor = rowLeft;
    for (const item of leading) {
        if (!item.width) continue;
        item.place(cursor, rowTop);
        cursor += item.width + gap;
    }
    for (const t of trailing) t.place(cursor, rowTop);

    return { labelY };
}

/** Keep a positioned box inside the viewport with a 16px inset. */
export function clampIntoViewport(x: number, y: number, rect: DOMRect): { x: number; y: number } {
    const rightOverflow = rect.right - (window.innerWidth - 16);
    if (rightOverflow > 0) x -= rightOverflow;
    if (x < 16) x = 16;
    const bottomOverflow = rect.bottom - (window.innerHeight - 16);
    if (bottomOverflow > 0) y -= bottomOverflow;
    if (y < 16) y = 16;
    return { x, y };
}
