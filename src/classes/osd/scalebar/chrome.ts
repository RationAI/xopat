// @ts-nocheck -- mechanical port of the former `src/external/scalebar.js`.
// Split out of the single 3388-line IIFE and moved into the core TS build so
// esbuild inlines it into `dist/app.js` instead of shipping it as a separate
// startup <script>. Bodies are unchanged JS; typing them is deliberate
// follow-up work and must not be mixed into a behaviour-identical move.

import { QUICK_ZOOM_MIN_MAGNIFICATION, COLLAPSED_CACHE_KEY } from "./constants";

/**
 * Reactive "how many viewports are open", shared by every viewer's chrome.
 *
 * One subscription for the whole app, not one per button: the chrome is rebuilt
 * per scalebar and per-button handlers on the manager would accumulate.
 */
let _viewerCountState = null;
function openViewerCount() {
    if (!_viewerCountState) {
        const read = () => VIEWER_MANAGER?.viewers?.length || 0;
        _viewerCountState = van.state(read());
        const refresh = () => { _viewerCountState.val = read(); };
        VIEWER_MANAGER?.addHandler?.("viewer-create", refresh);
        // `viewer-destroy` fires while the viewer is still in `viewers`
        // (see ViewerManager.delete) — read the count after the splice.
        VIEWER_MANAGER?.addHandler?.("viewer-destroy", () => queueMicrotask(refresh));
    }
    return _viewerCountState;
}

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

    const count = openViewerCount();
    const canSync = () => count.val > 1;

    /**
     * @param {"auto"|"manual"|null} mode  explicit link mode; `null` toggles
     *        (enabled → disable, otherwise link automatically).
     */
    const run = async (mode) => {
        if (!tool) return;

        if (busy.val) {
            // Mid-calibration click: abort the point picker and fall back to
            // LINK as if nothing happened. The rejected `enable()` promise is
            // handled by the catch below, which resets `enabled`/progress.
            tool.cancelCalibration?.();
            return;
        }

        if (!canSync()) {
            // The button is `disabled`, but the menu and the keyboard can
            // still reach this — say why rather than doing nothing.
            Dialogs?.show?.(window.$.t('sync.needsTwoSlides'));
            return;
        }
        setBusy(true);

        try {
            if (!mode && enabled.val) {
                tool.disable();
                enabled.val = false;
                setProgress("");
                Dialogs?.show?.(window.$.t('sync.disabled'), 1200, Dialogs.MSG_INFO);
            } else {
                // Default is automatic registration; the caret menu (and the
                // legacy Alt/Shift-click) force the three-point picker for
                // slides the estimator cannot match. `enable()` may upgrade
                // auto to manual on its own (a viewer the user just cleared),
                // so it owns the progress label.
                setProgress("");
                if (mode === "manual") tool.resetViewer?.();
                const res = await tool.enable({ mode: mode === "manual" ? "manual" : "auto" });
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

    // Alt/Shift-click stays as an expert shortcut for the manual picker; the
    // caret menu next to the button is the discoverable route to the same thing.
    const onClick = (ev) => run((ev?.shiftKey || ev?.altKey) ? "manual" : null);

    viewer.__syncToolChanged = updateFromTool;
    // The caret menu beside this button drives the same logic with an explicit
    // mode. Exposed on the viewer alongside `__syncToolChanged`, which is how
    // the rest of this chrome already reaches back into the button's closure.
    viewer.__syncRun = run;

    return van.tags.button(
        {
            // `join-item` belongs in the reactive literal: this binding re-runs
            // on every state change and rewrites `class` wholesale, so a class
            // added imperatively afterwards survives only until the first
            // link/unlink — which is what left the button rounded on one side
            // and square on the other.
            class: () => [
                "btn btn-xs join-item border-none px-1 xo-btn-inert",
                !canSync() ? "" :
                    (enabled.val ? (isRef.val ? "btn-primary" : "btn-success") : "")
            ].join(" "),
            // Presented as inert rather than hidden: a control that disappears
            // is worse than one that explains itself (see UPSTREAM_UI.md §0.8).
            disabled: () => !canSync(),
            onclick: onClick,
            title: () => (!canSync()
                ? window.$.t('sync.needsTwoSlides')
                : (busy.val
                    ? window.$.t('sync.cancelCalibration')
                    : (enabled.val ? window.$.t('sync.disableTitle') : window.$.t('sync.enableTitle'))))
        },
        // A text abbreviation rather than an icon: three states have to be told
        // apart at a glance. Resolved through `$.t` at render time, not as
        // literals — note that `sync.*` prose elsewhere quotes these tokens
        // ("Shift-click SYNC to calibrate by hand"), so a locale that renames
        // the button must rename them there too; they sit in the same block.
        van.tags.span({ class: "font-bold", style: "font-size:10px;line-height:1" },
            () => {
                if (busy.val) return window.$.t('sync.labelBusy');
                if (!enabled.val) return window.$.t('sync.labelLink');
                return isRef.val ? window.$.t('sync.labelRef') : window.$.t('sync.labelSync');
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
        node.alt = window.$.t('main.scalebar.slideLabelAlt');
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
 * rendered muted and italic (`DIGITAL_ZOOM_COLOR`) — that zoom is
 * interpolated, the detail is not in the data. Deliberately not the error
 * color: nothing is wrong, and red there read as a fault or as the active stop. Uncalibrated slides get the same row over zoom levels (L1..Ln).
 *
 * @param {OpenSeadragon.Scalebar} scalebar
 * @param {OpenSeadragon.Viewer} viewer
 * @param {HTMLElement} header the collapsed row this group belongs to
 * @param {HTMLElement} insertAfter sibling this group is placed behind
 */
/**
 * Text colour of a zoom stop beyond the slide's native magnification. Shared
 * with the expanded panel's slider track (`digitalZoomTrack`).
 */
const DIGITAL_ZOOM_COLOR = "oklch(var(--bc) / 0.55)";

/**
 * Slider-track background: solid up to `percentNative` (bottom-up), hatched
 * above it — the stretch where zoom is interpolated.
 * @param {string} solid CSS colour of the native range
 * @param {number} percentNative 0..100
 */
function digitalZoomTrack(solid, percentNative) {
    return `linear-gradient(to top, ${solid} 0 ${percentNative}%, transparent ${percentNative}% 100%), `
        + `repeating-linear-gradient(-45deg, ${DIGITAL_ZOOM_COLOR} 0 2px, oklch(var(--bc) / 0.12) 2px 4px)`;
}

/**
 * How far the zoom readout is pushed right of its column's centre, so it sits
 * over the slider *and* its pip labels rather than over the track alone. The
 * reset button between the two readouts offsets itself by half of this to
 * stay centred in the gap the shift opens.
 */
const ZOOM_READOUT_SHIFT_PX = 14;

/**
 * Wrap a readout `<input>` into the panel's shared value box and append its
 * unit, so every readout looks the same and says what it measures.
 * @param {HTMLInputElement} input
 * @param {string} unit short suffix ("°", "×"); empty for none
 * @param {number} inputWidth px
 * @return {HTMLElement} the box to insert where the input used to go
 */
function readoutField(input, unit, inputWidth) {
    const box = document.createElement("label");
    box.className = "flex flex-row items-center justify-center rounded-lg bg-base-100 shadow text-base-content font-bold";
    box.style.height = "24px";
    box.style.padding = "0 0.3rem";
    box.style.fontSize = "11px";
    box.style.cursor = "text";
    box.title = input.title;

    input.className = "font-bold";
    input.style.width = `${inputWidth}px`;
    input.style.height = "100%";
    input.style.padding = "0";
    input.style.border = "none";
    input.style.outline = "none";
    input.style.background = "transparent";
    input.style.color = "inherit";
    input.style.fontSize = "inherit";
    input.style.textAlign = unit ? "right" : "center";
    // A text field, not `type=number`: the browser's spin buttons appear on
    // hover, cover the value in a box this narrow, and cannot be switched off
    // without a stylesheet. Callers parse and clamp the value themselves.
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    box.appendChild(input);

    if (unit) {
        const suffix = document.createElement("span");
        suffix.textContent = unit;
        suffix.style.opacity = "0.6";
        suffix.style.paddingLeft = "1px";
        box.appendChild(suffix);
    }
    return box;
}

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
        button.className = "btn btn-xs join-item border-none px-1";
        if (isDigital) {
            button.style.color = DIGITAL_ZOOM_COLOR;
            button.style.fontStyle = "italic";
        }
        button.title = title;
        button.textContent = label;
        button.addEventListener("click", onClick);
        group.appendChild(button);
        return button;
    };

    const home = document.createElement("button");
    home.type = "button";
    home.className = "btn btn-xs join-item border-none px-1";
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
    // A theme token rather than `currentColor`: digital-zoom stops carry a
    // muted text colour, and their fill must not fade with it.
    // `backgroundImage` rather than `background` so the btn base colour and its
    // :hover state survive underneath.
    const FILL_TINT = "oklch(var(--bc) / 0.2)";
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
 * Mount the SYNC button, its mode menu, collapse toggle and slide-label
 * onto the magnification panel. The caller is responsible for pushing
 * the actual collapsible columns (`rotCol`, `magCol`) onto
 * `scalebar._ui.collapsibles` after they are constructed.
 */
function addSyncMenuChrome(scalebar, viewer, tool, magnificationContainer) {
    scalebar._ui.collapsibles = scalebar._ui.collapsibles || [];
    scalebar._ui.collapsedOnly = scalebar._ui.collapsedOnly || [];

    // The container itself is only a transparent stack of two independently
    // sized boxes: the slider panel (slim, as wide as its two sliders) and,
    // under it, the control strip (as wide as its buttons). Sharing one
    // background forced the panel to the strip's width. Pointer events are
    // taken by the boxes, not the stack, so the gap beside the narrower one
    // still reaches the canvas.
    magnificationContainer.classList.remove("bg-base-200", "rounded-lg", "pt-2", "items-stretch", "pointer-events-auto");
    magnificationContainer.style.height = "auto";
    magnificationContainer.style.pointerEvents = "none";
    magnificationContainer.style.gap = "0.25rem";

    // Slider panel: [rotation] [reset] [zoom]. The scalebar inserts its two
    // slider columns around `resetCol`.
    const slidersBox = document.createElement("div");
    slidersBox.className = "relative flex flex-row items-stretch bg-base-200 rounded-lg pt-2 pointer-events-auto";
    slidersBox.style.height = `${scalebar.magnificationContainerHeight}px`;
    magnificationContainer.appendChild(slidersBox);
    scalebar._ui.slidersBox = slidersBox;
    scalebar._ui.collapsibles.push(slidersBox);

    const resetCol = document.createElement("div");
    resetCol.className = "flex flex-col items-center";
    resetCol.style.paddingLeft = `${ZOOM_READOUT_SHIFT_PX / 2}px`;
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "btn btn-xs btn-ghost border-none px-1";
    reset.style.height = "24px";
    reset.style.minHeight = "24px";
    reset.title = window.$.t('main.scalebar.resetView');
    reset.setAttribute("aria-label", reset.title);
    reset.innerHTML = '<i class="ph-light ph-arrow-counter-clockwise" style="font-size:12px;line-height:1"></i>';
    reset.addEventListener("click", () => {
        viewer.viewport.setRotation(0);
        viewer.viewport.goHome();
    });
    resetCol.appendChild(reset);
    slidersBox.appendChild(resetCol);
    scalebar._ui.resetCol = resetCol;

    // Single inline strip under the slider panel:
    // [▾] [SYNC|menu] [viewer controls] [LABEL]. A flow child in both panel
    // states, so the controls stay put when the panel collapses onto them.
    const header = document.createElement("div");
    header.className = "relative flex flex-row items-center gap-2 pointer-events-auto";
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
    toggle.style.paddingLeft = "0.25rem";
    toggle.style.paddingRight = "0.25rem";
    toggle.style.minWidth = "0";
    toggle.title = window.$.t('main.scalebar.minimize');
    toggle.innerHTML = '<span class="font-bold" style="font-size:10px;line-height:1">▾</span>';
    header.appendChild(toggle);

    // 2) SYNC button + its clear affordance, joined into one control so the
    // pair reads as a unit rather than two floating buttons.
    const syncGroup = document.createElement("div");
    syncGroup.className = "join";
    header.appendChild(syncGroup);

    // `join-item` is part of the button's own reactive class list — adding it
    // here would be wiped by the next state change.
    const sync = SyncToggleButton(viewer, tool);
    syncGroup.appendChild(sync);

    // Does this viewer hold a calibration? Read the session directly:
    // `_getViewerTransform` would lazily create one just to render chrome.
    const hasAlignment = () => !!tool?.constructor?._session?.transforms?.[viewer.uniqueId];

    const clearAlignment = () => {
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
        }
    };

    // 3) Mode menu. The link mode used to be reachable only by Alt/Shift-
    // clicking SYNC — an invisible affordance nobody finds. The caret makes it
    // a control, and absorbs the clear-alignment eraser that previously
    // appeared and vanished beside the button depending on session state.
    const syncMenu = document.createElement("button");
    syncMenu.type = "button";
    syncMenu.className = "btn btn-xs join-item border-none";
    syncMenu.style.paddingLeft = "0.125rem";
    syncMenu.style.paddingRight = "0.125rem";
    syncMenu.style.minWidth = "0";
    syncMenu.title = window.$.t('sync.menuTitle');
    syncMenu.innerHTML = '<i class="ph-light ph-caret-down" style="font-size:10px;line-height:1"></i>';

    const openSyncMenu = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const linkable = (VIEWER_MANAGER?.viewers?.length || 0) > 1;
        UI?.ContextMenu?.open?.(ev, [
            {
                title: window.$.t('sync.menuAuto'),
                icon: "ph-magic-wand",
                disabled: !linkable,
                action: () => viewer.__syncRun?.("auto"),
            },
            {
                title: window.$.t('sync.menuManual'),
                icon: "ph-cursor-click",
                disabled: !linkable,
                action: () => viewer.__syncRun?.("manual"),
            },
            { title: "" },
            {
                title: window.$.t('sync.menuClear'),
                icon: "ph-eraser",
                disabled: !hasAlignment(),
                action: clearAlignment,
            },
        ]);
    };
    syncMenu.addEventListener("click", openSyncMenu);
    // Right-click opens the same menu from the button itself — the only route
    // to it while the panel is collapsed and the caret is hidden. A disabled
    // button (single viewer) dispatches no `contextmenu`; nothing to link then.
    sync.addEventListener("contextmenu", openSyncMenu);
    syncMenu.addEventListener("contextmenu", openSyncMenu);
    // Shown in both panel states: it is the only visible route to the menu,
    // and the SYNC button's `join` rounding needs its right-hand sibling.
    syncGroup.appendChild(syncMenu);

    // 4) Label thumbnail — pushed to the right with margin-left:auto.
    const LABEL_BOX = { width: "56px", height: "26px" };
    const LABEL_SCALE_HOVER = 4.5;
    const LABEL_SCALE_HOVER_COLLAPSED = 6;

    const labelEl = document.createElement("div");
    labelEl.className = "rounded-md bg-base-200 overflow-hidden flex items-center justify-center cursor-zoom-in";
    labelEl.tabIndex = 0;
    labelEl.setAttribute("role", "button");
    labelEl.style.width = LABEL_BOX.width;
    labelEl.style.height = LABEL_BOX.height;
    labelEl.style.flex = "0 0 auto";
    // Grow right + up on hover: the strip sits at the bottom of the panel in
    // both states, below it is the metric bar; the free space is the canvas
    // above and beside.
    labelEl.style.transformOrigin = "left bottom";
    labelEl.style.transition = "transform 0.18s ease";
    labelEl.style.display = "none";
    labelEl.title = window.$.t('main.scalebar.slideLabel');
    header.appendChild(labelEl);
    scalebar._ui.labelEl = labelEl;

    /**
     * Always its own element at the end of the strip — welded onto the SYNC
     * button it read as part of that button. Collapsed the strip is a single
     * row and a 56px label pushes the quick-zoom stops off the edge, so there
     * it shrinks to a square; the full label is one hover or click away.
     */
    const placeLabel = () => {
        const c = !!scalebar._ui.collapsed;
        labelEl.style.width = c ? LABEL_BOX.height : LABEL_BOX.width;
        // A dashed "no label" box is pure noise in a one-row strip.
        labelEl.style.display = (c ? scalebar._ui.hasLabel : scalebar._ui.labelReady) ? "" : "none";
    };
    scalebar._ui.placeLabel = placeLabel;

    // Click pins the label at a readable size (hover alone vanishes the moment
    // the pointer drifts). Built per open from whatever is rendered now: the
    // source may hand back a live node, which can only sit in one place.
    const labelCopy = () => {
        const shown = labelEl.firstElementChild;
        let copy = null;
        if (shown?.tagName === "IMG") {
            copy = document.createElement("img");
            copy.src = shown.src;
            copy.alt = shown.alt;
        } else if (shown?.tagName === "CANVAS") {
            copy = document.createElement("canvas");
            copy.width = shown.width;
            copy.height = shown.height;
            copy.getContext("2d")?.drawImage(shown, 0, 0);
        }
        if (!copy) return null;
        copy.style.display = "block";
        copy.style.maxWidth = "min(480px, 80vw)";
        copy.style.maxHeight = "min(360px, 60vh)";
        copy.style.minWidth = "200px";
        copy.style.objectFit = "contain";
        return copy;
    };
    const closeLabelPopover = () => {
        const popover = scalebar._ui.labelPopover;
        scalebar._ui.labelPopover = null;
        popover?.destroy?.();
    };
    scalebar._ui.closeLabelPopover = closeLabelPopover;
    const toggleLabelPopover = () => {
        if (scalebar._ui.labelPopover) { closeLabelPopover(); return; }
        if (!scalebar._ui.hasLabel || !UI?.Popover) return;
        const copy = labelCopy();
        if (!copy) return;
        labelEl.style.transform = "";
        const popover = new UI.Popover({
            anchor: () => labelEl,
            trigger: labelEl,
            placement: "right",
            onClose: () => {
                if (scalebar._ui.labelPopover === popover) closeLabelPopover();
            },
        }, copy);
        scalebar._ui.labelPopover = popover;
        if (!popover.open()) closeLabelPopover();
    };
    labelEl.addEventListener("click", toggleLabelPopover);
    labelEl.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        toggleLabelPopover();
    });

    labelEl.addEventListener("mouseenter", () => {
        if (labelEl.style.pointerEvents === "none" || scalebar._ui.labelPopover) return;
        labelEl.style.transform = `scale(${scalebar._ui.collapsed
            ? LABEL_SCALE_HOVER_COLLAPSED : LABEL_SCALE_HOVER})`;
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
        scalebar._ui.hasLabel = false;
        scalebar._ui.labelReady = true;
        placeLabel();
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
            scalebar._ui.hasLabel = true;
            scalebar._ui.labelReady = true;
            placeLabel();
            scalebar.refreshHandler?.();
        }).catch(() => { showLabelPlaceholder(); });
    } else {
        showLabelPlaceholder();
    }

    scalebar._ui.collapsed = !!scalebar._ui.collapsed;

    // Quick-zoom row: the collapsed panel's reason to exist. Built after the
    // chrome above so it lands between the SYNC group and the slide label.
    const quickZoom = addQuickZoomChrome(scalebar, viewer, header, syncGroup);

    // Slot for `USER_INTERFACE.ViewerControls` (e.g. slide-info's prev/next
    // arrows); the service owns its content. In neither collapsibles nor
    // collapsedOnly: the controls stay visible in both panel states.
    const controlsSlot = document.createElement("div");
    header.insertBefore(controlsSlot, quickZoom.nextSibling);
    scalebar._ui.unmountControls = window.USER_INTERFACE?.ViewerControls?.mount(controlsSlot, viewer);

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
        closeLabelPopover();
        labelEl.style.transform = "";
        labelEl.style.position = "";
        labelEl.style.zIndex = "";
        // Collapsed mode hides everything except the chevron + SYNC + label.
        placeLabel();
        // Collapsed only the strip is left (the slider panel is a
        // collapsible); expanded the panel stacks above it, each at its own
        // width, left edges aligned.
        // Classes and inline both: the same pair of utilities the dock
        // toggles, with the inline value as the tie-breaker against whatever
        // the container was created with.
        magnificationContainer.classList.toggle("flex-row", c);
        magnificationContainer.classList.toggle("items-center", c);
        magnificationContainer.classList.toggle("flex-col", !c);
        magnificationContainer.classList.toggle("items-start", !c);
        magnificationContainer.style.display = "flex";
        magnificationContainer.style.flexDirection = c ? "row" : "column";
        magnificationContainer.style.alignItems = c ? "center" : "flex-start";
        // The strip is the second box of the stack, under the slider panel.
        slidersBox.style.order = "0";
        header.style.order = "1";
        toggle.title = window.$.t(c ? 'main.scalebar.expand' : 'main.scalebar.minimize');
        toggle.firstChild.textContent = c ? "▴" : "▾";
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

export { addQuickZoomChrome, addSyncMenuChrome, digitalZoomTrack, readoutField, ZOOM_READOUT_SHIFT_PX };
