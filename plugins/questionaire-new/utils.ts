import type { QuestionnaireAnswers, QuestionnaireCondition, QuestionnaireElement, QuestionnaireSelection, QuestionnaireValue } from "./types";

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
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

export function toBgLabel(value: number | undefined): string {
  return Number.isFinite(Number(value)) ? String(value) : "default";
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
      const haystack = Array.isArray(condition.value) ? condition.value : [condition.value];
      return haystack.includes(getFieldValue(answers, condition.field));
    }
    case "notIn": {
      const haystack = Array.isArray(condition.value) ? condition.value : [condition.value];
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
