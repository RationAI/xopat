/**
 * Annotations functionality to the viewer - mouse interaction, events, interfaces, exporting...
 * @type {OSDAnnotations}
 *
 * @typedef {{x: number, y: number}} Point
 */
var OSDAnnotations = class extends OpenSeadragon.EventSource {

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

	/******************* EXPORT, IMPORT **********************/

	/**
	 * Export objects in a fabricjs manner (actually just forwards the export command)
	 * @param {string[]} withProperties list of extra properties to export
	 * @return {object} exported canvas content
	 */
	getObjectContent(...withProperties) {
		return this.canvas.toObject(['meta', 'a_group', 'threshold', 'borderColor', 'cornerColor', 'borderScaleFactor',
			'color', 'presetID', 'hasControls', 'factoryId', 'sessionId', 'layerId', ...withProperties]);
	}

	/**
	 * ASAP Annotations export, kept from the old version, not really tested
	 * @return {Document} XML export
	 */
	getXMLDocumentContent() {
		// first, create xml dom
		let doc = document.implementation.createDocument("", "", null);
		let ASAP_annot = doc.createElement("ASAP_Annotations");
		let xml_annotations = doc.createElement("Annotations");
		ASAP_annot.appendChild(xml_annotations);
		doc.appendChild(ASAP_annot);

		// for each object (annotation) create new annotation element with coresponding coordinates
		let canvas_objects = this.canvas._objects;
		for (let i = 0; i < canvas_objects.length; i++) {
			let obj = canvas_objects[i];
			if (!obj.factoryId || obj.factoryId.startsWith("_")) {
				continue
			}
			var xml_annotation = doc.createElement("Annotation");
			let coordinates=[];

			xml_annotation.setAttribute("Name", "Annotation " + i);
			let factory = this.getAnnotationObjectFactory(obj.factoryId);
			if (factory) {
				xml_annotation.setAttribute("Type", "Rectangle"); //todo ???
				coordinates = factory.toPointArray(obj, OSDAnnotations.AnnotationObjectFactory.withArrayPoint);
			}
			// noinspection JSUnresolvedVariable
			xml_annotation.setAttribute("PartOfGroup", obj.a_group);
			xml_annotation.setAttribute("Color", obj.color);

			//get coordinates in ASAP format
			var xml_coordinates = doc.createElement("Coordinates");
			// create new coordinate element for each coordinate
			for (let j = 0; j < coordinates.length; j++) {
				let xml_coordinate = doc.createElement("Coordinate");
				xml_coordinate.setAttribute("Order", (j).toString());
				xml_coordinate.setAttribute("X", coordinates[j][0]);
				xml_coordinate.setAttribute("Y", coordinates[j][1]);
				xml_coordinates.appendChild(xml_coordinate);
			}
			xml_annotation.appendChild(xml_coordinates);
			xml_annotations.appendChild(xml_annotation);
		}
		return doc;
	}

	/**
	 * ASAP Annotations export as string, kept from the old version, not really tested
	 * @return {string} serialized XML export
	 */
	getXMLStringContent() {
		return new XMLSerializer().serializeToString(this.getXMLDocumentContent());
	}

	/**
	 * Load objects, must keep the same structure that comes from 'export'
	 * @param {object} annotations objects to import
	 * @param {function} onfinish
	 * @param {boolean} clear true if existing objects should be removed, default false
	 */
	loadObjects(annotations, onfinish=function(){}, clear=false) {
		if (!annotations.objects) return;
		this._loadObjects(annotations, onfinish);
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
	 * Get object factory for given object type (stored in object.factoryId)
	 * @param {string} objectType the type is stored as a factoryId property
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
	 * @param {OSDAnnotations.Preset|undefined} preset  object that defines how annotation is constructed,
	 * 		omit if the preset should be deducted automatically (first one / create new)
	 * @param {boolean} left true if left mouse button
	 * @return {OSDAnnotations.Preset|undefined} original preset that has been replaced
	 */
	setPreset(preset, left=true) {
		if (!preset) {
			for (let key in this.presets._presets) {
				if (this.presets._presets.hasOwnProperty(key)) {
					preset = this.presets._presets[key];
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

	/************************ Layers *******************************/

	/**
	 * Check annotation for layer, assign if not assigned
	 * @param {fabric.Object} ofObject
	 * @return {OSDAnnotations.Layer} layer it belongs to
	 */
	checkLayer(ofObject) {
		if (!ofObject.hasOwnProperty("layerId")) {
			if (this._layer) ofObject.layerId = this._layer.id;
		} else if (!this._layers.hasOwnProperty(ofObject.layerId)) {
			//todo mode?
			return this.createLayer(ofObject.layerId);
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
			if (obj.layerId === layer.id) _this.deleteObject(obj, false);
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
			if (!x.hasOwnProperty('layerId') || !y.hasOwnProperty('layerId')) return 0;
			return _this._layers[x.layerId].position - _this._layers[y.layerId].position;
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
		annotation.sessionId = this.session;
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
	 * Replace annotation with different one
	 * @param {fabric.Object} previous
	 * @param {fabric.Object} next
	 * @param {boolean} updateHistory false to ignore the history change, creates artifacts if used incorrectly
	 * 	e.g. redo/undo buttons duplicate objects
	 */
	replaceAnnotation(previous, next, updateHistory=false) {
		next.off('selected');
		next.on('selected', this._objectClicked.bind(this));
		this.canvas.remove(previous);
		this.canvas.add(next);
		if (updateHistory) this.history.push(next, previous);
		this.canvas.renderAll();
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

	/********************* PRIVATE **********************/

	_init() {
		//Consider http://fabricjs.com/custom-control-render
		// can maybe attach 'edit' button controls to object...
		// note the board would have to reflect the UI state when opening

		this.Modes = {
			AUTO: new OSDAnnotations.AnnotationState(this, "", "", ""),
		};
		this.mode = this.Modes.AUTO;
		this.opacity = 0.6;
		this.disabledInteraction = false;
		this.autoSelectionEnabled = VIEWER.hasOwnProperty("bridge");
		this.objectFactories = {};
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

		const _this = this;

		//after properties initialized
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

		UTILITIES.addPostExport("annotation-list",
			_ => JSON.stringify(_this.getObjectContent()), "annotations");
		let imageJson = APPLICATION_CONTEXT.postData["annotation-list"];
		if (imageJson) {
			try {
				this.loadObjects(JSON.parse(imageJson), _ => {
					_this.history.size = 50;
				});
			} catch (e) {
				console.warn(e);
				Dialogs.show("Could not load annotations. Please, let us know about this issue and provide means how the visualisation was loaded.", 20000, Dialogs.MSG_ERR);
				_this.history.size = 50;
			}
		} else {
			_this.history.size = 50;
		}

		if (Object.keys(this._layers).length < 1) this.createLayer();

		//restore presents if any
		UTILITIES.addPostExport("annotation_presets", this.presets.export.bind(this.presets), "annotations");
		if (APPLICATION_CONTEXT.postData.hasOwnProperty("annotation_presets")) {
			this.presets.import(APPLICATION_CONTEXT.postData["annotation_presets"]);
		} else {
			this.presets.addPreset();
		}

		this.setMouseOSDInteractive(true, false);
		this._setListeners();
	}

	_debugActiveObjectBinder() {
		this.canvas.__eventListeners = {};
		const get = this.canvas.getActiveObject.bind(this.canvas);
		let self = this;
		this.canvas.getActiveObject = function() {
			let e = get();
			console.log("GET", e ? e.selectable : "", e, self.overlay.fabric._activeObject);
			return e;
		};
		const set = this.canvas.setActiveObject.bind(this.canvas);
		this.canvas.setActiveObject = function(e, t) {
			console.log("SET", e, t);
			return set(e, t);
		};
		const disc = this.canvas._discardActiveObject.bind(this.canvas);
		this.canvas._discardActiveObject = function(e, t) {
			console.log("DISCARD", e, self.overlay.fabric.__eventListeners);
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

		function handleRightClickUp(event) {
			if (!_this.cursor.isDown || _this.disabledInteraction) return;

			let factory = _this.presets.right ? _this.presets.right.objectFactory : undefined;
			let point = screenToPixelCoords(event.x, event.y);
			_this.mode.handleClickUp(event, point, false, factory);

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
			if (!_this.cursor.isDown || _this.disabledInteraction) return;

			let factory = _this.presets.left ? _this.presets.left.objectFactory : undefined;
			let point = screenToPixelCoords(event.x, event.y);
			_this.mode.handleClickUp(event, point, true, factory);

			_this.cursor.isDown = false;
		}

		function handleLeftClickDown(event) {
			if (_this.cursor.isDown || !_this.presets.left || _this.disabledInteraction) return;

			_this.cursor.mouseTime = Date.now();
			_this.cursor.isDown = true;

			let factory = _this.presets.left ? _this.presets.left.objectFactory : undefined;
			let point = screenToPixelCoords(event.x, event.y);
			_this.mode.handleClickDown(event, point, true, factory);
		}

		/****** E V E N T  L I S T E N E R S: FABRIC (called when not navigating) **********/

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
		if (_this.objectFactories.hasOwnProperty(factory.factoryId)) {
			throw `The factory ${FactoryClass} conflicts with another factory: ${factory.factoryId}`;
		}
		_this.objectFactories[factory.factoryId] = factory;
		if (atRuntime) _this.raiseEvent('factory-registered');
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
		if (this.cursor.isDown || this.disabledInteraction) return;

		let modeFromCode = this._getModeByKeyEvent(e);
		if (modeFromCode) {
			this.setMode(modeFromCode);
			e.preventDefault();
		}
	}

	_keyUpHandler(e) {
		if (this.disabledInteraction) return;

		if (e.code === "Delete") {
			this.removeActiveObject();
			return;
		}

		if (!e.ctrlKey && !e.altKey && e.code === "Escape") {
			this.history._boardItemSave();
			this.setMode(this.Modes.AUTO);
			return;
		}

		if (e.ctrlKey && e.code === "KeyY") {
			if (e.shiftKey) this.history.redo();
			else this.history.back();
			return;
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
			let factory = this.getAnnotationObjectFactory(object.factoryId);
			if (factory) factory.selected(object);
		}
	}

	_loadObjects(input, callback, clear, reviver) {
		//from loadFromJSON implementation in fabricJS
		const _this = this.canvas;
		const annot = this;
		this.canvas._enlivenObjects(input.objects, function (enlivenedObjects) {
			if (clear) _this.clear();
			_this._setBgOverlay(input, function () {
				enlivenedObjects.forEach(function(obj, index) {
					$.extend(obj, OSDAnnotations.PresetManager._commonProperty);
					annot.checkLayer(obj);
					obj.on('selected', annot._objectClicked.bind(annot));

					_this.insertAt(obj, index);
				});
				delete input.objects;
				delete input.backgroundImage;
				delete input.overlayImage;
				delete input.background;
				delete input.overlay;
				_this._setOptions(input);
				_this.renderAll();
				callback && callback();
			});
		}, reviver);
	}

	static __self = undefined;
	constructor() {
		super();
		if (this.constructor.__self) {
			throw "Annotation system is not instantiable. Instead, use OSDAnnotations::instance().";
		}

		//possibly try to avoid in the future accessing self through a global
		window.Annotations = this;
		this.id = "Annotations";
		this.session = Date.now();
		this.constructor.__self = this;
		this._init();
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
	 */
	handleClickUp(o, point, isLeftClick, objectFactory) {
		//do nothing
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
	 */
	abortClick() {
		this.context.cursor.mouseTime = 0;
		this.context.cursor.isDown = false;
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
		if (!objectFactory) return;
		this._finish(o, isLeftClick, objectFactory);
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) this.abortClick();
		this._init(o);
	}

	_init(event) {
		//if clicked on object, highlight it
		let active = this.context.canvas.findTarget(event);
		if (active) {
			this.context.canvas.setActiveObject(active);
			this.context.canvas.renderAll();
			this.abortClick();
		}
	}

	_finish(event, isLeftClick, updater) {
		let clickTime = Date.now();

		let clickDelta = clickTime - this.context.cursor.mouseTime,
			finishDelta = clickTime - this.clickInBetweenDelta;
		this.clickInBetweenDelta = clickTime;

		// just navigate if click longer than 100ms or other conds not met, fire if double click
		if (clickDelta > 100 || !updater || !this.context.autoSelectionEnabled || finishDelta > 450) return;

		//instant create wants screen pixels as we approximate based on zoom level
		if (!updater.instantCreate(new OpenSeadragon.Point(event.x, event.y), isLeftClick)) {
			Dialogs.show("Could not create automatic annotation.", 5000, Dialogs.MSG_WARN);
		}
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
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		this._init(o, point, isLeftClick);
	}

	handleMouseMove(point) {
		this.context.freeFormTool.update(point);
	}

	_init(o, point, isLeftClick) {
		let currentObject = this.context.overlay.fabric.getActiveObject(),
			created = false;

		if (!currentObject) {
			if (!this.context.freeFormTool.modeAdd) {
				//subtract needs active object
				this.abortClick();
				return;
			}
			currentObject = this._initFromPoints(this._geCirclePoints(point), isLeftClick);
			created = true;
		} else {
			let	factory = this.context.getAnnotationObjectFactory(currentObject.factoryId),
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
				willModify = this.context.freeFormTool.polygonsIntersect(
					{points: newPolygonPoints}, currentObject
				);
			}

			if (!willModify) {
				if (!this.context.freeFormTool.modeAdd) {
					//subtract needs active object
					this.abortClick();
					return;
				}
				currentObject = this._initFromPoints(
					newPolygonPoints || this._geCirclePoints(point), isLeftClick
				);
				created = true;
			}
		}

		this.context.freeFormTool.init(currentObject, created);
		this.context.freeFormTool.update(point);
	}

	_geCirclePoints(point) {
		return this.context.freeFormTool.getCircleShape(point);
	}

	_initFromPoints(points, isLeftClick) {
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
		if (temporary) return false;
		this.context.freeFormTool.hideCursor();
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
			&& e.code === "AltLeft" && e.shiftKey && !e.ctrlKey) {

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
			&& e.code === "AltLeft";
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
		if (!objectFactory) return;
		this._finish(objectFactory);
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) this.abortClick();
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
		return e.code === "AltLeft" && !e.ctrlKey && !e.shiftKey;
	}

	rejects(e) {
		return e.code === "AltLeft";
	}
};
