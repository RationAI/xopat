/**
 * A chat session outlives the process; the provider instance it was created with does not.
 *
 * Provider instances are minted with `uid('prov')` into a Map on a `globalThis` state bag, so
 * every id is re-minted at boot. A session record is durable and stores that id — and the
 * session list is fetched FOR the current provider (`ChatPanel` -> `listSessions(providerId)`).
 * Under a deployment with persistent storage those two facts met, and every conversation
 * written before a restart was filtered out: the transcript on disk, invisible in the picker,
 * and `getProviderRuntime(session.providerId)` unable to resolve it if it had been.
 *
 * The fix is that a session names its provider by the identity that IS stable — `managedKey` /
 * `managedByPlugin` / `typeId`, the same reference grammar deployment config already uses
 * (`shared/providerRef.ts`) — and re-binds to the live instance on first access. This file pins
 * both halves: the pure decision, and the registry resolving a real re-minted instance.
 *
 * Read `durableProviderRefs` before changing any of it. The three cases it distinguishes are a
 * consent boundary, not a lookup convenience: an operator-registered provider may be re-found,
 * a user's own bring-your-own-key instance may NOT be silently replaced by somebody else's.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const moduleDir = path.join(fromRoot(), "modules", "vercel-ai-chat-sdk");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-chat-ref-"));

async function bundle(entry, name, platform = "neutral") {
    const outfile = path.join(tmp, name + ".mjs");
    await esbuild.build({
        entryPoints: [entry], outfile, bundle: true, platform,
        format: "esm", logLevel: "silent", external: ["ai", "@ai-sdk/*"],
    });
    return import(pathToFileURL(outfile).href);
}

const { providerIdentityOf, durableProviderRefs, matchProviderRef } =
    await bundle(path.join(moduleDir, "shared", "providerRef.ts"), "providerRef");

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const OPERATOR = {
    id: "prov_first_boot",
    typeId: "openai-compatible",
    metadata: {
        managedKey: "chat-openai-compatible:openai-compatible:default",
        managedByPlugin: "chat-openai-compatible",
        autoCreated: true,
        role: "default-provider",
    },
};

/** The same provider after a restart: same identity, new instance id. */
const OPERATOR_REMINTED = { ...OPERATOR, id: "prov_second_boot" };

const sessionOf = (provider, extra = {}) => ({
    id: "sess_1",
    providerId: provider.id,
    providerTypeId: provider.typeId,
    metadata: { ownerPrincipal: "sess:abc", providerRef: providerIdentityOf(provider), ...extra },
});

// ── 1. the durable identity ─────────────────────────────────────────────────────────────

test("a provider's durable identity is what a persisted record may name it by @unit", () => {
    expect(providerIdentityOf(OPERATOR)).toEqual({
        managedKey: "chat-openai-compatible:openai-compatible:default",
        managedByPlugin: "chat-openai-compatible",
        typeId: "openai-compatible",
    });
    // Absent fields are null, never undefined — the record is written to storage, and JSON
    // drops undefined, which would make a round-tripped ref a different shape.
    expect(providerIdentityOf({ id: "prov_x", typeId: "openai" }))
        .toEqual({ managedKey: null, managedByPlugin: null, typeId: "openai" });
});

test("an operator session offers its references strongest-first @unit", () => {
    expect(durableProviderRefs(sessionOf(OPERATOR))).toEqual([
        "chat-openai-compatible:openai-compatible:default",
        "chat-openai-compatible",
        "openai-compatible",
    ]);
});

test("a session created before the stamp existed falls back to its provider type @unit", () => {
    // The records already on disk. Without this the transcripts stay invisible forever.
    const legacy = { id: "sess_old", providerId: "prov_gone", providerTypeId: "openai-compatible" };
    expect(durableProviderRefs(legacy)).toEqual(["openai-compatible"]);
});

test("a bring-your-own-key session offers NOTHING, on purpose @unit", () => {
    // A user instance has no managedKey, so the only same-type candidate is the operator's
    // provider — somebody else's endpoint on somebody else's key. Silently re-binding there
    // would spend a key the user never chose. The session is listed and flagged instead;
    // sending waits for an explicit pick.
    const userProvider = {
        id: "prov_user",
        typeId: "openai-compatible",
        metadata: { ownerPrincipal: "sess:abc" },
    };
    expect(durableProviderRefs(sessionOf(userProvider))).toEqual([]);
});

// ── 2. resolution against a re-minted registry ──────────────────────────────────────────

/** What `resolveSessionProviderId` does, over the records a restarted process holds. */
const resolve = (records, session) => {
    if (records.some((r) => r.id === session.providerId)) return session.providerId;
    for (const ref of durableProviderRefs(session)) {
        const match = matchProviderRef(records, ref);
        if (match) return match.id;
    }
    return null;
};

test("a stale session finds the same provider under its new id @unit", () => {
    const session = sessionOf(OPERATOR);
    expect(resolve([OPERATOR], session), "before the restart, the live id wins").toBe("prov_first_boot");
    expect(resolve([OPERATOR_REMINTED], session), "after it, the managed key does").toBe("prov_second_boot");
});

test("a reference never resolves to a user-created provider @unit", () => {
    // The trust rule in shared/providerRef.ts: alias tiers consider operator records only, so
    // a forged managedKey cannot capture a deployment-wide reference — and a resumed session
    // cannot be re-pointed at an instance the user did not choose.
    const forged = {
        id: "prov_forged",
        typeId: "openai-compatible",
        metadata: { ...OPERATOR.metadata, ownerPrincipal: "sess:someone-else" },
    };
    expect(resolve([forged], sessionOf(OPERATOR))).toBe(null);
});

test("a provider type that is gone resolves to nothing rather than to a neighbour @unit", () => {
    const other = {
        id: "prov_other",
        typeId: "anthropic",
        metadata: { managedKey: "chat-anthropic:anthropic:default" },
    };
    expect(resolve([other], sessionOf(OPERATOR))).toBe(null);
});

// ── 3. the registry, for real ───────────────────────────────────────────────────────────

/**
 * The regression itself: a durable session store carried across a registry rebuilt from
 * scratch, which is what a server restart is for everything held in `globalThis`.
 * `ChatServerRegistry` falls back to an in-memory storage shim when `XOPAT_SERVER.storage` is
 * absent, so this needs no server and no fixtures.
 */
test("the registry re-binds a session written by a previous boot @unit", async () => {
    const { ChatServerRegistry } = await bundle(
        path.join(moduleDir, "server", "chatRegistry.server.ts"), "chatRegistry", "node");

    const STATE_KEY = "__XOPAT_CHAT_SERVER_STATE__";
    const adapter = { id: "test-adapter", resolveModel: () => ({}) };
    const type = { id: "openai-compatible", label: "OpenAI-compatible", adapter: adapter.id, configSchema: [] };
    const managed = {
        typeId: type.id,
        label: "Cerit Provider",
        metadata: {
            managedByPlugin: "chat-openai-compatible",
            managedKey: "chat-openai-compatible:openai-compatible:default",
            autoCreated: true,
        },
    };

    delete globalThis[STATE_KEY];
    const first = ChatServerRegistry.instance();
    first.registerAdapter(adapter);
    first.upsertProviderType(type);
    // Unowned: the operator's service-provided instance, shared with every user.
    const before = await first.createProviderInstance(managed, null);
    const store = first.getSessionStore();

    const session = await store.createSession({
        id: "sess_across_restart",
        title: "what slide am I viewing",
        providerId: before.id,
        providerTypeId: type.id,
        modelId: "agentic",
        personalityId: "default",
        contextId: null,
        metadata: { ownerPrincipal: "sess:abc", providerRef: providerIdentityOf(before) },
    });

    // Restart: the registry state bag is gone, the storage-backed session store is not.
    delete globalThis[STATE_KEY];
    const second = ChatServerRegistry.instance();
    second.state.sessionStore = store;
    second.registerAdapter(adapter);
    second.upsertProviderType(type);
    const after = await second.createProviderInstance(managed, null);

    expect(after.id, "the instance id is re-minted, which is the whole problem").not.toBe(before.id);
    expect(second.resolveSessionProviderId(session)).toBe(after.id);

    // And the panel's list — which asks for one provider — still contains it.
    const listed = await store.listSessions({
        ownerPrincipal: "sess:abc",
        providerFilter: (s) => second.resolveSessionProviderId(s) === after.id,
    });
    expect(listed.map((s) => s.id)).toEqual(["sess_across_restart"]);

    delete globalThis[STATE_KEY];
});
