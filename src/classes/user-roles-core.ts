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

export interface RolesEnvConfig {
    /** Roles assigned automatically when no rights-resolver overrides them. */
    default?: string[];
    /** Role catalog keyed by role id. */
    definitions?: Record<string, Omit<RoleDescriptor, "id">>;
    /**
     * JWT claim name that carries roles for optional server-side RPC checks.
     * Default: `"roles"`. Unused on the client.
     */
    jwtClaim?: string;
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
                console.warn(
                    `[user-roles] capability "${desc.id}" declared by "${desc.declaredBy}" is not namespaced under that id; dropping`
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
    const effective: Record<string, boolean> = {};
    const allCaps = input.capabilities.map(c => c.id);

    for (const cap of input.capabilities) {
        effective[cap.id] = cap.default === "allow";
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
                        effective[capId] = value;
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
