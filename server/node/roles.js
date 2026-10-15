"use strict";

/**
 * Server-side role resolution — the half where a capability is authorization.
 *
 * The client's role layer gates UI and nothing else: it decodes the JWT payload
 * WITHOUT verifying the signature (`src/classes/user.ts`), which is sound only
 * because refusing a button is not refusing access. The server holds the same
 * token already verified (`normalizePrincipalUser` in `auth.js` parks the whole
 * claim set on `ctx.user.claims`), so the same rules resolved here are a real
 * decision.
 *
 * Two deliberate differences from the client:
 *
 *  1. **Fail closed on identity.** The client answers `true` for an unknown
 *     capability id so that one deployment's role config cannot lock another's
 *     UI. Here, a method that DECLARES a capability and receives no verified
 *     identity is refused. A method that declares nothing is untouched — which
 *     is what makes this safe to add to a running deployment.
 *  2. **No capability registry.** Declarations live in `include.json` and are
 *     loaded by the browser. The server judges the id the method named, seeded
 *     with the same `allow` default the loader uses, and lets the role cascade
 *     decide. A deployment that says nothing about an id still allows it — the
 *     same answer the client gives, reached the same way.
 *
 * The resolution ALGORITHM is not reimplemented. `src/classes/user-roles-core.ts`
 * is dependency-free precisely so this file can borrow it: `grunt serverBuild`
 * emits it as `src/dist/user-roles-core.cjs` and that artifact is what loads,
 * with an in-memory TypeScript transform kept only as a dev convenience. Two
 * copies of a cascade this subtle would drift, and the drift would be a silent
 * authorization difference between what the UI shows and what the server
 * enforces.
 *
 * See src/USER_ROLES.md.
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const constants = require("./constants");

const CORE_SRC = path.join(__dirname, "..", "..", "src", "classes", "user-roles-core.ts");
/**
 * The prebuilt resolver, emitted by `grunt serverBuild`.
 *
 * CJS whatever format element bundles use: it is required synchronously from CJS
 * core and `loadCore()` cannot await. A packaged build has no esbuild, so the
 * in-memory transform below is not a fallback there — it is a dev convenience,
 * and this artifact is the only way role capabilities resolve at all in a
 * binary. (`src/**` is packaged already; it also has to be listed in
 * `pkg.scripts` to be require-able by path.)
 */
const CORE_ARTIFACT = path.join(__dirname, "..", "..", "src", "dist", "user-roles-core.cjs");

/** `{ rolesFromClaims, resolveCapabilities }` once loaded, `null` while unknown. */
let _core;
/** Why the load failed, for the refusal message (and so we only try once). */
let _coreError = null;

/** Both loaders answer `null` unless the exports are the real resolver. */
function validateCore(exports, origin) {
    if (exports && typeof exports.rolesFromClaims === "function"
        && typeof exports.resolveCapabilities === "function") {
        return exports;
    }
    // Without this a stale or half-written module loads "successfully" and leaves
    // `_coreError` null, so the (correct) fail-closed in `can()` reports
    // "role resolver unavailable (unknown reason)" — a refusal naming no cause.
    _coreError = `${origin} does not export rolesFromClaims/resolveCapabilities`;
    return null;
}

/** The prebuilt CJS artifact. The only route in a packaged build. */
function requireArtifact() {
    try {
        return validateCore(require(CORE_ARTIFACT), path.basename(CORE_ARTIFACT));
    } catch (error) {
        if (constants.PACKAGED) {
            // No compiler here, and no source to compile either. Name the real
            // cause: it used to report "esbuild unavailable", which reads as a
            // dependency problem rather than a build that was never run.
            _coreError = `prebuilt ${path.basename(CORE_ARTIFACT)} is missing from this build`
                + ` — role capabilities cannot be resolved (rebuild with npm run build and repackage)`;
        } else if (!_coreError) {
            _coreError = error && error.message ? error.message : String(error);
        }
        return null;
    }
}

/**
 * The TypeScript source, transformed in memory.
 *
 * `transformSync` rather than a bundle: the file imports nothing, so there is
 * nothing to bundle, and skipping the on-disk build cache removes a lock, a
 * freshness check and a temp directory from a path that runs once per process.
 */
function transformSource() {
    try {
        const esbuild = require("esbuild");
        const source = fs.readFileSync(CORE_SRC, "utf8");
        const { code } = esbuild.transformSync(source, {
            loader: "ts",
            format: "cjs",
            target: "node22",
        });
        const mod = new Module(CORE_SRC, null);
        mod.filename = CORE_SRC;
        mod.paths = Module._nodeModulePaths(path.dirname(CORE_SRC));
        mod._compile(code, CORE_SRC);
        return validateCore(mod.exports, "src/classes/user-roles-core.ts");
    } catch (error) {
        _coreError = error && error.message ? error.message : String(error);
        return null;
    }
}

/**
 * Load the shared resolver: the SOURCE in a source tree, the artifact in a binary.
 *
 * Source-first on purpose. The artifact was preferred unconditionally and the
 * transform was reached only when `require` THREW — never when it returned
 * something stale. So a `src/dist/user-roles-core.cjs` built from an earlier
 * `user-roles-core.ts` shadowed the edited source for the life of the process:
 * change the role cascade, restart, and the old policy kept being enforced until
 * someone remembered `grunt serverBuild`. A freshness check would be a third
 * place that has to agree about what "fresh" means; not preferring the artifact
 * where the source exists cannot go wrong at all. A packaged build carries no
 * compiler, so there the artifact is the only route — and the whole reason it
 * exists.
 *
 * @returns the module exports, or `null` with `_coreError` set
 */
function loadCore() {
    if (_core !== undefined) return _core;
    if (constants.PACKAGED) return (_core = requireArtifact());
    // The artifact still answers in a source tree with no esbuild installed.
    _core = transformSource() || requireArtifact();
    // A fallback that worked leaves no complaint behind: `_coreError` is read only
    // when there is no resolver, and the first loader's message would otherwise
    // outlive the failure it described.
    if (_core) _coreError = null;
    return _core;
}

/** The deployment's `core.roles` block, or `{}`. */
function rolesConfig(core) {
    const cfg = core && core.CORE && core.CORE.roles;
    return cfg && typeof cfg === "object" ? cfg : {};
}

/**
 * The roles in effect for one request, from the VERIFIED token.
 *
 * `null` — not the empty array — when there is no verified identity: "nobody is
 * signed in" and "signed in with no roles" are different answers, and only the
 * first one may fail a capability check closed.
 *
 * @param {object} ctx the RPC context (`ctx.user` carries the verified claims)
 * @param {object} core the resolved viewer core config
 * @returns {string[]|null}
 */
function resolveRoles(ctx, core) {
    const user = ctx && ctx.user;
    if (!user) return null;

    const cfg = rolesConfig(core);
    const claims = cfg.claims;
    // Inert unless `core.roles.claims` is configured — the same condition the
    // browser's resolver installs under (`_installClaimRoleResolver`). Reading
    // a `roles` claim a deployment never asked to be read would make the two
    // sides disagree the moment a token happens to carry one.
    if (!claims || typeof claims !== "object") return cfg.default || [];

    const claimName = claims.claim || cfg.jwtClaim || "roles";
    const source = user.claims && typeof user.claims === "object" ? user.claims : user;
    const raw = source[claimName];

    const shared = loadCore();
    if (!shared || typeof shared.rolesFromClaims !== "function") {
        // No mapper available. The mapping table is exactly what cannot be
        // guessed, so fall back to the deployment baseline rather than inventing
        // roles from raw claim values.
        return cfg.default || [];
    }

    const mapped = shared.rolesFromClaims(raw, claims);
    // An authenticated caller whose token carries nothing recognisable still
    // gets the deployment's baseline, exactly as the browser does at boot.
    return mapped.length ? mapped : (cfg.default || []);
}

/**
 * The capability list the resolver is seeded with: the id under judgement plus
 * every literal (non-wildcard) id the role definitions mention.
 *
 * @param {string} capabilityId
 * @param {object} definitions `core.roles.definitions`
 * @returns {Array<{id: string, default: string, declaredBy: string}>}
 */
function seedCapabilities(capabilityId, definitions) {
    const ids = new Set([capabilityId]);
    for (const role of Object.values(definitions || {})) {
        for (const list of [role && role.grant, role && role.deny]) {
            for (const pattern of Array.isArray(list) ? list : []) {
                if (typeof pattern === "string" && !pattern.includes("*")) ids.add(pattern);
            }
        }
    }
    return Array.from(ids, id => ({ id, default: "allow", declaredBy: "server" }));
}

/**
 * Whether the caller holds a capability.
 *
 * @param {object} ctx the RPC context
 * @param {string} capabilityId e.g. `"annotations.crud:annotation.delete"`
 * @param {object} core the resolved viewer core config
 * @returns {{ok: boolean, reason?: string, roles?: string[]}}
 */
function can(ctx, capabilityId, core) {
    const roles = resolveRoles(ctx, core);
    if (roles === null) {
        return { ok: false, reason: "no verified identity for a capability-gated method" };
    }

    const shared = loadCore();
    if (!shared || typeof shared.resolveCapabilities !== "function") {
        // Fail closed, loudly. A method asked a question this process cannot
        // answer; answering "yes" would turn a build problem into an access
        // problem.
        return {
            ok: false,
            roles,
            reason: `role resolver unavailable (${_coreError || "unknown reason"})`,
        };
    }

    const cfg = rolesConfig(core);
    const definitions = cfg.definitions || {};
    const effective = shared.resolveCapabilities({
        // Seeded `allow`, matching `registerOwnerRights`: an id the deployment
        // says nothing about is not a gate.
        //
        // The seed carries every literal id the role config names, not just the
        // one being judged. Only the requested verdict is read — the rest exist
        // so the resolver does not log "references undeclared capability" for
        // every other line of the config on every single request. The browser
        // seeds from its capability registry; the server has no registry, so
        // the config's own vocabulary is the closest honest equivalent.
        capabilities: seedCapabilities(capabilityId, definitions),
        assignedRoles: roles,
        definitions,
    });
    return effective[capabilityId] === false
        ? { ok: false, roles, reason: `capability "${capabilityId}" denied for roles [${roles.join(", ") || "—"}]` }
        : { ok: true, roles };
}

/**
 * Enforce a method's declared capabilities.
 *
 * @param {object} ctx the RPC context
 * @param {string[]} capabilities ids from `policy.<method>.capabilities`
 * @param {"all"|"any"} mode default `"all"`
 * @param {object} core the resolved viewer core config
 * @returns {{ok: boolean, reason?: string, roles?: string[]}}
 */
function checkCapabilities(ctx, capabilities, mode, core) {
    if (!Array.isArray(capabilities) || capabilities.length === 0) return { ok: true };
    const verdicts = capabilities.map(id => can(ctx, id, core));
    if (mode === "any") {
        const passed = verdicts.find(v => v.ok);
        if (passed) return passed;
        return { ok: false, roles: verdicts[0].roles, reason: verdicts.map(v => v.reason).join("; ") };
    }
    const failed = verdicts.find(v => !v.ok);
    return failed || { ok: true, roles: verdicts[0].roles };
}

module.exports = { resolveRoles, can, checkCapabilities };
