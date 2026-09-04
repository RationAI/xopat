/*
 * This software was developed at the National Institute of Standards and
 * Technology by employees of the Federal Government in the course of
 * their official duties. Pursuant to title 17 Section 105 of the United
 * States Code this software is not subject to copyright protection and is
 * in the public domain. This software is an experimental system. NIST assumes
 * no responsibility whatsoever for its use by other parties, and makes no
 * guarantees, expressed or implied, about its quality, reliability, or
 * any other characteristic. We would appreciate acknowledgement if the
 * software is used.
 */

/**
 * @author Antoine Vandecreme <antoine.vandecreme@nist.gov>
 * @author Aiosa (modifications)
 *
 * @typedef ScaleBarConfig
 * @type {object}
 * @property {OpenSeadragon.Viewer} viewer The viewer to attach this Scalebar to.
 * @property {OpenSeadragon.ScalebarType} type The scale bar type. Default: microscopy
 * @property {Number|undefined} pixelsPerMeter The pixels per meter of the
 * zoomable image at the original image size. If null, the scale bar is not
 * displayed. default: null
 * @property {Number|undefined} pixelsPerMeterX The measurement in vertical units,
 * need to specify both X, Y if general not given
 * @property {Number|undefined} pixelsPerMeterY The measurement in horizontal units,
 * need to specify both X, Y if general not given
 * @property {Number|undefined} magnification The maximum magnification availeble
 * in the image (e.g. 20 for 20x or 40 for 40x magnification)
 * @property (String} minWidth The minimal width of the scale bar as a
 * CSS string (ex: 100px, 1em, 1% etc...) default: 150px
 * @property {OpenSeadragon.ScalebarLocation} location The location
 * of the scale bar inside the viewer. default: bottom left
 * @property {Integer} xOffset Offset location of the scale bar along x. default: 5
 * @property {Integer} yOffset Offset location of the scale bar along y. default: 5
 * @property {Boolean} stayInsideImage When set to true, keep the
 * scale bar inside the image when zooming out. default: true
 * @property {String} color The color of the scale bar using a color
 * name or the hexadecimal format (ex: black or #000000) default: black
 * @property {String} fontColor The font color. default: black
 * @property {String} backgroundColor The background color. default: none
 * @property {String} fontSize The font size. default: not set
 * @property {String} fontFamily The font-family. default: not set
 * @property {String} barThickness The thickness of the scale bar in px. default: 2
 * @property {function} sizeAndTextRenderer A function which will be
 * @property {boolean} destroy
 */

// @ts-nocheck -- mechanical port of the former `src/external/scalebar.js`.
// Split out of the single 3388-line IIFE and moved into the core TS build so
// esbuild inlines it into `dist/app.js` instead of shipping it as a separate
// startup <script>. Bodies are unchanged JS; typing them is deliberate
// follow-up work and must not be mixed into a behaviour-identical move.

const OSD: any = (window as any).OpenSeadragon;

import { MAGNIFICATION_STEPS, readCollapsedPreference } from "./constants";
import {
    tiledImageViewportToImageZoom,
    getWithUnitRounded,
    getWithSquareUnitRounded,
    isDefined,
    toSignedRotation,
} from "./units";
import { addQuickZoomChrome, addSyncMenuChrome } from "./chrome";
import { ViewportSyncAPI } from "./viewport-sync-api";

/**
 * @memberOf OpenSeadragon.Viewer
 * @param {(ScaleBarConfig|undefined)} options
 *
 */
OSD.Viewer.prototype.makeScalebar = function(options) {
    options = options || {};
    options.viewer = this;

    if (this.scalebar) {
        this.scalebar.destroy();
    }

    this.scalebar = new OSD.Scalebar(options);
};

OSD.ScalebarType = {
    NONE: 0,
    MICROSCOPY: 1,
    MAP: 2
};

OSD.ScalebarLocation = {
    NONE: 0,
    TOP_LEFT: 1,
    TOP_RIGHT: 2,
    BOTTOM_RIGHT: 3,
    BOTTOM_LEFT: 4
};

/**
 * @private
 * @class OpenSeadragon.Scalebar
 * @param {(ScaleBarConfig|undefined)} options
 * called to determine the size of the scale bar and it's text content.
 * The function must have 2 parameters: the PPM at the current zoom level
 * and the minimum size of the scale bar. It must return an object containing
 * 2 attributes: size and text containing the size of the scale bar and the text.
 * default: OSD.ScalebarSizeAndTextRenderer.METRIC_LENGTH
 */
OSD.Scalebar = function(options) {
    options = options || {};
    if (!options.viewer) {
        throw new Error("A viewer must be specified.");
    }

    //Defaults
    this.viewer = options.viewer;
    this.ViewportSyncAPI = new ViewportSyncAPI(this.viewer);

    this.setDrawScalebarFunction(options.type || OSD.ScalebarType.MICROSCOPY);
    this.color = options.color || "black";
    this.fontColor = options.fontColor || "black";
    this.backgroundColor = options.backgroundColor || "none";
    this.fontSize = options.fontSize || "";
    this.fontFamily = options.fontFamily || "";
    this.barThickness = options.barThickness || 3;

    //todo reflect better in API, allow for distinct measures
    this.pixelsPerMeterX = options.pixelsPerMeterX;
    this.pixelsPerMeterY = options.pixelsPerMeterY;
    this.pixelsPerMeter = options.pixelsPerMeter || (options.pixelsPerMeterX + options.pixelsPerMeterY)/2;
    this.location = options.location || OSD.ScalebarLocation.BOTTOM_LEFT;
    this.xOffset = options.xOffset || 5;
    this.yOffset = options.yOffset || 5;
    this.stayInsideImage = isDefined(options.stayInsideImage) ?
        options.stayInsideImage : true;
    this.sizeAndTextRenderer = options.sizeAndTextRenderer ||
        OSD.ScalebarSizeAndTextRenderer.METRIC_LENGTH;

    this.magnificationContainerHeight = 210;

    //magnification
    this.magnification = options.magnification || false;
    //todo allow specifying levels of magnification

    this.refreshHandler = async function () {
        if (!this.dock) return; // torn down
        if (!this.viewer.isOpen() ||
            !this.drawScalebar ||
            !this.pixelsPerMeter ||
            !this.location) {
            this.scalebarContainer.style.display = "none";
            return;
        }
        this.scalebarContainer.style.display = "";

        // refreshHandler runs on every 'update-viewport' (every rendered frame).
        // Guard all DOM writes on actual value changes: label/size change only when
        // crossing a zoom threshold, location only when panning. Avoids a per-frame
        // innerHTML reparse and layout thrash.
        if (this._scaleCacheContainer !== this.scalebarContainer) {
            // Container was (re)created by _init(); drop stale caches.
            this._scaleCacheContainer = this.scalebarContainer;
            this._lastSize = this._lastText = this._lastLocX = this._lastBottom = undefined;
            // The new container has its own borders/padding, so the learned
            // content-to-border-box constant no longer describes it.
            this._barChromeW = undefined;
        }

        var props = this.sizeAndTextRenderer(this.currentResolution(), this.minWidth);
        if (props.size !== this._lastSize || props.text !== this._lastText) {
            this.drawScalebar(props.size, props.text);
            this._lastSize = props.size;
            this._lastText = props.text;
            // Bar geometry just changed. Derive the new width from the size we
            // just wrote rather than reading it back — an offsetWidth read here,
            // straight after drawScalebar's style writes, is a forced synchronous
            // layout, and this branch runs on every frame of a zoom animation.
            this._noteScalebarWidth(props.size);
        }

        //todo location works only for bottom
        // Only the dock is positioned; the panel/bar arrangement is flexbox.
        // Anchoring by `bottom` (derived from the bar's own bottom edge) means
        // the dock's height never has to be measured — the panel may grow or
        // collapse freely without a reflow on this per-frame path.
        var location = this.getScalebarLocation();
        const bottom = this._contH - (location.y + this._barH);
        if (location.x !== this._lastLocX || bottom !== this._lastBottom) {
            this._lastLocX = location.x;
            this._lastBottom = bottom;
            this.dock.style.left = (location.x + 5) + "px";
            this.dock.style.bottom = bottom + "px";
        }

    }.bind(this);
    this._init(options);
};

OSD.Scalebar.prototype = {
    /**
     * Referenced tile image getter used for measurements
     * todo we should provide references scale image allways and all
     * access on BG data should be via the APP Context
     */
    getReferencedTiledImage: function () {},
    /**
     * OpenSeadragon is not accurate when dealing with
     * multiple tilesources: set your own reference tile source
     */
    linkReferenceTileSourceIndex: function(index) {
        this.getReferencedTiledImage = this.viewer.world.getItemAt.bind(this.viewer.world, index);
    },
    /**
     * Compute size of one pixel in the image on your screen
     * //todo rename to get..() or change to property getter
     * @return {number} image pixel size on screen (should be between 0 and 1 in most cases)
     */
    imagePixelSizeOnScreen: function() {
        let viewport = this.viewer.viewport;
        let zoom = viewport.getZoom(true);
        if (this.__cachedZoom !== zoom) {
            this.__cachedZoom = zoom;

            let tiledImage = this.viewer.world.getItemAt(0);
            //todo proprietary func from before OSD 2.0, remove? search API
            if (tiledImage) {
                this.__pixelRatio = tiledImageViewportToImageZoom(tiledImage, zoom);
            } else {
                this.__pixelRatio = 1;
            }
        }
        return this.__pixelRatio;
    },

    /**
     * Compute the current resolution
     * @return {number}
     */
    currentResolution: function () {
        return this.pixelsPerMeter * this.imagePixelSizeOnScreen()
    },

    /**
     * Convert a viewport zoom level to the real on-screen magnification
     * (e.g. 17.3 for 17.3x), using the image's native resolution and the
     * configured native magnification. Mirrors the math the magnification
     * slider uses so external consumers (scripting API, plugins) report
     * exactly what the user sees on the scalebar.
     * @param {number} vpZoom viewport zoom (as from viewport.getZoom())
     * @return {number|undefined} magnification, or undefined if unknown
     */
    magnificationForViewportZoom: function (vpZoom) {
        if (!this.magnification) return undefined;
        const image = this.viewer.world.getItemAt(0);
        if (!image) return undefined;
        const nativeVpZoom = image.imageToViewportZoom(1);
        if (!nativeVpZoom) return undefined;
        return (vpZoom / nativeVpZoom) * this.magnification;
    },

    /**
     * The real on-screen magnification the user currently sees on the
     * scalebar (e.g. 17.3 for 17.3x). This is NOT the raw OpenSeadragon
     * viewport zoom.
     * @return {number|undefined} magnification, or undefined if no native
     *   magnification is configured for the current image
     */
    getMagnification: function () {
        // getZoom(true) = the zoom currently rendered, the same read the drawn bar uses
        // (see imagePixelSizeOnScreen). getZoom() is the ANIMATION TARGET, so during a
        // zoom animation it reports a magnification the user is not looking at yet.
        return this.magnificationForViewportZoom(this.viewer.viewport.getZoom(true));
    },

    /**
     * Canonical short label for a magnification, e.g. 5 -> "5x", 0.5 -> "0.5x".
     * Single source of truth: the slider pips, the scripting API and anything
     * quoting a magnification to the user (or to an LLM) must render it the same
     * way, or the numbers on screen and the numbers in text drift apart.
     * @param {number} [mag] magnification; defaults to the current one
     * @return {string|undefined} label, or undefined when unknown/uncalibrated
     */
    formatMagnification: function (mag) {
        const value = mag === undefined ? this.getMagnification() : mag;
        if (!Number.isFinite(value) || value <= 0) return undefined;
        return (value < 1 ? value.toFixed(1) : Math.round(value)) + "x";
    },

    /**
     * Inverse of {@link magnificationForViewportZoom}: the viewport zoom
     * that yields the given on-screen magnification. Used by scroll-to-zoom
     * snapping and the magnification slider.
     * @param {number} mag magnification (e.g. 20 for 20x)
     * @return {number|undefined} viewport zoom, or undefined if no native
     *   magnification is configured for the current image
     */
    viewportZoomForMagnification: function (mag) {
        if (!this.magnification) return undefined;
        const image = this.viewer.world.getItemAt(0);
        if (!image) return undefined;
        const nativeVpZoom = image.imageToViewportZoom(1);
        if (!nativeVpZoom) return undefined;
        return (mag / this.magnification) * nativeVpZoom;
    },

    /**
     * The standard magnification stops available for the current image:
     * {@link MAGNIFICATION_STEPS} clamped to the reachable zoom range, with
     * the native magnification inserted if not already present. Sorted
     * ascending. Empty when no native magnification is configured.
     * @param {boolean} [includeBounds=false] also insert the reachable
     *   min/max magnification as stops, even when they are not standard
     *   steps. Stepping paths (scroll snap, slider buttons) need this so the
     *   user can always reach the zoom boundaries; pips leave it off to keep
     *   the ladder labelled with round numbers only.
     * @return {number[]}
     */
    magnificationStops: function (includeBounds) {
        const nativeMag = this.magnification;
        if (!nativeMag) return [];
        const viewport = this.viewer.viewport;
        const minMag = this.magnificationForViewportZoom(viewport.getMinZoom());
        const maxMag = this.magnificationForViewportZoom(viewport.getMaxZoom());
        if (minMag === undefined || maxMag === undefined) return [];
        const lo = Math.min(minMag, maxMag), hi = Math.max(minMag, maxMag);
        const stops = MAGNIFICATION_STEPS.filter(v => v >= lo && v <= hi);
        const insert = (v) => {
            if (!(v > 0) || v < lo || v > hi) return;
            const eps = v * 1e-6 + 1e-9;
            if (!stops.some(s => Math.abs(s - v) <= eps)) stops.push(v);
        };
        insert(nativeMag);
        if (includeBounds) {
            insert(lo);
            insert(hi);
        }
        stops.sort((a, b) => a - b);
        return stops;
    },

    /**
     * The next standard magnification stop from `fromMag` in the given
     * direction. Snapping happens in log2 space with an at-pip epsilon so
     * that when already sitting on (or fractionally near) a stop, we move to
     * the neighbouring stop rather than back onto the current one. The
     * reachable min/max magnifications are always stops here, so the user can
     * step all the way to the zoom boundaries even when those are not
     * standard steps.
     * @param {number} fromMag current magnification
     * @param {number} direction +1 to increase magnification, -1 to decrease
     * @return {number|undefined} target magnification, or undefined if no
     *   stops are available
     */
    nextMagnificationStop: function (fromMag, direction) {
        const stops = this.magnificationStops(true);
        if (!stops.length || !fromMag) return undefined;
        const toLog = (v) => Math.log2(v);
        const curLog = toLog(fromMag);
        const logs = stops.map(toLog);

        // nearest stop to current position
        let idx = 0, minDist = Infinity;
        for (let i = 0; i < logs.length; i++) {
            const d = Math.abs(logs[i] - curLog);
            if (d < minDist) { minDist = d; idx = i; }
        }

        if (direction < 0 && curLog <= logs[idx] + 0.01 && idx > 0) {
            return stops[idx - 1];
        }
        if (direction > 0 && curLog >= logs[idx] - 0.01 && idx < stops.length - 1) {
            return stops[idx + 1];
        }
        // between stops: step to the neighbour in the requested direction
        let nextIdx = idx + (direction > 0 ? 1 : -1);
        if (nextIdx < 0) nextIdx = 0;
        if (nextIdx >= stops.length) nextIdx = stops.length - 1;
        return stops[nextIdx];
    },

    /**
     * Zoom "levels" for an image with no known magnification: the integer
     * log2 viewport-zoom steps inside the reachable range (falling back to
     * five evenly spaced values when the range spans less than one step).
     * Single source of truth for the level slider pips and the collapsed
     * quick-zoom row, so `L3` means the same thing in both.
     * @return {number[]} log2 viewport zooms, ascending
     */
    zoomLevelStops: function () {
        const viewport = this.viewer.viewport;
        const minLog = Math.log2(Math.max(viewport.getMinZoom(), Number.EPSILON));
        const maxLog = Math.log2(Math.max(viewport.getMaxZoom(), viewport.getMinZoom() + Number.EPSILON));
        let values = [];
        for (let step = Math.ceil(minLog); step <= Math.floor(maxLog); step++) {
            values.push(step);
        }
        if (values.length < 2) {
            const count = 5;
            const span = maxLog - minLog;
            values = Array.from({length: count}, (_, i) => minLog + (span * i) / (count - 1));
        }
        const unique = [];
        values.forEach((value) => {
            if (!unique.some((existing) => Math.abs(existing - value) < 1e-6)) unique.push(value);
        });
        return unique;
    },

    /**
     * Physical size of one image pixel, in microns, at full image
     * resolution. Derived from pixelsPerMeter; undefined when the image
     * has no known physical calibration.
     * @return {number|undefined}
     */
    micronsPerPixel: function () {
        return this.pixelsPerMeter ? 1e6 / this.pixelsPerMeter : undefined;
    },

    /**
     * Physical size covered by one on-screen pixel at the current zoom, in
     * microns. Undefined when the image has no known physical calibration.
     * @return {number|undefined}
     */
    micronsPerScreenPixel: function () {
        const res = this.currentResolution();
        return res ? 1e6 / res : undefined;
    },

    /**
     *
     * @return {string}
     */
    imageLengthToGivenUnits: function(length) {
        //todo what about flexibility in units?
        return getWithUnitRounded(length / this.pixelsPerMeter, this.lengthMetric());
    },

    imageAreaToGivenUnits: function(area) {
        //todo what about flexibility in units?
        return getWithSquareUnitRounded(area / (this.pixelsPerMeter*this.pixelsPerMeter), this.areaMetric());
    },

    imageLength: function (length) {
        return length / this.pixelsPerMeter;
    },

    imageArea: function (area) {
        return area / (this.pixelsPerMeter*this.pixelsPerMeter);
    },

    lengthMetric: function () {
        return this.sizeAndTextRenderer === OSD.ScalebarSizeAndTextRenderer.METRIC_LENGTH ? "m" : "px";
    },

    areaMetric: function () {
        return this.sizeAndTextRenderer === OSD.ScalebarSizeAndTextRenderer.METRIC_LENGTH ? "m²" : "px²";
    },

    formatLength: function (unit) {return getWithUnitRounded(unit, this.lengthMetric())},
    formatArea: function (unit) {return getWithSquareUnitRounded(unit, this.areaMetric())},

    _init: function (options) {
        if (!this._ui) {
            this._ui = {
                rotSliderEl: null,
                magSliderEl: null,
                onRotate: null,
                onZoom: null,
                onZoomQuick: null,
                collapsed: readCollapsedPreference(),
                collapsibles: [],
                collapsedOnly: [],
                labelEl: null,
                labelObjectUrl: null
            };
            this._originalClassTarget = noUiSlider.cssClasses.target;
        }
        if (!options.destroy) {
            this.id = options.viewer.id + "-scale-bar";
            this._active = true;
            // One dock holds the magnification panel and the metric bar, so
            // their relative layout is flexbox instead of per-frame absolute
            // math: collapsed = one row (bar right of the controls, wrapping
            // below it when the cell is too narrow), expanded = panel above
            // the bar. Only the dock is positioned per frame.
            if (!this.dock) {
                this.dock = document.createElement("div");
                this.dock.id = this.id + "-dock";
                // z-[1] establishes a local stacking context so the
                // scalebar (and anything elevated inside it) cannot rise
                // above sibling viewer chrome like `.right-side-menu`
                // (z-index: 3).
                this.dock.classList.add(
                    "absolute", "z-[1]", "m-0", "flex", "gap-2", "pointer-events-none"
                );
                // Sensible anchor before the first refreshHandler frame lands.
                this.dock.style.left = (this.xOffset || 5) + "px";
                this.dock.style.bottom = (this.yOffset || 5) + "px";
            }
            this._applyDockLayout();
            this.viewer.container.appendChild(this.dock);

            if (!this.scalebarContainer) {
                this.scalebarContainer = document.createElement("div");
                this.scalebarContainer.classList.add(
                    "m-0",
                    "pointer-events-none",
                    "select-none",
                    "glass",
                    "backdrop-blur-[2px]",
                    "px-3",
                    "py-1",
                    "ring-1",
                    "ring-base-300/40",
                    "text-xs",
                    "font-semibold"
                );
                this.scalebarContainer.id = this.id;
            }
            this.dock.appendChild(this.scalebarContainer);

            if (this.magnification > 0) {
                // We need to wait for the image to open to get bounds for the slider
                const initSlider = () => {
                    if (!this._active) return;

                    const image = this.viewer.world.getItemAt(0);
                    if (!image) return;

                    if (this.magnificationContainer) return;

                    const viewport = this.viewer.viewport;
                    const inside = "oklch(var(--b1))";
                    const outside = "oklch(var(--er))";

                    this.magnificationContainer = document.createElement("div");
                    this.magnificationContainer.id = this.id + "-magnification";
                    // z-[1] both ranks the panel below sibling viewer
                    // chrome (`.right-side-menu` is z-index: 3) and
                    // establishes a stacking context that traps the
                    // sync-header's `z-index: 3` and the slide-label's
                    // hover `z-index: 40` so they cannot leak out into
                    // the parent stacking context and overlap menus.
                    this.magnificationContainer.classList.add(
                        // `relative` (not absolute): the panel is a flex child of
                        // the dock now, and it must still be the containing block
                        // for the absolutely-positioned sync header. z-[1] keeps
                        // the header's z-index:3 and the label's hover z-index:40
                        // trapped in a local stacking context.
                        "relative",
                        "z-[1]",
                        "m-0",
                        "text-base-content",
                        "flex",
                        "flex-row",
                        "items-stretch",
                        "pointer-events-auto",
                        "select-none",
                        "bg-base-200",
                        "rounded-lg",
                        "pt-2"
                    );
                    this.magnificationContainer.style.height = `${this.magnificationContainerHeight}px`;
                    this.magnificationContainer.style.height = `${this.magnificationContainerHeight}px`;
                    this.magnificationContainer.style.width = "auto";

                    this._ui.collapsibles = [];
                    this._ui.collapsedOnly = [];
                    addSyncMenuChrome(this, this.viewer, this.ViewportSyncAPI, this.magnificationContainer);

                    // --- SECTION A: ROTATION CONTROL (HOME PIP + 5 PIPS, NO BUTTONS) ---
                    const rotCol = document.createElement("div");
                    rotCol.className = "flex flex-col items-center pb-2 pl-1";
                    this._ui.collapsibles.push(rotCol);

                    const rotReadout = document.createElement("input");
                    rotReadout.type = "number";
                    rotReadout.min = "-180";
                    rotReadout.max = "180";
                    rotReadout.step = "1";
                    rotReadout.style.width = "50px";
                    rotReadout.className =
                        "input input-xs w-14 text-center text-xs font-bold px-1 rounded-lg bg-base-200 shadow text-base-content";
                    rotReadout.title = window.$.t('main.scalebar.rotationHint');
                    rotReadout.value = `${Math.round(toSignedRotation(viewport.getRotation()))}`;

                    const rotSliderContainer = document.createElement("div");
                    rotSliderContainer.className = "relative flex-1 w-1.5 my-2 self-end";

                    this._ui.rotSliderEl = rotSliderContainer;

                    rotCol.append(rotReadout, rotSliderContainer);
                    this.magnificationContainer.appendChild(rotCol);

                    noUiSlider.cssClasses.target += ' noUi-reverse';
                    noUiSlider.create(rotSliderContainer, {
                        start: toSignedRotation(viewport.getRotation()),
                        range: { min: -180, max: 180 },
                        direction: "rtl",
                        orientation: "vertical",
                        behaviour: "drag",
                        step: 1,
                        pips: {
                            mode: "values",
                            values: [-180, -90, 0, 90, 180], // 5 pips
                            density: 6,
                            format: { to: (v) => `${Math.round(v)}°` },
                        },
                    });

                    // pip styling
                    rotSliderContainer.querySelectorAll(".noUi-value-vertical").forEach((el) => {
                        el.classList.add(
                            "px-1.5",
                            "py-0.5",
                            "rounded-md",
                            "bg-base-200",
                            "text-base-content",
                            "shadow",
                            "font-semibold"
                        );
                    });

                    // rail styling
                    const rotSliderEl = rotSliderContainer.noUiSlider.target;
                    rotSliderEl.style.width = "6px";
                    rotSliderEl.style.border = "none";
                    rotSliderEl.style.background = inside;

                    let rotPrevent = false;

                    // Slider -> Viewport
                    const setRotation = (deg) => {
                        const normalized = ((deg % 360) + 360) % 360;
                        this.viewer.viewport.setRotation(normalized);
                        rotReadout.value = `${Math.round(toSignedRotation(normalized))}`;
                    };

                    rotSliderContainer.noUiSlider.on("slide", (vals) => {
                        rotPrevent = true;
                        setRotation(parseFloat(vals[0]));
                        rotPrevent = false;
                    });
                    rotSliderContainer.noUiSlider.on("change", (vals) => {
                        rotPrevent = true;
                        setRotation(parseFloat(vals[0]));
                        rotPrevent = false;
                    });

                    // Viewport -> Slider
                    const reflectRotation = () => {
                        if (rotPrevent) return;
                        const r = ((this.viewer.viewport.getRotation() % 360) + 360) % 360; // FIX: this.viewer
                        const s = toSignedRotation(r);
                        rotPrevent = true;
                        rotSliderContainer.noUiSlider.set(s);
                        rotReadout.value = `${Math.round(s)}`;
                        rotPrevent = false;
                    };
                    this.viewer.addHandler("rotate", reflectRotation);
                    this._ui.onRotate = reflectRotation;

                    // Manual entry: typed value -> viewport (clamped to -180..180).
                    const commitRotReadout = () => {
                        const v = parseFloat(rotReadout.value);
                        if (isNaN(v)) { reflectRotation(); return; }
                        const clamped = Math.max(-180, Math.min(180, v));
                        rotPrevent = true;
                        rotSliderContainer.noUiSlider.set(clamped);
                        rotPrevent = false;
                        setRotation(clamped);
                    };
                    rotReadout.addEventListener("change", commitRotReadout);
                    rotReadout.addEventListener("keydown", (e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            commitRotReadout();
                            rotReadout.blur();
                        }
                    });

                    // Clicking pips MUST rotate as well (programmatic set doesn't always fire 'change')
                    rotSliderContainer.querySelectorAll(".noUi-value").forEach((pip) => {
                        pip.classList.add("cursor-pointer", "hover:text-base-content");
                        pip.addEventListener("click", (e) => {
                            const t = (e.target.textContent || "").replace("°", "").trim();
                            const v = parseFloat(t);
                            if (!isNaN(v)) {
                                rotSliderContainer.noUiSlider.set(v);
                                setRotation(v); // <-- this is the missing piece
                            }
                        });
                    });

                    const homeRot = rotSliderContainer.querySelectorAll(".noUi-value")
                        .item(2); // 0° is the middle pip in [-180,-90,0,90,180]
                    if (homeRot) {
                        homeRot.classList.remove("text-base-content/60");
                        homeRot.classList.add("text-base-content", "font-semibold");
                        // optional: add a little badge-ish feel
                        homeRot.style.opacity = "1";
                    }


                    // --- Dynamic Range & Log Scale Calculation ---
                    const minZoom = viewport.getMinZoom();
                    const maxZoom = viewport.getMaxZoom();

                    const nativeMag = this.magnification;

                    const getNativeVpZoom = () => {
                        const currentImage = this.viewer.world.getItemAt(0);
                        return currentImage ? currentImage.imageToViewportZoom(1) : 1;
                    };


                    const vpZoomToMag = (vpZ) => (vpZ / getNativeVpZoom()) * nativeMag;
                    const magToVpZoom = (mag) => (mag / nativeMag) * getNativeVpZoom();

                    const minMag = vpZoomToMag(minZoom);
                    const maxMag = vpZoomToMag(maxZoom);

                    // 3. Define Standard Steps (Pips)
                    // Standard stops clamped to the reachable range, native
                    // mag inserted — shared with scroll-to-zoom snapping.
                    let pipValues = this.magnificationStops();
                    // Ensure strict bounds are handled cleanly (optional, mostly for range)
                    // We convert these Magnification values to Log2 values for the slider configuration
                    const toLog = (v) => Math.log2(v);
                    const toLin = (v) => Math.pow(2, v);

                    const range = {
                        'min': toLog(minMag),
                        'max': toLog(maxMag)
                    };

                    // 4. Gradient Coloring
                    // Calculate where the "Native" magnification sits on the slider (0% to 100%)
                    // Top is Min Value (due to 'rtl'), Bottom is Max Value.
                    const totalRange = range.max - range.min;
                    const nativeVal = toLog(nativeMag);

                    let percentNative = ((nativeVal - range.min) / totalRange) * 100;
                    percentNative = Math.max(0, Math.min(100, percentNative));
                    const bgStyle = `linear-gradient(to top,
  ${inside} 0%,
  ${inside} ${percentNative}%,
  ${outside} ${percentNative}%,
  ${outside} 100%
)`;

                    const sliderContainer = document.createElement("span");
                    sliderContainer.className = "relative flex-1 w-1.5 my-2";
                    const sliderWrap = document.createElement("div");
                    sliderWrap.className = "relative flex-1 flex flex-col items-center justify-center w-full";
                    sliderWrap.style.minHeight = "120px";

                    this._ui.magSliderEl = sliderContainer;
                    const magCol = document.createElement("div");
                    magCol.className = "flex flex-col items-center pb-2 pr-4";
                    this._ui.collapsibles.push(magCol);

                    const magInput = document.createElement("input");
                    magInput.type = "number";
                    magInput.inputMode = "decimal";
                    magInput.step = "0.1";
                    magInput.className = "input input-xs";
                    magInput.min = String(minMag);
                    magInput.max = String(maxMag);
                    magInput.style.width = "45px";
                    magInput.style.transform = "translate(14px, 0)";
                    magInput.className =
                        "input-xs text-xs font-bold rounded-lg bg-base-200 shadow text-base-content";
                    magInput.style.padding = "0";
                    magInput.style.height = "24px";
                    magInput.style.fontSize = "11px";

                    sliderWrap.appendChild(magInput);

                    magCol.appendChild(sliderWrap);
                    sliderWrap.appendChild(sliderContainer);

                    this.magnificationContainer.appendChild(magCol);
                    // Panel before the bar: row order [controls][bar], column order [panel]/[bar].
                    this.dock.insertBefore(this.magnificationContainer, this.scalebarContainer);

                    noUiSlider.cssClasses.target = this._originalClassTarget;
                    noUiSlider.create(sliderContainer, {
                        range: range,
                        start: toLog(vpZoomToMag(viewport.getZoom())),
                        connect: false, // Using custom background
                        direction: "rtl", // Top = Min, Bottom = Max
                        orientation: "vertical",
                        behaviour: "drag",
                        tooltips: {
                            to: (v) => toLin(v).toFixed(1) + "x",
                            from: (s) => toLog(parseFloat(s))
                        },
                        pips: {
                            mode: 'values',
                            values: pipValues.map(toLog), // Pass Log values for positions
                            density: 5,
                            format: {
                                // Same label rule as everything else quoting a
                                // magnification (e.g. 20x, 0.5x).
                                to: (v) => this.formatMagnification(toLin(v)) ?? "",
                                from: (s) => parseFloat(s)
                            }
                        }
                    });

                    const sliderEl = sliderContainer.noUiSlider.target;
                    sliderEl.style.width = "6px";
                    sliderEl.style.height = "100%";
                    sliderEl.style.border = "none";
                    sliderEl.style.background = bgStyle;

                    // Keep input in sync with current magnification
                    const setInputFromMag = (mag) => {
                        // show nicely: <1 keeps 1 decimal; >=1 rounds to 1 decimal as well (feel free to tweak)
                        magInput.value = (mag < 1 ? mag.toFixed(1) : mag.toFixed(1));
                    };
                    setInputFromMag(vpZoomToMag(viewport.getZoom()));

                    const homeLog = nativeVal;
                    let bestEl = null;
                    let bestDist = Infinity;

                    sliderContainer.querySelectorAll(".noUi-value").forEach((el) => {
                        const v = parseFloat(el.getAttribute("data-value"));
                        if (!isFinite(v)) return;
                        const d = Math.abs(v - homeLog);
                        if (d < bestDist) {
                            bestDist = d;
                            bestEl = el;
                        }
                        el.classList.add(
                            "px-1.5",
                            "py-0.5",
                            "rounded-md",
                            "bg-base-200",
                            "text-base-content",
                            "shadow",
                            "font-semibold"
                        );
                    });

                    // todo consider restoring home-magnification pipe

                    // --- Event Handlers ---

                    // Slide Change -> Update Zoom
                    const onSliderChange = (values, handle) => {
                        const logVal = parseFloat(values[handle]);
                        const mag = toLin(logVal);
                        const targetZoom = magToVpZoom(mag);
                        this.viewer.viewport.zoomTo(targetZoom);
                    };

                    sliderContainer.noUiSlider.on("slide", onSliderChange);
                    sliderContainer.noUiSlider.on("change", onSliderChange);

                    // Viewer Zoom -> Update Slider
                    const reflectUpdate = (e) => {
                        if (sliderContainer.noUiSlider._prevented) return;
                        const currentMag = vpZoomToMag(e.zoom);
                        // Convert to Log for slider
                        sliderContainer.noUiSlider._prevented = true;
                        sliderContainer.noUiSlider.set(toLog(currentMag));
                        sliderContainer.noUiSlider._prevented = false;
                        setInputFromMag(currentMag);

                    };
                    this.viewer.addHandler('zoom', reflectUpdate);
                    this._ui.onZoom = reflectUpdate;
                    // Helper for Buttons
                    const stepSlider = (direction) => {
                        // Shared ladder-stepping (same logic as scroll snapping).
                        const currMag = toLin(parseFloat(sliderContainer.noUiSlider.get()));
                        const nextMag = this.nextMagnificationStop(currMag, direction);
                        if (nextMag === undefined) return;
                        sliderContainer.noUiSlider.set(toLog(nextMag));
                        this.viewer.viewport.zoomTo(magToVpZoom(nextMag));
                    };

                    // Click on Pips - FIXED HANDLER
                    // We use an arrow function here to preserve 'this' as the Scalebar instance (for this.viewer access if needed)
                    // but we access the DOM element via the 'e.target' or the 'p' closure variable.
                    const pips = sliderContainer.querySelectorAll(".noUi-value");
                    pips.forEach(p => {
                        p.classList.add("cursor-pointer", "hover:text-base-content");
                        p.addEventListener("click", (e) => {
                            // e.target is the clicked pip element
                            let text = e.target.textContent || "";
                            let valText = text.replace('x','').trim();
                            if(!valText) return;

                            let val = parseFloat(valText);
                            if (!isNaN(val)) {
                                let logVal = toLog(val);
                                sliderContainer.noUiSlider.set(logVal);
                                this.viewer.viewport.zoomTo(magToVpZoom(val));
                            }
                        });
                    });

                    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

                    const applyMagFromInput = () => {
                        const raw = parseFloat(magInput.value);
                        if (!isFinite(raw)) return;

                        const mag = clamp(raw, minMag, maxMag);
                        const logVal = toLog(mag);

                        // update slider + zoom using the same mapping as everywhere else
                        sliderContainer.noUiSlider.set(logVal);
                        this.viewer.viewport.zoomTo(magToVpZoom(mag));

                        setInputFromMag(mag);
                    };
                    magInput.addEventListener("change", applyMagFromInput);
                    magInput.addEventListener("keydown", (e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            magInput.blur();
                            applyMagFromInput();
                        }
                    });
                    magInput.addEventListener("blur", applyMagFromInput);

                    // Re-apply now that rotCol/magCol are registered as
                    // collapsibles: addSyncMenuChrome runs before they exist,
                    // so its own apply cannot hide them.
                    this._applyCollapsed?.();
                    this.refreshHandler();
                };

                if (this.viewer.isOpen()) initSlider();
                else this.viewer.addOnceHandler('open', initSlider);
            } else {
                const initSlider = () => {
                    if (!this._active) return;

                    const image = this.viewer.world.getItemAt(0);
                    if (!image) return;

                    if (this.magnificationContainer) return;

                    const viewport = this.viewer.viewport;
                    const inside = "oklch(var(--b1))";

                    this.magnificationContainer = document.createElement("div");
                    this.magnificationContainer.id = this.id + "-magnification";
                    // z-[1] both ranks the panel below sibling viewer
                    // chrome (`.right-side-menu` is z-index: 3) and
                    // establishes a stacking context that traps the
                    // sync-header's `z-index: 3` and the slide-label's
                    // hover `z-index: 40` so they cannot leak out into
                    // the parent stacking context and overlap menus.
                    this.magnificationContainer.classList.add(
                        // `relative` (not absolute): the panel is a flex child of
                        // the dock now, and it must still be the containing block
                        // for the absolutely-positioned sync header. z-[1] keeps
                        // the header's z-index:3 and the label's hover z-index:40
                        // trapped in a local stacking context.
                        "relative",
                        "z-[1]",
                        "m-0",
                        "text-base-content",
                        "flex",
                        "flex-row",
                        "items-stretch",
                        "pointer-events-auto",
                        "select-none",
                        "bg-base-200",
                        "rounded-lg",
                        "pt-2"
                    );
                    this.magnificationContainer.style.height = `${this.magnificationContainerHeight}px`;
                    this.magnificationContainer.style.width = "auto";

                    this._ui.collapsibles = [];
                    this._ui.collapsedOnly = [];
                    addSyncMenuChrome(this, this.viewer, this.ViewportSyncAPI, this.magnificationContainer);

                    const rotCol = document.createElement("div");
                    rotCol.className = "flex flex-col items-center pb-2 pl-1";
                    this._ui.collapsibles.push(rotCol);

                    const rotReadout = document.createElement("input");
                    rotReadout.type = "number";
                    rotReadout.min = "-180";
                    rotReadout.max = "180";
                    rotReadout.step = "1";
                    rotReadout.style.width = "50px";
                    rotReadout.className =
                        "input input-xs w-14 text-center text-xs font-bold px-1 rounded-lg bg-base-200 shadow text-base-content";
                    rotReadout.title = window.$.t('main.scalebar.rotationHint');
                    rotReadout.value = `${Math.round(toSignedRotation(viewport.getRotation()))}`;

                    const rotSliderContainer = document.createElement("div");
                    rotSliderContainer.className = "relative flex-1 w-1.5 my-2 self-end";
                    this._ui.rotSliderEl = rotSliderContainer;

                    rotCol.append(rotReadout, rotSliderContainer);
                    this.magnificationContainer.appendChild(rotCol);

                    noUiSlider.cssClasses.target += " noUi-reverse";
                    noUiSlider.create(rotSliderContainer, {
                        start: toSignedRotation(viewport.getRotation()),
                        range: { min: -180, max: 180 },
                        direction: "rtl",
                        orientation: "vertical",
                        behaviour: "drag",
                        step: 1,
                        pips: {
                            mode: "values",
                            values: [-180, -90, 0, 90, 180],
                            density: 6,
                            format: { to: (v) => `${Math.round(v)}°` },
                        },
                    });

                    rotSliderContainer.querySelectorAll(".noUi-value-vertical").forEach((el) => {
                        el.classList.add(
                            "px-1.5",
                            "py-0.5",
                            "rounded-md",
                            "bg-base-200",
                            "text-base-content",
                            "shadow",
                            "font-semibold"
                        );
                    });

                    const rotSliderEl = rotSliderContainer.noUiSlider.target;
                    rotSliderEl.style.width = "6px";
                    rotSliderEl.style.border = "none";
                    rotSliderEl.style.background = inside;

                    let rotPrevent = false;
                    const setRotation = (deg) => {
                        const normalized = ((deg % 360) + 360) % 360;
                        this.viewer.viewport.setRotation(normalized);
                        rotReadout.value = `${Math.round(toSignedRotation(normalized))}`;
                    };

                    rotSliderContainer.noUiSlider.on("slide", (vals) => {
                        rotPrevent = true;
                        setRotation(parseFloat(vals[0]));
                        rotPrevent = false;
                    });
                    rotSliderContainer.noUiSlider.on("change", (vals) => {
                        rotPrevent = true;
                        setRotation(parseFloat(vals[0]));
                        rotPrevent = false;
                    });

                    const reflectRotation = () => {
                        if (rotPrevent) return;
                        const r = ((this.viewer.viewport.getRotation() % 360) + 360) % 360;
                        const s = toSignedRotation(r);
                        rotPrevent = true;
                        rotSliderContainer.noUiSlider.set(s);
                        rotReadout.value = `${Math.round(s)}`;
                        rotPrevent = false;
                    };
                    this.viewer.addHandler("rotate", reflectRotation);
                    this._ui.onRotate = reflectRotation;

                    // Manual entry: typed value -> viewport (clamped to -180..180).
                    const commitRotReadout = () => {
                        const v = parseFloat(rotReadout.value);
                        if (isNaN(v)) { reflectRotation(); return; }
                        const clamped = Math.max(-180, Math.min(180, v));
                        rotPrevent = true;
                        rotSliderContainer.noUiSlider.set(clamped);
                        rotPrevent = false;
                        setRotation(clamped);
                    };
                    rotReadout.addEventListener("change", commitRotReadout);
                    rotReadout.addEventListener("keydown", (e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            commitRotReadout();
                            rotReadout.blur();
                        }
                    });

                    rotSliderContainer.querySelectorAll(".noUi-value").forEach((pip) => {
                        pip.classList.add("cursor-pointer", "hover:text-base-content");
                        pip.addEventListener("click", (e) => {
                            const value = parseFloat((e.target.textContent || "").replace("°", "").trim());
                            if (!isNaN(value)) {
                                rotSliderContainer.noUiSlider.set(value);
                                setRotation(value);
                            }
                        });
                    });

                    const minLog = Math.log2(Math.max(viewport.getMinZoom(), Number.EPSILON));
                    const maxLog = Math.log2(Math.max(viewport.getMaxZoom(), viewport.getMinZoom() + Number.EPSILON));
                    const uniquePips = this.zoomLevelStops();

                    const sliderContainer = document.createElement("span");
                    sliderContainer.className = "relative flex-1 w-1.5 my-2";
                    const sliderWrap = document.createElement("div");
                    sliderWrap.className = "relative flex-1 flex flex-col items-center justify-center w-full";
                    sliderWrap.style.minHeight = "120px";

                    this._ui.magSliderEl = sliderContainer;
                    const magCol = document.createElement("div");
                    magCol.className = "flex flex-col items-center pb-2 pr-4";
                    this._ui.collapsibles.push(magCol);

                    const levelReadout = document.createElement("input");
                    levelReadout.type = "text";
                    levelReadout.readOnly = true;
                    levelReadout.className =
                        "input-xs text-xs font-bold rounded-lg bg-base-200 shadow text-base-content";
                    levelReadout.style.padding = "0";
                    levelReadout.style.height = "24px";
                    levelReadout.style.fontSize = "11px";
                    levelReadout.style.width = "56px";
                    levelReadout.style.transform = "translate(14px, 0)";

                    sliderWrap.appendChild(levelReadout);
                    magCol.appendChild(sliderWrap);
                    sliderWrap.appendChild(sliderContainer);

                    this.magnificationContainer.appendChild(magCol);
                    // Panel before the bar: row order [controls][bar], column order [panel]/[bar].
                    this.dock.insertBefore(this.magnificationContainer, this.scalebarContainer);

                    noUiSlider.cssClasses.target = this._originalClassTarget;
                    noUiSlider.create(sliderContainer, {
                        range: { min: minLog, max: maxLog },
                        start: Math.log2(Math.max(viewport.getZoom(), Number.EPSILON)),
                        connect: false,
                        direction: "rtl",
                        orientation: "vertical",
                        behaviour: "drag",
                        tooltips: false,
                        pips: {
                            mode: "values",
                            values: uniquePips,
                            density: 5,
                            format: {
                                to: (value) => {
                                    const nearestIndex = uniquePips.reduce((best, current, index) => {
                                        const distance = Math.abs(current - value);
                                        return distance < best.distance ? {index, distance} : best;
                                    }, {index: 0, distance: Infinity}).index;
                                    return `L${nearestIndex + 1}`;
                                },
                                from: (value) => value
                            }
                        }
                    });

                    const sliderEl = sliderContainer.noUiSlider.target;
                    sliderEl.style.width = "6px";
                    sliderEl.style.height = "100%";
                    sliderEl.style.border = "none";
                    sliderEl.style.background = inside;

                    const formatLevel = (sliderValue) => {
                        const nearestIndex = uniquePips.reduce((best, current, index) => {
                            const distance = Math.abs(current - sliderValue);
                            return distance < best.distance ? {index, distance} : best;
                        }, {index: 0, distance: Infinity}).index;
                        return `L${nearestIndex + 1}`;
                    };
                    const setLevelReadout = (zoom) => {
                        levelReadout.value = formatLevel(Math.log2(Math.max(zoom, Number.EPSILON)));
                    };
                    setLevelReadout(viewport.getZoom());

                    sliderContainer.querySelectorAll(".noUi-value").forEach((el) => {
                        el.classList.add(
                            "px-1.5",
                            "py-0.5",
                            "rounded-md",
                            "bg-base-200",
                            "text-base-content",
                            "shadow",
                            "font-semibold",
                            "cursor-pointer",
                            "hover:text-base-content"
                        );
                        el.addEventListener("click", () => {
                            const label = el.textContent || "";
                            const match = /^L(\d+)$/i.exec(label.trim());
                            if (!match) return;
                            const index = Number.parseInt(match[1], 10) - 1;
                            const value = uniquePips[index];
                            if (!Number.isFinite(value)) return;
                            sliderContainer.noUiSlider.set(value);
                            this.viewer.viewport.zoomTo(Math.pow(2, value));
                        });
                    });

                    const onSliderChange = (values, handle) => {
                        const sliderValue = parseFloat(values[handle]);
                        this.viewer.viewport.zoomTo(Math.pow(2, sliderValue));
                    };
                    sliderContainer.noUiSlider.on("slide", onSliderChange);
                    sliderContainer.noUiSlider.on("change", onSliderChange);

                    const reflectUpdate = (e) => {
                        if (sliderContainer.noUiSlider._prevented) return;
                        sliderContainer.noUiSlider._prevented = true;
                        sliderContainer.noUiSlider.set(Math.log2(Math.max(e.zoom, Number.EPSILON)));
                        sliderContainer.noUiSlider._prevented = false;
                        setLevelReadout(e.zoom);
                    };
                    this.viewer.addHandler("zoom", reflectUpdate);
                    this._ui.onZoom = reflectUpdate;

                    // Re-apply now that rotCol/magCol are registered as
                    // collapsibles: addSyncMenuChrome runs before they exist,
                    // so its own apply cannot hide them.
                    this._applyCollapsed?.();
                    this.refreshHandler();
                };

                if (this.viewer.isOpen()) initSlider();
                else this.viewer.addOnceHandler('open', initSlider);
            }

            this.setMinWidth(options.minWidth || "150px");

            this.viewer.addOnceHandler("update-viewport", this.prepareScalebar.bind(this));
            this.viewer.addHandler("update-viewport", this.refreshHandler);
            if (!this._dimsHandler) this._dimsHandler = this._refreshScalebarDims.bind(this);
            this._refreshScalebarDims();
            if (!this._dimsHandlerBound) {
                this.viewer.addHandler("resize", this._dimsHandler);
                this.viewer.addHandler("full-screen", this._dimsHandler);
                this.viewer.addHandler("open", this._dimsHandler);
                this._dimsHandlerBound = true;
            }
            if (!this._viewerDestroyHandler) {
                this._viewerDestroyHandler = () => {
                    this.destroy();
                    if (this.viewer.scalebar === this) {
                        this.viewer.scalebar = null;
                    }
                };
            }
            if (!this._viewerDestroyHandlerBound) {
                this.viewer.addHandler("destroy", this._viewerDestroyHandler);
                this._viewerDestroyHandlerBound = true;
            }
        } else {
            this._active = false;

            // Remove viewport handler
            this.viewer.removeHandler("update-viewport", this.refreshHandler);
            if (this._dimsHandler && this._dimsHandlerBound) {
                this.viewer.removeHandler("resize", this._dimsHandler);
                this.viewer.removeHandler("full-screen", this._dimsHandler);
                this.viewer.removeHandler("open", this._dimsHandler);
                this._dimsHandlerBound = false;
            }

            // Remove rotation handler
            if (this._ui.onRotate) {
                this.viewer.removeHandler("rotate", this._ui.onRotate);
            }

            // Remove zoom handlers
            if (this._ui.onZoom) {
                this.viewer.removeHandler("zoom", this._ui.onZoom);
            }
            if (this._ui.onZoomQuick) {
                // Per-frame handler (see addQuickZoomChrome) — not the 'zoom' event.
                this.viewer.removeHandler("update-viewport", this._ui.onZoomQuick);
            }

            // Destroy rotation slider
            if (this._ui.rotSliderEl?.noUiSlider) {
                this._ui.rotSliderEl.noUiSlider.destroy();
            }

            // Destroy magnification slider
            if (this._ui.magSliderEl?.noUiSlider) {
                this._ui.magSliderEl.noUiSlider.destroy();
            }

            // Remove DOM nodes
            if (this.scalebarContainer) {
                this.scalebarContainer.remove();
            }

            if (this.magnificationContainer) {
                this.magnificationContainer.remove();
            }

            this.magnificationContainer = null;

            if (this.dock) {
                this.dock.remove();
                this.dock = null;
            }

            if (this._ui?.labelObjectUrl) {
                try { URL.revokeObjectURL(this._ui.labelObjectUrl); } catch {}
            }

            // Reset UI state
            this._ui = {
                rotSliderEl: null,
                magSliderEl: null,
                onRotate: null,
                onZoom: null,
                onZoomQuick: null,
                collapsed: readCollapsedPreference(),
                collapsibles: [],
                collapsedOnly: [],
                labelEl: null,
                labelObjectUrl: null
            };
            this._applyCollapsed = null;
        }
    },

    destroy: function() {
        if (this._viewerDestroyHandlerBound && this._viewerDestroyHandler) {
            this.viewer.removeHandler("destroy", this._viewerDestroyHandler);
            this._viewerDestroyHandlerBound = false;
        }
        this._init({destroy: true});
    },

    setActive: function(active) {
        if (this._active == active) return;
        this._active = active;
        if (active) {
            // One toggle for the whole bottom-left dock; children inherit.
            if (this.dock) this.dock.style.visibility = "visible";
            this.viewer.addHandler("update-viewport", this.refreshHandler);
            if (!this._dimsHandler) this._dimsHandler = this._refreshScalebarDims.bind(this);
            this._refreshScalebarDims();
            if (!this._dimsHandlerBound) {
                this.viewer.addHandler("resize", this._dimsHandler);
                this.viewer.addHandler("full-screen", this._dimsHandler);
                this.viewer.addHandler("open", this._dimsHandler);
                this._dimsHandlerBound = true;
            }
        } else {
            if (this.dock) this.dock.style.visibility = "hidden";
            this.viewer.removeHandler("update-viewport", this.refreshHandler);
            if (this._dimsHandler && this._dimsHandlerBound) {
                this.viewer.removeHandler("resize", this._dimsHandler);
                this.viewer.removeHandler("full-screen", this._dimsHandler);
                this.viewer.removeHandler("open", this._dimsHandler);
                this._dimsHandlerBound = false;
            }
        }
    },

    /**
     * Updaate the scalebar options without re-rendering it.
     * @param options
     */
    updateOptions: function(options) {
        if (!options) {
            return;
        }

        this._init(options);

        if (isDefined(options.type)) {
            this.setDrawScalebarFunction(options.type);
        }
        if (isDefined(options.minWidth)) {
            this.setMinWidth(options.minWidth);
        }
        if (isDefined(options.color)) {
            this.color = options.color;
        }
        if (isDefined(options.fontColor)) {
            this.fontColor = options.fontColor;
        }
        if (isDefined(options.backgroundColor)) {
            this.backgroundColor = options.backgroundColor;
        }
        if (isDefined(options.fontSize)) {
            this.fontSize = options.fontSize;
        }
        if (isDefined(options.fontFamily)) {
            this.fontFamily = options.fontFamily;
        }
        if (isDefined(options.barThickness)) {
            this.barThickness = options.barThickness;
        }
        if ("pixelsPerMeter" in options) {
            this.pixelsPerMeter = options.pixelsPerMeter;
        }
        if ("pixelsPerMeterX" in options) {
            this.pixelsPerMeterX = options.pixelsPerMeterX;
        }
        if ("pixelsPerMeterY" in options) {
            this.pixelsPerMeterY = options.pixelsPerMeterY;
        }
        if (!isDefined(this.pixelsPerMeter) && isDefined(this.pixelsPerMeterX) && isDefined(this.pixelsPerMeterY)) {
            this.pixelsPerMeter = (this.pixelsPerMeterX + this.pixelsPerMeterY) / 2;
        }
        if (isDefined(options.location)) {
            this.location = options.location;
        }
        if (isDefined(options.xOffset)) {
            this.xOffset = options.xOffset;
        }
        if (isDefined(options.yOffset)) {
            this.yOffset = options.yOffset;
        }
        if (isDefined(options.stayInsideImage)) {
            this.stayInsideImage = options.stayInsideImage;
        }
        if (isDefined(options.sizeAndTextRenderer)) {
            this.sizeAndTextRenderer = options.sizeAndTextRenderer;
        }
        if (isDefined(options.magnification)) {
            this.magnification = options.magnification;
        }
    },
    setDrawScalebarFunction: function(type) {
        if (!type) {
            this.drawScalebar = null;
        }
        else if (type === OSD.ScalebarType.MAP) {
            this.drawScalebar = this.drawMapScalebar;
            this.prepareScalebar = this.prepareMapScalebar;
            this.prepareMapScalebar();
        } else {
            this.drawScalebar = this.drawMicroscopyScalebar;
            this.prepareScalebar = this.prepareMicroscopyScalebar;
        }
    },
    setMinWidth: function(minWidth) {
        this.scalebarContainer.style.width = minWidth;
        // Make sure to display the element before getting is width
        this.scalebarContainer.style.display = "";
        this.minWidth = this.scalebarContainer.offsetWidth;
    },
    /**
     * Refresh the scalebar with the options submitted.
     * @param {ScaleBarConfig} options
     * @param {OpenSeadragon.ScalebarType} options.type The scale bar type.
     */
    refresh: function(options) {
        if (this.scalebarContainer) {
            this._init({destroy: true});
        }
        this.updateOptions(options);
        this.prepareScalebar();
        this.refreshHandler();
    },
    _prepareScalebarCommon: function () {
        this.scalebarContainer.style.fontSize = this.fontSize;
        this.scalebarContainer.style.fontFamily = this.fontFamily;
        this.scalebarContainer.style.textAlign = "center";
        this.scalebarContainer.style.fontWeight = "600";
        this.scalebarContainer.style.color = this.fontColor;
        this.scalebarContainer.style.backgroundColor = this.backgroundColor;
    },
    prepareMicroscopyScalebar: function () {
        this._prepareScalebarCommon();
        this.scalebarContainer.style.border = "none";
    },
    prepareMapScalebar: function () {
        this._prepareScalebarCommon();
        this.scalebarContainer.style.borderTop = "none";
    },
    drawMicroscopyScalebar: function(size, text) {
        this.scalebarContainer.style.borderBottom =
            this.barThickness + "px solid " + this.color;

        this.scalebarContainer.style.borderLeft =
            this.barThickness + "px solid " + this.color;

        this.scalebarContainer.style.borderRight =
            this.barThickness + "px solid " + this.color;

        this.scalebarContainer.textContent = text;
        this.scalebarContainer.style.width = size + "px";
    },
    drawMapScalebar: function(size, text) {
        this.scalebarContainer.style.textAlign = "center";
        this.scalebarContainer.style.border = this.barThickness + "px solid " + this.color;
        this.scalebarContainer.textContent = text;
        this.scalebarContainer.style.width = size + "px";
    },
    /**
     * Arrange the dock for the current collapse state. Collapsed the panel
     * is a single control row and the metric bar sits to its right, wrapping
     * onto the next line (i.e. below) when the viewer cell is too narrow.
     * Expanded the panel is a tall slider board stacked above the bar.
     */
    _applyDockLayout: function () {
        if (!this.dock) return;
        const collapsed = !!this._ui?.collapsed;
        this.dock.classList.toggle("flex-row", collapsed);
        this.dock.classList.toggle("flex-wrap", collapsed);
        this.dock.classList.toggle("items-center", collapsed);
        this.dock.classList.toggle("flex-col", !collapsed);
        this.dock.classList.toggle("items-start", !collapsed);
        // The bar's absolute left offset already carries xOffset; inside the
        // dock the row must not push it further right than the panel edge.
        this.dock.style.maxWidth = "calc(100% - " + ((this.xOffset || 5) * 2) + "px)";
    },

    /**
     * Read the bar and viewer-container pixel sizes into the cache. Called only
     * when they can have changed (viewer resize/full-screen/open) so neither
     * getScalebarLocation nor the redraw branch forces a layout reflow on the
     * per-frame path.
     *
     * Also learns `_barChromeW` — how much wider the bar's border box is than the
     * content width we set — so a later redraw can derive `_barW` arithmetically
     * instead of measuring it (see `_noteScalebarWidth`).
     */
    _refreshScalebarDims: function() {
        if (this.scalebarContainer) {
            this._barW = this.scalebarContainer.offsetWidth;
            this._barH = this.scalebarContainer.offsetHeight;
            if (this._lastSize !== undefined) {
                this._barChromeW = this._barW - this._lastSize;
                this._barChromeKey = this.barThickness;
            }
        }
        var c = this.viewer && this.viewer.container;
        this._contW = c ? c.offsetWidth : 0;
        this._contH = c ? c.offsetHeight : 0;
    },

    /**
     * Record the bar's width after a redraw without reading layout back.
     *
     * `drawScalebar` sets `style.width = size + "px"`, so the border-box width is
     * that size plus a constant of borders and padding — constant because nothing
     * in the redraw touches either. Measuring instead (a `offsetWidth` read
     * immediately after those style writes) forced a synchronous layout of the
     * whole viewer subtree on EVERY zoom frame: the redraw guard compares
     * `props.size`, which is a continuous pixel width derived from
     * `viewport.getZoom(true)`, so during a zoom animation it changes every frame
     * and the guard never holds.
     *
     * Falls back to a real measurement while the constant is unknown, or after
     * `barThickness` changes it.
     */
    _noteScalebarWidth: function(size) {
        if (this._barChromeW === undefined || this._barChromeKey !== this.barThickness) {
            this._refreshScalebarDims();
            return;
        }
        this._barW = size + this._barChromeW;
    },
    /**
     * Compute the location of the scale bar.
     * @returns {OpenSeadragon.Point}
     */
    getScalebarLocation: function() {
        // Bar and container sizes change only when the bar is redrawn or the
        // viewer resizes — NOT every rendered frame. Read them from the cache
        // (refreshed by _refreshScalebarDims on those events) instead of touching
        // offsetWidth/offsetHeight here, which forced a layout reflow per frame.
        if (this._barW === undefined) this._refreshScalebarDims();
        var barWidth = this._barW;
        var barHeight = this._barH;
        var containerWidth = this._contW;
        var containerHeight = this._contH;
        var x = 0;
        var y = 0;
        var pixel;
        if (this.location === OSD.ScalebarLocation.TOP_LEFT) {
            if (this.stayInsideImage) {
                pixel = this.viewer.viewport.pixelFromPoint(
                    new OSD.Point(0, 0), true);
                if (!this.viewer.wrapHorizontal) {
                    x = Math.max(pixel.x, 0);
                }
                if (!this.viewer.wrapVertical) {
                    y = Math.max(pixel.y, 0);
                }
            }
            return new OSD.Point(x + this.xOffset, y + this.yOffset);
        } else if (this.location === OSD.ScalebarLocation.TOP_RIGHT) {
            x = containerWidth - barWidth;
            if (this.stayInsideImage) {
                pixel = this.viewer.viewport.pixelFromPoint(
                    new OSD.Point(1, 0), true);
                if (!this.viewer.wrapHorizontal) {
                    x = Math.min(x, pixel.x - barWidth);
                }
                if (!this.viewer.wrapVertical) {
                    y = Math.max(y, pixel.y);
                }
            }
            return new OSD.Point(x - this.xOffset, y + this.yOffset);
        } else if (this.location === OSD.ScalebarLocation.BOTTOM_RIGHT) {
            x = containerWidth - barWidth;
            y = containerHeight - barHeight;
            if (this.stayInsideImage) {
                pixel = this.viewer.viewport.pixelFromPoint(
                    new OSD.Point(1, 1 / this.viewer.source.aspectRatio),
                    true);
                if (!this.viewer.wrapHorizontal) {
                    x = Math.min(x, pixel.x - barWidth);
                }
                if (!this.viewer.wrapVertical) {
                    y = Math.min(y, pixel.y - barHeight);
                }
            }
            return new OSD.Point(x - this.xOffset, y - this.yOffset);
        } else if (this.location === OSD.ScalebarLocation.BOTTOM_LEFT) {
            y = containerHeight - barHeight;
            if (this.stayInsideImage) {
                pixel = this.viewer.viewport.pixelFromPoint(
                    new OSD.Point(0, 1 / this.viewer.source.aspectRatio),
                    true);
                if (!this.viewer.wrapHorizontal) {
                    x = Math.max(x, pixel.x);
                }
                if (!this.viewer.wrapVertical) {
                    y = Math.min(y, pixel.y - barHeight);
                }
            }
            return new OSD.Point(x + this.xOffset, y - this.yOffset);
        }
    },
    /**
     * Get the rendered scalebar in a canvas.
     * @returns {Element} A canvas containing the scalebar representation
     */
    getAsCanvas: function() {
        var canvas = document.createElement("canvas");
        canvas.width = this.scalebarContainer.offsetWidth;
        canvas.height = this.scalebarContainer.offsetHeight;
        var context = canvas.getContext("2d");
        context.fillStyle = this.backgroundColor;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = this.color;
        context.fillRect(0, canvas.height - this.barThickness,
            canvas.width, canvas.height);
        if (this.drawScalebar === this.drawMapScalebar) {
            context.fillRect(0, 0, this.barThickness, canvas.height);
            context.fillRect(canvas.width - this.barThickness, 0,
                this.barThickness, canvas.height);
        }
        context.font = window.getComputedStyle(this.scalebarContainer).font;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = this.fontColor;
        var hCenter = canvas.width / 2;
        var vCenter = canvas.height / 2;
        context.fillText(this.scalebarContainer.textContent, hCenter, vCenter);
        return canvas;
    },
    /**
     * Get a copy of the current OpenSeadragon canvas with the scalebar.
     * @returns {Element} A canvas containing a copy of the current OpenSeadragon canvas with the scalebar
     */
    getImageWithScalebarAsCanvas: function() {
        var imgCanvas = this.viewer.drawer.canvas;
        var newCanvas = document.createElement("canvas");
        newCanvas.width = imgCanvas.width;
        newCanvas.height = imgCanvas.height;
        var newCtx = newCanvas.getContext("2d");
        newCtx.drawImage(imgCanvas, 0, 0);
        var scalebarCanvas = this.getAsCanvas();
        var location = this.getScalebarLocation();
        newCtx.drawImage(scalebarCanvas, location.x, location.y);
        return newCanvas;
    },
};


export {};
