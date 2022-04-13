var OSDAnnotations = class extends OpenSeadragon.EventSource {

	static __self = undefined;

	constructor() {
		super();
		if (this.constructor.__self) {
			throw "Annotation system is not instantiable. Instead, use OSDAnnotations::instance().";
		}

		window.Annotations = this;
		//todo somehow avoid this.id usage to call events..?
		this.id = "Annotations";
		this.constructor.__self = this;
		this._init();
	}

	static instance() {
		if (this.__self) {
			return this.__self;
		}
		return new OSDAnnotations();
	}

	_init() {
		/* Annotation property related data */
		this.Modes = {
			AUTO: new OSDAnnotations.AnnotationState("", "", "", this),
		};
		this.mode = this.Modes.AUTO;
		this.opacity = 0.6;
		this.disabledInteraction = false;
		this.autoSelectionEnabled = VIEWER.hasOwnProperty("bridge");
		this.cursor = {
			mouseTime: 0, //OSD handler click timer
			isDown: false,  //FABRIC handler click down recognition
		};


		/* OSD values used by annotations */
		this.overlay = VIEWER.fabricjsOverlay({
			scale: VIEWER.tools.referencedTileSource().source.Image.Size.Width,
			fireRightClick: true
		});

		OSDAnnotations.AnnotationObjectFactory.register(
			OSDAnnotations.Rect,
			OSDAnnotations.Ellipse,
			OSDAnnotations.Polygon
		);

		//this.canvas.__eventListeners = {};
		// const get = this.canvas.getActiveObject.bind(this.canvas);
		// let self = this;
		// this.canvas.getActiveObject = function() {
		// 	let e = get();
		// 	console.log("GET", e, self.overlay.fabric._activeObject);
		// 	return e;
		// };
		// const set = this.canvas.setActiveObject.bind(this.canvas);
		// this.canvas.setActiveObject = function(e, t) {
		// 	console.log("SET", e, t);
		// 	return set(e, t);
		// };
		// const disc = this.canvas._discardActiveObject.bind(this.canvas);
		// this.canvas._discardActiveObject = function(e, t) {
		// 	console.log("DISCARD", e, self.overlay.fabric.__eventListeners);
		// 	return disc(e, t);
		// };

		// Classes defined in other local JS files
		this.presets = new OSDAnnotations.PresetManager("presets", this);
		this.history = new OSDAnnotations.History("history", this, this.presets);
		this.modifyTool = new OSDAnnotations.FreeFormTool("modifyTool", this);
		this.automaticCreationStrategy = new OSDAnnotations.AutoObjectCreationStrategy("automaticCreationStrategy", this);
		const _this = this;

		// Annotation Objects Factories registered before initialization
		// todo move all logic to just one place, so there are no tow register points?
		this.objectFactories = {};
		OSDAnnotations.AnnotationObjectFactory.visitRegistered(function (AnnotationObjectFactoryClass) {
			_this.registerAnnotationFactory(AnnotationObjectFactoryClass, false);
		}.bind(this));

		if (this.objectFactories.hasOwnProperty("polygon")) {
			//create tool-shaped object
			this.polygonFactory = this.objectFactories["polygon"];
		} else {
			console.warn("See list of factories available: missing polygon.", this.objectFactories);
			throw "No polygon object factory registered. Annotations must contain at " +
			"least a polygon implementation in order to work. Did you maybe named the polygon factory " +
			"implementation differently other than 'polygon'?";
		}

		PLUGINS.addPostExport("annotation-list",
			_ => JSON.stringify(_this.getObjectContent()), "annotations");
		let imageJson = PLUGINS.postData["annotation-list"];
		if (imageJson) {
			try {
				this.loadFromJSON(JSON.parse(imageJson), _ => {
					_this.history.init(50)
				});
			} catch (e) {
				console.warn(e);
				Dialogs.show("Could not load annotations. Please, let us know about this issue and provide means how the visualisation was loaded.", 20000, Dialogs.MSG_ERR);
				this.history.init(50);
			}
		} else {
			this.history.init(50);
		}

		//restore presents if any
		PLUGINS.addPostExport("annotation_presets", this.presets.export.bind(this.presets), "annotations");
		if (PLUGINS.postData.hasOwnProperty("annotation_presets")) {
			this.presets.import(PLUGINS.postData["annotation_presets"]);
		} else {
			this.presets.left = this.presets.addPreset();
		}

		this.setMouseOSDInteractive(true);

		VIEWER.addHandler('key-down', function (e) {
			if (!e.focusCanvas) return;
			_this.keyDownHandler(e);
		});
		VIEWER.addHandler('key-up', function (e) {
			if (!e.focusCanvas) return;
			_this.keyUpHandler(e);
		});

		//Window switch alt+tab makes the mode stuck
		window.addEventListener("focus", function (event) {
			_this.setMode(_this.Modes.AUTO);
		}, false);
		window.addEventListener("blur", function (event) {
			_this.setMode(_this.Modes.AUTO);
		}, false);

		//todo use osd EVENT INSTEAD?
		window.addEventListener("wheel", function (event) {
			_this.mode.scroll(event, event.deltaY / 100);
		});

		this.canvas.on('object:selected', function (e) {
			if (e && e.target) {
				//todo try to fix board if not on board..?
				_this.objectClicked(e.target);
				//keep annotation board selection up to date
				_this.history.highlight(e.target);
			}
		});

		/****************************************************************************************************************
		 Click Handlers
		 Input must be always the event invoked by the user input and point in the image coordinates (absolute pixel
		 position in the scan)
		 *****************************************************************************************************************/
		let screenToPixelCoords = function (x, y) {
			return VIEWER.tools.referencedTileSource().windowToImageCoordinates(new OpenSeadragon.Point(x, y));
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
			//todo presents dependent? omg remove, let event bubble
			if (_this.cursor.isDown || !_this.presets.left || _this.disabledInteraction) return;

			_this.cursor.mouseTime = Date.now();
			_this.cursor.isDown = true;

			let factory = _this.presets.left ? _this.presets.left.objectFactory : undefined;
			let point = screenToPixelCoords(event.x, event.y);
			_this.mode.handleClickDown(event, point, true, factory);
		}

		/****************************************************************************************************************

		 E V E N T  L I S T E N E R S: FABRIC

		 *****************************************************************************************************************/

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

		//Update object when user hodls ALT and moving with mouse (this.isMouseOSDInteractive() == true)
		this.canvas.on('mouse:move', function (o) {
			if (_this.disabledInteraction || !_this.cursor.isDown) return;
			_this.mode.handleMouseMove(_this.canvas.getPointer(o.e));
		});

		/****************************************************************************************************************

		 E V E N T  L I S T E N E R S: OSD (clicks without alt or shift)
		 Since event listeners on fabricJS are disabled when using OSD interactive mode (and vice versa),
		 we register both listeners for OSD and fabricjs

		 *****************************************************************************************************************/

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
	}

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
			case "FREE_FORM_TOOL":
				if (!this.Modes.hasOwnProperty("FREE_FORM_TOOL")) {
					this.Modes.FREE_FORM_TOOL = new OSDAnnotations.StateFreeFormTool(this);
				}
				break;
			default:
				console.error("Invalid mode ", id);
		}
	}

	registerCursorMode(id, ModeClass) {
		if (this.Modes.hasOwnProperty(id)) {
			throw `The mode ${ModeClass} conflicts with another mode: ${this.Modes[id]}`;
		}
		if (!OSDAnnotations.AnnotationState.isPrototypeOf(ModeClass)) {
			throw `The mode ${ModeClass} does not inherit from ${OSDAnnotations.AnnotationState}`;
		}
		this.Modes[id] = new ModeClass(this);
	}

	registerAnnotationFactory(AnnotationObjectFactoryClass, late=true) {
		if (!OSDAnnotations.AnnotationObjectFactory.isPrototypeOf(AnnotationObjectFactoryClass)) {
			throw `The factory ${AnnotationObjectFactoryClass} does not inherit from ${OSDAnnotations.AnnotationObjectFactory}`;
		}
		let factory = new AnnotationObjectFactoryClass(this, this.automaticCreationStrategy, this.presets);
		if (this.objectFactories.hasOwnProperty(factory.type)) {
			throw `The factory ${AnnotationObjectFactoryClass} conflicts with another factory: ${factory.type}`;
		}
		this.objectFactories[factory.type] = factory;

		if (late) {
			this.presetManager().updatePresetsHTML();
		}
	}

	/****************************************************************************************************************

	 S E T T E R S, GETTERS

	 *****************************************************************************************************************/

	getObjectContent(...withProperties) {
		return this.canvas.toObject(['comment', 'a_group', 'threshold', 'borderColor',
			'cornerColor', 'borderScaleFactor', 'color', 'presetID', 'hasControls', ...withProperties]);
	}

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
			if (obj.type === "_polygon.controls.circle") {
				continue
			}
			var xml_annotation = doc.createElement("Annotation");
			let coordinates=[];

			xml_annotation.setAttribute("Name", "Annotation " + i);
			let factory = this.getAnnotationObjectFactory(obj.type);
			if (factory) {
				xml_annotation.setAttribute("Type", "Rectangle");
				coordinates = factory.toPointArray(obj, OSDAnnotations.AnnotationObjectFactory.withArrayPoint);
			}

			//todo a_group not defined
			//todo include preset ID?
			xml_annotation.setAttribute("PartOfGroup", obj.a_group);
			xml_annotation.setAttribute("Color", obj.color);

			//get coordinates in ASAP format
			var xml_coordinates = doc.createElement("Coordinates");


			// create new coordinate element for each coordinate
			for (let j = 0; j < coordinates.length; j++) {
				let xml_coordinate = doc.createElement("Coordinate");
				xml_coordinate.setAttribute("Order", j);
				xml_coordinate.setAttribute("X", coordinates[j][0]);
				xml_coordinate.setAttribute("Y", coordinates[j][1]);
				xml_coordinates.appendChild(xml_coordinate);
			}
			xml_annotation.appendChild(xml_coordinates);
			xml_annotations.appendChild(xml_annotation);
		}
		return doc;
	}

	getXMLStringContent() {
		return new XMLSerializer().serializeToString(this.getXMLDocumentContent());
	}

	setOpacity(opacity) {
		this.opacity = opacity;
		//todo what about setting opacity globaly to the whole canvas?
		this.canvas.forEachObject(function (obj) {
			obj.opacity = opacity;
		});

		this.canvas.renderAll();
	}

	getOpacity() {
		return this.opacity;
	}

	setMouseOSDInteractive(isOSDInteractive, changeCursor=true) {
		if (this.mouseOSDInteractive === isOSDInteractive) return;

		if (isOSDInteractive) {
			this.setOSDTracking(true);

			if (changeCursor) {
				this.canvas.defaultCursor = "crosshair";
				this.canvas.hoverCursor = "pointer";
			}

			//TODO also finish indirect if creation object changed to another object
			if (this.presets.left) this.presets.left.objectFactory.finishIndirect();
			if (this.presets.right) this.presets.right.objectFactory.finishIndirect();

			let active = this.canvas.getActiveObject();
			if (active) {
				active.hasControls = false; //todo remove?
			}

		} else {
			this.setOSDTracking(false);
			if (changeCursor) {
				this.canvas.defaultCursor = "auto";
				//this.canvas.hoverCursor = "move";
			}

			let active = this.canvas.getActiveObject();
			if (active) {
				active.hasControls = true; //todo remove?
			}
		}
		this.mouseOSDInteractive = isOSDInteractive;
	}

	isMouseOSDInteractive() {
		return this.mouseOSDInteractive;
	}

	objectClicked(object) {
		if (this.history.isOngoingEditOf(object)) {
			if (this.isMouseOSDInteractive()) {
				object.set({
					hasControls: false,
					lockMovementX: true,
					lockMovementY: true
				});
			}
			// Do not allow on click changing edit
			// else {
			// 	this.history.itemEdit(object);
			// }
		} else {
			let factory = this.getAnnotationObjectFactory(object.type);
			if (factory) factory.selected(object);
		}
	}

	getAnnotationObjectFactory(objectType) {
		if (this.objectFactories.hasOwnProperty(objectType))
			return this.objectFactories[objectType];
		return undefined;
	}

	setFabricCanvasInteractivity(boolean) {
		this.canvas.forEachObject(function (object) {
			object.selectable = boolean;
		});
	}

	/****************************************************************************************************************

	 A N N O T A T I O N S (User driven Initializers and Updaters)

	 *****************************************************************************************************************/

	//todo move all canvas operations here (from other files)

	loadFromJSON(annotations, onfinish=function(){}) {
		if (!annotations.objects) return;
		$.each(annotations.objects, (key, value) => {
			$.extend(value, OSDAnnotations.PresetManager._commonProperty);
		});
		this.canvas.loadFromJSON(annotations, onfinish);
	}

	exportToFile() {
		function download(id, content) {
			let data = new Blob([content], { type: 'text/plain' });
			let downloadURL = window.URL.createObjectURL(data);
			document.getElementById(id).href = downloadURL;
			document.getElementById(id).click();
			URL.revokeObjectURL(downloadURL);
		}
		//TODO add other attributes for export to preserve funkcionality (border width, etc)
		download("download_link1", JSON.stringify(this.getObjectContent())); //json, containing all necessary properties
		download("download_link2", this.getXMLStringContent()); //asap xml
	}

	addHelperAnnotation(annotation) {
		this.canvas.add(annotation);
	}

	deleteHelperAnnotation(annotation) {
		this.canvas.remove(annotation);
	}

	promoteHelperAnnotation(annotation) {
		this.history.push(annotation);
		this.canvas.setActiveObject(annotation);
		//todo no need to render here - but level up in (some) function call?
		this.canvas.renderAll();
	}

	addAnnotation(annotation) {
		this.addHelperAnnotation(annotation);
		this.promoteHelperAnnotation(annotation);
	}

	replaceAnnotation(previous, next, updateHistory=false) {
		this.canvas.remove(previous);
		this.canvas.add(next);
		if (updateHistory) this.history.push(next, previous);
		this.canvas.renderAll();
	}

	deleteAnnotation(annotation) {
		this.canvas.remove(annotation);
		this.history.push(null, annotation);
		this.canvas.renderAll();
	}

	clearAnnotationSelection() {
		this.canvas.selection = false;
	}

	get canvas() {
		return this.overlay.fabric;
	}

	canvasObjects() {
		return this.canvas.getObjects();
	}

	deselectFabricObjects() {
		this.canvas.deactivateAll().renderAll();
	}

	removeActiveObject() {
		let toRemove = this.canvas.getActiveObject();
		if (toRemove) {
			this.canvas.remove(toRemove);
			//presetID is set to objects that are fully functional annotations
			//incrementId is set to objects by History
			if (toRemove.hasOwnProperty("presetID") && toRemove.hasOwnProperty("incrementId")) {
				this.history.push(null, toRemove);
			}
			this.canvas.renderAll();
		} else {
			Dialogs.show("Please select the annotation you would like to delete", 3000, Dialogs.MSG_INFO);
		}
	}

	setOSDTracking(tracking) {
		VIEWER.setMouseNavEnabled(tracking);
	}

	presetManager() {
		return this.presets;
	}

	// Get all objects from canvas
	deleteAllAnnotations() {
		for (let facId in this.objectFactories) {
			if (!this.objectFactories.hasOwnProperty(facId)) continue;
			this.objectFactories[facId].finishDirect();
		}

		let objects = this.canvas.getObjects();
		/* if objects is null, catch */
		if (objects.length === 0 || !confirm("Do you really want to delete all annotations?")) return;

		let objectsLength = objects.length;
		for (let i = 0; i < objectsLength; i++) {
			this.history.push(null, objects[objectsLength - i - 1]);
			objects[objectsLength - i - 1].remove();
		}
	}

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

	enableInteraction(on) {
		this.disabledInteraction = !on;
		this.raiseEvent('enabled', {isEnabled: on});
		this.history._setControlsVisuallyEnabled(on);
		//return to the default state, always
		this.setMode(this.Modes.AUTO);
	}

	keyDownHandler(e) {
		// switching mode only when no mode AUTO and mouse is up
		if (this.cursor.isDown || this.disabledInteraction) return;

		let modeFromCode = this.getModeByKeyEvent(e);
		if (modeFromCode && this.mode === this.Modes.AUTO) {
			this.setMode(modeFromCode);
			e.preventDefault();
		}
	}

	keyUpHandler(e) {
		if (this.disabledInteraction) return;

		if (e.code === "Delete") {
			this.removeActiveObject();
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

	getModeByKeyEvent(e) {
		for (let key in this.Modes) {
			if (this.Modes.hasOwnProperty(key)) {
				let mode = this.Modes[key];
				if (mode.accepts(e)) return mode;
			}
		}
		return undefined;
	}

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

	setMode(mode) {
		if (mode === this.mode) return;

		if (this.mode === this.Modes.AUTO) {
			this._setModeFromAuto(mode);
		} else if (mode !== this.Modes.AUTO) {
			this._setModeToAuto();
			this._setModeFromAuto(mode);
		} else {
			this._setModeToAuto();
		}
	}

	_setModeFromAuto(mode) {
		//must be early due to custom HTML controls that might be used later
		this.raiseEvent('mode-from-auto', {mode: mode});

		mode.setFromAuto();
		this.mode = mode;
		//$(`#${mode.getId()}-annotation-mode`).prop('checked', true);
	}

	_setModeToAuto() {
		if (this.presets.left) this.presets.left.objectFactory.finishIndirect();
		if (this.presets.right) this.presets.right.objectFactory.finishIndirect();

		//must be early due to custom HTML controls that might be used later
		//$("#mode-custom-items").html(this.Modes.AUTO.customHtml());
		this.raiseEvent('mode-to-auto', {mode: this.Modes.AUTO});

		this.mode.setToAuto();
		this.mode = this.Modes.AUTO;
		//$(`#${this.mode.getId()}-annotation-mode`).prop('checked', true);
	}
};


OSDAnnotations.AnnotationState = class {
	constructor(id, icon, description, context) {
		this._id = id;
		this.icon = icon;
		this.context = context;
		this.description = description;
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		//do nothing
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		//do nothing
	}

	handleMouseMove(point) {
		//do nothing
	}

	customHtml() {
		return "";
	}

	scroll(event, delta) {
		//do nothing
	}

	getDescription() {
		return this.description;
	}

	getIcon() {
		return this.icon;
	}

	getId() {
		return this._id;
	}

	abortClick() {
		this.context.cursor.mouseTime = 0;
		this.context.cursor.isDown = false;
	}

	default() {
		return this._id === "auto";
	}
};

OSDAnnotations.StateAuto = class extends OSDAnnotations.AnnotationState {
	constructor(context) {
		super("auto", "open_with", "navigate and create automatic annotations", context);
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

	handleMouseMove(point) {
		//do nothing
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
		return this.context.autoSelectionEnabled ? this.context.automaticCreationStrategy.sensitivityControls() : "";
	}

	setFromAuto() {
		//do nothing, we are in AUTO
	}

	setToAuto() {
		//do nothing, we are in AUTO
	}

	accepts(e) {
		return false;
	}

	rejects(e) {
		return false;
	}
};

OSDAnnotations.StateFreeFormTool = class extends OSDAnnotations.AnnotationState {
	constructor(context) {
		super("fft", "brush", "draw or adjust annotations by hand (shift)", context);
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		this._finish();
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		this._init(o, point, isLeftClick);
	}

	handleMouseMove(point) {
		this.context.modifyTool.update(point);
	}

	_init(o, point, isLeftClick) {
		let currentObject = this.context.overlay.fabric.getActiveObject(),
			created = false;

		if (!currentObject && this.context.modifyTool._cachedSelection) {
			currentObject = this.context.modifyTool._cachedSelection;
			this.context.modifyTool._cachedSelection = null;
		}

		if (!currentObject) {
			if (!this.context.modifyTool.modeAdd) {
				//subtract needs active object
				this.abortClick();
				return;
			}
			currentObject = this._initPlain(point, isLeftClick);
			created = true;
		} else {
			let bounds = currentObject.getBoundingRect();
			let radius = this.context.modifyTool.screenRadius*1.5;

			let w = bounds.left + bounds.width + radius,
				h = bounds.top + bounds.height + radius;
			bounds.left -= radius;
			bounds.right -= radius;
			if (o.y < bounds.top || o.y > h || o.x < bounds.left || o.x > w) {
				//todo search surrounding objects whether they contain a polygon to update?
				//could be fairly expensive, probably need to loop through all objects :/

				if (!this.context.modifyTool.modeAdd) {
					//subtract needs active object
					this.abortClick();
					return;
				}
				currentObject = this._initPlain(point, isLeftClick);
				created = true;
			}
		}

		this.context.modifyTool.init(currentObject, point, created);
		this.context.modifyTool.update(point);
	}

	_initPlain(point, isLeftClick) {
		let currentObject = this.context.polygonFactory.create(
			this.context.modifyTool.getCircleShape(point), this.context.presets.getAnnotationOptions(isLeftClick)
		);
		this.context.addHelperAnnotation(currentObject);
		return currentObject;
	}

	_finish() {
		let result = this.context.modifyTool.finish();
		if (result) {
			this.context.canvas.setActiveObject(result);
			this.context.canvas.renderAll();
		}
	}

	customHtml() {
		return "";
	}

	scroll(event, delta) {
		//subtract delta - scroll up means increase
		this.context.modifyTool.setSafeRadius(this.context.modifyTool.screenRadius - delta);
	}

	setFromAuto() {
		//dirty but when a mouse is clicked, for some reason active object is deselected
		this.context.modifyTool._cachedSelection = this.context.canvas.getActiveObject();
		this.context.setOSDTracking(false);
		this.context.canvas.hoverCursor = "crosshair";
		this.context.modifyTool.setModeAdd(true);
		this.context.modifyTool.recomputeRadius();
		this.context.modifyTool.showCursor();
	}

	setToAuto() {
		this.context.canvas.hoverCursor = "pointer";
		this.context.modifyTool.hideCursor();
		this.context.setOSDTracking(true);
		this.context.canvas.renderAll();
	}

	accepts(e) {
		//in case event occurs that we would like to treat as our own but change only the mode of working inside
		//note: mode will not be changed as this mode is already set
		if (this.context.mode === this && e.code === "AltLeft" && e.shiftKey && !e.ctrlKey) {
			this.context.modifyTool.setModeAdd(false);
			return true;
		}
		return e.key === "Shift" && !e.altKey && !e.ctrlKey;
	}

	rejects(e) {
		if (this.context.mode === this && e.code === "AltLeft" && e.shiftKey && !e.ctrlKey) {
			this.context.modifyTool.setModeAdd(true);
			return false; //we do not reject this mode, just change the behaviour
		}
		return e.key === "Shift";
	}
};

OSDAnnotations.StateCustomCreate = class extends OSDAnnotations.AnnotationState {
	constructor(context) {
		super("custom", "format_shapes","create annotations manually (alt)", context);
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
		if (delta < 100) {
			if (!updater.isValidShortCreationClick()) {
				this.context.canvas.remove(updater.getCurrentObject());
				return;
			}
		}
		updater.finishDirect();
	}

	setFromAuto(mode) {
		this.context.setOSDTracking(false);
		//deselect active if present
		this.context.canvas.discardActiveObject();
	}

	customHtml() {
		return "";
	}

	setToAuto() {
		this.context.setOSDTracking(true);
	}

	accepts(e) {
		return e.code === "AltLeft" && !e.ctrlKey && !e.shiftKey;
	}

	rejects(e) {
		return e.code === "AltLeft";
	}
};
