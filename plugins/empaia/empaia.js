addPlugin('empaia', class extends XOpatPlugin {
    constructor(id) {
        super(id);
        this.defaultCaseId = this.getOption('caseId', null);
        this.defaultAppId = this.getOption('appId', null);
        this.api = EmpationAPI.V3.get();
        this.scopeAPI = this.api.newScopeUse(this.defaultCaseId, this.defaultAppId);
    }
});
