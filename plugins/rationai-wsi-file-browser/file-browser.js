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

            const normPathOf = (p) => (p || "").replace(/^\/+/, "");

            /**
             * Cases directly under `contextPath`, as explorer items. Shared by
             * the listing and by the state restore, which must reconstruct the
             * very same item (`slides` included — the listing of a case reads
             * it off its parent).
             */
            const listCasesAt = async (contextPath) => {
                const url = new URL(`${this.wsi_server}/v3/cases/`);
                url.searchParams.set("context", contextPath);

                const res = await fetch(url.toString());
                let cases = await res.text();
                if (!res.ok) {
                    throw new Error(cases);
                }
                cases = JSON.parse(cases);

                return (cases || []).map(c => {
                    const normId = normPathOf(c.local_id || c.id);
                    return {
                        type: "case",
                        label: normId.split("/").pop(),
                        path: normId,
                        slides: Array.isArray(c.slides) ? c.slides.slice() : [],
                    };
                });
            };

            const dynamicLevel = {
                id: "filesystem",
                title: "Filesystem",
                mode: "virtual",
                pageSize: 50,

                getChildren: async (parent, ctx) => {
                    const items = [];
                    const contextPath = parent?.path || "";

                    const normPath = normPathOf;
                    const makeSlideItem = (rawPath) => {
                        const norm = normPath(rawPath);
                        return {
                            type: "slide",
                            path: norm,
                            label: norm.split("/").pop(),
                        };
                    };

                    try {
                        items.push(...await listCasesAt(contextPath));
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
                            new UI.PhIcon({ name: "ph-folder", extraClasses: "text-base-content/70" }).create(),
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
                },

                /**
                 * Return to a folder after a reload. The case must come from
                 * the server rather than be synthesized from its path: its
                 * `slides` array is what makes the folder list its slides.
                 */
                resolveByKey: async (parent, key) => {
                    const path = normPathOf(key);
                    if (!path) return null;
                    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
                    const cases = await listCasesAt(parent?.path ?? parentPath);
                    return cases.find(c => c.path === path) || null;
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
