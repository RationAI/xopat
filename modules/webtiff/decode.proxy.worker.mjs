/**
 * Decode worker whose byte source is the main thread.
 *
 * Same job as the bundle's own `dist/decode.worker.mjs`, one difference: it does
 * not fetch. Every range the decoder wants is pulled from the main thread, where
 * `HttpClient` applies auth, CSRF and proxy resolution (§0 rule 3), and where the
 * answers are cached for the other workers.
 *
 * The wasm module is imported by URL at `init` so the build (`st` / `mt`) stays
 * the pool's decision.
 *
 * @module webtiff/decode.proxy.worker
 */

import { Decoder, BytesSource } from "./dist/web-tiff.mjs";

/** The decoder's output enum; the request struct takes the number, not a name. */
const OUTPUT = { gpuTextureSet: 0, tiffRaster: 1, rgba8: 2 };

/** @type {Decoder|null} */
let decoder = null;

/**
 * Resolves once the wasm module is loaded and {@link decoder} exists.
 *
 * A promise rather than a flag because `onmessage` deliberately does not
 * serialize: reads run concurrently, and `init` itself awaits a dynamic import,
 * so a decode arriving in that window would otherwise dereference a null
 * decoder. The host also orders this correctly (`decode-pool.mjs`,
 * `_ensureWorkers`) — this is the gate that makes a future ordering mistake a
 * legible error instead of `Cannot read properties of null`.
 *
 * @type {Promise<void>|null}
 */
let initialized = null;

/**
 * Wait for the decoder, or say plainly that the host skipped `init`.
 * @param {string} op the op that arrived
 * @return {Promise<Decoder>}
 */
async function ready(op) {
    if (!initialized) {
        throw new Error(`[webtiff] decode op "${op}" arrived before init`);
    }
    await initialized;
    return decoder;
}

/** Byte requests waiting on the main thread, by pull id. */
const pulls = new Map();
let nextPullId = 1;

/** Reads in flight, keyed by the message id that started them, for `abort`. */
const reads = new Map();

/**
 * Ask the main thread for a byte range.
 * @param {number} srcId
 * @param {number} offset
 * @param {number} length
 * @return {Promise<Uint8Array>}
 */
function pull(srcId, offset, length) {
    const pullId = nextPullId++;
    return new Promise((resolve, reject) => {
        pulls.set(pullId, { resolve, reject });
        self.postMessage({ kind: "pull", pullId, srcId, offset, length });
    });
}

/**
 * The decoder's source contract, served over the pull channel.
 * @param {number} srcId
 * @param {number} size total file length, learned on the main thread
 */
function proxySource(srcId, size) {
    return {
        async getSize() {
            return size;
        },
        async read(offset, length, signal) {
            if (signal?.aborted) throw new DOMException("aborted", "AbortError");
            return pull(srcId, offset, length);
        },
    };
}

/** Files this worker has open, by the id the decoder gave them. */
const files = new Map();

async function handle(message) {
    switch (message.op) {
        case "init": {
            // Assign before awaiting: an op racing this message must be able to
            // wait for it rather than find `initialized` still null.
            initialized = (async () => {
                const { default: createModule } = await import(/* @vite-ignore */ message.wasmUrl);
                decoder = new Decoder(await createModule());
            })();
            await initialized;
            return { result: { buildInfo: decoder.buildInfo } };
        }
        case "open": {
            const ready_ = await ready("open");
            const source = proxySource(message.srcId, message.size);
            const { id, meta } = await ready_.open(source, message.options ?? {});
            files.set(id, source);
            return { result: { remoteId: id, meta } };
        }
        case "read": {
            const ready_ = await ready("read");
            const controller = new AbortController();
            reads.set(message.id, controller);
            try {
                const { header, bands, packs, transfer } = await ready_.read(
                    message.file, message.req, { signal: controller.signal });
                return { result: { header, bands, packs }, transfer };
            } finally {
                reads.delete(message.id);
            }
        }
        case "decodeBuffer": {
            // A whole TIFF that is itself one tile (a WSI-Service tile response).
            // Opened, read and closed here so the bytes cross the boundary once.
            const ready_ = await ready("decodeBuffer");
            const { id, meta } = await ready_.open(new BytesSource(message.bytes), {});
            try {
                const directory = meta.directories[0];
                const { header, bands, packs, transfer } = await ready_.read(id, {
                    dir: directory.index ?? 0,
                    subifd: -1,
                    sx0: 0,
                    sy0: 0,
                    sx1: directory.width,
                    sy1: directory.height,
                    outWidth: directory.width,
                    outHeight: directory.height,
                    output: OUTPUT[message.output] ?? OUTPUT.gpuTextureSet,
                    packFlags: message.packFlags,
                    padAlpha: message.padAlpha,
                });
                return { result: { header, bands, packs }, transfer };
            } finally {
                ready_.close(id);
            }
        }
        case "close": {
            const ready_ = await ready("close");
            ready_.close(message.file);
            files.delete(message.file);
            return { result: null };
        }
        case "abort":
            reads.get(message.target)?.abort();
            return { result: null };
        default:
            throw new Error(`[webtiff] unknown op: ${message.op}`);
    }
}

/** Forward whatever the decoder complained about since the last message. */
function drainWarnings() {
    if (!decoder) return;
    for (const warning of decoder.drainWarnings()) {
        self.postMessage({ kind: "warn", ...warning });
    }
}

self.onmessage = async (event) => {
    const message = event.data;

    // Byte answers are replies, not requests: they resolve a pending pull and
    // carry no id of their own.
    if (message?.kind === "bytes") {
        const pending = pulls.get(message.pullId);
        if (!pending) return;
        pulls.delete(message.pullId);
        if (message.ok) pending.resolve(message.bytes);
        else {
            const error = new Error(message.error?.message || "[webtiff] byte read failed");
            error.name = message.error?.name || "Error";
            error.status = message.error?.status ?? null;
            pending.reject(error);
        }
        return;
    }

    try {
        const { result, transfer } = await handle(message);
        drainWarnings();
        self.postMessage({ id: message.id, ok: true, result }, transfer ?? []);
    } catch (e) {
        drainWarnings();
        self.postMessage({
            id: message.id,
            ok: false,
            // Structured cloning drops the subclass, so send what a caller acts on.
            error: {
                name: e?.name ?? "Error",
                message: e?.message ?? String(e),
                status: e?.status ?? null,
                url: e?.url ?? null,
                code: e?.code ?? null,
            },
        });
    }
};

self.postMessage({ kind: "ready" });
