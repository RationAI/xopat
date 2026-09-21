/**
 * Roles & capabilities — pure logic.
 *
 * No DOM, no globals, no XOpatUser dependency. Reused by `XOpatUser` on the
 * client and (optionally) by `server/node/auth.js` if/when server-side RPC
 * enforcement is wired up. The full design lives in `src/USER_ROLES.md`.
 *
 * Mental model:
 *   - capability registry      → "what gates exist" (declared by plugins/modules)
 *   - role definitions          → "what each role grants/denies" (deployment env)
 *   - effective capability set  → "what THIS user can do right now"
 *
 * Resolution layers like CSS cascade:
 *   1. each capability's declared default (allow|deny)
 *   2. assigned roles in array order; for each role: parents first (via extends),
 *      then deny patterns, then grant patterns. Last write wins.
 *
 * Wildcards in `grant`/`deny` patterns use simple glob matching:
 *   `annotations.*`  matches anything starting with `annotations.`
 *   `*.delete`       matches anything ending with `.delete`
 *   `*`              matches every capability
 */

export type CapabilityDefault = "allow" | "deny";

export interface CapabilityDescriptor {
    id: string;
    default: CapabilityDefault;
    label?: string;
    description?: string;
    /**
     * For a CRUD-derived capability, which operation it gates.
     *
     * One `io.capabilities` entry produces four capabilities that share the
     * owner's single `label` — so `annotations.crud:annotation.create` and
     * `.delete` are both labelled "Annotation". Anything showing a capability
     * to a human (a refusal message, the roles panel) needs this to tell them
     * apart. Kept as data rather than folded into `label` at declare time:
     * declarations happen during element load, and the label has to be
     * translated at render.
     */
    direction?: "create" | "read" | "update" | "delete";
    /** Plugin/module id (or `"core"`) that declared this capability. */
    declaredBy: string;
}

export interface RoleDescriptor {
    id: string;
    label?: string;
    extends?: string[];
    grant?: string[];
    deny?: string[];
}

/**
 * Deployment rule for turning an identity-provider claim into xOpat roles.
 *
 * The two namespaces belong to different owners — the IdP names its groups,
 * xOpat names its roles — so the translation is explicit. Set
 * `unmapped: "passthrough"` when they already agree and `map` is redundant.
 */
export interface RoleClaimsConfig {
    /** Claim carrying the group/role list. Default `"roles"`. */
    claim?: string;
    /** Auth context whose token is read. Default `"core"`. */
    contextId?: string;
    /** Claim value → xOpat role ids. */
    map?: Record<string, string[]>;
    /**
     * What to do with a claim value `map` does not mention.
     *  - `"ignore"` (default) — drop it.
     *  - `"passthrough"` — treat the value itself as a role id.
     */
    unmapped?: "ignore" | "passthrough";
    /** Roles used when the claim is absent or nothing mapped. */
    fallback?: string[];
}

export interface RolesEnvConfig {
    /** Roles assigned automatically when no rights-resolver overrides them. */
    default?: string[];
    /** Role catalog keyed by role id. */
    definitions?: Record<string, Omit<RoleDescriptor, "id">>;
    /**
     * Map an IdP claim to roles at login. Absent → the client assigns nothing
     * and `default` stands, exactly as before this existed.
     */
    claims?: RoleClaimsConfig;
    /**
     * JWT claim name that carries roles for optional server-side RPC checks.
     * Client-side role assignment reads {@link RolesEnvConfig.claims} instead —
     * this field is only consumed by the (not yet implemented) server-side RPC
     * capability check sketched in `src/USER_ROLES.md`.
     */
    jwtClaim?: string;
}

/**
 * Resolve xOpat role ids from a raw claim value.
 *
 * Pure — no token handling, no globals — so the mapping is testable on its own
 * and reusable server-side. Tolerant of the shapes real IdPs emit: a single
 * string, an array of strings, or one space-separated string (the OAuth `scope`
 * convention). Anything else contributes nothing rather than throwing.
 */
export function rolesFromClaims(claimValue: unknown, cfg: RoleClaimsConfig | undefined): string[] {
    const fallback = (cfg?.fallback ?? []).filter(r => typeof r === "string");
    if (!cfg) return fallback;

    let values: string[];
    if (Array.isArray(claimValue)) {
        values = claimValue.filter((v): v is string => typeof v === "string");
    } else if (typeof claimValue === "string") {
        // A single claim may legitimately be one name or a space-separated set.
        values = claimValue.split(/\s+/).filter(Boolean);
    } else {
        values = [];
    }

    const map = cfg.map ?? {};
    const passthrough = cfg.unmapped === "passthrough";
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        const mapped = Object.prototype.hasOwnProperty.call(map, value)
            ? map[value]
            : (passthrough ? [value] : undefined);
        for (const role of mapped ?? []) {
            if (typeof role !== "string" || seen.has(role)) continue;
            seen.add(role);
            out.push(role);
        }
    }
    return out.length ? out : fallback;
}

/**
 * Process-global capability registry. Capabilities are declared at plugin/module
 * load time and are shared across all `XOpatUser` instances (there's only one in
 * practice). The registry survives logout — a logged-out user still sees the same
 * gates, just with the default role's effective set.
 */
export class CapabilityRegistry {
    private readonly _caps = new Map<string, CapabilityDescriptor>();
    private readonly _listeners = new Set<(desc: CapabilityDescriptor) => void>();

    declare(desc: CapabilityDescriptor): boolean {
        if (!desc?.id || typeof desc.id !== "string") {
            console.warn("[user-roles] declareCapability: missing or non-string id, dropping", desc);
            return false;
        }
        if (desc.default !== "allow" && desc.default !== "deny") {
            console.warn(`[user-roles] capability "${desc.id}" has invalid default "${desc.default}", dropping`);
            return false;
        }
        // Namespacing rule: capability ids must start with the declaring owner's id,
        // followed by a separator (`.` or `:`). Skip the check for the synthetic
        // `core` owner.
        if (desc.declaredBy && desc.declaredBy !== "core") {
            const ok = desc.id === desc.declaredBy
                || desc.id.startsWith(desc.declaredBy + ".")
                || desc.id.startsWith(desc.declaredBy + ":");
            if (!ok) {
                // console.error, not warn: a dropped declaration is not a
                // cosmetic problem. `XOpatUser.can()` answers `true` for ids it
                // does not know (so role config naming another deployment's
                // capability cannot lock the UI), which means every
                // `this.can("<id>")` call site guarding this feature is now
                // permanently open and no role config can ever close it.
                console.error(
                    `[user-roles] capability "${desc.id}" declared by "${desc.declaredBy}" is not namespaced `
                    + `under that id, so it was DROPPED — every gate using it is permanently open. `
                    + `Rename it to "${desc.declaredBy}.${desc.id}" (or "${desc.declaredBy}:${desc.id}").`
                );
                return false;
            }
        }
        const existing = this._caps.get(desc.id);
        if (existing) {
            // Repeat declaration with same owner: tolerate (lazy plugin reload).
            // Conflict from a different owner: warn, keep first.
            if (existing.declaredBy !== desc.declaredBy) {
                console.warn(
                    `[user-roles] capability "${desc.id}" already declared by "${existing.declaredBy}"; ignoring redeclaration by "${desc.declaredBy}"`
                );
                return false;
            }
            // Same owner, possibly updated label — replace silently.
        }
        this._caps.set(desc.id, desc);
        for (const fn of this._listeners) {
            try { fn(desc); } catch (e) { console.error(e); }
        }
        return true;
    }

    /** Remove all capabilities declared by `ownerId`. Used on plugin unload. */
    undeclareAll(ownerId: string): string[] {
        const removed: string[] = [];
        for (const [id, desc] of this._caps) {
            if (desc.declaredBy === ownerId) {
                this._caps.delete(id);
                removed.push(id);
            }
        }
        return removed;
    }

    has(id: string): boolean { return this._caps.has(id); }
    get(id: string): CapabilityDescriptor | undefined { return this._caps.get(id); }
    list(): CapabilityDescriptor[] { return Array.from(this._caps.values()); }

    /** Subscribe to declarations. Returns a dispose function. */
    onDeclared(fn: (desc: CapabilityDescriptor) => void): () => void {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }
}

/**
 * Glob match: `*` matches any non-empty sequence of characters; literal otherwise.
 * Bare `*` matches anything.
 */
function patternMatches(pattern: string, candidate: string): boolean {
    if (pattern === "*") return true;
    if (!pattern.includes("*")) return pattern === candidate;
    // Escape regex specials except *, then convert * → .+
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".+");
    return new RegExp("^" + escaped + "$").test(candidate);
}

/**
 * Flatten role chain depth-first, parents-before-children, deduplicated.
 * Cycles are broken (a role can't be its own ancestor).
 */
function flattenRoles(roleIds: string[], definitions: Record<string, Omit<RoleDescriptor, "id">>): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string) => {
        if (seen.has(id)) return;
        if (visiting.has(id)) {
            console.warn(`[user-roles] cyclic role inheritance involving "${id}"; cycle broken`);
            return;
        }
        const def = definitions[id];
        if (!def) {
            console.warn(`[user-roles] role "${id}" is assigned but not defined in core.roles.definitions`);
            return;
        }
        visiting.add(id);
        for (const parent of def.extends ?? []) visit(parent);
        visiting.delete(id);
        seen.add(id);
        result.push(id);
    };
    for (const id of roleIds) visit(id);
    return result;
}

export interface ResolveInputs {
    capabilities: CapabilityDescriptor[];
    assignedRoles: string[];
    definitions: Record<string, Omit<RoleDescriptor, "id">>;
}

/**
 * Compute the effective capability map: `{ capabilityId → boolean }`.
 *
 * Algorithm:
 *   1. Seed each capability with its declared default (`allow → true`, `deny → false`).
 *   2. Flatten roles via `extends`, parents-first, deduplicated.
 *   3. For each role in flattened order: apply `deny` patterns, then `grant` patterns.
 *      Last write wins.
 *
 * Unknown capability ids referenced in role config are recorded for warning but
 * not applied (a plugin may not be installed in this deployment).
 */
export function resolveCapabilities(input: ResolveInputs): Record<string, boolean> {
    const explained = explainCapabilities(input);
    const effective: Record<string, boolean> = {};
    for (const id of Object.keys(explained)) effective[id] = explained[id].value;
    return effective;
}

/** Why one capability resolved the way it did. */
export interface CapabilityExplanation {
    /** The effective verdict. */
    value: boolean;
    /**
     * The role id that produced it, or `null` when nothing overrode the
     * declared default.
     */
    decidedBy: string | null;
    /** The `grant`/`deny` pattern that matched, or `null` for the default. */
    pattern: string | null;
}

/**
 * Same resolution as {@link resolveCapabilities}, but recording WHICH role and
 * which pattern produced each verdict.
 *
 * Split out rather than added as a flag because the provenance is what makes a
 * role config debuggable: "denied" alone leaves an operator guessing between a
 * declared default, an inherited role, and a `*` in a deny list three roles up.
 * `resolveCapabilities` is the same algorithm with the explanation dropped, so
 * the two can never disagree.
 */
export function explainCapabilities(input: ResolveInputs): Record<string, CapabilityExplanation> {
    const effective: Record<string, CapabilityExplanation> = {};
    const allCaps = input.capabilities.map(c => c.id);

    for (const cap of input.capabilities) {
        effective[cap.id] = { value: cap.default === "allow", decidedBy: null, pattern: null };
    }

    const chain = flattenRoles(input.assignedRoles, input.definitions);

    for (const roleId of chain) {
        const def = input.definitions[roleId];
        if (!def) continue;
        const apply = (patterns: string[] | undefined, value: boolean) => {
            for (const pattern of patterns ?? []) {
                let matchedAny = false;
                for (const capId of allCaps) {
                    if (patternMatches(pattern, capId)) {
                        effective[capId] = { value, decidedBy: roleId, pattern };
                        matchedAny = true;
                    }
                }
                if (!matchedAny && !pattern.includes("*")) {
                    // Literal pattern that matches nothing — flag once.
                    // (Wildcards that match nothing are usually intentional in defensive deny lists.)
                    console.debug(`[user-roles] role "${roleId}" references undeclared capability "${pattern}"`);
                }
            }
        };
        apply(def.deny, false);
        apply(def.grant, true);
    }

    return effective;
}

/** Diff two effective sets; returns the ids whose value differs. */
export function diffEffective(prev: Record<string, boolean>, next: Record<string, boolean>): string[] {
    const out: string[] = [];
    const ids = new Set<string>([...Object.keys(prev), ...Object.keys(next)]);
    for (const id of ids) {
        if (prev[id] !== next[id]) out.push(id);
    }
    return out;
}
