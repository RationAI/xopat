// Bootstrap the generic IO pipeline (`window.IO_PIPELINE`) before
// APPLICATION_CONTEXT is constructed. Must run after Cookies.withAttributes
// is configured (the `cookies` KV driver reads `globalThis.Cookies` lazily on
// first access) and before any code calls `getOption()` / touches
// AppCache/AppCookies — both go through `XOpatStorage` façades that resolve
// their handles via `window.IO_PIPELINE`.

import type { XOpatCoreConfig } from "../../types/config";
import { createIOPipeline, IOPipeline } from "./index";

export function bootstrapIOPipeline(
    ENV: XOpatCoreConfig,
    POST_DATA: Record<string, any>
): IOPipeline {
    const IO_PIPELINE: IOPipeline = createIOPipeline({
        POST_DATA,
        getConfig: () => (ENV?.client as any)?.io,
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
    (window as any).IO_PIPELINE = IO_PIPELINE;
    // Synthetic `core` owner so APPLICATION_CONTEXT-level storage routes
    // through the pipeline on the same axis as plugins/modules.
    IO_PIPELINE.registerOwner("core", { ownerId: "core", xoType: "core" });
    return IO_PIPELINE;
}
