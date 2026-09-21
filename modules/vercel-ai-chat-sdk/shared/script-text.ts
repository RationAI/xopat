/**
 * Structural reading of model-authored script text: bracket census, fenced-block extraction,
 * balanced JSON payload readers, and line-numbered excerpts.
 *
 * WHY THIS EXISTS: the text carrying a script from the model to the runtime can arrive damaged —
 * a provider or SDK layer that drops characters, an envelope truncated mid-payload, a lazy regex
 * that stops at the first inner triple-backtick. The runtime used to notice only when the worker
 * failed to compile, and then told the model "Unexpected token ';'" about code the model believes
 * it wrote correctly, so it re-emitted the same bytes until the retry budget ran out.
 *
 * Everything here is deliberately NOT a JS lexer: the input is, by definition, possibly
 * unparseable. Raw character bookkeeping cannot prove a script is valid, but it can localize the
 * damage and name WHICH character class went missing — which is what makes the model-facing
 * feedback specific without hardcoding anything about a particular provider.
 *
 * Pure module: no `window`, no Node globals. Imported by the client (`chat.ts`, `ui/*`) and the
 * server (`server/chat.server.ts`), same as its sibling `tool-envelope.ts`.
 *
 * TODO: should this enveloping be part of scripting manager instead?
 */

export interface BracketPairCensus {
    open: number;
    close: number;
}

export interface BracketCensus {
    chars: number;
    lines: number;
    paren: BracketPairCensus;
    square: BracketPairCensus;
    curly: BracketPairCensus;
    /** Every kind pairs up, in order, with nothing left open and no stray closer. */
    balanced: boolean;
    /**
     * Closers whose opener appeared but which never appear at all (`[` seen, `]` never).
     * A model essentially never writes that; a transport that drops a character class does.
     */
    vanished: Array<")" | "]" | "}">;
    /** 1-based line of the first stray closer, else of the first opener left unclosed. */
    firstImbalanceLine: number | null;
}

const CLOSER_OF: Record<string, ")" | "]" | "}"> = { "(": ")", "[": "]", "{": "}" };

/**
 * Count brackets and locate the first place the nesting stops making sense.
 *
 * Brackets inside strings, comments and regex literals are counted like any other, so
 * `balanced: false` is EVIDENCE, never proof — `ScriptingManager.validateScript` is the authority
 * on compilability. What this adds is the position and the `vanished` signal, neither of which a
 * `SyntaxError` from the Function constructor carries.
 */
export function bracketCensus(text: string): BracketCensus {
    const source = String(text || "");

    const counts: Record<string, number> = { "(": 0, ")": 0, "[": 0, "]": 0, "{": 0, "}": 0 };
    const stack: Array<{ char: string; line: number }> = [];

    let line = 1;
    let lines = source ? 1 : 0;
    let firstImbalanceLine: number | null = null;
    let strayOrMismatched = false;

    for (let i = 0; i < source.length; i++) {
        const ch = source.charAt(i);

        if (ch === "\n") {
            line++;
            lines++;
            continue;
        }
        if (!(ch in counts)) continue;

        counts[ch] = (counts[ch] ?? 0) + 1;

        if (ch === "(" || ch === "[" || ch === "{") {
            stack.push({ char: ch, line });
            continue;
        }

        const top = stack[stack.length - 1];
        if (top && CLOSER_OF[top.char] === ch) {
            stack.pop();
        } else {
            strayOrMismatched = true;
            if (firstImbalanceLine === null) firstImbalanceLine = line;
        }
    }

    if (firstImbalanceLine === null && stack.length) {
        // The earliest opener still on the stack is where the reader loses the thread.
        firstImbalanceLine = stack[0]!.line;
    }

    const paren = { open: counts["("] ?? 0, close: counts[")"] ?? 0 };
    const square = { open: counts["["] ?? 0, close: counts["]"] ?? 0 };
    const curly = { open: counts["{"] ?? 0, close: counts["}"] ?? 0 };

    const vanished: Array<")" | "]" | "}"> = [];
    if (paren.open > 0 && paren.close === 0) vanished.push(")");
    if (square.open > 0 && square.close === 0) vanished.push("]");
    if (curly.open > 0 && curly.close === 0) vanished.push("}");

    return {
        chars: source.length,
        lines,
        paren,
        square,
        curly,
        balanced:
            !strayOrMismatched &&
            stack.length === 0 &&
            paren.open === paren.close &&
            square.open === square.close &&
            curly.open === curly.close,
        vanished,
        firstImbalanceLine,
    };
}

/** One greppable line: `chars=812 lines=24 ()=12/12 []=4/0 {}=6/6 balanced=false`. */
export function formatCensus(census: BracketCensus): string {
    return [
        `chars=${census.chars}`,
        `lines=${census.lines}`,
        `()=${census.paren.open}/${census.paren.close}`,
        `[]=${census.square.open}/${census.square.close}`,
        `{}=${census.curly.open}/${census.curly.close}`,
        `balanced=${census.balanced}`,
    ].join(" ");
}

/**
 * Plain-English description of the damage, generated from the census — never a per-provider
 * special case. Returns undefined when the census shows nothing wrong.
 */
export function describeCensusDamage(census: BracketCensus): string | undefined {
    if (census.vanished.length) {
        const parts = census.vanished.map((closer) => {
            const opener = closer === ")" ? "(" : closer === "]" ? "[" : "{";
            const opened = closer === ")" ? census.paren.open : closer === "]" ? census.square.open : census.curly.open;
            return `every \`${closer}\` is missing (${opened} \`${opener}\` opened, 0 closed)`;
        });
        return parts.join("; ");
    }
    if (census.balanced) return undefined;

    const at = census.firstImbalanceLine ? ` starting at line ${census.firstImbalanceLine}` : "";
    return `the brackets do not pair up${at} (()=${census.paren.open}/${census.paren.close}, ` +
        `[]=${census.square.open}/${census.square.close}, {}=${census.curly.open}/${census.curly.close})`;
}

export interface FenceMatch {
    /** The info string of the opening fence, lowercased (`xopat-script`, `js`, ...). */
    tag: string;
    body: string;
    /** Index of the opening backticks. */
    start: number;
    /** Index just past the closing backticks, or `text.length` when unterminated. */
    end: number;
    terminated: boolean;
    balanced: boolean;
}

const PRIMARY_FENCE_TAGS = ["xopat-script", "xopat-host-script"];
const FALLBACK_FENCE_TAGS = ["javascript", "js", "typescript", "ts"];

interface CloserCandidate {
    index: number;
    end: number;
    lineAnchored: boolean;
}

/** Every ``` after `from`, flagged by whether it sits alone on its own line. */
function closerCandidates(text: string, from: number): CloserCandidate[] {
    const out: CloserCandidate[] = [];

    for (let i = from; (i = text.indexOf("```", i)) >= 0; i += 3) {
        let before = i - 1;
        while (before >= 0 && (text[before] === " " || text[before] === "\t")) before--;
        const atLineStart = before < 0 || text[before] === "\n" || text[before] === "\r";

        let after = i + 3;
        while (after < text.length && (text[after] === " " || text[after] === "\t")) after++;
        const atLineEnd = after >= text.length || text[after] === "\n" || text[after] === "\r";

        out.push({ index: i, end: i + 3, lineAnchored: atLineStart && atLineEnd });
    }

    return out;
}

function findFenceWithTags(text: string, tags: string[]): FenceMatch | undefined {
    const opener = new RegExp("```[ \\t]*(" + tags.join("|") + ")[ \\t]*\\r?\\n?", "i");
    const match = opener.exec(text);
    if (!match) return undefined;

    const start = match.index;
    const bodyStart = match.index + match[0].length;
    const tag = String(match[1] || "").toLowerCase();

    const candidates = closerCandidates(text, bodyStart);
    // A ``` alone on its own line is a real fence terminator; one mid-line is virtually always
    // inside a template literal or a string, so only fall back to those when there is no other.
    const anchored = candidates.filter((c) => c.lineAnchored);
    const pool = anchored.length ? anchored : candidates;

    if (!pool.length) {
        const body = text.slice(bodyStart);
        return { tag, body: body.trim(), start, end: text.length, terminated: false, balanced: bracketCensus(body).balanced };
    }

    // Prefer the first terminator that leaves a self-consistent body: that is what makes a script
    // containing its own ``` survive instead of being cut at the inner one.
    for (const candidate of pool) {
        const body = text.slice(bodyStart, candidate.index);
        if (bracketCensus(body).balanced) {
            return { tag, body: body.trim(), start, end: candidate.end, terminated: true, balanced: true };
        }
    }

    // Nothing balances — take the LAST terminator, i.e. the maximal body. Handing the runtime a
    // longer broken script is recoverable (it is reported verbatim); silently dropping half of it
    // is not.
    const last = pool[pool.length - 1]!;
    return {
        tag,
        body: text.slice(bodyStart, last.index).trim(),
        start,
        end: last.end,
        terminated: true,
        balanced: false,
    };
}

/**
 * The script fence in `text`, if any. `xopat-script` wins; a generic code fence is the fallback,
 * preserving the precedence the previous regex pair had.
 */
export function findScriptFence(text: string): FenceMatch | undefined {
    const source = String(text || "");
    if (!source.includes("```")) return undefined;
    return findFenceWithTags(source, PRIMARY_FENCE_TAGS) || findFenceWithTags(source, FALLBACK_FENCE_TAGS);
}

/**
 * Streaming early-exit predicate: is there a fence that is both closed AND self-consistent?
 *
 * Deliberately the same code path as the extractor, so "what stops generation is exactly what
 * will execute" is a fact rather than an aspiration. An unbalanced body keeps streaming — the
 * remaining tokens may be the closers.
 */
export function hasCompleteScriptFence(text: string): boolean {
    const fence = findScriptFence(text);
    return !!fence && fence.terminated && fence.balanced;
}

/** Skip spaces/tabs/newlines from `start`. */
function skipWhitespace(text: string, start: number): number {
    let i = start;
    while (i < text.length && /\s/.test(text.charAt(i))) i++;
    return i;
}

/**
 * The balanced JSON object beginning at/after `start`, string- and escape-aware.
 * Returns undefined when there is no `{` there or the object never closes.
 */
export function readJsonObjectAt(text: string, start: number): string | undefined {
    const source = String(text || "");
    const begin = skipWhitespace(source, Math.max(0, start | 0));
    if (source[begin] !== "{") return undefined;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = begin; i < source.length; i++) {
        const ch = source.charAt(i);

        if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }

        if (ch === '"') inString = true;
        else if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) return source.slice(begin, i + 1);
        }
    }

    return undefined;
}

export interface JsonStringRead {
    /** Decoded string value (best effort when the payload was cut). */
    value: string;
    /** The raw, still-escaped body between the quotes. */
    raw: string;
    /** False when the closing quote never arrived — the payload was truncated. */
    terminated: boolean;
    /** Index just past the closing quote, or `text.length` when unterminated. */
    end: number;
}

/**
 * The JSON string beginning at/after `start`, honouring backslash escapes — so a `\"` inside the
 * value does not end it. The regex this replaces ended the value at the first quote followed by
 * `,` or `}`, which truncated any script containing a quoted string.
 */
export function readJsonStringAt(text: string, start: number): JsonStringRead | undefined {
    const source = String(text || "");
    const begin = skipWhitespace(source, Math.max(0, start | 0));
    if (source[begin] !== '"') return undefined;

    let escaped = false;

    for (let i = begin + 1; i < source.length; i++) {
        const ch = source.charAt(i);

        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === "\\") {
            escaped = true;
            continue;
        }
        if (ch === '"') {
            const raw = source.slice(begin + 1, i);
            return { value: decodeJsonStringBody(raw), raw, terminated: true, end: i + 1 };
        }
    }

    const raw = source.slice(begin + 1);
    return { value: decodeJsonStringBody(raw), raw, terminated: false, end: source.length };
}

/** JSON unescaping that still yields something usable for a truncated body. */
export function decodeJsonStringBody(raw: string): string {
    try {
        return JSON.parse(`"${raw}"`);
    } catch (_) {
        return String(raw || "")
            .replace(/\\"/g, '"')
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")
            .replace(/\\\\/g, "\\");
    }
}

export interface ExcerptOptions {
    /** 1-based line to centre on; when omitted the excerpt starts at the top. */
    aroundLine?: number | null;
    /** Lines of context on each side of `aroundLine`. */
    radius?: number;
    /** Hard cap; the excerpt is truncated (with a marker) beyond it. */
    maxChars?: number;
}

/**
 * Line-numbered verbatim excerpt, for showing a model the bytes the runtime actually received.
 * Verbatim matters: paraphrasing the damage is what let the same corruption repeat unnoticed.
 */
export function numberedExcerpt(text: string, options: ExcerptOptions = {}): string {
    const source = String(text || "");
    const lines = source.split("\n");
    const maxChars = options.maxChars ?? 4000;
    const radius = options.radius ?? 12;

    let from = 0;
    let to = lines.length;

    if (source.length > maxChars && options.aroundLine) {
        from = Math.max(0, options.aroundLine - 1 - radius);
        to = Math.min(lines.length, options.aroundLine + radius);
    }

    const width = String(to).length;
    const out: string[] = [];
    let used = 0;

    if (from > 0) out.push(`… ${from} earlier line(s) omitted …`);

    for (let i = from; i < to; i++) {
        const rendered = `${String(i + 1).padStart(width, " ")} | ${lines[i] ?? ""}`;
        if (used + rendered.length > maxChars) {
            out.push(`… truncated after ${i - from} line(s) …`);
            return out.join("\n");
        }
        used += rendered.length + 1;
        out.push(rendered);
    }

    if (to < lines.length) out.push(`… ${lines.length - to} later line(s) omitted …`);

    return out.join("\n");
}
