/**
 * Preset: object that pre-defines the type of annotation to be created, along with its parameters
 */
class Preset {
    constructor(id, objectFactory = null, comment = "", color = "") {
        this.comment = comment;
        this.fill = color;
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
        this.fill = parsedObject.fill;
        this.presetID = parsedObject.presetID;
        return this;
    }
    toJSONFriendlyObject() {
        return {
            comment: this.comment,
            fill: this.fill,
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
class PresetManager {

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
    }

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
        return $.extend(PresetManager._commonProperty,
            isLeftClick ? this.left : this.right,
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
    presetHiddenControls() {
        return `<span class="d-inline-block" style="width:46%" title="Importing and exporting presets">Preset control:</span>
<button class="btn px-1" onclick="${this._globalSelf}.exportToFile();" id="presets-download" 
title="Download presets" style="height:30px;width:23%;"><span class="material-icons px-0">file_download</span>
Export</button><a style="display:none;" id="presets-export"></a><button class="btn px-1" style="height:30px;width:23%;"
id="presets-upload" onclick="this.nextSibling.click();" title="Import presets"><span class="material-icons px-0">
file_upload</span>Import</button><input type='file' style="visibility:hidden; width: 0; height: 0;" 
onchange="${this._globalSelf}.importFromFile(event);$(this).val('');" />`;
    }

    /**
     * Add new preset with default values
     * @returns {Preset} newly created preset
     */
    addPreset() {
        let preset = new Preset(Date.now(), this._context.polygonFactory, "", this._randomColorHexString());
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

        if (this._context.overlay.fabricCanvas()._objects.some(o => {
            return o.presetID === id;
        })) {
            PLUGINS.dialog.show("This preset belongs to existing annotations: it cannot be removed.",
                8000, PLUGINS.dialog.MSG_WARN);
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
        //var objects = this._context.overlay.fabricCanvas().getObjects();
        // if (objects.length == 0 || !confirm("Do you really want to delete all annotations?")) return;

        // var objectsLength = objects.length
        // for (var i = 0; i < objectsLength; i++) {
        // 	this.history.push(null, objects[objectsLength - i - 1]);
        // 	objects[objectsLength - i - 1].remove();
        // }
    }

    /**
     * Export presets
     * @returns {string} JSON-encoded string
     */
    export() {
        let exported = [];
        Object.values(this._presets).forEach(value => {
            exported.push(value.toJSONFriendlyObject());
        });
        return JSON.stringify(exported);
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
                let p = new Preset().fromJSONFriendlyObject(
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
style="color: ${preset.fill};">${factory.getIcon()}</span>  ${factory.getASAP_XMLTypeName()}</div>`;
            }
        });

        return `<div class="position-relative border-md p-1 mx-2 rounded-3" style="border-width:3px!important;" 
onclick="${this._globalSelf}.showPresets(${isLeftClick});"><span class="material-icons" 
style="color: ${preset.fill};">${icon}</span>  ${comment}
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
${this._globalSelf}._selection = ${preset.presetID};"><span class="material-icons position-absolute top-0 right-0 px-0" 
onclick="if (${this._globalSelf}.removePreset(${preset.presetID})) {$(this).parent().remove();}">delete</span>
<div class="d-inline-block mr-1">Annotation<br><select class="form-control" onchange="
${this._globalSelf}.updatePreset(${preset.presetID}, {objectFactory: 
${this._context.id}.getAnnotationObjectFactory(this.value)});">${select}</select></div>
<div class="d-inline-block">Color<br><input class="form-control" type="color" style="height:33px;" 
onchange="${this._globalSelf}.updatePreset(${preset.presetID}, {fill: this.value});" value="${preset.fill}"></div>
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

        let title = isLeftClick ? "for left click" : "for right click";

        PLUGINS.dialog.showCustom("preset-modify-dialog",
            `Annotations presets <b>${title}</b>`,
            html,
            `<button id="select-annotation-preset" onclick="if (${this._globalSelf}._selection === 
undefined) { PLUGINS.dialog.show('You must click on a preset to be selected first.', 5000, PLUGINS.dialog.MSG_WARN); 
return false;} setTimeout(function(){ $('#preset-modify-dialog').remove(); 
${this._globalSelf}.selectPreset(${isLeftClick}); }, 150);" class="btn position-absolute bottom-2 right-4">Select
</button>`);
    }
}



/**
 * It is more an interface rather than actual class.
 * Any annotation object should extend this class and implement
 * necessary methods for its creation.
 * TODO unify parameters and coordinate systems!
 */
class AnnotationObjectFactory {

    //Registered annotation object list
    static _registree = [];
    static register(...factories) {
        AnnotationObjectFactory._registree.push(...factories);
    }
    static visitRegistered(callback) {
        AnnotationObjectFactory._registree.forEach(e => callback(e));
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
}


class Rect extends AnnotationObjectFactory {
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
     */
    create(parameters, options) {
        return new fabric.Rect($.extend({
            scaleX: 1,
            scaleY: 1,
            type: this.type
        }, parameters, options));
    }

    /**
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
     * @param {fabricjs.Rect} obj object that is being approximated
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
}

class Ellipse extends AnnotationObjectFactory {
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
     * @param {Object} parameters object of the following properties:
     *              - left: offset in the image dimension
     *              - top: offset in the image dimension
     *              - rx: major axis radius
     *              - ry: minor axis radius
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
}

//todo rename to underscore if private
class Polygon extends AnnotationObjectFactory {

    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "polygon");
        this._polygonBeingCreated = false; // is polygon being drawn/edited
        this._pointArray = null;
        this._current = null;
    }

    getIcon() {
        return "share";
    }

    getDescription(ofObject) {
        return `Polygon [${Math.round(ofObject.left)}, ${Math.round(ofObject.top)}]`;
    }

    getCurrentObject() {
        return (this._current || this.currentlyEddited);
    }

    /**
     * @param {Array} parameters array of objects with {x, y} properties (points)
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

    instantCreate(point, isLeftClick = true) {
        const _this = this;
        (async function _() {
            //todo disable user interaction while computing
            //todo delete polygon if not big enough
            let result = await _this._auto.createOutline(point);

            if (!result) return;

            _this._context.addAnnotation(
                _this.create(result, _this._presets.getAnnotationOptions(isLeftClick))
            );
        })();
    }

    isValidShortCreationClick() {
        return true;
    }

    initCreate(x, y, isLeftClick = true) {
        if (!this._polygonBeingCreated) {
            this._initialize();
        }
        this.isLeftClick = isLeftClick;

        let commonProperties = {
            selectable: false,
            hasBorders: false,
            hasControls: false,
            evented: false,
            objectCaching: false,
        };

        //create circle representation of the point
        let circle = new fabric.Circle($.extend(commonProperties, {
            radius: Math.sqrt(this.getRelativePixelDiffDistSquared(10)),
            fill: '#F58B8B',
            stroke: '#333333',
            strokeWidth: 0.5,
            left: x,
            top: y,
            originX: 'center',
            originY: 'center',
            type: "_polygon.controls.circle",
            lockMovementX: true,
            lockMovementY: true
        }));
        if (this._pointArray.length === 0) circle.set({fill: 'red', strokeWidth: 0.7});
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
                $.extend(commonProperties, this._presets.getAnnotationOptions(isLeftClick))
            );
            this._context.addHelperAnnotation(polygon);
        }
        this._current = polygon;
        this._context.clearAnnotationSelection();
    }

    updateCreate(x, y) {
        if (!this._polygonBeingCreated) return;

        let last = this._pointArray[this._pointArray.length - 1],
            dy = last.top - y,
            dx = last.left - x;

        let powRad = this.getRelativePixelDiffDistSquared(15);
        if (dx * dx + dy * dy > powRad) {
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
     * @param {fabricjs.Polygon} obj object that is being approximated
     * @param {function} converter take two elements and convert and return item
     * @param {Number} quality between 0 and 1, of the approximation in percentage (1 = 100%)
     * @return {Array} array of items returned by the converter - points
     */
    toPointArray(obj, converter, quality=1) {

        let points = obj.get("points");
        if (quality < 1) points = this.simplifyQuality(points, quality);

        //we already have object points, convert only if necessary
        if (converter !== AnnotationObjectFactory.withObjectPoint) {
            let output = Array(result.length);
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
    }

    /**
     * THE FOLOWING CODE HAS BEEN COPIED OUT FROM A LIBRARY
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

    getRelativePixelDiffDistSquared(relativeDiff) {
        let pointA = PLUGINS.imageLayer.windowToImageCoordinates(new OpenSeadragon.Point(0, 0));
        let pointB = PLUGINS.imageLayer.windowToImageCoordinates(new OpenSeadragon.Point(relativeDiff, 0));
        return Math.pow(pointB.x - pointA.x, 2) + Math.pow(pointB.y - pointA.y, 2);
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
}

/**
 * Class that contains all logic for automatic annotation creation.
 */
class AutoObjectCreationStrategy {

    constructor(selfName, context) {
        this._currentTile = null;
        this._pixelReader = document.createElement('canvas');
        this._pixelReader.width = 1;
        this._pixelReader.height = 1;
        this._pixelReader = this._pixelReader.getContext('2d');
        this.alphaSensitivity = 1;
        this.comparator = function(pix) {
            //we read grayscale images
            return pix[0] > this.alphaSensitivity;
        }


        this._globalSelf = `${context.id}['${selfName}']`;
        this._currentTile = "";
        this._readingIndex = 0;

        const _this = this;
        PLUGINS.osd.addHandler('visualisation-used', function (visualisation) {
            let html = "";

            let index = -1;
            let layer = null;
            for (let key in visualisation.shaders) {
                layer = visualisation.shaders[key];
                if (layer.order === _this._readingIndex) {
                    index = layer.order;
                    html += `<option value='${key} selected'>${layer.name}</option>`;
                } else {
                    html += `<option value='${key}'>${layer.name}</option>`;
                }
            }

            if (index < 0) {
                _this._readingIndex = layer.order;
                html = "<option selected " + html.substr(8);
                _this.alphaSensitivity = layer.cache.hasOwnProperty('threshold') ?
                    layer.cache.threshold * 256 / 100 : 1;
            }
            $("#sensitivity-auto-outline").html(html);
        });
    }

    sensitivityControls() {
        return `<span class="d-inline-block" style="width:46%" title="What layer is used to create automatic 
annotations.">Target data layer:</span><select style="width:50%" title="What layer is selected for the data." 
type="number" id="sensitivity-auto-outline" class="form-control" onchange="
let layer = PLUGINS.seaGL.currentVisualisation().shaders[$(this).val()];
${this._globalSelf}._readingIndex = layer.order; ${this._globalSelf}.alphaSensitivity = 
layer.cache.hasOwnProperty('threshold') ? layer.cache.threshold * 256 / 100 : 1; "></select>
<br><button onclick="$('.to-delete').remove();"></button>`;
    }

    approximateBounds(point) {
		if (!this.changeTile(point)) {
		    return null;
        }
        let dimensionSize = Math.max(screen.width, screen.height);

		let origPixel = this.getPixelData(point);
		var x = point.x;
		var y = point.y;

		if (!this.comparator(origPixel)) {
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

    async createOutline(eventPosition) {
        if (!this.changeTile(eventPosition)) {
            return null;
        }
        let dimensionSize = Math.max(screen.width, screen.height);

        let points = [];
        const _this = this;

        var x = eventPosition.x;  // current x position
        var y = eventPosition.y;  // current y position
        var direction = "UP"; // current direction of outline

        let origPixel = this.getPixelData(eventPosition);
        if (!this.comparator(origPixel)) {
            console.warn("Outline algorithm exited: outside region.")
            return
        }

        let counter = 0;
        while (this.getAreaStamp(x, y) === 15 && counter < dimensionSize) {
            x += 2; //all neightbours inside, skip by two
            counter++;
        }
        if (counter >= dimensionSize) {
            return null;
        }
        x -= 2;

        $("#osd").append(`<span style="position:absolute; top:${y}px; left:${x}px; width:5px;height:5px; background:blue;" class="to-delete"></span>`);

        //indexing instead of switch
        //todo fix openseadragon_image_annotations reference
        var handlers = [
            // 0 - all neighbours outside, invalid
            function () { console.error("Fell out of region.") },

            // 1 - only TopLeft pixel inside
            function () {
                if (direction === "DOWN") {
                    direction = "LEFT";
                } else if (direction === "RIGHT") {
                    direction = "UP";
                } else { console.log("INVALID DIRECTION 1)"); return; }
                points.push(_this.toGlobalPointXY(x, y)); //changed direction
            },

            // 2 - only BottomLeft pixel inside
            function () {
                if (direction === "UP") {
                    direction = "LEFT";
                } else if (direction === "RIGHT") {
                    direction = "DOWN";
                } else { console.log("INVALID DIRECTION 2)"); return; }
                points.push(_this.toGlobalPointXY(x, y)); //changed direction
            },

            // 3 - TopLeft & BottomLeft pixel inside
            function () {
                if (direction !== "UP" && direction !== "DOWN") { console.log("INVALID DIRECTION 3)"); }
            },

            // 4 - only BottomRight pixel inside
            function () {
                if (direction === "UP") {
                    direction = "RIGHT";
                } else if (direction === "LEFT") {
                    direction = "DOWN";
                } else { console.log("INVALID DIRECTION 4)"); return; }
                points.push(_this.toGlobalPointXY(x, y)); //changed direction
            },

            // 5 - TopLeft & BottomRight pixel inside, one of them does not belong to the area
            function () {
                if (direction === "UP") {
                    direction = "RIGHT";
                } else if (direction === "LEFT") {
                    direction = "DOWN";
                } else if (direction === "RIGHT") {
                    direction = "UP";
                } else { direction = "LEFT"; }
                points.push(_this.toGlobalPointXY(x, y)); //changed direction
            },

            // 6 - BottomLeft & BottomRight pixel inside, one of them does not belong to the area
            function () {
                if (direction !== "LEFT" && direction !== "RIGHT") { console.log("INVALID DIRECTION 6)"); }
            },

            // 7 - TopLeft & BottomLeft & BottomRight  pixel inside, same case as TopRight only
            () => handlers[8](),

            // 8 - TopRight only
            function () {
                if (direction === "DOWN") {
                    direction = "RIGHT";
                } else if (direction === "LEFT") {
                    direction = "UP";
                } else { console.log("INVALID DIRECTION 8)"); return; }
                points.push(_this.toGlobalPointXY(x, y)); //changed direction
            },

            // 9 - TopLeft & TopRight
            function () {
                if (direction !== "LEFT" && direction !== "RIGHT") { console.log("INVALID DIRECTION 6)"); }
            },

            // 10 - BottomLeft & TopRight
            function () {
                if (direction === "UP") {
                    direction = "LEFT";
                } else if (direction === "LEFT") {
                    direction = "UP";
                } else if (direction === "RIGHT") {
                    direction = "DOWN";
                } else { direction = "RIGHT"; }
                points.push(_this.toGlobalPointXY(x, y)); //changed direction
            },

            // 11 - BottomLeft & TopRight & TopLeft --> case 4)
            () => handlers[4](),

            // 12 - TopRight & BottomRight
            function () {
                if (direction !== "TOP" && direction !== "DOWN") { console.log("INVALID DIRECTION 12)"); }
            },

            // 13 - TopRight & BottomRight & TopLeft
            () => handlers[2](),

            // 14 - TopRight & BottomRight & BottomLeft
            () => handlers[1](),

            // 15 - ALL inside
            function () { console.error("Fell out of region."); }
        ];

        let surroundingInspector = function (x, y, maxDist) {
            for (var i = 1; i <= maxDist; i++) {
                //$("#osd").append(`<span style="position:absolute; top:${y + i}px; left:${x + i}px; width:5px;height:5px; background:red;" class="to-delete"></span>`);

                if (_this.isValidPixel(new OpenSeadragon.Point(x + i, y)) > 0) return [x + i, y + i];
                //$("#osd").append(`<span style="position:absolute; top:${y - i}px; left:${x + i}px; width:5px;height:5px; background:red;" class="to-delete"></span>`);

                if (_this.isValidPixel(new OpenSeadragon.Point(x, y + i)) > 0) return [x + i, y - i];
                //$("#osd").append(`<span style="position:absolute; top:${y + i}px; left:${x - i}px; width:5px;height:5px; background:red;" class="to-delete"></span>`);

                if (_this.isValidPixel(new OpenSeadragon.Point(x - i, y)) > 0) return [x - i, y + i];
                //$("#osd").append(`<span style="position:absolute; top:${y - i}px; left:${x - i}px; width:5px;height:5px; background:red;" class="to-delete"></span>`);

                if (_this.isValidPixel(new OpenSeadragon.Point(x, y + i)) > 0) return [x - i, y - i];

            }
            return null;
        };

        const first_point = new OpenSeadragon.Point(x, y);
        let level = this._currentTile.level;
        const maxSpeed = 24;
        //todo speed based on pixel size instead?
        const speed = Math.round(maxSpeed / Math.max(1, 2 * (PLUGINS.imageLayer.source.maxLevel - level)));
        counter = 0;
        while ((Math.abs(first_point.x - x) > 2*speed || Math.abs(first_point.y - y) > 2*speed || counter < 20)
                && counter <= dimensionSize*8){
            let mark = this.getAreaStamp(x, y);
            if (mark === 0 || mark === 15) {
                let findClosest = surroundingInspector(x, y, 2 * speed);
                console.log("CLOSEST", findClosest);
                if (findClosest) {
                    x = findClosest[0];
                    y = findClosest[1];
                    points.push(this.toGlobalPointXY(x, y));
                    console.log("continue");
                    continue;
                } else {
                    console.warn("Outline algorithm exited: could not find close point on the outline.");
                    return;
                }
            }

            handlers[mark]();

            //todo instead of UP/LEFT etc. set directly
            switch (direction) {
                case 'UP': y--; break;
                case 'LEFT': x--; break;
                case 'RIGHT': x++; break;
                case 'DOWN': y++; break;
                default: console.error("Invalid direction");
            }
            counter++;

            $("#osd").append(`<span style="position:absolute; top:${y}px; left:${x}px; width:5px;height:5px; background:blue;" class="to-delete"></span>`);

            if (counter > 5000) {
                console.warn("Outline algorithm exited: iteration steps exceeded.");
                return;
            }

            if (counter % 100 === 0) { await sleep(200); }
        }
        if (points.length < 3) return null;
        let maxX = points[0].x, minX = points[0].x, maxY = points[0].y, minY = points[0].y;
        for (let i = 1; i < points.length; i++) {
            maxX = Math.max(maxX, points[i].x);
            maxY = Math.max(maxY, points[i].y);
            minX = Math.min(minX, points[i].x);
            minY = Math.min(minY, points[i].y);
        }
        //todo not constant, multiply by pixel ratio from zoom!!!
        if (maxX - minX < 15 && maxY - minY < 15) return null;
        return points;
    }



    toGlobalPointXY (x, y) {
		return PLUGINS.imageLayer.windowToImageCoordinates(new OpenSeadragon.Point(x, y));
	}

	toGlobalPoint (point) {
		return PLUGINS.imageLayer.windowToImageCoordinates(point);
	}

	/**
     * Find tile that contains the event point
     * @param {OpenSeadragon.Point} eventPosition point
     */
	changeTile(eventPosition) {
		let viewportPos = PLUGINS.osd.viewport.pointFromPixel(eventPosition);
		let tiles = PLUGINS.dataLayer.lastDrawn;
		for (let i = 0; i < tiles.length; i++) {
			if (tiles[i].bounds.containsPoint(viewportPos)) {
				this._currentTile = tiles[i];
				return true;
			}	
		}
		return false;
	}

	isValidPixel(eventPosition) {
		return this.comparator(this.getPixelData(eventPosition));
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
		var relative_x = Math.round((x / this._currentTile.size.x) * this._currentTile.context2D.canvas.width);
		var relative_y = Math.round((y / this._currentTile.size.y) * this._currentTile.context2D.canvas.height);

		//Images are stacked atop, get desired image by offsetting y
		relative_y += this._readingIndex * this._currentTile.context2D.canvas.height;

		this._pixelReader.drawImage(this._currentTile.origData, relative_x, relative_y, 1, 1, 0, 0, 1, 1);
		return this._pixelReader.getImageData(0, 0, 1, 1).data;
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
