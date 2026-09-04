import vanjs from "../../ui/vanjs.mjs";

/*
  DICOM Browser — the application half of the DICOM integration.

  The `dicom` plugin is a protocol: it renders exactly what a session declares
  and nothing more. This plugin is what makes a DICOMweb store *browsable*:

  - a Patients -> Studies -> Images explorer inside the slide switcher,
  - boot-time defaults (`studyUID` / `seriesUID` / `patientUID`), which seed
    `evt.background` before the first open,
  - automatic discovery of SEG / Parametric Map overlays for whichever slide is
    opened — the thing a session can also request explicitly, per background,
    with `dataID.derived`.

  Everything here is opinionated about what the viewer should show, which is
  precisely why it is a separate plugin: a deployment that wants the viewer to
  be a standalone rendering surface for externally-supplied configuration simply
  does not load it.

  ## Coupling

  Cross-plugin ES imports are forbidden (AGENTS.md §0.5), so this plugin reaches
  the protocol through `plugin('dicom')` and its read-only query API
  (`listStudies`, `shallowWsiItemsForStudy`, `makeDataReference`,
  `buildCaseSession`, `describeDerived`, …). Nothing under `plugins/dicom/` is
  imported. When that plugin is absent this one warns once and stays inert.
*/

addPlugin('dicom-browser', class extends XOpatPlugin {
    constructor(id) {
        super(id);

        this._localeReady = this.loadLocale().catch(() =>
            this.loadLocale('en').catch(e => console.warn("dicom-browser: failed to load locale", e)));

        this.defaultPatient = this._legacyMeta('patientUID');
        this.defaultStudy = this._legacyMeta('studyUID');
        this.defaultSeries = this._legacyMeta('seriesUID');

        /**
         * Browsing selection — genuinely UI state, and the reason it lives here
         * rather than on the protocol plugin. The protocol keeps only the
         * metadata it needs to construct a TileSource.
         */
        this.state = {
            patients: [],                // [{ patientID, name, sex, birthDate }]
            studiesByPatient: new Map(), // patientID -> [study]
            activePatient: null,
            activeStudy: null,
            activeSeries: null,
        };

        // Attach SEG / Parametric Map overlays to whichever slide is opened —
        // at boot and on every runtime slide switch alike. This is the
        // *automatic* half; a session can always name them explicitly through
        // `dataID.derived`, which needs neither this plugin nor this handler.
        this._registerOverlayAttachment();

        // Decide what to fetch/prepare *before first open* from the configured
        // defaults. Registered unconditionally (the event fires early, before
        // `plugin-loaded` callbacks are guaranteed to have run) and resolves the
        // protocol lazily inside the handler.
        VIEWER_MANAGER.addHandler('before-app-init', (evt) => this._seedBackgrounds(evt), null, -1);

        this.integrateWithPlugin('slide-info', info => this._installBrowser(info));
    }

    /**
     * The protocol plugin, or null.
     *
     * `plugin(id)` returns the instance as soon as `addPlugin` has run — which
     * for two plugins loaded in the same phase is before any lifecycle event —
     * so this needs no readiness gate. It warns once rather than throwing:
     * a missing protocol should leave the viewer working, just not browsable.
     */
    get dicom() {
        const api = plugin('dicom');
        if (!api && !this._warnedMissing) {
            this._warnedMissing = true;
            console.warn("[dicom-browser] the 'dicom' plugin is not loaded; DICOM browsing is unavailable.");
        }
        return api || null;
    }

    /**
     * Read a key that used to live on `plugins.dicom.*`.
     *
     * These moved here when the plugin was split. Deployments are not going to
     * migrate their env.json on the same day, and a default that silently stops
     * opening anything is the worst possible failure — so the old location is
     * still honoured for one release, loudly.
     */
    _legacyMeta(key) {
        const own = this.getOptionOrConfiguration(key, key);
        if (own !== undefined && own !== null && own !== "") return own;

        const legacy = globalThis.PLUGINS?.dicom?.[key];
        if (legacy) {
            console.warn(
                `[dicom-browser] reading "${key}" from the legacy location plugins.dicom.${key}. ` +
                `Move it to plugins.dicom-browser.${key} — the old location will stop being read.`
            );
            return legacy;
        }
        return undefined;
    }

    /** Same fallback, for the two switches that also moved. */
    _legacyStaticMeta(key, fallback) {
        const own = this.getStaticMeta(key, undefined);
        if (own !== undefined && own !== null) return own;
        const legacy = globalThis.PLUGINS?.dicom?.[key];
        if (legacy !== undefined && legacy !== null) {
            console.warn(
                `[dicom-browser] reading "${key}" from the legacy location plugins.dicom.${key}. ` +
                `Move it to plugins.dicom-browser.${key}.`
            );
            return legacy;
        }
        return fallback;
    }

    /* ------------------------------------------------------------------ */
    /* Boot seeding                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Seed `evt.background` from the configured defaults.
     *
     * - a *series* -> open it,
     * - a *study*  -> offer every renderable series of it as backgrounds,
     * - a *patient* -> prefetch its studies but open nothing; the browser
     *   decides,
     * - nothing -> nothing.
     */
    async _seedBackgrounds(evt) {
        const api = this.dicom;
        if (!api) return;

        // `friendlySeriesName` resolves locale keys.
        await this._localeReady;

        let studyUID = this.defaultStudy;
        const seriesUID = this.defaultSeries;
        const patientID = this.defaultPatient;

        // Normalize the starting point: a series with no study is still openable
        // once we know which study it belongs to.
        if (seriesUID && !studyUID) {
            try {
                const lookup = await api.lookupStudyForSeries(seriesUID);
                if (lookup?.studyUID) studyUID = lookup.studyUID;
            } catch (e) {
                console.warn('[dicom-browser] series->study lookup failed:', e);
            }
        }

        // Defer to a restored session. Without this guard, exporting a
        // DICOM-backed session and reloading (which feeds the restored config
        // into `evt.background`) gets clobbered by the defaults below, and the
        // user sees a wrong or empty slide instead of what they exported.
        const hasRestoredBackground = Array.isArray(evt.background) && evt.background.length > 0;
        if (hasRestoredBackground) {
            // Say so out loud: a restored session outranks the deployment
            // defaults, so an operator who sets `studyUID` sees "nothing
            // happens" for as long as a cached session is alive, with no hint.
            if (seriesUID || studyUID || patientID) {
                console.info(
                    "[dicom-browser] a session is already in place; ignoring the configured " +
                    `${seriesUID ? "seriesUID" : studyUID ? "studyUID" : "patientUID"}. ` +
                    "Clear the session (or set core.setup.bypassCache) to boot from the configured default."
                );
            }
            if (studyUID) {
                this.state.activeStudy = studyUID;
                // Still cache the study context so slide-info has it.
                await api.ensureStudyContext(studyUID).catch(() => {});
            }
            return;
        }

        if (seriesUID) {
            // Only the branches that rewrite `evt.background` may drop the
            // visualization config — the patient / none branches keep the
            // session's visualizations intact. Derived overlays for these
            // backgrounds are re-discovered by `_registerOverlayAttachment`.
            evt.visualizations = null;
            evt.background = [{
                id: seriesUID,
                name: api.friendlySeriesName(seriesUID),
                dataReference: api.makeDataReference(studyUID, seriesUID),
            }];
            this.state.activeSeries = seriesUID;
            this.state.activeStudy = studyUID || null;
            if (studyUID) await api.ensureStudyContext(studyUID).catch(() => {});
            return;
        }

        if (studyUID) {
            // The protocol already knows how to turn a study into config
            // fragments — and it returns them rather than applying them, which
            // is exactly what a `before-app-init` seed needs.
            const { background } = await api.buildCaseSession(studyUID);
            evt.visualizations = null;
            evt.background = background;
            this.state.activeStudy = studyUID;
            await api.ensureStudyContext(studyUID).catch(() => {});
            return;
        }

        if (patientID) {
            // Prefetch for the browser, but open nothing and — importantly — do
            // NOT wipe the config: a remembered session stays.
            try {
                const { studies } = await api.seriesForPatient(patientID);
                this.state.activePatient = patientID;
                this.state.patients = await api.materializePatientsFromStudies(studies);
                this.state.studiesByPatient.set(patientID, studies);
                if (studies.length) {
                    this.state.activeStudy = studies[0].studyUID;
                    await api.ensureStudyContext(studies[0].studyUID).catch(() => {});
                }
                await api.populatePatientDetails(patientID);
            } catch (e) {
                console.warn("[dicom-browser] patient prefetch failed:", e?.message ?? e);
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Automatic derived-object overlays                                   */
    /* ------------------------------------------------------------------ */

    /**
     * Attach derived-object overlays to whichever slide is being opened.
     *
     * Hooked on `before-open` rather than `before-app-init` because that is the
     * only point common to BOTH paths: the slide switcher opens slides through
     * `openViewerWith(..., visualizations = undefined, ...)`, which preserves
     * `config.visualizations` untouched and never consults a boot handler.
     *
     * The mechanics — building the visualization, appending its data entries,
     * marking it so a re-open reuses rather than duplicates — belong to the
     * protocol plugin. What lives here is only the *decision* to do it without
     * being asked, which is the part a protocol must not make on its own.
     */
    _registerOverlayAttachment() {
        VIEWER_MANAGER.addHandler('before-open', async (event) => {
            try {
                const api = this.dicom;
                if (!api) return;
                if (!this._legacyStaticMeta("renderDerivedObjects", true)) return;

                const id = api.identityOf(event?.background);
                // Not a DICOM slide, or is itself an overlay layer.
                if (!id?.studyUID || !id?.seriesUID) return;
                if (id.role && id.role !== "wsi") return;
                // The session already said what it wants; do not second-guess it.
                if (id.derived !== undefined) return;

                await api.attachDerivedOverlays(event, id, "auto");
            } catch (e) {
                // An overlay is a feature; a slide that fails to open is a
                // broken viewer. Never let this throw take the slide with it.
                console.warn("[dicom-browser] overlay attachment failed:", e?.message ?? e);
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /* Slide-info browser                                                  */
    /* ------------------------------------------------------------------ */

    async _installBrowser(info) {
        const api = this.dicom;
        if (!api) return;

        const { span, div } = vanjs.tags;

        // Claim the browser synchronously, before the first await, or the
        // default flat catalog flashes while the hierarchy is being built.
        info.setWillInitCustomBrowser();

        await this._localeReady;
        const patientsSupported = await api.supportsPatients();

        const studiesLevel = {
            id: "studies",
            title: this.t('browser.studies'),
            searchHint: this.t('browser.searchHint'),
            mode: "page",
            pageSize: 20,
            // Stable identity: without keyOf the Explorer keys child buckets by
            // parent object identity, so re-fetched study objects would force a
            // fresh (unordered) QIDO re-fetch on back-navigation.
            keyOf: (s) => s?.studyUID || s?.StudyInstanceUID,
            // Lets the browser return to this study after a reload with a single
            // targeted QIDO call instead of paging the listing.
            resolveByKey: async (_patient, studyUID) => {
                const res = await api.listStudies({ filters: { StudyInstanceUID: studyUID }, limit: 1 });
                const item = res.items?.[0];
                if (!item) return null;
                item.label = item.description || item.studyUID;
                this.state.activeStudy = item.studyUID;
                return item;
            },
            getChildren: async (patient, ctx) => {
                const pid = patient?.patientID || patient?.PatientID;
                let res;
                try {
                    res = await api.listStudies({
                        patientID: pid,
                        filters: api.searchToStudyFilters(ctx.search),
                        limit: ctx.pageSize,
                        offset: ctx.pageSize * ctx.page,
                    });
                } catch (e) {
                    // The switcher awaits this without a catch, so a throw here
                    // escapes as an unhandled rejection and the panel is left
                    // mid-render. Report and degrade to empty.
                    console.error("[dicom-browser] study listing failed:", e);
                    info.warn?.(this.t('browser.listingFailed', { error: e?.message ?? String(e) }));
                    return { total: 0, items: [] };
                }
                const empty = (res.total === 0) || (res.items.length === 0 && ctx.page === 0);
                if (empty) {
                    // A search that matched nothing is a different message from
                    // a store that holds nothing.
                    info.warn?.(ctx.search
                        ? this.t('browser.noMatches', { query: ctx.search })
                        : this.t('browser.noStudies'));
                }
                for (const item of res.items) {
                    item.label = item.description || item.studyUID;
                }
                return { total: res.total ?? undefined, items: res.items };
            },
            renderItem: (item) => {
                const fmtWhen = (it) => {
                    if (it.whenISO) return it.whenISO.replace('T', ' ').slice(0, 16); // "YYYY-MM-DD HH:MM"
                    const d = it.date || ''; const t = it.time || '';
                    const yyyy = d.slice(0, 4), mm = d.slice(4, 6), dd = d.slice(6, 8);
                    const HH = t.slice(0, 2), MM = t.slice(2, 4);
                    if (!yyyy || !mm || !dd) return '';
                    return `${yyyy}-${mm}-${dd}${(HH && MM) ? ` ${HH}:${MM}` : ''}`;
                };
                const chips = [];
                // Chips may carry unbounded tokens (UIDs, accession numbers)
                // that cannot soft-wrap — hard-cap each badge and ellipsize.
                // Inline style: the shipped tailwind build is purged and lacks
                // arbitrary max-w-* utilities.
                const addChip = (text) => { if (text) chips.push(span({
                    class: "badge badge-ghost badge-xs",
                    style: "max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block;"
                }, String(text))); };

                const title = item.label || item.description || item.studyID || item.studyUID || "";
                const when = fmtWhen(item);

                addChip(item.accession && this.t('browser.chipAccession', { value: item.accession }));
                addChip(item.studyID && this.t('browser.chipStudyId', { value: item.studyID }));

                // Modalities (e.g. ["SM","CT"]) -> badges
                const mods = Array.isArray(item.modalities) ? item.modalities : (item.modalities ? [item.modalities] : []);
                for (const m of mods) addChip(m);

                const s = Number.isFinite(item.seriesCount) ? item.seriesCount : null;
                const i = Number.isFinite(item.instanceCount) ? item.instanceCount : null;
                if (s != null || i != null) addChip(this.t('browser.chipCounts', { series: s ?? "?", instances: i ?? "?" }));

                addChip(item.institution);
                addChip(item.uidTail && `…${item.uidTail}`);

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
                        // render as title="undefined" — omit the key instead.
                        ...(tooltip ? { title: tooltip } : {})
                    },
                    // left: small icon + title/date — flex-1 + min-w-0 so long
                    // UIDs truncate instead of widening the row
                    div({ class: "flex items-start gap-2 min-w-0 flex-1" },
                        span({ class: "ph-light ph-folders shrink-0" }),
                        div({ class: "flex flex-col min-w-0" },
                            div({ class: "text-sm font-medium truncate" }, title),
                            when ? div({ class: "text-xs text-base-content/70 truncate" }, when) : null
                        )
                    ),
                    // right: chips on ONE line. They used to wrap, which made
                    // study rows differ in height while the Explorer's windowing
                    // sizes its spacers from a single probed row height — the
                    // accumulated error is what made the list jitter near the
                    // bottom. Each chip already ellipsizes.
                    div({
                        class: "flex items-center gap-1 flex-nowrap justify-end pl-2 min-w-0",
                        style: "max-width: 55%; overflow: hidden;"
                    }, ...chips)
                );
            },
            canOpen: () => true,
            onClick: (item) => { this.state.activeStudy = item.studyUID; },
        };

        const imagesLevel = {
            id: "images",
            title: this.t('browser.images'),
            mode: "virtual",
            pageSize: 20,
            getChildren: async (seriesOrStudy, ctx) => {
                const studyUID = seriesOrStudy.studyUID || seriesOrStudy.StudyInstanceUID;
                // The full shallow WSI list for the study is resolved once
                // (concurrency-capped, no per-instance metadata) and sliced
                // here: WSI items don't map 1:1 to series, so server-side series
                // paging cannot drive this level's virtual pagination honestly.
                let all;
                try {
                    all = await api.shallowWsiItemsForStudy(studyUID, ctx.search);
                } catch (e) {
                    console.error("[dicom-browser] image listing failed:", e);
                    info.warn?.(this.t('browser.listingFailed', { error: e?.message ?? String(e) }));
                    return { total: 0, items: [] };
                }
                const start = ctx.offset ?? (ctx.pageSize * ctx.page);
                return { total: all.length, items: all.slice(start, start + ctx.pageSize) };
            },
            canOpen: () => false,
            onClick: (img) => {
                // Selection bookkeeping only — opening is handled by the slide
                // switcher via customItemToBackground.
                if (img?.seriesUID) this.state.activeSeries = img.seriesUID;
                if (img?.studyUID) this.state.activeStudy = img.studyUID;
            }
        };

        // If /patients is not supported, keep Patients but present the derived
        // list (cross-page deduped inside the protocol plugin).
        const levels = [{
            id: "patients",
            title: this.t('browser.patients'),
            mode: "page",
            pageSize: 20,
            // Stable identity across re-fetches — see the studies keyOf note.
            keyOf: (p) => p?.patientID || p?.PatientID,
            // Restore a patient from its ID with one targeted query instead of
            // paging the listing.
            resolveByKey: async (_parent, patientID) => {
                const item = await api.lookupPatientById(patientID);
                if (!item) return null;
                item.label = item.name || item.PatientName || item.patientID;
                return item;
            },
            getChildren: async (_parent, ctx) => {
                const res = await api.listPatientsPaged({
                    limit: ctx.pageSize,
                    offset: ctx.pageSize * ctx.page,
                    search: ctx.search,
                });
                if (!ctx.search && ((res.total === 0) || (res.items.length === 0 && ctx.page === 0))) {
                    info.warn?.(this.t('browser.noPatients'));
                }
                for (const item of res.items) {
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

        info.setCustomBrowser({
            id: "dicom-browser",
            levels,
            customItemToBackground: (item) => {
                const seriesUID = item?.seriesUID;
                const studyUID = item?.studyUID || this.state.activeStudy;
                if (!seriesUID || !studyUID) {
                    Dialogs.show(this.t('browser.openMissingIds'), 5000, Dialogs.MSG_ERR);
                    console.error("[dicom-browser] missing seriesUID or studyUID for image:", item);
                    return null;
                }
                // Use the grouped WSI label (built from container / description /
                // dims / modality) as the display name. Without `name`,
                // UTILITIES.nameFromBGOrIndex falls back to the raw series UID.
                const name = item.label || api.friendlySeriesName(seriesUID);
                return { id: seriesUID, name, dataReference: api.makeDataReference(studyUID, seriesUID) };
            },
            backgroundToCustomItem: (bgConfig) => {
                // BackgroundConfig.data(...) returns entries shaped
                // `{ dataID: { studyUID, seriesUID }, protocol: "dicom" }`.
                // Tolerate both shapes — older sessions might still hold the raw
                // `{ studyUID, seriesUID }` form.
                const data = BackgroundConfig.data(bgConfig);
                const id = data?.[0]?.dataID ?? data?.[0];
                return { seriesUID: id?.seriesUID, studyUID: id?.studyUID };
            },
            getItemPreview: (item) => api.fetchSeriesPreview(item),
        });
    }
});
