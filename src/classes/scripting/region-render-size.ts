/**
 * Output size of an off-screen region render.
 *
 * A caller says how much detail it wants in ONE of three ways: an explicit `size` box, an
 * optical `magnification`, or a `targetPixels` area budget. The last two are requests, not
 * guarantees — the result is never upsampled past the region's native resolution and never
 * exceeds `maxPixels`, so the effective `scale` is returned for the caller to report.
 * An explicit `size` is a contract instead: one that exceeds `maxPixels` is refused.
 */
export type RegionRenderSizeRequest = {
    /** Region extent in level-0 image pixels. */
    regionWidth: number;
    regionHeight: number;
    size?: { width?: number; height?: number };
    magnification?: number;
    targetPixels?: number;
    /** Objective power of level 0; null/undefined when the slide is uncalibrated. */
    nativeMagnification?: number | null;
    maxPixels: number;
};

export type RegionRenderSize = {
    width: number;
    height: number;
    /** Output pixels per level-0 image pixel (1 = native resolution). */
    scale: number;
    /** Effective optical magnification of the output, or null on an uncalibrated slide. */
    magnification: number | null;
};

const positive = (value: unknown): value is number => typeof value === "number" && value > 0 && Number.isFinite(value);

export function resolveRegionRenderSize(request: RegionRenderSizeRequest): RegionRenderSize {
    const { regionWidth, regionHeight, maxPixels } = request;
    if (!positive(regionWidth) || !positive(regionHeight)) {
        throw new Error("renderRegion requires a region with positive width and height (level-0 image pixels).");
    }
    const aspect = regionWidth / regionHeight;
    const native = positive(request.nativeMagnification) ? request.nativeMagnification : null;

    const sizeWidth = Number(request.size?.width);
    const sizeHeight = Number(request.size?.height);
    const hasSize = sizeWidth > 0 || sizeHeight > 0;
    const hasMagnification = request.magnification !== undefined && request.magnification !== null;
    const hasTarget = request.targetPixels !== undefined && request.targetPixels !== null;

    const given = Number(hasSize) + Number(hasMagnification) + Number(hasTarget);
    if (given === 0) {
        throw new Error("renderRegion requires one of: size.width and/or size.height, magnification, targetPixels.");
    }
    if (given > 1) {
        throw new Error("renderRegion accepts only one of size, magnification and targetPixels.");
    }

    let width: number;
    let height: number;

    if (hasSize) {
        // Fit the region's aspect ratio into the requested box.
        width = sizeWidth;
        height = sizeHeight;
        if (!(height > 0)) height = width / aspect;
        else if (!(width > 0)) width = height * aspect;
        else if (width / height > aspect) width = height * aspect;
        else height = width / aspect;
        width = Math.max(1, Math.round(width));
        height = Math.max(1, Math.round(height));
        if (width * height > maxPixels) {
            throw new Error("Requested region render is too large. Reduce the output size or raise maxPixels.");
        }
    } else {
        if (hasMagnification) {
            if (!positive(request.magnification)) {
                throw new Error("renderRegion magnification must be a positive number.");
            }
            if (!native) {
                throw new Error(
                    "This slide has no magnification calibration, so a magnification cannot be " +
                    "rendered. Pass targetPixels (an output area budget) or size instead."
                );
            }
            width = regionWidth * (request.magnification / native);
        } else {
            if (!positive(request.targetPixels)) {
                throw new Error("renderRegion targetPixels must be a positive number.");
            }
            width = Math.sqrt(request.targetPixels * aspect);
        }
        // Never upsample past native resolution; keep the raster area bounded.
        width = Math.min(width, regionWidth);
        if ((width * width) / aspect > maxPixels) width = Math.sqrt(maxPixels * aspect);
        width = Math.max(1, Math.floor(width));
        height = Math.max(1, Math.floor(width / aspect));
    }

    const scale = width / regionWidth;
    return { width, height, scale, magnification: native ? native * scale : null };
}
