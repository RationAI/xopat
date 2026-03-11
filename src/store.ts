export type StorageSchemaElement = {
    _deprecated: Array<string> | undefined;
};

export type StorageSchema = Record<string, StorageSchemaElement>;

export type StorageOptions = {
    id: string;
    schema?: StorageSchema;
    strictSchema?: boolean;
};

/** Interface for synchronous storage (like localStorage) */
export interface StorageLike {
    readonly length: number;
    clear(): void;
    getItem(key: string): string | null;
    key(index: number): string | null;
    removeItem(key: string): void;
    setItem(key: string, value: string): void;
}

/** Interface for asynchronous storage */
export interface AsyncStorageLike {
    readonly length: Promise<number>;
    clear(): Promise<void>;
    getItem(key: string): Promise<any>;
    key(index: number): Promise<string | null>;
    removeItem(key: string): Promise<void>;
    setItem(key: string, value: string): Promise<void>;
}

export interface CookieStorageLike extends StorageLike {
    with(options: object): CookieStorageLike;
}

export class xoStorage {

    get length(): number {
        throw `${this.constructor.name}::length must be implemented!`;
    }
    clear(): void {
        throw `${this.constructor.name}::clear must be implemented!`;
    }

    getItem(key: string): any {
        throw `${this.constructor.name}::getItem must be implemented!`;
    }

    key(index: number): string {
        throw `${this.constructor.name}::key must be implemented!`;
    }
    removeItem(key: string): void {
        throw `${this.constructor.name}::removeItem must be implemented!`;
    }
    setItem(key: string, value: string): void {
        throw `${this.constructor.name}::setItem must be implemented!`;
    }
}

export class xoCookieStorage extends xoStorage {
    /**
     * Builder-pattern option setter for cookies storage.
     * Subsequent setItem calls must inherit these options.
     */
    with(options: object): xoCookieStorage {
        throw `${this.constructor.name}::setItem must be implemented!`;
    }
}

export class xoAsyncStorage {
    get length(): Promise<number> {
        throw `${this.constructor.name}::length must be implemented!`;
    }
    async clear(): Promise<void> {
        throw `${this.constructor.name}::clear must be implemented!`;
    }
    async getItem(key: string): Promise<any> {
        throw `${this.constructor.name}::getItem must be implemented!`;
    }
    async key(index: number): Promise<string> {
        throw `${this.constructor.name}::key must be implemented!`;
    }
    async removeItem(key: string): Promise<void> {
        throw `${this.constructor.name}::removeItem must be implemented!`;
    }
    async setItem(key: string, value: string): Promise<void> {
        throw `${this.constructor.name}::setItem must be implemented!`;
    }
}

const storageAPI = Object.keys(window.Storage.prototype);
function errInstanceApi(instance: object, keys: string[]): string | false {
    for (let key of keys) {
        if (!(key in instance)) return `method ${key} is not implemented!`;
    }
    return false;
}
function errClassApi(cls: Function, keys: string[]): string | false {
    cls = cls.prototype;
    for (let key of keys) {
        if (!(key in cls)) return `method ${key} is not implemented!`;
    }
    return false;
}

/**
 * Data Api Proxy Base Class. Private class.
 */
class APIProxy {
    protected __id: string;
    protected __storage: StorageLike | AsyncStorageLike;
    protected validateKey: (key: string, withSuffix?: boolean) => string;
    protected deprecatedKeys: (key: string) => string[];

    constructor(options: StorageOptions) {
        if (!options?.id && options.id !== "") {
            throw "Data Store: invalid configuration: missing options.id!";
        }

        const staticSelf = this.constructor as typeof APIProxy;
        if (!staticSelf._implementation) {
            throw "Data Store: invalid configuration: no implementation was registered for the storage!";
        }

        const uid = options.id;
        this.__id = (uid && !uid.endsWith(".")) ? (uid + ".") : uid;
        (this.constructor as typeof APIProxy)._used = true;

        this.__storage = staticSelf._implementsClass
            ? new (staticSelf._implementation as new () => StorageLike | AsyncStorageLike)()
            : staticSelf._implementation as StorageLike | AsyncStorageLike;
        const schema = options.schema;

        if (schema) {
            options.strictSchema = options.strictSchema ?? true;
            this.validateKey = (key, withSuffix = true) => {
                const ref = schema[key];
                if (ref) {
                    if (!key) return uid;
                    if (withSuffix) return this.__id + key;
                    return key;
                }
                if (options.strictSchema) {
                    throw `${this.constructor.name}: invalid schema key '${key}' for data '${options.id}' in a strict mode!`;
                }
                return key;
            }
        } else {
            this.validateKey = (key, withSuffix = true) => {
                if (!key) return uid;
                if (withSuffix) return this.__id + key;
                return key;
            };
        }

        if (schema) {
            this.deprecatedKeys = (key) => {
                // validateKey always called first
                const ref = schema[key];
                return ref && ref._deprecated || [];
            }
        } else {
            this.deprecatedKeys = (key) => [];
        }
    }

    get id(): string {
        return this.__id;
    }

    getStore(): StorageLike | AsyncStorageLike {
        return this.__storage;
    }

    static _implementation: (new () => StorageLike | AsyncStorageLike) | StorageLike | AsyncStorageLike | null = null;
    static _implementsClass = true;
    static _used = false;

    /**
     * Register a storage implementation for the particular data proxy.
     */
    static register(Class: new () => StorageLike | AsyncStorageLike): void {
        console.warn("Storage::register() is depreacted: use registerClass!");
        return this.registerClass(Class);
    }

    /**
     * Register a storage implementation for the particular data proxy.
     */
    static registerClass(Class: new () => StorageLike | AsyncStorageLike): void {
        if (this._used) throw "Cannot register a storage implementation after it had been already used!";
        const err = errClassApi(Class, storageAPI);
        if (err) throw `XOpatStorage.<*>:registerClass ${err} - ${Class}`;
        this._implementation = Class;
        this._implementsClass = true;
    }

    static registerInstance(instance: StorageLike | AsyncStorageLike): void {
        if (this._used) throw "Cannot register a storage implementation after it had been already used!";
        const err = errInstanceApi(instance, storageAPI);
        if (err) throw `XOpatStorage.<*>:registerInstance ${err} - ${instance}`;
        this._implementation = instance;
        this._implementsClass = false;
    }

    static registered(): boolean {
        return !!this._implementation;
    }
}

/**
 * Synchronous Data Generic API. Private class.
 */
class SyncAPIProxy extends APIProxy {
    constructor(options: StorageOptions) {
        super(options);
    }

    get(key: string, defaultValue: any = undefined): any {
        const store = this.__storage as Storage;
        let value: any = store.getItem(this.validateKey(key));

        if (value === undefined) {
            //todo not prefix deprecated keys? must be able to configure
            for (let dKey of this.deprecatedKeys(key)) {
                value = store.getItem(this.validateKey(dKey, false));
                if (value !== undefined) break;
            }
        }

        if (value === "false") value = false;
        else if (value === "true") value = true;
        if (defaultValue !== undefined) {
            return value === null || value === undefined ? defaultValue : value;
        }
        return value;
    }

    set(key: string, value: string): void {
        const store = this.__storage as Storage;
        key = this.validateKey(key);
        store.setItem(key, value);
    }

    delete(key: string): void {
        const store = this.__storage as Storage;
        key = this.validateKey(key);
        store.removeItem(key);
    }

    keys(): string[] {
        const store = this.__storage as Storage;
        return Array.from(Array(store.length).keys()).map(i => store.key(i) as string);
    }
}

/**
 * Asynchronous Data Generic API. Private class.
 */
class AsyncAPIProxy extends APIProxy {
    constructor(options: StorageOptions) {
        super(options);
    }

    async get(key: string, defaultValue: any = undefined): Promise<any> {
        const store = this.__storage as AsyncStorageLike;
        let value = await store.getItem(this.validateKey(key));
        if (value === undefined) {
            for (let dKey of this.deprecatedKeys(key)) {
                value = await store.getItem(this.validateKey(dKey, false));
                if (value !== undefined) break;
            }
        }

        if (value === "false") value = false;
        else if (value === "true") value = true;
        if (defaultValue !== undefined) {
            return value === null || value === undefined ? defaultValue : value;
        }
        return value;
    }

    async set(key: string, value: string): Promise<void> {
        const store = this.__storage as AsyncStorageLike;
        key = this.validateKey(key);
        await store.setItem(key, value);
    }

    async delete(key: string): Promise<void> {
        key = this.validateKey(key);
        await (this.__storage as AsyncStorageLike).removeItem(key);
    }

    async keys(): Promise<Array<string | null>> {
        const store = this.__storage as AsyncStorageLike;
        return Promise.all(Array.from(Array(await store.length).keys()).map(async i => await store.key(i)));
    }
}

/**
 * Storage Namespace for xOpat.
 * @namespace XOpatStorage
 */
export const XOpatStorage = {

    /**
     * Storage API replacement: window.Storage cannot be instantiated.
     * see https://developer.mozilla.org/en-US/docs/Web/API/Storage
     * @type {XOpatStorage.Storage}
     */
    Storage: xoStorage,

    /**
     * Storage API with extension for cookies.
     * This storage allows .with(...).setItem(...) syntax
     * to pass set options explicitly.
     */
    CookieStorage: xoCookieStorage,

    /**
     * Similar to Storage, AsyncStorage supports asynchronous storage interface.
     * see https://developer.mozilla.org/en-US/docs/Web/API/Storage
     * @type {XOpatStorage.AsyncStorage}
     * @memberOf XOpatStorage
     */
    AsyncStorage: xoAsyncStorage,

    /**
     * Data Interface for persistent storage of data items.
     *
     * This Data class is by default used to save plugin data within HTTP POST.
     * Apps should extend and use this class to store their data to desired endpoints.
     *
     * @type {XOpatStorage.Data}
     * @extends AsyncAPIProxy
     * @memberOf XOpatStorage
     */
    Data: class extends AsyncAPIProxy { },

    /**
     * Cache Interface for storage of configuration / metadata.
     * Cache is meant for cached user configuration and settings to avoid repetitive UI flows.
     *
     * This storage _can_ be persistent. This interface must be sync: if you use async server access,
     * make sure to e.g. prefetch the data in given context.
     *
     * The default implementation stores this data within browser local storage.
     * @type {XOpatStorage.Cache}
     * @extends SyncAPIProxy
     * @memberOf XOpatStorage
     */
    Cache: class extends SyncAPIProxy {
        /**
         * @param {any} key
         * @param {any} defaultValue returned only in case undefined would be returned
         * @return {any} value to store, or undefined in the default value is missing
         */
        get<T = any>(key: string, defaultValue: T | undefined = undefined): T | string | boolean | null | undefined {
            // !!! Without cache=false, this would be infinite loop getOption calls this method too
            if (!APPLICATION_CONTEXT.getOption("bypassCache", false, false)) {
                return super.get(key, defaultValue);
            }
            return defaultValue;
        }

        /**
         * @param {string} key
         * @param {string} value
         */
        set(key: string, value: string): void {
            // !!! Without cache=false, this would be infinite loop getOption calls this method too
            if (!APPLICATION_CONTEXT.getOption("bypassCache", false, false)) {
                super.set(key, value);
            }
        }
    },

    /**
     * Cookie Interface for storage of configuration / metadata.
     * Cookies should be used only when Cache cannot be used, e.g. ensuring
     * token security, or caching values only for certain amount of time.
     *
     * This storage is NOT persistent. This interface must be sync: if you use async server access,
     * make sure to e.g. prefetch the data in given context.
     *
     * Note that this class _should_ behave like common cookies, e.g. have expiration, share data on common domain/path etc.
     *
     * The default implementation stores this data within browser cookies.
     * @type {XOpatStorage.Cookies}
     * @extends SyncAPIProxy
     * @memberOf XOpatStorage
     */
    Cookies: class extends SyncAPIProxy {
        constructor(options: StorageOptions) {
            super(options); //allow also xoCookieStorage
        }

        /**
         * @param {any} key
         * @param {any} defaultValue returned only in case undefined would be returned
         * @return {any} value to store, or undefined in the default value is missing
         */
        get<T = any>(key: string, defaultValue: T | undefined = undefined): T | string | boolean | null | undefined {
            if (!APPLICATION_CONTEXT.getOption("bypassCookies", false, false)) {
                return super.get(key, defaultValue);
            }
            return defaultValue;
        }

        /**
         * Provide cookie setter with setting options
         * @param {object} options
         * @return XOpatStorage.Cookies
         */
        with(options: object): this {
            const storage = this.__storage as StorageLike & Partial<CookieStorageLike>;
            if (typeof storage.with === "function") {
                storage.with(options);
            } else {
                console.warn("Current cookie storage does not support with() option setter.");
                this.with = function () { return this; }; //register as no-op
            }
            return this;
        }

        /**
         * @param {string} key
         * @param {string} value
         */
        set(key: string, value: string): void {
            if (!APPLICATION_CONTEXT.getOption("bypassCookies", false, false)) {
                super.set(key, value);
            }
        }
    }
};

window.XOpatStorage = XOpatStorage;
