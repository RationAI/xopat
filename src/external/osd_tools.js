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
     * @deprecated
     * @return {Promise<void>} promise resolved once event finishes
     */
    async raiseAwaitEvent(context, eventName, eventArgs = undefined) {
        console.warn("This event is deprecated.");
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
    static screenshot(viewer, toImage, size = {}, focus=undefined) {
        if (viewer.drawer.canvas.width < 1) return undefined;

        if (!focus) focus = new OpenSeadragon.Rect(0, 0, window.innerWidth, window.innerHeight);
        size.width = size.width || focus.width;
        size.height = size.height || focus.height;
        let ar = size.width / size.height;
        if (focus.width < focus.height) focus.width *= ar;
        else focus.height /= ar;

        let canvas = document.createElement('canvas'),
            ctx = canvas.getContext('2d');
        canvas.width = size.width;
        canvas.height = size.height;
        ctx.drawImage(viewer.drawer.canvas, focus.x, focus.y, size.width, size.height, 0, 0, size.width, size.height);

        if (toImage) {
            let img = document.createElement("img");
            img.src = canvas.toDataURL();
            return img;
        }
        return ctx;
    }

    /**
     * Create thumbnail screenshot
     * @param {BackgroundItem} config bg config
     * @param {object} size the output size
     * @param {number} size.width
     * @param {number} size.height
     * @return {Promise<CanvasRenderingContext2D>}
     */
    navigatorThumbnail(config, size = {}) {
        return this.constructor.navigatorThumbnail(this.viewer, config, size);
    }
    static navigatorThumbnail(viewer, bgConfig, size = {}) {
        if (viewer.drawer.canvas.width < 1) return Promise.reject("No image to create thumbnail from!");
        // todo works for background right now only -> check how we can extend for also viz layers
        if (!bgConfig.id) {
            console.error("Thumbnail can be created for now only from background configurations!");
            return Promise.reject("No background configuration provided!");
        }

        // Keep single offscreen renderer between apps
        let drawer;
        viewer.__ofscreenRender = (drawer = viewer.__ofscreenRender || OpenSeadragon.makeStandaloneFlexDrawer(viewer));
        if (viewer.navigator) {
            viewer = viewer.navigator;
        }
        
        drawer.renderer.setDimensions(0, 0, viewer.drawer.canvas.width, viewer.drawer.canvas.height, 1);
        let config = viewer.drawer.renderer.getShaderLayerConfig(bgConfig.id) || {
            id: bgConfig.id,
            type: "identity",
            tiledImages: [-1],
            name: bgConfig.name || APPLICATION_CONTEXT.config.data[bgConfig.dataReference]
        };
        drawer.overrideConfigureAll({[bgConfig.id]: config});

        const bgUrlFromEntry = (bgEntry) => {
            if (bgEntry.tileSource instanceof OpenSeadragon.TileSource) {
                return bgEntry.tileSource;
            }
            const proto = !APPLICATION_CONTEXT.getOption("secureMode") && bgEntry.protocol ? bgEntry.protocol : APPLICATION_CONTEXT.env.client.image_group_protocol;
            const make = new Function("path,data", "return " + proto);
            const d = APPLICATION_CONTEXT.config.data[bgEntry.dataReference];
            return make(APPLICATION_CONTEXT.env.client.image_group_server, d);
        };

        return new Promise((resolve, reject) => {
            let exited = false;
            let timeout;

            let loadCount = 0;
            const images = [];
            for (let idx of config.tiledImages) {
                loadCount++;
                if (idx === -1) {
                    loadCount++;
                    viewer.createTiledImage({tileSource: bgUrlFromEntry(bgConfig),
                        success: e => {
                            if (exited) return;
                            e.item.__sshotIndex = images.length;
                            e.item.__synthetic = true;
                            // simply download the current tiles
                            e.item.update(true);
                            e.item.whenFullyLoaded(() => {
                                images.push(e.item);

                                if (loadCount < 1) {
                                    loadCount--;
                                    clearTimeout(timeout);
                                    resolve(images);
                                }
                            });
                        }, error: e => {
                            if (exited) return;
                            loadCount--;
                            images.error = e;

                            if (loadCount < 1) {
                                clearTimeout(timeout);
                                resolve(images);
                            }
                        }}
                    );
                } else {
                    const item = viewer.world.getItemAt(idx);
                    item.whenFullyLoaded(() => {
                        images.push(item);
                        loadCount--;
                        item.__sshotIndex = images.length;

                        if (loadCount < 1) {
                            clearTimeout(timeout);
                            resolve(images);
                        }
                    });
                }
            }

            if (loadCount < 1) {
                resolve(images);
            } else {
                timeout = setTimeout(() => {
                    exited = true;
                    reject("Failed to retrieve tiled images and their tiles before timeout.");
                }, 30000);
            }
        }).then(async images => {
            // todo check images are properly freed if created...
            if (images.error) {
                throw images.error;
            }

            const originalTiledImages = config.tiledImages;
            config.tiledImages = images.map(i => i.__sshotIndex);

            const bounds = viewer.viewport.getHomeBounds();
            await drawer.draw(images, {
                bounds: bounds,
                center: new OpenSeadragon.Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
                rotation: 0,
                zoom: 1.0 / bounds.width,
            });
            config.tiledImages = originalTiledImages;

            let canvas = document.createElement('canvas'),
                ctx = canvas.getContext('2d');
            canvas.width = size.width;
            canvas.height = size.height;
            ctx.drawImage(drawer.canvas, 0, 0, drawer.canvas.width, drawer.canvas.height, 0, 0, size.width, size.height);
            return ctx;
        });
    }

    // /**
    //  * Create region screenshot, the screenshot CAN BE ANYWHERE
    //  * @param {object} region region of interest in the image pixel space
    //  * @param {number} region.x
    //  * @param {number} region.y
    //  * @param {number} region.width
    //  * @param {number} region.height
    //  * @param {object} targetSize desired size (should have the same AR -aspect ratio- as region),
    //  *  the result tries to find a level on which the region
    //  *  is closest in size to the desired size
    //  * @param {number} targetSize.width
    //  * @param {number} targetSize.height
    //  * @param {function} onfinish function that is called on screenshot finish, argument is a canvas with resulting image
    //  * @param {object} [outputSize=targetSize] output image size, defaults to target size
    //  * @param {number} outputSize.width
    //  * @param {number} outputSize.height
    //  */
    // offlineScreenshot(region, targetSize, onfinish, outputSize=targetSize) {
    //     throw new Error("not implemented yet");
    //     // todo consume a configuration object, and render it -> could be used also for the

    //
    //     let referencedTiledImage = this.viewer.scalebar.getReferencedTiledImage();
    //
    //     const batches = {};
    //     this.viewer.addHandler('tile-loaded', e => {
    //         if (e.tile in batches) {
    //             const data = batches[e.tile];
    //             if (data.timeout) clearTimeout(data.timeout);
    //             data.onload(e.tile);
    //         }
    //     });
    //
    //     function download(tiledImage, level, x, y, onload, onfail) {
    //         const tile = tiledImage._getTile(level, x, y);
    //         if (!tile.loaded || !tile.loading) {
    //             batches[tile] = { onload, onfail, timeout: setTimeout(() => {
    //                     onfail(tile);
    //                     delete batches[tile].timeout;
    //                 }, 15000)};
    //             tiledImage._loadTile(tile, OpenSeadragon.now());
    //         }
    //     }
    //
    //     function buildImageForLayer(tiledImage, region, level, onBuilt) {
    //         let source = tiledImage.source,
    //             viewportX = region.x / source.width,
    //             viewportY = region.y / source.width,
    //             viewportXAndWidth = (region.x+region.width-1) / source.width,
    //             viewportYAdnHeight = (region.y+region.height-1) / source.width; //minus 1 to avoid next tile if not needed
    //
    //         let tileXY = source.getTileAtPoint(level, new OpenSeadragon.Point(viewportX, viewportY)),
    //             tileXWY = source.getTileAtPoint(level, new OpenSeadragon.Point(viewportXAndWidth, viewportY)),
    //             tileXYH = source.getTileAtPoint(level, new OpenSeadragon.Point(viewportX, viewportYAdnHeight)),
    //             tileXWYH = source.getTileAtPoint(level, new OpenSeadragon.Point(viewportXAndWidth, viewportYAdnHeight));
    //
    //         const onLoad = tile => {
    //             finish();
    //         }
    //
    //         const onFail = tile => {
    //             delete batches[tile];
    //             finish();
    //         };
    //
    //         function finish() {
    //             count--;
    //             if (count === 0) {
    //                 onBuilt();
    //             }
    //         }
    //
    //         // todo correct zoom based on size
    //         let count = 4;
    //         download(tiledImage, level, tileXY.x, tileXY.y, onLoad, onFail);
    //         if (tileXY.x !== tileXWY.x) download(tiledImage, level, tileXWY.x, tileXWY.y, onLoad, onFail);
    //         else count--;
    //         if (tileXY.y !== tileXYH.y) download(tiledImage, level, tileXYH.x, tileXYH.y, onLoad, onFail);
    //         else count--;
    //         //being forced to download all means diagonally too
    //         if (count === 4) download(tiledImage, level, tileXWYH.x, tileXWYH.y, onLoad, onFail);
    //         else count--;
    //     }
    //
    //     // todo consider multiimage support
    //     for (let tImage of [referencedTiledImage]) {
    //         const level = this.constructor._bestLevelForTiledImage(tImage, region, targetSize);
    //         // todo support multiple images, e.g. fluorescence
    //         buildImageForLayer(tImage, region, level, () => {
    //             let drawer;
    //             this.viewer.__ofscreenRender = (drawer = this.viewer.__ofscreenRender || OpenSeadragon.makeStandaloneFlexDrawer(this.viewer));
    //             drawer.renderer.setDimensions(0, 0, outputSize.width, outputSize.height, 1);
    //             const bg = tImage.getConfig("background");
    //             const config = this.viewer.drawer.renderer.getShaderLayerConfig(bg?.id);
    //             drawer.overrideConfigureAll({[config.id]: config});
    //
    //             const oldHandler = tImage.getTilesToDraw;
    //             tImage.getTilesToDraw = function() {
    //                 return Object.keys(batches);
    //             }
    //             const bounds = tImage.imageToViewportRectangle(region);
    //             drawer.draw([tImage], {
    //                 bounds: bounds,
    //                 center: new OpenSeadragon.Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
    //                 rotation: 0,
    //                 zoom: 1.0 / bounds.width,
    //             });
    //             tImage.getTilesToDraw = oldHandler;
    //             onfinish();
    //         });
    //     }
    // }
    // static _bestLevelForTiledImage(image, region, targetSize) {
    //
    //     //best level is found by tile size fit wrt. annotation size
    //     function getDiff(source, level) {
    //         let scale = source.getLevelScale(level);
    //
    //         //scale multiplication computes no. of pixels at given pyramid level
    //         return Math.min(Math.abs(region.width * scale - targetSize.width),
    //             Math.abs(region.height * scale - targetSize.height));
    //     }
    //
    //     let source = image.source,
    //         bestLevel = source.maxLevel,
    //         d = getDiff(source, bestLevel);
    //
    //     for (let i = source.maxLevel-1; i >= source.minLevel; i--) {
    //         let dd = getDiff(source, i);
    //         if (dd > d) break;
    //         bestLevel = i;
    //         d = dd;
    //     }
    //     return bestLevel;
    // }

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
