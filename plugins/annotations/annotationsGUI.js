class AnnotationsGUI extends XOpatPlugin {
	/**
	 * @typedef {{
	 * 	show?: boolean;
	 * 	pos?: {
	 * 		x: number;
	 * 		y: number;
	 * 	}
	 * 	private?: boolean;
	 * 	comments?: {
	 * 		author: string;
	 * 		date: Date;
	 * 		content: string;
	 * 	}
	 * }} AnnotationMenuOptions
	 */

	/**
	 * @typedef {{
	 * 	id: string,
	 * 	author: {
	 * 		id: string,
	 * 		name: string,
	 * 	},
	 * 	content: string,
	 * 	createdAt: Date,
	 *  replyTo?: string,
	 * 	removed?: boolean,
	 * }} AnnotationComment
	 */

	static annotationMenuIconOrder = [
		"private", "locked", "comments"
	]

	/**
	 * Check if an array of menu icons is sorted per annotationMenuIconOrder
	 * @param {string[]} array 
	 * @returns {boolean}
	 */
	static _isAnnotationMenuSorted(array) {
		const order = AnnotationsGUI.annotationMenuIconOrder;
		return (
			array.length === order.length &&
			array.every((v, i) => v.includes(order[i]))
		)
	}

	//todo test with multiple swap bgimages
	constructor(id) {
		super(id);
		this._ioArgs = this.getStaticMeta("convertors") || {};
		this._defaultFormat = this._ioArgs.format || "native";
		/**
		 * @type {Set<string>}
		 */
		this._preferredPresets = new Set();
		this.user = XOpatUser.instance();

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
		this.context.setCustomModeUsed("VIEWPORT_SEGMENTATION", OSDAnnotations.ViewportSegmentation);

    this._commentsEnabled = this.getOption("commentsEnabled", this.getStaticMeta("commentsEnabled", true));
    this.context.commentsEnabled = this._commentsEnabled;
		this._commentsClosedMethod = this.getOption("commentsClosedMethod", this.getStaticMeta("commentsClosedMethod", 'global'));
		this._commentsDefaultOpened = this.getOption("commentsDefaultOpened", this.getStaticMeta("commentsDefaultOpened", true));
		this._commentsOpened = this.commentsDefaultOpened;

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

		this._copiedAnnotation = null;
		this._copiedPos = {x: 0, y: 0};
		this._selectedAnnot = null;

		this._refreshCommentsInterval = null;
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
		if (this.getOption("edgeCursorNavigate", true)) {
			this.context.setCloseEdgeMouseNavigation(true);
		}
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

	setDrawOutline(enable) {
		this.context.setAnnotationCommonVisualProperty('modeOutline', enable);
	}

	setEdgeCursorNavigate(enable) {
		enable = this.context.setCloseEdgeMouseNavigation(enable);
		this.setOption("edgeCursorNavigate", enable);

		return enable;
	}

	_toggleStrokeStyling(enable) {
		const authorButton = $("#author-list-button-mp");
		const isAuthorsTabActive = authorButton.attr('aria-selected') === 'true';
		
		if (enable) {
			authorButton.show();
		} else {
			authorButton.hide();
			
			if (isAuthorsTabActive) {
				this.switchMenuList('preset');
			}
		}
	}

	initHTML() {

		USER_INTERFACE.addHtml(
			new UI.FloatingWindow(
				{
					id: "annotation-comments-menu",
					title: "Comments",
					closable: false,
					onClose: () => {this.commentsToggleWindow(false)},
				}, new UI.RawHtml({},
				`
					<div class="flex-1 overflow-y-auto space-y-3 p-2" id="comments-list" style="min-height: 0;">
					</div>
					<div id="comments-input-section" class="p-2 flex-shrink">
						<div class="flex gap-2">
							<textarea 
								type="text" 
								placeholder="Add a comment..."
								class="resize-none flex-1 px-3 py-2 text-sm border-[1px] border-[var(--color-border-secondary)] rounded-md focus:outline-none focus:border-[var(--color-border-info)]"
								style="background: var(--color-bg-primary); color: var(--color-text-primary);"
								id="comment-input"
								rows="2"
								onkeypress="if(event.key==='Enter') this.nextElementSibling.click()"
								${!this.user ? 'disabled' : ''}
							></textarea>
							<button 
								class="px-3 py-2 btn btn-pointer material-icons"
								style="font-size: 22px;"
								onclick="${this.THIS}._addComment()"
							>
								send
							</button>
						</div>
					</div>
				`
			)),
			this.id
		);

		const commentsMenu = document.getElementById("annotation-comments-menu");
		
		const commentsBody = document.querySelector('.card-body div')
		commentsBody.style.width = "100%";
		commentsBody.style.height = "100%";
		commentsBody.style.position = "relative";
		commentsBody.style.display = "flex";
		commentsBody.style.flexDirection = "column";

		const commentsResize = document.querySelector('.cursor-se-resize')
		commentsResize.style.borderColor = "var(--color-text-primary)";

		commentsMenu.style.display = 'none';
		commentsMenu.classList.add(
			"flex-col", "shadow-lg", "rounded-lg", "border", "overflow-hidden", "bg-[var(--color-bg-primary)]"
		)
		commentsMenu.style.borderColor = "var(--color-border-primary)";
		commentsMenu.style.minWidth = "320px";
		commentsMenu.style.minHeight = "370px";

		this.context.addHandler('annotation-selected', e => this._annotationSelected(e.object));
		this.context.addHandler('annotation-deselected', e => this._annotationDeselected(e.object));

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
<div class="d-flex flex-row mt-1 width-full">
<div style="width: 50%"><span>Border </span><input type="range" class="pl-1" id="annotations-border-width" min="1" max="10" step="1"></div>
${UIComponents.Elements.checkBox({
				label: this.t('outlineOnly'),
				classes: "pl-2",
				onchange: `${this.THIS}.setDrawOutline(!!this.checked)`,
				default: this.context.getAnnotationCommonVisualProperty('modeOutline')})}
</div>
<div class="d-flex flex-row mt-1 width-full">
<div style="width: 50%"><span>Opacity </span><input type="range" class="pl-1" id="annotations-opacity" min="0" max="1" step="0.1"></div>
${UIComponents.Elements.checkBox({
				label: 'Enable edge navigation',
				classes: "pl-2",
				onchange: `this.checked = ${this.THIS}.setEdgeCursorNavigate(!!this.checked)`,
				default: this.getOption("edgeCursorNavigate", true)})}
</div>
<div class="mt-2 border-1 border-top-0 border-left-0 border-right-0 color-border-secondary">
<button id="preset-list-button-mp" class="btn rounded-0" aria-selected="true" onclick="${this.THIS}.switchMenuList('preset');">Classes</button>
<button id="annotation-list-button-mp" class="btn rounded-0" onclick="${this.THIS}.switchMenuList('annot');">Annotations</button>
<button id="author-list-button-mp" class="btn rounded-0" style="display: none;" onclick="${this.THIS}.switchMenuList('authors');">Authors</button>
</div>
<div id="preset-list-mp" class="flex-1 pl-2 pr-1 mt-2 position-relative"><span class="btn-pointer border-1 rounded-2 text-small position-absolute top-0 right-4" id="preset-list-mp-edit" onclick="${this.THIS}.showPresets();">
<span class="material-icons text-small">edit</span> Edit</span><div id="preset-list-inner-mp"></div></div>
<div id="annotation-list-mp" class="mx-2" style="display: none;"></div>
<div id="author-list-mp" class="mx-2" style="display: none;"><div id="author-list-inner-mp"></div></div>`,
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
		modeOptions.push(defaultModeControl(modes.VIEWPORT_SEGMENTATION));
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
</div>
<h4 class="f3-light header-sep">Comments</h4><br>
${UIComponents.Elements.checkBox({label: "Enable comments",
onchange: this.THIS + ".enableComments(!!this.checked)", default: this._commentsEnabled})}
${UIComponents.Elements.checkBox({label: "Automatically open comments on initial click",
onchange: this.THIS + ".commentsDefaultOpen(!!this.checked)", default: this._commentsDefaultOpened})}
<div class="flex gap-2 justify-between">
<span>Remember comments window opened/closed state</span>
${UIComponents.Elements.select({
    default: this._commentsClosedMethod,
    options: {
        'none': 'Always keep open',
        'global': 'Keep open globally',
        'individual': 'Keep open per-annotation',
    },
    changed: this.THIS + ".switchCommentsClosedMethod(value)",
})}
</div>
`);
		this.annotationsMenuBuilder = new UIComponents.Containers.RowPanel("available-annotations");

		//trigger UI refreshes
		this.updateSelectedFormat(this.exportOptions.format);
		this.updatePresetsHTML();

		this.context.addHandler('author-annotation-styling-toggle', e => this._toggleStrokeStyling(e.enable))
		this.context.addHandler('comments-control-clicked', () => this.commentsToggleWindow())
		this._toggleStrokeStyling(this.context.strokeStyling);
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

    /**
     * Enable/disable comments UI
     * @param {boolean} enabled 
     */
    enableComments(enabled) {
        if (this._commentsEnabled === enabled) return;
        this._commentsEnabled = enabled;
        this.context.commentsEnabled = enabled;
        this.setOption("commentsEnabled", enabled);
				if (!enabled) {
					this.commentsToggleWindow(false, true);
				} else if (this._selectedAnnot) {
					this.commentsToggleWindow(true, true);
				}
        this.context.canvas.requestRenderAll();
    }

		commentsDefaultOpen(enabled) {
			if (this._commentsDefaultOpened === enabled) return;
			this._commentsDefaultOpened = enabled;
			this.setOption("commentsDefaultOpened", enabled);
		}

    /**
     * Set strategy for closing comments
     * @param {'none' | 'global' | 'individual'} method 
     */
    switchCommentsClosedMethod(method) {
        if (this._commentsClosedMethod === method) return;
        this._commentsClosedMethod = method;
        this.setOption("commentsClosedMethod", method);
    }

    /**
     * Get opened state cache for object
     * @param {string} objectId 
     */
    _getCommentOpenedCache(objectId) {
        const cacheRaw = this.cache.get('comments-opened-states')
        if (!cacheRaw) {
            this.cache.set('comments-opened-states', '{}');
            return undefined;
        }
        const cache = JSON.parse(cacheRaw)[objectId];
        return cache;
    }
    /**
     * Set opened state cache for object
     * @param {string} objectId 
     * @param {boolean} opened
     */
    _setCommentOpenedCache(objectId, opened) {
        const cacheRaw = this.cache.get('comments-opened-states')
        if (!cacheRaw) {
            this.cache.set('comments-opened-states', JSON.stringify({ objectId: opened }));
            return;
        }
        const cache = JSON.parse(cacheRaw);
        cache[objectId] = opened;
        this.cache.set('comments-opened-states', JSON.stringify(cache));
    }

	/**
	 * Check whether comments should be opened for this object
	 * @param {string} objectId object this was called on
	 */
	_shouldOpenComments(objectId) {
		if (!this._commentsEnabled) return false;
    if (this._commentsClosedMethod === 'none') return true;
		if (this._commentsClosedMethod === 'global') return this._commentsOpened;
    const shouldOpen = this._getCommentOpenedCache(objectId);
		if (shouldOpen === undefined) return this._commentsDefaultOpened;
		return shouldOpen;
	}

	/**
	 * Add comment from the user
	 */
	_addComment() {
		if (!this._selectedAnnot) return;
		if (!this.user) return;
		const input = document.getElementById('comment-input');
		const commentText = input.value.trim();
		
		if (!commentText) return;
				
		const comment = {
			id: crypto.randomUUID(),
			author: {
				id: this.user.id,
				name: this.user.name,
			},
			content: commentText,
			createdAt: new Date(),
			removed: false,
		};
		
		this.context.addComment(this._selectedAnnot, comment);
		this.context.canvas.requestRenderAll();
		this._renderSingleComment(comment);
		input.value = '';
		
		const commentsList = document.getElementById('comments-list');
		if (commentsList) {
			commentsList.scrollTop = commentsList.scrollHeight;
		}
	}

	/**
	 * Generate a consistent color corresponding to a username
	 * @param {string} username 
	 * @returns {string} HSL CSS color string
	 */
	getColorForUser(username) {
		let hash = 0;
		for (let i = 0; i < username.length; i++) {
			const char = username.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash;
		}
		
		const positiveHash = Math.abs(hash);
		
		const hue = positiveHash % 360;
		
		const saturation = 65;
		const lightness = 45;
		
		return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
	}

	/**
	 * Clear all existing comments from the comments list
	 */
	_clearComments() {
		const commentsList = document.getElementById('comments-list');
		if (commentsList) {
			commentsList.innerHTML = '';
		}
	}

	/**
	 * Render comments from an array of comment objects
	 * @param {AnnotationComment[]} comments - Array of comment objects to render
	 */
	_renderComments() {
		const comments = this._selectedAnnot.comments;
		const commentsList = document.getElementById('comments-list');
		if (!commentsList) {
			return;
		}
		this._clearComments();
		if (!comments || comments.filter(c => !c.removed).length === 0) {
			const noCommentsElement = document.createElement('div');
			noCommentsElement.id = 'comments-list-empty';
			noCommentsElement.className = 'rounded-md flex items-center justify-center gap-2 w-full h-full select-none';
			noCommentsElement.style.background = "var(--color-bg-canvas-inset)";
			noCommentsElement.style.padding = "15px";
			noCommentsElement.innerHTML = `
				<span class="material-icons text-4xl" style="color: var(--color-text-tertiary);">chat_bubble_outline</span>
				<p class="text-sm" style="color: var(--color-text-tertiary);">No comments to show</p>
			`;
			commentsList.appendChild(noCommentsElement);
			return;
		}

		const roots = [];
		const replies = [];
		comments.forEach(comment => {
			if (!comment.replyTo) {
				roots.push(comment);
			} else if (!comment.removed) {
				replies.push(comment);
			}
		});
		roots.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
		replies.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
		
		const rootMap = new Map(roots.filter(c => !c.removed).map(c => [c.id, c]));
		const renderedRemoved = new Set();
		// render comments and replies
		roots.forEach(root => {
			const rootReplies = replies.filter(r => r.replyTo === root.id)
			if (root.removed && rootReplies.length) {
				this._renderSingleComment(root, null, true);
			} else if (!root.removed) {
				this._renderSingleComment(root);
			}
			rootReplies
				.forEach(reply => {
					this._renderSingleComment(reply, root.id);
				});
		});

		// render orphan replies (sorted)
		const orphanGroups = {};
		replies.filter(r => !rootMap.has(r.replyTo)).forEach(orphan => {
			if (!orphanGroups[orphan.replyTo]) orphanGroups[orphan.replyTo] = [];
			orphanGroups[orphan.replyTo].push(orphan);
		});
		Object.keys(orphanGroups).forEach(parentId => {
			const alreadyRendered = roots.some(root => root.id === parentId && root.removed);
			if (!renderedRemoved.has(parentId) && !alreadyRendered) {
				this._renderSingleComment({ id: parentId, removed: true }, null, true);
				renderedRemoved.add(parentId);
				orphanGroups[parentId]
					.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
					.forEach(orphan => {
						this._renderSingleComment(orphan, parentId);
					});
			}
		});
	}

	/**
	 * Render a single comment element
	 * @param {AnnotationComment[]} comment - Comment object to render
	 * @param {string | null} [parentId=null] - ID of comment's parent or null
	 * @param {boolean} [isRemovedPlaceholder=false] - If this comment is a [deleted] placeholder
	 */
	_renderSingleComment(comment, parentId = null, isRemovedPlaceholder = false) {
		const commentsList = document.getElementById('comments-list');
		if (!commentsList) return;

		const noCommentsElement = document.getElementById("comments-list-empty");
		if (noCommentsElement) noCommentsElement.remove();

		// placeholder
		if (isRemovedPlaceholder) {
			const removedEl = document.createElement('div');
			removedEl.className = 'rounded-lg p-3 border-l-4';
			removedEl.style.background = 'var(--color-bg-canvas-inset)';
			removedEl.style.borderLeftColor = '#888';
			removedEl.style.color = '#888';
			removedEl.style.fontStyle = 'italic';
			removedEl.textContent = '[removed]';
			removedEl.dataset.commentId = comment.id;
			commentsList.appendChild(removedEl);
			return;
		}

		const commentElement = document.createElement('div');
		commentElement.className = 'rounded-lg p-3 border-l-4';
		commentElement.style.background = 'var(--color-bg-canvas-inset)';
		commentElement.style.borderLeftColor = this.getColorForUser(comment.author.name);
		commentElement.dataset.commentId = comment.id;

		if (comment.replyTo) {
			commentElement.style.marginLeft = '2em';
		}

		const createdAt = new Date(comment.createdAt);
		const timeAgo = this._formatTimeAgo(createdAt);

		const isAuthor = this.user.id === comment.author.id;
		const deleteButtonHtml = isAuthor ? 
			`<button class="relative" title="Delete comment" data-confirmed="false">
				<span class="material-icons btn-pointer" style="font-size: 21px; color: var(--color-text-danger);">delete</span>
				<div class="delete-hint hidden right-[30px] top-1/2 -translate-y-1/2 px-2 py-1 rounded-md p-2 text-xs absolute whitespace-nowrap" style="z-index: 10; background: var(--color-bg-canvas-inset); color: var(--color-text-danger);">
					<span>Click again to delete</span>
				</div>
			</button>` : '';

		let replyButtonHtml = '';
		if (!comment.replyTo && this.user) {
			replyButtonHtml = `
				<button class="relative" title="Reply to comment" data-reply="${comment.id}">
					<span class="material-icons btn-pointer" style="font-size: 21px; color: var(--color-text-secondary);">reply</span>
				</button>
			`;
		}

		commentElement.innerHTML = `
			<div class="flex justify-between items-center mb-1">
				<span class="font-medium text-sm" style="color: var(--color-text-primary);">${this._escapeHtml(comment.author.name)}</span>
				<div class="flex items-center justify-center">
					<span name="created-at" class="text-xs mr-2" style="color: var(--color-text-secondary);" title="${createdAt.toLocaleString()}">${timeAgo}</span>
					${deleteButtonHtml}
					${replyButtonHtml}
				</div>
			</div>
			<p class="text-sm" style="color: var(--color-text-secondary);">${this._escapeHtml(comment.content)}</p>
		`;

		if (isAuthor) {
			const deleteButton = commentElement.querySelector('button[title="Delete comment"]');
			deleteButton.addEventListener('click', (event) => {
				const confirmed = event.currentTarget.dataset.confirmed === 'true';
				if (confirmed) {
					this._deleteComment(comment.id);
				} else {
					event.currentTarget.dataset.confirmed = 'true';
					event.currentTarget.querySelector('.delete-hint').classList.remove('hidden');
				}
			});
			deleteButton.addEventListener('mouseleave', (event) => {
				event.currentTarget.dataset.confirmed = 'false';
				event.currentTarget.querySelector('.delete-hint').classList.add('hidden');
			});
		}

		// reply UI
		if (!comment.replyTo) {
			const replyBtn = commentElement.querySelector('button[data-reply]');
			if (replyBtn) {
				replyBtn.addEventListener('click', () => {
					if (commentElement.querySelector('.reply-box')) return;
					const replyBox = document.createElement('div');
					replyBox.className = 'reply-box mt-2 flex flex-col gap-2';
					replyBox.innerHTML = `
						<textarea
							class="resize-none flex-1 px-3 py-2 text-sm border-[1px] border-[var(--color-border-secondary)] rounded-md focus:outline-none focus:border-[var(--color-border-info)]"
							style="background: var(--color-bg-primary); color: var(--color-text-primary);"
							rows="2"
							placeholder="Add a reply..."
							${!this.user ? 'disabled' : ''}
						></textarea>
						<div class="flex gap-2 justify-end">
							<button class="reply-cancel-btn btn px-2 py-1 rounded text-xs text-[var(--color-text-primary)] hover:text-black" type="button" aria-selected="true">Cancel</button>
							<button class="reply-submit-btn btn btn-pointer px-2 py-1 rounded text-xs" type="button">Reply</button>
						</div>
					`;
					commentElement.appendChild(replyBox);
					// Cancel button
					replyBox.querySelector('.reply-cancel-btn').addEventListener('click', () => {
						replyBox.remove();
					});
					// Submit button
					replyBox.querySelector('.reply-submit-btn').addEventListener('click', () => {
						const textarea = replyBox.querySelector('textarea');
						const text = textarea.value.trim();
						if (!text) return;
						// Add reply comment
						this._addReplyComment(comment.id, text);
						replyBox.remove();
					});
				});
			}
		}

		// insert replies after parent
		if (parentId) {
			const parentEl = commentsList.querySelector(`[data-comment-id="${parentId}"]`);
			if (parentEl && parentEl.nextSibling) {
				commentsList.insertBefore(commentElement, parentEl.nextSibling);
			} else if (parentEl) {
				commentsList.appendChild(commentElement);
			} else {
				// If parent is not found, just append (should not happen with new logic)
				commentsList.appendChild(commentElement);
			}
		} else {
			commentsList.appendChild(commentElement);
		}
	}

	/**
	 * Add a reply comment from the user
	 * @param {string} parentId - ID of comment's parent
	 * @param {*} text - Contents of reply
	 */
	_addReplyComment(parentId, text) {
		const id = crypto.randomUUID();
		const newComment = {
			id,
			author: { id: this.user.id, name: this.user.name },
			content: text,
			createdAt: new Date(),
			replyTo: parentId,
			removed: false
		};
		if (!this._selectedAnnot.comments) this._selectedAnnot.comments = [];
		this._selectedAnnot.comments.push(newComment);
		this._renderComments();

		const addedComment = document.getElementById('comments-list').querySelector(`[data-comment-id="${id}"]`);
		if (addedComment) addedComment.scrollIntoView({ block: "end" });

		this.context.canvas.requestRenderAll();
	}

	/**
	 * Format a date as a time ago string
	 * @param {Date} date - Date to format
	 * @returns {string} - Formatted time ago string
	 */
	_formatTimeAgo(date) {
		const now = new Date();
		const diffMs = now - date;
		const diffSecs = Math.floor(diffMs / 1000);
		const diffMins = Math.floor(diffSecs / 60);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffSecs < 60) return 'just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
		if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
		return `${Math.floor(diffDays / 365)}y ago`;
	}

	/**
	 * Escape HTML to prevent XSS attacks
	 * @param {string} text - Text to escape
	 * @returns {string} - HTML escaped text
	 */
	_escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	/**
	 * Delete a comment by ID
	 * @param {string} commentId - ID of the comment to delete
	 */
	_deleteComment(commentId) {
		this.context.deleteComment(this._selectedAnnot, commentId);
		const commentsList = document.getElementById('comments-list');
		if (!commentsList) return;
		const comment = this._selectedAnnot.comments.find(c => c.id === commentId);
		const commentParent = this._selectedAnnot.comments.find(c => c.id === comment.replyTo)
		const commentEl = commentsList.querySelector(`[data-comment-id="${commentId}"]`);

		const hasReplies = this._selectedAnnot.comments.some(c => !c.removed && c.replyTo === commentId);
		const removeParentPlaceholder =
			comment.replyTo &&
			!this._selectedAnnot.comments.some(c => !c.removed && comment.replyTo === c.id) &&
			commentParent?.removed

		if (removeParentPlaceholder) {
			const commentParentId = commentParent?.id;
			if (commentParentId) commentsList.querySelector(`[data-comment-id="${commentParentId}"]`).remove();
		}
		
		if (commentEl) {
			if (hasReplies) {
				// replace with placeholder
				const removedEl = document.createElement('div');
				removedEl.className = 'rounded-lg p-3 border-l-4';
				removedEl.style.background = 'var(--color-bg-canvas-inset)';
				removedEl.style.borderLeftColor = '#888';
				removedEl.style.color = '#888';
				removedEl.style.fontStyle = 'italic';
				removedEl.textContent = '[removed]';
				removedEl.dataset.commentId = commentId;
				commentEl.replaceWith(removedEl);
			} else {
				commentEl.remove();
			}
		}
		this.context.canvas.requestRenderAll();

		if (this._selectedAnnot.comments.filter(c => !c.removed).length === 0) {
			this._clearComments();
			this._renderComments();
		}
	}

	/**
	 * Toggle comments window
     * @param {boolean} enabled Optionally specify state 
     * @param {boolean} [stopPropagation=false] Dont propagate this toggle to the comment window opened state
	 */
	commentsToggleWindow(enabled = undefined, stopPropagation = false) {
		const menu = document.getElementById("annotation-comments-menu");
        if (!menu) return;

		if (!this._commentsEnabled) {
            if (menu.style.display === 'flex') menu.style.display = 'none';
            return;
        }

        if (enabled === undefined) enabled = menu.style.display !== 'flex';
        menu.style.display = enabled ? 'flex' : 'none';
        if (!stopPropagation) {
            const objectId = this._selectedAnnot?.id ?? this._previousAnnotId;
            this._commentsOpened = enabled;
            this._setCommentOpenedCache(objectId, enabled);
        };
	}

	_annotationSelected(object) {
		this._selectedAnnot = object;
		this._renderComments(object.comments);
		this._startCommentsRefresh();

		if (
				this._shouldOpenComments(object.id)
		) {
			this.commentsToggleWindow(true, true);
		}
	}

	_annotationDeselected(object) {
		this._selectedAnnot = null;
    this._previousAnnotId = object.id;
		this.commentsToggleWindow(false, true);
		this._clearComments();
		
		this._stopCommentsRefresh();
	}

	/**
	 * Start the interval to refresh comment timestamps
	 */
	_startCommentsRefresh() {
		this._stopCommentsRefresh();
		
		this._refreshCommentsInterval = setInterval(() => {
			this._refreshCommentTimestamps();
		}, 30_000);
	}

	/**
	 * Stop the comment timestamp refresh interval
	 */
	_stopCommentsRefresh() {
		if (this._refreshCommentsInterval) {
			clearInterval(this._refreshCommentsInterval);
			this._refreshCommentsInterval = null;
		}
	}

	/**
	 * Refresh the timestamp display for all visible comments
	 */
	_refreshCommentTimestamps() {
		if (!this._selectedAnnot || !this._selectedAnnot.comments) {
			return;
		}

		this._selectedAnnot.comments.forEach(comment => {
			if (comment.removed) return;
			
			const commentElement = document.querySelector(`[data-comment-id="${comment.id}"]`);
			if (!commentElement) return;

			const timestampSpan = commentElement.querySelector('span[name="created-at"]');
			if (!timestampSpan) return;

			const timeAgo = this._formatTimeAgo(comment.createdAt);
			timestampSpan.textContent = timeAgo;
		});
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
		const presetListButton = $("#preset-list-button-mp");
		const annotListButton = $("#annotation-list-button-mp");
		const authorListButton = $("#author-list-button-mp");

		presetListButton.attr('aria-selected', false);
		annotListButton.attr('aria-selected', false);
		authorListButton.attr('aria-selected', false);
		
		// hide panels
		const presetList = $("#preset-list-mp");
		const annotList = $("#annotation-list-mp");
		const authorList = $("#author-list-mp");

		presetList.css('display', 'none');
		annotList.css('display', 'none');
		authorList.css('display', 'none');

		if (type === "preset") {
			presetListButton.attr('aria-selected', true);
			presetList.css('display', 'block');
		} else if (type === "authors") {
			authorListButton.attr('aria-selected', true);
			authorList.css('display', 'block');
			this._populateAuthorsList();
		} else { // annot
			if (!this.isModalHistory) {
				annotList.css('display', 'block');
			}
			if (this._preventOpenHistoryWindowOnce) {
				this._preventOpenHistoryWindowOnce = false;
			} else {
				this.openHistoryWindow(this.isModalHistory);
			}
			annotListButton.attr('aria-selected', true);
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

	_toggleAuthorShown(authorId) {
		this.context.toggleAuthorShown(authorId);
		this._populateAuthorsList();
	}

	_updateAuthorBorderColor(authorId, color) {
		this.context.updateAuthorBorderColor(authorId, color);
	}

	_updateAuthorBorderDashing(authorId, dashing) {
		this.context.updateAuthorBorderDashing(authorId, dashing);
	}

	_toggleAuthorIgnoreCustomStyling(authorId) {
		this.context.updateAuthorIgnoreCustomStyling(authorId, !this.context.getAuthorConfig(authorId).ignoreCustomStyling);
		this._populateAuthorsList();
	}

	_populateAuthorsList() {
		const authorListContainer = $("#author-list-inner-mp");
		if (!authorListContainer.length) return;

		const objects = this.context.canvas.getObjects();
		const authorCounts = new Map();

		objects.forEach(obj => {
			if (this.context.isAnnotation(obj) && obj.author) {
				const author = this.context.mapAuthorCallback?.(obj) ?? obj.author;
				
				// skip current user
				if (author === this.user.id) return;
				
				authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
			}
		});

		authorListContainer.empty();

		if (authorCounts.size === 0) {
			authorListContainer.html('<div class="text-muted text-small p-2">No authors found</div>');
			return;
		}

		const sortedAuthors = Array.from(authorCounts.keys()).sort();

		const authorItems = sortedAuthors.map(author => {
			const count = authorCounts.get(author);
			const pluralS = count === 1 ? '' : 's';
			const config = this.context.getAuthorConfig(author);
			const authorIdSafe = author.replace(/[^a-zA-Z0-9]/g, '_');
			
			return `<div class="author-item p-2 border-bottom border-secondary" style="${config.shown ? '' : 'opacity: 0.6;'}">
				<div class="d-flex align-items-center mb-2">
					<span class="material-icons mr-2">person</span>
					<span class="author-name">${author}</span>
				</div>
				<div class="d-flex align-items-center text-muted text-small ml-4 mb-2">
					<span class="mr-2">${count} annotation${pluralS}</span>
					<input type="checkbox" disabled id="author-shown-${authorIdSafe}" ${config.shown ? 'checked' : ''} 
						onchange="${this.THIS}._toggleAuthorShown('${author.replace(/'/g, "\\'")}')">
					<label for="author-shown-${authorIdSafe}" class="text-small ml-1 mr-3">Show</label>
					<input type="checkbox" id="author-ignore-styling-${authorIdSafe}" ${config.ignoreCustomStyling ? 'checked' : ''} 
						onchange="${this.THIS}._toggleAuthorIgnoreCustomStyling('${author.replace(/'/g, "\\'")}')">
					<label for="author-ignore-styling-${authorIdSafe}" class="text-small ml-1">Ignore styling</label>
				</div>
				<div class="ml-4">
					<div class="d-flex align-items-center mb-1">
						<label class="text-small mr-2" style="min-width: 60px;">Color:</label>
						<input type="color" value="${config.borderColor}" class="form-control form-control-sm" style="width: 50px; height: 25px; padding: 1px;"
							onchange="${this.THIS}._updateAuthorBorderColor('${author.replace(/'/g, "\\'")}', this.value)">
					</div>
					<div class="d-flex align-items-center">
						<label class="text-small mr-2" style="min-width: 60px;">Dash:</label>
						<input type="range" min="1" max="50" value="${config.borderDashing}" class="form-control-range flex-grow-1 mr-2"
							oninput="document.getElementById('dash-value-${authorIdSafe}').textContent = this.value"
							onchange="${this.THIS}._updateAuthorBorderDashing('${author.replace(/'/g, "\\'")}', this.value)">
						<span id="dash-value-${authorIdSafe}" class="text-small" style="min-width: 20px;">${config.borderDashing}</span>
					</div>
				</div>
			</div>`;
		}).join('');

		authorListContainer.html(authorItems);
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

		this.context.addHandler('import', (e) => {
			this.updatePresetsHTML(e);
			if ($("#author-list-mp").css('display') !== 'none') {
				this._populateAuthorsList();
			}
		});
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

		this.context.addHandler('annotation-set-private', e => {
			this.context.canvas.requestRenderAll();
		});

		this.context.canvas.on('object:added', e => {
			if ($("#author-list-mp").css('display') !== 'none' && this.context.isAnnotation(e.target)) {
				this._populateAuthorsList();
			}
		});

		this.context.canvas.on('object:removed', e => {
			if ($("#author-list-mp").css('display') !== 'none' && this.context.isAnnotation(e.target)) {
				this._populateAuthorsList();
			}
		});

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
				const containerCss =
					this.isUnpreferredPreset(preset.presetID) && 'opacity-50';
				actions.push({
					icon: icon,
					iconCss: `color: ${preset.color};`,
					containerCss,
					title: category,
					action: () => {
						this._presetSelection = preset.presetID;
						handler();
					},
				});
			});

			if (active) {
				const props = this._getAnnotationProps(active);
				const handlerMarkPrivate = this._clickAnnotationMarkPrivate.bind(this, active);

				actions.push({
					title: "Modify annotation:",
				})
				actions.push({
					title: props.private ? "Unmark as private" : "Mark as private",
					icon: props.private ? "visibility" : "visibility_lock",
					action: () => {
						handlerMarkPrivate();
					}
				})
			}

			actions.push({
				title: "Actions:",
			});

			const mousePos = this._getMousePosition(e);

			const handlerCopy = this._copyAnnotation.bind(this, mousePos, active);
			actions.push({
				title: "Copy",
				icon: "content_copy",
				containerCss: !active && 'opacity-50',
				action: () => {
					if (active) handlerCopy();
				}
			})

			const handlerCut = this._cutAnnotation.bind(this, mousePos, active);
			actions.push({
				title: "Cut",
				icon: "content_cut",
				containerCss: !active && 'opacity-50',
				action: () => {
					if (active) handlerCut();
				}
			})

			const canPaste = this._canPasteAnnotation(e);
			const handlerPaste = this._pasteAnnotation.bind(this, e);
			actions.push({
				title: "Paste",
				icon: "content_paste",
				containerCss: !canPaste && 'opacity-50',
				action: () => {
					if (canPaste) handlerPaste();
				}
			})

			const handlerDelete = this._deleteAnnotation.bind(this, active);
			actions.push({
				title: "Delete",
				icon: "delete",
				containerCss: !active && 'opacity-50',
				action: () => {
					if (active) handlerDelete();
				}
			})

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
				const containerCss =
					this.isUnpreferredPreset(preset.presetID) && 'opacity-50';
				actions.push({
					icon: icon,
					iconCss: `color: ${preset.color};`,
					containerCss,
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
				this.context.Modes.FREE_FORM_TOOL_CORRECT.customHtml =
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
					"next #plugin-tools-menu": "To annotate, you need an annotation mode. <br> Here you can switch from the default, navigation mode <br> to manual control, brush or a magic wand.<br> Switching can be done by mouse or<br>with shortcuts by holding a keyboard key."
				}, {
					"next #annotations-left-click": "Modes are closely described in other tutorials.<br> This button shows what annotation class is being created<br> by a left mouse button."
				}, {
					"click #annotations-right-click": "To open <b>Annotation Class dialog window</b>, click on the button."
				}, {
					"next .preset-option:first": "This is an example of an annotation class <b>preset</b>."
				}, {
					"next #preset-add-new": "Here you create a new class."
				}, {
					"click .preset-option:first": "Click anywhere on the preset. This will select it for the right mouse button."
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
	 * Export annotations for one-time state save
	 * @param preferredFormat
	 * @param withObjects
	 * @param withPresets
	 * @return {Promise<*>}
	 */
	async getExportData(preferredFormat = null, withObjects=true, withPresets=true) {
		this._ioArgs.format = preferredFormat || this._defaultFormat;
		return this.context.export(this._ioArgs, withObjects, withPresets);
	}

	/**
	 * Export annotations and download them
	 */
	exportToFile(withObjects=true, withPresets=true) {
		const toFormat = this.exportOptions.format;
		const name = APPLICATION_CONTEXT.referencedName(true)
			+ "-" + UTILITIES.todayISOReversed() + "-"
			+ (withPresets && withObjects ? "all" : (withObjects ? "annotations" : "presets"))
		this.getExportData(toFormat, withObjects, withPresets).then(result => {
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
			const containerCss =
				this.isUnpreferredPreset(preset.presetID) ? 'opacity-50' : '';
			const icon = preset.objectFactory.getIcon();
			html.push(`<span style="width: 170px; text-overflow: ellipsis; max-lines: 1;"
onclick="return ${this.THIS}._clickPresetSelect(true, '${preset.presetID}');" 
oncontextmenu="return ${this.THIS}._clickPresetSelect(false, '${preset.presetID}');" class="d-inline-block pointer ${containerCss}">
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
	 * @returns {string} HTML
	 */
	getPresetHTML(preset, defaultPreset=undefined) {
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

		let html = [`<div data-preset-id="${preset.presetID}" class="preset-option position-relative border v-align-top border-dashed p-1 rounded-3 d-inline-block mb-2 `];
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
			html.push(`<input class="form-control my-1" type="text" placeholder="name new field" style="width: 140px;">
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

		return `<div class="show-hint" data-hint="${metaObject.name}"><input class="form-control my-1 ${classes}" placeholder="unknown" type="text" onchange="
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

		let currentPreset = this.context.getPreset(isLeftClick) || this.context.presets.get();

		let html = ['<div style="min-width: 270px">'];

		const event = {presets: Object.values(this.context.presets._presets)};
		this.raiseEvent('render-annotation-presets', event);
		html.push(...event.presets.map(p => {
			return typeof p === "string" ? p : this.getPresetHTML(p, currentPreset);
		}));

		if (this.enablePresetModify) {
			html.push(`<div id="preset-add-new" class="border-dashed p-1 mx-2 my-2 rounded-3 d-inline-block 
${this.id}-plugin-root" style="vertical-align:top; width:150px; cursor:pointer; border-color: var(--color-border-secondary);" 
onclick="${this.THIS}.createNewPreset(this, ${isLeftClick});"><span class="material-icons">add</span> New</div>`);
		}
		html.push('</div>');

		const footer = allowSelect
			? `<div class="d-flex flex-row-reverse">
<button id="select-annotation-preset-right" onclick="return ${this.THIS}._clickPresetSelect(false);" 
oncontextmenu="return ${this.THIS}._clickPresetSelect(false);" class="btn m-2">Set for right click </button>
<button id="select-annotation-preset-left" onclick="return ${this.THIS}._clickPresetSelect(true);" 
class="btn m-2">Set for left click </button></div>`
			: `<div class="d-flex flex-row-reverse"><button class="btn btn-primary m-2" onclick="Dialogs.closeWindow('preset-modify-dialog');">Save</button></div>`;

		Dialogs.showCustom("preset-modify-dialog", "<b>Annotations presets</b> <input id=\"preset-filter-select\" class=\"form-control ml-3\" type=\"text\" placeholder=\"Filter presets...\" />", html.join(""), footer);

		// After DOM is rendered, attach BVSelect
		setTimeout(() => {
			$("#preset-filter-select").on('input', e => {
				const search = e.target.value.toLowerCase();
				document.querySelectorAll(`#preset-modify-dialog .preset-option`).forEach(el => {
					const meta = this.context.presets._presets[el.dataset.presetId].meta;
					const value = meta.category?.value.toLowerCase();
					const collection = meta.collection?.name.toLowerCase() || "";
					if (
						!search || value.includes(search) || ("unknown".includes(search) && !value) ||
						collection.includes(search)
					) {
						el.classList.remove("d-none");
					} else {
						el.classList.add("d-none");
					}
				});
			});
		}, 0);
	}

	_clickPresetSelect(isLeft, presetID = undefined) {
		if (!presetID && this._presetSelection === undefined) {
			Dialogs.show('You must click on a preset to be selected first.', 5000, Dialogs.MSG_WARN);
			return false;
		}

		let preset = presetID ? this.context.presets.get(presetID) : this._presetSelection;
		setTimeout(( ) => {
			Dialogs.closeWindow('preset-modify-dialog');
			this._bvselect = null;
			this.context.setPreset(preset, isLeft);
		}, 150);
		return false;
	}

	_getMousePosition(e, checkBounds = true) {
		const image = VIEWER.scalebar.getReferencedTiledImage() || VIEWER.world.getItemAt(0);
		if (!image) return {x: 0, y: 0};
		const screen = new OpenSeadragon.Point(e.originalEvent.x, e.originalEvent.y);

		const {x, y} = image.windowToImageCoordinates(screen);
		const {x: maxX, y: maxY} = image.getContentSize();

		if (
			checkBounds && (
				x <= 0 ||
				y <= 0 ||
				x >= maxX ||
				y >= maxY
			)
		) {
			return false;
		}
		return {x, y};
	}

	_copyAnnotation(mousePos, annotation) {
		const bounds = annotation.getBoundingRect(true, true);
		this._copiedPos = {
			x: bounds.left - mousePos.x,
			y: bounds.top - mousePos.y,
		};
		this._copiedAnnotation = annotation;
	}

	_cutAnnotation(mousePos, annotation) {
		const bounds = annotation.getBoundingRect(true, true);
		this._copiedPos = {
			x: bounds.left - mousePos.x,
			y: bounds.top - mousePos.y,
		};
		this._copiedAnnotation = annotation;
		this._deleteAnnotation(annotation);
	}

	_deleteAnnotation(annotation) {
		this.context.deleteObject(annotation);
		this.context.canvas.requestRenderAll();
	}

	_canPasteAnnotation(e, getMouseValue = false) {
		if (!this._copiedAnnotation) return null;
		const mousePos = this._getMousePosition(e);
		if (getMouseValue) return mousePos;
		else return !!mousePos;
	}

	_pasteAnnotation(e) {
		const mousePos = this._canPasteAnnotation(e, true);
		if (!mousePos) {
			if (mousePos === false) Dialogs.show('Cannot paste annotation out of bounds', 5000, Dialogs.MSG_WARN);
			return;
		}

		const annotation = this._copiedAnnotation;
		const factory = annotation._factory();

		const copy = factory.copy(annotation);
		const res = factory.translate(
			copy,
			{
				x: mousePos.x + this._copiedPos.x,
				y: mousePos.y + this._copiedPos.y,
			},
			true
		);
		this.context.addAnnotation(res);
		factory.renderAllControls(res);
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

	_clickAnnotationMarkPrivate(annotation) {
		const _this = this;
		const newValue = !this._getAnnotationProps(annotation).private;

		_this.context.setAnnotationPrivate(annotation, newValue);
	}

	_getAnnotationProps(annotation) {
		return {
			private: annotation.private
		};
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

	async saveDefault() {
		this.needsSave = false;
		await this.raiseAwaitEvent('save-annotations', {
			getData: this.getExportData.bind(this),
			setNeedsDownload: (needsDownload) => {
				this.needsSave = needsDownload;
			}
		})

		if (this.needsSave) {
			this.exportToFile();
		}
	}

	/**
	 * Set preferred preset IDs for the GUI
	 * @param {string[]} presets array of presetIDs
	 */
	setPreferredPresets(presetIDs) {
		this._preferredPresets = new Set(presetIDs);
	}

	/**
	 * Add a preset ID to the preferred presets
	 * @param {string} presetID 
	 */
	addPreferredPreset(presetID) {
		this._preferredPresets.add(presetID);
	}

	/**
	 * Remove a preset ID from the preferred presets
	 * @param {string} presetID 
	 */
	removePreferredPreset(presetID) {
		this._preferredPresets.delete(presetID);
	}

	/**
	 * Check if a preset ID is not preferred
	 * @param {string} presetID 
	 * @returns {boolean} true if the preset is not preferred
	 */
	isUnpreferredPreset(presetID) {
		return this._preferredPresets.size > 0 && !this._preferredPresets.has(presetID);
	}

}

/*------------ Initialization of OSD Annotations ------------*/
addPlugin("gui_annotations", AnnotationsGUI);
