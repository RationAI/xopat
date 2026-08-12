# vercel-ai-chat-sdk

Chat + LLM broker for xOpat, built on the Vercel AI SDK. It owns the **chat panel**, the
**provider registry** (types + instances + adapters), stateless **model invocation**, and the
per-session scripting bridge. Providers are contributed by plugins (e.g. `chat-anthropic`,
`chat-openai-compatible`); the module ships no built-in adapters.

This README covers the **server-side APIs other plugins/modules reuse** — not the chat UI
internals.

## Headless API

External integrations can run chat sessions without user interaction, and observe turns as
they happen. Both surfaces live on the module singleton:

```js
const chat = singletonModule('vercel-ai-chat-sdk');

chat.addHandler('turn-complete', (e) => console.log(e.outcome, e.messages));

const session = await chat.createSession({ metadata: { source: 'my-integration' } });
const outcome = await chat.appendUserUtterance('Describe the tissue in view.');
const transcript = await chat.getTranscript(session.id);
await chat.destroySession(session.id);
```

Sessions: `createSession` · `openSession` · `listSessions` · `getTranscript` ·
`destroySession` · `getActiveSessionId`.
Turns: `appendUserUtterance(text, {sessionId?, signal?})` · `stopTurn()` · `isTurnRunning()`.
Transcript-only: `appendTranscriptUtterance(text, {sessionId?, source?})` appends a user message to
the transcript (visible + persisted, raises `utterance-appended`) **without** running an assistant
turn; `setTranscriptOnlyMode(on)` routes hands-free voice submits the same way — for dictation and
reporting flows that own their LLM work and use the chat purely as the record of what was said.
While transcript-only is on, hands-free voice submits **per transcribed segment** — each segment
becomes its own transcript utterance the moment it drains, with no end-of-turn-silence wait — and
segments are capped shorter (deployment knob `voice.transcriptMaxSegmentMs`, default 7000 vs the
conversational 10000), so a non-stop monologue yields utterances — and downstream extraction
progress — live rather than only after the speaker pauses.
`upsertAssistantNote(text, {sessionId?, noteId?})` shows (or updates in place, keyed by `noteId`) a
UI-only assistant bubble — a host-authored "response" without a model turn, e.g. live extraction
feedback. Not persisted, never enters turn context; tagged `metadata.internalSource:"assistant-note"`
so transcript consumers can filter it out.
Voice: `isVoiceAvailable()` · `startVoiceCapture()` · `stopVoiceCapture()` · `finishVoiceCapture()` · `dictateOnce()`.
`stopVoiceCapture()` discards a mid-turn utterance; `finishVoiceCapture()` flushes and submits it first ("finish and submit").

Calls route **through the chat panel**, so they reuse the one tested turn loop and an open chat
tab renders external activity live — bubbles, progress, streaming preview, session picker.

- Events and payloads: [`EVENTS.md`](EVENTS.md)
- Design rationale and the pending upstream refactor: [`UPSTREAM_CHANGE_REQUEST.md`](UPSTREAM_CHANGE_REQUEST.md)

## Busy state — one registry, derived indicators

Every phase that makes the user wait registers with `ChatBusy` (`ui/ChatBusy.ts`), held on the
panel as `this._busy`. The indicators are **derived** from it, never set by hand:

- the indeterminate progress bar under the panel header (always on screen),
- the status line text (the highest-priority running phase),
- disabled input/send/model/provider controls, the session picker's loading + per-row spinner,
- the attachment button's spinner, and the message pane's hydration skeletons.

Rules when you add anything that awaits:

- Wrap it: `await this._withBusy("session-load", 'chat.loadingSession', () => …)`, or
  `begin`/`end` with the `end` in a `finally`. Entries nest and `end` is idempotent, so an error
  path cannot strand the panel in a busy state. **A bare `_setStatus` is not a busy phase** — the
  next state recompute erases it, which is exactly how the silent phases happened before.
- From outside the panel, use `panel.setExternalBusy(key, statusKey | null)`.
- Fine-grained in-turn wording (`chat.executingScript`, …) still goes through `_setStatus`; the
  registry deliberately does not talk over it (see `_renderBusy`).
- Consumers outside the module follow the `busy-changed` event ([`EVENTS.md`](EVENTS.md)).

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
  adapter: {                  // ChatProviderAdapter — resolveModel (+ optional listModels,
    id: "openai-compatible",  //   + optional resolveTranscriptionModel, see below)
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

## Referencing a provider from static config

A provider **instance id** cannot be written into deployment config. Managed instances are minted
with `uid('prov')` into a registry that lives only in `globalThis`, so the id is re-generated on
every server start — `"prov_m9x…"` is stale as soon as the process restarts.

Config therefore names a provider by a **reference**, resolved at use time
(`shared/providerRef.ts`, `ChatServerRegistry.resolveProviderRef`). Precedence is
**short-circuit** — the first tier with any candidate ends the search, which is what makes the
managed key a usable disambiguator:

| # | Tier | Example |
|---|------|---------|
| 1 | instance id | `prov_m9x…` |
| 2 | `metadata.managedKey` | `chat-openai-compatible:openai-compatible:default` |
| 3 | `metadata.managedByPlugin` (plugin id) | `chat-openai-compatible` |
| 4 | `typeId` | `openai-compatible` |

**A reference resolves only to an operator-registered provider** (tiers 2-4). `createProviderInstance`
spreads caller-supplied metadata and stamps only the owner server-side, so a *user-created* instance
can carry a forged `managedKey`/`managedByPlugin`/`role`. Were those searchable, any authenticated
user could mint an instance claiming `managedByPlugin: "chat-openai-compatible"` and capture the
deployment-wide reference — the operator's configured extraction and vision traffic would then run
against an endpoint of that user's choosing. Operator-only also makes the candidate set
caller-independent, and therefore the tie-break deterministic. Tier 1 has no such filter on purpose:
an id that belongs to someone else must come back unchanged so the ownership gate can refuse it,
rather than silently degrading into an alias search that returns a *different* provider.

**Hidden providers are referenceable** — that is the point. `listProviders` strips them for the
picker, but resolution reads the registry's unfiltered instance list, so
`"pathology-medgemma"` reaches a hidden provider from config while it stays invisible in the UI.

When a tier matches several providers the winner is: tagged `role: "default-provider"` → not
hidden → lowest `managedKey` → lowest `id`, and the server logs one warning naming the losers.
Ambiguity warns rather than throws, so an upgrade cannot turn a working deployment into a boot
failure; reference the full managed key to disambiguate.

Resolution itself is **ungated** — learning that an id exists grants nothing. Credentials still
flow only through `getProviderRuntime`, which stays exact-id and keeps the ownership and
auth-context gates. `resolveProviderRuntime` resolves first and then makes exactly one gated call.

Config keys that accept a reference:

| Key | Where |
|-----|-------|
| `defaultProviderId` | `modules/vercel-ai-chat-sdk/include.json` (must be picker-visible) |
| `extractionProviderId` | `plugins/mixture-report-assist/include.json` |
| `drivers.<name>.providerId` | `modules/pathology-foundation/include.json` |
| `vercel.providerId` | `modules/speech-to-text` static meta |

An unresolvable reference fails with `code: "CHAT_PROVIDER_UNKNOWN"` — distinct from
`CHAT_PROVIDER_ACCESS_DENIED`, because a refusal clears when the user logs in while a bad
reference is permanent until the config changes. The client resolves references too
(`ChatModule.resolveProviderRef` / `resolveProviderRefAsync`, backed by the `resolveProviderRef`
RPC for providers it cannot list), so a mistake surfaces as readiness before work starts rather
than as a failed inference minutes later.

## Contextual availability — restrict a provider to named contexts

Beyond the binary `hidden`, a provider can be scoped to an **allow-list of auth/deployment
contexts** with **`metadata.contexts: string[]`** on the provider **type** and **instance**. Absent
or empty ⇒ unrestricted (legacy behavior — nothing changes for existing deployments).

- **Source of truth is SECURE config only.** Host plugins resolve it from `providerDefaults.contexts`
  (`server.json` author tier / `core.server.secure.plugins.<id>` deployer tier) and **never** from
  RPC `input` — a session/URL-derived value must not be able to open or move an availability gate
  (§7).
- **Runtime gate (the teeth).** `getProviderRuntime` calls `requireProviderContext`, which asks core
  to verify the context **the provider record declares** —
  `XOPAT_SERVER.requireRpcAuthContext(ctx, contextId)`. This is the single credential-dispensing
  chokepoint, so every path (chat turn, `listModels`, the draft `previewListModels` probe,
  `runVisionInference`, transcription) is covered.
  **`ctx.contextId` is never consulted.** The context in the RPC body is a client claim; a caller
  could forge it, or simply omit it and land on `rpcVerifiers.default` (usually
  `{enabled:false}`). Taking the requirement from the resource is what closes that.
  Candidates are `metadata.contexts` if present, else the provider's bound `contextId`, else the
  viewer's **main** context (`core`, which resolves against `rpcVerifiers.core` *or*
  `rpcVerifiers.default` — they are aliases); the first that verifies wins. A provider that requires
  login but names no context therefore gates on the main viewer login and logs a one-shot notice;
  name `providerDefaults.contexts`/`contextId` to gate it more narrowly. The host plugins default the
  routing `contextId` to `contexts[0]`; if you set `providerDefaults.contextId` explicitly alongside
  `contexts`, keep it inside the list.
- **You MUST pair every context you list here with a real verifier entry** under
  `server.secure.rpcVerifiers.<ctx>`. A missing, empty or `{ "enabled": false }` entry makes the
  provider refuse to resolve — including for the operator's own key. See `server/node/README.md`.
- **No login, no gate.** A provider with `requiresLogin: false` and no `contexts` verifies nothing
  and works on a deployment with no `rpcVerifiers` at all. Auth is an opt-in addon.
- **Picker filter (UX).** `listProviders` / `listProviderTypes` narrow a restricted provider out of
  the picker only when the list RPC carries a *mismatching* context (a context-aware client scoping
  its own list). Listing is not a security boundary, so it degrades **open**: the default chat client
  lists without a context, so a restricted provider still appears and simply refuses to resolve
  outside its context (same shape as a `requiresLogin` provider). The runtime gate is what enforces
  access.

```jsonc
// server.json for a chat host plugin (e.g. chat-openai-compatible)
{
  "providerDefaults": {
    "baseUrl": "https://clinical-llm.internal/v1",
    "contexts": ["clinical"]   // resolvable/visible only in the "clinical" context
  }
}
// …and server.secure.rpcVerifiers.clinical must exist, or the provider refuses to resolve.
```

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

## Transcription (server) — optional adapter capability

Speech-to-text runs through the same provider registry. An adapter opts in by implementing the
**optional** `resolveTranscriptionModel` hook (`ChatProviderAdapter`, `server/chatRegistry.server.ts`),
returning an AI SDK transcription model (provider-spec `TranscriptionModelV3`; v4 models from
newer `@ai-sdk/*` majors are accepted at runtime — the specs are structurally identical):

```ts
adapter: {
  id: "openai",
  resolveModel: ...,
  // Native SDK package (see plugins/chat-openai): one line.
  async resolveTranscriptionModel({ modelId, config, secrets }) {
    return { model: openai.transcription(modelId), providerOptionsName: "openai" };
  },
}
```

`providerOptionsName` names the providerOptions namespace the model reads whisper-style hints
(`{ language, prompt }`) from; it defaults to `model.provider`. For endpoints without an SDK
transcription model, the module ships a reusable shim implementing the spec over an
OpenAI-compatible `/audio/transcriptions` route (egress via the core SSRF guard) — import it
server-side and wire it in the adapter, as `plugins/chat-openai-compatible` does:

```ts
const createOpenAICompatibleTranscriptionModel = await XS.importServerExport(
  ctx, "module:vercel-ai-chat-sdk/server/openaiCompatibleTranscription.server.ts",
  "createOpenAICompatibleTranscriptionModel");
```

Client-facing RPCs (`server/inference.server.ts`):

- `runTranscription(ctx, { providerId, model?, audioBase64, mediaType?, language?, prompt? })`
  → `{ text, language?, durationInSeconds? }`. `providerId` is a **reference** (see "Referencing a
  provider from static config"); it resolves to one instance and then goes through the
  `getProviderRuntime` chokepoint (ownership + context gates), requires the adapter to support
  transcription, and calls the model's `doGenerate` directly with the exact captured `mediaType`.
  A provider whose adapter lacks the hook fails with an explicit error — **there is no fallback
  transport in core** (pre-2026-07 builds blind-POSTed any provider's `baseUrl`; a non-capable
  binding now errors instead).
- `listTranscriptionProviders(ctx)` → `{ providers: [{ id, typeId, label, description?,
  defaultModelId, hidden? }] }` — instances whose adapter supports transcription. Unlike the chat
  `listProviders`, `metadata.hidden` instances are **included** (dedicated transcription providers
  are typically hidden from the chat picker); context restrictions narrow degrade-open, the real
  gate stays `getProviderRuntime`.

The `speech-to-text` module's `vercel` driver is the primary consumer (see its README).

## No key, no discovery

Model discovery **does not call the upstream when a required credential is configured nowhere**.
A provider type declares the requirement in its `configSchema`
(`{ key: "apiKey", secret: true, required: true }`); `ChatServerRegistry.listModels` /
`previewListModels` check the *resolved* secrets — operator `fixedSecrets` ← instance overrides ←
the caller's BYOK key — and, when a required one is missing, return
`{ models: [], needsKey: true, missingSecretKeys }` without a request, a cache write, or a warning.
The RPC carries `needsKey` to the client, which renders the "add your key" action instead of a
failure band. (Before this gate, an unconfigured deployment sent a keyless `/models` request on
every boot, provider switch and login, and turned the resulting 401 into a console error + retry
band that buried real discovery failures.)

**Declaring a keyless endpoint.** Self-hosted inference (ollama, vLLM, anything that authenticates
by network position) opts back in through the *existing* `providerDefaults.apiKey`, which has three
states:

| `providerDefaults.apiKey` | meaning |
| --- | --- |
| `"sk-…"` (string) | the operator key |
| absent / `""` | a key is required; discovery stays off until someone (deployer or BYOK user) supplies one |
| `false` | the operator declares the endpoint keyless ⇒ `apiKey` is registered `required: false` and discovery runs with no credential |

Secure config only, like `contexts`/`hidden` — never RPC `input` (§7). Provider types that declare
no required secret (medgemma, mixture, adapters with a static catalogue) are unaffected.

## BYOK — per-user API keys

Provider plugins register their type + managed instance **even when the deployment configures no
API key** (`server.json` `providerDefaults.apiKey` empty/absent). Users then supply their own key
from the chat settings dialog ("Providers & API keys"); the key gates model discovery and turns
for *that user only*.

### Semantics

- **Storage scope** (`resolveUserScope` in `server/chatRegistry.server.ts`) is the caller's
  **principal**, resolved by core (`XOPAT_SERVER.resolvePrincipal`): authenticated callers →
  `user:<sub>`; anonymous callers → `sess:<server session id>` (the HttpOnly `xopat_session`
  cookie), so two anonymous browsers can never see each other's keys. The BYOK RPCs travel the same
  per-provider auth path as `listModels`/`sendTurn` (`ChatService._authCallOptions`), so the scope
  used at write time always matches the one used at inference time.
- **A login-gated provider accepts `user:` scopes only.** A `sess:` scope names a cookie, and a
  cookie outlives a login — so an anonymous BYOK overlay is refused for any provider that verified
  an auth context. Anonymous BYOK remains available for unrestricted providers, where the key is
  per-browser by construction.
- **A browser session that changes hands is wiped.** When the principal behind a session id changes
  (someone signs in, or out, on a shared workstation), everything under that session's `sess:` scope
  is purged along with the caches derived from it. Same on session eviction, via core's
  `onSessionEvicted` hook. **A persistent store must implement `deleteScope(scope)`** or this
  cannot happen — the module logs a warning if it doesn't.
- **The operator key stays shared.** `type.fixedSecrets` is deployment config, not per-principal:
  the service-provided key keeps working for every user, and a user's own key still wins over it.
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

The default `ChatUserSecretsStore` (`StorageUserSecretsStore`) is a core storage namespace
declared `sensitivity: "secret"` and bound to `memory`: keys survive page reloads but are lost on
server restart, and anonymous (`sess:`) keys die with the server session.

The sensitivity declaration is load-bearing — the storage broker **refuses** to bind this
namespace to a persistent driver unless the operator sets
`core.server.secure.storage.allowPersistentSecrets`, so a deployment-wide "put chat state on disk"
change cannot quietly start writing plaintext API keys under the cache directory. See
[`server/STORAGE.md`](../../server/STORAGE.md).

Deployments that want durable storage install their own store from any
`*.server.ts` (e.g. a `register.server.ts`) — which bypasses this namespace entirely:

```ts
const ChatServerRegistry = await XOPAT_SERVER.importServerExport(
    ctx, "module:vercel-ai-chat-sdk/server/chatRegistry.server.ts", "ChatServerRegistry");
ChatServerRegistry.instance().setUserSecretsStore({
    async get(scope, providerKey) { /* fetch from your service */ },
    async set(scope, providerKey, secrets) { /* persist */ },
    async delete(scope, providerKey) { /* remove */ },
    // REQUIRED for a persistent store: drop everything under one scope. This is
    // how an anonymous `sess:` key dies when the browser session changes hands.
    async deleteScope(scope) { /* remove all entries of this scope */ },
});
```

Treat the backing service as a secret store (encrypt at rest, scope-check access); use
`XOPAT_SERVER.safeRequest`/`safeFetch` for any HTTP backend.

## Session storage & retention

Chat state goes through the core storage broker ([`server/STORAGE.md`](../../server/STORAGE.md))
rather than process maps, in three namespaces — because the three kinds of data grow differently:

| Namespace | Shape | Holds |
| --- | --- | --- |
| `kv:sessions` | record per session | session metadata; TTL + LRU cap apply here, and evicting one cascades to the rest |
| `log:messages` | append-only | the transcript; tail-read and FIFO-trimmed at a message cap |
| `blob:attachments` | bytes, scoped per session | attachment payloads — **never** held in memory |
| `log:attachment-index` | append-only | attachment records (metadata only) |
| `kv:secrets` | record per (scope, provider) | BYOK keys; `sensitivity: "secret"` |

All default to the `memory` driver, so **chat history does not survive a server restart** unless
you bind it otherwise. Binding to `tiered`/`file` also makes chat state shared across
`XOPAT_WORKERS` cluster workers — which by default it is **not**, so a multi-worker deployment
loses sessions depending on which worker answers.

### Making chat survive a restart

```jsonc
"secure": { "storage": { "bindings": {
  // REQUIRED — not just the chat namespaces. See below.
  "core": { "kv:sessions": ["tiered"] },

  "vercel-ai-chat-sdk": {
    "kv:sessions": ["tiered"], "log:messages": ["tiered"],
    "log:attachment-index": ["tiered"], "blob:attachments": ["file"]
  }
} } }
```

**Binding only the `vercel-ai-chat-sdk` namespaces is the single most common mistake, and it
fails silently.** A chat session is reachable only by its `metadata.ownerPrincipal`, which for a
user who has not logged in is `sess:<browser-session-id>` — derived from the browser-session
record in `core / kv:sessions`. Leave that in memory and, after the restart, the browser's cookie
names a session the server no longer has: it mints a new one, the principal changes, and
`listSessions` matches nothing. The transcripts are on disk and permanently invisible.

Only the session *identity* half is involved (`kv:sessions`, `sensitivity: "normal"`); OIDC/SAML
credentials live in `kv:sessions-secure` and stay in memory, so users still re-authenticate.
BYOK keys (`kv:secrets`) likewise stay in memory — persisting them requires
`allowPersistentSecrets`, i.e. plaintext API keys on disk.

A logged-in `user:<id>` principal does not depend on the browser session at all and is the robust
answer where long-lived history matters.

Runnable example: [`env/env.storage-persistent.json`](../../env/env.storage-persistent.json).
Full reference and a verification recipe:
[`server/STORAGE.md` → *Making state survive a restart*](../../server/STORAGE.md).
Regression suite: `npm run test:storage-persistence`.

### Attachment payloads are no longer retained inline

A stored `ChatAttachmentRecord` **does not carry `dataUrl`**. The bytes live in
`blob:attachments` and are pulled back only for the turn that references them. Two consequences:

- The `uploadAttachment` RPC **response** still includes `dataUrl` (the client consumes it
  immediately) — only the retained record shrinks.
- `normalizeIncomingMessage` strips `part.dataUrl` when the part carries an `attachmentId`. The
  client re-sends the full base64 inside message parts as well as uploading it, so each upload used
  to sit in RAM twice; the strip applies at the normalization boundary and therefore protects
  every store, including one installed via `setSessionStore`.

A payload that has been evicted resolves to `null` and renders as `[Image unavailable]`, which is
the pre-existing degradation path.

### Optional `ChatSessionStore` methods

`listRecentMessages`, `getAttachmentPayload` and `dispose` are all **optional and
feature-detected**. A store installed through `setSessionStore` that implements only the original
nine methods keeps working unchanged — it simply takes the older path (full history load, no
on-demand payloads). Retention needs no store method: it is resolved by the storage broker from
config.

`sendTurn` passes its window size down to `hydrateSession`, so a store that implements
`listRecentMessages` never materializes an entire transcript just to slice its tail.

## Server-side state and hot reloads

`ChatServerRegistry` keeps its providers, sessions, caches and BYOK store in a plain
**state bag** on `globalThis.__XOPAT_CHAT_SERVER_STATE__`, and rebuilds the class instance around it
on every `instance()` call.

Do not "simplify" this by parking the instance itself on `globalThis`. Module `*.server.ts` files are
re-imported whenever their mtime changes while the Node process keeps running, so every hot reload
mints a new class — an instance stored globally keeps the *old* prototype forever, and the next
reload's code calling a newly-added method on it dies with `… is not a function`. Because
`getRegistry()` opens nearly every chat RPC, that takes down chat, model listing, transcription and
vision at once, and survives until the core server is restarted. Persisting state instead of
behaviour removes the failure mode entirely.

For the same reason, recognise a provider refusal by `error.code` via the exported
`isProviderAccessError` — **never `instanceof`**. Each server entry is bundled independently, so the
class object differs per bundle.

## Provider records are server-defined (breaking change)

Provider **types** and **instances** are registered server-side only. The
`registerProviderType` / `createProvider` / `updateProvider` / `deleteProvider`
RPCs are commented out of `chat.server.ts`'s `policy` block (which is what exposes
an export as an endpoint), and `ensureChatProviderRegistered` ignores its RPC input
entirely — it builds the record from secure config plus the plugin's own
deployment metadata.

Why: as written, any session holder could obtain the operator's API key.
`registerProviderType` never even read `ctx`; `createProvider` took arbitrary
`config` and `requiresLogin:false` while the type's `fixedSecrets` flowed to *any*
instance of that type; `updateProvider` gated on a check that returned early for
unowned records — and operator instances are unowned by design so everyone can
*read* them, which meant everyone could also write them.

Two structural guards back this up, so re-enabling the RPCs later is safe:

- **`origin`** (`"operator"` | `"user"`), server-assigned and never settable from
  input. `assertProviderRead` allows operator records to everyone;
  `assertProviderWrite` refuses them outright. Neither has a permissive
  fall-through — the predecessor's `if (!owner) return;` was a default-allow inside
  a function whose name promised denial.
- **`type.fixedSecrets` reaches only `origin:"operator"` instances.** The operator's
  key and the constraints that make it safe to spend — fixed endpoint, fixed gate,
  fixed model set — are one package. A user instance of a keyed type is therefore
  unusable until BYOK, and reports `hasSecretDefaults:false` so the keys panel says
  `needsKey` rather than implying an admin key is available.

The draft-probe path (`previewListModels`) intersects `draftConfig` with the type's
`configSchema` and withholds operator secrets whenever the draft can steer the
request — any `input:"url"` field, any value that is an absolute URL, or any
header field. The previous rule matched only `baseUrl`, so `modelsPath`
(declared `input:"text"`, and returned verbatim when absolute) redirected a
credential-bearing request while the rule reported no redirect.

## Ownership & identity (breaking change)

Chat sessions and user-created providers are owned by a **principal**
(`user:<id>` / `sess:<id>`), not by `ctx.user?.id ?? null`.

Why it had to change: nothing populated `ctx.user.id` — every verifier handed the
server a raw JWT payload carrying `sub`, not `id` — so ownership compared
`null === null` on both sides and **every chat session was readable, renameable
and deletable by any caller**, with `listSessions` filtering on exactly that set.
BYOK was affected the same way: keys landed under `sess:` for everybody, i.e. tied
to a browser cookie rather than a person.

What changed:

| | before | after |
|---|---|---|
| session owner | `metadata.userId` (`null`) | `metadata.ownerPrincipal` (never null) |
| provider owner | `metadata.ownerUserId` | `metadata.ownerPrincipal` |
| `listSessions` | `{userId}` | `{ownerPrincipal}` — caller's own, never from input |
| `listProviderInstances` | `{userId}` | `{ownerPrincipal}` — caller's own **plus unowned** |
| unowned session | readable by everyone | readable by nobody |
| unowned provider | shared | **still shared** — that is the operator's service instance |

**Migration.** Pre-existing sessions have no `ownerPrincipal` and are therefore
unreachable. On the first `setSessionStore` the module purges them and logs
`[chat-migration] purged N chat session(s) with no ownerPrincipal`. In a clinical
deployment these may hold patient data, and an orphan nobody can delete through
the UI is worse than one that is removed. Set `tuning.keepLegacySessions: true`
(see [Server tuning](#server-tuning)) to keep (and export) them instead — they stay unreachable either way. The default
in-memory store starts empty each boot, so this only affects durable stores.

## Server tuning

Everything tunable about the chat server lives in **one config block**, not in
environment variables. Defaults live in `server/tuning.ts`; a deployment
overrides any subset (`modules/vercel-ai-chat-sdk/server.json` carries the same
`tuning` block for author-level overrides and ships empty):

```jsonc
"server": { "secure": { "modules": { "vercel-ai-chat-sdk": {
  "tuning": {
    "turnBudgetMs": 540000,          // whole-turn deadline (inside the 600s RPC ceiling)
    "attemptTimeoutMs": 300000,      // per-attempt ceiling for one upstream call
    "maxRetries": 1,                 // transport-stall retries only
    "probeBudgetMs": 25000,          // shared ceiling for the capability probes
    "maxInlineAttachmentBytes": 524288,
    "maxOutputTokens": 16384,        // shared with reasoning tokens on reasoning models
    "decodedMediaCacheBytes": 67108864,
    "streaming": true,               // false -> sendTurnStream runs buffered
    "sessionTtlMs": 259200000,       // 72 h
    "maxSessions": 2000,
    "maxMessagesPerSession": 500,
    "maxAttachmentsPerSession": 200,
    "keepLegacySessions": false
  }
} } } }
```

Resolution lives in `server/tuning.ts` (`getChatTuning(ctx?)`). Precedence is
**defaults < deprecated env var < config**, which keeps the migration
non-breaking: a deployment still exporting `XOPAT_CHAT_MAX_RETRIES` keeps its
value until someone writes an explicit config entry. Values are floored so a
typo cannot produce a 0 ms budget, and resolution works without a request ctx —
the retention caps are read while the stores are built lazily.

> **Deprecated `XOPAT_CHAT_*` variables.** `XOPAT_CHAT_TURN_TIMEOUT_MS`,
> `_SENDTURN_TIMEOUT_MS`, `_ATTEMPT_TIMEOUT_MS`, `_MAX_RETRIES`,
> `_PROBE_TIMEOUT_MS`, `_MAX_INLINE_ATTACHMENT_BYTES`, `_MAX_OUTPUT_TOKENS`,
> `_DECODED_MEDIA_CACHE_BYTES`, `_STREAMING`, `_SESSION_TTL_MS`, `_MAX_SESSIONS`,
> `_MAX_MESSAGES_PER_SESSION`, `_MAX_ATTACHMENTS_PER_SESSION` and
> `_KEEP_LEGACY_SESSIONS` still apply and warn once per process. They will be
> removed — move them into the block above.

`core.server.secure.storage.retention["vercel-ai-chat-sdk"]` still takes
precedence over the retention values for the storage namespaces themselves — see
[`server/STORAGE.md`](../../server/STORAGE.md).

Still an environment variable (a different module owns it):

| Variable | Purpose | Default | Source |
| --- | --- | --- | --- |
| `XOPAT_PATHOLOGY_VISION_TIMEOUT_MS` | `runVisionInference` policy timeout in ms (floored at `30000`). Consumed by the pathology `analyze` path; requires a server restart to apply | `300000` (5 min) | `server/inference.server.ts:49` |

## Server logging

There is **no `XOPAT_CHAT_DEBUG`**. LLM diagnostics ride the core logging broker
on channel `module.vercel-ai-chat-sdk` (payload records on
`module.vercel-ai-chat-sdk:llm`):

```jsonc
"server": { "logging": {
  "channels": { "module.vercel-ai-chat-sdk:llm": "trace" },
  "allowSensitive": true          // required for prompt/response payload records
} }
```

Payload records (prompts, tool arguments, model output) are emitted through
`log.sensitive(...)` and require **both** `trace` on the channel and an explicit
`allowSensitive` — in a clinical deployment those payloads are patient data.
Read them with `window.xserver.server.core.getLogs({channel:"module.vercel-ai-chat-sdk"})`.

At plain `debug` (no `allowSensitive`) the channel gives PHI-free operational
records instead: `appendMessages` counts, `turn started`
(provider/adapter/model/history+attachment counts/streaming/executionMode),
`model call succeeded` (conversation size, tools active, text chars, token
usage), `chat turn` (`durationMs`, tokens) and `model call failed`.

**The old `XOPAT_CHAT_DEBUG` dump** — the whole conversation as sent to the model
— is the `trace` + `allowSensitive` combination above, printed as indented JSON.
The records are `APPEND_MESSAGES_INPUT/OUTPUT`, `SEND_TURN_DELTA`,
`SEND_TURN_CONTEXT`, `MODEL_INPUT` (full prompt + history), `MODEL_OUTPUT`,
`TURN_CLIENT_CUTOFF` and `TURN_RESULT`. Long messages truncate at
`logging.redact.maxStringLength` (8000 by default) and lists at
`redact.maxItems` (50) — raise both for an untruncated dump, and add
`sinks.store: {"minLevel": "trace"}` to get it as an NDJSON file. See the
"full conversation dump" recipe in [`server/LOGGING.md`](../../server/LOGGING.md).

`XOPAT_PATHOLOGY_VISION_TIMEOUT_MS` is also described consumer-side in
[`plugins/pathology-medgemma/README.md`](../../plugins/pathology-medgemma/README.md).
