class AnnotationsGUI extends XOpatPlugin {

	//todo test with multiple swap bgimages
	constructor(id) {
		super(id);

		this._server = this.getStaticMeta("server");
		this._ioArgs = this.getStaticMeta("convertors") || {};
		this._defaultFormat = this._ioArgs.format || "native";
		this.registerAsEventSource();
	}

	/*
	 * Ready to fire
	 */
	async pluginReady() {
		//load the localization, then initialize
		await this.loadLocale();

		const _this = this;

		//Register used annotation object factories
		this.context = OSDAnnotations.instance();
		this.context.setModeUsed("AUTO");
		this.context.setModeUsed("CUSTOM");
		this.context.setModeUsed("FREE_FORM_TOOL_ADD");
		this.context.setModeUsed("FREE_FORM_TOOL_REMOVE");
		this.context.setCustomModeUsed("MAGIC_WAND", OSDAnnotations.MagicWand);
		this.context.setCustomModeUsed("FREE_FORM_TOOL_CORRECT", OSDAnnotations.StateCorrectionTool);

		await this.setupFromParams();

		this.context.initPostIO();
		this.setupActiveTissue();
		this.initHandlers();
		//init on html sooner than history so it is placed above
		this.initHTML();
		this.setupTutorials();
		//after html initialized, request preset assignment,

		let opacityControl = $("#annotations-opacity");
		opacityControl.val(this.context.getAnnotationCommonVisualProperty('opacity'));
		opacityControl.on("input", function () {
			if (_this.context.disabledInteraction) return;
			_this.context.setAnnotationCommonVisualProperty('opacity', Number.parseFloat($(this).val()));
		});

		let borderControl = $("#annotations-border-width");
		borderControl.val(this.context.getAnnotationCommonVisualProperty('originalStrokeWidth'));
		borderControl.on("input", function () {
			if (_this.context.disabledInteraction) return;
			_this.context.setAnnotationCommonVisualProperty('originalStrokeWidth', Number.parseFloat($(this).val()));
		});
		this.preview = new AnnotationsGUI.Previewer("preview", this);
	}

	async setupFromParams() {
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
				await this.context.presets.import(staticPresetList, true);
			} catch (e) {
				console.warn(e);
			}
		}

		this.enablePresetModify = this.getOptionOrConfiguration('enablePresetModify', 'enablePresetModify', true);
	}

	setupActiveTissue(bgImageConfigObject) {
		this.activeTissue = APPLICATION_CONTEXT.referencedName();

		if (!this.activeTissue) {
			$("#annotations-shared-head").html(this.getAnnotationsHeadMenu(this.t('errors.noTargetTissue')));
			return false;
		}
		return true;
	}

	/****************************************************************************************************************

	 HTML MANIPULATION

	 *****************************************************************************************************************/

	setDrawOutline(drawOutline) {
		this.context.setAnnotationCommonVisualProperty('modeOutline', drawOutline);
	}

	initHTML() {
		USER_INTERFACE.MainMenu.appendExtended(
			"Annotations",
			`<div class="float-right">
<span class="material-icons p-1 mr-3" id="enable-disable-annotations" title="${this.t('onOff')}" data-ref="on" 
onclick="${this.THIS}._toggleEnabled(this)">visibility</span>
<button class="btn btn-outline btn-sm" id="server-primary-save" onclick="${this.THIS}.saveDefault();"><span class="material-icons pl-0 pr-1 v-align-text-top" style="font-size: 19px;">save</span>Save</button>
<button class="btn-pointer btn btn-sm mr-1 px-1 material-icons" title="More options" id="show-annotation-export" onclick="USER_INTERFACE.AdvancedMenu.openSubmenu(\'${this.id}\', \'annotations-shared\');">more_vert</button>
</div>`,
			'',
// 			`<h4 class="f4 d-inline-block">Layers</h4><button class="btn btn-sm" onclick="
// ${this.THIS}.context.createLayer();"><span class="material-icons btn-pointer">add</span> new layer</button>
// <div id="annotations-layers"></div>`,
			`
<div class="d-flex flex-row mt-1">
<div>Opacity <input type="range" class="pl-1" id="annotations-opacity" min="0" max="1" step="0.1"></div>
${UIComponents.Elements.checkBox({
				label: this.t('outlineOnly'),
				classes: "pl-2",
				onchange: `${this.THIS}.setDrawOutline(!!this.checked)`,
				default: this.context.getAnnotationCommonVisualProperty('modeOutline')})}
</div>
<div class="d-flex flex-row mt-1">
<div class="d-flex flex-row"><span>Border Width&nbsp;</span> <input type="range" class="pl-1" id="annotations-border-width" min="1" max="10" step="1"></div>
</div>
<div class="mt-2 border-1 border-top-0 border-left-0 border-right-0 color-border-secondary">
<button id="preset-list-button-mp" class="btn rounded-0" aria-selected="true" onclick="${this.THIS}.switchMenuList('preset');">Classes</button>
<button id="annotation-list-button-mp" class="btn rounded-0" onclick="${this.THIS}.switchMenuList('annot');">Annotations</button>
</div>
<div id="preset-list-mp" class="flex-1 pl-2 pr-1 mt-2 position-relative"><span class="btn-pointer border-1 rounded-2 text-small position-absolute top-0 right-4" id="preset-list-mp-edit" onclick="${this.THIS}.showPresets();">
<span class="material-icons text-small">edit</span> Edit</span><div id="preset-list-inner-mp"></div></div>
<div id="annotation-list-mp" class="mx-2" style="display: none;"></div>`,
			"annotations-panel",
			this.id
		);

		const vertSeparator = '<span style="width: 1px; height: 28px; background: var(--color-text-tertiary); vertical-align: middle; opacity: 0.3;" class="d-inline-block ml-2 mr-1"></span>';
		const modeOptions = [`<span id="toolbar-history-undo" class="material-icons btn-pointer" style="color: var(--color-icon-primary)" onclick="${this.THIS}.context.undo()">undo</span>
<span id="toolbar-history-redo" class="material-icons btn-pointer" style="color: var(--color-icon-primary)" onclick="${this.THIS}.context.redo()">redo</span>`, vertSeparator],
			modes = this.context.Modes;
		const defaultModeControl = (mode) => {
			let selected = mode.default() ? "checked" : "";
			return(`<input type="radio" id="${mode.getId()}-annotation-mode" class="d-none switch" ${selected} name="annotation-modes-selector">
<label for="${mode.getId()}-annotation-mode" class="label-annotation-mode position-relative" onclick="${this.THIS}.switchModeActive('${mode.getId()}');event.preventDefault(); return false;"
 oncontextmenu="${this.THIS}.switchModeActive('${mode.getId()}');event.preventDefault(); return false;"
 title="${mode.getDescription()}"><span class="material-icons btn-pointer p-1 rounded-2">${mode.getIcon()}</span></label>`);
		}

		//AutoMode
		modeOptions.push(defaultModeControl(modes.AUTO));
		modeOptions.push(vertSeparator);
		modeOptions.push('<span id="annotations-custom-modes-panel">');
		// Custom shapes
		let customMode = modes.CUSTOM;
		for (let factoryID of this._allowedFactories) {
			const factory = this.context.getAnnotationObjectFactory(factoryID);
			if (factory) {
				modeOptions.push(`
<input type="radio" id="${factoryID}-annotation-mode" data-factory="${factoryID}" class="d-none switch" name="annotation-modes-selector">
<label for="${factoryID}-annotation-mode" class="label-annotation-mode position-relative" 
onclick="${this.THIS}.switchModeActive('${customMode.getId()}', '${factoryID}', true);" 
oncontextmenu="${this.THIS}.switchModeActive('${customMode.getId()}', '${factoryID}', false); event.preventDefault(); return false;"
title="${customMode.getDescription()}: ${factory.title()}">
<span class="material-icons btn-pointer p-1 rounded-2">${factory.getIcon()}</span></label>`);
			}
		}
		modeOptions.push('</span>');
		modeOptions.push(vertSeparator);
		// Brushes
		modeOptions.push('<span id="annotations-brush-modes-panel">');
		modeOptions.push(defaultModeControl(modes.FREE_FORM_TOOL_ADD));
		modeOptions.push(defaultModeControl(modes.FREE_FORM_TOOL_REMOVE));
		modeOptions.push('</span>');
		// Wand + correction
		modeOptions.push(vertSeparator);
		modeOptions.push(defaultModeControl(modes.MAGIC_WAND));
		modeOptions.push(defaultModeControl(modes.FREE_FORM_TOOL_CORRECT));

		modeOptions.push(vertSeparator);
		modeOptions.push('<div id="mode-custom-items" class="d-inline-block">');
		modeOptions.push(this.context.mode.customHtml());
		modeOptions.push('</div>');

		// L/R button
		modeOptions.push(this.mainMenuVisibleControls());

		//status bar
		USER_INTERFACE.Tools.setMenu(this.id, "annotations-tool-bar", "Annotations",
			`<div class="px-3 py-2" id="annotations-tool-bar-content" title="Hold keys or click to select. Scroll controls work with shift if hotkeys are not used.">
${modeOptions.join("")}</div>`, 'draw');

		USER_INTERFACE.AdvancedMenu.setMenu(this.id, "annotations-shared", "Export/Import",
			`<h3 class="f2-light">Annotations <span class="text-small" id="gui-annotations-io-tissue-name">for slide ${this.activeTissue}</span></h3><br>
<span class="text-small">Annotations can be uploaded to a server, or downloaded using local files. For files, a desired format can be imported or exported.</span>
<div id="annotations-shared-head"></div><div id="available-annotations"></div>
<br>
<h4 class="f3-light header-sep">File Download / Upload</h4><br>
<div>${this.exportOptions.availableFormats.map(o => this.getIOFormatRadioButton(o)).join("")}</div>
<div id="annotation-convertor-options"></div>
<br>
${UIComponents.Elements.checkBox({label: "Replace existing data on import",
onchange: this.THIS + ".setOption('importReplace', !!this.checked)", default: this.getOption("importReplace", true)})}
<br><br>
<div id="annotations-local-export-panel">
	<button id="importAnnotation" onclick="this.nextElementSibling.click();return false;" class="btn"></button>
	<input type='file' style="visibility:hidden; width: 0; height: 0;" 
	onchange="${this.THIS}.importFromFile(event);$(this).val('');" />
	&emsp;&emsp;
	<button id="downloadPreset" onclick="${this.THIS}.exportToFile(false, true);return false;" class="btn">Download presets.</button>&nbsp;
	<button id="downloadAnnotation" onclick="${this.THIS}.exportToFile(true, true);return false;" class="btn">Download annotations.</button>&nbsp;
</div>`);
		this.annotationsMenuBuilder = new UIComponents.Containers.RowPanel("available-annotations");

		//trigger UI refreshes
		this.updateSelectedFormat(this.exportOptions.format);
		this.updatePresetsHTML();
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

	switchModeActive(id, factory=undefined, isLeftClick) {
		if (this.context.mode.getId() === id) {
			if (id === "auto") return;

			// in case mode does not change, check explicitly custom mode where factory type might change
			if (id === "custom") {
				const preset = this.context.presets.getActivePreset(isLeftClick);
				const otherPreset = this.context.presets.getActivePreset(!isLeftClick);
				if (!preset && !otherPreset) {
					return;
				}

				this.context.setModeById("auto");  // this forces re-initialization if some object was being created
				if (preset) this.updatePresetWith(preset.presetID, 'objectFactory', factory);
				if (otherPreset) this.updatePresetWith(otherPreset.presetID, 'objectFactory', factory);
				this.context.setModeById("custom");
				return;
			}
			this.context.setModeById("auto");
			$('#auto-annotation-mode').prop('checked', true).trigger('change');
		} else {
			// if custom mode also change factories, change both left and right uniformly to not confuse users
			if (id === "custom" && factory) {
				const preset = this.context.presets.getActivePreset(isLeftClick);
				const otherPreset = this.context.presets.getActivePreset(!isLeftClick);
				if (preset || otherPreset) {
					if (preset) this.updatePresetWith(preset.presetID, 'objectFactory', factory);
					if (otherPreset) this.updatePresetWith(otherPreset.presetID, 'objectFactory', factory);
				}
			}
			this.context.setModeById(id);
		}
	}

	switchMenuList(type) {
		if (type === "preset") {
			$("#preset-list-button-mp").attr('aria-selected', true);
			$("#annotation-list-button-mp").attr('aria-selected', false);
			$("#preset-list-mp").css('display', 'block');
			$("#annotation-list-mp").css('display', 'none');
		} else {
			if (!this.isModalHistory) {
				$("#preset-list-mp").css('display', 'none');
				$("#annotation-list-mp").css('display', 'block');
			}
			if (this._preventOpenHistoryWindowOnce) {
				this._preventOpenHistoryWindowOnce = false;
			} else {
				this.openHistoryWindow(this.isModalHistory);
			}
			$("#preset-list-button-mp").attr('aria-selected', false);
			$("#annotation-list-button-mp").attr('aria-selected', true);
		}
	}

	openHistoryWindow(asModal = this.isModalHistory) {
		if (asModal) {
			this.context.history.openHistoryWindow();
		} else {
			this.context.history.openHistoryWindow(this._annotationsDomRenderer);
		}
		this._afterHistoryWindowOpen(asModal);
	}

	_afterHistoryWindowOpen(asModal = this.isModalHistory) {
		if (asModal) {
			$("#preset-list-button-mp").click();
		} else {
			USER_INTERFACE.MainMenu.open();
			//todo better checks
			const pin = $("#annotations-panel-pin");
			if (!pin.hasClass("opened")) {
				pin.click();
			}
			//do not open history window! just focus
			this._preventOpenHistoryWindowOnce = true;
			$("#annotation-list-button-mp").click();
		}
		this.isModalHistory = asModal;
	}

	_createHistoryInAdvancedMenu(focus = false) {
		USER_INTERFACE.AdvancedMenu.setMenu(this.id, "annotations-board-in-advanced-menu", "Annotations Board", '', 'shape_line');
		this.context.history.openHistoryWindow(document.getElementById('annotations-board-in-advanced-menu'));
		this._openedHistoryMenu = true;
		if (focus) USER_INTERFACE.AdvancedMenu.openSubmenu(this.id, 'annotations-board-in-advanced-menu');
	}

	initHandlers() {
		const refreshHistoryButtons = () => {
			$("#toolbar-history-redo").css('color', this.context.canRedo() ?
				"var(--color-icon-primary)" : "var(--color-icon-tertiary)");
			$("#toolbar-history-undo").css('color', this.context.canUndo() ?
				"var(--color-icon-primary)" : "var(--color-icon-tertiary)");
		};

		//Add handlers when mode goes from AUTO and to AUTO mode (update tools panel)
		VIEWER.addHandler('background-image-swap', e => this.setupActiveTissue());
		VIEWER.addHandler('warn-user', (e) => this._errorHandlers[e.code]?.apply(this, [e]));
		const modeChangeHandler = e => {
			$("#mode-custom-items").html(e.mode.customHtml());
			let id = e.mode.getId();
			if (id === "custom") {
				const pl = this.context.presets.left;
				//todo PR cannot be checked too --> we have inputs with single check only
				//  reprogram input switching to double modes...?
				//  const pr = this.context.presets.right;
				if (pl) {
					$(`#${pl.objectFactory.factoryID}-annotation-mode`).prop('checked', true);
				}
			} else {
				$(`#${e.mode.getId()}-annotation-mode`).prop('checked', true);
			}
			USER_INTERFACE.Status.show(e.mode.getDescription());
			refreshHistoryButtons();
		};
		this.context.addHandler('mode-changed', modeChangeHandler);
		modeChangeHandler({mode: this.context.mode}); //force refresh manually

		this.context.addHandler('import', this.updatePresetsHTML.bind(this));
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
			this._updateMainMenuPresetList();
		});
		this.context.history.setAutoOpenDOMRenderer(this._annotationsDomRenderer, "160px");
		this.context.addHandler('history-swap', e => this._afterHistoryWindowOpen(e.inNewWindow));
		this.context.addHandler('history-close', e => e.inNewWindow && this.openHistoryWindow(false));
		this.context.addHandler('history-change', refreshHistoryButtons);

		//allways select primary button preset since context menu shows only on non-primary
		this.context.addHandler('nonprimary-release-not-handled', (e) => {
			if ((this.context.presets.right && this.context.mode !== this.context.Modes.AUTO)
				|| (!USER_INTERFACE.DropDown.opened() && (Date.now() - e.pressTime) > 250)) {
				return;
			}

			let actions = [], handler;
			let active = this.context.canvas.findTarget(e.originalEvent);
			if (active) {
				actions.push({
					title: `Change annotation to:`
				});
				handler = this._clickAnnotationChangePreset.bind(this, active);
			} else {
				actions.push({
					title: `Select preset for left click:`
				});
				handler = this._clickPresetSelect.bind(this, true);
			}
			this.context.presets.foreach(preset => {
				let category = preset.getMetaValue('category') || 'unknown';
				let icon = preset.objectFactory.getIcon();
				actions.push({
					icon: icon,
					iconCss: `color: ${preset.color};`,
					title: category,
					action: () => {
						this._presetSelection = preset.presetID;
						handler();
					},
				});
			});

			USER_INTERFACE.DropDown.open(e.originalEvent, actions);
		});
		this.context.addHandler('history-select', e => {
			if (e.originalEvent.isPrimary) return;
			const annotationObject = this.context.findObjectOnCanvasByIncrementId(e.incrementId);
			if (!annotationObject) return; //todo error message

			const actions = [{
				title: `Change annotation to:`
			}];
			let handler = this._clickAnnotationChangePreset.bind(this, annotationObject);
			this.context.presets.foreach(preset => {
				let category = preset.getMetaValue('category') || 'unknown';
				let icon = preset.objectFactory.getIcon();
				actions.push({
					icon: icon,
					iconCss: `color: ${preset.color};`,
					title: category,
					action: () => {
						this._presetSelection = preset.presetID;
						handler();
					},
				});
			});

			USER_INTERFACE.DropDown.open(e.originalEvent, actions);
		});

		// this.context.forEachLayerSorted(l => {
		// 	  this.insertLayer(l);
		// });
		// this.context.addHandler('layer-added', e => {
		// 	  this.insertLayer(e.layer, e.layer.name);
		// });

		let strategy = this.context.automaticCreationStrategy;
		if (strategy && this.context.autoSelectionEnabled) {
			this.context.Modes.AUTO.customHtml = this.getAutoCreationStrategyControls.bind(this);
			//on visualization change update auto UI
			VIEWER.addHandler('visualization-used', vis => this.updateAutoSelect(vis));
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
				}, {
					"next #enable-disable-annotations": "This icon can temporarily disable <br>all annotations - not just hide, but disable also <br>all annotation controls and hotkeys."
				}, {
					"next #server-primary-save": "Depending on the viewer settings <br>the annotations can be saved here (either locally or to a server). <br> The right button opens additional settings options."
				}, {
					"click #annotations-panel-pin": "Open additional configuration options."
				}, {
					"next #preset-list-button-mp": "Existing annotation classes are here."
				}, {
					"next #preset-list-mp-edit": "You can edit them using this button."
				}, {
					"next #annotation-list-button-mp": "Existing annotations list can be opened here. <br> It can open both in the menu and in a new window."
				}, {
					"next #annotations-panel": "This was the main panel menu. Now let's move to the toolbar."
				}, {
					"next #plugin-tools-menu": "To annotate, you need an annotation mode. <br> Here you can switch from the default, navigation mode <br> to manual control, brush or a magic wand."
				}, {
					"next #annotations-left-click": "Switching can be done by mouse or with shortcuts by holding a keyboard key. <br>Modes are closely described in other tutorials."
				}, {
					"click #annotations-right-click": "To open <b>Annotation Class dialog window</b>, click on the button."
				}, {
					"next #preset-no-0": "This is an example of an annotation class."
				}, {
					"next #preset-add-new": "Here you create a new class."
				}, {
					"click #preset-no-0": "Click anywhere on the preset. This will select it for the right mouse button."
				}, {
					"click #select-annotation-preset-right": "Click <b>Set for right click</b> to assign it to the right mouse button."
				}, {
					"next #viewer-container": "You can now use right mouse button<br>to create a polygons,<br>or the left button for different preset - at once!"
				}, {
					"next #viewer-container": "This tutorial is finished.<br>To learn more, follow other annotation tutorials!"
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
					"next #annotations-custom-modes-panel": "Manual creation modes are available for each object type. <br> We recommend holding 'W' key instead of switching modes<br>with a mouse for faster workflow."
				}, {
					"next #ellipse-annotation-mode + label": "To switch to a different object type, <br>you can click using either left (for left mouse class) or right mouse button.<br>Note that you need active class preset on that button."
				}, {
					"next #polygon-annotation-mode + label": "With a polygon, you can click or drag to create its vertices.<br> Polygon creation will be finished by arriving to a point <br> inside the first, red vertex; or when you change the mode<br> (e.g. release 'W' key)."
				}, {
					"next #polyline-annotation-mode + label": "The same for a polyline."
				}, {
					"next #ruler-annotation-mode + label": "A ruler is able to measure distances. <br> Ruler is not modifiable by a brush."
				},{
					"next #text-annotation-mode + label": "A text (and a point) can be created by clicking."
				}, {
					"next #viewer-container": "Most other objects (such as a rectangle)<br>can be created by mouse dragging (click+move).<br>Now you can try it out."
				}
			], () => {
				USER_INTERFACE.Tools.open('annotations-tool-bar');
			}
		);

		USER_INTERFACE.Tutorials.add(
			this.id, "Magic Wand", "automatically select similar regions", "blur_on", [
				{
					"click #magic-wand-annotation-mode + label": "Click here to switch to the free form tool.<br>We recommend holding 'T' key <br> instead in the future."
				}, {
					"next #viewer-container": "By hovering over the canvas you can already see proposed annotations."
				}, {
					"next #mode-custom-items select": "The target layer to detect from can be set here."
				}, {
					"next #mode-custom-items span": "The sensitivity can be modified here, or by a wheel <br> (or shift+wheel if you don't use key shortcut)."
				}, {
					"next #viewer-container": "By clicking on the canvas, the annotation is created. <br> You can now try it out."
				}
			], () => {
				USER_INTERFACE.Tools.open('annotations-tool-bar');
			}
		);

		USER_INTERFACE.Tutorials.add(
			this.id, "Brushing", "painting with your mouse", "gesture", [
				{
					"click #fft-add-annotation-mode + label": "Click here to switch to the free form tool.<br>We recommend holding 'E' key <br> instead in the future."
				}, {
					"next #viewer-container": "Now you can draw a polygon by a free hand."
				}, {
					"next #fft-add-annotation-mode + label": "<b>Selected object</b> can be appended to ('E' key) ..."
				}, {
					"next #fft-remove-annotation-mode + label": "... or removed from ('R' key)."
				}, {
					"next #fft-size": "The brush size can be changed here or with a mouse wheel <br>(shift+wheel if not using key shortcuts)."
				}, {
					"click #fft-remove-annotation-mode + label": "Click here to switch to the removal.<br>We recommend holding 'R' key <br> instead in the future."
				}, {
					"next #viewer-container": "You can now try to erase areas from existing annotations."
				}, {
					"click #fft-correct-annotation-mode + label": "Click here to switch to the annotation correction brush."
				}, {
					"next #fft-correct-annotation-mode + label": "It is similar, but: <br> it cannot create new annotations, and<br>it ignores mouse buttons class presets: <br> left adds (+) while right button removes (-)."
				}, {
					"next #viewer-container": "You can now try to append to (left) or erase from (right) existing annotations."
				}
			], () => {
				USER_INTERFACE.Tools.open('annotations-tool-bar');
			}
		);

		USER_INTERFACE.Tutorials.add(
			this.id, "Other UI Controls", "annotations management", "dashboard_customize", [
				{
					"next #viewer-container": "An annotation history is available."
				}, {
					"next #toolbar-history-undo": "Shortcut are undo: Ctrl+Z..."
				}, {
					"next #toolbar-history-redo": "...and redo: Ctrl+Shift+Z."
				}, {
					"click #show-annotation-export": "There are also various export options. Click here to open the menu."
				}, {
					"next #annotations-shared": "You can export or import different annotation formats via files.<br>"
				}, {
					"next #annotations-local-export-panel": "Importing is dependent on the active format!<br>It is possible to export annotations themselves;<br> some formats allow also exporting presets only."
				},
				//todo server upload tutorial
			], () => {
				USER_INTERFACE.Tools.open('annotations-tool-bar');
			}
		);
	}

	annotationsEnabledHandler(e) {
		if (e.isEnabled) {
			$("#annotations-tool-bar").removeClass('disabled');
			$("#annotations-opacity").attr("disabled", false);
			$("#annotations-border-width").attr("disabled", false);
		} else {
			$("#annotations-tool-bar").addClass('disabled');
			$("#annotations-opacity").attr("disabled", true);
			$("#annotations-border-width").attr("disabled", true);
		}
	}

	//todo event handler prevent default / return false?
	_errorHandlers = {
		W_NO_PRESET: (e) => {
			Dialogs.show(this.t('errors.noPresetAction', {
					selfId: this.id,
					action: `USER_INTERFACE.highlight('MainMenu', 'annotations-panel', '${e.isLeftClick ? 'annotations-left-click' : 'annotations-right-click'}');`
				}),
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
		if (this.context.disabledInteraction) {
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

	_annotationsDomRenderer(history, containerId) {
		$("#annotation-list-mp").html(`<div id="${containerId}" class="position-relative">
${history.getWindowSwapButtonHtml(2)}${history.getHistoryWindowBodyHtml()}</div>`);
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

	getDetectionControlOptions(visualization) {
		let autoStrategy = this.context.automaticCreationStrategy;
		if (!autoStrategy.running) return "";
		let html = "";

		let index = -1;
		let layer = null;
		let key = "";
		for (key in visualization.shaders) {
			if (!visualization.shaders.hasOwnProperty(key)) continue;
			layer = visualization.shaders[key];
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
			html = "<option selected " + html.substring(8);
		}
		return html;
	}

	updateAutoSelect(visualization) {
		$("#sensitivity-auto-outline").html(this.getDetectionControlOptions(visualization));
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
<span class="one-liner d-inline-block v-align-middle pr-2">Set</span></div>`;
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
<span class="material-icons position-absolute border-sm color-bg-primary close p-0 top-0 right-0 text-small" id="discard-annotation-p-selection"
 onclick="event.stopPropagation(); ${this.THIS}.context.setPreset(undefined, ${isLeftClick});">close</span>
<span class="material-icons pr-0" style="color: ${preset.color};">${icon}</span>
<span class="one-liner d-inline-block v-align-middle pr-3">${category}</span>
</div>`;
	}

	/**
	 * Preset modification GUI part, used to show preset modification tab
	 * @param {string} id preset id
	 * @param {boolean} isLeftClick true if the button is the left one
	 * @param {Number} index if set, the element is assigned an ID in the HTML, should differ in each call if set
	 * @returns {string} HTML
	 */
	getPresetHTMLById(id, isLeftClick, index = undefined) {
		let preset = this.context.presets.get(id);
		if (!preset) {
			return "";
		}
		return this.getPresetHTML(preset, this.context.presets.getActivePreset(isLeftClick), index);
	}

	/**
	 * Load presets from a file
	 * @param {Event} e event of the file load
	 */
	importFromFile(e) {
		const _this = this;
		this._ioArgs.format = _this.exportOptions.format;
		UTILITIES.readFileUploadEvent(e).then(async data => {
			return await _this.context.import(data, this._ioArgs, this.getOption("importReplace", true));
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

		const name = APPLICATION_CONTEXT.referencedName(true)
			+ "-" + UTILITIES.todayISOReversed() + "-"
			+ (withPresets && withObjects ? "all" : (withObjects ? "annotations" : "presets"))
		this.context.export(this._ioArgs, withObjects, withPresets).then(result => {
			UTILITIES.downloadAsFile(name + this.context.getFormatSuffix(toFormat), result);
		}).catch(e => {
			Dialogs.show("Could not export annotations in the selected format.", 5000, Dialogs.MSG_WARN);
			console.error(e);
		});
	}

	/**
	 * Output GUI HTML for presets
	 * @returns {string} HTML
	 */
	mainMenuVisibleControls() {
		return `
<div style="float: right; transform: translateY(-5px);">
<span id="annotations-left-click" class="d-inline-block position-relative mt-1 ml-2 border-md rounded-3"
style="cursor:pointer;border-width:3px!important;"></span>
<span id="annotations-right-click" 
class="d-inline-block position-relative mt-1 mx-2 border-md rounded-3" style="cursor:pointer;border-width:3px!important;"></span>
</div>
`;
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

	updatePresetsMouseButtons() {
		if (Object.keys(this.context.presets._presets).length < 1) {
			const p = this.context.presets.addPreset();
			if (!this.context.presets.getActivePreset(true)) {
				this.context.presets.selectPreset(p.presetID, true, false);
			}
		}

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
	 * Update main HTML GUI part of presets upon preset change
	 */
	updatePresetsHTML() {
		this.updatePresetsMouseButtons();
		this._updateMainMenuPresetList();
	}

	_updateMainMenuPresetList() {
		const html = ['<div style="max-height: 115px; overflow-y: auto;">'];

		let pushed = false;
		this.context.presets.foreach(preset => {
			const icon = preset.objectFactory.getIcon();
			html.push(`<span style="width: 170px; text-overflow: ellipsis; max-lines: 1;"
onclick="return ${this.THIS}._clickPresetSelect(true, '${preset.presetID}');" 
oncontextmenu="return ${this.THIS}._clickPresetSelect(false, '${preset.presetID}');" class="d-inline-block pointer">
<span class="material-icons pr-1" style="color: ${preset.color};">${icon}</span>`);
			html.push(`<span class="d-inline-block pt-2" type="text">${preset.meta['category'].value || 'unknown'}</span></span>`);
			pushed = true;
		});

		if (!pushed) html.push(`To start annotating, please <a onclick="${this.THIS}.showPresets();">create some class presets</a>.`);
		html.push('</div>');
		$("#preset-list-inner-mp").html(html.join(''));
		if (this._fireBoardUpdate) {
			this.context.history.refresh();
		}
		this._fireBoardUpdate = true;
	}

	/**
	 * Preset modification GUI part, used to show preset modification tab
	 * @param {OSDAnnotations.Preset} preset object
	 * @param {OSDAnnotations.Preset} [defaultPreset=undefined] default to highlight
	 * @param {Number} [index=undefined] if set, the element is assigned an ID in the HTML, should differ in each call if set
	 * @returns {string} HTML
	 */
	getPresetHTML(preset, defaultPreset=undefined, index=undefined) {
		let select = "",
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

		let html = [`<div ${id} class="position-relative border v-align-top border-dashed p-1 rounded-3 d-inline-block mb-2 `];
		if (preset.presetID === defaultPreset?.presetID) {
			html.push('highlighted-preset');
			this._presetSelection = preset.presetID;
		}
		html.push(`"style="cursor:pointer;margin: 7px;border-width:4px!important;" 
onclick="$(this).parent().children().removeClass('highlighted-preset');$(this).addClass('highlighted-preset');
${this.THIS}._presetSelection = '${preset.presetID}'">`);

		if (this.enablePresetModify) {
			html.push(`<span class="material-icons btn-pointer position-absolute top-0 right-0 px-0 z-3" 
onclick="${this.THIS}.removePreset(this, '${preset.presetID}');">delete</span>`);
		}

		if (preset.meta.category) {
			html.push(this._metaFieldHtml(preset.presetID, 'category',
				preset.meta.category, false, "mr-5"));
		}

		html.push(`
<span class="show-hint d-inline-block my-1" data-hint="Color"><input ${disabled} class="form-control" type="color" style="height:33px;" 
onchange="${this.THIS}.updatePresetWith('${preset.presetID}', 'color', this.value);" value="${preset.color}"></span>
<span class="show-hint d-inline-block my-1" style="width: 155px" data-hint="Annotation"><select class="form-control width-full" onchange="
${this.THIS}.updatePresetWith('${preset.presetID}', 'objectFactory', this.value);">${select}</select></span><br>`);

		for (let key in preset.meta) {
			if (key === 'category') continue;
			html.push(this._metaFieldHtml(preset.presetID, key, preset.meta[key], true));
		}
		html.push('<div>');
		if (this.enablePresetModify) {
			html.push(`<input class="form-control my-1" type="text" placeholder="new field" style="width: 140px;">
<span class="material-icons btn-pointer" onclick="${this.THIS}.insertPresetMeta(this, '${preset.presetID}');">playlist_add</span>`);
		}
		html.push('</div></div>');
		return html.join("");
	}

	updatePresetWith(idOrBoolean, propName, value, fireBoardUpdate=true) {
		//optimization, update preset might trigger update of all annotations - do only if necessary (e.g. not a factory swap)
		this._fireBoardUpdate = fireBoardUpdate;

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

	_metaFieldHtml(presetId, key, metaObject, allowDelete=true, classes="width-full") {
		const disabled = this.enablePresetModify ? "" : " disabled ";
		let delButton = allowDelete && this.enablePresetModify ? `<span 
class="material-icons btn-pointer position-absolute right-0" style="font-size: 17px;"
onclick="${this.THIS}.deletePresetMeta(this, '${presetId}', '${key}')">delete</span>` : "";

		return `<div class="show-hint" data-hint="${metaObject.name}"><input class="form-control my-1 ${classes}" type="text" onchange="
${this.THIS}.updatePresetWith('${presetId}', '${key}', this.value);" value="${metaObject.value}" ${disabled}>${delButton}</div>`;
	}

	/**
	 * Show the user preset modification tab along with the option to select an active preset for either
	 * left or right mouse button
	 * @param {boolean|undefined} isLeftClick true if the modification tab sets left preset, if undefined, selection
	 *   of active preset is off
	 */
	showPresets(isLeftClick) {
		if (this.context.disabledInteraction) {
			Dialogs.show("Annotations are disabled. <a onclick=\"$('#enable-disable-annotations').click();\">Enable.</a>", 2500, Dialogs.MSG_WARN);
			return;
		}
		const allowSelect = isLeftClick !== undefined;
		this._presetSelection = undefined;

		let html = ['<div style="min-width: 270px">'],
			counter = 0,
			_this = this;

		let currentPreset = this.context.getPreset(isLeftClick) || this.context.presets.get();

		this.context.presets.foreach(preset => {
			html.push(_this.getPresetHTML(preset, currentPreset, counter));
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
			allowSelect ? `<div class="d-flex flex-row-reverse">
<button id="select-annotation-preset-right" onclick="return ${this.THIS}._clickPresetSelect(false);" 
oncontextmenu="return ${this.THIS}._clickPresetSelect(false);" class="btn m-2">Set for right click </button>
<button id="select-annotation-preset-left" onclick="return ${this.THIS}._clickPresetSelect(true);" 
class="btn m-2">Set for left click </button></div>`: '<div class="d-flex flex-row-reverse"><button class="btn btn-primary m-2" onclick="Dialogs.closeWindow(\'preset-modify-dialog\');">Save</button></div>');
	}

	_clickPresetSelect(isLeft, presetID = undefined) {
		if (!presetID && this._presetSelection === undefined) {
			Dialogs.show('You must click on a preset to be selected first.', 5000, Dialogs.MSG_WARN);
			return false;
		}

		let preset = presetID ? this.context.presets.get(presetID) : this._presetSelection;
		const _this = this;
		setTimeout(function () {
			Dialogs.closeWindow('preset-modify-dialog');
			_this.context.setPreset(preset, isLeft);
		}, 150);
		return false;
	}

	_clickAnnotationChangePreset(annotation) {
		if (this._presetSelection === undefined) {
			Dialogs.show('You must click on a preset to be selected first.', 5000, Dialogs.MSG_WARN);
			return false;
		}
		const _this = this;
		setTimeout(function() {
			Dialogs.closeWindow('preset-modify-dialog');
			_this.context.changeAnnotationPreset(annotation, _this._presetSelection);
			_this.context.canvas.requestRenderAll();
		}, 150);
		return false;
	}

	createNewPreset(buttonNode, isLeftClick) {
		let id = this.context.presets.addPreset().presetID,
			node = $(buttonNode);
		node.before(this.getPresetHTMLById(id, isLeftClick, node.index()));
		this.context.createPresetsCookieSnapshot();
		this._updateMainMenuPresetList();
	}

	getAnnotationsHeadMenu(error = "") {
		//todo
		error = error ? `<div class="error-container m-2">${error}</div><br>` : "";
		return `<br><h4 class="f3-light header-sep">Stored on a server</h4>${error}<br>`;
	}

	saveDefault() {
		if (!this._server) {
			this.exportToFile();
			return;
		}
		Dialogs.show("Server-side storage is in the process of implementation. Please, save the data locally for now.");
		//todo server upload!!!
	}
}

/*------------ Initialization of OSD Annotations ------------*/
addPlugin("gui_annotations", AnnotationsGUI);
