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
    factoryForRoiType, isContainerized,
    type EadAnnotationType, type EadDocument, type EadMode,
} from "./ead";
import { fromJobInputs, roiInputs, roiMode as roiModeOf, wsiInputKey } from "./inputs";
import { describeOutputs, outputKind, type OutputItem, type OutputKind, type OutputSpec } from "./outputs";
import { isJobTerminal, isJobValidationTerminal, type Job, type JobMode, type Pixelmap, type Primitive } from "./types";
import type { Wbs3Client } from "./wbs3-client";

/** Page size for annotation reads — the same the hydration path uses. */
const ANNOTATION_PAGE_SIZE = 500;
/** A stop for a backend whose `item_count` never agrees with what it sends. */
const ANNOTATION_PAGE_CAP = 200_000;
/** Consecutive `GET /jobs` failures before polling gives up rather than looping. */
const MAX_POLL_FAILURES = 5;

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
    /**
     * The completed job whose outputs fill this mode's `from-job` inputs.
     *
     * Postprocessing consumes what preprocessing produced, so a run needs to name
     * *which* earlier result it is built on. Chosen by the module (see
     * `sourceJobFor`), not here — the answer is "the one the user is looking at".
     */
    getSourceJob?(mode: EadMode): Job | undefined;
    /** Poll interval floor while any job is non-terminal. */
    pollMs(): number;
    /** Ceiling the idle backoff grows to. Defaults to `pollMs` when absent. */
    pollMaxMs?(): number;
    /**
     * A poll came back 401. The credential is being refreshed by the auth broker;
     * the runner has stopped rather than retry on the timer, and the module is
     * expected to restart it once the context settles.
     */
    onAuthStalled?(): void;
    /**
     * Emitted after every poll, once per slide whose bucket changed, so the UI
     * can re-render exactly the list that moved.
     */
    onJobsChanged(slideId: string, jobs: Job[]): void;
    /**
     * Fired after **every** successful poll, for every slide bucket — unlike
     * `onJobsChanged`, which fires only when a bucket's signature moved.
     *
     * The heartbeat for a caller waiting on something the job list cannot show.
     * A job that completed before its output was queryable changes no field
     * `signatureOf` reads, so the de-duplicated emit above never fires for it
     * again and a retry driven by it would never run.
     */
    onPollTick?(slideId: string, jobs: Job[]): void;
    /**
     * Is the caller still waiting on this job for something a further tick would
     * help with — an output that has not appeared yet?
     *
     * Keeps the loop alive past `isJobTerminal`. The BOUND is the caller's: the
     * runner does not second-guess it, and a caller that never answers false
     * re-creates the unbounded loop this same change removes.
     */
    isAwaitingOutputs?(job: Job): boolean;
}

export interface RunStandaloneRequest {
    /** EMPAIA annotation ids of the ROIs to analyse. */
    roiIds: string[];
    /** The EMPAIA type of those ROIs — picks the input key. */
    roiType: EadAnnotationType;
    /** Defaults to `"standalone"`. */
    mode?: EadMode;
}

/** One collection input of a staged job, and what has been put in it. */
export interface BatchCollection {
    collectionId: string;
    itemType: EadAnnotationType;
    /** EMPAIA annotation ids, in the order they were posted. */
    members: string[];
}

/**
 * A job staged in `ASSEMBLY`: created, its inputs bound, collecting regions
 * until the user runs it.
 *
 * It is a real server record, not a client-side draft, because that is the only
 * form that survives a reload — this module runs on an opaque origin and has no
 * client persistence at all (`README.md` → sandboxed operation).
 */
export interface BatchDraft {
    jobId: string;
    slideId: string;
    mode: EadMode;
    /** collection input key → the collection bound to it. */
    collections: Record<string, BatchCollection>;
    createdAt: number;
}

/** Total regions staged across every collection input. */
export function batchSize(draft: BatchDraft | undefined): number {
    if (!draft) return 0;
    return Object.values(draft.collections).reduce((n, c) => n + c.members.length, 0);
}

/** Every region staged in a draft, in posting order. */
export function batchMembers(draft: BatchDraft | undefined): string[] {
    if (!draft) return [];
    return Object.values(draft.collections).flatMap(c => c.members);
}

/** An annotation a job has locked by consuming it — the user's own work. */
export interface LockedInput {
    /** EMPAIA annotation id. */
    id: string;
    /** The analysis holding the lock ("" when the query covered several). */
    jobId: string;
}

/** What came back for one declared output key. */
export interface ResolvedOutput {
    spec: OutputSpec;
    /** What the output holds, once collection wrappers are stripped. */
    kind?: OutputKind;
    /**
     * Annotations this output put on the slide, when that is attributable —
     * only when the app declares exactly one annotation-producing output.
     */
    annotationCount?: number;
    /** `job.outputs[spec.key]`. */
    id?: string;
    /** Scalar outputs. */
    primitive?: Primitive;
    /** Collection outputs, in the collection's own order. */
    items?: OutputItem[];
    /** The app declares this output but nothing came back for it. */
    missing?: boolean;
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
    /**
     * Input collection key → its ordered member annotation ids.
     *
     * Optional so every existing caller and test keeps working. This is where
     * the *region order* comes from — reconstructing it from the canvas cannot
     * work, because the canvas has no idea in what order the regions were staged.
     */
    inputCollections?: Record<string, string[]>;
    /** Declared output key → what came back for it. */
    outputs?: ResolvedOutput[];
    /**
     * How many annotations the job's query selects — the server's own count,
     * not `annotations.length`. Discarding it is what made a truncated read
     * indistinguishable from a small result.
     */
    annotationCount?: number;
    /**
     * The annotations were counted and deliberately NOT fetched: past the
     * deployment's budget, so the user is told the size and asked.
     */
    annotationsWithheld?: boolean;
    /**
     * Names of the queries that rejected, if any.
     *
     * Every query in this path degrades to an empty array so one failure cannot
     * take the whole result down — which left a 4xx byte-identical to a genuine
     * "produced nothing", and the caller then recorded the job as permanently
     * empty. Say which failed, so nothing downstream has to guess.
     */
    failed?: string[];
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
    /** Consecutive poll failures — reset by any successful read. */
    private _failures = 0;
    /** Consecutive ticks that changed nothing — drives the idle backoff. */
    private _idleTicks = 0;
    /**
     * The last read stopped on 401/403, so the loop is waiting for a credential
     * rather than giving up. Consumed by the tick, after `stopPolling`.
     */
    private _authStalled = false;

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
        const wsiKey = wsiInputKey(ead, mode);
        if (!wsiKey) throw new Error(`The app declares no "wsi" input for mode "${mode}".`);

        const roiMode = roiModeOf(ead, mode);
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
            await this._wireFromJobInputs(job.id, ead, mode);
            const running = await client.runJob(job.id);
            this.startPolling();
            return running;
        }

        // multiple: one collection per collection-typed annotation input key
        const draft = await this._wireBatch(job, ead, mode, slideId);
        await this.addToBatch(draft, request.roiIds, request.roiType);

        if (options.autoRun) {
            const running = await client.runJob(job.id);
            this.startPolling();
            return running;
        }
        this.startPolling();
        return job;
    }

    // ── staged batches ──────────────────────────────────────────────────────

    /**
     * Create a job and bind its inputs without starting it.
     *
     * The reference AppUI's multi-ROI choreography, exposed on its own: the job
     * sits in `ASSEMBLY` collecting regions, and running it is a separate, explicit
     * act. That is the only shape in which "I want to analyse these five regions,
     * and I have not drawn the fifth yet" is expressible.
     */
    async createBatch(options: { mode?: EadMode } = {}): Promise<BatchDraft> {
        const client = this._require("client");
        const ead = this._require("ead");
        const slideId = this._deps.getSlideId();
        if (!slideId) throw new Error("No slide is open — a job needs a WSI input.");

        const mode: EadMode = options.mode ?? this._deps.getMode();
        const job = await client.createJob(jobModeOf(mode), isContainerized(ead, mode));
        const draft = await this._wireBatch(job, ead, mode, slideId);
        this.startPolling();
        return draft;
    }

    /**
     * Append regions to the collection whose item type accepts them.
     *
     * Returns a NEW draft rather than mutating: the caller holds the record the
     * UI renders, and a half-applied mutation after a failed POST is what makes a
     * staged count disagree with the server.
     */
    async addToBatch(draft: BatchDraft, roiIds: string[], roiType: EadAnnotationType): Promise<BatchDraft> {
        const ids = (roiIds ?? []).filter(Boolean);
        if (!ids.length) return draft;
        const client = this._require("client");

        const target = Object.entries(draft.collections).find(([, c]) => c.itemType === roiType);
        if (!target) {
            throw new Error(`The app declares no "${roiType}" collection input for mode "${draft.mode}".`);
        }
        const [inputKey, collection] = target;
        // Ids already staged are not re-posted: the same annotation twice is two
        // collection items, and the app would count the region twice.
        const fresh = ids.filter(id => !collection.members.includes(id));
        if (!fresh.length) return draft;

        await client.postCollectionItems(collection.collectionId, fresh.map(id => ({ id })));
        return {
            ...draft,
            collections: {
                ...draft.collections,
                [inputKey]: { ...collection, members: [...collection.members, ...fresh] },
            },
        };
    }

    /**
     * Rebuild a draft from an `ASSEMBLY` job already on the server.
     *
     * The only way a batch survives a reload. Members come from the collection
     * record itself; `queryCollectionItems` is the fallback for a backend that
     * does not populate `item_ids`.
     */
    async resolveBatch(job: Job, mode: EadMode): Promise<BatchDraft | undefined> {
        const client = this._deps.getClient();
        const ead = this._deps.getEad();
        if (!client || !ead || !job?.id) return undefined;

        const wsiKey = wsiInputKey(ead, mode);
        const slideId = (wsiKey ? job.inputs?.[wsiKey] : undefined) ?? this._deps.getSlideId();
        if (!slideId) return undefined;

        const collections: Record<string, BatchCollection> = {};
        for (const key of collectionInputKeys(ead, mode)) {
            const collectionId = job.inputs?.[key.inputKey];
            if (!collectionId) continue;
            collections[key.inputKey] = {
                collectionId: String(collectionId),
                itemType: key.type as EadAnnotationType,
                members: await this._collectionMembers(String(collectionId)),
            };
        }
        if (!Object.keys(collections).length) return undefined;

        return { jobId: job.id, slideId, mode, collections, createdAt: Number(job.created_at ?? 0) };
    }

    /** Create one collection per collection input key and bind them all. */
    private async _wireBatch(job: Job, ead: EadDocument, mode: EadMode, slideId: string): Promise<BatchDraft> {
        const client = this._require("client");
        const wsiKey = wsiInputKey(ead, mode);
        if (!wsiKey) throw new Error(`The app declares no "wsi" input for mode "${mode}".`);
        await client.setJobInput(job.id, wsiKey, slideId);
        await this._wireFromJobInputs(job.id, ead, mode);

        const keys = collectionInputKeys(ead, mode);
        if (!keys.length) {
            throw new Error(`The app declares no ROI collection input for mode "${mode}".`);
        }

        const collections: Record<string, BatchCollection> = {};
        for (const key of keys) {
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
            collections[key.inputKey] = {
                collectionId,
                itemType: key.type as EadAnnotationType,
                members: [],
            };
        }
        return { jobId: job.id, slideId, mode, collections, createdAt: Number(job.created_at ?? 0) };
    }

    /**
     * Ordered member ids of a collection.
     *
     * `item_ids` when the record carries them; otherwise the items query, which
     * takes no selector at all — the collection id is the selector (see
     * `Wbs3Client.queryCollectionItems`).
     */
    private async _collectionMembers(collectionId: string): Promise<string[]> {
        const client = this._deps.getClient();
        if (!client) return [];
        try {
            const collection = await client.getCollection(collectionId);
            const ids = collection?.item_ids;
            if (Array.isArray(ids) && ids.length) return ids.map(String).filter(Boolean);
            if (Array.isArray(collection?.items) && collection!.items!.length) {
                return collection!.items!.map((i: any) => String(i?.id ?? "")).filter(Boolean);
            }
        } catch (e: any) {
            console.warn("[empaia-workbench] collection read failed:", e?.message ?? e);
        }
        const items = await this.loadCollectionItems(collectionId);
        return items.map((i: any) => String(i?.id ?? "")).filter(Boolean);
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

    // ── polling ─────────────────────────────────────────────────────────────

    /**
     * Poll until every job for the current (slide, mode) is terminal *and* its
     * validation has settled. Idempotent — calling it while already polling
     * just keeps the existing timer.
     */
    startPolling(): void {
        // Any explicit start is a fresh chance: the user acted, or a slide/mode
        // changed, so neither the failure streak nor the idle backoff should
        // carry over from whatever was going on before.
        this._failures = 0;
        this._idleTicks = 0;
        if (this._polling) return;
        this._polling = true;

        const tick = async () => {
            if (!this._polling) return;
            let done = false;
            try {
                done = await this.refresh();
            } catch (e: any) {
                // `refresh` is written not to throw, and this catch is here
                // anyway: the one time it did, the throw skipped the re-arm below
                // and polling ended silently for the rest of the session, which is
                // the worst failure mode this loop has. Never let a bug in the
                // read decide whether the loop lives.
                console.warn("[empaia-workbench] job polling failed:", e?.message ?? e);
                if (++this._failures >= MAX_POLL_FAILURES) done = true;
            }
            if (done) {
                // Stop FIRST, then hand over. The resume path calls
                // `startPolling`, which is a no-op while `_polling` is still
                // true — so the order here is the difference between a loop
                // that comes back and one that is gone for the session.
                const stalled = this._authStalled;
                this._authStalled = false;
                this.stopPolling();
                if (stalled) this._deps.onAuthStalled?.();
                return;
            }
            this._timer = setTimeout(tick, this._nextDelay());
        };

        // First read immediately; the caller usually just changed something.
        void tick();
    }

    /**
     * How long until the next tick.
     *
     * `pollMs` is a floor, not a fixed interval. A job that never reaches a
     * terminal state — an app that dies without finalising, a backend that stops
     * answering — otherwise costs a request every two seconds for the life of the
     * tab; one session produced several hundred. Each tick that changes nothing
     * lengthens the wait geometrically up to a ceiling, and anything actually
     * moving resets it (see `refresh`).
     */
    private _nextDelay(): number {
        const base = Math.max(500, this._deps.pollMs());
        const ceiling = Math.max(base, this._deps.pollMaxMs?.() ?? base);
        return Math.min(ceiling, base * Math.pow(2, Math.min(this._idleTicks, 8)));
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
    async refresh(_mode: EadMode = this._deps.getMode()): Promise<boolean> {
        const client = this._deps.getClient();
        const ead = this._deps.getEad();
        const activeSlideId = this._deps.getSlideId();
        if (!client || !ead) return true;

        // The controller stays in a LOCAL. Reading `this._inFlight` back in the
        // catch is a use-after-free in two directions: `stopPolling()` nulls it
        // (→ `Cannot read properties of undefined (reading 'signal')`, which threw
        // before the failure counter below and so disabled the very budget meant
        // to stop a runaway loop), and a concurrent `refresh` replaces it (→ this
        // call inspects the other one's controller and reports an abort as a
        // transport failure).
        const controller = new AbortController();
        this._inFlight?.abort();
        this._inFlight = controller;

        let all: Job[];
        try {
            all = await client.listJobs(controller.signal);
        } catch (e: any) {
            if (controller.signal.aborted) return false;

            // A 401/403 is not a transport fault — `HttpClient` refreshes through the
            // auth broker, so it means the new token has not landed *yet*.
            // Retrying it on the poll timer is what filled a session's network log
            // with `"Access Token expired."`. Wait for the credential instead;
            // the budget is for faults nobody is already fixing.
            //
            // 403 belongs here for the same reason it is in the client's
            // `refreshOnStatuses`: FastAPI's bearer scheme reports a *missing*
            // header that way, and counting those as faults stopped polling
            // permanently while the refresh was still in progress.
            if (Number(e?.statusCode) === 401 || Number(e?.statusCode) === 403) {
                console.warn("[empaia-workbench] job listing unauthorized — waiting for a token.");
                // Recorded, NOT called here. `onAuthStalled` restarts the loop
                // once the credential lands, and this branch returns "done" —
                // so calling it now races the `stopPolling()` the tick is about
                // to run. When the context was already settled the resume won
                // that race, hit `startPolling`'s `if (this._polling) return`
                // guard, and the stop that followed ended polling for the rest
                // of the session: a job submitted after that never came back.
                this._authStalled = true;
                return true;
            }

            console.warn("[empaia-workbench] job listing failed:", e?.message ?? e);
            // Returning "not done" on every failure is how a backend that 500s
            // produced an unbounded 2 s poll loop for the life of the tab. Give
            // up after a few, and let any user action start it again.
            if (++this._failures >= MAX_POLL_FAILURES) {
                console.warn(`[empaia-workbench] job polling stopped after ` +
                    `${this._failures} consecutive failures.`);
                return true;
            }
            return false;
        }

        this._failures = 0;

        // One list per slide, ALL modes. Filtering by the mode the user happens
        // to be about to run hid the preprocessing results a postprocessing step
        // is built on, dropped every row on a mode switch, and stranded the
        // visibility set on ids that no longer existed. The mode is a property of
        // a row, not of the list.
        //
        // Each job is bucketed by *its own* mode's slide key: `my_wsi` in one
        // mode and `slide` in another are the same slide, and reading the active
        // mode's key would misfile every job of the other one.
        const next = new Map<string, Job[]>();
        for (const job of all) {
            const jobMode = String(job?.mode ?? "").toLowerCase() as EadMode;
            const wsiKey = wsiInputKey(ead, jobMode);
            // A job whose WSI input we cannot read is attributed to the slide the
            // user is on — the only slide it could have been submitted from.
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
        let moved = false;
        for (const slideId of touched) {
            const jobs = next.get(slideId) ?? [];
            const signature = signatureOf(jobs);
            if (this._signatures.get(slideId) === signature) continue;
            this._signatures.set(slideId, signature);
            moved = true;
            this._deps.onJobsChanged(slideId, jobs);
        }

        // The heartbeat, after the de-duplicated emit so the listener's own
        // bookkeeping has already run for anything that did move.
        for (const slideId of touched) {
            this._deps.onPollTick?.(slideId, next.get(slideId) ?? []);
        }

        // The same comparison that decides whether to re-render also decides how
        // hard to keep asking: a tick that changed nothing earns a longer wait.
        this._idleTicks = moved ? 0 : this._idleTicks + 1;

        // Nothing anywhere is still moving.
        for (const jobs of next.values()) {
            if (!jobs.every(job => this._isFinished(job))) return false;
        }
        return true;
    }

    /**
     * Is there any reason left to ask about this job?
     *
     * Three questions, not one. A job can be terminal by `status`, done
     * validating, and still owe the caller an output that was not queryable when
     * it settled — which is the one the loop used to have no way to express.
     */
    private _isFinished(job: Job): boolean {
        if (!isJobTerminal(job) || !isJobValidationTerminal(job)) return false;
        return !this._deps.isAwaitingOutputs?.(job);
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
    async loadResults(
        jobIds: string[],
        referenceId: string,
        options: { budget?: number; force?: boolean } = {},
    ): Promise<JobResults> {
        const client = this._deps.getClient();
        if (!client || !jobIds.length || !referenceId) return emptyJobResults();
        const wanted = new Set(jobIds.map(String));
        const annotationQuery = { references: [referenceId], jobs: jobIds };

        const failed: string[] = [];
        // The size check rides the FIRST PAGE rather than a separate count call.
        // An app built around "large collections" answers this query with
        // thousands of shapes, each carrying its inlined classes — megabytes in
        // one response — so the read has to be bounded before it is made. But
        // `item_count` comes back on every page anyway, so asking
        // `/annotations/query/count` first was a whole extra round trip per
        // result read to learn something the next request already carried.
        const budget = options.budget ?? 0;
        const [primitives, pixelmaps, page] = await Promise.all([
            client.queryPrimitives({ jobs: jobIds }).catch(warnEmpty<Primitive>("primitives", failed)),
            client.queryPixelmaps({ references: [referenceId], jobs: jobIds })
                .catch(warnEmpty<Pixelmap>("pixelmaps", failed)),
            this._allAnnotations(annotationQuery, {
                budget: options.force ? 0 : budget,
            }).catch(e => {
                const status = e?.statusCode ? ` (HTTP ${e.statusCode})` : "";
                console.warn(`[empaia-workbench] annotations query failed${status}:`, e?.message ?? e);
                failed.push("annotations");
                return { items: [] as any[], item_count: 0, withheld: false };
            }),
        ]);

        if (page.withheld) {
            // Scalars and pixel maps still come back — they are small, and they
            // are usually the summary the user actually wanted.
            return {
                primitives, pixelmaps, annotations: [], lockedInputs: [],
                annotationCount: page.item_count, annotationsWithheld: true,
                ...(failed.length ? { failed } : {}),
            };
        }
        const items = page.items;

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

        return {
            primitives, pixelmaps, annotations, lockedInputs,
            annotationCount: page.item_count || items.length,
            ...(failed.length ? { failed } : {}),
        };
    }

    /**
     * Every annotation a query selects, in pages.
     *
     * One un-paged request was the single biggest thing on the wire here, and its
     * `item_count` was discarded — so a server-side truncation was
     * indistinguishable from "the app produced that many". Paging at 500 matches
     * what the hydration path (`sink.ts` `readBundle`) already does, and the
     * count is compared rather than thrown away.
     */
    private async _allAnnotations(
        query: any,
        options: { budget?: number; pageSize?: number } = {},
    ): Promise<{ items: any[]; item_count: number; withheld: boolean }> {
        const client = this._require("client");
        const pageSize = options.pageSize ?? ANNOTATION_PAGE_SIZE;
        const budget = options.budget ?? 0;
        const items: any[] = [];
        let expected = 0;

        for (let skip = 0; ; skip += pageSize) {
            const page = await client.queryAnnotations(query, {
                // `skip: 0` is omitted so the first — and for almost every
                // analysis, only — request keeps the wire shape it always had.
                skip: skip || undefined,
                limit: pageSize,
                withClasses: true,
            });
            expected = page.item_count || expected;

            // The size gate, decided off the first page: one bounded read has
            // already happened, and it is the one that tells us how big this is.
            if (budget > 0 && expected > budget) {
                return { items: [], item_count: expected, withheld: true };
            }

            items.push(...page.items);
            if (page.items.length < pageSize) break;
            if (items.length >= expected && expected > 0) break;
            if (skip > ANNOTATION_PAGE_CAP) {
                console.warn("[empaia-workbench] annotation paging stopped at " +
                    `${items.length} of ${expected} — refusing to page past ${ANNOTATION_PAGE_CAP}.`);
                break;
            }
        }

        if (expected && items.length < expected) {
            console.warn(`[empaia-workbench] read ${items.length} of ${expected} annotations.`);
        }
        return { items, item_count: expected || items.length, withheld: false };
    }

    /**
     * Everything a job produced, described by the EAD rather than guessed.
     *
     * `loadResults` answers what the three flat queries return; this additionally
     * resolves the app's *declared* outputs, which is the only way a per-item
     * collection ("one count per rectangle") can be read at all. It also reads
     * back the job's input collections, because the region order lives there and
     * nowhere else.
     */
    async loadResolvedResults(
        job: Job, referenceId: string, mode: EadMode,
        options: { budget?: number; force?: boolean } = {},
    ): Promise<JobResults> {
        const base = await this.loadResults(job?.id ? [job.id] : [], referenceId, options);
        const client = this._deps.getClient();
        const ead = this._deps.getEad();
        if (!client || !ead || !job?.id) return base;

        const inputCollections: Record<string, string[]> = {};
        for (const key of collectionInputKeys(ead, mode)) {
            const collectionId = job.inputs?.[key.inputKey];
            if (!collectionId) continue;
            inputCollections[key.inputKey] = await this._collectionMembers(String(collectionId));
        }

        const specs = describeOutputs(ead, mode);
        // How many outputs put annotations on the slide. With exactly one, the
        // pooled annotation response IS that output's contents and can be counted
        // as such; with several there is no way to split them without a request
        // per collection, so no count is claimed rather than a wrong one shown.
        const annotationOutputs = specs.filter(spec => outputKind(spec) === "annotation");

        const outputs: ResolvedOutput[] = [];
        for (const spec of specs) {
            const id = job.outputs?.[spec.key];
            if (!id) { outputs.push({ spec, missing: true }); continue; }
            const kind = outputKind(spec);

            // Annotations and classes are already here. The annotation query
            // returned the shapes, `with_classes=true` inlined the classes onto
            // them, and both are imported to the canvas — which is where a shape
            // belongs. Asking the collection route for them fetches records whose
            // `value` is undefined and puts a blank column in the results table.
            if (kind === "annotation" || kind === "class" || kind === "pixelmap") {
                const count = kind === "annotation" && annotationOutputs.length === 1
                    ? base.annotations.length
                    : undefined;
                outputs.push({
                    spec, id: String(id), kind,
                    // A zero is not a count, it is the absence of one — and
                    // "my_cells: 0" states as fact what was never established.
                    // `missing` already carries it; the panel decides what to say.
                    annotationCount: count || undefined,
                    missing: kind === "annotation" && annotationOutputs.length === 1 && !count,
                });
                continue;
            }

            // Only a collection of PRIMITIVES has anything to fetch: its members
            // are the per-region values the results table renders. Every other
            // leaf either arrived through one of the flat queries or has no
            // `value` at all — and asking anyway is not merely a wasted request,
            // a collection whose members are themselves collections (TA03's
            // `collection<collection<point>>`) is answered with 422. Dispatching
            // on `spec.type === "collection"` alone sent every leaf we failed to
            // classify down this route.
            if (spec.type === "collection" && kind === "primitive") {
                const items = await this._outputCollectionItems(String(id));
                outputs.push({ spec, id: String(id), kind, items, missing: !items.length });
                continue;
            }
            if (spec.type === "collection") {
                outputs.push({ spec, id: String(id), kind, missing: false });
                continue;
            }

            // Scalars are already in the flat primitive response; match by id
            // first, then by name — a backend that omits the id still names the
            // value after the output key it filled.
            const primitive = base.primitives.find(p => String(p?.id ?? "") === String(id))
                ?? base.primitives.find(p => p?.name === spec.key);
            outputs.push({ spec, id: String(id), kind, primitive, missing: !primitive });
        }

        return { ...base, inputCollections, outputs };
    }

    /**
     * Bind the inputs an earlier job produced.
     *
     * This is what makes postprocessing a step rather than a mode: TA12's
     * `my_cells` is not something the pathologist draws, it is the collection the
     * preprocessing job already found, and the wire needs nothing new for it —
     * `PUT /jobs/{id}/inputs/{key}` takes an id, and `job.outputs[key]` is one.
     *
     * Refuses rather than starting a half-wired job: a run missing an input fails
     * at the backend's input validation with a message about a key the user never
     * heard of.
     */
    private async _wireFromJobInputs(jobId: string, ead: EadDocument, mode: EadMode): Promise<void> {
        const needed = fromJobInputs(ead, mode);
        if (!needed.length) return;

        const source = this._deps.getSourceJob?.(mode);
        if (!source) {
            throw new Error(`This analysis is built on an earlier result, and none is available yet.`);
        }
        const client = this._require("client");
        for (const input of needed) {
            const id = source.outputs?.[input.key];
            if (!id) {
                throw new Error(
                    `Analysis ${String(source.id).slice(0, 8)} produced no "${input.key}" to build on.`);
            }
            await client.setJobInput(jobId, input.key, String(id));
        }
    }

    /**
     * Members of a collection the JOB produced.
     *
     * No creator selector is passed, and none may be: this route's body model
     * forbids both `creators` and `jobs` (see `queryCollectionItems`). The
     * collection id is the whole selector — an output collection holds exactly
     * the items of the job that produced it.
     */
    private async _outputCollectionItems(collectionId: string): Promise<OutputItem[]> {
        const client = this._deps.getClient();
        if (!client) return [];
        try {
            const items = await client.queryCollectionItems(collectionId);
            return (items ?? []).map((item: any) => ({
                value: item?.value,
                reference_id: typeof item?.reference_id === "string" ? item.reference_id : undefined,
            }));
        } catch (e: any) {
            console.warn("[empaia-workbench] output collection query failed:",
                e?.message ?? e, "\n  body:", e?.textData ?? "(none)");
            return [];
        }
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
        const singles = roiInputs(ead, mode).filter(input => input.source === "roi");
        const direct = singles.find(input => input.type === roiType);
        if (direct) return direct.key;

        const any = singles[0];
        if (any) {
            console.warn(`[empaia-workbench] app declares no "${roiType}" ROI input; ` +
                `falling back to "${any.key}" (${any.type}).`);
            return any.key;
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

/**
 * The mode's ROI inputs that are collections — the inputs a staged batch fills.
 *
 * Derived from the input model, so an app whose collection is a *result being
 * consumed* rather than regions to draw (postprocessing) is not mistaken for one
 * the user has to fill by hand.
 */
export function collectionInputKeys(ead: EadDocument, mode: EadMode) {
    return roiInputs(ead, mode)
        .filter(input => input.source === "roi-collection")
        .map(input => ({ inputKey: input.key, type: input.type, inCollection: input.depth }));
}

/** ROI shapes the app accepts, as xOpat factory ids — for the drawing tool. */
export function roiFactoriesFor(ead: EadDocument, mode: EadMode): string[] {
    const seen = new Set<string>();
    for (const input of roiInputs(ead, mode)) seen.add(factoryForRoiType(input.type as EadAnnotationType));
    return [...seen];
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

function warnEmpty<T>(what: string, failed?: string[]): (e: any) => T[] {
    return (e: any) => {
        const status = e?.statusCode ? ` (HTTP ${e.statusCode})` : "";
        console.warn(`[empaia-workbench] ${what} query failed${status}:`, e?.message ?? e);
        failed?.push(what);
        return [];
    };
}
