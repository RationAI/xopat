/**
 * Native tool-call envelopes leaking into assistant text, and how to get the script back.
 *
 * This runtime passes no `tools` to the model — the only tool-call surface is the
 * ```xopat-script fenced block described in the system prompt. Models trained on a native
 * tool-call syntax (gpt-oss/Harmony, Kimi/K2, ...) frequently reach for it anyway, encoding
 * the call as special tokens:
 *
 *     <|tool_calls_section_begin|><|tool_call_begin|>functions.xopat-script:0
 *     <|tool_call_argument_begin|>{"code": "..."}<|tool_call_end|><|tool_calls_section_end|>
 *
 * An inference backend running a matching tool-call parser lifts those into the OpenAI
 * `tool_calls` field and leaves `content` clean. Without one they are decoded straight into
 * the text. The call is well-formed — only its surface is wrong — so recover the payload into
 * the fence contract instead of discarding a turn's real work.
 *
 * Pure module: no `window`, no Node globals. Imported by both the client (`chat.ts`) and the
 * server (`server/chat.server.ts`).
 */

/** `functions.xopat-script:0<|tool_call_argument_begin|>{...}<|tool_call_end|>` */
const NAMED_ENVELOPE_RE =
    /functions\.(xopat-(?:host-)?script)\s*:\s*\d+\s*<\|tool_call_argument_begin\|>\s*({[\s\S]*?})\s*<\|tool_call_end\|>/gi;

/** Bare `<|tool_call_argument_begin|>{...}` — no function name, possibly unterminated. */
const LOOSE_ENVELOPE_RE =
    /<\|tool_call_argument_begin\|>\s*({[\s\S]*?})\s*(?:<\|tool_call_end\|>|$)/gi;

const ENVELOPE_TOKEN_RE =
    /<\|(?:tool_calls_section_(?:begin|end)|tool_call_(?:begin|end)|tool_call_argument_begin)\|>|functions\.xopat-(?:host-)?script\s*:\s*\d+/i;

/**
 * Read the script out of a tool-call argument payload — canonically `{"code": "..."}`.
 *
 * Falls back to a regex + unescape when the payload is not valid JSON: a truncated or
 * slightly malformed envelope still usually carries a usable script body.
 */
export function readCodeFromToolPayload(payloadText: string): string | undefined {
    if (!payloadText) return undefined;

    try {
        const parsed = JSON.parse(payloadText);
        if (typeof parsed?.code === "string" && parsed.code.trim()) {
            return parsed.code.trim();
        }
    } catch (_) {
        const codeMatch = payloadText.match(/"code"\s*:\s*"([\s\S]*?)"\s*(?:,|})/i);
        if (!codeMatch?.[1]) return undefined;

        try {
            return JSON.parse(`"${codeMatch[1]}"`).trim();
        } catch {
            return codeMatch[1]
                .replace(/\\"/g, '"')
                .replace(/\\n/g, "\n")
                .replace(/\\r/g, "\r")
                .replace(/\\t/g, "\t")
                .trim();
        }
    }

    return undefined;
}

/** Cheap probe: does this text contain native tool-call tokens at all? */
export function hasToolEnvelopeTokens(text: string): boolean {
    return ENVELOPE_TOKEN_RE.test(String(text || ""));
}

/** Every script body recoverable from tool-call envelopes in `text`, in order. */
export function extractToolEnvelopeScripts(text: string): string[] {
    const normalized = String(text || "");
    if (!normalized) return [];

    const scripts: string[] = [];
    // Group 1 is the function name, group 2 the JSON argument payload.
    for (const match of normalized.matchAll(NAMED_ENVELOPE_RE)) {
        const code = readCodeFromToolPayload(String(match[2] || "").trim());
        if (code) scripts.push(code);
    }
    if (scripts.length) return scripts;

    for (const match of normalized.matchAll(LOOSE_ENVELOPE_RE)) {
        const code = readCodeFromToolPayload(String(match[1] || "").trim());
        if (code) scripts.push(code);
    }
    return scripts;
}

/**
 * Rewrite each recoverable tool-call envelope in `text` as an ```xopat-script fenced block,
 * leaving surrounding prose intact.
 *
 * MUST run before any token-stripping pass: stripping deletes the envelope wholesale, payload
 * included, which silently drops the model's script and ends the turn with only its prose.
 * Envelopes carrying no readable `code` are left alone for the stripper to clean up.
 */
export function recoverToolEnvelopeToScriptFence(text: string): { text: string; recovered: boolean } {
    const normalized = String(text || "");
    if (!normalized || !hasToolEnvelopeTokens(normalized)) {
        return { text: normalized, recovered: false };
    }

    let recovered = false;
    const toFence = (payloadText: string, whole: string): string => {
        const code = readCodeFromToolPayload(payloadText.trim());
        if (!code) return whole;
        recovered = true;
        return `\n\n\`\`\`xopat-script\n${code}\n\`\`\`\n`;
    };

    let output = normalized.replace(NAMED_ENVELOPE_RE, (whole, _name, payload) => toFence(String(payload || ""), whole));
    if (!recovered) {
        output = output.replace(LOOSE_ENVELOPE_RE, (whole, payload) => toFence(String(payload || ""), whole));
    }

    if (recovered) {
        // Drop the section wrapper the call sat in. Not cosmetic: the stripping pass that runs
        // after this one deletes everything between `<|tool_calls_section_begin|>` and its `end`
        // marker, so a fence left inside the wrapper would be destroyed — the exact failure this
        // whole function exists to prevent. Any sibling envelope in the same section that had no
        // readable payload is now bare, and the stripper still cleans it up on its own.
        output = output
            .replace(/<\|tool_calls_section_(?:begin|end)\|>/gi, '')
            .replace(/<\|tool_call_begin\|>/gi, '');
    }

    return { text: output.trim(), recovered };
}
