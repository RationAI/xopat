import type {ChatService} from "../chatService";

const { BaseComponent, Button } = (globalThis as any).UI;
const { div, span, input, i } = (globalThis as any).van.tags;

type ProviderKeysPanelOptions = {
    id?: string;
    chatService: ChatService;
    /** Called after a successful key save/clear so the owner can refresh model pickers. */
    onKeysChanged?: (providerId: string) => void | Promise<void>;
};

/**
 * BYOK settings panel — lives in the fullscreen plugin-settings menu
 * (AppBar.Plugins), NOT in the chat consent dialog. Lists every visible
 * provider whose type declares `secret: true` config fields and lets the user
 * store/remove their own key. Secret values are write-only: inputs are never
 * prefilled and the server returns status flags only.
 */
export class ProviderKeysPanel extends BaseComponent {
    chatService: ChatService;
    _listEl: HTMLElement | null = null;
    _statusEl: HTMLElement | null = null;
    _visibilityObserver: IntersectionObserver | null = null;

    declare options: ProviderKeysPanelOptions;

    constructor(options: ProviderKeysPanelOptions = void 0 as any) {
        super(options);
        this.chatService = this.options.chatService;
    }

    create(): HTMLElement {
        const fs = (globalThis as any).USER_INTERFACE?.FullscreenMenu;

        this._listEl = div({ class: "flex flex-col gap-2" }) as HTMLElement;
        this._statusEl = span({ class: "text-[11px] opacity-70", "aria-live": "polite" }) as HTMLElement;

        const content = [
            span({ class: "text-[11px] text-base-content/70" }, $.t('chat.providerKeysDescription')),
            this._listEl,
            this._statusEl,
        ];

        // Page title goes to fs.layout (plain 2xl header above the card grid,
        // like the core Settings/Plugins tabs) — NOT inside the card.
        const root = (fs?.layout && fs?.card
            ? fs.layout($.t('chat.providerKeysLegend'), fs.card(null, ...content))
            : div({ class: "flex flex-col gap-2 p-2" },
                span({ class: "text-2xl font-semibold" }, $.t('chat.providerKeysLegend')),
                ...content)) as HTMLElement;

        // The fullscreen menu mounts the tab body eagerly but shows it on
        // demand — refresh the per-caller key status every time the panel
        // actually becomes visible, so badges never show stale server state.
        this._visibilityObserver = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) void this.refresh();
        });
        this._visibilityObserver.observe(root);

        return root;
    }

    async refresh(): Promise<void> {
        const list = this._listEl;
        if (!list || !this.chatService) return;
        list.innerHTML = "";

        const rows = this.chatService.getProviders()
            .map((provider: ChatProviderInstanceRecord) => ({
                provider,
                secretFields: (this.chatService.getProviderType(provider.typeId)?.configSchema || [])
                    .filter((field: any) => field.secret === true),
            }))
            .filter((row: any) => row.secretFields.length > 0);

        if (!rows.length) {
            list.appendChild(span({ class: "text-xs opacity-70" }, $.t('chat.providerKeysNone')));
            return;
        }

        const statuses = await Promise.allSettled(rows.map((row: any) => {
            const needsLogin = row.provider.requiresLogin !== false
                && !this.chatService.isAuthenticated(row.provider.id);
            // A login-required provider without a token would 401 through the
            // authed RPC client — render a login hint instead of calling.
            return needsLogin
                ? Promise.reject(new Error("login-required"))
                : this.chatService.getProviderUserSecretsStatus(row.provider.id);
        }));

        rows.forEach((row: any, index: number) => {
            const result = statuses[index];
            if (result.status === "fulfilled") {
                list.appendChild(this._buildProviderKeyRow(row.provider, row.secretFields, result.value));
                return;
            }
            const needsLogin = row.provider.requiresLogin !== false
                && !this.chatService.isAuthenticated(row.provider.id);
            list.appendChild(div(
                { class: "flex items-center gap-2 border border-base-200 rounded p-2" },
                span({ class: "text-xs font-medium" }, row.provider.label),
                span({ class: "text-[11px] opacity-70" },
                    needsLogin ? $.t('chat.providerKeyLoginFirst') : $.t('chat.providerKeyFailed'))
            ));
        });
    }

    _setStatus(text: string): void {
        if (this._statusEl) this._statusEl.textContent = text;
    }

    /** Toast confirmation (falls back to the inline status line). */
    _notify(message: string, ok: boolean): void {
        this._setStatus(message);
        const Dialogs = (globalThis as any).Dialogs;
        if (typeof Dialogs?.show !== 'function') return;
        const escapeHtml = (s: string) => String(s).replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
        ));
        Dialogs.show(escapeHtml(message), 5000, ok ? Dialogs.MSG_OK : Dialogs.MSG_WARN);
    }

    _buildProviderKeyRow(
        provider: ChatProviderInstanceRecord,
        secretFields: any[],
        status: ProviderUserSecretsStatus
    ): HTMLElement {
        const badge = status.hasUserSecrets
            ? span({ class: "badge badge-success badge-xs gap-1" },
                i({ class: "ph-light ph-check" }),
                $.t('chat.providerKeyStatusUser'))
            : status.hasAdminSecrets
                ? span({ class: "badge badge-info badge-xs" }, $.t('chat.providerKeyStatusAdmin'))
                : span({ class: "badge badge-warning badge-xs" }, $.t('chat.providerKeyStatusRequired'));

        const inputs = new Map<string, HTMLInputElement>();
        const fieldEls = secretFields.map((field: any) => {
            // Stored keys stay write-only, but the placeholder must make the
            // "configured" state obvious: masked dots instead of the entry hint.
            const stored = status.userSecretKeys.includes(String(field.key));
            const el = input({
                type: "password",
                autocomplete: "new-password",
                class: "input input-bordered input-xs w-full",
                placeholder: stored
                    ? $.t('chat.providerKeyPlaceholderStored')
                    : $.t('chat.providerKeyPlaceholder', { field: field.label || field.key }),
            }) as HTMLInputElement;
            inputs.set(String(field.key), el);
            return el;
        });

        const applyResult = async (promise: Promise<ProviderUserSecretsStatus>, successKey: string) => {
            let ok = true;
            try {
                await promise;
            } catch (error) {
                ok = false;
                console.error("Provider key update failed:", error);
            }
            this._notify($.t(ok ? successKey : 'chat.providerKeyFailed'), ok);
            for (const el of inputs.values()) el.value = "";
            await this.refresh();
            try {
                await this.options.onKeysChanged?.(provider.id);
            } catch (error) {
                console.warn("Provider key change follow-up failed:", error);
            }
        };

        const saveBtn = new Button(
            {
                size: Button.SIZE.SMALL,
                type: Button.TYPE.PRIMARY,
                extraClasses: { base: "btn btn-xs" },
                onClick: () => {
                    // Blank inputs mean "keep what is stored" — deletion is the
                    // explicit Clear action, never an accidental empty save.
                    const patch: Record<string, string | null> = {};
                    for (const [key, el] of inputs.entries()) {
                        const value = el.value.trim();
                        if (value) patch[key] = value;
                    }
                    if (!Object.keys(patch).length) return;
                    void applyResult(
                        this.chatService.setProviderUserSecrets(provider.id, patch),
                        'chat.providerKeySaved'
                    );
                },
            },
            span($.t('chat.providerKeySave'))
        ).create();

        const actions: any[] = [saveBtn];
        if (status.hasUserSecrets) {
            actions.push(new Button(
                {
                    size: Button.SIZE.SMALL,
                    extraClasses: { base: "btn btn-xs btn-outline btn-error gap-1" },
                    extraProperties: { title: $.t('chat.providerKeyClear') },
                    onClick: () => {
                        void applyResult(
                            this.chatService.clearProviderUserSecrets(provider.id),
                            'chat.providerKeyCleared'
                        );
                    },
                },
                i({ class: "ph-light ph-trash" }),
                span($.t('chat.providerKeyClear'))
            ).create());
        }

        return div(
            { class: "flex flex-col gap-1 border border-base-200 rounded p-2" },
            div(
                { class: "flex items-center gap-2" },
                span({ class: "text-xs font-medium grow" }, provider.label),
                badge
            ),
            ...fieldEls,
            div({ class: "flex items-center justify-end gap-1" }, ...actions)
        ) as HTMLElement;
    }
}
