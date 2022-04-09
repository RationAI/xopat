OpenSeadragon.Tools = class {

    /**
     * @param context OpenSeadragon instance
     */
    constructor(context) {
        this.viewer = context;
    }

    /**
     * OpenSeadragon is not accurate when dealing with
     * multiple tilesources: set your own reference tile source
     */
    linkReferenceTileSourceIndex(index) {
        this.referencedTileSource = this.viewer.world.getItemAt.bind(this.viewer.world, index);
    }

    /**
     * Compute size of one pixel in the image on your screen
     * @return {number} image pixel size on screen (should be between 0 and 1 in most cases)
     */
    imagePixelSizeOnScreen() {
        let viewport = this.viewer.viewport;
        let zoom = viewport.getZoom(true);
        if (this.__cachedZoom !== zoom) {
            this.__cachedZoom = zoom;
            let tileSource = this.referencedTileSource ? this.referencedTileSource() : viewport; //same API
            this.__pixelRatio = tileSource.imageToWindowCoordinates(new OpenSeadragon.Point(1, 0)).x -
                tileSource.imageToWindowCoordinates(new OpenSeadragon.Point(0, 0)).x;
        }
        return this.__pixelRatio;
    }

    /**
     * @param params Object that defines the focus
     * @param params.animationTime | params.duration (optional)
     * @param params.springStiffness | params.transition (optional)
     * @param params.bounds OpenSeadragon.Rect, if defined, the focus is immediate, in viewport coordinates;
     * else both elements below must be defined
     * @param params.immediately  focus immediately if true and params.bounds defined
     * @param params.point OpenSeadragon.Point center of focus
     * @param params.zoomLevel Number, zoom level
     */
    focus(params) {
        this.constructor.focus(this.viewer, params);
    }
    static focus(context, params) {
        let view = context.viewport,
            _centerSpringXAnimationTime = view.centerSpringX.animationTime,
            _centerSpringYAnimationTime = view.centerSpringY.animationTime,
            _zoomSpringAnimationTime = view.zoomSpring.animationTime;

        let duration = params.animationTime || params.duration;
        if (!isNaN(duration)) {
            view.centerSpringX.animationTime =
                view.centerSpringY.animationTime =
                    view.zoomSpring.animationTime =
                        duration;
        }

        let transition = params.springStiffness || params.transition;
        if (!isNaN(transition)) {
            view.centerSpringX.springStiffness =
                view.centerSpringY.springStiffness =
                    view.zoomSpring.springStiffness =
                        transition;
        }

        if (params.hasOwnProperty("bounds")) {
            view.fitBoundsWithConstraints(params.bounds, params.immediately);
        } else {
            view.panTo(params.point);
            view.zoomTo(params.zoomLevel);
        }
        view.applyConstraints();

        view.centerSpringX.animationTime = _centerSpringXAnimationTime;
        view.centerSpringY.animationTime = _centerSpringYAnimationTime;
        view.zoomSpring.animationTime = _zoomSpringAnimationTime;
    }

    /**
     * Create viewport screenshot
     * @param toImage true if <img> element should be created, otherwise raw byte array sent
     * @param {OpenSeadragon.Rect|object|undefined} focus screenshot focus area (screen coordinates)
     */
    screenshot(toImage, focus=undefined) {
        return this.constructor.screenshot(this.viewer, toImage, point);
    }
    static screenshot(context, toImage, focus) {
        if (context.drawer.canvas.width < 1) return undefined;
        let drawCtx = context.drawer.context;
        if (!drawCtx) throw "OpenSeadragon must render with canvasses!";
        if (!focus) focus = new OpenSeadragon.Rect(0, 0, window.innerWidth, window.innerHeight);
        let data = drawCtx.getImageData(focus.x,focus.y, focus.width, focus.height);
        if (toImage) {
            let canvas = document.createElement('canvas'),
                ctx = canvas.getContext('2d');
            canvas.width = focus.width;
            canvas.height = focus.height;
            ctx.putImageData(data, 0, 0);

            let img = document.createElement("img");
            img.src = canvas.toDataURL();
            return img;
        }
        return data.data;
    }


    link(child) {
        this.constructor.link(child, this.viewer);
    }
    static link(child, parent) {
        if (child.__linkHandler) child.removeHandler(child.__linkHandler);
        if (parent.__linkHandler) parent.removeHandler(parent.__linkHandler);

        child.__linkHandler =  function (e) {
            if (child.__synced) {
                child.__synced = false;
                return;
            }
            parent.__synced = true;
            OpenSeadragon.Tools.syncViewers(child, parent);
        };
        parent.__linkHandler = function (e) {
            if (parent.__synced) {
                parent.__synced = false;
                return;
            }
            child.__synced = true;
            OpenSeadragon.Tools.syncViewers(parent, child);
        };

        child.addHandler('viewport-change', child.__linkHandler);
        parent.addHandler('viewport-change', parent.__linkHandler);


        // child.__innerTracker = child.innerTracker;
        // child.innerTracker = parent.innerTracker;
        // child.__outerTracker = child.outerTracker;
        // child.outerTracker = parent.outerTracker;
        // let temp = new OpenSeadragon.LinkedViewport(child.viewport, parent.viewport);
        // parent.viewport = new OpenSeadragon.LinkedViewport(parent.viewport, child.viewport);
        // child.viewport = temp;
        //

        OpenSeadragon.Tools.syncViewers(child, parent);
        // window.addEventListener('resize', function () {
        //     OpenSeadragon.Tools.syncViewers(child, parent);
        // });
    }

    syncViewers(viewer, otherViewer) {
        this.constructor.syncViewers(viewer, otherViewer);
    }
    static syncViewers(viewer, otherViewer) {
        this._syncViewports(viewer.viewport, otherViewer.viewport);
    }
    static _syncViewports(viewport, otherViewport) {
        otherViewport.fitBoundsWithConstraints(viewport.getBounds(), true);
    }
};

OpenSeadragon.LinkedViewport = class {
    constructor(context, parentContext) {
        this.p = parentContext; this.ch = context;
    }

    resetContentSize(contentSize) {
        OpenSeadragon.Tools._syncViewports(this.ch, this.p);
        return this.ch.resetContentSize(contentSize);
    }

    getHomeZoom() { return this.ch.getHomeZoom(); }
    getHomeBounds() { return this.ch.getHomeBounds(); }
    getHomeBoundsNoRotate() { return this.ch.getHomeBoundsNoRotate(); }
    getMinZoom() { return this.ch.getMinZoom(); }
    getMaxZoom() { return this.ch.getMaxZoom(); }
    getAspectRatio() { return this.ch.getAspectRatio(); }
    getContainerSize() { return this.ch.getContainerSize(); }
    getMargins() { return this.ch.getMargins(); }
    setMargins(margins) { this.ch.setMargins(margins); }
    getBounds(current) { return this.ch.getBounds(current); }
    getBoundsNoRotate(current) { return this.ch.getBoundsNoRotate(current); }
    getBoundsWithMargins(current) { return this.ch.getBoundsWithMargins(current); }
    getBoundsNoRotateWithMargins(current) { return this.ch.getBoundsNoRotateWithMargins(current); }
    getCenter(current) { return this.ch.getCenter(current); }
    getZoom(current) { return this.ch.getZoom(current); }
    getConstrainedBounds(current) { return this.ch.getConstrainedBounds(current); }
    getRotation() { return this.ch.getRotation(); }

    goHome(immediately) {
        this.p.goHome(immediately);
        return this.ch.goHome(immediately);
    }

    applyConstraints(immediately) {
        OpenSeadragon.Tools._syncViewports(this.ch, this.p);
        return this.ch.applyConstraints(immediately);
    }

    ensureVisible(immediately) {
        return this.applyConstraints(immediately);
    }

    fitBounds(bounds, immediately) {
        OpenSeadragon.Tools._syncViewports(this.ch, this.p);
        return this.ch.fitBounds(bounds, immediately);
    }

    fitBoundsWithConstraints(bounds, immediately) {
        //this.p.fitBoundsWithConstraints(bounds, immediately);
        return this.ch.fitBoundsWithConstraints(bounds, immediately);
    }

    fitVertically(immediately) {
        OpenSeadragon.Tools._syncViewports(this.ch, this.p);
        return this.ch.fitVertically(immediately);
    }

    fitHorizontally(immediately) {
        OpenSeadragon.Tools._syncViewports(this.ch, this.p);
        return this.ch.fitHorizontally(immediately);
    }

    panBy( delta, immediately ) {
        OpenSeadragon.Tools._syncViewports(this.ch, this.p);
        return this.ch.panBy(delta, immediately);
    }

    panTo( center, immediately ) {
        OpenSeadragon.Tools._syncViewports(this.ch, this.p);
        return this.ch.panTo(center, immediately);
    }

    zoomBy(factor, refPoint, immediately) {
        this.p.zoomBy(factor, refPoint, immediately);
        return this.ch.zoomBy(factor, refPoint, immediately);
    }

    zoomTo(zoom, refPoint, immediately) {
        this.p.zoomTo(zoom, refPoint, immediately);
        return this.ch.zoomTo(zoom, refPoint, immediately);
    }

    setRotation(degrees) {
        this.p.setRotation(degrees);
        return this.ch.setRotation(degrees);
    }

    resize( newContainerSize, maintain ) {
        OpenSeadragon.Tools._syncViewports(this.ch, this.p);
        return this.ch.resize(newContainerSize, maintain);
    }

    update() {
        this.p.update();
        return this.ch.update();
    }

    deltaPixelsFromPointsNoRotate(deltaPoints, current) {
        return this.ch.deltaPixelsFromPointsNoRotate(deltaPoints, current);
    }

    deltaPixelsFromPoints(deltaPoints, current) {
        return this.ch.deltaPixelsFromPointsNoRotate(deltaPoints, current);
    }

    deltaPointsFromPixelsNoRotate(deltaPixels, current) {
        return this.ch.deltaPixelsFromPointsNoRotate(deltaPixels, current);
    }

    deltaPointsFromPixels(deltaPixels, current) {
        return this.ch.deltaPointsFromPixels(deltaPixels, current);
    }

    pixelFromPointNoRotate(point, current) {
        return this.ch.pixelFromPointNoRotate(point, current);
    }

    pixelFromPoint(point, current) { return this.ch.pixelFromPoint(point, current); }

    pointFromPixelNoRotate(pixel, current) {
        return this.ch.pointFromPixelNoRotate(pixel, current);
    }

    pointFromPixel(pixel, current) {
        return this.ch.pointFromPixel(pixel, current);
    }

    viewportToImageCoordinates(viewerX, viewerY) {
        return this.ch.viewportToImageCoordinates(viewerX, viewerY);
    }

    imageToViewportCoordinates(imageX, imageY) {
        return this.ch.imageToViewportCoordinates(imageX, imageY);
    }

    imageToViewportRectangle(imageX, imageY, pixelWidth, pixelHeight) {
        return this.ch.imageToViewportRectangle(imageX, imageY, pixelWidth, pixelHeight);
    }

    viewportToImageRectangle(viewerX, viewerY, pointWidth, pointHeight) {
        return this.ch.viewportToImageRectangle(viewerX, viewerY, pointWidth, pointHeight);
    }

    viewerElementToImageCoordinates( pixel ) {
        return this.ch.viewerElementToImageCoordinates(pixel);
    }

    imageToViewerElementCoordinates( pixel ) {
        return this.ch.imageToViewerElementCoordinates(pixel);
    }

    windowToImageCoordinates(pixel) {
        return this.ch.windowToImageCoordinates(pixel);
    }

    imageToWindowCoordinates(pixel) {
        return this.ch.imageToWindowCoordinates(pixel);
    }

    viewerElementToViewportCoordinates( pixel ) {
        return this.ch.viewerElementToViewportCoordinates(pixel);
    }

    viewportToViewerElementCoordinates( point ) {
        return this.ch.viewportToViewerElementCoordinates(point);
    }

    viewerElementToViewportRectangle(rectangle) {
        return this.ch.viewerElementToViewportRectangle(rectangle);
    }

    viewportToViewerElementRectangle(rectangle) {
        return this.ch.viewportToViewerElementRectangle(rectangle);
    }

    windowToViewportCoordinates(pixel) {
        return this.ch.windowToViewportCoordinates(pixel);
    }

    viewportToWindowCoordinates(point) {
        return this.ch.viewportToWindowCoordinates(point);
    }

    viewportToImageZoom(viewportZoom) {
        return this.ch.viewportToImageZoom(viewportZoom);
    }

    imageToViewportZoom(imageZoom) {
        return this.ch.imageToViewportZoom(imageZoom);
    }

    toggleFlip() {
        this.p.toggleFlip();
        return this.ch.toggleFlip();
    }

    getFlip() {
        return this.ch.getFlip();
    }

    setFlip( state ) {
        this.p.setFlip(state);
        return this.ch.setFlip(state);
    }
};
