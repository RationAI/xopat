/**
 * Content-addressed handle for the scripting-API manifest.
 *
 * `allowedScriptApi` is the largest fixed cost in a turn request: a full
 * namespace/method manifest with TypeScript declarations, identical for every
 * turn of a session, re-serialized and re-sent each time. Nothing about it is
 * per-turn — only the first turn of a session actually needs to carry it.
 *
 * So the client sends a hash and the server resolves it from a bounded cache; a
 * miss is a normal, self-correcting outcome (the client retries once with the
 * manifest inline), which is what keeps this from becoming a stateful protocol
 * that can wedge. Both sides derive the hash from the SAME function over the
 * same canonical serialization — if they ever disagree the effect is a cache
 * miss and a resend, never a wrong manifest.
 *
 * The hash is FNV-1a, not a cryptographic digest: it addresses content the
 * server already accepted from that same principal, so collision resistance
 * against an attacker is not what is being asked of it. It must not be used to
 * authenticate anything.
 *
 * Pure module: no `window`, no Node globals. Imported by both the client
 * (`chatService.ts`) and the server (`server/chat.server.ts`).
 */

/** Deterministic serialization: object key order must not change the hash. */
function canonicalize(value: any): any {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        const out: Record<string, any> = {};
        for (const key of Object.keys(value).sort()) {
            const entry = (value as any)[key];
            if (entry === undefined) continue;
            out[key] = canonicalize(entry);
        }
        return out;
    }
    return value;
}

/** FNV-1a over UTF-16 code units, seeded twice to widen the output to 64 bits. */
function fnv1a(text: string, seed: number): number {
    let hash = seed;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        // 16777619, expressed as shifts to stay in 32-bit integer math.
        hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
    }
    return hash >>> 0;
}

/**
 * Stable content hash of a scripting-API manifest, or `null` when there is no
 * manifest to address (nothing to cache, nothing to resolve).
 */
export function hashScriptApiManifest(manifest: AllowedScriptApiManifest | undefined | null): string | null {
    if (!manifest?.namespaces?.length) return null;
    const json = JSON.stringify(canonicalize(manifest));
    const lo = fnv1a(json, 0x811c9dc5);
    const hi = fnv1a(json, 0x01000193);
    return `${hi.toString(16).padStart(8, '0')}${lo.toString(16).padStart(8, '0')}`;
}

/** Error code the server answers with when a handle names a manifest it no longer holds. */
export const MANIFEST_MISS_CODE = 'CHAT_MANIFEST_MISS';
