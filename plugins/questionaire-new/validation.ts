import type {
  QuestionnaireAnswers,
  QuestionnaireElement,
  QuestionnaireMatrixElement,
  QuestionnairePage,
  QuestionnaireRepeatElement,
  QuestionnaireValue,
} from "./types";
import { answerFor, conditionMatches } from "./utils";

function isEmpty(value: QuestionnaireValue): boolean {
  return value == null || value === "" || value === false || (Array.isArray(value) && value.length === 0);
}

export function validatePage(page: QuestionnairePage, answers: QuestionnaireAnswers): Record<string, string> {
  const errors: Record<string, string> = {};
  page.elements.filter((e) => conditionMatches(e.visibleWhen, answers)).forEach((element) => {
    validateElement(element, answers, errors);
  });
  return errors;
}

export function validateElement(
  element: QuestionnaireElement,
  answers: QuestionnaireAnswers,
  errors: Record<string, string>,
  parentKey = "",
): void {
  const key = parentKey ? `${parentKey}.${element.name}` : element.name;
  const validation = element.validation || {};
  const value = answerFor(element, answers);

  if (element.kind === "content") return;

  const required = !!validation.required || (!!validation.requiredWhen && conditionMatches(validation.requiredWhen, answers));

  if (element.kind === "measurement") {
    // Answer shape is { value, unit }; validate the numeric value.
    const num = value && typeof value === "object" && !Array.isArray(value)
      ? (value as { value?: QuestionnaireValue }).value
      : value;
    if (required && (num == null || num === "")) {
      errors[key] = validation.message || "This field is required.";
    } else if (num != null && num !== "") {
      const n = Number(num);
      if (validation.min != null && n < validation.min) errors[key] = validation.message || `Minimum value is ${validation.min}.`;
      else if (validation.max != null && n > validation.max) errors[key] = validation.message || `Maximum value is ${validation.max}.`;
    }
    return;
  }
  if (required && isEmpty(value)) {
    errors[key] = validation.message || "This field is required.";
    return;
  }
  if (isEmpty(value)) return;

  if (typeof value === "string") {
    if (validation.minLength != null && value.length < validation.minLength) {
      errors[key] = validation.message || `Minimum length is ${validation.minLength}.`;
      return;
    }
    if (validation.maxLength != null && value.length > validation.maxLength) {
      errors[key] = validation.message || `Maximum length is ${validation.maxLength}.`;
      return;
    }
    if (validation.pattern) {
      try {
        const re = new RegExp(validation.pattern);
        if (!re.test(value)) {
          errors[key] = validation.message || "Value format is invalid.";
          return;
        }
      } catch {}
    }
  }

  if (typeof value === "number") {
    if (validation.min != null && value < validation.min) {
      errors[key] = validation.message || `Minimum value is ${validation.min}.`;
      return;
    }
    if (validation.max != null && value > validation.max) {
      errors[key] = validation.message || `Maximum value is ${validation.max}.`;
      return;
    }
  }

  if (element.kind === "email" && typeof value === "string") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors[key] = validation.message || "Please enter a valid email.";
      return;
    }
  }

  if (element.kind === "url" && typeof value === "string") {
    try {
      new URL(value);
    } catch {
      errors[key] = validation.message || "Please enter a valid URL.";
      return;
    }
  }

  if (element.kind === "repeat") {
    const repeatElement = element as QuestionnaireRepeatElement;
    const rows = Array.isArray(value) ? value : [];
    if (repeatElement.minItems != null && rows.length < repeatElement.minItems) {
      errors[key] = validation.message || `At least ${repeatElement.minItems} items are required.`;
      return;
    }
    if (repeatElement.maxItems != null && rows.length > repeatElement.maxItems) {
      errors[key] = validation.message || `At most ${repeatElement.maxItems} items are allowed.`;
      return;
    }
    rows.forEach((row, rowIndex) => {
      if (!row || typeof row !== "object") return;
      repeatElement.elements.forEach((child) => {
        validateElement(child, row as QuestionnaireAnswers, errors, `${key}[${rowIndex}]`);
      });
    });
    return;
  }

  if (element.kind === "matrix") {
    const matrix = element as QuestionnaireMatrixElement;
    const record = (value && typeof value === "object" ? value : {}) as Record<string, string>;
    if (required) {
      const missing = matrix.rows.some((row) => !record[row.value]);
      if (missing) {
        errors[key] = validation.message || "Please complete all matrix rows.";
      }
    }
  }
}
