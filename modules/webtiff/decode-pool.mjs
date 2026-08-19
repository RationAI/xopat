/**
 * Decoder pool whose bytes come from the main thread.
 *
 * The vendored bundle ships its own worker pool, and it is deliberately not used
 * here. That pool hands the worker a *URL* and lets the worker fetch it with the
 * global `fetch` — which in xOpat means no JWT, no CSRF, no proxy alias and no
 * secureMode policy (§0 rule 3). The bundle's only escape hatch, `{ fetch }`,
 * disables the worker entirely and runs libtiff on the main thread, which is
 * worse: a 512² 16-bit tile decode is tens of milliseconds of blocked UI.
 *
 * So the transport is split the way `geotiff` already splits it: **HTTP on the
 * main thread through `HttpClient`, decode in workers**. The worker asks for a
 * byte range, the main thread answers it, and the answer is cached so the second
 * worker that opens the same file does not re-fetch its header.
 *
 * This is a xOpat-side adapter around a library gap, not a patch of the library:
 * everything here is the documented `{ pool }` extension point of `openTiff`,
 * plus a worker of our own that speaks the same decoder API. The clean fix is a
 * `kind: "proxy"` source in web-tiff's own worker protocol — see README,
 * *Upstream*.
 *
 * @module webtiff/decode-pool
 */

import { toSource } from "./dist/web-tiff.mjs";

/** Where the wasm builds live; the worker imports the one we name. */
const wasmUrlFor = (build) => new URL(`./dist/webtiff-${build}.mjs`, import.meta.url).href;

/** Our worker, not the bundle's — the bundle's cannot read through a proxy. */
const WORKER_URL = new URL("./decode.proxy.worker.mjs", import.meta.url);

const defaultPoolSize = () => {
    const cores = globalThis.navigator?.hardwareConcurrency ?? 4;
    return Math.min(4, Math.max(1, Math.ceil(cores / 2)));
};

/**
 * A byte source shared by every worker that opened the same file.
 *
 * Two workers decoding one slide plan overlapping reads — the header region
 * above all, which each of them parses on open. Without a cache that is one
 * duplicated range request per worker per block; with it, the second worker's
 * open is free.
 *
 * Bounded by block count rather than bytes because the decoder only ever asks
 * for block-aligned ranges (64 KB by default), so the two are the same number.
 */
class CachedByteSource {
    /**
     * @param {{getSize: function(): Promise<number>, read: function(number, number, AbortSignal=): Promise<Uint8Array>}} source
     * @param {number} blocks how many recent reads to keep
     */
    constructor(source, blocks) {
        this._source = source;
        this._blocks = Math.max(0, blocks | 0);
        /** @type {Map<string, Promise<Uint8Array>|Uint8Array>} insertion order = LRU order */
        this._cache = new Map();
    }

    getSize() {
        return this._source.getSize();
    }

    /**
     * @param {number} offset
     * @param {number} length
     * @return {Promise<Uint8Array>}
     */
    async read(offset, length) {
        if (!this._blocks) return this._source.read(offset, length);

        const key = `${offset}:${length}`;
        const hit = this._cache.get(key);
        if (hit) {
            // Refresh recency. A pending promise is cached too, which is what
            // collapses two workers asking for the same block at the same time.
            this._cache.delete(key);
            this._cache.set(key, hit);
            return hit;
        }

        const pending = Promise.resolve(this._source.read(offset, length))
            .catch((e) => {
                // A failed read must not be remembered: the retry would replay the
                // failure forever instead of asking the server again.
                this._cache.delete(key);
                throw e;
            });
        this._cache.set(key, pending);
        while (this._cache.size > this._blocks) {
            this._cache.delete(this._cache.keys().next().value);
        }
        return pending;
    }
}

/**
 * One worker and the requests in flight on it.
 *
 * Byte pulls travel the other way — worker asks, main thread answers — so they
 * are not requests and do not count toward `inFlight`; only decode work does,
 * because that is what the least-busy choice is trying to balance.
 */
class WorkerClient {
    /**
     * @param {Worker} worker
     * @param {object} handlers
     * @param {function(object, WorkerClient): void} handlers.onPull
     * @param {function(object): void} [handlers.onWarning]
     */
    constructor(worker, { onPull, onWarning }) {
        this._worker = worker;
        this._pending = new Map();
        this._nextId = 1;
        this.inFlight = 0;
        /** Files this worker has open, keyed by our source id. */
        this.files = new Map();

        this.ready = new Promise((resolve) => {
            const onReady = (event) => {
                if (event.data?.kind !== "ready") return;
                worker.removeEventListener("message", onReady);
                resolve();
            };
            worker.addEventListener("message", onReady);
        });

        worker.addEventListener("message", (event) => {
            const message = event.data;
            if (message?.kind === "pull") {
                onPull(message, this);
                return;
            }
            if (message?.kind === "warn") {
                onWarning?.(message);
                return;
            }
            if (message?.kind) return;   // ready, handled above

            const entry = this._pending.get(message.id);
            if (!entry) return;
            this._pending.delete(message.id);
            this.inFlight--;
            if (message.ok) entry.resolve(message.result);
            else entry.reject(rebuildError(message.error));
        });

        worker.addEventListener("error", (event) => {
            // A worker that died takes every request on it with it; failing them
            // is the only way the tiles above ever resolve.
            const error = new Error(event.message || "[webtiff] decode worker failed");
            for (const [, entry] of this._pending) entry.reject(error);
            this._pending.clear();
            this.inFlight = 0;
        });
    }

    /**
     * @param {object} message
     * @param {Transferable[]} [transfer]
     * @return {Promise<any>} and the message id, via {@link lastMessageId}
     */
    send(message, transfer = []) {
        const id = this._nextId++;
        this.lastMessageId = id;
        this.inFlight++;
        return new Promise((resolve, reject) => {
            this._pending.set(id, { resolve, reject });
            this._worker.postMessage({ ...message, id }, transfer);
        });
    }

    /** Fire-and-forget, for the byte answers and aborts that carry no reply. */
    post(message, transfer = []) {
        this._worker.postMessage(message, transfer);
    }

    terminate() {
        this._worker.terminate();
    }
}

/**
 * Errors do not survive structured cloning with their type intact, so the worker
 * sends the fields a caller acts on and they are rebuilt here.
 * @param {object} [payload]
 * @return {Error}
 */
function rebuildError(payload) {
    const error = payload?.name === "AbortError"
        ? new DOMException(payload.message || "aborted", "AbortError")
        : new Error(payload?.message || "[webtiff] decode failed");
    if (payload?.status != null) error.status = payload.status;
    if (payload?.url) error.url = payload.url;
    if (payload?.code != null) error.code = payload.code;
    return error;
}

/**
 * A decoder pool that satisfies the `{ pool }` contract of `openTiff`.
 *
 * `openTiff` calls `open(src, options)` once and `read(id, req)` per tile; that
 * is the whole interface. Workers are created on the first open, and a file is
 * opened on a second worker only when a read finds the first one busy — a
 * single-slide session with a warm cache never pays for four block caches.
 */
export class ProxyDecoderPool {
    /**
     * @param {object} [options]
     * @param {number} [options.size] worker count; defaults to half the cores, max 4
     * @param {string} [options.build] `"st"` (default) or `"mt"`
     * @param {number} [options.blockSize] decoder block size, bytes
     * @param {number} [options.cacheBytes] decoder block cache per worker, bytes
     * @param {number} [options.byteCacheBlocks] main-side range cache, in blocks
     * @param {function(object): void} [options.onWarning]
     * @param {function(string, init?: object): Promise<Response>} [options.fetch]
     *      the transport every byte travels through; `HttpClient`'s adapter in
     *      xOpat. Not per-open, because `openTiff` does not forward it here.
     */
    constructor(options = {}) {
        this._options = options;
        this._size = Math.max(1, options.size || defaultPoolSize());
        this._wasmUrl = wasmUrlFor(options.build === "mt" ? "mt" : "st");
        this._workers = null;
        this._starting = null;
        this._sources = new Map();      // srcId -> {byteSource, size, openOptions}
        this._files = new Map();        // fileId -> {srcId, meta}
        this._nextSrc = 1;
        this._nextFile = 1;
    }

    /** @return {number} workers ready to decode (0 until startup completes). */
    get size() {
        return this._workers ? this._workers.length : 0;
    }

    /**
     * Create the workers and load the wasm into them — once, for all callers.
     *
     * The obvious shape (`if (this._workers) return this._workers;` and then fill
     * the array) is a race, and a loud one: a slide open converts tiles
     * independently, several at a time, so the second caller sees the array the
     * first one just assigned, returns immediately, and posts a decode into a
     * worker whose wasm module has not loaded yet — `Cannot read properties of
     * null (reading 'open')`, once per tile of the first burst. Everything is
     * published only after every `init` has answered, and everyone waits on the
     * same promise.
     *
     * @return {Promise<WorkerClient[]>}
     */
    _ensureWorkers() {
        if (!this._starting) {
            this._starting = (async () => {
                if (typeof Worker === "undefined") {
                    throw new Error("[webtiff] Web Workers are unavailable; TIFF decoding needs them.");
                }
                const workers = [];
                for (let i = 0; i < this._size; i++) {
                    workers.push(new WorkerClient(new Worker(WORKER_URL, { type: "module" }), {
                        onPull: (message, worker) => this._servePull(message, worker),
                        onWarning: this._options.onWarning,
                    }));
                }
                await Promise.all(workers.map(w => w.ready));
                await Promise.all(workers.map(w => w.send({ op: "init", wasmUrl: this._wasmUrl })));
                this._workers = workers;
                return workers;
            })().catch(e => {
                // A failed startup must not be remembered as "starting": the next
                // slide would await a promise that can never resolve.
                this._starting = null;
                throw e;
            });
        }
        return this._starting;
    }

    /**
     * Answer a worker's byte request from the main thread, where `HttpClient` is.
     * @param {{pullId: number, srcId: number, offset: number, length: number}} message
     * @param {WorkerClient} worker
     */
    async _servePull(message, worker) {
        const record = this._sources.get(message.srcId);
        try {
            if (!record) throw new Error(`[webtiff] unknown source ${message.srcId}`);
            const bytes = await record.byteSource.read(message.offset, message.length);
            // A copy, deliberately: the cached array may be a view into a buffer
            // shared with other reads, and transferring it would detach that
            // buffer under everyone else. 64 KB memcpy against a network read.
            const copy = new Uint8Array(bytes.byteLength);
            copy.set(bytes);
            worker.post({ kind: "bytes", pullId: message.pullId, ok: true, bytes: copy }, [copy.buffer]);
        } catch (e) {
            worker.post({
                kind: "bytes",
                pullId: message.pullId,
                ok: false,
                error: { name: e?.name, message: e?.message || String(e), status: e?.status ?? null },
            });
        }
    }

    /** The worker with the fewest decodes in flight; ties keep warm caches warm. */
    _leastBusy() {
        let best = this._workers[0];
        for (const worker of this._workers) {
            if (worker.inFlight < best.inFlight) best = worker;
        }
        return best;
    }

    /**
     * Make sure `worker` has this file open, and give back its remote id.
     * @param {WorkerClient} worker
     * @param {number} srcId
     * @return {Promise<number>}
     */
    _openOn(worker, srcId) {
        const known = worker.files.get(srcId);
        if (known) return known;

        const record = this._sources.get(srcId);
        const pending = worker.send({
            op: "open",
            srcId,
            size: record.size,
            options: record.openOptions,
        }).then(result => {
            record.meta = record.meta || result.meta;
            return result.remoteId;
        }).catch(e => {
            // Leave nothing cached: a retry must be allowed to open again.
            worker.files.delete(srcId);
            throw e;
        });
        worker.files.set(srcId, pending);
        return pending;
    }

    /**
     * Open a file. Called by `openTiff` with whatever it was given.
     *
     * `openTiff` forwards only `blockSize`, `cacheBytes` and `signal` here — the
     * `fetch` never reaches this call, which is why the pool carries its own
     * (`options.fetch` at construction). One `HttpClient`-backed fetch serves
     * every URL: the adapter picks the client per URL, so a per-protocol client
     * is honoured without the pool knowing protocols exist.
     *
     * @param {string|URL|Blob|Uint8Array|ArrayBuffer} src
     * @param {object} [options] `blockSize`, `cacheBytes`
     * @return {Promise<{id: number, meta: object}>}
     */
    async open(src, options = {}) {
        await this._ensureWorkers();

        const source = await toSource(src, {
            fetch: options.fetch ?? this._options.fetch,
            headers: options.headers ?? this._options.headers,
            credentials: options.credentials ?? this._options.credentials,
            captureErrorBody: true,
        });
        const byteSource = new CachedByteSource(source, this._options.byteCacheBlocks ?? 96);
        const size = await byteSource.getSize();

        const srcId = this._nextSrc++;
        this._sources.set(srcId, {
            byteSource,
            size,
            openOptions: {
                blockSize: options.blockSize ?? this._options.blockSize,
                cacheBytes: options.cacheBytes ?? this._options.cacheBytes,
            },
        });

        const worker = this._leastBusy();
        const remoteId = await this._openOn(worker, srcId);
        const meta = this._sources.get(srcId).meta;
        if (!meta) {
            // `_openOn` stores the meta the worker parsed; no meta means the open
            // resolved without one, which is a bug rather than a file problem.
            throw new Error("[webtiff] the decoder opened the file but reported no metadata");
        }

        const fileId = this._nextFile++;
        this._files.set(fileId, { srcId, remoteId, meta });
        return { id: fileId, meta };
    }

    /**
     * Decode one window. Routed to whichever worker is least busy right now, so
     * a viewport's worth of tiles decodes in parallel rather than one at a time.
     *
     * @param {number} fileId
     * @param {object} req the decoder's region request
     * @param {{signal?: AbortSignal}} [options]
     * @return {Promise<{header: object, bands: object[], packs: object[]}>}
     */
    async read(fileId, req, { signal } = {}) {
        const file = this._files.get(fileId);
        if (!file) throw new Error(`[webtiff] unknown file ${fileId}`);

        const worker = this._leastBusy();
        const remoteId = await this._openOn(worker, file.srcId);
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");

        const pending = worker.send({ op: "read", file: remoteId, req });
        const messageId = worker.lastMessageId;
        if (signal) {
            signal.addEventListener("abort",
                () => worker.post({ op: "abort", target: messageId }), { once: true });
        }
        return pending;
    }

    /**
     * Decode a self-contained TIFF buffer — a *tile* that arrived as TIFF bytes
     * from a server, not a slide the decoder reads by range.
     *
     * One round trip: the bytes are transferred into a worker, opened, read and
     * closed there. Going through {@link open} instead would make the worker pull
     * back over the byte channel data the main thread already has in hand.
     *
     * @param {Uint8Array} bytes the tile, consumed (its buffer is transferred)
     * @param {object} [options]
     * @param {"gpuTextureSet"|"tiffRaster"|"rgba8"} [options.output]
     * @param {number} [options.packFlags] decoder packing flags
     * @param {number} [options.padAlpha] value for a pack lane with no channel
     * @return {Promise<{header: object, bands: object[], packs: object[]}>}
     */
    async decodeBuffer(bytes, { output = "gpuTextureSet", packFlags = 1, padAlpha = 1 } = {}) {
        await this._ensureWorkers();
        const worker = this._leastBusy();
        return worker.send({ op: "decodeBuffer", bytes, output, packFlags, padAlpha },
            [bytes.buffer]);
    }

    /**
     * Close a file everywhere it was opened, and drop its byte cache.
     * @param {number} fileId
     */
    close(fileId) {
        const file = this._files.get(fileId);
        if (!file) return;
        this._files.delete(fileId);
        for (const worker of this._workers || []) {
            const remote = worker.files.get(file.srcId);
            if (!remote) continue;
            worker.files.delete(file.srcId);
            Promise.resolve(remote)
                .then(remoteId => worker.send({ op: "close", file: remoteId }))
                .catch((e) => {
                    // A file that never opened needs no closing, so this is not
                    // fatal — but a worker that crashed reports here too, and
                    // swallowing made that invisible.
                    console.debug("[webtiff] worker close failed", e);
                });
        }
        this._sources.delete(file.srcId);
    }

    terminate() {
        for (const worker of this._workers || []) worker.terminate();
        this._workers = null;
        this._starting = null;      // a later use starts a fresh pool
        this._files.clear();
        this._sources.clear();
    }
}
