/**
 * This plugin integrates the Segment Anything Model (SAM) into the Annotations plugin.
 */
class SAMSegmentationPlugin extends XOpatPlugin {
  constructor(id) {
    super(id);
    this.registerAsEventSource();
    this._serverAvailable = false;
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
    this.integrateWithPlugin("gui_annotations", annotationsPlugin => {
      this.annotationsPlugin = annotationsPlugin;
      this.context.setCustomModeUsed(
        "SAM_SEGMENTATION",
        OSDAnnotations.SegmentAnythingState
      );
      this._waitForElement("#annotations-tool-bar-content")
        .then(() => {
          $("#annotations-tool-bar-content").append(`
      <div id="sam-loading-info" class="d-inline-block mx-1">
        <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        <span> Loading segmentation models...</span>
      </div>
    `);
        })
        .catch(error => {
          console.error(error);
        });
    });
    if (!this.annotationsPlugin) {
      VIEWER.raiseEvent("warn-user", {
        originType: "plugin",
        originId: "sam-segment-tool-experimental",
        code: "NO_ANNOTATIONS_PLUGIN",
        message:
          "The Annotations plugin is not loaded. Please load it to use Segment Anything."
      });
    }

    this.context.addHandler("models-loaded", () => {
      $("#sam-loading-info").remove();
      this._registerToolControls(this.context.Modes.SAM_SEGMENTATION);
      this._setUpModelDropdown();
      this._setUpComputationDropdown();
    });

    this.context.addHandler("segmentation-finished", () => {
      console.log("Segmentation finished");
      this.hideSegmentationOverlay();
      this.annotationsPlugin.switchModeActive("auto");
    });

    this.context.addHandler("segmentation-started", () => {
      this.showSegmentationOverlay();
    });
  }

  /**
   * Waits until a DOM element is present.
   */
  async _waitForElement(selector, timeout = 3000) {
    const interval = 50;
    const maxAttempts = timeout / interval;
    let attempts = 0;

    return new Promise((resolve, reject) => {
      const check = () => {
        if ($(selector).length > 0) {
          resolve();
        } else if (++attempts >= maxAttempts) {
          reject(new Error(`Element "${selector}" not found in time.`));
        } else {
          setTimeout(check, interval);
        }
      };
      check();
    });
  }

  /**
   * Registers the tool controls for the segmentation mode.
   * @param {*} mode The segmentation mode.
   */
  _registerToolControls(mode) {
    const modeId = mode.getId();
    const controlId = `${modeId}-annotation-mode`;
    const labelId = `${modeId}-annotation-label`;
    $(`#${controlId}, #${labelId}`).remove();

    const selected = mode.default() ? "checked" : "";
    const controlHTML = `
    <input type="radio" id="${controlId}" class="d-none switch" ${selected} name="annotation-modes-selector">
    <label id="${labelId}" for="${controlId}" class="label-annotation-mode position-relative" title="${mode.getDescription()}">
      <span class="material-icons btn-pointer p-1 rounded-2">${mode.getIcon()}</span>
    </label>
  `;

    $("#annotations-tool-bar-content").append(controlHTML);
    $(`#${labelId}`).on("click contextmenu", event => {
      event.preventDefault();
      if (
        this.annotationsPlugin &&
        typeof this.annotationsPlugin.switchModeActive === "function"
      ) {
        this.annotationsPlugin.switchModeActive(modeId);
      } else {
        console.warn(
          "Annotations plugin is not available or does not support switchModeActive."
        );
      }
    });
  }

  /**
   * Set up the model dropdown menu.
   * @returns {Promise<void>}
   */
  _setUpModelDropdown() {
    $("#sam-model-dropdown").remove();

    const models = Object.keys(
      window.SAMInference.instance().ALLOWED_MODELS || {}
    );
    if (!models.length) {
      VIEWER.raiseEvent("warn-user", {
        originType: "plugin",
        originId: "sam-segment-tool-experimental",
        code: "NO_MODELS",
        message:
          "No models available for segmentation, add models to your configuration."
      });
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
  _setUpComputationDropdown() {
    $("#sam-computation-dropdown").remove();
    const availableDevices = ["Client"];
    for (const [gpu, info] of Object.entries(
      window.SAMInference.instance().GPU_SERVERS || {}
    )) {
      if (info.available) {
        availableDevices.push(gpu);
      }
    }

    if (availableDevices.length < 2) {
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
   * Displays a loading overlay during segmentation.
   */
  showSegmentationOverlay() {
    if ($("#segmentation-overlay").length === 0) {
      $("body").append(`
        <div id="segmentation-overlay" class="segmentation-overlay">
          <div class="segmentation-overlay-content">
            <div class="spinner-border" role="status"></div>
            <div>Waiting for segmentation...</div>
          </div>
        </div>
      `);
    }
    this._blockUserInteraction();
  }

  /**
   * Removes the loading overlay after segmentation is complete.
   */
  hideSegmentationOverlay() {
    $("#segmentation-overlay").remove();
  }

  /**
   * Blocks user interaction with the page during segmentation.
   */
  _blockUserInteraction() {
    this._interactionBlocker = e => {
      e.stopImmediatePropagation();
      e.preventDefault();
    };

    document.removeEventListener("mousemove", this._interactionBlocker, true);
    document.removeEventListener("mousedown", this._interactionBlocker, true);
    document.removeEventListener("mouseup", this._interactionBlocker, true);
    document.removeEventListener("click", this._interactionBlocker, true);
    document.removeEventListener("wheel", this._interactionBlocker, true);
    document.removeEventListener("keydown", this._interactionBlocker, true);
  }
}

// Instantiate the plugin
addPlugin("sam-segment-tool-experimental", SAMSegmentationPlugin);
