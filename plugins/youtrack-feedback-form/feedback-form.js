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

    async pluginReady() {
      await this.loadLocale();
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
          this.t("menu.title"),
          `
<div id="youtrack-rationai-feedback"></div>`,
          "ph-megaphone"
        );
        const container = document.getElementById("youtrack-rationai-feedback");
        if (!container) {
          console.warn(this.id, ": feedback menu body not mounted, form not rendered.");
          return;
        }
        YTFeedbackForm.renderInline(container, {
          backendURL: this.url,
          formUUID: this.formUUID,
          //theme: APPLICATION_CONTEXT.getOption('theme'),
          language: APPLICATION_CONTEXT.getOption("locale"),
        });

        // The menu is reachable from the Plugins fullscreen namespace already
        // (setMenu registers it). Expose it additionally as a pinnable quick
        // action instead of rewriting core app-bar DOM: the old code replaced
        // the v2 `#add-plugins` button, an element the v3 app bar no longer
        // renders, so it threw and aborted the rest of this method.
        USER_INTERFACE.AppBar?.Actions?.register(`${this.id}.open`, {
          label: this.t("menu.title"),
          icon: "ph-megaphone",
          invoke: () => UI.Services.FullscreenMenus.openSubmenu(this.id, "youtrack-feedback"),
        });

        this.modifyForm();

        if (this.observer) {
          this.observer.disconnect();
        }

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
        const unavailable = document.createElement("div");
        const heading = document.createElement("h2");
        heading.textContent = this.t("menu.title");
        const text = document.createElement("p");
        text.textContent = this.t("menu.unavailable");
        unavailable.appendChild(heading);
        unavailable.appendChild(text);

        UI.Services.FullscreenMenus.setMenu(
          this.id,
          "youtrack-feedback",
          this.t("menu.title"),
          unavailable,
          "ph-megaphone"
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
        if (!container) return;

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
        ?.querySelector("form");
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
        labelText.textContent = this.t("form.attachLogs");

        label.appendChild(checkbox);
        label.appendChild(labelText);

        submitButton.parentNode.insertBefore(label, submitButton);
      } else {
        console.warn("Feedback form submit button not found");
      }
    }
  }
);
