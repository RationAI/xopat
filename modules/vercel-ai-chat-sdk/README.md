# vercel-ai-chat-sdk

Chat + LLM broker for xOpat, built on the Vercel AI SDK. It owns the **chat panel**, the
**provider registry** (types + instances + adapters), stateless **model invocation**, and the
per-session scripting bridge. Providers are contributed by plugins (e.g. `chat-anthropic`,
`chat-openai-compatible`); the module ships no built-in adapters.

This README covers the **server-side APIs other plugins/modules reuse** — not the chat UI
internals.

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
