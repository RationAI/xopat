// `file-download` sink — bundle export to a local file via
// UTILITIES.downloadAsFile. Supports only the `bundle` kind.
//
// Filename convention: <ownerId>[-<viewerId>]-<ISO date>.<ext>
// Owners can override via ctx.meta.fileName (full filename) or
// ctx.meta.fileExt (extension only). Payload may be a string,
// ArrayBuffer, Blob, or { fileName, content } envelope.

export const fileDownloadSink: IOSink = {
    id: "file-download",
    label: "Download to file",
    supports: ["bundle"],

    async writeBundle(ctx, payload) {
        if (payload === undefined || payload === null) {
            return { ok: false, refused: true, reason: "no payload", code: "W_IO_EMPTY_PAYLOAD" };
        }

        let fileName: string | undefined = ctx.meta.fileName as string | undefined;
        let content: any = payload;

        if (payload && typeof payload === "object" && "content" in (payload as any)) {
            const env = payload as any;
            content = env.content;
            fileName ??= env.fileName as string | undefined;
        }

        if (!fileName) {
            const ext = (ctx.meta.fileExt as string | undefined) ?? "json";
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            const viewerSuffix = ctx.viewerId ? `--${ctx.viewerId}` : "";
            fileName = `${ctx.ownerId}${viewerSuffix}-${stamp}.${ext}`;
        }

        const U = (globalThis as any).UTILITIES;
        if (!U?.downloadAsFile) {
            return { ok: false, refused: true, reason: "UTILITIES.downloadAsFile missing", code: "W_IO_NO_DOWNLOAD" };
        }
        try {
            U.downloadAsFile(fileName, content);
            return { ok: true };
        } catch (e: any) {
            return { ok: false, refused: true, reason: e?.message ?? String(e), code: "W_IO_DOWNLOAD_THREW" };
        }
    },
};
