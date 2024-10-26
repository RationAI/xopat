function initXopatScripts() {
    $.extend($.scrollTo.defaults, {axis: 'y'});

    //https://github.com/mrdoob/stats.js
    if (APPLICATION_CONTEXT.getOption("debugMode")) {
        (function(){var script=document.createElement('script');script.onload=function(){var stats=new Stats();document.body.appendChild(stats.dom);stats.showPanel(1);requestAnimationFrame(function loop(){stats.update();requestAnimationFrame(loop)});};script.src=APPLICATION_CONTEXT.url+'src/external/stats.js';document.head.appendChild(script);})()
    }

    // opacity of general layer available everywhere
    $("#global-opacity input").on("input", function() {
        let val = $(this).val();
        for (let imageIndex = 0; imageIndex < VIEWER.world.getItemCount(); imageIndex++) {
            const image = VIEWER.world.getItemAt(imageIndex);
            if (!image.getBackgroundConfig) {
                image.setOpacity(val);
            }
        }
    });

    $(VIEWER.element).on('contextmenu', function(event) {
        event.preventDefault();
    });

    /**
     * Focusing all key press events and forwarding to OSD
     * attaching `focusCanvas` flag to recognize if key pressed while OSD on focus
     */
    let focusOnViewer = true;
    VIEWER.addHandler('canvas-enter', function() {
        focusOnViewer = true;
    });
    VIEWER.addHandler('canvas-exit', function() {
        focusOnViewer = false;
    });
    VIEWER.addHandler('canvas-key', function(e) {
        focusOnViewer = true;
        e.preventDefaultAction = true;
    });
    function getIsViewerFocused() {
        // TODO TEST!!!
        const focusedElement = document.activeElement;
        const focusTyping = focusedElement.tagName === 'INPUT' ||
            focusedElement.tagName === 'TEXTAREA' ||
            focusedElement.isContentEditable;
        return focusOnViewer && !focusTyping;
    }
    /**
     * Allows changing focus state artificially
     * @param {boolean} focused
     */
    UTILITIES.setIsCanvasFocused = function(focused) {
        focusOnViewer = focused;
    };
    document.addEventListener('keydown', function(e) {
        e.focusCanvas = getIsViewerFocused();
        /**
         * @property {KeyboardEvent} e
         * @property {boolean} e.focusCanvas
         * @memberOf VIEWER
         * @event keydown
         */
        VIEWER.raiseEvent('key-down', e);
    });
    document.addEventListener('keyup', function(e) {
        e.focusCanvas = getIsViewerFocused();
        /**
         * @property {KeyboardEvent} e
         * @property {boolean} e.focusCanvas
         * @memberOf VIEWER
         * @event key-up
         */
        VIEWER.raiseEvent('key-up', e);
    });
    //consider global mouseup/down events. or maybe not - clicking is
    // contextual and is enough to implement listeners on elements (unlike key hits)...
    // document.addEventListener('mouseup', function(e) {
    //     e.focusCanvas = focusOnViewer;
    //     VIEWER.raiseEvent('mouse-up', e);
    // });

    let failCount = new WeakMap();
    VIEWER.addHandler('tile-load-failed', function(e) {
        if (e.message === "Image load aborted") return;
        let index = VIEWER.world.getIndexOfItem(e.tiledImage);
        let failed = failCount[index];
        if (!failed || failed != e.tiledImage) {
            failCount[index] = e.tiledImage;
            e.tiledImage._failedCount = 1;
        } else {
            let d = e.time - e.tiledImage._failedDate;
            if (d < 500) {
                e.tiledImage._failedCount++;
            } else {
                e.tiledImage._failedCount = 1;
            }
            if (e.tiledImage._failedCount > 5) {
                e.tiledImage._failedCount = 1;
                //to-docs
                e.worldIndex = index;
                /**
                 * The Viewer might decide to remove faulty TiledImage automatically.
                 * The removal is not done automatically, but this event is fired.
                 * The owner is recommended to remove the tiled image instance.
                 * @property {TiledImage} e
                 * @memberOf VIEWER
                 * @event tiled-image-problematic
                 */
                VIEWER.raiseEvent('tiled-image-problematic', e);
            }
        }
        e.tiledImage._failedDate = e.time;
    });

    /**
     * From https://github.com/openseadragon/openseadragon/issues/1690
     * brings better zooming behaviour
     */
    window.VIEWER.addHandler("canvas-scroll", function() {
        if (typeof this.scrollNum == 'undefined') {
            this.scrollNum = 0;
        }

        if (typeof this.lastScroll == 'undefined') {
            this.lastScroll = new Date();
        }

        this.currentScroll = new Date(); //Time that this scroll occurred at

        if (this.currentScroll - this.lastScroll < 400) {
            this.scrollNum++;
        } else {
            this.scrollNum = 0;
            VIEWER.zoomPerScroll = 1.2;
        }

        if (this.scrollNum > 2 && VIEWER.zoomPerScroll <= 2.5) {
            VIEWER.zoomPerScroll += 0.2;
        }

        this.lastScroll = this.currentScroll; //Set last scroll to now
    });

    window.VIEWER.addHandler('navigator-scroll', function(e) {
        VIEWER.viewport.zoomBy(e.scroll / 2 + 1); //accelerated zoom
        VIEWER.viewport.applyConstraints();
    });

    if (!APPLICATION_CONTEXT.getOption("preventNavigationShortcuts")) {
        function adjustBounds(speedX, speedY) {
            let bounds = VIEWER.viewport.getBounds();
            bounds.x += speedX*bounds.width;
            bounds.y += speedY*bounds.height;
            VIEWER.viewport.fitBounds(bounds);
        }
        VIEWER.addHandler('key-up', function(e) {
            if (e.focusCanvas) {
                let zoom = null,
                    speed = 0.3;
                switch (e.key) {
                case "Down": // IE/Edge specific value
                case "ArrowDown":
                    adjustBounds(0, speed);
                    break;
                case "Up": // IE/Edge specific value
                case "ArrowUp":
                    adjustBounds(0, -speed);
                    break;
                case "Left": // IE/Edge specific value
                case "ArrowLeft":
                    adjustBounds(-speed, 0);
                    break;
                case "Right": // IE/Edge specific value
                case "ArrowRight":
                    adjustBounds(speed, 0);
                    break;
                case "+":
                    zoom = VIEWER.viewport.getZoom();
                    VIEWER.viewport.zoomTo(zoom + zoom * speed * 3);
                    return;
                case "-":
                    zoom = VIEWER.viewport.getZoom();
                    VIEWER.viewport.zoomTo(zoom - zoom * speed * 2);
                    return;
                default:
                    return; // Quit when this doesn't handle the key event.
                }
            }

            if (e.key === 'Escape') {
                USER_INTERFACE.AdvancedMenu.close();
                USER_INTERFACE.Tutorials.hide();
            }
        });
    }

    //Attempt to prevent re-submit, but now it fires two messages - POST resubmit and content..
    // function preventDirtyClose(e) {
    //     e.preventDefault();
    //     if (APPLICATION_CONTEXT.__cache.dirty) return "You will lose your workspace if you leave now: are you sure?";
    //
    //     RefreshForm.submit();
    //     return;
    // }
    //
    // if (window.addEventListener) {
    //     window.addEventListener('beforeunload', preventDirtyClose, true);
    // } else if (window.attachEvent) {
    //     window.attachEvent('onbeforeunload', preventDirtyClose);
    // }

    /**
     * Get the date as ISO string
     * @return {string}
     */
    window.UTILITIES.todayISO = function(separator="/") {
        return new Date().toJSON().slice(0,10).split('-').reverse().join(separator);
    };

    /**
     * Get current date as reversed ISO year first
     * @param separator
     * @returns {string}
     */
    window.UTILITIES.todayISOReversed = function(separator="/") {
        return new Date().toJSON().slice(0,10).split('-').join(separator);
    };

    /**
     * Safely evaluate boolean parameter from JSON config, e.g. undefined | "false" | "True" | 0 | 1 | false
     * string values are treated as true except for 'false' literals and empty string
     * @param {any} value to evaluate
     * @param {boolean} defaultValue true or false
     * @return {*|boolean}
     */
    window.UTILITIES.isJSONBoolean = function(value, defaultValue) {
        return (defaultValue && value === undefined) || (value && (typeof value !== "string" || value.trim().toLocaleLowerCase() !== "false"));
    };

    /**
     * Set the App theme
     * @param {?string} theme primer_css theme
     */
    window.UTILITIES.updateTheme = function(theme=undefined) {
        theme = theme || APPLICATION_CONTEXT.getOption("theme");
        if (!["dark", "dark_dimmed", "light", "auto"].some(t => t === theme)) theme = APPLICATION_CONTEXT.config.defaultParams.theme;
        if (theme === "dark_dimmed") {
            document.documentElement.dataset['darkTheme'] = "dark_dimmed";
            document.documentElement.dataset['colorMode'] = "dark";
        } else {
            document.documentElement.dataset['darkTheme'] = "dark";
            document.documentElement.dataset['colorMode'] = theme;
        }
    };

    /**
     * Create the viewer configuration serialized
     */
    window.UTILITIES.serializeAppConfig = function(withCookies=false) {
        //TODO consider bypassCache etc...
        let bypass = APPLICATION_CONTEXT.config.params.bypassCookies;
        if (!withCookies) APPLICATION_CONTEXT.config.params.bypassCookies = true;
        APPLICATION_CONTEXT.config.params.bypassCacheLoadTime = true;
        let oldViewport = APPLICATION_CONTEXT.config.params.viewport;
        APPLICATION_CONTEXT.config.params.viewport = {
            zoomLevel: VIEWER.viewport.getZoom(),
            point: VIEWER.viewport.getCenter()
        };

        //by default ommit underscore
        let app = APPLICATION_CONTEXT.layersAvailable && window.WebGLModule
            ? JSON.stringify(APPLICATION_CONTEXT.config, WebGLModule.jsonReplacer)
            : JSON.stringify(APPLICATION_CONTEXT.config, (key, value) => key.startsWith("_") ? undefined : value);
        APPLICATION_CONTEXT.config.params.viewport = oldViewport;
        APPLICATION_CONTEXT.config.params.bypassCookies = bypass;
        APPLICATION_CONTEXT.config.params.bypassCacheLoadTime = false;
        return app;
    };

    /**
     * Get the viewer form+script html that automatically redirects to the viewer
     * @param customAttributes
     * @param includedPluginsList
     * @param withCookies
     * @return {Promise<string>}
     */
    window.UTILITIES.getForm = async function(customAttributes="", includedPluginsList=undefined, withCookies=false) {
        if (! APPLICATION_CONTEXT.env.serverStatus.supportsPost) {
            return `
    <form method="POST" id="redirect" action="${APPLICATION_CONTEXT.url}#${encodeURI(UTILITIES.serializeAppConfig(withCookies))}">
        <input type="hidden" id="visualization" name="visualization">
        ${customAttributes}
        <input type="submit" value="">
        </form>
    <script type="text/javascript">const form = document.getElementById("redirect").submit();<\/script>`;
        }

        const {app, data} = await window.UTILITIES.serializeApp(includedPluginsList, withCookies);
        data.visualization = app;

        let form = `
    <form method="POST" id="redirect" action="${APPLICATION_CONTEXT.url}">
        ${customAttributes}
        <input type="submit" value="">
    </form>
    <script type="text/javascript">
        const form = document.getElementById("redirect");
        let node;`;

        function addExport(key, data) {
            form += `node = document.createElement("input");
node.setAttribute("type", "hidden");
node.setAttribute("name", "${key}");
node.setAttribute("value", JSON.stringify(${JSON.stringify(data)}));
form.appendChild(node);`;
        }

        for (let id in data) {
            // dots seem to be reserved names therefore use IDs differently
            const sets = id.split('.'), dataItem = data[id];
            // namespaced export within "modules" and "plugins"
            if (sets.length === 1) {
                //handpicked allowed namespaces
                if (id === "visualization") {
                    addExport(id, dataItem);
                } else if (id === "module" || id === "plugin") {
                    if (typeof dataItem === "object") {  //nested object
                        for (let nId in dataItem) addExport(`${id}[${nId}]`, dataItem[nId]);
                    } else {  //plain
                        addExport(id, dataItem);
                    }
                } else {
                    console.error("Only 'visualization', 'module' and 'plugin' is allowed top-level object. Not included in export. Used:", id);
                }
            } else if (sets.length > 1) {
                //namespaced in id, backward compatibility
                addExport(`${sets.shift()}[${sets.join('.')}]`, dataItem);
            }
        }

        return `${form}
form.submit();
<\/script>`;
    }

    /**
     * Copy content to the user clipboard
     * @param {string} content
     */
    window.UTILITIES.copyToClipboard = function(content) {
        let $temp = $("<input>");
        $("body").append($temp);
        $temp.val(content).select();
        document.execCommand("copy");
        $temp.remove();
    };

    /**
     * Exports only the viewer direct link (without data) as a URL to the user clipboard
     */
    window.UTILITIES.copyUrlToClipboard = function() {
        let baseUrl = APPLICATION_CONTEXT.getOption("redirectUrl", "");
        if (!baseUrl.match(/^https?:\/\//)) { //protocol required
            baseUrl = APPLICATION_CONTEXT.url + baseUrl;
        }
        const data = UTILITIES.serializeAppConfig();
        UTILITIES.copyToClipboard(baseUrl + "#" + encodeURIComponent(data));
        Dialogs.show($.t('messages.urlCopied'), 4000, Dialogs.MSG_INFO);
    };

    /**
     * Creates the viewport screenshot.
     */
    window.UTILITIES.makeScreenshot = function() {
        // todo OSD v5.0 ensure we can copy the canvas among drawers
        const canvas = document.createElement("canvas"),
            viewportCanvas = VIEWER.drawer.canvas, width = viewportCanvas.width, height = viewportCanvas.height;
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.drawImage(viewportCanvas, 0, 0);
        //todo make this awaiting in OSD v5.0
        VIEWER.raiseEvent('screenshot', {
            context2D: context,
            width: width,
            height: height
        });
        //show result in a new window
        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            URL.revokeObjectURL(url);
        });
    };

    /**
     * Export the viewer as a HTML file that, when opened, loads the session
     * @return {Promise<void>}
     */
    window.UTILITIES.export = async function() {

        let doc = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><title>Visualization export</title></head>
<body><!--Todo errors might fail to be stringified - cyclic structures!-->
<div>Errors (if any): <pre>${console.appTrace.join("")}</pre></div>
${await UTILITIES.getForm()}
</body></html>`;

        UTILITIES.downloadAsFile("export.html", doc);
        APPLICATION_CONTEXT.__cache.dirty = false;
    };

    /**
     * Clone the viewer to a new window, only two windows can be shown at the time.
     * @return {Promise<void>}
     */
    window.UTILITIES.clone = async function() {
        if (window.opener) {
            return;
        }

        let ctx = Dialogs.getModalContext('synchronized-view');
        if (ctx) {
            ctx.window.focus();
            return;
        }
        let x = window.innerWidth / 2, y = window.innerHeight;
        window.resizeTo(x, y);
        Dialogs._showCustomModalImpl('synchronized-view', "Loading...",
            await UTILITIES.getForm(), `width=${x},height=${y}`);
    };

    window.UTILITIES.setDirty = () => APPLICATION_CONTEXT.__cache.dirty = true;

    /**
     * Refresh current page with all plugins and their data if export API used
     * @param formInputHtml additional HTML to add to the refresh FORM
     * @param includedPluginsList of ID's of plugins to include, inludes current active if not specified
     */
    window.UTILITIES.refreshPage = async function(formInputHtml="", includedPluginsList=undefined) {
        if (APPLICATION_CONTEXT.__cache.dirty) {
            Dialogs.show($.t('messages.warnPageReload', {
                onExport: "UTILITIES.export();",
                onRefresh: "APPLICATION_CONTEXT.__cache.dirty = false; UTILITIES.refreshPage();"
            }), 15000, Dialogs.MSG_WARN);
            return;
        }

        // if (window.removeEventListener) {
        //     window.removeEventListener('beforeunload', preventDirtyClose, true);
        // } else if (window.detachEvent) {
        //     window.detachEvent('onbeforeunload', preventDirtyClose);
        // }
        $(document.body).append(await UTILITIES.getForm(formInputHtml, includedPluginsList, true));
    };

    /**
     * Download string as file
     * @param {string} filename filename
     * @param {string} content file content
     */
    window.UTILITIES.downloadAsFile = function(filename, content) {
        let data = new Blob([content], { type: 'text/plain' });
        let downloadURL = window.URL.createObjectURL(data);
        let elem = document.getElementById('link-download-helper');
        elem.href = downloadURL;
        elem.setAttribute('download', filename);
        elem.click();
        URL.revokeObjectURL(downloadURL);
    };

    /**
     * File input text data loader
     * @param onUploaded function to handle the result
     * @param accept file types to accept, e.g. "image/png, image/jpeg"
     *  see https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/file#unique_file_type_specifiers
     * @param mode {("text"|"bytes")} in what mode to read the data; text results in string, bytes in array buffer
     * @returns {Promise<void>}
     */
    window.UTILITIES.uploadFile = async function(onUploaded, accept=".json", mode="text") {
        const uploader = $("#file-upload-helper");
        uploader.attr('accept', accept);
        uploader.on('change', () => {
            UTILITIES.readFileUploadEvent(event, mode).then(onUploaded).catch(onUploaded);
            uploader.val('');
            uploader.off('change');
        });
        uploader.trigger("click");
    }

    /**
     * File input text data loader handler, meant to be attached to input[type=file] onchange event
     * @param e event fired on an input (single) type file submit,
     * @param mode {("text"|"bytes"|"url")} in what mode to read the data; text results in string, bytes in array buffer, url in the file path.
     * @returns {Promise<void>}
     */
    window.UTILITIES.readFileUploadEvent = function(e, mode="text") {
        return new Promise((resolve, reject) => {
            let file = e.target.files[0];
            if (!file) return reject("Invalid input file: no file.");
            let fileReader = new FileReader();
            fileReader.onload = e => resolve(e.target.result);
            if (mode === "text") fileReader.readAsText(file);
            else if (mode === "bytes") fileReader.readAsArrayBuffer(file);
            else throw "Invalid read file mode " + mode;
        });
    };

    //TODO: make this a normal standard UI api (open / focus / inline)
    window.UTILITIES.openDebuggingWindow = function (html = '') {
        let ctx = Dialogs.getModalContext('__xopat__debug__window__');
        if (ctx) {
            ctx.window.focus();
            return ctx.window;
        }

        //TODO ... VIEWER.drawer.showDebugging
        Dialogs.showCustomModal('__xopat__debug__window__', 'Debugging Window', 'Debugging Window', html);
        const window = Dialogs.getModalContext('__xopat__debug__window__')?.window;
        if (!window) {
            return null;
        }

        return window;
    };

    $("body")
        .append("<a id='link-download-helper' class='d-none'></a>")
        .parent().append("<input id='file-upload-helper' type='file' style='visibility: hidden !important; width: 1px; height: 1px'/>");

    UTILITIES.updateTheme();

    //TODO: implementation of observing mouse position and pixel values: move to correct scripts (e.g. scalebar)
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

        /**
         * @param screen
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
                if (!tiledImage) {
                    //some error since we are missing the tiled image
                    return undefined;
                }
            }
            let tile;
            tile = changeTile();
            if (!tile) return undefined;

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

}
