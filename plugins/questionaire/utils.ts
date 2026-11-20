import type { QuestionnaireAnswers, QuestionnaireCondition, QuestionnaireElement, QuestionnaireSelection, QuestionnaireValue } from "./types";

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * `$.t` with i18next's HTML value-escaping disabled. All questionnaire output
 * is rendered via `textContent`/DOM text nodes (never `innerHTML`), so the
 * default `escapeValue: true` double-encodes interpolated user text — slide
 * titles like "H&E" show up as "H&amp;E" and locale dates as "7&#x2F;16".
 * Use ONLY for strings that end up in text nodes, never in HTML markup.
 */
export function tRaw(key: string, args: Record<string, unknown>): string {
  return $.t(key, { ...args, interpolation: { escapeValue: false } });
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function sanitizeName(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "field";
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Human-readable byte size (e.g. "1.5 MB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Read a picked file's content as a data URL (embedded answer payload). */
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error(`Failed to read file ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function optionLinesToList(text: string): Array<{ value: string; label: string }> {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const [valuePart, labelPart] = line.split("|");
    const value = String(valuePart || `option_${index + 1}`).trim();
    return { value, label: String(labelPart || value).trim() };
  });
}

export function optionListToLines(options?: Array<{ value: string; label: string }>): string {
  return (options || []).map((item) => `${item.value}|${item.label}`).join("\n");
}

export function getFieldValue(answers: QuestionnaireAnswers, field: string): QuestionnaireValue {
  return answers[field];
}

export function conditionMatches(condition: QuestionnaireCondition | undefined, answers: QuestionnaireAnswers): boolean {
  if (!condition) return true;
  switch (condition.op) {
    case "and": return condition.args.every((arg) => conditionMatches(arg, answers));
    case "or": return condition.args.some((arg) => conditionMatches(arg, answers));
    case "eq": return getFieldValue(answers, condition.field) === condition.value;
    case "ne": return getFieldValue(answers, condition.field) !== condition.value;
    case "gt": return Number(getFieldValue(answers, condition.field)) > Number(condition.value);
    case "gte": return Number(getFieldValue(answers, condition.field)) >= Number(condition.value);
    case "lt": return Number(getFieldValue(answers, condition.field)) < Number(condition.value);
    case "lte": return Number(getFieldValue(answers, condition.field)) <= Number(condition.value);
    case "empty": {
      const value = getFieldValue(answers, condition.field);
      return value == null || value === "" || (Array.isArray(value) && value.length === 0);
    }
    case "notEmpty": {
      const value = getFieldValue(answers, condition.field);
      return !(value == null || value === "" || (Array.isArray(value) && value.length === 0));
    }
    case "in": {
      const haystack: unknown[] = Array.isArray(condition.value) ? condition.value : [condition.value];
      return haystack.includes(getFieldValue(answers, condition.field));
    }
    case "notIn": {
      const haystack: unknown[] = Array.isArray(condition.value) ? condition.value : [condition.value];
      return !haystack.includes(getFieldValue(answers, condition.field));
    }
    default: return true;
  }
}

export function answerFor(element: QuestionnaireElement, answers: QuestionnaireAnswers): QuestionnaireValue {
  const explicit = answers[element.name];
  return explicit !== undefined ? explicit : element.defaultValue;
}

export function selectionEquals(a: QuestionnaireSelection, b: QuestionnaireSelection): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
