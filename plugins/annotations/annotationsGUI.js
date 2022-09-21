class AnnotationsGUI {

	//TODO https://alimozdemir.com/posts/fabric-js-history-operations-undo-redo-and-useful-tips/
	// - history implementation within fabric (better than mine?)
	// - blending!!!!!

	constructor(id, params) {
		this.id = id;
		this._server = PLUGINS[this.id].server;
		this._allowedFactories = PLUGINS[this.id].factories || ["polygon"];
	}

	/*
	Initialize member variables
	*/
	pluginReady() {
		//Register used annotation object factories
		this.context = OSDAnnotations.instance();
		this.context.setModeUsed("AUTO");
		this.context.setModeUsed("CUSTOM");
		this.context.setModeUsed("FREE_FORM_TOOL_ADD");
		this.context.setModeUsed("FREE_FORM_TOOL_REMOVE");

		//by default no preset is active, make one
		this.context.setPreset();

		this.dataLoader = new AnnotationsGUI.DataLoader(this);

		const _this = this;

		this.initHandlers();
		//init on html sooner than history so it is placed above
		this.initHTML();
		//after HTML added
		this.updatePresetsHTML();
		this.setupTutorials();

		let opacityControl = $("#annotations-opacity");
		opacityControl.val(this.context.getOpacity());
		opacityControl.on("input", function () {
			if (_this.context.disabledInteraction) return;
			_this.context.setOpacity(Number.parseFloat($(this).val()));
		});

		USER_INTERFACE.AdvancedMenu.setMenu(this.id, "annotations-shared", "Share",
				`<h3 class="f2-light">Annotations</h3><div id="annotations-option-panel">
${UIComponents.Elements.checkBox({
	label: " Show outline only.",
	onchange: `${this.id}.context.presets.setModeOutline(this.checked == true);`,
	default: this.context.presets.getModeOutline()
})}
</div>
<br>
<div id="annotations-shared-head"></div><div id="available-annotations"></div>`);
		this.annotationsMenuBuilder = new UIComponents.Containers.RowPanel("available-annotations");
		this.loadAnnotationsList();

		this.preview = new AnnotationsGUI.Previewer("preview", this);
		this.advancedControls = new AnnotationsGUI.AdvancedControls("advancedControls", this);
	} // end of initialize

	/****************************************************************************************************************

									HTML MANIPULATION

	*****************************************************************************************************************/

	initHTML() {
		USER_INTERFACE.MainMenu.append(
			"Annotations",
			`
<span class="material-icons btn-pointer" onclick="USER_INTERFACE.Tutorials.show()" title="Help" style="float: right;">help</span>
<span class="material-icons btn-pointer" title="Export annotations" style="float: right;" id="annotations-cloud" onclick="USER_INTERFACE.AdvancedMenu.openSubmenu('${this.id}', 'annotations-shared');">cloud_upload</span>
<span class="material-icons btn-pointer" id="show-annotation-board" title="Show board" style="float: right;" data-ref="on" onclick="${this.id}.context.history.openHistoryWindow();">assignment</span>
<span class="material-icons btn-pointer" id="enable-disable-annotations" title="Enable/disable annotations" style="float: right;" data-ref="on" onclick="${this.id}._toggleEnabled(this)"> visibility</span>`,
			`
<span>Opacity: &emsp;</span>
<input type="range" id="annotations-opacity" min="0" max="1" step="0.1"><br><br>${this.presetControls()}
<a id="download_link1" download="annotations.json" href="" hidden>Download JSON</a>
<a id="download_link2" download="annotations.xml" href="" hidden>Download XML</a>`,
// 			`<h4 class="f4 d-inline-block">Layers</h4><button class="btn btn-sm" onclick="
// ${this.id}.context.createLayer();"><span class="material-icons btn-pointer">add</span> new layer</button>
// <div id="annotations-layers"></div>`,
			"annotations-panel",
			this.id
		);

		let modeOptions = [];
		for (let mode in this.context.Modes) {
			if (!this.context.Modes.hasOwnProperty(mode)) continue;
			mode = this.context.Modes[mode];
			let selected = mode.default() ? "checked" : "";
			modeOptions.push(`<input type="radio" id="${mode.getId()}-annotation-mode" class="d-none switch" ${selected} name="annotation-modes-selector">
<label for="${mode.getId()}-annotation-mode" class="label-annotation-mode position-relative" onclick="${this.id}.context.setModeById('${mode.getId()}');" title="${mode.getDescription()}"><span class="material-icons btn-pointer p-1 rounded-2">${mode.getIcon()}</span></label>`);
		}

		//status bar
		USER_INTERFACE.Tools.setMenu(this.id, "annotations-tool-bar", "Annotations",
			`<div class="px-2 py-1">${modeOptions.join("")}<span style="width: 1px; height: 28px; background: var(--color-text-tertiary); 
vertical-align: middle; opacity: 0.3;" class="d-inline-block mx-1"></span>&nbsp;<div id="mode-custom-items" 
class="d-inline-block">${this.context.mode.customHtml()}</div></div>`, 'draw');

	}

	initHandlers() {
		const _this = this;

		//Add handlers when mode goes from AUTO and to AUTO mode (update tools panel)
		this.context.addHandler('mode-changed', this.annotationModeChanged);
		this.context.addHandler('enabled', this.annotationsEnabledHandler);

		// this.context.forEachLayerSorted(l => {
		// 	_this.insertLayer(l);
		// });
		// this.context.addHandler('layer-added', e => {
		// 	_this.insertLayer(e.layer, e.layer.name);
		// });

		let strategy = this.context.automaticCreationStrategy;
		if (strategy && this.context.autoSelectionEnabled) {
			this.context.Modes.AUTO.customHtml = this.getAutoCreationStrategyControls.bind(this);
			//on visualisation change update auto UI
			VIEWER.addHandler('visualisation-used', function (visualisation) {
				_this.updateAutoSelect(visualisation);
			});
		}
		this.context.Modes.FREE_FORM_TOOL_ADD.customHtml =
			this.context.Modes.FREE_FORM_TOOL_REMOVE.customHtml =
				this.freeFormToolControls.bind(this);

		this.context.addHandler('free-form-tool-radius', function (e) {
			$("#fft-size").val(e.radius);
		});
	}

	setupTutorials() {
		USER_INTERFACE.Tutorials.add(
			this.id, "Annotations Plugin Overview", "get familiar with the annotations plugin", "draw", [
			{
				"next #annotations-panel": "Annotations allow you to annotate <br>the canvas parts and export and share all of it."
			},{
				"next #enable-disable-annotations": "This icon can temporarily disable <br>all annotations - not just hide, but disable also <br>all annotation controls and hotkeys."
			},{
				"next #annotations-left-click": "Each of your mouse buttons<br>can be used to create annotations.<br>Simply assign some pre-set and start annotating!<br>Shape change can be done quickly by mouse hover."
			},{
				"click #annotations-right-click": "Click on one of these buttons<br>to open <b>Presets dialog window</b>."
			},{
				"next #preset-no-0": "This is an example of an annotation preset."
			},{
				"click #preset-add-new": "We want to keep the old preset,<br>so create a new one. Click on 'New'."
			},{
				"next #preset-no-1": "Click anywhere on the preset. This will select it for the right mouse button."
			},{
				"click #select-annotation-preset-right": "Click <b>Set for right click</b> to assign it to the right mouse button."
			}, {
				"next #viewer-container": "You can now use right mouse button<br>to create a polygons,<br>or the left button for different preset - at once!"
			},{
				"click #annotations-tool-bar-input-header + label": "Click here to open the annotations toolbar.<br> If it's opened, click anyway :)"
			},{
				"next #plugin-tools-menu": "Apart from the default, navigation mode, you can switch <br> to and control different annotation modes here.<br>Modes are closely described in other tutorials."
			}]
		);

		USER_INTERFACE.Tutorials.add(
			this.id, "Automatic annotations", "learn how to let the computer do the job", "auto_fix_high", [
				{
					"next #auto-annotation-mode + label": "In the navigation mode,<br>double-click on the canvas allows you to<br>automatically annotate regions."
				}, {
					"next #mode-custom-items": "This select specifies which layer will be annotated.<br>For now, it is not possible in the tissue itself."
				}, {
					"next #panel-shaders": "When you double-click on the canvas,<br>all close parts of the selected layer will be outlined.<br>It is therefore a good idea to first izolate the region of interest <br> (e.g. apply threshold if available)."
				}, {
					"next #annotations-left-click": "If you use POLYGON, the outline will fit perfectly,<br>but click outside a region is ignored.<br>Creation might also fail - you can try adjusting ZOOM level<br>or clicking on a different spot."
				}, {
					"next #annotations-left-click": "Rectangle and ellipse will try to fit the data in layer you selected, <br> but if you click somewhere without data, a default-size object will be created."
				}, {
					"next #viewer-container": "Now you can try it out."
				}
			]
		);

		USER_INTERFACE.Tutorials.add(
			this.id, "Custom annotations", "create annotations with your hand", "architecture", [
				{
					"next #custom-annotation-mode + label": "You need to be in custom mode. We recommend using 'Left Alt' key <br> instead of setting this manually."
				}, {
					"next #annotations-left-click": "With POLYGON you can click or drag to create its vertices.<br> Polygon creation will be finished if create a point <br> inside the red vertex, or when you change the mode<br> (e.g. release Alt key)."
				}, {
					"next #annotations-left-click": "Rectangle and ellipse can be created by a drag."
				}, {
					"next #viewer-container": "Now you can try it out."
				}
			]
		);

		USER_INTERFACE.Tutorials.add(
			this.id, "Free form tool", "painting with your mouse", "gesture", [
				{
					"click #fft-annotation-mode + label": "Click here to switch to the free form tool.<br>We recommend using 'Left Shift' key <br> instead in the future."
				}, {
					"next #viewer-container": "Now you can draw a polygon by a free hand."
				}, {
					"next #fft-mode-add-radio + label": "Selected object can be appended to (Left Shift only) ..."
				}, {
					"next #fft-mode-remove-radio + label": "... or removed from (Left Shift + Left Alt)."
				}, {
					"next #fft-size": "The brush size can be changed here or with a mouse wheel."
				},{
					"next #viewer-container": "Now you can try it out.<br>Note that key shortcuts do not work<br>when the mode is selected manually."
				}
			]
		);

		USER_INTERFACE.Tutorials.add(
			this.id, "Other UI Controls", "annotations management", "dashboard_customize", [
				{
					"next #viewer-container": "There are much more features included."
				},
				{
					"next #show-annotation-board": "Annotation board helps you with annotations management.<br>The board opens in a separate window.<br>It allows you to edit annotations."
				},
				{
					"next #viewer-container": "A history is also available.<br> Shortcut is undo:Ctrl+Z and redo:Ctrl+Shift+Z<br>(or use the annotation board)."
				},
				{
					"click #annotations-cloud": "Click here to open export options."
				},
				{
					"next #gui_annotations": "Apart from file exports/imports, you can also use shared annotations if available."
				},
			]
		);
	}

	annotationModeChanged(e) {
		$("#mode-custom-items").html(e.mode.customHtml());
		$(`#${e.mode.getId()}-annotation-mode`).prop('checked', true);
	}

	annotationsEnabledHandler(e) {
		if (e.isEnabled) {
			$("#annotations-tool-bar").removeClass('disabled');
			$("#annotations-opacity").attr("disabled", false);
		} else {
			$("#annotations-tool-bar").addClass('disabled');
			$("#annotations-opacity").attr("disabled", true);
		}
	}

	_toggleEnabled(node) {
		let self = $(node);
		if (this.context.disabledInteraction){
			this.context.enableAnnotations(true);
			self.html('visibility');
			self.attr('data-ref', 'on');
		} else {
			this.context.enableAnnotations(false);
			self.html('visibility_off');
			self.attr('data-ref', 'off');
		}
	}

	/******************** Free Form Tool ***********************/

	freeFormToolControls() {
		return `<span class="position-absolute top-0" style="font-size: xx-small" title="Size of a brush (scroll to change).">Brush radius:</span>
<input class="form-control" title="Size of a brush (scroll to change)." type="number" min="5" max="100" 
step="1" name="freeFormToolSize" id="fft-size" autocomplete="off" value="${this.context.freeFormTool.screenRadius}"
style="height: 22px; width: 60px;" onchange="${this.id}.context.freeFormTool.setSafeRadius(Number.parseInt(this.value));">`;
	}

	/******************** LAYERS ***********************/

	// Blending = {
	// 	DEFAULT: 'source-over',
	// 	AND: 'source-in',
	// 	MASK_FG: 'source-atop',
	// 	DIFF: 'source-out',
	// 	MASK_AND: 'destination-in',
	// 	MASK_DIFF: 'destination-out',
	// 	MASK_BG: 'destination-atop',
	// 	XOR: 'xor'
	// };
	// globalCompositeOperation

	// insertLayer(layer, name) {
	// 	console.log("ADDED");
	// 	let container = $('#annotations-layers');
	// 	name = name || "Layer " + layer.id;
	// 	container.append(`<div id="a_layer_${layer.id}" onclick="${this.id}.context.setActiveLayer(${layer.id});">${name}</div>`);
	//
	// 	this.context.forEachLayerSorted(l => {
	// 		let ch = container.find(`#a_layer_${l.id}`);
	// 		container.append(ch);
	// 	});
	// }
	//
	// setBlending(blending) {
	// 	this.canvas.globalCompositeOperation = blending;
	// 	this.canvas.renderAll();
	// }

	/******************** AUTO DETECTION ***********************/

	getDetectionControlOptions(visualisation) {
		let autoStrategy = this.context.automaticCreationStrategy;
		if (!autoStrategy.running) return "";
		let html = "";

		let index = -1;
		let layer = null;
		let key = "";
		for (key in visualisation.shaders) {
			if (!visualisation.shaders.hasOwnProperty(key)) continue;
			layer = visualisation.shaders[key];
			if (isNaN(layer.index)) continue;

			let errIcon = autoStrategy.compatibleShaders.some(type => type === layer.type) ? "" : "&#9888; ";
			let errData = errIcon ? "data-err='true' title='Layer visualization style not supported with automatic annotations.'" : "";
			let selected = "";

			if (layer.index === autoStrategy.getLayerIndex()) {
				index = layer.index;
				autoStrategy.setLayer(index, key);
				selected = "selected";
			}
			html += `<option value='${key}' ${selected} ${errData}>${errIcon}${layer.name}</option>`;
		}

		if (index < 0) {
			if (!layer) return;
			autoStrategy.setLayer(layer.index, key);
			html = "<option selected " + html.substr(8);
		}
		return html;
	}

	updateAutoSelect(visualisation) {
		$("#sensitivity-auto-outline").html(this.getDetectionControlOptions(visualisation));
	}

	getAutoCreationStrategyControls() {
		let strategy = this.context.automaticCreationStrategy;
		if (!strategy || !strategy.running) return "";
		return `<span class="d-inline-block position-absolute top-0" style="font-size: xx-small;" title="What layer is used to create automatic 
annotations."> Automatic annotations detected in: </span><select title="What layer is selected for the data." style="min-width: 180px; max-width: 250px;"
type="number" id="sensitivity-auto-outline" class="form-select select-sm" onchange="${this.id}.setAutoTargetLayer(this);">
${this.getDetectionControlOptions(VIEWER.bridge.visualization())}</select>`;
	}

	setAutoTargetLayer(self) {
		self = $(self);
		let key = self.val(),
		   layer = VIEWER.bridge.visualization().shaders[key];
		this.context.automaticCreationStrategy.setLayer(layer.index, key);
	}

	/******************** PRESETS ***********************/
	/**
	 * GUI Item, ho left/right button looks like when no preset is set for it
	 * @param {boolean} isLeftClick true if the preset is for the left mouse btn
	 * @returns {string} HTML
	 */
	getMissingPresetHTML(isLeftClick) {
		return `<div class="border-md border-dashed p-1 mx-2 rounded-3" style="border-width:3px!important;" 
onclick="${this.id}.showPresets(${isLeftClick});"><span class="material-icons">add</span> Add</div>`;
	}

	/**
	 * GUI Item, ho left/right button looks like when it has a preset assigned
	 * @param {OSDAnnotations.Preset} preset object
	 * @param {boolean} isLeftClick true if for the left mouse button
	 * @returns {string} HTML
	 */
	getPresetControlHTML(preset, isLeftClick) {
		let category = preset.getMetaValue('category') || preset.objectFactory.title();
		let icon = preset.objectFactory.getIcon();

		let changeHtml = "";
		Object.values(this.context.objectFactories).forEach(factory => {
			if (!this._allowedFactories.find(t => factory.factoryId === t)) return;

			if (factory.factoryId !== preset.objectFactory.factoryId) {
				changeHtml += `<div onclick="${this.id}.updatePreset(${preset.presetID}, 
{objectFactory: ${this.id}.context.getAnnotationObjectFactory('${factory.factoryId}')}); 
event.stopPropagation(); window.event.cancelBubble = true;"><span class="material-icons" 
style="color: ${preset.color};">${factory.getIcon()}</span>  ${factory.title()}</div>`;
			}
		});

		return `<div class="position-relative border-md p-1 mx-2 rounded-3 px-1" style="border-width:3px!important;"
onclick="${this.id}.showPresets(${isLeftClick});"><span class="material-icons pr-0" 
style="color: ${preset.color};">${icon}</span>  <span class="one-liner d-inline-block v-align-middle" 
style="width: 115px;">${category}</span>
<div class="quick_selection color-bg-primary border-md p-1 rounded-3">${changeHtml}</div></div>`;
	}

	/**
	 * Preset modification GUI part, used to show preset modification tab
	 * @param {Number} id preset id
	 * @param {boolean} isLeftClick true if the button is the left one
	 * @param {Number} index if set, the element is assigned an ID in the HTML, should differ in each call if set
	 * @returns {string} HTML
	 */
	getPresetHTMLById(id, isLeftClick, index = undefined) {
		let preset = this.context.presets.get(id);
		if (!preset) {
			return "";
		}
		return this.getPresetHTML(preset, isLeftClick, index);
	}

	/**
	 * Load presets from a file
	 * @param {Event} e event of the file load
	 */
	importFromFile(e, annotations=true) {
		let file = e.target.files[0];
		if (!file) return;
		let fileReader = new FileReader();
		let _this = this;
		fileReader.onload = function (e) {
			try {
				if (annotations) {
					_this.context.loadObjects(JSON.parse(e.target.result));
				} else {
					_this.context.presets.import(e.target.result);
					_this.updatePresetsHTML();
				}
				Dialogs.show("Loaded.", 1500, Dialogs.MSG_INFO);
			} catch (e) {
				console.log(e);
				Dialogs.show("Failed to load the file.", 2500, Dialogs.MSG_ERR);
			}
		};
		fileReader.readAsText(file);
	}

	/**
	 * Export annotations and download them
	 */
	exportToFile() {
		UTILITIES.downloadAsFile("annotations_export.json", JSON.stringify(this.context.getObjectContent()));
		UTILITIES.downloadAsFile("annotations_asap_xml_export.xml", this.context.getXMLStringContent());
	}

	/**
	 * Makes the browser download the export() output
	 */
	exportPresetsToFile() {
		UTILITIES.downloadAsFile("annotation-presets.json", this.context.presets.export());
	}

	/**
	 * Output GUI HTML for presets
	 * @returns {string} HTML
	 */
	presetControls() {
		return `<span id="annotations-left-click" class="d-inline-block position-relative" 
style="width: 180px; cursor:pointer;"></span><span id="annotations-right-click" 
class="d-inline-block position-relative" style="width: 180px; cursor:pointer;"></span>`;
	}

	/**
	 * Output additional GUI HTML for presets
	 * @returns {string} HTML
	 */
	presetExportControls() {
		return `
<button id="presets-download" onclick="${this.id}.exportPresetsToFile();" class="btn">Export presets.</button>&nbsp;
<button id="presets-upload" onclick="this.nextElementSibling.click();" class="btn">Import presets.</button>
<input type='file' style="visibility:hidden; width: 0; height: 0;" 
onchange="${this.id}.importFromFile(event, false);$(this).val('');" />`;
	}

	/**
	 * Update main HTML GUI part of presets upon preset change
	 */
	updatePresetsHTML() {
		let leftPreset = this.context.getPreset(true),
			rightPreset = this.context.getPreset(false);

		if (leftPreset && this._allowedFactories.find(t => leftPreset.objectFactory.factoryId === t)) {
			$("#annotations-left-click").html(this.getPresetControlHTML(leftPreset, true));
		} else $("#annotations-left-click").html(this.getMissingPresetHTML(true));

		if (rightPreset && this._allowedFactories.find(t => leftPreset.objectFactory.factoryId === t)) $("#annotations-right-click").html(this.getPresetControlHTML(rightPreset, false));
		else $("#annotations-right-click").html(this.getMissingPresetHTML(false));
	}

	/**
	 * Preset modification GUI part, used to show preset modification tab
	 * @param {OSDAnnotations.Preset} preset object
	 * @param {boolean} isLeftClick true if the button is the left one
	 * @param {Number} index if set, the element is assigned an ID in the HTML, should differ in each call if set
	 * @returns {string} HTML
	 */
	getPresetHTML(preset, isLeftClick, index = undefined) {
		let select = "",
			currentPreset = this.context.getPreset(isLeftClick);

		Object.values(this.context.objectFactories).forEach(factory => {
			if (!this._allowedFactories.find(t => factory.factoryId === t)) return;

			if (factory.factoryId === preset.objectFactory.factoryId) {
				select += `<option value="${factory.factoryId}" selected>${factory.title()}</option>`;
			} else {
				select += `<option value="${factory.factoryId}">${factory.title()}</option>`;
			}
		});

		let id = index === undefined ? "" : `id="preset-no-${index}"`;

		let html = `<div ${id} class="position-relative border-md v-align-top border-dashed p-1 rounded-3 d-inline-block `;
		if (preset === currentPreset) {
			html += `highlighted-preset"`;
			this._presetSelection = preset.presetID;
		} else html += `"`;

		let inputs = [];
		for (let key in preset.meta) {
			inputs.push(this._metaFieldHtml(preset.presetID, key, preset.meta[key], key !== 'category'));
		}

		return `${html} style="cursor:pointer; margin: 5px;" 
onclick="$(this).parent().children().removeClass('highlighted-preset');$(this).addClass('highlighted-preset');
${this.id}._presetSelection = ${preset.presetID}"><span class="material-icons btn-pointer position-absolute top-0 right-0 px-0" 
onclick="${this.id}.removePreset(this, ${preset.presetID});">delete</span>
<span class="show-hint d-inline-block my-1" data-hint="Annotation"><select class="form-control" onchange="
${this.id}.updatePreset(${preset.presetID}, {objectFactory: 
${this.id}.context.getAnnotationObjectFactory(this.value)});">${select}</select></span>
<span class="show-hint d-inline-block my-1" data-hint="Color"><input class="form-control" type="color" style="height:33px;" 
onchange="${this.id}.updatePreset(${preset.presetID}, {color: this.value});" value="${preset.color}"></span>
<br>${inputs.join("")}<div> <input class="form-control my-1" type="text" placeholder="new field" style="width: 140px;">
<span class="material-icons btn-pointer" onclick="${this.id}.insertPresetMeta(this, ${preset.presetID});">playlist_add</span></div></div>`;
	}

	removePreset(buttonNode, presetId) {
		let removed = this.context.presets.removePreset(presetId);
		if (removed) {
			$(buttonNode).parent().remove();
			if (removed === this.context.getPreset(false)) {
				$("#annotations-right-click").html(this.getMissingPresetHTML(false));
			}
			if (removed === this.context.getPreset(true)) {
				$("#annotations-left-click").html(this.getMissingPresetHTML(true));
			}
		}
	}

	insertPresetMeta(buttonNode, presetId) {
		let input = buttonNode.previousElementSibling,
			name = input.value;
		if (!name) {
			Dialogs.show("You must add a name of the new field.", 2500, Dialogs.MSG_ERR);
			return;
		}

		let key = this.context.presets.addCustomMeta(presetId, buttonNode.previousElementSibling.value, "");
		if (key) {
			$(this._metaFieldHtml(presetId, key, {name: name, value: ""}))
				.insertBefore($(buttonNode.parentElement));
			input.value = "";
			return;
		}
		Dialogs.show("Failed to create new metadata field " + name, 2500, Dialogs.MSG_ERR);
	}

	deletePresetMeta(inputNode, presetId, key) {
		if (this.context.presets.deleteCustomMeta(presetId, key)) {
			$(inputNode.parentElement).remove();
			return;
		}
		Dialogs.show("Failed to delete meta field.", 2500, Dialogs.MSG_ERR);
	}

	updatePreset(presetId, properties) {
		let updated = this.context.presets.updatePreset(presetId, properties);
		if (updated) {
			this.updatePresetsHTML();
		}
	}

	_metaFieldHtml(presetId, key, metaObject, allowDelete=true) {
		let delButton = allowDelete ? `<span 
class="material-icons btn-pointer position-absolute right-0" style="font-size: 17px;"
onclick="${this.id}.deletePresetMeta(this, ${presetId}, '${key}')">delete</span>` : "";

		return `<div class="show-hint" data-hint="${metaObject.name}"><input class="form-control my-1" type="text" onchange="
${this.id}.updatePreset(${presetId}, {${key}: this.value});" value="${metaObject.value}">${delButton}</div>`;
	}

	/**
	 * Show the user preset modification tab along with the option to select an active preset for either
	 * left or right mouse button
	 * @param {boolean} isLeftClick true if the modification tab sets left preset
	 */
	showPresets(isLeftClick) {
		if (this.context.disabledInteraction) {
			Dialogs.show("Annotations are disabled. <a onclick=\"$('#enable-disable-annotations').click();\">Enable.</a>", 2500, Dialogs.MSG_WARN);
			return;
		}
		this._presetSelection = undefined;

		let html = [],
			counter = 0,
			_this = this;

		this.context.presets.foreach(preset => {
			html.push(_this.getPresetHTML(preset, isLeftClick, counter));
			counter++;
		});

		html.push(`<div id="preset-add-new" class="border-dashed p-1 mx-2 my-2 rounded-3 d-inline-block 
${this.id}-plugin-root" style="vertical-align:top; width:150px; cursor:pointer; border-color: var(--color-text-primary);" onclick="
${this.id}.createNewPreset(this, ${isLeftClick});"><span class="material-icons">add</span> New</div>`);

		Dialogs.showCustom("preset-modify-dialog",
			"<b>Annotations presets</b>",
			html.join(""),
			`<div class="d-flex flex-row-reverse">
<button id="select-annotation-preset-right" onclick="return ${this.id}._clickPresetSelect(false);" 
oncontextmenu="return ${this.id}._clickPresetSelect(false);" class="btn m-2">Set for right click </button>
<button id="select-annotation-preset-left" onclick="return ${this.id}._clickPresetSelect(true);" 
class="btn m-2">Set for left click </button>
</div>`);
	}

	_clickPresetSelect(isLeft) {
		if (this._presetSelection === undefined) {
			Dialogs.show('You must click on a preset to be selected first.', 5000, Dialogs.MSG_WARN);
			return false;
		}
		const _this = this;
		setTimeout(function() {
			Dialogs.closeWindow('preset-modify-dialog');
			_this.selectPreset(isLeft);
		}, 150);
		return false;
	}

	createNewPreset(buttonNode, isLeftClick) {
		let id = this.context.presets.addPreset().presetID,
			node = $(buttonNode);
		node.before(this.getPresetHTMLById(id, isLeftClick, node.index()));
	}

	selectPreset(isLeftClick) {
		this.context.presets.selectPreset(this._presetSelection, isLeftClick);
		this.updatePresetsHTML();
	}

	/*** GETTERS **/

	getFullExportData(name) {
		let now = Date.now();
		return {
			annotations: this.context.getObjectContent(),
			presets: this.context.presets.toObject(),
			metadata: {
				name: name || `a${now}`,
				exported: new Date(now).toLocaleString(),
				userAgent: UTILITIES.getUserMeta().userAgent
				//todo other metadata?
			}
		};
	}

    loadAnnotationsList() {
		this.annotationsMenuBuilder.clear();

		//todo cannot use more than one tissue at time, hardcoded :/
        let bgImage = APPLICATION_CONTEXT.setup.background[0];
        if (!bgImage) {
            $("#annotations-shared-head").html(this.getAnnotationsHeadMenu("No image for annotations available."));
            return;
        }

        this.activeTissue = APPLICATION_CONTEXT.setup.data[bgImage.dataReference];
		const _this = this;
		this.dataLoader.loadAnnotationsList(this._server, this.activeTissue, json => {
			let count = 0;
			//_this.availableAnnotations = json;
			for (let available of json.annotations) {
				let meta = available.metadata;
				let actionPart = `
<span onclick="${this.id}.loadAnnotation('${available.id}');return false;" title="Download" class="material-icons btn-pointer">download</span>&nbsp;
<span onclick="${this.id}.updateAnnotation('${available.id}');return false;" title="Update" class="material-icons btn-pointer">update</span>&nbsp;
<span onclick="${this.id}.removeAnnotation('${available.id}');return false;" title="Delete" class="material-icons btn-pointer">delete</span>`;
				_this.annotationsMenuBuilder.addRow({
					title: meta.name,
					author: "Author",
					details: `Uploaded ${new Date(meta.exported).toDateString()}. Client: ${meta.userAgent ? meta.userAgent.split(" ")[0] : "undefined"}`,
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
		}, error => {
			$("#annotations-shared-head").html(_this.getAnnotationsHeadMenu("Could not load annotations list."));
		});
    }

    getAnnotationsHeadMenu(error="") {
        let upload = error ? "" : `<button class="btn float-right" onclick="${this.id}.uploadAnnotation()">Create: upload current state</button>`;
        error = error ? `<div class="error-container m-2">${error}</div>` : "";
        return `<span class="text-small">
for slide ${this.activeTissue}</span>${upload}${error}<br><br>
<button id="downloadAnnotation" onclick="${this.id}.exportToFile();return false;" class="btn">Download as a file.</button>&nbsp;
<button id="importAnnotation" onclick="this.nextElementSibling.click();return false;" class="btn">Import from a file.</button>
<input type='file' style="visibility:hidden; width: 0; height: 0;" 
onchange="${this.id}.importFromFile(event);$(this).val('');" />&nbsp;
${this.presetExportControls()}
<br><br><br><h4 class="f3-light header-sep">Available annotations</h4>
`;
    }

    loadAnnotation(id, force=false) {
        const _this = this;

		this.dataLoader.loadAnnotation(this._server, id, json => {
                $('#preset-modify-dialog').remove();
                _this.context.presets.import(json.presets);
                _this.updatePresetsHTML();

				_this.context.loadObjects(json.annotations);
                $("#annotations-shared-head").html(_this.getAnnotationsHeadMenu());
                Dialogs.show("Loaded.", 1000, Dialogs.MSG_INFO);
            },
			e => {
                console.error(e);
                Dialogs.show("Could not load annotations. Please, let us know about this issue and provide " +
                    `<a onclick=\"${_this.id}.exportToFile()\">exported file</a>.`,
                    20000, Dialogs.MSG_ERR);
            }
        );
    }

    updateAnnotation(id) {
        const _this = this;
        this.dataLoader.updateAnnotation(this._server, Number.parseInt(id), this.getFullExportData(),
			json => {
				Dialogs.show("Annotations uploaded.", 2000, Dialogs.MSG_INFO);
				_this.loadAnnotationsList();
			},
			e => {
				Dialogs.show(`Failed to upload annotations. You can 
<a onclick="${_this.id}.exportToFile()">Export them instead</a>, and upload later.`,
					7000, Dialogs.MSG_ERR);
				console.error("Failed to update annotation id " + id, e);
			}
		);
    }

    removeAnnotation(id) {
        const _this = this;
        this.dataLoader.removeAnnotation(this._server, id,
			json => {
				Dialogs.show(`Annotation id '${id}' removed.`, 2000, Dialogs.MSG_INFO);
				_this.loadAnnotationsList();
			},
			e => {
				Dialogs.show(`Failed to delete annotation id '${id}'.`, 7000, Dialogs.MSG_ERR);
				console.error("Failed to delete annotation id " + id, e);
			}
		);
    }

    uploadAnnotation() {
        const _this = this;
        this.dataLoader.uploadAnnotation(this._server, this.activeTissue, this.getFullExportData(),
			json => {
				Dialogs.show("Annotations uploaded.", 2000, Dialogs.MSG_INFO);
				_this.loadAnnotationsList();
			},
			e => {
				Dialogs.show(`Failed to upload annotations. You can 
<a onclick="${_this.id}.exportToFile()">Export them instead</a>, and upload later.`,
					7000, Dialogs.MSG_ERR);
				console.error("Failed to upload annotations.", e);
			}
		);
    }
}

/*------------ Initialization of OSD Annotations ------------*/
addPlugin("gui_annotations", AnnotationsGUI);
