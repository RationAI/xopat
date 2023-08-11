class AnnotationsGUI extends XOpatPlugin {

	//todo test with multiple swap bgimages
	constructor(id) {
		super(id);

		this._server = this.getStaticMeta("server");
		//todo parse validity on OSDAnnotations.Convertor.formats ?
		this._ioArgs = this.getStaticMeta("convertors") || {};
		this._defaultFormat = this._ioArgs.format || "native";
	}

	/*
	 * Ready to fire
	 */
	async pluginReady() {
		//load the localization, then initialize
		await this.loadLocale();
		this.init();
	}

	init() {
		const _this = this;

		//Register used annotation object factories
		this.context = OSDAnnotations.instance();
		this.context.setModeUsed("AUTO");
		this.context.setModeUsed("CUSTOM");
		this.context.setModeUsed("FREE_FORM_TOOL_ADD");
		this.context.setModeUsed("FREE_FORM_TOOL_REMOVE");

		this.setupFromParams();

		this.context.initIO();
		this.dataLoader = new AnnotationsGUI.DataLoader(this);

		let bgImage = APPLICATION_CONTEXT.config.background[APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0)];
		this.setupActiveTissue(bgImage); // if (!...) return...

		this.initHandlers();
		//init on html sooner than history so it is placed above
		this.initHTML();
		this.setupTutorials();
		//after html initialized, request preset assignment,
		// by default no preset is active, true -> make one if not existing
		this.context.setPreset(true, true);

		let opacityControl = $("#annotations-opacity");
		opacityControl.val(this.context.getOpacity());
		opacityControl.on("input", function () {
			if (_this.context.disabledInteraction) return;
			_this.context.setOpacity(Number.parseFloat($(this).val()));
		});

		this.loadAnnotationsList(() => {
			const ids = _this.getOption('serverAutoLoadIds', undefined);
			if (Array.isArray(ids)) {
				ids.forEach(id => _this._loadAnnotation(id, e => {
					console.warn('AutoLoad annotations failed', e);
					Dialogs.show(`Attempt to auto load annotations set <b>${id}</b> failed. 
You can <a class="pointer" onclick="USER_INTERFACE.AdvancedMenu.openSubmenu('${this.id}', 'annotations-shared');">
load available sets manually</a>.`, 2000, Dialogs.MSG_WARN);
					//todo remoce such id from the option
				}));
			}
			//todo possibly delete the option so that it does not pollute what is loaded and what not?
		});

		this.preview = new AnnotationsGUI.Previewer("preview", this);
	}

	setupFromParams() {
		this._allowedFactories = this.getOption("factories", false) || this.getStaticMeta("factories") || ["polygon"];
		this.context.history.focusWithZoom = this.getOption("focusWithZoom", true);
		const convertOpts = this.getOption('convertors');
		this._ioArgs.serialize = true;
		this._ioArgs.imageCoordinatesOffset = convertOpts?.imageCoordinatesOffset || this._ioArgs.imageCoordinatesOffset;
		if (Array.isArray(this._ioArgs.imageCoordinatesOffset)) {
			this._ioArgs.imageCoordinatesOffset = {
				x: this._ioArgs.imageCoordinatesOffset[0] || 0, y: this._ioArgs.imageCoordinatesOffset[1] || 0
			};
		}

		this.exportOptions = {
			availableFormats: OSDAnnotations.Convertor.formats,
			//defaultIOFormat not docummented, as it is not meant to be used
			format: this.getOption('defaultIOFormat', this._defaultFormat),
		};
		const formats = OSDAnnotations.Convertor.formats;
		if (!formats.includes(this.exportOptions.format)) this.exportOptions.format = "native";
		if (!formats.includes(this._defaultFormat)) this._defaultFormat = "native";

		this.isModalHistory = this.getOptionOrConfiguration('modalHistoryWindow', 'modalHistoryWindow', true);
		const staticPresetList = this.getOption("staticPresets", undefined, false);
		if (staticPresetList) {
			try {
				this.context.presets.import(staticPresetList, true);
			} catch (e) {
				console.warn(e);
			}
		}

		this.enablePresetModify = this.getOptionOrConfiguration('enablePresetModify', 'enablePresetModify', true);
	}

	setupActiveTissue(bgImageConfigObject) {
		if (!bgImageConfigObject) {
			$("#annotations-shared-head").html(this.getAnnotationsHeadMenu(this.t('errors.noTargetTissue')));
			return false;
		}

		this.activeTissue = APPLICATION_CONTEXT.config.data[bgImageConfigObject.dataReference];
		return true;
	}

	/****************************************************************************************************************

	 HTML MANIPULATION

	 *****************************************************************************************************************/

	setDrawOutline(drawOutline) {
		this.setOption('drawOutline', drawOutline, true);
		this.context.presets.setModeOutline(drawOutline);
	}

	initHTML() {
		USER_INTERFACE.MainMenu.appendExtended(
			"Annotations",
			`
<button class="btn-pointer btn btn-sm mx-1 px-1" title="Export annotations" style="float: right;" id="show-annotation-export" onclick="USER_INTERFACE.AdvancedMenu.openSubmenu('${this.id}', 'annotations-shared');"><span class="material-icons px-1 text-small">cloud_upload</span><span class="text-small">Export/Import</span></button>
<button class="btn-pointer btn btn-sm mx-1 px-1" id="show-annotation-board" title="${this.t('showBoard')}" style="float: right;" onclick="${this.THIS}.openHistoryWindow();"><span class="material-icons px-1 text-small">assignment</span><span class="text-small">Show list</span></button>`,
			this.presetControls(),
// 			`<h4 class="f4 d-inline-block">Layers</h4><button class="btn btn-sm" onclick="
// ${this.THIS}.context.createLayer();"><span class="material-icons btn-pointer">add</span> new layer</button>
// <div id="annotations-layers"></div>`,
			`
<div class="p-2"><span>Opacity: &emsp;</span>
<input type="range" id="annotations-opacity" min="0" max="1" step="0.1">
<span class="material-icons btn-pointer m-1" id="enable-disable-annotations" title="${this.t('onOff')}" style="float: right;" data-ref="on" onclick="${this.THIS}._toggleEnabled(this)"> visibility</span>
<br>${UIComponents.Elements.checkBox({
				label: this.t('outlineOnly'),
				onchange: `${this.THIS}.setDrawOutline(this.checked == true)`,
				default: this.context.presets.getModeOutline()
			})}</div>`,
			"annotations-panel",
			this.id
		);

		let modeOptions = [];
		for (let mode in this.context.Modes) {
			if (!this.context.Modes.hasOwnProperty(mode)) continue;
			mode = this.context.Modes[mode];
			let selected = mode.default() ? "checked" : "";
			modeOptions.push(`<input type="radio" id="${mode.getId()}-annotation-mode" class="d-none switch" ${selected} name="annotation-modes-selector">
<label for="${mode.getId()}-annotation-mode" class="label-annotation-mode position-relative" onclick="${this.THIS}.context.setModeById('${mode.getId()}');" title="${mode.getDescription()}"><span class="material-icons btn-pointer p-1 rounded-2">${mode.getIcon()}</span></label>`);
		}

		let factorySwitch = [];
		for (let factoryId of this._allowedFactories) {
			const factory = this.context.getAnnotationObjectFactory(factoryId);
			if (factory) {
				factorySwitch.push(`<span id="${factoryId}-annotation-factory-switch" class="label-annotation-mode position-relative">
<span class="material-icons btn-pointer p-1 rounded-2" onclick="${this.THIS}.updatePresetWith(true, 'objectFactory', '${factoryId}');" 
oncontextmenu="${this.THIS}.updatePresetWith(false, 'objectFactory', '${factoryId}'); event.preventDefault(); return false;" 
title="${factory.title()}">${factory.getIcon()}</span></span>`);
			}
		}

		//status bar
		USER_INTERFACE.Tools.setMenu(this.id, "annotations-tool-bar", "Annotations",
			`<div class="px-3 py-2" id="annotations-tool-bar-content">${modeOptions.join("")}<span style="width: 1px; height: 28px; background: var(--color-text-tertiary); 
vertical-align: middle; opacity: 0.3;" class="d-inline-block ml-2 mr-1"></span>&nbsp;<div id="mode-custom-items" class="d-inline-block">${this.context.mode.customHtml()}</div>
<div class="px-2 mx-2 border-sm rounded-2 d-inline-block" id="annotations-fast-factory-switch" style="border-color: var(--color-border-tertiary) !important;">${factorySwitch.join("")}</div></div>`, 'draw');

		if (!this.isModalHistory) this._createHistoryInAdvancedMenu();

		USER_INTERFACE.AdvancedMenu.setMenu(this.id, "annotations-shared", "Export/Import",
			`<h3 class="f2-light">Annotations <span class="text-small" id="gui-annotations-io-tissue-name">for slide ${this.activeTissue}</span></h3><br>
<div>${this.exportOptions.availableFormats.map(o => this.getIOFormatRadioButton(o)).join("")}</div>
<div id="annotation-convertor-options"></div>
<br><br>
<h4 class="f3-light header-sep">Download / Upload</h4><br>
<div id="annotations-local-export-panel">
	<button id="importAnnotation" onclick="this.nextElementSibling.click();return false;" class="btn"></button>
	<input type='file' style="visibility:hidden; width: 0; height: 0;" 
	onchange="${this.THIS}.importFromFile(event);$(this).val('');" />
	&emsp;&emsp;
	<button id="downloadPreset" onclick="${this.THIS}.exportToFile(false, true);return false;" class="btn">Download presets.</button>&nbsp;
	<button id="downloadAnnotation" onclick="${this.THIS}.exportToFile(true, true);return false;" class="btn">Download annotations.</button>&nbsp;
</div>
<br>
<div id="annotations-shared-head"></div><div id="available-annotations"></div>`);
		this.annotationsMenuBuilder = new UIComponents.Containers.RowPanel("available-annotations");
		this.updateSelectedFormat(this.exportOptions.format); //trigger UI refresh
	}

	getIOFormatRadioButton(format) {
		const selected = format === this.exportOptions.format ? "checked" : "";
		const convertor = OSDAnnotations.Convertor.get(format);
		return `<div class="d-inline-block p-2"><input type="radio" id="${format}-export-format" class="d-none switch" ${selected} name="annotation-format-switch">
<label for="${format}-export-format" class="position-relative format-selector" title="${convertor.description || ''}" onclick="${this.THIS}.updateSelectedFormat('${format}');"><span style="font-size: smaller">${convertor.title}</span><br>
<span class="show-hint d-inline-block" data-hint="Format"><span class="btn">${format}</span></span></label></div>`;
	}

	updateSelectedFormat(format) {
		const convertor = OSDAnnotations.Convertor.get(format);
		document.getElementById('downloadAnnotation').style.visibility = convertor.exportsObjects ? 'visible' : 'hidden';
		document.getElementById('downloadPreset').style.visibility = convertor.exportsPresets ? 'visible' : 'hidden';
		document.getElementById('importAnnotation').innerHTML = `Import file: format '${format}'`;
		this.exportOptions.format = format;
		this.setLocalOption('defaultIOFormat', format);
		$("#annotation-convertor-options").html(
			Object.values(convertor.options).map(option => UIComponents.Elements[option.type]?.(option)).join("<br>")
		);
	}

	openHistoryWindow() {
		if (this.isModalHistory) {
			this.context.history.openHistoryWindow();

			if (this._openedHistoryMenu) {
				//needs to re-open the menu - update in DOM invalidates the container
				document.getElementById('annotations-board-in-advanced-menu').innerHTML =
					`<button class="btn m-4" onclick="${this.THIS}._createHistoryInAdvancedMenu(true);">Opened in modal window. Re-open here.</button>`;
			}
		} else {
			if (!this._openedHistoryMenu) this._createHistoryInAdvancedMenu();
			USER_INTERFACE.AdvancedMenu.openSubmenu(this.id, 'annotations-board-in-advanced-menu');
		}
	}

	_createHistoryInAdvancedMenu(focus=false) {
		USER_INTERFACE.AdvancedMenu.setMenu(this.id, "annotations-board-in-advanced-menu", "Annotations Board", '', 'shape_line');
		this.context.history.openHistoryWindow(document.getElementById('annotations-board-in-advanced-menu'));
		this._openedHistoryMenu = true;
		if (focus) USER_INTERFACE.AdvancedMenu.openSubmenu(this.id, 'annotations-board-in-advanced-menu');
	}

	initHandlers() {
		const _this = this;

		//Add handlers when mode goes from AUTO and to AUTO mode (update tools panel)
		VIEWER.addHandler('background-image-swap', e => {
			_this.setupActiveTissue(e.backgroundSetup);
			_this.loadAnnotationsList();
		});
		VIEWER.addHandler('warn-user', (e) => _this._errorHandlers[e.code]?.apply(this, [e]));

		this.context.addHandler('mode-changed', this.annotationModeChanged);
		this.annotationModeChanged({mode: this.context.mode}); //force refresh manually

		this.context.addHandler('enabled', this.annotationsEnabledHandler);
		this.context.addHandler('preset-select', this.updatePresetsHTML.bind(this));
		this.context.addHandler('preset-update', this.updatePresetEvent.bind(this));
		this.context.addHandler('preset-delete', e => {
			if (e.preset === this.context.getPreset(false)) {
				$("#annotations-right-click").html(this.getMissingPresetHTML(false));
			}
			if (e.preset === this.context.getPreset(true)) {
				$("#annotations-left-click").html(this.getMissingPresetHTML(true));
			}
			this.context.createPresetsCookieSnapshot();
		});

		//allways select primary button preset since context menu shows only on non-primary
		function showContextMenu(e) {
			if (_this.context.presets.right) return;

			const actions = [{
				title: `Select preset for left click.`
			}];
			_this.context.presets.foreach(preset => {
				let category = preset.getMetaValue('category') || preset.objectFactory.title();
				let icon = preset.objectFactory.getIcon();
				actions.push({
					icon: icon,
					iconCss: `color: ${preset.color};`,
					title: category,
					action: () => {
						_this._presetSelection = preset.presetID;
						_this._clickPresetSelect(true);
					},
				});
			});

			USER_INTERFACE.DropDown.open(e.originalEvent, actions);
		}
		this.context.addHandler('canvas-nonprimary-release', showContextMenu);


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
					"next #annotations-left-click": "Each of your mouse buttons<br>can be used to create annotations.<br>Simply assign some class (<b>preset</b>) and start annotating!"
				},{
					"click #annotations-right-click": "To open <b>Presets dialog window</b>, click on one of these buttons<br>."
				},{
					"next #preset-no-0": "This is an example of an annotation preset."
				},{
					"next #preset-add-new": "Here you create a new class."
				},{
					"click #preset-no-0": "Click anywhere on the preset. This will select it for the right mouse button."
				},{
					"click #select-annotation-preset-right": "Click <b>Set for right click</b> to assign it to the right mouse button."
				}, {
					"next #viewer-container": "You can now use right mouse button<br>to create a polygons,<br>or the left button for different preset - at once!"
				},{
					"next #plugin-tools-menu": "Apart from the default, navigation mode, you can switch <br> to and control different annotation modes here.<br>Modes are closely described in other tutorials."
				},{
					"next #annotations-fast-factory-switch": "To change current annotation object type, <br>select it with (and for) left or right mouse button. <br> The button needs to have a preset assigned."
				},{
					"click #annotations-panel-pin": "Open additional configuration options."
				}, {
					"next #enable-disable-annotations": "This icon can temporarily disable <br>all annotations - not just hide, but disable also <br>all annotation controls and hotkeys."
				}, {
					"next #enable-disable-annotations": "This tutorial is finished.<br>To learn more, follow other annotation tutorials!"
				}], () => {
				USER_INTERFACE.Tools.open('annotations-tool-bar');
			}
		);

		// USER_INTERFACE.Tutorials.add(
		// 	this.id, "Automatic annotations", "learn how to let the computer do the job", "auto_fix_high", [
		// 		{
		// 			"next #auto-annotation-mode + label": "In the navigation mode,<br>double-click on the canvas allows you to<br>automatically annotate regions."
		// 		}, {
		// 			"next #mode-custom-items": "This select specifies which layer will be annotated.<br>For now, it is not possible in the tissue itself."
		// 		}, {
		// 			"next #panel-shaders": "When you double-click on the canvas,<br>all close parts of the selected layer will be outlined.<br>It is therefore a good idea to first izolate the region of interest <br> (e.g. apply threshold if available)."
		// 		}, {
		// 			"next #annotations-left-click": "If you use POLYGON, the outline will fit perfectly,<br>but click outside a region is ignored.<br>Creation might also fail - you can try adjusting ZOOM level<br>or clicking on a different spot."
		// 		}, {
		// 			"next #annotations-left-click": "Rectangle and ellipse will try to fit the data in layer you selected, <br> but if you click somewhere without data, a default-size object will be created."
		// 		}, {
		// 			"next #viewer-container": "Now you can try it out."
		// 		}
		// 	], () => {
		// 		USER_INTERFACE.Tools.open('annotations-tool-bar');
		// 	}
		// );

		USER_INTERFACE.Tutorials.add(
			this.id, "Custom annotations", "create annotations with your hand", "architecture", [
				{
					"next #custom-annotation-mode + label": "You need to be in the manual creation mode. <br> We recommend using 'W' key instead of switching modes with a mouse."
				}, {
					"next #polygon-annotation-factory-switch": "With a polygon, you can click or drag to create its vertices.<br> Polygon creation will be finished by arriving to a point <br> inside the first, red vertex; or when you change the mode<br> (e.g. release 'W' key)."
				}, {
					"next #polyline-annotation-factory-switch": "The same for a polyline."
				}, {
					"next #text-annotation-factory-switch": "A text (and a point) can be created by clicking."
				}, {
					"next #viewer-container": "Most other objects (such as a rectangle)<br>can be created by mouse dragging (click+move).<br>Now you can try it out."
				}
			], () => {
				USER_INTERFACE.Tools.open('annotations-tool-bar');
			}
		);

		USER_INTERFACE.Tutorials.add(
			this.id, "Free form tool", "painting with your mouse", "gesture", [
				{
					"click #fft-add-annotation-mode + label": "Click here to switch to the free form tool.<br>We recommend using 'E' key <br> instead in the future."
				},{
					"next #viewer-container": "Now you can draw a polygon by a free hand."
				},{
					"next #fft-add-annotation-mode + label": "<b>Selected object</b> can be appended to ('E' key) ..."
				},{
					"next #fft-remove-annotation-mode + label": "... or removed from ('R' key)."
				},{
					"next #fft-size": "The brush size can be changed here or with a mouse wheel."
				},{
					"click #fft-remove-annotation-mode + label": "Click here to switch to the removal.<br>We recommend using 'R' key <br> instead in the future."
				},{
					"next #viewer-container": "You can now try to erase areas from existing annotations.<br>To start erasing, make sure the object you want to modify is selected."
				}
			], () => {
				USER_INTERFACE.Tools.open('annotations-tool-bar');
			}
		);

		USER_INTERFACE.Tutorials.add(
			this.id, "Other UI Controls", "annotations management", "dashboard_customize", [
				{
					"next #viewer-container": "There are much more features included."
				},
				{
					"next #show-annotation-board": "Annotation board helps you with annotations management.<br>The board opens in a separate window.<br>It allows you to edit and manage annotations."
				},
				{
					"next #viewer-container": "A history is also available.<br> Shortcut is undo:Ctrl+Z and redo:Ctrl+Shift+Z<br>(or use the annotation board)."
				},
				{
					"click #show-annotation-export": "Click here to open export options."
				},
				{
					"next #annotations-shared": "You can export or import different annotation formats. <br>"
				},
				{
					"next #annotations-local-export-panel": "Importing is dependent on the active format!<br>It is possible to export annotations themselves;<br> some formats allow also exporting presets only."
				},
				{
					"next #available-annotations": "If configured, it is possible to also upload annotations to the server."
				},
			], () => {
				USER_INTERFACE.Tools.open('annotations-tool-bar');
			}
		);
	}

	annotationModeChanged(e) {
		$("#mode-custom-items").html(e.mode.customHtml());
		$(`#${e.mode.getId()}-annotation-mode`).prop('checked', true);
		USER_INTERFACE.Status.show(e.mode.getDescription()); //todo better description or another getter
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

	//todo event handler prevent default / return false?
	_errorHandlers = {
		W_NO_PRESET: (e) => {
			Dialogs.show(this.t('errors.noPresetAction', {selfId: this.id,
					action: `USER_INTERFACE.highlight('MainMenu', 'annotations-panel', '${e.isLeftClick ? 'annotations-left-click' : 'annotations-right-click'}');`}),
				3000, Dialogs.MSG_WARN, false);
			return false;
		},
		W_AUTO_CREATION_FAIL: (e) => {
			Dialogs.show(`Could not create automatic annotation. Make sure you are <a class='pointer' 
onclick="USER_INTERFACE.highlight('Tools', 'annotations-tool-bar', 'sensitivity-auto-outline')">detecting in the correct layer</a> and selecting 
coloured area. Also, adjusting threshold can help.`, 5000, Dialogs.MSG_WARN, false);
			return false;
		},
		E_AUTO_OUTLINE_INVISIBLE_LAYER: (e) => {
			Dialogs.show(`The <a class='pointer' onclick="USER_INTERFACE.highlight('Tools', 'annotations-tool-bar', 'sensitivity-auto-outline')">chosen layer</a> is not visible: auto outline method will not work.`, 5000, Dialogs.MSG_WARN, false);
			return false;
		}
	};

	_toggleEnabled(node) {
		let self = $(node);
		if (this.context.disabledInteraction){
			this.context.enableAnnotations(true);
			self.html('visibility');
			self.attr('data-ref', 'on');
			let node = document.getElementById('annotations-tool-bar-content');
			node.style.pointerEvents = 'auto';
			node.style.opacity = null;
			node.ariaDisabled = 'true';
		} else {
			this.context.enableAnnotations(false);
			self.html('visibility_off');
			self.attr('data-ref', 'off');
			let node = document.getElementById('annotations-tool-bar-content');
			node.style.pointerEvents = 'none';
			node.style.opacity = '0.5';
			node.ariaDisabled = 'false';
		}
	}

	/******************** Free Form Tool ***********************/

	freeFormToolControls() {
		return `<span class="position-absolute top-0" style="font-size: xx-small" title="Size of a brush (scroll to change).">Brush radius:</span>
<input class="form-control" title="Size of a brush (scroll to change)." type="number" min="5" max="100" 
step="1" name="freeFormToolSize" id="fft-size" autocomplete="off" value="${this.context.freeFormTool.screenRadius}"
style="height: 22px; width: 60px;" onchange="${this.THIS}.context.freeFormTool.setSafeRadius(Number.parseInt(this.value));">`;
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
	// 	container.append(`<div id="a_layer_${layer.id}" onclick="${this.THIS}.context.setActiveLayer('${layer.id}');">${name}</div>`);
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
			if (isNaN(layer._index)) continue;

			let errIcon = autoStrategy.compatibleShaders.some(type => type === layer.type) ? "" : "&#9888; ";
			let errData = errIcon ? "data-err='true' title='Layer visualization style not supported with automatic annotations.'" : "";
			let selected = "";

			if (layer._index === autoStrategy.getLayerIndex()) {
				index = layer._index;
				autoStrategy.setLayer(index, key);
				selected = "selected";
			}
			html += `<option value='${key}' ${selected} ${errData}>${errIcon}${layer.name}</option>`;
		}

		if (index < 0) {
			if (!layer) return;
			autoStrategy.setLayer(layer._index, key);
			html = "<option selected " + html.substr(8);
		}
		return html;
	}

	updateAutoSelect(visualisation) {
		$("#sensitivity-auto-outline").html(this.getDetectionControlOptions(visualisation));
	}

	getAutoCreationStrategyControls() {
		return "";
// 		let strategy = this.context.automaticCreationStrategy;
// 		if (!strategy || !strategy.running) return "";
// 		return `<span class="d-inline-block position-absolute top-0" style="font-size: xx-small;" title="What layer is used to create automatic
// annotations."> Automatic annotations detected in: </span><select title="Double click creates automatic annotation - in which layer?" style="min-width: 180px; max-width: 250px;"
// type="number" id="sensitivity-auto-outline" class="form-select select-sm" onchange="${this.THIS}.setAutoTargetLayer(this);">
// ${this.getDetectionControlOptions(VIEWER.bridge.visualization())}</select>`;
	}

	setAutoTargetLayer(self) {
		self = $(self);
		let key = self.val(),
			layer = VIEWER.bridge.visualization().shaders[key];
		this.context.automaticCreationStrategy.setLayer(layer._index, key);
	}

	/******************** PRESETS ***********************/
	/**
	 * GUI Item, ho left/right button looks like when no preset is set for it
	 * @param {boolean} isLeftClick true if the preset is for the left mouse btn
	 * @returns {string} HTML
	 */
	getMissingPresetHTML(isLeftClick) {
		return `<div class="p-1" onclick="${this.THIS}.showPresets(${isLeftClick});"><span class="material-icons pr-1">add</span> 
<span class="one-liner d-inline-block v-align-middle">Add</span></div>`;
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
		return `<div class="position-relative p-1" onclick="${this.THIS}.showPresets(${isLeftClick});">
<span class="material-icons position-absolute border-sm color-bg-primary close p-0" id="discard-annotation-p-selection"
 onclick="event.stopPropagation(); ${this.THIS}.context.setPreset(undefined, ${isLeftClick});">close</span>
<span class="material-icons pr-0" style="color: ${preset.color};">${icon}</span>
<span class="one-liner d-inline-block v-align-middle" style="width: 115px;">${category}</span>
</div>`;
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
		const _this = this;
		this._ioArgs.format = _this.exportOptions.format;
		UTILITIES.readFileUploadEvent(e).then(async data => {
			return await _this.context.import(data, this._ioArgs, false);
		}).then(r => {
			Dialogs.show(r ? "Loaded." : "No data was imported! Are you sure you have a correct format set?", 1500,
				r ? Dialogs.MSG_INFO : Dialogs.MSG_WARN);
		}).catch(e => {
			console.log(e);
			Dialogs.show("Failed to load the file. Is the selected file format correct and the file valid?", 5000, Dialogs.MSG_ERR);
		});
	}

	/**
	 * Export annotations and download them
	 */
	exportToFile(withObjects=true, withPresets=true) {
		const toFormat = this.exportOptions.format || this._defaultFormat;
		this._ioArgs.format = toFormat;
		this.context.export(this._ioArgs, withObjects, withPresets).then(result => {
			UTILITIES.downloadAsFile(this.context.defaultFileNameFor(toFormat), result);
		}).catch(e => {
			Dialogs.show("Could not export annotations in the selected format.", 5000, Dialogs.MSG_WARN);
			console.error(e);
		});
	}

	/**
	 * Output GUI HTML for presets
	 * @returns {string} HTML
	 */
	presetControls() {
		return `<span id="annotations-left-click" class="d-inline-block position-relative mt-1 mx-2 border-md rounded-3"
style="width: 170px; cursor:pointer;border-width:3px!important;"></span><span id="annotations-right-click" 
class="d-inline-block position-relative mt-1 mx-2 border-md rounded-3" style="width: 170px; cursor:pointer;border-width:3px!important;"></span>`;
	}

	/**
	 * Check whether a preset has compatible factory assigned. If not, assign "polygon".
	 * Polygon is a required factory always available in the module.
	 * @param preset
	 */
	validatePresetFactory(preset) {
		if (!this._allowedFactories.find(t => preset.objectFactory.factoryID === t)) {
			preset.objectFactory = this.context.getAnnotationObjectFactory("polygon");
		}
	}

	updatePresetEvent() {
		this.updatePresetsHTML();
		this.context.createPresetsCookieSnapshot();
	}

	/**
	 * Update main HTML GUI part of presets upon preset change
	 */
	updatePresetsHTML() {
		let leftPreset = this.context.getPreset(true),
			rightPreset = this.context.getPreset(false),
			left = $("#annotations-left-click"),
			right = $("#annotations-right-click");

		if (leftPreset) {
			this.validatePresetFactory(leftPreset);
			left.html(this.getPresetControlHTML(leftPreset, true));
		} else left.html(this.getMissingPresetHTML(true));
		if (rightPreset) {
			this.validatePresetFactory(rightPreset);
			right.html(this.getPresetControlHTML(rightPreset, false));
		} else right.html(this.getMissingPresetHTML(false));
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
			currentPreset = this.context.getPreset(isLeftClick),
			disabled = this.enablePresetModify ? "" : " disabled ";

		const _this = this;
		this._allowedFactories.forEach(fId => {
			let factory = _this.context.getAnnotationObjectFactory(fId);
			if (factory) {
				if (factory.factoryID === preset.objectFactory.factoryID) {
					select += `<option value="${factory.factoryID}" selected>${factory.title()}</option>`;
				} else {
					select += `<option value="${factory.factoryID}">${factory.title()}</option>`;
				}
			}
		});

		let id = index === undefined ? "" : `id="preset-no-${index}"`;

		let html = [`<div ${id} class="position-relative border-md v-align-top border-dashed p-1 rounded-3 d-inline-block `];
		if (preset.presetID === currentPreset?.presetID) {
			html.push('highlighted-preset');
			this._presetSelection = preset.presetID;
		}
		html.push(`"style="cursor:pointer; margin: 5px;" 
onclick="$(this).parent().children().removeClass('highlighted-preset');$(this).addClass('highlighted-preset');
${this.THIS}._presetSelection = '${preset.presetID}'">`);

		if (this.enablePresetModify) {
			html.push(`<span class="material-icons btn-pointer position-absolute top-0 right-0 px-0" 
onclick="${this.THIS}.removePreset(this, '${preset.presetID}');">delete</span>`);
		}
		html.push(`<span class="show-hint d-inline-block my-1" data-hint="Annotation"><select class="form-control" onchange="
${this.THIS}.updatePresetWith('${preset.presetID}', 'objectFactory', this.value);">${select}</select></span>
<span class="show-hint d-inline-block my-1" data-hint="Color"><input ${disabled} class="form-control" type="color" style="height:33px;" 
onchange="${this.THIS}.updatePresetWith('${preset.presetID}', 'color', this.value);" value="${preset.color}"></span><br>`);

		for (let key in preset.meta) {
			html.push(this._metaFieldHtml(preset.presetID, key, preset.meta[key], key !== 'category'));
		}
		html.push('<div>');
		if (this.enablePresetModify) {
			html.push(`<input class="form-control my-1" type="text" placeholder="new field" style="width: 140px;">
<span class="material-icons btn-pointer" onclick="${this.THIS}.insertPresetMeta(this, '${preset.presetID}');">playlist_add</span>`);
		}
		html.push('</div></div>');
		return html.join("");
	}

	updatePresetWith(idOrBoolean, propName, value) {
		//object factory can be changed, it does not change the semantic meaning
		if (!this.enablePresetModify && propName !== 'objectFactory') return;
		let preset = idOrBoolean;
		if (typeof idOrBoolean === "boolean") {
			//left = true, right = false
			preset = idOrBoolean ? this.context.presets.left : this.context.presets.right;
			if (!preset) {
				USER_INTERFACE.highlight('MainMenu', 'annotations-panel', `${idOrBoolean ? 'annotations-left-click' : 'annotations-right-click'}`);
				return;
			}
			preset = preset.presetID;
		}
		if (propName === "objectFactory") {
			const factory = this.context.getAnnotationObjectFactory(value);
			if (!factory) {
				console.warn(`Cannot update preset ${preset} factory - unknown factory!`, value);
				return;
			}
			value = factory;
		}
		this.context.presets.updatePreset(preset, {
			[propName]: value
		});
	}

	removePreset(buttonNode, presetId) {
		if (!this.enablePresetModify) return;
		let removed = this.context.presets.removePreset(presetId);
		if (removed) {
			$(buttonNode).parent().remove();
		}
	}

	insertPresetMeta(buttonNode, presetId) {
		if (!this.enablePresetModify) return;
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
		if (!this.enablePresetModify) return;
		if (this.context.presets.deleteCustomMeta(presetId, key)) {
			$(inputNode.parentElement).remove();
			return;
		}
		Dialogs.show("Failed to delete meta field.", 2500, Dialogs.MSG_ERR);
	}

	_metaFieldHtml(presetId, key, metaObject, allowDelete=true) {
		const disabled = this.enablePresetModify ? "" : " disabled ";
		let delButton = allowDelete && this.enablePresetModify ? `<span 
class="material-icons btn-pointer position-absolute right-0" style="font-size: 17px;"
onclick="${this.THIS}.deletePresetMeta(this, '${presetId}', '${key}')">delete</span>` : "";

		return `<div class="show-hint" data-hint="${metaObject.name}"><input class="form-control my-1" type="text" onchange="
${this.THIS}.updatePresetWith('${presetId}', '${key}', this.value);" value="${metaObject.value}" ${disabled}>${delButton}</div>`;
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

		let html = ['<div style="min-width: 270px">'],
			counter = 0,
			_this = this;

		this.context.presets.foreach(preset => {
			html.push(_this.getPresetHTML(preset, isLeftClick, counter));
			counter++;
		});

		if (this.enablePresetModify) {
			html.push(`<div id="preset-add-new" class="border-dashed p-1 mx-2 my-2 rounded-3 d-inline-block 
${this.id}-plugin-root" style="vertical-align:top; width:150px; cursor:pointer; border-color: var(--color-border-secondary);" 
onclick="${this.THIS}.createNewPreset(this, ${isLeftClick});"><span class="material-icons">add</span> New</div>`);
		}
		html.push('</div>');

		Dialogs.showCustom("preset-modify-dialog",
			"<b>Annotations presets</b>",
			html.join(""),
			`<div class="d-flex flex-row-reverse">
<button id="select-annotation-preset-right" onclick="return ${this.THIS}._clickPresetSelect(false);" 
oncontextmenu="return ${this.THIS}._clickPresetSelect(false);" class="btn m-2">Set for right click </button>
<button id="select-annotation-preset-left" onclick="return ${this.THIS}._clickPresetSelect(true);" 
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
			_this.context.setPreset(_this._presetSelection, isLeft);
		}, 150);
		return false;
	}

	createNewPreset(buttonNode, isLeftClick) {
		let id = this.context.presets.addPreset().presetID,
			node = $(buttonNode);
		node.before(this.getPresetHTMLById(id, isLeftClick, node.index()));
		this.context.createPresetsCookieSnapshot();
	}

	getAnnotationsHeadMenu(error="") {
		error = error ? `<div class="error-container m-2">${error}</div><br>` : "";
		return `<br><h4 class="f3-light header-sep">Stored on a server</h4>${error}<br>`;
	}

	/*** HTTP API **/

	loadAnnotationsList(onSuccessLoad=()=>{}) {
		if (!this._server) {
			$("#annotations-shared-head").html(this.getAnnotationsHeadMenu(`This feature is not enabled.`));
			return;
		}
		this.annotationsMenuBuilder.clear();
		this._serverAnnotationList = null;

		this.dataLoader.loadAnnotationsList(this._server, this.activeTissue, json => {
			let count = 0;

			//todo unify behaviour, two servers send different response :/
			this._serverAnnotationList = Array.isArray(json) ? json : json.annotations;

			this.annotationsMenuBuilder.addRow({
				title: "Upload new annotations",
				details: `Upload current annotations in the viewer as a new dataset (as ${APPLICATION_CONTEXT.metadata.get(xOpatSchema.user.name, "")}).`,
				icon: `<button class="btn mr-3 px-2 py-1" onclick="${this.THIS}.uploadAnnotation()" title="Upload"><span class="pr-1 pl-0 material-icons btn-pointer">upload</span> Upload</button>`,
				contentAction: '',
				containerStyle: 'margin: 0 0 10px 0;'
			});

			function getActionButton(annotationId, text, icon, funcName) {
				return `<span onclick="${funcName}('${annotationId}');return false;" title="${text}" 
class="btn-pointer mt-1 d-inline-block px-1"><span class="material-icons width-full text-center">${icon}</span>
<br><span style="font-size: smaller">${text}</span></span>`;
			}

			for (let available of this._serverAnnotationList) {
				//unsafe mode will parse all the metadata as one, so the user meta will be read from available.metadata
				available.metadata = new MetaStore(available.metadata, false);
				let id = available.id, meta = available.metadata;
				this.annotationsMenuBuilder.addRow({
					title: this.dataLoader.getMetaName(meta, available),
					details: this.dataLoader.getMetaDescription(meta, available),
					icon: this.dataLoader.getIcon(meta, available),
					contentAction: getActionButton(id, 'Download', 'download', `${this.THIS}.loadAnnotation`)
						+ getActionButton(id, 'Update', 'update', `${this.THIS}.updateAnnotation`)
						+ getActionButton(id, 'Delete', 'delete', `${this.THIS}.removeAnnotation`)
				});
				count++;
			}
			$("#annotations-shared-head").html(this.getAnnotationsHeadMenu());
			onSuccessLoad(json);
		}, error => {
			console.error(this.dataLoader.getErrorResponseMessage(error));
			$("#annotations-shared-head").html(this.getAnnotationsHeadMenu(`Could not load annotations list. <a class="pointer" onclick="plugin('${this.id}').loadAnnotationsList()">Retry.</a>`));
		});
	}

	loadAnnotation(id, force=false) {
		const _this = this;
		this._loadAnnotation(id, e => {
			console.error("Import failed!", e);
			Dialogs.show("Could not load annotations. Please, let us know about this issue and provide " +
				`<a onclick=\"${_this.id}.exportToFile()\">exported file</a>.`,
				20000, Dialogs.MSG_ERR);
		}, force);
	}

	_loadAnnotation(id, onError, force=false) {
		this.dataLoader.setActiveMetadata(this._serverAnnotationList.find(x => x.id == id)?.metadata);
		const _this = this;
		this.dataLoader.loadAnnotation(this._server, id, json => {
			$('#preset-modify-dialog').remove();

			this._ioArgs.format = _this.dataLoader.getMetaFormat(new MetaStore(json.metadata, false), json);
			_this.context.import(json.data, this._ioArgs).then(r => {
				_this.updatePresetsHTML();
				_this._recordId(id);
				$("#annotations-shared-head").html(_this.getAnnotationsHeadMenu());
				Dialogs.show(r ? "Loaded." : "No data was imported! Are you sure you have a correct format set?",
					1000, r ? Dialogs.MSG_INFO : Dialogs.MSG_WARN);
			}).catch(onError);
		}, onError);
	}

	updateAnnotation(id) {
		const _this = this;
		this.dataLoader.setActiveMetadata(this._serverAnnotationList.find(x => x.id == id)?.metadata);
		if (!confirm("You are about to overwrite annotation set '" + this.dataLoader.getMetaName() + "'. Continue?" )) return;

		//server IO only supports default format
		this._ioArgs.format = this._defaultFormat;
		this.context.export(this._ioArgs).then(data => {
			_this.dataLoader.updateAnnotation(_this._server, id, data, this._defaultFormat,
				json => {
					Dialogs.show("Annotations uploaded.", 2000, Dialogs.MSG_INFO);
					_this.loadAnnotationsList();
					_this._recordId(id);
				},
				e => {
					Dialogs.show(`Failed to upload annotations. Are you logged in? You can 
<a onclick="${_this.id}.exportToFile()">Export them instead</a>, and upload later.`,
						7000, Dialogs.MSG_ERR);
					console.error("Failed to update annotation: " + this.dataLoader.getMetaName(), "ID", id,
						_this.dataLoader.getErrorResponseMessage(e));
				}
			);
		})
	}

	removeAnnotation(id) {
		const _this = this;
		this.dataLoader.setActiveMetadata(this._serverAnnotationList.find(x => x.id == id)?.metadata);
		if (!confirm("You are about to delete annotation set '" + this.dataLoader.getMetaName() + "'. Continue?" )) return;

		this.dataLoader.removeAnnotation(this._server, id,
			json => {
				Dialogs.show(`Annotation '${this.dataLoader.getMetaName()}' removed.`, 2000, Dialogs.MSG_INFO);
				_this.loadAnnotationsList();
			},
			e => {
				Dialogs.show(`Failed to delete annotation '${this.dataLoader.getMetaName()}'.`,
					7000, Dialogs.MSG_ERR);
				console.error("Failed to delete annotation: " + this.dataLoader.getMetaName(),
					_this.dataLoader.getErrorResponseMessage(e));
			}
		);
	}

	uploadAnnotation() {
		const _this = this;
		//server IO only supports default format
		this._ioArgs.format = this._defaultFormat;
		this.context.export(this._ioArgs).then(data => {
			this.dataLoader.uploadAnnotation(_this._server, _this.activeTissue, data, this._defaultFormat,
				json => {
					Dialogs.show("Annotations uploaded.", 2000, Dialogs.MSG_INFO);
					_this.loadAnnotationsList();

					if (json.id) {
						_this._recordId(json.id);
					} else if (Array.isArray(json)) {
						_this._recordId(json[json.length-1].id);

					} else {
						//todo err
					}
				},
				e => {
					Dialogs.show(`Failed to upload annotations. You can 
<a onclick="${_this.id}.exportToFile()">Export them instead</a>, and upload later.`,
						7000, Dialogs.MSG_ERR);
					console.error("Failed to upload annotations.", _this.dataLoader.getErrorResponseMessage(e));
				}
			);
		});
	}

	_recordId(id) {
		let ids = this.getOption('serverAutoLoadIds', undefined);
		if (!Array.isArray(ids)) ids = [];
		ids.push(id);
		this.setOption('serverAutoLoadIds', ids, false);
	}
}

/*------------ Initialization of OSD Annotations ------------*/
addPlugin("gui_annotations", AnnotationsGUI);
