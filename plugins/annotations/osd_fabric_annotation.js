class AnnotationsGUI {
	constructor(id, params) {
		this.id = id;
		this._server = PLUGINS.each[this.id].server;
	}

	/*
	Initialize member variables
	*/
	pluginReady() {
		//Register used annotation object factories
		this.context = OSDAnnotations.instance();
		this.context.setModeUsed("AUTO");
		this.context.setModeUsed("CUSTOM");
		this.context.setModeUsed("FREE_FORM_TOOL");

		const _this = this;

		//init on html sooner than history so it is placed above
		this.initHTML();
		//after HTML added
		this.updatePresetsHTML();
		this.setupTutorials();

		let opacityControl = $("#annotations-opacity");
		opacityControl.val(this.context.getOpacity());
		opacityControl.on("input", function () {
			_this.context.setOpacity(Number.parseInt($(this).val()));
		});
		this.loadAnnotationsList();
	} // end of initialize

	/****************************************************************************************************************

									HTML MANIPULATION

	*****************************************************************************************************************/

	initHTML() {
		let autoSelectionControls = this.context.autoSelectionEnabled ?
			this.context.automaticCreationStrategy.sensitivityControls() : "";
		autoSelectionControls += "<br>";

		USER_INTERFACE.MainMenu.append(
			"Annotations",
			`
<span class="material-icons pointer" onclick="USER_INTERFACE.Tutorials.show()" title="Help" style="float: right;">help</span>
<span class="material-icons pointer" title="Export annotations" style="float: right;" onclick="USER_INTERFACE.AdvancedMenu.openMenu('${this.id}');">cloud_upload</span>
<span class="material-icons pointer" id="show-annotation-board" title="Show board" style="float: right;" data-ref="on" onclick="${this.id}.context.history.openHistoryWindow();">assignment</span>
<span class="material-icons pointer" id="enable-disable-annotations" title="Enable/disable annotations" style="float: right;" data-ref="on" onclick="
	let self = $(this); 
	if (self.attr('data-ref') === 'on'){
		${this.id}.context.enableAnnotations(false); self.html('visibility_off'); self.attr('data-ref', 'off');
	} else {
		${this.id}.context.enableAnnotations(true); self.html('visibility'); self.attr('data-ref', 'on');
	}"> visibility</span>`,
			`
<span>Opacity: &emsp;</span>
<input type="range" id="annotations-opacity" min="0" max="1" step="0.1"><br><br>${this.presetControls()}
<a id="download_link1" download="my_exported_file.json" href="" hidden>Download JSON</a>
<a id="download_link2" download="my_exported_file.xml" href="" hidden>Download XML</a>`,
			"annotations-panel",
			this.id
		);

		let modeOptions = [];
		for (let mode in this.context.Modes) {
			if (!this.context.Modes.hasOwnProperty(mode)) continue;
			mode = this.context.Modes[mode];
			let selected = mode.default() ? "checked" : "";
			modeOptions.push(`<input type="radio" id="${mode.getId()}-annotation-mode" class="d-none switch" ${selected} name="annotation-modes-selector">
<label for="${mode.getId()}-annotation-mode" class="label-annotation-mode" onclick="${this.id}.context.setModeById('${mode.getId()}');" title="${mode.getDescription()}"><span class="material-icons pointer p-1 rounded-2">${mode.getIcon()}</span></label>`);
		}
		//status bar
		USER_INTERFACE.Tools.setMenu(this.id, "annotations-tool-bar", "Annotations",
			`<div class="px-2 py-1">${modeOptions.join("")}<span style="width: 1px; height: 28px; background: var(--color-text-tertiary); 
vertical-align: middle; opacity: 0.3;" class="d-inline-block mx-1"></span>&nbsp;<div id="mode-custom-items" 
class="d-inline-block">${this.context.mode.customHtml()}</div></div>`, 'draw');

		//Add handlers when mode goes from AUTO and to AUTO mode (update tools panel)
		this.context.addHandler('mode-from-auto', this.annotationModeChanged);
		this.context.addHandler('mode-to-auto', this.annotationModeChanged);
		this.context.addHandler('enabled', this.annotationsEnabledHandler);
		//Rewrite mode property so that it gives us the html controls we want
		let fftMode = this.context.Modes.FREE_FORM_TOOL;
		fftMode.customHtml = this.freeFormToolControls;
		//FFt handlers
		this.context.addHandler('free-form-tool-mode-add', function (e) {
			if (e.isModeAdd) $("#fft-mode-add-radio").prop('checked', true);
			else $("#fft-mode-remove-radio").prop('checked', true);
		});
		this.context.addHandler('free-form-tool-radius', function (e) {
			$("#fft-size").val(e.radius);
		});
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

	annotationModeChanged(e) {
		$("#mode-custom-items").html(e.mode.customHtml());
		$(`#${e.mode.getId()}-annotation-mode`).prop('checked', true);
	}

	annotationsEnabledHandler(e) {
		//todo disable main panel controls too
		if (e.isEnabled) {
			$("#annotations-tool-bar").removeClass('disabled');
		} else {
			$("#annotations-tool-bar").addClass('disabled');
		}
	}

	/******************** Free Form Tool ***********************/

	freeFormToolControls() {
		let modeRemove = this.context.modifyTool.modeAdd ? "" : "checked";
		let modeAdd = this.context.modifyTool.modeAdd ? "checked" : "";

		return `<span class="position-absolute top-0" style="font-size: xx-small" title="Size of a brush used to modify annotations areas.">Brush radius:</span>
        <input class="form-control" title="Size of a brush used to modify annotations areas." type="number" min="5" max="100" step="1" name="freeFormToolSize" id="fft-size" autocomplete="off" value="${this.context.modifyTool.screenRadius}" style="height: 22px; width: 60px;">
        <input type="radio" class="d-none switch" name="fft-mode" id="fft-mode-add-radio"><label for="fft-mode-add-radio">
<span id="fft-mode-add" onclick="${this.id}.context.modifyTool.setModeAdd(true)" class="material-icons pointer p-1 rounded-2 ${modeAdd}">add_circle_outline</span>
</label><input type="radio" class="d-none switch" name="fft-mode" id="fft-mode-remove-radio"><label for="fft-mode-remove-radio">
<span id="fft-mode-remove" onclick="${this.id}.context.modifyTool.setModeAdd(false)" class="material-icons pointer p-1 rounded-2 ${modeRemove}">remove_circle_outline</span>
</label>`;
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
		let comment = preset.comment ? preset.comment : preset.objectFactory.getASAP_XMLTypeName();
		let icon = preset.objectFactory.getIcon();

		let changeHtml = "";
		Object.values(this.context.objectFactories).forEach(factory => {
			if (factory.type !== preset.objectFactory.type) {
				changeHtml += `<div onclick="${this.id}.updatePreset(${preset.presetID}, 
{objectFactory: ${this.id}.context.getAnnotationObjectFactory('${factory.type}')}); 
event.stopPropagation(); window.event.cancelBubble = true;"><span class="material-icons" 
style="color: ${preset.color};">${factory.getIcon()}</span>  ${factory.getASAP_XMLTypeName()}</div>`;
			}
		});

		return `<div class="position-relative border-md p-1 mx-2 rounded-3" style="border-width:3px!important;" 
onclick="${this.id}.showPresets(${isLeftClick});"><span class="material-icons" 
style="color: ${preset.color};">${icon}</span>  ${comment}
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
	importFromFile(e) {
		let file = e.target.files[0];
		if (!file) return;
		let fileReader = new FileReader();
		let _this = this;
		fileReader.onload = function (e) {
			_this.context.presets.import(e.target.result);
			_this.updatePresetsHTML();
		};
		fileReader.readAsText(file);
	}

	/**
	 * Makes the browser download the export() output
	 */
	exportToFile() {
		let output = new Blob([this.context.presets.export()], { type: 'text/plain' });
		let downloadURL = window.URL.createObjectURL(output);
		var downloader = document.getElementById("presets-export");
		downloader.href = downloadURL;
		downloader.download = "annotation-presets.json";
		downloader.click();
		URL.revokeObjectURL(downloadURL);
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
<button id="presets-download" onclick="${this.id}.exportToFile();" class="btn">Export presets.</button>&nbsp;
<a style="display:none;" id="presets-export"  HTTP-EQUIV="Content-Disposition" CONTENT="attachment; filename=whatever.pdf"></a>
<button id="presets-upload" onclick="this.nextSibling.click();" class="btn">Import presets.</button>
<input type='file' style="visibility:hidden; width: 0; height: 0;" 
onchange="${this.id}.importFromFile(event);$(this).val('');" />`;
	}

	/**
	 * Update main HTML GUI part of presets upon preset change
	 */
	updatePresetsHTML() {
		let leftPreset = this.context.presets.left,
			rightPreset = this.context.presets.right;
		if (leftPreset) $("#annotations-left-click").html(this.getPresetControlHTML(leftPreset, true));
		else $("#annotations-left-click").html(this.getMissingPresetHTML(true));

		if (rightPreset) $("#annotations-right-click").html(this.getPresetControlHTML(rightPreset, false));
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
			currentPreset = isLeftClick ? this.context.presets.left : this.context.presets.right;

		Object.values(this.context.objectFactories).forEach(factory => {
			if (factory.type === preset.objectFactory.type) {
				select += `<option value="${factory.type}" selected>${factory.getASAP_XMLTypeName()}</option>`;
			} else {
				select += `<option value="${factory.type}">${factory.getASAP_XMLTypeName()}</option>`;
			}
		});

		let id = index === undefined ? "" : `id="preset-no-${index}"`;

		let html = `<div ${id} class="position-relative border-md border-dashed p-1 rounded-3 d-inline-block `;
		if (preset === currentPreset) {
			html += `highlighted-preset"`;
			this._presetSelection = preset.presetID;
		} else {
			html += `"`;
		}
		return `${html} style="cursor:pointer; margin: 5px;" 
onclick="$(this).parent().children().removeClass('highlighted-preset');$(this).addClass('highlighted-preset');
${this.id}._presetSelection = ${preset.presetID}"><span class="material-icons pointer position-absolute top-0 right-0 px-0" 
onclick="${this.id}.removePreset(this, ${preset.presetID});">delete</span>
<div class="d-inline-block mr-1">Annotation<br><select class="form-control" onchange="
${this.id}.updatePreset(${preset.presetID}, {objectFactory: 
${this.id}.context.getAnnotationObjectFactory(this.value)});">${select}</select></div>
<div class="d-inline-block">Color<br><input class="form-control" type="color" style="height:33px;" 
onchange="${this.id}.updatePreset(${preset.presetID}, {color: this.value});" value="${preset.color}"></div>
<br>Comment<br><input class="form-control" type="text" onchange="${this.id}.updatePreset(${preset.presetID}, 
{comment: this.value});" value="${preset.comment}"><br></div>`;
	}

	removePreset(buttonNode, presetId) {
		let removed = this.context.presets.removePreset(presetId);
		if (removed) {
			$(buttonNode).parent().remove();
			if (removed === this.context.presets.right) {
				$("#annotations-right-click").html(this.getMissingPresetHTML(false));
			}
			if (removed === this.context.presets.left) {
				$("#annotations-left-click").html(this.getMissingPresetHTML(true));
			}
		}
	}

	updatePreset(presetId, properties) {
		let updated = this.context.presets.updatePreset(presetId, properties);
		if (updated) {
			this.updatePresetsHTML();
		}
	}

	/**
	 * Show the user preset modification tab along with the option to select an active preset for either
	 * left or right mouse button
	 * @param {boolean} isLeftClick true if the modification tab sets left preset
	 */
	showPresets(isLeftClick) {
		this._presetSelection = undefined;

		let html = [],
			counter = 0,
			_this = this;

		this.context.presets.foreach(preset => {
			html.push( _this.getPresetHTML(preset, isLeftClick, counter));
			counter++;
		});

		html.push(`<div id="preset-add-new" class="border-md border-dashed p-1 mx-2 my-2 rounded-3 d-inline-block 
${this.id}-plugin-root" style="vertical-align:top; width:150px; cursor:pointer;" onclick="
${this.id}.createNewPreset(this, ${isLeftClick});"><span class="material-icons">add</span> New</div>`);

		Dialogs.showCustom("preset-modify-dialog",
			`<b>Annotations presets</b>`,
			html,
			`<div class="d-flex flex-row-reverse">
<button id="select-annotation-preset-right" onclick="if (${this.id}._presetSelection === 
undefined) { Dialogs.show('You must click on a preset to be selected first.', 5000, Dialogs.MSG_WARN); 
return false;} setTimeout(function(){ Dialogs.closeWindow('preset-modify-dialog'); 
${this.id}.selectPreset(false); }, 150);" class="btn m-2">Set for right click 
</button>
<button id="select-annotation-preset-left" onclick="if (${this.id}._presetSelection === 
undefined) { Dialogs.show('You must click on a preset to be selected first.', 5000, Dialogs.MSG_WARN); 
return false;} setTimeout(function(){ Dialogs.closeWindow('preset-modify-dialog'); 
${this.id}.selectPreset(true); }, 150);" class="btn m-2">Set for left click 
</button>
</div>`);
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

	getFullExportData() {
		return{
			annotations: this.context.getObjectContent(),
			presets: this.context.presets.toObject(),
			metadata: {
				exported: new Date().toLocaleString()
				//todo other metadata?
			}
		};
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
<span onclick="${this.id}.loadAnnotation('${available.id}');return false;" title="Download" class="material-icons pointer">download</span>&nbsp;
<span onclick="${this.id}.updateAnnotation('${available.id}');return false;" title="Update" class="material-icons pointer">update</span>&nbsp;
<span onclick="${this.id}.removeAnnotation('${available.id}');return false;" title="Delete" class="material-icons pointer">delete</span>`;
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
<button id="downloadAnnotation" onclick="${this.id}.context.exportToFile();return false;" class="btn">Download as a file.</button>&nbsp;
${this.presetExportControls()}
<br><br><br><h4 class="f3-light header-sep">Available annotations</h4>
`;
	}

	loadAnnotation(id) {
		//todo code duplicity
		const _this = this;
		PLUGINS.fetchJSON(this._server + "?Annotation=load/" + id).then(json => {
			try {
				_this.context.loadFromJSON(json.annotations);
				_this.context.presets.import(json.presets);
				_this.updatePresetsHTML();
				$("#annotations-shared-head").html(_this.getAnnotationsHeadMenu());
				Dialogs.show("Loaded.", 1000, Dialogs.MSG_INFO);
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
				Dialogs.show(`Failed to upload annotations. You can <a onclick="${this.id}.context.exportToFile()">Export them instead</a>, and upload later.`, 7000, Dialogs.MSG_ERR);
				console.error("Failed to upload annotations.", json);
			}
		}).catch(e => {
			Dialogs.show(`Failed to upload annotations. You can <a onclick="${this.id}.context.exportToFile()">Export them instead</a>, and upload later.`, 7000, Dialogs.MSG_ERR);
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
				Dialogs.show(`Failed to upload annotations. You can <a onclick="${this.id}.context.exportToFile()">Export them instead</a>, and upload later.`, 7000, Dialogs.MSG_ERR);
				console.error("Failed to upload annotations.", json);
			}
		}).catch(e => {
			Dialogs.show(`Failed to upload annotations. You can <a onclick="${this.id}.context.exportToFile()">Export them instead</a>, and upload later.`, 7000, Dialogs.MSG_ERR);
			console.error("Failed to upload annotations.", e);
		});
	}
};

/*------------ Initialization of OSD Annotations ------------*/
PLUGINS.register("gui_annotations", AnnotationsGUI);
