addPlugin("custom-pages", class extends XOpatPlugin {
    constructor(id) {
        super(id);
        this.builder = new AdvancedMenuPages(this.id);
    }

    /**
     * All pages this plugin renders, regardless of provenance. Kept for
     * back-compat with anything reading `plugin.pages`; the mounting logic uses
     * the two provenances separately, see `pluginReady`.
     */
    get pages() {
        return [
            ...this._pagesOf(this.getStaticMeta('data')),
            ...this._pagesOf(this._sessionData())
        ];
    }

    async pluginReady() {
        // §7: a sanitization policy and a placement default are DEPLOYMENT
        // decisions. `getOption` resolves `APPLICATION_CONTEXT.config.plugins[id]`
        // — session / POST_DATA / URL params / an imported peer session — so
        // reading them there let the same bundle that supplies the pages also
        // choose how safely they are rendered. Static meta only.
        const operatorPolicy = this.getStaticMeta('sanitizeConfig', false);
        const defaultTarget = this.getStaticMeta('target', 'plugins');

        // Provenance decides the policy. Pages from ENV / include.json are
        // operator-authored, so they get whatever the operator configured.
        // Pages arriving with the session are untrusted and always render under
        // the module default allowlist — note `false` no longer means "raw", it
        // means "module default" (see the menu-pages README).
        this._mount(this._pagesOf(this.getStaticMeta('data')), defaultTarget, operatorPolicy);
        this._mount(this._pagesOf(this._sessionData()), defaultTarget, false);
    }

    /** Session-supplied `data`, read directly - `getOption` would merge the two provenances. */
    _sessionData() {
        return APPLICATION_CONTEXT.config.plugins[this.id]?.data;
    }

    /** `data` is either a flat array of page configs or an array of such arrays. */
    _pagesOf(data) {
        if (!Array.isArray(data)) return [];
        return Array.isArray(data[0]) ? data.flat() : data;
    }

    /**
     * Where pages are mounted: 'plugins' (fullscreen Plugins menu, default),
     * 'viewer' (global per-viewer right-side menu), or 'both'. Each page may
     * override the plugin-level default via its own `target` property.
     */
    _mount(pages, defaultTarget, sanitizeConfig) {
        const pluginPages = [];
        const viewerPages = [];
        for (const page of pages) {
            const target = page.target || defaultTarget;
            if (target === 'plugins' || target === 'both') pluginPages.push(page);
            if (target === 'viewer' || target === 'both') viewerPages.push(page);
        }

        if (pluginPages.length) this.builder.buildMetaDataMenu(pluginPages, sanitizeConfig);
        if (viewerPages.length) this.builder.buildMetaDataViewerMenu(viewerPages, sanitizeConfig);
    }
});
