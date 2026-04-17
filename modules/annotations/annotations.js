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
 */
window.OSDAnnotations = class extends XOpatModuleSingleton {

    constructor() {
        super();
        this.version = "0.0.1";
        this.session = this.version + "_" + Date.now();

        this._activeViewer = VIEWER;
        this.commentsEnabled = true;
        this._init();
        this.user = XOpatUser.instance();

        this._annotationsHistoryProvider = new OSDAnnotations.HistoryProvider(this);
        this._disposeHistoryProvider = APPLICATION_CONTEXT.history.registerProvider(this._annotationsHistoryProvider);
        this._hasUnsavedAnnotationChanges = false;

        VIEWER_MANAGER.addHandler('before-open', () => this.setMode(this.Modes.AUTO));

        this._editSelectionSyncDepth = 0;

        this.addFabricHandler('annotation-selection-changed', (e) => {
            if (this._editSelectionSyncDepth > 0) return;
            this._syncEditModeToSelection(e?.viewer, e?.selected || [], e?.deselected || []);
        });

        // TODO: necessary? kinda overkill...
        // const reapplyFilters = () => this._applyAnnotationFiltersToAllViewers();
        // this.addFabricHandler('annotation-create', reapplyFilters);
        // this.addFabricHandler('annotation-replace', reapplyFilters);
        // this.addFabricHandler('annotation-preset-change', reapplyFilters);
        // this.addFabricHandler('annotation-edit-end', reapplyFilters);
    }

    /**
     * Get fabric wrapper that is bound to a target viewer instance.
     * The output of this method must not be cached and always accessed for accurate reference.
     * @return {OSDAnnotations.FabricWrapper}
     */
    get fabric() {
        return OSDAnnotations.FabricWrapper.instance(this.viewer);
    }

    /**
     * Get target fabric wrapper instance
     * @param {ViewerLikeItem} viewerOrId
     */
    getFabric(viewerOrId) {
        return OSDAnnotations.FabricWrapper.instance(viewerOrId);
    }

    /**
     * Get actual active viewer instance the user interacts with.
     * @return {OpenSeadragon.Viewer}
     */
    get viewer() {
        if (this.__calledViewerGetter) return this._activeViewer;
        this.__calledViewerGetter = true;
        const newRef = VIEWER;
        if (newRef !== this._activeViewer && !this.mode.locksViewer(this._activeViewer, newRef)) {
            this._activeViewer = VIEWER;
        }
        this.__calledViewerGetter = false;
        return this._activeViewer;
    }


    /**
     * Add handler to all contexts of viewers
     * @param args
     */
    addFabricHandler(...args) {
        OSDAnnotations.FabricWrapper.broadcastHandler(...args);
    }

    /**
     * Cancel broadcasting of viewer-bound events
     * @param args
     */
    removeFabricHandler(...args) {
        OSDAnnotations.FabricWrapper.cancelBroadcast(...args);
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

    /**
     * @fires OSDAnnotations.requestExport::save-annotations
     * @return {Promise<string>} returns message from the party that handled the event, or throws if no-one handled it
     */
    async requestExport() {
        let handled = undefined;
        await this.raiseEventAwaiting('save-annotations', {
            setHandled: (message) => {
                handled = message;
            },
            stopPropagation: () => {
                return handled;
            }
        });

        if (handled) {
            return handled;
        }

        throw new Error("Annotation save action was requested but nothing has handled the request.");
    }

    setIOOption(name, value) {
        if (!['imageCoordinatesOffset', 'format'].includes(name)) {
            console.error('Invalid IO option %s set!', name);
        } else {
            this._ioArgs[name] = value;
        }
    }

    getExportOptions() {
        return this._ioArgs;
    }

    async exportViewerData(viewer, key, viewerTargetID) {
        const fabric = this.getFabric(viewer);
        return fabric.export();
    }

    async importViewerData(viewer, key, viewerTargetID, data) {
        if (viewerTargetID && await this._applyPendingUnsavedSnapshot(viewer, viewerTargetID)) {
            return;
        }
        if (data === undefined || data === null) return;

        const fabric = this.getFabric(viewer);
        const options = { inheritSession: true, history: false };
        await fabric.import(data, options);
    }

	_getUnsavedSnapshotStorageKey() {
		return `${this.uid}:_unsaved`;
	}

	_normalizeUnsavedSnapshot(data) {
		if (!data) return null;

		if (typeof data === "string") {
			try {
				data = JSON.parse(data);
			} catch (e) {
				console.warn("Failed to parse cached unsaved annotations snapshot.", e);
				return null;
			}
		}

		if (!data || typeof data !== "object") return null;

		const session = data.session;
		const presets = data.presets;
		const viewers = {};

		if (data.viewers && typeof data.viewers === "object") {
			for (const [viewerId, viewerData] of Object.entries(data.viewers)) {
				if (!viewerId || !viewerData || typeof viewerData !== "object") continue;

				if (viewerData.data !== undefined && viewerData.data !== null) {
					viewers[viewerId] = { data: viewerData.data };
					continue;
				}

				if (Array.isArray(viewerData.objects)) {
					viewers[viewerId] = { objects: viewerData.objects };
				}
			}
		} else if (Array.isArray(data.objects)) {
			const fallbackViewerId = VIEWER?.uniqueId || VIEWER_MANAGER?.viewers?.[0]?.uniqueId || "__active__";
			viewers[fallbackViewerId] = { objects: data.objects };
		}

		return { session, presets, viewers };
	}

	async _buildUnsavedSnapshot() {
		const viewers = (window.VIEWER_MANAGER?.viewers || []).filter(Boolean);
		const byViewer = {};

		this._suppressUnsavedExportReset = true;
		try {
			for (const viewer of viewers) {
				const viewerId = viewer?.uniqueId;
				if (!viewerId) continue;

				try {
					const fabric = this.getFabric(viewer);
					const data = await fabric.export({ format: "native" }, true, false);
					byViewer[viewerId] = { data };
				} catch (e) {
					console.warn(`Failed to cache unsaved annotations for viewer ${viewerId}.`, e);
				}
			}
		} finally {
			this._suppressUnsavedExportReset = false;
		}

		return {
			session: APPLICATION_CONTEXT.sessionName,
			viewers: byViewer,
			presets: this.presets.toObject()
		};
	}

	_clearUnsavedSnapshotState() {
		this._pendingUnsavedSnapshots = {};
		this._restoredUnsavedViewerIds = new Set();
		this._loadedUnsavedPresets = false;
	}

	async _writeUnsavedSnapshot(data) {
		try {
			await this.cache.set('_unsaved', data);
		} catch (e) {
			console.warn('Failed to persist unsaved annotations into cache storage.', e);
		}

		const storageKey = this._getUnsavedSnapshotStorageKey();
		if (!window.localStorage) return;

		try {
			if (data === undefined || data === null) {
				window.localStorage.removeItem(storageKey);
			} else {
				window.localStorage.setItem(storageKey, JSON.stringify(data));
			}
		} catch (e) {
			console.warn('Failed to persist unsaved annotations into local fallback storage.', e);
		}
	}

	_readUnsavedSnapshot() {
		let data;

		try {
			data = this.cache.get('_unsaved');
		} catch (e) {
			console.warn('Failed to read unsaved annotations from cache storage.', e);
		}

		if ((data === undefined || data === null) && window.localStorage) {
			try {
				const raw = window.localStorage.getItem(this._getUnsavedSnapshotStorageKey());
				if (raw !== null) data = JSON.parse(raw);
			} catch (e) {
				console.warn('Failed to read unsaved annotations from local fallback storage.', e);
			}
		}

		return this._normalizeUnsavedSnapshot(data);
	}

	async _applyPendingUnsavedSnapshot(viewer, viewerTargetID) {
		if (!viewerTargetID) return false;
		if (this._restoredUnsavedViewerIds?.has(viewerTargetID)) return true;

		const pending = this._pendingUnsavedSnapshots?.[viewerTargetID];
		if (!pending) return false;

		const fabric = this.getFabric(viewer);

        if (pending.data !== undefined && pending.data !== null) {
            await fabric.import(pending.data, { format: 'native', inheritSession: true, history: false }, true);
        } else if (Array.isArray(pending.objects)) {
            await fabric._loadObjects({ objects: pending.objects }, true);
            this.raiseEvent('import', {
                owner: fabric,
                options: {},
                clear: true,
                data: {
                    objects: pending.objects,
                    presets: this._loadedUnsavedPresets ? this.presets.toObject() : undefined
                },
            });
        } else {
            return false;
        }

		this._restoredUnsavedViewerIds.add(viewerTargetID);
		delete this._pendingUnsavedSnapshots[viewerTargetID];
		return true;
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
			this._pendingUnsavedSnapshots = this._pendingUnsavedSnapshots || {};
			this._restoredUnsavedViewerIds = this._restoredUnsavedViewerIds || new Set();
			await this._initIoFromCache();

            let guard = 0; const _this = this;

            function editRoutine(event, force = false) {
                _this._hasUnsavedAnnotationChanges  = true;

                if (force || guard++ > 10) {
                    guard = 0;
                    void (async () => {
                        const snapshot = await _this._buildUnsavedSnapshot();
                        await _this._writeUnsavedSnapshot(snapshot);
                    })();
                }
            }

            this.addHandler('export', () => {
                if (_this._suppressUnsavedExportReset) return;
                _this._clearUnsavedSnapshotState();
                _this._hasUnsavedAnnotationChanges = false;
                void _this._writeUnsavedSnapshot(null);
                guard = 0;
            });

            this.addFabricHandler('annotation-create', editRoutine);
            this.addFabricHandler('annotation-delete', editRoutine);
            this.addFabricHandler('annotation-replace', editRoutine);
            this.addFabricHandler('annotation-edit', editRoutine);
            window.addEventListener("beforeunload", event => {
                if (guard === 0 || !_this._hasUnsavedAnnotationChanges) return;
                editRoutine(null, true);
            });
			VIEWER_MANAGER.addHandler('viewer-create', event => {
				const targetId = event?.uniqueId;
				const viewer = targetId ? VIEWER_MANAGER.getViewer(targetId, false) || event?.viewer : event?.viewer;
				if (!viewer || !targetId) return;
				void _this._applyPendingUnsavedSnapshot(viewer, targetId);
			});

			if (!this._loadedUnsavedPresets) {
				await this.loadPresetsCookieSnapshot();
			}
		}
		return store;
	}

	async _initIoFromCache() {
		if (!this._storeCacheSnapshots) return;

		this._pendingUnsavedSnapshots = this._pendingUnsavedSnapshots || {};
		this._restoredUnsavedViewerIds = this._restoredUnsavedViewerIds || new Set();

		const data = this._readUnsavedSnapshot();
		if (!data) return;

		if (data.session !== APPLICATION_CONTEXT.sessionName) {
			await this._writeUnsavedSnapshot(null);
			this._clearUnsavedSnapshotState();
			return;
		}

		let accepted = false;
		try {
			accepted = confirm("Your last annotation workspace was not saved! Load cached annotations for this session?");
		} catch (e) {
			console.error("Faulty cached data!", e);
		}

		if (!accepted) {
			await this._writeUnsavedSnapshot(null);
			this._clearUnsavedSnapshotState();
			return;
		}

		try {
			if (data.presets) {
				await this.presets.import(data.presets, true);
				this._loadedUnsavedPresets = true;
			}

			this._pendingUnsavedSnapshots = { ...data.viewers };

			for (const viewerTargetID of Object.keys(this._pendingUnsavedSnapshots)) {
				const viewer = VIEWER_MANAGER.getViewer(viewerTargetID, false);
				if (!viewer) continue;
				await this._applyPendingUnsavedSnapshot(viewer, viewerTargetID);
			}
		} catch (e) {
			this._clearUnsavedSnapshotState();
			await this._writeUnsavedSnapshot(null);
			console.error("Faulty cached data!", e);
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

        for (let instance of OSDAnnotations.FabricWrapper.instances()) {
            instance.setMouseOSDInteractive(isOSDInteractive);
        }
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
        //return to the default state, always
        this.setMode(this.Modes.AUTO);
    }

    enableAnnotations(on) {
        this.enableInteraction(on);
        for (let instance of OSDAnnotations.FabricWrapper.instances()) {
            instance.enableAnnotations(on);
            instance.removeHighlight();
        }
    }

    /**
     * Check whether object is full annotation (not a helper or doppelganger)
     * @param {fabric.Object} o
     * @return {boolean}
     */
    isAnnotation(o) {
        return o.hasOwnProperty("incrementId") && o.hasOwnProperty("sessionID");
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

        if (this.mode === this.Modes.AUTO) {
            this._setModeFromAuto(mode);
        } else if (mode !== this.Modes.AUTO || force) {
            this._setModeToAuto(true);
            this._setModeFromAuto(mode);
        } else {
            this._setModeToAuto(false);
        }

        const enteringEditSelection = this.mode === this.Modes.EDIT_SELECTION;

        for (let instance of OSDAnnotations.FabricWrapper.instances()) {
            const keepActiveEditDoppelganger = enteringEditSelection &&
                (instance?.isEditing?.() || instance?.isOngoingEdit?.());

            if (keepActiveEditDoppelganger) {
                continue;
            }

            instance._doppelgangerClear();
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

        object.internalID = object.internalID || this._generateInternalId();
        this.assignAnnotationIds([object]);
        object.zooming(graphicZoom, zoom);
	}

    setCloseEdgeMouseNavigation(enabled) {
        for (let instance of OSDAnnotations.FabricWrapper.instances()) {
            instance.setCloseEdgeMouseNavigation(enabled);
        }
    }
	/************************ Canvas object modification utilities *******************************/

    _generateInternalId() {
        const MULTIPLIER = 100;
        const now = Date.now();
        const objects = this.fabric.canvas._objects;
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

    assignAnnotationIds(objects) {
        if (!Array.isArray(objects)) objects = [objects];

        for (const object of objects) {
            if (!object || typeof object !== "object") continue;

            if (!Object.prototype.hasOwnProperty.call(object, "incrementId")
                || !Number.isFinite(Number(object.incrementId))) {
                object.incrementId = this._annotationAutoIncrement++;
            } else {
                this._annotationAutoIncrement = Math.max(
                    this._annotationAutoIncrement,
                    Number(object.incrementId) + 1
                );
            }

            if (!Object.prototype.hasOwnProperty.call(object, "label")
                || !Number.isFinite(Number(object.label))) {
                object.label = this._annotationLabelIncrement++;
            } else {
                this._annotationLabelIncrement = Math.max(
                    this._annotationLabelIncrement,
                    Number(object.label) + 1
                );
            }
        }
    }

    getDynamicHistoryDelegate() {
        // 1) let the active mode expose a delegate
        const modeDelegate = this.mode.getHistoryDelegate?.();
        if (modeDelegate && (modeDelegate.isActive?.() ?? true)) {
            return modeDelegate;
        }

        // 2) optional: viewer/fabric level edit session can expose one too
        const fabricDelegate = this.fabric?.getDynamicHistoryDelegate?.();
        if (fabricDelegate && (fabricDelegate.isActive?.() ?? true)) {
            return fabricDelegate;
        }

        return null;
    }

	/**
	 * Set annotation visual property to permanent value
	 * @param {string} propertyName one of OSDAnnotations.CommonAnnotationVisuals keys
	 * @param {any} propertyValue value for the property
	 */
	setAnnotationCommonVisualProperty(propertyName, propertyValue) {
        if (this.presets.setCommonVisualProp(propertyName, propertyValue)) {
            for (let instance of OSDAnnotations.FabricWrapper.instances()) {
                instance.module.presets.setCommonVisualProp(propertyName, propertyValue);
                instance.updateAnnotationVisuals();
            }
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

    /********************* ANNOTATION FILTERING **********************/

    /**
     * Returns the currently active annotation filters.
     * Each filter is normalized into a serializable plain object.
     * @returns {Array<object>}
     */
    getAnnotationFilters() {
        return $.extend(true, [], this._annotationFilters || []);
    }

    /**
     * Replaces the active annotation filters and reapplies visibility on all viewers.
     * Supported filter types are:
     *  - `instanceId`: matches visible annotation increment id in `#number` form
     *  - `author`: matches annotation `author`
     *  - `presetName`: matches annotation `presetID`
     *  - `factoryType`: matches annotation `factoryID`
     *  - `boundingRect`: matches annotations fully contained in the given rectangle
     * @param {Array<object>} filters
     * @param {boolean} [_raise=true]
     * @returns {Array<object>}
     */
    setAnnotationFilters(filters = [], _raise = true) {
        const normalized = Array.isArray(filters)
            ? filters.map(filter => this._normalizeAnnotationFilter(filter)).filter(Boolean)
            : [];
        this._annotationFilters = normalized;
        this._applyAnnotationFiltersToAllViewers();

        if (_raise) {
            this.raiseEvent('annotation-filter-change', {
                filters: this.getAnnotationFilters()
            });
        }
        return this.getAnnotationFilters();
    }

    /**
     * Appends one annotation filter to the active filter set.
     * @param {object} filter
     * @param {boolean} [_raise=true]
     * @returns {Array<object>}
     */
    addAnnotationFilter(filter, _raise = true) {
        const next = this.getAnnotationFilters();
        const normalized = this._normalizeAnnotationFilter(filter);
        if (!normalized) return next;
        next.push(normalized);
        return this.setAnnotationFilters(next, _raise);
    }

    /**
     * Removes one active annotation filter by its normalized id.
     * @param {string} filterId
     * @param {boolean} [_raise=true]
     * @returns {Array<object>}
     */
    removeAnnotationFilter(filterId, _raise = true) {
        const next = this.getAnnotationFilters().filter(filter => filter?.id !== filterId);
        return this.setAnnotationFilters(next, _raise);
    }

    /**
     * Clears all active annotation filters.
     * @param {boolean} [_raise=true]
     * @returns {Array<object>}
     */
    clearAnnotationFilters(_raise = true) {
        return this.setAnnotationFilters([], _raise);
    }

    /**
     * Returns true when the given full annotation passes all active filters.
     * Helper annotations are always considered visible.
     * @param {fabric.Object} annotation
     * @returns {boolean}
     */
    annotationMatchesFilters(annotation) {
        if (!this.isAnnotation(annotation)) return true;

        const filters = this._annotationFilters || [];
        if (!filters.length) return true;

        return filters.every(filter => this._annotationMatchesFilter(annotation, filter));
    }

    /**
     * Returns true when the given full annotation is hidden by the active filter set.
     * @param {fabric.Object} annotation
     * @returns {boolean}
     */
    isAnnotationFilteredOut(annotation) {
        return this.isAnnotation(annotation) && !this.annotationMatchesFilters(annotation);
    }

    /**
     * Returns currently available filter values discovered from existing full annotations.
     * The return object contains arrays for `instanceId`, `author`, `presetName`, and `factoryType`.
     * Each item contains `{ value, label }`.
     * @param {ViewerLikeItem} [viewerOrId]
     * @returns {{instanceId: Array<{value:string,label:string}>, author: Array<{value:string,label:string}>, presetName: Array<{value:string,label:string}>, factoryType: Array<{value:string,label:string}>}}
     */
    getAvailableAnnotationFilterValues(viewerOrId = undefined) {
        const instances = this._resolveFilterTargetInstances(viewerOrId);
        const values = {
            instanceId: [],
            author: [],
            presetName: [],
            factoryType: [],
        };
        const buckets = {
            instanceId: new Map(),
            author: new Map(),
            presetName: new Map(),
            factoryType: new Map(),
        };

        const add = (type, value, label) => {
            const normalizedValue = value === undefined || value === null ? '' : String(value);
            if (!normalizedValue) return;
            if (!buckets[type].has(normalizedValue)) {
                buckets[type].set(normalizedValue, {
                    value: normalizedValue,
                    label: label ?? normalizedValue
                });
            }
        };

        for (const instance of instances) {
            for (const object of instance.canvas?.getObjects?.() || []) {
                if (!instance.isAnnotation(object)) continue;

                const instanceValue = object.incrementId !== undefined ? `#${object.incrementId}` : '';
                add(
                    'instanceId',
                    instanceValue,
                    `${this.getAnnotationFilterDisplayName(object)} · ${instanceValue}`.trim()
                );
                add('author', object.author, object.author || 'Unknown');

                const preset = object.presetID ? this.presets.get(object.presetID) : null;
                add(
                    'presetName',
                    object.presetID,
                    preset?.meta?.category?.value || preset?.presetID || object.presetID
                );

                const factory = this.getAnnotationObjectFactory(object.factoryID);
                add(
                    'factoryType',
                    object.factoryID,
                    factory?.title?.() || object.factoryID
                );
            }
        }

        for (const key of Object.keys(values)) {
            values[key] = [...buckets[key].values()].sort((a, b) => String(a.label).localeCompare(String(b.label)));
        }
        return values;
    }

    /**
     * Returns a user-facing label for one active annotation filter.
     * @param {object} filter
     * @returns {{id:string,text:string}|null}
     */
    describeAnnotationFilter(filter) {
        const normalized = this._normalizeAnnotationFilter(filter);
        if (!normalized) return null;

        const available = this.getAvailableAnnotationFilterValues();
        const labels = normalized.values?.map(value => {
            const candidate = available[normalized.type]?.find(item => item.value === value);
            return candidate?.label || value;
        }) || [];

        switch (normalized.type) {
            case 'instanceId':
                return { id: normalized.id, text: `ID: ${labels.join(', ')}` };
            case 'author':
                return { id: normalized.id, text: `Author: ${labels.join(', ')}` };
            case 'presetName':
                return { id: normalized.id, text: `Preset: ${labels.join(', ')}` };
            case 'factoryType':
                return { id: normalized.id, text: `Type: ${labels.join(', ')}` };
            case 'boundingRect':
                return {
                    id: normalized.id,
                    text: `Rect: ${normalized.rect.x}, ${normalized.rect.y}, ${normalized.rect.width}, ${normalized.rect.height}`
                };
            default:
                return { id: normalized.id, text: normalized.id };
        }
    }

	/********************* AUTHOR CONFIGURATION **********************/

    /**
     * Resolves filter target viewer wrappers.
     * @param {ViewerLikeItem} [viewerOrId]
     * @returns {OSDAnnotations.FabricWrapper[]}
     * @private
     */
    _resolveFilterTargetInstances(viewerOrId = undefined) {
        if (!viewerOrId) {
            return OSDAnnotations.FabricWrapper.instances?.() || [];
        }

        const instance = OSDAnnotations.FabricWrapper.instance(viewerOrId);
        return instance ? [instance] : [];
    }

    /**
     * Normalizes a raw annotation filter description.
     * @param {object} filter
     * @returns {object|null}
     * @private
     */
    _normalizeAnnotationFilter(filter) {
        if (!filter || typeof filter !== 'object') return null;

        const type = String(filter.type || '').trim();
        if (!['instanceId', 'author', 'presetName', 'factoryType', 'boundingRect'].includes(type)) {
            return null;
        }

        if (type === 'boundingRect') {
            const rect = filter.rect || filter.value || {};
            const x = Number(rect.x);
            const y = Number(rect.y);
            const width = Number(rect.width);
            const height = Number(rect.height);
            if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) {
                return null;
            }
            return {
                id: String(filter.id || `${type}:${x}:${y}:${width}:${height}`),
                type,
                rect: { x, y, width, height }
            };
        }

        const values = Array.isArray(filter.values) ? filter.values : [filter.value];
        const normalizedValues = values
            .map(value => value === undefined || value === null ? '' : String(value).trim())
            .filter(Boolean);

        if (!normalizedValues.length) return null;

        return {
            id: String(filter.id || `${type}:${normalizedValues.join('|')}`),
            type,
            values: [...new Set(normalizedValues)]
        };
    }

    /**
     * Tests one annotation against one normalized filter.
     * @param {fabric.Object} annotation
     * @param {object} filter
     * @returns {boolean}
     * @private
     */
    _annotationMatchesFilter(annotation, filter) {
        if (!filter) return true;

        switch (filter.type) {
            case 'instanceId':
                return filter.values.includes(annotation.incrementId !== undefined ? `#${annotation.incrementId}` : '');
            case 'author':
                return filter.values.includes(String(annotation.author || ''));
            case 'presetName':
                return filter.values.includes(String(annotation.presetID || ''));
            case 'factoryType':
                return filter.values.includes(String(annotation.factoryID || ''));
            case 'boundingRect': {
                const bbox = this._getAnnotationFilterRect(annotation);
                if (!bbox) return false;
                return bbox.x >= filter.rect.x &&
                    bbox.y >= filter.rect.y &&
                    bbox.x + bbox.width <= filter.rect.x + filter.rect.width &&
                    bbox.y + bbox.height <= filter.rect.y + filter.rect.height;
            }
            default:
                return true;
        }
    }

    /**
     * Resolves a bounding rectangle for filtering purposes.
     * @param {fabric.Object} annotation
     * @returns {{x:number,y:number,width:number,height:number}|null}
     * @private
     */
    _getAnnotationFilterRect(annotation) {
        if (!annotation) return null;
        try {
            const factory = this.getAnnotationObjectFactory(annotation.factoryID);
            if (factory?.getObjectFocusZone) {
                const zone = factory.getObjectFocusZone(annotation);
                if (zone) {
                    return {
                        x: Number(zone.left ?? zone.x ?? 0),
                        y: Number(zone.top ?? zone.y ?? 0),
                        width: Number(zone.width ?? 0),
                        height: Number(zone.height ?? 0)
                    };
                }
            }

            const rect = annotation.getBoundingRect?.(true, true);
            if (!rect) return null;
            return {
                x: Number(rect.left ?? rect.x ?? 0),
                y: Number(rect.top ?? rect.y ?? 0),
                width: Number(rect.width ?? 0),
                height: Number(rect.height ?? 0)
            };
        } catch (error) {
            console.warn('Failed to resolve annotation bounding rect for filtering.', error);
            return null;
        }
    }

    /**
     * Reapplies the active filter set to every viewer-local annotation canvas.
     * @private
     */
    _applyAnnotationFiltersToAllViewers() {
        for (const instance of this._resolveFilterTargetInstances()) {
            instance.reapplyAnnotationFilters?.(false);
        }
    }

    /**
     * Returns the annotation display name as seen in annotation lists.
     * @param {fabric.Object} annotation
     * @returns {string}
     */
    getAnnotationFilterDisplayName(annotation) {
        if (!annotation) return 'Annotation';

        const preset = annotation.presetID ? this.presets.get(annotation.presetID) : null;
        const category = preset?.meta?.category?.value;
        const factory = this.getAnnotationObjectFactory(annotation.factoryID);
        const fallback = factory?.getDescription?.(annotation)
            || factory?.title?.()
            || 'Annotation';
        const label = annotation.label !== undefined && annotation.label !== null
            ? String(annotation.label)
            : '';
        return `${category || fallback} ${label}`.trim();
    }

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
        for (let instance of OSDAnnotations.FabricWrapper.instances()) {
            instance.setOSDTracking(tracking);
        }
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
        this._ioArgs = this.getStaticMeta("convertors") || {};
        this._defaultFormat = this._ioArgs.format || "native";

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
                this.set({
                    strokeWidth: (this.originalStrokeWidth / zoom) * 5,
                    strokeDashArray: [this.strokeWidth * 3, this.strokeWidth * 2]
                });
				return;
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
		this.objectFactories = {};
		this._extraProps = ["objects"];
		this._wasModeFiredByKey = false;
		this._idCounter = 0;
        this._annotationAutoIncrement = 0;
        this._annotationLabelIncrement = 0;
        this._annotationFilters = [];
		this._storeCacheSnapshots = this.getStaticMeta("storeCacheSnapshots", false);
		this._exportPrivateAnnotations = this.getStaticMeta("exportPrivate", false); // todo make this more configurable
		this._provideDefaultPresets = this.getStaticMeta("provideDefaultPresets", true);
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
		 * FreeFormTool reference
		 * @member {OSDAnnotations.FreeFormTool}
		 */
		this.freeFormTool = new OSDAnnotations.FreeFormTool("freeFormTool", this);

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
        VIEWER_MANAGER.addHandler('key-down', e => this._keyDownHandler(e));
        VIEWER_MANAGER.addHandler('key-up', e => this._keyUpHandler(e));
        // window.addEventListener("blur", e => _this.setMode(_this.Modes.AUTO), false);
    }

    _keyDownHandler(e) {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        // switching mode only when no mode AUTO and mouse is up
        if (this.cursor.isDown || this.disabledInteraction || !e.focusCanvas) return;

        let modeFromCode = this._getModeByKeyEvent(e);
        if (modeFromCode) {
            this._wasModeFiredByKey = true;
            this.setMode(modeFromCode);
            e.preventDefault();
        }
    }

    _getModeByKeyEvent(e) {
        const modes = this.Modes;
        for (let key in modes) {
            if (modes.hasOwnProperty(key)) {
                let mode = modes[key];
                if (mode.accepts(e)) return mode;
            }
        }
        return undefined;
    }

    _keyUpHandler(e) {
        const isTextInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');

        if (this.disabledInteraction || isTextInput) return;

        if (e.focusCanvas) {
            if (!e.ctrlKey && !e.altKey) {
                if (e.key === "Delete" || e.key === "Backspace") {
                    this.mode.discard(true);
                    return;
                }
                if (e.key === "Escape") {
                    for (let instance of OSDAnnotations.FabricWrapper.instances()) {
                        instance.clearAnnotationSelection(true);
                    }
                    this.mode.discard(false);
                    this.setMode(this.Modes.AUTO);
                    return;
                }
            }
        }

        if (this.mode.rejects(e)) {
            this.setMode(this.Modes.AUTO);
            e.preventDefault();
        }
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
    }

	static _registerAnnotationFactory(FactoryClass, atRuntime) {
		let _this = this.instance();
		let factory = new FactoryClass(_this, _this.presets);
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
		}
	}

	_setModeToAuto(switching) {
		this._wasModeFiredByKey = false;
		if (this.presets.left) this.presets.left.objectFactory.finishIndirect();
		if (this.presets.right) this.presets.right.objectFactory.finishIndirect();

		if (this.mode.setToAuto(switching)) {
			this.raiseEvent('mode-changed', {mode: this.Modes.AUTO});

			this.mode = this.Modes.AUTO;
            for (let instance of OSDAnnotations.FabricWrapper.instances()) {
                instance.canvas.hoverCursor = "pointer";
                instance.canvas.defaultCursor = "grab";
            }
		}
	}

    _ensureEditSelectionMode() {
        if (!this.Modes.EDIT_SELECTION) {
            this.setCustomModeUsed('EDIT_SELECTION', OSDAnnotations.StateEditSelection);
        }
        return this.Modes.EDIT_SELECTION;
    }

    isEditSelectionModeActive() {
        return this.mode === this.Modes.EDIT_SELECTION;
    }

    getEditedFabricInstances() {
        return Array.from(OSDAnnotations.FabricWrapper.instances()).filter((instance) =>
            instance?.isEditing?.() || instance?.isOngoingEdit?.()
        );
    }

    hasOngoingEdit() {
        return this.getEditedFabricInstances().length > 0;
    }

    finishSelectionEdit(viewer = undefined, cancelOnly = false) {
        const fabrics = viewer !== undefined
            ? [this.getFabric(viewer)]
            : this.getEditedFabricInstances();

        let handled = false;
        for (const fabric of fabrics.filter(Boolean)) {
            if (fabric.isEditing?.() || fabric.isOngoingEdit?.()) {
                handled = !!fabric.endSelectionEdit?.(cancelOnly) || handled;
            }
        }
        return handled;
    }

    getEditedObject(viewer = undefined) {
        const fabrics = viewer !== undefined
            ? [this.getFabric(viewer)]
            : this.getEditedFabricInstances();

        for (const fabric of fabrics) {
            const object = fabric?.getEditedObject?.() || fabric?.getOngoingEditObject?.();
            if (object) return object;
        }
        return undefined;
    }

    getSelectedEditableObject(viewer = undefined) {
        const fabric = viewer !== undefined ? this.getFabric(viewer) : this.fabric;
        const selected = fabric?.getSelectedAnnotations?.() || [];
        if (selected.length !== 1) return undefined;

        const object = selected[0];
        const factory = this.getAnnotationObjectFactory(object.factoryID);
        if (!factory?.isEditable?.()) return undefined;

        return object;
    }

    startEditModeForObject(object, viewer = undefined) {
        if (!object) return false;

        this._ensureEditSelectionMode();

        const targetViewer = viewer || this.viewer;
        const fabric = this.getFabric(targetViewer);
        if (!fabric) return false;

        if (!fabric.isAnnotationSelected?.(object)) {
            fabric.selectAnnotation?.(object, true, true);
        }

        if (this.mode !== this.Modes.EDIT_SELECTION) {
            this._preferredEditTarget = { viewer: targetViewer, object };
            this.setMode(this.Modes.EDIT_SELECTION);
            return !!(fabric.isEditingObject?.(object) || fabric.isOngoingEditOf?.(object));
        }

        return !!this._enterEditSelectionMode(targetViewer, object);
    }

    _runWithoutEditSelectionSync(callback) {
        this._editSelectionSyncDepth = (this._editSelectionSyncDepth || 0) + 1;
        try {
            return callback?.();
        } finally {
            this._editSelectionSyncDepth = Math.max((this._editSelectionSyncDepth || 1) - 1, 0);
        }
    }

    _isEditSelectionSyncSuspended() {
        return (this._editSelectionSyncDepth || 0) > 0;
    }

    _enterEditSelectionMode(viewer = undefined, preferredObject = undefined) {
        this._ensureEditSelectionMode();

        const preferred = this._preferredEditTarget;
        const targetViewer = viewer || preferred?.viewer || this.viewer;
        const fabric = this.getFabric(targetViewer);
        this._preferredEditTarget = undefined;

        if (!fabric) return true;

        const object = preferredObject || preferred?.object || this.getSelectedEditableObject(targetViewer);
        if (!object) {
            // explicit edit mode stays armed; user can select an annotation next
            return true;
        }

        for (const instance of this.getEditedFabricInstances()) {
            if (instance !== fabric) {
                instance.requestEndSelectionEdit?.(true);
                if (instance.isEditing?.() || instance.isOngoingEdit?.()) {
                    instance.endSelectionEdit?.(true);
                }
            }
        }

        return !!fabric.beginSelectionEdit(object);
    }

    _exitEditSelectionMode(cancelOnly = true, temporary = false) {
        this.finishSelectionEdit(undefined, cancelOnly);
        return true;
    }

    _syncEditModeToSelection(viewer, selected = [], deselected = []) {
        if (this.mode !== this.Modes.EDIT_SELECTION) return;
        if (this._isEditSelectionSyncSuspended?.()) return;

        const fabric = viewer ? this.getFabric(viewer) : this.fabric;
        if (!fabric) return;

        const edited =
            fabric.getEditedObject?.() ||
            fabric.getOngoingEditObject?.();

        const selectedList = Array.isArray(selected) && selected.length
            ? selected
            : (fabric.getSelectedAnnotations?.() || []);

        let selectedEditable = undefined;
        if (selectedList.length === 1) {
            const candidate = selectedList[0];
            const factory = this.getAnnotationObjectFactory(candidate.factoryID);
            if (factory?.isEditable?.()) {
                selectedEditable = candidate;
            }
        }

        if (!selectedEditable) {
            if (edited) {
                this.finishSelectionEdit(viewer, true);
            }
            return;
        }

        if (edited?.incrementId === selectedEditable.incrementId) {
            return;
        }

        fabric.beginSelectionEdit?.(selectedEditable);
    }
};

OSDAnnotations.HistoryProvider = class extends XOpatHistory.XOpatHistoryProvider {
    constructor(module) {
        super();
        this.module = module;
    }

    get importance() {
        // Higher than normal providers so in-progress annotation interactions win first
        return 100;
    }

    _delegate() {
        return this.module.getDynamicHistoryDelegate?.() || null;
    }

    canUndo() {
        const delegate = this._delegate();
        return !!delegate?.canUndo?.();
    }

    canRedo() {
        const delegate = this._delegate();
        return !!delegate?.canRedo?.();
    }

    async undo() {
        const delegate = this._delegate();
        if (!delegate?.canUndo?.()) return false;

        const result = await delegate.undo?.();
        return result !== false;
    }

    async redo() {
        const delegate = this._delegate();
        if (!delegate?.canRedo?.()) return false;

        const result = await delegate.redo?.();
        return result !== false;
    }
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
			// todo outdated usage
			this.context.viewer.raiseEvent('warn-user', {
				originType: "module",
				originId: "annotations",
				code: "W_NO_PRESET",
				message: "Annotation creation requires active preset selection!",
				isLeftClick: isLeftClick
			});
		}
	}

    getHistoryDelegate() {
        return null;
    }

	/**
	 * Discard action: default deletes active object
	 * @param {boolean} [withWarning=true] whether user should get warning in case action did not do anything
	 */
	discard(withWarning=true) {
		this.context.fabric.deleteSelection(withWarning);
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
     * Predicate that returns true if the viewer is locked and must not be changed (even though the
     * user might hover over different viewer). Because, for example, polygon creation can be in progress.
     * By default, locking is always on when cursor is down.
     *
     * This can be used also to listen for viewer changes, not necessarily to return a different
     * value than the default one. E.g:
     *   const willKeepViewer = super.locksViewer(...);
     *   if (!willKeepViewer) {
     *       ... do cleanup
     *   }
     *   return willKeepViewer;
     *
     * @param {OpenSeadragon.Viewer} oldViewerRef
     * @param {OpenSeadragon.Viewer} newViewerRef
     * @return {boolean|*}
     */
    locksViewer(oldViewerRef, newViewerRef) {
        return this.context.cursor.isDown;
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

    getHistoryDelegate() {
        const factory = this._lastUsed;
        if (!factory) return null;

        if (
            typeof factory.canUndoCreate !== "function" &&
            typeof factory.canRedoCreate !== "function"
        ) {
            return null;
        }

        return {
            isActive: () => this.context.freeFormTool.isRunning(),
            canUndo: () => !!factory.canUndoCreate?.(),
            canRedo: () => !!factory.canRedoCreate?.(),
            undo: () => factory.undoCreate?.(),
            redo: () => factory.redoCreate?.(),
        };
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
		// const currentObject = this.context.fabric.canvas.getActiveObject();
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
			this.abortClick(isLeftClick, true);
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
			this.abortClick(isLeftClick, true);
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

    locksViewer() {
        if (this._lastUsed?.canUndoCreate()) {
            // if the last mode supports undo, then we should lock the viewer
            return true;
        }
        return super.locksViewer();
    }

    getHistoryDelegate() {
        const factory = this._lastUsed;
        if (!factory) return null;

        if (
            typeof factory.canUndoCreate !== "function" &&
            typeof factory.canRedoCreate !== "function"
        ) {
            return null;
        }

        return {
            isActive: () => !!factory && !!factory.getCurrentObject?.(),
            canUndo: () => !!factory.canUndoCreate?.(),
            canRedo: () => !!factory.canRedoCreate?.(),
            undo: () => factory.undoCreate?.(),
            redo: () => factory.redoCreate?.(),
        };
    }

	handleClickUp(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) return false;
		this._finish(this._lastUsed);
		return true;
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) {
            this.abortClick(isLeftClick, true);
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
            this.abortClick(isLeftClick, true);
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


OSDAnnotations.StateEditSelection = class extends OSDAnnotations.AnnotationState {
    constructor(context) {
        super(context, "edit-selection", "fa-pen-to-square", "Edit selected annotation");
    }

    setFromAuto() {
        return this.context._enterEditSelectionMode();
    }

    setToAuto(temporary) {
        return this.context._exitEditSelectionMode(false, temporary);
    }

    discard(withWarning = false) {
        this.context._exitEditSelectionMode(true, false);
    }

    accepts(e) {
        return false;
    }

    rejects(e) {
        return false;
    }

    supportsEdgeNavigation() {
        return false;
    }

    locksViewer(oldViewer, newViewer) {
        return this.context.hasOngoingEdit() ? oldViewer === newViewer : false;
    }
};

addModule('annotations', OSDAnnotations);
