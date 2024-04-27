addPlugin('empaia', class extends XOpatPlugin {
    constructor(id) {
        super(id);
        this.defaultCaseId = this.getOption('caseId', null);
        this.defaultAppId = this.getOption('appId', null);
        this.api = EmpationAPI.V3.get();

        //todo dirty, consider merging module with plugin to make it plugin only
        this.api.__scope_def = [this.defaultCaseId, this.defaultAppId];
        //this.scopeAPI = this.api.newScopeUse(this.defaultCaseId, this.defaultAppId);
    }
});
