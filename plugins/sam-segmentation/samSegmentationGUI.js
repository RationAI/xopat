class SAMSegmentationPlugin extends XOpatPlugin {
  constructor(id) {
    super(id);
    this.registerAsEventSource();
  }

  async pluginReady() {
    this.context = OSDAnnotations.instance();
    if (!this.context) {
      console.error("OSDAnnotations instance not found.");
      return;
    }

    this.raiseSetUpEvents();

    this.context.addHandler("annotations-gui-ready", () => {
      this.raiseSetUpEvents();
    });

    this.context.addHandler("segmentation-start", () => {
      this.changeCursor("wait");
    });

    this.context.addHandler("segmentation-end", () => {
      this.changeCursor("grab");
    });
  }

  /**
   * Change the cursor type.
   * @param {*} cursorType 
   */
  changeCursor(cursorType) {
    const upperCanvas = document.querySelector(".upper-canvas");
    if (upperCanvas) {
      upperCanvas.style.cursor = cursorType;
    } else {
      console.warn(`.upper-canvas element not found, cursor change failed.`);
    }
  }

  /**
   * Raise the setup events for the plugin, registering custom mode and tool controls.
   */
  raiseSetUpEvents() {
    this.raiseRegisterCustomModeEvent();
    this.raiseRegisterToolControlsEvent();
  }

  raiseRegisterCustomModeEvent() {
    this.context.raiseEvent("register-custom-mode", {
      id: "SAM_SEGMENTATION",
      classObj: OSDAnnotations.SegmentAnythingState
    });
  }

  raiseRegisterToolControlsEvent() {
    this.context.raiseEvent("register-tool-controls", {
      mode: this.context.Modes.SAM_SEGMENTATION
    });
  }
}

// initialize the plugin
addPlugin("sam-segmentation", SAMSegmentationPlugin);
