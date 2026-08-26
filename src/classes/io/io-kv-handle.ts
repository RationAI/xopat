// KV handles — the wrapper returned by `IO_PIPELINE.kv(...)` that fronts
// one or more KV drivers, applies key prefixing on shared drivers, and
// preserves the XOpatStorage.Cache `get(key, defaultValue)` semantics
// (string-to-boolean coercion, default-value fallback).
//
// Multiple drivers per binding behave like a write-through cache:
//   - `setItem` / `removeItem` / `clear` mirror to every driver in order
//   - `getItem` tries each driver until one returns a non-null value
//
// `IOPipeline` is the only thing that imports this file.

import type { IOPipeline } from "./io-pipeline";

/**
 * Marker for a JSON-encoded value. `` cannot appear in a cookie value
 * The prefix opens with U+0001: no application string starts with a control
 * character, so a value that merely *looks* like JSON is never mis-parsed.
 * Cookies percent-escape it (`%01`) and decode it back, so the marker survives
 * every driver.
 */
const JSON_ENVELOPE = "json:";

/**
 * What `String(object)` produced before the envelope existed. Such entries
 * carry no recoverable information; reads treat them as absent and drop them
 * rather than handing a caller a string where it expects an object.
 */
const POISON_VALUE = "[object Object]";
const POISON = Symbol("kv-poison");

interface KVHandleOptions {
    pipeline: IOPipeline;
    ownerUid: string;
    ownerId: string;
    xoType: "core" | "plugin" | "module";
    capabilityId: string;
    drivers: IOKVDriver[];
}

abstract class BaseKVHandle {
    readonly ownerUid: string;
    readonly capabilityId: string;
    protected readonly pipeline: IOPipeline;
    protected readonly ownerId: string;
    protected readonly xoType: "core" | "plugin" | "module";
    protected readonly drivers: IOKVDriver[];

    constructor(o: KVHandleOptions) {
        this.pipeline = o.pipeline;
        this.ownerUid = o.ownerUid;
        this.ownerId = o.ownerId;
        this.xoType = o.xoType;
        this.capabilityId = o.capabilityId;
        this.drivers = o.drivers;
    }

    protected makeContext(direction: IODirection): IOContext {
        return {
            direction,
            capabilityId: this.capabilityId,
            xoType: this.xoType,
            ownerUid: this.ownerUid,
            ownerId: this.ownerId,
            key: "",
            meta: {},
        };
    }

    /**
     * Resolve the on-driver key. Shared drivers get
     * `<ownerUid>::<sanitized>`; owned drivers pass through unchanged
     * (modulo sanitization).
     */
    protected driverKey(driver: IOKVDriver, userKey: string): string {
        const sanitized = this.pipeline.sanitizeKey(userKey);
        if (driver.shared !== false) return `${this.ownerUid}::${sanitized}`;
        return sanitized;
    }

    /** Coerce stringified booleans (matches legacy XOpatStorage.Cache.get). */
    protected coerce(value: any): any {
        if (value === "false") return false;
        if (value === "true") return true;
        return value;
    }

    /**
     * Encode a `set(key, value)` argument for a string-only backend.
     *
     * Strings, numbers and booleans keep their historical encoding, so every
     * value already in a user's storage — and every reader doing
     * `parseInt(cached)` or comparing against `"true"` — is unaffected.
     * Everything else gets an explicit envelope: `String(object)` used to be
     * applied here, which wrote the literal `"[object Object]"` and destroyed
     * the value. The sentinel is explicit rather than a `{`/`[` heuristic
     * because a user string that happens to start with a brace must stay a
     * string.
     *
     * Returns `null` when the caller asked to store `undefined` — the handle
     * deletes the key instead of writing the string "undefined".
     */
    protected encode(value: any): string | null {
        if (value === undefined) return null;
        const t = typeof value;
        if (t === "string") return value as string;
        if (t === "number" || t === "boolean") return String(value);
        return JSON_ENVELOPE + JSON.stringify(value);
    }

    /** Inverse of `encode`, plus disposal of pre-fix poison values. */
    protected decode(raw: any): any {
        if (typeof raw !== "string") return raw;
        if (raw === POISON_VALUE) return POISON;
        if (raw.startsWith(JSON_ENVELOPE)) {
            try {
                return JSON.parse(raw.slice(JSON_ENVELOPE.length));
            } catch (e) {
                // Truncated write (quota) — the entry is unusable either way.
                return null;
            }
        }
        return this.coerce(raw);
    }

    protected ctxFor(driver: IOKVDriver, ctx: IOContext): IOContext | undefined {
        return driver.contextAware ? ctx : undefined;
    }
}

// ── Sync handle ────────────────────────────────────────────────────────────

export class SyncKVHandle extends BaseKVHandle implements IOKVHandle {
    readonly mode = "sync" as const;

    getItem(key: string): string | null {
        const ctx = this.makeContext("kv-get");
        for (const d of this.drivers) {
            const v = d.getItem(this.driverKey(d, key), this.ctxFor(d, ctx)) as string | null | undefined;
            if (v !== null && v !== undefined) return v;
        }
        return null;
    }

    setItem(key: string, value: string): void {
        const ctx = this.makeContext("kv-set");
        for (const d of this.drivers) {
            d.setItem(this.driverKey(d, key), value, this.ctxFor(d, ctx));
        }
    }

    removeItem(key: string): void {
        const ctx = this.makeContext("kv-delete");
        for (const d of this.drivers) {
            d.removeItem(this.driverKey(d, key), this.ctxFor(d, ctx));
        }
    }

    clear(): void {
        const ctx = this.makeContext("kv-clear");
        for (const d of this.drivers) {
            // For shared drivers we cannot blanket-clear (would wipe other
            // owners). Walk our own keys and remove them individually.
            if (d.shared !== false) {
                const prefix = `${this.ownerUid}::`;
                const len = (d.length as number) | 0;
                const ours: string[] = [];
                for (let i = 0; i < len; i++) {
                    const k = d.key(i, this.ctxFor(d, ctx)) as string | null;
                    if (k && k.startsWith(prefix)) ours.push(k);
                }
                for (const k of ours) d.removeItem(k, this.ctxFor(d, ctx));
            } else {
                d.clear(this.ctxFor(d, ctx));
            }
        }
    }

    keys(): string[] {
        const ctx = this.makeContext("kv-keys");
        const out = new Set<string>();
        for (const d of this.drivers) {
            const len = (d.length as number) | 0;
            for (let i = 0; i < len; i++) {
                const raw = d.key(i, this.ctxFor(d, ctx)) as string | null;
                if (!raw) continue;
                if (d.shared !== false) {
                    const prefix = `${this.ownerUid}::`;
                    if (raw.startsWith(prefix)) out.add(raw.slice(prefix.length));
                } else {
                    out.add(raw);
                }
            }
        }
        return Array.from(out);
    }

    // xOpat conveniences
    get<T = any>(key: string, defaultValue?: T): T | string | boolean | null {
        let v = this.decode(this.getItem(key));
        if (v === POISON) {
            this.removeItem(key);
            v = null;
        }
        if (defaultValue !== undefined) return v === null || v === undefined ? defaultValue : v;
        return v;
    }
    set(key: string, value: any): void {
        const encoded = this.encode(value);
        if (encoded === null) this.removeItem(key);
        else this.setItem(key, encoded);
    }
    delete(key: string): void { this.removeItem(key); }
}

// ── Async handle ───────────────────────────────────────────────────────────

export class AsyncKVHandle extends BaseKVHandle implements IOKVHandle {
    readonly mode = "async" as const;

    async getItem(key: string): Promise<string | null> {
        const ctx = this.makeContext("kv-get");
        for (const d of this.drivers) {
            const v = await Promise.resolve(d.getItem(this.driverKey(d, key), this.ctxFor(d, ctx)));
            if (v !== null && v !== undefined) return v as string;
        }
        return null;
    }

    async setItem(key: string, value: string): Promise<void> {
        const ctx = this.makeContext("kv-set");
        for (const d of this.drivers) {
            await Promise.resolve(d.setItem(this.driverKey(d, key), value, this.ctxFor(d, ctx)));
        }
    }

    async removeItem(key: string): Promise<void> {
        const ctx = this.makeContext("kv-delete");
        for (const d of this.drivers) {
            await Promise.resolve(d.removeItem(this.driverKey(d, key), this.ctxFor(d, ctx)));
        }
    }

    async clear(): Promise<void> {
        const ctx = this.makeContext("kv-clear");
        for (const d of this.drivers) {
            if (d.shared !== false) {
                const prefix = `${this.ownerUid}::`;
                const len = (await Promise.resolve(d.length as number | Promise<number>)) as number;
                const ours: string[] = [];
                for (let i = 0; i < len; i++) {
                    const k = await Promise.resolve(d.key(i, this.ctxFor(d, ctx))) as string | null;
                    if (k && k.startsWith(prefix)) ours.push(k);
                }
                for (const k of ours) await Promise.resolve(d.removeItem(k, this.ctxFor(d, ctx)));
            } else {
                await Promise.resolve(d.clear(this.ctxFor(d, ctx)));
            }
        }
    }

    async keys(): Promise<string[]> {
        const ctx = this.makeContext("kv-keys");
        const out = new Set<string>();
        for (const d of this.drivers) {
            const len = (await Promise.resolve(d.length as number | Promise<number>)) as number;
            for (let i = 0; i < len; i++) {
                const raw = await Promise.resolve(d.key(i, this.ctxFor(d, ctx))) as string | null;
                if (!raw) continue;
                if (d.shared !== false) {
                    const prefix = `${this.ownerUid}::`;
                    if (raw.startsWith(prefix)) out.add(raw.slice(prefix.length));
                } else {
                    out.add(raw);
                }
            }
        }
        return Array.from(out);
    }

    async get<T = any>(key: string, defaultValue?: T): Promise<T | string | boolean | null> {
        let v = this.decode(await this.getItem(key));
        if (v === POISON) {
            await this.removeItem(key);
            v = null;
        }
        if (defaultValue !== undefined) return v === null || v === undefined ? defaultValue : v;
        return v;
    }
    async set(key: string, value: any): Promise<void> {
        const encoded = this.encode(value);
        if (encoded === null) await this.removeItem(key);
        else await this.setItem(key, encoded);
    }
    async delete(key: string): Promise<void> { await this.removeItem(key); }
}
