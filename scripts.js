(function (window) {

    //https://github.com/mrdoob/stats.js
    if (APPLICATION_CONTEXT.getOption("debugMode")) {
        (function(){var script=document.createElement('script');script.onload=function(){var stats=new Stats();document.body.appendChild(stats.dom);stats.showPanel(1);requestAnimationFrame(function loop(){stats.update();requestAnimationFrame(loop)});};script.src='external/stats.js';document.head.appendChild(script);})()
    }

    // opacity of general layer available everywhere
    $("#global-opacity").on("input", function () {
        let val = $(this).val();
        VIEWER.world.getItemAt(VIEWER.bridge.getWorldIndex()).setOpacity(val);
    });

    $(VIEWER.element).on('contextmenu', function (event) {
        event.preventDefault();
    });

    /**
     * Focusing all key press events and forwarding to OSD
     * attaching `focusCanvas` flag to recognize if key pressed while OSD on focus
     */
    let focusOnViewer = true;
    VIEWER.addHandler('canvas-enter', function () {
        focusOnViewer = true;
    });
    VIEWER.addHandler('canvas-exit', function () {
        focusOnViewer = false;
    });
    document.addEventListener('keydown', function (e) {
        e.focusCanvas = focusOnViewer;
        VIEWER.raiseEvent('key-down', e);
    });
    document.addEventListener('keyup', function (e) {
        e.focusCanvas = focusOnViewer;
        VIEWER.raiseEvent('key-up', e);
    });

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

    window.VIEWER.addHandler('navigator-scroll', function (e) {
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

        //todo article!!! also acceleration!
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

    /*---------------------------------------------------------*/
    /*------------ EXPORTING ----------------------------------*/
    /*---------------------------------------------------------*/

    function constructExportVisualisationForm(customAttributes="", includedPluginsList=undefined, withCookies=false) {
        //reconstruct active plugins
        let pluginsData = APPLICATION_CONTEXT.setup.plugins;
        let plugins = PLUGINS;
        let includeEvaluator = includedPluginsList ?
            p => includedPluginsList.includes(p) :
            p => plugins[p].loaded;

        for (let plugin in plugins) {
            if (!plugins.hasOwnProperty(plugin)) continue;
            if (!includeEvaluator(plugin)) {
                delete pluginsData[plugin];
            } else if (!pluginsData.hasOwnProperty(plugin)) {
                pluginsData[plugin] = {};
            }
        }

        let bypass = APPLICATION_CONTEXT.setup.params.bypassCookies;
        if (!withCookies) APPLICATION_CONTEXT.setup.params.bypassCookies = true;

        let exported = APPLICATION_CONTEXT.layersAvailable && VIEWER.bridge
            ? JSON.stringify(APPLICATION_CONTEXT.setup, VIEWER.bridge.webGLEngine.jsonReplacer)
            : JSON.stringify(APPLICATION_CONTEXT.setup);

        let form = `
      <form method="POST" id="redirect" action="${APPLICATION_CONTEXT.url}">
        <input type="hidden" id="visualisation" name="visualisation">
        ${customAttributes}
        <input type="submit" value="">
      </form>
      <script type="text/javascript">
        document.getElementById("visualisation").value = \`${exported}\`;
        var form = document.getElementById("redirect");
        var node;`;

        APPLICATION_CONTEXT.setup.params.bypassCookies = bypass;

        for (let i = 0; i < UTILITIES._exportHandlers.length; i++) {
            let toExport = UTILITIES._exportHandlers[i];
            if (toExport) {
                let value = toExport.call();
                form += `node = document.createElement("input");
node.setAttribute("type", "hidden");
node.setAttribute("name", \`${toExport.name}\`);
node.setAttribute("value", \`${value}\`);
form.appendChild(node);`;
            }
        }

        return `${form}
form.submit();<\/script>`;
    }


    //Attempt to prevent re-submit, but now it fires two messages - POST resubmit and content..
    // function preventDirtyClose(e) {
    //     e.preventDefault();
    //     if (APPLICATION_CONTEXT.setup.dirty) return "You will lose your workspace if you leave now: are you sure?";
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


    window.UTILITIES = {
        fetchJSON: async function(url, postData=null, headers={}) {
            let method = postData ? "POST" : "GET";
            $.extend(headers, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            const response = await fetch(url, {
                method: method,
                mode: 'cors',
                cache: 'no-cache',
                credentials: 'same-origin',
                headers: headers,
                body: postData ? JSON.stringify(postData) : null
            });

            if (response.status < 200 || response.status > 299) {
                return response.text().then(text => {
                    throw new HTTPError(`Server returned ${response.status}: ${text}`, response);
                });
            }
            return response.json();
        },

        updateTheme: function() {
            let theme = APPLICATION_CONTEXT.getOption("theme");
            if (!["dark", "dark_dimmed", "light", "auto"].some(t => t === theme)) theme = APPLICATION_CONTEXT.defaultParams.theme;
            if (theme === "dark_dimmed") {
                document.documentElement.dataset['darkTheme'] = "dark_dimmed";
                document.documentElement.dataset['colorMode'] = "dark";
            } else {
                document.documentElement.dataset['darkTheme'] = "dark";
                document.documentElement.dataset['colorMode'] = theme;
            }
        },

        getUserMeta: function() {
            return {
                appCodeName: navigator["appCodeName"],
                appName: navigator["appName"],
                appMinorVersion: navigator["appMinorVersion"],
                platform: navigator["platform"],
                appVersion: navigator["appVersion"],
                userAgent: navigator["userAgent"],
                cookieEnabled: navigator["cookieEnabled"]
            }
        },

        getForm: constructExportVisualisationForm,

        copyUrlToClipboard: function () {
            let baseUrl = APPLICATION_CONTEXT.rootPath + "/redirect.php#";

            let oldViewport = APPLICATION_CONTEXT.setup.params.viewport;
            APPLICATION_CONTEXT.setup.params.viewport = {
                zoomLevel: VIEWER.viewport.getZoom(),
                point: VIEWER.viewport.getCenter()
            };

            let bypass = APPLICATION_CONTEXT.setup.params.bypassCookies;
            APPLICATION_CONTEXT.setup.params.bypassCookies = true;

            let postData = APPLICATION_CONTEXT.layersAvailable && VIEWER.bridge
                ? JSON.stringify(APPLICATION_CONTEXT.setup, VIEWER.bridge.webGLEngine.jsonReplacer)
                : JSON.stringify(APPLICATION_CONTEXT.setup);

            APPLICATION_CONTEXT.setup.params.viewport = oldViewport;
            APPLICATION_CONTEXT.setup.params.bypassCookies = bypass;

            let $temp = $("<input>");
            $("body").append($temp);
            $temp.val(baseUrl + encodeURIComponent(postData)).select();
            document.execCommand("copy");
            $temp.remove();
            Dialogs.show("The URL was copied to your clipboard.", 4000, Dialogs.MSG_INFO);
        },

        export: function () {
            let oldViewport = APPLICATION_CONTEXT.setup.params.viewport;
            APPLICATION_CONTEXT.setup.params.viewport = {
                zoomLevel: VIEWER.viewport.getZoom(),
                point: VIEWER.viewport.getCenter()
            };
            let doc = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><title>Visualisation export</title></head>
<body>
<div>Errors (if any): <pre>${JSON.stringify(console.savedLogs)}</pre></div>
${constructExportVisualisationForm()}
</body></html>`;
            APPLICATION_CONTEXT.setup.params.viewport = oldViewport;
            let output = new Blob([doc], { type: 'text/html' });
            let downloadURL = window.URL.createObjectURL(output);
            var downloader = document.getElementById("export-visualisation");
            downloader.href = downloadURL;
            downloader.download = "export.html";
            downloader.click();
            URL.revokeObjectURL(downloadURL);
            APPLICATION_CONTEXT.setup.dirty = false;
        },

        clone: function () {
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
                constructExportVisualisationForm(), `width=${x},height=${y}`);
        },

        setDirty: () => {APPLICATION_CONTEXT.setup.dirty = true;},

        _exportHandlers: [],
        addPostExport: function(name, valueHandler, pluginId) {
            this._exportHandlers.push({name: name, call: valueHandler, pluginId: pluginId});
        },

        /**
         * Refresh current page with all plugins and their data if export API used
         * @param formData additional HTML to add to the refresh FORM
         * @param includedPluginsList of ID's of plugins to include, inludes current active if not specified
         */
        refreshPage: function(formData="", includedPluginsList=undefined) {
            if (APPLICATION_CONTEXT.setup.dirty) {
                Dialogs.show(`It seems you've made some work already. It might be wise to <a onclick="UTILITIES.export();" class='btn-pointer'>export</a> your setup first. <a onclick="APPLICATION_CONTEXT.setup.dirty = false; UTILITIES.refreshPage();" class='btn-pointer'>Reload now.</a>.`,
                    15000, Dialogs.MSG_WARN);
                return;
            }

            // if (window.removeEventListener) {
            //     window.removeEventListener('beforeunload', preventDirtyClose, true);
            // } else if (window.detachEvent) {
            //     window.detachEvent('onbeforeunload', preventDirtyClose);
            // }
            $("body").append(UTILITIES.getForm(formData, includedPluginsList, true));
        }
    };

    UTILITIES.updateTheme();
})(window);
