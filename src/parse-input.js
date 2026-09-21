/**
 * Client-side parsing of the viewer session configuration
 * @param {object} postData post data available to the viewer if any
 * @param i18n i18next translation context
 * @param supportsPost whether the server implementation supports post data
 * @param {object} [ENV] the deployment config (`XOpatCoreConfig`). Passed
 *   explicitly: this runs before APPLICATION_CONTEXT exists and `window.ENV`
 *   is never assigned by any renderer.
 * @returns {*|{error}}
 */
function xOpatParseConfiguration(postData, i18n, supportsPost, ENV) {
    function ensureDefined(object, property, defaultValue) {
        if (!object.hasOwnProperty(property)) {
            object[property] = defaultValue;
            return false;
        }
        return true;
    }

    function _parse(configuration) {
        function isBoolFlagInObject(object, key) {
            const ref = object ? object[key] : undefined;
            if (ref === undefined || ref === null) return false;
            if (typeof ref === "string") return ref !== "" && ref !== "false";
            return !!ref;
        }

        function getError(title, description, details) {
            return {error: title, description: description, details: details};
        }

        if (!configuration) {
            return null;
        }

        if (typeof configuration === "string") {
            try {
                configuration = JSON.parse(configuration);
            } catch (e) {
                return getError(  "messages.urlInvalid", "messages.postDataSyntaxErr",
                    ` "JSON Error: ${e}<br>`
                    + JSON.stringify(configuration.data));
            }
        }

        ensureDefined(configuration, "params", {});
        ensureDefined(configuration, "data", []);
        let definedRendering = ensureDefined(configuration, "background", []);
        ensureDefined(configuration, "plugins", {});

        const isDebug = isBoolFlagInObject(configuration.params, "debugMode");
        const bypassCookies = isBoolFlagInObject(configuration.params, "bypassCookies");

        // `bg.dataReference` permits three shapes, matching the ambient
        // type at src/types/app.d.ts (DataReference = number | DataID |
        // DataOverride) and what BackgroundConfig.from() already accepts:
        //   - integer  → index into configuration.data (legacy)
        //   - string   → inline DataID (URL/path carried on the bg entry)
        //   - object   → DataOverride {dataID, protocol, options, …} as used
        //                by the DICOM plugin and any future factory protocol
        // The old strict `Number.isInteger` gate rejected the DataOverride
        // form, so exporting a DICOM-backed session and reloading it always
        // landed on "no slide opened" — fixed here.
        function isValidDataReference(ref, dataLen) {
            if (Number.isInteger(ref)) return ref >= 0 && ref < dataLen;
            if (typeof ref === "string" && ref) return true;
            if (ref && typeof ref === "object") {
                if (ref.dataID !== undefined) return true;
                return Object.keys(ref).length > 0;
            }
            return false;
        }
        for (let bg of configuration.background) {
            if (!bg || !isValidDataReference(bg.dataReference, configuration.data.length)) {
                return getError("messages.urlInvalid", "messages.bgReferenceMissing",
                    `Invalid data reference '${JSON.stringify(bg?.dataReference)}'. Available data: `
                    + JSON.stringify(configuration.data));
            }
        }

        const singleBgImage = configuration.background.length === 1;
        const firstTimeVisited = false; //todo support this?

        if (configuration.visualizations) {
            //requires webgl module
            definedRendering = true;
        }

        if (!definedRendering) {
            return getError("error.nothingToRender",
                "error.nothingToRenderDescription",
                "Empty background and visualization configuration.");
        }
        return configuration;
    }

    let session;
    try {
        const url = new URL(window.location.href);

        // First priority has post (or other) data given
        let data = postData["visualization"] || postData["visualisation"];
        session = _parse(data);

        // In case we could not retrieve the session from data, we try URL
        if (!session || session.error) {
            const fromHash = !!url.hash;
            const urlData = fromHash
                ? decodeURIComponent(url.hash.substring(1))
                : url.searchParams.get("visualization");

            if (urlData) {
                data = urlData;
                // If it’s already in the hash, parse locally so refresh/share stays stable.
                if (supportsPost && !fromHash) {
                    // existing POST redirect logic (unchanged)
                    const form = document.createElement("form");
                    form.method = "POST";
                    const node = document.createElement("input");
                    node.name = "visualization";
                    node.value = data;
                    form.appendChild(node);
                    form.style.visibility = 'hidden';
                    document.body.appendChild(form);

                    url.hash = "";
                    form.action = String(url);
                    form.submit();
                } else {
                    session = _parse(data);
                }
            }
            // Some proxies (e.g. JupyterHub's configurable-http-proxy) re-encode
            // query strings, so a singly-encoded `?visualization=%7B...` arrives
            // doubly-encoded and URLSearchParams.get() only undoes one layer.
            // If parsing failed and the payload still looks URL-encoded, retry.
            if (session && session.error && typeof data === "string" && /%[0-9A-Fa-f]{2}/.test(data)) {
                try {
                    const retried = _parse(decodeURIComponent(data));
                    if (retried && !retried.error) session = retried;
                } catch { /* keep original error */ }
            }
        }

        // Try parsing slides & visualization GET params
        if (!session) {
            const handMadeConfiguration = {
                data: []
            };

            const slide = url.searchParams.get("slides");
            let processed = false;
            if (slide) {
                const slideList = slide.split(",");
                handMadeConfiguration.data = slideList;
                handMadeConfiguration.background = slideList.map((slide, index) => {
                    return {
                        dataReference: index,
                    }
                });
                processed = true;
            }
            let masks = url.searchParams.get("masks");
            if (masks) {
                masks = masks.split(',');
                const visConfig = {
                    name: "Masks",
                    shaders: {}
                };
                handMadeConfiguration.visualizations = [visConfig];

                let index = 1;
                for (let mask of masks) {
                    handMadeConfiguration.data.push(mask);
                    visConfig.shaders[mask] = {
                        type: "heatmap",
                        fixed: false,
                        visible: 1,
                        dataReferences: [index++],
                        params: { }
                    }
                }
                processed = true;
            }

            if (processed) {
                session = _parse(handMadeConfiguration);
            }
        }

        // Session-cache scoping + middleware note. This is a BOOT-TIME
        // bootstrap cache and deliberately uses raw localStorage.
        //
        // It is not that the middleware is merely "not ready yet" — it CANNOT
        // be ready. `bootstrapIOPipeline` captures `POST_DATA` by reference
        // (the post-data KV driver and the bundle sink both hold that object),
        // and this very function REPLACES that object when it restores a
        // cached session (`postData = data` below, returned at the end). So the
        // pipeline must be constructed after this call, and no kv driver can
        // ever serve this read. Admin driver re-binding therefore does not
        // affect this path either — see src/IO_PIPELINE.md "Bootstrap
        // exception" for the full reasoning and for the rule that governs
        // adding any new boot-time persisted state.
        //
        // The cache is scoped to the deployment identity: origins (localhost
        // especially) are shared across deployments, and a stale session from
        // a different env config must not replay here — its data references
        // may be unresolvable under this deployment's slide protocols.
        //
        // The key must fingerprint the configuration that decides whether a
        // cached session's data references can still RESOLVE — not the
        // deployment's cosmetic identity. Domain+path+name alone is not enough:
        // two env files served from the same localhost with no `name` set
        // produce an identical key, so a session captured under one deployment
        // replays under another and its shaders die with
        // "no protocol resolvable for role visualization".
        //
        // Deliberately excluded: themes, UI flags, viewport defaults, anything
        // that cannot make a data reference unresolvable. Including those would
        // discard the user's session on every unrelated config tweak.
        //
        // The fingerprint itself lives in `src/classes/app/deployment-key.ts`
        // (installed by `dist/store.js`, the first app script) and is computed
        // once by `initXOpat` from the SERVED configuration — including the
        // plugin/module registries, which the browser receives as separate
        // arguments and never as `ENV.plugins`. That is the whole reason the
        // previous local copy was inert: it fingerprinted `window.ENV`, which no
        // renderer assigns.
        const envKey = window.XOpatDeploymentKey
            ? window.XOpatDeploymentKey.get() || window.XOpatDeploymentKey.resolve(ENV)
            : "";
        // Not named `storage`: `restoreFrom`/`dropSessionCache` below take a
        // `storage` parameter (an actual Storage object) and would shadow it.
        const storageAvail = window.XOpatStorageAvailability;
        // Whether storage can be touched AT ALL. An embedding with no usable
        // storage (opaque origin) must not even reach the property access.
        const storageUsable = !!(storageAvail?.localStorage || storageAvail?.sessionStorage);
        // Mirror of the middleware's `bypassCache` semantics (store.ts) at the
        // one point where the middleware flag cannot be consulted.
        //
        // This gates RESTORE and SAVE only — never eviction. The flag is a
        // preference about using one's own cache; it is not permission for
        // another deployment's session to sit in this origin's storage waiting
        // for the flag to flip. Folding the two together is what let a stale
        // entry survive an env switch untouched.
        const bypassSessionCache = ENV?.setup?.bypassCache === true || !storageUsable;
        // Deployment opt-out for the COLD-LOAD restore specifically: a boot with
        // no session of its own does not adopt whatever the last one left behind.
        // Eviction and saving keep running, which is what "load time" means — a
        // boot that arrives WITH a session (auth-redirect return, POST, hash) is
        // unaffected. Read from ENV.setup, never `params`: a cold load carries no
        // params by definition, and a deployment flag must not be session-settable.
        const bypassColdRestore = ENV?.setup?.bypassCacheLoadTime === true;
        // Exact match required. A cache entry without `__envKey` predates this
        // scoping and carries no evidence of where it came from — treating it as
        // a match is what let pre-existing stale sessions replay indefinitely.
        //
        // No key at all (the deployment-key module failed to load) degrades
        // CLOSED: without it, an entry stamped "" would match "" and every
        // deployment would share one cache again.
        const cacheMatchesEnv = (data) => !!envKey && !!data && data.__envKey === envKey;

        /**
         * Evict a stored session from the store it came from — and only that one.
         *
         * The two stores hold independent entries and must be judged
         * independently. localStorage is shared across tabs, so another
         * deployment open elsewhere can overwrite it while this tab's
         * sessionStorage still holds a perfectly good session for *this*
         * deployment. Letting one store's garbage condemn the other would
         * destroy exactly the context sessionStorage exists to protect.
         */
        const dropSessionCache = (reason, storage) => {
            try { storage.removeItem("xoSessionCache"); } catch (e) { /* storage disabled */ }
            console.info(`[xopat] discarded cached session: ${reason}`);
        };

        /**
         * Read one store and return its session, or null.
         *
         * Anything unusable is evicted rather than merely ignored — that is the
         * difference between "this boot is fine" and "every future boot is fine".
         *
         * @param {Storage} storage
         * @param {boolean} enforceAge sessionStorage dies with the tab, so its
         *   entry is context-preservation (auth redirects) and is not aged out;
         *   localStorage outlives the tab and is capped at 30 minutes.
         */
        const restoreFrom = (storage, enforceAge) => {
            let strData;
            try {
                strData = storage.getItem("xoSessionCache");
            } catch (e) {
                return null;    // storage disabled (private mode, blocked cookies)
            }
            if (!strData || strData === "undefined") return null;

            let data;
            try {
                data = JSON.parse(strData);
            } catch (e) {
                // Corrupt entry would otherwise throw out of the whole parse and
                // surface as a boot error with no way for the user to recover.
                dropSessionCache("stored session is not valid JSON", storage);
                return null;
            }

            if (!cacheMatchesEnv(data)) {
                dropSessionCache(
                    `belongs to a different deployment configuration (${data?.__envKey ?? "unscoped"} != ${envKey})`,
                    storage);
                return null;
            }

            const viz = data && data.visualization;
            if (!viz) {
                dropSessionCache("stored session carries no configuration", storage);
                return null;
            }

            if (enforceAge && !(viz.__age && Date.now() - viz.__age < 1800e3)) {
                dropSessionCache("older than 30 minutes", storage);
                return null;
            }

            delete viz.__age;
            const restored = _parse(viz);
            if (!restored || restored.error) {
                // A config that no longer parses (schema drift, truncated write)
                // is dead weight. Evict it and let the next store — or the
                // default screen — take over, instead of surfacing a boot error.
                dropSessionCache(`stored configuration no longer parses: ${restored?.error ?? "empty"}`, storage);
                return null;
            }

            // Only now commit: a failed restore must not leave a foreign POST
            // payload behind for the rest of the boot to pick up.
            postData = data;    // restore the whole POST payload, not just the session
            restored.__fromLocalStorage = true;
            return restored;
        };

        /**
         * Drop an entry belonging to a different deployment — before anything
         * decides whether to *use* the cache, and regardless of `bypassCache`.
         *
         * Runs on every boot, including one that already has a session (a POST,
         * a hash): the leftovers of the deployment that used this origin before
         * are stale the moment the key changes, and leaving them costs a read on
         * every future boot and replays the instant restoring is re-enabled.
         *
         * Deliberately narrow — only the deployment mismatch and an entry too
         * corrupt to have a deployment. Age, parseability and shape are
         * `restoreFrom`'s business, because they only matter to a boot that is
         * actually restoring.
         */
        const evictForeignSessionCache = (storage) => {
            let strData;
            try {
                strData = storage.getItem("xoSessionCache");
            } catch (e) {
                return;         // storage disabled (private mode, blocked cookies)
            }
            if (!strData || strData === "undefined") return;
            let data;
            try {
                data = JSON.parse(strData);
            } catch (e) {
                dropSessionCache("stored session is not valid JSON", storage);
                return;
            }
            if (!cacheMatchesEnv(data)) {
                dropSessionCache(
                    `belongs to a different deployment configuration (${data?.__envKey ?? "unscoped"} != ${envKey})`,
                    storage);
            }
        };

        // The two stores are judged independently — see `dropSessionCache`.
        if (storageAvail?.localStorage) evictForeignSessionCache(window.localStorage);
        if (storageAvail?.sessionStorage) evictForeignSessionCache(window.sessionStorage);

        /**
         * Did this session come from a DIFFERENT deployment?
         *
         * `serializeAppConfig` stamps `__envKey` on everything this viewer
         * serializes, which covers the transports that outlive an ENV swap
         * because they live in the history entry rather than in storage: the
         * address-bar hash written by `syncSessionToUrl`, the self-POST rewrite
         * above, `getForm`, and the file export. Those are read BEFORE the boot
         * cache and were the one input nothing judged.
         *
         * Present-and-different only. An ABSENT stamp means "not produced by this
         * viewer" — an embedding application, a demo link, a hand-written session
         * — and must keep working exactly as before.
         */
        const sessionIsForeign = !!(session && !session.error
            && session.__envKey && session.__envKey !== envKey);
        if (sessionIsForeign) {
            // Deliberately loaded anyway: two deployments that differ only
            // cosmetically fingerprint alike, so a genuinely shared link still
            // works, and refusing outright would break sharing between twins.
            // The flag drives one toast once the UI exists (src/app.ts).
            console.info(`[xopat] session was produced by a different deployment `
                + `configuration (${session.__envKey} != ${envKey}); loading it anyway`);
            session.__foreignDeployment = true;
        }

        if (!session) {
            if (!bypassSessionCache && !bypassColdRestore) {
                // Fall through to sessionStorage when localStorage yields nothing
                // usable. The previous `else` only consulted sessionStorage when
                // localStorage was *empty*, so a foreign or expired localStorage
                // entry hid a perfectly valid sessionStorage one — losing context
                // across exactly the auth-redirect round trip it exists to protect.
                // The `window.localStorage` PROPERTY READ is itself a throw site
                // in a sandboxed iframe (opaque origin), so the probe must gate
                // the argument, not just `restoreFrom`'s body.
                session = (storageAvail?.localStorage ? restoreFrom(window.localStorage, true) : null)
                    || (storageAvail?.sessionStorage ? restoreFrom(window.sessionStorage, false) : null);
            }
        } else if (!session.error && !bypassSessionCache && !sessionIsForeign && envKey) {
            // A foreign session is never written back. Without this the boot
            // cache LAUNDERS it: a stale address-bar hash loads once, gets saved
            // under THIS deployment's key, and every later empty boot then
            // restores it legitimately — forever, and silently. The eviction
            // pass above has already removed any foreign entry, so one such boot
            // leaves the cache clean rather than poisoned.
            //
            // Save current state (including post) in case we loose it and need to restore it (e.g. auth redirect)
            const data = postData || {};
            session.__age = Date.now();
            data.visualization = session;
            data.__envKey = envKey;

            const sessionData = JSON.stringify(data);
            // Local Storage is meant for 'last session', available accross windows, session storage is to prevent
            // losing context at any cost.
            // Each write is guarded independently: an unguarded throw here used
            // to be swallowed by the outer catch, which sets `session = {error}`
            // and boots the viewer straight into the error screen.
            if (storageAvail?.localStorage) {
                try { window.localStorage.setItem("xoSessionCache", sessionData); } catch (e) { /* storage disabled */ }
            }
            if (storageAvail?.sessionStorage) {
                try { window.sessionStorage.setItem("xoSessionCache", sessionData); } catch (e) { /* storage disabled */ }
            }
        }

        // Todo this will make the viewer to not show any error - handled by the default screen... any better solution?
        if (!session) {
            session = {};
        }

        // Needs to be solo condition, the above could create the session object
        if (session.error) {
            session.error = i18n.t(session.error);
            if (session.description) session.description = i18n.t(session.description);
        }
    } catch (e) {
        postData = postData || {};
        session = {error: e};
    }

    //especially page with error 'error.nothingToRender'
    ensureDefined(session, "params", {});
    ensureDefined(session, "data", []);
    ensureDefined(session, "background", []);
    ensureDefined(session, "plugins", {});
    postData.visualization = session;
    return postData;
}
