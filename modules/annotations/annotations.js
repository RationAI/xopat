/**
 * Annotations functionality to the viewer - mouse interaction, events, interfaces, exporting...
 * @type {OSDAnnotations}
 *
 * @typedef {{x: number, y: number}} Point
 *
 * 	//TODO https://alimozdemir.com/posts/fabric-js-history-operations-undo-redo-and-useful-tips/
 *   // - blending ?
 */
window.OSDAnnotations = class extends OpenSeadragon.EventSource {

	/**
	 * Get instance of the annotations manger, a singleton
	 * (only one instance can run since it captures mouse events)
	 * @static
	 * @return {OSDAnnotations} manager instance
	 */
	static instance() {
		if (this.__self) {
			return this.__self;
		}
		return new OSDAnnotations();
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
			throw `The mode ${ModeClass} conflicts with another mode: ${this.Modes[id]}`;
		}
		if (!OSDAnnotations.AnnotationState.isPrototypeOf(ModeClass)) {
			throw `The mode ${ModeClass} does not inherit from ${OSDAnnotations.AnnotationState}`;
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
			throw `The factory ${FactoryClass} does not inherit from ${OSDAnnotations.AnnotationObjectFactory}`;
		}

		if (! this.__self) {
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

	/******************* EXPORT, IMPORT... todo move to convertor? **********************/

	defaultFileNameFor(format=undefined) {
		if (!format || format === "native") {
			return 'annotations_'+UTILITIES.todayISO()+'.json';
		}
		return OSDAnnotations.Convertor.defaultFileName(format);
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
			return factory.iterate(x, (x, isRoot, isGroup, f) => {
				let res = isRoot ? f.copyNecessaryProperties(x, keeps) : f.copyInnerProperties(x);
				if (isGroup) { //groups need BB so that it renders correctly
					res.left = x.left;
					res.top = x.top;
					res.width = x.width;
					res.height = x.height;
				}
				return res;
			});
		});
		if (!Array.isArray(objectList)) {
			objectList.objects = array;
			return objectList;
		}
		return array;
	}

	/**
	 * Export annotations and presets
	 * @param {string} format defines desired format ID as registered in OSDAnnotations.Convertor
	 *     use "native" or undefined for native export
	 * @param {boolean} withAnnotations
	 * @param {boolean} withPresets
	 * @return Promise(string)
	 */
	async export(format=undefined, withAnnotations=true, withPresets=true) {
		if (!format || format === "native") {
			const _this = this,
				result = withAnnotations ? this.toObject(false) : {};
			if (result.objects) {
				this.trimExportJSON(result);
			}
			if (withPresets) result.presets = this.presets.toObject();
			return JSON.stringify(result);
		}
		return OSDAnnotations.Convertor.encode(format, this, withAnnotations, withPresets);
	}

	/**
	 * Import annotations and presets
	 * @param {string} data serialized data of the given format
	 * 	- either object with 'presets' and/or 'objects' data content - arrays
	 * 	- or a plain array, treated as objects
	 * @param {string} format a string that defines desired format ID as registered in OSDAnnotations.Convertor
	 * @param {boolean} clear erase state upon import
	 * @return Promise(string)
	 */
	async import(data, format=undefined, clear=false) {
		//todo allow for 'redo' history

		let toImport;
		if (!format || format === "native") {
			toImport = JSON.parse(data);
		} else {
			toImport = await OSDAnnotations.Convertor.decode(format, data, this);
		}

		// the import should happen in two stages, one that prepares the data and one that
		// loads so that integrity is kept -> this is not probably a big issue since the only
		// 'parsing' is done within preset import and it fails safely with exception in case of error

		if (Array.isArray(toImport)) {
			//if no presets, maybe we are importing object array
			await this._loadObjects({objects: toImport}, clear);
		} else {
			if (Array.isArray(toImport.presets)) {
				this.presets.import(toImport.presets, clear);
			}
			if (Array.isArray(toImport.objects)) {
				await this._loadObjects(toImport, clear);
			}
		}

		this.raiseEvent('import', {
			format: format,
			clear: clear,
			data: toImport,
		});
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
	 * @param {boolean|string} withAllProps if boolean, true means export all props, false necessary ones, string counts as one of withProperties
	 * @param {string[]} withProperties list of extra properties to export
	 * @return {object} exported canvas content in {objects:[object]} format
	 */
	toObject(withAllProps=false, ...withProperties) {
		let props;
		if (typeof withAllProps === "boolean") {
			props = this.exportedPropertiesGlobal(withAllProps);
		} else if (typeof withAllProps === "string") {
			props = this.exportedPropertiesGlobal(true);
			props.push(withAllProps);
		}
		props.push(...withProperties);
		props.push(...this._extraProps);
		return this.canvas.toObject(props);
	}

	/**
	 * Compute properties registered for export
	 * @return {*[]}
	 */
	exportedPropertiesGlobal(all=true) {
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
	 * @return Promise
	 */
	async loadObjects(annotations, clear=false) {
		//todo allow for 'redo' history
		if (!annotations.objects) throw "Annotations object must have 'objects' key with the annotation data.";
		if (!Array.isArray(annotations.objects)) throw "Annotation objects must be an array.";
		return this._loadObjects(annotations, clear);
	}

	/******************* SETTERS, GETTERS **********************/

	/**
	 * Set the annotations canvas overlay opacity
	 * @event opacity-changed
	 * @param {number} opacity
	 */
	setOpacity(opacity) {
		this.opacity = opacity;
		//this does not work for overlapping annotations:
		//this.overlay.canvas.style.opacity = opacity;
		this.canvas.forEachObject(function (obj) {
			obj.opacity = opacity;
		});
		this.raiseEvent('opacity-changed', {opacity: this.opacity});
		this.canvas.renderAll();
	}

	/**
	 * Get current opacity
	 * @return {number}
	 */
	getOpacity() {
		return this.opacity;
	}

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
	 * @member OSDAnnotations
	 * @return {*} //todo fabric.Canvas type not recognized
	 */
	get canvas() {
		return this.overlay.fabric;
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
	 */
	setMode(mode) {
		if (mode === this.mode) return;

		if (this.mode === this.Modes.AUTO) {
			this._setModeFromAuto(mode);
		} else if (mode !== this.Modes.AUTO) {
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
	 */
	setModeById(id) {
		let _this = this;
		for (let mode in this.Modes) {
			if (!this.Modes.hasOwnProperty(mode)) continue;
			mode = this.Modes[mode];
			if (mode.getId() === id) {
				_this.setMode(mode);
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
	 * @param {OSDAnnotations.Preset|undefined} preset  object that defines properties annotation is labeled with,
	 * 		omit if the preset should be deducted automatically (first one / create new)
	 * @param {boolean} left true if left mouse button
	 * @return {OSDAnnotations.Preset|undefined} original preset that has been replaced
	 */
	setPreset(preset=undefined, left=true) {
		if (!preset) {
			for (let key in this.presets._presets) {
				if (this.presets.exists(key)) {
					preset = this.presets.get(key);
					break;
				}
			}
			if (!preset) preset = this.presets.addPreset();
		}
		if (left) {
			let original = this.presets.left;
			this.presets.left = preset;
			return original;
		}
		let original = this.presets.right;
		this.presets.right = preset;
		return original;
	}

	checkPreset(object) {
		let preset;
		if (object.presetID) {
			preset = this.presets.get(object.presetID);
			if (!preset) {
				console.log("Object refers to an invalid preset: using default one.");
				preset = this.presets.left;
				object.presetID = preset.presetID;
			}
		} else {
			//todo maybe try to find a preset with the exact same color...
			preset = this.presets.left;
			object.presetID = preset.presetID;
		}

		const props = this.presets.getCommonProperties(preset);
		if (!isNaN(object.zoomAtCreation)) props.zoomAtCreation = object.zoomAtCreation;

		let factory = object._factory();
		if (!factory) {
			factory = this.getAnnotationObjectFactory(object.type);
			if (!factory) {
				throw "TODO: solve factory deduction - accepts method on factory?";
			} else {
				object.factoryID = factory.factoryID;
			}
		}
		factory.configure(object, props);
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
			//todo mode?
			return this.createLayer(ofObject.layerID);
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
		this.canvas.add(annotation);
	}

	/**
	 * Convert helper annotation to fully-fledged annotation
	 * @param {fabric.Object} annotation helper annotation
	 * @param _raise @private
	 */
	promoteHelperAnnotation(annotation, _raise=true) {
		annotation.off('selected');
		annotation.on('selected', this._objectClicked.bind(this));
		annotation.sessionID = this.session;
		this.history.push(annotation);
		this.canvas.setActiveObject(annotation);

		if (_raise) this.raiseEvent('annotation-create', {object: annotation});
		this.canvas.renderAll();
	}

	/**
	 * Add annotation to the canvas
	 * @param {fabric.Object} annotation
	 * @param _raise @private
	 */
	addAnnotation(annotation, _raise=true) {
		this.addHelperAnnotation(annotation);
		this.promoteHelperAnnotation(annotation, _raise);
	}

	/**
	 * Delete helper annotation, should not be used on normal annotation
	 * @param {fabric.Object} annotation helper annotation
	 */
	deleteHelperAnnotation(annotation) {
		this.canvas.remove(annotation);
	}

	/**
	 * Delete annotation
	 * @param {fabric.Object} annotation
	 * @param _raise @private
	 */
	deleteAnnotation(annotation, _raise=true) {
		annotation.off('selected');
		this.canvas.remove(annotation);
		this.history.push(null, annotation);
		this.canvas.renderAll();
		if (_raise) this.raiseEvent('annotation-delete', {object: annotation});
	}

	/**
	 * Get annotation description from a preset, overriden by own object meta if present
	 * @param {fabric.Object} annotation annotation to describe
	 * @param {string} desiredKey metadata key to read and return
	 * @param {boolean} defaultIfUnknown if false, empty string is returned in case no property was found
	 * @return {string|*} annotation description
	 */
	getAnnotationDescription(annotation, desiredKey="category", defaultIfUnknown=true) {
		let preset = this.presets.get(annotation.presetID);
		if (preset) {
			for (let key in preset.meta) {
				let objmeta = annotation.meta || {}, overridingValue = objmeta[key];
				let metaElement = preset.meta[key];
				if (key === desiredKey) {
					return overridingValue || metaElement.value ||
						(defaultIfUnknown ? this.getDefaultAnnotationName(annotation) : "");
				}
			}
		}
		return defaultIfUnknown ? this.getDefaultAnnotationName(annotation) : "";
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
	 * @return {string} annotation name created by factory
	 */
	getDefaultAnnotationName(annotation) {
		let factory = annotation._factory();
		if (factory !== undefined) {
			return factory.getDescription(annotation);
		}
		return "Unknown annotation.";
	}

	/**
	 * Replace annotation with different one
	 * @param {fabric.Object} previous
	 * @param {fabric.Object} next
	 * @param {boolean} updateHistory false to ignore the history change, creates artifacts if used incorrectly
	 *    e.g. redo/undo buttons duplicate objects
	 * @param _raise invoke event if true (default)
	 */
	replaceAnnotation(previous, next, updateHistory=false, _raise=true) {
		next.off('selected');
		next.on('selected', this._objectClicked.bind(this));
		this.canvas.remove(previous);
		this.canvas.add(next);
		this.canvas.renderAll();
		if (updateHistory) this.history.push(next, previous);

		if (_raise) this.raiseEvent('annotation-replace', {previous, next});
	}

	/**
	 * Check whether object is not a helper annotation
	 * @param {fabric.Object} o
	 * @return {boolean}
	 */
	isAnnotation(o) {
		return o.hasOwnProperty("incrementId");
	}

	/**
	 * Delete object without knowledge of its identity (fully-fledged annotation or helper one)
	 * @param {fabric.Object} o
	 * @param _raise @private
	 */
	deleteObject(o, _raise=true) {
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
	 */
	removeActiveObject() {
		let toRemove = this.canvas.getActiveObject();
		if (toRemove) {
			this.deleteObject(toRemove);
		} else {
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
		if (!objects || objects.length === 0 || !confirm("Do you really want to delete all annotations?")) return;

		let objectsLength = objects.length;
		for (let i = 0; i < objectsLength; i++) {
			this.deleteObject(objects[objectsLength - i - 1]);
		}
	}

	/**
	 * Binds IO to the export events, must be requested manually.
	 */
	bindIO() {
		if (this._handledIO) return;
		const presets = this.presets;
		//restore presents if any
		VIEWER.addHandler('export-data', e => e.setSerializedData(
			"annotation_presets", presets.toObject(true)));
		let presetData = APPLICATION_CONTEXT.getData("annotation_presets");
		let preset;
		if (presetData !== undefined) {
			try {
				preset = presets.import(presetData);
			} catch (e) {
				preset = presets.addPreset();
			}
		}
		else preset = presets.addPreset();
		if (preset) this.setPreset(preset);

		//restore objects if any
		VIEWER.addHandler('export-data', e =>
			e.setSerializedData("annotation-list",
				JSON.stringify(this.trimExportJSON(this.toObject(), ...this._extraProps))));
		let imageJson = APPLICATION_CONTEXT.getData("annotation-list");
		if (imageJson) {
			this.loadObjects(JSON.parse(imageJson)).catch(e => {
				console.warn(e);
				//todo error event instead
				Dialogs.show("Could not load annotations. Please, let us know about this issue and provide exported file.", 20000, Dialogs.MSG_ERR);
			});
		}
		this._handledIO = true;
	}

	/********************* PRIVATE **********************/

	_init() {
		//Consider http://fabricjs.com/custom-control-render
		// can maybe attach 'edit' button controls to object...
		// note the board would have to reflect the UI state when opening

		/**
		 * Attach factory getter to each object
		 */
		fabric.Object.prototype._factory = function () {
			const factory = _this.getAnnotationObjectFactory(this.factoryID || this.factoryId); //todo fallback factoryId remove in future
			if (factory) this._factory = () => factory;
			else if (this.factoryID) {
				console.warn("Object", this.type, "has no associated factory for: ",  this.factoryID);
				//maybe provide general implementation that can do nearly nothing
			}
			return factory;
		}
		fabric.Object.prototype.zooming = function(zoom) {
			this._factory()?.onZoom(this, zoom);
		}

		this.Modes = {
			AUTO: new OSDAnnotations.AnnotationState(this, "", "", ""),
		};
		this.mode = this.Modes.AUTO;
		this.opacity = 0.6;
		this.disabledInteraction = false;
		this.autoSelectionEnabled = VIEWER.hasOwnProperty("bridge");
		this.objectFactories = {};
		this._extraProps = [];
		this.cursor = {
			mouseTime: 0, //OSD handler click timer
			isDown: false,  //FABRIC handler click down recognition
		};

		let refTileImage = VIEWER.tools.referencedTiledImage();
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

		this._handledIO = false;
		const _this = this;

		//after properties initialize
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Group, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Polyline, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Line, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Point, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Text, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Image, false);

		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Rect, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Ellipse, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Ruler, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Polygon, false);

		/**
		 * Polygon factory, the only factory required within the module
		 * @type {OSDAnnotations.AnnotationObjectFactory}
		 */
		this.polygonFactory = null;

		//Polygon presence is a must
		if (this.objectFactories.hasOwnProperty("polygon")) {
			//create tool-shaped object
			this.polygonFactory = this.objectFactories["polygon"];
		} else {
			console.warn("See list of factories available: missing polygon.", this.objectFactories);
			throw "No polygon object factory registered. Annotations must contain at " +
			"least a polygon implementation in order to work. Did you maybe named the polygon factory " +
			"implementation differently other than 'polygon'?";
		}

		this._layers = {};
		if (Object.keys(this._layers).length < 1) this.createLayer();
		this.setMouseOSDInteractive(true, false);
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
		VIEWER.addHandler('key-down', function (e) {
			if (!e.focusCanvas) return;
			_this._keyDownHandler(e);
		});
		VIEWER.addHandler('key-up', function (e) {
			_this._keyUpHandler(e);
		});
		//Window switch alt+tab makes the mode stuck
		window.addEventListener("focus", e => _this.setMode(_this.Modes.AUTO), false);
		window.addEventListener("blur", e => _this.setMode(_this.Modes.AUTO), false);

		/**************************************************************************************************
		   Click Handlers
		   Input must be always the event invoked by the user input and point in the image coordinates
		   (absolute pixel position in the scan)
		**************************************************************************************************/

		let screenToPixelCoords = function (x, y) {
			//cannot use VIEWER.tools.imagePixelSizeOnScreen() because of canvas margins
			return VIEWER.tools.referencedTiledImage().windowToImageCoordinates(new OpenSeadragon.Point(x, y));
		}.bind(this);

		//prevents event bubling if the up event was handled by annotations
		function handleRightClickUp(event) {
			if (_this.disabledInteraction) return;
			if (!_this.cursor.isDown) {
				if (_this.cursor.mouseTime === 0) {
					_this.raiseEvent('canvas-nonprimary-release', {
						originalEvent: event
					});
				}
				_this.cursor.mouseTime = -1;
				return;
			}

			let factory = _this.presets.right ? _this.presets.right.objectFactory : undefined;
			let point = screenToPixelCoords(event.x, event.y);
			if (_this.mode.handleClickUp(event, point, false, factory)) {
				event.preventDefault();
			} else /*if (!_this.isModeAuto())*/ {
				//todo better system by e.g. unifying the events, allowing cancellability and providing only interface to modes
				_this.raiseEvent('canvas-nonprimary-release', {
					originalEvent: event
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
				if (_this.cursor.mouseTime === 0) {
					_this.raiseEvent('canvas-release', {
						originalEvent: event
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
					originalEvent: event
				});
			}

			_this.cursor.isDown = false;
		}

		function handleLeftClickDown(event) {
			if (_this.cursor.isDown || _this.disabledInteraction) return;

			_this.cursor.mouseTime = Date.now();
			_this.cursor.isDown = true;

			let factory = _this.presets.left ? _this.presets.left.objectFactory : undefined;
			let point = screenToPixelCoords(event.x, event.y);
			_this.mode.handleClickDown(event, point, true, factory);
		}

		/****** E V E N T  L I S T E N E R S: FABRIC (called when not navigating) **********/

			//todo better handling - either add events to the viewer or...

		let annotationCanvas = this.canvas.upperCanvasEl;
		annotationCanvas.addEventListener('mousedown', function (event) {
			if (_this.disabledInteraction) return;

			if (event.which === 1) handleLeftClickDown(event);
			else if (event.which === 3) handleRightClickDown(event);
		});

		annotationCanvas.addEventListener('mouseup', function (event) {
			if (_this.disabledInteraction) return;

			if (event.which === 1) handleLeftClickUp(event);
			else if (event.which === 3) handleRightClickUp(event);
		});

		this.canvas.on('mouse:move', function (o) {
			if (_this.disabledInteraction || !_this.cursor.isDown) return;
			_this.mode.handleMouseMove(screenToPixelCoords(o.e.x, o.e.y));
		});

		this.canvas.on('mouse:wheel', function (o) {
			if (_this.disabledInteraction) return;
			_this.mode.scroll(o.e, o.e.deltaY);
		});

		/****** E V E N T  L I S T E N E R S: OSD  (called when navigating) **********/

		VIEWER.addHandler("canvas-press", function (e) {
			if (_this.disabledInteraction) return;
			handleLeftClickDown(e.originalEvent);
		});

		VIEWER.addHandler("canvas-release", function (e) {
			if (_this.disabledInteraction) return;
			handleLeftClickUp(e.originalEvent);
		});

		VIEWER.addHandler("canvas-nonprimary-press", function (e) {
			if (_this.disabledInteraction) return;
			handleRightClickDown(e.originalEvent);
		});

		VIEWER.addHandler("canvas-nonprimary-release", function (e) {
			if (_this.disabledInteraction) return;
			handleRightClickUp(e.originalEvent);
		});

		// Wheel while viewer runs not enabled because this already performs zoom.
		// VIEWER.addHandler("canvas-scroll", function (e) { ... });
	}

	static _registerAnnotationFactory(FactoryClass, atRuntime) {
		let _this = this.__self;
		let factory = new FactoryClass(_this, _this.automaticCreationStrategy, _this.presets);
		if (_this.objectFactories.hasOwnProperty(factory.factoryID)) {
			throw `The factory ${FactoryClass} conflicts with another factory: ${factory.factoryID}`;
		}
		_this.objectFactories[factory.factoryID] = factory;
		if (atRuntime) _this.raiseEvent('factory-registered', {factory: factory});
	}

	_setModeFromAuto(mode) {
		if (mode.setFromAuto()) {
			this.raiseEvent('mode-changed', {mode: mode});

			this.mode = mode;
		}
	}

	_setModeToAuto(switching) {
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
			this.setMode(modeFromCode);
			e.preventDefault();
		}
	}

	_keyUpHandler(e) {
		if (this.disabledInteraction) return;

		if (e.focusCanvas) {
			if (!e.ctrlKey && !e.altKey) {
				if (e.key === "Delete") return this.removeActiveObject();
				if (e.key === "Escape") {
					this.history._boardItemSave();
					this.setMode(this.Modes.AUTO);
					return;
				}
			}

			if (e.ctrlKey) {
				if (e.key === "z") return this.history.back();
				if (e.key === "Z") return this.history.redo();
			}
		}

		if (this.mode.rejects(e)) {
			this.setMode(this.Modes.AUTO);
			e.preventDefault();
		}
	}

	_objectClicked(object) {
		object = object.target;
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
			if (factory) factory.selected(object);
		}
	}

	_loadObjects(input, clear, reviver) {
		const originalToObject = fabric.Object.prototype.toObject;
		const inclusionProps = this.exportedPropertiesGlobal();

		//we ignore incoming props as we later reset the override
		fabric.Object.prototype.toObject = function (_) {
			return originalToObject.call(this, inclusionProps);
		}
		const reset = () => fabric.Object.prototype.toObject = originalToObject;

		//from loadFromJSON implementation in fabricJS
		const _this = this.canvas, self = this;
		return new Promise((resolve, reject) => {
			//todo try re-implement with fabric.util.enlivenObjects(...)? not private api
			this.canvas._enlivenObjects(input.objects, function (enlivenedObjects) {
				if (input.objects.length > 0 && enlivenedObjects.length < 1) {
					return reject("Failed to import objects. Check the attribute syntax. Do you specify 'type' attribute?");
				}

				if (clear) _this.clear();
				_this._setBgOverlay(input, function () {
					enlivenedObjects.forEach(function(obj, index) {
						self.checkLayer(obj);
						self.checkPreset(obj);

						obj.on('selected', self._objectClicked.bind(self));
						//todo consider annotation creation event?
						_this.insertAt(obj, index);
					});
					delete input.objects;
					delete input.backgroundImage;
					delete input.overlayImage;
					delete input.background;
					delete input.overlay;
					_this._setOptions(input);
					self.history.assignIDs(_this.getObjects());
					_this.renderAll();
					return resolve();
				});
			}, reviver);
		}).then(reset).catch(e => {
			reset();
			throw e;
		}); //todo rethrow? rewrite as async call with try finally
	}

	static __self = undefined;
	constructor() {
		super();
		if (this.constructor.__self) {
			throw "Annotation system is not instantiable. Instead, use OSDAnnotations::instance().";
		}

		//possibly try to avoid in the future accessing self through a global
		window.annotations = this;
		this.id = "annotations";
		this.version = "0.0.1";
		this.session = this.version + "_" + Date.now();
		this.constructor.__self = this;
		this._init();
		this._setListeners();
	}
};

/**
 * Default annotation state parent class, also a valid mode (does nothing).
 * @type {OSDAnnotations.AnnotationState}
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
		this._id = id;
		this.icon = icon;
		this.context = context;
		this.description = description;
	}

	/**
	 * Perform action on mouse up event
	 * @param {Event} o original js event
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
	 * @param {Event} o original js event
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
	 * @param {Point} point mouse position in image coordinates (pixels)
	 */
	handleMouseMove(point) {
		//do nothing
	}

	/**
	 * Handle scroll event while the OSD navigation is disabled
	 * NOTE: scroll in navigation mode is used to zoom, not available
	 * @param {Event} event original MouseWheel event
	 * @param {number} delta event.deltaY property, copied out since this is the value we are interested in
	 */
	scroll(event, delta) {
		//do nothing
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
		this.context.cursor.mouseTime = 0;
		this.context.cursor.isDown = false;
		if (noPresetError) {
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
};

OSDAnnotations.StateAuto = class extends OSDAnnotations.AnnotationState {
	constructor(context) {
		super(context, "auto", "open_with", "navigate and create automatic annotations");
		this.clickInBetweenDelta = 0;
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		return this._finish(o, isLeftClick, objectFactory);
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		this._init(o, objectFactory);
	}

	_init(event, factory) {
		//if clicked on object, highlight it
		let active = this.context.canvas.findTarget(event);
		if (active) {
			this.context.canvas.setActiveObject(active);
			this.context.canvas.renderAll();
		}
	}

	_finish(event, isLeftClick, updater) {
		let clickTime = Date.now();

		let clickDelta = clickTime - this.context.cursor.mouseTime,
			finishDelta = clickTime - this.clickInBetweenDelta;
		this.clickInBetweenDelta = clickTime;

		// just navigate if click longer than 100ms or other conds not met, fire if double click
		if (clickDelta > 100 || !updater || !this.context.autoSelectionEnabled || finishDelta > 450) return false;

		if (!updater) {
			this.abortClick(isLeftClick, true);
			return false;
		}

		//instant create wants screen pixels as we approximate based on zoom level
		const created = updater.instantCreate(new OpenSeadragon.Point(event.x, event.y), isLeftClick);
		if (created === false) {
			VIEWER.raiseEvent('warn-user', {
				originType: "module",
				originId: "annotations",
				code: "W_AUTO_CREATION_FAIL",
				message: "Automatic annotation creation failed!",
				isLeftClick: isLeftClick
			});
		}
		return true;
	}

	customHtml() {
		return "";
	}
};

OSDAnnotations.StateFreeFormTool = class extends OSDAnnotations.AnnotationState {
	constructor(context, id, icon, description) {
		super(context, id, icon, description);
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		this._finish();
		return true;
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		this._init(o, point, isLeftClick, objectFactory);
	}

	handleMouseMove(point) {
		this.context.freeFormTool.update(point);
	}

	_init(o, point, isLeftClick, objectFactory) {
		let currentObject = this.context.canvas.getActiveObject(),
			created = false;

		if (!currentObject) {
			if (!this.context.freeFormTool.modeAdd) {
				//subtract needs active object
				this.abortClick(isLeftClick);
				return;
			}
			currentObject = this._initFromPoints(this._geCirclePoints(point), isLeftClick, objectFactory);
			created = true;
		} else {
			let	factory = currentObject._factory(),
				willModify, newPolygonPoints;

			//treat as polygon
			if (!factory.isEditable()) {
				willModify = false;
			} else if (factory.isImplicit()) {
				//let radius = this.context.freeFormTool.screenRadius*1.5;
				// let bounds = currentObject.getBoundingRect();
				// let w = bounds.left + bounds.width + radius,
				// 	h = bounds.top + bounds.height + radius;
				// bounds.left -= radius;
				// bounds.right -= radius;
				willModify = true; // o.y < bounds.top || o.y > h || o.x < bounds.left || o.x > w;
			} else {
				newPolygonPoints = this._geCirclePoints(point);
				willModify = OSDAnnotations.PolygonUtilities.polygonsIntersect(
					{points: newPolygonPoints}, currentObject
				);
			}

			if (!willModify) {
				if (!this.context.freeFormTool.modeAdd) {
					//subtract needs active object
					this.abortClick(isLeftClick);
					return;
				}
				currentObject = this._initFromPoints(
					newPolygonPoints || this._geCirclePoints(point), isLeftClick, objectFactory
				);
				created = true;
			}
		}

		if (currentObject) {
			this.context.freeFormTool.init(currentObject, created);
			this.context.freeFormTool.update(point);
		}
	}

	_geCirclePoints(point) {
		return this.context.freeFormTool.getCircleShape(point);
	}

	_initFromPoints(points, isLeftClick, objectFactory) {
		if (!objectFactory) {
			this.abortClick(isLeftClick, true);
			return undefined;
		}
		return this.context.polygonFactory.create(points, this.context.presets.getAnnotationOptions(isLeftClick));
	}

	_finish() {
		let result = this.context.freeFormTool.finish();
		if (result) {
			this.context.canvas.setActiveObject(result);
			this.context.canvas.renderAll();
		}
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
};

OSDAnnotations.StateFreeFormToolAdd = class extends OSDAnnotations.StateFreeFormTool {

	constructor(context) {
		super(context, "fft-add", "brush", "draw annotations by hand (shift)");
	}

	setFromAuto() {
		this.context.freeFormTool.setModeAdd(true);
		return super.setFromAuto();
	}

	accepts(e) {
		if (this.context.mode === this.context.Modes.FREE_FORM_TOOL_REMOVE
			&& e.key === "Alt" && e.shiftKey && !e.ctrlKey) {

			return true;
		}
		return e.key === "Shift" && !e.altKey && !e.ctrlKey;
	}

	rejects(e) {
		return e.key === "Shift";
	}
};

OSDAnnotations.StateFreeFormToolRemove = class extends OSDAnnotations.StateFreeFormTool {

	constructor(context) {
		super(context, "fft-remove", "brush", "remove annotation parts by hand (shift + alt to switch)");
	}

	setFromAuto() {
		this.context.freeFormTool.setModeAdd(false);
		return super.setFromAuto();
	}

	accepts(e) {
		return !e.ctrlKey
			&& (this.context.mode === this.context.Modes.FREE_FORM_TOOL_ADD || e.shiftKey)
			&& e.key === "Alt";
	}

	rejects(e) {
		return e.key === "Shift";
	}
};

OSDAnnotations.StateCustomCreate = class extends OSDAnnotations.AnnotationState {
	constructor(context) {
		super(context, "custom", "format_shapes","create annotations manually (alt)");
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) return false;
		this._finish(objectFactory);
		return true;
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) {
			this.abortClick(isLeftClick,true);
			return;
		}
		this._init(point, isLeftClick, objectFactory);
	}

	handleMouseMove(point) {
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
	}

	_finish(updater) {
		if (!updater) return;
		let delta = Date.now() - this.context.cursor.mouseTime;

		// if click too short, user probably did not want to create such object, discard
		if (delta < updater.getCreationRequiredMouseDragDurationMS()) {
			this.context.canvas.remove(updater.getCurrentObject());
			return;
		}
		updater.finishDirect();
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
		return e.key === "Alt" && !e.ctrlKey && !e.shiftKey;
	}

	rejects(e) {
		return e.key === "Alt";
	}
};
