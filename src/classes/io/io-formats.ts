// Format registry — `IO_PIPELINE.formats`.
//
// A FORMAT converts between a domain's model (the plain, in-memory shape its
// owner works with) and a wire representation (a string or bytes). Formats are
// keyed by `(domain, id)`; the domain is the owner id of the data
// (`"annotations"`), so any element can add a format for data it does not own
// — a DICOM plugin registering `"dicom"` for annotations — without importing,
// or even waiting for, the owning module.
//
// The registry is a plain conversion service. The pipeline is one caller of it
// (it matches formats to sinks, see `IOPipeline.formatFor`); an owner's own
// "download as…" button or an event handler converting a single object is
// another, and needs no bundle flush to do it.

export type IOFormatEmit = (eventName: string, payload: Record<string, unknown>) => void;

function normalizeExtension(ext: string): string {
    const trimmed = String(ext ?? "").trim().toLowerCase().replace(/^\.+/, "");
    return trimmed ? `.${trimmed}` : "";
}

function resolveText(value: string | (() => string) | undefined): string | undefined {
    if (typeof value === "function") {
        try { return value(); } catch { return undefined; }
    }
    return value;
}

/** Bytes of a wire payload, whichever of the accepted shapes it arrived in. */
function isBytes(data: unknown): data is Uint8Array | ArrayBuffer {
    return data instanceof ArrayBuffer || ArrayBuffer.isView(data);
}

export class IOFormatRegistry implements IOFormatRegistryLike {
    private readonly domains: Map<string, Map<string, IOFormat>> = new Map();

    constructor(private readonly emit: IOFormatEmit = () => {}) {}

    register(format: IOFormat): IODisposer {
        if (!format || typeof format.domain !== "string" || !format.domain
            || typeof format.id !== "string" || !format.id) {
            throw new Error("[IO] formats.register: a format needs a `domain` and an `id`.");
        }
        if (!format.encode && !format.decode && !format.encodeItem && !format.decodeItem) {
            throw new Error(`[IO] format "${format.domain}/${format.id}" implements no conversion.`);
        }
        let domain = this.domains.get(format.domain);
        if (!domain) { domain = new Map(); this.domains.set(format.domain, domain); }
        if (domain.has(format.id)) {
            console.warn(`[IO] format "${format.domain}/${format.id}" is registered twice; replacing.`);
        }
        const stored: IOFormat = {
            ...format,
            extensions: (format.extensions ?? []).map(normalizeExtension).filter(Boolean),
        };
        domain.set(format.id, stored);
        this.emit("io:format-registered", { domain: format.domain, id: format.id });
        return () => {
            const cur = this.domains.get(format.domain);
            if (cur?.get(format.id) !== stored) return;
            cur.delete(format.id);
            this.emit("io:format-unregistered", { domain: format.domain, id: format.id });
        };
    }

    get(domain: string, id: string): IOFormat | undefined {
        return this.domains.get(domain)?.get(id);
    }

    has(domain: string, id: string): boolean {
        return !!this.get(domain, id);
    }

    list(domain: string): IOFormat[] {
        return Array.from(this.domains.get(domain)?.values() ?? []);
    }

    title(domain: string, id: string): string {
        return resolveText(this.get(domain, id)?.title) ?? id;
    }

    /** Declared defaults overlaid with the caller's values. Keys starting `_` are UI-only. */
    resolveOptions(format: IOFormat | undefined, options?: Record<string, unknown>): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const [key, descriptor] of Object.entries(format?.options ?? {})) {
            if (key.startsWith("_") || !descriptor || !("default" in descriptor)) continue;
            out[key] = descriptor.default;
        }
        for (const [key, value] of Object.entries(options ?? {})) {
            if (value !== undefined) out[key] = value;
        }
        return out;
    }

    descriptor(domain: string, id: string, options?: Record<string, unknown>): IOFormatDescriptor {
        const format = this.get(domain, id);
        const binary = !!format?.binary;
        return {
            domain, id,
            registered: !!format,
            binary,
            contentType: format?.contentType ?? (binary ? "application/octet-stream" : "text/plain"),
            fileExt: (format?.extensions?.[0] ?? "").replace(/^\./, ""),
            options: this.resolveOptions(format, options),
        };
    }

    /**
     * Which format is this data in? `undefined` when nothing recognises it.
     *
     * A file-name extension is evidence, a `sniff` is a look at the content:
     * a format matching the name wins unless its own sniff says "not mine",
     * and with no usable name the best sniff wins. Longer extensions beat
     * shorter ones, so `.geo.json` is not claimed by a `.json` format.
     */
    detect(domain: string, data: unknown, hint: IOFormatSniffHint = {}): string | undefined {
        const formats = this.list(domain).filter(f => !!f.decode);
        if (!formats.length) return undefined;

        const sniffHint: IOFormatSniffHint = { ...hint };
        if (sniffHint.json === undefined && typeof data === "string") {
            const head = data.trimStart()[0];
            if (head === "{" || head === "[") {
                try { sniffHint.json = JSON.parse(data); } catch { /* not JSON */ }
            }
        } else if (sniffHint.json === undefined && data && typeof data === "object" && !isBytes(data)) {
            sniffHint.json = data;
        }

        const name = String(hint.fileName ?? "").toLowerCase();
        let best: string | undefined;
        let bestScore = 0;
        for (const format of formats) {
            const extLength = name
                ? Math.max(0, ...format.extensions.filter(e => name.endsWith(e)).map(e => e.length))
                : 0;
            let sniffed: number | undefined;
            if (format.sniff) {
                try { sniffed = Number(format.sniff(data as any, sniffHint)) || 0; }
                catch { sniffed = 0; }
            }
            let score: number;
            if (extLength > 0) {
                if (sniffed === 0) continue;                       // the name lied
                score = 1 + (sniffed ?? 0.5) + extLength / 1000;
            } else {
                score = sniffed ?? 0;
            }
            if (score > bestScore) { bestScore = score; best = format.id; }
        }
        return best;
    }

    private contextFor(format: IOFormat, fctx?: Partial<IOFormatContext>): IOFormatContext {
        return { ...fctx, options: this.resolveOptions(format, fctx?.options) };
    }

    private require(domain: string, id: string, method: keyof IOFormat): IOFormat {
        const format = this.get(domain, id);
        if (!format) throw new Error(`Unknown format "${id}" for "${domain}".`);
        if (typeof format[method] !== "function") {
            throw new Error(`Format "${id}" for "${domain}" does not support ${String(method)}.`);
        }
        return format;
    }

    async encode(domain: string, id: string, model: unknown, fctx?: Partial<IOFormatContext>): Promise<IOEncoded | undefined> {
        const format = this.require(domain, id, "encode");
        return await format.encode!(model, this.contextFor(format, fctx));
    }

    async decode(domain: string, id: string, data: unknown, fctx?: Partial<IOFormatContext>): Promise<{ model: unknown; format: string }> {
        if (id !== "auto") {
            const format = this.require(domain, id, "decode");
            return { model: await format.decode!(data as any, this.contextFor(format, fctx)), format: id };
        }
        const detected = this.detect(domain, data, { fileName: fctx?.fileName });
        if (detected) return this.decode(domain, detected, data, fctx);
        // Nothing claimed it. Formats without a `sniff` cannot, so give each of
        // those one honest attempt before giving up — never a format that
        // looked and said no.
        for (const format of this.list(domain)) {
            if (!format.decode || format.sniff) continue;
            try {
                return { model: await format.decode(data as any, this.contextFor(format, fctx)), format: format.id };
            } catch { /* next */ }
        }
        throw new Error(`No registered "${domain}" format recognises this data.`);
    }

    encodeItem(domain: string, id: string, item: unknown, fctx?: Partial<IOFormatContext>): unknown {
        const format = this.require(domain, id, "encodeItem");
        return format.encodeItem!(item, this.contextFor(format, fctx));
    }

    decodeItem(domain: string, id: string, raw: unknown, fctx?: Partial<IOFormatContext>): unknown {
        const format = this.require(domain, id, "decodeItem");
        return format.decodeItem!(raw, this.contextFor(format, fctx));
    }
}
