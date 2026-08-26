// Bootstrap the generic IO pipeline (`window.IO_PIPELINE`) before
// APPLICATION_CONTEXT is constructed, and before any code calls
// `getOption()` / touches AppCache/AppCookies — both go through
// `XOpatStorage` façades that resolve their handles via `window.IO_PIPELINE`.
//
// The deployment cookie policy travels in as `cookieAttributes` rather than
// being read off a global: the `cookies` KV driver owns `document.cookie`
// directly now, so there is no external library to configure first.

import type { XOpatCoreConfig } from "../../types/config";
import { createIOPipeline, IOPipeline, withRetry } from "./index";

/**
 * Normalize a configured cookie domain to a bare host.
 *
 * `ENV.client.domain` is an ORIGIN (`https://host:port`) in most deployments,
 * but the cookie `domain=` attribute accepts only a host — a browser that sees
 * anything else silently drops the **whole** cookie, not just the attribute.
 * That made every cookie write a no-op wherever `js_cookie_domain` was unset
 * and `client.domain` carried a scheme.
 */
export function normalizeCookieDomain(raw: string | null | undefined): string | undefined {
    const value = (raw ?? "").trim();
    if (!value) return undefined;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
    try {
        return new URL(value).hostname || undefined;
    } catch {
        return undefined;
    }
}

export function bootstrapIOPipeline(
    ENV: XOpatCoreConfig,
    POST_DATA: Record<string, any>
): IOPipeline {
    const IO_PIPELINE: IOPipeline = createIOPipeline({
        POST_DATA,
        getConfig: () => (ENV?.client as any)?.io,
        cookieAttributes: {
            path: ENV.client.js_cookie_path,
            domain: normalizeCookieDomain(ENV.client.js_cookie_domain || ENV.client.domain),
            expires: ENV.client.js_cookie_expire,
            sameSite: ENV.client.js_cookie_same_site,
            secure: typeof ENV.client.js_cookie_secure === "boolean"
                ? ENV.client.js_cookie_secure : undefined,
        },
        getViewers: () => {
            const vm = (window as any).VIEWER_MANAGER;
            return Array.isArray(vm?.viewers)
                ? vm.viewers.filter(Boolean).map((v: any) => ({ uniqueId: v.uniqueId, viewer: v }))
                : [];
        },
        notify: (m, l) => {
            const D = (window as any).Dialogs;
            if (D?.show) {
                const lvl = l === "error" ? D.MSG_ERR : l === "warn" ? D.MSG_WARN : D.MSG_INFO;
                // Errors and warnings persist long enough that a user
                // glancing away briefly still catches them; info stays
                // short so successful-write confirmations don't pile up.
                const duration = l === "info" ? 5000 : 12000;
                D.show(m, duration, lvl);
            } else {
                (l === "error" ? console.error : l === "warn" ? console.warn : console.info)(`[IO] ${m}`);
            }
        },
    });
    // Runtime `.mjs` sinks cannot `import` from the bundled core; expose the
    // shared retry wrapper on the pipeline instance so they can reach it.
    (IO_PIPELINE as any).withRetry = withRetry;
    (window as any).IO_PIPELINE = IO_PIPELINE;
    // Synthetic `core` owner so APPLICATION_CONTEXT-level storage routes
    // through the pipeline on the same axis as plugins/modules.
    IO_PIPELINE.registerOwner("core", { ownerId: "core", xoType: "core" });
    return IO_PIPELINE;
}
