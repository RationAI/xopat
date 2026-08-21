/**
 * Provider *references*: how static deployment config names a provider.
 *
 * Provider instances are minted with a random id (`uid('prov')`) into a registry that lives
 * only in `globalThis`, so the id is re-minted on every server start. Nothing durable can name
 * one: `extractionProviderId: "prov_m9x…"` is stale the moment the process restarts. But the
 * managed-registration path (`server/providerRegistration.server.ts`) already stamps three
 * identifiers that ARE stable across boots — `metadata.managedKey`, `metadata.managedByPlugin`
 * and `typeId` — so config can name any of those instead and be resolved at use time.
 *
 * Precedence is SHORT-CIRCUIT, not merged: the first tier with any candidate ends the search.
 * That is what makes `managedKey` a usable disambiguator when a broader tier is ambiguous.
 *
 *   1. `id`         exact instance id
 *   2. `managedKey` `metadata.managedKey`, canonically `<pluginId>:<typeId>:default`
 *   3. `plugin`     `metadata.managedByPlugin` — e.g. "chat-openai-compatible"
 *   4. `type`       `typeId` — e.g. "openai-compatible"
 *
 * ── Trust rule (read this before touching `eligible()`) ───────────────────────────────────
 * Tiers 2-4 consider ONLY operator-origin records. `createProviderInstance` spreads caller
 * `metadata` and stamps just `ownerPrincipal` server-side, so a user-created instance can carry
 * a forged `managedKey`/`managedByPlugin`/`autoCreated`/`role`. Were the alias tiers to search
 * user records, any authenticated caller could mint an instance claiming
 * `managedByPlugin: "chat-openai-compatible"` and capture the deployment-wide reference — the
 * operator's configured extraction/vision traffic would then be routed at an endpoint of the
 * caller's choosing. Note the damage is redirection, not secret theft (they would receive their
 * own instance's credentials), but it is a routing and availability hazard and it is trivially
 * avoidable. Operator-only also makes the candidate set caller-INDEPENDENT, which is what makes
 * the tie-break below deterministic rather than a function of who is asking.
 *
 * Tier 1 deliberately has NO eligibility filter. Resolution must hand back another user's
 * instance id unchanged so the caller's access gate can refuse it as a denial; filtering it
 * here would silently degrade "that is not yours" into an alias search that returns a
 * DIFFERENT provider.
 *
 * `metadata.hidden` is likewise NOT a filter. Referencing a hidden provider is the documented
 * use case (keep extraction off the user-facing picker), and the real gates —
 * `assertProviderRead` and `requireProviderContext` — live in `getProviderRuntime`. Callers
 * must therefore match against the unfiltered instance list, never the `listProviders` RPC
 * projection, which strips hidden records for the picker.
 *
 * Pure module: no `window`, no Node globals, no I/O. Imported by both the client (`chat.ts`)
 * and the server (`server/chatRegistry.server.ts`) so the two cannot drift apart.
 */

export type ProviderRefTier = 'id' | 'managedKey' | 'plugin' | 'type';

export interface ProviderRefMatch {
    /** The resolved provider INSTANCE id. */
    id: string;
    /** Which tier matched — for diagnostics and for the ambiguity warning. */
    tier: ProviderRefTier;
    /** Ids of the losing candidates in the same tier. Empty when the match was unique. */
    ambiguous: string[];
}

/** The subset of a provider record this module reads. Structurally satisfied by both bundles. */
export interface ProviderRefRecord {
    id: string;
    typeId?: string | null;
    origin?: string | null;
    metadata?: Record<string, any> | null;
}

/** Trim to a usable string, or null. Rejects non-strings so a forged object cannot match. */
function str(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

/**
 * Mirrors `providerOrigin` in chatRegistry.server.ts, duplicated because this module must stay
 * dependency-free (the client bundle has no access to the server file). Legacy records predate
 * the `origin` field, so derive it: owned ⇒ user, unowned ⇒ operator.
 */
export function isOperatorRecord(rec: ProviderRefRecord): boolean {
    const origin = rec?.origin;
    if (origin === 'operator') return true;
    if (origin === 'user') return false;
    return !str(rec?.metadata?.ownerPrincipal);
}

/**
 * Total order over the candidates of one tier, so an ambiguous reference resolves the same way
 * on every host and every boot.
 *
 * The predecessor of this module (`resolveProviderRuntime` in inference.server.ts) used a bare
 * `Array.find` over a list sorted by `updatedAt` DESC — i.e. "whichever plugin re-registered
 * most recently wins", which flips with plugin boot order and is untestable.
 *
 * Also used to pick a provider when static config names NONE at all (the speech-to-text `vercel`
 * driver in auto mode, `runTranscription` in inference.server.ts). That is why the order lives
 * here and is exported rather than being re-derived per call site: "which provider does an
 * unqualified reference mean" and "which provider does no reference mean" must not drift apart.
 */
export function compareProviderCandidates(a: ProviderRefRecord, b: ProviderRefRecord): number {
    // A provider nominated for the *specific* job wins over the generic default. Only
    // 'transcription-default' exists today; keep new roles job-scoped the same way.
    const aStt = a?.metadata?.role === 'transcription-default' ? 0 : 1;
    const bStt = b?.metadata?.role === 'transcription-default' ? 0 : 1;
    if (aStt !== bStt) return aStt - bStt;

    // A provider the deployment already tagged as its default is the least surprising winner.
    const aDefault = a?.metadata?.role === 'default-provider' ? 0 : 1;
    const bDefault = b?.metadata?.role === 'default-provider' ? 0 : 1;
    if (aDefault !== bDefault) return aDefault - bDefault;

    // Then a visible provider over an internal one: a hidden provider is a deliberate
    // specialisation, so it should be named deliberately (by managedKey) rather than won by
    // accident through a broad type-id reference.
    const aHidden = a?.metadata?.hidden === true ? 1 : 0;
    const bHidden = b?.metadata?.hidden === true ? 1 : 0;
    if (aHidden !== bHidden) return aHidden - bHidden;

    // Then lexicographic, purely for stability. managedKey first because it is the more
    // meaningful of the two; id is the final tiebreak and is always present.
    const aKey = str(a?.metadata?.managedKey) ?? '';
    const bKey = str(b?.metadata?.managedKey) ?? '';
    if (aKey !== bKey) return aKey < bKey ? -1 : 1;

    return String(a?.id ?? '') < String(b?.id ?? '') ? -1 : 1;
}

const ALIAS_TIERS: Array<{ tier: ProviderRefTier; key: (rec: ProviderRefRecord) => string | null }> = [
    { tier: 'managedKey', key: (rec) => str(rec?.metadata?.managedKey) },
    { tier: 'plugin', key: (rec) => str(rec?.metadata?.managedByPlugin) },
    { tier: 'type', key: (rec) => str(rec?.typeId) },
];

/**
 * Resolve a provider reference against a list of provider records.
 *
 * @param records the UNFILTERED instance list (see the hidden-provider note in the file header)
 * @param ref an instance id, managedKey, plugin id or type id
 * @returns the match, or `null` when the reference names nothing resolvable
 */
export function matchProviderRef(
    records: ReadonlyArray<ProviderRefRecord> | null | undefined,
    ref: string | null | undefined,
): ProviderRefMatch | null {
    const wanted = str(ref);
    if (!wanted) return null;
    const all = Array.isArray(records) ? records : [];

    // Tier 1 — exact instance id. No eligibility filter, on purpose (file header).
    for (const rec of all) {
        if (rec && String(rec.id) === wanted) {
            return { id: rec.id, tier: 'id', ambiguous: [] };
        }
    }

    const pool = all.filter((rec) => rec && isOperatorRecord(rec));

    for (const { tier, key } of ALIAS_TIERS) {
        const hits = pool.filter((rec) => key(rec) === wanted);
        if (!hits.length) continue;
        const sorted = [...hits].sort(compareProviderCandidates);
        return {
            id: sorted[0].id,
            tier,
            ambiguous: sorted.slice(1).map((rec) => String(rec.id)),
        };
    }

    return null;
}

/**
 * True when a reference matched nothing eligible but WOULD have matched a user-owned record.
 *
 * The operator-only rule above is the one part of resolution that is invisible from the outside
 * — without this, a deployer whose reference is being shadowed by a user instance sees only
 * "no provider matches" and has nothing to go on. Callers use it to warn.
 */
export function refShadowedByUserInstance(
    records: ReadonlyArray<ProviderRefRecord> | null | undefined,
    ref: string | null | undefined,
): boolean {
    const wanted = str(ref);
    if (!wanted) return false;
    const all = Array.isArray(records) ? records : [];
    return all.some((rec) =>
        rec &&
        !isOperatorRecord(rec) &&
        ALIAS_TIERS.some(({ key }) => key(rec) === wanted));
}

/** One diagnostic line for a reference that resolved to nothing. Never includes secrets. */
export function describeProviderRefFailure(ref: string | null | undefined): string {
    return `Unknown provider '${str(ref) ?? ''}'. A provider reference must be an instance id, ` +
        `a managed key ('<plugin>:<type>:default'), a plugin id (e.g. 'chat-openai-compatible') ` +
        `or a provider type id (e.g. 'openai-compatible'), and must name an operator-registered provider.`;
}
