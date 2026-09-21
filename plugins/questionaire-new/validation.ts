import type {
  QuestionnaireAnswers,
  QuestionnaireElement,
  QuestionnaireFileElement,
  QuestionnaireFileValue,
  QuestionnaireMatrixElement,
  QuestionnaireMeasurementElement,
  QuestionnairePage,
  QuestionnaireRatingElement,
  QuestionnaireRepeatElement,
  QuestionnaireSchema,
  QuestionnaireSelectElement,
  QuestionnaireValue,
} from "./types";
import { indexElementsByName } from "./schema";
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

/* ===========================================================================
 * Hostile-input validation of an ANSWER MAP.
 *
 * `validatePage` above answers "did the respondent fill this in correctly?".
 * The functions below answer a different question: "is this answer map, which
 * arrived from a file, an IO sink or a stale local draft, safe to apply to
 * THIS schema at all?" Every import path funnels through here.
 *
 * Policy is deliberately hybrid (see README):
 *  - fatal problems throw and apply NOTHING (wrong container type, absurd size),
 *  - per-field problems drop that one field and are reported as issues.
 * All-or-nothing would let a single stale key from a deleted question destroy a
 * whole submission; silent dropping would repeat the old schema-import bug of
 * losing data without telling anyone.
 * ========================================================================= */

export type AnswerIssue = { key: string; reason: string };
export type AnswerLimits = {
  maxFileBytes: number;
  maxAnswerBytes: number;
  allowedFileMime: string[];
};
export type AnswerCheck = { answers: QuestionnaireAnswers; issues: AnswerIssue[] };

/** An answer payload that cannot be applied at all. `userMessage` is surfaced by the IO pipeline. */
export class QuestionnaireAnswerError extends Error {
  userMessage?: string;
  constructor(message: string, userMessage?: string) {
    super(message);
    this.name = "QuestionnaireAnswerError";
    this.userMessage = userMessage;
  }
}

/** Keys that mutate a prototype when assigned — rejected by NAME, before any assignment happens. */
const POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Script-capable types are refused no matter what the deployment allow-list
 * says: a stored data URL is handed straight back to the browser (chips, future
 * previews), so an `image/svg+xml` or `text/html` payload is an XSS vector.
 */
const DENIED_FILE_MIME = new Set([
  "text/html", "application/xhtml+xml", "image/svg+xml",
  "application/javascript", "text/javascript", "application/ecmascript",
  "text/xml", "application/xml",
]);

const DATA_URL_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)((?:;[a-z0-9-]+=[^;,]*)*);base64,([A-Za-z0-9+/=\s]*)$/i;

const MAX_ANSWER_KEYS = 5000;
const MAX_JSON_DEPTH = 12;
const MAX_JSON_NODES = 20000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function ownKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((k) => Object.prototype.hasOwnProperty.call(value, k));
}

/** Decoded byte length of a base64 body, without allocating the bytes. */
function base64ByteLength(body: string): number {
  const compact = body.replace(/\s+/g, "");
  if (!compact) return 0;
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
}

/**
 * Deep-copy an arbitrary JSON-ish value, rejecting anything that is not plain
 * data. Used for the free-form answer shapes (ROI regions carry a serialized
 * fabric object). Bounded in depth and node count so a hostile payload cannot
 * stall the tab.
 */
function sanitizeJson(value: unknown, depth: number, budget: { nodes: number }): { ok: true; value: any } | { ok: false; reason: string } {
  if (depth > MAX_JSON_DEPTH) return { ok: false, reason: "too deeply nested" };
  if (--budget.nodes < 0) return { ok: false, reason: "too many values" };
  if (value === null) return { ok: true, value: null };
  const type = typeof value;
  if (type === "string" || type === "boolean") return { ok: true, value };
  if (type === "number") {
    return Number.isFinite(value as number) ? { ok: true, value } : { ok: false, reason: "not a finite number" };
  }
  if (Array.isArray(value)) {
    const out: any[] = [];
    for (const entry of value) {
      const item = sanitizeJson(entry, depth + 1, budget);
      if (!item.ok) return item;
      out.push(item.value);
    }
    return { ok: true, value: out };
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of ownKeys(value)) {
      if (POLLUTION_KEYS.has(key)) return { ok: false, reason: `unsafe key "${key}"` };
      const item = sanitizeJson(value[key], depth + 1, budget);
      if (!item.ok) return item;
      out[key] = item.value;
    }
    return { ok: true, value: out };
  }
  return { ok: false, reason: `unsupported value type ${type}` };
}

function checkFileValue(entry: unknown, limits: AnswerLimits): { ok: true; value: QuestionnaireFileValue } | { ok: false; reason: string } {
  if (!isPlainObject(entry)) return { ok: false, reason: "file entry is not an object" };
  const name = entry.name;
  if (typeof name !== "string" || !name) return { ok: false, reason: "file entry has no name" };
  const size = Number(entry.size);
  const type = typeof entry.type === "string" ? entry.type : "";
  const out: QuestionnaireFileValue = { name, size: Number.isFinite(size) && size >= 0 ? size : 0, type };
  if (entry.dataUrl !== undefined) {
    if (typeof entry.dataUrl !== "string") return { ok: false, reason: "dataUrl is not a string" };
    const match = DATA_URL_RE.exec(entry.dataUrl);
    if (!match) return { ok: false, reason: "dataUrl is not a base64 data URL" };
    const mime = match[1]!.toLowerCase();
    if (DENIED_FILE_MIME.has(mime)) return { ok: false, reason: `file type ${mime} is not allowed` };
    if (limits.allowedFileMime.length && !limits.allowedFileMime.includes(mime)) {
      return { ok: false, reason: `file type ${mime} is not allowed` };
    }
    const bytes = base64ByteLength(match[3]!);
    if (bytes > limits.maxFileBytes) return { ok: false, reason: `file exceeds ${limits.maxFileBytes} bytes` };
    out.dataUrl = entry.dataUrl;
    if (!out.size) out.size = bytes;
  }
  return { ok: true, value: out };
}

/**
 * Check one answer against the element it claims to belong to, returning a
 * sanitized copy. Rejects rather than coerces: the runtime writes well-typed
 * values, so a mistyped one means the payload does not match this form.
 */
export function validateAnswerValue(
  element: QuestionnaireElement,
  value: unknown,
  limits: AnswerLimits,
  repeatChildren?: Map<string, QuestionnaireElement>,
): { ok: true; value: QuestionnaireValue } | { ok: false; reason: string } {
  if (value === null || value === undefined) return { ok: true, value: null };

  switch (element.kind) {
    case "content":
      return { ok: false, reason: "content elements hold no answer" };

    case "text": case "textarea": case "email": case "date": case "tel": case "url":
      return typeof value === "string" ? { ok: true, value } : { ok: false, reason: "expected a string" };

    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? { ok: true, value } : { ok: false, reason: "expected a number" };

    case "rating": {
      const max = Math.max(1, Number((element as QuestionnaireRatingElement).maxRating || 5));
      if (typeof value !== "number" || !Number.isInteger(value)) return { ok: false, reason: "expected an integer rating" };
      return value >= 0 && value <= max ? { ok: true, value } : { ok: false, reason: "rating out of range" };
    }

    case "checkbox": case "toggle":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, reason: "expected a boolean" };

    case "select": case "radio": {
      if (typeof value !== "string") return { ok: false, reason: "expected a string" };
      const options = (element as QuestionnaireSelectElement).options || [];
      return options.some((o) => o.value === value)
        ? { ok: true, value } : { ok: false, reason: "value is not one of the offered options" };
    }

    case "multiselect": {
      if (!Array.isArray(value)) return { ok: false, reason: "expected an array" };
      const options = (element as QuestionnaireSelectElement).options || [];
      const out: string[] = [];
      for (const entry of value) {
        if (typeof entry !== "string") return { ok: false, reason: "expected an array of strings" };
        if (!options.some((o) => o.value === entry)) return { ok: false, reason: "value is not one of the offered options" };
        out.push(entry);
      }
      return { ok: true, value: out };
    }

    case "matrix": {
      if (!isPlainObject(value)) return { ok: false, reason: "expected an object" };
      const matrix = element as QuestionnaireMatrixElement;
      const out: Record<string, string> = {};
      for (const key of ownKeys(value)) {
        if (POLLUTION_KEYS.has(key)) return { ok: false, reason: `unsafe key "${key}"` };
        if (!matrix.rows.some((r) => r.value === key)) return { ok: false, reason: `unknown matrix row "${key}"` };
        const cell = value[key];
        if (typeof cell !== "string") return { ok: false, reason: "matrix cells must be strings" };
        if (!matrix.columns.some((c) => c.value === cell)) return { ok: false, reason: `unknown matrix column "${cell}"` };
        out[key] = cell;
      }
      return { ok: true, value: out };
    }

    case "measurement": {
      if (!isPlainObject(value)) return { ok: false, reason: "expected {value, unit}" };
      const units = (element as QuestionnaireMeasurementElement).units;
      const list = units && units.length ? units : ["mm"];
      const num = value.value;
      if (!(num === null || num === "" || (typeof num === "number" && Number.isFinite(num)))) {
        return { ok: false, reason: "measurement value is not a number" };
      }
      const unit = value.unit;
      if (typeof unit !== "string" || !list.includes(unit)) return { ok: false, reason: "unknown measurement unit" };
      return { ok: true, value: { value: num as any, unit } as unknown as QuestionnaireValue };
    }

    case "file": {
      const multiple = !!(element as QuestionnaireFileElement).multiple;
      const entries = Array.isArray(value) ? value : [value];
      const out: QuestionnaireFileValue[] = [];
      for (const entry of entries) {
        const checked = checkFileValue(entry, limits);
        if (!checked.ok) return checked;
        out.push(checked.value);
      }
      if (!multiple && out.length > 1) return { ok: false, reason: "expected a single file" };
      return { ok: true, value: (multiple ? out : out[0] ?? null) as QuestionnaireValue };
    }

    case "repeat": {
      if (!Array.isArray(value)) return { ok: false, reason: "expected an array of rows" };
      const repeat = element as QuestionnaireRepeatElement;
      const max = Number.isFinite(Number(repeat.maxItems)) ? Number(repeat.maxItems) : 10;
      if (value.length > max) return { ok: false, reason: `more than ${max} rows` };
      const children = repeatChildren
        ?? new Map((repeat.elements || []).map((child) => [child.name, child] as const));
      const rows: QuestionnaireAnswers[] = [];
      for (const row of value) {
        if (!isPlainObject(row)) return { ok: false, reason: "repeat rows must be objects" };
        const out: QuestionnaireAnswers = {};
        for (const key of ownKeys(row)) {
          if (POLLUTION_KEYS.has(key)) return { ok: false, reason: `unsafe key "${key}"` };
          const child = children.get(key);
          if (!child) return { ok: false, reason: `unknown field "${key}" in a repeat row` };
          const checked = validateAnswerValue(child, row[key], limits);
          if (!checked.ok) return { ok: false, reason: `${key}: ${checked.reason}` };
          out[key] = checked.value;
        }
        rows.push(out);
      }
      return { ok: true, value: rows };
    }

    case "roi": {
      // Free-form: the captured region embeds a serialized fabric object.
      const sane = sanitizeJson(value, 0, { nodes: MAX_JSON_NODES });
      if (!sane.ok) return sane;
      if (!isPlainObject(sane.value)) return { ok: false, reason: "expected a region object" };
      return { ok: true, value: sane.value as QuestionnaireValue };
    }

    default: {
      const sane = sanitizeJson(value, 0, { nodes: MAX_JSON_NODES });
      return sane.ok ? { ok: true, value: sane.value as QuestionnaireValue } : sane;
    }
  }
}

/**
 * Validate a whole answer map against a schema. Throws `QuestionnaireAnswerError`
 * when nothing can be applied; otherwise returns the accepted subset plus one
 * issue per dropped field so the caller can report how much was skipped.
 */
export function validateAnswers(schema: QuestionnaireSchema, raw: unknown, limits: AnswerLimits): AnswerCheck {
  if (!isPlainObject(raw)) {
    throw new QuestionnaireAnswerError("answers payload is not an object");
  }
  let serialized = "";
  try {
    serialized = JSON.stringify(raw) ?? "";
  } catch (e: any) {
    throw new QuestionnaireAnswerError(`answers payload is not serializable: ${e?.message ?? e}`);
  }
  if (serialized.length > limits.maxAnswerBytes) {
    throw new QuestionnaireAnswerError(`answers payload exceeds ${limits.maxAnswerBytes} bytes`);
  }
  const keys = ownKeys(raw);
  if (keys.length > MAX_ANSWER_KEYS) {
    throw new QuestionnaireAnswerError(`answers payload has more than ${MAX_ANSWER_KEYS} keys`);
  }

  const index = indexElementsByName(schema);
  const answers: QuestionnaireAnswers = {};
  const issues: AnswerIssue[] = [];
  for (const key of keys) {
    if (POLLUTION_KEYS.has(key)) {
      issues.push({ key, reason: "unsafe key" });
      continue;
    }
    const element = index.top.get(key);
    if (!element) {
      issues.push({ key, reason: "no such field in this questionnaire" });
      continue;
    }
    const checked = validateAnswerValue(element, raw[key], limits, index.repeatChildren.get(key));
    if (!checked.ok) {
      issues.push({ key, reason: checked.reason });
      continue;
    }
    answers[key] = checked.value;
  }
  return { answers, issues };
}
