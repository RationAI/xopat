// noinspection JSUnresolvedVariable

OSDAnnotations.Preset = class {
    /**
     * Preset: object that pre-defines the type of annotation to be created, along with its parameters
     * @param {string} id
     * @param {OSDAnnotations.AnnotationObjectFactory} objectFactory
     * @param {string} category default category meta data
     * @param {string} color fill color
     */
    constructor(id, objectFactory = null, category = "", color = "") {
        this.color = color;
        this.objectFactory = objectFactory;
        this.presetID = id;
        this.meta = {};
        this.meta.category = {
            name: 'Category',
            value: category
        };
    }

    /**
     * Create the object from JSON representation
     * @param {object} parsedObject serialized object, output of toJSONFriendlyObject()
     * @param {function} factoryGetter function able to get object factory from id
     * @return {OSDAnnotations.Preset} instantiated preset
     */
    static fromJSONFriendlyObject(parsedObject, factoryGetter) {
        let factory = factoryGetter(parsedObject.factoryID);
        if (factory === undefined) {
            console.error("Invalid preset type.", parsedObject.factoryID, "of", parsedObject,
                "No factory for such object available.");
            factory = factoryGetter("polygon"); //rely on polygon presence
        }

        const id = typeof parsedObject.presetID === "string" ? parsedObject.presetID : `${parsedObject.presetID}`;
        let preset = new this(id, factory, "", parsedObject.color);
        if (parsedObject.meta) {
            preset.meta = parsedObject.meta;
        }
        return preset;
    }

    /**
     * Convert the preset to JSON-friendly object
     * @return {{color: string, factoryID: string, meta: {}, presetID: string}}
     */
    toJSONFriendlyObject() {
        return {
            color: this.color,
            factoryID: this.objectFactory.factoryId,
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
}; // end of namespace Preset

/**
 * Preset manager, takes care of GUI and management of presets.
 * Provides API to objects to obtain object options. Has left and right
 * attributes that specify what preset is being active for the left or right button respectively.
 */
OSDAnnotations.PresetManager = class {

    /**
     * Shared options, set to each annotation object.
     */
    static _commonProperty = {
        selectable: true,
        originalStrokeWidth: 3,
        borderColor: '#fbb802',
        cornerColor: '#fbb802',
        stroke: 'black',
        borderScaleFactor: 3,
        hasControls: false,
        lockMovementY: true,
        lockMovementX: true,
        hasRotatingPoint: false,
    };

    /**
     * Properties that get exported from annotations by default
     */
    static exportableProperties = [
        'meta', 'borderColor', 'cornerColor', 'borderScaleFactor', 'color', 'presetID',
        'hasControls', 'factoryId', 'sessionId', 'layerId'
    ];

    /**
     * Create Preset Manager
     * @param {string} selfName name of the property 'self' in parent
     * @param {OSDAnnotations} context parent context
     */
    constructor(selfName, context) {
        this._context = context;
        this._presets = {};
        //active presets for mouse buttons
        this.left = undefined;
        this.right = undefined;
        this.modeOutline = APPLICATION_CONTEXT.getOption(`annotation_presets_mode_outline`, true);
        this._colorSteps = 8;
        this._colorStep = 0;
    }

    getActivePreset(isLeftClick) {
        return isLeftClick ? this.left : this.right;
    }

    /**
     * Get data to set as annotation properties (look, metadata...)
     * @param {boolean} isLeftClick true if the data should be with preset data bound to the left mouse button
     * @returns {object} data to populate fabric object with (parameter 'options'
     * in AnnotationObjectFactory::create(..))
     */
    getAnnotationOptions(isLeftClick) {
        let preset = this.getActivePreset(isLeftClick),
            result = this._populateObjectOptions(preset);
        result.isLeftClick = isLeftClick;
        return this._withDynamicOptions(result);
    }

    /**
     * Set annotations to mode filled or outlined
     * @param isOutline true if outlined
     */
    setModeOutline(isOutline) {
        if (this.modeOutline === isOutline) return;
        this.modeOutline = isOutline;
        APPLICATION_CONTEXT.setOption(`annotation_presets_mode_outline`, isOutline, true);
        this.updateAllObjectsVisuals();
        this._context.canvas.requestRenderAll();
    }

    getModeOutline() {
        return this.modeOutline;
    }

    /**
     * Add new preset with default values
     * @event preset-create
     * @returns {OSDAnnotations.Preset} newly created preset
     */
    addPreset() {
        let preset = new OSDAnnotations.Preset(Date.now().toString(), this._context.polygonFactory, "", this._randomColorHexString());
        this._presets[preset.presetID] = preset;
        this._context.raiseEvent('preset-create', {preset: preset});
        return preset;
    }

    /**
     * Alias for static _commonProperty
     * @param {OSDAnnotations.Preset} withPreset
     */
    getCommonProperties(withPreset=undefined) {
        if (withPreset) {
            return this._withDynamicOptions(this._populateObjectOptions(withPreset));
        }
        return this._withDynamicOptions(this.constructor._commonProperty);
    }

    /**
     * Check if preset exists
     * @param {number} id preset id
     * @returns true if exists
     */
    exists(id) {
        return this._presets.hasOwnProperty(id);
    }

    /**
     * Presets getter
     * @param {number} id preset id
     * @returns {OSDAnnotations.Preset} preset instance
     */
    get(id) {
        return this._presets[id];
    }

    /**
     * Safely remove preset
     * @event preset-delete
     * @param {number} id preset id
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
     * @param {number} id preset id
     * @param {object} properties to update in the preset (keys must match)
     * @return updated preset in case any value changed, false otherwise
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
        if (needsRefresh) this._context.raiseEvent('preset-update', {preset: preset});
        return needsRefresh ? preset : undefined;
    }

    /**
     * Correctly and safely reflect object appearance based on mode
     * @param object object to update
     * @param withPreset preset that obect belongs to
     */
    updateObjectVisuals(object, withPreset) {
        const factory = this._context.getAnnotationObjectFactory(object.factoryId);
        factory.updateRendering(this.modeOutline, object, withPreset.color, this.constructor._commonProperty.stroke);
    }

    /**
     * Update all object visuals
     */
    updateAllObjectsVisuals() {
        this._context.canvas.getObjects().forEach(o => {
            let preset = this.get(o.presetID);
            if (preset) this.updateObjectVisuals(o, preset);
        });
    }

    /**
     * Add new metadata field to preset
     * @event preset-meta-add
     * @param {string} id preset id
     * @param {string} name new meta field name
     * @param {string} value default value
     * @return {string} the new meta id
     */
    addCustomMeta(id, name, value) {
        let preset = this._presets[id];
        let key = "k"+Date.now();
        preset.meta[key] = {
            name: name,
            value: value
        };
        this._context.raiseEvent('preset-meta-add', {preset: preset});
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
            return true;
        }
        this._context.raiseEvent('preset-meta-remove', {preset: preset});
        return false;
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
     * @returns {[object]} JSON-friendly representation
     */
    toObject() {
        let exported = [];
        for (let preset in this._presets) {
            if (!this._presets.hasOwnProperty(preset)) continue;
            preset = this._presets[preset];
            exported.push(preset.toJSONFriendlyObject());
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
    import(presets, clear=false) {
        const _this = this;

        if (clear) {
            Object.values(this._presets).forEach(p => _this.raiseEvent('preset-delete', {preset: p}));

            this._presets = {};
        }
        let first = undefined;

        if (typeof presets === 'string' && presets.length > 10) {
            presets = JSON.parse(presets);
        }

        if (Array.isArray(presets)) {
            presets.map(p => OSDAnnotations.Preset.fromJSONFriendlyObject(
                p, _this._context.getAnnotationObjectFactory.bind(_this._context)
            )).forEach(p => {
                if (clear || ! _this._presets.hasOwnProperty(p.presetID)) {
                    _this._context.raiseEvent('preset-create', {preset: p});
                    _this._presets[p.presetID] = p;
                    if (!first) first = p;
                }
            });
        } else {
            throw "Invalid presets data provided as an input for import.";
        }
        return first;
    }

    /**
     * Select preset as active.
     * @param {number} id preset id
     * @param {boolean} isLeftClick if true, the preset is set as 'left' property, 'right' otherwise
     */
    selectPreset(id, isLeftClick) {
        if (!this._presets[id]) return;
        if (isLeftClick) this.left = this._presets[id];
        else this.right = this._presets[id];
    }

    _withDynamicOptions(options) {
        let zoom = this._context.canvas.getZoom();
        return $.extend(options, {
            layerId: this._context.getLayer().id,
            opacity: this._context.getOpacity(),
            zoomAtCreation: zoom,
            strokeWidth: 3 / zoom
        });
    }

    _populateObjectOptions(withPreset) {
        if (this.modeOutline) {
            return $.extend({fill: ""},
                OSDAnnotations.PresetManager._commonProperty,
                {
                    presetID: withPreset.presetID,
                    stroke: withPreset.color,
                    color: withPreset.color,
                }
            );
        } else {
            //fill is copied as a color and can be potentially changed to more complicated stuff (Pattern...)
            return $.extend({fill: withPreset.color},
                OSDAnnotations.PresetManager._commonProperty,
                {
                    presetID: withPreset.presetID,
                    color: withPreset.color,
                }
            );
        }
    }

    _randomColorHexString() {
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
     * @param {number} id
     */
    constructor(context, id=Date.now()) {
        this._context = context;
        this.id = id;

        this.position = -1;
        for (let id in context._layers) {
            this.position = Math.max(this.position, context._layers[id]);
        }
        this.position++;
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
            if (o.layerId === _this.id) callback(_this, o);
        });
    }
};
