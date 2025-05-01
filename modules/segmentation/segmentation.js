window.SegmentationUtils = class extends XOpatModuleSingleton {
  constructor(context) {
    super(context, "segmentation");
    this.version = "0.0.1";
    this.session = this.version + "_" + Date.now();
    this.registerAsEventSource();
  }

  static raiseSegmentationStartEvent(context) {
    context.raiseEvent("segmentation-start");
  }

  static raiseSegmentationEndEvent(context) {
    context.raiseEvent("segmentation-end");
  }

  static raiseModelsLoadedEvent(context) {
    context.raiseEvent("models-loaded");
  }

  static raiseServerAvailable(context, gpuName) {
    context.raiseEvent("server-available", {
      gpuName
    });
  }

  /**
   * Creates a drawer for capturing the viewport image.
   * @returns {OpenSeadragon.Drawer} The drawer instance.
   */
  static createDrawer() {
    const drawer = new OpenSeadragon.Drawer({
      viewer: VIEWER,
      viewport: VIEWER.viewport,
      element: VIEWER.canvas,
      debugGridColor: VIEWER.debugGridColor
    });
    drawer.canvas.style.setProperty("z-index", "-999");
    drawer.canvas.style.setProperty("visibility", "hidden");
    drawer.canvas.style.setProperty("display", "none");
    return drawer;
  }

  /**
   * Captures the viewport image at the specified point.
   * @returns {Promise<{ blob: Blob}>} The captured image.
   */
  static async captureViewportImage() {
    return new Promise(resolve => {
      const drawer = SegmentationUtils.createDrawer();
      drawer.clear();

      const targetImage = VIEWER.world.getItemAt(0);
      const oldDrawer = targetImage._drawer;
      targetImage._drawer = drawer;
      targetImage.draw();
      targetImage._drawer = oldDrawer;

      const viewerWidth = VIEWER.container.clientWidth;
      const viewerHeight = VIEWER.container.clientHeight;

      // create a temporary canvas to resize the captured image
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = viewerWidth;
      tempCanvas.height = viewerHeight;
      const tempCtx = tempCanvas.getContext("2d");

      tempCtx.drawImage(
        drawer.canvas,
        0,
        0,
        drawer.canvas.width,
        drawer.canvas.height,
        0,
        0,
        viewerWidth,
        viewerHeight
      );

      // convert the resized canvas to a blob
      tempCanvas.toBlob(blob => {
        if (!blob) {
          console.error("Failed to capture viewport image");
          this.emitEvent("segmentation-error", {
            error: "Failed to capture viewport image"
          });
          return resolve(null);
        }

        resolve({
          blob
        });
      }, "image/png");
    });
  }

  /**
   * Displays a mask on the canvas.
   * @param {Blob} maskBlob - The mask image as a Blob.
   * @param {{ x: number, y: number }} clickPoint - The point where the mask should be displayed.
   * @param {number} scale - The scale of the mask.
   * @param {fabric.Canvas} canvas - The Fabric.js canvas to display the mask on.
   */
  static displayMask(maskBlob, clickPoint, scale, canvas) {
    const maskUrl = URL.createObjectURL(maskBlob);

    fabric.Image.fromURL(maskUrl, img => {
      img.set({
        left: clickPoint.x,
        top: clickPoint.y,
        originX: "left",
        originY: "top",
        scaleX: 1 / scale,
        scaleY: 1 / scale,
        selectable: false,
        hasControls: false,
        hasBorders: false,
        lockMovementX: true,
        lockMovementY: true,
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true,
        lockUniScaling: true,
        opacity: 0.5
      });

      canvas.add(img);
      canvas.renderAll();
    });
  }

  /**
   * Converts a binary mask to a polygon.
   * @param {Uint8Array} binaryMask - The binary mask.
   * @param {number} width - The width of the mask.
   * @param {number} height - The height of the mask.
   * @returns {Array<{ x: number, y: number }>} The polygon points.
   */
  static maskToPolygon(binaryMask, width, height, ref) {
    this.MagicWand = OSDAnnotations.makeMagicWand();
    const bounds = {
      minX: 0,
      minY: 0,
      maxX: width,
      maxY: height
    };

    const mask = {
      data: binaryMask,
      width,
      height,
      bounds
    };

    const cs = this.MagicWand.traceContours(mask);
    let largest,
      count = 0;
    for (let line of cs) {
      if (!line.inner && line.points.length > count) {
        largest = line.points;
        count = largest.length;
      }
    }

    if (largest) {
      largest = largest.map(pt =>
        ref.windowToImageCoordinates(new OpenSeadragon.Point(pt.x, pt.y))
      );
    }

    return largest;
  }
};
