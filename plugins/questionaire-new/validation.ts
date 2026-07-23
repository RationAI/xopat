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

/**
 * Constraint violation text. A schema's custom `validation.message` states the
 * intent ("Provide a short justification.") but not the rule that fired — used
 * alone it makes a min-length/pattern rejection unexplainable, the field looks
 * answered yet the page will not advance. Keep the authored message as the lead
 * and always append the concrete constraint. `required` keeps using the bare
 * custom message (there the intent IS the reason).
 */
function constraintMessage(custom: string | undefined, key: string, args?: Record<string, unknown>): string {
  const detail = $.t(key, args as any);
  return custom ? `${custom} ${detail}` : detail;
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
      errors[key] = validation.message || $.t("questionaire:validation.required");
    } else if (num != null && num !== "") {
      const n = Number(num);
      if (validation.min != null && n < validation.min) errors[key] = constraintMessage(validation.message, "questionaire:validation.min", { min: validation.min });
      else if (validation.max != null && n > validation.max) errors[key] = constraintMessage(validation.message, "questionaire:validation.max", { max: validation.max });
    }
    return;
  }
  if (required && isEmpty(value)) {
    errors[key] = validation.message || $.t("questionaire:validation.required");
    return;
  }
  if (isEmpty(value)) return;

  if (typeof value === "string") {
    if (validation.minLength != null && value.length < validation.minLength) {
      errors[key] = constraintMessage(validation.message, "questionaire:validation.minLength", { min: validation.minLength });
      return;
    }
    if (validation.maxLength != null && value.length > validation.maxLength) {
      errors[key] = constraintMessage(validation.message, "questionaire:validation.maxLength", { max: validation.maxLength });
      return;
    }
    if (validation.pattern) {
      try {
        const re = new RegExp(validation.pattern);
        if (!re.test(value)) {
          errors[key] = constraintMessage(validation.message, "questionaire:validation.pattern");
          return;
        }
      } catch {}
    }
  }

  if (typeof value === "number") {
    if (validation.min != null && value < validation.min) {
      errors[key] = constraintMessage(validation.message, "questionaire:validation.min", { min: validation.min });
      return;
    }
    if (validation.max != null && value > validation.max) {
      errors[key] = constraintMessage(validation.message, "questionaire:validation.max", { max: validation.max });
      return;
    }
  }

  if (element.kind === "email" && typeof value === "string") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors[key] = constraintMessage(validation.message, "questionaire:validation.email");
      return;
    }
  }

  if (element.kind === "url" && typeof value === "string") {
    try {
      new URL(value);
    } catch {
      errors[key] = constraintMessage(validation.message, "questionaire:validation.url");
      return;
    }
  }

  if (element.kind === "repeat") {
    const repeatElement = element as QuestionnaireRepeatElement;
    const rows = Array.isArray(value) ? value : [];
    if (repeatElement.minItems != null && rows.length < repeatElement.minItems) {
      errors[key] = constraintMessage(validation.message, "questionaire:validation.minItems", { min: repeatElement.minItems });
      return;
    }
    if (repeatElement.maxItems != null && rows.length > repeatElement.maxItems) {
      errors[key] = constraintMessage(validation.message, "questionaire:validation.maxItems", { max: repeatElement.maxItems });
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
        errors[key] = validation.message || $.t("questionaire:validation.matrix");
      }
    }
  }
}
