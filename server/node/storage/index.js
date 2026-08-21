"use strict";

const path = require("node:path");

const { createBoundedCache, getAllCacheStats, BoundedCache } = require("./bounded-cache");
const { createPolicyResolver, StorageConfigError } = require("./policy");
const { createMemoryDriver } = require("./drivers/memory");
const { createFileDriver } = require("./drivers/file");
const { createTieredDriver } = require("./drivers/tiered");
const { completeDriver } = require("./drivers/adapters");
const { createSweeper } = require("./sweeper");
const { KVHandle, LogHandle, BlobHandle } = require("./handles");
const { assertSegment } = require("./keys");

/**
 * The server-side storage broker — `XOPAT_SERVER.storage`.
 *
 * Server code must not keep unbounded state in a module-level `Map`. There are
 * two supported places for state, and which one you want is decided by a single
 * question: *can the value be serialized?*
 *
 *   XOPAT_SERVER.cache    in-process, bounded, any JS value (promises, KeyObjects,
 *                         SDK clients, decoded buffers). Cheap to rebuild; lost
 *                         on restart by design.
 *   XOPAT_SERVER.storage  pluggable and durable-capable. JSON values (`kv`),
 *                         append-only records (`log`), bytes (`blob`).
 *
 * The model mirrors the client's IO pipeline (`src/IO_PIPELINE.md`):
 *
 *   owner uid -> namespace -> capability id -> BINDING -> driver(s)
 *                                           -> POLICY  -> {ttlMs, maxEntries, …}
 *
 * Policy is orthogonal to driver. "A bounded memory cache" and "a durable file
 * store" are the same namespace with different bindings — which is what lets an
 * operator move chat transcripts onto disk, or onto a module-provided Redis
 * driver, without a line of module code changing.
 *
 * See `server/STORAGE.md`.
 */

const SHAPES = ["kv", "log", "blob"];

function createServerStorage({ cacheDir, getConfig, logger = console } = {}) {
    const policy = createPolicyResolver(getConfig, logger);

    const rootOf = () => {
        const configured = policy.config().root || process.env.XOPAT_STORAGE_ROOT;
        if (configured) return path.resolve(String(configured));
        return path.join(cacheDir || process.cwd(), "storage");
    };
    const root = rootOf();

    /** @type {Map<string, object>} */
    const drivers = new Map();
    /** @type {Map<string, object>} handleKey -> handle */
    const handles = new Map();

    const sweeper = createSweeper({
        intervalMs: Number(policy.config().sweepIntervalMs)
            || Number(process.env.XOPAT_STORAGE_SWEEP_INTERVAL_MS)
            || 60_000,
        root,
        logger,
    });

    // ── built-in drivers ─────────────────────────────────────────────────────

    function registerDriver(driver) {
        if (!driver?.id) throw new StorageConfigError("A storage driver needs an id.");
        const complete = completeDriver(driver);
        if (drivers.has(complete.id)) {
            logger.warn?.(`[storage] driver '${complete.id}' replaced.`);
            drivers.get(complete.id).dispose?.();
        }
        drivers.set(complete.id, complete);
        // A driver registered after a handle was built must be picked up.
        handles.clear();
        return () => {
            if (drivers.get(complete.id) === complete) {
                drivers.delete(complete.id);
                handles.clear();
            }
        };
    }

    const cfg = policy.config();
    const memory = createMemoryDriver({
        maxBytes: Number(cfg.drivers?.memory?.maxBytes)
            || Number(process.env.XOPAT_STORAGE_MEMORY_MAX_BYTES)
            || undefined,
    });
    const file = createFileDriver({
        root: cfg.drivers?.file?.root ? path.resolve(String(cfg.drivers.file.root)) : root,
        fsync: cfg.drivers?.file?.fsync === true,
    });
    registerDriver(memory);
    registerDriver(file);
    registerDriver(createTieredDriver({
        front: memory,
        back: file,
        memory: cfg.drivers?.tiered?.memory,
        coherency: cfg.drivers?.tiered?.coherency,
    }));

    // ── handle construction ──────────────────────────────────────────────────

    function resolveDrivers(ownerUid, capabilityId, authorDefaults) {
        const { drivers: ids, forcedMemory } = policy.resolveBindings(ownerUid, capabilityId, authorDefaults);
        const resolved = [];
        for (const id of ids) {
            const driver = drivers.get(id);
            if (!driver) {
                logger.warn?.(
                    `[storage] '${ownerUid}/${capabilityId}' is bound to unknown driver '${id}' — ` +
                    `skipped. Is the module that provides it enabled?`);
                continue;
            }
            resolved.push(driver);
        }
        if (!resolved.length) {
            // Degrade to memory rather than throw: an unavailable optional
            // backend must not take the whole server down at boot. It IS logged.
            logger.warn?.(
                `[storage] no usable driver for '${ownerUid}/${capabilityId}' (wanted ` +
                `${ids.join(", ")}); falling back to 'memory'.`);
            return { resolved: [drivers.get("memory")], forcedMemory: true };
        }
        return { resolved, forcedMemory };
    }

    function handle(shape, HandleCtor, ownerUid, namespace, options = {}) {
        assertSegment(ownerUid, "owner");
        assertSegment(namespace, "namespace");
        const capabilityId = `${shape}:${namespace}`;
        const cacheKey = `${ownerUid}|${capabilityId}`;
        const existing = handles.get(cacheKey);
        if (existing) {
            // The cache key is (owner, capability) only, so a second open with
            // DIFFERENT options silently gets the first open's policy. That is a
            // real footgun — two call sites disagreeing about the TTL of the
            // same namespace and one of them quietly losing — so say so instead
            // of resolving it invisibly.
            const wanted = JSON.stringify(policy.resolvePolicy(
                ownerUid, capabilityId, shape, options, options.authorDefaults));
            if (wanted !== JSON.stringify(existing.ns.policy)) {
                logger.warn?.(
                    `[storage] '${ownerUid}/${capabilityId}' reopened with a different retention policy; ` +
                    `the first one wins. Resolved: ${JSON.stringify(existing.ns.policy)}, ignored: ${wanted}.`);
            }
            return existing;
        }

        const { resolved } = resolveDrivers(ownerUid, capabilityId, options.defaultBindings);
        const primary = resolved[0];
        if (!primary.supports.includes(shape)) {
            throw new StorageConfigError(
                `Driver '${primary.id}' does not support the '${shape}' shape required by ` +
                `'${ownerUid}/${capabilityId}'.`, "STORAGE_SHAPE_UNSUPPORTED");
        }
        policy.assertSensitivity(ownerUid, capabilityId, options.sensitivity, primary);

        const ns = {
            id: `${ownerUid}/${capabilityId}`,
            ownerUid,
            namespace,
            shape,
            capabilityId,
            policy: policy.resolvePolicy(ownerUid, capabilityId, shape, options, options.authorDefaults),
            sensitivity: options.sensitivity || "normal",
            onEvict: typeof options.onEvict === "function" ? options.onEvict : undefined,
        };

        const built = new HandleCtor({ ns, drivers: resolved });
        handles.set(cacheKey, built);
        sweeper.register(ns, primary);
        return built;
    }

    return {
        root,
        StorageConfigError,

        /**
         * @param {string} ownerUid  "core" | "module.<id>" | "plugin.<id>"
         * @param {string} namespace e.g. "sessions"
         * @param {{ttlMs?:number, maxEntries?:number, maxBytes?:number,
         *          sensitivity?:"normal"|"secret", onEvict?:Function,
         *          defaultBindings?:string[]}} [options]
         *
         * `onEvict(key, value, reason)` reports STORE-initiated removals only —
         * `"ttl"`, `"lru"`, `"bytes"`. Your own `delete()`/`clear()` calls do not
         * fire it, because you already know about those; notify at the call site.
         */
        kv: (ownerUid, namespace, options) => handle("kv", KVHandle, ownerUid, namespace, options),
        log: (ownerUid, namespace, options) => handle("log", LogHandle, ownerUid, namespace, options),
        blob: (ownerUid, namespace, options) => handle("blob", BlobHandle, ownerUid, namespace, options),

        /** Register a custom backend (Redis, Postgres, S3…). Returns a disposer. */
        registerDriver,
        getDriver: (id) => drivers.get(id),
        listDrivers: () => [...drivers.keys()],

        /** Run the sweep now instead of waiting for the interval. */
        sweep: () => sweeper.sweepOnce(),

        stats() {
            const namespaces = [...handles.values()].map(h => ({
                id: h.ns.id,
                shape: h.ns.shape,
                driver: h.driver.id,
                persistent: h.persistent,
                sensitivity: h.ns.sensitivity,
                policy: h.ns.policy,
            }));
            // Cache counters belong to the other surface (`XOPAT_SERVER.cache`)
            // and are reported there — repeating them here made every consumer
            // print the same numbers twice.
            return { root, namespaces, drivers: [...drivers.keys()] };
        },

        dispose() {
            sweeper.dispose();
            for (const driver of drivers.values()) driver.dispose?.();
            drivers.clear();
            handles.clear();
        },
    };
}

/**
 * `installGlobalServerHelpers` runs on EVERY lazy server-module load
 * (`server-runtime.js`), not once. Constructing the broker there would duplicate
 * sweep timers and drop live state on each module import, so it is created once
 * and parked on a global — the same technique the chat registry uses to survive
 * hot reload.
 */
const SINGLETON_KEY = "__XOPAT_SERVER_STORAGE__";
const CONFIG_KEY = "__XOPAT_STORAGE_CONFIG__";

/**
 * Publish `core.CORE_SECURE.storage`. Called once from `server/node/index.js`
 * after the core config is parsed, BEFORE any server module loads — the broker
 * reads driver options at construction and bindings/retention lazily on every
 * resolve, so a later call still moves bindings but not driver options.
 */
function setStorageConfig(config) {
    globalThis[CONFIG_KEY] = config && typeof config === "object" ? config : {};
}

function getServerStorage(runtime) {
    const existing = globalThis[SINGLETON_KEY];
    if (existing) return existing;
    if (!runtime) return null;
    const created = {
        storage: createServerStorage({
            cacheDir: runtime.cacheDir,
            getConfig: () => globalThis[CONFIG_KEY],
            logger: runtime.logger,
        }),
        cache: {
            /** @see BoundedCache */
            create: createBoundedCache,
            stats: getAllCacheStats,
            BoundedCache,
        },
    };
    globalThis[SINGLETON_KEY] = created;
    return created;
}

module.exports = {
    createServerStorage,
    getServerStorage,
    setStorageConfig,
    createBoundedCache,
    getAllCacheStats,
    BoundedCache,
    StorageConfigError,
    SHAPES,
};
