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

        for (let bg of configuration.background) {
            if (!bg || !Number.isInteger(bg.dataReference)
                || bg.dataReference < 0
                || bg.dataReference > configuration.data.length) {
                return getError(  "messages.urlInvalid", "messages.bgReferenceMissing",
                    `Invalid data reference value '${bg.dataReference}'. Available data: `
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
        session = _parse(postData["visualization"] || postData["visualisation"]);

        // In case we could not retrieve the session from data, we try URL
        if (!session || session.error) {
            const data = url.hash ? decodeURIComponent(url.hash.substring(1)) : //remove '#'
                url.searchParams.get("visualization");
            if (data) {
                // Prefer redirect due to server-side logics
                if (supportsPost) {
                    //Try parsing url for serialized config in the headers and redirect
                    const form = document.createElement("form");
                    form.method = "POST";
                    const node = document.createElement("input");
                    node.name = "visualization";
                    node.value = data;
                    form.appendChild(node);
                    form.style.visibility = 'hidden';
                    document.body.appendChild(form);
                    // prevents recursion
                    url.hash = "";
                    form.action = String(url);
                    form.submit();

                    //todo return?
                } else {
                    session = _parse(data);
                }
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

        if (!session) {
            // Try to restore past state
            let strData = window.localStorage.getItem("xoSessionCache");
            if (strData && strData !== "undefined") {
                const data = JSON.parse(strData);
                // consider the session alive for at most 30 minutes
                const viz = data.visualization;
                if (viz && viz.__age && Date.now() - viz.__age < 1800e3) {
                    postData = data; // override post
                    delete viz.__age;
                    session = _parse(viz);
                    session.__fromLocalStorage = true;
                }
            } else {
                strData = window.sessionStorage.getItem("xoSessionCache");
                const data = strData && strData !== "undefined" && JSON.parse(strData);
                if (data) {
                    postData = data;
                    session = data.visualization && _parse(data.visualization);
                    session.__fromLocalStorage = true;
                }
            }
        } else if (!session.error) {
            // Save current state (including post) in case we loose it and need to restore it (e.g. auth redirect)
            const data = postData || {};
            session.__age = Date.now();
            data.visualization = session;

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
