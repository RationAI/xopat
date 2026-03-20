function createRemovedPlaceholder(commentId) {
  const removedEl = document.createElement('div');
  removedEl.className = 'rounded-lg p-3 border-l-4';
  removedEl.style.background = 'var(--color-bg-canvas-inset)';
  removedEl.style.borderLeftColor = '#888';
  removedEl.style.color = '#888';
  removedEl.style.fontStyle = 'italic';
  removedEl.textContent = '[removed]';
  removedEl.dataset.commentId = commentId;
  return removedEl;
}

export const commentMethods = {
  enableComments(enabled) {
    if (this._commentsEnabled === enabled) return;
    this._commentsEnabled = enabled;
    this.context.commentsEnabled = enabled;
    this.setOption('commentsEnabled', enabled);
    if (!enabled) {
      this.commentsToggleWindow(false, true);
    } else if (this._selectedAnnot) {
      this.commentsToggleWindow(true, true);
    }
    this.context.fabric.rerender();
  },

  commentsDefaultOpen(enabled) {
    if (this._commentsDefaultOpened === enabled) return;
    this._commentsDefaultOpened = enabled;
    this.setOption('commentsDefaultOpened', enabled);
  },

  switchCommentsClosedMethod(method) {
    if (this._commentsClosedMethod === method) return;
    this._commentsClosedMethod = method;
    this.setOption('commentsClosedMethod', method);
  },

  _getCommentOpenedCache(objectId) {
    const cacheRaw = this.cache.get('comments-opened-states');
    if (!cacheRaw) {
      this.cache.set('comments-opened-states', '{}');
      return undefined;
    }
    return JSON.parse(cacheRaw)[objectId];
  },

  _setCommentOpenedCache(objectId, opened) {
    const cacheRaw = this.cache.get('comments-opened-states');
    if (!cacheRaw) {
      this.cache.set('comments-opened-states', JSON.stringify({ objectId: opened }));
      return;
    }
    const cache = JSON.parse(cacheRaw);
    cache[objectId] = opened;
    this.cache.set('comments-opened-states', JSON.stringify(cache));
  },

  _shouldOpenComments(objectId) {
    if (!this._commentsEnabled) return false;
    if (this._commentsClosedMethod === 'none') return true;
    if (this._commentsClosedMethod === 'global') return this._commentsOpened;
    const shouldOpen = this._getCommentOpenedCache(objectId);
    if (shouldOpen === undefined) return this._commentsDefaultOpened;
    return shouldOpen;
  },

  _addComment() {
    if (!this._selectedAnnot || !this.user) return;
    const input = document.getElementById('comment-input');
    const commentText = input?.value?.trim();
    if (!commentText) return;

    const comment = {
      id: crypto.randomUUID(),
      author: {
        id: this.user.id,
        name: this.user.name
      },
      content: commentText,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      removed: false
    };

    this.context.fabric.canvas.requestRenderAll();
    this._renderSingleComment(comment);
    input.value = '';
    this.context.fabric.addComment(this._selectedAnnot, comment);

    const commentsList = document.getElementById('comments-list');
    if (commentsList) commentsList.scrollTop = commentsList.scrollHeight;
  },

  getColorForUser(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      const char = username.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash &= hash;
    }
    const positiveHash = Math.abs(hash);
    const hue = positiveHash % 360;
    return `hsl(${hue}, 65%, 45%)`;
  },

  _clearComments() {
    const commentsList = document.getElementById('comments-list');
    if (commentsList) commentsList.replaceChildren();
  },

  _renderComments() {
    const comments = this._selectedAnnot?.comments;
    const commentsList = document.getElementById('comments-list');
    if (!commentsList) return;

    this._clearComments();
    if (!comments || comments.filter((c) => !c.removed).length === 0) {
      const empty = document.createElement('div');
      empty.id = 'comments-list-empty';
      empty.className = 'rounded-md flex items-center justify-center gap-2 w-full h-full select-none';
      empty.style.background = 'var(--color-bg-canvas-inset)';
      empty.style.padding = '15px';

      const icon = document.createElement('i');
      icon.className = 'fa-auto fa-comment text-4xl';
      icon.style.color = 'var(--color-text-tertiary)';

      const text = document.createElement('p');
      text.className = 'text-sm';
      text.style.color = 'var(--color-text-tertiary)';
      text.textContent = this.t('annotations.comments.empty');

      empty.append(icon, text);
      commentsList.appendChild(empty);
      return;
    }

    const roots = [];
    const replies = [];
    comments.forEach((comment) => {
      if (!comment.replyTo) roots.push(comment);
      else if (!comment.removed) replies.push(comment);
    });

    roots.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    replies.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const rootMap = new Map(roots.filter((c) => !c.removed).map((c) => [c.id, c]));
    const renderedRemoved = new Set();

    roots.forEach((root) => {
      const rootReplies = replies.filter((reply) => reply.replyTo === root.id);
      if (root.removed && rootReplies.length) {
        this._renderSingleComment(root, null, true);
      } else if (!root.removed) {
        this._renderSingleComment(root);
      }
      rootReplies.forEach((reply) => this._renderSingleComment(reply, root.id));
    });

    const orphanGroups = {};
    replies.filter((reply) => !rootMap.has(reply.replyTo)).forEach((orphan) => {
      if (!orphanGroups[orphan.replyTo]) orphanGroups[orphan.replyTo] = [];
      orphanGroups[orphan.replyTo].push(orphan);
    });

    Object.keys(orphanGroups).forEach((parentId) => {
      const alreadyRendered = roots.some((root) => root.id === parentId && root.removed);
      if (!renderedRemoved.has(parentId) && !alreadyRendered) {
        this._renderSingleComment({ id: parentId, removed: true }, null, true);
        renderedRemoved.add(parentId);
        orphanGroups[parentId]
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
          .forEach((orphan) => this._renderSingleComment(orphan, parentId));
      }
    });
  },

  _renderSingleComment(comment, parentId = null, isRemovedPlaceholder = false) {
    const commentsList = document.getElementById('comments-list');
    if (!commentsList) return;

    const noCommentsElement = document.getElementById('comments-list-empty');
    if (noCommentsElement) noCommentsElement.remove();

    if (isRemovedPlaceholder) {
      commentsList.appendChild(createRemovedPlaceholder(comment.id));
      return;
    }

    const element = document.createElement('div');
    element.className = 'rounded-lg p-3 border-l-4';
    element.style.background = 'var(--color-bg-canvas-inset)';
    element.style.borderLeftColor = this.getColorForUser(comment.author.name);
    element.dataset.commentId = comment.id;

    if (comment.replyTo) {
      element.style.marginLeft = '2em';
      element.dataset.replyTo = comment.replyTo;
    }

    const header = document.createElement('div');
    header.className = 'flex justify-between items-center mb-1';

    const author = document.createElement('span');
    author.className = 'font-medium text-sm';
    author.style.color = 'var(--color-text-primary)';
    author.textContent = comment.author.name;

    const actions = document.createElement('div');
    actions.className = 'flex items-center justify-center';

    const createdAt = new Date(comment.createdAt);
    const timestamp = document.createElement('span');
    timestamp.setAttribute('name', 'created-at');
    timestamp.className = 'text-xs mr-2';
    timestamp.style.color = 'var(--color-text-secondary)';
    timestamp.title = createdAt.toLocaleString();
    timestamp.textContent = this._formatTimeAgo(createdAt);

    actions.appendChild(timestamp);

    const isAuthor = this.user?.id === (this.context.mapAuthorCallback?.(comment.author.id) ?? comment.author.id);
    if (isAuthor) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'relative';
      deleteButton.title = this.t('annotations.comments.delete');
      deleteButton.dataset.confirmed = 'false';

      const icon = document.createElement('i');
      icon.className = 'fa-auto fa-trash btn-pointer';
      icon.style.fontSize = '21px';
      icon.style.color = 'var(--color-text-danger)';

      const hint = document.createElement('div');
      hint.className = 'delete-hint hidden right-[30px] top-1/2 -translate-y-1/2 px-2 py-1 rounded-md p-2 text-xs absolute whitespace-nowrap';
      hint.style.zIndex = '10';
      hint.style.background = 'var(--color-bg-canvas-inset)';
      hint.style.color = 'var(--color-text-danger)';
      hint.textContent = this.t('annotations.comments.confirmDelete');

      deleteButton.append(icon, hint);
      deleteButton.addEventListener('click', (event) => {
        const confirmed = event.currentTarget.dataset.confirmed === 'true';
        if (confirmed) {
          this._deleteComment(comment);
        } else {
          event.currentTarget.dataset.confirmed = 'true';
          hint.classList.remove('hidden');
        }
      });
      deleteButton.addEventListener('mouseleave', (event) => {
        event.currentTarget.dataset.confirmed = 'false';
        hint.classList.add('hidden');
      });
      actions.appendChild(deleteButton);
    }

    if (!comment.replyTo && this.user) {
      const replyButton = document.createElement('button');
      replyButton.type = 'button';
      replyButton.className = 'relative';
      replyButton.title = this.t('annotations.comments.reply');
      replyButton.dataset.reply = comment.id;

      const icon = document.createElement('i');
      icon.className = 'fa-auto fa-reply btn-pointer';
      icon.style.fontSize = '21px';
      icon.style.color = 'var(--color-text-secondary)';
      replyButton.appendChild(icon);

      replyButton.addEventListener('click', () => {
        if (element.querySelector('.reply-box')) return;

        const replyBox = document.createElement('div');
        replyBox.className = 'reply-box mt-2 flex flex-col gap-2';

        const textarea = document.createElement('textarea');
        textarea.className = 'resize-none flex-1 px-3 py-2 text-sm border-[1px] border-[var(--color-border-secondary)] rounded-md focus:outline-none focus:border-[var(--color-border-info)]';
        textarea.style.background = 'var(--color-bg-primary)';
        textarea.style.color = 'var(--color-text-primary)';
        textarea.rows = 2;
        textarea.placeholder = this.t('annotations.comments.replyPlaceholder');
        textarea.disabled = !this.user;

        const actionsRow = document.createElement('div');
        actionsRow.className = 'flex gap-2 justify-end';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'reply-cancel-btn btn px-2 py-1 rounded text-xs text-[var(--color-text-primary)] hover:text-black';
        cancel.textContent = this.t('common.cancel');
        cancel.addEventListener('click', () => replyBox.remove());

        const submit = document.createElement('button');
        submit.type = 'button';
        submit.className = 'reply-submit-btn btn btn-pointer px-2 py-1 rounded text-xs';
        submit.textContent = this.t('annotations.comments.reply');
        submit.addEventListener('click', () => {
          const text = textarea.value.trim();
          if (!text) return;
          this._addReplyComment(comment.id, text);
          replyBox.remove();
        });

        actionsRow.append(cancel, submit);
        replyBox.append(textarea, actionsRow);
        element.appendChild(replyBox);
      });

      actions.appendChild(replyButton);
    }

    header.append(author, actions);

    const body = document.createElement('p');
    body.className = 'text-sm';
    body.style.color = 'var(--color-text-secondary)';
    body.textContent = comment.content;

    element.append(header, body);

    if (parentId) {
      const parentEl = commentsList.querySelector(`[data-comment-id="${parentId}"]`);
      if (parentEl) {
        let targetNode = parentEl;
        let nextNode = targetNode.nextSibling;
        while (nextNode && nextNode.dataset && nextNode.dataset.replyTo === parentId) {
          targetNode = nextNode;
          nextNode = nextNode.nextSibling;
        }
        if (targetNode.nextSibling) commentsList.insertBefore(element, targetNode.nextSibling);
        else commentsList.appendChild(element);
      } else {
        commentsList.appendChild(element);
      }
    } else {
      commentsList.appendChild(element);
    }
  },

  _addReplyComment(parentId, text) {
    const id = crypto.randomUUID();
    const comment = {
      id,
      author: { id: this.user.id, name: this.user.name },
      content: text,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      replyTo: parentId,
      removed: false
    };
    if (!this._selectedAnnot.comments) this._selectedAnnot.comments = [];
    this.context.fabric.canvas.requestRenderAll();

    this.context.fabric.addComment(this._selectedAnnot, comment);
    this._renderSingleComment(comment, parentId);

    const addedComment = document.getElementById('comments-list')?.querySelector(`[data-comment-id="${id}"]`);
    if (addedComment) addedComment.scrollIntoView({ block: 'end' });
  },

  _formatTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return this.t('annotations.comments.time.justNow');
    if (diffMins < 60) return this.t('annotations.comments.time.minutesAgo', { count: diffMins });
    if (diffHours < 24) return this.t('annotations.comments.time.hoursAgo', { count: diffHours });
    if (diffDays < 7) return this.t('annotations.comments.time.daysAgo', { count: diffDays });
    if (diffDays < 30) return this.t('annotations.comments.time.weeksAgo', { count: Math.floor(diffDays / 7) });
    if (diffDays < 365) return this.t('annotations.comments.time.monthsAgo', { count: Math.floor(diffDays / 30) });
    return this.t('annotations.comments.time.yearsAgo', { count: Math.floor(diffDays / 365) });
  },

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  _deleteComment(comment) {
    const commentId = comment.id;
    this.context.fabric.deleteComment(this._selectedAnnot, commentId);
    const commentsList = document.getElementById('comments-list');
    if (!commentsList) return;

    const commentParent = this._selectedAnnot.comments.find((c) => c.id === comment.replyTo);
    const commentEl = commentsList.querySelector(`[data-comment-id="${commentId}"]`);
    const hasReplies = this._selectedAnnot.comments.some((c) => !c.removed && c.replyTo === commentId);
    const isParentRemoved = !commentParent || commentParent.removed;
    const hasSiblings = this._selectedAnnot.comments.some((c) => !c.removed && c.replyTo === comment.replyTo);

    const removeParentPlaceholder = comment.replyTo && !hasSiblings && isParentRemoved;
    if (removeParentPlaceholder) {
      const placeholder = commentsList.querySelector(`[data-comment-id="${comment.replyTo}"]`);
      if (placeholder) placeholder.remove();
    }

    if (commentEl) {
      if (hasReplies) commentEl.replaceWith(createRemovedPlaceholder(commentId));
      else commentEl.remove();
    }

    this.context.fabric.rerender();
    if (this._selectedAnnot.comments.filter((c) => !c.removed).length === 0) {
      this._clearComments();
      this._renderComments();
    }
  },

  commentsToggleWindow(enabled = undefined, stopPropagation = false) {
    const menu = document.getElementById('annotation-comments-menu');
    if (!menu) return;

    if (!this._commentsEnabled) {
      if (menu.style.display === 'flex') menu.style.display = 'none';
      return;
    }

    if (enabled === undefined) enabled = menu.style.display !== 'flex';
    menu.style.display = enabled ? 'flex' : 'none';
    if (!stopPropagation) {
      const objectId = this._selectedAnnot?.id ?? this._previousAnnotId;
      this._commentsOpened = enabled;
      this._setCommentOpenedCache(objectId, enabled);
    }
  },

  _annotationSelected(object) {
    this._selectedAnnot = object;
    this._renderComments(object.comments);
    this._startCommentsRefresh();

    if (this._shouldOpenComments(object.id)) {
      this.commentsToggleWindow(true, true);
    }
  },

  _annotationDeselected(object) {
    this._selectedAnnot = null;
    this._previousAnnotId = object.id;
    this.commentsToggleWindow(false, true);
    this._clearComments();
    this._stopCommentsRefresh();
  },

  _startCommentsRefresh() {
    this._stopCommentsRefresh();
    this._refreshCommentsInterval = setInterval(() => this._refreshCommentTimestamps(), 30000);
  },

  _stopCommentsRefresh() {
    if (this._refreshCommentsInterval) {
      clearInterval(this._refreshCommentsInterval);
      this._refreshCommentsInterval = null;
    }
  },

  _refreshCommentTimestamps() {
    if (!this._selectedAnnot || !this._selectedAnnot.comments) return;

    this._selectedAnnot.comments.forEach((comment) => {
      if (comment.removed) return;
      const commentElement = document.querySelector(`[data-comment-id="${comment.id}"]`);
      if (!commentElement) return;
      const timestampSpan = commentElement.querySelector('span[name="created-at"]');
      if (!timestampSpan) return;
      timestampSpan.textContent = this._formatTimeAgo(new Date(comment.createdAt));
    });
  }
};
