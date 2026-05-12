// withRetry — wrap any IOSink with bounded retry+backoff.
//
// Usage:
//   IO_PIPELINE.registerSink(withRetry(myHttpSink, {
//     attempts: 3,
//     backoff: (n) => 200 * 2 ** n,        // 200ms, 400ms, 800ms
//     retryOn: r => r.code === "W_IO_HTTP_NETWORK"
//                || /^5\d\d$/.test(String(r.code ?? "")),
//   }));
//
// The wrapper preserves the inner sink's id, accepts() filter, and
// supported capability kinds. Each retry attempt receives the same `ctx`
// (so sinks that read `ctx.meta.clientOpId` can dedup server-side
// across retries).

export interface WithRetryOptions {
    attempts?: number;                                          // default 3
    backoff?: (attemptIndex: number) => number;                  // default exponential
    retryOn?: (result: IOResult) => boolean;                     // default: refusals with W_IO_*_THREW or 5xx codes
    /** Override the wrapped id; useful when you register the same inner
     *  sink multiple times under different ids/configs. */
    id?: string;
}

const DEFAULT_RETRY_ON: (r: IOResult) => boolean = (r) => {
    if (r.ok) return false;
    const code = String((r as any).code ?? "");
    return code.endsWith("_THREW") || /^5\d\d$/.test(code);
};

const DEFAULT_BACKOFF = (n: number) => 200 * Math.pow(2, n);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function withRetry(inner: IOSink, options: WithRetryOptions = {}): IOSink {
    const attempts = Math.max(1, options.attempts ?? 3);
    const backoff = options.backoff ?? DEFAULT_BACKOFF;
    const retryOn = options.retryOn ?? DEFAULT_RETRY_ON;

    const wrapMethod = <Args extends any[]>(
        method: ((...args: Args) => Promise<IOResult> | IOResult) | undefined,
    ) => {
        if (!method) return undefined;
        return async (...args: Args): Promise<IOResult> => {
            let last: IOResult = { ok: false, refused: true, reason: "no attempts", code: "W_IO_RETRY_NO_ATTEMPTS" };
            for (let i = 0; i < attempts; i++) {
                try {
                    const r = await method.apply(inner, args);
                    if (r.ok || !retryOn(r)) return r;
                    last = r;
                } catch (e: any) {
                    last = {
                        ok: false, refused: true,
                        reason: e?.message ?? String(e),
                        code: "W_IO_SINK_THREW",
                    };
                    if (!retryOn(last)) return last;
                }
                if (i < attempts - 1) await sleep(backoff(i));
            }
            return last;
        };
    };

    return {
        id: options.id ?? inner.id,
        label: inner.label,
        supports: inner.supports.slice(),
        accepts: inner.accepts ? inner.accepts.bind(inner) : undefined,

        writeBundle: wrapMethod(inner.writeBundle?.bind(inner)),
        readBundle:  wrapMethod(inner.readBundle?.bind(inner)),
        create:      wrapMethod(inner.create?.bind(inner)),
        read:        wrapMethod(inner.read?.bind(inner)),
        update:      wrapMethod(inner.update?.bind(inner)),
        delete:      wrapMethod(inner.delete?.bind(inner)),
        // query is a streaming API; retry semantics are different (would
        // re-yield items). Pass through as-is.
        query: inner.query ? inner.query.bind(inner) : undefined,
    };
}
