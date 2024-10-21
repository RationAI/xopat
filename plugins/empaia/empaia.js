addPlugin('empaia', class extends XOpatPlugin {
    constructor(id) {
        super(id);
        this.cases = this.getOption('cases', {});
        this.defaultAppId = this.getOption('appId', null);
        this.api = EmpationAPI.V3.get();

        this._currentCaseId = this._currentAppId = this.scopeAPI = null;
        this.api.__scope_def = [null, null];


        this.integrateWithSingletonModule('annotations', async module => {
            EmpationAPI.integrateWithAnnotations(module);

            const Convertor = OSDAnnotations.Convertor.get("empaia");
            const convertor = new Convertor(module, {});

            if (!this.scopeAPI) {
                await this.refreshScope(module);
            } else {
                await this.stateChanged(module);
            }

            VIEWER.addHandler('background-image-swap', e => this.refreshScope(module));

            //todo some queue that performs updates one by one?

            // module.addHandler('annotation-create', async ev => {
            //     const empaiaTiledImage = VIEWER.scalebar.getReferencedTiledImage();
            //     const annotation = convertor.encodeSingleObject(ev.object, empaiaTiledImage.source);
            //     const annot = await this.scopeAPI.annotations.create(annotation);
            //     ev.object.id = annot.id;
            // });
            // module.addHandler('annotation-delete', ev => {
            //     if (!ev.object.id) {
            //         console.warn("NO ID!")
            //     }
            //     this.scopeAPI.annotations.deleteById(ev.object.id);
            // });
            // module.addHandler('annotation-replace', async ev => {
            //     if (ev.previous) {
            //         if (!ev.previous.id) {
            //             console.warn("NO ID!")
            //         }
            //         this.scopeAPI.annotations.deleteById(ev.previous.id);
            //     }
            //     if (ev.next) {
            //         ev.next.npp_created = ev.previous.npp_created;
            //         const empaiaTiledImage = VIEWER.scalebar.getReferencedTiledImage();
            //         const annotation = convertor.encodeSingleObject(ev.next, empaiaTiledImage.source);
            //         const annot = await this.scopeAPI.annotations.create(annotation);
            //         ev.object.id = annot.id;
            //     }
            // });
            // module.addHandler('annotation-edit', ev => {
            //     if (!ev.object.id) {
            //         console.warn("NO ID!")
            //     }
            //     const empaiaTiledImage = VIEWER.scalebar.getReferencedTiledImage();
            //     const annotation = convertor.encodeSingleObject(ev.object, empaiaTiledImage.source);
            //     this.scopeAPI.annotations.update(annotation);
            // });
        });
    }

    async refreshScope(module) {
        const bgId = APPLICATION_CONTEXT.referencedId();
        if (!this.setActiveScope(bgId)) {
            //todo warn!
        } else {
            this.scopeAPI = await this.api.newScopeUse(this._currentCaseId, this._currentAppId);

            if (module) {
                await this.stateChanged(module);
            }
        }
        console.log(this.scopeAPI);
    }

    async stateChanged(module) {
        if (!this.scopeAPI) {
            return;
        }
        //todo clear?
        //todo loading screen?

        const slideId = VIEWER.scalebar.getReferencedTiledImage()?.source?.getEmpaiaId();
        if (!slideId) {
            //todo error message
            return;
        }
        try {
            const annotations = await this.scopeAPI.annotations.query({creators: [this.scopeAPI.id], references: [slideId]});
            module.import(annotations, {format: "empaia"}, true);
        } catch (e) {
            //todo err
            throw e;
        }
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
