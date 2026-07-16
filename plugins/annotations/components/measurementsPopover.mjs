/**
 * Lightweight per-annotation measurements popover.
 *
 * Opened from the canvas right-click menu's "View measurements" entry. Shows
 * geometric values (always available) plus any pixel-mode measurements that
 * have been cached for this object. A "Compute missing" button kicks off a
 * single-annotation engine run so the user can fill in mean/median/% positive
 * and component count without touching the main metrics window.
 */
export class MeasurementsPopover {
  /**
   * @param {{ plugin: AnnotationsGUI, annotations: OSDAnnotations, userInterface: any, pluginId: string }} options
   */
  constructor({ plugin, annotations, userInterface, pluginId }) {
    this.plugin = plugin;
    this.annotations = annotations;
    this.ui = userInterface;
    this.pluginId = pluginId;
    this.windowId = 'pathology-measurements-popover';
    this._window = null;
    this._currentAnnotation = null;
  }

  showFor(annotation) {
    this._currentAnnotation = annotation;
    if (!this._window) this._build();
    this._populate();
  }

  _engine() {
    const mod = (typeof singletonModule === 'function')
      ? singletonModule('annotation-measurements')
      : null;
    return mod?.getEngine?.() || null;
  }

  // Resolve the viewer that actually owns this annotation, so measurements use
  // the correct slide/scalebar in multi-viewport grids (never window.VIEWER for
  // domain logic). Falls back to the annotations' active viewer.
  _viewerFor(object) {
    const wrappers = window.OSDAnnotations?.FabricWrapper?.instances?.() || [];
    for (const w of wrappers) {
      const objs = w?.canvas?.getObjects?.() || [];
      if (objs.includes(object)) return w.viewer || w._viewer || null;
    }
    return this.annotations?.viewer || window.VIEWER || null;
  }

  _build() {
    const UI = globalThis.UI;
    const { div, button } = globalThis.van.tags;
    const body = div(
      { class: 'flex flex-col gap-2 p-2 text-sm', style: 'min-width:240px;' },
      div({ id: 'pmp-meta', class: 'text-xs opacity-70' }, ''),
      div({ id: 'pmp-rows', class: 'space-y-1' }, ''),
      button({
        type: 'button',
        class: 'px-3 py-1 btn btn-pointer text-sm',
        onclick: () => this._computeMissing()
      }, this.plugin.t('annotations.measurements.computeMissing')),
    );
    this._window = new UI.FloatingWindow(
      {
        id: this.windowId,
        title: this.plugin.t('annotations.measurements.popoverTitle'),
        closable: true,
        onClose: () => { this._window = null; this._currentAnnotation = null; }
      },
      body
    );
    this.ui.addHtml(this._window, this.pluginId);
  }

  _populate() {
    const obj = this._currentAnnotation;
    const meta = document.getElementById('pmp-meta');
    const rows = document.getElementById('pmp-rows');
    if (!obj || !meta || !rows) return;

    meta.textContent = `#${obj.incrementId ?? '?'} · ${obj.factoryID || obj.type || '?'}${obj.presetID ? ` · ${obj.presetID}` : ''}`;
    rows.replaceChildren();

    const engine = this._engine();
    const viewer = this._viewerFor(obj);
    const geo = engine ? engine.getGeometric(viewer, obj) : null;

    const addRow = (label, value) => {
      const row = document.createElement('div');
      row.className = 'flex justify-between gap-3';
      const l = document.createElement('span'); l.className = 'opacity-70'; l.textContent = label;
      const v = document.createElement('span'); v.className = 'font-mono'; v.textContent = value;
      row.append(l, v); rows.appendChild(row);
    };

    addRow(this.plugin.t('annotations.measurements.metrics.area'), geo?.areaLabel || '—');
    if (geo?.lengthLabel) addRow(this.plugin.t('annotations.measurements.metrics.length'), geo.lengthLabel);

    const slot = this._lookupAnyMeasurementSlot(obj);
    if (slot) {
      if (Number.isFinite(slot.mean))           addRow(this.plugin.t('annotations.measurements.metrics.mean'), slot.mean.toFixed(2));
      if (Number.isFinite(slot.median))         addRow(this.plugin.t('annotations.measurements.metrics.median'), slot.median.toFixed(2));
      if (Number.isFinite(slot.percentPositive)) addRow(this.plugin.t('annotations.measurements.metrics.percentPositive'), `${(slot.percentPositive * 100).toFixed(1)}%`);
      const comp = slot.components;
      if (comp?.count != null) {
        addRow(this.plugin.t('annotations.measurements.metrics.components'), String(comp.count));
        if (Number.isFinite(comp.densityPerMm2)) {
          addRow(this.plugin.t('annotations.measurements.metrics.density'), `${comp.densityPerMm2.toFixed(1)} /mm²`);
        }
        if (Number.isFinite(comp.meanAreaUm2)) {
          addRow(this.plugin.t('annotations.measurements.metrics.componentSize'), `${comp.meanAreaUm2.toFixed(1)} µm²`);
        }
      }
    }
  }

  _lookupAnyMeasurementSlot(object) {
    const slots = object?._measurements;
    if (!slots) return null;
    let best = null;
    for (const key of Object.keys(slots)) {
      const s = slots[key];
      if (!s) continue;
      if (!best || (s.computedAt || 0) > (best.computedAt || 0)) best = s;
    }
    return best;
  }

  async _computeMissing() {
    const engine = this._engine();
    const obj = this._currentAnnotation;
    if (!engine || !obj) return;
    try {
      // Single deterministic path; engine merges cache + notifies boards. Uses
      // the calibration-stable background-raw luminance channel by default.
      await engine.computeForObject(this._viewerFor(obj), obj, {
        includeComponents: true,
        source: 'background-raw',
        channel: 'V',
        threshold: 'auto',
      });
      this._populate();
    } catch (err) {
      console.warn('[measurements] popover compute failed', err);
    }
  }
}
