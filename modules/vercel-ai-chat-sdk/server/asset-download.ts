/**
 * Guarded implementation of the AI SDK's asset-download hook.
 *
 * WHY THIS EXISTS. A chat message part may carry a remote `url` instead of an
 * inline payload, and that url comes from the CLIENT. When the target model does
 * not declare support for URLs of that media type, AI SDK 7 resolves the asset
 * *itself* — `convertToLanguageModelPrompt` → `downloadAssets` → plain `fetch`
 * from the xOpat server process. That is a server-side request to an
 * attacker-chosen address: the textbook SSRF shape AGENTS.md §4 exists to
 * prevent, and it is invisible because it happens inside the SDK.
 *
 * So the hook is always supplied, and it does exactly two things:
 *
 *   - the model can take the URL itself → return `null`, which tells the SDK to
 *     pass the URL through untouched. The fetch then happens at the provider,
 *     from the provider's network, and is none of our business.
 *   - otherwise → fetch through `XOPAT_SERVER.safeRequest`, the connect-time
 *     validated transport (private/loopback/link-local/CGNAT/metadata rejection,
 *     no redirect following, DNS-rebinding closed), bounded by size and time.
 *
 * Degrades CLOSED: a blocked or oversized asset throws rather than silently
 * dropping to "the model sees nothing", so an operator sees the reason.
 */
import { getChatTuning, chatLog } from './tuning';

/** Matches the SDK's `DownloadFunction` contract (a `null` entry = leave the URL alone). */
export type GuardedDownloadResult = { data: Uint8Array; mediaType: string | undefined } | null;

const DOWNLOAD_TIMEOUT_MS = 20_000;

export function createGuardedDownload(ctx?: any) {
    const log = chatLog('assets');

    return async function guardedDownload(
        requests: Array<{ url: URL; isUrlSupportedByModel: boolean }>,
    ): Promise<GuardedDownloadResult[]> {
        const maxBytes = getChatTuning(ctx).maxInlineAttachmentBytes;
        const server: any = (globalThis as any).XOPAT_SERVER;

        return Promise.all(requests.map(async ({ url, isUrlSupportedByModel }) => {
            // The provider fetches it. Nothing egresses from this process.
            if (isUrlSupportedByModel) return null;

            if (typeof server?.safeRequest !== 'function') {
                throw new Error(
                    `Cannot fetch the remote attachment ${url.origin}: the core SSRF guard ` +
                    `(XOPAT_SERVER.safeRequest) is unavailable, and fetching it unguarded is not an option.`
                );
            }
            if (url.protocol !== 'https:' && url.protocol !== 'http:') {
                throw new Error(`Refusing to fetch a remote attachment over '${url.protocol}'.`);
            }

            const response = await server.safeRequest(url.href, {
                method: 'GET',
                timeoutMs: DOWNLOAD_TIMEOUT_MS,
                maxResponseBytes: maxBytes,
                signal: ctx?.signal,
            });
            if (!response.ok) {
                throw new Error(`Remote attachment ${url.origin} returned ${response.status}.`);
            }

            const buffer = await response.arrayBuffer();
            const data = new Uint8Array(buffer);
            if (data.byteLength > maxBytes) {
                throw new Error(
                    `Remote attachment ${url.origin} is ${data.byteLength} bytes, over the ` +
                    `${maxBytes}-byte inline budget.`
                );
            }
            // Origin only — a URL path can carry identifiers that do not belong in a log.
            log.debug(`inlined remote attachment from ${url.origin} (${data.byteLength} bytes)`);

            const contentType = String(response.headers?.['content-type'] || '').split(';')[0]!.trim();
            return { data, mediaType: contentType || undefined };
        }));
    };
}
