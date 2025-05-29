// noinspection JSUnresolvedVariable

OSDAnnotations.Preset = class {
    /**
     * @typedef OSDAnnotations.PresetMeta
     * @type {Object<string,OSDAnnotations.PresetMetaItem>}
     */

    /**
     * @typedef OSDAnnotations.PresetMetaItem
     * @property {string} name
     * @property {string} value
     */

    /**
     * Preset: object that pre-defines the type of annotation to be created, along with its parameters
     * @param {string} id
     * @param {OSDAnnotations.AnnotationObjectFactory} objectFactory
     * @param {string} category default category meta data
     * @param {string} color fill color
     */
    constructor(id, objectFactory = null, category = "", color = "") {
        if (! objectFactory instanceof OSDAnnotations.AnnotationObjectFactory) throw "Invalid preset constructor!";
        this.color = color;
        this.objectFactory = objectFactory;
        this.presetID = id;
        /**
         * @type {OSDAnnotations.PresetMeta}
         */
        this.meta = {};
        this.meta.category = {
            name: 'Name',
            value: category
        };
        this._used = false;
        this._tmp = {};
    }

    /**
     * Create the object from JSON representation
     * @param {object} parsedObject serialized object, output of toJSONFriendlyObject()
     * @param {string} parsedObject.color
     * @param {string} parsedObject.factoryID
     * @param {string} parsedObject.presetID
     * @param {OSDAnnotations.PresetMeta} [parsedObject.meta]
     * @param {Object<string,any>} [parsedObject.temporary] temporary data to attach, optional
     * @param {OSDAnnotations} context function able to get object factory from id
     * @return {OSDAnnotations.Preset} instantiated preset
     */
    static fromJSONFriendlyObject(parsedObject, context) {
        let factory = context.getAnnotationObjectFactory(parsedObject.factoryID);
        if (factory === undefined) {
            console.error("Invalid preset type.", parsedObject.factoryID, "of", parsedObject,
                "No factory for such object available.");
            factory = context.getAnnotationObjectFactory("polygon"); //rely on polygon presence
        }

        const id = typeof parsedObject.presetID === "string" ? parsedObject.presetID : `${parsedObject.presetID}`;
        let preset = new this(id, factory, "", parsedObject.color);
        if (parsedObject.meta) {
            preset.meta = parsedObject.meta;
        }
        preset._used = true; //keep imported
        preset._tmp = parsedObject.temporary || {};
        return preset;
    }

    /**
     * Convert the preset to JSON-friendly object
     * @return {{color: string, factoryID: string, meta: OSDAnnotations.PresetMeta, presetID: string}}
     */
    toJSONFriendlyObject() {
        return {
            color: this.color,
            factoryID: this.objectFactory.factoryID,
            presetID: this.presetID,
            meta: this.meta
        };
    }

    /**
     * Read name of a meta value
     * @param {string} key meta key
     * @return {string} meta name
     */
    getMetaName(key) {
        return this.meta[key] ? this.meta[key].name : undefined;
    }

    /**
     * Read value of a metadata
     * @param {string} key meta key
     * @return {string} meta value
     */
    getMetaValue(key) {
        return this.meta[key] ? this.meta[key].value : undefined;
    }

    /**
     * Temporary Metadata, not exported
     * @param {string} key
     * @param {any} value
     */
    setTemporaryMeta(key, value) {
        this._tmp[key] = value;
    }

    /**
     * Temporary Metadata, not exported
     * @param {string} key
     * @param {any} defaultValue
     */
    getTemporaryMeta(key, defaultValue) {
        const value = this._tmp[key];
        return value === undefined ? defaultValue : value;
    }
}; // end of namespace Preset

/**
 * Preset manager, takes care of GUI and management of presets.
 * Provides API to objects to obtain object options. Has left and right
 * attributes that specify what preset is being active for the left or right button respectively.
 */
OSDAnnotations.PresetManager = class {

    /**
     * Shared options, set to each annotation object.
     * @typedef {Object} OSDAnnotations.CommonAnnotationVisuals
     * @property {boolean} [selectable] - Whether the annotation is selectable.
     * @property {number} [originalStrokeWidth] - The original width of the stroke.
     * @property {string} [borderColor] - The color of the border.
     * @property {string} [cornerColor] - The color of the corners.
     * @property {string} [stroke] - The color of the stroke.
     * @property {string} [strokeSide] - Position of the stroke (center, inside, outside).
     * @property {number} [borderScaleFactor] - The factor by which the border is scaled.
     * @property {boolean} [hasControls] - Whether the annotation has controls.
     * @property {boolean} [lockMovementY] - Whether movement along the Y-axis is locked.
     * @property {boolean} [lockMovementX] - Whether movement along the X-axis is locked.
     * @property {boolean} [hasRotatingPoint] - Whether the annotation has a rotating point.
     * @property {boolean} [modeOutline] - Whether the annotation is in outline mode.
     * @property {number} [opacity]
     */

    /**
     * Default visual settings for annotations.
     * todo make this cache-loaded, parametrized
     * @type {OSDAnnotations.CommonAnnotationVisuals}
     */
    static commonAnnotationVisuals = {
        selectable: true,
        originalStrokeWidth: 3,
        borderColor: 'rgba(251,184,2,0.35)',
        cornerColor: 'rgba(251,184,2,0.35)',
        stroke: 'black',
        borderScaleFactor: 3,
        strokeSide: 'center',
        hasControls: false,
        lockMovementY: true,
        lockMovementX: true,
        hasRotatingPoint: false,
        modeOutline: false,
        opacity: 0.4
    };

    /**
     * Create Preset Manager
     * @param {string} selfName name of the property 'self' in parent (not used)
     * @param {OSDAnnotations} context parent context
     */
    constructor(selfName, context) {
        this._context = context;
        this._presets = {};
        //active presets for mouse buttons, default state create one
        this.left = undefined;
        this.right = undefined;
        this._colorSteps = 8;
        this._colorStep = 0;
        this._presetsImported = false;  // todo remove this prop

        const cache = this._context.cache;
        this.commonAnnotationVisuals = { ... this.constructor.commonAnnotationVisuals };

        //todo: consider cache api that supports type conversions
        const _parseCachedProps = (convertor, ...names) => {
            for (let name of names) {
                const value = cache.get('visuals.' + name);
                if (value !== undefined && value !== null) {
                    this.commonAnnotationVisuals[name] = convertor ? convertor(value) : value;
                }
            }
        };
        _parseCachedProps(x => !!x, 'modeOutline');
        _parseCachedProps(x => Number.parseFloat(x), 'opacity');
        _parseCachedProps(x => Number.parseInt(x), 'originalStrokeWidth');
        _parseCachedProps(undefined, 'borderColor', 'cornerColor', 'stroke');

        this._context.addHandler('preset-delete', e => {
            if (e.preset === this.left) this.selectPreset(undefined, true);
            else if (e.preset === this.right) this.selectPreset(undefined, false);
        });
    }

    /**
     * Get default unknown preset: this preset is used when annotation references unknown preset ID
     * @type {OSDAnnotations.Preset}
     */
    get unknownPreset() {
        if (!this._unknownPreset) {
            this._unknownPreset = new OSDAnnotations.Preset("__unknown__", this._context.polygonFactory, "Unknown", "#adadad");
        }
        return this._unknownPreset;
    }

    getActivePreset(isLeftClick) {
        return isLeftClick ? this.left : this.right;
    }

    getAnnotationOptionsFromInstance(preset, asLeftClick=true) {
        let result = this._populateObjectOptions(preset);
        result.isLeftClick = asLeftClick;
        return this._withDynamicOptions(result);
    }

    /**
     * Get data to set as annotation properties (look, metadata...)
     * @param {boolean} isLeftClick true if the data should be with preset data bound to the left mouse button
     * @returns {object} data to populate fabric object with (parameter 'options'
     * in AnnotationObjectFactory::create(..))
     */
    getAnnotationOptions(isLeftClick) {
        let preset = this.getActivePreset(isLeftClick);
        return this.getAnnotationOptionsFromInstance(preset, isLeftClick);
    }

    /**
     * Add new preset with default values
     * @param {string?} id to create, generates random otherwise
     * @param {string?} categoryName custom name
     * @event preset-create
     * @returns {OSDAnnotations.Preset} newly created preset
     */
    addPreset(id=undefined, categoryName="") {
        let preset = new OSDAnnotations.Preset(id || Date.now().toString(), this._context.polygonFactory, categoryName, this.randomColorHexString());
        this._presets[preset.presetID] = preset;
        this._context.raiseEvent('preset-create', {preset: preset});
        return preset;
    }

    /**
     * Check whether preset has been modified or whether it is a default-valued item
     * so that it can be e.g. removed automatically
     * @param {OSDAnnotations.Preset} p
     * @return {boolean}
     */
    isUnusedPreset(p) {
        return !p._used && p.objectFactory == this._context.polygonFactory
            && !p.meta.category?.value
            && Object.keys(p.meta).length === 1;
    }

    /**
     * Alias for static commonAnnotationVisuals
     * @param {OSDAnnotations.Preset} withPreset
     */
    getCommonProperties(withPreset=undefined) {
        if (withPreset) {
            withPreset._used = true;
            return this._withDynamicOptions(this._populateObjectOptions(withPreset));
        }
        return this._withDynamicOptions(this.commonAnnotationVisuals);
    }

    /**
     * Check if preset exists
     * @param {string} id preset id
     * @returns true if exists
     */
    exists(id) {
        return this._presets.hasOwnProperty(id);
    }

    /**
     * Presets getter
     * @param {string} [id=undefined] preset id, if not set get the first preset
     * @returns {OSDAnnotations.Preset} preset instance
     */
    get(id = undefined) {
        if (!id) {
            for (const k in this._presets) {
                if (Object.prototype.hasOwnProperty.call(this._presets, k)) return this._presets[k];
            }
            return this.unknownPreset;
        }
        return this._presets[id];
    }

    /**
     * Presets getter
     * @returns {Array<any>} preset ids
     */
    getExistingIds() {
        return Object.keys(this._presets);
    }

    /**
     * Presets getter, creates if it does not exist
     * @param {string} id preset id
     * @param {string?} categoryName name to set
     * @returns {OSDAnnotations.Preset} preset instance
     */
    getOrCreate(id, categoryName="") {
        return this.get(id) || this.addPreset(id, categoryName);
    }

    /**
     * Safely remove preset
     * @event preset-delete
     * @param {string} id preset id
     * @returns deleted preset or false if deletion failed
     */
    removePreset(id) {
        let toDelete = this._presets[id];
        if (!toDelete) return undefined;

        if (this._context.overlay.fabric._objects.some(o => {
            return o.presetID === id;
        })) {
            Dialogs.show("This preset belongs to existing annotations: it cannot be removed.",
                8000, Dialogs.MSG_WARN);
            return undefined;
        }
        delete this._presets[id];
        this._context.raiseEvent('preset-delete', {preset: toDelete});
        return toDelete;
    }

    /**
     * Update preset properties
     * @event preset-update
     * @param {string} id preset id
     * @param {object} properties to update in the preset (keys must match)
     * @return updated preset in case any value changed, undefined otherwise
     */
    updatePreset(id, properties) {
        let preset = this._presets[id],
            needsRefresh = false;
        if (!preset) return undefined;

        for (let key in properties) {
            let value = properties[key];

            if (preset.hasOwnProperty(key)) {
                if (preset[key] !== value) {
                    preset[key] = value;
                    needsRefresh = true;
                }
            } else {
                if (preset.meta[key] && preset.meta[key].value !== value) {
                    preset.meta[key].value = value;
                    needsRefresh = true;
                }
            }
        }
        if (needsRefresh) {
            this._context.raiseEvent('preset-update', {preset: preset});
            return preset;
        }
        return undefined;
    }

    /**
     * Add new metadata field to preset
     * @event preset-meta-add
     * @param {string} id preset id
     * @param {string} name new meta field name
     * @param {string} value default value
     * @return {string|undefined} the new meta id, undefined if no preset found
     */
    addCustomMeta(id, name, value) {
        let preset = this._presets[id];
        if (!preset) return undefined;
        let key = "k"+Date.now();
        preset.meta[key] = {
            name: name,
            value: value
        };
        this._context.raiseEvent('preset-meta-add', {preset: preset, key: key});
        return key;
    }

    /**
     * Add new metadata field to preset
     * @event preset-meta-remove
     * @param {string} id preset id
     * @param {string} key meta key
     */
    deleteCustomMeta(id, key) {
        let preset = this._presets[id];
        if (preset && preset.meta[key]) {
            delete preset.meta[key];
            this._context.raiseEvent('preset-meta-remove', {preset: preset, key: key});
            return true;
        }
        return false;
    }

    /**
     * Set common rendering visual property (stroke, opacity...)
     * @param {string} propertyName one of OSDAnnotations.CommonAnnotationVisuals keys
     * @param {any} propertyValue value for the property
     * @return {boolean} true if value changed, false if invalid key
     */
    setCommonVisualProp(propertyName, propertyValue) {
        if (this.commonAnnotationVisuals[propertyName] === undefined) {
            console.error("[setCommonVisualProp] property name not one of", this.presets.constructor.commonAnnotationVisuals, propertyName);
            return false;
        }
        this._context.cache.set('visuals.' + propertyName, propertyValue);
        this.commonAnnotationVisuals[propertyName] = propertyValue;
        return true;
    }

    /**
     * Get annotations visual property
     * @param {string} propertyName one of OSDAnnotations.CommonAnnotationVisuals keys
     * @return {*}
     */
    getCommonVisualProp(propertyName) {
        return this.commonAnnotationVisuals[propertyName];
    }

    /**
     * Iterate call for each preset
     * @param {function} call
     */
    foreach(call) {
        for (let id in this._presets) {
            if (!this._presets.hasOwnProperty(id)) continue;
            call(this._presets[id]);
        }
    }

    /**
     * Export presets
     * @param usedOnly whether to return only subset for which exist annotations
     * @returns {string|[object]} JSON-friendly representation
     */
    toObject(usedOnly=false) {
        let exported = [];
        for (let preset in this._presets) {
            if (!this._presets.hasOwnProperty(preset)) continue;
            preset = this._presets[preset];

            if (!usedOnly || this._context.canvas._objects.some(x => x.presetID === preset.presetID)) {
                exported.push(preset.toJSONFriendlyObject());
            }
        }
        return exported;
    }

    /**
     * Import presets. Upon clearing, the canvas objects should be cleared too
     * (either manually or with the same parameter via export/import options).
     * @param {string|[object]} presets (possibly serialized) array of presets to import
     * @param {boolean} clear true if existing presets should be replaced upon ID match
     * @return {OSDAnnotations.Preset|undefined} preset
     */
    async import(presets, clear=false) {
        const _this = this;

        for (let pid in this._presets) {
            const preset = this._presets[pid];
            // TODO: clear might remove presets that are attached to existing annotations!
            if (clear || this.isUnusedPreset(preset)) {
                this._context.raiseEvent('preset-delete', {preset});
                delete this._presets[pid];
            }
        }

        if (typeof presets === 'string' && presets.length > 10) {
            presets = JSON.parse(presets);
        }

        let first;
        if (Array.isArray(presets)) {
            presets.map(p => OSDAnnotations.Preset.fromJSONFriendlyObject(p, _this._context)).forEach(p => {
                if (!_this._presets.hasOwnProperty(p.presetID)) {
                    _this._context.raiseEvent('preset-create', {preset: p});
                    _this._presets[p.presetID] = p;
                    _this._colorStep++; //generate new colors
                    if (!first) first = p;
                }
            });
        } else {
            throw "Invalid presets data provided as an input for import.";
        }

        this._presetsImported = presets.length > 0;

        const leftPresetId = await this._context.cache.get('presets.left.id', undefined, false);
        const rightPresetId = await this._context.cache.get('presets.right.id', undefined, false);
        if (leftPresetId && (leftPresetId === "__unset__" || this._presets[leftPresetId])) {
            this.selectPreset(leftPresetId, true, false);
        }
        if (rightPresetId && (rightPresetId === "__unset__" || this._presets[rightPresetId])) {
            this.selectPreset(rightPresetId, false, false);
        }

        if (!this.left && first) {
            this.selectPreset(first.presetID, true, false);
        }
        return first;
    }

    /**
     * Select preset as active.
     * @param {string} id preset id
     * @param {boolean} isLeftClick if true, the preset is set as 'left' property, 'right' otherwise
     * @param {boolean} cached
     */
    selectPreset(id, isLeftClick= true, cached= true) {
        let preset = undefined, cachedId = "__unset__";
        if (id) {
            if (!this._presets[id]) return;
            preset = this._presets[id];
            cachedId = preset.presetID;
        }
        if (isLeftClick) {
            this.left = preset;
            if (cached) this._context.cache.set('presets.left.id', cachedId);
        } else {
            this.right = preset;
            if (cached) this._context.cache.set('presets.right.id', cachedId);
        }
        this._context.raiseEvent('preset-select', {preset, isLeftClick});
    }

    _withDynamicOptions(options) {
        const canvas = this._context.canvas,
            zoom = canvas.getZoom(),
            gZoom = canvas.computeGraphicZoom(zoom);

        return $.extend(options, {
            layerID: this._context.getLayer().id,
            zoomAtCreation: zoom,
            strokeWidth: this.commonAnnotationVisuals.originalStrokeWidth / gZoom
        });
    }

    _populateObjectOptions(withPreset) {
        if (!withPreset) {
            console.warn("Attempt to retrieve metadata without a preset!");
            return {};
        }
        if (this.commonAnnotationVisuals.modeOutline) {
            return $.extend({fill: ""},
                this.commonAnnotationVisuals,
                {
                    presetID: withPreset.presetID,
                    stroke: withPreset.color,
                    color: withPreset.color,
                }
            );
        } else {
            //fill is copied as a color and can be potentially changed to more complicated stuff (Pattern...)
            return $.extend({fill: withPreset.color},
                this.commonAnnotationVisuals,
                {
                    presetID: withPreset.presetID,
                    color: withPreset.color,
                }
            );
        }
    }

    randomColorHexString() {
        // from https://stackoverflow.com/questions/1484506/random-color-generator/7419630#7419630
        let r, g, b;
        let h = (this._colorStep++ % this._colorSteps) / this._colorSteps;
        let i = ~~(h * 6);
        let f = h * 6 - i;
        let q = 1 - f;
        switch(i % 6){
            case 0: r = 1; g = f; b = 0; break;
            case 1: r = q; g = 1; b = 0; break;
            case 2: r = 0; g = 1; b = f; break;
            case 3: r = 0; g = q; b = 1; break;
            case 4: r = f; g = 0; b = 1; break;
            case 5: r = 1; g = 0; b = q; break;
        }
        let c = "#" + ("00" + (~ ~(r * 255)).toString(16)).slice(-2)
            + ("00" + (~ ~(g * 255)).toString(16)).slice(-2)
            + ("00" + (~ ~(b * 255)).toString(16)).slice(-2);
        return (c);
    }
};

/**
 * A bit new feature, not really used (still)
 * @type {OSDAnnotations.Layer}
 */
OSDAnnotations.Layer = class {

    /**
     * Constructor
     * @param {OSDAnnotations} context Annotation Plugin Context
     * @param {string} id
     */
    constructor(context, id=String(Date.now())) {
        this._context = context;
        this.id = id;
        this.position = -1;
        this.position = Object.values(this._context._layers)
            .reduce((result, current) => Math.max(result, current.position), 0) + 1;
    }

    /**
     * Set elements of this layer selectable/active
     * not optimal if called for each layer
     * @param {boolean} active
     */
    setActive(active) {
        this.iterate((self, object) => object.selectable = active);
    }

    /**
     * Iterate over all object of this layer
     * @param {function} callback
     */
    iterate(callback) {
        const _this = this;
        this._context.canvas.getObjects().forEach(o => {
            if (o.layerID === _this.id) callback(_this, o);
        });
    }
};
