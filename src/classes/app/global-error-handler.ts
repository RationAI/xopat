// Post-init global runtime-error surfacing.
//
// The boot-time `window.onerror` (server/templates/index.html) shows a *blocking*
// full-viewport "Error" card. That is only meant as a pre-init safety net. Once the
// app is up we own error surfacing here: uncaught runtime errors become a
// non-blocking, deduped, rate-limited toast so a recurring error (e.g. a per-tile
// WebGL cleanup throw) can't hammer the user with full-viewport cards.
//
// We deliberately use `addEventListener('error')` rather than reassigning
// `window.onerror`: `loader.ts` juggles `window.onerror` around plugin script loads
// (setting it and nulling it again), so an addEventListener hook is not clobbered by
// late plugin loading. The console/appTrace logging already lives in the boot
// `addEventListener('error')` / `'unhandledrejection'` handlers (index.html), so we
// only surface the toast here and do not re-log.

const SUPPRESS_MS = 10000; // do not re-toast the same signature within this window
const MAX_SIGNATURES = 200; // cap the memory of seen error signatures

const lastShown = new Map<string, number>();

function isResizeObserverNoise(payload: unknown): boolean {
    const fn = (window as any).isResizeObserverLoopMessage;
    return typeof fn === "function" && !!fn(payload);
}

// Cancellations are an expected, benign outcome (aborted fetch on navigation /
// slide-switch, a library rejecting with AbortError, a bare Promise.reject()).
// They must never surface the "contact us" error card. Detect the DOM/AbortSignal
// abort name and empty rejections; genuine errors always carry a message/reason.
function isBenignRejection(reason: unknown): boolean {
    if (reason == null) return true; // Promise.reject() / reject(undefined)
    if (typeof reason === "object") {
        const name = (reason as any).name;
        if (name === "AbortError" || name === "CanceledError" || name === "CancelledError") return true;
        const code = (reason as any).code;
        if (code === "ABORT_ERR" || code === 20 /* DOMException.ABORT_ERR */) return true;
    }
    return false;
}

function signatureOf(message: string, file?: string, line?: number | string): string {
    return `${message}|${file || ""}:${line ?? ""}`;
}

// Classify + remembered-timeout rate-limit: the same error signature is surfaced at
// most once per SUPPRESS_MS. Returns true if a toast should be shown now.
function shouldSurface(signature: string): boolean {
    const now = Date.now();
    const prev = lastShown.get(signature);
    if (prev !== undefined && now - prev < SUPPRESS_MS) {
        return false;
    }
    // Bounded memory: clear wholesale when the cap is hit (cheap, and the suppression
    // window is short so the map naturally stays small in practice).
    if (lastShown.size >= MAX_SIGNATURES) {
        lastShown.clear();
    }
    lastShown.set(signature, now);
    return true;
}

function surface(signature: string): void {
    if (!shouldSurface(signature)) {
        return;
    }
    try {
        // Generic translated message; the technical detail is already in the console.
        // Toast additionally dedupes identical text into one entry with a ×N badge.
        Dialogs.show($.t("error.reachUs"), 8000, Dialogs.MSG_ERR);
    } catch (_e) {
        // Toast system unavailable (very early / torn down) — console already has it.
    }
}

function onError(e: ErrorEvent): void {
    const payload = e.error || e.message;
    if (isResizeObserverNoise(payload)) {
        return;
    }
    const message =
        typeof e.message === "string" && e.message
            ? e.message
            : String((e.error && e.error.message) || e.error || "error");
    surface(signatureOf(message, e.filename, e.lineno));
}

function onRejection(e: PromiseRejectionEvent): void {
    const reason: any = e.reason;
    if (isResizeObserverNoise(reason) || isBenignRejection(reason)) {
        return;
    }
    const message =
        typeof reason === "string" ? reason : String((reason && reason.message) || reason || "rejection");
    surface(signatureOf(message, reason && reason.fileName, reason && reason.lineNumber));
}

/**
 * Install the post-init global runtime-error handler. Call once, at app-init
 * completion (next to `wireViewerErrorHandlers`). Neutralizes the boot-time blocking
 * `window.onerror` card and routes subsequent uncaught errors / rejections to a
 * non-blocking, rate-limited toast.
 */
export function wireGlobalRuntimeErrorHandler(): void {
    // Retire the pre-init blocking safety net. `loader.ts` already nulls this after
    // plugin loads, but a session with no dynamically-loaded plugins would otherwise
    // keep the boot handler (and its full-viewport card) live.
    window.onerror = null;

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
}
