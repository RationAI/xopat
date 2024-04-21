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
            USER_INTERFACE.AdvancedMenu.setMenu(this.id, "youtrack-feedback", "Feedback Form", `
<div id="youtrack-rationai-feedback"></div>`, 'feedback');
            YTFeedbackForm.renderInline(document.getElementById("youtrack-rationai-feedback"), {
                backendURL: this.url,
                formUUID: this.getStaticMeta("formUUID"),
                //theme: APPLICATION_CONTEXT.getOption('theme'),
                language: APPLICATION_CONTEXT.getOption('locale')
            });
            USER_INTERFACE.addHtml(`<span class="position-absolute bottom-5 left-3 py-2 pr-2 d-flex box-shadow btn-pointer" 
style="background: var(--color-bg-primary); border-radius: 5px;" onclick="USER_INTERFACE.AdvancedMenu.openMenu('${this.id}')"><span class="material-icons">feedback</span>Feedback</span>`, this.id);
        } else {
            USER_INTERFACE.AdvancedMenu.setMenu(this.id, "youtrack-feedback", "Feedback Form", `
<h2>Feedback Form</h2>
The feedback form does not work for domains that are not configured in the YouTrack.
An authorized person needs to enable the form for this domain.
`, 'feedback');
        }
    }
});
