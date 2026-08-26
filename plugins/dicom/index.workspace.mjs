import { DICOMWebTileSource } from "./tile-source.mjs";
import { DICOMDerivedTileSource } from "./derived-tile-source.mjs";
import { RadiologySeriesTileSource } from "./radiology-tile-source.mjs";
import DicomTools from "./dicom-query.mjs";
import { registerDicomShaderLayers } from "./shaders/index.mjs";

/**
 * Query lane for the browsing UI — patient/study/series listings, thumbnails,
 * the shallow WSI sweep.
 *
 * These are what the user browses BETWEEN slides, and they used to run at full
 * priority against the same origin as the tiles. In a measured session the
 * explorer's queries were still going out 80 s into a slide open, each taking
 * 1-4 s, on the one connection the tiles needed.
 *
 * `APPLICATION_CONTEXT.requestScheduler` admits zero background requests while
 * any viewer has tiles in flight (with a 1.5 s starvation escape so a listing
 * never freezes), and 2 at a time when idle. This is a connection-pool hint
 * only — it changes when a request goes out, never whether it is allowed.
 *
 * Deliberately NOT applied to the pyramid scan or per-level metadata: those ARE
 * the slide open, and backgrounding them would deadlock the thing they feed.
 */
const BROWSER_LANE = { priority: "background" };

/*
  DICOM plugin — DICOMweb as a PROTOCOL, and nothing more.

  This plugin decides nothing about what the viewer shows. It registers the
  "dicom" slide protocol, the DICOM shader layers and the DICOM SR annotation
  sink, exposes a read-only DICOMweb query API, and then waits to be told what
  to do. Every expansion it can perform — opening a whole study, attaching
  derived SEG / Parametric Map overlays — happens ONLY because a session's
  `dataID` explicitly asked for it.

  The browsing UI (patient -> study -> series explorer, the slide-info
  integration, boot-time seeding from a configured study) lives in the separate
  `dicom-browser` plugin. A deployment that loads only this plugin gets a viewer
  that is a pure standalone rendering surface for externally-supplied
  configuration; one that also loads `dicom-browser` gets an application. The
  presence of that plugin is the switch — there is no autonomy flag.

  What a session declares, in a background's `dataReference`:

    { dataID: { studyUID, seriesUID },                     protocol: "dicom" }
    { dataID: { studyUID, seriesUID, role: "radiology" },  protocol: "dicom" }
    { dataID: { studyUID, expand: "case" },                protocol: "dicom" }
    { dataID: { studyUID, seriesUID, derived: "auto" },    protocol: "dicom" }
    { dataID: { studyUID, seriesUID, derived: ["<uid>"] }, protocol: "dicom" }

  Options (deployment-controlled, `getStaticMeta`):
  - serviceUrl (string, required)
  - httpClient (object, optional) — proxy alias + auth context
  Options (session preferences, `getOption`):
  - useRendered, preferBaselineJpeg, frameOrder* — how to fetch/decode tiles.

  Notes:
  - QIDO-RS endpoints are used: /studies, /studies/{StudyUID}/series, /studies/{StudyUID}/series/{SeriesUID}/instances.
  - We minimize returned attributes via `includefield`.
  - We are defensive around servers that might not implement /patients; we derive patients from /studies if needed.
*/

addPlugin('dicom', class extends XOpatPlugin {
    constructor(id) {
        super(id);

        // Kick the locale fetch off immediately — constructors cannot await,
        // and the slide-browser integration reads from this namespace.
        this._localeReady = this.loadLocale().catch(() =>
            this.loadLocale('en').catch(e => console.warn("dicom: failed to load locale", e)));

        this.serviceUrl     = this.getStaticMeta('serviceUrl');
        this.useRendered    = this.getOption('useRendered', false);
        // Ask the server for baseline JPEG ahead of J2K. Baseline is the only
        // codec the browser decodes natively (off-thread, no pixel readback), so
        // this trades a server-side transcode for a much cheaper client. Off by
        // default: J2K 4.90 is lossless and transcoding is not.
        this.preferBaselineJpeg = this.getOption('preferBaselineJpeg', false);
        this.frameOrder = {
            frameOrderByInstance: this.getOption("frameOrderByInstance", null),
            frameOrderBySeries: this.getOption("frameOrderBySeries", null),
            frameOrder: this.getOption("frameOrder", null),
        };

        // Query-result cache, NOT UI state. Selection (which patient/study the
        // user is looking at) belongs to whatever is driving the plugin — the
        // `dicom-browser` plugin keeps its own. What lives here is metadata the
        // protocol itself needs: `activePatientDetails` is handed to every
        // TileSource it constructs, because that is what backs
        // `getSensitiveMetadata()` and the slide-info "Clinical information"
        // card.
        this.state = {
            seriesByStudy: new Map(),    // studyUID -> [{ seriesUID, modality, bodyPart, number, desc, instanceCount }]
            activeStudy: null,           // study whose details are currently cached
            activePatientDetails: null,  // normalized patient metadata
            activeStudyDetails: null     // normalized study metadata
        };

        // Register the DICOM SR annotations sink up-front, before
        // `integrateWithSingletonModule('annotations', …)` causes the
        // annotations module's constructor to run. The annotations module
        // resolves IO bindings synchronously at the head of its own
        // `_initIOPipeline`; if the sink registers later (e.g. inside the
        // integration callback) the binding warns "unknown sink … dropping"
        // and import/export stay inert. The sink methods resolve the
        // annotations module lazily, so they work even though the module
        // does not exist yet at registration time.
        this._registerDicomSrSink();

        // Register the "dicom" slide protocol so DICOMweb-backed slides can
        // be opened by the viewer without a brittle pre-built TileSource on
        // the BackgroundItem. _makeDataOverride emits a serializable
        // `{ dataID: { studyUID, seriesUID }, protocol: "dicom" }` spec
        // which survives URL/POST roundtripping.
        this._registerSlideProtocol();

        // Register the SEG / Parametric Map shader layers up-front, not lazily
        // from the overlay-discovery path: a restored session may already carry
        // `dicom-seg` shader configs, and assemble-render-output drops shaders
        // whose type the registry does not know. Registration is idempotent and
        // degrades with a warning when the WebGL renderer is unavailable.
        // `this.t` carries the plugin's locale namespace — the shader modules
        // have no plugin instance and must not guess at it.
        registerDicomShaderLayers((key, options) => this.t(key, options));

        // Act on what a session's `dataID` asked for — case expansion, derived
        // overlays, radiology shader params. Never on its own initiative.
        this._registerSessionDrivenExpansion();

        this.STUDY_PROJECTION =
            '0020000D,' + // StudyInstanceUID
            '00080020,' + // StudyDate
            '00080030,' + // StudyTime
            '00081030,' + // StudyDescription
            '00100020,' + // PatientID
            // The remaining three patient attributes are what `parsePatient`
            // reads. They are QIDO study-level return attributes, so most
            // stores send them unasked — but `_listPatientsDerived` builds its
            // whole patient list out of study rows, and on a store that omits
            // them every derived patient rendered as a bare ID. Asking costs
            // nothing and removes the per-patient `/studies?PatientID=` probe
            // `materializePatientsFromStudies` used to need.
            '00100010,' + // PatientName
            '00100030,' + // PatientBirthDate
            '00100040,' + // PatientSex
            '00200010,' + // StudyID
            '00080050,' + // AccessionNumber
            '00080061,' + // ModalitiesInStudy
            '00201206,' + // NumberOfStudyRelatedSeries
            '00201208,' + // NumberOfStudyRelatedInstances
            '00080080,' + // InstitutionName
            '00081010,' + // StationName
            '00080090,' + // ReferringPhysicianName
            '00081050,' + // PerformingPhysicianName
            '00180015,' + // BodyPartExamined
            '00321060,' + // RequestedProcedureDescription
            '00401012,' + // ReasonForPerformedProcedure
            '00324000';   // StudyComments


        this.integrateWithSingletonModule('annotations', async (module) => {
            // The DICOM SR sink was registered up-front in the constructor (so
            // the annotations module's initIO sees the binding when it
            // resolves them). All we need here is the convertor — its
            // `OSDAnnotations.Convertor.register("dicom", …)` call must run
            // before the sink invokes `encodePartial` / `encodeFinalize` /
            // `decode`. Gating it on annotations being ready keeps the
            // dependency direction sane (DICOM uses annotations' convertor
            // registry, not the other way round).
            await import('./annotation-convertor.mjs');

            // Baseline the SR content hash right after slide hydration: the
            // sink's writeBundle re-encodes the live state on every
            // slide-leave flush, and only a hash mismatch stows. Encoding the
            // just-hydrated state through the same path makes "opened, looked,
            // left" hash-equal — zero redundant SR instances for read-only
            // visits. Detect hydration (vs user file import) by the options
            // importBundle stamps: format 'dicom' + history disabled.
            module.addHandler('import', async (e) => {
                const opts = e?.options || {};
                if (opts.format !== 'dicom' || opts.history !== false) return;
                const fabric = e.owner;
                const slide = this._resolveDicomSlide(fabric?.viewer);
                if (!slide?.meta?.seriesUID || !slide.meta.micronsX) return;
                try {
                    const conversion = await OSDAnnotations.Convertor.encodePartial(
                        { format: 'dicom', serialize: false, meta: slide.meta }, fabric);
                    this._srStateFor(slide.meta.seriesUID).hash = this._hashConversion(conversion);
                } catch (err) {
                    // Baseline is an optimization only — worst case is one
                    // redundant (content-identical) stow on first leave.
                    console.debug("[dicom] SR baseline hash skipped:", err);
                }
            });
        });
    }

    /**
     * Build a DataOverride for a DICOM series. References the "dicom"
     * protocol registered via SLIDE_PROTOCOLS — the registry's resolver
     * receives `dataID = { studyUID, seriesUID }` and constructs the
     * DICOMWebTileSource on demand. Result is JSON-serializable, unlike
     * the pre-built TileSource bypass it replaces.
     */
    _makeDataOverride(studyUID, seriesUID, role = "wsi", extra = null) {
        return {
            dataID: { studyUID, seriesUID, role, ...(extra || null) },
            protocol: "dicom",
        };
    }

    /* ---------------------------------------------------------------- */
    /* Public read API                                                   */
    /*                                                                   */
    /* Everything below is reachable as `plugin('dicom').<method>` and is */
    /* how the `dicom-browser` plugin — or anything else — drives this    */
    /* one. All of it is READ-ONLY: nothing here opens a slide, mutates   */
    /* `APPLICATION_CONTEXT.config`, or touches the viewer. There are no  */
    /* cross-plugin ES imports (AGENTS.md §0.5), so this API is the only  */
    /* seam, which is exactly why it is worth keeping narrow.             */
    /* ---------------------------------------------------------------- */

    /** @see _makeDataOverride — the public name. */
    makeDataReference(studyUID, seriesUID, role = "wsi", extra = null) {
        return this._makeDataOverride(studyUID, seriesUID, role, extra);
    }

    /** @see _dicomIdentityOf — the public name. */
    identityOf(background) { return this._dicomIdentityOf(background); }

    /** @see _searchToStudyFilters — the public name. */
    searchToStudyFilters(query) { return this._searchToStudyFilters(query); }

    /** Whether this store implements QIDO `/patients`. Memoized. */
    supportsPatients() { return this._supportsPatients(); }

    /** @see _shallowWsiItemsForStudy — the public name. */
    shallowWsiItemsForStudy(studyUID, search = "") {
        return this._shallowWsiItemsForStudy(studyUID, search);
    }

    /**
     * One patient by ID, for restoring a browser's location after a reload
     * without paging the whole listing. Degrades to a bare `{patientID}` rather
     * than failing: everything downstream needs only the ID.
     */
    async lookupPatientById(patientID) {
        if (!patientID) return null;
        try {
            const params = new URLSearchParams({ limit: "1", offset: "0", PatientID: patientID });
            const { rows } = await DicomTools.qidoSafeWithMeta(this._client, `/studies?${params}`, this.STUDY_PROJECTION, BROWSER_LANE);
            if (rows?.[0]) return this.parsePatient(rows[0]);
        } catch (e) {
            console.debug("[dicom] patient lookup failed", e);
        }
        return { patientID };
    }

    /**
     * A series' OVERVIEW/LABEL instance rendered as an image Blob, for listing
     * thumbnails. Null when the store holds no such instance — the caller keeps
     * its placeholder.
     */
    async fetchSeriesPreview({ studyUID, seriesUID, previewInstanceUID } = {}) {
        if (!previewInstanceUID || !studyUID || !seriesUID) return null;
        try {
            return await DicomTools.fetchRenderedInstance(this._client, studyUID, seriesUID, previewInstanceUID);
        } catch (e) {
            console.debug("[dicom] item preview unavailable:", e?.message ?? e);
            return null;
        }
    }

    /**
     * SEG / Parametric Map series attributable to a slide. Costs one study-wide
     * discovery probe, memoized per study.
     */
    async describeDerived(studyUID, seriesUID) {
        const index = await this._derivedIndexFor(studyUID);
        return DicomTools.derivedSeriesForSlide(index, seriesUID);
    }

    /** Ordered plane model + display chain of a CT/MR/PT/CR/DX/NM series. */
    describeRadiologySeries(studyUID, seriesUID, options = {}) {
        return DicomTools.describeRadiologySeries(this._client, studyUID, seriesUID, options);
    }

    /**
     * Ensure patient/study details for `studyUID` are cached, so the TileSources
     * constructed for it can carry them into `getSensitiveMetadata()`.
     * Idempotent and best-effort — a missing detail costs a card, not a slide.
     */
    async ensureStudyContext(studyUID) {
        if (!studyUID || this.state.activeStudy === studyUID) return;
        try {
            await this.populateStudyDetails(studyUID);
            this.state.activeStudy = studyUID;
        } catch (e) {
            console.debug("[dicom] study context unavailable:", e?.message ?? e);
        }
    }

    /** Normalized patient metadata for the study most recently in context. */
    getPatientDetails() { return this.state.activePatientDetails; }

    /** Normalized study metadata for the study most recently in context. */
    getStudyDetails() { return this.state.activeStudyDetails; }

    /**
     * Resolve a background's DICOM identity (`{studyUID, seriesUID, role}`),
     * whatever shape the entry is in.
     *
     * `dataReference` is index-or-value: a raw `BackgroundItem` straight out of
     * `before-app-init` still carries the inline DataOverride, while anything
     * that has been through the open pipeline is a `BackgroundConfig` exposing
     * the numeric index into `config.data`. `BackgroundConfig.data()` normalizes
     * both (index lookup + `dataID` unwrap); the inline fallback keeps this
     * working if the global is not yet installed.
     *
     * @returns {?{studyUID:string, seriesUID:string, role?:string}}
     */
    _dicomIdentityOf(background) {
        if (!background) return null;

        const resolved = globalThis.BackgroundConfig?.data?.(background);
        if (resolved && typeof resolved === "object") return resolved;

        const ref = background.dataReference;
        const spec = typeof ref === "number" ? APPLICATION_CONTEXT.config?.data?.[ref] : ref;
        if (!spec || typeof spec !== "object") return null;
        return spec.dataID ?? spec;
    }

    /**
     * Study-scoped index of SEG / Parametric Map series, memoized.
     *
     * Building it costs one series listing plus two requests per derived
     * candidate — ~25 requests in a study with a dozen segmentations. Every
     * slide in that study shares the result, so this must never be rebuilt per
     * opened slide. Failures are memoized too: a store that cannot answer the
     * probe should not be asked again on every slide switch.
     */
    async _derivedIndexFor(studyUID) {
        this._derivedIndexCache = this._derivedIndexCache || new Map();
        if (this._derivedIndexCache.has(studyUID)) return this._derivedIndexCache.get(studyUID);

        const pending = DicomTools.getStudyDerivedIndex(this._client, studyUID)
            .catch(e => {
                console.warn(`[dicom] derived-object discovery failed for study ${studyUID}:`, e?.message ?? e);
                return { derived: [], smSeriesCount: 0 };
            });
        this._derivedIndexCache.set(studyUID, pending);
        return pending;
    }

    /**
     * Marker stamped on generated visualizations so a re-open reuses the entry
     * instead of appending a duplicate. It also survives a session export, which
     * means a re-imported session will not grow a second copy.
     */
    static OVERLAY_MARKER = "__dicomOverlaysFor";

    /**
     * Marks a shader layer whose `params` this plugin filled in from the server
     * rather than the session author. Everything under it is re-derivable, so a
     * session export can drop it and keep the bundle small — and a re-open picks
     * up whatever the store says today.
     */
    static AUTO_PARAMS_MARKER = "__dicomAuto";

    /**
     * Build the visualization that renders a slide's derived objects, appending
     * their data entries to the live config.
     *
     * Each derived series becomes one entry in `config.data` plus one shader in
     * a visualization dedicated to this background. The open pipeline
     * (assemble-render-output.ts) resolves `dataReferences` to OSD world indices
     * and opens the extra tiled images, so nothing else has to change.
     *
     * Only the first overlay is visible. A slide commonly carries several
     * renderings of the same thing (a BINARY and a FRACTIONAL map of one
     * segmentation), and painting them simultaneously just double-covers the
     * tissue; the rest are listed in the shader panel one click away.
     *
     * @param {?string[]} [only] explicit series UIDs from the session. When
     *   given, discovery is skipped entirely — naming the objects costs nothing,
     *   whereas `"auto"` pays for a study-wide probe.
     * @returns {Promise<?object>} the visualization, or null when there is nothing to show
     */
    async _buildOverlayVisualization(studyUID, seriesUID, slideName = "", only = null) {
        const index = await this._derivedIndexFor(studyUID);
        let derived = DicomTools.derivedSeriesForSlide(index, seriesUID);

        if (Array.isArray(only)) {
            const wanted = new Set(only);
            const found = derived.filter(d => wanted.has(d.seriesUID));
            for (const uid of wanted) {
                if (!found.some(d => d.seriesUID === uid)) {
                    // Say which one, rather than silently rendering fewer
                    // overlays than the session declared.
                    console.warn(`[dicom] requested derived series ${uid} is not attributable to ${seriesUID}`);
                }
            }
            derived = found;
        }

        if (!derived.length) return null;

        const config = APPLICATION_CONTEXT.config;
        if (!Array.isArray(config.data)) config.data = [];

        const shaders = {};
        derived.forEach((d, order) => {
            const dataIndex = config.data.push(
                this._makeDataOverride(studyUID, d.seriesUID, d.kind, { sourceSeriesUID: seriesUID })
            ) - 1;

            // An object carrying its own Palette Color LUT arrives display-ready
            // (the tile source bakes the whole DICOM chain), so it needs a
            // passthrough shader — the parametric one would try to colour-map an
            // already-coloured tile.
            const type = d.kind === "seg" ? "dicom-seg"
                : (d.hasPalette ? "identity" : "dicom-parametric");

            shaders[`dicom-${d.kind}-${d.seriesUID}`] = {
                type,
                name: d.label || this.t(d.kind === "seg" ? 'overlay.segmentation' : 'overlay.parametricMap'),
                dataReferences: [dataIndex],
                visible: order === 0 ? 1 : 0,
                // A parametric map is quantitative: windowing it means nothing once the
                // first pass has quantized the samples to 8 bits and clamped them to [0,1].
                // The renderer's data-driven negotiation would reach the same conclusion
                // from the RGBA16F packs, but stating it here also covers the case where
                // the tiles have not arrived yet. Honoured while the renderer option
                // `precision` is "auto"; see APPLICATION_CONTEXT option `webGlPrecision`.
                ...(type === "dicom-parametric" ? { precision: "float16" } : {}),
                params: {
                    // Segment colours/labels come from the DICOM object, so
                    // the overlay looks the way its author intended before
                    // the user touches a single control.
                    segments: d.segments || [],
                    units: d.units || null,
                    // Parametric maps ship normalized samples plus the range
                    // needed to read them back in real-world units, and the
                    // object's own window as the initial view.
                    valueRange: d.valueRange || null,
                    voiPresets: d.voiPresets || [],
                },
            };
        });

        return {
            name: this.t('overlay.visualizationName', { slide: slideName }).trim(),
            [this.constructor.OVERLAY_MARKER]: seriesUID,
            shaders,
        };
    }

    /**
     * Do what the session asked for, and nothing else.
     *
     * One `before-open` handler covers the three things a `dataID` can request:
     *
     * - `expand: "case"` — materialize every renderable series of the study as
     *   sibling backgrounds (see {@link expandCase}).
     * - `derived: "auto" | ["<seriesUID>", …]` — attach SEG / Parametric Map
     *   overlays to this slide.
     * - `role: "radiology"` — fill in the `dicom-window` shader's params from
     *   the series' own display chain, so a session can declare the layer
     *   without hand-authoring Hounsfield ranges.
     *
     * A background that asks for none of them gets none of them. This is the
     * whole difference between this plugin and its predecessor, which probed
     * every study for derived objects on every open.
     *
     * `before-open` is the right hook because it is common to boot and to every
     * runtime slide switch, and because the pipeline reads back
     * `event.visualizationIndex` / `event.visualization` / `event.background`
     * and the live `config.visualizations` / `config.data` arrays afterwards —
     * so appending here is picked up for this very open.
     */
    _registerSessionDrivenExpansion() {
        VIEWER_MANAGER.addHandler('before-open', async (event) => {
            try {
                const id = this._dicomIdentityOf(event?.background);
                if (!id?.studyUID) return;

                // Patient/study details back `getSensitiveMetadata()` and the
                // slide-info "Clinical information" card. Deliberately NOT
                // awaited: `before-open` is awaited by the open pipeline
                // (viewer-open-pipeline.ts), so anything awaited here delays
                // the tile source's very construction — and this is a UI card,
                // not a precondition for rendering. The tile sources read the
                // details through a live accessor (see `createTileSource`), so
                // a late arrival still lands.
                this.ensureStudyContext(id.studyUID);

                if (id.expand === "case") await this._expandCaseForEvent(event, id);
                if (id.role === "radiology") await this._fillRadiologyShaderParams(event, id);
                await this._attachRequestedOverlays(event, id);
            } catch (e) {
                // These are features; a slide that fails to open is a broken
                // viewer. Never let this throw take the slide with it.
                console.warn("[dicom] session-driven expansion failed:", e?.message ?? e);
            }
        });
    }

    /**
     * `dataID.expand === "case"`: open every renderable series of the study.
     *
     * Applied through the additive open idiom (`dataMode`/`backgroundMode`
     * `"merge"`), so `config.background` — the catalog of available slides —
     * grows while `params.activeBackgroundIndex` decides what is on screen.
     * Deferred out of the handler with `queueMicrotask` + a re-entrancy guard:
     * `openViewerWith` runs the very pipeline whose `before-open` we are inside.
     */
    async _expandCaseForEvent(event, id) {
        if (this._expandingCase) return;
        const key = `${id.studyUID}::${id.seriesUID ?? ""}`;
        this._expandedCases = this._expandedCases || new Set();
        if (this._expandedCases.has(key)) return;
        this._expandedCases.add(key);

        const built = await this.buildCaseSession(id.studyUID, { exclude: id.seriesUID });
        if (!built.background.length) {
            console.info(`[dicom] study ${id.studyUID} holds no additional renderable series`);
            return;
        }

        console.info(`[dicom] expanding study ${id.studyUID} into ${built.background.length} additional background(s)`);
        queueMicrotask(async () => {
            this._expandingCase = true;
            try {
                await APPLICATION_CONTEXT.openViewerWith(
                    built.data, built.background, undefined, undefined, undefined,
                    { dataMode: "merge", backgroundMode: "merge" });
            } catch (e) {
                console.warn("[dicom] case expansion could not be applied:", e?.message ?? e);
            } finally {
                this._expandingCase = false;
            }
        });
    }

    /**
     * Fill a declared `dicom-window` layer's params from the series itself.
     *
     * The alternative is making every session author a Hounsfield range and a
     * preset list by hand, which is both tedious and a place to be silently
     * wrong. Author-supplied params always win, and the array is REPLACED rather
     * than mutated so the objects the author wrote are never aliased.
     *
     * Auto-filled entries are stamped so a session export can drop them: they
     * are derivable from the server and would only bloat the bundle.
     */
    async _fillRadiologyShaderParams(event, id) {
        const background = event?.background;
        const shaders = background?.shaders;
        if (!Array.isArray(shaders) || !shaders.some(s => s?.type === "dicom-window")) return;
        if (!id.seriesUID) return;

        const d = await DicomTools.describeRadiologySeries(this._client, id.studyUID, id.seriesUID,
            { subVolume: id.subVolume });
        if (!d || d.error) {
            console.warn(`[dicom] cannot describe radiology series ${id.seriesUID}: ${d?.error ?? "not radiology"}`);
            return;
        }

        const auto = {
            valueRange: d.valueRange,
            voiPresets: d.voiPresets,
            units: d.units,
            modality: d.modality,
            invert: d.invert,
        };

        background.shaders = shaders.map(s => s?.type === "dicom-window"
            ? {
                ...s,
                // Windowing a sample the first pass already quantized to 8 bits
                // is meaningless; the RGBA16F packs say so too, but this holds
                // before the first tile arrives.
                precision: s.precision ?? "float16",
                [this.constructor.AUTO_PARAMS_MARKER]: true,
                params: { ...auto, ...(s.params || null) },
            }
            : s);
    }

    /**
     * `dataID.derived`: attach SEG / Parametric Map overlays this session asked
     * for. `"auto"` discovers everything attributable to the slide; an array
     * names the series explicitly and costs no discovery probe at all.
     */
    async _attachRequestedOverlays(event, id) {
        if (id.derived === undefined || id.derived === null) return;
        return this.attachDerivedOverlays(event, id, id.derived);
    }

    /**
     * Attach derived-object overlays to an opening background.
     *
     * Public because the decision to do this *without being asked* belongs to
     * whoever has an opinion about what the viewer should show — the
     * `dicom-browser` plugin — while the mechanics (discovery, data-entry
     * appending, the reuse marker) belong here. Session-declared `dataID.derived`
     * routes through the same method.
     *
     * @param {object} event the `before-open` event
     * @param {{studyUID: string, seriesUID: string, role?: string}} id
     * @param {"auto"|string[]} requested `"auto"` discovers; an array names the
     *   series explicitly and costs no discovery probe.
     */
    async attachDerivedOverlays(event, id, requested) {
        if (!requested || !id?.seriesUID || !id?.studyUID) return;
        if (id.role && id.role !== "wsi" && id.role !== "radiology") return;

        const config = APPLICATION_CONTEXT.config;
        const visualizations = Array.isArray(config.visualizations) ? config.visualizations : [];
        const marker = this.constructor.OVERLAY_MARKER;

        // Already attached for this slide (re-open, or a restored session that
        // carries the generated entry) — reuse it rather than append a copy.
        const existing = visualizations.findIndex(v => v && v[marker] === id.seriesUID);
        if (existing >= 0) {
            event.visualizationIndex = existing;
            return;
        }

        // No renderer, no overlays — but the slide must still open.
        if (!registerDicomShaderLayers()) return;

        const built = await this._buildOverlayVisualization(
            id.studyUID, id.seriesUID, event.background?.name || "",
            Array.isArray(requested) ? requested : null);
        if (!built) {
            console.info(`[dicom] no derived objects attributable to series ${id.seriesUID}`);
            return;
        }

        // Index assignment through the event: the pipeline writes
        // `config.visualizations[visualizationIndex] = event.visualization`
        // and stamps the index onto the background entry.
        event.visualizationIndex = visualizations.length;
        event.visualization = built;
        console.info(
            `[dicom] attached ${Object.keys(built.shaders).length} overlay(s) to ${id.seriesUID} ` +
            `as visualization #${event.visualizationIndex}`);
    }

    /**
     * The "view whole case" primitive: config fragments for every renderable
     * series of a study.
     *
     * **Returns configuration; applies nothing.** Whoever asked — the session
     * via `expand: "case"`, or the `dicom-browser` plugin — decides what to do
     * with it. That is what keeps this plugin from having an opinion about what
     * the viewer shows.
     *
     * @param {string} studyUID
     * @param {object} [opts]
     * @param {string} [opts.exclude] a series already open, left out of the result
     * @returns {Promise<{data: object[], background: object[]}>}
     */
    async buildCaseSession(studyUID, opts = {}) {
        const series = await this.seriesConfigForStudy(studyUID);
        const background = [];
        const data = [];

        for (const s of series) {
            if (!s.seriesUID || s.seriesUID === opts.exclude) continue;
            const reference = this.makeDataReference(studyUID, s.seriesUID,
                DicomTools.RADIOLOGY_MODALITIES.has(s.modality) ? "radiology" : "wsi");
            data.push(reference);
            background.push({
                id: s.seriesUID,
                name: this.friendlySeriesName(s.seriesUID, s),
                dataReference: reference,
                // A radiology series is quantitative and windows in the shader;
                // a slide renders as-is.
                ...(DicomTools.RADIOLOGY_MODALITIES.has(s.modality)
                    ? { shaders: [{ type: "dicom-window", precision: "float16" }] }
                    : {}),
            });
        }

        return { data, background };
    }

    /**
     * Build a human-readable display name for a series. Used at boot time
     * (before the per-instance WSI label is available) so the open-slide
     * chips and slide-info show something nicer than a 64-char UID. When a
     * series metadata blob is available (description / number / body part),
     * uses it; otherwise falls back to a short UID tail.
     */
    friendlySeriesName(seriesUID, meta = null) {
        const tail = seriesUID ? String(seriesUID).slice(-6) : "";
        const fallback = tail
            ? this.t('series.fallbackTail', { tail })
            : this.t('series.fallbackGeneric');
        if (!meta) return fallback;
        const desc = typeof meta.description === "string" ? meta.description.trim() : "";
        if (desc) {
            const suffix = meta.bodyPart ? ` (${meta.bodyPart})` : "";
            return `${desc}${suffix}`;
        }
        if (meta.seriesNumber != null) return this.t('series.fallbackNumbered', { number: meta.seriesNumber, tail });
        return fallback;
    }

    /**
     * Register a factory-style slide protocol that constructs a
     * DICOMWebTileSource from the DataID's { studyUID, seriesUID }. Plugin
     * config (serviceUrl, useRendered, patientDetails, frameOrder) is captured
     * via closure so each resolve uses the live plugin state.
     */
    _registerSlideProtocol() {
        const plugin = this;
        // Per-protocol HttpClient configuration. Deployments can opt into a
        // server-side proxy alias + custom auth context by setting `httpClient`
        // on the plugin's include.json (see commented example). Default routes
        // direct to the DICOMweb service URL with JWT injected by the main
        // user-auth context — the same shape that worked under the legacy
        // bare-fetch + manual `Authorization: Bearer …` plumbing.
        const httpClientOpts = this.getStaticMeta("httpClient", null) || {
            baseURL: this.serviceUrl,
            auth: { types: ["jwt"], required: false }
        };

        // The base every tile source builds its URLs on.
        //
        // MUST be empty when the deployment proxies. `getTileUrl` composes
        // `${baseUrl}/studies/…`, and `XOpatRemoteEndpoint.resolveUrl` returns an
        // absolute URL unchanged — so leaving `serviceUrl` here would send every
        // tile straight to the upstream origin, bypassing the proxy, and
        // `isCrossOriginUrl` would strip the auth headers on the way out. QIDO
        // and metadata (relative paths) would still go through the proxy, so the
        // deployment would half-work, which is the worst way for it to fail.
        // Empty base ⇒ relative paths ⇒ joined onto the proxy's baseURL.
        const tileBaseUrl = httpClientOpts.proxy ? "" : this.serviceUrl;
        window.SLIDE_PROTOCOLS.register({
            id: "dicom",
            label: "DICOMweb",
            httpClient: httpClientOpts,
            createTileSource: (ctx) => {
                const id = ctx.dataID;
                if (!id || typeof id !== "object" || !id.studyUID || !id.seriesUID) {
                    throw new Error(
                        `[dicom] protocol "dicom" requires dataID = { studyUID, seriesUID }, got ${JSON.stringify(id)}`
                    );
                }
                // `role` selects the reader. Absent (legacy sessions exported
                // before overlays existed) means the slide itself.
                const role = id.role || "wsi";
                if (role === "seg" || role === "pmap") {
                    return new DICOMDerivedTileSource({
                        client: ctx.httpClient,
                        baseUrl: tileBaseUrl,
                        studyUID: id.studyUID,
                        seriesUID: id.seriesUID,
                        kind: role,
                        sourceSeriesUID: id.sourceSeriesUID || null,
                    });
                }
                // One role for every radiology modality: which one it is, is a
                // property of the data, not something a session author should be
                // able to get wrong.
                if (role === "radiology") {
                    return new RadiologySeriesTileSource({
                        client: ctx.httpClient,
                        baseUrl: tileBaseUrl,
                        studyUID: id.studyUID,
                        seriesUID: id.seriesUID,
                        subVolume: id.subVolume || null,
                        patientDetails: () => plugin.state.activePatientDetails,
                    });
                }
                return new DICOMWebTileSource({
                    client: ctx.httpClient,
                    baseUrl: tileBaseUrl,
                    studyUID: id.studyUID,
                    seriesUID: id.seriesUID,
                    useRendered: plugin.useRendered,
                    preferBaselineJpeg: plugin.preferBaselineJpeg,
                    // A live accessor, not a snapshot: `ensureStudyContext` is
                    // no longer awaited in `before-open`, so the details may
                    // still be in flight when the source is constructed.
                    // `getSensitiveMetadata()` reads it at call time.
                    patientDetails: () => plugin.state.activePatientDetails,
                    ...plugin.frameOrder,
                });
            },
            supports: (ctx) => {
                const id = ctx.dataID;
                return !!(id && typeof id === "object" && id.studyUID && id.seriesUID);
            },
        });
    }

    /**
     * Cached HttpClient for DICOMweb requests issued by the plugin itself
     * (slide-info browser, metadata pre-fetching, IO sink). Same instance the
     * TileSources receive via the slide-protocol resolve — registry caches it
     * after first lookup.
     */
    get _client() {
        if (!this.__cachedClient) {
            this.__cachedClient = window.SLIDE_PROTOCOLS.getClientForProtocol("dicom");
        }
        return this.__cachedClient;
    }

    /**
     * Register the DICOM SR annotations IO sink. Called eagerly from the
     * constructor (before `integrateWithSingletonModule('annotations', …)`)
     * so the annotations module's `_initIOPipeline` finds the binding.
     */
    /**
     * Resolve the DICOM slide context for a viewer. DICOM SR is only
     * meaningful when the viewer's tile source carries DICOM metadata;
     * non-DICOM slides return null so callers can decline gracefully.
     * Falls back to the first world item when the scalebar is not wired
     * (mirrors UTILITIES.currentBackgroundIdFor) — without the fallback both
     * SR read and write silently no-op on such viewers.
     */
    _resolveDicomSlide(viewer) {
        if (!viewer) return null;
        let tiledImage = viewer.scalebar?.getReferencedTiledImage?.();
        if (!tiledImage) {
            tiledImage = viewer.world?.getItemAt?.(0);
            if (tiledImage) console.debug("[dicom] resolveSlide: scalebar missing, using first world item");
        }
        const meta = tiledImage?.source?.getMetadata?.()?.imageInfo;
        if (!meta?.frameOfReferenceUID) return null;
        return { viewer, meta: { ...meta, patient: this.state.activePatientDetails } };
    }

    /**
     * Per-series SR sync state: last known content hash (what the latest SR
     * on the server holds, as far as this session knows) + whether a remote
     * SR exists at all. Drives the writeBundle dirty check — the IO pipeline
     * flushes on every slide-leave and without the hash every leave would
     * stow a duplicate SR instance.
     */
    _srStateFor(seriesUID) {
        this._srState = this._srState || new Map();
        let st = this._srState.get(seriesUID);
        if (!st) {
            st = { hash: undefined, hasRemoteSR: false };
            this._srState.set(seriesUID, st);
        }
        return st;
    }

    /**
     * Cheap stable content hash of an encodePartial conversion (FNV-1a over
     * the serialized DICOM items — includes the co-encoded preset blob, so
     * preset-only changes are "dirty" too). encodePartial builds items
     * deterministically from canvas + palette state, so equal state ⇒ equal
     * string ⇒ equal hash; no crypto needed, this only suppresses redundant
     * writes and never guards integrity.
     */
    _hashConversion(conversion) {
        const s = JSON.stringify(conversion?.objects ?? []);
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return (h >>> 0).toString(36) + ":" + s.length;
    }

    _registerDicomSrSink() {
        const plugin = this;

        const resolveSlide = (ctx) => {
            const viewer = ctx.viewerId
                ? VIEWER_MANAGER.getViewer(ctx.viewerId, false)
                : undefined;
            return plugin._resolveDicomSlide(viewer);
        };

        IO_PIPELINE.registerSink({
            id: 'dicom-sr-annotations',
            label: 'DICOM SR (annotations)',
            // Declarative, not `accepts: ctx => ctx.ownerId === 'annotations'`:
            // this sink encodes DICOM SR and can only ever serve the
            // annotations module. Saying so here means the pipeline validates
            // bindings at boot (`io:invalid-binding`) instead of discovering
            // the mismatch mid-save — and a dispatch every sink declines is
            // now a refusal, not a silent success.
            supports: { kinds: ['bundle'], owners: ['annotations'] },

            // Export: re-encode from the live fabric wrapper for the targeted
            // viewer. The pipeline-supplied `payload` (from annotations'
            // exportBundle) is intentionally ignored — DICOM SR's wire format
            // differs from the module's native JSON, and the convertor needs
            // slide-scoped meta the bundle hook doesn't carry.
            writeBundle: async (ctx) => {
                const slide = resolveSlide(ctx);
                if (!slide) return { ok: true }; // no DICOM slide for this viewer — silently skip
                if (!slide.meta.micronsX) {
                    return { ok: false, refused: true,
                        reason: 'missing PixelSpacing on DICOM slide',
                        userMessage: 'Cannot save annotations as DICOM SR: slide is missing PixelSpacing.',
                        code: 'W_DICOM_NO_PIXEL_SPACING' };
                }
                const annotations = singletonModule('annotations');
                const fabric = annotations?.getFabric?.(slide.viewer);
                if (!fabric) {
                    return { ok: false, refused: true,
                        reason: 'no fabric wrapper for viewer',
                        code: 'W_DICOM_NO_FABRIC' };
                }
                try {
                    const conversion = await OSDAnnotations.Convertor.encodePartial(
                        { format: 'dicom', serialize: false, meta: slide.meta }, fabric);
                    const state = plugin._srStateFor(slide.meta.seriesUID);
                    const hash = plugin._hashConversion(conversion);

                    // Unchanged since hydration / last stow → nothing to say.
                    // (The baseline hash is captured on slide hydration by the
                    // annotations 'import' listener, see the annotations
                    // integration block.)
                    if (state.hash === hash) return { ok: true };

                    // Never-annotated slide with an empty palette: don't
                    // create noise SRs. Everything else stows — including an
                    // "empty" snapshot (annotations all deleted, palette-only
                    // changes): the new SR supersedes the previous latest, so
                    // stale annotations stop resurrecting and presets persist
                    // without requiring a drawn annotation.
                    const items = conversion.objects || [];
                    const hasAnnotations = items.some(o => o.ValueType === "SCOORD3D");
                    const presetsItem = items.find(o => o.ValueType === "TEXT"
                        && o.ConceptNameCodeSequence?.[0]?.CodeValue === "XOPAT.PRESETS");
                    const hasPresets = !!presetsItem && presetsItem.TextValue !== "[]";
                    if (!hasAnnotations && !hasPresets && !state.hasRemoteSR) return { ok: true };

                    const buffer = OSDAnnotations.Convertor.encodeFinalize('dicom', conversion);
                    await DicomTools.stow(plugin._client, slide.meta.studyUID, buffer);
                    state.hash = hash;
                    state.hasRemoteSR = true;
                    return { ok: true };
                } catch (e) {
                    return { ok: false, refused: true,
                        reason: e?.message ?? String(e),
                        userMessage: 'DICOM STOW-RS failed.',
                        code: 'W_DICOM_STOW' };
                }
            },

            // Import: find the latest SR for the viewer's series, return the raw
            // DICOM buffer wrapped with format + meta so annotations' importBundle
            // can route it through `Convertor.decode("dicom", …)`.
            readBundle: async (ctx) => {
                const slide = resolveSlide(ctx);
                if (!slide) return { ok: true, payload: undefined };
                const client = plugin._client;
                // Scope the SR lookup to this viewer's series via
                // ReferencedSeriesSequence — otherwise both viewers in a
                // multi-viewport open of the same study would hydrate the
                // same (latest-in-study) SR.
                const latest = await DicomTools.findLatestAnnotation(
                    client, slide.meta.studyUID, slide.meta.seriesUID);
                plugin._srStateFor(slide.meta.seriesUID).hasRemoteSR = !!latest;
                if (!latest) return { ok: true, payload: undefined };

                try {
                    const res = await client.fetchRaw(
                        `/studies/${slide.meta.studyUID}/series/${latest.seriesUID}/instances/${latest.sopUID}`,
                        { headers: { Accept: 'application/dicom' } }
                    );
                    const buffer = await res.arrayBuffer();
                    return { ok: true, payload: { format: 'dicom', meta: slide.meta, buffer } };
                } catch (e) {
                    return { ok: false, refused: true,
                        reason: `WADO-RS ${e?.statusCode ?? ''} ${e?.message ?? ''}`.trim(),
                        userMessage: 'Failed to load annotations from DICOM server.',
                        code: 'W_DICOM_WADO' };
                }
            },
        });
    }

    /**
     * Whether the server implements the (non-standard) `/patients` QIDO
     * resource. Deployment opt-out: declare `supportsPatients: false` (or
     * true) in include.json to skip the runtime probe — the probe hits
     * /patients on servers that don't implement it (e.g. GCS Healthcare) and
     * produces a loud CORS error in the console even though the JS catch
     * swallows it. The probe result is memoized **per client** in `DicomTools`
     * rather than on `this` — the previous per-instance memo still let the
     * probe go out four times in one measured session.
     */
    async _supportsPatients() {
        const explicit = this.getStaticMeta("supportsPatients", null);
        if (explicit !== null && explicit !== undefined) return !!explicit;
        return DicomTools.supportsPatients(this._client);
    }

    /**
     * Paged patient listing (public listing API). Uses `/patients` when the
     * server supports it, otherwise derives distinct patients from `/studies`
     * with a cross-page dedupe cursor (see _listPatientsDerived).
     * @param {{limit?: number, offset?: number, search?: string}} opts
     *   `search` filters by PatientName (QIDO wildcard match).
     * @return {Promise<{items: object[], total: (number|undefined), level: string}>}
     *   `total` is undefined when the server does not report one.
     */
    async listPatientsPaged({ limit = 50, offset = 0, search = "" } = {}) {
        if (await this._supportsPatients()) {
            const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
            if (search) params.set('PatientName', `*${this._sanitizeQueryValue(search)}*`);
            const { rows, total } = await DicomTools.qidoSafeWithMeta(this._client, `/patients?${params}`, this.STUDY_PROJECTION, BROWSER_LANE);
            const items = (rows || []).map(ds => this.parsePatient(ds));
            return { items, total: total ?? undefined, level: 'patients' };
        }
        return this._listPatientsDerived({ limit, offset, search });
    }

    /**
     * Derived-patients pagination: page through `/studies` accumulating
     * DISTINCT patients until the requested window is filled. The cursor is
     * session-cached per search string — the previous implementation deduped
     * per page only, so the same patient reappeared on every page and the
     * reported total was the *studies* total.
     */
    async _listPatientsDerived({ limit = 50, offset = 0, search = "" } = {}) {
        const key = search || "";
        if (this._derivedPatientsCursor?.key !== key) {
            this._derivedPatientsCursor = { key, patients: [], seen: new Set(), studyOffset: 0, exhausted: false };
        }
        const c = this._derivedPatientsCursor;
        const serverPage = 100;
        while (!c.exhausted && c.patients.length < offset + limit) {
            const params = new URLSearchParams({ limit: String(serverPage), offset: String(c.studyOffset) });
            if (search) params.set('PatientName', `*${this._sanitizeQueryValue(search)}*`);
            const { rows } = await DicomTools.qidoSafeWithMeta(this._client, `/studies?${params}`, this.STUDY_PROJECTION, BROWSER_LANE);
            c.studyOffset += serverPage;
            for (const r of (rows || [])) {
                const p = this.parsePatient(r);
                if (p.patientID && !c.seen.has(p.patientID)) {
                    c.seen.add(p.patientID);
                    c.patients.push(p);
                }
            }
            if (!rows || rows.length < serverPage) c.exhausted = true;
        }
        return {
            items: c.patients.slice(offset, offset + limit),
            // Exact count only once the study list is exhausted; undefined
            // renders as "Page N / ?" instead of a lie.
            total: c.exhausted ? c.patients.length : undefined,
            level: 'patients-derived',
        };
    }

    /**
     * Paged study listing (public listing API) — optionally scoped to a
     * patient and filtered by QIDO study-level attributes.
     * @param {{patientID?: string, filters?: {StudyDate?: string, PatientName?: string,
     *   AccessionNumber?: string, Modality?: string}, limit?: number, offset?: number}} opts
     * @return {Promise<{items: object[], total: (number|undefined), level: string}>}
     */
    async listStudies({ patientID = null, filters = {}, limit = 50, offset = 0 } = {}) {
        const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        if (patientID) params.set('PatientID', patientID);
        if (filters.StudyDate) params.set('StudyDate', filters.StudyDate);     // e.g. 20240101-20241231
        if (filters.PatientName) params.set('PatientName', filters.PatientName);
        if (filters.AccessionNumber) params.set('AccessionNumber', filters.AccessionNumber);
        if (filters.StudyInstanceUID) params.set('StudyInstanceUID', filters.StudyInstanceUID);
        if (filters.Modality) params.set('Modality', filters.Modality);

        const { rows, total } = await DicomTools.qidoSafeWithMeta(this._client, `/studies?${params}`, this.STUDY_PROJECTION, BROWSER_LANE);
        const items = (rows || []).map(ds => this.parseStudy(ds));
        return { items, total: total ?? undefined, level: 'studies' };
    }

    /**
     * Map the browser search box input onto QIDO study filters:
     * `YYYYMMDD` / `YYYYMMDD-YYYYMMDD` → StudyDate, `acc:<value>` →
     * AccessionNumber, a dotted-numeric OID → StudyInstanceUID, anything else →
     * PatientName wildcard.
     *
     * The UID branch matters: a StudyInstanceUID is the most natural thing to
     * paste into the box (it is what the study listing shows and what
     * `test/dicom/find-idc-overlays.mjs` prints), and routing it to a
     * PatientName wildcard guarantees zero matches.
     */
    _searchToStudyFilters(q) {
        q = (q || "").trim();
        if (!q) return {};
        if (/^\d{8}(-\d{8})?$/.test(q)) return { StudyDate: q };
        const acc = q.match(/^acc:(.+)$/i);
        if (acc) return { AccessionNumber: acc[1].trim() };
        // A dotted-numeric OID is never a patient name.
        if (/^\d+(\.\d+)+$/.test(q)) return { StudyInstanceUID: q };
        return { PatientName: `*${this._sanitizeQueryValue(q)}*` };
    }

    /**
     * Make a free-text fragment safe to embed in a QIDO wildcard match.
     *
     * `\` is the DICOM multi-value delimiter — leaving it in splits the query
     * into several values and matches nothing. User-supplied `*`/`?` are
     * dropped rather than honoured: the term is already wrapped in `*…*`, and
     * an interior wildcard mostly produces confusing empty results.
     */
    _sanitizeQueryValue(value) {
        return String(value).replace(/[\\*?]/g, "").trim();
    }

    /**
     * Paged series listing for a study (public listing API).
     * @return {Promise<{items: object[], total: (number|undefined), level: string}>}
     */
    async listSeriesForStudy(studyUID, { limit = 50, offset = 0 } = {}) {
        const path = `/studies/${encodeURIComponent(studyUID)}/series?limit=${limit}&offset=${offset}`;
        const { rows, total } = await DicomTools.qidoSafeWithMeta(this._client, path, '0020000E,00080060,0008103E,00201209', BROWSER_LANE);
        const items = (rows || []).map(ds => this.parseSeries(ds));
        return { items, total: total ?? undefined, level: 'series' };
    }

    /** Map items through an async fn with a fixed concurrency cap. */
    async _mapConcurrent(items, cap, fn) {
        // One implementation, shared with the metadata walks in DicomTools.
        return DicomTools.mapConcurrent(items, cap, fn);
    }

    /**
     * All shallow WSI items of a study, resolved once per (study, search) and
     * cached. One QIDO series sweep + one QIDO instances call per series
     * (concurrency-capped) — NO per-instance WADO metadata, which is what
     * made the browser's Images level crawl (deep findWSIItems stays on the
     * tile-source init path). Series are client-side filtered by the search
     * string against description/modality/bodyPart.
     */
    async _shallowWsiItemsForStudy(studyUID, search = "") {
        const key = `${studyUID}::${search || ""}`;
        this._imagesCache = this._imagesCache || new Map();
        let cached = this._imagesCache.get(key);
        if (cached) return cached;
        const promise = (async () => {
            const all = [];
            const serverPage = 100;
            for (let off = 0; off < 5000; off += serverPage) {
                const { items } = await this.listSeriesForStudy(studyUID, { limit: serverPage, offset: off });
                all.push(...(items || []));
                if (!items || items.length < serverPage) break;
            }
            const q = (search || "").trim().toLowerCase();
            const filtered = q
                ? all.filter(s => [s.description, s.modality, s.bodyPart]
                    .filter(Boolean).some(v => String(v).toLowerCase().includes(q)))
                : all;
            const grouped = await this._mapConcurrent(filtered, 4, s =>
                DicomTools.findWSIItemsShallow(this._client, studyUID, s.seriesUID, {
                    seriesMeta: {
                        description: s.description,
                        modality: s.modality,
                        bodyPart: s.bodyPart,
                        seriesNumber: s.number,
                    },
                }).catch(err => {
                    console.warn("[dicom] shallow WSI listing failed for series", s.seriesUID, err);
                    return [];
                }));
            return grouped.flat();
        })();
        this._imagesCache.set(key, promise);
        promise.catch(() => this._imagesCache.delete(key));
        return promise;
    }

    parsePatient(ds) {
        const id  = DicomTools.v(ds, '00100020'); // PatientID
        const name= DicomTools.v(ds, '00100010'); // PatientName (PN)
        const sex = DicomTools.v(ds, '00100040'); // PatientSex
        const dob = DicomTools.v(ds, '00100030'); // PatientBirthDate
        return { patientID: id, name, sex, birthDate: dob };
    }

    parseStudy(ds) {
        const studyUID   = DicomTools.v(ds, '0020000D');   // StudyInstanceUID
        const studyDate  = DicomTools.v(ds, '00080020');   // StudyDate (YYYYMMDD)
        const studyTime  = DicomTools.v(ds, '00080030');   // StudyTime (HHMMSS.frac)
        const desc       = DicomTools.v(ds, '00081030');   // StudyDescription
        const patientID  = DicomTools.v(ds, '00100020');   // PatientID
        const studyID    = DicomTools.v(ds, '00200010');   // StudyID
        const accession  = DicomTools.v(ds, '00080050');   // AccessionNumber
        const mods     = ds?.['00080061']?.Value || []; // ModalitiesInStudy (array)
        const nSeries    = Number(DicomTools.v(ds, '00201206') ?? 0);    // NumberOfStudyRelatedSeries
        const nInst      = Number(DicomTools.v(ds, '00201208') ?? 0);    // NumberOfStudyRelatedInstances
        const institution= DicomTools.v(ds, '00080080');   // InstitutionName
        const station    = DicomTools.v(ds, '00081010');   // StationName
        const referring  = DicomTools.v(ds, '00080090');   // ReferringPhysicianName
        const performing = DicomTools.v(ds, '00081050');   // PerformingPhysicianName
        const bodyPart   = DicomTools.v(ds, '00180015');   // BodyPartExamined
        const reqProc    = DicomTools.v(ds, '00321060');   // RequestedProcedureDescription
        const reasonPerf = DicomTools.v(ds, '00401012');   // ReasonForPerformedProcedure
        const comments   = DicomTools.v(ds, '00324000');   // StudyComments

        // Friendly label + when
        const whenISO = (studyDate || studyTime)
            ? DicomTools.toISODateTime(studyDate, studyTime) : null;

        const label = desc || (whenISO ? `Study ${whenISO.slice(0,10)}` : `Study ${studyUID}`);

        // Chips you may show in UI (optional)
        const chips = {
            accession,
            studyID,
            modalities: mods,
            counts: { series: nSeries, instances: nInst },
            institution,
        };

        return {
            level: 'study',
            studyUID,
            studyID,
            patientID,
            accession,
            description: desc,
            date: studyDate,
            time: studyTime,
            whenISO,
            modalities: mods,
            seriesCount: nSeries,
            instanceCount: nInst,
            institution,
            station,
            referringPhysician: referring,
            performingPhysician: performing,
            bodyPartExamined: bodyPart,
            requestedProcedureDescription: reqProc,
            reasonForPerformedProcedure: reasonPerf,
            comments,
            uidTail: (studyUID && studyUID.length > 8) ? studyUID.slice(-8) : (studyUID || ''),
            label,         // used by your list render
            chips,         // handy bundle for compact line
        };
    }

    parseSeries(ds) {
        const studyUID   = DicomTools.v(ds, '0020000D');
        const seriesUID  = DicomTools.v(ds, '0020000E');
        const number     = DicomTools.v(ds, '00200011'); // SeriesNumber
        const desc       = DicomTools.v(ds, '0008103E'); // SeriesDescription
        const modality   = DicomTools.v(ds, '00080060'); // Modality
        const bodyPart   = DicomTools.v(ds, '00180015'); // BodyPartExamined
        const instanceCt = DicomTools.v(ds, '00201209'); // NumberOfSeriesRelatedInstances (may be absent)
        return { studyUID, seriesUID, number, description: desc, modality, bodyPart, instanceCount: instanceCt };
    }

    /** If you only know Series UID, discover its Study UID (QIDO /series?SeriesInstanceUID=). Public listing API. */
    async lookupStudyForSeries(seriesUID) {
        // Avoid includefield to support servers that don't allow it here (e.g., GCP)
        const path = `/series?SeriesInstanceUID=${encodeURIComponent(seriesUID)}`;
        const arr = await DicomTools.qido(this._client, path);
        const row = arr?.[0];
        if (!row) return null;
        return { studyUID: DicomTools.v(row, '0020000D'), seriesUID: DicomTools.v(row, '0020000E') };
    }

    async seriesConfigForStudy(studyUID) {
        const path = `/studies/${encodeURIComponent(studyUID)}/series`;
        // Pull SeriesDescription / SeriesNumber / BodyPart so the boot path
        // can build a friendly `name` instead of the raw series UID.
        const json = await DicomTools.qidoSafe(this._client, path, '0020000D,0020000E,00080060,0008103E,00200011,00180015');

        const cfg = (json || [])
            .filter(ds => {
                const mod = DicomTools.v(ds, '00080060');
                // filter out non-image types like Key Objects (KO) or Presentation States (PR)
                return mod !== 'SR' && mod !== 'KO' && mod !== 'PR' && mod !== 'SEG' && mod !== 'RTSTRUCT';
            })
            .map(ds => ({
                studyUID: DicomTools.v(ds, '0020000D') || studyUID,
                seriesUID: DicomTools.v(ds, '0020000E'),
                description: DicomTools.v(ds, '0008103E'),
                modality: DicomTools.v(ds, '00080060'),
                bodyPart: DicomTools.v(ds, '00180015'),
                seriesNumber: DicomTools.v(ds, '00200011'),
            }))
            .filter(x => x.seriesUID);
        // Cache for the UI layers — avoids the boot path re-fetching the
        // same series list when the browser opens the study level.
        this.state.seriesByStudy.set(studyUID, cfg);
        return cfg;
    }

    // Return studies + series for a patient
    async seriesForPatient(patientID, { limit = 50, offset = 0 } = {}) {
        const path = `/studies?PatientID=${encodeURIComponent(patientID)}&limit=${limit}&offset=${offset}`;
        const rows = await DicomTools.qidoSafe(this._client, path, '0020000D,00080020,00081030,00100020', BROWSER_LANE);
        const studies = (rows || []).map(ds => this.parseStudy(ds));
        return { studies };
    }

    async populateStudyDetails(studyUID) {
        // Idempotent — the boot path and UI hooks may both request the same
        // study; skip the round-trip when details are already loaded.
        if (this.state.activeStudyDetails?.studyUID === studyUID) return;

        // QIDO, not WADO-RS `/studies/{uid}/metadata`. That endpoint is
        // *Retrieve Study Metadata*: the full dataset of every instance in the
        // study. Measured at 438 KB / 1.57 s for a single WSI study — and it
        // was the FIRST request of the whole slide open, purely to fill a
        // patient/study card. A study-level QIDO answers the same question in
        // about a kilobyte.
        //
        // `qidoSafeWithMeta` already retries without `includefield` for stores
        // that reject it (GCP), which is what the WADO detour was working
        // around; the attributes below are QIDO study-level return attributes,
        // so the fallback still carries them.
        const { rows } = await DicomTools.qidoSafeWithMeta(
            this._client,
            `/studies?StudyInstanceUID=${encodeURIComponent(studyUID)}&limit=1`,
            this.STUDY_PROJECTION,
            // No longer awaited by `before-open`, so nothing is blocked on it.
            BROWSER_LANE,
        );
        const row = rows?.[0];
        if (row) {
            this.state.activeStudyDetails = this.parseStudy(row);
            const p = this.parsePatient(row);
            if (p.patientID) this.state.activePatientDetails = p;
        }
    }

    async populatePatientDetails(patientID) {
        // GCP Healthcare API does not expose /patients; derive from first study
        const path = `/studies?PatientID=${encodeURIComponent(patientID)}`;
        const rows = await DicomTools.qidoSafe(this._client, path, '00100020,00100010,00100030,00100040', BROWSER_LANE);
        const row = rows?.[0];
        if (row) this.state.activePatientDetails = this.parsePatient(row);
    }

    /** Patient details for a study, if we do not already have them. */
    async ensurePatientForStudy(studyUID) {
        if (!studyUID) return;
        if (this.state.activePatientDetails?.patientID) return;
        await this.populateStudyDetails(studyUID);
    }

    async materializePatientsFromStudies(studies) {
        // Try to build unique patient list from study metadata
        const byID = new Map();
        for (const st of studies) {
            if (st.patientID && !byID.has(st.patientID)) {
                // Try enrich from patient endpoint
                let details = null;
                try {
                    await this.populatePatientDetails(st.patientID);
                    details = this.state.activePatientDetails;
                } catch {}
                byID.set(st.patientID, details || { patientID: st.patientID });
            }
        }
        return Array.from(byID.values());
    }

    // Called by host when plugin is ready; keep for future UI hooks
    pluginReady() {
        // no-op for now
    }
});
