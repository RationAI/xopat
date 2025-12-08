addPlugin('file-browser', class extends XOpatPlugin {
    constructor(id) {
        super(id);

        this.wsi_server = "http://localhost:8080";

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

                    try {
                        const url = new URL(`${this.wsi_server}/v3/cases/`);
                        url.searchParams.set("context", contextPath);

                        const res = await fetch(url.toString());
                        if (!res.ok) {
                            console.error("/v3/cases error", res.status, await res.text());
                        } else {
                            const cases = await res.json();

                            for (const c of cases || []) {
                                const raw = (c.local_id || c.id || "").replace(/^\/+/, "");

                                items.push({
                                    type: "case",
                                    label: raw.split("/").pop(),
                                    path: raw,
                                    slides: Array.isArray(c.slides) ? c.slides.slice() : [],
                                });
                            }
                        }
                    } catch (err) {
                        console.error("EXCEPTION in /v3/cases:", err);
                    }

                    if (!parent) {
                        try {
                            const url = new URL(`${this.wsi_server}/v3/cases/slides/`);
                            url.searchParams.set("slide_id", contextPath);

                            const res = await fetch(url.toString());
                            if (!res.ok) {
                                console.error("/v3/cases/slides error", res.status, await res.text());
                            } else {
                                const slides = await res.json();
                                for (const c of slides || []) {
                                    items.push({
                                        type: "slide",
                                        label: (c.local_id || c.id || "").replace(/^\//, ""),
                                        path: (c.local_id || c.id || "").replace(/^\//, ""),
                                    });
                                }
                            }
                        } catch (err) {
                            console.error("EXCEPTION in /v3/cases/slides:", err);
                        }
                    }

                    if (parent && Array.isArray(parent.slides)) {
                        for (const slidePath of parent.slides) {
                            const normPath = (slidePath || "").replace(/^\/+/, "");
                            items.push({
                                type: "slide",
                                label: normPath.split("/").pop(),
                                path: normPath,
                                rel_path: normPath,
                            });
                        }
                    }

                    return {
                        items,
                        total: items.length,
                    };
                },

                renderItem: (item, { itemIndex }) => {
                    if (item.type === "case") {
                        return div(
                            { class: "flex items-center gap-2 px-2 py-2 hover:bg-base-300 rounded cursor-pointer text-base-content/80"},
                            new UI.FAIcon({ name: "fa-folder", extraClasses: "text-base-content/70" }).create(),
                            span(item.label)
                        );
                    }
                    return this.slideMenu._renderSlideCard(itemIndex, item);
                },

                canOpen(item) {
                    return item.type === "case";
                },
            };

            const bgItemGetter = (item) => {
                const path = item.rel_path || item.path;
                return {
                    id: item.label,
                    name: item.label,
                    dataReference: path,
                    getViewer() { return null; },
                };
            };

            info.setCustomBrowser({
                id: "file-browser",
                levels: dynamicLevel,
                bgItemGetter,
            });
        });
    }
});
















