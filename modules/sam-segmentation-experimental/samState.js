/**
 * Class representing the state of the Segment Anything (SAM) annotation tool.
 * @class
 * @extends OSDAnnotations.AnnotationState
 * @param {Object} context - The context of the OSDAnnotations instance.
 */
class SegmentAnythingState extends OSDAnnotations.AnnotationState {
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

  /**
   * Initializes the SAM instance and loads all models.
   * @returns {Promise<void>}
   * @private
   * @async
   */
  async _initializeSAM() {
    this._checkGpuServersAvailability();

    await this.sam.loadAllModels();

    const defaultModel = Object.keys(this.sam.ALLOWED_MODELS)[0];
    this.sam.setModel(defaultModel);

    this._registerEventListeners();
  }

  /**
   * Raises setup events for the plugin.
   * @returns {Promise<void>}
   * @private
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
   * @returns {Promise<void>}
   * @private
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
    } else {
      console.log("No GPU servers are available.");
    }
  }

  /**
   * Handles the click-up event for segmentation.
   * @param {*} o The event object.
   * @param {*} point The point where the click occurred.
   * @param {*} isLeftClick Indicates if the click was a left click.
   * @param {*} _ 
   * @returns {void}
   */
  handleClickUp(o, point, isLeftClick, _) {
    const clickTime = Date.now();
    const clickDelta = clickTime - this.context.cursor.mouseTime;

    // Block if already processing or invalid click
    if (clickDelta > 300 || !isLeftClick || this._samProcessing) return;

    this._samProcessing = true;
    this._isLeft = isLeftClick;
    console.log(`Starting segmentation on point: ${point}`);

    this.context.setOSDTracking(false);
    this.sam.raiseSegmentationStarted();
    setTimeout(() => this._executeSegmentation(o), 0);
  }

  /**
   * Executes the segmentation process.
   * @param {*} o The event object.
   * @returns {Promise<void>}
   * @private
   * @async
   */
  async _executeSegmentation(o) {
    const clickX = o.clientX;
    const clickY = o.clientY;
    const ref = VIEWER.scalebar.getReferencedTiledImage();
    const { blob } = await this.sam.captureViewportImage();

    if (!blob) {
      console.error("Failed to capture viewport image");
      this._samProcessing = false;
      this.sam.raiseSegmentationFinished();
      this.context.setOSDTracking(true);
      return;
    }

    const samCoords = { x: clickX, y: clickY };
    try {
      const result = await this.sam.runInference(blob, samCoords);

      if (result) {
        const { binaryMask, width, height } = result;
        const polygon = this.sam.maskToPolygon(binaryMask, width, height, ref);

        let visualProps = this.context.presets.getAnnotationOptions(
          this._isLeft
        );
        const factory = this.context.getAnnotationObjectFactory("polygon");
        this.result = factory.create(polygon, visualProps);
        this.context.addAnnotation(this.result);
      }

      this.sam.raiseSegmentationFinished(this.context, this.result);
      this.context.setOSDTracking(true);
      this._samProcessing = false;
    } catch (error) {
      console.error("Error during segmentation:", error);
      this._samProcessing = false;
      VIEWER.raiseEvent("error-user", {
        originType: "module",
        originId: "sam-segmentation-experimental",
        code: "W_SAM_ERROR",
        message: "Error during segmentation: " + error.message
      });
      this.sam.raiseSegmentationFinished();
      this.context.setOSDTracking(true);
    }
  }
}

OSDAnnotations.SegmentAnythingState = SegmentAnythingState;
