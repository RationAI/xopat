
//TODO default size of regions: let the user to choose default size in pixels (e.g. probabilities layer!!!)
sleep = function (ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
};


OSDAnnotations = function(incoming) {
    this.DEFAULT_LEFT_LABEL = "Left Click";
	this.DEFAULT_RIGHT_LABEL = "Right Click";

	this.origX = "";
	this.origY = "";
	this.overlay = "";
	this.imageJson = ""; //json annotation file

	/*
	Global setting to show/hide annotations on default
	*/
	this.showAnnotations = true;
	/* Annotation property related data */
	this.currentAnnotationObject = "rect";
	this.currentAnnotationObjectUpdater = () => { }; //if user drags what function is being used to update
	this.annotationType = "rect";
	this.currentAnnotationColor = "#ff2200";
	this.leftClickColor = "#58994c";
	this.rightClickColor = "#d71818";
	this.leftClickLabel = "Left Click";
	this.rightClickLabel = "Right Click";
	this.alphaSensitivity = 65; //at what threshold the auto region outline stops

	/* Mouse touch related data */
	//TODO move to cursor class object
	this.mouseTime = 0; //OSD handler click timer
	this.isDown = false;   //FABRIC handler click down recognition
	this.isOverObject = false;

	 // Assign from incoming terms
	 for (var key in incoming) {
        this[key] = incoming[key];
    }
};

OSDAnnotations.prototype = {

	/*
	Initialize member variables
	*/
	initialize: function (imageJson, osdViewer, osdLayer, htmlForControlsID, options) {


		/* Initialize member variables */
		this.imageJson = imageJson;

		/* OSD values used by annotations */
		this.viewer = osdViewer;
		this.tiledImage = osdLayer;
		this.currentTile = "";

		

		this.overlay = this.viewer.fabricjsOverlay(options);

		this.setMouseOSDInteractive(true);

		// draw annotation from json file
		//todo try catch error MSG if fail
		// todo allow user to load his own annotations (probably to a separate layer)
		if (imageJson) {
			this.overlay.fabricCanvas().loadFromJSON(imageJson, this.overlay.fabricCanvas().renderAll.bind(this.overlay.fabricCanvas()));
		}

	


		//if (!openseadragon_image_annotations.showAnnotations) {
		//	$("#off").click();
			//openseadragon_image_annotations.turnAnnotationsOnOff(false); //already called
		//};

		$(`#${this.controlPanelId}`).append(`<div id="panel-annotations" class="inner-panel">
		<!--NOSELECT important due to interaction with slider, default height due to height adjustment later, TODO: set from cookies-->
		<div class="inner-panel-content noselect"  id="inner-panel-content-2">
  
		  
	  
		  <div class="imageAnnotationToolbarAndButtons">
			<div id="annotationButtonWrapper">
			  <div style="display: inline-block; width: 100%;">
  
				<span class="material-icons inline-pin"
				onclick="$(this).parents().eq(3).children().eq(1).toggleClass('force-visible'); $(this).toggleClass('pressed');"> push_pin </span>
				<h3 class="d-inline-block h3">Annotations&emsp;</h3>
  
				<span class="material-icons" onclick="$('#help').css('display', 'block');" title="Help" style="cursor: pointer;float: right;">help</span>
  
				<span class="material-icons" id="downloadAnnotation" title="Export annotations" style="cursor: pointer;float: right;">download</span>
				<!-- <button type="button" class="btn btn-secondary" autocomplete="off" id="downloadAnnotation">Download annotations</button> -->
				<!-- <button type="button" class="btn btn-secondary" autocomplete="off" id="sendAnnotation">Send</button> -->
  
  
				<span class="material-icons" title="Enable/disable annotations" style="cursor: pointer;float: right;" data-ref="on" onclick="
				if ($(this).attr('data-ref') === 'on'){
				  openseadragon_image_annotations.turnAnnotationsOnOff(false);
				  $(this).html('visibility_off');
				  $(this).attr('data-ref', 'off');
				} else {
				  openseadragon_image_annotations.turnAnnotationsOnOff(true);
				  $(this).html('visibility');
				  $(this).attr('data-ref', 'on');
				}"> visibility</span>
  
  
			 
				<br>Opacity:
				<br>
				<input type="range" id="opacity_control" min="0" max="1" value="0.4" step="0.1">
						  
			  </div>
			  <a id="download_link1" download="my_exported_file.json" href="" hidden>Download as json File</a>
			  <a id="download_link2" download="my_exported_file.xml" href="" hidden>Download as xml File</a>
	  
			
			</div>
		  </div>
  
  
		  <div id="imageAnnotationToolbar"  class="inner-panel-hidden">
			<div id="imageAnnotationToolbarContent">
	  
			  <!--populated with options for a given shader -->
	  
			</div>
		  </div>
  
		</div>
		<br><br>
	 
	
	  </div>
  
	  <div id="annotation-logger" class="inner-panel px-0 py-2" style="flex-grow: 3;">
		<div class="noselect" style="height: 100%;position: relative"  id="inner-panel-content-3">
		  <h3 class="pl-2 d-inline-block h3">Board</h4>
		  <span class="material-icons" style="color:gray; cursor: pointer;" onclick="openseadragon_image_annotations.history.back()" id="history-undo">undo</span>
		  <span class="material-icons" style="color:gray; cursor: pointer;" onclick="openseadragon_image_annotations.history.redo()" id="history-redo">redo</span>
		  
		  <button class="btn btn-danger mr-2 position-absolute right-2 top-0" type="button" aria-pressed="false" autocomplete="off" id="deleteAll">Delete All</button>
		 <br>
		  <div id="annotation-logs" class="height-full" style="cursor:pointer;overflow-y: overlay;"></div>
		   </div>
	  </div>
	</div>
  `);

$("body").append(`
<div id="help" class="position-fixed" style="z-index:99999; display:none; left: 50%;top: 50%;transform: translate(-50%,-50%);">
<details-dialog class="Box Box--overlay d-flex flex-column anim-fade-in fast" style=" max-width:700px; max-height: 600px;">
    <div class="Box-header">
      <button class="Box-btn-octicon btn-octicon float-right" type="button" aria-label="Close help" onclick="$('#help').css('display', 'none');">
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
      <p><b>Automatic tool treshold</b> is the sensitivity of automatic selection: when minimized, the shape will take all surrounding areas. When set high, only the most prominent areas
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
		

	//form for object property modification
		$("body").append(
			`<div id="input_form" style="display:none">
			<table>
			<tr>
				<td>category</td>
				<td>
				<select id="annotation_group" tabindex="2" name="Group">
					<option value="None" selected>None</option>
					<option value="Carcinoma">Carcinoma</option>
					<option value="Exclude">Exclude</option>
					<option value="Another pathology">Another pathology</option>
				</select>
				</td>
			</tr>
			<tr>
				<td>treshold</td>
				<td id="annotation_threshold">1</td>
			</tr>
			<tr>
				<td colspan="2"><textarea id="annotation_comment" placeholder="Add a comment..." name="text" rows="2" tabindex="3"></textarea></td>
			</tr>
			</table>
		</div><div id="annotation-cursor" style="border: 2px solid black;border-radius: 50%;position: absolute;transform: translate(-50%, -50%);pointer-events: none;display:none;"></div>
		`);

			this.cursor.init();
	this.history.init();
	this.messenger.init();
		this.annotationForm = $("#input_form");

		$(`#${htmlForControlsID}`).append(this.complexAnnotationControl()); 

	  
		/****************************************************************************************************************
	
												 E V E N T  L I S T E N E R S: FABRIC
	
		*****************************************************************************************************************/



		/*
		mouse:down event listener
		On mousedown:
			- mark isDown as true. On mouse:up, we draw annotations if isDown is true.
			- set origX, origY as the initial click location.
			- initialize the correct function based on what the currentAnnotationType is.
			*/
		// this.overlay.fabricCanvas().observe('mouse:down', function(o) {
		// 	//todo prevent clicking both buttons simultaneously, some mode which tells which key is active adn allow that one only
		// 	if (!openseadragon_image_annotations.showAnnotations) return;
		// 	openseadragon_image_annotations.mouseTime = Date.now();
			
		// 	if (o.button === 1) fabricHandleLeftClickDown(o);
		// 	else if (o.button === 3) fabricHandleRightClickDown(o);
		// });

		$('.upper-canvas').mousedown(function(event) {
			if (!openseadragon_image_annotations.showAnnotations || openseadragon_image_annotations.viewer.isMouseNavEnabled()) return;
			openseadragon_image_annotations.mouseTime = Date.now();
			
			if (event.which === 1) fabricHandleLeftClickDown(event);
			else if (event.which === 3) fabricHandleRightClickDown(event);
		});

		function fabricHandleRightClickDown(o) {
			console.log("fabric right mouse down");
			if (openseadragon_image_annotations.isMouseOSDInteractive()) {
				handleFabricKeyDownInOSDMode(o, false);
			}
		}

		function fabricHandleLeftClickDown(o) {
			console.log("fabric mouse down");
			
			if (openseadragon_image_annotations.isMouseOSDInteractive())  {
				handleFabricKeyDownInOSDMode(o, true);
			} else {
				handleFabricKeyDownInEditMode(o);
			}
		}

		function handleFabricKeyDownInOSDMode(o, isLeftClick) {
			var pointer = openseadragon_image_annotations.overlay.fabricCanvas().getPointer(o);

			if (o.altKey) { 

				openseadragon_image_annotations.currentAnnotationObject = { type: openseadragon_image_annotations.annotationType, isLeftClick: isLeftClick };
				openseadragon_image_annotations.overlay.fabricCanvas().discardActiveObject(); //deselect active if present
				openseadragon_image_annotations.overlay.fabricCanvas().renderAll();

				this.currentAnnotationObjectUpdater = null; 
				switch (openseadragon_image_annotations.annotationType) {
					case 'polygon':
						openseadragon_image_annotations.polygonClickAction(o, pointer.x, pointer.y);
						return; //no mouse motion tracking	 
					case 'rect':
						openseadragon_image_annotations.initializeRectangle(pointer.x, pointer.y);
						break;
					case 'ellipse':
						openseadragon_image_annotations.initializeEllipse(pointer.x, pointer.y);
						break;
					default:
						return; //other types not support, no mouse motion tracking
				}	
					
			} else if (o.shiftKey) { //shift key, let fabric.js mouse track do the job (need disabled OSD navigation)
			
				openseadragon_image_annotations.currentAnnotationObject = null; //  IMPORTANT!
				let currentObject = openseadragon_image_annotations.overlay.fabricCanvas().getActiveObject();
				if (!currentObject) {
					openseadragon_image_annotations.messenger.show("No selected target to append to.", 2000, openseadragon_image_annotations.messenger.MSG_WARN);
					return;
				}

				openseadragon_image_annotations.modifyTool.init(currentObject, openseadragon_image_annotations.toScreenCoords(pointer.x, pointer.y), 100, isLeftClick);
				openseadragon_image_annotations.modifyTool.update(pointer);				
			} else {
				//problem when click on cavas and the browser is not in focus, prevent current selection from removal
				openseadragon_image_annotations.currentAnnotationObject = null; //  IMPORTANT!
			}

			openseadragon_image_annotations.isDown = true;
			openseadragon_image_annotations.origX = pointer.x;
			openseadragon_image_annotations.origY = pointer.y;	
		}

		function handleFabricKeyDownInEditMode(o) {
			// openseadragon_image_annotations.isDown = true;

			// if (!o.target) return;

			// if (o.target && o.target.type == "polygon" && openseadragon_image_annotations.polygon.currentlyEddited != o.target) {
			// 	//edit polygon only if new one selected
			// 	if (openseadragon_image_annotations.polygon.currentlyEddited) {
			// 		//save if switch to other polygon
			// 		openseadragon_image_annotations.polygon.generatePolygon(openseadragon_image_annotations.polygon.pointArray);
			// 	}
			// 	//init another
			// 	console.log("init")
			// 	var polygon = openseadragon_image_annotations.overlay.fabricCanvas().getActiveObject();
			// 	openseadragon_image_annotations.initializeEditPolygon(polygon);
			// 	openseadragon_image_annotations.set_input_form(o.target);
			// 	$("#input_form").show();
			// } else if (o.target.type == "rect" || o.target.type == "ellipse" || o.target.type == "polygon") {
			// 	openseadragon_image_annotations.set_input_form(o.target);
			// 	$("#input_form").show();
			// }

			// openseadragon_image_annotations.isDown = true;
			// openseadragon_image_annotations.origX = pointer.x;
			// openseadragon_image_annotations.origY = pointer.y;
		}

		/*
			Handle fabric mouse up event
			 - when holding ALT key, OSD is temporarily disabled and this handler fires
			 - when in editing mode, OSD is disabled and this handler fires
		*/
		// this.overlay.fabricCanvas().on('mouse:up', function(o) {
		// 	if (!openseadragon_image_annotations.showAnnotations || !openseadragon_image_annotations.isDown) return;
		// 	console.log("fabric mouse up")

		// 	openseadragon_image_annotations.isDown = false;			

		// 	if (o.button === 1) fabricHandleLeftClickUp(o);
		// 	else if (o.button === 3) fabricHandleRightClickUp(o);
		// });

		$('.upper-canvas').mouseup(function (event) {
			if (!openseadragon_image_annotations.showAnnotations || openseadragon_image_annotations.viewer.isMouseNavEnabled()) return;
			//if (openseadragon_image_annotations.isMouseOSDInteractive() && (!event.ctrlKey || !event.altKey || !event.shiftKey)) return;
			openseadragon_image_annotations.isDown = false;	
			
			console.log("UP");

			if (event.which === 1) fabricHandleLeftClickUp(event);
			else if (event.which === 3) fabricHandleRightClickUp(event);
		});
		
		function fabricHandleRightClickUp(o) {
			if (openseadragon_image_annotations.isMouseOSDInteractive()) {
				handleFabricKeyUpInOSDMode(o);
			}
		}

		function fabricHandleLeftClickUp(o) {
			if (openseadragon_image_annotations.isMouseOSDInteractive())  {
				handleFabricKeyUpInOSDMode(o);
			} else {
				handleFabricKeyUpInEditMode(o);
			}
		}

		function handleFabricKeyUpInOSDMode(o) {
			openseadragon_image_annotations.isDown = false;
			openseadragon_image_annotations.viewer.setMouseNavEnabled(true);
			let delta = Date.now() - openseadragon_image_annotations.mouseTime;

			if (o.altKey) { 

				if (!openseadragon_image_annotations.currentAnnotationObject) return;

				if (delta < 100) { // if click too short, user probably did not want to create such object, discard
					//TODO this deletes created elements if wrong event registered (sometimes)
					switch (openseadragon_image_annotations.currentAnnotationObject.type) {
						case 'rect':
						case 'ellipse': //clean
							console.log("REMOVED OBJECT WITHOUT HISTORY");
							openseadragon_image_annotations.overlay.fabricCanvas().remove(openseadragon_image_annotations.currentAnnotationObject);
							return;
						case 'polygon': 
						default:
							return;
					}					
				}
				
				switch (openseadragon_image_annotations.currentAnnotationObject.type) {
					case 'rect':
					case 'ellipse':
						//openseadragon_image_annotations.overlay.fabricCanvas().remove(openseadragon_image_annotations.currentAnnotationObject)
						//openseadragon_image_annotations.overlay.fabricCanvas().add(openseadragon_image_annotations.currentAnnotationObject);
						openseadragon_image_annotations.history.push(openseadragon_image_annotations.currentAnnotationObject);
						openseadragon_image_annotations.overlay.fabricCanvas().renderAll();
						openseadragon_image_annotations.overlay.fabricCanvas().setActiveObject(openseadragon_image_annotations.currentAnnotationObject);
						// openseadragon_image_annotations.set_input_form(openseadragon_image_annotations.currentAnnotationObject);
						// $("#input_form").show();
						openseadragon_image_annotations.currentAnnotationObject = "";
						break;
					case 'polygon': //no action, polygon is being created by click 
					default:
						break;
				}
					
			} else if (o.shiftKey) { 
				let result = openseadragon_image_annotations.modifyTool.finish();
				if (result) openseadragon_image_annotations.overlay.fabricCanvas().setActiveObject(result);
			}
		}

		function handleFabricKeyUpInEditMode(isLeftClick) {
			//useful... or delete?
		}


		/*
			Update object when user hodls ALT and moving with mouse (openseadragon_image_annotations.isMouseOSDInteractive() == true)
		*/
		this.overlay.fabricCanvas().on('mouse:move', function (o) {
			if (!openseadragon_image_annotations.showAnnotations) return;

			var pointer = openseadragon_image_annotations.overlay.fabricCanvas().getPointer(o.e);

			if (!openseadragon_image_annotations.isDown) return;

			if (openseadragon_image_annotations.key_code === "AltLeft") {
				if (openseadragon_image_annotations.isMouseOSDInteractive() && openseadragon_image_annotations.currentAnnotationObjectUpdater) {
					openseadragon_image_annotations.currentAnnotationObjectUpdater(pointer.x, pointer.y);
					openseadragon_image_annotations.overlay.fabricCanvas().renderAll();
				}
			} else if (openseadragon_image_annotations.key_code === "ShiftLeft") {
				openseadragon_image_annotations.modifyTool.update(pointer);
			} else if (openseadragon_image_annotations.key_code === "AltRight") {
				if (openseadragon_image_annotations.isMouseOSDInteractive() && !openseadragon_image_annotations.currentAnnotationObjectUpdater) {
					openseadragon_image_annotations.currentAnnotationObjectUpdater(pointer.x, pointer.y);
					openseadragon_image_annotations.overlay.fabricCanvas().renderAll();
				}
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
				openseadragon_image_annotations.editPolygon(o.target);
				openseadragon_image_annotations.overlay.fabricCanvas().renderAll();
			}
		});

		/*
		 mouse:over event listener
		 if mouse is over polygon or rectangle and polygon is not being edited
		 and no other annotation is selected, show input form
				 */
		// this.overlay.fabricCanvas().on('mouse:over', function (o) {
		// 	if (!openseadragon_image_annotations.showAnnotations) return;

		// 	if (!openseadragon_image_annotations.isMouseOSDInteractive()) {
		// 		openseadragon_image_annotations.isOverObject = true;
		// 		console.log("fabric object over")

		// 		if (o.target && (o.target.type == "rect" || o.target.type == "polygon") && !(openseadragon_image_annotations.polygon.polygonBeingCreated) && !(openseadragon_image_annotations.overlay.fabricCanvas().getActiveObject())) {
		// 			var annotation = o.target;
		// 			openseadragon_image_annotations.set_input_form(annotation);
		// 			$("#input_form").show();
		// 		};
		// 	}
		// });

		/*
		 mouse:out event listener
		 when mouse leaves the annotation hide imput form
		 (only if anootation is not selected in edit mode !, then input form should stay so it can be edited,
	   it will be hidden after edit mode is cancelled of annotation id deselected)
				 */
		// this.overlay.fabricCanvas().on('mouse:out', function (o) {
		// 	if (!openseadragon_image_annotations.showAnnotations) return;

		// 	openseadragon_image_annotations.isOverObject = false;
		// 	console.log("fabric object out")

		// 	if (!(openseadragon_image_annotations.isMouseOSDInteractive() && openseadragon_image_annotations.overlay.fabricCanvas().getActiveObject())) {
		// 		$("#input_form").hide();
		// 	};
		// });

		/*
			selection:cleared
			 hide input form when annotaion is deselected
					*/

		this.overlay.fabricCanvas().on('selection:cleared', function (e) {
			if (!openseadragon_image_annotations.showAnnotations || openseadragon_image_annotations.isMouseOSDInteractive()) return;
			$("#input_form").hide();
		});

		// this.overlay.fabricCanvas().on('before:selection:cleared', function(e) {
		// 	console.log("DELSELETCL", e);
		// 	if(e && e.target){
		// 		//e.target.set('shadow',null);
		// 		e.target.hasControls = !openseadragon_image_annotations.isMouseOSDInteractive();
		// 	} 
		// });

		this.overlay.fabricCanvas().on('object:selected',function(e){
			if(e && e.target){
				//e.target.set('shadow', { blur: 30, offsetX: 0, offsetY: 0});
				openseadragon_image_annotations.history.highlight(e.target);
				e.target.hasControls = !openseadragon_image_annotations.isMouseOSDInteractive();
			}  
		});
		
		
		/****************************************************************************************************************

											 E V E N T  L I S T E N E R S: OSD (clicks without alt or shift)
						OpenSeadragon listeners for adding annotation in navigation mode, can
						temporarily disable the navigation when a key is held to allow user-driven
						object creation, default is automatic creation

		*****************************************************************************************************************/

		this.viewer.addHandler("canvas-press", function (e) {
			if (!openseadragon_image_annotations.showAnnotations) return;
			openseadragon_image_annotations.mouseTime = Date.now();

			//if clicked on object, highlight it
			openseadragon_image_annotations.currentAnnotationObject = openseadragon_image_annotations.overlay.fabricCanvas().findTarget(e.originalEvent);
			if (openseadragon_image_annotations.currentAnnotationObject) {
				openseadragon_image_annotations.overlay.fabricCanvas().setActiveObject(openseadragon_image_annotations.currentAnnotationObject);
				openseadragon_image_annotations.mouseTime = 0;
				return;
			}

			//else create automated version of openseadragon_image_annotations.annotationType object
			openseadragon_image_annotations.currentAnnotationObject = { type: openseadragon_image_annotations.annotationType, isLeftClick: true };
		});

		this.viewer.addHandler("canvas-release", function (e) {
			if (!openseadragon_image_annotations.showAnnotations) return;

			let delta = Date.now() - openseadragon_image_annotations.mouseTime;
			if (delta > 100) return; // just navigate if click longer than 100ms

			switch (openseadragon_image_annotations.currentAnnotationObject.type) {
				case 'rect':
					openseadragon_image_annotations.createApproxRectangle(e.position);
					break;
				case 'ellipse':
					openseadragon_image_annotations.createApproxEllipse(e.position);
					break;
				case 'polygon': 
					openseadragon_image_annotations.createRegionGrowingOutline(e.position);
					break;
				default:
					break;
			}
		});

		this.viewer.addHandler("canvas-nonprimary-press", function (e) {
			if (!openseadragon_image_annotations.showAnnotations) return;

			if (e.button != 2 || e.originalEvent.shiftKey || e.originalEvent.altKey) return; //plain right click only
			openseadragon_image_annotations.mouseTime = Date.now();
			openseadragon_image_annotations.currentAnnotationObject = { type: openseadragon_image_annotations.annotationType, isLeftClick: false};
		});

		this.viewer.addHandler("canvas-nonprimary-release", function (e) {
			if (!openseadragon_image_annotations.showAnnotations) return;

			let delta = Date.now() - openseadragon_image_annotations.mouseTime;
			if (delta > 100) return; // just navigate if click longer than 100ms

			switch (openseadragon_image_annotations.currentAnnotationObject.type) {
				case 'rect':
					openseadragon_image_annotations.createApproxRectangle(e.position);
					break;
				case 'ellipse':
					openseadragon_image_annotations.createApproxEllipse(e.position);
					break;
				case 'polygon': 
					openseadragon_image_annotations.createRegionGrowingOutline(e.position);
				break;
				default:
					break;
			}
		});

		/****************************************************************************************************************

											 E V E N T  L I S T E N E R S: GENERAL

		*****************************************************************************************************************/



		$(this.viewer.element).on('contextmenu', function(event) {
			event.preventDefault();
		}); 

		document.addEventListener('keydown', (e) => {
			if (!openseadragon_image_annotations.showAnnotations || !openseadragon_image_annotations.isMouseOSDInteractive()) return;
			if (e.code === "AltLeft") {
				openseadragon_image_annotations.viewer.setMouseNavEnabled(false);
			} else if (e.code === "ShiftLeft") {
				openseadragon_image_annotations.viewer.setMouseNavEnabled(false);
				openseadragon_image_annotations.overlay.fabricCanvas().defaultCursor = "crosshair";
				openseadragon_image_annotations.overlay.fabricCanvas().hoverCursor = "crosshair";
				//todo value of radius from user
				// openseadragon_image_annotations.modifyTool.setRadius(100); //so that cursor radius that is being taken from here will be correct before midify tool init

				openseadragon_image_annotations.cursor.show();
			} else if (e.code === "AltRight") {
				openseadragon_image_annotations.setMouseOSDInteractive(false);
			}
			openseadragon_image_annotations.key_code = e.code;
				
		});

		document.addEventListener('keyup', (e) => {
			
			openseadragon_image_annotations.key_code = null;
			if (!openseadragon_image_annotations.showAnnotations) return;	
			
			if (!openseadragon_image_annotations.isMouseOSDInteractive()) {
				if (e.code === "AltRight") {
					openseadragon_image_annotations.setMouseOSDInteractive(true);
					let active = this.overlay.fabricCanvas().getActiveObject();
					if (active) active.hasControls = false;
				}
			} else {
				if (e.code === "Delete") {
					openseadragon_image_annotations.removeActiveObject();
					openseadragon_image_annotations.currentAnnotationObject = null;
				}
	
				//todo delete valid in both modes?
				//if (!openseadragon_image_annotations.isMouseOSDInteractive()) return;
	
				if (e.ctrlKey && e.code === "KeyY") {
					if (e.shiftKey) openseadragon_image_annotations.history.redo();
					else openseadragon_image_annotations.history.back();
				} else if (e.code === "AltLeft") {
					if (!openseadragon_image_annotations.isDown) {
						//ALTHOUGH mouse nav enabled in click up in FABRIC, not recognized if alt key down when releasing -- do it here
						openseadragon_image_annotations.viewer.setMouseNavEnabled(true);
					}
	
					if (this.polygon.polygonBeingCreated) {
						this.polygon.generatePolygon(this.polygon.pointArray);
						openseadragon_image_annotations.viewer.setMouseNavEnabled(true);
					}
				} else if (e.code === "ShiftLeft") {
					if (!openseadragon_image_annotations.isDown) {
						//ALTHOUGH mouse nav enabled in click up in FABRIC, not recognized if alt key down when releasing -- do it here
						
						openseadragon_image_annotations.overlay.fabricCanvas().defaultCursor = "crosshair";
						openseadragon_image_annotations.overlay.fabricCanvas().hoverCursor = "pointer";
						openseadragon_image_annotations.viewer.setMouseNavEnabled(true);
						openseadragon_image_annotations.cursor.hide();
					}
				}
			}

			
		});



		// listen for annotation send button
		$('#sendAnnotation').click(function (event) {
			console.log("sending");
			//generate ASAPXML annotations
			var doc = generate_ASAPxml(openseadragon_image_annotations.overlay.fabricCanvas()._objects);
			var xml_text = new XMLSerializer().serializeToString(doc);

			// get file name from probabilities layer (axperiment:slide)
			var probabs_url_array = openseadragon_image_annotations.viewer.tileSources[2].split("=")[1].split("/");
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
			return doc
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
		$("#opacity_control").on("input", function () {
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
				openseadragon_image_annotations.set_input_form(o.target);
				$("#input_form").show();

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
			var modified_polygon = this.createPolygon(transformedPoints);
			// remove orignal polygon and replace it with modified one
			canvas.remove(original_polygon);
			canvas.add(modified_polygon).renderAll();
			// TODO keep HISTORY in edit mode?
			// openseadragon_image_annotations.history.push(modified_polygon, original_polygon);
			// openseadragon_image_annotations.history.highlight(modified_polygon)


			//todo what about setting active control points correctly? maybe not possible with ctrl, so default is not show
			canvas.setActiveObject(modified_polygon);
			openseadragon_image_annotations.set_input_form(modified_polygon);
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

	getJSONContent: function() {
		return JSON.stringify(openseadragon_image_annotations.overlay.fabricCanvas().toObject(['comment', 'a_group', 'threshold']));
	},

	/****************************************************************************************************************
	
											 HTML ANNOTATIONS: AWAILABLE CONTROLS
	
	*****************************************************************************************************************/
	complexAnnotationControl: function () {
		openseadragon_image_annotations.annotationType = "rect";

		return `Brush:<br>
			<div id="imageToolbarRow2">
				<div class="radio-group">

					  <button class="btn" type="button" name="annotationType" id="rectangle" autocomplete="off" value="rect" checked onclick="openseadragon_image_annotations.annotationType='rect';"><span class="material-icons"> crop_5_4 </span></button>
	
						<button class="btn" type="button" name="annotationType" id="ellipse" autocomplete="off" value="ellipse" onclick="openseadragon_image_annotations.annotationType='ellipse';"><span class="material-icons"> panorama_fish_eye </span></button>
						<button class="btn" type="button" name="annotationType" id="polygon" autocomplete="off" value="polygon" onclick="openseadragon_image_annotations.annotationType='polygon';"><span class="material-icons"> share </span></button>
			
							  
				</div>
			</div>
	  
			<div class="input-group">
			  <input type="text" class="form-control"  style="max-width:75%" value="${openseadragon_image_annotations.leftClickLabel}" onchange="openseadragon_image_annotations.leftClickLabel = $(this).val();" title="Default comment for left mouse button." >
			  <input type="color" id="leftClickColor" class="form-control input-lm input-group-button" style="max-width:45px; height:32px;" name="leftClickColor" value="${openseadragon_image_annotations.leftClickColor}" onchange="openseadragon_image_annotations.setColor($(this).val(), 'leftClickColor');">
			</div>
			<div class="input-group">
			<input type="text" class="form-control" style="max-width:75%" value="${openseadragon_image_annotations.rightClickLabel}" onchange="openseadragon_image_annotations.rightClickLabel = $(this).val();" title="Default comment for right mouse button." >
			  <input type="color" id="rightClickColor" class="form-control input-lm input-group-button" style="max-width:45px; height:32px;"  height:100%;"name="rightClickColor" value="${openseadragon_image_annotations.rightClickColor}" onchange="openseadragon_image_annotations.setColor($(this).val(), 'rightClickColor');">
			  </div>
			<br>
			<p1>Automatic tool threshold:</p1>
			<input title="What is the threshold under which automatic tool refuses to select." type="range" id="sensitivity_auto_outline" min="0" max="100" value="${openseadragon_image_annotations.alphaSensitivity}" step="1" onchange="openseadragon_image_annotations.setAutoOutlineSensitivity($(this).val());">
			`;
	},


	// simpleAnnotationControl: function () {
	// 	openseadragon_image_annotations.annotationType = "polygon";
	// 	openseadragon_image_annotations.setMouseOSDInteractive(true);
	// 	//todo left/right click should pass the value to the object info
	// 	return `
	// 		<p1>Automatic tool threshold:</p1>
	// 		<input title="What is the threshold under which automatic tool refuses to select."  type="range" id="sensitivity_auto_outline" min="0" max="100" value="${openseadragon_image_annotations.alphaSensitivity}" step="1" onchange="openseadragon_image_annotations.setAutoOutlineSensitivity($(this).val());">
	// 		<br>
	// 		<label><input type="text" style="max-width:75%" value="${openseadragon_image_annotations.leftClickLabel}" onchange="openseadragon_image_annotations.leftClickLabel = $(this).val();" title="Default comment for left mouse button." >
	// 		  <input type="color" id="leftClickColor" name="leftClickColor" value="${openseadragon_image_annotations.leftClickColor}" onchange="openseadragon_image_annotations.setColor($(this).val(), 'leftClickColor');">
	// 		</label>
	// 		<label><input type="text" style="max-width:75%" value="${openseadragon_image_annotations.rightClickLabel}" onchange="openseadragon_image_annotations.rightClickLabel = $(this).val();" title="Default comment for right mouse button." >
	// 		  <input type="color" id="rightClickColor" name="rightClickColor" value="${openseadragon_image_annotations.rightClickColor}" onchange="openseadragon_image_annotations.setColor($(this).val(), 'rightClickColor');">
	// 		</label>
	// 		`;
	// },

	/****************************************************************************************************************

									S E T T E R S, GETTERS

	*****************************************************************************************************************/

	// set color for future annotation and change color of selected one
	setColor: function (color, name = "currentAnnotationColor") {
		openseadragon_image_annotations[name] = color; //convert to hex

		//TODO now not possible to change already created color, do we want to have that possibiltiy or not?
		// var annotation = openseadragon_image_annotations.overlay.fabricCanvas().getActiveObject();
		// if (annotation) {
		// 	annotation.set({ fill: openseadragon_image_annotations[name] });
		// 	openseadragon_image_annotations.overlay.fabricCanvas().renderAll();
		// }
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
			this.viewer.setMouseNavEnabled(true);
			$("#input_form").hide();
			this.overlay.fabricCanvas().defaultCursor = "crosshair";
			this.overlay.fabricCanvas().hoverCursor = "pointer";

			if (this.polygon.currentlyEddited) {
				//save if eddited
				this.polygon.generatePolygon(this.polygon.pointArray);
			}

			let active = this.overlay.fabricCanvas().getActiveObject();
			if (active) {
				active.hasControls = false;
			}

		} else {
			//this.setFabricCanvasInteractivity(true);
			this.viewer.setMouseNavEnabled(false);
			this.overlay.fabricCanvas().defaultCursor = "auto";
			this.overlay.fabricCanvas().hoverCursor = "move";

			let active = this.overlay.fabricCanvas().getActiveObject();
			if (active) {
				active.hasControls = true;
				if (active.type == "polygon") this.initializeEditPolygon(active);
				this.set_input_form(active);
				//$("#input_form").show();
			}
		}
		this.overlay.fabricCanvas().renderAll();
		this.mouseOSDInteractive = isOSDInteractive;
	},

	isMouseOSDInteractive: function () {
		return this.mouseOSDInteractive;
	},

	removeActiveObject: function() {
		let toRemove = this.overlay.fabricCanvas().getActiveObject();
		if (toRemove) {
			if (toRemove.type === "rect" || toRemove.type === "polygon" || toRemove.type === "ellipse") {
				this.overlay.fabricCanvas().remove(toRemove); 
				this.history.push(null, toRemove);
				this.overlay.fabricCanvas().renderAll();
			} else if (toRemove) {
				this.overlay.fabricCanvas().remove(toRemove); 
			
			} 
		}
	},

	/****************************************************************************************************************

									A N N O T A T I O N S (Automatic)

	*****************************************************************************************************************/

	//todo generic function that creates object? kinda copy paste
	createApproxEllipse: function (eventPosition) {
		let bounds = this._getSimpleApproxObjectBounds(eventPosition);
		this.currentAnnotationObject = this.createEllipse(bounds.left.x, bounds.top.y, (bounds.right.x - bounds.left.x) / 2, (bounds.bottom.y - bounds.top.y) / 2);
		this.currentAnnotationObjectUpdater = this.updateEllipseDimens;
		this.overlay.fabricCanvas().add(this.currentAnnotationObject);
		this.history.push(this.currentAnnotationObject);
		this.overlay.fabricCanvas().setActiveObject(this.currentAnnotationObject);
		this.overlay.fabricCanvas().renderAll();
	},

	createApproxRectangle: function (eventPosition) {
		let bounds = this._getSimpleApproxObjectBounds(eventPosition);
		this.currentAnnotationObject = this.createRectangle(bounds.left.x, bounds.top.y, bounds.right.x - bounds.left.x, bounds.bottom.y - bounds.top.y);
		this.currentAnnotationObjectUpdater = this.updateRectangleWidth;
		this.overlay.fabricCanvas().add(this.currentAnnotationObject);
		this.history.push(this.currentAnnotationObject);
		this.overlay.fabricCanvas().setActiveObject(this.currentAnnotationObject);
		this.overlay.fabricCanvas().renderAll();
	},

	createOutline: async function (eventPosition) {
		console.log("called outline");

		var viewportPos = this.viewer.viewport.pointFromPixel(eventPosition);
		//var imagePoint = tiledImage.viewportToImageCoordinates(viewportPos);
		var originPoint = this.viewer.viewport.pixelFromPoint(viewportPos);
		this.changeTile(viewportPos);

		//todo unused, maybe round origin point...?
		// eventPosition.x = Math.round(eventPosition.x);
		// eventPosition.y = Math.round(eventPosition.y);


		let points = new Set();
		this.comparator = function (pix) {
			return (pix[3] > this.alphaSensitivity && (pix[0] > 200 || pix[1] > 200));
		}

		var x = originPoint.x;  // current x position
		var y = originPoint.y;  // current y position
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

		surroundingInspector = function(x, y, maxDist) {
			for (var i = 1; i <= maxDist; i++) {
				$("#osd").append(`<span style="position:absolute; top:${y+i}px; left:${x+i}px; width:5px;height:5px; background:red;" class="to-delete"></span>`);

				if ( openseadragon_image_annotations.isValidPixel(new OpenSeadragon.Point(x + i, y)) > 0) return [x+i, y+i];
				$("#osd").append(`<span style="position:absolute; top:${y-i}px; left:${x+i}px; width:5px;height:5px; background:red;" class="to-delete"></span>`);

				if ( openseadragon_image_annotations.isValidPixel(new OpenSeadragon.Point(x, y + i)) > 0) return [x+i, y-i];
				$("#osd").append(`<span style="position:absolute; top:${y+i}px; left:${x-i}px; width:5px;height:5px; background:red;" class="to-delete"></span>`);

				if ( openseadragon_image_annotations.isValidPixel(new OpenSeadragon.Point(x - i, y)) > 0) return [x-i, y+i];
				$("#osd").append(`<span style="position:absolute; top:${y-i}px; left:${x-i}px; width:5px;height:5px; background:red;" class="to-delete"></span>`);

				if ( openseadragon_image_annotations.isValidPixel(new OpenSeadragon.Point(x, y + i)) > 0) return [x-i, y-i];

			}
			return null;
		};

		let maxLevel = this.tiledImage.source.maxLevel;
		let level = this.currentTile.level;
		let maxSpeed = 24;
		let speed = Math.round(maxSpeed / Math.max(1, 2 * (maxLevel - level)));

		var counter = 0;
		while ((Math.abs(first_point.x - x) > 2 || Math.abs(first_point.y - y) > 2) || counter < 20) {
			let mark = this.getAreaStamp(x, y);
			if (mark == 0 || mark == 15) {
				let findClosest = surroundingInspector(x, y, 2*speed);
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

		this.currentAnnotationObject = this.createPolygon(Array.from(points));
		this.overlay.fabricCanvas().add(this.currentAnnotationObject);
		this.history.push(this.currentAnnotationObject);
		this.overlay.fabricCanvas().setActiveObject(this.currentAnnotationObject);
		this.overlay.fabricCanvas().renderAll();

		$(".to-delete").remove();
	},

	createRegionGrowingOutline: function (eventPosition) {

		var viewportPos = this.viewer.viewport.pointFromPixel(eventPosition);
		var originPoint = this.viewer.viewport.pixelFromPoint(viewportPos);
		this.changeTile(viewportPos);

		let points = [];
		this.comparator = function (pix) {
			return (pix[3] > this.alphaSensitivity && (pix[0] > 200 || pix[1] > 200));
		}

		var x = originPoint.x;
		var y = originPoint.y;

		let origPixel = this.getPixelData(eventPosition);
		if (!this.comparator(origPixel)) {
			this.messenger.show("Outside a region - decrease sensitivity to select.", 2000, this.messenger.MSG_INFO);
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
		//speed based on ZOOM level (detailed tiles can go with rougher step)
		let maxLevel = this.tiledImage.source.maxLevel;
		let level = this.currentTile.level;
		let maxSpeed = 24;
		let speed = Math.round(maxSpeed / Math.max(1, 2 * (maxLevel - level)));

		//	After each step approximate max distance and abort if too small

		//todo same points evaluated multiple times seems to be more stable, BUT ON LARGE CANVAS!!!...

		var maxX=0, maxY=0;
		this._growRegionInDirections(x - 1, y, [-1, 0], [[0, -1], [0, 1]], points, speed, this.isValidPixel.bind(this));
		maxX = Math.max(maxX, Math.abs(x - points[points.length-1].x));
		maxY = Math.max(maxY, Math.abs(y - points[points.length-1].y));
		this._growRegionInDirections(x + 1, y, [1, 0], [[0, -1], [0, 1]], points, speed, this.isValidPixel.bind(this));
		maxX = Math.max(maxX, Math.abs(x - points[points.length-1].x));
		maxY = Math.max(maxY, Math.abs(y - points[points.length-1].y));
		this._growRegionInDirections(x, y + 1, [0, -1], [ [-1, 0],  [1, 0]], points, speed, this.isValidPixel.bind(this));
		maxX = Math.max(maxX, Math.abs(x - points[points.length-1].x));
		maxY = Math.max(maxY, Math.abs(y - points[points.length-1].y));
		this._growRegionInDirections(x, y - 1, [0, 1], [ [-1, 0],  [1, 0]], points, speed, this.isValidPixel.bind(this));
		maxX = Math.max(maxX, Math.abs(x - points[points.length-1].x));
		maxY = Math.max(maxY, Math.abs(y - points[points.length-1].y));

		if (maxX < 10 || maxY < 10) {
			this.messenger.show("Failed to create region.", 3000, this.messenger.MSG_WARN);
			return;
		}

		// this._bitArray.clear();
		// let startIdx = this._bitArray.startXY();
		// this._growRegion(x, y, startIdx, startIdx, this._bitArray, points, speed, this.isValidPixel.bind(this));
		//// this._bitArray.drawXY(500, 500, 900, 700);

		points = hull(points, 2*speed);
		let p1=points[0]; p2=points[1];
		let result = [this.toGlobalPointXY(p1[0], p1[1])];

		for (var i = 2; i < points.length; i++) {
			//three consecutive points on a line, discard
			if ((Math.abs(p1[0] - p2[0]) < 2 && Math.abs(points[i][0] - p2[0]) < 2)
			 || (Math.abs(p1[1] - p2[1]) < 2 && Math.abs(points[i][1] - p2[1]) < 2)) {
				p2 = points[i];
				continue;
			} 

			p1 = p2;
			p2 = points[i];
			result.push(this.toGlobalPointXY(p1[0], p1[1]));
		}

		this.currentAnnotationObject = this.createPolygon(result);
		this.overlay.fabricCanvas().add(this.currentAnnotationObject);
	
		this.history.push(this.currentAnnotationObject);
		this.overlay.fabricCanvas().setActiveObject(this.currentAnnotationObject);
		this.overlay.fabricCanvas().renderAll();

//$(".to-delete").remove();
	},


	//used to detect auto size of a primitive object (rect/ellipse)
	_getSimpleApproxObjectBounds: function(eventPosition) {
		//TODO move this beginning logic to handler

		var viewportPos = this.viewer.viewport.pointFromPixel(eventPosition);
		//var imagePoint = tiledImage.viewportToImageCoordinates(viewportPos);
		var originPoint = this.viewer.viewport.pixelFromPoint(viewportPos);
		this.changeTile(viewportPos);

		//todo unused, maybe round origin point...?
		// eventPosition.x = Math.round(eventPosition.x);
		// eventPosition.y = Math.round(eventPosition.y);

		this.comparator = function (pix) {
			return (pix[3] > this.alphaSensitivity && (pix[0] > 200 || pix[1] > 200));
		}

		//var originPoint = getOriginPoint(eventPosition);
		let origPixel = this.getPixelData(originPoint);
		var x = originPoint.x;  // current x position
		var y = originPoint.y;  // current y position

		if (!this.comparator(origPixel)) {
			//default object of width 40
			return {top: this.toGlobalPointXY(x, y-20), left: this.toGlobalPointXY(x-20, y), bottom: this.toGlobalPointXY(x, y+20), right: this.toGlobalPointXY(x+20, y)}
		};

		while (this.getAreaStamp(x, y) == 15) {
			x += 2;
		}
		var right = this.toGlobalPointXY(x, y);
		x = originPoint.x;

		while (this.getAreaStamp(x, y) == 15) {
			x -= 2;
		}
		var left = this.toGlobalPointXY(x, y);
		x = originPoint.x;

		while (this.getAreaStamp(x, y) == 15) {
			y += 2;
		}
		var bottom = this.toGlobalPointXY(x, y);

		y = originPoint.y;
		while (this.getAreaStamp(x, y) == 15) {
			y -= 2;
		}
		var top = this.toGlobalPointXY(x, y);

		return {top: top, left: left, bottom: bottom, right: right}
	},


	// BITWISE MAP OF VISITED AREAS, USE INTEGER FLAGS TO REDUCE THE ARRAY LENGTH
	// (e.g. linear nxn matrix array, each cell stores __bitArray.cells.length__ positions)
	// with javascript, safe to use up to 31 bits (we use 30)
	_bitArray: {
		dimension: 2000,
		arr: [],
		
		cells: [1 << 0, 1 << 1, 1 << 2, 1 << 3, 1 << 4, 1 << 5, 1 << 6, 1 << 7, 1 << 8, 1 << 9,
			1 << 10, 1 << 11, 1 << 12, 1 << 13, 1 << 14, 1 << 15, 1 << 16, 1 << 17, 1 << 18, 1 << 19,
			1 << 20, 1 << 21, 1 << 22, 1 << 23, 1 << 24, 1 << 25, 1 << 26, 1 << 27, 1 << 28, 1 << 29],
		
		isFlag: function(i, j) {
			let idx = i*this.dimension + j;
			let flag = this.arr[Math.floor(idx / this.cells.length)];

			return (flag & this.cells[idx % this.cells.length]) > 0;
		},

		setFlag: function(i, j, flag=true) {
			let idx = i*this.dimension + j;
			if (flag) {
				// |    to add selection (1 on the only place we want to add)
				this.arr[Math.floor(idx / this.cells.length)] = this.arr[Math.floor(idx / this.cells.length)] | this.cells[idx % this.cells.length];
			} else {
				// & ~   to negate the selection (0 on the only place we want to clear) and bit-wise and this mask to arr
				this.arr[Math.floor(idx / this.cells.length)] = this.arr[Math.floor(idx /  this.cells.length)] & ~this.cells[idx % this.cells.length];
			}
		},

		//for growing region
		startXY: function() {
			return Math.floor(this.dimension / 2);
		},

		clear: function() {
			this.arr = [];
		},

		// drawXY: function (i, j, width, height) {
		// 	var line = "";
		// 	for (; i < width; i++) {
		// 		line = "";
		// 		for (; j < height; j++) {
		// 			line += this.isFlag(i,j) ? "█" : "x";
		// 		}
		// 		console.log(line);
		// 	}
			
		// }
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

			if (!bitsmap.isFlag(bitsX+1, bitsY)) {
				bitsmap.setFlag(bitsX+1, bitsY);
				this._growRegion(x + speed, y, bitsX+1, bitsY, bitsmap, resultingPoints, speed, evaluator);
			}
			if (!bitsmap.isFlag(bitsX-1, bitsY)) {
				bitsmap.setFlag(bitsX-1, bitsY);
				this._growRegion(x - speed, y, bitsX-1, bitsY, bitsmap, resultingPoints, speed, evaluator);
			}
			if (!bitsmap.isFlag(bitsX, bitsY+1)) {
				bitsmap.setFlag(bitsX, bitsY+1);
				this._growRegion(x, y + speed, bitsX, bitsY+1, bitsmap, resultingPoints, speed, evaluator);
			}
			if (!bitsmap.isFlag(bitsX, bitsY-1)) {
				bitsmap.setFlag(bitsX, bitsY-1);
				this._growRegion(x, y - speed, bitsX, bitsY-1, bitsmap, resultingPoints, speed, evaluator);
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

				if (maxDist < 0) {
					do {
						newP.x -= primaryDirection[0];
						newP.y -= primaryDirection[1];
					} while (!evaluator(newP));
				}
				
				resultingPoints.push([newP.x, newP.y]);

				//$("#osd").append(`<span style="position:absolute; top:${newP.y}px; left:${newP.x}px; width:5px;height:5px; background:blue;" class="to-delete"></span>`);

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

	toScreenCoords: function(x, y) {
		return this.tiledImage.imageToWindowCoordinates(new OpenSeadragon.Point(x, y));	
	},

	toGlobalPointXY: function (x, y) {
		return this.tiledImage.windowToImageCoordinates(new OpenSeadragon.Point(x, y));
		//return this.tiledImage.viewportToImageCoordinates(this.viewer.viewport.pointFromPixel(new OpenSeadragon.Point(x, y)));
	},

	toGlobalPoint: function (point) {
		return this.tiledImage.windowToImageCoordinates(point);

		//return this.tiledImage.viewportToImageCoordinates(this.viewer.viewport.pointFromPixel(point));
	},

	getCursorXY: function(e) {
		return new OpenSeadragon.Point(e.pageX, e.pageY);
	},

	getGlobalCursorXY: function(e) {
		return this.getGlobalCursorXY(this.getCursorXY(e));
	},

	toDistanceObj: function (pointA, pointB) {
		return Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
	},

	toDistanceList: function (pointA, pointB) {
		return Math.hypot(pointB[0] - pointA[0], pointB[1] - pointA[1]);
	},

	// set currentTile to tile where is the event
	changeTile: function (viewportPos) {
		var i = 0;
		this.tiledImage.lastDrawn.forEach(function (tile) {
			if (tile.bounds.containsPoint(viewportPos)) {
				openseadragon_image_annotations.currentTile = tile;
				return;
			};
		});
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
		if (!this.currentTile.bounds.containsPoint(eventPosition)) {
			this.changeTile(viewer.viewport.pointFromPixel(eventPosition));
		}

		// get position on a current tile
		var x = eventPosition.x - this.currentTile.position.x;
		var y = eventPosition.y - this.currentTile.position.y;

		// get position on DZI tile (usually 257*257)
		var relative_x = Math.round((x / this.currentTile.size.x) * this.currentTile.context2D.canvas.width);
		var relative_y = Math.round((y / this.currentTile.size.y) * this.currentTile.context2D.canvas.height);

		
		return this.currentTile.context2D.getImageData(relative_x, relative_y, 1, 1).data;
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
 
									 OBJECTS (Avoid creation on multiple places, keep consistent defaults)
 
	 *****************************************************************************************************************/

	createRectangle: function(left, top, width, height) {
		return new fabric.Rect({
			left: left,
			top: top,
			fill: this.currentAnnotationObject.isLeftClick ? this.leftClickColor : this.rightClickColor,
			isLeftClick: this.currentAnnotationObject.isLeftClick,
			opacity: $("#opacity_control").val(),
			strokeWidth: 2,
			stroke: 'black',
			width: width,
			height: height,
			scaleX: 1,
			scaleY: 1,
			type: 'rect',
			hasRotatingPoint: false,
			borderColor:'#fbb802',
			cornerColor:'#fbb802',
			borderScaleFactor: 3,
			hasControls: false,
			comment: this.currentAnnotationObject.isLeftClick ? 
				(this.leftClickLabel === this.DEFAULT_LEFT_LABEL ? null : this.leftClickLabel) : 
				(this.rightClickLabel === this.DEFAULT_RIGHT_LABEL ? null : this.rightClickLabel)
		});
	},	
	
	createCopyRectangle: function(ofObject, left, top, width, height) {
		return new fabric.Rect({
			left: left,
			top: top,
			fill: ofObject.fill,
			isLeftClick: ofObject.isLeftClick,
			opacity: ofObject.opacity,
			strokeWidth: ofObject.strokeWidth,
			stroke: ofObject.stroke,
			width: width,
			height: height,
			scaleX: ofObject.scaleX,
			scaleY: ofObject.scaleY,
			type: ofObject.type,
			hasRotatingPoint: ofObject.hasRotatingPoint,
			borderColor: ofObject.borderColor,
			cornerColor: ofObject.cornerColor,
			borderScaleFactor: ofObject.borderScaleFactor,
			hasControls: false,
			comment: ofObject.comment
		});
	},

	createEllipse: function(left, top, rx, ry) {
		return new fabric.Ellipse({
			left: left,
			top: top,
			originX: 'left',
			originY: 'top',
			rx: rx,
			ry: ry,
			angle: 0,
			fill: this.currentAnnotationObject.isLeftClick ? this.leftClickColor : this.rightClickColor,
			stroke: 'black',
			strokeWidth: 2,
			opacity: $("#opacity_control").val(),
			type: 'ellipse',
			isLeftClick: this.currentAnnotationObject.isLeftClick,
			selectable: true,
			hasRotatingPoint: false,			
			borderColor:'#fbb802',
			cornerColor:'#fbb802',
			borderScaleFactor: 3,
			hasControls: false,
			comment: this.currentAnnotationObject.isLeftClick ? 
				(this.leftClickLabel === this.DEFAULT_LEFT_LABEL ? null : this.leftClickLabel) : 
				(this.rightClickLabel === this.DEFAULT_RIGHT_LABEL ? null : this.rightClickLabel)
		});
	},		
	
	createCopyEllipse: function(ofObject, left, top, rx, ry) {
		return new fabric.Ellipse({
			left: left,
			top: top,
			originX: ofObject.originX,
			originY: ofObject.originY,
			rx: rx,
			ry: ry,
			angle: ofObject.angle,
			fill: ofObject.fill,
			stroke: ofObject.stroke,
			strokeWidth: ofObject.strokeWidth,
			opacity: ofObject.opacity,
			type: ofObject.type,
			isLeftClick: ofObject.isLeftClick,
			selectable: ofObject.selectable,
			hasRotatingPoint: ofObject.hasRotatingPoint,	
			borderColor: ofObject.borderColor,
			cornerColor: ofObject.cornerColor,
			borderScaleFactor: ofObject.borderScaleFactor,
			hasControls: ofObject.hasControls,
			comment: ofObject.comment,
		});
	},		
	
	createPolygon: function(points) {
		return new fabric.Polygon(points, {
			hasRotatingPoint: false,
			fill: this.currentAnnotationObject.isLeftClick ? this.leftClickColor : this.rightClickColor,
			stroke: 'black',
			strokeWidth: 2,
			isLeftClick: this.currentAnnotationObject.isLeftClick,
			opacity: $("#opacity_control").val(),
			type: 'polygon',
			selectable: true,
			borderColor:'#fbb802',
			cornerColor:'#fbb802',
			borderScaleFactor: 3,
			hasControls: false,
			comment: this.currentAnnotationObject.isLeftClick ? 
				(this.leftClickLabel === this.DEFAULT_LEFT_LABEL ? null : this.leftClickLabel) : 
				(this.rightClickLabel === this.DEFAULT_RIGHT_LABEL ? null : this.rightClickLabel)
		});
	},	

	createCopyPolygon: function(ofObject, newPoints, evented=true) {
		return new fabric.Polygon(newPoints, {
			hasRotatingPoint: ofObject.hasRotatingPoint,
			fill: ofObject.fill,
			stroke: ofObject.stroke,
			strokeWidth: ofObject.strokeWidth,
			isLeftClick: ofObject.isLeftClick,
			opacity: ofObject.opacity,
			type: ofObject.type,
			selectable: ofObject.selectable,
			borderColor: ofObject.borderColor,
			cornerColor: ofObject.cornerColor,
			borderScaleFactor: ofObject.borderScaleFactor,
			comment: ofObject.comment,
			selectable: evented,
			hasControls: ofObject.hasControls,
			evented: evented,
		});
	},	


	/****************************************************************************************************************
 
									 A N N O T A T I O N S (User driven Initializers and Updaters)
 
	 *****************************************************************************************************************/


	// initialize rectabgle of 1x1 from point(x,y)
	initializeRectangle: function (x, y) {
		this.currentAnnotationObject = this.createRectangle(x, y, 1, 1);
		this.currentAnnotationObjectUpdater = this.updateRectangleWidth;
		this.overlay.fabricCanvas().add(this.currentAnnotationObject);
	},

	initializeEllipse: function (x, y) {
		this.currentAnnotationObject = this.createEllipse(x, y, 1, 1);
		this.currentAnnotationObjectUpdater = this.updateEllipseDimens;
		this.overlay.fabricCanvas().add(this.currentAnnotationObject);
	},

	updateRectangleWidth: function (x, y) {
		if (this.origX > x) {
			this.currentAnnotationObject.set({ left: Math.abs(x) });
		};
		if (this.origY > y) {
			this.currentAnnotationObject.set({ top: Math.abs(y) });
		};
		var width = Math.abs(x - this.origX);
		var height = Math.abs(y - this.origY);
		this.currentAnnotationObject.set({ width: width, height: height });
	},

	updateEllipseDimens: function (x, y) {
		if (this.origX > x) {
			this.currentAnnotationObject.set({ left: Math.abs(x) });
		};
		if (this.origY > y) {
			this.currentAnnotationObject.set({ top: Math.abs(y) });
		};
		var width = Math.abs(x - this.origX) / 2;
		var height = Math.abs(y - this.origY) / 2;
		this.currentAnnotationObject.set({ rx: width, ry: height });
	},

	enlargeRectToContain: function(rect, points) {
		let w = rect.width,
			h = rect.height;
		points.push({x: rect.left, y: rect.top});
		points.push({x: rect.left+w, y: rect.top});
		points.push({x: rect.left, y: rect.top+h});
		points.push({x: rect.left+w, y: rect.top+h});
		var minX = points[0].x,
			minY = points[0].y,
			maxX = minX,
			maxY = minY;

		points.forEach(p => {
			if (p.x > maxX) maxX = p.x;
			if (p.y > maxY) maxY = p.y;
			if (p.x < minX) minX = p.x;
			if (p.y < minY) minY = p.y;
		});

		let newObject = this.createCopyRectangle(rect, minX, minY, maxX - minX, maxY - minY);
		this.overlay.fabricCanvas().remove(rect);
		this.overlay.fabricCanvas().add(newObject);
		this.history.push(newObject, rect);
		
    	this.overlay.fabricCanvas().renderAll();
		this.overlay.fabricCanvas().setActiveObject(newObject);
	},

	enlargeEllipseToContain: function(ellipse, points) {
		let w = ellipse.rx*2,
			h = ellipse.ry*2;
		points.push({x: ellipse.left, y: ellipse.top});
		points.push({x: ellipse.left+w, y: ellipse.top});
		points.push({x: ellipse.left, y: ellipse.top+h});
		points.push({x: ellipse.left+w, y: ellipse.top+h});

		var minX = points[0].x,
			minY = points[0].y,
			maxX = minX,
			maxY = minY;

		points.forEach(p => {
			if (p.x > maxX) maxX = p.x;
			if (p.y > maxY) maxY = p.y;
			if (p.x < minX) minX = p.x;
			if (p.y < minY) minY = p.y;
		});

		let newObject = this.createCopyEllipse(ellipse, minX, minY, (maxX - minX) / 2, (maxY - minY) / 2);
		this.overlay.fabricCanvas().add(newObject);
		this.overlay.fabricCanvas().remove(ellipse);
		this.history.push(newObject, ellipse);
		
    	this.overlay.fabricCanvas().renderAll();
		this.overlay.fabricCanvas().setActiveObject(newObject);		
	},

	polygonClickAction: function (o, x, y) {
		// if polygon mode was not active start drawing polygon
		if (!this.polygon.polygonBeingCreated) {
			this.polygon.init();
			console.log(this.polygon.polygonBeingCreated);
		}
		this.polygon.addPoint(x, y);
	},


	// add new point to polygon while drawing
	updatePolygon: function (x, y) {
		if (this.polygon.activeLine && this.polygon.activeLine.class == "line") {
			this.polygon.activeLine.set({ x2: x, y2: y });
			var points = this.polygon.activeShape.get("points");
			points[this.polygon.pointArray.length] = {
				x: x,
				y: y
			}
			this.polygon.activeShape.set({
				points: points
			});
		}
	},

	enlargePolygonToContain: async function(polygon, points) {
		
		console.log("enlarge poly")
		
		var polypoints = polygon.get("points")

		//TODO WHEN PROCESSING I KNOW WHICH INDICES ARE OUT/IN SO THERE IT SHOULD CROSS THE BORDER AND THUS MERGE...

		let res = [];
		var inside = false;
		polypoints.forEach(p => {
			if (robustPointInPolygon(points, p) === 1) {
				res.push([p.x, p.y]);
				if (inside) {
					inside = false;
					//todo
				}
			} else {
				if (! inside) {
					inside = true;
					//todo
				}
			}
		});

		

		//suppose polygon is bigger than appended region, keep region edge points too (0)		
		points.forEach(p => {
			if (robustPointInPolygon(polypoints, p) > -1) {
				res.push([p.x, p.y]);
			}
		});


		res = hull(res, 80);
		points = [];
		res.forEach(p => {
			points.push(new OpenSeadragon.Point(p[0], p[1]))
		})

		// console.log("OOK");
		// console.log(res1);
		// console.log(res2);

		// var i1 = 0, i2 = 0, j1=0, j2 = 0, d1=Infinity, d2=Infinity;
		// for (let i = 0; i < res1.length; i++) {
		// 	for (let j = 0; j < res2.length; j++) {

		// 		let d = res1[i].distanceTo(res2[i]);
		// 		if (d < d1) {
		// 			i1 = i;
		// 			j1 = j;
		// 		} 
		// 		// else if (d < d2) {
		// 		// 	i2 = i;
		// 		// 	j2 = j;
		// 		// }
		// 	}
		// }


		// console.log(i1, j1);
		// //shift res1 array so that the last point is the closest point to the appended region
		// let result = [...res1.slice(res1.length-i1-1, res1.length), ...res1.slice(0, res1.length-i1-1)];

		// //decide whether to add res2 in normal or reversed order, start with j1 th vertex
		// let toLeftJ = j1-1 < 0 ? res2.length - 1 : j1-1;
		// let toRightJ = (j1+1)%res2.length;
		// if (res2[toLeftJ].distanceTo(res1[(i1+1) % res1.length]) < res2[toRightJ].distanceTo(res1[(i1+1) % res1.length])) {
		// 	//j1+1 th vertex closer (array should end with it)
		// 	res2 = [...res2.slice(j1, res2.length), ...res2.slice(0, j1)];
		// } else {
		// 	//j1-1 th vertex closer (array should end with it)
		// 	res2 = [...res2.slice(res1.length-j1-1, res2.length), ...res2.slice(0, res1.length-j1-1)];
		// }
		// result = result.concat(res2);
		// console.log(result);

		// this.overlay.fabricCanvas().remove(targetObject);
		this.currentAnnotationObject = this.createCopyPolygon(polygon, points);
		this.overlay.fabricCanvas().remove(polygon);
		this.overlay.fabricCanvas().add(this.currentAnnotationObject);
		this.history.push(this.currentAnnotationObject, polygon);
		this.overlay.fabricCanvas().renderAll();
		this.overlay.fabricCanvas().setActiveObject(this.currentAnnotationObject);

	},

	// initialize polygon (p) edit by showing polygon points and make them interactive
	// todo move to polygon object class and create also class for circle & rect and move things there all conceerning modification, creation
	initializeEditPolygon: function (p) {
		//save original input form attributes
		this.polygon.init(false);
		this.polygon.input_attributes = {
			comment: p.comment,
			a_group: p.a_group,
			threshold: p.threshold,
		};
		var points = p.get("points");
		var zoom = this.overlay.fabricCanvas().getZoom();
		var circle_size = 0;
		if (zoom < 0.01) { circle_size = 1000 }
		else if (zoom < 0.03) { circle_size = 500 }
		else if (zoom < 0.1) { circle_size = 100 }
		else if (zoom < 0.3) { circle_size = 50 }
		else { circle_size = 20 };

		points.forEach(function (point, index) {
			var circle = new fabric.Circle({
				radius: circle_size,
				fill: 'red',
				left: point.x,
				top: point.y,
				originX: 'center',
				originY: 'center',
				hasControls: false,
				hasBorders: false,
				name: index,
				type: "_polygon.controls.circle"
			});
			openseadragon_image_annotations.polygon.pointArray.push(circle);
			openseadragon_image_annotations.overlay.fabricCanvas().add(circle);
		});
		openseadragon_image_annotations.overlay.fabricCanvas().renderAll();

		
		this.polygon.originallyEddited = p;
		this.polygon.currentlyEddited = this.createCopyPolygon(p, points, false);
		this.overlay.fabricCanvas().remove(p);
		this.overlay.fabricCanvas().add(this.polygon.currentlyEddited);
		this.overlay.fabricCanvas().sendToBack(this.polygon.currentlyEddited);
	},

	// change position of one of the polygons points (p) and redrawn polygon
	editPolygon: function (p) {
		let curr = this.polygon.currentlyEddited;
		curr.points[p.name] = { x: p.getCenterPoint().x, y: p.getCenterPoint().y };
		this.overlay.fabricCanvas().remove(curr);
		//todo do not create copy, just keep the same polygon
		this.polygon.currentlyEddited = this.createCopyPolygon(curr, curr.points, false);
		this.overlay.fabricCanvas().add(this.polygon.currentlyEddited);
		this.overlay.fabricCanvas().sendToBack(this.polygon.currentlyEddited);
	},

	setFabricCanvasInteractivity: function (boolean) {
		this.overlay.fabricCanvas().forEachObject(function (object) {
			object.selectable = boolean;
		});
	},

	deselectFabricObjects: function () {
		this.overlay.fabricCanvas().deactivateAll().renderAll();
	},


	// delete the currently selected annotation from the canvas
	deleteActiveAnnotation: function () {
		// Break out if no annotation is currently selected
		if (this.overlay.fabricCanvas().getActiveObject() == null) {
			this.messenger.show("Please select the annotation you would like to delete", 3000, this.messenger.MSG_INFO);
			return;
		}
		var annotation = this.overlay.fabricCanvas().getActiveObject();
		if (annotation.type == "rect" || annotation.type == "polygon") {
			annotation.remove();
		};

	},

	// Get all objects from canvas
	deleteAllAnnotations: function () {
		var objects = openseadragon_image_annotations.overlay.fabricCanvas().getObjects();
		/* if objects is null, catch */
		if (objects.length == 0) {
			console.log("No annotations on canvas to delete");
			return;
		}
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
			$("#input_form").hide();
		}
		this.overlay.fabricCanvas().renderAll();
	},

	// set input form with default values or annotation attributes
	//(e.g if annotation was imported)
	set_input_form: function (annotation) {
		return;
		//todo remove this feature?

		if (annotation.comment) {
			document.getElementById("annotation_comment").value = annotation.comment;
		} else { document.getElementById("annotation_comment").value = "" };

		if (!(annotation.a_group)) {
			annotation.set({ a_group: "None" })
		};
		document.getElementById("annotation_group").value = annotation.a_group;


		//todo more modular?
		// if (!(annotation.threshold)) {
		// 	annotation.set({ threshold: document.getElementById("Threshold").innerHTML })
		// };
		document.getElementById("annotation_threshold").innerHTML = annotation.threshold;

		// set position of the input form
		var viewport_coordinates = this.viewer.world.getItemAt(0).imageToViewportCoordinates(annotation.left + annotation.width, annotation.top);
		var pixel_coordinates = this.viewer.viewport.pixelFromPoint(viewport_coordinates);
		document.getElementById("input_form").style.position = "absolute";
		document.getElementById("input_form").style.top = String(pixel_coordinates.y - 10) + "px";
		document.getElementById("input_form").style.left = String(pixel_coordinates.x + 10) + "px";


	},

	//cursor management (TODO move here other stuff involving cursor too)
	// updater: function(mousePosition: OSD Point instance, cursorObject: object that is being shown underneath cursor)
	//todo not working
	cursor: {
		_visible: false,
		_updater: null,
		_node: null,
		_toolRadius: 0,

		init: function() {
			this._node = document.getElementById("annotation-cursor");
		},

		updateRadius: function() {
			this._toolRadius = openseadragon_image_annotations.modifyTool.getScreenToolRadius();
		},

		getHTMLNode: function() {
			return this._node;
		},

		show: function() {
			if (this._listener) return;
			//this._node.css({display: "block", width: this._toolRadius+"px", height: this._toolRadius+"px"});
			this._node.style.display = "block";			
			this.updateRadius();
			this._node.style.width = (this._toolRadius * 2)+"px";
			this._node.style.height = (this._toolRadius * 2)+"px";
			// this._node.style.top = e.pageY + "px";
			// this._node.style.left = e.pageX + "px";

			const c = this._node;

			this._visible = true;
			this._listener = e => {
				c.style.top = e.pageY + "px";
				c.style.left = e.pageX + "px";
	

			};
			window.addEventListener("mousemove", this._listener);
		},

		hide: function() {
			if (!this._listener) return;
			this._node.style.display = "none";
			this._visible = false;
			window.removeEventListener("mousemove", this._listener);
			this._listener = null;
		},
	},


	// name space for polygon manupulation
	polygon: {
		min: 99,
		max: 999999,
		polygonBeingCreated: false, // is polygon being drawn/edited
		pointArray: new Array(),
		lineArray: new Array(),
		activeLine: null,
		activeShape: false,
		currentlyEddited: null,
		originallyEddited: null,
		input_attributes: {},

		// initialize attributes, prepare for new drawing
		init: function (isNew=true) {
			this.polygonBeingCreated = isNew;
			this.pointArray = new Array();
			this.lineArray = new Array();
			this.activeLine = null;
			this.activeShape = false;
			this.currentlyEddited = null;
			this.input_attributes = {};
			this.originallyEddited = null;
		},
		addPoint: function (x, y) {
			// get name of point
			var random = Math.floor(Math.random() * (this.max - this.min + 1)) + this.min;
			var id = new Date().getTime() + random;
			// calcute size of the point(1000px - 20px) based on zoom (0-1.1)
			var zoom = openseadragon_image_annotations.overlay.fabricCanvas().getZoom();
			var circle_size = 0;
			if (zoom < 0.01) { circle_size = 1000 }
			else if (zoom < 0.03) { circle_size = 500 }
			else if (zoom < 0.1) { circle_size = 100 }
			else if (zoom < 0.3) { circle_size = 50 }
			else { circle_size = 20 };
			//create circle representation of the point
			var circle = new fabric.Circle({
				radius: circle_size,
				fill: '#F58B8B',
				stroke: '#333333',
				strokeWidth: 0.5,
				left: x,
				top: y,
				selectable: false,
				hasBorders: false,
				hasControls: false,
				originX: 'center',
				originY: 'center',
				id: id,
				objectCaching: false,
				type: "_polygon.controls.circle"
			});
			if (this.pointArray.length == 0) {
				circle.set({
					fill: 'red'
				})
			}
			circle.lockMovementX = circle.lockMovementY = true;

			var points = [x, y, x, y];
			line = new fabric.Line(points, {
				strokeWidth: 4,
				fill: '#red',
				stroke: '#999999',
				class: 'line',
				originX: 'center',
				originY: 'center',
				selectable: false,
				hasBorders: false,
				hasControls: false,
				evented: false,
				objectCaching: false
			});

			if (this.activeShape) {
				var points = this.activeShape.get("points");
				points.push({
					x: x,
					y: y
				});
				var polygon = openseadragon_image_annotations.createPolygon(points);
				polygon.selectable = false;
				polygon.hasBorders = false;
				polygon.hasControls = false;
				polygon.evented = false;
				polygon.objectCaching = false;

				openseadragon_image_annotations.overlay.fabricCanvas().remove(this.activeShape);
				openseadragon_image_annotations.overlay.fabricCanvas().add(polygon);
				this.activeShape = polygon;
				openseadragon_image_annotations.overlay.fabricCanvas().renderAll();
			}
			else {
				var polyPoint = [{ x: x, y: y }];
				var polygon = openseadragon_image_annotations.createPolygon(polyPoint);
				polygon.selectable = false;
				polygon.hasBorders = false;
				polygon.hasControls = false;
				polygon.evented = false;
				polygon.objectCaching = false;
				this.activeShape = polygon;
				openseadragon_image_annotations.overlay.fabricCanvas().add(polygon);
			}
			this.activeLine = line;

			this.pointArray.push(circle);
			this.lineArray.push(line);

			openseadragon_image_annotations.overlay.fabricCanvas().add(line);
			openseadragon_image_annotations.overlay.fabricCanvas().add(circle);
			openseadragon_image_annotations.overlay.fabricCanvas().selection = false;
		},

		// generate finished polygon
		generatePolygon: function (pointArray) {
			var points = new Array();
			$.each(pointArray, function (index, point) {
				points.push({
					x: point.left,
					y: point.top
				});
				openseadragon_image_annotations.overlay.fabricCanvas().remove(point);
			});

			if (!this.currentlyEddited) {
				$.each(this.lineArray, function (index, line) {
					openseadragon_image_annotations.overlay.fabricCanvas().remove(line);
				});
				openseadragon_image_annotations.overlay.fabricCanvas().remove(this.activeShape).remove(this.activeLine);
			} else {
				openseadragon_image_annotations.overlay.fabricCanvas().remove(this.currentlyEddited);
			};

		
			if (pointArray.length < 3) {
				this.init(false); //clear
				return;
			}

			openseadragon_image_annotations.currentAnnotationObject = openseadragon_image_annotations.createPolygon(points);
			//todo callback with deletion completion of active polygon/currently modified one? need to delete also all the circles!!
			//if polygon is being drawn, delete it
			// if (openseadragon_image_annotations.polygon.polygonBeingCreated == true) {
			// 	openseadragon_image_annotations.polygon.activeShape.remove();
			// 	openseadragon_image_annotations.polygon.pointArray.forEach(function (point) {
			// 		openseadragon_image_annotations.overlay.fabricCanvas().remove(point)
			// 	});
			// 	openseadragon_image_annotations.polygon.lineArray.forEach(function (line) {
			// 		openseadragon_image_annotations.overlay.fabricCanvas().remove(line)
			// 	});
			// 	openseadragon_image_annotations.polygon.polygonBeingCreated = false;}



			// add polygon to canvas, switxh to edit mode, select it, set input form and show the input form
			openseadragon_image_annotations.overlay.fabricCanvas().add(openseadragon_image_annotations.currentAnnotationObject);
			//originallyEdited is null if new polygon, else history can redo
			openseadragon_image_annotations.history.push(openseadragon_image_annotations.currentAnnotationObject, this.originallyEddited);


			//TODO open by default edit mode or not?
			// if (openseadragon_image_annotations.mouseMode != "editAnnotation" && openseadragon_image_annotations.mouseMode != "OSD") {
			// 	document.getElementById("editAnnotation").click();
			// };
			// 		open... TODO .setActive(this.currentAnnotationObject);
			// openseadragon_image_annotations.currentAnnotationObject.set(this.input_attributes);
			// openseadragon_image_annotations.set_input_form(openseadragon_image_annotations.currentAnnotationObject);
			// $("#input_form").show();
			// document.getElementById('edit').disabled = false;

			this.init(false); //clear
		}
	}, // end of plygon namespace


	//tool for object modification: draw on canvas to add (add=true) or remove (add=false) parts of fabric.js object
	//any object is first converted to polygon
	modifyTool: {
		polygon: null,
		radius: 50,
		mousePos: null,
				
		SQRT2DIV2: 0.707106781187,
	
		//initialize any object for cursor-drawing modification
		init: function(object, atPosition, radius, add=true) {

			switch(object.type) {
				case 'rect':
					let w = object.width, h = object.height;
					this._createPolygonAndSetupFrom([{x: object.left, y: object.top},
						{x: object.left+w, y: object.top},
						{x: object.left+w, y: object.top+h},
						{x: object.left, y: object.top+h}
					], object);
					break;
				case 'ellipse':
					//see https://math.stackexchange.com/questions/2093569/points-on-an-ellipse
					//formula author https://math.stackexchange.com/users/299599/ng-chung-tak
					let pow2e = 1 - (object.ry*object.ry) / (object.rx*object.rx),
						pow3e = pow2e*Math.sqrt(pow2e),
						pow4e = pow2e*pow2e,
						pow6e = pow3e*pow3e;

					let step = Math.PI / 16, points = [];

					for (let t = 0; t < 2*Math.PI; t += step) {
						let param = t - (pow2e/8 + pow4e/16 + 71*pow6e/2048)*Math.sin(2*t)
						 			+ ( (5*pow4e + 5*pow6e)/256 ) * Math.sin(4*t)
									+ (29*pow6e/6144) * Math.sin(6*t);
						points.push({x: object.rx * Math.cos(param) + object.left + object.rx, y: object.ry * Math.sin(param) + object.top + object.ry});
					}
					this._createPolygonAndSetupFrom(points, object);
					break;
				case 'polygon': 
					this._setupPolygon(object);
					break;
				default:
					this.polygon = null;
					openseadragon_image_annotations.messenger.show("Modification with <i>shift</i> allowed only with annotation objects.", 5000, openseadragon_image_annotations.messenger.MSG_WARN);
					return;
			}

			if (add) this.update = this.union;
			else this.update = this.subtract;

			this.setRadius(radius);

			this.mousePos = atPosition;		
		},

		setRadius: function(radius) {
			var zoom = openseadragon_image_annotations.overlay.fabricCanvas().getZoom();
			if (zoom < 0.01) { this.radius = 50*radius; }
			else if (zoom < 0.03) { this.radius = 25*radius; }
			else if (zoom < 0.1) { this.radius = 5*radius; }
			else if (zoom < 0.3) { this.radius = 2*radius; }
			else { this.radius = radius; };
		},

		//update step meant to be executed on mouse move event
		update: this.union,

		//final step
		finish: function() {
			if (this.polygon) {
				this.polygon.lockMovementX = false;
				this.polygon.lockMovementY = false;

				if (this.polygon.incrementId != this.initial.incrementId) {
					//incrementID is used by history - if ID equal, no changes were made -> no record
					openseadragon_image_annotations.history.push(this.polygon, this.initial);
				}
				let outcome = this.polygon;
				this.polygon = null;
				this.initial = null;
				this.mousePos = null;
				return outcome;
			}
			return null;
		},

		//TODO sometimes the greinerHormann takes too long to finish (it is cycling, verticaes are NaN values), do some measurement and kill after it takes too long (2+s ?)
		union: function(nextMousePos) {
			if (!this.polygon || openseadragon_image_annotations.toDistanceObj(this.mousePos, nextMousePos) < this.radius / 3) return;

			let radPoints = this._get8Directions(nextMousePos);
			var polypoints = this.polygon.get("points");
			//avoid 'Leaflet issue' - expecting a polygon that is not 'closed' on points (first != last)
			if (openseadragon_image_annotations.toDistanceObj(polypoints[0], polypoints[polypoints.length-1]) < this.radius) polypoints.pop();
			this.mousePos = nextMousePos;

			//compute union
			var union  = greinerHormann.union(polypoints, radPoints);

			if(union) {
				openseadragon_image_annotations.overlay.fabricCanvas().remove(this.polygon);
					
				if(typeof union[0][0] === 'number'){ // single linear ring
					var polygon = openseadragon_image_annotations.createCopyPolygon(this.polygon, this._simplifyPolygon(union, this.radius / 5));
					openseadragon_image_annotations.overlay.fabricCanvas().add(polygon);
					this.polygon = polygon;					
				} else {
					if (union.length > 1) union  = this._unify(union);
					
					var polygon = openseadragon_image_annotations.createCopyPolygon(this.polygon,this._simplifyPolygon(union[0], this.radius / 5));
					openseadragon_image_annotations.overlay.fabricCanvas().add(polygon);
					this.polygon = polygon;
				}

				this.polygon.lockMovementX = false;
				this.polygon.lockMovementY = false;
				openseadragon_image_annotations.overlay.fabricCanvas().renderAll();

			} else {
				console.log("NO UNION FOUND");
			}
		},

		subtract: function(nextMousePos) {
			if (!this.polygon || openseadragon_image_annotations.toDistanceObj(this.mousePos, nextMousePos) < this.radius / 3) return;

			let radPoints = this._get8Directions(nextMousePos);
			var polypoints = this.polygon.get("points");
			this.mousePos = nextMousePos;

			var difference = greinerHormann.diff(polypoints, radPoints);
			if (difference) {
				openseadragon_image_annotations.overlay.fabricCanvas().remove(this.polygon);
					if(typeof difference[0][0] === 'number'){ // single linear ring
						var polygon = openseadragon_image_annotations.createCopyPolygon(this.polygon, this._simplifyPolygon(difference, this.radius / 5));
						openseadragon_image_annotations.overlay.fabricCanvas().add(polygon);
						this.polygon = polygon;					
					} else {
						if (difference.length > 1) difference  = this._unify(difference);

						let maxIdx = 0, maxArea = 0;
						for (let j = 0; j < difference.length; j++) {
							let measure = this._findApproxBoundBoxSize(difference[j]);
							if (measure.diffX < this.radius || measure.diffY < this.radius) continue;
							let area = measure.diffX*measure.diffY;
							if (area > maxArea) {
								maxArea = area;
								maxIdx = j;
							}
						}

						if (maxArea < this.radius*this.radius / 2) {  //largest area ceased to exist: finish
							//this.polygon.comment = this.initial.comment; //for some reason not preserved
							openseadragon_image_annotations.history.push(null, this.initial);
							this.polygon = null;
							this.initial = null;
							this.mousePos = null;
							return;
						}

						var polygon = openseadragon_image_annotations.createCopyPolygon(this.polygon, this._simplifyPolygon(difference[maxIdx], this.radius / 5));
						openseadragon_image_annotations.overlay.fabricCanvas().add(polygon);
						this.polygon = polygon;
					}
	
					this.polygon.lockMovementX = false;
					this.polygon.lockMovementY = false;
					openseadragon_image_annotations.overlay.fabricCanvas().renderAll();
			} else {
				console.log("NO DIFFERENCE FOUND");
			}
		},

		getScreenToolRadius: function() {
			return openseadragon_image_annotations.toScreenCoords(0, 0).distanceTo(openseadragon_image_annotations.toScreenCoords(0, this.radius));
		},

		//initialize object so that it is ready to be modified
		_setupPolygon: function(polyObject) {
			openseadragon_image_annotations.currentAnnotationObject = polyObject;

			polyObject.lockMovementX = true;
			polyObject.lockMovementY = true;

			this.polygon = polyObject;
			this.initial = polyObject;
		},

		//create polygon from points and initialize so that it is ready to be modified
		_createPolygonAndSetupFrom: function(points, object) {
			let polygon = openseadragon_image_annotations.createCopyPolygon(object, points);
			polygon.type = "polygon";

			//TODO also remove from (rather replace in)  history, or maybe use straightforward 'delete' from API, will be able to convert back 'rasterization'
			openseadragon_image_annotations.overlay.fabricCanvas().remove(object);

			openseadragon_image_annotations.overlay.fabricCanvas().add(polygon);
			openseadragon_image_annotations.history.push(polygon, object);

			this._setupPolygon(polygon);
		},

		//try to merge polygon list into one polygons using 'greinerHormann.union' repeated call and simplyfiing the polygon
		_unify: function(unions) {
			let i = 0, len = unions.length ** 2 + 10, primary = [], secondary = [];

			unions.forEach(u => {
				primary.push(this._simplifyPolygon(u, this.radius/5));
			});
			while (i < len) {
				i++;
				let j = 0;
				for (; j < primary.length-1; j+=2) {
					let ress = greinerHormann.union(primary[j], primary[j+1]);

					if(typeof ress[0][0] === 'number'){
						secondary = [ress].concat(secondary); //reverse order for different union call in the next loop
					} else {
						secondary = ress.concat(secondary); //reverse order for different union call
					}				
				}
				if (j == primary.length-1) secondary.push(primary[j]);
				primary = secondary;
				secondary = [];
			}
			return primary;
		},
		
		//remove on-line (horizontal/vertical only) points or points that are too close
		_simplifyPolygon: function(points, threshold) {
			if (points.length < 20) return points;
			let p1=points[0], p2=points[1];
			let result = [p1];
	
			for (var i = 2; i < points.length; i++) {
				if (openseadragon_image_annotations.toDistanceObj(p1, p2) < threshold
				 ||	(Math.abs(p1[0] - p2[0]) < 2 && Math.abs(points[i][0] - p2[0]) < 2)
				 || (Math.abs(p1[1] - p2[1]) < 2 && Math.abs(points[i][1] - p2[1]) < 2)) {
					p2 = points[i];
					continue;
				} 
	
				p1 = p2;
				p2 = points[i];
				result.push(p1);
			}
			result.push(p2);
			return result;
		},

		//when removing parts of polygon, decide which one has smaller area and will be removed
		_findApproxBoundBoxSize: function(points) {
			if (points.length < 3) return {diffX:0, diffY: 0};
			let maxX = points[0].x, minX = points[0].x, maxY = points[0].y, minY = points[0].y;
			for (let i = 1; i < points.length; i++) {
				maxX = Math.max(maxX, points[i].x);
				maxY = Math.max(maxY, points[i].y);
				minX = Math.min(minX, points[i].x);
				minY = Math.min(minY, points[i].y);
			}
			return {diffX:maxX-minX, diffY: maxY-minY};
		},

		//create approximated polygon of drawing tool
		_get8Directions: function(fromPoint) {
			let diagonal = this.radius*this.SQRT2DIV2;
			return [
				{x: fromPoint.x - this.radius, y: fromPoint.y},
				{x: fromPoint.x - diagonal, y: fromPoint.y + diagonal},
				{x: fromPoint.x, y: fromPoint.y + this.radius},
				{x: fromPoint.x + diagonal, y: fromPoint.y + diagonal},
				{x: fromPoint.x + this.radius, y: fromPoint.y},
				{x: fromPoint.x + diagonal, y: fromPoint.y - diagonal},
				{x: fromPoint.x, y: fromPoint.y - this.radius},
				{x: fromPoint.x - diagonal, y: fromPoint.y - diagonal}
			]
		}
	},

	history: {

		//TODO history: populate BOARD when annotation file is loaded (some for object loop)

		buffer: [],
		_buffidx: 0,
		BUFFER_LENGTH: null,
		_lastValidIndex: -1,
		_autoIncrement: 0,
		_boardSelected: null,

		init: function(historySize=30) {			
		  this.board = $("#annotation-logs");
		  this.undoBtn = $("#history-undo");
		  this.redoBtn = $("#history-redo");

		  this.BUFFER_LENGTH = historySize;
		},
	
		back: function () {	
			if (this.buffer[this._buffidx]) {
				this._performSwap(openseadragon_image_annotations.overlay.fabricCanvas(), 
								  this.buffer[this._buffidx].back, this.buffer[this._buffidx].forward)				
		
				//this.bufferLastRemoved = this.buffer[this._buffidx];
				//this.buffer[this._buffidx] = null;

					
				this._buffidx--;
				if (this._buffidx < 0) this._buffidx = this.BUFFER_LENGTH - 1;
				//if we went around and finished where we once were, stop
				if (this._lastValidIndex === this._buffidx) {
					//lose one object to prevent from cycling
					this.buffer[this._lastValidIndex] = null;

					this._lastValidIndex--;
					if (this._lastValidIndex < 0) this._lastValidIndex = this.BUFFER_LENGTH - 1;
				}

				if (this.redoBtn) this.redoBtn.css("color", "white");
			}

			if (this.undoBtn) {
				let color = this.buffer[this._buffidx] ? "white" : "gray";
				this.undoBtn.css("color", color);
			}
		},

		redo: function() {
			if (this._lastValidIndex >= 0 && this._buffidx !== this._lastValidIndex) {
				this._buffidx = (this._buffidx + 1) % this.BUFFER_LENGTH;
				
				this._performSwap(openseadragon_image_annotations.overlay.fabricCanvas(), 
								  this.buffer[this._buffidx].forward, this.buffer[this._buffidx].back)
			}

			if (this.redoBtn) {
				let color = this._lastValidIndex >= 0 && this._buffidx !== this._lastValidIndex ? "white" : "gray";
				this.redoBtn.css("color", color);
			}
			if (this.undoBtn) this.undoBtn.css("color", "white");
		},
	
		push: function (newObject, previous=null) {
			if (newObject) {
				this._addToBoard(newObject);
			} 

			if (previous) {
				//todo not necessarily ID present
				this._removeFromBoard(previous);
			}

			console.log("PREV", previous, "NEXT", newObject);

			this._buffidx = (this._buffidx + 1) % this.BUFFER_LENGTH;
			this.buffer[this._buffidx] = {forward: newObject, back: previous};
			this._lastValidIndex = this._buffidx; //new object creation overiddes history

			if (this.undoBtn && this.redoBtn) {
				this.undoBtn.css("color", "white");
				this.redoBtn.css("color", "gray");
			}
		},

		highlight: function(object) {
			if (this._boardSelected) {
				this.board.find(`#log-object-${this._boardSelected.incrementId}`).removeClass('color-bg-tertiary');
			}
			if (object) {
				this.board.find(`#log-object-${object.incrementId}`).addClass('color-bg-tertiary');
			}
			this._boardSelected = object;
		},
	
		_focus: function(cx, cy, objectId=null) {
			var target = openseadragon_image_annotations.tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(cx, cy));
			if (objectId !== null) {
				var targetObj = this._findObjectOnCanvasById(objectId);
				if (targetObj) {
					openseadragon_image_annotations.overlay.fabricCanvas().setActiveObject(targetObj);
				}
			}
			openseadragon_image_annotations.viewer.viewport.panTo(target);
			openseadragon_image_annotations.viewer.viewport.applyConstraints();
		},

		_updateBoardText: function(object, text) {
			console.log(text);
			if (!text || text.length < 0) text = this._getObjectDefaultDescription(object);
			this.board.find(`#log-object-${object.incrementId} span.desc`).html(text);
		},

		_removeFromBoard: function(object) {
			this.board.children(`#log-object-${object.incrementId}`).remove();
		},

		_addToBoard: function(object) {
			let desc = "", icon = "";
			if (!object.comment) {
				desc = this._getObjectDefaultDescription(object);
				icon = this._getObjectDefaultIcon(object);
			} else {
				desc = object.comment;
				if (desc === openseadragon_image_annotations.leftClickLabel || desc === openseadragon_image_annotations.rightClickLabel) {
					//auto labelling - append coords to distinguish
					desc += ` [${Math.round(object.left)}, ${Math.round(object.top)}]`;
				}
				icon = this._getObjectDefaultIcon(object);
			}

			if (!object.incrementId) {
				object.incrementId = this._autoIncrement;
				this._autoIncrement++;
			}

			let center = object.getCenterPoint();
			this.board.prepend(`<div id="log-object-${object.incrementId}" onclick="openseadragon_image_annotations.history._focus(${center.x}, ${center.y}, ${object.incrementId});">
			    <span class="material-icons" style="color: ${object.fill}">${icon}</span> 
				<input type="text" class="form-control border-0" disabled="true" class="desc" style="width: calc(100% - 80px); background:transparent;" value="${desc}">
				<span class="material-icons" onclick="
				 if ($(this).html() === 'edit') {
					$(this).prev().prop('disabled', false); 
					$(this).html('save'); 
				 } else {
					 $(this).html('edit');
					 $(this).prev().prop('disabled', true); 
					 openseadragon_image_annotations.history._findObjectOnCanvasById(${object.incrementId}).set({comment: $(this).prev().val()});
				 }">edit</span> 
			</div>`);
		},
		
		_getObjectDefaultDescription: function(object) {
			switch (object.type) {
				case "rect": return `Rect [${Math.round(object.left)}, ${Math.round(object.top)}]`;
				case "polygon": return `Polygon [${Math.round(object.left)}, ${Math.round(object.top)}]`;
				case "ellipse": return`Ellipse [${Math.round(object.left)}, ${Math.round(object.top)}]`;
				default:
					return;
			}
		},

		_getObjectDefaultIcon: function(object) {
			return {"rect": "crop_5_4", "polygon":"share", "ellipse":"circle"}[object.type];
		},

		_performSwap: async function(canvas, toAdd, toRemove) {
			if (toRemove) {
				let center = toRemove.getCenterPoint();
				this._focus(center.x, center.y);
				await sleep(150); //let user to orient where canvas moved before deleting the element
				canvas.remove(toRemove);				
				this._removeFromBoard(toRemove);

				if (toAdd) {
					canvas.add(toAdd);
					openseadragon_image_annotations.overlay.fabricCanvas().setActiveObject(toAdd);
					this._addToBoard(toAdd);
				}
				canvas.renderAll();

			} else if (toAdd) {
				let center = toAdd.getCenterPoint();
				this._focus(center.x, center.y);	
				await sleep(150); //let user to orient where canvas moved before deleting the element
				canvas.add(toAdd);
				openseadragon_image_annotations.overlay.fabricCanvas().setActiveObject(toAdd);
				canvas.renderAll();
				this._addToBoard(toAdd);
			}
		},

		_findObjectOnCanvasById: function(id) {
			// console.log(this.overlay.fabricCanvas()._objects);
			// console.log(coords);
			// console.log(this.overlay.fabricCanvas()._searchPossibleTargets(this.overlay.fabricCanvas()._objects, coords));
	
			// return this.overlay.fabricCanvas()._searchPossibleTargets(this.overlay.fabricCanvas()._objects, coords);

			//todo fabric.js should have some way how to avoid linear iteration over all objects...
			let target = null;
			openseadragon_image_annotations.overlay.fabricCanvas()._objects.some(o => {
				if (o.incrementId === id) {
					target = o;
					return true;
				}
				return false;
			});
			return target;
		},
	}, // end of namespace history

	messenger: {
		MSG_INFO: {class: "", icon: '<path fill-rule="evenodd"d="M6.3 5.69a.942.942 0 0 1-.28-.7c0-.28.09-.52.28-.7.19-.18.42-.28.7-.28.28 0 .52.09.7.28.18.19.28.42.28.7 0 .28-.09.52-.28.7a1 1 0 0 1-.7.3c-.28 0-.52-.11-.7-.3zM8 7.99c-.02-.25-.11-.48-.31-.69-.2-.19-.42-.3-.69-.31H6c-.27.02-.48.13-.69.31-.2.2-.3.44-.31.69h1v3c.02.27.11.5.31.69.2.2.42.31.69.31h1c.27 0 .48-.11.69-.31.2-.19.3-.42.31-.69H8V7.98v.01zM7 2.3c-3.14 0-5.7 2.54-5.7 5.68 0 3.14 2.56 5.7 5.7 5.7s5.7-2.55 5.7-5.7c0-3.15-2.56-5.69-5.7-5.69v.01zM7 .98c3.86 0 7 3.14 7 7s-3.14 7-7 7-7-3.12-7-7 3.14-7 7-7z"/>'},
		MSG_WARN: {class: "Toast--warning", icon: '<path fill-rule="evenodd" d="M8.893 1.5c-.183-.31-.52-.5-.887-.5s-.703.19-.886.5L.138 13.499a.98.98 0 0 0 0 1.001c.193.31.53.501.886.501h13.964c.367 0 .704-.19.877-.5a1.03 1.03 0 0 0 .01-1.002L8.893 1.5zm.133 11.497H6.987v-2.003h2.039v2.003zm0-3.004H6.987V5.987h2.039v4.006z" />'},
		MSG_ERR: {class: "Toast--error", icon:'<path fill-rule="evenodd" d="M10 1H4L0 5v6l4 4h6l4-4V5l-4-4zm3 9.5L9.5 14h-5L1 10.5v-5L4.5 2h5L13 5.5v5zM6 4h2v5H6V4zm0 6h2v2H6v-2z" />'},
		_timer: null,

		init: function() {
			//$("body").append('<div class="popUpHide" id="annotation-messages-container"><span id="annotation-messages"></span>&emsp;<span onclick="openseadragon_image_annotations.messenger.hide(false);" style="cursor:pointer;" class="material-icons">close</span></div>');
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
		},

		show: function(text, delayMS, importance) {

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

		hide: function(_autoCalled=true) {
			console.log("remove", this._body)
			this._body.removeClass("popUpEnter");
			this._body.addClass("popUpHide");

			if (!_autoCalled) {
				clearTimeout(this._timer);
			}
			this._timer = null;
		}
	}  // end of namespace messenger

}; // end of namespace
