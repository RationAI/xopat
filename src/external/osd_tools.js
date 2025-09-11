/**
 * Utilities for the OpenSeadragon Viewer.
 * Available as OpenSeadragon.tools instance (attaches itself on creation).
 * in xOpat: VIEWER.tools.[...]
 * @type {OpenSeadragon.Tools}
 */
OpenSeadragon.Tools = class {

    /**
     * @param context OpenSeadragon instance
     */
    constructor(context) {
        //todo initialize explicitly outside to help IDE resolution
        if (context.tools) throw "OSD Tools already instantiated on the given viewer instance!";
        context.tools = this;
        this.viewer = context;
    }

    /**
     * EventSource - compatible event raising with support for async function waiting
     * @param context EventSource instance
     * @param eventName name of the event to invoke
     * @param eventArgs event args object
     * @return {Promise<void>} promise resolved once event finishes
     */
    async raiseAwaitEvent(context, eventName, eventArgs = undefined) {
        let events = context.events[ eventName ];
        if ( !events || !events.length ) {
            return null;
        }
        events = events.length === 1 ?
            [ events[ 0 ] ] :
            Array.apply( null, events );
        eventArgs = eventArgs || {};

        const length = events.length;
        async function loop(index) {
            if ( index >= length || !events[ index ] ) {
                return;
            }
            eventArgs.stopPropagation = function () {
                index = length;
            };
            eventArgs.eventSource = context;
            eventArgs.userData = events[ index ].userData;
            let result = events[ index ].handler( eventArgs );
            if (result && OpenSeadragon.type(result) === "promise") {
                await result;
            }
            await loop(index + 1);
        }
        return await loop(0);
    }

    /**
     * @param params Object that defines the focus
     * @param params.bounds OpenSeadragon.Rect, in viewport coordinates;
     *   both elements below must be defined if bounds are undefined
     * @param params.point OpenSeadragon.Point center of focus
     * @param params.zoomLevel Number, zoom level
     *
     * @param params.animationTime | params.duration (optional)
     * @param params.springStiffness | params.transition (optional)
     * @param params.immediately focus immediately if true (optional)
     * @param params.preferSameZoom optional, default: keep the user's viewport as close as possible if false,
     *   or keep the same zoom level if true; note this value is ignored if appropriate data not present
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

        if ((params.point && params.zoomLevel) && (params.preferSameZoom || !params.bounds)) {
            view.panTo(params.point, params.immediately);
            view.zoomTo(params.zoomLevel, params.immediately);
        } else if (params.bounds) {
            view.fitBoundsWithConstraints(params.bounds, params.immediately);
        } else {
            throw "No valid focus data provided!";
        }
        view.applyConstraints();

        view.centerSpringX.animationTime = _centerSpringXAnimationTime;
        view.centerSpringY.animationTime = _centerSpringYAnimationTime;
        view.zoomSpring.animationTime = _zoomSpringAnimationTime;
    }

    /**
     * Create viewport screenshot
     * @param {boolean} toImage true if <img> element should be created, otherwise Context2D
     * @param {object} size the output size
     * @param {number} size.width
     * @param {number} size.height
     * @param {(OpenSeadragon.Rect|object|undefined)} [focus=undefined] screenshot
     *   focus area (screen coordinates), by default thw whole viewport
     * @return {CanvasRenderingContext2D|Image}
     */
    screenshot(toImage, size = {}, focus=undefined) {
        return this.constructor.screenshot(this.viewer, toImage, size, focus);
    }
    static screenshot(context, toImage, size = {}, focus=undefined) {
        if (context.drawer.canvas.width < 1) return undefined;
        let drawCtx = context.drawer.context;
        if (!drawCtx) throw "OpenSeadragon must render with canvasses!";

        if (!focus) focus = new OpenSeadragon.Rect(0, 0, window.innerWidth, window.innerHeight);
        size.width = size.width || focus.width;
        size.height = size.height || focus.height;
        let ar = size.width / size.height;
        if (focus.width < focus.height) focus.width *= ar;
        else focus.height /= ar;

        if (toImage) {
            let data = drawCtx.getImageData(focus.x,focus.y, focus.width, focus.height);
            let canvas = document.createElement('canvas'),
                ctx = canvas.getContext('2d');
            canvas.width = size.width;
            canvas.height = size.height;
            ctx.putImageData(data, 0, 0);

            let img = document.createElement("img");
            img.src = canvas.toDataURL();
            return img;
        }
        return drawCtx;
    }

    /**
     * Create region screenshot, the screenshot CAN BE ANYWHERE
     * @param {object} region region of interest in the image pixel space
     * @param {number} region.x
     * @param {number} region.y
     * @param {number} region.width
     * @param {number} region.height
     * @param {object} targetSize desired size (should have the same AR -aspect ratio- as region),
     *  the result tries to find a level on which the region
     *  is closest in size to the desired size
     * @param {number} targetSize.width
     * @param {number} targetSize.height
     * @param {function} onfinish function that is called on screenshot finish, argument is a canvas with resulting image
     * @param {object} [outputSize=targetSize] output image size, defaults to target size
     * @param {number} outputSize.width
     * @param {number} outputSize.height
     */
    offlineScreenshot(region, targetSize, onfinish, outputSize=targetSize) {
        let referencedTiledImage = this.viewer.scalebar.getReferencedTiledImage();
        let referencedSource = referencedTiledImage.source;

        function download(tiledImage, level, x, y, onload, onfail) {
            //copied over from tileSource.js
            //todo consider using  tiledImage._getTile(...)
            let tileSource = tiledImage.source;
            let numTiles = tileSource.getNumTiles( level );
            let xMod    = ( numTiles.x + ( x % numTiles.x ) ) % numTiles.x;
            let yMod    = ( numTiles.y + ( y % numTiles.y ) ) % numTiles.y;
            let bounds  = tiledImage.getTileBounds( level, x, y );
            let sourceBounds = tileSource.getTileBounds( level, xMod, yMod, true );
            let exists  = tileSource.tileExists( level, xMod, yMod );
            let url     = tileSource.getTileUrl( level, xMod, yMod );
            let post    = tileSource.getTilePostData( level, xMod, yMod );
            let ajaxHeaders;

            // Headers are only applicable if loadTilesWithAjax is set
            if (tiledImage.loadTilesWithAjax) {
                ajaxHeaders = tileSource.getTileAjaxHeaders( level, xMod, yMod );
                // Combine tile AJAX headers with tiled image AJAX headers (if applicable)
                if (OpenSeadragon.isPlainObject(tiledImage.ajaxHeaders)) {
                    ajaxHeaders = $.extend({}, tiledImage.ajaxHeaders, ajaxHeaders);
                }
            } else {
                ajaxHeaders = null;
            }

            let tile = new OpenSeadragon.Tile(
                level,
                x,
                y,
                bounds,
                exists,
                url,
                undefined,
                tiledImage.loadTilesWithAjax,
                ajaxHeaders,
                sourceBounds,
                post,
                tileSource.getTileHashKey(level, xMod, yMod, url, ajaxHeaders, post)
            );

            tile.loading = true;
            tiledImage._imageLoader.addJob({
                src: tile.getUrl(),
                tile: tile,
                source: tiledImage.source,
                postData: tile.postData,
                loadWithAjax: tile.loadWithAjax,
                ajaxHeaders: tile.ajaxHeaders,
                crossOriginPolicy: tiledImage.crossOriginPolicy,
                ajaxWithCredentials: tiledImage.ajaxWithCredentials,
                callback: function( data, errorMsg, tileRequest ){
                    tile.loading = false;
                    if ( !data ) {
                        tile.exists = false;
                        onfail(data, tile);
                        return;
                    }
                    tile.tiledImage = tiledImage;
                    onload(data, tile);
                },
                abort: function() {
                    tile.loading = false;
                    onfail(data, tile);
                }
            });
        }

        function buildImageForLayer(tiledImage, region, level, onBuilt) {
            let source = tiledImage.source,
                viewportX = region.x / referencedSource.width,
                viewportY = region.y / referencedSource.width,
                viewportXAndWidth = (region.x+region.width-1) / referencedSource.width,
                viewportYAdnHeight = (region.y+region.height-1) / referencedSource.width; //minus 1 to avoid next tile if not needed

            let tileXY = source.getTileAtPoint(level, new OpenSeadragon.Point(viewportX, viewportY)),
                tileXWY = source.getTileAtPoint(level, new OpenSeadragon.Point(viewportXAndWidth, viewportY)),
                tileXYH = source.getTileAtPoint(level, new OpenSeadragon.Point(viewportX, viewportYAdnHeight)),
                tileXWYH = source.getTileAtPoint(level, new OpenSeadragon.Point(viewportXAndWidth, viewportYAdnHeight));

            let scale = referencedSource.getLevelScale(level),
                tileWidth = source.getTileWidth(level),
                tileHeight = source.getTileHeight(level),
                x = Math.floor(region.x * scale),
                y = Math.floor(region.y * scale),
                w = Math.floor(region.width * scale),
                h = Math.floor(region.height * scale),
                canvas = document.createElement('canvas'),
                c2d = canvas.getContext('2d');

            canvas.width = w;
            canvas.height = h;

            function draw(data, tile) {
                let sx = tileWidth * tile.x - x, sy = tileHeight * tile.y - y,
                    sDx = 0, sDy = 0,
                    dw = tile.sourceBounds.width, dh = tile.sourceBounds.height;

                if (sx < 0) { //tile above rendering area
                    dw += sx;
                    sDx = -sx;
                    sx = 0;
                }
                if (sDy < 0) {
                    dh += sy;
                    sDy = -sy;
                    sy = 0;
                }

                //prepares all underlying workings
                tile.setCache(data, tile.cacheKey);
                const canvas = tile.getCanvasContext ? tile.getCanvasContext()?.canvas : tile.getImage();
                c2d.drawImage(canvas, sDx, sDy, dw, dh, sx, sy, dw, dh);

                //frees the unused tile
                //TODO allow destruction: source.destroyTileCache(cache);
                finish();
            }

            function fill(data, tile) {
                console.log("aborted", data);
                finish();
            }

            function finish() {
                count--;
                if (count === 0) {
                    //todo draw annotation or just the rectangle...? maybe add padding first now we just render the region of interest
                    // c2d.lineWidth = 3;
                    // c2d.rect(1, 1, w-1, h-1);
                    // c2d.stroke();
                    onBuilt(canvas);
                }
            }

            //todo check this more programatically by comparing necessary coords
            let count = 4;
            download(tiledImage, level, tileXY.x, tileXY.y, draw, fill);
            if (tileXY.x !== tileXWY.x) download(tiledImage, level, tileXWY.x, tileXWY.y, draw, fill);
            else count--;
            if (tileXY.y !== tileXYH.y) download(tiledImage, level, tileXYH.x, tileXYH.y, draw, fill);
            else count--;
            //being forced to download all means diagonally too
            if (count === 4) download(tiledImage, level, tileXWYH.x, tileXWYH.y, draw, fill);
            else count--;
        }

        let canvasCache = {};

        const itemCount = 1; //VIEWER.world.getItemCount(); todo not working properly across different levels :/

        /**
         * Problem: should render either the same level (preferred if possible),
         *  or scale different level so that they overlap correctly
         */


        let steps = itemCount;
        // let level = Math.min(
        //     this.constructor._bestLevelForTiledImage(referencedTiledImage, region, targetSize),
        //     this.viewer.bridge ? this.viewer.bridge.getTiledImage().source.maxLevel : Infinity
        // );
        for (let itemIndex = 0; itemIndex < itemCount; itemIndex++) {
            //todo if not transparent and opacity 1, do not draw previous item
            const tImage = VIEWER.world.getItemAt(itemIndex);
            const handler = (index, canvas) => {
                steps--;
                canvasCache[index] = canvas;

                if (steps < 1) {
                    let outputCanvas = document.createElement('canvas'),
                        c2d = outputCanvas.getContext('2d');
                    outputCanvas.width = outputSize.width;
                    outputCanvas.height = outputSize.height;

                    for (let i=0; i < itemCount; i++) {
                        const c = canvasCache[i];
                        if (c) c2d.drawImage(c, 0, 0, c.width, c.height);
                    }
                    onfinish(outputCanvas);
                }
            };

            const level = this.constructor._bestLevelForTiledImage(tImage, region, targetSize);
            buildImageForLayer(tImage, region, level, handler.bind(null, itemIndex));
        }
    }
    static _bestLevelForTiledImage(image, region, targetSize) {

        //best level is found by tile size fit wrt. annotation size
        function getDiff(source, level) {
            let scale = source.getLevelScale(level);

            //scale multiplication computes no. of pixels at given pyramid level
            return Math.min(Math.abs(region.width * scale - targetSize.width),
                Math.abs(region.height * scale - targetSize.height));
        }

        let source = image.source,
            bestLevel = source.maxLevel,
            d = getDiff(source, bestLevel);

        for (let i = source.maxLevel-1; i >= source.minLevel; i--) {
            let dd = getDiff(source, i);
            if (dd > d) break;
            bestLevel = i;
            d = dd;
        }
        return bestLevel;
    }

    /**
     * Link the viewer to context-sharing navigation link: all viewers of the same context
     * will follow the same navigation path.
     * @param context
     */
    link(context=0) {
        this.constructor.link(this.viewer, context);
    }

    /**
     * Link the viewer to context-sharing navigation link: all viewers of the same context
     * will follow the same navigation path.
     * @param {OpenSeadragon.Viewer} self
     * @param context
     */
    static link(self, context=0) {
        let contextData = this._linkContexts[context];
        if (!contextData) {
            contextData = this._linkContexts[context] = { name: context, leading: null, subscribed: [] };
        }

        const handler = function() {
            const leading = contextData.leading;
            if (leading !== null) {
                return;
            }
            contextData.leading = self;
            const leadViewport = self.viewport;

            for (let v of contextData.subscribed) {
                const vp = v.viewport;
                // todo consider viewport update event and setting only: (might not respect rotation / flip)
                //  otherViewport.fitBoundsWithConstraints(viewport.getBounds(), true);
                vp.zoomTo(leadViewport.getZoom());
                vp.panTo(leadViewport.getCenter());
                vp.rotateTo(leadViewport.getRotation());
                vp.setFlip(leadViewport.flipped);
            }
            contextData.leading = null;
        };

        self.__sync_handler = handler;
        contextData.subscribed.push(self);
        self.addHandler('zoom', handler);
        self.addHandler('pan', handler);
        self.addHandler('rotate', handler);
        self.addHandler('flip', handler);
    }

    isLinked() {
        return !!this.viewer.__sync_handler;
    }

    /**
     * Unlink the viewer from context-sharing navigation link.
     * @param context
     */
    unlink(context=0) {
        this.constructor.unlink(this.viewer, context);
    }

    /**
     * Unlink the viewer from context-sharing navigation link.
     * @param {OpenSeadragon.Viewer} self
     * @param context
     */
    static unlink(self, context=0) {
        const contextData = this._linkContexts[context];
        if (!contextData) return;
        const index = contextData.subscribed.indexOf(self);
        if (index < 0) return;
        self.removeHandler('zoom', self.__sync_handler);
        self.removeHandler('pan', self.__sync_handler);
        self.removeHandler('rotate', self.__sync_handler);
        self.removeHandler('flip', self.__sync_handler);
        delete self.__sync_handler;
        contextData.subscribed.splice(index, 1);
    }

    /**
     * Destroy the context-sharing navigation link for all viewers.
     * @param context
     */
    static destroyLink(context=0) {
        const contextData = this._linkContexts[context];
        if (!contextData) return;
        for (let v of contextData.subscribed) {
            v.removeHandler('zoom', v.__sync_handler);
            v.removeHandler('pan', v.__sync_handler);
            v.removeHandler('rotate', v.__sync_handler);
            v.removeHandler('flip', v.__sync_handler);
            delete v.__sync_handler;
        }
        delete contextData.subscribed;
        delete contextData.leading;
        delete this._linkContexts[context];
    }

    static destroyLinks() {
        for (let context in this._linkContexts) {
            this.destroyLink(context);
        }
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

OpenSeadragon.Tools._linkContexts = {};
