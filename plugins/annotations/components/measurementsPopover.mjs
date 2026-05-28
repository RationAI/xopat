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

    const factory = this.annotations.getAnnotationObjectFactory?.(obj.factoryID);
    const sb = window.VIEWER?.scalebar;
    const areaPx = factory?.getArea?.(obj);
    const lengthPx = factory?.getLength?.(obj);
    const fmtArea = (v) => (Number.isFinite(v) && sb) ? sb.formatArea(sb.imageArea(v)) : '—';
    const fmtLen = (v) => (Number.isFinite(v) && sb) ? sb.formatLength(sb.imageLength(v)) : '—';

    const addRow = (label, value) => {
      const row = document.createElement('div');
      row.className = 'flex justify-between gap-3';
      const l = document.createElement('span'); l.className = 'opacity-70'; l.textContent = label;
      const v = document.createElement('span'); v.className = 'font-mono'; v.textContent = value;
      row.append(l, v); rows.appendChild(row);
    };

    addRow(this.plugin.t('annotations.measurements.metrics.area'), fmtArea(areaPx));
    if (Number.isFinite(lengthPx)) addRow(this.plugin.t('annotations.measurements.metrics.length'), fmtLen(lengthPx));

    const slot = this._lookupAnyMeasurementSlot(obj);
    if (slot) {
      if (Number.isFinite(slot.mean))           addRow(this.plugin.t('annotations.measurements.metrics.mean'), slot.mean.toFixed(2));
      if (Number.isFinite(slot.median))         addRow(this.plugin.t('annotations.measurements.metrics.median'), slot.median.toFixed(2));
      if (Number.isFinite(slot.percentPositive)) addRow(this.plugin.t('annotations.measurements.metrics.percentPositive'), `${(slot.percentPositive * 100).toFixed(1)}%`);
      if (slot.components?.count != null) {
        addRow(this.plugin.t('annotations.measurements.metrics.components'), String(slot.components.count));
        if (Number.isFinite(slot.components.meanArea)) {
          addRow(this.plugin.t('annotations.measurements.metrics.componentSize'), slot.components.meanArea.toFixed(1));
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
    if (!engine || !this._currentAnnotation) return;
    const channel = { source: 'raw', channel: 'L' };
    try {
      // Compute both intensity stats and components in one pass; each updates cache.
      const compRes = await engine.computeComponents(this._currentAnnotation, channel, 128);
      if (compRes && compRes.components) {
        engine._mergeCache(this._currentAnnotation, channel, { components: compRes.components });
      }
      const r = await engine.computeRaster(this._currentAnnotation, channel, { threshold: 128 });
      if (r && !r.tooSmall && !r.sampleMissing) {
        engine._mergeCache(this._currentAnnotation, channel, {
          mean: r.mean, median: r.median, percentPositive: r.percentPositive,
          pixelCount: r.pixelCount, threshold: r.threshold,
        });
      }
      this._populate();
      const wrappers = window.OSDAnnotations?.FabricWrapper?.instances?.() || [];
      for (const w of wrappers) w?.raiseEvent?.('annotation-measurements-updated');
    } catch (err) {
      console.warn('[measurements] popover compute failed', err);
    }
  }
}
