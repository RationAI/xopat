/**
 * Chat message -> AI SDK ModelMessage conversion.
 *
 * Pure logic, deliberately NOT in a `*.server.ts` file: every named export of a
 * server file becomes an RPC method, and this is internal plumbing. Keeping it
 * here also makes it testable in isolation — which matters, because the failure
 * mode of this code is SILENT: an attachment in the wrong shape still validates
 * against the prompt schema and is simply sent as the wrong thing (a URL string
 * read as base64, for instance). See test/unit/model-message-shapes.test.mjs.
 */
import { getChatTuning } from './tuning';
import { errorText } from './abort-utils';
/**
 * A payload is inline (`data:`) or it is nothing.
 *
 * Parts once could name a remote `url`; the SDK then fetched it from the server
 * process. That URL is client input, the SSRF guard honours the operator's
 * allowlist of internal hosts, and the SDK trusts the client `mimeType` — a
 * `text/*` part pointed at an internal endpoint came back inside the reply.
 * Filtering here covers every way a source arrives: the part's own fields, a
 * stored attachment, and replayed history written before the upload check.
 */
export function isInlineDataUrl(value: unknown): value is string {
    return typeof value === 'string' && /^\s*data:/i.test(value);
}

export function resolvePartPayload(
    part: any,
    attachmentIndex?: Map<string, ChatAttachmentRecord>
): { source: string; mimeType?: string; name?: string } {
    const attachment = part?.attachmentId ? attachmentIndex?.get(part.attachmentId) : undefined;
    const source = [part?.dataUrl, attachment?.dataUrl].find(isInlineDataUrl);
    return {
        source: String(source || '').trim(),
        mimeType: part?.mimeType || attachment?.mimeType || undefined,
        name: part?.name || attachment?.name || undefined,
    };
}

/**
 * Decoded-bytes LRU for message media payloads. History replay re-runs
 * `toModelMessage` over the same attachments on every turn (and on every rung of
 * the context-window retry ladder); without this each pass pays a fresh
 * base64 decode per image/file. Keyed by the dataUrl string itself — the key is
 * a reference to a string already retained by the store, so the cache only adds
 * the decoded bytes, bounded by the byte cap below.
 */
const decodedMediaCache = new Map<string, { bytes: Uint8Array; mediaType?: string }>();
let decodedMediaCacheBytes = 0;

export function dataUrlToBytesCached(value: string | undefined | null): { bytes: Uint8Array | null; mediaType?: string } {
    const raw = String(value || '').trim();
    if (!raw) return { bytes: null };

    const cached = decodedMediaCache.get(raw);
    if (cached) {
        // Refresh recency (Map preserves insertion order).
        decodedMediaCache.delete(raw);
        decodedMediaCache.set(raw, cached);
        return cached;
    }

    const decoded = dataUrlToBytes(raw);
    if (!decoded.bytes) return decoded;

    const cacheBudget = getChatTuning().decodedMediaCacheBytes;
    if (decoded.bytes.byteLength <= cacheBudget) {
        decodedMediaCache.set(raw, { bytes: decoded.bytes, mediaType: decoded.mediaType });
        decodedMediaCacheBytes += decoded.bytes.byteLength;
        while (decodedMediaCacheBytes > cacheBudget && decodedMediaCache.size) {
            const oldestKey = decodedMediaCache.keys().next().value as string;
            const evicted = decodedMediaCache.get(oldestKey)!;
            decodedMediaCache.delete(oldestKey);
            decodedMediaCacheBytes -= evicted.bytes.byteLength;
        }
    }
    return decoded;
}

function dataUrlToBytes(value: string | undefined | null): { bytes: Uint8Array | null; mediaType?: string } {
    const raw = String(value || '').trim();
    const match = raw.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/i);
    if (!match) return { bytes: null };

    const mediaType = match[1] || undefined;
    const base64 = match[2] || '';
    const BufferCtor = (globalThis as any)?.Buffer;
    if (!BufferCtor?.from) return { bytes: null, mediaType };
    const buf = BufferCtor.from(base64, 'base64');
    return { bytes: new Uint8Array(buf), mediaType };
}

export function attachmentExceedsInlineLimit(bytes: Uint8Array | null | undefined, ctx?: any): boolean {
    return !!bytes && bytes.byteLength > getChatTuning(ctx).maxInlineAttachmentBytes;
}

export function coerceMessageText(message: ChatMessage | null | undefined): string {
    if (!message) return '';
    if (typeof message.content === 'string' && message.content.trim()) return message.content;
    const parts = message.parts || [];
    return parts.map((part) => {
        switch (part.type) {
            case 'text': return part.text;
            case 'host-feedback': return part.text;
            case 'capability-notice': return part.text;
            case 'script-result': return part.text;
            case 'image': return `[Image: ${part.name || part.mimeType}]`;
            case 'file': return `[File: ${part.name}]`;
            default: return '';
        }
    }).filter(Boolean).join('\n');
}

/**
 * An assistant turn carrying nothing a model can read: no text, and no media part that
 * would say something on its own.
 *
 * A turn that produced no usable output is still STORED — the transcript should stay
 * faithful and the UI reads `metadata.emptyReply` — but replaying it teaches the model
 * only that ending a turn with nothing is acceptable, and some providers reject empty
 * assistant content outright. One stalled turn used to sit in the window and poison
 * every later one. Only assistant turns qualify: a user or tool message with just
 * attachments is meaningful, and dropping it would lose real input.
 */
export function isContentlessAssistantMessage(message: ChatMessage | null | undefined): boolean {
    if (message?.role !== 'assistant') return false;
    const parts = Array.isArray(message.parts) ? message.parts : [];
    if (parts.some((part: any) => part?.type === 'image' || part?.type === 'file')) return false;
    return !coerceMessageText(message).trim();
}

export function toModelMessage(
    message: ChatMessage,
    attachmentIndex?: Map<string, ChatAttachmentRecord>,
    capabilities?: ModelCapabilities | null
) {
    const parts = message.parts || (message.content ? [{ type: 'text', text: message.content }] : []);
    const hasMediaParts = parts.some((part: any) => part?.type === 'image' || part?.type === 'file');
    const role = message.role === 'tool'
        ? 'user'
        : (message.role === 'assistant' && hasMediaParts ? 'user' : message.role);

    if (role === 'system') {
        return {
            role: 'system',
            content: typeof message.content === 'string' && message.content.trim()
                ? message.content
                : coerceMessageText(message),
        } as any;
    }

    const content = parts.map((part) => {
        switch (part.type) {
            case 'text':
                return { type: 'text', text: part.text } as const;
            case 'host-feedback':
                return { type: 'text', text: `[host-feedback] ${part.text}` } as const;
            case 'capability-notice':
                return { type: 'text', text: `[system notice] ${part.text}` } as const;
            case 'script-result': {
                const tag = (part as any).ok === false ? 'script-error' : 'script-result';
                return { type: 'text', text: `[${tag}] ${part.text}` } as const;
            }

            case 'image': {
                if (!mediaAllowedForModel('image', capabilities)) {
                    return {
                        type: 'text',
                        text: part.name ? `[Image omitted for non-multimodal model: ${part.name}]` : '[Image omitted for non-multimodal model]',
                    } as const;
                }

                const resolved = resolvePartPayload(part, attachmentIndex);
                const inline = dataUrlToBytesCached(resolved.source);

                if (inline.bytes) {
                    if (attachmentExceedsInlineLimit(inline.bytes)) {
                        return {
                            type: 'text',
                            text: resolved.name
                                ? `[Image omitted because it exceeds the inline prompt budget: ${resolved.name}]`
                                : '[Image omitted because it exceeds the inline prompt budget]',
                        } as const;
                    }
                    // AI SDK 7 deprecated the dedicated 'image' part in favour of a 'file'
                    // part carrying an image mediaType. Raw bytes stay raw bytes.
                    return {
                        type: 'file',
                        data: inline.bytes,
                        mediaType: resolved.mimeType || inline.mediaType || 'image/*',
                        ...(resolved.name ? { filename: resolved.name } : {}),
                    } as const;
                }

                return {
                    type: 'text',
                    text: resolved.name ? `[Image unavailable: ${resolved.name}]` : '[Image unavailable]',
                } as const;
            }

            case 'file': {
                if (!mediaAllowedForModel('file', capabilities)) {
                    return {
                        type: 'text',
                        text: part.name ? `[File omitted for unsupported model: ${part.name}]` : '[File omitted for unsupported model]',
                    } as const;
                }
                const resolved = resolvePartPayload(part, attachmentIndex);
                const inline = dataUrlToBytesCached(resolved.source);

                if (inline.bytes) {
                    if (attachmentExceedsInlineLimit(inline.bytes)) {
                        return {
                            type: 'text',
                            text: resolved.name
                                ? `[File omitted because it exceeds the inline prompt budget: ${resolved.name}]`
                                : '[File omitted because it exceeds the inline prompt budget]',
                        } as const;
                    }
                    return {
                        type: 'file',
                        data: inline.bytes,
                        mediaType: resolved.mimeType || inline.mediaType || 'application/octet-stream',
                        filename: resolved.name,
                    } as const;
                }

                return {
                    type: 'text',
                    text: resolved.name ? `[File unavailable: ${resolved.name}]` : '[File unavailable]',
                } as const;
            }

            default:
                return { type: 'text', text: '' } as const;
        }
    });
    if (content.length === 1 && content[0]!.type === 'text') {
        return { role, content: content[0]!.text } as any;
    }

    return { role, content } as any;
}

export function mediaAllowedForModel(
    partType: 'image' | 'file',
    capabilities?: ModelCapabilities | null
): boolean {
    // Optimistic on 'unknown': most providers never say, and a model that rejects the media
    // teaches the turn loop 'unsupported' (see `mediaUnsupportedKind` in chat.server.ts).
    if (!capabilities) return true;
    if (partType === 'image') return capabilities.images !== 'unsupported';
    return capabilities.files !== 'unsupported';
}

export type MediaKind = 'images' | 'files';

/** Which media kinds a converted conversation actually sends to the model. */
export function conversationMediaKinds(conversation: any[]): Set<MediaKind> {
    const kinds = new Set<MediaKind>();
    for (const message of conversation || []) {
        if (!Array.isArray(message?.content)) continue;
        for (const part of message.content) {
            if (part?.type === 'image') kinds.add('images');
            else if (part?.type === 'file') {
                kinds.add(String(part.mediaType || '').toLowerCase().startsWith('image/') ? 'images' : 'files');
            }
        }
    }
    return kinds;
}

/**
 * The media kind a provider just refused, if its error says so.
 *
 * Capabilities are optimistic ('unknown' = send it), so this is how a model that cannot take
 * images is found out: from the rejection of a real turn, not a guess. Deliberately
 * conservative, like `isToolsUnsupportedError`: it needs a refusal phrase AND a media word,
 * and only answers for a kind the conversation actually carried — an unrelated 400 that
 * happens to say "unsupported" must not disable screenshots for the model.
 */
export function mediaUnsupportedKind(error: any, sent: Set<MediaKind>): MediaKind | null {
    const msg = errorText(error).toLowerCase();
    if (!msg) return null;
    if (!/not support|unsupported|does not support|doesn't support|invalid content|cannot process|can't process|not a multimodal|text-only|only supports text/.test(msg)) {
        return null;
    }
    if (sent.has('images') && /image|vision|multimodal|multi-modal/.test(msg)) return 'images';
    if (sent.has('files') && /\bfile\b|file part|document|media type|input_file|attachment/.test(msg)) return 'files';
    return null;
}

/**
 * Did the provider refuse to STREAM (as opposed to refusing something in the request)?
 *
 * The verdict this feeds is cached per model and never re-tested, so it must not fire on
 * anything else. `UnsupportedFunctionalityError` alone is not evidence: the SDK throws it for
 * unsupported file parts, media types and tools — one rejected attachment used to switch a
 * model to buffered replies for good. Both branches therefore need the error to actually talk
 * about streaming.
 */
export function isStreamingUnsupportedError(error: any): boolean {
    const text = `${String(error?.functionality || '')} ${errorText(error)}`;
    if (!/stream/i.test(text)) return false;
    if (/UnsupportedFunctionality/i.test(String(error?.name || ''))) return true;
    const status = Number(error?.statusCode ?? error?.status ?? error?.cause?.statusCode ?? error?.cause?.status);
    return status >= 400 && status < 500;
}
