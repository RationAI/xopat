import vanjs from "../../ui/vanjs.mjs";

import { DICOMWebTileSource } from "./tile-source.mjs";
import DicomTools from "./dicom-query.mjs";

/*
  DICOM plugin: unified workflow for Patient/Study/Series selection

  Behaviour:
  - A series, study or patient can be provided via options/configuration.
  - If a *series* is given -> open it immediately.
  - If a *study* is given -> prepare all series from that study as background configurations (do not open UI yet).
  - If a *patient* is given -> fetch all series of that patient, but do NOT issue any background configs yet (user chooses later).
  - If nothing is given -> fetch all patients and hold lists so a future UI can select a patient, then reuse the above logic.

  State we keep:
  - patients[]
  - studiesByPatient: Map(patientID -> Study[])
  - seriesByStudy: Map(studyUID -> Series[])
  - activePatient, activeStudy, activeSeries
  - parsed details for patient and study metadata (nicely parsed)

  Options (can be supplied via configuration or runtime options):
  - serviceUrl (string, required)
  - useRendered (boolean, optional)
  - defaultPatient (string PatientID or Patient/Study/Series UID triplet)
  - defaultStudy (string StudyInstanceUID)
  - defaultSeries (string SeriesInstanceUID)

  Notes:
  - QIDO-RS endpoints are used: /studies, /studies/{StudyUID}/series, /studies/{StudyUID}/series/{SeriesUID}/instances (when needed)
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
        this.defaultPatient = this.getOptionOrConfiguration('patientUID');
        this.defaultStudy   = this.getOptionOrConfiguration('studyUID');
        this.defaultSeries  = this.getOptionOrConfiguration('seriesUID');
        this.frameOrder = {
            frameOrderByInstance: this.getOption("frameOrderByInstance", null),
            frameOrderBySeries: this.getOption("frameOrderBySeries", null),
            frameOrder: this.getOption("frameOrder", null),
        };

        // In-memory state for future UI wiring
        this.state = {
            patients: [],                // [{ patientID, name, sex, birthDate, studies:[...]}]
            studiesByPatient: new Map(), // patientID -> [{ studyUID, date, desc, accession, referring, ... }]
            seriesByStudy: new Map(),    // studyUID   -> [{ seriesUID, modality, bodyPart, number, desc, instanceCount }]
            activePatient: null,
            activeStudy: null,
            activeSeries: null,
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

        this.STUDY_PROJECTION =
            '0020000D,' + // StudyInstanceUID
            '00080020,' + // StudyDate
            '00080030,' + // StudyTime
            '00081030,' + // StudyDescription
            '00100020,' + // PatientID
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

        // === PRE-OPEN LOGIC ===
        // We decide what to fetch/prepare *before first open* based on provided defaults.
        VIEWER_MANAGER.addHandler('before-app-init', async (evt) => {
            // _friendlySeriesName below resolves locale keys.
            await this._localeReady;

            const hasSeries = !!this.defaultSeries;
            const hasStudy  = !!this.defaultStudy;
            const hasPatient= !!this.defaultPatient;

            // Normalize starting point: if only Series is provided but no Study, look up its Study
            if (hasSeries && !hasStudy) {
                try {
                    const lookup = await this.lookupStudyForSeries(this.defaultSeries);
                    if (lookup?.studyUID) this.defaultStudy = lookup.studyUID;
                } catch (e) {
                    console.warn('Series->Study lookup failed:', e);
                }
            }

            // Defer to a restored session if one is already in place. Without
            // this guard, exporting a DICOM-backed session and reloading the
            // page (which feeds the restored config into `evt.background`)
            // gets clobbered by the plugin's default-options-derived rewrite
            // when the URL params don't carry seriesUID/studyUID — the user
            // sees a wrong (or empty) slide instead of what they exported.
            const hasRestoredBackground = Array.isArray(evt.background) && evt.background.length > 0;
            if (hasRestoredBackground) {
                // Still cache patient/study details based on whatever
                // identity the restored bg carries, so the slide-info UI
                // has the right context. Skip the `evt.background = …`
                // rewrites — the restored config wins.
                if (hasSeries && !hasStudy) { /* lookup already happened above */ }
                if (hasStudy) {
                    this.state.activeStudy = this.defaultStudy;
                    try { await this.populateStudyDetails(this.state.activeStudy); }
                    catch (e) { /* best-effort */ }
                    try { await this.ensurePatientForCurrentStudy(); }
                    catch (e) { /* best-effort */ }
                }
                return;
            }

            if (hasSeries) {
                // Open this single series immediately. The DataOverride references
                // the "dicom" slide protocol; the registry constructs the
                // DICOMWebTileSource on demand, threading in the cached HttpClient.
                // Only the branches that rewrite `evt.background` may drop the
                // visualization config — patient/none boots keep the session's
                // visualizations intact.
                evt.visualizations = null;
                evt.background = [{
                    id: this.defaultSeries,
                    name: this._friendlySeriesName(this.defaultSeries),
                    dataReference: this._makeDataOverride(this.defaultStudy, this.defaultSeries),
                }];
                // Last user-selected series — UI hint only; the open-set truth
                // is `config.background`.
                this.state.activeSeries = this.defaultSeries;
                this.state.activeStudy  = this.defaultStudy || null;
                // Fetch and cache active patient/study details
                if (this.state.activeStudy) {
                    await this.populateStudyDetails(this.state.activeStudy);
                }
                await this.ensurePatientForCurrentStudy();
            } else if (hasStudy) {
                // Prepare all series from the study as background items (do not open a UI yet)
                const cfg = await this.seriesConfigForStudy(this.defaultStudy);
                evt.visualizations = null;
                evt.background = cfg.map(x => ({
                    id: x.seriesUID,
                    name: this._friendlySeriesName(x.seriesUID, x),
                    dataReference: this._makeDataOverride(x.studyUID, x.seriesUID),
                }));
                this.state.activeStudy = this.defaultStudy;
                await this.populateStudyDetails(this.state.activeStudy);
                await this.ensurePatientForCurrentStudy();
            } else if (hasPatient) {
                // Fetch all series of the patient, *but do NOT issue background config*
                const { studies, seriesByStudy } = await this.seriesForPatient(this.defaultPatient);
                // Cache into state for later UI use
                this.state.activePatient = this.defaultPatient;
                this.state.patients = await this.materializePatientsFromStudies(studies);
                this.state.studiesByPatient.set(this.defaultPatient, studies);
                if (seriesByStudy) {
                    for (const [studyUID, seriesArr] of seriesByStudy.entries()) {
                        this.state.seriesByStudy.set(studyUID, seriesArr);
                    }
                }
                // Populate details for the most relevant study (first one)
                if (studies.length) {
                    this.state.activeStudy = studies[0].studyUID;
                    await this.populateStudyDetails(this.state.activeStudy);
                }
                await this.populatePatientDetails(this.defaultPatient);
                // do NOT wipe the config, keep it remember old session
            } else {
                // Nothing given: no prefetch. UI will call the lazy loaders below.
                this.state.patients = [];
                // do NOT wipe the config, keep it remember old session
            }
        }, null, -1);

        this.integrateWithPlugin('slide-info', async info => {
            const { span, div } = vanjs.tags;

            // await will let the viewer potentially open, prevent the default behavior to kick in
            info.setWillInitCustomBrowser();

            await this._localeReady;
            const patientsSupported = await this._supportsPatients();

            const studiesLevel = {
                id: "studies",
                title: this.t('browser.studies'),
                searchHint: this.t('browser.searchHint'),
                mode: "page",
                pageSize: 20,
                // Stable identity: without keyOf the Explorer keys child buckets
                // by parent object identity, so re-fetched study objects would
                // force a fresh (unordered) QIDO re-fetch on back-navigation.
                keyOf: (s) => s?.studyUID || s?.StudyInstanceUID,
                getChildren: async (patient, ctx) => {
                    const pid = patient?.patientID || patient?.PatientID;
                    const res = await this.listStudies({
                        patientID: pid,
                        filters: this._searchToStudyFilters(ctx.search),
                        limit: ctx.pageSize,
                        offset: ctx.pageSize * ctx.page,
                    });
                    if (!ctx.search && ((res.total === 0) || (res.items.length === 0 && ctx.page === 0))) {
                        info.warn?.(this.t('browser.noStudies'));
                    }
                    // Set visual properties:
                    for (let item of res.items) {
                        item.label = item.description || item.studyUID;
                    }
                    return { total: res.total ?? undefined, items: res.items };
                },
                renderItem: (item, { itemIndex }) => {
                    // --- helpers (local, no external deps) ---
                    const fmtWhen = (it) => {
                        if (it.whenISO) return it.whenISO.replace('T', ' ').slice(0, 16); // "YYYY-MM-DD HH:MM"
                        const d = it.date || ''; const t = it.time || '';
                        const yyyy = d.slice(0,4), mm = d.slice(4,6), dd = d.slice(6,8);
                        const HH = t.slice(0,2), MM = t.slice(2,4);
                        if (!yyyy || !mm || !dd) return '';
                        return `${yyyy}-${mm}-${dd}${(HH && MM) ? ` ${HH}:${MM}` : ''}`;
                    };
                    const chips = [];
                    // Chips may carry unbounded tokens (UIDs, accession
                    // numbers) that cannot soft-wrap — hard-cap each badge and
                    // ellipsize. Inline style: the shipped tailwind build is
                    // purged and lacks arbitrary max-w-* utilities.
                    const addChip = (text) => { if (text) chips.push(span({
                        class: "badge badge-ghost badge-xs",
                        style: "max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block;"
                    }, String(text))); };

                    // --- title line ---
                    const title = item.label || item.description || item.studyID || item.studyUID || "";
                    const when  = fmtWhen(item);

                    // --- chips line (compact) ---
                    addChip(item.accession && this.t('browser.chipAccession', { value: item.accession }));
                    addChip(item.studyID && this.t('browser.chipStudyId', { value: item.studyID }));

                    // Modalities (e.g., ["SM","CT"]) → badges
                    const mods = Array.isArray(item.modalities) ? item.modalities : (item.modalities ? [item.modalities] : []);
                    if (mods.length) {
                        for (const m of mods) addChip(m);
                    }

                    // Series × Instances
                    const s = Number.isFinite(item.seriesCount) ? item.seriesCount : null;
                    const i = Number.isFinite(item.instanceCount) ? item.instanceCount : null;
                    if (s != null || i != null) addChip(this.t('browser.chipCounts', { series: s ?? "?", instances: i ?? "?" }));

                    // Institution / site
                    addChip(item.institution);

                    // trailing UID tail (debug)
                    addChip(item.uidTail && `…${item.uidTail}`);

                    // Tooltip with extra detail (optional)
                    const tooltip = [
                        item.referringPhysician && this.t('browser.tooltipReferring', { value: item.referringPhysician }),
                        item.performingPhysician && this.t('browser.tooltipPerforming', { value: item.performingPhysician }),
                        item.bodyPartExamined && this.t('browser.tooltipBodyPart', { value: item.bodyPartExamined }),
                        item.requestedProcedureDescription && this.t('browser.tooltipRequested', { value: item.requestedProcedureDescription }),
                        item.reasonForPerformedProcedure && this.t('browser.tooltipReason', { value: item.reasonForPerformedProcedure }),
                        item.comments && this.t('browser.tooltipComments', { value: `${String(item.comments).slice(0, 256)}${String(item.comments).length > 256 ? "…" : ""}` }),
                    ].filter(Boolean).join("\n");

                    return div(
                        {
                            class: "flex items-start justify-between px-2 py-2 hover:bg-base-200 cursor-pointer w-full overflow-hidden",
                            // vanjs assigns props literally: `title: undefined` would
                            // render as title="undefined" — omit the key instead
                            ...(tooltip ? { title: tooltip } : {})
                        },
                        // left: small icon + title/date — flex-1 + min-w-0 so
                        // long UIDs truncate instead of widening the row
                        div({ class: "flex items-start gap-2 min-w-0 flex-1" },
                            span({ class: "ph-light ph-folders shrink-0" }),
                            div({ class: "flex flex-col min-w-0" },
                                div({ class: "text-sm font-medium truncate" }, title),
                                when ? div({ class: "text-xs text-base-content/70 truncate" }, when) : null
                            )
                        ),
                        // right: chips — constrained so they wrap into rows
                        // rather than force horizontal scroll
                        div({ class: "flex items-center gap-1 flex-wrap justify-end pl-2 min-w-0", style: "max-width: 55%;" }, ...chips)
                    );
                },
                canOpen: (img) => true,
                onClick: (item) => {
                    this.state.activeStudy = item.studyUID;
                },
            };

            const imagesLevel = {
                id: "images",
                title: this.t('browser.images'),
                mode: "virtual",
                pageSize: 20,
                getChildren: async (seriesOrStudy, ctx) => {
                    const studyUID = seriesOrStudy.studyUID || seriesOrStudy.StudyInstanceUID;
                    // The full shallow WSI list for the study is resolved once
                    // (concurrency-capped, no per-instance metadata — see
                    // _shallowWsiItemsForStudy) and sliced here: WSI items
                    // don't map 1:1 to series, so server-side series paging
                    // cannot drive this level's virtual pagination honestly.
                    const all = await this._shallowWsiItemsForStudy(studyUID, ctx.search);
                    const start = ctx.offset ?? (ctx.pageSize * ctx.page);
                    return { total: all.length, items: all.slice(start, start + ctx.pageSize) };
                },
                canOpen: (img) => false,
                onClick: (img) => {
                    // Selection bookkeeping only — opening is handled by the
                    // slide switcher via customItemToBackground (which also
                    // guards malformed items).
                    if (img?.seriesUID) this.state.activeSeries = img.seriesUID;
                    if (img?.studyUID || this.state.activeStudy) {
                        this.state.activeStudy = img.studyUID || this.state.activeStudy;
                    }
                }
            };

            // If /patients is not supported, keep Patients but present the
            // derived list (cross-page deduped, see _listPatientsDerived).
            const levels = [{
                id: "patients",
                title: this.t('browser.patients'),
                mode: "page",
                pageSize: 20,
                // Stable identity across re-fetches — see studies keyOf note.
                keyOf: (p) => p?.patientID || p?.PatientID,
                getChildren: async (_parent, ctx) => {
                    const res = await this.listPatientsPaged({
                        limit: ctx.pageSize,
                        offset: ctx.pageSize * ctx.page,
                        search: ctx.search,
                    });
                    if (!ctx.search && ((res.total === 0) || (res.items.length === 0 && ctx.page === 0))) {
                        info.warn?.(this.t('browser.noPatients'));
                    }
                    for (let item of res.items) {
                        item.label = item.name || item.PatientName || item.patientID;
                    }
                    return { total: res.total ?? undefined, items: res.items };
                },
                renderItem: (item) => div(
                    { class: "flex items-center gap-2 px-2 py-2 hover:bg-base-200 cursor-pointer w-full overflow-hidden" },
                    span({ class: "ph-light ph-user shrink-0" }),
                    div({ class: "flex flex-col min-w-0 flex-1" },
                        div({ class: "text-sm font-medium truncate" }, item.label || item.patientID || ""),
                        item.patientID && item.label !== item.patientID
                            ? div({ class: "text-xs text-base-content/70 truncate" }, item.patientID) : null
                    )
                ),
                canOpen: () => true,
            }, studiesLevel, imagesLevel];
            if (!patientsSupported) levels.shift();

            info.setCustomBrowser({ id: "dicom-browser", levels, customItemToBackground: (item) => {
                    const seriesUID = item?.seriesUID;
                    const studyUID  = item?.studyUID || this.state.activeStudy;
                    if (!seriesUID || !studyUID) {
                        Dialogs.show(this.t('browser.openMissingIds'), 5000, Dialogs.MSG_ERR);
                        console.error("Missing seriesUID or studyUID for image:", item);
                        return null;
                    }
                    // Use the grouped WSI label (built by DicomTools.groupSeriesInstances
                    // from container / description / dims / modality) as the display
                    // name. Without this `name`, UTILITIES.nameFromBGOrIndex falls back
                    // to the raw series UID — which is what the user saw in the slide
                    // switcher cards.
                    const name = item.label || this._friendlySeriesName(seriesUID);
                    // Shared DataOverride builder — identical shape to the boot-default path
                    // in `before-app-init` so the slide-browser and boot paths converge.
                    return { id: seriesUID, name, dataReference: this._makeDataOverride(studyUID, seriesUID) };
                }, backgroundToCustomItem: (bgConfig) => {
                    // After the DataOverride migration, BackgroundConfig.data(...) returns
                    // entries shaped `{ dataID: { studyUID, seriesUID }, protocol: "dicom" }`.
                    // Tolerate both shapes — older sessions might still hold the raw
                    // `{ studyUID, seriesUID }` form.
                    const data = BackgroundConfig.data(bgConfig);
                    const id = data?.[0]?.dataID ?? data?.[0];
                    return { seriesUID: id?.seriesUID, studyUID: id?.studyUID };
                }, getItemPreview: async (item) => {
                    // Lazy thumbnail for unopened slides: the OVERVIEW/LABEL
                    // instance's `/rendered` representation. Missing preview
                    // instance (no OVERVIEW in the store) → null → the card
                    // keeps its placeholder image.
                    if (!item?.previewInstanceUID || !item?.studyUID || !item?.seriesUID) return null;
                    try {
                        return await DicomTools.fetchRenderedInstance(
                            this._client, item.studyUID, item.seriesUID, item.previewInstanceUID);
                    } catch (e) {
                        console.debug("[dicom] item preview unavailable:", e?.message ?? e);
                        return null;
                    }
                }
            });
        });

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
    _makeDataOverride(studyUID, seriesUID) {
        return {
            dataID: { studyUID, seriesUID },
            protocol: "dicom",
        };
    }

    /**
     * Build a human-readable display name for a series. Used at boot time
     * (before the per-instance WSI label is available) so the open-slide
     * chips and slide-info show something nicer than a 64-char UID. When a
     * series metadata blob is available (description / number / body part),
     * uses it; otherwise falls back to a short UID tail.
     */
    _friendlySeriesName(seriesUID, meta = null) {
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
                return new DICOMWebTileSource({
                    client: ctx.httpClient,
                    baseUrl: plugin.serviceUrl,
                    studyUID: id.studyUID,
                    seriesUID: id.seriesUID,
                    useRendered: plugin.useRendered,
                    patientDetails: plugin.state.activePatientDetails,
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
            supports: ['bundle'],
            accepts: (ctx) => ctx.ownerId === 'annotations',

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
     * swallows it. The probe result is memoized: every listing page used to
     * re-issue it.
     */
    async _supportsPatients() {
        const explicit = this.getStaticMeta("supportsPatients", null);
        if (explicit !== null && explicit !== undefined) return !!explicit;
        this._supportsPatientsPromise ??= (async () => {
            try {
                // GCP returns 404 here; DICOMweb servers that implement /patients return 200.
                await this._client.fetchRaw('/patients?limit=1', { headers: { Accept: 'application/dicom+json' } });
                return true;
            } catch (e) {
                // Any HTTPError (or network error) → assume the endpoint isn't supported.
                return false;
            }
        })();
        return this._supportsPatientsPromise;
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
            if (search) params.set('PatientName', `*${search}*`);
            const { rows, total } = await DicomTools.qidoSafeWithMeta(this._client, `/patients?${params}`, this.STUDY_PROJECTION);
            const items = rows.map(ds => this.parsePatient(ds));
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
            if (search) params.set('PatientName', `*${search}*`);
            const { rows } = await DicomTools.qidoSafeWithMeta(this._client, `/studies?${params}`, this.STUDY_PROJECTION);
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
        if (filters.Modality) params.set('Modality', filters.Modality);

        const { rows, total } = await DicomTools.qidoSafeWithMeta(this._client, `/studies?${params}`, this.STUDY_PROJECTION);
        const items = rows.map(ds => this.parseStudy(ds));
        return { items, total: total ?? undefined, level: 'studies' };
    }

    /**
     * Map the browser search box input onto QIDO study filters:
     * `YYYYMMDD` / `YYYYMMDD-YYYYMMDD` → StudyDate, `acc:<value>` →
     * AccessionNumber, anything else → PatientName wildcard.
     */
    _searchToStudyFilters(q) {
        q = (q || "").trim();
        if (!q) return {};
        if (/^\d{8}(-\d{8})?$/.test(q)) return { StudyDate: q };
        const acc = q.match(/^acc:(.+)$/i);
        if (acc) return { AccessionNumber: acc[1].trim() };
        return { PatientName: `*${q}*` };
    }

    /**
     * Paged series listing for a study (public listing API).
     * @return {Promise<{items: object[], total: (number|undefined), level: string}>}
     */
    async listSeriesForStudy(studyUID, { limit = 50, offset = 0 } = {}) {
        const path = `/studies/${encodeURIComponent(studyUID)}/series?limit=${limit}&offset=${offset}`;
        const { rows, total } = await DicomTools.qidoSafeWithMeta(this._client, path, '0020000E,00080060,0008103E,00201209');
        const items = rows.map(ds => this.parseSeries(ds));
        return { items, total: total ?? undefined, level: 'series' };
    }

    /** Map items through an async fn with a fixed concurrency cap. */
    async _mapConcurrent(items, cap, fn) {
        const results = new Array(items.length);
        let next = 0;
        const workers = Array.from({ length: Math.max(1, Math.min(cap, items.length)) }, async () => {
            while (next < items.length) {
                const idx = next++;
                results[idx] = await fn(items[idx], idx);
            }
        });
        await Promise.all(workers);
        return results;
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
        const rows = await DicomTools.qidoSafe(this._client, path, '0020000D,00080020,00081030,00100020');
        const studies = (rows || []).map(ds => this.parseStudy(ds));
        return { studies };
    }

    async populateStudyDetails(studyUID) {
        // Idempotent — the boot path and UI hooks may both request the same
        // study; skip the WADO round-trip when details are already loaded.
        if (this.state.activeStudyDetails?.studyUID === studyUID) return;
        // Use WADO-RS metadata endpoint instead of QIDO with includefield — works on GCP
        const meta = await DicomTools.wadoMetadata(this._client, `/studies/${encodeURIComponent(studyUID)}/metadata`);
        const row = meta?.[0];
        if (row) {
            this.state.activeStudyDetails = this.parseStudy(row);
            const p = this.parsePatient(row);
            if (p.patientID) this.state.activePatientDetails = p;
        }
    }

    async populatePatientDetails(patientID) {
        // GCP Healthcare API does not expose /patients; derive from first study
        const path = `/studies?PatientID=${encodeURIComponent(patientID)}`;
        const rows = await DicomTools.qidoSafe(this._client, path, '00100020,00100010,00100030,00100040');
        const row = rows?.[0];
        if (row) this.state.activePatientDetails = this.parsePatient(row);
    }

    async ensurePatientForCurrentStudy() {
        if (!this.state.activeStudy) return;
        // If we already have patient details, done
        if (this.state.activePatientDetails?.patientID) return;
        // Query study to obtain patient info
        await this.populateStudyDetails(this.state.activeStudy);
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
