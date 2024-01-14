class XOpatUser extends OpenSeadragon.EventSource {

    login(id, name, icon="") {
        if (!id) {
            throw "XOpatUser.login user ID not supplied!";
        }
        this._id = id;
        this._name = name;
        $("#user-name").html(name);

        this.icon = icon;
        this.raiseEvent('login', {
            userId: id,
            userName: name
        });
    }

    logout() {
        this._id = null;
        this._name = name;
        $("#user-name").html("____");
        this.icon = null;
        this.secret = null;
        this.raiseEvent('logout', null);
    }

    get isLogged() {
        return !!this._id;
    }

    get secret() {
        return this._secret;
    }

    set secret(secret) {
        this._secret = secret;
    }

    get id() {
        return this._id;
    }

    get name() {
        return this._name;
    }

    set icon(icon) {
        $("#user-icon").html(icon || `<span class="material-icons btn-pointer">account_circle</span>`);
    }

    onUserSelect() {
        if (this.isLogged) {
            //todo show some user info!!
        } else {
            Dialogs.show($.t('user.notConfigured'))
        }
    }

    /**
     * Get instance of the annotations manger, a singleton
     * (only one instance can run since it captures mouse events)
     * @static
     * @return {XOpatModuleSingleton} manager instance
     */
    static instance() {
        //this calls sub-class constructor, no args required
        this.__self = this.__self || new this();
        return this.__self;
    }

    /**
     * Check if instantiated
     * @return {boolean}
     */
    static instantiated() {
        return this.__self && true; //retype
    }

    static __self = undefined;
    constructor() {
        super();
        const staticContext = this.constructor;
        if (staticContext.__self) {
            throw `Trying to instantiate a singleton. Instead, use ${staticContext.name}::instance().`;
        }
        staticContext.__self = this;
        $("#user-panel").on('click', this.onUserSelect.bind(this));
    }
}
