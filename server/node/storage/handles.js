"use strict";

const { scopedKey, scopePrefix, unscopeKey } = require("./keys");

/**
 * Owner+namespace-bound handles. Everything is async — there is no sync façade
 * on the server, because a sync API would forbid every interesting backend.
 *
 * A binding list is a **read-fallback chain**: writes go to `drivers[0]`, reads
 * fall through the rest on miss. `["redis", "file"]` therefore reads legacy
 * records off disk while all new writes land in Redis — drain, then drop the
 * tail from the config.
 */

class BaseHandle {
    /**
     * @param {object} args
     * @param {object} args.ns        namespace descriptor handed to drivers
     * @param {object[]} args.drivers primary first, then read fallbacks
     * @param {string|null} args.scope
     */
    constructor({ ns, drivers, scope = null }) {
        this.ns = ns;
        this.ownerUid = ns.ownerUid;
        this.namespace = ns.namespace;
        this.capabilityId = ns.capabilityId;
        this.scope = scope;
        this._drivers = drivers;
    }

    get driver() { return this._drivers[0]; }
    /** True when the primary driver survives a restart. */
    get persistent() { return this.driver.persistent === true; }

    _key(key) {
        if (key === undefined || key === null || key === "") {
            throw new Error(`Storage key is required (${this.ownerUid}/${this.capabilityId}).`);
        }
        return scopedKey(this.scope, key);
    }

    _prefix(prefix = "") {
        return scopePrefix(this.scope) + (prefix || "");
    }

    /** First non-null result across the fallback chain. */
    async _readThrough(fn) {
        for (const driver of this._drivers) {
            const value = await fn(driver);
            if (value !== null && value !== undefined) return value;
        }
        return null;
    }

    /**
     * Per-caller isolation as a property of the broker rather than per-module
     * ACL code: a scoped handle prefixes every key, cannot address anything
     * outside its scope, and `clear()` purges exactly that caller's records.
     *
     * Pass `XOPAT_SERVER.resolvePrincipal(ctx)` — never an id taken from the
     * request body.
     */
    scoped(principal) {
        if (!principal) throw new Error("scoped() requires a principal.");
        const Ctor = this.constructor;
        return new Ctor({ ns: this.ns, drivers: this._drivers, scope: String(principal) });
    }

    async clear() {
        const prefix = this._prefix();
        for (const driver of this._drivers) await driver.clear(this.ns, { prefix });
    }
}

class KVHandle extends BaseHandle {
    async get(key, defaultValue = null) {
        const k = this._key(key);
        const value = await this._readThrough(d => d.get(this.ns, k));
        return value === null || value === undefined ? defaultValue : value;
    }

    /** @param {{ttlMs?:number}} [meta] per-entry TTL override. */
    async set(key, value, meta = {}) {
        await this.driver.set(this.ns, this._key(key), value, meta);
    }

    async delete(key) {
        const k = this._key(key);
        let removed = false;
        for (const driver of this._drivers) removed = (await driver.delete(this.ns, k)) || removed;
        return removed;
    }

    async has(key) {
        const k = this._key(key);
        for (const driver of this._drivers) if (await driver.has(this.ns, k)) return true;
        return false;
    }

    /** Refresh the idle TTL without reading the value. */
    async touch(key) {
        return this.driver.touch ? this.driver.touch(this.ns, this._key(key)) : false;
    }

    async stat(key) {
        return this._readThrough(d => d.stat(this.ns, this._key(key)));
    }

    /** Streams `[key, value]` from the primary driver only. */
    async *scan({ prefix = "" } = {}) {
        for await (const [key, value] of this.driver.scan(this.ns, { prefix: this._prefix(prefix) })) {
            yield [unscopeKey(this.scope, key), value];
        }
    }

    async keys({ prefix = "", limit = 0 } = {}) {
        const keys = await this.driver.keys(this.ns, { prefix: this._prefix(prefix), limit });
        return keys.map(k => unscopeKey(this.scope, k));
    }
}

class LogHandle extends BaseHandle {
    /** @returns {Promise<number>} the log's length after the append. */
    async append(key, entries) {
        const list = Array.isArray(entries) ? entries : [entries];
        if (!list.length) return this.length(key);
        return this.driver.append(this.ns, this._key(key), list);
    }

    /** The last `n` entries — the read the LLM turn window actually needs. */
    async tail(key, n) {
        return this._rangeThrough(key, { tail: Math.max(0, Number(n) || 0) });
    }

    async range(key, from = 0, to) {
        return this._rangeThrough(key, { from, to });
    }

    async _rangeThrough(key, opts) {
        const k = this._key(key);
        for (const driver of this._drivers) {
            const rows = await driver.range(this.ns, k, opts);
            if (rows && rows.length) return rows;
        }
        return [];
    }

    async length(key) {
        const k = this._key(key);
        for (const driver of this._drivers) {
            const n = await driver.length(this.ns, k);
            if (n) return n;
        }
        return 0;
    }

    async trim(key, keepTail) {
        return this.driver.trim(this.ns, this._key(key), Math.max(0, Number(keepTail) || 0));
    }

    async delete(key) {
        const k = this._key(key);
        let removed = false;
        for (const driver of this._drivers) removed = (await driver.delete(this.ns, k)) || removed;
        return removed;
    }

    async keys({ prefix = "", limit = 0 } = {}) {
        const keys = await this.driver.keys(this.ns, { prefix: this._prefix(prefix), limit });
        return keys.map(k => unscopeKey(this.scope, k));
    }
}

class BlobHandle extends BaseHandle {
    /**
     * @param {Buffer|Uint8Array|string|AsyncIterable} source
     * @param {{contentType?:string, ttlMs?:number}} [meta]
     * @returns {Promise<{bytes:number, etag:string|null}>}
     */
    async put(key, source, meta = {}) {
        const max = this.ns.policy?.maxEntryBytes;
        if (max && Buffer.isBuffer(source) && source.byteLength > max) {
            throw new Error(
                `Blob exceeds maxEntryBytes for ${this.ownerUid}/${this.capabilityId} ` +
                `(${source.byteLength} > ${max}).`);
        }
        return this.driver.put(this.ns, this._key(key), source, meta);
    }

    /** @returns {Promise<Buffer|null>} */
    async get(key) {
        return this._readThrough(d => d.read(this.ns, this._key(key)));
    }

    /** @returns {Promise<import("node:stream").Readable|null>} */
    async stream(key) {
        return this._readThrough(d => d.open(this.ns, this._key(key)));
    }

    async stat(key) {
        return this._readThrough(d => d.stat(this.ns, this._key(key)));
    }

    async delete(key) {
        const k = this._key(key);
        let removed = false;
        for (const driver of this._drivers) removed = (await driver.delete(this.ns, k)) || removed;
        return removed;
    }

    async keys({ prefix = "", limit = 0 } = {}) {
        const keys = await this.driver.keys(this.ns, { prefix: this._prefix(prefix), limit });
        return keys.map(k => unscopeKey(this.scope, k));
    }
}

module.exports = { KVHandle, LogHandle, BlobHandle, BaseHandle };
