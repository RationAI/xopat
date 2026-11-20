/// <reference path="../../src/types/globals.d.ts" />
/**
 * Executes an action through the core scripting sandbox. The runner owns:
 * one scripting context per action, single-flight, the per-action timeout, and
 * the run record. It does NOT own permission: `core.scripting.run` is enforced
 * inside `executeScript` for every author, and namespace/action consents still
 * prompt (unless an operator marked a deployment action `bypassConsent`).
 */
import type { AnyAction } from "./schema";
import type { RunRecord } from "./store";
import { previewResult } from "./output";

export type Trigger = "quick" | "tools" | "context-menu" | "viewer-control" | "shortcut" | "panel" | "assistant";

export interface RunRequest {
    trigger: Trigger;
    /** The viewer the trigger happened on, when it knows one. */
    viewer?: any;
    /** Extra invocation data merged into the script's `input` (must be cloneable). */
    extra?: Record<string, unknown>;
    /**
     * Sensitive-data policy of whoever asked for the run. Unset for UI triggers: the
     * result is shown to the user only, so the user's own data is not masked. The
     * assistant path forwards its own context's policy so a run cannot launder data
     * the calling conversation may not see.
     */
    mayExposeSensitiveData?: () => boolean;
}

export type RunOutcome =
    | { ok: true; result: unknown; durationMs: number }
    | { ok: false; error: string; busy?: boolean; durationMs: number };

export class ActionRunner {
    private _running = new Set<string>();
    private _listeners = new Set<(id: string, running: boolean) => void>();

    constructor(private readonly onRecord: (id: string, run: RunRecord) => void) {}

    isRunning(id: string): boolean {
        return this._running.has(id);
    }

    onRunningChange(cb: (id: string, running: boolean) => void): () => void {
        this._listeners.add(cb);
        return () => this._listeners.delete(cb);
    }

    async run(action: AnyAction, request: RunRequest): Promise<RunOutcome> {
        const started = Date.now();
        if (this._running.has(action.id)) {
            return { ok: false, busy: true, error: "The action is already running.", durationMs: 0 };
        }

        const Scripting = (globalThis as any).APPLICATION_CONTEXT?.Scripting;
        if (!Scripting?.createContext) {
            return { ok: false, error: "Scripting is not available in this deployment.", durationMs: 0 };
        }

        const viewerId: string | undefined = request.viewer?.uniqueId;
        const context = Scripting.createContext({
            id: `user-actions:${action.id}`,
            label: action.label,
            metadata: { owner: "user-actions", actionId: action.id },
            activeViewerContextId: viewerId ?? null,
            bypassConsentDialog: action.source === "deployment" && action.bypassConsent === true,
        });
        context.setSensitiveDataResolver?.(request.mayExposeSensitiveData || null);

        const workerId = `user-actions-${action.id}-${started.toString(36)}`;
        const input = { trigger: request.trigger, actionId: action.id, viewerId: viewerId ?? null, ...(request.extra || {}) };

        this._setRunning(action.id, true);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const timeout = new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    try { context.abortScript(workerId); } catch (_) { /* already gone */ }
                    reject(new Error(`The action timed out after ${Math.round(action.timeoutMs / 1000)} s.`));
                }, action.timeoutMs);
            });
            const result = await Promise.race([context.executeScript(action.script, { workerId, input }), timeout]);
            const durationMs = Date.now() - started;
            this.onRecord(action.id, {
                at: started, ok: true, durationMs, trigger: request.trigger,
                resultPreview: previewResult(result),
            });
            return { ok: true, result, durationMs };
        } catch (e: any) {
            const durationMs = Date.now() - started;
            const error = String(e?.message || e || "Unknown error").slice(0, 2000);
            this.onRecord(action.id, { at: started, ok: false, durationMs, trigger: request.trigger, error });
            return { ok: false, error, durationMs };
        } finally {
            if (timer) clearTimeout(timer);
            context.setSensitiveDataResolver?.(null);
            this._setRunning(action.id, false);
        }
    }

    private _setRunning(id: string, running: boolean): void {
        if (running) this._running.add(id);
        else this._running.delete(id);
        for (const cb of [...this._listeners]) {
            try { cb(id, running); } catch (_) { /* listener failure must not break a run */ }
        }
    }
}
