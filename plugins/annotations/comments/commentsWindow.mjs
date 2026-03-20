/**
 * Build the floating comments window body for the annotations plugin.
 * Uses DOM/van nodes instead of handwritten HTML strings.
 * @param {AnnotationsGUI} plugin
 * @returns {UIElement}
 */
export function createCommentsWindow(plugin) {
  const UI = globalThis.UI;
  const { div, textarea, button, i } = globalThis.van.tags;

  const body = div(
    {
      class: 'w-full h-full relative flex flex-col'
    },
    div({
      id: 'comments-list',
      class: 'flex-1 overflow-y-auto space-y-3 p-2'
    }),
    div(
      {
        id: 'comments-input-section',
        class: 'pt-3',
        style: 'border-top: 1px solid var(--color-border-secondary);'
      },
      div(
        { class: 'flex gap-2' },
        textarea({
          id: 'comment-input',
          rows: '2',
          disabled: !plugin.user,
          placeholder: plugin.t('annotations.comments.inputPlaceholder'),
          class: 'resize-none flex-1 px-3 py-2 text-sm border-[1px] border-[var(--color-border-secondary)] rounded-md focus:outline-none focus:border-[var(--color-border-info)]',
          style: 'background: var(--color-bg-primary); color: var(--color-text-primary);',
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
            class: 'px-3 py-2 btn btn-pointer',
            style: 'font-size: 22px;',
            onclick: () => plugin._addComment(),
            title: plugin.t('annotations.comments.send')
          },
          i({ class: 'fa-auto fa-paper-plane' })
        )
      )
    )
  );

  return new UI.FloatingWindow(
    {
      id: 'annotation-comments-menu',
      title: plugin.t('annotations.comments.title'),
      closable: false,
      onClose: () => {
        plugin.commentsToggleWindow(false);
      }
    },
    body
  );
}

/**
 * Apply the temporary styling/behavior tweaks required by the current FloatingWindow implementation.
 * @param {AnnotationsGUI} plugin
 */
export function finalizeCommentsWindowMount(plugin) {
  const commentsMenu = document.getElementById('annotation-comments-menu');
  if (!commentsMenu) return;

  const commentsBody = commentsMenu.querySelector('.card-body > div');
  if (commentsBody) {
    commentsBody.style.width = '100%';
    commentsBody.style.height = '100%';
    commentsBody.style.position = 'relative';
    commentsBody.style.display = 'flex';
    commentsBody.style.flexDirection = 'column';
  }

  const commentsResize = commentsMenu.querySelector('.cursor-se-resize');
  if (commentsResize) {
    commentsResize.style.borderColor = 'var(--color-text-primary)';
  }

  commentsMenu.style.display = 'none';
  commentsMenu.classList.add(
    'flex-col',
    'shadow-lg',
    'rounded-lg',
    'border',
    'overflow-hidden',
    'bg-[var(--color-bg-primary)]'
  );
  commentsMenu.style.borderColor = 'var(--color-border-primary)';
  commentsMenu.style.minWidth = '320px';
  commentsMenu.style.minHeight = '370px';
}
