# Chat plugin for OpenAI (native)

Native OpenAI provider via the Vercel AI SDK's `@ai-sdk/openai` package:
GPT chat models plus first-class **transcription** (`whisper-1`,
`gpt-4o-transcribe`, …) through the SDK's transcription-model API. Use
this instead of `chat-openai-compatible` when you talk to OpenAI itself
and want the SDK-native features; use the compatible plugin for
everything merely speaking the OpenAI wire format.

All upstream traffic (chat and transcription) is routed through the core
SSRF guard (`safeFetch`) and the `baseUrl` is vetted before it reaches the
SDK; the API key stays server-side.

## Configuration

Server-only secure config (`server.json` author tier, or
`core.server.secure.plugins.chat-openai` in your env):

````json
"chat-openai": {
  "providerDefaults": {
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "<% OPENAI_API_KEY %>",
    "defaultModelId": "gpt-4o-mini",
    "defaultTranscriptionModelId": "whisper-1"
  }
}
````

`id` / `label` / `description` / `authType` / `requiresLogin` / `hidden` /
`contexts` behave exactly as in `chat-anthropic` / `chat-openai-compatible`
(managed provider, deployer flags win over untrusted input). Leave
`apiKey` empty to run BYOK — users supply their own key from the chat
settings dialog.

`apiKey` has three states:

| value | meaning |
| --- | --- |
| `"sk-…"` | the operator's server-side key |
| absent / `""` | a key is required — **model discovery does not call OpenAI** until the deployer or a BYOK user supplies one (no more 401 on every boot) |
| `false` | the endpoint is declared keyless; discovery runs with no `Authorization` header |

See the chat SDK's [README](../../modules/vercel-ai-chat-sdk/README.md) →
"No key, no discovery".

## Login (opt-in, method-agnostic)

Out of the box the plugin requires **no login**: `include.json` ships
`authMode: "none"` / `authContext: null`, so the provider works with the
operator's server-side key and no auth stack configured anywhere.

To put the chat behind a login, the *deployment* names a context — the
plugin never names a mechanism (no OIDC/SAML knowledge, no auth module in
`modules`, and it never calls `configureContext`; see `src/AUTH.md`):

````json
"plugins": {
  "chat-openai": { "authMode": "jwt", "authContext": "openai" }
}
````

and an auth module must **own** that context — e.g. `oidc-client-ts` /
`oidc-server-ts` / `saml-auth` loaded with `permaLoad` and declaring
`openai` in its `contexts` block (plus a matching `rpcVerifiers.openai`
server-side). If nothing claims the context, the chat degrades closed: no
Login button, chat stays disabled, and the panel shows
`chat.loginUnavailable` naming the unclaimed context.

Both keys are read via `getStaticMeta` (ENV/`include.json`), never
`getOption` — a session bundle cannot downgrade them.

## Speech-to-text

The adapter implements the chat SDK's optional `resolveTranscriptionModel`
capability natively (`openai.transcription(modelId)`), so the provider can
back the `speech-to-text` module's `vercel` driver:

````json
"speech-to-text": {
  "driver": "vercel",
  "vercel": { "providerId": "chat-openai", "model": "whisper-1" }
}
````

Whisper hints (`language`, `prompt`) are forwarded via providerOptions
under the `openai` namespace. A dedicated transcription-only deployment
can set `providerDefaults.hidden: true` — the provider stays out of the
chat picker but remains resolvable for transcription (it is still listed
by the chat SDK's `listTranscriptionProviders` RPC, flagged `hidden`).
