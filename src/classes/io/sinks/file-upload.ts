// `file-upload` sink — bundle import via a hidden <input type="file">.
// Supports only the `bundle` kind. Programmatic call opens a file picker,
// reads the file, and resolves with the file contents wrapped in an
// IOResult. The owner's `importBundle` hook is what actually applies it
// (the pipeline routes the result through the owner).

export const fileUploadSink: IOSink = {
    id: "file-upload",
    label: "Upload from file",
    supports: ["bundle"],

    async readBundle(ctx) {
        const U = (globalThis as any).UTILITIES;
        try {
            const fileContent = await pickFile(ctx, U);
            if (fileContent === null) {
                return { ok: false, refused: true, reason: "user cancelled", code: "W_IO_CANCELLED" };
            }
            return { ok: true, payload: fileContent };
        } catch (e: any) {
            return { ok: false, refused: true, reason: e?.message ?? String(e), code: "W_IO_UPLOAD_THREW" };
        }
    },
};

function pickFile(ctx: IOContext, U: any): Promise<string | null> {
    return new Promise((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";
        const accept = ctx.meta.accept as string | undefined;
        if (accept) input.accept = accept;
        input.style.display = "none";
        document.body.appendChild(input);

        let settled = false;
        const cleanup = () => {
            try { input.remove(); } catch { /* ignore */ }
        };

        input.addEventListener("change", async (e) => {
            settled = true;
            try {
                if (U?.readFileUploadEvent) {
                    const data = await U.readFileUploadEvent(e);
                    cleanup();
                    resolve(data);
                } else {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (!file) { cleanup(); resolve(null); return; }
                    const reader = new FileReader();
                    reader.onload = () => { cleanup(); resolve(reader.result as string); };
                    reader.onerror = () => { cleanup(); reject(reader.error); };
                    reader.readAsText(file);
                }
            } catch (err) { cleanup(); reject(err); }
        }, { once: true });

        // If the user cancels the picker, no event fires. Listen for a
        // window focus event as a heuristic to clean up the orphaned input.
        const onFocus = () => {
            setTimeout(() => {
                if (!settled) { cleanup(); resolve(null); }
                window.removeEventListener("focus", onFocus);
            }, 300);
        };
        window.addEventListener("focus", onFocus);

        input.click();
    });
}
