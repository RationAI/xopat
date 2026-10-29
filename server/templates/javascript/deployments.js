/**
 * Named deployments: one ENV, several admin-defined configurations, the
 * session picks which one is active.
 *
 *   {
 *     "core": {...}, "plugins": {...}, "modules": {...},   // base, shared
 *     "defaultDeployment": "standalone",                   // optional
 *     "deployments": {
 *       "standalone": { "core": {...}, "plugins": {...}, "modules": {...} },
 *       "dicom":      { "core": { "active_client": "dicom" } }
 *     }
 *   }
 *
 * A deployment is an env-shaped overlay merged over the base before anything
 * else reads the ENV, so every downstream consumer (client flattening, secure
 * split, plugin/module merge) is unaware of it.
 *
 * Trust model mirrors slide protocols and `sessionControllable` IO sinks: the
 * operator defines the set, the (untrusted) session only names an id. A name
 * that is malformed, unknown or absent never fails the load — it falls back to
 * `defaultDeployment`, then to the base ENV alone.
 *
 * Boot-only server config (storage, logging, headers, static roots, auth...)
 * is read once per process and cannot vary per request, so an overlay may only
 * touch `core.server.secure` under `core.server`.
 *
 * Pure (no fs, no process): shared by core.js, the env composer and tests.
 * Mirrored in `server/php/inc/core.php`.
 */

const DEPLOYMENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const BASE_DEPLOYMENT = "base";
const OVERLAY_ROOT_KEYS = ["core", "plugins", "modules"];
const OVERLAY_SERVER_KEYS = ["secure"];

function isPlainObject(x) {
    return !!x && typeof x === "object" && !Array.isArray(x);
}

function isDeploymentId(x) {
    return typeof x === "string" && x !== BASE_DEPLOYMENT && DEPLOYMENT_ID_RE.test(x);
}

/**
 * Normalize a request-supplied deployment name for echoing back to the client.
 * The echo is what breaks the client re-POST loop, so it must survive even a
 * malformed value — bounded, never interpreted.
 */
function normalizeRequestedDeployment(x) {
    if (typeof x !== "string") return null;
    const value = x.trim().slice(0, 64);
    return value || null;
}

/**
 * Strip what an overlay is not allowed to carry. Returns the sanitized overlay
 * and a list of human-readable problems (dropped keys).
 */
function sanitizeOverlay(id, overlay) {
    const problems = [];
    const out = {};
    for (const key of Object.keys(overlay)) {
        if (key === "$meta") continue;
        if (key === "$layers") {
            problems.push(`deployments.${id}.$layers is a composer directive; compose the env with 'npm run up' first — ignored`);
            continue;
        }
        if (!OVERLAY_ROOT_KEYS.includes(key)) {
            problems.push(`deployments.${id}.${key} is not allowed in a deployment (only ${OVERLAY_ROOT_KEYS.join(", ")}) — ignored`);
            continue;
        }
        if (!isPlainObject(overlay[key])) {
            problems.push(`deployments.${id}.${key} must be an object — ignored`);
            continue;
        }
        out[key] = overlay[key];
    }
    const server = out.core && out.core.server;
    if (server !== undefined) {
        const core = Object.assign({}, out.core);
        if (!isPlainObject(server)) {
            problems.push(`deployments.${id}.core.server must be an object — ignored`);
            delete core.server;
        } else {
            const kept = {};
            for (const key of Object.keys(server)) {
                if (OVERLAY_SERVER_KEYS.includes(key)) kept[key] = server[key];
                else problems.push(`deployments.${id}.core.server.${key} is process-wide boot config and cannot vary per deployment — ignored`);
            }
            core.server = kept;
        }
        out.core = core;
    }
    return { overlay: out, problems };
}

/**
 * Validate the deployment section of an ENV. Returns problem strings; empty
 * means valid. Does not throw — a misconfiguration degrades to the base ENV.
 */
function listDeploymentProblems(ENV) {
    const problems = [];
    if (!isPlainObject(ENV)) return problems;
    const defs = ENV.deployments;
    if (defs !== undefined && !isPlainObject(defs)) {
        problems.push("'deployments' must be an object of named overlays");
        return problems;
    }
    for (const id of Object.keys(defs || {})) {
        if (!isDeploymentId(id)) {
            problems.push(`deployment id '${id}' is invalid (must match ${DEPLOYMENT_ID_RE} and not be '${BASE_DEPLOYMENT}')`);
            continue;
        }
        if (!isPlainObject(defs[id])) {
            problems.push(`deployments.${id} must be an object`);
            continue;
        }
        problems.push(...sanitizeOverlay(id, defs[id]).problems);
    }
    const def = ENV.defaultDeployment;
    if (def !== undefined && def !== null && !(defs && isDeploymentId(def) && isPlainObject(defs[def]))) {
        problems.push(`defaultDeployment '${def}' does not name a defined deployment — falling back to the base ENV`);
    }
    return problems;
}

/**
 * Pick the deployment for a request.
 *
 * @param {object} ENV parsed env file
 * @param {*} requested untrusted request-supplied name
 * @return {{id: string, requested: string|null, fellBack: boolean, overlay: object|null, problems: string[]}}
 */
function resolveDeployment(ENV, requested) {
    const defs = isPlainObject(ENV) && isPlainObject(ENV.deployments) ? ENV.deployments : {};
    const echo = normalizeRequestedDeployment(requested);
    const usable = (id) => isDeploymentId(id) && Object.prototype.hasOwnProperty.call(defs, id) && isPlainObject(defs[id]);

    let id = BASE_DEPLOYMENT;
    if (echo && usable(echo)) id = echo;
    else if (usable(ENV && ENV.defaultDeployment)) id = ENV.defaultDeployment;

    let overlay = null, problems = [];
    if (id !== BASE_DEPLOYMENT) {
        ({ overlay, problems } = sanitizeOverlay(id, defs[id]));
    }
    return { id, requested: echo, fellBack: !!echo && echo !== id, overlay, problems };
}

/**
 * Resolve and merge the active deployment into ENV (in place).
 *
 * @param {object} ENV parsed env file; `core`/`plugins`/`modules` are merged into
 * @param {*} requested untrusted request-supplied name
 * @param {function(object, object): object} merge deep merge (arrays replace)
 * @return {{id: string, requested: string|null, fellBack: boolean, problems: string[]}}
 */
function applyDeployment(ENV, requested, merge) {
    const resolved = resolveDeployment(ENV, requested);
    if (resolved.overlay) {
        for (const key of OVERLAY_ROOT_KEYS) {
            if (!resolved.overlay[key]) continue;
            // Clone: the overlay object belongs to the parsed env and must not
            // alias into the merged tree that request handlers later mutate.
            const value = JSON.parse(JSON.stringify(resolved.overlay[key]));
            ENV[key] = isPlainObject(ENV[key]) ? merge(ENV[key], value) : value;
        }
    }
    return { id: resolved.id, requested: resolved.requested, fellBack: resolved.fellBack, problems: resolved.problems };
}

module.exports = {
    DEPLOYMENT_ID_RE,
    BASE_DEPLOYMENT,
    OVERLAY_ROOT_KEYS,
    OVERLAY_SERVER_KEYS,
    isDeploymentId,
    normalizeRequestedDeployment,
    sanitizeOverlay,
    listDeploymentProblems,
    resolveDeployment,
    applyDeployment,
};
