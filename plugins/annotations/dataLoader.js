/**
 * Data loader to the annotations interface, for annotations sharing
 * map received data to the expected data format
 * data: {
       (optional) annotations: object (see fabricJS canvas export structure)
	   (optional) presets: object (see OSDAnnotations.PresetManager) export structure
	   (required) metadata: {
	                name: string
				    exported: string
				    userAgent: string
				    format: string
				    ...
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

        //register metadata use
        const meta = APPLICATION_CONTEXT.config.meta;
        meta.set("annotations-format", "");
        meta.set("annotations-name", "");
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
     */
    getMetaAuthor(metadata) {
        return metadata.getUser();
    }

    /**
     * Get date from the meta
     * @param {MetaStore} metadata
     */
    getMetaDate(metadata) {
        return new Date(metadata.getUTC()).toDateString();
    }

    /**
     * Get format of the export
     * @param {MetaStore} metadata
     */
    getMetaFormat(metadata) {
        return metadata.get("annotations-format");
    }

    /**
     * Get export name from meta
     * @param {MetaStore} metadata
     */
    getMetaName(metadata) {
        return metadata.get("annotations-name");
    }

    /**
     * Build description text
     * @param {MetaStore} metadata
     */
    getMetaDescription(metadata) {
        return 'Annotations export: ' + this.getMetaFormat(metadata) + ', uploaded ' + metadata.get("date");
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
     * @param {function} onSuccess  call with object - data from the response, in expected format
     * @param {function} onFailure  call on failure with the error object
     */
    updateAnnotation(server, annotationId, data, onSuccess, onFailure) {
        //set the data according to the current metadata values
        //must have available active annotation meta
        if (!this.currentMeta) throw "Invalid use: currentMeta not set!";
        APPLICATION_CONTEXT.config.meta.set("annotations-name", this.getMetaName(this.currentMeta));
        APPLICATION_CONTEXT.config.meta.set("annotations-format", this.getMetaFormat(this.currentMeta));
        this._fetchWorker(server, {protocol: 'Annotation', command: 'update', id: annotationId, data: data},
            onSuccess, onFailure, ["annotations-format", "annotations-name", MetaStore.userKey, MetaStore.dateKey, MetaStore.sessionKey]);
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
     * @param {function} onSuccess call with object - data from the response, in expected format
     * @param {function} onFailure call on failure with the error object
     */
    uploadAnnotation(server, tissueId, data, onSuccess, onFailure) {

        //set metadata, no available active annotation meta
        const now = Date.now();
        APPLICATION_CONTEXT.config.meta.set("annotations-name", `a${now}`);
        APPLICATION_CONTEXT.config.meta.set("annotations-format", this.context._format);

        this._fetchWorker(server, {
                protocol: 'Annotation',
                command: 'save',
                tissuePath: tissueId,
                data: data
            },
            onSuccess,
            onFailure,
            ["annotations-format", "annotations-name", MetaStore.userKey, MetaStore.dateKey, MetaStore.sessionKey]);
    }

    _fetchWorker(url, post, onSuccess, onFail, metaList=false) {
        if (this.context.context.disabledInteraction) {
            Dialogs.show("Annotations are disabled. <a onclick=\"$('#enable-disable-annotations').click();\">Enable.</a>", 2500, Dialogs.MSG_WARN);
            return;
        }
        UTILITIES.fetchJSON(url, post, {}, metaList).then(onSuccess).catch(onFail);
    }
};
