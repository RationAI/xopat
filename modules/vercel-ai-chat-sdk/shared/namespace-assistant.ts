/**
 * Generic consumption of the assistant hints a scripting namespace declares about itself
 * (core `ScriptApiMetadata.assistant`, carried by the manifest as `ns.assistant`).
 *
 * This module holds NO per-namespace knowledge. Intent routing, the full-vs-compact
 * prompt tier, framing and workflow guidance, and usage examples all come from the
 * namespace definitions; adding a namespace never requires editing the chat module.
 */

type ManifestNamespace = AllowedScriptApiManifest["namespaces"][number];

/**
 * Namespaces documented in full in the system prompt by default: those declaring
 * `promptTier: "full"`. Deployments can override the set (`fullPromptNamespaces`).
 *
 * A namespace demoted to compact only saves tokens while it stays untouched — sticky
 * expansion re-adds it after first use — so "full" suits small, constantly used surfaces
 * (`application`, `viewer`), while large rarely used ones (`visualization`, ~19 KB) stay
 * compact with their workflow guidance travelling with the rendering position.
 */
export function defaultFullNamespaces(allowedScriptApi: AllowedScriptApiManifest | undefined): Set<string> {
    return new Set((allowedScriptApi?.namespaces || [])
        .filter((ns) => ns.assistant?.promptTier === 'full')
        .map((ns) => ns.namespace));
}

/**
 * Bounds on namespace-authored assistant text. It is client-sent, like the descriptions
 * and declarations already rendered, but it lands in the system prompt verbatim, so an
 * oversize field is dropped whole — a guidance block cut mid-sentence misleads more than
 * a missing one.
 */
export const ASSISTANT_TEXT_MAX = 32 * 1024;
export const ASSISTANT_EXAMPLES_MAX = 8;
export const ASSISTANT_EXAMPLE_MAX = 400;
const INTENT_PATTERNS_MAX = 8;
const INTENT_PATTERN_SOURCE_MAX = 2048;

function assistantText(value: unknown): string {
    return typeof value === 'string' && value.trim() && value.length <= ASSISTANT_TEXT_MAX ? value : '';
}

/**
 * The `framing` (always-on) or `guidance` (full-rendering only) blocks of the given
 * namespaces, in manifest order. Each block renders as `\n<text>\n`, the shape the
 * prompt sections around it expect.
 */
export function namespaceAssistantBlocks(namespaces: ManifestNamespace[], field: 'framing' | 'guidance'): string {
    return namespaces
        .map((ns) => assistantText(ns.assistant?.[field]))
        .filter(Boolean)
        .map((text) => `\n${text}\n`)
        .join('');
}

/** The "Recommended patterns" section built from every namespace's examples, or ''. */
export function recommendedPatternsBlock(allowedScriptApi: AllowedScriptApiManifest): string {
    const examples: string[] = [];
    for (const ns of allowedScriptApi.namespaces) {
        const declared = Array.isArray(ns.assistant?.examples) ? ns.assistant!.examples! : [];
        for (const example of declared.slice(0, ASSISTANT_EXAMPLES_MAX)) {
            if (typeof example === 'string' && example.trim() && example.length <= ASSISTANT_EXAMPLE_MAX) {
                examples.push(example.replace(/\s+/g, ' ').trim());
            }
        }
    }
    return examples.length
        ? `\nRecommended patterns:\n${examples.map((example) => `- ${example}`).join('\n')}\n`
        : '';
}

/**
 * Compile the intent patterns of the manifest's non-sensitive namespaces. Malformed or
 * oversize patterns are skipped; `g`/`y` flags are dropped (a stateful regex would carry
 * `lastIndex` between turns and match every other call).
 */
export function compileIntentPatterns(allowedScriptApi: AllowedScriptApiManifest | undefined): Array<[string, RegExp[]]> {
    const compiled: Array<[string, RegExp[]]> = [];
    for (const ns of allowedScriptApi?.namespaces || []) {
        if (ns.sensitive) continue;
        const patterns: RegExp[] = [];
        for (const p of (ns.assistant?.intentPatterns || []).slice(0, INTENT_PATTERNS_MAX)) {
            if (typeof p?.source !== 'string' || !p.source || p.source.length > INTENT_PATTERN_SOURCE_MAX) continue;
            const flags = [...new Set(String(p.flags || '').replace(/[^imsu]/g, '') + 'i')].join('');
            try { patterns.push(new RegExp(p.source, flags)); } catch (_) { /* malformed: skip */ }
        }
        if (patterns.length) compiled.push([ns.namespace, patterns]);
    }
    return compiled;
}

/** Namespaces whose intent patterns match `text`, in manifest order. */
export function matchIntentNamespaces(compiled: Array<[string, RegExp[]]>, text: string): string[] {
    if (!text) return [];
    return compiled.filter(([, patterns]) => patterns.some((re) => re.test(text))).map(([ns]) => ns);
}
