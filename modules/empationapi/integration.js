(function () {

class V3Integration extends XOpatModule {

    //todo test when the user closed auth without signin
    constructor() {
        super("empation-api");

        this.configuration = this.getStaticMeta('options', {});
        if (!this.configuration.workbenchApiUrl) {
            console.warn("Empation-API: [wbServiceUrl] is required. Exiting...");
            return;
        }
        const connector = new EmpationAPI.V3.Root(this.configuration);
        EmpationAPI.V3.get = function() {
            if (!connector.userId) {
                console.error("Empation-API: Invalid access: user not logged in!");
                //todo: require login and stop execution? try with custom user?
                // generic failure?
            }
            return connector;
        }
        XOpatUser.instance().addHandler('login', e => connector.use(e.userId));
        XOpatUser.instance().addHandler('logout', e => connector.reset());
    }
}
new V3Integration();
})();

