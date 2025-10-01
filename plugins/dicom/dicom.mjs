import { DICOMWebTileSource } from "./tileSource.mjs";

/*
  DICOM plugin: unified workflow for Patient/Study/Series selection

  Behaviour requested:
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
                // Nothing given: fetch all patients (or derive from studies). No background yet.
                const patients = await this.fetchAllPatientsOrDerive(this.serviceUrl, token);
                this.state.patients = patients;
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
        const json = await this.qidoSafe(base, authToken, '0020000D,0020000E');
        return json
            .map(ds => ({ studyUID: v(ds, '0020000D') || studyUID, seriesUID: v(ds, '0020000E') }))
            .filter(x => x.seriesUID);
    }

    // Return studies + series for a patient
    async seriesForPatient(serviceUrl, patientID, authToken) {
        const sBase = `${serviceUrl}/studies?PatientID=${encodeURIComponent(patientID)}`;
        const studyRows = await this.qidoSafe(sBase, authToken, '0020000D,00080020,00080030,00081030,00080050,00080090,00100020');
        const studies = studyRows.map(ds => this.parseStudy(ds));

        const seriesByStudy = new Map();
        for (const st of studies) {
            const base = `${serviceUrl}/studies/${encodeURIComponent(st.studyUID)}/series`;
            const rows = await this.qidoSafe(base, authToken, '0020000D,0020000E,00200011,0008103E,00080060,00180015,00201209');
            const series = rows.map(ds => this.parseSeries(ds));
            seriesByStudy.set(st.studyUID, series);
        }
        return { studies, seriesByStudy };
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
