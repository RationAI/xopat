(async function() {
  const {
    AutoProcessor,
    SamModel,
    RawImage
  } = await import("//cdn.jsdelivr.net/npm/@huggingface/transformers");

  class SAMInference {
    constructor() {
      this.model = null;
      this.processor = null;
      this.modelLoaded = false;
    }

    /**
     * Determine the best device to use for inference.
     * @returns {Promise<string>} The best device to use for inference.
     */
    async getBestDevice() {
      if (navigator.gpu) {
        return "webgpu";
      } else if (navigator.webgl) {
        return "webgl";
      } else {
        return "wasm";
      }
    }

    /**
     * Load the SAM model for inference.
     * @param {*} model The model to load.
     */
    async loadModel(model = "Xenova/slimsam-77-uniform") {
      const device = await this.getBestDevice();
      globalThis.TRANSFORMERS_BACKEND = device;
      console.log("Best device:", device);

      this.processor = await AutoProcessor.from_pretrained(model);
      this.model = await SamModel.from_pretrained(model);
      this.modelLoaded = true;
      console.log("Model loaded: ", model);
    }

    /**
     * Run inference on the viewport image.
     * @param {*} viewportBlob 
     * @param {*} clickCoords 
     * @returns {Promise<{binaryMask: Uint8Array, width: number, height: number}>} The segmentation mask.
     */
    async runInference(viewportBlob, clickCoords) {
      if (!this.modelLoaded) {
        console.error("SAM model is not loaded.");
        return null;
      }
      if (!viewportBlob) {
        console.error("Invalid viewportBlob passed to inference.");
        return null;
      }

      // log which model is being used
      console.log("Using model for inference: ", this.model);

      try {
        // convert the blob to a RawImage
        const imageUrl = URL.createObjectURL(viewportBlob);
        const image = await RawImage.read(imageUrl);

        const input_points = [[[[clickCoords.x, clickCoords.y]]]];

        // run segmentation
        const inputs = await this.processor(image, { input_points });
        console.log("Inputs processed:", inputs);

        const outputs = await this.model(inputs);
        console.log("Model outputs:", outputs);

        const masks = await this.processor.post_process_masks(
          outputs.pred_masks,
          inputs.original_sizes,
          inputs.reshaped_input_sizes
        );

        // post-process the segmentation mask
        const {
          binaryMask,
          width: maskWidth,
          height: maskHeight
        } = await this._processSegmentationMask(masks, outputs.iou_scores);

        return {
          binaryMask,
          width: maskWidth,
          height: maskHeight
        };
      } catch (error) {
        console.error("SAM inference error:", error);
        return null;
      }
    }

    /**
    * Post-process the segmentation mask.
     * @param {*} masks 
     * @param {*} scores 
     * @returns {Promise<{binaryMask: Uint8Array, width: number, height: number}>} The segmentation mask.
     */
    async _processSegmentationMask(masks, scores) {
      const resizedImage = RawImage.fromTensor(masks[0][0].mul(255));
      const image = resizedImage;

      // max IoU score channel
      const scores_array = scores.data;
      const max_iou_score = scores_array.indexOf(Math.max(...scores_array));
      const best_channel_image = image.split()[max_iou_score];

      // create binary mask
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
