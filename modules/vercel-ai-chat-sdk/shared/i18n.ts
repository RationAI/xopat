/**
 * The module's own translator.
 *
 * Chat strings live in this element's bundle (`locales/en.json`, registered under
 * the element id by `loadLocale`), not in the core one — a bare global lookup would
 * look them up in core and find nothing. UI files have no element instance in
 * scope, so every file in this element imports `_t` from here.
 *
 * `_t` is the name the i18n audit recognises as an element-scoped call
 * (`server/utils/grunt/tasks/i18n-audit.js`), so keys stay validated against
 * `modules/vercel-ai-chat-sdk/locales/en.json`. Do not rename it.
 */
const NS = "vercel-ai-chat-sdk";

let owner: any = null;

/** Called once by `ChatModule`; lets `_t` reuse the element translator's memoization. */
export function bindTranslator(element: any): void {
    owner = element;
}

export function _t(key: string, options?: Record<string, any>): string {
    if (owner) return owner.t(key, options);
    return $.t(key, {...(options || {}), ns: NS});
}
