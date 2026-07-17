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
    /**
     * Invoked when the user clicks an assistant-emitted region link
     * (`[label](#xopat-region?...)`) — navigates the referenced viewer to the region.
     * When absent, region links render as inert text.
     */
    onRegionLink?: (payload: ChatRegionLinkPayload) => void;
}

export class ChatMessageList {
    options: ChatMessageListOptions;
    _root: HTMLElement | null;
    _messages: ChatMessage[];
    _displayMode: "all" | "user-friendly";
    /** The pending-turn bubble. Present only while a turn runs; owns its own state and timers. */
    _progress: ChatProgress | null;

    constructor(options: ChatMessageListOptions = {}) {
        this.options = options;
        this._root = null;
        this._messages = [];
        this._displayMode = options.displayMode || "user-friendly";
        this._progress = null;
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
        if (this._root) this._root.innerHTML = "";
    }

    rerender(): void {
        if (!this._root) return;
        this._root.innerHTML = "";
        for (const message of this._messages) {
            this._renderMessageToDom(message);
        }
        // The bubble keeps its own state (note, trail, clock) — re-attach the very same node
        // instead of rebuilding it from its text, which would flatten all of that.
        if (this._progress && this._displayMode === "user-friendly") {
            this._root.appendChild(this._progress.node());
        }
        this.scrollToEnd();
    }

    scrollToEnd(): void {
        if (!this._root) return;
        this._root.scrollTop = this._root.scrollHeight;
    }

    /** Opens the pending-turn bubble and starts its clock. */
    showProgress(text: string): void {
        if (this._displayMode !== "user-friendly") return;
        if (!this._progress) {
            this._progress = new ChatProgress();
            this._root?.appendChild(this._progress.node());
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
        if (!this._root || !this._shouldRender(message)) return;
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

        const content = div({ class: "flex flex-col gap-2" }) as HTMLElement;
        this._renderMessageContent(content, message, kind);

        const line = div(
            { class: `flex mb-2 ${isUser ? "justify-end" : "justify-start"}` },
            div(
                { class: `w-[88%] max-w-[100%] rounded-xl px-3 py-1.5 text-[12px] leading-snug whitespace-pre-wrap chat-md ${bubbleCls}` },
                content,
            ),
        ) as HTMLElement;

        this._root.appendChild(line);
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
                    const textEl = div() as HTMLElement;
                    const asMarkdown = kind === "assistant" && this.options.markdownEnabled !== false;
                    // Region links must be extracted from the RAW text, before presentText —
                    // the friendly-name restoration would otherwise rewrite the viewer handle
                    // inside the link target and break it.
                    const regionLinks: ChatRegionLinkPayload[] = [];
                    const rawText = asMarkdown ? this._extractRegionLinks(part.text, regionLinks) : part.text;
                    // Restore friendly slide names from anonymization handles for the local user.
                    const shownText = (kind === "assistant" || kind === "runtime")
                        ? (this.options.presentText?.(rawText) ?? rawText)
                        : rawText;
                    if (asMarkdown) {
                        const rendered = this._renderMarkdown(shownText);
                        if (rendered != null) {
                            textEl.innerHTML = rendered;
                            this._activateRegionLinks(textEl, regionLinks);
                        } else {
                            textEl.textContent = shownText;
                        }
                    } else {
                        textEl.textContent = shownText;
                    }
                    el.appendChild(textEl);
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

    /**
     * Rewrite assistant region-link destinations (`](#xopat-region?viewer=..&x=..)`) into
     * opaque indexed hrefs (`](#xopat-region-N)`), collecting the parsed payloads into `out`.
     * The opaque form survives both presentText (no handle text left to rewrite) and the
     * HTML sanitizer (schemeless fragment href). Unparseable links are left untouched.
     */
    _extractRegionLinks(text: string, out: ChatRegionLinkPayload[]): string {
        if (!text || !text.includes("#xopat-region")) return text;
        return text.replace(/\]\(\s*#xopat-region\?([^)\s]*)\s*\)/g, (match, query) => {
            const payload = this._parseRegionLinkQuery(String(query || ""));
            if (!payload) return match;
            const index = out.push(payload) - 1;
            return `](#xopat-region-${index})`;
        });
    }

    _parseRegionLinkQuery(query: string): ChatRegionLinkPayload | null {
        let params: URLSearchParams;
        try {
            params = new URLSearchParams(query);
        } catch (_) {
            return null;
        }
        const num = (key: string): number | null => {
            const raw = params.get(key);
            if (raw == null || raw === "") return null;
            const value = Number(raw);
            return Number.isFinite(value) ? value : null;
        };
        const x = num("x");
        const y = num("y");
        if (x == null || y == null) return null;
        const viewer = (params.get("viewer") || "").trim();
        return { viewer: viewer || null, x, y, w: num("w"), h: num("h"), z: num("z") };
    }

    /** Bind click-to-navigate behavior onto the sanitized anchors produced by _extractRegionLinks. */
    _activateRegionLinks(root: HTMLElement, payloads: ChatRegionLinkPayload[]): void {
        if (!payloads.length) return;
        for (const anchor of Array.from(root.querySelectorAll('a[href^="#xopat-region-"]'))) {
            const match = (anchor.getAttribute("href") || "").match(/^#xopat-region-(\d+)$/);
            const payload = match ? payloads[Number(match[1])] : undefined;
            if (!payload) continue;
            anchor.removeAttribute("target");
            anchor.removeAttribute("rel");
            anchor.classList.add("link", "link-primary", "cursor-pointer");
            anchor.setAttribute("title", $.t('chat.goToRegion'));
            (anchor as HTMLElement).onclick = (event: Event) => {
                event.preventDefault();
                this.options.onRegionLink?.(payload);
            };
        }
    }

    _renderMarkdown(markdown: string): string | null {
        const markedLib = (window as any).xnpm?.marked;
        if (!markedLib) return null;

        let renderFn: ((text: string) => string) | null = null;
        if (typeof markedLib.parse === "function") renderFn = (text) => markedLib.parse(text);
        else if (markedLib.marked && typeof markedLib.marked.parse === "function") renderFn = (text) => markedLib.marked.parse(text);
        else if (typeof markedLib === "function") renderFn = (text) => markedLib(text);
        if (!renderFn) return null;

        try {
            const raw = renderFn(markdown);
            return this._sanitizeHtml(raw);
        } catch (error) {
            console.warn("Markdown render failed; falling back to plain text", error);
            return null;
        }
    }

    _sanitizeHtml(html: string): string {
        const sanitizer = (window as any).SanitizeHtml;
        if (!sanitizer) return html;
        const config = this.options.sanitizeConfig || {};
        if (typeof sanitizer.sanitize === "function") return sanitizer.sanitize(html, config);
        if (typeof sanitizer === "function") return sanitizer(html, config);
        return html;
    }
}
