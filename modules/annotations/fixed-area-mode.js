/**
 * Fixed-area annotation mode.
 *
 * Behaves like the manual-create mode (anchor + drag), but as the drag grows
 * the area snaps to a fixed 1-2-5 decade sequence (1, 2, 5, 10, 20, 50, …)
 * in calibrated units (µm² when a scalebar is present, px² otherwise).
 *
 * The shape itself is drawn by the active preset's factory through the
 * `updateCreateFixedArea` opt-in API. Factories that don't implement it
 * (polygon, ROI, multipolygon, …) refuse to start a drag in this mode.
 *
 * A tooltip following the cursor shows the current snapped area, using
 * `viewer.scalebar.imageAreaToGivenUnits` so the unit roll-over
 * (µm² → mm² → cm²) stays consistent with the rest of the app.
 */
OSDAnnotations.FixedAreaMode = class extends OSDAnnotations.AnnotationState {
    constructor(context) {
        super(context, "fixed-area", "ph-ruler", "🅵  fixed-area annotations");
        this._lastUsed = null;
        this._anchor = null;
        this._tooltip = null;
        this._dragged = false;
    }

    setFromAuto() {
        this.context.setOSDTracking(false);
        this._ensureTooltip();
        for (let instance of OSDAnnotations.FabricWrapper.instances()) {
            instance.canvas.hoverCursor = "crosshair";
            instance.canvas.defaultCursor = "crosshair";
        }
        return true;
    }

    setToAuto(temporary) {
        if (temporary) return false;
        this.context.setOSDTracking(true);
        this._removeTooltip();
        return true;
    }

    handleClickDown(o, point, isLeftClick, objectFactory) {
        if (!objectFactory) {
            this.abortClick(isLeftClick, true);
            return;
        }
        if (!objectFactory.supportsFixedArea?.()) {
            // Active preset's factory can't be sized to a target area
            // (polygon, ROI, multipolygon, …) — fall back to the rectangle
            // factory but keep the preset's color/category options.
            objectFactory = this.context.getAnnotationObjectFactory("rect") || objectFactory;
            if (!objectFactory.supportsFixedArea?.()) {
                this.abortClick(isLeftClick);
                return;
            }
        }

        let px = point.x, py = point.y;
        if (this.context.snapEnabled) {
            const snapped = this.context.fabric?.findSnapTarget?.(px, py, this.context.snapRadiusPx);
            if (snapped) { px = snapped.x; py = snapped.y; }
        }

        objectFactory.initCreate(px, py, isLeftClick);
        this._lastUsed = objectFactory;
        this._anchor = { x: px, y: py };
        this._dragged = false;
    }

    handleMouseMove(o, point) {
        if (!this._lastUsed || !this._anchor) return;
        if (!this.context.isMouseOSDInteractive()) return;

        const areaPx = this._snapArea(point);
        if (this._lastUsed.updateCreateFixedArea(point.x, point.y, areaPx, true)) {
            this._dragged = true;
            this.context.fabric.rerender();
            this._updateTooltip(o, areaPx);
        }
    }

    handleClickUp(o, point, isLeftClick, objectFactory) {
        const updater = this._lastUsed;
        if (!updater) return false;

        const delta = Date.now() - this.context.cursor.mouseTime;
        if (!this._dragged || delta < updater.getCreationRequiredMouseDragDurationMS()) {
            updater.discardCreate?.();
            this._lastUsed = null;
            this._anchor = null;
            this._hideTooltip();
            return true;
        }

        if (updater.finishDirect()) {
            this._lastUsed = null;
            this._anchor = null;
        }
        this._hideTooltip();
        return true;
    }

    accepts(e) {
        return e.code === "KeyF" && !e.ctrlKey && !e.shiftKey && !e.altKey;
    }

    rejects(e) {
        return e.code === "KeyF";
    }

    // ---- snapping ----

    /**
     * Map the cursor's drag distance to a snapped area in image-pixels².
     * Drag distance is interpreted as "would-be side length" so for any shape
     * the unsnapped area is dist² — both the square and the circle (whose
     * unsnapped area would be π·r²) round-trip cleanly through the same step
     * sequence.
     */
    _snapArea(point) {
        const dx = point.x - this._anchor.x;
        const dy = point.y - this._anchor.y;
        const rawAreaPx = dx * dx + dy * dy;
        if (!(rawAreaPx > 0)) return 0;

        const scalebar = this.context.viewer?.scalebar;
        const ppm = scalebar?.pixelsPerMeter || 1;
        const calibrated = ppm > 1;

        // Convert to display unit (µm² when calibrated, px² when not) so the
        // step boundaries match what the tooltip prints.
        const v = calibrated ? rawAreaPx / (ppm * ppm) * 1e12 : rawAreaPx;
        const snappedUnit = OSDAnnotations.FixedAreaMode._snap125(v);
        return calibrated ? snappedUnit / 1e12 * ppm * ppm : snappedUnit;
    }

    /** Largest pure 1-2-5 decade value ≤ v. */
    static _snap125(v) {
        if (!(v > 0)) return 0;
        const decade = Math.floor(Math.log10(v));
        const m = v / Math.pow(10, decade);
        const mantissa = m >= 5 ? 5 : m >= 2 ? 2 : 1;
        return mantissa * Math.pow(10, decade);
    }

    // ---- tooltip overlay (mirrors freeFormTool's #annotation-cursor) ----

    _ensureTooltip() {
        if (this._tooltip && document.body.contains(this._tooltip)) return;
        const id = "fixed-area-tooltip";
        let node = document.getElementById(id);
        if (!node) {
            USER_INTERFACE.addHtml(
                `<div id="${id}" style="position:absolute;left:0;top:0;` +
                    `padding:2px 6px;background:rgba(0,0,0,0.75);color:#fff;` +
                    `font:11px/1.2 monospace;border-radius:3px;pointer-events:none;` +
                    `transform:translate(-9999px,-9999px);z-index:9999;` +
                    `white-space:nowrap;"></div>`,
                this.context.id
            );
            node = document.getElementById(id);
        }
        this._tooltip = node;
    }

    _updateTooltip(o, areaPx) {
        if (!this._tooltip) return;
        const ev = o?.e || o;
        const x = (ev && (ev.clientX ?? ev.pageX)) || 0;
        const y = (ev && (ev.clientY ?? ev.pageY)) || 0;
        this._tooltip.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
        const scalebar = this.context.viewer?.scalebar;
        this._tooltip.textContent = (scalebar && typeof scalebar.imageAreaToGivenUnits === "function")
            ? scalebar.imageAreaToGivenUnits(areaPx)
            : `${Math.round(areaPx)} px²`;
    }

    _hideTooltip() {
        if (this._tooltip) this._tooltip.style.transform = "translate(-9999px,-9999px)";
    }

    _removeTooltip() {
        if (this._tooltip && this._tooltip.parentNode) {
            this._tooltip.parentNode.removeChild(this._tooltip);
        }
        this._tooltip = null;
    }
};
