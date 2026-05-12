// Two `UTILITIES.*` helpers extracted from src/app.ts:
//   - `setImageMeasurements` configures the OpenSeadragon scalebar from physical measurements.
//   - `parseBackgroundAndGoal` reconciles activeBackgroundIndex / activeVisualizationIndex
//     options against per-background `goalIndex` fields.
//
// Both are pure assignments to `window.UTILITIES`; nothing here captures
// app-boot locals, so a no-arg installer is enough.

import { BackgroundConfig } from "../background-config";

export function installScalebarUtilities(): void {
    /**
     * Set current viewer real world measurements. Set undefined values to fallback to pixels.
     * @param name the wsi name, for dialog message
     */
    UTILITIES.setImageMeasurements = function (viewer: OpenSeadragon.Viewer, microns: number | undefined, micronsX: number | undefined, micronsY: number | undefined, name: string) {
        let ppm = microns, ppmX = micronsX, ppmY = micronsY,
            lengthFormatter = OpenSeadragon.ScalebarSizeAndTextRenderer.METRIC_LENGTH;
        if (ppmX && ppmY) {
            ppm = undefined; //if both specified, just prefer the specific values
            ppmX = 1e6 / ppmX;
            ppmY = 1e6 / ppmY;
        } else if (!ppm) {
            //else if not anything, just set 1 to measure as pixels
            lengthFormatter = OpenSeadragon.ScalebarSizeAndTextRenderer.METRIC_GENERIC.bind(null, "px");
            ppm = 1;
        } else ppm = 1e6 / ppm;

        const magMicrons = microns || ((micronsX ?? 0) + (micronsY ?? 0)) / 2;

        // todo try read metadata about magnification and warn if we try to guess
        const values = [4, 2, 2, 4, 1, 10, 0.5, 20, 0.25, 40]; // Micron values at magnification levels
        let index = 0, best = Infinity, mag: number | undefined;
        if (magMicrons) {
            while (index < values.length) {
                const dev = Math.abs(magMicrons - (values[index] ?? 0));
                // Select the best match with the smallest deviation
                if (dev < best && dev <= (values[index] ?? 0)) {
                    best = dev;
                    mag = values[index + 1]; // Adjust to get the corresponding magnification
                }
                index += 2;
            }
            if (mag === undefined) {
                if (magMicrons > 4) {
                    Dialogs.show($.t("error.macroImage", { image: name }), 10000, Dialogs.MSG_WARN);
                } else {
                    console.error("Failed to find matching magnification for microns!", microns);
                }
            }
        }

        viewer.makeScalebar({
            pixelsPerMeter: ppm,
            pixelsPerMeterX: ppmX,
            pixelsPerMeterY: ppmY,
            sizeAndTextRenderer: lengthFormatter,
            stayInsideImage: false,
            location: OpenSeadragon.ScalebarLocation.BOTTOM_LEFT,
            xOffset: 5,
            yOffset: 10,
            backgroundColor: "rgba(255, 255, 255, 0.5)",
            fontSize: "small",
            barThickness: 2,
            destroy: false,
            magnification: mag,
            maxMagnification: 40
        });
        if (!APPLICATION_CONTEXT.getOption("scaleBar", true)) {
            viewer.scalebar.setActive(false);
        }
    };

    /**
     * Parse & set active background(s) and overlay(s).
     * - activeBackgroundIndex: undefined | number | number[]
     * - activeVisualizationIndex: undefined | number | (number|undefined)[]
     *
     * If arg is null => erase (set option to undefined).
     * If arg is undefined => keep the stored option.
     *
     * Modifies the viewer session configuration accordingly. Used mainly internally
     * by openViewerWith(...)
     *
     * @param {Number|Array<number>|undefined|null} [bgSpec=undefined]
     * @param {Number|Array<number>|undefined|null} [vizSpec=undefined]
     * @param {Object} [opts]
     * @param {boolean} [opts.deriveOverlayFromBackgroundGoals]
     *        If true, ignore vizSpec and derive overlays from cfg.background[i].goalIndex.
     * @return {boolean} true if something needed change
     */
    window.UTILITIES.parseBackgroundAndGoal = function (
        bgSpec = undefined,
        vizSpec = undefined,
        { deriveOverlayFromBackgroundGoals = false } = {}
    ) {
        const cfg = APPLICATION_CONTEXT.config;
        let backgrounds = Array.isArray(cfg.background) ? cfg.background : [];
        const vizCount = Array.isArray(cfg.visualizations) ? cfg.visualizations.length : 0;

        let filteredBackgrounds: Array<BackgroundConfig> = backgrounds.filter((bg: any) => {
            if (!(bg instanceof BackgroundConfig)) {
                console.error('Config not of BackgroundConfig instance, filtering out', bg);
                return false;
            }
            return true;
        });
        if (filteredBackgrounds.length !== backgrounds.length) {
            backgrounds = filteredBackgrounds;
            Dialogs.show('Viewer does not show all files - some were not properly configured!', 8000, Dialogs.MSG_WARN);
        }
        // todo also other items should have class models

        const clampIndex = (i: any, max: number): number | undefined =>
            Number.isInteger(i) && i >= 0 && i < max ? i : undefined;

        const normIndexValue = (v: any, max: number) => (v == null ? undefined : clampIndex(v, max));

        // Normalize an index or array of indices; preserves explicit undefined entries (via null/undefined)
        const normalizeIndexArg = (arg: any, max: number) => {
            if (arg == null) return undefined;
            if (Array.isArray(arg)) {
                return arg.map(v => normIndexValue(v, max));
            }
            return clampIndex(arg, max);
        };

        // From a bgArg produce: undefined | number | number[]
        const selectBackgroundIndices = (bgArg: any, bgCount: number) => {
            const norm = normalizeIndexArg(bgArg, bgCount);
            if (norm === undefined) return undefined;
            if (Array.isArray(norm)) {
                const seen = new Set();
                const out = [];
                for (const v of norm) {
                    if (v === undefined) continue;
                    if (!seen.has(v)) {
                        seen.add(v);
                        out.push(v);
                    }
                }
                if (out.length === 0) return undefined;
                return out.length === 1 ? out[0] : out;
            }
            return norm;
        };

        // Build visualization spec
        const buildVis = (visArg: any, bgIndices: number | number[] | undefined) => {
            if (bgIndices === undefined) return undefined;

            const toAlignedArray = (len: number, sourceArray: any[]) => {
                const out = new Array(len);
                for (let i = 0; i < len; i++) {
                    const raw = sourceArray[i];
                    out[i] = raw === undefined ? undefined : clampIndex(raw, vizCount);
                }
                return out;
            };

            // If a single number: apply it to all selected backgrounds
            if (Number.isInteger(visArg)) {
                if (Array.isArray(bgIndices)) {
                    const idx = clampIndex(visArg, vizCount);
                    return bgIndices.map(() => idx);
                }
                return clampIndex(visArg, vizCount);
            }

            // If an array: align 1:1 to backgrounds (truncate/ignore extra overlays)
            if (Array.isArray(visArg)) {
                const norm = visArg.map(v => (v == null ? undefined : clampIndex(v, vizCount)));
                if (Array.isArray(bgIndices)) return toAlignedArray(bgIndices.length, norm);
                // single bg: preserve an explicit cleared selection (`[undefined]`)
                // so callers can distinguish "show none" from "leave unchanged".
                if (norm.length > 0) return [norm[0]];
                return undefined;
            }

            // visArg undefined => no overlays
            if (Array.isArray(bgIndices)) return bgIndices.map(() => undefined);
            return undefined;
        };

        // Derive overlays from cfg.background[i].goalIndex (used when flag is on)
        const deriveVisFromGoals = (bgIndices: number | number[] | undefined) => {
            const getGoal = (i: number): number | undefined => {
                const g = backgrounds[i] && typeof backgrounds[i].goalIndex === "number"
                    ? backgrounds[i].goalIndex
                    : undefined;
                return clampIndex(g, vizCount);
            };

            if (bgIndices === undefined) return undefined;

            if (Array.isArray(bgIndices)) return bgIndices.map(getGoal);
            return getGoal(bgIndices as number);
        };

        const normalizeStoredBackgroundSelection = (value: any): number[] | undefined => {
            if (value == null) return undefined;
            if (Array.isArray(value)) {
                const filtered = value
                    .map((v: any) => clampIndex(v, backgrounds.length))
                    .filter((v: any) => Number.isInteger(v));
                return filtered.length > 0 ? filtered : undefined;
            }
            const normalized = clampIndex(value, backgrounds.length);
            return normalized === undefined ? undefined : [normalized];
        };

        const normalizeStoredVisualizationSelection = (value: any): Array<number | undefined> | undefined => {
            if (value == null) return undefined;
            if (Array.isArray(value)) {
                return value.map((v: any) => clampIndex(v, vizCount));
            }
            const normalized = clampIndex(value, vizCount);
            return normalized === undefined ? undefined : [normalized];
        };

        let updated = false;

        // ---------- Handle bgSpec (null => erase; undefined => keep; value => set) ----------
        let effectiveBg = normalizeStoredBackgroundSelection(
            APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, true, true)
        );
        if (bgSpec === null) {
            APPLICATION_CONTEXT.setOption("activeBackgroundIndex", undefined);
            updated = true;
            effectiveBg = undefined;
        } else if (bgSpec !== undefined) {
            const newActiveBg = selectBackgroundIndices(bgSpec, backgrounds.length);
            const normalizedActiveBg = normalizeStoredBackgroundSelection(newActiveBg);
            const prevActiveBg = normalizeStoredBackgroundSelection(
                APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, true, true)
            );
            if (JSON.stringify(prevActiveBg) !== JSON.stringify(normalizedActiveBg)) {
                APPLICATION_CONTEXT.setOption("activeBackgroundIndex", normalizedActiveBg);
                updated = true;
            }
            effectiveBg = normalizedActiveBg;
        }

        // Always have a convenient array view of selected backgrounds
        const selectedBgArray =
            effectiveBg === undefined ? [] : (Array.isArray(effectiveBg) ? effectiveBg : [effectiveBg]);

        // We will need bgIndices in later logic
        const bgIndicesForViz = effectiveBg === undefined
            ? undefined
            : (Array.isArray(effectiveBg) ? effectiveBg : effectiveBg);

        // ---------- Handle vizSpec / derivation ----------
        if (vizSpec === null) {
            // erase overlays
            const prevActiveVis = normalizeStoredVisualizationSelection(
                APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, true, true)
            );
            if (prevActiveVis !== undefined) {
                APPLICATION_CONTEXT.setOption("activeVisualizationIndex", undefined);
                updated = true;
            }
            selectedBgArray.forEach((bgIdx) => {
                const b = backgrounds[bgIdx];
                if (!b) return;
                if (b.goalIndex !== undefined) {
                    b.goalIndex = undefined;
                    updated = true;
                }
            });
        } else {
            // When derive flag is ON, derive overlays from per-background goalIndex,
            // regardless of whether vizSpec is provided or undefined.
            let desiredActiveVis: undefined | (number | undefined)[] | number;
            if (deriveOverlayFromBackgroundGoals) {
                desiredActiveVis = deriveVisFromGoals(bgIndicesForViz);
            } else if (vizSpec !== undefined) {
                desiredActiveVis = buildVis(vizSpec, bgIndicesForViz);
            } // else: vizSpec === undefined and derive flag is false => keep existing option

            if (typeof desiredActiveVis !== "undefined") {
                const normalizedActiveVis = normalizeStoredVisualizationSelection(desiredActiveVis);
                const prevActiveVis = normalizeStoredVisualizationSelection(
                    APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, true, true)
                );
                if (JSON.stringify(prevActiveVis) !== JSON.stringify(normalizedActiveVis)) {
                    APPLICATION_CONTEXT.setOption("activeVisualizationIndex", normalizedActiveVis);
                    updated = true;
                }
                desiredActiveVis = normalizedActiveVis;

                // Persist per-background goalIndex when we have a concrete desiredActiveVis
                if (selectedBgArray.length > 0) {
                    if (Array.isArray(desiredActiveVis)) {
                        selectedBgArray.forEach((bgIdx, i) => {
                            const ov = (desiredActiveVis as Array<number>)[i];
                            const b = backgrounds[bgIdx];
                            if (!b) return;
                            if (b.goalIndex !== ov) {
                                b.goalIndex = ov;
                                updated = true;
                            }
                        });
                    } else if (Number.isInteger(desiredActiveVis)) {
                        selectedBgArray.forEach(bgIdx => {
                            const b = backgrounds[bgIdx];
                            if (!b) return;
                            if (b.goalIndex !== desiredActiveVis) {
                                b.goalIndex = desiredActiveVis;
                                updated = true;
                            }
                        });
                    }
                }
            }
        }
        return updated;
    };
}
