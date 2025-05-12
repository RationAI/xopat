/**
 * This class is responsible for loading Transformers.js library, loading models and running inference.
 */
window.SAMInference = class extends XOpatModuleSingleton {
  constructor() {
    super("sam-segmentation-experimental");
    this._models = {};
    this._processors = {};
    this._modelsLoaded = false;
    this._selectedModel = null;
    this._selectedComputationDevice = "Client";
    this.registerAsEventSource();

    // Servers defined in the configuration
    const serverConfigs = this.getStaticMeta("servers", []);
    this.GPU_SERVERS = {};
    for (const server of serverConfigs) {
      this.GPU_SERVERS[server.name] = {
        path: server.path,
        available: false
      };
    }

    // Models defined in the configuration
    const models = this.getStaticMeta("models", []);
    this.ALLOWED_MODELS = {};
    for (const model of models) {
      const shortName = model.split("/").pop();
      this.ALLOWED_MODELS[model] = shortName;
    }
  }

  async raiseModelsLoadedEvent(context) {
    context.raiseEvent("models-loaded");
  }

  async raiseSegmentationStarted(context) {
    context.raiseEvent("segmentation-started");
  }

  async raiseSegmentationFinished(context) {
    context.raiseEvent("segmentation-finished");
  }

  /**
   * Load models specified in the configuration (include.json).
   */
  async loadAllModels() {
    await this._loadDependencies();

    const device = await this._getBestDevice();
    globalThis.TRANSFORMERS_BACKEND = device;

    for (const hfModelName of Object.keys(this.ALLOWED_MODELS)) {
      this._processors[hfModelName] = await this.AutoProcessor.from_pretrained(
        hfModelName
      );
      this._models[
        hfModelName
      ] = await this.SamModel.from_pretrained(hfModelName, {
        dtype: "q8"
      });
    }

    this._selectedModel = Object.keys(this.ALLOWED_MODELS)[0];
    this._modelsLoaded = true;
    console.log("All allowed models loaded.");
  }

  /**
   * Setter for active model.
   * @param {*} modelName
   */
  setModel(modelName) {
    if (this._models[modelName]) {
      this._selectedModel = modelName;
      console.log(`Model switched to: ${modelName}`);
    } else {
      console.error(`Model ${modelName} not loaded.`);
    }
  }

  /**
   * Setter for active computation device.
   * @param {*} computationDevice
   */
  setComputationDevice(computationDevice) {
    this._selectedComputationDevice = computationDevice;
    console.log(`Computation switched to: ${computationDevice}`);
  }

  /**
   * Runs inference based on the selected model and computation device.
   * @param {*} viewportBlob Blob of the viewport image.
   * @param {*} clickCoords Coordinates of the segmentation.
   * @returns
   */
  async runInference(viewportBlob, clickCoords) {
    if (!this._modelsLoaded) {
      console.error("Models not loaded.");
      return null;
    }
    if (!viewportBlob) {
      console.error("Invalid viewportBlob passed.");
      return null;
    }

    if (this._selectedComputationDevice === "Client") {
      return await this._runInferenceClient(viewportBlob, clickCoords);
    } else {
      return await this._runInferenceServer(viewportBlob, clickCoords);
    }
  }

  /**
   * Loads the dependencies for the transformers library.
   * @returns
   */
  async _loadDependencies() {
    if (this.AutoProcessor) return;

    const transformersConfig = this.getStaticMeta("transformers", {});
    const libPath = transformersConfig.library;
    const expectedHash = transformersConfig.hash;

    if (!libPath || !expectedHash) {
      console.error("Transformers library path or hash not found in config.");
      return;
    }

    try {
      const lib = await this._fetchAndVerifyScript(libPath, expectedHash);
      this.AutoProcessor = lib.AutoProcessor;
      this.SamModel = lib.SamModel;
      this.RawImage = lib.RawImage;
    } catch (err) {
      console.error("Secure loading of transformers library failed:", err);
    }
  }

  /**
   * Fetches the script and verifies its hash.
   * @param {*} libPath Path to the library.
   * @param {*} expectedHash Expected hash of the library.
   * @returns {Promise<*>} The imported library.
   */
  async _fetchAndVerifyScript(libPath, expectedHash) {
    const res = await fetch(libPath);
    const scriptText = await res.text();

    const encoder = new TextEncoder();
    const data = encoder.encode(scriptText);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);

    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");

    if (hashHex !== expectedHash) {
      throw new Error("Script hash verification failed.");
    }

    const blob = new Blob([scriptText], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    const lib = await import(blobUrl);
    return lib;
  }

  /**
   * Gets the best device for client computation.
   * @returns {Promise<string>} The best available device.
   */
  async _getBestDevice() {
    if (navigator.gpu) return "webgpu";
    if (navigator.webgl) return "webgl";
    return "wasm";
  }

  async _runInferenceClient(viewportBlob, clickCoords) {
    try {
      const imageUrl = URL.createObjectURL(viewportBlob);
      const image = await this.RawImage.read(imageUrl);

      const input_points = [[[[clickCoords.x, clickCoords.y]]]];
      const processor = this._processors[this._selectedModel];
      const model = this._models[this._selectedModel];

      const inputs = await processor(image, { input_points });
      const outputs = await model(inputs);

      const masks = await processor.post_process_masks(
        outputs.pred_masks,
        inputs.original_sizes,
        inputs.reshaped_input_sizes
      );

      return await this._processSegmentationMask(masks, outputs.iou_scores);
    } catch (error) {
      console.error("Client inference error:", error);
      return null;
    }
  }

  async _runInferenceServer(viewportBlob, clickCoords) {
    const reader = new FileReader();
    reader.readAsDataURL(viewportBlob);

    return new Promise((resolve, reject) => {
      reader.onload = async () => {
        const base64String = reader.result.split(",")[1];
        const serverModelName = this.ALLOWED_MODELS[this._selectedModel];
        const requestBody = {
          image: base64String,
          x: clickCoords.x,
          y: clickCoords.y,
          model: serverModelName
        };

        try {
          const serverInfo = this.GPU_SERVERS[this._selectedComputationDevice];
          const url = `${serverInfo.path}/segment`;

          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
          });

          if (!response.ok) {
            console.error("Server error:", response.statusText);
            return reject(new Error("Server error"));
          }

          const data = await response.json();
          const binaryStr = atob(data.binary_mask);
          const binaryMask = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            binaryMask[i] = binaryStr.charCodeAt(i);
          }

          resolve({ binaryMask, width: data.width, height: data.height });
        } catch (error) {
          console.error("Server inference error:", error);
          reject(error);
        }
      };
    });
  }

  /**
   * Processes the segmentation masks.
   * @param {*} masks Candidate masks.
   * @param {*} scores IoU scores of the masks.
   * @returns {Promise<{ binaryMask: Uint8Array, width: number, height: number }>} The processed mask.
   */
  async _processSegmentationMask(masks, scores) {
    const resizedImage = this.RawImage.fromTensor(masks[0][0].mul(255));
    const image = resizedImage;
    const scores_array = scores.data;
    const max_iou_score = scores_array.indexOf(Math.max(...scores_array));
    const best_channel_image = image.split()[max_iou_score];

    const binaryMask = new Uint8Array(best_channel_image.data.length);
    for (let i = 0; i < best_channel_image.data.length; i++) {
      binaryMask[i] = best_channel_image.data[i] > 128 ? 1 : 0;
    }

    return {
      binaryMask,
      width: best_channel_image.width,
      height: best_channel_image.height
    };
  }

  /**
   * Converts a binary mask to a polygon.
   * @param {Uint8Array} binaryMask - The binary mask.
   * @param {number} width - The width of the mask.
   * @param {number} height - The height of the mask.
   * @returns {Array<{ x: number, y: number }>} The polygon points.
   */
  maskToPolygon(binaryMask, width, height, ref) {
    const totalPixels = binaryMask.length;
    const filledPixels = binaryMask.reduce((sum, val) => sum + val, 0);
    const filledRatio = filledPixels / totalPixels;

    // Warn if nothing is segmented
    if (filledPixels === 0) {
      VIEWER.raiseEvent("warn-user", {
        originType: "module",
        originId: "sam-segmentation-experimental",
        code: "W_SAM_NO_SEGMENTATION",
        message: "Empty segmenation mask received."
      });
      return null;
    }

    // Warn if segmentation covers more than 90%
    if (filledRatio > 0.9) {
      VIEWER.raiseEvent("warn-user", {
        originType: "module",
        originId: "sam-segmentation-experimental",
        code: "W_SAM_OVER_SEGMENTATION",
        message:
          "Segmentation mask covers more than 90% of the image, it is considered invalid."
      });
      return null;
    }
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

  /**
   * Captures the viewport image at the specified point.
   * @returns {Promise<{ blob: Blob}>} The captured image.
   */
  async captureViewportImage() {
    return new Promise(resolve => {
      const drawer = new OpenSeadragon.Drawer({
        viewer: VIEWER,
        viewport: VIEWER.viewport,
        element: VIEWER.canvas,
        debugGridColor: VIEWER.debugGridColor
      });
      drawer.canvas.style.setProperty("z-index", "-999");
      drawer.canvas.style.setProperty("visibility", "hidden");
      drawer.canvas.style.setProperty("display", "none");
      drawer.clear();

      const targetImage = VIEWER.world.getItemAt(0);
      const oldDrawer = targetImage._drawer;
      targetImage._drawer = drawer;
      targetImage.draw();
      targetImage._drawer = oldDrawer;

      const viewerWidth = VIEWER.container.clientWidth;
      const viewerHeight = VIEWER.container.clientHeight;

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
};
