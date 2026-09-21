"use strict";

const { bufferOf } = require("./memory");

/**
 * Shape adapters. A third-party driver (Redis, Postgres, S3…) should have to
 * implement the KV shape and nothing else; these fill in `log` and `blob` on top
 * of it so `supports: ["kv"]` is a complete driver rather than a partial one.
 *
 * They are deliberately simple — a driver that can do better (Redis lists,
 * S3 multipart) declares the shape itself and skips the adapter.
 */

const CHUNK_BYTES = 512 * 1024;

/**
 * Log over KV: the whole log lives in one KV value.
 *
 * Correct, but O(n) per append — acceptable for the capped namespaces this
 * subsystem configures (hundreds of entries), NOT for an uncapped event stream.
 * A driver whose backend has native append should say `supports: [..., "log"]`.
 */
function withLogOverKV(driver) {
    if (driver.supports.includes("log")) return driver;
    return Object.assign(Object.create(driver), {
        supports: [...driver.supports, "log"],
        async append(ns, key, entries) {
            const current = (await driver.get(ns, logKey(key))) || [];
            const next = current.concat(entries);
            const cap = ns.policy?.maxEntries;
            const trimmed = cap && next.length > cap ? next.slice(next.length - cap) : next;
            await driver.set(ns, logKey(key), trimmed);
            return trimmed.length;
        },
        async range(ns, key, { from = 0, to, tail } = {}) {
            const current = (await driver.get(ns, logKey(key))) || [];
            if (tail) return current.slice(Math.max(0, current.length - tail));
            return current.slice(from, to === undefined ? undefined : to);
        },
        async length(ns, key) {
            return ((await driver.get(ns, logKey(key))) || []).length;
        },
        async trim(ns, key, keepTail) {
            const current = (await driver.get(ns, logKey(key))) || [];
            if (current.length <= keepTail) return current.length;
            const next = current.slice(current.length - keepTail);
            await driver.set(ns, logKey(key), next);
            return next.length;
        },
    });
}

/**
 * Blob over KV: base64 chunks under `<key>#<n>`, plus a `<key>` manifest.
 *
 * Chunking exists because many KV backends cap a single value (Redis strings,
 * row sizes, document limits); a 12 MB chat attachment would not fit as one.
 */
function withBlobOverKV(driver) {
    if (driver.supports.includes("blob")) return driver;
    return Object.assign(Object.create(driver), {
        supports: [...driver.supports, "blob"],
        async put(ns, key, source, meta = {}) {
            const data = await bufferOf(source);
            const chunks = Math.max(1, Math.ceil(data.byteLength / CHUNK_BYTES));
            for (let i = 0; i < chunks; i += 1) {
                const slice = data.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
                await driver.set(ns, `${key}#${i}`, slice.toString("base64"), meta);
            }
            await driver.set(ns, key, {
                __blob: 1,
                bytes: data.byteLength,
                chunks,
                contentType: meta.contentType || null,
            }, meta);
            return { bytes: data.byteLength, etag: null };
        },
        async read(ns, key) {
            const manifest = await driver.get(ns, key);
            if (!manifest || !manifest.__blob) return null;
            const parts = [];
            for (let i = 0; i < manifest.chunks; i += 1) {
                const chunk = await driver.get(ns, `${key}#${i}`);
                if (chunk == null) return null;         // partial write — degrade closed
                parts.push(Buffer.from(chunk, "base64"));
            }
            return Buffer.concat(parts);
        },
        async open(ns, key) {
            const data = await this.read(ns, key);
            if (!data) return null;
            const { Readable } = require("node:stream");
            return Readable.from(data);
        },
        async delete(ns, key) {
            const manifest = await driver.get(ns, key);
            if (manifest && manifest.__blob) {
                for (let i = 0; i < manifest.chunks; i += 1) {
                    await driver.delete(ns, `${key}#${i}`);
                }
            }
            return driver.delete(ns, key);
        },
    });
}

function logKey(key) { return `log:${key}`; }

/** Fill in whatever shapes a driver did not declare. */
function completeDriver(driver) {
    if (!driver || !Array.isArray(driver.supports)) {
        throw new Error("A storage driver must declare a `supports` array.");
    }
    if (!driver.supports.includes("kv")) {
        // Nothing to adapt from; a blob-only driver is legitimate but can only
        // serve blob namespaces.
        return driver;
    }
    return withBlobOverKV(withLogOverKV(driver));
}

module.exports = { withLogOverKV, withBlobOverKV, completeDriver };
