/**
 * Turn an action's return value into something to show. Pure (unit-tested): it
 * only decides *what* — a short notification or a markdown document — and the
 * module renders it through the markdown module (sanitized) or a toast (escaped).
 *
 * Every value that came out of a script is escaped before it becomes markdown,
 * so a cell containing `[x](javascript:…)` or `<img>` reads as text.
 */

export type Presentation =
    | { kind: "none" }
    | { kind: "done" }
    | { kind: "toast"; text: string }
    | { kind: "markdown"; text: string };

export interface PresentationLabels {
    key: string;
    value: string;
    truncated: (shown: number, total: number) => string;
}

const TOAST_MAX = 120;
const MAX_ROWS = 200;
const MAX_COLUMNS = 20;
const MAX_JSON = 20_000;
const MAX_TEXT = 50_000;

type Primitive = string | number | boolean | null | undefined;

function isPrimitive(v: unknown): v is Primitive {
    return v === null || v === undefined || ["string", "number", "boolean"].includes(typeof v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
}

/** Escape text so markdown renders it literally (and inline HTML stays text). */
export function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}\[\]()<>#+\-.!|~&]/g, ch => "\\" + ch);
}

function cell(v: Primitive): string {
    if (v === null || v === undefined) return "";
    const text = typeof v === "number" && !Number.isInteger(v) ? String(Number(v.toPrecision(6))) : String(v);
    return escapeMarkdown(text.replace(/\s*\r?\n\s*/g, " "));
}

function table(header: string[], rows: Primitive[][]): string {
    const head = `| ${header.map(h => cell(h)).join(" | ")} |`;
    const sep = `| ${header.map(() => "---").join(" | ")} |`;
    const body = rows.map(r => `| ${r.map(cell).join(" | ")} |`);
    return [head, sep, ...body].join("\n");
}

function fence(text: string, lang = ""): string {
    const longest = Math.max(2, ...(text.match(/`+/g) || []).map(m => m.length));
    const ticks = "`".repeat(longest + 1);
    return `${ticks}${lang}\n${text}\n${ticks}`;
}

function truncatedNote(labels: PresentationLabels, shown: number, total: number): string {
    return total > shown ? `\n\n_${escapeMarkdown(labels.truncated(shown, total))}_` : "";
}

/**
 * Decide how to present `value`.
 * - `auto`: short single-line text/number/boolean → toast; `undefined` → "done";
 *   longer text → markdown (the script authored it); flat object → key/value table;
 *   array of flat objects → table; array of primitives → list; anything else → JSON.
 * - `toast`/`window` force the channel; `silent` shows nothing.
 */
export function presentResult(value: unknown, mode: string, labels: PresentationLabels): Presentation {
    if (mode === "silent") return { kind: "none" };

    const asMarkdown = (): Presentation => ({ kind: "markdown", text: toMarkdown(value, labels) });

    if (mode === "window") return value === undefined ? { kind: "done" } : asMarkdown();

    if (value === undefined || value === null) return { kind: "done" };

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        const text = String(value);
        if (mode === "toast" || (text.length <= TOAST_MAX && !/\r|\n/.test(text))) {
            return { kind: "toast", text: text.slice(0, mode === "toast" ? 400 : TOAST_MAX) };
        }
        return asMarkdown();
    }

    if (mode === "toast") {
        const text = safeJson(value).replace(/\s+/g, " ");
        return { kind: "toast", text: text.length > 400 ? text.slice(0, 399) + "…" : text };
    }
    return asMarkdown();
}

function safeJson(value: unknown, indent?: number): string {
    try {
        const text = JSON.stringify(value, null, indent);
        return text === undefined ? String(value) : text;
    } catch (_) {
        return String(value);
    }
}

export function toMarkdown(value: unknown, labels: PresentationLabels): string {
    // A string is the script's own document; it is rendered as markdown, sanitized
    // by the markdown module. That is the script author's (approved) choice.
    if (typeof value === "string") return value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) + "…" : value;
    if (isPrimitive(value)) return cell(value);

    if (isPlainObject(value)) {
        const entries = Object.entries(value);
        if (entries.length && entries.every(([, v]) => isPrimitive(v))) {
            const shown = entries.slice(0, MAX_ROWS);
            return table([labels.key, labels.value], shown.map(([k, v]) => [k, v as Primitive]))
                + truncatedNote(labels, shown.length, entries.length);
        }
    }

    if (Array.isArray(value) && value.length) {
        if (value.every(isPrimitive)) {
            const shown = value.slice(0, MAX_ROWS);
            return shown.map(v => `- ${cell(v as Primitive)}`).join("\n") + truncatedNote(labels, shown.length, value.length);
        }
        if (value.every(row => isPlainObject(row) && Object.values(row).every(isPrimitive))) {
            const columns: string[] = [];
            for (const row of value as Record<string, unknown>[]) {
                for (const key of Object.keys(row)) {
                    if (!columns.includes(key) && columns.length < MAX_COLUMNS) columns.push(key);
                }
            }
            const shown = (value as Record<string, unknown>[]).slice(0, MAX_ROWS);
            return table(columns, shown.map(row => columns.map(c => row[c] as Primitive)))
                + truncatedNote(labels, shown.length, value.length);
        }
    }

    let json = safeJson(value, 2);
    if (json.length > MAX_JSON) json = json.slice(0, MAX_JSON) + "\n…";
    return fence(json, "json");
}

/** HTML-escape for sinks that take HTML (Dialogs/Toast). */
export function escapeHtml(value: unknown): string {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** Compact, bounded preview of a result for run history (shown to the user and the assistant). */
export function previewResult(value: unknown, max = 2000): string {
    if (value === undefined) return "";
    const text = typeof value === "string" ? value : safeJson(value);
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
