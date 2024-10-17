addPlugin("custom-pages", class extends XOpatPlugin {
    constructor(id) {
        super(id);
        this.data = this.getOption('data', []);
        this.builder = new AdvancedMenuPages(this.id);
    }

    async pluginReady() {
        let sanitization = this.getOption('sanitizeConfig', this.getStaticMeta('sanitizeConfig'))
            || APPLICATION_CONTEXT.secure;
        if (Array.isArray(this.data[0])) {
            for (let x of this.data) this.builder.buildMetaDataMenu(x, sanitization);
        } else {
            this.builder.buildMetaDataMenu(this.data, sanitization);
        }
    }
});
