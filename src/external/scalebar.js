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


        this.refreshHandler = function () {
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
            this.magnificationContainer.style.left = location.x + 8 + "px";
            this.magnificationContainer.style.top = location.y - this.magnificationContainerHeight - 50 + "px";

        }.bind(this);
        this._init(!options.destroy);
        this.setMinWidth(options.minWidth || "150px");
    };

    $.Scalebar.prototype = {
        /**
         * Referenced tile image getter used for measurements
         * todo we should provide references scale image allways and all
         *  access on BG data should be via the APP Context
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

                let tiledImage = this.getReferencedTiledImage() || this.viewer.world.getItemAt(0);
                //todo proprietary func from before OSD 2.0, remove? search API
                this.__pixelRatio = tiledImageViewportToImageZoom(tiledImage, zoom);
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
            return getWithUnitRounded(length / this.pixelsPerMeter,
                this.sizeAndTextRenderer === $.ScalebarSizeAndTextRenderer.METRIC_LENGTH ? "m" : "px");
        },

        imageAreaToGivenUnits: function(area) {
            //todo what about flexibility in units?
            return getWithSquareUnitRounded(area / (this.pixelsPerMeter*this.pixelsPerMeter),
                this.sizeAndTextRenderer === $.ScalebarSizeAndTextRenderer.METRIC_LENGTH ? "m" : "px");
        },

        _init: function (doInit) {
            if (doInit) {
                this._active = true;
                if (!this.scalebarContainer) {
                    this.scalebarContainer = document.createElement("div");
                    this.scalebarContainer.style.position = "relative";
                    this.scalebarContainer.style.margin = "0";
                    this.scalebarContainer.style.pointerEvents = "none";
                    this.scalebarContainer.id = "viewer-scale-bar";
                }
                this.viewer.container.appendChild(this.scalebarContainer);

                if (!this.magnificationContainer) {
                    this.magnificationContainer = document.createElement("div");
                    this.magnificationContainer.id = "viewer-magnification";
                    // this.magnificationContainer.style.display = "none";

                    if (this.magnification > 0) {
                        this.magnificationContainer.style.position = "relative";
                        this.magnificationContainer.style.margin = "0";
                        this.magnificationContainer.style.background = "var(--color-bg-backdrop)";
                        this.magnificationContainer.style.paddingBottom = "8px";
                        this.magnificationContainer.style.paddingTop = "4px";
                        this.magnificationContainer.style.paddingLeft = "16px";
                        this.magnificationContainer.style.paddingRight = "8px";
                        this.magnificationContainer.style.opacity = "0.6";
                        this.magnificationContainer.style.display = "flex";
                        this.magnificationContainer.style.flexDirection = "column";
                        this.magnificationContainer.style.height =`${this.magnificationContainerHeight}px`;
                        this.magnificationContainer.style.width = "60px";

                        this.magnificationContainer.style.borderRadius = "7px";

                        let steps = 0;
                        let testMag = this.magnification;
                        while (testMag > 4) {
                            testMag = Math.round(testMag / 2);
                            steps++;
                        }

                        const minValue = 0;
                        const sliderContainer = document.createElement("span");

                        const range = {max: [this.magnification], min: [1]}, values = [this.magnification];
                        let mag = this.magnification, stepPerc = Math.round(100 / (steps+1)), stepPercIter = 100;
                        while (mag > 4) {
                            mag = Math.floor(mag / 2);
                            stepPercIter -= stepPerc;
                            range[`${stepPercIter}%`] = [mag];
                            values.push(mag);
                        }
                        values.push(1);
                        values.reverse();

                        const updateZoom = (mag) => {
                            const image = this.getReferencedTiledImage();
                            if (!image) {
                                throw "Linked referenced image does not exist!";
                            }
                            if (mag < 2) {
                                this.viewer.viewport.goHome();
                            } else {
                                const desiredZoom = image.imageToViewportZoom(mag / this.magnification);
                                this.viewer.viewport.zoomTo(desiredZoom);
                            }
                        };

                        const reflectUpdate = (e) => {
                            const image = this.getReferencedTiledImage();
                            if (!image) {
                                console.error("Linked referenced image does not exist!");
                            }
                            const desiredZoom = image.viewportToImageZoom(e.zoom) * this.magnification;
                            sliderContainer.noUiSlider.set(desiredZoom);
                        };
                        VIEWER.addHandler('zoom', reflectUpdate);

                        function closestValue (v) {
                            let d = Infinity, result = -1;
                            for (let i = 0; i < values.length; i++) {
                                let dd = Math.abs(values[i] - v);
                                if (dd < d) {
                                    d = dd;
                                    result = i;
                                }
                            }
                            return result;
                        }

                        let button = document.createElement("span");
                        button.innerHTML = "remove";
                        button.classList.add("material-icons", "btn-pointer");
                        button.style.userSelect = 'none';
                        button.addEventListener("click", (event) => {
                            const index = closestValue(Number.parseInt(sliderContainer.noUiSlider.get()));
                            if (index < 1) return;
                            sliderContainer.noUiSlider.set(values[index-1]);
                            updateZoom(values[index-1]);
                        });
                        this.magnificationContainer.appendChild(button);
                        this.magnificationContainer.appendChild(sliderContainer);
                        noUiSlider.create(sliderContainer, {
                            range: range,
                            start: minValue,
                            // limit: limit,
                            connect: true,
                            direction: 'ltr',
                            orientation: 'vertical',
                            behaviour: 'drag',
                            tooltips: false,
                            //format: format,
                            pips: {
                                mode: 'values',
                                values: values,
                                density: 5,
                                format: {
                                    // 'to' the formatted value. Receives a number.
                                    to: function (value) {
                                        return value < 2 ? '⌂' : value;
                                    },
                                    // 'from' the formatted value.
                                    // Receives a string, should return a number.
                                    from: function (value) {
                                        return value === '⌂' ? 0 : value;
                                    }
                                }
                            }
                        });
                        button = document.createElement("span");
                        button.innerHTML = "add";
                        button.classList.add("material-icons", "btn-pointer");
                        button.style.userSelect = 'none';
                        button.addEventListener("click", (event) => {
                            const index = closestValue(Number.parseInt(sliderContainer.noUiSlider.get()));
                            if (index >= values.length-1) return;
                            sliderContainer.noUiSlider.set(values[index+1]);
                            updateZoom(values[index+1]);
                        });
                        this.magnificationContainer.appendChild(button);
                        //todo custom ranges

                        sliderContainer.noUiSlider.target.classList.add('d-inline-block', 'flex-1');
                        sliderContainer.noUiSlider.target.style.width = "4px";

                        sliderContainer.noUiSlider.on("change", (event) => {
                            updateZoom(Number.parseInt(sliderContainer.noUiSlider.get()));
                        });

                        function onPipiClick() {
                            let value = Number.parseInt(this.getAttribute('data-value'));
                            sliderContainer.noUiSlider.set(value);
                            updateZoom(value);
                        }
                        let pips = sliderContainer.querySelectorAll('.noUi-value');
                        for (let i = 0; i < pips.length; i++) {
                            pips[i].addEventListener('click', onPipiClick);
                        }
                    }
                    this.viewer.container.appendChild(this.magnificationContainer);
                }
                this.viewer.addHandler("open", this.refreshHandler);
                this.viewer.addHandler("update-viewport", this.refreshHandler);
            } else {
                this._active = false;
                this.viewer.removeHandler("open", this.refreshHandler);
                this.viewer.removeHandler("update-viewport", this.refreshHandler);
                let container = document.getElementById("viewer-scale-bar");
                if (container) container.remove();
                container = document.getElementById("viewer-scale-bar");
                if (container) container.remove();
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

            this._init(!options.destroy);

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
            } else {
                this.drawScalebar = this.drawMicroscopyScalebar;
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
            this.refreshHandler();
        },
        drawMicroscopyScalebar: function(size, text) {
            this.scalebarContainer.style.fontSize = this.fontSize;
            this.scalebarContainer.style.fontFamily = this.fontFamily;
            this.scalebarContainer.style.textAlign = "center";
            this.scalebarContainer.style.fontWeight = "600";
            this.scalebarContainer.style.color = this.fontColor;
            this.scalebarContainer.style.border = "none";
            this.scalebarContainer.style.borderBottom = this.barThickness + "px solid " + this.color;
            this.scalebarContainer.style.backgroundColor = this.backgroundColor;
            this.scalebarContainer.innerHTML = text;
            this.scalebarContainer.style.width = size + "px";
        },
        drawMapScalebar: function(size, text) {
            this.scalebarContainer.style.fontSize = this.fontSize;
            this.scalebarContainer.style.fontFamily = this.fontFamily;
            this.scalebarContainer.style.textAlign = "center";
            this.scalebarContainer.style.color = this.fontColor;
            this.scalebarContainer.style.border = this.barThickness + "px solid " + this.color;
            this.scalebarContainer.style.borderTop = "none";
            this.scalebarContainer.style.backgroundColor = this.backgroundColor;
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
         *   return OpenSeadragon.ScalebarSizeAndTextRenderer.METRIC_GENERIC("eV", ppeV, minSize);
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
        if (value < 0.000001) {
            return value * 1000000000 + " n" + unitSuffix;
        }
        if (value < 0.001) {
            return value * 1000000 + " μ" + unitSuffix;
        }
        if (value < 1) {
            return value * 1000 + " m" + unitSuffix;
        }
        if (value < 1000) {
            return value + unitSuffix;
        }
        if (value >= 1000) {
            return value / 1000 + " k" + unitSuffix;
        }
        return getWithSpaces(value / 1000, "k" + unitSuffix);
    }

    function getWithUnitRounded(value, unitSuffix) {
        if (value < 0.000001) {
            return (Math.round(value * 100000000000) / 100) + " n" + unitSuffix;
        }
        if (value < 0.001) {
            return (Math.round(value * 100000000) / 100) + " μ" + unitSuffix;
        }
        if (value < 1) {
            return (Math.round(value * 100000) / 100) + " m" + unitSuffix;
        }
        if (value < 1000) {
            return (Math.round(value * 100) / 100) + unitSuffix;
        }
        if (value >= 1000) {
            return (Math.round(value / 10) / 100) + " k" + unitSuffix;
        }
        return getWithSpaces(Math.round(value) / 1000, "k" + unitSuffix);
    }

    function getWithSquareUnitRounded(value, unitSuffix) {
        // No support for NM
        if (value < 0.000001) {
            return (Math.round(value * 100000000000000) / 100) + " μ" + unitSuffix;
        }
        if (value < 1) {
            return (Math.round(value * 100000000) / 100) + " m" + unitSuffix;
        }
        if (value < 1000000) {
            return (Math.round(value * 100) / 100) + unitSuffix;
        }
        if (value >= 1000000) {
            return (Math.round(value / 10) / 100) + " k" + unitSuffix;
        }
        return getWithSpaces(Math.round(value) / 1000, "k" + unitSuffix);
    }

    function getWithSpaces(value, unitSuffix) {
        if (value < 0) return "Negative distance!";
        //https://gist.github.com/MSerj/ad23c73f65e3610bbad96a5ac06d4924
        return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " " + unitSuffix;
    }

    function isDefined(variable) {
        return typeof (variable) !== "undefined";
    }
}(OpenSeadragon));
