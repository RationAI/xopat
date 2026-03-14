import type { ChatMessage, ChatMessagePart } from "../chatService";

const { div, span, img, a, code, pre } = (globalThis as any).van.tags;

export interface ChatMessageListOptions {
  id?: string;
  markdownEnabled?: boolean;
  sanitizeConfig?: any;
  displayMode?: "all" | "user-friendly";
  extractScriptFromAssistantMessage?: (message: ChatMessage) => string | undefined;
}

export class ChatMessageList {
  options: ChatMessageListOptions;
  _root: HTMLElement | null;
  _messages: ChatMessage[];
  _displayMode: "all" | "user-friendly";
  _pendingBubble: { line: HTMLElement; content: HTMLElement } | null;

  constructor(options: ChatMessageListOptions = {}) {
    this.options = options;
    this._root = null;
    this._messages = [];
    this._displayMode = options.displayMode || "user-friendly";
    this._pendingBubble = null;
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
    if (this._pendingBubble && this._displayMode === "user-friendly") {
      const text = this._pendingBubble.content.textContent || "Working on it…";
      this._pendingBubble = null;
      this.showProgress(text);
    }
    this.scrollToEnd();
  }

  scrollToEnd(): void {
    if (!this._root) return;
    this._root.scrollTop = this._root.scrollHeight;
  }

  showProgress(text: string): void {
    if (this._displayMode !== "user-friendly") return;
    if (this._pendingBubble) {
      this._pendingBubble.content.textContent = text;
      this.scrollToEnd();
      return;
    }

    const content = span({ class: "opacity-70 italic" }, text || "Working on it…") as HTMLElement;
    const line = div(
      { class: "flex mb-2 justify-start" },
      div(
        { class: "w-[88%] max-w-[100%] rounded-xl px-2 py-2 text-[12px] leading-snug whitespace-pre-wrap bg-base-200/40 border border-base-300" },
        content,
      ),
    ) as HTMLElement;

    this._root?.appendChild(line);
    this._pendingBubble = { line, content };
    this.scrollToEnd();
  }

  updateProgress(text: string): void {
    if (!this._pendingBubble) {
      this.showProgress(text);
      return;
    }
    this._pendingBubble.content.textContent = text;
    this.scrollToEnd();
  }

  removeProgress(): void {
    if (!this._pendingBubble) return;
    this._pendingBubble.line.remove();
    this._pendingBubble = null;
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
    if (message.role === "user" && !this._isRuntimeFeedbackMessage(message)) return true;
    if (message.role === "assistant" && !this._isAssistantScriptMessage(message)) return true;
    return false;
  }

  _kind(message: ChatMessage): "user" | "assistant" | "runtime" {
    if (this._isRuntimeFeedbackMessage(message)) return "runtime";
    if (message.role === "user") return "user";
    return "assistant";
  }

  _renderMessageToDom(message: ChatMessage): void {
    if (!this._root || !this._shouldRender(message)) return;
    const kind = this._kind(message);
    const isUser = kind === "user";
    const isRuntime = kind === "runtime";

    const bubbleCls = isUser
      ? "bg-base-200 text-base-content border border-base-300 shadow-sm"
      : isRuntime
        ? "bg-base-200/40 text-base-content/70 border border-base-300 italic"
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

  _renderMessageContent(el: HTMLElement, message: ChatMessage, kind: "user" | "assistant" | "runtime"): void {
    const parts = Array.isArray(message.parts) && message.parts.length
      ? message.parts
      : (message.content ? [{ type: "text", text: String(message.content) } as ChatMessagePart] : []);

    if (!parts.length) {
      el.textContent = "";
      return;
    }

    for (const part of parts) {
      switch (part.type) {
        case "text": {
          const textEl = div() as HTMLElement;
          if (kind === "assistant" && this.options.markdownEnabled !== false) {
            const rendered = this._renderMarkdown(part.text);
            if (rendered != null) {
              textEl.innerHTML = rendered;
            } else {
              textEl.textContent = part.text;
            }
          } else {
            textEl.textContent = part.text;
          }
          el.appendChild(textEl);
          break;
        }
        case "host-feedback": {
          const block = pre({ class: "bg-base-200/50 rounded p-2 text-[11px] whitespace-pre-wrap" }, code(part.text)) as HTMLElement;
          el.appendChild(block);
          break;
        }
        case "script-result": {
          const stateCls = part.ok ? "border-success/30" : "border-error/30";
          const block = div(
            { class: `rounded border ${stateCls} bg-base-200/50 p-2 text-[11px]` },
            part.script ? pre({ class: "mb-2" }, code(part.script)) : null,
            pre({ class: "whitespace-pre-wrap" }, code(part.text)),
          ) as HTMLElement;
          el.appendChild(block);
          break;
        }
        case "image": {
          const wrapper = div({ class: "flex flex-col gap-1" }) as HTMLElement;
          const src = part.dataUrl || part.url || "";
          if (src) {
            wrapper.appendChild(img({
              src,
              alt: part.name || part.mimeType || "image attachment",
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
