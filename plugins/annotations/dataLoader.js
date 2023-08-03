AnnotationsGUI.MetaSchema = {
    format: {
        _getter: "annotations-format",
        _description: "Annotation Export Format",
    },
    version: {
        _getter: "version",
        _description: "Annotation Module Version",
    },
    user: {
        _getter: "user",
        _description: "User object as known to the system",
    },
    created: {
        _getter: "created",
        _description: "Creation UTC TimeStamp",
    },
    name: {
        _getter: "annotations-name",
        _description: "The export name",
    },
    session: {
        _getter: "name",
        _description: "The export name",
    }
};
/**
 * Data loader to the annotations interface, for annotations sharing
 * map received data to the expected data format
 * data: {
       (optional) annotations: object (see fabricJS canvas export structure)
	   (optional) presets: object (see OSDAnnotations.PresetManager) export structure
	   (required) metadata: {
	      ... driven by the scheme
	   }
 * }
 *
 * In case of multiple request, the response should be array of the data objects,
 * with required presence of 'metadata' property
 *
 * default implementation: identity
 * @type {AnnotationsGUI.DataLoader}
 */
AnnotationsGUI.DataLoader = class {

    constructor(context) {
        this.context = context;
    }

    setActiveMetadata(metaData) {
        this.currentMeta = metaData;
    }

    /**
     * Parse error response from the server,
     * @param {HTTPError} httpError class
     */
    getErrorResponseMessage(httpError) {
        return httpError.textData; //just raw response
    }

    /**
     * Get author from meta
     * @param {MetaStore} metadata
     * @param {{}} request data retrieved from the list annotations call for each annotation
     */
    getIcon(metadata=this.currentMeta, request={}) {
        return false; //do not render
    }

    /**
     * Get author from meta
     * @param {MetaStore} metadata
     * @param {{}} request data retrieved from the list annotations call for each annotation
     */
    getMetaAuthor(metadata=this.currentMeta, request={}) {
        //parse xOpatSchema from the object here
        const user = metadata.get(AnnotationsGUI.MetaSchema.user, "unknown");
        return MetaStore.getStore(user, xOpatSchema.user).get(xOpatSchema.user.name);
        //we send data as join of tables with users, so request.name = user.name
        // return 'Annotations created by ' + request.name;
    }

    /**
     * Get format of the export
     * @param {MetaStore} metadata
     * @param {{}} request data retrieved from the list annotations call for each annotation
     */
    getMetaFormat(metadata=this.currentMeta, request={}) {
        return metadata.get(AnnotationsGUI.MetaSchema.format, "native");
    }

    /**
     * Get export name from meta
     * @param {MetaStore} metadata
     * @param {{}} request data retrieved from the list annotations call for each annotation
     */
    getMetaName(metadata=this.currentMeta, request={}) {
        return metadata.get(AnnotationsGUI.MetaSchema.name);
    }

    /**
     * Build description text
     * @param {MetaStore} metadata
     * @param {{}} request data retrieved from the list annotations call for each annotation
     */
    getMetaDescription(metadata=this.currentMeta, request={}) {
        const date = metadata.get(AnnotationsGUI.MetaSchema.created);
        const readableDate = new Date(date).toDateString();
        return readableDate + " | Uploaded by " + this.getMetaAuthor(metadata, request);
    }

    /**
     *
     * @param {string} server URL to the annotations server
     * @param {string} tissueId tissue ID, usually a path to the file
     * @param {function} onSuccess  call with object - data from the response, in expected format
     * @param {function} onFailure  call on failure with the error object
     */
    loadAnnotationsList(server, tissueId, onSuccess, onFailure) {
        UTILITIES.fetchJSON(server + "?Annotation=list/" + tissueId).then(onSuccess).catch(onFailure);
    }

    /**
     *
     * @param {string} server URL to the annotations server
     * @param {number} annotationId id obtained from the system
     * @param {function} onSuccess  call with object - data from the response, in expected format
     * @param {function} onFailure  call on failure with the error object
     */
    loadAnnotation(server, annotationId, onSuccess, onFailure) {
        this._fetchWorker(server + "?Annotation=load/" + annotationId, null, onSuccess, onFailure);
    }

    /**
     *
     * @param {string} server URL to the annotations server
     * @param {number} annotationId id obtained from the system
     * @param {object} data annotations data, export from the module
     * @param {string} format
     * @param {function} onSuccess  call with object - data from the response, in expected format
     * @param {function} onFailure  call on failure with the error object
     */
    updateAnnotation(server, annotationId, data, format, onSuccess, onFailure) {
        //set the data according to the current metadata values
        //must have available active annotation meta
        if (!this.currentMeta) throw "Invalid use: currentMeta not set!";

        this.currentMeta.set(AnnotationsGUI.MetaSchema.format, format);
        this._fetchWorker(server,
            {protocol: 'Annotation',
                command: 'update',
                id: annotationId,
                data: data,
                metadata: this.currentMeta.all()
            },
            onSuccess, onFailure);
    }

    /**
     *
     * @param {string} server URL to the annotations server
     * @param {number} annotationId id obtained from the system
     * @param {function} onSuccess  call with object - data from the response, in expected format
     * @param {function} onFailure  call on failure with the error object
     */
    removeAnnotation(server, annotationId, onSuccess, onFailure) {
        this._fetchWorker(server + "?Annotation=remove/" + annotationId, null, onSuccess, onFailure);
    }

    /**
     *
     * @param {string} server URL to the annotations server
     * @param {string} tissueId tissue ID, usually a path to the file
     * @param {object} data annotations data, export from the module
     * @param {string} format
     * @param {function} onSuccess call with object - data from the response, in expected format
     * @param {function} onFailure call on failure with the error object
     */
    uploadAnnotation(server, tissueId, data, format, onSuccess, onFailure) {

        const appMeta = APPLICATION_CONTEXT.metadata;
        this.currentMeta = new MetaStore({});
        this.currentMeta.set(AnnotationsGUI.MetaSchema.format, format);
        this.currentMeta.set(AnnotationsGUI.MetaSchema.version, this.context.context.version);
        this.currentMeta.set(AnnotationsGUI.MetaSchema.user, appMeta.get(xOpatSchema.user));
        this.currentMeta.set(AnnotationsGUI.MetaSchema.created, new Date().toISOString());
        this.currentMeta.set(AnnotationsGUI.MetaSchema.name, HumanReadableIds.create());

        this._fetchWorker(server, {
                protocol: 'Annotation',
                command: 'save',
                tissuePath: tissueId,
                data: data,
                metadata: this.currentMeta.all()
            },
            onSuccess, onFailure);
    }

    _fetchWorker(url, post, onSuccess, onFail) {
        if (this.context.context.disabledInteraction) {
            Dialogs.show("Annotations are disabled. <a onclick=\"$('#enable-disable-annotations').click();\">Enable.</a>", 2500, Dialogs.MSG_WARN);
            return;
        }
        UTILITIES.fetchJSON(url, post, {}).then(onSuccess).catch(onFail);
    }
};
