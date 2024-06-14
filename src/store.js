(function ($) {
/**
 * @typedef {{
 *  _deprecated?: Array<string>
 * }} XOpatStorage.SchemaElement
 *
 * @typedef {Object.<string, XOpatStorage.SchemaElement>} XOpatStorage.Schema
 *
 * @typedef {{
 *  id: string,
 *  schema?: XOpatStorage.Schema,
 *  strictSchema?: boolean
 * }} XOpatStorage.StorageOptions
 */


class xoStorage {
    /**
     * @returns number
     */
    get length() {
        throw `${this.constructor.name}::length must be implemented!`;
    }
    clear() {
        throw `${this.constructor.name}::clear must be implemented!`;
    }
    /**
     * @returns any
     */
    getItem(key) {
        throw `${this.constructor.name}::getItem must be implemented!`;
    }
    /**
     * @returns string
     */
    key(index) {
        throw `${this.constructor.name}::key must be implemented!`;
    }
    removeItem(key) {
        throw `${this.constructor.name}::removeItem must be implemented!`;
    }
    setItem(key, value) {
        throw `${this.constructor.name}::setItem must be implemented!`;
    }
}

class xoCookieStorage extends xoStorage {
    /**
     * Builder-pattern option setter for cookies storage.
     * Subsequent setItem calls must inherit these options.
     * @param {object} options
     * @returns xoCookieStorage
     */
    with(options) {
        throw `${this.constructor.name}::setItem must be implemented!`;
    }
}

class xoAsyncStorage {
    /**
     * @returns Promise<number>
     */
    get length() {
        throw `${this.constructor.name}::length must be implemented!`;
    }
    /**
     * @returns Promise<void>
     */
    async clear() {
        throw `${this.constructor.name}::clear must be implemented!`;
    }
    /**
     * @returns Promise<any>
     */
    async getItem(key) {
        throw `${this.constructor.name}::getItem must be implemented!`;
    }
    /**
     * @returns Promise<string>
     */
    async key(index) {
        throw `${this.constructor.name}::key must be implemented!`;
    }
    /**
     * @returns Promise<void>
     */
    async removeItem(key) {
        throw `${this.constructor.name}::removeItem must be implemented!`;
    }
    /**
     * @returns Promise<void>
     */
    async setItem(key, value) {
        throw `${this.constructor.name}::setItem must be implemented!`;
    }
}

const storageAPI = Object.keys(window.Storage.prototype);
function errInstanceApi(instance, keys) {
    for (let key of keys) {
        if (!key in instance) return `method ${key} is not implemented!`;
    }
    return false;
}
function errClassApi(cls, keys) {
    for (let key of keys) {
        if (!key in cls) return `method ${key} is not implemented!`;
    }
    return false;
}

/**
 * Data Api Proxy Base Class. Private class.
 */
class APIProxy {

    /**
     * @param {XOpatStorage.StorageOptions} options
     */
    constructor(options) {
        if (!options?.id && options.id !== "") {
            throw "Data Store: invalid configuration: missing options.id!";
        }

        const staticSelf = this.constructor;
        if (!staticSelf._implementation) {
            throw "Data Store: invalid configuration: no implementation was registered for the storage!";
        }

        const uid = options.id;
        this.__id = (uid && !uid.endsWith(".")) ? (uid+".") : uid;
        this.constructor._used = true;

        this.__storage = staticSelf._implementsClass ? new staticSelf._implementation() : staticSelf._implementation;
        const schema = options.schema;

        if (schema) {
            options.strictSchema = options.strictSchema ?? true;
            this.validateKey = (key, withSuffix=true) => {
                const ref = schema[key];
                if (ref) {
                    if (!key) return uid;
                    if (withSuffix) return uid + key;
                    return key;
                }
                if (options.strictSchema) {
                    throw `${this.constructor.name}: invalid schema key '${key}' for data '${options.id}' in a strict mode!`;
                }
            }
        } else {
            this.validateKey = (key, withSuffix=true) => {
                if (!key) return uid;
                if (withSuffix) return uid + key;
                return key;
            };
        }

        if (schema) {
            this.deprecatedKeys = (key) => {
                // validateKey always called first
                const ref = schema[key];
                return ref._deprecated || [];
            }
        } else {
            this.deprecatedKeys = (key) => [];
        }
    }

    get id() {
        return this.__id;
    }

    getStore() {
        return this.__storage;
    }

    static _implementation = null;
    static _implementsClass = true;
    static _used = false;

    /**
     * Register a storage implementation for the particular data proxy.
     * @param {function(new:Storage)|function(new:AsyncStorage)} Class
     */
    static register(Class) {
        console.warn("Storage::register() is depreacted: use registerClass!");
        return this.registerClass(Class);
    }

    /**
     * Register a storage implementation for the particular data proxy.
     * @param {function(new:Storage)|function(new:AsyncStorage)} Class
     */
    static registerClass(Class) {
        if (this._used) throw "Cannot register a storage implementation after it had been already used!";
        const err = errClassApi(Class, storageAPI);
        if (err) throw `XOpatStorage.<*>:registerClass ${err} - ${Class}`;
        this._implementation = Class;
        this._implementsClass = true;
    }

    static registerInstance(instance) {
        if (this._used) throw "Cannot register a storage implementation after it had been already used!";
        const err = errInstanceApi(instance, storageAPI);
        if (err) throw `XOpatStorage.<*>:registerInstance ${err} - ${instance}`;
        this._implementation = instance;
        this._implementsClass = false;
    }

    static registered() {
        return !!this._implementation;
    }
}

/**
 * Synchronous Data Generic API. Private class.
 * @extends APIProxy
 * @private
 */
class SyncAPIProxy extends APIProxy {
    constructor(options) {
        super(options);
    }

    /**
     *
     * @param {any} key
     * @param {any} defaultValue returned only in case undefined would be returned
     * @return {*|undefined} value to store, or undefined in the default value is missing
     */
    get(key, defaultValue=undefined) {
        let value = this.__storage.getItem(this.validateKey(key));

        if (value === undefined) {
            //todo not prefix deprecated keys? must be able to configure
            for (let dKey of this.deprecatedKeys(key)) {
                value = this.__storage.getItem(this.validateKey(dKey, false));
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

    /**
     * @param {string} key
     * @param {string} value
     */
    set(key, value) {
        key = this.validateKey(key);
        this.__storage.setItem(key, value);
    }

    /**
     * @param {string} key
     * @param key
     */
    delete(key) {
        key = this.validateKey(key);
        this.__storage.removeItem(key);
    }
}

/**
 * Asynchronous Data Generic API. Private class.
 * @extends APIProxy
 * @private
 */
class AsyncAPIProxy extends APIProxy {
    constructor(options) {
        super(options);
    }

    /**
     *
     * @param {any} key
     * @param {any} defaultValue returned only in case undefined would be returned
     * @return {Promise<*|undefined>} value to store, or undefined in the default value is missing
     */
    async get(key, defaultValue=undefined) {
        let value = await this.__storage.getItem(this.validateKey(key));
        if (value === undefined) {
            for (let dKey of this.deprecatedKeys(key)) {
                value = await this.__storage.getItem(this.validateKey(dKey, false));
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

    /**
     * @param {string} key
     * @param {string} value
     * @return Promise<void>
     */
    async set(key, value) {
        key = this.validateKey(key);
        await this.__storage.setItem(key, value);
    }

    /**
     * @param {string} key
     * @param key
     */
    async delete(key) {
        key = this.validateKey(key);
        await this.__storage.removeItem(key);
    }
}


/**
 * Storage Namespace for xOpat.
 * @namespace XOpatStorage
 */
$.XOpatStorage = {

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
    Data: class extends AsyncAPIProxy {},

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
        get(key, defaultValue=undefined) {
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
        set(key, value) {
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
        constructor(options) {
            super(options, xoCookieStorage); //allow also xoCookieStorage
        }

        /**
         * @param {any} key
         * @param {any} defaultValue returned only in case undefined would be returned
         * @return {any} value to store, or undefined in the default value is missing
         */
        get(key, defaultValue=undefined) {
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
        with(options) {
            if (typeof this.__storage.with === "function") {
                this.__storage.with(options);
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
        set(key, value) {
            if (!APPLICATION_CONTEXT.getOption("bypassCookies", false, false)) {
                super.set(key, value);
            }
        }
    }
}

})(window);
