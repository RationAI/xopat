/**
 * Annotations functionality to the viewer - mouse interaction, events, interfaces, exporting...
 * @type {OSDAnnotations}
 *
 * @typedef {{x: number, y: number}} Point
 *
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
 *
 * @typedef {{
 * 	shown: boolean,
 * 	borderColor: string,
 * 	borderDashing: number,
 * 	ignoreCustomStyling: boolean
 * }} AuthorConfig
 *
 * Consider https://alimozdemir.com/posts/fabric-js-history-operations-undo-redo-and-useful-tips/
 *	- blending ?
 */
window.OSDAnnotations = class extends XOpatModuleSingleton {

	constructor() {
		super("annotations");
		this.version = "0.0.1";
		this.session = this.version + "_" + Date.now();
        this.registerAsEventSource();

        /**
         * @memberOf OSDAnnotations
         * @type {OSDAnnotations.FabricWrapper}
         */
        this._fabricProxy = new OSDAnnotations.FabricWrapper(this, VIEWER);

		this._init();
		this.user = XOpatUser.instance();
	}

    /**
     * Get fabric wrapper that is bound to a target viewer instance.
     * The output of this method must not be cached and always accessed for accurate reference.
     * @return {OSDAnnotations.FabricWrapper}
     */
    get fabric() {
        return this._fabricProxy;
    }

	/**
	 * Add pre-defined mode to annotations. Without registering, the mode will not be available.
	 * @param {string} id ID of the mode, can be one of AUTO, CUSTOM, FREE_FORM_TOOL
	 */
	setModeUsed(id) {
		switch (id) {
			case "AUTO":
				if (this.Modes.AUTO instanceof OSDAnnotations.AnnotationState) {
					this.Modes.AUTO = new OSDAnnotations.StateAuto(this);
				}
				this.mode = this.Modes.AUTO;
				break;
			case "CUSTOM":
				if (!this.Modes.hasOwnProperty("CUSTOM")) {
					this.Modes.CUSTOM = new OSDAnnotations.StateCustomCreate(this);
				}
				break;
			case "FREE_FORM_TOOL_ADD":
				if (!this.Modes.hasOwnProperty("FREE_FORM_TOOL_ADD")) {
					this.Modes.FREE_FORM_TOOL_ADD = new OSDAnnotations.StateFreeFormToolAdd(this);
				}
				break;
			case "FREE_FORM_TOOL_REMOVE":
				if (!this.Modes.hasOwnProperty("FREE_FORM_TOOL_REMOVE")) {
					this.Modes.FREE_FORM_TOOL_REMOVE = new OSDAnnotations.StateFreeFormToolRemove(this);
				}
				break;
			default:
				console.error("Invalid mode ", id);
		}
	}

	/**
	 * Add custom mode to the annotations and activate
	 * please, thoroughly study other modes when they activate/deactivate so that no behavioral collision occurs
	 * @param {string} id mode id, must not collide with existing mode ID's (e.g. avoid pre-defined mode id's)
	 * @param {function} ModeClass class that extends (and implements) OSDAnnotations.AnnotationState
	 */
	setCustomModeUsed(id, ModeClass) {
		if (this.Modes.hasOwnProperty(id)) {
			throw `The mode ${ModeClass} conflicts with another mode: ${this.Modes[id]._id}`;
		}
		if (!OSDAnnotations.AnnotationState.isPrototypeOf(ModeClass)) {
			throw `The mode ${ModeClass} does not inherit from OSDAnnotations.AnnotationState`;
		}
		this.Modes[id] = new ModeClass(this);
	}

	/**
	 * Register Factory for an annotation object type
	 * @static
	 * @param {function} FactoryClass factory that extends AnnotationObjectFactory
	 * @param {boolean} atRuntime true if the factory is registered at runtime
	 */
	static registerAnnotationFactory(FactoryClass, atRuntime=true) {
		if (!OSDAnnotations.AnnotationObjectFactory.isPrototypeOf(FactoryClass)) {
			throw `The factory ${FactoryClass} does not inherit from OSDAnnotations.AnnotationObjectFactory`;
		}

		if (! this.instantiated()) {
			this.__registered = this.__registered ?? [];
			this.__registered.push(FactoryClass);
			return;
		} else if (this.__registered) {
			for (let f of this.__registered) {
				this._registerAnnotationFactory(f, atRuntime);
			}
			delete this.__registered;
		}
		this._registerAnnotationFactory(FactoryClass, atRuntime);
	}

	/******************* EXPORT, IMPORT **********************/
	async exportData() {
		return await this._fabricProxy.export();
	}

	async importData(data) {
		const options = {inheritSession: true};
		if (typeof data === "object" && data.format) {
			options.format = data.format;
		}
		await this._fabricProxy.import(data, options);
	}

	/**
	 * Get the currently used data persistence storage module.
	 * This initializes the main persitor.
	 * @return {PostDataStore}
	 */
	async initPostIO() {
		if (this.POSTStore) return this.POSTStore;

		const store = await super.initPostIO({
			schema: {
				"": {_deprecated: ["annotations"]},
			},
			strictSchema: false
		});

		if (this._storeCacheSnapshots) {
			await this._initIoFromCache();

			let guard = 0; const _this=this;
			function editRoutine(event, force=false) {
				if (force || guard++ > 10) {
					guard = 0;
					//todo ensure cache can be non-persistent as a fallback
					_this.cache.set('_unsaved', {
						session: APPLICATION_CONTEXT.sessionName,
						objects: _this._fabricProxy.toObject(true)?.objects,
						presets: _this.presets.toObject()
					});
				}
			}

			this.addHandler('export', () => {
				_this.cache.set('_unsaved', null);
				guard = 0;
			});
			this._fabricProxy.addHandler('annotation-create', editRoutine);
			this._fabricProxy.addHandler('annotation-delete', editRoutine);
			this._fabricProxy.addHandler('annotation-replace', editRoutine);
			this._fabricProxy.addHandler('annotation-edit', editRoutine);
			window.addEventListener("beforeunload", event => {
				if (guard === 0 || !_this.history.canUndo()) return;
				editRoutine(null, true);
			});

			if (!this._avoidImport) {
				await this.loadPresetsCookieSnapshot();
			}
		}
		return store;
	}

	async _initIoFromCache() {
		if (!this._storeCacheSnapshots) return;

		//todo verify how this behaves with override data import later from the data API
		// also problem: if cache implemented over DB? we could add cache.local option that could
		// explicitly request / enforce local storage usage
		let data = this.cache.get("_unsaved");
		let loaded = false;
		if (data) {
			try {
				if (data?.session === APPLICATION_CONTEXT.sessionName) {
					if (confirm("Your last annotation workspace was not saved! Load?")) {
						//todo do not avoid import but import to a new layer!!!
						this._avoidImport = true;
						if (data?.presets) {
							await this.presets.import(data?.presets, true);
							loaded = true;
						}
						if (data?.objects) {
							await this._fabricProxy._loadObjects({objects: data.objects}, true);
							loaded = true;
						}
					}
				}
			} catch (e) {
				console.error("Faulty cached data!", e);
			}

			if (loaded) {
				this.raiseEvent('import', {
                    owner: this._fabricProxy,
					options: {},
					clear: true,
					data: {
						objects: data.objects,
						presets: data.presets
					},
				});
			} else {
				this._avoidImport = false;
				//do not erase cache upon load, still not saved anywhere
				await this.cache.set('_unsaved', null);
			}
		}
	}

	getFormatSuffix(format=undefined) {
		return OSDAnnotations.Convertor.getSuffix(format);
	}

	/**
	 * Force the module to export additional properties used by external systems
	 * @param {string} value new property to always export
	 */
	set forceExportsProp(value) {
		this._extraProps.push(value);
	}

	/******************* SETTERS, GETTERS **********************/

	/**
	 * Change the interactivity - enable or disable navigation in OpenSeadragon
	 * this is a change meant to be performed from the outside (correctly update pointer etc.)
	 * @event osd-interactivity-toggle
	 * @param {boolean} isOSDInteractive
	 * @param _raise @private
	 */
	setMouseOSDInteractive(isOSDInteractive, _raise=true) {
		if (this.mouseOSDInteractive === isOSDInteractive) return;

		this._fabricProxy.setMouseOSDInteractive(isOSDInteractive);
        if (isOSDInteractive) {
            if (this.presets.left) this.presets.left.objectFactory.finishIndirect();
            if (this.presets.right) this.presets.right.objectFactory.finishIndirect();
        }
		this.mouseOSDInteractive = isOSDInteractive;
		if (_raise) this.raiseEvent('osd-interactivity-toggle');
	}

	/**
	 * Check for OSD interactivity
	 * @return {boolean}
	 */
	isMouseOSDInteractive() {
		return this.mouseOSDInteractive;
	}

	/**
	 * Get object factory for given object type (stored in object.factoryID)
	 * @param {string} objectType the type is stored as a factoryID property
	 * @return {OSDAnnotations.AnnotationObjectFactory | undefined}
	 */
	getAnnotationObjectFactory(objectType) {
		if (this.objectFactories.hasOwnProperty(objectType))
			return this.objectFactories[objectType];
		return undefined;
	}

	/**
	 * Enable or disable interaction with this module,
	 * sets also AUTO mode
	 * @event enabled
	 * @param {boolean} on
	 */
	enableInteraction(on) {
		this.disabledInteraction = !on;
		this.raiseEvent('enabled', {isEnabled: on});
		this.historyManager._setControlsVisuallyEnabled(on);
		//return to the default state, always
		this.setMode(this.Modes.AUTO);
	}

    enableAnnotations(on) {
        this.enableInteraction(on);
        this._fabricProxy.enableAnnotations(on);
        if (!on) {
            this.historyManager.highlight(null);
        }
    }

	/**
	 * Check whether auto, default mode, is on
	 * @return {boolean}
	 */
	isModeAuto() {
		return this.mode === this.Modes.AUTO;
	}

	/**
	 * Set mode by object
	 * @event mode-changed
	 * @param {OSDAnnotations.AnnotationState} mode
	 * @param {boolean} [force=false]
	 */
	setMode(mode, force=false) {
		if (this.disabledInteraction || mode === this.mode) return;

		this._fabricProxy._doppelgangerClear();

		if (this.mode === this.Modes.AUTO) {
			this._setModeFromAuto(mode);
		} else if (mode !== this.Modes.AUTO || force) {
			this._setModeToAuto(true);
			this._setModeFromAuto(mode);
		} else {
			this._setModeToAuto(false);
		}
	}

	/**
	 * Set current mode by mode id
	 * @event mode-changed
	 * @param {string} id
	 * @param {boolean} [force=false]
	 */
	setModeById(id, force=false) {
		let _this = this;
		for (let mode in this.Modes) {
			if (!this.Modes.hasOwnProperty(mode)) continue;
			mode = this.Modes[mode];
			if (mode.getId() === id) {
				_this.setMode(mode, force);
				break;
			}
		}
	}

	/**
	 * Get a reference to currently active preset
	 * @param left true if left mouse button
	 * @return {OSDAnnotations.Preset|undefined}
	 */
	getPreset(left=true) {
		return left ? this.presets.left : this.presets.right;
	}

	/**
     * Set active preset for mouse button
     * @param {OSDAnnotations.Preset|undefined|boolean|number} preset
     *      either a boolean to control selection (true will try to set any preset
     *      and create one if not present, false will unset); or
     *      object OSDAnnotations.Preset to set, or preset ID to set;
     *        undefined behaves as if false was sent
     * @param {boolean} left true if left mouse button
     * @param {boolean} cached
     * @return {OSDAnnotations.Preset|undefined} original preset that has been replaced
     */
	setPreset(preset=undefined, left=true, cached=true) {
		if (typeof preset === "boolean" && preset) {
			for (let key in this.presets._presets) {
				if (this.presets.exists(key)) {
					preset = this.presets.get(key);
					break;
				}
			}
			if (typeof preset === "boolean") preset = this.presets.addPreset();
		}
		let original = this.presets.getActivePreset(left);
		this.presets.selectPreset(preset?.presetID || preset, left, cached);
		return original;
	}

	checkAnnotation(object, zoom, graphicZoom) {
		let preset;
		if (object.presetID) {
			preset = this.presets.get(object.presetID);
			if (!preset) {
				console.log("Object refers to an invalid preset: using default one.");
				preset = this.presets.left || this.presets.unknownPreset;
				object.presetID = preset.presetID;
			}
		} else {
			//todo maybe try to find a preset with the exact same color...
			preset = this.presets.left || this.presets.unknownPreset;
			object.presetID = preset.presetID;
		}
		const props = this.presets.getCommonProperties(preset);
		if (!isNaN(object.zoomAtCreation)) {
			props.zoomAtCreation = object.zoomAtCreation;
		}
		if (object.layerID !== undefined) {
			props.layerID = String(object.layerID);
		}

		let factory = object._factory();
		if (!factory) {
			factory = this.getAnnotationObjectFactory(object.type);
			if (!factory) {
				throw "TODO: solve factory deduction - accepts method on factory?";
			} else {
				object.factoryID = factory.factoryID;
			}
		}
		const conf = factory.configure(object, props);
		factory.renderAllControls(conf);

		object.internalID = object.internalID || this._generateInternalId()
		object.zooming(graphicZoom, zoom);

		this.historyManager.addAnnotationToBoard(object);
	}

	setCloseEdgeMouseNavigation(enable) {
		this.previousEdgeMouseInteractive = this.edgeMouseInteractive;

		if (enable !== this.edgeMouseInteractive && (!enable || this.mode.supportsEdgeNavigation())) {
			this.edgeMouseInteractive = enable;

			window.removeEventListener("mousemove", this._edgesMouseNavigation);
			if (enable) {
				window.addEventListener("mousemove", this._edgesMouseNavigation);
			}

			this.edgeNavDisabledByMode = false;
		}

		return this.edgeMouseInteractive;
	}

	/************************ Canvas object modification utilities *******************************/

	_generateInternalId() {
		const MULTIPLIER = 100;
		const now = Date.now();
		const objects = this._fabricProxy.canvas._objects;
		let lastIdTime = null;

		if (objects.length > 0) {
			const lastObj = objects.at(-1);
			const idSource = lastObj?.isHighlight ? objects.at(-2) : lastObj;

			if (idSource?.internalID) {
				lastIdTime = Math.floor(idSource.internalID / MULTIPLIER);
			}
		}

		if (now === lastIdTime) {
			this._idCounter++;
		} else {
			this._idCounter = 0;
		}

		return now * MULTIPLIER + this._idCounter;
	}

	/**
	 * Undo action, handled by either a history implementation, or the current mode
	 */
	undo() {
		const can = this.mode.canUndo();
		if (can === undefined) return this.history.undo();
		this.mode.undo();
		this.raiseEvent('history-change');
	}

	/**
	 * Redo action, handled by either a history implementation, or the current mode
	 */
	redo() {
		const can = this.mode.canRedo();
		if (can === undefined) return this.history.redo();
		this.mode.redo();
		this.raiseEvent('history-change');
	}

	/**
	 * Check if undo can be performed, returns true/false. Called does not know whether undo is being handled
	 * on the history or active mode level.
	 * @return {boolean}
	 */
	canUndo() {
		const can = this.mode.canUndo();
		if (can !== undefined) return can;
		return this.history.canUndo();
	}

	/**
	 * Check if redo can be performed, returns true/false. Called does not know whether undo is being handled
	 * on the history or active mode level.
	 * @return {boolean}
	 */
	canRedo() {
		const can = this.mode.canRedo();
		if (can !== undefined) return can;
		return this.history.canRedo();
	}



	/**
	 * Set annotation visual property to permanent value
	 * @param {string} propertyName one of OSDAnnotations.CommonAnnotationVisuals keys
	 * @param {any} propertyValue value for the property
	 */
	setAnnotationCommonVisualProperty(propertyName, propertyValue) {
		if (this.presets.setCommonVisualProp(propertyName, propertyValue)) {
			this._fabricProxy.updateAnnotationVisuals();
		}
	}

	/**
	 * Get annotations visual property
	 * @param {string} propertyName one of OSDAnnotations.CommonAnnotationVisuals keys
	 * @return {*}
	 */
	getAnnotationCommonVisualProperty(propertyName) {
		return this.presets.getCommonVisualProp(propertyName);
	}

	/**
	 * Create preset cache, this cache is loaded automatically with initPostIO request
	 * @return {boolean}
	 */
	async createPresetsCookieSnapshot() {
		if (this._storeCacheSnapshots) {
			return await this.cache.set('presets', JSON.stringify(this.presets.toObject()));
		}
	}

	/**
	 * Load cookies cache if available
	 */
	async loadPresetsCookieSnapshot(ask=true) {
		if (!this._storeCacheSnapshots) return;

		const presets = this.presets;
		const presetCookiesData = this.cache.get('presets');

		if (presetCookiesData) {
			// todo this might be invalid since snapshot is imported before load of other functionality..
			if (ask && this.presets._presetsImported) {
				this.warn({
					code: 'W_CACHE_IO_COMMITED',
					message: 'There are presets available in the cache, but did not load since different presets were imported from data.<a onclick="OSDAnnotations.instance().loadPresetsCookieSnapshot(false);" class="pointer">Load anyway.</a>',
				});
				return;
			}
			try {
				await presets.import(presetCookiesData);
			} catch (e) {
				console.error(e);
				this.warn({
					error: e, code: "W_COOKIES_DISABLED",
					message: "Could not load presets. Please, let us know about this issue and provide exported file.",
				});
			}
		}
	}


    /**
     * Check if comments were declared as enabled
     * @returns {boolean}
     */
    getCommentsEnabled() {
        // todo missing set
        return this.commentsEnabled;
    }

	/********************* AUTHOR CONFIGURATION **********************/

	/**
	 * Set a callback to get author ID in form matching XOpatUser.id
	 * @param {(fabricjs.Object) => string | null} callback Function used to return expected author ID, or null to skip computation for this user.
	 */
	setAuthorGetter(callback) {
		this.mapAuthorCallback = callback;
	}

    /**
     * Change the interactivity - enable or disable navigation in OpenSeadragon
     * does not fire events, does not update anything, meant to be called from AnnotationState
     * or internally.
     * @package-private
     * @param {boolean} tracking
     */
    setOSDTracking(tracking) {
        this._fabricProxy.setOSDTracking(tracking);
    }

	/**
	 * Get all authors configuration from cache
	 * @return {Record<string, AuthorConfig>} authors configuration object
	 */
	getAuthorsConfig() {
		try {
			const stored = this.cache.get('authors-config');
			return stored ? JSON.parse(stored) : {};
		} catch (e) {
			console.warn('Failed to parse authors config:', e);
			return {};
		}
	}

	/**
	 * Set all authors configuration to cache
	 * @param {Record<string, AuthorConfig>} authorsConfig authors configuration object
	 */
	setAuthorsConfig(authorsConfig) {
		this.cache.set('authors-config', JSON.stringify(authorsConfig));
	}

	/**
	 * Generate a truly random hex color
	 * @return {string} random hex color
	 */
	generateRandomColor() {
		return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
	}

	/**
	 * Get author configuration with defaults
	 * @param {string} authorId author identifier
	 * @return {AuthorConfig} author configuration
	 */
	getAuthorConfig(authorId) {
		const authorsConfig = this.getAuthorsConfig();
		let config = authorsConfig[authorId];

		if (!config) {
			config = {
				shown: true,
				borderColor: this.generateRandomColor(),
				borderDashing: 10,
				ignoreCustomStyling: false
			};
			// Save the new config immediately to prevent regeneration
			this.setAuthorConfig(authorId, config);
		}

		return {
			shown: true,
			borderColor: this.generateRandomColor(),
			borderDashing: 10,
			ignoreCustomStyling: false,
			...config
		};
	}

	/**
	 * Set author configuration
	 * @param {string} authorId author identifier
	 * @param {Partial<AuthorConfig>} config configuration to merge
	 */
	setAuthorConfig(authorId, config) {
		const authorsConfig = this.getAuthorsConfig();
		const currentConfig = authorsConfig[authorId] || {};
        authorsConfig[authorId] = {...currentConfig, ...config};
		this.setAuthorsConfig(authorsConfig);
	}

	/**
	 * Toggle author shown/hidden state
	 * @param {string} authorId author identifier
	 */
	toggleAuthorShown(authorId) {
		const config = this.getAuthorConfig(authorId);
		config.shown = !config.shown;
		this.setAuthorConfig(authorId, config);
	}

	/**
	 * Update author border color
	 * @param {string} authorId author identifier
	 * @param {string} color hex color string
	 */
	updateAuthorBorderColor(authorId, color) {
		this.setAuthorConfig(authorId, { borderColor: color });
	}

	/**
	 * Update author border dashing
	 * @param {string} authorId author identifier
	 * @param {number|string} dashing dashing value (1-50)
	 */
	updateAuthorBorderDashing(authorId, dashing) {
		this.setAuthorConfig(authorId, { borderDashing: Math.max(1, Math.min(50, parseInt(dashing) || 10)) });
	}

	/**
	 * Update author ignore custom styling setting
	 * @param {string} authorId author identifier
	 * @param {boolean} ignoreCustomStyling whether to ignore custom styling
	 */
	updateAuthorIgnoreCustomStyling(authorId, ignoreCustomStyling) {
		this.setAuthorConfig(authorId, { ignoreCustomStyling: !!ignoreCustomStyling });
	}

	_init() {
		//Consider http://fabricjs.com/custom-control-render
		// can maybe attach 'edit' button controls to object...
		// note the board would have to reflect the UI state when opening

		const _this = this;

		/**
		 * Attach factory getter to each object
		 */
		fabric.Object.prototype._factory = function () {
			const factory = _this.getAnnotationObjectFactory(this.factoryID);
			if (factory) this._factory = () => factory;
			else if (!this.factoryID) {
				console.warn("Object", this.type, "has no associated factory for: ",  this.factoryID);
				//maybe provide general implementation that can do nearly nothing
			}
			return factory;
		};
		fabric.Object.prototype.zooming = function(zoom, _realZoom) {
			if (this.isHighlight) {
                object.set({
                    strokeWidth: (object.originalStrokeWidth / graphicZoom) * 7,
                    strokeDashArray: [object.strokeWidth * 4, object.strokeWidth * 2]
                });
            }
			this._factory()?.onZoom(this, zoom, _realZoom);
		}

		const __renderStroke = fabric.Object.prototype._renderStroke;
		fabric.Object.prototype._renderStroke = function(ctx) {
			if (!_this.strokeStyling) {
				return __renderStroke.call(this, ctx);
			}
			const oDash = this.strokeDashArray;
			const oColor = this.stroke;
			const oWidth = this.strokeWidth;

            if (this.id && _this.user && _this.user.id !== this.author) {
                const author = _this.mapAuthorCallback?.(this);
                if (author && author !== _this.user.id) {
                    const authorConfig = _this.getAuthorConfig(author);
                    if (!authorConfig.ignoreCustomStyling) {
                        this.strokeDashArray = [
                            authorConfig.borderDashing * 10,
                            Math.min(authorConfig.borderDashing * 5, 200)
                        ];
                        this.stroke = authorConfig.borderColor;
                        this.strokeWidth = Math.max(this.strokeWidth, 3);
                    }
                }
            }

			try {
				return __renderStroke.call(this, ctx);
			} finally {
				this.strokeDashArray = oDash;
				this.stroke = oColor;
				this.strokeWidth = oWidth;
			}
		};

		this.Modes = {
			AUTO: new OSDAnnotations.AnnotationState(this, "", "", ""),
		};
		this.mode = this.Modes.AUTO;
		this.disabledInteraction = false;
        // TODO delete in v3
		this.autoSelectionEnabled = VIEWER.hasOwnProperty("bridge");
		this.objectFactories = {};
		this._extraProps = ["objects"];
		this._wasModeFiredByKey = false;
		this._idCounter = 0;
		this._storeCacheSnapshots = this.getStaticMeta("storeCacheSnapshots", false);
		this._exportPrivateAnnotations = APPLICATION_CONTEXT.getOption("exportPrivate", this.getStaticMeta("exportPrivate", false));
        // Rewrite with bind this arg to use in events
        this._edgesMouseNavigation = this._edgesMouseNavigation.bind(this);
		this.cursor = {
			mouseTime: Infinity, //OSD handler click timer
			isDown: false,  //FABRIC handler click down recognition
		};
		this.strokeStyling = false;

		/**
		 * Preset Manager reference
		 * @member {OSDAnnotations.PresetManager}
		 */
		this.presets = new OSDAnnotations.PresetManager("presets", this);
		/**
		 * History reference
		 * @member {History}
		 */
		this.history = APPLICATION_CONTEXT.history;
		/**
		 * History Manager reference
		 * @member {OSDAnnotations.AnnotationHistoryManager}
		 */
		this.historyManager = new OSDAnnotations.AnnotationHistoryManager("historyManager", this, this.presets);

		this.history.setStateChangeCallback(({ canUndo, canRedo }) => {
			this.historyManager.setHistoryState(canUndo, canRedo);
			this.raiseEvent('history-change');
		});

		/**
		 * FreeFormTool reference
		 * @member {OSDAnnotations.FreeFormTool}
		 */
		this.freeFormTool = new OSDAnnotations.FreeFormTool("freeFormTool", this);
		/**
		 * Automatic object creation strategy reference
		 * @member {OSDAnnotations.AutoObjectCreationStrategy}
		 */
		this.automaticCreationStrategy = VIEWER.bridge ?
			new OSDAnnotations.RenderAutoObjectCreationStrategy("automaticCreationStrategy", this) :
			new OSDAnnotations.AutoObjectCreationStrategy("automaticCreationStrategy", this);

		//after properties initialize
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Group, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Polyline, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Line, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Point, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Text, false);
		// OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Image, false);

		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Rect, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Ellipse, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Ruler, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Polygon, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Multipolygon, false);

		/**
		 * Polygon factory, the factory required within the module
		 * @type {OSDAnnotations.AnnotationObjectFactory}
		 */
		this.polygonFactory = this._requireAnnotationObjectPresence("polygon");
		/**
		 * Multipolygon factory, the factory required within the module
		 * @type {OSDAnnotations.AnnotationObjectFactory}
		 */
		this.multiPolygonFactory = this._requireAnnotationObjectPresence("multipolygon");
		this.setMouseOSDInteractive(true, false);

        //Window switch alt+tab makes the mode stuck
        window.addEventListener("focus", e => {
            if (this._wasModeFiredByKey) {
                this.setMode(this.Modes.AUTO);
            }
        }, false);
	}

    _requireAnnotationObjectPresence(type) {
        //When object type presence is a must
        if (this.objectFactories.hasOwnProperty(type)) {
            //create tool-shaped object
            return this.objectFactories[type];
        }
        console.warn("See list of factories available: missing", type, this.objectFactories);
        throw `No ${type} object factory registered. Annotations must contain at least a polygon implementation 
in order to work. Did you maybe named the ${type} factory implementation differently other than '${type}'?`;
    }

    /**
     * Enable or disable per author styling
     * @param {boolean} enable
     */
    toggleStrokeStyling(enable) {
        this.strokeStyling = enable;
        this.raiseEvent('author-annotation-styling-toggle', {enable});
        this._fabricProxy.rerender();
    }

	static _registerAnnotationFactory(FactoryClass, atRuntime) {
		let _this = this.instance();
		let factory = new FactoryClass(_this, _this.automaticCreationStrategy, _this.presets);
		if (_this.objectFactories.hasOwnProperty(factory.factoryID)) {
			throw `The factory ${FactoryClass} conflicts with another factory: ${factory.factoryID}`;
		}
		_this.objectFactories[factory.factoryID] = factory;
		if (atRuntime) _this.raiseEvent('factory-registered', {factory: factory});
	}

	_setModeFromAuto(mode) {
		UTILITIES.setIsCanvasFocused(true);
		if (mode.setFromAuto()) {
			this.mode = mode;
			this.raiseEvent('mode-changed', {mode: this.mode});

			if (this.edgeNavDisabledByMode) this.setCloseEdgeMouseNavigation(this.previousEdgeMouseInteractive);

			if (!this.mode.supportsEdgeNavigation()) {
				this.setCloseEdgeMouseNavigation(false);
				this.edgeNavDisabledByMode = true;
			}
		}
	}

	_setModeToAuto(switching) {
		this._wasModeFiredByKey = false;
		if (this.presets.left) this.presets.left.objectFactory.finishIndirect();
		if (this.presets.right) this.presets.right.objectFactory.finishIndirect();

		if (this.mode.setToAuto(switching)) {
			this.raiseEvent('mode-changed', {mode: this.Modes.AUTO});

			this.mode = this.Modes.AUTO;
			this._fabricProxy.canvas.hoverCursor = "pointer";
			this._fabricProxy.canvas.defaultCursor = "grab";
		}
	}

	_edgesMouseNavigation(e) {
		if (this.mode !== this.Modes.AUTO) {
			const edgeThreshold = 20;
			const mouseX = e.clientX;
			const mouseY = e.clientY;

			const nearLeftEdge = mouseX >= 0 && edgeThreshold - mouseX;
			const nearTopEdge = mouseY >= 0 && edgeThreshold / 2 - mouseY; //top edge near
			const nearRightEdge = mouseX - window.innerWidth + edgeThreshold;
			const nearBottomEdge = mouseY - window.innerHeight + edgeThreshold;

			if (
				(nearTopEdge < edgeThreshold && nearTopEdge > 0) ||
				(nearRightEdge < edgeThreshold && nearRightEdge > 0) ||
				(nearBottomEdge < edgeThreshold && nearBottomEdge > 0) ||
				(nearLeftEdge < edgeThreshold && nearLeftEdge > 0)
			) {
				const center = VIEWER.viewport.getCenter(true);
				const current = VIEWER.viewport.windowToViewportCoordinates(new OpenSeadragon.Point(e.x, e.y));
				let direction = current.minus(center);
				direction = direction.divide(Math.sqrt(Math.pow(direction.x, 2) + Math.pow(direction.y, 2)));
				VIEWER.viewport.panTo(direction.times(0.004 / VIEWER.scalebar.imagePixelSizeOnScreen()).plus(center));
			}
		}
	};
};


/**
 * @classdesc Default annotation state parent class, also a valid mode (does nothing).
 * 	The annotation mode defines how it is turned on (key shortcuts) and how it
 *  drives the user control over this module
 * @class {OSDAnnotations.AnnotationState}
 */
OSDAnnotations.AnnotationState = class {
	/**
	 * Constructor for an abstract class of the Annotation Mode. Extending modes
	 * should have only one parameter in constructor which is 'context'
	 * @param {OSDAnnotations} context passed to constructor of children as the only argument
	 * @param {string} id unique id
	 * @param {string} icon icon to use with this mode
	 * @param {string} description description of this mode
	 */
	constructor(context, id, icon, description) {
		/**
		 * @memberOf OSDAnnotations.AnnotationState
		 * @type {string}
		 */
		this._id = id;
		/**
		 * @memberOf OSDAnnotations.AnnotationState
		 * @type {string}
		 */
		this.icon = icon;
		/**
		 * @memberOf OSDAnnotations.AnnotationState
		 * @type {OSDAnnotations}
		 */
		this.context = context;
		/**
		 * @memberOf OSDAnnotations.AnnotationState
		 * @type {string}
		 */
		this.description = description;
		/**
		 * @memberOf OSDAnnotations.AnnotationState
		 * @type {boolean}
		 */
		this.isZooming = false;
	}

	/**
	 * Perform action on mouse up event
	 * @param {TouchEvent | MouseEvent} o original js event
	 * @param {Point} point mouse position in image coordinates (pixels)
	 * @param {boolean} isLeftClick true if left mouse button
	 * @param {OSDAnnotations.AnnotationObjectFactory} objectFactory factory currently bound to the button
	 * @return {boolean} true if the event was handled, i.e. do not bubble up
	 */
	handleClickUp(o, point, isLeftClick, objectFactory) {
		return false;
	}

	/**
	 * Perform action on mouse down event
	 * @param {TouchEvent | MouseEvent} o original js event
	 * @param {Point} point mouse position in image coordinates (pixels)
	 * @param {boolean} isLeftClick true if left mouse button
	 * @param {OSDAnnotations.AnnotationObjectFactory}objectFactory factory currently bound to the button
	 */
	handleClickDown(o, point, isLeftClick, objectFactory) {
		//do nothing
	}

	/**
	 * Handle mouse moving event while the OSD navigation is disabled
	 * NOTE: mouse move in navigation mode is used to navigate, not available
	 * @param {MouseEvent} o original event
	 * @param {Point} point mouse position in image coordinates (pixels)
	 */
	handleMouseMove(o, point) {
		//do nothing
	}

	/**
	 * Handle mouse hovering event while the OSD navigation is disabled
	 * @param {MouseEvent} event
	 * @param {Point} point mouse position in image coordinates (pixels)
	 */
	handleMouseHover(event, point) {
		//do nothing
	}

	/**
	 * Handle scroll event while the OSD navigation is disabled including zoom
	 * @param {Event} event original MouseWheel event
	 * @param {number} delta event.deltaY property, copied out since this is the value we are interested in
	 */
	scroll(event, delta) {
		//do nothing
	}

	/**
	 * Handle scroll event while the OSD navigation is enabled only for zooming
	 * @param {Event} event original MouseWheel event
	 * @param {number} delta event.deltaY property, copied out since this is the value we are interested in
	 */
	scrollZooming(event, delta) {
		//do nothing
	}

	/**
	 * Handle object being deselected.
	 * Warning: thoroughly test that returning false does not break things!
	 * Preventing object from being deselected means no object can be selected
	 * instead, and also the object cannot be deleted.
	 * @param event
	 * @param object
	 * @return {boolean} true to allow deselection
	 */
	objectDeselected(event, object) {
		return true;
	}

	/**
	 * Handle object being selected
	 * Warning: thoroughly test that returning false does not break things!
	 * @param event
	 * @param object
	 * @return {boolean} true to allow selection
	 */
	objectSelected(event, object) {
		return true;
	}

	/**
	 * @private
	 * Some modes have custom controls,
	 * note that behaviour of this is still not very well designed, e.g. if used in one
	 * plugin it should not be used in others
	 * @return {string} HTML for custom controls
	 */
	customHtml() {
		return "";
	}

	/**
	 * Get the mode description
	 * @return {string} mode description
	 */
	getDescription() {
		return this.description;
	}

	/**
	 * Get the mode Google Icons tag
	 * @return {string} icon tag
	 */
	getIcon() {
		return this.icon;
	}

	/**
	 * Get the mode ID
	 * @return {string} mode unique ID
	 */
	getId() {
		return this._id;
	}

	/**
	 * For internal use, abort handleClickDown
	 * so that handleClickUp is not called
	 * @param isLeftClick true if primary button pressed
	 * @param noPresetError raise error event 'W_NO_PRESET'
	 */
	abortClick(isLeftClick, noPresetError=false) {
		this.context.cursor.abortedTime = this.context.cursor.mouseTime;
		this.context.cursor.mouseTime = Infinity;
		this.context.cursor.isDown = false;

		// if user selects mode by other method than hotkey, do not fire error on right click
		// todo consider OSD filter event implementation and letting others decide whether to warn or not
		if (noPresetError && (isLeftClick || !this.context._wasModeFiredByKey)) {
			VIEWER.raiseEvent('warn-user', {
				originType: "module",
				originId: "annotations",
				code: "W_NO_PRESET",
				message: "Annotation creation requires active preset selection!",
				isLeftClick: isLeftClick
			});
		}
	}

	/**
	 * Undo action, by default noop
	 */
	undo() {
	}

	/**
	 * Undo action, by default return undefined: not handled (undo() will not be called)
	 * @return {boolean|undefined} if undefined, makes system fallback to a builtin history
	 */
	canUndo() {
		return undefined;
	}

	/**
	 * Redo action, by default noop
	 */
	redo() {
	}

	/**
	 * Discard action: default deletes active object
	 * @param {boolean} [withWarning=true] whether user should get warning in case action did not do anything
	 */
	discard(withWarning=true) {
		this.context._fabricProxy.deleteSelection(withWarning);
	}

	/**
	 * Redo action, by default return undefined: not handled (redo() will not be called)
	 * @return {boolean|undefined} if undefined, makes system fallback to a builtin history
	 */
	canRedo() {
		return undefined;
	}

	/**
	 * Check whether the mode is default mode.
	 * @return {boolean} true if the mode is used as a default mode.
	 */
	default() {
		return this._id === "auto"; //hardcoded
	}

	/**
	 * What happens when the mode is being entered in
	 * e.g. disable OSD mouse navigation (this.context.setOSDTracking(..)), prepare variables...
	 *  (previous mode can be obtained from the this.context.mode variable, still not changed)
	 * @return {boolean} true if the procedure should proceed, e.g. mode <this> is accepted
	 */
	setFromAuto() {
		return true;
	}

	/**
	 * What happens when the mode is being exited
	 * e.g. enable OSD mouse navigation (this.context.setOSDTracking(..)), clear variables...
	 * @param {boolean} temporary true if the change is temporary
	 * 	optimization parameter, safe way of changing mode is to go MODE1 --> AUTO --> MODE2
	 * 	however, you can avoid this by returning false if temporary == true, e.g. allow MODE2 to be
	 * 	turned on immediately. This feature is used everywhere in provided modes since all are
	 * 	compatible without problems.
	 * @return {boolean} true if the procedure should proceed, e.g. mode AUTO is accepted
	 */
	setToAuto(temporary) {
		return true;
	}

	/**
	 * Predicate that returns true if the mode is enabled by the key event,
	 * 	by default it is not tested whether the mode from which we go was
	 * 	AUTO mode (safe approach), so you can test this by this.context.isModeAuto()
	 *
	 * NOTE: these methods should be as specific as possible, e.g. test also that
	 * no ctrl/alt/shift key is held if you do not require them to be on
	 *	   these methods should ignore CapsLock, e.g. test e.code not e.key
	 * @param {KeyboardEvent} e key down event
	 * @return {boolean} true if the key down event should enable this mode
	 */
	accepts(e) {
		return false;
	}

	/**
	 * Predicate that returns true if the mode is disabled by the key event
	 * @param {KeyboardEvent} e key up event
	 * @return {boolean} true if the key up event should disable this mode
	 */
	rejects(e) {
		return false;
	}

	/**
	 * Determines if edge mouse navigation is supported
	 * @returns {boolean} true if edge navigation is supported
	 */
	supportsEdgeNavigation() {
		return true;
	}

	/**
	 * Determines whether zoom animation is supported
	 * @returns {boolean} true if zoom animation is supported
	 */
	supportsZoomAnimation() {
		return true;
	}

	/**
	 * Handles the start of a zoom event
	 * and sets the `isZooming` flag to true
	 */
	onZoomStart() {
		this.isZooming = true;
	}

	/**
	 * Handles the end of a zoom event
	 * and resets the `isZooming` flag to false
	 */
	onZoomEnd() {
		this.isZooming = false;
	}
};

OSDAnnotations.StateAuto = class extends OSDAnnotations.AnnotationState {
	constructor(context) {
		super(context, "auto", "fa-arrows-up-down-left-right", "🆀  navigate / select annotations");
	}

	// handleClickUp(o, point, isLeftClick, objectFactory) {
	// 	if (!isLeftClick) return false;
	//
	// 	let clickTime = Date.now();
	//
	// 	let clickDelta = clickTime - this.context.cursor.mouseTime,
	// 		canvas = this.context.canvas;
	//
	// 	// just navigate if click longer than 100ms or other conds not met, fire if double click
	// 	if (clickDelta > 100) return false;
	//
	//
	// 	return true; //considered as handled
	// }

	customHtml() {
		return "";
	}

	accepts(e) {
		return e.code === "KeyQ" && !e.ctrlKey && !e.shiftKey && !e.altKey;
	}

	rejects(e) {
		return false;
	}
};

OSDAnnotations.StateFreeFormTool = class extends OSDAnnotations.AnnotationState {
	constructor(context, id, icon, description) {
		super(context, id, icon, description);
	}

	canUndo() {
		if (this.context.freeFormTool.isRunning()) return false;
		return undefined;
	}

	canRedo() {
		if (this.context.freeFormTool.isRunning()) return false;
		return undefined;
	}

	fftStartWith(point, ffTool, reference, wasCreated) {
		if (reference.asPolygon) {
			ffTool.init(reference.object, wasCreated.asPolygon);
		} else {
			ffTool.init(reference, wasCreated);
		}
		ffTool.update(point);
	}

	//find either array of points (intersection) or nested array of points /targets/
	fftFindTarget(point, ffTool, brushPolygon, offset=0) {
		function getObjectAsCandidateForIntersectionTest(o) {
			if (!o.sessionID) return false;
			let	factory = o._factory();
			if (!factory.isEditable()) return false;
			const result = factory.isImplicit()
				? factory.toPointArray(o, OSDAnnotations.AnnotationObjectFactory.withObjectPoint)
				: o.points;
			if (!result) return false;
			return {object: o, asPolygon: result};
		}
		// This optimization breaks the logics, since click itself has changed the active annotation if nested
		// const currentObject = this.context._fabricProxy.canvas.getActiveObject();
		// let current = currentObject && getObjectAsCandidateForIntersectionTest(currentObject);
		// if (current && OSDAnnotations.PolygonUtilities.polygonsIntersect(brushPolygon, current.asPolygon)) {
		// 	return current;
		// }

		// Instead, loop only through near polygons in the nice order -> this will process
		// first top annotations -> potentially selected
		const candidates = this.context.fabric.findIntersectingObjectsByBBox({
			x: point.x - ffTool.radius - offset,
			y: point.y - ffTool.radius - offset,
			width: ffTool.radius * 2 + offset,
			height: ffTool.radius * 2 + offset
		}, getObjectAsCandidateForIntersectionTest);

		const polygonUtils = OSDAnnotations.PolygonUtilities;
		const active = this.context.fabric.getSelectedAnnotations().length > 0;
		let max = 0, result = candidates; // by default return the whole list if intersections are <= 0

		for (let candidate of candidates) {
			let outerPolygon;
			let holes = null;
			let notFullyInHoles = false;
			let isMultipolygon = candidate.object.factoryID === "multipolygon";

			if (isMultipolygon) {
				outerPolygon = candidate.asPolygon[0];
				holes = candidate.asPolygon.slice(1);
			} else {
				outerPolygon = candidate.asPolygon;
			}

			const intersection = OSDAnnotations.checkPolygonIntersect(brushPolygon, outerPolygon);
			if (!intersection.length) continue;

			if (holes) {
				notFullyInHoles = holes.every(hole => {

					const bboxBrush = polygonUtils.getBoundingBox(brushPolygon);
					const bboxHole = polygonUtils.getBoundingBox(hole);

					if (polygonUtils.intersectAABB(bboxBrush, bboxHole)) {
						const preciseIntersection = OSDAnnotations.checkPolygonIntersect(brushPolygon, hole);
						return !(JSON.stringify(preciseIntersection) === JSON.stringify(brushPolygon));
					}
					return true;
				});
			}

			if (!isMultipolygon || notFullyInHoles) {
				if (active) {  // prefer first encountered object if it is also the selection
					return candidate.object;
				}
				if (intersection.length > max) {
					max = intersection.length;
					result = candidate.object;
				}
			}
		}
		return result;
	}

	fftFoundIntersection(result) {
		return !Array.isArray(result);
	}

	scroll(event, delta) {
		//subtract delta - scroll up means increase
		this.context.freeFormTool.setSafeRadius(this.context.freeFormTool.screenRadius - delta / 100);
	}

	setFromAuto() {
		this.context.setOSDTracking(false);
		this.context.fabric.canvas.hoverCursor = "crosshair";
		this.context.fabric.canvas.defaultCursor = "crosshair";
		this.context.freeFormTool.recomputeRadius();
		this.context.freeFormTool.showCursor();
		return true;
	}

	setToAuto(temporary) {
		this.context.freeFormTool.hideCursor();
		if (temporary) return false;

		this.context.setOSDTracking(true);
		this.context.fabric.rerender();
		return true;
	}

	supportsEdgeNavigation() {
		return false;
	}

	supportsZoomAnimation() {
		return false;
	}
};

OSDAnnotations.StateFreeFormToolAdd = class extends OSDAnnotations.StateFreeFormTool {

	constructor(context) {
		super(context, "fft-add", "fa-paintbrush", "🅴  brush to create/edit");
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		let result = this.context.freeFormTool.finish();
		if (result) {
			this.context.fabric.rerender();
		}
		return true;
	}

	handleMouseMove(e, point) {
		this.context.freeFormTool.recomputeRadius();
		this.context.freeFormTool.update(point);
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) {
			this.abortClick(isLeftClick);
			return;
		}
		this.context.fabric.clearAnnotationSelection(true);

		let created = false;
		const ffTool = this.context.freeFormTool;
		ffTool.zoom = this.context.fabric.canvas.getZoom();
		ffTool.recomputeRadius();
		const newPolygonPoints = ffTool.getCircleShape(point);
		let targetIntersection = this.fftFindTarget(point, ffTool, newPolygonPoints, 0);
		if (!this.fftFoundIntersection(targetIntersection)) {
			targetIntersection = this.context.polygonFactory.create(newPolygonPoints,
				this.context.presets.getAnnotationOptions(isLeftClick));
			created = true;
		}
		this.fftStartWith(point, ffTool, targetIntersection, created);
	}

	setFromAuto() {
		this.context.freeFormTool.setModeAdd(true);
		return super.setFromAuto();
	}

	accepts(e) {
		return e.code === "KeyE" && !e.ctrlKey && !e.shiftKey && !e.altKey;
	}

	rejects(e) {
		return e.code === "KeyE";
	}
};

OSDAnnotations.StateFreeFormToolRemove = class extends OSDAnnotations.StateFreeFormTool {

	constructor(context) {
		super(context, "fft-remove", "fa-paintbrush", "🆁  brush to remove");
		this.candidates = null;
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		this.candidates = null;
		let result = this.context.freeFormTool.finish();
		if (result) {
			this.context.fabric.rerender();
		}
		return true;
	}

	handleMouseMove(e, point) {
		const ffTool = this.context.freeFormTool;
		if (this.candidates) {
			const target = ffTool.getCircleShape(point);
			for (let i = 0; i < this.candidates.length; i++) {
				let candidate = this.candidates[i];
				if (OSDAnnotations.PolygonUtilities.polygonsIntersect(target, candidate.asPolygon)) {
					this.candidates = null;
					this.fftStartWith(point, ffTool, candidate, false);
					return;
				}
			}
		} else {
			ffTool.recomputeRadius();
			ffTool.update(point);
		}
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) {
			this.abortClick(isLeftClick);
			return;
		}
		this.context.fabric.clearAnnotationSelection(true);

		const ffTool = this.context.freeFormTool;
		ffTool.zoom = this.context.fabric.canvas.getZoom();
		ffTool.recomputeRadius();
		const newPolygonPoints = ffTool.getCircleShape(point);
		let candidates = this.fftFindTarget(point, ffTool, newPolygonPoints, 50);

		if (this.fftFoundIntersection(candidates)) {
			this.fftStartWith(point, ffTool, candidates, false);
		} else {
			// still allow selection just search for cached targets
			this.candidates = candidates;
		}
	}

	setFromAuto() {
		this.context.freeFormTool.setModeAdd(false);
		return super.setFromAuto();
	}

	accepts(e) {
		return e.code === "KeyR" && !e.ctrlKey && !e.shiftKey && !e.altKey;
	}

	rejects(e) {
		return e.code === "KeyR";
	}
};

OSDAnnotations.StateCustomCreate = class extends OSDAnnotations.AnnotationState {
	constructor(context) {
		super(context, "custom", "fa-object-group", "🆆  create annotations manually");
		this._lastUsed = null;
	}

	discard(withWarning) {
		if (this._lastUsed && this._lastUsed.getCurrentObject()) {
			this._lastUsed.discardCreate();
		} else {
			super.discard(withWarning);
		}
	}

	canUndo() {
		if (this._lastUsed) return this._lastUsed.canUndoCreate();
		return undefined;
	}

	canRedo() {
		if (this._lastUsed) return this._lastUsed.canRedoCreate();
		return undefined;
	}

	undo() {
		if (this._lastUsed) return this._lastUsed.undoCreate();
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) return false;
		this._finish(this._lastUsed);
		return true;
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) {
			return;
		}
		this._init(point, isLeftClick, objectFactory);
	}

	handleMouseMove(e, point) {
		//todo experiment with this condition, also is it necessary for fft?
		if (this.context.isMouseOSDInteractive()) {
			if (this.context.presets.left) this.context.presets.left.objectFactory.updateCreate(point.x, point.y);
			if (this.context.presets.right) this.context.presets.right.objectFactory.updateCreate(point.x, point.y);
			this.context.fabric.rerender();
		}
	}

	_init(point, isLeftClick, updater) {
		if (!updater) return;
		updater.initCreate(point.x, point.y, isLeftClick);
		this._lastUsed = updater;
	}

	_finish(updater) {
		if (!updater) return;
		let delta = Date.now() - this.context.cursor.mouseTime;

		// if click too short, user probably did not want to create such an object, discard
		if (delta < updater.getCreationRequiredMouseDragDurationMS()) {
			const helper = updater.getCurrentObject();
			if (Array.isArray(updater.getCurrentObject())) {
				for (let item of helper) {
					this.context.fabric.deleteHelperAnnotation(item);
				}
			} else {
				this.context.fabric.deleteHelperAnnotation(helper);
			}
			this._lastUsed = null;
			return;
		}
		if (updater.finishDirect()) {
			this._lastUsed = null;
		}
	}

	setFromAuto() {
		this.context.setOSDTracking(false);
		//deselect active if present
		this.context.fabric.canvas.hoverCursor = "crosshair";
		this.context.fabric.canvas.defaultCursor = "crosshair";
		return true;
	}

	setToAuto(temporary) {
		if (temporary) return false;
		this.context.setOSDTracking(true);
		return true;
	}

	accepts(e) {
		return e.code === "KeyW" && !e.ctrlKey && !e.shiftKey && !e.altKey;
	}

	rejects(e) {
		return e.code === "KeyW";
	}
};

OSDAnnotations.StateCorrectionTool = class extends OSDAnnotations.StateFreeFormTool {

	constructor(context) {
		super(context, "fft-correct", "fa-paintbrush", "🆉  correction tool");
		this.candidates = null;
	}

	canUndo() {
		if (this.context.freeFormTool.isRunning()) return false;
		return undefined;
	}

	canRedo() {
		if (this.context.freeFormTool.isRunning()) return false;
		return undefined;
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		this.candidates = null;
		let result = this.context.freeFormTool.finish();
		if (result) {
			this.context.fabric.rerender();
		}
		return true;
	}

	handleMouseMove(e, point) {
		const ffTool = this.context.freeFormTool;
		if (this.candidates) {
			const target = ffTool.getCircleShape(point);
			for (let i = 0; i < this.candidates.length; i++) {
				let candidate = this.candidates[i];
				if (OSDAnnotations.PolygonUtilities.polygonsIntersect(target, candidate.asPolygon)) {
					this.candidates = null;
					this.fftStartWith(point, ffTool, candidate, false);
					return;
				}
			}
		} else {
			ffTool.recomputeRadius();
			ffTool.update(point);
		}
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		objectFactory = this.context.presets.left;
		if (!objectFactory) {
			this.abortClick(isLeftClick);
			return;
		}
		this.context.fabric.clearAnnotationSelection(true);
		this.context.freeFormTool.setModeAdd(isLeftClick);

		const ffTool = this.context.freeFormTool,
			newPolygonPoints = ffTool.getCircleShape(point);
		ffTool.zoom = this.context.fabric.canvas.getZoom();
		let candidates = this.fftFindTarget(point, ffTool, newPolygonPoints, 50);

		if (this.fftFoundIntersection(candidates)) {
			this.fftStartWith(point, ffTool, candidates, false);
		} else {
			// still allow selection to just search for cached targets
			this.candidates = candidates;
		}
	}

	setFromAuto() {
		return super.setFromAuto();
	}

	accepts(e) {
		return e.code === "KeyZ" && !e.ctrlKey && !e.shiftKey && !e.altKey;
	}

	rejects(e) {
		return e.code === "KeyZ";
	}
};
