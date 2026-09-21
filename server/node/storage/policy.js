"use strict";

/**
 * Binding + retention resolution for server storage.
 *
 * Mirrors the client's `IO_PIPELINE.resolveBindings` (`src/classes/io/io-pipeline.ts`)
 * so an operator who knows one knows the other. Two deliberate divergences,
 * both because the server is not a browser:
 *
 *  1. **There is no "inert" state.** The client makes an unbound capability a
 *     no-op; silently discarding a *server* write is data loss. The equivalent
 *     knob here is `noPersist`, which forces a namespace to the memory driver
 *     and says so in the log.
 *  2. **A binding list is a read-fallback chain, not a mirror.** Writes go to the
 *     first driver; reads fall through the rest on miss. That is the migration
 *     path (`["redis", "file"]` — drain, then drop the tail) without doubling
 *     every write.
 */

class StorageConfigError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "StorageConfigError";
        this.code = code || "STORAGE_CONFIG";
    }
}

/** Namespace kind defaults, before author and operator layers. */
const SHAPE_DEFAULTS = {
    kv: { maxEntries: 10_000 },
    log: { maxEntries: 1_000 },
    blob: { maxEntries: 5_000 },
};

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Keep only recognised retention fields — an unknown key is a config typo. */
function pickPolicy(source) {
    if (!source || typeof source !== "object") return {};
    const out = {};
    for (const key of ["ttlMs", "maxEntries", "maxBytes", "maxEntryBytes",
                       "frontMaxBytes", "maxBytesPerScope"]) {
        const v = num(source[key]);
        if (v !== undefined) out[key] = v;
    }
    if (source.coherency === "shared" || source.coherency === "single") {
        out.coherency = source.coherency;
    }
    return out;
}

/**
 * @param {() => object|undefined} getConfig lazy accessor for
 *        `core.CORE_SECURE.storage`. Read on every resolve, never snapshotted,
 *        so a live config reload takes effect (same contract as
 *        `IOPipelineOptions.getConfig`).
 */
function createPolicyResolver(getConfig, logger = console) {
    const warned = new Set();

    function config() {
        const c = getConfig?.();
        return c && typeof c === "object" ? c : {};
    }

    /** `module.vercel-ai-chat-sdk` -> `vercel-ai-chat-sdk`; `core` stays `core`. */
    function ownerIdOf(ownerUid) {
        const idx = String(ownerUid).indexOf(".");
        return idx < 0 ? String(ownerUid) : String(ownerUid).slice(idx + 1);
    }

    function warnOnce(key, message) {
        if (warned.has(key)) return;
        warned.add(key);
        logger.warn?.(message);
    }

    /**
     * Driver ids for one capability, highest precedence first.
     * @returns {{drivers: string[], forcedMemory: boolean}}
     */
    function resolveBindings(ownerUid, capabilityId, authorDefaults) {
        const cfg = config();
        const ownerId = ownerIdOf(ownerUid);

        const noPersist = Array.isArray(cfg.noPersist) ? cfg.noPersist : [];
        if (noPersist.includes(ownerId) || noPersist.includes(ownerUid)) {
            warnOnce(`nopersist:${ownerUid}`,
                `[storage] '${ownerUid}' is listed in noPersist — every namespace is memory-only ` +
                `and will not survive a restart.`);
            return { drivers: ["memory"], forcedMemory: true };
        }

        const bindings = cfg.bindings || {};
        const explicit = bindings[ownerId]?.[capabilityId] ?? bindings[ownerUid]?.[capabilityId];
        if (Array.isArray(explicit) && explicit.length) {
            return { drivers: explicit.map(String), forcedMemory: false };
        }

        // "Redirect everything" knob: one core entry moves every owner that has
        // no opinion of its own.
        const inherited = bindings.core?.[capabilityId];
        if (Array.isArray(inherited) && inherited.length) {
            return { drivers: inherited.map(String), forcedMemory: false };
        }

        if (Array.isArray(authorDefaults) && authorDefaults.length) {
            return { drivers: authorDefaults.map(String), forcedMemory: false };
        }

        return { drivers: [String(cfg.defaultDriver || "tiered")], forcedMemory: false };
    }

    /**
     * Retention, lowest precedence first:
     * shape default < code default < author `server.json` < deployer config.
     */
    function resolvePolicy(ownerUid, capabilityId, shape, codeDefaults, authorDefaults) {
        const cfg = config();
        const ownerId = ownerIdOf(ownerUid);
        const deployer = cfg.retention?.[ownerId]?.[capabilityId]
            ?? cfg.retention?.[ownerUid]?.[capabilityId];
        return {
            ...SHAPE_DEFAULTS[shape],
            ...pickPolicy(codeDefaults),
            ...pickPolicy(authorDefaults),
            ...pickPolicy(deployer),
        };
    }

    /**
     * Refuse to put secrets on disk unless the operator explicitly allowed it.
     *
     * Thrown at handle construction, not at first write, so a misconfiguration
     * fails at boot with the owner, namespace and driver named — rather than
     * quietly writing plaintext BYOK keys under the cache directory.
     */
    function assertSensitivity(ownerUid, capabilityId, sensitivity, driver) {
        if (sensitivity !== "secret") return;
        if (driver.persistent !== true) return;
        if (config().allowPersistentSecrets === true) {
            warnOnce(`secretpersist:${ownerUid}:${capabilityId}`,
                `[storage] '${ownerUid}/${capabilityId}' holds secrets and is bound to the ` +
                `persistent driver '${driver.id}' (allowPersistentSecrets is on). Ensure the ` +
                `storage root has restrictive permissions and an at-rest encryption story.`);
            return;
        }
        throw new StorageConfigError(
            `Storage namespace '${ownerUid}/${capabilityId}' is declared sensitivity:"secret" but is ` +
            `bound to the persistent driver '${driver.id}'. Bind it to a non-persistent driver, or ` +
            `set core.server.secure.storage.allowPersistentSecrets = true to accept secrets at rest.`,
            "STORAGE_SECRET_PERSISTENCE",
        );
    }

    return { config, ownerIdOf, resolveBindings, resolvePolicy, assertSensitivity };
}

module.exports = { createPolicyResolver, StorageConfigError, SHAPE_DEFAULTS };
