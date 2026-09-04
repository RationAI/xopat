// @ts-nocheck -- mechanical port of the former `src/external/scalebar.js`.
// Split out of the single 3388-line IIFE and moved into the core TS build so
// esbuild inlines it into `dist/app.js` instead of shipping it as a separate
// startup <script>. Bodies are unchanged JS; typing them is deliberate
// follow-up work and must not be mixed into a behaviour-identical move.

import { QUICK_ZOOM_MIN_MAGNIFICATION, COLLAPSED_CACHE_KEY } from "./constants";

function SyncToggleButton(viewer, tool) {
    const enabled = van.state(!!tool?.isEnabled?.());

    // NEW: calibration UI state
    const busy = van.state(false);
    const progressText = van.state(""); // e.g. "Pick points 1/3"
    const isRef = van.state(false);

    const updateFromTool = () => {
        enabled.val = !!tool?.isEnabled?.();

        const S = tool?.constructor?._session;
        isRef.val = !!enabled.val && !!S?.leaderId && viewer.uniqueId === S.leaderId;
    };

    const setProgress = (txt) => { progressText.val = txt || ""; };
    const setBusy = (b) => { busy.val = !!b; };

    // Expose hooks so tool can update the button
    tool.__ui = { setProgress, setBusy };

    const onClick = async (ev) => {
        if (!tool) return;

        if (busy.val) {
            // Mid-calibration click: abort the point picker and fall back to
            // LINK as if nothing happened. The rejected `enable()` promise is
            // handled by the catch below, which resets `enabled`/progress.
            tool.cancelCalibration?.();
            return;
        }
        setBusy(true);

        if (VIEWER_MANAGER.viewers.length < 2) {
            Dialogs?.show?.(window.$.t('sync.needsTwoSlides'));
            setBusy(false);
            return;
        }

        try {
            if (enabled.val) {
                tool.disable();
                enabled.val = false;
                setProgress("");
                Dialogs?.show?.(window.$.t('sync.disabled'), 1200, Dialogs.MSG_INFO);
            } else {
                // Default is automatic registration; Alt/Shift forces the
                // three-point picker for slides the estimator cannot match.
                // `enable()` may upgrade auto to manual on its own (a viewer
                // the user just cleared), so it owns the progress label.
                const manual = !!(ev?.shiftKey || ev?.altKey);
                setProgress("");
                const res = await tool.enable({ mode: manual ? "manual" : "auto" });
                enabled.val = true;
                setProgress("");
                if (res?.approximate) {
                    Dialogs?.show?.(window.$.t('sync.enabledApproximate'), 3000, Dialogs.MSG_WARN);
                } else {
                    Dialogs?.show?.(window.$.t('sync.enabled'), 1200, Dialogs.MSG_SUCCESS);
                }
            }
        } catch (e) {
            tool.disable?.();
            enabled.val = false;
            setProgress("");
            if (e && /cancel/i.test(e.message || "")) {
                Dialogs?.show?.(window.$.t('sync.cancelled'), 1200, Dialogs.MSG_INFO);
            } else {
                console.error(e);
                Dialogs?.show?.(window.$.t('sync.failed'), 1600, Dialogs.MSG_WARN);
            }
        } finally {
            setBusy(false);
        }
    };

    viewer.__syncToolChanged = updateFromTool;

    return van.tags.button(
        {
            class: () => [
                "btn btn-xs border-none px-1",
                enabled.val ? (isRef.val ? "btn-primary" : "btn-success") : ""
            ].join(" "),
            onclick: onClick,
            title: () => (busy.val
                ? window.$.t('sync.cancelCalibration')
                : (enabled.val ? window.$.t('sync.disableTitle') : window.$.t('sync.enableTitle')))
        },
        // Use a simple Link icon or text abbreviation
        van.tags.span({ class: "font-bold", style: "font-size:10px;line-height:1" },
            () => {
                if (busy.val) return "...";
                if (!enabled.val) return "LINK";
                return isRef.val ? "REF" : "SYNC";
            }
        )
    );
}

/**
 * Render any of the documented `ImageLike` shapes returned by
 * `TileSource.getLabel()` / `getThumbnail()` into `container`.
 * Returns `{node, objectUrl}` (objectUrl is non-null when we created one
 * from a Blob and must be revoked later), or null if `src` is unrenderable.
 */
function renderImageLikeInto(container, src) {
    let objectUrl = null;
    let node = null;
    if (typeof src === "string") {
        node = document.createElement("img");
        node.src = src;
    } else if (src instanceof Blob) {
        objectUrl = URL.createObjectURL(src);
        node = document.createElement("img");
        node.src = objectUrl;
    } else if (typeof HTMLImageElement !== "undefined" && src instanceof HTMLImageElement) {
        node = src.cloneNode(true);
    } else if (typeof HTMLCanvasElement !== "undefined" && src instanceof HTMLCanvasElement) {
        node = src;
    } else if (src && src.canvas instanceof HTMLCanvasElement) {
        node = src.canvas;
    } else {
        return null;
    }
    if (node.tagName === "IMG") {
        node.alt = "Slide label";
        node.loading = "lazy";
    }
    node.style.maxWidth = "100%";
    node.style.maxHeight = "100%";
    node.style.display = "block";
    container.innerHTML = "";
    container.appendChild(node);
    return { node, objectUrl };
}

/**
 * Quick-zoom strip shown while the magnification panel is collapsed: a home
 * (fit slide) button followed by the reachable magnification stops, so the
 * common "go to 10x" move costs one click instead of expanding the panel and
 * dragging a slider. Stops above the slide's native magnification are
 * rendered in the error color — that zoom is interpolated, the detail is not
 * in the data. Uncalibrated slides get the same row over zoom levels (L1..Ln).
 *
 * @param {OpenSeadragon.Scalebar} scalebar
 * @param {OpenSeadragon.Viewer} viewer
 * @param {HTMLElement} header the collapsed row this group belongs to
 * @param {HTMLElement} insertAfter sibling this group is placed behind
 */
function addQuickZoomChrome(scalebar, viewer, header, insertAfter) {
    const viewport = viewer.viewport;
    const group = document.createElement("div");
    group.className = "join flex-nowrap";
    // A slide with many stops scrolls inside the row rather than breaking it.
    group.style.maxWidth = "100%";
    group.style.overflowX = "auto";

    const makeButton = (label, title, onClick, isDigital) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-xs join-item border-none px-1.5"
            + (isDigital ? " text-error" : "");
        button.title = title;
        button.textContent = label;
        button.addEventListener("click", onClick);
        group.appendChild(button);
        return button;
    };

    const home = document.createElement("button");
    home.type = "button";
    home.className = "btn btn-xs join-item border-none px-1.5";
    home.title = window.$.t('main.scalebar.home');
    home.innerHTML = '<i class="ph-light ph-house" style="font-size:12px;line-height:1"></i>';
    home.addEventListener("click", () => viewport.goHome());
    group.appendChild(home);

    // `stops` pairs a button with the log2 viewport zoom it lands on, which is
    // also what the active-stop highlight compares against.
    // Index 0 is always home: it is a real stop, not just an affordance, so the
    // span between "whole slide" and the lowest quick-zoom stop — the common
    // overview state — still has a button that can show the position fill.
    const stops = [{ button: home, log: NaN }];

    if (scalebar.magnification) {
        const native = scalebar.magnification;
        const all = scalebar.magnificationStops(true);
        // A low-power slide may top out below the quick-zoom floor; showing
        // its highest stops beats showing nothing but home.
        let selected = all.filter(mag => mag >= QUICK_ZOOM_MIN_MAGNIFICATION);
        if (!selected.length) selected = all.slice(-4);

        for (const mag of selected) {
            const zoom = scalebar.viewportZoomForMagnification(mag);
            if (!(zoom > 0)) continue;
            const isDigital = mag > native * (1 + 1e-6);
            const label = scalebar.formatMagnification(mag);
            const title = isDigital
                ? window.$.t('main.scalebar.digitalZoomHint', { mag: label })
                : window.$.t('main.scalebar.zoomTo', { mag: label });
            const button = makeButton(label, title, () => {
                viewport.zoomTo(scalebar.viewportZoomForMagnification(mag));
                viewport.applyConstraints();
            }, isDigital);
            stops.push({ button, log: Math.log2(mag) });
        }
    } else {
        const image = viewer.world.getItemAt(0);
        const nativeZoom = image ? image.imageToViewportZoom(1) : 0;
        const levels = scalebar.zoomLevelStops();
        levels.forEach((logZoom, index) => {
            const zoom = Math.pow(2, logZoom);
            const isDigital = nativeZoom > 0 && zoom > nativeZoom * (1 + 1e-6);
            const label = `L${index + 1}`;
            const title = isDigital
                ? window.$.t('main.scalebar.digitalZoomHint', { mag: label })
                : window.$.t('main.scalebar.zoomToLevel', { level: label });
            const button = makeButton(label, title, () => {
                viewport.zoomTo(zoom);
                viewport.applyConstraints();
            }, isDigital);
            stops.push({ button, log: logZoom });
        });
    }

    // The row is the only zoom feedback there is while the panel is collapsed,
    // so it has to answer "where am I" for continuous zooms too, not just for
    // the exact stops. The row reads as one segmented progress bar: every stop
    // at or below the current zoom is filled, the next one fills by the log2
    // progress toward it — "past 10x, ~40% of the way to 20x". Sitting on a
    // stop also lights it (`btn-active`). Costs no width and no extra nodes,
    // which is the whole point: the row must not push the metric bar onto a
    // second line.
    //
    // `currentColor` rather than a fixed colour: a digital-zoom stop is already
    // `text-error`, so it fills red for free, and both DaisyUI themes work
    // without hardcoding. `backgroundImage` rather than `background` so the btn
    // base colour and its :hover state survive underneath.
    const FILL_TINT = "color-mix(in oklab, currentColor 20%, transparent)";
    // log2 tolerance for "sitting on" a stop. Also the reached-threshold, so a
    // stop does not flip between full and empty on rounding noise.
    const STOP_EPS = 0.01;
    let lastReached = -1, lastNext = -1, lastPct = -1, lastExact = -1;

    const setFill = (button, pct) => {
        button.style.backgroundImage = pct > 0
            ? `linear-gradient(to right, ${FILL_TINT} 0 ${pct}%, transparent ${pct}%)`
            : "";
    };

    // Home is reachable at a zoom that changes with the container size, so its
    // log is resolved per pass rather than captured once at build time.
    const homeLog = () => {
        const homeZoom = viewport.getHomeZoom();
        if (!(homeZoom > 0)) return NaN;
        return scalebar.magnification
            ? Math.log2(scalebar.magnificationForViewportZoom(homeZoom))
            : Math.log2(homeZoom);
    };

    const reflectActive = () => {
        // Expanded, the row is display:none and the sliders carry the readout.
        if (!scalebar._ui.collapsed) return;

        const current = scalebar.magnification
            ? scalebar.getMagnification()
            : viewport.getZoom(true);
        if (!(current > 0)) return;
        const currentLog = Math.log2(current);

        stops[0].log = homeLog();

        // Reached bracket: last stop at or below the current zoom, and the
        // nearest one above it. Compared in log2 space so the tolerance is
        // scale-independent.
        let reached = -1, next = -1, exact = -1;
        for (let i = 0; i < stops.length; i++) {
            const log = stops[i].log;
            if (!Number.isFinite(log)) continue;
            if (Math.abs(log - currentLog) < STOP_EPS) exact = i;
            if (log <= currentLog + STOP_EPS) {
                if (reached < 0 || log > stops[reached].log) reached = i;
            } else if (next < 0 || log < stops[next].log) {
                next = i;
            }
        }

        // Progress from the reached stop toward the next one. Zoomed past the
        // top stop (digital zoom) there is no next: the row just reads full.
        const span = reached >= 0 && next >= 0 ? stops[next].log - stops[reached].log : 0;
        const pct = span > 0
            ? Math.round(Math.min(1, Math.max(0, (currentLog - stops[reached].log) / span)) * 100)
            : 0;

        // Per-frame handler: skip the DOM entirely when nothing moved a whole
        // percent, same guard convention as refreshHandler.
        if (reached === lastReached && next === lastNext && pct === lastPct && exact === lastExact) return;
        lastReached = reached;
        lastNext = next;
        lastPct = pct;
        lastExact = exact;

        // Reached stops fill completely, the next one fills proportionally.
        // Monotonic by construction, so landing exactly on a stop is the most
        // visible state there is instead of the emptiest one — the old
        // fill-the-lower-stop-only rule showed nothing at all at exactly 20x.
        for (let i = 0; i < stops.length; i++) {
            const button = stops[i].button;
            const log = stops[i].log;
            button.classList.toggle("btn-active", i === exact);
            const isReached = Number.isFinite(log) && log <= currentLog + STOP_EPS;
            setFill(button, isReached ? 100 : (i === next ? pct : 0));
        }
    };
    reflectActive();
    // Not the 'zoom' event: OSD raises that from zoomTo/zoomBy with the *target*
    // value, while this reads the *rendered* zoom — so on that handler the row
    // would lag a whole animation behind. 'update-viewport' is the per-frame
    // event refreshHandler already rides.
    viewer.addHandler("update-viewport", reflectActive);
    scalebar._ui.onZoomQuick = reflectActive;

    header.insertBefore(group, insertAfter ? insertAfter.nextSibling : null);
    scalebar._ui.collapsedOnly = scalebar._ui.collapsedOnly || [];
    scalebar._ui.collapsedOnly.push(group);
    return group;
}

/**
 * Mount the SYNC button, reset button, collapse toggle and slide-label
 * onto the magnification panel. The caller is responsible for pushing
 * the actual collapsible columns (`rotCol`, `magCol`) onto
 * `scalebar._ui.collapsibles` after they are constructed.
 */
function addSyncMenuChrome(scalebar, viewer, tool, magnificationContainer) {
    scalebar._ui.collapsibles = scalebar._ui.collapsibles || [];
    scalebar._ui.collapsedOnly = scalebar._ui.collapsedOnly || [];

    // Single inline strip that hangs off the top of the magnification
    // panel. Items spread across the full width with justify-between:
    // [▾]    [SYNC|clear]    [LABEL]
    const header = document.createElement("div");
    header.className = "absolute flex flex-row items-center justify-between gap-2";
    header.style.left = "-10px";
    header.style.top = "-15px";
    header.style.right = "-10px";
    header.style.zIndex = "3";
    magnificationContainer.appendChild(header);
    scalebar._ui.header = header;

    // 1) Collapse / expand chevron — leftmost.
    const toggle = document.createElement("button");
    toggle.type = "button";
    // btn-xxs (custom.css dense-chrome tier): the chevron is a pure affordance,
    // every pixel it gives back is one the quick-zoom row can use before the
    // metric bar has to wrap onto a second line.
    toggle.className = "btn btn-xxs border-none";
    toggle.style.paddingLeft = "0.125rem";
    toggle.style.paddingRight = "0.125rem";
    toggle.style.minWidth = "0";
    toggle.title = window.$.t('main.scalebar.minimize');
    toggle.innerHTML = '<span class="font-bold" style="font-size:10px;line-height:1">▾</span>';
    header.appendChild(toggle);

    // 2) SYNC button + its clear affordance, joined into one control so the
    // pair reads as a unit rather than two floating buttons.
    const syncGroup = document.createElement("div");
    syncGroup.className = "join";
    header.appendChild(syncGroup);

    const sync = SyncToggleButton(viewer, tool);
    sync.classList.add("join-item");
    syncGroup.appendChild(sync);

    // 3) Clear this viewport's alignment. Hidden unless it has one.
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "btn btn-xs join-item text-error border-none px-1";
    reset.title = window.$.t('sync.resetTitle');
    reset.innerHTML = '<i class="ph-light ph-eraser" style="font-size:12px;line-height:1"></i>';
    reset.style.display = "none";

    // Only meaningful for a viewer that actually holds a calibration —
    // elsewhere the button would be a no-op.
    const updateResetVisibility = () => {
        // Read the session directly: `_getViewerTransform` would lazily
        // create one just to render chrome.
        const S = tool?.constructor?._session;
        const shouldShow = !!S?.transforms?.[viewer.uniqueId] && !scalebar._ui.collapsed;
        reset.style.display = shouldShow ? "" : "none";
    };

    reset.addEventListener("click", async () => {
        if (!tool) return;
        try {
            // Clears THIS viewer only: drops its transform, unlinks it, and
            // arms a manual re-align for the next LINK. The rest of the
            // session survives — if this was the reference viewer, a peer is
            // promoted instead. Session-wide reset lives in the Tools menu.
            tool.resetViewer();
            Dialogs?.show?.(window.$.t('sync.cleared'), 1600, Dialogs.MSG_INFO);
        } catch (err) {
            console.error(err);
            Dialogs?.show?.(window.$.t('sync.resetFailed'), 1400, Dialogs.MSG_WARN);
        } finally {
            updateResetVisibility();
        }
    });
    syncGroup.appendChild(reset);

    // Chain into the existing __syncToolChanged hook set by SyncToggleButton.
    const prev = viewer.__syncToolChanged;
    viewer.__syncToolChanged = () => {
        prev?.();
        updateResetVisibility();
    };
    updateResetVisibility();

    // 4) Label thumbnail — pushed to the right with margin-left:auto.
    const LABEL_BOX = { width: "56px", height: "26px" };
    const LABEL_SCALE_HOVER = 4.5;

    const labelEl = document.createElement("div");
    labelEl.className = "rounded-md bg-base-200 overflow-hidden flex items-center justify-center cursor-zoom-in";
    labelEl.style.width = LABEL_BOX.width;
    labelEl.style.height = LABEL_BOX.height;
    labelEl.style.flex = "0 0 auto";
    labelEl.style.transformOrigin = "left center";
    labelEl.style.transition = "transform 0.18s ease";
    labelEl.style.display = "none";
    labelEl.title = window.$.t('main.scalebar.slideLabel');
    header.appendChild(labelEl);
    scalebar._ui.labelEl = labelEl;

    labelEl.addEventListener("mouseenter", () => {
        if (scalebar._ui.collapsed) return;
        if (labelEl.style.pointerEvents === "none") return;
        labelEl.style.transform = `scale(${LABEL_SCALE_HOVER})`;
        labelEl.style.position = "relative";
        labelEl.style.zIndex = "40";
    });
    labelEl.addEventListener("mouseleave", () => {
        labelEl.style.transform = "";
        labelEl.style.position = "";
        labelEl.style.zIndex = "";
    });

    const showLabelPlaceholder = () => {
        if (scalebar._ui?.labelEl !== labelEl) return;
        labelEl.innerHTML = "";
        labelEl.classList.remove("cursor-zoom-in");
        labelEl.classList.add(
            "border", "border-dashed", "border-base-content/30"
        );
        labelEl.style.cursor = "default";
        labelEl.style.pointerEvents = "none";
        const span = document.createElement("span");
        span.className = "italic text-base-content/60 whitespace-nowrap px-1";
        span.style.fontSize = "9px";
        span.style.lineHeight = "1";
        span.textContent = window.$.t('main.scalebar.noLabel');
        labelEl.appendChild(span);
        labelEl.title = window.$.t('main.scalebar.noLabelTitle');
        if (!scalebar._ui.collapsed) labelEl.style.display = "";
        scalebar.refreshHandler?.();
    };

    const tile = scalebar.getReferencedTiledImage?.() || viewer.world.getItemAt(0);
    const getLabel = tile?.source?.getLabel;
    if (typeof getLabel === "function") {
        Promise.resolve(getLabel.call(tile.source)).then((res) => {
            if (scalebar._ui?.labelEl !== labelEl) return;
            if (!res) { showLabelPlaceholder(); return; }
            const rendered = renderImageLikeInto(labelEl, res);
            if (!rendered) { showLabelPlaceholder(); return; }
            if (rendered.node && rendered.node.tagName === "IMG") {
                rendered.node.addEventListener("error", () => {
                    if (rendered.objectUrl) {
                        try { URL.revokeObjectURL(rendered.objectUrl); } catch {}
                        scalebar._ui.labelObjectUrl = null;
                    }
                    showLabelPlaceholder();
                });
            }
            scalebar._ui.labelObjectUrl = rendered.objectUrl || null;
            if (!scalebar._ui.collapsed) labelEl.style.display = "";
            scalebar.refreshHandler?.();
        }).catch(() => { showLabelPlaceholder(); });
    } else {
        showLabelPlaceholder();
    }

    scalebar._ui.collapsed = !!scalebar._ui.collapsed;

    // Quick-zoom row: the collapsed panel's reason to exist. Built after the
    // chrome above so it lands between the SYNC group and the slide label.
    addQuickZoomChrome(scalebar, viewer, header, syncGroup);

    scalebar._applyCollapsed = () => {
        const c = !!scalebar._ui.collapsed;
        for (const el of scalebar._ui.collapsibles) {
            if (el) el.style.display = c ? "none" : "";
        }
        // Mirror image: the quick-zoom stops replace the sliders, they do not
        // duplicate them — expanded, the sliders already show the full range.
        for (const el of (scalebar._ui.collapsedOnly || [])) {
            if (el) el.style.display = c ? "" : "none";
        }
        scalebar._applyDockLayout?.();
        // Cancel any in-flight hover-scale on the label.
        labelEl.style.transform = "";
        labelEl.style.position = "";
        labelEl.style.zIndex = "";
        // Collapsed mode hides everything except the chevron + SYNC.
        labelEl.style.display = c ? "none" : "";
        updateResetVisibility();
        if (c) {
            // The header flows as a normal child of the container so the
            // container collapses to the header's natural height. The
            // scalebar's refreshHandler then drops it just above the bar.
            header.style.position = "relative";
            header.style.left = "";
            header.style.top = "";
            header.style.right = "";
            magnificationContainer.classList.remove("pt-2", "bg-base-200", "rounded-lg", "items-stretch");
            magnificationContainer.classList.add("items-center");
            magnificationContainer.style.height = "auto";
            magnificationContainer.style.background = "transparent";
            toggle.title = window.$.t('main.scalebar.expand');
            toggle.firstChild.textContent = "▴";
        } else {
            // Expanded: header floats above the panel top-edge again.
            header.style.position = "absolute";
            header.style.left = "-10px";
            header.style.top = "-15px";
            header.style.right = "-10px";
            magnificationContainer.classList.add("pt-2", "bg-base-200", "rounded-lg", "items-stretch");
            magnificationContainer.classList.remove("items-center");
            magnificationContainer.style.height = `${scalebar.magnificationContainerHeight}px`;
            magnificationContainer.style.background = "";
            toggle.title = window.$.t('main.scalebar.minimize');
            toggle.firstChild.textContent = "▾";
        }
        // The quick-zoom pass skips itself while expanded and only reruns on a
        // rendered frame; an idle viewer would otherwise show a stale row until
        // the user moves.
        scalebar._ui.onZoomQuick?.();
        scalebar.refreshHandler?.();
    };

    toggle.addEventListener("click", () => {
        scalebar._ui.collapsed = !scalebar._ui.collapsed;
        // User preference, not a security decision (§7) — AppCache is right.
        window.APPLICATION_CONTEXT?.AppCache?.set?.(COLLAPSED_CACHE_KEY, scalebar._ui.collapsed);
        scalebar._applyCollapsed();
    });

    // Always apply: expanded state must still hide the quick-zoom row and put
    // the dock into column layout.
    scalebar._applyCollapsed();
}

export { addQuickZoomChrome, addSyncMenuChrome };
