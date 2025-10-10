import { DICOMWebTileSource } from "./tileSource.mjs";
import vanjs from "../../ui/vanjs.mjs";

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

        /**
         * Helper to extract DICOM JSON tag values.
         */
        const v = (ds, tag) => {
            const x = ds?.[tag]?.Value;
            return Array.isArray(x) ? x[0] : (x ?? null);
        };

        this._v = v; // keep for reuse in instance methods

        // === PRE-OPEN LOGIC ===
        // We decide what to fetch/prepare *before first open* based on provided defaults.
        VIEWER_MANAGER.addHandler('before-first-open', async (evt) => {
            const token = XOpatUser.instance().getSecret();

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

            // Branch per the requested behaviour
            if (hasSeries) {
                // Open this single series immediately.
                // Build foreground data; no background needed (unless you want siblings too)
                const cfg = [{ studyUID: this.defaultStudy, seriesUID: this.defaultSeries }];
                evt.data = cfg;
                evt.background = [{ dataReference: 0 }];
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
                evt.background = cfg.map((x, i) => ({ dataReference: i }));
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
                // Nothing issued as background yet
                evt.data = [];
                evt.background = [];
            } else {
                // Nothing given: no prefetch. UI will call the lazy loaders below.
                this.state.patients = [];
                // Leave everything else empty for now; UI will subsequently pick a patient/study/series
                evt.data = [];
                evt.background = [];
            }
        }, null, -1);

        // === RESOLVE BACKGROUND ITEMS INTO TILE SOURCES ===
        VIEWER_MANAGER.addHandler('before-open', (evt) => {
            for (const bg of evt.background || []) {
                const data = evt.data?.[bg.dataReference];
                if (typeof data === "object" && data.studyUID && data.seriesUID) {
                    bg.tileSource = new DICOMWebTileSource({
                        baseUrl: this.serviceUrl,
                        studyUID: data.studyUID,
                        seriesUID: data.seriesUID,
                        useRendered: this.useRendered,
                        patientDetails: this.state.activePatientDetails,
                    });
                    bg.name = data.seriesUID;
                }
            }
        });

        this.integrateWithPlugin('slide-info', async info => {
            const {span, div} = vanjs.tags;

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
                    return { total: res.total, items: res.items };
                },
                renderItem: (s) => div({ class: "flex items-center gap-2" },
                    span({ class: "fa-auto fa-flask" }),
                    span(s.desc || s.StudyDescription || s.studyUID)
                ),
                onOpen: (item) => {
                    this.state.activeStudy = item.studyUID;
                    return true;
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

                    // Usually one WSI per series, but if there are multiple series in a single WSI, try to detect them
                    for (const s of series.items) {
                        const instances = await this.listInstancesForSeries(this.serviceUrl, XOpatUser.instance().getSecret(), studyUID, s.seriesUID, { limit: ctx.pageSize, offset: ctx.pageSize * ctx.page });
                        const wsiInstances = this.groupSeriesInstances(instances, s);
                        data.items.push(...wsiInstances);
                    }
                    // todo preview... create one

                    data.total = data.items.length;
                    return data;
                },
                renderItem: (img) => {
                    const instanceUID = img["00080018"]?.Value?.[0] || img.SOPInstanceUID || "Unknown";
                    const seriesDesc = img["0008103E"]?.Value?.[0] || img.SeriesDescription || "";
                    const modality   = img["00080060"]?.Value?.[0] || img.Modality || "";
                    return div({ class: "flex flex-col gap-1" },
                        span({ class: "fa-auto fa-image" }, `${seriesDesc} (${modality})`),
                        span({ class: "text-xs text-gray-500" }, `Instance: ${instanceUID.slice(-8)}`)
                    );
                },
                onOpen: (img) => {
                    try {
                        const seriesUID = img.seriesUID;
                        const studyUID  = img.studyUID || this.state.activeStudy;
                        if (!seriesUID || !studyUID) {
                            Dialogs.show('Could not open the image: missing study identification!', 5000, Dialogs.MSG_ERR);
                            console.error("Missing seriesUID or studyUID for image:", img);
                            return false;
                        }

                        // Use your plugin's method or APPLICATION_CONTEXT to open the WSI viewer
                        // Example using DICOMWebTileSource:
                        const tileSource = new DICOMWebTileSource({
                            baseUrl: this.serviceUrl,
                            studyUID,
                            seriesUID,
                            useRendered: this.useRendered,
                            patientDetails: this.state.activePatientDetails,
                        });
                        APPLICATION_CONTEXT.openViewerWith([{ studyUID, seriesUID }], [{ tileSource, dataReference: [0] }]);

                        // store current active series
                        this.state.activeSeries = seriesUID;
                        this.state.activeStudy  = studyUID;
                    } catch (err) {
                        console.error("Failed to open WSI viewer:", err);
                    }
                    return false;
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
                    return { total: res.total, items: res.items };
                },
                renderItem: (p, { open }) => div({ class: "flex items-center gap-2" },
                    span({ class: "fa-auto fa-user" }),
                    span(p.name || p.PatientName || p.patientID || "Unknown")
                ),
                onOpen: () => true,
            }, studiesLevel, imagesLevel] : [studiesLevel, imagesLevel];
            info.initBrowser({ id: "dicom-browser", levels });
        });
    }

    // ────────────────────────────────────────────────────────────────────────────
    // QIDO helpers & metadata parsing
    // ────────────────────────────────────────────────────────────────────────────

    // Base QIDO fetch (kept as-is)
    async qido(url, authToken) {
        const res = await fetch(url.toString(), {
            headers: {
                Accept: 'application/dicom+json',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
            }
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`QIDO ${url.pathname} failed: ${res.status} ${text}`);
        try { return JSON.parse(text); } catch (e) { throw new Error(`Bad DICOM JSON: ${e.message} - body: ${text}`); }
    }

    // Safe QIDO wrapper: try with includefield, retry without if server rejects that param
    async qidoSafe(baseUrl, authToken, includefield) {
        const withParams = new URL(baseUrl);
        if (includefield) withParams.searchParams.set('includefield', includefield);
        try {
            return await this.qido(withParams, authToken);
        } catch (e) {
            const msg = String(e?.message || '');
            if (includefield && (msg.includes('includefield') || msg.includes('Invalid JSON payload'))) {
                const noParams = new URL(baseUrl);
                return await this.qido(noParams, authToken);
            }
            throw e;
        }
    }

    async qidoSafeWithMeta(baseUrl, authToken, includefield) {
        const make = (withFields) => {
            const u = new URL(baseUrl);
            if (withFields && includefield) u.searchParams.set('includefield', includefield);
            return u;
        };

        // First try with includefield
        let url = make(true);
        let res = await fetch(url.toString(), {
            headers: { Accept: 'application/dicom+json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }
        });
        if (!res.ok) {
            // Retry without includefield if the server rejects it (e.g., GCP)
            const msg = await res.text();
            if (includefield && (msg.includes('includefield') || msg.includes('Invalid JSON payload'))) {
                url = make(false);
                res = await fetch(url.toString(), {
                    headers: { Accept: 'application/dicom+json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }
                });
            } else {
                throw new Error(`QIDO ${url.pathname} failed: ${res.status} ${msg}`);
            }
        }
        const total = this._readTotalHeader(res.headers);
        const text = await res.text();
        let rows;
        try { rows = JSON.parse(text); } catch (e) { throw new Error(`Bad DICOM JSON: ${e.message} - body: ${text}`); }
        return { rows, total };
    }

    _readTotalHeader(h) {
        // Lower-case header names – fetch() Headers is case-insensitive
        return ['x-total-count', 'total-count', 'dicom-total', 'x-total']
            .map(k => h.get(k))
            .filter(Boolean)
            .map(x => Number(x))
            .find(n => Number.isFinite(n)) ?? null;
    }

    async _supportsPatients(serviceUrl, authToken) {
        try {
            const url = new URL(`${serviceUrl}/patients`);
            url.searchParams.set('limit', '1');
            const res = await fetch(url.toString(), {
                headers: { Accept: 'application/dicom+json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }
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
            const { rows, total } = await this.qidoSafeWithMeta(base, authToken, '00100020,00100010,00100030,00100040');
            const items = rows.map(ds => this.parsePatient(ds));
            return { items, total, nextOffset: rows.length < limit ? null : offset + limit, level: 'patients' };
        } else {
            // Derive unique PatientIDs from /studies page
            const base = `${serviceUrl}/studies?limit=${limit}&offset=${offset}`;
            const { rows, total } = await this.qidoSafeWithMeta(base, authToken, '00100020,00100010,00100030,00100040');
            const seen = new Map();
            for (const r of rows) {
                const p = this.parsePatient(r);
                if (p.patientID && !seen.has(p.patientID)) seen.set(p.patientID, p);
            }
            const items = Array.from(seen.values());
            // total here is studies-total (not distinct patients). We still return it for UI pagination hints.
            return { items, total, nextOffset: rows.length < limit ? null : offset + limit, level: 'patients-derived' };
        }
    }

    async listStudiesForPatient(serviceUrl, authToken, patientID, { limit = 50, offset = 0 } = {}) {
        const base = `${serviceUrl}/studies?PatientID=${encodeURIComponent(patientID)}&limit=${limit}&offset=${offset}`;
        const { rows, total } = await this.qidoSafeWithMeta(base, authToken, '0020000D,00080020,00081030,00100020');
        const items = rows.map(ds => this.parseStudy(ds));
        return { items, total, nextOffset: rows.length < limit ? null : offset + limit, level: 'studies' };
    }

    async listStudiesPagedAll(serviceUrl, authToken, { limit = 50, offset = 0, filters = {} } = {}) {
        const url = new URL(`${serviceUrl}/studies`);
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('offset', String(offset));

        // Optional filters you pass from UI (any QIDO matching keys)
        if (filters.StudyDate) url.searchParams.set('StudyDate', filters.StudyDate);     // e.g. 20240101-20241231
        if (filters.PatientName) url.searchParams.set('PatientName', filters.PatientName);
        if (filters.AccessionNumber) url.searchParams.set('AccessionNumber', filters.AccessionNumber);
        if (filters.Modality) url.searchParams.set('Modality', filters.Modality);

        const { rows, total } = await this.qidoSafeWithMeta(url.toString(), authToken,
            '0020000D,00080020,00081030,00100020'); // StudyUID, StudyDate, StudyDesc, PatientID

        const items = rows.map(ds => this.parseStudy(ds));
        return { items, total, nextOffset: rows.length < limit ? null : offset + limit };
    }

    async listSeriesForStudy(serviceUrl, authToken, studyUID, { limit = 50, offset = 0 } = {}) {
        const base = `${serviceUrl}/studies/${encodeURIComponent(studyUID)}/series?limit=${limit}&offset=${offset}`;
        const { rows, total } = await this.qidoSafeWithMeta(base, authToken, '0020000E,00080060,0008103E,00201209');
        const items = rows.map(ds => this.parseSeries(ds));
        return { items, total, nextOffset: rows.length < limit ? null : offset + limit, level: 'series' };
    }

    async listInstancesForSeries(serviceUrl, authToken, studyUID, seriesUID, { limit = 100, offset = 0 } = {}) {
        const base = `${serviceUrl}/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances?limit=${limit}&offset=${offset}`;
        const { rows, total } = await this.qidoSafeWithMeta(base, authToken, '00080018'); // SOPInstanceUID
        // rows are already instance objects; pass through or normalize if needed
        return { items: rows, total, nextOffset: rows.length < limit ? null : offset + limit, level: 'instances' };
    }

    isWSIInstance(ds) {
        const modality = ds["00080060"]?.Value?.[0];
        const sopClass = ds["00080016"]?.Value?.[0];
        const imageType = (ds["00080008"]?.Value || []).join("\\");

        // 1) Modality present
        if (modality === "SM") return true;

        // todo try: 1.2.840.10008.5.1.4.1.1.77 prefix for all, see https://dicom.nema.org/medical/dicom/current/output/chtml/part04/sect_b.5.html
        // 2) SOP Class UID matches known WSI SOPs
        const wsiSOPs = [
            "1.2.840.10008.5.1.4.1.1.77.1.6"
        ];
        if (wsiSOPs.includes(sopClass)) return true;

        // 3) ImageType contains WSI keyword
        if (/WSI/i.test(imageType) || /LABEL|OVERVIEW/i.test(imageType)) return true;

        return false;
    }

    // WADO-RS metadata fetch for richer details when QIDO filters are blocked
    async wadoMetadata(urlPath, authToken) {
        const url = new URL(urlPath);
        const res = await fetch(url.toString(), {
            headers: {
                Accept: 'application/dicom+json',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
            }
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`WADO ${url.pathname} failed: ${res.status} ${text}`);
        try { return JSON.parse(text); } catch (e) { throw new Error(`Bad DICOM JSON: ${e.message} - body: ${text}`); }
    }

    parsePatient(ds) {
        const v = this._v;
        const id  = v(ds, '00100020'); // PatientID
        const name= v(ds, '00100010'); // PatientName (PN)
        const sex = v(ds, '00100040'); // PatientSex
        const dob = v(ds, '00100030'); // PatientBirthDate
        return { patientID: id, name, sex, birthDate: dob };
    }

    parseStudy(ds) {
        const v = this._v;
        const studyUID = v(ds, '0020000D'); // StudyInstanceUID
        const date     = v(ds, '00080020'); // StudyDate
        const time     = v(ds, '00080030'); // StudyTime
        const desc     = v(ds, '00081030'); // StudyDescription
        const accession= v(ds, '00080050'); // AccessionNumber
        const referring= v(ds, '00080090'); // ReferringPhysicianName
        const patientID= v(ds, '00100020'); // PatientID
        return { studyUID, date, time, desc, accession, referring, patientID };
    }

    parseSeries(ds) {
        const v = this._v;
        const studyUID   = v(ds, '0020000D');
        const seriesUID  = v(ds, '0020000E');
        const number     = v(ds, '00200011'); // SeriesNumber
        const desc       = v(ds, '0008103E'); // SeriesDescription
        const modality   = v(ds, '00080060'); // Modality
        const bodyPart   = v(ds, '00180015'); // BodyPartExamined
        const instanceCt = v(ds, '00201209'); // NumberOfSeriesRelatedInstances (may be absent)
        return { studyUID, seriesUID, number, desc, modality, bodyPart, instanceCount: instanceCt };
    }

    // If you only know Series UID, discover its Study UID (QIDO /series?SeriesInstanceUID=)
    async lookupStudyForSeries(serviceUrl, seriesUID, authToken) {
        const url = new URL(`${serviceUrl}/series`);
        url.searchParams.set('SeriesInstanceUID', seriesUID);
        // Avoid includefield to support servers that don't allow it here (e.g., GCP)
        const arr = await this.qido(url, authToken);
        const row = arr?.[0];
        if (!row) return null;
        const v = this._v;
        return { studyUID: v(row, '0020000D'), seriesUID: v(row, '0020000E') };
    }

    async seriesConfigForStudy(serviceUrl, studyUID, authToken) {
        const v = this._v;
        const base = `${serviceUrl}/studies/${encodeURIComponent(studyUID)}/series`;
        const json = await this.qidoSafe(base, authToken, '0020000D,0020000E'); // minimal
        return json
            .map(ds => ({ studyUID: v(ds, '0020000D') || studyUID, seriesUID: v(ds, '0020000E') }))
            .filter(x => x.seriesUID);
    }

    // Return studies + series for a patient
    async seriesForPatient(serviceUrl, patientID, authToken, { limit = 50, offset = 0 } = {}) {
        const base = `${serviceUrl}/studies?PatientID=${encodeURIComponent(patientID)}&limit=${limit}&offset=${offset}`;
        const rows = await this.qidoSafe(base, authToken, '0020000D,00080020,00081030,00100020');
        const studies = rows.map(ds => this.parseStudy(ds));
        return { studies, nextOffset: rows.length < limit ? null : offset + limit };
    }

    async populateStudyDetails(studyUID, authToken) {
        // Use WADO-RS metadata endpoint instead of QIDO with includefield — works on GCP
        const meta = await this.wadoMetadata(`${this.serviceUrl}/studies/${encodeURIComponent(studyUID)}/metadata`, authToken);
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
        const rows = await this.qidoSafe(sBase, authToken, '00100020,00100010,00100030,00100040');
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

    groupSeriesInstances(instancesObject, seriesObject) {
        const groups = new Map();
        for (const ds of instancesObject.items) {
            if (!this.isWSIInstance(ds)) continue;

            const container = this._v(ds, "00400512") || "UNKNOWN_CONTAINER"; // ContainerIdentifier
            const pathId    = this._v(ds, "00480106") || "DEFAULT_PATH";      // OpticalPathIdentifier
            const tpmC      = this._v(ds, "00480006"); // TotalPixelMatrixColumns
            const tpmR      = this._v(ds, "00480007"); // TotalPixelMatrixRows
            const key       = `${container}|${tpmC}x${tpmR}|${pathId}`;

            if (!groups.has(key)) {
                groups.set(key, {
                    containerIdentifier: container,
                    opticalPathId: pathId,
                    totalPixelMatrix: (tpmC && tpmR) ? `${tpmC}×${tpmR}` : null,
                    label: null,
                    overview: null,
                    volume: [],
                    studyUID: seriesObject.studyUID,
                    seriesUID: seriesObject.seriesUID,
                });
            }

            const g = groups.get(key);

            const imageType = (ds?.["00080008"]?.Value || []).join("\\");  // ImageType

            if (/LABEL/i.test(imageType)) g.label = ds;
            else if (/OVERVIEW/i.test(imageType)) g.overview = ds;
            else g.volume.push(ds); // pyramid levels
        }

        return Array.from(groups.values());
    }

    async listPatients(serviceUrl, authToken, { limit = 50, offset = 0 } = {}) {
        const base = `${serviceUrl}/studies?limit=${limit}&offset=${offset}`;
        const rows = await this.qidoSafe(base, authToken, '00100020,00100010,00100030,00100040');
        const seen = new Map();
        for (const r of rows) {
            const p = this.parsePatient(r);
            if (p.patientID && !seen.has(p.patientID)) seen.set(p.patientID, p);
        }
        return { patients: Array.from(seen.values()), nextOffset: rows.length < limit ? null : offset + limit };
    }

    async studyExists(serviceUrl, studyUID, authToken) {
        const base = `${serviceUrl}/studies?StudyInstanceUID=${encodeURIComponent(studyUID)}&limit=1`;
        try {
            const rows = await this.qidoSafe(base, authToken, '0020000D');
            return Array.isArray(rows) && rows.length > 0;
        } catch (e) {
            console.warn('studyExists check failed', e);
            return false;
        }
    }

    async fetchAllPatientsOrDerive(serviceUrl, authToken) {
        // Derive patients from studies (portable across servers)
        const base = `${serviceUrl}/studies`;
        const rows = await this.qidoSafe(base, authToken, '00100020,00100010,00100030,00100040,0020000D');
        const studies = rows.map(r => this.parseStudy(r));
        const list = await this.materializePatientsFromStudies(studies, authToken);
        return list;
    }

    // Called by host when plugin is ready; keep for future UI hooks
    pluginReady() {
        // no-op for now
    }
});
