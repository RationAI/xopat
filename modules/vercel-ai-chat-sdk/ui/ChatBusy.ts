// `ChatBusyKind` is declared globally in types/shared.d.ts — event consumers name it too.

/**
 * Most-specific first: when several phases overlap, the one the user is most likely waiting on
 * supplies the status text. A turn outranks the session refresh that trails it; boot ranks last
 * because everything it triggers describes itself better than "starting" does.
 */
const PRIORITY: ChatBusyKind[] = [
    "turn",
    "session-load",
    "session-create",
    "login",
    "attachment",
    "models",
    "sessions",
    "provider",
    "boot",
];

export interface ChatBusyEntry {
    kind: ChatBusyKind;
    /** i18n key describing the phase, e.g. `chat.loadingSession`. */
    statusKey: string;
    /** Interpolation values for `statusKey`. */
    args?: Record<string, any>;
}

/**
 * Every phase of the chat panel that makes the user wait — one registry.
 *
 * Before this existed the panel tracked "busy" with three unrelated booleans and a pile of
 * `_setStatus` calls, so any phase nobody remembered to instrument (session hydration, model
 * fetch, attachment upload) ran completely silently and looked like a hang. A phase now
 * registers here, and every indicator (the header progress bar, the status line, the disabled
 * controls, the session picker) is *derived* from the registry rather than set by hand.
 *
 * Entries are tokens, not flags: overlapping refreshes of the same kind nest, and `end` is
 * idempotent, so a `finally` can never leave the UI stuck in a busy state it cannot exit.
 */
export class ChatBusy {
    _entries: Map<number, ChatBusyEntry>;
    _seq: number;
    _listeners: Array<(busy: ChatBusy) => void>;

    constructor() {
        this._entries = new Map();
        this._seq = 0;
        this._listeners = [];
    }

    /** Registers a running phase. Keep the returned token and `end()` it in a `finally`. */
    begin(kind: ChatBusyKind, statusKey: string, args?: Record<string, any>): number {
        const token = ++this._seq;
        this._entries.set(token, { kind, statusKey, args });
        this._notify();
        return token;
    }

    /** Idempotent — ending an unknown or already-ended token is a no-op. */
    end(token: number | null | undefined): void {
        if (token == null) return;
        if (!this._entries.delete(token)) return;
        this._notify();
    }

    /** Runs `fn` with a busy entry held for its lifetime, whatever way it settles. */
    async run<T>(kind: ChatBusyKind, statusKey: string, fn: () => Promise<T> | T, args?: Record<string, any>): Promise<T> {
        const token = this.begin(kind, statusKey, args);
        try {
            return await fn();
        } finally {
            this.end(token);
        }
    }

    /** True when the given phase is running — or, with no argument, when anything is. */
    has(kind?: ChatBusyKind): boolean {
        if (!kind) return this._entries.size > 0;
        for (const entry of this._entries.values()) {
            if (entry.kind === kind) return true;
        }
        return false;
    }

    /** Distinct running kinds, highest priority first. */
    kinds(): ChatBusyKind[] {
        const running = new Set<ChatBusyKind>();
        for (const entry of this._entries.values()) running.add(entry.kind);
        return PRIORITY.filter((kind) => running.has(kind));
    }

    /** The entry whose text should be shown, or null when nothing is running. */
    top(): ChatBusyEntry | null {
        let best: ChatBusyEntry | null = null;
        let bestRank = Number.MAX_SAFE_INTEGER;
        for (const entry of this._entries.values()) {
            const rank = PRIORITY.indexOf(entry.kind);
            const effective = rank < 0 ? PRIORITY.length : rank;
            if (effective < bestRank) {
                bestRank = effective;
                best = entry;
            }
        }
        return best;
    }

    onChange(callback: (busy: ChatBusy) => void): () => void {
        this._listeners.push(callback);
        return () => {
            const index = this._listeners.indexOf(callback);
            if (index >= 0) this._listeners.splice(index, 1);
        };
    }

    _notify(): void {
        for (const listener of this._listeners.slice()) {
            try {
                listener(this);
            } catch (error) {
                console.error("Chat busy listener failed:", error);
            }
        }
    }
}
