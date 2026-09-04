/**
 * Which WebGL context a FlexRenderer instance gets, and why it matters.
 *
 * Browsers cap concurrent WebGL contexts at ~16 and drop the oldest ones to GC when the
 * cap is hit, so xOpat used to put *every* renderer — main viewers, navigators,
 * standalone drawers and isolated/playground viewers — on one shared context. That is
 * still the fallback, and it is what keeps hosts like Jupyter (several viewers per cell)
 * from dying with "out of contexts". FlexRenderer reuses an existing entry only when the
 * key *and* `webGLPreferredVersion` *and* `canvasOptions` agree — which is why the key has
 * to be one literal in one place: two spellings silently produce two contexts while every
 * comment claims otherwise (they did, `"xopat-flex-renderer"` vs `"xopat-flex-rendererS"`).
 *
 * The cost of sharing is not small. A shared context's WebGL canvas is off-DOM, so the
 * renderer allocates a separate 2D presentation canvas and moves the frame across with
 * `gl.readPixels` + a CPU row-flip + `putImageData` — a synchronous GPU->CPU stall, every
 * frame, sized by the viewport. A profiled session spent 18% of its wall clock there
 * (~14 GB of readback over 22 seconds at 2141x1892). With a private context the
 * presentation canvas *is* the WebGL canvas and the transfer does not exist at all.
 * Sharing also makes concurrent renderers skip frames (`sharedContextBusyPolicy`
 * defaults to `"warn-skip"`).
 *
 * So: hand out private contexts while there is budget, and fall back to the shared key
 * beyond it. A deployment that opens one or two viewers — the overwhelming majority —
 * pays nothing; one that opens twenty still works.
 *
 * See also `UPSTREAM.md`: the shared path should not need a readback either.
 */

/** The one shared WebGL context key, used by everything that has no private slot. */
export const FLEX_SHARED_CONTEXT_KEY = "xopat-flex-renderer";

/**
 * Viewer cells that may hold a private context, by default.
 *
 * Counted in *cells*, not renderers: OpenSeadragon hands the navigator the same
 * `drawerOptions` object as its parent viewer, so a cell always costs two contexts.
 * Six cells is twelve contexts, leaving headroom under the ~16 cap for anything else
 * on the page (standalone drawers, a playground viewer, a non-xOpat canvas).
 */
const DEFAULT_PRIVATE_CONTEXT_BUDGET = 6;

/** Owners currently holding a private slot, keyed by the viewer's cell id. */
const privateSlots = new Set<string>();

/** How many cells this deployment allows on private contexts. */
function privateContextBudget(): number {
    // Deployment knob, so no caller-supplied default: a literal here would outrank
    // the ENV `setup` block (AGENTS.md §3). The default lives in `src/config.json`.
    const configured = (globalThis as any).APPLICATION_CONTEXT?.getOption?.("webGlPrivateContextBudget");
    // "Not configured" must not read as "configured to zero": `Number(null)` and
    // `Number("")` are both 0, which would silently disable private contexts
    // everywhere the option is simply absent. An explicit 0 still disables them.
    if (configured === undefined || configured === null || configured === "") {
        return DEFAULT_PRIVATE_CONTEXT_BUDGET;
    }
    const value = Number(configured);
    if (!Number.isFinite(value) || value < 0) return DEFAULT_PRIVATE_CONTEXT_BUDGET;
    return Math.floor(value);
}

/**
 * The `sharedContextKey` for a viewer cell: `null` means a private context.
 *
 * Idempotent per `ownerId` — re-acquiring for a cell that already holds a slot
 * returns the same answer and does not consume a second one.
 */
export function acquireFlexContextKey(ownerId: string): string | null {
    if (!ownerId) return FLEX_SHARED_CONTEXT_KEY;
    if (privateSlots.has(ownerId)) return null;
    if (privateSlots.size >= privateContextBudget()) return FLEX_SHARED_CONTEXT_KEY;
    privateSlots.add(ownerId);
    return null;
}

/**
 * Give a cell's private slot back. Safe to call for a cell that never held one,
 * which is why viewer teardown can call it unconditionally.
 */
export function releaseFlexContextKey(ownerId: string): void {
    if (ownerId) privateSlots.delete(ownerId);
}

/** Whether this cell is on a private context — for diagnostics and tests. */
export function hasPrivateFlexContext(ownerId: string): boolean {
    return privateSlots.has(ownerId);
}

/** Slots in use / allowed. Diagnostics only. */
export function flexContextUsage(): { used: number; budget: number } {
    return { used: privateSlots.size, budget: privateContextBudget() };
}
