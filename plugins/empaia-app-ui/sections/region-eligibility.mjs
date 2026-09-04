/**
 * What can be done with an annotation, from the analysis' point of view.
 *
 * Two independent questions, deliberately not one:
 *
 *  - **analysable** — can this be named as a job input right now?
 *  - **convertible** — can this be *made* a region of interest?
 *
 * Collapsing them into a single "eligible" flag is what made a region a previous
 * analysis had consumed disappear from every offer with no explanation. The
 * backend lock (423) covers **delete and update only** — every guard in this
 * repo tests exactly `pre-delete` / `pre-update`, and `POST /collections/{id}/items`
 * has no lock precheck at all. So a locked region cannot be edited, and *can*
 * still be handed to another run. Conversion is a preset change, i.e. an update,
 * so it is the one that every edit-blocking condition applies to.
 *
 * Free of van.js and of the DOM, like `job-status.mjs` — the whole file is
 * directly testable, and the verdict is the thing worth testing.
 */

/**
 * @typedef {object} RegionVerdict
 * @property {string}  incrementId
 * @property {string=} empaiaId    server id, once the region has been stored
 * @property {string}  factoryID
 * @property {string=} roiType     the EMPAIA type it would be submitted as
 * @property {boolean} analysable  can be named as a job input now
 * @property {boolean} convertible can be given the ROI preset
 * @property {string=} reasonKey   i18n key for why it is neither
 * @property {string=} lockedBy    analysis holding the edit lock ("" = holder unknown)
 * @property {string}  label
 */

/**
 * @typedef {object} RegionContext
 * @property {(o:any) => string|undefined} roiTypeOf
 * @property {(o:any) => boolean}          isJobOwned
 * @property {(o:any) => string|undefined} lockingJobFor
 * @property {string}                      roiPresetId
 * @property {(incrementId:string) => ({empaiaId?:string, pending?:boolean}|undefined)} rowFor
 * @property {(o:any) => string}           labelOf
 */

/**
 * Judge one annotation.
 *
 * Order matters. A region that is already a usable input is answered first and
 * without qualification — asking "is it locked?" before "can it be analysed?" is
 * exactly the inversion that produced the bug. Locked-ness is then reported as an
 * *attribute* (`lockedBy`), not as a refusal.
 *
 * @param {any} object a fabric annotation
 * @param {RegionContext} ctx
 * @returns {RegionVerdict}
 */
export function describeRegion(object, ctx) {
    const incrementId = object?.incrementId !== undefined ? String(object.incrementId) : "";
    const lockedBy = ctx.lockingJobFor(object);
    const verdict = {
        incrementId,
        empaiaId: undefined,
        factoryID: String(object?.factoryID ?? ""),
        roiType: ctx.roiTypeOf(object),
        analysable: false,
        convertible: false,
        reasonKey: undefined,
        lockedBy,
        label: ctx.labelOf(object),
    };

    const isRoi = object?.presetID === ctx.roiPresetId;
    const row = incrementId ? ctx.rowFor(incrementId) : undefined;
    const empaiaId = row?.empaiaId ?? object?.empaiaId;

    // Already a region of interest with a server id: usable, full stop. Whether a
    // previous run locked it is not this question's business.
    if (isRoi && verdict.roiType && empaiaId) {
        return { ...verdict, empaiaId, analysable: true };
    }

    // Everything below is a reason. The shape check comes first because it is the
    // one condition no action can repair.
    //
    // Two different facts wore one sentence: an app that wants polygons and got a
    // rectangle, and an app that declares no usable region input at all. The
    // second is not the shape's fault — "this shape is not accepted" is simply
    // untrue when nothing would be — so it gets its own reason.
    if (!verdict.roiType) {
        return {
            ...verdict,
            reasonKey: ctx.hasRoiInput?.() === false ? "roi.noRoiInput" : "roi.wrongShape",
        };
    }

    // A region of interest still on its way up needs no verdict beyond "wait".
    // `roi.notStoredCount`, not `roi.notSaved`: reasons are rendered grouped over
    // a count, and `roi.notSaved` is the singular status tooltip in the ROI list.
    if (isRoi) {
        return { ...verdict, reasonKey: row?.pending === false ? "roi.notStoredCount" : "roi.stillSaving" };
    }

    // From here the only route is conversion, and conversion is an update.
    if (ctx.isJobOwned(object)) return { ...verdict, reasonKey: "roi.jobOwned" };
    if (lockedBy !== undefined) return { ...verdict, reasonKey: "roi.lockedNotConvertible" };
    return { ...verdict, convertible: true, reasonKey: "roi.notRoiPreset" };
}

/**
 * The regions an action will not touch, grouped by why.
 *
 * Grouped rather than listed because the sentence has to fit in a menu row and a
 * toast: "3 regions were produced by an analysis" is readable, three identical
 * lines are not. Most common reason first, so the dominant cause leads.
 *
 * @param {RegionVerdict[]} regions the ones being skipped
 * @returns {Array<{reasonKey:string, count:number, lockedBy?:string}>}
 */
export function refusalGroups(regions) {
    const byReason = new Map();
    for (const region of regions ?? []) {
        const reasonKey = region?.reasonKey;
        if (!reasonKey) continue;
        const group = byReason.get(reasonKey);
        if (group) group.count++;
        else byReason.set(reasonKey, { reasonKey, count: 1, lockedBy: region.lockedBy });
    }
    return [...byReason.values()].sort((a, b) => b.count - a.count);
}

/**
 * Why a region cannot be DRAWN, or `undefined` when it can.
 *
 * The session, and nothing else. Drawing a region is not running an app, and the
 * two were briefly conflated here: this used to consult `runBlockers()`, so an
 * app this viewer cannot *start* (TA09 — a slide collection) also could not be
 * drawn on, and three region-shaped surfaces quoted a sentence about **slides**
 * at the user.
 *
 * Nothing app-specific is written into a region. `postAnnotations({isRoi: true})`
 * never consults the EAD, the ROI preset id is a constant, and no guard refuses a
 * create on app grounds — the one `pre-create` guard tests geometry. A region is
 * a scope-owned annotation with a flag; it is stored, it has an id, and whether
 * *this* analysis will accept it is a later and separate question, answered by
 * {@link describeRegion} and by the run button.
 *
 * With no session there is no client and no slide id, so the annotation could not
 * be stored at all. That is the one condition that genuinely stops a region
 * existing, so it is the only one here.
 *
 * @param {object} ctx
 * @param {boolean} ctx.ready session is up
 * @param {(key: string) => string} ctx.t
 * @returns {string|undefined} a sentence to show the user
 */
export function drawRefusal({ ready, t }) {
    if (!ready) return t("roi.quickModeNotReady");
    return undefined;
}

/**
 * Why this app cannot RUN on a region, or `undefined` when it can.
 *
 * The other half of the split above, and the body that used to serve both. For
 * anything that submits a job the app-level blockers are exactly the right
 * answer — they are the same sentences the panel banner and the run button use,
 * so a refusal cannot be worded two ways.
 *
 * Its one caller today is the quick-ROI mode, which is not a drawing tool: it
 * promises "draw one region, get one analysis" and submits on release, so it has
 * to refuse everything a run would.
 *
 * @param {object} ctx
 * @param {boolean} ctx.ready session is up
 * @param {string[]} ctx.blockers `runBlockers()` for the active mode
 * @param {string[]} ctx.roiTypes `getRoiTypes()` for the active mode
 * @param {string} [ctx.roiMode] `getRoiMode()`
 * @param {boolean} [ctx.singleOnly=false] also refuse an app that collects
 *   several regions — the quick mode's promise does not survive it, nothing else
 *   cares
 * @param {(key: string) => string} ctx.t
 * @returns {string|undefined} a sentence to show the user
 */
export function runRefusal({ ready, blockers, roiTypes, roiMode, singleOnly = false, t }) {
    if (!ready) return t("roi.quickModeNotReady");
    const blocker = (blockers ?? [])[0];
    if (blocker) return blocker;
    if (!(roiTypes ?? []).length) return t("jobs.noRoiInput");
    if (singleOnly && roiMode !== "single") return t("roi.quickModeSingleOnly");
    return undefined;
}
