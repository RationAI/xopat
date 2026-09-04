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
Voice: `isVoiceAvailable()` · `startVoiceCapture()` · `stopVoiceCapture()` · `finishVoiceCapture()` · `dictateOnce()`
· `hasHeldVoiceText()` · `submitHeldVoiceText()` · `discardHeldVoiceText()`.
`stopVoiceCapture()` discards a mid-turn utterance; `finishVoiceCapture()` flushes and submits it first ("finish and submit").
Speech captured after the assistant has been computing for more than `voice.busyHoldMs` (default 4 s) is **held** as an
editable composer draft rather than auto-submitted — a long reply must not turn thinking out loud into the next question.
The user releases it with Send (Ctrl/Cmd+Enter) or a spoken confirm phrase; see [`EVENTS.md`](EVENTS.md) → `voice-hold`.
Editing the composer while hands-free is armed **pauses** capture (the microphone is released, the toggle stays armed);
clicking the recording overlay does the same, since it is what covers the input while capture runs:
dictation appended to the box drags the caret away mid-correction. Send — or emptying the box — resumes it, and speech
captured during the pause is queued with the resume rather than lost; see [`EVENTS.md`](EVENTS.md) → `voice-state`.

The composer's status row (under the input) reports all of this: a state dot (idle / ready / listening / transcribing /
thinking / waiting-for-you / paused / error), the status sentence, a "Hands-free on|paused" badge, and — only while a
captured draft is waiting — the discard action.

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
`bounds`, and `viewer.frameImageRegion`).

**The mechanism is not chat's** — it belongs to the [`markdown`](../markdown/README.md) module,
which parses the links out of rendered markdown and dispatches clicks through its link registry;
the built-in `region` kind frames the viewer (crop-aware for virtual-region splits; `w=0&h=0` pans
to a point without zooming; an optional `z` pins a 0-based focal plane on z-stack slides, applied
via the viewer's depth controller before framing and ignored on single-plane slides). That is what
makes the *same* link work when the model writes it into a questionnaire description or a recorder
overlay instead of a chat reply.

Chat contributes exactly two things:
- `ChatModule._registerRegionLinkResolver()` teaches the shared handler this session's
  anonymization handles (`viewer-1` → real `uniqueId`).
- `presentText` (the handle → friendly-name restoration) is passed to the renderer as a **text**
  transform, so it cannot rewrite a handle inside a link target. The old code had to extract links
  from the raw source first to avoid exactly that.

`ChatModule.navigateToRegionFromChat(link)` remains as public API, delegating to
`markdown.openLink({kind: "region", payload: link})`.

## TODO: a generic code fence is executable, and an illustration is not distinguishable from a script

`shared/script-text.ts` accepts `javascript` / `js` / `typescript` / `ts` as fallback script fence
tags, after `xopat-script` / `xopat-host-script`. That fallback exists because a model sometimes
mislabels a real script, and dropping it would strand those turns.

The cost is that a model writing code *for the user to read* has its illustration executed. Seen in
the wild: an assistant ended a reply with "You can focus on the same region at 20× with:" and a
` ```javascript ` block calling `viewer.focusOnImage(...)`; the runtime ran it, moved the user's
viewport, and reported back `Script completed successfully… contained no return`.

The current mitigation is a prompt rule — **never put code in a reply to the user** — which is the
right rule regardless, because the audience is a pathologist rather than an operator of this API.
It is not a fix: nothing structurally separates "code I am running" from "code I am showing".

Properly resolving it needs the advanced/technical mode to exist first, since that is the only
context where showing code is legitimate. Likely shape: executable fences are the `xopat-*` tags
only, the generic fallback is kept but reported back to the model as a mislabel it must correct,
and the technical mode renders `js` fences as prose. Do not simply delete the fallback — measure
how often it is load-bearing first.

## AI SDK version line — every `@ai-sdk/*` package must match core `ai`

This module depends on core `ai`; every provider plugin depends on its own
`@ai-sdk/<vendor>` package. Vercel bumps the **provider specification** with each core
major, and each provider package targets exactly one line. Mixing lines breaks at turn
time, not at install time — npm sees no conflict because there is no peer dependency:

```
Unsupported model version v4 for provider "anthropic.messages" and model "claude-opus-5".
AI SDK 5 only supports models that implement specification version "v2".
```

(The "AI SDK 5" wording is stale text inside the SDK's own error class — it says that
whatever core major is installed. What it means: *the provider package is from another
line than core `ai`*.)

Current line — **`ai@7`, provider spec `v4`**:

| package | version | where |
|---|---|---|
| `ai` | `^7` | `modules/vercel-ai-chat-sdk` |
| `@ai-sdk/provider` | `^4` | `modules/vercel-ai-chat-sdk` |
| `@ai-sdk/anthropic` | `^4` | `plugins/chat-anthropic` |
| `@ai-sdk/openai` | `^4` | `plugins/chat-openai` |
| `@ai-sdk/openai-compatible` | `^3` | `plugins/chat-openai-compatible`, `plugins/chat-mixture`, `plugins/pathology-medgemma` |

To find the right major for a core version, read npm's dist-tags rather than guessing —
Vercel publishes one per line:

```bash
npm view @ai-sdk/anthropic dist-tags   # → ai-v6: 3.x, latest (ai 7): 4.x
```

Compatibility is one-directional: core `ai@7` still accepts models built to spec `v2`
and `v3` (it wraps them), so a provider package one major behind keeps working. The
failing direction is a provider package **ahead** of core. That is exactly what a lone
`npm i @ai-sdk/<x>@latest` inside one plugin produces — the plugins are npm workspaces
with independent `package.json`s, so one of them can drift alone.

`assertLanguageModelCompatible()` (`server/chatRegistry.server.ts`) runs on every
resolved model and turns the drift into an error that names the adapter, the provider
instance and the fix, instead of the SDK's opaque one above.

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

- `runTranscription(ctx, { providerId?, model?, audioBase64, mediaType?, language?, prompt? })`
  → `{ text, language?, durationInSeconds? }`. `providerId` is a **reference** (see "Referencing a
  provider from static config"); it resolves to one instance and then goes through the
  `getProviderRuntime` chokepoint (ownership + context gates), requires the adapter to support
  transcription, and calls the model's `doGenerate` directly with the exact captured `mediaType`.
  A provider whose adapter lacks the hook fails with an explicit error — **there is no fallback
  transport in core** (pre-2026-07 builds blind-POSTed any provider's `baseUrl`; a non-capable
  binding now errors instead).

  `providerId` is **optional**. Omitted, the server picks one itself among the
  `listTranscriptionProviders` candidates, restricted to **operator-registered** records (a user
  instance must not capture deployment-wide routing) and ranked by the same
  `compareProviderCandidates` order that settles an ambiguous reference —
  `metadata.role: 'transcription-default'` first, then `role: 'default-provider'`, then visible
  over hidden, then lexicographic (the shipped provider plugins expose that role as
  `providerDefaults.transcriptionDefault: true`). Multiple candidates warn once in the log. A registry with **no**
  candidate throws *untagged*, i.e. retryable: provider plugins register during server-module load,
  so "none yet" can be a boot race, whereas a named-but-unresolvable provider stays permanent
  (`[stt-config-error]`, which latches the client driver dead).

  The model id, when not passed, resolves `config.defaultTranscriptionModelId` →
  `metadata.transcriptionModelId` → the instance/type `defaultModelId` → `whisper-1`. The two
  transcription-specific keys exist because a provider shared with the chat agent has a *chat*
  `defaultModelId`, which `/audio/transcriptions` rejects.
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

## What the system prompt costs, and why it is shaped this way

The prefix is re-sent on **every step**, and one user message can drive up to 21 of them — so
on a provider without prompt caching (anything but Anthropic, see below) a token here is paid
~21 times per message. Two rules keep it down; both are easy to undo by accident.

**Only `application` and `viewer` render in full** (`CORE_SCRIPT_NAMESPACES`). `visualization`
is the largest declaration set of the three (~19 KB, more than the other two combined) and is
untouched by most sessions, so it sits in the compact catalogue and expands on demand — its
workflow guidance follows its rendering position automatically. Demoting the other two would
save far less than it looks: sticky expansion re-adds a namespace after its first use, so the
durable saving is only on namespaces never touched, and a failed call on a hot surface costs a
whole extra round trip. Deployments can override the set via the `fullPromptNamespaces` static
meta.

**The API interface is stripped from the type blob** (`shared/api-declarations.ts`). A
namespace declaration carries both the supporting types and the API interface itself, while the
prompt separately renders every method as `signature — <flattened JSDoc>` — so the interface was
restating every method and doc comment a second time. Stripping it saves ~2.1k tokens per step
on `application` + `viewer` alone and loses nothing but line breaks. The supporting types stay:
nothing else carries them.

Together these took a measured 18,956-token first request to roughly 11–12k. If you change
either, re-measure rather than reasoning about it — and note that a *duplicate* is safe to cut
while a *type contract* is not, which is why the stripper returns its input untouched on
anything it cannot brace-match.

## Prompt-cache breakpoints are Anthropic-only, by necessity

The system prompt is ordered stable → sticky → volatile and built by `buildSystemInstructions`
(`shared/system-segments.ts`). Whether it travels as several system messages or one is decided
per provider by `SYSTEM_MERGING_ADAPTERS` (`server/chat.server.ts`), and **only Anthropic gets
the segmented form**.

That is not a gap waiting to be filled. `@ai-sdk/anthropic` folds consecutive system messages
into a single top-level `system` array, one text part each — and that fold is precisely what
lets a part carry `cache_control`. The openai-compatible converter does the opposite, emitting
one `role: "system"` entry per message, where a vLLM chat template accepts exactly one at index
0 and otherwise fails the turn with *"System message must be at the beginning."* So on those
providers segmentation cannot place a breakpoint and can break chat outright: strictly worse,
never better.

Re-enabling it everywhere therefore reintroduces a hard failure for zero gain. The real
improvement is the TODO on `SYSTEM_MERGING_ADAPTERS`: decide this per **model**, learned lazily
from a real failure like `ModelCapabilities.streaming` already is, so a newer model that does
accept several system messages gets the optimal path without an allowlist edit.

## Token usage readout

The fullscreen Plugins menu carries a second chat submenu, **Token usage**, beside
"Providers & API keys" (both registered from `_attachSettingsMenu` — `setMenu` keys by
`(ownerPluginId, toolsMenuId)`, so siblings share one owner row). It reports what the open
conversation has cost: input / output / total tokens, tokens read from cache, the cache hit
rate, and the number of upstream model requests — once for the last user message and once
for the conversation.

What it is **not** is a billing figure. Scope is deliberately small:

- **Per tab, in memory, reset on reload.** `ChatService._sessionUsage` holds a few integers per
  session; nothing is persisted and no RPC is involved. `UsagePanel` reads them when the panel
  becomes visible (an `IntersectionObserver`, because the fullscreen menu mounts tab bodies
  eagerly and only reveals them later), so the chat path does no display work.
- **Summed per user message, not per request.** One user message drives up to 21 upstream calls
  through the assistant loop, and the server has no notion of the group a call belongs to — a
  turn *is* one call. The client marks the boundary via `ChatService.beginUsageGroup(...)`, called
  from the panel once the session is settled.
- **A dash is not a zero.** Providers differ in what they report, and rendering "not measured"
  as `0` states something nobody was told. Two flags carry this: `hasTokenDetail` and
  `hasCacheDetail`, each set only when a real number arrived (a literal `0` counts — "measured
  and it was zero" is a finding). `cacheHitRatio` returns `null` rather than `0%` when nothing
  was measured. Call counts are the exception and always render, because those we observed
  ourselves — they are what makes a fully-unreported panel legible rather than blank.
- **OpenAI-compatible endpoints report nothing unless asked.** `@ai-sdk/openai-compatible` only
  sends `stream_options: {include_usage: true}` when its provider is built with
  `includeUsage: true`; without it the backend streams no usage block and the SDK returns an
  object whose every field is `undefined`. The `includeUsage` provider setting (chat-openai-compatible,
  chat-mixture) turns it on and is **off by default**: the field is standard OpenAI, but a stricter
  backend can reject it, and that would break chat rather than merely the readout. When it is off the
  panel says so and names the switch. `@ai-sdk/openai` and `@ai-sdk/anthropic` always report, so they
  need no opt-in.
- **A user-stopped turn under-counts.** The client aborts the socket, so the server's result —
  which does carry the tokens it billed — has nowhere to land. Server-side cutoffs that still
  return a response are accounted for normally.

The accumulator itself is pure and lives in `shared/usage-stats.ts` (unit-tested in
`test/unit/usage-stats.test.mjs`); the wire shape is `ChatTurnResult.usage`, projected in
`chat.server.ts` by `projectUsage`.

### Measuring cost against an OpenAI-compatible endpoint

The panel answers *what does an xOpat turn cost here* with no instrumentation: the two numbers worth
having are **differences in real `Input` tokens**, and both differences come out of controls the UI
already has. Real tokens from the endpoint's own tokenizer beat any character count the viewer could
compute.

**Probe the endpoint first.** Two `curl`s decide whether the readout can work at all, and they cost
two tokens:

```bash
# 1. does it report cache detail?
curl -s -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"<id>","messages":[{"role":"user","content":"ok"}],"max_tokens":1}' \
  "$BASE/chat/completions" | jq .usage
# look for prompt_tokens_details.cached_tokens

# 2. is stream_options accepted?
curl -s -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"<id>","messages":[{"role":"user","content":"ok"}],"max_tokens":1,
       "stream":true,"stream_options":{"include_usage":true}}' \
  "$BASE/chat/completions" | grep usage
# a terminal chunk must carry `usage`, and the request must not 4xx
```

Probe 2 is what licenses `includeUsage: true` in that deployment's `providerDefaults` — the default
transport is `sendTurnStream`, so without the flag the panel stays blank no matter what the endpoint
supports. Probe 1 decides whether the cache rows mean anything, and **it cannot be skipped**: the SDK
does `cached_tokens ?? 0` (`@ai-sdk/openai-compatible`, `convert-openai-compatible-chat-usage.ts`),
so on this adapter `cacheRead` is *always* a number and `hasCacheDetail` is structurally always true.
The dash rule above — correct for Anthropic — cannot protect you here, and an endpoint that reports
nothing renders as a confident **0%** hit rate.

> **CERIT, verified 2026-09-04** (`llm.ai.e-infra.cz`, `gpt-oss-120b` and `qwen3.8-27b`):
> `stream_options` accepted and the terminal chunk carries `usage`; without it no chunk carries one.
> Hence `includeUsage: true` in `env/parts/chat/openai-compatible-cerit.json`. But **no
> `prompt_tokens_details`** — cache detail is not reported there, so *Read from cache* and *Cache hit
> rate* are the SDK's default rather than a measurement. Both models also return
> `completion_tokens_details.reasoning_tokens`, which `projectUsage` does not carry.

**Fix the variables.** One model, held fixed. A **fresh conversation per measurement** — a growing
conversation raises `Input` for an unrelated reason. A prompt that forces a one-token answer
(`Reply with exactly the word OK and nothing else.`) so `Output` is noise and the assistant loop
makes a single upstream call. **Check *Model requests*: if it is not 1, the model emitted a script
fence and you are reading a sum over several calls, not a measurement.** Read from *Last message*,
which resets per user message.

**System-prompt floor.** Fresh conversation, that prompt, read *Input*. That number is the whole
xOpat system prompt — session preamble, scripting manifest, personality, region-link block, live
viewer context — plus a handful of tokens for the message itself.

**Manifest cost, by difference.** Repeat with scripting consent revoked. With no manifest,
`scriptSystemContent` renders a four-line "scripting disabled" stub rather than nothing, so the
difference is *manifest minus stub*. The manifest is the only contributor the UI can isolate;
personality, region-link and live viewer context are not independently togglable.

**Cache effectiveness**, on an endpoint that passed probe 1: repeat the identical prompt in a **new
conversation** several times and watch *Read from cache* climb while *Input* stays flat. New
conversations rather than repeated turns in one, so the conversation tail is not the thing that
changed. A flat zero is evidence of no hit, not proof — replica routing, TTL expiry, or another
tenant evicting the block all look identical from here.

**What these numbers are not:**

- **A floor, not a turn.** One real user message drives an assistant loop of many upstream calls;
  this procedure pins it to one on purpose.
- **Not attributable past the manifest.** Pricing personality vs region-link vs live viewer context
  separately would need per-block instrumentation that does not exist.
- **Not evidence about xOpat's cache segmentation.** `SYSTEM_MERGING_ADAPTERS` is `{'anthropic'}`, so
  for an OpenAI-compatible provider `buildSystemInstructions` returns one joined system message with
  no `providerOptions` — no explicit breakpoints reach the wire. Any hit is the backend's own
  automatic prefix caching. The stable → sticky → volatile ordering still helps such a cache; the
  breakpoints simply are not there.
- **Reasoning tokens are invisible.** `outputTokenDetails.reasoningTokens` exists in the SDK but
  `projectUsage` does not project it, so on a reasoning model *Output* is the total with the
  reasoning share hidden.
- Not a bill, not persisted, not aggregated across tabs or users — as above.

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
Regression suite: `npm test -- --grep "legacy: server/storage-persistence"`.

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
    "reasoning": "provider-default", // none|minimal|low|medium|high|xhigh
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

### Reasoning effort

`tuning.reasoning` is AI SDK 7's portable thinking control, and it is the one knob
whose default is a *latency* decision: left at `provider-default` nothing is sent,
so a thinking model (the Claude Opus line, o-series) reasons as much as it likes —
correct answers, and minutes of silence before the first token on questions that
never needed it. A provider can override it through its instance metadata, and the
provider type through its own, so a deployment can run one fast provider and one
deep one:

```jsonc
"metadata": { "reasoning": "low" }
```

Precedence: provider instance metadata → provider type metadata → `tuning.reasoning`.
Operator-controlled on purpose (never `getOption`): cost and latency policy is the
deployment's call, not a session's.

### Remote attachments and the SSRF guard

A message part may reference an asset by `url` instead of carrying it inline, and
that URL comes from the client. When the target model does not accept URLs of that
media type, **the SDK resolves the asset from the server process** — so the turn
path always supplies `experimental_download` (`server/asset-download.ts`), which
routes the fetch through `XOPAT_SERVER.safeRequest` (connect-time validation,
no redirects, private/metadata IP rejection), caps it at
`maxInlineAttachmentBytes`, and refuses outright when the guard is unavailable. A
model that *does* accept URLs gets the URL untouched — the fetch then happens at
the provider, on the provider's network. Do not remove the hook: without it the
SDK falls back to plain `fetch`, which turns a client-supplied URL into a
server-side request.

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

### Three channels, three questions

Each answers something different and costs something different. Turning one up
does not turn the others up (levels match by longest prefix).

| Channel | Answers | Cost |
|---|---|---|
| `module.vercel-ai-chat-sdk:transcript` | **what was said** — every message once | one record per message |
| `module.vercel-ai-chat-sdk:vision` | **what a vision model was shown** — region, prompt, findings + the image | one record + one PNG per vision call |
| `module.vercel-ai-chat-sdk:llm` | how a turn ran: shapes, counts, `MODEL_OUTPUT`, verdicts | O(1) per turn |
| `module.vercel-ai-chat-sdk:llm:full` | exactly what the model was sent | the whole conversation, per turn |

**To keep a conversation, use `:transcript`.** It is emitted from
`SessionStore.appendMessages` — the one place a message becomes real, and which
by construction only ever sees messages that were not already stored, so a
retried request cannot log anything twice. User messages, script results,
assistant replies and error messages all pass through it. Its attachments are
written as files beside the transcript when the destination takes them
(`attachments: true`), never inlined as base64; `tuning.transcriptAttachments:
false` opts out from this side. The full recipe — including the
`redact.maxStringLength` raise, without which long script results are cut — is
"keep the chat conversation" in [`server/LOGGING.md`](../../server/LOGGING.md).

**`:vision` is the audit trail for `runVisionInference`** — the stateless one-shot
call the pathology broker's remote `analyze` driver uses. Every call logs one
`VISION_CALL` record (slide id, region box, delivered µm/px, prompt, findings,
duration) and the reviewed image as a sidecar file, so a foundation-model finding
can be traced back to the picture it came from. The caller's `context` is logged
and **never** added to the model's message — enabling logging cannot change what
the model is asked. Volume note and the destination knobs that bound it:
[`server/LOGGING.md`](../../server/LOGGING.md) → *reconstruct a pilot session*.

**`:llm:full` is the old `XOPAT_CHAT_DEBUG` dump** (`MODEL_INPUT`,
`SEND_TURN_CONVERSATION`): the assembled prompt, as sent. It repeats the entire
history every turn — an N-turn session costs O(N²) — which is why it is a
separate channel rather than part of `:llm`. Use it for prompt-assembly bugs (a
missing system message, a dropped attachment, cache-breakpoint drift), not to
read a conversation back.

Payload records are only ever *built* when their channel is enabled — the call
sites are guarded with `isEnabled('trace')`, so a deployment with logging off
does no conversation projection per turn at all.

`XOPAT_PATHOLOGY_VISION_TIMEOUT_MS` is also described consumer-side in
[`plugins/pathology-medgemma/README.md`](../../plugins/pathology-medgemma/README.md).
