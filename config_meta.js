// The metadata is in the viewer handled by a common interface:
//   global UTILITIES.fetchJSON automatically adds metadata provided to by the viewer in config
//   this class defines how the metadata is parsed so that your system can easily use its own structure

/**
 * todo allow using arrays...
 * todo include some WSI meta
 * Metadata scheme supported by the viewer (and where to fetch them)
 */
window.xOpatSchema = {
    user: {
        _getter: "user",
        _description: "User Data Object",

        id: {
            _getter: "user.name",
            _description: "Unique user ID",
        },

        name: {
            _getter: "user.name",
            _description: "User Name",
        },

        password: {
            _getter: "user.password",
            _description: "User Password",
            _private: true,
        }
    }
};
/**
 * Common API for metadata interpreting in the viewer.
 * Define what structure your metadata has, the system as of now
 * wants to access 'session ID', 'user data' and 'date'
 *
 *  1) send ANY structure
 *      - do not send any sensitive data
 *  2) implement interpretation in MetaStore
 *  3) use UTILITIES.fetch[...](), by default it attaches all the meta, or select sub-set
 * @class MetaStore
 */
class MetaStore {

    static getStore(object, scheme) {
        const m = new MetaStore({}, false);
        m.set(scheme, object);
        return m;
    }

    static key(schemeKey) {
        return schemeKey._getter.split(".").pop();
    }

    /*****************************************
     ******************* API *****************
     ****************************************/

    /**
     * Implements both JSON Configuration and Persistent (see below) metadata service API
     * @param {Object} data data to interpret
     * @param {boolean} safe
     * @return {null}
     */
    constructor(data, safe=true) {
        //values here get exported and imported
        this._data = data;
        //values here are private to the session
        this._privateData = {};
        this._safe = safe;
    }

    /**
     * initializes 'persistent' getter
     * @param persistentServiceUrl
     */
    initPersistentStore(persistentServiceUrl) {
        if (persistentServiceUrl) {
            const user = this.get(xOpatSchema.user);

            if (user) { //todo authorization? user url can be hacked :/
                const service = new MetaStore.Persistent(persistentServiceUrl, user);
                this.persistent = function () {
                    return service.instance();
                }
            }
        }
    }

    /**
     * A Common API for system info to query their own metadata
     * @param schemeKey
     * @param defaultValue
     * @param context
     * @return {*}
     */
    get(schemeKey, defaultValue, context=this._data) {
        let keys = this._getKey(schemeKey);
        let value;

        if (typeof keys === "string") {
            value = this._privateData[keys];
        } else {
            const parent = this._find(context, keys, false);
            if (!parent) {
                console.warn("Invalid MetaStore::set() with key list '[" + keys.join(",") + "']");
                return undefined;
            }
            const lastKey = keys.pop();
            value = parent[lastKey];
        }
        if (value === undefined) return defaultValue;
        if (value === "false") value = false;
        if (value === "true") value = true;
        return value;
    }

    /**
     * A Common API for system info to query their own metadata
     * @param schemeKey
     * @param value
     * @param context
     */
    set(schemeKey, value, context=this._data) {
        //todo possibly verify if setting object (e.g. user) of multiple values that the scheme fits
        // the description
        let keys = this._getKey(schemeKey);
        if (value === "false") value = false;
        else if (value === "true") value = true;

        if (typeof keys === "string") {
            this._privateData[keys] = value;
        } else {
            const parent = this._find(context, keys, true);
            if (!parent) {
                console.warn("Invalid MetaStore::set() with key list '[" + keys.join(",") + "']");
                return undefined;
            }
            const lastKey = keys.pop();
            parent[lastKey] = value;
        }
    }

    /**
     * Exports all top-level metadata
     */
    all(withSecureData=true) {
        return {...this._data, ...(withSecureData ? this._privateData : {})};
    }

    /**
     * Exports all top-level metadata with given key list
     */
    allWith(keys, withSecureData=true) {
        const result = {};

        for (let key of keys) {
            if (withSecureData && this._privateData.hasOwnProperty(key)) {
                result[key] = this._privateData[key];
            } else if (this._data.hasOwnProperty(key)) {
                result[key] = this._data[key];
            }
        }
        return result;
    }

    _getKey(schemeKey) {
        let privateData = this._safe && schemeKey._private;
        //private data stored in a flat array, public data keep the given structure
        return privateData ? schemeKey._getter : schemeKey._getter.split(".");
    }

    /**
     * Find parent object in the meta context tree
     */
    _find(context, keys, createMissing) {
        return this.__find(context, keys.reverse());
    }
    __find(context, keys, createMissing) {
        if (!context || keys.length < 2) {
            if (keys.length < 1) return undefined;
            return context;
        }
        const key = keys.pop();
        let child = context[key];
        if (!child && createMissing) {
            context[key] = {};
            child = context[key];
        }
        return this.__find(child, keys);
    }

    /**
     * Returns Persistent Meta Store if available, or undefined
     * @type {MetaStore.Persistent|undefined}
     */
    persistent() {
        return undefined;
    };
}

/**
 * Persistent store working with strings only
 * @type {MetaStore.Persistent}
 */
MetaStore.Persistent = class {
    __cached = {};
    __upDate = Date.now();
    _instance = undefined;

    constructor(serviceUrl, id) {
        this.url = serviceUrl;
        this.id = id;
        this._init();
    }

    async _init() {
        try {
            await this.set("session", this.__upDate);
            this._instance = this;
            console.log("Persistent meta store initialized with url ", this.url);
        } catch (e) {
            console.log("Persistent meta store failed:", e);
        }
    }

    instance() {
        return this._instance;
    }

    invalidate() {
        this.__upDate = Date.now();
    }

    async get(key, defaultValue) {
        try {
            //todo consider empty string as valid response...
            let value = this.__cached[key];
            if (!value || value.tStamp < this.__upDate) {
                const response = await UTILITIES.fetch(this.url, {
                    action: "load",
                    id: this.id,
                    key: key,
                });
                value = await response.text();

                if (!value) value = defaultValue;
                this._set(key, value);
            }
            return value || defaultValue;
        } catch (e) {
            console.warn("Persistent store load error", key, e);
            return defaultValue;
        }
    }

    async set(key, value) {
        try {
            this._set(key, value);
            const response = await UTILITIES.fetch(this.url, {
                action: "save",
                id: this.id,
                key: key,
                value: value,
            });
            return await response.text();
        } catch (e) {
            console.warn("Persistent store set error", key, e);
        }
    }

    _set(k, v) {
        this.__cached[k] = {
            tStamp: Date.now(),
            value: v
        };
    }
}
