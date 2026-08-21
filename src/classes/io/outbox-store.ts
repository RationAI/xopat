// OutboxStore — IndexedDB wrapper for the persistent outbox (Phase 10).
//
// Single database `xopat-io-outbox` (v1) with one object store `outbox`
// keyed by clientOpId. Indexes:
//   byOwnerResource — composite [ownerUid, resourceName] for fast per-resource scans on boot
//   byCreatedAt    — timestamp index for age-based eviction sweeps
//
// API used by IOResource: `add`, `remove`, `bumpAttempt`, `listForResource`,
// `count`, `pruneOlderThan`, `quotaSnapshot`. All async.
//
// Failure handling: open() resolves with `null` if IndexedDB is unavailable
// (private mode, very old browser). Callers degrade to in-memory queue.

export interface PersistedOutboxEntry {
    clientOpId: string;
    ownerUid: string;
    resourceName: string;
    direction: "create" | "update" | "delete";
    identity: string;
    itemId: string | undefined;
    serializedPayload: unknown;
    createdAt: number;
    attemptCount: number;
    rollbackOnAsyncRefuse: boolean;
    metaJson: string;
}

const DB_NAME = "xopat-io-outbox";
const DB_VERSION = 1;
const STORE = "outbox";
const IDX_OWNER_RESOURCE = "byOwnerResource";
const IDX_CREATED_AT = "byCreatedAt";

let _openPromise: Promise<OutboxStore | null> | null = null;

export class OutboxStore {
    private constructor(private readonly db: IDBDatabase) {}

    /** Singleton. Resolves with `null` if IndexedDB is unavailable. */
    static open(): Promise<OutboxStore | null> {
        if (_openPromise) return _openPromise;
        _openPromise = (async (): Promise<OutboxStore | null> => {
            try {
                // Inside the try on purpose: the bare `indexedDB` identifier
                // read throws `SecurityError` in a sandboxed iframe (opaque
                // origin), so the availability test cannot sit outside it.
                if (!XOpatStorageAvailability.indexedDB) return null;
                const db = await new Promise<IDBDatabase>((resolve, reject) => {
                    const req = indexedDB.open(DB_NAME, DB_VERSION);
                    req.onupgradeneeded = () => {
                        const db = req.result;
                        if (!db.objectStoreNames.contains(STORE)) {
                            const os = db.createObjectStore(STORE, { keyPath: "clientOpId" });
                            os.createIndex(IDX_OWNER_RESOURCE, ["ownerUid", "resourceName"], { unique: false });
                            os.createIndex(IDX_CREATED_AT, "createdAt", { unique: false });
                        }
                    };
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
                });
                db.onversionchange = () => { try { db.close(); } catch {} };
                return new OutboxStore(db);
            } catch (e: any) {
                // Feed the verdict back into the canonical probe: `probeIndexedDB`
                // can only test that the identifier exists, and the throw site is
                // `open()` — so without this, every other consumer keeps being told
                // IndexedDB is available and rediscovers otherwise the hard way.
                XOpatStorageAvailability.recordFailure?.("indexedDB", e);
                // `info`, not `warn`: a sandboxed iframe on an opaque origin is a
                // supported deployment (the EMPAIA Workbench embedding), not a
                // fault. Durability is lost; correctness is not — the outbox stays
                // in memory and every op still dispatches. Listeners that need to
                // know get `io:outbox-unavailable` with the resource named.
                console.info("[IO] OutboxStore: IndexedDB unavailable, persistent outbox disabled "
                    + `(${e?.name || e}). Pending writes will not survive a reload.`);
                return null;
            }
        })();
        return _openPromise;
    }

    private tx(mode: IDBTransactionMode): { tx: IDBTransaction; store: IDBObjectStore } {
        const tx = this.db.transaction(STORE, mode);
        return { tx, store: tx.objectStore(STORE) };
    }

    private wrap<T>(req: IDBRequest<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    add(entry: PersistedOutboxEntry): Promise<void> {
        const { store } = this.tx("readwrite");
        return this.wrap(store.put(entry)) as unknown as Promise<void>;
    }

    remove(clientOpId: string): Promise<void> {
        const { store } = this.tx("readwrite");
        return this.wrap(store.delete(clientOpId)) as unknown as Promise<void>;
    }

    async bumpAttempt(clientOpId: string): Promise<void> {
        const { store } = this.tx("readwrite");
        const cur = await this.wrap(store.get(clientOpId)) as PersistedOutboxEntry | undefined;
        if (!cur) return;
        cur.attemptCount = (cur.attemptCount | 0) + 1;
        await this.wrap(store.put(cur));
    }

    async update(clientOpId: string, patch: Partial<PersistedOutboxEntry>): Promise<void> {
        const { store } = this.tx("readwrite");
        const cur = await this.wrap(store.get(clientOpId)) as PersistedOutboxEntry | undefined;
        if (!cur) return;
        Object.assign(cur, patch);
        await this.wrap(store.put(cur));
    }

    async listForResource(ownerUid: string, resourceName: string): Promise<PersistedOutboxEntry[]> {
        const { store } = this.tx("readonly");
        const idx = store.index(IDX_OWNER_RESOURCE);
        const range = IDBKeyRange.only([ownerUid, resourceName]);
        const items = await this.wrap(idx.getAll(range) as IDBRequest<PersistedOutboxEntry[]>);
        items.sort((a, b) => a.createdAt - b.createdAt);
        return items;
    }

    async count(): Promise<number>;
    async count(ownerUid: string, resourceName: string): Promise<number>;
    async count(ownerUid?: string, resourceName?: string): Promise<number> {
        const { store } = this.tx("readonly");
        if (ownerUid !== undefined && resourceName !== undefined) {
            const idx = store.index(IDX_OWNER_RESOURCE);
            return await this.wrap(idx.count(IDBKeyRange.only([ownerUid, resourceName])));
        }
        return await this.wrap(store.count());
    }

    /** Remove entries with createdAt < threshold. Returns count pruned. */
    async pruneOlderThan(thresholdMs: number): Promise<number> {
        const { store } = this.tx("readwrite");
        const idx = store.index(IDX_CREATED_AT);
        const range = IDBKeyRange.upperBound(thresholdMs, /* open */ true);
        let pruned = 0;
        return await new Promise<number>((resolve, reject) => {
            const cur = idx.openCursor(range);
            cur.onerror = () => reject(cur.error);
            cur.onsuccess = () => {
                const c = cur.result;
                if (!c) { resolve(pruned); return; }
                c.delete();
                pruned++;
                c.continue();
            };
        });
    }

    async quotaSnapshot(): Promise<{ usage: number; quota: number } | null> {
        try {
            const nav: any = (globalThis as any).navigator;
            if (!nav?.storage?.estimate) return null;
            const e = await nav.storage.estimate();
            if (typeof e?.usage !== "number" || typeof e?.quota !== "number") return null;
            return { usage: e.usage, quota: e.quota };
        } catch {
            return null;
        }
    }
}
