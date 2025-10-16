/**
 * Annotations functionality to the viewer - mouse interaction, events, interfaces, exporting...
 * @type {OSDAnnotations}
 *
 * @typedef {{x: number, y: number}} Point
 * 
 * @typedef {{
 * 	id: string,
 * 	author: {
 * 		id: string,
 * 		name: string,
 * 	},
 * 	content: string,
 * 	createdAt: Date,
 *  replyTo?: string,
 * 	removed?: boolean,
 * }} AnnotationComment
 * 
 * @typedef {{
 * 	shown: boolean,
 * 	borderColor: string,
 * 	borderDashing: number,
 * 	ignoreCustomStyling: boolean
 * }} AuthorConfig
 *
 * Consider https://alimozdemir.com/posts/fabric-js-history-operations-undo-redo-and-useful-tips/
 *    - blending ?
 */
window.OSDAnnotations = class extends XOpatModuleSingleton {

	constructor() {
		super("annotations");
		this.version = "0.0.1";
		this.session = this.version + "_" + Date.now();
		this.registerAsEventSource();
		this._init();
		this._setListeners();
		this.user = XOpatUser.instance();
	}

	/**
	 * Add pre-defined mode to annotations. Without registering, the mode will not be available.
	 * @param {string} id ID of the mode, can be one of AUTO, CUSTOM, FREE_FORM_TOOL
	 */
	setModeUsed(id) {
		switch (id) {
			case "AUTO":
				if (this.Modes.AUTO instanceof OSDAnnotations.AnnotationState) {
					this.Modes.AUTO = new OSDAnnotations.StateAuto(this);
				}
				this.mode = this.Modes.AUTO;
				break;
			case "CUSTOM":
				if (!this.Modes.hasOwnProperty("CUSTOM")) {
					this.Modes.CUSTOM = new OSDAnnotations.StateCustomCreate(this);
				}
				break;
			case "FREE_FORM_TOOL_ADD":
				if (!this.Modes.hasOwnProperty("FREE_FORM_TOOL")) {
					this.Modes.FREE_FORM_TOOL_ADD = new OSDAnnotations.StateFreeFormToolAdd(this);
				}
				break;
			case "FREE_FORM_TOOL_REMOVE":
				if (!this.Modes.hasOwnProperty("FREE_FORM_TOOL_REMOVE")) {
					this.Modes.FREE_FORM_TOOL_REMOVE = new OSDAnnotations.StateFreeFormToolRemove(this);
				}
				break;
			default:
				console.error("Invalid mode ", id);
		}
	}

	/**
	 * Add custom mode to the annotations and activate
	 * please, thoroughly study other modes when they activate/deactivate so that no behavioral collision occurs
	 * @param {string} id mode id, must not collide with existing mode ID's (e.g. avoid pre-defined mode id's)
	 * @param {function} ModeClass class that extends (and implements) OSDAnnotations.AnnotationState
	 */
	setCustomModeUsed(id, ModeClass) {
		if (this.Modes.hasOwnProperty(id)) {
			throw `The mode ${ModeClass} conflicts with another mode: ${this.Modes[id]._id}`;
		}
		if (!OSDAnnotations.AnnotationState.isPrototypeOf(ModeClass)) {
			throw `The mode ${ModeClass} does not inherit from OSDAnnotations.AnnotationState`;
		}
		this.Modes[id] = new ModeClass(this);
	}

	/**
	 * Register Factory for an annotation object type
	 * @static
	 * @param {function} FactoryClass factory that extends AnnotationObjectFactory
	 * @param {boolean} atRuntime true if the factory is registered at runtime
	 */
	static registerAnnotationFactory(FactoryClass, atRuntime=true) {
		if (!OSDAnnotations.AnnotationObjectFactory.isPrototypeOf(FactoryClass)) {
			throw `The factory ${FactoryClass} does not inherit from OSDAnnotations.AnnotationObjectFactory`;
		}

		if (! this.instantiated()) {
			this.__registered = this.__registered ?? [];
			this.__registered.push(FactoryClass);
			return;
		} else if (this.__registered) {
			for (let f of this.__registered) {
				this._registerAnnotationFactory(f, atRuntime);
			}
			delete this.__registered;
		}
		this._registerAnnotationFactory(FactoryClass, atRuntime);
	}

	/******************* EXPORT, IMPORT **********************/
	async exportData() {
		return await this.export();
	}

	async importData(data) {
		const options = {inheritSession: true};
		if (typeof data === "object" && data.format) {
			options.format = data.format;
		}
		await this.import(data, options);
	}

	/**
	 * Get the currently used data persistence storage module.
	 * This initializes the main persitor.
	 * @return {PostDataStore}
	 */
	async initPostIO() {
		if (this.POSTStore) return this.POSTStore;

		const store = await super.initPostIO({
			schema: {
				"": {_deprecated: ["annotations"]},
			},
			strictSchema: false
		});

		if (this._storeCacheSnapshots) {
			await this._initIoFromCache();

			let guard = 0; const _this=this;
			function editRoutine(event, force=false) {
				if (force || guard++ > 10) {
					guard = 0;
					//todo ensure cache can be non-persistent as a fallback
					_this.cache.set('_unsaved', {
						session: APPLICATION_CONTEXT.sessionName,
						objects: _this.toObject(true)?.objects,
						presets: _this.presets.toObject()
					});
				}
			}

			this.addHandler('export', () => {
				_this.cache.set('_unsaved', null);
				guard = 0;
			});
			this.addHandler('annotation-create', editRoutine);
			this.addHandler('annotation-delete', editRoutine);
			this.addHandler('annotation-replace', editRoutine);
			this.addHandler('annotation-edit', editRoutine);
			window.addEventListener("beforeunload", event => {
				if (guard === 0 || !_this.history.canUndo()) return;
				editRoutine(null, true);
			});

			if (!this._avoidImport) {
				await this.loadPresetsCookieSnapshot();
			}
		}
		return store;
	}

	async _initIoFromCache() {
		if (!this._storeCacheSnapshots) return;

		//todo verify how this behaves with override data import later from the data API
		// also problem: if cache implemented over DB? we could add cache.local option that could
		// explicitly request / enforce local storage usage
		let data = this.cache.get("_unsaved");
		let loaded = false;
		if (data) {
			try {
				if (data?.session === APPLICATION_CONTEXT.sessionName) {
					if (confirm("Your last annotation workspace was not saved! Load?")) {
						//todo do not avoid import but import to a new layer!!!
						this._avoidImport = true;
						if (data?.presets) {
							await this.presets.import(data?.presets, true);
							loaded = true;
						}
						if (data?.objects) {
							await this._loadObjects({objects: data.objects}, true);
							loaded = true;
						}
					}
				}
			} catch (e) {
				console.error("Faulty cached data!", e);
			}

			if (loaded) {
				this.raiseEvent('import', {
					options: {},
					clear: true,
					data: {
						objects: data.objects,
						presets: data.presets
					},
				});
			} else {
				this._avoidImport = false;
				//do not erase cache upon load, still not saved anywhere
				await this.cache.set('_unsaved', null);
			}
		}
	}

	getFormatSuffix(format=undefined) {
		return OSDAnnotations.Convertor.getSuffix(format);
	}

	/**
	 * Creates a copy of exported list of objects with necessary values only
	 * @param {[]|{}} objectList array of annotations or object with 'objects' array (as comes from this.toObject())
	 * @param {string} keeps additional properties to keep
	 * @return {[]|{}} clone array with trimmed values or modified object where 'objects' prop refers to the trimmed data
	 */
	trimExportJSON(objectList, ...keeps) {
		let array = objectList;
		if (!Array.isArray(array)) {
			array = objectList.objects;
		}
		const _this = this;
		array = array.map(x => {
			//we define factories for types as default implementations too
			const factory = _this.getAnnotationObjectFactory(x.factoryID || x.type);
			if (!factory) return undefined; //todo error? or skips?
			return factory.copyNecessaryProperties(x, keeps, true);
		});
		if (!Array.isArray(objectList)) {
			objectList.objects = array;
			return objectList;
		}
		return array;
	}

	/**
	 * Export annotations and presets
	 * @param {{}} options options
	 * @param {string?} options.format a string that defines desired format ID as registered
	 *   in OSDAnnotations.Convertor, default 'native'
	 * @param {object?} options.bioformatsCroppingRect
	 * @param {boolean?} options.serialize rather internally used, true to serialize the output, false to optimize
	 *   encoding, ready for exportFinalize()
	 * @param {boolean} withAnnotations
	 * @param {boolean} withPresets
	 * @return Promise(object) partially serialized data, ready to be finished with exportFinalize:
	 *   objects: [(string|any)] serialized or un
	 */
	async exportPartial(options={}, withAnnotations=true, withPresets=true) {
		if (!options?.format) options.format = "native";
		const result = await OSDAnnotations.Convertor.encodePartial(options, this, withAnnotations, withPresets);
		this.raiseEvent('export-partial', {
			options: options,
			data: result
		});
		return result;
	}

	/**
	 * Export annotations and presets
	 * @param {object} data output of exportPartial(...) with a correct format!
	 * @param {string?} format default 'native'
	 */
	exportFinalize(data, format='native') {
		const result = OSDAnnotations.Convertor.encodeFinalize(format, data);
		this.raiseEvent('export', {
			data: result
		});
		return result;
	}

	/**
	 * Export annotations and presets
	 * @param {{}} options options
	 * @param {string?} options.format a string that defines desired format ID as registered in OSDAnnotations.Convertor,
	 *    note that serialize option is ignored, as export() serializes always
	 * @param {object?} options.bioformatsCroppingRect
	 * @param {boolean} withAnnotations
	 * @param {boolean} withPresets
	 * @return Promise((string|object)) serialized data or object of serialized annotations and presets (if applicable)
	 */
	async export(options={}, withAnnotations=true, withPresets=true) {
		if (!options?.format) options.format = "native";
		//prevent immediate serialization as we feed it to a merge
		options.serialize = false;
		let output = await OSDAnnotations.Convertor.encodePartial(options, this, withAnnotations, withPresets);
		this.raiseEvent('export-partial', {
			options: options,
			data: output
		});
		output = OSDAnnotations.Convertor.encodeFinalize(options.format, output);
		this.raiseEvent('export', {
			data: output
		});
		return output;
	}

	/**
	 * Import annotations and presets. Imported presets automatically remove unused presets
	 *   (no change in meta or no object created with).
	 * todo allow also objects import not only string
	 * @param {string} data serialized data of the given format
	 * 	- either object with 'presets' and/or 'objects' data content - arrays
	 * 	- or a plain array, treated as objects
	 * @param {{}} options options
	 * @param {string?} options.format a string that defines desired format ID as registered in OSDAnnotations.Convertor
	 * @param {object?} options.bioformatsCroppingRect
	 * @param {boolean} options.inheritSession set current session ID for the annotation if missing, default true
	 * @param {boolean} clear erase state upon import
	 * @return Promise(boolean) true if something was imported
	 */
	async import(data, options={}, clear=false) {
		//todo allow for 'redo' history (once layers are introduced)

		if (!options?.format) options.format = "native";

		let toImport;
		try {
			toImport = await OSDAnnotations.Convertor.decode(options, data, this);
		} catch (e) {
			const formats = OSDAnnotations.Convertor.formats;
			const triedFormat = options.format;
			console.log(`Failed to load annotations as ${options.format}: ${e}, attempt to parse some of the remaining supported formats:`, formats);

			for (let format of formats) {
				if (format === triedFormat) continue;
				try {
					options.format = format;
					toImport = await OSDAnnotations.Convertor.decode(options, data, this);
					console.log("Successfully parsed as", format);
					break;
				} catch (_e) {
					//pass
				}
			}

			if (!toImport) {
				console.error("No supported format was able to parse provided annotations data!");
			}
		}

		let imported = false;
		let inheritSession = options.inheritSession === undefined || options.inheritSession;

		// the import should happen in two stages, one that prepares the data and one that
		// loads so that integrity is kept -> this is not probably a big issue since the only
		// 'parsing' is done within preset import and it fails safely with exception in case of error

		if (Array.isArray(toImport) && toImport.length > 0) {
			imported = true;
			//if no presets, maybe we are importing object array
			await this._loadObjects({objects: toImport}, clear, inheritSession);
		} else {
			if (Array.isArray(toImport.presets) && toImport.presets.length > 0) {
				imported = true;
				await this.presets.import(toImport.presets, clear);
			}
			if (Array.isArray(toImport.objects) && toImport.objects.length > 0) {
				imported = true;
				await this._loadObjects(toImport, clear, inheritSession);
			}
		}

		if (imported) {
			this.history.refresh();
		}

		this.raiseEvent('import', {
			options: options,
			clear: clear,
			data: imported ? toImport : null,
		});

		return imported;
	}

	/**
	 * Force the module to export additional properties used by external systems
	 * @param {string} value new property to always export
	 */
	set forceExportsProp(value) {
		this._extraProps.push(value);
	}

	/**
	 * Export only annotation objects in a fabricjs manner (actually just forwards the export command)
	 * for exporting presets, see this.presets.export(...)
	 *
	 * The idea behind fabric exporting is to use _exportedPropertiesGlobal to ensure all properties
	 * we want are included. Fabric's toObject will include plethora of properties. To trim down these,
	 * trimExportJSON() is used to keep only necessary properties.
	 *
	 * @param {boolean|string} withAllProps if boolean, true means export all props, false necessary ones,
	 *   string counts as one of withProperties
	 * @param {((object) => boolean)|string} filter callback function to filter objects (applied to fabric objects before export),
	 *   string counts as one of withProperties
	 * @param {string[]} withProperties list of extra properties to export
	 * @return {object} exported canvas content in {objects:[object], version:string} format
	 */
	toObject(withAllProps=true, filter=false, ...withProperties) {
		let props;
		if (typeof withAllProps === "boolean") {
			props = this._exportedPropertiesGlobal(withAllProps);
		} else if (typeof withAllProps === "string") {
			props = this._exportedPropertiesGlobal(true);
			props.push(withAllProps);
		}
		
		if (typeof filter === "string") {
			props.push(filter);
			filter = undefined;
		}
		
		props.push(...withProperties);
		props.push(...this._extraProps);
		props = Array.from(new Set(props));
		
		let objectsToExport = this.canvas.getObjects();
		if (filter && typeof filter === "function") {
			objectsToExport = objectsToExport.filter(filter);
		}

		const data = {
			version: this.canvas.version,
			objects: objectsToExport.map(obj => obj.toObject(props))
		};
		
		if (withAllProps === true) return data;
		return this.trimExportJSON(data);
	}

	/**
	 * Returns additional properties to copy (beside all properties generated by fabricjs)
	 * @private
	 */
	_exportedPropertiesGlobal(all=true) {
		const props = new Set(
			all ? OSDAnnotations.AnnotationObjectFactory.copiedProperties :
				OSDAnnotations.AnnotationObjectFactory.necessaryProperties
		);
		for (let fid in this.objectFactories) {
			const factory = this.objectFactories[fid];
			const newProps = factory.exports();
			if (Array.isArray(newProps)) {
				for (let p of newProps) {
					props.add(p);
				}
			}
		}
		return Array.from(props);
	}

	/**
	 * Load annotation objects only, must keep the same structure that comes from 'toObject',
	 * the load event should be preceded with preset load event
	 * for loading presets, see this.presets.import(...)
	 * @param {object} annotations objects to import, {objects:[object]} format
	 * @param {boolean} clear true if existing objects should be removed, default false
	 * @param inheritSession
	 * @return Promise
	 */
	async loadObjects(annotations, clear=false, inheritSession=true) {
		//todo allow for 'redo' history (once layers are introduced)
		if (!annotations.objects) throw "Annotations object must have 'objects' key with the annotation data.";
		if (!Array.isArray(annotations.objects)) throw "Annotation objects must be an array.";
		return this._loadObjects(annotations, clear, inheritSession);
	}

	/******************* SETTERS, GETTERS **********************/

	/**
	 * Change the interactivity - enable or disable navigation in OpenSeadragon
	 * this is a change meant to be performed from the outside (correctly update pointer etc.)
	 * @event osd-interactivity-toggle
	 * @param {boolean} isOSDInteractive
	 * @param _raise @private
	 */
	setMouseOSDInteractive(isOSDInteractive, _raise=true) {
		if (this.mouseOSDInteractive === isOSDInteractive) return;

		if (isOSDInteractive) {
			this.setOSDTracking(true);
			this.canvas.defaultCursor = "grab";
			this.canvas.hoverCursor = "pointer";

			if (this.presets.left) this.presets.left.objectFactory.finishIndirect();
			if (this.presets.right) this.presets.right.objectFactory.finishIndirect();
		} else {
			this.setOSDTracking(false);
			this.canvas.defaultCursor = "crosshair";
			this.canvas.hoverCursor = "pointer";
		}
		this.mouseOSDInteractive = isOSDInteractive;
		if (_raise) this.raiseEvent('osd-interactivity-toggle');
	}

	/**
	 * Change the interactivity - enable or disable navigation in OpenSeadragon
	 * does not fire events, does not update anything, meant to be called from AnnotationState
	 * or internally.
	 * @package-private
	 * @param {boolean} tracking
	 */
	setOSDTracking(tracking) {
		VIEWER.setMouseNavEnabled(tracking);
	}

	/**
	 * Check for OSD interactivity
	 * @return {boolean}
	 */
	isMouseOSDInteractive() {
		return this.mouseOSDInteractive;
	}

	/**
	 * Get object factory for given object type (stored in object.factoryID)
	 * @param {string} objectType the type is stored as a factoryID property
	 * @return {OSDAnnotations.AnnotationObjectFactory | undefined}
	 */
	getAnnotationObjectFactory(objectType) {
		if (this.objectFactories.hasOwnProperty(objectType))
			return this.objectFactories[objectType];
		return undefined;
	}

	/**
	 * FabricJS context
	 * @member OSDdAnAnnotations
	 * @return {fabric.Canvas}
	 */
	get canvas() {
		return this.overlay.fabric;
	}

	/**
	 * Find annotation by its increment ID
	 * @param id
	 * @return {null|fabric.Object}
	 */
	findObjectOnCanvasByIncrementId(id) {
		//todo fabric.js should have some way how to avoid linear iteration over all objects...
		let target = null;
		this.canvas.getObjects().some(o => {
			if (o.incrementId === id) {
				target = o;
				return true;
			}
			return false;
		});
		return target;
	}

	/**
	 * Hide or show annotations
	 * @param {boolean} on
	 */
	enableAnnotations(on) {
		let objects = this.canvas.getObjects();
		this.enableInteraction(on);

		if (on) {
			//set all objects as visible and unlock
			for (let i = 0; i < objects.length; i++) {
				objects[i].visible = true;

				objects[i].lockRotation = false;
				objects[i].lockScalingFlip = false;
				objects[i].lockScalingX = false;
				objects[i].lockScalingY = false;
				objects[i].lockUniScaling = false;
			}
			if (this.cachedTargetCanvasSelection) {
				this.canvas.setActiveObject(this.cachedTargetCanvasSelection);
			}
		} else {
			this.cachedTargetCanvasSelection = this.canvas.getActiveObject();
			this.history.highlight(null);
			for (let i = 0; i < objects.length; i++) {
				//set all objects as invisible and lock in position
				objects[i].visible = false;
				objects[i].lockMovementX = true;
				objects[i].lockMovementY = true;
				objects[i].lockRotation = true;
				objects[i].lockScalingFlip = true;
				objects[i].lockScalingX = true;
				objects[i].lockScalingY = true;
				objects[i].lockSkewingX = true;
				objects[i].lockSkewingY = true;
				objects[i].lockUniScaling = true;
			}
			this.canvas.discardActiveObject();
		}
		this.canvas.renderAll();
	}

	/**
	 * Enable or disable interaction with this module,
	 * sets also AUTO mode
	 * @event enabled
	 * @param {boolean} on
	 */
	enableInteraction(on) {
		this.disabledInteraction = !on;
		this.raiseEvent('enabled', {isEnabled: on});
		this.history._setControlsVisuallyEnabled(on);
		//return to the default state, always
		this.setMode(this.Modes.AUTO);
	}

	/**
	 * Check whether auto, default mode, is on
	 * @return {boolean}
	 */
	isModeAuto() {
		return this.mode === this.Modes.AUTO;
	}

	/**
	 * Set mode by object
	 * @event mode-changed
	 * @param {OSDAnnotations.AnnotationState} mode
	 * @param {boolean} [force=false]
	 */
	setMode(mode, force=false) {
		if (this.disabledInteraction || mode === this.mode) return;

		if (this._dopperlGangerCount > 0) {
			console.warn("[setMode] doppelganger found while switching modes: this is a bug. Removing...", this._trackedDoppelGangers);
			for (let dId in this._trackedDoppelGangers) {
				this.canvas.remove(this._trackedDoppelGangers[dId]);
			}
			this._dopperlGangerCount = 0;
			this._trackedDoppelGangers = {};
		}

		if (this.mode === this.Modes.AUTO) {
			this._setModeFromAuto(mode);
		} else if (mode !== this.Modes.AUTO || force) {
			this._setModeToAuto(true);
			this._setModeFromAuto(mode);
		} else {
			this._setModeToAuto(false);
		}
	}

	/**
	 * Set current mode by mode id
	 * @event mode-changed
	 * @param {string} id
	 * @param {boolean} [force=false]
	 */
	setModeById(id, force=false) {
		let _this = this;
		for (let mode in this.Modes) {
			if (!this.Modes.hasOwnProperty(mode)) continue;
			mode = this.Modes[mode];
			if (mode.getId() === id) {
				_this.setMode(mode, force);
				break;
			}
		}
	}

	/**
	 * Get a reference to currently active preset
	 * @param left true if left mouse button
	 * @return {OSDAnnotations.Preset|undefined}
	 */
	getPreset(left=true) {
		return left ? this.presets.left : this.presets.right;
	}

	/**
	 * Set active preset for mouse button
	 * @param {OSDAnnotations.Preset|undefined|boolean|number} preset
	 *      either a boolean to control selection (true will try to set any preset
	 *      and create one if not present, false will unset); or
	 *      object OSDAnnotations.Preset to set, or preset ID to set;
	 * 		undefined behaves as if false was sent
	 * @param {boolean} left true if left mouse button
	 * @return {OSDAnnotations.Preset|undefined} original preset that has been replaced
	 */
	setPreset(preset=undefined, left=true, cached=true) {
		if (typeof preset === "boolean" && preset) {
			for (let key in this.presets._presets) {
				if (this.presets.exists(key)) {
					preset = this.presets.get(key);
					break;
				}
			}
			if (typeof preset === "boolean") preset = this.presets.addPreset();
		}
		let original = this.presets.getActivePreset(left);
		this.presets.selectPreset(preset?.presetID || preset, left, cached);
		return original;
	}

	checkAnnotation(object) {
		let preset;
		if (object.presetID) {
			preset = this.presets.get(object.presetID);
			if (!preset) {
				console.log("Object refers to an invalid preset: using default one.");
				preset = this.presets.left || this.presets.unknownPreset;
				object.presetID = preset.presetID;
			}
		} else {
			//todo maybe try to find a preset with the exact same color...
			preset = this.presets.left || this.presets.unknownPreset;
			object.presetID = preset.presetID;
		}
		const props = this.presets.getCommonProperties(preset);
		if (!isNaN(object.zoomAtCreation)) {
			props.zoomAtCreation = object.zoomAtCreation;
		}
		if (object.layerID !== undefined) {
			props.layerID = String(object.layerID);
		}

		let factory = object._factory();
		if (!factory) {
			factory = this.getAnnotationObjectFactory(object.type);
			if (!factory) {
				throw "TODO: solve factory deduction - accepts method on factory?";
			} else {
				object.factoryID = factory.factoryID;
			}
		}
		const conf = factory.configure(object, props);
		conf?._factory?.().renderAllControls(conf);

		//todo make sure cached zoom value
		const zoom = this.canvas.getZoom();
		object.internalID = object.internalID || Date.now();
		object.zooming(this.canvas.computeGraphicZoom(zoom), zoom);
	}

	setCloseEdgeMouseNavigation(enable) {
		this.previousEdgeMouseInteractive = this.edgeMouseInteractive;

		if (enable !== this.edgeMouseInteractive && (!enable || this.mode.supportsEdgeNavigation())) {
			this.edgeMouseInteractive = enable;

			window.removeEventListener("mousemove", this._edgesMouseNavigation);
			if (enable) {
				window.addEventListener("mousemove", this._edgesMouseNavigation);
			}

			this.edgeNavDisabledByMode = false;
		}

		return this.edgeMouseInteractive;
	}

	/************************ Layers *******************************/

	/**
	 * Check annotation for layer, assign if not assigned
	 * @param {fabric.Object} ofObject
	 * @return {OSDAnnotations.Layer} layer it belongs to
	 */
	checkLayer(ofObject) {
		if (!ofObject.hasOwnProperty("layerID")) {
			if (this._layer) ofObject.layerID = this._layer.id;
		} else if (!this._layers.hasOwnProperty(ofObject.layerID)) {
			this.createLayer(ofObject.layerID);
		}
	}

	/**
	 * Set current active layer
	 * @param layer layer to set
	 */
	setActiveLayer(layer) {
		if (typeof layer === 'number') layer = this._layers[layer];
		if (this._layer) this._layer.setActive(false);
		this._layer = this._layers[layer.id];
		this._layer.setActive(true);
	}

	/**
	 * Get layer by id
	 * @param {number|string} id
	 * @return {OSDAnnotations.Layer | undefined}
	 */
	getLayer(id=undefined) {
		if (id === undefined) {
			if (!this._layer) this.createLayer();
			return this._layer;
		}
		return this._layers[id];
	}

	/**
	 * Create new layer
	 * @event layer-added
	 * @param {number|string} id optional
	 * @return {OSDAnnotations.Layer}
	 */
	createLayer(id=Date.now()) {
		id = String(id);
		let layer = new OSDAnnotations.Layer(this, id);
		if (!this._layer) this._layer = layer;
		this._layers[id] = layer;
		this.raiseEvent('layer-added', {layer: layer});
		return layer;
	}

	/**
	 * Delete layer
	 * @param id
	 */
	deleteLayer(id) {
		let layer = this._layers[id];
		if (!layer) return;

		const _this = this;
		this.canvas.forEachObject(function (obj) {
			if (obj.layerID === layer.id) _this.deleteObject(obj, false);
		});
		this.raiseEvent('layer-removed', {layer: layer});
		this.canvas.renderAll();
	}

	/**
	 * Iterate layers
	 * @param {function} callback called on layer instances (descending order)
	 */
	forEachLayerSorted(callback) {
		let order = Object.keys(this._layers);
		order.sort((x, y) => this._layers[x] - this._layers[y]);
		for (let id of order) {
			callback(this._layers[id]);
		}
	}

	/**
	 * Sort annotations to reflect current order of layers
	 */
	sortObjects() {
		let _this = this;
		this.canvas._objects.sort((x, y) => {
			if (!x.hasOwnProperty('layerID') || !y.hasOwnProperty('layerID')) return 0;
			return _this._layers[x.layerID].position - _this._layers[y.layerID].position;
		});
		this.canvas.renderAll();
	}

	/************************ Canvas object modification utilities *******************************/

	/**
	 * Add annotation to the canvas without registering it with with available features (history, events...)
	 * @param {fabric.Object} annotation
	 */
	addHelperAnnotation(annotation) {
		annotation.excludeFromExport = true;
		this.canvas.add(annotation);
	}

	/**
	 * Convert helper annotation to fully-fledged annotation
	 * @param {fabric.Object} annotation helper annotation
	 * @param _raise @private
	 * @param _dangerousSkipHistory @private, do not touch!
     * @return {boolean} true if annotation was promoted
	 */
	promoteHelperAnnotation(annotation, _raise=true, _dangerousSkipHistory=false) {
		annotation.off('selected');
		annotation.off('deselected');
		delete annotation.excludeFromExport;
		if (Array.isArray(annotation._objects)) {
			for (let child of annotation._objects) delete child.excludeFromExport;
		}
		annotation.sessionID = this.session;
		annotation.author = XOpatUser.instance().id;
		annotation.created = Date.now();
		annotation.internalID = annotation.instaceID || annotation.created;

        if (!_dangerousSkipHistory) {
            // skip event if skipping history - internal logics
            let cancelFlag = false;
            try {
                this.raiseEvent('annotation-before-create', {
                    object: annotation,
                    isCancelled: () => cancelFlag,
                    setCancelled: (cancelled) => {cancelFlag = cancelled},
                });
            } catch (e) { console.error('Error in annotation-before-create event handler: ', e); }
            if (cancelFlag) return false;
        }

        annotation.on('selected', this._objectClicked.bind(this));
        annotation.on('deselected', this._objectDeselected.bind(this));

        if (!_dangerousSkipHistory) this.history.push(annotation);
        this.canvas.discardActiveObject();
        this.canvas.setActiveObject(annotation);

		if (_raise) this.raiseEvent('annotation-create', {object: annotation});
		this.canvas.renderAll();
        return true;
	}

	/**
	 * Change annotation's `private` property
	 * @param {fabric.Object} annotation Any annotation
	 * @param {boolean} value New value
	 */
	setAnnotationPrivate(annotation, value) {
		if (annotation.private === value) return;
		annotation.private = value;
		this.raiseEvent('annotation-set-private', {object: annotation});
	}

	/**
	 * Check if comments were declared as enabled
	 * @returns {boolean}
	 */
	getCommentsEnabled() {
		return this.commentsEnabled;
	}

	/**
	 * Add comment to annotation
	 * @param {fabric.Object} annotation Any annotation
	 * @param {AnnotationComment} comment Comment to add
	 */
	addComment(annotation, comment) {
		if (!annotation.comments) annotation.comments = [];
		annotation.comments.push(comment);
		this.raiseEvent('annotation-add-comment', {object: annotation, comment});
	}

	/**
	 * Delete comment from annotation
	 * @param {fabric.Object} annotation Any annotation
	 * @param {string} comment Comment ID to delete
	 * @returns {boolean} Whether the comment to delete was found
	 */
	deleteComment(annotation, commentId) {
		if (!annotation.comments) return false;
		const found = annotation.comments.findIndex(c => c.id === commentId);
		if (found === -1) return false;
		// annotation.comments.splice(found, 1);
		annotation.comments[found].removed = true; 
		this.raiseEvent('annotation-delete-comment', {object: annotation, commentId});
		return true;
	}

	/**
	 * Add annotation to the canvas. Annotation will have NEW identity
	 * (unlike helper annotation which is meant for visual purposes only).
	 * If you wish to update annotation (type / geometry) but keep identity,
	 * you must use replaceAnnotation() instead!
	 * @param {fabric.Object} annotation
	 * @param _raise @private
     * @return {boolean} true if annotation was added
	 */
	addAnnotation(annotation, _raise=true) {
		this.addHelperAnnotation(annotation);
		return this.promoteHelperAnnotation(annotation, _raise);
	}

	/**
	 * Change the annotation
	 * @param annotation
	 * @param presetID
	 * @param _raise
     * @return {boolean} true if preset updated
	 */
	changeAnnotationPreset(annotation, presetID, _raise=true) {
		let cancelFlag = false;
		try {
			if (annotation) this.raiseEvent('annotation-before-preset-change', {
				object: annotation,
				isCancelled: () => cancelFlag,
				setCancelled: (cancelled) => {cancelFlag = cancelled},
			});
		} catch (e) { console.error("Error in annotation-before-preset-change handler:", e); }
		if (cancelFlag) return false;

		let factory = annotation._factory();
		if (factory !== undefined) {
			const oldPresetID = annotation.presetID;
			const options = this.presets.getAnnotationOptionsFromInstance(this.presets.get(presetID));
			factory.configure(annotation, options);
			if (_raise) this.raiseEvent('annotation-preset-change', {object: annotation, presetID: presetID, oldPresetID: oldPresetID});
		    return true;
        }
        return false;
	}

	/**
	 * Delete helper annotation, should not be used on full identity
	 * annotation.
	 * @param {fabric.Object} annotation helper annotation
	 */
	deleteHelperAnnotation(annotation) {
		this.canvas.remove(annotation);
	}

	/**
	 * Delete annotation
	 * @param {fabric.Object} annotation
	 * @param _raise @private
     * @return {boolean} true if annotation was deleted
	 */
	deleteAnnotation(annotation, _raise=true) {
		let cancelFlag = false;
		try {
			if (annotation) {
				this.raiseEvent('annotation-before-delete', {
					object: annotation,
					isCancelled: () => cancelFlag,
					setCancelled: (cancelled) => {cancelFlag = cancelled},
				});
			}
		} catch (e) { console.error("Error in annotation-before-delete handler:", e); }
		if (cancelFlag) return false;

		const wasSelected = this.canvas.getActiveObject() === annotation;
		
		annotation.off('selected');
        annotation.off('deselected');
        this.canvas.remove(annotation);
		this.history.push(null, annotation);
		this.canvas.renderAll();

		if (_raise) {
			this.raiseEvent('annotation-delete', {object: annotation});
			if (wasSelected) this.raiseEvent('annotation-deselected', {object: annotation});
		}
        return true;
	}

	/**
	 * Get annotation description from a preset, overriden by own object meta if present
	 * @param {fabric.Object} annotation annotation to describe
	 * @param {string} desiredKey metadata key to read and return
	 * @param {boolean} defaultIfUnknown if false, empty string is returned in case no property was found
	 * @return {string|*} annotation description
	 */
	getAnnotationDescription(annotation, desiredKey="category", defaultIfUnknown=true, withCoordinates=true) {
		let preset = this.presets.get(annotation.presetID);
		if (preset) {
			for (let key in preset.meta) {
				let objmeta = annotation.meta || {}, overridingValue = objmeta[key];
				let metaElement = preset.meta[key];
				if (key === desiredKey) {
					return overridingValue || metaElement.value ||
						(defaultIfUnknown ? this.getDefaultAnnotationName(annotation, withCoordinates) : "");
				}
			}
		}
		return defaultIfUnknown ? this.getDefaultAnnotationName(annotation, withCoordinates) : "";
	}

	/**
	 * Get annotation color as set by attached preset
	 * @param {fabric.Object} annotation
	 * @return {string} css color
	 */
	getAnnotationColor(annotation) {
		let preset = this.presets.get(annotation.presetID);
		if (preset) {
			return preset.color;
		}
		return 'black';
	}

	/**
	 * Get default annotation name
	 * @param {fabric.Object} annotation
	 * @param {boolean} [withCoordinates=true]
	 * @return {string} annotation name created by factory
	 */
	getDefaultAnnotationName(annotation, withCoordinates=true) {
		let factory = annotation._factory();
		if (factory !== undefined) {
			return withCoordinates ? factory.getDescription(annotation) : factory.title();
		}
		return "Unknown annotation.";
	}

	/**
	 * Replace annotation with different one. This must not be done by manual removal and creation of a new instance.
	 * Previous annotation must be already full annotation (promoted). This method also supports **temporal** replacement
	 * of annotation by a doppelganger annotation. Doppelganger annotation is the same (structurally) as helper annotation,
	 * but user expects it to BEHAVE like full annotation (=interactive). Helper annotation is added by addHelperAnnotation,
	 * doppelganger is added by replaceAnnotation(.., dp, false), and must be removed by replaceAnnotation(dp, .., false) later on.
	 * @param {fabric.Object} previous
	 * @param {fabric.Object} next
	 * @param {boolean} isDoppelganger
	 * Example:
	 *  - user selects annotation x and starts modification procedure: replaceAnnotation(x, y, false)
	 *  - user drags mouse, the mouse events result in modification of the new HELPER annotation y that shows
	 *  how user action changes the shape of the original object
	 *  - user releases the mouse: system MUST call replaceAnnotation(y, x, false) that returns the previous
	 *  state and optionally sets the final result by replaceAnnotation(x, y).
	 *
	 *  It is possible to also perform full exchange circle:
	 *  replaceAnnotation(x, y, false)  replaceAnnotation(y, z, false) replaceAnnotation(z, x, false)
	 *  and furthermore use z annotation to e.g. add it back to the canvas.
     * @return {boolean} true if annotation replacemed succeeded
	 */
	replaceAnnotation(previous, next, isDoppelganger=false) {
		// We have to skip history since we will add these to history anyway, avoid duplicate entries

		let cancelFlag = false;
		if (isDoppelganger) {
			try {
				if (previous) this.raiseEvent('annotation-before-replace', {
					object: previous,
					isCancelled: () => cancelFlag,
					setCancelled: (cancelled) => {cancelFlag = cancelled},
				});
			} catch(e) { console.error('Error in annotation-before-replace event handler: ', e); }
		} else {
			try {
				if (previous) this.raiseEvent('annotation-before-replace-doppelganger', {
					object: previous,
					isCancelled: () => cancelFlag,
					setCancelled: (cancelled) => {cancelFlag = cancelled},
				});
			} catch (e) { console.error('Error in annotation-before-replace-doppelganger event handler: ', e); }
		}
		if (cancelFlag) return false;

		if (isDoppelganger) {
			// Uses instance ID to track helper annotations on canvas
			const prevIsBeingReplaced = !!previous.internalID;
			const nextIsBeingReplaced = !!next.internalID;
			if (prevIsBeingReplaced && nextIsBeingReplaced) {
				// step backward, we come full circle (both have record of internalID)
				if (!this.isAnnotation(next)) {
					console.error("[replaceAnnotation] next object must be full annotation when returning to the original state!", previous, next);
					this.canvas.remove(previous);
					return;
				}
				this._trackDoppelganger(next.internalID, previous, next,false);
				delete previous.internalID;
			} else if (prevIsBeingReplaced) {
				// step forward
				this._trackDoppelganger(previous.internalID, previous, next, true);
				next.internalID = previous.internalID;
			} else if (nextIsBeingReplaced) {
				// bad call, previous object must be on a canvas
				console.error("[replaceAnnotation] next object is on a canvas, but previous object not!", previous, next);
			} else {
				// bad call, no object on the canvas
				console.error("[replaceAnnotation] no full annotation object with temporary swap!", previous, next);
			}

		} else {
			if (!this.isAnnotation(previous)) {
				// Try to recover
				console.warn("[replaceAnnotation] annotation is a helper object!", previous);
				this.promoteHelperAnnotation(previous, false, true);
			}

			// !! keep reference of entity identity the same !!
			next.internalID = previous.internalID;
			if (!this.isAnnotation(next)) {
				this.promoteHelperAnnotation(next, false, true);
			}
		}

		const wasActive = (this.canvas.getActiveObject() === previous);
		if (wasActive) {
            this.canvas.discardActiveObject();
		}
		this.canvas.remove(previous);
		previous.off('selected');
		previous.off('deselected');

		this.canvas.add(next);
		this.canvas.renderAll();

		if (isDoppelganger) {
			this.raiseEvent('annotation-replace-doppelganger', {previous, next});
		} else {
			this.history.push(next, previous);
			this.raiseEvent('annotation-replace', {previous, next});
		}
        return true;
	}

	/**
	 * Track doppelganger existence to ensure consistency of canvas
	 * @param id
	 * @param original
	 * @param doppelganger
	 * @param toAdd
	 * @private
	 */
	_trackDoppelganger(id, original, doppelganger, toAdd) {
		if (toAdd) {
			const existing = this._trackedDoppelGangers[id];
			if (existing === original) {
				this._dopperlGangerCount--;
			} else if (existing) {
				console.error("Doppelganger annotation attempt to overwrite existing doppelganger!", id, original, doppelganger);
				// try being consistent
				this.canvas.remove(existing);
				this._dopperlGangerCount--;
			}

			this._trackedDoppelGangers[id] = doppelganger;
			this._dopperlGangerCount++;
		} else {
			if (!this._trackedDoppelGangers[id]) {
				console.error("Doppelganger annotation not consistently tracked!", id, original, doppelganger);
			}
			delete this._trackedDoppelGangers[id];
			this._dopperlGangerCount--;
		}
	}

	/**
	 * Check whether object is full annotation (not a helper or doppelganger)
	 * @param {fabric.Object} o
	 * @return {boolean}
	 */
	isAnnotation(o) {
		return o.hasOwnProperty("incrementId") && o.hasOwnProperty("sessionID");
	}

	/**
	 * Find annotations by a predicate
	 * @param callback
	 * @return {*}
	 */
	find(callback) {
		return this.canvas._objects.find(callback);
	}

	filter(callback) {
		return this.canvas._objects.filter(callback);
	}

	/**
	 * Delete object without knowledge of its identity (fully-fledged annotation or helper one)
	 * @param {fabric.Object} o
	 * @param _raise @private
	 */
	deleteObject(o, _raise=true) {
		this._deletedObject = o;
		if (this.isAnnotation(o)) this.deleteAnnotation(o, _raise);
		else this.deleteHelperAnnotation(o);
	}

	/**
	 * Focus object without highlighting the focus within the board
	 * @param {object|fabric.Object} object
	 * @param {number|undefined} incremendId set to object id if highligh should take place and
	 * 	focus item is not an instance of fabric.Object
	 */
	focusObjectOrArea(object, incremendId=undefined) {
		if (object.incrementId) {
			object = this.history._getFocusBBox(object);
		}
		this.history._focus(object, incremendId);
	}

	/**
	 * Find all objects that intersects with target bbox
	 * @param bbox
	 * @param {function} transformer transform object somehow, if falsey value returned the object is skipped
	 * @returns {[fabric.Object]}
	 */
	findIntersectingObjectsByBBox(bbox, transformer=x => x) {
		// Cache all targets where their bounding box contains point.
		const objects = this.canvas._objects;
		let targets = [], i = objects.length;
		while (i--) {
			const object = objects[i];
			const coords = object.aCoords;
			if (OSDAnnotations.PolygonUtilities.intersectAABB(bbox, {
					x: coords.tl.x,
					y: coords.tl.y,
					width: coords.br.x - coords.tl.x,
					height: coords.br.y - coords.tl.y
				}
			)) {
				const result = transformer(object);
				result && targets.push(result);
			}
		}
		return targets;
	}

	/**
	 * Undo action, handled by either a history implementation, or the current mode
	 */
	undo() {
		const can = this.mode.canUndo();
		if (can === undefined) return this.history.back();
		this.mode.undo();
		this.raiseEvent('history-change');
	}

	/**
	 * Redo action, handled by either a history implementation, or the current mode
	 */
	redo() {
		const can = this.mode.canRedo();
		if (can === undefined) return this.history.redo();
		this.mode.redo();
		this.raiseEvent('history-change');
	}

	/**
	 * Check if undo can be performed, returns true/false. Called does not know wheter undo is being handled
	 * on the history or active mode level.
	 * @return {boolean}
	 */
	canUndo() {
		const can = this.mode.canUndo();
		if (can !== undefined) return can;
		return this.history.canUndo();
	}

	/**
	 * Check if redo can be performed, returns true/false. Called does not know wheter undo is being handled
	 * on the history or active mode level.
	 * @return {boolean}
	 */
	canRedo() {
		const can = this.mode.canRedo();
		if (can !== undefined) return can;
		return this.history.canRedo();
	}

	/**
	 * Clear fabric selection (of any kind)
	 */
	clearSelection() {
		this.canvas.selection = false;
	}

	/**
	 * Deselect active object (single)
	 */
	deselectFabricObjects() {
		this.canvas.discardActiveObject().renderAll();
	}

	/**
	 * Delete currently active object
	 * @param {boolean} [withWarning=true] whether user should get warning in case action did not do anything
	 */
	removeActiveObject(withWarning=true) {
		let toRemove = this.canvas.getActiveObject();
		if (toRemove) {
			this.deleteObject(toRemove);
		} else if (withWarning) {
			Dialogs.show("Please select the annotation you would like to delete", 3000, Dialogs.MSG_INFO);
		}
	}

	/**
	 * Delete all annotations
	 */
	deleteAllAnnotations() {
		for (let facId in this.objectFactories) {
			if (!this.objectFactories.hasOwnProperty(facId)) continue;
			this.objectFactories[facId].finishDirect();
		}

		let objects = this.canvas.getObjects();
		if (!objects || objects.length === 0) return;

		let objectsLength = objects.length;
		for (let i = 0; i < objectsLength; i++) {
			this.deleteObject(objects[objectsLength - i - 1]);
		}
	}

	/**
	 * Update single object visuals
	 * @param {fabric.Object} object
	 * @return {boolean} true on update success
	 */
	updateSingleAnnotationVisuals(object) {
		let preset = this.presets.get(object.presetID);
		if (preset) {
			const factory = this.getAnnotationObjectFactory(object.factoryID);
			const visuals = {...this.presets.commonAnnotationVisuals};
			factory.updateRendering(object, preset, visuals, visuals);
			return true;
		}
		// todo consider adding such preset
		console.warn("[updateSingleAnnotationVisuals] annotation does not have according preset!", object);
		return false;
	}

	/**
	 * Update all object visuals
	 * @type function
	 */
	updateAnnotationVisuals = UTILITIES.makeThrottled(() => {
		this.canvas.getObjects().forEach(o => this.updateSingleAnnotationVisuals(o));
		this.canvas.requestRenderAll();
		this.history.forEachHistoryCacheObject(o => this.updateSingleAnnotationVisuals(o), true);
		this.raiseEvent('visual-property-changed', {visuals: this.presets.commonAnnotationVisuals});
	}, 180);

	/**
	 * Set annotation visual property to permanent value
	 * @param {string} propertyName one of OSDAnnotations.CommonAnnotationVisuals keys
	 * @param {any} propertyValue value for the property
	 */
	setAnnotationCommonVisualProperty(propertyName, propertyValue) {
		if (this.presets.setCommonVisualProp(propertyName, propertyValue)) {
			this.updateAnnotationVisuals();
		}
	}

	/**
	 * Get annotations visual property
	 * @param {string} propertyName one of OSDAnnotations.CommonAnnotationVisuals keys
	 * @return {*}
	 */
	getAnnotationCommonVisualProperty(propertyName) {
		return this.presets.getCommonVisualProp(propertyName);
	}

	/**
	 * Create preset cache, this cache is loaded automatically with initPostIO request
	 * @return {boolean}
	 */
	async createPresetsCookieSnapshot() {
		if (this._storeCacheSnapshots) {
			return await this.cache.set('presets', JSON.stringify(this.presets.toObject()));
		}
	}

	/**
	 * Load cookies cache if available
	 */
	async loadPresetsCookieSnapshot(ask=true) {
		if (!this._storeCacheSnapshots) return;

		const presets = this.presets;
		const presetCookiesData = this.cache.get('presets');

		if (presetCookiesData) {
			// todo this might be invalid since snapshot is imported before load of other functionality..
			if (ask && this.presets._presetsImported) {
				this.warn({
					code: 'W_CACHE_IO_OMMITED',
					message: 'There are presets available in the cache, but did not load since different presets were imported from data.<a onclick="OSDAnnotations.instance().loadPresetsCookieSnapshot(false);" class="pointer">Load anyway.</a>',
				});
				return;
			}
			try {
				await presets.import(presetCookiesData);
			} catch (e) {
				console.error(e);
				this.warn({
					error: e, code: "W_COOKIES_DISABLED",
					message: "Could not load presets. Please, let us know about this issue and provide exported file.",
				});
			}
		}
	}

	_computeObjectStroke(obj) {
		if (
			!obj.id ||
			!this.user
		) return;

		if (this.user.id === obj.author) return;

		const author = this.mapAuthorCallback?.(
			obj.author,
			obj.authorType
		);
		
		if (
			!author ||
			author === this.user.id
		) return;

		const authorConfig = this.getAuthorConfig(author);

		if (authorConfig.ignoreCustomStyling) return;

		return {
			dash: [
				authorConfig.borderDashing * 10,
				Math.min(authorConfig.borderDashing * 5, 200)
			],
			color: authorConfig.borderColor,
			width: Math.max(obj.strokeWidth, 3)
		};
	}

	/********************* AUTHOR CONFIGURATION **********************/

	/**
	 * Set a callback to get author ID in form matching XOpatUser.id
	 * @param {(authorId: string, authorType?: string) => string | null} callback Function used to return expected author ID, or null to skip computation for this user.
	 */
	setAuthorGetter(callback) {
		this.mapAuthorCallback = callback;
	}

	/**
	 * Enable or disable per author styling
	 * @param {boolean} enable 
	 */
	toggleStrokeStyling(enable) {
		this.strokeStyling = enable;
		this.raiseEvent('author-annotation-styling-toggle', {enable});
		this.canvas.requestRenderAll();
	}

	/**
	 * Get all authors configuration from cache
	 * @return {Record<string, AuthorConfig>} authors configuration object
	 */
	getAuthorsConfig() {
		try {
			const stored = this.cache.get('authors-config');
			return stored ? JSON.parse(stored) : {};
		} catch (e) {
			console.warn('Failed to parse authors config:', e);
			return {};
		}
	}

	/**
	 * Set all authors configuration to cache
	 * @param {Record<string, AuthorConfig>} authorsConfig authors configuration object
	 */
	setAuthorsConfig(authorsConfig) {
		this.cache.set('authors-config', JSON.stringify(authorsConfig));
		this.canvas.requestRenderAll();
	}

	/**
	 * Generate a truly random hex color
	 * @return {string} random hex color
	 */
	generateRandomColor() {
		return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
	}

	/**
	 * Get author configuration with defaults
	 * @param {string} authorId author identifier
	 * @return {AuthorConfig} author configuration
	 */
	getAuthorConfig(authorId) {
		const authorsConfig = this.getAuthorsConfig();
		let config = authorsConfig[authorId];
		
		if (!config) {
			config = {
				shown: true,
				borderColor: this.generateRandomColor(),
				borderDashing: 10,
				ignoreCustomStyling: false
			};
			// Save the new config immediately to prevent regeneration
			this.setAuthorConfig(authorId, config);
		}
		
		return {
			shown: true,
			borderColor: this.generateRandomColor(),
			borderDashing: 10,
			ignoreCustomStyling: false,
			...config
		};
	}

	/**
	 * Set author configuration
	 * @param {string} authorId author identifier
	 * @param {Partial<AuthorConfig>} config configuration to merge
	 */
	setAuthorConfig(authorId, config) {
		const authorsConfig = this.getAuthorsConfig();
		const currentConfig = authorsConfig[authorId] || {};
		const newConfig = { ...currentConfig, ...config };
		authorsConfig[authorId] = newConfig;
		this.setAuthorsConfig(authorsConfig);
	}

	/**
	 * Toggle author shown/hidden state
	 * @param {string} authorId author identifier
	 */
	toggleAuthorShown(authorId) {
		const config = this.getAuthorConfig(authorId);
		config.shown = !config.shown;
		this.setAuthorConfig(authorId, config);
	}

	/**
	 * Update author border color
	 * @param {string} authorId author identifier
	 * @param {string} color hex color string
	 */
	updateAuthorBorderColor(authorId, color) {
		this.setAuthorConfig(authorId, { borderColor: color });
	}

	/**
	 * Update author border dashing
	 * @param {string} authorId author identifier
	 * @param {number} dashing dashing value (1-50)
	 */
	updateAuthorBorderDashing(authorId, dashing) {
		this.setAuthorConfig(authorId, { borderDashing: Math.max(1, Math.min(50, parseInt(dashing) || 10)) });
	}

	/**
	 * Update author ignore custom styling setting
	 * @param {string} authorId author identifier
	 * @param {boolean} ignoreCustomStyling whether to ignore custom styling
	 */
	updateAuthorIgnoreCustomStyling(authorId, ignoreCustomStyling) {
		this.setAuthorConfig(authorId, { ignoreCustomStyling: !!ignoreCustomStyling });
	}

	/********************* PRIVATE **********************/

	_init() {
		//Consider http://fabricjs.com/custom-control-render
		// can maybe attach 'edit' button controls to object...
		// note the board would have to reflect the UI state when opening

		const _this = this;
		
		/**
		 * Attach factory getter to each object
		 */
		fabric.Object.prototype._factory = function () {
			const factory = _this.getAnnotationObjectFactory(this.factoryID);
			if (factory) this._factory = () => factory;
			else if (this.factoryID) {
				console.warn("Object", this.type, "has no associated factory for: ",  this.factoryID);
				//maybe provide general implementation that can do nearly nothing
			}
			return factory;
		}
		fabric.Object.prototype.zooming = function(zoom, _realZoom) {
			this._factory()?.onZoom(this, zoom, _realZoom);
		}

		const __renderStroke = fabric.Object.prototype._renderStroke;
		fabric.Object.prototype._renderStroke = function(ctx) {
			if (!_this.strokeStyling) {
				return __renderStroke.call(this, ctx);
			}
			const oDash = this.strokeDashArray;
			const oColor = this.stroke;
			const oWidth = this.strokeWidth;

			const { dash, color, width } = _this._computeObjectStroke(this) || {};
			if (dash !== undefined)  this.strokeDashArray = dash;
			if (color !== undefined) this.stroke  = color;
			if (width !== undefined) this.strokeWidth = width;

			try {
				return __renderStroke.call(this, ctx);
			} finally {
				this.strokeDashArray = oDash;
				this.stroke = oColor;
				this.strokeWidth = oWidth;
			}
		};


		this.Modes = {
			AUTO: new OSDAnnotations.AnnotationState(this, "", "", ""),
		};
		this.mode = this.Modes.AUTO;
		this.disabledInteraction = false;
		this.autoSelectionEnabled = VIEWER.hasOwnProperty("bridge");
		this.objectFactories = {};
		this._extraProps = ["objects"];
		this._wasModeFiredByKey = false;
		this._trackedDoppelGangers = {};
		this._dopperlGangerCount = 0;
		this._storeCacheSnapshots = this.getStaticMeta("storeCacheSnapshots", false);
		this._exportPrivateAnnotations = APPLICATION_CONTEXT.getOption("exportPrivate", this.getStaticMeta("exportPrivate", false));
		this.cursor = {
			mouseTime: Infinity, //OSD handler click timer
			isDown: false,  //FABRIC handler click down recognition
		};
		this.strokeStyling = false;

		let refTileImage = VIEWER.scalebar.getReferencedTiledImage() || VIEWER.world.getItemAt(0);
		this.overlay = VIEWER.fabricjsOverlay({
			scale: refTileImage.source.dimensions ?
				refTileImage.source.dimensions.x : refTileImage.source.Image.Size.Width,
			fireRightClick: true
		});
		this.overlay.resizecanvas(); //if plugin loaded at runtime, 'open' event not called

		// this._debugActiveObjectBinder();

		/**
		 * Preset Manager reference
		 * @member {OSDAnnotations.PresetManager}
		 */
		this.presets = new OSDAnnotations.PresetManager("presets", this);
		/**
		 * History reference
		 * @member {OSDAnnotations.History}
		 */
		this.history = new OSDAnnotations.History("history", this, this.presets);
		this.history.size = 50;
		/**
		 * FreeFormTool reference
		 * @member {OSDAnnotations.FreeFormTool}
		 */
		this.freeFormTool = new OSDAnnotations.FreeFormTool("freeFormTool", this);
		/**
		 * Automatic object creation strategy reference
		 * @member {OSDAnnotations.AutoObjectCreationStrategy}
		 */
		this.automaticCreationStrategy = VIEWER.bridge ?
			new OSDAnnotations.RenderAutoObjectCreationStrategy("automaticCreationStrategy", this) :
			new OSDAnnotations.AutoObjectCreationStrategy("automaticCreationStrategy", this);

		//after properties initialize
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Group, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Polyline, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Line, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Point, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Text, false);
		// OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Image, false);

		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Rect, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Ellipse, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Ruler, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Polygon, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Multipolygon, false);

		/**
		 * Polygon factory, the factory required within the module
		 * @type {OSDAnnotations.AnnotationObjectFactory}
		 */
		this.polygonFactory = this._requireAnnotationObjectPresence("polygon");
		/**
		 * Multipolygon factory, the factory required within the module
		 * @type {OSDAnnotations.AnnotationObjectFactory}
		 */
		this.multiPolygonFactory = this._requireAnnotationObjectPresence("multipolygon");


		this._layers = {};
		if (Object.keys(this._layers).length < 1) this.createLayer();
		this.setMouseOSDInteractive(true, false);
	}

	_requireAnnotationObjectPresence(type) {
		//When object type presence is a must
		if (this.objectFactories.hasOwnProperty(type)) {
			//create tool-shaped object
			return this.objectFactories[type];
		}
		console.warn("See list of factories available: missing", type, this.objectFactories);
		throw `No ${type} object factory registered. Annotations must contain at least a polygon implementation 
in order to work. Did you maybe named the ${type} factory implementation differently other than '${type}'?`;
	}

	_debugActiveObjectBinder() {
		this.canvas.__eventListeners = {};
		const get = this.canvas.getActiveObject.bind(this.canvas);
		let self = this;
		this.canvas.getActiveObject = function() {
			let e = get();
			console.log("GET", e ? e.selectable : "", e, self.canvas._activeObject);
			return e;
		};
		const set = this.canvas.setActiveObject.bind(this.canvas);
		this.canvas.setActiveObject = function(e, t) {
			console.log("SET", e, t);
			return set(e, t);
		};
		const disc = this.canvas._discardActiveObject.bind(this.canvas);
		this.canvas._discardActiveObject = function(e, t) {
			console.log("DISCARD", e, self.canvas.__eventListeners);
			return disc(e, t);
		};
	}

	_setListeners() {
		const _this = this;
		VIEWER.addHandler('key-down', e => this._keyDownHandler(e));
		VIEWER.addHandler('key-up', e => this._keyUpHandler(e));
		//Window switch alt+tab makes the mode stuck
		window.addEventListener("focus", e => {
			if (this._wasModeFiredByKey) {
				this.setMode(this.Modes.AUTO);
			}
		}, false);
		// window.addEventListener("blur", e => _this.setMode(_this.Modes.AUTO), false);
		VIEWER.addHandler('screenshot', e => {
			e.context2D.drawImage(this.canvas.getElement(), 0, 0);
		});

		/**************************************************************************************************
		   Click Handlers
		   Input must be always the event invoked by the user input and point in the image coordinates
		   (absolute pixel position in the scan)
		**************************************************************************************************/

		let screenToPixelCoords = function (x, y) {
			//cannot use VIEWER.scalebar.imagePixelSizeOnScreen() because of canvas margins
			return VIEWER.scalebar.getReferencedTiledImage().windowToImageCoordinates(new OpenSeadragon.Point(x, y));
		}.bind(this);

		//prevents event bubling if the up event was handled by annotations
		function handleRightClickUp(event) {
			if (_this.disabledInteraction) return;
			if (!_this.cursor.isDown) {
				//todo in auto mode, this event is fired twice!! fix
				if (_this.cursor.mouseTime === Infinity) {
					_this.raiseEvent('nonprimary-release-not-handled', {
						originalEvent: event,
						pressTime: _this.cursor.abortedTime
					});
				}
				_this.cursor.mouseTime = -1;
				return;
			}

			let factory = _this.presets.right ? _this.presets.right.objectFactory : undefined;
			let point = screenToPixelCoords(event.x, event.y);
			if (_this.mode.handleClickUp(event, point, false, factory)) {
				event.preventDefault();
			} else {
				//todo better system by e.g. unifying the events, allowing cancellability and providing only interface to modes
				_this.raiseEvent('nonprimary-release-not-handled', {
					originalEvent: event,
					pressTime: _this.cursor.mouseTime === Infinity ? _this.cursor.abortedTime : _this.cursor.mouseTime
				});
			}

			_this.cursor.isDown = false;
		}

		function handleRightClickDown(event) {
			if (_this.cursor.isDown || _this.disabledInteraction) return;

			_this.cursor.mouseTime = Date.now();
			_this.cursor.isDown = true;

			let factory = _this.presets.right ? _this.presets.right.objectFactory : undefined;
			let point = screenToPixelCoords(event.x, event.y);
			_this.mode.handleClickDown(event, point, false, factory);
		}

		function handleLeftClickUp(event) {
			if (_this.disabledInteraction) return;
			if (!_this.cursor.isDown) {
				//todo in auto mode, this event is fired twice!! fix
				if (_this.cursor.mouseTime === Infinity) {
					_this.raiseEvent('canvas-release', {
						originalEvent: event,
						pressTime: _this.cursor.abortedTime
					});
				}
				_this.cursor.mouseTime = -1;
				return;
			}

			let factory = _this.presets.left ? _this.presets.left.objectFactory : undefined;
			let point = screenToPixelCoords(event.x, event.y);
			if (_this.mode.handleClickUp(event, point, true, factory)) {
				event.preventDefault();
			} else /*if (!_this.isModeAuto())*/ {
				//todo better system by e.g. unifying the events, allowing cancellability and providing only interface to modes
				_this.raiseEvent('canvas-release', {
					originalEvent: event,
					pressTime: _this.cursor.mouseTime === Infinity ? _this.cursor.abortedTime : _this.cursor.mouseTime
				});
			}

			_this.cursor.isDown = false;
		}

		function handleLeftClickDown(event) {
			if (_this.cursor.isDown || _this.disabledInteraction) return;

			_this.cursor.mouseTime = Date.now();
			_this.cursor.isDown = true;

			let factory = _this.presets.left ? _this.presets.left.objectFactory : undefined;
			if (!factory) {
				// try to recover
				const presets = _this.presets.getExistingIds();
				if (presets.length > 0) {
					factory = presets[0];
					_this.setPreset(factory, true);
				}
			}
			let point = screenToPixelCoords(event.x, event.y);
			_this.mode.handleClickDown(event, point, true, factory);
		}

		/****** E V E N T  L I S T E N E R S: FABRIC (called when not navigating) **********/

        // annotationCanvas.addEventListener("mousedown", function (event) {
        this.canvas.on('mouse:down', function(e) {
            if (_this.disabledInteraction || (!_this.mode.supportsZoomAnimation() && _this.mode.isZooming)) return;
            const event = e.e;
            if (event.which === 1) handleLeftClickDown(event);
            else if (event.which === 3) handleRightClickDown(event);
        });

        // annotationCanvas.addEventListener('mouseup', function (event) {
        this.canvas.on('mouse:up', function(e) {
            if (_this.disabledInteraction) return;
            const event = e.e;
            if (event.which === 1) handleLeftClickUp(event);
            else if (event.which === 3) handleRightClickUp(event);
        });

        // let annotationCanvas = this.canvas.upperCanvasEl;
		// annotationCanvas.addEventListener("mousedown", function (event) {
		// 	if (_this.disabledInteraction || (!_this.mode.supportsZoomAnimation() && _this.mode.isZooming)) return;
        //
		// 	if (event.which === 1) handleLeftClickDown(event);
		// 	else if (event.which === 3) handleRightClickDown(event);
		// });
        //
		// annotationCanvas.addEventListener('mouseup', function (event) {
		// 	if (_this.disabledInteraction) return;
        //
		// 	if (event.which === 1) handleLeftClickUp(event);
		// 	else if (event.which === 3) handleRightClickUp(event);
		// });

		this.canvas.on('mouse:move', function (o) {
			if (_this.disabledInteraction) return;
			if (_this.cursor.isDown) {
				_this.mode.handleMouseMove(o.e, screenToPixelCoords(o.e.x, o.e.y));
			} else {
				_this.mode.handleMouseHover(o.e, screenToPixelCoords(o.e.x, o.e.y));
			}
		});

		this.canvas.on('mouse:wheel', function (o) {
			if (_this.disabledInteraction) return;

			if (_this.isModeAuto() || _this._wasModeFiredByKey || o.e.shiftKey) {
				_this.mode.scroll(o.e, o.e.deltaY);
			} else {
				if (!_this.mode.supportsZoomAnimation() && _this.cursor.isDown) handleLeftClickUp(o.e);

				_this._fireMouseWheelNavigation(o.e);
				_this.mode.scrollZooming(o.e, o.e.deltaY);
			}
		});

		/****** E V E N T  L I S T E N E R S: OSD  (called when navigating) **********/

		VIEWER.addHandler("animation-start", function() {
			Object.values(_this.Modes).forEach(mode => mode.onZoomStart());
		});

		VIEWER.addHandler("animation-finish", function() {
			Object.values(_this.Modes).forEach(mode => mode.onZoomEnd());
		});

        // OSD Blocks event when such event is taken care of (e.g. navigation) -> relay it to fabric
		VIEWER.addHandler("canvas-press", function (e) {
            _this.canvas._onMouseDown(e.originalEvent);
        });
		VIEWER.addHandler("canvas-release", function (e) {
            _this.canvas._onMouseUp(e.originalEvent);
        });
		VIEWER.addHandler("canvas-nonprimary-press", function (e) {
            _this.canvas._onMouseDown(e.originalEvent);
		});
		VIEWER.addHandler("canvas-nonprimary-release", function (e) {
            _this.canvas._onMouseUp(e.originalEvent);
        });

		// Wheel while viewer runs not enabled because this already performs zoom.
		// VIEWER.addHandler("canvas-scroll", function (e) { ... });

		// Rewrite with bind this arg to use in events
		this._edgesMouseNavigation = this._edgesMouseNavigation.bind(this);
	}

	static _registerAnnotationFactory(FactoryClass, atRuntime) {
		let _this = this.instance();
		let factory = new FactoryClass(_this, _this.automaticCreationStrategy, _this.presets);
		if (_this.objectFactories.hasOwnProperty(factory.factoryID)) {
			throw `The factory ${FactoryClass} conflicts with another factory: ${factory.factoryID}`;
		}
		_this.objectFactories[factory.factoryID] = factory;
		if (atRuntime) _this.raiseEvent('factory-registered', {factory: factory});
	}

	_setModeFromAuto(mode) {
		UTILITIES.setIsCanvasFocused(true);
		if (mode.setFromAuto()) {
			this.mode = mode;
			this.raiseEvent('mode-changed', {mode: this.mode});

			if (this.edgeNavDisabledByMode) this.setCloseEdgeMouseNavigation(this.previousEdgeMouseInteractive);

			if (!this.mode.supportsEdgeNavigation()) {
				this.setCloseEdgeMouseNavigation(false);
				this.edgeNavDisabledByMode = true;
			}
		}
	}

	_setModeToAuto(switching) {
		this._wasModeFiredByKey = false;
		if (this.presets.left) this.presets.left.objectFactory.finishIndirect();
		if (this.presets.right) this.presets.right.objectFactory.finishIndirect();

		if (this.mode.setToAuto(switching)) {
			this.raiseEvent('mode-changed', {mode: this.Modes.AUTO});

			this.mode = this.Modes.AUTO;
			this.canvas.hoverCursor = "pointer";
			this.canvas.defaultCursor = "grab";
		}
	}

	_getModeByKeyEvent(e) {
		for (let key in this.Modes) {
			if (this.Modes.hasOwnProperty(key)) {
				let mode = this.Modes[key];
				if (mode.accepts(e)) return mode;
			}
		}
		return undefined;
	}

	_keyDownHandler(e) {
		// switching mode only when no mode AUTO and mouse is up
		if (this.cursor.isDown || this.disabledInteraction || !e.focusCanvas) return;

		let modeFromCode = this._getModeByKeyEvent(e);
		if (modeFromCode) {
			this._wasModeFiredByKey = true;
			this.setMode(modeFromCode);
			e.preventDefault();
		}
	}

	_keyUpHandler(e) {
		if (this.disabledInteraction) return;

		if (e.focusCanvas) {
			if (!e.ctrlKey && !e.altKey) {
				if (e.key === "Delete" || e.key === "Backspace") {
					this.mode.discard(true);
					return;
				}
				if (e.key === "Escape") {
					this.deselectFabricObjects();  // this ensures discard does not delete created object!
					this.mode.discard(false);
					this.history._boardItemSave();
					this.setMode(this.Modes.AUTO);
					return;
				}
			}

			if (e.ctrlKey && !e.altKey && (e.key === "z" || e.key === "Z")) {
				return e.shiftKey ? this.redo() : this.undo();
			}
		}

		if (this.mode.rejects(e)) {
			this.setMode(this.Modes.AUTO);
			e.preventDefault();
		}
	}

	_objectDeselected(event) {
		if (this.disabledInteraction || !event.target) return;
		this.raiseEvent('annotation-deselected', {object: event.target});

		//todo make sure deselect prevent does not prevent also deletion
		try {
			if (!this.mode.objectDeselected(event, event.target) && this._deletedObject !== event.target) {
				this.disabledInteraction = true;
				this.canvas.setActiveObject(event.target);
				this.disabledInteraction = false;
			}
		} catch (e) {
			console.error(e);
		}
	}

	_objectClicked(event) {
		if (this.disabledInteraction) return;
		let object = event.target;

		try {
			if (!this.mode.objectSelected(event, object)) {
				this.context.disabledInteraction = true;
				this.context.canvas.discardActiveObject();
				this.context.disabledInteraction = false;
			} else {
				this.history.highlight(object);
				if (this.history.isOngoingEditOf(object)) {
					if (this.isMouseOSDInteractive()) {
						object.set({
							hasControls: false,
							lockMovementX: true,
							lockMovementY: true
						});
					}
				} else {
					let factory = this.getAnnotationObjectFactory(object.factoryID);
					if (factory) {
						factory.selected(object);
						this.raiseEvent('annotation-selected', {object});
					}
				}
			}
		} catch (e) {
			console.error(e);
		}
	}

	_loadObjects(input, clear, inheritSession = false) {
		//from loadFromJSON implementation in fabricJS
		const _this = this.canvas, self = this;
		const multipolygonFactory = this.multiPolygonFactory;

		// If we get already fabric.js objects, avoid passing them to enlivenObjects
		const fabricObjects = [];
		const nonFabricObjects = [];
		for (let obj of input.objects) {
			if (obj instanceof fabric.Object) {
				fabricObjects.push(obj);
			} else {
				// TODO Dirty patch, detect factory and forward before-import hook via its API
				if (obj.type === 'path' && obj.points && !obj.path) {
					obj.path = multipolygonFactory._createPathFromPoints(obj.points);
				}
				nonFabricObjects.push(obj);
			}
		}

		return fabric.util.enlivenObjects(nonFabricObjects, objects => {
		 if (clear) this.canvas.clear();
			let insertion = 0;

			function initObject(obj) {
				if (inheritSession && !obj.sessionID) {
					obj.sessionID = self.session;
				}
				self.checkLayer(obj);
				self.checkAnnotation(obj);
				obj.on('selected', self._objectClicked.bind(self));
				obj.on('deselected', self._objectDeselected.bind(self));
				_this.insertAt(obj, insertion++);
			}

			for (let obj of objects) {
				initObject(obj);
			}

			// Process also enlivenObjects - avoided items
			for (let obj of fabricObjects) {
				initObject(obj);
			}
			self.history.assignIDs(_this.getObjects());
		});
	}

	_edgesMouseNavigation(e) {
		if (this.mode !== this.Modes.AUTO) {
			const edgeThreshold = 20;
			const mouseX = e.clientX;
			const mouseY = e.clientY;

			const nearLeftEdge = mouseX >= 0 && edgeThreshold - mouseX;
			const nearTopEdge = mouseY >= 0 && edgeThreshold / 2 - mouseY; //top edge near
			const nearRightEdge = mouseX - window.innerWidth + edgeThreshold;
			const nearBottomEdge = mouseY - window.innerHeight + edgeThreshold;

			if (
				(nearTopEdge < edgeThreshold && nearTopEdge > 0) ||
				(nearRightEdge < edgeThreshold && nearRightEdge > 0) ||
				(nearBottomEdge < edgeThreshold && nearBottomEdge > 0) ||
				(nearLeftEdge < edgeThreshold && nearLeftEdge > 0)
			) {
				const center = VIEWER.viewport.getCenter(true);
				const current = VIEWER.viewport.windowToViewportCoordinates(new OpenSeadragon.Point(e.x, e.y));
				let direction = current.minus(center);
				direction = direction.divide(Math.sqrt(Math.pow(direction.x, 2) + Math.pow(direction.y, 2)));
				VIEWER.viewport.panTo(direction.times(0.004 / VIEWER.scalebar.imagePixelSizeOnScreen()).plus(center));
			}
		}
	};

	// Copied out of OpenSeadragon private code scope to allow manual scroll navigation
	_fireMouseWheelNavigation(event) {
		// Simulate a 'wheel' event
		const tracker = VIEWER.innerTracker;
		const simulatedEvent = {
			target:     event.target || event.srcElement,
			type:       "wheel",
			shiftKey:   event.shiftKey || false,
			clientX:    event.clientX,
			clientY:    event.clientY,
			pageX:      event.pageX ? event.pageX : event.clientX,
			pageY:      event.pageY ? event.pageY : event.clientY,
			deltaMode:  event.type === "MozMousePixelScroll" ? 0 : 1, // 0=pixel, 1=line, 2=page
			deltaX:     0,
			deltaZ:     0
		};

		// Calculate deltaY
		if ( OpenSeadragon.MouseTracker.wheelEventName === "mousewheel" ) {
			simulatedEvent.deltaY = -event.wheelDelta / OpenSeadragon.DEFAULT_SETTINGS.pixelsPerWheelLine;
		} else {
			simulatedEvent.deltaY = event.deltaY;
		}
		const originalEvent = event;
		event = simulatedEvent;

		var nDelta, eventInfo, eventArgs = null;
		nDelta = event.deltaY < 0 ? 1 : -1;
		eventInfo = {
			originalEvent: event,
			eventType: 'wheel',
			pointerType: 'mouse',
			isEmulated: event !== originalEvent,
			eventSource: tracker,
			eventPhase: event ? ((typeof event.eventPhase !== 'undefined') ? event.eventPhase : 0) : 0,
			defaultPrevented: OpenSeadragon.eventIsCanceled( event ),
			shouldCapture: false,
			shouldReleaseCapture: false,
			userData: tracker.userData,
			isStoppable: true,
			isCancelable: true,
			preventDefault: false,
			preventGesture: !tracker.hasScrollHandler,
			stopPropagation: false,
		};

		if ( tracker.preProcessEventHandler ) {
			tracker.preProcessEventHandler( eventInfo );
		}

		if ( tracker.scrollHandler && !eventInfo.preventGesture && !eventInfo.defaultPrevented ) {
			eventArgs = {
				eventSource:          tracker,
				pointerType:          'mouse',
				position:             OpenSeadragon.getMousePosition( event ).minus( OpenSeadragon.getElementOffset( tracker.element )),
				scroll:               nDelta,
				shift:                event.shiftKey,
				isTouchEvent:         false,
				originalEvent:        originalEvent,
				preventDefault:       eventInfo.preventDefault || eventInfo.defaultPrevented,
				userData:             tracker.userData
			};
			tracker.scrollHandler( eventArgs );
		}
		if ( eventInfo.stopPropagation ) {
			OpenSeadragon.stopEvent( originalEvent );
		}
		if (( eventArgs && eventArgs.preventDefault ) || ( eventInfo.preventDefault && !eventInfo.defaultPrevented ) ) {
			OpenSeadragon.cancelEvent( originalEvent );
		}
	}
};

/**
 * @classdesc Default annotation state parent class, also a valid mode (does nothing).
 * 	The annotation mode defines how it is turned on (key shortcuts) and how it
 *  drives the user control over this module
 * @class {OSDAnnotations.AnnotationState}
 */
OSDAnnotations.AnnotationState = class {
	/**
	 * Constructor for an abstract class of the Annotation Mode. Extending modes
	 * should have only one parameter in constructor which is 'context'
	 * @param {OSDAnnotations} context passed to constructor of children as the only argument
	 * @param {string} id unique id
	 * @param {string} icon icon to use with this mode
	 * @param {string} description description of this mode
	 */
	constructor(context, id, icon, description) {
		/**
		 * @memberOf OSDAnnotations.AnnotationState
		 * @type {string}
		 */
		this._id = id;
		/**
		 * @memberOf OSDAnnotations.AnnotationState
		 * @type {string}
		 */
		this.icon = icon;
		/**
		 * @memberOf OSDAnnotations.AnnotationState
		 * @type {OSDAnnotations}
		 */
		this.context = context;
		/**
		 * @memberOf OSDAnnotations.AnnotationState
		 * @type {string}
		 */
		this.description = description;
		/**
		 * @memberOf OSDAnnotations.AnnotationState
		 * @type {boolean}
		 */
		this.isZooming = false;
	}

	/**
	 * Perform action on mouse up event
	 * @param {TouchEvent | MouseEvent} o original js event
	 * @param {Point} point mouse position in image coordinates (pixels)
	 * @param {boolean} isLeftClick true if left mouse button
	 * @param {OSDAnnotations.AnnotationObjectFactory} objectFactory factory currently bound to the button
	 * @return {boolean} true if the event was handled, i.e. do not bubble up
	 */
	handleClickUp(o, point, isLeftClick, objectFactory) {
		return false;
	}

	/**
	 * Perform action on mouse down event
	 * @param {TouchEvent | MouseEvent} o original js event
	 * @param {Point} point mouse position in image coordinates (pixels)
	 * @param {boolean} isLeftClick true if left mouse button
	 * @param {OSDAnnotations.AnnotationObjectFactory}objectFactory factory currently bound to the button
	 */
	handleClickDown(o, point, isLeftClick, objectFactory) {
		//do nothing
	}

	/**
	 * Handle mouse moving event while the OSD navigation is disabled
	 * NOTE: mouse move in navigation mode is used to navigate, not available
	 * @param {MouseEvent} o original event
	 * @param {Point} point mouse position in image coordinates (pixels)
	 */
	handleMouseMove(o, point) {
		//do nothing
	}

	/**
	 * Handle mouse hovering event while the OSD navigation is disabled
	 * @param {MouseEvent} event
	 * @param {Point} point mouse position in image coordinates (pixels)
	 */
	handleMouseHover(event, point) {
		//do nothing
	}

	/**
	 * Handle scroll event while the OSD navigation is disabled including zoom
	 * @param {Event} event original MouseWheel event
	 * @param {number} delta event.deltaY property, copied out since this is the value we are interested in
	 */
	scroll(event, delta) {
		//do nothing
	}

	/**
	 * Handle scroll event while the OSD navigation is enabled only for zooming
	 * @param {Event} event original MouseWheel event
	 * @param {number} delta event.deltaY property, copied out since this is the value we are interested in
	 */
	scrollZooming(event, delta) {
		//do nothing
	}

	/**
	 * Handle object being deselected.
	 * Warning: thoroughly test that returning false does not break things!
	 * Preventing object from being deselected means no object can be selected
	 * instead, and also the object cannot be deleted.
	 * @param event
	 * @param object
	 * @return {boolean} true to allow deselection
	 */
	objectDeselected(event, object) {
		return true;
	}

	/**
	 * Handle object being selected
	 * Warning: thoroughly test that returning false does not break things!
	 * @param event
	 * @param object
	 * @return {boolean} true to allow selection
	 */
	objectSelected(event, object) {
		return true;
	}

	/**
	 * @private
	 * Some modes have custom controls,
	 * note that behaviour of this is still not very well designed, e.g. if used in one
	 * plugin it should not be used in others
	 * @return {string} HTML for custom controls
	 */
	customHtml() {
		return "";
	}

	/**
	 * Get the mode description
	 * @return {string} mode description
	 */
	getDescription() {
		return this.description;
	}

	/**
	 * Get the mode Google Icons tag
	 * @return {string} icon tag
	 */
	getIcon() {
		return this.icon;
	}

	/**
	 * Get the mode ID
	 * @return {string} mode unique ID
	 */
	getId() {
		return this._id;
	}

	/**
	 * For internal use, abort handleClickDown
	 * so that handleClickUp is not called
	 * @param isLeftClick true if primary button pressed
	 * @param noPresetError raise error event 'W_NO_PRESET'
	 */
	abortClick(isLeftClick, noPresetError=false) {
		this.context.cursor.abortedTime = this.context.cursor.mouseTime;
		this.context.cursor.mouseTime = Infinity;
		this.context.cursor.isDown = false;

		// if user selects mode by other method than hotkey, do not fire error on right click
		// todo consider OSD filter event implementation and letting others decide whether to warn or not
		if (noPresetError && (isLeftClick || !this.context._wasModeFiredByKey)) {
			VIEWER.raiseEvent('warn-user', {
				originType: "module",
				originId: "annotations",
				code: "W_NO_PRESET",
				message: "Annotation creation requires active preset selection!",
				isLeftClick: isLeftClick
			});
		}
	}

	/**
	 * Undo action, by default noop
	 */
	undo() {
	}

	/**
	 * Undo action, by default return undefined: not handled (undo() will not be called)
	 * @return {boolean|undefined} if undefined, makes system fallback to a builtin history
	 */
	canUndo() {
		return undefined;
	}

	/**
	 * Redo action, by default noop
	 */
	redo() {
	}

	/**
	 * Discard action: default deletes active object
	 * @param {boolean} [withWarning=true] whether user should get warning in case action did not do anything
	 */
	discard(withWarning=true) {
		this.context.removeActiveObject(withWarning);
	}

	/**
	 * Redo action, by default return undefined: not handled (redo() will not be called)
	 * @return {boolean|undefined} if undefined, makes system fallback to a builtin history
	 */
	canRedo() {
		return undefined;
	}

	/**
	 * Check whether the mode is default mode.
	 * @return {boolean} true if the mode is used as a default mode.
	 */
	default() {
		return this._id === "auto"; //hardcoded
	}

	/**
	 * What happens when the mode is being entered in
	 * e.g. disable OSD mouse navigation (this.context.setOSDTracking(..)), prepare variables...
	 *  (previous mode can be obtained from the this.context.mode variable, still not changed)
	 * @return {boolean} true if the procedure should proceed, e.g. mode <this> is accepted
	 */
	setFromAuto() {
		return true;
	}

	/**
	 * What happens when the mode is being exited
	 * e.g. enable OSD mouse navigation (this.context.setOSDTracking(..)), clear variables...
	 * @param {boolean} temporary true if the change is temporary
	 * 	optimization parameter, safe way of changing mode is to go MODE1 --> AUTO --> MODE2
	 * 	however, you can avoid this by returning false if temporary == true, e.g. allow MODE2 to be
	 * 	turned on immediately. This feature is used everywhere in provided modes since all are
	 * 	compatible without problems.
	 * @return {boolean} true if the procedure should proceed, e.g. mode AUTO is accepted
	 */
	setToAuto(temporary) {
		return true;
	}

	/**
	 * Predicate that returns true if the mode is enabled by the key event,
	 * 	by default it is not tested whether the mode from which we go was
	 * 	AUTO mode (safe approach), so you can test this by this.context.isModeAuto()
	 *
	 * NOTE: these methods should be as specific as possible, e.g. test also that
	 * no ctrl/alt/shift key is held if you do not require them to be on
	 *       these methods should ignore CapsLock, e.g. test e.code not e.key
	 * @param {KeyboardEvent} e key down event
	 * @return {boolean} true if the key down event should enable this mode
	 */
	accepts(e) {
		return false;
	}

	/**
	 * Predicate that returns true if the mode is disabled by the key event
	 * @param {KeyboardEvent} e key up event
	 * @return {boolean} true if the key up event should disable this mode
	 */
	rejects(e) {
		return false;
	}

	/**
 	* Determines if edge mouse navigation is supported
 	* @returns {boolean} true if edge navigation is supported
 	*/
	supportsEdgeNavigation() {
		return true;
	}

	/**
	* Determines whether zoom animation is supported
	* @returns {boolean} true if zoom animation is supported
	*/
	supportsZoomAnimation() {
		return true;
	}

	/**
	* Handles the start of a zoom event
	* and sets the `isZooming` flag to true
	*/
	onZoomStart() {
        this.isZooming = true;
    }

	/**
 	* Handles the end of a zoom event
 	* and resets the `isZooming` flag to false
 	*/
    onZoomEnd() {
        this.isZooming = false;
    }
};

OSDAnnotations.StateAuto = class extends OSDAnnotations.AnnotationState {
	constructor(context) {
		super(context, "auto", "open_with", "🆀  navigate / select annotations");
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		if (!isLeftClick) return false;

		let clickTime = Date.now();

		let clickDelta = clickTime - this.context.cursor.mouseTime,
			canvas = this.context.canvas;

		// just navigate if click longer than 100ms or other conds not met, fire if double click
		if (clickDelta > 100) return false;

		//instead of auto-creation, select underneath
		if (!isLeftClick) return false;
		const active = canvas.getActiveObject();
		if (active) {
			active.sendToBack();
		}
		const object = canvas.findNextObjectUnderMouse(point, active);
		if (object) {
			canvas.setActiveObject(object, o);
		}
		this.context.canvas.renderAll();

		return true; //considered as handled
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		//if clicked on object, highlight it
		let active = this.context.canvas.findTarget(o);
		if (!active) {
			this.context.canvas.discardActiveObject();
		}
		this.context.canvas.renderAll();
	}

	customHtml() {
		return "";
	}

	accepts(e) {
		return e.code === "KeyQ" && !e.ctrlKey && !e.shiftKey && !e.altKey;
	}

	rejects(e) {
		return false;
	}
};

OSDAnnotations.StateFreeFormTool = class extends OSDAnnotations.AnnotationState {
	constructor(context, id, icon, description) {
		super(context, id, icon, description);
	}

	canUndo() {
		if (this.context.freeFormTool.isRunning()) return false;
		return undefined;
	}

	canRedo() {
		if (this.context.freeFormTool.isRunning()) return false;
		return undefined;
	}

	fftStartWith(point, ffTool, reference, wasCreated) {
		this.context.canvas.discardActiveObject();
		if (reference.asPolygon) {
			ffTool.init(reference.object, wasCreated.asPolygon);
		} else {
			ffTool.init(reference, wasCreated);
		}
		ffTool.update(point);
	}

	//find either array of points (intersection) or nested array of points /targets/
	fftFindTarget(point, ffTool, brushPolygon, offset=0) {
		function getObjectAsCandidateForIntersectionTest(o) {
			if (!o.sessionID) return false;
			let	factory = o._factory();
			if (!factory.isEditable()) return false;
			const result = factory.isImplicit()
    			? factory.toPointArray(o, OSDAnnotations.AnnotationObjectFactory.withObjectPoint)
    			: o.points;
			if (!result) return false;
			return {object: o, asPolygon: result};
		}
		// This optimization breaks the logics, since click itself has changed the active annotation if nested
		// const currentObject = this.context.canvas.getActiveObject();
		// let current = currentObject && getObjectAsCandidateForIntersectionTest(currentObject);
		// if (current && OSDAnnotations.PolygonUtilities.polygonsIntersect(brushPolygon, current.asPolygon)) {
		// 	return current;
		// }

		// Instead, loop only through near polygons in the nice order -> this will process
		// first top annotations -> potentially selected
		const candidates = this.context.findIntersectingObjectsByBBox({
			x: point.x - ffTool.radius - offset,
			y: point.y - ffTool.radius - offset,
			width: ffTool.radius * 2 + offset,
			height: ffTool.radius * 2 + offset
		}, getObjectAsCandidateForIntersectionTest);

		const polygonUtils = OSDAnnotations.PolygonUtilities;
		const active = this.context.canvas.getActiveObject();
		let max = 0, result = candidates; // by default return the whole list if intersections are <= 0

		for (let candidate of candidates) {
			let outerPolygon;
			let holes = null;
			let notFullyInHoles = false;
			let isMultipolygon = candidate.object.factoryID === "multipolygon";

			if (isMultipolygon) {
				outerPolygon = candidate.asPolygon[0];
				holes = candidate.asPolygon.slice(1);
			} else {
				outerPolygon = candidate.asPolygon;
			}

			const intersection = OSDAnnotations.checkPolygonIntersect(brushPolygon, outerPolygon);
			if (!intersection.length) continue;

			if (holes) {
				notFullyInHoles = holes.every(hole => {

					const bboxBrush = polygonUtils.getBoundingBox(brushPolygon);
					const bboxHole = polygonUtils.getBoundingBox(hole);

					if (polygonUtils.intersectAABB(bboxBrush, bboxHole)) {
						const preciseIntersection = OSDAnnotations.checkPolygonIntersect(brushPolygon, hole);
						return !(JSON.stringify(preciseIntersection) === JSON.stringify(brushPolygon));
					}
					return true;
				});
			}

			if (!isMultipolygon || notFullyInHoles) {
				if (active) {  // prefer first encounhtered object if it is also the selection
					return candidate.object;
				}
				if (intersection.length > max) {
					max = intersection.length;
					result = candidate.object;
				}
			}
		}
		return result;
	}

	fftFoundIntersection(result) {
		return !Array.isArray(result);
	}

	scroll(event, delta) {
		//subtract delta - scroll up means increase
		this.context.freeFormTool.setSafeRadius(this.context.freeFormTool.screenRadius - delta / 100);
	}

	setFromAuto() {
		this.context.setOSDTracking(false);
		this.context.canvas.hoverCursor = "crosshair";
		this.context.canvas.defaultCursor = "crosshair";
		this.context.freeFormTool.recomputeRadius();
		this.context.freeFormTool.showCursor();
		return true;
	}

	setToAuto(temporary) {
		this.context.freeFormTool.hideCursor();
		if (temporary) return false;

		this.context.setOSDTracking(true);
		this.context.canvas.renderAll();
		return true;
	}

	supportsEdgeNavigation() {
		return false;
	}

	supportsZoomAnimation() {
		return false;
	}
};

OSDAnnotations.StateFreeFormToolAdd = class extends OSDAnnotations.StateFreeFormTool {

	constructor(context) {
		super(context, "fft-add", "brush", "🅴  brush to create/edit");
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		let result = this.context.freeFormTool.finish();
		if (result) {
			this.context.canvas.setActiveObject(result);
			this.context.canvas.renderAll();
		}
		return true;
	}

	handleMouseMove(e, point) {
		this.context.freeFormTool.recomputeRadius();
		this.context.freeFormTool.update(point);
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) {
			this.abortClick(isLeftClick);
			return;
		}
		let created = false;
		const ffTool = this.context.freeFormTool;
		ffTool.zoom = this.context.canvas.getZoom();
		ffTool.recomputeRadius();
		const newPolygonPoints = ffTool.getCircleShape(point);
		let targetIntersection = this.fftFindTarget(point, ffTool, newPolygonPoints, 0);
		if (!this.fftFoundIntersection(targetIntersection)) {
			targetIntersection = this.context.polygonFactory.create(newPolygonPoints,
				this.context.presets.getAnnotationOptions(isLeftClick));
			created = true;
		}
		this.fftStartWith(point, ffTool, targetIntersection, created);
	}

	setFromAuto() {
		this.context.freeFormTool.setModeAdd(true);
		return super.setFromAuto();
	}

	accepts(e) {
		return e.code === "KeyE" && !e.ctrlKey && !e.shiftKey && !e.altKey;
	}

	rejects(e) {
		return e.code === "KeyE";
	}
};

OSDAnnotations.StateFreeFormToolRemove = class extends OSDAnnotations.StateFreeFormTool {

	constructor(context) {
		super(context, "fft-remove", "brush", "🆁  brush to remove");
		this.candidates = null;
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		this.candidates = null;
		let result = this.context.freeFormTool.finish();
		if (result) {
			this.context.canvas.setActiveObject(result);
			this.context.canvas.renderAll();
		}
		return true;
	}

	handleMouseMove(e, point) {
		const ffTool = this.context.freeFormTool;
		if (this.candidates) {
			const target = ffTool.getCircleShape(point);
			for (let i = 0; i < this.candidates.length; i++) {
				let candidate = this.candidates[i];
				if (OSDAnnotations.PolygonUtilities.polygonsIntersect(target, candidate.asPolygon)) {
					this.candidates = null;
					this.fftStartWith(point, ffTool, candidate, false);
					return;
				}
			}
		} else {
			ffTool.recomputeRadius();
			ffTool.update(point);
		}
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) {
			this.abortClick(isLeftClick);
			return;
		}

		const ffTool = this.context.freeFormTool;
		ffTool.zoom = this.context.canvas.getZoom();
		ffTool.recomputeRadius();
		const newPolygonPoints = ffTool.getCircleShape(point);
		let candidates = this.fftFindTarget(point, ffTool, newPolygonPoints, 50);

		if (this.fftFoundIntersection(candidates)) {
			this.fftStartWith(point, ffTool, candidates, false);
		} else {
			// still allow selection just search for cached targets
			this.candidates = candidates;
		}
	}

	setFromAuto() {
		this.context.freeFormTool.setModeAdd(false);
		return super.setFromAuto();
	}

	accepts(e) {
		return e.code === "KeyR" && !e.ctrlKey && !e.shiftKey && !e.altKey;
	}

	rejects(e) {
		return e.code === "KeyR";
	}
};

OSDAnnotations.StateCustomCreate = class extends OSDAnnotations.AnnotationState {
	constructor(context) {
		super(context, "custom", "format_shapes","🆆  create annotations manually");
		this._lastUsed = null;
	}

	discard(withWarning) {
		if (this._lastUsed && this._lastUsed.getCurrentObject()) {
			this._lastUsed.discardCreate();
		} else {
			super.discard(withWarning);
		}
	}

	canUndo() {
		if (this._lastUsed) return this._lastUsed.canUndoCreate();
		return undefined;
	}

	canRedo() {
		if (this._lastUsed) return this._lastUsed.canRedoCreate();
		return undefined;
	}

	undo() {
		if (this._lastUsed) return this._lastUsed.undoCreate();
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) return false;
		this._finish(this._lastUsed);
		return true;
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) {
			return;
		}
		this._init(point, isLeftClick, objectFactory);
	}

	handleMouseMove(e, point) {
		//todo experiment with this condition, also is it necessary for fft?
		if (this.context.isMouseOSDInteractive()) {
			if (this.context.presets.left) this.context.presets.left.objectFactory.updateCreate(point.x, point.y);
			if (this.context.presets.right) this.context.presets.right.objectFactory.updateCreate(point.x, point.y);
			this.context.canvas.renderAll();
		}
	}

	_init(point, isLeftClick, updater) {
		if (!updater) return;
		updater.initCreate(point.x, point.y, isLeftClick);
		this._lastUsed = updater;
	}

	_finish(updater) {
		if (!updater) return;
		let delta = Date.now() - this.context.cursor.mouseTime;

		// if click too short, user probably did not want to create such object, discard
		if (delta < updater.getCreationRequiredMouseDragDurationMS()) {
			const helper = updater.getCurrentObject();
			if (Array.isArray(updater.getCurrentObject())) {
				for (let item of helper) {
					this.context.deleteHelperAnnotation(item);
				}
			} else {
				this.context.deleteHelperAnnotation(helper);
			}
			this._lastUsed = null;
			return;
		}
		if (updater.finishDirect()) {
			this._lastUsed = null;
		}
	}

	setFromAuto() {
		this.context.setOSDTracking(false);
		//deselect active if present
		this.context.canvas.hoverCursor = "crosshair";
		this.context.canvas.defaultCursor = "crosshair";
		this.context.canvas.discardActiveObject();
		return true;
	}

	setToAuto(temporary) {
		if (temporary) return false;
		this.context.setOSDTracking(true);
		return true;
	}

	accepts(e) {
		return e.code === "KeyW" && !e.ctrlKey && !e.shiftKey && !e.altKey;
	}

	rejects(e) {
		return e.code === "KeyW";
	}
};

OSDAnnotations.StateCorrectionTool = class extends OSDAnnotations.StateFreeFormTool {

	constructor(context) {
		super(context, "fft-correct", "brush", "🆉  correction tool");
		this.candidates = null;
	}

	canUndo() {
		if (this.context.freeFormTool.isRunning()) return false;
		return undefined;
	}

	canRedo() {
		if (this.context.freeFormTool.isRunning()) return false;
		return undefined;
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		this.candidates = null;
		let result = this.context.freeFormTool.finish();
		if (result) {
			this.context.canvas.setActiveObject(result);
			this.context.canvas.renderAll();
		}
		return true;
	}

	handleMouseMove(e, point) {
		const ffTool = this.context.freeFormTool;
		if (this.candidates) {
			const target = ffTool.getCircleShape(point);
			for (let i = 0; i < this.candidates.length; i++) {
				let candidate = this.candidates[i];
				if (OSDAnnotations.PolygonUtilities.polygonsIntersect(target, candidate.asPolygon)) {
					this.candidates = null;
					this.fftStartWith(point, ffTool, candidate, false);
					return;
				}
			}
		} else {
			ffTool.recomputeRadius();
			ffTool.update(point);
		}
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		objectFactory = this.context.presets.left;
		if (!objectFactory) {
			this.abortClick(isLeftClick);
			return;
		}
		this.context.freeFormTool.setModeAdd(isLeftClick);

		const ffTool = this.context.freeFormTool,
			newPolygonPoints = ffTool.getCircleShape(point);
		ffTool.zoom = this.context.canvas.getZoom();
		let candidates = this.fftFindTarget(point, ffTool, newPolygonPoints, 50);

		if (this.fftFoundIntersection(candidates)) {
			this.fftStartWith(point, ffTool, candidates, false);
		} else {
			// still allow selection just search for cached targets
			this.candidates = candidates;
		}
	}

	setFromAuto() {
		return super.setFromAuto();
	}

	accepts(e) {
		return e.code === "KeyZ" && !e.ctrlKey && !e.shiftKey && !e.altKey;
	}

	rejects(e) {
		return e.code === "KeyZ";
	}
};
