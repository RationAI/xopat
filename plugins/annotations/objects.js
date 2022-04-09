/**
 * Preset: object that pre-defines the type of annotation to be created, along with its parameters
 */
OSDAnnotations.Preset = class {
    constructor(id, objectFactory = null, comment = "", color = "") {
        this.comment = comment;
        this.color = color;
        this.objectFactory = objectFactory;
        this.presetID = id;
    }

    fromJSONFriendlyObject(parsedObject, factoryGetter) {
        this.objectFactory = factoryGetter(parsedObject.objectType);
        if (this.objectFactory === undefined) {
            console.error("Invalid preset type.", parsedObject.type, "of", parsedObject,
                "No factory for such object available.");
        }
        this.comment = parsedObject.comment;
        this.color = parsedObject.color;
        this.presetID = parsedObject.presetID;
        return this;
    }
    toJSONFriendlyObject() {
        return {
            comment: this.comment,
            color: this.color,
            objectType: this.objectFactory.type,
            presetID: this.presetID
        };
    }
} // end of namespace Preset

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
        strokeWidth: 2,
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
        this._globalSelf = `${context.id}['${selfName}']`;
        this._context = context;
        this._presets = {};
        //mouse button presets
        this.left = undefined;
        this.right = undefined;
        this._colorSteps = 8;
        this._colorStep = 0;
    }

    /**
     * Get data to set as annotation properties (look, metadata...)
     * @param {boolean} isLeftClick true if the data should be with preset data bound to the left mouse button
     * @returns {Object} data to populate fabric object with (parameter 'options'
     * in AnnotationObjectFactory::create(..))
     */
    getAnnotationOptions(isLeftClick) {
        let preset = isLeftClick ? this.left : this.right;

        //fill is copied as a color and can be potentially changed to more complicated stuff (Pattern...)
        return $.extend({fill: preset.color},
            OSDAnnotations.PresetManager._commonProperty,
            preset,
            {
                isLeftClick: isLeftClick,
                opacity: this._context.opacity.val(),
            }
        );
    }

    /**
     * Output GUI HTML for presets
     * @returns {string} HTML
     */
    presetControls() {
        return `<span id="annotations-left-click" class="d-inline-block position-relative" 
style="width: 180px; cursor:pointer;"></span><span id="annotations-right-click" 
class="d-inline-block position-relative" style="width: 180px; cursor:pointer;"></span>`;
    }

    /**
     * Output additional GUI HTML for presets
     * @returns {string} HTML
     */
    presetExportControls() {
        return `
<button id="presets-download" onclick="${this._globalSelf}.exportToFile();" class="btn">Export presets.</button>&nbsp;
<a style="display:none;" id="presets-export"  HTTP-EQUIV="Content-Disposition" CONTENT="attachment; filename=whatever.pdf"></a>
<button id="presets-upload" onclick="this.nextSibling.click();" class="btn">Import presets.</button>
<input type='file' style="visibility:hidden; width: 0; height: 0;" 
onchange="${this._globalSelf}.importFromFile(event);$(this).val('');" />`;
    }

    /**
     * Add new preset with default values
     * @returns {Preset} newly created preset
     */
    addPreset() {
        let preset = new OSDAnnotations.Preset(Date.now(), this._context.polygonFactory, "", this._randomColorHexString());
        this._presets[preset.presetID] = preset;
        return preset;
    }

    _randomColorHexString() {
        // from https://stackoverflow.com/questions/1484506/random-color-generator/7419630#7419630
        var r, g, b;
        var h = (this._colorStep++ % this._colorSteps) / this._colorSteps;
        var i = ~~(h * 6);
        var f = h * 6 - i;
        var q = 1 - f;
        switch(i % 6){
            case 0: r = 1; g = f; b = 0; break;
            case 1: r = q; g = 1; b = 0; break;
            case 2: r = 0; g = 1; b = f; break;
            case 3: r = 0; g = q; b = 1; break;
            case 4: r = f; g = 0; b = 1; break;
            case 5: r = 1; g = 0; b = q; break;
        }
        var c = "#" + ("00" + (~ ~(r * 255)).toString(16)).slice(-2)
                        + ("00" + (~ ~(g * 255)).toString(16)).slice(-2)
                        + ("00" + (~ ~(b * 255)).toString(16)).slice(-2);
        return (c);
    }

    getCommonProperties() {
        return OSDAnnotations.PresetManager._commonProperty;
    }

    /**
     * Presets getter
     * @param {Number} id preset id
     * @returns {Preset} preset instance
     */
    getPreset(id) {
        return this._presets[id];
    }

    /**
     * Safely remove preset
     * @param {Number} id preset id
     * @returns {boolean} true if deletion succeeded
     */
    removePreset(id) {
        let toDelete = this._presets[id];
        if (!toDelete) return false;

        if (this._context.overlay.fabric._objects.some(o => {
            return o.presetID === id;
        })) {
            Dialogs.show("This preset belongs to existing annotations: it cannot be removed.",
                8000, Dialogs.MSG_WARN);
            return false;
        }

        if (toDelete === this.right) $("#annotations-right-click").html(this.getMissingPresetHTML(false));
        if (toDelete === this.left) $("#annotations-left-click").html(this.getMissingPresetHTML(true));
        delete this._presets[id];
        return true;
    }

    /**
     *
     * @param {Number} id preset id
     * @param {Object} properties to update in the preset (keys must match)
     */
    updatePreset(id, properties) {
        let toUpdate = this._presets[id],
            needsRefresh = false;
        if (!toUpdate) return;

        Object.entries(properties).forEach(([key, value]) => {
            if (toUpdate[key] !== value) {
                needsRefresh = true;
            }
            toUpdate[key] = value;
        });

        if (!needsRefresh) return;
        this.updatePresetsHTML();
        //var objects = this._context.overlay.fabric.getObjects();
        // if (objects.length == 0 || !confirm("Do you really want to delete all annotations?")) return;

        // var objectsLength = objects.length
        // for (var i = 0; i < objectsLength; i++) {
        // 	this.history.push(null, objects[objectsLength - i - 1]);
        // 	objects[objectsLength - i - 1].remove();
        // }
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
     * Makes the browser download the export() output
     */
    exportToFile() {
        let output = new Blob([this.export()], { type: 'text/plain' });
        let downloadURL = window.URL.createObjectURL(output);
        var downloader = document.getElementById("presets-export");
        downloader.href = downloadURL;
        downloader.download = "annotation-presets.json";
        downloader.click();
        URL.revokeObjectURL(downloadURL);
    }

    /**
     * Import presets
     * @param {string} presets JSON to decode
     */
    import(presets) {
        $('#preset-modify-dialog').remove();
        this._presets = {};
        let first = null;
        if (presets && presets.length > 10) {
            presets = JSON.parse(presets);
            for (let i = 0; i < presets.length; i++) {
                let p = new OSDAnnotations.Preset().fromJSONFriendlyObject(
                    presets[i], this._context.getAnnotationObjectFactory.bind(this._context)
                );
                this._presets[p.presetID] = p;

                if (!first) first = p;
            }
        } else {
            first = this.addPreset();
        }
        this.left = first;
        this.updatePresetsHTML();
    }

    /**
     * Load presets from a file
     * @param {Event} e event of the file load
     */
    importFromFile(e) {
        let file = e.target.files[0];
        if (!file) return;
        let fileReader = new FileReader();
        let _this = this;
        fileReader.onload = function (e) {
            _this.import(e.target.result);
        }
        fileReader.readAsText(file);
    }

    /**
     * Update main HTML GUI part of presets upon preset change
     */
    updatePresetsHTML() {
        if (this.left) {
            $("#annotations-left-click").html(this.getPresetControlHTML(this.left, true));
        } else {
            $("#annotations-left-click").html(this.getMissingPresetHTML(true));
        }
        if (this.right) {
            $("#annotations-right-click").html(this.getPresetControlHTML(this.right, false));
        } else {
            $("#annotations-right-click").html(this.getMissingPresetHTML(false));
        }
    }

    /**
     * Select preset as active. GUI is updated.
     * @param {boolean} isLeftClick if true, the preset is set as 'left' property, 'right' otherwise
     */
    selectPreset(isLeftClick) {
        if (!this._selection || !this._presets[this._selection]) return;
        if (isLeftClick) {
            this.left = this._presets[this._selection];
        } else {
            this.right = this._presets[this._selection];
        }
        this.updatePresetsHTML();
    }

    /**
     * GUI Item, ho left/right button looks like when no preset is set for it
     * @param {boolean} isLeftClick true if the preset is for the left mouse btn
     * @returns {string} HTML
     */
    getMissingPresetHTML(isLeftClick) {
        return `<div class="border-md border-dashed p-1 mx-2 rounded-3" style="border-width:3px!important;" 
onclick="${this._globalSelf}.showPresets(${isLeftClick});"><span class="material-icons">add</span> Add</div>`;
    }

    /**
     * GUI Item, ho left/right button looks like when it has a preset assigned
     * @param {Preset} preset object
     * @param {boolean} isLeftClick true if for the left mouse button
     * @returns {string} HTML
     */
    getPresetControlHTML(preset, isLeftClick) {
        let comment = preset.comment ? preset.comment : preset.objectFactory.getASAP_XMLTypeName();
        let icon = preset.objectFactory.getIcon();

        let changeHtml = "";
        Object.values(this._context.objectFactories).forEach(factory => {
            if (factory.type !== preset.objectFactory.type) {
                changeHtml += `<div onclick="${this._globalSelf}.updatePreset(${preset.presetID}, 
{objectFactory: openseadragon_image_annotations.getAnnotationObjectFactory('${factory.type}')}); 
event.stopPropagation(); window.event.cancelBubble = true;"><span class="material-icons" 
style="color: ${preset.color};">${factory.getIcon()}</span>  ${factory.getASAP_XMLTypeName()}</div>`;
            }
        });

        return `<div class="position-relative border-md p-1 mx-2 rounded-3" style="border-width:3px!important;" 
onclick="${this._globalSelf}.showPresets(${isLeftClick});"><span class="material-icons" 
style="color: ${preset.color};">${icon}</span>  ${comment}
<div class="quick_selection color-bg-primary border-md p-1 rounded-3">${changeHtml}</div></div>`;
    }

    /**
     * Preset modification GUI part, used to show preset modification tab
     * @param {Number} id preset id
     * @param {boolean} isLeftClick true if the button is the left one
     * @param {Number} index if set, the element is assigned an ID in the HTML, should differ in each call if set
     * @returns {string} HTML
     */
    getPresetHTMLById(id, isLeftClick, index = undefined) {
        if (!this._presets[id]) {
            return "";
        }
        return this.getPresetHTML(this._presets[id], isLeftClick, index);
    }

    /**
     * Preset modification GUI part, used to show preset modification tab
     * @param {Preset} preset object
     * @param {boolean} isLeftClick true if the button is the left one
     * @param {Number} index if set, the element is assigned an ID in the HTML, should differ in each call if set
     * @returns {string} HTML
     */
    getPresetHTML(preset, isLeftClick, index = undefined) {
        let select = "",
            currentPreset = isLeftClick ? this.left : this.right;

        Object.values(this._context.objectFactories).forEach(factory => {
            if (factory.type === preset.objectFactory.type) {
                select += `<option value="${factory.type}" selected>${factory.getASAP_XMLTypeName()}</option>`;
            } else {
                select += `<option value="${factory.type}">${factory.getASAP_XMLTypeName()}</option>`;
            }
        });

        let id = index === undefined ? "" : `id="preset-no-${index}"`;

        let html = `<div ${id} class="position-relative border-md border-dashed p-1 rounded-3 d-inline-block `;
        if (preset === currentPreset) {
            html += `highlighted-preset"`;
            this._selection = preset.presetID;
        } else {
            html += `"`;
        }
        return `${html} style="cursor:pointer; margin: 5px;" 
onclick="$(this).parent().children().removeClass('highlighted-preset');$(this).addClass('highlighted-preset');
${this._globalSelf}._selection = ${preset.presetID};"><span class="material-icons pointer position-absolute top-0 right-0 px-0" 
onclick="if (${this._globalSelf}.removePreset(${preset.presetID})) {$(this).parent().remove();}">delete</span>
<div class="d-inline-block mr-1">Annotation<br><select class="form-control" onchange="
${this._globalSelf}.updatePreset(${preset.presetID}, {objectFactory: 
${this._context.id}.getAnnotationObjectFactory(this.value)});">${select}</select></div>
<div class="d-inline-block">Color<br><input class="form-control" type="color" style="height:33px;" 
onchange="${this._globalSelf}.updatePreset(${preset.presetID}, {fill: this.value});" value="${preset.color}"></div>
<br>Comment<br><input class="form-control" type="text" onchange="${this._globalSelf}.updatePreset(${preset.presetID}, 
{comment: this.value});" value="${preset.comment}"><br></div>`;
    }

    /**
     * Show the user preset modification tab along with the option to select an active preset for either
     * left or right mouse button
     * @param {boolean} isLeftClick true if the modification tab sets left preset
     */
    showPresets(isLeftClick) {
        this._selection = undefined;

        let html = "",
            counter = 0,
            _this = this;

        Object.values(this._presets).forEach(preset => {
            html += _this.getPresetHTML(preset, isLeftClick, counter);
            counter++;
        });

        html += `<div id="preset-add-new" class="border-md border-dashed p-1 mx-2 my-2 rounded-3 d-inline-block 
${this._context.id}-plugin-root" style="vertical-align:top; width:150px; cursor:pointer;" onclick="let id = 
${this._globalSelf}.addPreset().presetID; $(this).before(${this._globalSelf}.getPresetHTMLById(id, ${isLeftClick}, 
$(this).index())); "><span class="material-icons">add</span> New</div>`;

        Dialogs.showCustom("preset-modify-dialog",
            `<b>Annotations presets</b>`,
            html,
            `<div class="d-flex flex-row-reverse">
<button id="select-annotation-preset-right" onclick="if (${this._globalSelf}._selection === 
undefined) { Dialogs.show('You must click on a preset to be selected first.', 5000, Dialogs.MSG_WARN); 
return false;} setTimeout(function(){ Dialogs.closeWindow('preset-modify-dialog'); 
${this._globalSelf}.selectPreset(false); }, 150);" class="btn m-2">Set for right click 
</button>
<button id="select-annotation-preset-left" onclick="if (${this._globalSelf}._selection === 
undefined) { Dialogs.show('You must click on a preset to be selected first.', 5000, Dialogs.MSG_WARN); 
return false;} setTimeout(function(){ Dialogs.closeWindow('preset-modify-dialog'); 
${this._globalSelf}.selectPreset(true); }, 150);" class="btn m-2">Set for left click 
</button>
</div>`);
    }
}



/**
 * It is more an interface rather than actual class.
 * Any annotation object should extend this class and implement
 * necessary methods for its creation.
 * TODO unify parameters and coordinate systems!
 */
OSDAnnotations.AnnotationObjectFactory = class {

    //Registered annotation object list
    static _registree = [];
    static register(...factories) {
        this._registree.push(...factories);
    }
    static visitRegistered(callback) {
        this._registree.forEach(e => callback(e));
    }

    /**
     * Constructor
     * @param {OSDAnnotations} context Annotation Plugin Context (Parent class)
     * @param {AutoObjectCreationStrategy} autoCreationStrategy or an object of similar interface
     * @param {PresetManager} presetManager manager of presets or an object of similar interface
     * @param {string} identifier unique annotation shape identifier
     */
    constructor(context, autoCreationStrategy, presetManager, identifier) {
        this._context = context;
        this._presets = presetManager;
        this._auto = autoCreationStrategy;
        this.type = identifier;
    }

    /**
     * Get icon for the object
     * @returns {string} pluggable to current icon system (see https://fonts.google.com/icons?selected=Material+Icons)
     */
    getIcon() {
        return "yard";
    }

    /**
     * Get icon for the object
     * @param ofObject object to describe
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
     * Create an annotation object from given parameters
     * @param {Object} parameters type-dependent parameters (see documentation of subclass)
     * @param {Object} options FbaricJS and custom options to set
     * @returns
     */
    create(parameters, options) {
        return null;
    }

    /**
     * Prototype pattern (inside Factory class), create copy of an object
     * @param {Object} ofObject object to copy
     * @param {Object} parameters type-dependent parameters (see documentation of subclass)
     * @returns
     */
    copy(ofObject, parameters) {
        return null;
    }


    /**
     * Create an object at given point with a given strategy (TODO use strategy pattern)
     * @param {OpenSeadragon.Point} point origin of the object
     * @param {boolean} isLeftClick true if the object was created using left mouse button
     * @return {boolean} true if creation succeeded
     */
    instantCreate(point, isLeftClick) {
        return false;
    }

    /**
     * TODO consfusing naming?
     * Check whether object supports hit-click creation
     * @returns true if supports hit-click creation
     */
    isValidShortCreationClick() {
        return false;
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
     * @param theObject recalculate the object that has been modified
     */
    edit(theObject) {
    }

    /**
     * Update the object coordinates by finishing edit() call (this is guaranteed to happen at least once before)
     * @param theObject recalculate the object that has been modified
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
     * @return {string} ASAP XML Name
     */
    finishIndirect() {
    }

    /**
     * Called when object is selected
     * @param theObject selected fabricjs object
     */
    selected(theObject) {
    }

    getASAP_XMLTypeName() {
        return "Generic Object";
    }

    /**
     * If the object is defined implicitly (e.g. control points + formula)
     * @returns {boolean} true if the shape is not an explicit point array
     */
    isImplicit() {
        return true;
    }

    /**
     * Create array of points - approximation of the object shape
     * @param {Object} obj object that is being approximated
     * @param {function} converter take two elements and convert and return item
     * @param {Number} quality between 0 and 1, of the approximation in percentage (1 = 100%)
     * @return {Array} array of items returned by the converter - points
     */
    toPointArray(obj, converter, quality=1) {
    }

    static withObjectPoint(x, y) {
        return {x: x, y: y};
    }
    static withArrayPoint(x, y) {
        return [x, y];
    }
};


OSDAnnotations.Rect = class extends OSDAnnotations.AnnotationObjectFactory {
    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "rect");
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
            type: this.type
        }, parameters, options));
    }

    /**
     * @param {Object} ofObject fabricjs.Rect object that is being copied
     * @param {Object} parameters object of the following properties:
     *              - left: offset in the image dimension
     *              - top: offset in the image dimension
     *              - rx: major axis radius
     *              - ry: minor axis radius
     */
    copy(ofObject, parameters) {
        return new fabric.Rect({
            left: parameters.left,
            top: parameters.top,
            width: parameters.width,
            height: parameters.height,
            fill: ofObject.fill,
            color: ofObject.color,
            isLeftClick: ofObject.isLeftClick,
            opacity: ofObject.opacity,
            strokeWidth: ofObject.strokeWidth,
            stroke: ofObject.stroke,
            scaleX: ofObject.scaleX,
            scaleY: ofObject.scaleY,
            type: ofObject.type,
            hasRotatingPoint: ofObject.hasRotatingPoint,
            borderColor: ofObject.borderColor,
            cornerColor: ofObject.cornerColor,
            borderScaleFactor: ofObject.borderScaleFactor,
            hasControls: ofObject.hasControls,
            lockMovementX: ofObject.lockMovementX,
            lockMovementY: ofObject.lockMovementY,
            comment: ofObject.comment,
            presetID: ofObject.presetID
        });
    }

    edit(theObject) {
        theObject.set({
            hasControls: true,
            lockMovementX: false,
            lockMovementY: false
        });
    }

    recalculate(theObject) {
        let height = theObject.getHeight();
        let width = theObject.getWidth();
        theObject.set({ width: width, height: height, scaleX: 1, scaleY: 1, });
        theObject.calcCoords();
    }

    instantCreate(point, isLeftClick = true) {
        let bounds = this._auto.approximateBounds(point);
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
        if (this._origX > x) {
            this._current.set({ left: Math.abs(x) });
        }
        if (this._origY > y) {
            this._current.set({ top: Math.abs(y) });
        }
        let width = Math.abs(x - this._origX);
        let height = Math.abs(y - this._origY);
        this._current.set({ width: width, height: height });
    }

    finishDirect() {
        let obj = this.getCurrentObject();
        if (!obj) return;
        this._context.promoteHelperAnnotation(obj);
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

OSDAnnotations.Ellipse = class extends OSDAnnotations.AnnotationObjectFactory {
    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "ellipse");
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
            type: this.type
        }, parameters, options));
    }

    copy(ofObject, parameters) {
        return new fabric.Ellipse({
            left: parameters.left,
            top: parameters.top,
            rx: parameters.rx,
            ry: parameters.ry,
            originX: ofObject.originX,
            originY: ofObject.originY,
            angle: ofObject.angle,
            fill: ofObject.fill,
            color: ofObject.color,
            stroke: ofObject.stroke,
            strokeWidth: ofObject.strokeWidth,
            opacity: ofObject.opacity,
            type: ofObject.type,
            isLeftClick: ofObject.isLeftClick,
            selectable: ofObject.selectable,
            hasRotatingPoint: ofObject.hasRotatingPoint,
            borderColor: ofObject.borderColor,
            cornerColor: ofObject.cornerColor,
            borderScaleFactor: ofObject.borderScaleFactor,
            hasControls: ofObject.hasControls,
            lockMovementX: ofObject.lockMovementX,
            lockMovementY: ofObject.lockMovementY,
            comment: ofObject.comment,
            presetID: ofObject.presetID
        });
    }

    edit(theObject) {
        theObject.set({
            hasControls: true,
            lockMovementX: false,
            lockMovementY: false
        });
    }

    recalculate(theObject) {
        let rx = theObject.rx * theObject.scaleX;
        let ry = theObject.ry * theObject.scaleY;
        theObject.set({ rx: rx, ry: ry, scaleX: 1, scaleY: 1, });
        theObject.calcCoords();
    }

    instantCreate(point, isLeftClick = true) {
        let bounds = this._auto.approximateBounds(point);
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
        this._origX = x;
        this._origY = y;
        this._current = this.create({
            left: x,
            top: y,
            rx: 1,
            ry: 1
        }, this._presets.getAnnotationOptions(isLeftClick));
        this._context.addHelperAnnotation(this._current);
    }

    updateCreate(x, y) {
        if (!this._current) return;

        if (this._origX > x) {
            this._current.set({ left: Math.abs(x) });
        }
        if (this._origY > y) {
            this._current.set({ top: Math.abs(y) });
        }
        let width = Math.abs(x - this._origX) / 2;
        let height = Math.abs(y - this._origY) / 2;
        this._current.set({ rx: width, ry: height });
    }

    finishDirect() {
        let obj = this.getCurrentObject();
        if (!obj) return;
        this._context.promoteHelperAnnotation(obj);
        this._current = undefined;
    }

    /**
     * Create array of points - approximation of the object shape
     * @param {fabricjs.Ellipse} obj object that is being approximated
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

//todo rename to underscore if private
OSDAnnotations.Polygon = class extends OSDAnnotations.AnnotationObjectFactory {

    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "polygon");
        this._initialize(false);
    }

    getIcon() {
        return "share";
    }

    getDescription(ofObject) {
        return `Polygon [${Math.round(ofObject.left)}, ${Math.round(ofObject.top)}]`;
    }

    getCurrentObject() {
        return (this._current || this._edited);
    }

    /**
     * @param {Array} parameters array of objects with {x, y} properties (points)
     * @param {Object} options see parent class
     */
    create(parameters, options) {
        return new fabric.Polygon(parameters, $.extend({
            type: this.type
        }, options));
    }

    /**
     * @param {Array} parameters array of objects with {x, y} properties (points)
     */
    //todo unify parameters - where is evented?
    copy(ofObject, parameters) {
        return new fabric.Polygon(parameters, {
            hasRotatingPoint: ofObject.hasRotatingPoint,
            fill: ofObject.fill,
            color: ofObject.color,
            stroke: ofObject.stroke,
            strokeWidth: ofObject.strokeWidth,
            isLeftClick: ofObject.isLeftClick,
            opacity: ofObject.opacity,
            type: ofObject.type,
            selectable: ofObject.selectable,
            borderColor: ofObject.borderColor,
            cornerColor: ofObject.cornerColor,
            borderScaleFactor: ofObject.borderScaleFactor,
            comment: ofObject.comment,
            hasControls: ofObject.hasControls,
            lockMovementX: ofObject.lockMovementX,
            lockMovementY: ofObject.lockMovementY,
            presetID: ofObject.presetID
        });
    }

    edit(theObject) {
        //from the official example http://fabricjs.com/custom-controls-polygon
        if (this._edited) {
            this.recalculate(this._edited);
        }

        this._initialize(false);
        let points = theObject.get("points");
        const _this = this;
        theObject.selectable = false;
        theObject.hasControls = false;

        points.forEach(function (point, index) {
            let circle = _this._createControlPoint(point.x, point.y, {
                name: index,
                selectable: true,
                hasControls: false,
                objectCaching: false,
                evented: true
            });
            circle.on('moving', function () {
                let curr = _this._edited;
                curr.points[this.name] = { x: this.getCenterPoint().x, y: this.getCenterPoint().y };
                //todo somehow try to avoid copy, but it creates artifacts otherwise :(
                _this._edited = _this.copy(curr, curr.points);
                _this._context.replaceAnnotation(curr, _this._edited, false);
                _this._context.canvas.sendToBack(_this._edited);
                _this._context.canvas.renderAll();
            });
            _this._pointArray.push(circle);
            _this._context.addHelperAnnotation(circle);
        });

        this._originallyEddited = theObject;
        this._edited = theObject;
        this._context.canvas.deactivateAll();
        this._context.canvas.sendToBack(theObject);
        this._context.canvas.renderAll();
    }

    recalculate(theObject) {
        let _this=this;
        $.each(this._pointArray, function (index, point) {
            _this._context.deleteHelperAnnotation(point);
        });

        if (this._edited !== this._originallyEddited) {
            this._context.history.push(this._edited, this._originallyEddited);
            this._edited.selectable = true;
            this._context.overlay.fabric.setActiveObject(this._edited);
        }
        //clear
        this._initialize(false);
        this._edited = null;
    }

    instantCreate(point, isLeftClick = true) {
        const _this = this;
        //(async function _() {
            //todo disable user interaction while computing
            //todo delete polygon if not big enough
            let result = /*await*/ _this._auto.createOutline(point);

            if (!result || result.length < 3) return false;
            result = _this.simplify(result);
            _this._context.addAnnotation(
                _this.create(result, _this._presets.getAnnotationOptions(isLeftClick))
            );
            return true;
        //})();
    }

    isValidShortCreationClick() {
        return true;
    }

    initCreate(x, y, isLeftClick = true) {
        if (!this._polygonBeingCreated) {
            this._initialize();
        }
        this.isLeftClick = isLeftClick;

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
        let circle = this._createControlPoint(x, y, properties);
        if (this._pointArray.length === 0) {
            circle.set({fill: '#d93442', radius: circle.radius*2});
        } else {
            if (Math.sqrt(Math.pow(this._pointArray[0].left - x, 2) +
                    Math.pow(this._pointArray[0].top - y, 2)) < circle.radius*2) {
                this.finishIndirect();
                return;
            }
        }
        this._pointArray.push(circle);
        this._context.addHelperAnnotation(circle);

        let polygon;
        if (this._current) {
            let points = this._current.get("points");
            points.push({
                x: x,
                y: y
            });
            polygon = this.create(points, this._presets.getAnnotationOptions(isLeftClick))

            this._context.replaceAnnotation(this._current, polygon);
        }  else {
            polygon = this.create([{ x: x, y: y }],
                $.extend(properties, this._presets.getAnnotationOptions(isLeftClick))
            );
            this._context.addHelperAnnotation(polygon);
        }
        this._current = polygon;
        this._context.clearAnnotationSelection();
    }

    updateCreate(x, y) {
        if (!this._polygonBeingCreated) return;

        let lastIdx = this._pointArray.length - 1,
            last = this._pointArray[lastIdx],
            dy = last.top - y,
            dx = last.left - x;

        let powRad = this.getRelativePixelDiffDistSquared(10);
        //startPoint is twice the radius of distance with relativeDiff 10, if smaller
        //the drag could end inside finish zone
        if ((lastIdx === 0 && dx * dx + dy * dy > powRad * 4) || (lastIdx > 0 && dx * dx + dy * dy > powRad * 2)){
            this.initCreate(x, y, this.isLeftClick);
        }
    }

    isImplicit() {
        return false;
    }

    // generate finished polygon
    finishIndirect() {
        if (!this._current) return;

        let points = [], _this = this;
        $.each(this._pointArray, function (index, point) {
            points.push({
                x: point.left,
                y: point.top
            });
            _this._context.deleteHelperAnnotation(point);
        });

        _this._context.deleteHelperAnnotation(this._current);

        if (this._pointArray.length < 3) {
            this._initialize(false); //clear
            return;
        }

        this._current = this.create(this.simplify(points),
            this._presets.getAnnotationOptions(this._current.isLeftClick));
        this._context.addAnnotation(this._current);
        this._initialize(false); //clear
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
        if (quality < 1) points = this.simplifyQuality(points, quality);

        //we already have object points, convert only if necessary
        if (converter !== OSDAnnotations.AnnotationObjectFactory.withObjectPoint) {
            let output = new Array(points.length);
            points.forEach(p => {
                output.push(converter(p.x, p.y))
            });
            return output;
        }
        return points;
    }


    getASAP_XMLTypeName() {
        return "Polygon";
    }

    _initialize(isNew = true) {
        this._polygonBeingCreated = isNew;
        this._pointArray = [];
        this._current = null;
        this._edited = null;
    }

    //todo replace with control point feature?
    _createControlPoint(x, y, commonProperties) {
        return new fabric.Circle($.extend(commonProperties, {
            radius: 1 / VIEWER.tools.imagePixelSizeOnScreen() * 10,
            fill: '#fbb802',
            left: x,
            top: y,
            originX: 'center',
            originY: 'center',
            type: "__polygon.controls.circle",
        }));
    }

    /**
     * THE FOLLOWING PRIVATE CODE: POLY SIMPLIFICATION CODE HAS BEEN COPIED OUT FROM A LIBRARY
     * (c) 2017, Vladimir Agafonkin
     * Simplify.js, a high-performance JS polyline simplification library
     * mourner.github.io/simplify-js
     */
    _getSqDist(p1, p2) {
        var dx = p1.x - p2.x,
            dy = p1.y - p2.y;
        return dx * dx + dy * dy;
    }

    _getSqSegDist(p, p1, p2) {
        var x = p1.x,
            y = p1.y,
            dx = p2.x - x,
            dy = p2.y - y;
        if (dx !== 0 || dy !== 0) {
            var t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
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
    }

    _simplifyRadialDist(points, sqTolerance) {

        var prevPoint = points[0],
            newPoints = [prevPoint],
            point;

        for (var i = 1, len = points.length; i < len; i++) {
            point = points[i];

            if (this._getSqDist(point, prevPoint) > sqTolerance) {
                newPoints.push(point);
                prevPoint = point;
            }
        }

        if (prevPoint !== point) newPoints.push(point);

        return newPoints;
    }

    _simplifyDPStep(points, first, last, sqTolerance, simplified) {
        var maxSqDist = sqTolerance,
            index;

        for (var i = first + 1; i < last; i++) {
            var sqDist = this._getSqSegDist(points[i], points[first], points[last]);

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
    }

    // simplification using Ramer-Douglas-Peucker algorithm
    _simplifyDouglasPeucker(points, sqTolerance) {
        var last = points.length - 1;

        var simplified = [points[0]];
        this._simplifyDPStep(points, 0, last, sqTolerance, simplified);
        simplified.push(points[last]);

        return simplified;
    }

    /**
     * END
     */

    getRelativePixelDiffDistSquared(relativeDiff) {
        return Math.pow(1 / VIEWER.tools.imagePixelSizeOnScreen() * relativeDiff, 2);
    }

    // both algorithms combined for awesome performance
    // simplifies the object based on zoom level
    simplify(points, highestQuality = false) {

        if (points.length <= 2) return points;

        let tolerance = this.getRelativePixelDiffDistSquared(3);
        points = highestQuality ? points : this._simplifyRadialDist(points, tolerance);
        points = this._simplifyDouglasPeucker(points, tolerance);

        return points;
    }

    simplifyQuality(points, quality) {
        if (points.length <= 2) return points;

        //todo decide empirically on the constant value (quality = 0 means how big relative distance?)
        let tolerance = this.getRelativePixelDiffDistSquared(10 - 9*quality);
        points = highestQuality ? points : this._simplifyRadialDist(points, tolerance);
        points = this._simplifyDouglasPeucker(points, tolerance);

        return points;
    }
};

/**
 * Class that contains all logic for automatic annotation creation.
 */
OSDAnnotations.AutoObjectCreationStrategy = class {

    constructor(selfName, context) {
        this._currentTile = null;
        const _this = this;
        this._renderEngine = new WebGLModule({
            uniqueId: "annot",
            onError: function(error) {
                _this.tileFailure = true;
            },
            onFatalError: function (error) {
                _this.tileFailure = true;
            }
        });
        this.tileFailure = false; //todo remove?
        this._renderEngine.addVisualisation({
            shaders: {
                _ : {
                    type: "heatmap",
                    dataReferences: [0],
                    params: {}
                }
            }
        });
        this.compatibleShaders = ["heatmap", "bipolar-heatmap", "edge", "identity"];
        this._renderEngine.prepareAndInit(VIEWER.bridge.dataImageSources());
        this._globalSelf = `${context.id}['${selfName}']`;
        this._currentTile = "";
        this._readingIndex = 0;
        this._readingKey = "";
        this._customControls = "";

        this._initFromVisualization(VIEWER.bridge.currentVisualisation());
        VIEWER.addHandler('visualisation-used', function (visualisation) {
            _this._initFromVisualization(visualisation);
        });
    }

    _initFromVisualization(visualisation) {
        let html = "";

        let index = -1;
        let layer = null;
        let key = "";
        for (key in visualisation.shaders) {
            if (!visualisation.shaders.hasOwnProperty(key)) continue;
            layer = visualisation.shaders[key];
            if (isNaN(layer.index)) return; //not used TODO dirty....

            let errIcon = this.compatibleShaders.some(type => type === layer.type) ? "" : "&#9888; ";
            let errData = errIcon ? "data-err='true' title='Layer visualization style not supported with automatic annotations.'" : "";
            let selected = "";

            if (layer.index === this._readingIndex) {
                index = layer.index;
                this._readingKey = key;
                selected = "selected";
            }
            html += `<option value='${key}' ${selected} ${errData}>${errIcon}${layer.name}</option>`;
        }

        if (index < 0) {
            if (!layer) return;
            this._readingIndex = layer.index;
            this._readingKey = key;
            html = "<option selected " + html.substr(8);
        }
        this._customControls = html;
        $("#sensitivity-auto-outline").html(html);
    }

    _beforeAutoMethod() {
        let vis = VIEWER.bridge.currentVisualisation(),
            layer = vis.shaders[this._readingKey];
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
                tile.imageData(), tile.sourceBounds, 0, this._currentPixelSize
            );
            tile.annotationCanvas.width = tile.sourceBounds.width;
            tile.annotationCanvas.height = tile.sourceBounds.height;
            tile.annotationCanvasCtx.drawImage(canvas, 0, 0, tile.sourceBounds.width, tile.sourceBounds.height);
        }
    }

    _afterAutoMethod() {
        delete this._renderEngine._visualisations[0];
    }

    sensitivityControls() {
        return `<span class="d-inline-block position-absolute top-0" style="font-size: xx-small;" title="What layer is used to create automatic 
annotations."> Automatic annotations detected in: </span><select title="What layer is selected for the data." style="min-width: 180px; max-width: 250px;"
type="number" id="sensitivity-auto-outline" class="form-select select-sm" onchange="${this._globalSelf}._setTargetLayer(this);">${this._customControls}</select>`;
    }

    _setTargetLayer(self) {
        self = $(self);
        this._readingKey = self.val();
        let layer = VIEWER.bridge.currentVisualisation().shaders[this._readingKey];
        this._readingIndex = layer.index;
    }

    approximateBounds(point) {
        this._beforeAutoMethod();
		if (!this.changeTile(point)) {
            this._afterAutoMethod();
            return null;
        }

        this.origPixel = this.getPixelData(point);
        let dimensionSize = Math.max(screen.width, screen.height);

		var x = point.x;
		var y = point.y;

		if (!this.comparator(this.origPixel)) {
			//default object of width 40
			return { top: this.toGlobalPointXY(x, y - 20), left: this.toGlobalPointXY(x - 20, y),
                bottom: this.toGlobalPointXY(x, y + 20), right: this.toGlobalPointXY(x + 20, y) }
		}

        let counter = 0;
		while (this.getAreaStamp(x, y) === 15 && counter < dimensionSize) {
			x += 2;
			counter++;
		}
		if (counter >= dimensionSize) return null;
		counter = 0;
		var right = this.toGlobalPointXY(x, y);
		x = point.x;

		while (this.getAreaStamp(x, y) === 15 && counter < dimensionSize) {
			x -= 2;
            counter++;
		}
        if (counter >= dimensionSize) return null;
        counter = 0;
		var left = this.toGlobalPointXY(x, y);
		x = point.x;

		while (this.getAreaStamp(x, y) === 15 && counter < dimensionSize) {
			y += 2;
            counter++;
		}
        if (counter >= dimensionSize) return null;
        counter = 0;
		var bottom = this.toGlobalPointXY(x, y);

		y = point.y;
		while (this.getAreaStamp(x, y) === 15 && counter < dimensionSize) {
			y -= 2;
            counter++;
		}
        if (counter >= dimensionSize) return null;
		var top = this.toGlobalPointXY(x, y);

		//if too small, discard
		if (Math.abs(right-left) < 15 && Math.abs(bottom - top) < 15) return null;
        return { top: top, left: left, bottom: bottom, right: right };
    }

    /*async*/ createOutline(eventPosition) {
        this._beforeAutoMethod();
        if (!this.changeTile(eventPosition)) {
            this._afterAutoMethod();
            return null;
        }

        this.origPixel = this.getPixelData(eventPosition);
        let dimensionSize = Math.max(screen.width, screen.height);

        let points = [];
        const _this = this;

        var x = eventPosition.x;  // current x position
        var y = eventPosition.y;  // current y position

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

        if (points.length < 3) return null;
        let maxX = points[0].x, minX = points[0].x, maxY = points[0].y, minY = points[0].y;
        for (let i = 1; i < points.length; i++) {
            maxX = Math.max(maxX, points[i].x);
            maxY = Math.max(maxY, points[i].y);
            minX = Math.min(minX, points[i].x);
            minY = Math.min(minY, points[i].y);
        }
        if (maxX - minX < 5*this._currentPixelSize && maxY - minY < 5*this._currentPixelSize) return null;
        return points;
    }

    toGlobalPointXY (x, y) {
		return VIEWER.tools.referencedTileSource().windowToImageCoordinates(new OpenSeadragon.Point(x, y));
	}

	toGlobalPoint (point) {
		return VIEWER.tools.referencedTileSource().windowToImageCoordinates(point);
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
		var x = eventPosition.x - this._currentTile.position.x;
		var y = eventPosition.y - this._currentTile.position.y;

		// get position on DZI tile (usually 257*257)
        let canvasCtx = this._currentTile.canvasContext();
		var relative_x = Math.round((x / this._currentTile.size.x) * canvasCtx.canvas.width);
		var relative_y = Math.round((y / this._currentTile.size.y) * canvasCtx.canvas.height);

        // var pixel = new Uint8Array(4);
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
		var result = 0;
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
}
