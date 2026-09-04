/**
 * Placing an overlay by the pixel scale it declares.
 *
 * OpenSeadragon normalizes every image in a viewer's world to viewport width 1.
 * Two images therefore overlap correctly only when their aspect ratios match —
 * which is a coincidence, not a guarantee, and it fails in a way that is easy to
 * miss: the overlay still covers the slide, just at slightly the wrong scale,
 * with the error accumulating from the origin.
 *
 * The case that motivated this: a model predicts on 512 x 512-pixel squares over
 * a 105185 x 221772 slide. That is 205.44 squares across, so the mask is 206
 * cells wide and covers 105472 slide pixels — a superset, its edge column
 * hanging past the slide. OSD squeezed those 206 cells back into 105185 px,
 * making each cell 510.61 px instead of 512 and putting the far corner nearly a
 * full cell out of place.
 *
 * `pixelScale` states the missing fact — how many reference pixels one of this
 * image's pixels covers — and these two functions turn it into a viewport width.
 * Both are pure so the arithmetic and the refusals can be tested without a
 * viewer; `viewer-open-pipeline.ts` is the only caller.
 */

/** Beyond this, a value is a typo or an attack, not a co-registered overlay. */
export const MAX_PIXEL_SCALE = 65536;

/**
 * Read a data spec's `pixelScale` as a positive, finite horizontal scale.
 *
 * Session data is third-party controllable (AGENTS.md §7), so this is a
 * validation boundary rather than a cast. Anything that is not a positive finite
 * number — absent, `0`, negative, `NaN`, a string, an object with no usable `x` —
 * means "no opinion" and yields `undefined`, leaving the image placed exactly as
 * it was before the field existed. An overlay is never worth failing an open
 * over, so nothing here throws.
 *
 * @param spec a `DataSpecification`; a bare `DataID` string has no fields and
 *     is correctly ignored
 * @param onWarn optional sink for the "you wrote something, it was refused"
 *     message — silence would make a typo indistinguishable from omission
 */
export function readPixelScale(
    spec: any,
    onWarn?: (message: string, value: unknown) => void,
): number | undefined {
    if (!spec || typeof spec !== "object") return undefined;

    const raw = (spec as any).pixelScale;
    if (raw === undefined || raw === null) return undefined;

    const value = (typeof raw === "object") ? (raw as any).x : raw;

    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        onWarn?.("`pixelScale` must be a positive finite number; ignoring it.", raw);
        return undefined;
    }
    if (value > MAX_PIXEL_SCALE || value < 1 / MAX_PIXEL_SCALE) {
        onWarn?.(`\`pixelScale\` is outside the supported range ` +
            `[${1 / MAX_PIXEL_SCALE}, ${MAX_PIXEL_SCALE}]; ignoring it.`, raw);
        return undefined;
    }
    return value;
}

/**
 * Viewport width for an overlay of `ownWidth` pixels, each covering `scaleX`
 * pixels of a reference image `referenceWidth` pixels wide.
 *
 *     width = ownWidth * scaleX / referenceWidth
 *
 * Only a width is produced. OpenSeadragon derives height from the image's own
 * aspect ratio, which is already correct whenever both axes share a scale — and
 * when they do not, the image itself encodes the difference.
 *
 * `placementWidth` is the stack's own viewport width when it has one (a
 * virtual-region crop places every tile of the stack at the region's fraction).
 * It MULTIPLIES rather than replaces: a cropped stack should scale its overlay
 * by the crop too, or the overlay would ignore the crop entirely.
 *
 * @returns the width, or `undefined` when the inputs cannot produce a usable one
 */
export function computeOverlayWidth({
    ownWidth,
    referenceWidth,
    scaleX,
    placementWidth,
}: {
    ownWidth: number | undefined;
    referenceWidth: number | undefined;
    scaleX: number | undefined;
    placementWidth?: number | undefined;
}): number | undefined {
    if (!(typeof ownWidth === "number" && ownWidth > 0)) return undefined;
    if (!(typeof referenceWidth === "number" && referenceWidth > 0)) return undefined;
    if (!(typeof scaleX === "number" && Number.isFinite(scaleX) && scaleX > 0)) return undefined;

    const base = (ownWidth * scaleX) / referenceWidth;
    const stack = (typeof placementWidth === "number" && Number.isFinite(placementWidth) && placementWidth > 0)
        ? placementWidth
        : 1;

    const width = base * stack;
    return Number.isFinite(width) && width > 0 ? width : undefined;
}
