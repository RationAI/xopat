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
// `create` is NOT retried by default: a create whose answer was lost (a 502
// after the upstream already stored the item) would be stored twice. A sink
// that dedups server-side opts in with `methods: [..., "create"]`.
//
// The bulk forms follow their single counterparts: `deleteMany` is retried
// where `delete` is, `createMany` where `create` is — and only the slots that
// failed are sent again. NOTE the bulk methods are invoked on the INNER sink,
// so a `createMany` written as `this.create(...)` per item reaches the inner
// `create`, not the retrying wrapper; the wrapper's own slot retry covers it.
//
// The wrapper preserves everything the inner sink declares (id, route,
// accepts() filter, supported kinds). Each retry attempt receives the same `ctx`
// (so sinks that read `ctx.meta.clientOpId` can dedup server-side
// across retries).

type RetryableMethod = "writeBundle" | "readBundle" | "create" | "read" | "update" | "delete";

const DEFAULT_METHODS: RetryableMethod[] = ["writeBundle", "readBundle", "read", "update", "delete"];

export interface WithRetryOptions {
    attempts?: number;                                          // default 3
    backoff?: (attemptIndex: number) => number;                  // default exponential
    retryOn?: (result: IOResult) => boolean;                     // default: refusals with W_IO_*_THREW, network, 429 or 5xx codes
    /** Methods that are retried; the rest pass through with one attempt.
     *  Default: every method except the non-idempotent `create`. */
    methods?: RetryableMethod[];
    /** Override the wrapped id; useful when you register the same inner
     *  sink multiple times under different ids/configs. */
    id?: string;
}

const DEFAULT_RETRY_ON: (r: IOResult) => boolean = (r) => {
    if (r.ok) return false;
    const code = String((r as any).code ?? "");
    return code.endsWith("_THREW") || code === "W_IO_HTTP_NETWORK" || code === "429" || /^5\d\d$/.test(code);
};

const DEFAULT_BACKOFF = (n: number) => 200 * Math.pow(2, n);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function withRetry(inner: IOSink, options: WithRetryOptions = {}): IOSink {
    const attempts = Math.max(1, options.attempts ?? 3);
    const backoff = options.backoff ?? DEFAULT_BACKOFF;
    const retryOn = options.retryOn ?? DEFAULT_RETRY_ON;
    const methods = new Set<RetryableMethod>(options.methods ?? DEFAULT_METHODS);

    const wrapMethod = <Args extends any[]>(
        name: RetryableMethod,
        method: ((...args: Args) => Promise<IOResult> | IOResult) | undefined,
    ) => {
        if (!method) return undefined;
        if (!methods.has(name)) return method;
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

    // Bulk forms follow their single counterpart's policy (`createMany` is
    // retried only where `create` is). Only the slots that failed retryably are
    // sent again — re-sending the whole batch would repeat the items that were
    // already stored. A throw fails every slot of that attempt.
    const wrapBulk = (
        single: RetryableMethod,
        method: ((ctxs: IOContext[], items?: unknown[]) => Promise<IOResult[]> | IOResult[]) | undefined,
    ) => {
        if (!method) return undefined;
        if (!methods.has(single)) return method.bind(inner);
        return async (ctxs: IOContext[], items?: unknown[]): Promise<IOResult[]> => {
            const out: IOResult[] = new Array(ctxs.length);
            let pending = ctxs.map((_, i) => i);
            for (let attempt = 0; attempt < attempts && pending.length; attempt++) {
                const subCtxs = pending.map(i => ctxs[i]!);
                const subItems = items ? pending.map(i => items[i]) : undefined;
                let results: IOResult[];
                try {
                    const raw = await method.call(inner, subCtxs, subItems);
                    // A malformed answer is passed on untouched for the pipeline
                    // to judge; it is not this wrapper's contract to enforce.
                    if (!Array.isArray(raw) || raw.length !== subCtxs.length) {
                        if (attempt === 0) return raw;
                        results = subCtxs.map((_, k) => (raw as any)?.[k] as IOResult);
                    } else {
                        results = raw;
                    }
                } catch (e: any) {
                    if (attempt === 0 && !retryOn({ ok: false, refused: true, reason: "", code: "W_IO_SINK_THREW" })) throw e;
                    results = subCtxs.map(() => ({
                        ok: false as const, refused: true as const,
                        reason: e?.message ?? String(e), code: "W_IO_SINK_THREW",
                        ...(e?.userMessage ? { userMessage: e.userMessage } : {}),
                    }));
                }
                const again: number[] = [];
                pending.forEach((i, k) => {
                    const r = results[k]!;
                    out[i] = r;
                    if (r && !r.ok && retryOn(r)) again.push(i);
                });
                pending = again;
                if (pending.length && attempt < attempts - 1) await sleep(backoff(attempt));
            }
            return out;
        };
    };

    return {
        // Everything the inner sink declares about itself (`route`, format
        // requirements, future fields) must survive wrapping — a wrapped
        // `route: "local"` sink that lost the field would be judged as an
        // ordinary destination. The explicit entries below override methods.
        ...inner,
        id: options.id ?? inner.id,
        label: inner.label,
        // `supports` is either the legacy kind array or the full
        // `IOSinkSupport` descriptor — clone whichever the inner sink used so
        // the wrapper inherits its owner/capability/resource restrictions.
        supports: Array.isArray(inner.supports) ? inner.supports.slice() : { ...inner.supports },
        accepts: inner.accepts ? inner.accepts.bind(inner) : undefined,

        writeBundle: wrapMethod("writeBundle", inner.writeBundle?.bind(inner)),
        readBundle:  wrapMethod("readBundle", inner.readBundle?.bind(inner)),
        create:      wrapMethod("create", inner.create?.bind(inner)),
        read:        wrapMethod("read", inner.read?.bind(inner)),
        update:      wrapMethod("update", inner.update?.bind(inner)),
        delete:      wrapMethod("delete", inner.delete?.bind(inner)),
        // Named explicitly, not left to the spread: a spread copies own
        // properties only, so a class-based sink would lose these — and with
        // them batching, or its format pin — the moment it was wrapped.
        createMany:  wrapBulk("create", inner.createMany as any),
        deleteMany:  wrapBulk("delete", inner.deleteMany as any),
        maxBatch:    inner.maxBatch,
        preferredFormat: inner.preferredFormat ? inner.preferredFormat.bind(inner) : undefined,
        // query is a streaming API; retry semantics are different (would
        // re-yield items). Pass through as-is.
        query: inner.query ? inner.query.bind(inner) : undefined,
    };
}
