class SAMSegmentationPlugin extends XOpatPlugin {
  constructor(id) {
    super(id);
    this.registerAsEventSource();
    this._serverAvailable = false;
    this._serverUsed = false;
    this._serverGPUName = null;
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

    // add handler for server availability
    this.context.addHandler("server-available", event => {
      this._serverAvailable = true;
      this._serverGPUName = event.gpuName;

      // call UI set up
      this.setUpServerUI();
      console.log("Server available with GPU:", this._serverGPUName);
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
   * Set up the server UI in the toolbar.
   */
  setUpServerUI() {
    const serverUI = document.createElement("div");
    serverUI.id = "server-ui";
    serverUI.style.display = "inline-flex";
    serverUI.style.alignItems = "center";
    serverUI.style.marginLeft = "8px";

    // create toggle switch container
    const toggleContainer = document.createElement("div");
    toggleContainer.style.display = "inline-flex";
    toggleContainer.style.alignItems = "center";
    toggleContainer.style.marginRight = "8px";

    // create toggle switch
    const toggleSwitch = document.createElement("label");
    toggleSwitch.className = "switch";
    toggleSwitch.style.margin = "0 4px";

    const toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.addEventListener("change", () => {
      if (this._serverAvailable) {
        this.context.raiseEvent("change-computation-side");
        this._serverUsed = !this._serverUsed;
        const computationSide = this._serverUsed ? "server" : "client";
        console.log("Computation side switched to:", computationSide);
        // Update labels
        clientLabel.style.fontWeight = this._serverUsed ? "normal" : "bold";
        serverLabel.style.fontWeight = this._serverUsed ? "bold" : "normal";
      } else {
        console.warn("Server is not available.");
        toggleInput.checked = false;
      }
    });

    const toggleSlider = document.createElement("span");
    toggleSlider.className = "slider round";

    toggleSwitch.appendChild(toggleInput);
    toggleSwitch.appendChild(toggleSlider);

    // create labels for client/server
    const clientLabel = document.createElement("span");
    clientLabel.innerText = "Client";
    clientLabel.style.fontWeight = "bold";
    clientLabel.style.marginRight = "4px";
    clientLabel.style.cursor = "pointer";
    clientLabel.addEventListener("click", () => {
      if (this._serverUsed && this._serverAvailable) {
        toggleInput.checked = false;
        toggleInput.dispatchEvent(new Event("change"));
      }
    });

    const serverLabel = document.createElement("span");
    serverLabel.innerText = "Server";
    serverLabel.style.marginLeft = "4px";
    serverLabel.style.cursor = "pointer";
    serverLabel.addEventListener("click", () => {
      if (!this._serverUsed && this._serverAvailable) {
        toggleInput.checked = true;
        toggleInput.dispatchEvent(new Event("change"));
      }
    });

    toggleContainer.appendChild(clientLabel);
    toggleContainer.appendChild(toggleSwitch);
    toggleContainer.appendChild(serverLabel);
    serverUI.appendChild(toggleContainer);

    // create GPU name display
    const gpuNameDisplay = document.createElement("div");
    gpuNameDisplay.innerText = `GPU: ${this._serverGPUName}`;
    gpuNameDisplay.style.fontSize = "smaller";
    gpuNameDisplay.style.opacity = "0.8";
    gpuNameDisplay.style.marginLeft = "8px";
    serverUI.appendChild(gpuNameDisplay);

    const toolBarContent = document.querySelector(
      "#annotations-tool-bar-content"
    );
    if (toolBarContent) {
      const segButton = document.querySelector(
        "label[for='viewport-segmentation-annotation-mode']"
      );
      if (segButton) {
        segButton.parentNode.insertBefore(serverUI, segButton.nextSibling);
        const separator = document.createElement("span");
        separator.style.width = "1px";
        separator.style.height = "28px";
        separator.style.background = "var(--color-text-tertiary)";
        separator.style.verticalAlign = "middle";
        separator.style.opacity = "0.3";
        separator.style.display = "inline-block";
        separator.style.marginLeft = "8px";
        separator.style.marginRight = "8px";
        segButton.parentNode.insertBefore(separator, serverUI);
      } else {
        const customItems = document.querySelector("#mode-custom-items");
        if (customItems) {
          customItems.parentNode.insertBefore(serverUI, customItems);
        } else {
          toolBarContent.appendChild(serverUI);
        }
      }
    } else {
      console.warn(
        "#annotations-tool-bar-content element not found, UI setup failed."
      );
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
