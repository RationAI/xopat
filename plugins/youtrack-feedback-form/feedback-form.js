addPlugin(
  "youtrack-feedback",
  class extends XOpatPlugin {
    constructor(id) {
      super(id);
      this.url = this.getStaticMeta("youtrackURL");
      this.formUUID = this.getStaticMeta("formUUID");
      // Optional SRI hash for the YouTrack form bundle (AGENTS.md §7: no
      // third-party script without integrity or a hard allowlist). Left unset
      // by deployments that track upstream's rolling bundle; when set, a
      // tampered bundle is refused by the browser.
      this.scriptIntegrity = this.getStaticMeta("youtrackScriptIntegrity");
      // The app trace can carry slide ids, user actions and error payloads, and
      // it leaves the deployment inside a third-party ticket. Attaching it is
      // therefore opt-IN: the user ticks the box when the log is relevant.
      this.includeTrace = false;

      this.observer = null;
    }

    pluginReady() {
      try {
        // Only https: the bundle executes with full page privileges, so a
        // plaintext origin is an injection point on any hostile network.
        if (!/^https:\/\//i.test(this.url || "")) {
          console.warn(this.id, ": youtrackURL must be an https:// origin; refusing to load the form script.");
          this.loadForm();
          return;
        }
        const props = {
          src:
            this.url +
            (this.url.endsWith("/") ? "" : "/") +
            "static/simplified/form/form-entry.js?auto=false",
          crossOrigin: "anonymous",
        };
        if (this.scriptIntegrity) props.integrity = this.scriptIntegrity;
        attachScript(this.id, props, () => {
          this.loadForm();
        });
      } catch (e) {
        console.warn(this.id, ": failed to load youtrack form script!");
        this.loadForm();
      }
    }

    loadForm() {
      if (window.YTFeedbackForm) {
        UI.Services.FullscreenMenus.setMenu(
          this.id,
          "youtrack-feedback",
          "Feedback Form",
          `
<div id="youtrack-rationai-feedback"></div>`,
          "feedback"
        );
        YTFeedbackForm.renderInline(
          document.getElementById("youtrack-rationai-feedback"),
          {
            backendURL: this.url,
            formUUID: this.formUUID,
            //theme: APPLICATION_CONTEXT.getOption('theme'),
            language: APPLICATION_CONTEXT.getOption("locale"),
          }
        );
        // hide 'Plugins' title
        const pluginsButton = document.getElementById("add-plugins");
        pluginsButton.children[1].style.display = "none";

        //todo a bit hacky, we should ensure each plugin does not damage dom by this procedure, e.g. it is reversible, we use ${pluginId}-plugin-root which gets trimmed
        const formNode =
          $(`<span id="add-plugins" class="btn-pointer py-2 pr-1 ${this.id}-plugin-root" onclick="UI.Services.FullscreenMenus.openMenu('${this.id}');" data-i18n="[title]main.bar.explainPlugins">
                <span class="material-icons pr-0" style="font-size: 22px;">feedback</span>
                <span class="pl-1">Feedback</span>
            </span>`);

        pluginsButton.parentNode.insertBefore(formNode[0], pluginsButton);

        const nextPos = pluginsButton.nextSibling.nextSibling;
        pluginsButton.parentNode.insertBefore(nextPos, pluginsButton);
        this.modifyForm();

        if (this.observer) {
          this.observer.disconnect();
        }

        const container = document.getElementById("youtrack-rationai-feedback");
        this.observer = new MutationObserver((mutationsList, observer) => {
          for (const mutation of mutationsList) {
            if (mutation.type === "childList" || mutation.type === "subtree") {
              const newForm = container.querySelector("form");
              if (newForm && !newForm.dataset.modified) {
                this.modifyForm();
                break;
              }
            }
          }
        });
        this.observer.observe(container, { childList: true, subtree: true });
      } else {
        UI.Services.FullscreenMenus.setMenu(
          this.id,
          "youtrack-feedback",
          "Feedback Form",
          `
<h2>Feedback Form</h2>
The feedback form does not work for domains that are not configured in the YouTrack.
An authorized person needs to enable the form for this domain.
`,
          "feedback"
        );
      }
    }

    findDescriptionTextarea(originElement) {
      // YouTrack's form.getBlockValue doesn't work, so we need to find the textarea manually
      const labels = originElement.querySelectorAll("label");

      for (const label of labels) {
        const span = label.querySelector("span span");
        if (span && span.textContent.trim() === "Description") {
          return label.nextElementSibling.firstElementChild.value;
        }
      }

      return null;
    }

    modifyForm() {
      YTFeedbackForm.getClientJSApi(this.formUUID).then((form) => {
        const container = document.getElementById("youtrack-rationai-feedback");

        if (container.dataset.modified) {
          console.warn(
            "Feedback form already modified: stopped in this.modifyForm"
          );
          return;
        }

        const theForm = container.querySelector("form");
        if (!theForm) {
          console.warn("Feedback form element not found");
          return;
        }

        this.injectHTMLOptions();

        theForm.addEventListener(
          "submit",
          (e) => {
            if (!this.includeTrace) return;
            const description = this.findDescriptionTextarea(e.target);
            const trace =
              "\n\n\n### Attached app logs:\n```\n" +
              (window.console?.appTrace || ["No app trace found!"]).join("\n") +
              "\n```\n";
            form.setBlockValue("description", description + trace);
          },
          true
        );
      });
    }

    injectHTMLOptions() {
      const form = document
        .getElementById("youtrack-rationai-feedback")
        .querySelector("form");
      if (!form) {
        console.warn("Feedback form element not found");
        return;
      }
      if (form.dataset.modified) {
        console.warn(
          "Feedback form already modified: stopped in this.injectHTMLOptions"
        );
        return;
      }
      form.dataset.modified = true;
      const submitButton = form.querySelector("button[type='submit']");
      if (submitButton) {
        const label = document.createElement("label");
        label.style.display = "flex";
        label.style.alignItems = "center";
        label.style.marginBottom = "8px";
        label.htmlFor = "youtrack-rationai-feedback-attach-logs";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = "youtrack-rationai-feedback-attach-logs";
        checkbox.name = "attach-logs";
        checkbox.checked = this.includeTrace;
        checkbox.style.marginRight = "10px";
        checkbox.addEventListener("change", (e) => {
          this.includeTrace = !!e.target.checked;
        });

        const labelText = document.createElement("span");
        labelText.textContent = "Attach app logs to the feedback form";

        label.appendChild(checkbox);
        label.appendChild(labelText);

        submitButton.parentNode.insertBefore(label, submitButton);
      } else {
        console.warn("Feedback form submit button not found");
      }
    }
  }
);
