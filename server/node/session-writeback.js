/**
 * Session change detection for the per-request write-back.
 *
 * Extracted from index.js so the invariant below can be tested. It is worth testing:
 * getting it wrong silently discarded every in-place session mutation, which is how
 * a completed SAML login could save a token that no later request could see.
 */

/**
 * Keys that live in the IDENTITY half (shared across cluster workers). Everything
 * else lands in the secure half.
 *
 * Splitting by a FIXED key list rather than a heuristic is deliberate: an unknown key
 * lands in the secure half, so a module that starts stashing something new never
 * silently gains persistence.
 */
const SESSION_SHARED_KEYS = Object.freeze(new Set([
    "id", "csrfToken", "createdAt", "lastSeenAt", "allowedProxies",
]));

/**
 * Split the live session into its two halves. The values are **references**, not
 * copies — callers get a view onto the live session, which is what the deferred
 * write-back needs when it reads the final state.
 *
 * Therefore: **a snapshot taken for change detection must not be this.** Serialize it
 * with {@link serializeSessionHalf}, or the diff compares a mutated object against
 * itself and concludes nothing changed.
 */
function splitSession(session) {
    const shared = {};
    const secure = {};
    for (const [key, value] of Object.entries(session || {})) {
        (SESSION_SHARED_KEYS.has(key) ? shared : secure)[key] = value;
    }
    return { shared, secure };
}

/**
 * Per-key SERIALIZED snapshot of one half.
 *
 * This is the whole correctness condition of the write-back: hold the state as it
 * *was*, not a window onto the state as it *will be*. Modules mutate session state in
 * place — `ctx.session.__saml.sessions[x] = …` — because that is the only thing they
 * can do; there is no session-set API. A snapshot of the live objects therefore
 * mutates along with them.
 *
 * Costs nothing extra: {@link mergeSessionWriteBack} stringifies each value anyway.
 */
function serializeSessionHalf(half) {
    const out = {};
    for (const [key, value] of Object.entries(half || {})) out[key] = JSON.stringify(value);
    return out;
}

/**
 * Write back only what changed.
 *
 * @param snapshot per-key SERIALIZED values as of request resolve time — the output
 *   of {@link serializeSessionHalf}, never the live objects.
 * @returns whether anything was written.
 */
async function mergeSessionWriteBack(store, id, snapshot, current) {
    const changed = {};
    let hasChange = false;
    for (const [key, value] of Object.entries(current)) {
        if (JSON.stringify(value) !== snapshot[key]) {
            changed[key] = value;
            hasChange = true;
        }
    }
    const removed = Object.keys(snapshot).filter(k => !(k in current));
    if (!hasChange && !removed.length) return false;

    const stored = (await store.get(id)) || {};
    const next = { ...stored, ...changed };
    for (const key of removed) delete next[key];
    await store.set(id, next);
    return true;
}

module.exports = {
    SESSION_SHARED_KEYS,
    splitSession,
    serializeSessionHalf,
    mergeSessionWriteBack,
};
