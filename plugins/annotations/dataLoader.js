/**
 * Data loader to the annotations interface, for annotations sharing
 * map received data to the expected data structure
 * data: {
       annotations: object (see fabricJS canvas export structure)
	   presets: object (see OSDAnnotations.PresetManager) export structure
	   metadata: {
	            name: string
				exported: string
				userAgent: string
	   }
 *
 * }
 * default implementation: identity
 * @type {AnnotationsGUI.DataLoader}
 */
AnnotationsGUI.DataLoader = class {

    constructor(context) {
        this.context = context;
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
        this._fetchWorker(server + "?Annotation=load/" + annotationId, null, onSuccess, onFailure, false);
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
        this._fetchWorker(server, {protocol: 'Annotation', command: 'update', id: annotationId, data: data},
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
     * @param {function} onSuccess  call with object - data from the response, in expected format
     * @param {function} onFailure  call on failure with the error object
     */
    uploadAnnotation(server, tissueId, data, onSuccess, onFailure) {
        let date = Date.now();
        this._fetchWorker(server, {
                protocol: 'Annotation',
                command: 'save',
                tissuePath: tissueId,
                data: data,
            }, onSuccess, onFailure
        );
    }

    _fetchWorker(url, post, onsuccess, onfail, successProperty=true) {
        if (this.context.context.disabledInteraction) {
            Dialogs.show("Annotations are disabled. <a onclick=\"$('#enable-disable-annotations').click();\">Enable.</a>", 2500, Dialogs.MSG_WARN);
            return;
        }
        UTILITIES.fetchJSON(url, post).then(json => {
            if (!successProperty || json.success) onsuccess(json);
            else onfail(json);
        }).catch(onfail);
    }
};
