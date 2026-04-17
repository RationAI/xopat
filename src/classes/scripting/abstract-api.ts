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
};

export abstract class XOpatScriptingApi implements ScriptApiObject {
    static readonly ScriptApiMetadata?: ScriptApiMetadata;

    readonly namespace: string;
    readonly name: string;
    readonly description: string;
    protected _invocationContext?: ScriptApiInvocationContext;

    protected constructor(namespace: string, name: string, description: string) {
        this.namespace = namespace;
        this.name = name;
        this.description = description;
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

        const ui = (globalThis as any)?.UI;
        const win = globalThis as (typeof window & typeof globalThis) | undefined;

        if (typeof document === "undefined") {
            if (typeof win?.confirm === "function") {
                return win.confirm(this.buildConsentFallbackMessage(options));
            }

            throw new Error("Unable to render a consent dialog in the current environment.");
        }

        if (ui?.Modal && ui?.Button) {
            return this.renderConsentDialogWithUi(ui, options);
        }

        if (typeof win?.confirm === "function") {
            return win.confirm(this.buildConsentFallbackMessage(options));
        }

        throw new Error("Unable to render a consent dialog because no supported UI implementation is available.");
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
    protected renderConsentDialogWithUi(ui: any, options: ScriptActionConsentOptions): Promise<boolean> {
        const vanInstance = (globalThis as any)?.van;
        const tags = vanInstance?.tags || {};

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
                title: "This script is asking for permission.",
                description: options.description || ""
            }).create()
            : null;

        const body = div(
            { class: "flex flex-col gap-3" },
            alertNode,
            options.description
                ? p({ class: "text-sm leading-6 opacity-80" }, options.description)
                : null,
            detailsList
        );

        return new Promise<boolean>((resolve) => {
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
                modal.close();
                const root = (modal as any).root as HTMLElement | undefined;
                root?.remove();
                resolve(granted);
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
                    resolve(false);
                }
                return modal;
            };

            footerRoot.append(cancelButton.create(), confirmButton.create());
            modal.mount(document.body).open();
        });
    }
}