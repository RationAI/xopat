/**
 * Client-side parsing queries.
 */
function xOpatParseConfiguration(i18n) {

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

        function ensureDefined(object, property, defaultValue) {
            if (!object.hasOwnProperty(property)) {
                object[property] = defaultValue;
                return false;
            }
            return true;
        }

        if (!configuration) {
            return getError("messages.urlInvalid", "messages.invalidPostData",
                JSON.stringify(configuration));
        }


        ensureDefined(configuration, "params", {});
        ensureDefined(configuration, "data", []);
        let definedRendering = ensureDefined(configuration, "background", {});
        ensureDefined(configuration, "plugins", {});

        const isDebug = isBoolFlagInObject(configuration.params, "debugMode");
        const bypassCookies = isBoolFlagInObject(configuration.params, "bypassCookies");

        for (let bg of configuration.background) {
            if (!bg || !bg.dataReference) {
                return getError("messages.urlInvalid", "messages.bgReferenceMissing",
                    JSON.stringify(bg));
            }

            if (!Number.isInteger(bg.dataReference)
                || bg.dataReference < 0
                || bg.dataReference > configuration.data.length) {
                return getError(  "messages.urlInvalid", "messages.bgReferenceMissing",
                    "Invalid data reference value '$bg->dataReference'. Available data: "
                    + JSON.stringify(configuration.data));
            }
        }

        const singleBgImage = configuration.background.length === 1;
        const firstTimeVisited = false; //todo support this?

        if (configuration.visualizations) {
            //requires webgl module
            definedRendering = true;

        }

        //todo better way of handling these, some default promo page? fractal? :D
        if (!definedRendering) {
            return getError("error.nothingToRender",
                "error.nothingToRenderDescription",
                "Empty background and visualization configuration.");
        }
    }

    let visualization;
    try {
        const url = new URL(window.location.href);
        visualization = _parse(
            url.hash ? decodeURIComponent(url.hash.substring(1)) : //remove '#'
                JSON.parse(url.searchParams.get("visualization"))
        );

        if (!visualization) {
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
                    data.push(mask);
                    visConfig.shaders[mask] = {
                        type: "heatmap",
                        fixed: false,
                        visible: 1,
                        dataReferences: [index++],
                        params: { }
                    }
                }
            }
            visualization = _parse(handMadeConfiguration);
        }

        if (visualization.error) {
            visualization.error = i18n.t(visualization.error);
            if (visualization.description) visualization.description = i18n.t(visualization.description);
        }

    } catch (e) {
        //todo error
        visualization = {error: e};
    }

    //todo show error page
    return visualization;
}
