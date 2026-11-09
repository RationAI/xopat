/**
 * The one action schema shared by every producer — deployment ENV (trusted), the
 * user, and the assistant. A single closed validator: unknown fields are errors,
 * never silently carried, because a stored action is executable content.
 *
 * Pure: no globals at import time (unit-tested under Node).
 */

export const SURFACES = ["quick", "tools", "context-menu", "viewer-control", "shortcut"] as const;
export type Surface = typeof SURFACES[number];

export const OUTPUT_MODES = ["auto", "toast", "window", "silent"] as const;
export type OutputMode = typeof OUTPUT_MODES[number];

export const CONTEXT_MENU_WHEN = ["always", "selection"] as const;
export type ContextMenuWhen = typeof CONTEXT_MENU_WHEN[number];

export interface Placement {
    surface: Surface;
    /** quick: pin into the bar on first mount. */
    pinned?: boolean;
    /** context-menu: show always, or only when something is selected. */
    when?: ContextMenuWhen;
    /** shortcut: one key combo, shortcut-manager format (`Alt+KeyC`). */
    combo?: string;
}

export interface ActionSpec {
    id: string;
    label: string;
    description?: string;
    icon?: string;
    script: string;
    placements: Placement[];
    output: OutputMode;
    timeoutMs: number;
    enabled: boolean;
}

/** Deployment (ENV / include.json) actions: operator-trusted extras. */
export interface DeploymentAction extends ActionSpec {
    source: "deployment";
    /** Skip host consent prompts for this action's runs. */
    bypassConsent: boolean;
}

export type ActionOrigin = "user" | "assistant";

/** A user-side record as persisted. Runs only when `approvedRevision === revision`. */
export interface UserAction extends ActionSpec {
    source: "user";
    origin: ActionOrigin;
    createdAt: number;
    updatedAt: number;
    revision: number;
    approvedRevision: number | null;
}

export type AnyAction = DeploymentAction | UserAction;

export interface ActionLimits {
    maxScriptBytes: number;
    maxTimeoutMs: number;
    surfaces: Surface[];
}

export const DEFAULT_LIMITS: ActionLimits = {
    maxScriptBytes: 32 * 1024,
    maxTimeoutMs: 1_800_000,
    surfaces: [...SURFACES],
};

export const DEFAULT_TIMEOUT_MS = 600_000;
export const MAX_LABEL = 80;
export const MAX_DESCRIPTION = 400;
export const MAX_PLACEMENTS = 8;

export interface ValidationIssue {
    field: string;
    /** Stable code; the UI translates `errors.<code>`. */
    code: string;
    /** English developer text (logs, assistant feedback). */
    message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: ValidationIssue[] };

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ICON_RE = /^ph-[a-z0-9-]{1,60}$/;
/** Shortcut-manager combo grammar: `[Primary+][Ctrl+][Alt+][Shift+][Meta+]<e.code>`. */
const COMBO_RE = /^(Primary\+)?(Ctrl\+)?(Alt\+)?(Shift\+)?(Meta\+)?[A-Z][A-Za-z0-9]{0,23}$/;

const SPEC_KEYS = ["id", "label", "description", "icon", "script", "placements", "output", "timeoutMs", "enabled"];
const DEPLOYMENT_KEYS = [...SPEC_KEYS, "bypassConsent"];
const USER_KEYS = [...SPEC_KEYS, "origin", "createdAt", "updatedAt", "revision", "approvedRevision"];
const PLACEMENT_KEYS = ["surface", "pinned", "when", "combo"];

export function isPlainObject(v: unknown): v is Record<string, unknown> {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
}

function byteLength(text: string): number {
    return new TextEncoder().encode(text).length;
}

/** `label` in ENV may be a language map; pick the active language, then `en`, then the first. */
export function resolveLocalizedText(value: unknown, language?: string): string | undefined {
    if (typeof value === "string") return value;
    if (!isPlainObject(value)) return undefined;
    const lang = typeof language === "string" ? language : "";
    const candidates = [lang, lang.split("-")[0], "en"];
    for (const key of candidates) {
        if (key && typeof value[key] === "string") return value[key] as string;
    }
    const first = Object.values(value).find(v => typeof v === "string");
    return first as string | undefined;
}

/** `script` in ENV may be an array of lines for readability. */
export function normalizeScript(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && value.every(v => typeof v === "string")) return value.join("\n");
    return undefined;
}

export function isValidCombo(combo: unknown): combo is string {
    return typeof combo === "string" && COMBO_RE.test(combo);
}

interface ValidateOptions {
    trust: "deployment" | "user";
    limits?: ActionLimits;
    /** Active UI language, for ENV label maps. */
    language?: string;
}

/**
 * Validate and normalize one action. Deployment input may use the label-map and
 * script-lines conveniences; user input must already be canonical (strings).
 */
export function validateAction(raw: unknown, options: ValidateOptions): ValidationResult<AnyAction> {
    const limits = options.limits || DEFAULT_LIMITS;
    const errors: ValidationIssue[] = [];
    const fail = (field: string, code: string, message: string) => { errors.push({ field, code, message }); };

    if (!isPlainObject(raw)) {
        return { ok: false, errors: [{ field: "", code: "notObject", message: "An action must be a JSON object." }] };
    }

    const allowed = options.trust === "deployment" ? DEPLOYMENT_KEYS : USER_KEYS;
    for (const key of Object.keys(raw)) {
        if (!allowed.includes(key)) fail(key, "unknownField", `Unknown field '${key}'.`);
    }

    const id = raw.id;
    if (typeof id !== "string" || !ID_RE.test(id)) {
        fail("id", "badId", "id must match [a-z0-9][a-z0-9-]{0,47}.");
    }

    const label = options.trust === "deployment"
        ? resolveLocalizedText(raw.label, options.language)
        : (typeof raw.label === "string" ? raw.label : undefined);
    const trimmedLabel = label?.trim();
    if (!trimmedLabel) fail("label", "badLabel", "label must be a non-empty string.");
    else if (trimmedLabel.length > MAX_LABEL) fail("label", "labelTooLong", `label must be at most ${MAX_LABEL} characters.`);

    let description: string | undefined;
    if (raw.description !== undefined) {
        description = options.trust === "deployment"
            ? resolveLocalizedText(raw.description, options.language)
            : (typeof raw.description === "string" ? raw.description : undefined);
        if (description === undefined) fail("description", "badDescription", "description must be a string.");
        else if (description.length > MAX_DESCRIPTION) {
            fail("description", "descriptionTooLong", `description must be at most ${MAX_DESCRIPTION} characters.`);
        }
    }

    let icon: string | undefined;
    if (raw.icon !== undefined) {
        if (typeof raw.icon !== "string" || !ICON_RE.test(raw.icon)) {
            fail("icon", "badIcon", "icon must be a Phosphor class like 'ph-chart-bar'.");
        } else icon = raw.icon;
    }

    const script = options.trust === "deployment"
        ? normalizeScript(raw.script)
        : (typeof raw.script === "string" ? raw.script : undefined);
    if (!script || !script.trim()) fail("script", "badScript", "script must be non-empty text.");
    else if (byteLength(script) > limits.maxScriptBytes) {
        fail("script", "scriptTooLarge", `script exceeds ${limits.maxScriptBytes} bytes.`);
    }

    const placements: Placement[] = [];
    if (!Array.isArray(raw.placements)) {
        fail("placements", "badPlacements", "placements must be an array.");
    } else if (raw.placements.length > MAX_PLACEMENTS) {
        fail("placements", "tooManyPlacements", `At most ${MAX_PLACEMENTS} placements.`);
    } else {
        const seen = new Set<string>();
        raw.placements.forEach((p: unknown, i: number) => {
            const field = `placements[${i}]`;
            if (!isPlainObject(p)) return fail(field, "badPlacement", "A placement must be an object.");
            for (const key of Object.keys(p)) {
                if (!PLACEMENT_KEYS.includes(key)) fail(`${field}.${key}`, "unknownField", `Unknown field '${key}'.`);
            }
            const surface = p.surface as Surface;
            if (!SURFACES.includes(surface)) {
                return fail(`${field}.surface`, "badSurface", `surface must be one of ${SURFACES.join(", ")}.`);
            }
            if (!limits.surfaces.includes(surface)) {
                return fail(`${field}.surface`, "surfaceDisabled", `Surface '${surface}' is disabled by the deployment.`);
            }
            if (seen.has(surface)) return fail(`${field}.surface`, "duplicateSurface", `Surface '${surface}' listed twice.`);
            seen.add(surface);

            const out: Placement = { surface };
            if (p.pinned !== undefined) {
                if (surface !== "quick" || typeof p.pinned !== "boolean") {
                    fail(`${field}.pinned`, "badPinned", "pinned is a boolean of the 'quick' surface.");
                } else out.pinned = p.pinned;
            }
            if (p.when !== undefined) {
                if (surface !== "context-menu" || !CONTEXT_MENU_WHEN.includes(p.when as ContextMenuWhen)) {
                    fail(`${field}.when`, "badWhen", "when is 'always' or 'selection' of the 'context-menu' surface.");
                } else out.when = p.when as ContextMenuWhen;
            }
            if (surface === "shortcut") {
                if (!isValidCombo(p.combo)) {
                    fail(`${field}.combo`, "badCombo", "combo must look like 'Alt+KeyC' (modifiers + KeyboardEvent.code).");
                } else out.combo = p.combo;
            } else if (p.combo !== undefined) {
                fail(`${field}.combo`, "badCombo", "combo belongs to the 'shortcut' surface.");
            }
            placements.push(out);
        });
    }

    let output: OutputMode = "auto";
    if (raw.output !== undefined) {
        if (!OUTPUT_MODES.includes(raw.output as OutputMode)) {
            fail("output", "badOutput", `output must be one of ${OUTPUT_MODES.join(", ")}.`);
        } else output = raw.output as OutputMode;
    }

    let timeoutMs = Math.min(DEFAULT_TIMEOUT_MS, limits.maxTimeoutMs);
    if (raw.timeoutMs !== undefined) {
        const t = raw.timeoutMs;
        if (typeof t !== "number" || !Number.isFinite(t) || t < 1000) {
            fail("timeoutMs", "badTimeout", "timeoutMs must be a number >= 1000.");
        } else timeoutMs = Math.min(Math.round(t), limits.maxTimeoutMs);
    }

    let enabled = true;
    if (raw.enabled !== undefined) {
        if (typeof raw.enabled !== "boolean") fail("enabled", "badEnabled", "enabled must be a boolean.");
        else enabled = raw.enabled;
    }

    const base: ActionSpec = {
        id: id as string,
        label: trimmedLabel as string,
        ...(description ? { description } : {}),
        ...(icon ? { icon } : {}),
        script: script as string,
        placements,
        output,
        timeoutMs,
        enabled,
    };

    if (options.trust === "deployment") {
        if (raw.bypassConsent !== undefined && typeof raw.bypassConsent !== "boolean") {
            fail("bypassConsent", "badFlag", "bypassConsent must be a boolean.");
        }
        if (errors.length) return { ok: false, errors };
        return { ok: true, value: { ...base, source: "deployment", bypassConsent: raw.bypassConsent === true } };
    }

    const origin = raw.origin === undefined ? "user" : raw.origin;
    if (origin !== "user" && origin !== "assistant") fail("origin", "badOrigin", "origin must be 'user' or 'assistant'.");
    const num = (key: string, fallback: number) => {
        const v = raw[key];
        if (v === undefined) return fallback;
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
            fail(key, "badNumber", `${key} must be a non-negative number.`);
            return fallback;
        }
        return v;
    };
    const now = Date.now();
    const createdAt = num("createdAt", now);
    const updatedAt = num("updatedAt", createdAt);
    const revision = Math.floor(num("revision", 1)) || 1;
    let approvedRevision: number | null = null;
    if (raw.approvedRevision !== undefined && raw.approvedRevision !== null) {
        approvedRevision = Math.floor(num("approvedRevision", 0));
    }

    if (errors.length) return { ok: false, errors };
    return {
        ok: true,
        value: {
            ...base,
            source: "user",
            origin: origin as ActionOrigin,
            createdAt, updatedAt, revision, approvedRevision,
        },
    };
}

/** Strip store bookkeeping: what an action *is*, for proposals, export and diffing. */
export function toSpec(action: AnyAction): ActionSpec {
    const { id, label, description, icon, script, placements, output, timeoutMs, enabled } = action;
    return {
        id, label,
        ...(description ? { description } : {}),
        ...(icon ? { icon } : {}),
        script,
        placements: placements.map(p => ({ ...p })),
        output, timeoutMs, enabled,
    };
}

export function isApproved(action: AnyAction): boolean {
    return action.source === "deployment" || action.approvedRevision === action.revision;
}

/** True when the executable or user-visible surface of an action differs (needs re-approval). */
export function needsApproval(previous: ActionSpec | undefined, next: ActionSpec): boolean {
    if (!previous) return true;
    return previous.script !== next.script
        || JSON.stringify(previous.placements) !== JSON.stringify(next.placements)
        || previous.timeoutMs !== next.timeoutMs;
}
