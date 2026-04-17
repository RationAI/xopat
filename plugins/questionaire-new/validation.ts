import type { QuestionnaireAnswers, QuestionnaireElement, QuestionnaireFileElement, QuestionnairePage, QuestionnaireSchema, QuestionnaireValue } from "./types";
import { isConditionVisible } from "./utils";
export function validatePage(page: QuestionnairePage, answers: QuestionnaireAnswers, schema: QuestionnaireSchema): Record<string, string> {
  const errors: Record<string, string> = {};
  page.elements.filter((element) => element.kind !== "content").filter((element) => isConditionVisible(element.visibleWhen, (name) => answers[name])).forEach((element) => {
    const value = answerFor(element, answers);
    const message = validateElement(element, value, answers);
    if (message) errors[element.name] = message;
  });
  return errors;
}
export function validateElement(element: QuestionnaireElement, value: QuestionnaireValue, answers: QuestionnaireAnswers): string | undefined {
  const isRequired = !!element.required || isConditionVisible(element.requiredWhen, (name) => answers[name]);
  const empty = value == null || value === "" || value === false || (Array.isArray(value) && value.length === 0);
  if (isRequired && empty) return element.validation?.message || "This field is required.";
  if (empty) return undefined;
  const textValue = Array.isArray(value) ? value.join(",") : String(value);
  if (element.kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(textValue)) return element.validation?.message || "Please enter a valid email.";
  if (element.kind === "url") { try { new URL(textValue); } catch { return element.validation?.message || "Please enter a valid URL."; } }
  if (element.kind === "tel" && !/^[0-9+\-().\s]{5,}$/.test(textValue)) return element.validation?.message || "Please enter a valid phone number.";
  const v = element.validation;
  if (v?.minLength != null && textValue.length < v.minLength) return v.message || `Minimum length is ${v.minLength}.`;
  if (v?.maxLength != null && textValue.length > v.maxLength) return v.message || `Maximum length is ${v.maxLength}.`;
  if (v?.pattern) { try { const re = new RegExp(v.pattern); if (!re.test(textValue)) return v.message || "This field does not match the required pattern."; } catch { return "Validation pattern is invalid."; } }
  if (element.kind === "number" || element.kind === "rating") { const n = Number(value); if (Number.isNaN(n)) return "Please enter a valid number."; if (v?.min != null && n < v.min) return v.message || `Minimum value is ${v.min}.`; if (v?.max != null && n > v.max) return v.message || `Maximum value is ${v.max}.`; }
  if (element.kind === "file") { const fileElement = element as QuestionnaireFileElement; if (!fileElement.multiple && Array.isArray(value) && value.length > 1) return "Only one file is allowed."; }
  return undefined;
}
export function answerFor(element: QuestionnaireElement, answers: QuestionnaireAnswers): QuestionnaireValue { const explicit = answers[element.name]; return explicit !== undefined ? explicit : element.defaultValue; }
