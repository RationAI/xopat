addPlugin('rationai-wsi-file-browser', class extends XOpatPlugin {
    constructor(id) {
        super(id);

        this.wsi_server = this.getStaticMeta('wsiService');
        if (!this.wsi_server) {
            console.warn('Wsi server not configured: exitting..');
            return;
        }

        this.integrateWithPlugin("slide-info", async (info) => {
            this.slideMenu = info.menu;

            const dynamicLevel = {
                id: "filesystem",
                title: "Filesystem",
                mode: "virtual",
                pageSize: 50,

                getChildren: async (parent, ctx) => {
                    const items = [];
                    const contextPath = parent?.path || "";

                    const normPath = (p) => (p || "").replace(/^\/+/, "");
                    const makeSlideItem = (rawPath) => {
                        const norm = normPath(rawPath);
                        return {
                            type: "slide",
                            path: norm,
                            label: norm.split("/").pop(),
                        };
                    };

                    try {
                        const url = new URL(`${this.wsi_server}/v3/cases/`);
                        url.searchParams.set("context", contextPath);

                        const res = await fetch(url.toString());
                        let cases = await res.text();
                        if (!res.ok) {
                            throw new Error(cases);
                        }
                        cases = JSON.parse(cases);

                        for (const c of cases || []) {
                            const normId = normPath(c.local_id || c.id);
                            items.push({
                                type: "case",
                                label: normId.split("/").pop(),
                                path: normId,
                                slides: Array.isArray(c.slides) ? c.slides.slice() : [],
                            });
                        }
                    } catch (err) {
                        console.error("File Browser failed to list cases!", err);
                        Dialogs.show(`Could not list cases for the path ${contextPath}!`, 5000, Dialogs.MSG_ERR);
                        return {
                            items: [],
                            total: 0,
                        };
                    }

                    if (!parent) {
                        try {
                            const url = new URL(`${this.wsi_server}/v3/cases/slides/`);
                            url.searchParams.set("slide_id", contextPath);

                            const res = await fetch(url.toString());
                            let slides = await res.text();
                            if (!res.ok) {
                                throw new Error(slides);
                            }
                            slides = JSON.parse(slides);
                            for (const c of slides || []) {
                                items.push(makeSlideItem(c.local_id || c.id));
                            }
                        } catch (err) {
                            console.error("File Browser failed to list slides!", err);
                            Dialogs.show(`Could not list slides for the path ${contextPath}!`, 5000, Dialogs.MSG_ERR);
                        }
                    }

                    if (parent && Array.isArray(parent.slides)) {
                        for (const slidePath of parent.slides) {
                            items.push(makeSlideItem(slidePath));
                        }
                    }

                    return {
                        items,
                        total: items.length,
                    };
                },

                renderItem: (item) => {
                    if (item.type === "case") {
                        return div(
                            { class: "flex items-center gap-2 px-2 py-2 hover:bg-base-300 rounded cursor-pointer text-base-content/80"},
                            new UI.FAIcon({ name: "fa-folder", extraClasses: "text-base-content/70" }).create(),
                            span(item.label)
                        );
                    }
                    // todo: private methods should not be touched, make it possible to call default
                    return this.slideMenu._renderSlideCard(item);
                },

                canOpen(item) {
                    return item.type === "case";
                },

                keyOf(item) {
                    return item.path || item.label || "ROOT";
                }
            };

            const normPath = (p) => (p || "").replace(/^\/+/, "");
            const toViewerRef = (p) => normPath(p).replaceAll("/", ">");  // if your viewer uses '>'
            const toFsPath = (ref) => (ref || "").replaceAll(">", "/");   // explorer uses '/'

            info.setCustomBrowser({
                id: "rationai-wsi-file-browser",
                levels: dynamicLevel,
                customItemToBackground: (item) => ({
                    name: item.label,
                    dataReference: toViewerRef(item.rel_path || item.path),
                }),
                backgroundToCustomItem: (bg) => {
                    const ref = BackgroundConfig.data(bg)[0];
                    const fsPath = toFsPath(ref);
                    return { type: "slide", path: fsPath, label: fsPath.split("/").pop() };
                },
            });
        });
    }
});
