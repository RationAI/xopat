ScriptingManager.registerExternalApi(
    /**
     * @implements MeasurementsScriptApi
     */
    async manager => manager.ingestApi(new class XOpatMeasurementsScriptApi extends ScriptingManager.XOpatScriptingApi {

        static ScriptApiMetadata = {
            dtypesSource: {
                kind: "url",
                value: APPLICATION_CONTEXT.url + "modules/annotation-measurements/scripting/measurements.d.ts"
            }
        };

        constructor(namespace) {
            super(
                namespace,
                "Annotation Measurements",
                "Quantify annotated regions on the viewer bound to this script context: physical-unit area, intensity statistics, connected-component density, area ratios (including against an auto-derived tissue mask), preset composition, and nearest-neighbour distance. Deterministic and viewport-independent. Select the viewer first with application.setActiveViewer(contextId)."
            );
        }

        _module() {
            const m = (typeof singletonModule === "function") ? singletonModule("annotation-measurements") : null;
            const engine = m?.getEngine?.();
            if (!engine) throw new Error("The annotation-measurements module is not available.");
            return engine;
        }

        _annotations() {
            const m = OSDAnnotations.instance();
            if (!m) throw new Error("The annotations module is not available.");
            return m;
        }

        _fabric() {
            return this._annotations().getFabric(this.activeViewer);
        }

        _list() {
            const f = this._fabric();
            return (f.canvas?.getObjects?.() || []).filter((o) => f.isAnnotation?.(o));
        }

        _find(ref) {
            const f = this._fabric();
            if (typeof ref === "number" && Number.isFinite(ref)) {
                return f.findObjectOnCanvasByIncrementId?.(ref)
                    || this._list().find((o) => Number(o.incrementId) === ref) || null;
            }
            const needle = String(ref);
            return this._list().find((o) => String(o.incrementId ?? "") === needle || String(o.id ?? "") === needle) || null;
        }

        _requireAnnotation(ref) {
            const o = this._find(ref);
            if (!o) throw new Error(`No annotation matches "${ref}".`);
            return o;
        }

        _pathology() {
            return (typeof singletonModule === "function") ? singletonModule("pathology-foundation") : null;
        }

        async measure(annotationRef, options = {}) {
            const engine = this._module();
            const viewer = this.activeViewer;
            const object = this._requireAnnotation(annotationRef);
            const res = await engine.computeForObject(viewer, object, {
                includeComponents: true,
                source: options.source || "rendered",
                channel: options.channel || "V",
                threshold: options.threshold ?? "auto",
            });
            const geo = engine.getGeometric(viewer, object);
            const cached = engine.getCached(object, { source: options.source || "rendered", channel: options.channel || "V" }) || {};
            const comp = cached.components || {};
            return {
                annotationId: Number(object.incrementId),
                areaUm2: geo.areaUm2,
                areaMm2: geo.areaMm2,
                lengthUm: geo.lengthUm,
                mean: cached.mean,
                median: cached.median,
                percentPositive: cached.percentPositive,
                threshold: cached.threshold,
                componentCount: comp.count,
                densityPerMm2: comp.densityPerMm2,
                meanComponentAreaUm2: comp.meanAreaUm2,
                skipped: res.reason || null,
            };
        }

        areaRatio(numeratorRef, denominatorRef) {
            const engine = this._module();
            const num = this._requireAnnotation(numeratorRef);
            const den = this._requireAnnotation(denominatorRef);
            const r = engine.areaRatio(this.activeViewer, num, den);
            return { ratio: r.ratio, numeratorAreaPx: r.numeratorAreaPx, denominatorAreaPx: r.denominatorAreaPx };
        }

        async tissueRatio(annotationRef, options = {}) {
            const engine = this._module();
            const viewer = this.activeViewer;
            const object = this._requireAnnotation(annotationRef);
            const pathology = this._pathology();
            if (!pathology) throw new Error("Tissue derivation needs the pathology-foundation module, which is not loaded.");

            const before = new Set(this._list().map((o) => o.incrementId));
            await pathology.annotateTissue(viewer, { driver: options.driver });
            const tissue = this._list().filter((o) => !before.has(o.incrementId));
            const r = engine.areaRatioAgainstSet(viewer, object, tissue);
            return { ratio: r.ratio, annotationAreaPx: r.numeratorAreaPx, tissueAreaPx: r.denominatorAreaPx, tissueRegions: tissue.length };
        }

        composition(parentRef) {
            const engine = this._module();
            const parent = this._requireAnnotation(parentRef);
            const res = engine.composition(this.activeViewer, parent, this._list(), (pid) => {
                const p = this._annotations().presets?.get?.(pid);
                return p?.getMetaValue?.("category") || p?.objectFactory?.title?.() || String(pid);
            });
            if (!res) return null;
            return {
                parentAreaUm2: res.parentAreaUm2,
                classes: res.rows.map((r) => ({ preset: r.label, areaUm2: r.areaUm2, fractionOfParent: r.fractionOfParent, count: r.count })),
            };
        }

        async density(annotationRef, options = {}) {
            const engine = this._module();
            const object = this._requireAnnotation(annotationRef);
            const comp = await engine.computeComponents(this.activeViewer, object, {
                source: options.source || "rendered",
                channel: options.channel || "V",
                threshold: options.threshold ?? "auto",
            });
            if (comp.reason) return { skipped: comp.reason };
            return { count: comp.count, densityPerMm2: comp.densityPerMm2, regionMm2: comp.regionMm2, threshold: comp.threshold };
        }
    }("measurements")),
    { label: "measurements" }
);
