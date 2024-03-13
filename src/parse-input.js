/**
 * Client-side parsing of the viewer session configuration
 * @param {object} postData post data available to the viewer if any
 * @param i18n i18next translation context
 * @returns {*|{error}}
 */
function xOpatParseConfiguration(postData, i18n) {
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

        //old data key was 'visualisation' todo consider 'session' as name instead
        session = _parse(postData["visualization"] || postData["visualisation"]);
        if (!session || session.error) {
            const data = url.hash ? decodeURIComponent(url.hash.substring(1)) : //remove '#'
                url.searchParams.get("visualization");
            if (data) {
                session = _parse(data);
            }
        }


        if (!session) {
            const slide = url.searchParams.get("slide");
            if (slide) {
                //try building the object from scratch
                const handMadeConfiguration = {
                    data: [url.searchParams.get("slide")],
                    background: [{
                        dataReference: 0,
                        lossless: false,
                    }]
                };
                let masks = url.searchParams.get("masks");
                if (masks) {
                    masks = masks.split(',');
                    const visConfig = {
                        name: "Masks",
                        lossless: true,
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
                }
                session = _parse(handMadeConfiguration);
            } else {
                session = {};
            }
        }

        if (session.error) {
            session.error = i18n.t(session.error);
            if (session.description) session.description = i18n.t(session.description);
        }
    } catch (e) {
        //todo error
        session = {error: e};
    }

    //todo show error page if plausible
    //especially page with error 'error.nothingToRender'
    ensureDefined(session, "params", {});
    ensureDefined(session, "data", []);
    ensureDefined(session, "background", []);
    ensureDefined(session, "plugins", {});
    return session;
}
