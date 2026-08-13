# Chat plugin for OpenAI-compatible endpoints

Generic chat provider that works with any GPT-like API speaking the OpenAI
HTTP wire format: OpenAI itself, Azure OpenAI, vLLM, Ollama, LM Studio,
Together, Groq, CERIT-AI, and friends. Point `baseUrl` at your endpoint
and the plugin will discover models via `GET {baseUrl}{modelsDiscoveryPath}`
and stream completions through the Vercel AI SDK's
`@ai-sdk/openai-compatible` adapter.

## Integrating via a server proxy

Define a proxy in your xOpat env (the alias is arbitrary — pick anything
that identifies the upstream):

````json
"server": {
  "secure": {
    "proxies": {
      "my-llm": {
        "baseUrl": "https://api.example.com/",
        "headers": {
          "Authorization": "Bearer [API TOKEN KEY FROM ENV OR PLAINTEXT]",
          "Content-Type": "application/json"
        }
      }
    }
  }
}
````

Then enable the plugin against that alias:

````json
"chat-openai-compatible": {
  "permaLoad": true,
  "authMode": "none",
  "proxyAlias": "my-llm"
}
````

With `authMode: "none"` (the default) the chat is usable by anyone who can
reach the viewer URL — the upstream proxy is the one enforcing the API
token, so make sure it's locked down.

For viewer-side auth, set `"authMode": "jwt"` and an `authContext`
(`null`/`"core"` = the viewer's main identity). The plugin names only the
**context**, never the mechanism: whichever auth module the deployment
loads (`oidc-client-ts`, `saml-auth`, …) claims it and drives the login.
Load one with `modules.<id>.permaLoad: true` — this plugin no longer pulls
one in through `modules`, so a SAML or auth-less deployment isn't forced to
ship OIDC. Back-compat inline config: `authBroker` + `authConfig` (legacy:
`oidc` + `oidcFlow`), applied only when no auth module claims the context.

## Naming the provider

`OpenAI-compatible` is just the default label. Give the provider a
deployment-specific identity by setting `providerDefaults.id` /
`label` / `description` in `server.json` (or in the secure section of
your xOpat env override):

````json
"chat-openai-compatible": {
  "providerDefaults": {
    "id": "groq-llama",
    "label": "Groq · Llama 3.1",
    "description": "Internal Groq endpoint serving Llama 3.1 70B",
    "baseUrl": "https://api.groq.com/openai/v1",
    "apiKey": "..."
  }
}
````

The label is what users see in the model picker; `id` is the stable
provider-type identifier the chat module persists, so pick something
unique and don't rename it after rollout.

### `apiKey` and keyless endpoints

| value | meaning |
| --- | --- |
| `"…"` (string) | the operator's server-side key |
| absent / `""` | a key is required — **model discovery does not call the endpoint** until the deployer or a BYOK user supplies one (no more 401 on every boot) |
| `false` | the endpoint is declared keyless; discovery runs with no auth header |

`false` is the setting for self-hosted inference that authenticates by network
position (ollama, vLLM, TGI). A private host also needs the operator SSRF
allowlist (`XOPAT_SSRF_ALLOWED_HOSTS` / `XOPAT_SSRF_ALLOWED_CIDRS`). See the chat
SDK's [README](../../modules/vercel-ai-chat-sdk/README.md) → "No key, no discovery".

## Transcription (speech-to-text)

The adapter also implements the chat SDK's optional
`resolveTranscriptionModel` capability: if the endpoint serves OpenAI's
`/v1/audio/transcriptions` (OpenAI, Groq, self-hosted whisper), the same
provider can back the `speech-to-text` module's `vercel` driver:

````json
"speech-to-text": { "driver": "vercel" }
````

Naming the provider is optional — the server picks a transcription-capable one
itself. Set the model once, next to the endpoint, instead of repeating it in every
consumer:

````json
"providerDefaults": {
  "baseUrl": "https://api.groq.com/openai/v1",
  "defaultTranscriptionModelId": "whisper-large-v3-turbo",
  "transcriptionDefault": true
}
````

`defaultTranscriptionModelId` is what a transcription request uses when it names no
model (the chat `defaultModelId` is a *chat* model and `/audio/transcriptions`
rejects it; unset falls back to `whisper-1`). `transcriptionDefault: true` nominates
this provider when several can transcribe — it only wins the tie-break, the real
gates stay adapter capability and the runtime access check. Both are deployer-only
secure config; users creating their own instance get the model as a form field.

Pin a specific provider from the consumer side instead if you prefer:

````json
"speech-to-text": {
  "driver": "vercel",
  "vercel": { "providerId": "chat-openai-compatible", "model": "whisper-large-v3-turbo" }
}
````

Requests go through the module's OpenAI-compatible transcription shim
(server-side, SSRF-guarded) and honor the same auth config as chat —
including a custom `apiKeyHeader` and `headersJson` extras (older builds
hardcoded `Authorization: Bearer` for transcription). If the endpoint has
no transcription route, the first attempt fails with an explicit error and
the speech module falls back to its in-browser whisper.
