// noinspection JSUnresolvedVariable

OSDAnnotations.Preset = class {
    /**
     * Preset: object that pre-defines the type of annotation to be created, along with its parameters
     * @param {number} id
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
        let preset = new this(parsedObject.presetID, factory, "", parsedObject.color);
        preset.meta = parsedObject.meta || {};
        return preset;
    }

    /**
     * Convert the preset to JSON-friendly object
     * @return {{color: string, factoryID: string, meta: {}, presetID: number}}
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

    /**
     * Get data to set as annotation properties (look, metadata...)
     * @param {boolean} isLeftClick true if the data should be with preset data bound to the left mouse button
     * @returns {object} data to populate fabric object with (parameter 'options'
     * in AnnotationObjectFactory::create(..))
     */
    getAnnotationOptions(isLeftClick) {
        let preset = isLeftClick ? this.left : this.right,
            result = this._populateObjectOptions(preset);
        result.isLeftClick = isLeftClick;
        return result;
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
        let preset = new OSDAnnotations.Preset(Date.now(), this._context.polygonFactory, "", this._randomColorHexString());
        this._presets[preset.presetID] = preset;
        this._context.raiseEvent('preset-create', {preset: preset});
        return preset;
    }

    /**
     * Alias for static _commonProperty
     * @param {OSDAnnotations.Preset} preset
     */
    getCommonProperties(withPreset) {
        if (withPreset) {
            return this._populateObjectOptions(withPreset);
        }
        return this.constructor._commonProperty;
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
        if (typeof object.fill === 'string') {
            if (this.modeOutline) {
                object.set({
                    fill: "",
                    stroke: withPreset.color
                });
            } else {
                object.set({
                    fill: withPreset.color,
                    stroke: this.constructor._commonProperty.stroke
                });
            }
        }
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
     * @returns {object} JSON-friendly representation
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
     * Export presets
     * @returns {string} JSON-encoded string
     */
    export() {
        return JSON.stringify(this.toObject());
    }

    /**
     * Import presets
     * @param {string|object} presets JSON to decode
     * @param {boolean} overwrite true if existing presets should be replaced upon ID match
     * @return {OSDAnnotations.Preset|undefined} preset
     */
    import(presets, overwrite=false) {
        this._presets = {};
        let first;

        if (typeof presets === 'string' && presets.length > 10) {
            presets = JSON.parse(presets);
        }

        if (typeof presets === 'object') {
            for (let i = 0; i < presets.length; i++) {
                let p = OSDAnnotations.Preset.fromJSONFriendlyObject(
                    presets[i], this._context.getAnnotationObjectFactory.bind(this._context)
                );
                if (overwrite || ! this._presets.hasOwnProperty(p.presetID)) {
                    this._presets[p.presetID] = p;
                    if (!first) first = p;
                }
            }
        } else {
            first = this.addPreset();
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

    _populateObjectOptions(withPreset) {
        let zoom = this._context.canvas.getZoom();
        if (this.modeOutline) {
            return $.extend({fill: ""},
                OSDAnnotations.PresetManager._commonProperty,
                {
                    presetID: withPreset.presetID,
                    layerId: this._context.getLayer().id,
                    opacity: this._context.getOpacity(),
                    stroke: withPreset.color,
                    zoomAtCreation: zoom,
                    strokeWidth: 3 / zoom
                }
            );
        } else {
            //fill is copied as a color and can be potentially changed to more complicated stuff (Pattern...)
            return $.extend({fill: withPreset.color},
                OSDAnnotations.PresetManager._commonProperty,
                {
                    presetID: withPreset.presetID,
                    layerId: this._context.getLayer().id,
                    opacity: this._context.getOpacity(),
                    zoomAtCreation: zoom,
                    strokeWidth: 3 / zoom
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

/**
 * It is more an interface rather than actual class.
 * Any annotation object should extend this class and implement
 * necessary methods for its creation.
 */
OSDAnnotations.AnnotationObjectFactory = class {

    /**
     * Constructor
     * @param {OSDAnnotations} context Annotation Plugin Context
     * @param {AutoObjectCreationStrategy} autoCreationStrategy or an object of similar interface
     * @param {PresetManager} presetManager manager of presets or an object of similar interface
     * @param {string} identifier unique annotation identifier, start with '_' to avoid exporting
     *   - note that for now the export avoidance woks only for XML exports, JSON will include all
     * @param {string} objectType which shape type it maps to inside fabricJS
     */
    constructor(context, autoCreationStrategy, presetManager, identifier, objectType) {
        this._context = context;
        this._presets = presetManager;
        this._auto = autoCreationStrategy;
        this.factoryId = identifier;
        this.type = objectType;
    }

    /**
     * Get icon for the object
     * @returns {string} pluggable to current icon system (see https://fonts.google.com/icons?selected=Material+Icons)
     */
    getIcon() {
        return "yard";
    }

    /**
     * Some annotation objects might not allow to be edited (e.g. images), specify here
     * @return {boolean}
     */
    isEditable() {
        return true;
    }

    /**
     * Get icon for the object
     * @param {fabric.Object} ofObject object to describe
     * @returns {string} pluggable to current icon system (see https://fonts.google.com/icons?selected=Material+Icons)
     */
    getDescription(ofObject) {
        return "Generic object.";
    }

    /**
     * Get currently eddited object
     * @returns
     */
    getCurrentObject() {
        return null;
    }

    /**
     * Create an annotation object from given parameters, used mostly privately
     * @param {*} parameters geometry, depends on the object type
     * @param {object} options FbaricJS and custom options to set
     * @returns
     */
    create(parameters, options) {
        return null;
    }

    /**
     * Create copy of an object
     * @param {fabric.Object} ofObject object to copy
     * @param {*} parameters internal variable, should not be used
     * @returns
     */
    copy(ofObject, parameters=undefined) {
        return null;
    }


    /**
     * Create an object at given point with a given strategy
     * @param {OpenSeadragon.Point} screenPoint mouse coordinates (X|Y) in SCREEN coordinates
     *  that this is an exception, other methods work with image coord system
     * @param {boolean} isLeftClick true if the object was created using left mouse button
     * @return {boolean} true if creation succeeded
     */
    instantCreate(screenPoint, isLeftClick) {
        return false;
    }

    /**
     * Objects created by smaller than x MS click-drag might be invalid, define how long drag event must last
     * @returns {number} time in MS how long (at least) the drag event should last for object to be created
     */
    getCreationRequiredMouseDragDurationMS() {
        return 100;
    }

    /**
     * Get bounding box of an object - used to focus the screen on.
     */
    getObjectFocusZone(ofObject) {
       return ofObject.getBoundingRect(true, true);
    }

    /**
     * Initialize the object manual creation
     * @param {Number} x x-coordinate of the action origin, in image space
     * @param {Number} y y-coordinate of the action origin, in image space
     * @param {boolean} isLeftClick true if the object was created using left mouse button
     */
    initCreate(x, y, isLeftClick = true) {
    }

    /**
     * Update the object during manual creation
     * @param {Number} x x-coordinate of the action origin, in image space
     * @param {Number} y y-coordinate of the action origin, in image space
     */
    updateCreate(x, y) {
    }


    /**
     * Update the object coordinates by user interaction
     * @param {fabric.Object} theObject recalculate the object that has been modified
     */
    edit(theObject) {
    }

    /**
     * Update the object coordinates by finishing edit() call (this is guaranteed to happen at least once before)
     * @param {fabric.Object} theObject recalculate the object that has been modified
     */
    recalculate(theObject) {
    }

    /**
     * Finish object creation, if in progress. Can be called also if no object
     * is being created. This action was performed directly by the user.
     */
    finishDirect() {
    }

    /**
     * Finish object creation, if in progress. Can be called also if no object
     * is being created. This action was enforced by the environment (i.e.
     * performed by the user indirectly).
     */
    finishIndirect() {
    }

    /**
     * Called when object is selected
     * @param {fabric.Object} theObject selected fabricjs object
     */
    selected(theObject) {
    }

    getASAP_XMLTypeName() {
        return "Generic Object";
    }

    /**
     * If the object is defined implicitly (e.g. control points + formula)
     * if returns false, a 'points' property of the object should exist where its shape is stored
     * @returns {boolean} true if the shape is not an explicit point array
     */
    isImplicit() {
        return true;
    }

    /**
     * Create array of points - approximation of the object shape
     * @param {fabric.Object} obj object that is being approximated
     * @param {function} converter take two elements and convert and return item, see
     *  withObjectPoint, withArrayPoint
     * @param {Number} quality between 0 and 1, of the approximation in percentage (1 = 100%)
     * @return {Array} array of items returned by the converter - points
     */
    toPointArray(obj, converter, quality=1) {
    }

    /**
     * Strategy convertor, passed to toPointArray method, creates points as objects
     */
    static withObjectPoint(x, y) {
        return {x: x, y: y};
    }
    /**
     * Strategy convertor, passed to toPointArray method, creates points as 2d arrays
     */
    static withArrayPoint(x, y) {
        return [x, y];
    }
};

OSDAnnotations.Rect = class extends OSDAnnotations.AnnotationObjectFactory {
    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "rect", "rect");
        this._origX = null;
        this._origY = null;
        this._current = null;
    }

    getIcon() {
        return "crop_5_4";
    }

    getDescription(ofObject) {
        return `Rect [${Math.round(ofObject.left)}, ${Math.round(ofObject.top)}]`;
    }

    getCurrentObject() {
        return this._current;
    }

    /**
     * @param {Object} parameters object of the following properties:
     *              - left: offset in the image dimension
     *              - top: offset in the image dimension
     *              - rx: major axis radius
     *              - ry: minor axis radius
     * @param {Object} options see parent class
     */
    create(parameters, options) {
        return new fabric.Rect($.extend({
            scaleX: 1,
            scaleY: 1,
            type: this.type,
            factoryId: this.factoryId
        }, parameters, options));
    }

    /**
     * @param {Object} ofObject fabricjs.Rect object that is being copied
     * @param {Object} parameters object of the following properties:
     *              - left: offset in the image dimension
     *              - top: offset in the image dimension
     *              - width: rect width
     *              - height: rect height
     */
    copy(ofObject, parameters=undefined) {
        if (!parameters) parameters = ofObject;
        return new fabric.Rect({
            left: parameters.left,
            top: parameters.top,
            width: parameters.width,
            height: parameters.height,
            fill: ofObject.fill,
            isLeftClick: ofObject.isLeftClick,
            opacity: ofObject.opacity,
            strokeWidth: ofObject.strokeWidth,
            stroke: ofObject.stroke,
            scaleX: ofObject.scaleX,
            scaleY: ofObject.scaleY,
            zoomAtCreation: ofObject.zoomAtCreation,
            originalStrokeWidth: ofObject.originalStrokeWidth,
            type: ofObject.type,
            factoryId: ofObject.factoryId,
            hasRotatingPoint: ofObject.hasRotatingPoint,
            borderColor: ofObject.borderColor,
            cornerColor: ofObject.cornerColor,
            borderScaleFactor: ofObject.borderScaleFactor,
            hasControls: ofObject.hasControls,
            lockMovementX: ofObject.lockMovementX,
            lockMovementY: ofObject.lockMovementY,
            meta: ofObject.meta,
            presetID: ofObject.presetID,
            layerId: ofObject.layerId
        });
    }

    edit(theObject) {
        this._left = theObject.left;
        this._top = theObject.top;
        theObject.set({
            hasControls: true,
            lockMovementX: false,
            lockMovementY: false
        });
    }

    recalculate(theObject) {
        let height = theObject.getScaledHeight(),
            width = theObject.getScaledWidth(),
            left = theObject.left,
            top = theObject.top;
        theObject.set({ left: this._left, top: this._top, scaleX: 1, scaleY: 1,
            hasControls: false, lockMovementX: true, lockMovementY: true});
        let newObject = this.copy(theObject, {
            left: left, top: top, width: width, height: height
        });
        theObject.calcACoords();
        this._context.replaceAnnotation(theObject, newObject, true);
    }

    instantCreate(screenPoint, isLeftClick = true) {
        let bounds = this._auto.approximateBounds(screenPoint);
        if (bounds) {
            this._context.addAnnotation(this.create({
                left: bounds.left.x,
                top: bounds.top.y,
                width: bounds.right.x - bounds.left.x,
                height: bounds.bottom.y - bounds.top.y
            }, this._presets.getAnnotationOptions(isLeftClick)));
            return true;
        }
        return false;
    }

    initCreate(x, y, isLeftClick) {
        this._origX = x;
        this._origY = y;
        this._current = this.create({
            left: x,
            top: y,
            width: 1,
            height: 1
        }, this._presets.getAnnotationOptions(isLeftClick));
        this._context.addHelperAnnotation(this._current);
    }

    updateCreate(x, y) {
        if (!this._current) return;
        if (this._origX > x) this._current.set({ left: x });
        if (this._origY > y) this._current.set({ top: y });

        let width = Math.abs(x - this._origX);
        let height = Math.abs(y - this._origY);
        this._current.set({ width: width, height: height });
    }

    finishDirect() {
        let obj = this.getCurrentObject();
        if (!obj) return;
        //todo fix? just promote did not let me to select the object this._context.promoteHelperAnnotation(obj);
        this._context.deleteHelperAnnotation(obj);
        this._context.addAnnotation(obj);
        this._current = undefined;
    }

    /**
     * Create array of points - approximation of the object shape
     * @param {Object} obj fabricJS.Rect obj object that is being approximated
     * @param {function} converter take two elements and convert and return item
     * @param {Number} quality between 0 and 1, of the approximation in percentage (1 = 100%)
     * @return {Array} array of items returned by the converter - points
     */
    toPointArray(obj, converter, quality=1) {
        let w = obj.width, h = obj.height;
        return [
            converter(obj.left, obj.top),
            converter(obj.left + w, obj.top),
            converter(obj.left + w, obj.top + h),
            converter(obj.left, obj.top + h)
        ];
    }

    getASAP_XMLTypeName() {
        return "Rectangle";
    }


};

OSDAnnotations.Ruler = class extends OSDAnnotations.AnnotationObjectFactory {
    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "ruler", "group");
        this._current = null;
    }

    getIcon() {
        return "square_foot";
    }

    getDescription(ofObject) {
        return `Length ${Math.round(ofObject.measure)} mm`;
    }

    getCurrentObject() {
        return this._current;
    }

    isEditable() {
        return false;
    }

    /**
     * @param {array} parameters array of line points [x, y, x, y ..]
     * @param {Object} options see parent class
     */
    create(parameters, options) {
        let parts = this._createParts(parameters, options);
        return this._createWrap(parts, options);
    }

    /**
     * @param {Object} ofObject fabricjs.Line object that is being copied
     * @param {array} parameters array of line points [x, y, x, y ..]
     */
    copy(ofObject, parameters=undefined) {
        let line = ofObject.item(0),
            text = ofObject.item(1);
        if (!parameters) parameters = [line.x1, line.y1, line.x2, line.y2];
        return new fabric.Group([fabric.Line(parameters, {
            fill: line.fill,
            opacity: line.opacity,
            strokeWidth: line.strokeWidth,
            stroke: line.stroke,
            scaleX: line.scaleX,
            scaleY: line.scaleY,
            hasRotatingPoint: line.hasRotatingPoint,
            borderColor: line.borderColor,
            cornerColor: line.cornerColor,
            borderScaleFactor: line.borderScaleFactor,
            hasControls: line.hasControls,
            lockMovementX: line.lockMovementX,
            lockMovementY: line.lockMovementY,
            originalStrokeWidth: line.originalStrokeWidth,
            selectable: false,
        }), new fabric.Text(text.text), {
            textBackgroundColor: text.textBackgroundColor,
            fontSize: text.fontSize,
            lockUniScaling: true,
            scaleY: text.scaleY,
            scaleX: text.scaleX,
            selectable: false,
            hasControls: false,
            stroke: text.stroke,
            fill: text.fill,
            paintFirst: 'stroke',
            strokeWidth: text.strokeWidth,
        }], {
            presetID: ofObject.presetID,
            measure: ofObject.measure,
            meta: ofObject.meta,
            factoryId: ofObject.factoryId,
            isLeftClick: ofObject.isLeftClick,
            type: ofObject.type,
            layerId: ofObject.layerId,
            fill: ofObject.fill,
            zoomAtCreation: ofObject.zoomAtCreation,
            selectable: false,
            hasControls: false
        });
    }

    edit(theObject) {
        //not allowed
    }

    recalculate(theObject) {
        //not supported error?
    }

    instantCreate(screenPoint, isLeftClick = true) {
        let bounds = this._auto.approximateBounds(screenPoint, false);
        if (bounds) {
            let opts = this._presets.getAnnotationOptions(isLeftClick);
            let object = this.create([bounds.left.x, bounds.top.y, bounds.right.x, bounds.bottom.y], opts);
            this._context.addAnnotation(object);
            return true;
        }
        return false;
    }

    initCreate(x, y, isLeftClick) {
        let opts = this._presets.getAnnotationOptions(isLeftClick);
        let parts = this._createParts([x, y, x, y], opts);
        this._updateText(parts[0], parts[1]);
        this._current = parts;
        this._context.addHelperAnnotation(this._current[0]);
        this._context.addHelperAnnotation(this._current[1]);

    }

    updateCreate(x, y) {
        if (!this._current) return;
        let line = this._current[0],
            text = this._current[1];
        line.set({ x2: x, y2: y });
        this._updateText(line, text);
    }

    finishDirect() {
        let obj = this.getCurrentObject();
        if (!obj) return;
        this._context.deleteHelperAnnotation(obj[0]);
        this._context.deleteHelperAnnotation(obj[1]);

        obj = this._createWrap(obj, this._presets.getCommonProperties());
        this._context.addAnnotation(obj);
        this._current = undefined;
    }

    /**
     * Create array of points - approximation of the object shape
     * @return {undefined} not supported, ruler cannot be turned to polygon
     */
    toPointArray(obj, converter, quality=1) {
        return undefined;
    }

    getASAP_XMLTypeName() {
        return "Ruler";
    }

    _getWithUnit(value, unitSuffix) {
        if (value < 0.000001) {
            return value * 1000000000 + " n" + unitSuffix;
        }
        if (value < 0.001) {
            return value * 1000000 + " μ" + unitSuffix;
        }
        if (value < 1) {
            return value * 1000 + " m" + unitSuffix;
        }
        if (value >= 1000) {
            return value / 1000 + " k" + unitSuffix;
        }
        return value + " " + unitSuffix;
    }

    _updateText(line, text) {
        let microns = APPLICATION_CONTEXT.getOption("microns") ?? -1;
        let d = Math.sqrt(Math.pow(line.x1 - line.x2, 2) + Math.pow(line.y1 - line.y2, 2)),
            strText;
        if (microns > 0) {
            strText = this._getWithUnit(
                Math.round(d * microns / 10000000) / 100, "m"
            );
        } else {
            strText = Math.round(d) + " px";
        }
        text.set({text: strText, left: (line.x1 + line.x2) / 2, top: (line.y1 + line.y2) / 2});
    }

    _createParts(parameters, options) {
        options.stroke = options.fill || options.stroke;
        return [new fabric.Line(parameters, $.extend({
            scaleX: 1,
            scaleY: 1,
            selectable: false,
            hasControls: false,
        }, options)), new fabric.Text('', {
            fontSize: 16,
            selectable: false,
            hasControls: false,
            lockUniScaling: true,
            stroke: 'white',
            fill: 'black',
            paintFirst: 'stroke',
            strokeWidth: 2,
            scaleX: 1/options.zoomAtCreation,
            scaleY: 1/options.zoomAtCreation
        })];
    }

    _createWrap(parts, options) {
        this._updateText(parts[0], parts[1]);
        return new fabric.Group(parts, $.extend({
            factoryId: this.factoryId,
            type: this.type,
            measure: 0,
            fill: parts[0].fill
        }, options));
    }
};

OSDAnnotations.Ellipse = class extends OSDAnnotations.AnnotationObjectFactory {
    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "ellipse", "ellipse");
        this._origX = null;
        this._origY = null;
        this._current = null;
    }

    getIcon() {
        return "lens";
    }

    getDescription(ofObject) {
        return `Ellipse [${Math.round(ofObject.left)}, ${Math.round(ofObject.top)}]`;
    }

    getCurrentObject() {
        return this._current;
    }

    /**
     *
     * @param {Object} parameters object of the following properties:
     *              - left: offset in the image dimension
     *              - top: offset in the image dimension
     *              - rx: major axis radius
     *              - ry: minor axis radius
     * @param {Object} options see parent class
     */
    create(parameters, options) {
        return new fabric.Ellipse($.extend({
            originX: 'left',
            originY: 'top',
            angle: 0,
            scaleX: 1,
            scaleY: 1,
            type: this.type,
            factoryId: this.factoryId
        }, parameters, options));
    }

    /**
     * @param {Object} ofObject fabricjs.Ellipse object that is being copied
     * @param {Object} parameters object of the following properties:
     *              - left: offset in the image dimension
     *              - top: offset in the image dimension
     *              - rx: major axis radius
     *              - ry: minor axis radius
     */
    copy(ofObject, parameters=undefined) {
        if (!parameters) parameters = ofObject;
        return new fabric.Ellipse({
            left: parameters.left,
            top: parameters.top,
            rx: parameters.rx,
            ry: parameters.ry,
            originX: ofObject.originX,
            originY: ofObject.originY,
            angle: ofObject.angle,
            fill: ofObject.fill,
            stroke: ofObject.stroke,
            strokeWidth: ofObject.strokeWidth,
            opacity: ofObject.opacity,
            scaleX: ofObject.scaleX,
            scaleY: ofObject.scaleY,
            zoomAtCreation: ofObject.zoomAtCreation,
            originalStrokeWidth: ofObject.originalStrokeWidth,
            type: ofObject.type,
            factoryId: ofObject.factoryId,
            isLeftClick: ofObject.isLeftClick,
            selectable: ofObject.selectable,
            hasRotatingPoint: ofObject.hasRotatingPoint,
            borderColor: ofObject.borderColor,
            cornerColor: ofObject.cornerColor,
            borderScaleFactor: ofObject.borderScaleFactor,
            hasControls: ofObject.hasControls,
            lockMovementX: ofObject.lockMovementX,
            lockMovementY: ofObject.lockMovementY,
            meta: ofObject.meta,
            presetID: ofObject.presetID,
            layerId: ofObject.layerId
        });
    }

    edit(theObject) {
        this._left = theObject.left;
        this._top = theObject.top;
        theObject.set({
            hasControls: true,
            lockMovementX: false,
            lockMovementY: false
        });
    }

    recalculate(theObject) {
        let rx = theObject.rx * theObject.scaleX,
            ry = theObject.ry * theObject.scaleY,
            left = theObject.left,
            top = theObject.top;
        theObject.set({ left: this._left, top: this._top, scaleX: 1, scaleY: 1,
            hasControls: false, lockMovementX: true, lockMovementY: true});
        let newObject = this.copy(theObject, {
            left: left, top: top, rx: rx, ry: ry
        });
        theObject.calcACoords();
        this._context.replaceAnnotation(theObject, newObject, true);
    }

    instantCreate(screenPoint, isLeftClick = true) {
        let bounds = this._auto.approximateBounds(screenPoint);
        if (bounds) {
            this._context.addAnnotation(this.create({
                left: bounds.left.x,
                top: bounds.top.y,
                rx: (bounds.right.x - bounds.left.x) / 2,
                ry: (bounds.bottom.y - bounds.top.y) / 2
            }, this._presets.getAnnotationOptions(isLeftClick)));
            return true;
        }
        return false;
    }

    initCreate(x, y, isLeftClick = true) {
        this._origX = x-1;
        this._origY = y-1;
        this._current = this.create({
            left: x-1,
            top: y-1,
            rx: 1,
            ry: 1
        }, this._presets.getAnnotationOptions(isLeftClick));
        this._context.addHelperAnnotation(this._current);
    }

    updateCreate(x, y) {
        if (!this._current) return;
        let width = Math.abs(x - this._origX);
        let height = Math.abs(y - this._origY);
        this._current.set({
            left:this._origX - width,
            top:this._origY - height,
            rx: width, ry: height
        });
    }

    finishDirect() {
        let obj = this.getCurrentObject();
        if (!obj) return;
        //todo fix? just promote did not let me to select the object this._context.promoteHelperAnnotation(obj);
        this._context.deleteHelperAnnotation(obj);
        this._context.addAnnotation(obj);
        this._current = undefined;
    }

    /**
     * Create array of points - approximation of the object shape
     * @param {fabric.Ellipse} obj object that is being approximated
     * @param {function} converter take two elements and convert and return item
     * @param {Number} quality between 0 and 1, of the approximation in percentage (1 = 100%)
     * @return {Array} array of items returned by the converter - points
     */
    toPointArray(obj, converter, quality=1) {
        //see https://math.stackexchange.com/questions/2093569/points-on-an-ellipse
        //formula author https://math.stackexchange.com/users/299599/ng-chung-tak
        let reversed = obj.rx < obj.ry, //since I am using sqrt, need rx > ry
            rx = reversed ? obj.ry : obj.rx,
            ry = reversed ? obj.rx : obj.ry,
            pow2e = 1 - (ry * ry) / (rx * rx),
            pow3e = pow2e * Math.sqrt(pow2e),
            pow4e = pow2e * pow2e,
            pow6e = pow3e * pow3e;

        //lets interpret the quality of approximation by number of points generated, 100% = 30 points
        let step = Math.PI / (30*quality), points = [];

        for (let t = 0; t < 2 * Math.PI; t += step) {
            let param = t - (pow2e / 8 + pow4e / 16 + 71 * pow6e / 2048) * Math.sin(2 * t)
                + ((5 * pow4e + 5 * pow6e) / 256) * Math.sin(4 * t)
                + (29 * pow6e / 6144) * Math.sin(6 * t);
            if (reversed) {
                points.push(converter(ry * Math.sin(param) + obj.left + ry, rx * Math.cos(param) + obj.top + rx));
            } else {
                points.push(converter(rx * Math.cos(param) + obj.left + rx, ry * Math.sin(param) + obj.top + ry));
            }
        }
        return points;
    }

    getASAP_XMLTypeName() {
        return "Ellipse";
    }
};

OSDAnnotations.Polygon = class extends OSDAnnotations.AnnotationObjectFactory {

    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "polygon", "polygon");
        this._initialize(false);
    }

    getIcon() {
        return "share";
    }

    getDescription(ofObject) {
        return `Polygon [${Math.round(ofObject.left)}, ${Math.round(ofObject.top)}]`;
    }

    getCurrentObject() {
        return (this._current /*|| this._edited*/);
    }

    /**
     * @param {Array} parameters array of objects with {x, y} properties (points)
     * @param {Object} options see parent class
     */
    create(parameters, options) {
        return new fabric.Polygon(parameters, $.extend({
            type: this.type,
            factoryId: this.factoryId
        }, options));
    }

    /**
     * @param {Object} ofObject fabricjs.Polygon object that is being copied
     * @param {Array} parameters array of points: {x, y} objects
     */
    copy(ofObject, parameters) {
        return new fabric.Polygon(parameters, {
            hasRotatingPoint: ofObject.hasRotatingPoint,
            fill: ofObject.fill,
            stroke: ofObject.stroke,
            strokeWidth: ofObject.strokeWidth,
            isLeftClick: ofObject.isLeftClick,
            opacity: ofObject.opacity,
            type: ofObject.type,
            scaleX: ofObject.scaleX,
            scaleY: ofObject.scaleY,
            zoomAtCreation: ofObject.zoomAtCreation,
            originalStrokeWidth: ofObject.originalStrokeWidth,
            factoryId: ofObject.factoryId,
            selectable: ofObject.selectable,
            borderColor: ofObject.borderColor,
            cornerColor: ofObject.cornerColor,
            borderScaleFactor: ofObject.borderScaleFactor,
            meta: ofObject.meta,
            hasControls: ofObject.hasControls,
            lockMovementX: ofObject.lockMovementX,
            lockMovementY: ofObject.lockMovementY,
            presetID: ofObject.presetID,
            layerId: ofObject.layerId
        });
    }

    edit(theObject) {
        this._origPoints = [...theObject.points];
        this._context.canvas.setActiveObject(theObject);

        var lastControl = theObject.points.length - 1;
        const _this = this;
        theObject.cornerStyle = 'circle';
        theObject.cornerColor = '#fbb802';
        theObject.hasControls = true;
        theObject.objectCaching = false;
        theObject.transparentCorners = false;
        theObject.controls = theObject.points.reduce(function(acc, point, index) {
            acc['p' + index] = new fabric.Control({
                positionHandler: _this._polygonPositionHandler,
                actionHandler: _this._anchorWrapper(index > 0 ? index - 1 : lastControl, _this._actionHandler),
                actionName: 'modifyPolygon',
                pointIndex: index
            });
            return acc;
        }, { });
        this._context.canvas.renderAll();
    }

    _polygonPositionHandler(dim, finalMatrix, fabricObject) {
        var x = (fabricObject.points[this.pointIndex].x - fabricObject.pathOffset.x),
            y = (fabricObject.points[this.pointIndex].y - fabricObject.pathOffset.y);
        return fabric.util.transformPoint(
            { x: x, y: y },
            fabric.util.multiplyTransformMatrices(
                fabricObject.canvas.viewportTransform,
                fabricObject.calcTransformMatrix()
            )
        );
    }

    _actionHandler(eventData, transform, x, y) {
        var polygon = transform.target,
            mouseLocalPosition = polygon.toLocalPoint(new fabric.Point(x, y), 'center', 'center'),
            polygonBaseSize = polygon._getNonTransformedDimensions(),
            size = polygon._getTransformedDimensions(0, 0);
        polygon.points[polygon.controls[polygon.__corner].pointIndex] = {
            x: mouseLocalPosition.x * polygonBaseSize.x / size.x + polygon.pathOffset.x,
            y: mouseLocalPosition.y * polygonBaseSize.y / size.y + polygon.pathOffset.y
        };
        return true;
    }

    _anchorWrapper(anchorIndex, fn) {
        return function(eventData, transform, x, y) {
            let fabricObject = transform.target,
                absolutePoint = fabric.util.transformPoint({
                    x: (fabricObject.points[anchorIndex].x - fabricObject.pathOffset.x),
                    y: (fabricObject.points[anchorIndex].y - fabricObject.pathOffset.y),
                }, fabricObject.calcTransformMatrix()),
                actionPerformed = fn(eventData, transform, x, y);
            fabricObject._setPositionDimensions({});
            let polygonBaseSize = fabricObject._getNonTransformedDimensions(),
                newX = (fabricObject.points[anchorIndex].x - fabricObject.pathOffset.x) / polygonBaseSize.x,
                newY = (fabricObject.points[anchorIndex].y - fabricObject.pathOffset.y) / polygonBaseSize.y;
            fabricObject.setPositionByOrigin(absolutePoint, newX + 0.5, newY + 0.5);
            return actionPerformed;
        }
    }

    recalculate(theObject) {
        theObject.controls = fabric.Object.prototype.controls;
        theObject.hasControls = false;
        theObject.strokeWidth = this._presets.getCommonProperties().strokeWidth;

        if (!theObject.points.every(
            (value, index) => value === this._origPoints[index])) {
            let newObject = this.copy(theObject, theObject.points);
            theObject.points = this._origPoints;
            this._context.replaceAnnotation(theObject, newObject, true);
            this._context.canvas.renderAll();
        }
        this._origPoints = null;
        this._initialize(false);
    }

    instantCreate(screenPoint, isLeftClick = true) {
        const _this = this;
        //(async function _() {
        let result = /*await*/ _this._auto.createOutline(screenPoint);

        if (!result || result.length < 3) return false;
        result = OSDAnnotations.PolygonUtilities.simplify(result);
        _this._context.addAnnotation(
            _this.create(result, _this._presets.getAnnotationOptions(isLeftClick))
        );
        return true;
        //})();
    }

    getCreationRequiredMouseDragDurationMS() {
        return -1; //always allow
    }

    initCreate(x, y, isLeftClick = true) {
        if (!this._polygonBeingCreated) {
            this._initialize();
        }

        let properties = {
            selectable: false,
            hasControls: false,
            evented: false,
            objectCaching: false,
            hasBorders: false,
            lockMovementX: true,
            lockMovementY: true
        };

        //create circle representation of the point
        let polygon = this._current,
            index = polygon && polygon.points ? polygon.points.length : -1;

        if (index < 1) {
            this._initPoint = this._createControlPoint(x, y, properties);
            this._initPoint.set({fill: '#d93442', radius: this._initPoint.radius*2});
            this._context.addHelperAnnotation(this._initPoint);
        } else {
            if (Math.sqrt(Math.pow(this._initPoint.left - x, 2) +
                    Math.pow(this._initPoint.top - y, 2)) < 20 / VIEWER.tools.imagePixelSizeOnScreen()) {
                this.finishIndirect();
                return;
            }
        }

        if (!polygon) {
            polygon = this.create([{ x: x, y: y }],
                $.extend(properties, this._presets.getAnnotationOptions(isLeftClick))
            );
            this._context.addHelperAnnotation(polygon);
            this._current = polygon;
        } else {
            if (!this._followPoint) {
                this._followPoint = this._createControlPoint(x, y, properties);
                this._context.addHelperAnnotation(this._followPoint);
            } else {
                this._followPoint.set({left: x, top: y});
            }
            polygon.points.push({x: x, y: y});
            polygon.setCoords();
        }
        this._context.canvas.renderAll();
    }

    updateCreate(x, y) {
        if (!this._polygonBeingCreated) return;

        let lastIdx = this._current.points.length - 1,
            last = this._current.points[lastIdx],
            dy = last.y - y,
            dx = last.x - x;

        let powRad = this._getRelativePixelDiffDistSquared(10);
        //startPoint is twice the radius of distance with relativeDiff 10, if smaller
        //the drag could end inside finish zone
        if ((lastIdx === 0 && dx * dx + dy * dy > powRad * 4) || (lastIdx > 0 && dx * dx + dy * dy > powRad * 2)) {
            this.initCreate(x, y);
        }
    }

    isImplicit() {
        return false;
    }

    finishIndirect() {
        if (!this._current) return;

        let points = this._current.points;
        this._context.deleteHelperAnnotation(this._initPoint);
        if (this._followPoint) this._context.deleteHelperAnnotation(this._followPoint);
        this._context.deleteHelperAnnotation(this._current);
        if (points.length < 3) {
            this._initialize(false);
            return;
        }

        this._current = this.create(OSDAnnotations.PolygonUtilities.simplify(points),
            this._presets.getAnnotationOptions(this._current.isLeftClick));
        this._context.addAnnotation(this._current);
        this._initialize(false);
    }

    /**
     * Create array of points - approximation of the object shape
     * @param {Object} obj fabricjs.Polygon object that is being approximated
     * @param {function} converter take two elements and convert and return item
     * @param {Number} quality between 0 and 1, of the approximation in percentage (1 = 100%)
     * @return {Array} array of items returned by the converter - points
     */
    toPointArray(obj, converter, quality=1) {
        let points = obj.get("points");
        if (quality < 1) points = OSDAnnotations.PolygonUtilities.simplifyQuality(points, quality);

        //we already have object points, convert only if necessary
        if (converter !== OSDAnnotations.AnnotationObjectFactory.withObjectPoint) {
            return points.map(p => converter(p.x, p.y));
        }
        return points;
    }

    getASAP_XMLTypeName() {
        return "Polygon";
    }

    _initialize(isNew = true) {
        this._polygonBeingCreated = isNew;
        this._initPoint = null;
        this._current = null;
        this._followPoint = null;
    }

    _createControlPoint(x, y, commonProperties) {
        return new fabric.Circle($.extend(commonProperties, {
            radius: 10 / VIEWER.tools.imagePixelSizeOnScreen(),
            fill: '#fbb802',
            left: x,
            top: y,
            originX: 'center',
            originY: 'center',
            factory: "__private",
        }));
    }

    _getRelativePixelDiffDistSquared(relativeDiff) {
        return Math.pow(1 / VIEWER.tools.imagePixelSizeOnScreen() * relativeDiff, 2);
    }
};

OSDAnnotations.PolygonUtilities = {

    simplify: function (points, highestQuality = false) {
        // both algorithms combined for performance, simplifies the object based on zoom level
        if (points.length <= 2) return points;

        let tolerance = Math.pow(3 / VIEWER.tools.imagePixelSizeOnScreen(), 2);
        points = highestQuality ? points : this._simplifyRadialDist(points, tolerance);
        points = this._simplifyDouglasPeucker(points, tolerance);

        return points;
    },

    simplifyQuality: function (points, quality) {
        if (points.length <= 2) return points;

        //todo decide empirically on the constant value (quality = 0 means how big relative distance?)
        let tolerance = Math.pow((10 - 9*quality) / VIEWER.tools.imagePixelSizeOnScreen(), 2);
        return this._simplifyDouglasPeucker(this._simplifyRadialDist(points, tolerance), tolerance);
    },

    approximatePolygonArea: function (points) {
        if (points.length < 3) return { diffX: 0, diffY: 0 };
        let maxX = points[0].x, minX = points[0].x, maxY = points[0].y, minY = points[0].y;
        for (let i = 1; i < points.length; i++) {
            maxX = Math.max(maxX, points[i].x);
            maxY = Math.max(maxY, points[i].y);
            minX = Math.min(minX, points[i].x);
            minY = Math.min(minY, points[i].y);
        }
        return { diffX: maxX - minX, diffY: maxY - minY };
    },

    /**
     * THE FOLLOWING PRIVATE CODE: POLY SIMPLIFICATION CODE HAS BEEN COPIED OUT FROM A LIBRARY
     * (c) 2017, Vladimir Agafonkin
     * Simplify.js, a high-performance JS polyline simplification library
     * mourner.github.io/simplify-js
     */
    _getSqDist: function (p1, p2) {
        let dx = p1.x - p2.x,
            dy = p1.y - p2.y;
        return dx * dx + dy * dy;
    },

    _getSqSegDist: function (p, p1, p2) {
        let x = p1.x,
            y = p1.y,
            dx = p2.x - x,
            dy = p2.y - y;
        if (dx !== 0 || dy !== 0) {
            let t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
            if (t > 1) {
                x = p2.x;
                y = p2.y;
            } else if (t > 0) {
                x += dx * t;
                y += dy * t;
            }
        }
        dx = p.x - x;
        dy = p.y - y;
        return dx * dx + dy * dy;
    },

    _simplifyRadialDist: function (points, sqTolerance) {

        let prevPoint = points[0],
            newPoints = [prevPoint],
            point;

        for (let i = 1, len = points.length; i < len; i++) {
            point = points[i];

            if (this._getSqDist(point, prevPoint) > sqTolerance) {
                newPoints.push(point);
                prevPoint = point;
            }
        }
        if (prevPoint !== point) newPoints.push(point);
        return newPoints;
    },

    _simplifyDPStep: function (points, first, last, sqTolerance, simplified) {
        let maxSqDist = sqTolerance,
            index;

        for (let i = first + 1; i < last; i++) {
            let sqDist = this._getSqSegDist(points[i], points[first], points[last]);

            if (sqDist > maxSqDist) {
                index = i;
                maxSqDist = sqDist;
            }
        }

        if (maxSqDist > sqTolerance) {
            if (index - first > 1) this._simplifyDPStep(points, first, index, sqTolerance, simplified);
            simplified.push(points[index]);
            if (last - index > 1) this._simplifyDPStep(points, index, last, sqTolerance, simplified);
        }
    },

    _simplifyDouglasPeucker: function (points, sqTolerance) {
        let last = points.length - 1;

        let simplified = [points[0]];
        this._simplifyDPStep(points, 0, last, sqTolerance, simplified);
        simplified.push(points[last]);

        return simplified;
    }
};

OSDAnnotations.AutoObjectCreationStrategy = class {
    constructor(selfName, context) {
        this._globalSelf = `${context.id}['${selfName}']`;
        this.compatibleShaders = ["heatmap", "bipolar-heatmap", "edge", "identity"];
    }

    approximateBounds(point, growY=true) {
        //todo default object?
        return null;
    }

    /*async*/ createOutline(eventPosition) {
        //todo default object?
        return null;
    }
};

/**
 * Class that contains all logic for automatic annotation creation.
 */
OSDAnnotations.RenderAutoObjectCreationStrategy = class extends OSDAnnotations.AutoObjectCreationStrategy {

    constructor(selfName, context) {
        super(selfName, context);

        this._currentTile = null;
        const _this = this;
        this._renderEngine = new WebGLModule({
            uniqueId: "annot",
            onError: function(error) {
                //maybe notify
            },
            onFatalError: function (error) {
                console.error("Error with automatic detection: this feature wil be disabled.");
                _this._running = false;
            }
        });
        this._running = true;
        this._renderEngine.addVisualisation({
            shaders: {
                _ : {
                    type: "heatmap",
                    dataReferences: [0],
                    params: {}
                }
            }
        });
        this._renderEngine.prepareAndInit(VIEWER.bridge.dataImageSources());
        this._currentTile = "";
        this._readingIndex = 0;
        this._readingKey = "";
    }

    get running() {
        return this._running;
    }

    getLayerIndex() {
        return this._readingIndex;
    }

    setLayer(index, key) {
        this._readingIndex = index;
        this._readingKey = key;
    }

    _beforeAutoMethod() {
        let vis = VIEWER.bridge.visualization();
        this._renderEngine._visualisations[0] = {
            shaders: {}
        };
        let toAppend = this._renderEngine._visualisations[0].shaders;

        for (let key in vis.shaders) {
            if (vis.shaders.hasOwnProperty(key)) {
                let otherLayer = vis.shaders[key];
                let type;
                if (key === this._readingKey) {
                    if (otherLayer.type === "bipolar-heatmap") {
                        this.comparator = function(pixel) {
                            return Math.abs(pixel[0] - this.origPixel[0]) < 10 &&
                                Math.abs(pixel[1] - this.origPixel[1]) < 10 &&
                                Math.abs(pixel[2] - this.origPixel[2]) < 10 &&
                                pixel[3] > 0;
                        };
                        type = otherLayer.type;
                    } else {
                        this.comparator = function(pixel) {
                            return pixel[3] > 0;
                        };
                        type = "heatmap";
                    }
                } else {
                    type = 'none';
                }

                toAppend[key] = {
                    type: type,
                    visible: otherLayer.visible,
                    cache: otherLayer.cache,
                    dataReferences: otherLayer.dataReferences,
                    params: otherLayer.params,
                    index: otherLayer.index
                }
            }
        }
        this._renderEngine.rebuildVisualisation(Object.keys(vis.shaders));

        this._currentPixelSize = VIEWER.tools.imagePixelSizeOnScreen();

        let tiles = VIEWER.bridge.getTiledImage().lastDrawn;
        for (let i = 0; i < tiles.length; i++) {
            let tile = tiles[i];
            if (!tile.hasOwnProperty("annotationCanvas")) {
                tile.annotationCanvas = document.createElement("canvas");
                tile.annotationCanvasCtx = tile.annotationCanvas.getContext("2d");
            }
            this._renderEngine.setDimensions(tile.sourceBounds.width, tile.sourceBounds.height);
            let canvas = this._renderEngine.processImage(
                tile.image, tile.sourceBounds, 0, this._currentPixelSize
            );
            tile.annotationCanvas.width = tile.sourceBounds.width;
            tile.annotationCanvas.height = tile.sourceBounds.height;
            tile.annotationCanvasCtx.drawImage(canvas, 0, 0, tile.sourceBounds.width, tile.sourceBounds.height);
        }
    }

    _afterAutoMethod() {
        delete this._renderEngine._visualisations[0];
    }

    approximateBounds(point, growY=true) {
        this._beforeAutoMethod();
		if (!this.changeTile(point) || !this._running) {
            this._afterAutoMethod();
            return null;
        }

        this.origPixel = this.getPixelData(point);
        let dimensionSize = Math.max(screen.width, screen.height);

		let p = {x: point.x, y: point.y};
		if (!this.comparator(this.origPixel)) {
			//default object of width 40
			return { top: this.toGlobalPointXY(p.x, p.y - 20), left: this.toGlobalPointXY(p.x - 20, p.y),
                bottom: this.toGlobalPointXY(p.x, p.y + 20), right: this.toGlobalPointXY(p.x + 20, p.y) }
		}

        let counter = 0;
		const _this = this;
        function progress(variable, stepSize) {
            while (_this.getAreaStamp(p.x, p.y) === 15 && counter < dimensionSize) {
                p[variable] += stepSize;
                counter++;
            }
            let ok = counter < dimensionSize;
            counter = 0;
            return ok;
        }

		if (!progress("x", 2)) return null;
		let right = this.toGlobalPointXY(p.x, p.y);
		p.x = point.x;

        if (!progress("x", -2)) return null;
        let left = this.toGlobalPointXY(p.x, p.y);
		p.x = point.x;

		let top, bottom;
		if (growY) {
            if (!progress("y", 2)) return null;
            bottom = this.toGlobalPointXY(p.x, p.y);
            p.y = point.y;

            if (!progress("y", -2)) return null;
            top = this.toGlobalPointXY(p.x, p.y);
        } else {
            bottom = top = this.toGlobalPointXY(p.x, p.y);
        }

		//if too small, discard
		if (Math.abs(right-left) < 15 && Math.abs(bottom - top) < 15) return null;
        return { top: top, left: left, bottom: bottom, right: right };
    }

    /*async*/ createOutline(eventPosition) {
        this._beforeAutoMethod();
        if (!this.changeTile(eventPosition) || !this._running) {
            this._afterAutoMethod();
            return null;
        }

        this.origPixel = this.getPixelData(eventPosition);
        let dimensionSize = Math.max(screen.width, screen.height);

        let points = [];

        let x = eventPosition.x;  // current x position
        let y = eventPosition.y;  // current y position

        if (!this.comparator(this.origPixel)) {
            console.warn("Outline algorithm exited: outside region.");
            this._afterAutoMethod();
            return null;
        }

        let counter = 0;
        while (this.getAreaStamp(x, y) === 15 && counter < dimensionSize) {
            x += 2; //all neightbours inside, skip by two
            counter++;
            //$("#osd").append(`<span style="position:absolute; top:${y}px; left:${x}px; width:5px;height:5px; background:blue;" class="to-delete"></span>`);
        }
        if (counter >= dimensionSize) {
            this._afterAutoMethod();
            return null;
        }
        //$("#osd").append(`<span style="position:absolute; top:${y}px; left:${x}px; width:5px;height:5px; background:blue;" class="to-delete"></span>`);

        const first_point = new OpenSeadragon.Point(x, y);
        let time = Date.now();
        let direction = 1;

        let turns = [
            [0, -1, 0],
            [1, 0, 1],
            [0, 1, 2],
            [-1, 0, 3]
        ];
        // 0 -> up, 1 -> right, 2 -> down, 3-> left
        let rightDirMapping = [1, 2, 3, 0];
        let leftDirMapping = [3, 0, 1, 2];

        let inside = this.isValidPixel(first_point);

        RUN: for (let i = 3; i >= 0; i--) {
            let dir = turns[i];
            let xx = first_point.x;
            let yy = first_point.y;
            for (let j = 1; j < 6; j++) {
                direction = dir[2];
                first_point.x += dir[0];
                first_point.y += dir[1];

                if (this.isValidPixel(first_point) !== inside) {
                    break RUN;
                }
            }
            first_point.x = xx;
            first_point.y = yy;
        }

        let oldDirection = direction;
        counter = 0;
        while (Math.abs(first_point.x - x) > 6 || Math.abs(first_point.y - y) > 6 || counter < 40) {
            if (this.isValidPixel(first_point)) {
                let left = turns[leftDirMapping[direction]];
                first_point.x += left[0]*2;
                first_point.y += left[1]*2;
                oldDirection = direction;
                direction = left[2];

            } else {
                let right = turns[rightDirMapping[direction]];
                first_point.x += right[0]*2;
                first_point.y += right[1]*2;
                oldDirection = direction;
                direction = right[2];
            }

            if (oldDirection !== direction && counter % 4 === 0) {
                points.push(this.toGlobalPoint(first_point));
            }

            //$("#osd").append(`<span style="position:absolute; top:${first_point.y}px; left:${first_point.x}px; width:5px;height:5px; background:blue;" class="to-delete"></span>`);
            //if (counter % 200 === 0) await OSDAnnotations.sleep(2);

            if (counter % 100 === 0 && Date.now() - time > 1500) {
                console.warn("Outline algorithm exited: iteration steps exceeded.");
                this._afterAutoMethod();
                return;
            }
            counter++;
        }
        this._afterAutoMethod();

        let area = OSDAnnotations.PolygonUtilities.approximatePolygonArea(points);
        if (area.diffX < 5*this._currentPixelSize && area.diffY < 5*this._currentPixelSize) return null;
        return points;
    }

    toGlobalPointXY (x, y) {
		return VIEWER.tools.referencedTiledImage().windowToImageCoordinates(new OpenSeadragon.Point(x, y));
	}

	toGlobalPoint (point) {
		return VIEWER.tools.referencedTiledImage().windowToImageCoordinates(point);
	}

	isValidPixel(eventPosition) {
		return this.comparator(this.getPixelData(eventPosition));
	}

	comparator(pixel) {
        return pixel[0] == this.origPixel[0] &&
            pixel[1] == this.origPixel[1] &&
            pixel[2] == this.origPixel[2] &&
            pixel[3] > 0;
    }

    /**
     * Find tile that contains the event point
     * @param {OpenSeadragon.Point} eventPosition point
     */
    changeTile(eventPosition) {
        let viewportPos = VIEWER.viewport.pointFromPixel(eventPosition);
        let tiles = VIEWER.bridge.getTiledImage().lastDrawn;
        for (let i = 0; i < tiles.length; i++) {
            if (tiles[i].bounds.containsPoint(viewportPos)) {
                this._currentTile = tiles[i];
                return true;
            }
        }
        return false;
    }

	getPixelData(eventPosition) {
		//change only if outside
		if (!this._currentTile.bounds.containsPoint(eventPosition)) {
			this.changeTile(eventPosition);
		}

		// get position on a current tile
		let x = eventPosition.x - this._currentTile.position.x;
		let y = eventPosition.y - this._currentTile.position.y;

		// get position on DZI tile (usually 257*257)
        let canvasCtx = this._currentTile.getCanvasContext();
		let relative_x = Math.round((x / this._currentTile.size.x) * canvasCtx.canvas.width);
		let relative_y = Math.round((y / this._currentTile.size.y) * canvasCtx.canvas.height);

        // let pixel = new Uint8Array(4);
        // let gl = this._renderEngine.gl;
        // gl.readPixels(relative_x, relative_y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        // return pixel;
        return this._currentTile.annotationCanvasCtx.getImageData(relative_x, relative_y, 1, 1).data;
    }

	// CHECKS 4 neightbouring pixels and returns which ones are inside the specified region
	//  |_|_|_|   --> topRight: first (biggest), bottomRight: second, bottomLeft: third, topLeft: fourth bit
	//  |x|x|x|   --> returns  0011 -> 0*8 + 1*4 + 1*2 + 0*1 = 6, bottom right & left pixel inside
	//  |x|x|x|
	getAreaStamp(x, y) {
		let result = 0;
		if (this.isValidPixel(new OpenSeadragon.Point(x + 1, y - 1))) {
			result += 8;
		}
		if (this.isValidPixel(new OpenSeadragon.Point(x + 1, y + 1))) {
			result += 4;
		}
		if (this.isValidPixel(new OpenSeadragon.Point(x - 1, y + 1))) {
			result += 2;
		}
		if (this.isValidPixel(new OpenSeadragon.Point(x - 1, y - 1))) {
			result += 1;
		}
		return result;
	}
};
