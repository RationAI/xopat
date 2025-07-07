/**
 * This plugin integrates the Segment Anything Model (SAM) into the Annotations plugin.
 * @class SAMSegmentationPlugin
 * @extends XOpatPlugin
 * @param {string} id The ID of the plugin.
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
   * @async
   */
  async pluginReady() {
    this.context = OSDAnnotations.instance();
    this.sam = window.SAMInference.instance();
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

    this._blockerHandler = e => {
      e.stopImmediatePropagation();
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    this.sam.addHandler("models-loaded", () => {
      $("#sam-loading-info").remove();
      this._registerToolControls(this.context.Modes.SAM_SEGMENTATION);
      this._setUpModelDropdown();
      this._setUpComputationDropdown();
    });

    this.sam.addHandler("segmentation-finished", () => {
      console.log("Segmentation finished");
      setTimeout(() => {
        this._deactivateGlobalEventBlocker();
        USER_INTERFACE.Loading.show(false);
      }, 50);
    });

    this.sam.addHandler("segmentation-started", () => {
      this._activateGlobalEventBlocker();
      USER_INTERFACE.Loading.show(true);
      USER_INTERFACE.Loading.text("Waiting for segmentation...");
    });
  }

  /**
   * Waits until a DOM element is present.
   * @param {string} selector The CSS selector of the element to wait for.
   * @param {number} timeout The maximum time to wait in milliseconds.
   * @returns {Promise<void>}
   * @throws {Error} If the element is not found within the timeout.
   * @private
   * @async
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
   * @returns {Promise<void>}
   * @private
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
   * @private
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
   * @private
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
   * Block mouse movements globally and consume them fully.
   */
  _activateGlobalEventBlocker() {
    this._blockerHandler = e => {
      e.stopImmediatePropagation();
      e.preventDefault();
      e.stopPropagation();
      return false;
    };
    window.addEventListener("mousemove", this._blockerHandler, {
      capture: true,
      passive: false
    });
  }

  /**
   * Remove the global event blocker.
   */
  _deactivateGlobalEventBlocker() {
    if (!this._blockerHandler) return;
    window.removeEventListener("mousemove", this._blockerHandler, {
      capture: true,
      passive: false
    });
    this._blockerHandler = null;
  }
}

// Instantiate the plugin
addPlugin("sam-segment-tool-experimental", SAMSegmentationPlugin);
