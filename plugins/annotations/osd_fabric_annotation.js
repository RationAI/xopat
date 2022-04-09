class OSDAnnotations  {
	constructor(id, params) {
		this.id = id;

		this.overlay = null;

		/* Annotation property related data */

		this.Modes = Object.freeze({
			AUTO: new OSDAnnotations.StateAuto(this),
			CUSTOM: new OSDAnnotations.StateCustomCreate(this),
			FREE_FORM_TOOL: new OSDAnnotations.StateFreeFormTool(this)
		});
		this.mode = this.Modes.AUTO;
		this.disabledInteraction = false;
		this.autoSelectionEnabled = VIEWER.hasOwnProperty("bridge");

		this._server = PLUGINS.each[this.id].server;
	}

	registerAnnotationFactory(AnnotationObjectFactoryClass, late=true) {
		let factory = new AnnotationObjectFactoryClass(this, this._automaticCreationStrategy, this.presets);
		if (this.objectFactories.hasOwnProperty(factory.type)) {
			throw `The factory ${AnnotationObjectFactoryClass} conflicts with another factory: ${factory.type}`;
		}
		this.objectFactories[factory.type] = factory;

		if (late) {
			this.presetManager().updatePresetsHTML();
		}
	}

	/*
	Initialize member variables
	*/
	pluginReady() {
		/* OSD values used by annotations */
		this.overlay = VIEWER.fabricjsOverlay({
			scale: VIEWER.tools.referencedTileSource().source.Image.Size.Width,
			fireRightClick: true
		});

		//this.overlay.fabric.__eventListeners = {};
		 const get = this.overlay.fabric.getActiveObject.bind(this.overlay.fabric);
		 let self = this;
		this.overlay.fabric.getActiveObject = function() {
			let e = get();
			console.log("GET", e, self.overlay.fabric._activeObject);
			return e;
		};
		const set = this.overlay.fabric.setActiveObject.bind(this.overlay.fabric);
		this.overlay.fabric.setActiveObject = function(e, t) {
			console.log("SET", e, t);
			return set(e, t);
		};

		const disc = this.overlay.fabric._discardActiveObject.bind(this.overlay.fabric);
		this.overlay.fabric._discardActiveObject = function(e, t) {
			console.log("DISCARD", e, self.overlay.fabric.__eventListeners);
			return disc(e, t);
		};

		//Register used annotation object factories
		OSDAnnotations.AnnotationObjectFactory.register(
			OSDAnnotations.Rect,
			OSDAnnotations.Ellipse,
			OSDAnnotations.Polygon
		);

		// Classes defined in other local JS files
		this.presets = new OSDAnnotations.PresetManager("presets", this);
		this.history = new OSDAnnotations.History("history", this, this.presets);
		this.modifyTool = new FreeFormTool("modifyTool", this);
		this._automaticCreationStrategy = new OSDAnnotations.AutoObjectCreationStrategy("_automaticCreationStrategy", this);

		// Annotation Objects
		this.objectFactories = {};
		OSDAnnotations.AnnotationObjectFactory.visitRegistered(function (AnnotationObjectFactoryClass) {
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

		const _this = this;

		//init on html sooner than history so it is placed above
		this.initHTML();

		//restore annotations if any
		// todo allow user to load his own annotations (probably to a separate layer)

		PLUGINS.addPostExport("annotation-list", _ => JSON.stringify(_this.getObjectContent()), this.id);
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
		PLUGINS.addPostExport("annotation_presets", this.presets.export.bind(this.presets), this.id);
		if (PLUGINS.postData.hasOwnProperty("annotation_presets")) {
			this.presets.import(PLUGINS.postData["annotation_presets"]);
		} else {
			this.presets.left = this.presets.addPreset();
			this.presets.updatePresetsHTML();
		}

		//after HTML added
		this.presets.updatePresetsHTML();
		this.setMouseOSDInteractive(true);

		this.setupTutorials();

		this.cursor.init();
		this.opacity = $("#annotations-opacity");

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
		//todo use osd EVENT INSTEAD?
		window.addEventListener("wheel", function (event) {
			_this.mode.scroll(event, event.deltaY / 100);
		});


		this.overlay.fabric.on('object:selected', function (e) {
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

		let annotationCanvas = this.overlay.fabric.upperCanvasEl;
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

		//These functions already pass pointer in image coordinates

		//Update object when user hodls ALT and moving with mouse (_this.isMouseOSDInteractive() == true)
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


		// TODO re-implement?
		// listen for annotation send button
		//$('#sendAnnotation').click(function (event) {
			//generate ASAPXML annotations
			// var doc = generate_ASAPxml(_this.overlay.fabric._objects);
			// var xml_text = new XMLSerializer().serializeToString(doc);
			//
			// // get file name from probabilities layer (axperiment:slide)
			// var probabs_url_array = VIEWER.tileSources[2].split("=")[1].split("/");
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
			// 		Dialogs.show('status: ' + status + ', data: ' + data.responseData, 8000, Dialogs.MSG_INFO);
			// 	});
		//});

		// listen for changes in opacity slider and change opacity for each annotation
		this.opacity.on("input", function () {
			//todo what about setting opacity globaly to the whole canvas?
			var opacity = $(this).val();
			_this.overlay.fabric.forEachObject(function (obj) {
				obj.opacity = opacity;
			});

			_this.overlay.fabric.renderAll();
		});

		this.loadAnnotationsList();

	} // end of initialize

	/****************************************************************************************************************

									HTML MANIPULATION

	*****************************************************************************************************************/

	initHTML() {
		let autoSelectionControls = this.autoSelectionEnabled ? this._automaticCreationStrategy.sensitivityControls() : "";
		autoSelectionControls += "<br>";

		USER_INTERFACE.MainMenu.append(
			"Annotations",
			`
<span class="material-icons pointer" onclick="USER_INTERFACE.Tutorials.show()" title="Help" style="float: right;">help</span>
<span class="material-icons pointer" title="Export annotations" style="float: right;" onclick="USER_INTERFACE.AdvancedMenu.openMenu('${this.id}');">cloud_upload</span>
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
			"annotations-panel",
			this.id
		);

		let modeOptions = [];
		for (let mode in this.Modes) {
			if (!this.Modes.hasOwnProperty(mode)) continue;
			mode = this.Modes[mode];
			let selected = mode.default() ? "checked" : "";
			modeOptions.push(`<input type="radio" id="${mode.getId()}-annotation-mode" class="d-none switch" ${selected} name="annotation-modes-selector">
<label for="${mode.getId()}-annotation-mode" class="label-annotation-mode" onclick="${this.id}.setModeById('${mode.getId()}');" title="${mode.getDescription()}"><span class="material-icons pointer p-1 rounded-2">${mode.getIcon()}</span></label>`);
		}
		//status bar & cursor

		PLUGINS.addHtml("annotation-cursor",
			`<div id="annotation-cursor" class="${this.id}-plugin-root" style="border: 2px solid black;border-radius: 50%;position: absolute;transform: translate(-50%, -50%);pointer-events: none;display:none;"></div>`,
			this.id);
		USER_INTERFACE.Tools.setMenu(this.id, "annotations-tool-bar", "Annotations",
			`<div class="px-2 py-1">${modeOptions.join("")}<span style="width: 1px; height: 28px; background: var(--color-text-tertiary); 
vertical-align: middle; opacity: 0.3;" class="d-inline-block mx-1"></span>&nbsp;<div id="mode-custom-items" 
class="d-inline-block">${this.mode.customHtml()}</div></div>`, 'draw');
	}

	setupTutorials() {
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
					"next #show-annotation-board": "Annotation board helps you with annotations management.<br>But you can use some features even on the canvas itself."
				},
				{
					"next #viewer-container": "A history cache will allow you to undo few last modifications.<br> Shortcut is Ctrl+Z (or use the board menu)."
				},
				{
					"next #viewer-container": "Use Ctrl+Shift+Z to revert (redo, or use the board menu button)."
				},
				{
					"next #viewer-container": "If you want to modify some object, click on the pencil icon within the board window.<br> The board will turn red to notify you navigation is disabled."
				}
			], pluginOpener
		);
	}

	/****************************************************************************************************************

									 EXPLICIT HANDLERS

	 *****************************************************************************************************************/



	/****************************************************************************************************************

									S E T T E R S, GETTERS

	*****************************************************************************************************************/

	getObjectContent() {
		return this.overlay.fabric.toObject(['comment', 'a_group', 'threshold', 'borderColor',
			'cornerColor', 'borderScaleFactor', 'color', 'presetID', 'hasControls']);
	}

	getFullExportData() {
		return{
			annotations: this.getObjectContent(),
			presets: this.presets.toObject(),
			metadata: {
				exported: new Date().toLocaleString()
				//todo other metadata?
			}
		};
	}

	getXMLDocumentContent() {
		// first, create xml dom
		let doc = document.implementation.createDocument("", "", null);
		let ASAP_annot = doc.createElement("ASAP_Annotations");
		let xml_annotations = doc.createElement("Annotations");
		ASAP_annot.appendChild(xml_annotations);
		doc.appendChild(ASAP_annot);

		// for each object (annotation) create new annotation element with coresponding coordinates
		let canvas_objects = this.overlay.fabric._objects;
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

	setMouseOSDInteractive(isOSDInteractive, changeCursor=true) {
		if (this.mouseOSDInteractive === isOSDInteractive) return;

		if (isOSDInteractive) {
			this.setOSDTracking(true);

			if (changeCursor) {
				this.overlay.fabric.defaultCursor = "crosshair";
				this.overlay.fabric.hoverCursor = "pointer";
			}

			//TODO also finish indirect if creation object changed to another object
			if (this.presets.left) this.presets.left.objectFactory.finishIndirect();
			if (this.presets.right) this.presets.right.objectFactory.finishIndirect();

			let active = this.overlay.fabric.getActiveObject();
			if (active) {
				active.hasControls = false; //todo remove?
			}

		} else {
			this.setOSDTracking(false);
			if (changeCursor) {
				this.overlay.fabric.defaultCursor = "auto";
				//this.overlay.fabric.hoverCursor = "move";
			}

			let active = this.overlay.fabric.getActiveObject();
			if (active) {
				active.hasControls = true; //todo remove?
			}
		}
		this.mouseOSDInteractive = isOSDInteractive;
	}

	isMouseOSDInteractive() {
		return this.mouseOSDInteractive;
	}

	getAnnotationObjectFactory(objectType) {
		if (this.objectFactories.hasOwnProperty(objectType))
			return this.objectFactories[objectType];
		return undefined;
	}

	setFabricCanvasInteractivity(boolean) {
		this.overlay.fabric.forEachObject(function (object) {
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
		this.overlay.fabric.loadFromJSON(annotations, onfinish);
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

	loadAnnotationsList() {
		if (!this.annotationsMenuBuilder) {
			USER_INTERFACE.AdvancedMenu.setMenu(this.id, "annotations-shared", "Share",
				`<div id="annotations-shared-head"></div><div id="available-annotations"></div>`);
			this.annotationsMenuBuilder = new UIComponents.Containers.RowPanel("available-annotations");
		}
		this.annotationsMenuBuilder.clear();

		//todo better approach
		this.activeTissue = APPLICATION_CONTEXT.setup.data[APPLICATION_CONTEXT.setup.background[0].dataReference];

		const _this = this;
		//todo if background images too many - populated...?  TODO custom link
		PLUGINS.fetchJSON(this._server + "?Annotation=list/" + this.activeTissue
		).then(json => {
			let count = 0;
			//_this.availableAnnotations = json;
			for (let available of json.annotations) {
				let actionPart = `
<button onclick="${this.id}.loadAnnotation('${available.id}');return false;" class="btn">Load</button>&nbsp;
<button onclick="${this.id}.updateAnnotation('${available.id}');return false;" class="btn">Update</button>&nbsp;
<button onclick="${this.id}.removeAnnotation('${available.id}');return false;" class="btn">Remove</button>`;
				_this.annotationsMenuBuilder.addRow({
					title: available.name,
					author: "Who uploaded?",
					details: "Todo have also some metadata available...",
					contentAction:actionPart
				});
				count++;
			}
			$("#annotations-shared-head").html(this.getAnnotationsHeadMenu());

			if (count < 1) {
				_this.annotationsMenuBuilder.addRow({
					title: "Here be dragons...",
					author: "",
					details: `No annotations are available for ${_this.activeTissue}. Start by uploading some.`,
					contentAction:""
				});
			}
		}).catch(e =>
			$("#annotations-shared-head").html(_this.getAnnotationsHeadMenu("Could not load annotations list."))
		);
	}

	getAnnotationsHeadMenu(error="") {
		error = error ? `<div class="error-container m-2">${error}</div>` : "";
		return `<h3 class="f2-light">Annotations</h3>&emsp;<span class="text-small">
for slide ${this.activeTissue}</span>
<button class="btn float-right" onclick="${this.id}.uploadAnnotation()">Create: upload current state</button>${error}
<br><br>
<button id="downloadAnnotation" onclick="${this.id}.exportToFile();return false;" class="btn">Download as a file.</button>&nbsp;
${this.presets.presetExportControls()}
<br><br><br><h4 class="f3-light header-sep">Available annotations</h4>
`;
	}

	loadAnnotation(id) {
		//todo code duplicity
		const _this = this;
		PLUGINS.fetchJSON(this._server + "?Annotation=load/" + id).then(json => {
			try {
				_this.loadFromJSON(json.annotations);
				_this.presets.import(json.presets);
				$("#annotations-shared-head").html(_this.getAnnotationsHeadMenu())
			} catch (e) {
				console.warn(e);
				Dialogs.show("Could not load annotations. Please, let us know about this issue and provide export file.", 20000, Dialogs.MSG_ERR);
			}
		}).catch(e =>
			Dialogs.show("Failed to download annotation.", 2000, Dialogs.MSG_ERR)
		);
	}

	updateAnnotation(id) {
		const _this = this;
		PLUGINS.fetchJSON(this._server, {
			protocol: 'Annotation',
			command: 'update',
			id: Number.parseInt(id),
			data: this.getFullExportData()
		}).then(json => {
			if (json.success) {
				Dialogs.show("Annotations uploaded.", 2000, Dialogs.MSG_INFO);
				_this.loadAnnotationsList();
			} else {
				Dialogs.show(`Failed to upload annotations. You can <a onclick="${this.id}.exportToFile()">Export them instead</a>, and upload later.`, 7000, Dialogs.MSG_ERR);
				console.error("Failed to upload annotations.", json);
			}
		}).catch(e => {
			Dialogs.show(`Failed to upload annotations. You can <a onclick="${this.id}.exportToFile()">Export them instead</a>, and upload later.`, 7000, Dialogs.MSG_ERR);
			console.error("Failed to upload annotations.", e);
		});
	}

	removeAnnotation(id) {
		const _this = this;
		PLUGINS.fetchJSON(this._server + "?Annotation=remove/" + id).then(json => {
			if (json.success) {
				Dialogs.show(`Annotation id '${id}' removed.`, 2000, Dialogs.MSG_INFO);
				_this.loadAnnotationsList();
			} else {
				Dialogs.show(`Failed to delete annotation id '${id}'.`, 7000, Dialogs.MSG_ERR);
				console.error("Failed to upload annotations.", json);
			}
		}).catch(e =>
			Dialogs.show("Failed to remove annotation.", 2000, Dialogs.MSG_ERR)
		);
	}

	uploadAnnotation() {
		const _this = this;
		PLUGINS.fetchJSON(this._server, {
			protocol: 'Annotation',
			command: 'save',
			name: "a" + Date.now(),
			tissuePath: this.activeTissue,
			data: this.getFullExportData()
		}).then(json => {
			if (json.success) {
				Dialogs.show("Annotations uploaded.", 2000, Dialogs.MSG_INFO);
				_this.loadAnnotationsList();
			} else {
				Dialogs.show(`Failed to upload annotations. You can <a onclick="${this.id}.exportToFile()">Export them instead</a>, and upload later.`, 7000, Dialogs.MSG_ERR);
				console.error("Failed to upload annotations.", json);
			}
		}).catch(e => {
			Dialogs.show(`Failed to upload annotations. You can <a onclick="${this.id}.exportToFile()">Export them instead</a>, and upload later.`, 7000, Dialogs.MSG_ERR);
			console.error("Failed to upload annotations.", e);
		});
	}

	addHelperAnnotation(annotation) {
		this.overlay.fabric.add(annotation);
	}

	deleteHelperAnnotation(annotation) {
		this.overlay.fabric.remove(annotation);
	}

	promoteHelperAnnotation(annotation) {
		this.history.push(annotation);
		this.overlay.fabric.setActiveObject(annotation);
		//todo no need to render here - but level up in (some) function call?
		this.overlay.fabric.renderAll();
	}

	addAnnotation(annotation) {
		this.addHelperAnnotation(annotation);
		this.promoteHelperAnnotation(annotation);
	}

	replaceAnnotation(previous, next, updateHistory=false) {
		this.overlay.fabric.remove(previous);
		this.overlay.fabric.add(next);
		if (updateHistory) this.history.push(next, previous);
		this.overlay.fabric.renderAll();
    }

	deleteAnnotation(annotation) {
		this.overlay.fabric.remove(annotation);
		this.history.push(null, annotation);
		this.overlay.fabric.renderAll();
	}

	clearAnnotationSelection() {
		this.overlay.fabric.selection = false;
	}

	get canvas() {
		return this.overlay.fabric;
	}

	canvasObjects() {
		return this.overlay.fabric.getObjects();
	}

	deselectFabricObjects() {
		this.overlay.fabric.deactivateAll().renderAll();
	}

	removeActiveObject() {
		let toRemove = this.overlay.fabric.getActiveObject();
		if (toRemove) {
			this.overlay.fabric.remove(toRemove);
			//presetID is set to objects that are fully functional annotations
			//incrementId is set to objects by History
			if (toRemove.hasOwnProperty("presetID") && toRemove.hasOwnProperty("incrementId")) {
				this.history.push(null, toRemove);
			}
			this.overlay.fabric.renderAll();
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

		let objects = this.overlay.fabric.getObjects();
		/* if objects is null, catch */
		if (objects.length === 0 || !confirm("Do you really want to delete all annotations?")) return;

		let objectsLength = objects.length;
		for (let i = 0; i < objectsLength; i++) {
			this.history.push(null, objects[objectsLength - i - 1]);
			objects[objectsLength - i - 1].remove();
		}
	}

	enableAnnotations(on) {
		let objects = this.overlay.fabric.getObjects();
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
				this.overlay.fabric.setActiveObject(this.cachedTargetCanvasSelection);
			}
		} else {
			this.cachedTargetCanvasSelection = this.overlay.fabric.getActiveObject();
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
			this.overlay.fabric.deactivateAll();
		}
		this.overlay.fabric.renderAll();
	}

	enableInteraction(on) {
		this.disabledInteraction = !on;
		if (on) {
			$("#annotation-status-bar-foreground").addClass('disabled');
		} else {
			$("#annotation-status-bar-foreground").removeClass('disabled');
		}
		this.history._setControlsVisuallyEnabled(on);
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
		let result = undefined;
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
		$("#mode-custom-items").html(mode.customHtml());

		mode.setFromAuto();
		this.mode = mode;
		$(`#${mode.getId()}-annotation-mode`).prop('checked', true);
	}

	_setModeToAuto() {
		if (this.presets.left) this.presets.left.objectFactory.finishIndirect();
		if (this.presets.right) this.presets.right.objectFactory.finishIndirect();

		//must be early due to custom HTML controls that might be used later
		$("#mode-custom-items").html(this.Modes.AUTO.customHtml());

		this.mode.setToAuto();
		this.mode = this.Modes.AUTO;
		$(`#${this.mode.getId()}-annotation-mode`).prop('checked', true);
	}

	/**
	 * Cursor object
	 * TODO generalize
	 */
	cursor = {
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
}; // end of main namespace

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
		//todo autoSelectionEnabled not present
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
		console.log(currentObject);
		if (!currentObject && this.context.modifyTool._cachedSelection) {
			currentObject = this.context.modifyTool._cachedSelection;
			this.context.modifyTool._cachedSelection = null;
		}

		if (!currentObject) {
			//subtract needs active object
			if (!this.context.modifyTool.modeAdd) {
				this.abortClick();
				return;
			}
			currentObject = this._initPlain(point, isLeftClick);
			created = true;
		} else {
			let bounds = currentObject.getBoundingRect();
			let w = bounds.left + bounds.width,
				h = bounds.top + bounds.height;
			if (o.y < bounds.top || o.y > h || o.x < bounds.left || o.x > w) {
				//subtract needs active object
				if (!this.context.modifyTool.modeAdd) {
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
		if (result) this.context.canvas.setActiveObject(result);
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
		this.context.modifyTool._cachedSelection = this.context.canvas.getActiveObject();
		this.context.setOSDTracking(false);
		this.context.canvas.hoverCursor = "crosshair";
		this.context.modifyTool.setModeAdd(true);
		this.context.modifyTool.updateRadius();
		this.context.cursor.show();
	}

	setToAuto() {
		this.context.canvas.hoverCursor = "pointer";
		this.context.cursor.hide();
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

/*------------ Initialization of OSD Annotations ------------*/
PLUGINS.register("openseadragon_image_annotations", OSDAnnotations);
