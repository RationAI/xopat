/**
 * Fitting a structured script result into the chat's inline budget.
 *
 * A script's return value is inlined into the model's next turn up to a fixed
 * character budget. What overflows used to be cut at a character OFFSET, which was
 * lossy in a way nobody chose: results are objects whose fields are ordered
 * small-decisions-first, so one oversized field in the middle (an overview's node
 * tree) took every field after it down with it. The short, decision-bearing tail —
 * `summary`, `warnings`, `budget` — never reached the model at all, while the tree
 * that displaced them was itself cut mid-token and unusable to anyone.
 *
 * Dropping whole FIELDS instead keeps every field that fits, replaces only the
 * oversized ones with a pointer the model can read back through a result handle,
 * and therefore delivers strictly more usable content in fewer characters.
 *
 * Pure and namespace-agnostic: the budget belongs to the chat layer, so nothing that
 * produces a result needs to know this exists.
 */

/** A field too large to inline, replaced by directions for reading it back. */
export type OmittedFieldPointer = {
    __omitted__: {
        path: string;
        chars: number;
        read?: string;
    };
};

export type StructuredResultOptions = {
    /** Inline budget in characters. */
    maxChars: number;
    /**
     * Resolves the handle the full result is parked under, or null when no result
     * store is available. Called at most once, and only when something overflows —
     * storing a large value costs memory, so a result that fits must not pay it.
     */
    getHandle?: () => string | null;
};

export type StructuredResultOutcome = {
    /** Text to inline. */
    text: string;
    /** Field names replaced by a pointer, in result order. */
    omitted: string[];
    /** True when the value fit and nothing was dropped. */
    complete: boolean;
};

/**
 * Budget reserved for one `__omitted__` pointer. Deliberately generous — undershooting
 * would let the assembled body exceed the budget, which is what this accounting exists
 * to prevent.
 */
const OMITTED_FIELD_POINTER_CHARS = 200;

/** Headroom for the pointers and the trailing explanatory note. */
const NOTE_RESERVE_CHARS = 600;

export function safeJsonString(value: unknown): string {
    try {
        return JSON.stringify(value) ?? "null";
    } catch (_) {
        // Circular or otherwise unserializable: the caller's sanitizer normally
        // prevents this, but a result must never take the turn down.
        return JSON.stringify(String(value));
    }
}

/**
 * Serialize `value` to fit `maxChars`, dropping whole fields rather than cutting text.
 *
 * Objects are walked in key order; arrays and scalars have no field order worth
 * preserving (their elements are peers), so they are returned whole and the caller
 * applies its own text truncation — `complete: false` with an empty `omitted` list
 * signals exactly that case.
 */
export function serializeStructuredResult(
    value: unknown,
    options: StructuredResultOptions
): StructuredResultOutcome {
    const maxChars = Math.max(1, options.maxChars | 0);
    const whole = safeJsonString(value);
    if (whole.length <= maxChars) return { text: whole, omitted: [], complete: true };

    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { text: whole, omitted: [], complete: false };
    }

    let handle: string | null = null;
    try {
        handle = options.getHandle ? options.getHandle() : null;
    } catch (_) {
        handle = null;
    }

    const kept: Record<string, unknown> = {};
    const omitted: string[] = [];
    const budget = Math.max(1, maxChars - NOTE_RESERVE_CHARS);
    let used = 2; // the enclosing braces

    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
        const json = safeJsonString(entryValue);
        // key + quotes + colon + comma
        const cost = key.length + 4 + json.length;
        if (used + cost <= budget) {
            kept[key] = entryValue;
            used += cost;
            continue;
        }
        // Keep scanning rather than stopping: a later field is often far smaller than
        // the one that just overflowed, and those small tail fields are exactly what
        // an offset cut always destroyed.
        omitted.push(key);
        const pointer: OmittedFieldPointer = {
            __omitted__: {
                path: key,
                chars: json.length,
                ...(handle
                    ? { read: `application.readScriptResult(${JSON.stringify(handle)}, { path: ${JSON.stringify(key)} })` }
                    : {}),
            },
        };
        kept[key] = pointer;
        used += OMITTED_FIELD_POINTER_CHARS;
    }

    if (!omitted.length) {
        // Every field fit individually but the whole did not — only possible when the
        // reserve is what pushed it over. Let the caller truncate the text instead.
        return { text: whole, omitted: [], complete: false };
    }

    const body = safeJsonString(kept);
    const fields = omitted.join(", ");
    const note = handle
        ? `\n\n[Result too large for one message: the field(s) ${fields} were replaced by an "__omitted__" pointer. `
            + `EVERY OTHER FIELD ABOVE IS COMPLETE, not truncated. The full result is stored under handle "${handle}" — `
            + `read an omitted field with await application.readScriptResult("${handle}", { path: "<field>" }), `
            + `and address deeper with a dotted path (e.g. "${omitted[0]}[0].children").]`
        : `\n\n[Result too large for one message: the field(s) ${fields} were replaced by an "__omitted__" pointer. `
            + `Every other field above is complete.]`;

    return { text: `${body}${note}`, omitted, complete: false };
}
