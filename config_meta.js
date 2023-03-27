// The metadata is in the viewer handled by a common interface:
//   global UTILITIES.fetchJSON automatically adds metadata provided to by the viewer in config
//   this class defines how the metadata is parsed so that your system can easily use its own structure

window.MetaStore = class {
    /**
     * Define what structure your metadata has, the system as of now
     * wants to access 'session ID', 'user data' and 'date'
     */

    //anything we want, we set it as private: IO does not affect values here,
    //these values must be set explicitly by some party /e.g. user session plugin/
    // In the docker we use {name, email, id} object
    getUserData(defaultValue) {
        return this.getPrivate(MetaStore.userKey, defaultValue);
    }
    setUserData(defaultValue) {
        return this.setPrivate(MetaStore.userKey, defaultValue);
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

    /*****************************************
     ******************* API *****************
     ****************************************/

    /**
     * Implements both JSON Configuration and Persistent (see below) metadata service API
     * @return {null}
     */
    constructor(data, safe=true) {
        //values here get exported and imported
        this._data = data;
        //values here are private to the session
        this._privateData = {};
        if (safe) {
            this.getPrivate = (name, defaultValue=undefined) => {
                let value = this._privateData[name] ?? defaultValue;
                if (value === "false") value = false; //true will eval to true anyway
                return value;
            };
            this.setPrivate = (name, value) => {
                if (value === "false") value = false;
                else if (value === "true") value = true;
                this._privateData[name] = value;
            };
        } else {
            this.getPrivate = (name, defaultValue=undefined) => {
                let value = this._data[name] ?? defaultValue;
                if (value === "false") value = false; //true will eval to true anyway
                return value;
            };
            this.setPrivate = (name, value)  => {
                if (value === "false") value = false;
                else if (value === "true") value = true;
                this._privateData[name] = value;
            };
        }
    }

    /**
     * initializes 'persistent' getter
     * @param persistentServiceUrl
     */
    initPersistentStore(persistentServiceUrl) {
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
    all(withSecureData=true) {
        const data = {...this._data, ...(withSecureData ? this._privateData : {})};
        data["date"] = this.getUTC();
        return data;
    }

    /**
     * Exports all metadata with given key list
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
