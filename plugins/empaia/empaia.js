addPlugin('empaia', class extends XOpatPlugin {
    constructor(id) {
        super(id);
        this.defaultCaseId = this.getOption('caseId', null);
        this.defaultAppId = this.getOption('appId', null);
        this.api = EmpationAPI.V3.get();

        this.api.__scope_def = [this.defaultCaseId, this.defaultAppId];
        //this.scopeAPI = this.api.newScopeUse(this.defaultCaseId, this.defaultAppId);


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
});
