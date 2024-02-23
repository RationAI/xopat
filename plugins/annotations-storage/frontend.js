addPlugin("", class extends XOpatPlugin {

	pluginReady() {
		this.integrateWithPlugin("gui_annotations", plugin => {
// 				function autoLoad(id) {
// 					_this._loadAnnotation(id, async e => {
// 						console.warn('AutoLoad annotations failed', e);
// 						const data = _this.getAnnotationById(id);
// 						const isDefault = data ? await _this.dataStore.get("default") : false;
// 						const name = data ? await _this.dataStore.get("name", id) : id;
// 						Dialogs.show(`Attempt to autoload ${isDefault ? "default " : ""}annotations set <b>${name}</b> failed.
// You can <a class="pointer" onclick="USER_INTERFACE.AdvancedMenu.openSubmenu('${_this.id}', 'annotations-shared');">
// load available sets manually</a>.`, 4000, Dialogs.MSG_WARN);
// 					});
// 				}
//
// 				this.loadAnnotationsList(() => {
// 					const ids = _this.getOption('serverAutoLoadIds', undefined);
// 					if (Array.isArray(ids)) {
// 						ids.forEach(autoLoad);
// 					} else {
// 						const defaultId = _this.getDefaultAnnotationItemId();
// 						if (defaultId !== undefined) autoLoad(defaultId);
// 					}
// 				});

			//<button class="btn btn-outline" id="server-primary-save" onclick="${this.THIS}.uploadDefault();"><span class="material-icons pl-0 pr-1">cloud_upload</span>Upload</button>

			VIEWER.addHandler('background-image-swap', e => {
				this.loadAnnotationsList();
			});
		});
	}


	/*** HTTP API **/

	get serverStoredList() {
		return this.getServerStoredListWithCallback(() => {
			Dialogs.show("Reconnected to the server! Please, repeat this action to proceed.",
				20000, Dialogs.MSG_INFO);
		});
	}

	getServerStoredListWithCallback(onSuccess) {
		if (!this._serverAnnotationList) {
			this.loadAnnotationsList(onSuccess, (error) => {
				console.error(error);
				Dialogs.show("Failed to finish the task. Please, notify us about the problem.",
					20000, Dialogs.MSG_ERR);
			});
			return [];
		}
		return this._serverAnnotationList;
	}

	set serverStoredList(value) {
		this._serverAnnotationList = value;
	}

	getAnnotationById(id) {
		for (let annotation of this.serverStoredList) {
			//load default annotation if present
			if (this.dataLoader.getId(annotation) == id) {
				return annotation;
			}
		}
		return undefined;
	}

	getDefaultAnnotationItemId() {
		for (let annotation of this.serverStoredList) {
			//load default annotation if present
			if (this.dataStore.get(annotation)) {
				return this.dataLoader.getId(annotation);
			}
		}
		return undefined;
	}

	uploadDefault() {
		const id = this.getDefaultAnnotationItemId();
		if (id === undefined && confirm("Store the current annotation workspace as the default set for this file?")) {
			this.uploadAnnotation(true);
		} else {
			//confirm part of the behaviour
			this.updateAnnotation(id);
		}
	}

	loadAnnotationsList(onSuccessLoad=()=>{}, onError=undefined) {
		if (!this._server) {
			$("#annotations-shared-head").html(this.getAnnotationsHeadMenu(`This feature is not enabled.`));
			return;
		}
		this.annotationsMenuBuilder.clear();
		this.serverStoredList = null;

		if (!onError) {
			const _this = this;
			onError = function (error) {
				console.error(_this.dataLoader.getErrorResponseMessage(error));
				$("#annotations-shared-head").html(_this.getAnnotationsHeadMenu(
					`Could not load annotations list. <a class="pointer" onclick="plugin('${_this.id}').loadAnnotationsList()">Retry.</a>`));
			}
		}

		this.dataLoader.loadAnnotationsList(this._server, this.activeTissue, json => {
			let count = 0,
				user = XOpatUser.instance().name;

			//todo unify behaviour, two servers send different response :/
			this.serverStoredList = Array.isArray(json) ? json : json.annotations;

			this.annotationsMenuBuilder.addRow({
				title: `Upload new annotations (name <input type="text" value="" placeholder="automatic" class="form-control" id="annotations-upload-name" title="Name">)`,
				details: `Upload current annotations in the viewer as a new dataset (as ${user}).`,
				icon: `<button class="btn mr-3 px-2 py-1" onclick="${this.THIS}.uploadAnnotation()" title="Upload"><span class="pr-1 pl-0 material-icons btn-pointer">upload</span> Upload</button>`,
				contentAction: '',
				containerStyle: 'margin: 0 0 10px 0;'
			});

			function getActionButton(annotationId, text, icon, funcName) {
				return `<span onclick="${funcName}('${annotationId}');return false;" title="${text}" 
class="btn-pointer mt-1 d-inline-block px-1"><span class="material-icons width-full text-center">${icon}</span>
<br><span style="font-size: smaller">${text}</span></span>`;
			}

			for (let available of this._serverAnnotationList) { //access raw, prevents recursion
				//unsafe mode will parse all the metadata as one, so the user meta will be read from available.metadata
				this.dataLoader.parseMetadata(available);
				this.dataLoader.setActive(available);
				let id = this.dataLoader.getId();
				this.annotationsMenuBuilder.addRow({
					title: this.dataLoader.getMetaName(),
					details: this.dataLoader.getMetaDescription(),
					icon: this.dataLoader.getIcon(),
					contentAction: getActionButton(id, 'Download', 'download', `${this.THIS}.loadAnnotation`)
						+ getActionButton(id, 'Update', 'update', `${this.THIS}.updateAnnotation`)
						+ getActionButton(id, 'Delete', 'delete', `${this.THIS}.removeAnnotation`)
				});
				count++;
			}
			$("#annotations-shared-head").html(this.getAnnotationsHeadMenu());
			onSuccessLoad(json);
		}, onError);
	}

	loadAnnotation(id, force=false) {
		const _this = this;
		this._loadAnnotation(id, e => {
			console.error("Import failed!", e);
			Dialogs.show("Could not load annotations. Please, let us know about this issue and provide " +
				`<a onclick=\"${_this.id}.exportToFile()\">exported file</a>.`,
				20000, Dialogs.MSG_ERR);
		}, force);
	}

	_loadAnnotation(id, onError, force=false) {
		const _this = this
		this.dataLoader.setActive(this.serverStoredList.find(x => _this.dataLoader.getId(x) == id));
		const isDefault = this.dataLoader.getIsDefault();

		this.dataLoader.loadAnnotation(this._server, id, isDefault,json => {
			$('#preset-modify-dialog').remove();

			_this.dataLoader.parseMetadata(json);
			_this._ioArgs.format = _this.dataLoader.getMetaFormat(json);
			_this.context.import(json.data, this._ioArgs).then(r => {
				_this.updatePresetsHTML();
				_this._recordId(id);
				$("#annotations-shared-head").html(_this.getAnnotationsHeadMenu());
				Dialogs.show(r ? (isDefault ? "Loaded default annotation set." : "Annotation set loaded.")
						: "No data was imported! Are you sure you have a correct format set?",
					1000, r ? Dialogs.MSG_INFO : Dialogs.MSG_WARN);
			}).catch(onError);
		}, onError);
	}

	updateAnnotation(id) {
		const _this = this;
		this.dataLoader.setActive(this.serverStoredList.find(x => _this.dataLoader.getId(x) == id));
		if (!confirm("You are about to overwrite annotation set '" + this.dataLoader.getMetaName() + "'. Continue?" )) return;

		const isDefault = this.dataLoader.getIsDefault();

		//server IO only supports default format
		this._ioArgs.format = this._defaultFormat;
		this.context.export(this._ioArgs).then(data => {
			_this.dataLoader.updateAnnotation(_this._server, id, isDefault, data, this._defaultFormat,
				json => {
					Dialogs.show("Annotations uploaded.", 2000, Dialogs.MSG_INFO);
					_this.loadAnnotationsList();
					_this._recordId(id);
				},
				e => {
					Dialogs.show(`Failed to upload annotations. Are you logged in? You can 
<a onclick="${_this.id}.exportToFile()">Export them instead (save as a file)</a>.`,
						7000, Dialogs.MSG_ERR);
					console.error("Failed to update annotation: " + this.dataLoader.getMetaName(), "ID", id,
						_this.dataLoader.getErrorResponseMessage(e));
				}
			);
		})
	}

	removeAnnotation(id) {
		const _this = this;
		this.dataLoader.setActive(this.serverStoredList.find(x => _this.dataLoader.getId(x) == id));
		if (!confirm("You are about to delete annotation set '" + this.dataLoader.getMetaName() + "'. Continue?" )) return;

		const isDefault = this.dataLoader.getIsDefault();

		this.dataLoader.removeAnnotation(this._server, id, isDefault,
			json => {
				Dialogs.show(`Annotation '${this.dataLoader.getMetaName()}' removed.`, 2000, Dialogs.MSG_INFO);
				_this.loadAnnotationsList();
			},
			e => {
				Dialogs.show(`Failed to delete annotation '${this.dataLoader.getMetaName()}'.`,
					7000, Dialogs.MSG_ERR);
				console.error("Failed to delete annotation: " + this.dataLoader.getMetaName(),
					_this.dataLoader.getErrorResponseMessage(e));
			}
		);
	}

	uploadAnnotation(asDefault=false) {
		const _this = this, name = document.getElementById("annotations-upload-name")?.value;
		//server IO only supports default format
		this._ioArgs.format = this._defaultFormat;
		this.context.export(this._ioArgs).then(data => {
			this.dataLoader.uploadAnnotation(_this._server, _this.activeTissue, name, asDefault, data, this._defaultFormat,
				json => {
					Dialogs.show("Annotations uploaded.", 2000, Dialogs.MSG_INFO);
					_this.loadAnnotationsList();

					try {
						const item = Array.isArray(json) ? json[json.length-1] : json;
						_this.dataLoader.parseMetadata(item);
						const id = _this.dataLoader.getId(item);
						if (id) {
							_this._recordId(id);
						}
					} catch (e) {
						console.error(e);
					}
				},
				e => {
					Dialogs.show(`Failed to upload annotations. Are you logged in? You can 
<a onclick="${_this.id}.exportToFile()">Export them instead (save as a file)</a>.`,
						7000, Dialogs.MSG_ERR);
					console.error("Failed to upload annotations.", _this.dataLoader.getErrorResponseMessage(e));
				}
			);
		});
	}

	_recordId(id) {
		let ids = this.getOption('serverAutoLoadIds', undefined);
		if (!Array.isArray(ids)) ids = [];
		ids.push(id);
		this.setOption('serverAutoLoadIds', ids, false);
	}

});
