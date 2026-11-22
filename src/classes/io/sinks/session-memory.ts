// `session-memory` sink — in-memory bundle storage keyed by `ctx.key`. Used
// as the built-in default for slide-aware owners (`bundleScope:
// "per-viewer-background"` or `"all"`) so per-(viewer, background) bundles
// survive slide switches without any admin sink wiring. Cleared on page
// reload by design; durable cross-session storage is an admin choice (bind a
// remote sink instead).
//
// Layout: `slots[${ownerUid}::${ctx.key}]` → payload (as-is). The pipeline
// composes `ctx.key = "<viewerId>::<backgroundId>"` for per-viewer-background
// dispatches; for other scopes the key is whatever the pipeline already
// passes (viewerId, or empty string).
//
// IMPORTANT: do NOT include `ctx.capabilityId` in the key. A write carries the
// export capability's id and the symmetric read carries the import one, so a
// capability-suffixed key would map every write to a slot the read can never
// find — round-trip silently broken. The post-data sink (`./post-data.ts`) is
// keyed the same way (no capabilityId) for the same reason.
//
// The format a payload was written in is remembered beside it and returned on
// read: an untagged string decoded with whatever format happens to be current
// at restore time is how a slide's annotations came back empty after the user
// changed the export format in between.

export function makeSessionMemorySink(): IOSink {
    const slots = new Map<string, { payload: unknown; format?: string }>();

    function slotKey(ctx: IOContext): string {
        return `${ctx.ownerUid}::${ctx.key}`;
    }

    return {
        id: "session-memory",
        label: "In-memory (session)",
        supports: ["bundle"],

        async writeBundle(ctx, payload) {
            if (payload === undefined || payload === null) {
                // Treat null/undefined as "drop" so an empty fabric canvas
                // flushed on slide-out doesn't shadow an older, populated
                // snapshot under the same key from a previous round-trip.
                slots.delete(slotKey(ctx));
                return { ok: true };
            }
            slots.set(slotKey(ctx), { payload, format: ctx.format?.id });
            return { ok: true };
        },

        async readBundle(ctx) {
            const slot = slots.get(slotKey(ctx));
            return slot?.format
                ? { ok: true, payload: slot.payload, format: slot.format }
                : { ok: true, payload: slot?.payload };
        },
    };
}
