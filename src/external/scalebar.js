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
                this.magnificationContainer.style.left = location.x + 8 + "px";
                this.magnificationContainer.style.top = location.y - this.magnificationContainerHeight - 50 + "px";
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
            if (!options.destroy) {
                this.id = options.viewer.id + "-scale-bar";
                this._active = true;
                if (!this.scalebarContainer) {
                    this.scalebarContainer = document.createElement("div");
                    this.scalebarContainer.classList.add("relative", "m-0", "pointer-events-none");
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

                        this.magnificationContainer = document.createElement("div");
                        this.magnificationContainer.id = this.id + "-magnification";
                        this.magnificationContainer.classList.add(
                            "relative",
                            "m-0",
                            "glass",
                            "backdrop-blur-[2px]",
                            "pr-2", "pt-1", "pb-2",
                            "rounded-lg",
                            "shadow-sm",
                            "ring-1", "ring-base-300/40",
                            "flex", "flex-col", "items-center", "gap-1.5",
                        );
                        this.magnificationContainer.style.height = `${this.magnificationContainerHeight}px`;
                        this.magnificationContainer.style.width  = "50px";

                        // --- Dynamic Range & Log Scale Calculation ---
                        const viewport = this.viewer.viewport;
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
rgba(255, 255, 255, 1) 0%, 
rgba(255, 255, 255, 1) ${percentNative}%, 
rgba(255, 100, 100, 1) ${percentNative}%, 
rgba(255, 100, 100, 1) 100%)`;

                        const sliderContainer = document.createElement("span");

                        const mkBtn = (iconClass) => {
                            const b = document.createElement("button");
                            b.type = "button";
                            b.className = "btn btn-ghost btn-xs min-h-0 w-7 h-7 p-0 rounded-md text-base-content/70 hover:text-base-content bg-transparent border-transparent";
                            b.innerHTML = `<i class="fa-solid fa-auto ${iconClass}"></i>`;
                            return b;
                        };


                        // Max Zoom Button (Zoom In / Plus) - Goes at Bottom
                        let plusBtn = mkBtn("fa-plus");
                        this.magnificationContainer.appendChild(plusBtn);

                        const sliderWrap = document.createElement("div");
                        sliderWrap.className = "relative flex-1 flex items-center justify-center w-full";
                        sliderWrap.style.minHeight = "120px";
                        this.magnificationContainer.appendChild(sliderWrap);
                        sliderWrap.appendChild(sliderContainer);

                        this.viewer.container.appendChild(this.magnificationContainer);

                        // Min Zoom Button (Zoom Out / Minus) - Goes at Top
                        let minusBtn = mkBtn("fa-minus");
                        this.magnificationContainer.appendChild(minusBtn);

                        // --- Initialize noUiSlider ---
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
                        };
                        this.viewer.addHandler('zoom', reflectUpdate);

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

                        minusBtn.addEventListener("click", () => stepSlider(-1));
                        plusBtn.addEventListener("click", () => stepSlider(1));

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

                        this.refreshHandler();
                    };

                    if (this.viewer.isOpen()) {
                        initSlider();
                    } else {
                        this.viewer.addOnceHandler('open', initSlider);
                    }
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
                this.viewer.removeHandler("update-viewport", this.refreshHandler);
                let container = document.getElementById(this.id);
                if (container) container.remove();
                if (this.magnificationContainer) this.magnificationContainer.remove();
                this.magnificationContainer = null;
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
            this.scalebarContainer.style.borderBottom = this.barThickness + "px solid " + this.color;
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