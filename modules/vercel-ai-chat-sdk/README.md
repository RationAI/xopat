# vercel-ai-chat-sdk

Chat + LLM broker for xOpat, built on the Vercel AI SDK. It owns the **chat panel**, the
**provider registry** (types + instances + adapters), stateless **model invocation**, and the
per-session scripting bridge. Providers are contributed by plugins (e.g. `chat-anthropic`,
`chat-openai-compatible`); the module ships no built-in adapters.

This README covers the **server-side APIs other plugins/modules reuse** — not the chat UI
internals.

## Region links (assistant → viewer navigation)

The system prompt directs the model to reference slide locations as clickable markdown links
instead of plain-text descriptions: `[label](#xopat-region?viewer=<contextId>&x=..&y=..&w=..&h=..&z=..)`
with coordinates in level-0 image pixels (same space as annotation coordinates, pathology
`bounds`, and `viewer.frameImageRegion`). `ChatMessageList` extracts these from the raw
assistant text **before** the anonymization-handle → friendly-name restoration (so handles
inside link targets survive), rewrites them to opaque sanitizer-safe fragment hrefs, and
`ChatModule.navigateToRegionFromChat` resolves the handle back to the real viewer and frames
the region (crop-aware for virtual-region splits; `w=0&h=0` pans to a point without zooming).
An optional `z` pins a 0-based focal-plane index on z-stack slides — applied via the viewer's
depth controller (same path as `viewer.setZDepth`) before framing; ignored on single-plane slides.

## Registering a provider (server)

Provider *types* + *instances* + *adapters* live in the server registry
(`server/chatRegistry.server.ts`). A plugin's `*.server.ts` registers its own from server-only
secure config using the managed helper:

```ts
// module:vercel-ai-chat-sdk/server/providerRegistration.server.ts
ensureManagedPluginProvider(ctx, {
  pluginId,
  managedKey,                 // stable dedup key; default `${pluginId}:${typeId}:default`
  adapter: {                  // ChatProviderAdapter — resolveModel (+ optional listModels)
    id: "openai-compatible",
    async resolveModel({ instance, modelId, config, secrets }) { /* return a LanguageModel */ },
  },
  providerType,               // CreateProviderTypeInput (adapter, configSchema, supportsImages…)
  provider,                   // instance payload (config/secrets/metadata)
}) // → { providerId, providerCreated, providerUpdated }
```

It is idempotent: on each boot it finds the existing managed instance (by `managedKey`) and
updates it instead of creating a duplicate. See `plugins/chat-openai-compatible/` for a full
example. Trigger it from the plugin client with `await this.server().ensureXxx(...)`.

## Internal (hidden) providers — reuse a model WITHOUT exposing it as a chat agent

Set **`metadata.hidden: true`** on the provider **type** and **instance** to register a model
that server code can invoke, but that is **not offered as a user-facing chat provider**:

- Excluded from the client `listProviders` RPC → absent from the chat provider picker.
- Excluded from the client `listProviderTypes` RPC → absent from the "add provider" UI.
- Still fully resolvable by id via `getProviderRuntime` → `runVisionInference` (below) and other
  server code keep working.
- Still visible to the registry's managed-provider dedup → not re-created on every boot.

Filtering happens only at the client-facing RPC boundary (`server/chat.server.ts`
`listProviders` / `listProviderTypes`); the registry's own lists stay unfiltered. Use this for a
model a plugin drives internally for its own reasoning rather than as a chat brain — e.g.
`plugins/pathology-medgemma` registers MedGemma hidden and consumes it through the
pathology-foundation `analyze` driver.

## One-shot vision/text inference (server)

`runVisionInference` (`server/inference.server.ts`) runs a single `generateText` against a
provider resolved **by id**, in a context fully isolated from the chat agent — no session,
history, or personality:

```ts
// xserver.module["vercel-ai-chat-sdk"].runVisionInference(...)  (from the client)
runVisionInference(ctx, {
  providerId,                 // a provider INSTANCE id (typically a hidden internal one)
  model,                      // or null → provider/type defaultModelId
  system, prompt,
  imageBase64,                // no data-URL prefix
  mediaType,                  // e.g. "image/png"
}) // → { text }
```

This is the seam the pathology-foundation `vercel`/analyze driver uses; combine it with a hidden
provider to reuse any SDK-supported model for internal image→text without publishing it to chat.

## BYOK — per-user API keys

Provider plugins register their type + managed instance **even when the deployment configures no
API key** (`server.json` `providerDefaults.apiKey` empty/absent). Users then supply their own key
from the chat settings dialog ("Providers & API keys"); the key gates model discovery and turns
for *that user only*.

### Semantics

- **Storage scope** (`resolveUserScope` in `server/chatRegistry.server.ts`): authenticated
  callers → `user:<jwt sub/id>`; anonymous callers → `sess:<server session id>` (the HttpOnly
  `xopat_session` cookie), so two anonymous browsers can never see each other's keys. The BYOK
  RPCs travel the same per-provider auth path as `listModels`/`sendTurn`
  (`ChatService._authCallOptions`), so the scope used at write time always matches the one used
  at inference time.
- **Merge order** at model resolution: `type.fixedSecrets` ← instance secrets ← **user secrets**
  — the user's key wins over the admin default.
- **Write-only**: secret values never travel back to any client. The RPCs
  (`getProviderUserSecretsStatus` / `setProviderUserSecrets` / `clearProviderUserSecrets`) return
  status flags only (`hasUserSecrets`, `hasAdminSecrets`, `needsKey`, key names). Nothing is
  cached in localStorage or any other browser storage. Only fields declared `secret: true` in the
  provider type's `configSchema` are accepted.
- **Stable storage key**: secrets are keyed by `metadata.managedKey` (falling back to the
  instance id), because managed instance ids are regenerated on every boot — a persistent store
  keyed by instance id would orphan every key on restart.

### Default store & plugging a background service

The default `ChatUserSecretsStore` is **server process memory** (`InMemoryUserSecretsStore`):
keys survive page reloads but are lost on server restart, and anonymous (`sess:`) keys die with
the server session. Deployments that want durable storage install their own store from any
`*.server.ts` (e.g. a `register.server.ts`):

```ts
const ChatServerRegistry = await XOPAT_SERVER.importServerExport(
    ctx, "module:vercel-ai-chat-sdk/server/chatRegistry.server.ts", "ChatServerRegistry");
ChatServerRegistry.instance().setUserSecretsStore({
    async get(scope, providerKey) { /* fetch from your service */ },
    async set(scope, providerKey, secrets) { /* persist */ },
    async delete(scope, providerKey) { /* remove */ },
});
```

Treat the backing service as a secret store (encrypt at rest, scope-check access); use
`XOPAT_SERVER.safeRequest`/`safeFetch` for any HTTP backend.
