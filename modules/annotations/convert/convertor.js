/**
 * Example for implementation of a convertor:
 * The convertor file must be included after this file.
 *
 * OSDAnnotations.Convertor.MyConvertor = class {
 *     title = 'My Custom Format';
 *     description = 'This is the best format in the universe.';
 *
 *     static includeAllAnnotationProps = true | false; //select whether you want to get all or necessary props only
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
 * }
 *
 * OSDAnnotations.Convertor.register("my-format", OSDAnnotations.Convertor.MyConvertor);
 *
 */

OSDAnnotations.Convertor = class {

    static CONVERTERS = {};

    /**
     * Register custom Annotation Converter
     * @param {string} format a format identifier
     * @param {object} convertor a converter object main class (function) name from the provided file, it should have:
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
     * Encodes the annotation data using asynchronous communication.
     * @param options
     * @param context
     * @param widthAnnotations
     * @param withPresets
     */
    static async encode(options, context, widthAnnotations=true, withPresets=true) {
        const format = options.format;
        const parserCls = this.CONVERTERS[format];
        if (!parserCls) throw "Invalid format " + format;
        const exportAll = parserCls.includeAllAnnotationProps;
        return await new parserCls().encode(
            (...exportedProps) => widthAnnotations ? context.toObject(exportAll, ...exportedProps).objects : [],
            () => withPresets ? context.presets.toObject() : [],
            context,
            options
        );
    }

    static defaultFileName(format, context) {
        const parserCls = this.CONVERTERS[format];
        if (!parserCls) throw "Invalid format " + format;
        return parserCls.getFileName(context);
    }

    /**
     * Decodes the annotation data using asynchronous communication.
     * @param options
     * @param data
     * @param context
     */
    static async decode(options, data, context) {
        const format = options.format;
        const parserCls = this.CONVERTERS[format];
        if (!parserCls) throw "Invalid format " + format;
        return await new parserCls().decode(data, context, options);
    }


    static get formats() {
        const result = Object.keys(this.CONVERTERS);
        //todo generalize this to a module and add native as another converter?
        result.push("native");
        return result;
    }
};

