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

        const user = XOpatUser.instance();
        user.addHandler('login', e => connector.reset());
        user.addHandler('secret-updated', e => connector.from(e.secret));
        user.addHandler('secret-removed', e => e.type === "jwt" && connector.reset());
        user.addHandler('logout', e => connector.reset());
        connector.addHandler('token-refresh', async e => {
            await user.requestSecretUpdate();
            e.newToken = user.getSecret('jwt');
        });

        // this.integrateWithSingletonModule('annotations', e => {
        //     const annotations = e.module;
        //     annotations.addHandler('annotation-create', ev => {
        //
        //     });
        //     annotations.addHandler('annotation-delete', ev => {
        //
        //     });
        //     annotations.addHandler('annotation-replace', ev => {
        //
        //     });
        //     annotations.addHandler('annotation-edit', ev => {
        //
        //     });
        // });
    }
}
new V3Integration();
})();

