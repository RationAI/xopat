import * as cs from '@cornerstonejs/core';

import { DICOMWebTileSource } from "./tileSource.mjs";
addPlugin('dicom', class extends XOpatPlugin {
    constructor(id) { 
        super(id);

        this.serviceUrl = this.getStaticMeta('serviceUrl');
        this.defaultStudy = this.getOptionOrConfiguration('defaultStudy');

        if (this.defaultStudy) {
            VIEWER_MANAGER.addHandler('before-first-open', async e => {
                async function seriesConfigForStudy(serviceUrl, studyUID, authToken) {
                    const v = (ds, tag) => {
                        const x = ds?.[tag]?.Value;
                        return Array.isArray(x) ? x[0] : x ?? null;
                    };

                    const url = new URL(`${serviceUrl}/studies/${encodeURIComponent(studyUID)}/series`);
                    url.searchParams.set('includefield', '0020000D,0020000E'); // Study & Series UIDs only
                    const res = await fetch(url.toString(), {
                        headers: {
                            Accept: 'application/dicom+json',
                            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
                        }
                    });
                    const text = await res.text();
                    if (!res.ok) throw new Error(`QIDO failed: ${res.status} ${text}`);
                    try {
                        const json = JSON.parse(text);
                        // Map to xopat config
                        return json
                            .map(ds => ({
                                studyUID: v(ds, '0020000D') || studyUID,
                                seriesUID: v(ds, '0020000E')
                            }))
                            .filter(x => x.seriesUID); // keep only valid rows
                    } catch (e) {
                        throw new Error(`Failed to parse QIDO response: ${e.message} - used ${text}`);
                    }
                }

                const token = XOpatUser.instance().getSecret();
                const cfg = await seriesConfigForStudy(this.serviceUrl, this.defaultStudy, token);
                e.data = cfg;
                // will configure later at 'before-open'
                e.background = cfg.map((x, i) => ({dataReference: i}));
            }, null, -1);
        }


        VIEWER_MANAGER.addHandler('before-open', e => {
            // todo not supported for viz -> create a generic background & viz resolution strategy we can route into
            for (let bg of e.background) {
                const data = e.data[bg.dataReference];

                if (typeof data === "object" && (data.studyUID && data.seriesUID)) {
                    bg.tileSource = new DICOMWebTileSource({
                        baseUrl: this.serviceUrl,
                        studyUID: data.studyUID,
                        seriesUID: data.seriesUID,
                        useRendered: this.getOption("useRendered", false),
                    });
                    bg.name = data.seriesUID;
                }
            }
        });
    }
      
    pluginReady() {

    }

    // todo studies...
    async buildXopatBackgroundConfig(serviceUrl, authToken) {
        const v = (ds, tag) => {
            const x = ds?.[tag]?.Value;
            return Array.isArray(x) ? x[0] : x ?? null;
        };
        // 1) Get all studies (request only what we need)
        const studiesURL = new URL(`${serviceUrl}/studies`);
        // just the StudyInstanceUID
        studiesURL.searchParams.set('includefield', '0020000D'); // StudyInstanceUID
        // studiesURL.searchParams.set('limit', '200'); // uncomment if your server supports it

        const studiesRes = await fetch(studiesURL.toString(), {
            headers: {
                Accept: 'application/dicom+json',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
            }
        });
        if (!studiesRes.ok) throw new Error(`QIDO /studies failed: ${studiesRes.status} ${await studiesRes.text()}`);
        const studies = await studiesRes.json(); // array of DICOM JSON datasets

        const out = [];
        // 2) For each study, fetch its series and push {studyUID, seriesUID}
        for (const s of studies) {
            const studyUID = v(s, '0020000D'); // StudyInstanceUID
            if (!studyUID) continue;

            const seriesURL = new URL(`${serviceUrl}/studies/${encodeURIComponent(studyUID)}/series`);
            // just the SeriesInstanceUID (and StudyInstanceUID for safety)
            seriesURL.searchParams.set('includefield', '0020000D,0020000E'); // StudyInstanceUID, SeriesInstanceUID
            // seriesURL.searchParams.set('limit', '500');

            const seriesRes = await fetch(seriesURL.toString(), {
                headers: {
                    Accept: 'application/dicom+json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
                }
            });
            if (!seriesRes.ok) {
                // Skip this study but keep going
                console.warn(`QIDO /series failed for ${studyUID}: ${seriesRes.status} ${await seriesRes.text()}`);
                continue;
            }
            const seriesArr = await seriesRes.json();

            for (const se of seriesArr) {
                const seriesUID = v(se, '0020000E'); // SeriesInstanceUID
                if (!seriesUID) continue;
                out.push({ studyUID, seriesUID });
            }
        }

        // De-dupe (some servers can return duplicates if mirrored)
        const seen = new Set();
        const uniq = out.filter(({ studyUID, seriesUID }) => {
            const key = `${studyUID}::${seriesUID}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        return uniq; // -> [{studyUID, seriesUID}, ...]
    }
});