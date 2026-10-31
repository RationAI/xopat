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
 * Boot-only server config (storage, logging, headers, static roots...) is read
 * once per process and cannot vary per request, so an overlay may only touch
 * `core.server.secure` and `core.server.auth` (both read per request) under
 * `core.server`.
 *
 * Auth contexts are shared between deployments: one session cookie serves the
 * whole origin, and server-side login state is stored per context id. So a
 * context id must mean ONE identity provider everywhere — two deployments that
 * configure the same id differently are a configuration error
 * (`listAuthContextConflicts`). Separate logins = separate context ids.
 *
 * Pure (no fs, no process): shared by core.js, the env composer and tests.
 * Mirrored in `server/php/inc/core.php`.
 */

const DEPLOYMENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const BASE_DEPLOYMENT = "base";
const OVERLAY_ROOT_KEYS = ["core", "plugins", "modules"];
const OVERLAY_SERVER_KEYS = ["secure", "auth"];
// "", "core" and "default" spell the one main auth context (server/node/auth.js).
const MAIN_AUTH_CONTEXT_ALIASES = ["", "core", "default"];

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

/** Deep merge, arrays and leaves replace; never mutates its inputs. */
function mergeOverlay(base, overlay) {
    if (!isPlainObject(overlay)) return overlay === undefined ? base : overlay;
    const out = isPlainObject(base) ? Object.assign({}, base) : {};
    for (const key of Object.keys(overlay)) out[key] = mergeOverlay(out[key], overlay[key]);
    return out;
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (isPlainObject(value)) {
        return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
}

/**
 * Every auth context a deployment's effective server config defines, as
 * `"<where>:<context id>" -> identity`. Where: `rpcVerifiers` (the verifier
 * entry, plus `core.server.auth`, which verifiers fall back on) or a module's
 * `secure.modules.<id>.contexts` map (server-side login brokers).
 */
function authContextsOf(server) {
    const out = new Map();
    const secure = isPlainObject(server && server.secure) ? server.secure : {};
    const verifiers = isPlainObject(secure.rpcVerifiers) ? secure.rpcVerifiers
        : (isPlainObject(secure.rpcAuth) ? secure.rpcAuth : {});
    for (const id of Object.keys(verifiers)) {
        const canonical = MAIN_AUTH_CONTEXT_ALIASES.includes(id) ? "core" : id;
        out.set(`rpcVerifiers:${canonical}`, stableJson({ entry: verifiers[id], auth: server && server.auth }));
    }
    const modules = isPlainObject(secure.modules) ? secure.modules : {};
    for (const moduleId of Object.keys(modules)) {
        const contexts = modules[moduleId] && modules[moduleId].contexts;
        if (!isPlainObject(contexts)) continue;
        for (const id of Object.keys(contexts)) out.set(`${moduleId}:${id}`, stableJson(contexts[id]));
    }
    return out;
}

/**
 * Auth context ids configured differently by two deployments (or a deployment
 * and the base). Login state is shared per context id across the origin, so
 * such a split hands one deployment's tokens to another's verifier — it
 * rejects them, the user logs in there, and that login overwrites the first.
 *
 * @return {string[]} problems; empty when every shared context id agrees
 */
function listAuthContextConflicts(ENV) {
    if (!isPlainObject(ENV)) return [];
    const baseServer = (isPlainObject(ENV.core) && isPlainObject(ENV.core.server)) ? ENV.core.server : {};
    const effective = [[BASE_DEPLOYMENT, baseServer]];
    const defs = isPlainObject(ENV.deployments) ? ENV.deployments : {};
    for (const id of Object.keys(defs)) {
        if (!isDeploymentId(id) || !isPlainObject(defs[id])) continue;
        const server = sanitizeOverlay(id, defs[id]).overlay.core?.server;
        effective.push([id, mergeOverlay(baseServer, server || {})]);
    }
    const seen = new Map();   // key -> {identity, deployment}
    const problems = [];
    const reported = new Set();
    for (const [deployment, server] of effective) {
        for (const [key, identity] of authContextsOf(server)) {
            const first = seen.get(key);
            if (!first) { seen.set(key, { identity, deployment }); continue; }
            if (first.identity === identity || reported.has(key)) continue;
            reported.add(key);
            const [where, contextId] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
            problems.push(`auth context '${contextId}' (${where}) is configured differently in deployments `
                + `'${first.deployment}' and '${deployment}'. Login state is shared per context id across the `
                + `origin, so one id must mean one identity provider; give each deployment its own context id `
                + `for separate logins.`);
        }
    }
    return problems;
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
    problems.push(...listAuthContextConflicts(ENV));
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
    listAuthContextConflicts,
    resolveDeployment,
    applyDeployment,
};
