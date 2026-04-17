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

function renderEmptyState(plugin) {
    const { div, i, p } = globalThis.van.tags;
    const empty = div({
            id: 'comments-list-empty',
            class: 'h-full flex flex-col items-center justify-center opacity-30 text-center gap-2 p-8 select-none'
        },
        i({ class: 'fa-solid fa-comments text-5xl mb-2' }),
        p({ class: 'text-sm font-bold' }, plugin.t('annotations.comments.empty'))
    );
    return empty;
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

        // Use refactored Empty State
        if (!comments || comments.filter((c) => !c.removed).length === 0) {
            commentsList.appendChild(renderEmptyState(this));
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

        const noComments = document.getElementById('comments-list-empty');
        if (noComments) noComments.remove();

        const { div, span, button, i, p } = globalThis.van.tags;

        // Modern Removed Placeholder
        if (isRemovedPlaceholder) {
            const removed = div({
                class: 'text-xs italic opacity-40 px-4 py-2 border-l-2 border-base-300',
                dataset: { commentId: comment.id }
            }, '[removed]');
            commentsList.appendChild(removed);
            return;
        }

        const isAuthor = this.user?.id === (this.context.mapAuthorCallback?.(comment.author.id) ?? comment.author.id);
        const userColor = this.getColorForUser(comment.author.name);

        const element = div({
                class: `group relative flex flex-col gap-1 p-3 rounded-xl bg-base-200/40 hover:bg-base-200 transition-all border-l-4 ${comment.replyTo ? 'ml-8' : ''}`,
                style: `border-left-color: ${userColor};`,
                dataset: { commentId: comment.id, replyTo: comment.replyTo || '' }
            },
            // Header: Author & Time
            div({ class: 'flex justify-between items-center' },
                span({ class: 'text-xs font-bold text-primary truncate' }, comment.author.name),
                span({
                    class: 'text-[10px] opacity-40 uppercase font-mono',
                    name: 'created-at',
                    title: new Date(comment.createdAt).toLocaleString()
                }, this._formatTimeAgo(new Date(comment.createdAt)))
            ),
            // Content
            p({ class: 'text-sm leading-relaxed pr-6' }, comment.content),

            // Floating Actions (Visible on Hover)
            div({ class: 'absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity' },
                !comment.replyTo && this.user ? button({
                    class: 'btn btn-ghost btn-xs btn-square',
                    onclick: (e) => this._showReplyBox(e, comment.id),
                    title: this.t('annotations.comments.reply')
                }, i({ class: 'fa-solid fa-reply' })) : null,

                isAuthor ? button({
                    class: 'btn btn-ghost btn-xs btn-square text-error',
                    onclick: () => this._deleteComment(comment),
                    title: this.t('annotations.comments.delete')
                }, i({ class: 'fa-solid fa-trash' })) : null
            )
        );

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

    _showReplyBox(event, parentId) {
        const commentEl = event.currentTarget.closest('[data-comment-id]');
        if (commentEl.querySelector('.reply-box')) return;

        const { div, textarea, button } = globalThis.van.tags;

        const replyBox = div({ class: 'reply-box mt-3 flex flex-col gap-2 p-2 bg-base-100 rounded-lg border border-base-300 shadow-inner' },
            textarea({
                class: 'textarea textarea-bordered textarea-sm w-full focus:outline-none',
                placeholder: this.t('annotations.comments.replyPlaceholder'),
                rows: 2
            }),
            div({ class: 'flex justify-end gap-2' },
                button({ class: 'btn btn-ghost btn-xs', onclick: (e) => e.currentTarget.closest('.reply-box').remove() }, this.t('common.cancel')),
                button({
                    class: 'btn btn-primary btn-xs',
                    onclick: (e) => {
                        const text = e.currentTarget.closest('.reply-box').querySelector('textarea').value;
                        if (text.trim()) {
                            this._addReplyComment(parentId, text);
                            e.currentTarget.closest('.reply-box').remove();
                        }
                    }
                }, this.t('annotations.comments.reply'))
            )
        );
        commentEl.appendChild(replyBox);
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
