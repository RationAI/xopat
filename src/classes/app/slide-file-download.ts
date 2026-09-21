/**
 * Download the *original* slide file behind an open (or merely resolved) tile
 * source. Exposed as `UTILITIES.downloadSlideFile(...)`.
 *
 * The capability itself is duck-typed on the tile source — `canDownloadSlideFile()`
 * + `getSlideFileDownload()`, see `src/tile-source.ts`. This module is only the
 * driver: it turns the descriptor a source hands back into a file on the user's
 * disk, and owns the one decision the source must not make for itself, namely
 * *how* to transfer it.
 *
 * Whole-slide images are routinely tens of gigabytes, so the default is to never
 * touch the bytes: when the endpoint authenticates by cookie (or not at all), the
 * URL is handed to the browser's own download manager, which streams to disk,
 * shows native progress, and survives a tab that is doing other work. Only when
 * the request must carry auth headers — which an `<a download>` navigation cannot
 * do — do we stream it ourselves through the source's HttpClient, buffering into
 * a Blob behind a cancellable progress dialog.
 */

/** @see the `SlideFileDownload` type in `src/tile-source.ts` / `src/types/app.d.ts`. */
export interface SlideFileDownload {
    url: string;
    fileName?: string;
    sizeBytes?: number;
    mimeType?: string;
    client?: any /* HttpClient */;
}

export interface DownloadSlideFileOptions {
    /** Viewer the action was triggered from — anchors the progress dialog. */
    viewer?: any;
    /**
     * Fallback file name when neither the response nor the descriptor names the
     * file. Callers that know the slide's display name should pass it.
     */
    fallbackName?: string;
}

/**
 * Bytes above which the *buffered* transport asks for confirmation first. Only
 * the streamed path is affected — the browser-native path has no such limit.
 * Operator-tunable through `ENV.core.setup.slideDownloadWarnBytes`.
 */
const DEFAULT_WARN_BYTES = 2 * 1024 * 1024 * 1024;

/** How long we wait for a client to tell us whether it needs auth headers. */
const AUTH_PROBE_TIMEOUT_MS = 5000;

const MIME_EXTENSIONS: Record<string, string> = {
    "image/tiff": "tiff",
    "image/jpeg": "jpg",
    "image/png": "png",
    "application/zip": "zip",
    "application/dicom": "dcm",
};

/**
 * Whether the transfer must go through the HttpClient (i.e. carry headers an
 * anchor navigation cannot). Degrades to `true` — the streamed path always
 * works, the anchor path silently 401s.
 */
export async function requiresHeaderTransport(client: any, url: string): Promise<boolean> {
    if (!client) return false;
    // A proxied client also injects session/CSRF headers per request
    // (`xopatSessionHeaders`), not just auth ones.
    if (client.usingProxy) return true;
    if (typeof client._authHeaders !== "function") return false;

    let timer: any;
    try {
        const headers = await Promise.race([
            client._authHeaders(url, "GET"),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("auth probe timeout")), AUTH_PROBE_TIMEOUT_MS);
            }),
        ]) as Record<string, string> | undefined;
        return !!headers && Object.keys(headers).length > 0;
    } catch (e) {
        console.warn("[slide-download] could not determine auth requirements, streaming instead:", e);
        return true;
    } finally {
        clearTimeout(timer);
    }
}

/** `attachment; filename="x.svs"` / RFC 5987 `filename*=UTF-8''x.svs`. */
export function fileNameFromDisposition(disposition: string | null): string | undefined {
    if (!disposition) return undefined;
    const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(disposition);
    if (extended?.[2]) {
        try { return decodeURIComponent(extended[2].trim()); } catch { /* fall through */ }
    }
    const plain = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i.exec(disposition);
    const raw = plain?.[1] ?? plain?.[2];
    return raw ? raw.trim() : undefined;
}

function extensionFor(dl: SlideFileDownload, contentType?: string | null): string {
    const mime = ((contentType || dl.mimeType || "").split(";")[0] ?? "").trim().toLowerCase();
    const known = MIME_EXTENSIONS[mime];
    if (known) return known;
    // Last resort: whatever the URL path itself ends with. Strip the query and
    // fragment by hand rather than through `new URL` — the base is not always
    // available, and a relative descriptor URL is perfectly legal here.
    const path = dl.url.split(/[?#]/)[0] ?? "";
    const ext = /\.([a-z0-9]{2,5})$/i.exec(path)?.[1];
    return ext ? ext.toLowerCase() : "bin";
}

export function resolveFileName(
    dl: SlideFileDownload,
    response: Response | null,
    fallbackName: string | undefined
): string {
    const fromResponse = fileNameFromDisposition(response?.headers.get("content-disposition") ?? null);
    if (fromResponse) return fromResponse;
    if (dl.fileName) return dl.fileName;

    const base = (fallbackName || "slide").replace(/[\\/:*?"<>|]+/g, "_");
    if (/\.[a-z0-9]{2,5}$/i.test(base)) return base;
    return `${base}.${extensionFor(dl, response?.headers.get("content-type") ?? null)}`;
}

/**
 * Name to force on the browser-native path, or `undefined` to leave the naming
 * to the server. An `<a download="...">` value **overrides** `Content-Disposition`,
 * so guessing here would replace a correct server-side name (`biopsy-42.ndpi`)
 * with a synthesized one carrying a made-up extension. Only force a name the
 * source actually stated.
 */
function forcedFileName(dl: SlideFileDownload): string | undefined {
    return dl.fileName || undefined;
}

function formatMegabytes(bytes: number): string {
    return (bytes / (1024 * 1024)).toFixed(1);
}

/** Themed confirm when the app provides one, native prompt otherwise. */
async function confirmLargeTransfer(message: string): Promise<boolean> {
    const Dialogs = (globalThis as any).Dialogs;
    if (Dialogs?.confirm) {
        try {
            return !!(await Dialogs.confirm(message, $.t("messages.slideDownloadTitle")));
        } catch (e) { /* fall through to the native prompt */ }
    }
    return window.confirm(message);
}

/**
 * Whether `url` resolves to this document's own origin.
 *
 * This decides *how* the browser-native download is triggered, and getting it
 * wrong is user-visible: `<a download>` is honoured only same-origin, so the
 * same click degrades into a top-level navigation across origins.
 *
 * An unparsable URL answers `false` on purpose — that routes it to the path
 * which cannot navigate. The worst case is then a download that quietly fails
 * to start, never a viewer unloaded from under the user.
 */
export function isSameOriginUrl(url: string): boolean {
    try { return new URL(url, window.location.href).origin === window.location.origin; }
    catch { return false; }
}

/**
 * Hand the URL to the browser. Nothing is buffered; native UI takes over.
 *
 * Two mechanisms, because there is no single one that works on both origins:
 *
 * - **same-origin** — an `<a download>` click. The attribute is honoured, so no
 *   navigation is attempted at all, and it can still force a file name when the
 *   server sends no `Content-Disposition`.
 * - **cross-origin** — a hidden iframe. The `download` attribute is *ignored*
 *   across origins, so the anchor would instead start a real top-level
 *   navigation: that fires `beforeunload`, and xOpat's unsaved-state guard
 *   (`src/loader.ts`) turns it into a "Leave site?" prompt for an action that
 *   never intended to leave. Pointing an iframe at the URL downloads it without
 *   touching the top document, so the guard is never consulted.
 */
function downloadViaBrowser(dl: SlideFileDownload, fileName: string | undefined): void {
    if (isSameOriginUrl(dl.url)) {
        const link = document.createElement("a");
        link.href = dl.url;
        // Empty value = "download, but name it from Content-Disposition".
        link.setAttribute("download", fileName ?? "");
        link.rel = "noopener";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
    }

    const frame = document.createElement("iframe");
    frame.setAttribute("data-xopat-download", dl.url);
    frame.style.display = "none";
    document.body.appendChild(frame);
    frame.src = dl.url;
    // Removing the frame immediately can abort the transfer; the response also
    // arrives long after this call returns. Same 60s grace the object-URL
    // revoke in `UTILITIES.downloadAsFile` uses.
    setTimeout(() => frame.remove(), 60000);
}

/**
 * Stream through the HttpClient with a cancellable progress dialog. The file is
 * buffered in memory — only reached when auth headers make the native path
 * impossible.
 */
async function downloadViaClient(
    dl: SlideFileDownload,
    options: DownloadSlideFileOptions
): Promise<void> {
    const UI = (globalThis as any).UI;
    const controller = new AbortController();

    // Operator-tunable, never a session option (§7): a hostile bundle must not
    // be able to raise the memory ceiling of this tab.
    const warnBytes = Number(
        (globalThis as any).APPLICATION_CONTEXT?.env?.setup?.slideDownloadWarnBytes
    ) || DEFAULT_WARN_BYTES;
    if (dl.sizeBytes && dl.sizeBytes > warnBytes) {
        const message = $.t("messages.slideDownloadLargeConfirm", { size: formatMegabytes(dl.sizeBytes) });
        if (!await confirmLargeTransfer(message)) return;
    }

    const dialog = UI?.ProgressDialog?.show({
        title: $.t("messages.slideDownloadTitle"),
        total: 100,
        cancellable: true,
        backgroundable: true,
        viewer: options.viewer,
    });
    dialog?.onCancel?.(() => controller.abort());

    try {
        // Our own signal is mandatory: `fetchRaw` arms a `timeoutMs` abort (30s by
        // default) whenever the caller supplies none, which no real slide survives.
        // `background` priority yields to tile traffic via the request scheduler.
        const response: Response = await dl.client.fetchRaw(dl.url, {
            method: "GET",
            signal: controller.signal,
            priority: "background",
            maxRetries: 0,
        });

        const declared = Number(response.headers.get("content-length"));
        const total = Number.isFinite(declared) && declared > 0 ? declared : (dl.sizeBytes || 0);

        const chunks: Uint8Array[] = [];
        let received = 0;

        const reader = response.body?.getReader();
        if (!reader) {
            // No streaming support (or an empty body): fall back to one shot.
            const whole = new Uint8Array(await response.arrayBuffer());
            chunks.push(whole);
            received = whole.byteLength;
        } else {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                    chunks.push(value);
                    received += value.byteLength;
                    if (total > 0) {
                        dialog?.tick(Math.floor((received / total) * 100));
                        dialog?.setLabel($.t("messages.slideDownloadProgress", {
                            done: formatMegabytes(received),
                            total: formatMegabytes(total),
                        }));
                    } else {
                        dialog?.setLabel($.t("messages.slideDownloadProgressUnknown", {
                            done: formatMegabytes(received),
                        }));
                    }
                }
            }
        }

        if (received === 0) throw new Error($.t("messages.slideDownloadEmpty"));

        const fileName = resolveFileName(dl, response, options.fallbackName);
        const blob = new Blob(chunks as BlobPart[], {
            type: response.headers.get("content-type") || dl.mimeType || "application/octet-stream",
        });
        (globalThis as any).UTILITIES.downloadAsFile(fileName, blob);
        dialog?.done();
    } catch (e: any) {
        if (controller.signal.aborted) {
            dialog?.close();
            return;
        }
        dialog?.error(e);
        throw e;
    }
}

/**
 * Download the original slide file of `source`, if it offers one.
 *
 * Resolves once the transfer has been handed off (browser path) or completed
 * (streamed path). Errors are surfaced to the user here and rethrown, so callers
 * wiring a menu entry can simply `void`-call this.
 *
 * @param source tile source implementing the optional download capability
 * @param options viewer to anchor UI to, and a display-name fallback
 */
export async function downloadSlideFile(
    source: any,
    options: DownloadSlideFileOptions = {}
): Promise<void> {
    const Dialogs = (globalThis as any).Dialogs;

    if (typeof source?.canDownloadSlideFile !== "function" || !source.canDownloadSlideFile()) {
        Dialogs?.show($.t("messages.slideDownloadUnsupported"), 5000, Dialogs?.MSG_WARN);
        return;
    }

    let dl: SlideFileDownload | undefined;
    try {
        dl = await source.getSlideFileDownload();
    } catch (e) {
        console.error("[slide-download] the source failed to resolve a download location:", e);
    }
    if (!dl?.url) {
        Dialogs?.show($.t("messages.slideDownloadUnavailable"), 5000, Dialogs?.MSG_WARN);
        return;
    }

    try {
        // A client that cannot `fetchRaw` cannot stream either; the anchor is
        // then the only path left, even if it may lack a credential.
        const streamable = typeof dl.client?.fetchRaw === "function";
        if (streamable && await requiresHeaderTransport(dl.client, dl.url)) {
            await downloadViaClient(dl, options);
        } else {
            downloadViaBrowser(dl, forcedFileName(dl));
            // The browser owns the transfer from here and reports nothing back —
            // a cross-origin response is opaque, so a server that forgot its
            // `Content-Disposition` would make this click look like a dead
            // button. Acknowledge the hand-off so the action is never silent.
            Dialogs?.show($.t("messages.slideDownloadStarted"), 4000, Dialogs?.MSG_INFO);
        }
    } catch (e: any) {
        console.error("[slide-download] failed:", e);
        Dialogs?.show($.t("messages.slideDownloadFailed", { error: e?.message ?? String(e) }),
            8000, Dialogs?.MSG_ERR);
        throw e;
    }
}
