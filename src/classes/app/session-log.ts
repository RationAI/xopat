/**
 * The session timeline — what happened in this browser sitting, in order.
 *
 * Written for one job: reconstructing a pilot session afterwards. The chat
 * transcript already answers "what was asked and answered"; on its own it cannot
 * say which slide the participant had open, whether the viewer even loaded, when
 * they logged in, or whether the thing they were reacting to was an error. This
 * fills exactly that gap and nothing more.
 *
 * Deliberately NOT an interaction trail. There is no viewport-move, no mouse, no
 * per-frame anything: those are orders of magnitude more volume, need sampling to
 * be affordable, and answer a different question ("how did they navigate") than
 * the one a pilot usually asks ("what did they work on, and what happened").
 * If that becomes the question, it belongs on its own channel with its own
 * budget — not smuggled into this one.
 *
 * Every record carries the browser-session id the broker stamps on forwarded
 * batches, so a sitting groups together without anyone logging an identity: the
 * server pairs it with the hashed principal it already knows. See src/LOGGING.md.
 */

const CHANNEL = "session";

/** How long a slide id may be in a record. Ids are ours, but they arrive from config. */
const MAX_ID_CHARS = 200;

function shorten(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value);
    return text.length > MAX_ID_CHARS ? `${text.slice(0, MAX_ID_CHARS)}…` : text;
}

/**
 * Describe what a viewer currently shows, in the terms a reconstruction needs:
 * WHICH slide (the id an operator can look up), and enough scale to know whether
 * it opened properly.
 *
 * Keyed by `tileSourceId` rather than a URL — DICOMweb shares one baseUrl across
 * slides, so a URL identifies the server, not the specimen (AGENTS.md §8).
 */
function describeViewer(viewer: any): Record<string, unknown> {
    const item = viewer?.world?.getItemAt?.(0);
    const source: any = item?.source;
    const size = item?.getContentSize?.();
    return {
        viewerId: shorten(viewer?.uniqueId),
        tileSourceId: shorten(source?.tileSourceId),
        width: size?.x ?? null,
        height: size?.y ?? null,
        magnification: viewer?.scalebar?.magnification ?? null,
    };
}

/**
 * Subscribe the session channel to the events that mark out a sitting.
 *
 * Handlers are individually guarded: a diagnostic that throws inside a core event
 * handler would take the event with it, and this one exists precisely for runs
 * where something is already going wrong.
 */
export function wireSessionLog(): void {
    const context: any = (globalThis as any).APPLICATION_CONTEXT;
    const log = context?.log?.(CHANNEL);
    if (!log) return;

    const safely = (what: string, fn: () => void) => {
        try { fn(); } catch (e: any) { log.debug({ what, error: e?.message || String(e) }, 'session log skipped'); }
    };

    // Boot: the frame of reference for every later line — which build, which
    // deployment, and what the participant was actually looking at it on.
    safely('boot', () => log.info({
        version: shorten(context.env?.version),
        production: context.env?.client?.production === true,
        secureMode: context.secureMode === true,
        locale: shorten((globalThis as any).$?.i18n?.language),
        viewport: {
            width: (globalThis as any).innerWidth ?? null,
            height: (globalThis as any).innerHeight ?? null,
            dpr: (globalThis as any).devicePixelRatio ?? null,
        },
        userAgent: shorten((globalThis as any).navigator?.userAgent),
    }, 'session started'));

    const manager: any = (globalThis as any).VIEWER_MANAGER;
    if (manager?.addHandler) {
        // The slide (or slides) the participant is working on. `after-open` fires
        // once the whole viewing session settled, so one record describes the
        // grid rather than N racing ones.
        const reportSlides = () => safely('slides', () => {
            const viewers: any[] = manager.viewers || [];
            log.info({
                viewerCount: viewers.length,
                viewers: viewers.map(describeViewer),
            }, 'slides opened');
        });

        manager.addHandler('after-open', reportSlides);
        // Subscribing is not the same as having been there: this runs after the
        // viewer is up, so the FIRST open — the one that says what the
        // participant actually came to look at — has already fired. Report the
        // state we find, then follow it. Missing the opening slide would gut the
        // record for exactly the sessions that went straight to work.
        if ((manager.viewers || []).length) reportSlides();

        manager.addHandler('viewer-create', (e: any) => safely('viewer-create', () => {
            log.info({ viewerId: shorten(e?.uniqueId), index: e?.index }, 'viewer created');
        }));

        manager.addHandler('viewer-destroy', (e: any) => safely('viewer-destroy', () => {
            log.info({ viewerId: shorten(e?.uniqueId), index: e?.index }, 'viewer destroyed');
        }));
    }

    // Login is part of the timeline: a pilot run that behaved oddly because the
    // participant was never authenticated looks identical to one that was, until
    // you can see this.
    const auth: any = context.auth;
    if (auth?.addHandler) {
        auth.addHandler('context-settled', (e: any) => safely('auth', () => {
            log.info({
                contextId: shorten(e?.contextId),
                authenticated: e?.authenticated === true || e?.ok === true,
            }, 'auth settled');
        }));
    }

    // What the pathology model was pointed at, from the browser's side.
    //
    // A REMOTE analysis is logged server-side with the image itself
    // (`module.vercel-ai-chat-sdk:vision`). A LOCAL one — the built-in tissue
    // mask, the in-browser segmenter — sends nothing anywhere, so this is the
    // only place it can be recorded. Bounds only, never pixels: the point is
    // "the model looked here", and the browser cannot ship an image into a log.
    const pathology: any = (globalThis as any).singletonModule?.('pathology-foundation');
    if (pathology?.addHandler) {
        pathology.addHandler('analysis-started', (e: any) => safely('analysis', () => {
            log.info({
                driver: shorten(e?.driver),
                feature: shorten(e?.feature),
                region: e?.region ?? null,
            }, 'analysis started');
        }));
    }

    // The end of the sitting, so a session that stops has a reason (left) rather
    // than just an absence of further lines.
    (globalThis as any).addEventListener?.('pagehide', () => safely('end', () => {
        log.info({}, 'session ended');
    }));
}
