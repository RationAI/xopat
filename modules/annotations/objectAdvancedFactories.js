/**
 * Angle: three points [first, vertex, second] drawn as a single fabric.Polyline
 * whose middle point is the vertex. The measured sweep is NOT stored geometry —
 * it is derived from the points on demand and surfaced through the standard
 * measurement label (selection pill + always-on overlay), the same way `line`
 * reports its length.
 *
 * This is a plain primitive, not a group: an earlier design wrapped a polyline,
 * an arc fabric.Path and a fabric.Text in a fabric.Group and painted the value
 * on canvas itself. The group bought nothing that the label path doesn't give
 * for free, while costing the whole child-reframing / stroke-offset workaround
 * stack, a bespoke import transplant, and per-child rendering fan-out. The arc
 * indicator went with it.
 *
 * `angleMode` is the only non-geometric state: 'smaller' measures the shorter
 * sweep [0°, 180°], 'clockwise' the directed one [0°, 360°). It decides how the
 * same three points are read, so it must persist.
 */
OSDAnnotations.Angle = class extends OSDAnnotations.ExplicitPointsObjectFactory {
    constructor(context, presetManager) {
        // withHelperPoints=false: the creation protocol below is click-driven
        // and does not use the explicit-points helper vertices.
        super(context, presetManager, "angle", "polyline", fabric.Polyline, false);
        this._current = null;
        this._step = 0;
    }

    getIcon() { return "ph-angle"; }
    title()   { return "Angle"; }
    isEditable() { return false; }
    fabricStructure() { return "polyline"; }
    supportsBrush() { return false; }

    // -1 means: every click passes through to finishDirect(). The factory's
    // own step counter is what decides "done", not the mouse-down duration.
    getCreationRequiredMouseDragDurationMS() { return -1; }

    getCurrentObject() { return this._current; }

    getDescription(obj) {
        const d = this.getAngleDegrees(obj);
        return `Angle ${typeof d === 'number' ? d.toFixed(1) : '?'}°`;
    }

    /**
     * The sweep in degrees, derived from the live points — never cached, so an
     * angle whose geometry moved (drag, edit, paste) always reports the truth.
     * @param {fabric.Object} target
     * @return {number|undefined} undefined when the geometry is not a valid angle
     */
    getAngleDegrees(target) {
        const p = target?.points;
        if (!Array.isArray(p) || p.length < 3) return undefined;
        const mode = target.angleMode === 'clockwise' ? 'clockwise' : 'smaller';
        return this._computeAngle(p[0], p[1], p[2], mode) * 180 / Math.PI;
    }

    // The label is the sweep, not a distance — degrees are unit-less, so this
    // bypasses the scalebar formatting the base implementation applies.
    getMeasurementLabel(target) {
        const d = this.getAngleDegrees(target);
        return typeof d === 'number' && isFinite(d) ? `${d.toFixed(1)}°` : '';
    }

    // Neither inherited measure means anything here: the shoelace area of three
    // points is a meaningless triangle, and the rays' length is incidental to
    // what the annotation states. getMeasurementLabel above replaces both.
    getArea(theObject) { return undefined; }
    getLength(theObject) { return undefined; }

    // `module._exportedProps` (which drives `annotation.toObject(...)` on native
    // export) iterates each factory's `exports()` only — NOT `exportsGeometry()`.
    // `points` is covered by the inherited exportsGeometry(); the sweep is
    // derived, so `angleMode` is the only thing left to persist.
    exports() { return ["angleMode"]; }

    /**
     * Pre-enliven fixup. Angles exported by the old group-based factory come
     * back as `type: "group"` with the canonical points on the wrapper's
     * `first`/`vertex`/`second` and a child list we no longer understand.
     * Rewrite that blueprint into this factory's polyline shape so historical
     * exports keep importing. The group's own left/top framed a bbox that
     * included the arc and the text label — dropping them lets fabric derive
     * the correct ones from the points, exactly as a native polyline import does.
     */
    initializeBeforeImport(object) {
        if (!object || object.type !== 'group') return;
        if (!object.first || !object.vertex || !object.second) return;

        object.type = 'polyline';
        object.points = [
            { x: object.first.x,  y: object.first.y },
            { x: object.vertex.x, y: object.vertex.y },
            { x: object.second.x, y: object.second.y },
        ];
        delete object.objects;
        delete object.first;
        delete object.vertex;
        delete object.second;
        delete object.angleDeg;     // derived now
        delete object.left;
        delete object.top;
        delete object.width;
        delete object.height;
        delete object.pathOffset;
        if (object.angle === undefined) object.angle = 0;
        if (object.scaleX === undefined) object.scaleX = 1;
        if (object.scaleY === undefined) object.scaleY = 1;
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
        if (!this._current) { this._reset(); return true; }
        if (this._isDegenerate(this._first, this._vertex)
            || this._isDegenerate(this._second, this._vertex)) {
            this.discardCreate();
            return true;
        }

        this._context.fabric.deleteHelperAnnotation(this._current);
        // `_opts` (getAnnotationOptions) — NOT getCommonProperties(): the latter
        // carries only the shared visuals, without presetID / color, so a fresh
        // object built from it would lose its preset binding.
        const object = this.create({
            points: [this._first, this._vertex, this._second],
            angleMode: this._step3Dragged ? 'clockwise' : 'smaller',
        }, { ...this._opts });
        this._context.fabric.addAnnotation(object);

        this._reset();
        return true;
    }

    finishIndirect() { return this.finishDirect(); }

    _rebuildHelper() {
        const next = this.create({
            points: [this._first, this._vertex, this._second],
            angleMode: this._step3Dragged ? 'clockwise' : 'smaller',
        }, this._opts);
        next.set({
            hasBorders: false,
            hasControls: false,
            selectable: false,
            evented: false,
        });
        if (this._current) this._context.fabric.deleteHelperAnnotation(this._current);
        this._context.fabric.addHelperAnnotation(next);
        this._current = next;
    }

    _reset() {
        this._current = null;
        this._step = 0;
        this._first = this._vertex = this._second = null;
        this._step3Down = null;
        this._step3Dragged = false;
    }

    // ─── Persistence ───────────────────────────────────────────────────
    /**
     * @param {Array|Object} parameters one of: an array of three {x, y} points,
     *   `{ points: [...], angleMode }`, or the legacy
     *   `{ first, vertex, second, angleMode }` shape
     * @param {Object} options see parent class
     */
    create(parameters, options) {
        const { points, angleMode } = this._normalizeParameters(parameters);
        const instance = new this.Class(points);
        instance.angleMode = angleMode;
        const conf = this.configure(instance, options);
        this.renderAllControls(conf);
        return conf;
    }

    configure(instance, options) {
        const conf = super.configure(instance, options);
        // Open path: a fill would shade the triangle implied by the three points.
        conf.fill = "";
        conf.stroke = conf.color;
        if (conf.angleMode !== 'clockwise') conf.angleMode = 'smaller';
        return conf;
    }

    copy(ofObject, parameters=undefined) {
        const conf = super.copy(ofObject, parameters);
        conf.angleMode = ofObject.angleMode === 'clockwise' ? 'clockwise' : 'smaller';
        return conf;
    }

    updateRendering(ofObject, preset, visualProperties, defaultVisualProperties, targetCanvas=undefined) {
        visualProperties.modeOutline = true;    // open path — never filled
        super.updateRendering(ofObject, preset, visualProperties, defaultVisualProperties, targetCanvas);
    }

    _normalizeParameters(parameters) {
        const mode = parameters?.angleMode === 'clockwise' ? 'clockwise' : 'smaller';
        const at = (p) => ({ x: p?.x || 0, y: p?.y || 0 });

        if (Array.isArray(parameters)) {
            if (parameters.length < 3) throw new Error("Angle requires 3 points (first, vertex, second)");
            return { points: parameters.slice(0, 3).map(at), angleMode: 'smaller' };
        }
        if (Array.isArray(parameters?.points)) {
            if (parameters.points.length < 3) throw new Error("Angle requires 3 points (first, vertex, second)");
            return { points: parameters.points.slice(0, 3).map(at), angleMode: mode };
        }
        // Legacy {first, vertex, second} — kept so old sessions and scripts that
        // were written against the group-era factory keep constructing angles.
        return {
            points: [at(parameters?.first), at(parameters?.vertex), at(parameters?.second)],
            angleMode: mode,
        };
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

    _isDegenerate(p, q) { return Math.abs(p.x - q.x) < 0.1 && Math.abs(p.y - q.y) < 0.1; }

    _dragThresholdSq() {
        const px = this._context.viewer?.scalebar?.imagePixelSizeOnScreen?.() || 1;
        const t = 6 / px;
        return t * t;
    }
};

/**
 * Directional arrow: a straight shaft (fabric.Line) with a filled arrowhead
 * (fabric.Triangle) on its first point. Drawn head-first — the head anchors on
 * the press point and the tail trails the cursor.
 *
 * The group is a composition of native fabric primitives (no custom fabric
 * class — `fabric.util.enlivenObjects` resolves children by `type`). Only the
 * shaft carries canonical geometry; the head is always derived from the shaft
 * endpoints and rebuilt on import, so nothing about it has to persist.
 */
OSDAnnotations.Arrow = class extends OSDAnnotations.AnnotationObjectFactory {
    constructor(context, presetManager) {
        super(context, presetManager, "arrow", "group");
        this._current = null;
    }

    getIcon() { return "ph-arrow-up-right"; }
    title()   { return "Arrow"; }
    isEditable() { return false; }
    supportsBrush() { return false; }
    fabricStructure() { return ["line", "triangle"]; }
    getCurrentObject() { return this._current; }
    // An arrow points at something; its own length is incidental. `getLength`
    // stays implemented (exports / scripting still ask for it) — we just don't
    // put it on a label.
    supportsMeasurements() { return false; }

    /**
     * @param {array} parameters array of shaft points [x1, y1, x2, y2] where
     *   (x1, y1) is the head and (x2, y2) the tail
     * @param {Object} options see parent class
     */
    create(parameters, options) {
        const parts = this._createParts(parameters, options);
        return this._createWrap(parts, options);
    }

    /**
     * Runs on the import path only (`_addAnnotation` does not call
     * `checkAnnotation`). The enlivened children are in group-local coords and
     * the head child came back as a degenerate triangle, so recomputing it in
     * place would misplace it. Instead rebuild a fresh group from the canonical
     * ABSOLUTE shaft endpoints — its constructor performs the same child
     * reframing the live drawing path uses — and transplant its `_objects` onto
     * the enlivened instance (canvas / spatial-index references on `instance`
     * stay valid; only the geometry is replaced).
     */
    configure(instance, options) {
        if (instance.type !== "group" || !Array.isArray(instance._objects)) return instance;
        const line = instance._objects[0];
        if (!line) return instance;

        // Same accessor as toPointArray — valid on both freshly-built and
        // enlivened groups.
        const cx = instance.left + instance.width / 2;
        const cy = instance.top + instance.height / 2;
        const x1 = line.x1 + cx, y1 = line.y1 + cy;
        const x2 = line.x2 + cx, y2 = line.y2 + cy;

        const freshParts = this._createParts([x1, y1, x2, y2], options);
        const freshGroup = new fabric.Group(freshParts, { strokeWidth: 0 });
        instance._objects = freshGroup._objects;
        for (const child of instance._objects) child.group = instance;
        instance.set({
            left:   freshGroup.left,
            top:    freshGroup.top,
            width:  freshGroup.width,
            height: freshGroup.height,
        });
        instance.dirty = true;
        instance.setCoords?.();

        this._configureWrapper(instance, instance._objects[0], instance._objects[1], options);
        return instance;
    }

    /**
     * Pre-enliven fixup for native re-import. The native export trims the group
     * + children down to geometric primitives; `fabric.util.enlivenObjects` has
     * no way to know `_createParts` originally built the shaft with
     * `originX:'center'` and `left/top` pinned to its midpoint (the
     * stroke-offset workaround). Without that, fabric.Group's
     * `_updateObjectsCoords` reframes the shaft against the wrong centre and the
     * arrow renders nowhere visible. The head needs no fixup — `configure`
     * rebuilds it from the shaft.
     */
    initializeBeforeImport(object) {
        if (!Array.isArray(object?.objects)) return;
        // The native export omits these on the group; `configure` later runs
        // `$.extend(wrapper, options)` where `options` (preset common
        // properties) may carry them as `undefined`, nuking fabric's defaults.
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
     * @param {Object} ofObject arrow group being copied
     * @param {number[] | {
     *  left: number,
     *  top: number,
     *  points: number[],
     * }} parameters shaft points [x1, y1, x2, y2] or an object also specifying 'left'/'top'
     */
    copy(ofObject, parameters = undefined) {
        const line = ofObject.item(0);

        if (parameters && Array.isArray(parameters)) {
            parameters = {
                left: ofObject.left,
                top: ofObject.top,
                points: parameters,
            };
        } else if (!parameters) parameters = {
            left: ofObject.left,
            top: ofObject.top,
            points: [line.x1, line.y1, line.x2, line.y2],
        };

        // Centre origin + computed midpoint avoids fabric's strokeWidth-induced
        // position offset (same fix as _createParts).
        const cpCx = (parameters.points[0] + parameters.points[2]) / 2;
        const cpCy = (parameters.points[1] + parameters.points[3]) / 2;
        const copyLine = new fabric.Line(parameters.points, {
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
        });
        const copyHead = new fabric.Triangle({});
        this._configureHead(copyHead, {
            color: line.stroke,
            opacity: ofObject.opacity,
            zoomAtCreation: ofObject.zoomAtCreation,
        });
        this._updateHead(copyLine, copyHead);

        const conf = new fabric.Group([copyLine, copyHead], {
            presetID: ofObject.presetID,
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
        if (!theObject._objects || theObject._objects.length < 2) return theObject;

        const line = theObject._objects[0];
        const newObject = this.copy(theObject, {
            left: theObject.left,
            top: theObject.top,
            points: [line.x1, line.y1, line.x2, line.y2],
        });

        if (!ignoreReplace) this._context.fabric.replaceAnnotation(theObject, newObject);
        return newObject;
    }

    translate(theObject, pos, ignoreReplace=false) {
        if (!theObject._objects || theObject._objects.length < 2) return theObject;

        const line = theObject._objects[0];
        let deltaX, deltaY;
        if (pos.mode === 'move') {
            deltaX = pos.x;
            deltaY = pos.y;
        } else {
            deltaX = pos.x - theObject.left;
            deltaY = pos.y - theObject.top;
        }

        const newObject = this.copy(theObject, {
            left: theObject.left + deltaX,
            top: theObject.top + deltaY,
            points: [
                line.x1 + deltaX,
                line.y1 + deltaY,
                line.x2 + deltaX,
                line.y2 + deltaY,
            ],
        });

        if (!ignoreReplace) this._context.fabric.replaceAnnotation(theObject, newObject);
        return newObject;
    }

    updateRendering(ofObject, preset, visualProperties, defaultVisualProperties, targetCanvas=undefined) {
        visualProperties.modeOutline = true; // we are always transparent
        // Apply opacity to the Group only. fabric.Group multiplies its own
        // opacity into each child's during render, so children get opacity 1 —
        // otherwise the slider value gets squared (group * child) and the arrow
        // renders much fainter than polygons/text.
        const opacity = (typeof visualProperties.opacity === 'number') ? visualProperties.opacity : 1;
        ofObject.set({ opacity });
        if (!Array.isArray(ofObject._objects)) return;

        const childVisuals = { ...visualProperties, opacity: 1 };
        const [line, head] = ofObject._objects;
        const lineFactory = this._context.getAnnotationObjectFactory('line');
        if (line && lineFactory) {
            lineFactory.updateRendering(line, preset, childVisuals, defaultVisualProperties, targetCanvas);
        }
        // No 'triangle' factory exists — the head is a solid fill of the shaft
        // colour so the arrow reads as a pointer in outline mode too.
        if (head) {
            const color = line?.stroke || childVisuals.color || preset?.color;
            head.set({ opacity: 1, fill: color, stroke: color });
        }
    }

    applySelectionStyle(ofObject) {
        ofObject._objects[0].set({
            stroke: 'rgba(251, 184, 2, 0.75)',
        });
    }

    onZoom(ofObject, graphicZoom, realZoom) {
        if (!Array.isArray(ofObject._objects)) return;
        const [line, head] = ofObject._objects;
        // Counter-scale so the head keeps a constant on-screen size, the same
        // way the ruler's label used to be kept screen-sized.
        if (head) head.set({ scaleX: 1 / realZoom, scaleY: 1 / realZoom });
        if (line) super.onZoom(line, graphicZoom, realZoom);
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
        // Origin stays the head: the tail follows the cursor.
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

    finishIndirect() {
        this.finishDirect();
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

    exportsGeometry() {
        // Union of every primitive child's persisted props. `__copyInnerProps`
        // applies this list to each leaf child of the group with the root
        // factory, so we list everything any child needs and rely on each
        // primitive to silently ignore the props that don't apply to it.
        // Positional / transform props are required because trim drops anything
        // not listed here. The head's own geometry is intentionally absent — it
        // is rebuilt from the shaft in `configure`.
        return [
            "x1", "x2", "y1", "y2",
            "left", "top", "width", "height",
            "originX", "originY",
            "angle", "scaleX", "scaleY",
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
        // renders offset by `width/2` from the visible arrow.
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

    // Snap to the shaft's actual endpoints. Computed from the group + line
    // transform so the result is independent of whether `line.x1/y1` are
    // absolute (freshly-drawn) or group-relative (loaded from JSON).
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

    // Base head length in image space. `onZoom` counter-scales it to a constant
    // on-screen size.
    _headSize() {
        return 18;
    }

    _configureLine(line, options) {
        const lineOptions = Object.assign({}, options);
        lineOptions.stroke = options.color;

        // originX/Y='center' bypasses fabric's stroke-offset bug — without
        // this, `getRelativeCenterPoint` shifts the rendered position by
        // strokeWidth/2 in both axes (because fabric's internal dimension
        // calculation always adds strokeWidth, regardless of strokeUniform).
        // `_createParts` pre-computes left/top as the line's midpoint to make
        // this work.
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

    _configureHead(head, options) {
        $.extend(head, {
            selectable: false,
            hasControls: false,
            factoryID: this.factoryID,
            fill: options.color,
            stroke: options.color,
            strokeWidth: 0,
            originX: 'center',
            originY: 'center',
            scaleX: 1 / (options.zoomAtCreation || 1),
            scaleY: 1 / (options.zoomAtCreation || 1),
            centeredRotation: true,
            objectCaching: false,
        });
    }

    /**
     * Position / size / orient the head from the shaft endpoints. The arrow is
     * drawn "head first": the head sits on the FIRST point (x1, y1) — the anchor
     * the user presses down on — and points away from the tail (x2, y2).
     * `angle` rotates fabric's default up-pointing triangle (apex direction
     * (0,-1), i.e. -90°) to face along (x1-x2, y1-y2), so we add 90°.
     */
    _updateHead(line, head) {
        const dx = line.x1 - line.x2;
        const dy = line.y1 - line.y2;
        const size = this._headSize();
        head.set({
            width: size * 0.8,
            height: size,
            angle: Math.atan2(dy, dx) * 180 / Math.PI + 90,
            originX: 'center',
            originY: 'center',
            left: line.x1,
            top: line.y1,
        });
        head.setCoords?.();
    }

    _configureParts(line, head, options) {
        this._configureLine(line, options);
        this._configureHead(head, options);
    }

    _configureWrapper(wrapper, line, head, options) {
        $.extend(wrapper, options, {
            factoryID: this.factoryID,
            type: this.type,
            presetID: options.presetID,
            hasControls: true,
            hasBorders: false,
            // Force the group's own strokeWidth to 0. The group never renders
            // its own stroke (the children do), but a non-zero group
            // strokeWidth makes fabric's centre-translation pad by
            // strokeWidth/2 — and since _updateObjectsCoords ran BEFORE these
            // options were applied, the reframing centre vs the rendering
            // centre disagree by exactly that amount, which shifts the rendered
            // arrow with stroke width.
            strokeWidth: 0,
        });
    }

    _createParts(parameters, options) {
        // Construct the shaft with originX/Y='center' and pre-computed midpoint
        // so the stroke-offset bug in fabric's centre-translation doesn't shift
        // the rendered line away from the stored (x1,y1)-(x2,y2). The midpoint
        // must be supplied via the constructor options (not set later) so
        // fabric's `_setWidthHeight` keeps it.
        const cx = (parameters[0] + parameters[2]) / 2;
        const cy = (parameters[1] + parameters[3]) / 2;
        const line = new fabric.Line(parameters,
            { originX: 'center', originY: 'center', left: cx, top: cy });
        const head = new fabric.Triangle({});
        this._configureParts(line, head, options);
        this._updateHead(line, head);
        return [line, head];
    }

    _createWrap(parts, options) {
        options.hasBorders = false;
        // strokeWidth: 0 at construction time so fabric.Group's
        // _updateObjectsCoords (which reframes children's left/top relative to
        // `getCenterPoint()`) uses the same stroke-padding-free centre as the
        // later rendering. _configureWrapper re-pins it.
        const wrap = new fabric.Group(parts, { strokeWidth: 0 });
        this._configureWrapper(wrap, wrap.item(0), wrap.item(1), options);
        return wrap;
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
