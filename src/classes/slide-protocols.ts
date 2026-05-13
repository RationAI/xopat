// Slide-protocol registry. Owns the resolution from a `DataSpecification`
// (or per-entry `protocol` override) to either a URL string or a pre-built
// `OpenSeadragon.TileSource`. Replaces the inline `new Function(...)` eval
// of `env.client.image_group_protocol` / `data_group_protocol` and gives
// plugins a clean extension point (factory protocols, e.g. DICOMWebTileSource).
//
// Singleton, exposed as `window.SLIDE_PROTOCOLS`. Bootstrapped from
// `src/app.ts` adjacent to `bootstrapIOPipeline(...)`.
//
// See src/types/slide-protocols.d.ts for the public type surface and
// src/.claude or the plan file for the full design.

import { BackgroundConfig } from "./background-config";
import { HttpClient } from "./http-client";

const INLINE_JS_HINT = /[`$]/; // backtick or `${` — heuristic for legacy inline template

function looksLikeInlineTemplate(s: string): boolean {
    return typeof s === "string" && INLINE_JS_HINT.test(s);
}

function compileUrlEntry(entry: SlideProtocolUrlTemplateEntry): (data: any) => string {
    // Cache the compiled Function on the entry so we don't `new Function` per tile.
    const cached = (entry as any).__compiled as ((data: any) => string) | undefined;
    if (cached) return cached;

    const fn = entry.legacy
        ? new Function("path,data", "return " + entry.urlTemplate) as (path: any, data: any) => string
        : new Function("data", "return " + entry.urlTemplate) as (data: any) => string;

    const wrapped: (data: any) => string = entry.legacy
        ? (data: any) => (fn as (path: any, data: any) => string)(entry.legacyServer, data)
        : (data: any) => (fn as (data: any) => string)(data);

    (entry as any).__compiled = wrapped;
    return wrapped;
}

function isFactoryEntry(e: SlideProtocolEntry): e is SlideProtocolFactoryEntry {
    return typeof (e as SlideProtocolFactoryEntry).createTileSource === "function";
}

function isTileSourceInstance(value: any): boolean {
    const OSD = (globalThis as any).OpenSeadragon;
    return !!(OSD && value instanceof OSD.TileSource);
}

export class SlideProtocolRegistry implements SlideProtocolRegistryLike {
    private entries = new Map<SlideProtocolId, SlideProtocolEntry>();
    private defaultBackground: SlideProtocolId | undefined;
    private defaultVisualization: SlideProtocolId | undefined;
    private warnedLegacyBypass = false;
    private warnedLegacyEnv = false;
    /** Per-entry HttpClient cache. Keyed by entry id so factory/url entries share the lookup path. */
    private clients = new Map<SlideProtocolId, HttpClient>();
    /** Longest-first list of `{prefix, client}` for URL-based reverse lookup. Rebuilt whenever a client is cached. */
    private clientPrefixes: Array<{ prefix: string; client: HttpClient }> = [];
    /** Transient "active" client set by `withActiveClient`. Read by the patched `OpenSeadragon.makeAjaxRequest`. */
    private activeClient: HttpClient | undefined = undefined;

    register(entry: SlideProtocolEntry): () => void {
        if (!entry?.id) throw new Error("[SLIDE_PROTOCOLS] register: missing id");
        if (this.entries.has(entry.id)) {
            throw new Error(`[SLIDE_PROTOCOLS] duplicate protocol id "${entry.id}"`);
        }
        this.entries.set(entry.id, entry);
        return () => this.unregister(entry.id);
    }

    unregister(id: SlideProtocolId): boolean {
        const cur = this.entries.get(id);
        if (!cur) return false;
        this.entries.delete(id);
        if (this.defaultBackground === id) this.defaultBackground = undefined;
        if (this.defaultVisualization === id) this.defaultVisualization = undefined;
        return true;
    }

    get(id: SlideProtocolId): SlideProtocolEntry | undefined {
        return this.entries.get(id);
    }

    has(id: SlideProtocolId): boolean {
        return this.entries.has(id);
    }

    list() {
        const out: Array<{ id: SlideProtocolId; label: string; deprecated: boolean; kind: "url" | "factory" }> = [];
        for (const e of this.entries.values()) {
            out.push({
                id: e.id,
                label: e.label ?? e.id,
                deprecated: !!e.deprecated,
                kind: isFactoryEntry(e) ? "factory" : "url",
            });
        }
        return out;
    }

    getDefaultBackgroundId() { return this.defaultBackground; }
    getDefaultVisualizationId() { return this.defaultVisualization; }

    setDefault(role: "background" | "visualization", id: SlideProtocolId | undefined) {
        if (id !== undefined && !this.entries.has(id)) {
            console.warn(`[SLIDE_PROTOCOLS] setDefault: unknown protocol "${id}" for role "${role}"`);
            return;
        }
        if (role === "background") this.defaultBackground = id;
        else this.defaultVisualization = id;
    }

    /**
     * Lazily construct and cache the HttpClient for an entry that declares
     * `httpClient` options. Returns undefined when an entry has no client
     * options.
     */
    private _clientFor(entry: SlideProtocolEntry): HttpClient | undefined {
        const cached = this.clients.get(entry.id);
        if (cached) return cached;
        const opts = entry.httpClient;
        if (!opts || (!opts.proxy && !opts.baseURL)) return undefined;
        try {
            const client = new HttpClient({ ...opts });
            this.clients.set(entry.id, client);
            this.clientPrefixes.push({ prefix: (client.baseURL || "").replace(/\/+$/, ""), client });
            // Longest prefix first so `getActiveClientForUrl` picks the most specific match.
            this.clientPrefixes.sort((a, b) => b.prefix.length - a.prefix.length);
            return client;
        } catch (e) {
            console.warn(`[SLIDE_PROTOCOLS] failed to construct HttpClient for protocol "${entry.id}":`, e);
            return undefined;
        }
    }

    getClientForProtocol(id: SlideProtocolId): HttpClient | undefined {
        const entry = this.entries.get(id);
        return entry ? this._clientFor(entry) : undefined;
    }

    getActiveClientForUrl(url: string): HttpClient | undefined {
        if (this.activeClient) return this.activeClient;
        if (!url) return undefined;
        // Normalize relative URLs to absolute against the viewer origin so
        // prefix matching against `client.baseURL` (which is absolute) works
        // for TileSources that emit relative tile URLs.
        let absolute = url;
        if (!/^https?:\/\//i.test(url)) {
            try { absolute = new URL(url, window.location.href).href; }
            catch { /* malformed URL — keep original, prefix match will simply miss */ }
        }
        for (const { prefix, client } of this.clientPrefixes) {
            if (prefix && absolute.startsWith(prefix)) return client;
        }
        return undefined;
    }

    async withActiveClient<T>(client: HttpClient | undefined, fn: () => T | Promise<T>): Promise<T> {
        if (!client) return await fn();
        const prev = this.activeClient;
        this.activeClient = client;
        try {
            return await fn();
        } finally {
            this.activeClient = prev;
        }
    }

    resolveBackground(args: SlideProtocolResolveArgs): ResolvedSlideProtocol {
        return this.resolve({ ...args, role: "background" });
    }

    resolveVisualization(args: SlideProtocolResolveArgs): ResolvedSlideProtocol {
        return this.resolve({ ...args, role: "visualization" });
    }

    resolve(args: SlideProtocolResolveArgs & { role: "background" | "visualization" }): ResolvedSlideProtocol {
        const { spec, isSecureMode, role } = args;
        const isObjectSpec = spec && typeof spec === "object";

        // 1. Deprecated TileSource short-circuit.
        if (isObjectSpec && isTileSourceInstance((spec as DataOverride).tileSource)) {
            if (!this.warnedLegacyBypass) {
                this.warnedLegacyBypass = true;
                console.warn(
                    "[SLIDE_PROTOCOLS] DataOverride.tileSource bypass is deprecated; " +
                    "plugins should register a factory protocol via SLIDE_PROTOCOLS.register({ id, createTileSource }) " +
                    "and reference it via `protocol: '<id>'` instead."
                );
            }
            return {
                kind: "tileSource",
                tileSource: (spec as DataOverride).tileSource,
                protocolId: "__inline_tile_source",
            };
        }

        // 2. Per-entry override.
        const configEntry = role === "background" ? args.bgEntry : args.vizEntry;
        const protoOverride: string | undefined =
            (isObjectSpec ? (spec as DataOverride).protocol : undefined)
            ?? configEntry?.protocol;

        let entry: SlideProtocolEntry | undefined;

        if (protoOverride) {
            if (this.entries.has(protoOverride)) {
                entry = this.entries.get(protoOverride);
            } else if (looksLikeInlineTemplate(protoOverride)) {
                if (isSecureMode) {
                    console.warn(
                        `[SLIDE_PROTOCOLS] inline-JS protocol override rejected in secure mode ` +
                        `(value: ${JSON.stringify(protoOverride)}); falling back to default.`
                    );
                    entry = undefined;
                } else {
                    // Synthesize a transient legacy-style entry (matches the previous
                    // `new Function("path,data", ...)` behavior). Not added to the
                    // registry — single-shot eval.
                    entry = {
                        id: "__inline_override",
                        urlTemplate: protoOverride,
                        legacy: true,
                        legacyServer: undefined,
                        legacyArrayData: role === "visualization",
                        deprecated: true,
                    } as SlideProtocolUrlTemplateEntry;
                }
            } else {
                console.warn(
                    `[SLIDE_PROTOCOLS] unknown protocol "${protoOverride}"; falling back to default.`
                );
            }
        }

        // 3. Default.
        if (!entry) {
            const defaultId = role === "background" ? this.defaultBackground : this.defaultVisualization;
            if (!defaultId) {
                throw new Error(
                    `[SLIDE_PROTOCOLS] no protocol resolvable for role "${role}" — neither override nor default available.`
                );
            }
            entry = this.entries.get(defaultId);
            if (!entry) {
                throw new Error(
                    `[SLIDE_PROTOCOLS] default protocol "${defaultId}" is registered but missing — registry corruption.`
                );
            }
        }

        // 4. Eval / factory.
        const dataID = BackgroundConfig.dataFromSpec(spec) as DataID;
        const client = this._clientFor(entry);
        const ctx: SlideProtocolResolveContext = {
            dataID,
            spec,
            bgEntry: args.bgEntry,
            vizEntry: args.vizEntry,
            role,
            options: args.options,
            httpClient: client,
        };

        if (isFactoryEntry(entry)) {
            const ts = entry.createTileSource(ctx);
            // Safety net: factories may forget to stamp the client; we do it for them.
            if (client && ts && !(ts as any).__xopatHttpClient) {
                (ts as any).__xopatHttpClient = client;
            }
            return { kind: "tileSource", tileSource: ts, protocolId: entry.id };
        }

        const urlEntry = entry as SlideProtocolUrlTemplateEntry;
        const compile = compileUrlEntry(urlEntry);
        const data = urlEntry.legacy && urlEntry.legacyArrayData ? [dataID] : dataID;
        const rendered = compile(data);
        // Relative URLs from the template are joined onto the proxy baseURL.
        // Absolute URLs (http(s)://…) are returned verbatim; the client matches
        // them via `getActiveClientForUrl` if its baseURL is a prefix.
        const url = client ? client.resolveUrl(rendered) : rendered;
        return { kind: "url", url, protocolId: entry.id };
    }

    ingestFromEnv(envClient: any): void {
        if (!envClient) return;

        // 1. New-shape entries (admin-controlled). Each entry is either a string
        //    (URL template only) or an object `{ url, ...httpClientOptions }`.
        const newMap = envClient.slide_protocols as Record<string, string | SlideProtocolEnvEntry> | undefined;
        if (newMap && typeof newMap === "object") {
            for (const [id, value] of Object.entries(newMap)) {
                if (this.entries.has(id)) continue;
                if (typeof value === "string") {
                    this.register({ id, label: id, urlTemplate: value, legacy: false });
                } else if (value && typeof value === "object" && typeof value.url === "string") {
                    const { url, ...clientOpts } = value;
                    this.register({
                        id,
                        label: id,
                        urlTemplate: url,
                        legacy: false,
                        httpClient: clientOpts,
                    });
                } else {
                    console.warn(`[SLIDE_PROTOCOLS] ignoring malformed slide_protocols entry "${id}":`, value);
                }
            }
        }

        // 2. Synthesize from legacy fields.
        let synthBg = false;
        let synthViz = false;
        if (envClient.image_group_protocol && !this.has("__legacy_bg")) {
            this.register({
                id: "__legacy_bg",
                label: "Legacy image_group_protocol",
                urlTemplate: envClient.image_group_protocol,
                legacy: true,
                legacyServer: envClient.image_group_server,
                deprecated: true,
            });
            synthBg = true;
        }
        if (envClient.data_group_protocol && !this.has("__legacy_viz")) {
            this.register({
                id: "__legacy_viz",
                label: "Legacy data_group_protocol",
                urlTemplate: envClient.data_group_protocol,
                legacy: true,
                legacyServer: envClient.data_group_server,
                legacyArrayData: true,
                deprecated: true,
            });
            synthViz = true;
        }

        // 3. Defaults.
        const firstNewKey = newMap ? Object.keys(newMap)[0] : undefined;
        const bgDefault = envClient.default_background_protocol
            ?? (synthBg ? "__legacy_bg" : firstNewKey);
        const vizDefault = envClient.default_visualization_protocol
            ?? (synthViz ? "__legacy_viz" : firstNewKey ?? bgDefault);

        if (bgDefault) this.setDefault("background", bgDefault);
        if (vizDefault) this.setDefault("visualization", vizDefault);

        // 4. One-shot deprecation warning.
        if ((synthBg || synthViz) && !this.warnedLegacyEnv) {
            this.warnedLegacyEnv = true;
            console.warn(
                "[SLIDE_PROTOCOLS] env.client uses legacy image_group_protocol/data_group_protocol; " +
                "synthesizing __legacy_bg / __legacy_viz entries. Please migrate to slide_protocols + " +
                "default_background_protocol / default_visualization_protocol."
            );
        }
    }
}

/**
 * Create the registry, ingest env, attach to `window.SLIDE_PROTOCOLS`. Mirrors
 * `bootstrapIOPipeline` in `src/classes/io/bootstrap.ts`.
 */
export function bootstrapSlideProtocols(ENV: XOpatCoreConfig): SlideProtocolRegistry {
    const registry = new SlideProtocolRegistry();
    registry.ingestFromEnv((ENV as any)?.client);
    (window as any).SLIDE_PROTOCOLS = registry;
    return registry;
}
