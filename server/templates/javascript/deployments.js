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
// Parts of `core.server.secure` that server boot reads once and that decide
// process behaviour (server/node/index.js). `examples` is boot-read too, but
// only feeds the startup banner, so data fragments may keep declaring it.
const OVERLAY_BOOT_SECURE_KEYS = ["storage"];
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
            // `secure` is read per request, except these parts, which boot reads
            // once. Kept, they applied process-wide when set on the default
            // deployment and silently did nothing on any other.
            if (isPlainObject(kept.secure)) {
                const secure = Object.assign({}, kept.secure);
                for (const key of OVERLAY_BOOT_SECURE_KEYS) {
                    if (!(key in secure)) continue;
                    delete secure[key];
                    problems.push(`deployments.${id}.core.server.secure.${key} is process-wide boot config and cannot vary per deployment — ignored`);
                }
                kept.secure = secure;
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
    // The main context's identity provider when no verifier map restates it.
    if (!Object.keys(verifiers).length && isPlainObject(server && server.auth)) {
        out.set("auth:core", stableJson(server.auth));
    }
    // Server-side login brokers keep per-context state on the session, whether
    // they ship as a module or a plugin.
    for (const kind of ["modules", "plugins"]) {
        const items = isPlainObject(secure[kind]) ? secure[kind] : {};
        for (const itemId of Object.keys(items)) {
            const contexts = items[itemId] && items[itemId].contexts;
            if (!isPlainObject(contexts)) continue;
            const where = kind === "modules" ? itemId : `plugin:${itemId}`;
            for (const id of Object.keys(contexts)) out.set(`${where}:${id}`, stableJson(contexts[id]));
        }
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
 * Whether the ENV defines any named deployment. Without one there is nothing to
 * bind and every request runs in the base.
 */
function hasNamedDeployments(ENV) {
    const defs = isPlainObject(ENV) && isPlainObject(ENV.deployments) ? ENV.deployments : {};
    return Object.keys(defs).some(id => isDeploymentId(id) && isPlainObject(defs[id]));
}

/**
 * Decide which deployment a request the viewer issues (RPC, proxy, module
 * route) may run in, given the deployments its session was bound to by a page
 * load. A deployment is entered by loading its page; everything after that is
 * confined to what the session has entered, so a header naming another
 * deployment cannot borrow its roles, elements, proxies or secure config.
 *
 * - no named deployments: anything goes (there is only the base);
 * - a request naming a deployment: allowed only when the session is bound to
 *   the RESOLVED id (an unknown name resolves to the default and is judged as such);
 * - a request naming none (an OAuth callback, a navigation): the session's most
 *   recently entered deployment, else the default — which must itself be bound
 *   unless the session has entered nothing yet.
 *
 * @param {object} ENV parsed env (or `{deployments, defaultDeployment}`)
 * @param {*} requested untrusted request-supplied name
 * @param {string[]|undefined} bound ids the session entered, most recent last
 * @return {{ok: boolean, requested: string|null, id: string}}
 *   `requested` is the name to build the core with; `id` the resolved deployment
 */
function selectBoundDeployment(ENV, requested, bound) {
    const echo = normalizeRequestedDeployment(requested);
    if (!hasNamedDeployments(ENV)) return { ok: true, requested: echo, id: resolveDeployment(ENV, echo).id };
    const entered = Array.isArray(bound) ? bound.filter(x => typeof x === "string") : [];
    if (!echo) {
        const last = entered[entered.length - 1];
        if (last) return { ok: true, requested: last, id: resolveDeployment(ENV, last).id };
        return { ok: true, requested: null, id: resolveDeployment(ENV, null).id };
    }
    const id = resolveDeployment(ENV, echo).id;
    return { ok: entered.includes(id), requested: echo, id };
}

/**
 * Record that a session entered a deployment (a page of it was served).
 * Most recent last; bounded by the env's own deployment set.
 *
 * @return {boolean} whether the list changed
 */
function bindSessionDeployment(session, id) {
    if (!session || typeof id !== "string") return false;
    const list = Array.isArray(session.deployments) ? session.deployments.filter(x => x !== id) : [];
    const changed = !Array.isArray(session.deployments)
        || session.deployments[session.deployments.length - 1] !== id;
    list.push(id);
    // A defined id set is bounded by the env, but a stored session may outlive
    // an env edit; never let it grow without bound.
    session.deployments = list.slice(-64);
    return changed;
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
    hasNamedDeployments,
    selectBoundDeployment,
    bindSessionDeployment,
};
