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

import { IOPipeline, IOError, type IOPipelineOptions } from "./io-pipeline";
import { IOResourceImpl } from "./io-resource";
import { fileDownloadSink } from "./sinks/file-download";
import { fileUploadSink } from "./sinks/file-upload";
import { makePostDataSink } from "./sinks/post-data";
import { makeHttpRestSink } from "./sinks/http-rest";
import { withRetry } from "./sinks/with-retry";
import {
    makeStorageDriver,
    makeMemoryDriver,
    makeCookiesDriver,
    makePostDataKVDriver,
} from "./kv-drivers";

export { IOPipeline, IOError, IOResourceImpl };
export { fileUploadSink, fileDownloadSink };
export { makePostDataSink, makeHttpRestSink, withRetry };
export { makeStorageDriver, makeMemoryDriver, makeCookiesDriver, makePostDataKVDriver };

/**
 * Create the IO pipeline and register the four built-in sinks:
 * `file-download`, `file-upload`, `post-data`, and a default `http-rest`
 * (the latter pulls per-deployment overrides from
 * `ENV.client.io.sinkOverrides['http-rest']`). Custom HTTP sinks with
 * distinct ids can be registered later via
 * `IO_PIPELINE.registerSink(makeHttpRestSink({ id: '...', getOptions }))`.
 */
export function createIOPipeline(opts: IOPipelineOptions): IOPipeline {
    const pipeline = new IOPipeline(opts);

    // ── Bundle / CRUD sinks ────────────────────────────────────────────
    // Order matters: post-data first so it is the registered fallback for
    // bundle capabilities even if other sinks replace ids later.
    pipeline.registerSink(makePostDataSink({ POST_DATA: opts.POST_DATA }));
    pipeline.registerSink(fileDownloadSink);
    pipeline.registerSink(fileUploadSink);
    pipeline.registerSink(makeHttpRestSink({
        id: "http-rest",
        getOptions: () => pipeline.sinkOverrides("http-rest"),
    }));

    // ── KV drivers ─────────────────────────────────────────────────────
    // `memory` is always available; the others depend on host APIs being
    // present. Cookies are upgraded by `src/app.ts` once `Cookies.js` loads.
    pipeline.registerKVDriver(makeMemoryDriver());
    if (typeof window !== "undefined" && window.localStorage) {
        pipeline.registerKVDriver(makeStorageDriver({
            id: "local-storage", label: "localStorage",
            storage: window.localStorage, shared: true,
        }));
    }
    if (typeof window !== "undefined" && window.sessionStorage) {
        pipeline.registerKVDriver(makeStorageDriver({
            id: "session-storage", label: "sessionStorage",
            storage: window.sessionStorage, shared: true,
        }));
    }
    pipeline.registerKVDriver(makeCookiesDriver());
    pipeline.registerKVDriver(makePostDataKVDriver(opts.POST_DATA));

    return pipeline;
}
