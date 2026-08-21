import type { ChatService } from "../chatService";
import { cacheHitRatio, type UsageTotals } from "../shared/usage-stats";

const { BaseComponent } = (globalThis as any).UI;
const { div, span, table, tbody, tr, th, td } = (globalThis as any).van.tags;

type UsagePanelOptions = {
    id?: string;
    chatService: ChatService;
};

/**
 * Token-usage readout — lives in the fullscreen plugin-settings menu
 * (AppBar.Plugins) beside the BYOK panel, as a sibling submenu.
 *
 * Read on demand, never pushed: nothing renders while a turn runs, and the numbers are
 * pulled when the panel actually becomes visible. That keeps the chat path free of any
 * display work and matches how the data is used — glanced at occasionally, not watched.
 *
 * Scope is deliberately narrow. These are provider-reported tokens for THIS TAB since the
 * session was opened, with no pricing applied and no persistence. It is a diagnostic —
 * above all, the only in-app way to see whether prompt caching is working — and the copy
 * has to keep it from being read as a bill.
 */
export class UsagePanel extends BaseComponent {
    chatService: ChatService;
    _bodyEl: HTMLElement | null = null;
    _visibilityObserver: IntersectionObserver | null = null;

    declare options: UsagePanelOptions;

    constructor(options: UsagePanelOptions = void 0 as any) {
        super(options);
        this.chatService = this.options.chatService;
    }

    create(): HTMLElement {
        const fs = (globalThis as any).USER_INTERFACE?.FullscreenMenu;

        this._bodyEl = div({ class: "flex flex-col gap-4" }) as HTMLElement;

        const content = [
            span({ class: "text-[11px] text-base-content/70" }, $.t('chat.usageDescription')),
            this._bodyEl,
        ];

        const root = (fs?.layout && fs?.card
            ? fs.layout($.t('chat.usageTitle'), fs.card(null, ...content))
            : div({ class: "flex flex-col gap-2 p-2" },
                span({ class: "text-2xl font-semibold" }, $.t('chat.usageTitle')),
                ...content)) as HTMLElement;

        // The fullscreen menu mounts tab bodies EAGERLY at init and merely reveals them
        // later, so a one-shot render would show construction-time state forever. Refresh
        // on every reveal — this is also what makes "load when opened" true rather than
        // aspirational. Same mechanism as ProviderKeysPanel.
        this._visibilityObserver = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) this.refresh();
        });
        this._visibilityObserver.observe(root);

        return root;
    }

    refresh(): void {
        const body = this._bodyEl;
        if (!body || !this.chatService) return;
        body.innerHTML = "";

        const sessionId = this.chatService.getActiveSessionId?.() || null;
        const stats = this.chatService.getUsageStats?.(sessionId) || null;

        if (!stats || !stats.session.calls) {
            body.appendChild(span({ class: "text-xs opacity-70" }, $.t('chat.usageNone')));
            return;
        }

        body.appendChild(this._block($.t('chat.usageLastMessage'), stats.lastMessage));
        body.appendChild(this._block(
            $.t('chat.usageSession', { messages: stats.messages }),
            stats.session
        ));

        // Requests happened but the provider told us nothing. Without naming that, an
        // opt-in default is indistinguishable from a broken panel — which is exactly how
        // a wall of zeros read before this line existed.
        if (!stats.session.hasTokenDetail) {
            body.appendChild(span(
                { class: "text-[11px] text-warning" },
                $.t('chat.usageNotReported')
            ));
        }

        body.appendChild(span(
            { class: "text-[11px] text-base-content/60" },
            $.t('chat.usageDisclaimer')
        ));
    }

    /** One titled key/value block, in the idiom of RenderDebugPanel's _kvTable. */
    _block(title: string, totals: UsageTotals): HTMLElement {
        const ratio = cacheHitRatio(totals);
        // A dash, never a zero. "The provider did not report this" and "the measured value
        // was zero" are different findings; rendering both as 0 states something we were
        // never told. Call counts are exempt — those we observed ourselves, and they are
        // what makes a fully-unreported panel legible instead of blank.
        const tokens = (value: number) => totals.hasTokenDetail ? this._n(value) : "—";
        const rows: [string, string][] = [
            [$.t('chat.usageInput'), tokens(totals.inputTokens)],
            [$.t('chat.usageOutput'), tokens(totals.outputTokens)],
            [$.t('chat.usageTotal'), tokens(totals.totalTokens)],
            [$.t('chat.usageCached'), totals.hasCacheDetail ? this._n(totals.cacheReadTokens) : "—"],
            [$.t('chat.usageCacheHit'), ratio === null ? "—" : `${Math.round(ratio * 100)}%`],
            [$.t('chat.usageCalls'), this._n(totals.calls)],
        ];

        return div(
            { class: "flex flex-col gap-1" },
            span({ class: "text-xs font-medium" }, title),
            table(
                { class: "w-full text-xs" },
                tbody(...rows.map(([key, value]) => tr(
                    th({ class: "w-40 py-0.5 text-left font-normal opacity-60" }, key),
                    td({ class: "py-0.5 font-mono text-right" }, value)
                )))
            )
        ) as HTMLElement;
    }

    /** Group digits so a six-figure token count stays readable at a glance. */
    _n(value: number): string {
        return Number(value || 0).toLocaleString();
    }

    destroy(): void {
        this._visibilityObserver?.disconnect();
        this._visibilityObserver = null;
        super.destroy?.();
    }
}
