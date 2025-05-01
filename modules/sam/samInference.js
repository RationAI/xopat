(async function() {
  const {
    AutoProcessor,
    SamModel,
    RawImage
  } = await import("//cdn.jsdelivr.net/npm/@huggingface/transformers");

  window.ALLOWED_MODELS = {
    "Xenova/slimsam-77-uniform": "slimsam-77-uniform",
    "Xenova/medsam-vit-base": "medsam-vit-base"
  };

  class SAMInference {
    constructor() {
      this.models = {};
      this.processors = {};
      this.modelLoaded = false;
      this.selectedModel = null;
      this.selectedComputationDevice = "Client";
    }

    /**
     * Get the best available client device for computation.
     * @returns {Promise<string>} - The best device name.
     */
    async _getBestDevice() {
      if (navigator.gpu) return "webgpu";
      if (navigator.webgl) return "webgl";
      return "wasm";
    }

    /**
     * Load all allowed models and processors.
     */
    async loadAllModels() {
      const device = await this._getBestDevice();
      globalThis.TRANSFORMERS_BACKEND = device;
      console.log("Best device:", device);

      for (const hfModelName of Object.keys(window.ALLOWED_MODELS)) {
        this.processors[hfModelName] = await AutoProcessor.from_pretrained(
          hfModelName
        );
        this.models[hfModelName] = await SamModel.from_pretrained(hfModelName, {
          dtype: "q8"
        });
      }

      this.selectedModel = Object.keys(window.ALLOWED_MODELS)[0];
      this.modelLoaded = true;
      console.log("All allowed models loaded.");
    }

    /**
     * Set the selected model for inference.
     * @param {*} modelName - The name of the model to set.
     */
    setModel(modelName) {
      if (this.models[modelName]) {
        this.selectedModel = modelName;
        console.log(`Model switched to: ${modelName}`);
      } else {
        console.error(`Model ${modelName} not loaded.`);
      }
    }

    /**
     * Set the selected GPU for inference.
     * @param {*} gpuName - The name of the GPU to set.
     */
    setComputationDevice(computationDevice) {
      this.selectedComputationDevice = computationDevice;
      console.log(`Computation switched to: ${computationDevice}`);
    }

    /**
     * Run inference on the current selected model and selected computation side.
     * @param {*} viewportBlob - The blob of the viewport image.
     * @param {*} clickCoords - The coordinates of the click event.
     * @returns {Promise<{ binaryMask: Uint8Array, width: number, height: number }>} - The segmentation mask.
     */
    async runInference(viewportBlob, clickCoords) {
      if (!this.modelLoaded) {
        console.error("Models not loaded.");
        return null;
      }
      if (!viewportBlob) {
        console.error("Invalid viewportBlob passed.");
        return null;
      }

      if (this.selectedComputationDevice === "Client") {
        return await this._runInferenceClient(viewportBlob, clickCoords);
      } else {
        return await this._runInferenceServer(viewportBlob, clickCoords);
      }
    }

    /**
     * Run inference using the client-side computation.
     * @param {*} viewportBlob - The blob of the viewport image.
     * @param {*} clickCoords - The coordinates of the click event.
     * @returns {Promise<{ binaryMask: Uint8Array, width: number, height: number }>} - The segmentation mask.
     */
    async _runInferenceClient(viewportBlob, clickCoords) {
      try {
        const imageUrl = URL.createObjectURL(viewportBlob);
        const image = await RawImage.read(imageUrl);

        const input_points = [[[[clickCoords.x, clickCoords.y]]]];
        const processor = this.processors[this.selectedModel];
        const model = this.models[this.selectedModel];

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

    /**
     * Run inference using the server-side computation.
     * @param {*} viewportBlob - The blob of the viewport image.
     * @param {*} clickCoords - The coordinates of the click event.
     * @returns {Promise<{ binaryMask: Uint8Array, width: number, height: number }>} - The segmentation mask.
     */
    async _runInferenceServer(viewportBlob, clickCoords) {
      const reader = new FileReader();
      reader.readAsDataURL(viewportBlob);

      return new Promise((resolve, reject) => {
        reader.onload = async () => {
          const base64String = reader.result.split(",")[1];
          const serverModelName = window.ALLOWED_MODELS[this.selectedModel];
          const requestBody = {
            image: base64String,
            x: clickCoords.x,
            y: clickCoords.y,
            model: serverModelName
          };

          try {
            const serverInfo =
              window.GPU_SERVERS[this.selectedComputationDevice];
            const url = `${serverInfo.domain}${serverInfo.path}/segment`;

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
     * Process the segmentation mask and return the binary mask.
     * @param {*} masks - The segmentation masks.
     * @param {*} scores - The IoU scores of the masks' channels.
     * @returns
     */
    async _processSegmentationMask(masks, scores) {
      const resizedImage = RawImage.fromTensor(masks[0][0].mul(255));
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
  }

  const sam = new SAMInference();
  window.SAMInference = sam;
  window.SAMInferenceReady = Promise.resolve(sam);
})();
