/**
 * Annotation formats live in the core format registry, `IO_PIPELINE.formats`,
 * under the domain `"annotations"`. Register one from anywhere — this module,
 * a plugin, a module that loads before or after this one:
 *
 * IO_PIPELINE.formats.register({
 *     domain: "annotations",
 *     id: "my-format",
 *     title: "My Format",             // or a function, resolved when shown (translated)
 *     extensions: [".awesome"],
 *     contentType: "application/json",
 *     // What the model handed to encode() should contain (all default to true):
 *     //   allProps  every property of each object, or only the factory's necessary ones
 *     //   props     extra property names to keep when allProps is false
 *     //   objects / presets   whether the format can carry them at all
 *     traits: { allProps: false },
 *     // model = { objects, presets } in the native shape (see the module README).
 *     // fctx.options are the export options, fctx.context the viewer's canvas
 *     // wrapper (absent for a conversion with no viewer behind it), fctx.io the
 *     // IO dispatch when the pipeline is the caller.
 *     encode(model, fctx) { return myStringify(model); },
 *     decode(data, fctx) { return { objects: [...], presets: [...] }; },
 *     // optional: 0..1 confidence that `data` is this format
 *     sniff(data, hint) { return hint.json?.myMarker ? 0.9 : 0; },
 * });
 *
 * Convert directly, without the IO pipeline:
 *
 *     const text = await fabricWrapper.export({ format: "my-format" });
 *     const text = await IO_PIPELINE.formats.encode("annotations", "my-format", model, { context: fabricWrapper });
 *     const { model, format } = await IO_PIPELINE.formats.decode("annotations", "auto", data, { fileName });
 *
 * `OSDAnnotations.Convertor` below is the previous API, kept working on top of
 * the registry. It is DEPRECATED: `Convertor.register(id, IConvertorClass)`
 * still accepts a two-stage convertor class and adapts it into a registry
 * format, and the static helpers delegate. New code should not use it.
 */

OSDAnnotations.Convertor = class {

    /** Registry domain of every annotation format. */
    static DOMAIN = "annotations";

    static get _registry() {
        return IO_PIPELINE.formats;
    }

    static _warned = new Set();
    static _deprecated(what, instead) {
        if (this._warned.has(what)) return;
        this._warned.add(what);
        console.warn(`[annotations] OSDAnnotations.Convertor.${what} is deprecated; use ${instead}.`);
    }

    /**
     * Presets actually referenced by `annotations`; all of them when no
     * annotations are exported.
     * @param {[object]?} annotations
     * @param {[object]?} presets
     */
    static filterUnusedPresets(annotations, presets) {
        if (!annotations || !presets) return presets;
        const used = new Set();
        for (let annotation of annotations) used.add(annotation?.presetID);
        // Null/undefined entries are dropped rather than crashing the export.
        return presets.filter(p => p && used.has(p.presetID));
    }

    /**
     * What a format needs in its model, with the defaults applied.
     * @param {string} format
     * @return {{allProps: boolean, props: string[], objects: boolean, presets: boolean}}
     */
    static traits(format) {
        const traits = this._registry.get(this.DOMAIN, format)?.traits || {};
        return {
            allProps: traits.allProps !== false,
            props: Array.isArray(traits.props) ? traits.props : [],
            objects: traits.objects !== false,
            presets: traits.presets !== false,
        };
    }

    /**
     * Register a two-stage convertor class.
     * @deprecated register an IOFormat with IO_PIPELINE.formats.register(...)
     * @param {string} format a format identifier
     * @param {typeof OSDAnnotations.Convertor.IConvertor} convertor a converter object class (not an instance)
     */
    static register(format, convertor) {
        this._deprecated("register()", "IO_PIPELINE.formats.register({domain: 'annotations', ...})");
        for (let opt in convertor.options) {
            if (opt.startsWith("_")) continue;
            const option = convertor.options[opt];
            if (!option.type) {
                console.warn("Invalid convertor option: does not have 'type' field!");
                delete convertor.options[opt];
                continue;
            }
            // The class statics remain the legacy defaults an IConvertor
            // instance falls back to; values the user picks are per call.
            if (!(opt in convertor)) convertor[opt] = option.default;
        }

        let suffix = "";
        try { suffix = convertor.getSuffix?.() || ""; } catch (_e) { /* optional */ }
        this._registry.register({
            domain: this.DOMAIN,
            id: format,
            title: convertor.title,
            description: convertor.description,
            extensions: suffix ? [suffix] : [],
            lossy: convertor.lossy ? (convertor.lossyReason || "This format does not preserve everything.") : undefined,
            options: convertor.options,
            traits: {
                allProps: convertor.includeAllAnnotationProps !== false,
                objects: convertor.exportsObjects !== false,
                presets: convertor.exportsPresets !== false,
                legacyClass: convertor,
            },
            encode: async (model, fctx) => {
                const partial = await this._legacyEncodePartial(convertor, model, fctx);
                return convertor.encodeFinalize(partial);
            },
            decode: (data, fctx) => new convertor(fctx.context, fctx.options).decode(data, fctx.context, fctx.options),
        });
    }

    static _legacyEncodePartial(convertor, model, fctx) {
        const options = { ...fctx.options };
        return new convertor(fctx.context, options).encodePartial(
            // A legacy convertor may ask for extra properties per call; that
            // needs the live canvas, so without one it gets the model as built.
            (...props) => props.length && fctx.context?.toModel
                ? fctx.context.toModel({ ...options, props }, true, false).objects
                : model.objects,
            () => model.presets
        );
    }

    /**
     * A flat description of a registered format, in the shape the settings UI
     * reads (title, description, options, lossy, exportsObjects, …). For a
     * legacy convertor class this is the class itself.
     * @param format
     */
    static get(format) {
        const registered = this._registry.get(this.DOMAIN, format);
        if (!registered) throw new Error("Invalid format " + format);
        if (registered.traits?.legacyClass) return registered.traits.legacyClass;
        const traits = this.traits(format);
        const lossyReason = typeof registered.lossy === "function" ? registered.lossy() : registered.lossy;
        return {
            title: this._registry.title(this.DOMAIN, format),
            description: typeof registered.description === "function" ? registered.description() : registered.description,
            options: registered.options || {},
            includeAllAnnotationProps: traits.allProps,
            exportsObjects: traits.objects,
            exportsPresets: traits.presets,
            lossy: !!lossyReason,
            lossyReason: lossyReason || "",
            getSuffix: () => registered.extensions[0] || "",
            encodeFinalize: (data) => this.encodeFinalize(format, data),
        };
    }

    /**
     * Read-only id → format view.
     * @deprecated use IO_PIPELINE.formats.list('annotations')
     */
    static get CONVERTERS() {
        const out = {};
        for (const format of this._registry.list(this.DOMAIN)) out[format.id] = this.get(format.id);
        return out;
    }

    /**
     * First half of the former two-stage export.
     * @deprecated use fabricWrapper.toModel(options) and IO_PIPELINE.formats.encode(...)
     * @param {Object} options export options; `format` is required
     * @param {OSDAnnotations.FabricWrapper} context
     * @param {boolean} withAnnotations
     * @param {boolean} withPresets
     * @returns for a legacy convertor its own partial output, otherwise the
     *   model `{objects, presets}`; either way accepted by encodeFinalize()
     */
    static async encodePartial(options, context, withAnnotations=true, withPresets=true) {
        const registered = this._registry.get(this.DOMAIN, options.format);
        if (!registered) throw new Error("Invalid format " + options.format);
        const model = context.toModel(options, withAnnotations, withPresets);
        const fctx = { options: this._registry.resolveOptions(registered, options), context };
        const legacy = registered.traits?.legacyClass;
        const partial = legacy ? await this._legacyEncodePartial(legacy, model, fctx) : { ...model };
        partial.format = options.format;
        // Carried so encodeFinalize() converts with the same options.
        Object.defineProperty(partial, "_fctx", { value: fctx, enumerable: false });
        return partial;
    }

    /**
     * Second half of the former two-stage export.
     * @deprecated use IO_PIPELINE.formats.encode('annotations', format, model)
     * @param {string} format
     * @param {object} data output of encodePartial()
     * @return {string|Promise} synchronous for formats whose encode() is
     */
    static encodeFinalize(format, data) {
        const registered = this._registry.get(this.DOMAIN, format);
        if (!registered) throw new Error("Invalid format " + format);
        const legacy = registered.traits?.legacyClass;
        if (legacy) return legacy.encodeFinalize(data);
        const fctx = data?._fctx || { options: this._registry.resolveOptions(registered) };
        return registered.encode(data, fctx);
    }

    /**
     * @deprecated use IO_PIPELINE.formats.get('annotations', format).extensions
     * @return {string}
     */
    static getSuffix(format) {
        return this._registry.get(this.DOMAIN, format)?.extensions[0] || "";
    }

    /**
     * @deprecated use IO_PIPELINE.formats.decode('annotations', format, data, {context})
     */
    static async decode(options, data, context) {
        return (await this._registry.decode(this.DOMAIN, options.format, data, { options, context })).model;
    }

    /**
     * @deprecated use IO_PIPELINE.formats.list('annotations')
     * @return {string[]}
     */
    static get formats() {
        return this._registry.list(this.DOMAIN).map(f => f.id);
    }

    /**
     * Format a file name suggests (longest registered extension wins), or null.
     * Content is not consulted — IO_PIPELINE.formats.detect() does both.
     * @param {string} name
     * @return {string|null}
     */
    static detectFromFilename(name) {
        if (!name || typeof name !== 'string') return null;
        const lower = name.toLowerCase();
        let best = null, bestLength = 0;
        for (const format of this._registry.list(this.DOMAIN)) {
            for (const extension of format.extensions) {
                if (lower.endsWith(extension) && extension.length > bestLength) {
                    best = format.id;
                    bestLength = extension.length;
                }
            }
        }
        return best;
    }
};

/**
 * Base class of the former two-stage convertor API. Kept so existing external
 * convertors keep loading; see the top of this file for the replacement.
 * @deprecated
 * @type {OSDAnnotations.Convertor.IConvertor}
 */
OSDAnnotations.Convertor.IConvertor = class {
    /** Title, used in GUI @type {string} */
    static title = 'My Custom Format';
    /** Description, used in GUI */
    static description = undefined;
    /**
     * Options map: `{ name: { type, default, ...ui props } }`. Names starting
     * with underscore are UI-only content. Each default is also attached as a
     * static of the class and used when an instance is given no value.
     */
    static options = {};
    /** Whether supplied annotations carry all properties or only the necessary set. */
    static includeAllAnnotationProps = true;
    /** Whether this convertor can export annotation objects. */
    static exportsObjects = true;
    /** Whether this convertor can export annotation presets. */
    static exportsPresets = true;
    /** Whether export loses information; the UI warns the user when true. */
    static lossy = false;
    /** What is lost, shown with the warning. */
    static lossyReason = "";

    /**
     * @param {OSDAnnotations.FabricWrapper} annotationsModule the viewer's canvas wrapper (has `.module`)
     * @param {object} options
     * @param {boolean} options.exportsObjects true if annotations requested
     * @param {boolean} options.exportsPresets true if presets requested
     */
    constructor(annotationsModule, options) {
        this.context = annotationsModule;
        this.options = {...options};
        for (let opt in this.constructor.options) {
            if (opt.startsWith("_")) continue;
            if (this.options[opt] === undefined) {
                this.options[opt] = this.constructor[opt];
            }
        }
    }

    /**
     * @param {function} annotationsGetter returns the objects to export, or undefined
     * @param {function} presetsGetter returns the presets
     * @return {object} `{objects, presets}`, consumed by the static encodeFinalize()
     */
    async encodePartial(annotationsGetter, presetsGetter) {
        throw new Error("::encodePartial must be implemented!");
    }

    /**
     * @param {object} output result of encodePartial(...)
     * @return {string}
     */
    static encodeFinalize(output) {
        throw new Error("::encodeFinalize must be implemented!");
    }

    /**
     * @param {string} data serialized data
     * @return {object} `{objects, presets}` in the native shape
     */
    async decode(data) {
        throw new Error("::decode must be implemented!");
    }

    filterUnusedPresets(annotations, presets) {
        return OSDAnnotations.Convertor.filterUnusedPresets(annotations, presets);
    }
};
