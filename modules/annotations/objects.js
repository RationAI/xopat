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
            offsetX: 22,
            offsetY: -16,
            cursorStyle: 'pointer',
            sizeX: 34,
            sizeY: 34,
            touchSizeX: 40,
            touchSizeY: 40,
            enabled: true,
            render: (ctx, left, top, styleOverride, fabricObject) => {
                const rawIcon = typeof iconRenderer === 'string' ? iconRenderer : iconRenderer(fabricObject);
                const icon = this._resolveControlGlyph(rawIcon);

                const rawValue = valueRenderer
                    ? (typeof valueRenderer === 'string' ? valueRenderer : valueRenderer(fabricObject))
                    : null;

                const showValue = rawValue !== null && rawValue !== undefined && rawValue !== '' && Number(rawValue) > 0;
                const value = showValue ? String(rawValue) : '';

                const iconSize = 18;
                const padding = 8;
                let textWidth = 0;

                if (showValue) {
                    ctx.font = `600 11px Arial`;
                    textWidth = ctx.measureText(value).width;
                }

                const bubbleHeight = 24;
                const bubbleWidth = showValue
                    ? (iconSize + padding * 2 + 8 + textWidth)
                    : (iconSize + padding * 2);

                const radius = bubbleHeight / 2;

                ctx.save();
                ctx.translate(left, top);
                ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle || 0));

                const x = -bubbleWidth / 2;
                const y = -bubbleHeight / 2;

                ctx.beginPath();
                ctx.moveTo(x + radius, y);
                ctx.lineTo(x + bubbleWidth - radius, y);
                ctx.arcTo(x + bubbleWidth, y, x + bubbleWidth, y + radius, radius);
                ctx.lineTo(x + bubbleWidth, y + bubbleHeight - radius);
                ctx.arcTo(x + bubbleWidth, y + bubbleHeight, x + bubbleWidth - radius, y + bubbleHeight, radius);
                ctx.lineTo(x + radius, y + bubbleHeight);
                ctx.arcTo(x, y + bubbleHeight, x, y + bubbleHeight - radius, radius);
                ctx.lineTo(x, y + radius);
                ctx.arcTo(x, y, x + radius, y, radius);
                ctx.closePath();

                ctx.fillStyle = 'white';
                ctx.fill();
                ctx.strokeStyle = 'black';
                ctx.lineWidth = 1;
                ctx.stroke();

                const iconCenterX = x + padding + iconSize / 2;

                ctx.font = `900 ${iconSize}px "Font Awesome 6 Free"`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = 'black';
                ctx.fillText(icon, iconCenterX, 1);

                if (showValue) {
                    ctx.font = `600 11px Arial`;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(value, x + padding + iconSize + 8, 1);
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

            const spacing = 30;
            const baseOffsetY = -16;
            const dynamicOffsetY = baseOffsetY - spacing * visibleBefore;

            const pt = {
                x: control.x * dim.x + control.offsetX,
                y: control.y * dim.y + dynamicOffsetY
            };
            return fabric.util.transformPoint(pt, finalMatrix);
        };

        if (onClick) {
            control.mouseUpHandler = function(eventData, transform, x, y) {
                eventData?.preventDefault?.();
                eventData?.stopPropagation?.();

                const wrapper = transform?.target?._factory?.()?._context?.fabric;
                if (wrapper) {
                    wrapper._controlInteractionActive = false;
                    wrapper.module.cursor.isDown = false;
                    wrapper.module.cursor.mouseTime = Infinity;
                }

                onClick(eventData, transform, x, y);
                return true;
            };
        }

        return control;
    }

    _resolveControlGlyph(icon) {
        const map = {
            'fa-eye': '\uf06e',
            'fa-eye-slash': '\uf070',
            'fa-lock': '\uf023',
            'fa-lock-open': '\uf3c1',
            'fa-comments': '\uf086',
            'fa-comment-medical': '\uf7f5',
            'fa-ellipsis-h': '\uf141',
        };
        return map[icon] || icon || '?';
    }

    renderAllControls(ofObject) {
        ofObject.controls = {
            toolbar: this._renderToolbarControl(),
        };
        ofObject.hasControls = false;
        ofObject.hasBorders = false;
    }

    /**
     * Single combined toolbar pill: comment-with-plus + lock + ellipsis.
     * Per-slot hit-testing in mouseUpHandler dispatches to the matching action.
     * Comments slot is omitted when the comments feature is disabled.
     */
    _renderToolbarControl() {
        const self = this;
        const ICON_SIZE = 18;
        const PAD_X = 10;
        const SLOT_GAP = 12;
        const TEXT_GAP = 6;
        const HEIGHT = 26;
        const RADIUS = HEIGHT / 2;
        // Pill alpha = min(1, annotation.opacity * factor). Annotation at 0
        // hides the pill entirely (and disables clicks).
        const LABEL_OPACITY_FACTOR = 2;

        const slotsFor = (target) => {
            const slots = [];
            const commentsOn = !!self._context.getCommentsEnabled?.();
            if (commentsOn) {
                const n = target?.comments
                    ? target.comments.filter(c => !c.removed).length
                    : 0;
                slots.push({
                    id: 'comments',
                    icon: 'fa-comment-medical',
                    countText: n > 0 ? String(n) : '',
                    onClick: () => self._context.raiseEvent('comments-control-clicked', { object: target }),
                });
            }
            slots.push({
                id: 'lock',
                icon: target?.private ? 'fa-lock' : 'fa-lock-open',
                countText: '',
                onClick: () => {
                    const wrapper = self._context.fabric;
                    if (wrapper && target) wrapper.setAnnotationPrivate(target, !target.private);
                },
            });
            slots.push({
                id: 'more',
                icon: 'fa-ellipsis-h',
                countText: '',
                onClick: (eventData) => {
                    self._context.raiseEvent('annotation-more-clicked', {
                        object: target,
                        clientX: eventData?.clientX,
                        clientY: eventData?.clientY,
                    });
                },
            });
            return slots;
        };

        const control = new fabric.Control({
            // Anchor via custom positionHandler using calcLineCoords() —
            // rotation-correct under OSD-driven vpt rotation (fabric's
            // default calcOCoords math is broken when vpt has off-diagonal
            // terms). See annotations.js::_init for the same trick on the
            // stock corner/edge handles.
            x: 0,
            y: -0.5,
            offsetX: 0,
            offsetY: -22,
            cursorStyle: 'pointer',
            sizeX: 120,
            sizeY: HEIGHT,
            touchSizeX: 140,
            touchSizeY: HEIGHT + 8,
            enabled: true,
            positionHandler: function (dim, finalMatrix, fabricObject) {
                if (!fabricObject?.canvas?.__spatialIndex) {
                    return fabric.util.transformPoint({
                        x: this.x * dim.x + this.offsetX,
                        y: this.y * dim.y + this.offsetY,
                    }, finalMatrix);
                }
                const c = fabricObject.calcLineCoords();
                const midTopX = (c.tl.x + c.tr.x) / 2;
                const midTopY = (c.tl.y + c.tr.y) / 2;
                const cx = (c.tl.x + c.br.x) / 2;
                const cy = (c.tl.y + c.br.y) / 2;
                const dx = midTopX - cx;
                const dy = midTopY - cy;
                const len = Math.hypot(dx, dy) || 1;
                return new fabric.Point(midTopX + (dx / len) * 22, midTopY + (dy / len) * 22);
            },
            render: (ctx, left, top, _styleOverride, fabricObject) => {
                const slots = slotsFor(fabricObject);
                if (!slots.length) {
                    control._zones = [];
                    return;
                }

                // Tie label visibility to annotation opacity. At 0 the pill
                // disappears and is non-clickable (empty zones). Otherwise
                // the pill renders at min(1, opacity * factor) so dimmed
                // annotations still get readable labels.
                const annOpacity = fabricObject.opacity ?? 1;
                if (annOpacity <= 0) {
                    control._zones = [];
                    return;
                }
                const pillAlpha = Math.min(1, annOpacity * LABEL_OPACITY_FACTOR);

                // Measure each slot's intrinsic width.
                let totalContentW = 0;
                for (const s of slots) {
                    let w = ICON_SIZE;
                    if (s.countText) {
                        ctx.font = `600 11px Arial`;
                        w += TEXT_GAP + ctx.measureText(s.countText).width;
                    }
                    s._width = w;
                    totalContentW += w;
                }
                const bubbleWidth = totalContentW + PAD_X * 2 + SLOT_GAP * (slots.length - 1);

                // Pill icons/text must stay screen-axis-aligned for
                // readability, even though the anchor follows the rotated
                // OBB. fabric's _renderControls already wraps render() in
                // ctx.rotate(obj.angle); when OSD drives rotation,
                // obj.angle stays 0 so we don't need (and don't want) any
                // extra rotation here.
                ctx.save();
                ctx.globalAlpha *= pillAlpha;
                ctx.translate(left, top);

                const x = -bubbleWidth / 2;
                const y = -HEIGHT / 2;

                // Pill background
                ctx.beginPath();
                ctx.moveTo(x + RADIUS, y);
                ctx.lineTo(x + bubbleWidth - RADIUS, y);
                ctx.arcTo(x + bubbleWidth, y,         x + bubbleWidth, y + RADIUS,        RADIUS);
                ctx.lineTo(x + bubbleWidth, y + HEIGHT - RADIUS);
                ctx.arcTo(x + bubbleWidth, y + HEIGHT, x + bubbleWidth - RADIUS, y + HEIGHT, RADIUS);
                ctx.lineTo(x + RADIUS, y + HEIGHT);
                ctx.arcTo(x, y + HEIGHT, x, y + HEIGHT - RADIUS, RADIUS);
                ctx.lineTo(x, y + RADIUS);
                ctx.arcTo(x, y, x + RADIUS, y, RADIUS);
                ctx.closePath();
                ctx.fillStyle = 'white';
                ctx.fill();
                ctx.strokeStyle = 'black';
                ctx.lineWidth = 1;
                ctx.stroke();

                // Walk slots, draw glyph + optional count, record local zones.
                const zones = [];
                let cursor = x + PAD_X;
                for (let i = 0; i < slots.length; i++) {
                    const s = slots[i];
                    const slotStart = cursor;

                    // Hit-zone covers slot content + half the gap on each side
                    // (or the pill's padding on the outer edges).
                    const zoneLeftPad  = i === 0 ? PAD_X : SLOT_GAP / 2;
                    const zoneRightPad = i === slots.length - 1 ? PAD_X : SLOT_GAP / 2;

                    // Draw icon
                    const iconCenterX = slotStart + ICON_SIZE / 2;
                    ctx.font = `900 ${ICON_SIZE}px "Font Awesome 6 Free"`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = 'black';
                    ctx.fillText(self._resolveControlGlyph(s.icon), iconCenterX, 1);
                    cursor += ICON_SIZE;

                    if (s.countText) {
                        ctx.font = `600 11px Arial`;
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(s.countText, cursor + TEXT_GAP, 1);
                        cursor += TEXT_GAP + (s._width - ICON_SIZE);
                    }

                    zones.push({
                        id: s.id,
                        x0: slotStart - zoneLeftPad,
                        x1: cursor + zoneRightPad,
                        onClick: s.onClick,
                    });

                    cursor += SLOT_GAP;
                }

                control._zones = zones;
                control._lastLeft = left;
                control._lastTop = top;
                control._lastAngle = 0;
                // Match the hit region to the actual pill so clicks land on
                // any icon, not just a 34px square in the middle. Fabric uses
                // sizeX/sizeY for control hit-testing in _findTargetCorner.
                control.sizeX = bubbleWidth;
                control.sizeY = HEIGHT;
                control.touchSizeX = bubbleWidth + 12;
                control.touchSizeY = HEIGHT + 8;
                ctx.restore();
            },
        });

        control.mouseUpHandler = function (eventData, transform, x, y) {
            eventData?.preventDefault?.();
            eventData?.stopPropagation?.();

            const target = transform?.target;
            if (!target) return false;

            const wrapper = target?._factory?.()?._context?.fabric;
            if (wrapper) {
                wrapper._controlInteractionActive = false;
                wrapper.module.cursor.isDown = false;
                wrapper.module.cursor.mouseTime = Infinity;
            }

            const zones = control._zones;
            if (!zones || !zones.length || control._lastLeft == null) return true;

            // Fabric calls mouseUpHandler with (x, y) from `canvas.getPointer(e)`
            // which returns IMAGE-space coords (pre-viewport-transform). The
            // pill's recorded `_lastLeft`/`_lastTop` come from positionHandler's
            // `finalMatrix` — SCREEN-space. Bring the pointer to screen-space
            // before computing pill-local offsets.
            const canvas = target.canvas;
            const vpt = canvas && canvas.viewportTransform;
            let sx = x, sy = y;
            if (vpt) {
                const p = fabric.util.transformPoint({ x, y }, vpt);
                sx = p.x;
                sy = p.y;
            }

            // Pill content is rendered screen-axis-aligned (no rotation in
            // render()), so the click's pill-local x is just the screen-
            // space horizontal offset from the recorded center.
            const localX = sx - control._lastLeft;

            const slot = zones.find(z => localX >= z.x0 && localX <= z.x1);
            if (slot && typeof slot.onClick === 'function') {
                try { slot.onClick(eventData); } catch (e) { console.error(e); }
            }
            return true;
        };

        return control;
    }

    __cloneValue(value) {
        if (value === null || value === undefined) return value;
        if (typeof value !== "object") return value;

        try {
            if (typeof structuredClone === "function") {
                return structuredClone(value);
            }
        } catch (e) {
            // fallback below
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            return value;
        }
    }

    __copyProps(ofObject, toObject, defaultProps, additionalProps) {
        for (let prop of defaultProps) {
            toObject[prop] = this.__cloneValue(ofObject[prop]);
        }
        if (additionalProps?.length > 0) {
            for (let prop of additionalProps) {
                toObject[prop] = this.__cloneValue(ofObject[prop]);
            }
        }
        this.__copyInnerProps(ofObject, toObject);
    }

    __copyInnerProps(ofObject, toObject) {
        for (let prop of this.exports()) {
            toObject[prop] = this.__cloneValue(ofObject[prop]);
        }
        for (let prop of this.exportsGeometry()) {
            toObject[prop] = this.__cloneValue(ofObject[prop]);
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
     * @return {fabric.Object} modified or original object
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
     * Translate the annotation IN PLACE by the given delta.
     *
     * Unlike `translate`, this does not create a copy / replace through the
     * IO pipeline — it directly mutates the live object. Used for:
     *  - paste at a target position (the caller computes deltaX/deltaY)
     *  - drag-end sync (fabric already updated left/top; this brings the
     *    object's internal geometry — e.g. polygon `.points` — in line so
     *    exports and hit-tests stay consistent)
     *
     * Subclasses with point-based geometry (polygon, polyline, ruler) must
     * override `_applyMoveToGeometry` to translate their internal points.
     *
     * @param {fabric.Object} theObject
     * @param {number} deltaX image-space x delta
     * @param {number} deltaY image-space y delta
     * @param {boolean} [skipLeftTop=false] when true, fabric already moved
     *   left/top (e.g. drag); we only need to bring the internal geometry
     *   in sync.
     */
    move(theObject, deltaX, deltaY, skipLeftTop=false) {
        if (!deltaX && !deltaY) {
            theObject.setCoords();
            return theObject;
        }
        if (!skipLeftTop) {
            theObject.set({
                left: theObject.left + deltaX,
                top: theObject.top + deltaY,
            });
        }
        this._applyMoveToGeometry(theObject, deltaX, deltaY);
        theObject.setCoords();
        return theObject;
    }

    /**
     * Hook for subclasses to translate point-based geometry by the same
     * delta `move` applied to left/top. Base implementation is a no-op —
     * intrinsic-shape factories (ellipse, rect, text) need nothing because
     * their geometry is fully derived from left/top + their size params.
     *
     * @param {fabric.Object} theObject
     * @param {number} deltaX
     * @param {number} deltaY
     */
    _applyMoveToGeometry(theObject, deltaX, deltaY) {
        // base no-op
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

            const center = theObject.getCenterPoint();

            clonedObj.set({
                fill: '',
                // border color === control UI color, stroke == class
                stroke: theObject.borderColor,
                strokeWidth: newStroke,
                strokeDashArray: newStrokeDashArray,
                strokeLineCap: 'round',
                strokeUniform: !!theObject.strokeUniform,

                originX: 'center',
                originY: 'center',
                left: center.x,
                top: center.y,

                angle: theObject.angle || 0,
                scaleX: theObject.scaleX ?? 1,
                scaleY: theObject.scaleY ?? 1,
                flipX: !!theObject.flipX,
                flipY: !!theObject.flipY,

                selectable: false,
                evented: false,
                opacity: 1,
                hasControls: false,
                hasBorders: false,
                isHighlight: true,
                excludeFromExport: true,
                objectCaching: false
            });
            clonedObj.setCoords();
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
     * @param {fabric.canvas} targetCanvas
     */
    updateRendering(ofObject, preset, visualProperties, defaultVisualProperties, targetCanvas=undefined) {
        // Only apply the visual props this method actually computes (stroke,
        // fill, strokeWidth, opacity). Setting the full `commonAnnotationVisuals`
        // spread back onto the object would clobber per-instance interaction
        // state every time selection changes — `lockMovementX/Y: true` from
        // the defaults silently re-locks edit-mode targets, breaking drag.
        if (typeof ofObject.color !== 'string') return;

        const color = preset.color;
        const stroke = visualProperties.stroke || defaultVisualProperties.stroke;
        const modeOutline = visualProperties.modeOutline !== undefined ? visualProperties.modeOutline : defaultVisualProperties.modeOutline;

        const props = {};
        if (modeOutline) {
            props.stroke = color;
            props.fill = "";
        } else {
            props.stroke = stroke;
            props.fill = color;
        }

        if (visualProperties.originalStrokeWidth && visualProperties.originalStrokeWidth !== ofObject.strokeWidth) {
            const canvas = targetCanvas || this._context.fabric.canvas;
            props.strokeWidth = visualProperties.originalStrokeWidth / canvas.computeGraphicZoom(canvas.getZoom());
        }

        // Apply opacity from the global visuals — drives the opacity slider
        // in the annotations panel (setCommonVisualProp('opacity', …)).
        if (visualProperties.opacity !== undefined) {
            props.opacity = visualProperties.opacity;
        }

        ofObject.set(props);
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
