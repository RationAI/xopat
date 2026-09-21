/**
 * Trimming the scripting-API type blob before it reaches the model.
 *
 * A namespace's `tsDeclaration` (built by `collectRelevantDeclarations` in
 * `src/classes/scripting-manager.ts`) contains BOTH the supporting type declarations and the
 * scripting API interface itself. The prompt renders every method separately as
 * `signature — <description>`, and that description is the method's whole JSDoc flattened
 * (`extractDocSummary` joins all doc lines), so shipping the interface as well restates every
 * method and every doc comment a second time.
 *
 * Measured on the namespaces that ship on every step, `application` + `viewer`: ~8.4 KB of
 * interface against ~5.0 KB of supporting types — i.e. the redundant half was the larger one.
 * The types are what nothing else carries, so they stay.
 */

/**
 * Remove `export interface X extends ScriptApiObject { … }` blocks, keep everything else.
 *
 * Brace-matched rather than regexed: these bodies nest object literals, inline callbacks and
 * generics, none of which a non-recursive pattern can bound correctly. On anything unbalanced
 * the input is returned untouched — a larger prompt is a far better failure mode than a type
 * contract truncated mid-declaration, which the model would read as fact.
 */
export function stripApiInterfaceDeclaration(declaration: string | undefined | null): string {
    const text = String(declaration || "");
    if (!text) return "";

    const marker = /export\s+interface\s+[A-Za-z_]\w*[^{]*\bextends\s+ScriptApiObject\b[^{]*\{/g;
    let out = "";
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = marker.exec(text))) {
        const bodyStart = match.index + match[0].length - 1; // position of the opening '{'
        let depth = 0;
        let end = -1;
        for (let i = bodyStart; i < text.length; i++) {
            const ch = text[i];
            if (ch === "{") depth++;
            else if (ch === "}") {
                depth--;
                if (depth === 0) { end = i + 1; break; }
            }
        }
        if (end === -1) return text; // unbalanced — keep everything rather than truncate
        out += text.slice(cursor, match.index);
        cursor = end;
        marker.lastIndex = end;
    }

    if (!cursor) return text; // nothing matched; the blob is all supporting types
    out += text.slice(cursor);
    // Collapse the blank runs the removal leaves behind.
    return out.replace(/\n{3,}/g, "\n\n").trim();
}
