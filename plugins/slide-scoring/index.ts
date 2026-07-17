/// <reference path="../../src/types/globals.d.ts" />

/**
 * slide-scoring — score or label the slide open in a viewer.
 *
 * This plugin is a **data source, not a backend client**. It knows how to
 * capture "this slide was scored X" and hands the record to the IO pipeline;
 * where that lands (MLflow, GitHub, a REST API, post-data) is an admin binding
 * in `ENV.client.io.bindings["slide-scoring"]`. Nothing here imports or
 * mentions any particular sink — that is the whole point of the design, and
 * the reason the old mlflow-annotations-slide plugin was replaced.
 *
 * Multi-viewport: every score is resolved from an explicit viewer instance
 * (the event source, or the viewer the clicked control was built for). The
 * global `VIEWER` / `activeBackgroundIndex` is never consulted — in a grid it
 * names whichever viewport happens to be focused, which is routinely the wrong
 * one.
 */

type ScoreValue = number;

/** The scoring vocabulary. Deployment config, not session config. */
type ScoreSchema = {
    scoreKey: string;
    labels: Record<string, ScoreValue>;
};

/** A single scoring event. Backend-neutral by construction. */
type ScoreRecord = {
    /** Stable identity of the scored slide (`tileSourceId`). */
    slideId: string;
    /** Which quantity was scored, e.g. "slide_label". */
    scoreKey: string;
    /** Numeric value a sink can log as a metric. */
    value: ScoreValue;
    /** Human-readable label the value came from. */
    label: string;
    /** Epoch ms. */
    ts: number;
    /** Who scored, when the deployment knows. */
    author?: string;
    /** Viewer slot this was scored in. Present for viewer-scoped dispatches. */
    viewerId?: string;
    /** Slide slot within the viewer. */
    backgroundId?: string;
};

const BUNDLE_VERSION = 1;

/** Slide identity. `tileSourceId` first — DICOMweb shares `baseUrl` across slides. */
function slideIdOf(viewer: any): string | undefined {
    const item = viewer?.scalebar?.getReferencedTiledImage?.() || viewer?.world?.getItemAt?.(0);
    const source = item?.source;
    return source?.tileSourceId || source?.url || undefined;
}

/** Composite slot key. Mirrors how the pipeline keys per-viewer-background bundles. */
function slotKey(viewerId: string | undefined, backgroundId: string | undefined): string {
    return `${viewerId ?? "_global"}::${backgroundId ?? "_any"}`;
}

function isFiniteNumber(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v);
}

addPlugin("slide-scoring", class extends XOpatPlugin {
    private _schema!: ScoreSchema;
    private _resource: any;
    /** slotKey -> the slide's current score. One score per slide per scoreKey. */
    private _scores = new Map<string, ScoreRecord>();
    /**
     * One bar per *viewer instance*, keyed by the viewer object — not by slot.
     * A slot key changes when the viewer swaps slides, which would strand the
     * old bar's DOM in the cell; the viewer reference is stable for the
     * viewer's whole life and is collision-free even when two viewports share
     * a uniqueId.
     */
    private _bars = new Map<any, { refresh: () => void }>();
    private _canScore = true;
    private _disposeCan?: () => void;

    constructor(id: string) {
        super(id);
        this._schema = this._readSchema();
    }

    /**
     * The scoring vocabulary is genuine deployment config, so it comes from
     * `getStaticMeta` (include.json merged with `ENV.plugins.slide-scoring`),
     * never `getOption` — a session bundle must not be able to redefine what a
     * score means before it is written to a shared tracker.
     */
    private _readSchema(): ScoreSchema {
        const raw = (this.getStaticMeta("scoreSchema") ?? {}) as Partial<ScoreSchema>;
        const labels: Record<string, ScoreValue> = {};
        for (const [label, value] of Object.entries(raw.labels ?? {})) {
            if (isFiniteNumber(value)) labels[label] = value;
        }
        if (!Object.keys(labels).length) {
            console.warn("[slide-scoring] no usable labels in scoreSchema; falling back to a binary vocabulary.");
            labels.negative = 0;
            labels.positive = 1;
        }
        return {
            scoreKey: typeof raw.scoreKey === "string" && raw.scoreKey ? raw.scoreKey : "score",
            labels,
        };
    }

    async pluginReady() {
        await this.loadLocale();

        this._resource = this.defineResource<ScoreRecord>({
            name: "score",
            // One score per (slot, scoreKey): re-scoring the same slide replaces
            // the pending op rather than queuing a second one.
            identityOf: (item) => slotKey(item?.viewerId, item?.backgroundId) + "::" + (item?.scoreKey ?? ""),
            coalesce: true,
            merge: (prev, next) => ({ ...(prev || {}), ...(next || {}) }) as ScoreRecord,
            persistOutbox: true,
            // Records arrive from our own UI, but also from an imported bundle
            // or a peer session — treat every payload as adversarial.
            validate: (item, ctx) => {
                if (ctx?.direction === "delete") return { ok: true };
                const bad = this._checkRecord(item);
                if (bad) return bad;
                return { ok: true };
            },
            serialize: (item) => ({ ...item }),
            deserialize: (raw) => raw as ScoreRecord,
        });

        await this.initIO({
            // Scores belong to a slide, not a session: the pipeline keys by
            // (viewerId, backgroundId) and viewer-open-pipeline flushes on
            // slide-out / restores on slide-in for us.
            bundleScope: "per-viewer-background",
            exportBundle: (ctx) => this._exportBundle(ctx),
            importBundle: (ctx, data) => this._importBundle(ctx, data),
        });

        // Rights are auto-derived from io.capabilities as
        // `<ownerId>.<capabilityId>.<direction>`. Fires immediately, then on change.
        this._disposeCan = this.onCapabilityChange("slide-scoring.crud:score.create", (enabled) => {
            this._canScore = enabled;
            this._refreshBars();
        });

        // Derive the viewer from the event source — never a global. `open`
        // fires again on every slide change, which is also when the bar must
        // repaint for the newly-opened slide's score.
        VIEWER_MANAGER.broadcastHandler("open", (e: any) => this._mountViewerBar(e.eventSource));
        // Resolve by the viewer object: e.uniqueId would collide when two
        // viewports share a background id and drop the wrong viewer's bar.
        VIEWER_MANAGER.addHandler("viewer-destroy", (e: any) => this._bars.delete(e.viewer));
    }

    // ---- validation -------------------------------------------------------

    private _checkRecord(item: unknown): IOResult | undefined {
        if (!item || typeof item !== "object") {
            return { ok: false, refused: true, reason: "score is not an object",
                userMessage: this.t("error.failed", { reason: "malformed record" }) };
        }
        const r = item as Partial<ScoreRecord>;
        if (typeof r.slideId !== "string" || !r.slideId) {
            return { ok: false, refused: true, reason: "score has no slideId",
                userMessage: this.t("error.noSlideId") };
        }
        if (typeof r.scoreKey !== "string" || !r.scoreKey) {
            return { ok: false, refused: true, reason: "score has no scoreKey",
                userMessage: this.t("error.badSchema") };
        }
        if (!isFiniteNumber(r.value)) {
            return { ok: false, refused: true, reason: "score value is not a finite number",
                userMessage: this.t("error.badSchema") };
        }
        return undefined;
    }

    // ---- IO bundles -------------------------------------------------------

    private _exportBundle(ctx: IOContext): unknown {
        const record = this._scores.get(slotKey(ctx.viewerId, ctx.backgroundId));
        if (!record) return undefined;
        return { version: BUNDLE_VERSION, scores: [record] };
    }

    private _importBundle(ctx: IOContext, data: unknown): void {
        if (!data) return;
        const parsed = typeof data === "string" ? this._parseJson(data) : data;
        const scores = (parsed as any)?.scores;
        if (!Array.isArray(scores)) {
            console.warn("[slide-scoring] bundle carries no scores array; ignored.");
            return;
        }
        for (const raw of scores) {
            if (this._checkRecord(raw)) continue; // drop unusable records, keep the rest
            const record = raw as ScoreRecord;
            const key = slotKey(ctx.viewerId ?? record.viewerId, ctx.backgroundId ?? record.backgroundId);
            this._scores.set(key, { ...record, viewerId: ctx.viewerId, backgroundId: ctx.backgroundId });
        }
        this._refreshBars();
    }

    /** Repaint every mounted bar. Each recomputes its own slot, so this is safe
     *  regardless of which viewer's score changed. Viewer counts are small. */
    private _refreshBars(): void {
        for (const bar of this._bars.values()) bar.refresh();
    }

    private _parseJson(text: string): unknown {
        try {
            return JSON.parse(text);
        } catch (e) {
            console.warn("[slide-scoring] bundle is not valid JSON; ignored.", e);
            Dialogs.show(this.t("error.importFailed"), 4000, Dialogs.MSG_WARN);
            return undefined;
        }
    }

    // ---- public API -------------------------------------------------------

    /**
     * Score the slide open in `viewer`. The viewer is explicit on purpose —
     * callers must say which viewport they mean.
     * @return the stored record, or undefined when the score was refused.
     */
    async scoreSlide(viewer: any, label: string): Promise<ScoreRecord | undefined> {
        if (!viewer) {
            Dialogs.show(this.t("error.noViewer"), 4000, Dialogs.MSG_WARN);
            return undefined;
        }
        if (!this._canScore) {
            Dialogs.show(this.t("error.notPermitted"), 4000, Dialogs.MSG_WARN);
            return undefined;
        }
        const value = this._schema.labels[label];
        if (!isFiniteNumber(value)) {
            Dialogs.show(this.t("error.badSchema"), 4000, Dialogs.MSG_ERR);
            return undefined;
        }
        const slideId = slideIdOf(viewer);
        if (!slideId) {
            Dialogs.show(this.t("error.noSlideId"), 4000, Dialogs.MSG_WARN);
            return undefined;
        }

        const viewerId = viewer.uniqueId;
        const backgroundId = UTILITIES.currentBackgroundIdFor(viewer);
        const key = slotKey(viewerId, backgroundId);
        const record: ScoreRecord = {
            slideId,
            scoreKey: this._schema.scoreKey,
            value,
            label,
            ts: Date.now(),
            author: XOpatUser.instance()?.name || undefined,
            viewerId,
            backgroundId,
        };

        const previous = this._scores.get(key);
        // `apply` commits locally only once the guards have passed, so a
        // refused score never paints as applied.
        const result = previous
            ? this._resource.update(key, record, { apply: () => this._commit(key, record) })
            : this._resource.create(record, { apply: () => this._commit(key, record) });

        if (!result.ok) {
            const reason = (result as any).userMessage || (result as any).reason || "";
            Dialogs.show(this.t("error.failed", { reason }), 5000, Dialogs.MSG_ERR);
            return undefined;
        }
        Dialogs.show(this.t("message.scored", { label: this._labelText(label) }), 2000, Dialogs.MSG_INFO);

        // Surface an eventual sink refusal (the local commit already happened).
        result.settled.then((settled: IOResult) => {
            if (!settled.ok) {
                const reason = settled.userMessage || settled.reason || "";
                Dialogs.show(this.t("error.failed", { reason }), 6000, Dialogs.MSG_ERR);
            }
        });
        return record;
    }

    /** Current score of the slide open in `viewer`, if any. */
    getScore(viewer: any): ScoreRecord | undefined {
        return this._scores.get(slotKey(viewer?.uniqueId, UTILITIES.currentBackgroundIdFor(viewer)));
    }

    /** The scoring vocabulary in effect. */
    getSchema(): ScoreSchema {
        return { scoreKey: this._schema.scoreKey, labels: { ...this._schema.labels } };
    }

    private _commit(key: string, record: ScoreRecord): void {
        this._scores.set(key, record);
        this._refreshBars();
        this.raiseEvent("score-changed", { record });
    }

    /**
     * Display text for a label id. A deployment can define its own vocabulary
     * (e.g. a 1–5 grade scale) that the shipped bundle has no text for, and
     * `$.t` never fails — it returns the key's last segment — so ask i18next
     * whether the key exists rather than trying to detect the fallback.
     */
    private _labelText(label: string): string {
        const key = `label.${label}`;
        return $.i18n?.exists(key, { ns: this.id }) ? this.t(key) : label;
    }

    // ---- UI ---------------------------------------------------------------

    /**
     * One control bar per viewer, built for that viewer instance and closed
     * over it. Nothing here resolves a viewer at click time.
     */
    private _mountViewerBar(viewer: any): void {
        if (!viewer) return;
        // `open` re-fires on every slide change; the bar outlives the slide, so
        // only repaint it for the newly-opened slide's score.
        if (this._bars.has(viewer)) {
            this._bars.get(viewer)!.refresh();
            return;
        }

        const labels = Object.keys(this._schema.labels);
        const buttons = labels.map((label) => new UI.Button({
            // The viewer is captured here, at build time. Nothing resolves a
            // viewer at click time — hover alone re-targets the active viewer,
            // so a click-time lookup would score the wrong viewport.
            onClick: () => this.scoreSlide(viewer, label),
            extraClasses: { size: "btn-sm", style: "btn-ghost" },
            title: this.t("toolbar.scoreLabel", { label: this._labelText(label) }),
        }, this._labelText(label)));

        const bar = new UI.Div({
            id: `slide-scoring-bar-${viewer.id}`,
            extraClasses: {
                layout: "flex flex-row gap-1 items-center",
                style: "bg-base-100 rounded-md px-2 py-1 shadow-md pointer-events-auto",
                position: "absolute bottom-2 left-1/2 -translate-x-1/2",
            },
        }, ...buttons);

        const refresh = () => {
            // Recomputed per call: the viewer's slide (and so its slot key)
            // changes underneath a bar that is mounted once.
            const current = this._scores.get(slotKey(viewer.uniqueId, UTILITIES.currentBackgroundIdFor(viewer)));
            labels.forEach((label, i) => {
                buttons[i].setClass("style", current?.label === label ? "btn-primary" : "btn-ghost");
                buttons[i].setClass("state", this._canScore ? "" : "btn-disabled");
            });
        };

        this._bars.set(viewer, { refresh });
        USER_INTERFACE.addViewerHtml(bar, this.id, viewer);
        refresh();
    }
});
