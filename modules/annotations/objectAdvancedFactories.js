
//todo implement as composition of line and text
OSDAnnotations.Ruler = class extends OSDAnnotations.AnnotationObjectFactory {
    constructor(context, presetManager) {
        super(context, presetManager, "ruler", "group");
        this._current = null;
    }

    getIcon() {
        return "ph-ruler";
    }

    getDescription(ofObject) {
        return `Length ${ofObject.measure}`;
    }

    fabricStructure() {
        return ["line", "text"];
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
     *
     * @param instance
     * @param options
     */
    configure(instance, options) {
        if (instance.type === "group") {
            this._configureParts(instance.item(0), instance.item(1), options);
            this._configureWrapper(instance, instance.item(0), instance.item(1), options);
        }
        return instance;
    }

    /**
     * Pre-enliven fixup for native re-import. The native export trims the
     * group + children down to geometric primitives; fabric.util.enlivenObjects
     * has no way to know that `_createParts`/`_createWrap` originally built the
     * inner line with `originX:'center'` and `left/top` pinned to its midpoint
     * (the stroke-offset workaround). Without that, fabric.Group's
     * `_updateObjectsCoords` reframes the line against the wrong centre and
     * the ruler renders nowhere visible.
     */
    initializeBeforeImport(object) {
        if (!Array.isArray(object?.objects)) return;
        // Defaults for the wrapper. The native export omits these on the
        // group; `factory.configure` later runs `$.extend(wrapper, options)`
        // where `options` (preset common properties) may carry these fields
        // as `undefined`, which would nuke fabric's defaults.
        if (object.angle === undefined) object.angle = 0;
        if (object.scaleX === undefined) object.scaleX = 1;
        if (object.scaleY === undefined) object.scaleY = 1;
        if (object.originX === undefined) object.originX = 'left';
        if (object.originY === undefined) object.originY = 'top';
        object.strokeWidth = 0;

        for (const child of object.objects) {
            if (!child) continue;
            if (child.type === 'line' && typeof child.x1 === 'number') {
                child.originX = 'center';
                child.originY = 'center';
                child.left = (child.x1 + child.x2) / 2;
                child.top  = (child.y1 + child.y2) / 2;
                if (child.scaleX === undefined) child.scaleX = 1;
                if (child.scaleY === undefined) child.scaleY = 1;
            }
        }
    }

    /**
     * @param {Object} ofObject fabricjs.Line object that is being copied
     * @param {number[] | {
     *  left: number,
     *  top: number,
     *  points: number,
     * }} parameters array of 'points' [x1, y1, x2, y2] or an object which also specifies 'left' and 'top' values
     */
    copy(ofObject, parameters = undefined) {
        const line = ofObject.item(0);
        const text = ofObject.item(1);

        if (parameters && Array.isArray(parameters)) {
            parameters = {
                left: ofObject.left,
                top: ofObject.top,
                points: parameters,
            }
        } else if (!parameters) parameters = {
            left: ofObject.left,
            top: ofObject.top,
            points: [line.x1, line.y1, line.x2, line.y2]
        }

        // Centre origin + computed midpoint avoids fabric's strokeWidth-
        // induced position offset (same fix as _createParts).
        const cpCx = (parameters.points[0] + parameters.points[2]) / 2;
        const cpCy = (parameters.points[1] + parameters.points[3]) / 2;
        const conf = new fabric.Group([new fabric.Line(parameters.points, {
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
            originX: "center",
            originY: "center",
            left: cpCx,
            top: cpCy,
        }), new fabric.Text(text.text, {
            textBackgroundColor: text.textBackgroundColor,
            fontSize: text.fontSize,
            lockUniScaling: true,
            scaleY: text.scaleY,
            scaleX: text.scaleX,
            selectable: false,
            hasControls: text.hasControls,
            stroke: text.stroke,
            fill: text.fill,
            paintFirst: text.paintFirst,
            strokeWidth: text.strokeWidth,
            originX: "left",
            originY: "top",
            left: text.left,
            top: text.top,
            angle: text.angle ?? this._getViewportCounterRotation(),
            centeredRotation: false,
        })], {
            presetID: ofObject.presetID,
            measure: ofObject.measure,
            meta: ofObject.meta,
            factoryID: ofObject.factoryID,
            isLeftClick: ofObject.isLeftClick,
            type: ofObject.type,
            layerID: ofObject.layerID,
            color: ofObject.color,
            zoomAtCreation: ofObject.zoomAtCreation,
            selectable: true,
            hasControls: true,
            hasBorders: false,
            left: parameters.left,
            top: parameters.top,
            height: ofObject.height,
            width: ofObject.width,
            fill: ofObject.fill,
            stroke: ofObject.stroke,
            strokeWidth: ofObject.strokeWidth,
            opacity: ofObject.opacity,
            borderColor: ofObject.borderColor,
            cornerColor: ofObject.cornerColor,
            borderScaleFactor: ofObject.borderScaleFactor,
            borderDashArray: ofObject.borderDashArray,
            cornerSize: ofObject.cornerSize,
            cornerStyle: ofObject.cornerStyle,
            transparentCorners: ofObject.transparentCorners,
            private: ofObject.private,
        });
        this.renderAllControls(conf);
        return conf;
    }

    edit(theObject) {
        //not allowed
    }

    getLength(theObject) {
        const line = theObject.item(0);
        return Math.hypot(line.x1 - line.x2, line.y1 - line.y2);
    }

    /**
     * Called when object is selected - restore custom controls
     * @param {fabric.Object} theObject selected fabricjs object
     */
    selected(theObject) {
        theObject.setControlsVisibility({ private: true });
    }

    recalculate(theObject, ignoreReplace=false) {
        // warning: untested
        if (!theObject._objects || theObject._objects.length < 2) {
            return theObject;
        }

        const line = theObject._objects[0];
        const points = [line.x1, line.y1, line.x2, line.y2];

        // todo consider not copying if not necessay - see other recalculate methods
        const newObject = this.copy(theObject, {
            left: theObject.left,
            top: theObject.top,
            points: points
        });

        if (!ignoreReplace) {
            this._context.fabric.replaceAnnotation(theObject, newObject);
        }

        return newObject;
    }

    translate(theObject, pos, ignoreReplace=false) {
        if (!theObject._objects || theObject._objects.length < 2) {
            return theObject;
        }

        const line = theObject._objects[0];
        let deltaX, deltaY;

        if (pos.mode === 'move') {
            deltaX = pos.x;
            deltaY = pos.y;
        } else {
            deltaX = pos.x - theObject.left;
            deltaY = pos.y - theObject.top;
        }

        const newPoints = [
            line.x1 + deltaX,
            line.y1 + deltaY,
            line.x2 + deltaX,
            line.y2 + deltaY
        ];

        const newObject = this.copy(theObject, {
            left: theObject.left + deltaX,
            top: theObject.top + deltaY,
            points: newPoints
        });

        if (!ignoreReplace) {
            this._context.fabric.replaceAnnotation(theObject, newObject);
        }

        return newObject;
    }

    updateRendering(ofObject, preset, visualProperties, defaultVisualProperties, targetCanvas=undefined) {
        visualProperties.modeOutline = true; // we are always transparent
        // Apply opacity to the Group only. Fabric.Group multiplies its own
        // opacity into each child's during render, so we must pass
        // `opacity = 1` to the children — otherwise the slider value gets
        // squared (group * child) and the ruler renders much fainter than
        // polygons/text. The cloned `childVisuals` keeps everything else
        // (modeOutline, stroke, etc.) intact for the child factories.
        const opacity = (typeof visualProperties.opacity === 'number') ? visualProperties.opacity : 1;
        ofObject.set({ opacity });

        if (ofObject._objects) {
            const lineFactory = this._context.getAnnotationObjectFactory('line');
            const textFactory = this._context.getAnnotationObjectFactory('text');

            const childVisuals = { ...visualProperties, opacity: 1 };
            lineFactory.updateRendering(ofObject._objects[0], preset, childVisuals, defaultVisualProperties, targetCanvas);
            textFactory.updateRendering(ofObject._objects[1], preset, childVisuals, defaultVisualProperties, targetCanvas);
        }
    }

    applySelectionStyle(ofObject) {
        ofObject._objects[0].set({
            stroke: 'rgba(251, 184, 2, 0.75)',
        });
    }

    onZoom(ofObject, graphicZoom, realZoom) {
        if (ofObject._objects) {
            ofObject._objects[1].set({
                //todo add geometric zoom, do not change opacity
                scaleX: 1/realZoom,
                scaleY: 1/realZoom,
            });
            super.onZoom(ofObject._objects[0], graphicZoom, realZoom);
        }
    }

    initCreate(x, y, isLeftClick) {
        this._opts = this._presets.getAnnotationOptions(isLeftClick);
        this._origin = { x, y };
        const group = this._buildHelperGroup(x, y, x, y, this._opts);
        this._context.fabric.addHelperAnnotation(group);
        this._current = group;
    }

    updateCreate(x, y) {
        if (!this._current) return;
        const oldGroup = this._current;
        const newGroup = this._buildHelperGroup(this._origin.x, this._origin.y, x, y, this._opts);
        this._context.fabric.deleteHelperAnnotation(oldGroup);
        this._context.fabric.addHelperAnnotation(newGroup);
        this._current = newGroup;
    }

    discardCreate() {
        if (this._current) {
            this._context.fabric.deleteHelperAnnotation(this._current);
            this._current = undefined;
        }
    }

    finishDirect() {
        const group = this.getCurrentObject();
        if (!group) return true;

        const line = group._objects?.[0];
        if (!line) { this.discardCreate(); return true; }
        if (Math.abs(line.x1 - line.x2) < 0.1 && Math.abs(line.y1 - line.y2) < 0.1) {
            this.discardCreate();
            return true;
        }

        const pid = line.presetID;
        this._context.fabric.deleteHelperAnnotation(group);

        const props = { ...this._presets.getCommonProperties() };
        this._configureWrapper(group, group._objects[0], group._objects[1], props);
        group.presetID = pid;

        this._context.fabric.addAnnotation(group);
        this._current = undefined;
        return true;
    }

    _buildHelperGroup(x1, y1, x2, y2, opts) {
        const parts = this._createParts([x1, y1, x2, y2], opts);
        const group = this._createWrap(parts, opts);
        group.set({
            hasBorders: false,
            hasControls: false,
            selectable: false,
            evented: false,
        });
        return group;
    }

    finishIndirect() {
        this.finishDirect();
    }

    title() {
        return "Ruler";
    }

    supportsBrush() {
        return false;
    }

    _round(value) {
        return Math.round(value * 100) / 100;
    }

    _updateText(line, text) {
        const d = Math.sqrt(Math.pow(line.x1 - line.x2, 2) + Math.pow(line.y1 - line.y2, 2));
        const strText = this._context.viewer.scalebar.imageLengthToGivenUnits(d);

        text.set({
            text: strText,
            left: (line.x1 + line.x2) / 2,
            top: (line.y1 + line.y2) / 2,
            angle: this._getViewportCounterRotation()
        });

        text.initDimensions?.();
        text.dirty = true;

        this._applyTextScreenTransform(text);

        text.bringToFront?.();
        text.setCoords?.();

        this._context.fabric.canvas?.requestRenderAll?.();
        return strText;
    }

    /**
     * Force properties for correct rendering, ensure consitency on
     * the imported objects, e.g. you can use this function in create(...) to avoid implementing stuff twice
     * @param object given object type for the factory type
     */
    import(object) {
    }

    exportsGeometry() {
        // Union of every primitive child's persisted props. `__copyInnerProps`
        // applies this list to each leaf child of the group with the root
        // factory, so we list everything any child needs and rely on each
        // primitive to silently ignore the props that don't apply to it.
        // Positional / transform props are required because trim drops anything
        // not listed here, and the text child uses `left`/`top` (line midpoint)
        // for its position inside the group.
        return [
            "x1", "x2", "y1", "y2", "text",
            "left", "top", "width", "height",
            "originX", "originY",
            "angle", "scaleX", "scaleY",
            "fontSize",
        ];
    }

    createHighlight(theObject) {
        const factory = this._context.getAnnotationObjectFactory('line');
        const absGroupPos = theObject.getPointByOrigin('center', 'center');

        const originalLine = theObject.item(0);
        const copyLine = factory.copy(originalLine);

        copyLine.factoryID = factory.factoryID;
        copyLine.type = factory.type;

        // `originalLine.left` is the line's centre in group-local coords
        // (post-originX='center' fix), so the formula below yields the line's
        // canvas midpoint. We must mark originX/Y='center' on the clone too,
        // otherwise fabric reads `left` as the bbox top-left and the clone
        // renders offset by `width/2` from the visible ruler.
        copyLine.set({
            originX: 'center',
            originY: 'center',
            left: absGroupPos.x + originalLine.left,
            top:  absGroupPos.y + originalLine.top,
        });

        return super.createHighlight(copyLine);
    }

    toPointArray(obj, converter, digits=undefined, quality=1) {
        const line = obj._objects?.[0] || obj.objects?.[0] || [];

        let x1 = line.x1 + obj.left + obj.width/2;
        let y1 = line.y1 + obj.top + obj.height/2;
        let x2 = line.x2 + obj.left + obj.width/2;
        let y2 = line.y2 + obj.top + obj.height/2;

        if (digits !== undefined) {
            x1 = parseFloat(x1.toFixed(digits));
            y1 = parseFloat(y1.toFixed(digits));
            x2 = parseFloat(x2.toFixed(digits));
            y2 = parseFloat(y2.toFixed(digits));
        }
        return [converter(x1, y1), converter(x2, y2)];
    }

    // Snap to the line's actual endpoints. Compute them directly from the
    // group + line transform so the result is independent of whether
    // `line.x1/y1` are absolute (freshly-drawn) or group-relative (loaded
    // from JSON) — we read the line's centre and width/height which are
    // both consistent across paths now that we use originX='center'.
    getSnapVertices(obj) {
        const line = obj?._objects?.[0];
        if (!line) return null;
        const groupCenterX = (obj.left || 0) + (obj.width  || 0) / 2;
        const groupCenterY = (obj.top  || 0) + (obj.height || 0) / 2;
        const lineCenterX = groupCenterX + (line.left || 0);
        const lineCenterY = groupCenterY + (line.top  || 0);
        const sx = line.x1 <= line.x2 ? -1 : 1;
        const sy = line.y1 <= line.y2 ? -1 : 1;
        const halfW = (line.width  || 0) / 2;
        const halfH = (line.height || 0) / 2;
        return [
            { x: lineCenterX + sx * halfW, y: lineCenterY + sy * halfH },
            { x: lineCenterX - sx * halfW, y: lineCenterY - sy * halfH },
        ];
    }

    fromPointArray(points, deconvertor) {
        if (!points || points.length < 2) {
            throw new Error("At least two points required");
        }

        const p1 = deconvertor(points[0]);
        const p2 = deconvertor(points[1]);
        return [p1.x, p1.y, p2.x, p2.y];
    }

    _configureLine(line, options) {
        const lineOptions = Object.assign({}, options);
        lineOptions.stroke = options.color;

        // originX/Y='center' bypasses fabric's stroke-offset bug — without
        // this, `getRelativeCenterPoint` shifts the rendered position by
        // strokeWidth/2 in both axes (because fabric's internal dimension
        // calculation always adds strokeWidth, regardless of strokeUniform).
        // `_createParts` pre-computes left/top as the line's midpoint to
        // make this work.
        $.extend(line, {
            scaleX: 1,
            scaleY: 1,
            selectable: false,
            factoryID: this.factoryID,
            hasControls: false,
            originX: 'center',
            originY: 'center'
        }, lineOptions);
    }

    _configureText(text, options) {
        $.extend(text, {
            fontSize: 18,
            selectable: false,
            hasControls: false,
            lockUniScaling: true,
            stroke: 'white',
            factoryID: this.factoryID,
            fill: 'black',
            paintFirst: 'stroke',
            strokeWidth: 2,
            scaleX: 1 / options.zoomAtCreation,
            scaleY: 1 / options.zoomAtCreation,
            originX: 'left',
            originY: 'top',
            centeredRotation: false,
            angle: this._getViewportCounterRotation(),
            objectCaching: false
        });
    }

    _getViewportCounterRotation() {
        return -(this._context.viewer?.viewport?.getRotation(true) || 0);
    }

    _applyTextScreenTransform(text) {
        text.set({
            angle: this._getViewportCounterRotation(),
            centeredRotation: false,
            originX: 'left',
            originY: 'top'
        });
        text.setCoords?.();
    }

    _configureParts(line, text, options) {
        this._configureText(text, options);
        this._configureLine(line, options);
    }

    _configureWrapper(wrapper, line, text, options) {
        $.extend(wrapper, options, {
            factoryID: this.factoryID,
            type: this.type,
            presetID: options.presetID,
            measure: text.text,
            hasControls: true,
            hasBorders: false,
            // Force the group's own strokeWidth to 0. The group never
            // renders its own stroke (the children do), but a non-zero
            // group strokeWidth makes fabric's centre-translation pad by
            // strokeWidth/2 — and since _updateObjectsCoords ran BEFORE
            // these options were applied, the reframing centre vs the
            // rendering centre disagree by exactly that amount, which is
            // why the rendered ruler shifts with stroke width.
            strokeWidth: 0,
        });
    }

    _createParts(parameters, options) {
        // Construct the line with originX/Y='center' and pre-computed midpoint
        // so the stroke-offset bug in fabric's centre-translation doesn't shift
        // the rendered line away from the stored (x1,y1)-(x2,y2). The midpoint
        // must be supplied via the constructor options (not set later) so
        // fabric's `_setWidthHeight` keeps it.
        const cx = (parameters[0] + parameters[2]) / 2;
        const cy = (parameters[1] + parameters[3]) / 2;
        const line = new fabric.Line(parameters,
            { originX: 'center', originY: 'center', left: cx, top: cy });
        const text = new fabric.Text('');
        this._configureParts(line, text, options);
        this._updateText(line, text);
        return [line, text];
    }

    _createWrap(parts, options) {
        options.hasBorders = false;
        // strokeWidth: 0 at construction time so fabric.Group's
        // _updateObjectsCoords (which reframes children's left/top
        // relative to `getCenterPoint()`) uses the same stroke-padding-free
        // centre as the later rendering. _configureWrapper re-pins it.
        const wrap = new fabric.Group(parts, { strokeWidth: 0 });
        this._configureWrapper(wrap, wrap.item(0), wrap.item(1), options);
        return wrap;
    }
};

OSDAnnotations.Angle = class extends OSDAnnotations.AnnotationObjectFactory {
    constructor(context, presetManager) {
        super(context, presetManager, "angle", "group");
        this._current = null;
        this._step = 0;
    }

    getIcon() { return "ph-angle"; }
    title()   { return "Angle"; }
    isEditable() { return false; }
    fabricStructure() { return ["polyline", "text", "path"]; }
    supportsBrush() { return false; }

    /**
     * Pre-enliven fixup for native re-import. The native export trims an Angle
     * down to the wrapper's `first/vertex/second` + a placeholder `path` child
     * with no SVG path data. `configure()` rebuilds the actual geometry; here
     * we just plug safe defaults for transform props the wrapper omitted so
     * fabric.Group doesn't end up with `angle: undefined` / `scaleX: undefined`.
     */
    initializeBeforeImport(object) {
        if (!object || object.type !== 'group') return;
        if (object.angle === undefined) object.angle = 0;
        if (object.scaleX === undefined) object.scaleX = 1;
        if (object.scaleY === undefined) object.scaleY = 1;
        if (object.originX === undefined) object.originX = 'left';
        if (object.originY === undefined) object.originY = 'top';
        object.strokeWidth = 0;
    }
    // -1 means: every click passes through to finishDirect(). The factory's
    // own step counter is what decides "done", not the mouse-down duration.
    getCreationRequiredMouseDragDurationMS() { return -1; }

    getCurrentObject() { return this._current; }
    getDescription(obj) {
        const d = (typeof obj?.angleDeg === 'number') ? obj.angleDeg.toFixed(1) : '?';
        return `Angle ${d}°`;
    }
    // `module._exportedProps` (which drives `annotation.toObject(...)` on
    // native export) iterates each factory's `exports()` only — NOT
    // `exportsGeometry()`. The canonical Angle state lives on the group
    // itself, so it has to be advertised here for the round-trip to work.
    exports() { return ["first", "vertex", "second", "angleMode", "angleDeg"]; }

    // Union of every primitive child's persisted props. `__copyInnerProps`
    // applies this list to each leaf child of the group with the root factory,
    // so we list everything any child needs and rely on each primitive to
    // silently ignore the props that don't apply to it (Polyline ignores
    // `text`/`path`, Text ignores `points`/`path`, Path ignores `text`/`points`).
    //
    // Positional / transform props are required because trim drops anything
    // not listed here, and the children rely on per-child `originX/originY` +
    // `pathOffset` for stroke-bug-free positioning (see _createParts at the
    // polyline/path/text setup).
    exportsGeometry() {
        return [
            "text", "points", "path",
            "left", "top", "width", "height",
            "originX", "originY",
            "angle", "scaleX", "scaleY",
            "pathOffset",
            "fontSize",
        ];
    }

    // 3-point flat list [first, vertex, second]. Drives the generic
    // `asap-xml` exporter and the `geo-json` LineString geometry. The middle
    // point IS the vertex by convention — do not reorder.
    toPointArray(obj, converter, digits=undefined, quality=1) {
        const round = (val) => digits === undefined ? val : parseFloat(Number(val).toFixed(digits));
        const f = obj.first  || { x: 0, y: 0 };
        const v = obj.vertex || { x: 0, y: 0 };
        const s = obj.second || { x: 0, y: 0 };
        return [
            converter(round(f.x), round(f.y)),
            converter(round(v.x), round(v.y)),
            converter(round(s.x), round(s.y)),
        ];
    }

    fromPointArray(points, deconvertor) {
        if (!Array.isArray(points) || points.length < 3) {
            throw new Error("Angle requires 3 points (first, vertex, second)");
        }
        return {
            first:  deconvertor(points[0]),
            vertex: deconvertor(points[1]),
            second: deconvertor(points[2]),
        };
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────
    //
    // Three discrete clicks (plus optional drag on the third) flow through
    // this factory's `initCreate` / `updateCreate` / `finishDirect`:
    //
    //   step 0 → click 1 sets `_first`. step → 1.
    //   step 1 → mousemove previews vertex at cursor.
    //          → click 2 sets `_vertex`. step → 2.
    //   step 2 → mousemove previews second endpoint.
    //          → click 3 (mousedown) sets `_step3Down` + `_second`. step → 3.
    //   step 3 → mousemove tracks drag: if cursor moves past the threshold,
    //            `_step3Dragged` flips to true; either way `_second` follows
    //            the cursor.
    //          → mouseup commits in "clockwise" mode if `_step3Dragged`,
    //            else in "smaller" mode. This single flag is the only thing
    //            that distinguishes the two flows.
    initCreate(x, y, isLeftClick) {
        if (typeof window !== 'undefined' && window.__SNAP_DEBUG) {
            console.log('[angle] initCreate(', x, ',', y, ') prevStep=', this._step);
        }
        if (this._step === 0 || !this._current) {
            this._opts = this._presets.getAnnotationOptions(isLeftClick);
            this._first = { x, y };
            this._vertex = { x, y };
            this._second = { x, y };
            this._step = 1;
        } else if (this._step === 1) {
            this._vertex = { x, y };
            this._second = { x, y };
            this._step = 2;
        } else if (this._step === 2) {
            this._second = { x, y };
            this._step3Down = { x, y };
            this._step3Dragged = false;
            this._step = 3;
        }
        this._rebuildHelper();
    }

    updateCreate(x, y) {
        if (!this._step || !this._current) return;
        if (this._step === 1) {
            this._vertex = { x, y };
            this._second = { x, y };
        } else if (this._step === 2) {
            this._second = { x, y };
        } else if (this._step === 3) {
            const dx = x - this._step3Down.x, dy = y - this._step3Down.y;
            if (dx * dx + dy * dy > this._dragThresholdSq()) this._step3Dragged = true;
            this._second = { x, y };
        }
        this._rebuildHelper();
    }

    discardCreate() {
        if (this._current) this._context.fabric.deleteHelperAnnotation(this._current);
        this._reset();
    }

    finishDirect() {
        if (this._step < 3) return false;       // multi-click in progress
        const group = this._current;
        if (!group) { this._reset(); return true; }
        if (this._isDegenerate(this._first, this._vertex)
            || this._isDegenerate(this._second, this._vertex)) {
            this.discardCreate();
            return true;
        }

        const mode = this._step3Dragged ? 'clockwise' : 'smaller';
        const sweep = this._computeAngle(this._first, this._vertex, this._second, mode);
        const first = this._first, vertex = this._vertex, second = this._second;

        // Promote the helper Group → real annotation (mirrors Ruler.finishDirect).
        this._context.fabric.deleteHelperAnnotation(group);
        const props = { ...this._presets.getCommonProperties() };
        group.angleMode = mode;
        group.angleDeg = sweep * 180 / Math.PI;
        group.first = first;
        group.vertex = vertex;
        group.second = second;
        this._configureWrapper(group, props);

        this._context.fabric.addAnnotation(group);

        if (typeof window !== 'undefined' && window.__SNAP_DEBUG) {
            const line1 = group?._objects?.[0];
            console.log('[angle] committed | first',
                first?.x?.toFixed(3), first?.y?.toFixed(3),
                '| group L T W H', group?.left?.toFixed(3), group?.top?.toFixed(3),
                group?.width?.toFixed(3), group?.height?.toFixed(3),
                '| line1 x1 y1 x2 y2', line1?.x1?.toFixed(3), line1?.y1?.toFixed(3),
                line1?.x2?.toFixed(3), line1?.y2?.toFixed(3),
                '| line1 L T W H', line1?.left?.toFixed(3), line1?.top?.toFixed(3),
                line1?.width?.toFixed(3), line1?.height?.toFixed(3),
                '| line1 stroke sW lineCap', line1?.stroke, line1?.strokeWidth, line1?.strokeLineCap);
            if (line1) {
                const gcx = (group.left || 0) + (group.width  || 0) / 2;
                const gcy = (group.top  || 0) + (group.height || 0) / 2;
                const lcx = gcx + (line1.left || 0) + (line1.width  || 0) / 2;
                const lcy = gcy + (line1.top  || 0) + (line1.height || 0) / 2;
                const sx = line1.x1 <= line1.x2 ? -1 : 1;
                const sy = line1.y1 <= line1.y2 ? -1 : 1;
                const renderedX = lcx + (-sx) * (line1.width  || 0) / 2 * (line1.scaleX || 1);
                const renderedY = lcy + (-sy) * (line1.height || 0) / 2 * (line1.scaleY || 1);
                console.log('[angle] committed rendered first',
                    renderedX.toFixed(3), renderedY.toFixed(3),
                    '| delta', (renderedX - (first?.x || 0)).toFixed(3),
                    (renderedY - (first?.y || 0)).toFixed(3));
            }
        }

        this._reset();
        return true;
    }

    finishIndirect() { return this.finishDirect(); }

    // ─── Construction ──────────────────────────────────────────────────
    _rebuildHelper() {
        const mode = this._step3Dragged ? 'clockwise' : 'smaller';
        const next = this._buildHelperGroup(this._first, this._vertex, this._second, mode, this._opts);
        if (typeof window !== 'undefined' && window.__SNAP_DEBUG) {
            const line1 = next?._objects?.[0];
            // Flat args — easier to read in pasted logs (no collapsed Object).
            console.log('[angle] post-wrap step', this._step,
                '| first', this._first?.x?.toFixed(3), this._first?.y?.toFixed(3),
                '| vertex', this._vertex?.x?.toFixed(3), this._vertex?.y?.toFixed(3),
                '| second', this._second?.x?.toFixed(3), this._second?.y?.toFixed(3),
                '| group L T W H', next?.left?.toFixed(3), next?.top?.toFixed(3),
                next?.width?.toFixed(3), next?.height?.toFixed(3),
                '| line1 x1 y1 x2 y2', line1?.x1?.toFixed(3), line1?.y1?.toFixed(3),
                line1?.x2?.toFixed(3), line1?.y2?.toFixed(3),
                '| line1 L T W H', line1?.left?.toFixed(3), line1?.top?.toFixed(3),
                line1?.width?.toFixed(3), line1?.height?.toFixed(3),
                '| line1 sX sY', line1?.scaleX, line1?.scaleY);

            // Also compute the line's RENDERED endpoint in canvas image coords
            // (the value fabric actually draws), so we can compare it to
            // `first`. If they differ, the bug is in group reframing.
            if (line1) {
                // Line's center in canvas image coords (group transform applied
                // to the line's group-local center).
                const groupCenterX = (next.left || 0) + (next.width  || 0) / 2;
                const groupCenterY = (next.top  || 0) + (next.height || 0) / 2;
                const lineCenterX = groupCenterX + (line1.left || 0) + (line1.width || 0) / 2;
                const lineCenterY = groupCenterY + (line1.top  || 0) + (line1.height || 0) / 2;
                // fabric.Line uses calcLinePoints semantics: endpoints are at
                // ±width/2, ±height/2 from center, with sign per x1<=x2.
                const sx = line1.x1 <= line1.x2 ? -1 : 1;
                const sy = line1.y1 <= line1.y2 ? -1 : 1;
                // "first endpoint" of ray1 is at (x2_local, y2_local), i.e.
                // the SECOND point of the [vertex, first] coord pair.
                const renderedFirstX = lineCenterX + (-sx) * (line1.width  || 0) / 2 * (line1.scaleX || 1);
                const renderedFirstY = lineCenterY + (-sy) * (line1.height || 0) / 2 * (line1.scaleY || 1);
                console.log('[angle] rendered first endpoint',
                    renderedFirstX.toFixed(3), renderedFirstY.toFixed(3),
                    '| stored first', this._first?.x?.toFixed(3), this._first?.y?.toFixed(3),
                    '| delta', (renderedFirstX - (this._first?.x || 0)).toFixed(3),
                    (renderedFirstY - (this._first?.y || 0)).toFixed(3));
            }
        }
        if (this._current) this._context.fabric.deleteHelperAnnotation(this._current);
        this._context.fabric.addHelperAnnotation(next);
        this._current = next;
    }

    _buildHelperGroup(first, vertex, second, mode, opts) {
        const parts = this._createParts(first, vertex, second, mode, opts);
        const group = this._createWrap(parts, first, vertex, second, mode, opts);
        group.set({
            hasBorders: false,
            hasControls: false,
            selectable: false,
            evented: false,
        });
        return group;
    }

    _createParts(first, vertex, second, mode, options) {
        // One fabric.Polyline replaces what used to be two separate
        // fabric.Lines — points are [first, vertex, second], so the
        // polyline traces both rays meeting at the vertex.
        //
        // originX/Y='center' (with left/top set to the bbox centre) is
        // still required to avoid fabric's stroke-induced positioning
        // shift: with default originX='left' the centre translation pads
        // by strokeWidth/2, moving the rendered shape away from the
        // stored points. `pathOffset` keeps the rendered shape unchanged
        // when we flip the origin.
        const rays = new fabric.Polyline(
            [{ x: first.x, y: first.y }, { x: vertex.x, y: vertex.y }, { x: second.x, y: second.y }]
        );
        const rBboxCx = (rays.left || 0) + (rays.width  || 0) / 2;
        const rBboxCy = (rays.top  || 0) + (rays.height || 0) / 2;
        rays.set({ originX: 'center', originY: 'center', left: rBboxCx, top: rBboxCy });

        const sweep = this._computeAngle(first, vertex, second, mode);
        const arcD  = this._buildArcPath(first, vertex, second, sweep, mode);
        const arc   = new fabric.Path(arcD || 'M 0 0');
        // Same trick for the arc Path.
        const aBboxCx = (arc.left || 0) + (arc.width  || 0) / 2;
        const aBboxCy = (arc.top  || 0) + (arc.height || 0) / 2;
        arc.set({ originX: 'center', originY: 'center', left: aBboxCx, top: aBboxCy });

        const text  = new fabric.Text(`${(sweep * 180 / Math.PI).toFixed(1)}°`);

        this._configureRays(rays, options);
        this._configurePath(arc, options);
        this._configureText(text, options);
        this._positionText(text, first, vertex, second, sweep, mode);
        return [rays, text, arc];
    }

    _createWrap(parts, first, vertex, second, mode, options) {
        options.hasBorders = false;
        // strokeWidth: 0 at construction so fabric.Group's reframing of
        // children's left/top uses the same stroke-padding-free centre
        // that rendering will use (otherwise the children render offset
        // by strokeWidth/2 from where reframing placed them).
        const wrap = new fabric.Group(parts, { strokeWidth: 0 });
        wrap.first = first;
        wrap.vertex = vertex;
        wrap.second = second;
        wrap.angleMode = mode;
        this._configureWrapper(wrap, options);
        return wrap;
    }

    _configureRays(polyline, options) {
        const rayOptions = Object.assign({}, options);
        rayOptions.stroke = options.color;
        rayOptions.fill = '';
        // originX/Y='center' bypasses fabric's stroke-offset bug: the centre
        // is `(left, top)` directly with no `_getTransformedDimensions` call,
        // so the rendered polyline matches the stored points exactly
        // regardless of strokeWidth. `_createParts` pre-computed left/top
        // as the bbox centre to make this work.
        $.extend(polyline, {
            scaleX: 1, scaleY: 1,
            selectable: false,
            factoryID: this.factoryID,
            hasControls: false,
            originX: 'center', originY: 'center',
            strokeLineJoin: 'round',
            strokeLineCap: 'butt',
        }, rayOptions);
    }

    _configurePath(path, options) {
        // Same centre-origin trick as the lines — avoids stroke-induced
        // position shift on the arc indicator.
        $.extend(path, {
            scaleX: 1, scaleY: 1,
            selectable: false,
            factoryID: this.factoryID,
            hasControls: false,
            fill: '',
            stroke: options.color,
            strokeWidth: options.strokeWidth,
            originX: 'center', originY: 'center',
            objectCaching: false,
        });
    }

    _configureText(text, options) {
        $.extend(text, {
            fontSize: 18,
            selectable: false,
            hasControls: false,
            lockUniScaling: true,
            stroke: 'white',
            factoryID: this.factoryID,
            fill: 'black',
            paintFirst: 'stroke',
            strokeWidth: 2,
            scaleX: 1 / options.zoomAtCreation,
            scaleY: 1 / options.zoomAtCreation,
            originX: 'left', originY: 'top',
            centeredRotation: false,
            angle: this._getViewportCounterRotation(),
            objectCaching: false,
        });
    }

    _configureWrapper(wrapper, options) {
        $.extend(wrapper, options, {
            factoryID: this.factoryID,
            type: this.type,
            presetID: options.presetID,
            hasControls: true,
            hasBorders: false,
            // Pin to 0 — the group doesn't visibly render its own stroke;
            // the only effect of a non-zero group strokeWidth is shifting
            // the children's rendered position by strokeWidth/2 in each
            // axis (see _createWrap comment).
            strokeWidth: 0,
        });
    }

    // ─── Math ──────────────────────────────────────────────────────────
    // Image coords are y-down. In atan2's convention that y-down flip means
    // the math-positive sweep direction *visually* equals clockwise on screen
    // — so a "clockwise" drag yields a strictly positive (a2 − a1) mod 2π.
    _computeAngle(first, vertex, second, mode) {
        const v1x = first.x - vertex.x, v1y = first.y - vertex.y;
        const v2x = second.x - vertex.x, v2y = second.y - vertex.y;
        if ((v1x === 0 && v1y === 0) || (v2x === 0 && v2y === 0)) return 0;
        const a1 = Math.atan2(v1y, v1x);
        const a2 = Math.atan2(v2y, v2x);
        if (mode === 'clockwise') {
            let d = a2 - a1;
            if (d < 0) d += 2 * Math.PI;
            return d;                   // [0, 2π)
        }
        let d = Math.abs(a2 - a1);
        if (d > Math.PI) d = 2 * Math.PI - d;
        return d;                       // [0, π]
    }

    // SVG arc path. Both sweep-flag and large-arc-flag have to match the
    // direction we're going around — sweep-flag=1 means math-positive (=
    // clockwise on a y-down screen), so we use it for the clockwise mode
    // unconditionally, and for the smaller mode only when the cross product
    // (v1 × v2) is positive (i.e. v2 lies CW from v1 visually).
    _buildArcPath(first, vertex, second, sweep, mode) {
        if (!sweep) return '';
        const v1x = first.x - vertex.x, v1y = first.y - vertex.y;
        const v2x = second.x - vertex.x, v2y = second.y - vertex.y;
        const len1 = Math.hypot(v1x, v1y);
        const len2 = Math.hypot(v2x, v2y);
        if (!len1 || !len2) return '';
        const a1 = Math.atan2(v1y, v1x);
        const a2 = Math.atan2(v2y, v2x);

        const r = this._arcRadius();
        const sx = vertex.x + r * Math.cos(a1);
        const sy = vertex.y + r * Math.sin(a1);
        const ex = vertex.x + r * Math.cos(a2);
        const ey = vertex.y + r * Math.sin(a2);

        let sweepFlag;
        if (mode === 'clockwise') {
            sweepFlag = 1;
        } else {
            const cross = v1x * v2y - v1y * v2x;
            sweepFlag = cross >= 0 ? 1 : 0;
        }
        const largeArc = sweep > Math.PI ? 1 : 0;
        return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${ex} ${ey}`;
    }

    _positionText(text, first, vertex, second, sweep, mode) {
        const v1x = first.x - vertex.x, v1y = first.y - vertex.y;
        const v2x = second.x - vertex.x, v2y = second.y - vertex.y;
        if ((v1x === 0 && v1y === 0) || (v2x === 0 && v2y === 0)) {
            text.set({ left: vertex.x, top: vertex.y });
            return;
        }
        const a1 = Math.atan2(v1y, v1x);
        const a2 = Math.atan2(v2y, v2x);

        let aMid;
        if (mode === 'clockwise') {
            aMid = a1 + sweep / 2;
        } else {
            const cross = v1x * v2y - v1y * v2x;
            const half = sweep / 2;
            aMid = a1 + (cross >= 0 ? half : -half);
        }
        const r = this._arcRadius();
        const offset = 14 / (this._context.viewer?.scalebar?.imagePixelSizeOnScreen?.() || 1);
        text.set({
            left: vertex.x + (r + offset) * Math.cos(aMid),
            top:  vertex.y + (r + offset) * Math.sin(aMid),
            angle: this._getViewportCounterRotation(),
        });
        text.initDimensions?.();
        text.dirty = true;
    }

    _arcRadius() {
        const px = this._context.viewer?.scalebar?.imagePixelSizeOnScreen?.();
        return px ? (30 / px) : 30;
    }

    _isDegenerate(p, q) { return Math.abs(p.x - q.x) < 0.1 && Math.abs(p.y - q.y) < 0.1; }
    _dragThresholdSq() {
        const px = this._context.viewer?.scalebar?.imagePixelSizeOnScreen?.() || 1;
        const t = 6 / px;
        return t * t;
    }
    _getViewportCounterRotation() {
        return -(this._context.viewer?.viewport?.getRotation(true) || 0);
    }

    _reset() {
        this._current = null;
        this._step = 0;
        this._first = this._vertex = this._second = null;
        this._step3Down = null;
        this._step3Dragged = false;
    }

    // ─── Persistence ───────────────────────────────────────────────────
    create(parameters, options) {
        const first  = parameters.first  || { x: 0, y: 0 };
        const vertex = parameters.vertex || { x: 0, y: 0 };
        const second = parameters.second || { x: 0, y: 0 };
        const mode   = parameters.angleMode === 'clockwise' ? 'clockwise' : 'smaller';
        const parts  = this._createParts(first, vertex, second, mode, options);
        const group  = this._createWrap(parts, first, vertex, second, mode, options);
        const sweep  = this._computeAngle(first, vertex, second, mode);
        group.angleDeg = sweep * 180 / Math.PI;
        return group;
    }

    configure(instance, options) {
        if (instance.type !== "group" || !Array.isArray(instance._objects)) return instance;

        // On native re-import the trimmed export carries only the wrapper's
        // `first/vertex/second` — the inner rays/text/arc come back as
        // degenerate fabric primitives (arc Path with empty `path`, polyline
        // missing the centred-origin setup, text without scale/position).
        // Detect that case and rebuild the children via the same `_createParts`
        // the live drawing path uses, so the rendered geometry matches
        // whatever was exported.
        const hasArcPath = Array.isArray(instance._objects[2]?.path) && instance._objects[2].path.length > 0;
        const canRebuild = instance.first && instance.vertex && instance.second;
        if (canRebuild && !hasArcPath) {
            const mode = instance.angleMode === 'clockwise' ? 'clockwise' : 'smaller';
            const sweep = this._computeAngle(instance.first, instance.vertex, instance.second, mode);

            // Build a fresh group from the canonical first/vertex/second so its
            // constructor performs the same child-reframing the live drawing
            // path uses, then transplant its `_objects` onto the enlivened
            // instance (canvas/spatial-index references on `instance` stay
            // valid; only the geometry is replaced).
            const freshParts = this._createParts(instance.first, instance.vertex, instance.second, mode, options);
            const freshGroup = new fabric.Group(freshParts, { strokeWidth: 0 });

            instance._objects = freshGroup._objects;
            for (const child of instance._objects) child.group = instance;
            instance.set({
                left:   freshGroup.left,
                top:    freshGroup.top,
                width:  freshGroup.width,
                height: freshGroup.height,
            });
            instance.angleDeg = sweep * 180 / Math.PI;
            instance.dirty = true;
            instance.setCoords?.();
        }

        const [rays, text, arc] = instance._objects;
        if (rays) this._configureRays(rays, options);
        if (arc) this._configurePath(arc, options);
        if (text) this._configureText(text, options);
        this._configureWrapper(instance, options);
        return instance;
    }

    copy(ofObject) {
        const mode = ofObject.angleMode === 'clockwise' ? 'clockwise' : 'smaller';
        return this.create({
            first:    { ...(ofObject.first  || { x: 0, y: 0 }) },
            vertex:   { ...(ofObject.vertex || { x: 0, y: 0 }) },
            second:   { ...(ofObject.second || { x: 0, y: 0 }) },
            angleMode: mode,
        }, this.copyProperties(ofObject));
    }

    // ─── Rendering hooks ───────────────────────────────────────────────
    updateRendering(ofObject, preset, visualProperties, defaultVisualProperties, targetCanvas) {
        visualProperties.modeOutline = true;
        const opacity = (typeof visualProperties.opacity === 'number') ? visualProperties.opacity : 1;
        ofObject.set({ opacity });
        if (!Array.isArray(ofObject._objects)) return;
        const polylineFactory = this._context.getAnnotationObjectFactory('polyline')
            || this._context.getAnnotationObjectFactory('line');
        const textFactory = this._context.getAnnotationObjectFactory('text');
        const childVisuals = { ...visualProperties, opacity: 1 };
        const [rays, text, arc] = ofObject._objects;
        if (rays && polylineFactory) polylineFactory.updateRendering(rays, preset, { ...childVisuals }, defaultVisualProperties, targetCanvas);
        if (arc && polylineFactory)  polylineFactory.updateRendering(arc,  preset, { ...childVisuals }, defaultVisualProperties, targetCanvas);
        if (text && textFactory)     textFactory.updateRendering(text, preset, { ...childVisuals }, defaultVisualProperties, targetCanvas);
    }

    onZoom(ofObject, graphicZoom, realZoom) {
        if (!Array.isArray(ofObject._objects)) return;
        const [rays, text] = ofObject._objects;
        if (text) text.set({ scaleX: 1 / realZoom, scaleY: 1 / realZoom });
        if (rays) super.onZoom(rays, graphicZoom, realZoom);
    }

    // Selection visual cue is provided by `createHighlight` only — the
    // rays / arc keep their original preset colour when selected.
    applySelectionStyle(ofObject) {}

    createHighlight(theObject) {
        const rays = theObject?._objects?.[0];
        if (!rays || !Array.isArray(rays.points) || rays.points.length < 3) return undefined;

        const points = rays.points.map(p => ({ x: p.x, y: p.y }));
        // `originalStrokeWidth` is required because the factory framework's
        // onZoom recomputes `strokeWidth = originalStrokeWidth / graphicZoom`
        // — if we don't set it, fabric.Polyline defaults to undefined, the
        // clone inherits undefined, and onZoom produces strokeWidth=NaN,
        // making the highlight invisible. Source strokeWidth is *2.5 below
        // so that base.createHighlight's strokeWidth * 5 leaves a
        // reasonable on-screen thickness (~2x the ray stroke).
        const rayBaseStroke = rays.originalStrokeWidth || 3;
        const polyline = new fabric.Polyline(points, {
            fill: '',
            stroke: 'rgba(251, 184, 2, 0.75)',
            strokeWidth: rays.strokeWidth || 1,
            originalStrokeWidth: rayBaseStroke * 0.4,
            borderColor: 'rgba(251, 184, 2, 0.75)',
            factoryID: this.factoryID,
        });
        const clone = super.createHighlight(polyline);
        if (!clone) return clone;

        // base.createHighlight builds the clone via `new theObject.constructor()`
        // (no args) — for fabric.Polyline that leaves `pathOffset = (0, 0)`.
        // It then `.set()`s width/height/points without re-running
        // `_setPositionDimensions`, so the clone renders shifted by (left, top)
        // into nowhere. Recompute pathOffset from the points so the clone
        // renders at the same absolute coords as the source.
        if (Array.isArray(clone.points) && clone.points.length) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of clone.points) {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            }
            clone.set({
                width: maxX - minX,
                height: maxY - minY,
                pathOffset: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
            });
            clone.setCoords();
        }
        return clone;
    }
};

// OSDAnnotations.Image = class extends OSDAnnotations.AnnotationObjectFactory {
//     constructor(context, presetManager) {
//         super(context, presetManager, "image", "image");
//         this._origX = null;
//         this._origY = null;
//         this._current = null;
//     }
//
//     getIcon() {
//         return "image";
//     }
//
//
//     getDescription(ofObject) {
//         return `Image [${Math.round(ofObject.left)}, ${Math.round(ofObject.top)}]`;
//     }
//
//     getCurrentObject() {
//         return this._current;
//     }
//
//     /**
//      * @param {Object} parameters object of the following properties:
//      *              - img: <img> element.
//      *              - left: offset in the image dimension
//      *              - top: offset in the image dimension
//      *              - width: optional image width
//      *              - height: optional image height
//      *              - opacity: opacity
//      * @param {Object} options see parent class
//      */
//     create(parameters, options) {
//         const img = parameters.img;
//         delete parameters.img;
//         const instance = new fabric.Image(img, parameters);
//         return this.configure(instance, options);
//     }
//
//     configure(object, options) {
//         $.extend(object, options, {
//             strokeWidth: 1,
//             originalStrokeWidth: 1,
//             type: this.type,
//             factoryID: this.factoryID,
//         });
//         return object;
//     }
//
//     /**
//      * @param {Object} ofObject fabricjs.Rect object that is being copied
//      * @param {Object} parameters object of the following properties:
//      *              - left: offset in the image dimension
//      *              - top: offset in the image dimension
//      *              - width: rect width
//      *              - height: rect height
//      */
//     copy(ofObject, parameters=undefined) {
//         //to do defalt implementation like this?
//         return $.extend(fabric.util.object.clone(ofObject), parameters);
//     }
//
//     /**
//      * A list of extra properties to export upon export event
//      * @return {string[]}
//      */
//     exports() {
//        to do: with these all objects now export (in native format), iterate to remove from other
//         return ["scaleX", "scaleY"]; //"left", "top", "width", "height", "opacity",
//     }
//
//     edit(theObject) {
//         this._left = theObject.left;
//         this._top = theObject.top;
//         theObject.set({
//             hasControls: true,
//             lockMovementX: false,
//             lockMovementY: false
//         });
//     }
//
//     recalculate(theObject) {
//         let left = theObject.left,
//             top = theObject.top;
//         theObject.set({ left: this._left, top: this._top, hasControls: false,
//             lockMovementX: true, lockMovementY: true});
//         let newObject = this.copy(theObject, {left: left, top: top});
//         delete newObject.incrementId; //todo make this nicer, avoid always copy of this attr
//         theObject.calcACoords();
//         this._context.fabric.replaceAnnotation(theObject, newObject);
//     }
//
//
//     initCreate(x, y, isLeftClick) {
//         this._origX = x;
//         this._origY = y;
//         this._current = new fabric.Rect($.extend({
//             left: x,
//             top: y,
//             width: 1,
//             height: 1
//         }, this._presets.getAnnotationOptions(isLeftClick)));
//         this._context.fabric.addHelperAnnotation(this._current);
//     }
//
//     updateCreate(x, y) {
//         if (!this._current) return;
//         if (this._origX > x) this._current.set({ left: x });
//         if (this._origY > y) this._current.set({ top: y });
//
//         let width = Math.abs(x - this._origX);
//         let height = Math.abs(y - this._origY);
//         this._current.set({ width: width, height: height });
//     }
//
//     onZoom(ofObject, graphicZoom, realZoom) {
//         //nothing
//     }
//
//     finishDirect() {
//         let obj = this.getCurrentObject();
//         if (!obj) return true;
//
//         const self = this;
//         UTILITIES.uploadFile(url => {
//             const image = document.createElement('img');
//             image.onload = () => {
//                 self._context.fabric.deleteHelperAnnotationobj);
//                 self._context.fabric.addAnnotation(self.create({
//                         top: obj.top,
//                         left: obj.left,
//                         scaleX: obj.width / image.width,
//                         scaleY: obj.height / image.height,
//                         img: image
//                 }, this._presets.getAnnotationOptions(obj.isLeftClick)));
//             };
//             image.onerror = () => {
//                 self._context.fabric.deleteHelperAnnotationobj);
//             };
//             image.onabort = () => {
//                 self._context.fabric.deleteHelperAnnotationobj);
//             }
//             image.setAttribute('src', url);
//         }, "image/*", "url");
//         this._current = undefined;
//         return true;
//     }
//
//     finishIndirect() {
//         this.finishDirect();
//     }
//
//     title() {
//         return "Image";
//     }
// };
