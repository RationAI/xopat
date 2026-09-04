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
export function resolvePartPayload(
    part: any,
    attachmentIndex?: Map<string, ChatAttachmentRecord>
): { source: string; mimeType?: string; name?: string } {
    const attachment = part?.attachmentId ? attachmentIndex?.get(part.attachmentId) : undefined;
    return {
        source: String(part?.dataUrl || part?.url || attachment?.dataUrl || '').trim(),
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

                if (/^https?:\/\//i.test(resolved.source)) {
                    // A bare string in `data` means base64 bytes — a remote image MUST be
                    // handed over as a URL object or the SDK would try to decode the href.
                    return {
                        type: 'file',
                        data: new URL(resolved.source),
                        mediaType: resolved.mimeType || 'image/*',
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

                if (/^https?:\/\//i.test(resolved.source)) {
                    // A bare string in `data` is INLINE BASE64 by the prompt schema, not a
                    // URL — passing the href there base64-decodes the URL text into garbage
                    // and ships it upstream, silently, because it still validates. A URL
                    // object (or a `{type:'url'}` tag) is the only way to mean "fetch this".
                    return {
                        type: 'file',
                        data: new URL(resolved.source),
                        mediaType: resolved.mimeType || 'application/octet-stream',
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
    if (!capabilities) return true;
    if (partType === 'image') return capabilities.images === 'supported';
    return capabilities.files === 'supported';
}
