import {ChatProgress} from "./ChatProgress";

const { div, span, img, a, code, pre, button } = (globalThis as any).van.tags;

const SCRIPT_RESULT_PREVIEW_LIMIT = 600;

export interface ChatMessageListOptions {
    id?: string;
    markdownEnabled?: boolean;
    sanitizeConfig?: any;
    displayMode?: "all" | "user-friendly";
    extractScriptFromAssistantMessage?: (message: ChatMessage) => string | undefined;
    /**
     * Presentation transform for user-visible text — restores friendly slide names from the
     * opaque handles the LLM was given (viewer-identity anonymization). Identity by default.
     */
    presentText?: (text: string) => string;
}
// Region links (`[label](#xopat-region?...)`) are handled by the `markdown` module:
// it parses them out of the rendered markdown and dispatches clicks through its link
// registry, whose built-in `region` kind frames the referenced viewer. Chat only
// contributes a viewer resolver for its anonymization handles (see ChatModule).

export class ChatMessageList {
    options: ChatMessageListOptions;
    _root: HTMLElement | null;
    _messages: ChatMessage[];
    _displayMode: "all" | "user-friendly";
    /** The pending-turn bubble. Present only while a turn runs; owns its own state and timers. */
    _progress: ChatProgress | null;
    /**
     * Rendered-node cache keyed by message object identity, tagged with the display
     * mode it was rendered under. Long sessions used to re-parse and re-sanitize the
     * whole transcript's markdown on every rerender (session load, mode toggle); now
     * only messages without a mode-matching node are (re)built. In-place mutation of
     * an already-rendered message object is not supported — replace the object
     * (hydration does) to re-render it.
     */
    _nodeCache: Map<ChatMessage, { mode: string; node: HTMLElement | null }>;
    /**
     * Transient streamed-reply bubble. Deliberately NOT in `_messages` /
     * `_nodeCache`: the streamed raw text is scaffolding that the finalized
     * (sanitized, markdown-rendered) message replaces via the normal
     * `addMessage` path. Text content only — model output is untrusted and the
     * markdown+sanitize pipeline runs solely on the final message.
     */
    _streamPreviewNode: HTMLElement | null;
    _streamPreviewTextEl: HTMLElement | null;
    /**
     * A session is being hydrated into this list. The transcript on screen belongs to the
     * *previous* session, so showing it while the new one loads is worse than showing nothing:
     * skeletons say "this pane is being replaced" where the stale bubbles said "nothing happened".
     */
    _loading: boolean;
    /** The pane currently shows skeletons or the empty hint rather than a transcript. */
    _placeholderShown: boolean;

    constructor(options: ChatMessageListOptions = {}) {
        this.options = options;
        this._root = null;
        this._messages = [];
        this._displayMode = options.displayMode || "user-friendly";
        this._progress = null;
        this._nodeCache = new Map();
        this._streamPreviewNode = null;
        this._streamPreviewTextEl = null;
        this._loading = false;
        this._placeholderShown = false;
    }

    create(): HTMLElement {
        this._root = div({ class: "flex-1 overflow-auto px-2 py-2 bg-base-100", id: this.options.id || "chat-messages" }) as HTMLElement;
        return this._root;
    }

    getRoot(): HTMLElement | null {
        return this._root;
    }

    setDisplayMode(mode: "all" | "user-friendly"): void {
        this._displayMode = mode;
        this.rerender();
    }

    setMessages(messages: ChatMessage[]): void {
        this._messages = Array.isArray(messages) ? [...messages] : [];
        this.rerender();
    }

    addMessage(message: ChatMessage): void {
        this._messages.push(message);
        this._renderMessageToDom(message);
        this.scrollToEnd();
    }

    clear(): void {
        this._messages = [];
        this._nodeCache.clear();
        this.endStreamingPreview();
        // Through rerender, not innerHTML: an emptied list must still say it is empty on purpose.
        this.rerender();
    }

    /** Hydration in flight — skeletons stand in for the transcript being replaced. */
    setLoading(loading: boolean): void {
        const next = !!loading;
        if (next === this._loading) return;
        this._loading = next;
        this.rerender();
    }

    /**
     * Placeholder bubbles: no message identity, never cached, rebuilt on every rerender.
     * Sized with inline styles — the shipped Tailwind build is purged and has no `h-10`/`w-1/2`.
     */
    _buildSkeletonNodes(): Node[] {
        const widths = ["50%", "74%", "62%"];
        return widths.map((width, index) => div(
            { class: `flex mb-2 ${index % 2 ? "justify-end" : "justify-start"}` },
            div({ class: "skeleton rounded-xl", style: `height:2.5rem;width:${width}` }),
        ) as HTMLElement);
    }

    /** Shown instead of a blank pane, which reads as a failure rather than as a fresh chat. */
    _buildEmptyNode(): HTMLElement {
        return div(
            { class: "h-full flex items-center justify-center px-4 py-4" },
            span({ class: "text-[12px] text-base-content/60 italic text-center" }, $.t('chat.emptyTranscriptHint')),
        ) as HTMLElement;
    }

    /** Cached render: reuses the message's DOM node when it exists for the current mode. */
    _nodeFor(message: ChatMessage): HTMLElement | null {
        const cached = this._nodeCache.get(message);
        if (cached && cached.mode === this._displayMode) return cached.node;
        const node = this._buildMessageNode(message);
        this._nodeCache.set(message, { mode: this._displayMode, node });
        return node;
    }

    rerender(): void {
        if (!this._root) return;
        const nodes: Node[] = [];
        const nextCache: Map<ChatMessage, { mode: string; node: HTMLElement | null }> = new Map();
        for (const message of this._messages) {
            const node = this._nodeFor(message);
            nextCache.set(message, this._nodeCache.get(message)!);
            if (node) nodes.push(node);
        }
        // Drop cache entries for messages no longer in the list.
        this._nodeCache = nextCache;
        const rendered = nodes.length;
        this._placeholderShown = false;
        if (this._loading) {
            // The stale transcript is not this session's — replace it outright.
            nodes.length = 0;
            nodes.push(...this._buildSkeletonNodes());
            this._placeholderShown = true;
        }
        // Live streamed-preview bubble survives a rerender, ahead of the progress node.
        if (this._streamPreviewNode) {
            nodes.push(this._streamPreviewNode);
        }
        // The bubble keeps its own state (note, trail, clock) — re-attach the very same node
        // instead of rebuilding it from its text, which would flatten all of that. Shown in
        // both display modes: developer mode has no other liveness signal inside the pane.
        if (this._progress) {
            nodes.push(this._progress.node());
        }
        // Emptiness is decided on rendered nodes, not on `_messages`: a transcript made only of
        // hidden internal messages renders nothing and is, to the user, an empty chat.
        if (!nodes.length && !rendered) {
            nodes.push(this._buildEmptyNode());
            this._placeholderShown = true;
        }
        this._root.replaceChildren(...nodes);
        this.scrollToEnd();
    }

    /** Create (or reuse) the transient streamed-reply bubble, inserted before the progress node. */
    beginStreamingPreview(): void {
        if (!this._root || this._streamPreviewNode) return;
        const textEl = div({ class: "whitespace-pre-wrap" }) as HTMLElement;
        const node = div(
            { class: "flex mb-1 justify-start" },
            div(
                { class: "rounded-xl px-3 py-1.5 text-[12px] leading-snug chat-md opacity-80", style: "width:100%" },
                textEl,
            ),
        ) as HTMLElement;
        this._streamPreviewNode = node;
        this._streamPreviewTextEl = textEl;
        const progressNode = this._progress?.node();
        if (progressNode && progressNode.parentNode === this._root) {
            this._root.insertBefore(node, progressNode);
        } else {
            this._root.appendChild(node);
        }
        this.scrollToEnd();
    }

    /** Plaintext-only update of the streamed preview (textContent — never HTML). */
    updateStreamingPreview(text: string): void {
        if (!this._streamPreviewNode) this.beginStreamingPreview();
        if (!this._streamPreviewTextEl) return;
        this._streamPreviewTextEl.textContent = text;
        this.scrollToEnd();
    }

    /** Remove the transient bubble (the finalized message arrives via addMessage). */
    endStreamingPreview(): void {
        this._streamPreviewNode?.remove();
        this._streamPreviewNode = null;
        this._streamPreviewTextEl = null;
    }

    scrollToEnd(): void {
        if (!this._root) return;
        this._root.scrollTop = this._root.scrollHeight;
    }

    /**
     * Opens the pending-turn bubble and starts its clock. Shown in every display mode —
     * developer mode used to get no liveness signal at all inside the transcript pane.
     */
    showProgress(text: string): void {
        if (!this._progress) {
            this._progress = new ChatProgress();
            if (this._placeholderShown) {
                // The empty hint must not sit under a live turn.
                this.rerender();
            } else {
                this._root?.appendChild(this._progress.node());
            }
        }
        this._progress.setActivity(text || $.t('chat.workingOnIt'));
        this._progress.start();
        this.scrollToEnd();
    }

    /** Sets the churning activity line. Generic phrases go here — see setProgressNote. */
    updateProgress(text: string): void {
        if (!this._progress) {
            this.showProgress(text);
            return;
        }
        this._progress.setActivity(text);
        this.scrollToEnd();
    }

    /**
     * Sets the sticky line carrying the assistant's own words. Empty text is a no-op, so the
     * previous note survives a step in which the model only emitted script.
     */
    setProgressNote(text: string): void {
        this._progress?.setNote(text);
        this.scrollToEnd();
    }

    setProgressStep(index: number): void {
        this._progress?.setStep(index);
    }

    beginProgressStep(label: string): void {
        this._progress?.beginStep(label);
        this.scrollToEnd();
    }

    endProgressStep(ok: boolean): void {
        this._progress?.endStep(ok);
    }

    removeProgress(): void {
        if (!this._progress) return;
        this._progress.stop();
        this._progress.node().remove();
        this._progress = null;
        // A turn that rendered nothing (stopped before its first reply) must not leave a blank pane.
        if (this._root && !this._root.childNodes.length) this.rerender();
    }

    _isHiddenInternalMessage(message: ChatMessage): boolean {
        const metadata = (message as any)?.metadata || {};
        return metadata.hiddenFromChatUi === true || typeof metadata.internalSource === "string";
    }

    _hasRuntimeParts(message: ChatMessage): boolean {
        const parts = Array.isArray(message?.parts) ? message.parts : [];
        return parts.some((part: any) => part?.type === "host-feedback" || part?.type === "script-result");
    }

    _hasVisibleScriptResult(message: ChatMessage): boolean {
        const parts = Array.isArray(message?.parts) ? message.parts : [];
        return parts.some((part: any) => part?.type === "script-result");
    }

    _hasFailedScriptResult(message: ChatMessage): boolean {
        const parts = Array.isArray(message?.parts) ? message.parts : [];
        return parts.some((part: any) => part?.type === "script-result" && part?.ok === false);
    }

    _isRuntimeFeedbackMessage(message: ChatMessage): boolean {
        const text = String(message?.content || "");
        return (
            text.startsWith("Script execution failed.") ||
            text.startsWith("Script executed successfully.") ||
            text.startsWith("Script execution result:") ||
            text.startsWith("Execution stopped after reaching the hard cap")
        );
    }

    _isAssistantScriptMessage(message: ChatMessage): boolean {
        if (message.role !== "assistant") return false;
        return !!this.options.extractScriptFromAssistantMessage?.(message);
    }

    _shouldRender(message: ChatMessage): boolean {
        if (this._displayMode === "all") return true;
        if (this._isHiddenInternalMessage(message)) return false;
        // A failed attempt is the assistant's problem to recover from, not a result: the progress
        // pill says it is retrying, and a terminal failure still arrives as its own error message.
        if (this._hasFailedScriptResult(message)) return false;
        if (message.role === "user") {
            // Show messages carrying a successful script-result, and the user's own typed
            // input; hide model-only host-feedback nudges.
            if (this._hasVisibleScriptResult(message)) return true;
            if (this._isRuntimeFeedbackMessage(message)) return false;
            return true;
        }
        if (message.role === "tool") {
            // Runtime feedback channel: surface a successful result bubble, but suppress
            // pure host-feedback nudges that were previously hidden.
            if (this._hasVisibleScriptResult(message)) return true;
            return false;
        }
        if (message.role === "assistant" && !this._isAssistantScriptMessage(message)) return true;
        return false;
    }

    _kind(message: ChatMessage): "user" | "assistant" | "runtime" | "error" {
        if ((message as any)?.metadata?.uiVariant === "error") return "error";
        if (this._isHiddenInternalMessage(message) || this._hasRuntimeParts(message) || this._isRuntimeFeedbackMessage(message)) return "runtime";
        if (message.role === "user") return "user";
        return "assistant";
    }

    _renderMessageToDom(message: ChatMessage): void {
        if (!this._root) return;
        // Skeletons / the empty hint are not part of the transcript, so a message cannot simply be
        // appended next to them — rebuild the pane instead.
        if (this._loading || this._placeholderShown) {
            this.rerender();
            return;
        }
        const node = this._nodeFor(message);
        if (!node) return;
        // Keep the pending-turn bubble (and the streamed preview ahead of it) last.
        const anchor = this._streamPreviewNode?.parentNode === this._root
            ? this._streamPreviewNode
            : (this._progress?.node()?.parentNode === this._root ? this._progress!.node() : null);
        if (anchor) this._root.insertBefore(node, anchor);
        else this._root.appendChild(node);
    }

    /** Build (without attaching) the bubble node for a message; null when hidden in this mode. */
    _buildMessageNode(message: ChatMessage): HTMLElement | null {
        if (!this._shouldRender(message)) return null;
        const kind = this._kind(message);
        const isUser = kind === "user";
        const isRuntime = kind === "runtime";

        const isError = kind === "error";

        const bubbleCls = isUser
            ? "bg-base-200 text-base-content border border-base-300 shadow-sm"
            : isRuntime
                ? "bg-base-200/40 text-base-content/70 border border-base-300 italic"
                : isError
                    ? "bg-error/10 text-error-content border border-error/40 shadow-sm"
                    : "";

        const content = div({ class: "flex flex-col gap-1" }) as HTMLElement;
        this._renderMessageContent(content, message, kind);

        const line = div(
            { class: `flex mb-1 ${isUser ? "justify-end" : "justify-start"}` },
            div(
                {
                    class: `rounded-xl px-3 py-1.5 text-[12px] leading-snug xo-md ${bubbleCls}`,
                    // Widths as inline styles — the shipped Tailwind build is purged and has no
                    // `w-[88%]`/`max-w-[100%]`. Own messages stay capped and right-aligned; replies
                    // take the pane so long-form markdown is not squeezed.
                    style: isUser ? "max-width:88%" : "width:100%",
                },
                content,
            ),
        ) as HTMLElement;

        return line;
    }

    _renderMessageContent(el: HTMLElement, message: ChatMessage, kind: "user" | "assistant" | "runtime" | "error"): void {
        const allParts = Array.isArray(message.parts) && message.parts.length
            ? message.parts
            : (message.content ? [{ type: "text", text: String(message.content) } as ChatMessagePart] : []);

        // host-feedback parts are coaching prompts meant for the model. In user-friendly mode,
        // hide them when there is already a visible part (script-result/text) carrying the user signal.
        const hideHostFeedback = this._displayMode !== "all"
            && allParts.some((p: any) => p?.type === "script-result" || p?.type === "text");
        // capability-notice parts are host-injected announcements riding on the user
        // message — never user-authored, so hide them unconditionally outside dev mode.
        const parts = allParts.filter((p: any) =>
            (this._displayMode === "all" || p?.type !== "capability-notice")
            && (!hideHostFeedback || p?.type !== "host-feedback"));

        if (!parts.length) {
            el.textContent = "";
            return;
        }

        for (const part of parts) {
            switch (part.type) {
                case "text": {
                    const asMarkdown = kind === "assistant" && this.options.markdownEnabled !== false;
                    const transformText = (kind === "assistant" || kind === "runtime")
                        ? this.options.presentText
                        : undefined;
                    if (asMarkdown) {
                        // The `markdown` module owns parsing, sanitizing, the region-link
                        // wiring and the degrade-closed fallback (shared with the recorder
                        // and the questionnaire). `presentText` — the anonymization-handle →
                        // friendly-name restoration — is passed through as a TEXT transform,
                        // so it can no longer reach inside a link target.
                        const textEl = div({ class: "xo-md-body" }) as HTMLElement;
                        const markdown = (globalThis as any).singletonModule?.("markdown");
                        if (markdown) {
                            markdown.renderInto(textEl, part.text, {
                                transformText,
                                sanitize: this.options.sanitizeConfig,
                            });
                        } else {
                            textEl.className = "whitespace-pre-wrap";
                            textEl.textContent = transformText?.(part.text) ?? part.text;
                        }
                        el.appendChild(textEl);
                    } else {
                        const textEl = div({ class: "whitespace-pre-wrap" }) as HTMLElement;
                        textEl.textContent = transformText?.(part.text) ?? part.text;
                        el.appendChild(textEl);
                    }
                    break;
                }
                case "host-feedback": {
                    const block = pre({ class: "bg-base-200/50 rounded p-2 text-[11px] whitespace-pre-wrap" }, code(part.text)) as HTMLElement;
                    el.appendChild(block);
                    break;
                }
                case "capability-notice": {
                    // Only reachable in "all" (developer) mode — filtered out above otherwise.
                    const block = pre({ class: "bg-base-200/50 rounded p-2 text-[11px] whitespace-pre-wrap opacity-70" }, code(part.text)) as HTMLElement;
                    el.appendChild(block);
                    break;
                }
                case "script-result": {
                    const stateCls = part.ok ? "border-success/30" : "border-error/30";
                    const fullText = String(part.text || "");
                    const isTruncated = fullText.length > SCRIPT_RESULT_PREVIEW_LIMIT;
                    const previewText = isTruncated
                        ? fullText.slice(0, SCRIPT_RESULT_PREVIEW_LIMIT) + "…"
                        : fullText;
                    const textEl = pre({ class: "whitespace-pre-wrap" }, code(previewText)) as HTMLElement;
                    const block = div(
                        { class: `rounded border ${stateCls} bg-base-200/50 p-2 text-[11px]` },
                        part.script ? pre({ class: "mb-2" }, code(part.script)) : null,
                        textEl,
                    ) as HTMLElement;
                    if (isTruncated) {
                        let expanded = false;
                        const toggle = button({
                            class: "mt-1 text-[10px] underline opacity-70 hover:opacity-100",
                            type: "button",
                            onclick: (event: Event) => {
                                event.preventDefault();
                                expanded = !expanded;
                                textEl.replaceChildren(code(expanded ? fullText : previewText));
                                (toggle as HTMLElement).textContent = expanded ? $.t('chat.showLess') : $.t('chat.showDetails');
                            },
                        }, $.t('chat.showDetails')) as HTMLElement;
                        block.appendChild(toggle);
                    }
                    el.appendChild(block);
                    break;
                }
                case "image": {
                    const wrapper = div({ class: "flex flex-col gap-1" }) as HTMLElement;
                    const src = part.dataUrl || part.url || "";
                    if (src) {
                        wrapper.appendChild(img({
                            src,
                            alt: part.name || part.mimeType || $.t('chat.imageAttachment'),
                            class: "max-w-full max-h-72 rounded-lg border border-base-300 object-contain bg-base-100",
                        }) as HTMLElement);
                    }
                    if (part.name) {
                        wrapper.appendChild(span({ class: "text-[10px] text-base-content/60" }, part.name));
                    }
                    el.appendChild(wrapper);
                    break;
                }
                case "file": {
                    const href = part.dataUrl || part.url || "#";
                    const link = a({
                        href,
                        class: "link link-primary text-[11px] break-all",
                        target: href.startsWith("data:") ? undefined : "_blank",
                        rel: href.startsWith("data:") ? undefined : "noopener noreferrer",
                        download: part.name,
                    }, part.name) as HTMLElement;
                    const wrapper = div({ class: "rounded border border-base-300 bg-base-200/40 px-2 py-1" }, link) as HTMLElement;
                    el.appendChild(wrapper);
                    break;
                }
            }
        }
    }
}
