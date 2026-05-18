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
// IMPORTANT: do NOT include `ctx.capabilityId` in the key. The pipeline sets
// `ctx.capabilityId = "bundle-export"` on writes (via `runOneBundleExport`)
// and hardcodes `"bundle-import"` on reads (via `runOneRestore`), so a
// capability-suffixed key would map every write to a slot that the
// symmetric read can never find — round-trip silently broken. The post-data
// sink (`./post-data.ts`) is keyed the same way (no capabilityId) for the
// same reason.

export function makeSessionMemorySink(): IOSink {
    const slots = new Map<string, unknown>();

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
            slots.set(slotKey(ctx), payload);
            return { ok: true };
        },

        async readBundle(ctx) {
            const payload = slots.get(slotKey(ctx));
            return { ok: true, payload };
        },
    };
}
