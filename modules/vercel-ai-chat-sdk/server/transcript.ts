/**
 * The conversation transcript: what a message looks like in a log file.
 *
 * Split out of the session store because it is pure projection — no storage, no
 * broker, no request — and because the interesting rules are all here, where they
 * can be tested against real message shapes instead of observed on a running
 * server:
 *
 * - a record names its attachments and never carries their bytes,
 * - the file path is derived from ids, so the message record can point at a file
 *   that a different call writes,
 * - and the extension is one a human can double-click.
 *
 * The emitting side (`SessionStore.appendMessages` / `uploadAttachment`) owns the
 * "exactly once" property, because that is a property of WHERE it is called, not
 * of what it produces. See `chatRegistry.server.ts`.
 */

/**
 * `sess_x/att_y.png` — the transcript-relative path for one attachment.
 *
 * Deterministic on purpose: the message record and the attachment record are
 * written by different calls at different times, and they have to agree on the
 * filename without talking to each other.
 */
export function attachmentFilePath(input: {
    id: string; sessionId: string; mimeType?: string; name?: string;
}): string {
    return `${input.sessionId}/${input.id}${extensionFor(input.mimeType, input.name)}`;
}

/**
 * A file extension a human can double-click.
 *
 * The original filename wins when it has one — that is what the user called it —
 * otherwise the mime subtype, otherwise `.bin`. Never empty: a sidecar directory
 * full of extensionless blobs is not "so we can see the attachments".
 */
export function extensionFor(mimeType?: string, name?: string): string {
    const fromName = typeof name === 'string' ? /\.([A-Za-z0-9]{1,8})$/.exec(name) : null;
    if (fromName?.[1]) return `.${fromName[1].toLowerCase()}`;
    const subtype = String(mimeType || '').split('/')[1] || '';
    // `image/svg+xml` → `svg`, `application/vnd.foo` → `vndfoo`.
    const clean = (subtype.split('+')[0] || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!clean) return '.bin';
    return `.${clean === 'jpeg' ? 'jpg' : clean}`;
}

/**
 * Node's `Buffer`, declared structurally.
 *
 * Module server files are typechecked without `@types/node` (the same reason
 * `XOPAT_SERVER` is described by an interface rather than imported), so the one
 * global this file needs is stated here instead of pulling the whole node
 * typings surface into the module build.
 */
declare const Buffer: { from(data: string, encoding: string): Uint8Array };

/** `data:<mime>;base64,<payload>` → bytes. Null for anything else. */
export function decodeDataUrl(dataUrl: string): Uint8Array | null {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    if (!/;base64$/i.test(dataUrl.slice(0, comma))) return null;
    const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64');
    return bytes.length ? bytes : null;
}

/**
 * The attachments a message REFERENCES, as pointers.
 *
 * Parts carry `attachmentId` — the payload is stripped from the delta on the way
 * in (`shared/attachment-parts.ts`) — so this says which files belong to which
 * message and where they are, and the bytes stay out of the line. A part that
 * still carries an inline `dataUrl` is described, never inlined: one base64
 * screenshot per line is the repetition problem in another costume.
 */
export function describeMessageAttachments(message: any): Array<Record<string, unknown>> | undefined {
    const parts: any[] = Array.isArray(message?.parts) ? message.parts : [];
    const described = parts
        .filter(part => part && typeof part.attachmentId === 'string' && part.attachmentId)
        .map(part => ({
            id: part.attachmentId,
            mimeType: part.mimeType,
            ...(part.name ? { name: part.name } : {}),
            file: attachmentFilePath({
                id: part.attachmentId,
                sessionId: message?.sessionId,
                mimeType: part.mimeType,
                name: part.name,
            }),
        }));
    return described.length ? described : undefined;
}

/**
 * One message as a transcript record.
 *
 * Deliberately close to the stored message rather than a summary — the point of
 * the transcript is reading back what was actually said, including the script
 * results and tool output that explain why the model answered as it did. Only
 * the attachment bytes are replaced by references.
 */
export function transcriptRecord(message: any): Record<string, unknown> {
    return {
        sessionId: message?.sessionId,
        messageId: message?.id,
        role: message?.role,
        createdAt: message?.createdAt,
        content: message?.content,
        parts: message?.parts,
        attachments: describeMessageAttachments(message),
    };
}
