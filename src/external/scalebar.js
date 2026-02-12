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
(function($) {

    /**
     * @memberOf OpenSeadragon.Viewer
     * @param {(ScaleBarConfig|undefined)} options
     *
     */
    $.Viewer.prototype.makeScalebar = function(options) {
        if (!this.scalebar) {
            options = options || {};
            options.viewer = this;
            this.scalebar = new $.Scalebar(options);
        } else {
            options.viewer = this;
            this.scalebar.refresh(options);
        }
    };

    $.ScalebarType = {
        NONE: 0,
        MICROSCOPY: 1,
        MAP: 2
    };

    $.ScalebarLocation = {
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
     * default: $.ScalebarSizeAndTextRenderer.METRIC_LENGTH
     */
    $.Scalebar = function(options) {
        options = options || {};
        if (!options.viewer) {
            throw new Error("A viewer must be specified.");
        }

        //Defaults
        this.viewer = options.viewer;

        this.setDrawScalebarFunction(options.type || $.ScalebarType.MICROSCOPY);
        this.color = options.color || "black";
        this.fontColor = options.fontColor || "black";
        this.backgroundColor = options.backgroundColor || "none";
        this.fontSize = options.fontSize || "";
        this.fontFamily = options.fontFamily || "";
        this.barThickness = options.barThickness || 3;

        //todo reflect better in API, allow for distinct measures
        this.pixelsPerMeter = options.pixelsPerMeter || (options.pixelsPerMeterX + options.pixelsPerMeterY)/2;
        this.location = options.location || $.ScalebarLocation.BOTTOM_LEFT;
        this.xOffset = options.xOffset || 5;
        this.yOffset = options.yOffset || 5;
        this.stayInsideImage = isDefined(options.stayInsideImage) ?
            options.stayInsideImage : true;
        this.sizeAndTextRenderer = options.sizeAndTextRenderer ||
            $.ScalebarSizeAndTextRenderer.METRIC_LENGTH;

        this.magnificationContainerHeight = 210;

        //magnification
        this.magnification = options.magnification || false;
        //todo allow specifying levels of magnification

        this.refreshHandler = async function () {
            if (!this.viewer.isOpen() ||
                !this.drawScalebar ||
                !this.pixelsPerMeter ||
                !this.location) {
                this.scalebarContainer.style.display = "none";
                return;
            }
            this.scalebarContainer.style.display = "";

            var props = this.sizeAndTextRenderer(this.currentResolution(), this.minWidth);
            this.drawScalebar(props.size, props.text);
            var location = this.getScalebarLocation();
            this.scalebarContainer.style.left = location.x + "px";
            this.scalebarContainer.style.top = location.y + "px";
            //todo location works only for bottom, also setting position each time is not efficient (could use align / float)
            if (this.magnificationContainer) {
                this.magnificationContainer.style.left = location.x + 36 + "px";
                const h = this.magnificationContainer.offsetHeight || this.magnificationContainerHeight || 0;
                this.magnificationContainer.style.top = (location.y - h - 12) + "px";
            }

        }.bind(this);
        this._init(options);
    };

    $.Scalebar.prototype = {
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
            return this.sizeAndTextRenderer === $.ScalebarSizeAndTextRenderer.METRIC_LENGTH ? "m" : "px";
        },

        areaMetric: function () {
            return this.sizeAndTextRenderer === $.ScalebarSizeAndTextRenderer.METRIC_LENGTH ? "m²" : "px²";
        },

        formatLength: function (unit) {return getWithUnitRounded(unit, this.lengthMetric())},
        formatArea: function (unit) {return getWithSquareUnitRounded(unit, this.areaMetric())},

        _init: function (options) {
            if (!this._ui) {
                this._ui = {
                    rotSliderEl: null,
                    magSliderEl: null,
                    onRotate: null,
                    onZoom: null
                };
                this._originalClassTarget = noUiSlider.cssClasses.target;
            }
            if (!options.destroy) {
                this.id = options.viewer.id + "-scale-bar";
                this._active = true;
                if (!this.scalebarContainer) {
                    this.scalebarContainer = document.createElement("div");
                    this.scalebarContainer.classList.add(
                        "absolute",
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
                this.viewer.container.appendChild(this.scalebarContainer);

                if (this.magnification > 0) {
                    // We need to wait for the image to open to get bounds for the slider
                    const initSlider = () => {
                        if (!this._active) return;

                        const image = this.viewer.world.getItemAt(0);
                        if (!image) return;

                        if (this.magnificationContainer) return;

                        const viewport = this.viewer.viewport;
                        const inside = "oklch(var(--b2))";
                        const outside = "oklch(var(--er))";

                        this.magnificationContainer = document.createElement("div");
                        this.magnificationContainer.id = this.id + "-magnification";
                        this.magnificationContainer.classList.add(
                            "absolute",
                            "m-0",
                            "text-base-content",
                            "flex",
                            "flex-row",
                            "items-stretch",
                            "pointer-events-auto",
                            "select-none",
                            "min-w-[240px]"            // ensures both slider + labels fit
                        );
                        this.magnificationContainer.style.height = `${this.magnificationContainerHeight}px`;
                        this.magnificationContainer.style.height = `${this.magnificationContainerHeight}px`;
                        this.magnificationContainer.style.width = "auto";

                        const mkBtn = (iconClass, id, title) => {
                            const b = document.createElement("button");
                            b.type = "button";
                            if (id) b.dataset.role = id;
                            if (title) b.title = title;
                            b.className =
                                "btn btn-xs btn-square rounded-xl " +
                                "bg-base-200 hover:bg-base-300 border-base-300 " +
                                "text-base-content shadow";
                            b.innerHTML = `<i class="fa-solid fa-auto ${iconClass}"></i>`;
                            return b;
                        };

                        // --- SECTION A: ROTATION CONTROL (HOME PIP + 5 PIPS, NO BUTTONS) ---
                        const rotCol = document.createElement("div");
                        rotCol.className = "flex flex-col items-center pb-2";

                        const rotReadout = document.createElement("div");
                        rotReadout.className =
                            "text-xs font-bold px-2 py-1 rounded-lg bg-base-200 shadow text-base-content";
                        rotReadout.textContent = `${Math.round(viewport.getRotation() % 360)}°`;

                        const rotSliderContainer = document.createElement("div");
                        rotSliderContainer.className = "relative flex-1 w-1.5 my-2";

                        this._ui.rotSliderEl = rotSliderContainer;

                        rotCol.append(rotReadout, rotSliderContainer);
                        this.magnificationContainer.appendChild(rotCol);

                        noUiSlider.cssClasses.target += ' noUi-reverse';
                        noUiSlider.create(rotSliderContainer, {
                            start: viewport.getRotation() % 360,
                            range: { min: 0, max: 360 },
                            direction: "rtl",
                            orientation: "vertical",
                            behaviour: "drag",
                            step: 1,
                            pips: {
                                mode: "values",
                                values: [0, 90, 180, 270, 360], // 5 pips
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

// feedback-loop guard
                        let rotPrevent = false;

// Slider -> Viewport
                        const setRotation = (deg) => {
                            const normalized = ((deg % 360) + 360) % 360;
                            this.viewer.viewport.setRotation(normalized);
                            rotReadout.textContent = `${Math.round(normalized)}°`;
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
                            rotPrevent = true;
                            rotSliderContainer.noUiSlider.set(r);
                            rotReadout.textContent = `${Math.round(r)}°`;
                            rotPrevent = false;
                        };
                        this.viewer.addHandler("rotate", reflectRotation);
                        this._ui.onRotate = reflectRotation;

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
                            .item(0); // first one is 0° in our list
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
                        const possibleSteps = [
                            0.01, 0.02, 0.05,
                            0.1, 0.2, 0.5,
                            1, 2, 5,
                            10, 20, 40,
                            80, 160, 240, 480
                        ];
                        let pipValues = possibleSteps.filter(v => v >= minMag && v <= maxMag);
                        if (nativeMag >= minMag && nativeMag <= maxMag) {
                            const eps = nativeMag * 1e-6 + 1e-9;
                            const hasNative = pipValues.some(v => Math.abs(v - nativeMag) <= eps);
                            if (!hasNative) pipValues.push(nativeMag);
                            pipValues.sort((a,b) => a - b);
                        }
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
                        magCol.className = "flex flex-col items-center pb-2";

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
                        this.viewer.container.appendChild(this.magnificationContainer);

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
                                    to: (v) => {
                                        let val = toLin(v);
                                        // Format nicely (e.g. 20x, 0.5x)
                                        return (val < 1 ? val.toFixed(1) : Math.round(val)) + "x";
                                    },
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
                            const currLog = parseFloat(sliderContainer.noUiSlider.get());

                            // Find nearest pip value in Log space
                            const pipLogs = pipValues.map(toLog).sort((a,b) => a-b);

                            // Find index of closest standard step
                            let idx = -1;
                            let minDist = Infinity;
                            for(let i=0; i<pipLogs.length; i++) {
                                let d = Math.abs(pipLogs[i] - currLog);
                                if(d < minDist) { minDist = d; idx = i; }
                            }

                            let nextIdx = idx + direction;
                            // Clamp
                            if (nextIdx < 0) nextIdx = 0;
                            if (nextIdx >= pipLogs.length) nextIdx = pipLogs.length - 1;

                            const nextLog = pipLogs[nextIdx];

                            // Behavior logic:
                            // If we are 'close' to a pip but not on it, snapping to it might feel like 'no movement' if direction is wrong
                            // But usually snapping to next index is sufficient.

                            if (direction < 0 && currLog <= pipLogs[idx] + 0.01 && idx > 0) {
                                // We are effectively AT idx, so we want idx-1
                                sliderContainer.noUiSlider.set(pipLogs[idx-1]);
                                this.viewer.viewport.zoomTo(magToVpZoom(toLin(pipLogs[idx-1])));
                            } else if (direction > 0 && currLog >= pipLogs[idx] - 0.01 && idx < pipLogs.length - 1) {
                                // We are effectively AT idx, so we want idx+1
                                sliderContainer.noUiSlider.set(pipLogs[idx+1]);
                                this.viewer.viewport.zoomTo(magToVpZoom(toLin(pipLogs[idx+1])));
                            } else {
                                // We are between pips, just go to the calculated nearest neighbor in direction
                                sliderContainer.noUiSlider.set(nextLog);
                                this.viewer.viewport.zoomTo(magToVpZoom(toLin(nextLog)));
                            }
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

                        this.refreshHandler();
                    };

                    if (this.viewer.isOpen()) initSlider();
                    else this.viewer.addOnceHandler('open', initSlider);
                }

                this.setMinWidth(options.minWidth || "150px");

                this.viewer.addOnceHandler("update-viewport", this.prepareScalebar.bind(this));
                this.viewer.addHandler("update-viewport", this.refreshHandler);
                this.viewer.addHandler("destroy", () => {
                    this._init({destroy: true});
                    this.viewer.scalebar = null;
                });
            } else {
                this._active = false;

                // Remove viewport handler
                this.viewer.removeHandler("update-viewport", this.refreshHandler);

                // Remove rotation handler
                if (this._ui.onRotate) {
                    this.viewer.removeHandler("rotate", this._ui.onRotate);
                }

                // Remove zoom handler
                if (this._ui.onZoom) {
                    this.viewer.removeHandler("zoom", this._ui.onZoom);
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

                // Reset UI state
                this._ui = {
                    rotSliderEl: null,
                    magSliderEl: null,
                    onRotate: null,
                    onZoom: null
                };
            }
        },

        setActive: function(active) {
            if (this._active == active) return;
            this._active = active;
            if (active) {
                if(this.magnificationContainer) this.magnificationContainer.style.visibility = "visible";
                this.scalebarContainer.style.visibility = "visible";
                this.viewer.addHandler("update-viewport", this.refreshHandler);
            } else {
                if(this.magnificationContainer) this.magnificationContainer.style.visibility = "hidden";
                this.scalebarContainer.style.visibility = "hidden";
                this.viewer.removeHandler("update-viewport", this.refreshHandler);
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
            if (isDefined(options.pixelsPerMeter)) {
                this.pixelsPerMeter = options.pixelsPerMeter;
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
            else if (type === $.ScalebarType.MAP) {
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

            this.scalebarContainer.innerHTML = text;
            this.scalebarContainer.style.width = size + "px";
        },
        drawMapScalebar: function(size, text) {
            this.scalebarContainer.style.textAlign = "center";
            this.scalebarContainer.style.border = this.barThickness + "px solid " + this.color;
            this.scalebarContainer.innerHTML = text;
            this.scalebarContainer.style.width = size + "px";
        },
        /**
         * Compute the location of the scale bar.
         * @returns {OpenSeadragon.Point}
         */
        getScalebarLocation: function() {
            var barWidth = this.scalebarContainer.offsetWidth;
            var barHeight = this.scalebarContainer.offsetHeight;
            var container = this.viewer.container;
            var x = 0;
            var y = 0;
            var pixel;
            if (this.location === $.ScalebarLocation.TOP_LEFT) {
                if (this.stayInsideImage) {
                    pixel = this.viewer.viewport.pixelFromPoint(
                        new $.Point(0, 0), true);
                    if (!this.viewer.wrapHorizontal) {
                        x = Math.max(pixel.x, 0);
                    }
                    if (!this.viewer.wrapVertical) {
                        y = Math.max(pixel.y, 0);
                    }
                }
                return new $.Point(x + this.xOffset, y + this.yOffset);
            } else if (this.location === $.ScalebarLocation.TOP_RIGHT) {
                x = container.offsetWidth - barWidth;
                if (this.stayInsideImage) {
                    pixel = this.viewer.viewport.pixelFromPoint(
                        new $.Point(1, 0), true);
                    if (!this.viewer.wrapHorizontal) {
                        x = Math.min(x, pixel.x - barWidth);
                    }
                    if (!this.viewer.wrapVertical) {
                        y = Math.max(y, pixel.y);
                    }
                }
                return new $.Point(x - this.xOffset, y + this.yOffset);
            } else if (this.location === $.ScalebarLocation.BOTTOM_RIGHT) {
                x = container.offsetWidth - barWidth;
                y = container.offsetHeight - barHeight;
                if (this.stayInsideImage) {
                    pixel = this.viewer.viewport.pixelFromPoint(
                        new $.Point(1, 1 / this.viewer.source.aspectRatio),
                        true);
                    if (!this.viewer.wrapHorizontal) {
                        x = Math.min(x, pixel.x - barWidth);
                    }
                    if (!this.viewer.wrapVertical) {
                        y = Math.min(y, pixel.y - barHeight);
                    }
                }
                return new $.Point(x - this.xOffset, y - this.yOffset);
            } else if (this.location === $.ScalebarLocation.BOTTOM_LEFT) {
                y = container.offsetHeight - barHeight;
                if (this.stayInsideImage) {
                    pixel = this.viewer.viewport.pixelFromPoint(
                        new $.Point(0, 1 / this.viewer.source.aspectRatio),
                        true);
                    if (!this.viewer.wrapHorizontal) {
                        x = Math.max(x, pixel.x);
                    }
                    if (!this.viewer.wrapVertical) {
                        y = Math.min(y, pixel.y - barHeight);
                    }
                }
                return new $.Point(x + this.xOffset, y - this.yOffset);
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

    $.ScalebarSizeAndTextRenderer = {
        /**
         * Metric length. From nano meters to kilometers.
         */
        METRIC_LENGTH: function(ppm, minSize) {
            return getScalebarSizeAndTextForMetric("m", ppm, minSize);
        },
        /**
         * Imperial length. Choosing the best unit from thou, inch, foot and mile.
         */
        IMPERIAL_LENGTH: function(ppm, minSize) {
            var maxSize = minSize * 2;
            var ppi = ppm * 0.0254;
            if (maxSize < ppi * 12) {
                if (maxSize < ppi) {
                    var ppt = ppi / 1000;
                    return getScalebarSizeAndText("th", ppt, minSize);
                }
                return getScalebarSizeAndText("in", ppi, minSize);
            }
            var ppf = ppi * 12;
            if (maxSize < ppf * 2000) {
                return getScalebarSizeAndText("ft", ppf, minSize);
            }
            var ppmi = ppf * 5280;
            return getScalebarSizeAndText("mi", ppmi, minSize);
        },
        /**
         * Astronomy units. Choosing the best unit from arcsec, arcminute, and degree
         */
        ASTRONOMY: function(ppa, minSize) {
            var maxSize = minSize * 2;
            if (maxSize < ppa * 60) {
                return getScalebarSizeAndText("\"", ppa, minSize, false, '');
            }
            var ppminutes = ppa * 60;
            if (maxSize < ppminutes * 60) {
                return getScalebarSizeAndText("\'", ppminutes, minSize, false, '');
            }
            var ppd = ppminutes * 60;
            return getScalebarSizeAndText("&#176", ppd, minSize, false, '');
        },
        /**
         * Standard time. Choosing the best unit from second (and metric divisions),
         * minute, hour, day and year.
         */
        STANDARD_TIME: function(pps, minSize) {
            var maxSize = minSize * 2;
            if (maxSize < pps * 60) {
                return getScalebarSizeAndTextForMetric("s", pps, minSize);
            }
            var ppminutes = pps * 60;
            if (maxSize < ppminutes * 60) {
                return getScalebarSizeAndText("minute", ppminutes, minSize, true);
            }
            var pph = ppminutes * 60;
            if (maxSize < pph * 24) {
                return getScalebarSizeAndText("hour", pph, minSize, true);
            }
            var ppd = pph * 24;
            if (maxSize < ppd * 365.25) {
                return getScalebarSizeAndText("day", ppd, minSize, true);
            }
            var ppy = ppd * 365.25;
            return getScalebarSizeAndText("year", ppy, minSize, true);
        },
        /**
         * Generic metric unit. One can use this function to create a new metric
         * scale. For example, here is an implementation of energy levels:
         * function(ppeV, minSize) {
         * return OpenSeadragon.ScalebarSizeAndTextRenderer.METRIC_GENERIC("eV", ppeV, minSize);
         * }
         */
        METRIC_GENERIC: getScalebarSizeAndTextForMetric
    };

    // Missing TiledImage.viewportToImageZoom function in OSD 2.0.0
    function tiledImageViewportToImageZoom(tiledImage, viewportZoom) {
        var ratio = tiledImage._scaleSpring.current.value *
            tiledImage.viewport._containerInnerSize.x /
            tiledImage.source.dimensions.x;
        return ratio * viewportZoom;
    }

    function getScalebarSizeAndText(unitSuffix, ppm, minSize, handlePlural, spacer) {
        spacer = spacer === undefined ? ' ' : spacer;
        var value = normalize(ppm, minSize);
        var factor = roundSignificand(value / ppm * minSize, 3);
        var size = value * minSize;
        var plural = handlePlural && factor > 1 ? "s" : "";
        return {
            size: size,
            text: factor + spacer + unitSuffix + plural
        };
    }

    function getScalebarSizeAndTextForMetric(unitSuffix, ppm, minSize, shouldFactorizeUnit=true) {
        var value = normalize(ppm, minSize);
        var factor = roundSignificand(value / ppm * minSize, 3);
        var size = value * minSize;
        var valueWithUnit = shouldFactorizeUnit ? getWithUnit(factor, unitSuffix) : getWithSpaces(factor, unitSuffix);
        return {
            size: size,
            text: valueWithUnit
        };
    }

    function normalize(value, minSize) {
        var significand = getSignificand(value);
        var minSizeSign = getSignificand(minSize);
        var result = getSignificand(significand / minSizeSign);
        if (result >= 5) {
            result /= 5;
        }
        if (result >= 4) {
            result /= 4;
        }
        if (result >= 2) {
            result /= 2;
        }
        return result;
    }

    function getSignificand(x) {
        return x * Math.pow(10, Math.ceil(-log10(x)));
    }

    function roundSignificand(x, decimalPlaces) {
        var exponent = -Math.ceil(-log10(x));
        var power = decimalPlaces - exponent;
        var significand = x * Math.pow(10, power);
        // To avoid rounding problems, always work with integers
        if (power < 0) {
            return Math.round(significand) * Math.pow(10, -power);
        }
        return Math.round(significand) / Math.pow(10, power);
    }

    function log10(x) {
        return Math.log(x) / Math.log(10);
    }

    function getWithUnit(value, unitSuffix) {
        const negative = value < 0;
        value = Math.abs(value);
        if (value < 0.000001) {
            return (negative ? "-" : "") + value * 1000000000 + " n" + unitSuffix;
        }
        if (value < 0.001) {
            return (negative ? "-" : "") + value * 1000000 + " μ" + unitSuffix;
        }
        if (value < 1) {
            return (negative ? "-" : "") + value * 1000 + " m" + unitSuffix;
        }
        if (value < 1000) {
            return (negative ? "-" : "") + value + unitSuffix;
        }
        if (value >= 1000) {
            return (negative ? "-" : "") + value / 1000 + " k" + unitSuffix;
        }
        return (negative ? "-" : "") + getWithSpaces(value / 1000, "k" + unitSuffix);
    }

    function getWithUnitRounded(value, unitSuffix) {
        const negative = value < 0;
        value = Math.abs(value);
        if (value < 0.000001) {
            return (negative ? "-" : "") + (Math.round(value * 100000000000) / 100) + " n" + unitSuffix;
        }
        if (value < 0.001) {
            return (negative ? "-" : "") + (Math.round(value * 100000000) / 100) + " μ" + unitSuffix;
        }
        if (value < 1) {
            return (negative ? "-" : "") + (Math.round(value * 100000) / 100) + " m" + unitSuffix;
        }
        if (value < 1000) {
            return (negative ? "-" : "") + (Math.round(value * 100) / 100) + unitSuffix;
        }
        if (value >= 1000) {
            return (negative ? "-" : "") + (Math.round(value / 10) / 100) + " k" + unitSuffix;
        }
        return (negative ? "-" : "") + getWithSpaces(Math.round(value) / 1000, "k" + unitSuffix);
    }

    function getWithSquareUnitRounded(value, unitSuffix) {
        const negative = value < 0;
        value = Math.abs(value);
        // No support for NM
        if (value < 0.000001) {
            return (negative ? "-" : "") + (Math.round(value * 100000000000000) / 100) + " μ" + unitSuffix;
        }
        if (value < 1) {
            return (negative ? "-" : "") + (Math.round(value * 100000000) / 100) + " m" + unitSuffix;
        }
        if (value < 1000000) {
            return (negative ? "-" : "") + (Math.round(value * 100) / 100) + unitSuffix;
        }
        if (value >= 1000000) {
            return (negative ? "-" : "") + (Math.round(value / 10) / 100) + " k" + unitSuffix;
        }
        return (negative ? "-" : "") + getWithSpaces(Math.round(value) / 1000, "k" + unitSuffix);
    }

    function getWithSpaces(value, unitSuffix) {
        if (value < 0) return "Negative!";
        //https://gist.github.com/MSerj/ad23c73f65e3610bbad96a5ac06d4924
        return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " " + unitSuffix;
    }

    function isDefined(variable) {
        return typeof (variable) !== "undefined";
    }
}(OpenSeadragon));