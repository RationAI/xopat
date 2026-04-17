import type { QuestionnaireCondition, QuestionnaireElement, QuestionnaireValue } from "./types";
export const ALLOWED_KINDS: QuestionnaireElement["kind"][] = ["text","textarea","number","email","date","tel","url","select","multiselect","checkbox","radio","toggle","content","rating","file"];
export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
export function sanitizeName(value: string): string { return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "field"; }
export function titleCase(value: string): string { return value ? value.charAt(0).toUpperCase() + value.slice(1) : ""; }
export function toBgLabel(value: number | undefined): string { return Number.isFinite(Number(value)) ? String(value) : "default"; }
export function isConditionVisible(condition: QuestionnaireCondition | undefined, getFieldValue: (name: string) => QuestionnaireValue): boolean {
  if (!condition) return true;
  switch (condition.op) {
    case "and": return condition.args.every((arg) => isConditionVisible(arg, getFieldValue));
    case "or": return condition.args.some((arg) => isConditionVisible(arg, getFieldValue));
    case "eq": return getFieldValue(condition.field) === condition.value;
    case "ne": return getFieldValue(condition.field) !== condition.value;
    case "gt": return Number(getFieldValue(condition.field)) > Number(condition.value);
    case "gte": return Number(getFieldValue(condition.field)) >= Number(condition.value);
    case "lt": return Number(getFieldValue(condition.field)) < Number(condition.value);
    case "lte": return Number(getFieldValue(condition.field)) <= Number(condition.value);
    case "empty": { const value = getFieldValue(condition.field); return value == null || value === "" || (Array.isArray(value) && value.length === 0); }
    case "notEmpty": { const value = getFieldValue(condition.field); return !(value == null || value === "" || (Array.isArray(value) && value.length === 0)); }
    case "in": { const current = getFieldValue(condition.field); const allowed = Array.isArray(condition.value) ? condition.value : [condition.value]; return Array.isArray(current) ? current.some((item) => allowed.includes(item)) : allowed.includes(current as any); }
    case "notIn": { const current = getFieldValue(condition.field); const blocked = Array.isArray(condition.value) ? condition.value : [condition.value]; return Array.isArray(current) ? !current.some((item) => blocked.includes(item)) : !blocked.includes(current as any); }
    default: return true;
  }
}
export function conditionToText(condition?: QuestionnaireCondition): string { return condition ? JSON.stringify(condition, null, 2) : ""; }
export function parseCondition(text: string): QuestionnaireCondition | undefined { const trimmed = String(text || "").trim(); if (!trimmed) return undefined; try { return JSON.parse(trimmed) as QuestionnaireCondition; } catch { return undefined; } }
