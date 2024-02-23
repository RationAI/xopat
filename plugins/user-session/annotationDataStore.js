//TODO implement integration of annotations-storage plugin with
// Frontend.DataModel = class extends XOpatStorage.Data
//     {
//
//     format: {
//         deprecated: ["annotations-format"]
//     },
//     version: {
//         _getter: "version",
//         _description: "Annotation Module Version",
//     },
//     user: {
//         _getter: "user",
//         _description: "User object as known to the system",
//     },
//     created: {
//         _getter: "created",
//         _description: "Creation UTC TimeStamp",
//     },
//     name: {
//         _getter: "annotations-name",
//         _description: "The export name",
//     },
//     session: {
//         _getter: "name",
//         _description: "The export name",
//     },
//     isDefault: {
//         _getter: "default",
//         _description: "Is this the default annotation for the given tissue?",
//     }
// };
// /**
//  * Data loader to the annotations interface, for annotations sharing
//  * map received data to the expected data format
//  * data: {
//        (optional) annotations: object (see fabricJS canvas export structure)
// 	   (optional) presets: object (see OSDAnnotations.PresetManager) export structure
// 	   (optional) metadata: {
// 	      ... driven by the scheme
// 	   }
//  * }
//  *
//  * In case of multiple request, the response should be array of the data objects,
//  * with required presence of 'metadata' property
//  *
//  * default implementation: identity
//  * @type {Frontend.DataLoader}
//  */
// Frontend.DataLoader = class {
//
//     constructor(context) {
//         this.context = context;
//         this.currentMeta = null;
//         this.currentResponseData = {};
//     }
//
//     /**
//      * Parse metadata to your liking, attach to the data item argument
//      * @param responseData
//      */
//     parseMetadata(responseData) {
//         if (responseData.metadata instanceof MetaStore) return;
//         responseData.metadata = new MetaStore(responseData.metadata, false);
//     }
//
//     /**
//      * Retrieve parsed metadata
//      * @param responseData
//      * @return {(function(*))|MetaStore|MediaMetadata|*|{}}
//      */
//     metadata(responseData) {
//         return responseData.metadata || {};
//     }
//
//     /**
//      * Set as default data source
//      * @param responseData
//      */
//     setActive(responseData) {
//         this.currentMeta = this.metadata(responseData);
//         this.currentResponseData = responseData;
//     }
//
//     /**
//      * Parse error response from the server,
//      * @param {HTTPError} httpError class
//      */
//     getErrorResponseMessage(httpError) {
//         return httpError.textData; //just raw response
//     }
//
//     /**
//      * Get annotation ID from the retrieved annotation list item
//      * @param {object} responseData data retrieved from the list annotations call for each annotation,
//      *  enriched by calling parseMetadata()
//      */
//     getId(responseData=this.currentResponseData) {
//         return responseData.id;
//     }
//
//     /**
//      * Get author from meta
//      * @param {object} responseData data retrieved from the list annotations call for each annotation,
//      *  enriched by calling parseMetadata()
//      */
//     getIcon(responseData=this.currentResponseData) {
//         return false; //do not render
//     }
//
//     /**
//      * Get author from meta
//      * @param {object} responseData data retrieved from the list annotations call for each annotation,
//      *  enriched by calling parseMetadata()
//      */
//     getMetaAuthor(responseData=this.currentResponseData) {
//         //parse xOpatSchema from the object here
//         const metadata = this.metadata(responseData);
//         const user = metadata.get(Frontend.MetaSchema.user, "unknown");
//         return MetaStore.getStore(user, xOpatSchema.user).get("user.name");
//         //we send data as join of tables with users, so responseData.name = user.name
//         // return 'Annotations created by ' + responseData.name;
//     }
//
//     /**
//      * Get format of the export
//      * @param {object} responseData data retrieved from the list annotations call for each annotation,
//      *  enriched by calling parseMetadata()
//      */
//     getMetaFormat(responseData=this.currentResponseData) {
//         const metadata = this.metadata(responseData);
//         return metadata.get(Frontend.MetaSchema.format, "native");
//     }
//
//     /**
//      * Get export name from meta
//      * @param {object} responseData data retrieved from the list annotations call for each annotation,
//      *  enriched by calling parseMetadata()
//      */
//     getMetaName(responseData=this.currentResponseData) {
//         const metadata = this.metadata(responseData);
//         return metadata.get(Frontend.MetaSchema.name);
//     }
//
//     /**
//      * Get export name from meta
//      * @param {object} responseData data retrieved from the list annotations call for each annotation,
//      *  enriched by calling parseMetadata()
//      */
//     getMetaName(responseData=this.currentResponseData) {
//         const metadata = this.metadata(responseData);
//         return metadata.get(Frontend.MetaSchema.name);
//     }
//
//     /**
//      * Build description text
//      * @param {object} responseData data retrieved from the list annotations call for each annotation,
//      *  enriched by calling parseMetadata()
//      */
//     getMetaDescription(responseData=this.currentResponseData) {
//         const metadata = this.metadata(responseData);
//         const date = metadata.get(Frontend.MetaSchema.created);
//         const readableDate = new Date(date).toDateString();
//         return readableDate + " | Uploaded by " + this.getMetaAuthor(responseData);
//     }
//
//     /**
//      * Check whether the annotation is the default one
//      * @param {object} responseData data retrieved from the list annotations call for each annotation,
//      *  enriched by calling parseMetadata()
//      * @return {*}
//      */
//     getIsDefault(responseData=this.currentResponseData) {
//         const metadata = this.metadata(responseData);
//         return metadata.get(Frontend.MetaSchema.isDefault);
//     }
//
//     /**
//      *
//      * @param {string} server URL to the annotations server
//      * @param {string} tissueId tissue ID, usually a path to the file
//      * @param {function} onSuccess  call with object - data from the response, in expected format
//      * @param {function} onFailure  call on failure with the error object
//      */
//     loadAnnotationsList(server, tissueId, onSuccess, onFailure) {
//         UTILITIES.fetchJSON(server + "?Annotation=list/" + tissueId).then(onSuccess).catch(onFailure);
//     }
//
//     /**
//      * Read
//      * @param {string} server URL to the annotations server
//      * @param {number} annotationId id obtained from the system
//      * @param {function} onSuccess  call with object - data from the response, in expected format
//      * @param {function} onFailure  call on failure with the error object
//      */
//     loadAnnotation(server, annotationId, isDefault, onSuccess, onFailure) {
//         this._fetchWorker(server + "?Annotation=load/" + annotationId, null, onSuccess, onFailure);
//     }
//
//     /**
//      * Update
//      * @param {string} server URL to the annotations server
//      * @param {number} annotationId id obtained from the system
//      * @param {object} data annotations data, export from the module
//      * @param {string} format
//      * @param {function} onSuccess  call with object - data from the response, in expected format
//      * @param {function} onFailure  call on failure with the error object
//      */
//     updateAnnotation(server, annotationId, isDefault, data, format, onSuccess, onFailure) {
//         //set the data according to the current metadata values
//         //must have available active annotation meta
//         if (!this.currentMeta) throw "Invalid use: currentMeta not set!";
//
//         this.currentMeta.set(Frontend.MetaSchema.format, format);
//         this.currentMeta.set(Frontend.MetaSchema.isDefault, isDefault);
//
//         this._fetchWorker(server,
//             {protocol: 'Annotation',
//                 command: 'update',
//                 id: annotationId,
//                 data: data,
//                 metadata: this.currentMeta.all()
//             },
//             onSuccess, onFailure);
//     }
//
//     /**
//      * Delete
//      * @param {string} server URL to the annotations server
//      * @param {number} annotationId id obtained from the system
//      * @param {function} onSuccess  call with object - data from the response, in expected format
//      * @param {function} onFailure  call on failure with the error object
//      */
//     removeAnnotation(server, annotationId, isDefault, onSuccess, onFailure) {
//         this._fetchWorker(server + "?Annotation=remove/" + annotationId, null, onSuccess, onFailure);
//     }
//
//     /**
//      * Create
//      * @param {string} server URL to the annotations server
//      * @param {string} tissueId tissue ID, usually a path to the file
//      * @param {object} data annotations data, export from the module
//      * @param {string} format
//      * @param {function} onSuccess call with object - data from the response, in expected format
//      * @param {function} onFailure call on failure with the error object
//      */
//     uploadAnnotation(server, tissueId, name, isDefault, data, format, onSuccess, onFailure) {
//         const appMeta = APPLICATION_CONTEXT.metadata;
//         name = isDefault ? "Default annotation" : name;
//
//         this.currentMeta = new MetaStore({});
//         this.currentMeta.set(Frontend.MetaSchema.format, format);
//         this.currentMeta.set(Frontend.MetaSchema.version, this.context.context.version);
//         this.currentMeta.set(Frontend.MetaSchema.user, appMeta.get(xOpatSchema.user));
//         this.currentMeta.set(Frontend.MetaSchema.created, new Date().toISOString());
//         this.currentMeta.set(Frontend.MetaSchema.name, name || HumanReadableIds.create());
//         this.currentMeta.set(Frontend.MetaSchema.isDefault, isDefault);
//
//         this._fetchWorker(server, {
//                 protocol: 'Annotation',
//                 command: 'save',
//                 tissuePath: tissueId,
//                 data: data,
//                 metadata: this.currentMeta.all()
//             },
//             onSuccess, onFailure);
//     }
//
//     _fetchWorker(url, post, onSuccess, onFail) {
//         if (this.context.context.disabledInteraction) {
//             Dialogs.show('Annotations are disabled. <a onclick="$(\'#enable-disable-annotations\').click();">Enable.</a>',
//                 2500, Dialogs.MSG_WARN);
//             return;
//         }
//         UTILITIES.fetchJSON(url, post, {}).then(onSuccess).catch(onFail);
//     }
// };
