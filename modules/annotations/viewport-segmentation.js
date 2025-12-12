OSDAnnotations.ViewportSegmentation = class extends OSDAnnotations.AnnotationState {
    constructor(context) {
        super(context, "viewport-segmentation", "fa-border-top-left", "🆄  viewport segmentation");
        this.MagicWand = OSDAnnotations.makeMagicWand();

        this.annotations = [];
        this._lastAlpha = null;
        this.ratio = OpenSeadragon.pixelDensityRatio;
        this._tiRef = null;

        VIEWER_MANAGER.broadcastHandler('visualization-used', () => {
            this.prepareShaderConfig();
            this._invalidData = Date.now();
        });

        this.disabled = APPLICATION_CONTEXT.config.visualizations.length < 1;
        this.tiledImageIndex = APPLICATION_CONTEXT.config.background.length;
    }

    handleClickUp(o, point, isLeftClick, objectFactory) {
        if (this._allowCreation && this.annotations) {
            for (let i = 0; i < this.annotations.length; i++) {
                delete this.annotations[i].strokeDashArray;
                this.context.fabric.promoteHelperAnnotation(this.annotations[i]);
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

    locksViewer(oldViewerRef, newViewerRef) {
        const willKeepViewer = super.locksViewer(oldViewerRef, newViewerRef);
        if (!willKeepViewer) {
            this._cleanState();
        }
        return willKeepViewer;
    }

    async handleMouseHover(event, point) {
        if (!this.context.presets.left || this.isZooming) {
            this._invalidData = Date.now();
            return;
        }

        this._isLeft = true;

        const viewer = this.context.viewer;
        const b = viewer.viewport.getBoundsNoRotateWithMargins(true);
        const key = [
            b.x, b.y, b.width, b.height,
            viewer.viewport.getRotation(true),
            viewer.viewport.getZoom(true)
        ].join(",");

        const needsNewScreenshot =
            !this.data ||
            this._invalidData ||
            this._lastViewportKey !== key;

        if (needsNewScreenshot) {
            await this.prepareViewportScreenshot();
            this._lastViewportKey = key;
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
        this._tiRef = this.context.viewer.scalebar.getReferencedTiledImage();
        this.prepareShaderConfig();
        this.prepareViewportScreenshot();

        this.context.setOSDTracking(false);
        this.context.fabric.canvas.hoverCursor = "crosshair";
        this.context.fabric.canvas.defaultCursor = "crosshair";
        return true;
    }

    setToAuto(temporary) {
        this._cleanState();

        this.data = null;
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

    prepareShaderConfig() {
        // for some reason change in drawer completely wrongs the logics
        // of reading the texture, so the drawer must be recreated

        if (!this.drawer || this.drawer.viewer !== this.context.viewer) {
            this.drawer = OpenSeadragon.makeStandaloneFlexDrawer(this.context.viewer);
        }

        const shaders = this.context.viewer.drawer.renderer.getAllShaders();
        const result = {};
        if (shaders[this._selectedShader]) {
            result[this._selectedShader] = shaders[this._selectedShader].getConfig();
        } else {
            for (let id in shaders) {
                result[id] = shaders[id].getConfig();
            }
        }
        this._renderConfig = result;
    }

    async prepareViewportScreenshot(x, y, w, h) {
        const viewer = this.context.viewer;
        x = x || 0;
        y = y || 0;
        w = w || Math.round(viewer.drawer.canvas.width);
        h = h || Math.round(viewer.drawer.canvas.height);

        this.contentSize = {x, y, w, h};
        this._invalidData = true;

        await this.drawer.drawWithConfiguration(
            viewer.world._items,
            this._renderConfig,
            viewer.drawer,
            { x: w, y: h }
        );

        const data = new Uint8Array(w * h * 4); // RGBA8
        const gl   = this.drawer.renderer.gl;
        gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
        gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);

        // todo make this available on ALL events! viewer relative position
        this.offset = viewer.drawer.canvas.getBoundingClientRect();

        // vertical flip
        const row = w * 4;
        const tmp = new Uint8Array(row);
        for (let t = 0, b = (h - 1) * row; t < b; t += row, b -= row) {
            tmp.set(data.subarray(t, t + row));
            data.copyWithin(t, b, b + row);
            data.set(tmp, b);
        }

        this.data = {
            width:  w,
            height: h,
            data:   data,
            bytes:  4,
            rawData: data,
            binaryMask: new Uint8ClampedArray(w * h)
        };
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
                const index = (y * width + x) * 4 + 3;
                let a = data[index];

                if (compareAlpha(a)) {
                    mask[y * width + x] = 1;

                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        bounds = maxX === -1 || maxY === -1 ? null : { minX, minY, maxX, maxY };
        return { data: mask, width: width, height: height, bounds: bounds };
    }

    _getPixelAlpha(point) {
        const windowPoint = this._tiRef.imageToViewerElementCoordinates(new OpenSeadragon.Point(point.x, point.y));

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

        this._cleanState();

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

    _cleanState() {
        if (this.annotations) {
            this.annotations.forEach(annotation => this.context.fabric.deleteHelperAnnotation(annotation));
            this.annotations = [];
        }
    }

    _convertToImageCoordinates(points) {
        return points.map(point =>
            // we must call viewerElementToImageCoordinates since we don't want to strip the offset of the viewer
            this._tiRef.viewerElementToImageCoordinates(new OpenSeadragon.Point(point.x / this.ratio, point.y / this.ratio))
        );
    }
}
