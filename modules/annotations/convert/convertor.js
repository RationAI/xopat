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
 *     static getSuffix(context) {
 *         return '.awesome';
 *     }
 *
 *     async encodePartial(annotationsGetter, presetsGetter) {*
 *         const objects = annotationsGetter("keepThisProperty", "keepAlsoThis");
 *         const presets = presetsGetter();
 *         /**
 *          * It gives a third party the power to work with each object and preset individually.
 *          * Note that partial output must not necessarily be a valid output of the given format.
 *          * In the case of unsupported format flexibility on this granularity, simply return
 *          * an list of objects that can be later finalized into a full valid format output.
 *          *
 *          * Options are in this.options, reference to the annotation module as this.context
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
 *     async decode(data) {
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
     * @param {typeof OSDAnnotations.Convertor.IConvertor} convertor a converter object class (not an instance)
     */
    static register(format, convertor) {
        if (typeof this.CONVERTERS[format] === "object") {
            console.warn(`Registered annotations convertor ${format} overrides existing convertor!`);
        }
        for (let opt in convertor.options) {
            if (opt.startsWith("_")) continue;
            const option = convertor.options[opt];
            if (!option.type) {
                console.warn("Invalid convertor option: does not have 'type' field!");
                delete convertor.options[opt];
                continue;
            }
            if (opt in convertor) {
                console.warn("Invalid convertor option: overriding existing properties is not allowed!", opt, option);
                delete convertor.options[opt];
                continue;
            }
            option.changed = `OSDAnnotations.Convertor.get('qupath').${opt} = value;`;
            convertor[opt] = option.default;
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
 * @param {Object} options
 * @param {string} options.format
 *      Format ID of the converter to use.
 * @param {boolean} [options.exportsObjects]
 *      Whether annotation objects should be exported.
 * @param {boolean} [options.exportsPresets]
 *      Whether annotation presets should be exported.
 * @param {boolean} [options.scopeSelected=false]
 *      If true, only currently selected annotations/layers are exported.
 *      Throws EXPORT_NO_SELECTION if nothing is selected.
 * @param {{x:number, y:number}} [options.imageCoordinatesOffset]
 *      Optional image coordinate offset applied on export/import.
 * @param {boolean} [options.serialize]
 *      Optimization flag: if true, converters may return non-serialized data and encodeFinalize() will serialize them.
 * @param {OSDAnnotations} context
 *      Annotations module instance.
 * @param {boolean} withAnnotations
 *      Request exporting annotation objects.
 * @param {boolean} withPresets
 *      Request exporting presets.
 *
 * @returns serialized or plain list of strings of objects based on this.options.serialize:
 * {
 *     objects: [...serialized annotations... ],
 *     presets: [...serialized presets... ],
 * }
 */
    static async encodePartial(options, context, withAnnotations=true, withPresets=true) {
        const parserCls = this.get(options.format);
        const exportAll = parserCls.includeAllAnnotationProps;

        options.exportsObjects = withAnnotations && parserCls.exportsObjects;
        options.exportsPresets = withPresets && parserCls.exportsPresets;

        let selectedIds = new Set();
        if (options.exportsObjects && options.scopeSelected) {
            const selectedAnns = (context.getSelectedAnnotations?.() || []);
            const layers = (context.getSelectedLayers?.() || [])
                .filter(Boolean);

            const layerAnns = layers.length
                ? layers.flatMap(l => l.getObjects?.() || [])
                : [];

            const pushUnique = (arr) => {
                for (const o of arr) {
                    const id = String(o?.id ?? '');
                    if (id) selectedIds.add(id);
                }
            };

            pushUnique(selectedAnns);
            pushUnique(layerAnns);
			if (!selectedIds.size) {
                const err = new Error('No annotations selected');
                err.code = 'EXPORT_NO_SELECTION';
                throw err;
            }
        }
        
        const annotationsGetter = (...exportedProps) => {
            if (!options.exportsObjects) return undefined;
            let objs = context.toObject(
                exportAll,
                // todo move _exportPrivateAnnotations to options
                !context._exportPrivateAnnotations && ((o) => !o.private),
                ...exportedProps
            ).objects;

            if (options.scopeSelected && selectedIds.size) {
                objs = objs.filter(o => selectedIds.has(String(o.id)));
            }
            return objs;
        };

        const encoded = await new parserCls(context, options).encodePartial(
            annotationsGetter,
            () => context.module.presets.toObject()
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
     * Suffix getter for a given format
     * @param format format to use
     * @return {string}
     */
    static getSuffix(format) {
        return this.get(format).getSuffix();
    }

    /**
     * Decodes the annotation data using asynchronous communication.
     * @param options
     * @param data
     * @param context
     */
    static async decode(options, data, context) {
        const parserCls = this.get(options.format);
        return await new parserCls(context, options).decode(data, context, options);
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
     *     default: default value
     *     ...possibly provide other properties, note that 'changed' property is handled automatically
     * }
     * Properties defined here are automatically attached as a static properties of the given class.
     * E.g.: option
     * myValue: {type:"checkBox", default: false} will create
     *    - this.constructor.myValue object with default 'false' value
     *    - this.options.myVaue object with default value this.constructor.myValue, possibly overridden
     *    from the constructor.
     * Note. options starting with underscore are ignored, these can be used for custom HTML content (e.g. a text)
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
     * @param {OSDAnnotations} annotationsModule  reference to the module
     * @param {object} options any options your converter wants,
     *   must be documented, passed from the module convertor options
     * @param {boolean} options.serialize build-in parameter for optimization
     * @param {boolean} options.exportsObjects true if annotations requested, always false if static set to false
     * @param {boolean} options.exportsPresets true if presets requested, always false if static set to false
     * @param options
     */
    constructor(annotationsModule, options) {
        /**
         * Reference to the annotations module.
         * @type {OSDAnnotations}
         * @memberOf OSDAnnotations.Convertor.IConvertor
         */
        this.context = annotationsModule;
        /**
         * Options object enriched by values from static options (if undefined).
         * @memberOf OSDAnnotations.Convertor.IConvertor
         */
        this.options = {...options};
        for (let opt in this.constructor.options) {
            if (opt.startsWith("_")) continue;
            if (this.options[opt] === undefined) {
                this.options[opt] = this.constructor[opt];
            }
        }
    }

    /**
     * Describe what filename has the exported file
     * @param {OSDAnnotations} context
     * @return {string}
     */
    static getFileName(context) {
        return 'annotations_' + UTILITIES.todayISO("_") + '.txt';
    }

    /**
     * Annotation export into a selected format. For flexibility, the output must be a serialized object list,
     * and array of serialized exported presets. The encoding must be flexible enough: it is a two-step procedure.
     * For optimization, options.serialize=true means the output arrays can contain arbitrary data to avoid expensive
     * re-encoding. encodeFinalize() must then implicitly recognize whether the arrays come with serialized items.
     *
     * @param {function} annotationsGetter function that returns a list of objects to export or undefined if not desired
     * @param {function} presetsGetter function that returns a list of presets to export or undefined if not desired
     * @return {object} must return the following structure:
     *    {
     *        objects: {[(string|any)]} (serialized or unserialized annotation list or undefined if exportsObjects = false),
     *        presets: {[(string|any)]} (serialized or unserialized annotation list or undefined if exportsObjects = false),
     *    }
     */
    async encodePartial(annotationsGetter, presetsGetter) {
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
     * todo: consider support for un-serialized objects too...
     * @param {string} data serialized data (result of encodeFinalize(await encodePartial()))
     * @return {object} must return the following structure:
     *    {
     *        objects: [native export format JS objects] or undefined,
     *        presets: [native export format JS presets] or undefined
     *    }
     *    for native format specs, check the readme. Deserialize the string data and parse.
     */
    async decode(data) {
        throw("::decode must be implemented!");
    }

    /**
     * Native-format method that removes unused presets, or keeps all if objects are not exported
     * @param {[object]?} annotations or undefined
     * @param {[object]?} presets or undefined
     */
    filterUnusedPresets(annotations, presets) {
        if (!annotations || !presets) return presets;
        const presetsIdSet = new Set();
        for (let annotation of annotations) {
            presetsIdSet.add(annotation?.presetID);
        }
        return presets.filter(p => presetsIdSet.has(p.presetID));
    }
};

