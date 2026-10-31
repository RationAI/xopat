"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");
const { BASE_DEPLOYMENT } = require("../templates/javascript/deployments");

/**
 * Which named deployment the running code belongs to
 * (`server/templates/javascript/deployments.js`).
 *
 * One process serves every deployment of an env, each with its own
 * `core.server.secure`, so anything remembered in the process must not cross
 * between them. That is core's job, not each element's: core enters the scope at
 * every element entry point, and everything handed out through `XOPAT_SERVER`
 * (`state`, `storage`, `cache`, `getStatic*Config`) resolves against it. An element
 * never names a deployment. See `server/STORAGE.md` → "Named deployments".
 *
 * Outside any scope (boot, timers) the running deployment is the default one.
 */
const scope = new AsyncLocalStorage();
let defaultDeployment = BASE_DEPLOYMENT;

function setDefaultDeployment(id) {
    if (typeof id === "string" && id) defaultDeployment = id;
}

function currentDeployment() {
    return scope.getStore() ?? defaultDeployment;
}

function runInDeployment(id, fn) {
    return scope.run(typeof id === "string" && id ? id : defaultDeployment, fn);
}

/** owner uid → deployment id → state. Bounded by what the env declares. */
const states = new Map();

/**
 * `XOPAT_SERVER.state`: the running deployment's state object of an owner, made by
 * `factory` on first use. Lives in core, so it also outlives a hot reload of the
 * element, which replaces the bundle and with it any module-level variable.
 */
function deploymentState(ownerUid, factory) {
    const owner = String(ownerUid);
    let perDeployment = states.get(owner);
    if (!perDeployment) states.set(owner, perDeployment = new Map());
    const id = currentDeployment();
    if (!perDeployment.has(id)) perDeployment.set(id, factory());
    return perDeployment.get(id);
}

/**
 * A stand-in that delegates to `open(deploymentId)`'s object for the running
 * deployment. Handles are typically opened once at module load, with no request in
 * scope, so the choice has to happen per access rather than at open. The running
 * deployment's target opens immediately, so a bad open still throws at the call
 * that caused it.
 */
function partitioned(open) {
    const parts = new Map();
    const partOf = (id) => {
        if (!parts.has(id)) parts.set(id, open(id));
        return parts.get(id);
    };
    const current = () => partOf(currentDeployment());
    current();
    return new Proxy({}, {
        get(_, prop) {
            const target = current();
            const value = target[prop];
            if (typeof value !== "function") return value;
            // A scoped handle held across requests must follow the deployment too.
            if (prop === "scoped") return (...args) => partitioned((id) => partOf(id).scoped(...args));
            return value.bind(target);
        },
        set(_, prop, value) { current()[prop] = value; return true; },
        has(_, prop) { return prop in current(); },
    });
}

/** Suffix of a partitioned name. `base` keeps the plain name, so its data never moves. */
function partitionSuffix(id) {
    return id === BASE_DEPLOYMENT ? "" : `.dp-${id}`;
}

/** `XOPAT_SERVER.storage`: each deployment gets its own namespaces. */
function partitionStorage(storage) {
    const shape = (name) => (ownerUid, namespace, options) => partitioned(
        (id) => storage[name](ownerUid, namespace, { ...options, partition: partitionSuffix(id) }));
    return { ...storage, kv: shape("kv"), log: shape("log"), blob: shape("blob") };
}

/**
 * `XOPAT_SERVER.cache`: each deployment gets its own cache, with the full bound.
 *
 * `crossDeployment: true` is for state that follows a login rather than a
 * deployment. All deployments of an origin share login state per auth context id
 * (`env/README.md`), so a replay guard or a login handoff has to be one cache.
 */
function partitionCache(cache) {
    return {
        ...cache,
        create: ({ crossDeployment, ...options }) => (crossDeployment
            ? cache.create(options)
            : partitioned((id) => cache.create({ ...options, name: `${options.name}${partitionSuffix(id)}` }))),
    };
}

module.exports = {
    currentDeployment,
    runInDeployment,
    setDefaultDeployment,
    deploymentState,
    partitionStorage,
    partitionCache,
};
