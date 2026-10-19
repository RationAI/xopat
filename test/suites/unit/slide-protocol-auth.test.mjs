/**
 * A deployment that streams slides from two upstreams with DIFFERENT credentials
 * declares one `slide_protocols` entry per auth context, and each data item picks
 * one by name (`DataOverride.protocol`). The session never names a context — that
 * would let an imported bundle choose which credential goes upstream (AGENTS.md §7).
 *
 * For that to work the credential has to travel with the RESOLVED source: the two
 * entries usually share a proxy alias, so their rendered URLs are identical and a
 * URL-keyed lookup cannot tell them apart. These vectors pin that contract.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.window.OpenSeadragon = globalThis.window.OpenSeadragon ?? {
    TileSource: class TileSource {},
};

const declaredContexts = [];
const APP = {
    url: "https://viewer.example.org/",
    auth: {
        requireContext: (req) => declaredContexts.push(req),
    },
};
globalThis.APPLICATION_CONTEXT = globalThis.window.APPLICATION_CONTEXT = APP;
globalThis.XOpatUser = globalThis.window.XOpatUser = {
    instance: () => ({
        getSecret: () => undefined,
        requestSecretUpdate: async () => {},
    }),
};

const { SlideProtocolRegistry } = await import("../../../src/classes/slide-protocols.ts");

/** Two entries, one proxy alias, two auth contexts — the multi-credential shape. */
function twoUpstreams() {
    const registry = new SlideProtocolRegistry();
    registry.ingestFromEnv({
        slide_protocols: {
            hosp_a: {
                url: "`/slides/${data}`",
                proxy: "img",
                auth: { contextId: "hospital-a", required: true },
            },
            hosp_b: {
                url: "`/slides/${data}`",
                proxy: "img",
                auth: { contextId: "hospital-b", required: true },
            },
        },
        default_background_protocol: "hosp_a",
        default_visualization_protocol: "hosp_a",
    });
    return registry;
}

test("each data item is resolved with its own protocol's credential @unit", () => {
    const registry = twoUpstreams();

    const a = registry.resolveBackground({ spec: { dataID: "s1", protocol: "hosp_a" }, isSecureMode: true });
    const b = registry.resolveBackground({ spec: { dataID: "s2", protocol: "hosp_b" }, isSecureMode: true });

    expect(a.protocolId).toBe("hosp_a");
    expect(b.protocolId).toBe("hosp_b");
    // Same upstream, indistinguishable base URL — only the client separates them.
    expect(a.client.baseURL).toBe(b.client.baseURL);
    expect(a.client.authContextId).toBe("hospital-a");
    expect(b.client.authContextId).toBe("hospital-b");
});

test("a base URL claimed by two contexts yields no client rather than the wrong one @unit", () => {
    const registry = twoUpstreams();
    const { url, client } = registry.resolveBackground({
        spec: { dataID: "s2", protocol: "hosp_b" }, isSecureMode: true,
    });
    // Force both clients to exist so the prefix index sees the collision.
    registry.getClientForProtocol("hosp_a");

    expect(registry.getActiveClientForUrl(url)).toBe(undefined);
    // Asking by id is unambiguous and stays available.
    expect(registry.getClientForProtocol("hosp_b").authContextId).toBe("hospital-b");
    expect(client.authContextId).toBe("hospital-b");
});

test("an unambiguous entry still resolves its client from a URL @unit", () => {
    const registry = new SlideProtocolRegistry();
    registry.ingestFromEnv({
        slide_protocols: {
            solo: { url: "`/slides/${data}`", proxy: "img", auth: { contextId: "hospital-a" } },
        },
        default_background_protocol: "solo",
    });
    const { url } = registry.resolveBackground({ spec: "s1", isSecureMode: true });
    expect(registry.getActiveClientForUrl(url).authContextId).toBe("hospital-a");
});

test("every required context is declared up-front, not on first slide @unit", () => {
    declaredContexts.length = 0;
    const registry = twoUpstreams();
    // Nothing opened yet: without the sweep only the first slide's context would
    // ever be declared, so the second upstream's missing login stays invisible.
    registry.declareAuthContexts();

    expect(declaredContexts.map((c) => c.contextId).sort()).toEqual(["hospital-a", "hospital-b"]);
    expect(declaredContexts.every((c) => c.requiresLogin)).toBe(true);

    // Idempotent — a later resolve must not re-declare.
    registry.resolveBackground({ spec: { dataID: "s1", protocol: "hosp_a" }, isSecureMode: true });
    registry.declareAuthContexts();
    expect(declaredContexts.length).toBe(2);
});

/**
 * The STRING form of a `slide_protocols` entry declares the upstream in its URL
 * template and nothing else. It used to bind no client at all, so its metadata and
 * tile requests left as a bare `fetch` — no credential, no refresh-on-401 — and an
 * authenticated deployment answered 403 with nothing in the console to say why.
 * The origin is derivable from the template, so it is derived.
 */
test("a string-form entry binds a client to the origin its template resolves to @unit", () => {
    const registry = new SlideProtocolRegistry();
    registry.ingestFromEnv({
        slide_protocols: {
            wsi: "`https://wsi.example.org/v3/slides/info?slide_id=${data}`",
        },
        default_background_protocol: "wsi",
    });

    const { url, client } = registry.resolveBackground({ spec: "s1", isSecureMode: true });
    expect(url).toBe("https://wsi.example.org/v3/slides/info?slide_id=s1");
    expect(client).toBeTruthy();
    expect(client.baseURL).toBe("https://wsi.example.org");
    // The main identity, as a hand-written `{"baseURL": …}` block would give
    // (undefined is how XOpatUser spells the default context).
    expect(client.authContextId).toBe(undefined);
    expect(registry.getActiveClientForUrl(url)).toBe(client);
});

test("an explicit httpClient block still wins over the derived origin @unit", () => {
    const registry = new SlideProtocolRegistry();
    registry.ingestFromEnv({
        slide_protocols: {
            wsi: {
                url: "`https://wsi.example.org/v3/slides/info?slide_id=${data}`",
                baseURL: "https://wsi.example.org",
                auth: { contextId: "hospital-a" },
            },
        },
        default_background_protocol: "wsi",
    });
    const { client } = registry.resolveBackground({ spec: "s1", isSecureMode: true });
    expect(client.authContextId).toBe("hospital-a");
});

/**
 * `${data}` IS the upstream here: every slide may live on a different origin, so
 * there is no one origin to bind a credential to. Deriving the probe's own origin
 * would be worse than deriving nothing — it would send the token to whichever host
 * the first slide happened to name.
 */
test("a template whose data carries the whole URL derives no client @unit", () => {
    const registry = new SlideProtocolRegistry();
    registry.ingestFromEnv({
        slide_protocols: { any: "`${data}`" },
        default_background_protocol: "any",
    });
    const { url, client } = registry.resolveBackground({
        spec: "https://elsewhere.example.net/slide.dzi", isSecureMode: true,
    });
    expect(url).toBe("https://elsewhere.example.net/slide.dzi");
    expect(client).toBe(undefined);
});

test("a relative template with no proxy derives no client @unit", () => {
    const registry = new SlideProtocolRegistry();
    registry.ingestFromEnv({
        slide_protocols: { rel: "`/v3/slides/info?slide_id=${data}`" },
        default_background_protocol: "rel",
    });
    expect(registry.resolveBackground({ spec: "s1", isSecureMode: true }).client).toBe(undefined);
});

/**
 * The legacy `*_group_protocol` pair substitutes the upstream from its sibling
 * `*_group_server` key, so the origin is static even though the template is not.
 */
test("legacy image_group_protocol derives its client from image_group_server @unit", () => {
    const registry = new SlideProtocolRegistry();
    registry.ingestFromEnv({
        image_group_protocol: "`${path}/slides/${data}/info`",
        image_group_server: "https://legacy.example.org",
    });
    const { url, client } = registry.resolveBackground({ spec: "s1", isSecureMode: true });
    expect(url).toBe("https://legacy.example.org/slides/s1/info");
    expect(client.baseURL).toBe("https://legacy.example.org");
});

/**
 * The derived credential has to be refusable: a public upstream that never asked
 * for `Authorization` answers the preflight it triggers with a CORS failure, not a
 * 401. An empty `types` array is that refusal — and it had to stop reading as
 * "unset", which silently resolved back to `["jwt"]`.
 */
test("auth.types: [] sends no credential @unit", async () => {
    const registry = new SlideProtocolRegistry();
    registry.ingestFromEnv({
        slide_protocols: {
            pub: {
                url: "`https://public.example.org/slides/${data}.dzi`",
                baseURL: "https://public.example.org",
                auth: { types: [] },
            },
        },
        default_background_protocol: "pub",
    });
    const { url, client } = registry.resolveBackground({ spec: "s1", isSecureMode: true });
    const headers = await client._authHeaders(url, "GET");
    expect(Object.keys(headers)).toEqual([]);
});
