/**
 * Two sources, one view:
 *  - deployment actions: operator config (include.json ⊕ ENV.modules["user-actions"].actions),
 *    read once via getStaticMeta, never written;
 *  - user actions: the user's own (or assistant-proposed, user-approved) records in a
 *    deployment-scoped `kv:actions` namespace.
 *
 * Deliberately NOT a source: getOption / session config / POST_DATA / IO bundles. Those are
 * third-party controllable, and an executable payload there would be stored XSS by another
 * name (AGENTS.md §7). Imports from a file land disabled and unapproved.
 */
import {
    ActionLimits, ActionSpec, AnyAction, DeploymentAction, UserAction, ActionOrigin,
    validateAction, ValidationIssue, needsApproval, toSpec,
} from "./schema";

export interface RunRecord {
    at: number;
    ok: boolean;
    durationMs: number;
    trigger: string;
    error?: string;
    resultPreview?: string;
}

/** Minimal async KV surface (IOKVHandle in async mode). */
export interface AsyncKV {
    get(key: string, defaultValue?: unknown): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
}

export interface StoreLogger {
    warn(message: string, data?: unknown): void;
}

const ACTIONS_KEY = "actions";
const RUNS_KEY = "runs";
const RUNS_PER_ACTION = 5;

export type SaveOutcome =
    | { ok: true; action: UserAction; approvalRequired: boolean }
    | { ok: false; errors: ValidationIssue[] };

export class ActionStore {
    private _deployment = new Map<string, DeploymentAction>();
    private _user = new Map<string, UserAction>();
    private _runs = new Map<string, RunRecord[]>();
    private _listeners = new Set<() => void>();
    private _writeChain: Promise<void> = Promise.resolve();

    constructor(
        private readonly kv: AsyncKV | null,
        private readonly limits: ActionLimits,
        private readonly maxUserActions: number,
        private readonly log: StoreLogger,
    ) {}

    loadDeployment(raw: unknown, language?: string): void {
        this._deployment.clear();
        if (raw === undefined || raw === null) return;
        if (!Array.isArray(raw)) {
            this.log.warn("deployment 'actions' must be an array; ignored");
            return;
        }
        for (const entry of raw) {
            const result = validateAction(entry, { trust: "deployment", limits: this.limits, language });
            if (!result.ok) {
                this.log.warn("invalid deployment action skipped", { id: (entry as any)?.id, errors: result.errors });
                continue;
            }
            const action = result.value as DeploymentAction;
            if (this._deployment.has(action.id)) {
                this.log.warn("duplicate deployment action id skipped", { id: action.id });
                continue;
            }
            this._deployment.set(action.id, action);
        }
    }

    async loadUser(): Promise<void> {
        this._user.clear();
        this._runs.clear();
        if (!this.kv) return;
        const stored = await this.kv.get(ACTIONS_KEY, []);
        if (Array.isArray(stored)) {
            for (const entry of stored) {
                const result = validateAction(entry, { trust: "user", limits: this.limits });
                if (!result.ok) {
                    this.log.warn("stored user action dropped", { id: (entry as any)?.id, errors: result.errors });
                    continue;
                }
                const action = result.value as UserAction;
                // A deployment action owns its id; a stored duplicate is shadowed, not merged.
                if (!this._deployment.has(action.id)) this._user.set(action.id, action);
            }
        }
        const runs = await this.kv.get(RUNS_KEY, {});
        if (runs && typeof runs === "object" && !Array.isArray(runs)) {
            for (const [id, list] of Object.entries(runs as Record<string, unknown>)) {
                if (Array.isArray(list)) this._runs.set(id, list.filter(isRunRecord).slice(-RUNS_PER_ACTION));
            }
        }
        this._emit();
    }

    onChange(cb: () => void): () => void {
        this._listeners.add(cb);
        return () => this._listeners.delete(cb);
    }

    list(): AnyAction[] {
        return [...this._deployment.values(), ...this._user.values()];
    }

    get(id: string): AnyAction | undefined {
        return this._deployment.get(id) || this._user.get(id);
    }

    isDeployment(id: string): boolean {
        return this._deployment.has(id);
    }

    runs(id: string): RunRecord[] {
        return [...(this._runs.get(id) || [])];
    }

    lastRun(id: string): RunRecord | undefined {
        const list = this._runs.get(id);
        return list?.[list.length - 1];
    }

    /**
     * Validate a proposed spec as a user record. Does not persist. `approvalRequired`
     * is true when the executable surface changed against the stored version.
     */
    prepare(spec: unknown, origin: ActionOrigin): SaveOutcome {
        const id = (spec as any)?.id;
        if (typeof id === "string" && this._deployment.has(id)) {
            return { ok: false, errors: [{ field: "id", code: "reservedId",
                message: `'${id}' is provided by the deployment and cannot be changed; choose another id.` }] };
        }
        const previous = typeof id === "string" ? this._user.get(id) : undefined;
        if (!previous && this._user.size >= this.maxUserActions) {
            return { ok: false, errors: [{ field: "", code: "tooManyActions",
                message: `At most ${this.maxUserActions} actions can be saved.` }] };
        }
        const now = Date.now();
        const result = validateAction({
            ...(spec as object),
            origin: previous?.origin === "user" ? "user" : origin,
            createdAt: previous?.createdAt ?? now,
            updatedAt: now,
            revision: previous?.revision ?? 1,
            approvedRevision: previous?.approvedRevision ?? null,
        }, { trust: "user", limits: this.limits });
        if (!result.ok) return result;
        const next = result.value as UserAction;
        const approvalRequired = needsApproval(previous ? toSpec(previous) : undefined, toSpec(next));
        if (previous && approvalRequired) next.revision = previous.revision + 1;
        return { ok: true, action: next, approvalRequired };
    }

    /** Persist a prepared record; `approved` stamps the current revision as approved. */
    async commit(action: UserAction, approved: boolean): Promise<UserAction> {
        const record: UserAction = { ...action, approvedRevision: approved ? action.revision : action.approvedRevision };
        this._user.set(record.id, record);
        await this._persistActions();
        this._emit();
        return record;
    }

    async setEnabled(id: string, enabled: boolean): Promise<boolean> {
        const action = this._user.get(id);
        if (!action) return false;
        this._user.set(id, { ...action, enabled, updatedAt: Date.now() });
        await this._persistActions();
        this._emit();
        return true;
    }

    async remove(id: string): Promise<boolean> {
        if (!this._user.delete(id)) return false;
        this._runs.delete(id);
        await this._persistActions();
        await this._persistRuns();
        this._emit();
        return true;
    }

    async recordRun(id: string, run: RunRecord): Promise<void> {
        const list = this._runs.get(id) || [];
        list.push(run);
        this._runs.set(id, list.slice(-RUNS_PER_ACTION));
        await this._persistRuns();
        this._emit();
    }

    private _persistActions(): Promise<void> {
        // `source` is implied by where a record lives; the closed schema rejects it on reload.
        const snapshot = [...this._user.values()].map(({ source, ...record }) => record);
        return this._enqueue(() => this.kv?.set(ACTIONS_KEY, snapshot));
    }

    private _persistRuns(): Promise<void> {
        const snapshot: Record<string, RunRecord[]> = {};
        for (const [id, list] of this._runs) if (this.get(id)) snapshot[id] = list;
        return this._enqueue(() => this.kv?.set(RUNS_KEY, snapshot));
    }

    /** Serialize writes so a slow async driver cannot reorder two snapshots. */
    private _enqueue(write: () => Promise<void> | undefined): Promise<void> {
        const next = this._writeChain.then(() => write()).catch(e => this.log.warn("persist failed", e));
        this._writeChain = next.then(() => undefined);
        return next as Promise<void>;
    }

    private _emit(): void {
        for (const cb of [...this._listeners]) {
            try { cb(); } catch (e) { this.log.warn("store listener failed", e); }
        }
    }
}

function isRunRecord(v: unknown): v is RunRecord {
    const r = v as RunRecord;
    return !!r && typeof r === "object" && typeof r.at === "number" && typeof r.ok === "boolean";
}

export type { ActionSpec };
