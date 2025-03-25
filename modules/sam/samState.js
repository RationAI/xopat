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

    window.SAMInferenceReady.then(sam => {
      this.sam = sam;
      this.sam.loadModel();
    });
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
    const {
      blob,
      viewportLeftTop,
      scale
    } = await SegmentationUtils.captureViewportImage(point);
    if (!blob) {
      console.error("Failed to capture viewport image");
      this._samProcessing = false;
      return;
    }

    const img = new Image();
    img.src = URL.createObjectURL(blob);
    const samCoords = { x: clickX, y: clickY };

    // SAM inference
    const result = await this.sam.runInference(blob, samCoords);
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
      visualProps.stroke = "#00FF00";
      visualProps.fill = "#00FF0080";
      visualProps.strokeWidth = 2;
      visualProps.selectable = true;

      // create and add the polygon annotation to the canvas
      this.result = factory.create(polygon, visualProps);
      this.context.addAnnotation(this.result);
    }

    this._samProcessing = false;
    SegmentationUtils.raiseSegmentationEndEvent(this.context);
  }
};
