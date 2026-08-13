"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const { encodeKey, shardOf, safeJoin, assertSegment, SCOPE_SEP } = require("../keys");
const { bufferOf } = require("./memory");

/**
 * Durable file driver. `persistent: true`, `shared: true` — the on-disk copy is
 * the source of truth, which is what makes a namespace correct across cluster
 * workers (`server/node/cluster-index.js` forks `XOPAT_WORKERS` processes, each
 * with its own heap).
 *
 * Layout under `<root>/<ownerUid>/<namespace>/<shape>/`:
 *
 *   unscoped:  <shard>/<stem>-<hash>.json | .ndjson(+.meta.json) | .bin(+.meta.json)
 *   scoped:    s-<encoded scope>/<shard>/<stem>-<hash>.…
 *
 * Scopes get their own directory rather than a key prefix so that
 * `scoped(principal).clear()` — the per-user purge run on session eviction — is
 * one `rm -r` instead of a full-namespace walk.
 *
 * Every write is temp-file + `rename` (atomic within one filesystem), so a
 * crashed or concurrent writer can never leave a half-written record readable.
 */

const EXT = { kv: ".json", log: ".ndjson", blob: ".bin" };
const META_EXT = ".meta.json";
const TAIL_CHUNK = 64 * 1024;

function splitScope(key) {
    const idx = String(key).indexOf(SCOPE_SEP);
    if (idx < 0) return { scope: null, rest: String(key) };
    return { scope: String(key).slice(0, idx), rest: String(key).slice(idx + SCOPE_SEP.length) };
}

function createFileDriver(options = {}) {
    const root = options.root;
    if (!root) throw new Error("file storage driver requires a root directory.");
    const fsync = options.fsync === true;

    function nsDir(ns) {
        return safeJoin(
            root,
            assertSegment(ns.ownerUid, "owner"),
            assertSegment(ns.namespace, "namespace"),
            assertSegment(ns.shape, "shape"),
        );
    }

    /** Directory that holds one key's files, plus its encoded basename. */
    function locate(ns, key) {
        const { scope, rest } = splitScope(key);
        const base = nsDir(ns);
        const dir = scope
            ? safeJoin(base, `s-${encodeKey(scope)}`, shardOf(rest))
            : safeJoin(base, shardOf(rest));
        return { dir, name: encodeKey(rest), scope };
    }

    function filesFor(ns, key) {
        const { dir, name } = locate(ns, key);
        const main = safeJoin(dir, name + EXT[ns.shape]);
        return { dir, main, meta: safeJoin(dir, name + META_EXT) };
    }

    /** Directory a prefix confines the search to, when the prefix names a scope. */
    function searchRoot(ns, prefix) {
        if (!prefix) return { dir: nsDir(ns), scope: null };
        const { scope, rest } = splitScope(prefix);
        if (scope && rest === "") {
            return { dir: safeJoin(nsDir(ns), `s-${encodeKey(scope)}`), scope };
        }
        return { dir: nsDir(ns), scope: null };
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const TRANSIENT_RENAME = new Set(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY", "UNKNOWN"]);

    /**
     * `rename` with a bounded retry.
     *
     * On Windows a rename over an existing destination fails with EPERM/EACCES/
     * EBUSY whenever anything holds a handle on either path for a moment —
     * antivirus scanning the file we just created, the search indexer, a file
     * sync client (OneDrive/Dropbox opens every file it sees created, to upload
     * it, and can hold it for hundreds of ms — so a storage root inside a synced
     * tree is a steady source of these), or a sibling cluster worker reading the
     * record. It is transient; without the retry, a rapid append loop (a chat
     * session taking messages) fails intermittently on Windows only. POSIX never
     * takes this path.
     *
     * The backoff is exponential but capped at ~400ms in total on purpose: this
     * delay is also paid on the failing path of `set`/`append`/`put`, and a
     * longer ceiling turns sustained contention into request queueing rather
     * than a fast, honest error.
     */
    async function renameAtomic(tmp, file, attempts = 8) {
        for (let i = 0; ; i += 1) {
            try {
                await fsp.rename(tmp, file);
                return;
            } catch (e) {
                if (!e || !TRANSIENT_RENAME.has(e.code) || i >= attempts) {
                    await fsp.rm(tmp, { force: true }).catch(() => {});
                    throw e;
                }
                await sleep(Math.min(80, 3 * 2 ** i));
            }
        }
    }

    async function writeAtomic(file, data) {
        await fsp.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
        const handle = await fsp.open(tmp, "w");
        try {
            await handle.writeFile(data);
            if (fsync) await handle.sync();
        } finally {
            await handle.close();
        }
        await renameAtomic(tmp, file);
    }

    async function readJson(file) {
        try {
            return JSON.parse(await fsp.readFile(file, "utf8"));
        } catch (e) {
            // ENOENT is a miss; a malformed record is treated as a miss too —
            // degrade closed rather than throw a 500 into an unrelated request.
            return null;
        }
    }

    function expired(record, now = Date.now()) {
        return !!(record && record.expiresAt && record.expiresAt <= now);
    }

    async function removeKeyFiles(ns, key) {
        const { main, meta } = filesFor(ns, key);
        await Promise.all([
            fsp.rm(main, { force: true }),
            ns.shape === "kv" ? Promise.resolve() : fsp.rm(meta, { force: true }),
        ]);
    }

    /** Walk every record file under `dir`, yielding `{file, metaFile, record}`. */
    async function* walk(ns, dir) {
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { yield* walk(ns, full); continue; }
            if (entry.name.endsWith(".tmp")) continue;
            if (ns.shape === "kv") {
                if (!entry.name.endsWith(EXT.kv)) continue;
                const record = await readJson(full);
                if (record) yield { file: full, metaFile: null, record };
            } else {
                if (!entry.name.endsWith(META_EXT)) continue;
                const record = await readJson(full);
                if (record) {
                    yield {
                        file: full.slice(0, -META_EXT.length) + EXT[ns.shape],
                        metaFile: full,
                        record,
                    };
                }
            }
        }
    }

    /** Read the last `n` newline-delimited entries without loading the file. */
    async function tailLines(file, n) {
        let handle;
        try { handle = await fsp.open(file, "r"); } catch { return []; }
        try {
            const { size } = await handle.stat();
            let pos = size;
            let buf = Buffer.alloc(0);
            let lines = [];
            while (pos > 0) {
                const len = Math.min(TAIL_CHUNK, pos);
                pos -= len;
                const chunk = Buffer.alloc(len);
                await handle.read(chunk, 0, len, pos);
                buf = Buffer.concat([chunk, buf]);
                lines = buf.toString("utf8").split("\n").filter(Boolean);
                // The first line may be truncated unless we reached the start.
                if (pos === 0 ? lines.length >= n : lines.length > n) break;
            }
            return lines.length > n ? lines.slice(lines.length - n) : lines;
        } finally {
            await handle.close();
        }
    }

    function parseLines(lines) {
        const out = [];
        for (const line of lines) {
            try { out.push(JSON.parse(line)); } catch { /* skip a torn line */ }
        }
        return out;
    }

    const driver = {
        id: options.id || "file",
        supports: ["kv", "log", "blob"],
        persistent: true,
        shared: true,
        root,

        // ── kv ───────────────────────────────────────────────────────────────
        async get(ns, key) {
            const { main } = filesFor(ns, key);
            const record = await readJson(main);
            if (!record) return null;
            if (expired(record)) { await fsp.rm(main, { force: true }); return null; }
            return record.value;
        },
        async set(ns, key, value, meta = {}) {
            const { main } = filesFor(ns, key);
            const ttl = meta.ttlMs ?? ns.policy?.ttlMs ?? null;
            await writeAtomic(main, JSON.stringify({
                v: 1,
                key,
                updatedAt: Date.now(),
                expiresAt: ttl ? Date.now() + ttl : null,
                value,
            }));
        },
        /**
         * Removes the record AND its `.meta.json` sidecar.
         *
         * Dropping only the data file orphaned the sidecar forever and — worse —
         * left `length()` answering from it, so a deleted log kept reporting its
         * pre-delete message count while `has()` said it was gone. `stat()` reads
         * the data file, `length()` reads the sidecar; they must disappear together.
         */
        async delete(ns, key) {
            const { main, meta } = filesFor(ns, key);
            let existed = false;
            try { await fsp.rm(main); existed = true; } catch { /* already absent */ }
            if (ns.shape !== "kv") await fsp.rm(meta, { force: true });
            return existed;
        },
        async has(ns, key) {
            return (await driver.stat(ns, key)) !== null;
        },
        /**
         * Refresh the idle TTL. Rewrites only the header, so a touch on a large
         * value is still a full rewrite — callers on the hot path should prefer
         * the tiered driver, whose memory tier absorbs touches.
         */
        async touch(ns, key) {
            const { main } = filesFor(ns, key);
            // Read-modify-write against a file other processes also write. This
            // runs on EVERY authenticated request (session recency), so the
            // naive version — read, mutate, write — routinely raced a concurrent
            // `set` and resurrected the value it had just replaced.
            //
            // The guard compares the raw CONTENT we based our edit on, not the
            // mtime. mtime looks like the obvious version stamp (`stat()` uses
            // it as one) but its granularity is coarse on NTFS and some network
            // filesystems, so two writes inside one tick are indistinguishable —
            // which is precisely the sub-millisecond race this needs to catch.
            //
            // A residual window remains between the re-read and the write; only
            // a lock or backend CAS closes it, and neither is worth paying for on
            // every request. Losing a TTL refresh costs one early expiry;
            // clobbering a concurrent write costs data — so this errs toward
            // giving up.
            for (let attempt = 0; attempt < 3; attempt += 1) {
                let raw;
                try { raw = await fsp.readFile(main, "utf8"); } catch { return false; }

                let record;
                try { record = JSON.parse(raw); } catch { return false; }
                if (!record || expired(record)) return false;

                const ttl = ns.policy?.ttlMs ?? null;
                record.expiresAt = ttl ? Date.now() + ttl : null;
                record.updatedAt = Date.now();

                let confirm;
                try { confirm = await fsp.readFile(main, "utf8"); } catch { return false; }
                if (confirm !== raw) continue;                  // someone wrote; re-read

                // Same "err toward giving up" policy as the race guard above,
                // extended to the WRITE. A refresh that loses to a transient
                // filesystem hold (see `renameAtomic`) costs one early expiry;
                // throwing costs the caller its whole request, and `touch` is on
                // the per-request session path where that surfaced as random
                // EPERM 500s. No caller reads the return value for anything but
                // "did it stick".
                try {
                    await writeAtomic(main, JSON.stringify(record));
                } catch {
                    return false;
                }
                return true;
            }
            return false;
        },
        async stat(ns, key) {
            const { main, meta } = filesFor(ns, key);
            const metaFile = ns.shape === "kv" ? main : meta;
            let st;
            try { st = await fsp.stat(main); } catch { return null; }
            const record = await readJson(metaFile);
            if (record && expired(record)) return null;
            return {
                bytes: st.size,
                updatedAt: record?.updatedAt ?? st.mtimeMs,
                version: String(st.mtimeMs),
                length: record?.length,
                contentType: record?.contentType ?? null,
            };
        },
        async *scan(ns, { prefix = "" } = {}) {
            const { dir } = searchRoot(ns, prefix);
            const now = Date.now();
            for await (const { record } of walk(ns, dir)) {
                if (expired(record, now)) continue;
                if (prefix && !String(record.key).startsWith(prefix)) continue;
                yield [record.key, ns.shape === "kv" ? record.value : undefined];
            }
        },
        async keys(ns, { prefix = "", limit = 0 } = {}) {
            const out = [];
            for await (const [key] of driver.scan(ns, { prefix })) {
                out.push(key);
                if (limit && out.length >= limit) break;
            }
            return out;
        },
        async clear(ns, { prefix = "" } = {}) {
            const { dir, scope } = searchRoot(ns, prefix);
            if (!prefix || scope) {
                // Whole namespace, or a whole scope: one recursive remove.
                await fsp.rm(dir, { recursive: true, force: true });
                return;
            }
            for await (const [key] of driver.scan(ns, { prefix })) {
                await removeKeyFiles(ns, key);
            }
        },

        // ── log ──────────────────────────────────────────────────────────────
        async append(ns, key, entries) {
            const { main, meta, dir } = filesFor(ns, key);
            await fsp.mkdir(dir, { recursive: true });
            const payload = entries.map(e => JSON.stringify(e)).join("\n") + "\n";
            await fsp.appendFile(main, payload, "utf8");

            const record = (await readJson(meta)) || { v: 1, key, length: 0 };
            record.length = (record.length || 0) + entries.length;
            record.updatedAt = Date.now();
            const ttl = ns.policy?.ttlMs ?? null;
            record.expiresAt = ttl ? Date.now() + ttl : null;

            // Amortized trim: rewriting on every append would make a capped log
            // O(cap) per message. 1.25× slack keeps it amortized O(1).
            const cap = ns.policy?.maxEntries;
            if (cap && record.length > cap * 1.25) {
                const kept = parseLines(await tailLines(main, cap));
                await writeAtomic(main, kept.map(e => JSON.stringify(e)).join("\n") + "\n");
                record.length = kept.length;
            }
            await writeAtomic(meta, JSON.stringify(record));
            return record.length;
        },
        async range(ns, key, { from = 0, to, tail } = {}) {
            const { main, meta } = filesFor(ns, key);
            const record = await readJson(meta);
            if (record && expired(record)) return [];
            if (tail) return parseLines(await tailLines(main, tail));
            let raw;
            try { raw = await fsp.readFile(main, "utf8"); } catch { return []; }
            const all = parseLines(raw.split("\n").filter(Boolean));
            return all.slice(from, to === undefined ? undefined : to);
        },
        async length(ns, key) {
            const record = await readJson(filesFor(ns, key).meta);
            return record && !expired(record) ? (record.length || 0) : 0;
        },
        async trim(ns, key, keepTail) {
            const { main, meta } = filesFor(ns, key);
            const record = await readJson(meta);
            if (!record || (record.length || 0) <= keepTail) return record?.length || 0;
            const kept = parseLines(await tailLines(main, keepTail));
            await writeAtomic(main, kept.map(e => JSON.stringify(e)).join("\n") + "\n");
            record.length = kept.length;
            record.updatedAt = Date.now();
            await writeAtomic(meta, JSON.stringify(record));
            return kept.length;
        },

        // ── blob ─────────────────────────────────────────────────────────────
        // A blob is TWO files, and the pair is not atomic. Order matters: the
        // bytes land first and the meta sidecar LAST, so the meta doubles as the
        // commit record — see `read`/`open`, which refuse a blob whose meta is
        // missing rather than serving half-written bytes.
        async put(ns, key, source, meta = {}) {
            const { main, meta: metaFile } = filesFor(ns, key);
            const data = await bufferOf(source);
            // Remove any previous commit record first: between here and the new
            // one being written, this key reads as absent rather than as the old
            // meta describing the new bytes.
            try { await fsp.unlink(metaFile); } catch { /* first write */ }
            await writeAtomic(main, data);
            const ttl = meta.ttlMs ?? ns.policy?.ttlMs ?? null;
            await writeAtomic(metaFile, JSON.stringify({
                v: 1,
                key,
                bytes: data.byteLength,
                contentType: meta.contentType || null,
                updatedAt: Date.now(),
                expiresAt: ttl ? Date.now() + ttl : null,
            }));
            return { bytes: data.byteLength, etag: null };
        },
        async read(ns, key) {
            const { main, meta } = filesFor(ns, key);
            const record = await readJson(meta);
            // No meta = not committed. This used to fall through to reading the
            // bytes anyway (`record && expired(record)`), which is exactly the
            // window `put` opens between the two writes.
            if (!record || expired(record)) return null;
            try { return await fsp.readFile(main); } catch { return null; }
        },
        async open(ns, key) {
            const { main, meta } = filesFor(ns, key);
            const record = await readJson(meta);
            if (!record || expired(record)) return null;
            try {
                await fsp.access(main, fs.constants.R_OK);
            } catch { return null; }
            return fs.createReadStream(main);
        },

        // ── lifecycle ────────────────────────────────────────────────────────
        /**
         * TTL expiry first, then the entry cap by oldest-updated. Both walk the
         * namespace; at the scale these namespaces are configured for (thousands
         * of records) that is a cheap once-a-minute pass, and it is the only way
         * a restart-surviving store reclaims records whose owner process is gone.
         */
        async sweep(ns) {
            const now = Date.now();
            const alive = [];
            let removed = 0;
            for await (const { file, metaFile, record } of walk(ns, nsDir(ns))) {
                if (expired(record, now)) {
                    await Promise.all([
                        fsp.rm(file, { force: true }),
                        metaFile ? fsp.rm(metaFile, { force: true }) : Promise.resolve(),
                    ]);
                    if (typeof ns.onEvict === "function") {
                        try { await ns.onEvict(record.key, undefined, "ttl"); } catch { /* */ }
                    }
                    removed += 1;
                } else {
                    alive.push({ file, metaFile, key: record.key, updatedAt: record.updatedAt || 0 });
                }
            }
            const cap = ns.policy?.maxEntries;
            if (cap && alive.length > cap) {
                alive.sort((a, b) => a.updatedAt - b.updatedAt);
                for (const victim of alive.slice(0, alive.length - cap)) {
                    await Promise.all([
                        fsp.rm(victim.file, { force: true }),
                        victim.metaFile ? fsp.rm(victim.metaFile, { force: true }) : Promise.resolve(),
                    ]);
                    if (typeof ns.onEvict === "function") {
                        try { await ns.onEvict(victim.key, undefined, "lru"); } catch { /* */ }
                    }
                    removed += 1;
                }
            }
            return removed;
        },
        stats() { return []; },
        dispose() { /* no owned resources */ },
    };

    return driver;
}

module.exports = { createFileDriver };
