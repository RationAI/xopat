OSDAnnotations.Convertor = class {

    static CONVERTERS = {};

    /**
     * Register custom Annotation Converter
     * @param {string} name version to register (can override)
     * @param {object} convertor a converter object main class (function) name from the provided file, it should have:
     * @param {string} convertor.title human readable title
     * @param {string} convertor.description optional
     * @param {function} convertor.encode encodes the annotations into desired format from the native one,
     *  receives annotations and presets objects, should return a string - serialized object
     * @param {function} convertor.decode decodes the format into native format, receives a string, returns
     *  on objects {annotations: [], presets: []}
     */
    static register(name, convertor) {
        if (typeof OSDAnnotations.Convertor.CONVERTERS[name] === "object") {
            console.warn(`Registered annotations convertor ${name} overrides existing convertor!`);
        }
        OSDAnnotations.Convertor.CONVERTERS[name] = convertor;
    }

    /**
     * Encodes the annotation data using asynchronous communication.
     * @param name
     * @param annotations
     * @param presets
     * @param context
     */
    static async encode(name, annotations, presets, context) {
        const parserCls = OSDAnnotations.Convertor.CONVERTERS[name];
        return new parserCls().encode(annotations, presets, context);
    }

    /**
     * Decodes the annotation data using asynchronous communication.
     * @param name
     * @param data
     * @param context
     */
    static async decode(name, data, context) {
        const parserCls = OSDAnnotations.Convertor.CONVERTERS[name];
        return new parserCls().encode(data, context);
    }

    static async load(name, data, context) {

    }

    static async export(name, context) {

    }
};

