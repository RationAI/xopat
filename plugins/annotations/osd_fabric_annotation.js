sleep = function (ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
};

OSDAnnotations = function (incoming) {
	this.id = "openseadragon_image_annotations";
	PLUGINS.each[this.id].instance = this;

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
		AUTO: 0,
		CUSTOM: 1,
		FREE_FORM_TOOL: 3,
	});
	this.mode = this.Modes.AUTO;

	//Register used annotation object factories
	AnnotationObjectFactory.register(Rect, Ellipse, Polygon);
};

OSDAnnotations.prototype = {

	/*
	Initialize member variables
	*/
	initialize: function (options) {

		// Classes defined in other local JS files
		this.presets = new PresetManager("presets", this);
		this.history = new History("history", this, this.presets);
		this.modifyTool = new FreeFormTool(this);
		this._automaticCreationStrategy = new AutoObjectCreationStrategy("_automaticCreationStrategy", this);

		// Annotation Objects
		this.objectFactories = {};
		AnnotationObjectFactory.visitRegistered(function (AnnotationObjectFactoryClass) {
			let factory = new AnnotationObjectFactoryClass(this, this._automaticCreationStrategy, this.presets);
			this.objectFactories[factory.type] = factory;
		}.bind(this));

		if (this.objectFactories.hasOwnProperty("polygon")) {
			//create tool-shaped object
			this.polygonFactory = this.objectFactories["polygon"];
		} else {
			console.error("No polygon object factory registered. Annotations must contain at " +
				"least a polygon implementation in order to work. Did you maybe named the polygon factory " +
				"implementation differently other than 'polygon'?", "See list of factories available.",
				this.objectFactories);
			return;
		}


		/* OSD values used by annotations */
		this.overlay = PLUGINS.osd.fabricjsOverlay(options);

		// draw annotation from json file
		//todo try catch error MSG if fail
		// todo allow user to load his own annotations (probably to a separate layer)
		PLUGINS.addPostExport("annotations", this.getJSONContent.bind(this));
		let imageJson = PLUGINS.postData.annotations;
		if (imageJson) {
			this.overlay.fabricCanvas().loadFromJSON(imageJson, this.overlay.fabricCanvas().renderAll.bind(this.overlay.fabricCanvas()));
		}

		//restore presents if any
		PLUGINS.addPostExport("annotation_presets", this.presets.export.bind(this.presets));
		let presets = PLUGINS.postData.annotation_presets;
		this.presets.import(presets);

		this.initHTML();
		//init history after my own HTML to occur below
		this.history.init(50);
		//cache nodes after HTML added
		this._modesJqNode = $("#annotation-mode");
		this.presets.updatePresetsHTML();
		this.setMouseOSDInteractive(true);

		this.setupTutorials();

		this.cursor.init();
		this.opacity = $("#annotations-opacity");
		this.toolRadius = $("#fft-size");

		//Window switch alt+tab makes the mode stuck
		window.addEventListener("focus", function(event) 
		  { 
			openseadragon_image_annotations.setMode(openseadragon_image_annotations.Modes.AUTO);

		  }, false);

		/****************************************************************************************************************
	
									Annotations MODES implementation
	
		*****************************************************************************************************************/

		function initCreateAutoAnnotation(pointer, event, isLeftClick, updater) {
			//if clicked on object, highlight it
			let active = openseadragon_image_annotations.overlay.fabricCanvas().findTarget(event);
			if (active) {
				openseadragon_image_annotations.overlay.fabricCanvas().setActiveObject(active);
				openseadragon_image_annotations.cursor.mouseTime = 0;
			}
		}

		function finishCreateAutoAnnotation(point, event, isLeftClick, updater) {
			let delta = Date.now() - openseadragon_image_annotations.cursor.mouseTime;
			if (delta > 100 || !updater) return; // just navigate if click longer than 100ms
			updater.instantCreate(point, isLeftClick);
		}
		
		function initCreateCustomAnnotation(point, event, isLeftClick, updater) {
			if (!updater) return;
			let pointer = openseadragon_image_annotations.toGlobalPointXY(point.x, point.y);
			updater.initCreate(pointer.x, pointer.y, isLeftClick);
		}

		function finishCreateCustomAnnotation(point, event, isLeftClick, updater) {
			if (!updater) return;
			let _this = openseadragon_image_annotations;
			let delta = Date.now() - _this.cursor.mouseTime;

			// if click too short, user probably did not want to create such object, discard
			if (delta < 100) { 
				if (!updater.isValidShortCreationClick()) {
					_this.overlay.fabricCanvas().remove(updater.getCurrentObject());
					return;
				}
			}
			updater.finishDirect();
		}

		function initFreeFormTool(point, event, isLeftClick) {
			let _this = openseadragon_image_annotations;
			let currentObject = _this.overlay.fabricCanvas().getActiveObject();

			let pointer = _this.toGlobalPointXY(point.x, point.y);
			if (!currentObject) {
				if (_this.modifyTool._cachedSelection) {
					console.log("READ cache");
					//cached selection from shift press event, because sometimes the click event deselected active object
					currentObject = _this.modifyTool._cachedSelection;
					_this.modifyTool._cachedSelection = null;
				} else {
					currentObject = _this.polygonFactory.create(
						_this.modifyTool.getCircleShape(pointer), _this.presets.getAnnotationOptions(isLeftClick)
					);
					_this.addAnnotation(currentObject);
				}
			}

			_this.modifyTool.init(currentObject, point, isLeftClick);
			_this.modifyTool.update(pointer);
		}

		function finishFreeFormTool(point, event, isLeftClick) {
			let _this = openseadragon_image_annotations;
			let result = _this.modifyTool.finish();
			if (result) _this.overlay.fabricCanvas().setActiveObject(result);
		}

		//TODO state pattern!!!
		function handleRightClickUp(o, point) {
			let _this = openseadragon_image_annotations;
			//no preset valid for free form tool... TODO move condition inside switch? 
			if (!_this.cursor.isDown || (!_this.presets.right && _this.mode !== _this.Modes.FREE_FORM_TOOL)) return;
			switch (_this.mode) {
				case _this.Modes.AUTO:
					finishCreateAutoAnnotation(point, o, false, _this.presets.right.objectFactory);
					break;
				case _this.Modes.CUSTOM:
					finishCreateCustomAnnotation(point, o, false, _this.presets.right.objectFactory);
					break;
				case _this.Modes.FREE_FORM_TOOL:
					finishFreeFormTool(point, o, false);
					break;
				default: 
					console.error("Invalid action!");
					return;
			}
			_this.cursor.isDown = false;
		}

		function handleLeftClickUp(o, point) {
			// if (openseadragon_image_annotations.isMouseOSDInteractive()) {
			// 	handleFabricKeyUpInOSDMode(o);
			// } else {
			// 	handleFabricKeyUpInEditMode(o);
			// }
			let _this = openseadragon_image_annotations;
			if (!_this.cursor.isDown || !_this.presets.left) return;
			switch (_this.mode) {
				case _this.Modes.AUTO:
					finishCreateAutoAnnotation(point, o, true, _this.presets.left.objectFactory);
					break;
				case _this.Modes.CUSTOM:
					finishCreateCustomAnnotation(point, o, true, _this.presets.left.objectFactory);
					break;
				case _this.Modes.FREE_FORM_TOOL:
					finishFreeFormTool(point, o, true);
					break;
				default: 
					console.error("Invalid action!");
					return;
			}
			_this.cursor.isDown = false;
		}

		function handleRightClickDown(o, point) {
			let _this = openseadragon_image_annotations;

			//no preset valid for free form tool... TODO move condition inside switch?
			if (_this.cursor.isDown || (!_this.presets.right && _this.mode !== _this.Modes.FREE_FORM_TOOL)) return;
			_this.cursor.mouseTime = Date.now();
			_this.cursor.isDown = true;
			switch (_this.mode) {
				case _this.Modes.AUTO:
					initCreateAutoAnnotation(point, o, false, _this.presets.right.objectFactory);
					break;
				case _this.Modes.CUSTOM:
					initCreateCustomAnnotation(point, o, false, _this.presets.right.objectFactory);
					break;
				case _this.Modes.FREE_FORM_TOOL:
					initFreeFormTool(point, o, false);
					break;
				default: 
					console.error("Invalid action!");
					return;
			}
		}

		function handleLeftClickDown(o, point) {
			// if (openseadragon_image_annotations.isMouseOSDInteractive()) {
			// 	handleFabricKeyDownInOSDMode(o, true);
			// } else {
			// 	handleFabricKeyDownInEditMode(o);
			// }

			let _this = openseadragon_image_annotations;
			if (_this.cursor.isDown || !_this.presets.left) return;
			_this.cursor.mouseTime = Date.now();
			_this.cursor.isDown = true;
			switch (_this.mode) {
				case _this.Modes.AUTO:
					initCreateAutoAnnotation(point, o, true, _this.presets.left.objectFactory);
					break;
				case _this.Modes.CUSTOM:
					initCreateCustomAnnotation(point, o, true, _this.presets.left.objectFactory);
					break;
				case _this.Modes.FREE_FORM_TOOL:
					initFreeFormTool(point, o, true);
					break;
				default: 
					console.error("Invalid action!");
					return;
			}
		}

		/****************************************************************************************************************
	
												 E V E N T  L I S T E N E R S: FABRIC
	
		*****************************************************************************************************************/


		$('.upper-canvas').mousedown(function (event) {
			if (!openseadragon_image_annotations.showAnnotations) return;

			if (event.which === 1) handleLeftClickDown(event, {x: event.pageX, y: event.pageY});
			else if (event.which === 3) handleRightClickDown(event, {x: event.pageX, y: event.pageY});
		});

		$('.upper-canvas').mouseup(function (event) {
			if (!openseadragon_image_annotations.showAnnotations) return;

			if (event.which === 1) handleLeftClickUp(event, {x: event.pageX, y: event.pageY});
			else if (event.which === 3) handleRightClickUp(event, {x: event.pageX, y: event.pageY});
		});

	
		/*
			Update object when user hodls ALT and moving with mouse (openseadragon_image_annotations.isMouseOSDInteractive() == true)
		*/
		this.overlay.fabricCanvas().on('mouse:move', function (o) {
			let _this = openseadragon_image_annotations;
			if (!_this.showAnnotations || !_this.cursor.isDown) return;

			var pointer = _this.overlay.fabricCanvas().getPointer(o.e);

			if (_this.mode === _this.Modes.CUSTOM) {
				if (_this.isMouseOSDInteractive()) {
					if (_this.presets.left) _this.presets.left.objectFactory.updateCreate(pointer.x, pointer.y);
					if (_this.presets.right) _this.presets.right.objectFactory.updateCreate(pointer.x, pointer.y);

					_this.overlay.fabricCanvas().renderAll();
				}
			} else if (_this.mode === _this.Modes.FREE_FORM_TOOL) {
				_this.modifyTool.update(pointer);
			} 
		});


		this.overlay.fabricCanvas().on('object:selected', function (e) {
			if (e && e.target) {
				//todo remove?
				//e.target.set('shadow', { blur: 30, offsetX: 0, offsetY: 0});
				openseadragon_image_annotations.history.highlight(e.target);
				e.target.hasControls = !openseadragon_image_annotations.isMouseOSDInteractive();
			}
		});

		/****************************************************************************************************************

											 E V E N T  L I S T E N E R S: OSD (clicks without alt or shift)
			Since event listeners on fabricJS are disabled when using OSD interactive mode (and vice versa), 
			we register both listeners for OSD and fabricjs

		*****************************************************************************************************************/

		PLUGINS.osd.addHandler("canvas-press", function (e) {
			if (!openseadragon_image_annotations.showAnnotations) return;
			//todo not unified e.position (here in screen cords, fabric uses image coords)
			handleLeftClickDown(e.originalEvent, e.position);
		});

		PLUGINS.osd.addHandler("canvas-release", function (e) {
			if (!openseadragon_image_annotations.showAnnotations) return;
			handleLeftClickUp(e.originalEvent, e.position);
		});

		PLUGINS.osd.addHandler("canvas-nonprimary-press", function (e) {
			if (!openseadragon_image_annotations.showAnnotations) return;
			handleRightClickDown(e.originalEvent, e.position);
		});

		PLUGINS.osd.addHandler("canvas-nonprimary-release", function (e) {
			if (!openseadragon_image_annotations.showAnnotations) return;
			handleRightClickUp(e.originalEvent, e.position);
		});

		$(PLUGINS.osd.element).on('contextmenu', function (event) {
			event.preventDefault();
		});
	
		/****************************************************************************************************************

											 E V E N T  L I S T E N E R S: GENERAL

		*****************************************************************************************************************/

		document.addEventListener('keydown', (e) => {
			let _this = openseadragon_image_annotations;

			// switching mode only when no mode AUTO and mouse is up
			if (!_this.showAnnotations || _this.cursor.isDown) return;
			
			if (e.code === "AltLeft") {
				_this.setMode(_this.Modes.CUSTOM);
				e.preventDefault();
			} else if (e.code === "ShiftLeft") {
				_this.setMode(_this.Modes.FREE_FORM_TOOL);
				e.preventDefault();
			} 
		});

		document.addEventListener('keyup', (e) => {
			let _this = openseadragon_image_annotations;
			if (!_this.showAnnotations) return;

			if (e.code === "Delete") {
				_this.removeActiveObject();
				return;
			}

			if (e.ctrlKey && e.code === "KeyY") {
				if (e.shiftKey) _this.history.redo();
				else _this.history.back();
				return;
			}

			if ((e.code === "AltLeft" && _this.mode === _this.Modes.CUSTOM) 
				|| (e.code === "ShiftLeft" && _this.mode === _this.Modes.FREE_FORM_TOOL)) {

				_this.setMode(this.Modes.AUTO);	
				e.preventDefault();		
			}	
		});


		// listen for annotation send button
		$('#sendAnnotation').click(function (event) {
			//generate ASAPXML annotations
			var doc = generate_ASAPxml(openseadragon_image_annotations.overlay.fabricCanvas()._objects);
			var xml_text = new XMLSerializer().serializeToString(doc);

			// get file name from probabilities layer (axperiment:slide)
			var probabs_url_array = PLUGINS.osd.tileSources[2].split("=")[1].split("/");
			var slide = probabs_url_array.pop().split(".")[0].slice(0, -4);
			var experiment = probabs_url_array.pop();
			var file_name = [experiment, slide].join(":");

			//prepare data to be send, (file_name and xml with annotations)
			var send_data = { "name": file_name, "xml": xml_text };

			$.ajaxSetup({
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json'
				}
			});
			//send data to url
			$.post('http://ip-78-128-251-178.flt.cloud.muni.cz:5050/occlusion',  // url
				JSON.stringify(send_data), // data to be submit
				function (data, status, xhr) {   // success callback function
					PLUGINS.dialog.show('status: ' + status + ', data: ' + data.responseData, 8000, PLUGINS.dialog.MSG_INFO);
				});
		});


		//todo decide what format to use, discard the other one
		// download annotation as default json file and generated ASAP xml file
		$('#downloadAnnotation').click(function (event) {
			function download(id, content) {
				let data = new Blob([content], { type: 'text/plain' });
				document.getElementById(id).href = window.URL.createObjectURL(data);
				document.getElementById(id).click();
			}
			//TODO add other attributes for export to preserve funkcionality (border width, etc)
			download(openseadragon_image_annotations.getJSONContent());
			//asap xml
			download(openseadragon_image_annotations.getXMLStringContent());
		});


		// listen for changes in opacity slider and change opacity for each annotation
		this.opacity.on("input", function () {
			//todo what about setting opacity globaly to the whole canvas?
			var opacity = $(this).val();
			openseadragon_image_annotations.overlay.fabricCanvas().forEachObject(function (obj) {
				obj.opacity = opacity;
			});

			openseadragon_image_annotations.overlay.fabricCanvas().renderAll();
		});

		// TODO delete?    update annotation group (from input form)
		$("#annotation_group").on("change", function () {
			var annotation = openseadragon_image_annotations.overlay.fabricCanvas().getActiveObject();
			annotation.set({ a_group: $(this).val() });
		});

		// TODO delete?   update annotation comment (from input form)
		$("#annotation_comment").on("input", function () {
			var annotation = openseadragon_image_annotations.overlay.fabricCanvas().getActiveObject();
			if (annotation) {
				annotation.set({ comment: $(this).val() })
			}
			openseadragon_image_annotations.history._updateBoardText(annotation, annotation.comment);
		});

		// delete all annotations
		$('#deleteAll').click(function () {
			Object.values(openseadragon_image_annotations.objectFactories).forEach(value => value.finishIndirect());
			openseadragon_image_annotations.deleteAllAnnotations();
		});
	}, // end of initialize

	/****************************************************************************************************************

									HTML MANIPULATION

	*****************************************************************************************************************/


	initHTML: function() {
		PLUGINS.appendToMainMenuExtended("Annotations", `
		<span class="material-icons" onclick="openseadragon_image_annotations.showHelp();" title="Help" style="cursor: pointer;float: right;">help</span>
		<span class="material-icons" id="downloadAnnotation" title="Export annotations" style="cursor: pointer;float: right;">download</span>
		<!-- <button type="button" class="btn btn-secondary" autocomplete="off" id="sendAnnotation">Send</button> -->
		
		<span class="material-icons" id="enable-disable-annotations" title="Enable/disable annotations" style="cursor: pointer;float: right;" data-ref="on" onclick="
		if ($(this).attr('data-ref') === 'on'){
			openseadragon_image_annotations.turnAnnotationsOnOff(false);
			$(this).html('visibility_off');
			$(this).attr('data-ref', 'off');
		} else {
			openseadragon_image_annotations.turnAnnotationsOnOff(true);
			$(this).html('visibility');
			$(this).attr('data-ref', 'on');
		}"> visibility</span>`,
		`<span>Opacity: &emsp;</span><input type="range" id="annotations-opacity" min="0" max="1" value="0.4" step="0.1"><br><br>
		${this.presets.presetControls()}		
		<a id="download_link1" download="my_exported_file.json" href="" hidden>Download as json File</a>
		<a id="download_link2" download="my_exported_file.xml" href="" hidden>Download as xml File</a>`, 
		`<div id="imageAnnotationToolbarContent">
					<br>
					${this.presets.presetHiddenControls()}
					<br>
					${this._automaticCreationStrategy.sensitivityControls()}
					<br>
					${this.modifyTool.brushSizeControls()}				
					</div>`, 
					"annotations-panel");

		//form for object property modification
		$("body").append(`<div id="annotation-cursor" style="border: 2px solid black;border-radius: 50%;position: absolute;transform: translate(-50%, -50%);pointer-events: none;display:none;"></div>
		<select id="annotation-mode" class="form-control position-fixed top-2 left-2" onchange="openseadragon_image_annotations.setMode($(this).val(), true);return false;">
		<option value="${this.Modes.AUTO}" selected>automatic shape & navigation</option>
		<option value="${this.Modes.CUSTOM}">🖌 custom shape (⌨ Left Alt)</option>
		<option value="${this.Modes.FREE_FORM_TOOL}">&#9733; free form tool (⌨ Left Shift)</option>
		</select>`);		
	},

	showHelp: function() {
		$("body").append(`
		<div class="position-fixed" style="z-index:99999; left: 50%;top: 50%;transform: translate(-50%,-50%);">
		<details-dialog class="Box Box--overlay d-flex flex-column anim-fade-in fast" style=" max-width:80vw; max-height: 80vh;">
			<div class="Box-header">
			  <button class="Box-btn-octicon btn-octicon float-right" type="button" aria-label="Close help" onclick="$(this).parent().parent().parent().remove();">
				<svg class="octicon octicon-x" viewBox="0 0 12 16" version="1.1" width="12" height="16" aria-hidden="true"><path fill-rule="evenodd" d="M7.48 8l3.75 3.75-1.48 1.48L6 9.48l-3.75 3.75-1.48-1.48L4.52 8 .77 4.25l1.48-1.48L6 6.52l3.75-3.75 1.48 1.48L7.48 8z"></path></svg>
			  </button>
			  <h3 class="Box-title">Annotations help</h3>
			</div>
			<div class="overflow-auto">
			  <div class="Box-body overflow-auto">
			  
			  <div class="flash mt-3 flash-error">
			  <span class="octicon octicon-flame material-icons" viewBox="0 0 16 16" width="16" height="16"> error</span>
			  Annotations work only for the original visualisations, edge-based visualisations do not support automatic selection (yet).
			</div>
			<br>
			
			  <h4 class="mt-2"><span class="material-icons">brush</span>Brushes</h3>
			  <p>You can choose from  <span class="material-icons">crop_5_4</span>rectangle, <span class="material-icons">panorama_fish_eye</span>ellipse or <span class="material-icons">share</span>polygon. </p>
			  
			  <h4><span class="material-icons"> settings_overscan</span>Click to annotate</h3>
			  <p>You can create annotations with both left and right mouse button. Each button has default color and comment you can customize.
			  When you click on the canvas, a default object depending on a brush is created: if it is inside a visualised region, it will try to fit the underlying shape. Polygon will fail 
			  outside vis regions, other tools create default-sized object.</p>
			  <p><b>Automatic shape treshold</b> is the sensitivity of automatic selection: when minimized, the shape will take all surrounding areas. When set high, only the most prominent areas
			  will be included.</p>
		
			  <div class="flash mt-3 flash-error">
			  <span class="octicon octicon-flame material-icons" viewBox="0 0 16 16" width="16" height="16"> error</span>
			  Avoid auto-appending of large areas (mainly large probability tile chunks), the algorithm is still not optimized and the vizualiation would freeze. In that case, close the tab and reopen a new one.
			</div>
			  <br>
			  <h4 class="mt-2"><span class="material-icons">highlight_alt</span>Alt+Drag, Alt+Click</h4>
				<p>With left alt on a keyboard, you can create custom shapes. Simply hold the left alt key and drag for rectangle/ellipse, or click-place points of a polygon. Once you release alt,
				the polygon will be created. With other shapes, to finish the drag is enough.</p>
			  <h4 class="mt-2"><span class="material-icons">flip_to_front </span>Shift + Click</h4>
				<p>You can use left mouse button to append regions to a selected object. With right button, you can <b>remove</b> areas from any annotaion object.</p>
			  <h4 class="mt-2"><span class="material-icons">assignment</span>Annotation board</h4>
				<p>You can browse exiting annotation objects there. You can edit a comment by <span class="material-icons">edit</span> modifying the label (do not forget to save <span class="material-icons">save</span>).
					Also, selecting an object will send you to its location and highlight it so that you can orient easily in existing annotaions. </p>
			  <h4 class="mt-2"><span class="material-icons"> delete</span>Del to delete</h4>
				<p>Highlighted object will be deleted, when you hit 'delete' key. This works handily with annotation board - click and delete to remove any object.</p>
			  <h4 class="mt-2"><span class="material-icons"> history</span>History</h4>
				<p>You can use Ctrl+Z to revert any changes made on object that affect its shape. This does not include manual resizing or movement of rectangles or ellipses. 
				You can use Ctrl+Shift+Z to redo the history (note: if you hit the bottom, you can redo history except the last item. In other words, if you undo 'n' operations, you can redo 'n-1').</p>
			  <h4 class="mt-2"><span class="material-icons"> tune</span>Advanced modifications</h4>
				<p>By holding the right alt key, you can manually adjust shapes - move them around, resize them or modify polygon vertices. <b style="color: chocolate;">This mode might be very buggy.</b></p>
			  </div>
			</div>
		  </details-dialog>
		  </div>
		`);
	},

	setupTutorials: function() {
		PLUGINS.addTutorial(
			"Annotations Plugin", "learn to use annotations (note: the tutorial is not well tested and will be split to multiple smaller ones later)", "draw", [ 
			{
				"next #annotations-panel": "Annotations allow you to annotate <br>the canvas parts and export and share all of it."
			}, {
				"next #annotation-board": "Annotation board is the second panel part of this plugin: <br>useful for existing objects management."
			},{
				"click #annotations-panel-pin": "Click on the pin to keep visible all controls."
			},{
				"next #enable-disable-annotations": "This icon can temporarily disable <br>all annotations - not just hide, but disable also <br>all plugin controls and hotkeys."
			},{
				"next #downloadAnnotation": "Here you can download <b>just</b> your annotations.<br>This is included automatically when using global `Export` option."
			},{
				"next #annotations-left-click": "Each of your mouse buttons<br>can be used to create annotations.<br>Simply assign some pre-set and start annotating!"
			},{
				"click #annotations-right-click": "Click here to specify an annotation<br>for your right mouse button."
			},{
				"next #preset-no-0": "This is an example of an annotation preset."
			},{
				"click #preset-add-new": "We want to keep the old preset,<br>so create a new one. Click on 'New'."
			},{
				"click #preset-no-1": "Click anywhere on the preset. This will select it for the right mouse button."
			},{
				"next #preset-no-1": "Adjust the new annotation preset:<br>choose a <b>polygon</b> as type,<br>and set any color and comment you like."
			},{
				"click #select-annotation-preset": "Click <b>Select</b> to assign it to the right mouse button."
			},{
				"next #viewer-container": "You can now use right mouse button<br>to create a polygons,<br>or the left button for different preset - at once!"
			},{
				"next #viewer-container": "Try now to right-click somewhere on a canvas:<br>either you click on a data that will be<br>automatically outlined, or outside:<br>the visualisation will tell you so.<br>By simple click on a canvas, you can create automatically annotations.<br>But dragging will let you navigate."
			},{
				"next #sensitivity_auto_outline": "The automated annotation creation is controlled by this slider.<br>Increase the slider value to choose more opaque areas only - and vice versa."
			},{
				"next #annotation-mode": "Apart from the default, navigation mode, you can switch to different annotation modes here."
			},{
				"next #viewer-container": "Select 'custom shape' mode to drag-create annotations (or click for points adding in case of polygon).<br> You can do the selection temporarily by holding <br>Left Alt</b> key.<br> Note: polygon will be created from its custom points<br>only after you switch to a different mode.<br> Releasing left Alt will thus finish the polygon creation easily."
			},{
				"next #viewer-container": "Select 'free form tool' mode to adjust annotations.<br> You can do the selection temporarily by holding <br>Left Shift</b> key."
			},{
				"next #viewer-container": "While holding a left shift key, you can draw custom shapes,<br>or adjust existing annotations. Select any and use left mouse button to add mass,<br>right mouse button to remove mass from it.<br>Do these modifications on an edge of the selected annotation. Try it all now."
			},{
				"next #fft-size": "You can control the size of the free-form tool here."
			},{
				"next #annotation-board": "The board should now also contain new object(s).<br>You can edit the comment or click to focus the annotation easily."
			},{
				"click #history-undo": "A history cache will allow you to undo few last modifications.<br>Click here to undo the last step."
			},{
				"click #history-redo": "Click on 'redo' to return the last change.<br><b>Caveat</b>: redo history is erased on manual history change."
			},{
				"next #history-refresh": "Refreshing the board might come useful in case<br>some unexpected error caused the board miss an annotation."
			},{
				"next #history-sync": "You can update all objects to reflect the most recent changes on presets. <br><b>Caveat</b>: this will undo any custom modifications made to annotations (comment/color)."
			},{
				"next #annotation-board": "Hotkeys: 'undo' can be performed by Ctrl+Z, 'redo' by Ctrl+Shift+Z.<br>'Delete' key will remove highlighted annotation<br>-simply click on the board on an annotation and hit 'delete' key."
			}]
		);
	},

	/****************************************************************************************************************

									S E T T E R S, GETTERS

	*****************************************************************************************************************/

	getJSONContent: function () {
		//todo include preset ID ?
		return JSON.stringify(this.overlay.fabricCanvas().toObject(['comment', 'a_group', 'threshold', 'borderColor', 'cornerColor', 'borderScaleFactor']));
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
			let factory = openseadragon_image_annotations.getAnnotationObjectFactory(obj.type);
			if (factory) {
				xml_annotation.setAttribute("Type", "Rectangle");
				coordinates = factory.toPointArray(obj, AnnotationObjectFactory.withArrayPoint);
			}

			//todo a_group not defined
			//todo include preset ID?
			xml_annotation.setAttribute("PartOfGroup", obj.a_group);
			xml_annotation.setAttribute("Color", obj.fill);

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

	setMouseOSDInteractive: function (isOSDInteractive) {
		if (this.mouseOSDInteractive === isOSDInteractive) return;

		if (isOSDInteractive) {
			//this.setFabricCanvasInteractivity(true);
			//this.deselectFabricObjects();
			PLUGINS.osd.setMouseNavEnabled(true);
			//$("#input_form").hide();
			this.overlay.fabricCanvas().defaultCursor = "crosshair";
			this.overlay.fabricCanvas().hoverCursor = "pointer";

			//TODO also finish indirect if creation object changed to another object
			if (this.presets.left) this.presets.left.objectFactory.finishIndirect();
			if (this.presets.right) this.presets.right.objectFactory.finishIndirect();

			let active = this.overlay.fabricCanvas().getActiveObject();
			if (active) {
				active.hasControls = false; //todo remove?
			}

		} else {
			//this.setFabricCanvasInteractivity(true);
			PLUGINS.osd.setMouseNavEnabled(false);
			this.overlay.fabricCanvas().defaultCursor = "auto";
			//this.overlay.fabricCanvas().hoverCursor = "move";

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
		let objects = openseadragon_image_annotations.overlay.fabricCanvas().getObjects();
		/* if objects is null, catch */
		if (objects.length === 0 || !confirm("Do you really want to delete all annotations?")) return;

		let objectsLength = objects.length
		for (let i = 0; i < objectsLength; i++) {
			this.history.push(null, objects[objectsLength - i - 1]);
			objects[objectsLength - i - 1].remove();
		}
	},

	turnAnnotationsOnOff: function (on) {
		let objects = this.overlay.fabricCanvas().getObjects();
		if (on) {
			this.showAnnotations = true;
			//set all objects as visible and unlock
			for (let i = 0; i < objects.length; i++) {
				objects[i].visible = true;
				objects[i].lockMovementX = false;
				objects[i].lockMovementY = false;
				objects[i].lockRotation = false;
				objects[i].lockScalingFlip = false;
				objects[i].lockScalingX = false;
				objects[i].lockScalingY = false;
				objects[i].lockSkewingX = false;
				objects[i].lockSkewingY = false;
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
			this.overlay.fabricCanvas().deactivateAll().renderAll();
			//$("#input_form").hide();
		}
		this.overlay.fabricCanvas().renderAll();
	},

	//todo remove?
	toGlobalPointXY: function(x, y) {
		return PLUGINS.dataLayer.windowToImageCoordinates(new OpenSeadragon.Point(x, y));
	},

	setMode: function(mode) {
		if (typeof(mode) !== "number") {
			mode = Number.parseInt(mode);
		}

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
		switch(mode) {
			case this.Modes.CUSTOM:
				PLUGINS.osd.setMouseNavEnabled(false);
				this.overlay.fabricCanvas().discardActiveObject(); //deselect active if present
				break;
			case this.Modes.FREE_FORM_TOOL:
				//dirty but when a mouse is clicked, for some reason active object is deselected
				this.modifyTool._cachedSelection = this.overlay.fabricCanvas().getActiveObject();
				PLUGINS.osd.setMouseNavEnabled(false);
				this.overlay.fabricCanvas().hoverCursor = "crosshair";
				//todo value of radius from user
				this.modifyTool.setRadius(parseFloat(this.toolRadius.val())); //so that cursor radius that is being taken from here will be correct before midify tool init
				this.cursor.show();
				break;	
			default:
				console.warn("Invalid mode:", mode);
				return;
		}
		this.mode = mode;
		this._modesJqNode.val(mode);
	},

	_setModeToAuto: function() {
		if (this.presets.left) this.presets.left.objectFactory.finishIndirect();
		if (this.presets.right) this.presets.right.objectFactory.finishIndirect();

		switch(this.mode) {
			case this.Modes.CUSTOM:
				PLUGINS.osd.setMouseNavEnabled(true);
				break;
			case this.Modes.FREE_FORM_TOOL:
				this.overlay.fabricCanvas().hoverCursor = "pointer";
				this.cursor.hide();
				PLUGINS.osd.setMouseNavEnabled(true);
				this.overlay.fabricCanvas().renderAll();
				break;	
			default:
				console.warn("Invalid mode:", mode);
				return;
		}
		this.mode = this.Modes.AUTO;
		this._modesJqNode.val(this.Modes.AUTO);
	},

	//cursor management (TODO move here other stuff involving cursor too)
	// updater: function(mousePosition: OSD Point instance, cursorObject: object that is being shown underneath cursor)
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
			this._toolRadius = openseadragon_image_annotations.modifyTool.getScreenToolRadius();
		},

		getHTMLNode: function () {
			return this._node;
		},

		show: function () {
			if (this._listener) return;
			this._node.style.display = "block";
			this.updateRadius();
			this._node.style.width = (this._toolRadius * 2) + "px";
			this._node.style.height = (this._toolRadius * 2) + "px";
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


/*------------ Initialization of OSD Annotations ------------*/
var openseadragon_image_annotations = new OSDAnnotations();
  
  
PLUGINS.osd.addHandler('open', function() {
	openseadragon_image_annotations.initialize({
		scale: PLUGINS.imageLayer.source.Image.Size.Width,
		fireRightClick: true
	});
});
  
  