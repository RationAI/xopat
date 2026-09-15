// Generic IO/persistence pipeline — public entry point.
//
// Bootstrap from the loader (initXOpatLoader) at startup:
//
//   const IO_PIPELINE = createIOPipeline({
//     POST_DATA,
//     getConfig: () => APPLICATION_CONTEXT.config?.params?.io,
//     notify:   (m, l) => Dialogs.show(m, 5000, Dialogs.MSG_WARN),
//   });
//   (window as any).IO_PIPELINE = IO_PIPELINE;
//   APPLICATION_CONTEXT.io = IO_PIPELINE;

import {
    IOPipeline,
    IOError,
    formatContextTemplate,
    capabilityGroupOf,
    matchesPattern,
    sinkSupportOf,
    type IOPipelineOptions,
} from "./io-pipeline";
import { IOResourceImpl } from "./io-resource";
import { fileDownloadSink } from "./sinks/file-download";
import { fileUploadSink } from "./sinks/file-upload";
import { makePostDataSink } from "./sinks/post-data";
import { makeHttpRestSink } from "./sinks/http-rest";
import { makeSessionMemorySink } from "./sinks/session-memory";
import { withRetry } from "./sinks/with-retry";
import {
    makeStorageDriver,
    makeMemoryDriver,
    makeCookiesDriver,
    makePostDataKVDriver,
} from "./kv-drivers";

export { IOPipeline, IOError, IOResourceImpl };
// Sink-authoring helpers. Runtime `.mjs` sinks cannot import from the bundled
// core, so these are ALSO reachable as `IO_PIPELINE.formatPath` /
// `IO_PIPELINE.matchesPattern` — prefer those in a module/plugin.
export { formatContextTemplate, capabilityGroupOf, matchesPattern, sinkSupportOf };
export { fileUploadSink, fileDownloadSink };
export { makePostDataSink, makeHttpRestSink, makeSessionMemorySink, withRetry };
export { makeStorageDriver, makeMemoryDriver, makeCookiesDriver, makePostDataKVDriver };

/**
 * Create the IO pipeline and register the five built-in sinks:
 * `post-data`, `file-download`, `file-upload`, `http-rest` (which pulls
 * per-deployment overrides from `ENV.client.io.sinkOverrides['http-rest']`),
 * and `session-memory`. Custom HTTP sinks with distinct ids can be registered
 * later via `IO_PIPELINE.registerSink(makeHttpRestSink({ id, getOptions }))`.
 *
 * Writing your own sink: `src/IO_SINK_AUTHORING.md`.
 */
export function createIOPipeline(opts: IOPipelineOptions): IOPipeline {
    const pipeline = new IOPipeline(opts);

    // ── Bundle / CRUD sinks ────────────────────────────────────────────
    // Order matters: post-data first so it is the registered fallback for
    // bundle capabilities even if other sinks replace ids later.
    pipeline.registerSink(makePostDataSink({ POST_DATA: opts.POST_DATA }));
    pipeline.registerSink(fileDownloadSink);
    pipeline.registerSink(fileUploadSink);
    // Retry-wrapped: this is the sink a deployment binds first when it points
    // xOpat at its own backend, and it is the one talking to a network. Without
    // the wrapper a single dropped connection lost the write outright, which
    // reads to the user as "Save worked" (the outbox drained) with nothing
    // stored. Defaults only retry `*_THREW` and 5xx — a 4xx is the upstream
    // saying no, and repeating it just delays the refusal.
    pipeline.registerSink(withRetry(makeHttpRestSink({
        id: "http-rest",
        getOptions: () => pipeline.sinkOverrides("http-rest"),
    })));
    // Default fallback for slide-aware bundle owners (bundleScope:
    // "per-viewer-background" / "all"). post-data is a single global slot
    // and cannot hold one bundle per (viewer, background); session-memory
    // keys by ctx.key so slide swaps preserve per-slide payloads in-session.
    pipeline.registerSink(makeSessionMemorySink());

    // ── KV drivers ─────────────────────────────────────────────────────
    // `memory` is always available; the browser-backed ones are PROBED, never
    // assumed. In a sandboxed iframe without `allow-same-origin` the document
    // has an opaque origin and reading `window.localStorage` itself throws
    // `SecurityError` — the old `&& window.localStorage` truthiness test was a
    // throw site, and it took the whole boot down with it.
    //
    // When a probe fails we register a MEMORY driver under the ORIGINAL id.
    // That matters: `KV_NAMESPACE_FALLBACK` (io-pipeline.ts) is only applied
    // when the fallback id is registered, so an absent `local-storage` makes
    // `kv:cache` resolve to `[]` — silently inert, with no warning. Keeping the
    // ids also means existing `ENV.client.io.bindings` referring to them keep
    // resolving, and `CookiesFacade.with()` still finds a driver object.
    pipeline.registerKVDriver(makeMemoryDriver());

    const degradedIds: string[] = [];
    const registerWebStorage = (
        id: string, label: string,
        kind: "localStorage" | "sessionStorage",
    ) => {
        if (typeof window !== "undefined" && XOpatStorageAvailability.check(kind)) {
            pipeline.registerKVDriver(makeStorageDriver({
                id, label, storage: window[kind], shared: true,
                onDegrade: (dId) => console.warn(`[IO] "${dId}" degraded mid-session; preferences stop persisting.`),
            }));
        } else {
            // A fresh Map per driver: the three stores are independent in the
            // browser, and a plugin writing `this.cookies` must not read it
            // back through `this.cache`.
            const m = makeMemoryDriver(id);
            m.label = `${label} (unavailable — in-memory)`;
            pipeline.registerKVDriver(m);
            degradedIds.push(id);
        }
    };
    registerWebStorage("local-storage", "localStorage", "localStorage");
    registerWebStorage("session-storage", "sessionStorage", "sessionStorage");

    // Cookies probe themselves — `document.cookie` throws in an opaque origin.
    pipeline.registerKVDriver(makeCookiesDriver("cookies", opts.cookieAttributes));
    if (typeof window !== "undefined" && !XOpatStorageAvailability.cookies) degradedIds.push("cookies");

    // `kv:data` is unaffected — POST_DATA is an in-page object, not a browser API.
    pipeline.registerKVDriver(makePostDataKVDriver(opts.POST_DATA));

    if (degradedIds.length) {
        console.warn(
            `[IO] browser storage unavailable (${XOpatStorageAvailability.opaqueOrigin
                ? "opaque origin — sandboxed iframe without allow-same-origin"
                : "blocked by the browser"}); KV drivers [${degradedIds.join(", ")}] are in-memory. ` +
            `Preferences will not persist beyond this session. ` +
            `See src/IO_PIPELINE.md → "Sandboxed / opaque-origin operation".`);
    }

    return pipeline;
}
