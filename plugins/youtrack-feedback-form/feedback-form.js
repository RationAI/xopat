addPlugin('youtrack-feedback', class extends XOpatPlugin {
    constructor(id) {
        super(id);
        this.url = this.getStaticMeta("youtrackURL");
    }

    pluginReady() {
        try {
            attachScript(this.id, {
                src: this.url + (this.url.endsWith('/') ? "" : "/") + "static/simplified/form/form-entry.js?auto=false"
            }, () => {
                this.loadForm();
            });
        } catch (e) {
            console.warn(this.id, ": failed to load youtrack form script!");
            this.loadForm();
        }
    }

    loadForm() {
        if (window.YTFeedbackForm) {
            USER_INTERFACE.TopPluginsMenu.setMenu(this.id, "youtrack-feedback", "Feedback Form", `
<div id="youtrack-rationai-feedback"></div>`, 'feedback');
            YTFeedbackForm.renderInline(document.getElementById("youtrack-rationai-feedback"), {
                backendURL: this.url,
                formUUID: this.getStaticMeta("formUUID"),
                //theme: APPLICATION_CONTEXT.getOption('theme'),
                language: APPLICATION_CONTEXT.getOption('locale')
            });
            // hide 'Plugins' title
            const pluginsButton = document.getElementById("add-plugins");
            pluginsButton.children[1].style.display = 'none';

            //todo a bit hacky, we should ensure each plugin does not damage dom by this procedure, e.g. it is reversible, we use ${pluginId}-plugin-root which gets trimmed
            const formNode = $(`<span id="add-plugins" class="btn-pointer py-2 pr-1 ${this.id}-plugin-root" onclick="USER_INTERFACE.TopPluginsMenu.openMenu('${this.id}');" data-i18n="[title]main.bar.explainPlugins">
                <span class="material-icons pr-0" style="font-size: 22px;">feedback</span>
                <span class="pl-1">Feedback</span>
            </span>`);

            pluginsButton.parentNode.insertBefore(formNode[0], pluginsButton);

            const nextPos = pluginsButton.nextSibling.nextSibling;
            pluginsButton.parentNode.insertBefore(nextPos, pluginsButton);

        } else {
            USER_INTERFACE.TopPluginsMenu.setMenu(this.id, "youtrack-feedback", "Feedback Form", `
<h2>Feedback Form</h2>
The feedback form does not work for domains that are not configured in the YouTrack.
An authorized person needs to enable the form for this domain.
`, 'feedback');
        }
    }
});
