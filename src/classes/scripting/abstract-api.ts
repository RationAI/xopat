import type {ScriptApiInvocationContext, ScriptApiObject, ScriptApiMetadata, HostScriptContext} from "./abstract-types";

export type ScriptActionConsentOptions = {
    /**
     * Short title shown in the confirmation dialog.
     */
    title: string;
    /**
     * Longer description shown below the title.
     */
    description?: string;
    /**
     * Optional bullet points describing the requested action.
     */
    details?: string[];
    /**
     * Optional alert style used by UI.Alert when available.
     */
    mode?: "neutral" | "info" | "success" | "warning" | "error";
    /**
     * Label for the primary confirmation button.
     */
    confirmLabel?: string;
    /**
     * Label for the cancel button.
     */
    cancelLabel?: string;
    /**
     * Error message thrown by requireActionConsent when the user cancels.
     */
    rejectedMessage?: string;
    /**
     * When set, a granted consent is remembered on the scripting context under
     * this key and equivalent actions (same key) skip the dialog for the rest of
     * the session. Use one key per action CLASS the user reasoned about (e.g.
     * `"tissue-mask:driver-id"`), never per call. Omit for actions that must
     * always re-prompt. The per-context cache is runtime memory only — never
     * persisted; the optional "Don't ask again" affordance (see `allowRemember`)
     * additionally persists the grant user-locally with an expiry.
     */
    cacheKey?: string;
    /**
     * When a `cacheKey` is present, whether to offer the "Don't ask again"
     * (persist for a time period) affordance in the dialog. Defaults to true;
     * set false to force this action to always re-prompt on a fresh session
     * even though it de-duplicates within one session via `cacheKey`.
     */
    allowRemember?: boolean;
};

export abstract class XOpatScriptingApi implements ScriptApiObject {
    static readonly ScriptApiMetadata?: ScriptApiMetadata;

    readonly namespace: string;
    readonly name: string;
    readonly description: string;
    /**
     * Marks the namespace as exposing identifying / patient-sensitive data. Consumers (e.g. the chat
     * module) use this to withhold it from "grant everything" defaults; the patient namespace sets it.
     * Informational only — it does not by itself change the core `__self__` grant.
     */
    readonly sensitive: boolean;
    protected _invocationContext?: ScriptApiInvocationContext;

    protected constructor(namespace: string, name: string, description: string, sensitive = false) {
        this.namespace = namespace;
        this.name = name;
        this.description = description;
        this.sensitive = sensitive;
    }

    bindInvocationContext(context: ScriptApiInvocationContext): this {
        const bound = Object.create(Object.getPrototypeOf(this)) as this;
        Object.assign(bound, this);
        bound._invocationContext = context;
        return bound;
    }

    protected get scriptingContext(): HostScriptContext {
        const context = this._invocationContext?.scriptingContext;
        if (!context) {
            throw new Error(`Script API namespace '${this.namespace}' was called without a scripting context.`);
        }
        return context;
    }

    protected get activeViewer(): OpenSeadragon.Viewer {
        const viewers = VIEWER_MANAGER?.viewers || [];

        if (!viewers.length) {
            throw new Error("No viewer is available. Open a slide first.");
        }

        const selectedContextId =
            this.scriptingContext.getActiveViewerContextId?.() ??
            this.scriptingContext.activeViewerContextId ??
            this.scriptingContext.id;

        if (selectedContextId) {
            const boundViewer = viewers.find(
                (viewer: OpenSeadragon.Viewer) => viewer.uniqueId === selectedContextId
            );
            if (boundViewer) {
                return boundViewer;
            }

            throw new Error(
                `The current script context is bound to viewer '${selectedContextId}', but that viewer is not available.`
            );
        }

        if (viewers.length === 1) {
            return viewers[0];
        }

        throw new Error(
            "No viewer is selected for this script context. First call application.getGlobalInfo() and then application.setActiveViewer(contextId)."
        );
    }

    protected get activeViewerIndex(): number {
        const viewer = this.activeViewer;
        const viewerIndex = VIEWER_MANAGER?.getViewerSlotIndex?.(viewer);

        if (!Number.isInteger(viewerIndex) || viewerIndex < 0) {
            throw new Error("The active viewer is not registered in the viewer manager.");
        }

        return viewerIndex;
    }

    /**
     * Returns true when this scripting context should automatically accept interactive consent prompts.
     * This is intended for trusted automation flows and mirrors the behavior of a CLI "-y" flag.
     */
    protected get bypassConsentDialog(): boolean {
        const context = this.scriptingContext as HostScriptContext & {
            bypassConsentDialog?: boolean;
            isConsentDialogBypassed?: () => boolean;
        };

        return !!(context.isConsentDialogBypassed?.() ?? context.bypassConsentDialog);
    }

    /**
     * Ask the user to confirm an action before the host API continues.
     * The dialog is rendered with the global UI namespace when available and falls back to window.confirm().
     *
     * Exported UI components are expected on globalThis.UI, for example UI.Modal, UI.Button and UI.Alert.
     *
     * @param options dialog copy and button labels
     * @returns true when the action is allowed, false when the user cancels it
     */
    protected async requestActionConsent(options: ScriptActionConsentOptions): Promise<boolean> {
        if (this.bypassConsentDialog) {
            return true;
        }

        // Already consented this session (per-context runtime cache), or the local user chose
        // "don't ask again" for this action class (persistent, unexpired, non-secureMode).
        if (options.cacheKey && (
            this.scriptingContext.isActionConsented?.(options.cacheKey)
            || this._isActionConsentRemembered(options.cacheKey)
        )) {
            return true;
        }

        const remember = (granted: boolean, rememberMs = 0): boolean => {
            if (granted && options.cacheKey) {
                this.scriptingContext.rememberActionConsent?.(options.cacheKey);
                if (rememberMs > 0) this._rememberActionConsentPersistent(options.cacheKey, rememberMs);
            }
            return granted;
        };

        const ui = (globalThis as any)?.UI;
        const win = globalThis as (typeof window & typeof globalThis) | undefined;

        if (typeof document === "undefined") {
            if (typeof win?.confirm === "function") {
                return remember(win.confirm(this.buildConsentFallbackMessage(options)));
            }

            throw new Error("Unable to render a consent dialog in the current environment.");
        }

        if (ui?.Modal && ui?.Button) {
            const result = await this.renderConsentDialogWithUi(ui, options);
            return remember(result.granted, result.rememberMs);
        }

        if (typeof win?.confirm === "function") {
            return remember(win.confirm(this.buildConsentFallbackMessage(options)));
        }

        throw new Error("Unable to render a consent dialog because no supported UI implementation is available.");
    }

    /** The core scripting manager (persistent remembered-consent store lives here). */
    protected _manager(): any {
        return (globalThis as any)?.APPLICATION_CONTEXT?.Scripting;
    }

    /** Whether the "Don't ask again" (persist) affordance may be offered for this action. */
    protected _consentRememberOffered(options: ScriptActionConsentOptions): boolean {
        return !!options.cacheKey
            && options.allowRemember !== false
            && !(globalThis as any)?.APPLICATION_CONTEXT?.secureMode
            && typeof this._manager()?.rememberActionConsentPersistent === "function";
    }

    /** Persistent remembered-consent read — no-op under secureMode / when unavailable. */
    protected _isActionConsentRemembered(cacheKey: string): boolean {
        if ((globalThis as any)?.APPLICATION_CONTEXT?.secureMode) return false;
        try {
            return !!this._manager()?.isActionConsentRemembered?.(cacheKey);
        } catch (_) {
            return false;
        }
    }

    /** Persistent remembered-consent write — no-op under secureMode / when unavailable. */
    protected _rememberActionConsentPersistent(cacheKey: string, ttlMs: number): void {
        if ((globalThis as any)?.APPLICATION_CONTEXT?.secureMode) return;
        try {
            this._manager()?.rememberActionConsentPersistent?.(cacheKey, ttlMs);
        } catch (_) {
            // best-effort
        }
    }

    /**
     * Require the user to confirm an action before continuing.
     *
     * @param options dialog copy and button labels
     * @throws Error when the action is rejected by the user
     */
    protected async requireActionConsent(options: ScriptActionConsentOptions): Promise<void> {
        const granted = await this.requestActionConsent(options);
        if (!granted) {
            throw new Error(options.rejectedMessage || "The requested script action was canceled by the user.");
        }
    }

    /**
     * Build the plain-text confirmation message used by the window.confirm fallback.
     *
     * @param options dialog copy and button labels
     * @returns fallback text
     */
    protected buildConsentFallbackMessage(options: ScriptActionConsentOptions): string {
        const lines = [options.title];

        if (options.description) {
            lines.push("", options.description);
        }

        if (options.details?.length) {
            lines.push("", ...options.details.map(detail => `• ${detail}`));
        }

        return lines.join("\n");
    }

    /**
     * Render the consent dialog through the vanjs based UI namespace.
     *
     * @param ui global UI namespace
     * @param options dialog copy and button labels
     * @returns promise resolving to the user's decision
     */
    protected renderConsentDialogWithUi(
        ui: any,
        options: ScriptActionConsentOptions
    ): Promise<{ granted: boolean; rememberMs?: number }> {
        const vanInstance = (globalThis as any)?.van;
        const tags = vanInstance?.tags || {};
        const t = (key: string): string => (globalThis as any)?.$?.t?.(key) ?? key;

        const createTag = (tagName: string) =>
            (props: Record<string, unknown> = {}, ...children: any[]) => {
                const node = document.createElement(tagName);

                Object.entries(props || {}).forEach(([key, value]) => {
                    if (key === "class") {
                        node.className = String(value || "");
                    } else if (key === "style") {
                        node.setAttribute("style", String(value || ""));
                    } else if (value !== undefined && value !== null) {
                        node.setAttribute(key, String(value));
                    }
                });

                for (const child of children.flat()) {
                    if (child == null) continue;
                    if (child instanceof Node) node.append(child);
                    else node.append(document.createTextNode(String(child)));
                }

                return node;
            };

        const div = tags.div || createTag("div");
        const p = tags.p || createTag("p");
        const ul = tags.ul || createTag("ul");
        const li = tags.li || createTag("li");
        // Always use the raw builders for form controls so we can hold references + wire events.
        const inputTag = createTag("input");
        const selectTag = createTag("select");
        const optionTag = createTag("option");
        const labelTag = createTag("label");
        const spanTag = createTag("span");

        const detailsList = options.details?.length
            ? ul(
                { class: "list-disc pl-5 text-sm opacity-80 flex flex-col gap-1" },
                ...options.details.map(detail => li({}, detail))
            )
            : null;

        const alertNode = ui.Alert
            ? new ui.Alert({
                mode: options.mode || "warning",
                soft: true,
                title: t("scripting.consent.permissionTitle"),
                description: options.description || ""
            }).create()
            : null;

        // "Don't ask again" affordance — only when the action opts in and persistence is allowed.
        const DAY = 24 * 60 * 60 * 1000;
        let rememberCheckbox: HTMLInputElement | null = null;
        let rememberSelect: HTMLSelectElement | null = null;
        let rememberRow: HTMLElement | null = null;

        if (this._consentRememberOffered(options)) {
            rememberCheckbox = inputTag({ type: "checkbox", class: "checkbox checkbox-sm" }) as HTMLInputElement;
            rememberSelect = selectTag(
                { class: "select select-sm select-bordered", disabled: "disabled" },
                optionTag({ value: String(1 * DAY) }, t("scripting.consent.remember1Day")),
                optionTag({ value: String(7 * DAY) }, t("scripting.consent.remember7Days")),
                optionTag({ value: String(30 * DAY) }, t("scripting.consent.remember30Days")),
            ) as HTMLSelectElement;
            rememberSelect.value = String(7 * DAY); // default 7 days
            rememberCheckbox.addEventListener("change", () => {
                if (rememberSelect) rememberSelect.disabled = !rememberCheckbox!.checked;
            });
            // The select is a sibling of the label (not nested) so clicking it does not toggle the box.
            rememberRow = div(
                { class: "flex items-center gap-2 text-sm mt-1" },
                labelTag(
                    { class: "flex items-center gap-2 cursor-pointer" },
                    rememberCheckbox,
                    spanTag({}, t("scripting.consent.dontAskAgain"))
                ),
                rememberSelect
            );
        }

        const body = div(
            { class: "flex flex-col gap-3" },
            alertNode,
            options.description
                ? p({ class: "text-sm leading-6 opacity-80" }, options.description)
                : null,
            detailsList,
            rememberRow
        );

        return new Promise<{ granted: boolean; rememberMs?: number }>((resolve) => {
            let settled = false;
            const footerRoot = div({ class: "w-full flex items-center justify-end gap-2" });

            const modal = new ui.Modal({
                header: options.title,
                body,
                footer: footerRoot,
                width: "min(32rem, 92vw)",
                isBlocking: true,
                allowClose: true
            });

            const finish = (granted: boolean): void => {
                if (settled) return;
                settled = true;
                const rememberMs = (granted && rememberCheckbox?.checked)
                    ? Number(rememberSelect?.value) || 0
                    : 0;
                modal.close();
                const root = (modal as any).root as HTMLElement | undefined;
                root?.remove();
                resolve({ granted, rememberMs });
            };

            const cancelButton = new ui.Button(
                {
                    size: ui.Button.SIZE.SMALL,
                    type: ui.Button.TYPE.NONE,
                    outline: ui.Button.OUTLINE.ENABLE,
                    onClick: () => finish(false)
                },
                options.cancelLabel || "Cancel"
            );

            const confirmButton = new ui.Button(
                {
                    size: ui.Button.SIZE.SMALL,
                    type: ui.Button.TYPE.PRIMARY,
                    onClick: () => finish(true)
                },
                options.confirmLabel || "Allow"
            );

            const originalClose = modal.close.bind(modal);
            modal.close = () => {
                originalClose();
                if (!settled) {
                    settled = true;
                    const root = (modal as any).root as HTMLElement | undefined;
                    root?.remove();
                    resolve({ granted: false });
                }
                return modal;
            };

            footerRoot.append(cancelButton.create(), confirmButton.create());
            modal.mount(document.body).open();
        });
    }
}
