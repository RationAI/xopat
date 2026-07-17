/**
 * Client-side parsing of the viewer session configuration
 * @param {object} postData post data available to the viewer if any
 * @param i18n i18next translation context
 * @param supportsPost whether the server implementation supports post data
 * @returns {*|{error}}
 */
function xOpatParseConfiguration(postData, i18n, supportsPost) {
    function ensureDefined(object, property, defaultValue) {
        if (!object.hasOwnProperty(property)) {
            object[property] = defaultValue;
            return false;
        }
        return true;
    }

    function _parse(configuration) {
        function isBoolFlagInObject(object, key) {
            const ref = object ? object[key] : undefined;
            if (ref === undefined || ref === null) return false;
            if (typeof ref === "string") return ref !== "" && ref !== "false";
            return !!ref;
        }

        function getError(title, description, details) {
            return {error: title, description: description, details: details};
        }

        if (!configuration) {
            return null;
        }

        if (typeof configuration === "string") {
            try {
                configuration = JSON.parse(configuration);
            } catch (e) {
                return getError(  "messages.urlInvalid", "messages.postDataSyntaxErr",
                    ` "JSON Error: ${e}<br>`
                    + JSON.stringify(configuration.data));
            }
        }

        ensureDefined(configuration, "params", {});
        ensureDefined(configuration, "data", []);
        let definedRendering = ensureDefined(configuration, "background", []);
        ensureDefined(configuration, "plugins", {});

        const isDebug = isBoolFlagInObject(configuration.params, "debugMode");
        const bypassCookies = isBoolFlagInObject(configuration.params, "bypassCookies");

        // `bg.dataReference` permits three shapes, matching the ambient
        // type at src/types/app.d.ts (DataReference = number | DataID |
        // DataOverride) and what BackgroundConfig.from() already accepts:
        //   - integer  → index into configuration.data (legacy)
        //   - string   → inline DataID (URL/path carried on the bg entry)
        //   - object   → DataOverride {dataID, protocol, options, …} as used
        //                by the DICOM plugin and any future factory protocol
        // The old strict `Number.isInteger` gate rejected the DataOverride
        // form, so exporting a DICOM-backed session and reloading it always
        // landed on "no slide opened" — fixed here.
        function isValidDataReference(ref, dataLen) {
            if (Number.isInteger(ref)) return ref >= 0 && ref < dataLen;
            if (typeof ref === "string" && ref) return true;
            if (ref && typeof ref === "object") {
                if (ref.dataID !== undefined) return true;
                return Object.keys(ref).length > 0;
            }
            return false;
        }
        for (let bg of configuration.background) {
            if (!bg || !isValidDataReference(bg.dataReference, configuration.data.length)) {
                return getError("messages.urlInvalid", "messages.bgReferenceMissing",
                    `Invalid data reference '${JSON.stringify(bg?.dataReference)}'. Available data: `
                    + JSON.stringify(configuration.data));
            }
        }

        const singleBgImage = configuration.background.length === 1;
        const firstTimeVisited = false; //todo support this?

        if (configuration.visualizations) {
            //requires webgl module
            definedRendering = true;
        }

        if (!definedRendering) {
            return getError("error.nothingToRender",
                "error.nothingToRenderDescription",
                "Empty background and visualization configuration.");
        }
        return configuration;
    }

    let session;
    try {
        const url = new URL(window.location.href);

        // First priority has post (or other) data given
        let data = postData["visualization"] || postData["visualisation"];
        session = _parse(data);

        // In case we could not retrieve the session from data, we try URL
        if (!session || session.error) {
            const fromHash = !!url.hash;
            const urlData = fromHash
                ? decodeURIComponent(url.hash.substring(1))
                : url.searchParams.get("visualization");

            if (urlData) {
                data = urlData;
                // If it’s already in the hash, parse locally so refresh/share stays stable.
                if (supportsPost && !fromHash) {
                    // existing POST redirect logic (unchanged)
                    const form = document.createElement("form");
                    form.method = "POST";
                    const node = document.createElement("input");
                    node.name = "visualization";
                    node.value = data;
                    form.appendChild(node);
                    form.style.visibility = 'hidden';
                    document.body.appendChild(form);

                    url.hash = "";
                    form.action = String(url);
                    form.submit();
                } else {
                    session = _parse(data);
                }
            }
            // Some proxies (e.g. JupyterHub's configurable-http-proxy) re-encode
            // query strings, so a singly-encoded `?visualization=%7B...` arrives
            // doubly-encoded and URLSearchParams.get() only undoes one layer.
            // If parsing failed and the payload still looks URL-encoded, retry.
            if (session && session.error && typeof data === "string" && /%[0-9A-Fa-f]{2}/.test(data)) {
                try {
                    const retried = _parse(decodeURIComponent(data));
                    if (retried && !retried.error) session = retried;
                } catch { /* keep original error */ }
            }
        }

        // Try parsing slides & visualization GET params
        if (!session) {
            const handMadeConfiguration = {
                data: []
            };

            const slide = url.searchParams.get("slides");
            let processed = false;
            if (slide) {
                const slideList = slide.split(",");
                handMadeConfiguration.data = slideList;
                handMadeConfiguration.background = slideList.map((slide, index) => {
                    return {
                        dataReference: index,
                    }
                });
                processed = true;
            }
            let masks = url.searchParams.get("masks");
            if (masks) {
                masks = masks.split(',');
                const visConfig = {
                    name: "Masks",
                    shaders: {}
                };
                handMadeConfiguration.visualizations = [visConfig];

                let index = 1;
                for (let mask of masks) {
                    handMadeConfiguration.data.push(mask);
                    visConfig.shaders[mask] = {
                        type: "heatmap",
                        fixed: false,
                        visible: 1,
                        dataReferences: [index++],
                        params: { }
                    }
                }
                processed = true;
            }

            if (processed) {
                session = _parse(handMadeConfiguration);
            }
        }

        // Session-cache scoping + middleware note. This is a BOOT-TIME
        // bootstrap cache and deliberately uses raw localStorage: the cache
        // middleware (XOpatStorage / IO_PIPELINE kv:cache) is constructed
        // later in src/app.ts, so no kv driver can serve this read — admin
        // driver re-binding intentionally does not affect this restore path.
        // The cache is scoped to the deployment identity: origins (localhost
        // especially) are shared across deployments, and a stale session from
        // a different env config must not replay here — its data references
        // may be unresolvable under this deployment's slide protocols.
        const envKey = `${window.ENV?.client?.domain || ""}|${window.ENV?.client?.path || ""}|${window.ENV?.name || window.ENV?.core?.name || ""}`;
        // Mirror of the middleware's `bypassCache` semantics (store.ts) at the
        // one point where the middleware flag cannot be consulted.
        const bypassSessionCache = window.ENV?.setup?.bypassCache === true;
        const cacheMatchesEnv = (data) =>
            data && (data.__envKey === undefined || data.__envKey === envKey);

        if (!session) {
            // Try to restore past state
            if (!bypassSessionCache) {
                let strData = window.localStorage.getItem("xoSessionCache");
                if (strData && strData !== "undefined") {
                    const data = JSON.parse(strData);
                    // consider the session alive for at most 30 minutes
                    const viz = data.visualization;
                    if (cacheMatchesEnv(data) && viz && viz.__age && Date.now() - viz.__age < 1800e3) {
                        postData = data; // override post
                        delete viz.__age;
                        session = _parse(viz);
                        session.__fromLocalStorage = true;
                    }
                } else {
                    strData = window.sessionStorage.getItem("xoSessionCache");
                    const data = strData && strData !== "undefined" && JSON.parse(strData);
                    if (cacheMatchesEnv(data) && data.visualization) {
                        postData = data;
                        session = _parse(data.visualization);
                        session.__fromLocalStorage = true;
                    }
                }
            }
        } else if (!session.error && !bypassSessionCache) {
            // Save current state (including post) in case we loose it and need to restore it (e.g. auth redirect)
            const data = postData || {};
            session.__age = Date.now();
            data.visualization = session;
            data.__envKey = envKey;

            const sessionData = JSON.stringify(data);
            // Local Storage is meant for 'last session', available accross windows, session storage is to prevent
            // losing context at any cost
            window.localStorage.setItem("xoSessionCache", sessionData);
            window.sessionStorage.setItem("xoSessionCache", sessionData);
        }

        // Todo this will make the viewer to not show any error - handled by the default screen... any better solution?
        if (!session) {
            session = {};
        }

        // Needs to be solo condition, the above could create the session object
        if (session.error) {
            session.error = i18n.t(session.error);
            if (session.description) session.description = i18n.t(session.description);
        }
    } catch (e) {
        postData = postData || {};
        session = {error: e};
    }

    //especially page with error 'error.nothingToRender'
    ensureDefined(session, "params", {});
    ensureDefined(session, "data", []);
    ensureDefined(session, "background", []);
    ensureDefined(session, "plugins", {});
    postData.visualization = session;
    return postData;
}
