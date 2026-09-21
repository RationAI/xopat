/**
 * Translation plumbing: the `$` namespace and the `data-i18n` DOM pass.
 *
 * xOpat used to bind i18next onto jQuery (`jquery-i18next`), which is why the
 * whole codebase reads locale strings through `$.t`. jQuery is gone; `$` survives as a plain
 * namespace object holding exactly what those 1500+ call sites use — `t` and
 * `i18n`. It is NOT callable: `$(selector)` is not a thing in xOpat anymore.
 *
 * See `AGENTS.md` §3 (Translation).
 */

/** The i18n namespace shape callers see as the global `$`. */
export interface I18nNamespace {
    t(key: string, options?: Record<string, any>): string;
    i18n?: any;
    /** @see whenI18nReady */
    __ready?: Promise<void>;
    /** Resolver for `__ready`; called once, by `installI18nNamespace`. */
    __settleReady?: () => void;
}

/**
 * Placeholder used before i18next finishes initialising: returns the key's
 * last dot-segment, never an English literal. Installed idempotently so
 * whichever core script runs first wins and later ones do not clobber a real
 * translator — see `AGENTS.md` §3 "the dummy-`$.t` gotcha".
 *
 * The readiness promise is parked on the namespace object rather than in module
 * scope on purpose: core ships several bundles (`app`, `loader`, `store`) that
 * each carry their own copy of this module, so module-level state would give the
 * waiter a different promise from the one the installer resolves.
 */
export function ensureI18nNamespace(): I18nNamespace {
    const g = globalThis as any;
    if (!g.$) {
        g.$ = { t: (key: any) => String(key).split(".").findLast(Boolean) };
    } else if (typeof g.$.t !== "function") {
        g.$.t = (key: any) => String(key).split(".").findLast(Boolean);
    }
    if (!g.$.__ready) {
        g.$.__ready = new Promise<void>(resolve => { g.$.__settleReady = resolve; });
    }
    return g.$;
}

/**
 * Resolves once the real i18next translator is installed.
 *
 * Needed because *registering* a locale bundle — unlike reading one — cannot
 * degrade. Elements load their bundle from module scope (`loadElementLocale`,
 * `XOpatElement.loadLocale`), which routinely runs before i18next finishes
 * initialising; a registration dropped there is dropped for the whole session,
 * and every lookup in that namespace then renders as the raw dotted key
 * (`<id>.<key>`), with nothing left to retry it. Await this first instead.
 *
 * Bounded so a deployment whose i18next never initialises fails visibly rather
 * than leaving element init hanging — callers must re-check `$.i18n` afterwards.
 */
export function whenI18nReady(timeoutMs = 20000): Promise<void> {
    const ns = ensureI18nNamespace();
    if (ns.i18n) return Promise.resolve();
    const ready = ns.__ready!;
    if (!(timeoutMs > 0)) return ready;
    return Promise.race([
        ready,
        new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
    ]);
}

/** Swap the placeholder for the real i18next-backed translator. */
export function installI18nNamespace(i18next: any): void {
    const ns = ensureI18nNamespace();
    ns.t = i18next.t.bind(i18next);
    ns.i18n = i18next;
    ns.__settleReady?.();
}

/**
 * Apply `data-i18n` to `root` and its descendants.
 *
 * Supports the subset of the jquery-i18next grammar xOpat actually ships:
 *   `key`               → element text
 *   `[html]key`         → element markup
 *   `[title]key`        → the `title` attribute (any attribute name works)
 *   `a;[title]b`        → several specs, semicolon-separated
 * plus `i18n-target` (apply to a descendant matched by that selector) and
 * `parseDefaultValueFromContent` semantics: the element's existing content is
 * passed as `defaultValue`, so a missing key leaves the authored text alone.
 */
export function localizeDom(root: ParentNode = document.body): void {
    const t = (globalThis as any).$?.t;
    if (typeof t !== "function") return;

    const apply = (element: Element) => {
        const spec = element.getAttribute("data-i18n");
        if (!spec) return;

        const targetSelector = element.getAttribute("i18n-target");
        const target = targetSelector
            ? element.querySelector(targetSelector) ?? element
            : element;

        for (const part of spec.split(";")) {
            const rule = part.trim();
            if (!rule) continue;

            const attrMatch = /^\[([^\]]+)\](.*)$/.exec(rule);
            if (!attrMatch) {
                const value = t(rule, { defaultValue: target.textContent ?? "" });
                if (value != null) target.textContent = value;
                continue;
            }
            const attr = attrMatch[1]!;
            const key = attrMatch[2]!;
            if (attr === "html") {
                const value = t(key, { defaultValue: target.innerHTML });
                if (value != null) target.innerHTML = value;
            } else if (attr === "text") {
                const value = t(key, { defaultValue: target.textContent ?? "" });
                if (value != null) target.textContent = value;
            } else {
                const value = t(key, { defaultValue: target.getAttribute(attr) ?? "" });
                if (value != null) target.setAttribute(attr, value);
            }
        }
    };

    if (root instanceof Element) apply(root);
    root.querySelectorAll("[data-i18n]").forEach(apply);
}
