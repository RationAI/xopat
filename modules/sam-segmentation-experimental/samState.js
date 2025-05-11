/**
 * Class representing the state of the Segment Anything (SAM) annotation tool.
 */
OSDAnnotations.SegmentAnythingState = class extends OSDAnnotations.AnnotationState {
  constructor(context) {
    super(
      context,
      "SAM_SEGMENTATION",
      "network_intelligence",
      "🅢 segment anything"
    );
    this._samProcessing = false;
    this.sam = window.SAMInference.instance();
    this._initializeSAM();
  }

  async _initializeSAM() {
    await this.sam.loadAllModels();
    this.sam.raiseModelsLoadedEvent(this.context);

    // set default model (first one)
    const defaultModel = Object.keys(this.sam.ALLOWED_MODELS)[0];
    this.sam.setModel(defaultModel);

    // continue initialization
    this._checkGpuServersAvailability();
    this._registerEventListeners();
  }

  /**
   * Raises setup events for the plugin.
   */
  _registerEventListeners() {
    this.context.addHandler("change-selected-model", e => {
      if (e && e.model) {
        this.sam.setModel(e.model);
      }
    });

    this.context.addHandler("change-selected-computation-device", e => {
      if (e && e.device) {
        this.sam.setComputationDevice(e.device);
      }
    });
  }

  /**
   * Checks the availability of GPU servers.
   */
  async _checkGpuServersAvailability() {
    let availableCount = 0;
    console.group(this.sam.GPU_SERVERS);
    const checkPromises = Object.entries(
      this.sam.GPU_SERVERS
    ).map(async ([gpu, serverInfo]) => {
      try {
        console.log(`${serverInfo.path}/gpu`);
        const response = await fetch(`${serverInfo.path}/gpu`, {
          mode: "cors"
        });
        if (response.ok) {
          const data = await response.json();
          if (data.gpu_available == true) {
            this.sam.GPU_SERVERS[gpu].available = true;
            availableCount++;
            console.log(`GPU server available: ${gpu}`);
          }
        }
      } catch (error) {
        console.log(`GPU server ${gpu} not available:`, error);
      }
    });

    await Promise.all(checkPromises);

    if (availableCount > 0) {
      console.log(`At least one GPU server is available.`);
      this.sam.raiseServerAvailableEvent(this.context);
    } else {
      console.log("No GPU servers are available.");
    }
  }

  /**
   * Handles the click event for segmentation.
   * @param {*} o - The event object.
   * @param {*} point - The click point.
   * @param {*} isLeftClick - Indicates if the click is a left click.
   * @param {*} _
   * @returns {Promise<void>}
   */
  async handleClickDown(o, point, isLeftClick, _) {
    if (!isLeftClick || this._samProcessing) return;
    this._samProcessing = true;
    this._isLeft = isLeftClick;
    console.log(`Starting segmentation on point: ${point}`);

    const clickX = o.clientX;
    const clickY = o.clientY;
    const ref = VIEWER.scalebar.getReferencedTiledImage();
    const { blob } = await this.sam.captureViewportImage();

    if (!blob) {
      console.error("Failed to capture viewport image");
      this._samProcessing = false;
      return;
    }
    const samCoords = { x: clickX, y: clickY };

    let result;
    result = await this.sam.runInference(blob, samCoords);
    if (result) {
      const { binaryMask, width, height } = result;
      const polygon = this.sam.maskToPolygon(binaryMask, width, height, ref);

      let visualProps = this.context.presets.getAnnotationOptions(this._isLeft);
      const factory = this.context.getAnnotationObjectFactory("polygon");
      this.result = factory.create(polygon, visualProps);
      this.context.addAnnotation(this.result);
    }

    this._samProcessing = false;
  }
};
