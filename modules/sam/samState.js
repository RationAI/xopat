OSDAnnotations.SegmentAnythingState = class extends OSDAnnotations.AnnotationState {
  constructor(context) {
    super(
      context,
      "SAM_SEGMENTATION",
      "network_intelligence",
      "🅢 segment anything"
    );
    this._samProcessing = false;
    this.MagicWand = OSDAnnotations.makeMagicWand();

    this._serverAvailable = false;
    this._useServer = false;
    this._serverGPUAvailable = false;
    this._serverGPUName = null;

    window.SAMInferenceReady.then(sam => {
      this.sam = sam;
      this.sam.loadModel();

      // listen for external events
      this.registerEventListeners();

      // check server availability
      this.checkServerAvailability().then(() => {
        this._serverAvailable = true;
        this._serverGPUAvailable = true;
      });
    });
  }

  /**
   * Register event listeners for switching between client and server modes.
   */
  registerEventListeners() {
    // listen for change of computtion side without event context (switch based on current)
    this.context.addHandler("change-computation-side", () => {
      // if not server available, return
      if (!this._serverAvailable) {
        console.warn("Server is not available.");
        return;
      }
      this._useServer = !this._useServer;
      const computationSide = this._useServer ? "server" : "client";
      console.log("Computation side switched to:", computationSide);
      console.log(
        "The current computation side is:",
        this._useServer ? "server" : "client"
      );
    });
  }

  /**
   * Check if the server is available.
   */
  async checkServerAvailability() {
    try {
      const response = await fetch("http://localhost:8000/gpu", {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.serverAvailable = true;
        this.serverGpuName = data.gpu_name || "No GPU";
        console.log("Server GPU available:", this.serverGpuName);
        SegmentationUtils.raiseServerAvailable(
          this.context,
          this.serverGpuName
        );
      } else {
        console.warn(
          "Server is not available. Response status:",
          response.status
        );
      }
    } catch (error) {
      console.warn("Failed to check server availability:", error);
    }
  }

  /**
   * Handle mouse click down event.
   * @param {*} o
   * @param {*} point 
   * @param {*} isLeftClick 
   * @param {*} _ 
   * @returns {Promise<void>}
   */
  async handleClickDown(o, point, isLeftClick, _) {
    if (!isLeftClick || this._samProcessing) return;
    this._samProcessing = true;
    this._isLeft = isLeftClick;

    SegmentationUtils.raiseSegmentationStartEvent(this.context);

    // mouse click coordinates from the event
    const clickX = o.clientX;
    const clickY = o.clientY;
    console.log("Mouse click coordinates (clientX, clientY):", clickX, clickY);

    const ref = VIEWER.scalebar.getReferencedTiledImage();

    // capture the viewport image
    const { blob } = await SegmentationUtils.captureViewportImage();
    if (!blob) {
      console.error("Failed to capture viewport image");
      this._samProcessing = false;
      return;
    }

    const img = new Image();
    img.src = URL.createObjectURL(blob);
    const samCoords = { x: clickX, y: clickY };

    // SAM inference
    let result;
    if (this._useServer) {
      // if server-side computation chosen
      console.log("COMPUTATION MODE: Running inference on server");
      result = await this.sam.runInferenceServer(blob, samCoords);
      console.log("Inference result from server:", result);
    } else {
      console.log("COMPUTATION MODE: Running inference on client");
      result = await this.sam.runInference(blob, samCoords);
      console.log("Inference result from client:", result);
    }

    if (result) {
      const { binaryMask, width, height } = result;

      // convert to polygon
      const polygon = SegmentationUtils.maskToPolygon(
        binaryMask,
        width,
        height,
        ref
      );

      let visualProps = this.context.presets.getAnnotationOptions(this._isLeft);
      const factory = this.context.getAnnotationObjectFactory("polygon");

      // create and add the polygon annotation to the canvas
      this.result = factory.create(polygon, visualProps);
      this.context.addAnnotation(this.result);
    }

    this._samProcessing = false;
    SegmentationUtils.raiseSegmentationEndEvent(this.context);
  }
};
