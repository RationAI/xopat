(function (global) {
    'use strict';

    /**
     * Presentation helpers shared by the measurements workspace, the popover and
     * any future consumer. Pure functions only — no DOM, no globals beyond the
     * `AnnotationMeasurements` namespace — so they are unit-testable and cannot
     * drift between the two surfaces the way the hand-rolled row builders did.
     *
     * Every function that emits user-facing text takes an explicit `t` translator
     * rather than reaching for a module instance: the same helper then serves the
     * module (`this.t`), a test (a stub) and a plugin (its own namespace).
     */
    const NS = global.AnnotationMeasurements = global.AnnotationMeasurements || {};
    const UI_NS = NS.ui = NS.ui || {};

    /** Rendered wherever a metric has not been computed (or does not apply). */
    const EMPTY = '—';

    const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
    const num = (v, digits = 1) => (isNum(v) ? v.toFixed(digits) : EMPTY);
    const pct = (v) => (isNum(v) ? `${(v * 100).toFixed(1)}%` : EMPTY);

    /**
     * The viewer that actually owns `object`, so measurements resolve against the
     * right slide's scalebar under multi-viewport grids (AGENTS.md §6). Falls back
     * to the annotations' active viewer, which already applies the mode-lock guard.
     */
    function viewerOf(annotations, object) {
        const wrappers = global.OSDAnnotations?.FabricWrapper?.instances?.() || [];
        for (const w of wrappers) {
            const objs = w?.canvas?.getObjects?.() || [];
            if (objs.includes(object)) return w.viewer || w._viewer || null;
        }
        return annotations?.viewer || null;
    }

    /** All annotation objects of a viewer's fabric canvas (never raw canvas objects). */
    function annotationsIn(annotations, viewer) {
        const fabric = viewer ? annotations?.getFabric?.(viewer) : null;
        if (!fabric) return [];
        const objs = fabric.canvas?.getObjects?.() || [];
        return objs.filter((o) => fabric.isAnnotation?.(o));
    }

    function presetOf(annotations, presetID) {
        return presetID != null ? (annotations?.presets?.get?.(presetID) || null) : null;
    }

    /** Human name of a preset: its category meta, else the factory title, else its id. */
    function presetName(annotations, presetID, t) {
        const p = presetOf(annotations, presetID);
        const category = p?.getMetaValue?.('category');
        if (category) return category;
        const title = p?.objectFactory?.title?.();
        if (title) return title;
        if (presetID != null) return String(presetID);
        return t ? t('noPreset') : '';
    }

    /** Fill colour of the preset, for the swatch dot. Empty string when unknown. */
    function presetColor(annotations, presetID) {
        return presetOf(annotations, presetID)?.color || '';
    }

    function annotationLabel(annotations, object, t) {
        return `${presetName(annotations, object?.presetID, t)} #${object?.incrementId ?? '?'}`;
    }

    /**
     * The per-annotation readout: geometry first (free, always present), then the
     * pixel metrics, which stay `EMPTY` until someone explicitly sampled them.
     * `computed` lets the caller dim the rows that are still placeholders.
     *
     * @return {Array<{key: string, label: string, value: string, computed: boolean}>}
     */
    function statRows(engine, viewer, object, cfg, t) {
        if (!engine || !object) return [];
        const geo = engine.getGeometric(viewer, object) || {};
        const cached = engine.getCached(object, cfg || {}) || {};
        const comp = cached.components || {};

        // `group` says which rows are free geometry and which need pixel sampling;
        // `help` is the one-line explanation a surface shows as a tooltip, so the
        // reader can tell what a number IS without leaving the panel.
        const rows = [
            { key: 'area', group: 'geometry', label: t('metrics.area'), help: t('metricHelp.area'), value: geo.areaLabel || EMPTY, computed: !!geo.areaLabel },
        ];
        if (geo.lengthLabel) {
            rows.push({ key: 'length', group: 'geometry', label: t('metrics.perimeter'), help: t('metricHelp.perimeter'), value: geo.lengthLabel, computed: true });
        }
        rows.push(
            { key: 'mean', group: 'pixels', label: t('metrics.mean'), help: t('metricHelp.mean'), value: num(cached.mean, 1), computed: isNum(cached.mean) },
            { key: 'percentPositive', group: 'pixels', label: t('metrics.percentPositive'), help: t('metricHelp.percentPositive'), value: pct(cached.percentPositive), computed: isNum(cached.percentPositive) },
            { key: 'components', group: 'pixels', label: t('metrics.components'), help: t('metricHelp.components'), value: comp.count != null ? String(comp.count) : EMPTY, computed: comp.count != null },
            { key: 'density', group: 'pixels', label: t('metrics.density'), help: t('metricHelp.density'), value: isNum(comp.densityPerMm2) ? `${comp.densityPerMm2.toFixed(1)} /mm²` : EMPTY, computed: isNum(comp.densityPerMm2) },
        );
        return rows;
    }

    /**
     * One line saying what the cached pixel metrics were sampled from — source
     * layer, channel, threshold and whether that threshold was Otsu-derived.
     * Empty string when nothing has been sampled for this object under `cfg`.
     */
    function samplingSummary(engine, object, cfg, t) {
        const cached = engine?.getCached?.(object, cfg || {});
        if (!cached || (!isNum(cached.mean) && cached.components?.count == null)) return '';
        const source = t(`channelSource.${cached.source || cfg?.source || 'rendered'}`);
        const channel = t(`channels.${cached.channel || cfg?.channel || 'V'}`);
        if (!isNum(cached.threshold)) return t('sampledWithNoThreshold', { source, channel });
        return t(cached.thresholdAuto ? 'sampledWithAuto' : 'sampledWith', {
            source, channel, threshold: Math.round(cached.threshold),
        });
    }

    /**
     * Human text for an engine failure reason (`not-fully-loaded`, `no-gl`, …).
     * Reasons are kebab-case; the locale keys are camelCase under `reason.*`, and
     * an unknown reason falls through to the generic line rather than a raw key.
     */
    function reasonText(t, reason, count = 1) {
        if (!reason) return '';
        const key = `reason.${String(reason).replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`;
        const text = t(key, { count, reason });
        return text === key ? t('reason.generic', { count, reason }) : text;
    }

    /**
     * Totals for a multi-selection. Areas are summed in slide px² and formatted
     * once through the viewer's converter, so a set that spans calibrated and
     * uncalibrated states never mixes units in the label.
     */
    function aggregateStats(engine, viewer, objects) {
        const list = (objects || []).filter(Boolean);
        if (!engine || !list.length) return { count: 0, totalAreaLabel: EMPTY, meanAreaLabel: EMPTY };

        let totalPx = 0;
        let counted = 0;
        for (const o of list) {
            const areaPx = engine.getGeometric(viewer, o)?.areaImagePx;
            if (isNum(areaPx)) { totalPx += areaPx; counted++; }
        }
        const conv = NS.geometry?.unitConverter?.(viewer);
        const format = (px) => (conv && isNum(px) ? conv.formatArea(px) : EMPTY);
        return {
            count: list.length,
            totalAreaPx: totalPx,
            totalAreaLabel: counted ? format(totalPx) : EMPTY,
            meanAreaLabel: counted ? format(totalPx / counted) : EMPTY,
        };
    }

    /** Columns of the batch table, in render and CSV order. */
    const TABLE_COLUMNS = ['label', 'area', 'mean', 'percentPositive', 'components', 'density'];

    /**
     * Area labels for a set of annotations, all on ONE unit.
     *
     * Formatting each area on its own picks a prefix per value, so a column could
     * hold "7 138.95 kpx²" next to "919 076.44 px²" — a factor of a thousand with
     * nothing on screen to say so. Whenever areas are shown side by side, they come
     * through here.
     *
     * @return {string[]} aligned with `objects`
     */
    function areaLabelsFor(engine, viewer, objects) {
        const list = objects || [];
        const conv = NS.geometry?.unitConverter?.(viewer);
        const areas = list.map((o) => engine.getGeometric(viewer, o)?.areaImagePx);
        if (!conv?.formatAreaSeries) return areas.map((a) => (isNum(a) ? String(Math.round(a)) : EMPTY));
        const labels = conv.formatAreaSeries(areas.map((a) => (isNum(a) ? a : 0)));
        return areas.map((a, i) => (isNum(a) ? labels[i] : EMPTY));
    }

    /**
     * One flat, already-formatted table row — the same shape the CSV writer takes.
     * `areaLabel` overrides the per-value formatting when the caller is rendering a
     * series (see {@link areaLabelsFor}).
     */
    function tableRow(engine, viewer, object, cfg, annotations, t, areaLabel) {
        const geo = engine.getGeometric(viewer, object) || {};
        const cached = engine.getCached(object, cfg || {}) || {};
        const comp = cached.components || {};
        return {
            label: annotationLabel(annotations, object, t),
            area: areaLabel || geo.areaLabel || EMPTY,
            mean: num(cached.mean, 1),
            percentPositive: pct(cached.percentPositive),
            components: comp.count != null ? String(comp.count) : EMPTY,
            density: num(comp.densityPerMm2, 1),
        };
    }

    /** RFC-4180 quoting for every cell, so labels containing `,` or `"` survive. */
    function rowsToCsv(rows, t, columns = TABLE_COLUMNS) {
        const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const header = columns.map((c) => quote(t(`col.${c}`))).join(',');
        const lines = (rows || []).map((r) => columns.map((c) => quote(r[c])).join(','));
        return [header, ...lines].join('\n');
    }

    UI_NS.format = {
        EMPTY,
        TABLE_COLUMNS,
        num,
        pct,
        viewerOf,
        annotationsIn,
        presetName,
        presetColor,
        annotationLabel,
        statRows,
        samplingSummary,
        reasonText,
        aggregateStats,
        areaLabelsFor,
        tableRow,
        rowsToCsv,
    };
})(typeof window !== 'undefined' ? window : globalThis);
