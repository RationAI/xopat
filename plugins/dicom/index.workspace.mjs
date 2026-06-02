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
            const client = this._client;

            const hasSeries = !!this.defaultSeries;
            const hasStudy  = !!this.defaultStudy;
            const hasPatient= !!this.defaultPatient;

            // Normalize starting point: if only Series is provided but no Study, look up its Study
            if (hasSeries && !hasStudy) {
                try {
                    const lookup = await this.lookupStudyForSeries(client, this.defaultSeries);
                    if (lookup?.studyUID) this.defaultStudy = lookup.studyUID;
                } catch (e) {
                    console.warn('Series->Study lookup failed:', e);
                }
            }

            evt.visualizations = null;

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
                evt.background = [{
                    id: this.defaultSeries,
                    name: this._friendlySeriesName(this.defaultSeries),
                    dataReference: this._makeDataOverride(this.defaultStudy, this.defaultSeries),
                }];
                // todo remove acive series, can be mutlitple
                this.state.activeSeries = this.defaultSeries;
                this.state.activeStudy  = this.defaultStudy || null;
                // Fetch and cache active patient/study details
                if (this.state.activeStudy) {
                    await this.populateStudyDetails(this.state.activeStudy);
                }
                await this.ensurePatientForCurrentStudy();
            } else if (hasStudy) {
                // Prepare all series from the study as background items (do not open a UI yet)
                const cfg = await this.seriesConfigForStudy(client, this.defaultStudy);
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
                const { studies, seriesByStudy } = await this.seriesForPatient(client, this.defaultPatient);
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
            const {span, div} = vanjs.tags;

            // await will let the viewer potentially open, prevent the default behavior to kick in
            info.setWillInitCustomBrowser();

            const patientsSupported = await this._supportsPatients(this._client);

            const studiesLevel = {
                id: "studies",
                title: "Studies",
                mode: "page",
                pageSize: 20,
                getChildren: async (patient, ctx) => {
                    const pid = patient?.patientID || patient?.PatientID;
                    const res = pid ?
                        await this.listStudiesForPatient(this._client, pid, { limit: ctx.pageSize, offset: ctx.pageSize * ctx.page }) :
                        await this.listStudiesPagedAll(this._client, { limit: ctx.pageSize, offset: ctx.pageSize * ctx.page });
                    if ((res.total === 0) || (res.items.length === 0 && ctx.page === 0)) {
                        info.warn?.("No studies available for this patient.");
                    }
                    // Set visual properties:
                    for (let item of res.items) {
                        item.label = item.description || item.studyUID;
                    }
                    return { total: res.total, items: res.items };
                },
                renderItem: (item, { itemIndex }) => {
                    const { div, span } = van.tags;
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
                    const addChip = (text) => { if (text) chips.push(span({ class: "badge badge-ghost badge-xs" }, String(text))); };

                    // --- title line ---
                    const title = item.label || item.description || item.studyID || item.studyUID || "Study";
                    const when  = fmtWhen(item);

                    // --- chips line (compact) ---
                    // Accession, StudyID
                    addChip(item.accession && `Acc# ${item.accession}`);
                    addChip(item.studyID && `ID ${item.studyID}`);

                    // Modalities (e.g., ["SM","CT"]) → badges
                    const mods = Array.isArray(item.modalities) ? item.modalities : (item.modalities ? [item.modalities] : []);
                    if (mods.length) {
                        for (const m of mods) addChip(m);
                    }

                    // Series × Instances
                    const s = Number.isFinite(item.seriesCount) ? item.seriesCount : null;
                    const i = Number.isFinite(item.instanceCount) ? item.instanceCount : null;
                    if (s != null || i != null) addChip(`${s ?? "?"} S | ${i ?? "?"} I`);

                    // Institution / site
                    addChip(item.institution);

                    // trailing UID tail (debug)
                    addChip(item.uidTail && `…${item.uidTail}`);

                    // Tooltip with extra detail (optional)
                    const tooltip = [
                        item.referringPhysician && `Referring: ${item.referringPhysician}`,
                        item.performingPhysician && `Performing: ${item.performingPhysician}`,
                        item.bodyPartExamined && `Body Part: ${item.bodyPartExamined}`,
                        item.requestedProcedureDescription && `Requested: ${item.requestedProcedureDescription}`,
                        item.reasonForPerformedProcedure && `Reason: ${item.reasonForPerformedProcedure}`,
                        item.comments && `Comments: ${String(item.comments).slice(0, 256)}${String(item.comments).length > 256 ? "…" : ""}`,
                    ].filter(Boolean).join("\n");

                    return div(
                        {
                            class: "flex items-start justify-between px-2 py-2 hover:bg-base-200 cursor-pointer width-full",
                            title: tooltip || undefined
                        },
                        // left: small icon + title/date
                        div({ class: "flex items-start gap-2 min-w-0" },
                            span({ class: "fa-auto fa-flask shrink-0" }),
                            div({ class: "flex flex-col min-w-0" },
                                div({ class: "text-sm font-medium truncate" }, title),
                                when ? div({ class: "text-xs text-base-content/70 truncate" }, when) : null
                            )
                        ),
                        // right: chips
                        div({ class: "flex items-center gap-1 flex-wrap justify-end pl-2" }, ...chips)
                    );
                },
                canOpen: (img) => true,
                onClick: (item) => {
                    this.state.activeStudy = item.studyUID;
                },
            };

            const imagesLevel = {
                id: "images",
                title: "Images",
                mode: "virtual",
                pageSize: 20,
                getChildren: async (seriesOrStudy, ctx) => {
                    // If your UI opens images per *series*, supply series + study UIDs here.
                    const studyUID = seriesOrStudy.studyUID || seriesOrStudy.StudyInstanceUID;

                    const series = await this.listSeriesForStudy(this._client, studyUID, { limit: ctx.pageSize, offset: ctx.pageSize * ctx.page });
                    const data = {
                        total: 0,
                        items: [],
                    };

                    for (const s of series.items) {
                        // Pass parsed series metadata so the label builder can
                        // produce a human-friendly title (description / modality
                        // / body-part / series number) instead of a bare UID.
                        const wsiInstances = await DicomTools.findWSIItems(this._client, studyUID, s.seriesUID, {
                            seriesMeta: {
                                description: s.description,
                                modality: s.modality,
                                bodyPart: s.bodyPart,
                                seriesNumber: s.number,
                            },
                        });
                        data.items.push(...wsiInstances);
                    }
                    data.total = data.items.length;
                    return data;
                },
                canOpen: (img) => false,
                onClick: (img) => {
                    try {
                        const seriesUID = img.seriesUID;
                        const studyUID  = img.studyUID || this.state.activeStudy;
                        if (!seriesUID || !studyUID) {
                            Dialogs.show('Could not open the image: missing study identification!', 5000, Dialogs.MSG_ERR);
                            console.error("Missing seriesUID or studyUID for image:", img);
                            return;
                        }
                        // todo somehow prevent opening the item -> this is not supported in the slide switcher
                        //   maybe consider using onOpen to create the standalone bg conf

                        // store current active series
                        this.state.activeSeries = seriesUID;
                        this.state.activeStudy  = studyUID;
                    } catch (err) {
                        console.error("Failed to open WSI viewer:", err);
                    }
                }
            };

            // If /patients is not supported, you can:
            //  - drop the Patients level and start from Studies (requiring a PatientID input), or
            //  - keep Patients but present the derived list (already handled in listPatientsPaged()).
            const levels = patientsSupported ? [{
                id: "patients",
                title: "Patients",
                mode: "page",
                pageSize: 20,
                getChildren: async (_parent, ctx) => {
                    const res = await this.listPatientsPaged(this._client, { limit: ctx.pageSize, offset: ctx.pageSize * ctx.page });
                    // Show a gentle warning if we got no rows (either truly empty or server doesn’t give totals)
                    if ((res.total === 0) || (res.items.length === 0 && ctx.page === 0)) {
                        info.warn?.("No patients found (server may not support /patients; showing derived view if possible).");
                    }
                    for (let item of res.items) {
                        item.label = item.name || item.PatientName || item.patientID;
                    }
                    return { total: res.total, items: res.items };
                },
                canOpen: () => true,
            }, studiesLevel, imagesLevel] : [studiesLevel, imagesLevel];
            info.setCustomBrowser({ id: "dicom-browser", levels, customItemToBackground: (item) => {
                    const seriesUID = item.seriesUID;
                    const studyUID  = item.studyUID || this.state.activeStudy;
                    // Use the grouped WSI label (built by DicomTools.groupSeriesInstances
                    // from container / description / dims / modality) as the display
                    // name. Without this `name`, UTILITIES.nameFromBGOrIndex falls back
                    // to the raw series UID — which is what the user saw in the slide
                    // switcher cards.
                    const tail = seriesUID ? seriesUID.slice(-6) : "";
                    const name = item.label || (tail ? `Series …${tail}` : "DICOM slide");
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
                }
            });
        });

        this.integrateWithSingletonModule('annotations', async () => {
            // The DICOM SR sink was registered up-front in the constructor (so
            // the annotations module's initIO sees the binding when it
            // resolves them). All we need here is the convertor — its
            // `OSDAnnotations.Convertor.register("dicom", …)` call must run
            // before the sink invokes `encodePartial` / `encodeFinalize` /
            // `decode`. Gating it on annotations being ready keeps the
            // dependency direction sane (DICOM uses annotations' convertor
            // registry, not the other way round).
            await import('./annotation-convertor.mjs');
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
        const fallback = tail ? `Series …${tail}` : "DICOM slide";
        if (!meta) return fallback;
        const desc = typeof meta.description === "string" ? meta.description.trim() : "";
        if (desc) {
            const suffix = meta.bodyPart ? ` (${meta.bodyPart})` : "";
            return `${desc}${suffix}`;
        }
        if (meta.seriesNumber != null) return `Series #${meta.seriesNumber} …${tail}`;
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
    _registerDicomSrSink() {
        const plugin = this;

        // Resolve the slide context for an IO call. DICOM SR is only meaningful
        // when the viewer's tile source carries DICOM metadata; non-DICOM
        // slides return null so the sink can decline gracefully.
        const resolveSlide = (ctx) => {
            const viewer = ctx.viewerId
                ? VIEWER_MANAGER.getViewer(ctx.viewerId, false)
                : undefined;
            const tiledImage = viewer?.scalebar?.getReferencedTiledImage?.();
            const meta = tiledImage?.source?.getMetadata?.()?.imageInfo;
            if (!meta?.frameOfReferenceUID) return null;
            return { viewer, meta: { ...meta, patient: plugin.state.activePatientDetails } };
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
                    if (!conversion.objects?.length) return { ok: true };
                    const buffer = OSDAnnotations.Convertor.encodeFinalize('dicom', conversion);
                    await DicomTools.stow(plugin._client, slide.meta.studyUID, buffer);
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

    async _supportsPatients(client) {
        // Deployment opt-out: declare `supportsPatients: false` (or true) in
        // include.json to skip the runtime probe. The probe hits /patients on
        // servers that don't implement it (e.g. GCS Healthcare) and produces a
        // loud CORS error in the console even though the JS catch swallows it.
        const explicit = this.getStaticMeta("supportsPatients", null);
        if (explicit !== null && explicit !== undefined) return !!explicit;
        try {
            // GCP returns 404 here; DICOMweb servers that implement /patients return 200.
            await client.fetchRaw('/patients?limit=1', { headers: { Accept: 'application/dicom+json' } });
            return true;
        } catch (e) {
            // Any HTTPError (or network error) → assume the endpoint isn't supported.
            return false;
        }
    }

    // Patients list (derived from /studies if /patients is not supported)
    async listPatientsPaged(client, { limit = 50, offset = 0 } = {}) {
        if (await this._supportsPatients(client)) {
            const path = `/patients?limit=${limit}&offset=${offset}`;
            const { rows, total } = await DicomTools.qidoSafeWithMeta(client, path, this.STUDY_PROJECTION);
            const items = rows.map(ds => this.parsePatient(ds));
            return { items, total, level: 'patients' };
        } else {
            // Derive unique PatientIDs from /studies page
            const path = `/studies?limit=${limit}&offset=${offset}`;
            const { rows, total } = await DicomTools.qidoSafeWithMeta(client, path, this.STUDY_PROJECTION);
            const seen = new Map();
            for (const r of rows) {
                const p = this.parsePatient(r);
                if (p.patientID && !seen.has(p.patientID)) seen.set(p.patientID, p);
            }
            const items = Array.from(seen.values());
            // total here is studies-total (not distinct patients). We still return it for UI pagination hints.
            return { items, total, level: 'patients-derived' };
        }
    }

    async listStudiesForPatient(client, patientID, { limit = 50, offset = 0 } = {}) {
        const path = `/studies?PatientID=${encodeURIComponent(patientID)}&limit=${limit}&offset=${offset}`;
        const { rows, total } = await DicomTools.qidoSafeWithMeta(client, path, '0020000D,00080020,00081030,00100020');
        const items = rows.map(ds => this.parseStudy(ds));
        return { items, total, level: 'studies' };
    }

    async listStudiesPagedAll(client, { limit = 50, offset = 0, filters = {} } = {}) {
        const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        if (filters.StudyDate) params.set('StudyDate', filters.StudyDate);     // e.g. 20240101-20241231
        if (filters.PatientName) params.set('PatientName', filters.PatientName);
        if (filters.AccessionNumber) params.set('AccessionNumber', filters.AccessionNumber);
        if (filters.Modality) params.set('Modality', filters.Modality);

        const path = `/studies?${params}`;
        const { rows, total } = await DicomTools.qidoSafeWithMeta(client, path,
            '0020000D,00080020,00081030,00100020'); // StudyUID, StudyDate, StudyDesc, PatientID

        const items = rows.map(ds => this.parseStudy(ds));
        return { items, total, level: 'studies' };
    }

    async listSeriesForStudy(client, studyUID, { limit = 50, offset = 0 } = {}) {
        const path = `/studies/${encodeURIComponent(studyUID)}/series?limit=${limit}&offset=${offset}`;
        const { rows, total } = await DicomTools.qidoSafeWithMeta(client, path, '0020000E,00080060,0008103E,00201209');
        const items = rows.map(ds => this.parseSeries(ds));
        return { items, total, level: 'series' };
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

    // If you only know Series UID, discover its Study UID (QIDO /series?SeriesInstanceUID=)
    async lookupStudyForSeries(client, seriesUID) {
        // Avoid includefield to support servers that don't allow it here (e.g., GCP)
        const path = `/series?SeriesInstanceUID=${encodeURIComponent(seriesUID)}`;
        const arr = await DicomTools.qido(client, path);
        const row = arr?.[0];
        if (!row) return null;
        return { studyUID: DicomTools.v(row, '0020000D'), seriesUID: DicomTools.v(row, '0020000E') };
    }

    async seriesConfigForStudy(client, studyUID) {
        const path = `/studies/${encodeURIComponent(studyUID)}/series`;
        // Pull SeriesDescription / SeriesNumber / BodyPart so the boot path
        // can build a friendly `name` instead of the raw series UID.
        const json = await DicomTools.qidoSafe(client, path, '0020000D,0020000E,00080060,0008103E,00200011,00180015');

        return (json || [])
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
    }

    // Return studies + series for a patient
    async seriesForPatient(client, patientID, { limit = 50, offset = 0 } = {}) {
        const path = `/studies?PatientID=${encodeURIComponent(patientID)}&limit=${limit}&offset=${offset}`;
        const rows = await DicomTools.qidoSafe(client, path, '0020000D,00080020,00081030,00100020');
        const studies = (rows || []).map(ds => this.parseStudy(ds));
        return { studies };
    }

    async populateStudyDetails(studyUID) {
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
