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
