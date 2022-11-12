// The metadata is in the viewer handled by a common interface:
//   global UTILITIES.fetchJSON automatically adds metadata provided to by the viewer in config
//   this class defines how the metadata is parsed so that your system can easily use its own structure

window.MetaStore = class {

    constructor(data) {
        this._data = data;
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
     * Some methods are extracted to explicitly define necessary meta present for the system
     *
     * todo somehow handle unavailability...
     */

    //string
    getUser(defaultValue) {
        return this.get("user", defaultValue);
    }

    //UTC timestamp, important consistence - if set, return set value else NOW
    getUTC() {
        return this.get("date", Date.now());
    }

    //this session identifier
    getSession(defaultValue) {
        return this.get("session", defaultValue);
    }
}