OSDAnnotations = function (incoming) {
	this.id = OSDAnnotations.identifier;

	this.overlay = null;

	/*
	Global setting to show/hide annotations on default
	*/
	this.showAnnotations = true;
	/* Annotation property related data */

	// Assign from incoming terms
	for (var key in incoming) {
		this[key] = incoming[key];
	}

	this.Modes = Object.freeze({
		AUTO: new StateAuto(this),
		CUSTOM: new StateCustomCreate(this),
		FREE_FORM_TOOL: new StateFreeFormTool(this)
	});
	this.mode = this.Modes.AUTO;
	this.disabledInteraction = false;
	this.autoSelectionEnabled = PLUGINS.hasLayers;

	//Register used annotation object factories
	AnnotationObjectFactory.register(Rect, Ellipse, Polygon);
};

//TODO performance check where i use Object.keys() or Object.values() whether it does not copy objects deeply
OSDAnnotations.prototype = {

	registerAnnotationFactory: function(AnnotationObjectFactoryClass, late=true) {
		let factory = new AnnotationObjectFactoryClass(this, this._automaticCreationStrategy, this.presets);
		if (this.objectFactories.hasOwnProperty(factory.type)) {
			throw `The factory ${AnnotationObjectFactoryClass} conflicts with another factory: ${factory.type}`;
		}
		this.objectFactories[factory.type] = factory;

		if (late) {
			this.presetManager().updatePresetsHTML();
		}
	},

	/*
	Initialize member variables
	*/
	openSeadragonReady: function () {
		// Classes defined in other local JS files
		this.presets = new PresetManager("presets", this);
		this.history = new History("history", this, this.presets);
		this.modifyTool = new FreeFormTool("modifyTool", this);
		this._automaticCreationStrategy = new AutoObjectCreationStrategy("_automaticCreationStrategy", this);

		// Annotation Objects
		this.objectFactories = {};
		AnnotationObjectFactory.visitRegistered(function (AnnotationObjectFactoryClass) {
			this.registerAnnotationFactory(AnnotationObjectFactoryClass, false);
		}.bind(this));

		if (this.objectFactories.hasOwnProperty("polygon")) {
			//create tool-shaped object
			this.polygonFactory = this.objectFactories["polygon"];
		} else {
			console.error("No polygon object factory registered. Annotations must contain at " +
				"least a polygon implementation in order to work. Did you maybe named the polygon factory " +
				"implementation differently other than 'polygon'?", "See list of factories available.",
				this.objectFactories);
			//todo throw error instead? it is safe...
			return;
		}

		/* OSD values used by annotations */
		this.overlay = PLUGINS.osd.fabricjsOverlay({
			scale: PLUGINS.imageLayer().source.Image.Size.Width,
			fireRightClick: true
		});

		const _this = this;

		//init on html sooner than history so it is placed above
		this.initHTML();

		//restore annotations if any
		// todo allow user to load his own annotations (probably to a separate layer)
		PLUGINS.addPostExport("annotation-list", this.getJSONContent.bind(this), this.id);
		let imageJson = PLUGINS.postData["annotation-list"];
		if (imageJson) {
			try {
				this.overlay.fabricCanvas().loadFromJSON(imageJson, function () {
					_this.overlay.fabricCanvas().renderAll.bind(_this.overlay.fabricCanvas());
					_this.history.init(50);
				});
			} catch (e) {
				console.warn(e);
				PLUGINS.dialog.show("Could not load annotations. Please, let us know about this issue and provide means how the visualisation was loaded.", 20000, PLUGINS.dialog.MSG_ERR);
				this.history.init(50);
			}
		} else {
			this.history.init(50);
		}

		//restore presents if any
		PLUGINS.addPostExport("annotation_presets", this.presets.export.bind(this.presets), this.id);
		if (PLUGINS.postData.hasOwnProperty("annotation_presets")) {
			this.presets.import(PLUGINS.postData["annotation_presets"]);
		} else {
			this.presets.left = this.presets.addPreset();
			this.presets.updatePresetsHTML();
		}

		//cache nodes after HTML added
		this._modesJqNode = $("#annotation-mode");
		this.presets.updatePresetsHTML();
		this.setMouseOSDInteractive(true);

		this.setupTutorials();

		this.cursor.init();
		this.opacity = $("#annotations-opacity");

		//Window switch alt+tab makes the mode stuck
		window.addEventListener("focus", function(event) {
			_this.setMode(_this.Modes.AUTO);
		}, false);

		window.addEventListener("wheel", function (event) {
			_this.mode.scroll(event, event.deltaY / 100);
		});

		/****************************************************************************************************************
	
									Click Handlers
		 Input must be always the event invoked by the user input and point in the image coordinates (absolute pixel
		 position in the scan)
		*****************************************************************************************************************/

		let screenToPixelCoords = function(x, y) {
			return PLUGINS.imageLayer().windowToImageCoordinates(new OpenSeadragon.Point(x, y));
		}.bind(this);

		function handleRightClickUp(event) {
			if (!_this.cursor.isDown || _this.disabledInteraction) return;

			let factory = _this.presets.right ? _this.presets.right.objectFactory : undefined;
			let point = screenToPixelCoords(event.x, event.y)
			_this.mode.handleClickUp(event, point, false, factory);

			_this.cursor.isDown = false;
		}

		function handleRightClickDown(event) {
			if (_this.cursor.isDown || _this.disabledInteraction) return;

			_this.cursor.mouseTime = Date.now();
			_this.cursor.isDown = true;

			let factory = _this.presets.right ? _this.presets.right.objectFactory : undefined;
			let point = screenToPixelCoords(event.x, event.y)
			_this.mode.handleClickDown(event, point, false, factory);
		}

		function handleLeftClickUp(event) {
			if (!_this.cursor.isDown || _this.disabledInteraction) return;

			let factory = _this.presets.left ? _this.presets.left.objectFactory : undefined;
			let point = screenToPixelCoords(event.x, event.y)
			_this.mode.handleClickUp(event, point, true, factory);
			_this.cursor.isDown = false;
		}

		function handleLeftClickDown(event) {
			if (_this.cursor.isDown || !_this.presets.left || _this.disabledInteraction) return;

			_this.cursor.mouseTime = Date.now();
			_this.cursor.isDown = true;

			let factory = _this.presets.left ? _this.presets.left.objectFactory : undefined;
			let point = screenToPixelCoords(event.x, event.y)
			_this.mode.handleClickDown(event, point, true, factory);
		}

		/****************************************************************************************************************
	
												 E V E N T  L I S T E N E R S: FABRIC
	
		*****************************************************************************************************************/

		let annotationCanvas = this.overlay.fabricCanvas().upperCanvasEl;
		annotationCanvas.addEventListener('mousedown', function (event) {
			if (!_this.showAnnotations) return;

			if (event.which === 1) handleLeftClickDown(event);
			else if (event.which === 3) handleRightClickDown(event);
		});

		annotationCanvas.addEventListener('mouseup', function (event) {
		if (!_this.showAnnotations) return;

			if (event.which === 1) handleLeftClickUp(event);
			else if (event.which === 3) handleRightClickUp(event);
		});

		//These functions already pass pointer in image coordinates

		//Update object when user hodls ALT and moving with mouse (_this.isMouseOSDInteractive() == true)
		this.overlay.fabricCanvas().on('mouse:move', function (o) {
			if (!_this.showAnnotations || !_this.cursor.isDown) return;
			_this.mode.handleMouseMove(_this.overlay.fabricCanvas().getPointer(o.e));
		});

		this.overlay.fabricCanvas().on('object:selected', function (e) {
			if (e && e.target) {

				//todo try to fix board if not on board..?
				let isInEditMode = _this.history.isOngoingEditOf(e.target);
				if (isInEditMode) {
					_this.history.setOnGoingEditObject(e.target);
					if (_this.isMouseOSDInteractive()) {
						e.target.set({
							hasControls: false,
							lockMovementX: true,
							lockMovementY: true
						});
					} else {
						let factory = _this.getAnnotationObjectFactory(e.target.type);
						if (factory) factory.edit(e.target);
					}
				} else {
					let factory = _this.getAnnotationObjectFactory(e.target.type);
					if (factory) factory.selected(e.target);
				}

				//keep annotation board selection up to date
				_this.history.highlight(e.target);
			}
		});

		/****************************************************************************************************************

											 E V E N T  L I S T E N E R S: OSD (clicks without alt or shift)
			Since event listeners on fabricJS are disabled when using OSD interactive mode (and vice versa), 
			we register both listeners for OSD and fabricjs

		*****************************************************************************************************************/

		PLUGINS.osd.addHandler("canvas-press", function (e) {
			if (!_this.showAnnotations) return;
			handleLeftClickDown(e.originalEvent);
		});

		PLUGINS.osd.addHandler("canvas-release", function (e) {
			if (!_this.showAnnotations) return;
			handleLeftClickUp(e.originalEvent);
		});

		PLUGINS.osd.addHandler("canvas-nonprimary-press", function (e) {
			if (!_this.showAnnotations) return;
			handleRightClickDown(e.originalEvent);
		});

		PLUGINS.osd.addHandler("canvas-nonprimary-release", function (e) {
			if (!_this.showAnnotations) return;
			handleRightClickUp(e.originalEvent);
		});

		$(PLUGINS.osd.element).on('contextmenu', function (event) {
			event.preventDefault();
		});
	
		/****************************************************************************************************************

											 E V E N T  L I S T E N E R S: GENERAL

		*****************************************************************************************************************/

		document.addEventListener('keydown', (e) => {
			// switching mode only when no mode AUTO and mouse is up
			if (!_this.showAnnotations || _this.cursor.isDown || _this.disabledInteraction) return;

			let modeFromCode = _this.getModeByKeyEvent(e);
			if (modeFromCode && this.mode === this.Modes.AUTO) {
				_this.setMode(modeFromCode);
				e.preventDefault();
			}
		});

		document.addEventListener('keyup', (e) => {
			if (!_this.showAnnotations || _this.disabledInteraction) return;

			if (e.code === "Delete") {
				_this.removeActiveObject();
				return;
			}

			if (e.ctrlKey && e.code === "KeyY") {
				if (e.shiftKey) _this.history.redo();
				else _this.history.back();
				return;
			}

			if (_this.mode.rejects(e)) {
				_this.setMode(this.Modes.AUTO);	
				e.preventDefault();		
			}	
		});

		// TODO re-implement?
		// listen for annotation send button
		//$('#sendAnnotation').click(function (event) {
			//generate ASAPXML annotations
			// var doc = generate_ASAPxml(_this.overlay.fabricCanvas()._objects);
			// var xml_text = new XMLSerializer().serializeToString(doc);
			//
			// // get file name from probabilities layer (axperiment:slide)
			// var probabs_url_array = PLUGINS.osd.tileSources[2].split("=")[1].split("/");
			// var slide = probabs_url_array.pop().split(".")[0].slice(0, -4);
			// var experiment = probabs_url_array.pop();
			// var file_name = [experiment, slide].join(":");
			//
			// //prepare data to be send, (file_name and xml with annotations)
			// var send_data = { "name": file_name, "xml": xml_text };
			//
			// $.ajaxSetup({
			// 	headers: {
			// 		'Content-Type': 'application/json',
			// 		'Accept': 'application/json'
			// 	}
			// });
			// //send data to url
			// $.post('http://ip-78-128-251-178.flt.cloud.muni.cz:5050/occlusion',  // url
			// 	JSON.stringify(send_data), // data to be submit
			// 	function (data, status, xhr) {   // success callback function
			// 		PLUGINS.dialog.show('status: ' + status + ', data: ' + data.responseData, 8000, PLUGINS.dialog.MSG_INFO);
			// 	});
		//});

		//todo decide what format to use, discard the other one
		// download annotation as default json file and generated ASAP xml file
		$('#downloadAnnotation').click(function (event) {
			function download(id, content) {
				let data = new Blob([content], { type: 'text/plain' });
				let downloadURL = window.URL.createObjectURL(data);
				document.getElementById(id).href = downloadURL;
				document.getElementById(id).click();
				URL.revokeObjectURL(downloadURL);
			}
			//TODO add other attributes for export to preserve funkcionality (border width, etc)
			download(_this.getJSONContent());
			//asap xml
			download(_this.getXMLStringContent());
		});

		// listen for changes in opacity slider and change opacity for each annotation
		this.opacity.on("input", function () {
			//todo what about setting opacity globaly to the whole canvas?
			var opacity = $(this).val();
			_this.overlay.fabricCanvas().forEachObject(function (obj) {
				obj.opacity = opacity;
			});

			_this.overlay.fabricCanvas().renderAll();
		});
	}, // end of initialize

	/****************************************************************************************************************

									HTML MANIPULATION

	*****************************************************************************************************************/

	initHTML: function() {
		let autoSelectionControls = this.autoSelectionEnabled ? this._automaticCreationStrategy.sensitivityControls() : "";
		autoSelectionControls += "<br>";

		PLUGINS.appendToMainMenuExtended(
			"Annotations",
			`
<span class="material-icons pointer" onclick="Tutorials.show()" title="Help" style="float: right;">help</span>
<span class="material-icons pointer" id="downloadAnnotation" title="Export annotations" style="float: right;">download</span>
<!-- <button type="button" class="btn btn-secondary" autocomplete="off" id="sendAnnotation">Send</button> -->
<span class="material-icons pointer" id="show-annotation-board" title="Show board" style="float: right;" data-ref="on" onclick="${this.id}.history.openHistoryWindow();">assignment</span>
<span class="material-icons pointer" id="enable-disable-annotations" title="Enable/disable annotations" style="float: right;" data-ref="on" onclick="
	let self = $(this); 
	if (self.attr('data-ref') === 'on'){
		${this.id}.enableAnnotations(false); self.html('visibility_off'); self.attr('data-ref', 'off');
	} else {
		${this.id}.enableAnnotations(true); self.html('visibility'); self.attr('data-ref', 'on');
	}"> visibility</span>`,
			`
<span>Opacity: &emsp;</span>
<input type="range" id="annotations-opacity" min="0" max="1" value="0.4" step="0.1"><br><br>${this.presets.presetControls()}
<a id="download_link1" download="my_exported_file.json" href="" hidden>Download JSON</a>
<a id="download_link2" download="my_exported_file.xml" href="" hidden>Download XML</a>`,
			`
<div id="imageAnnotationToolbarContent"><br>
	${this.presets.presetHiddenControls()}<br>
	<!--${autoSelectionControls}
	${this.modifyTool.brushSizeControls()}-->
</div>`,
				"annotations-panel",
				this.id
		);


		let modeOptions = "";
		Object.values(this.Modes).forEach(mode => {
			let selected = mode.default() ? "selected" : "";
			modeOptions += `<option value="${mode.getId()}" ${selected}>${mode.getBanner()}</option>`;
		});
		//status bar & cursor
		$("body").append(`
<div id="annotation-cursor" class="${this.id}-plugin-root" style="border: 2px solid black;border-radius: 50%;position: absolute;transform: translate(-50%, -50%);pointer-events: none;display:none;"></div>
<div id="annotation-status-bar-background"></div>
<div id="annotation-status-bar" class="${this.id}-plugin-root">
	<select id="annotation-mode" class="form-control mx-2" onchange="${this.id}.setModeById($(this).val());return false;">
		${modeOptions}
	</select>
	<div id="mode-custom-items">${this.mode.customHtml()}</div>
</div>`);
	},

	setupTutorials: function() {
		PLUGINS.addTutorial(
			this.id, "Annotations Plugin Overview", "get familiar with the annotations plugin", "draw", [
			{
				"next #annotations-panel": "Annotations allow you to annotate <br>the canvas parts and export and share all of it."
			}, {
				"next #window-manager": "Annotation board is useful for existing objects management.<br> You can control the board window in the window manager."
			},{
				"next #enable-disable-annotations": "This icon can temporarily disable <br>all annotations - not just hide, but disable also <br>all plugin controls and hotkeys."
			},{
				"next #downloadAnnotation": "Here you can download <b>just</b> your annotations.<br>This is included automatically when using global `Export` option."
			},{
				"click #annotations-panel-pin": "Click on the pin to keep visible all controls."
			},{
				"next #annotations-left-click": "Each of your mouse buttons<br>can be used to create annotations.<br>Simply assign some pre-set and start annotating!<br>Shape change can be done quickly by mouse hover."
			},{
				"click #annotations-right-click": "Click on one of these buttons to open <b>Presets dialog window</b>."
			},{
				"next #preset-no-0": "This is an example of an annotation preset."
			},{
				"click #preset-add-new": "We want to keep the old preset,<br>so create a new one. Click on 'New'."
			},{
				"click #preset-no-1": "Click anywhere on the preset. This will select it for the right mouse button."
			},{
				"click #select-annotation-preset-right": "Click <b>Set for right click</b> to assign it to the right mouse button."
			},{
				"next #viewer-container": "You can now use right mouse button<br>to create a polygons,<br>or the left button for different preset - at once!"
			},{
				"next #annotation-mode": "Apart from the default, navigation mode, you can switch to different annotation modes here. Modes are closely described in other tutorials."
			}]
		);

		//todo bit dirty...
		let pluginOpener = (function() {let pin = document.getElementById("annotations-panel-pin"); if (pin) pin.click()});
		PLUGINS.addTutorial(
			this.id, "Automatic annotations", "learn how to let the computer do the job", "auto_fix_high", [
				{
					"next #sensitivity-auto-outline": "You have to select what data you want to annotate.<br> Then, automatic annotation can be created by a double-click."
				},
				{
					"next #annotations-left-click": "If you use POLYGON and click on empty space, the plugin will tell you.<br>Creation migh also fail - you can try adjusting ZOOM level or clicking on a different spot."
				},
				{
					"next #annotations-left-click": "Rectangle and ellipse will try to fit the data in layer you selected, <br> but if you click somewhere without data, instead of failure a default-size object<br> will be created."
				},
				{
					"next #inner-panel-content-1": "It is a good idea to limit threshold values: selected regions will be smaller with higher thresholds."
				},
				{
					"next #viewer-container": "Now you can try it out."
				}
			], pluginOpener
		);

		PLUGINS.addTutorial(
			this.id, "Custom annotations", "create annotations with your hand", "architecture", [
				{
					"next #annotation-mode": "You need to be in custom mode. We recommend using 'Left Alt' key <br> instead of setting this manually."
				},
				{
					"next #annotations-left-click": "If you use POLYGON you can click or drag mouse to create its vertices.<br> For now, polygon will be finished if you change mode, so releasing Alt key is a good way to go."
				},
				{
					"next #annotations-left-click": "Rectangle and ellipse will be created by click-drag movement."
				},
				{
					"next #viewer-container": "Now you can try it out."
				}
			], pluginOpener
		);

		PLUGINS.addTutorial(
			this.id, "Free form tool", "painting with your mouse", "gesture", [
				{
					"next #annotation-mode": "You need to be in free form tool. We recommend using 'Left Shift' key <br> instead of setting this manually."
				},
				{
					"next #viewer-container": "Hold Left Shift while drawing on a canvas<br>(by a mouse button which has assigned any preset)."
				},
				{
					"next #bord-for-annotations": "Your last-created annotation should be now highlighted."
				},
				{
					"next #viewer-container": "Selected object can be appended to (Left Shift only) or removed from (Left Shift + Left Alt)."
				},
				{
					"next #viewer-container": "Now you can try it out."
				}
			], pluginOpener
		);

		PLUGINS.addTutorial(
			this.id, "Annotations Board", "annotations management", "dashboard_customize", [
				{
					"next #viewer-container": "First, make sure you have some annotation created. If not, make one now."
				},
				{
					"click #history-undo": "A history cache will allow you to undo few last modifications.<br>Click here to undo the last step. Shortcut is Ctrl+Z."
				},
				{
					"click #history-redo": "Click on 'redo' to return the last change.<br><b>Caveat</b>: redo history is erased on manual history change. Shortcut is Ctrl+Shift+Z."
				},
				{
					"next #history-refresh": "Refreshing the board might come useful in case<br>some unexpected error caused the board miss an annotation."
				},
				{
					"next #history-sync": "You can update all objects to reflect the most recent changes on presets. <br><b>Caveat</b>: this will overwrite any custom modifications made to annotations (comment/color)."
				},
				{
					"next #bord-for-annotations": "If you want to modify some object, click on the pencil icon.<br> The board will turn red to notify you navigation is disabled."
				}
			], pluginOpener
		);
	},

	/****************************************************************************************************************

									S E T T E R S, GETTERS

	*****************************************************************************************************************/

	getJSONContent: function () {
		return JSON.stringify(this.overlay.fabricCanvas().toObject(['comment', 'a_group', 'threshold', 'borderColor',
			'cornerColor', 'borderScaleFactor', 'color', 'presetID']));
	},

	getXMLDocumentContent: function() {
		// first, create xml dom
		let doc = document.implementation.createDocument("", "", null);
		let ASAP_annot = doc.createElement("ASAP_Annotations");
		let xml_annotations = doc.createElement("Annotations");
		ASAP_annot.appendChild(xml_annotations);
		doc.appendChild(ASAP_annot);

		// for each object (annotation) create new annotation element with coresponding coordinates
		let canvas_objects = this.overlay.fabricCanvas()._objects;
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
				coordinates = factory.toPointArray(obj, AnnotationObjectFactory.withArrayPoint);
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
	},

	getXMLStringContent: function() {
		return new XMLSerializer().serializeToString(this.getXMLDocumentContent());
	},

	setMouseOSDInteractive: function (isOSDInteractive, changeCursor=true) {
		if (this.mouseOSDInteractive === isOSDInteractive) return;

		if (isOSDInteractive) {
			this.setOSDTracking(true);

			if (changeCursor) {
				this.overlay.fabricCanvas().defaultCursor = "crosshair";
				this.overlay.fabricCanvas().hoverCursor = "pointer";
			}

			//TODO also finish indirect if creation object changed to another object
			if (this.presets.left) this.presets.left.objectFactory.finishIndirect();
			if (this.presets.right) this.presets.right.objectFactory.finishIndirect();

			let active = this.overlay.fabricCanvas().getActiveObject();
			if (active) {
				active.hasControls = false; //todo remove?
			}

		} else {
			this.setOSDTracking(false);
			if (changeCursor) {
				this.overlay.fabricCanvas().defaultCursor = "auto";
				//this.overlay.fabricCanvas().hoverCursor = "move";
			}

			let active = this.overlay.fabricCanvas().getActiveObject();
			if (active) {
				active.hasControls = true; //todo remove?
			}
		}
		this.mouseOSDInteractive = isOSDInteractive;
	},

	isMouseOSDInteractive: function () {
		return this.mouseOSDInteractive;
	},

	
	/****************************************************************************************************************
 
									 A N N O T A T I O N S (User driven Initializers and Updaters)
 
	 *****************************************************************************************************************/

	//todo move all canvas operations here (from other files)

	getAnnotationObjectFactory: function(objectType) {
		if (this.objectFactories.hasOwnProperty(objectType))
			return this.objectFactories[objectType];
		return undefined;
	},

	setFabricCanvasInteractivity: function (boolean) {
		this.overlay.fabricCanvas().forEachObject(function (object) {
			object.selectable = boolean;
		});
	},

	addHelperAnnotation: function(annotation) {
		this.overlay.fabricCanvas().add(annotation);
	},

	deleteHelperAnnotation: function(annotation) {
		this.overlay.fabricCanvas().remove(annotation);
	},

	promoteHelperAnnotation: function(annotation) {
		this.history.push(annotation);
		this.overlay.fabricCanvas().setActiveObject(annotation);
		//todo no need to render here - but level up in (some) function call?
		this.overlay.fabricCanvas().renderAll();
	},

	addAnnotation: function(annotation) {
		this.addHelperAnnotation(annotation);
		this.promoteHelperAnnotation(annotation);
	},

	replaceAnnotation: function(previous, next, updateHistory=false) {
		this.overlay.fabricCanvas().remove(previous);
		this.overlay.fabricCanvas().add(next);
		if (updateHistory) this.history.push(next, previous);
		this.overlay.fabricCanvas().renderAll();
    },

	deleteAnnotation: function(annotation) {
		this.overlay.fabricCanvas().remove(annotation);
		this.history.push(null, annotation);
		this.overlay.fabricCanvas().renderAll();
	},

	clearAnnotationSelection: function() {
		this.overlay.fabricCanvas().selection = false;
	},

	canvas: function() {
		return this.overlay.fabricCanvas();
	},

	canvasObjects: function() {
		return this.overlay.fabricCanvas().getObjects();
	},

	deselectFabricObjects: function () {
		this.overlay.fabricCanvas().deactivateAll().renderAll();
	},

	setOSDTracking: function(tracking) {
		const osd = PLUGINS.osd;
		osd.setMouseNavEnabled(tracking);
		osd.outerTracker.setTracking(tracking);
	},

	presetManager: function() {
		return this.presets;
	},

	removeActiveObject: function () {
		let toRemove = this.overlay.fabricCanvas().getActiveObject();
		if (toRemove) {
			this.overlay.fabricCanvas().remove(toRemove);
			//presetID is set to objects that are fully functional annotations
			//incrementId is set to objects by History
			if (toRemove.hasOwnProperty("presetID") && toRemove.hasOwnProperty("incrementId")) {
				this.history.push(null, toRemove);
			}
			this.overlay.fabricCanvas().renderAll();
		} else {
			PLUGINS.dialog.show("Please select the annotation you would like to delete", 3000, PLUGINS.dialog.MSG_INFO);
		}
	},

	// Get all objects from canvas
	deleteAllAnnotations: function () {
		Object.values(this.objectFactories).forEach(value => value.finishIndirect());

		let objects = this.overlay.fabricCanvas().getObjects();
		/* if objects is null, catch */
		if (objects.length === 0 || !confirm("Do you really want to delete all annotations?")) return;

		let objectsLength = objects.length
		for (let i = 0; i < objectsLength; i++) {
			this.history.push(null, objects[objectsLength - i - 1]);
			objects[objectsLength - i - 1].remove();
		}
	},

	enableAnnotations: function (on) {
		let objects = this.overlay.fabricCanvas().getObjects();
		this.enableInteraction(on);

		if (on) {
			this.showAnnotations = true;
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
				this.overlay.fabricCanvas().setActiveObject(this.cachedTargetCanvasSelection);
			}
		} else {
			this.cachedTargetCanvasSelection = this.overlay.fabricCanvas().getActiveObject();
			this.history.highlight(null);
			this.showAnnotations = false;
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
			this.overlay.fabricCanvas().deactivateAll();
		}
		this.overlay.fabricCanvas().renderAll();
	},

	enableInteraction: function(on) {
		this.disabledInteraction = !on;
		this._modesJqNode.attr('disabled', !on);
		this.history._setControlsVisuallyEnabled(on);
	},

	getModeByKeyEvent: function(e) {
		let result = undefined;
		for (let key in this.Modes) {
			if (this.Modes.hasOwnProperty(key)) {
				let mode = this.Modes[key];
				if (mode.accepts(e)) return mode;
			}
		}
		return undefined;
	},

	setModeById: function(id) {
		let _this = this;
		Object.values(this.Modes).some(mode => {
			let found = mode.getId() === id;
			if (found) {
				_this.setMode(mode);
			}
			return found;
		});
	},

	setMode: function(mode) {
		if (mode === this.mode) return;

		if (this.mode === this.Modes.AUTO) {
			this._setModeFromAuto(mode);
		} else if (mode !== this.Modes.AUTO) {
			this._setModeToAuto();
			this._setModeFromAuto(mode);
		} else {
			this._setModeToAuto();
		}
	},

	_setModeFromAuto: function(mode) {
		//must be early due to custom HTML controls that might be used later
		$("#mode-custom-items").html(mode.customHtml());

		mode.setFromAuto();
		this.mode = mode;
		//todo handle the node
		this._modesJqNode.val(mode.getId());
	},

	_setModeToAuto: function() {
		if (this.presets.left) this.presets.left.objectFactory.finishIndirect();
		if (this.presets.right) this.presets.right.objectFactory.finishIndirect();

		//must be early due to custom HTML controls that might be used later
		$("#mode-custom-items").html(this.Modes.AUTO.customHtml());

		this.mode.setToAuto();
		this.mode = this.Modes.AUTO;
		//todo handle the node
		this._modesJqNode.val(this.Modes.AUTO.getId());
	},

	/**
	 * Cursor object that
	 */
	cursor: {
		_visible: false,
		_updater: null,
		_node: null,
		_toolRadius: 0,

		mouseTime: 0, //OSD handler click timer
		isDown: false,  //FABRIC handler click down recognition

		init: function () {
			this._node = document.getElementById("annotation-cursor");
		},

		updateRadius: function () {
			//todo context instead
			this._toolRadius = openseadragon_image_annotations.modifyTool.getScreenToolRadius() * 2;
			if (this._node) {
				this._node.style.width = (this._toolRadius) + "px";
				this._node.style.height = (this._toolRadius) + "px";
			}
		},

		getHTMLNode: function () {
			return this._node;
		},

		show: function () {
			if (this._listener) return;
			this._node.style.display = "block";
			this.updateRadius();
			this._node.style.width = (this._toolRadius) + "px";
			this._node.style.height = (this._toolRadius) + "px";
			this._node.style.top = "0px";
			this._node.style.left = "0px";

			const c = this._node;

			this._visible = true;
			this._listener = e => {
				c.style.top = e.pageY + "px";
				c.style.left = e.pageX + "px";
			};
			window.addEventListener("mousemove", this._listener);
		},

		hide: function () {
			if (!this._listener) return;
			this._node.style.display = "none";
			this._visible = false;
			window.removeEventListener("mousemove", this._listener);
			this._listener = null;
		},
	}
} // end of main namespace

class AnnotationState {
	constructor(id, banner, context) {
		this._id = id;
		this.banner = banner;
		this.context = context;
	}

	getBanner() {
		return this.banner;
	}

	scroll(event, delta) {

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
}

class StateAuto extends AnnotationState {
	constructor(context) {
		super("auto", "automatic shape & navigation", context);
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
		let active = this.context.canvas().findTarget(event);
		if (active) {
			this.context.canvas().setActiveObject(active);
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
			PLUGINS.dialog.show("Could not create automatic annotation.", 5000, PLUGINS.dialog.MSG_WARN);
		}
	}

	customHtml() {
		return this.context.autoSelectionEnabled ? this.context._automaticCreationStrategy.sensitivityControls() : "";
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
}

class StateFreeFormTool extends AnnotationState {
	constructor(context) {
		super("fft", "&#9733; free form tool (⌨ Left Shift)", context);
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
		let currentObject = this.context.overlay.fabricCanvas().getActiveObject();
		if (!currentObject && this.context.modifyTool._cachedSelection) {
			currentObject = this.context.modifyTool._cachedSelection;
			this.context.modifyTool._cachedSelection = null;
		}

		if (!currentObject) {
			currentObject = this._initPlain(point, isLeftClick);
		} else {
			let bounds = currentObject.getBoundingRect();
			let w = bounds.left + bounds.width,
				h = bounds.top + bounds.height;
			if (o.y < bounds.top || o.y > h || o.x < bounds.left || o.x > w) {
				currentObject = this._initPlain(point, isLeftClick);
			}
		}
		this.context.modifyTool.init(currentObject, point);
		this.context.modifyTool.update(point);
	}

	_initPlain(point, isLeftClick) {
		let currentObject = this.context.polygonFactory.create(
			this.context.modifyTool.getCircleShape(point), this.context.presets.getAnnotationOptions(isLeftClick)
		);
		this.context.addAnnotation(currentObject);
		return currentObject;
	}

	_finish() {
		let result = this.context.modifyTool.finish();
		if (result) this.context.canvas().setActiveObject(result);
	}

	customHtml() {
		return this.context.modifyTool.brushSizeControls();
	}

	scroll(event, delta) {
		//subtract delta - scroll up means increase
		this.context.modifyTool.setSafeRadius(this.context.modifyTool.screenRadius - delta);
		this.context.cursor.updateRadius();
	}

	setFromAuto() {
		//dirty but when a mouse is clicked, for some reason active object is deselected
		this.context.modifyTool._cachedSelection = this.context.canvas().getActiveObject();
		this.context.setOSDTracking(false);
		this.context.canvas().hoverCursor = "crosshair";
		this.context.modifyTool.setModeAdd(true);
		this.context.modifyTool.updateRadius();
		this.context.cursor.show();
	}

	setToAuto() {
		this.context.canvas().hoverCursor = "pointer";
		this.context.cursor.hide();
		this.context.setOSDTracking(true);
		this.context.canvas().renderAll();
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
		return e.key === "Shift" && !e.altKey && !e.ctrlKey;
	}
}

class StateCustomCreate extends AnnotationState {
	constructor(context) {
		super("custom", "🖌 custom shape (⌨ Left Alt)", context);
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
			this.context.canvas().renderAll();
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
				this.context.canvas().remove(updater.getCurrentObject());
				return;
			}
		}
		updater.finishDirect();
	}

	setFromAuto(mode) {
		this.context.setOSDTracking(false);
		//deselect active if present
		this.context.canvas().discardActiveObject();
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
}

OSDAnnotations.identifier = "openseadragon_image_annotations";

//todo move to script where used
OSDAnnotations.sleep = function (ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
};


/*------------ Initialization of OSD Annotations ------------*/
registerPlugin(OSDAnnotations);