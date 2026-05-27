VIEWER.addOnceHandler('open', () => {
    const DELAY = 90;
    let last = 0;
    new OpenSeadragon.MouseTracker({
        userData: 'pixelTracker',
        element: "viewer-container",
        moveHandler: function(e) {
            const now = Date.now();
            if (now - last < DELAY) return;

            last = now;
            const image = VIEWER.scalebar.getReferencedTiledImage() || VIEWER.world.getItemAt(0);
            if (!image) return;
            const screen = new OpenSeadragon.Point(e.originalEvent.x, e.originalEvent.y);
            // const ratio = VIEWER.scalebar.imagePixelSizeOnScreen();
            const position = image.windowToImageCoordinates(screen);

            let result = [`${Math.round(position.x)}, ${Math.round(position.y)} px`];
            //bit hacky, will improve once we refactor openseadragon rendering
            const vis = VIEWER.bridge && VIEWER.bridge.visualization(),
                hasBg = APPLICATION_CONTEXT.config.background.length > 0;
            let tidx = 0;

            const viewport = VIEWER.viewport.windowToViewportCoordinates(screen);
            if (hasBg) {
                const pixel = getPixelData(screen, viewport, tidx);
                if (pixel) {
                    result.push(`tissue: R${pixel[0]} G${pixel[1]} B${pixel[2]}`)
                } else {
                    result.push(`tissue: -`)
                }
                tidx++;
            }

            if (vis) {
                const pixel = getPixelData(screen, viewport, tidx);
                if (pixel) {
                    result.push(`overlay: R${pixel[0]} G${pixel[1]} B${pixel[2]}`)
                } else {
                    result.push(`overlay: -`)
                }
            }
            USER_INTERFACE.Status.show(result.join("<br>"));
        }
    });

    //const weakCacheRef = new WeakMap();
    /**
     *
     * @param viewportPosition
     * @param {number|OpenSeadragon.TiledImage} tiledImage
     */
    function getPixelData(screen, viewportPosition, tiledImage) {
        function changeTile() {
            let tiles = tiledImage.lastDrawn;
            //todo verify tiles order, need to ensure we prioritize higher resolution!!!
            for (let i = 0; i < tiles.length; i++) {
                if (tiles[i].bounds.containsPoint(viewportPosition)) {
                    return tiles[i];
                }
            }
            return undefined;
        }

        if (Number.isInteger(tiledImage)) {
            tiledImage = VIEWER.world.getItemAt(tiledImage);
        }
        let tile;
        tile = changeTile();
        if (!tile) {
            //todo err?
            return undefined;
        }

        // get position on a current tile
        let x = screen.x - tile.position.x;
        let y = screen.y - tile.position.y;

        //todo: reads canvas context out of the result, not the original data
        let canvasCtx = tile.getCanvasContext();
        let relative_x = Math.round((x / tile.size.x) * canvasCtx.canvas.width);
        let relative_y = Math.round((y / tile.size.y) * canvasCtx.canvas.height);
        return canvasCtx.getImageData(relative_x, relative_y, 1, 1).data;
    }
});
