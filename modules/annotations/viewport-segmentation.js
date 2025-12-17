OSDAnnotations.ViewportSegmentation = class extends OSDAnnotations.AnnotationState {
    constructor(context) {
        super(context, "viewport-segmentation", "background_dot_small", "🆄  viewport segmentation");
        this.MagicWand = OSDAnnotations.makeMagicWand();
        this.ref = VIEWER.scalebar.getReferencedTiledImage();

        this.annotations = [];
        this._lastAlpha = null;
        this.ratio = OpenSeadragon.pixelDensityRatio;

        VIEWER.addHandler('visualization-used', () => {
            this._invalidData = Date.now();
        });

        VIEWER.addHandler('visualization-redrawn', () => {
            this._invalidData = Date.now();
        });

        this.drawer = new OpenSeadragon.Drawer({
            viewer:             VIEWER,
            viewport:           VIEWER.viewport,
            element:            VIEWER.canvas,
            debugGridColor:     VIEWER.debugGridColor
        });
        this.drawer.canvas.style.setProperty('z-index', '-999');
        this.drawer.canvas.style.setProperty('visibility', 'hidden');
        this.drawer.canvas.style.setProperty('display', 'none');

        this.disabled = APPLICATION_CONTEXT.config.visualizations.length < 1;
        this.tiledImageIndex = APPLICATION_CONTEXT.config.background.length;
    }

    handleClickUp(o, point, isLeftClick, objectFactory) {
        if (this._allowCreation && this.annotations) {
            for (let i = 0; i < this.annotations.length; i++) {
                delete this.annotations[i].strokeDashArray;
                this.context.fabric.deleteHelperAnnotation(this.annotations[i]);
                this.context.fabric.addAnnotation(this.annotations[i]);
            }

            this.annotations = [];
            this._allowCreation = false;
            this._lastAlpha = null;
        } else {
            this.context.setMode(this.context.Modes.AUTO);
        }

        return true;
    }

    handleClickDown(o, point, isLeftClick, objectFactory) {
        if (!objectFactory || this.disabled) {
            this.abortClick(isLeftClick);
            Dialogs.show(this.disabled ? 'There are no overlays to segment!' : 'Select a preset to annotate!');
            return;
        }

        this._allowCreation = true;
        this.context.fabric.clearAnnotationSelection(true);
        this._isLeft = isLeftClick;
    }

    handleMouseHover(event, point) {
        if (!this.context.presets.left || this.isZooming) {
            this._invalidData = Date.now();
            return;
        }

        this._isLeft = true;

        if (this._invalidData) {
            const { x, y, w, h } = this._getViewportScreenshotDimensions();
            this._prepareViewportScreenshot(x, y, w, h);
        }

        if (!this.data) return;

        const currentAlpha = this._getPixelAlpha(point);
        if (this._lastAlpha && this._lastAlpha === currentAlpha) {
            return;
        }

        this.data.binaryMask = this._getBinaryMask(this.data.data, this.data.width, this.data.height, currentAlpha);
        if (!this.data.binaryMask.bounds) return;

        this.data.binaryMask = this.MagicWand.gaussBlurOnlyBorder(this.data.binaryMask, 5);

        let contours = this.MagicWand.traceContours(this.data.binaryMask);
        contours = this.MagicWand.simplifyContours(contours, 0, 30);

        let { outerContours, innerContours } = this._categorizeContours(contours);
        let annotationsPoints = this._processContours(outerContours, innerContours);

        this._createAnnotations(annotationsPoints);
        this._lastAlpha = currentAlpha;
    }

    scrollZooming(event, delta) {
        this._invalidData = Date.now();
    }

    setFromAuto() {
        this.drawer.canvas.style.setProperty('display', 'block');

        const { x, y, w, h } = this._getViewportScreenshotDimensions();
        this._prepareViewportScreenshot(x, y, w, h);

        this.context.setOSDTracking(false);
        this.context.fabric.canvas.hoverCursor = "crosshair";
        this.context.fabric.canvas.defaultCursor = "crosshair";
        return true;
    }

    setToAuto(temporary) {
        if (this.annotations) {
            this.annotations.forEach(annotation => this.context.fabric.deleteHelperAnnotation(annotation));
            this.annotations = [];
        }

        this.data = null;
        this.drawer.canvas.style.setProperty('display', 'none');

        if (temporary) return false;
        this.context.setOSDTracking(true);
        return true;
    }

    accepts(e) {
        return e.code === "KeyU" && !e.ctrlKey && !e.shiftKey && !e.altKey;
    }

    rejects(e) {
        return e.code === "KeyU";
    }

    _prepareViewportScreenshot(x, y, w, h) {
        const canvasW = Math.round(VIEWER.drawer.canvas.width);
        const canvasH = Math.round(VIEWER.drawer.canvas.height);

        if (x < 0) {
            w += x;
            x = 0;
        }

        if (y < 0) {
            h += y;
            y = 0;
        }

        w = Math.min(w, canvasW);
        h = Math.min(h, canvasH);

        this.contentSize = {x, y, w, h};

        this.drawer.clear();

        // TODO: this does not work properly VIEWER.world.getItemAt(1)
        const targetImage = VIEWER.world.getItemAt(this.tiledImageIndex);
        if (!targetImage) return;
        const oldDrawer = targetImage._drawer;

        targetImage._drawer = this.drawer;
        targetImage.draw();
        targetImage._drawer = oldDrawer;

        const data = this.drawer.canvas.getContext('2d',{willReadFrequently:true}).getImageData(x, y, w, h);
        this.data = {
            width: data.width,
            height: data.height,
            data: data.data,
            bytes:4,
            rawData: data,
            binaryMask: null
        }
        this._invalidData = false;
        return this.data;
    }

    _getBinaryMask(data, width, height, alpha) {
        let mask = new Uint8ClampedArray(width * height);
        let maxX = -1, minX = width, maxY = -1, minY = height, bounds;

        let compareAlpha;
        if (!alpha) {
            compareAlpha = (a) => a <= 10;
        } else {
            compareAlpha = (a) => a > 10;
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = (y * width + x) * 4;
                const a = data[index + 3];

                if (compareAlpha(a)) {
                    const idx = y * width + x;
                    mask[idx] = 1;

                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (maxX === -1 || maxY === -1) {
            bounds = null;
        } else {
            bounds = { minX, minY, maxX, maxY };
        }

        return { data: mask, width, height, bounds };
    }

    _getViewportScreenshotDimensions() {
        let contentSize = this.ref.viewport._contentSize;

        let contentCoords = this.ref.imageToWindowCoordinates(new OpenSeadragon.Point(contentSize.x, contentSize.y));
        contentCoords.x *= this.ratio;
        contentCoords.y *= this.ratio;

        let topLeftCoords = this.ref.imageToWindowCoordinates(new OpenSeadragon.Point(0, 0));
        topLeftCoords.x *= this.ratio;
        topLeftCoords.y *= this.ratio;

        let viewportWidth = contentCoords.x - topLeftCoords.x;
        let viewportHeight = contentCoords.y - topLeftCoords.y;

        return { x: topLeftCoords.x, y: topLeftCoords.y, w: viewportWidth, h: viewportHeight };
    }

    _getPixelAlpha(point) {
        const windowPoint = this.ref.imageToWindowCoordinates(new OpenSeadragon.Point(point.x, point.y));
        windowPoint.x *= this.ratio;
        windowPoint.y *= this.ratio;

        const outOfBounds =
            windowPoint.x < this.contentSize.x ||
            windowPoint.y < this.contentSize.y ||
            windowPoint.x > this.contentSize.x + this.contentSize.w ||
            windowPoint.y > this.contentSize.y + this.contentSize.h;

        if (outOfBounds) return 0;

        const canvasX = Math.floor(windowPoint.x - this.contentSize.x);
        const canvasY = Math.floor(windowPoint.y - this.contentSize.y);
        const pixelIndex = (canvasY * this.data.width + canvasX) * 4;

        return this.data.data[pixelIndex + 3] > 10;
    }

    _categorizeContours(contours) {
        const offsetX = this.contentSize.x;
        const offsetY = this.contentSize.y;

        let outerContours = contours
            .filter(contour => !contour.inner)
            .map(contour => contour.points.map(point => ({
                x: point.x + offsetX,
                y: point.y + offsetY
            })));

        let innerContours = contours
            .filter(contour => contour.inner)
            .map(contour => contour.points.map(point => ({
                x: point.x + offsetX,
                y: point.y + offsetY
            })));

        return { outerContours, innerContours };
    }

    _processContours(outerContours, innerContours) {
        const polygonUtils = OSDAnnotations.PolygonUtilities;
        const polygonFactory = this.context.getAnnotationObjectFactory("polygon");

        let annotationsPoints = [];

        outerContours.forEach(outer => {
            const bboxOuter = polygonUtils.getBoundingBox(outer);

            let containedInners = innerContours.filter(inner => {
                const polygon = polygonFactory.create(inner, {});
                if (polygonFactory.getArea(polygon) <= 0) return false;

                const bboxInner = polygonUtils.getBoundingBox(inner);
                return polygonUtils.intersectAABB(bboxOuter, bboxInner) &&
                    OSDAnnotations.checkPolygonIntersect(inner, outer).length > 0;
            });

            outer = this._convertToImageCoordinates(outer);
            containedInners = containedInners.map(inner => this._convertToImageCoordinates(inner));

            annotationsPoints.push(containedInners.length > 0 ? [outer, ...containedInners] : [outer]);
        });

        return annotationsPoints;
    }

    _createAnnotations(annotationsPoints) {
        const polygonFactory = this.context.getAnnotationObjectFactory("polygon");
        const multipolygonFactory = this.context.getAnnotationObjectFactory("multipolygon");

        if (this.annotations) {
            this.annotations.forEach(annotation => this.context.fabric.deleteHelperAnnotation(annotation));
            this.annotations = [];
        }

        const visualProps = this.context.presets.getAnnotationOptions(this._isLeft);
        visualProps.strokeDashArray = [15, 15];

        annotationsPoints.forEach(points => {
            if (points.length === 1) {
                const polygon = polygonFactory.create(points[0], visualProps);
                if (polygonFactory.getArea(polygon) > 0) this.annotations.push(polygon);
            } else {
                const multipolygon = multipolygonFactory.create(points, visualProps);
                if (multipolygonFactory.getArea(multipolygon) > 0) this.annotations.push(multipolygon);
            }
        });

        this.annotations.forEach(annotation => this.context.fabric.addHelperAnnotation(annotation));
    }

    _convertToImageCoordinates(points) {
        return points.map(point =>
            this.ref.windowToImageCoordinates(new OpenSeadragon.Point(point.x / this.ratio, point.y / this.ratio))
        );
    }
}
