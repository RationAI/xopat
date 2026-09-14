/**
 * Remove a recognizer's echo of its own biasing prompt from a transcript.
 *
 * Whisper-family models, given a prompt (the pathology glossary the chat sends) over
 * (near-)silent audio, regurgitate that prompt verbatim as the "transcript" — often
 * repeated and interleaved with markers like `context:` / `###`. Left in, that echo is
 * treated as real speech: it floods the transcript, and (worse) a probe segment that
 * "transcribes to text" flips the whole session fail-open. Removing the prompt's own
 * phrases blanks such a segment, and an empty transcript is "no speech" everywhere.
 *
 * Pure functions, so the rules can be pinned by unit tests: what may be removed from a
 * medical transcript is exactly the kind of decision that must not drift silently.
 */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Strip ≥25-character fragments of the prompt (sentence/section splits of the glossary,
 * and the whole context tail) wherever they appear, then blank the remainder if it was
 * nothing but echo (see {@link isPurePromptEcho}).
 *
 * The 25-character floor is what protects speech: a single glossary term dictated on
 * its own is never long enough to be removed. Only runs of prompt text are.
 */
export function stripPromptEcho(text: string, prompt?: string, context?: string): string {
    const original = String(text || "");
    const contextNorm = String(context || "").replace(/\s+/g, " ").trim();
    // Only the glossary part is fragment-split; the context tail is excluded
    // from it so its sentences are not individually removable.
    let promptNorm = String(prompt || "").replace(/\s+/g, " ").trim();
    if (contextNorm && promptNorm.endsWith(contextNorm)) {
        promptNorm = promptNorm.slice(0, -contextNorm.length).trim();
    }
    if (!original.trim() || (promptNorm.length < 25 && contextNorm.length < 25)) return original;

    // Candidate fragments: the whole prompt plus its sentence/section splits;
    // ≥25 chars keeps single terms out. Longest first so a big run is removed
    // before its sub-parts (avoids leaving orphan slivers).
    const frags = new Set<string>();
    if (promptNorm.length >= 25) frags.add(promptNorm);
    if (contextNorm.length >= 25) frags.add(contextNorm);
    for (const part of promptNorm.split(/[.:]|#{2,}/)) {
        const p = part.trim();
        if (p.length >= 25) frags.add(p);
    }
    let t = ` ${original.replace(/\s+/g, " ").trim()} `;
    for (const f of [...frags].sort((a, b) => b.length - a.length)) {
        try { t = t.replace(new RegExp(escapeRe(f), "gi"), " "); }
        catch (_e) { /* skip a fragment that won't compile */ }
    }
    // Markers the echo introduces around the repeated prompt.
    t = t.replace(/\b(?:context|prompt)\s*:/gi, " ").replace(/#{2,}/g, " ");
    t = t.replace(/\s+/g, " ").trim();

    // Nothing but stray punctuation left ⇒ it was pure echo ⇒ no speech. Any script
    // counts as speech: a Latin-only test here blanked every Japanese segment.
    if (!/[\p{L}\p{N}]/u.test(t)) return "";
    return isPurePromptEcho(t, promptNorm) ? "" : t;
}

/**
 * Is what survived the ≥25 stripping made of NOTHING but shorter prompt pieces, led by
 * one of the prompt's own labels?
 *
 * The length rule above protects real speech: a pathologist saying a single glossary
 * word must keep it. But an echo of only the short pieces —
 * `". Common terms: . Built-in tissue detector"`, observed reaching dictated pathology
 * transcripts — passes it untouched, because no individual piece is long enough. So the
 * pieces are re-split here (commas too, since prompt lists are comma-joined) and matched
 * as whole words against the remainder.
 *
 * Blanking requires an echoed LABEL (`Common terms:`). It used to also trigger on "two
 * pieces and nothing else", which blanked real dictation: the glossary is made of exactly
 * the words a pathologist says, and `"fibrosis, necrosis."` is two of them. A label is
 * something nobody dictates; two clinical terms is a finding.
 */
export function isPurePromptEcho(remainder: string, promptNorm: string): boolean {
    if (!promptNorm) return false;
    const pieces = promptNorm.split(/[.:,]|#{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length >= 4);
    if (!pieces.length) return false;

    let rest = ` ${remainder} `;
    let hits = 0;
    let hadLeadIn = false;
    for (const piece of pieces.sort((a, b) => b.length - a.length)) {
        let probe: RegExp;
        let all: RegExp;
        try {
            // Whole-word matches only: a piece must not be found inside a longer word.
            probe = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(piece)}(?![\\p{L}\\p{N}])`, "iu");
            all = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(piece)}(?![\\p{L}\\p{N}])`, "giu");
        } catch (_e) { continue; }
        if (!probe.test(rest)) continue;
        hits++;
        // `Common terms:` — a prompt's own label, never dictated.
        if (new RegExp(`${escapeRe(piece)}\\s*:`, "i").test(remainder)) hadLeadIn = true;
        rest = rest.replace(all, " ");
    }
    if (!hits || !hadLeadIn) return false;
    return !/[a-z0-9]/i.test(rest);
}
