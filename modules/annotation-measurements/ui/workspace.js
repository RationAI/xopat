(function (global) {
    'use strict';

    /**
     * The measurements panel — canvas-first.
     *
     * The canvas selection *is* the measurement subject: whatever you select (or
     * draw) is measured immediately, with no Run button, because geometry is pure
     * polygon math and costs nothing. Raster sampling — intensity, % positive,
     * connected components — is the only thing behind an explicit action, because
     * it is the only thing that is expensive.
     *
     * Operands for the compare row are picked by clicking the region on the slide
     * (see `ui/picker.js`); a menu remains only for the operands that have no
     * canvas identity (a whole class, the derived tissue mask, "all").
     *
     * Everything the engine is asked is viewer-explicit — the viewer comes from
     * the selection event or from the annotation's owning fabric wrapper, never
     * from `window.VIEWER` (AGENTS.md §6).
     */
    const NS = global.AnnotationMeasurements = global.AnnotationMeasurements || {};
    const UI_NS = NS.ui = NS.ui || {};

    const CHANNELS = ['V', 'L', 'R', 'G', 'B'];
    const SOURCES = ['rendered', 'background-raw'];
    const BATCH_SCOPES = ['selection', 'visible', 'all'];
    const OPERATIONS = ['areaRatio', 'composition', 'distance'];

    let WorkspaceClass = null;

    /**
     * The class is built on first use: `UI.BaseComponent` does not exist yet when
     * this file is evaluated during module load.
     */
    function defineWorkspace() {
        if (WorkspaceClass) return WorkspaceClass;
        const UI = global.UI;
        const { div, span, button, select, option, input, label, table, thead, tbody, tr, th, td } = global.van.tags;
        const fmt = UI_NS.format;
        const pick = UI_NS.picker;

        WorkspaceClass = class MeasurementsWorkspace extends UI.BaseComponent {
            /**
             * @param {object} options
             * @param {XOpatModuleSingleton} options.module owning module (translations, options cache)
             * @param {OSDAnnotations} options.annotations
             */
            constructor({ module, annotations }) {
                super({ id: 'annotation-measurements-panel' });
                this.module = module;
                this.annotations = annotations;
                this.t = (k, v) => module.t(k, v);

                // Sampling configuration — user preference, persisted through the
                // module option map (kv:cache). Never a security decision, so the
                // §7 getStaticMeta rule does not apply here.
                this.source = module.getOption('source', 'rendered');
                this.channel = module.getOption('channel', 'V');
                this.autoThreshold = module.getOption('autoThreshold', true) !== false;
                this.threshold = Number(module.getOption('threshold', 128)) || 128;
                this.targetMpp = Number(module.getOption('targetMpp', 1)) || 1;
                this.batchScope = module.getOption('batchScope', 'selection');

                /** @type {fabric.Object[]} current canvas selection */
                this.subjects = [];
                this.operandA = null;
                this.operandB = null;
                this.aPinned = false;
                this.operation = 'areaRatio';
                // How far from the subject a tissue island may sit, as a fraction of the
                // current viewport width — so the rule follows the zoom.
                this.tissueFactor = Number(module.getOption('tissueFactor', 0.25)) || 0.25;
                this.rows = [];
                this._running = false;
                this._deriving = false;
                // While set, canvas selection events do not move the subject. The
                // annotations module selects every annotation it adds (with
                // `fromCanvas: true`), so a derivation that adds N islands would
                // otherwise turn the subject into the last island mid-flight.
                this._suspendSubjectSync = false;

                this.picker = new pick.CanvasPicker({
                    annotations,
                    t: this.t,
                    onArmedChange: (armed) => this._onArmedChange(armed),
                    snapshot: () => this._selectionSnapshot(),
                });
                this._bindEvents();
            }

            // ── engine / viewer resolution ──────────────────────────────────

            get engine() { return this.module.getEngine(); }

            /** Channel logger — console output has no level and no way out of the tab. */
            get log() {
                if (!this._log) this._log = APPLICATION_CONTEXT.log(`module.${this.module.id}`);
                return this._log;
            }

            /** Single source of truth, shared with the popover and scripting. */
            get cfg() { return this.module.samplingConfig(); }

            /** Viewer of the current subject, else the annotations' active viewer. */
            viewer() {
                const first = this.subjects[0];
                return first ? fmt.viewerOf(this.annotations, first) : (this.annotations?.viewer || null);
            }

            // ── window ──────────────────────────────────────────────────────

            open(annotation) {
                if (!this.window) {
                    this.window = new UI.DockableWindow({
                        id: 'annotation-measurements-workspace',
                        title: this.t('workspaceTitle'),
                        icon: 'ph-chart-bar-horizontal',
                        defaultMode: 'floating',
                        floating: { width: 340, height: 430, resizable: true, closable: true },
                    }, this);
                    USER_INTERFACE.addHtml(this.window, this.module.id);
                }
                this.window.open();

                if (annotation) pick.selectAnnotation(this.annotations, annotation, true);
                this._syncSubjectsFromCanvas();
                // Opening with nothing selected is the normal case, not an error
                // state: arm picking so the very next canvas click measures.
                if (!this.subjects.length && !this.picker.isArmed()) {
                    // The pick here IS the selection, so nothing is restored afterwards.
                    this.picker.arm('subject', (operand) => {
                        pick.selectAnnotation(this.annotations, operand.object, true);
                    }, { restoreSelection: false });
                }
                this.refresh();
            }

            get visible() {
                return !this.window || this.window.isEffectivelyVisible?.() !== false;
            }

            // ── events ──────────────────────────────────────────────────────

            _bindEvents() {
                const a = this.annotations;
                a.addFabricHandler('annotation-selection-changed', (e) => {
                    // A pick consumes the event: it must not also move the subject.
                    if (this.picker.consume(e)) { this.refresh(); return; }
                    if (!this.visible) return;
                    this._syncSubjectsFromCanvas(e);
                    this.refresh();
                });
                const invalidate = () => {
                    if (!this.visible) return;
                    this._syncSubjectsFromCanvas();
                    this.refresh();
                };
                for (const evt of ['annotation-create', 'annotation-delete', 'annotation-edit-end',
                    'annotation-preset-change', 'annotation-measurements-updated']) {
                    a.addFabricHandler(evt, invalidate);
                }
            }

            _syncSubjectsFromCanvas(event) {
                this._pruneOperands();
                if (this._suspendSubjectSync) return;
                const viewer = event?.viewer || this.annotations?.viewer || null;
                const fabric = viewer ? this.annotations?.getFabric?.(viewer) : null;
                const selected = (fabric?.getSelectedAnnotations?.() || []).filter(Boolean);
                // Drop annotations deleted since the last event.
                this.subjects = selected.filter((o) => fabric.isAnnotation?.(o));
                if (!this.aPinned) {
                    this.operandA = this.subjects.length === 1
                        ? { kind: 'annotation', object: this.subjects[0] }
                        : null;
                }
            }

            /**
             * Forget operands whose annotations left the canvas. Without this a
             * deleted mask stayed in its slot, hover drew a highlight of a ghost
             * and click panned to where it used to be.
             */
            _pruneOperands() {
                const a = pick.pruneOperand(this.annotations, this.operandA);
                if (a !== this.operandA) {
                    this.operandA = a;
                    if (!a) this.aPinned = false;
                }
                this.operandB = pick.pruneOperand(this.annotations, this.operandB);
            }

            /** The current selection and its fabric — what a pick must put back. */
            _selectionSnapshot() {
                const viewer = this.viewer();
                const fabric = viewer ? this.annotations?.getFabric?.(viewer) : null;
                if (!fabric) return null;
                return { fabric, objects: (fabric.getSelectedAnnotations?.() || []).filter(Boolean) };
            }

            _onArmedChange(armed) {
                const slot = this.picker.armedSlot;
                this.chipA?.setArmed(armed && slot === 'A');
                this.chipB?.setArmed(armed && slot === 'B');
                this.emptyHint?.classList.toggle('text-primary', armed && slot === 'subject');
            }

            // ── build ───────────────────────────────────────────────────────

            create() {
                return div(
                    { id: this.id, class: 'flex flex-col h-full text-sm min-h-0' },
                    this._buildSubject(),
                    this._buildCompare(),
                    div(
                        { class: 'flex-1 overflow-y-auto p-2 space-y-2 min-h-0' },
                        this._buildBatch(),
                        this._buildAdvanced(),
                    ),
                    this._buildFooter(),
                );
            }

            _buildSubject() {
                this.subjectTitle = span({ class: 'font-medium truncate' }, '');
                this.subjectSwatch = span({ class: 'w-2.5 h-2.5 rounded-full shrink-0 opacity-0' });
                this.measureBtn = button({
                    type: 'button',
                    class: 'btn btn-xs btn-primary shrink-0',
                    onclick: () => this._measureSubjects(),
                }, this.t('measure'));

                this.subjectRow = div(
                    { class: 'flex items-center gap-2 min-w-0' },
                    div({
                        class: 'flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer',
                        onmouseenter: () => this._hoverSubject(true),
                        onmouseleave: () => this._hoverSubject(false),
                        onclick: () => this.subjects.length === 1
                            && pick.focusAnnotation(this.annotations, this.subjects[0]),
                    }, this.subjectSwatch, this.subjectTitle),
                    this.measureBtn,
                );

                this.statsList = div({ class: 'mt-1 space-y-0.5' });
                this.reasonLine = div({ class: 'mt-1 text-xs text-warning hidden' }, '');

                this.emptyHint = div({ class: 'flex items-center gap-1.5 text-xs' },
                    span({ class: 'ph-light ph-crosshair-simple' }), span({}, this.t('pickHint')));
                this.measureVisibleBtn = button({
                    type: 'button',
                    class: 'btn btn-xs btn-ghost mt-1',
                    onclick: () => { this.batchScope = 'visible'; this._runBatch(); },
                }, this.t('measureAllVisible'));
                this.emptyBlock = div({ class: 'hidden' }, this.emptyHint, this.measureVisibleBtn);

                return div(
                    { class: 'px-2 py-2 border-b border-base-300 shrink-0' },
                    this.subjectRow, this.statsList, this.reasonLine, this.emptyBlock,
                );
            }

            _buildCompare() {
                const viewer = () => this.viewer();
                this.chipA = pick.operandChip({
                    annotations: this.annotations, t: this.t, slot: 'A', picker: this.picker, viewer,
                    onChange: (operand) => {
                        this.operandA = operand;
                        this.aPinned = !!operand;
                        this.refresh();
                    },
                    // A takes set-valued operands too now, so it needs the same menu.
                    onMenu: (e) => this._openOperandMenu(e, 'A'),
                });
                this.chipB = pick.operandChip({
                    annotations: this.annotations, t: this.t, slot: 'B', picker: this.picker, viewer,
                    onChange: (operand) => { this.operandB = operand; this.refresh(); },
                    onMenu: (e) => this._openOperandMenu(e, 'B'),
                });

                this.swapBtn = button({
                    type: 'button',
                    class: 'btn btn-xs btn-ghost px-1 shrink-0',
                    title: this.t('swapOperands'),
                    onclick: () => this._swapOperands(),
                }, span({ class: 'ph-light ph-arrows-left-right' }));

                // `.select`/`.select-xs` declare no width, so the element sizes to its
                // widest <option> plus a 2.5rem arrow gutter. Cap it inline: the shipped
                // Tailwind is purged and `w-*` above w-4 does not exist, so a class here
                // silently does nothing (which is what flattened both chips to zero).
                this.opSelect = select({
                    class: 'select select-xs',
                    style: 'max-width: 9rem;',
                    onchange: (e) => { this.operation = e.target.value; this.refresh(); },
                }, ...OPERATIONS.map((o) => option({ value: o, selected: o === this.operation }, this.t(`op.${o}`))));

                this.compareResult = div({ class: 'text-xs font-mono min-w-0' }, '');

                return div(
                    { class: 'px-2 py-2 border-b border-base-300 shrink-0' },
                    // Explicit grid tracks rather than flex growth: the two chips get equal
                    // halves of whatever the operator leaves, and neither can be squeezed out.
                    div({ class: 'grid items-center gap-1', style: 'grid-template-columns: 1fr auto 1fr;' },
                        this.chipA.node, this.opSelect, this.chipB.node),
                    div({ class: 'flex items-center gap-2 mt-1' }, this.swapBtn, this.compareResult),
                );
            }

            _buildBatch() {
                this.batchScopeSelect = select({
                    class: 'select select-xs',
                    style: 'max-width: 9rem;',
                    onchange: (e) => {
                        this.batchScope = e.target.value;
                        this.module.setOption('batchScope', this.batchScope);
                        this._renderTable();
                    },
                }, ...BATCH_SCOPES.map((s) => option({ value: s, selected: s === this.batchScope }, this.t(`scope.${s}`))));

                this.batchProgress = span({ class: 'text-xs opacity-70' }, '');
                this.tableHost = div({ class: 'mt-2 overflow-y-auto', style: 'max-height: 14rem;' });

                const body = div(
                    { class: 'space-y-2' },
                    div({ class: 'flex items-center gap-1 flex-wrap' },
                        this.batchScopeSelect,
                        button({ type: 'button', class: 'btn btn-xs', onclick: () => this._runBatch() }, this.t('measureAll')),
                        button({ type: 'button', class: 'btn btn-xs btn-ghost', onclick: () => this.engine?.cancelActiveRun() }, this.t('cancel')),
                        button({ type: 'button', class: 'btn btn-xs btn-ghost', onclick: () => this._copyCsv() }, this.t('exportCsv')),
                        this.batchProgress),
                    this.tableHost,
                );
                this.batchTitle = span({}, this._batchTitleText(0));
                // van tags take Nodes, not components — a BaseComponent child
                // would be stringified. `toNode` also hands back the <details>
                // element, which is what tells us whether the section is open.
                this.batchSection = UI.BaseComponent.toNode(
                    new UI.Collapse({ title: this.batchTitle, open: false }, body));
                this.batchSection.addEventListener('toggle', () => this._renderTable());
                return this.batchSection;
            }

            _buildAdvanced() {
                const mk = (values, current, onchange, keyPrefix) => select(
                    { class: 'select select-xs w-full', onchange },
                    ...values.map((v) => option({ value: v, selected: v === current }, this.t(`${keyPrefix}.${v}`))),
                );

                this.thresholdInput = input({
                    type: 'range', min: '0', max: '255', step: '1',
                    value: String(this.threshold), disabled: this.autoThreshold, class: 'range range-xs flex-1',
                    oninput: (e) => {
                        this.threshold = Number(e.target.value) || 0;
                        this.module.setOption('threshold', this.threshold);
                        this.thresholdValue.textContent = String(this.threshold);
                    },
                    onchange: () => this.refresh(),
                });
                this.thresholdValue = span({ class: 'font-mono text-right text-xs', style: 'width: 2rem;' }, String(this.threshold));

                const row = (labelKey, control) => div({ class: 'flex items-center gap-2' },
                    span({ class: 'shrink-0 text-xs opacity-70', style: 'width: 5rem;' }, this.t(labelKey)), control);

                const body = div(
                    { class: 'space-y-2' },
                    row('sourceLabel', mk(SOURCES, this.source, (e) => {
                        this.source = e.target.value;
                        this.module.setOption('source', this.source);
                        this.refresh();
                    }, 'channelSource')),
                    row('channelLabel', mk(CHANNELS, this.channel, (e) => {
                        this.channel = e.target.value;
                        this.module.setOption('channel', this.channel);
                        this.refresh();
                    }, 'channels')),
                    row('thresholdLabel', div({ class: 'flex items-center gap-2 flex-1' },
                        label({ class: 'flex items-center gap-1 text-xs' },
                            input({
                                type: 'checkbox', class: 'checkbox checkbox-xs', checked: this.autoThreshold,
                                onchange: (e) => {
                                    this.autoThreshold = !!e.target.checked;
                                    this.module.setOption('autoThreshold', this.autoThreshold);
                                    this.thresholdInput.disabled = this.autoThreshold;
                                    this.refresh();
                                },
                            }), this.t('thresholdAuto')),
                        this.thresholdInput, this.thresholdValue)),
                    row('targetMpp', div({ class: 'flex items-center gap-2 flex-1' },
                        input({
                            type: 'number', min: '0.1', max: '32', step: '0.1',
                            class: 'input input-xs', style: 'width: 5rem;',
                            value: String(this.targetMpp),
                            onchange: (e) => {
                                const v = Number(e.target.value);
                                this.targetMpp = Number.isFinite(v) && v > 0 ? v : 1;
                                this.module.setOption('targetMpp', this.targetMpp);
                                this.refresh();
                            },
                        }), span({ class: 'text-xs opacity-60' }, 'µm/px'))),
                );
                return UI.BaseComponent.toNode(
                    new UI.Collapse({ title: this.t('sectionAdvanced'), open: false }, body));
            }

            _buildFooter() {
                this.footer = div({ class: 'px-2 py-1 text-xs opacity-60 border-t border-base-300 shrink-0 truncate' }, '');
                return this.footer;
            }

            // ── render ──────────────────────────────────────────────────────

            refresh() {
                if (!this.statsList) return;   // not created yet
                this._renderSubject();
                this._renderCompare();
                this._renderTable();
                this._renderFooter();
            }

            _renderSubject() {
                const n = this.subjects.length;
                this.subjectRow.classList.toggle('hidden', n === 0);
                this.statsList.classList.toggle('hidden', n === 0);
                this.emptyBlock.classList.toggle('hidden', n !== 0);
                this.reasonLine.classList.add('hidden');
                if (n === 0) {
                    const visible = this._collect({ kind: 'visible' }).length;
                    this.measureVisibleBtn.textContent = this.t('measureAllVisible', { count: visible });
                    this.measureVisibleBtn.classList.toggle('hidden', visible === 0);
                    return;
                }

                const viewer = this.viewer();
                this.statsList.replaceChildren();
                if (n === 1) {
                    const o = this.subjects[0];
                    this.subjectTitle.textContent = fmt.annotationLabel(this.annotations, o, this.t);
                    const color = fmt.presetColor(this.annotations, o.presetID);
                    this.subjectSwatch.style.background = color || '';
                    this.subjectSwatch.classList.toggle('opacity-0', !color);
                    for (const r of fmt.statRows(this.engine, viewer, o, this.cfg, this.t)) {
                        this.statsList.appendChild(this._statRow(r.label, r.value, r.computed, r.help));
                    }
                    this._appendThresholdNote(o);
                } else {
                    this.subjectTitle.textContent = this.t('selectedCount', { count: n });
                    this.subjectSwatch.classList.add('opacity-0');
                    const agg = fmt.aggregateStats(this.engine, viewer, this.subjects);
                    this.statsList.appendChild(this._statRow(this.t('totalArea'), agg.totalAreaLabel, true));
                    this.statsList.appendChild(this._statRow(this.t('meanArea'), agg.meanAreaLabel, true));
                    // One unit down the whole list; these rows exist to be compared.
                    const areas = fmt.areaLabelsFor(this.engine, viewer, this.subjects);
                    this.subjects.forEach((o, i) => this.statsList.appendChild(this._subjectItem(o, areas[i])));
                }
            }

            /**
             * Say which cut "% positive" was measured against, and on which channel.
             *
             * With Auto on, Otsu is computed per annotation FROM ITS OWN histogram, so
             * two rows of the table are thresholded differently and their percentages
             * are not comparable. Nothing on screen said so, which makes the number
             * easy to over-read.
             */
            _appendThresholdNote(object) {
                const cached = this.engine.getCached(object, this.cfg);
                if (!cached || !Number.isFinite(cached.threshold)) return;
                this.statsList.appendChild(div({ class: 'text-xs opacity-60 pt-0.5' },
                    this.t(cached.thresholdAuto ? 'thresholdNoteAuto' : 'thresholdNoteFixed', {
                        value: Math.round(cached.threshold),
                        channel: this.t(`channels.${cached.channel}`),
                    })));
            }

            _statRow(labelText, value, computed, help = '') {
                return div({ class: 'flex justify-between gap-3', title: help },
                    span({ class: 'opacity-70' }, labelText),
                    span({ class: `font-mono${computed ? '' : ' opacity-40'}` }, value));
            }

            /** One row of a multi-selection: label + area, hover-highlights, click-focuses. */
            _subjectItem(object, area) {
                const color = fmt.presetColor(this.annotations, object.presetID);
                return div({
                    class: 'flex items-center justify-between gap-2 cursor-pointer hover:bg-base-200 rounded px-1',
                    onmouseenter: () => pick.hoverHighlight(this.annotations, object, true),
                    onmouseleave: () => pick.hoverHighlight(this.annotations, object, false),
                    onclick: () => pick.focusAnnotation(this.annotations, object),
                },
                div({ class: 'flex items-center gap-1.5 min-w-0' },
                    span({ class: 'w-2 h-2 rounded-full shrink-0', style: `background:${color}` }),
                    span({ class: 'truncate' }, fmt.annotationLabel(this.annotations, object, this.t))),
                span({ class: 'font-mono shrink-0' }, area));
            }

            _hoverSubject(on) {
                if (this.subjects.length === 1) pick.hoverHighlight(this.annotations, this.subjects[0], on);
            }

            // ── compare ─────────────────────────────────────────────────────

            /**
             * Exchange the two operands.
             *
             * Also drops the "A follows the canvas selection" pin: after a swap A is
             * something the user chose, and letting the next selection change silently
             * overwrite it would undo the swap they just asked for.
             */
            _swapOperands() {
                if (this.operation === 'composition') return;
                const a = this.operandA;
                this.operandA = this.operandB;
                this.operandB = a;
                this.aPinned = !!this.operandA;
                this.refresh();
            }

            _renderCompare() {
                this.chipA.set(this.operandA);
                this.chipB.set(this.operandB);
                const isComposition = this.operation === 'composition';
                this.chipB.node.classList.toggle('hidden', isComposition);
                // Nothing to swap when the right-hand side is not in play.
                this.swapBtn.disabled = isComposition;
                this.swapBtn.classList.toggle('btn-disabled', isComposition);
                this.swapBtn.title = isComposition ? this.t('swapNotForComposition') : this.t('swapOperands');
                this.compareResult.replaceChildren();

                const a = this.operandA;
                if (!a) {
                    this.compareResult.textContent = this.t('pickSubjectFirst');
                    return;
                }
                const viewer = this.viewer();

                // Composition breaks a single parent down by class; a breakdown of a
                // set has no meaning, so it keeps the single-annotation requirement.
                if (this.operation === 'composition') {
                    if (a.kind !== 'annotation') {
                        this.compareResult.textContent = this.t('pickSubjectFirst');
                        return;
                    }
                    this._renderComposition(fmt.viewerOf(this.annotations, a.object), a.object);
                    return;
                }

                // Both sides resolve through the same path, which is what makes the
                // pair swappable — a single annotation is just a set of one.
                const sources = pick.operandObjects(this.annotations, viewer, a);
                const targets = pick.operandObjects(this.annotations, viewer, this.operandB);
                if (!sources.length) {
                    this.compareResult.textContent = this.t('pickSubjectFirst');
                    return;
                }
                if (!this.operandB || !targets.length) {
                    this.compareResult.textContent = this.t('pickOperandB');
                    return;
                }

                if (this.operation === 'areaRatio') {
                    const res = this.engine.areaRatioBetweenSets(viewer, sources, targets);
                    this.compareResult.textContent = (res && Number.isFinite(res.ratio))
                        ? this.t('ratioResult', { ratio: res.ratio.toFixed(4), pct: (res.ratio * 100).toFixed(1) })
                        : this.t('ratioNa');
                } else {
                    const res = this.engine.nearestDistanceBetweenSets(viewer, sources, targets);
                    this.compareResult.textContent = res
                        ? this.t('distanceResult', { d: res.distanceLabel })
                        : this.t('distanceNa');
                }
            }

            _renderComposition(viewer, parent) {
                const candidates = fmt.annotationsIn(this.annotations, viewer);
                const res = this.engine.composition(viewer, parent, candidates,
                    (pid) => fmt.presetName(this.annotations, pid, this.t));
                if (!res || !res.rows.length) {
                    this.compareResult.textContent = this.t('compositionEmpty');
                    return;
                }
                for (const r of res.rows) {
                    this.compareResult.appendChild(div(
                        { class: 'flex justify-between gap-2 border-b border-base-300 last:border-0 py-0.5' },
                        span({ class: 'truncate' }, r.label),
                        span({ class: 'font-mono shrink-0' }, `${r.areaLabel} · ${(r.fractionOfParent * 100).toFixed(1)}%`),
                    ));
                }
            }

            /**
             * The only list left: operands with no canvas identity. Individual
             * annotations are never offered here — they are picked on the slide.
             */
            /** Put an operand in a slot. `A` also pins, so the selection stops driving it. */
            _setOperand(slot, operand) {
                if (slot === 'A') {
                    this.operandA = operand;
                    this.aPinned = !!operand;
                } else {
                    this.operandB = operand;
                }
                this.refresh();
            }

            _openOperandMenu(event, slot = 'B') {
                // An item with neither `action` nor `children` renders as a section
                // header, which is how the targets are kept apart from the actions.
                const items = [{ title: this.t('menuPickTarget') }];
                // The canvas selection itself — the case "compare X against what I
                // have selected" that picking cannot express, because a pick IS a
                // canvas click and would replace that very selection.
                const selected = this._selectionSnapshot()?.objects || [];
                items.push({
                    title: selected.length ? this.t('menuSelection') : this.t('menuSelectionNone'),
                    disabled: !selected.length,
                    action: selected.length
                        ? () => this._setOperand(slot, selected.length === 1
                            ? { kind: 'annotation', object: selected[0] }
                            : { kind: 'list', objects: selected.slice(), label: this.t('scope.selection') })
                        : () => {},
                });
                const ids = Array.from(this.annotations.presets?.getExistingIds?.() || []);
                for (const id of ids) {
                    items.push({
                        title: this.t('classSet', { name: fmt.presetName(this.annotations, id, this.t) }),
                        action: () => this._setOperand(slot, { kind: 'class', presetID: id }),
                    });
                }
                items.push({
                    title: this.t('allAnnotations'),
                    action: () => this._setOperand(slot, { kind: 'all' }),
                });

                // Listed even when the module is missing. Hiding it left the user
                // hunting for a feature that was never going to appear.
                const pathology = this._pathology();
                items.push({ title: this.t('menuTissue') });
                items.push({
                    title: pathology ? this.t('tissueDerive') : this.t('tissueUnavailable'),
                    disabled: !pathology,
                    action: pathology ? () => this._deriveTissue({ slot }) : () => {},
                });
                items.push({
                    title: this.t('tissueDeriveInto'),
                    disabled: !pathology,
                    action: pathology ? () => this._openTissueDialog(slot) : () => {},
                });
                UI.ContextMenu.open(event, items);
            }

            _pathology() {
                // Optional dependency: never hard-require it, singletonModule throws
                // when the module is not loaded.
                try {
                    return (typeof singletonModule === 'function') ? singletonModule('pathology-foundation') : null;
                } catch (e) {
                    return null;
                }
            }

            /**
             * The opt-in half of derivation: choose the class and the reach first.
             *
             * Deliberately not shown by the plain "Derive tissue mask" entry — the
             * common case stays one click, and this is for when the mask needs to go
             * somewhere other than the class you happen to be drawing with.
             */
            _openTissueDialog(slot) {
                const presets = this.annotations.presets;
                // `getExistingIds` hands back the Map's key iterator, not an array.
                const ids = Array.from(presets?.getExistingIds?.() || []);
                const active = presets?.getActivePreset?.(true)?.presetID;

                const NEW_CLASS = '__new__';
                // The picker speaks strings; `presets.get` does not coerce, so map the
                // chosen value back to the key the preset map actually holds.
                const byValue = new Map(ids.map((id) => [String(id), id]));
                const options = ids.map((id) => ({
                    value: String(id),
                    label: fmt.presetName(this.annotations, id, this.t),
                    description: this._classPopulation(id),
                }));
                options.push({ value: NEW_CLASS, label: this.t('tissueNewClass') });

                const classPicker = new UI.Autocomplete({
                    size: 'sm',
                    options,
                    value: active != null ? String(active) : NEW_CLASS,
                    allowClear: false,
                });

                const factorInput = input({
                    type: 'number', min: '0', max: '10', step: '0.05',
                    class: 'input input-xs', style: 'width: 5rem;',
                    value: String(this.tissueFactor),
                });
                const hasSubject = this.subjects.length > 0;
                factorInput.disabled = !hasSubject;

                const row = (labelKey, control, hint) => div({ class: 'flex flex-col gap-1' },
                    span({ class: 'text-xs opacity-70' }, this.t(labelKey)),
                    control,
                    hint ? span({ class: 'text-xs opacity-60' }, hint) : null);

                const body = div({ class: 'flex flex-col gap-3', style: 'min-width: 20rem;' },
                    row('tissueClassLabel', UI.BaseComponent.toNode(classPicker)),
                    row('tissueReachLabel',
                        div({ class: 'flex items-center gap-2' }, factorInput,
                            span({ class: 'text-xs opacity-60' }, this.t('tissueReachUnit'))),
                        hasSubject ? this.t('tissueReachHint') : this.t('tissueReachNoSubject')),
                );

                const modal = new UI.Modal({
                    id: 'annotation-measurements-tissue-options',
                    header: this.t('tissueDeriveInto'),
                    body,
                    footer: this._dialogFooter(() => modal.close(), () => {
                        const chosen = classPicker.getValue();
                        const factor = Number(factorInput.value);
                        modal.close();
                        this._deriveTissue({
                            slot,
                            presetID: chosen === NEW_CLASS ? this._createTissueClass() : byValue.get(chosen),
                            factor: Number.isFinite(factor) && factor >= 0 ? factor : this.tissueFactor,
                        });
                    }),
                });
                modal.mount();
                modal.open();
            }

            /** "3 annotations" — so picking a populated class is an informed choice. */
            _classPopulation(presetID) {
                const count = fmt.annotationsIn(this.annotations, this.viewer())
                    .filter((o) => String(o.presetID) === String(presetID)).length;
                return count ? this.t('tissueClassInUse', { count }) : undefined;
            }

            /** A fresh class for the mask, named so it is recognisable in the class list. */
            _createTissueClass() {
                const presets = this.annotations.presets;
                const factory = this.annotations.getAnnotationObjectFactory?.('polygon');
                const preset = presets?.addPreset?.(undefined, this.t('tissueClassName'), undefined, factory);
                return preset?.presetID;
            }

            _dialogFooter(onCancel, onConfirm) {
                return div({ class: 'flex w-full justify-end gap-2' },
                    button({ type: 'button', class: 'btn btn-sm btn-ghost', onclick: onCancel }, this.t('cancel')),
                    button({ type: 'button', class: 'btn btn-sm btn-primary', onclick: onConfirm }, this.t('tissueDeriveConfirm')));
            }

            /** Width of the current viewport in image px — the unit proximity is quoted in. */
            _viewportWidthImagePx(viewer) {
                const image = viewer?.scalebar?.getReferencedTiledImage?.() || viewer?.world?.getItemAt?.(0);
                const bounds = viewer?.viewport?.getBounds?.();
                if (!image || !bounds) return NaN;
                const tl = image.viewportToImageCoordinates(bounds.x, bounds.y);
                const br = image.viewportToImageCoordinates(bounds.x + bounds.width, bounds.y + bounds.height);
                return Math.abs(br.x - tl.x);
            }

            /**
             * Decide which islands of a fresh derivation belong to the subject.
             *
             * Islands are ranked by proximity to the subject — the island it sits ON
             * first (distance 0), then by boundary distance. The nearest one is ALWAYS
             * kept: a mask derived for a region must contain that region's tissue,
             * whatever the reach says. The others survive only within `reach`, a
             * fraction of the CURRENT viewport width, so the rule moves with the zoom:
             * framed on one gland it keeps that gland's tissue, zoomed out to the whole
             * section it keeps the section. Rejected polygons are deleted — this action
             * created them a moment ago, and pruning them is the point rather than a
             * side effect.
             *
             * With no subject there is nothing to be near, so everything stays.
             *
             * @return {fabric.Object[]} kept islands, nearest first
             */
            _keepIslands(viewer, subject, created, factor) {
                if (!subject) return created;
                const ranked = NS.geometry.rankByProximity(this.annotations, subject, created);
                // Nothing measurable: keep the derivation rather than silently delete it.
                if (!ranked.length) return created;

                const reach = factor > 0 ? factor * this._viewportWidthImagePx(viewer) : 0;
                const limit = Number.isFinite(reach) ? reach : Infinity;
                const kept = ranked
                    .filter((r, i) => i === 0 || r.distancePx <= limit)
                    .map((r) => r.object);

                const fabric = this.annotations.getFabric(viewer);
                const keep = new Set(kept);
                for (const island of created) {
                    if (!keep.has(island)) fabric.deleteAnnotation(island);
                }
                return kept;
            }

            /**
             * Derive a tissue mask and hand it to a slot as the concrete set of
             * islands kept for the subject, nearest first.
             *
             * `presetID` undefined means "leave them in whatever class the derivation
             * used", which is the active one — the no-dialog path.
             *
             * Two things about the annotations module shape this method. Every
             * annotation it adds becomes the canvas selection (`fromCanvas: true`), so
             * subject sync is suspended for the duration and the pre-derivation
             * selection is put back afterwards — otherwise the subject silently became
             * the last island, the reach was measured from it, and the wrong island
             * survived. And a freshly added polygon is topmost and, while selected,
             * wins every hit-test inside it, so the mask would swallow clicks meant
             * for the annotation drawn on it: kept islands are sent to the back.
             */
            async _deriveTissue({ slot = 'B', presetID = undefined, factor = this.tissueFactor } = {}) {
                const pathology = this._pathology();
                const viewer = this.viewer();
                if (!pathology || !viewer || this._deriving) return;
                const fabric = this.annotations.getFabric(viewer);
                if (!fabric) return;
                this._deriving = true;
                this._suspendSubjectSync = true;
                this.compareResult.textContent = this.t('tissueDeriving');

                const subject = this.subjects[0] || null;
                const previousSelection = (fabric.getSelectedAnnotations?.() || []).filter(Boolean);

                try {
                    const before = new Set(fmt.annotationsIn(this.annotations, viewer).map((o) => o.incrementId));
                    await pathology.annotateTissue(viewer, {});
                    const created = fmt.annotationsIn(this.annotations, viewer)
                        .filter((o) => !before.has(o.incrementId));
                    if (!created.length) {
                        this.compareResult.textContent = this.t('tissueEmpty');
                        return;
                    }

                    const kept = this._keepIslands(viewer, subject, created, factor);

                    // Fabric draws (and hit-tests) the active object on top regardless of
                    // stacking order, so drop the selection before reordering — the same
                    // dance the annotations plugin's "Send to back" does.
                    fabric.canvas.discardActiveObject?.();
                    for (const island of kept) fabric.canvas.sendToBack?.(island);
                    fabric.canvas.requestRenderAll?.();

                    if (presetID != null) {
                        for (const island of kept) fabric.changeAnnotationPreset(island, presetID);
                    }
                    this._setOperand(slot, {
                        kind: 'list',
                        objects: kept,
                        label: fmt.presetName(this.annotations, kept[0]?.presetID, this.t),
                    });
                } catch (err) {
                    this.log.warn('tissue derivation failed', err);
                    this.compareResult.textContent = this.t('tissueFailed');
                } finally {
                    this._deriving = false;
                    this._suspendSubjectSync = false;
                    // Restore what the user had selected; this also re-syncs the subject
                    // through the ordinary selection handler.
                    pick.applySelection(fabric, previousSelection);
                    this._syncSubjectsFromCanvas();
                }
                this.refresh();
            }

            // ── measuring ───────────────────────────────────────────────────

            async _measureSubjects() {
                if (this._running || !this.subjects.length) return;
                const viewer = this.viewer();
                this._running = true;
                this.measureBtn.disabled = true;
                try {
                    if (this.subjects.length === 1) {
                        const res = await this.engine.computeForObject(viewer, this.subjects[0], {
                            ...this.cfg, includeComponents: true,
                        });
                        this._showReason(res?.reason, 1);
                    } else {
                        const res = await this.engine.runForScope(viewer, {
                            scope: { kind: 'list', list: this.subjects.slice() },
                            includeComponents: true, ...this.cfg,
                            onProgress: ({ done, total }) => {
                                this.measureBtn.textContent = this.t('progress', { done, total });
                            },
                        });
                        this._showReason(res?.errors?.[0]?.reason, res?.errors?.length || 0);
                    }
                } catch (err) {
                    this._showReason(err?.message || String(err), 1);
                } finally {
                    this._running = false;
                    this.measureBtn.disabled = false;
                    this.measureBtn.textContent = this.t('measure');
                    this.refresh();
                }
            }

            /**
             * Sampling can legitimately fail (unloaded tiles, transparent overlay,
             * unsupported shape). Say so in the panel — the old code swallowed this
             * into console.warn and the user saw an unexplained row of dashes.
             */
            _showReason(reason, count) {
                if (!reason) { this.reasonLine.classList.add('hidden'); return; }
                this.reasonLine.textContent = fmt.reasonText(this.t, reason, count);
                this.reasonLine.classList.remove('hidden');
            }

            // ── batch ───────────────────────────────────────────────────────

            _collect(scope) {
                const viewer = this.viewer();
                try {
                    return this.engine.collectScope(viewer, scope) || [];
                } catch (e) {
                    return [];
                }
            }

            /**
             * The count is whatever the scope selector currently resolves to, so the
             * title has to name that scope. It used to read "All annotations (N)"
             * while the scope was Selection — claiming the slide held one annotation
             * when it held several.
             */
            _batchTitleText(count) {
                return this.t('sectionBatch', { scope: this.t(`scope.${this.batchScope}`), count });
            }

            _batchObjects() {
                if (this.batchScope === 'selection') return this.subjects.slice();
                return this._collect({ kind: this.batchScope });
            }

            async _runBatch() {
                if (this._running) return;
                const objects = this._batchObjects();
                if (!objects.length) return;
                this._running = true;
                try {
                    await this.engine.runForScope(this.viewer(), {
                        scope: { kind: 'list', list: objects },
                        includeComponents: true, ...this.cfg,
                        onProgress: ({ done, total }) => {
                            this.batchProgress.textContent = this.t('progress', { done, total });
                        },
                    });
                } catch (err) {
                    this._showReason(err?.message || String(err), objects.length);
                } finally {
                    this._running = false;
                    this.batchProgress.textContent = '';
                    this.refresh();
                }
            }

            _renderTable() {
                if (!this.tableHost) return;
                const viewer = this.viewer();
                const objects = this._batchObjects();
                this.batchTitle.textContent = this._batchTitleText(objects.length);
                // Building a row per annotation on every selection change is the
                // one genuinely expensive thing this panel could do on a slide
                // with thousands of them. The section is closed by default, so
                // only fill it when someone is actually looking.
                if (this.batchSection && !this.batchSection.open) return;
                this.tableHost.replaceChildren();
                this.rows = [];
                if (!objects.length) {
                    this.tableHost.appendChild(div({ class: 'opacity-70 text-xs py-1' }, this.t('noResults')));
                    return;
                }

                const head = tr({}, ...fmt.TABLE_COLUMNS.map(
                    (c) => th({ class: 'text-left px-1 opacity-70 font-normal' }, this.t(`col.${c}`))));
                // The Area column shares one unit; a per-row prefix made two regions
                // a thousand apart look adjacent (7 138.95 kpx² next to 919 076.44 px²).
                const areaLabels = fmt.areaLabelsFor(this.engine, viewer, objects);
                const bodyRows = objects.map((o, i) => {
                    const row = fmt.tableRow(this.engine, viewer, o, this.cfg, this.annotations, this.t, areaLabels[i]);
                    this.rows.push(row);
                    return tr({
                        class: 'cursor-pointer hover:bg-base-200',
                        onmouseenter: () => pick.hoverHighlight(this.annotations, o, true),
                        onmouseleave: () => pick.hoverHighlight(this.annotations, o, false),
                        onclick: () => pick.selectAnnotation(this.annotations, o, true),
                    }, ...fmt.TABLE_COLUMNS.map((c) => td(
                        { class: c === 'label' ? 'px-1 truncate' : 'px-1 font-mono' }, row[c])));
                });
                this.tableHost.appendChild(
                    table({ class: 'w-full text-xs border-collapse' }, thead({}, head), tbody({}, ...bodyRows)));
            }

            _copyCsv() {
                if (!this.rows.length) return;
                const csv = fmt.rowsToCsv(this.rows, this.t);
                try {
                    navigator.clipboard?.writeText(csv);
                    global.Dialogs?.show?.(this.t('csvCopied'), 3000, global.Dialogs.MSG_INFO);
                } catch (e) {
                    this.log.warn('csv copy failed', e);
                }
            }

            _renderFooter() {
                const viewer = this.viewer();
                const mpp = NS.sampler?.imageMppPerPx?.(viewer);
                const name = viewer?.scalebar?.getReferencedTiledImage?.()?.source?.getMetadata?.()?.name
                    || APPLICATION_CONTEXT?.referencedName?.() || '';
                this.footer.textContent = this.t('slideInfo', {
                    name: name || fmt.EMPTY,
                    mpp: Number.isFinite(mpp) ? `${mpp.toFixed(3)} µm/px` : this.t('noCalibration'),
                });
            }
        };
        return WorkspaceClass;
    }

    UI_NS.createWorkspace = (options) => new (defineWorkspace())(options);
})(typeof window !== 'undefined' ? window : globalThis);
