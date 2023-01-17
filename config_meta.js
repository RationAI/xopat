// The metadata is in the viewer handled by a common interface:
//   global UTILITIES.fetchJSON automatically adds metadata provided to by the viewer in config
//   this class defines how the metadata is parsed so that your system can easily use its own structure

window.MetaStore = class {

    /**
     * Implements both JSON Configuration and Persistent (see below) metadata service API
     * initializes 'persistent' getter
     * @return {null}
     */
    constructor(data, persistentServiceUrl) {
        this._data = data;

        if (persistentServiceUrl) {
            const user = this.getUser(undefined);

            if (user) { //todo authorization? user url can be hacked :/
                const service = new MetaStore.Persistent(persistentServiceUrl,
                    this.getUser(undefined));
                this.persistent = function () {
                    return service.instance();
                }
            }
        }
    }

    /**
     * A Common API for system info to query their own metadata
     */

    get(name, defaultValue=undefined) {
        let value = this._data[name] ?? defaultValue;
        if (value === "false") value = false; //true will eval to true anyway
        return value;
    }

    set(name, value) {
        if (name === "date" || name === "tstamp" || name === "session") {
            throw "Invalid metadata key: already in use! " + name;
        }
        if (value === "false") value = false;
        else if (value === "true") value = true;
        this._data[name] = value;
    }

    /**
     * Exports all metadata except for timestamp
     */
    all() {
        const data = {...this._data};
        data["date"] = this.getUTC();
        return data;
    }

    /**
     * Exports all metadata with given key list
     */
    allWith(keys) {
        const result = {};
        for (let key in this._data) {
            if (keys.includes(key)) {
                result[key] = this._data[key];
            }
        }
        return result;
    }

    /**
     * Some methods are extracted to explicitly define necessary meta present for the system
     *
     * todo somehow handle unavailability...
     */

    //string
    getUser(defaultValue) {
        return this.get(MetaStore.userKey, defaultValue);
    }

    static get userKey() {
        return "user";
    }

    //UTC timestamp, important consistence - if set, return set value else NOW
    getUTC() {
        return this.get(MetaStore.dateKey, Date.now());
    }

    static get dateKey() {
        return "date";
    }

    //this session identifier
    getSession(defaultValue) {
        return this.get(MetaStore.sessionKey, defaultValue);
    }

    static get sessionKey() {
        return "session";
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
        let value = this.__cached[key];
        if (!value || value.tStamp < this.__upDate) {
            value = await UTILITIES.fetch(this.url, {
                action: "save",
                id: this.id,
                key: key,
                value: value,
            }).text();

            if (!value) value = defaultValue;
            this._set(key, value);
        }
        return value || defaultValue;
    }

    async set(key, value) {
        this._set(key, value);
        return await UTILITIES.fetch(this.url, {
            action: "save",
            id: this.id,
            key: key,
            value: value,
        }).text();
    }

    _set(k, v) {
        this.__cached[k] = {
            tStamp: Date.now(),
            value: v
        };
    }
}