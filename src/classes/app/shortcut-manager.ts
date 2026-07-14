// ShortcutManager — the single core registry + dispatcher for keyboard
// shortcuts. Core and modules/plugins register their key strokes here instead
// of attaching raw `key-down`/`key-up` handlers, which gives them:
//   - declared defaults with unique-assignment (conflict) enforcement,
//   - user remapping persisted per browser (AppCache, overrides only),
//   - a single entry in the Keymap fullscreen-menu panel (search + rebind UI).
//
// Exposed as `APPLICATION_CONTEXT.shortcuts` (constructed by the
// application-context factory alongside `auth` / `networkStatus`). Dispatch is
// wired later via `attach(VIEWER_MANAGER)` from app.ts, once the viewer
// manager exists — the document key events already funnel through
// `VIEWER_MANAGER.raiseEvent('key-down'|'key-up', e)` with `e.focusCanvas`
// stamped (see loader.ts), so the manager listens there.
//
// Contextual keys (Escape/Enter/Delete in dialogs, inputs, annotation cancel)
// are deliberately NOT part of the keymap — they depend on the context they
// are pressed in and stay as fixed widget-local handlers.
//
// See src/SHORTCUTS.md for the full guide.

/** Gating of a shortcut against the current focus state. */
export type ShortcutScope = {
    /** Fire only when `e.focusCanvas` is truthy (viewer navigation, tool modes). */
    requiresCanvasFocus?: boolean;
    /** Fire even when an INPUT/TEXTAREA/contentEditable element is focused. */
    allowInInputs?: boolean;
};

/** Context handed to shortcut callbacks. */
export type ShortcutInvocation = {
    /** The originating event; `null` on synthetic hold-release (window blur). */
    event: KeyboardEvent | null;
    /**
     * Viewer derived from `e.focusCanvas` when it is a viewer instance, else
     * the active viewer, else `null`. Multi-viewport-correct — do not fall
     * back to `window.VIEWER` in handlers unless a viewer is truly optional.
     */
    viewer: OpenSeadragon.Viewer | null;
    shortcutId: string;
};

export type ShortcutSpec = {
    /** Unique, namespaced id, e.g. `"core.viewport.zoomIn"`, `"annotations.mode.polygon"`. */
    id: string;
    /** i18n key for the display name — resolved with `$.t` at render time. */
    titleKey: string;
    /** Optional i18n key for a longer description (panel tooltip). */
    descriptionKey?: string;
    /**
     * Category tree path as i18n keys, e.g.
     * `["keymap.cat.core", "keymap.cat.navigation"]`.
     */
    categoryPath: string[];
    /** Default canonical combos (see combo format in SHORTCUTS.md); `[]` = unbound. */
    defaultCombos: string[];
    /** Owner uid (plugin/module id) enabling `unregisterAll(owner)`. */
    owner?: string;
    /**
     * `"press"` fires once per combo press; `"hold"` is press-and-hold —
     * `onPress` on key-down, `onRelease` when the main key is released
     * (modifier-insensitive), on window blur, or when the shortcut re-binds.
     */
    type: "press" | "hold";
    /**
     * Press shortcuts only: which phase invokes the handler. Default `"down"`.
     * Combos that must suppress native browser actions (e.g. Primary+S)
     * MUST use `"down"` — preventDefault on key-up is too late.
     */
    trigger?: "down" | "up";
    scope?: ShortcutScope;
    /** Call `preventDefault()` on the matched event. Default `true`. */
    preventDefault?: boolean;
    /** Press callback. */
    handler?: (ctx: ShortcutInvocation) => void;
    /** Hold callbacks. */
    onPress?: (ctx: ShortcutInvocation) => void;
    onRelease?: (ctx: ShortcutInvocation) => void;
    // All callbacks are optional: a callback-less registration is
    // "binding-only" — it participates in the registry, conflict detection,
    // persistence and the Keymap panel, but dispatch stays with the
    // registrant, which queries eventMatches()/eventMatchesToken() from its
    // own key loop (the annotations module does this for its mode predicates).
};

export interface ShortcutHandle {
    unregister(): void;
}

export type ShortcutBinding = {
    /** Effective combos (user override ?? defaults, minus suppressed). */
    combos: string[];
    /** True when no user override applies. */
    isDefault: boolean;
    /** Default combos suppressed by a conflict with an earlier registrant. */
    suppressed: string[];
};

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "OS"]);
const MODIFIER_NAMES = new Set(["Primary", "Ctrl", "Alt", "Shift", "Meta"]);

const IS_MAC = typeof navigator !== "undefined" &&
    /mac|iphone|ipad|ipod/i.test((navigator as any).userAgentData?.platform || navigator.platform || "");

type ComboParts = {
    primary: boolean;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
    /** Main token: an `e.code` value (multi-char) or a single character matched against `e.key`. */
    token: string;
};

function parseCombo(combo: string): ComboParts | null {
    if (typeof combo !== "string" || !combo) return null;
    // A trailing "+" token (zoom-in) survives splitting: "Shift++" → ["Shift", "", ""].
    const raw = combo.split("+");
    let token = raw.pop() as string;
    if (token === "" && raw[raw.length - 1] === "") {
        token = "+";
        raw.pop();
    }
    if (!token || MODIFIER_NAMES.has(token)) return null;
    const parts: ComboParts = { primary: false, ctrl: false, alt: false, shift: false, meta: false, token };
    for (const mod of raw) {
        switch (mod) {
            case "Primary": parts.primary = true; break;
            case "Ctrl": parts.ctrl = true; break;
            case "Alt": parts.alt = true; break;
            case "Shift": parts.shift = true; break;
            case "Meta": parts.meta = true; break;
            default: return null;
        }
    }
    return parts;
}

/**
 * Resolve the abstract `Primary` modifier to the platform's primary key and
 * return the concrete required modifier state.
 */
function resolveModifiers(parts: ComboParts): { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean } {
    return {
        ctrl: parts.ctrl || (parts.primary && !IS_MAC),
        alt: parts.alt,
        shift: parts.shift,
        meta: parts.meta || (parts.primary && IS_MAC),
    };
}

/** True for single-character tokens, matched against `e.key` (layout chars like "+"/"-"). */
function isCharToken(token: string): boolean {
    return token.length === 1;
}

/**
 * `e.code`, with a fallback derived from `e.key` for synthetic events
 * (`new KeyboardEvent(..., { key })` — e.g. tests/automation — leaves `code`
 * empty). Letters/digits map to their physical-key names; named keys
 * ("ArrowUp", "Delete") equal their code names already.
 */
function eventCode(e: KeyboardEvent): string {
    if (e.code) return e.code;
    const key = e.key || "";
    if (/^[a-zA-Z]$/.test(key)) return `Key${key.toUpperCase()}`;
    if (/^[0-9]$/.test(key)) return `Digit${key}`;
    return key.length > 1 ? key : "";
}

/**
 * Index key for a combo. Char tokens exclude Shift from the match (producing
 * "+" already requires Shift on some layouts) and compare case-insensitively.
 */
function comboIndexKey(parts: ComboParts): string {
    const m = resolveModifiers(parts);
    if (isCharToken(parts.token)) {
        return `${m.ctrl ? 1 : 0}${m.alt ? 1 : 0}${m.meta ? 1 : 0}:key:${parts.token.toLowerCase()}`;
    }
    return `${m.ctrl ? 1 : 0}${m.alt ? 1 : 0}${m.shift ? 1 : 0}${m.meta ? 1 : 0}:code:${parts.token}`;
}

/** Index keys a live keyboard event can match (code-token and char-token forms). */
function eventIndexKeys(e: KeyboardEvent): string[] {
    const keys: string[] = [];
    const code = eventCode(e);
    if (code && !MODIFIER_KEYS.has(e.key)) {
        keys.push(`${e.ctrlKey ? 1 : 0}${e.altKey ? 1 : 0}${e.shiftKey ? 1 : 0}${e.metaKey ? 1 : 0}:code:${code}`);
    }
    if (e.key && e.key.length === 1) {
        keys.push(`${e.ctrlKey ? 1 : 0}${e.altKey ? 1 : 0}${e.metaKey ? 1 : 0}:key:${e.key.toLowerCase()}`);
    }
    return keys;
}

/** Modifier-insensitive main-token match (hold-release semantics). */
function eventMatchesTokenOf(parts: ComboParts, e: KeyboardEvent): boolean {
    return isCharToken(parts.token)
        ? !!e.key && e.key.toLowerCase() === parts.token.toLowerCase()
        : eventCode(e) === parts.token;
}

const TOKEN_DISPLAY: Record<string, string> = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Escape: "Esc", Space: "Space", Enter: "Enter", Tab: "Tab",
    Backspace: "⌫", Delete: "Del", Minus: "-", Equal: "=",
    Comma: ",", Period: ".", Slash: "/", Backslash: "\\",
    Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backquote: "`",
    NumpadAdd: "Num +", NumpadSubtract: "Num -", NumpadMultiply: "Num *", NumpadDivide: "Num /",
};

function tokenDisplay(token: string): string {
    if (isCharToken(token)) return token.toUpperCase();
    if (TOKEN_DISPLAY[token]) return TOKEN_DISPLAY[token];
    let m = token.match(/^Key([A-Z])$/);
    if (m) return m[1];
    m = token.match(/^(?:Digit|Numpad)(\d)$/);
    if (m) return token.startsWith("Numpad") ? `Num ${m[1]}` : m[1];
    return token;
}

/**
 * True when the event target is a text-entry element — shortcuts without
 * `scope.allowInInputs` are suppressed there so typing never triggers them.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
    const el = target instanceof HTMLElement ? target : document.activeElement;
    return !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement || (el as any).isContentEditable);
}

const CACHE_KEY = "keymap.overrides";

/**
 * Central keyboard-shortcut registry and dispatcher.
 *
 * @extends OpenSeadragon.EventSource
 * @fires ShortcutManager#shortcut-registered
 * @fires ShortcutManager#shortcut-unregistered
 * @fires ShortcutManager#binding-changed
 * @fires ShortcutManager#bindings-reset
 */
export class ShortcutManager extends OpenSeadragon.EventSource {
    /** Registration order doubles as conflict priority (first registrant wins). */
    private _specs = new Map<string, ShortcutSpec>();
    /** User deviations only: combos array replaces defaults, `null` = unbound. */
    private _overrides: Record<string, string[] | null> = {};
    /** Effective binding per shortcut id (rebuilt on any registry/override change). */
    private _effective = new Map<string, { combos: string[]; parsed: ComboParts[]; suppressed: string[] }>();
    /** Combo index key → shortcut id. */
    private _index = new Map<string, string>();
    /** Active hold shortcuts: id → invocation context of the press. */
    private _activeHolds = new Map<string, ShortcutInvocation>();
    private _cache: { get(key: string, def?: any): any; set(key: string, value: any): void; delete(key: string): void };
    private _viewerManager: any = null;

    constructor(opts: { cache: any }) {
        super();
        this._cache = opts.cache;
        this._loadOverrides();
    }

    // ── Registration ────────────────────────────────────────────────────────

    /**
     * Register a shortcut. Idempotent by id — re-registering replaces the
     * previous spec (viewer reload safety) while keeping any user override.
     * @returns handle whose `unregister()` removes the shortcut again
     */
    register(spec: ShortcutSpec): ShortcutHandle {
        if (!spec || typeof spec.id !== "string" || !spec.id) {
            throw new Error("ShortcutManager.register: spec.id is required.");
        }
        const defaults = (spec.defaultCombos || []).filter(c => {
            if (ShortcutManager.isValidCombo(c)) return true;
            console.warn(`ShortcutManager: dropping invalid default combo "${c}" of "${spec.id}".`);
            return false;
        });
        this._specs.set(spec.id, { ...spec, defaultCombos: defaults });
        this._rebuild();
        this.raiseEvent("shortcut-registered", { id: spec.id });
        return { unregister: () => this.unregister(spec.id) };
    }

    /** Remove a shortcut from the registry (its persisted override is kept). */
    unregister(id: string): void {
        if (!this._specs.delete(id)) return;
        this._releaseHold(id, null);
        this._rebuild();
        this.raiseEvent("shortcut-unregistered", { id });
    }

    /** Remove every shortcut registered with the given `owner`. */
    unregisterAll(owner: string): void {
        for (const [id, spec] of [...this._specs]) {
            if (spec.owner === owner) this.unregister(id);
        }
    }

    // ── Introspection (Keymap panel + docs) ─────────────────────────────────

    /** Effective binding of a shortcut (user override ?? defaults, minus suppressed). */
    getBinding(id: string): ShortcutBinding | null {
        const eff = this._effective.get(id);
        if (!eff) return null;
        return {
            combos: [...eff.combos],
            isDefault: this._overrides[id] === undefined,
            suppressed: [...eff.suppressed],
        };
    }

    /** All registered shortcuts with their effective bindings, in registration order. */
    list(): Array<ShortcutSpec & ShortcutBinding> {
        return [...this._specs.values()].map(spec => ({
            ...spec,
            ...(this.getBinding(spec.id) as ShortcutBinding),
        }));
    }

    /** Ids of shortcuts whose effective binding contains `combo` (excluding `excludeId`). */
    findConflicts(combo: string, excludeId?: string): string[] {
        const parts = parseCombo(combo);
        if (!parts) return [];
        const key = comboIndexKey(parts);
        const out: string[] = [];
        for (const [id, eff] of this._effective) {
            if (id === excludeId) continue;
            if (eff.parsed.some(p => comboIndexKey(p) === key)) out.push(id);
        }
        return out;
    }

    // ── User remapping ──────────────────────────────────────────────────────

    /**
     * Set the user binding for a shortcut. `null` (or `[]`) unbinds it
     * explicitly; a combos array replaces the defaults. Persisted immediately.
     * Conflict resolution is the caller's job (query {@link findConflicts}
     * first and steal/cancel per user choice) — this method just applies.
     */
    setUserBinding(id: string, combos: string[] | null): void {
        const valid = combos ? combos.filter(c => ShortcutManager.isValidCombo(c)) : null;
        this._overrides[id] = valid && valid.length ? valid : null;
        this._releaseHold(id, null);
        this._saveOverrides();
        this._rebuild();
        this.raiseEvent("binding-changed", { id, combos: this.getBinding(id)?.combos ?? [] });
    }

    /** Drop the user override of a shortcut, restoring its declared defaults. */
    resetToDefault(id: string): void {
        if (this._overrides[id] === undefined) return;
        delete this._overrides[id];
        this._saveOverrides();
        this._rebuild();
        this.raiseEvent("binding-changed", { id, combos: this.getBinding(id)?.combos ?? [] });
    }

    /** Drop all user overrides (also those of currently unloaded owners). */
    resetAllToDefaults(): void {
        this._overrides = {};
        this._cache.delete(CACHE_KEY);
        this._rebuild();
        this.raiseEvent("bindings-reset", {});
    }

    // ── Delegated dispatch queries ──────────────────────────────────────────
    // For registrants that keep their own key loop (annotations mode
    // predicates): binding-aware event matching without manager dispatch.

    /** Full effective-combo match (modifiers + main token) of an event. */
    eventMatches(id: string, e: KeyboardEvent): boolean {
        const eff = this._effective.get(id);
        if (!eff || !eff.parsed.length) return false;
        const eventKeys = eventIndexKeys(e);
        return eff.parsed.some(p => eventKeys.includes(comboIndexKey(p)));
    }

    /** Main-token-only, modifier-insensitive match (hold-release semantics). */
    eventMatchesToken(id: string, e: KeyboardEvent): boolean {
        const eff = this._effective.get(id);
        if (!eff) return false;
        return eff.parsed.some(p => eventMatchesTokenOf(p, e));
    }

    // ── Dispatch ────────────────────────────────────────────────────────────

    /**
     * Wire dispatch to the viewer manager's re-raised document key events.
     * Called exactly once from app.ts after the viewer manager exists.
     */
    attach(viewerManager: any): void {
        if (this._viewerManager) {
            console.warn("ShortcutManager.attach: already attached.");
            return;
        }
        this._viewerManager = viewerManager;
        // High priority: the manager always runs before legacy raw handlers.
        viewerManager.addHandler("key-down", (e: any) => this._onKeyDown(e), undefined, 1000);
        viewerManager.addHandler("key-up", (e: any) => this._onKeyUp(e), undefined, 1000);
        // A window switch while a hold key is pressed would skip key-up;
        // release every active hold so nothing is left stuck.
        window.addEventListener("blur", () => this._releaseAllHolds());
    }

    private _onKeyDown(e: KeyboardEvent & { focusCanvas?: any }): void {
        const spec = this._matchDispatchable(e);
        if (!spec) return;
        const ctx: ShortcutInvocation = { event: e, viewer: this._resolveViewer(e), shortcutId: spec.id };
        if (spec.type === "hold") {
            if (spec.preventDefault !== false) e.preventDefault();
            // Key auto-repeat while held re-fires keydown — press once only.
            if ((e as any).repeat || this._activeHolds.has(spec.id)) return;
            this._activeHolds.set(spec.id, ctx);
            spec.onPress?.(ctx);
            return;
        }
        if ((spec.trigger || "down") !== "down") return;
        if (spec.preventDefault !== false) e.preventDefault();
        spec.handler?.(ctx);
    }

    private _onKeyUp(e: KeyboardEvent & { focusCanvas?: any }): void {
        // Holds first, matched by main token only (modifier-insensitive): the
        // user may have released a modifier before the key, and the release
        // must never be missed.
        for (const [id, pressCtx] of [...this._activeHolds]) {
            const eff = this._effective.get(id);
            if (eff && eff.parsed.some(p => eventMatchesTokenOf(p, e))) {
                const spec = this._specs.get(id);
                if (spec?.preventDefault !== false) e.preventDefault();
                this._releaseHold(id, e, pressCtx);
            }
        }
        const spec = this._matchDispatchable(e);
        if (!spec || spec.type !== "press" || (spec.trigger || "down") !== "up") return;
        if (spec.preventDefault !== false) e.preventDefault();
        spec.handler?.({ event: e, viewer: this._resolveViewer(e), shortcutId: spec.id });
    }

    /** Match an event to a dispatchable (non-binding-only) shortcut, applying scope gates. */
    private _matchDispatchable(e: KeyboardEvent & { focusCanvas?: any }): ShortcutSpec | null {
        let id: string | undefined;
        for (const key of eventIndexKeys(e)) {
            id = this._index.get(key);
            if (id) break;
        }
        if (!id) return null;
        const spec = this._specs.get(id);
        if (!spec) return null;
        // Binding-only registration: dispatch is delegated to the registrant.
        if (!spec.handler && !spec.onPress && !spec.onRelease) return null;
        const scope = spec.scope || {};
        if (scope.requiresCanvasFocus && !e.focusCanvas) return null;
        if (!scope.allowInInputs && isEditableTarget(e.target)) return null;
        return spec;
    }

    private _resolveViewer(e: { focusCanvas?: any } | null): OpenSeadragon.Viewer | null {
        const focus = e?.focusCanvas;
        if (focus && typeof focus === "object" && focus.world) return focus;
        return this._viewerManager?.get?.() || null;
    }

    private _releaseHold(id: string, e: KeyboardEvent | null, pressCtx?: ShortcutInvocation): void {
        const ctx = pressCtx || this._activeHolds.get(id);
        if (!ctx) return;
        this._activeHolds.delete(id);
        this._specs.get(id)?.onRelease?.({ event: e, viewer: ctx.viewer, shortcutId: id });
    }

    private _releaseAllHolds(): void {
        for (const id of [...this._activeHolds.keys()]) this._releaseHold(id, null);
    }

    // ── Effective bindings + conflict resolution ────────────────────────────

    private _rebuild(): void {
        this._effective.clear();
        this._index.clear();
        const taken = new Map<string, string>(); // index key → owner shortcut id
        const claim = (id: string, combo: string, suppressed: string[]): ComboParts | null => {
            const parts = parseCombo(combo);
            if (!parts) return null;
            const key = comboIndexKey(parts);
            const owner = taken.get(key);
            if (owner) {
                // Unique assignment: first claim wins; a losing DEFAULT is
                // suppressed silently-ish (resurfaces when the winner moves),
                // a losing OVERRIDE only happens via hand-edited storage.
                console.warn(`ShortcutManager: combo "${combo}" of "${id}" conflicts with "${owner}" — suppressed.`);
                suppressed.push(combo);
                return null;
            }
            taken.set(key, id);
            this._index.set(key, id);
            return parts;
        };
        // Two passes so a user override always beats another shortcut's default.
        const withOverride: string[] = [], withDefaults: string[] = [];
        for (const id of this._specs.keys()) {
            (this._overrides[id] !== undefined ? withOverride : withDefaults).push(id);
        }
        for (const id of withOverride) {
            const combos: string[] = [], parsed: ComboParts[] = [], suppressed: string[] = [];
            for (const combo of this._overrides[id] || []) {
                const parts = claim(id, combo, suppressed);
                if (parts) { combos.push(combo); parsed.push(parts); }
            }
            this._effective.set(id, { combos, parsed, suppressed });
        }
        for (const id of withDefaults) {
            const combos: string[] = [], parsed: ComboParts[] = [], suppressed: string[] = [];
            for (const combo of (this._specs.get(id) as ShortcutSpec).defaultCombos) {
                const parts = claim(id, combo, suppressed);
                if (parts) { combos.push(combo); parsed.push(parts); }
            }
            this._effective.set(id, { combos, parsed, suppressed });
        }
        // Bindings may have moved from under an active hold — release it.
        for (const id of [...this._activeHolds.keys()]) {
            if (!this._effective.get(id)?.combos.length) this._releaseHold(id, null);
        }
    }

    // ── Persistence ─────────────────────────────────────────────────────────

    private _loadOverrides(): void {
        let raw: any = null;
        try {
            raw = this._cache.get(CACHE_KEY, null);
            if (typeof raw === "string") raw = JSON.parse(raw);
        } catch (_) {
            // Corrupted blob: self-heal.
            this._cache.delete(CACHE_KEY);
            raw = null;
        }
        this._overrides = {};
        if (!raw || typeof raw !== "object") return;
        for (const [id, value] of Object.entries(raw)) {
            if (value === null) {
                this._overrides[id] = null;
            } else if (Array.isArray(value)) {
                const combos = value.filter(c => ShortcutManager.isValidCombo(c));
                this._overrides[id] = combos.length ? combos : null;
            }
            // Unknown ids are kept — their owner may not be loaded this
            // session; they only apply once the shortcut registers.
        }
    }

    private _saveOverrides(): void {
        this._cache.set(CACHE_KEY, JSON.stringify(this._overrides));
    }

    // ── Combo utilities (shared with the Keymap capture widget) ─────────────
    // Instance delegates: consumers reach the manager through the
    // APPLICATION_CONTEXT.shortcuts instance (ui/ code has no import path to
    // the class), so the statics are also exposed on the instance.

    /** @see ShortcutManager.comboFromEvent */
    comboFromEvent(e: KeyboardEvent): string | null {
        return ShortcutManager.comboFromEvent(e);
    }

    /** @see ShortcutManager.comboDisplayParts */
    comboDisplayParts(combo: string): string[] {
        return ShortcutManager.comboDisplayParts(combo);
    }

    /** @see ShortcutManager.isValidCombo */
    isValidCombo(combo: string): boolean {
        return ShortcutManager.isValidCombo(combo);
    }

    /**
     * Canonical combo of a live keyboard event, or `null` for pure-modifier
     * presses. Uses `e.code` tokens; the platform-primary modifier is
     * recorded as the portable `Primary` alias.
     */
    static comboFromEvent(e: KeyboardEvent): string | null {
        const code = eventCode(e);
        if (!code || MODIFIER_KEYS.has(e.key)) return null;
        const parts: string[] = [];
        const primary = IS_MAC ? e.metaKey : e.ctrlKey;
        if (primary) parts.push("Primary");
        if (e.ctrlKey && (IS_MAC || !primary)) parts.push("Ctrl");
        if (e.altKey) parts.push("Alt");
        if (e.shiftKey) parts.push("Shift");
        if (e.metaKey && (!IS_MAC || !primary)) parts.push("Meta");
        parts.push(code);
        return parts.join("+");
    }

    /** Human-readable chip labels of a canonical combo, e.g. `["Ctrl", "Shift", "Z"]`. */
    static comboDisplayParts(combo: string): string[] {
        const parts = parseCombo(combo);
        if (!parts) return [combo];
        const out: string[] = [];
        if (parts.primary) out.push(IS_MAC ? "⌘" : "Ctrl");
        if (parts.ctrl) out.push(IS_MAC ? "⌃" : "Ctrl");
        if (parts.alt) out.push(IS_MAC ? "⌥" : "Alt");
        if (parts.shift) out.push(IS_MAC ? "⇧" : "Shift");
        if (parts.meta) out.push(IS_MAC ? "⌘" : "Win");
        out.push(tokenDisplay(parts.token));
        return out;
    }

    /** Whether a string parses as a canonical combo. */
    static isValidCombo(combo: string): boolean {
        return parseCombo(combo) !== null;
    }
}
