/**
 * Auto-title derivation for a chat session.
 *
 * Lives in `shared/` rather than inside the server module because it is pure string
 * work with no registry, storage or provider dependency — and because the session bar
 * renders the result on ONE line, which is a UI constraint worth pinning with tests.
 *
 * The title derives from the FIRST user message only, and `resolveAutoTitle` on the
 * server stops recomputing once a real title exists, so whatever this returns is what
 * the user lives with for the rest of the session.
 */

/** Budget for the one-line session-switcher control, in characters. */
export const TITLE_MAX_CHARS = 60;

export const DEFAULT_SESSION_TITLE = 'New chat';

/**
 * Collapse a first user message into a one-line title.
 *
 * Whitespace is collapsed (a dictated or pasted multi-line message would otherwise
 * carry newlines into a single-line control), the cut lands on a word boundary, and a
 * cut is marked with an ellipsis so a truncated title reads as truncated rather than
 * as a mangled sentence.
 *
 * A first "word" longer than half the budget is a URL or a token blob rather than
 * prose; cutting back to the last space would leave nothing, so it is hard-cut instead.
 */
export function titleFromFirstMessage(text: unknown): string {
    const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!normalized) return DEFAULT_SESSION_TITLE;
    if (normalized.length <= TITLE_MAX_CHARS) return normalized;

    const head = normalized.slice(0, TITLE_MAX_CHARS);
    const lastSpace = head.lastIndexOf(' ');
    const cut = lastSpace >= TITLE_MAX_CHARS / 2 ? head.slice(0, lastSpace) : head;
    return cut.replace(/[\s,;:.\-]+$/, '') + '…';
}
