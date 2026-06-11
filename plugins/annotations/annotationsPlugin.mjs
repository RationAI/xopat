import { globalPluginWindowMethods } from './components/globalPluginWindow.mjs';
import { viewerMenuMethods } from './methods/viewerMenu.mjs';
import { commentMethods } from './methods/comments.mjs';
import { navigationMethods } from './methods/navigation.mjs';
import { handlerMethods, createErrorHandlers } from './methods/handlers.mjs';
import { ioMethods } from './methods/io.mjs';
import { presetMethods } from './methods/presets.mjs';
import { PathologyMetricsWindow } from './components/pathologyMetricsWindow.mjs';
import { MeasurementsPopover } from './components/measurementsPopover.mjs';

/**
 * GUI/controller layer for the annotations module.
 * The module provides functionality; the plugin provides controls.
 */
class AnnotationsGUI extends XOpatPlugin {
    /**
     * @typedef {{
     *  show?: boolean;
     *  pos?: { x: number; y: number; };
     *  private?: boolean;
     *  comments?: { author: string; date: Date; content: string; };
     * }} AnnotationMenuOptions
     */

    /**
     * @typedef {{
     *   id: string;
     *   author: { id: string; name: string; };
     *   reference: string;
     *   content: string;
     *   replyTo?: string;
     *   createdAt: number;
     *   modifiedAt: number;
     *   removed?: boolean;
     * }} AnnotationComment
     */

    //todo test with multiple swap bgimages
    constructor(id) {
        super(id);
        /** @type {Set<string>} */
        this._preferredPresets = new Set();
        this.user = XOpatUser.instance();
        this._errorHandlers = createErrorHandlers(this);
    }

    async pluginReady() {
        await this.loadLocale();

        this.context = OSDAnnotations.instance();
        this.context.setModeUsed('AUTO');
        this.context.setModeUsed('CUSTOM');
        this.context.setModeUsed('FREE_FORM_TOOL_ADD');
        this.context.setModeUsed('FREE_FORM_TOOL_REMOVE');
        // todo these are actually built-in, use as built-in
        this.context.setCustomModeUsed('MAGIC_WAND', OSDAnnotations.MagicWand);
        this.context.setCustomModeUsed('FREE_FORM_TOOL_CORRECT', OSDAnnotations.StateCorrectionTool);
        this.context.setCustomModeUsed('VIEWPORT_SEGMENTATION', OSDAnnotations.ViewportSegmentation);
        this.context.setCustomModeUsed('FIXED_AREA', OSDAnnotations.FixedAreaMode);
        this.context.setCustomModeUsed('EDIT_SELECTION', OSDAnnotations.StateEditSelection);

        this._commentsEnabled = this.getOption('commentsEnabled', this.getStaticMeta('commentsEnabled', true));
        this.context.commentsEnabled = this._commentsEnabled;
        this._commentsClosedMethod = this.getOption('commentsClosedMethod', this.getStaticMeta('commentsClosedMethod', 'global'));
        this._commentsDefaultOpened = this.getOption('commentsDefaultOpened', this.getStaticMeta('commentsDefaultOpened', true));
        this._commentsOpened = false;

        await this.setupFromParams();

        this.setupActiveTissue();
        this.initHandlers();
        this.initHTML();
        this.setupTutorials();
        if (AnnotationsGUI.Previewer) {
            this.preview = new AnnotationsGUI.Previewer('preview', this);
        }

        this._copiedAnnotation = null;
        this._copiedPos = { x: 0, y: 0 };
        this._selectedAnnot = null;
        // Fabric that owns _selectedAnnot. The comments window is a single global
        // window, but in a multi-viewport session the selected annotation may live
        // on a non-active viewer's fabric — comment mutations must target this
        // fabric, not this.context.fabric (the active viewer's).
        this._selectedAnnotFabric = null;
        this._refreshCommentsInterval = null;
    }

    // `_pickAnnotationForContext` and `showMeasurementsPopover` remain
    // public on the plugin so the unified canvas right-click menu (built
    // in `methods/viewerMenu.mjs::_buildAnnotationContextActions`) can
    // call them via `this`. The standalone `annotation-measurements`
    // provider that used to live here was folded into that unified menu —
    // a separate top-level entry would have been a third "Annotation"
    // section alongside z-order and Change-preset/Copy/Cut/etc.

    _pickAnnotationForContext(fabric, ctx) {
        // Prefer single-selection scenarios so we don't have to do hit-testing.
        const sel = fabric.getSelectedAnnotations?.() || [];
        if (sel.length === 1) return sel[0];
        // Fall back to the active fabric object when it's an annotation.
        const active = fabric.canvas?.getActiveObject?.();
        if (active && fabric.isAnnotation?.(active)) return active;
        // Hit-test by bounding rect at the right-click slide-pixel position.
        const px = ctx?.pixelPosition;
        if (!px || !Number.isFinite(px.x) || !Number.isFinite(px.y)) return null;
        const objs = fabric.canvas?.getObjects?.() || [];
        // Prefer the topmost (last drawn) annotation that contains the point.
        for (let i = objs.length - 1; i >= 0; i--) {
            const o = objs[i];
            if (!fabric.isAnnotation?.(o)) continue;
            const r = o.getBoundingRect?.(true, true);
            if (!r) continue;
            if (px.x >= r.left && px.x <= r.left + r.width
                && px.y >= r.top && px.y <= r.top + r.height) {
                return o;
            }
        }
        return null;
    }

    showMeasurementsPopover(annotation) {
        if (!this._measurementsPopover) {
            this._measurementsPopover = new MeasurementsPopover({
                plugin: this,
                annotations: this.context,
                userInterface: USER_INTERFACE,
                pluginId: this.id,
            });
        }
        this._measurementsPopover.showFor(annotation);
    }

    async setupFromParams() {
        this._allowedFactories = this.getOption('factories', false) || this.getStaticMeta('factories') || ['polygon'];
        this._focusWithZoom = this.getOption('focusWithZoom', true);
        for (const fabric of OSDAnnotations.FabricWrapper.instances()) {
            fabric.focusWithScreen = this._focusWithZoom;
        }

        const convertOpts = this.getOption('convertors');
        // todo we should support setting all convertor opts here, and document this
        const coords = convertOpts?.imageCoordinatesOffset;
        if (coords) {
            if (Array.isArray(convertOpts?.imageCoordinatesOffset)) {
                this.context.setIOOption('imageCoordinatesOffset', { x: coords[0] || 0, y: coords[1] || 0 });
            } else if (coords.x && coords.y) {
                this.context.setIOOption('imageCoordinatesOffset', coords);
            } else {
                $.console.error('Invalid value for imageCoordinatesOffset on the plugin session.');
            }
        }

        this.exportOptions = {
            availableFormats: OSDAnnotations.Convertor.formats,
            format: this.getOption('defaultIOFormat', this._defaultFormat),
            scope: 'all'
        };
        const formats = OSDAnnotations.Convertor.formats;
        // 'auto' is a UI-only sentinel (import-time auto-detect), not a registered convertor.
        if (this.exportOptions.format !== 'auto' && !formats.includes(this.exportOptions.format)) {
            this.exportOptions.format = 'native';
        }
        if (this._defaultFormat !== 'auto' && !formats.includes(this._defaultFormat)) {
            this._defaultFormat = 'native';
        }

        const staticPresetList = this.getOption('staticPresets', undefined, false);
        if (staticPresetList) {
            try {
                await this.context.presets.import(staticPresetList, true);
            } catch (error) {
                console.warn(error);
            }
        }

        this.enablePresetModify = this.getOptionOrConfiguration('enablePresetModify', 'enablePresetModify', true);
        if (this.getOption('edgeCursorNavigate', true)) {
            this.context.setCloseEdgeMouseNavigation(true);
        }
    }

    setupActiveTissue(bgImageConfigObject) {
        this.activeTissue = APPLICATION_CONTEXT.referencedName();
        if (!this.activeTissue) {
            $('#annotations-shared-head').html(this.getAnnotationsHeadMenu(this.t('errors.noTargetTissue')));
            return false;
        }
        return true;
    }

    showMeasurementsWindow() {
        if (!this.measurementsWindow) {
            this.measurementsWindow = new AnnotationsGUI.PathologyMetricsWindow({
                plugin: this,
                annotations: this.context,
                userInterface: USER_INTERFACE,
                pluginId: this.id
            });
        } else {
            this.measurementsWindow.reset();
        }
    }
}

AnnotationsGUI.annotationMenuIconOrder = ['private', 'locked', 'comments'];
AnnotationsGUI._isAnnotationMenuSorted = function(array) {
    const order = AnnotationsGUI.annotationMenuIconOrder;
    return array.length === order.length && array.every((value, index) => value.includes(order[index]));
};

AnnotationsGUI.PathologyMetricsWindow = PathologyMetricsWindow;
Object.assign(
    AnnotationsGUI.prototype,
    globalPluginWindowMethods,
    viewerMenuMethods,
    commentMethods,
    navigationMethods,
    handlerMethods,
    ioMethods,
    presetMethods
);

globalThis.AnnotationsGUI = AnnotationsGUI;
addPlugin('gui_annotations', AnnotationsGUI);
