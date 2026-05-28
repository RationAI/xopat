/**
 * Pathology measurements window. Three tabs:
 *  - Geometric: per-preset area / length aggregates (the original feature).
 *  - Intensity: pixel statistics (mean / median / % positive) over a channel.
 *  - Components: connected-component analysis with size / circularity stats.
 *
 * UI is rebuilt with DOM/van nodes, no raw HTML strings.
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

    // Tab state
    this.activeTab = 'geometric';

    // Pixel-mode shared state — Intensity and Components tabs reuse the same
    // channel and threshold so a "Run" on one tab doesn't shadow the other.
    this.channel = { source: 'raw', channel: 'L' };
    this.threshold = 128;
    this.scope = 'preset';
    this.componentMinSize = 1;
    this.componentMaxSize = 0;

    // Shared preset selector. The dropdown is mounted in the window's
    // sticky header; tabs read from this field rather than scraping DOM.
    this.activePresetId = null;
    this._lastRunOutcome = null;

    this._abortController = null;
    this._runningTab = null;

    this.reset();
  }

  reset() {
    if (!this.closed) return;
    this._addWindow();
    this._populatePresets();
    this._setActiveTab('geometric');
    this._renderResults();
    this._renderCalculator();
    this.closed = false;
  }

  // ──────────────────────────────────────────────────────────────────
  // Window scaffolding
  // ──────────────────────────────────────────────────────────────────

  _addWindow() {
    const UI = globalThis.UI;
    const { div, button } = globalThis.van.tags;

    const tabs = div(
      { class: 'flex border-b border-[var(--color-border-secondary)] text-sm' },
      this._tabButton('geometric', this.plugin.t('annotations.measurements.tabs.geometric')),
      this._tabButton('intensity', this.plugin.t('annotations.measurements.tabs.intensity')),
      this._tabButton('components', this.plugin.t('annotations.measurements.tabs.components')),
    );

    const sharedHeader = this._buildSharedHeader();

    const tabPanes = div(
      { class: 'flex-1 overflow-y-auto', id: 'pmw-tab-host', style: 'min-height:0;' },
      this._buildGeometricPane(),
      this._buildIntensityPane(),
      this._buildComponentsPane(),
    );

    const body = div(
      { class: 'flex flex-col h-full', style: 'min-height:0;' },
      tabs,
      sharedHeader,
      tabPanes,
      this._buildFooter(),
    );

    this.window = new UI.FloatingWindow(
      {
        id: this.windowId,
        title: this.plugin.t('annotations.measurements.title'),
        closable: true,
        onClose: () => {
          this._cancelRun();
          this.closed = true;
        }
      },
      body
    );

    this.ui.addHtml(this.window, this.pluginId);
  }

  _tabButton(id, label) {
    const { button } = globalThis.van.tags;
    return button({
      type: 'button',
      'data-tab': id,
      class: 'px-3 py-2 border-b-2 border-transparent hover:bg-[var(--color-bg-secondary)]',
      onclick: () => this._setActiveTab(id),
    }, label);
  }

  _setActiveTab(id) {
    this.activeTab = id;
    document.querySelectorAll('[data-tab]').forEach((el) => {
      const isActive = el.dataset.tab === id;
      el.classList.toggle('border-[var(--color-accent)]', isActive);
      el.classList.toggle('font-medium', isActive);
    });
    document.querySelectorAll('[data-tab-pane]').forEach((el) => {
      el.classList.toggle('hidden', el.dataset.tabPane !== id);
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Pane: Geometric (existing behaviour preserved)
  // ──────────────────────────────────────────────────────────────────

  _buildSharedHeader() {
    const { div, select } = globalThis.van.tags;
    return div(
      { class: 'flex items-center gap-2 px-2 py-1 border-b border-[var(--color-border-secondary)] text-sm' },
      div({ class: 'font-medium opacity-80' }, this.plugin.t('annotations.measurements.presetLabel')),
      select({
        id: 'pmw-preset',
        class: 'flex-1 px-2 py-1 text-sm border border-[var(--color-border-secondary)] rounded-md',
        style: 'background:var(--color-bg-primary);color:var(--color-text-primary);',
        oninput: (e) => { this.activePresetId = e.target.value || null; }
      }),
    );
  }

  _buildGeometricPane() {
    const { div, label, input, button } = globalThis.van.tags;
    return div(
      { 'data-tab-pane': 'geometric', class: 'p-2 space-y-2' },
      div(
        { class: 'flex flex-col gap-2 border-b border-[var(--color-border-secondary)] pb-2' },
        div(
          { class: 'flex gap-2 items-center flex-wrap' },
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
          button({
            type: 'button',
            class: 'px-3 py-1 btn btn-pointer text-sm',
            onclick: () => this._computeSelected()
          }, this.plugin.t('annotations.measurements.compute'))
        ),
        div({ class: 'text-xs opacity-70' }, this.plugin.t('annotations.measurements.helperText')),
      ),
      div({ id: 'pmw-results', class: 'space-y-2' }),
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Pane: Intensity
  // ──────────────────────────────────────────────────────────────────

  _buildIntensityPane() {
    const { div } = globalThis.van.tags;
    return div(
      { 'data-tab-pane': 'intensity', class: 'p-2 space-y-2 hidden' },
      div({ class: 'text-xs opacity-70' }, this.plugin.t('annotations.measurements.intensityHelper')),
      this._buildChannelControls(),
      this._buildScopeControls(),
      this._buildThresholdControls(),
      this._buildRunBar('intensity'),
      div({ id: 'pmw-intensity-results', class: 'text-sm space-y-1 mt-2' },
        div({ class: 'opacity-70' }, this.plugin.t('annotations.measurements.perAnnotationEmpty'))
      ),
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Pane: Components
  // ──────────────────────────────────────────────────────────────────

  _buildComponentsPane() {
    const { div, input, label } = globalThis.van.tags;
    return div(
      { 'data-tab-pane': 'components', class: 'p-2 space-y-2 hidden' },
      div({ class: 'text-xs opacity-70' }, this.plugin.t('annotations.measurements.componentsHelperShort')),
      this._buildChannelControls(true),
      this._buildScopeControls(true),
      this._buildThresholdControls(true),
      div(
        { class: 'flex flex-wrap gap-3 items-center text-sm' },
        label({ class: 'flex items-center gap-1' },
          this.plugin.t('annotations.measurements.componentMinSize'),
          input({
            type: 'number', min: '1', step: '1', value: String(this.componentMinSize),
            class: 'w-20 px-1 py-0.5 text-sm border rounded',
            oninput: (e) => { this.componentMinSize = Math.max(1, Number(e.target.value) || 1); }
          })
        ),
        label({ class: 'flex items-center gap-1' },
          this.plugin.t('annotations.measurements.componentMaxSize'),
          input({
            type: 'number', min: '0', step: '1', value: String(this.componentMaxSize),
            class: 'w-20 px-1 py-0.5 text-sm border rounded',
            oninput: (e) => { this.componentMaxSize = Math.max(0, Number(e.target.value) || 0); }
          })
        ),
      ),
      this._buildRunBar('components'),
      div({ id: 'pmw-components-results', class: 'text-sm space-y-1 mt-2' },
        div({ class: 'opacity-70' }, this.plugin.t('annotations.measurements.perAnnotationEmpty'))
      ),
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Shared control builders
  // ──────────────────────────────────────────────────────────────────

  _buildChannelControls(_secondary) {
    const { div, label, select, option } = globalThis.van.tags;
    const t = (k) => this.plugin.t(`annotations.measurements.${k}`);
    // Only "raw" is wired today; re-add a shader-output option here when
    // sampling per shader output is actually implemented in the engine.
    return div(
      { class: 'flex flex-wrap gap-2 items-center text-sm' },
      div({ class: 'font-medium' }, t('channelLabel')),
      div({ class: 'opacity-70' }, t('channelSource.raw')),
      select({
        class: 'px-2 py-1 text-sm border rounded',
        'data-role': 'pmw-channel-select',
        oninput: (e) => { this.channel = { ...this.channel, channel: e.target.value }; }
      },
        option({ value: 'L', selected: this.channel.channel === 'L' }, t('channels.L')),
        option({ value: 'R', selected: this.channel.channel === 'R' }, t('channels.R')),
        option({ value: 'G', selected: this.channel.channel === 'G' }, t('channels.G')),
        option({ value: 'B', selected: this.channel.channel === 'B' }, t('channels.B')),
      ),
    );
  }

  _buildScopeControls(_secondary) {
    const { div, select, option } = globalThis.van.tags;
    const t = (k) => this.plugin.t(`annotations.measurements.${k}`);
    return div(
      { class: 'flex flex-wrap gap-2 items-center text-sm' },
      div({ class: 'font-medium' }, t('scopeLabel')),
      select({
        class: 'px-2 py-1 text-sm border rounded',
        oninput: (e) => { this.scope = e.target.value; this._syncScopeSelectors(); }
      },
        option({ value: 'preset', selected: this.scope === 'preset' }, t('scope.preset')),
        option({ value: 'selection', selected: this.scope === 'selection' }, t('scope.selection')),
        option({ value: 'visible', selected: this.scope === 'visible' }, t('scope.visible')),
        option({ value: 'all', selected: this.scope === 'all' }, t('scope.all')),
      ),
      // The geometric tab already owns a preset dropdown; pixel scopes share it.
    );
  }

  _syncScopeSelectors() {
    // Currently no cross-tab sync needed; placeholder for future state.
  }

  _buildThresholdControls(_secondary) {
    const { div, input, span } = globalThis.van.tags;
    const t = (k) => this.plugin.t(`annotations.measurements.${k}`);
    return div(
      { class: 'flex items-center gap-2 text-sm' },
      div({ class: 'font-medium' }, `${t('thresholdLabel')} ${t('thresholdUnits')}`),
      input({
        type: 'range', min: '0', max: '255', step: '1', value: String(this.threshold),
        class: 'flex-1',
        oninput: (e) => {
          this.threshold = Number(e.target.value) || 0;
          document.querySelectorAll('[data-role="pmw-threshold-value"]').forEach((el) => {
            el.textContent = String(this.threshold);
          });
        }
      }),
      span({ 'data-role': 'pmw-threshold-value', class: 'font-mono w-8 text-right' }, String(this.threshold)),
    );
  }

  _buildRunBar(kind) {
    const { div, button } = globalThis.van.tags;
    const t = (k) => this.plugin.t(`annotations.measurements.${k}`);
    return div(
      { class: 'flex items-center gap-2' },
      button({
        type: 'button',
        class: 'px-3 py-1 btn btn-pointer text-sm',
        onclick: () => this._run(kind),
        'data-role': `pmw-run-${kind}`,
      }, t('run')),
      button({
        type: 'button',
        class: 'px-3 py-1 btn btn-ghost text-sm hidden',
        onclick: () => this._cancelRun(),
        'data-role': `pmw-cancel-${kind}`,
      }, t('cancel')),
      div({ 'data-role': `pmw-progress-${kind}`, class: 'text-xs opacity-70' }, ''),
    );
  }

  _buildFooter() {
    const { div, span, button, select, option } = globalThis.van.tags;
    return div(
      { class: 'p-2 border-t border-[var(--color-border-secondary)]' },
      div({ class: 'text-sm font-medium mb-2' }, this.plugin.t('annotations.measurements.combineTitle')),
      div(
        { class: 'flex gap-2 items-center mb-2' },
        select({ id: 'pmw-calc-a', class: 'px-2 py-1 text-sm border rounded-md flex-1' }),
        select(
          { id: 'pmw-calc-op', class: 'px-2 py-1 text-sm border rounded-md' },
          option({ value: '+' }, '+'),
          option({ value: '-' }, '−'),
          option({ value: '/' }, '÷'),
        ),
        select({ id: 'pmw-calc-b', class: 'px-2 py-1 text-sm border rounded-md flex-1' }),
        button({
          type: 'button', class: 'px-3 py-1 btn btn-pointer text-sm',
          onclick: () => this._computeCalc()
        }, '='),
      ),
      div(
        { id: 'pmw-calc-out', class: 'text-sm px-2 py-1 rounded-md border border-[var(--color-border-secondary)]' },
        span({ class: 'opacity-70' }, `${this.plugin.t('annotations.measurements.resultLabel')}: `),
        span({ id: 'pmw-calc-out-val' }, '—'),
      ),
      div(
        { class: 'flex gap-2 mt-2' },
        button({ type: 'button', class: 'px-3 py-1 btn btn-pointer text-sm', onclick: () => this._saveCalcAsResult() },
          this.plugin.t('annotations.measurements.saveResult')),
        button({ type: 'button', class: 'px-3 py-1 btn btn-pointer text-sm', onclick: () => this._copyResults() },
          this.plugin.t('annotations.measurements.copyCsv')),
        button({ type: 'button', class: 'px-3 py-1 btn btn-pointer text-sm', onclick: () => this._clearAll() },
          this.plugin.t('annotations.measurements.clear')),
      ),
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Engine access
  // ──────────────────────────────────────────────────────────────────

  _engine() {
    const mod = (typeof singletonModule === 'function')
      ? singletonModule('annotation-measurements')
      : null;
    return mod?.getEngine?.() || null;
  }

  // ──────────────────────────────────────────────────────────────────
  // Geometric run (existing)
  // ──────────────────────────────────────────────────────────────────

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

    // Preserve current selection if still valid; otherwise pick first.
    const stillValid = options.some((o) => String(o.id) === String(this.activePresetId));
    if (!stillValid) this.activePresetId = options[0]?.id ?? null;
    if (this.activePresetId != null) sel.value = String(this.activePresetId);
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
    const presetId = this.activePresetId || document.getElementById('pmw-preset')?.value;
    const metric = [...document.querySelectorAll('input[name="pmw-metric"]')].find((n) => n.checked)?.value || 'area';
    if (!presetId) return;

    const { total, count, label } = this._computeForPreset(presetId, metric);
    const id = `R${this.resultSeq++}`;
    this.results.push({ id, label, metric, value: total, count });
    this._renderResults();
  }

  _computeForPreset(presetId, metric) {
    const engine = this._engine();
    const objs = engine
      ? engine._collectScope({ kind: 'preset', presetID: presetId })
      : [];
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

  // ──────────────────────────────────────────────────────────────────
  // Pixel-mode runs
  // ──────────────────────────────────────────────────────────────────

  async _run(kind) {
    const engine = this._engine();
    if (!engine) {
      console.warn('[measurements] annotation-measurements module not available');
      return;
    }
    if (this._abortController) return;

    this._runningTab = kind;
    this._abortController = new AbortController();
    this._setRunningUi(kind, true);

    const presetId = this.activePresetId || document.getElementById('pmw-preset')?.value || null;
    const scope = this.scope === 'preset'
      ? { kind: 'preset', presetID: presetId }
      : { kind: this.scope };

    const metrics = new Set();
    if (kind === 'intensity') {
      metrics.add('mean'); metrics.add('median'); metrics.add('percentPositive');
    } else {
      metrics.add('components');
    }

    const onProgress = ({ done, total }) => {
      const el = document.querySelector(`[data-role="pmw-progress-${kind}"]`);
      if (el) el.textContent = this.plugin.t('annotations.measurements.progress', { done, total });
    };

    let outcome = null;
    try {
      outcome = await engine.runForScope({
        scope,
        metrics,
        channel: this.channel,
        threshold: this.threshold,
        options: { minSize: this.componentMinSize, maxSize: this.componentMaxSize },
        onProgress,
        signal: this._abortController.signal,
      });
    } catch (err) {
      console.warn('[measurements] run failed', err);
    } finally {
      this._setRunningUi(kind, false);
      this._abortController = null;
      this._runningTab = null;
    }

    if (outcome) {
      this._renderPixelResults(kind, outcome, presetId);
      this._appendAggregateResult(kind, outcome, presetId);
    }
  }

  _cancelRun() {
    if (this._abortController) {
      try { this._abortController.abort(); } catch { /* no-op */ }
    }
  }

  _setRunningUi(kind, running) {
    document.querySelectorAll(`[data-role="pmw-run-${kind}"]`).forEach((el) => {
      el.disabled = running;
      el.textContent = running
        ? this.plugin.t('annotations.measurements.running')
        : this.plugin.t('annotations.measurements.run');
    });
    document.querySelectorAll(`[data-role="pmw-cancel-${kind}"]`).forEach((el) => {
      el.classList.toggle('hidden', !running);
    });
    if (!running) {
      const prog = document.querySelector(`[data-role="pmw-progress-${kind}"]`);
      if (prog) prog.textContent = '';
    }
  }

  _renderPixelResults(kind, outcome, presetId) {
    const root = document.getElementById(kind === 'intensity' ? 'pmw-intensity-results' : 'pmw-components-results');
    if (!root) return;
    root.replaceChildren();

    const engine = this._engine();
    if (!engine) return;
    const objs = engine._collectScope(this.scope === 'preset' ? { kind: 'preset', presetID: presetId } : { kind: this.scope });

    // Run summary: total scope size, cached, and per-reason skip breakdown.
    // Group dynamically so any reason the engine emits surfaces verbatim
    // instead of being lumped under a catch-all "no-sample" bucket.
    const total = outcome?.total ?? 0;
    const errors = outcome?.errors || [];
    const byReason = new Map();
    for (const e of errors) {
      const key = e?.reason || 'unknown';
      byReason.set(key, (byReason.get(key) || 0) + 1);
    }
    let cached = 0;
    for (const obj of objs) if (engine.getCached(obj, this.channel)) cached++;

    const summary = document.createElement('div');
    summary.className = 'text-xs';
    const skipped = errors.length;
    const reasonBits = [...byReason.entries()].map(([r, n]) => `${r}: ${n}`);
    summary.textContent = `Ran on ${total} · cached ${cached}${skipped ? ` · skipped ${skipped} (${reasonBits.join(', ')})` : ''}`;
    root.appendChild(summary);

    // Map each emitted engine reason to a localised actionable line. Reasons
    // not in this map fall through to `reason.generic` so the user still
    // sees the raw key — better than swallowing the failure.
    const reasonKeys = {
      'no-api': 'reason.noApi',
      'no-active-visualization': 'reason.noActiveVisualization',
      'out-of-viewport': 'reason.outOfViewport',
      'too-small': 'reason.tooSmall',
      'render-failed': 'reason.renderFailed',
      'render-empty': 'reason.renderEmpty',
      'no-sample': 'reason.noSample',
      'unsupported-shape': 'reason.unsupportedShape',
      'unknown': 'reason.unknown',
    };
    for (const [reason, count] of byReason) {
      const i18nKey = reasonKeys[reason] || 'reason.generic';
      const line = document.createElement('div');
      line.className = 'text-xs text-yellow-500';
      line.textContent = this.plugin.t(`annotations.measurements.${i18nKey}`, { count, reason });
      root.appendChild(line);
    }

    const hint = document.createElement('div');
    hint.className = 'text-xs opacity-60';
    hint.textContent = this.plugin.t('annotations.measurements.channelHint', {
      source: this.plugin.t(`annotations.measurements.channelSource.${this.channel.source}`),
      channel: this.plugin.t(`annotations.measurements.channels.${this.channel.channel}`)
    });
    root.appendChild(hint);

    const list = document.createElement('div');
    list.className = 'mt-1 max-h-64 overflow-y-auto border border-[var(--color-border-secondary)] rounded';

    let any = false;
    for (const obj of objs) {
      const cached = engine.getCached(obj, this.channel);
      if (!cached) continue;
      any = true;
      const row = document.createElement('div');
      row.className = 'flex justify-between gap-2 px-2 py-1 text-xs border-b border-[var(--color-border-secondary)] last:border-0';
      const left = document.createElement('span');
      left.textContent = this.plugin.t('annotations.measurements.annotationLabel', {
        id: obj.incrementId ?? '?', type: obj.factoryID || obj.type || '?'
      });
      const right = document.createElement('span');
      right.className = 'font-mono';
      if (kind === 'intensity') {
        right.textContent = `μ=${this._fmtNum(cached.mean)}, med=${this._fmtNum(cached.median)}, %+=${this._fmtPct(cached.percentPositive)}`;
      } else {
        const comps = cached.components || {};
        right.textContent = `n=${comps.count ?? 0}, mean=${this._fmtNum(comps.meanArea)}px², med=${this._fmtNum(comps.medianArea)}, ⌀=${this._fmtNum(comps.circularities ? this._meanArr(comps.circularities) : NaN, 3)}`;
      }
      row.append(left, right);
      list.appendChild(row);
    }

    if (!any) {
      const empty = document.createElement('div');
      empty.className = 'text-xs opacity-70 px-2 py-1';
      empty.textContent = this.plugin.t('annotations.measurements.perAnnotationEmpty');
      list.appendChild(empty);
    }

    root.appendChild(list);

    // Notify board panels — their column may want to repaint. Each FabricWrapper
    // broadcasts this so any open AnnotationBoardPanel that subscribed picks it up.
    try {
      const wrappers = window.OSDAnnotations?.FabricWrapper?.instances?.() || [];
      for (const w of wrappers) w?.raiseEvent?.('annotation-measurements-updated');
    } catch { /* non-fatal */ }
  }

  _appendAggregateResult(kind, outcome, presetId) {
    // Add a single "preset aggregate" entry to the calculator-friendly result list.
    const engine = this._engine();
    if (!engine) return;
    const objs = engine._collectScope(this.scope === 'preset' ? { kind: 'preset', presetID: presetId } : { kind: this.scope });
    if (!objs.length) return;

    const preset = presetId ? this.annotations.presets.get(presetId) : null;
    const human = preset
      ? (preset.meta?.category?.value || preset.meta?.category || presetId)
      : this.plugin.t(`annotations.measurements.scope.${this.scope}`);

    let weightedSum = 0, weightedDen = 0, totalCount = 0;
    let aggMetric = 'percent';
    if (kind === 'intensity') {
      // Pixel-weighted mean intensity across the scope.
      for (const obj of objs) {
        const c = engine.getCached(obj, this.channel);
        if (!c || !Number.isFinite(c.mean)) continue;
        const w = c.pixelCount || 1;
        weightedSum += c.mean * w;
        weightedDen += w;
        totalCount++;
      }
      aggMetric = 'intensity';
    } else {
      // Sum components across scope.
      for (const obj of objs) {
        const c = engine.getCached(obj, this.channel)?.components;
        if (!c) continue;
        weightedSum += c.count;
        totalCount++;
      }
      weightedDen = 1;
      aggMetric = 'components';
    }

    if (!totalCount) return;
    const value = weightedDen > 0 ? weightedSum / (kind === 'intensity' ? weightedDen : 1) : NaN;
    const id = `R${this.resultSeq++}`;
    this.results.push({
      id,
      label: `${human} — ${kind === 'intensity' ? 'mean intensity' : 'component count'}`,
      metric: aggMetric,
      value,
      count: totalCount,
    });
    this._renderResults();
  }

  _meanArr(arr) {
    if (!arr || !arr.length) return NaN;
    let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  _fmtNum(v, digits = 2) {
    if (!Number.isFinite(v)) return '—';
    return v.toFixed(digits);
  }

  _fmtPct(v) {
    if (!Number.isFinite(v)) return '—';
    return `${(v * 100).toFixed(1)}%`;
  }

  // ──────────────────────────────────────────────────────────────────
  // Calculator (existing) + utilities
  // ──────────────────────────────────────────────────────────────────

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
    if (type === 'length') return sb.formatLength(value);
    if (type === 'intensity') return value.toFixed(2);
    if (type === 'components') return String(value | 0);
    return String(value);
  }
}
