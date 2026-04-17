/**
 * Build the floating comments window body for the annotations plugin.
 * @param {AnnotationsGUI} plugin
 * @returns {UIElement}
 */
export function createCommentsWindow(plugin) {
    const UI = globalThis.UI;
    const { div, textarea, button, i } = globalThis.van.tags;

    const body = div(
        { class: 'w-full h-full relative flex flex-col bg-base-100' },
        // Scrollable List Area
        div({
            id: 'comments-list',
            class: 'flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar'
        }),
        div(
            {
                id: 'comments-input-section',
                class: 'p-3 bg-base-200/50 border-t border-base-300'
            },
            div(
                { class: 'flex items-end gap-2 bg-base-100 p-2 rounded-xl border border-base-300 shadow-sm focus-within:border-primary transition-colors' },
                textarea({
                    id: 'comment-input',
                    rows: '1',
                    disabled: !plugin.user,
                    placeholder: plugin.t('annotations.comments.inputPlaceholder'),
                    class: 'textarea textarea-ghost flex-1 min-h-0 h-10 py-2 leading-tight focus:bg-transparent resize-none text-sm focus:outline-none',
                    onkeydown: (event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            plugin._addComment();
                        }
                    }
                }),
                button(
                    {
                        type: 'button',
                        class: 'btn btn-primary btn-sm btn-square h-10 w-10 min-h-0',
                        onclick: () => plugin._addComment(),
                        title: plugin.t('annotations.comments.send')
                    },
                    i({ class: 'fa-solid fa-paper-plane' })
                )
            )
        )
    );

    return new UI.FloatingWindow(
        {
            id: 'annotation-comments-menu',
            title: plugin.t('annotations.comments.title'),
            closable: false,
            onClose: () => plugin.commentsToggleWindow(false)
        },
        body
    );
}

export function finalizeCommentsWindowMount(plugin) {
    const menu = document.getElementById('annotation-comments-menu');
    if (!menu) return;

    // CRITICAL: Force display none so it's hidden on app load
    menu.style.display = 'none';

    // DaisyUI Window styling
    menu.classList.add('shadow-2xl', 'rounded-2xl', 'border', 'border-base-300', 'overflow-hidden', 'bg-base-100');
    menu.style.minWidth = '340px';
    menu.style.minHeight = '420px';

    const header = menu.querySelector('.card-header');
    if (header) {
        header.className = 'flex items-center justify-between px-4 py-2 bg-base-200/50 border-b border-base-300 text-[10px] font-bold uppercase tracking-widest opacity-50';
    }

    // Handle the bottom resize handle
    const resizer = menu.querySelector('.cursor-se-resize');
    if (resizer) resizer.className = 'absolute bottom-1 right-1 w-4 h-4 opacity-20 hover:opacity-100 cursor-se-resize';
}