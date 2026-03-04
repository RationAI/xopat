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