/**
 * Example for implementation of a convertor:
 * The convertor file must be included after this file.
 *
 * OSDAnnotations.Convertor.register("my-format", class extends OSDAnnotations.Convertor.IConvertor {
 *     static title = 'My Custom Format';
 *     static description = 'This is the best format in the universe.';
 *
 *     //override behaviour if needed, default true
 *     static includeAllAnnotationProps = false;
 *     static exportsObjects = false;
 *     static exportsPresets = false;
 *
 *     static getFileName(context) {
 *         return 'annotations_' + UTILITIES.todayISO() + '.awesome';
 *     }
 *
 *     encode(annotationsGetter, presetsGetter, annotationsModule) {*
 *         const objects = annotationsGetter("keepThisProperty", "keepAlsoThis");
 *         const presets = presetsGetter();
 *         /**
 *          * Must return a string - serialized format.
 *          *\/
 *         return mySerializeData(objects, presets);
 *     }
 *
 *     decode(data, annotationsModule) {
 *         /**
 *          * Must return
 *            {
 *               objects: [native export format JS objects],
 *               presets: [native export format JS presets]
 *            }
 *          * for native format, check the readme. Deserialize the string data and parse.
 *          *\/
 *         return myParseData(data);
 *     }
 * });
 *
 */

OSDAnnotations.Convertor = class {

    static CONVERTERS = {};

    /**
     * Register custom Annotation Converter
     * @param {string} format a format identifier
     * @param {OSDAnnotations.Convertor.IConvertor} convertor a converter object main class (function) name from the provided file, it should have:
     * @param {string} convertor.title human readable title
     * @param {string} convertor.description optional
     * @param {function} convertor.encode encodes the annotations into desired format from the native one,
     *  receives annotations and presets _getters_, should return a string - serialized object
     * @param {function} convertor.decode decodes the format into native format, receives a string, returns
     *  on objects {annotations: [], presets: []}
     */
    static register(format, convertor) {
        if (typeof this.CONVERTERS[format] === "object") {
            console.warn(`Registered annotations convertor ${format} overrides existing convertor!`);
        }
        this.CONVERTERS[format] = convertor;
    }

    /**
     * Get a given convertor
     * @param format
     */
    static get(format) {
        const parserCls = this.CONVERTERS[format];
        if (!parserCls) throw "Invalid format " + format;
        return parserCls;
    }

    /**
     * Encodes the annotation data using asynchronous communication.
     * @param options
     * @param context
     * @param widthAnnotations
     * @param withPresets
     */
    static async encode(options, context, widthAnnotations=true, withPresets=true) {
        const parserCls = this.get(options.format);
        const exportAll = parserCls.includeAllAnnotationProps;
        return await new parserCls().encode(
            (...exportedProps) => widthAnnotations ? context.toObject(exportAll, ...exportedProps).objects : undefined,
            () => withPresets ? context.presets.toObject() : undefined,
            context,
            options
        );
    }

    static defaultFileName(format, context) {
        return this.get(format).getFileName(context);
    }

    /**
     * Decodes the annotation data using asynchronous communication.
     * @param options
     * @param data
     * @param context
     */
    static async decode(options, data, context) {
        const parserCls = this.get(options.format);
        return await new parserCls().decode(data, context, options);
    }


    static get formats() {
        return Object.keys(this.CONVERTERS);
    }
};

OSDAnnotations.Convertor.IConvertor = class {
    static title = 'My Custom Format';
    static description = undefined;

    //select whether you want to get all or necessary props only
    static includeAllAnnotationProps = true;

    static exportsObjects = true;
    static exportsPresets = true;

    static getFileName(context) {
        return 'annotations_' + UTILITIES.todayISO() + '.txt';
    }

    /**
     *
     * @param {function} annotationsGetter function that returns a list of objects to export or undefined if not desired
     * @param {function} presetsGetter function that returns a list of presets to export or undefined if not desired
     * @param {OSDAnnotations} annotationsModule reference to the module
     * @param {object} options any options your converter wants, must be documented, passed from the module convertor options
     * @return {string}
     */
    encode(annotationsGetter, presetsGetter, annotationsModule, options) {
        throw("::encode must be implemented!");
    }

    /**
     *
     * @param {string} data serialized data (result of encode())
     * @param {OSDAnnotations} annotationsModule  reference to the module
     * @param {object} options any options your converter wants, must be documented, passed from the module convertor options
     * @return {object}
     *  Must return
     *    {
     *        objects: [native export format JS objects] or undefined,
     *        presets: [native export format JS presets] or undefined
     *    }
     *    for native format, check the readme. Deserialize the string data and parse.
     */
    decode(data, annotationsModule, options) {
        throw("::decode must be implemented!");
    }
};

