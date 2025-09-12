/**
 * Initialize xOpat viewer page-level scripts and wire global UTILITIES helpers.
 * Sets up keyboard focus forwarding to OpenSeadragon, error handling, and
 * exposes various helper functions on window.UTILITIES.
 * This function must be called after VIEWER and APPLICATION_CONTEXT are initialized.
 * @returns {void}
 */
function initXopatScripts() {
    $.extend($.scrollTo.defaults, {axis: 'y'});

    $(VIEWER.element).on('contextmenu', function(event) {
        event.preventDefault();
    });

    /**
     * Replace share button in static preview mode
     */
    if (APPLICATION_CONTEXT.getOption("isStaticPreview")) {
        const shareBtn = document.getElementById("copy-url");
        const staticDisclaimer = document.getElementById("static-file-disclaimer");

        shareBtn.style.display = "none";
        staticDisclaimer.style.display = "grid";
    }

    let failCount = new WeakMap();
    VIEWER_MANAGER.broadcastHandler('tile-load-failed', function(e) {
        if (e.message === "Image load aborted") return;
        let index = e.eventSource.world.getIndexOfItem(e.tiledImage);
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
                e.eventSource.raiseEvent('tiled-image-problematic', e);
            }
        }
        e.tiledImage._failedDate = e.time;
    });

    // let _lastScroll = Date.now(), _scrollCount = 0, _currentScroll;
    // /**
    //  * From https://github.com/openseadragon/openseadragon/issues/1690
    //  * brings better zooming behaviour
    //  */
    // window.VIEWER.addHandler("canvas-scroll", function(e) {
    //     if (Math.abs(e.originalEvent.deltaY) < 100) {
    //         // touchpad has lesser values, do not change scroll behavior for touchpads
    //         VIEWER.zoomPerScroll = 0.5;
    //         _scrollCount = 0;
    //         return;
    //     }
    //
    //     _currentScroll = Date.now();
    //     if (_currentScroll - _lastScroll < 400) {
    //         _scrollCount++;
    //     } else {
    //         _scrollCount = 0;
    //         VIEWER.zoomPerScroll = 1.2;
    //     }
    //
    //     if (_scrollCount > 2 && VIEWER.zoomPerScroll <= 2.5) {
    //         VIEWER.zoomPerScroll += 0.2;
    //     }
    //     _lastScroll = _currentScroll;
    // });

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
                USER_INTERFACE.Tutorials.hide();
                USER_INTERFACE.DropDown.hide();
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
     * Get the date as ISO string (DD/MM/YYYY by default).
     * @param {string} [separator="/"] - Separator between date parts.
     * @returns {string}
     */
    window.UTILITIES.todayISO = function(separator="/") {
        return new Date().toJSON().slice(0,10).split('-').reverse().join(separator);
    };

    /**
     * Get the current date in ISO order (YYYY/MM/DD by default).
     * @param {string} [separator="/"] - Separator between date parts.
     * @returns {string}
     */
    window.UTILITIES.todayISOReversed = function(separator="/") {
        return new Date().toJSON().slice(0,10).split('-').join(separator);
    };

    /**
     * Safely coerce various JSON-like values into a boolean.
     * Treats strings as true unless they equal "false" (case-insensitive) or are empty.
     * Numbers are coerced by JavaScript truthiness, undefined falls back to defaultValue.
     * @param {any} value - Value to evaluate.
     * @param {boolean} [defaultValue=false] - Default used when value is undefined.
     * @returns {boolean}
     */
    window.UTILITIES.isJSONBoolean = function(value, defaultValue) {
        return (defaultValue && value === undefined) || (value && (typeof value !== "string" || value.trim().toLocaleLowerCase() !== "false"));
    };

    /**
     * Convert a function into a throttled version that executes at most once per delay ms.
     * Usage:
     *   const throttled = UTILITIES.makeThrottled(fn, 60);
     *   throttled.finish(); // flush pending call immediately
     * @param {Function} callback - Function to throttle.
     * @param {number} delay - Throttling interval in milliseconds.
     * @returns {Function} Throttled function with an extra method finish():void to flush the last pending call.
     */
    window.UTILITIES.makeThrottled = function (callback, delay) {
        let lastCallTime = 0;
        let timeoutId = null;
        let pendingArgs = null;

        const invoke = () => {
            timeoutId = null;
            lastCallTime = Date.now();
            if (pendingArgs) {
                callback(...pendingArgs);
                pendingArgs = null;
            }
        };

        const wrapper = (...args) => {
            const now = Date.now();

            if (!lastCallTime || now - lastCallTime >= delay) {
                // Execute immediately if outside the throttling window
                lastCallTime = now;
                callback(...args);
            } else {
                // Skip this call but store arguments for the next possible execution
                pendingArgs = args;

                if (!timeoutId) {
                    timeoutId = setTimeout(invoke, delay - (now - lastCallTime));
                }
            }
        };

        wrapper.finish = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                invoke();
            }
        };

        return wrapper;
    }

    /**
     * Sleep for a given number of milliseconds.
     * @param {number} [ms] - Milliseconds to wait.
     * @returns {Promise<void>}
     */
    window.UTILITIES.sleep = async function(ms=undefined) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Set the App theme
     * @param {?string} theme primer_css theme
     */
    window.UTILITIES.updateTheme = USER_INTERFACE.Tools.changeTheme;

    /**
     * Create a serialized viewer configuration JSON string for export or sharing.
     * @param {boolean} [withCookies=false] - Include cookies in the params.
     * @param {boolean} [staticPreview=false] - Produce a static preview configuration.
     * @returns {string} JSON string representing the current application configuration.
     */
    window.UTILITIES.serializeAppConfig = function(withCookies=false, staticPreview = false) {
        //TODO consider bypassCache etc...

        //delete unnecessary data, copy params so that overrides do not affect current session
        const data = {...APPLICATION_CONTEXT.config};
        data.params = {...APPLICATION_CONTEXT.config.params};
        delete data.defaultParams;

        if (staticPreview) data.params.isStaticPreview = true;
        if (!withCookies) data.params.bypassCookies = true;
        data.params.bypassCacheLoadTime = true;
        data.params.viewport = {
            zoomLevel: VIEWER.viewport.getZoom(),
            point: VIEWER.viewport.getCenter()
        };

        //by default omit underscore
        return JSON.stringify(data, OpenSeadragon.FlexRenderer.jsonReplacer);
    };

    /**
     * Get an auto-submitting HTML form+script that redirects to the viewer with current session data.
     * @param {string} [customAttributes=""] - Extra raw HTML attributes or inputs to include in the form.
     * @param {string[]|undefined} [includedPluginsList] - Plugin IDs to include; defaults to current active set.
     * @param {boolean} [withCookies=false] - Include cookies in export payload.
     * @returns {Promise<string>} HTML snippet to embed or open.
     */
    window.UTILITIES.getForm = async function(customAttributes="", includedPluginsList=undefined, withCookies=false) {
        const url = (APPLICATION_CONTEXT.url.startsWith('http') ? "" : "http://") + APPLICATION_CONTEXT.url;

        if (! APPLICATION_CONTEXT.env.serverStatus.supportsPost) {
            return `
    <form method="POST" id="redirect" action="${url}#${encodeURI(UTILITIES.serializeAppConfig(withCookies, true))}">
        <input type="hidden" id="visualization" name="visualization">
        ${customAttributes}
        <input type="submit" value="">
        </form>
    <script type="text/javascript">const form = document.getElementById("redirect").submit();<\/script>`;
        }

        const {app, data} = await window.UTILITIES.serializeApp(includedPluginsList, withCookies, true);
        data.visualization = app;

        let form = `
    <form method="POST" id="redirect" action="${url}">
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
     * Copy content to the user clipboard.
     * @param {string} content - String to copy.
     * @param {boolean} [alert=true] - Show a toast notification after copy.
     * @returns {void}
     */
    window.UTILITIES.copyToClipboard = function(content, alert=true) {
        let $temp = $("<input>");
        $("body").append($temp);
        $temp.val(content).select();
        document.execCommand("copy");
        $temp.remove();
        if (alert) Dialogs.show($.t('messages.valueCopied'), 3000, Dialogs.MSG_INFO);
    };

    /**
     * Export only the viewer direct link (without data) to the clipboard.
     * @returns {void}
     */
    window.UTILITIES.copyUrlToClipboard = function() {
        let baseUrl = APPLICATION_CONTEXT.getOption("redirectUrl", "");
        if (!baseUrl.match(/^https?:\/\//)) { //protocol required
            baseUrl = APPLICATION_CONTEXT.url + baseUrl;
        }
        const data = UTILITIES.serializeAppConfig();
        UTILITIES.copyToClipboard(baseUrl + "#" + encodeURIComponent(data));
    };

    /**
     * Create a screenshot of the current viewer viewport and open it in a new tab.
     * @returns {void}
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
     * Export the current viewer session as a self-contained HTML file.
     * When opened, it automatically loads the saved session.
     * @returns {Promise<void>}
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
     * Refresh the page and reload the viewer, optionally limiting which plugins are included.
     * @param {string[]|undefined} [includedPluginsList] - IDs of plugins to include; current active if omitted.
     * @returns {Promise<void>}
     */
    window.UTILITIES.refreshPage = async function(includedPluginsList=undefined) {
        if (APPLICATION_CONTEXT.__cache.dirty) {
            Dialogs.show($.t('messages.warnPageReload', {
                onExport: "UTILITIES.export();",
                onRefresh: "APPLICATION_CONTEXT.__cache.dirty = false; UTILITIES.refreshPage();"
            }), 15000, Dialogs.MSG_WARN);
            return;
        }

        if (!UTILITIES.storePageState(includedPluginsList)) {
            Dialogs.show($.t('messages.warnPageReloadFailed'), 4000, Dialogs.MSG_WARN);
            USER_INTERFACE.Loading.show(true);
            await UTILITIES.sleep(3800);
        }
        window.location.replace(APPLICATION_CONTEXT.url);
    };

    /**
     * Download a string as a file via a temporary link element.
     * @param {string} filename - Target file name.
     * @param {string} content - File content.
     * @returns {void}
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
     * Open a file picker and read the selected file, then call the provided callback with the result.
     * @param {(result: string|ArrayBuffer) => void} onUploaded - Callback invoked with file contents or rejected error.
     * @param {string} [accept=".json"] - Accept attribute (e.g., "image/png, image/jpeg").
     *   See https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/file#unique_file_type_specifiers
     * @param {("text"|"bytes")} [mode="text"] - Read as text or as ArrayBuffer.
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
     * Handle an input[type=file] change event and read the selected file.
     * @param {Event} e - Change event from a file input.
     * @param {("text"|"bytes")} [mode="text"] - Read as text or as ArrayBuffer.
     * @returns {Promise<string|ArrayBuffer>} Resolves with file contents.
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
    /**
     * Open or focus a simple debugging window rendered via Dialogs.
     * @param {string} [html=""] - Optional HTML content to insert.
     * @returns {Window|null} Window object of the debugging modal, or null if failed.
     */
    window.UTILITIES.openDebuggingWindow = function (html = '') {
        let ctx = Dialogs.getModalContext('__xopat__debug__window__');
        if (ctx) {
            ctx.window.focus();
            return ctx.window;
        }

        Dialogs.showCustomModal('__xopat__debug__window__', 'Debugging Window', 'Debugging Window', html);
        const window = Dialogs.getModalContext('__xopat__debug__window__')?.window;
        if (!window) {
            return null;
        }

        return window;
    };

    $("body")
        .append("<a id='link-download-helper' class='hidden'></a>")
        .parent().append("<input id='file-upload-helper' type='file' style='visibility: hidden !important; width: 1px; height: 1px'/>");

    UTILITIES.updateTheme();
}
