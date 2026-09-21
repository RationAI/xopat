/**
 * Makes children in a parent draggable. These children might contain other elements you want to
 * prevent the dragging on: such children need 'non-draggable' class
 * (at least one between the dragged item and the child in hierarchy)
 * @param {string|Node} parentContainerId parent ID that keeps elements for which dragging will be enabled
 * @param onEnabled called for each child upon initialization, the element node is passed as argument
 * @param onStartDrag called before the dragging starts, the param is the event of the drag,
 *    returns true if the dragging should really start, false if not
 * @param onEndDrag called when the element is dropped at some position, the param is the event of the drag
 *    the dom node that triggered the change: event.target
 * @return function to call for any other elements manually, note! these should be also direct children of
 *    parentContainerId (i.e. adding more dynamically later).
 *  note: use 'non-draggable' on inner content to prevent it from triggering the dragging
 *  note: dragged item is always assigned 'drag-sort-active' class
 *  note: events are attached to DOM tree, not the structure
 *        - content changes in DOM involving your nodes destroys events;
 *  hint: use node.dataset.<> API to store and retrieve values within items
 */
export function draggable(parentContainerId, onEnabled=undefined, onStartDrag=undefined, onEndDrag=undefined) {
    const children = typeof parentContainerId === "string" ?
        document.getElementById(parentContainerId)?.children : parentContainerId.children;
    if (!children) throw "Actions::draggable needs valid parent ID to access an element in DOM!";
    Array.prototype.forEach.call(children, (item) => {enableDragItem(item)});

    function enableDragItem(item) {
        const isPrevented = (element, cls) => {
            let currentElem = element;
            let isParent = false;

            while (currentElem) {
                const hasClass = Array.from(currentElem.classList).some(elem => {return cls === elem;});
                if (hasClass) {
                    isParent = true;
                    currentElem = undefined;
                } else {
                    currentElem = currentElem.parentElement;
                }
            }
            return isParent;
        };
        item.setAttribute('draggable', true);
        item.ondragstart = typeof onStartDrag === "function" ? e => {
            if (!onStartDrag(e) || isPrevented(document.elementFromPoint(e.x, e.y), 'non-draggable')) {
                e.preventDefault();
            }
        } : e => {
            if (isPrevented(document.elementFromPoint(e.x, e.y), 'non-draggable')) e.preventDefault();
        };
        item.ondrag = (item) => {
            const selectedItem = item.target,
                list = selectedItem.parentNode,
                x = event.clientX,
                y = event.clientY;

            selectedItem.classList.add('drag-sort-active');
            let swapItem = document.elementFromPoint(x, y) === null ? selectedItem : document.elementFromPoint(x, y);

            if (list === swapItem.parentNode) {
                swapItem = swapItem !== selectedItem.nextSibling ? swapItem : swapItem.nextSibling;
                list.insertBefore(selectedItem, swapItem);
            }
        };
        item.ondragend = typeof onEndDrag === "function" ? item => {
            item.target.classList.remove('drag-sort-active');
            onEndDrag(item);
        } : item => {
            item.target.classList.remove('drag-sort-active');
        };
        typeof onEnabled === "function" && onEnabled(item);
    }
    return enableDragItem;
}

/**
 * Resolution of the per-viewer right-side menu's config-driven preferences.
 *
 * A leaf module on purpose: these are pure `APPLICATION_CONTEXT` reads with no
 * DOM and no component dependencies, so both the menu and the Settings panel
 * can share them — and a unit test can import them without pulling the whole
 * Van.js component graph.
 *
 * Neither value goes through `getUiOption`: that helper is boolean-only and
 * defaults every unset flag to `true`, which is wrong for a flag defaulting to
 * `false` and impossible for a per-tab map.
 */

/**
 * Compact side-menu preference: icon-only tab strips whose sideways title
 * reveals on hover. Precedence mirrors `getUiOption`: explicit session param >
 * cached user toggle (Settings checkbox, persisted by `setUiOption`) >
 * deployment default > `false`.
 * @returns {boolean}
 */
export function resolveSideMenuCompact() {
    const readUi = (source) => {
        const ui = source?.ui;
        if (ui && typeof ui === "object" && ui.sideMenuCompact !== undefined && ui.sideMenuCompact !== null) {
            return !!ui.sideMenuCompact;
        }
        return undefined;
    };
    const fromParams = readUi(APPLICATION_CONTEXT.config?.params);
    if (fromParams !== undefined) return fromParams;
    const cached = APPLICATION_CONTEXT.AppCache?.get("sideMenuCompact");
    if (cached !== undefined && cached !== null) return cached === true || cached === "true";
    const fromDefaults = readUi(APPLICATION_CONTEXT.config?.defaultParams);
    if (fromDefaults !== undefined) return fromDefaults;
    return false;
}

/**
 * Initial open/closed state of one side-menu tab.
 *
 * `ui.sideMenuTabs` is either a boolean (applies to every tab) or a map of tab
 * id → boolean, where `"*"` covers tabs the map does not name — e.g.
 * `{"*": false, "navigator": true}` boots with only the navigator open.
 *
 * Precedence mirrors {@link resolveSideMenuCompact}: explicit session param >
 * the user's cached `<tabId>-open` toggle > deployment default > open. The
 * cached toggle outranking the deployment default is deliberate: a panel the
 * user opened stays open across reloads. A deployment that needs the boot state
 * deterministic for returning users sets it in the session `params.ui`.
 *
 * @param {string} tabId
 * @returns {boolean}
 */
export function resolveSideMenuTabOpen(tabId) {
    const readUi = (source) => {
        const value = source?.ui?.sideMenuTabs;
        if (value === undefined || value === null) return undefined;
        if (typeof value === "object" && !Array.isArray(value)) {
            const own = value[tabId];
            if (own !== undefined && own !== null) return !!own;
            const fallback = value["*"];
            return fallback === undefined || fallback === null ? undefined : !!fallback;
        }
        return !!value;
    };
    const fromParams = readUi(APPLICATION_CONTEXT.config?.params);
    if (fromParams !== undefined) return fromParams;
    const cached = APPLICATION_CONTEXT.AppCache?.get(`${tabId}-open`);
    if (cached !== undefined && cached !== null) return cached === true || cached === "true";
    const fromDefaults = readUi(APPLICATION_CONTEXT.config?.defaultParams);
    if (fromDefaults !== undefined) return fromDefaults;
    return true;
}