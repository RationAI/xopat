OSDAnnotations.Convertor = class {

    static CONVERTERS = {

    };

    /**
     * Register custom Annotation Converter
     * @param {string} name version to register (can override)
     * @param {string} filename file that provides the implementation of the converter
     * @param {object} convertor a converter object from the provided file
     * @param {string} convertor.title human readable title
     * @param {string} convertor.description optional
     * @param {function} convertor.glContext returns WebGL context
     * @param {function} convertor.webGLImplementation returns class extending WebGLImplementation
     */
    static register(name, filename, convertor) {
        if ((typeof convertor.encode) !== "function") {
            console.error(`Registered annotations convertor ${name} must provide encode() function!`);
            return;
        }
        if ((typeof convertor.decode) !== "function") {
            console.error(`Registered annotations convertor ${name} must provide decode() function!`);
            return;
        }
        if ((typeof convertor.title) !== "string") {
            console.warn(`Registered annotations convertor ${name} should provide 'title'.`);
            convertor.title = name;
        }
        if (typeof OSDAnnotations.Convertor._CONVERTERS[name] === "object") {
            console.warn(`Registered annotations convertor ${name} overrides existing convertor!`);
        }
        OSDAnnotations.Convertor.CONVERTERS[name] = convertor;
    }

    /**
     * Encodes the annotation data using a worker
     * @param name
     * @param annotations
     * @param presets
     * @param onFinish
     */
    static encode(name, annotations, presets, onFinish) {

    }

    /**
     * Decodes the annotation data using a worker
     * @param name
     * @param data
     * @param onFinish
     */
    static decode(name, data, onFinish) {

    }
};

/////////////////////////////////
/// REGISTER CALLS BELOW ////////
/////////////////////////////////
