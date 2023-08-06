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
 *     async encodePartial(annotationsGetter, presetsGetter, annotationsModule, options) {*
 *         const objects = annotationsGetter("keepThisProperty", "keepAlsoThis");
 *         const presets = presetsGetter();
 *         /**
 *          * It gives a third party the power to work with each object and preset individually.
 *          * Note that partial output must not necessarily be a valid output of the given format.
 *          * In the case of unsupported format flexibility on this granularity, simply return
 *          * an unfinished list ob objects that can be later finalized into a full valid format output.
 *          *
 *          * Must return the following object:
 *          *\/
 *         return {
 *             objects: [serialized or unserialized list - depends on options.serialize, possibly undefined],
 *             presets: [serialized or unserialized list - depends on options.serialize, possibly undefined]
 *         };
 *     }
 *
 *     async encodeFinalize(data) {
 *         /**
 *          * Finishes encodePartial() output to a string serialized content.
 *          * encodeFinalize(encodePartial(...)) is therefore a full exporting routine.
 *          * This flexibility is meant for third party SW to work on arbitrary granularity.
 *          *\/
 *          return myFinalize(data);
 *     }
 *
 *     async decode(data, annotationsModule) {
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
     * @param {OSDAnnotations.Convertor.IConvertor} convertor a converter object main class (function) name
     *   from the provided file, it should have:
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
    static async encodePartial(options, context, widthAnnotations=true, withPresets=true) {
        const parserCls = this.get(options.format);
        const exportAll = parserCls.includeAllAnnotationProps;
        const encoded = await new parserCls().encodePartial(
            (...exportedProps) => widthAnnotations ? context.toObject(exportAll, ...exportedProps).objects : undefined,
            () => withPresets ? context.presets.toObject() : undefined,
            context,
            options
        );
        encoded.format = options.format;
        return encoded;
    }

    /**
     * Finalize encoding to a string
     * @param {string} format
     * @param {object} data
     * @param {object} data.objects
     * @param {object} data.presets
     * @return {string}
     */
    static encodeFinalize(format, data) {
        return this.get(format).encodeFinalize(data);
    }

    /**
     * Filename getter for a given format
     * @param format format to use
     * @param context annotations module reference
     * @return {string}
     */
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

    /**
     * Read the list of available format IDs
     * @return {string[]}
     */
    static get formats() {
        return Object.keys(this.CONVERTERS);
    }
};

/**
 *
 * @type {OSDAnnotations.Convertor.IConvertor}
 */
OSDAnnotations.Convertor.IConvertor = class {
    /**
     * Title, used in GUI
     * @type {string}
     */
    static title = 'My Custom Format';
    /**
     * Description, used in GUI
     * @type {*}
     */
    static description = undefined;
    /**
     * Options map, supported parameters, each option must be an object
     * that has:
     * {
     *     type: "checkBox" //what GUI input type it maps to, see available in UIComponents.Elements
     *     ...other...      //provide custom props based on the GUI type chosen, do not forget to provide
     *                        'onchange' property, code that reacts to the value change
     * }
     * @type {{}}
     */
    static options = {};

    /**
     * Declare whether supplied annotations come with
     * all options (in native format ready for encoding) or with
     * required set only
     * @type {boolean}
     */
    static includeAllAnnotationProps = true;
    /**
     * Declare whether this convertor can export annotation objects
     * @type {boolean}
     */
    static exportsObjects = true;
    /**
     * Declare whether this convertor can export annotation presets
     * @type {boolean}
     */
    static exportsPresets = true;

    /**
     * Describe what filename has the exported file
     * @param {OSDAnnotations} context
     * @return {string}
     */
    static getFileName(context) {
        return 'annotations_' + UTILITIES.todayISO() + '.txt';
    }

    /**
     * Annotation export into a selected format. For flexibility, the output must be a serialized object list,
     * and array of serialized exported presets. The encoding must be flexible enough: it is a two-step procedure.
     * For optimization, options.serialize=true means the output arrays can contain arbitrary data to avoid expensive
     * re-encoding. encodeFinalize() must then implicitly recognize whether the arrays come with serialized items.
     *
     * @param {function} annotationsGetter function that returns a list of objects to export or undefined if not desired
     * @param {function} presetsGetter function that returns a list of presets to export or undefined if not desired
     * @param {OSDAnnotations} annotationsModule reference to the module
     * @param {object} options any options your converter wants, must be documented, passed from the module convertor options
     * @param {object} options.serialize build-in parameter for optimization
     * @param {boolean} options.
     * @return {object} must return the following structure:
     *    {
     *        objects: {[(string|any)]} (serialized or unserialized annotation list or undefined if exportsObjects = false),
     *        presets: {[(string|any)]} (serialized or unserialized annotation list or undefined if exportsObjects = false),
     *    }
     */
    async encodePartial(annotationsGetter, presetsGetter, annotationsModule, options) {
        throw("::encodePartial must be implemented!");
    }

    /**
     * Finalize the encoding to a serialized string. If objects/presets
     * are strings, the data comes in pre-serialized, otherwise the serialization
     * was delayed and it is ready for serialization.
     * @param {object} output result of encodePartial(...)
     * @param {[(string|any)]} output.objects
     * @param {[(string|any)]} output.presets
     * @return {string}
     */
    static encodeFinalize(output) {
        throw("::merge must be implemented!");
    }

    /**
     *
     * @param {string} data serialized data (result of encodeFinalize(await encodePartial()))
     * @param {OSDAnnotations} annotationsModule  reference to the module
     * @param {object} options any options your converter wants, must be documented, passed from the
     *   module convertor options
     * @return {object} must return the following structure:
     *    {
     *        objects: [native export format JS objects] or undefined,
     *        presets: [native export format JS presets] or undefined
     *    }
     *    for native format specs, check the readme. Deserialize the string data and parse.
     */
    async decode(data, annotationsModule, options) {
        throw("::decode must be implemented!");
    }
};

