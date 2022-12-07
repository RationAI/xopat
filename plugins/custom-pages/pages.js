addPlugin("custom-pages", class {
    constructor(id, params) {
        this.id = id;
        this.data = params.data;
        if (!Array.isArray(this.data)) this.data = [];
        this.builder = new AdvancedMenuPages(this.id);
    }

    pluginReady() {
        if (Array.isArray(this.data[0])) {
            for (let x of this.data) this.builder.buildMetaDataMenu(x);
        } else {
            this.builder.buildMetaDataMenu(this.data);
        }
    }
});
