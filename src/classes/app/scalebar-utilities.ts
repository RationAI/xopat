// Two `UTILITIES.*` helpers extracted from src/app.ts:
//   - `setImageMeasurements` configures the OpenSeadragon scalebar from physical measurements.
//   - `parseBackgroundSelection` reconciles `activeBackgroundIndex` against the supplied
//     bgSpec. (Visualization selection now lives on each background entry as
//     `background[i].visualizationIndex`.)
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
        // Honor `params.ui.scaleBar` (and the UI-flag fallback chain) —
        // this runs every time a slide loads, so it must match the
        // boot-time `loader.ts` check that consults `getUiOption`.
        // Previously read the wrong key (`params.scaleBar`), which is why
        // session-level `params.ui.scaleBar = false` had no effect after
        // the first `setImageMeasurements → makeScalebar` cycle reset
        // `_active = true`.
        if (APPLICATION_CONTEXT.getUiOption("scaleBar") === false) {
            viewer.scalebar.setActive(false);
        }
    };

    /**
     * Reconcile the active *background* selection against the stored option.
     * Visualization selection is no longer a separate option — it lives on
     * each background entry as `background[i].visualizationIndex`; callers
     * mutate that field directly (or use `updateViewerSelection` /
     * `openViewerWith` with a `vizSpec` that is folded into bg entries
     * upstream).
     *
     * Semantics for `bgSpec`:
     *   - `undefined` → keep the stored option as-is
     *   - `null`      → erase the stored option (no active bg)
     *   - value       → set / replace
     *
     * @param {Number|Array<number>|undefined|null} [bgSpec=undefined]
     * @return {boolean} true if something needed to change
     */
    window.UTILITIES.parseBackgroundSelection = function (bgSpec = undefined) {
        const cfg = APPLICATION_CONTEXT.config;
        let backgrounds = Array.isArray(cfg.background) ? cfg.background : [];

        let filteredBackgrounds: Array<BackgroundConfig> = backgrounds.filter((bg: any) => {
            if (!(bg instanceof BackgroundConfig)) {
                console.error('Config not of BackgroundConfig instance, filtering out', bg);
                return false;
            }
            return true;
        });
        if (filteredBackgrounds.length !== backgrounds.length) {
            backgrounds = filteredBackgrounds;
            Dialogs.show($.t('error.viewerFilesNotConfigured'), 8000, Dialogs.MSG_WARN);
        }

        const clampIndex = (i: any, max: number): number | undefined =>
            Number.isInteger(i) && i >= 0 && i < max ? i : undefined;

        const normIndexValue = (v: any, max: number) => (v == null ? undefined : clampIndex(v, max));

        const normalizeIndexArg = (arg: any, max: number) => {
            if (arg == null) return undefined;
            if (Array.isArray(arg)) {
                return arg.map(v => normIndexValue(v, max));
            }
            return clampIndex(arg, max);
        };

        const selectBackgroundIndices = (bgArg: any, bgCount: number) => {
            const norm = normalizeIndexArg(bgArg, bgCount);
            if (norm === undefined) return undefined;
            if (Array.isArray(norm)) {
                const seen = new Set();
                const out: number[] = [];
                for (const v of norm) {
                    if (v === undefined) continue;
                    if (!seen.has(v)) {
                        seen.add(v);
                        out.push(v as number);
                    }
                }
                if (out.length === 0) return undefined;
                return out.length === 1 ? out[0] : out;
            }
            return norm;
        };

        const normalizeStoredBackgroundSelection = (value: any): number[] | undefined => {
            if (value == null) return undefined;
            if (Array.isArray(value)) {
                const filtered = value
                    .map((v: any) => clampIndex(v, backgrounds.length))
                    .filter((v: any): v is number => Number.isInteger(v));
                return filtered.length > 0 ? filtered : undefined;
            }
            const normalized = clampIndex(value, backgrounds.length);
            return normalized === undefined ? undefined : [normalized];
        };

        if (bgSpec === undefined) return false;

        if (bgSpec === null) {
            APPLICATION_CONTEXT.setOption("activeBackgroundIndex", undefined);
            return true;
        }

        const newActiveBg = selectBackgroundIndices(bgSpec, backgrounds.length);
        const normalizedActiveBg = normalizeStoredBackgroundSelection(newActiveBg);
        const prevActiveBg = normalizeStoredBackgroundSelection(
            APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, true, true)
        );
        if (JSON.stringify(prevActiveBg) !== JSON.stringify(normalizedActiveBg)) {
            APPLICATION_CONTEXT.setOption("activeBackgroundIndex", normalizedActiveBg);
            return true;
        }
        return false;
    };
}
