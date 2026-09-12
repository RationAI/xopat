(function (global) {
    'use strict';

    /**
     * Per-annotation measurements popover, opened from the canvas right-click menu.
     *
     * Small on purpose, but it must answer three questions at a glance: what this
     * region measures, which of those numbers are exact geometry and which come
     * from pixel sampling that has (or has not yet) been run, and what the full
     * panel adds. So the rows are grouped, every metric carries a one-line tooltip,
     * the sampling group shows the settings its numbers were taken with, a failed
     * sample says why instead of leaving dashes, and the buttons explain
     * themselves on hover.
     *
     * The two computations (`measure`, `deriveTissue`) are public: the canvas menu
     * opens the popover and calls them, so progress, result and failure reason are
     * shown in one place whichever way the user started.
     *
     * It shares `ui/format.js` with the workspace, so the two surfaces cannot drift
     * apart, and hands off to the panel for anything comparative.
     */
    const NS = global.AnnotationMeasurements = global.AnnotationMeasurements || {};
    const UI_NS = NS.ui = NS.ui || {};

    let PopoverClass = null;

    function definePopover() {
        if (PopoverClass) return PopoverClass;
        const UI = global.UI;
        const { div, span, button } = global.van.tags;
        const fmt = UI_NS.format;
        const pick = UI_NS.picker;

        PopoverClass = class MeasurementsPopover {
            /**
             * @param {object} options
             * @param {XOpatModuleSingleton} options.module
             * @param {OSDAnnotations} options.annotations
             */
            constructor({ module, annotations }) {
                this.module = module;
                this.annotations = annotations;
                this.t = (k, v) => module.t(k, v);
                this.windowId = 'annotation-measurements-popover';
                this._window = null;
                this._object = null;
                /** @type {null|'measure'|'derive'} which action is running */
                this._busy = null;
                this._reason = null;
            }

            get engine() { return this.module.getEngine(); }

            showFor(annotation) {
                this._object = annotation;
                this._reason = null;
                if (!this._window) this._build();
                this._populate();
            }

            close() {
                this._window?.close();
            }

            // ── build ───────────────────────────────────────────────────────

            _build() {
                this.swatch = span({ class: 'w-2.5 h-2.5 rounded-full shrink-0 opacity-0' });
                this.title = span({ class: 'font-medium truncate' }, '');
                this.shape = span({ class: 'text-xs opacity-60 shrink-0' }, '');
                this.header = div({
                    class: 'flex items-center gap-1.5 min-w-0 cursor-pointer',
                    title: this.t('pickTooltip'),
                    onmouseenter: () => this._object && pick.hoverHighlight(this.annotations, this._object, true),
                    onmouseleave: () => this._object && pick.hoverHighlight(this.annotations, this._object, false),
                    onclick: () => this._object && pick.focusAnnotation(this.annotations, this._object),
                }, this.swatch, this.title, this.shape);

                this.geometryRows = div({ class: 'space-y-0.5' });
                this.pixelStatus = span({ class: 'text-xs opacity-60 truncate', title: this.t('sampledHint') }, '');
                this.pixelRows = div({ class: 'space-y-0.5' });
                this.reasonLine = div({ class: 'text-xs text-warning hidden' }, '');

                this.measureBtn = button({
                    type: 'button',
                    class: 'btn btn-xs btn-primary',
                    title: this.t('measureHint'),
                    onclick: () => this.measure(),
                }, this.t('measure'));
                this.tissueBtn = button({
                    type: 'button',
                    class: 'btn btn-xs btn-ghost px-1.5',
                    title: this.t('tissueRatioHint'),
                    onclick: () => this.deriveTissue(),
                }, span({ class: 'ph-light ph-circles-three' }), this.tissueLabel = span({ class: 'hidden' }, ''));
                this.panelBtn = button({
                    type: 'button',
                    class: 'btn btn-xs btn-ghost',
                    title: this.t('openPanelHint'),
                    // Hand off, don't duplicate: the panel shows everything this
                    // popover does and more. Capture the annotation first —
                    // `onClose` clears `_object`.
                    onclick: async () => {
                        const object = this._object;
                        await this.module.openWorkspace(object);
                        this.close();
                    },
                }, span({ class: 'ph-light ph-arrows-left-right' }), this.t('openPanelShort'));
                this.footer = span({ class: 'text-xs opacity-50 truncate ml-auto' }, '');

                const body = div(
                    // The window body already pads (`card-body p-2`); no second padding here.
                    { class: 'flex flex-col gap-1.5 text-sm min-w-0' },
                    this.header,
                    this._section(this.t('sectionGeometry'), this.t('geometryHint'), null),
                    this.geometryRows,
                    this._section(this.t('sectionPixels'), this.t('pixelsHint'), this.pixelStatus),
                    this.pixelRows,
                    this.reasonLine,
                    div({ class: 'flex items-center gap-1 pt-1 min-w-0' },
                        this.measureBtn, this.tissueBtn, this.panelBtn, this.footer),
                );
                this._window = new UI.FloatingWindow({
                    id: this.windowId,
                    title: this.t('popoverTitle'),
                    // Sized to the full content with a perimeter row; the body scrolls
                    // if a user has shrunk it. Both are remembered per user by the window.
                    width: 310,
                    height: 350,
                    closable: true,
                    onClose: () => { this._window = null; this._object = null; },
                }, body);
                USER_INTERFACE.addHtml(this._window, this.module.id);
            }

            /** A hairline group header: caption on the left, an optional status on the right. */
            _section(caption, hint, trailing) {
                return div(
                    { class: 'flex items-center justify-between gap-2 border-t border-base-300 pt-1 mt-0.5 min-w-0' },
                    span({ class: 'text-xs uppercase tracking-wide opacity-60 shrink-0', title: hint }, caption),
                    trailing,
                );
            }

            _row(r) {
                return div({ class: 'flex justify-between gap-3', title: r.help || '' },
                    span({ class: 'opacity-70' }, r.label),
                    span({ class: `font-mono${r.computed ? '' : ' opacity-40'}` }, r.value));
            }

            // ── render ──────────────────────────────────────────────────────

            _populate() {
                const object = this._object;
                if (!object || !this._window) return;

                this.title.textContent = fmt.annotationLabel(this.annotations, object, this.t);
                const color = fmt.presetColor(this.annotations, object.presetID);
                this.swatch.style.background = color || '';
                this.swatch.classList.toggle('opacity-0', !color);
                const factory = this.annotations.getAnnotationObjectFactory?.(object.factoryID);
                this.shape.textContent = factory?.title?.() || '';

                const viewer = fmt.viewerOf(this.annotations, object);
                const cfg = this.module.samplingConfig();
                const rows = fmt.statRows(this.engine, viewer, object, cfg, this.t);
                this.geometryRows.replaceChildren(...rows.filter((r) => r.group === 'geometry').map((r) => this._row(r)));
                this.pixelRows.replaceChildren(...rows.filter((r) => r.group === 'pixels').map((r) => this._row(r)));

                const sampled = fmt.samplingSummary(this.engine, object, cfg, this.t);
                this.pixelStatus.textContent = sampled || this.t('notSampled');
                this.pixelStatus.classList.toggle('text-warning', !sampled && !this._busy);

                const reason = this._reason ? fmt.reasonText(this.t, this._reason, 1) : '';
                this.reasonLine.textContent = reason;
                this.reasonLine.classList.toggle('hidden', !reason);

                const busy = !!this._busy;
                this.measureBtn.disabled = busy;
                this.measureBtn.textContent = this._busy === 'measure' ? this.t('measuring') : this.t('measure');
                // Shown only when tissue derivation can actually run.
                this.tissueBtn.classList.toggle('hidden', !this.module.pathology());
                this.tissueBtn.disabled = busy;
                this.tissueBtn.classList.toggle('btn-active', this._busy === 'derive');
                this.tissueLabel.textContent = this._busy === 'derive' ? this.t('deriving') : '';
                this.tissueLabel.classList.toggle('hidden', this._busy !== 'derive');

                const mpp = NS.sampler?.imageMppPerPx?.(viewer);
                this.footer.textContent = Number.isFinite(mpp)
                    ? this.t('resolutionNote', { mpp: mpp.toFixed(3) })
                    : this.t('noCalibration');
            }

            // ── actions ─────────────────────────────────────────────────────

            /** Sample the pixels of the shown annotation (intensity, % positive, objects). */
            async measure() {
                const object = this._object;
                if (!object || this._busy) return;
                this._busy = 'measure';
                this._reason = null;
                this._populate();
                try {
                    const res = await this.engine.computeForObject(fmt.viewerOf(this.annotations, object), object, {
                        ...this.module.samplingConfig(), includeComponents: true,
                    });
                    this._reason = res?.reason || null;
                } catch (err) {
                    this._reason = err?.message || String(err);
                    APPLICATION_CONTEXT.log(`module.${this.module.id}`).warn('popover compute failed', err);
                } finally {
                    this._busy = null;
                }
                this._populate();
            }

            /** Derive the tissue mask around the shown annotation and cache its tissue ratio. */
            async deriveTissue() {
                const object = this._object;
                if (!object || this._busy) return;
                this._busy = 'derive';
                this._reason = null;
                this._populate();
                try {
                    const res = await this.module.deriveTissueMask(fmt.viewerOf(this.annotations, object), { subject: object });
                    this._reason = res?.reason || null;
                } finally {
                    this._busy = null;
                }
                this._populate();
            }
        };
        return PopoverClass;
    }

    UI_NS.createPopover = (options) => new (definePopover())(options);
})(typeof window !== 'undefined' ? window : globalThis);
