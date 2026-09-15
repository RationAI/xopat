addPlugin('rationai-wsi-file-browser', class extends XOpatPlugin {
    constructor(id) {
        super(id);

        this.wsi_server = this.getStaticMeta('wsiService');
        // Deployment-controlled (ENV / include.json), never `getOption`: which
        // upstream this plugin may reach is operator policy, not a preference.
        const proxyAlias = this.getStaticMeta('proxy');
        this.proxy = typeof proxyAlias === "string" && proxyAlias.trim() ? proxyAlias.trim() : undefined;

        // Judged once, here, and reported with the key and the value.
        //
        // A missing value used to say only "not configured", and an unusable one
        // said nothing at all until `new URL()` threw `Invalid URL` per listing
        // attempt — naming neither the setting nor its content. That cost real
        // debugging time for a value that was simply corrupt: an `env/.env` line
        // appended without a trailing newline resolved `<% WSI_PORT %>` to
        // `9002"WSI_PORT=9002"`, so the base read
        // `http://localhost:9002"WSI_PORT=9002"`. Printing the value makes that
        // self-evident; a TypeError from a URL constructor does not.
        const configured = typeof this.wsi_server === "string" ? this.wsi_server.trim() : "";
        let baseIsValid = false;
        if (configured) {
            try {
                new URL(configured);
                baseIsValid = true;
            } catch (e) {
                baseIsValid = false;
            }
        }
        // With a proxy alias the origin lives server-side in
        // `core.server.secure.proxies.<alias>.baseUrl`, so `wsiService` is unused
        // and need not be valid — one of the two must be.
        if (!this.proxy && !baseIsValid) {
            console.warn(`[${id}] not starting: 'wsiService' must be an absolute URL, got ` +
                `${JSON.stringify(this.wsi_server)}. Set it per deployment under ` +
                `ENV.plugins["${id}"].wsiService, or route the plugin through a ` +
                `server proxy alias with ENV.plugins["${id}"].proxy.`);
            return;
        }
        // Trailing slashes would double up against the `/v3/...` paths below.
        this.wsi_server = baseIsValid ? configured.replace(/\/+$/, "") : "";

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
                const res = await this.client().fetchRaw(
                    `/v3/cases/?${new URLSearchParams({ context: contextPath })}`);
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
                            const res = await this.client().fetchRaw(
                                `/v3/cases/slides/?${new URLSearchParams({ slide_id: contextPath })}`);
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

    /**
     * The one endpoint this plugin talks to, built on first use — a plugin
     * constructor runs before the core globals are settled, and `HttpClient` is
     * what carries the CSRF header a proxied request needs.
     *
     * Both modes resolve the same relative paths: with `proxy` the origin lives
     * server-side under `proxies.<alias>.baseUrl` and requests travel
     * `/proxy/<alias>/v3/...` on the viewer origin; without it they go straight
     * to the configured `wsiService` base. Never a bare `fetch`: that bypassed
     * CSRF, the proxy alias, and secureMode policy alike.
     */
    client() {
        if (!this._client) {
            this._client = new HttpClient(this.proxy
                ? { proxy: this.proxy }
                : { baseURL: this.wsi_server });
        }
        return this._client;
    }
});
