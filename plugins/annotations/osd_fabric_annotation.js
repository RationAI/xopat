sleep = function (ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
};

OSDAnnotations = function (incoming) {
	this.id = "openseadragon_image_annotations";
	PLUGINS.each[this.id].instance = this;

	this.DEFAULT_LEFT_LABEL = "Left Click";
	this.DEFAULT_RIGHT_LABEL = "Right Click";
	this.overlay = null;

	/*
	Global setting to show/hide annotations on default
	*/
	this.showAnnotations = true;
	/* Annotation property related data */
	//this.currentAnnotationObjectUpdater = null; //if user drags what function is being used to update

	this.alphaSensitivity = 65; //at what threshold the auto region outline stops

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

	// Classes defined in other local JS files
	this.messenger = new Messenger();
	this.history = new History(this);
	this.modifyTool = new FreeFormTool(this);

	// Annotation Objects
	this.polygon = new Polygon(this);
	this.ellipse = new Ellipse(this);
	this.rectangle = new Rect(this);

	this._presets = [];
	this._pixelReader = document.createElement('canvas');
	this._pixelReader.width = 1;
	this._pixelReader.height = 1;
	this._pixelReader = this._pixelReader.getContext('2d');
};

OSDAnnotations.prototype = {

	/*
	Initialize member variables
	*/
	initialize: function (options) {

		/* OSD values used by annotations */
		this._currentTile = "";
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
		PLUGINS.addPostExport("annotation_presets", this.getPresets.bind(this));
		let presets = PLUGINS.postData.annotation_presets;
		if (presets && presets.length > 10) {
			presets = JSON.parse(presets);
			for (let i = 0; i < presets.length; i++) {
				let p = new Preset().fromJSONFriendlyObject(presets[i], this);
				this._presets.push(p);
			}
		} else {
			this._presets.push(new Preset(this.rectangle, "", "#58994c"));
		}

		this.initHTML();
		//init history after my own HTML to occur below
		this.history.init(50);
		//cache nodes after HTML added
		this._modesJqNode = $("#annotation-mode");
		this._leftMouseJqNode = $("#annotations-left-click");
		this._rightMouseJqNode = $("#annotations-right-click");
		this.updatePreset(0, true);
		this.updatePreset(-1, false);
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
				return;
			}
		}

		function finishCreateAutoAnnotation(point, event, isLeftClick, updater) {
			let delta = Date.now() - openseadragon_image_annotations.cursor.mouseTime;
			if (delta > 100 || !updater) return; // just navigate if click longer than 100ms
			updater.instantCreate(point, isLeftClick);
		}
		
		function initCreateCustomAnnotation(point, event, isLeftClick, updater) {
			if (!updater) return;
			let _this = openseadragon_image_annotations;
			let pointer = _this.toGlobalPointXY(point.x, point.y);
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
				if (_this._cachedSelection) {
					//cached selection from shift press event, because sometimes the click event deselected active object
					currentObject = _this._cachedSelection;
					_this._cachedSelection = null;
				} else {
					//create tool-shaped object
					currentObject = _this.polygon.create(_this.modifyTool.getCircleShape(pointer), _this.objectOptions(isLeftClick));
					_this.overlay.fabricCanvas().add(currentObject);
					_this.overlay.fabricCanvas().setActiveObject(currentObject);
					_this.history.push(currentObject);
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

		function handleRightClickUp(o, point) {
			let _this = openseadragon_image_annotations;
			if (!_this.cursor.isDown) return;
			switch (_this.mode) {
				case _this.Modes.AUTO:
					finishCreateAutoAnnotation(point, o, false, _this.currentRightAnnotationObjectUpdater.context);
					break;
				case _this.Modes.CUSTOM:
					finishCreateCustomAnnotation(point, o, false, _this.currentRightAnnotationObjectUpdater.context);
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
			if (!_this.cursor.isDown) return;
			switch (_this.mode) {
				case _this.Modes.AUTO:
					finishCreateAutoAnnotation(point, o, true, _this.currentLeftAnnotationObjectUpdater.context);
					break;
				case _this.Modes.CUSTOM:
					finishCreateCustomAnnotation(point, o, true, _this.currentLeftAnnotationObjectUpdater.context);
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
			if (_this.cursor.isDown) return;
			_this.cursor.mouseTime = Date.now();
			_this.cursor.isDown = true;
			switch (_this.mode) {
				case _this.Modes.AUTO:
					initCreateAutoAnnotation(point, o, false, _this.currentRightAnnotationObjectUpdater.context);
					break;
				case _this.Modes.CUSTOM:
					initCreateCustomAnnotation(point, o, false, _this.currentRightAnnotationObjectUpdater.context);
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
			if (_this.cursor.isDown) return;
			_this.cursor.mouseTime = Date.now();
			_this.cursor.isDown = true;
			switch (_this.mode) {
				case _this.Modes.AUTO:
					initCreateAutoAnnotation(point, o, true, _this.currentLeftAnnotationObjectUpdater.context);
					break;
				case _this.Modes.CUSTOM:
					initCreateCustomAnnotation(point, o, true, _this.currentLeftAnnotationObjectUpdater.context);
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
				if (openseadragon_image_annotations.isMouseOSDInteractive()) {
					if (openseadragon_image_annotations.currentLeftAnnotationObjectUpdater) openseadragon_image_annotations.currentLeftAnnotationObjectUpdater.context.updateCreate(pointer.x, pointer.y);
					if (openseadragon_image_annotations.currentRightAnnotationObjectUpdater) openseadragon_image_annotations.currentRightAnnotationObjectUpdater.context.updateCreate(pointer.x, pointer.y);

					openseadragon_image_annotations.overlay.fabricCanvas().renderAll();
				}
			} else if (_this.mode === _this.Modes.FREE_FORM_TOOL) {
				openseadragon_image_annotations.modifyTool.update(pointer);
			} 
		});


		/*
		object:moving event listener
		if object that is move is cirlce (on of the polygon points),
		start editPolygon function which will update point coordinates
				*/
		this.overlay.fabricCanvas().on('object:moving', function (o) {
			if (!openseadragon_image_annotations.showAnnotations) return;

			var objType = o.target.get('type');
			if (objType == "_polygon.controls.circle") {
				openseadragon_image_annotations.polygon.updateEdit(o.target);
				openseadragon_image_annotations.overlay.fabricCanvas().renderAll();
			}
		});

		this.overlay.fabricCanvas().on('object:selected', function (e) {
			if (e && e.target) {
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
			if (!_this.showAnnotations || _this.mode !== _this.Modes.AUTO || _this.cursor.isDown) return;
			
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
			console.log("sending");
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
			console.log(send_data);

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
					openseadragon_image_annotations.messenger.show('status: ' + status + ', data: ' + data.responseData, 8000, openseadragon_image_annotations.messenger.MSG_INFO);
				});
		});


		//todo decide what format to use, discard the other one
		// download annotation as default json file and generated ASAP xml file
		$('#downloadAnnotation').click(function (event) {
			//json

			//TODO add oteher attributes for export to preserve funkcionality (border width, etc)
			var text = this.getJSONContent();
			var json_data = new Blob([text], { type: 'text/plain' });
			var url1 = window.URL.createObjectURL(json_data);
			document.getElementById('download_link1').href = url1;
			document.getElementById('download_link1').click();
			//asap xml
			var doc = generate_ASAPxml(openseadragon_image_annotations.overlay.fabricCanvas()._objects);
			var xml_text = new XMLSerializer().serializeToString(doc);
			var xml_data = new Blob([xml_text], { type: 'text/plain' });
			var url2 = window.URL.createObjectURL(xml_data);
			document.getElementById('download_link2').href = url2;
			document.getElementById('download_link2').click();
		});

		// create ASAP xml form with neccessary tags
		//todo async? 
		function generate_ASAPxml(canvas_objects) {
			// first, create xml dom
			doc = document.implementation.createDocument("", "", null);
			ASAP_annot = doc.createElement("ASAP_Annotations");
			xml_annotations = doc.createElement("Annotations");
			ASAP_annot.appendChild(xml_annotations);
			doc.appendChild(ASAP_annot);

			// for each object (annotation) create new annotation element with coresponding coordinates
			for (var i = 0; i < canvas_objects.length; i++) {
				var obj = canvas_objects[i];
				if (obj.type == "_polygon.controls.circle") {
					continue
				};
				var xml_annotation = doc.createElement("Annotation");
				xml_annotation.setAttribute("Name", "Annotation " + i);
				if (obj.type == "rect") {
					xml_annotation.setAttribute("Type", "Rectangle");
					var coordinates = generate_rect_ASAP_coord(obj);
				}
				if (obj.type == "polygon") {
					xml_annotation.setAttribute("Type", "Polygon");
					var coordinates = generate_polygon_ASAP_coord(obj);
				}
				xml_annotation.setAttribute("PartOfGroup", obj.a_group);
				//xml_annotation.setAttribute("Color", "#F4FA58");
				xml_annotation.setAttribute("Color", obj.fill);

				//get coordinates in ASAP format
				var xml_coordinates = doc.createElement("Coordinates");


				// create new coordinate element for each coordinate
				for (var j = 0; j < coordinates.length; j++) {
					var xml_coordinate = doc.createElement("Coordinate");
					xml_coordinate.setAttribute("Order", j);
					xml_coordinate.setAttribute("X", coordinates[j][0]);
					xml_coordinate.setAttribute("Y", coordinates[j][1]);
					xml_coordinates.appendChild(xml_coordinate);
				}
				// append coordinates to annotation
				xml_annotation.appendChild(xml_coordinates);
				// append whole annotation to annotations
				xml_annotations.appendChild(xml_annotation);
			}
			return doc;
		};

		function generate_rect_ASAP_coord(rect) {
			// calculate 4 coordinates of square annotation
			var coordinates = [];
			coordinates[0] = [rect.left + rect.width, rect.top];
			coordinates[1] = [rect.left, rect.top];
			coordinates[2] = [rect.left, rect.top + rect.height];
			coordinates[3] = [rect.left + rect.width, rect.top + rect.height];
			return coordinates;
		};

		function generate_polygon_ASAP_coord(polygon) {
			// calculate  coordinates of plygon annotation
			var coordinates = [];
			for (var j = 0; j < polygon.points.length; j++) {
				coordinates[j] = [polygon.points[j].x, polygon.points[j].y]
			};
			return coordinates;
		};


		// listen for changes in opacity slider and change opacity for each annotation
		this.opacity.on("input", function () {
			var opacity = $(this).val();
			openseadragon_image_annotations.overlay.fabricCanvas().forEachObject(function (obj) {
				obj.opacity = opacity;
			});

			openseadragon_image_annotations.overlay.fabricCanvas().renderAll();

		});

		/*
  			listener form object:modified
			-recalcute coordinates for annotations
		*/
		this.overlay.fabricCanvas().on("object:modified", function (o) {
			if (!openseadragon_image_annotations.showAnnotations || openseadragon_image_annotations.isMouseOSDInteractive()) return;

			//todofix...
			var canvas = openseadragon_image_annotations.overlay.fabricCanvas();
			if (o.target.type == "rect") {
				// set correct coordinates when object is scaling
				o.target.width *= o.target.scaleX;
				o.target.height *= o.target.scaleY;
				o.target.scaleX = 1;
				o.target.scaleY = 1;
				//openseadragon_image_annotations.set_input_form(o.target);
				//$("#input_form").show();

			};

			// if polygon is being modified (size and position, not separate points)
			if (o.target.type != "polygon" || openseadragon_image_annotations.polygon.currentlyEddited) { return };
			var original_polygon = o.target;
			var matrix = original_polygon.calcTransformMatrix();
			var transformedPoints = original_polygon.get("points")
				.map(function (p) {
					return new fabric.Point(
						p.x - original_polygon.pathOffset.x,
						p.y - original_polygon.pathOffset.y);
				})
				.map(function (p) {
					return fabric.util.transformPoint(p, matrix);
				});

			// create new polygon with updated coordinates
			var modified_polygon = this.polygon.create(transformedPoints, original_polygon.isLeftClick);
			// remove orignal polygon and replace it with modified one
			canvas.remove(original_polygon);
			canvas.add(modified_polygon).renderAll();
			// TODO keep HISTORY in edit mode?
			// openseadragon_image_annotations.history.push(modified_polygon, original_polygon);
			// openseadragon_image_annotations.history.highlight(modified_polygon)


			//todo what about setting active control points correctly? maybe not possible with ctrl, so default is not show
			canvas.setActiveObject(modified_polygon);
			//openseadragon_image_annotations.set_input_form(modified_polygon);
			//$("#input_form").show();
		});

		// update annotation group (from input form)
		$("#annotation_group").on("change", function () {
			var annotation = openseadragon_image_annotations.overlay.fabricCanvas().getActiveObject();
			annotation.set({ a_group: $(this).val() });

		});
		//update annotation comment (from input form)
		$("#annotation_comment").on("input", function () {
			var annotation = openseadragon_image_annotations.overlay.fabricCanvas().getActiveObject();
			if (annotation) {
				annotation.set({ comment: $(this).val() })
			};
			openseadragon_image_annotations.history._updateBoardText(annotation, annotation.comment);
		});

		// delete all annotation
		$('#deleteAll').click(function () {
			// if polygon was mid-drawing resets all parameters
			openseadragon_image_annotations.polygon.polygonBeingCreated = false;
			openseadragon_image_annotations.deleteAllAnnotations();
		});
	}, // end of initialize

	/****************************************************************************************************************

									HTML MANIPULATION

	*****************************************************************************************************************/

	updatePreset: function(index, isLeftClick) {
		let newPreset = (index >= 0 && index < this._presets.length) ? this._presets[index] : false;
		if (isLeftClick) {
			this.currentLeftAnnotationObjectUpdater = newPreset;
		} else {
			this.currentRightAnnotationObjectUpdater = newPreset;
		}
		if (this.currentLeftAnnotationObjectUpdater) {
			this._leftMouseJqNode.html(this.currentLeftAnnotationObjectUpdater.getHTML(true));
		} else {
			this._leftMouseJqNode.html(`<div class="border-md border-dashed p-1 mx-2 rounded-3" style="border-width:3px!important;" onclick="openseadragon_image_annotations.showPresets(true);"><span class="material-icons">add</span> Add</div>`);
		}
		if (this.currentRightAnnotationObjectUpdater) {
			this._rightMouseJqNode.html(this.currentRightAnnotationObjectUpdater.getHTML(false));
		} else {
			this._rightMouseJqNode.html(`<div class="border-md border-dashed p-1 mx-2 rounded-3" style="border-width:3px!important;" onclick="openseadragon_image_annotations.showPresets(false);"><span class="material-icons">add</span> Add</div>`);
		}
	},

	showPresets: function (isLeftClick) {
		let html = "",
			currentPreset = isLeftClick ? this.currentLeftAnnotationObjectUpdater : this.currentRightAnnotationObjectUpdater,
			_this = this,
			counter = 0;
		if (!currentPreset) currentPreset = this._presets[0];

		this._presets.forEach(preset => {
			let select = "";
			
			switch (preset.context.type) {
				case "rect": select = `<option value="rectangle" selected>Rectangle</option><option value="ellipse">Ellipse</option><option value="polygon">Polygon</option>`; break;
				case "ellipse": select = `<option value="rectangle">Rectangle</option><option value="ellipse" selected>Ellipse</option><option value="polygon">Polygon</option>`; break;
				case "polygon": select = `<option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option><option value="polygon" selected>Polygon</option>`; break;
				default: console.error('Invalid presset.'); break;
			}
			html += `<div id="preset-no-${counter}" class="position-relative border-md border-dashed p-1 rounded-3 d-inline-block `;
			if (preset === currentPreset) {
				html += `highlighted-preset"`;
				_this._pressetIdx = counter;
			} else {
				html += `"`;
			}
			html += ` style="cursor:pointer; margin: 5px;" onclick="$(this).parent().children().removeClass('highlighted-preset');$(this).addClass('highlighted-preset');openseadragon_image_annotations._pressetIdx = $(this).index();">
				<span class="material-icons position-absolute top-0 right-0 px-0" onclick="openseadragon_image_annotations._presets.splice($(this).parent().index(), 1);$(this).parent().parent().parent().parent().remove(); openseadragon_image_annotations.showPresets(${isLeftClick}); return false;">delete</span>
				<div class="d-inline-block mr-1">Annotation<br><select class="form-control" onchange="openseadragon_image_annotations._presets[$(this).parent().parent().index()].context = openseadragon_image_annotations[this.value];">${select}</select></div>
				<div class="d-inline-block">Color<br><input class="form-control" type="color" style="height:33px;" onchange="openseadragon_image_annotations._presets[$(this).parent().parent().index()].color = this.value;" value="${preset.color}"></div><br>
				Comment<br><input class="form-control" type="text" onchange="openseadragon_image_annotations._presets[$(this).parent().index()].comment = this.value;" value="${preset.comment}"><br>
			</div>`;
			counter++;
		});

		html += `<div id="preset-add-new" class="border-md border-dashed p-1 mx-2 my-2 rounded-3 d-inline-block" style="vertical-align:top; width:150px; cursor:pointer;" onclick="
			openseadragon_image_annotations._presets.push(new Preset(openseadragon_image_annotations.rectangle, '', '#58994c'));$(this).parent().parent().parent().parent().remove();
			openseadragon_image_annotations.showPresets(${isLeftClick});
		"><span class="material-icons">add</span> New</div>`;

		let title = isLeftClick ? "for left click" : "for right click";

		$("body").append(`
		<div class="position-fixed" style="z-index:999; left: 50%;top: 50%;transform: translate(-50%,-50%);">
<details-dialog class="Box Box--overlay d-flex flex-column" style=" max-width:80vw; max-height: 80vh">
    <div class="Box-header">
      <button class="Box-btn-octicon btn-octicon float-right" type="button" aria-label="Close help" onclick="$(this).parent().parent().parent().remove();">
        <svg class="octicon octicon-x" viewBox="0 0 12 16" version="1.1" width="12" height="16" aria-hidden="true"><path fill-rule="evenodd" d="M7.48 8l3.75 3.75-1.48 1.48L6 9.48l-3.75 3.75-1.48-1.48L4.52 8 .77 4.25l1.48-1.48L6 6.52l3.75-3.75 1.48 1.48L7.48 8z"></path></svg>
      </button>
      <h3 class="Box-title">Annotations presets ${title}</h3>
    </div>
    <div class="overflow-auto position-relative">
      <div class="Box-body overflow-auto" style="padding-bottom: 45px;">
	  ${html}
	  </div>
	  <button id="select-annotation-preset" onclick="
	    if (openseadragon_image_annotations._pressetIdx === undefined) { return false;} let _this = $(this);
		setTimeout(function(){
			_this.parent().parent().parent().remove(); openseadragon_image_annotations.updatePreset(openseadragon_image_annotations._pressetIdx, ${isLeftClick}); 
		}, 150);" class="btn position-absolute bottom-2 right-4">Select</button>
    </div>
  </details-dialog>
  </div>
	`);
	},

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
		<span id="annotations-left-click" class="d-inline-block position-relative" style="width: 180px; cursor:pointer;"></span><span id="annotations-right-click" class="d-inline-block position-relative" style="width: 180px; cursor:pointer;"></span>
		
		<a id="download_link1" download="my_exported_file.json" href="" hidden>Download as json File</a>
		<a id="download_link2" download="my_exported_file.xml" href="" hidden>Download as xml File</a>`, 
		`<div id="imageAnnotationToolbarContent">
					<br>
					<span class="d-inline-block" style="width:46%" title="More sensitivity means less area selected when single-clicking">Automatic shape sensitivity:</span>
					<input style="width:50%" title="The higher the sensitivity, the smaller automatic shape (selects only higher opacity regions)." type="range" id="sensitivity_auto_outline" min="0" max="100" value="${openseadragon_image_annotations.alphaSensitivity}" step="1" onchange="openseadragon_image_annotations.setAutoOutlineSensitivity($(this).val());">
					<br>				
					<span class="d-inline-block" style="width:46%" title="Size of a brush used to modify annotations areas.">Free form tool size:</span>
					<input style="width:50%" class="form-control" title="Size of a brush used to modify annotations areas." type="number" min="1" max="500" name="freeFormToolSize" id="fft-size" autocomplete="off" value="50" onchange="openseadragon_image_annotations.modifyTool.setRadius(this.value);" style="height: 22px;">
					</div>`, 
					"annotations-panel");

		//form for object property modification
		$("body").append(`<div id="annotation-cursor" style="border: 2px solid black;border-radius: 50%;position: absolute;transform: translate(-50%, -50%);pointer-events: none;display:none;"></div>
		<select id="annotation-mode" class="form-control position-fixed top-2 left-2" onchange="
		switch($(this).val()) {
			case 'auto': openseadragon_image_annotations.setMode(openseadragon_image_annotations.Modes.AUTO); break;
			case 'alt-left': openseadragon_image_annotations.setMode(openseadragon_image_annotations.Modes.CUSTOM); break;
			case 'shift': openseadragon_image_annotations.setMode(openseadragon_image_annotations.Modes.FREE_FORM_TOOL); break;
		} return false;
		">
		<option value="auto" selected>automatic shape & navigation</option>
		<option value="alt-left">🖌 custom shape (⌨ Left Alt)</option>
		<option value="shift">&#9733; free form tool (⌨ Left Shift)</option>
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
			"Annotations Plugin", "learn to use annotations", "draw", [ 
			{
				"next #annotations-panel": "Annotations allow you to annotate <br>the canvas parts and export and share all of it."
			}, {
				"next #annotation-board": "Annotation board is the second panel part of this plugin: <br>you can see all your objects and modify them."
			},{
				"click #annotations-panel-pin": "Click on the pin to keep visible all controls."
			},{
				"next #enable-disable-annotations": "This icon can temporarily disable <br>all annotations - not just hide, but disable also <br>all plugin controls and hotkeys."
			},{
				"next #downloadAnnotation": "Here you can download <b>just</b> your annotations.<br>This is included automatically when using global `Export` option."
			},{
				"next #annotations-left-click": "Each of your mouse buttons<br>can act as an annotation controls.<br>Simply assign some pre-set and start annotating!"
			},{
				"click #annotations-right-click": "Click here to specify an annotation<br>for your right mouse button."
			},{
				"next #preset-no-0": "This is an example of an annotation preset."
			},{
				"next #preset-add-new": "We want to keep the old preset,<br>so create a new one. Click on 'New', then continue with 'Next'."
			},{
				"next #preset-no-1": "Adjust the new annotation preset:<br>choose a <b>polygon</b> as type,<br>and set any color and comment you like."
			},{
				"click #select-annotation-preset": "Since we've already selected<br>the pre-set by clicking on its properties,<br>choose Select to assign it to the right mouse button."
			},{
				"next #viewer-container": "You can now use right mouse button<br>to create a polygons,<br>or the left button for different preset - at once!"
			},{
				"next #viewer-container": "Try now to right-click somewhere on a canvas:<br>either you click on a data that will be<br>automatically outlined, or outside:<br>the visualisation will tell you so.<br>By simple click on a canvas, you can create automatically annotations.<br>But dragging will let you navigate."
			},{
				"next #sensitivity_auto_outline": "The automated annotation creation is controlled by this slider.<br>Increase the slider value to choose more opaque areas only - and vice versa."
			},{
				"next #annotation-mode": "Apart from the default, navigation mode, you can switch to different annotation modes here."
			},{
				"next #viewer-container": "Select 'custom shape' mode to drag-create annotations (or click for points adding in case of polygon).<br> You can do the selection temporarily by holding <br>Left Alt</b> key."
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
				"next #annotation-board": "Hotkeys: 'undo' can be performed by Ctrl+Z, 'redo' by Ctrl+Shift+Z.<br>'Delete' key will remove highlighted annotation<br>-simply click on the board on an annotation and hit 'delete' key."
			}]
		);
	},

	/****************************************************************************************************************

									S E T T E R S, GETTERS

	*****************************************************************************************************************/

	getJSONContent: function () {
		return JSON.stringify(this.overlay.fabricCanvas().toObject(['comment', 'a_group', 'threshold', 'borderColor', 'cornerColor', 'borderScaleFactor']));
	},

	getPresets: function() {
		let exported = [];
		for (let i = 0; i < this._presets.length; i++) {
			exported.push(this._presets[i].toJSONFriendlyObject());
		}
		return JSON.stringify(exported);
	},

	// 0 --> no sensitivity  100 --> most sensitive
	setAutoOutlineSensitivity: function (sensitivity) {
		//we map to alpha interval 20 (below no visible) to 200 (only the most opaque elements) --> interval of 180 length
		this.alphaSensitivity = Math.round(180 * (sensitivity / 100) + 20);
	},

	setMouseOSDInteractive: function (isOSDInteractive) {
		if (this.mouseOSDInteractive == isOSDInteractive) return;

		if (isOSDInteractive) {
			//this.setFabricCanvasInteractivity(true);
			//this.deselectFabricObjects();
			PLUGINS.osd.setMouseNavEnabled(true);
			//$("#input_form").hide();
			this.overlay.fabricCanvas().defaultCursor = "crosshair";
			this.overlay.fabricCanvas().hoverCursor = "pointer";

			// if (this.polygon.currentlyEddited) {
			// 	//save if eddited
			// 	this.polygon.finishCreate();
			// }
			//TODO also finish indirect if creation object changed to another object
			if (this.currentLeftAnnotationObjectUpdater) this.currentLeftAnnotationObjectUpdater.context.finishIndirect();
			if (this.currentRightAnnotationObjectUpdater) this.currentRightAnnotationObjectUpdater.context.finishIndirect();

			let active = this.overlay.fabricCanvas().getActiveObject();
			if (active) {
				active.hasControls = false;
			}

		} else {
			//this.setFabricCanvasInteractivity(true);
			PLUGINS.osd.setMouseNavEnabled(false);
			this.overlay.fabricCanvas().defaultCursor = "auto";
			//this.overlay.fabricCanvas().hoverCursor = "move";

			let active = this.overlay.fabricCanvas().getActiveObject();
			if (active) {
				active.hasControls = true;
				if (active.type == "polygon") this.polygon.initEdit(active);
				//this.set_input_form(active);
				//$("#input_form").show();
			}
		}
		this.overlay.fabricCanvas().renderAll();
		this.mouseOSDInteractive = isOSDInteractive;
	},

	isMouseOSDInteractive: function () {
		return this.mouseOSDInteractive;
	},

	/****************************************************************************************************************

									A N N O T A T I O N S (Automatic)

	*****************************************************************************************************************/


	createOutline: async function (eventPosition) {
		console.log("called outline");

		this.changeTile(eventPosition);

		//todo unused, maybe round origin point...?
		// eventPosition.x = Math.round(eventPosition.x);
		// eventPosition.y = Math.round(eventPosition.y);


		let points = new Set();
		this.comparator = function (pix) {
			return (pix[3] > this.alphaSensitivity && (pix[0] > 200 || pix[1] > 200));
		}

		var x = eventPosition.x;  // current x position
		var y = eventPosition.y;  // current y position
		var direction = "UP"; // current direction of outline

		let origPixel = this.getPixelData(eventPosition);
		if (!this.comparator(origPixel)) {
			openseadragon_image_annotations.messenger.show("Outside a region - decrease the sensitivity.", openseadragon_image_annotations.messenger.MSG_INFO);
			return
		};

		if (origPixel[0] > 200) {
			this.comparator = function (pix) {
				return pix[3] > this.alphaSensitivity && pix[0] > 200;
			}
		} else {
			this.comparator = function (pix) {
				return pix[3] > this.alphaSensitivity && pix[1] > 200;
			}
		}

		//$("#osd").append(`<span style="position:absolute; top:${y}px; left:${x}px; width:5px;height:5px; background:blue;" class="to-delete"></span>`);

		while (this.getAreaStamp(x, y) == 15) {
			x += 2; //all neightbours inside, skip by two
		}
		x -= 2;

		$("#osd").append(`<span style="position:absolute; top:${y}px; left:${x}px; width:5px;height:5px; background:blue;" class="to-delete"></span>`);

		var first_point = new OpenSeadragon.Point(x, y);

		//indexing instead of switch
		var handlers = [
			// 0 - all neighbours outside, invalid
			function () { console.error("Fell out of region.") },

			// 1 - only TopLeft pixel inside
			function () {
				if (direction == "DOWN") {
					direction = "LEFT";
				} else if (direction == "RIGHT") {
					direction = "UP";
				} else { console.log("INVALID DIRECTION 1)"); return; }
				points.add(openseadragon_image_annotations.toGlobalPointXY(x, y)); //changed direction
			},

			// 2 - only BottomLeft pixel inside
			function () {
				if (direction == "UP") {
					direction = "LEFT";
				} else if (direction == "RIGHT") {
					direction = "DOWN";
				} else { console.log("INVALID DIRECTION 2)"); return; }
				points.add(openseadragon_image_annotations.toGlobalPointXY(x, y)); //changed direction
			},

			// 3 - TopLeft & BottomLeft pixel inside
			function () {
				if (direction != "UP" && direction != "DOWN") { console.log("INVALID DIRECTION 3)"); return; }
			},

			// 4 - only BottomRight pixel inside
			function () {
				if (direction == "UP") {
					direction = "RIGHT";
				} else if (direction == "LEFT") {
					direction = "DOWN";
				} else { console.log("INVALID DIRECTION 4)"); return; }
				points.add(openseadragon_image_annotations.toGlobalPointXY(x, y)); //changed direction
			},

			// 5 - TopLeft & BottomRight pixel inside, one of them does not belong to the area
			function () {
				if (direction == "UP") {
					direction = "RIGHT";
				} else if (direction == "LEFT") {
					direction = "DOWN";
				} else if (direction == "RIGHT") {
					direction = "UP";
				} else { direction = "LEFT"; }
				points.add(openseadragon_image_annotations.toGlobalPointXY(x, y)); //changed direction
			},

			// 6 - BottomLeft & BottomRight pixel inside, one of them does not belong to the area
			function () {
				if (direction != "LEFT" && direction != "RIGHT") { console.log("INVALID DIRECTION 6)"); return; }
			},

			// 7 - TopLeft & BottomLeft & BottomRight  pixel inside, same case as TopRight only
			() => handlers[8](),

			// 8 - TopRight only
			function () {
				if (direction == "DOWN") {
					direction = "RIGHT";
				} else if (direction == "LEFT") {
					direction = "UP";
				} else { console.log("INVALID DIRECTION 8)"); return; }
				points.add(openseadragon_image_annotations.toGlobalPointXY(x, y)); //changed direction
			},

			// 9 - TopLeft & TopRight 
			function () {
				if (direction != "LEFT" && direction != "RIGHT") { console.log("INVALID DIRECTION 6)"); return; }
			},

			// 10 - BottomLeft & TopRight 
			function () {
				if (direction == "UP") {
					direction = "LEFT";
				} else if (direction == "LEFT") {
					direction = "UP";
				} else if (direction == "RIGHT") {
					direction = "DOWN";
				} else { direction = "RIGHT"; }
				points.add(openseadragon_image_annotations.toGlobalPointXY(x, y)); //changed direction
			},

			// 11 - BottomLeft & TopRight & TopLeft --> case 4)
			() => handlers[4](),

			// 12 - TopRight & BottomRight 
			function () {
				if (direction != "TOP" && direction != "DOWN") { console.log("INVALID DIRECTION 12)"); return; }
			},

			// 13 - TopRight & BottomRight & TopLeft
			() => handlers[2](),

			// 14 - TopRight & BottomRight & BottomLeft
			() => handlers[1](),

			// 15 - ALL inside
			function () { console.error("Fell out of region."); }
		];

		surroundingInspector = function (x, y, maxDist) {
			for (var i = 1; i <= maxDist; i++) {
				$("#osd").append(`<span style="position:absolute; top:${y + i}px; left:${x + i}px; width:5px;height:5px; background:red;" class="to-delete"></span>`);

				if (openseadragon_image_annotations.isValidPixel(new OpenSeadragon.Point(x + i, y)) > 0) return [x + i, y + i];
				$("#osd").append(`<span style="position:absolute; top:${y - i}px; left:${x + i}px; width:5px;height:5px; background:red;" class="to-delete"></span>`);

				if (openseadragon_image_annotations.isValidPixel(new OpenSeadragon.Point(x, y + i)) > 0) return [x + i, y - i];
				$("#osd").append(`<span style="position:absolute; top:${y + i}px; left:${x - i}px; width:5px;height:5px; background:red;" class="to-delete"></span>`);

				if (openseadragon_image_annotations.isValidPixel(new OpenSeadragon.Point(x - i, y)) > 0) return [x - i, y + i];
				$("#osd").append(`<span style="position:absolute; top:${y - i}px; left:${x - i}px; width:5px;height:5px; background:red;" class="to-delete"></span>`);

				if (openseadragon_image_annotations.isValidPixel(new OpenSeadragon.Point(x, y + i)) > 0) return [x - i, y - i];

			}
			return null;
		};

		let maxLevel = PLUGINS.dataLayer.source.maxLevel;
		let level = this._currentTile.level;
		let maxSpeed = 24;
		let speed = Math.round(maxSpeed / Math.max(1, 2 * (maxLevel - level)));

		var counter = 0;
		while ((Math.abs(first_point.x - x) > 2 || Math.abs(first_point.y - y) > 2) || counter < 20) {
			let mark = this.getAreaStamp(x, y);
			if (mark == 0 || mark == 15) {
				let findClosest = surroundingInspector(x, y, 2 * speed);
				console.log("CLOSEST", findClosest);
				if (findClosest) {
					x = findClosest[0];
					y = findClosest[1];
					//points.add(this.toGlobalPointXY(x, y));
					console.log("continue");
					continue;
				} else {
					this.messenger.show("Failed to create outline - no close point.", 2000, this.messenger.MSG_ERR);
					return;
				}
			}

			handlers[mark]();

			//todo instead of UP/LEFT etc. set directly
			switch (direction) {
				case 'UP': y--; break;
				case 'LEFT': x--; break;
				case 'RIGHT': x++; break;
				case 'DOWN': y++; break;
				default: console.error("Invalid direction");
			}
			counter++;

			$("#osd").append(`<span style="position:absolute; top:${y}px; left:${x}px; width:5px;height:5px; background:blue;" class="to-delete"></span>`);

			if (counter > 5000) {
				this.messenger.show("Failed to create outline", 1500, this.messenger.MSG_ERR);
				$(".to-delete").remove();

				return;
			}

			if (counter % 100 == 0) { await sleep(200); }
		}

		//todo hardcoded true, this func probably wont survive anyway
		let obj = this.polygon.create(Array.from(points), this.objectOptions(true));
		this.overlay.fabricCanvas().add(obj);
		this.history.push(obj);
		this.overlay.fabricCanvas().setActiveObject(obj);
		this.overlay.fabricCanvas().renderAll();

		//$(".to-delete").remove();
	},

	//used to detect auto size of a primitive object (rect/ellipse)
	_getSimpleApproxObjectBounds: function (eventPosition) {
		//TODO move this beginning logic to handler

		this.changeTile(eventPosition);

		//todo unused, maybe round origin point...?
		// eventPosition.x = Math.round(eventPosition.x);
		// eventPosition.y = Math.round(eventPosition.y);

		this.comparator = function (pix) {
			return (pix[3] > this.alphaSensitivity && (pix[0] > 200 || pix[1] > 200));
		}

		//var originPoint = getOriginPoint(eventPosition);
		let origPixel = this.getPixelData(eventPosition);
		var x = eventPosition.x;  // current x position
		var y = eventPosition.y;  // current y position

		if (!this.comparator(origPixel)) {
			//default object of width 40
			return { top: this.toGlobalPointXY(x, y - 20), left: this.toGlobalPointXY(x - 20, y), bottom: this.toGlobalPointXY(x, y + 20), right: this.toGlobalPointXY(x + 20, y) }
		};

		while (this.getAreaStamp(x, y) == 15) {
			x += 2;
		}
		var right = this.toGlobalPointXY(x, y);
		x = eventPosition.x;

		while (this.getAreaStamp(x, y) == 15) {
			x -= 2;
		}
		var left = this.toGlobalPointXY(x, y);
		x = eventPosition.x;

		while (this.getAreaStamp(x, y) == 15) {
			y += 2;
		}
		var bottom = this.toGlobalPointXY(x, y);

		y = eventPosition.y;
		while (this.getAreaStamp(x, y) == 15) {
			y -= 2;
		}
		var top = this.toGlobalPointXY(x, y);

		return { top: top, left: left, bottom: bottom, right: right }
	},


	//if first direction cannot be persued, other take over for some time
	// primaryDirection - where pixel is tested, directions - where the recursion is branching, resultingPoints - to push border points(result),
	// speed - how many pixels skip, evaluator - function that takes a position and returns bool - True if valid pixel
	_growRegion: function (x, y, bitsX, bitsY, bitsmap, resultingPoints, speed, evaluator) {

		if (bitsX < 0 || bitsX >= bitsmap.dimension || bitsY < 0 || bitsY >= bitsmap.dimension) {
			//todo stop here, add the point or believe it was being taken care of before??
			resultingPoints.push([x, y]);
			return;
		}

		let newP = new OpenSeadragon.Point(x, y);
		//console.log(`${bitsX}, ${bitsY}:: ${x}, ${y}`)
		if (evaluator(newP)) {
			resultingPoints.push([newP.x, newP.y]);

			if (!bitsmap.isFlag(bitsX + 1, bitsY)) {
				bitsmap.setFlag(bitsX + 1, bitsY);
				this._growRegion(x + speed, y, bitsX + 1, bitsY, bitsmap, resultingPoints, speed, evaluator);
			}
			if (!bitsmap.isFlag(bitsX - 1, bitsY)) {
				bitsmap.setFlag(bitsX - 1, bitsY);
				this._growRegion(x - speed, y, bitsX - 1, bitsY, bitsmap, resultingPoints, speed, evaluator);
			}
			if (!bitsmap.isFlag(bitsX, bitsY + 1)) {
				bitsmap.setFlag(bitsX, bitsY + 1);
				this._growRegion(x, y + speed, bitsX, bitsY + 1, bitsmap, resultingPoints, speed, evaluator);
			}
			if (!bitsmap.isFlag(bitsX, bitsY - 1)) {
				bitsmap.setFlag(bitsX, bitsY - 1);
				this._growRegion(x, y - speed, bitsX, bitsY - 1, bitsmap, resultingPoints, speed, evaluator);
			}
		}
		//else: try to go pixel by pixel back to find the boundary
	},

	//if first direction cannot be persued, other take over for some time
	// primaryDirection - where pixel is tested, directions - where the recursion is branching, resultingPoints - to push border points(result),
	// speed - how many pixels skip, evaluator - function that takes a position and returns bool - True if valid pixel
	_growRegionInDirections: function (x, y, primaryDirection, directions, resultingPoints, speed, evaluator, maxDist = -1, _primarySubstitued = false) {
		let newP = new OpenSeadragon.Point(x + primaryDirection[0] * speed, y + primaryDirection[1] * speed)

		if (maxDist === 0) {
			resultingPoints.push([x, y]);
			return;
		}

		var valid = true;
		if (evaluator(newP)) {

			//TODO PUT SOME INSIDE POINTS AS WELL, OTHERWISE CONVEX HULL FAILS TO COMPUTE COREECT OUTLINE

			//if (Math.random() > 0.8) {
			resultingPoints.push([newP.x, newP.y]);
			//if (maxDist > 0) $("#osd").append(`<span style="position:absolute; top:${newP.y}px; left:${newP.x}px; width:5px;height:5px; background:blue;" class="to-delete"></span>`);

			//$("#osd").append(`<span style="position:absolute; top:${newP.y}px; left:${newP.x}px; width:5px;height:5px; background:blue;" class="to-delete"></span>`);
			//}

			if (_primarySubstitued && directions[0]) {
				valid &= this._growRegionInDirections(newP.x, newP.y, directions[0], [primaryDirection], resultingPoints, speed, evaluator, maxDist--, false);
			}

			if (valid) {
				this._growRegionInDirections(newP.x, newP.y, primaryDirection, directions, resultingPoints, speed, evaluator, maxDist--, _primarySubstitued);

				for (var i = 0; i < directions.length; i++) {
					this._growRegionInDirections(newP.x, newP.y, directions[i], [], resultingPoints, speed, evaluator, maxDist--, _primarySubstitued);
				}
			}

			return valid;
		} else {

			if (!_primarySubstitued) {
				//TODO due to speed probably imprecise, try to find exact border by going forward by 1?

				// let point = this.toGlobalPoint(new OpenSeadragon.Point(Math.round(x), Math.round(y)));
				// resultingPoints.push(point); //border point

				// resultingPoints.push([point.x, point.y]); //border point
				let cc = 0;

				if (maxDist < 0) {
					do {
						newP.x -= primaryDirection[0];
						newP.y -= primaryDirection[1];
						cc++;
					} while (!evaluator(newP) && cc < 500);
					
				}
				if (cc < 500) {
					resultingPoints.push([newP.x, newP.y]);
					//$("#osd").append(`<span style="position:absolute; top:${newP.y}px; left:${newP.x}px; width:5px;height:5px; background:blue;" class="to-delete"></span>`);

				}


				for (var i = 0; i < directions.length; i++) {
					this._growRegionInDirections(x + directions[i][0] * speed, y + directions[i][1] * speed, directions[i], [primaryDirection], resultingPoints, speed, evaluator, maxDist--, true);
				}
			}
			return false;
		}
	},

	/****************************************************************************************************************

									HELPER OSD/FABRIC FUNCTIONS (manipulation with pixels and coordinates)

	*****************************************************************************************************************/

	toScreenCoords: function (x, y) {
		return PLUGINS.dataLayer.imageToWindowCoordinates(new OpenSeadragon.Point(x, y));
	},

	toGlobalPointXY: function (x, y) {
		return PLUGINS.dataLayer.windowToImageCoordinates(new OpenSeadragon.Point(x, y));
	},

	toGlobalPoint: function (point) {
		return PLUGINS.dataLayer.windowToImageCoordinates(point);
	},

	getCursorXY: function (e) {
		return new OpenSeadragon.Point(e.pageX, e.pageY);
	},

	getGlobalCursorXY: function (e) {
		return this.getGlobalCursorXY(this.getCursorXY(e));
	},

	toDistanceObj: function (pointA, pointB) {
		return Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
	},

	toDistanceList: function (pointA, pointB) {
		return Math.hypot(pointB[0] - pointA[0], pointB[1] - pointA[1]);
	},

	getRelativePixelDiffDistSquared: function(relativeDiff=1) {
		let pointA = PLUGINS.dataLayer.windowToImageCoordinates(new OpenSeadragon.Point(0, 0));
		let pointB = PLUGINS.dataLayer.windowToImageCoordinates(new OpenSeadragon.Point(relativeDiff, 0));
		return Math.pow(pointB.x - pointA.x, 2) + Math.pow(pointB.y - pointA.y, 2);
	},

	// set currentTile to tile where is the event
	changeTile: function (eventPosition) {
		let viewportPos = PLUGINS.osd.viewport.pointFromPixel(eventPosition);
		let tiles = PLUGINS.dataLayer.lastDrawn;
		for (let i = 0; i < tiles.length; i++) {
			if (tiles[i].bounds.containsPoint(viewportPos)) {
				this._currentTile = tiles[i];
				return;
			}	
		}
	},

	isSimilarPixel: function (eventPosition, toPixel) {
		let pix = this.getPixelData(eventPosition);
		for (let i = 0; i < 4; i++) {
			//todo dynamic or sensitivity based threshold?
			if (Math.abs(pix[i] - toPixel[i]) > 10) return false;
		}
		return this.comparator(pix);
	},

	isValidPixel: function (eventPosition) {
		return this.comparator(this.getPixelData(eventPosition));
	},

	getPixelData: function (eventPosition) {
		//change only if outside
		if (!this._currentTile.bounds.containsPoint(eventPosition)) {
			this.changeTile(eventPosition);
		}

		// get position on a current tile
		var x = eventPosition.x - this._currentTile.position.x;
		var y = eventPosition.y - this._currentTile.position.y;

		// get position on DZI tile (usually 257*257)
		var relative_x = Math.round((x / this._currentTile.size.x) * this._currentTile.context2D.canvas.width);
		var relative_y = Math.round((y / this._currentTile.size.y) * this._currentTile.context2D.canvas.height);

		this._pixelReader.drawImage(this._currentTile.origData, relative_x, relative_y, 1, 1, 0, 0, 1, 1);
		return this._pixelReader.getImageData(0, 0, 1, 1).data;
	},

	// CHECKS 4 neightbouring pixels and returns which ones are inside the specified region
	//  |_|_|_|   --> topRight: first (biggest), bottomRight: second, bottomLeft: third, topLeft: fourth bit
	//  |x|x|x|   --> returns  0011 -> 0*8 + 1*4 + 1*2 + 0*1 = 6, bottom right & left pixel inside
	//  |x|x|x|
	getAreaStamp: function (x, y) {
		var result = 0;
		if (this.isValidPixel(new OpenSeadragon.Point(x + 1, y - 1))) {
			result += 8;
		}
		if (this.isValidPixel(new OpenSeadragon.Point(x + 1, y + 1))) {
			result += 4;
		}
		if (this.isValidPixel(new OpenSeadragon.Point(x - 1, y + 1))) {
			result += 2;
		}
		if (this.isValidPixel(new OpenSeadragon.Point(x - 1, y - 1))) {
			result += 1;
		}
		return result;
	},

	/****************************************************************************************************************
 
					OBJECT PROPERTIES - passed to object.create(...)
 
	 *****************************************************************************************************************/

	objectOptionsLeftClick: {
		selectable: true,
		strokeWidth: 2,
		borderColor: '#fbb802',
		cornerColor: '#fbb802',
		stroke: 'black',
		borderScaleFactor: 3,
		hasControls: false,
		lockMovementY: true,
		lockMovementX: true,
		isLeftClick: true,
		hasRotatingPoint: false,
	},

	objectOptionsRightClick:{
		selectable: true,
		strokeWidth: 2,
		borderColor: '#fbb802',
		cornerColor: '#fbb802',
		stroke: 'black',
		borderScaleFactor: 3,
		hasControls: false,
		lockMovementY: true,
		lockMovementX: true,
		isLeftClick: false,
		hasRotatingPoint: false,
	},

	objectOptions: function(isLeftClick) {
		if (isLeftClick) {
			this.objectOptionsLeftClick.opacity = this.opacity.val();
			this.objectOptionsLeftClick.fill = this.currentLeftAnnotationObjectUpdater.color;
			this.objectOptionsLeftClick.comment = this.currentLeftAnnotationObjectUpdater.comment;
			return this.objectOptionsLeftClick;
		}
		this.objectOptionsRightClick.opacity = this.opacity.val();
		this.objectOptionsRightClick.fill = this.currentRightAnnotationObjectUpdater.color;
		this.objectOptionsRightClick.comment = this.currentRightAnnotationObjectUpdater.comment;
		return this.objectOptionsRightClick;
	},

	/****************************************************************************************************************
 
									 A N N O T A T I O N S (User driven Initializers and Updaters)
 
	 *****************************************************************************************************************/


	setFabricCanvasInteractivity: function (boolean) {
		this.overlay.fabricCanvas().forEachObject(function (object) {
			object.selectable = boolean;
		});
	},

	deselectFabricObjects: function () {
		this.overlay.fabricCanvas().deactivateAll().renderAll();
	},

	removeActiveObject: function () {
		let toRemove = this.overlay.fabricCanvas().getActiveObject();
		if (toRemove) {
			if (toRemove.type === "rect" || toRemove.type === "polygon" || toRemove.type === "ellipse") {
				this.overlay.fabricCanvas().remove(toRemove);
				this.history.push(null, toRemove);
				this.overlay.fabricCanvas().renderAll();
			} else if (toRemove) {
				this.overlay.fabricCanvas().remove(toRemove);

			}
		} else {
			this.messenger.show("Please select the annotation you would like to delete", 3000, this.messenger.MSG_INFO);
		}
	},

	// Get all objects from canvas
	deleteAllAnnotations: function () {
		var objects = openseadragon_image_annotations.overlay.fabricCanvas().getObjects();
		/* if objects is null, catch */
		if (objects.length == 0 || !confirm("Do you really want to delete all annotations?")) return;

		var objectsLength = objects.length
		for (var i = 0; i < objectsLength; i++) {
			this.history.push(null, objects[objectsLength - i - 1]);
			objects[objectsLength - i - 1].remove();
		}
	},

	turnAnnotationsOnOff: function (on) {
		var objects = this.overlay.fabricCanvas().getObjects();
		if (on) {
			this.showAnnotations = true;
			//set all objects as visible and unlock
			for (var i = 0; i < objects.length; i++) {
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
			for (var i = 0; i < objects.length; i++) {
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
		switch(mode) {
			case this.Modes.CUSTOM:
				PLUGINS.osd.setMouseNavEnabled(false);
				this.overlay.fabricCanvas().discardActiveObject(); //deselect active if present
				this._modesJqNode.val("alt-left");
				break;
			case this.Modes.FREE_FORM_TOOL:
				//dirty but when a mouse is clicked, for some reason active object is deselected
				this._cachedSelection = this.overlay.fabricCanvas().getActiveObject();
				this._modesJqNode.val("shift");
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
	},

	_setModeToAuto: function() {
		if (this.currentLeftAnnotationObjectUpdater) this.currentLeftAnnotationObjectUpdater.context.finishIndirect();
		if (this.currentRightAnnotationObjectUpdater) this.currentRightAnnotationObjectUpdater.context.finishIndirect();

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
		this._modesJqNode.val("auto");
	},

	//cursor management (TODO move here other stuff involving cursor too)
	// updater: function(mousePosition: OSD Point instance, cursorObject: object that is being shown underneath cursor)
	//todo not working
	cursor: {
		_visible: false,
		_updater: null,
		_node: null,
		_toolRadius: 0,

			/* Mouse touch related data */
		//TODO move to cursor class object
		mouseTime: 0, //OSD handler click timer
		isDown: false,  //FABRIC handler click down recognition
		//isOverObject: false,

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
			//this._node.css({display: "block", width: this._toolRadius+"px", height: this._toolRadius+"px"});
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
}; // end of namespace

Preset = function(obj=null, comment="", color="") {
	this.comment = comment;
	this.color = color;
	this.context = obj;
}
Preset.prototype = {
	getHTML: function(isLeftClick) {
		//todo instead type -> show name
		let comment = this.comment ? this.comment : this.context.type;
		return `<div class="border-md p-1 mx-2 rounded-3" style="border-width:3px!important;" onclick="openseadragon_image_annotations.showPresets(${isLeftClick});"><span class="material-icons" style="color: ${this.color}";>${this.context.getIcon()}</span>  ${comment}</div>`;
	},
	fromJSONFriendlyObject: function(parsedObject, parent) {
		switch(parsedObject.type) {
			case "rect": this.context = parent.rectangle; break;
			case "ellipse": this.context = parent.ellipse; break;
			case "polygon": this.context = parent.polygon; break;
			default: console.error("Invalid preset type.", parsedObject.type, "of", parsedObject); break;
		}
		this.comment = parsedObject.comment;
		this.color = parsedObject.color;
		return this;
	},
	toJSONFriendlyObject: function() {
		return {comment: this.comment, color: this.color, type: this.context.type};
	}
} // end of namespace Preset


Messenger = function () {
	this.MSG_INFO = { class: "", icon: '<path fill-rule="evenodd"d="M6.3 5.69a.942.942 0 0 1-.28-.7c0-.28.09-.52.28-.7.19-.18.42-.28.7-.28.28 0 .52.09.7.28.18.19.28.42.28.7 0 .28-.09.52-.28.7a1 1 0 0 1-.7.3c-.28 0-.52-.11-.7-.3zM8 7.99c-.02-.25-.11-.48-.31-.69-.2-.19-.42-.3-.69-.31H6c-.27.02-.48.13-.69.31-.2.2-.3.44-.31.69h1v3c.02.27.11.5.31.69.2.2.42.31.69.31h1c.27 0 .48-.11.69-.31.2-.19.3-.42.31-.69H8V7.98v.01zM7 2.3c-3.14 0-5.7 2.54-5.7 5.68 0 3.14 2.56 5.7 5.7 5.7s5.7-2.55 5.7-5.7c0-3.15-2.56-5.69-5.7-5.69v.01zM7 .98c3.86 0 7 3.14 7 7s-3.14 7-7 7-7-3.12-7-7 3.14-7 7-7z"/>' };
	this.MSG_WARN = { class: "Toast--warning", icon: '<path fill-rule="evenodd" d="M8.893 1.5c-.183-.31-.52-.5-.887-.5s-.703.19-.886.5L.138 13.499a.98.98 0 0 0 0 1.001c.193.31.53.501.886.501h13.964c.367 0 .704-.19.877-.5a1.03 1.03 0 0 0 .01-1.002L8.893 1.5zm.133 11.497H6.987v-2.003h2.039v2.003zm0-3.004H6.987V5.987h2.039v4.006z" />' };
	this.MSG_ERR = { class: "Toast--error", icon: '<path fill-rule="evenodd" d="M10 1H4L0 5v6l4 4h6l4-4V5l-4-4zm3 9.5L9.5 14h-5L1 10.5v-5L4.5 2h5L13 5.5v5zM6 4h2v5H6V4zm0 6h2v2H6v-2z" />' };
	this._timer = null;

	$("body").append(`<div id="annotation-messages-container" class="Toast popUpHide position-fixed" style='z-index: 5050; transform: translate(calc(50vw - 50%));'>
		  <span class="Toast-icon"><svg width="12" height="16"v id="annotation-icon" viewBox="0 0 12 16" class="octicon octicon-check" aria-hidden="true"></svg></span>
		  <span id="annotation-messages" class="Toast-content v-align-middle"></span>
		  <button class="Toast-dismissButton" onclick="openseadragon_image_annotations.messenger.hide(false);">
			<svg width="12" height="16" viewBox="0 0 12 16" class="octicon octicon-x" aria-hidden="true"><path fill-rule="evenodd" d="M7.48 8l3.75 3.75-1.48 1.48L6 9.48l-3.75 3.75-1.48-1.48L4.52 8 .77 4.25l1.48-1.48L6 6.52l3.75-3.75 1.48 1.48L7.48 8z"/></svg>
		  </button>
		  </div>`);

	this._body = $("#annotation-messages-container");
	this._board = $("#annotation-messages");
	this._icon = $("#annotation-icon");
}
Messenger.prototype = {
	show: function (text, delayMS, importance) {
		this._board.html(text);
		this._icon.html(importance.icon);
		this._body.removeClass(); //all
		this._body.addClass(`Toast position-fixed ${importance.class}`)
		this._body.removeClass("popUpHide");
		this._body.addClass("popUpEnter");

		if (delayMS > 1000) {
			this._timer = setTimeout(this.hide.bind(this), delayMS);
		}
	},

	hide: function (_autoCalled = true) {
		console.log("remove", this._body)
		this._body.removeClass("popUpEnter");
		this._body.addClass("popUpHide");

		if (!_autoCalled) {
			clearTimeout(this._timer);
		}
		this._timer = null;
	}
}  // end of namespace Messenger


/*------------ Initialization of OSD Annotations ------------*/
var openseadragon_image_annotations = new OSDAnnotations();
  
  
PLUGINS.osd.addHandler('open', function() {
	openseadragon_image_annotations.initialize({
		scale: PLUGINS.imageLayer.source.Image.Size.Width,
		fireRightClick: true
	});
});
  
  