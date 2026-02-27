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

        this.lastSopInstanceUID = null;

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
        VIEWER_MANAGER.addHandler('before-first-open', async (evt) => {
            const token = XOpatUser.instance().getSecret();

            // todo test throw here, not stable

            const hasSeries = !!this.defaultSeries;
            const hasStudy  = !!this.defaultStudy;
            const hasPatient= !!this.defaultPatient;

            // Normalize starting point: if only Series is provided but no Study, look up its Study
            if (hasSeries && !hasStudy) {
                try {
                    const lookup = await this.lookupStudyForSeries(this.serviceUrl, this.defaultSeries, token);
                    if (lookup?.studyUID) this.defaultStudy = lookup.studyUID;
                } catch (e) {
                    console.warn('Series->Study lookup failed:', e);
                }
            }

            evt.visualizations = null;

            // TODO: if we have existing session data setup, we should skip overriding with default
            if (hasSeries) {
                // Open this single series immediately.
                // Build foreground data; no background needed (unless you want siblings too)
                const cfg = [{ studyUID: this.defaultStudy, seriesUID: this.defaultSeries }];
                evt.data = cfg;
                evt.background = [{
                    dataReference: 0,
                    id: this.defaultSeries,
                    name: this.defaultSeries
                }];
                // todo remove acive series, can be mutlitple
                this.state.activeSeries = this.defaultSeries;
                this.state.activeStudy  = this.defaultStudy || null;
                // Fetch and cache active patient/study details
                if (this.state.activeStudy) {
                    await this.populateStudyDetails(this.state.activeStudy, token);
                }
                await this.ensurePatientForCurrentStudy(token);
            } else if (hasStudy) {
                // Prepare all series from the study as background items (do not open a UI yet)
                const cfg = await this.seriesConfigForStudy(this.serviceUrl, this.defaultStudy, token);
                evt.data = cfg;
                evt.background = cfg.map((x, i) => ({
                    dataReference: i,
                    id: x.seriesUID,
                    name: x.seriesUID
                }));
                this.state.activeStudy = this.defaultStudy;
                await this.populateStudyDetails(this.state.activeStudy, token);
                await this.ensurePatientForCurrentStudy(token);
            } else if (hasPatient) {
                // Fetch all series of the patient, *but do NOT issue background config*
                const { studies, seriesByStudy } = await this.seriesForPatient(this.serviceUrl, this.defaultPatient, token);
                // Cache into state for later UI use
                this.state.activePatient = this.defaultPatient;
                this.state.patients = await this.materializePatientsFromStudies(studies, token);
                this.state.studiesByPatient.set(this.defaultPatient, studies);
                for (const [studyUID, seriesArr] of seriesByStudy.entries()) {
                    this.state.seriesByStudy.set(studyUID, seriesArr);
                }
                // Populate details for the most relevant study (first one)
                if (studies.length) {
                    this.state.activeStudy = studies[0].studyUID;
                    await this.populateStudyDetails(this.state.activeStudy, token);
                }
                await this.populatePatientDetails(this.defaultPatient, token);
                // do NOT wipe the config, keep it remember old session
            } else {
                // Nothing given: no prefetch. UI will call the lazy loaders below.
                this.state.patients = [];
                // do NOT wipe the config, keep it remember old session
            }
        }, null, -1);

        VIEWER_MANAGER.addHandler('before-open', (evt) => {
            for (let i = 0; i < (evt.background || []).length; i++) {
                let bg = evt.background[i];

                const dataRef = bg.dataReferences ? bg.dataReferences[0] : bg.dataReference;
                const data = evt.data?.[dataRef] || dataRef;

                if (typeof data === "object" && data.studyUID && data.seriesUID) {
                    evt.data[dataRef] = {
                        dataID: data,
                        tileSource: new DICOMWebTileSource({
                            baseUrl: this.serviceUrl,
                            studyUID: data.studyUID,
                            seriesUID: data.seriesUID,
                            useRendered: this.useRendered,
                            patientDetails: this.state.activePatientDetails,
                            ...this.frameOrder
                        })
                    }

                    // Keep identity stable and aligned with the browser:
                    bg.id = bg.id || data.seriesUID;
                    bg.name = bg.name || data.seriesUID;
                }

                // Ensure BackgroundConfig instance
                evt.background[i] = window.APPLICATION_CONTEXT.registerConfig(bg);
            }
        });

        this.integrateWithPlugin('slide-info', async info => {
            const {span, div} = vanjs.tags;

            // await will let the viewer potentially open, prevent the default behavior to kick in
            info.setWillInitCustomBrowser();

            const patientsSupported = await this._supportsPatients(this.serviceUrl, XOpatUser.instance().getSecret());

            const studiesLevel = {
                id: "studies",
                title: "Studies",
                mode: "page",
                pageSize: 20,
                getChildren: async (patient, ctx) => {
                    const pid = patient?.patientID || patient?.PatientID;
                    const res = pid ?
                        await this.listStudiesForPatient(this.serviceUrl, XOpatUser.instance().getSecret(), pid, { limit: ctx.pageSize, offset: ctx.pageSize * ctx.page }) :
                        await this.listStudiesPagedAll(this.serviceUrl, XOpatUser.instance().getSecret(), { limit: ctx.pageSize, offset: ctx.pageSize * ctx.page });
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

                    const series = await this.listSeriesForStudy(this.serviceUrl, XOpatUser.instance().getSecret(), studyUID, { limit: ctx.pageSize, offset: ctx.pageSize * ctx.page });
                    const data = {
                        total: 0,
                        items: [],
                    };

                    for (const s of series.items) {
                        const wsiInstances = await DicomTools.findWSIItems(this.serviceUrl, XOpatUser.instance().getSecret(), studyUID, s.seriesUID);
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
                    const res = await this.listPatientsPaged(this.serviceUrl, XOpatUser.instance().getSecret(), { limit: ctx.pageSize, offset: ctx.pageSize * ctx.page });
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
                    // We need to construct tile source manually -> use DataOverride type to pass overload data initialization
                    return { id: seriesUID, dataReference: {
                        dataID: {studyUID, seriesUID}, tileSource: new DICOMWebTileSource({
                            baseUrl: this.serviceUrl,
                            studyUID,
                            seriesUID,
                            useRendered: this.useRendered,
                            patientDetails: this.state.activePatientDetails,
                            ...this.frameOrder
                        })}
                    };
                }, backgroundToCustomItem: (bgConfig) => {
                    // TODO: this is only partial revival of the original item, you can add more properties here
                    const data = BackgroundConfig.data(bgConfig);
                    return { seriesUID: data[0].seriesUID, studyUID: data[0].studyUID };
                }
            });
        });

        this.integrateWithSingletonModule('annotations', async (module) => {
            import('./annotation-convertor.mjs');

            module.addHandler("save-annotations", async (e) => {
                const token = XOpatUser.instance().getSecret();

                // IMPORTANT: use the annotations module viewer, not global VIEWER
                const viewer = module.viewer; // <- tracked active viewer inside OSDAnnotations
                const tiledImage = viewer?.scalebar?.getReferencedTiledImage?.();

                if (!tiledImage?.source || typeof tiledImage.source.getMetadata !== "function") {
                    Dialogs.show("Cannot save: No active DICOM slide found.", 5000, Dialogs.MSG_ERR);
                    return;
                }

                const meta = tiledImage.source.getMetadata().imageInfo;
                if (!meta.micronsX || !meta.frameOfReferenceUID) {
                    Dialogs.show("Cannot save: Missing PixelSpacing or FrameOfReferenceUID.", 5000, Dialogs.MSG_ERR);
                    return;
                }

                meta.patient = this.state.activePatientDetails;

                try {
                    const exportOptions = { format: "dicom", serialize: false, meta };
                    const conversion = await OSDAnnotations.Convertor.encodePartial(exportOptions, module.fabric);

                    if (!conversion.objects?.length) return;

                    const dicomBuffer = OSDAnnotations.Convertor.encodeFinalize("dicom", conversion);

                    const response = await DicomTools.stow(this.serviceUrl, token, meta.studyUID, dicomBuffer);
                    console.log("STOW Response:", response);

                    e.setHandled("Annotations saved successfully.");
                } catch (ex) {
                    console.error("DICOM Save Failed:", ex);
                }
            });

            VIEWER_MANAGER.broadcastHandler("open", async (e) => {
                const viewer = e.eventSource;          // <-- the viewer that just opened something
                    // viewer-specific slide metadata (do NOT use global VIEWER)
                const tiledImage = viewer.scalebar?.getReferencedTiledImage?.();
                if (!tiledImage?.source?.getMetadata) return;

                const meta = tiledImage.source.getMetadata().imageInfo;
                meta.patient = this.state.activePatientDetails;

                // Clear existing objects for that viewer before loading
                await module.fabric.loadObjects({ objects: [] }, true);

                const token = XOpatUser.instance().getSecret();

                // IMPORTANT: do not use study-only search; filter at least by seriesUID
                const latestSOP = await DicomTools.findLatestAnnotation(
                    this.serviceUrl, token, meta.studyUID, meta.seriesUID, meta.frameOfReferenceUID
                );

                if (!latestSOP) return;

                const url = `${this.serviceUrl}/studies/${meta.studyUID}/series/${latestSOP.seriesUID}/instances/${latestSOP.sopUID}`;
                const res = await fetch(url, {
                    headers: { Accept: "application/dicom", Authorization: `Bearer ${token}` },
                });
                const buffer = await res.arrayBuffer();

                const imported = await OSDAnnotations.Convertor.decode({ format: "dicom", meta }, buffer, module.fabric);
                if (imported?.objects?.length) {
                    await module.fabric.loadObjects(imported, true);
                }
            });

        })
    }

    async _supportsPatients(serviceUrl, authToken) {
        try {
            const url = new URL(`${serviceUrl}/patients`);
            url.searchParams.set('limit', '1');
            const res = await fetch(url.toString(), {
                headers: { Accept: 'application/dicom+json', ...(authToken ? { Authorization:  authToken } : {}) }
            });
            // GCP will 404/400 here; DICOMweb servers that implement /patients should 200
            return res.ok;
        } catch {
            return false;
        }
    }

    // Patients list (derived from /studies if /patients is not supported)
    async listPatientsPaged(serviceUrl, authToken, { limit = 50, offset = 0 } = {}) {
        if (await this._supportsPatients(serviceUrl, authToken)) {
            const base = `${serviceUrl}/patients?limit=${limit}&offset=${offset}`;
            const { rows, total } = await DicomTools.qidoSafeWithMeta(base, authToken, this.STUDY_PROJECTION);
            const items = rows.map(ds => this.parsePatient(ds));
            return { items, total, level: 'patients' };
        } else {
            // Derive unique PatientIDs from /studies page
            const base = `${serviceUrl}/studies?limit=${limit}&offset=${offset}`;
            const { rows, total } = await DicomTools.qidoSafeWithMeta(base, authToken, this.STUDY_PROJECTION);
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

    async listStudiesForPatient(serviceUrl, authToken, patientID, { limit = 50, offset = 0 } = {}) {
        const base = `${serviceUrl}/studies?PatientID=${encodeURIComponent(patientID)}&limit=${limit}&offset=${offset}`;
        const { rows, total } = await DicomTools.qidoSafeWithMeta(base, authToken, '0020000D,00080020,00081030,00100020');
        const items = rows.map(ds => this.parseStudy(ds));
        return { items, total, level: 'studies' };
    }

    async listStudiesPagedAll(serviceUrl, authToken, { limit = 50, offset = 0, filters = {} } = {}) {
        const url = new URL(`${serviceUrl}/studies`);
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('offset', String(offset));
        url.searchParams.set('offset', String(offset));

        // Optional filters you pass from UI (any QIDO matching keys)
        if (filters.StudyDate) url.searchParams.set('StudyDate', filters.StudyDate);     // e.g. 20240101-20241231
        if (filters.PatientName) url.searchParams.set('PatientName', filters.PatientName);
        if (filters.AccessionNumber) url.searchParams.set('AccessionNumber', filters.AccessionNumber);
        if (filters.Modality) url.searchParams.set('Modality', filters.Modality);

        const { rows, total } = await DicomTools.qidoSafeWithMeta(url.toString(), authToken,
            '0020000D,00080020,00081030,00100020'); // StudyUID, StudyDate, StudyDesc, PatientID

        const items = rows.map(ds => this.parseStudy(ds));
        return { items, total, level: 'studies' };
    }

    async listSeriesForStudy(serviceUrl, authToken, studyUID, { limit = 50, offset = 0 } = {}) {
        const base = `${serviceUrl}/studies/${encodeURIComponent(studyUID)}/series?limit=${limit}&offset=${offset}`;
        const { rows, total } = await DicomTools.qidoSafeWithMeta(base, authToken, '0020000E,00080060,0008103E,00201209');
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
    async lookupStudyForSeries(serviceUrl, seriesUID, authToken) {
        const url = new URL(`${serviceUrl}/series`);
        url.searchParams.set('SeriesInstanceUID', seriesUID);
        // Avoid includefield to support servers that don't allow it here (e.g., GCP)
        const arr = await DicomTools.qido(url, authToken);
        const row = arr?.[0];
        if (!row) return null;
        return { studyUID: DicomTools.v(row, '0020000D'), seriesUID: DicomTools.v(row, '0020000E') };
    }

    async seriesConfigForStudy(serviceUrl, studyUID, authToken) {
        const base = `${serviceUrl}/studies/${encodeURIComponent(studyUID)}/series`;
        const json = await DicomTools.qidoSafe(base, authToken, '0020000D,0020000E,00080060');

        return json
            .filter(ds => {
                const mod = DicomTools.v(ds, '00080060');
                // filter out non-image types like Key Objects (KO) or Presentation States (PR)
                return mod !== 'SR' && mod !== 'KO' && mod !== 'PR' && mod !== 'SEG' && mod !== 'RTSTRUCT';
            })
            .map(ds => ({ studyUID: DicomTools.v(ds, '0020000D') || studyUID, seriesUID: DicomTools.v(ds, '0020000E') }))
            .filter(x => x.seriesUID);
    }

    // Return studies + series for a patient
    async seriesForPatient(serviceUrl, patientID, authToken, { limit = 50, offset = 0 } = {}) {
        const base = `${serviceUrl}/studies?PatientID=${encodeURIComponent(patientID)}&limit=${limit}&offset=${offset}`;
        const rows = await DicomTools.qidoSafe(base, authToken, '0020000D,00080020,00081030,00100020');
        const studies = rows.map(ds => this.parseStudy(ds));
        return { studies };
    }

    async populateStudyDetails(studyUID, authToken) {
        // Use WADO-RS metadata endpoint instead of QIDO with includefield — works on GCP
        const meta = await DicomTools.wadoMetadata(`${this.serviceUrl}/studies/${encodeURIComponent(studyUID)}/metadata`, authToken);
        const row = meta?.[0];
        if (row) {
            this.state.activeStudyDetails = this.parseStudy(row);
            const p = this.parsePatient(row);
            if (p.patientID) this.state.activePatientDetails = p;
        }
    }

    async populatePatientDetails(patientID, authToken) {
        // GCP Healthcare API does not expose /patients; derive from first study
        const sBase = `${this.serviceUrl}/studies?PatientID=${encodeURIComponent(patientID)}`;
        const rows = await DicomTools.qidoSafe(sBase, authToken, '00100020,00100010,00100030,00100040');
        const row = rows?.[0];
        if (row) this.state.activePatientDetails = this.parsePatient(row);
    }

    async ensurePatientForCurrentStudy(authToken) {
        if (!this.state.activeStudy) return;
        // If we already have patient details, done
        if (this.state.activePatientDetails?.patientID) return;
        // Query study to obtain patient info
        await this.populateStudyDetails(this.state.activeStudy, authToken);
    }

    async materializePatientsFromStudies(studies, authToken) {
        // Try to build unique patient list from study metadata
        const byID = new Map();
        for (const st of studies) {
            if (st.patientID && !byID.has(st.patientID)) {
                // Try enrich from patient endpoint
                let details = null;
                try {
                    await this.populatePatientDetails(st.patientID, authToken);
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
