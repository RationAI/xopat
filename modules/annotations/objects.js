/**
 * It is more an interface rather than actual class.
 * Any annotation object should extend this class and implement
 * necessary methods for its creation.
 * @class OSDAnnotations.AnnotationObjectFactory
 */
OSDAnnotations.AnnotationObjectFactory = class {

    /**
     * Constructor
     * @param {OSDAnnotations} context Annotation Plugin Context
     * @param {PresetManager} presetManager manager of presets or an object of similar interface
     * @param {string} identifier unique annotation identifier, start with '_' to avoid exporting
     *   - note that for now the export avoidance woks only for XML exports, JSON will include all
     * @param {string} objectType which shape type it maps to inside fabricJS
     */
    constructor(context, presetManager, identifier, objectType) {
        this._context = context;
        this._presets = presetManager;
        this.factoryID = identifier;
        this.type = objectType;
    }

    /**
     * Properties copied with 'all' (+exports())
     * instance ID is NOT exported and should not be exported.
     * @type {string[]}
     */
    static copiedProperties = [
        "left",
        "top",
        "width",
        "height",
        "fill",
        "isLeftClick",
        "opacity",
        "strokeWidth",
        "stroke",
        "scaleX",
        "scaleY",
        "color",
        "zoomAtCreation",
        "originalStrokeWidth",
        "type",
        "factoryID",
        "scaleX",
        "scaleY",
        "hasRotatingPoint",
        "borderColor",
        "cornerColor",
        "borderScaleFactor",
        "hasControls",
        "hasBorders",
        "lockMovementX",
        "lockMovementY",
        "meta",
        "sessionID",
        "presetID",
        "layerID",
        "id",
        "author",
        "created",
        "private",
        "comments",
        "label",
    ];

    /**
     * Properties copied with 'necessary' (+exports()), subset of copiedProperties
     * @type {string[]}
     */
    static necessaryProperties = [
        "factoryID",
        "type",
        "sessionID",
        "zoomAtCreation",
        "meta",
        "presetID",
        "layerID",
        "color",
        "author",
        "created",
        "id",
    ];

    /**
     * Geometry properties.
     * Used internally for cloning, when only geometry should be copied.
     * @type {string[]}
     */
    static geometryProps = [
        'left', 'top', 'originX', 'originY',
        'angle', 'flipX', 'flipY',
        'scaleX', 'scaleY',
        'skewX', 'skewY',
        'transformMatrix',
        'width', 'height',
        'strokeWidth', 'strokeDashArray', 'strokeLineCap',
        'strokeLineJoin', 'strokeMiterLimit', 'strokeUniform',
        'radius', 'rx', 'ry',
        'x1', 'y1', 'x2', 'y2',
        'points',
        'path', 'pathOffset'
    ];

    /**
     * Human-readable annotation title
     * @returns {string}
     */
    title() {
        return "Generic Object";
    }

    /**
     * What internal structure is kept by this annotation
     * @returns {string|string[]|string[][]} (possibly nested) list of types
     */
    fabricStructure() {
        return "object";
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
     * Get currently edited or created object.
     * If the mode is editing, it returns the currently edited object. It is a full-fledged annotation.
     *
     * If the mode is creating (not yet finished), it returns a helper annotation (or their list) instead.
     * Such a helper annotation must be added with addHelperAnnotation(). In this case, a list can be returned
     * too - for example, the ruler is created using a line and a text, two separate objects. When finished, a
     * group is created to attach to the canvas. When aborted, two helper items in an array are returned by this method.
     * @returns {(fabric.Object|[fabric.Object])}
     */
    getCurrentObject() {
        return null;
    }

    /**
     * Create an annotation object from given parameters, used mostly privately
     * @param {*} parameters geometry, depends on the object type
     * @param {object} options FbaricJS and custom options to set
     * todo since we use create to instaniate and also fabricjs to instantiate, get rid of create method
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
     * Force properties for correct rendering, ensure consitency on
     * the imported objects, e.g. you should use this function in create(...) to avoid implementing stuff twice,
     * e.g. in create assemble object, and pass it to the configure. Shortly: in create, merge two elements to
     * form a native configuration object, instantiate it and configure it here. Options should equal to options arg
     * from create.
     * @param object given object type for the factory type
     * @param options options for correct visuals creation, from presets, same as with create()
     * @return object from the input parameters (builder-like behaviour)
     */
    configure(object, options) {
        $.extend(object, options, {
            type: this.type,
            factoryID: this.factoryID,
        });
        return object;
    }

    /**
     * A list of extra custom properties to export upon export event
     * @return {string[]}
     */
    exports() {
        return [];
    }

    /**
     * A list of extra properties defining the object geometry required to be included
     * todo: replace with builtin fabricjs toObject call on each type class
     */
    exportsGeometry() {
        return [];
    }

    /**
     * Initialize object before import
     * @param {fabric.Object} object object to be initialized
     */
    initializeBeforeImport(object) {
        // do nothing by default
    }

    trimExportJSON(objectList) {
        let array = objectList;
        if (typeof array === "object") {
            array = objectList.objects;
        }
        return array;
    }

    /**
     * Iterate hierarchy of objects and deep-transform them using transformer
     * @param o object to iterate
     * @param transformer transformer function, receives parameters -
     *      the object x, current node in the hierarchy
     *      the boolean isRoot,
     *      the boolean isGroup, if this node can contain child nodes
     *      the object factory, reference to the annotation factory
     * @return {*}
     */
    iterate(o, transformer=x=>x) {
        const it = (x, isRoot, factory) => {
            //recursive clone of objects
            if (x.type !== "group") {
                return transformer(x, isRoot, false, factory);
            }
            let result = transformer(x, isRoot, true, factory);
            result.objects = x.objects?.map(y => it(y, false, factory));
            return result;
        };
        return it(o, true, this);
    }

    /**
     * Copy all module-recognized properties of object
     * @param ofObject
     * @param withAdditional
     * @param nested export inner properties of nested objects if true
     * @return {{}}
     */
    copyProperties(ofObject, withAdditional=[], nested=false) {
        if (nested) {
            return this.iterate(ofObject, (x, isRoot, isGroup, f) => {
                let res = isRoot ? f.copyProperties(x, withAdditional, false) : f.copyInnerProperties(x);
                if (isGroup) { //groups need BB so that it renders correctly
                    res.left = x.left;
                    res.top = x.top;
                    res.width = x.width;
                    res.height = x.height;
                }
                return res;
            });
        }

        const result = {};
        this.__copyProps(ofObject, result, this.constructor.copiedProperties, withAdditional);
        this.__copyInnerProps(ofObject, result);
        return result;
    }

    /**
     * Copy only necessary properties of object (subset of copyProperties)
     * @param ofObject
     * @param withAdditional
     * @param nested export inner properties of nested objects if true
     * @return {{}}
     */
    copyNecessaryProperties(ofObject, withAdditional=[], nested=false) {
        if (nested) {
            return this.iterate(ofObject, (x, isRoot, isGroup, f) => {
                let res = isRoot ? f.copyNecessaryProperties(x, withAdditional, false) : f.copyInnerProperties(x);
                if (isGroup) { //groups need BB so that it renders correctly
                    res.left = x.left;
                    res.top = x.top;
                    res.width = x.width;
                    res.height = x.height;
                }
                return res;
            });
        }

        const result = {};
        this.__copyProps(ofObject, result, this.constructor.necessaryProperties, withAdditional);
        this.__copyInnerProps(ofObject, result);
        return result;
    }

    /**
     * Copy only geometry and explicitly-defined properties (subset of copyNecessaryProperties)
     * @param ofObject
     */
    copyInnerProperties(ofObject) {
        const result = {};
        this.__copyInnerProps(ofObject, result);
        return result;
    }

    /**
     *
     * @param {string | (fabric.Object) => string} iconRenderer Either a plain icon string, or a callback that returns it
     * @param {string | (fabric.Object) => string | undefined} valueRenderer Either a plain value string, or a callback that returns it. undefined for no value.
     * @param {((event: any, transform: any, mouseX: any, mouseY: any) => any) | undefined} onClick mouseUpHandler of the control
     * @returns
     */
    renderIcon(iconRenderer, valueRenderer, onClick) {
        const control = new fabric.Control({
            x: 0.5,
            y: -0.5,
            offsetX: 25,
            offsetY: 20,
            cursorStyle: 'pointer',
            sizeX: 40,
            sizeY: 40,
            touchSizeX: 40,
            touchSizeY: 40,
            enabled: true,
            render: (ctx, left, top, styleOverride, fabricObject) => {
                const icon = typeof iconRenderer === 'string' ? iconRenderer : iconRenderer(fabricObject);
                const value = valueRenderer ? (
                    typeof valueRenderer === 'string' ? valueRenderer : valueRenderer(fabricObject)
                ) : null;
                const showValue = value !== null && value !== undefined && value !== '';

                const iconSize = 36;
                const padding = 8;

                let totalWidth = iconSize;
                let textWidth = 0;

                if (showValue) {
                    ctx.font = `${iconSize * 0.4}px Arial`;
                    textWidth = ctx.measureText(value).width;
                    totalWidth = iconSize + padding + textWidth + padding;
                }

                const height = iconSize;
                const radius = height / 2;

                const leftAlignedX = left + (totalWidth / 2) - (iconSize / 2);

                ctx.save();
                ctx.translate(leftAlignedX, top);
                ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle));

                const halfWidth = totalWidth / 2;

                ctx.beginPath();
                ctx.arc(-halfWidth + radius, 0, radius, Math.PI / 2, 3 * Math.PI / 2);
                ctx.arc(halfWidth - radius, 0, radius, 3 * Math.PI / 2, Math.PI / 2);
                ctx.closePath();

                ctx.fillStyle = 'white';
                ctx.fill();

                ctx.strokeStyle = 'black';
                ctx.lineWidth = 1;
                ctx.stroke();

                const iconX = -halfWidth + iconSize / 2;
                ctx.font = `${iconSize * 0.8}px "Material Icons"`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = 'black';
                ctx.fillText(icon, iconX, 3);

                if (showValue) {
                    const textX = iconX + iconSize / 2 + padding + textWidth / 2;
                    ctx.font = `${iconSize * 0.5}px Segoe UI`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = 'black';
                    ctx.fillText(value, textX, 1);
                }

                ctx.restore();
            },
        });

        control.positionHandler = (dim, finalMatrix, fabricObject) => {
            let visibleBefore = 0;
            const controls = fabricObject?.controls || {};
            for (const name of Object.keys(controls)) {
                const ctrl = controls[name];
                if (ctrl === control) break;
                let isVisible = true;
                try {
                    if (typeof ctrl.getVisibility === 'function') {
                        isVisible = !!ctrl.getVisibility(fabricObject, name);
                    } else if (fabricObject._controlsVisibility && name in fabricObject._controlsVisibility) {
                        isVisible = !!fabricObject._controlsVisibility[name];
                    } else if ('visible' in ctrl) {
                        isVisible = !!ctrl.visible;
                    }
                } catch {}
                if (isVisible) visibleBefore++;
            }

            const spacing = 45;
            const baseOffsetY = 20;
            const dynamicOffsetY = baseOffsetY + spacing * visibleBefore;

            const pt = { x: control.x * dim.x + control.offsetX, y: control.y * dim.y + dynamicOffsetY };
            return fabric.util.transformPoint(pt, finalMatrix);
        };

        if (onClick) {
            control.mouseUpHandler = function(eventData, transform, x, y) {
                onClick(eventData, transform, x, y);
                return true;
            };
        }

        return control;

    }

    renderAllControls(ofObject) { // TODO: Integrate with new code
//        const baseControls = fabric.Object.prototype.controls || {};
//        const controls = { ...baseControls};
//
//        controls.private = this.renderIcon(
//            (obj) => obj.private ? 'visibility_lock' : 'visibility',
//            undefined,
//            undefined,
//        );
//        const commentsControl = this.renderIcon(
//            'comment',
//            (obj) => obj.comments?.filter(c => !c.removed).length ?? 0,
//            () => {
//                this._context.raiseEvent('comments-control-clicked')
//            },
//        );
//        commentsControl.getVisibility = () => !!this._context.getCommentsEnabled();
//        controls.comments = commentsControl;
//
//        ofObject.controls = controls;
    }

    __copyProps(ofObject, toObject, defaultProps, additionalProps) {
        for (let prop of defaultProps) {
            toObject[prop] = ofObject[prop];
        }
        if (additionalProps?.length > 0) {
            for (let prop of additionalProps) {
                toObject[prop] = ofObject[prop];
            }
        }
        this.__copyInnerProps(ofObject, toObject);
    }

    __copyInnerProps(ofObject, toObject) {
        for (let prop of this.exports()) {
            toObject[prop] = ofObject[prop];
        }
        for (let prop of this.exportsGeometry()) {
            toObject[prop] = ofObject[prop];
        }
        toObject.type = ofObject.type; //always
    }


    /**
     * Create an object at given point with a given strategy
     * @param {OpenSeadragon.Point} screenPoint mouse coordinates (X|Y) in SCREEN coordinates
     *  that this is an exception, other methods work with image coord system
     * @param {boolean} isLeftClick true if the object was created using left mouse button
     * @return {boolean|undefined} true if creation succeeded, false if error, undefined if sailently fail
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
     * Undo of the last manual creation step
     */
    undoCreate() {
    }

    /**
     * Redo of the last manual creation step
     */
    redoCreate() {
    }

    /**
     * Discard active creation
     */
    discardCreate() {
    }

    /**
     * Finish object creation, if in progress. Can be called also if no object
     * is being created. This action was performed directly by the user.
     * @return {boolean} true if object finished; when factory for example
     *   decide not yet to finish, this should return false. Return true
     *   if you are not sure.
     */
    finishDirect() {
        return true;
    }

    /**
     * Finish object creation, if in progress. Can be called also if no object
     * is being created. This action was enforced by the environment (i.e.
     * performed by the user indirectly). Thus, it shall finish the object creation
     * at all costs - usually, an annotation mode will be changing.
     */
    finishIndirect() {
    }

    /**
     * Check if factory (or its current state) will handle undoCreate() call
     * @return {boolean|undefined}
     *   true if undoCreate() will undo one manual creation step,
     *   false if undo will not be able to be called, but should be blocked
     *   undefined if undo will not be handled and super() logics should take over
     */
    canUndoCreate() {
        return undefined;
    }

    /**
     * Check if factory (or its current state) will handle redoCreate() call
     * @return {boolean|undefined}
     *   true if redoCreate() will undo one manual creation step,
     *   false if undo will not be able to be called, but should be blocked
     *   undefined if undo will not be handled and super() logics should take over
     */
    canRedoCreate() {
        return undefined;
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
     * @param {boolean} [ignoreReplace=false] skip the fabric.replaceAnnotation call
     */
    recalculate(theObject, ignoreReplace=false) {
    }

    /**
     * Update the object coordinates to the set position
     * @param {fabric.Object} theObject object to translate
     * @param {Object} pos new position of object
     * @param {number} pos.x new x value
     * @param {number} pos.y new y value
     * @param {'move' | 'set'} [pos.mode='set'] whether to 'move' annotation from its existing position or 'set' a new one.
     * @param {boolean} [ignoreReplace=false] skip the fabric.replaceAnnotation call
     */
    translate(theObject, pos, ignoreReplace=false) {
        let x, y;
        if (pos.mode === 'move') {
            x = theObject.left + pos.x;
            y = theObject.top + pos.y;
        } else {
            x = pos.x;
            y = pos.y;
        }
        theObject.top = y;
        theObject.left = x;
        this.recalculate(theObject, ignoreReplace);
        return theObject;
    }

    /**
     * Compute the area of the object in pixels (image dimension) squared
     * @param {fabric.Object} theObject recalculate the object that has been modified
     * @return {Number|undefined} undefined if area not measure-able
     */
    getArea(theObject) {
        return undefined;
    }

    /**
     * Returns the length of the object if applicable (for objects that do not have area).
     * By default, returns undefined. Should be overridden in subclasses for line-like objects.
     * @param {fabric.Object} theObject object to measure
     * @return {Number|undefined} length in pixels and unit, or undefined if not applicable
     */
    getLength(theObject) {
        return undefined;
    }

    /**
     * Zoom event on canvas, update necessary properties to stay visually appleasing
     * @param {fabric.Object} ofObject
     * @param {number} graphicZoom scaled zoom value to better draw graphics (e.g. thicker lines for closer zoom)
     * @param {number} realZoom real zoom value of the viewer (real zoom, linearly keep scale consistent, for example text)
     */
    onZoom(ofObject, graphicZoom, realZoom) {
        //todo try to use iterate method :D

        ofObject.set({
            strokeWidth: ofObject.originalStrokeWidth/graphicZoom
        });
        // // Update object properties to reflect zoom
        // var updater = function(x) {
        //     //todo unify this somehow using a function callback with the limitation, e.g. call only resize when the difference is significant
        //     if (x.type == "text") {
        //         x.set({
        //             scaleX: 1/zoom,
        //             scaleY: 1/zoom
        //         });
        //     } else {
        //         x.set({
        //             strokeWidth: x.originalStrokeWidth/zoom
        //         });
        //     }
        // }
    }

    _copyVal(val) {
        if (Array.isArray(val)) {
            return val.map(item => this._copyVal(item));
        }
        if (val && typeof val === 'object') {
            const copy = {};
            for (const key in val) {
                if (val.hasOwnProperty(key)) copy[key] = this._copyVal(val[key]);
            }
            return copy;
        }
        return val;
    }

    _cloneFabricObject(theObject, customProps = []) {
        const toCopy = [...this.constructor.geometryProps, ...customProps];

        let cloned;
        try {
            cloned = new theObject.constructor();
        } catch (e) {
            cloned = new fabric.Object();
        }

        const props = {};
        toCopy.forEach(p => {
          if (theObject[p] !== undefined) props[p] = this._copyVal(theObject[p]);
        });

        cloned.set(props);

        if (theObject.path && !cloned.path) cloned.path = this._copyVal(theObject.path);
        if (theObject.points && !cloned.points) cloned.points = this._copyVal(theObject.points);

        cloned.setCoords();
        return cloned;
    }

    /**
     * Create highlight object for the given object
     * @param {fabric.Object} theObject object to highlight
     * @return {fabric.Object|null} highlight object or null on error
     */
    createHighlight(theObject) {
        try {
            const clonedObj = this._cloneFabricObject(theObject, [
                "originalStrokeWidth",
                "cornerColor",
                "borderColor",
                //"factoryID"
            ]);

            let newStroke = theObject.strokeWidth * 5;
            let newStrokeDashArray = [newStroke * 3, newStroke * 2];

            clonedObj.set({
                fill: '',
                stroke: theObject.borderColor,
                strokeWidth: newStroke,
                strokeDashArray: newStrokeDashArray,
                strokeLineCap: 'round',
                strokeUniform: true,
                left: clonedObj.left + clonedObj.width / 2,
                top: clonedObj.top + clonedObj.height / 2,
                originX: 'center',
                originY: 'center',
                selectable: false,
                evented: false,
                opacity: 1,
                hasControls: false,
                hasBorders: false,
                isHighlight: true,
                excludeFromExport: true
            });
            delete clonedObj.type;

            return clonedObj;
        } catch (error) {
            console.error("Error in selected function:", error);
            return null;
        }
    }

    /**
     * Called when object is selected
     * @param {fabric.Object} theObject selected fabricjs object
     */
    selected(theObject) {
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
     * If the object supports free form tool transformation
     * @return {boolean}
     */
    supportsBrush() {
        return true;
    }

    /**
     * Update object rendering based on rendering mode
     * @param {object} ofObject
     * @param {OSDAnnotations.Preset} preset
     * @param {OSDAnnotations.CommonAnnotationVisuals} visualProperties must be a modifiable object, will be used
     * @param {OSDAnnotations.CommonAnnotationVisuals} defaultVisualProperties will not be touched
     */
    updateRendering(ofObject, preset, visualProperties, defaultVisualProperties) {
        //todo possible issue if someone sets manually single object prop
        // (e.g. show borders) and then system triggers update (open history window)

        if (typeof ofObject.color === 'string') {
            const props = visualProperties;

            const color = preset.color;
            const stroke = visualProperties.stroke || defaultVisualProperties.stroke;
            // todo consider respecting object property here? or implement by locking (see todo above)
            const modeOutline = visualProperties.modeOutline !== undefined ? visualProperties.modeOutline : defaultVisualProperties.modeOutline;
            if (modeOutline) {
                props.stroke = color;
                props.fill = "";
            } else {
                props.stroke = stroke;
                props.fill = color;
            }

            if (visualProperties.originalStrokeWidth && visualProperties.originalStrokeWidth !== ofObject.strokeWidth) {
                // Todo optimize this to avoid re-computation of the values... maybe set the value on object zooming event
                const canvas = this._context.fabric.canvas;
                props.strokeWidth = visualProperties.originalStrokeWidth / canvas.computeGraphicZoom(canvas.getZoom());
            } else {
                // Shared props object carries over the value
                delete props.strokeWidth;
            }
            ofObject.set(props);
        }
    }

    /**
     * Apply selection style to the object
     * @param {*} ofObject
     */
    applySelectionStyle(ofObject) {
        ofObject.set({
            stroke: 'rgba(251, 184, 2, 0.75)',
        });
    }


    /**
     * Resolve annotation text from preset metadata (category) and render it on the object.
     * Intended for text-based objects.
     * @param {*} ofObject
     */
    renderPresetText(ofObject) {
    }

    /**
     * Create array of points - approximation of the object shape. This method should be overridden.
     * For groups, it should return the best possible approximation via single array of points
     * (or nested points see multipolygons). If difficult, you can return undefined,
     * in that case some features will not work (like exporting to some formats!).
     *
     * For multipolygons, it should return [ [bounding polygon points], [hole1] .... ].
     * Usage of withObjectPoint and withArrayPoint as converter.
     *
     * @param {fabric.Object} obj object that is being approximated
     * @param {function} converter take two elements and convert and return item, see
     *  withObjectPoint, withArrayPoint
     * @param {number} digits decimal precision, default undefined
     * @param {number} quality between 0 and 1, of the approximation in percentage (1 = 100%)
     * @return {Array} array of items returned by the converter - points or arrays in case of multipolygon
     */
    toPointArray(obj, converter, digits=undefined, quality=1) {
        return undefined;
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

    /**
     * Revert toPointArray, useful for converters when they need to serialize unsupported object type.
     * Usage of fromObjectPoint or fromArrayPoint as deconvertors.
     *
     * @param {Array} obj approximated object
     * @param {function} deconvertor take two elements and convert and return item, see
     *  fromObjectPoint, fromArrayPoint.
     * @return {object} object suitable for create(...) call of the given factory
     */
    fromPointArray(obj, deconvertor) {
        return undefined;
    }

    /**
     * Strategy de-convertor, converts point to an object compatible with the internal point representation.
     */
    static fromObjectPoint(point) {
        return point; //identity
    }

    /**
     * Strategy de-convertor, converts point to an object compatible with the internal point representation.
     */
    static fromArrayPoint(point) {
        return {x: point[0], y: point[1]};
    }
};

/**
 * Polygon Utilities that can help with points array simplification and more
 * todo move here stuff from magic wand code
 */
OSDAnnotations.PolygonUtilities = {

    intersectAABB: function (a, b) {
        const dx = a.x - b.x;
        const px = (a.width + b.width) - Math.abs(dx);
        if (px <= 0) {
            return false;
        }

        const dy = a.y - b.y;
        const py = (a.height + b.height) - Math.abs(dy);
        return py > 0;

    },

    simplify: function (points, highestQuality = true) {
        if (points.length <= 2) return points;

        // desired visual tolerance in screen pixels
        const desiredScreenTol = 15;
        let pxSize = VIEWER.scalebar.imagePixelSizeOnScreen() || 1;

        // convert to image coords
        let tolerance = desiredScreenTol / pxSize;

        // CLAMP to keep polygons sane at huge zooms
        const MIN_TOL = 1.5;   // at least ~1–2 image pixels
        const MAX_TOL = 100;   // avoid over-simplifying at tiny zoom
        if (!isFinite(tolerance)) tolerance = MIN_TOL;
        tolerance = Math.max(MIN_TOL, Math.min(MAX_TOL, tolerance));

        points = highestQuality
            ? points
            : this._simplifyRadialDist(points, tolerance * tolerance);

        return this._simplifyDouglasPeucker(points, tolerance);
    },

    simplifyQuality: function (points, imagePixelOnScreen, quality) {
        if (points.length <= 2) return points;

        //todo decide empirically on the constant value (quality = 0 means how big relative distance?)
        let tolerance = (15 - 12*quality) / imagePixelOnScreen;
        return this._simplifyDouglasPeucker(this._simplifyRadialDist(points, Math.pow(tolerance, 2)), tolerance);
    },

    approximatePolygonArea: function (points) {
        if (!points || points.length < 3) return { diffX: 0, diffY: 0 };
        const bbox = this.getBoundingBox(points);

        return { diffX: bbox.width, diffY: bbox.height };
    },

    getBoundingBox: function (points) {
		if (!points || points.length === 0) return null;

        let maxX = points[0].x, minX = points[0].x, maxY = points[0].y, minY = points[0].y;

		for (let i = 0; i < points.length; i++) {
            const point = points[i];
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }

		return {
			x: minX,
			y: minY,
			width: maxX - minX,
			height: maxY - minY
		};
	},

    /**
     *  https://gist.github.com/cwleonard/e124d63238bda7a3cbfa
     *  To detect intersection with another Polygon object, this
     *  function uses the Separating Axis Theorem. It returns false
     *  if there is no intersection, or an object if there is. The object
     *  contains 2 fields, overlap and axis. Moving the polygon by overlap
     *  on axis will get the polygons out of intersection.
     *
     *  WARNING: the intersection does not work for 'eaten' polygons (one polygon inside another)
     *
     *  @Aiosa Cleaned. Honestly, why people who are good at math cannot keep their code clean.
     */
    polygonsIntersect(p1, p2) {
        let axis = {x: 0, y: 0},
            tmp, minA, maxA, minB, maxB, side, i,
            smallest = null,
            overlap = 99999999,
            p1Pts = p1.points || p1, p2Pts = p2.points || p2;

        /* test polygon A's sides */
        for (side = 0; side < p1Pts.length; side++) {
            /* get the axis that we will project onto */
            if (side == 0) {
                axis.x = p1Pts[p1Pts.length - 1].y - p1Pts[0].y;
                axis.y = p1Pts[0].x - p1Pts[p1Pts.length - 1].x;
            } else {
                axis.x = p1Pts[side - 1].y - p1Pts[side].y;
                axis.y = p1Pts[side].x - p1Pts[side - 1].x;
            }

            /* normalize the axis */
            tmp = Math.sqrt(axis.x * axis.x + axis.y * axis.y);
            axis.x /= tmp;
            axis.y /= tmp;

            /* project polygon A onto axis to determine the min/max */
            minA = maxA = p1Pts[0].x * axis.x + p1Pts[0].y * axis.y;
            for (i = 1; i < p1Pts.length; i++) {
                tmp = p1Pts[i].x * axis.x + p1Pts[i].y * axis.y;
                if (tmp > maxA) maxA = tmp;
                else if (tmp < minA) minA = tmp;
            }
            /* correct for offset */
            tmp = axis.x +  axis.y;
            minA += tmp;
            maxA += tmp;

            /* project polygon B onto axis to determine the min/max */
            minB = maxB = p2Pts[0].x * axis.x + p2Pts[0].y * axis.y;
            for (i = 1; i < p2Pts.length; i++) {
                tmp = p2Pts[i].x * axis.x + p2Pts[i].y * axis.y;
                if (tmp > maxB) maxB = tmp;
                else if (tmp < minB) minB = tmp;
            }
            /* correct for offset */
            tmp =  axis.x +  axis.y;
            minB += tmp;
            maxB += tmp;

            /* test if lines intersect, if not, return false */
            if (maxA < minB || minA > maxB) {
                return undefined;
            } else {
                let o = (maxA > maxB ? maxB - minA : maxA - minB);
                if (o < overlap) {
                    overlap = o;
                    smallest = {x: axis.x, y: axis.y};
                }
            }
        }

        /* test polygon B's sides */
        for (side = 0; side < p2Pts.length; side++) {
            /* get the axis that we will project onto */
            if (side == 0) {
                axis.x = p2Pts[p2Pts.length - 1].y - p2Pts[0].y;
                axis.y = p2Pts[0].x - p2Pts[p2Pts.length - 1].x;
            } else {
                axis.x = p2Pts[side - 1].y - p2Pts[side].y;
                axis.y = p2Pts[side].x - p2Pts[side - 1].x;
            }

            /* normalize the axis */
            tmp = Math.sqrt(axis.x * axis.x + axis.y * axis.y);
            axis.x /= tmp;
            axis.y /= tmp;

            /* project polygon A onto axis to determine the min/max */
            minA = maxA = p1Pts[0].x * axis.x + p1Pts[0].y * axis.y;
            for (i = 1; i < p1Pts.length; i++)
            {
                tmp = p1Pts[i].x * axis.x + p1Pts[i].y * axis.y;
                if (tmp > maxA)
                    maxA = tmp;
                else if (tmp < minA)
                    minA = tmp;
            }
            /* correct for offset */
            tmp =  axis.x + axis.y;
            minA += tmp;
            maxA += tmp;

            /* project polygon B onto axis to determine the min/max */
            minB = maxB = p2Pts[0].x * axis.x + p2Pts[0].y * axis.y;
            for (i = 1; i < p2Pts.length; i++)
            {
                tmp = p2Pts[i].x * axis.x + p2Pts[i].y * axis.y;
                if (tmp > maxB) maxB = tmp;
                else if (tmp < minB) minB = tmp;
            }
            /* correct for offset */
            tmp =  axis.x + axis.y;
            minB += tmp;
            maxB += tmp;

            /* test if lines intersect, if not, return false */
            if (maxA < minB || minA > maxB) {
                return undefined;
            } else {
                var o = (maxA > maxB ? maxB - minA : maxA - minB);
                if (o < overlap) {
                    overlap = o;
                    smallest = {x: axis.x, y: axis.y};
                }
            }
        }
        return overlap;
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
