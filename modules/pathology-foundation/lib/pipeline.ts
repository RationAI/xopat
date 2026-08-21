/**
 * Running many fields through render → analyze without waiting for each other.
 *
 * ## What is actually parallelizable
 *
 * Renders are NOT. The core serializes every off-screen pass per viewer (one drawer, one
 * queue), by design, and fighting that would mean reaching into the renderer. Vision calls
 * ARE: the inference RPC allows four concurrent, and the walk was making them strictly one
 * at a time — the single largest source of wall-clock in a run that is otherwise dominated
 * by waiting on a slow model.
 *
 * So the shape is fixed: render serially, fan the vision calls out behind them. A field's
 * analysis overlaps the NEXT field's render, and three more analyses can be in flight
 * while a fourth field is being rendered.
 *
 * ## Why there is a render window at all
 *
 * Nothing stops the render loop from running far ahead of the analyses, and each raster it
 * produces is ~8 MB of RGBA held until its analysis consumes it. Thirty queued fields is a
 * quarter of a gigabyte of pixels waiting their turn. The window bounds in-flight rasters
 * to a little more than the vision concurrency, which is all that can be usefully consumed.
 *
 * Results are yielded in COMPLETION order, not submission order. A caller that needs
 * submission order should sort on its own field id — imposing it here would reintroduce
 * head-of-line blocking, which is the thing this exists to remove.
 */

export interface PipelineOptions<TField, TRaster, TResult> {
    /** Serialized by the core; the pipeline does not attempt to parallelize it. */
    render: (field: TField) => Promise<TRaster>;
    /** The slow part. Runs at `visionConcurrency`. */
    analyze: (field: TField, raster: TRaster) => Promise<TResult>;
    /**
     * Called when a field fails, instead of failing the run. A walk that loses its whole
     * remaining budget because one region timed out is worse than a walk with a gap in it.
     */
    onError?: (field: TField, error: unknown) => TResult | null;
    /** Rasters allowed in flight or waiting. Default `visionConcurrency + 1`. */
    renderWindow?: number;
    /** Matches the inference RPC's own concurrency cap. */
    visionConcurrency?: number;
    signal?: AbortSignal;
    /** Called after each render, so a caller can free the pixels it no longer needs. */
    onRasterConsumed?: (raster: TRaster) => void;
}

/**
 * Push `fields` through render → analyze, yielding results as they complete.
 *
 * Abort is checked before each render and before each analysis: a call already in flight
 * cannot be recalled, so the pipeline stops at the next boundary rather than pretending
 * it cancelled mid-request.
 */
export async function* runFieldPipeline<TField, TRaster, TResult>(
    fields: TField[],
    opts: PipelineOptions<TField, TRaster, TResult>
): AsyncGenerator<TResult> {
    const visionConcurrency = Math.max(1, opts.visionConcurrency ?? 4);
    const renderWindow = Math.max(1, opts.renderWindow ?? visionConcurrency + 1);

    /** Analyses in flight, keyed so a settled one can remove itself. */
    const inFlight = new Map<number, Promise<{ key: number; result: TResult | null }>>();
    let next = 0;
    let key = 0;

    // The render window bounds resident PIXELS; this bounds concurrent REQUESTS. They are
    // different limits and the wider one must not silently become the effective cap — the
    // inference RPC has its own concurrency ceiling, and exceeding it just moves the queue
    // to the server where this side can no longer see it.
    const vision = createSemaphore(visionConcurrency);

    const startOne = async (field: TField): Promise<TResult | null> => {
        try {
            const raster = await opts.render(field);
            if (opts.signal?.aborted) return null;
            const release = await vision.acquire();
            try {
                if (opts.signal?.aborted) return null;
                return await opts.analyze(field, raster);
            } finally {
                release();
                // The analysis is done with the pixels whether it succeeded or not; the
                // PNG it derived is what the model needed, and that is far smaller.
                opts.onRasterConsumed?.(raster);
            }
        } catch (e) {
            if (opts.onError) return opts.onError(field, e);
            return null;
        }
    };

    while (next < fields.length || inFlight.size) {
        // Top up to the window, unless we have been asked to stop. The window is what
        // bounds resident pixels: the core serializes the renders behind it regardless,
        // so admitting more here would only queue more 8 MB rasters, not produce them
        // any sooner.
        while (!opts.signal?.aborted && next < fields.length && inFlight.size < renderWindow) {
            const k = key++;
            const field = fields[next++];
            inFlight.set(k, startOne(field).then(result => ({ key: k, result })));
        }
        if (!inFlight.size) break;

        const { key: done, result } = await Promise.race(inFlight.values());
        inFlight.delete(done);
        if (result != null) yield result;
    }
}

/** A counting semaphore. `acquire()` resolves with the function that releases it. */
export function createSemaphore(limit: number): { acquire(): Promise<() => void> } {
    let available = Math.max(1, limit);
    const waiting: Array<() => void> = [];
    const release = () => {
        available++;
        // Wake exactly one waiter per release: waking all of them would let every queued
        // caller past the gate at once, which is not a semaphore.
        const nextWaiter = waiting.shift();
        if (nextWaiter) { available--; nextWaiter(); }
    };
    return {
        acquire(): Promise<() => void> {
            if (available > 0) {
                available--;
                return Promise.resolve(once(release));
            }
            return new Promise(resolve => waiting.push(() => resolve(once(release))));
        },
    };
}

/** Guards against a release() called twice handing out a permit that was never held. */
function once(fn: () => void): () => void {
    let done = false;
    return () => { if (!done) { done = true; fn(); } };
}

/**
 * Collect a pipeline run into an array, dropping the fields that failed.
 *
 * For callers that genuinely need every result before continuing. Prefer iterating the
 * generator — publishing after each completion is what lets a cancelled or timed-out run
 * keep the work it already paid for.
 */
export async function collectPipeline<TField, TRaster, TResult>(
    fields: TField[],
    opts: PipelineOptions<TField, TRaster, TResult>
): Promise<TResult[]> {
    const out: TResult[] = [];
    for await (const result of runFieldPipeline(fields, opts)) out.push(result);
    return out;
}
