class SAMSegmentationPlugin extends XOpatPlugin {
  constructor(id) {
    super(id);
    this.registerAsEventSource();
    this._serverAvailable = false;
    this._serverGPUName = null;
  }

  /**
   * Plugin initialization function.
   * @returns {Promise<void>}
   */
  async pluginReady() {
    this.context = OSDAnnotations.instance();
    if (!this.context) {
      console.error("OSDAnnotations instance not found.");
      return;
    }

    // Display model choice when loaded
    this.context.addHandler("models-loaded", () => {
      this.setUpModelDropdown();
    });

    // Display GPU server choice when available
    this.context.addHandler("server-available", event => {
      this._serverAvailable = true;
      this._serverGPUName = event.gpuName;
      this.setUpComputationDropdown();
      console.log("Server available with GPU:", this._serverGPUName);
    });

    this.context.addHandler("segmentation-start", () =>
      this.changeCursor("wait")
    );
    this.context.addHandler("segmentation-end", () =>
      this.changeCursor("grab")
    );
    this.context.addHandler("annotations-gui-ready", () =>
      this.raiseSetUpEvents()
    );
  }

  /**
   * Change the cursor type for waiting or grabbing.
   * @param {*} cursorType - The type of cursor to set.
   */
  changeCursor(cursorType) {
    const upperCanvas = document.querySelector(".upper-canvas");
    if (upperCanvas) {
      upperCanvas.style.cursor = cursorType;
    } else {
      console.warn(".upper-canvas element not found, cursor change failed.");
    }
  }

  /**
   * Set up the model dropdown menu.
   * @returns {Promise<void>}
   */
  setUpModelDropdown() {
    $("#sam-model-dropdown").remove();

    const models = Object.keys(window.ALLOWED_MODELS || {});
    if (!models.length) {
      console.warn("No models found in ALLOWED_MODELS.");
      return;
    }

    const dropdownOptions = models
      .map(model => `<option value="${model}">${model.split("/")[1]}</option>`)
      .join("");

    const dropdownHTML = `
      <select id="sam-model-dropdown" class="form-select d-inline-block w-auto mx-1"
        onchange="OSDAnnotations.instance().raiseEvent('change-selected-model', { model: this.value })">
        ${dropdownOptions}
      </select>`;

    $("#annotations-tool-bar-content").append(dropdownHTML);
  }

  /**
   * Set up the computation dropdown menu.
   * @returns {Promise<void>}
   */
  setUpComputationDropdown() {
    $("#sam-computation-dropdown").remove();

    const availableDevices = ["Client"];
    for (const [gpu, info] of Object.entries(window.GPU_SERVERS || {})) {
      if (info.available) {
        availableDevices.push(gpu);
      }
    }

    if (availableDevices.length < 2) {
      console.warn(
        "No additional GPU servers available for computation dropdown."
      );
      return;
    }

    const dropdownOptions = availableDevices
      .map(device => `<option value="${device}">${device}</option>`)
      .join("");

    const dropdownHTML = `
      <select id="sam-computation-dropdown" class="form-select d-inline-block w-auto mx-1"
        onchange="OSDAnnotations.instance().raiseEvent('change-selected-computation-device', { device: this.value })">
        ${dropdownOptions}
      </select>`;

    $("#annotations-tool-bar-content").append(dropdownHTML);
  }

  /**
   * Raises setup events for the plugin.
   */
  raiseSetUpEvents() {
    this.raiseRegisterCustomModeEvent();
    this.raiseRegisterToolControlsEvent();
  }

  /**
   * Raises a custom mode registration event for the annotations plugin.
   */
  raiseRegisterCustomModeEvent() {
    this.context.raiseEvent("register-custom-mode", {
      id: "SAM_SEGMENTATION",
      classObj: OSDAnnotations.SegmentAnythingState
    });
  }

  /**
   * Raises a tool controls registration event for the annotations plugin.
   */
  raiseRegisterToolControlsEvent() {
    this.context.raiseEvent("register-tool-controls", {
      mode: this.context.Modes.SAM_SEGMENTATION
    });
  }
}

// Instantiate the plugin
addPlugin("sam-segmentation", SAMSegmentationPlugin);
