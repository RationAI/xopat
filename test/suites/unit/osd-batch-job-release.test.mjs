/**
 * A tile that is never released is worse than a tile that fails.
 *
 * `TiledImage#_loadTile` hands the loader an `abort` whose whole job is
 * `tile.loading = false`. If that never runs, the tile is not merely un-drawn —
 * it is self-sealing: `_updateLevel` counts it under `_tilesLoading` and takes
 * the `else if` branch away from it, so it is never a load candidate again; the
 * `loadingCoverage` map records its cell as covered, so nothing backfills the
 * hole; `_updateLevelsForViewport` can never return `_tilesLoading === 0`, so
 * the image is never `fullyLoaded`; and `TileCache` refuses to evict a record
 * that is still `loading`. One missed abort is a permanently coarse patch of
 * slide with no error and no pending request.
 *
 * `ImageLoader.clear()` runs on every viewport change (`drawWorld`), and it
 * releases a job only if it finds an `abort` on it. `BatchImageJob` installs its
 * `abort` inside `start()`, so a batch that was *queued* rather than started —
 * which is what happens whenever the loader is at `jobLimit` — has none, and is
 * dropped with all its children un-settled. That is the bug these vectors pin,
 * filed in UPSTREAM.md; today only `DICOMWebTileSource` batches, so today it is
 * a DICOM slide that stalls under sharp SEG/parametric overlays.
 *
 * The staged case is asserted alongside it because it was fixed once already
 * and shares the code a fix will touch.
 */
import { test, expect, loadOpenSeadragon } from "@xopat/test-harness";

const { OpenSeadragon, error: loadError } = loadOpenSeadragon();

/**
 * The re-vendor marker for the whole UPSTREAM.md entry. The fix moves `abort`
 * onto the prototype precisely so that `typeof job.abort === "function"` is
 * structurally true and `clear()`'s guard cannot silently miss a job again —
 * which makes it the capability probe too, since the bundle's banner version
 * does not move on a fork rebuild.
 */
const fixLanded = typeof OpenSeadragon?.BatchImageJob?.prototype?.abort === "function";

/**
 * A source that batches and never settles anything, so a job's fate is decided
 * entirely by the loader.
 *
 * @param {object} [over] `batchMaxJobs` / `batchTimeout` overrides per vector
 */
function makeBatchingSource(over = {}) {
    const source = {
        /** Batch jobs handed to `downloadTileBatchStart`, kept so timers can be cleared. */
        started: [],
        soloed: [],
        batchEnabled: () => true,
        batchCompatible: (other) => other === source,
        batchMaxJobs: over.batchMaxJobs ?? (() => 1),
        batchTimeout: over.batchTimeout ?? (() => 5000),
        downloadTileBatchStart(batchJob) { source.started.push(batchJob); },
        downloadTileBatchAbort() {},
        downloadTileStart(job) { source.soloed.push(job); },
        downloadTileAbort() {},
    };
    return source;
}

/**
 * Mimic `TiledImage#_loadTile`: mark the tile loading and hand the loader the
 * release as `abort`. Asserting on this object rather than on `job.tile` is
 * deliberate — `ImageJob` deep-extends its options, so the job carries a clone.
 */
function addTileJob(loader, source, id) {
    const tile = { id, loading: true, loaded: false };
    loader.addJob({
        src: `https://store.example/frames/${id}`,
        tile,
        source,
        callback: () => {},
        abort: () => { tile.loading = false; },
    });
    return tile;
}

/** Stop the never-settling batches' timeouts from outliving the test. */
function releaseTimers(source) {
    for (const batchJob of source.started) {
        if (batchJob.jobId) clearTimeout(batchJob.jobId);
    }
}

test("@upstream a queued batch releases its tiles when the loader is cleared", () => {
    test.skip(Boolean(loadError), loadError ?? "");
    test.skip(!fixLanded, "awaiting the OpenSeadragon re-vendor — see UPSTREAM.md");

    // jobLimit 1 with a bucket that flushes at one job: the first batch starts,
    // the second has nowhere to go but the queue.
    const loader = new OpenSeadragon.ImageLoader({ jobLimit: 1, timeout: 5000 });
    const source = makeBatchingSource();

    const started = addTileJob(loader, source, "started");
    const queued = addTileJob(loader, source, "queued");

    expect(loader.jobsInProgress).toBe(1);
    expect(loader.jobQueue.length).toBe(1);

    loader.clear();

    expect(queued.loading).toBe(false);
    expect(loader.jobQueue.length).toBe(0);
    // The in-flight batch is not the subject: `clear()` only drops what is queued.
    expect(started.loading).toBe(true);

    releaseTimers(source);
});

test("@upstream a batch still staged in its bucket releases its tiles too", () => {
    test.skip(Boolean(loadError), loadError ?? "");

    // A wide bucket with a long wait: the job is staged and never flushed.
    const loader = new OpenSeadragon.ImageLoader({ jobLimit: 4, timeout: 5000 });
    const source = makeBatchingSource({ batchMaxJobs: () => 8, batchTimeout: () => 60_000 });

    const staged = addTileJob(loader, source, "staged");

    expect(loader.jobsInProgress).toBe(0);
    expect(loader.jobQueue.length).toBe(0);
    expect(source.started.length).toBe(0);

    loader.clear();

    expect(staged.loading).toBe(false);

    releaseTimers(source);
});

test("@upstream a failed batch calls back exactly once", () => {
    test.skip(Boolean(loadError), loadError ?? "");
    test.skip(!fixLanded, "awaiting the OpenSeadragon re-vendor — see UPSTREAM.md");

    // The last child's wrapped `fail` already reaches the completion branch and
    // fires the callback; `fail()` must not fire it a second time. The callback
    // is `completeBatchJob`, so a double call decrements `jobsInProgress` twice,
    // it drifts negative, `canAcceptNewJob()` is then always true and
    // `imageLoaderLimit` stops applying.
    const source = makeBatchingSource();
    let callbacks = 0;

    const children = ["a", "b"].map((id) => new OpenSeadragon.ImageJob({
        src: `https://store.example/frames/${id}`,
        tile: { id },
        source,
        callback: () => {},
        timeout: 5000,
    }));

    const batchJob = new OpenSeadragon.BatchImageJob({
        source,
        jobs: children,
        timeout: 5000,
        callback: () => { callbacks++; },
    });

    batchJob.start();
    batchJob.fail("upstream refused the group", null);

    expect(callbacks).toBe(1);

    releaseTimers(source);
    if (batchJob.jobId) clearTimeout(batchJob.jobId);
});
