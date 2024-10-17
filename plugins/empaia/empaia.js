addPlugin('empaia', class extends XOpatPlugin {
    constructor(id) {
        super(id);
        this.cases = this.getOption('cases', {});
        this.defaultAppId = this.getOption('appId', null);
        this.api = EmpationAPI.V3.get();

        this._currentCaseId = this._currentAppId = this.scopeAPI = null;
        this.api.__scope_def = [null, null];

        VIEWER.addHandler('background-image-swap', e => this.pluginReady());

        this.integrateWithSingletonModule('annotations', module => {
            EmpationAPI.integrateWithAnnotations(module);

            const Convertor = OSDAnnotations.Convertor.get("empaia");
            module.addHandler('annotation-create', ev => {
                const empaiaTiledImage = VIEWER.scalebar.getReferencedTiledImage();

                const preset = module.presets.get(ev.object.presetID)
                console.log(new Convertor(module, {}).encodeSingleObject(ev.object, preset, empaiaTiledImage.source));
            });
            module.addHandler('annotation-delete', ev => {

            });
            module.addHandler('annotation-replace', ev => {

            });
            module.addHandler('annotation-edit', ev => {

            });
        });
    }

    async pluginReady() {
        const bgId = APPLICATION_CONTEXT.referencedId();
        if (!this.setActiveScope(bgId)) {
            //todo warn!
        } else {
            this.scopeAPI = await this.api.newScopeUse(this._currentCaseId, this._currentAppId);
        }
        console.log(this.scopeAPI);
    }

    setActiveScope(wsiID) {
        if (!wsiID) {
            return false;
        }
        const bgList = APPLICATION_CONTEXT.config.data;
        for (let caseId in this.cases) {
            const c = this.cases[caseId];
            if (c.slides?.some(index => bgList[index] === wsiID)) {
                this._currentCaseId = caseId;
                this._currentAppId = c.appId || this.defaultAppId;
                this.api.__scope_def = [this._currentCaseId, this._currentAppId];
                return true;
            }
        }
        return false;
    }
});
