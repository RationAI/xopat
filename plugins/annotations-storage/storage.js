OSDAnnotations.ServerStorageAddon = class extends XOpatStorage.Data {
    constructor(options) {
        super({
            ...options,
            schema: {
                format: {deprecated: ["annotations-format"]},
                version: {},
                user: {},
                created: {},
                name: {deprecated: ["annotations-name"]},
                session: {},
                default: {},
                annotation: {},
                annotationList: {},
                preset: {},
                presetList: {}
            }
        });
    }

    availableAnnotationSets() {

    }

    getAnnotationMetadata(id) {

    }

    switchContext(id) {

    }
}
