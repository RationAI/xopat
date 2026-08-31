/**
 * The audit trail for what a vision model was shown.
 *
 * A pathology run sends up to twenty-eight off-screen renders to a foundation
 * model, and the session that comes back reports conclusions. Without this,
 * nobody can see the pictures those conclusions came from, or even which part of
 * the slide was read: the images exist only in flight through
 * `runVisionInference`, and are gone once the call returns.
 *
 * That function is the one place they can be caught — every remote analyze
 * driver funnels through it, and it holds the bytes, the prompt, the resolved
 * model, and the caller's own account of which slide and box they are
 * (`input.context`, which the browser fills in and which is NEVER sent to the
 * model).
 *
 * Split out of `inference.server.ts` so the projection can be tested against
 * real shapes without dragging in the AI SDK and the provider registry.
 */

/** Node's `Buffer`, declared structurally — module server files carry no node types. */
declare const Buffer: { from(data: string, encoding: string): Uint8Array };

export interface VisionCallOutcome {
    providerId: string;
    model: string;
    text: string;
    durationMs: number;
}

export interface VisionCallInput {
    prompt?: string | null;
    system?: string | null;
    imageBase64?: string | null;
    mediaType?: string | null;
    context?: Record<string, unknown> | null;
}

/**
 * `image/png` → `png`. A file a person can double-click, never an extensionless
 * blob — the whole point is that the reviewed region can be looked at.
 */
export function extensionForMedia(mediaType?: string | null): string {
    // Absent means PNG — that is the documented default of the RPC, and of every
    // render the pathology broker produces. MALFORMED is a different thing and
    // must not be dressed up as PNG: naming a file `.png` when nobody knows what
    // it holds is how an unopenable asset looks like a broken image instead of an
    // unknown one.
    if (mediaType === undefined || mediaType === null || mediaType === '') return 'png';
    const subtype = String(mediaType).split('/')[1] || '';
    const clean = (subtype.split('+')[0] || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!clean) return 'bin';
    return clean === 'jpeg' ? 'jpg' : clean;
}

/**
 * Where this call's image belongs, relative to the transcript's sidecar dir.
 *
 * Derived from the request id: unique per call, already carried on every log
 * record, so the line and the file name each other without inventing an id
 * scheme. Grouped by UTC day so a pilot's directory stays navigable.
 */
export function visionAssetPath(callId: string, mediaType?: string | null, day?: string): string {
    const safe = String(callId || '').replace(/[^A-Za-z0-9_-]/g, '') || 'call';
    const date = day || new Date().toISOString().slice(0, 10);
    return `vision/${date}/${safe}.${extensionForMedia(mediaType)}`;
}

/**
 * Emit one record + the reviewed image.
 *
 * Guarded by `isEnabled`, so a deployment without the channel pays a level
 * lookup — no base64 decode, no record built. Never throws: a diagnostic that
 * breaks an inference call is worse than a missing diagnostic.
 *
 * The image rides out-of-band (`logger.attachment`) and is referenced from the
 * record by the same path, so the NDJSON line stays small and the pixels land in
 * a file. Both are `sensitive`: an image of patient tissue and the question
 * asked about it are payload, not metadata.
 */
export function logVisionCall(
    logger: any,
    callId: string,
    input: VisionCallInput,
    outcome: VisionCallOutcome,
): void {
    if (!logger?.isEnabled?.('trace')) return;
    try {
        const context = (input.context && typeof input.context === 'object') ? input.context : {};
        const file = visionAssetPath(callId, input.mediaType);

        if (input.imageBase64) {
            logger.attachment({
                file,
                bytes: Buffer.from(input.imageBase64, 'base64'),
                ...context,
                providerId: outcome.providerId,
                model: outcome.model,
                mediaType: input.mediaType || 'image/png',
            });
        }
        logger.sensitive({
            ...context,
            providerId: outcome.providerId,
            model: outcome.model,
            // Present only when there was an image — a text-only inference call
            // has no asset, and a line pointing at a file nobody wrote is worse
            // than no line at all.
            ...(input.imageBase64 ? { image: file } : {}),
            prompt: input.prompt || null,
            system: input.system || null,
            findings: outcome.text,
            durationMs: outcome.durationMs,
        }, 'VISION_CALL');
    } catch (e: any) {
        logger.debug?.({ error: e?.message || String(e) }, 'vision call not logged');
    }
}
