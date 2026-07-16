/**
 * Measurements workspace — the unified, per-viewer measurements UX.
 *
 * A dockable window (floats over the viewer or docks as a MainLayout tab) that
 * drives the deterministic annotation-measurements engine. Replaces the old
 * three-tab PathologyMetricsWindow. Sections:
 *
 *   - Sampling header: source (raw background vs rendered composite), channel,
 *     auto/manual threshold, scope, Run/Cancel — plus the resolved slide + µm/px.
 *   - Measurements table: per-annotation area / intensity / components, CSV export.
 *   - Ratio builder: numerator ÷ denominator (annotation, preset set, or the
 *     derived tissue mask) — the clinical "region vs tissue" ask.
 *   - Composition: per-preset area breakdown inside a parent region.
 *   - Distances: nearest boundary distance to a target set (margin).
 *   - Tissue: derive an editable tissue mask via pathology-foundation (guarded).
 *
 * Every engine call is viewer-explicit; the workspace resolves the annotations'
 * active viewer at action time so it is correct under multi-viewport grids.
 */
export class MeasurementsWorkspace {
  constructor({ plugin, annotations, userInterface, pluginId }) {
    this.plugin = plugin;
    this.annotations = annotations;
    this.ui = userInterface;
    this.pluginId = pluginId;
    this.windowId = 'annotation-measurements-workspace';

    // Sampling config (mirrors engine defaults).
    this.source = 'rendered';          // "what I see" is the intuitive default
    this.channel = 'V';                // colormap-agnostic
    this.autoThreshold = true;
    this.threshold = 128;
    this.scope = 'all';
    this.targetMpp = 1.0;

    this.window = null;
    this._rows = [];                   // last measurement table rows (for CSV)
    this._tissueObjects = [];          // annotations produced by the last derive
    this._running = false;
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  open() {
    if (!this.window) this._build();
    this.window.open();
    this._refreshPickers();
  }

  t(k, vars) { return this.plugin.t(`annotations.measurements.${k}`, vars); }

  _engine() {
    const mod = (typeof singletonModule === 'function') ? singletonModule('annotation-measurements') : null;
    return mod?.getEngine?.() || null;
  }

  _pathology() {
    // Loose-coupled: tissue features are optional. Never hard-require the
    // module — singletonModule can throw when it isn't loaded.
    try {
      return (typeof singletonModule === 'function') ? singletonModule('pathology-foundation') : null;
    } catch (e) {
      return null;
    }
  }

  _viewer() {
    return this.annotations?.viewer || window.VIEWER || null;
  }

  _fabric() {
    const v = this._viewer();
    return v ? this.annotations?.getFabric?.(v) : null;
  }

  // ── window scaffolding ──────────────────────────────────────────────────

  _build() {
    const UI = globalThis.UI;
    const { div } = globalThis.van.tags;

    const body = div(
      { class: 'flex flex-col h-full text-sm', style: 'min-height:0;' },
      this._buildHeader(),
      div(
        { class: 'flex-1 overflow-y-auto p-2 space-y-3', style: 'min-height:0;' },
        this._buildMeasureSection(),
        this._buildRatioSection(),
        this._buildCompositionSection(),
        this._buildDistanceSection(),
        this._buildTissueSection(),
      ),
    );

    // A van-produced DOM node is a valid BaseComponent child (same pattern the
    // old FloatingWindow used), so pass the built body straight through.
    this.window = new UI.DockableWindow(
      {
        id: this.windowId,
        title: this.t('workspaceTitle'),
        icon: 'ph-chart-bar-horizontal',
        defaultMode: 'floating',
        floating: { width: 460, height: 560, resizable: true, closable: true },
      },
      body,
    );
    this.ui.addHtml(this.window, this.pluginId);
  }

  _select(id, options, onchange, selectedValue) {
    const { select, option } = globalThis.van.tags;
    return select(
      {
        id, 'data-role': id,
        class: 'px-2 py-1 text-sm border border-[var(--color-border-secondary)] rounded',
        style: 'background:var(--color-bg-primary);color:var(--color-text-primary);',
        onchange,
      },
      ...options.map((o) => option({ value: o.value, selected: o.value === selectedValue }, o.label)),
    );
  }

  _buildHeader() {
    const { div, label, input, span } = globalThis.van.tags;
    const channels = ['V', 'L', 'R', 'G', 'B'].map((c) => ({ value: c, label: this.t(`channels.${c}`) }));
    const sources = [
      { value: 'rendered', label: this.t('channelSource.rendered') },
      { value: 'background-raw', label: this.t('channelSource.background-raw') },
    ];
    const scopes = ['all', 'visible', 'selection', 'preset'].map((s) => ({ value: s, label: this.t(`scope.${s}`) }));

    return div(
      { class: 'flex flex-col gap-2 px-2 py-2 border-b border-[var(--color-border-secondary)]' },
      div(
        { class: 'flex items-center gap-2 flex-wrap' },
        span({ class: 'font-medium opacity-70' }, this.t('sourceLabel')),
        this._select('mw-source', sources, (e) => { this.source = e.target.value; }, this.source),
        this._select('mw-channel', channels, (e) => { this.channel = e.target.value; }, this.channel),
        this._select('mw-scope', scopes, (e) => { this.scope = e.target.value; }, this.scope),
      ),
      div(
        { class: 'flex items-center gap-2 flex-wrap' },
        label(
          { class: 'flex items-center gap-1 opacity-80' },
          input({
            type: 'checkbox', checked: this.autoThreshold,
            onchange: (e) => {
              this.autoThreshold = !!e.target.checked;
              const s = document.getElementById('mw-threshold'); if (s) s.disabled = this.autoThreshold;
            },
          }),
          this.t('thresholdAuto'),
        ),
        input({
          type: 'range', id: 'mw-threshold', min: '0', max: '255', step: '1',
          value: String(this.threshold), disabled: this.autoThreshold, class: 'flex-1',
          oninput: (e) => { this.threshold = Number(e.target.value) || 0; const v = document.getElementById('mw-threshold-val'); if (v) v.textContent = String(this.threshold); },
        }),
        span({ id: 'mw-threshold-val', class: 'font-mono w-8 text-right' }, String(this.threshold)),
      ),
      span({ id: 'mw-slide-info', class: 'text-xs opacity-60' }, ''),
    );
  }

  // ── section: per-annotation measurements ────────────────────────────────

  _section(titleKey, ...children) {
    const { div } = globalThis.van.tags;
    return div(
      { class: 'border border-[var(--color-border-secondary)] rounded' },
      div({ class: 'px-2 py-1 font-medium bg-[var(--color-bg-secondary)]' }, this.t(titleKey)),
      div({ class: 'p-2 space-y-2' }, ...children),
    );
  }

  _btn(labelKey, onclick, role) {
    const { button } = globalThis.van.tags;
    return button({
      type: 'button', ...(role ? { 'data-role': role } : {}),
      class: 'px-3 py-1 btn btn-pointer text-sm',
      onclick,
    }, this.t(labelKey));
  }

  _buildMeasureSection() {
    const { div } = globalThis.van.tags;
    return this._section(
      'sectionMeasure',
      div(
        { class: 'flex items-center gap-2' },
        this._btn('run', () => this._runMeasurements(), 'mw-run'),
        this._btn('cancel', () => this._engine()?.cancelActiveRun(), 'mw-cancel'),
        this._btn('exportCsv', () => this._exportCsv()),
        div({ id: 'mw-run-progress', class: 'text-xs opacity-70' }, ''),
      ),
      div({ id: 'mw-measure-results', class: 'text-xs max-h-56 overflow-y-auto' }, ''),
    );
  }

  async _runMeasurements() {
    const engine = this._engine();
    const viewer = this._viewer();
    if (!engine || !viewer || this._running) return;
    this._running = true;
    this._updateSlideInfo();

    const onProgress = ({ done, total }) => {
      const el = document.getElementById('mw-run-progress');
      if (el) el.textContent = this.t('progress', { done, total });
    };
    try {
      await engine.runForScope(viewer, {
        scope: this._scopeSpec(),
        includeComponents: true,
        source: this.source,
        channel: this.channel,
        threshold: this.autoThreshold ? 'auto' : this.threshold,
        targetMpp: this.targetMpp,
        onProgress,
      });
    } catch (err) {
      console.warn('[measurements] run failed', err);
    } finally {
      this._running = false;
      const el = document.getElementById('mw-run-progress'); if (el) el.textContent = '';
    }
    this._renderMeasureResults();
  }

  _scopeSpec() {
    if (this.scope === 'preset') {
      const active = this.annotations.presets?.getActivePreset?.(true);
      return { kind: 'preset', presetID: active?.presetID };
    }
    return { kind: this.scope };
  }

  _renderMeasureResults() {
    const root = document.getElementById('mw-measure-results');
    if (!root) return;
    const engine = this._engine();
    const viewer = this._viewer();
    root.replaceChildren();
    this._rows = [];

    const objs = engine._collectScope(viewer, this._scopeSpec());
    const cfg = { source: this.source, channel: this.channel };
    const { div, table, thead, tbody, tr, th, td } = globalThis.van.tags;

    const head = tr({}, ...['label', 'area', 'mean', 'percentPositive', 'components', 'density']
      .map((k) => th({ class: 'text-left px-1 opacity-70' }, this.t(`col.${k}`))));

    const bodyRows = [];
    for (const o of objs) {
      const geo = engine.getGeometric(viewer, o);
      const cached = engine.getCached(o, cfg) || {};
      const comp = cached.components || {};
      const label = this._annotationLabel(o);
      const row = {
        label,
        area: geo.areaLabel,
        mean: Number.isFinite(cached.mean) ? cached.mean.toFixed(1) : '—',
        percentPositive: Number.isFinite(cached.percentPositive) ? `${(cached.percentPositive * 100).toFixed(1)}%` : '—',
        components: comp.count != null ? String(comp.count) : '—',
        density: Number.isFinite(comp.densityPerMm2) ? comp.densityPerMm2.toFixed(1) : '—',
      };
      this._rows.push(row);
      bodyRows.push(tr({},
        td({ class: 'px-1' }, row.label),
        td({ class: 'px-1 font-mono' }, row.area),
        td({ class: 'px-1 font-mono' }, row.mean),
        td({ class: 'px-1 font-mono' }, row.percentPositive),
        td({ class: 'px-1 font-mono' }, row.components),
        td({ class: 'px-1 font-mono' }, row.density),
      ));
    }

    if (!bodyRows.length) {
      root.appendChild(div({ class: 'opacity-70 px-1 py-2' }, this.t('noResults')));
      return;
    }
    root.appendChild(table({ class: 'w-full text-xs border-collapse' }, thead({}, head), tbody({}, ...bodyRows)));
  }

  _exportCsv() {
    if (!this._rows.length) return;
    const cols = ['label', 'area', 'mean', 'percentPositive', 'components', 'density'];
    const header = cols.map((c) => this.t(`col.${c}`)).join(',');
    const lines = this._rows.map((r) => cols.map((c) => `"${String(r[c]).replace(/"/g, '""')}"`).join(','));
    const csv = [header, ...lines].join('\n');
    try {
      navigator.clipboard?.writeText(csv);
      Dialogs?.show?.(this.t('csvCopied'), 3000, Dialogs.MSG_INFO);
    } catch (e) {
      console.warn('[measurements] csv copy failed', e);
    }
  }

  // ── section: ratio builder ──────────────────────────────────────────────

  _buildRatioSection() {
    const { div, span } = globalThis.van.tags;
    return this._section(
      'sectionRatio',
      div(
        { class: 'flex items-center gap-2 flex-wrap' },
        this._select('mw-ratio-num', this._annotationOptions(), null, undefined),
        span({ class: 'opacity-60' }, '÷'),
        this._select('mw-ratio-den', this._denominatorOptions(), null, undefined),
        this._btn('compute', () => this._computeRatio()),
      ),
      div({ id: 'mw-ratio-result', class: 'font-mono text-xs' }, ''),
    );
  }

  _computeRatio() {
    const engine = this._engine();
    const viewer = this._viewer();
    const out = document.getElementById('mw-ratio-result');
    if (!engine || !out) return;
    const num = this._annotationById(document.getElementById('mw-ratio-num')?.value);
    if (!num) { out.textContent = this.t('pickNumerator'); return; }

    const denVal = document.getElementById('mw-ratio-den')?.value;
    let res;
    if (denVal === '__tissue__') {
      res = engine.areaRatioAgainstSet(viewer, num, this._tissueObjects);
    } else if (denVal?.startsWith('preset:')) {
      const pid = denVal.slice('preset:'.length);
      const set = this._annotationsInViewer().filter((o) => String(o.presetID) === pid);
      res = engine.areaRatioAgainstSet(viewer, num, set);
    } else {
      const den = this._annotationById(denVal);
      res = den ? engine.areaRatio(viewer, num, den) : null;
    }
    if (!res || !Number.isFinite(res.ratio)) { out.textContent = this.t('ratioNa'); return; }
    out.textContent = this.t('ratioResult', { ratio: res.ratio.toFixed(4), pct: (res.ratio * 100).toFixed(1) });
  }

  // ── section: composition ────────────────────────────────────────────────

  _buildCompositionSection() {
    const { div } = globalThis.van.tags;
    return this._section(
      'sectionComposition',
      div(
        { class: 'flex items-center gap-2 flex-wrap' },
        this._select('mw-comp-parent', this._annotationOptions(), null, undefined),
        this._btn('compute', () => this._computeComposition()),
      ),
      div({ id: 'mw-comp-result', class: 'text-xs' }, ''),
    );
  }

  _computeComposition() {
    const engine = this._engine();
    const viewer = this._viewer();
    const out = document.getElementById('mw-comp-result');
    if (!engine || !out) return;
    const parent = this._annotationById(document.getElementById('mw-comp-parent')?.value);
    if (!parent) { out.textContent = this.t('pickParent'); return; }

    const candidates = this._annotationsInViewer();
    const res = engine.composition(viewer, parent, candidates, (pid) => this._presetName(pid));
    out.replaceChildren();
    if (!res || !res.rows.length) { out.textContent = this.t('compositionEmpty'); return; }

    const { div } = globalThis.van.tags;
    for (const r of res.rows) {
      out.appendChild(div(
        { class: 'flex justify-between gap-2 border-b border-[var(--color-border-secondary)] last:border-0 py-0.5' },
        div({}, r.label),
        div({ class: 'font-mono' }, `${r.areaLabel} · ${(r.fractionOfParent * 100).toFixed(1)}%`),
      ));
    }
  }

  // ── section: distances ──────────────────────────────────────────────────

  _buildDistanceSection() {
    const { div, span } = globalThis.van.tags;
    return this._section(
      'sectionDistance',
      div(
        { class: 'flex items-center gap-2 flex-wrap' },
        this._select('mw-dist-from', this._annotationOptions(), null, undefined),
        span({ class: 'opacity-60' }, '→'),
        this._select('mw-dist-to', this._targetOptions(), null, undefined),
        this._btn('compute', () => this._computeDistance()),
      ),
      div({ id: 'mw-dist-result', class: 'font-mono text-xs' }, ''),
    );
  }

  _computeDistance() {
    const engine = this._engine();
    const viewer = this._viewer();
    const out = document.getElementById('mw-dist-result');
    if (!engine || !out) return;
    const from = this._annotationById(document.getElementById('mw-dist-from')?.value);
    if (!from) { out.textContent = this.t('pickFrom'); return; }

    const toVal = document.getElementById('mw-dist-to')?.value;
    let targets;
    if (toVal === '__tissue__') targets = this._tissueObjects;
    else if (toVal?.startsWith('preset:')) {
      const pid = toVal.slice('preset:'.length);
      targets = this._annotationsInViewer().filter((o) => String(o.presetID) === pid);
    } else targets = this._annotationsInViewer();

    const res = engine.nearestDistance(viewer, from, targets);
    out.textContent = res ? this.t('distanceResult', { d: res.distanceLabel }) : this.t('distanceNa');
  }

  // ── section: tissue mask ────────────────────────────────────────────────

  _buildTissueSection() {
    const { div } = globalThis.van.tags;
    const pathology = this._pathology();
    const children = [
      div({ id: 'mw-tissue-status', class: 'text-xs opacity-70' },
        pathology ? this.t('tissueHint') : this.t('tissueUnavailable')),
    ];
    if (pathology) {
      children.unshift(div(
        { class: 'flex items-center gap-2' },
        this._btn('deriveTissue', () => this._deriveTissue(), 'mw-derive'),
      ));
    }
    return this._section('sectionTissue', ...children);
  }

  async _deriveTissue() {
    const pathology = this._pathology();
    const viewer = this._viewer();
    const status = document.getElementById('mw-tissue-status');
    if (!pathology || !viewer) return;
    if (status) status.textContent = this.t('tissueDeriving');

    // Snapshot existing annotation ids; the ones added by annotateTissue are
    // the editable tissue polygons we offer as ratio/target denominators.
    const before = new Set(this._annotationsInViewer().map((o) => o.incrementId));
    try {
      await pathology.annotateTissue(viewer, {});
      this._tissueObjects = this._annotationsInViewer().filter((o) => !before.has(o.incrementId));
      if (status) status.textContent = this.t('tissueReady', { count: this._tissueObjects.length });
      this._refreshPickers();
    } catch (err) {
      console.warn('[measurements] tissue derive failed', err);
      if (status) status.textContent = this.t('tissueFailed');
    }
  }

  // ── annotation/preset helpers ───────────────────────────────────────────

  _annotationsInViewer() {
    const f = this._fabric();
    const objs = f?.canvas?.getObjects?.() || [];
    return objs.filter((o) => f.isAnnotation?.(o));
  }

  _annotationById(idStr) {
    if (!idStr) return null;
    const id = Number(idStr);
    return this._annotationsInViewer().find((o) => o.incrementId === id) || null;
  }

  _annotationLabel(o) {
    return `${this._presetName(o.presetID)} #${o.incrementId ?? '?'}`;
  }

  _presetName(pid) {
    const p = pid != null ? this.annotations.presets?.get?.(pid) : null;
    return p?.getMetaValue?.('category') || p?.objectFactory?.title?.() || (pid != null ? String(pid) : this.t('noPreset'));
  }

  _annotationOptions() {
    return this._annotationsInViewer().map((o) => ({ value: String(o.incrementId), label: this._annotationLabel(o) }));
  }

  _presetSetOptions() {
    const ids = this.annotations.presets?.getExistingIds?.() || [];
    return ids.map((id) => ({ value: `preset:${id}`, label: this.t('presetSet', { name: this._presetName(id) }) }));
  }

  _denominatorOptions() {
    const opts = [];
    if (this._tissueObjects.length) opts.push({ value: '__tissue__', label: this.t('tissueDenominator') });
    opts.push(...this._presetSetOptions());
    opts.push(...this._annotationOptions());
    return opts.length ? opts : [{ value: '', label: this.t('noAnnotations') }];
  }

  _targetOptions() {
    const opts = [];
    if (this._tissueObjects.length) opts.push({ value: '__tissue__', label: this.t('tissueTarget') });
    opts.push(...this._presetSetOptions());
    opts.push({ value: '__all__', label: this.t('allAnnotations') });
    return opts;
  }

  // Rebuild the option lists in the pickers (annotations change as the user
  // draws / derives tissue). Cheap DOM refresh of each select's options.
  _refreshPickers() {
    this._updateSlideInfo();
    const fill = (id, options) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const prev = sel.value;
      const { option } = globalThis.van.tags;
      sel.replaceChildren(...options.map((o) => option({ value: o.value }, o.label)));
      if (options.some((o) => o.value === prev)) sel.value = prev;
    };
    fill('mw-ratio-num', this._annotationOptions());
    fill('mw-ratio-den', this._denominatorOptions());
    fill('mw-comp-parent', this._annotationOptions());
    fill('mw-dist-from', this._annotationOptions());
    fill('mw-dist-to', this._targetOptions());
  }

  _updateSlideInfo() {
    const el = document.getElementById('mw-slide-info');
    if (!el) return;
    const viewer = this._viewer();
    const mpp = window.AnnotationMeasurements?.sampler?.imageMppPerPx?.(viewer);
    const name = viewer?.scalebar?.getReferencedTiledImage?.()?.source?.getMetadata?.()?.name
      || APPLICATION_CONTEXT?.referencedName?.() || '';
    el.textContent = this.t('slideInfo', {
      name: name || '—',
      mpp: Number.isFinite(mpp) ? `${mpp.toFixed(3)} µm/px` : this.t('noCalibration'),
    });
  }
}
