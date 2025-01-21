addPlugin('empaia', class extends XOpatPlugin {
    constructor(id) {
        super(id);

        //known cases will be the only ones supported
        this.cases = this.getOption('cases', {});
        this.defaultAppId = this.getOption('appId', null);

        this.api = EmpationAPI.V3.get();

        this._currentCaseId = this._currentAppId = this.scopeAPI = null;
        this.api.__scope_def = [null, null];

        this.integrateWithPlugin('gui_annotations', async plugin => {
            plugin.addHandler('save-annotations', async e => {
                const Convertor = OSDAnnotations.Convertor.get("empaia");
                const convertor = new Convertor(plugin.context, {});
                const empaiaTiledImage = VIEWER.scalebar.getReferencedTiledImage();

                const promises = [];
                try {
                    const slideId = VIEWER.scalebar.getReferencedTiledImage()?.source?.getEmpaiaId();
                    const annotations = await this.scopeAPI.annotations.query({creators: [this.scopeAPI.id], references: [slideId]});

                    const currentAnnotations = plugin.context.filter(_ => true);
                    for (let annotation of annotations.items) {
                        const match = currentAnnotations.findIndex(e => e.id === annotation.id);
                        if (match >= 0) {
                            currentAnnotations.splice(match, 1);
                            //todo try to replace if not equal
                        } else {
                            //todo what if sent for saving before hit save? remember annotations in processing
                            promises.push(this.scopeAPI.annotations.delete(annotation));
                        }
                    }

                    await Promise.all(promises);

                    for (let annotation of currentAnnotations) {
                        //todo what if sent for saving before hit save? remember annotations in processing
                        console.warn("Found annotations that are not uploaded properly by the event routine!");
                        if (!annotation.npp_created) {
                            //todo when testing some annotation did not have npp_created property
                            annotation.npp_created = 1e6;
                        }
                        const toUpload = convertor.encodeSingleObject(annotation, empaiaTiledImage.source);
                        const annot = await this.scopeAPI.annotations.create(toUpload);
                        annotation.id = annot.id;

                        const preset = convertor.getPreset(annotation.id, annotation.presetID);
                        await this.scopeAPI.annotations.addClass(preset);
                    }

                    e.setNeedsDownload(false);
                    Dialogs.show("Saved.");
                } catch (ex) {
                    this.alertSaveFailed();
                    e.setNeedsDownload(true);
                    console.error(ex);
                }
            });
        });

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

            module.addHandler('annotation-create', async ev => {
                try {
                    const empaiaTiledImage = VIEWER.scalebar.getReferencedTiledImage();
                    const annotation = convertor.encodeSingleObject(ev.object, empaiaTiledImage.source);
                    const annot = await this.scopeAPI.annotations.create(annotation);
                    ev.object.id = annot.id;
                    const preset = convertor.getPreset(ev.object.id, ev.object.presetID);
                    await this.scopeAPI.annotations.addClass(preset);
                } catch (e) {
                    console.error(e);
                }
            });
            module.addHandler('annotation-delete', ev => {
                if (!ev.object.id) {
                    console.warn("NO ID!")
                    return;
                }

                try {
                    this.scopeAPI.annotations.deleteById(ev.object.id);
                } catch (e) {
                    console.error(e);
                }
            });
            module.addHandler('annotation-replace', async ev => {
                try {
                    if (ev.previous) {
                        if (!ev.previous.id) {
                            console.warn("NO ID!")
                            return;
                        }
                        this.scopeAPI.annotations.deleteById(ev.previous.id);
                    }
                    if (ev.next) {
                        ev.next.npp_created = ev.previous.npp_created;
                        const empaiaTiledImage = VIEWER.scalebar.getReferencedTiledImage();
                        const annotation = convertor.encodeSingleObject(ev.next, empaiaTiledImage.source);
                        const annot = await this.scopeAPI.annotations.create(annotation);

                        ev.next.id = annot.id;
                        const preset = convertor.getPreset(ev.next.id, ev.next.presetID);
                        await this.scopeAPI.annotations.addClass(preset);
                    }
                } catch (e) {
                    console.error(e);
                }
            });
            module.addHandler('annotation-edit', ev => {
                try {
                    if (!ev.object.id) {
                        console.warn("NO ID!");
                    }
                    const empaiaTiledImage = VIEWER.scalebar.getReferencedTiledImage();
                    const annotation = convertor.encodeSingleObject(ev.object, empaiaTiledImage.source);
                    this.scopeAPI.annotations.update(annotation);
                } catch (e) {
                    console.error(e);
                }
            });
        });
    }

    async refreshScope(module) {
        const bgId = APPLICATION_CONTEXT.referencedId();
        if (!this.setActiveScope(bgId)) {
            this.alertLoadFailed();
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
            this.alertLoadFailed();
            return;
        }

        const slideId = VIEWER.scalebar.getReferencedTiledImage()?.source?.getEmpaiaId();
        if (!slideId) {
            this.alertLoadFailed();
            return;
        }

        let dialogTimeout = setTimeout(() => {
            dialogTimeout = null;
            Dialogs.show("", 5000, Dialogs.MSG_WARN);
        }, 1000);
        try {
            const annotations = await this.scopeAPI.annotations.query({creators: [this.scopeAPI.id], references: [slideId]});
            // todo clear annotations from possibly previous state?
            module.import(annotations, {format: "empaia"}, true);
        } catch (e) {
            this.alertLoadFailed();
            console.error(e);
        }
        if (dialogTimeout) {
            clearTimeout(dialogTimeout);
        } else {
            Dialogs.hide();
        }
    }

    alertLoadFailed() {
        Dialogs.show(`Failed to load annotations from the server! Please, try to <a onclick="UTILITIES.refreshPage();">reload the page</a>."`)
    }

    alertSaveFailed() {
        Dialogs.show(`Failed to load annotations from the server! Please, keep the local file with your annotations. It can be used to import them manually.`)
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
