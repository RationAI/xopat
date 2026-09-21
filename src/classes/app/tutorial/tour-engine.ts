/**
 * The tutorial step machine.
 *
 * Replaces `EnjoyHint` from the former `src/external/enjoyhint.js` — same step
 * grammar, same options, same visuals, no jQuery and no KineticJS. The step
 * format is documented in `src/TUTORIALS.md`; nothing a tutorial author writes
 * had to change.
 *
 * Differences from the old engine, all deliberate:
 *  - selectors resolve through `document.querySelector`. Every shipped step
 *    already used plain CSS; jQuery-only pseudo-selectors were never valid in
 *    a step key.
 *  - per-step listeners are torn down through an `AbortController` instead of
 *    jQuery event namespaces.
 *  - the engine owns its own `resize`/`click` listeners rather than expecting
 *    the caller to wire `reRender`/`rePaint` onto `window`.
 *  - `$("button").focusout(stopImmediatePropagation)` is gone. It was a global
 *    side effect installed on every button in the page at tour start and never
 *    unbound, and it silently killed unrelated focusout handlers.
 */
import { TourOverlayCanvas, type HoleBounds } from "./overlay-canvas";
import { TourChrome } from "./tour-chrome";
import { placeLabel, placeButtonRow, clampIntoViewport, type ShapeBox } from "./step-layout";

const ANIMATION_TIME = 800;
const MOBILE_MAX_WIDTH = 640;
const DEFAULT_SHAPE_MARGIN = 10;
const DEFAULT_SCROLL_SPEED = 250;
const SCROLL_CONTAINER_ID = "main-panel-content";
const SCROLL_OFFSET = -200;

export interface TourStep {
    /** `"<event> <selector>"` → description. Exactly one such key per step. */
    [rule: string]: any;
    runIf?: () => boolean;
}

export interface TourHooks {
    onStart?: () => void;
    onEnd?: () => void;
    onSkip?: () => void;
    onNext?: () => void;
}

export interface TourOptions extends TourHooks {
    backgroundColor?: string;
}

/** A step after its `"<event> <selector>"` key has been parsed out. */
interface NormalizedStep {
    raw: TourStep;
    event: string;
    /** Set only for the three engine-driven pseudo-events. */
    eventType?: "next" | "auto" | "custom";
    selector: string;
    description: string;
}

const KEY_NAMES: Record<number, string> = {
    8: "Backspace", 9: "Tab", 13: "Enter", 16: "Shift", 17: "Ctrl", 18: "Alt",
    19: "Pause", 20: "Caps Lock", 27: "Esc", 32: "Space",
    33: "Page Up", 34: "Page Down", 35: "End", 36: "Home",
    37: "←", 38: "↑", 39: "→", 40: "↓",
    45: "Insert", 46: "Delete",
};

function keyCodeName(code: number | undefined): string {
    if (code == null) return "";
    if (KEY_NAMES[code]) return KEY_NAMES[code]!;
    if (code >= 48 && code <= 90) return String.fromCharCode(code);
    if (code >= 112 && code <= 123) return `F${code - 111}`;
    return `key ${code}`;
}

export class TourEngine {
    private steps: TourStep[] = [];
    private currentStep = 0;
    private lastSelector: string | null = null;
    private running = false;

    private options: TourOptions = {};
    private root: HTMLDivElement | null = null;
    private chrome: TourChrome | null = null;
    private overlay: TourOverlayCanvas | null = null;

    /** Torn down on every step change; carries the step's DOM listeners. */
    private stepAbort: AbortController | null = null;
    /** Torn down when the tour ends; carries window/document listeners. */
    private tourAbort: AbortController | null = null;
    private readonly bus = new EventTarget();
    private pendingTimers: number[] = [];

    /** Element the active step is anchored to — the repaint source of truth. */
    private activeElement: Element | null = null;
    private activeStep: NormalizedStep | null = null;
    private activeBounds: HoleBounds | null = null;

    // ── public API ────────────────────────────────────────────────────

    /** True while a tour is on screen. Guards double-launch. */
    get isRunning(): boolean { return this.running; }

    setScript(steps: TourStep[]): void {
        if (!Array.isArray(steps) || steps.length < 1) {
            throw new Error("Tutorial step list is empty or not an array.");
        }
        this.steps = steps;
    }
    /** Deprecated aliases kept for the former EnjoyHint surface. */
    set(steps: TourStep[]): void { this.setScript(steps); }
    setSteps(steps: TourStep[]): void { this.setScript(steps); }

    /**
     * Run `steps` to completion. The single entry point used by
     * `USER_INTERFACE.Tutorials.run`.
     */
    run(steps?: TourStep[], hooks?: TourOptions): void {
        if (steps) this.setScript(steps);
        this.options = hooks ?? {};
        this.mount();
        this.currentStep = 0;
        this.options.onStart?.();
        this.stepAction(0);
    }
    runScript(): void { this.run(); }
    resume(): void { this.stepAction(this.currentStep); }
    resumeScript(): void { this.resume(); }
    reRunScript(step: number): void { this.stepAction(step); }

    setCurrentStep(step: number): void { this.currentStep = step; }
    getCurrentStep(): number { return this.currentStep; }

    /** Abort the tour without running `onEnd` — this is the user skipping. */
    stop(): void { this.teardown(); }

    trigger(eventName: string): void {
        if (eventName === "next") this.stepAction(this.currentStep + 1);
        else if (eventName === "skip") this.skipAll();
        else this.bus.dispatchEvent(new Event(eventName));
    }

    // ── lifecycle ─────────────────────────────────────────────────────

    private mount(): void {
        this.teardown();
        this.running = true;
        this.tourAbort = new AbortController();
        const signal = this.tourAbort.signal;

        this.root = document.createElement("div");
        this.root.className = "xo-tour-root";
        document.body.appendChild(this.root);
        document.body.classList.add("xo-tour-locked");

        this.overlay = new TourOverlayCanvas(this.root, this.options.backgroundColor || "rgba(0,0,0,0.6)");
        this.chrome = new TourChrome(this.root, {
            onNext: () => this.stepAction(this.currentStep + 1),
            onPrev: () => this.stepAction(this.currentStep - 1),
            onSkip: () => { this.options.onSkip?.(); this.skipAll(); },
        });

        // Touch scroll would slide the page out from under a fixed overlay.
        document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false, signal });
        window.addEventListener("resize", () => this.reRender(), { signal });
        // A click anywhere can move the target (a panel opens, a list scrolls);
        // re-measure rather than leave the highlight behind.
        window.addEventListener("click", () => this.rePaint(), { signal });
    }

    private teardown(): void {
        this.clearTimers();
        this.stepAbort?.abort();
        this.stepAbort = null;
        this.tourAbort?.abort();
        this.tourAbort = null;
        this.overlay?.destroy();
        this.overlay = null;
        this.chrome?.destroy();
        this.chrome = null;
        this.root?.remove();
        this.root = null;
        document.body.classList.remove("xo-tour-locked");
        this.activeElement = null;
        this.activeStep = null;
        this.activeBounds = null;
        this.lastSelector = null;
        this.running = false;
    }

    private skipAll(): void { this.teardown(); }

    private finish(): void {
        this.teardown();
        this.options.onEnd?.();
    }

    private clearTimers(): void {
        for (const t of this.pendingTimers) clearTimeout(t);
        this.pendingTimers = [];
    }

    private later(fn: () => void, ms: number): void {
        this.pendingTimers.push(window.setTimeout(fn, ms));
    }

    // ── step machine ──────────────────────────────────────────────────

    /**
     * Parse the `"<event> <selector>"` rule key. Kept lazy and cached on the
     * raw object exactly like the old engine, so a step re-visited by Prev
     * does not re-parse.
     */
    private normalize(raw: TourStep): NormalizedStep | null {
        if (raw.__xoNormalized) return raw.__xoNormalized as NormalizedStep;
        for (const prop of Object.keys(raw)) {
            if (prop === "runIf") continue;
            const parsed = prop.split(" ");
            if (parsed.length < 2 || !parsed[1]) continue;
            const event = parsed[0]!;
            const normalized: NormalizedStep = {
                raw,
                event,
                selector: parsed.slice(1).join(" "),
                description: raw[prop],
            };
            if (event === "next" || event === "auto" || event === "custom") {
                normalized.eventType = event;
            }
            Object.defineProperty(raw, "__xoNormalized", { value: normalized, enumerable: false });
            return normalized;
        }
        return null;
    }

    private isLastStep(): boolean {
        return !this.steps[this.currentStep + 1];
    }

    private stepAction(step: number): void {
        if (!this.running) return;
        if (step < 0) { step = 0; this.currentStep = 0; }

        const raw = this.steps[step];
        if (!raw) { this.finish(); return; }

        const normalized = this.normalize(raw);
        // Direction matters: a step skipped while walking backwards must keep
        // walking backwards, or Prev bounces off an invisible step forever.
        const goingBack = this.currentStep > step;
        const skipToNeighbour = () => this.stepAction(goingBack ? step - 1 : step + 1);

        if (!normalized) { skipToNeighbour(); return; }

        const element = document.querySelector(normalized.selector);
        if (!element) {
            console.warn("Tutorial selector", normalized.selector, "matches nothing — skipping step.");
            skipToNeighbour();
            return;
        }
        if (typeof raw.runIf === "function" && !raw.runIf()) { skipToNeighbour(); return; }

        this.currentStep = step;
        this.options.onNext?.();
        raw.onBeforeStart?.();

        const isNew = this.lastSelector !== normalized.selector;
        this.lastSelector = normalized.selector;

        this.later(() => this.enterStep(normalized, element, isNew), raw.timeout || 0);
    }

    private enterStep(step: NormalizedStep, element: Element, isNew: boolean): void {
        if (!this.running || !this.chrome || !this.overlay) return;
        const raw = step.raw;
        let scrollSpeed: number = raw.scrollAnimationSpeed || DEFAULT_SCROLL_SPEED;

        if (isNew) {
            const bounds = element.getBoundingClientRect();
            const viewportH = window.innerHeight || document.documentElement.clientHeight;
            if (bounds.top < 0 || bounds.bottom > viewportH) {
                this.hideCurrentHint();
                this.scrollIntoView(element);
            } else {
                // Already visible: a custom scroll speed would only add a stall.
                scrollSpeed = DEFAULT_SCROLL_SPEED;
            }
        }

        this.later(() => this.renderStep(step, element, isNew), scrollSpeed + 20);
    }

    /**
     * Bring `element` into view. The old engine unconditionally scrolled
     * `#main-panel-content` (with a `todo fixme` about whether the element was
     * even inside it); anything elsewhere on the page silently did not scroll.
     */
    private scrollIntoView(element: Element): void {
        const container = document.getElementById(SCROLL_CONTAINER_ID);
        if (container && container.contains(element)) {
            const cRect = container.getBoundingClientRect();
            const eRect = element.getBoundingClientRect();
            container.scrollTo({
                top: container.scrollTop + (eRect.top - cRect.top) + SCROLL_OFFSET,
                behavior: "smooth",
            });
            return;
        }
        element.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    private hideCurrentHint(): void {
        this.overlay?.renderCircle(0, 0, 0, 0);
        this.chrome?.clearArrow();
        if (!this.chrome) return;
        TourChrome.setVisible(this.chrome.prevBtn, false);
        TourChrome.setVisible(this.chrome.nextBtn, false);
        TourChrome.setVisible(this.chrome.skipBtn, false);
    }

    private renderStep(step: NormalizedStep, element: Element, isNew: boolean): void {
        if (!this.running || !this.chrome || !this.overlay) return;
        const raw = step.raw;

        this.stepAbort?.abort();
        this.stepAbort = new AbortController();
        const signal = this.stepAbort.signal;

        this.activeElement = element;
        this.activeStep = step;
        if (isNew) this.chrome.setHidden(false);

        const eventTarget = raw.event_selector
            ? document.querySelector(raw.event_selector) ?? element
            : element;

        // Button visibility: Next is hidden unless the step opts in, or the
        // rule key itself is `next` (handled in the switch below).
        TourChrome.setVisible(this.chrome.nextBtn, raw.showNext === true);
        TourChrome.setVisible(this.chrome.prevBtn, !!raw.showPrev && this.currentStep !== 0);
        TourChrome.setVisible(this.chrome.skipBtn, raw.showSkip !== false);

        const advance = () => this.stepAction(this.currentStep + 1);

        if (!step.eventType && step.event === "key") {
            element.addEventListener("keydown", (e) => {
                if ((e as KeyboardEvent).keyCode === raw.keyCode) advance();
            }, { signal });
        }

        switch (step.eventType) {
            case "auto":
                // Advance as soon as the step is on screen. (The old engine
                // additionally tried `$element['auto']()`, which threw — the
                // call was never reachable in a working state.)
                advance();
                return;
            case "custom":
                this.bus.addEventListener(step.event, () => advance(), { once: true, signal });
                break;
            case "next":
                TourChrome.setVisible(this.chrome.nextBtn, true);
                break;
            default:
                eventTarget.addEventListener(step.event, (e: Event) => {
                    if (raw.keyCode && (e as KeyboardEvent).keyCode !== raw.keyCode) return;
                    advance();
                }, { signal });
                break;
        }

        const rect = element.getBoundingClientRect();
        const shapeMargin = raw.margin !== undefined ? raw.margin : DEFAULT_SHAPE_MARGIN;
        const centerX = rect.left + Math.round(rect.width / 2);
        const centerY = rect.top + Math.round(rect.height / 2);

        if (centerX === 0 && centerY === 0) {
            console.error("Tutorial: element position could not be resolved.");
            this.teardown();
            return;
        }

        const isCircle = raw.shape === "circle";
        this.paintStep({
            centerX, centerY,
            width: rect.width + shapeMargin,
            height: rect.height + shapeMargin,
            radius: isCircle
                ? (raw.radius || Math.round(Math.max(rect.width, rect.height) / 2) + 5)
                : 0,
            isCircle,
            offsets: {
                top: raw.top || 0, bottom: raw.bottom || 0,
                left: raw.left || 0, right: raw.right || 0,
            },
            text: step.description,
            arrowColor: raw.arrowColor,
        });
    }

    /**
     * Apply the per-step offsets, cut the hole, then — when `full` — place the
     * label, arrow and button row. Ported from `renderLabelWithShape`.
     *
     * `full: false` is the cheap path used on every click: the target may have
     * moved, but re-laying the label out (and replaying the fade) on every
     * click would flicker.
     */
    private paintStep(input: {
        centerX: number; centerY: number; width: number; height: number; radius: number;
        isCircle: boolean;
        offsets: { top: number; bottom: number; left: number; right: number };
        text: string;
        arrowColor?: string;
    }, full = true): void {
        const chrome = this.chrome!;
        const overlay = this.overlay!;

        let { centerX, centerY, width, height, radius } = input;
        let halfW: number;
        let halfH: number;
        let bounds: HoleBounds;

        if (input.isCircle) {
            halfW = halfH = radius;
            const sides = {
                top: centerY - halfH + input.offsets.top,
                bottom: centerY + halfH - input.offsets.bottom,
                left: centerX - halfW + input.offsets.left,
                right: centerX + halfW - input.offsets.right,
            };
            const w = sides.right - sides.left;
            const h = sides.bottom - sides.top;
            radius = Math.round(Math.min(w, h) / 2);
            // NOTE: half of the radius, not the radius — preserved from the
            // original, since the label placement was tuned against it.
            halfW = halfH = Math.round(radius / 2);
            centerX = sides.left + Math.round(w / 2);
            centerY = sides.top + Math.round(h / 2);
            width = height = radius * 2;
            bounds = overlay.renderCircle(centerX, centerY, radius, 200);
        } else {
            halfW = Math.round(width / 2);
            halfH = Math.round(height / 2);
            const sides = {
                top: centerY - halfH + input.offsets.top,
                bottom: centerY + halfH - input.offsets.bottom,
                left: centerX - halfW + input.offsets.left,
                right: centerX + halfW - input.offsets.right,
            };
            width = sides.right - sides.left;
            height = sides.bottom - sides.top;
            halfW = Math.round(width / 2);
            halfH = Math.round(height / 2);
            centerX = sides.left + halfW;
            centerY = sides.top + halfH;
            bounds = overlay.renderRect(centerX, centerY, width, height, radius, 200);
        }

        this.activeBounds = bounds;
        overlay.blockAround(bounds);
        if (!full) return;

        // Measure the label at its natural size before committing a position.
        chrome.setLabel(input.text, 0, 0);
        const measured = chrome.label.getBoundingClientRect();

        const box: ShapeBox = { centerX, centerY, width, height, halfW, halfH };
        const placement = placeLabel(box, measured.width, measured.height);

        chrome.label.classList.toggle("xo-tour-label-oversized", placement.oversized);
        TourChrome.place(chrome.label, placement.labelX, placement.labelY);

        // Clamp against the real rendered rect, then re-read it — a wrapped
        // label changes height once it is actually positioned.
        let rect = chrome.label.getBoundingClientRect();
        const clamped = clampIntoViewport(placement.labelX, placement.labelY, rect);
        TourChrome.place(chrome.label, clamped.x, clamped.y);
        rect = chrome.label.getBoundingClientRect();

        this.layoutControls({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });

        if (placement.arrow && !placement.oversized) {
            chrome.drawArrow(placement.arrow, input.arrowColor);
        } else {
            chrome.clearArrow();
        }

        // Fade the layer in once everything is in its final position.
        chrome.setFaded(true);
        this.later(() => chrome.setFaded(false), ANIMATION_TIME / 2);
    }

    private layoutControls(label: { x: number; y: number; width: number; height: number }): void {
        const chrome = this.chrome!;
        const isMobile = window.innerWidth <= MOBILE_MAX_WIDTH;
        const finish = this.isLastStep();
        const raw = this.activeStep?.raw ?? {};

        const nextText = raw.nextButton?.text
            ?? (finish ? $.t("tutorials.enjoyhint.finish") : $.t("tutorials.enjoyhint.next"));
        const prevText = raw.prevButton?.text ?? $.t("tutorials.enjoyhint.back");
        chrome.setNextContent(nextText, finish, isMobile);
        chrome.setPrevContent(prevText, isMobile);

        // The action hint stands in for Next whenever the user must perform a
        // gesture on the highlighted target instead of pressing a button.
        const nextHidden = !TourChrome.isVisible(chrome.nextBtn);
        chrome.setActionHint(nextHidden ? this.resolveActionHint() : null, isMobile);

        const result = placeButtonRow(
            label,
            [
                { width: TourChrome.widthOf(chrome.skipBtn, 40), place: (l, t) => TourChrome.place(chrome.skipBtn, l, t) },
                { width: TourChrome.widthOf(chrome.prevBtn, 96), place: (l, t) => TourChrome.place(chrome.prevBtn, l, t) },
            ],
            [
                { width: TourChrome.widthOf(chrome.nextBtn, 96), place: (l, t) => TourChrome.place(chrome.nextBtn, l, t) },
                { width: TourChrome.widthOf(chrome.actionHint, 180), place: (l, t) => TourChrome.place(chrome.actionHint, l, t) },
            ],
            isMobile,
        );
        if (result.labelY !== label.y) chrome.label.style.top = `${result.labelY}px`;
    }

    /** Copy + icon telling the user which gesture advances the step. */
    private resolveActionHint(): { icon: string; text: string } | null {
        const step = this.activeStep;
        if (!step) return null;
        const ev = step.event;
        if (ev === "next" || ev === "auto") return null;
        if (ev === "click") return { icon: "ph-hand-pointing", text: $.t("tutorials.enjoyhint.hint.click") };
        if (ev === "dblclick") return { icon: "ph-cursor-click", text: $.t("tutorials.enjoyhint.hint.dblclick") };
        if (ev === "key") {
            const key = keyCodeName(step.raw.keyCode);
            return {
                icon: "ph-keyboard",
                text: key ? $.t("tutorials.enjoyhint.hint.key", { key }) : $.t("tutorials.enjoyhint.hint.keyAny"),
            };
        }
        if (ev === "custom") return { icon: "ph-hourglass-medium", text: $.t("tutorials.enjoyhint.hint.waiting") };
        return { icon: "ph-cursor", text: $.t("tutorials.enjoyhint.hint.interact") };
    }

    // ── live re-measurement ───────────────────────────────────────────

    /**
     * Viewport changed: re-fit the canvas backing store and re-run the FULL
     * layout — a resize moves the target and invalidates the label's chosen
     * region. If the target is gone, end the tour instead of highlighting
     * nothing (the old engine did the same, via `:visible` + `stopFunction`).
     */
    reRender = (): void => {
        if (!this.running) return;
        this.overlay?.resize();
        this.repaintFromTarget(true);
    };

    /**
     * A click may have moved the target (a panel opened, a list scrolled).
     * Re-cut the hole and re-place the blockers only — re-laying the label out
     * on every click would replay the fade and flicker.
     */
    rePaint = (): void => {
        if (!this.running) return;
        this.repaintFromTarget(false);
    };

    private repaintFromTarget(full: boolean): void {
        if (!this.activeElement || !this.activeStep) return;
        const el = this.activeElement as HTMLElement;
        if (!el.isConnected || el.offsetParent === null) {
            this.teardown();
            return;
        }
        const raw = this.activeStep.raw;
        const rect = el.getBoundingClientRect();
        const shapeMargin = raw.margin !== undefined ? raw.margin : DEFAULT_SHAPE_MARGIN;
        const isCircle = raw.shape === "circle";
        this.paintStep({
            centerX: rect.left + Math.round(rect.width / 2),
            centerY: rect.top + Math.round(rect.height / 2),
            width: rect.width + shapeMargin,
            height: rect.height + shapeMargin,
            radius: isCircle
                ? (raw.radius || Math.round(Math.max(rect.width, rect.height) / 2) + 5)
                : 0,
            isCircle,
            offsets: {
                top: raw.top || 0, bottom: raw.bottom || 0,
                left: raw.left || 0, right: raw.right || 0,
            },
            text: this.activeStep.description,
            arrowColor: raw.arrowColor,
        }, full);
    }
}
