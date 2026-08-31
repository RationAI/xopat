/**
 * Native tool-call envelopes leaking into assistant text, and how to get the script back.
 *
 * The runtime declares a client-side `run_viewer_script` tool, and a provider with a matching
 * tool-call parser surfaces the model's call cleanly — the server transcribes it into the
 * ```xopat-script fenced block (see chat.server.ts). This module handles the OTHER case: a
 * model trained on native tool-call syntax (gpt-oss/Harmony, Kimi/K2, ...) whose backend has NO
 * parser, so the call is decoded straight into `content` as special tokens instead of a
 * structured tool-call:
 *
 *     <|tool_calls_section_begin|><|tool_call_begin|>functions.xopat-script:0
 *     <|tool_call_argument_begin|>{"code": "..."}<|tool_call_end|><|tool_calls_section_end|>
 *
 * The call is well-formed — only its surface is wrong — so recover the payload into the fence
 * contract instead of discarding a turn's real work.
 *
 * The token patterns below are LOCATORS only. Delimiting the payload with a lazy `{...}` match
 * ends it at the first `}` in the script, and delimiting the code with a lazy `"..."` match ends
 * it at the first quote — both silently truncate, and a truncated script fails to compile with an
 * error that describes code the model never wrote. Payload boundaries are therefore read with the
 * balanced, escape-aware readers in `script-text.ts`.
 *
 * Pure module: no `window`, no Node globals. Imported by both the client (`chat.ts`) and the
 * server (`server/chat.server.ts`).
 */

import { readJsonObjectAt, readJsonStringAt } from "./script-text";

/** `functions.xopat-script:0<|tool_call_argument_begin|>` — payload starts right after. */
const NAMED_ENVELOPE_SOURCE =
    "functions\\.(xopat-(?:host-)?script)\\s*:\\s*\\d+\\s*<\\|tool_call_argument_begin\\|>";

/** Bare `<|tool_call_argument_begin|>` — no function name. */
const LOOSE_ENVELOPE_SOURCE = "<\\|tool_call_argument_begin\\|>";

const ENVELOPE_END_RE = /^\s*<\|tool_call_end\|>/;

const ENVELOPE_TOKEN_RE =
    /<\|(?:tool_calls_section_(?:begin|end)|tool_call_(?:begin|end)|tool_call_argument_begin)\|>|functions\.xopat-(?:host-)?script\s*:\s*\d+/i;

export interface ToolPayloadCode {
    code: string;
    /** True when the payload was cut mid-value — the code is a prefix, not the whole script. */
    truncated: boolean;
}

/**
 * Read the script out of a tool-call argument payload — canonically `{"code": "..."}`.
 *
 * Falls back to locating the `"code"` key and reading its (escape-aware) string value when the
 * payload is not valid JSON: a truncated or slightly malformed envelope still usually carries a
 * usable script body, and the caller is told it is a prefix via `truncated`.
 */
export function readToolPayloadCode(payloadText: string): ToolPayloadCode | undefined {
    const payload = String(payloadText || "");
    if (!payload) return undefined;

    let parsedOk = false;
    try {
        const parsed = JSON.parse(payload);
        parsedOk = true;
        if (typeof parsed?.code === "string" && parsed.code.trim()) {
            return { code: parsed.code.trim(), truncated: false };
        }
    } catch (_) {
        // Not valid JSON — fall through to the key-locating reader below.
    }
    // Valid JSON without a usable `code` is simply not a script call.
    if (parsedOk) return undefined;

    const key = /"code"\s*:\s*/.exec(payload);
    if (!key) return undefined;

    const read = readJsonStringAt(payload, key.index + key[0].length);
    if (!read) return undefined;

    const code = read.value.trim();
    if (!code) return undefined;

    return { code, truncated: !read.terminated };
}

/**
 * Back-compatible accessor for call sites that only need the code.
 * @see readToolPayloadCode for the truncation flag.
 */
export function readCodeFromToolPayload(payloadText: string): string | undefined {
    return readToolPayloadCode(payloadText)?.code;
}

/** Cheap probe: does this text contain native tool-call tokens at all? */
export function hasToolEnvelopeTokens(text: string): boolean {
    return ENVELOPE_TOKEN_RE.test(String(text || ""));
}

interface EnvelopeHit {
    /** Index of the first character of the whole envelope (the locator match). */
    start: number;
    /** Index just past the envelope, including the `<|tool_call_end|>` token when present. */
    end: number;
    payload: string;
    code?: string;
    truncated?: boolean;
}

/**
 * Walk `text` for envelopes matched by `locatorSource`, taking each payload with a balanced
 * reader rather than a lazy regex.
 */
function scanEnvelopes(text: string, locatorSource: string): EnvelopeHit[] {
    const locator = new RegExp(locatorSource, "gi");
    const hits: EnvelopeHit[] = [];

    let match: RegExpExecArray | null;
    while ((match = locator.exec(text)) !== null) {
        const payloadStart = match.index + match[0].length;

        // A complete object is the normal case; when it never closes, take everything up to the
        // end token (or end of text) so a truncated envelope still yields its code prefix.
        let payload = readJsonObjectAt(text, payloadStart);
        if (payload === undefined) {
            const endToken = text.indexOf("<|tool_call_end|>", payloadStart);
            payload = text.slice(payloadStart, endToken >= 0 ? endToken : text.length);
        }

        const payloadEnd = text.indexOf(payload, payloadStart) + payload.length;
        const tail = text.slice(payloadEnd);
        const endMatch = ENVELOPE_END_RE.exec(tail);

        const found = readToolPayloadCode(payload.trim());
        hits.push({
            start: match.index,
            end: payloadEnd + (endMatch ? endMatch[0].length : 0),
            payload,
            code: found?.code,
            truncated: found?.truncated,
        });

        // Never rescan inside a payload we already consumed.
        locator.lastIndex = Math.max(locator.lastIndex, payloadEnd);
    }

    return hits;
}

/** Every envelope carrying a readable script, named form preferred over the bare form. */
function scanReadableEnvelopes(text: string): EnvelopeHit[] {
    const named = scanEnvelopes(text, NAMED_ENVELOPE_SOURCE).filter((hit) => hit.code);
    if (named.length) return named;
    return scanEnvelopes(text, LOOSE_ENVELOPE_SOURCE).filter((hit) => hit.code);
}

/**
 * Every script body recoverable from tool-call envelopes in `text`, in order.
 *
 * Each entry keeps its `truncated` flag: a payload cut mid-value yields a code PREFIX, and a
 * caller that treats it as a whole script hands the runtime code the model never finished
 * writing. Callers must surface it, not drop it.
 */
export function extractToolEnvelopeScripts(text: string): ToolPayloadCode[] {
    const normalized = String(text || "");
    if (!normalized) return [];
    return scanReadableEnvelopes(normalized)
        .map((hit) => ({ code: hit.code as string, truncated: hit.truncated === true }));
}

/**
 * Rewrite each recoverable tool-call envelope in `text` as an ```xopat-script fenced block,
 * leaving surrounding prose intact.
 *
 * MUST run before any token-stripping pass: stripping deletes the envelope wholesale, payload
 * included, which silently drops the model's script and ends the turn with only its prose.
 * Envelopes carrying no readable `code` are left alone for the stripper to clean up.
 *
 * `truncated` is true when ANY recovered payload was cut mid-value. The fence this produces is
 * indistinguishable from one the model wrote in full, so the flag is the only thing that keeps a
 * prefix from being reported to the model as a transport fault it should re-emit verbatim.
 */
export function recoverToolEnvelopeToScriptFence(
    text: string
): { text: string; recovered: boolean; truncated: boolean } {
    const normalized = String(text || "");
    if (!normalized || !hasToolEnvelopeTokens(normalized)) {
        return { text: normalized, recovered: false, truncated: false };
    }

    const hits = scanReadableEnvelopes(normalized);
    if (!hits.length) return { text: normalized, recovered: false, truncated: false };

    // Splice back-to-front so earlier offsets stay valid.
    let output = normalized;
    for (let i = hits.length - 1; i >= 0; i--) {
        const hit = hits[i]!;
        const fence = `\n\n\`\`\`xopat-script\n${hit.code}\n\`\`\`\n`;
        output = output.slice(0, hit.start) + fence + output.slice(hit.end);
    }

    // Drop the section wrapper the call sat in. Not cosmetic: the stripping pass that runs after
    // this one deletes everything between `<|tool_calls_section_begin|>` and its `end` marker, so
    // a fence left inside the wrapper would be destroyed — the exact failure this whole function
    // exists to prevent. Any sibling envelope in the same section that had no readable payload is
    // now bare, and the stripper still cleans it up on its own.
    output = output
        .replace(/<\|tool_calls_section_(?:begin|end)\|>/gi, "")
        .replace(/<\|tool_call_begin\|>/gi, "");

    return { text: output.trim(), recovered: true, truncated: hits.some((hit) => hit.truncated === true) };
}
