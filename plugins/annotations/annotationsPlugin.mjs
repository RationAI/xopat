import { viewerMenuMethods } from './methods/viewerMenu.mjs';
import { commentMethods } from './methods/comments.mjs';
import { navigationMethods } from './methods/navigation.mjs';
import { handlerMethods, createErrorHandlers } from './methods/handlers.mjs';
import { ioMethods } from './methods/io.mjs';
import { presetMethods } from './methods/presets.mjs';
import { PathologyMetricsWindow } from './measurements/pathologyMetricsWindow.mjs';

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

    this._commentsEnabled = this.getOption('commentsEnabled', this.getStaticMeta('commentsEnabled', true));
    this.context.commentsEnabled = this._commentsEnabled;
    this._commentsClosedMethod = this.getOption('commentsClosedMethod', this.getStaticMeta('commentsClosedMethod', 'global'));
    this._commentsDefaultOpened = this.getOption('commentsDefaultOpened', this.getStaticMeta('commentsDefaultOpened', true));
    this._commentsOpened = this._commentsDefaultOpened;

    await this.setupFromParams();

    this.context.initPostIO();
    this.setupActiveTissue();
    this.initHandlers();
    this.initHTML();
    this.setupTutorials();

    const opacityControl = $('#annotations-opacity');
    opacityControl.val(this.context.getAnnotationCommonVisualProperty('opacity'));
    opacityControl.on('input', () => {
      if (this.context.disabledInteraction) return;
      this.context.setAnnotationCommonVisualProperty('opacity', Number.parseFloat(opacityControl.val()));
    });

    const borderControl = $('#annotations-border-width');
    borderControl.val(this.context.getAnnotationCommonVisualProperty('originalStrokeWidth'));
    borderControl.on('input', () => {
      if (this.context.disabledInteraction) return;
      this.context.setAnnotationCommonVisualProperty('originalStrokeWidth', Number.parseFloat(borderControl.val()));
    });

    if (AnnotationsGUI.Previewer) {
      this.preview = new AnnotationsGUI.Previewer('preview', this);
    }

    this._copiedAnnotation = null;
    this._copiedPos = { x: 0, y: 0 };
    this._selectedAnnot = null;
    this._refreshCommentsInterval = null;
  }

  async setupFromParams() {
    this._allowedFactories = this.getOption('factories', false) || this.getStaticMeta('factories') || ['polygon'];
    this.context.historyManager.focusWithZoom = this.getOption('focusWithZoom', true);

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
    if (!formats.includes(this.exportOptions.format)) this.exportOptions.format = 'native';
    if (!formats.includes(this._defaultFormat)) this._defaultFormat = 'native';

    this.isModalHistory = this.getOptionOrConfiguration('modalHistoryWindow', 'modalHistoryWindow', true);
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
  viewerMenuMethods,
  commentMethods,
  navigationMethods,
  handlerMethods,
  ioMethods,
  presetMethods
);

globalThis.AnnotationsGUI = AnnotationsGUI;
addPlugin('gui_annotations', AnnotationsGUI);
