// `post-data` sink — writes bundle payloads into the shared POST_DATA dict
// in the shape `getForm` (src/loader.ts) understands, so the host's
// `serializeApp` -> form-submit pipeline turns them into HTML form inputs.
//
// Layout (matches getForm's three-namespace contract):
//   xoType "module": POST_DATA["module"][ownerId][key] = serialized
//   xoType "plugin": POST_DATA["plugin"][ownerId][key] = serialized
//   xoType "core":   POST_DATA[ownerId][key]           = serialized
// A bundle-export with empty `key` and no `viewerId` lands at `[""]`;
// a viewer-scoped export uses `"::<viewerId>"` as the inner key.
//
// Round-trip: a POST input named `module[annotations]` parses back into
// `POST_DATA.module.annotations`, so `readBundle` finds the payload at
// the same path `writeBundle` produced.

export interface PostDataSinkOptions {
    POST_DATA: Record<string, any>;
}

export function makePostDataSink(opts: PostDataSinkOptions): IOSink {
    const POST_DATA = opts.POST_DATA;

    function bucketFor(ctx: IOContext, create: boolean): Record<string, any> | undefined {
        const ns = ctx.xoType === "module" || ctx.xoType === "plugin" ? ctx.xoType : null;
        let root: Record<string, any> = POST_DATA;
        if (ns) {
            let nsBucket = root[ns];
            if (!nsBucket || typeof nsBucket !== "object") {
                if (!create) return undefined;
                nsBucket = root[ns] = {};
            }
            root = nsBucket;
        }
        let bucket = root[ctx.ownerId];
        if (!bucket || typeof bucket !== "object") {
            if (!create) return undefined;
            bucket = root[ctx.ownerId] = {};
        }
        return bucket;
    }

    function keyFor(ctx: IOContext): string {
        return ctx.viewerId ? `${ctx.key}::${ctx.viewerId}` : ctx.key;
    }

    return {
        id: "post-data",
        label: "Session export (HTML form)",
        supports: ["bundle"],

        async writeBundle(ctx, payload) {
            if (payload === undefined || payload === null) return { ok: true };
            const bucket = bucketFor(ctx, true)!;
            bucket[keyFor(ctx)] = serialize(payload);
            return { ok: true };
        },

        async readBundle(ctx) {
            const bucket = bucketFor(ctx, false);
            if (!bucket) return { ok: true, payload: undefined };
            return { ok: true, payload: bucket[keyFor(ctx)] };
        },
    };
}

function serialize(value: unknown): unknown {
    if (typeof value === "string") return value;
    if (value instanceof ArrayBuffer || value instanceof Blob) return value;
    try { return JSON.stringify(value); }
    catch { return String(value); }
}
