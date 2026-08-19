/// <reference path="../../src/types/globals.d.ts" />

/**
 * App-job orchestration against the Workbench Service.
 *
 * A port of the reference AppUI's NgRx effects
 * (`apps/generic-app-ui-v3/src/app/jobs/store/jobs/jobs.effects.ts`) into plain
 * async methods. The choreography is the interesting part, and it is dictated
 * by the backend, not by us:
 *
 *  **single-ROI EAD** (`getRoiMode() === "single"`)
 *      POST /jobs → PUT inputs/{wsiKey}={slideId} ∥ PUT inputs/{roiKey}={roiId}
 *      → wait for BOTH to land → PUT /jobs/{id}/run
 *      (`setInputsForSingleRoi$` + `startSingleRoiJob$`: the run must not fire
 *      before both inputs are acknowledged, or the backend refuses it.)
 *
 *  **multi-ROI EAD** (`"multiple"`)
 *      POST /jobs → PUT inputs/{wsiKey} → POST /collections (one per collection
 *      input key) → PUT inputs/{collectionKey}={collectionId}
 *      → POST /collections/{id}/items for each ROI → run on user command
 *      (`setInputsForMultiRoi$`).
 *
 * Polling mirrors `jobsPolling$` / `stopJobsPolling$`: tick while any job for
 * the current (slide, mode) is non-terminal, stop once they all are. Every
 * request rides the background scheduler lane so job traffic never competes
 * with tile loading.
 */

import {
    factoryForRoiType, getRoiMode, getTypesInputKeys, getWsiInputKey, isContainerized,
    EAD_ANNOTATION_TYPES, type EadAnnotationType, type EadDocument, type EadMode,
} from "./ead";
import { isJobTerminal, isJobValidationTerminal, type Job, type JobMode, type Pixelmap, type Primitive } from "./types";
import type { Wbs3Client } from "./wbs3-client";

/** EAD mode name → the wire enum the jobs API expects. */
function jobModeOf(mode: EadMode): JobMode {
    return mode.toUpperCase() as JobMode;
}

export interface JobRunnerDeps {
    getClient(): Wbs3Client | undefined;
    getEad(): EadDocument | undefined;
    /** Slide the panel is currently working on — the target of a new submission. */
    getSlideId(): string | undefined;
    /**
     * The EAD mode the user is in. Polling filters on it, so without this the
     * runner listed STANDALONE jobs while the panel showed PREPROCESSING and the
     * list came back empty.
     */
    getMode(): EadMode;
    /** Poll interval while any job is non-terminal. */
    pollMs(): number;
    /**
     * Emitted after every poll, once per slide whose bucket changed, so the UI
     * can re-render exactly the list that moved.
     */
    onJobsChanged(slideId: string, jobs: Job[]): void;
}

export interface RunStandaloneRequest {
    /** EMPAIA annotation ids of the ROIs to analyse. */
    roiIds: string[];
    /** The EMPAIA type of those ROIs — picks the input key. */
    roiType: EadAnnotationType;
    /** Defaults to `"standalone"`. */
    mode?: EadMode;
}

/** An annotation a job has locked by consuming it — the user's own work. */
export interface LockedInput {
    /** EMPAIA annotation id. */
    id: string;
    /** The analysis holding the lock ("" when the query covered several). */
    jobId: string;
}

export interface JobResults {
    primitives: Primitive[];
    pixelmaps: Pixelmap[];
    /**
     * Annotations the job PRODUCED, in EMPAIA wire form (the caller maps them).
     *
     * Not everything the annotation query answered: `jobs: [id]` selects every
     * record *locked in* that job, which includes the ROIs it consumed. Those
     * are separated into {@link lockedInputs} — they are the user's own
     * annotations, already on the canvas, and importing or evicting them with
     * the job's output is what made showing and hiding an analysis a no-op.
     */
    annotations: any[];
    /** Annotations the job consumed. Ids only: never imported, never evicted. */
    lockedInputs: LockedInput[];
}

/** The empty result, so no caller has to spell the shape out. */
export function emptyJobResults(): JobResults {
    return { primitives: [], pixelmaps: [], annotations: [], lockedInputs: [] };
}

export class JobRunner {
    private readonly _deps: JobRunnerDeps;
    /**
     * Last polled job list, bucketed by the slide the job names as its WSI input.
     *
     * `GET /jobs` returns the whole scope in one response, so keeping every
     * slide's list costs nothing over keeping one — and it is what lets the
     * analyses UI stay correct when several viewports show different slides,
     * without a request per slide.
     */
    private _jobsBySlide = new Map<string, Job[]>();
    /** Last emitted signature per slide — the poll de-duplication (see `refresh`). */
    private readonly _signatures = new Map<string, string>();
    private _timer: any = undefined;
    private _polling = false;
    private _inFlight?: AbortController;

    constructor(deps: JobRunnerDeps) {
        this._deps = deps;
    }

    /** Last polled job list for one slide, in the polled mode. */
    jobsFor(slideId: string | undefined): Job[] {
        return slideId ? (this._jobsBySlide.get(slideId) ?? []) : [];
    }

    /** Every slide a polled job belongs to. */
    slidesWithJobs(): string[] { return [...this._jobsBySlide.keys()]; }

    /**
     * Forget the polled state.
     *
     * Called when the mode changes: the buckets describe the *previous* mode's
     * jobs, and the de-duplication would otherwise suppress the first emit of
     * the new mode's list wherever the two happen to look alike.
     */
    resetJobs(): void {
        this._jobsBySlide.clear();
        this._signatures.clear();
    }

    // ── submission ──────────────────────────────────────────────────────────

    /**
     * Create, wire up and start a job over the supplied ROIs.
     *
     * Returns the job. For a multi-ROI EAD the job is created and fully wired
     * but **not** started unless `autoRun` is set — the reference UI lets the
     * user keep adding ROIs to the collection before running.
     */
    async runStandalone(request: RunStandaloneRequest, options: { autoRun?: boolean } = {}): Promise<Job> {
        const client = this._require("client");
        const ead = this._require("ead");
        const slideId = this._deps.getSlideId();
        if (!slideId) throw new Error("No slide is open — a job needs a WSI input.");

        const mode: EadMode = request.mode ?? "standalone";
        const wsiKey = getWsiInputKey(ead, mode);
        if (!wsiKey) throw new Error(`The app declares no "wsi" input for mode "${mode}".`);

        const roiMode = getRoiMode(ead, mode);
        const job = await client.createJob(jobModeOf(mode), isContainerized(ead, mode));

        if (roiMode === "single") {
            const roiId = request.roiIds[0];
            if (!roiId) throw new Error("Select a region of interest before running the analysis.");

            const roiKey = this._singleRoiKey(ead, mode, request.roiType);
            // Both inputs must be acknowledged before `run` — that is the whole
            // point of the reference's forkJoin gate.
            await Promise.all([
                client.setJobInput(job.id, wsiKey, slideId),
                client.setJobInput(job.id, roiKey, roiId),
            ]);
            const running = await client.runJob(job.id);
            this.startPolling();
            return running;
        }

        // multiple: one collection per collection-typed annotation input key
        await client.setJobInput(job.id, wsiKey, slideId);
        const collectionKeys = getTypesInputKeys(EAD_ANNOTATION_TYPES as any, ead, mode)
            .filter(k => k.inCollection === 1);
        if (!collectionKeys.length) {
            throw new Error(`The app declares no ROI collection input for mode "${mode}".`);
        }

        for (const key of collectionKeys) {
            const collection = await client.postCollection({
                type: "collection",
                creator_id: client.scopeId,
                creator_type: "scope",
                item_type: key.type as any,
                reference_id: slideId,
                reference_type: "wsi",
            });
            const collectionId = String(collection.id);
            await client.setJobInput(job.id, key.inputKey, collectionId);

            // Only the ROIs whose type this collection accepts.
            if (key.type === request.roiType && request.roiIds.length) {
                await client.postCollectionItems(collectionId, request.roiIds.map(id => ({ id })));
            }
        }

        if (options.autoRun) {
            const running = await client.runJob(job.id);
            this.startPolling();
            return running;
        }
        this.startPolling();
        return job;
    }

    /** Start a job that was created earlier and has since had its inputs filled. */
    async run(jobId: string): Promise<Job> {
        const client = this._require("client");
        const job = await client.runJob(jobId);
        this.startPolling();
        return job;
    }

    async stop(jobId: string): Promise<void> {
        await this._require("client").stopJob(jobId);
        await this.refresh();
    }

    async remove(jobId: string): Promise<void> {
        await this._require("client").deleteJob(jobId);
        // The job could belong to any bucket; only the one that held it changed.
        for (const [slideId, jobs] of this._jobsBySlide) {
            if (!jobs.some(j => j.id === jobId)) continue;
            const next = jobs.filter(j => j.id !== jobId);
            this._jobsBySlide.set(slideId, next);
            this._signatures.set(slideId, signatureOf(next));
            this._deps.onJobsChanged(slideId, next);
        }
    }

    /** Append ROIs to an existing multi-ROI job's collection input. */
    async addRoisToCollection(collectionId: string, roiIds: string[]): Promise<void> {
        if (!roiIds.length) return;
        await this._require("client").postCollectionItems(collectionId, roiIds.map(id => ({ id })));
    }

    // ── polling ─────────────────────────────────────────────────────────────

    /**
     * Poll until every job for the current (slide, mode) is terminal *and* its
     * validation has settled. Idempotent — calling it while already polling
     * just keeps the existing timer.
     */
    startPolling(): void {
        if (this._polling) return;
        this._polling = true;
        const tick = async () => {
            if (!this._polling) return;
            const done = await this.refresh();
            if (done) { this.stopPolling(); return; }
            this._timer = setTimeout(tick, Math.max(500, this._deps.pollMs()));
        };
        // First read immediately; the caller usually just changed something.
        tick().catch(e => console.warn("[empaia-workbench] job polling failed:", e?.message ?? e));
    }

    stopPolling(): void {
        this._polling = false;
        if (this._timer) { clearTimeout(this._timer); this._timer = undefined; }
        this._inFlight?.abort();
        this._inFlight = undefined;
    }

    /**
     * One poll. Returns true when nothing is left to wait for — the caller (or
     * the internal timer) can stop.
     */
    async refresh(mode: EadMode = this._deps.getMode()): Promise<boolean> {
        const client = this._deps.getClient();
        const ead = this._deps.getEad();
        const activeSlideId = this._deps.getSlideId();
        if (!client || !ead) return true;

        const wsiKey = getWsiInputKey(ead, mode);
        this._inFlight?.abort();
        this._inFlight = new AbortController();

        let all: Job[];
        try {
            all = await client.listJobs(this._inFlight.signal);
        } catch (e: any) {
            if (this._inFlight.signal.aborted) return false;
            console.warn("[empaia-workbench] job listing failed:", e?.message ?? e);
            return false;
        }

        // Mode filter is the reference's; the slide filter becomes a bucketing.
        // A job whose WSI input we cannot read (no `wsi` key declared for this
        // mode) is attributed to the slide the user is on — that is the only
        // slide it could have been submitted from.
        const wanted = jobModeOf(mode);
        const next = new Map<string, Job[]>();
        for (const job of all) {
            if (job.mode !== wanted) continue;
            const slideId = (wsiKey ? job.inputs?.[wsiKey] : undefined) ?? activeSlideId;
            if (!slideId) continue;
            const bucket = next.get(slideId);
            if (bucket) bucket.push(job);
            else next.set(slideId, [job]);
        }

        // Emit per slide, and only for buckets that actually moved: the runner
        // polls on a timer, so an unconditional emit would re-render every
        // analyses list several times a second for no new information. The
        // active slide is always considered, so a slide with no analyses at all
        // still gets its one "there are none" emit and leaves the loading state.
        const touched = new Set([...next.keys(), ...this._jobsBySlide.keys()]);
        if (activeSlideId) touched.add(activeSlideId);
        this._jobsBySlide = next;
        for (const slideId of touched) {
            const jobs = next.get(slideId) ?? [];
            const signature = signatureOf(jobs);
            if (this._signatures.get(slideId) === signature) continue;
            this._signatures.set(slideId, signature);
            this._deps.onJobsChanged(slideId, jobs);
        }

        // Nothing anywhere is still moving.
        for (const jobs of next.values()) {
            if (!jobs.every(job => isJobTerminal(job) && isJobValidationTerminal(job))) return false;
        }
        return true;
    }

    // ── results ─────────────────────────────────────────────────────────────

    /**
     * Everything the given jobs produced for one reference (the slide, or a
     * single ROI when the user drills into it).
     *
     * `jobs: [null]` is a meaningful filter in this API — "not locked in any
     * job" — so an empty id list means "no results", not "all results".
     *
     * Two asymmetries with the obvious implementation, both learned from the
     * backend rather than guessed:
     *
     *  - **primitives are NOT reference-filtered.** A job's scalar output is
     *    stored with `reference_id = NULL` (it describes the run, not the
     *    slide), so adding `references` to that query silently drops every
     *    value the app computed — which is why a completed analysis showed no
     *    result at all. `jobs` alone is a legal selector.
     *  - **the annotation response is split.** `jobs: [id]` selects records
     *    *locked in* the job: its output AND the ROIs it consumed. See
     *    {@link JobResults.annotations}.
     */
    async loadResults(jobIds: string[], referenceId: string): Promise<JobResults> {
        const client = this._deps.getClient();
        if (!client || !jobIds.length || !referenceId) return emptyJobResults();
        const wanted = new Set(jobIds.map(String));

        const [primitives, pixelmaps, items] = await Promise.all([
            client.queryPrimitives({ jobs: jobIds }).catch(warnEmpty<Primitive>("primitives")),
            client.queryPixelmaps({ references: [referenceId], jobs: jobIds })
                .catch(warnEmpty<Pixelmap>("pixelmaps")),
            client.queryAnnotations({ references: [referenceId], jobs: jobIds }, { withClasses: true })
                .then(page => page.items)
                .catch(warnEmpty<any>("annotations")),
        ]);

        // `creator_id` of a product IS the producing job's id, so membership in
        // the queried set is the discriminator — independent of `creator_type`,
        // whose wire casing has already broken attribution once.
        const annotations: any[] = [];
        const lockedInputs: LockedInput[] = [];
        const single = jobIds.length === 1 ? String(jobIds[0]) : "";
        for (const item of items) {
            const creator = typeof item?.creator_id === "string" ? item.creator_id : "";
            if (wanted.has(creator)) annotations.push(item);
            else if (typeof item?.id === "string" && item.id) {
                lockedInputs.push({ id: item.id, jobId: single });
            }
        }

        return { primitives, pixelmaps, annotations, lockedInputs };
    }

    /** Collections a job produced or consumed, resolved to their items. */
    async loadCollectionItems(collectionId: string): Promise<any[]> {
        const client = this._deps.getClient();
        if (!client) return [];
        try {
            return await client.queryCollectionItems(collectionId);
        } catch (e: any) {
            console.warn("[empaia-workbench] collection item query failed:", e?.message ?? e);
            return [];
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /**
     * Input key for the single-ROI case. Prefers the key matching the ROI the
     * user actually drew; falls back to the app's first declared ROI input so a
     * mismatch produces a clear backend validation error rather than a silent
     * no-op.
     */
    private _singleRoiKey(ead: EadDocument, mode: EadMode, roiType: EadAnnotationType): string {
        const direct = getTypesInputKeys([roiType], ead, mode).find(k => k.inCollection === 0);
        if (direct) return direct.inputKey;

        const any = getTypesInputKeys(EAD_ANNOTATION_TYPES as any, ead, mode).find(k => k.inCollection === 0);
        if (any) {
            console.warn(`[empaia-workbench] app declares no "${roiType}" ROI input; ` +
                `falling back to "${any.inputKey}" (${any.type}).`);
            return any.inputKey;
        }
        throw new Error(`The app declares no region-of-interest input for mode "${mode}".`);
    }

    private _require(what: "client"): Wbs3Client;
    private _require(what: "ead"): EadDocument;
    private _require(what: "client" | "ead"): any {
        const value = what === "client" ? this._deps.getClient() : this._deps.getEad();
        if (!value) throw new Error("EMPAIA workbench session is not ready.");
        return value;
    }
}

/** ROI shapes the app accepts, as xOpat factory ids — for the drawing tool. */
export function roiFactoriesFor(ead: EadDocument, mode: EadMode): string[] {
    return EAD_ANNOTATION_TYPES
        .filter(type => getTypesInputKeys([type], ead, mode).length > 0)
        .map(factoryForRoiType);
}

/**
 * Everything a poll could legitimately change about a slide's analyses, as one
 * string. Compared instead of the objects themselves because `listJobs` returns
 * fresh instances every tick, so identity and shallow equality both always say
 * "changed" — which is how the UI ended up re-rendering on a timer.
 */
function signatureOf(jobs: Job[]): string {
    return jobs.map(job => [
        job.id, job.status, job.progress ?? "", job.runtime ?? "",
        job.ended_at ?? "", job.started_at ?? "", job.created_at ?? "",
        job.error_message ?? "",
        job.input_validation_status ?? "", job.input_validation_error_message ?? "",
        job.output_validation_status ?? "", job.output_validation_error_message ?? "",
    ].join("|")).join(";");
}

function warnEmpty<T>(what: string): (e: any) => T[] {
    return (e: any) => {
        console.warn(`[empaia-workbench] ${what} query failed:`, e?.message ?? e);
        return [];
    };
}
