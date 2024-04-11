addPlugin('youtrack-feedback', class extends XOpatPlugin {
    constructor(id, params) {
        super(id);
        this.url = this.getStaticMeta("youtrackURL");
    }

    pluginReady() {
        attachScript(this.url + (this.url.endsWith('/') ? "" : "/") + "static/simplified/form/form-entry.js?auto=false");


        if (window.YTFeedbackForm) {
            USER_INTERFACE.AdvancedMenu.setMenu(this.id, "youtrack-feedback", "Feedback Form", `
<div id="youtrack-rationai-feedback"></div>`, 'feedback');
            YTFeedbackForm.renderInline(document.getElementById("youtrack-rationai-feedback"), {
                backendURL: this.url,
                formUUID: this.getStaticMeta("formUUID"),
                //theme: APPLICATION_CONTEXT.getOption('theme'),
                language: APPLICATION_CONTEXT.getOption('locale')
            });

        } else {
            USER_INTERFACE.AdvancedMenu.setMenu(this.id, "youtrack-feedback", "Feedback Form", `
<h2>Feedback Form</h2>
The feedback form does not work for domains that are not owned by the development team. This is a CORS policy issue.
This plugin is not meant to be used publicly.
`, 'feedback');
        }
    }
});
