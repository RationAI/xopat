/**
 * Which language hint a dictation session sends to the recognizer.
 *
 * `"auto"` (the default) sends no hint until the recognizer has reported the same
 * language for two consecutive segments — then that language is the hint for the rest
 * of the session. A hint stabilises quiet or term-heavy segments that a free-detect
 * would flip; waiting for two agreeing ~15 s segments keeps a single noisy detection
 * from pinning the wrong language. A fixed BCP-47 value is always sent, as before.
 *
 * Once pinned, a session stays pinned: a hinted recognizer echoes the hint back as its
 * "detected" language, so later votes cannot disagree. A new dictation resets it.
 *
 * Never the UI locale. The viewer's locale says what language the buttons are in, not
 * what the pathologist speaks — pinning transcription to it is how Japanese dictation
 * came back as English filler.
 *
 * Pure: no clock, no DOM.
 */

/** Primary subtag, lower-case: `ja-JP` → `ja`; empty for anything unusable. */
export function primaryLanguage(code?: string | null): string {
    const s = String(code ?? "").trim().toLowerCase();
    if (!s || s === "auto") return "";
    return s.split(/[-_]/)[0] || "";
}

export class LanguagePin {
    readonly mode: "auto" | "fixed";
    private readonly _fixed: string | undefined;
    private _pinned: string | undefined = undefined;
    private _last = "";

    constructor(mode?: string | null) {
        const s = String(mode ?? "").trim();
        if (!s || s.toLowerCase() === "auto") {
            this.mode = "auto";
            this._fixed = undefined;
        } else {
            this.mode = "fixed";
            this._fixed = s;
        }
    }

    /** What to send with the next request; `undefined` lets the recognizer detect. */
    hint(): string | undefined {
        return this.mode === "fixed" ? this._fixed : this._pinned;
    }

    /** The session's language as far as it is known (fixed, or pinned), for telemetry. */
    get language(): string | undefined {
        return this.hint();
    }

    /**
     * Record the language the recognizer reported for one segment. Auto mode only;
     * returns true on the vote that pins the session.
     */
    vote(detected?: string | null): boolean {
        if (this.mode !== "auto" || this._pinned) return false;
        const lang = primaryLanguage(detected);
        if (!lang) return false;
        if (this._last === lang) {
            this._pinned = lang;
            return true;
        }
        this._last = lang;
        return false;
    }

    /** A new dictation: forget the pin and the pending vote. */
    reset(): void {
        this._pinned = undefined;
        this._last = "";
    }
}
