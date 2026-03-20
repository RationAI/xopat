/**
 * Measurements window for pathology-oriented aggregate annotation metrics.
 * Rebuilt with DOM/van nodes instead of raw HTML strings.
 */
export class PathologyMetricsWindow {
  /**
   * @param {{ plugin: AnnotationsGUI, annotations: OSDAnnotations, userInterface: any, pluginId: string }} options
   */
  constructor({ plugin, annotations, userInterface, pluginId }) {
    this.plugin = plugin;
    this.annotations = annotations;
    this.ui = userInterface;
    this.pluginId = pluginId;
    this.windowId = 'pathology-metrics-window';

    this.results = [];
    this.resultSeq = 1;
    this.calc = { a: null, op: '+', b: null, out: null };
    this.closed = true;
    this.window = null;
    this.reset();
  }

  reset() {
    if (!this.closed) return;
    this._addWindow();
    this._populatePresets();
    this._renderResults();
    this._renderCalculator();
    this.closed = false;
  }

  _addWindow() {
    const UI = globalThis.UI;
    const { div, label, input, select, option, button, span } = globalThis.van.tags;

    const body = div(
      { class: 'flex flex-col h-full', style: 'min-height:0;' },
      div(
        { class: 'p-2 border-b border-[var(--color-border-secondary)]' },
        div({ class: 'text-sm font-medium mb-1' }, this.plugin.t('annotations.measurements.presetLabel')),
        div(
          { class: 'flex gap-2 items-center' },
          select({
            id: 'pmw-preset',
            class: 'flex-1 px-2 py-1 text-sm border border-[var(--color-border-secondary)] rounded-md',
            style: 'background:var(--color-bg-primary);color:var(--color-text-primary);'
          }),
          div(
            { class: 'flex items-center gap-2' },
            label(
              { class: 'text-sm flex items-center gap-1' },
              input({ type: 'radio', name: 'pmw-metric', value: 'area', checked: true }),
              this.plugin.t('annotations.measurements.metrics.area')
            ),
            label(
              { class: 'text-sm flex items-center gap-1' },
              input({ type: 'radio', name: 'pmw-metric', value: 'length' }),
              this.plugin.t('annotations.measurements.metrics.length')
            )
          ),
          button(
            {
              type: 'button',
              class: 'px-3 py-1 btn btn-pointer text-sm',
              onclick: () => this._computeSelected()
            },
            this.plugin.t('annotations.measurements.compute')
          )
        ),
        div(
          { class: 'text-xs opacity-70 mt-1' },
          this.plugin.t('annotations.measurements.helperText')
        )
      ),
      div({ id: 'pmw-results', class: 'flex-1 overflow-y-auto p-2 space-y-2', style: 'min-height:0;' }),
      div(
        { class: 'p-2 border-t border-[var(--color-border-secondary)]' },
        div({ class: 'text-sm font-medium mb-2' }, this.plugin.t('annotations.measurements.combineTitle')),
        div(
          { class: 'flex gap-2 items-center mb-2' },
          select({
            id: 'pmw-calc-a',
            class: 'px-2 py-1 text-sm border rounded-md flex-1',
            style: 'background:var(--color-bg-primary);color:var(--color-text-primary);'
          }),
          select(
            {
              id: 'pmw-calc-op',
              class: 'px-2 py-1 text-sm border rounded-md',
              style: 'background:var(--color-bg-primary);color:var(--color-text-primary);'
            },
            option({ value: '+' }, '+'),
            option({ value: '-' }, '−'),
            option({ value: '/' }, '÷')
          ),
          select({
            id: 'pmw-calc-b',
            class: 'px-2 py-1 text-sm border rounded-md flex-1',
            style: 'background:var(--color-bg-primary);color:var(--color-text-primary);'
          }),
          button(
            {
              type: 'button',
              class: 'px-3 py-1 btn btn-pointer text-sm',
              onclick: () => this._computeCalc()
            },
            '='
          )
        ),
        div(
          {
            id: 'pmw-calc-out',
            class: 'text-sm px-2 py-1 rounded-md border border-[var(--color-border-secondary)]',
            style: 'background:var(--color-bg-primary);'
          },
          span({ class: 'opacity-70' }, `${this.plugin.t('annotations.measurements.resultLabel')}: `),
          span({ id: 'pmw-calc-out-val' }, '—')
        ),
        div(
          { class: 'flex gap-2 mt-2' },
          button({ type: 'button', class: 'px-3 py-1 btn btn-pointer text-sm', onclick: () => this._saveCalcAsResult() }, this.plugin.t('annotations.measurements.saveResult')),
          button({ type: 'button', class: 'px-3 py-1 btn btn-pointer text-sm', onclick: () => this._copyResults() }, this.plugin.t('annotations.measurements.copyCsv')),
          button({ type: 'button', class: 'px-3 py-1 btn btn-pointer text-sm', onclick: () => this._clearAll() }, this.plugin.t('annotations.measurements.clear'))
        )
      )
    );

    this.window = new UI.FloatingWindow(
      {
        id: this.windowId,
        title: this.plugin.t('annotations.measurements.title'),
        closable: true,
        onClose: () => {
          this.closed = true;
        }
      },
      body
    );

    this.ui.addHtml(this.window, this.pluginId);
  }

  _populatePresets() {
    const sel = document.getElementById('pmw-preset');
    if (!sel) return;

    const ids = this.annotations.presets.getExistingIds();
    const options = ids.map((id) => {
      const p = this.annotations.presets.get(id);
      const name = (p?.meta?.category?.value || p?.meta?.category || id || '').toString();
      return { id, name: name || id, color: p?.color || '#999' };
    });

    sel.replaceChildren(
      ...options.map((item) => {
        const el = document.createElement('option');
        el.value = item.id;
        el.textContent = item.name;
        el.style.color = item.color;
        return el;
      })
    );
  }

  _renderResults() {
    const root = document.getElementById('pmw-results');
    if (!root) return;

    root.replaceChildren();
    if (!this.results.length) {
      const empty = document.createElement('div');
      empty.className = 'text-sm opacity-70';
      empty.textContent = this.plugin.t('annotations.measurements.empty');
      root.appendChild(empty);
      this._renderCalculator();
      return;
    }

    for (const result of this.results) {
      const card = document.createElement('div');
      card.className = 'border border-[var(--color-border-secondary)] rounded-md p-2';

      const header = document.createElement('div');
      header.className = 'flex items-center justify-between';

      const title = document.createElement('div');
      title.className = 'text-sm font-medium';
      title.textContent = result.label;

      const meta = document.createElement('span');
      meta.className = 'text-xs opacity-70';
      meta.textContent = ` (${result.metric}, ${result.count} ${this.plugin.t('annotations.measurements.objectShort')})`;
      title.appendChild(meta);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'material-icons btn btn-pointer px-2';
      removeBtn.title = this.plugin.t('annotations.measurements.remove');
      removeBtn.textContent = 'close';
      removeBtn.addEventListener('click', () => this._removeResult(result.id));

      header.append(title, removeBtn);

      const value = document.createElement('div');
      value.className = 'text-sm mt-1';
      value.innerHTML = `<span class="opacity-70">${this.plugin.t('annotations.measurements.valueLabel')}:</span> ${this._format(result.value, result.metric)}`;

      const idLine = document.createElement('div');
      idLine.className = 'text-xs opacity-70';
      idLine.textContent = `${this.plugin.t('annotations.measurements.resultId')}: ${result.id}`;

      card.append(header, value, idLine);
      root.appendChild(card);
    }

    this._renderCalculator();
  }

  _renderCalculator() {
    const buildOptions = (target) => {
      if (!target) return;
      target.replaceChildren();
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = this.plugin.t('annotations.measurements.pick');
      target.appendChild(empty);
      this.results.forEach((result) => {
        const optionEl = document.createElement('option');
        optionEl.value = result.id;
        optionEl.textContent = `${result.id} — ${result.label} (${result.metric})`;
        target.appendChild(optionEl);
      });
    };

    buildOptions(document.getElementById('pmw-calc-a'));
    buildOptions(document.getElementById('pmw-calc-b'));
  }

  _computeSelected() {
    const presetId = document.getElementById('pmw-preset')?.value;
    const metric = [...document.querySelectorAll('input[name="pmw-metric"]')].find((n) => n.checked)?.value || 'area';
    if (!presetId) return;

    const { total, count, label } = this._computeForPreset(presetId, metric);
    const id = `R${this.resultSeq++}`;
    this.results.push({ id, label, metric, value: total, count });
    this._renderResults();
  }

  _computeForPreset(presetId, metric) {
    const objs = this.annotations.filter((o) => this.annotations.isAnnotation(o) && o.presetID === presetId);
    const preset = this.annotations.presets.get(presetId);
    const human = (preset?.meta?.category?.value || preset?.meta?.category || presetId).toString();

    let total = 0;
    let count = 0;
    const isArea = metric === 'area';

    for (const obj of objs) {
      const value = isArea ? this._areaOf(obj) : this._lengthOf(obj);
      if (Number.isFinite(value)) {
        total += value;
        count++;
      }
    }

    const sb = VIEWER.scalebar;
    total = isArea ? sb.imageArea(total) : sb.imageLength(total);
    return { total, count, metric, label: `${human} — ${metric}` };
  }

  _areaOf(object) {
    const factory = this.annotations.getAnnotationObjectFactory(object.factoryID);
    if (factory && typeof factory.getArea === 'function') {
      try {
        return factory.getArea(object);
      } catch {
      }
    }
    return undefined;
  }

  _lengthOf(object) {
    const factory = this.annotations.getAnnotationObjectFactory(object.factoryID);
    if (factory && typeof factory.getLength === 'function') {
      try {
        return factory.getLength(object);
      } catch {
      }
    }

    if (object.type === 'polyline') {
      const pts = object.points || [];
      let sum = 0;
      for (let i = 1; i < pts.length; i++) {
        sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      }
      return sum;
    }

    return undefined;
  }

  _computeCalc() {
    const aid = document.getElementById('pmw-calc-a')?.value || '';
    const bid = document.getElementById('pmw-calc-b')?.value || '';
    const op = document.getElementById('pmw-calc-op')?.value || '+';

    const A = this.results.find((r) => r.id === aid);
    const B = this.results.find((r) => r.id === bid);
    if (!A || !B) {
      this._setCalcOut('—');
      return;
    }

    if (A.metric !== B.metric) {
      this._setCalcOut(this.plugin.t('annotations.measurements.unitMismatch', { a: A.metric, b: B.metric }));
      return;
    }

    let customMetric = false;
    let out;
    switch (op) {
      case '+': out = A.value + B.value; break;
      case '-': out = A.value - B.value; break;
      case '/': out = B.value === 0 ? NaN : Math.round(A.value / B.value * 100) / 100; customMetric = 'percent'; break;
    }

    if (!Number.isFinite(out)) {
      this._setCalcOut('NaN');
      return;
    }

    this.calc = { a: aid, op, b: bid, out, metric: customMetric || A.metric };
    this._setCalcOut(customMetric ? `${out}` : this._format(out, A.metric));
  }

  _setCalcOut(text) {
    const el = document.getElementById('pmw-calc-out-val');
    if (el) el.textContent = text;
  }

  _saveCalcAsResult() {
    if (!this.calc?.out || !Number.isFinite(this.calc.out)) return;
    const a = this.results.find((r) => r.id === this.calc.a);
    const b = this.results.find((r) => r.id === this.calc.b);
    const label = `(${a?.id} ${this.calc.op} ${b?.id})`;
    const id = `R${this.resultSeq++}`;
    this.results.push({ id, label, metric: this.calc.metric, value: this.calc.out, count: 0 });
    this._renderResults();
    this._setCalcOut('—');
  }

  _copyResults() {
    const rows = [
      ['id', 'label', 'metric', 'value', 'count'].join(','),
      ...this.results.map((r) => [r.id, r.label, r.metric, this._format(r.value, r.metric), r.count].map((value) => this._csv(value)).join(','))
    ].join('\n');
    UTILITIES.copyToClipboard(rows);
  }

  _clearAll() {
    this.results = [];
    this.resultSeq = 1;
    this.calc = { a: null, op: '+', b: null, out: null };
    this._renderResults();
    this._setCalcOut('—');
  }

  _removeResult(id) {
    this.results = this.results.filter((r) => r.id !== id);
    this._renderResults();
  }

  _csv(value) {
    const text = (value ?? '').toString();
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  _format(value, type) {
    if (!Number.isFinite(value)) return 'NaN';
    const sb = VIEWER.scalebar;
    if (type === 'area') return sb.formatArea(value);
    return sb.formatLength(value);
  }
}
