/**
 * Attachment bytes belong to the attachment store, not to message history.
 *
 * An upload travels once through `uploadAttachment` and is thereafter addressed
 * by `attachmentId`; the model path resolves the payload per turn from the store
 * (`chat.server.ts` → `hydrateAttachmentIndex`). A part that carries BOTH
 * `attachmentId` and an inline `dataUrl` is therefore shipping the same base64
 * twice — once on the record, once inside the transcript.
 *
 * That duplication is not merely wasteful. The client folds unsynced messages
 * into the turn request as `messagesDelta`, so a single ~1 MB image pushed the
 * body past `sendTurnStream`'s `maxBodyBytes` and the turn failed for the rest
 * of the session (the sync cursor does not advance on a thrown turn, so the same
 * oversized delta was re-sent forever). Stripping on the way OUT is the fix;
 * the server keeps stripping on the way IN so no store — including a
 * deployment's own `setSessionStore` — can be handed the duplicate.
 *
 * Parts with no `attachmentId` are untouched: nothing else holds their bytes.
 * The input message is never mutated — callers keep the inline `dataUrl` for
 * local rendering.
 *
 * Pure module: no `window`, no Node globals. Imported by both the client
 * (`chatService.ts`) and the server (`server/chat.server.ts`).
 */

/** Drop inline payloads that duplicate a stored attachment. Returns the input when nothing changed. */
export function stripDuplicatedPartPayloads(message: ChatMessage): ChatMessage {
    const parts = message?.parts as any[] | undefined;
    if (!parts?.length) return message;
    let changed = false;
    const next = parts.map((part) => {
        if (!part?.attachmentId || typeof part.dataUrl !== 'string') return part;
        changed = true;
        const { dataUrl, ...rest } = part;
        return rest;
    });
    return changed ? { ...message, parts: next } : message;
}

/** `stripDuplicatedPartPayloads` over a list; returns the input array when nothing changed. */
export function stripDuplicatedMessagePayloads(messages: ChatMessage[]): ChatMessage[] {
    if (!messages?.length) return messages;
    let changed = false;
    const next = messages.map((message) => {
        const stripped = stripDuplicatedPartPayloads(message);
        if (stripped !== message) changed = true;
        return stripped;
    });
    return changed ? next : messages;
}

/**
 * Drop every remote source from a message's parts: `url` always, and a `dataUrl`
 * that is not `data:`. The server never fetches on a client's behalf (see
 * `server/model-messages.ts` → `isInlineDataUrl`); stripping at the way in keeps
 * such a value out of stored history as well. Returns the input when nothing changed.
 */
export function stripRemotePartSources(message: ChatMessage): ChatMessage {
    const parts = message?.parts as any[] | undefined;
    if (!parts?.length) return message;
    let changed = false;
    const next = parts.map((part) => {
        if (!part || typeof part !== 'object') return part;
        const remoteDataUrl = part.dataUrl !== undefined
            && !(typeof part.dataUrl === 'string' && /^\s*data:/i.test(part.dataUrl));
        if (part.url === undefined && !remoteDataUrl) return part;
        changed = true;
        const { url, ...rest } = part;
        if (remoteDataUrl) delete rest.dataUrl;
        return rest;
    });
    return changed ? { ...message, parts: next } : message;
}
