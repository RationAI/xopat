addPlugin("custom-pages", class extends XOpatPlugin {
    constructor(id) {
        super(id);
        this.pages = this.getOption('data', []);
        this.builder = new AdvancedMenuPages(this.id);
    }

    async pluginReady() {
        const sanitization = this.getOption('sanitizeConfig', this.getStaticMeta('sanitizeConfig'))
            || APPLICATION_CONTEXT.secure;

        // Where pages are mounted: 'plugins' (fullscreen Plugins menu, default),
        // 'viewer' (global per-viewer right-side menu), or 'both'. Each page may
        // override the plugin-level default via its own `target` property.
        const defaultTarget = this.getOption('target', this.getStaticMeta('target')) || 'plugins';

        // `data` is either a flat array of page configs or an array of such arrays
        // (groups). Both forms flatten to the same set of pages.
        const pages = Array.isArray(this.pages[0]) ? this.pages.flat() : this.pages;

        const pluginPages = [];
        const viewerPages = [];
        for (const page of pages) {
            const target = page.target || defaultTarget;
            if (target === 'plugins' || target === 'both') pluginPages.push(page);
            if (target === 'viewer' || target === 'both') viewerPages.push(page);
        }

        if (pluginPages.length) this.builder.buildMetaDataMenu(pluginPages, sanitization);
        if (viewerPages.length) this.builder.buildMetaDataViewerMenu(viewerPages, sanitization);
    }
});
